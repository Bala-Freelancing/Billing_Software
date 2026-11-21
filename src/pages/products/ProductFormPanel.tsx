import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { ProductGroup, UnitRow } from "../../../shared/catalog";
import type { GstSlab, Product } from "../../../shared/masters";
import { formatPaise, formatRate, paiseToInput, parseRupees, splitInclusive } from "../../../shared/money";
import { Alert, Button, Card, CheckboxField, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

interface FormState {
  brand: string;
  name: string;
  category: string;
  hsnCode: string;
  gstSlabId: string;
  unit: string;
  mrp: string;
  sellingPrice: string;
  barcode: string;
  tracksSerial: boolean;
  isActive: boolean;
}

const EMPTY: FormState = {
  brand: "Havells",
  name: "",
  category: "",
  hsnCode: "",
  gstSlabId: "",
  unit: "PCS",
  mrp: "",
  sellingPrice: "",
  barcode: "",
  tracksSerial: true,
  isActive: true,
};

type Errors = Partial<Record<string, string[]>>;

function toForm(p: Product): FormState {
  return {
    brand: p.brand,
    name: p.name,
    category: p.category,
    hsnCode: p.hsnCode,
    gstSlabId: String(p.gstSlabId),
    unit: p.unit,
    mrp: paiseToInput(p.mrpPaise),
    sellingPrice: paiseToInput(p.sellingPricePaise),
    barcode: p.barcode ?? "",
    tracksSerial: p.tracksSerial,
    isActive: p.isActive,
  };
}

/** The add / edit product panel at the top of the Products page (/products/new, /products/:id). */
export function ProductFormPanel({ onSaved }: { onSaved: () => void }) {
  const { id } = useParams();
  const isNew = id === undefined;
  const [search] = useSearchParams();
  const slabs = useFetch<{ items: GstSlab[] }>("/gst-slabs");
  const existing = useFetch<Product>(isNew ? null : `/products/${id}`);
  const groups = useFetch<{ items: ProductGroup[] }>("/product-groups");
  const units = useFetch<{ items: UnitRow[] }>("/units");

  const error = slabs.error ?? existing.error ?? groups.error ?? units.error;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!slabs.data || slabs.loading || !groups.data || !units.data || (!isNew && (existing.loading || !existing.data))) {
    return <Spinner className="mx-auto my-10 h-6 w-6" />;
  }
  return (
    <ProductForm
      key={id ?? `new-${search.get("barcode") ?? ""}`}
      onSaved={onSaved}
      product={isNew ? null : existing.data}
      slabs={slabs.data.items}
      groups={groups.data.items}
      units={units.data.items}
      initialBarcode={search.get("barcode") ?? ""}
    />
  );
}

function ProductForm({
  product,
  slabs,
  groups,
  units,
  initialBarcode,
  onSaved,
}: {
  onSaved: () => void;
  product: Product | null;
  slabs: GstSlab[];
  groups: ProductGroup[];
  units: UnitRow[];
  initialBarcode: string;
}) {
  const isNew = product === null;
  const navigate = useNavigate();
  const blank = (): FormState => {
    const eighteen = slabs.find((s) => s.rateBp === 1800 && s.isActive);
    return { ...EMPTY, barcode: initialBarcode, gstSlabId: eighteen ? String(eighteen.id) : "" };
  };
  const [form, setForm] = useState<FormState>(() => (product ? toForm(product) : blank()));
  const [updatedAt, setUpdatedAt] = useState(product?.updatedAt ?? 0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(null);
    // An edited field's old error no longer applies.
    const errorKey = key === "mrp" ? "mrpPaise" : key === "sellingPrice" ? "sellingPricePaise" : key;
    setErrors((e) => (e[errorKey] ? { ...e, [errorKey]: undefined } : e));
  };

  const selectedSlab = slabs.find((s) => String(s.id) === form.gstSlabId);
  const sellingPaise = parseRupees(form.sellingPrice);
  const split = sellingPaise !== null && selectedSlab ? splitInclusive(sellingPaise, selectedSlab.rateBp) : null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    setSaved(null);

    const mrpPaise = parseRupees(form.mrp);
    const next: Errors = {};
    if (mrpPaise === null) next.mrpPaise = ["Enter MRP in rupees, e.g. 4500 or 4500.50"];
    if (sellingPaise === null) next.sellingPricePaise = ["Enter selling price in rupees"];
    if (!form.gstSlabId) next.gstSlabId = ["Choose a GST rate"];
    setErrors(next);
    if (Object.keys(next).length) return;

    const body = {
      brand: form.brand,
      name: form.name,
      category: form.category,
      hsnCode: form.hsnCode,
      gstSlabId: Number(form.gstSlabId),
      unit: form.unit,
      mrpPaise,
      sellingPricePaise: sellingPaise,
      barcode: form.barcode,
      tracksSerial: form.tracksSerial,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const result = isNew
        ? await api<Product>("/products", { method: "POST", body })
        : await api<Product>(`/products/${product.id}`, { method: "PUT", body: { ...body, updatedAt } });
      if (isNew) {
        // Ready for the next product, keeping brand and group for a run of similar items.
        setForm({ ...blank(), barcode: "", brand: form.brand, category: form.category });
        setSaved(`Added ${result.name}.`);
      } else {
        setUpdatedAt(result.updatedAt);
        setSaved("Saved.");
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">{isNew ? "Add new product" : `Edit: ${product.name}`}</h2>
          <span className="text-sm text-slate-500">Prices include GST{product ? ` · In stock: ${product.inStock} ${product.unit}` : ""}</span>
        </div>
        {formError && <Alert tone="error">{formError}</Alert>}
        {saved && <Alert tone="success">{saved}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            className="sm:col-span-2"
            label="Product name / model"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            errors={errors.name}
            required
          />
          <TextField label="Brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} errors={errors.brand} required />
          <SelectField label="Product group" value={form.category} onChange={(e) => set("category", e.target.value)} errors={errors.category}>
            <option value="">No group</option>
            {groups
              .filter((g) => g.isActive || g.name === form.category)
              .map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                  {g.isActive ? "" : " (inactive)"}
                </option>
              ))}
          </SelectField>
          <SelectField label="Unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} errors={errors.unit}>
            {units
              .filter((u) => u.isActive || u.code === form.unit)
              .map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} – {u.name}
                </option>
              ))}
          </SelectField>
          <TextField label="HSN code" inputMode="numeric" value={form.hsnCode} onChange={(e) => set("hsnCode", e.target.value)} errors={errors.hsnCode} hint="4, 6 or 8 digits" />
          <SelectField label="GST rate" value={form.gstSlabId} onChange={(e) => set("gstSlabId", e.target.value)} errors={errors.gstSlabId}>
            <option value="">Choose…</option>
            {slabs
              .filter((s) => s.isActive || String(s.id) === form.gstSlabId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {formatRate(s.rateBp)}
                  {s.isActive ? "" : " (retired)"}
                </option>
              ))}
          </SelectField>
          <TextField label="Barcode (optional)" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} errors={errors.barcode} hint="Model barcode on the box" />
          <TextField label="MRP ₹" inputMode="decimal" value={form.mrp} onChange={(e) => set("mrp", e.target.value)} errors={errors.mrpPaise} />
          <TextField
            label="Selling price ₹"
            inputMode="decimal"
            value={form.sellingPrice}
            onChange={(e) => set("sellingPrice", e.target.value)}
            errors={errors.sellingPricePaise}
            hint={split ? `Taxable ₹${formatPaise(split.taxablePaise)} + GST ₹${formatPaise(split.taxPaise)}` : undefined}
          />
          {product && product.averageCostPaise > 0 && (
            <div className="text-sm">
              <p className="font-medium text-slate-800">Avg. purchase cost</p>
              <p className="mt-2 tabular-nums">₹{formatPaise(product.averageCostPaise)} excl. GST</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <CheckboxField label="Track serial numbers" checked={form.tracksSerial} onChange={(v) => set("tracksSerial", v)} errors={errors.tracksSerial} />
            <CheckboxField label="Active" description="Inactive products are hidden from billing." checked={form.isActive} onChange={(v) => set("isActive", v)} />
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (isNew) {
                  setForm(blank());
                  setErrors({});
                  setSaved(null);
                } else navigate("/products");
              }}
            >
              {isNew ? "Clear" : "Cancel"}
            </Button>
            <Button type="submit" loading={saving}>
              {isNew ? "Save product" : "Save changes"}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
