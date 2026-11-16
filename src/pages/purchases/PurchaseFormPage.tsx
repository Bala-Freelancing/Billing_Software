import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { computeBill, todayIst } from "../../../shared/gst";
import type { Party, Product, ScanResult, ShopSettings } from "../../../shared/masters";
import { formatPaise, formatRate, parseRupees } from "../../../shared/money";
import type { PurchaseDetail } from "../../../shared/purchase";
import { ScanInput } from "../../components/ScanInput";
import { SearchPicker } from "../../components/SearchPicker";
import { Alert, Button, Card, CheckboxField, PageHeader, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

interface Line {
  key: string;
  product: Product;
  quantity: string;
  rate: string;
  serials: string[];
}

export function PurchaseFormPage() {
  const navigate = useNavigate();
  const shop = useFetch<ShopSettings>("/settings/shop");
  const [uid] = useState(() => crypto.randomUUID());
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIst());
  const [ratesIncludeGst, setRatesIncludeGst] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const interstate = supplier !== null && shop.data !== null && supplier.stateCode !== shop.data.stateCode;

  function addProduct(product: Product) {
    const existing = lines.find((l) => l.product.id === product.id);
    if (existing) {
      setActive(existing.key);
      if (!product.tracksSerial) updateLine(existing.key, { quantity: String((Number(existing.quantity) || 0) + 1) });
      return existing.key;
    }
    const key = crypto.randomUUID();
    setLines((ls) => [...ls, { key, product, quantity: product.tracksSerial ? "0" : "1", rate: "", serials: [] }]);
    setActive(key);
    return key;
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleScan(code: string) {
    setScanMessage(null);
    if (lines.some((l) => l.serials.includes(code))) {
      setScanMessage({ tone: "error", text: `${code} is already scanned on this bill.` });
      return;
    }
    let result: ScanResult;
    try {
      result = await api<ScanResult>(`/scan/${encodeURIComponent(code)}`);
    } catch (err) {
      setScanMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Scan failed." });
      return;
    }
    if (result.kind === "product") {
      addProduct(result.product);
      setScanMessage({ tone: "info", text: `${result.product.name} selected. ${result.product.tracksSerial ? "Now scan each unit's serial number." : ""}` });
      return;
    }
    if (result.kind === "unit") {
      setScanMessage({ tone: "error", text: `${code} is already in the system (${result.status.replace(/_/g, " ")}, ${result.product.name}).` });
      return;
    }
    const line = lines.find((l) => l.key === active);
    if (!line || !line.product.tracksSerial) {
      setScanMessage({ tone: "error", text: "Choose the product first (search below or scan its barcode), then scan the serial numbers." });
      return;
    }
    updateLine(line.key, { serials: [...line.serials, code], quantity: String(line.serials.length + 1) });
    setScanMessage({ tone: "success", text: `Added ${code} to ${line.product.name}.` });
  }

  const preview = computeBill(
    lines.map((l) => ({
      quantity: l.product.tracksSerial ? l.serials.length : Number(l.quantity) || 0,
      ratePaise: parseRupees(l.rate) ?? 0,
      gstRateBp: l.product.gstRateBp,
    })),
    { interstate, ratesIncludeGst },
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const next: Record<string, string[]> = {};
    if (!supplier) next.supplierId = ["Choose a supplier"];
    if (!invoiceNo.trim()) next.supplierInvoiceNo = ["Enter the supplier's invoice number"];
    if (!lines.length) next.lines = ["Add at least one product"];
    for (const l of lines) {
      const qty = l.product.tracksSerial ? l.serials.length : Number(l.quantity);
      if (!Number.isInteger(qty) || qty < 1) next[`line-${l.key}`] = [l.product.tracksSerial ? "Scan at least one serial number" : "Enter a whole quantity"];
      else if (parseRupees(l.rate) === null) next[`line-${l.key}`] = ["Enter the rate in rupees"];
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setFormError("Please fix the highlighted items.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api<PurchaseDetail>("/purchases", {
        method: "POST",
        body: {
          uid,
          supplierId: supplier?.id,
          supplierInvoiceNo: invoiceNo,
          invoiceDate,
          ratesIncludeGst,
          notes,
          lines: lines.map((l) => ({
            productId: l.product.id,
            quantity: l.product.tracksSerial ? l.serials.length : Number(l.quantity),
            ratePaise: parseRupees(l.rate),
            serials: l.serials,
          })),
        },
      });
      navigate(`/purchases/${saved.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError("Something went wrong. Please try again.");
    }
  }

  return (
    <div>
      <PageHeader title="New purchase" subtitle={<Link to="/purchases" className="text-slate-600 hover:underline">← All purchases</Link>} />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Card>
          <div className="grid gap-5 md:grid-cols-4">
            <div className="md:col-span-2">
              <SearchPicker<Party>
                label="Supplier"
                path="/parties"
                extraParams={{ type: "supplier" }}
                selected={supplier}
                onSelect={setSupplier}
                render={(p) => ({ title: p.name, subtitle: [p.gstin, p.city].filter(Boolean).join(" · ") })}
                errors={errors.supplierId}
              />
              {supplier && <p className="mt-1 text-xs text-slate-500">{interstate ? "Other state: IGST" : "Same state: CGST + SGST"}</p>}
            </div>
            <TextField label="Supplier invoice no." value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} errors={errors.supplierInvoiceNo} />
            <TextField label="Invoice date" type="date" max={todayIst()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} errors={errors.invoiceDate} />
          </div>
          <div className="mt-4">
            <CheckboxField
              label="Rates include GST"
              description="Leave off to enter rates exactly as printed on the supplier's tax invoice (before GST)."
              checked={ratesIncludeGst}
              onChange={setRatesIncludeGst}
            />
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Scan</p>
              <ScanInput onScan={handleScan} placeholder="Scan product barcode, then each serial number" />
            </div>
            <SearchPicker<Product>
              label="Add product"
              path="/products"
              selected={null}
              onSelect={(p) => p && addProduct(p)}
              render={(p) => ({ title: `${p.brand} ${p.name}`, subtitle: `${formatRate(p.gstRateBp)} · HSN ${p.hsnCode}${p.tracksSerial ? " · serial" : ""}` })}
            />
          </div>
          {scanMessage && <Alert tone={scanMessage.tone}>{scanMessage.text}</Alert>}
          {errors.lines && <Alert tone="error">{errors.lines.join(" ")}</Alert>}

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No items yet. Scan a product barcode or search for a product to add it.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {lines.map((l, i) => {
                const amounts = preview.lines[i];
                const isActive = l.key === active;
                return (
                  <div key={l.key} className={`p-4 ${isActive ? "bg-slate-50" : ""}`} onClick={() => setActive(l.key)}>
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="min-w-48 flex-1">
                        <p className="font-medium text-slate-900">{l.product.brand} {l.product.name}</p>
                        <p className="text-xs text-slate-500">
                          HSN {l.product.hsnCode} · GST {formatRate(l.product.gstRateBp)}
                          {isActive && l.product.tracksSerial && <span className="ml-2 font-semibold text-slate-900">● Scanning into this item</span>}
                        </p>
                      </div>
                      <div className="w-24">
                        {l.product.tracksSerial ? (
                          <div><p className="text-xs text-slate-500">Qty</p><p className="py-2 font-semibold tabular-nums">{l.serials.length}</p></div>
                        ) : (
                          <TextField label="Qty" inputMode="numeric" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                        )}
                      </div>
                      <div className="w-36">
                        <TextField label={`Rate ₹ ${ratesIncludeGst ? "(incl.)" : "(excl.)"}`} inputMode="decimal" value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} />
                      </div>
                      <div className="w-32 text-right">
                        <p className="text-xs text-slate-500">Amount</p>
                        <p className="py-2 font-semibold tabular-nums">₹{formatPaise(amounts?.totalPaise ?? 0)}</p>
                      </div>
                      <button type="button" className="pt-6 text-sm text-red-700 hover:underline" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); if (isActive) setActive(null); }}>
                        Remove
                      </button>
                    </div>
                    {l.product.tracksSerial && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {l.serials.length === 0 && <span className="text-xs text-slate-500">Scan serial numbers for this item.</span>}
                        {l.serials.map((s) => (
                          <span key={s} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs">
                            {s}
                            <button type="button" aria-label={`Remove ${s}`} className="text-slate-400 hover:text-red-700" onClick={(e) => { e.stopPropagation(); const serials = l.serials.filter((x) => x !== s); updateLine(l.key, { serials, quantity: String(serials.length) }); }}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {errors[`line-${l.key}`] && <p className="mt-2 text-sm text-red-700">{errors[`line-${l.key}`]?.[0]}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
          <Card>
            <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Card>
          <Card>
            <dl className="space-y-1.5 text-sm">
              <Row label="Taxable value" value={preview.taxablePaise} />
              {interstate ? <Row label="IGST" value={preview.igstPaise} /> : (<><Row label="CGST" value={preview.cgstPaise} /><Row label="SGST" value={preview.sgstPaise} /></>)}
              <Row label="Round off" value={preview.roundOffPaise} />
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">₹{formatPaise(preview.totalPaise)}</dd></div>
            </dl>
            <Button type="submit" className="mt-4 w-full" loading={saving}>Save purchase</Button>
          </Card>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="tabular-nums text-slate-900">₹{formatPaise(value)}</dd>
    </div>
  );
}
