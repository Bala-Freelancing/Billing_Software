// Receipts (money from customers), payments (money to suppliers), bill-wise
// outstanding, statements of account.
//
// What can go wrong and how it is handled:
// - Double submit / retry: the client uid is unique; a repeat returns the first voucher.
// - Two receipts settling the same invoice at once: allocations are re-checked
//   inside the batch by a guard (no target may go below zero outstanding), so
//   the slower save rolls back with a 409 instead of over-settling a bill.
// - Invoice cancelled while a receipt is being saved: the guard requires the
//   target to still be posted; cancelling an invoice that has allocations is
//   refused (sales/purchases routes, also guarded in-batch).
// - Rounding: everything is integer paise; the journal must balance or nothing is written.
// - Voucher numbers come from document_counters in the same batch (gapless).
import { Hono } from "hono";
import { todayIst } from "../../shared/gst";
import { PAGE_SIZE, type ListResponse } from "../../shared/masters";
import { cancelSchema } from "../../shared/purchase";
import { financialYear } from "../../shared/sales";
import {
  allocateOldestFirst,
  kindQuery,
  statementQuery,
  voucherListQuery,
  voucherSchema,
  type OutstandingParty,
  type Statement,
  type StatementLine,
  type VoucherDetail,
  type VoucherKind,
  type VoucherSummary,
} from "../../shared/vouchers";
import { isUniqueViolation, likePattern, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { clearGuards, guard, isGuardFailure } from "../lib/guard";
import { JournalBuilder, journalStatements, readJournal } from "../lib/journal";
import {
  ageing,
  openBillsSql,
  openingOutstandingSql,
  purchaseOutstandingSql,
  saleOutstandingSql,
  toOutstandingBill,
  type OpenBillRow,
} from "../lib/outstanding";
import { audit, auditIfChanged, idParam } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const invalid = (message: string, field = "allocations") => new AppError(400, "VALIDATION", message, { fields: { [field]: [message] } });
const SERIES: Record<VoucherKind, string> = { receipt: "RCT", payment: "PAY" };
const SIDE: Record<VoucherKind, { partyTypes: string[]; target: "sale" | "purchase"; label: string }> = {
  receipt: { partyTypes: ["customer", "both"], target: "sale", label: "customer" },
  payment: { partyTypes: ["supplier", "both"], target: "purchase", label: "supplier" },
};

interface PartyRow {
  id: number;
  name: string;
  party_type: string;
  phone: string;
  gstin: string | null;
  is_active: number;
  is_counter: number;
  opening_balance_paise: number;
}
const getParty = (db: D1Database, id: number) =>
  db.prepare("SELECT id, name, party_type, phone, gstin, is_active, is_counter, opening_balance_paise FROM parties WHERE id = ?1").bind(id).first<PartyRow>();

async function openBills(db: D1Database, kind: VoucherKind, partyId: number, today: string) {
  const { results } = await db.prepare(openBillsSql(kind, (col) => `${col} = ?1`)).bind(partyId).all<OpenBillRow>();
  return results.map((r) => toOutstandingBill(r, today));
}

const toSummary = (r: Row): VoucherSummary => ({
  id: r.id,
  kind: r.kind,
  voucherNo: r.voucher_no,
  voucherDate: r.voucher_date,
  partyId: r.party_id,
  partyName: r.party_name,
  amountPaise: r.amount_paise,
  discountPaise: r.discount_paise,
  mode: r.mode,
  reference: r.reference,
  status: r.status,
});

async function readVoucher(db: D1Database, id: number): Promise<VoucherDetail | null> {
  const [head, allocs] = await db.batch([
    db.prepare("SELECT v.*, p.name AS party_name FROM money_vouchers v JOIN parties p ON p.id = v.party_id WHERE v.id = ?1").bind(id),
    db
      .prepare(
        `SELECT a.target_type, a.target_id, a.amount_paise,
                CASE a.target_type WHEN 'sale' THEN (SELECT invoice_no FROM sales WHERE id = a.target_id)
                                   WHEN 'purchase' THEN (SELECT supplier_invoice_no FROM purchases WHERE id = a.target_id)
                                   ELSE 'Opening balance' END AS doc_no
           FROM voucher_allocations a WHERE a.voucher_id = ?1 ORDER BY a.id`,
      )
      .bind(id),
  ]);
  const v = (head?.results as Row[] | undefined)?.[0];
  if (!v) return null;
  const allocations = ((allocs?.results ?? []) as Row[]).map((a) => ({ targetType: a.target_type, targetId: a.target_id, docNo: a.doc_no ?? "", amountPaise: a.amount_paise }));
  const allocated = allocations.reduce((s, a) => s + a.amountPaise, 0);
  return {
    ...toSummary(v),
    remarks: v.remarks,
    cancelReason: v.cancel_reason,
    allocations,
    advancePaise: v.amount_paise + v.discount_paise - allocated,
    journal: await readJournal(db, v.kind, id),
  };
}

export const voucherRoutes = new Hono<AppEnv>();
for (const path of ["/vouchers", "/vouchers/*", "/outstanding", "/accounts/*"]) voucherRoutes.use(path, requireAuth);

voucherRoutes
  .get("/vouchers", validate("query", voucherListQuery), async (c) => {
    const { kind, q, status, partyId, from, to, page } = c.req.valid("query");
    const binds: unknown[] = [];
    const bind = (v: unknown) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    const where = [`v.kind = ${bind(kind)}`];
    if (status !== "all") where.push(`v.status = ${bind(status)}`);
    if (partyId) where.push(`v.party_id = ${bind(partyId)}`);
    if (from) where.push(`v.voucher_date >= ${bind(from)}`);
    if (to) where.push(`v.voucher_date <= ${bind(to)}`);
    if (q) {
      const n = bind(likePattern(q));
      where.push(`(p.name LIKE ${n} ESCAPE '\\' OR v.voucher_no LIKE ${n} ESCAPE '\\' OR v.reference LIKE ${n} ESCAPE '\\')`);
    }
    const clause = `FROM money_vouchers v JOIN parties p ON p.id = v.party_id WHERE ${where.join(" AND ")}`;
    const db = c.env.DB;
    const [rows, count] = await db.batch([
      db
        .prepare(`SELECT v.*, p.name AS party_name ${clause} ORDER BY v.voucher_date DESC, v.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`)
        .bind(...binds),
      db.prepare(`SELECT COUNT(*) AS n ${clause}`).bind(...binds),
    ]);
    const body: ListResponse<VoucherSummary> = {
      items: ((rows?.results ?? []) as Row[]).map(toSummary),
      total: ((count?.results?.[0] as Row | undefined)?.n as number) ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
    return c.json(body);
  })

  .get("/vouchers/:id", async (c) => {
    const v = await readVoucher(c.env.DB, idParam(c));
    if (!v) throw notFound("Voucher");
    return c.json(v);
  })

  .post("/vouchers", validate("json", voucherSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const existing = await db.prepare("SELECT id FROM money_vouchers WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (existing) return c.json(await readVoucher(db, existing.id));

    const side = SIDE[input.kind];
    const party = await getParty(db, input.partyId);
    if (!party) throw invalid("Party not found", "partyId");
    if (!party.is_active) throw invalid("This party is inactive", "partyId");
    if (!side.partyTypes.includes(party.party_type)) throw invalid(`Choose a ${side.label}`, "partyId");
    if (party.is_counter && input.kind === "payment") throw invalid("Counter Sales can't receive payments", "partyId");

    const today = todayIst();
    const bills = await openBills(db, input.kind, party.id, today);
    const total = input.amountPaise + input.discountPaise;
    let allocations = input.allocations ?? allocateOldestFirst(bills, total);
    allocations = allocations.filter((a) => a.amountPaise > 0);
    for (const a of allocations) {
      if (a.targetType !== "opening" && a.targetType !== side.target) throw invalid(`A ${input.kind} can only settle ${side.target} bills`);
      const bill = bills.find((b) => b.targetType === a.targetType && b.targetId === a.targetId);
      if (!bill) throw invalid("One of the bills is already settled or doesn't belong to this party. Reload and try again.");
      if (a.amountPaise > bill.outstandingPaise) throw invalid(`${bill.docNo}: only ₹${(bill.outstandingPaise / 100).toFixed(2)} is outstanding`);
    }
    if (input.discountPaise > 0 && allocations.reduce((s, a) => s + a.amountPaise, 0) < total) {
      // A discount only makes sense against bills it settles; never as an advance.
      throw invalid("A discount can only be given against bills it settles", "discountPaise");
    }

    const journal = new JournalBuilder();
    const money = input.mode === "cash" ? "cash" : "bank";
    if (input.kind === "receipt") {
      journal.debit({ ledger: money }, input.amountPaise).debit({ ledger: "discount_allowed" }, input.discountPaise).credit({ partyId: party.id }, total);
    } else {
      journal.debit({ partyId: party.id }, total).credit({ ledger: money }, input.amountPaise).credit({ ledger: "discount_received" }, input.discountPaise);
    }

    const fy = financialYear(input.voucherDate);
    const series = `${SERIES[input.kind]}-${fy}`;
    const vid = "(SELECT id FROM money_vouchers WHERE uid = ?1)";
    const now = Date.now();
    // Every allocation of this voucher must leave its target at >= 0 outstanding,
    // and the target must still be a posted bill of this party.
    const targetOk = `CASE a.target_type
        WHEN 'sale' THEN EXISTS (SELECT 1 FROM sales s WHERE s.id = a.target_id AND s.customer_id = ?2 AND s.status = 'posted'
                                   AND s.collection_type = 'credit' AND ${saleOutstandingSql()} >= 0)
        WHEN 'purchase' THEN EXISTS (SELECT 1 FROM purchases pu WHERE pu.id = a.target_id AND pu.supplier_id = ?2 AND pu.status = 'posted'
                                   AND ${purchaseOutstandingSql()} >= 0)
        ELSE EXISTS (SELECT 1 FROM parties p WHERE p.id = a.target_id AND p.id = ?2 AND ${openingOutstandingSql(input.kind)} >= 0)
      END`;
    try {
      await db.batch([
        db.prepare("INSERT INTO document_counters (series, last_no) VALUES (?1, 1) ON CONFLICT (series) DO UPDATE SET last_no = last_no + 1").bind(series),
        db
          .prepare(
            `INSERT INTO money_vouchers (uid, kind, voucher_no, financial_year, sequence_no, party_id, voucher_date, amount_paise, discount_paise,
                                         mode, reference, remarks, created_at)
             SELECT ?1, ?2, ?3 || '/' || ?4 || '/' || printf('%04d', c.last_no), ?3, c.last_no, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
               FROM document_counters c WHERE c.series = ?13`,
          )
          .bind(input.uid, input.kind, fy, SERIES[input.kind], party.id, input.voucherDate, input.amountPaise, input.discountPaise,
            input.mode, input.reference, input.remarks, now, series),
        db
          .prepare(
            `INSERT INTO voucher_allocations (voucher_id, target_type, target_id, amount_paise)
             SELECT ${vid}, j.value ->> '$.targetType', j.value ->> '$.targetId', j.value ->> '$.amountPaise' FROM json_each(?2) j`,
          )
          .bind(input.uid, JSON.stringify(allocations)),
        guard(db, `NOT EXISTS (SELECT 1 FROM voucher_allocations a WHERE a.voucher_id = ${vid} AND NOT (${targetOk}))`, input.uid, party.id),
        clearGuards(db),
        ...journalStatements(db, {
          sourceType: input.kind,
          uid: input.uid,
          date: input.voucherDate,
          narration: `${input.kind === "receipt" ? "Received from" : "Paid to"} ${party.name}`,
          journal,
          now,
        }),
        audit(c, `${input.kind}.created`, { uid: input.uid, partyId: party.id, amountPaise: input.amountPaise, discountPaise: input.discountPaise, mode: input.mode, allocations }),
      ]);
    } catch (err) {
      if (isUniqueViolation(err, "money_vouchers.uid")) {
        const row = await db.prepare("SELECT id FROM money_vouchers WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
        if (row) return c.json(await readVoucher(db, row.id));
      }
      if (isGuardFailure(err)) {
        throw new AppError(409, "OUTSTANDING_CHANGED", "These bills changed while saving (another receipt, payment or return was just saved). Reload and try again.");
      }
      throw err;
    }
    const created = await db.prepare("SELECT id FROM money_vouchers WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (!created) throw new Error("voucher not found after insert");
    return c.json(await readVoucher(db, created.id), 201);
  })

  .post("/vouchers/:id/cancel", validate("json", cancelSchema), async (c) => {
    const id = idParam(c);
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const v = await readVoucher(db, id);
    if (!v) throw notFound("Voucher");
    if (v.status !== "posted") throw new AppError(409, "ALREADY_CANCELLED", "This voucher is already cancelled.");
    const [update] = await db.batch([
      db.prepare("UPDATE money_vouchers SET status = 'cancelled', cancel_reason = ?1 WHERE id = ?2 AND status = 'posted'").bind(reason, id),
      auditIfChanged(c, `${v.kind}.cancelled`, { id, voucherNo: v.voucherNo, reason, amountPaise: v.amountPaise }),
      db.prepare("UPDATE journal_entries SET status = 'cancelled' WHERE source_type = ?1 AND source_id = ?2").bind(v.kind, id),
    ]);
    if (!update?.meta.changes) throw new AppError(409, "ALREADY_CANCELLED", "This voucher is already cancelled.");
    return c.json(await readVoucher(db, id));
  })

  // Open bills of one party, oldest first — the receipt/payment form allocates against these.
  .get("/accounts/parties/:id/open-bills", validate("query", kindQuery), async (c) => {
    const id = idParam(c);
    const { kind } = c.req.valid("query");
    const party = await getParty(c.env.DB, id);
    if (!party) throw notFound("Party");
    return c.json({ items: await openBills(c.env.DB, kind, id, todayIst()) });
  })

  .get("/accounts/parties/:id/statement", validate("query", statementQuery), async (c) => {
    const id = idParam(c);
    const today = todayIst();
    const { to = today } = c.req.valid("query");
    // Default: from the start of the financial year of `to` (1 April).
    const from = c.req.valid("query").from ?? `20${financialYear(to).slice(0, 2)}-04-01`;
    if (from > to) throw invalid("From date is after To date", "from");
    const db = c.env.DB;
    const party = await getParty(db, id);
    if (!party) throw notFound("Party");
    const docNo = `CASE e.source_type
        WHEN 'sale' THEN (SELECT invoice_no FROM sales WHERE id = e.source_id)
        WHEN 'sales_return' THEN (SELECT credit_note_no FROM sales_returns WHERE id = e.source_id)
        WHEN 'purchase' THEN (SELECT supplier_invoice_no FROM purchases WHERE id = e.source_id)
        WHEN 'purchase_return' THEN 'DN-' || e.source_id
        ELSE (SELECT voucher_no FROM money_vouchers WHERE id = e.source_id) END`;
    const [before, lines] = await db.batch([
      db
        .prepare(
          `SELECT COALESCE(SUM(jl.debit_paise - jl.credit_paise), 0) AS b FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
            WHERE jl.party_id = ?1 AND e.status = 'posted' AND e.entry_date < ?2`,
        )
        .bind(id, from),
      db
        .prepare(
          `SELECT e.entry_date, e.source_type, e.narration, ${docNo} AS doc_no, SUM(jl.debit_paise) AS dr, SUM(jl.credit_paise) AS cr
             FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
            WHERE jl.party_id = ?1 AND e.status = 'posted' AND e.entry_date BETWEEN ?2 AND ?3
            GROUP BY e.id ORDER BY e.entry_date, e.id LIMIT 5000`,
        )
        .bind(id, from, to),
    ]);
    const openingPaise = party.opening_balance_paise + (((before?.results?.[0] as Row | undefined)?.b as number) ?? 0);
    const TYPE: Record<string, string> = { sale: "Sale", sales_return: "Credit note", purchase: "Purchase", purchase_return: "Debit note", receipt: "Receipt", payment: "Payment" };
    let running = openingPaise;
    const out: StatementLine[] = ((lines?.results ?? []) as Row[]).map((r) => {
      running += r.dr - r.cr;
      return { date: r.entry_date, docType: TYPE[r.source_type] ?? r.source_type, docNo: r.doc_no ?? "", narration: r.narration, debitPaise: r.dr, creditPaise: r.cr, balancePaise: running };
    });
    const outstanding = [...(await openBills(db, "receipt", id, today)), ...(await openBills(db, "payment", id, today))];
    const body: Statement = {
      party: { id: party.id, name: party.name, partyType: party.party_type, gstin: party.gstin, phone: party.phone },
      from,
      to,
      openingPaise,
      lines: out,
      closingPaise: running,
      outstanding,
      ageing: ageing(outstanding),
    };
    return c.json(body);
  })

  // Parties with money due (receivable) or owed (payable), oldest dues and overdue amounts.
  .get("/outstanding", validate("query", kindQuery), async (c) => {
    const { kind } = c.req.valid("query");
    const db = c.env.DB;
    const today = todayIst();
    const [balances, bills] = await db.batch([
      db.prepare(
        `SELECT p.id, p.name, p.phone,
                p.opening_balance_paise + COALESCE((SELECT SUM(jl.debit_paise - jl.credit_paise) FROM journal_lines jl
                   JOIN journal_entries e ON e.id = jl.entry_id WHERE jl.party_id = p.id AND e.status = 'posted'), 0) AS balance
           FROM parties p`,
      ),
      db.prepare(openBillsSql(kind, () => "1")),
    ]);
    const byParty = new Map<number, ReturnType<typeof toOutstandingBill>[]>();
    for (const r of (bills?.results ?? []) as unknown as OpenBillRow[]) {
      const list = byParty.get(r.party_id) ?? [];
      list.push(toOutstandingBill(r, today));
      byParty.set(r.party_id, list);
    }
    const sign = kind === "receipt" ? 1 : -1;
    const items: OutstandingParty[] = ((balances?.results ?? []) as Row[])
      .filter((p) => p.balance * sign > 0)
      .map((p) => {
        const list = byParty.get(p.id) ?? [];
        return {
          partyId: p.id,
          name: p.name,
          phone: p.phone,
          balancePaise: p.balance * sign,
          oldestDays: list.length ? Math.max(...list.map((b) => b.daysPending)) : null,
          overduePaise: list.filter((b) => b.overdue).reduce((s, b) => s + b.outstandingPaise, 0),
        };
      })
      .sort((a, b) => (b.oldestDays ?? -1) - (a.oldestDays ?? -1) || b.balancePaise - a.balancePaise);
    const allBills = [...byParty.values()].flat();
    return c.json({ items, totalPaise: items.reduce((s, i) => s + i.balancePaise, 0), ageing: ageing(allBills) });
  });
