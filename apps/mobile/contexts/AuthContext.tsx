import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, type AuthUser } from "@sheepmug/shared-api";
import {
  API_BASE_URL,
  api,
  hydrateApiState,
  setApiAuthFailureHandler,
  setApiAuthSession,
} from "../lib/api";
import { devLog, devWarn } from "../lib/devLog";
import {
  getStoredUserJson,
  setRefreshToken,
  setStoredUserJson,
  getToken,
  setToken,
} from "../lib/storage";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUserLocal: (next: AuthUser | null) => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/** Avoid hanging forever on splash when `/api/auth/me` never resolves (offline API, bad URL). */
const AUTH_ME_TIMEOUT_MS = 12_000;
const AUTH_LOGIN_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label)), ms);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(async () => {
    await setToken(null);
    await setRefreshToken(null);
    await setStoredUserJson(null);
    setApiAuthSession({ token: null, refreshToken: null });
    setTokenState(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setApiAuthFailureHandler(() => {
      void clearSession();
    });
    return () => {
      setApiAuthFailureHandler(null);
    };
  }, [clearSession]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      devLog("auth bootstrap: start");
      try {
        await hydrateApiState();
        const storedToken = await getToken();
        setTokenState(storedToken);

        if (storedToken) {
          devLog("auth bootstrap: GET /api/auth/me …");
          try {
            const me = await withTimeout(api.auth.me(), AUTH_ME_TIMEOUT_MS, "auth_me_timeout");
            if (me?.user) {
              setUser(me.user);
              devLog("auth bootstrap: /me ok", { userId: me.user.id?.slice?.(0, 8) });
            }
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) {
              devWarn("auth bootstrap: session expired");
              await clearSession();
            } else {
              const msg = e instanceof Error ? e.message : String(e);
              devWarn("auth bootstrap: /me failed (using cache if any)", msg);
            }
          }
        } else {
          devLog("auth bootstrap: no stored token");
        }

        const raw = await getStoredUserJson();
        if (!mounted) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as AuthUser;
            setUser((prev) => prev || parsed);
          } catch {
            await setStoredUserJson(null);
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
          devLog("auth bootstrap: done (loading=false)");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const trimmedEmail = email.trim();
    devLog("login: POST /api/auth/login …", { email: trimmedEmail });
    try {
      const result = await withTimeout(api.auth.login(trimmedEmail, password), AUTH_LOGIN_TIMEOUT_MS, "auth_login_timeout");
      devLog("login: ok", { userId: result.user?.id?.slice?.(0, 8) });
      await setToken(result.token);
      await setRefreshToken(result.refresh_token ?? null);
      await setStoredUserJson(JSON.stringify(result.user));
      setApiAuthSession({ token: result.token, refreshToken: result.refresh_token ?? null });
      setTokenState(result.token);
      setUser(result.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      devWarn("login: failed", msg);
      const looksUnreachable =
        /network request timed out|timed out|fetch|network failed|failed to connect|ECONNREFUSED|ENOTFOUND|aborted|auth_login_timeout/i.test(
          msg
        ) || e instanceof TypeError;
      if (looksUnreachable) {
        throw new Error(
          `Can't reach API at ${API_BASE_URL}. (${msg}) Start the backend from the project root: npm run dev (port 3000). Expo only starts Metro; the API is a separate process. If the URL already shows your PC's IP but login still times out, allow inbound TCP 3000 in Windows Firewall (8081 may work while 3000 is blocked). Override the base URL with EXPO_PUBLIC_API_BASE_URL only if the detected host is wrong.`
        );
      }
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    devLog("logout: clearing session");
    await clearSession();
  }, [clearSession]);

  const setUserLocal = useCallback(async (next: AuthUser | null) => {
    if (!next) {
      await clearSession();
      return;
    }
    await setStoredUserJson(JSON.stringify(next));
    setUser(next);
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await api.auth.me();
    if (!me?.user) return;
    await setStoredUserJson(JSON.stringify(me.user));
    setUser(me.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      login,
      logout,
      refreshUser,
      setUserLocal,
    }),
    [user, token, loading, login, logout, refreshUser, setUserLocal]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
