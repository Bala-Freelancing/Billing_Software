import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/ui";

interface NavItem {
  label: string;
  to?: string; // undefined = planned, shown as "Soon"
}

// Same grouping as the shop's previous billing software, so nothing has to be relearned.
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Transaction",
    items: [
      { label: "Sales" },
      { label: "Purchase" },
      { label: "Sales Return" },
      { label: "Purchase Return" },
      { label: "Receipt" },
      { label: "Payment" },
      { label: "Voucher" },
      { label: "Voucher Approval" },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Sales Report" },
      { label: "Purchase Report" },
      { label: "Receipt / Payment" },
      { label: "Ledger Report" },
      { label: "Product Report" },
      { label: "GST Slab PDF" },
    ],
  },
  {
    title: "Financial Report",
    items: [{ label: "Statement of Account" }, { label: "Trial Balance" }, { label: "Profit & Loss" }, { label: "Balance Sheet" }],
  },
  {
    title: "Master",
    items: [
      { label: "Parties (Ledger)", to: "/parties" },
      { label: "Products", to: "/products" },
      { label: "Ledger Group" },
      { label: "Product Group" },
      { label: "Settings & GST", to: "/settings" },
    ],
  },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center rounded-md px-3 py-1.5 ${isActive ? "bg-slate-900 font-medium text-white" : "text-slate-700 hover:bg-slate-100"}`;

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-6 text-sm" aria-label="Main">
      <NavLink to="/" end onClick={onNavigate} className={itemClass}>
        Dashboard
      </NavLink>
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.label}>
                {item.to ? (
                  <NavLink to={item.to} onClick={onNavigate} className={itemClass}>
                    {item.label}
                  </NavLink>
                ) : (
                  <span className="flex items-center justify-between rounded-md px-3 py-1.5 text-slate-400" aria-disabled="true">
                    {item.label}
                    <span className="rounded border border-slate-200 px-1.5 text-[10px] font-medium uppercase tracking-wide">Soon</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const user = state.status === "authenticated" ? state.user : null;

  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
            <NavLink to="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-slate-900">
              <img src="/favicon.svg" alt="" className="h-7 w-7" />
              <span className="hidden sm:inline">Sri Vishnu Communication</span>
            </NavLink>
          </div>
          <div className="flex items-center gap-2">
            <NavLink
              to="/account"
              className={({ isActive }) =>
                `hidden rounded-md px-3 py-2 text-sm sm:block ${isActive ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              {user?.displayName ?? "Account"}
            </NavLink>
            <Button variant="secondary" onClick={handleLogout} loading={signingOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-3 py-5 lg:block">
          <SideNav />
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 top-14 z-20 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/20" onClick={() => setMenuOpen(false)} />
            <aside className="relative h-full w-72 overflow-y-auto border-r border-slate-200 bg-white px-3 py-5 shadow-xl">
              <SideNav onNavigate={() => setMenuOpen(false)} />
              <NavLink to="/account" onClick={() => setMenuOpen(false)} className="mt-6 block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                Account
              </NavLink>
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-8 lg:px-10">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
