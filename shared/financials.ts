// Module 9: trial balance, profit & loss, balance sheet, ledger report.
// Signed paise everywhere: debit positive, credit negative.
import { z } from "zod";
import type { Nature } from "./ledgers";
import { MAX_AMOUNT_PAISE } from "./money";

const isoDate = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Invalid date");

export const asOfQuery = z.object({ to: isoDate });
export const periodQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { path: ["from"], message: "From date is after To date" });

export const ledgerReportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export const ledgerOpeningSchema = z.object({
  openingBalancePaise: z.number().int().min(-MAX_AMOUNT_PAISE).max(MAX_AMOUNT_PAISE),
  updatedAt: z.number().int().nonnegative(),
});

export interface AccountBalance {
  /** "ledger:12" or "party:7" — unique within a report. */
  key: string;
  name: string;
  groupName: string;
  nature: Nature;
  balancePaise: number;
}

export interface TrialBalance {
  to: string;
  rows: AccountBalance[];
  /** Opening stock (no journal entry) and the difference in opening balances. */
  openingStockPaise: number;
  openingDifferencePaise: number;
  totalDebitPaise: number;
  totalCreditPaise: number;
}

export interface PlLine {
  name: string;
  amountPaise: number;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  salesPaise: number;
  salesReturnsPaise: number;
  purchasesPaise: number;
  purchaseReturnsPaise: number;
  openingStockPaise: number;
  closingStockPaise: number;
  directExpenses: PlLine[];
  grossProfitPaise: number;
  indirectIncomes: PlLine[];
  indirectExpenses: PlLine[];
  netProfitPaise: number;
}

export interface BsGroup {
  name: string;
  amountPaise: number;
  items: PlLine[];
}

export interface BalanceSheet {
  to: string;
  /** Capital & liabilities (credit side), amounts shown positive. */
  liabilities: BsGroup[];
  assets: BsGroup[];
  totalLiabilitiesPaise: number;
  totalAssetsPaise: number;
  profitPaise: number;
}

export interface LedgerReportLine {
  date: string;
  docType: string;
  docNo: string;
  narration: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}

export interface LedgerReport {
  ledger: { id: number; name: string; groupName: string; nature: Nature };
  from: string;
  to: string;
  openingPaise: number;
  lines: LedgerReportLine[];
  closingPaise: number;
  truncated: boolean;
}
