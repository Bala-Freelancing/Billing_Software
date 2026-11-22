import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIst } from "../shared/gst";
import type { ExpenseDetail, Ledger, LedgerGroup } from "../shared/ledgers";
import type { ListResponse } from "../shared/masters";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let groups: LedgerGroup[];
let rent: Ledger;
let salary: Ledger;
const today = todayIst();
const uid = () => crypto.randomUUID();

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
const put = (path: string, body: unknown) => call(env, path, { method: "PUT", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const group = (key: string) => groups.find((g) => g.systemKey === key)!;
const expense = (o: Record<string, unknown> = {}) => ({
  uid: uid(), voucherDate: today, mode: "cash", reference: "", remarks: "", lines: [{ ledgerId: rent.id, amountPaise: 1500000, narration: "November rent" }], ...o,
});
async function ledgerBalance(where: string, ...binds: unknown[]) {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(debit_paise - credit_paise),0) AS b FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
      JOIN ledgers l ON l.id = jl.ledger_id WHERE e.status = 'posted' AND ${where}`,
  ).bind(...binds).first<{ b: number }>();
  return r?.b ?? 0;
}

/** A GSTIN with a correct check digit for the given state (test data only). */
async function validGstin(state: string) {
  const { gstinProblem } = await import("../shared/india");
  for (const c of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const g = `${state}AAACB1234C1Z${c}`;
    if (!gstinProblem(g)) return g;
  }
  throw new Error("no gstin");
}

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  groups = (await json<{ items: LedgerGroup[] }>(await get("/api/ledger-groups"))).items;
  const all = (await json<ListResponse<Ledger>>(await get("/api/ledgers?nature=expense"))).items;
  rent = all.find((l) => l.name === "Rent")!;
  salary = all.find((l) => l.name === "Salary & Wages")!;
});
afterAll(async () => {
  await ctx.dispose();
});

describe("ledgers", () => {
  it("lists built-in and seeded heads", async () => {
    const all = (await json<ListResponse<Ledger>>(await get("/api/ledgers"))).items;
    expect(all.find((l) => l.name === "Cash")).toMatchObject({ isSystem: true, nature: "asset" });
    expect(rent).toMatchObject({ isSystem: false, nature: "expense", isActive: true });
    expect(group("sundry_debtors").allowsLedgers).toBe(false);
    for (const name of ["Courier Charges", "Fuel & Travel (Diesel)"]) expect(all.find((l) => l.name === name)?.nature).toBe("expense");
  });

  it("creates, renames and deactivates a ledger; refuses duplicates, party groups and system edits", async () => {
    const created = await json<Ledger>(await post("/api/ledgers", { name: "Shop Maintenance", groupId: group("indirect_expenses").id, isActive: true }));
    expect(created.groupName).toBe("Indirect Expenses");
    expect(await errorCode(await post("/api/ledgers", { name: "shop maintenance", groupId: group("indirect_expenses").id, isActive: true }))).toBe("VALIDATION");
    expect(await errorCode(await post("/api/ledgers", { name: "Some Debtor", groupId: group("sundry_debtors").id, isActive: true }))).toBe("VALIDATION");
    const renamed = await json<Ledger>(await put(`/api/ledgers/${created.id}`, { name: "Shop Repairs", groupId: created.groupId, isActive: false, updatedAt: created.updatedAt }));
    expect(renamed).toMatchObject({ name: "Shop Repairs", isActive: false });
    expect(await errorCode(await put(`/api/ledgers/${created.id}`, { name: "X Y", groupId: created.groupId, isActive: true, updatedAt: created.updatedAt }))).toBe("CONFLICT");
    const cash = (await json<ListResponse<Ledger>>(await get("/api/ledgers?q=Cash"))).items.find((l) => l.name === "Cash")!;
    expect(await errorCode(await put(`/api/ledgers/${cash.id}`, { name: "Petty Cash", groupId: cash.groupId, isActive: true, updatedAt: cash.updatedAt }))).toBe("SYSTEM_LEDGER");
  });

  it("fixes the group once a ledger is used", async () => {
    const l = await json<Ledger>(await post("/api/ledgers", { name: "Courier", groupId: group("indirect_expenses").id, isActive: true }));
    await json(await post("/api/expenses", expense({ lines: [{ ledgerId: l.id, amountPaise: 5000, narration: "" }] })));
    const fresh = (await json<ListResponse<Ledger>>(await get("/api/ledgers?q=Courier"))).items[0]!;
    expect(fresh.inUse).toBe(true);
    expect(await errorCode(await put(`/api/ledgers/${l.id}`, { name: "Courier", groupId: group("direct_expenses").id, isActive: true, updatedAt: fresh.updatedAt }))).toBe("VALIDATION");
  });
});

describe("expense vouchers", () => {
  it("saves a draft that does not touch the accounts until approved", async () => {
    const cashBefore = await ledgerBalance("l.system_key = 'cash'");
    const d = await json<ExpenseDetail>(await post("/api/expenses", expense({
      lines: [{ ledgerId: rent.id, amountPaise: 1500000, narration: "Rent" }, { ledgerId: salary.id, amountPaise: 2000000, narration: "Ravi" }],
    })));
    expect(d).toMatchObject({ status: "draft", voucherNo: null, totalPaise: 3500000 });
    expect(d.journal).toEqual([]);
    expect(await ledgerBalance("l.system_key = 'cash'")).toBe(cashBefore);

    const approved = await json<ExpenseDetail>(await post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt }));
    expect(approved.status).toBe("approved");
    expect(approved.voucherNo).toMatch(/^\d{4}\/EXP\/\d{4}$/);
    expect(await ledgerBalance("l.system_key = 'cash'")).toBe(cashBefore - 3500000);
    expect(await ledgerBalance("l.id = ?1", salary.id)).toBe(2000000);
    expect(approved.journal.find((j) => j.account === "Rent")?.debitPaise).toBe(1500000);
    // Approving twice is refused.
    expect(await errorCode(await post(`/api/expenses/${d.id}/approve`, { updatedAt: approved.updatedAt }))).toBe("NOT_DRAFT");
    expect(await errorCode(await put(`/api/expenses/${d.id}`, { ...expense(), updatedAt: approved.updatedAt }))).toBe("NOT_DRAFT");
  });

  it("is idempotent and lets drafts be edited with optimistic locking", async () => {
    const body = expense();
    const a = await json<ExpenseDetail>(await post("/api/expenses", body));
    const b = await json<ExpenseDetail>(await post("/api/expenses", body));
    expect(b.id).toBe(a.id);
    const edited = await json<ExpenseDetail>(await put(`/api/expenses/${a.id}`, { ...body, mode: "upi", reference: "UTR9", lines: [{ ledgerId: salary.id, amountPaise: 99900, narration: "Bonus" }], updatedAt: a.updatedAt }));
    expect(edited).toMatchObject({ mode: "upi", totalPaise: 99900, status: "draft" });
    expect(edited.lines).toEqual([expect.objectContaining({ ledgerName: "Salary & Wages", amountPaise: 99900 })]);
    expect(await errorCode(await put(`/api/expenses/${a.id}`, { ...body, updatedAt: a.updatedAt }))).toBe("CONFLICT");
    expect(await errorCode(await post(`/api/expenses/${a.id}/approve`, { updatedAt: a.updatedAt }))).toBe("CONFLICT");
    const bankBefore = await ledgerBalance("l.system_key = 'bank'");
    await json(await post(`/api/expenses/${a.id}/approve`, { updatedAt: edited.updatedAt }));
    expect(await ledgerBalance("l.system_key = 'bank'")).toBe(bankBefore - 99900);
  });

  it("numbers only approved vouchers, gaplessly; rejected drafts keep no number", async () => {
    const d1 = await json<ExpenseDetail>(await post("/api/expenses", expense()));
    const d2 = await json<ExpenseDetail>(await post("/api/expenses", expense()));
    const d3 = await json<ExpenseDetail>(await post("/api/expenses", expense()));
    const a1 = await json<ExpenseDetail>(await post(`/api/expenses/${d1.id}/approve`, { updatedAt: d1.updatedAt }));
    const r2 = await json<ExpenseDetail>(await post(`/api/expenses/${d2.id}/reject`, { updatedAt: d2.updatedAt, reason: "Duplicate entry" }));
    const a3 = await json<ExpenseDetail>(await post(`/api/expenses/${d3.id}/approve`, { updatedAt: d3.updatedAt }));
    expect(r2).toMatchObject({ status: "rejected", voucherNo: null, statusReason: "Duplicate entry" });
    expect(Number(a3.voucherNo!.slice(-4))).toBe(Number(a1.voucherNo!.slice(-4)) + 1);
  });

  it("approves a draft only once under concurrency", async () => {
    const d = await json<ExpenseDetail>(await post("/api/expenses", expense()));
    const results = await Promise.all([1, 2, 3].map(() => post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const entries = await env.DB.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'journal' AND source_id = ?1").bind(d.id).first<{ n: number }>();
    expect(entries?.n).toBe(1);
  });

  it("refuses non-expense or inactive heads, at save and at approval", async () => {
    const cash = (await json<ListResponse<Ledger>>(await get("/api/ledgers?q=Cash"))).items.find((l) => l.name === "Cash")!;
    expect(await errorCode(await post("/api/expenses", expense({ lines: [{ ledgerId: cash.id, amountPaise: 100, narration: "" }] })))).toBe("VALIDATION");
    expect(await errorCode(await post("/api/expenses", expense({ mode: "cheque" })))).toBe("VALIDATION");
    expect(await errorCode(await post("/api/expenses", expense({ lines: [] })))).toBe("VALIDATION");
    const temp = await json<Ledger>(await post("/api/ledgers", { name: "Temp Head", groupId: group("indirect_expenses").id, isActive: true }));
    const d = await json<ExpenseDetail>(await post("/api/expenses", expense({ lines: [{ ledgerId: temp.id, amountPaise: 100, narration: "" }] })));
    await json(await put(`/api/ledgers/${temp.id}`, { name: temp.name, groupId: temp.groupId, isActive: false, updatedAt: temp.updatedAt }));
    expect(await errorCode(await post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt }))).toBe("VALIDATION");
  });

  it("cancels an approved voucher and reverses its journal; keeps the audit trail", async () => {
    const d = await json<ExpenseDetail>(await post("/api/expenses", expense({ lines: [{ ledgerId: rent.id, amountPaise: 777, narration: "" }] })));
    expect(await errorCode(await post(`/api/expenses/${d.id}/cancel`, { reason: "Wrong" }))).toBe("NOT_APPROVED");
    const before = await ledgerBalance("l.id = ?1", rent.id);
    await json(await post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt }));
    expect(await ledgerBalance("l.id = ?1", rent.id)).toBe(before + 777);
    const c = await json<ExpenseDetail>(await post(`/api/expenses/${d.id}/cancel`, { reason: "Entered twice" }));
    expect(c).toMatchObject({ status: "cancelled", statusReason: "Entered twice" });
    expect(c.voucherNo).not.toBeNull();
    expect(await ledgerBalance("l.id = ?1", rent.id)).toBe(before);
    const audit = await env.DB.prepare("SELECT GROUP_CONCAT(action) AS a FROM audit_log WHERE action LIKE 'expense.%'").first<{ a: string }>();
    for (const action of ["expense.created", "expense.updated", "expense.approved", "expense.rejected", "expense.cancelled"]) expect(audit?.a).toContain(action);
    const tb = await env.DB.prepare("SELECT COALESCE(SUM(debit_paise) - SUM(credit_paise), 0) AS d FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id WHERE e.status = 'posted'").first<{ d: number }>();
    expect(tb?.d).toBe(0);
  });

  it("records GST on a GST bill as input credit (CGST + SGST within Tamil Nadu)", async () => {
    const before = { cgst: await ledgerBalance("l.system_key = 'input_cgst'"), sgst: await ledgerBalance("l.system_key = 'input_sgst'"), cash: await ledgerBalance("l.system_key = 'cash'") };
    const d = await json<ExpenseDetail>(await post("/api/expenses", expense({
      gstBill: true, supplierName: "Lakshmi Estates", supplierGstin: await validGstin("33"), supplierInvoiceNo: "R-11", supplierInvoiceDate: today,
      lines: [{ ledgerId: rent.id, amountPaise: 2000000, gstRateBp: 1800, narration: "Shop rent" }],
    })));
    expect(d).toMatchObject({ gstBill: true, interstate: false, taxablePaise: 2000000, cgstPaise: 180000, sgstPaise: 180000, igstPaise: 0, totalPaise: 2360000 });
    expect(d.lines[0]).toMatchObject({ gstRateBp: 1800, taxPaise: 360000 });
    const a = await json<ExpenseDetail>(await post(`/api/expenses/${d.id}/approve`, { updatedAt: d.updatedAt }));
    expect(a.journal.find((j) => j.account === "Rent")?.debitPaise).toBe(2000000);
    expect(await ledgerBalance("l.system_key = 'input_cgst'")).toBe(before.cgst + 180000);
    expect(await ledgerBalance("l.system_key = 'input_sgst'")).toBe(before.sgst + 180000);
    expect(await ledgerBalance("l.system_key = 'cash'")).toBe(before.cash - 2360000);
  });

  it("uses IGST for an out-of-state supplier and validates GST bill details", async () => {
    const d = await json<ExpenseDetail>(await post("/api/expenses", expense({
      gstBill: true, supplierName: "Blue Dart", supplierGstin: await validGstin("29"), supplierInvoiceNo: "BD9", supplierInvoiceDate: today,
      lines: [{ ledgerId: rent.id, amountPaise: 10000, gstRateBp: 1800, narration: "" }],
    })));
    expect(d).toMatchObject({ interstate: true, igstPaise: 1800, cgstPaise: 0, totalPaise: 11800 });
    const bad = async (o: Record<string, unknown>) => errorCode(await post("/api/expenses", expense(o)));
    expect(await bad({ lines: [{ ledgerId: rent.id, amountPaise: 100, gstRateBp: 1800, narration: "" }] })).toBe("VALIDATION"); // GST without GST bill
    expect(await bad({ gstBill: true, supplierName: "X", supplierGstin: "33ABC", supplierInvoiceNo: "1", supplierInvoiceDate: today, lines: [{ ledgerId: rent.id, amountPaise: 100, gstRateBp: 1800, narration: "" }] })).toBe("VALIDATION");
    expect(await bad({ gstBill: true, supplierName: "X", supplierGstin: await validGstin("33"), supplierInvoiceNo: "", supplierInvoiceDate: today, lines: [{ ledgerId: rent.id, amountPaise: 100, gstRateBp: 1800, narration: "" }] })).toBe("VALIDATION");
    expect(await bad({ gstBill: true, supplierName: "X", supplierGstin: await validGstin("33"), supplierInvoiceNo: "1", supplierInvoiceDate: today, lines: [{ ledgerId: rent.id, amountPaise: 100, gstRateBp: 1700, narration: "" }] })).toBe("VALIDATION");
  });

  it("summarises approved expenses by head for a period (drafts excluded)", async () => {
    const day = "2025-04-10";
    const a = await json<ExpenseDetail>(await post("/api/expenses", expense({
      voucherDate: day,
      lines: [{ ledgerId: rent.id, amountPaise: 1000000, narration: "" }, { ledgerId: salary.id, amountPaise: 300000, narration: "" }],
    })));
    await json(await post(`/api/expenses/${a.id}/approve`, { updatedAt: a.updatedAt }));
    await json(await post("/api/expenses", expense({ voucherDate: day, lines: [{ ledgerId: rent.id, amountPaise: 99900, narration: "draft" }] })));
    const s = await json<{ totalPaise: number; count: number; byHead: { name: string; amountPaise: number }[] }>(await get(`/api/expenses/summary?from=${day}&to=${day}`));
    expect(s).toEqual({ totalPaise: 1300000, count: 1, byHead: [{ name: "Rent", amountPaise: 1000000 }, { name: "Salary & Wages", amountPaise: 300000 }] });
    expect((await get("/api/expenses/summary?from=bad&to=2025-01-01")).status).toBe(400);
  });

  it("lists drafts first and needs login", async () => {
    const list = await json<ListResponse<{ status: string }>>(await get("/api/expenses?status=draft"));
    expect(list.items.every((i) => i.status === "draft")).toBe(true);
    expect((await call(env, "/api/expenses", {})).status).toBe(401);
    expect((await call(env, "/api/ledgers", {})).status).toBe(401);
  });
});
