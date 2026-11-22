import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { NAV } from "../lib/nav";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ALL_PATHS = NAV.flatMap((g) => g.items.map((i) => i.to));

const link = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium ${isActive ? "bg-[#26344D] text-white" : "text-[#C6CFDC] hover:bg-white/5 hover:text-white"}`;

/** The dark side menu; the same markup serves the desktop column and the phone drawer. */
function SideMenu({ onSignOut, signingOut, name }: { onSignOut: () => void; signingOut: boolean; name: string }) {
  return (
    <div className="flex h-full flex-col gap-5 px-4 py-6">
      <Link to="/" className="flex items-center gap-3 px-1 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--erp-blue)] text-sm font-bold">SV</span>
        <span className="text-sm font-semibold leading-tight">
          Sri Vishnu
          <br />
          Communication
        </span>
      </Link>

      <Link to="/sales/new" className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--erp-blue)] text-sm font-semibold text-white hover:bg-[var(--erp-blue-dark)]">
        <Icon d="M12 5v14M5 12h14" />
        New sale
      </Link>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-4 overflow-y-auto">
        <NavLink to="/" end className={link}>
          <Icon d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
          Dashboard
        </NavLink>
        {NAV.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <p className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold text-[#8A96A8]">
              <Icon d={g.icon} />
              {g.title}
            </p>
            {g.items.map((item) => (
              // `end` where a longer menu path sits under this one (/purchases vs /purchases/new), so only one item lights up.
              <NavLink key={item.to} to={item.to} end={ALL_PATHS.some((p) => p.startsWith(`${item.to}/`))} className={link}>
                <span className="pl-[30px]">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-4">
        <NavLink to="/account" className="truncate px-1 text-sm font-medium text-[#C6CFDC] hover:text-white">
          {name}
        </NavLink>
        <button type="button" onClick={onSignOut} disabled={signingOut} className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-[#C6CFDC] hover:bg-white/5 hover:text-white">
          <Icon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const name = state.status === "authenticated" ? state.user.displayName : "Account";

  // Close the phone drawer on Escape (and on any link tap, below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  const menu = <SideMenu onSignOut={handleLogout} signingOut={signingOut} name={name} />;

  return (
    <div className="min-h-screen bg-[var(--erp-page)] lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 bg-[#0E1726] lg:block print:hidden">{menu}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-[#0E1726] px-3 text-white lg:hidden print:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/10">
          <Icon d="M4 7h16M4 12h16M4 17h16" />
        </button>
        <Link to="/" className="truncate text-sm font-semibold">Sri Vishnu Communication</Link>
        <Link to="/sales/new" className="flex h-9 items-center rounded-lg bg-[var(--erp-blue)] px-3 text-sm font-semibold">New sale</Link>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-[#0E1726] shadow-xl" onClick={(e) => (e.target as HTMLElement).closest("a") && setDrawerOpen(false)}>{menu}</aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
