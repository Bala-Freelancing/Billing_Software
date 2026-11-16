import { useState, type FormEvent, type ReactNode } from "react";
import type { ProductGroup, UnitRow } from "../../../shared/catalog";
import type { LedgerGroupRow } from "../../../shared/ledgers";
import { Alert, Badge, Button, Card, CheckboxField, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

const NATURE_LABEL = { asset: "Assets", liability: "Liabilities", income: "Income", expense: "Expenses" } as const;

/** Small inline form shell shared by the three masters. */
function MasterForm({ title, onSubmit, onClose, children }: { title: string; onSubmit: () => Promise<void>; onClose: () => void; children: (errors: Record<string, string[]>) => ReactNode }) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(err.message);
      } else setError("Could not save.");
    }
  }
  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="space-y-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 md:grid-cols-3">{children(errors)}</div>
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </form>
    </Card>
  );
}

function Table({ head, children, loading }: { head: string[]; children: ReactNode; loading: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>{head.map((h, i) => <th key={i} className="px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? <tr><td colSpan={head.length} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr> : children}
        </tbody>
      </table>
    </div>
  );
}
const EditLink = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={onClick}>Edit</button>
);

// ── Product groups ──────────────────────────────────────────────────────────

function ProductGroupForm({ editing, onDone }: { editing: ProductGroup | null; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  return (
    <MasterForm
      title={editing ? `Edit ${editing.name}` : "New product group"}
      onClose={onDone}
      onSubmit={async () => {
        if (editing) await api(`/product-groups/${editing.id}`, { method: "PUT", body: { name, isActive, updatedAt: editing.updatedAt } });
        else await api("/product-groups", { method: "POST", body: { name, isActive } });
        onDone();
      }}
    >
      {(errors) => (
        <>
          <TextField label="Name" placeholder="Fans, Switches, Wires…" value={name} onChange={(e) => setName(e.target.value)} errors={errors.name} hint={editing?.productCount ? `Renaming updates ${editing.productCount} product(s)` : undefined} />
          <div className="pt-6"><CheckboxField label="Active" checked={isActive} onChange={setIsActive} /></div>
        </>
      )}
    </MasterForm>
  );
}

export function ProductGroupsPage() {
  const [form, setForm] = useState<{ editing: ProductGroup | null } | null>(null);
  const { data, error, loading, reload } = useFetch<{ items: ProductGroup[] }>("/product-groups");
  return (
    <div className="space-y-6">
      <PageHeader title="Product Groups" subtitle="Group products for reports and search: Fans, Switches, Lighting…" actions={!form && <Button onClick={() => setForm({ editing: null })}>New group</Button>} />
      {form && <ProductGroupForm key={form.editing?.id ?? "new"} editing={form.editing} onDone={() => { setForm(null); reload(); }} />}
      {error && <Alert tone="error">{error}</Alert>}
      <Table head={["Group", "Products", ""]} loading={loading && !data}>
        {data?.items.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">No groups yet.</td></tr>}
        {data?.items.map((g) => (
          <tr key={g.id}>
            <td className="px-4 py-3 font-medium">{g.name} {!g.isActive && <Badge tone="red">Inactive</Badge>}</td>
            <td className="px-4 py-3 tabular-nums">{g.productCount}</td>
            <td className="px-4 py-3 text-right"><EditLink onClick={() => setForm({ editing: g })} /></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Units ───────────────────────────────────────────────────────────────────

function UnitForm({ editing, onDone }: { editing: UnitRow | null; onDone: () => void }) {
  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  return (
    <MasterForm
      title={editing ? `Edit ${editing.code}` : "New unit"}
      onClose={onDone}
      onSubmit={async () => {
        if (editing) await api(`/units/${editing.code}`, { method: "PUT", body: { name, isActive, updatedAt: editing.updatedAt } });
        else await api("/units", { method: "POST", body: { code, name, isActive } });
        onDone();
      }}
    >
      {(errors) => (
        <>
          <TextField label="Code" placeholder="ROLL" value={code} disabled={!!editing} onChange={(e) => setCode(e.target.value.toUpperCase())} errors={errors.code} hint={editing ? "Printed on invoices; can't change" : "Up to 8 letters/digits, shown on invoices"} />
          <TextField label="Name" placeholder="Rolls" value={name} onChange={(e) => setName(e.target.value)} errors={errors.name} />
          <div className="pt-6"><CheckboxField label="Active" checked={isActive} onChange={setIsActive} /></div>
        </>
      )}
    </MasterForm>
  );
}

export function UnitsPage() {
  const [form, setForm] = useState<{ editing: UnitRow | null } | null>(null);
  const { data, error, loading, reload } = useFetch<{ items: UnitRow[] }>("/units");
  return (
    <div className="space-y-6">
      <PageHeader title="Product Units" subtitle="Units of measure used on products and invoices." actions={!form && <Button onClick={() => setForm({ editing: null })}>New unit</Button>} />
      {form && <UnitForm key={form.editing?.code ?? "new"} editing={form.editing} onDone={() => { setForm(null); reload(); }} />}
      {error && <Alert tone="error">{error}</Alert>}
      <Table head={["Code", "Name", "Products", ""]} loading={loading && !data}>
        {data?.items.map((u) => (
          <tr key={u.code}>
            <td className="px-4 py-3 font-mono font-medium">{u.code}</td>
            <td className="px-4 py-3">{u.name} {u.isSystem && <Badge>Built-in</Badge>} {!u.isActive && <Badge tone="red">Inactive</Badge>}</td>
            <td className="px-4 py-3 tabular-nums">{u.productCount}</td>
            <td className="px-4 py-3 text-right"><EditLink onClick={() => setForm({ editing: u })} /></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Ledger groups ───────────────────────────────────────────────────────────

function LedgerGroupForm({ editing, parents, onDone }: { editing: LedgerGroupRow | null; parents: LedgerGroupRow[]; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [parentId, setParentId] = useState(editing?.parentId ?? parents.find((p) => p.systemKey === "indirect_expenses")?.id ?? parents[0]?.id ?? 0);
  return (
    <MasterForm
      title={editing ? `Edit ${editing.name}` : "New ledger group"}
      onClose={onDone}
      onSubmit={async () => {
        if (editing) await api(`/ledger-groups/${editing.id}`, { method: "PUT", body: { name, updatedAt: editing.updatedAt } });
        else await api("/ledger-groups", { method: "POST", body: { name, parentId } });
        onDone();
      }}
    >
      {(errors) => (
        <>
          <TextField label="Name" placeholder="Vehicle Expenses" value={name} onChange={(e) => setName(e.target.value)} errors={errors.name} />
          <SelectField label="Under" value={parentId} disabled={!!editing} onChange={(e) => setParentId(Number(e.target.value))} errors={errors.parentId} hint="Decides where it shows in P&L / Balance Sheet">
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name} ({NATURE_LABEL[p.nature]})</option>)}
          </SelectField>
        </>
      )}
    </MasterForm>
  );
}

export function LedgerGroupsPage() {
  const [form, setForm] = useState<{ editing: LedgerGroupRow | null } | null>(null);
  const { data, error, loading, reload } = useFetch<{ items: LedgerGroupRow[] }>("/ledger-groups");
  const parents = data?.items.filter((g) => g.isSystem && g.allowsLedgers) ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Ledger Groups" subtitle="Built-in groups decide the P&L and Balance Sheet; add your own sub-groups under them." actions={!form && data && <Button onClick={() => setForm({ editing: null })}>New sub-group</Button>} />
      {form && <LedgerGroupForm key={form.editing?.id ?? "new"} editing={form.editing} parents={parents} onDone={() => { setForm(null); reload(); }} />}
      {error && <Alert tone="error">{error}</Alert>}
      <Table head={["Group", "Type", "Ledgers", ""]} loading={loading && !data}>
        {data?.items.map((g) => (
          <tr key={g.id}>
            <td className={`px-4 py-3 ${g.parentId ? "pl-10" : "font-medium"}`}>{g.parentId ? `↳ ${g.name}` : g.name}</td>
            <td className="px-4 py-3">{NATURE_LABEL[g.nature]}</td>
            <td className="px-4 py-3 tabular-nums">{g.ledgerCount}</td>
            <td className="px-4 py-3 text-right">{g.isSystem ? <Badge>Built-in</Badge> : <EditLink onClick={() => setForm({ editing: g })} />}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
