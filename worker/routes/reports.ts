// Module 8: sales/purchase registers and the GST (auditor) report.
//
// What can go wrong and how it is handled:
// - Wrong totals: every figure comes from the GST stored on each line at billing
//   time (never recomputed from current product rates). Returns are subtracted
//   in their own period (return date), as in GSTR-1/3B.
// - Cancelled documents are excluded from GST figures; the register can show them.
// - Free-plan CPU (10 ms): aggregation is done in SQL, one batch per report,
//   ranges are capped at a year and listed rows at MAX_REPORT_ROWS (totals stay
//   complete; the response says when the listing was cut).
// - Input: dates and rates are validated; rates are bound as JSON, never interpolated.
import { Hono } from "hono";
import {
  addTotals,
  emptyTotals,
  gstReportQuery,
  MAX_REPORT_ROWS,
  registerQuery,
  type GstReport,
  type GstRow,
  type Register,
  type RegisterRow,
  type Totals,
} from "../../shared/reports";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const toTotals = (r: Row): Totals => ({
  taxablePaise: r.taxable ?? 0,
  cgstPaise: r.cgst ?? 0,
  sgstPaise: r.sgst ?? 0,
  igstPaise: r.igst ?? 0,
  totalPaise: (r.taxable ?? 0) + (r.cgst ?? 0) + (r.sgst ?? 0) + (r.igst ?? 0),
});

/** ?3 = JSON array of rates; empty array = all rates. */
const rateFilter = (col: string) => `(json_array_length(?3) = 0 OR ${col} IN (SELECT value FROM json_each(?3)))`;
const sums = (a: string) => `SUM(${a}.taxable_paise) AS taxable, SUM(${a}.cgst_paise) AS cgst, SUM(${a}.sgst_paise) AS sgst, SUM(${a}.igst_paise) AS igst`;

/** Line-level GST rows (document × rate) with sign: invoices +1, returns −1. */
function gstLinesSql(kind: "sales" | "purchase"): string {
  if (kind === "sales") {
    return `
      SELECT 'invoice' AS doc_type, s.id AS doc_id, s.invoice_no AS doc_no, s.invoice_date AS doc_date, s.bill_name AS party, s.bill_gstin AS gstin,
             i.gst_rate_bp AS rate, 1 AS sign, ${sums("i")}
        FROM sales s JOIN sale_items i ON i.sale_id = s.id
       WHERE s.status = 'posted' AND s.invoice_date BETWEEN ?1 AND ?2 AND ${rateFilter("i.gst_rate_bp")}
       GROUP BY s.id, i.gst_rate_bp
      UNION ALL
      SELECT 'return', r.id, r.credit_note_no, r.return_date, s.bill_name, s.bill_gstin, si.gst_rate_bp, -1, ${sums("ri")}
        FROM sales_returns r JOIN sales s ON s.id = r.sale_id
        JOIN sales_return_items ri ON ri.sales_return_id = r.id JOIN sale_items si ON si.id = ri.sale_item_id
       WHERE r.status = 'posted' AND r.return_date BETWEEN ?1 AND ?2 AND ${rateFilter("si.gst_rate_bp")}
       GROUP BY r.id, si.gst_rate_bp`;
  }
  return `
    SELECT 'invoice' AS doc_type, p.id AS doc_id, p.supplier_invoice_no AS doc_no, p.invoice_date AS doc_date, pa.name AS party, pa.gstin AS gstin,
           i.gst_rate_bp AS rate, 1 AS sign, ${sums("i")}
      FROM purchases p JOIN parties pa ON pa.id = p.supplier_id JOIN purchase_items i ON i.purchase_id = p.id
     WHERE p.status = 'posted' AND p.invoice_date BETWEEN ?1 AND ?2 AND ${rateFilter("i.gst_rate_bp")}
     GROUP BY p.id, i.gst_rate_bp
    UNION ALL
    SELECT 'return', r.id, 'DN-' || r.id, r.return_date, pa.name, pa.gstin, pi.gst_rate_bp, -1, ${sums("ri")}
      FROM purchase_returns r JOIN purchases p ON p.id = r.purchase_id JOIN parties pa ON pa.id = p.supplier_id
      JOIN purchase_return_items ri ON ri.purchase_return_id = r.id JOIN purchase_items pi ON pi.id = ri.purchase_item_id
     WHERE r.status = 'posted' AND r.return_date BETWEEN ?1 AND ?2 AND ${rateFilter("pi.gst_rate_bp")}
     GROUP BY r.id, pi.gst_rate_bp
    UNION ALL
    SELECT 'expense', v.id, v.supplier_invoice_no, v.voucher_date, v.supplier_name, v.supplier_gstin, l.gst_rate_bp, 1, ${sums("l").replace("SUM(l.taxable_paise)", "SUM(l.amount_paise)")}
      FROM general_vouchers v JOIN general_voucher_lines l ON l.voucher_id = v.id
     WHERE v.status = 'approved' AND v.gst_bill = 1 AND v.voucher_date BETWEEN ?1 AND ?2 AND ${rateFilter("l.gst_rate_bp")}
     GROUP BY v.id, l.gst_rate_bp`;
}

function hsnSql(kind: "sales" | "purchase"): string {
  if (kind === "sales") {
    return `SELECT hsn, rate, SUM(qty) AS qty, SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst FROM (
      SELECT i.hsn_code AS hsn, i.gst_rate_bp AS rate, i.quantity AS qty, i.taxable_paise AS taxable, i.cgst_paise AS cgst, i.sgst_paise AS sgst, i.igst_paise AS igst
        FROM sales s JOIN sale_items i ON i.sale_id = s.id
       WHERE s.status = 'posted' AND s.invoice_date BETWEEN ?1 AND ?2 AND ${rateFilter("i.gst_rate_bp")}
      UNION ALL
      SELECT si.hsn_code, si.gst_rate_bp, -ri.quantity, -ri.taxable_paise, -ri.cgst_paise, -ri.sgst_paise, -ri.igst_paise
        FROM sales_returns r JOIN sales_return_items ri ON ri.sales_return_id = r.id JOIN sale_items si ON si.id = ri.sale_item_id
       WHERE r.status = 'posted' AND r.return_date BETWEEN ?1 AND ?2 AND ${rateFilter("si.gst_rate_bp")}
    ) GROUP BY hsn, rate ORDER BY hsn, rate`;
  }
  return `SELECT hsn, rate, SUM(qty) AS qty, SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst FROM (
    SELECT pr.hsn_code AS hsn, i.gst_rate_bp AS rate, i.quantity AS qty, i.taxable_paise AS taxable, i.cgst_paise AS cgst, i.sgst_paise AS sgst, i.igst_paise AS igst
      FROM purchases p JOIN purchase_items i ON i.purchase_id = p.id JOIN products pr ON pr.id = i.product_id
     WHERE p.status = 'posted' AND p.invoice_date BETWEEN ?1 AND ?2 AND ${rateFilter("i.gst_rate_bp")}
    UNION ALL
    SELECT pr.hsn_code, pi.gst_rate_bp, -ri.quantity, -ri.taxable_paise, -ri.cgst_paise, -ri.sgst_paise, -ri.igst_paise
      FROM purchase_returns r JOIN purchase_return_items ri ON ri.purchase_return_id = r.id
      JOIN purchase_items pi ON pi.id = ri.purchase_item_id JOIN products pr ON pr.id = pi.product_id
     WHERE r.status = 'posted' AND r.return_date BETWEEN ?1 AND ?2 AND ${rateFilter("pi.gst_rate_bp")}
  ) GROUP BY hsn, rate ORDER BY hsn, rate`;
}

function registerSql(kind: "sales" | "purchase", where: string): string {
  if (kind === "sales") {
    return `SELECT * FROM (
      SELECT 'invoice' AS doc_type, s.id, s.invoice_no AS doc_no, s.invoice_date AS doc_date, s.bill_name AS party, s.bill_gstin AS gstin, s.customer_id AS party_id,
             s.taxable_paise AS taxable, s.cgst_paise AS cgst, s.sgst_paise AS sgst, s.igst_paise AS igst, s.round_off_paise AS round_off, s.total_paise AS total, s.status
        FROM sales s WHERE s.invoice_date BETWEEN ?1 AND ?2
      UNION ALL
      SELECT 'return', r.id, r.credit_note_no, r.return_date, s.bill_name, s.bill_gstin, s.customer_id,
             r.taxable_paise, r.cgst_paise, r.sgst_paise, r.igst_paise, r.round_off_paise, r.total_paise, r.status
        FROM sales_returns r JOIN sales s ON s.id = r.sale_id WHERE r.return_date BETWEEN ?1 AND ?2
    ) WHERE ${where}`;
  }
  return `SELECT * FROM (
    SELECT 'invoice' AS doc_type, p.id, p.supplier_invoice_no AS doc_no, p.invoice_date AS doc_date, pa.name AS party, pa.gstin, p.supplier_id AS party_id,
           p.taxable_paise AS taxable, p.cgst_paise AS cgst, p.sgst_paise AS sgst, p.igst_paise AS igst, p.round_off_paise AS round_off, p.total_paise AS total, p.status
      FROM purchases p JOIN parties pa ON pa.id = p.supplier_id WHERE p.invoice_date BETWEEN ?1 AND ?2
    UNION ALL
    SELECT 'return', r.id, 'DN-' || r.id, r.return_date, pa.name, pa.gstin, p.supplier_id,
           r.taxable_paise, r.cgst_paise, r.sgst_paise, r.igst_paise, r.round_off_paise, r.total_paise, r.status
      FROM purchase_returns r JOIN purchases p ON p.id = r.purchase_id JOIN parties pa ON pa.id = p.supplier_id WHERE r.return_date BETWEEN ?1 AND ?2
  ) WHERE ${where}`;
}

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("/reports/*", requireAuth);

reportRoutes
  .get("/reports/register", validate("query", registerQuery), async (c) => {
    const { kind, from, to, partyId, status } = c.req.valid("query");
    const where = ["1"];
    const binds: unknown[] = [from, to];
    if (status !== "all") {
      binds.push(status);
      where.push(`status = ?${binds.length}`);
    }
    if (partyId) {
      binds.push(partyId);
      where.push(`party_id = ?${binds.length}`);
    }
    const sql = registerSql(kind, where.join(" AND "));
    const db = c.env.DB;
    const [rows, net] = await db.batch([
      db.prepare(`${sql} ORDER BY doc_date, doc_type, id LIMIT ${MAX_REPORT_ROWS + 1}`).bind(...binds),
      db
        .prepare(
          `SELECT SUM(CASE WHEN doc_type = 'return' THEN -taxable ELSE taxable END) AS taxable, SUM(CASE WHEN doc_type = 'return' THEN -cgst ELSE cgst END) AS cgst,
                  SUM(CASE WHEN doc_type = 'return' THEN -sgst ELSE sgst END) AS sgst, SUM(CASE WHEN doc_type = 'return' THEN -igst ELSE igst END) AS igst,
                  SUM(CASE WHEN doc_type = 'return' THEN -total ELSE total END) AS total
             FROM (${sql}) WHERE status = 'posted'`,
        )
        .bind(...binds),
    ]);
    const list = (rows?.results ?? []) as Row[];
    const n = (net?.results?.[0] ?? {}) as Row;
    const body: Register = {
      kind,
      from,
      to,
      truncated: list.length > MAX_REPORT_ROWS,
      rows: list.slice(0, MAX_REPORT_ROWS).map(
        (r): RegisterRow => ({
          id: r.id,
          docType: r.doc_type,
          docNo: r.doc_no,
          date: r.doc_date,
          partyName: r.party,
          gstin: r.gstin,
          taxablePaise: r.taxable,
          cgstPaise: r.cgst,
          sgstPaise: r.sgst,
          igstPaise: r.igst,
          roundOffPaise: r.round_off,
          totalPaise: r.total,
          status: r.status,
        }),
      ),
      net: { ...toTotals(n), totalPaise: n.total ?? 0 },
    };
    return c.json(body);
  })

  .get("/reports/gst", validate("query", gstReportQuery), async (c) => {
    const { kind, from, to, rates } = c.req.valid("query");
    const lines = gstLinesSql(kind);
    const binds = [from, to, JSON.stringify(rates)];
    const db = c.env.DB;
    const stmts = [
      db.prepare(`SELECT * FROM (${lines}) ORDER BY doc_date, doc_type <> 'invoice', doc_no, rate LIMIT ${MAX_REPORT_ROWS + 1}`).bind(...binds),
      db
        .prepare(
          `SELECT rate, sign, SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst FROM (${lines}) GROUP BY rate, sign ORDER BY rate`,
        )
        .bind(...binds),
      db.prepare(hsnSql(kind)).bind(...binds),
    ];
    if (kind === "sales") {
      stmts.push(
        db
          .prepare(
            `SELECT gstin IS NOT NULL AND gstin <> '' AS b2b, SUM(sign * taxable) AS taxable, SUM(sign * cgst) AS cgst, SUM(sign * sgst) AS sgst, SUM(sign * igst) AS igst
               FROM (${lines}) GROUP BY 1`,
          )
          .bind(...binds),
      );
    }
    const [rowsRes, slabRes, hsnRes, b2bRes] = await db.batch(stmts);
    const list = (rowsRes?.results ?? []) as Row[];

    const slabs = new Map<number, GstReport["slabs"][number]>();
    for (const r of (slabRes?.results ?? []) as Row[]) {
      const s = slabs.get(r.rate) ?? { rateBp: r.rate, ...emptyTotals(), returnTaxablePaise: 0, returnTaxPaise: 0 };
      addTotals(s, toTotals(r), r.sign);
      if (r.sign < 0) {
        s.returnTaxablePaise += r.taxable;
        s.returnTaxPaise += r.cgst + r.sgst + r.igst;
      }
      slabs.set(r.rate, s);
    }
    const slabList = [...slabs.values()].sort((a, b) => a.rateBp - b.rateBp);
    const net = slabList.reduce((t, s) => addTotals(t, s), emptyTotals());
    const b2bRows = (b2bRes?.results ?? []) as Row[];
    const pick = (flag: number) => {
      const r = b2bRows.find((x) => x.b2b === flag);
      return r ? toTotals(r) : emptyTotals();
    };

    const body: GstReport = {
      kind,
      from,
      to,
      rates,
      slabs: slabList,
      b2b: kind === "sales" ? pick(1) : null,
      b2c: kind === "sales" ? pick(0) : null,
      hsn: ((hsnRes?.results ?? []) as Row[]).map((r) => ({ hsnCode: r.hsn, rateBp: r.rate, quantity: r.qty, ...toTotals(r) })),
      truncated: list.length > MAX_REPORT_ROWS,
      rows: list.slice(0, MAX_REPORT_ROWS).map(
        (r): GstRow => ({
          docType: r.doc_type,
          docNo: r.doc_no,
          date: r.doc_date,
          partyName: r.party,
          gstin: r.gstin,
          rateBp: r.rate,
          // Returns are shown negative so every column adds up to the net.
          ...addTotals(emptyTotals(), toTotals(r), r.sign),
        }),
      ),
      net,
    };
    return c.json(body);
  });
