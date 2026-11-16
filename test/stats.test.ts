import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BalanceSheet } from "../shared/financials";
import { todayIst } from "../shared/gst";
import type { GstSlab, Party, Product } from "../shared/masters";
import type { Overview, SalesStats, StockReport } from "../shared/stats";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let fan: Product;
let switchP: Product;
let retailer: Party;
const today = todayIst();
const uid = () => crypto.randomUUID();

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const daysAgo = (d: number) => new Date(Date.parse(`${today}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);
const sale = async (collectionType: string, lines: { productId: number; quantity: number; ratePaise: number }[], dueDate = today, invoiceDate = today) =>
  json<{ id: number; items: { id: number; productId: number }[] }>(await post("/api/sales", {
    uid: uid(), customerId: retailer.id, billName: "", billPhone: "", billGstin: "", billStateCode: "", invoiceDate, collectionType, dueDate,
    salesman: "", remarks: "", lines: lines.map((l) => ({ ...l, serials: [] })),
  }));

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  const s18 = (await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"))).items.find((s) => s.rateBp === 1800)!.id;
  for (const name of ["Fans", "Switches"]) await json(await post("/api/product-groups", { name, isActive: true }));
  const product = async (o: Record<string, unknown>) =>
    json<Product>(await post("/api/products", { brand: "Havells", hsnCode: "8414", gstSlabId: s18, unit: "NOS", mrpPaise: 300000, sellingPricePaise: 236000, barcode: "", tracksSerial: false, isActive: true, ...o }));
  fan = await product({ name: "Stat Fan", category: "Fans" });
  switchP = await product({ name: "Stat Switch", category: "Switches", sellingPricePaise: 11800, mrpPaise: 20000 });
  await product({ name: "Never Stocked", category: "" });
  await json(await post("/api/opening-stock", { uid: uid(), productId: fan.id, quantity: 4, ratePaise: 100000, serials: [] }));
  await json(await post("/api/opening-stock", { uid: uid(), productId: switchP.id, quantity: 50, ratePaise: 5000, serials: [] }));
  retailer = await json<Party>(await post("/api/parties", { name: "Kumar Electricals", partyType: "customer", stateCode: "33", phone: "", email: "", gstin: "", address: "", city: "", pincode: "", openingBalancePaise: 0, isActive: true }));
  const s1 = await sale("credit", [{ productId: fan.id, quantity: 2, ratePaise: 236000 }, { productId: switchP.id, quantity: 10, ratePaise: 11800 }]);
  // An older credit bill, now overdue (always in an earlier month).
  await sale("credit", [{ productId: switchP.id, quantity: 1, ratePaise: 11800 }], daysAgo(20), daysAgo(40));
  await sale("immediate", [{ productId: switchP.id, quantity: 5, ratePaise: 11800 }]);
  const fanLine = s1.items.find((i) => i.productId === fan.id)!;
  await json(await post("/api/sales-returns", { uid: uid(), saleId: s1.id, returnDate: today, reason: "Faulty", lines: [{ saleItemId: fanLine.id, quantity: 1, serials: [] }] }));
});
afterAll(async () => {
  await ctx.dispose();
});

describe("dashboard overview", () => {
  it("shows today's sales, month net of returns, collections, stock and overdue", async () => {
    const o = await json<Overview>(await get("/api/stats/overview"));
    // Invoice 1: 2 × 2,360 + 10 × 118 = 5,900; invoice 2: 5 × 118 = 590.
    expect(o.salesToday).toEqual({ totalPaise: 590000 + 59000, count: 2 });
    expect(o.salesMonth.totalPaise).toBe(649000 - 236000); // credit note for 1 fan
    expect(o.collectedTodayPaise).toBe(59000); // only the cash bill
    expect(o.cashPaise).toBe(59000);
    expect(o.overdue).toEqual({ amountPaise: 11800, parties: 1 });
    // Stock: fans 4 − 2 + 1 = 3 × ₹1,000; switches 50 − 16 = 34 × ₹50.
    expect(o.stockValuePaise).toBe(300000 + 170000);
    expect(o.outOfStock).toBe(1);
    expect(o.trend).toHaveLength(6);
    expect(o.trend.at(-1)?.salesPaise).toBe(413000);
    expect(o.recentSales).toHaveLength(3);
    // Same valuation as the Balance Sheet.
    const bs = await json<BalanceSheet>(await get(`/api/financials/balance-sheet?to=${today}`));
    expect(bs.assets.find((g) => g.name === "Closing Stock")?.amountPaise).toBe(o.stockValuePaise);
  });
});

describe("sales statistics", () => {
  it("ranks products, customers and groups net of returns", async () => {
    const s = await json<SalesStats>(await get(`/api/stats/sales?from=${today}&to=${today}`));
    expect(s.invoices).toBe(2);
    expect(s.salesTotalPaise).toBe(413000);
    expect(s.averageBillPaise).toBe(206500);
    expect(s.topProducts[0]).toMatchObject({ id: fan.id, quantity: 1, taxablePaise: 200000 });
    expect(s.topProducts.find((p) => p.id === switchP.id)).toMatchObject({ quantity: 15, taxablePaise: 150000 });
    expect(s.topCustomers[0]).toMatchObject({ name: "Kumar Electricals", taxablePaise: 350000 });
    expect(s.byGroup.map((g) => g.name)).toEqual(["Fans", "Switches"]);
    expect(s.months.at(-1)).toMatchObject({ salesPaise: 413000, invoices: 2 });
    expect(await errorCode(await get("/api/stats/sales?from=2024-01-01&to=2026-06-01"))).toBe("VALIDATION");
  });
});

describe("stock report", () => {
  it("lists quantity, average cost and value with filters", async () => {
    const r = await json<StockReport>(await get("/api/stock-report"));
    expect(r.rows.find((x) => x.productId === fan.id)).toMatchObject({ quantity: 3, averageCostPaise: 100000, valuePaise: 300000, sellingValuePaise: 708000 });
    expect(r.totalValuePaise).toBe(470000);
    const low = await json<StockReport>(await get("/api/stock-report?show=low&low=3"));
    expect(low.rows.map((x) => x.productId)).toEqual([fan.id]);
    const out = await json<StockReport>(await get("/api/stock-report?show=out"));
    expect(out.rows.map((x) => x.name)).toEqual(["Never Stocked"]);
    const grp = await json<StockReport>(await get("/api/stock-report?group=Switches"));
    expect(grp.rows.map((x) => x.productId)).toEqual([switchP.id]);
    const search = await json<StockReport>(await get("/api/stock-report?q=stat%20fan"));
    expect(search.rows).toHaveLength(1);
    expect((await call(env, "/api/stock-report", {})).status).toBe(401);
    expect((await call(env, "/api/stats/overview", {})).status).toBe(401);
  });
});
