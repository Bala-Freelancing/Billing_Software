// Ledgers (account heads) and expense vouchers with draft → approve.
import { z } from "zod";
import { computeLine } from "./gst";
import { gstinProblem } from "./india";
import { MAX_AMOUNT_PAISE } from "./money";
import { documentDate } from "./purchase";
import { MODES, type PaymentMode } from "./vouchers";

export type Nature = "asset" | "liability" | "income" | "expense";

export interface LedgerGroup {
  id: number;
  name: string;
  nature: Nature;
  systemKey: string | null;
  /** False for groups whose members are parties (Sundry Debtors/Creditors). */
  allowsLedgers: boolean;
}

export interface Ledger {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  nature: Nature;
  isSystem: boolean;
  isActive: boolean;
  /** True once any journal line or voucher uses it; its group is then fixed. */
  inUse: boolean;
  /** Opening balance at go-live; debit positive, credit negative. */
  openingBalancePaise: number;
  updatedAt: number;
}

const updatedAt = z.number().int().nonnegative();

export const ledgerSchema = z.object({
  name: z.string().trim().min(2, "Enter a name (2+ characters)").max(80),
  groupId: z.number().int().positive("Choose a group"),
  isActive: z.boolean(),
});
export const updateLedgerSchema = ledgerSchema.and(z.object({ updatedAt }));
export type LedgerInput = z.input<typeof ledgerSchema>;

export const ledgerListQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  nature: z.enum(["asset", "liability", "income", "expense"]).optional(),
  active: z.enum(["1", "all"]).optional().default("all"),
});

// ── Expense vouchers ────────────────────────────────────────────────────────

export const MAX_EXPENSE_LINES = 20;
export type ExpenseStatus = "draft" | "approved" | "rejected" | "cancelled";

export const expenseSchema = z
  .object({
    uid: z.uuid(),
    voucherDate: documentDate,
    mode: z.enum(MODES),
    reference: z.string().trim().max(60),
    remarks: z.string().trim().max(200),
    /** The bill charges GST and the shop claims it as input tax credit. Usually off. */
    gstBill: z.boolean().optional().default(false),
    supplierName: z.string().trim().max(100).optional().default(""),
    supplierGstin: z.string().trim().toUpperCase().max(15).optional().default(""),
    supplierInvoiceNo: z.string().trim().max(16).optional().default(""),
    supplierInvoiceDate: z.string().optional().default(""),
    lines: z
      .array(
        z.object({
          ledgerId: z.number().int().positive("Choose an expense head"),
          /** Taxable value (amount before GST). */
          amountPaise: z.number().int().min(1, "Enter an amount").max(MAX_AMOUNT_PAISE),
          gstRateBp: z.number().int().min(0).max(10_000).optional().default(0),
          narration: z.string().trim().max(120),
        }),
      )
      .min(1, "Add at least one expense")
      .max(MAX_EXPENSE_LINES),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "cheque" && !v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the cheque number" });
    if (v.lines.reduce((s, l) => s + l.amountPaise, 0) > MAX_AMOUNT_PAISE) ctx.addIssue({ code: "custom", path: ["lines"], message: "Total is too large" });
    if (v.gstBill) {
      // Without the supplier's GSTIN and invoice number the credit won't appear in GSTR-2B.
      if (!v.supplierName) ctx.addIssue({ code: "custom", path: ["supplierName"], message: "Enter the supplier name" });
      const gstinError = v.supplierGstin ? gstinProblem(v.supplierGstin) : "Enter the supplier's GSTIN";
      if (gstinError) ctx.addIssue({ code: "custom", path: ["supplierGstin"], message: gstinError });
      if (!v.supplierInvoiceNo) ctx.addIssue({ code: "custom", path: ["supplierInvoiceNo"], message: "Enter the bill number" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.supplierInvoiceDate) || Number.isNaN(Date.parse(v.supplierInvoiceDate))) {
        ctx.addIssue({ code: "custom", path: ["supplierInvoiceDate"], message: "Enter the bill date" });
      } else if (v.supplierInvoiceDate > v.voucherDate) {
        ctx.addIssue({ code: "custom", path: ["supplierInvoiceDate"], message: "Bill date can't be after the voucher date" });
      }
      if (v.lines.every((l) => l.gstRateBp === 0)) ctx.addIssue({ code: "custom", path: ["lines"], message: "Choose the GST rate on at least one line" });
    } else if (v.lines.some((l) => l.gstRateBp !== 0)) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Turn on “GST bill” to enter GST" });
    }
  });
export const updateExpenseSchema = expenseSchema.and(z.object({ updatedAt }));
export type ExpenseInput = z.input<typeof expenseSchema>;

export const approveSchema = z.object({ updatedAt });
export const rejectSchema = z.object({ updatedAt, reason: z.string().trim().min(3, "Give a reason (3+ characters)").max(200) });

export const expenseListQuery = z.object({
  status: z.enum(["draft", "approved", "rejected", "cancelled", "all"]).optional().default("all"),
  q: z.string().trim().max(100).optional().default(""),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

export const expenseSummaryQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Approved expenses in a period: the total (incl. GST) and the split by head (excl. GST). */
export interface ExpenseSummaryReport {
  totalPaise: number;
  count: number;
  byHead: { name: string; amountPaise: number }[];
}

/** Tax per line and voucher totals; used by the form preview and by the server. */
export function computeExpense(lines: { amountPaise: number; gstRateBp: number }[], interstate: boolean) {
  const amounts = lines.map((l) => computeLine({ quantity: 1, ratePaise: l.amountPaise, gstRateBp: l.gstRateBp }, { ratesIncludeGst: false, interstate }));
  const sum = (k: "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "totalPaise") => amounts.reduce((s, a) => s + a[k], 0);
  return { lines: amounts, taxablePaise: sum("taxablePaise"), cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise"), totalPaise: sum("totalPaise") };
}

export interface ExpenseSummary {
  id: number;
  voucherNo: string | null;
  voucherDate: string;
  mode: PaymentMode;
  reference: string;
  totalPaise: number;
  status: ExpenseStatus;
  heads: string;
  updatedAt: number;
}

export interface ExpenseDetail extends ExpenseSummary {
  remarks: string;
  statusReason: string | null;
  approvedAt: number | null;
  gstBill: boolean;
  supplierName: string;
  supplierGstin: string | null;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string | null;
  interstate: boolean;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lines: { ledgerId: number; ledgerName: string; amountPaise: number; gstRateBp: number; taxPaise: number; narration: string }[];
  journal: { account: string; debitPaise: number; creditPaise: number }[];
}

// ── Ledger groups (Module 7) ────────────────────────────────────────────────

export interface LedgerGroupRow extends LedgerGroup {
  parentId: number | null;
  parentName: string | null;
  isSystem: boolean;
  ledgerCount: number;
  updatedAt: number;
}

export const ledgerGroupSchema = z.object({
  name: z.string().trim().min(2, "Enter a name (2+ characters)").max(60),
  parentId: z.number().int().positive("Choose the main group"),
});
export const updateLedgerGroupSchema = z.object({ name: ledgerGroupSchema.shape.name, updatedAt });
