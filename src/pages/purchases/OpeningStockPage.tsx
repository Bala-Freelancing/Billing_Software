import { useState, type FormEvent } from "react";
import type { Product, ScanResult } from "../../../shared/masters";
import { formatPaise, parseRupees } from "../../../shared/money";
import type { OpeningStockEntry } from "../../../shared/purchase";
import { ScanInput } from "../../components/ScanInput";
import { SearchPicker } from "../../components/SearchPicker";
import { Alert, Badge, Button, Card, PageHeader, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import { CancelBox } from "./PurchaseDetailPage";

/** Product Opening Balance: stock already in the shop before this software. */
export function OpeningStockPage() {
  const list = useFetch<{ items: OpeningStockEntry[] }>("/opening-stock");
  const [formKey, setFormKey] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader title="Opening stock" subtitle="Stock already in the shop before you started using this software." />
      <OpeningStockForm key={formKey} onSaved={() => { setFormKey((k) => k + 1); list.reload(); }} />
      {list.error && <Alert tone="error">{list.error}</Alert>}
      <div className="erp-table-wrap">
        <table className="erp-table min-w-full text-sm">
          <thead className="erp-thead text-left">
            <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Cost ₹</th><th className="px-4 py-3">Serials</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {list.data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No opening stock entered yet.</td></tr>}
            {list.data?.items.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{e.productName} {e.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(e.ratePaise)}</td>
                <td className="max-w-md px-4 py-3 font-mono text-xs text-slate-600">{e.serials.join(", ") || "—"}</td>
                <td className="px-4 py-3 text-right">
                  {e.status === "posted" && <CancelBox label="Cancel" onCancel={async (reason) => { await api(`/opening-stock/${e.id}/cancel`, { method: "POST", body: { reason } }); list.reload(); }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpeningStockForm({ onSaved }: { onSaved: () => void }) {
  const [uid] = useState(() => crypto.randomUUID());
  const [product, setProduct] = useState<Product | null>(null);
  const [rate, setRate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleScan(code: string) {
    setMessage(null);
    if (!product) {
      try {
        const r = await api<ScanResult>(`/scan/${encodeURIComponent(code)}`);
        if (r.kind === "product") return setProduct(r.product);
      } catch {
        /* fall through */
      }
      return setMessage({ tone: "error", text: "Choose the product first, then scan serial numbers." });
    }
    if (!product.tracksSerial) return setMessage({ tone: "error", text: "This product does not track serial numbers; enter a quantity." });
    if (serials.includes(code)) return setMessage({ tone: "error", text: `${code} is already in the list.` });
    const r = await api<ScanResult>(`/scan/${encodeURIComponent(code)}`).catch(() => null);
    if (r?.kind === "unit") return setMessage({ tone: "error", text: `${code} is already in the system (${r.status.replace(/_/g, " ")}).` });
    setSerials((s) => [...s, code]);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!product || saving) return;
    const ratePaise = parseRupees(rate);
    const qty = product.tracksSerial ? serials.length : Number(quantity);
    if (ratePaise === null) return setMessage({ tone: "error", text: "Enter the cost per unit in rupees." });
    if (!Number.isInteger(qty) || qty < 1) return setMessage({ tone: "error", text: product.tracksSerial ? "Scan at least one serial number." : "Enter a whole quantity." });
    setSaving(true);
    try {
      await api("/opening-stock", { method: "POST", body: { uid, productId: product.id, quantity: qty, ratePaise, serials } });
      onSaved();
    } catch (err) {
      setSaving(false);
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save." });
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <SearchPicker<Product>
              label="Product"
              path="/products"
              selected={product}
              onSelect={(p) => { setProduct(p); setSerials([]); }}
              render={(p) => ({ title: `${p.brand} ${p.name}`, subtitle: `In stock: ${p.inStock}${p.tracksSerial ? " · serial" : ""}` })}
            />
          </div>
          <TextField label="Cost per unit ₹ (excl. GST)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        {product && (product.tracksSerial ? (
          <div className="space-y-2">
            <ScanInput onScan={handleScan} placeholder="Scan each unit's serial number" />
            <div className="flex flex-wrap gap-1.5">
              {serials.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 font-mono text-xs">
                  {s} <button type="button" aria-label={`Remove ${s}`} className="text-slate-400 hover:text-red-700" onClick={() => setSerials((l) => l.filter((x) => x !== s))}>×</button>
                </span>
              ))}
            </div>
            <p className="text-sm text-slate-600">{serials.length} unit(s)</p>
          </div>
        ) : (
          <TextField className="w-40" label="Quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        ))}
        <Button type="submit" loading={saving} disabled={!product}>Add opening stock</Button>
      </form>
    </Card>
  );
}
