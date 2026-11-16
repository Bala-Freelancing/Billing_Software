// Validation schemas and API types for Module 2 (settings, GST slabs, products, parties).
import { z } from "zod";
import { gstinProblem, isStateCode } from "./india";
import { MAX_AMOUNT_PAISE } from "./money";

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, label: string) => text(max).min(1, `${label} is required`);

const stateCode = z.string().refine(isStateCode, "Choose a state");

const optionalGstin = z
  .string()
  .nullable()
  .transform((v) => {
    const cleaned = (v ?? "").trim().toUpperCase();
    return cleaned === "" ? null : cleaned;
  })
  .superRefine((v, ctx) => {
    if (v === null) return;
    const problem = gstinProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const paise = z.number().int("Amount must be in whole paise").min(0).max(MAX_AMOUNT_PAISE);
const signedPaise = z.number().int().min(-MAX_AMOUNT_PAISE).max(MAX_AMOUNT_PAISE);

const pincode = text(6).refine((v) => v === "" || /^[1-9][0-9]{5}$/.test(v), "Pincode must be 6 digits");
const phone = text(20).refine((v) => v === "" || /^[0-9+\- ]{6,20}$/.test(v), "Enter a valid phone number");
const email = text(120).refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email");

/** Optimistic locking: the client sends back the updatedAt it loaded. */
const updatedAt = z.number().int().nonnegative();

// ── Shop settings ────────────────────────────────────────────────────────────

/** ~80 KB image as base64. */
export const MAX_LOGO_DATA_URL_LENGTH = 110_000;

export const shopSettingsSchema = z
  .object({
    shopName: requiredText(120, "Shop name"),
    gstin: optionalGstin,
    address: text(300),
    city: text(80),
    stateCode,
    pincode,
    phone,
    email,
    bankName: text(80),
    bankAccount: text(30).refine((v) => v === "" || /^[0-9]{6,20}$/.test(v), "Account number must be digits"),
    bankIfsc: text(11)
      .toUpperCase()
      .refine((v) => v === "" || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "IFSC must look like SBIN0001234"),
    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,6}$/, "Prefix must be 1–6 letters or digits, e.g. SV"),
    logoDataUrl: z
      .string()
      .max(MAX_LOGO_DATA_URL_LENGTH, "Logo is too large — use an image under 80 KB")
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "Logo must be a PNG, JPEG or WebP image")
      .nullable(),
    updatedAt,
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) {
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State must match the GSTIN's first two digits" });
    }
  });
export type ShopSettingsInput = z.input<typeof shopSettingsSchema>;

export interface ShopSettings {
  shopName: string;
  gstin: string | null;
  address: string;
  city: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  invoicePrefix: string;
  logoDataUrl: string | null;
  updatedAt: number;
}

// ── GST slabs ────────────────────────────────────────────────────────────────

export const createGstSlabSchema = z.object({
  /** Percent with up to two decimals, e.g. 18 or 0.25. */
  ratePercent: z
    .number()
    .min(0)
    .max(100)
    .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Up to two decimals"),
});
export const updateGstSlabSchema = z.object({ isActive: z.boolean() });

export interface GstSlab {
  id: number;
  rateBp: number;
  isActive: boolean;
  productCount: number;
}

// ── Products ─────────────────────────────────────────────────────────────────

export const UNITS = ["PCS", "NOS", "SET", "BOX", "PKT", "MTR", "COIL"] as const;
export type Unit = (typeof UNITS)[number];

/** Barcodes and serials are compared upper-case with no whitespace. */
export const normaliseCode = (value: string) => value.replace(/\s+/g, "").toUpperCase();

const barcode = z
  .string()
  .nullable()
  .transform((v) => normaliseCode(v ?? ""))
  .refine((v) => v.length <= 64, "Barcode is too long")
  .refine((v) => v === "" || /^[\x21-\x7E]+$/.test(v), "Barcode has invalid characters")
  .transform((v) => (v === "" ? null : v));

export const productSchema = z
  .object({
    brand: requiredText(60, "Brand"),
    name: requiredText(160, "Product name"),
    category: text(60),
    hsnCode: z
      .string()
      .trim()
      .regex(/^(\d{4}|\d{6}|\d{8})$/, "HSN code must be 4, 6 or 8 digits"),
    gstSlabId: z.number().int().positive("Choose a GST rate"),
    unit: z.enum(UNITS),
    mrpPaise: paise,
    sellingPricePaise: paise,
    barcode,
    tracksSerial: z.boolean(),
    isActive: z.boolean(),
  })
  .refine((v) => v.sellingPricePaise <= v.mrpPaise, {
    path: ["sellingPricePaise"],
    message: "Selling price cannot be more than MRP",
  });
export const updateProductSchema = productSchema.and(z.object({ updatedAt }));
export type ProductInput = z.input<typeof productSchema>;

export interface Product {
  id: number;
  brand: string;
  name: string;
  category: string;
  hsnCode: string;
  gstSlabId: number;
  gstRateBp: number;
  unit: Unit;
  mrpPaise: number;
  sellingPricePaise: number;
  barcode: string | null;
  tracksSerial: boolean;
  isActive: boolean;
  inStock: number;
  updatedAt: number;
}

// ── Parties ──────────────────────────────────────────────────────────────────

export const PARTY_TYPES = ["customer", "supplier", "both"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const partySchema = z
  .object({
    name: requiredText(160, "Name"),
    partyType: z.enum(PARTY_TYPES),
    phone,
    email,
    gstin: optionalGstin,
    address: text(300),
    city: text(80),
    stateCode,
    pincode,
    openingBalancePaise: signedPaise,
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) {
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State must match the GSTIN's first two digits" });
    }
  });
export const updatePartySchema = partySchema.and(z.object({ updatedAt }));
export type PartyInput = z.input<typeof partySchema>;

export interface Party {
  id: number;
  /** The built-in walk-in "Counter Sales" customer. */
  isCounter: boolean;
  name: string;
  partyType: PartyType;
  phone: string;
  email: string;
  gstin: string | null;
  address: string;
  city: string;
  stateCode: string;
  pincode: string;
  openingBalancePaise: number;
  isActive: boolean;
  updatedAt: number;
}

// ── Lists and scanning ───────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["active", "inactive", "all"]).optional().default("active"),
  type: z.enum(PARTY_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

export const PAGE_SIZE = 50;

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type ScanResult =
  | { kind: "unit"; serial: string; status: string; product: Product }
  | { kind: "product"; product: Product }
  | { kind: "none"; code: string };

export interface DashboardSummary {
  activeProducts: number;
  unitsInStock: number;
  activeParties: number;
  salesTodayPaise: number;
  salesTodayCount: number;
  /** Totals of party balances (opening balance + posted journal). */
  receivablePaise: number;
  payablePaise: number;
}
