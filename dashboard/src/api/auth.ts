import { apiRequest } from "./client";
import { createSession, writeSession, type AuthSession, type UserSummary } from "../auth/session";
import { isRole } from "../auth/roles";

type LoginResponse = { token: string; tokenType: "Bearer"; expiresIn: number; user: UserSummary };

export async function login(username: string, password: string): Promise<AuthSession> {
  const response = await apiRequest<unknown>("/auth/login", {
    method: "POST",
    auth: false,
    body: { username: username.trim(), password },
  });
  if (!isLoginResponse(response)) {
    throw new Error("The server returned an invalid login response.");
  }
  const session = createSession(response);
  writeSession(session);
  return session;
}

export async function signup(username: string, password: string, invitationToken?: string): Promise<AuthSession> {
  const response = await apiRequest<unknown>("/auth/signup", {
    method: "POST", auth: false,
    body: { username: username.trim(), password, ...(invitationToken ? { invitationToken } : {}) },
  });
  if (!isLoginResponse(response)) throw new Error("The server returned an invalid signup response.");
  const session = createSession(response);
  writeSession(session);
  return session;
}

export function previewInvitation(invitationToken: string) {
  return apiRequest<{ role: UserSummary["role"]; expiresAt: string }>("/auth/invitations/preview", {
    method: "POST", auth: false, body: { invitationToken },
  });
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (typeof value !== "object" || value === null || !("user" in value)) return false;
  const response = value as Partial<LoginResponse>;
  const user = response.user;
  return (
    typeof response.token === "string" && response.token.length > 0 &&
    response.tokenType === "Bearer" &&
    typeof response.expiresIn === "number" && Number.isFinite(response.expiresIn) && response.expiresIn > 0 &&
    typeof user === "object" && user !== null &&
    typeof user.id === "string" && typeof user.username === "string" && isRole(user.role)
  );
}
