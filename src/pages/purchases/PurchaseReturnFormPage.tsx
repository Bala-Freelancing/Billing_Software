import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { formatDate, todayIst } from "../../../shared/gst";
import type { PurchaseDetail } from "../../../shared/purchase";
import { Alert, Button, Card, PageHeader, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

export function PurchaseReturnFormPage() {
  const [search] = useSearchParams();
  const purchaseId = search.get("purchase");
  const { data: p, error, loading } = useFetch<PurchaseDetail>(purchaseId ? `/purchases/${purchaseId}` : null);
  if (!purchaseId) return <Alert tone="info">Open a purchase and choose "Return items".</Alert>;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (loading || !p) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  return <ReturnForm purchase={p} />;
}

function ReturnForm({ purchase: p }: { purchase: PurchaseDetail }) {
  const navigate = useNavigate();
  const [uid] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(todayIst());
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState<Record<number, string[]>>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (itemId: number, serial: string) =>
    setChosen((c) => {
      const list = c[itemId] ?? [];
      return { ...c, [itemId]: list.includes(serial) ? list.filter((s) => s !== serial) : [...list, serial] };
    });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const lines = p.items
      .map((i) => {
        const serials = i.tracksSerial ? (chosen[i.id] ?? []) : [];
        const quantity = i.tracksSerial ? serials.length : Number(quantities[i.id] ?? 0);
        return { purchaseItemId: i.id, quantity, serials };
      })
      .filter((l) => l.quantity > 0);
    if (!lines.length) return setFormError("Choose at least one unit or quantity to return.");
    if (lines.some((l) => !Number.isInteger(l.quantity))) return setFormError("Quantities must be whole numbers.");
    setSaving(true);
    setFormError(null);
    try {
      await api("/purchase-returns", { method: "POST", body: { uid, purchaseId: p.id, returnDate: date, reason, lines } });
      navigate(`/purchases/${p.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Purchase return"
        subtitle={<Link to={`/purchases/${p.id}`} className="text-slate-600 hover:underline">← {p.supplier.name} · {p.supplierInvoiceNo} · {formatDate(p.invoiceDate)}</Link>}
      />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Card className="grid gap-5 sm:grid-cols-2">
          <TextField label="Return date" type="date" min={p.invoiceDate} max={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Reason" placeholder="Damaged, wrong model…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Card>
        <Card className="space-y-5">
          {p.items.map((i) => {
            const left = i.quantity - i.returnedQuantity;
            const inStock = i.units.filter((u) => u.status === "in_stock");
            return (
              <div key={i.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                <p className="font-medium text-slate-900">{i.brand} {i.productName}</p>
                <p className="text-xs text-slate-500">{left} of {i.quantity} can still be returned</p>
                {i.tracksSerial ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {inStock.length === 0 && <span className="text-sm text-slate-500">No units from this bill are in stock.</span>}
                    {inStock.map((u) => (
                      <label key={u.id} className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-xs ${(chosen[i.id] ?? []).includes(u.serial) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
                        <input type="checkbox" className="sr-only" checked={(chosen[i.id] ?? []).includes(u.serial)} onChange={() => toggle(i.id, u.serial)} />
                        {u.serial}
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
        <Button type="submit" loading={saving}>Save return</Button>
      </form>
    </div>
  );
}
