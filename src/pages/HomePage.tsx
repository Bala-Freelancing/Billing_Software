import { useAuth } from "../auth/useAuth";

// Placeholders for the modules planned next; each becomes a real link as it ships.
const upcomingModules = [
  { name: "Products & GST slabs", description: "Product list, HSN codes and GST rates" },
  { name: "Purchase", description: "Purchase entry that adds to stock" },
  { name: "Sales", description: "Billing with GST and printable invoices" },
  { name: "Credit", description: "Receipts, outstanding balances, days pending" },
  { name: "Reports", description: "Purchase and sales registers, GST-slab PDF" },
  { name: "Dashboard", description: "Overall sales statistics" },
];

export function HomePage() {
  const { state } = useAuth();
  const name = state.status === "authenticated" ? state.user.displayName : "";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome, {name}</h1>
      <p className="mt-1 text-slate-600">You're signed in. Billing modules will appear here as they're built.</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {upcomingModules.map((m) => (
          <li key={m.name} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold text-slate-900">{m.name}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{m.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
