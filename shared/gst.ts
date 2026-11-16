// GST bill arithmetic shared by the browser (live preview) and the Worker (the
// authoritative calculation; totals sent by a client are never trusted).
// All values are integer paise; GST rates are basis points (18% = 1800).
import { splitInclusive } from "./money";

export interface LineInput {
  quantity: number;
  ratePaise: number;
  gstRateBp: number;
}

export interface LineAmounts {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface BillOptions {
  /** Supplier/customer state differs from the shop's state → IGST instead of CGST + SGST. */
  interstate: boolean;
  /** Rates already include GST (tax is extracted) instead of tax being added. */
  ratesIncludeGst: boolean;
}

export function computeLine(line: LineInput, opts: BillOptions): LineAmounts {
  const gross = line.quantity * line.ratePaise;
  let taxablePaise: number;
  let taxPaise: number;
  if (opts.ratesIncludeGst) {
    ({ taxablePaise, taxPaise } = splitInclusive(gross, line.gstRateBp));
  } else {
    taxablePaise = gross;
    taxPaise = Math.round((gross * line.gstRateBp) / 10000);
  }
  if (opts.interstate) {
    return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise, totalPaise: taxablePaise + taxPaise };
  }
  // Split tax between CGST and SGST so the two always add back to the full tax.
  const cgstPaise = Math.round(taxPaise / 2);
  return { taxablePaise, cgstPaise, sgstPaise: taxPaise - cgstPaise, igstPaise: 0, totalPaise: taxablePaise + taxPaise };
}

export interface BillTotals {
  lines: LineAmounts[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Bill total rounded to the nearest rupee, as printed. */
  totalPaise: number;
  /** totalPaise − exact total (between −50 and +50 paise). */
  roundOffPaise: number;
}

export function computeBill(lines: LineInput[], opts: BillOptions): BillTotals {
  const computed = lines.map((l) => computeLine(l, opts));
  const sum = (key: keyof LineAmounts) => computed.reduce((acc, l) => acc + l[key], 0);
  const exact = sum("totalPaise");
  const totalPaise = Math.round(exact / 100) * 100;
  return {
    lines: computed,
    taxablePaise: sum("taxablePaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    igstPaise: sum("igstPaise"),
    totalPaise,
    roundOffPaise: totalPaise - exact,
  };
}

/** Today's date in India (IST, UTC+5:30) as YYYY-MM-DD. */
export function todayIst(now = Date.now()): string {
  return new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "2026-11-16" → "16/11/2026" (as printed on Indian bills). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
