// Module 8: sales / purchase registers and the GST (auditor) report.
import { z } from "zod";

export const MAX_REPORT_DAYS = 366;
export const MAX_REPORT_ROWS = 5000;

const isoDate = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Invalid date");

const range = z
  .object({ from: isoDate, to: isoDate })
  .superRefine((v, ctx) => {
    if (v.from > v.to) ctx.addIssue({ code: "custom", path: ["from"], message: "From date is after To date" });
    else if ((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 > MAX_REPORT_DAYS) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "Choose at most one year at a time" });
    }
  });

export const registerQuery = z
  .object({
    kind: z.enum(["sales", "purchase"]),
    from: isoDate,
    to: isoDate,
    partyId: z.coerce.number().int().positive().optional(),
    status: z.enum(["posted", "cancelled", "all"]).optional().default("posted"),
  })
  .and(range);

/** rates: comma-separated GST rates in basis points ("1200,1800"); empty = all. */
export const gstReportQuery = z
  .object({
    kind: z.enum(["sales", "purchase"]),
    from: isoDate,
    to: isoDate,
    rates: z
      .string()
      .optional()
      .default("")
      .transform((v, ctx) => {
        const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
        const nums = parts.map(Number);
        if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 10_000)) {
          ctx.addIssue({ code: "custom", message: "Invalid GST rate" });
          return z.NEVER;
        }
        return [...new Set(nums)];
      }),
  })
  .and(range);

export interface RegisterRow {
  id: number;
  docType: "invoice" | "return" | "expense";
  docNo: string;
  date: string;
  partyName: string;
  gstin: string | null;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  status: "posted" | "cancelled";
}

export interface Totals {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface Register {
  kind: "sales" | "purchase";
  from: string;
  to: string;
  rows: RegisterRow[];
  truncated: boolean;
  /** Posted invoices minus posted returns. */
  net: Totals;
}

/** One document × one GST rate — the auditor's line-level view. */
export interface GstRow {
  docType: "invoice" | "return" | "expense";
  docNo: string;
  date: string;
  partyName: string;
  gstin: string | null;
  rateBp: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface GstSlabSummary extends Totals {
  rateBp: number;
  /** Returns already subtracted; these show the return part separately. */
  returnTaxablePaise: number;
  returnTaxPaise: number;
}

export interface GstReport {
  kind: "sales" | "purchase";
  from: string;
  to: string;
  rates: number[];
  slabs: GstSlabSummary[];
  /** Sales only: registered buyers (with GSTIN) vs consumers. */
  b2b: Totals | null;
  b2c: Totals | null;
  hsn: ({ hsnCode: string; rateBp: number; quantity: number } & Totals)[];
  rows: GstRow[];
  truncated: boolean;
  net: Totals;
}

export const emptyTotals = (): Totals => ({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 });
export function addTotals(t: Totals, r: Totals, sign = 1): Totals {
  t.taxablePaise += sign * r.taxablePaise;
  t.cgstPaise += sign * r.cgstPaise;
  t.sgstPaise += sign * r.sgstPaise;
  t.igstPaise += sign * r.igstPaise;
  t.totalPaise += sign * r.totalPaise;
  return t;
}
