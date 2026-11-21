import { Link } from "react-router";
import { formatDate } from "../../../shared/gst";
import { formatPaise } from "../../../shared/money";
import type { PurchaseReturnSummary } from "../../../shared/purchase";
import { Alert, Badge, PageHeader, Spinner } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

export function PurchaseReturnsPage() {
  const { data, error, loading } = useFetch<{ items: PurchaseReturnSummary[] }>("/purchase-returns");
  return (
    <div>
      <PageHeader title="Purchase returns" subtitle='To return items, open the purchase and choose "Return items".' />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="erp-table-wrap">
        <table className="erp-table min-w-full text-sm">
          <thead className="erp-thead text-left">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Against invoice</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3 text-right">Total ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && <tr><td colSpan={5} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
            {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No purchase returns yet.</td></tr>}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 tabular-nums">{formatDate(r.returnDate)}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{r.supplierName} {r.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}</td>
                <td className="px-4 py-3"><Link to={`/purchases/${r.purchaseId}`} className="font-mono hover:underline">{r.supplierInvoiceNo}</Link></td>
                <td className="px-4 py-3 text-slate-600">{r.reason || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(r.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
