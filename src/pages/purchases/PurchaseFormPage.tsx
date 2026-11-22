import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { computeBill, todayIst } from "../../../shared/gst";
import type { Party, Product, ScanResult, ShopSettings } from "../../../shared/masters";
import { formatPaise, formatRate, parseRupees } from "../../../shared/money";
import type { PurchaseDetail } from "../../../shared/purchase";
import { ScanInput } from "../../components/ScanInput";
import { SearchPicker } from "../../components/SearchPicker";
import { Alert, Button, Card, CheckboxField, HeaderLink, PageHeader, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import { PurchasesPage } from "./PurchasesPage";

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
  const [ratesIncludeGst, setRatesIncludeGst] = useState(true);
  const [notes, setNotes] = useState("");
  const [billTotal, setBillTotal] = useState("");
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
      <PageHeader title="Purchase entry" actions={<><HeaderLink to="/parties/new">+ New supplier</HeaderLink><HeaderLink to="/products/new">+ New product</HeaderLink><HeaderLink to="/payments/new">Payment out</HeaderLink><HeaderLink to="/reports/purchases">Purchase report</HeaderLink></>} />
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
              {supplier && (
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className={supplier.balancePaise < 0 ? "font-semibold text-red-700" : "text-slate-600"}>
                    {supplier.balancePaise <= 0 ? `We owe ₹${formatPaise(-supplier.balancePaise)}` : `They owe us ₹${formatPaise(supplier.balancePaise)}`}
                    {supplier.creditDays > 0 && ` · credit ${supplier.creditDays} days`}
                  </span>
                  <Link to={`/statement?party=${supplier.id}`} className="font-semibold text-[var(--erp-blue)] hover:underline">Statement of account</Link>
                </p>
              )}
            </div>
            <TextField label="Supplier invoice no." value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} errors={errors.supplierInvoiceNo} />
            <TextField label="Invoice date" type="date" max={todayIst()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} errors={errors.invoiceDate} />
          </div>
          <div className="mt-4">
            <CheckboxField
              label="Rates include GST"
              description="Turn off to enter rates exactly as printed on the supplier's tax invoice (before GST)."
              checked={ratesIncludeGst}
              onChange={setRatesIncludeGst}
            />
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-center text-lg font-bold text-[var(--erp-blue)]">Purchase table</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[13px] text-slate-600">Scan</p>
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

          <div className="erp-table-wrap">
            <table className="erp-table w-full min-w-[900px] text-sm">
              <thead className="erp-thead">
                <tr>
                  <th className="w-10 px-2 text-center">#</th>
                  <th className="px-3 text-left">Product</th>
                  <th className="px-3 text-left">Serial no.</th>
                  <th className="w-24 px-2 text-center">Quantity</th>
                  <th className="px-2 text-center">Unit</th>
                  <th className="w-32 px-2 text-center">Rate ₹ {ratesIncludeGst ? "(incl.)" : "(excl.)"}</th>
                  <th className="px-2 text-center">GST %</th>
                  <th className="px-2 text-right">Taxable ₹</th>
                  <th className="px-3 text-right">Total ₹</th>
                  <th className="w-10 px-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">No items yet. Scan a product barcode or search for a product to add it.</td></tr>
                )}
                {lines.map((l, i) => {
                  const amounts = preview.lines[i];
                  const isActive = l.key === active;
                  return (
                    <tr key={l.key} className={`cursor-pointer align-top ${isActive ? "!bg-[var(--erp-row-hover)]" : ""}`} onClick={() => setActive(l.key)}>
                      <td className="px-2 text-center text-slate-500">{i + 1}</td>
                      <td className="px-3">
                        <p className="font-medium text-slate-900">{l.product.brand} {l.product.name}</p>
                        <p className="text-xs text-slate-500">HSN {l.product.hsnCode}{isActive && l.product.tracksSerial && <span className="ml-2 font-semibold text-[var(--erp-blue)]">● Scanning into this item</span>}</p>
                        {errors[`line-${l.key}`] && <p className="mt-1 text-xs text-red-700">{errors[`line-${l.key}`]?.[0]}</p>}
                      </td>
                      <td className="px-3">
                        {l.product.tracksSerial ? (
                          <div className="flex max-w-64 flex-wrap gap-1">
                            {l.serials.length === 0 && <span className="text-xs text-slate-500">Scan serial numbers for this item.</span>}
                            {l.serials.map((s) => (
                              <span key={s} className="inline-flex items-center gap-1 rounded bg-[var(--erp-row-hover)] px-1.5 py-0.5 text-xs font-medium text-[var(--erp-blue-dark)]">
                                {s}
                                <button type="button" aria-label={`Remove ${s}`} className="text-slate-500 hover:text-red-700" onClick={(e) => { e.stopPropagation(); const serials = l.serials.filter((x) => x !== s); updateLine(l.key, { serials, quantity: String(serials.length) }); }}>×</button>
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-2">
                        {l.product.tracksSerial ? <p className="text-center font-semibold tabular-nums">{l.serials.length}</p>
                          : <input aria-label={`Quantity for ${l.product.name}`} inputMode="numeric" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="w-full rounded border-0 px-2 py-1 text-right tabular-nums ring-1 ring-inset ring-[var(--erp-field-border)] focus:ring-2 focus:ring-[var(--erp-blue)]" />}
                      </td>
                      <td className="px-2 text-center text-slate-600">{l.product.unit}</td>
                      <td className="px-2"><input aria-label={`Rate for ${l.product.name}`} inputMode="decimal" value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} className="w-full rounded border-0 px-2 py-1 text-right tabular-nums ring-1 ring-inset ring-[var(--erp-field-border)] focus:ring-2 focus:ring-[var(--erp-blue)]" /></td>
                      <td className="px-2 text-center tabular-nums">{formatRate(l.product.gstRateBp)}</td>
                      <td className="px-2 text-right tabular-nums text-slate-600">{formatPaise(amounts?.taxablePaise ?? 0)}</td>
                      <td className="px-3 text-right font-semibold tabular-nums">{formatPaise(amounts?.totalPaise ?? 0)}</td>
                      <td className="px-2 text-center">
                        <button type="button" aria-label={`Remove ${l.product.name}`} className="rounded p-1 text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); setLines((ls) => ls.filter((x) => x.key !== l.key)); if (isActive) setActive(null); }}>
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
          <Card>
            <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Card>
          <Card>
            <dl className="divide-y divide-[var(--erp-panel-border)] text-sm">
              <Row label="Taxable amount" value={preview.taxablePaise} />
              {interstate ? <Row label="IGST amount" value={preview.igstPaise} /> : (<><Row label="CGST amount" value={preview.cgstPaise} /><Row label="SGST amount" value={preview.sgstPaise} /></>)}
              <Row label="Round off" value={preview.roundOffPaise} />
              <div className="flex justify-between bg-[var(--erp-row-hover)] px-2 py-2 text-base font-bold text-[var(--erp-blue-dark)]"><dt>Net amount</dt><dd className="tabular-nums">₹{formatPaise(preview.totalPaise)}</dd></div>
            </dl>
            <div className="mt-3">
              <TextField label="Supplier bill total ₹ (to check)" inputMode="decimal" value={billTotal} onChange={(e) => setBillTotal(e.target.value)} />
              {billTotal.trim() !== "" && <BillCheck typed={parseRupees(billTotal)} ours={preview.totalPaise} />}
            </div>
            <Button type="submit" className="mt-4 w-full" loading={saving}>Save purchase</Button>
          </Card>
        </div>
      </form>

      <h2 className="mb-3 mt-8 text-base font-bold text-slate-900">Purchase bills</h2>
      <PurchasesPage embedded />
    </div>
  );
}

/** Compares the supplier's printed total with ours, to catch a wrong rate or a missed item before saving. */
function BillCheck({ typed, ours }: { typed: number | null; ours: number }) {
  if (typed === null) return <p className="mt-1 text-xs text-red-700">Enter the amount in rupees.</p>;
  const diff = ours - typed;
  return diff === 0 ? (
    <p className="mt-1 text-sm font-semibold text-green-700">Matches the supplier's bill.</p>
  ) : (
    <p className="mt-1 text-sm font-semibold text-red-700">Differs by ₹{formatPaise(Math.abs(diff))} ({diff > 0 ? "ours is higher" : "ours is lower"}).</p>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between px-2 py-1.5">
      <dt className="font-semibold text-slate-700">{label}</dt>
      <dd className="tabular-nums text-slate-900">₹{formatPaise(value)}</dd>
    </div>
  );
}
