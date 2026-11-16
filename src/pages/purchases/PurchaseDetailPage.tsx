import { useState } from "react";
import { Link, useParams } from "react-router";
import { formatDate } from "../../../shared/gst";
import { formatPaise, formatRate } from "../../../shared/money";
import type { PurchaseDetail } from "../../../shared/purchase";
import { Alert, Badge, Button, Card, PageHeader, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  in_stock: "green",
  sold: "slate",
  returned_to_supplier: "amber",
  void: "red",
  damaged: "red",
};

export function CancelBox({ label, onCancel }: { label: string; onCancel: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onCancel(reason);
              setOpen(false);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not cancel.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm cancel
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Keep it</Button>
      </div>
    </div>
  );
}

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { data: p, error, loading, reload } = useFetch<PurchaseDetail>(`/purchases/${id}`);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (loading || !p) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  const canReturn = p.status === "posted" && p.items.some((i) => i.quantity - i.returnedQuantity > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Purchase · ${p.supplierInvoiceNo}`}
        subtitle={<Link to="/purchases" className="text-slate-600 hover:underline">← All purchases</Link>}
        actions={
          <>
            {p.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : <Badge tone="green">Posted</Badge>}
            {canReturn && <Link to={`/purchase-returns/new?purchase=${p.id}`}><Button variant="secondary">Return items</Button></Link>}
          </>
        }
      />
      {p.status === "cancelled" && <Alert tone="error">Cancelled: {p.cancelReason}</Alert>}

      <div className="grid divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm md:grid-cols-4 md:divide-x md:divide-y-0">
        <Info label="Supplier" value={p.supplier.name} sub={p.supplier.gstin ?? "Unregistered"} />
        <Info label="Invoice date" value={formatDate(p.invoiceDate)} sub={p.isInterstate ? "Interstate (IGST)" : "Within state (CGST + SGST)"} />
        <Info label="Rates" value={p.ratesIncludeGst ? "Include GST" : "Exclude GST"} sub={`${p.items.length} item(s)`} />
        <Info label="Total" value={`₹${formatPaise(p.totalPaise)}`} sub={`Taxable ₹${formatPaise(p.taxablePaise)}`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Rate ₹</th>
              <th className="px-4 py-3 text-right">GST</th>
              <th className="px-4 py-3 text-right">Taxable ₹</th>
              <th className="px-4 py-3 text-right">Tax ₹</th>
              <th className="px-4 py-3 text-right">Total ₹</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {p.items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{i.brand} {i.productName}</p>
                  <p className="text-xs text-slate-500">HSN {i.hsnCode}{i.returnedQuantity > 0 && ` · ${i.returnedQuantity} returned`}</p>
                  {i.units.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {i.units.map((u) => (
                        <span key={u.id} className="inline-flex items-center gap-1 font-mono text-xs">
                          {u.serial} <Badge tone={STATUS_TONE[u.status] ?? "slate"}>{u.status.replace(/_/g, " ")}</Badge>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{i.quantity} {i.unit}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(i.ratePaise)}</td>
                <td className="px-4 py-3 text-right">{formatRate(i.gstRateBp)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(i.taxablePaise)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(i.cgstPaise + i.sgstPaise + i.igstPaise)}</td>
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
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="pb-2">Account</th><th className="pb-2 text-right">Debit ₹</th><th className="pb-2 text-right">Credit ₹</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.journal.map((j, idx) => (
                <tr key={idx}>
                  <td className="py-1.5">{j.account}</td>
                  <td className="py-1.5 text-right tabular-nums">{j.debitPaise ? formatPaise(j.debitPaise) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{j.creditPaise ? formatPaise(j.creditPaise) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold text-slate-900">Returns</h2>
          {p.returns.length === 0 ? <p className="text-sm text-slate-500">No returns against this bill.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {p.returns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{formatDate(r.returnDate)} · ₹{formatPaise(r.totalPaise)} {r.reason && `· ${r.reason}`}</span>
                  {r.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : (
                    <CancelBox label="Cancel return" onCancel={async (reason) => { await api(`/purchase-returns/${r.id}/cancel`, { method: "POST", body: { reason } }); reload(); }} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {p.status === "posted" && (
            <div className="border-t border-slate-200 pt-3">
              <CancelBox label="Cancel this purchase" onCancel={async (reason) => { await api(`/purchases/${p.id}/cancel`, { method: "POST", body: { reason } }); reload(); }} />
            </div>
          )}
        </Card>
      </div>
      {p.notes && <Card><p className="text-sm text-slate-600">Notes: {p.notes}</p></Card>}
    </div>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1.5 font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
