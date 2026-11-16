// Receipts, payments, outstanding bills and statements of account.
import { z } from "zod";
import { MAX_AMOUNT_PAISE } from "./money";
import { documentDate } from "./purchase";

export const MODES = ["cash", "upi", "bank", "cheque"] as const;
export type PaymentMode = (typeof MODES)[number];
export const MODE_LABEL: Record<PaymentMode, string> = { cash: "Cash", upi: "UPI / GPay", bank: "Bank transfer", cheque: "Cheque" };

export type VoucherKind = "receipt" | "payment";
export type TargetType = "opening" | "sale" | "purchase";

const paise = z.number().int().min(0).max(MAX_AMOUNT_PAISE);

export const voucherSchema = z
  .object({
    uid: z.uuid(),
    kind: z.enum(["receipt", "payment"]),
    partyId: z.number().int().positive("Choose a party"),
    voucherDate: documentDate,
    amountPaise: paise,
    discountPaise: paise,
    mode: z.enum(MODES),
    reference: z.string().trim().max(60),
    remarks: z.string().trim().max(200),
    /** Omit to allocate automatically, oldest bill first. */
    allocations: z
      .array(z.object({ targetType: z.enum(["opening", "sale", "purchase"]), targetId: z.number().int().positive(), amountPaise: paise.min(1) }))
      .max(500)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.amountPaise + v.discountPaise <= 0) ctx.addIssue({ code: "custom", path: ["amountPaise"], message: "Enter an amount" });
    if (v.mode === "cheque" && !v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the cheque number" });
    if (v.allocations) {
      const keys = new Set<string>();
      for (const a of v.allocations) {
        const k = `${a.targetType}:${a.targetId}`;
        if (keys.has(k)) ctx.addIssue({ code: "custom", path: ["allocations"], message: "A bill is listed twice" });
        keys.add(k);
      }
      const total = v.allocations.reduce((s, a) => s + a.amountPaise, 0);
      if (total > v.amountPaise + v.discountPaise) ctx.addIssue({ code: "custom", path: ["allocations"], message: "Allocated more than the amount received + discount" });
    }
  });
export type VoucherInput = z.input<typeof voucherSchema>;

/** A bill (or the opening balance) with money still due. */
export interface OutstandingBill {
  targetType: TargetType;
  targetId: number;
  docNo: string;
  docDate: string;
  dueDate: string;
  billAmountPaise: number;
  outstandingPaise: number;
  daysPending: number;
  overdue: boolean;
}

/** Oldest-first allocation of `available` across bills (same rule as the server). */
export function allocateOldestFirst(bills: OutstandingBill[], available: number): { targetType: TargetType; targetId: number; amountPaise: number }[] {
  const out: { targetType: TargetType; targetId: number; amountPaise: number }[] = [];
  let left = available;
  const sorted = [...bills].sort((a, b) => (a.targetType === "opening" ? -1 : b.targetType === "opening" ? 1 : a.docDate.localeCompare(b.docDate) || a.targetId - b.targetId));
  for (const b of sorted) {
    if (left <= 0) break;
    const amt = Math.min(left, b.outstandingPaise);
    if (amt > 0) out.push({ targetType: b.targetType, targetId: b.targetId, amountPaise: amt });
    left -= amt;
  }
  return out;
}

export interface VoucherSummary {
  id: number;
  kind: VoucherKind;
  voucherNo: string;
  voucherDate: string;
  partyId: number;
  partyName: string;
  amountPaise: number;
  discountPaise: number;
  mode: PaymentMode;
  reference: string;
  status: "posted" | "cancelled";
}

export interface VoucherDetail extends VoucherSummary {
  remarks: string;
  cancelReason: string | null;
  allocations: { targetType: TargetType; targetId: number; docNo: string; amountPaise: number }[];
  advancePaise: number;
  journal: { account: string; debitPaise: number; creditPaise: number }[];
}

export interface StatementLine {
  date: string;
  docType: string;
  docNo: string;
  narration: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}

export interface Statement {
  party: { id: number; name: string; partyType: string; gstin: string | null; phone: string };
  from: string;
  to: string;
  openingPaise: number;
  lines: StatementLine[];
  closingPaise: number;
  outstanding: OutstandingBill[];
  ageing: { bucket: string; amountPaise: number }[];
}

export interface OutstandingParty {
  partyId: number;
  name: string;
  phone: string;
  balancePaise: number;
  oldestDays: number | null;
  overduePaise: number;
}

export const AGEING_BUCKETS = [
  { label: "0–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "61–90 days", max: 90 },
  { label: "Over 90 days", max: Infinity },
] as const;

const optionalDate = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Invalid date").optional();

export const voucherListQuery = z.object({
  kind: z.enum(["receipt", "payment"]),
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["posted", "cancelled", "all"]).optional().default("posted"),
  partyId: z.coerce.number().int().positive().optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

export const kindQuery = z.object({ kind: z.enum(["receipt", "payment"]) });
export const statementQuery = z.object({ from: optionalDate, to: optionalDate });
