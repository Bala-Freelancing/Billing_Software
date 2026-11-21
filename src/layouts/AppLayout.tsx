import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/useAuth";
import { groupFor, NAV } from "../lib/nav";

const ICONS: Record<string, React.ReactNode> = {
  Dashboard: <path d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
  Sales: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  Purchase: <path d="M3 4h2l2 11h11l2-8H7M9 20h.01M17 20h.01" />,
  Credit: <path d="M4 7h16v12H4zM4 11h16M8 15h3" />,
  Reports: <path d="M5 20V10M12 20V4M19 20v-7" />,
  Master: <path d="M4 6h16M4 12h16M4 18h10" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** One menu on the top bar: opens on click (and hover on desktop), closes on outside click or Escape. */
function Menu({ title, open, onOpen, onClose }: { title: string; open: boolean; onOpen: () => void; onClose: () => void }) {
  const group = NAV.find((g) => g.title === title)!;
  const { pathname } = useLocation();
  const active = groupFor(pathname)?.title === title;
  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`erp-topnav-item ${active ? "erp-topnav-item-active" : ""}`}
      >
        <Icon name={title} />
        {title}
        <svg viewBox="0 0 20 20" className="h-3 w-3 opacity-80" fill="currentColor" aria-hidden="true"><path d="M5 7l5 6 5-6z" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-40 min-w-56 overflow-hidden rounded-b-md bg-white py-1 shadow-lg ring-1 ring-black/10">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              
              role="menuitem"
              onClick={onClose}
              className={({ isActive }) => `block px-4 py-2 text-sm ${isActive ? "bg-[var(--erp-blue)] font-medium text-white" : "text-slate-700 hover:bg-[var(--erp-row-hover)] hover:text-[var(--erp-blue-dark)]"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const user = state.status === "authenticated" ? state.user : null;

  // Close menus on navigation, outside click and Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  return (
    <div className="min-h-screen bg-[var(--erp-page)]">
      <header ref={barRef} className="erp-topbar sticky top-0 z-30 print:hidden">
        <div className="flex h-11 items-center justify-between gap-2 px-2 sm:px-4">
          <div className="flex items-center">
            <button
              type="button"
              className="erp-topnav-item lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {mobileOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
              Menu
            </button>
            <nav className="hidden items-center lg:flex" aria-label="Main">
              <NavLink to="/" end className={({ isActive }) => `erp-topnav-item ${isActive ? "erp-topnav-item-active" : ""}`}>
                <Icon name="Dashboard" />
                Dashboard
              </NavLink>
              {NAV.map((g) => (
                <Menu key={g.title} title={g.title} open={openMenu === g.title} onOpen={() => setOpenMenu(g.title)} onClose={() => setOpenMenu((m) => (m === g.title ? null : m))} />
              ))}
              <NavLink to="/account" className={({ isActive }) => `erp-topnav-item ${isActive ? "erp-topnav-item-active" : ""}`}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
                {user?.displayName ?? "Account"}
              </NavLink>
              <button type="button" onClick={handleLogout} disabled={signingOut} className="erp-topnav-item">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </nav>
          </div>
          <NavLink to="/" className="truncate text-sm font-bold uppercase tracking-wide text-white sm:text-base">
            Sri Vishnu Communication
          </NavLink>
        </div>

        {mobileOpen && (
          <div className="max-h-[calc(100vh-2.75rem)] overflow-y-auto bg-white pb-4 shadow-lg lg:hidden" onClick={(e) => (e.target as HTMLElement).closest("a") && setMobileOpen(false)}>
            <NavLink to="/" end className="block px-4 py-2.5 text-sm font-semibold text-slate-800">Dashboard</NavLink>
            {NAV.map((g) => (
              <div key={g.title}>
                <p className="bg-[var(--erp-blue)] px-4 py-1.5 text-xs font-bold uppercase text-white">{g.title}</p>
                {g.items.map((item) => (
                  <NavLink key={item.to} to={item.to}  className={({ isActive }) => `block px-6 py-2 text-sm ${isActive ? "font-semibold text-[var(--erp-blue)]" : "text-slate-700"}`}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
            <NavLink to="/account" className="block px-4 py-2.5 text-sm text-slate-700">Account</NavLink>
            <button type="button" onClick={handleLogout} className="block px-4 py-2.5 text-sm font-semibold text-red-700">Sign out</button>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
