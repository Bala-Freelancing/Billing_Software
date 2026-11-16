import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIst } from "../shared/gst";
import { gstinProblem } from "../shared/india";
import type { Ledger } from "../shared/ledgers";
import type { GstSlab, ListResponse, Party, Product } from "../shared/masters";
import type { GstReport, Register } from "../shared/reports";
import type { SaleDetail } from "../shared/sales";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let fan: Product; // 18%
let wire: Product; // 12%
let shopCustomer: Party; // no GSTIN → B2C
let dealer: Party; // GSTIN → B2B
let supplier: Party;
const today = todayIst();
const uid = () => crypto.randomUUID();
let n = 0;

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
function gstin(state: string) {
  for (const c of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!gstinProblem(`${state}AAACR5555K1Z${c}`)) return `${state}AAACR5555K1Z${c}`;
  throw new Error("no gstin");
}
const party = async (o: Record<string, unknown>) =>
  json<Party>(await post("/api/parties", { name: `P ${++n}`, partyType: "customer", stateCode: "33", phone: "", email: "", gstin: "", address: "", city: "", pincode: "", openingBalancePaise: 0, isActive: true, ...o }));
async function sale(customerId: number, lines: { productId: number; quantity: number; ratePaise: number }[]) {
  return json<SaleDetail>(await post("/api/sales", {
    uid: uid(), customerId, billName: "", billPhone: "", billGstin: "", billStateCode: "", invoiceDate: today, collectionType: "credit", dueDate: today,
    salesman: "", remarks: "", lines: lines.map((l) => ({ ...l, serials: [] })),
  }));
}
const sumRows = (r: GstReport, k: "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise") => r.rows.reduce((s, x) => s + x[k], 0);

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  const slabs = (await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"))).items;
  const slab = (bp: number) => slabs.find((s) => s.rateBp === bp)!.id;
  const product = async (o: Record<string, unknown>) =>
    json<Product>(await post("/api/products", { brand: "Havells", category: "", barcode: "", tracksSerial: false, isActive: true, mrpPaise: 500000, sellingPricePaise: 400000, ...o }));
  fan = await product({ name: "Report Fan", hsnCode: "8414", gstSlabId: slab(1800), unit: "NOS" });
  wire = await product({ name: "Report Wire", hsnCode: "8544", gstSlabId: slab(1200), unit: "COIL" });
  for (const p of [fan, wire]) await json(await post("/api/opening-stock", { uid: uid(), productId: p.id, quantity: 100, ratePaise: 100000, serials: [] }));
  shopCustomer = await party({});
  dealer = await party({ gstin: gstin("33") });
  supplier = await party({ partyType: "supplier", gstin: gstin("29"), stateCode: "29" });
});
afterAll(async () => {
  await ctx.dispose();
});

describe("GST report (sales)", () => {
  it("summarises by slab from stored line GST, nets returns, splits B2B/B2C and skips cancelled bills", async () => {
    const s1 = await sale(dealer.id, [{ productId: fan.id, quantity: 2, ratePaise: 118000 }, { productId: wire.id, quantity: 1, ratePaise: 112000 }]);
    await sale(shopCustomer.id, [{ productId: fan.id, quantity: 1, ratePaise: 118000 }]);
    const cancelled = await sale(shopCustomer.id, [{ productId: fan.id, quantity: 5, ratePaise: 118000 }]);
    await json(await post(`/api/sales/${cancelled.id}/cancel`, { reason: "Wrong" }));
    const fanLine = s1.items.find((i) => i.productId === fan.id)!;
    await json(await post("/api/sales-returns", { uid: uid(), saleId: s1.id, returnDate: today, reason: "Damaged", lines: [{ saleItemId: fanLine.id, quantity: 1, serials: [] }] }));

    const r = await json<GstReport>(await get(`/api/reports/gst?kind=sales&from=${today}&to=${today}`));
    const s18 = r.slabs.find((s) => s.rateBp === 1800)!;
    const s12 = r.slabs.find((s) => s.rateBp === 1200)!;
    // 18%: 3 fans sold − 1 returned = 2 × ₹1,000 taxable; tax ₹180 each.
    expect(s18).toMatchObject({ taxablePaise: 200000, cgstPaise: 18000, sgstPaise: 18000, igstPaise: 0, returnTaxablePaise: 100000 });
    expect(s12).toMatchObject({ taxablePaise: 100000, cgstPaise: 6000, sgstPaise: 6000 });
    expect(r.net.taxablePaise).toBe(300000);
    expect(r.b2b!.taxablePaise + r.b2c!.taxablePaise).toBe(300000);
    expect(r.b2c!.taxablePaise).toBe(100000);
    // Rows add up to the summary (returns are negative rows).
    expect(sumRows(r, "taxablePaise")).toBe(r.net.taxablePaise);
    expect(sumRows(r, "cgstPaise")).toBe(r.net.cgstPaise);
    expect(r.rows.some((x) => x.docNo === cancelled.invoiceNo)).toBe(false);
    expect(r.rows.filter((x) => x.docType === "return").every((x) => x.taxablePaise < 0)).toBe(true);
    expect(r.hsn.find((h) => h.hsnCode === "8414")).toMatchObject({ quantity: 2, taxablePaise: 200000 });
  });

  it("filters by GST slab", async () => {
    const r = await json<GstReport>(await get(`/api/reports/gst?kind=sales&from=${today}&to=${today}&rates=1200`));
    expect(r.rates).toEqual([1200]);
    expect(r.slabs.map((s) => s.rateBp)).toEqual([1200]);
    expect(r.rows.every((x) => x.rateBp === 1200)).toBe(true);
    expect(r.net.taxablePaise).toBe(100000);
  });
});

describe("GST report (purchase)", () => {
  it("includes purchase bills (IGST from another state) and GST expense bills as input credit", async () => {
    await json(await post("/api/purchases", {
      uid: uid(), supplierId: supplier.id, supplierInvoiceNo: "KA-1", invoiceDate: today, ratesIncludeGst: false, notes: "",
      lines: [{ productId: fan.id, quantity: 10, ratePaise: 50000, serials: [] }],
    }));
    const rent = (await json<ListResponse<Ledger>>(await get("/api/ledgers?q=Rent"))).items[0]!;
    const d = await json<{ id: number; updatedAt: number }>(await post("/api/expenses", {
      uid: uid(), voucherDate: today, mode: "cash", reference: "", remarks: "", gstBill: true, supplierName: "Landlord", supplierGstin: gstin("33"),
      supplierInvoiceNo: "R-7", supplierInvoiceDate: today, lines: [{ ledgerId: rent.id, amountPaise: 1000000, gstRateBp: 1800, narration: "" }],
    }));
    const draftOnly = await json<GstReport>(await get(`/api/reports/gst?kind=purchase&from=${today}&to=${today}`));
    expect(draftOnly.rows.some((x) => x.docType === "expense")).toBe(false); // drafts don't count
    await json(await post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt }));

    const r = await json<GstReport>(await get(`/api/reports/gst?kind=purchase&from=${today}&to=${today}&rates=1800`));
    expect(r.b2b).toBeNull();
    const s18 = r.slabs[0]!;
    expect(s18.igstPaise).toBe(90000); // 10 × ₹500 × 18%
    expect(s18.cgstPaise).toBe(90000); // rent ₹10,000 × 9%
    expect(s18.taxablePaise).toBe(500000 + 1000000);
    expect(r.rows.find((x) => x.docType === "expense")).toMatchObject({ docNo: "R-7", partyName: "Landlord" });
  });
});

describe("registers", () => {
  it("lists invoices and returns with net totals; can include cancelled", async () => {
    const r = await json<Register>(await get(`/api/reports/register?kind=sales&from=${today}&to=${today}`));
    expect(r.rows.every((x) => x.status === "posted")).toBe(true);
    const invoices = r.rows.filter((x) => x.docType === "invoice").reduce((s, x) => s + x.totalPaise, 0);
    const returns = r.rows.filter((x) => x.docType === "return").reduce((s, x) => s + x.totalPaise, 0);
    expect(r.net.totalPaise).toBe(invoices - returns);
    const all = await json<Register>(await get(`/api/reports/register?kind=sales&from=${today}&to=${today}&status=all`));
    expect(all.rows.some((x) => x.status === "cancelled")).toBe(true);
    expect(all.net.totalPaise).toBe(r.net.totalPaise);
    const one = await json<Register>(await get(`/api/reports/register?kind=sales&from=${today}&to=${today}&partyId=${dealer.id}`));
    expect(one.rows.every((x) => x.partyName === dealer.name)).toBe(true);
    const pur = await json<Register>(await get(`/api/reports/register?kind=purchase&from=${today}&to=${today}`));
    expect(pur.rows.map((x) => x.docNo)).toContain("KA-1");
  });

  it("validates ranges and requires login", async () => {
    expect(await errorCode(await get(`/api/reports/gst?kind=sales&from=2026-05-01&to=2026-04-01`))).toBe("VALIDATION");
    expect(await errorCode(await get(`/api/reports/gst?kind=sales&from=2024-04-01&to=2026-04-01`))).toBe("VALIDATION");
    expect(await errorCode(await get(`/api/reports/gst?kind=sales&from=${today}&to=${today}&rates=abc`))).toBe("VALIDATION");
    expect((await call(env, `/api/reports/gst?kind=sales&from=${today}&to=${today}`, {})).status).toBe(401);
  });
});
