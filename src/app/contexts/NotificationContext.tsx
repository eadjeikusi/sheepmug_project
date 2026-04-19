import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Calendar, CheckSquare, Shield, UserCheck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';

const hasRealtimeEnv =
  Boolean((import.meta as any).env?.VITE_SUPABASE_URL) &&
  Boolean((import.meta as any).env?.VITE_SUPABASE_ANON_KEY);

export type AppNotification = {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  read_at: string | null;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
  action_path: string | null;
  payload: Record<string, unknown> | null;
};

type RawRow = Record<string, unknown>;

function getIconForNotification(n: AppNotification): LucideIcon {
  if (n.category === 'tasks') return CheckSquare;
  if (n.category === 'events' || n.category === 'attendance') return Calendar;
  if (n.category === 'permissions') return Shield;
  if (n.category === 'requests') return UserCheck;
  if (n.category === 'assignments' || n.category === 'member_care' || n.category === 'leader_updates') return Users;
  return Bell;
}

function normalizeRow(row: RawRow): AppNotification {
  return {
    id: String(row.id || ''),
    type: String(row.type || 'system'),
    category: String(row.category || 'events'),
    title: String(row.title || ''),
    message: String(row.message || ''),
    severity: (String(row.severity || 'medium') as 'low' | 'medium' | 'high'),
    read_at: typeof row.read_at === 'string' ? row.read_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    entity_type: typeof row.entity_type === 'string' ? row.entity_type : null,
    entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
    action_path: typeof row.action_path === 'string' ? row.action_path : null,
    payload: row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : null,
  };
}

interface NotificationContextValue {
  notifications: AppNotification[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  unreadCount: number;
  iconForNotification: (n: AppNotification) => LucideIcon;
  fetchNotifications: () => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteOne: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const FETCH_LIMIT = 10;
const POLL_INTERVAL_MS = 5000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const { selectedBranch } = useBranch();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const busyRef = useRef(false);
  const loadedNotificationsCountRef = useRef(0);
  const branchId = selectedBranch?.id;

  useEffect(() => {
    loadedNotificationsCountRef.current = notifications.length;
  }, [notifications.length]);

  const fetchNotifications = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      setHasMore(true);
      return;
    }
    setLoading(true);
    try {
      const url = new URL('/api/notifications', window.location.origin);
      const limit = Math.max(FETCH_LIMIT, loadedNotificationsCountRef.current || FETCH_LIMIT);
      url.searchParams.set('limit', String(limit));
      const res = await fetch(url.toString(), {
        headers: withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const rows = Array.isArray((data as any).notifications) ? (data as any).notifications : [];
      setNotifications(rows.map(normalizeRow));
      setHasMore(rows.length >= limit);
    } finally {
      setLoading(false);
    }
  }, [branchId, token]);

  const loadMoreNotifications = useCallback(async () => {
    if (!token || loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const url = new URL('/api/notifications', window.location.origin);
      url.searchParams.set('limit', String(FETCH_LIMIT));
      url.searchParams.set('offset', String(loadedNotificationsCountRef.current));
      const res = await fetch(url.toString(), {
        headers: withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const rows = Array.isArray((data as any).notifications) ? (data as any).notifications : [];
      const normalized = rows.map(normalizeRow);
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const merged = [...prev];
        for (const item of normalized) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
        return merged;
      });
      setHasMore(rows.length === FETCH_LIMIT);
    } finally {
      setLoadingMore(false);
    }
  }, [token, loading, loadingMore, hasMore, branchId]);

  const fetchUnreadCount = useCallback(async () => {
    if (!token) { setUnreadCount(0); return; }
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setUnreadCount(Number((data as any).unread_count || 0));
    } catch { /* keep last known */ }
  }, [branchId, token]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await Promise.all([fetchNotifications(), fetchUnreadCount()]);
    } finally {
      busyRef.current = false;
    }
  }, [fetchNotifications, fetchUnreadCount]);

  // Initial fetch
  useEffect(() => { void refresh(); }, [refresh]);

  /** RLS + Realtime need the user's JWT; anon socket would not receive inserts from the service role. */
  useEffect(() => {
    if (!hasRealtimeEnv || !token) return;
    void supabase.realtime.setAuth(token);
    return () => {
      void supabase.realtime.setAuth();
    };
  }, [token]);

  // Supabase realtime
  useEffect(() => {
    if (!user?.id || !hasRealtimeEnv || !token) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications',
        filter: `recipient_profile_id=eq.${user.id}`,
      }, () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, token, refresh]);

  // Fallback polling (only when realtime is unavailable)
  useEffect(() => {
    if (!token || hasRealtimeEnv) return;
    const id = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [token, refresh]);

  // Re-sync on focus/visibility
  useEffect(() => {
    if (!token) return;
    const handler = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', handler);
    return () => {
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', handler);
    };
  }, [token, refresh]);

  const getHeaders = useCallback(
    () => withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
    [branchId, token],
  );

  const markOneRead = useCallback(async (id: string) => {
    if (!token || !id) return;
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: n.read_at || new Date().toISOString() } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', headers: getHeaders() });
      if (!res.ok) { void refresh(); return; }
    } catch { void refresh(); return; }
    await fetchUnreadCount();
  }, [getHeaders, token, refresh, fetchUnreadCount]);

  const markAllRead = useCallback(async () => {
    if (!token) return;
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    setUnreadCount(0);
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'PATCH', headers: getHeaders() });
      if (!res.ok) { void refresh(); return; }
    } catch { void refresh(); return; }
    await fetchUnreadCount();
  }, [getHeaders, token, refresh, fetchUnreadCount]);

  const deleteOne = useCallback(async (id: string) => {
    if (!token || !id) return;
    setNotifications(prev => prev.filter(n => n.id !== id));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getHeaders() });
      if (!res.ok) { void refresh(); }
    } catch { void refresh(); }
  }, [getHeaders, token, refresh]);

  const clearAll = useCallback(async () => {
    if (!token) return;
    setNotifications([]);
    setUnreadCount(0);
    try {
      const res = await fetch('/api/notifications/clear-all', { method: 'DELETE', headers: getHeaders() });
      if (!res.ok) { void refresh(); }
    } catch { void refresh(); }
  }, [getHeaders, token, refresh]);

  return (
    <NotificationContext.Provider value={{
      notifications, loading, loadingMore, hasMore, unreadCount,
      iconForNotification: getIconForNotification,
      fetchNotifications, loadMoreNotifications, markOneRead, markAllRead, deleteOne, clearAll,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
