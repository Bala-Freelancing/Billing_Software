// Module 9: Trial Balance, Profit & Loss, Balance Sheet, Ledger Report and
// ledger opening balances.
//
// Accounting model (all amounts signed: debit +, credit −):
// - Account balance = opening balance + posted journal lines up to the date.
// - Stock is valued at weighted-average purchase cost excluding GST (GST is
//   claimed as input credit), from opening stock and posted purchase bills up to
//   the date; quantity comes from stock movements dated by their documents.
// - Opening stock and party/ledger opening balances have no journal entry, so
//   their sum appears as "Difference in opening balances" under Capital, exactly
//   as Tally does. The Balance Sheet always balances because the journal does.
// - Profit for the Balance Sheet is cumulative up to the date (no year-end
//   closing entries are needed).
//
// Free-plan CPU: each report is one batch of aggregate queries; JS only groups rows.
import { Hono } from "hono";
import {
  asOfQuery,
  ledgerOpeningSchema,
  ledgerReportQuery,
  periodQuery,
  type AccountBalance,
  type BalanceSheet,
  type BsGroup,
  type LedgerReport,
  type LedgerReportLine,
  type PlLine,
  type ProfitAndLoss,
  type TrialBalance,
} from "../../shared/financials";
import { financialYear } from "../../shared/sales";
import { todayIst } from "../../shared/gst";
import { conflict, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { auditIfChanged, idParam, nextStamp } from "../lib/route";
import { STOCK_CTE } from "../lib/stock";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const POSTED_UPTO = (cond: string) =>
  `COALESCE((SELECT SUM(jl.debit_paise - jl.credit_paise) FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
              WHERE ${cond} AND e.status = 'posted' AND e.entry_date <= ?1), 0)`;

/** Ledgers with their root (built-in) group, balance up to ?1. */
const LEDGER_BALANCES = `
  SELECT l.id, l.name, l.system_key, g.name AS group_name, g.nature, COALESCE(pg.name, g.name) AS root_name, COALESCE(pg.system_key, g.system_key) AS root_key,
         l.opening_balance_paise AS opening, l.opening_balance_paise + ${POSTED_UPTO("jl.ledger_id = l.id")} AS bal
    FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id LEFT JOIN ledger_groups pg ON pg.id = g.parent_id`;

const PARTY_BALANCES = `
  SELECT p.id, p.name, p.opening_balance_paise AS opening, p.opening_balance_paise + ${POSTED_UPTO("jl.party_id = p.id")} AS bal FROM parties p`;

/** Income/expense ledger movements within [?1, ?2]. */
const PERIOD_MOVEMENTS = `
  SELECT l.name, l.system_key, g.nature, COALESCE(pg.system_key, g.system_key) AS root_key,
         COALESCE((SELECT SUM(jl.debit_paise - jl.credit_paise) FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
                    WHERE jl.ledger_id = l.id AND e.status = 'posted' AND e.entry_date BETWEEN ?1 AND ?2), 0) AS amt
    FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id LEFT JOIN ledger_groups pg ON pg.id = g.parent_id
   WHERE g.nature IN ('income', 'expense')`;

/** Closing stock value at weighted-average cost as of ?1. */
const STOCK_VALUE = `${STOCK_CTE}
  SELECT COALESCE(SUM(CASE WHEN q.q > 0 AND c.n > 0 THEN CAST(ROUND(q.q * c.v * 1.0 / c.n) AS INTEGER) ELSE 0 END), 0) AS value
    FROM qty q LEFT JOIN cost c ON c.product_id = q.product_id`;

const OPENING_STOCK = "SELECT COALESCE(SUM(quantity * rate_paise), 0) AS value FROM opening_stock WHERE status = 'posted'";

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const first = (r: D1Result | undefined) => (r?.results?.[0] ?? {}) as Row;
const rows = (r: D1Result | undefined) => (r?.results ?? []) as Row[];

/** Shared core of TB and BS: balances as of `to`. */
async function balancesAsOf(db: D1Database, to: string) {
  const [ledgers, parties, stock, opening] = await db.batch([
    db.prepare(LEDGER_BALANCES).bind(to),
    db.prepare(PARTY_BALANCES).bind(to),
    db.prepare(STOCK_VALUE).bind(to),
    db.prepare(OPENING_STOCK),
  ]);
  const ls = rows(ledgers);
  const ps = rows(parties);
  const openingStock = first(opening).value as number;
  const openingSum = ls.reduce((s, l) => s + l.opening, 0) + ps.reduce((s, p) => s + p.opening, 0) + openingStock;
  return { ledgers: ls, parties: ps, closingStock: first(stock).value as number, openingStock, openingDifference: -openingSum };
}

function classify(rootKey: string | null, nature: string): "sales" | "purchase" | "direct" | "indirect_income" | "indirect_expense" {
  if (rootKey === "sales_accounts") return "sales";
  if (rootKey === "purchase_accounts") return "purchase";
  if (rootKey === "direct_expenses") return "direct";
  return nature === "income" ? "indirect_income" : "indirect_expense";
}

async function profitAndLoss(db: D1Database, from: string, to: string): Promise<ProfitAndLoss> {
  const [moves, openStock, closeStock] = await db.batch([
    db.prepare(PERIOD_MOVEMENTS).bind(from, to),
    db.prepare(STOCK_VALUE).bind(dayBefore(from)),
    db.prepare(STOCK_VALUE).bind(to),
  ]);
  let sales = 0, salesReturns = 0, purchases = 0, purchaseReturns = 0;
  const direct: PlLine[] = [], incomes: PlLine[] = [], expenses: PlLine[] = [];
  for (const m of rows(moves)) {
    if (!m.amt) continue;
    const kind = classify(m.root_key, m.nature);
    if (kind === "sales") {
      if (m.system_key === "sales_return") salesReturns += m.amt;
      else sales -= m.amt;
    } else if (kind === "purchase") {
      if (m.system_key === "purchase_return") purchaseReturns -= m.amt;
      else purchases += m.amt;
    } else if (kind === "direct") direct.push({ name: m.name, amountPaise: m.amt });
    else if (kind === "indirect_income") incomes.push({ name: m.name, amountPaise: -m.amt });
    else expenses.push({ name: m.name, amountPaise: m.amt });
  }
  const openingStockPaise = first(openStock).value as number;
  const closingStockPaise = first(closeStock).value as number;
  const sum = (l: PlLine[]) => l.reduce((s, x) => s + x.amountPaise, 0);
  const grossProfitPaise = sales - salesReturns - (openingStockPaise + purchases - purchaseReturns + sum(direct) - closingStockPaise);
  return {
    from,
    to,
    salesPaise: sales,
    salesReturnsPaise: salesReturns,
    purchasesPaise: purchases,
    purchaseReturnsPaise: purchaseReturns,
    openingStockPaise,
    closingStockPaise,
    directExpenses: direct,
    grossProfitPaise,
    indirectIncomes: incomes,
    indirectExpenses: expenses,
    netProfitPaise: grossProfitPaise + sum(incomes) - sum(expenses),
  };
}

const DOC_NO = `CASE e.source_type
    WHEN 'sale' THEN (SELECT invoice_no FROM sales WHERE id = e.source_id)
    WHEN 'sales_return' THEN (SELECT credit_note_no FROM sales_returns WHERE id = e.source_id)
    WHEN 'purchase' THEN (SELECT supplier_invoice_no FROM purchases WHERE id = e.source_id)
    WHEN 'purchase_return' THEN 'DN-' || e.source_id
    WHEN 'journal' THEN (SELECT voucher_no FROM general_vouchers WHERE id = e.source_id)
    ELSE (SELECT voucher_no FROM money_vouchers WHERE id = e.source_id) END`;
const DOC_TYPE: Record<string, string> = { sale: "Sale", sales_return: "Credit note", purchase: "Purchase", purchase_return: "Debit note", receipt: "Receipt", payment: "Payment", journal: "Voucher" };

export const financialRoutes = new Hono<AppEnv>();
for (const path of ["/financials/*", "/ledgers/:id/opening"]) financialRoutes.use(path, requireAuth);

financialRoutes
  .get("/financials/trial-balance", validate("query", asOfQuery), async (c) => {
    const { to } = c.req.valid("query");
    const b = await balancesAsOf(c.env.DB, to);
    const list: AccountBalance[] = [
      ...b.ledgers.filter((l) => l.bal !== 0).map((l) => ({ key: `ledger:${l.id}`, name: l.name, groupName: l.group_name, nature: l.nature, balancePaise: l.bal })),
      ...b.parties
        .filter((p) => p.bal !== 0)
        .map((p) => ({ key: `party:${p.id}`, name: p.name, groupName: p.bal > 0 ? "Sundry Debtors" : "Sundry Creditors", nature: (p.bal > 0 ? "asset" : "liability") as AccountBalance["nature"], balancePaise: p.bal })),
    ].sort((x, y) => x.groupName.localeCompare(y.groupName) || x.name.localeCompare(y.name));
    const all = [...list.map((r) => r.balancePaise), b.openingStock, b.openingDifference];
    const body: TrialBalance = {
      to,
      rows: list,
      openingStockPaise: b.openingStock,
      openingDifferencePaise: b.openingDifference,
      totalDebitPaise: all.filter((v) => v > 0).reduce((s, v) => s + v, 0),
      totalCreditPaise: -all.filter((v) => v < 0).reduce((s, v) => s + v, 0),
    };
    return c.json(body);
  })

  .get("/financials/profit-loss", validate("query", periodQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    return c.json(await profitAndLoss(c.env.DB, from, to));
  })

  .get("/financials/balance-sheet", validate("query", asOfQuery), async (c) => {
    const { to } = c.req.valid("query");
    const db = c.env.DB;
    const b = await balancesAsOf(db, to);
    // Cumulative profit up to `to` = −(income/expense balances) − opening stock + closing stock.
    const ie = b.ledgers.filter((l) => l.nature === "income" || l.nature === "expense").reduce((s, l) => s + l.bal, 0);
    const profit = -ie - b.openingStock + b.closingStock;

    const liab = new Map<string, BsGroup>();
    const assets = new Map<string, BsGroup>();
    const add = (side: Map<string, BsGroup>, group: string, name: string, amount: number) => {
      if (amount === 0) return;
      const g = side.get(group) ?? { name: group, amountPaise: 0, items: [] };
      g.amountPaise += amount;
      g.items.push({ name, amountPaise: amount });
      side.set(group, g);
    };
    for (const l of b.ledgers) {
      if (l.nature === "asset") add(assets, l.root_name, l.name, l.bal);
      else if (l.nature === "liability") add(liab, l.root_name, l.name, -l.bal);
    }
    for (const p of b.parties) {
      if (p.bal > 0) add(assets, "Sundry Debtors", p.name, p.bal);
      else if (p.bal < 0) add(liab, "Sundry Creditors", p.name, -p.bal);
    }
    add(assets, "Closing Stock", "Stock-in-hand (weighted average cost)", b.closingStock);
    add(liab, "Capital Account", "Difference in opening balances", -b.openingDifference);
    add(liab, "Profit & Loss A/c", profit >= 0 ? "Net profit (to date)" : "Net loss (to date)", profit);

    const order = (side: Map<string, BsGroup>, first: string[]) =>
      [...side.values()].sort((x, y) => {
        const ix = first.indexOf(x.name), iy = first.indexOf(y.name);
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.name.localeCompare(y.name);
      });
    const liabilities = order(liab, ["Capital Account", "Profit & Loss A/c", "Sundry Creditors", "Duties & Taxes"]);
    const assetList = order(assets, ["Closing Stock", "Sundry Debtors", "Cash-in-Hand", "Bank Accounts"]);
    const body: BalanceSheet = {
      to,
      liabilities,
      assets: assetList,
      totalLiabilitiesPaise: liabilities.reduce((s, g) => s + g.amountPaise, 0),
      totalAssetsPaise: assetList.reduce((s, g) => s + g.amountPaise, 0),
      profitPaise: profit,
    };
    return c.json(body);
  })

  .get("/financials/ledger/:id", validate("query", ledgerReportQuery), async (c) => {
    const id = idParam(c);
    const q = c.req.valid("query");
    const to = q.to ?? todayIst();
    const from = q.from ?? `20${financialYear(to).slice(0, 2)}-04-01`;
    if (from > to) throw new AppError(400, "VALIDATION", "From date is after To date", { fields: { from: ["From date is after To date"] } });
    const db = c.env.DB;
    const [led, before, lines] = await db.batch([
      db.prepare("SELECT l.id, l.name, l.opening_balance_paise, g.name AS group_name, g.nature FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id WHERE l.id = ?1").bind(id),
      db
        .prepare(
          `SELECT COALESCE(SUM(jl.debit_paise - jl.credit_paise), 0) AS b FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
            WHERE jl.ledger_id = ?1 AND e.status = 'posted' AND e.entry_date < ?2`,
        )
        .bind(id, from),
      db
        .prepare(
          `SELECT e.entry_date, e.source_type, e.narration, ${DOC_NO} AS doc_no, SUM(jl.debit_paise) AS dr, SUM(jl.credit_paise) AS cr
             FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
            WHERE jl.ledger_id = ?1 AND e.status = 'posted' AND e.entry_date BETWEEN ?2 AND ?3
            GROUP BY e.id ORDER BY e.entry_date, e.id LIMIT 5001`,
        )
        .bind(id, from, to),
    ]);
    const l = first(led);
    if (!l.id) throw notFound("Ledger");
    const isIncomeExpense = l.nature === "income" || l.nature === "expense";
    // Income/expense ledgers restart each period (no opening for P&L heads).
    const openingPaise = isIncomeExpense ? 0 : l.opening_balance_paise + (first(before).b as number);
    let running = openingPaise;
    const list = rows(lines);
    const out: LedgerReportLine[] = list.slice(0, 5000).map((r) => {
      running += r.dr - r.cr;
      return { date: r.entry_date, docType: DOC_TYPE[r.source_type] ?? r.source_type, docNo: r.doc_no ?? "", narration: r.narration, debitPaise: r.dr, creditPaise: r.cr, balancePaise: running };
    });
    const body: LedgerReport = {
      ledger: { id: l.id, name: l.name, groupName: l.group_name, nature: l.nature },
      from,
      to,
      openingPaise,
      lines: out,
      closingPaise: running,
      truncated: list.length > 5000,
    };
    return c.json(body);
  })

  // Opening balance at go-live (cash in hand, bank, capital, loans…).
  .put("/ledgers/:id/opening", validate("json", ledgerOpeningSchema), async (c) => {
    const id = idParam(c);
    const { openingBalancePaise, updatedAt } = c.req.valid("json");
    const db = c.env.DB;
    const l = await db
      .prepare("SELECT l.id, l.name, l.opening_balance_paise, l.updated_at, g.nature FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id WHERE l.id = ?1")
      .bind(id)
      .first<Row>();
    if (!l) throw notFound("Ledger");
    if (l.nature !== "asset" && l.nature !== "liability") {
      throw new AppError(400, "VALIDATION", "Only asset and liability ledgers carry an opening balance.", { fields: { openingBalancePaise: ["Not for income/expense ledgers"] } });
    }
    if (l.updated_at !== updatedAt) throw conflict();
    const [update] = await db.batch([
      db.prepare("UPDATE ledgers SET opening_balance_paise = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4").bind(openingBalancePaise, nextStamp(updatedAt), id, updatedAt),
      auditIfChanged(c, "ledger.opening_changed", { id, name: l.name, fromPaise: l.opening_balance_paise, toPaise: openingBalancePaise }),
    ]);
    if (!update?.meta.changes) throw conflict();
    return c.json({ ok: true });
  });
