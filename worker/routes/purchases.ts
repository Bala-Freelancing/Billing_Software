// Purchases, opening stock and purchase returns.
//
// Each save is ONE D1 batch (one transaction) built from a handful of
// statements; line items, serial units, stock movements and journal lines are
// inserted with json_each() so a 50-serial bill is still ~7 statements (the
// free plan allows 50 queries per request).
import { Hono } from "hono";
import { computeBill, formatDate } from "../../shared/gst";
import { PAGE_SIZE, type ListResponse } from "../../shared/masters";
import {
  cancelSchema,
  openingStockSchema,
  purchaseListQuery,
  purchaseReturnSchema,
  purchaseSchema,
  type DocStatus,
  type OpeningStockEntry,
  type PurchaseDetail,
  type PurchaseItemDetail,
  type PurchaseReturnSummary,
  type PurchaseSummary,
} from "../../shared/purchase";
import { isUniqueViolation, likePattern, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { clearGuards, guard, isGuardFailure } from "../lib/guard";
import { JournalBuilder, journalStatements, readJournal } from "../lib/journal";
import { audit, auditIfChanged, idParam, type Ctx } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

/** A raw D1 result row; columns are mapped to typed API objects below. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const invalid = (message: string, field = "lines") => new AppError(400, "VALIDATION", message, { fields: { [field]: [message] } });

interface ProductInfo {
  id: number;
  name: string;
  tracks_serial: number;
  is_active: number;
  rate_bp: number;
}

async function loadProducts(db: D1Database, ids: number[]): Promise<Map<number, ProductInfo>> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.tracks_serial, p.is_active, g.rate_bp
         FROM products p JOIN gst_slabs g ON g.id = p.gst_slab_id
        WHERE p.id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify([...new Set(ids)]))
    .all<ProductInfo>();
  return new Map(results.map((p) => [p.id, p]));
}

/** Serials from the list that already exist as live units (in stock, sold, returned…). */
async function existingSerials(db: D1Database, serials: string[]): Promise<string[]> {
  if (!serials.length) return [];
  const { results } = await db
    .prepare("SELECT serial FROM product_units WHERE status <> 'void' AND serial IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(serials))
    .all<{ serial: string }>();
  return results.map((r) => r.serial);
}

function duplicateSerialError(serials: string[]): AppError {
  const list = serials.slice(0, 10).join(", ") + (serials.length > 10 ? ` and ${serials.length - 10} more` : "");
  return new AppError(409, "DUPLICATE_SERIAL", `Already in the system: ${list}`, { fields: { lines: [`Serial already exists: ${list}`] } });
}

async function shopStateCode(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT state_code FROM shop_settings WHERE id = 1").first<{ state_code: string }>();
  return row?.state_code ?? "33";
}

/** Product stock: serial units in stock, or the sum of quantity movements. */
async function stockOf(db: D1Database, productId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN p.tracks_serial = 1
                THEN (SELECT COUNT(*) FROM product_units u WHERE u.product_id = p.id AND u.status = 'in_stock')
                ELSE (SELECT COALESCE(SUM(m.qty_delta), 0) FROM stock_movements m WHERE m.product_id = p.id AND m.is_void = 0)
              END AS stock
         FROM products p WHERE p.id = ?1`,
    )
    .bind(productId)
    .first<{ stock: number }>();
  return row?.stock ?? 0;
}

// ── Reading purchases ────────────────────────────────────────────────────────

interface PurchaseRow {
  id: number;
  uid: string;
  supplier_id: number;
  supplier_name: string;
  supplier_gstin: string | null;
  supplier_state: string;
  supplier_invoice_no: string;
  invoice_date: string;
  is_interstate: number;
  rates_include_gst: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  notes: string;
  status: DocStatus;
  cancel_reason: string | null;
}

async function readPurchase(db: D1Database, id: number): Promise<PurchaseDetail | null> {
  const [head, items, units, returns] = await db.batch([
    db
      .prepare(
        `SELECT pu.*, pa.name AS supplier_name, pa.gstin AS supplier_gstin, pa.state_code AS supplier_state
           FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id WHERE pu.id = ?1`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT pi.*, p.name AS product_name, p.brand, p.hsn_code, p.unit, p.tracks_serial,
                COALESCE((SELECT SUM(ri.quantity) FROM purchase_return_items ri
                            JOIN purchase_returns r ON r.id = ri.purchase_return_id
                           WHERE ri.purchase_item_id = pi.id AND r.status = 'posted'), 0) AS returned_quantity
           FROM purchase_items pi JOIN products p ON p.id = pi.product_id
          WHERE pi.purchase_id = ?1 ORDER BY pi.line_no`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT u.id, u.serial, u.status, u.purchase_item_id FROM product_units u
          WHERE u.purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id = ?1) ORDER BY u.id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT r.id, r.purchase_id, r.return_date, r.total_paise, r.reason, r.status, pa.name AS supplier_name, pu.supplier_invoice_no
           FROM purchase_returns r JOIN purchases pu ON pu.id = r.purchase_id JOIN parties pa ON pa.id = pu.supplier_id
          WHERE r.purchase_id = ?1 ORDER BY r.id`,
      )
      .bind(id),
  ]);
  const p = head?.results[0] as PurchaseRow | undefined;
  if (!p) return null;

  const unitRows = (units?.results ?? []) as { id: number; serial: string; status: string; purchase_item_id: number }[];
  const itemRows = (items?.results ?? []) as Row[];
  const detailItems: PurchaseItemDetail[] = itemRows.map((r) => ({
    id: r.id,
    lineNo: r.line_no,
    productId: r.product_id,
    productName: r.product_name,
    brand: r.brand,
    hsnCode: r.hsn_code,
    unit: r.unit,
    tracksSerial: r.tracks_serial === 1,
    quantity: r.quantity,
    ratePaise: r.rate_paise,
    gstRateBp: r.gst_rate_bp,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    totalPaise: r.total_paise,
    returnedQuantity: r.returned_quantity,
    units: unitRows.filter((u) => u.purchase_item_id === r.id).map((u) => ({ id: u.id, serial: u.serial, status: u.status })),
  }));

  return {
    id: p.id,
    uid: p.uid,
    supplier: { id: p.supplier_id, name: p.supplier_name, gstin: p.supplier_gstin, stateCode: p.supplier_state },
    supplierInvoiceNo: p.supplier_invoice_no,
    invoiceDate: p.invoice_date,
    isInterstate: p.is_interstate === 1,
    ratesIncludeGst: p.rates_include_gst === 1,
    taxablePaise: p.taxable_paise,
    cgstPaise: p.cgst_paise,
    sgstPaise: p.sgst_paise,
    igstPaise: p.igst_paise,
    roundOffPaise: p.round_off_paise,
    totalPaise: p.total_paise,
    notes: p.notes,
    status: p.status,
    cancelReason: p.cancel_reason,
    items: detailItems,
    journal: await readJournal(db, "purchase", p.id),
    returns: ((returns?.results ?? []) as Row[]).map(toReturnSummary),
  };
}

const toReturnSummary = (r: Row): PurchaseReturnSummary => ({
  id: r.id,
  purchaseId: r.purchase_id,
  supplierName: r.supplier_name,
  supplierInvoiceNo: r.supplier_invoice_no,
  returnDate: r.return_date,
  totalPaise: r.total_paise,
  reason: r.reason,
  status: r.status as DocStatus,
});

// ── Routes ───────────────────────────────────────────────────────────────────

export const purchaseRoutes = new Hono<AppEnv>();
for (const path of ["/purchases", "/purchases/*", "/purchase-returns", "/purchase-returns/*", "/opening-stock", "/opening-stock/*"]) {
  purchaseRoutes.use(path, requireAuth);
}

purchaseRoutes
  .get("/purchases", validate("query", purchaseListQuery), async (c) => {
    const { q, status, from, to, page } = c.req.valid("query");
    const where: string[] = [];
    const binds: unknown[] = [];
    const bind = (v: unknown) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    if (status !== "all") where.push(`pu.status = ${bind(status)}`);
    if (from) where.push(`pu.invoice_date >= ${bind(from)}`);
    if (to) where.push(`pu.invoice_date <= ${bind(to)}`);
    if (q) {
      const n = bind(likePattern(q));
      where.push(`(pa.name LIKE ${n} ESCAPE '\\' OR pu.supplier_invoice_no LIKE ${n} ESCAPE '\\')`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const db = c.env.DB;
    const [rows, count] = await db.batch([
      db
        .prepare(
          `SELECT pu.id, pu.supplier_id, pa.name AS supplier_name, pu.supplier_invoice_no, pu.invoice_date, pu.total_paise, pu.status,
                  (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS item_count
             FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id ${clause}
            ORDER BY pu.invoice_date DESC, pu.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        )
        .bind(...binds),
      db.prepare(`SELECT COUNT(*) AS n FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id ${clause}`).bind(...binds),
    ]);
    const items: PurchaseSummary[] = ((rows?.results ?? []) as Row[]).map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierInvoiceNo: r.supplier_invoice_no,
      invoiceDate: r.invoice_date,
      totalPaise: r.total_paise,
      status: r.status as DocStatus,
      itemCount: r.item_count,
    }));
    const total = (count?.results[0] as { n: number } | undefined)?.n ?? 0;
    return c.json({ items, total, page, pageSize: PAGE_SIZE } satisfies ListResponse<PurchaseSummary>);
  })

  .get("/purchases/:id", async (c) => {
    const detail = await readPurchase(c.env.DB, idParam(c));
    if (!detail) throw notFound("Purchase");
    return c.json(detail);
  })

  .post("/purchases", validate("json", purchaseSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;

    // Idempotency: the same form submitted twice returns the first result.
    const already = await db.prepare("SELECT id FROM purchases WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (already) return c.json(await readPurchase(db, already.id), 200);

    const supplier = await db
      .prepare("SELECT id, name, state_code, party_type, is_active FROM parties WHERE id = ?1")
      .bind(input.supplierId)
      .first<{ id: number; name: string; state_code: string; party_type: string; is_active: number }>();
    if (!supplier || supplier.is_active !== 1 || supplier.party_type === "customer") {
      throw invalid("Choose an active supplier", "supplierId");
    }

    const products = await loadProducts(db, input.lines.map((l) => l.productId));
    for (const [i, line] of input.lines.entries()) {
      const p = products.get(line.productId);
      if (!p || p.is_active !== 1) throw invalid(`Line ${i + 1}: product is missing or inactive`);
      if (p.tracks_serial === 1 && line.serials.length !== line.quantity) {
        throw invalid(`Line ${i + 1} (${p.name}): scan ${line.quantity} serial number(s); ${line.serials.length} entered`);
      }
      if (p.tracks_serial !== 1 && line.serials.length) throw invalid(`Line ${i + 1} (${p.name}) does not track serial numbers`);
    }

    const allSerials = input.lines.flatMap((l) => l.serials);
    const clashes = await existingSerials(db, allSerials);
    if (clashes.length) throw duplicateSerialError(clashes);

    const interstate = supplier.state_code !== (await shopStateCode(db));
    const lineInputs = input.lines.map((l) => ({
      quantity: l.quantity,
      ratePaise: l.ratePaise,
      gstRateBp: (products.get(l.productId) as ProductInfo).rate_bp,
    }));
    const bill = computeBill(lineInputs, { interstate, ratesIncludeGst: input.ratesIncludeGst });

    const items = input.lines.map((l, i) => ({
      line: i + 1,
      productId: l.productId,
      quantity: l.quantity,
      rate: l.ratePaise,
      bp: lineInputs[i]?.gstRateBp,
      ...bill.lines[i],
    }));
    const units = input.lines.flatMap((l, i) => {
      const taxable = bill.lines[i]?.taxablePaise ?? 0;
      const cost = Math.round(taxable / l.quantity);
      return l.serials.map((serial) => ({ line: i + 1, serial, cost }));
    });

    const journal = new JournalBuilder()
      .debit({ ledger: "purchase" }, bill.taxablePaise)
      .debit({ ledger: "input_cgst" }, bill.cgstPaise)
      .debit({ ledger: "input_sgst" }, bill.sgstPaise)
      .debit({ ledger: "input_igst" }, bill.igstPaise)
      .signed({ ledger: "round_off" }, bill.roundOffPaise)
      .credit({ partyId: supplier.id }, bill.totalPaise);

    const now = Date.now();
    const pid = "(SELECT id FROM purchases WHERE uid = ?1)";
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO purchases (uid, supplier_id, supplier_invoice_no, invoice_date, is_interstate, rates_include_gst,
               taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
          )
          .bind(input.uid, supplier.id, input.supplierInvoiceNo, input.invoiceDate, interstate ? 1 : 0, input.ratesIncludeGst ? 1 : 0,
            bill.taxablePaise, bill.cgstPaise, bill.sgstPaise, bill.igstPaise, bill.roundOffPaise, bill.totalPaise, input.notes, now),
        db
          .prepare(
            `INSERT INTO purchase_items (purchase_id, line_no, product_id, quantity, rate_paise, gst_rate_bp,
               taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
             SELECT ${pid}, j.value ->> '$.line', j.value ->> '$.productId', j.value ->> '$.quantity', j.value ->> '$.rate',
                    j.value ->> '$.bp', j.value ->> '$.taxablePaise', j.value ->> '$.cgstPaise', j.value ->> '$.sgstPaise',
                    j.value ->> '$.igstPaise', j.value ->> '$.totalPaise'
               FROM json_each(?2) j`,
          )
          .bind(input.uid, JSON.stringify(items)),
        db
          .prepare(
            `INSERT INTO product_units (product_id, serial, status, purchase_item_id, cost_paise, created_at, updated_at)
             SELECT pi.product_id, j.value ->> '$.serial', 'in_stock', pi.id, j.value ->> '$.cost', ?3, ?3
               FROM json_each(?2) j JOIN purchase_items pi ON pi.purchase_id = ${pid} AND pi.line_no = j.value ->> '$.line'`,
          )
          .bind(input.uid, JSON.stringify(units), now),
        db
          .prepare(
            `INSERT INTO stock_movements (product_id, qty_delta, source_type, source_id, created_at)
             SELECT product_id, quantity, 'purchase', purchase_id, ?2 FROM purchase_items WHERE purchase_id = ${pid}`,
          )
          .bind(input.uid, now),
        ...journalStatements(db, {
          sourceType: "purchase",
          uid: input.uid,
          date: input.invoiceDate,
          narration: `Purchase from ${supplier.name}, invoice ${input.supplierInvoiceNo} dated ${formatDate(input.invoiceDate)}`,
          journal,
          now,
        }),
        audit(c, "purchase.created", {
          uid: input.uid,
          supplierId: supplier.id,
          supplierInvoiceNo: input.supplierInvoiceNo,
          totalPaise: bill.totalPaise,
          serials: allSerials.length,
        }),
      ]);
    } catch (err) {
      if (isUniqueViolation(err, "purchases.uid")) {
        const row = await db.prepare("SELECT id FROM purchases WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
        if (row) return c.json(await readPurchase(db, row.id), 200);
      }
      if (isUniqueViolation(err, "purchases.supplier_id") || isUniqueViolation(err, "uq_purchases_supplier_invoice")) {
        throw invalid(`Invoice ${input.supplierInvoiceNo} from this supplier is already entered`, "supplierInvoiceNo");
      }
      if (isUniqueViolation(err, "product_units.serial") || isUniqueViolation(err, "uq_product_units_live_serial")) {
        throw duplicateSerialError(await existingSerials(db, allSerials));
      }
      throw err;
    }
    const created = await db.prepare("SELECT id FROM purchases WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    return c.json(await readPurchase(db, (created as { id: number }).id), 201);
  })

  .post("/purchases/:id/cancel", validate("json", cancelSchema), async (c) => {
    const id = idParam(c);
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const detail = await readPurchase(db, id);
    if (!detail) throw notFound("Purchase");
    if (detail.status !== "posted") throw new AppError(409, "ALREADY_CANCELLED", "This purchase is already cancelled.");
    if (detail.returns.some((r) => r.status === "posted")) {
      throw new AppError(409, "HAS_RETURNS", "Cancel the purchase returns of this bill first.");
    }
    for (const item of detail.items) {
      if (item.tracksSerial) {
        const moved = item.units.filter((u) => u.status !== "in_stock");
        if (moved.length) {
          throw new AppError(409, "UNITS_MOVED", `Can't cancel: ${moved.map((u) => u.serial).join(", ")} already ${moved[0]?.status.replace(/_/g, " ")}.`);
        }
      } else if ((await stockOf(db, item.productId)) < item.quantity) {
        throw new AppError(409, "UNITS_MOVED", `Can't cancel: some ${item.productName} from this bill has already been sold.`);
      }
    }
    const settled = "EXISTS (SELECT 1 FROM voucher_allocations a JOIN money_vouchers v ON v.id = a.voucher_id WHERE v.status = 'posted' AND a.target_type = 'purchase' AND a.target_id = ?1)";
    const hasPayments = () => new AppError(409, "HAS_PAYMENTS", "Payments are allocated to this bill. Cancel those payments first.");
    if ((await db.prepare(`SELECT ${settled} AS x`).bind(id).first<{ x: number }>())?.x) throw hasPayments();
    const now = Date.now();
    let update: D1Result | undefined;
    try {
      [, , update] = await db.batch([
      guard(db, `NOT ${settled}`, id),
      clearGuards(db),
      db
        .prepare("UPDATE purchases SET status = 'cancelled', cancel_reason = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'posted'")
        .bind(reason, now, id),
      auditIfChanged(c, "purchase.cancelled", { id, reason, totalPaise: detail.totalPaise }),
      db
        .prepare(
          `UPDATE product_units SET status = 'void', updated_at = ?1
            WHERE status = 'in_stock' AND purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id = ?2)`,
        )
        .bind(now, id),
      db.prepare("UPDATE stock_movements SET is_void = 1 WHERE source_type = 'purchase' AND source_id = ?1").bind(id),
      db.prepare("UPDATE journal_entries SET status = 'cancelled' WHERE source_type = 'purchase' AND source_id = ?1").bind(id),
      ]);
    } catch (err) {
      if (isGuardFailure(err)) throw hasPayments();
      throw err;
    }
    if (!update?.meta.changes) throw new AppError(409, "ALREADY_CANCELLED", "This purchase is already cancelled.");
    return c.json(await readPurchase(db, id));
  })

  // ── Purchase returns ───────────────────────────────────────────────────────

  .get("/purchase-returns", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.purchase_id, r.return_date, r.total_paise, r.reason, r.status, pa.name AS supplier_name, pu.supplier_invoice_no
         FROM purchase_returns r JOIN purchases pu ON pu.id = r.purchase_id JOIN parties pa ON pa.id = pu.supplier_id
        ORDER BY r.return_date DESC, r.id DESC LIMIT 200`,
    ).all<Row>();
    return c.json({ items: results.map(toReturnSummary) });
  })

  .post("/purchase-returns", validate("json", purchaseReturnSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const already = await db.prepare("SELECT id FROM purchase_returns WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (already) return c.json({ id: already.id }, 200);

    const purchase = await readPurchase(db, input.purchaseId);
    if (!purchase) throw notFound("Purchase");
    if (purchase.status !== "posted") throw invalid("This purchase is cancelled");
    if (input.returnDate < purchase.invoiceDate) throw invalid("Return date cannot be before the purchase date", "returnDate");

    const itemsById = new Map(purchase.items.map((i) => [i.id, i]));
    const seenItems = new Set<number>();
    const lineInputs: { quantity: number; ratePaise: number; gstRateBp: number }[] = [];
    for (const line of input.lines) {
      const item = itemsById.get(line.purchaseItemId);
      if (!item) throw invalid("An item does not belong to this purchase");
      if (seenItems.has(item.id)) throw invalid(`${item.productName} is listed twice`);
      seenItems.add(item.id);
      const available = item.quantity - item.returnedQuantity;
      if (line.quantity > available) throw invalid(`${item.productName}: only ${available} left to return from this bill`);
      if (item.tracksSerial) {
        if (line.serials.length !== line.quantity) throw invalid(`${item.productName}: choose ${line.quantity} serial number(s)`);
        const inStock = new Set(item.units.filter((u) => u.status === "in_stock").map((u) => u.serial));
        const bad = line.serials.filter((s) => !inStock.has(s));
        if (bad.length) throw invalid(`${item.productName}: ${bad.join(", ")} not in stock from this bill`);
      } else {
        if (line.serials.length) throw invalid(`${item.productName} does not track serial numbers`);
        if ((await stockOf(db, item.productId)) < line.quantity) throw invalid(`${item.productName}: not enough in stock to return`);
      }
      lineInputs.push({ quantity: line.quantity, ratePaise: item.ratePaise, gstRateBp: item.gstRateBp });
    }

    // Same arithmetic as the original bill, applied to the returned quantity.
    const bill = computeBill(lineInputs, { interstate: purchase.isInterstate, ratesIncludeGst: purchase.ratesIncludeGst });
    const lines = input.lines.map((l, i) => ({ purchaseItemId: l.purchaseItemId, quantity: l.quantity, ...bill.lines[i] }));
    const serials = input.lines.flatMap((l) => l.serials);
    const quantities = input.lines.map((l) => ({ productId: itemsById.get(l.purchaseItemId)?.productId, quantity: l.quantity }));

    const journal = new JournalBuilder()
      .debit({ partyId: purchase.supplier.id }, bill.totalPaise)
      .credit({ ledger: "purchase_return" }, bill.taxablePaise)
      .credit({ ledger: "input_cgst" }, bill.cgstPaise)
      .credit({ ledger: "input_sgst" }, bill.sgstPaise)
      .credit({ ledger: "input_igst" }, bill.igstPaise)
      .signed({ ledger: "round_off" }, -bill.roundOffPaise);

    const now = Date.now();
    const rid = "(SELECT id FROM purchase_returns WHERE uid = ?1)";
    await db.batch([
      db
        .prepare(
          `INSERT INTO purchase_returns (uid, purchase_id, return_date, taxable_paise, cgst_paise, sgst_paise, igst_paise,
             round_off_paise, total_paise, reason, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(input.uid, purchase.id, input.returnDate, bill.taxablePaise, bill.cgstPaise, bill.sgstPaise, bill.igstPaise,
          bill.roundOffPaise, bill.totalPaise, input.reason, now),
      db
        .prepare(
          `INSERT INTO purchase_return_items (purchase_return_id, purchase_item_id, quantity, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
           SELECT ${rid}, j.value ->> '$.purchaseItemId', j.value ->> '$.quantity', j.value ->> '$.taxablePaise', j.value ->> '$.cgstPaise',
                  j.value ->> '$.sgstPaise', j.value ->> '$.igstPaise', j.value ->> '$.totalPaise'
             FROM json_each(?2) j`,
        )
        .bind(input.uid, JSON.stringify(lines)),
      // Only units still in stock move; the WHERE makes a concurrent sale lose cleanly.
      db
        .prepare(
          `UPDATE product_units SET status = 'returned_to_supplier', purchase_return_id = ${rid}, updated_at = ?3
            WHERE status = 'in_stock' AND serial IN (SELECT value FROM json_each(?2))`,
        )
        .bind(input.uid, JSON.stringify(serials), now),
      db
        .prepare(
          `INSERT INTO stock_movements (product_id, qty_delta, source_type, source_id, created_at)
           SELECT j.value ->> '$.productId', -(j.value ->> '$.quantity'), 'purchase_return', ${rid}, ?3 FROM json_each(?2) j`,
        )
        .bind(input.uid, JSON.stringify(quantities), now),
      ...journalStatements(db, {
        sourceType: "purchase_return",
        uid: input.uid,
        date: input.returnDate,
        narration: `Purchase return to ${purchase.supplier.name} against invoice ${purchase.supplierInvoiceNo}`,
        journal,
        now,
      }),
      audit(c, "purchase_return.created", { uid: input.uid, purchaseId: purchase.id, totalPaise: bill.totalPaise, serials }),
    ]);
    const created = await db.prepare("SELECT id FROM purchase_returns WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    return c.json({ id: created?.id }, 201);
  })

  .post("/purchase-returns/:id/cancel", validate("json", cancelSchema), async (c) => {
    const id = idParam(c);
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const ret = await db.prepare("SELECT id, status FROM purchase_returns WHERE id = ?1").bind(id).first<{ id: number; status: string }>();
    if (!ret) throw notFound("Purchase return");
    if (ret.status !== "posted") throw new AppError(409, "ALREADY_CANCELLED", "This return is already cancelled.");
    const now = Date.now();
    const [update] = await db.batch([
      db
        .prepare("UPDATE purchase_returns SET status = 'cancelled', cancel_reason = ?1 WHERE id = ?2 AND status = 'posted'")
        .bind(reason, id),
      auditIfChanged(c, "purchase_return.cancelled", { id, reason }),
      db
        .prepare(
          "UPDATE product_units SET status = 'in_stock', purchase_return_id = NULL, updated_at = ?1 WHERE purchase_return_id = ?2 AND status = 'returned_to_supplier'",
        )
        .bind(now, id),
      db.prepare("UPDATE stock_movements SET is_void = 1 WHERE source_type = 'purchase_return' AND source_id = ?1").bind(id),
      db.prepare("UPDATE journal_entries SET status = 'cancelled' WHERE source_type = 'purchase_return' AND source_id = ?1").bind(id),
    ]);
    if (!update?.meta.changes) throw new AppError(409, "ALREADY_CANCELLED", "This return is already cancelled.");
    return c.body(null, 204);
  })

  // ── Opening stock ──────────────────────────────────────────────────────────

  .get("/opening-stock", async (c) => {
    const db = c.env.DB;
    const [entries, units] = await db.batch([
      db.prepare(
        `SELECT o.id, o.product_id, p.brand || ' ' || p.name AS product_name, o.quantity, o.rate_paise, o.status, o.created_at
           FROM opening_stock o JOIN products p ON p.id = o.product_id ORDER BY o.id DESC LIMIT 500`,
      ),
      db.prepare("SELECT opening_stock_id, serial FROM product_units WHERE opening_stock_id IS NOT NULL ORDER BY id"),
    ]);
    const serialsBy = new Map<number, string[]>();
    for (const u of (units?.results ?? []) as { opening_stock_id: number; serial: string }[]) {
      serialsBy.set(u.opening_stock_id, [...(serialsBy.get(u.opening_stock_id) ?? []), u.serial]);
    }
    const items: OpeningStockEntry[] = ((entries?.results ?? []) as Row[]).map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      quantity: r.quantity,
      ratePaise: r.rate_paise,
      status: r.status as DocStatus,
      createdAt: r.created_at,
      serials: serialsBy.get(r.id) ?? [],
    }));
    return c.json({ items });
  })

  .post("/opening-stock", validate("json", openingStockSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const already = await db.prepare("SELECT id FROM opening_stock WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    if (already) return c.json({ id: already.id }, 200);

    const product = (await loadProducts(db, [input.productId])).get(input.productId);
    if (!product || product.is_active !== 1) throw invalid("Choose an active product", "productId");
    if (product.tracks_serial === 1 && input.serials.length !== input.quantity) {
      throw invalid(`Scan ${input.quantity} serial number(s); ${input.serials.length} entered`, "serials");
    }
    if (product.tracks_serial !== 1 && input.serials.length) throw invalid("This product does not track serial numbers", "serials");
    const clashes = await existingSerials(db, input.serials);
    if (clashes.length) throw duplicateSerialError(clashes);

    const now = Date.now();
    const oid = "(SELECT id FROM opening_stock WHERE uid = ?1)";
    try {
      await db.batch([
        db
          .prepare("INSERT INTO opening_stock (uid, product_id, quantity, rate_paise, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(input.uid, product.id, input.quantity, input.ratePaise, now),
        db
          .prepare(
            `INSERT INTO product_units (product_id, serial, status, opening_stock_id, cost_paise, created_at, updated_at)
             SELECT ?2, value, 'in_stock', ${oid}, ?3, ?4, ?4 FROM json_each(?5)`,
          )
          .bind(input.uid, product.id, input.ratePaise, now, JSON.stringify(input.serials)),
        db
          .prepare(
            `INSERT INTO stock_movements (product_id, qty_delta, source_type, source_id, created_at)
             VALUES (?2, ?3, 'opening_stock', ${oid}, ?4)`,
          )
          .bind(input.uid, product.id, input.quantity, now),
        audit(c, "opening_stock.created", { uid: input.uid, productId: product.id, quantity: input.quantity, ratePaise: input.ratePaise }),
      ]);
    } catch (err) {
      if (isUniqueViolation(err, "uq_product_units_live_serial") || isUniqueViolation(err, "product_units.serial")) {
        throw duplicateSerialError(await existingSerials(db, input.serials));
      }
      throw err;
    }
    const created = await db.prepare("SELECT id FROM opening_stock WHERE uid = ?1").bind(input.uid).first<{ id: number }>();
    return c.json({ id: created?.id }, 201);
  })

  .post("/opening-stock/:id/cancel", validate("json", cancelSchema), async (c: Ctx) => {
    const id = idParam(c);
    const db = c.env.DB;
    const entry = await db
      .prepare("SELECT id, product_id, quantity, status FROM opening_stock WHERE id = ?1")
      .bind(id)
      .first<{ id: number; product_id: number; quantity: number; status: string }>();
    if (!entry) throw notFound("Opening stock entry");
    if (entry.status !== "posted") throw new AppError(409, "ALREADY_CANCELLED", "Already cancelled.");
    const moved = await db
      .prepare("SELECT serial, status FROM product_units WHERE opening_stock_id = ?1 AND status NOT IN ('in_stock', 'void')")
      .bind(id)
      .all<{ serial: string; status: string }>();
    if (moved.results.length) {
      throw new AppError(409, "UNITS_MOVED", `Can't cancel: ${moved.results.map((u) => u.serial).join(", ")} already moved.`);
    }
    if ((await stockOf(db, entry.product_id)) < entry.quantity) {
      throw new AppError(409, "UNITS_MOVED", "Can't cancel: some of this stock has already been used.");
    }
    const now = Date.now();
    await db.batch([
      db.prepare("UPDATE opening_stock SET status = 'cancelled' WHERE id = ?1 AND status = 'posted'").bind(id),
      auditIfChanged(c, "opening_stock.cancelled", { id }),
      db.prepare("UPDATE product_units SET status = 'void', updated_at = ?1 WHERE opening_stock_id = ?2 AND status = 'in_stock'").bind(now, id),
      db.prepare("UPDATE stock_movements SET is_void = 1 WHERE source_type = 'opening_stock' AND source_id = ?1").bind(id),
    ]);
    return c.body(null, 204);
  });

