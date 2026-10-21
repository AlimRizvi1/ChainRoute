import { OrdersPage } from "./OrdersPage";
import { AiLabPage } from "./AiLabPage";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { API_MODE } from "../api/client";
import { ApiError } from "../api/errors";
import { useAuth } from "../auth/context";
import { canVisit, navigationForRole } from "../auth/roles";
import { LoadingState } from "../components/StatePanel";
import { RouteTransition } from "../components/RouteTransition";
import { BackendUnavailable, HealthBanner, useServiceHealth } from "../components/ServiceStatus";
import { OverviewPage } from "./OverviewPage";
import { OptimizationPage } from "./OptimizationPage";
import { ContractsPage } from "./ContractsPage";
import { SignupPage } from "./SignupPage";
import { AdminAccountsPage } from "./AdminAccountsPage";
import { PasswordField } from "../components/PasswordField";
import { useLiveContractAlerts } from "./useLiveContractAlerts";

const DEMO_USERS = [
  { username: "demo.shipper", role: "Shipper" },
  { username: "demo.carrier", role: "Carrier" },
  { username: "demo.administrator", role: "Administrator" },
  { username: "demo.auditor", role: "Auditor" },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<WorkspaceShell />}>
          <Route element={<RouteTransition />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="orders" element={<PermissionPage path="/orders" title="Freight orders"><OrdersPage /></PermissionPage>} />
          <Route path="ai-lab" element={<AiLabPage />} />
          <Route path="allocations" element={<PermissionPage path="/allocations" title="Allocations"><OptimizationPage /></PermissionPage>} />
          <Route path="contracts" element={<PermissionPage path="/contracts" title="Contracts"><ContractsPage /></PermissionPage>} />
          <Route path="contracts/:contractId" element={<PermissionPage path="/contracts" title="Contracts"><ContractsPage /></PermissionPage>} />
          <Route path="audit" element={<PermissionPage path="/audit" title="Audit trail"><Navigate to="/contracts" replace /></PermissionPage>} />
          <Route path="admin" element={<PermissionPage path="/admin" title="Administration"><AdminAccountsPage /></PermissionPage>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

function RequireAuth() {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) {
    return <Navigate
      to="/login"
      replace
      state={{ from: location.pathname, ...(location.pathname !== "/" ? { message: "Sign in to continue." } : {}) }}
    />;
  }
  return <Outlet />;
}

function WorkspaceShell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const { health, unavailable, checking, refresh } = useServiceHealth();
  const { connection, alert, dismissAlert } = useLiveContractAlerts(session!);
  if (!session) return <LoadingState label="Returning to sign in…" />;
  const navigation = navigationForRole(session.user.role);
  return (
    <div className="workspace-shell">
      <aside className="workspace-rail" aria-label="Primary navigation">
        <Link className="brand" to="/overview"><span className="brand-mark" aria-hidden="true">C</span><span>ChainRoute</span></Link>
        <p className="nav-label">WORKSPACE</p>
        <nav className="workspace-nav">
          {navigation.map((item) => (
            <NavLink key={item.href} end={item.href === "/overview"} to={item.href}>
              <NavIcon path={item.href} />{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-account">
          <span className="account-mark" aria-hidden="true">{session.user.username.slice(0, 1).toUpperCase()}</span>
          <span><strong>{session.user.username}</strong><small>{session.user.role}</small></span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <span>Freight allocation and settlement</span>
          {API_MODE === "mock" && <span className="sample-data-label">SAMPLE DATA</span>}
          <span className={`push-status push-${connection}`} role="status"><i aria-hidden="true" />{connection === "connected" ? "Live alerts" : connection === "sample" ? "Sample alerts · 15s refresh" : connection === "offline" ? "Alerts offline" : connection === "reconnecting" ? "Reconnecting alerts" : "Connecting alerts"}</span>
          <button className="sign-out" onClick={() => { signOut(); navigate("/login", { replace: true }); }} type="button">Sign out</button>
        </header>
        {alert && <aside className="live-alert-toast" role="status" aria-live="polite" aria-label="New contract alert"><span className="live-alert-mark" aria-hidden="true">!</span><div><strong>{alert.title}</strong><p>{alert.message}</p></div><Link to={`/contracts/${encodeURIComponent(alert.contractId)}`}>Review</Link><button type="button" aria-label="Dismiss alert" onClick={dismissAlert}>×</button></aside>}
        <main className="workspace-content">
          {unavailable ? (
            <BackendUnavailable retry={() => void refresh()} checking={checking} />
          ) : (
            <>
              {health && <HealthBanner health={health} />}
              <RouteTransition />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function LoginPage() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState(API_MODE === "mock" ? DEMO_USERS[0].username : "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = (location.state as { message?: string } | null)?.message;

  if (session) return <Navigate to="/overview" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const next = await signIn(username, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && canVisit(next.user.role, from) ? from : "/overview", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign in right now. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <Link className="brand" to="/login"><span className="brand-mark" aria-hidden="true">C</span><span>ChainRoute</span></Link>
        <h1>Welcome back</h1>
        <p className="login-copy">Sign in to see the freight activity and actions for your role.</p>
        {API_MODE === "mock" && <p className="sample-data-label">Mock mode · Synthetic sample data</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <form onSubmit={submit}>
          <label htmlFor="username">Username</label>
          {API_MODE === "mock" ? (
            <select id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)}>
              {DEMO_USERS.map((user) => <option key={user.username} value={user.username}>{user.role} · {user.username}</option>)}
            </select>
          ) : (
            <input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={128} value={username} onChange={(event) => setUsername(event.target.value)} />
          )}
          <label htmlFor="password">Password</label>
          <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" />
          {API_MODE === "mock" && <small>Enter any non-empty password for this local mock session.</small>}
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="auth-switch">New to ChainRoute? <Link to="/signup">Create an account</Link></p>
        <p className="login-footnote">Your session stays in this browser tab and expires with its access token.</p>
      </section>
    </main>
  );
}

function PermissionPage({ path, title, children }: { path: string; title: string; children?: ReactNode }) {
  const { session } = useAuth();
  if (!session || !canVisit(session.user.role, path)) return <Navigate to="/overview" replace />;
  return children ?? <FoundationPage title={title} description={`The ${session.user.role} workspace is ready for the ${title.toLowerCase()} workflow.`} />;
}

function FoundationPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="foundation-page">
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="foundation-note"><strong>Screen foundation</strong><span>Shared navigation, role access, and session handling are ready for this workflow.</span></div>
    </section>
  );
}

function NavIcon({ path }: { path: string }) {
  const shared = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  const paths: Record<string, ReactNode> = {
    "/overview": <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>,
    "/orders": <><path d="M7 5h13M7 12h13M7 19h13" /><path d="M3.5 5h.01M3.5 12h.01M3.5 19h.01" /></>,
    "/allocations": <><path d="M4 18h5l3-12h8" /><path d="m16 3 4 3-4 3" /><circle cx="5" cy="18" r="1.5" /></>,
    "/contracts": <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
    "/audit": <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    "/admin": <><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="m19 13.5 2 .9-2 3.5-2-.9a8 8 0 0 1-2 1.2l-.4 2.2h-4l-.4-2.2a8 8 0 0 1-2-1.2l-2 .9-2-3.5 2-.9a8 8 0 0 1 0-2.4l-2-.9 2-3.5 2 .9a8 8 0 0 1 2-1.2L10.6 4h4l.4 2.2a8 8 0 0 1 2 1.2l2-.9 2 3.5-2 .9a8 8 0 0 1 0 2.6Z" /></>,
  };
  return <svg className="nav-icon" aria-hidden="true" viewBox="0 0 24 24" {...shared}>{paths[path] ?? <circle cx="12" cy="12" r="8" />}</svg>;
}
