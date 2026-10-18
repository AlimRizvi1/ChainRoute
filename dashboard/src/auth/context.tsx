import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { login as requestLogin } from "../api/auth";
import { clearSession, readSession, type AuthSession } from "./session";

type AuthContextValue = {
  session: AuthSession | null;
  signIn: (username: string, password: string) => Promise<AuthSession>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => readSession());

  useEffect(() => {
    const expire = () => {
      clearSession();
      setSession(null);
    };
    window.addEventListener("chainroute:session-expired", expire);
    return () => window.removeEventListener("chainroute:session-expired", expire);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const next = await requestLogin(username, password);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
