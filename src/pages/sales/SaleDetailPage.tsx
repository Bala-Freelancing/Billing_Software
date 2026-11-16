import { Link, useParams } from "react-router";
import { formatDate } from "../../../shared/gst";
import { stateName } from "../../../shared/india";
import { formatPaise, formatRate } from "../../../shared/money";
import type { SaleDetail } from "../../../shared/sales";
import { Alert, Badge, Button, Card, PageHeader, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import { CancelBox } from "../purchases/PurchaseDetailPage";

export function SaleDetailPage() {
  const { id } = useParams();
  const { data: s, error, loading, reload } = useFetch<SaleDetail>(`/sales/${id}`);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (loading || !s) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  const canReturn = s.status === "posted" && s.items.some((i) => i.quantity - i.returnedQuantity > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Invoice ${s.invoiceNo}`}
        subtitle={<Link to="/sales" className="text-slate-600 hover:underline">← All invoices</Link>}
        actions={
          <>
            {s.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : s.collectionType === "credit" ? <Badge tone="amber">Credit</Badge> : <Badge tone="green">Paid</Badge>}
            <Link to={`/sales/${s.id}/print`} target="_blank"><Button>Print invoice</Button></Link>
            {canReturn && <Link to={`/sales-returns/new?sale=${s.id}`}><Button variant="secondary">Sales return</Button></Link>}
          </>
        }
      />
      {s.status === "cancelled" && <Alert tone="error">Cancelled: {s.cancelReason}</Alert>}

      <div className="grid divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm md:grid-cols-4 md:divide-x md:divide-y-0">
        <Info label="Customer" value={s.bill.name} sub={s.bill.gstin ?? (s.bill.phone || "Unregistered")} />
        <Info label="Date" value={formatDate(s.invoiceDate)} sub={s.collectionType === "credit" ? `Due ${formatDate(s.dueDate)}` : "Paid immediately"} />
        <Info label="Place of supply" value={stateName(s.bill.stateCode)} sub={s.isInterstate ? "IGST" : "CGST + SGST"} />
        <Info label="Net amount" value={`₹${formatPaise(s.totalPaise)}`} sub={s.salesman ? `Sales man: ${s.salesman}` : undefined} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr><th className="px-4 py-3">Item</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Rate ₹</th><th className="px-4 py-3 text-right">GST</th><th className="px-4 py-3 text-right">Taxable ₹</th><th className="px-4 py-3 text-right">Amount ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {s.items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{i.brand} {i.productName}</p>
                  <p className="text-xs text-slate-500">HSN {i.hsnCode}{i.returnedQuantity > 0 && ` · ${i.returnedQuantity} returned`}</p>
                  {i.serials.length > 0 && <p className="mt-1 font-mono text-xs text-slate-600">{i.serials.map((sn) => (i.returnedSerials.includes(sn) ? `${sn} (returned)` : sn)).join(", ")}</p>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{i.quantity} {i.unit}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(i.ratePaise)}</td>
                <td className="px-4 py-3 text-right">{formatRate(i.gstRateBp)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(i.taxablePaise)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(i.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900">Accounting entry</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-2">Account</th><th className="pb-2 text-right">Debit ₹</th><th className="pb-2 text-right">Credit ₹</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {s.journal.map((j, idx) => (
                <tr key={idx}><td className="py-1.5">{j.account}</td><td className="py-1.5 text-right tabular-nums">{j.debitPaise ? formatPaise(j.debitPaise) : ""}</td><td className="py-1.5 text-right tabular-nums">{j.creditPaise ? formatPaise(j.creditPaise) : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold text-slate-900">Returns (credit notes)</h2>
          {s.returns.length === 0 ? <p className="text-sm text-slate-500">No returns against this invoice.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {s.returns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-mono">{r.creditNoteNo}</span> · {formatDate(r.returnDate)} · ₹{formatPaise(r.totalPaise)} {r.reason && `· ${r.reason}`}</span>
                  {r.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : <CancelBox label="Cancel return" onCancel={async (reason) => { await api(`/sales-returns/${r.id}/cancel`, { method: "POST", body: { reason } }); reload(); }} />}
                </li>
              ))}
            </ul>
          )}
          {s.status === "posted" && (
            <div className="border-t border-slate-200 pt-3">
              <CancelBox label="Cancel this invoice" onCancel={async (reason) => { await api(`/sales/${s.id}/cancel`, { method: "POST", body: { reason } }); reload(); }} />
            </div>
          )}
        </Card>
      </div>
      {s.remarks && <Card><p className="text-sm text-slate-600">Remarks: {s.remarks}</p></Card>}
    </div>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1.5 font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
