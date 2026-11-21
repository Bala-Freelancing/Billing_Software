import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { computeBill, todayIst } from "../../../shared/gst";
import { HOME_STATE_CODE, STATES } from "../../../shared/india";
import type { ListResponse, Party, Product, ScanResult } from "../../../shared/masters";
import { formatPaise, formatRate, paiseToInput, parseRupees } from "../../../shared/money";
import type { SaleDetail } from "../../../shared/sales";
import { ScanInput } from "../../components/ScanInput";
import { SearchPicker } from "../../components/SearchPicker";
import { Alert, Button, Card, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

interface Line {
  key: string;
  product: Product;
  quantity: string;
  rate: string;
  serials: string[];
}

const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

export function SaleFormPage() {
  const counterList = useFetch<ListResponse<Party>>("/parties?q=Counter%20Sales&type=customer");
  const counter = counterList.data?.items.find((p) => p.isCounter) ?? null;
  if (counterList.error) return <Alert tone="error">{counterList.error}</Alert>;
  if (!counterList.data) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  return <SaleForm counter={counter} />;
}

function SaleForm({ counter }: { counter: Party | null }) {
  const navigate = useNavigate();
  const shop = useFetch<{ stateCode: string }>("/settings/shop");
  const [uid] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<Party | null>(counter);
  const [billName, setBillName] = useState("");
  const [billPhone, setBillPhone] = useState("");
  const [billGstin, setBillGstin] = useState("");
  const [billStateCode, setBillStateCode] = useState(HOME_STATE_CODE);
  const [invoiceDate, setInvoiceDate] = useState(todayIst());
  const [collectionType, setCollectionType] = useState<"immediate" | "credit">("immediate");
  const [dueDate, setDueDate] = useState(plusDays(todayIst(), 30));
  const [salesman, setSalesman] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [pickFor, setPickFor] = useState<Product | null>(null);

  const isCounter = customer?.isCounter ?? false;
  const stateCode = isCounter ? billStateCode : (customer?.stateCode ?? HOME_STATE_CODE);
  const interstate = shop.data ? stateCode !== shop.data.stateCode : false;

  function chooseCustomer(p: Party | null) {
    setCustomer(p);
    if (p?.isCounter) setCollectionType("immediate");
  }

  function addSerial(product: Product, serial: string) {
    setLines((ls) => {
      const existing = ls.find((l) => l.product.id === product.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, serials: [...l.serials, serial], quantity: String(l.serials.length + 1) } : l));
      return [...ls, { key: crypto.randomUUID(), product, quantity: "1", rate: paiseToInput(product.sellingPricePaise), serials: [serial] }];
    });
  }

  function addQuantityProduct(product: Product) {
    setLines((ls) => {
      const existing = ls.find((l) => l.product.id === product.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...ls, { key: crypto.randomUUID(), product, quantity: "1", rate: paiseToInput(product.sellingPricePaise), serials: [] }];
    });
  }

  async function handleScan(code: string) {
    setMessage(null);
    if (lines.some((l) => l.serials.includes(code))) return setMessage({ tone: "error", text: `${code} is already on this bill.` });
    let r: ScanResult;
    try {
      r = await api<ScanResult>(`/scan/${encodeURIComponent(code)}`);
    } catch (err) {
      return setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Scan failed." });
    }
    if (r.kind === "none") return setMessage({ tone: "error", text: `${code} was not found. Is it purchased and entered?` });
    if (r.kind === "unit") {
      if (r.status !== "in_stock") return setMessage({ tone: "error", text: `${code} is not in stock (${r.status.replace(/_/g, " ")}).` });
      if (!r.product.isActive) return setMessage({ tone: "error", text: `${r.product.name} is inactive.` });
      addSerial(r.product, r.serial);
      return setMessage({ tone: "success", text: `Added ${r.product.name} · ${r.serial}` });
    }
    if (r.product.tracksSerial) {
      setPickFor(r.product);
      return setMessage({ tone: "info", text: `Scan the serial number on the ${r.product.name}, or pick one below.` });
    }
    addQuantityProduct(r.product);
    setMessage({ tone: "success", text: `Added ${r.product.name}` });
  }

  const updateLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const preview = computeBill(
    lines.map((l) => ({ quantity: l.product.tracksSerial ? l.serials.length : Number(l.quantity) || 0, ratePaise: parseRupees(l.rate) ?? 0, gstRateBp: l.product.gstRateBp })),
    { interstate, ratesIncludeGst: true },
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const next: Record<string, string[]> = {};
    if (!customer) next.customerId = ["Choose a customer"];
    if (!lines.length) next.lines = ["Scan or add at least one item"];
    for (const l of lines) {
      const rate = parseRupees(l.rate);
      const qty = l.product.tracksSerial ? l.serials.length : Number(l.quantity);
      if (!Number.isInteger(qty) || qty < 1) next[`line-${l.key}`] = ["Enter a whole quantity"];
      else if (rate === null) next[`line-${l.key}`] = ["Enter the rate"];
      else if (rate > l.product.mrpPaise) next[`line-${l.key}`] = [`Rate cannot exceed MRP ₹${formatPaise(l.product.mrpPaise)}`];
      else if (!l.product.tracksSerial && qty > l.product.inStock) next[`line-${l.key}`] = [`Only ${l.product.inStock} in stock`];
    }
    setErrors(next);
    if (Object.keys(next).length) return setFormError("Please fix the highlighted items.");
    setSaving(true);
    try {
      const sale = await api<SaleDetail>("/sales", {
        method: "POST",
        body: {
          uid, customerId: customer?.id, billName, billPhone, billGstin, billStateCode: isCounter ? billStateCode : "",
          invoiceDate, collectionType, dueDate: collectionType === "credit" ? dueDate : invoiceDate, salesman, remarks,
          lines: lines.map((l) => ({ productId: l.product.id, quantity: l.product.tracksSerial ? l.serials.length : Number(l.quantity), ratePaise: parseRupees(l.rate), serials: l.serials })),
        },
      });
      navigate(`/sales/${sale.id}`, { replace: true });
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
      <PageHeader title="New sale" actions={<><Link to="/sales"><Button type="button" variant="secondary">All invoices</Button></Link><Link to="/parties/new"><Button type="button">Add retailer</Button></Link><Link to="/products/new"><Button type="button">Add new product</Button></Link><Link to="/reports/sales"><Button type="button">Report</Button></Link></>} />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Card>
          <div className="grid gap-5 md:grid-cols-4">
            <div className="md:col-span-2">
              <SearchPicker<Party>
                label="Customer"
                path="/parties"
                extraParams={{ type: "customer" }}
                selected={customer}
                onSelect={chooseCustomer}
                render={(p) => ({ title: p.name, subtitle: p.isCounter ? "Walk-in, paid immediately" : [p.gstin, p.city].filter(Boolean).join(" · ") })}
                errors={errors.customerId}
              />
              {customer && <p className="mt-1 text-xs text-slate-500">{interstate ? "Other state: IGST" : "Same state: CGST + SGST"}</p>}
            </div>
            <TextField label="Invoice date" type="date" max={todayIst()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} errors={errors.invoiceDate} />
            <TextField label="Sales man" value={salesman} onChange={(e) => setSalesman(e.target.value)} />
            <SelectField label="Collection type" value={collectionType} onChange={(e) => setCollectionType(e.target.value as "immediate" | "credit")} disabled={isCounter} errors={errors.collectionType}>
              <option value="immediate">Immediate (paid now)</option>
              <option value="credit">Credit</option>
            </SelectField>
            {collectionType === "credit" && <TextField label="Due date" type="date" min={invoiceDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} errors={errors.dueDate} />}
            {isCounter && (
              <>
                <TextField label="Customer name (optional)" value={billName} onChange={(e) => setBillName(e.target.value)} />
                <TextField label="Phone (optional)" inputMode="tel" value={billPhone} onChange={(e) => setBillPhone(e.target.value)} />
                <TextField label="GSTIN (optional)" className="font-mono" maxLength={15} value={billGstin} onChange={(e) => { const v = e.target.value.toUpperCase(); setBillGstin(v); if (v.length >= 2 && STATES.some((s) => s.code === v.slice(0, 2))) setBillStateCode(v.slice(0, 2)); }} errors={errors.billGstin} />
                <SelectField label="State" value={billStateCode} onChange={(e) => setBillStateCode(e.target.value)} errors={errors.billStateCode}>
                  {STATES.map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}
                </SelectField>
              </>
            )}
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-center text-lg font-bold text-[var(--erp-blue)]">Bill items</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[13px] text-slate-600">Scan to bill</p>
              <ScanInput onScan={handleScan} autoFocus placeholder="Scan the serial number on each unit" />
            </div>
            <SearchPicker<Product>
              label="Add by name"
              path="/products"
              selected={null}
              onSelect={(p) => { if (!p) return; if (p.tracksSerial) setPickFor(p); else addQuantityProduct(p); }}
              render={(p) => ({ title: `${p.brand} ${p.name}`, subtitle: `₹${formatPaise(p.sellingPricePaise)} · stock ${p.inStock}${p.tracksSerial ? " · serial" : ""}` })}
            />
          </div>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {pickFor && <SerialPicker product={pickFor} exclude={lines.flatMap((l) => l.serials)} onPick={(s) => { addSerial(pickFor, s); setMessage({ tone: "success", text: `Added ${pickFor.name} · ${s}` }); }} onClose={() => setPickFor(null)} />}
          {errors.lines && <Alert tone="error">{errors.lines.join(" ")}</Alert>}

          <div className="erp-table-wrap">
            <table className="erp-table w-full min-w-[900px] text-sm">
              <thead className="erp-thead">
                <tr>
                  <th className="w-10 px-2 text-center">#</th>
                  <th className="px-3 text-left">Product</th>
                  <th className="px-3 text-left">Serial no.</th>
                  <th className="px-2 text-right">Stock</th>
                  <th className="w-24 px-2 text-center">Quantity</th>
                  <th className="px-2 text-center">Unit</th>
                  <th className="w-32 px-2 text-center">Rate ₹ (incl. GST)</th>
                  <th className="px-2 text-center">GST %</th>
                  <th className="px-2 text-right">MRP ₹</th>
                  <th className="px-3 text-right">Total ₹</th>
                  <th className="w-10 px-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">Scan the serial number on each unit, or add a product by name, to start the bill.</td></tr>
                )}
                {lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <td className="px-2 text-center text-slate-500">{i + 1}</td>
                    <td className="px-3">
                      <p className="font-medium text-slate-900">{l.product.brand} {l.product.name}</p>
                      <p className="text-xs text-slate-500">HSN {l.product.hsnCode}</p>
                      {errors[`line-${l.key}`] && <p className="mt-1 text-xs text-red-700">{errors[`line-${l.key}`]?.[0]}</p>}
                    </td>
                    <td className="px-3">
                      {l.serials.length > 0 ? (
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {l.serials.map((s) => (
                            <span key={s} className="inline-flex items-center gap-1 rounded bg-[var(--erp-row-hover)] px-1.5 py-0.5 text-xs font-medium text-[var(--erp-blue-dark)]">
                              {s}
                              <button type="button" aria-label={`Remove ${s}`} className="text-slate-500 hover:text-red-700" onClick={() => { const serials = l.serials.filter((x) => x !== s); if (serials.length) updateLine(l.key, { serials, quantity: String(serials.length) }); else setLines((ls) => ls.filter((x) => x.key !== l.key)); }}>×</button>
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 text-right tabular-nums text-slate-600">{l.product.inStock}</td>
                    <td className="px-2">
                      {l.product.tracksSerial ? <p className="text-center font-semibold tabular-nums">{l.serials.length}</p>
                        : <input aria-label={`Quantity for ${l.product.name}`} inputMode="numeric" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="w-full rounded border-0 px-2 py-1 text-right tabular-nums ring-1 ring-inset ring-[var(--erp-field-border)] focus:ring-2 focus:ring-[var(--erp-blue)]" />}
                    </td>
                    <td className="px-2 text-center text-slate-600">{l.product.unit}</td>
                    <td className="px-2">
                      <input aria-label={`Rate for ${l.product.name}`} inputMode="decimal" value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} className="w-full rounded border-0 px-2 py-1 text-right tabular-nums ring-1 ring-inset ring-[var(--erp-field-border)] focus:ring-2 focus:ring-[var(--erp-blue)]" />
                    </td>
                    <td className="px-2 text-center tabular-nums">{formatRate(l.product.gstRateBp)}</td>
                    <td className="px-2 text-right tabular-nums text-slate-600">{formatPaise(l.product.mrpPaise)}</td>
                    <td className="px-3 text-right font-semibold tabular-nums">{formatPaise(preview.lines[i]?.totalPaise ?? 0)}</td>
                    <td className="px-2 text-center">
                      <button type="button" aria-label={`Remove ${l.product.name}`} className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
          <Card><TextField label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Card>
          <Card>
            <dl className="divide-y divide-[var(--erp-panel-border)] text-sm">
              <Row label="Taxable amount" value={preview.taxablePaise} />
              {interstate ? <Row label="IGST amount" value={preview.igstPaise} /> : <><Row label="CGST amount" value={preview.cgstPaise} /><Row label="SGST amount" value={preview.sgstPaise} /></>}
              <Row label="Round off" value={preview.roundOffPaise} />
              <div className="flex justify-between bg-[var(--erp-row-hover)] px-2 py-2 text-base font-bold text-[var(--erp-blue-dark)]"><dt>Net amount</dt><dd className="tabular-nums">₹{formatPaise(preview.totalPaise)}</dd></div>
            </dl>
            <Button type="submit" className="mt-4 w-full" loading={saving}>Save invoice</Button>
          </Card>
        </div>
      </form>
    </div>
  );
}

function SerialPicker({ product, exclude, onPick, onClose }: { product: Product; exclude: string[]; onPick: (s: string) => void; onClose: () => void }) {
  const { data, loading } = useFetch<{ items: string[] }>(`/products/${product.id}/units`);
  const available = (data?.items ?? []).filter((s) => !exclude.includes(s));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">In stock: {product.brand} {product.name}</p>
        <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={onClose}>Close</button>
      </div>
      {loading && !data ? <Spinner className="h-5 w-5" /> : available.length === 0 ? <p className="text-sm text-slate-500">No units in stock.</p> : (
        <div className="flex flex-wrap gap-2">
          {available.map((s) => <button key={s} type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs hover:border-slate-900" onClick={() => onPick(s)}>{s}</button>)}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between px-2 py-1.5"><dt className="font-semibold text-slate-700">{label}</dt><dd className="tabular-nums text-slate-900">₹{formatPaise(value)}</dd></div>;
}
