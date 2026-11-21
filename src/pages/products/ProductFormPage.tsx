import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ProductGroup, UnitRow } from "../../../shared/catalog";
import type { GstSlab, Product } from "../../../shared/masters";
import { formatPaise, formatRate, paiseToInput, parseRupees, splitInclusive } from "../../../shared/money";
import { Alert, Button, Card, CheckboxField, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
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

export function ProductFormPage() {
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
    return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  }
  return (
    <ProductForm
      key={id ?? "new"}
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
}: {
  product: Product | null;
  slabs: GstSlab[];
  groups: ProductGroup[];
  units: UnitRow[];
  initialBarcode: string;
}) {
  const isNew = product === null;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => {
    if (product) return toForm(product);
    const eighteen = slabs.find((s) => s.rateBp === 1800 && s.isActive);
    return { ...EMPTY, barcode: initialBarcode, gstSlabId: eighteen ? String(eighteen.id) : "" };
  });
  const [updatedAt, setUpdatedAt] = useState(product?.updatedAt ?? 0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
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
    setSaved(false);

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
        navigate(`/products/${result.id}`, { replace: true });
      } else {
        setUpdatedAt(result.updatedAt);
        setSaved(true);
      }
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
    <div className="max-w-3xl">
      <PageHeader
        title={isNew ? "Add product" : form.name || "Product"}
        subtitle={
          <Link to="/products" className="text-blue-700 hover:underline">
            ← All products
          </Link>
        }
      />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError && <Alert tone="error">{formError}</Alert>}
        {saved && <Alert tone="success">Saved.</Alert>}

        <Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} errors={errors.brand} required />
{groups.length > 0 && (
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
            )}
            <TextField
              className="sm:col-span-2"
              label="Product name / model"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              errors={errors.name}
              required
            />
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
            <SelectField label="Unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} errors={errors.unit}>
              {units
                .filter((u) => u.isActive || u.code === form.unit)
                .map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} – {u.name}
                  </option>
                ))}
            </SelectField>
            <TextField label="Product barcode (optional)" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} errors={errors.barcode} hint="The model barcode on the box, if any" className="font-mono" />
          </div>
        </Card>

        <Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="MRP ₹ (incl. GST)" inputMode="decimal" value={form.mrp} onChange={(e) => set("mrp", e.target.value)} errors={errors.mrpPaise} />
            <TextField
              label="Selling price ₹ (incl. GST)"
              inputMode="decimal"
              value={form.sellingPrice}
              onChange={(e) => set("sellingPrice", e.target.value)}
              errors={errors.sellingPricePaise}
              hint={split ? `Taxable ₹${formatPaise(split.taxablePaise)} + GST ₹${formatPaise(split.taxPaise)}` : undefined}
            />
          </div>
        </Card>

        <Card className="space-y-4">
          <CheckboxField
            label="Track serial numbers"
            description="Each unit is recorded by its serial number at purchase and picked by scanning it at sale."
            checked={form.tracksSerial}
            onChange={(v) => set("tracksSerial", v)}
            errors={errors.tracksSerial}
          />
          <CheckboxField
            label="Active"
            description="Inactive products are hidden from billing but stay on old bills and reports."
            checked={form.isActive}
            onChange={(v) => set("isActive", v)}
          />
          {product && (
            <p className="text-sm text-slate-600">
              In stock: <span className="font-medium text-slate-900">{product.inStock}</span> {product.unit}
            </p>
          )}
        </Card>

        <div className="flex gap-3">
          <Button type="submit" loading={saving}>
            {isNew ? "Add product" : "Save changes"}
          </Button>
          <Link to="/products">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
