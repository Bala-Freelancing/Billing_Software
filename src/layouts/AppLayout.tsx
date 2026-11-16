import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/ui";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

export function AppLayout() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const user = state.status === "authenticated" ? state.user : null;

  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2 font-bold text-slate-900">
              <img src="/favicon.svg" alt="" className="h-7 w-7" />
              <span className="hidden sm:inline">Sri Vishnu Communication</span>
            </NavLink>
            <nav className="flex flex-wrap items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>
                Home
              </NavLink>
              <NavLink to="/products" className={navLinkClass}>
                Products
              </NavLink>
              <NavLink to="/parties" className={navLinkClass}>
                Parties
              </NavLink>
              <NavLink to="/settings" className={navLinkClass}>
                Settings
              </NavLink>
              <NavLink to="/account" className={navLinkClass}>
                Account
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user && <span className="hidden text-sm text-slate-600 sm:inline">{user.displayName}</span>}
            <Button variant="secondary" onClick={handleLogout} loading={signingOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
