// Module 10: dashboard, sales statistics and stock report.
import { z } from "zod";
import { MAX_REPORT_DAYS } from "./reports";

const isoDate = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Invalid date");

export const statsQuery = z
  .object({ from: isoDate, to: isoDate })
  .superRefine((v, ctx) => {
    if (v.from > v.to) ctx.addIssue({ code: "custom", path: ["from"], message: "From date is after To date" });
    else if ((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 > MAX_REPORT_DAYS) ctx.addIssue({ code: "custom", path: ["from"], message: "Choose at most one year at a time" });
  });

export const stockQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  group: z.string().trim().max(60).optional().default(""),
  show: z.enum(["all", "in", "low", "out"]).optional().default("all"),
  /** Quantity at or below this counts as low stock. */
  low: z.coerce.number().int().min(0).max(100_000).optional().default(2),
});

export interface Overview {
  today: string;
  salesToday: { totalPaise: number; count: number };
  salesMonth: { totalPaise: number; count: number };
  collectedTodayPaise: number;
  cashPaise: number;
  bankPaise: number;
  receivablePaise: number;
  payablePaise: number;
  overdue: { amountPaise: number; parties: number };
  stockValuePaise: number;
  lowStock: number;
  outOfStock: number;
  draftVouchers: number;
  /** Last 6 months incl. the current one, net of returns (incl. GST). */
  trend: { month: string; salesPaise: number }[];
  recentSales: { id: number; invoiceNo: string; date: string; party: string; totalPaise: number }[];
  /** Up to 6 active products with 2 or fewer in stock, emptiest first. */
  lowStockItems: { id: number; name: string; inStock: number }[];
}

export interface NamedAmount {
  id: number | null;
  name: string;
  quantity: number;
  taxablePaise: number;
  totalPaise: number;
}

export interface SalesStats {
  from: string;
  to: string;
  months: { month: string; salesPaise: number; purchasesPaise: number; invoices: number }[];
  salesTotalPaise: number;
  salesTaxablePaise: number;
  invoices: number;
  averageBillPaise: number;
  topProducts: NamedAmount[];
  topCustomers: NamedAmount[];
  byGroup: NamedAmount[];
}

export interface StockRow {
  productId: number;
  brand: string;
  name: string;
  group: string;
  unit: string;
  tracksSerial: boolean;
  isActive: boolean;
  quantity: number;
  averageCostPaise: number;
  valuePaise: number;
  sellingPricePaise: number;
  sellingValuePaise: number;
}

export interface StockReport {
  asOf: string;
  rows: StockRow[];
  totalQuantity: number;
  totalValuePaise: number;
  totalSellingValuePaise: number;
  truncated: boolean;
}
