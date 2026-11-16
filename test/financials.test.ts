import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BalanceSheet, LedgerReport, ProfitAndLoss, TrialBalance } from "../shared/financials";
import { todayIst } from "../shared/gst";
import type { Ledger } from "../shared/ledgers";
import type { GstSlab, ListResponse, Party, Product } from "../shared/masters";
import { financialYear } from "../shared/sales";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let fan: Product;
let supplier: Party;
let customer: Party;
const today = todayIst();
const fyStart = `20${financialYear(today).slice(0, 2)}-04-01`;
const uid = () => crypto.randomUUID();

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
const put = (path: string, body: unknown) => call(env, path, { method: "PUT", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const ledger = async (name: string) => (await json<ListResponse<Ledger>>(await get(`/api/ledgers?q=${encodeURIComponent(name)}`))).items.find((l) => l.name === name)!;
async function setOpening(name: string, paise: number) {
  const l = await ledger(name);
  await json(await put(`/api/ledgers/${l.id}/opening`, { openingBalancePaise: paise, updatedAt: l.updatedAt }));
}

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  const s18 = (await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"))).items.find((s) => s.rateBp === 1800)!.id;
  fan = await json<Product>(await post("/api/products", { brand: "Havells", name: "FS Fan", category: "", hsnCode: "8414", gstSlabId: s18, unit: "NOS", mrpPaise: 300000, sellingPricePaise: 236000, barcode: "", tracksSerial: false, isActive: true }));
  const party = async (o: Record<string, unknown>) =>
    json<Party>(await post("/api/parties", { name: `FS ${Math.random()}`, partyType: "customer", stateCode: "33", phone: "", email: "", gstin: "", address: "", city: "", pincode: "", openingBalancePaise: 0, isActive: true, ...o }));
  supplier = await party({ partyType: "supplier", openingBalancePaise: -40000 }); // we owe ₹400 from before go-live
  customer = await party({ openingBalancePaise: 25000 }); // owes us ₹250

  // Go-live: ₹50,000 cash, ₹1,00,000 capital, 10 fans in stock at ₹1,000 cost.
  await setOpening("Cash", 5_000_000);
  await setOpening("Capital Account", -10_000_000);
  await json(await post("/api/opening-stock", { uid: uid(), productId: fan.id, quantity: 10, ratePaise: 100000, serials: [] }));
  // Buy 10 more at ₹1,000 + 18% GST; sell 5 at ₹2,360 incl. GST for cash; pay ₹2,000 rent.
  await json(await post("/api/purchases", { uid: uid(), supplierId: supplier.id, supplierInvoiceNo: "FS-1", invoiceDate: today, ratesIncludeGst: false, notes: "", lines: [{ productId: fan.id, quantity: 10, ratePaise: 100000, serials: [] }] }));
  await json(await post("/api/sales", {
    uid: uid(), customerId: customer.id, billName: "", billPhone: "", billGstin: "", billStateCode: "", invoiceDate: today, collectionType: "immediate", dueDate: today,
    salesman: "", remarks: "", lines: [{ productId: fan.id, quantity: 5, ratePaise: 236000, serials: [] }],
  }));
  const rent = await ledger("Rent");
  const d = await json<{ id: number; updatedAt: number }>(await post("/api/expenses", { uid: uid(), voucherDate: today, mode: "cash", reference: "", remarks: "", lines: [{ ledgerId: rent.id, amountPaise: 200000, narration: "" }] }));
  await json(await post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt }));
});
afterAll(async () => {
  await ctx.dispose();
});

describe("profit & loss", () => {
  it("values closing stock at weighted-average cost and computes gross and net profit", async () => {
    const pl = await json<ProfitAndLoss>(await get(`/api/financials/profit-loss?from=${fyStart}&to=${today}`));
    expect(pl.salesPaise).toBe(1_000_000); // 5 × ₹2,000 taxable
    expect(pl.purchasesPaise).toBe(1_000_000);
    expect(pl.openingStockPaise).toBe(1_000_000);
    expect(pl.closingStockPaise).toBe(1_500_000); // 15 fans × ₹1,000
    expect(pl.grossProfitPaise).toBe(500_000);
    expect(pl.indirectExpenses).toEqual([{ name: "Rent", amountPaise: 200_000 }]);
    expect(pl.netProfitPaise).toBe(300_000);
  });
});

describe("trial balance", () => {
  it("balances, including opening stock and the opening-balance difference", async () => {
    const tb = await json<TrialBalance>(await get(`/api/financials/trial-balance?to=${today}`));
    expect(tb.totalDebitPaise).toBe(tb.totalCreditPaise);
    expect(tb.openingStockPaise).toBe(1_000_000);
    // Openings: cash +50,000, capital −1,00,000, debtor +250, creditor −400, stock +10,000 → difference = +40,150 (Dr).
    expect(tb.openingDifferencePaise).toBe(-(5_000_000 - 10_000_000 + 25_000 - 40_000 + 1_000_000));
    const cash = tb.rows.find((r) => r.name === "Cash")!;
    expect(cash.balancePaise).toBe(5_000_000 + 1_180_000 - 200_000);
  });
});

describe("balance sheet", () => {
  it("balances and shows profit, stock, debtors and creditors", async () => {
    const bs = await json<BalanceSheet>(await get(`/api/financials/balance-sheet?to=${today}`));
    expect(bs.totalAssetsPaise).toBe(bs.totalLiabilitiesPaise);
    expect(bs.profitPaise).toBe(300_000);
    const group = (side: "assets" | "liabilities", name: string) => bs[side].find((g) => g.name === name);
    expect(group("assets", "Closing Stock")?.amountPaise).toBe(1_500_000);
    expect(group("assets", "Sundry Debtors")?.amountPaise).toBe(25_000);
    expect(group("liabilities", "Sundry Creditors")?.amountPaise).toBe(40_000 + 1_180_000);
    expect(group("liabilities", "Capital Account")?.items.find((i) => i.name === "Capital Account")?.amountPaise).toBe(10_000_000);
  });

  it("still balances as of an earlier date and after a cancellation", async () => {
    const earlier = await json<BalanceSheet>(await get(`/api/financials/balance-sheet?to=${fyStart}`));
    expect(earlier.totalAssetsPaise).toBe(earlier.totalLiabilitiesPaise);
    const sales = await json<ListResponse<{ id: number }>>(await get("/api/sales"));
    await json(await post(`/api/sales/${sales.items[0]!.id}/cancel`, { reason: "Test" }));
    const after = await json<BalanceSheet>(await get(`/api/financials/balance-sheet?to=${today}`));
    expect(after.totalAssetsPaise).toBe(after.totalLiabilitiesPaise);
    expect(after.profitPaise).toBe(-200_000); // only rent remains; stock back to 20 × ₹1,000
  });
});

describe("ledger report and opening balances", () => {
  it("shows a ledger's running balance from its opening", async () => {
    const cash = await ledger("Cash");
    expect(cash.openingBalancePaise).toBe(5_000_000);
    const r = await json<LedgerReport>(await get(`/api/financials/ledger/${cash.id}?from=${fyStart}&to=${today}`));
    expect(r.openingPaise).toBe(5_000_000);
    expect(r.lines.map((l) => l.docType)).toContain("Voucher");
    expect(r.closingPaise).toBe(r.lines.at(-1)?.balancePaise ?? r.openingPaise);
  });

  it("refuses openings on income/expense ledgers and needs login", async () => {
    const rent = await ledger("Rent");
    expect(await errorCode(await put(`/api/ledgers/${rent.id}/opening`, { openingBalancePaise: 100, updatedAt: rent.updatedAt }))).toBe("VALIDATION");
    const cash = await ledger("Cash");
    expect(await errorCode(await put(`/api/ledgers/${cash.id}/opening`, { openingBalancePaise: 1, updatedAt: cash.updatedAt - 1 }))).toBe("CONFLICT");
    expect((await call(env, `/api/financials/trial-balance?to=${today}`, {})).status).toBe(401);
    expect((await call(env, `/api/ledgers/${cash.id}/opening`, { method: "PUT", body: {} })).status).toBe(401);
    const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ledger.opening_changed'").first<{ n: number }>();
    expect(a?.n).toBe(2);
  });
});
