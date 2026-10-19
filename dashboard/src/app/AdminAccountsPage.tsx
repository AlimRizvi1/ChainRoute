import { useEffect, useState, type FormEvent } from "react";
import { API_MODE } from "../api/client";
import { createInvitation, getAccounts, getInvitations, revokeInvitation, setAccountActive, type Account, type Invitation } from "../api/accounts";
import { useAuth } from "../auth/context";
import { ROLES, type Role } from "../auth/roles";
import { LoadingState } from "../components/StatePanel";

const descriptions: Record<Role, string> = {
  Shipper: "Submit freight orders, compare plans, and follow owned contracts.",
  Carrier: "Book assigned contracts and record shipment and delivery milestones.",
  Auditor: "Inspect permitted contract history and audit records without making changes.",
  Administrator: "Manage accounts and coordinate contract resolution and settlement.",
};

export function AdminAccountsPage() {
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [role, setRole] = useState<Role>("Carrier");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (API_MODE === "mock") { setLoading(false); return; }
    let current = true;
    void Promise.all([getAccounts(), getInvitations()]).then(([users, invites]) => {
      if (current) { setAccounts(users.items); setInvitations(invites.items); }
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Account details could not be loaded."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("invite"); setError(null); setLink(""); setCopied(false);
    try {
      const result = await createInvitation(role);
      setLink(`${window.location.origin}/signup?invite=${encodeURIComponent(result.invitationToken)}`);
      setRevision((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invitation could not be created."); }
    finally { setBusy(null); }
  }

  async function change(id: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(id); setError(null);
    try { await action(); setRevision((value) => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The account change could not be saved."); }
    finally { setBusy(null); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { setError("Copy is unavailable. Select the invitation link and copy it manually."); }
  }

  return <section className="accounts-page" aria-labelledby="accounts-title">
    <header className="overview-heading"><div><h1 id="accounts-title">People & access</h1><p className="overview-intro">Invite the right people into the yard. Each account works within its assigned role.</p></div></header>
    {API_MODE === "mock" && <p className="form-notice">Account changes are unavailable in this sample workspace.</p>}
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-link" onClick={() => { setError(null); setRevision((value) => value + 1); }}>Retry loading</button></p>}
    <section className="access-invite" aria-labelledby="invite-title">
      <div><h2 id="invite-title">Invite a teammate</h2><p>Links expire after 24 hours and can be used once. Share the link directly with the intended person.</p></div>
      <form onSubmit={(event) => void invite(event)}><label htmlFor="invite-role">Account role</label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>{ROLES.map((option) => <option key={option}>{option}</option>)}</select><p className="role-description">{descriptions[role]}</p><button className="primary-button" type="submit" disabled={Boolean(busy) || API_MODE === "mock"}>{busy === "invite" ? "Creating invitation…" : "Create invitation"}</button></form>
      {link && <div className="invitation-result" role="status"><label htmlFor="invitation-link">Invitation link · copy it before leaving this page</label><input id="invitation-link" readOnly value={link} onFocus={(event) => event.target.select()} /><button className="secondary-button" type="button" onClick={() => void copyLink()}>{copied ? "Copied" : "Copy invitation link"}</button></div>}
    </section>
    {loading ? <LoadingState label="Loading account access…" /> : <>
      <section className="access-directory" aria-labelledby="directory-title"><div className="panel-heading"><h2 id="directory-title">Accounts</h2><span>Latest {accounts.length} accounts</span></div>
        <p>Disabling an account blocks its next protected request and future sign-ins. Your own administrator account stays active.</p>
        {accounts.length ? <ul className="account-directory">{accounts.map((account) => <li key={account.id}><div><strong>{account.username}</strong><span>{account.role} · {account.active ? "Active" : "Disabled"} · {account.walletMapped ? "Wallet configured" : "Wallet not configured"}</span></div><button className="secondary-button" type="button" disabled={Boolean(busy) || account.id === session?.user.id} onClick={() => void change(account.id, () => setAccountActive(account.id, !account.active))}>{busy === account.id ? "Saving…" : `${account.active ? "Disable" : "Enable"} ${account.username}`}</button></li>)}</ul> : <p>No accounts to show.</p>}
      </section>
      <section className="access-directory" aria-labelledby="pending-title"><h2 id="pending-title">Pending invitations</h2>{invitations.length ? <ul className="account-directory">{invitations.map((invitation) => <li key={invitation.id}><div><strong>{invitation.role}</strong><span>Expires {new Date(invitation.expiresAt).toLocaleString()}</span></div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void change(invitation.id, () => revokeInvitation(invitation.id))}>Revoke invitation</button></li>)}</ul> : <p>No unused invitations. Create a link above when someone is ready to join.</p>}</section>
    </>}
  </section>;
}
