// Money helpers. All amounts are integer paise; floats never touch stored values.

export const MAX_AMOUNT_PAISE = 100_000_000_00; // ₹10 crore, a sanity ceiling per value

/**
 * Parses a rupee amount typed by a person ("1,250", "1250.5", "₹ 99.99") into
 * paise. Returns null for anything that is not a valid non-negative amount with
 * at most two decimals. Works on the string, so 0.1 + 0.2 style errors cannot occur.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return paise <= MAX_AMOUNT_PAISE ? paise : null;
}

/** Same as parseRupees but allows a leading minus sign (opening balances). */
export function parseSignedRupees(input: string): number | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const value = parseRupees(negative ? trimmed.slice(1) : trimmed);
  if (value === null) return null;
  return negative ? -value : value;
}

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234550 → "12,345.50" (Indian digit grouping). */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return sign + inr.format(Math.trunc(abs / 100) + (abs % 100) / 100);
}

/** Paise as a plain editable string: 1234550 → "12345.50". */
export function paiseToInput(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Splits a GST-inclusive amount into taxable value and tax.
 * rateBp is basis points (18% = 1800). Taxable is rounded to the nearest
 * paisa and tax is the remainder, so taxable + tax always equals the input.
 */
export function splitInclusive(inclusivePaise: number, rateBp: number): { taxablePaise: number; taxPaise: number } {
  const taxablePaise = Math.round((inclusivePaise * 10000) / (10000 + rateBp));
  return { taxablePaise, taxPaise: inclusivePaise - taxablePaise };
}

/** Margin on cost in %: (selling price excl. GST − cost) / cost. Null when there is no cost yet. */
export function marginOnCost(sellingInclPaise: number, rateBp: number, costPaise: number): number | null {
  if (costPaise <= 0) return null;
  return ((splitInclusive(sellingInclPaise, rateBp).taxablePaise - costPaise) / costPaise) * 100;
}

export const formatRate = (rateBp: number) => `${rateBp / 100}%`;
