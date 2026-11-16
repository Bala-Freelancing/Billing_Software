import { Link } from "react-router";
import { useAuth } from "../auth/useAuth";

const modules = [
  { name: "Products", description: "Havells products, HSN codes, GST rates and prices", to: "/products" },
  { name: "Parties", description: "Retailers and suppliers with GSTIN and opening balances", to: "/parties" },
  { name: "Settings", description: "Shop details, bank details and GST rates", to: "/settings" },
  { name: "Purchase", description: "Purchase entry with serial-number scanning" },
  { name: "Sales", description: "Billing by barcode scan, with printable invoices" },
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
      <p className="mt-1 text-slate-600">Start by filling in your shop details, then add products and parties.</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {modules.map((m) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-slate-900">{m.name}</h2>
                {!m.to && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Coming soon</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">{m.description}</p>
            </>
          );
          return (
            <li key={m.name}>
              {m.to ? (
                <Link to={m.to} className="block h-full rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-blue-300">
                  {body}
                </Link>
              ) : (
                <div className="h-full rounded-xl bg-white/60 p-5 ring-1 ring-slate-200">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
