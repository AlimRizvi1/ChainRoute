import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/context";
import { writeSession } from "../auth/session";
import { getAccounts, getInvitations, createInvitation, revokeInvitation, setAccountActive } from "../api/accounts";
import { AdminAccountsPage } from "./AdminAccountsPage";
vi.mock("../api/accounts", () => ({ getAccounts: vi.fn(), getInvitations: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(), setAccountActive: vi.fn() }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
function mount() {
  writeSession({ token: "admin-token", expiresAt: Date.now() + 60_000, user: { id: "admin-1", username: "demo.administrator", role: "Administrator" } });
  vi.mocked(getAccounts).mockResolvedValue({ items: [
    { id: "admin-1", username: "demo.administrator", role: "Administrator", active: true, walletMapped: true, createdAt: "2026-10-19T00:00:00Z" },
    { id: "carrier-1", username: "new.carrier", role: "Carrier", active: true, walletMapped: false, createdAt: "2026-10-19T00:00:00Z" },
  ] });
  vi.mocked(getInvitations).mockResolvedValue({ items: [{ id: "invite-1", role: "Auditor", expiresAt: "2027-01-01T00:00:00Z" }] });
  return render(<AuthProvider><AdminAccountsPage /></AuthProvider>);
}
describe("administrator account access", () => {
  it("creates an invitation with the selected role and displays the one-time link", async () => {
    vi.mocked(createInvitation).mockResolvedValue({ id: "invite-new", role: "Auditor", expiresAt: "2027-01-01T00:00:00Z", invitationToken: "token-for-invite" });
    mount(); await screen.findByText("new.carrier");
    fireEvent.change(screen.getByLabelText("Account role"), { target: { value: "Auditor" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByLabelText(/Invitation link/)).toHaveValue(`${window.location.origin}/signup?invite=token-for-invite`);
    expect(createInvitation).toHaveBeenCalledWith("Auditor");
  });
  it("prevents self-deactivation and supports disabling another account and revoking invitations", async () => {
    vi.mocked(setAccountActive).mockResolvedValue({}); vi.mocked(revokeInvitation).mockResolvedValue(undefined);
    mount(); await screen.findByText("new.carrier");
    expect(screen.getByRole("button", { name: "Disable demo.administrator" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Disable new.carrier" }));
    await waitFor(() => expect(setAccountActive).toHaveBeenCalledWith("carrier-1", false));
    await waitFor(() => expect(screen.getByRole("button", { name: "Revoke invitation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    await waitFor(() => expect(revokeInvitation).toHaveBeenCalledWith("invite-1"));
  });
});
