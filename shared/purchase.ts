// Validation and API types for purchases, opening stock and purchase returns.
import { z } from "zod";
import { isIsoDate, todayIst } from "./gst";
import { normaliseCode } from "./masters";
import { MAX_AMOUNT_PAISE } from "./money";

export const MAX_LINES = 200;
export const MAX_QUANTITY = 10_000;
export const MAX_SERIALS_PER_DOCUMENT = 1_000;

const uid = z.uuid("Invalid form id — reload the page");
const paise = z.number().int().min(0).max(MAX_AMOUNT_PAISE);

export const documentDate = z
  .string()
  .refine(isIsoDate, "Enter a valid date")
  .refine((v) => v >= "2000-01-01", "Date is too far in the past")
  .refine((v) => v <= todayIst(), "Date cannot be in the future");

const serial = z
  .string()
  .transform(normaliseCode)
  .refine((v) => v.length >= 1 && v.length <= 64, "Serial must be 1–64 characters")
  .refine((v) => /^[\x21-\x7E]+$/.test(v), "Serial has invalid characters");

const serialList = z.array(serial).max(MAX_SERIALS_PER_DOCUMENT);

/** Fails if any serial appears more than once across all lines of a document. */
function noDuplicateSerials(lines: { serials: string[] }[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const l of lines) for (const s of l.serials) (seen.has(s) ? dupes : seen).add(s);
  if (dupes.size) ctx.addIssue({ code: "custom", path: ["lines"], message: `Serial entered twice: ${[...dupes].join(", ")}` });
}

export const purchaseLineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(MAX_QUANTITY),
  ratePaise: paise,
  serials: serialList,
});

export const purchaseSchema = z
  .object({
    uid,
    supplierId: z.number().int().positive("Choose a supplier"),
    supplierInvoiceNo: z.string().trim().min(1, "Supplier invoice number is required").max(40),
    invoiceDate: documentDate,
    ratesIncludeGst: z.boolean(),
    notes: z.string().trim().max(300),
    lines: z.array(purchaseLineSchema).min(1, "Add at least one product").max(MAX_LINES),
  })
  .superRefine((v, ctx) => noDuplicateSerials(v.lines, ctx));
export type PurchaseInput = z.input<typeof purchaseSchema>;

export const cancelSchema = z.object({ reason: z.string().trim().min(3, "Give a reason (3+ characters)").max(200) });

export const openingStockSchema = z
  .object({
    uid,
    productId: z.number().int().positive("Choose a product"),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
    ratePaise: paise,
    serials: serialList,
  })
  .superRefine((v, ctx) => noDuplicateSerials([v], ctx));

export const purchaseReturnSchema = z
  .object({
    uid,
    purchaseId: z.number().int().positive(),
    returnDate: documentDate,
    reason: z.string().trim().max(200),
    lines: z
      .array(
        z.object({
          purchaseItemId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(MAX_QUANTITY),
          serials: serialList,
        }),
      )
      .min(1, "Choose at least one item to return")
      .max(MAX_LINES),
  })
  .superRefine((v, ctx) => noDuplicateSerials(v.lines, ctx));

export const purchaseListQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["posted", "cancelled", "all"]).optional().default("posted"),
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

// ── Response types ───────────────────────────────────────────────────────────

export type DocStatus = "posted" | "cancelled";

export interface PurchaseSummary {
  id: number;
  supplierId: number;
  supplierName: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  totalPaise: number;
  status: DocStatus;
  itemCount: number;
}

export interface PurchaseItemDetail {
  id: number;
  lineNo: number;
  productId: number;
  productName: string;
  brand: string;
  hsnCode: string;
  unit: string;
  tracksSerial: boolean;
  quantity: number;
  ratePaise: number;
  gstRateBp: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  returnedQuantity: number;
  units: { id: number; serial: string; status: string }[];
}

export interface JournalLineView {
  account: string;
  debitPaise: number;
  creditPaise: number;
}

export interface PurchaseReturnSummary {
  id: number;
  purchaseId: number;
  supplierName: string;
  supplierInvoiceNo: string;
  returnDate: string;
  totalPaise: number;
  reason: string;
  status: DocStatus;
}

export interface PurchaseDetail {
  id: number;
  uid: string;
  supplier: { id: number; name: string; gstin: string | null; stateCode: string };
  supplierInvoiceNo: string;
  invoiceDate: string;
  isInterstate: boolean;
  ratesIncludeGst: boolean;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  notes: string;
  status: DocStatus;
  cancelReason: string | null;
  items: PurchaseItemDetail[];
  journal: JournalLineView[];
  returns: PurchaseReturnSummary[];
}

export interface OpeningStockEntry {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  ratePaise: number;
  status: DocStatus;
  createdAt: number;
  serials: string[];
}
