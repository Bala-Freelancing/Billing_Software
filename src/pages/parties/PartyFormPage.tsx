import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { gstinProblem, HOME_STATE_CODE, isStateCode, STATES } from "../../../shared/india";
import type { Party, PartyType } from "../../../shared/masters";
import { paiseToInput, parseRupees } from "../../../shared/money";
import { Alert, Button, Card, CheckboxField, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

interface FormState {
  name: string;
  partyType: PartyType;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  stateCode: string;
  pincode: string;
  openingAmount: string;
  openingSide: "dr" | "cr";
  isActive: boolean;
}

const EMPTY: FormState = {
  name: "",
  partyType: "customer",
  phone: "",
  email: "",
  gstin: "",
  address: "",
  city: "",
  stateCode: HOME_STATE_CODE,
  pincode: "",
  openingAmount: "",
  openingSide: "dr",
  isActive: true,
};

type Errors = Partial<Record<string, string[]>>;

function toForm(p: Party): FormState {
  return {
    name: p.name,
    partyType: p.partyType,
    phone: p.phone,
    email: p.email,
    gstin: p.gstin ?? "",
    address: p.address,
    city: p.city,
    stateCode: p.stateCode,
    pincode: p.pincode,
    openingAmount: p.openingBalancePaise === 0 ? "" : paiseToInput(Math.abs(p.openingBalancePaise)),
    openingSide: p.openingBalancePaise < 0 ? "cr" : "dr",
    isActive: p.isActive,
  };
}

export function PartyFormPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const existing = useFetch<Party>(isNew ? null : `/parties/${id}`);
  if (existing.error) return <Alert tone="error">{existing.error}</Alert>;
  if (!isNew && (existing.loading || !existing.data)) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  return <PartyForm key={id ?? "new"} party={isNew ? null : existing.data} />;
}

function PartyForm({ party }: { party: Party | null }) {
  const isNew = party === null;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => (party ? toForm(party) : EMPTY));
  const [updatedAt, setUpdatedAt] = useState(party?.updatedAt ?? 0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
    // An edited field's old error no longer applies.
    const errorKey = key === "openingAmount" || key === "openingSide" ? "openingBalancePaise" : key;
    setErrors((e) => (e[errorKey] ? { ...e, [errorKey]: undefined } : e));
  };

  // Typing a valid GSTIN fills in the state automatically.
  function setGstin(raw: string) {
    const value = raw.toUpperCase().replace(/\s/g, "");
    setForm((f) => {
      const prefix = value.slice(0, 2);
      return { ...f, gstin: value, stateCode: value.length >= 2 && isStateCode(prefix) ? prefix : f.stateCode };
    });
    setSaved(false);
    setErrors((e) => ({ ...e, gstin: undefined, stateCode: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    setSaved(false);

    const next: Errors = {};
    const amount = form.openingAmount.trim() === "" ? 0 : parseRupees(form.openingAmount);
    if (amount === null) next.openingBalancePaise = ["Enter an amount in rupees, e.g. 25000"];
    if (form.gstin) {
      const problem = gstinProblem(form.gstin);
      if (problem) next.gstin = [problem];
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const body = {
      name: form.name,
      partyType: form.partyType,
      phone: form.phone,
      email: form.email,
      gstin: form.gstin,
      address: form.address,
      city: form.city,
      stateCode: form.stateCode,
      pincode: form.pincode,
      openingBalancePaise: form.openingSide === "cr" ? -(amount ?? 0) : (amount ?? 0),
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const result = isNew
        ? await api<Party>("/parties", { method: "POST", body })
        : await api<Party>(`/parties/${party.id}`, { method: "PUT", body: { ...body, updatedAt } });
      if (isNew) navigate(`/parties/${result.id}`, { replace: true });
      else {
        setUpdatedAt(result.updatedAt);
        setSaved(true);
      }
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
    <div className="max-w-3xl">
      <PageHeader
        title={isNew ? "Add party" : form.name || "Party"}
        subtitle={<Link to="/parties" className="text-blue-700 hover:underline">← All parties</Link>}
      />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError && <Alert tone="error">{formError}</Alert>}
        {saved && <Alert tone="success">Saved.</Alert>}

        <Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField className="sm:col-span-2" label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} errors={errors.name} required />
            <SelectField label="Type" value={form.partyType} onChange={(e) => set("partyType", e.target.value as PartyType)} errors={errors.partyType}>
              <option value="customer">Retailer / customer</option>
              <option value="supplier">Supplier</option>
              <option value="both">Both</option>
            </SelectField>
            <TextField label="GSTIN" value={form.gstin} onChange={(e) => setGstin(e.target.value)} errors={errors.gstin} maxLength={15} className="font-mono" hint="Leave empty if the party is not GST-registered" />
            <TextField label="Phone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} errors={errors.phone} />
            <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} errors={errors.email} />
          </div>
        </Card>

        <Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField className="sm:col-span-2" label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} errors={errors.address} />
            <TextField label="City" value={form.city} onChange={(e) => set("city", e.target.value)} errors={errors.city} />
            <TextField label="Pincode" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} errors={errors.pincode} />
            <SelectField
              label="State"
              value={form.stateCode}
              onChange={(e) => set("stateCode", e.target.value)}
              errors={errors.stateCode}
              hint={form.stateCode === HOME_STATE_CODE ? "Same state: CGST + SGST" : "Other state: IGST"}
            >
              {STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.code} – {s.name}</option>
              ))}
            </SelectField>
          </div>
        </Card>

        <Card className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Opening balance ₹" inputMode="decimal" value={form.openingAmount} onChange={(e) => set("openingAmount", e.target.value)} errors={errors.openingBalancePaise} hint="Amount outstanding before using this software" />
            <SelectField label="Balance type" value={form.openingSide} onChange={(e) => set("openingSide", e.target.value as "dr" | "cr")}>
              <option value="dr">They owe us (Dr)</option>
              <option value="cr">We owe them (Cr)</option>
            </SelectField>
          </div>
          <CheckboxField label="Active" description="Inactive parties are hidden from billing but stay on old bills and reports." checked={form.isActive} onChange={(v) => set("isActive", v)} />
        </Card>

        <div className="flex gap-3">
          <Button type="submit" loading={saving}>{isNew ? "Add party" : "Save changes"}</Button>
          <Link to="/parties"><Button type="button" variant="secondary">Cancel</Button></Link>
        </div>
      </form>
    </div>
  );
}
