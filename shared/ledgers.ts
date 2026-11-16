// Ledgers (account heads) and expense vouchers with draft → approve.
import { z } from "zod";
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

export const expenseSchema = z.object({
  uid: z.uuid(),
  voucherDate: documentDate,
  mode: z.enum(MODES),
  reference: z.string().trim().max(60),
  remarks: z.string().trim().max(200),
  lines: z
    .array(
      z.object({
        ledgerId: z.number().int().positive("Choose an expense head"),
        amountPaise: z.number().int().min(1, "Enter an amount").max(MAX_AMOUNT_PAISE),
        narration: z.string().trim().max(120),
      }),
    )
    .min(1, "Add at least one expense")
    .max(MAX_EXPENSE_LINES),
}).superRefine((v, ctx) => {
  if (v.mode === "cheque" && !v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the cheque number" });
  if (v.lines.reduce((s, l) => s + l.amountPaise, 0) > MAX_AMOUNT_PAISE) ctx.addIssue({ code: "custom", path: ["lines"], message: "Total is too large" });
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
  lines: { ledgerId: number; ledgerName: string; amountPaise: number; narration: string }[];
  journal: { account: string; debitPaise: number; creditPaise: number }[];
}
