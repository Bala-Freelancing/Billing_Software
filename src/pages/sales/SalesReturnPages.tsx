import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { formatDate, todayIst } from "../../../shared/gst";
import { formatPaise } from "../../../shared/money";
import type { SaleDetail, SalesReturnSummary } from "../../../shared/sales";
import { Alert, Badge, Button, Card, PageHeader, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

export function SalesReturnsPage() {
  const { data, error, loading } = useFetch<{ items: SalesReturnSummary[] }>("/sales-returns");
  return (
    <div>
      <PageHeader title="Sales returns" subtitle='Credit notes. To return items, open the invoice and choose "Sales return".' />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr><th className="px-4 py-3">Credit note</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Against invoice</th><th className="px-4 py-3 text-right">Amount ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && <tr><td colSpan={5} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
            {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No sales returns yet.</td></tr>}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-mono font-medium">{r.creditNoteNo} {r.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}</td>
                <td className="px-4 py-3 tabular-nums">{formatDate(r.returnDate)}</td>
                <td className="px-4 py-3">{r.billName}</td>
                <td className="px-4 py-3"><Link to={`/sales/${r.saleId}`} className="font-mono hover:underline">{r.invoiceNo}</Link></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(r.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SalesReturnFormPage() {
  const [search] = useSearchParams();
  const saleId = search.get("sale");
  const { data, error, loading } = useFetch<SaleDetail>(saleId ? `/sales/${saleId}` : null);
  if (!saleId) return <Alert tone="info">Open an invoice and choose "Sales return".</Alert>;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (loading || !data) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  return <ReturnForm sale={data} />;
}

function ReturnForm({ sale: s }: { sale: SaleDetail }) {
  const navigate = useNavigate();
  const [uid] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(todayIst());
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState<Record<number, string[]>>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const lines = s.items
      .map((i) => {
        const serials = i.tracksSerial ? (chosen[i.id] ?? []) : [];
        return { saleItemId: i.id, quantity: i.tracksSerial ? serials.length : Number(quantities[i.id] ?? 0), serials };
      })
      .filter((l) => l.quantity > 0);
    if (!lines.length) return setError("Choose at least one unit or quantity to return.");
    if (lines.some((l) => !Number.isInteger(l.quantity))) return setError("Quantities must be whole numbers.");
    setSaving(true);
    setError(null);
    try {
      await api("/sales-returns", { method: "POST", body: { uid, saleId: s.id, returnDate: date, reason, lines } });
      navigate(`/sales/${s.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Sales return" subtitle={<Link to={`/sales/${s.id}`} className="text-slate-600 hover:underline">← {s.invoiceNo} · {s.bill.name} · {formatDate(s.invoiceDate)}</Link>} />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}
        <Card className="grid gap-5 sm:grid-cols-2">
          <TextField label="Return date" type="date" min={s.invoiceDate} max={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Reason" placeholder="Defective, wrong model…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Card>
        <Card className="space-y-5">
          {s.items.map((i) => {
            const returnable = i.serials.filter((sn) => !i.returnedSerials.includes(sn));
            const picked = chosen[i.id] ?? [];
            return (
              <div key={i.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                <p className="font-medium text-slate-900">{i.brand} {i.productName}</p>
                <p className="text-xs text-slate-500">{i.quantity - i.returnedQuantity} of {i.quantity} can be returned · ₹{formatPaise(i.ratePaise)} each</p>
                {i.tracksSerial ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {returnable.map((sn) => (
                      <label key={sn} className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-xs ${picked.includes(sn) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
                        <input type="checkbox" className="sr-only" checked={picked.includes(sn)} onChange={() => setChosen((c) => ({ ...c, [i.id]: picked.includes(sn) ? picked.filter((x) => x !== sn) : [...picked, sn] }))} />
                        {sn}
                      </label>
                    ))}
                  </div>
                ) : (
                  <TextField className="mt-2 w-32" label="Quantity" inputMode="numeric" value={quantities[i.id] ?? ""} onChange={(e) => setQuantities((q) => ({ ...q, [i.id]: e.target.value }))} />
                )}
              </div>
            );
          })}
        </Card>
        <Button type="submit" loading={saving}>Save credit note</Button>
      </form>
    </div>
  );
}
