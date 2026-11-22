// Module 10: dashboard overview, sales statistics and stock report.
//
// Sales figures are net of credit notes and exclude cancelled bills; returns
// count in the month of the return (same rule as the GST report). Stock uses the
// shared weighted-average valuation (lib/stock.ts) so the dashboard, stock report
// and Balance Sheet always agree. Each endpoint is one batch of SQL aggregates.
import { Hono } from "hono";
import { todayIst } from "../../shared/gst";
import { MAX_REPORT_ROWS } from "../../shared/reports";
import { statsQuery, stockQuery, type NamedAmount, type Overview, type SalesStats, type StockReport, type StockRow } from "../../shared/stats";
import { likePattern } from "../lib/db";
import { openBillsSql, partyBalanceSql } from "../lib/outstanding";
import { STOCK_CTE } from "../lib/stock";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const rows = (r: D1Result | undefined) => (r?.results ?? []) as Row[];
const first = (r: D1Result | undefined) => (r?.results?.[0] ?? {}) as Row;

/** Net sales (invoices − credit notes) per month within [?1, ?2], incl. GST. */
const MONTHLY_SALES = `
  SELECT month, SUM(total) AS total, SUM(invoices) AS invoices FROM (
    SELECT substr(invoice_date, 1, 7) AS month, total_paise AS total, 1 AS invoices FROM sales WHERE status = 'posted' AND invoice_date BETWEEN ?1 AND ?2
    UNION ALL
    SELECT substr(return_date, 1, 7), -total_paise, 0 FROM sales_returns WHERE status = 'posted' AND return_date BETWEEN ?1 AND ?2
  ) GROUP BY month`;

const MONTHLY_PURCHASES = `
  SELECT month, SUM(total) AS total FROM (
    SELECT substr(invoice_date, 1, 7) AS month, total_paise AS total FROM purchases WHERE status = 'posted' AND invoice_date BETWEEN ?1 AND ?2
    UNION ALL
    SELECT substr(return_date, 1, 7), -total_paise FROM purchase_returns WHERE status = 'posted' AND return_date BETWEEN ?1 AND ?2
  ) GROUP BY month`;

/** Sold lines net of returned lines within [?1, ?2]. */
const SOLD_LINES = `
  SELECT i.product_id, s.customer_id, i.quantity AS qty, i.taxable_paise AS taxable, i.total_paise AS total
    FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE s.status = 'posted' AND s.invoice_date BETWEEN ?1 AND ?2
  UNION ALL
  SELECT si.product_id, s.customer_id, -ri.quantity, -ri.taxable_paise, -ri.total_paise
    FROM sales_returns r JOIN sales s ON s.id = r.sale_id JOIN sales_return_items ri ON ri.sales_return_id = r.id JOIN sale_items si ON si.id = ri.sale_item_id
   WHERE r.status = 'posted' AND r.return_date BETWEEN ?1 AND ?2`;

/** Every month (YYYY-MM) from `from` to `to`, so empty months still show. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const named = (r: Row): NamedAmount => ({ id: r.id ?? null, name: r.name ?? "", quantity: r.qty ?? 0, taxablePaise: r.taxable ?? 0, totalPaise: r.total ?? 0 });

const LEDGER_BAL = (key: string) =>
  `(SELECT l.opening_balance_paise + COALESCE((SELECT SUM(jl.debit_paise - jl.credit_paise) FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
     WHERE jl.ledger_id = l.id AND e.status = 'posted'), 0) FROM ledgers l WHERE l.system_key = '${key}')`;

export const statsRoutes = new Hono<AppEnv>();
for (const path of ["/stats/*", "/stock-report"]) statsRoutes.use(path, requireAuth);

statsRoutes
  .get("/stats/overview", async (c) => {
    const db = c.env.DB;
    const today = todayIst();
    const monthStart = `${today.slice(0, 8)}01`;
    const [y, m] = today.split("-").map(Number) as [number, number];
    const trendStart = new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 10);
    const [todayRes, monthRes, collected, money, balances, overdue, stock, trend, recent, low] = await db.batch([
      db.prepare("SELECT COALESCE(SUM(total_paise), 0) AS t, COUNT(*) AS n FROM sales WHERE status = 'posted' AND invoice_date = ?1").bind(today),
      db
        .prepare(
          `SELECT (SELECT COALESCE(SUM(total_paise), 0) FROM sales WHERE status = 'posted' AND invoice_date BETWEEN ?1 AND ?2)
                - (SELECT COALESCE(SUM(total_paise), 0) FROM sales_returns WHERE status = 'posted' AND return_date BETWEEN ?1 AND ?2) AS t,
                  (SELECT COUNT(*) FROM sales WHERE status = 'posted' AND invoice_date BETWEEN ?1 AND ?2) AS n`,
        )
        .bind(monthStart, today),
      db
        .prepare(
          `SELECT (SELECT COALESCE(SUM(amount_paise), 0) FROM money_vouchers WHERE kind = 'receipt' AND status = 'posted' AND voucher_date = ?1)
                + (SELECT COALESCE(SUM(total_paise), 0) FROM sales WHERE status = 'posted' AND collection_type = 'immediate' AND invoice_date = ?1) AS t`,
        )
        .bind(today),
      db.prepare(`SELECT ${LEDGER_BAL("cash")} AS cash, ${LEDGER_BAL("bank")} AS bank, (SELECT COUNT(*) FROM general_vouchers WHERE status = 'draft') AS drafts`),
      db.prepare(
        `SELECT COALESCE(SUM(MAX(b, 0)), 0) AS recv, COALESCE(SUM(MAX(-b, 0)), 0) AS pay FROM (SELECT ${partyBalanceSql()} AS b FROM parties p)`,
      ),
      db.prepare(`SELECT COALESCE(SUM(outstanding), 0) AS amt, COUNT(DISTINCT party_id) AS n FROM (${openBillsSql("receipt", () => "1")}) WHERE due_date < ?1`).bind(today),
      db
        .prepare(
          `${STOCK_CTE}
           SELECT COALESCE(SUM(CASE WHEN q.q > 0 AND c.n > 0 THEN CAST(ROUND(q.q * c.v * 1.0 / c.n) AS INTEGER) ELSE 0 END), 0) AS value,
                  (SELECT COUNT(*) FROM products p LEFT JOIN qty q2 ON q2.product_id = p.id WHERE p.is_active = 1 AND COALESCE(q2.q, 0) BETWEEN 1 AND 2) AS low,
                  (SELECT COUNT(*) FROM products p LEFT JOIN qty q2 ON q2.product_id = p.id WHERE p.is_active = 1 AND COALESCE(q2.q, 0) <= 0) AS out_of_stock
             FROM qty q LEFT JOIN cost c ON c.product_id = q.product_id`,
        )
        .bind(today),
      db.prepare(MONTHLY_SALES).bind(trendStart, today),
      db.prepare("SELECT id, invoice_no, invoice_date, bill_name, total_paise FROM sales WHERE status = 'posted' ORDER BY id DESC LIMIT 6"),
      db
        .prepare(
          `${STOCK_CTE}
           SELECT p.id, p.brand || ' ' || p.name AS name, COALESCE(q.q, 0) AS q FROM products p LEFT JOIN qty q ON q.product_id = p.id
            WHERE p.is_active = 1 AND COALESCE(q.q, 0) <= 2 ORDER BY COALESCE(q.q, 0), name LIMIT 6`,
        )
        .bind(today),
    ]);
    const t = first(todayRes), mo = first(monthRes), mn = first(money), bal = first(balances), od = first(overdue), st = first(stock);
    const trendMap = new Map(rows(trend).map((r) => [r.month as string, r.total as number]));
    const body: Overview = {
      today,
      salesToday: { totalPaise: t.t, count: t.n },
      salesMonth: { totalPaise: mo.t, count: mo.n },
      collectedTodayPaise: first(collected).t,
      cashPaise: mn.cash ?? 0,
      bankPaise: mn.bank ?? 0,
      receivablePaise: bal.recv,
      payablePaise: bal.pay,
      overdue: { amountPaise: od.amt, parties: od.n },
      stockValuePaise: st.value,
      lowStock: st.low,
      outOfStock: st.out_of_stock,
      draftVouchers: mn.drafts,
      trend: monthsBetween(trendStart, today).map((month) => ({ month, salesPaise: trendMap.get(month) ?? 0 })),
      lowStockItems: rows(low).map((r) => ({ id: r.id, name: r.name, inStock: r.q })),
      recentSales: rows(recent).map((r) => ({ id: r.id, invoiceNo: r.invoice_no, date: r.invoice_date, party: r.bill_name, totalPaise: r.total_paise })),
    };
    return c.json(body);
  })

  .get("/stats/sales", validate("query", statsQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    const db = c.env.DB;
    const [sales, purchases, totals, products, customers, groups] = await db.batch([
      db.prepare(MONTHLY_SALES).bind(from, to),
      db.prepare(MONTHLY_PURCHASES).bind(from, to),
      db.prepare(`SELECT SUM(taxable) AS taxable, SUM(total) AS total FROM (${SOLD_LINES})`).bind(from, to),
      db
        .prepare(
          `SELECT x.product_id AS id, p.brand || ' ' || p.name AS name, SUM(x.qty) AS qty, SUM(x.taxable) AS taxable, SUM(x.total) AS total
             FROM (${SOLD_LINES}) x JOIN products p ON p.id = x.product_id GROUP BY x.product_id ORDER BY taxable DESC LIMIT 10`,
        )
        .bind(from, to),
      db
        .prepare(
          `SELECT x.customer_id AS id, pa.name, SUM(x.qty) AS qty, SUM(x.taxable) AS taxable, SUM(x.total) AS total
             FROM (${SOLD_LINES}) x JOIN parties pa ON pa.id = x.customer_id GROUP BY x.customer_id ORDER BY taxable DESC LIMIT 10`,
        )
        .bind(from, to),
      db
        .prepare(
          `SELECT NULL AS id, CASE WHEN p.category = '' THEN 'No group' ELSE p.category END AS name, SUM(x.qty) AS qty, SUM(x.taxable) AS taxable, SUM(x.total) AS total
             FROM (${SOLD_LINES}) x JOIN products p ON p.id = x.product_id GROUP BY 2 ORDER BY taxable DESC LIMIT 20`,
        )
        .bind(from, to),
    ]);
    const sMap = new Map(rows(sales).map((r) => [r.month as string, r]));
    const pMap = new Map(rows(purchases).map((r) => [r.month as string, r.total as number]));
    const months = monthsBetween(from, to).map((month) => ({
      month,
      salesPaise: (sMap.get(month)?.total as number) ?? 0,
      purchasesPaise: pMap.get(month) ?? 0,
      invoices: (sMap.get(month)?.invoices as number) ?? 0,
    }));
    const invoices = months.reduce((s, x) => s + x.invoices, 0);
    const salesTotalPaise = months.reduce((s, x) => s + x.salesPaise, 0);
    const body: SalesStats = {
      from,
      to,
      months,
      salesTotalPaise,
      salesTaxablePaise: first(totals).taxable ?? 0,
      invoices,
      averageBillPaise: invoices ? Math.round(salesTotalPaise / invoices) : 0,
      topProducts: rows(products).map(named),
      topCustomers: rows(customers).map(named),
      byGroup: rows(groups).map(named),
    };
    return c.json(body);
  })

  .get("/stock-report", validate("query", stockQuery), async (c) => {
    const { q, group, show, low } = c.req.valid("query");
    const today = todayIst();
    const binds: unknown[] = [today];
    const where = ["1"];
    if (q) {
      binds.push(likePattern(q));
      const n = binds.length;
      where.push(`(p.name LIKE ?${n} ESCAPE '\\' OR p.brand LIKE ?${n} ESCAPE '\\' OR p.hsn_code LIKE ?${n} ESCAPE '\\')`);
    }
    if (group) {
      binds.push(group);
      where.push(`p.category = ?${binds.length}`);
    }
    binds.push(low);
    const lowN = binds.length;
    if (show === "in") where.push("qty > 0");
    else if (show === "low") where.push(`qty BETWEEN 1 AND ?${lowN}`);
    else if (show === "out") where.push("qty <= 0 AND p.is_active = 1");
    const sql = `${STOCK_CTE}
      SELECT * FROM (
        SELECT p.id, p.brand, p.name, p.category, p.unit, p.tracks_serial, p.is_active, p.selling_price_paise, p.hsn_code,
               COALESCE(q.q, 0) AS qty, CASE WHEN c.n > 0 THEN CAST(ROUND(c.v * 1.0 / c.n) AS INTEGER) ELSE 0 END AS avg_cost,
               CASE WHEN COALESCE(q.q, 0) > 0 AND c.n > 0 THEN CAST(ROUND(q.q * c.v * 1.0 / c.n) AS INTEGER) ELSE 0 END AS value
          FROM products p LEFT JOIN qty q ON q.product_id = p.id LEFT JOIN cost c ON c.product_id = p.id
      ) p WHERE ${where.join(" AND ")} AND ?${lowN} = ?${lowN}`;
    const db = c.env.DB;
    const [list, totals] = await db.batch([
      db.prepare(`${sql} ORDER BY p.category, p.brand, p.name LIMIT ${MAX_REPORT_ROWS + 1}`).bind(...binds),
      db.prepare(`SELECT COALESCE(SUM(MAX(qty, 0)), 0) AS qty, COALESCE(SUM(value), 0) AS value, COALESCE(SUM(MAX(qty, 0) * selling_price_paise), 0) AS selling FROM (${sql})`).bind(...binds),
    ]);
    const r = rows(list);
    const t = first(totals);
    const body: StockReport = {
      asOf: today,
      truncated: r.length > MAX_REPORT_ROWS,
      rows: r.slice(0, MAX_REPORT_ROWS).map(
        (x): StockRow => ({
          productId: x.id,
          brand: x.brand,
          name: x.name,
          group: x.category,
          unit: x.unit,
          tracksSerial: x.tracks_serial === 1,
          isActive: x.is_active === 1,
          quantity: x.qty,
          averageCostPaise: x.avg_cost,
          valuePaise: x.value,
          sellingPricePaise: x.selling_price_paise,
          sellingValuePaise: Math.max(x.qty, 0) * x.selling_price_paise,
        }),
      ),
      totalQuantity: t.qty,
      totalValuePaise: t.value,
      totalSellingValuePaise: t.selling,
    };
    return c.json(body);
  });
