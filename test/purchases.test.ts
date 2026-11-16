import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeBill, todayIst } from "../shared/gst";
import { gstinProblem } from "../shared/india";
import type { GstSlab, Party, Product } from "../shared/masters";
import type { PurchaseDetail } from "../shared/purchase";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let tnSupplier: Party;
let kaSupplier: Party;
let customer: Party;
let fan: Product; // serial-tracked, 18%
let wire: Product; // quantity-tracked, 18%

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
const uid = () => crypto.randomUUID();
const today = todayIst();
let n = 0;
const next = () => ++n;

function gstin(first14: string): string {
  for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (gstinProblem(first14 + ch) === null) return first14 + ch;
  throw new Error("no check digit");
}

async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  const slabs = await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"));
  const s18 = slabs.items.find((s) => s.rateBp === 1800)?.id;
  const party = (o: Record<string, unknown>) =>
    post("/api/parties", { phone: "", email: "", gstin: "", address: "", city: "", pincode: "", openingBalancePaise: 0, isActive: true, ...o });
  tnSupplier = await json(await party({ name: "Havells TN Depot", partyType: "supplier", stateCode: "33", gstin: gstin("33AAACH0351E1Z") }));
  kaSupplier = await json(await party({ name: "Havells KA Depot", partyType: "supplier", stateCode: "29", gstin: gstin("29AAACH0351E1Z") }));
  customer = await json(await party({ name: "Retail Only", partyType: "customer", stateCode: "33" }));
  const product = (o: Record<string, unknown>) =>
    post("/api/products", { brand: "Havells", category: "", hsnCode: "8414", gstSlabId: s18, unit: "PCS", mrpPaise: 500000, sellingPricePaise: 450000, barcode: "", tracksSerial: true, isActive: true, ...o });
  fan = await json(await product({ name: "Test Ceiling Fan" }));
  wire = await json(await product({ name: "Test Wire 90m", unit: "COIL", hsnCode: "8544", tracksSerial: false }));
});
afterAll(async () => {
  await ctx.dispose();
});

function purchaseBody(o: Record<string, unknown> = {}) {
  const i = next();
  return {
    uid: uid(),
    supplierId: tnSupplier.id,
    supplierInvoiceNo: `HV-${i}`,
    invoiceDate: today,
    ratesIncludeGst: false,
    notes: "",
    lines: [
      { productId: fan.id, quantity: 2, ratePaise: 300000, serials: [`FAN-${i}-A`, `FAN-${i}-B`] },
      { productId: wire.id, quantity: 3, ratePaise: 150050, serials: [] },
    ],
    ...o,
  };
}

async function stock(productId: number): Promise<number> {
  return (await json<Product>(await get(`/api/products/${productId}`))).inStock;
}

async function trialBalanceIsZero(): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS diff
       FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id WHERE e.status = 'posted'`,
  ).first<{ diff: number }>();
  return row?.diff === 0;
}

describe("GST arithmetic", () => {
  it("adds GST on exclusive rates and splits CGST/SGST exactly", () => {
    const bill = computeBill([{ quantity: 3, ratePaise: 150050, gstRateBp: 1800 }], { interstate: false, ratesIncludeGst: false });
    expect(bill.taxablePaise).toBe(450150);
    expect(bill.cgstPaise + bill.sgstPaise).toBe(81027);
    expect(bill.totalPaise % 100).toBe(0);
    expect(bill.totalPaise - bill.roundOffPaise).toBe(450150 + 81027);
  });

  it("uses IGST between states and extracts GST from inclusive rates", () => {
    const igst = computeBill([{ quantity: 1, ratePaise: 11800, gstRateBp: 1800 }], { interstate: true, ratesIncludeGst: true });
    expect(igst).toMatchObject({ taxablePaise: 10000, igstPaise: 1800, cgstPaise: 0, sgstPaise: 0, totalPaise: 11800, roundOffPaise: 0 });
  });
});

describe("purchase entry", () => {
  it("posts a purchase: stock up, serials in, balanced journal crediting the supplier", async () => {
    const body = purchaseBody();
    const fanBefore = await stock(fan.id);
    const wireBefore = await stock(wire.id);
    const res = await post("/api/purchases", body);
    expect(res.status).toBe(201);
    const p = (await res.json()) as PurchaseDetail;

    const expected = computeBill(
      [
        { quantity: 2, ratePaise: 300000, gstRateBp: 1800 },
        { quantity: 3, ratePaise: 150050, gstRateBp: 1800 },
      ],
      { interstate: false, ratesIncludeGst: false },
    );
    expect(p).toMatchObject({
      isInterstate: false,
      taxablePaise: expected.taxablePaise,
      cgstPaise: expected.cgstPaise,
      sgstPaise: expected.sgstPaise,
      igstPaise: 0,
      totalPaise: expected.totalPaise,
      status: "posted",
    });
    expect(p.items[0]?.units.map((u) => u.serial)).toEqual(body.lines[0]?.serials);
    expect(await stock(fan.id)).toBe(fanBefore + 2);
    expect(await stock(wire.id)).toBe(wireBefore + 3);

    const dr = p.journal.reduce((a, l) => a + l.debitPaise, 0);
    const cr = p.journal.reduce((a, l) => a + l.creditPaise, 0);
    expect(dr).toBe(cr);
    expect(p.journal.find((l) => l.account === "Havells TN Depot")?.creditPaise).toBe(p.totalPaise);
    expect(p.journal.find((l) => l.account === "Purchase")?.debitPaise).toBe(p.taxablePaise);
    expect(await trialBalanceIsZero()).toBe(true);
  });

  it("uses IGST for an out-of-state supplier", async () => {
    const p = await json<PurchaseDetail>(await post("/api/purchases", purchaseBody({ supplierId: kaSupplier.id })));
    expect(p.isInterstate).toBe(true);
    expect(p.cgstPaise).toBe(0);
    expect(p.igstPaise).toBeGreaterThan(0);
    expect(p.journal.some((l) => l.account === "Input IGST")).toBe(true);
  });

  it("is idempotent: submitting the same form twice creates one purchase", async () => {
    const body = purchaseBody();
    const first = await post("/api/purchases", body);
    const second = await post("/api/purchases", body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as PurchaseDetail).id).toBe(((await first.json()) as PurchaseDetail).id);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM purchases WHERE uid = ?1").bind(body.uid).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("refuses the same supplier invoice number twice", async () => {
    const body = purchaseBody();
    await json(await post("/api/purchases", body));
    const again = await post("/api/purchases", { ...purchaseBody(), supplierInvoiceNo: body.supplierInvoiceNo.toLowerCase() });
    expect(again.status).toBe(400);
  });

  it("refuses serials that already exist, and duplicates within one bill", async () => {
    const body = purchaseBody();
    await json(await post("/api/purchases", body));
    const clash = await post("/api/purchases", purchaseBody({ lines: [{ productId: fan.id, quantity: 1, ratePaise: 1000, serials: [body.lines[0]?.serials[0]?.toLowerCase()] }] }));
    expect(clash.status).toBe(409);
    expect(await errorCode(clash)).toBe("DUPLICATE_SERIAL");

    const twice = await post("/api/purchases", purchaseBody({ lines: [{ productId: fan.id, quantity: 2, ratePaise: 1000, serials: ["SAME-1", "same-1"] }] }));
    expect(twice.status).toBe(400);
  });

  it("requires one serial per unit for serial products and none for others", async () => {
    const wrongCount = await post("/api/purchases", purchaseBody({ lines: [{ productId: fan.id, quantity: 3, ratePaise: 1000, serials: ["ONLY-ONE"] }] }));
    expect(wrongCount.status).toBe(400);
    const serialOnWire = await post("/api/purchases", purchaseBody({ lines: [{ productId: wire.id, quantity: 1, ratePaise: 1000, serials: ["X1"] }] }));
    expect(serialOnWire.status).toBe(400);
  });

  it("validates supplier, date and lines", async () => {
    expect((await post("/api/purchases", purchaseBody({ supplierId: customer.id }))).status).toBe(400);
    expect((await post("/api/purchases", purchaseBody({ invoiceDate: "2999-01-01" }))).status).toBe(400);
    expect((await post("/api/purchases", purchaseBody({ invoiceDate: "2026-02-30" }))).status).toBe(400);
    expect((await post("/api/purchases", purchaseBody({ lines: [] }))).status).toBe(400);
    expect((await post("/api/purchases", purchaseBody({ uid: "not-a-uuid" }))).status).toBe(400);
  });

  it("never trusts totals from the client", async () => {
    const p = await json<PurchaseDetail>(await post("/api/purchases", { ...purchaseBody(), totalPaise: 1, taxablePaise: 1 }));
    expect(p.totalPaise).toBeGreaterThan(1000);
  });
});

describe("cancel purchase", () => {
  it("voids stock and journal, and frees the serials and invoice number for re-entry", async () => {
    const body = purchaseBody();
    const p = await json<PurchaseDetail>(await post("/api/purchases", body));
    const fanBefore = await stock(fan.id);
    const res = await post(`/api/purchases/${p.id}/cancel`, { reason: "Entered wrong supplier" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PurchaseDetail).status).toBe("cancelled");
    expect(await stock(fan.id)).toBe(fanBefore - 2);
    expect(await trialBalanceIsZero()).toBe(true);
    const posted = await env.DB.prepare("SELECT status FROM journal_entries WHERE source_type = 'purchase' AND source_id = ?1").bind(p.id).first<{ status: string }>();
    expect(posted?.status).toBe("cancelled");

    // Same invoice and serials can now be entered correctly.
    const again = await post("/api/purchases", { ...body, uid: uid() });
    expect(again.status).toBe(201);

    expect((await post(`/api/purchases/${p.id}/cancel`, { reason: "again" })).status).toBe(409);
    expect((await post(`/api/purchases/${p.id}/cancel`, { reason: "" })).status).toBe(400);
  });

  it("refuses to cancel once a unit has left stock", async () => {
    const p = await json<PurchaseDetail>(await post("/api/purchases", purchaseBody()));
    const unit = p.items[0]?.units[0];
    await env.DB.prepare("UPDATE product_units SET status = 'sold' WHERE id = ?1").bind(unit?.id).run();
    const res = await post(`/api/purchases/${p.id}/cancel`, { reason: "Trying to cancel" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("UNITS_MOVED");
  });
});

describe("purchase return", () => {
  it("returns chosen serials and a quantity, reverses GST and debits the supplier", async () => {
    const p = await json<PurchaseDetail>(await post("/api/purchases", purchaseBody()));
    const [fanItem, wireItem] = p.items;
    const fanBefore = await stock(fan.id);
    const wireBefore = await stock(wire.id);
    const res = await post("/api/purchase-returns", {
      uid: uid(),
      purchaseId: p.id,
      returnDate: today,
      reason: "Damaged in transit",
      lines: [
        { purchaseItemId: fanItem?.id, quantity: 1, serials: [fanItem?.units[0]?.serial] },
        { purchaseItemId: wireItem?.id, quantity: 2, serials: [] },
      ],
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect(await stock(fan.id)).toBe(fanBefore - 1);
    expect(await stock(wire.id)).toBe(wireBefore - 2);
    expect(await trialBalanceIsZero()).toBe(true);

    const after = await json<PurchaseDetail>(await get(`/api/purchases/${p.id}`));
    expect(after.items[0]?.units[0]?.status).toBe("returned_to_supplier");
    expect(after.items[1]?.returnedQuantity).toBe(2);
    const supplierDebit = await env.DB.prepare(
      `SELECT jl.debit_paise FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
        WHERE e.source_type = 'purchase_return' AND e.source_id = ?1 AND jl.party_id = ?2`,
    ).bind(id, tnSupplier.id).first<{ debit_paise: number }>();
    expect(supplierDebit?.debit_paise).toBeGreaterThan(0);

    // Can't return more than is left, or a serial already returned.
    expect((await post("/api/purchase-returns", { uid: uid(), purchaseId: p.id, returnDate: today, reason: "", lines: [{ purchaseItemId: wireItem?.id, quantity: 2, serials: [] }] })).status).toBe(400);
    expect((await post("/api/purchase-returns", { uid: uid(), purchaseId: p.id, returnDate: today, reason: "", lines: [{ purchaseItemId: fanItem?.id, quantity: 1, serials: [fanItem?.units[0]?.serial] }] })).status).toBe(400);

    // The purchase can't be cancelled while a return exists; cancelling the return restores stock.
    expect((await post(`/api/purchases/${p.id}/cancel`, { reason: "Not allowed yet" })).status).toBe(409);
    expect((await post(`/api/purchase-returns/${id}/cancel`, { reason: "Supplier refused" })).status).toBe(204);
    expect(await stock(fan.id)).toBe(fanBefore);
    expect(await stock(wire.id)).toBe(wireBefore);
    expect(await trialBalanceIsZero()).toBe(true);
    expect((await post(`/api/purchases/${p.id}/cancel`, { reason: "Now allowed" })).status).toBe(200);
  });
});

describe("opening stock", () => {
  it("adds units with serials, blocks duplicates, and can be cancelled while unused", async () => {
    const before = await stock(fan.id);
    const body = { uid: uid(), productId: fan.id, quantity: 2, ratePaise: 280000, serials: ["OPEN-1", "OPEN-2"] };
    expect((await post("/api/opening-stock", body)).status).toBe(201);
    expect((await post("/api/opening-stock", body)).status).toBe(200); // idempotent
    expect(await stock(fan.id)).toBe(before + 2);
    expect((await post("/api/opening-stock", { ...body, uid: uid(), quantity: 1, serials: ["open-1"] })).status).toBe(409);

    const { items } = await json<{ items: { id: number; serials: string[] }[] }>(await get("/api/opening-stock"));
    const entry = items.find((e) => e.serials.includes("OPEN-1"));
    expect((await post(`/api/opening-stock/${entry?.id}/cancel`, { reason: "Counted wrong" })).status).toBe(204);
    expect(await stock(fan.id)).toBe(before);

    const wireBefore = await stock(wire.id);
    expect((await post("/api/opening-stock", { uid: uid(), productId: wire.id, quantity: 5, ratePaise: 100000, serials: [] })).status).toBe(201);
    expect(await stock(wire.id)).toBe(wireBefore + 5);
  });
});

describe("scan after purchase", () => {
  it("finds a purchased serial as an in-stock unit", async () => {
    const body = purchaseBody();
    await json(await post("/api/purchases", body));
    const res = await json<{ kind: string; status: string }>(await get(`/api/scan/${body.lines[0]?.serials[0]}`));
    expect(res).toMatchObject({ kind: "unit", status: "in_stock" });
  });
});
