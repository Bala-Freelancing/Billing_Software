import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIst } from "../shared/gst";
import { gstinProblem } from "../shared/india";
import type { GstSlab, ListResponse, Party, Product, ShopSettings } from "../shared/masters";
import { amountInWords, financialYear } from "../shared/sales";
import type { SaleDetail } from "../shared/sales";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let counter: Party;
let tn: Party;
let ka: Party;
let fan: Product; // serial, MRP ₹5000
let wire: Product; // quantity
const today = todayIst();
const FY = financialYear(today);
const uid = () => crypto.randomUUID();
let serialNo = 0;

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
function gstin(first14: string) {
  for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (gstinProblem(first14 + ch) === null) return first14 + ch;
  throw new Error("x");
}

/** Purchases n fan units and returns their serials. */
async function stockFans(n: number): Promise<string[]> {
  const serials = Array.from({ length: n }, () => `SFAN${++serialNo}`);
  await json(await post("/api/purchases", {
    uid: uid(), supplierId: supplierId, supplierInvoiceNo: `S-${serialNo}-${Math.random()}`.slice(0, 30), invoiceDate: today, ratesIncludeGst: true, notes: "",
    lines: [{ productId: fan.id, quantity: n, ratePaise: 350000, serials }],
  }));
  return serials;
}
let supplierId = 0;

function saleBody(o: Record<string, unknown> = {}) {
  return {
    uid: uid(), customerId: tn.id, billName: "", billPhone: "", billGstin: "", billStateCode: "",
    invoiceDate: today, collectionType: "credit", dueDate: today, salesman: "Ravi", remarks: "", lines: [], ...o,
  };
}

async function trialBalanceIsZero() {
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(debit_paise),0) - COALESCE(SUM(credit_paise),0) AS d FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id WHERE e.status = 'posted'",
  ).first<{ d: number }>();
  return r?.d === 0;
}
async function partyBalance(partyId: number) {
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(debit_paise - credit_paise),0) AS b FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id WHERE e.status = 'posted' AND jl.party_id = ?1",
  ).bind(partyId).first<{ b: number }>();
  return r?.b ?? 0;
}
const stock = async (id: number) => (await json<Product>(await get(`/api/products/${id}`))).inStock;

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  const parties = await json<ListResponse<Party>>(await get("/api/parties?q=Counter"));
  counter = parties.items.find((p) => p.isCounter) as Party;
  const party = (o: Record<string, unknown>) => post("/api/parties", { phone: "", email: "", gstin: "", address: "", city: "", pincode: "", openingBalancePaise: 0, isActive: true, ...o });
  supplierId = (await json<Party>(await party({ name: "Havells Supplier", partyType: "supplier", stateCode: "33" }))).id;
  tn = await json(await party({ name: "Trichy Electricals", partyType: "customer", stateCode: "33", gstin: gstin("33AABCT1234F1Z") }));
  ka = await json(await party({ name: "Bangalore Traders", partyType: "customer", stateCode: "29", gstin: gstin("29AABCB1234F1Z") }));
  const slabs = await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"));
  const s18 = slabs.items.find((s) => s.rateBp === 1800)?.id;
  const product = (o: Record<string, unknown>) => post("/api/products", { brand: "Havells", category: "", hsnCode: "8414", gstSlabId: s18, unit: "PCS", mrpPaise: 500000, sellingPricePaise: 450000, barcode: "", tracksSerial: true, isActive: true, ...o });
  fan = await json(await product({ name: "Sale Fan" }));
  wire = await json(await product({ name: "Sale Wire", unit: "COIL", tracksSerial: false, mrpPaise: 200000, sellingPricePaise: 180000 }));
  await json(await post("/api/opening-stock", { uid: uid(), productId: wire.id, quantity: 10, ratePaise: 100000, serials: [] }));
});
afterAll(async () => {
  await ctx.dispose();
});

describe("helpers", () => {
  it("works out the financial year and writes amounts in Indian words", () => {
    expect(financialYear("2026-04-01")).toBe("2627");
    expect(financialYear("2026-03-31")).toBe("2526");
    expect(financialYear("2099-12-31")).toBe("9900");
    expect(amountInWords(1234550)).toBe("Rupees Twelve Thousand Three Hundred Forty Five and Fifty Paise Only");
    expect(amountInWords(1_23_45_678_00)).toBe("Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });

  it("aborts a batch when a guard fails", async () => {
    await expect(env.DB.prepare("INSERT INTO batch_guards (ok) VALUES (0)").run()).rejects.toThrow(/CHECK/);
  });
});

describe("sales invoice", () => {
  it("bills scanned serials on credit: numbered, stock out, customer owes the total", async () => {
    const [a, b] = await stockFans(2);
    const before = await stock(fan.id);
    const balanceBefore = await partyBalance(tn.id);
    const res = await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 2, ratePaise: 450000, serials: [a, b] }, { productId: wire.id, quantity: 3, ratePaise: 180000, serials: [] }] }));
    expect(res.status).toBe(201);
    const s = (await res.json()) as SaleDetail;
    expect(s.invoiceNo).toMatch(new RegExp(`^${FY}/SV/\\d{4}$`));
    expect(s.items[0]?.serials).toEqual([a, b]);
    expect(s.isInterstate).toBe(false);
    expect(s.cgstPaise).toBeGreaterThan(0);
    expect(s.totalPaise).toBe(2 * 450000 + 3 * 180000); // GST-inclusive rates, already whole rupees
    expect(await stock(fan.id)).toBe(before - 2);
    expect(await partyBalance(tn.id)).toBe(balanceBefore + s.totalPaise);
    expect(await trialBalanceIsZero()).toBe(true);
    const scan = await json<{ status: string }>(await get(`/api/scan/${a}`));
    expect(scan.status).toBe("sold");
  });

  it("numbers invoices consecutively and per financial year", async () => {
    const [a, b, c] = await stockFans(3);
    const n1 = (await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] })))).invoiceNo;
    const n2 = (await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [b] }] })))).invoiceNo;
    expect(Number(n2.slice(-4))).toBe(Number(n1.slice(-4)) + 1);
    const old = await json<SaleDetail>(await post("/api/sales", saleBody({ invoiceDate: "2026-03-31", dueDate: "2026-03-31", lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [c] }] })));
    expect(old.invoiceNo).toBe("2526/SV/0001");
  });

  it("records payment for an immediate (cash) bill so the customer owes nothing", async () => {
    const [a] = await stockFans(1);
    const before = await partyBalance(tn.id);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ collectionType: "immediate", lines: [{ productId: fan.id, quantity: 1, ratePaise: 450000, serials: [a] }] })));
    expect(s.journal.some((j) => j.account === "Cash" && j.debitPaise === s.totalPaise)).toBe(true);
    expect(await partyBalance(tn.id)).toBe(before);
    expect(await trialBalanceIsZero()).toBe(true);
  });

  it("supports walk-in counter bills, which must be paid immediately", async () => {
    const [a] = await stockFans(1);
    const credit = await post("/api/sales", saleBody({ customerId: counter.id, collectionType: "credit", lines: [{ productId: fan.id, quantity: 1, ratePaise: 450000, serials: [a] }] }));
    expect(credit.status).toBe(400);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ customerId: counter.id, collectionType: "immediate", billName: "Kumar", billPhone: "9876543210", lines: [{ productId: fan.id, quantity: 1, ratePaise: 450000, serials: [a] }] })));
    expect(s.bill).toMatchObject({ name: "Kumar", phone: "9876543210", stateCode: "33" });
    expect(s.customer.isCounter).toBe(true);
  });

  it("charges IGST to an out-of-state customer", async () => {
    const [a] = await stockFans(1);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ customerId: ka.id, lines: [{ productId: fan.id, quantity: 1, ratePaise: 472000, serials: [a] }] })));
    expect(s).toMatchObject({ isInterstate: true, cgstPaise: 0, sgstPaise: 0, igstPaise: 72000, taxablePaise: 400000 });
  });

  it("refuses to sell a unit twice, a wrong or unknown serial, above MRP, or beyond stock", async () => {
    const [a] = await stockFans(1);
    await json(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] })));
    expect((await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] }))).status).toBe(400);
    expect((await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: ["NEVER-BOUGHT"] }] }))).status).toBe(400);
    const [b] = await stockFans(1);
    expect((await post("/api/sales", saleBody({ lines: [{ productId: wire.id, quantity: 1, ratePaise: 100, serials: [b] }] }))).status).toBe(400);
    expect((await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 500001, serials: [b] }] }))).status).toBe(400);
    expect((await post("/api/sales", saleBody({ lines: [{ productId: wire.id, quantity: 999, ratePaise: 100, serials: [] }] }))).status).toBe(400);
    expect((await post("/api/sales", saleBody({ customerId: supplierId, lines: [{ productId: fan.id, quantity: 1, ratePaise: 1, serials: [b] }] }))).status).toBe(400);
  });

  it("sells a unit only once when two bills race for it", async () => {
    const [a] = await stockFans(1);
    const body = () => saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] });
    const results = await Promise.all([post("/api/sales", body()), post("/api/sales", body()), post("/api/sales", body())]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const sold = await env.DB.prepare("SELECT COUNT(*) AS n FROM sale_items WHERE serials LIKE ?1").bind(`%"${a}"%`).first<{ n: number }>();
    expect(sold?.n).toBe(1);
  });

  it("is idempotent", async () => {
    const [a] = await stockFans(1);
    const body = saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] });
    const r1 = await post("/api/sales", body);
    const r2 = await post("/api/sales", body);
    expect([r1.status, r2.status]).toEqual([201, 200]);
  });

  it("shares an invoice by an unguessable link that opens without login", async () => {
    const [a] = await stockFans(1);
    const sale = await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] })));
    const { token } = await json<{ token: string }>(await post(`/api/sales/${sale.id}/share`, {}));
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // Sharing again returns the same link and writes no second audit row.
    expect((await json<{ token: string }>(await post(`/api/sales/${sale.id}/share`, {}))).token).toBe(token);
    const audits = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sale.shared' AND details LIKE ?1").bind(`%"id":${sale.id}}%`).first<{ n: number }>();
    expect(audits?.n).toBe(1);

    const pub = await call(env, `/api/public/invoices/${token}`); // no cookie
    expect(pub.status).toBe(200);
    expect(pub.headers.get("Cache-Control")).toBe("no-store");
    const body = (await pub.json()) as { sale: SaleDetail; shop: ShopSettings };
    expect(body.sale.invoiceNo).toBe(sale.invoiceNo);
    expect(body.sale.journal).toEqual([]);
    expect(body.shop.shopName).toBeTruthy();

    for (const bad of ["short", `${token.slice(0, 31)}!`, "A".repeat(32)]) expect((await call(env, `/api/public/invoices/${bad}`)).status).toBe(404);
    expect((await call(env, `/api/sales/${sale.id}/share`, { method: "POST", body: {} })).status).toBe(401);
    expect((await post("/api/sales/999999/share", {})).status).toBe(404);
  });

  it("uses the invoice prefix from settings", async () => {
    const settings = await json<ShopSettings>(await get("/api/settings/shop"));
    await json(await call(env, "/api/settings/shop", { method: "PUT", body: { ...settings, invoicePrefix: "svc" }, cookie }));
    const [a] = await stockFans(1);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] })));
    expect(s.invoiceNo).toContain("/SVC/");
    const after = await json<ShopSettings>(await get("/api/settings/shop"));
    await json(await call(env, "/api/settings/shop", { method: "PUT", body: { ...after, invoicePrefix: "SV" }, cookie }));
  });
});

describe("cancel invoice", () => {
  it("puts units back in stock, voids the journal and never reuses the number", async () => {
    const [a] = await stockFans(1);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }, { productId: wire.id, quantity: 1, ratePaise: 180000, serials: [] }] })));
    const wireBefore = await stock(wire.id);
    const res = await post(`/api/sales/${s.id}/cancel`, { reason: "Customer cancelled order" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SaleDetail).status).toBe("cancelled");
    expect((await json<{ status: string }>(await get(`/api/scan/${a}`))).status).toBe("in_stock");
    expect(await stock(wire.id)).toBe(wireBefore + 1);
    expect(await trialBalanceIsZero()).toBe(true);
    const next = await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] })));
    expect(Number(next.invoiceNo.slice(-4))).toBe(Number(s.invoiceNo.slice(-4)) + 1);
    expect((await post(`/api/sales/${s.id}/cancel`, { reason: "again please" })).status).toBe(409);
  });
});

describe("sales return", () => {
  it("issues a credit note, returns serials to stock and credits the customer", async () => {
    const [a, b] = await stockFans(2);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 2, ratePaise: 450000, serials: [a, b] }, { productId: wire.id, quantity: 2, ratePaise: 180000, serials: [] }] })));
    const balance = await partyBalance(tn.id);
    const [fanItem, wireItem] = s.items;
    const res = await post("/api/sales-returns", { uid: uid(), saleId: s.id, returnDate: today, reason: "Defective", lines: [{ saleItemId: fanItem?.id, quantity: 1, serials: [a] }, { saleItemId: wireItem?.id, quantity: 1, serials: [] }] });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    const cn = await env.DB.prepare("SELECT credit_note_no, total_paise FROM sales_returns WHERE id = ?1").bind(id).first<{ credit_note_no: string; total_paise: number }>();
    expect(cn?.credit_note_no).toMatch(new RegExp(`^CN/${FY}/\\d{4}$`));
    expect(await partyBalance(tn.id)).toBe(balance - (cn?.total_paise ?? 0));
    expect((await json<{ status: string }>(await get(`/api/scan/${a}`))).status).toBe("in_stock");
    expect(await trialBalanceIsZero()).toBe(true);

    const after = await json<SaleDetail>(await get(`/api/sales/${s.id}`));
    expect(after.items[0]?.serials).toEqual([a, b]); // invoice keeps showing what was sold
    expect(after.items[0]?.returnedSerials).toEqual([a]);

    // Over-return and re-return blocked; invoice can't be cancelled while a return exists.
    expect((await post("/api/sales-returns", { uid: uid(), saleId: s.id, returnDate: today, reason: "", lines: [{ saleItemId: fanItem?.id, quantity: 1, serials: [a] }] })).status).toBe(400);
    expect((await post("/api/sales-returns", { uid: uid(), saleId: s.id, returnDate: today, reason: "", lines: [{ saleItemId: wireItem?.id, quantity: 2, serials: [] }] })).status).toBe(400);
    expect((await post(`/api/sales/${s.id}/cancel`, { reason: "should fail" })).status).toBe(409);

    // Once the returned unit is resold, the return can't be cancelled.
    await json(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 400000, serials: [a] }] })));
    const blocked = await post(`/api/sales-returns/${id}/cancel`, { reason: "Changed mind" });
    expect(blocked.status).toBe(409);
    expect(await errorCode(blocked)).toBe("UNITS_MOVED");
  });

  it("can be cancelled while the returned items are still in stock", async () => {
    const [a] = await stockFans(1);
    const s = await json<SaleDetail>(await post("/api/sales", saleBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 450000, serials: [a] }] })));
    const { id } = await json<{ id: number }>(await post("/api/sales-returns", { uid: uid(), saleId: s.id, returnDate: today, reason: "", lines: [{ saleItemId: s.items[0]?.id, quantity: 1, serials: [a] }] }));
    expect((await post(`/api/sales-returns/${id}/cancel`, { reason: "Entered by mistake" })).status).toBe(204);
    expect((await json<{ status: string }>(await get(`/api/scan/${a}`))).status).toBe("sold");
    expect(await trialBalanceIsZero()).toBe(true);
  });
});

describe("counter customer", () => {
  it("cannot be turned into something else", async () => {
    const res = await call(env, `/api/parties/${counter.id}`, { method: "PUT", body: { ...counter, isActive: false }, cookie });
    expect(res.status).toBe(400);
  });
});

describe("in-stock serials", () => {
  it("lists a product's units in stock", async () => {
    const [a] = await stockFans(1);
    const { items } = await json<{ items: string[] }>(await get(`/api/products/${fan.id}/units`));
    expect(items).toContain(a);
  });
});
