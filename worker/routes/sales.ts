// Sales invoices and sales returns (credit notes).
//
// Concurrency: two counters may try to sell the same unit or the last piece of
// stock at the same moment. Pre-checks give friendly errors; the real guarantee
// is inside the batch: units move only `WHERE status = 'in_stock'`, then a
// batch_guards insert asserts every unit moved and no stock went negative. If
// not, the CHECK fails and the whole transaction (including the invoice number)
// rolls back.
import { Hono } from "hono";
import { computeBill, formatDate } from "../../shared/gst";
import { gstinProblem } from "../../shared/india";
import { PAGE_SIZE, type ListResponse } from "../../shared/masters";
import { cancelSchema } from "../../shared/purchase";
import {
  financialYear,
  saleListQuery,
  saleSchema,
  salesReturnSchema,
  type DocStatus,
  type SaleDetail,
  type SaleItemDetail,
  type SaleSummary,
  type SalesReturnSummary,
} from "../../shared/sales";
import { isUniqueViolation, likePattern, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { guard, isGuardFailure } from "../lib/guard";
import { JournalBuilder, journalStatements, readJournal } from "../lib/journal";
import { audit, auditIfChanged, idParam } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

/** A raw D1 result row; columns are mapped to typed API objects below. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const invalid = (message: string, field = "lines") => new AppError(400, "VALIDATION", message, { fields: { [field]: [message] } });
const stockChanged = () =>
  new AppError(409, "STOCK_CHANGED", "Stock changed while saving (another bill may have just used these items). Please check the items and save again.");
const hasReceipts = () => new AppError(409, "HAS_RECEIPTS", "Receipts are allocated to this invoice. Cancel those receipts first.");

async function shop(db: D1Database) {
  return (await db.prepare("SELECT state_code, invoice_prefix FROM shop_settings WHERE id = 1").first<{ state_code: string; invoice_prefix: string }>()) ?? {
    state_code: "33",
    invoice_prefix: "SV",
  };
}

const toReturnSummary = (r: Row): SalesReturnSummary => ({
  id: r.id,
  creditNoteNo: r.credit_note_no,
  saleId: r.sale_id,
  invoiceNo: r.invoice_no,
  billName: r.bill_name,
  returnDate: r.return_date,
  totalPaise: r.total_paise,
  reason: r.reason,
  status: r.status,
});

async function readSale(db: D1Database, id: number): Promise<SaleDetail | null> {
  const [head, items, returned, returns] = await db.batch([
    db.prepare("SELECT s.*, p.name AS customer_name, p.is_counter FROM sales s JOIN parties p ON p.id = s.customer_id WHERE s.id = ?1").bind(id),
    db
      .prepare(
        `SELECT si.*, p.name AS product_name, p.brand, p.unit, p.tracks_serial
           FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?1 ORDER BY si.line_no`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT ri.sale_item_id, ri.quantity, ri.serials FROM sales_return_items ri
           JOIN sales_returns r ON r.id = ri.sales_return_id
          WHERE r.status = 'posted' AND r.sale_id = ?1`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT r.*, s.invoice_no, s.bill_name FROM sales_returns r JOIN sales s ON s.id = r.sale_id WHERE r.sale_id = ?1 ORDER BY r.id`,
      )
      .bind(id),
  ]);
  const s = head?.results[0] as Row | undefined;
  if (!s) return null;
  const returnedRows = (returned?.results ?? []) as Row[];
  const itemList: SaleItemDetail[] = ((items?.results ?? []) as Row[]).map((r) => {
    const mine = returnedRows.filter((x) => x.sale_item_id === r.id);
    return {
      id: r.id,
      lineNo: r.line_no,
      productId: r.product_id,
      productName: r.product_name,
      brand: r.brand,
      unit: r.unit,
      hsnCode: r.hsn_code,
      tracksSerial: r.tracks_serial === 1,
      quantity: r.quantity,
      ratePaise: r.rate_paise,
      mrpPaise: r.mrp_paise,
      gstRateBp: r.gst_rate_bp,
      taxablePaise: r.taxable_paise,
      cgstPaise: r.cgst_paise,
      sgstPaise: r.sgst_paise,
      igstPaise: r.igst_paise,
      totalPaise: r.total_paise,
      serials: JSON.parse(r.serials) as string[],
      returnedQuantity: mine.reduce((a, x) => a + (x.quantity as number), 0),
      returnedSerials: mine.flatMap((x) => JSON.parse(x.serials) as string[]),
    };
  });
  return {
    id: s.id,
    invoiceNo: s.invoice_no,
    invoiceDate: s.invoice_date,
    dueDate: s.due_date,
    collectionType: s.collection_type,
    salesman: s.salesman,
    customer: { id: s.customer_id, name: s.customer_name, isCounter: s.is_counter === 1 },
    bill: { name: s.bill_name, phone: s.bill_phone, gstin: s.bill_gstin, address: s.bill_address, stateCode: s.bill_state_code },
    isInterstate: s.is_interstate === 1,
    taxablePaise: s.taxable_paise,
    cgstPaise: s.cgst_paise,
    sgstPaise: s.sgst_paise,
    igstPaise: s.igst_paise,
    roundOffPaise: s.round_off_paise,
    totalPaise: s.total_paise,
    remarks: s.remarks,
    status: s.status,
    cancelReason: s.cancel_reason,
    items: itemList,
    journal: await readJournal(db, "sale", s.id),
    returns: ((returns?.results ?? []) as Row[]).map(toReturnSummary),
  };
}

export const salesRoutes = new Hono<AppEnv>();
for (const path of ["/sales", "/sales/*", "/sales-returns", "/sales-returns/*"]) salesRoutes.use(path, requireAuth);

salesRoutes
  .get("/sales", validate("query", saleListQuery), async (c) => {
    const { q, status, customerId, from, to, page } = c.req.valid("query");
    const where: string[] = [];
    const binds: unknown[] = [];
    const bind = (v: unknown) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    if (status !== "all") where.push(`status = ${bind(status)}`);
    if (customerId) where.push(`customer_id = ${bind(customerId)}`);
    if (from) where.push(`invoice_date >= ${bind(from)}`);
    if (to) where.push(`invoice_date <= ${bind(to)}`);
    if (q) {
      const n = bind(likePattern(q));
      where.push(`(bill_name LIKE ${n} ESCAPE '\\' OR invoice_no LIKE ${n} ESCAPE '\\' OR bill_phone LIKE ${n} ESCAPE '\\')`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const db = c.env.DB;
    const [rows, count] = await db.batch([
      db
        .prepare(
          `SELECT id, invoice_no, invoice_date, customer_id, bill_name, collection_type, total_paise, status FROM sales ${clause}
            ORDER BY invoice_date DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        )
        .bind(...binds),
      db.prepare(`SELECT COUNT(*) AS n FROM sales ${clause}`).bind(...binds),
    ]);
    const items: SaleSummary[] = ((rows?.results ?? []) as Row[]).map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      invoiceDate: r.invoice_date,
      customerId: r.customer_id,
      billName: r.bill_name,
      collectionType: r.collection_type,
      totalPaise: r.total_paise,
      status: r.status as DocStatus,
    }));
    const total = (count?.results[0] as { n: number } | undefined)?.n ?? 0;
    return c.json({ items, total, page, pageSize: PAGE_SIZE } satisfies ListResponse<SaleSummary>);
  })

  .get("/sales/:id", async (c) => {
    const sale = await readSale(c.env.DB, idParam(c));
    if (!sale) throw notFound("Invoice");
    return c.json(sale);
  })

  .post("/sales", validate("json", saleSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const existing = await db.prepare("SELECT id FROM sales WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (existing) return c.json(await readSale(db, existing.id), 200);

    const customer = await db
      .prepare("SELECT id, name, party_type, gstin, address, city, state_code, phone, is_active, is_counter FROM parties WHERE id = ?1")
      .bind(input.customerId)
      .first<Row>();
    if (!customer || customer.is_active !== 1 || customer.party_type === "supplier") throw invalid("Choose an active customer", "customerId");
    const isCounter = customer.is_counter === 1;
    if (isCounter && input.collectionType !== "immediate") throw invalid("Counter sales must be paid immediately", "collectionType");
    if (isCounter && input.billGstin && gstinProblem(input.billGstin)) throw invalid(gstinProblem(input.billGstin) ?? "", "billGstin");

    const settings = await shop(db);
    const billStateCode = isCounter ? input.billStateCode || settings.state_code : customer.state_code;
    if (isCounter && input.billGstin && input.billGstin.slice(0, 2) !== billStateCode) throw invalid("State must match the GSTIN", "billStateCode");
    const bill = {
      name: isCounter ? input.billName || "Cash Customer" : customer.name,
      phone: isCounter ? input.billPhone : customer.phone,
      gstin: isCounter ? input.billGstin || null : customer.gstin,
      address: isCounter ? "" : [customer.address, customer.city].filter(Boolean).join(", "),
      stateCode: billStateCode,
    };

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const { results: productRows } = await db
      .prepare(
        `SELECT p.id, p.name, p.tracks_serial, p.is_active, p.mrp_paise, p.hsn_code, g.rate_bp,
                CASE WHEN p.tracks_serial = 1
                  THEN (SELECT COUNT(*) FROM product_units u WHERE u.product_id = p.id AND u.status = 'in_stock')
                  ELSE (SELECT COALESCE(SUM(m.qty_delta), 0) FROM stock_movements m WHERE m.product_id = p.id AND m.is_void = 0)
                END AS stock
           FROM products p JOIN gst_slabs g ON g.id = p.gst_slab_id WHERE p.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(productIds))
      .all<Row>();
    const products = new Map(productRows.map((p) => [p.id as number, p]));

    const allSerials = input.lines.flatMap((l) => l.serials);
    const { results: unitRows } = allSerials.length
      ? await db
          .prepare("SELECT serial, product_id, status FROM product_units WHERE status <> 'void' AND serial IN (SELECT value FROM json_each(?1))")
          .bind(JSON.stringify(allSerials))
          .all<Row>()
      : { results: [] as Row[] };
    const units = new Map(unitRows.map((u) => [u.serial as string, u]));

    const qtyByProduct = new Map<number, number>();
    for (const [i, line] of input.lines.entries()) {
      const p = products.get(line.productId);
      if (!p || p.is_active !== 1) throw invalid(`Line ${i + 1}: product is missing or inactive`);
      if (line.ratePaise > p.mrp_paise) throw invalid(`Line ${i + 1} (${p.name}): rate is above MRP ₹${(p.mrp_paise / 100).toFixed(2)}`);
      if (p.tracks_serial === 1) {
        if (line.serials.length !== line.quantity) throw invalid(`Line ${i + 1} (${p.name}): scan ${line.quantity} serial number(s)`);
        for (const sn of line.serials) {
          const u = units.get(sn);
          if (!u) throw invalid(`${sn} is not in stock (never purchased)`);
          if (u.product_id !== p.id) throw invalid(`${sn} belongs to a different product`);
          if (u.status !== "in_stock") throw invalid(`${sn} is not in stock (${String(u.status).replace(/_/g, " ")})`);
        }
      } else {
        if (line.serials.length) throw invalid(`Line ${i + 1} (${p.name}) does not track serial numbers`);
        qtyByProduct.set(p.id, (qtyByProduct.get(p.id) ?? 0) + line.quantity);
      }
    }
    for (const [pid, qty] of qtyByProduct) {
      const p = products.get(pid) as Row;
      if (p.stock < qty) throw invalid(`${p.name}: only ${p.stock} in stock`);
    }

    const interstate = bill.stateCode !== settings.state_code;
    const lineInputs = input.lines.map((l) => ({ quantity: l.quantity, ratePaise: l.ratePaise, gstRateBp: (products.get(l.productId) as Row).rate_bp as number }));
    const totals = computeBill(lineInputs, { interstate, ratesIncludeGst: true });
    const items = input.lines.map((l, i) => {
      const p = products.get(l.productId) as Row;
      return { line: i + 1, productId: l.productId, quantity: l.quantity, rate: l.ratePaise, mrp: p.mrp_paise, bp: p.rate_bp, hsn: p.hsn_code, serials: JSON.stringify(l.serials), ...totals.lines[i] };
    });
    const unitLinks = input.lines.flatMap((l, i) => l.serials.map((serial) => ({ line: i + 1, serial })));

    const journal = new JournalBuilder()
      .debit({ partyId: customer.id }, totals.totalPaise)
      .credit({ ledger: "sales" }, totals.taxablePaise)
      .credit({ ledger: "output_cgst" }, totals.cgstPaise)
      .credit({ ledger: "output_sgst" }, totals.sgstPaise)
      .credit({ ledger: "output_igst" }, totals.igstPaise)
      .signed({ ledger: "round_off" }, -totals.roundOffPaise);
    if (input.collectionType === "immediate") {
      journal.debit({ ledger: "cash" }, totals.totalPaise).credit({ partyId: customer.id }, totals.totalPaise);
    }

    const fy = financialYear(input.invoiceDate);
    const series = `INV-${fy}`;
    const now = Date.now();
    const sid = "(SELECT id FROM sales WHERE uid = ?1)";
    try {
      await db.batch([
        db.prepare("INSERT INTO document_counters (series, last_no) VALUES (?1, 1) ON CONFLICT (series) DO UPDATE SET last_no = last_no + 1").bind(series),
        db
          .prepare(
            `INSERT INTO sales (uid, invoice_no, financial_year, sequence_no, customer_id, bill_name, bill_phone, bill_gstin, bill_address,
               bill_state_code, invoice_date, collection_type, due_date, salesman, is_interstate, taxable_paise, cgst_paise, sgst_paise,
               igst_paise, round_off_paise, total_paise, remarks, created_at, updated_at)
             SELECT ?1, ?2 || '/' || ?3 || '/' || printf('%04d', c.last_no), ?2, c.last_no, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?22
               FROM document_counters c WHERE c.series = ?23`,
          )
          .bind(input.uid, fy, settings.invoice_prefix, customer.id, bill.name, bill.phone, bill.gstin, bill.address, bill.stateCode,
            input.invoiceDate, input.collectionType, input.collectionType === "immediate" ? input.invoiceDate : input.dueDate, input.salesman,
            interstate ? 1 : 0, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise, totals.roundOffPaise,
            totals.totalPaise, input.remarks, now, series),
        db
          .prepare(
            `INSERT INTO sale_items (sale_id, line_no, product_id, quantity, rate_paise, mrp_paise, gst_rate_bp, hsn_code,
               taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, serials)
             SELECT ${sid}, j.value ->> '$.line', j.value ->> '$.productId', j.value ->> '$.quantity', j.value ->> '$.rate', j.value ->> '$.mrp',
                    j.value ->> '$.bp', j.value ->> '$.hsn', j.value ->> '$.taxablePaise', j.value ->> '$.cgstPaise', j.value ->> '$.sgstPaise',
                    j.value ->> '$.igstPaise', j.value ->> '$.totalPaise', j.value ->> '$.serials'
               FROM json_each(?2) j`,
          )
          .bind(input.uid, JSON.stringify(items)),
        db
          .prepare(
            `UPDATE product_units
                SET status = 'sold', updated_at = ?3, sales_return_id = NULL,
                    sale_item_id = (SELECT si.id FROM json_each(?2) j JOIN sale_items si ON si.sale_id = ${sid} AND si.line_no = j.value ->> '$.line'
                                     WHERE j.value ->> '$.serial' = product_units.serial)
              WHERE status = 'in_stock' AND serial IN (SELECT value ->> '$.serial' FROM json_each(?2))`,
          )
          .bind(input.uid, JSON.stringify(unitLinks), now),
        // Every scanned unit must now belong to this sale (none sold by someone else meanwhile).
        guard(db, `(SELECT COUNT(*) FROM product_units WHERE status = 'sold' AND sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ${sid.replace("?1", "?2")})) = ?1`, unitLinks.length, input.uid),
        db
          .prepare(
            `INSERT INTO stock_movements (product_id, qty_delta, source_type, source_id, created_at)
             SELECT product_id, -quantity, 'sale', sale_id, ?2 FROM sale_items WHERE sale_id = ${sid}`,
          )
          .bind(input.uid, now),
        // No quantity-tracked product may go below zero.
        guard(
          db,
          `NOT EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
                        WHERE si.sale_id = ${sid} AND p.tracks_serial = 0
                          AND (SELECT SUM(m.qty_delta) FROM stock_movements m WHERE m.product_id = si.product_id AND m.is_void = 0) < 0)`,
          input.uid,
        ),
        db.prepare("DELETE FROM batch_guards"),
        ...journalStatements(db, {
          sourceType: "sale",
          uid: input.uid,
          date: input.invoiceDate,
          narration: `Sale to ${bill.name}${input.collectionType === "immediate" ? " (paid)" : ""}`,
          journal,
          now,
        }),
        audit(c, "sale.created", { uid: input.uid, customerId: customer.id, totalPaise: totals.totalPaise, serials: allSerials }),
      ]);
    } catch (err) {
      if (isUniqueViolation(err, "sales.uid")) {
        const row = await db.prepare("SELECT id FROM sales WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
        if (row) return c.json(await readSale(db, row.id), 200);
      }
      if (isGuardFailure(err)) throw stockChanged();
      throw err;
    }
    const created = await db.prepare("SELECT id FROM sales WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    return c.json(await readSale(db, (created as { id: number }).id), 201);
  })

  .post("/sales/:id/cancel", validate("json", cancelSchema), async (c) => {
    const id = idParam(c);
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const sale = await readSale(db, id);
    if (!sale) throw notFound("Invoice");
    if (sale.status !== "posted") throw new AppError(409, "ALREADY_CANCELLED", "This invoice is already cancelled.");
    if (sale.returns.some((r) => r.status === "posted")) throw new AppError(409, "HAS_RETURNS", "Cancel the sales returns of this invoice first.");
    const serials = sale.items.flatMap((i) => i.serials);
    const now = Date.now();
    const settled = "EXISTS (SELECT 1 FROM voucher_allocations a JOIN money_vouchers v ON v.id = a.voucher_id WHERE v.status = 'posted' AND a.target_type = 'sale' AND a.target_id = ?1)";
    const isSettled = async () => Boolean((await db.prepare(`SELECT ${settled} AS x`).bind(id).first<{ x: number }>())?.x);
    if (await isSettled()) throw hasReceipts();
    try {
      const [, update] = await db.batch([
        guard(db, `NOT ${settled}`, id),
        db.prepare("UPDATE sales SET status = 'cancelled', cancel_reason = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'posted'").bind(reason, now, id),
        auditIfChanged(c, "sale.cancelled", { id, invoiceNo: sale.invoiceNo, reason, totalPaise: sale.totalPaise }),
        db
          .prepare(
            `UPDATE product_units SET status = 'in_stock', sale_item_id = NULL, updated_at = ?1
              WHERE status = 'sold' AND sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?2)`,
          )
          .bind(now, id),
        // Every unit of this invoice must have come back to stock.
        guard(db, `(SELECT COUNT(*) FROM product_units WHERE status = 'in_stock' AND serial IN (SELECT value FROM json_each(?2))) = ?1`, serials.length, JSON.stringify(serials)),
        db.prepare("DELETE FROM batch_guards"),
        db.prepare("UPDATE stock_movements SET is_void = 1 WHERE source_type = 'sale' AND source_id = ?1").bind(id),
        db.prepare("UPDATE journal_entries SET status = 'cancelled' WHERE source_type = 'sale' AND source_id = ?1").bind(id),
      ]);
      if (!update?.meta.changes) throw new AppError(409, "ALREADY_CANCELLED", "This invoice is already cancelled.");
    } catch (err) {
      if (isGuardFailure(err)) {
        if (await isSettled()) throw hasReceipts();
        throw new AppError(409, "UNITS_MOVED", "Some units of this invoice are no longer marked as sold. Reload and check.");
      }
      throw err;
    }
    return c.json(await readSale(db, id));
  })

  // ── Sales returns (credit notes) ───────────────────────────────────────────

  .get("/sales-returns", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT r.*, s.invoice_no, s.bill_name FROM sales_returns r JOIN sales s ON s.id = r.sale_id ORDER BY r.return_date DESC, r.id DESC LIMIT 200`,
    ).all<Row>();
    return c.json({ items: results.map(toReturnSummary) });
  })

  .post("/sales-returns", validate("json", salesReturnSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const existing = await db.prepare("SELECT id FROM sales_returns WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (existing) return c.json({ id: existing.id }, 200);

    const sale = await readSale(db, input.saleId);
    if (!sale) throw notFound("Invoice");
    if (sale.status !== "posted") throw invalid("This invoice is cancelled");
    if (input.returnDate < sale.invoiceDate) throw invalid("Return date cannot be before the invoice date", "returnDate");

    const byId = new Map(sale.items.map((i) => [i.id, i]));
    const allSerials = input.lines.flatMap((l) => l.serials);
    const { results: unitRows } = allSerials.length
      ? await db.prepare("SELECT serial, status, sale_item_id FROM product_units WHERE status <> 'void' AND serial IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(allSerials)).all<Row>()
      : { results: [] as Row[] };
    const units = new Map(unitRows.map((u) => [u.serial as string, u]));
    const seen = new Set<number>();
    const lineInputs: { quantity: number; ratePaise: number; gstRateBp: number }[] = [];
    for (const line of input.lines) {
      const item = byId.get(line.saleItemId);
      if (!item) throw invalid("An item does not belong to this invoice");
      if (seen.has(item.id)) throw invalid(`${item.productName} is listed twice`);
      seen.add(item.id);
      const left = item.quantity - item.returnedQuantity;
      if (line.quantity > left) throw invalid(`${item.productName}: only ${left} left to return from this invoice`);
      if (item.tracksSerial) {
        if (line.serials.length !== line.quantity) throw invalid(`${item.productName}: choose ${line.quantity} serial number(s)`);
        for (const sn of line.serials) {
          const u = units.get(sn);
          if (!item.serials.includes(sn) || item.returnedSerials.includes(sn) || !u || u.status !== "sold" || u.sale_item_id !== item.id) {
            throw invalid(`${sn} was not sold on this invoice or is already returned`);
          }
        }
      } else if (line.serials.length) throw invalid(`${item.productName} does not track serial numbers`);
      lineInputs.push({ quantity: line.quantity, ratePaise: item.ratePaise, gstRateBp: item.gstRateBp });
    }

    const totals = computeBill(lineInputs, { interstate: sale.isInterstate, ratesIncludeGst: true });
    const lines = input.lines.map((l, i) => ({ saleItemId: l.saleItemId, quantity: l.quantity, serials: JSON.stringify(l.serials), ...totals.lines[i] }));
    const movements = input.lines.map((l) => ({ productId: byId.get(l.saleItemId)?.productId, quantity: l.quantity }));
    const journal = new JournalBuilder()
      .debit({ ledger: "sales_return" }, totals.taxablePaise)
      .debit({ ledger: "output_cgst" }, totals.cgstPaise)
      .debit({ ledger: "output_sgst" }, totals.sgstPaise)
      .debit({ ledger: "output_igst" }, totals.igstPaise)
      .signed({ ledger: "round_off" }, totals.roundOffPaise)
      .credit({ partyId: sale.customer.id }, totals.totalPaise);

    const fy = financialYear(input.returnDate);
    const series = `CN-${fy}`;
    const now = Date.now();
    const rid = "(SELECT id FROM sales_returns WHERE uid = ?1)";
    try {
      await db.batch([
        db.prepare("INSERT INTO document_counters (series, last_no) VALUES (?1, 1) ON CONFLICT (series) DO UPDATE SET last_no = last_no + 1").bind(series),
        db
          .prepare(
            `INSERT INTO sales_returns (uid, credit_note_no, sale_id, return_date, taxable_paise, cgst_paise, sgst_paise, igst_paise,
               round_off_paise, total_paise, reason, created_at)
             SELECT ?1, 'CN/' || ?2 || '/' || printf('%04d', c.last_no), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
               FROM document_counters c WHERE c.series = ?13`,
          )
          .bind(input.uid, fy, sale.id, input.returnDate, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise,
            totals.roundOffPaise, totals.totalPaise, input.reason, now, series),
        db
          .prepare(
            `INSERT INTO sales_return_items (sales_return_id, sale_item_id, quantity, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, serials)
             SELECT ${rid}, j.value ->> '$.saleItemId', j.value ->> '$.quantity', j.value ->> '$.taxablePaise', j.value ->> '$.cgstPaise',
                    j.value ->> '$.sgstPaise', j.value ->> '$.igstPaise', j.value ->> '$.totalPaise', j.value ->> '$.serials'
               FROM json_each(?2) j`,
          )
          .bind(input.uid, JSON.stringify(lines)),
        db
          .prepare(
            `UPDATE product_units SET status = 'in_stock', sales_return_id = ${rid}, updated_at = ?3
              WHERE status = 'sold' AND serial IN (SELECT value FROM json_each(?2))`,
          )
          .bind(input.uid, JSON.stringify(allSerials), now),
        guard(db, `(SELECT COUNT(*) FROM product_units WHERE sales_return_id = ${rid.replace("?1", "?2")} AND status = 'in_stock') = ?1`, allSerials.length, input.uid),
        db.prepare("DELETE FROM batch_guards"),
        db
          .prepare(
            `INSERT INTO stock_movements (product_id, qty_delta, source_type, source_id, created_at)
             SELECT j.value ->> '$.productId', j.value ->> '$.quantity', 'sales_return', ${rid}, ?3 FROM json_each(?2) j`,
          )
          .bind(input.uid, JSON.stringify(movements), now),
        ...journalStatements(db, {
          sourceType: "sales_return",
          uid: input.uid,
          date: input.returnDate,
          narration: `Sales return from ${sale.bill.name} against ${sale.invoiceNo} dated ${formatDate(sale.invoiceDate)}`,
          journal,
          now,
        }),
        audit(c, "sales_return.created", { uid: input.uid, saleId: sale.id, totalPaise: totals.totalPaise, serials: allSerials }),
      ]);
    } catch (err) {
      if (isGuardFailure(err)) throw stockChanged();
      throw err;
    }
    const created = await db.prepare("SELECT id FROM sales_returns WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    return c.json({ id: created?.id }, 201);
  })

  .post("/sales-returns/:id/cancel", validate("json", cancelSchema), async (c) => {
    const id = idParam(c);
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const ret = await db.prepare("SELECT id, status FROM sales_returns WHERE id = ?1").bind(id).first<{ id: number; status: string }>();
    if (!ret) throw notFound("Sales return");
    if (ret.status !== "posted") throw new AppError(409, "ALREADY_CANCELLED", "This return is already cancelled.");
    const { results: items } = await db
      .prepare(
        `SELECT ri.quantity, ri.serials, si.product_id, p.tracks_serial FROM sales_return_items ri
           JOIN sale_items si ON si.id = ri.sale_item_id JOIN products p ON p.id = si.product_id WHERE ri.sales_return_id = ?1`,
      )
      .bind(id)
      .all<Row>();
    const serials = items.flatMap((i) => JSON.parse(i.serials) as string[]);
    const now = Date.now();
    try {
      const [update] = await db.batch([
        db.prepare("UPDATE sales_returns SET status = 'cancelled', cancel_reason = ?1 WHERE id = ?2 AND status = 'posted'").bind(reason, id),
        auditIfChanged(c, "sales_return.cancelled", { id, reason }),
        // Every returned unit must still be in stock from this return (not resold).
        guard(db, `(SELECT COUNT(*) FROM product_units WHERE sales_return_id = ?2 AND status = 'in_stock' AND serial IN (SELECT value FROM json_each(?3))) = ?1`, serials.length, id, JSON.stringify(serials)),
        db.prepare("UPDATE product_units SET status = 'sold', sales_return_id = NULL, updated_at = ?1 WHERE sales_return_id = ?2 AND status = 'in_stock'").bind(now, id),
        guard(db, `(SELECT COUNT(*) FROM product_units WHERE status = 'sold' AND serial IN (SELECT value FROM json_each(?2))) = ?1`, serials.length, JSON.stringify(serials)),
        db.prepare("UPDATE stock_movements SET is_void = 1 WHERE source_type = 'sales_return' AND source_id = ?1").bind(id),
        guard(
          db,
          `NOT EXISTS (SELECT 1 FROM sales_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id JOIN products p ON p.id = si.product_id
                        WHERE ri.sales_return_id = ?1 AND p.tracks_serial = 0
                          AND (SELECT SUM(m.qty_delta) FROM stock_movements m WHERE m.product_id = si.product_id AND m.is_void = 0) < 0)`,
          id,
        ),
        db.prepare("DELETE FROM batch_guards"),
        db.prepare("UPDATE journal_entries SET status = 'cancelled' WHERE source_type = 'sales_return' AND source_id = ?1").bind(id),
      ]);
      if (!update?.meta.changes) throw new AppError(409, "ALREADY_CANCELLED", "This return is already cancelled.");
    } catch (err) {
      if (isGuardFailure(err)) throw new AppError(409, "UNITS_MOVED", "Can't cancel: the returned items have already been sold again.");
      throw err;
    }
    return c.body(null, 204);
  });
