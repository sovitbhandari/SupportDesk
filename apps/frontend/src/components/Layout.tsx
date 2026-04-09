import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const navItems = [
  { label: "Views", to: "/views" },
  { label: "Tickets", to: "/tickets" },
  { label: "Customers", to: "/customers" },
  { label: "Settings", to: "/settings/profile" }
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">SupportDesk</div>
        <nav className="side-nav">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={location.pathname.startsWith(item.to) ? "side-link active" : "side-link"}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="workspace-topbar">
          <div>
            <h1>{user?.role.toUpperCase()} Workspace</h1>
            <p className="muted">Ticketing and conversation workflow</p>
          </div>
          <div className="topbar-actions">
            <span className="muted">{user?.email}</span>
            <button onClick={logout}>Logout</button>
          </div>
        </header>

        <main className="workspace-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
