// Validation, numbering and API types for sales invoices and sales returns.
import { z } from "zod";
import { isIsoDate } from "./gst";
import { isStateCode } from "./india";
import { normaliseCode } from "./masters";
import { MAX_AMOUNT_PAISE } from "./money";
import { documentDate, MAX_LINES, MAX_QUANTITY, MAX_SERIALS_PER_DOCUMENT } from "./purchase";

/** Indian financial year (April–March) of a date as "2627" for 2026-27. */
export function financialYear(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9]{1,6}$/;

/** "2627/SV/0001" — matches the shop's previous numbering style. */
export const formatInvoiceNo = (fy: string, prefix: string, n: number) => `${fy}/${prefix}/${String(n).padStart(4, "0")}`;
export const formatCreditNoteNo = (fy: string, n: number) => `CN/${fy}/${String(n).padStart(4, "0")}`;

const serial = z
  .string()
  .transform(normaliseCode)
  .refine((v) => v.length >= 1 && v.length <= 64, "Serial must be 1–64 characters");

export const saleSchema = z
  .object({
    uid: z.uuid(),
    customerId: z.number().int().positive("Choose a customer"),
    // Only used for the Counter Sales customer; otherwise taken from the party.
    billName: z.string().trim().max(120),
    billPhone: z.string().trim().max(20),
    billGstin: z.string().trim().toUpperCase().max(15),
    billStateCode: z.string().refine((v) => v === "" || isStateCode(v), "Choose a state"),
    invoiceDate: documentDate,
    collectionType: z.enum(["immediate", "credit"]),
    dueDate: z.string().refine(isIsoDate, "Enter a valid due date"),
    salesman: z.string().trim().max(60),
    remarks: z.string().trim().max(300),
    lines: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(MAX_QUANTITY),
          /** Per unit, GST inclusive. */
          ratePaise: z.number().int().min(0).max(MAX_AMOUNT_PAISE),
          serials: z.array(serial).max(MAX_SERIALS_PER_DOCUMENT),
        }),
      )
      .min(1, "Add at least one item")
      .max(MAX_LINES),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate < v.invoiceDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date cannot be before the invoice date" });
    const seen = new Set<string>();
    for (const l of v.lines)
      for (const s of l.serials) {
        if (seen.has(s)) ctx.addIssue({ code: "custom", path: ["lines"], message: `Serial entered twice: ${s}` });
        seen.add(s);
      }
  });
export type SaleInput = z.input<typeof saleSchema>;

export const salesReturnSchema = z.object({
  uid: z.uuid(),
  saleId: z.number().int().positive(),
  returnDate: documentDate,
  reason: z.string().trim().max(200),
  lines: z
    .array(
      z.object({
        saleItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
        serials: z.array(serial).max(MAX_SERIALS_PER_DOCUMENT),
      }),
    )
    .min(1, "Choose at least one item to return")
    .max(MAX_LINES),
});

export const saleListQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["posted", "cancelled", "all"]).optional().default("posted"),
  customerId: z.coerce.number().int().positive().optional(),
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

export type DocStatus = "posted" | "cancelled";

export interface SaleSummary {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  customerId: number;
  billName: string;
  collectionType: "immediate" | "credit";
  totalPaise: number;
  status: DocStatus;
}

export interface SaleItemDetail {
  id: number;
  lineNo: number;
  productId: number;
  productName: string;
  brand: string;
  unit: string;
  hsnCode: string;
  tracksSerial: boolean;
  quantity: number;
  ratePaise: number;
  mrpPaise: number;
  gstRateBp: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  serials: string[];
  returnedQuantity: number;
  returnedSerials: string[];
}

export interface SalesReturnSummary {
  id: number;
  creditNoteNo: string;
  saleId: number;
  invoiceNo: string;
  billName: string;
  returnDate: string;
  totalPaise: number;
  reason: string;
  status: DocStatus;
}

export interface SaleDetail {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  collectionType: "immediate" | "credit";
  salesman: string;
  customer: { id: number; name: string; isCounter: boolean };
  bill: { name: string; phone: string; gstin: string | null; address: string; stateCode: string };
  isInterstate: boolean;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  remarks: string;
  status: DocStatus;
  cancelReason: string | null;
  items: SaleItemDetail[];
  journal: { account: string; debitPaise: number; creditPaise: number }[];
  returns: SalesReturnSummary[];
}

// ── Amount in words (Indian system) ──────────────────────────────────────────

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = TENS[Math.floor(n / 10)] ?? "";
  return n % 10 ? `${t} ${ONES[n % 10]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

function integerWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** 1234550 paise → "Rupees Twelve Thousand Three Hundred Forty Five and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `Rupees ${integerWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
}
