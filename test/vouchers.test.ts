import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIst } from "../shared/gst";
import type { GstSlab, ListResponse, Party, Product } from "../shared/masters";
import type { SaleDetail } from "../shared/sales";
import { allocateOldestFirst, type OutstandingBill, type OutstandingParty, type Statement, type VoucherDetail } from "../shared/vouchers";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let wire: Product; // ₹1,800 a coil, GST inclusive
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
const daysAgo = (d: number) => new Date(Date.parse(`${today}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);

async function newParty(o: Record<string, unknown> = {}): Promise<Party> {
  return json(await post("/api/parties", { name: `Party ${++n}`, partyType: "customer", stateCode: "33", phone: "", email: "", gstin: "", address: "", city: "", pincode: "", openingBalancePaise: 0, isActive: true, ...o }));
}
async function creditSale(customerId: number, coils: number, date = today): Promise<SaleDetail> {
  return json(await post("/api/sales", {
    uid: uid(), customerId, billName: "", billPhone: "", billGstin: "", billStateCode: "", invoiceDate: date, collectionType: "credit", dueDate: date,
    salesman: "", remarks: "", lines: [{ productId: wire.id, quantity: coils, ratePaise: 180000, serials: [] }],
  }));
}
function voucher(o: Record<string, unknown>) {
  return { uid: uid(), kind: "receipt", voucherDate: today, amountPaise: 0, discountPaise: 0, mode: "cash", reference: "", remarks: "", ...o };
}
const openBills = async (partyId: number, kind = "receipt") => (await json<{ items: OutstandingBill[] }>(await get(`/api/accounts/parties/${partyId}/open-bills?kind=${kind}`))).items;
async function balance(partyId: number) {
  const p = await env.DB.prepare(
    `SELECT opening_balance_paise + COALESCE((SELECT SUM(debit_paise - credit_paise) FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
       WHERE e.status = 'posted' AND jl.party_id = ?1), 0) AS b FROM parties WHERE id = ?1`,
  ).bind(partyId).first<{ b: number }>();
  return p?.b ?? 0;
}
async function trialBalanceIsZero() {
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(debit_paise),0) - COALESCE(SUM(credit_paise),0) AS d FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id WHERE e.status = 'posted'",
  ).first<{ d: number }>();
  return r?.d === 0;
}
async function ledgerBalance(key: string) {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(debit_paise - credit_paise),0) AS b FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
      JOIN ledgers l ON l.id = jl.ledger_id WHERE e.status = 'posted' AND l.system_key = ?1`,
  ).bind(key).first<{ b: number }>();
  return r?.b ?? 0;
}

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  supplier = await newParty({ name: "Havells India", partyType: "supplier" });
  const slabs = await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"));
  wire = await json(await post("/api/products", {
    name: "Voucher Wire", brand: "Havells", category: "", hsnCode: "8544", gstSlabId: slabs.items.find((s) => s.rateBp === 1800)?.id, unit: "COIL",
    mrpPaise: 200000, sellingPricePaise: 180000, barcode: "", tracksSerial: false, isActive: true,
  }));
  await json(await post("/api/opening-stock", { uid: uid(), productId: wire.id, quantity: 500, ratePaise: 100000, serials: [] }));
});
afterAll(async () => {
  await ctx.dispose();
});

describe("allocation helper", () => {
  it("settles the opening balance first, then the oldest bills", () => {
    const bill = (targetType: OutstandingBill["targetType"], targetId: number, docDate: string, outstandingPaise: number): OutstandingBill => ({
      targetType, targetId, docNo: "", docDate, dueDate: docDate, billAmountPaise: outstandingPaise, outstandingPaise, daysPending: 0, overdue: false,
    });
    const bills = [bill("sale", 2, "2026-05-02", 500), bill("sale", 1, "2026-05-01", 300), bill("opening", 9, "2026-06-01", 100)];
    expect(allocateOldestFirst(bills, 600)).toEqual([
      { targetType: "opening", targetId: 9, amountPaise: 100 },
      { targetType: "sale", targetId: 1, amountPaise: 300 },
      { targetType: "sale", targetId: 2, amountPaise: 200 },
    ]);
    expect(allocateOldestFirst(bills, 0)).toEqual([]);
  });
});

describe("receipts", () => {
  it("settles oldest invoices first, keeps the rest as advance and posts a balanced journal", async () => {
    const c = await newParty({ openingBalancePaise: 50000 });
    const old = await creditSale(c.id, 1, daysAgo(40)); // ₹1,800
    const recent = await creditSale(c.id, 2); // ₹3,600
    const cashBefore = await ledgerBalance("cash");
    const res = await post("/api/vouchers", voucher({ partyId: c.id, amountPaise: 300000 }));
    expect(res.status).toBe(201);
    const v = (await res.json()) as VoucherDetail;
    expect(v.voucherNo).toMatch(/^\d{4}\/RCT\/\d{4}$/);
    expect(v.allocations.map((a) => [a.targetType, a.amountPaise])).toEqual([["opening", 50000], ["sale", 180000], ["sale", 70000]]);
    expect(v.advancePaise).toBe(0);
    expect(await ledgerBalance("cash")).toBe(cashBefore + 300000);
    expect(await balance(c.id)).toBe(50000 + 540000 - 300000);
    expect(await trialBalanceIsZero()).toBe(true);
    const open = await openBills(c.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ targetId: recent.id, outstandingPaise: 290000 });
    expect(old.id).toBeLessThan(recent.id);

    // Over-payment: settles the rest, remainder stays on the party as advance (credit balance).
    const v2 = await json<VoucherDetail>(await post("/api/vouchers", voucher({ partyId: c.id, amountPaise: 300000, mode: "upi", reference: "UPI123" })));
    expect(v2.advancePaise).toBe(10000);
    expect(await balance(c.id)).toBe(-10000);
    expect(await openBills(c.id)).toEqual([]);
    expect(v2.journal.find((j) => j.account === "Bank Account")?.debitPaise).toBe(300000);
  });

  it("is idempotent: the same uid returns the first voucher", async () => {
    const c = await newParty();
    await creditSale(c.id, 1);
    const body = voucher({ partyId: c.id, amountPaise: 100000 });
    const a = await json<VoucherDetail>(await post("/api/vouchers", body));
    const b = await json<VoucherDetail>(await post("/api/vouchers", body));
    expect(b.id).toBe(a.id);
    expect(await balance(c.id)).toBe(80000);
  });

  it("accepts edited allocations and a settlement discount", async () => {
    const c = await newParty();
    const s1 = await creditSale(c.id, 1, daysAgo(10));
    const s2 = await creditSale(c.id, 1);
    // Pay the newer invoice in full with ₹50 discount, leave the older one.
    const v = await json<VoucherDetail>(await post("/api/vouchers", voucher({
      partyId: c.id, amountPaise: 175000, discountPaise: 5000, allocations: [{ targetType: "sale", targetId: s2.id, amountPaise: 180000 }],
    })));
    expect(v.allocations).toEqual([expect.objectContaining({ targetId: s2.id, amountPaise: 180000 })]);
    expect(v.journal).toEqual(expect.arrayContaining([expect.objectContaining({ account: "Discount Allowed", debitPaise: 5000 })]));
    expect((await openBills(c.id)).map((b) => b.targetId)).toEqual([s1.id]);
    expect(await balance(c.id)).toBe(180000);
    expect(await trialBalanceIsZero()).toBe(true);
  });

  it("refuses over-allocation, foreign bills, discounts as advance and cheques without number", async () => {
    const c = await newParty();
    const other = await newParty();
    const s = await creditSale(c.id, 1);
    const foreign = await creditSale(other.id, 1);
    const bad = async (o: Record<string, unknown>) => errorCode(await post("/api/vouchers", voucher({ partyId: c.id, ...o })));
    expect(await bad({ amountPaise: 200000, allocations: [{ targetType: "sale", targetId: s.id, amountPaise: 190000 }] })).toBe("VALIDATION");
    expect(await bad({ amountPaise: 100000, allocations: [{ targetType: "sale", targetId: foreign.id, amountPaise: 100000 }] })).toBe("VALIDATION");
    expect(await bad({ amountPaise: 100000, allocations: [{ targetType: "purchase", targetId: 1, amountPaise: 100000 }] })).toBe("VALIDATION");
    expect(await bad({ amountPaise: 500000, discountPaise: 100 })).toBe("VALIDATION");
    expect(await bad({ amountPaise: 100, mode: "cheque" })).toBe("VALIDATION");
    expect(await bad({ amountPaise: 0 })).toBe("VALIDATION");
    expect(await bad({ partyId: supplier.id, amountPaise: 100 })).toBe("VALIDATION");
    expect(await openBills(c.id)).toHaveLength(1);
  });

  it("lets only one of two simultaneous receipts settle the same invoice", async () => {
    const c = await newParty();
    const s = await creditSale(c.id, 1);
    const alloc = [{ targetType: "sale", targetId: s.id, amountPaise: 180000 }];
    const results = await Promise.all([1, 2, 3].map(() => post("/api/vouchers", voucher({ partyId: c.id, amountPaise: 180000, allocations: alloc }))));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(["OUTSTANDING_CHANGED", "VALIDATION"]).toContain(await errorCode(r));
    expect(await balance(c.id)).toBe(0);
  });

  it("cancels a receipt: the invoice is open again and the journal is reversed", async () => {
    const c = await newParty();
    const s = await creditSale(c.id, 1);
    const v = await json<VoucherDetail>(await post("/api/vouchers", voucher({ partyId: c.id, amountPaise: 180000 })));
    // The invoice can't be cancelled while a receipt settles it.
    expect(await errorCode(await post(`/api/sales/${s.id}/cancel`, { reason: "Wrong bill" }))).toBe("HAS_RECEIPTS");
    const cancelled = await json<VoucherDetail>(await post(`/api/vouchers/${v.id}/cancel`, { reason: "Cheque bounced" }));
    expect(cancelled.status).toBe("cancelled");
    expect(await errorCode(await post(`/api/vouchers/${v.id}/cancel`, { reason: "Again" }))).toBe("ALREADY_CANCELLED");
    expect(await balance(c.id)).toBe(180000);
    expect((await openBills(c.id))[0]?.outstandingPaise).toBe(180000);
    expect((await post(`/api/sales/${s.id}/cancel`, { reason: "Wrong bill" })).status).toBe(200);
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('receipt.created', 'receipt.cancelled')").first<{ n: number }>();
    expect(audit?.n).toBeGreaterThanOrEqual(2);
  });

  it("protects the opening balance already settled by receipts", async () => {
    const c = await newParty({ openingBalancePaise: 100000 });
    await json(await post("/api/vouchers", voucher({ partyId: c.id, amountPaise: 60000 })));
    const p = await json<Party>(await get(`/api/parties/${c.id}`));
    const res = await call(env, `/api/parties/${c.id}`, { method: "PUT", cookie, body: { ...p, gstin: p.gstin ?? "", openingBalancePaise: 50000 } });
    expect(await errorCode(res)).toBe("VALIDATION");
    const ok = await call(env, `/api/parties/${c.id}`, { method: "PUT", cookie, body: { ...p, gstin: p.gstin ?? "", openingBalancePaise: 70000 } });
    expect(ok.status).toBe(200);
  });

  it("counts a credit note against the invoice it returns", async () => {
    const c = await newParty();
    const s = await creditSale(c.id, 2);
    await json(await post("/api/sales-returns", { uid: uid(), saleId: s.id, returnDate: today, reason: "Damaged", lines: [{ saleItemId: s.items[0]?.id, quantity: 1, serials: [] }] }));
    expect((await openBills(c.id))[0]?.outstandingPaise).toBe(180000);
  });
});

describe("payments to suppliers", () => {
  it("settles purchase bills and credits cash/bank", async () => {
    const s = await newParty({ partyType: "supplier", openingBalancePaise: -20000 });
    const bill = await json<{ id: number; totalPaise: number }>(await post("/api/purchases", {
      uid: uid(), supplierId: s.id, supplierInvoiceNo: `HV-${n}`, invoiceDate: daysAgo(5), ratesIncludeGst: true, notes: "",
      lines: [{ productId: wire.id, quantity: 2, ratePaise: 100000, serials: [] }],
    }));
    expect(await balance(s.id)).toBe(-20000 - bill.totalPaise);
    const bankBefore = await ledgerBalance("bank");
    const v = await json<VoucherDetail>(await post("/api/vouchers", voucher({ kind: "payment", partyId: s.id, amountPaise: 120000, mode: "bank", reference: "NEFT1" })));
    expect(v.voucherNo).toMatch(/\/PAY\//);
    expect(v.allocations.map((a) => [a.targetType, a.amountPaise])).toEqual([["opening", 20000], ["purchase", 100000]]);
    expect(await ledgerBalance("bank")).toBe(bankBefore - 120000);
    expect(await balance(s.id)).toBe(-(bill.totalPaise - 100000));
    expect(await errorCode(await post(`/api/purchases/${bill.id}/cancel`, { reason: "Wrong" }))).toBe("HAS_PAYMENTS");
    expect(await trialBalanceIsZero()).toBe(true);
    const customer = await newParty();
    expect(await errorCode(await post("/api/vouchers", voucher({ kind: "payment", partyId: customer.id, amountPaise: 100 })))).toBe("VALIDATION");
  });
});

describe("statement and outstanding", () => {
  it("lists running balance, open bills with days pending and ageing", async () => {
    const c = await newParty({ name: "Statement Traders", openingBalancePaise: 10000 });
    await creditSale(c.id, 1, daysAgo(45));
    await creditSale(c.id, 1, daysAgo(2));
    await json(await post("/api/vouchers", voucher({ partyId: c.id, amountPaise: 50000 })));
    const st = await json<Statement>(await get(`/api/accounts/parties/${c.id}/statement?from=${daysAgo(100)}&to=${today}`));
    expect(st.openingPaise).toBe(10000);
    expect(st.lines.map((l) => l.docType)).toEqual(["Sale", "Sale", "Receipt"]);
    expect(st.closingPaise).toBe(10000 + 360000 - 50000);
    expect(st.lines.at(-1)?.balancePaise).toBe(st.closingPaise);
    expect(st.outstanding.reduce((s, b) => s + b.outstandingPaise, 0)).toBe(st.closingPaise);
    const oldBill = st.outstanding.find((b) => b.daysPending === 45);
    expect(oldBill).toMatchObject({ outstandingPaise: 140000, overdue: true });
    expect(st.ageing.find((a) => a.bucket === "31–60 days")?.amountPaise).toBe(140000);

    const later = await json<Statement>(await get(`/api/accounts/parties/${c.id}/statement?from=${daysAgo(10)}&to=${today}`));
    expect(later.openingPaise).toBe(10000 + 180000);

    const out = await json<{ items: OutstandingParty[]; totalPaise: number }>(await get("/api/outstanding?kind=receipt"));
    expect(out.items.find((i) => i.partyId === c.id)).toMatchObject({ balancePaise: st.closingPaise, oldestDays: 45, overduePaise: st.closingPaise }) // both due dates have passed;
    const dash = await json<{ receivablePaise: number }>(await get("/api/stats/overview"));
    expect(dash.receivablePaise).toBe(out.totalPaise);
  });

  it("lists receipts with search and requires login", async () => {
    const list = await json<ListResponse<VoucherDetail>>(await get("/api/vouchers?kind=receipt&q=Statement"));
    expect(list.items.length).toBe(1);
    expect((await call(env, "/api/vouchers?kind=receipt", {})).status).toBe(401);
    expect((await call(env, "/api/outstanding?kind=receipt", {})).status).toBe(401);
  });
});
