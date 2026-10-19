import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { API_MODE } from "../api/client";
import { previewInvitation } from "../api/auth";
import { ApiError } from "../api/errors";
import { useAuth } from "../auth/context";
import { isRole, type Role } from "../auth/roles";
import { PasswordField } from "../components/PasswordField";

export function SignupPage() {
  const { session, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [invitationToken, setInvitationToken] = useState(() => new URLSearchParams(location.search).get("invite") ?? "");
  const [role, setRole] = useState<Role | null>(invitationToken ? null : "Shipper");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(Boolean(invitationToken));
  const [error, setError] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!invitationToken) return;
    // Keep a bearer invitation out of subsequent referrers and browser history.
    navigate("/signup", { replace: true });
    let current = true;
    setChecking(true);
    setError(null);
    void previewInvitation(invitationToken).then((invitation) => {
      if (!isRole(invitation.role)) throw new Error("Invalid invitation role.");
      if (current) setRole(invitation.role);
    }).catch((cause) => {
      if (current) { setRole(null); setError(cause instanceof ApiError ? cause.message : "Your invitation could not be checked. Try again."); }
    }).finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [invitationToken, previewAttempt, navigate]);

  if (session) return <Navigate to="/overview" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || checking || !role || API_MODE === "mock") return;
    if (password !== confirmation) { setError("Passwords do not match. Enter the same password in both fields."); return; }
    if (Array.from(password).length < 12 || new TextEncoder().encode(password).length > 256 || !password.trim()) {
      setError("Use a password of at least 12 characters and no more than 256 UTF-8 bytes."); return;
    }
    setPending(true); setError(null);
    try {
      await signUp(username, password, invitationToken || undefined);
      navigate("/overview", { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "INVALID_INVITATION") setRole(null);
      setError(cause instanceof ApiError ? cause.message : "Your account could not be created. Try again.");
    } finally { setPending(false); }
  }

  return <main className="login-screen"><section className="login-card signup-card" aria-labelledby="signup-title">
    <Link className="brand" to="/login"><span className="brand-mark" aria-hidden="true">C</span><span>ChainRoute</span></Link>
    <h1 id="signup-title">Join the freight flow</h1>
    <p className="login-copy">Create your account to work with freight plans, shipments, and the people behind them.</p>
    <div className="signup-role" role="status"><strong>{checking ? "Checking invitation…" : role ? `${role} account` : "Invitation required"}</strong>
      <span>{invitationToken ? "Your administrator’s invitation determines your role." : "Shippers can sign up directly. Carriers, Auditors, and Administrators join through an administrator’s invitation."}</span></div>
    {API_MODE === "mock" && <p className="form-notice">This sample workspace does not create accounts. Use the connected workspace to sign up.</p>}
    {error && <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">{error}</p>}
    {invitationToken && !checking && !role && <div className="auth-recovery"><button className="secondary-button" type="button" onClick={() => setPreviewAttempt((value) => value + 1)}>Check invitation again</button><button type="button" className="text-link" onClick={() => { setInvitationToken(""); setRole("Shipper"); setError(null); }}>Create a Shipper account instead</button></div>}
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="signup-username">Username</label>
      <input id="signup-username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={64}
        pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,63}" aria-describedby="username-help" value={username} onChange={(event) => setUsername(event.target.value)} />
      <small id="username-help">3–64 characters: letters, numbers, dots, hyphens, or underscores. Start with a letter or number.</small>
      <label htmlFor="signup-password">Password</label>
      <PasswordField id="signup-password" value={password} onChange={setPassword} minLength={12} describedBy="password-help" />
      <small id="password-help">Use at least 12 characters. A memorable passphrase works well.</small>
      <label htmlFor="confirm-password">Confirm password</label>
      <PasswordField id="confirm-password" value={confirmation} onChange={setConfirmation} minLength={12} />
      <button className="primary-button" type="submit" disabled={pending || checking || !role || API_MODE === "mock"}>{pending ? "Creating account…" : "Create account"}</button>
    </form>
    <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
    <p className="login-footnote">Your account permissions follow your assigned role. Contract signing requires an administrator-configured wallet.</p>
  </section></main>;
}
