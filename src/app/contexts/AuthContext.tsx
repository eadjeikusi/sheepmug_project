import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types';
import { supabase } from '../utils/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  token: string | null;
}

interface SignupData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  phone?: string;
  subscriptionTier?: string;
  billingCycle?: string;
  demoBypass?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'user';
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (typeof window !== 'undefined') {
    try {
      const configured = new URL(API_BASE, window.location.origin);
      const current = new URL(window.location.origin);
      const configuredHost = configured.hostname.replace(/^www\./i, '').toLowerCase();
      const currentHost = current.hostname.replace(/^www\./i, '').toLowerCase();
      if (configuredHost === currentHost) {
        // Avoid cross-origin + redirect preflight issues between apex and www domains.
        return path;
      }
    } catch {
      // fall through to configured API base
    }
  }
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

type ApiBody = Record<string, any>;

async function parseApiBody(response: Response): Promise<ApiBody> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    return (await response.json().catch(() => ({}))) as ApiBody;
  }

  const raw = await response.text().catch(() => '');
  const looksHtml = /^\s*</.test(raw);
  return {
    error: looksHtml
      ? 'Server returned HTML instead of API JSON. Check that /api routes are available for this environment.'
      : raw || 'Unexpected non-JSON API response.',
  };
}

/** If an API payload omits `permissions`, keep the previous value so RBAC state is not wiped. */
function mergeIncomingUser(prev: User | null, incoming: User): User {
  const merged: User = { ...incoming };
  if (prev && incoming.permissions === undefined && prev.permissions !== undefined) {
    merged.permissions = prev.permissions;
  }
  if (prev && incoming.ministry_scope === undefined && prev.ministry_scope !== undefined) {
    merged.ministry_scope = prev.ministry_scope;
  }
  if (
    prev &&
    incoming.cms_onboarding_completed === undefined &&
    prev.cms_onboarding_completed !== undefined
  ) {
    merged.cms_onboarding_completed = prev.cms_onboarding_completed;
  }
  return merged;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const refreshSession = async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    try {
      const refreshResponse = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const refreshData = await parseApiBody(refreshResponse);
      if (refreshResponse.status === 403) {
        clearSession();
        throw new Error((refreshData as { error?: string }).error || 'Access denied for this account.');
      }
      if (!refreshResponse.ok || typeof refreshData.token !== 'string') {
        clearSession();
        return null;
      }
      localStorage.setItem(TOKEN_KEY, refreshData.token);
      if (typeof refreshData.refresh_token === 'string' && refreshData.refresh_token.trim()) {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
      }
      if (refreshData.user) {
        const nextUser = mergeIncomingUser(user, refreshData.user);
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
        setUser(nextUser);
      }
      setToken(refreshData.token);
      return refreshData.token;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setLoading(false);
      return;
    }

    setToken(storedToken);

    const load = async () => {
      try {
        const getMe = (authToken: string) =>
          fetch(apiUrl('/api/auth/me'), {
            headers: { Authorization: `Bearer ${authToken}` },
          });
        let activeToken = storedToken;
        let response = await getMe(activeToken);
        if (response.status === 401) {
          const refreshedToken = await refreshSession();
          if (!refreshedToken) {
            clearSession();
            return;
          }
          activeToken = refreshedToken;
          response = await getMe(activeToken);
        }
        if (response.status === 403) {
          clearSession();
          return;
        }
        if (!response.ok) throw new Error('me failed');
        const data = await response.json();
        if (data.user) {
          setUser((prev) => {
            const next = mergeIncomingUser(prev, data.user);
            localStorage.setItem(USER_KEY, JSON.stringify(next));
            return next;
          });
        }
      } catch {
        const storedUser = localStorage.getItem(USER_KEY);
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser));
          } catch {
            clearSession();
          }
        }
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const login = async (email: string, password: string) => {
    const tryBackend = async (): Promise<{ ok: true; data: any } | { ok: false; reason: string; detail?: string }> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await parseApiBody(response);
        if (!response.ok) return { ok: false, reason: 'http_error', detail: data.error || `HTTP ${response.status}` };
        return { ok: true, data };
      } catch (err: any) {
        return { ok: false, reason: 'network_error', detail: err?.message || String(err) };
      }
    };

    const backendResult = await tryBackend();

    if (backendResult.ok) {
      const data = backendResult.data;
      localStorage.setItem(TOKEN_KEY, data.token);
      if (typeof data.refresh_token === 'string' && data.refresh_token.trim()) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      }
      const nextUser = mergeIncomingUser(null, data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      setUser(nextUser);
      setToken(data.token);
      return;
    }

    // Backend unreachable or errored → fall back to Supabase direct auth.
    try {
      const { data: sbData, error: sbErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (sbErr) {
        if (backendResult.reason === 'http_error' && backendResult.detail) {
          throw new Error(backendResult.detail);
        }
        throw new Error(sbErr.message || 'Login failed');
      }
      const session = (sbData as any)?.session;
      const sbUser = (sbData as any)?.user;
      if (!session || !sbUser) throw new Error('Login failed: no session');

      const meta = (sbUser.user_metadata || {}) as Record<string, any>;
      const uiUser: User = {
        id: sbUser.id,
        email: sbUser.email || email.trim(),
        first_name: meta.first_name || meta.firstName || (meta.full_name ? String(meta.full_name).split(' ')[0] : ''),
        last_name: meta.last_name || meta.lastName || (meta.full_name ? String(meta.full_name).split(' ').slice(1).join(' ') : ''),
        organization_id: meta.organization_id || '',
        is_super_admin: !!meta.is_super_admin,
        is_org_owner: !!meta.is_org_owner,
        permissions: Array.isArray(meta.permissions) ? meta.permissions : [],
        profile_image: meta.profile_image || null,
        organization: meta.organization || { id: meta.organization_id || '', name: meta.organization_name || '', slug: meta.organization_slug || '' },
        cms_onboarding_completed: false,
      } as User;

      localStorage.setItem(TOKEN_KEY, session.access_token);
      if (session.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
      localStorage.setItem(USER_KEY, JSON.stringify(uiUser));
      setUser(uiUser);
      setToken(session.access_token);
    } catch (err: any) {
      throw err;
    }
  };

  const signup = async (signupData: SignupData) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for signup

      const response = await fetch(apiUrl('/api/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signupData.email,
          password: signupData.password,
          organizationName: signupData.organizationName || `${signupData.firstName}'s Organization`,
          fullName: `${signupData.firstName} ${signupData.lastName}`,
          subscriptionTier: signupData.subscriptionTier,
          billingCycle: signupData.billingCycle,
          demoBypass: signupData.demoBypass === true,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await parseApiBody(response);

      if (!response.ok) {
        const errorMessage = data.details ? `${data.error}: ${data.details}` : (data.error || 'Signup failed');
        throw new Error(errorMessage);
      }

      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        if (typeof data.refresh_token === 'string' && data.refresh_token.trim()) {
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        }
        setToken(data.token);
      }
      if (data.user) {
        const nextUser = mergeIncomingUser(null, data.user);
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
        setUser(nextUser);
      }
    } catch (error: any) {
      throw error;
    }
  };

  const logout = () => {
    clearSession();
    window.location.href = '/cms/login';
  };

  const refreshUser = async () => {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) return;
    try {
      const getMe = (authToken: string) =>
        fetch(apiUrl('/api/auth/me'), {
          headers: { Authorization: `Bearer ${authToken}` },
        });
      let response = await getMe(t);
      if (response.status === 401) {
        const refreshedToken = await refreshSession();
        if (!refreshedToken) {
          clearSession();
          window.location.href = '/';
          return;
        }
        t = refreshedToken;
        response = await getMe(t);
      }
      if (response.status === 403) {
        clearSession();
        window.location.href = '/';
        return;
      }
      if (!response.ok) throw new Error('refresh user failed');
      const data = await response.json();
      if (data.user) {
        setUser((prev) => {
          const next = mergeIncomingUser(prev, data.user);
          localStorage.setItem(USER_KEY, JSON.stringify(next));
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  };

  const value = {
    user,
    loading,
    login,
    signup,
    logout,
    refreshUser,
    isAuthenticated: !!user,
    token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
