import { apiRequest } from "./client";
import type { Role } from "../auth/roles";

export type Account = { id: string; username: string; role: Role; active: boolean; walletMapped: boolean; createdAt: string };
export type Invitation = { id: string; role: Role; expiresAt: string };
export const getAccounts = () => apiRequest<{ items: Account[] }>("/admin/users");
export const getInvitations = () => apiRequest<{ items: Invitation[] }>("/admin/invitations");
export const createInvitation = (role: Role) => apiRequest<Invitation & { invitationToken: string }>("/admin/invitations", { method: "POST", body: { role } });
export const revokeInvitation = (id: string) => apiRequest<void>(`/admin/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
export const setAccountActive = (id: string, active: boolean) => apiRequest(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { active } });
