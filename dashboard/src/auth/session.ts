import { isRole, type Role } from "./roles";

const STORAGE_KEY = "chainroute.session.v1";

export type UserSummary = { id: string; username: string; role: Role };
export type AuthSession = {
  token: string;
  expiresAt: number;
  user: UserSummary;
};

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AuthSession>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    typeof candidate.user === "object" &&
    candidate.user !== null &&
    typeof candidate.user.id === "string" &&
    typeof candidate.user.username === "string" &&
    isRole(candidate.user.role)
  );
}

export function readSession(storage: Storage = window.sessionStorage): AuthSession | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isAuthSession(value) || value.expiresAt <= Date.now()) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function writeSession(
  session: AuthSession,
  storage: Storage = window.sessionStorage,
): void {
  if (!isAuthSession(session) || session.expiresAt <= Date.now()) {
    throw new Error("A valid, unexpired ChainRoute session is required.");
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(storage: Storage = window.sessionStorage): void {
  storage.removeItem(STORAGE_KEY);
}

export function createSession(
  response: { token: string; expiresIn: number; user: UserSummary },
  now = Date.now(),
): AuthSession {
  if (
    !response.token ||
    !Number.isFinite(response.expiresIn) ||
    response.expiresIn <= 0 ||
    !isRole(response.user?.role)
  ) {
    throw new Error("The server returned an invalid login response.");
  }
  return {
    token: response.token,
    expiresAt: now + response.expiresIn * 1000,
    user: response.user,
  };
}
