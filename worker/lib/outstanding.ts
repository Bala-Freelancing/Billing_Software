// Bill-wise outstanding: what is still due on each credit invoice, purchase bill
// and party opening balance. One definition, used by the voucher save guard, the
// open-bills picker, statements and the outstanding report.
//
//   sale      = total − posted credit notes − posted receipt allocations
//   purchase  = total − posted debit notes  − posted payment allocations
//   opening   = the opening balance on that side − allocations of that kind
//
// Immediate (cash) sales are settled in their own journal and are never open.
import { AGEING_BUCKETS, type OutstandingBill, type TargetType, type VoucherKind } from "../../shared/vouchers";

const allocated = (targetType: TargetType, idExpr: string, kind?: VoucherKind) =>
  `COALESCE((SELECT SUM(a.amount_paise) FROM voucher_allocations a JOIN money_vouchers v ON v.id = a.voucher_id
     WHERE v.status = 'posted' AND a.target_type = '${targetType}' AND a.target_id = ${idExpr}${kind ? ` AND v.kind = '${kind}'` : ""}), 0)`;

export const saleOutstandingSql = (s = "s") =>
  `(${s}.total_paise - COALESCE((SELECT SUM(r.total_paise) FROM sales_returns r WHERE r.sale_id = ${s}.id AND r.status = 'posted'), 0) - ${allocated("sale", `${s}.id`)})`;

export const purchaseOutstandingSql = (p = "pu") =>
  `(${p}.total_paise - COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r WHERE r.purchase_id = ${p}.id AND r.status = 'posted'), 0) - ${allocated("purchase", `${p}.id`)})`;

/** Receipts settle a positive (receivable) opening; payments a negative (payable) one. */
export const openingOutstandingSql = (kind: VoucherKind, p = "p") =>
  kind === "receipt"
    ? `(MAX(${p}.opening_balance_paise, 0) - ${allocated("opening", `${p}.id`, "receipt")})`
    : `(MAX(-${p}.opening_balance_paise, 0) - ${allocated("opening", `${p}.id`, "payment")})`;

/** IST calendar date of a millisecond timestamp column. */
const istDate = (col: string) => `date(${col} / 1000, 'unixepoch', '+330 minutes')`;

/**
 * Open bills of the given side; `partyFilter` is SQL using ?1 (or "1" for all
 * parties). Columns: party_id, target_type, target_id, doc_no, doc_date, due_date, bill, outstanding.
 */
export function openBillsSql(kind: VoucherKind, partyFilter: (col: string) => string): string {
  if (kind === "receipt") {
    return `SELECT * FROM (
      SELECT p.id AS party_id, 'opening' AS target_type, p.id AS target_id, 'Opening balance' AS doc_no,
             ${istDate("p.created_at")} AS doc_date, ${istDate("p.created_at")} AS due_date,
             MAX(p.opening_balance_paise, 0) AS bill, ${openingOutstandingSql("receipt")} AS outstanding
        FROM parties p WHERE ${partyFilter("p.id")} AND p.opening_balance_paise > 0
      UNION ALL
      SELECT s.customer_id, 'sale', s.id, s.invoice_no, s.invoice_date, s.due_date, s.total_paise, ${saleOutstandingSql()}
        FROM sales s WHERE ${partyFilter("s.customer_id")} AND s.status = 'posted' AND s.collection_type = 'credit'
    ) WHERE outstanding > 0 ORDER BY party_id, target_type <> 'opening', doc_date, target_id`;
  }
  return `SELECT * FROM (
    SELECT p.id AS party_id, 'opening' AS target_type, p.id AS target_id, 'Opening balance' AS doc_no,
           ${istDate("p.created_at")} AS doc_date, ${istDate("p.created_at")} AS due_date,
           MAX(-p.opening_balance_paise, 0) AS bill, ${openingOutstandingSql("payment")} AS outstanding
      FROM parties p WHERE ${partyFilter("p.id")} AND p.opening_balance_paise < 0
    UNION ALL
    SELECT pu.supplier_id, 'purchase', pu.id, pu.supplier_invoice_no, pu.invoice_date, pu.invoice_date, pu.total_paise, ${purchaseOutstandingSql()}
      FROM purchases pu WHERE ${partyFilter("pu.supplier_id")} AND pu.status = 'posted'
  ) WHERE outstanding > 0 ORDER BY party_id, target_type <> 'opening', doc_date, target_id`;
}

export interface OpenBillRow {
  party_id: number;
  target_type: TargetType;
  target_id: number;
  doc_no: string;
  doc_date: string;
  due_date: string;
  bill: number;
  outstanding: number;
}

/** Whole days from ISO date `a` to ISO date `b`. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const toOutstandingBill = (r: OpenBillRow, today: string): OutstandingBill => ({
  targetType: r.target_type,
  targetId: r.target_id,
  docNo: r.doc_no,
  docDate: r.doc_date,
  dueDate: r.due_date,
  billAmountPaise: r.bill,
  outstandingPaise: r.outstanding,
  daysPending: Math.max(0, daysBetween(r.doc_date, today)),
  overdue: r.due_date < today,
});

export function ageing(bills: OutstandingBill[]) {
  return AGEING_BUCKETS.map((b, i) => {
    const min = i === 0 ? -Infinity : AGEING_BUCKETS[i - 1]!.max;
    return { bucket: b.label, amountPaise: bills.filter((x) => x.daysPending > min && x.daysPending <= b.max).reduce((s, x) => s + x.outstandingPaise, 0) };
  });
}
