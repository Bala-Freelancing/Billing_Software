import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { gstinProblem, HOME_STATE_CODE, isStateCode, STATES } from "../../../shared/india";
import type { Party, PartyType } from "../../../shared/masters";
import { paiseToInput, parseRupees } from "../../../shared/money";
import { Alert, Button, Card, CheckboxField, SelectField, Spinner, TextField } from "../../components/ui";
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
  creditLimit: string;
  creditDays: string;
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
  creditLimit: "",
  creditDays: "",
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
    creditLimit: p.creditLimitPaise ? paiseToInput(p.creditLimitPaise) : "",
    creditDays: p.creditDays ? String(p.creditDays) : "",
    isActive: p.isActive,
  };
}

/** The add / edit party panel at the top of the Retailers & suppliers page (/parties/new, /parties/:id). */
export function PartyFormPanel({ onSaved }: { onSaved: () => void }) {
  const { id } = useParams();
  const isNew = id === undefined;
  const existing = useFetch<Party>(isNew ? null : `/parties/${id}`);
  if (existing.error) return <Alert tone="error">{existing.error}</Alert>;
  if (!isNew && (existing.loading || !existing.data)) return <Spinner className="mx-auto my-10 h-6 w-6" />;
  return <PartyForm key={id ?? "new"} party={isNew ? null : existing.data} onSaved={onSaved} />;
}

function PartyForm({ party, onSaved }: { party: Party | null; onSaved: () => void }) {
  const isNew = party === null;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => (party ? toForm(party) : EMPTY));
  const [updatedAt, setUpdatedAt] = useState(party?.updatedAt ?? 0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(null);
    // An edited field's old error no longer applies.
    const errorKey =
      key === "openingAmount" || key === "openingSide" ? "openingBalancePaise" : key === "creditLimit" ? "creditLimitPaise" : key;
    setErrors((e) => (e[errorKey] ? { ...e, [errorKey]: undefined } : e));
  };

  // Typing a valid GSTIN fills in the state automatically.
  function setGstin(raw: string) {
    const value = raw.toUpperCase().replace(/\s/g, "");
    setForm((f) => {
      const prefix = value.slice(0, 2);
      return { ...f, gstin: value, stateCode: value.length >= 2 && isStateCode(prefix) ? prefix : f.stateCode };
    });
    setSaved(null);
    setErrors((e) => ({ ...e, gstin: undefined, stateCode: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    setSaved(null);

    const next: Errors = {};
    const amount = form.openingAmount.trim() === "" ? 0 : parseRupees(form.openingAmount);
    if (amount === null) next.openingBalancePaise = ["Enter an amount in rupees, e.g. 25000"];
    const creditLimit = form.creditLimit.trim() === "" ? 0 : parseRupees(form.creditLimit);
    if (creditLimit === null) next.creditLimitPaise = ["Enter an amount in rupees, e.g. 100000"];
    const creditDays = form.creditDays.trim() === "" ? 0 : Number(form.creditDays);
    if (!Number.isInteger(creditDays) || creditDays < 0) next.creditDays = ["Enter whole days, e.g. 30"];
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
      creditLimitPaise: creditLimit ?? 0,
      creditDays,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const result = isNew
        ? await api<Party>("/parties", { method: "POST", body })
        : await api<Party>(`/parties/${party.id}`, { method: "PUT", body: { ...body, updatedAt } });
      if (isNew) {
        setForm({ ...EMPTY, partyType: form.partyType });
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
      } else setFormError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">{isNew ? "Add new party" : `Edit: ${party.name}`}</h2>
          <div role="radiogroup" aria-label="Party type" className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {(["customer", "supplier", "both"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.partyType === t}
                onClick={() => set("partyType", t)}
                className={`rounded-md px-3 py-1.5 ${form.partyType === t ? "bg-[var(--erp-blue)] font-semibold text-white" : "text-slate-600 hover:text-slate-900"}`}
              >
                {t === "customer" ? "Retailer / customer" : t === "supplier" ? "Supplier" : "Both"}
              </button>
            ))}
          </div>
        </div>
        {formError && <Alert tone="error">{formError}</Alert>}
        {saved && <Alert tone="success">{saved}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField className="sm:col-span-2" label="Party / shop name" value={form.name} onChange={(e) => set("name", e.target.value)} errors={errors.name} required />
          <TextField label="Mobile (WhatsApp)" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} errors={errors.phone} />
          <TextField label="GSTIN" value={form.gstin} onChange={(e) => setGstin(e.target.value)} errors={errors.gstin} maxLength={15} hint="Empty if not GST-registered" />
          <TextField className="sm:col-span-2" label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} errors={errors.address} />
          <TextField label="City / town" value={form.city} onChange={(e) => set("city", e.target.value)} errors={errors.city} />
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
          <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} errors={errors.email} />
          <TextField label="Credit limit ₹" inputMode="decimal" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} errors={errors.creditLimitPaise} hint="Empty = no limit" />
          <TextField label="Credit days" inputMode="numeric" value={form.creditDays} onChange={(e) => set("creditDays", e.target.value)} errors={errors.creditDays} hint="Before a bill is overdue" />
          <TextField label="Opening balance ₹" inputMode="decimal" value={form.openingAmount} onChange={(e) => set("openingAmount", e.target.value)} errors={errors.openingBalancePaise} hint="Outstanding before this software" />
          <SelectField label="Balance type" value={form.openingSide} onChange={(e) => set("openingSide", e.target.value as "dr" | "cr")}>
            <option value="dr">To collect (they owe us)</option>
            <option value="cr">To pay (we owe them)</option>
          </SelectField>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <CheckboxField label="Active" description="Inactive parties are hidden from billing." checked={form.isActive} onChange={(v) => set("isActive", v)} />
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (isNew) {
                  setForm(EMPTY);
                  setErrors({});
                  setSaved(null);
                } else navigate("/parties");
              }}
            >
              {isNew ? "Clear" : "Cancel"}
            </Button>
            <Button type="submit" loading={saving}>{isNew ? "Save party" : "Save changes"}</Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
