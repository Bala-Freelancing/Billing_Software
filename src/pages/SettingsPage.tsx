import { useState, type FormEvent } from "react";
import { gstinProblem, isStateCode, STATES } from "../../shared/india";
import type { GstSlab, ShopSettings } from "../../shared/masters";
import { formatRate } from "../../shared/money";
import { Alert, Badge, Button, Card, PageHeader, SelectField, Spinner, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/useFetch";

type Errors = Partial<Record<string, string[]>>;

function ShopSettingsSection() {
  const { data, error, loading } = useFetch<ShopSettings>("/settings/shop");
  if (error) return <Alert tone="error">{error}</Alert>;
  if (loading || !data) return <Spinner className="mx-auto h-6 w-6" />;
  return <ShopSettingsForm initial={data} />;
}

function ShopSettingsForm({ initial }: { initial: ShopSettings }) {
  const [form, setForm] = useState<ShopSettings>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const gstin = (form.gstin ?? "").trim().toUpperCase();
    if (gstin) {
      const problem = gstinProblem(gstin);
      if (problem) return setErrors({ gstin: [problem] });
    }
    setErrors({});
    setSaving(true);
    try {
      const updated = await api<ShopSettings>("/settings/shop", { method: "PUT", body: { ...form, gstin } });
      setForm(updated);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      {saved && <Alert tone="success">Shop details saved.</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label="Shop name" value={form.shopName} onChange={(e) => set("shopName", e.target.value)} errors={errors.shopName} />
        <TextField
          label="GSTIN"
          className="font-mono"
          maxLength={15}
          value={form.gstin ?? ""}
          onChange={(e) => {
            const value = e.target.value.toUpperCase().replace(/\s/g, "");
            set("gstin", value);
            if (value.length >= 2 && isStateCode(value.slice(0, 2))) set("stateCode", value.slice(0, 2));
          }}
          errors={errors.gstin}
        />
        <SelectField label="State" value={form.stateCode} onChange={(e) => set("stateCode", e.target.value)} errors={errors.stateCode}>
          {STATES.map((s) => (
            <option key={s.code} value={s.code}>{s.code} – {s.name}</option>
          ))}
        </SelectField>
        <TextField className="sm:col-span-2" label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} errors={errors.address} />
        <TextField label="City" value={form.city} onChange={(e) => set("city", e.target.value)} errors={errors.city} />
        <TextField label="Pincode" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} errors={errors.pincode} />
        <TextField label="Phone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} errors={errors.phone} />
        <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} errors={errors.email} />
      </div>
      <h3 className="pt-2 text-sm font-semibold text-slate-900">Invoice</h3>
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField
          label="Invoice number prefix"
          className="font-mono"
          maxLength={6}
          value={form.invoicePrefix}
          onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
          errors={errors.invoicePrefix}
          hint={`Next invoices look like 2627/${form.invoicePrefix || "SV"}/0001`}
        />
        <div className="sm:col-span-2">
          <p className="block text-sm font-medium text-slate-700">Logo (printed on invoices)</p>
          <div className="mt-1 flex items-center gap-3">
            {form.logoDataUrl ? <img src={form.logoDataUrl} alt="Shop logo" className="h-14 w-14 rounded border border-slate-200 object-contain" /> : <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">None</div>}
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Choose image
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setErrors((x) => ({ ...x, logoDataUrl: ["Use a PNG, JPEG or WebP image"] }));
                if (file.size > 80 * 1024) return setErrors((x) => ({ ...x, logoDataUrl: ["Image must be under 80 KB — resize it first"] }));
                const reader = new FileReader();
                reader.onload = () => set("logoDataUrl", String(reader.result));
                reader.readAsDataURL(file);
              }} />
            </label>
            {form.logoDataUrl && <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => set("logoDataUrl", null)}>Remove</button>}
          </div>
          {errors.logoDataUrl && <p className="mt-1.5 text-sm text-red-700">{errors.logoDataUrl[0]}</p>}
        </div>
      </div>
      <h3 className="pt-2 text-sm font-semibold text-slate-900">Bank details (printed on invoices)</h3>
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label="Bank name" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} errors={errors.bankName} />
        <TextField label="Account number" inputMode="numeric" value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} errors={errors.bankAccount} />
        <TextField label="IFSC" className="font-mono" maxLength={11} value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} errors={errors.bankIfsc} />
      </div>
      <Button type="submit" loading={saving}>Save shop details</Button>
    </form>
  );
}

function GstSlabsManager() {
  const { data, error, reload } = useFetch<{ items: GstSlab[] }>("/gst-slabs");
  const [rate, setRate] = useState("");
  const [rateError, setRateError] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function addRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = Number(rate);
    if (rate.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100 || !/^\d+(\.\d{1,2})?$/.test(rate.trim())) {
      setRateError(["Enter a rate like 18 or 0.25"]);
      return;
    }
    setRateError(undefined);
    setBusy(true);
    try {
      await api("/gst-slabs", { method: "POST", body: { ratePercent: value } });
      setRate("");
      reload();
    } catch (err) {
      setRateError([err instanceof ApiError ? err.message : "Could not add the rate."]);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(slab: GstSlab) {
    setActionError(null);
    try {
      await api(`/gst-slabs/${slab.id}`, { method: "PATCH", body: { isActive: !slab.isActive } });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update the rate.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        A rate can be retired but never edited, so old bills always keep the rate they were made with.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {data?.items.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="w-14 font-semibold tabular-nums text-slate-900">{formatRate(s.rateBp)}</span>
              {s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Retired</Badge>}
              <span className="text-xs text-slate-500">{s.productCount} product{s.productCount === 1 ? "" : "s"}</span>
            </div>
            <Button variant="secondary" onClick={() => toggle(s)}>{s.isActive ? "Retire" : "Restore"}</Button>
          </li>
        ))}
      </ul>
      <form onSubmit={addRate} noValidate className="flex items-start gap-3">
        <TextField label="" aria-label="New GST rate percent" placeholder="New rate %, e.g. 3" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} errors={rateError} className="w-48" />
        <Button type="submit" variant="secondary" loading={busy} className="mt-1">Add rate</Button>
      </form>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Shop Profile" subtitle="Shop details appear on every invoice." />
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Shop details</h2>
        <ShopSettingsSection />
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">GST rates</h2>
        <GstSlabsManager />
      </Card>
    </div>
  );
}
