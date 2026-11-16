// Ledgers (account heads) and expense vouchers (draft → approve).
//
// What can go wrong and how it is handled:
// - Approving twice / approving while editing: every state change is
//   `WHERE status = 'draft' AND updated_at = ?` and a guard right after it
//   asserts exactly one row changed, so the number and journal roll back on a lost race.
// - Gapless numbers: a number is taken only on approval, in the same batch.
//   Rejected drafts never consume one.
// - Ledger deactivated or regrouped between draft and approval: approval
//   re-checks inside the batch that every line's ledger is active and an expense head.
// - Changing a used ledger's group would silently move history between P&L
//   and Balance Sheet: refused once the ledger is used.
// - System ledgers (Sales, Cash, GST…) are read-only.
import { Hono } from "hono";
import {
  approveSchema,
  computeExpense,
  expenseListQuery,
  expenseSchema,
  ledgerListQuery,
  ledgerSchema,
  rejectSchema,
  updateExpenseSchema,
  updateLedgerSchema,
  type ExpenseDetail,
  type ExpenseSummary,
  type Ledger,
  ledgerGroupSchema,
  updateLedgerGroupSchema,
  type LedgerGroupRow,
} from "../../shared/ledgers";
import { PAGE_SIZE, type ListResponse } from "../../shared/masters";
import { cancelSchema } from "../../shared/purchase";
import { financialYear } from "../../shared/sales";
import { conflict, isUniqueViolation, likePattern, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { clearGuards, guard, isGuardFailure } from "../lib/guard";
import { JournalBuilder, journalStatements, readJournal } from "../lib/journal";
import { audit, auditIfChanged, idParam, nextStamp } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const PARTY_GROUPS = ["sundry_debtors", "sundry_creditors"];
const invalid = (message: string, field: string) => new AppError(400, "VALIDATION", message, { fields: { [field]: [message] } });
const IN_USE = `(EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.ledger_id = l.id) OR EXISTS (SELECT 1 FROM general_voucher_lines gl WHERE gl.ledger_id = l.id))`;

const toLedger = (r: Row): Ledger => ({
  id: r.id,
  name: r.name,
  groupId: r.group_id,
  groupName: r.group_name,
  nature: r.nature,
  isSystem: r.system_key !== null,
  isActive: r.is_active === 1,
  inUse: r.in_use === 1,
  openingBalancePaise: r.opening_balance_paise ?? 0,
  updatedAt: r.updated_at,
});

async function getLedger(db: D1Database, id: number) {
  const r = await db
    .prepare(`SELECT l.*, g.name AS group_name, g.nature, ${IN_USE} AS in_use FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id WHERE l.id = ?1`)
    .bind(id)
    .first<Row>();
  return r ? toLedger(r) : null;
}

async function checkGroup(db: D1Database, groupId: number) {
  const g = await db.prepare("SELECT system_key FROM ledger_groups WHERE id = ?1").bind(groupId).first<{ system_key: string | null }>();
  if (!g) throw invalid("Choose a group", "groupId");
  if (g.system_key && PARTY_GROUPS.includes(g.system_key)) throw invalid("Customers and suppliers are added under Parties", "groupId");
}

const duplicateName = (err: unknown): never => {
  if (isUniqueViolation(err, "ledgers.name")) throw invalid("A ledger with this name already exists", "name");
  throw err;
};

const toGroupRow = (g: Row): LedgerGroupRow => ({
  id: g.id,
  name: g.name,
  nature: g.nature,
  systemKey: g.system_key,
  allowsLedgers: !PARTY_GROUPS.includes(g.root_key),
  parentId: g.parent_id,
  parentName: g.parent_name,
  isSystem: g.system_key !== null,
  ledgerCount: g.ledger_count,
  updatedAt: g.updated_at,
});

/** ledger_groups.name is unique case-sensitively (0003); names must also differ ignoring case. */
async function assertGroupNameFree(db: D1Database, name: string, exceptId: number) {
  const clash = await db.prepare("SELECT 1 FROM ledger_groups WHERE name = ?1 COLLATE NOCASE AND id <> ?2").bind(name, exceptId).first();
  if (clash) throw invalid("A group with this name already exists", "name");
}

async function getGroupRow(db: D1Database, id: number) {
  const r = await db
    .prepare(
      `SELECT g.*, pg.name AS parent_name, COALESCE(pg.system_key, g.system_key) AS root_key,
              (SELECT COUNT(*) FROM ledgers l WHERE l.group_id = g.id) AS ledger_count
         FROM ledger_groups g LEFT JOIN ledger_groups pg ON pg.id = g.parent_id WHERE g.id = ?1`,
    )
    .bind(id)
    .first<Row>();
  return r ? toGroupRow(r) : null;
}

// ── Expense vouchers ────────────────────────────────────────────────────────

async function readExpense(db: D1Database, id: number): Promise<ExpenseDetail | null> {
  const [head, lines] = await db.batch([
    db.prepare("SELECT * FROM general_vouchers WHERE id = ?1").bind(id),
    db
      .prepare(
        `SELECT gl.ledger_id, l.name AS ledger_name, gl.amount_paise, gl.gst_rate_bp, gl.cgst_paise + gl.sgst_paise + gl.igst_paise AS tax_paise, gl.narration
           FROM general_voucher_lines gl
           JOIN ledgers l ON l.id = gl.ledger_id WHERE gl.voucher_id = ?1 ORDER BY gl.line_no`,
      )
      .bind(id),
  ]);
  const v = (head?.results as Row[] | undefined)?.[0];
  if (!v) return null;
  const ls = ((lines?.results ?? []) as Row[]).map((l) => ({
    ledgerId: l.ledger_id,
    ledgerName: l.ledger_name,
    amountPaise: l.amount_paise,
    gstRateBp: l.gst_rate_bp,
    taxPaise: l.tax_paise,
    narration: l.narration,
  }));
  return {
    ...toExpenseSummary({ ...v, heads: ls.map((l) => l.ledgerName).join(", ") }),
    remarks: v.remarks,
    statusReason: v.status_reason,
    gstBill: v.gst_bill === 1,
    supplierName: v.supplier_name,
    supplierGstin: v.supplier_gstin,
    supplierInvoiceNo: v.supplier_invoice_no,
    supplierInvoiceDate: v.supplier_invoice_date,
    interstate: v.interstate === 1,
    taxablePaise: v.taxable_paise,
    cgstPaise: v.cgst_paise,
    sgstPaise: v.sgst_paise,
    igstPaise: v.igst_paise,
    approvedAt: v.approved_at,
    lines: ls,
    journal: v.status === "approved" || v.status === "cancelled" ? await readJournal(db, "journal", id) : [],
  };
}

const toExpenseSummary = (r: Row): ExpenseSummary => ({
  id: r.id,
  voucherNo: r.voucher_no,
  voucherDate: r.voucher_date,
  mode: r.mode,
  reference: r.reference,
  totalPaise: r.total_paise,
  status: r.status,
  heads: r.heads ?? "",
  updatedAt: r.updated_at,
});

/** Every line must use an active, non-system expense head. */
async function checkLines(db: D1Database, lines: { ledgerId: number }[]) {
  const ids = [...new Set(lines.map((l) => l.ledgerId))];
  const { results } = await db
    .prepare(
      `SELECT l.id, l.name, l.is_active, l.system_key, g.nature FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id
        WHERE l.id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids))
    .all<Row>();
  for (const id of ids) {
    const l = results.find((r) => r.id === id);
    if (!l) throw invalid("Expense head not found", "lines");
    if (!l.is_active) throw invalid(`${l.name} is inactive`, "lines");
    if (l.nature !== "expense" || l.system_key !== null) throw invalid(`${l.name} is not an expense head`, "lines");
  }
}

/** SQL true when every line of voucher ?1 still uses an active expense head. */
const LINES_VALID = `NOT EXISTS (SELECT 1 FROM general_voucher_lines gl JOIN ledgers l ON l.id = gl.ledger_id JOIN ledger_groups g ON g.id = l.group_id
   WHERE gl.voucher_id = ?1 AND (l.is_active = 0 OR g.nature <> 'expense' OR l.system_key IS NOT NULL))`;

const insertLines = (db: D1Database, voucherIdSql: string, uidOrId: unknown, lines: unknown[]) =>
  db
    .prepare(
      `INSERT INTO general_voucher_lines (voucher_id, line_no, ledger_id, amount_paise, gst_rate_bp, cgst_paise, sgst_paise, igst_paise, narration)
       SELECT ${voucherIdSql}, j.key + 1, j.value ->> '$.ledgerId', j.value ->> '$.amountPaise', j.value ->> '$.gstRateBp',
              j.value ->> '$.cgstPaise', j.value ->> '$.sgstPaise', j.value ->> '$.igstPaise', j.value ->> '$.narration' FROM json_each(?2) j`,
    )
    .bind(uidOrId, JSON.stringify(lines));

type ExpenseBody = ReturnType<typeof expenseSchema.parse>;

/** Validates GST rates against the slabs and computes tax per line and totals. */
async function prepareExpense(db: D1Database, input: ExpenseBody) {
  let interstate = false;
  if (input.gstBill) {
    const [slabs, shop] = await db.batch([
      db.prepare("SELECT rate_bp FROM gst_slabs"),
      db.prepare("SELECT state_code FROM shop_settings WHERE id = 1"),
    ]);
    const rates = new Set(((slabs?.results ?? []) as Row[]).map((r) => r.rate_bp as number));
    for (const l of input.lines) if (!rates.has(l.gstRateBp)) throw invalid("Choose a GST rate from the GST slabs", "lines");
    const shopState = ((shop?.results?.[0] as Row | undefined)?.state_code as string | undefined) ?? "33";
    interstate = input.supplierGstin.slice(0, 2) !== shopState;
  }
  const t = computeExpense(input.lines, interstate);
  const lines = input.lines.map((l, i) => ({ ...l, cgstPaise: t.lines[i]!.cgstPaise, sgstPaise: t.lines[i]!.sgstPaise, igstPaise: t.lines[i]!.igstPaise }));
  const head = input.gstBill
    ? [1, input.supplierName, input.supplierGstin, input.supplierInvoiceNo, input.supplierInvoiceDate, interstate ? 1 : 0]
    : [0, "", null, "", null, 0];
  return { lines, totals: t, head: [...head, t.taxablePaise, t.cgstPaise, t.sgstPaise, t.igstPaise] };
}
const GST_COLUMNS = "gst_bill, supplier_name, supplier_gstin, supplier_invoice_no, supplier_invoice_date, interstate, taxable_paise, cgst_paise, sgst_paise, igst_paise";

// ── Routes ───────────────────────────────────────────────────────────────────

export const ledgerRoutes = new Hono<AppEnv>();
for (const path of ["/ledgers", "/ledgers/*", "/ledger-groups", "/ledger-groups/*", "/expenses", "/expenses/*"]) ledgerRoutes.use(path, requireAuth);

ledgerRoutes
  .get("/ledger-groups", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT g.*, pg.name AS parent_name, COALESCE(pg.system_key, g.system_key) AS root_key,
              (SELECT COUNT(*) FROM ledgers l WHERE l.group_id = g.id) AS ledger_count
         FROM ledger_groups g LEFT JOIN ledger_groups pg ON pg.id = g.parent_id
        ORDER BY g.nature, COALESCE(pg.name, g.name), g.parent_id IS NOT NULL, g.name`,
    ).all<Row>();
    const items: LedgerGroupRow[] = results.map(toGroupRow);
    return c.json({ items });
  })

  // Sub-groups sit one level under a built-in group and take its nature
  // (so they land in the right place in P&L / Balance Sheet).
  .post("/ledger-groups", validate("json", ledgerGroupSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const parent = await db.prepare("SELECT id, nature, system_key, parent_id FROM ledger_groups WHERE id = ?1").bind(input.parentId).first<Row>();
    if (!parent || parent.system_key === null) throw invalid("Choose a main (built-in) group", "parentId");
    if (PARTY_GROUPS.includes(parent.system_key)) throw invalid("Customers and suppliers are managed under Parties", "parentId");
    await assertGroupNameFree(db, input.name, 0);
    const now = Date.now();
    try {
      const [ins] = await db.batch([
        db
          .prepare("INSERT INTO ledger_groups (name, nature, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id")
          .bind(input.name, parent.nature, parent.id, now),
        audit(c, "ledger_group.created", { name: input.name, parentId: parent.id }),
      ]);
      return c.json(await getGroupRow(db, (ins?.results?.[0] as { id: number }).id), 201);
    } catch (err) {
      if (isUniqueViolation(err, "ledger_groups.name")) throw invalid("A group with this name already exists", "name");
      throw err;
    }
  })

  .put("/ledger-groups/:id", validate("json", updateLedgerGroupSchema), async (c) => {
    const id = idParam(c);
    const input = c.req.valid("json");
    const db = c.env.DB;
    const current = await getGroupRow(db, id);
    if (!current) throw notFound("Ledger group");
    if (current.isSystem) throw new AppError(400, "SYSTEM_GROUP", "Built-in groups can't be changed.");
    if (current.updatedAt !== input.updatedAt) throw conflict();
    await assertGroupNameFree(db, input.name, id);
    try {
      const [update] = await db.batch([
        db.prepare("UPDATE ledger_groups SET name = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4 AND system_key IS NULL").bind(input.name, nextStamp(current.updatedAt), id, input.updatedAt),
        auditIfChanged(c, "ledger_group.updated", { id, from: current.name, to: input.name }),
      ]);
      if (!update?.meta.changes) throw conflict();
    } catch (err) {
      if (isUniqueViolation(err, "ledger_groups.name")) throw invalid("A group with this name already exists", "name");
      throw err;
    }
    return c.json(await getGroupRow(db, id));
  })

  .get("/ledgers", validate("query", ledgerListQuery), async (c) => {
    const { q, nature, active } = c.req.valid("query");
    const where = ["1"];
    const binds: unknown[] = [];
    if (q) {
      binds.push(likePattern(q));
      where.push(`l.name LIKE ?${binds.length} ESCAPE '\\'`);
    }
    if (nature) {
      binds.push(nature);
      where.push(`g.nature = ?${binds.length}`);
    }
    if (active === "1") where.push("l.is_active = 1");
    const { results } = await c.env.DB.prepare(
      `SELECT l.*, g.name AS group_name, g.nature, ${IN_USE} AS in_use FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id
        WHERE ${where.join(" AND ")} ORDER BY g.nature, g.name, l.name LIMIT 500`,
    )
      .bind(...binds)
      .all<Row>();
    const items = results.map(toLedger);
    const body: ListResponse<Ledger> = { items, total: items.length, page: 1, pageSize: 500 };
    return c.json(body);
  })

  .post("/ledgers", validate("json", ledgerSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    await checkGroup(db, input.groupId);
    const now = Date.now();
    try {
      const [ins] = await db.batch([
        db.prepare("INSERT INTO ledgers (name, group_id, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id").bind(input.name, input.groupId, input.isActive ? 1 : 0, now),
        audit(c, "ledger.created", { name: input.name, groupId: input.groupId }),
      ]);
      const id = (ins?.results?.[0] as { id: number } | undefined)?.id;
      if (!id) throw new Error("ledger insert failed");
      return c.json(await getLedger(db, id), 201);
    } catch (err) {
      return duplicateName(err);
    }
  })

  .put("/ledgers/:id", validate("json", updateLedgerSchema), async (c) => {
    const id = idParam(c);
    const input = c.req.valid("json");
    const db = c.env.DB;
    const current = await getLedger(db, id);
    if (!current) throw notFound("Ledger");
    if (current.isSystem) throw new AppError(400, "SYSTEM_LEDGER", "Built-in ledgers can't be changed.");
    if (current.updatedAt !== input.updatedAt) throw conflict();
    if (input.groupId !== current.groupId) {
      if (current.inUse) throw invalid("This ledger is already used in entries; its group can't change", "groupId");
      await checkGroup(db, input.groupId);
    }
    const stamp = nextStamp(current.updatedAt);
    try {
      const [update] = await db.batch([
        db
          .prepare("UPDATE ledgers SET name = ?1, group_id = ?2, is_active = ?3, updated_at = ?4 WHERE id = ?5 AND updated_at = ?6 AND system_key IS NULL")
          .bind(input.name, input.groupId, input.isActive ? 1 : 0, stamp, id, input.updatedAt),
        auditIfChanged(c, "ledger.updated", { id, from: { name: current.name, groupId: current.groupId, isActive: current.isActive }, to: { name: input.name, groupId: input.groupId, isActive: input.isActive } }),
        // Group may change only while unused (a voucher may have just used it).
        guard(db, `?2 = ?3 OR NOT EXISTS (SELECT 1 FROM journal_lines WHERE ledger_id = ?1) AND NOT EXISTS (SELECT 1 FROM general_voucher_lines WHERE ledger_id = ?1)`, id, input.groupId, current.groupId),
        clearGuards(db),
      ]);
      if (!update?.meta.changes) throw conflict();
    } catch (err) {
      if (isGuardFailure(err)) throw invalid("This ledger is already used in entries; its group can't change", "groupId");
      duplicateName(err);
    }
    return c.json(await getLedger(db, id));
  })

  .get("/expenses", validate("query", expenseListQuery), async (c) => {
    const { status, q, from, to, page } = c.req.valid("query");
    const binds: unknown[] = [];
    const bind = (v: unknown) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    const where = ["1"];
    if (status !== "all") where.push(`v.status = ${bind(status)}`);
    if (from) where.push(`v.voucher_date >= ${bind(from)}`);
    if (to) where.push(`v.voucher_date <= ${bind(to)}`);
    if (q) {
      const n = bind(likePattern(q));
      where.push(`(v.voucher_no LIKE ${n} ESCAPE '\\' OR v.reference LIKE ${n} ESCAPE '\\' OR v.remarks LIKE ${n} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM general_voucher_lines gl JOIN ledgers l ON l.id = gl.ledger_id WHERE gl.voucher_id = v.id AND (l.name LIKE ${n} ESCAPE '\\' OR gl.narration LIKE ${n} ESCAPE '\\')))`);
    }
    const clause = `FROM general_vouchers v WHERE ${where.join(" AND ")}`;
    const db = c.env.DB;
    const [rows, count] = await db.batch([
      db
        .prepare(
          `SELECT v.*, (SELECT group_concat(l.name, ', ') FROM general_voucher_lines gl JOIN ledgers l ON l.id = gl.ledger_id WHERE gl.voucher_id = v.id) AS heads
           ${clause} ORDER BY v.status <> 'draft', v.voucher_date DESC, v.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        )
        .bind(...binds),
      db.prepare(`SELECT COUNT(*) AS n ${clause}`).bind(...binds),
    ]);
    const body: ListResponse<ExpenseSummary> = {
      items: ((rows?.results ?? []) as Row[]).map(toExpenseSummary),
      total: ((count?.results?.[0] as Row | undefined)?.n as number) ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
    return c.json(body);
  })

  .get("/expenses/:id", async (c) => {
    const v = await readExpense(c.env.DB, idParam(c));
    if (!v) throw notFound("Voucher");
    return c.json(v);
  })

  // Saves a draft. Drafts don't touch the accounts until approved.
  .post("/expenses", validate("json", expenseSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const existing = await db.prepare("SELECT id FROM general_vouchers WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (existing) return c.json(await readExpense(db, existing.id));
    await checkLines(db, input.lines);
    const prep = await prepareExpense(db, input);
    const total = prep.totals.totalPaise;
    const now = Date.now();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO general_vouchers (uid, voucher_type, voucher_date, mode, reference, remarks, total_paise, created_at, updated_at, ${GST_COLUMNS})
             VALUES (?1, 'expense', ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
          )
          .bind(input.uid, input.voucherDate, input.mode, input.reference, input.remarks, total, now, ...prep.head),
        insertLines(db, "(SELECT id FROM general_vouchers WHERE uid = ?1)", input.uid, prep.lines),
        audit(c, "expense.created", { uid: input.uid, totalPaise: total, gstBill: input.gstBill, lines: input.lines.map((l) => ({ ledgerId: l.ledgerId, amountPaise: l.amountPaise, gstRateBp: l.gstRateBp })) }),
      ]);
    } catch (err) {
      if (!isUniqueViolation(err, "general_vouchers.uid")) throw err;
    }
    const created = await db.prepare("SELECT id FROM general_vouchers WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (!created) throw new Error("voucher not found after insert");
    return c.json(await readExpense(db, created.id), 201);
  })

  .put("/expenses/:id", validate("json", updateExpenseSchema), async (c) => {
    const id = idParam(c);
    const input = c.req.valid("json");
    const db = c.env.DB;
    const current = await readExpense(db, id);
    if (!current) throw notFound("Voucher");
    if (current.status !== "draft") throw new AppError(409, "NOT_DRAFT", "Only drafts can be edited.");
    if (current.updatedAt !== input.updatedAt) throw conflict();
    await checkLines(db, input.lines);
    const prep = await prepareExpense(db, input);
    const total = prep.totals.totalPaise;
    const stamp = nextStamp(current.updatedAt);
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE general_vouchers SET voucher_date = ?1, mode = ?2, reference = ?3, remarks = ?4, total_paise = ?5, updated_at = ?6,
                    gst_bill = ?9, supplier_name = ?10, supplier_gstin = ?11, supplier_invoice_no = ?12, supplier_invoice_date = ?13,
                    interstate = ?14, taxable_paise = ?15, cgst_paise = ?16, sgst_paise = ?17, igst_paise = ?18
              WHERE id = ?7 AND status = 'draft' AND updated_at = ?8`,
          )
          .bind(input.voucherDate, input.mode, input.reference, input.remarks, total, stamp, id, input.updatedAt, ...prep.head),
        guard(db, "changes() = 1"),
        clearGuards(db),
        // Draft lines are replaced; the audit row keeps what they were.
        db.prepare("DELETE FROM general_voucher_lines WHERE voucher_id = ?1").bind(id),
        insertLines(db, "?1", id, prep.lines),
        audit(c, "expense.updated", {
          id,
          before: { totalPaise: current.totalPaise, gstBill: current.gstBill, lines: current.lines.map((l) => ({ ledgerId: l.ledgerId, amountPaise: l.amountPaise, gstRateBp: l.gstRateBp })) },
          after: { totalPaise: total, gstBill: input.gstBill, lines: input.lines.map((l) => ({ ledgerId: l.ledgerId, amountPaise: l.amountPaise, gstRateBp: l.gstRateBp })) },
        }),
      ]);
    } catch (err) {
      if (isGuardFailure(err)) throw conflict();
      throw err;
    }
    return c.json(await readExpense(db, id));
  })

  // Approval posts the journal and takes the next voucher number.
  .post("/expenses/:id/approve", validate("json", approveSchema), async (c) => {
    const id = idParam(c);
    const { updatedAt } = c.req.valid("json");
    const db = c.env.DB;
    const v = await readExpense(db, id);
    if (!v) throw notFound("Voucher");
    if (v.status !== "draft") throw new AppError(409, "NOT_DRAFT", `This voucher is already ${v.status}.`);
    if (v.updatedAt !== updatedAt) throw conflict();
    await checkLines(db, v.lines);
    const journal = new JournalBuilder();
    for (const l of v.lines) journal.debit({ ledgerId: l.ledgerId }, l.amountPaise);
    journal.debit({ ledger: "input_cgst" }, v.cgstPaise).debit({ ledger: "input_sgst" }, v.sgstPaise).debit({ ledger: "input_igst" }, v.igstPaise);
    journal.credit({ ledger: v.mode === "cash" ? "cash" : "bank" }, v.totalPaise);
    const fy = financialYear(v.voucherDate);
    const series = `EXP-${fy}`;
    const uidRow = await db.prepare("SELECT uid FROM general_vouchers WHERE id = ?1").bind(id).first<{ uid: string }>();
    if (!uidRow) throw notFound("Voucher");
    const now = Date.now();
    try {
      await db.batch([
        db.prepare("INSERT INTO document_counters (series, last_no) VALUES (?1, 1) ON CONFLICT (series) DO UPDATE SET last_no = last_no + 1").bind(series),
        db
          .prepare(
            `UPDATE general_vouchers SET status = 'approved', financial_year = ?1,
                    sequence_no = (SELECT last_no FROM document_counters WHERE series = ?2),
                    voucher_no = ?1 || '/EXP/' || printf('%04d', (SELECT last_no FROM document_counters WHERE series = ?2)),
                    approved_at = ?3, updated_at = ?4
              WHERE id = ?5 AND status = 'draft' AND updated_at = ?6`,
          )
          .bind(fy, series, now, nextStamp(updatedAt), id, updatedAt),
        guard(db, "changes() = 1"),
        guard(db, LINES_VALID, id),
        clearGuards(db),
        ...journalStatements(db, { sourceType: "journal", uid: uidRow.uid, date: v.voucherDate, narration: v.remarks || `Expenses: ${v.heads}`, journal, now }),
        audit(c, "expense.approved", { id, totalPaise: v.totalPaise }),
      ]);
    } catch (err) {
      if (isGuardFailure(err)) throw new AppError(409, "CONFLICT", "This voucher or its expense heads changed. Reload and check before approving.");
      throw err;
    }
    return c.json(await readExpense(db, id));
  })

  .post("/expenses/:id/reject", validate("json", rejectSchema), async (c) => {
    const id = idParam(c);
    const { updatedAt, reason } = c.req.valid("json");
    const db = c.env.DB;
    const v = await readExpense(db, id);
    if (!v) throw notFound("Voucher");
    if (v.status !== "draft") throw new AppError(409, "NOT_DRAFT", `This voucher is already ${v.status}.`);
    const [update] = await db.batch([
      db
        .prepare("UPDATE general_vouchers SET status = 'rejected', status_reason = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'draft' AND updated_at = ?4")
        .bind(reason, nextStamp(updatedAt), id, updatedAt),
      auditIfChanged(c, "expense.rejected", { id, reason, totalPaise: v.totalPaise }),
    ]);
    if (!update?.meta.changes) throw conflict();
    return c.json(await readExpense(db, id));
  })

  .post("/expenses/:id/cancel", validate("json", cancelSchema), async (c) => {
    const id = idParam(c);
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const v = await readExpense(db, id);
    if (!v) throw notFound("Voucher");
    if (v.status !== "approved") throw new AppError(409, "NOT_APPROVED", "Only approved vouchers can be cancelled; reject a draft instead.");
    const [update] = await db.batch([
      db.prepare("UPDATE general_vouchers SET status = 'cancelled', status_reason = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'approved'").bind(reason, nextStamp(v.updatedAt), id),
      auditIfChanged(c, "expense.cancelled", { id, voucherNo: v.voucherNo, reason, totalPaise: v.totalPaise }),
      db.prepare("UPDATE journal_entries SET status = 'cancelled' WHERE source_type = 'journal' AND source_id = ?1").bind(id),
    ]);
    if (!update?.meta.changes) throw new AppError(409, "NOT_APPROVED", "This voucher is already cancelled.");
    return c.json(await readExpense(db, id));
  });
