import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { login as loginRequest, me } from "../api/endpoints";
import { apiBaseUrl, bindAccessTokenStore, getAccessToken, setAccessToken } from "../api/client";
import type { AuthUser, Role } from "../types";

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  isReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    bindAccessTokenStore((next) => setTokenState(next));

    const bootstrap = async () => {
      try {
        const refreshed = await fetch(`${apiBaseUrl}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        });
        if (refreshed.ok) {
          const data = (await refreshed.json()) as { token: string };
          setAccessToken(data.token);
          const profile = await me(data.token);
          setUser(profile.user);
        } else {
          setAccessToken(null);
          setUser(null);
        }
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setIsReady(true);
      }
    };

    void bootstrap();
  }, []);

  const login = async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    const nextUser: AuthUser = {
      userId: result.user.id,
      organizationId: result.user.organizationId,
      role: result.user.role as Role,
      email: result.user.email
    };
    setAccessToken(result.token);
    setUser(nextUser);
  };

  const logout = async () => {
    const current = getAccessToken();
    if (current) {
      try {
        await fetch(`${apiBaseUrl}/api/auth/logout`, {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${current}` }
        });
      } catch {
        // no-op
      }
    }
    setAccessToken(null);
    setUser(null);
  };

  const value = useMemo(
    () => ({ token, user, isReady, login, setUser, logout }),
    [token, user, isReady]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
