import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppNotification } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { supabaseRealtime } from "../lib/supabaseClient";

type NotificationState = {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
};

const NotificationContext = createContext<NotificationState | undefined>(undefined);

const PAGE_SIZE = 10;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      setHasMore(true);
      return;
    }

    setLoading(true);
    try {
      const [listRes, unreadRes] = await Promise.all([
        api.notifications.list({ limit: PAGE_SIZE, offset: 0 }),
        api.notifications.unreadCount(),
      ]);
      const rows = Array.isArray(listRes.notifications) ? listRes.notifications : [];
      setNotifications(rows);
      setHasMore(rows.length === PAGE_SIZE);
      setUnreadCount(Number(unreadRes.unread_count || 0));
    } catch {
      // Keep app stable when token is stale or notification permission is absent.
      setNotifications([]);
      setUnreadCount(0);
      setHasMore(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadMore = useCallback(async () => {
    if (!token || loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await api.notifications.list({
        limit: PAGE_SIZE,
        offset: notifications.length,
      });
      const rows = Array.isArray(res.notifications) ? res.notifications : [];
      setNotifications((prev) => {
        if (rows.length === 0) return prev;
        const seen = new Set(prev.map((n) => n.id));
        const merged = [...prev];
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          merged.push(row);
        }
        return merged;
      });
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      // keep prior state on transient errors
    } finally {
      setLoadingMore(false);
    }
  }, [token, loading, loadingMore, hasMore, notifications.length]);

  const markOneRead = useCallback(
    async (id: string) => {
      if (!id) return;
      await api.notifications.markRead(id);
      await refresh();
    },
    [refresh]
  );

  const markAllRead = useCallback(async () => {
    await api.notifications.markAllRead();
    await refresh();
  }, [refresh]);

  const clearAll = useCallback(async () => {
    await api.notifications.clearAll();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token || !user?.id) return;
    // RLS on `notifications` is tied to the Supabase JWT; without this, postgres_changes never fires for the user.
    void supabaseRealtime.realtime.setAuth(token);

    const channel = supabaseRealtime
      .channel(`mobile_notifications_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_profile_id=eq.${user.id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabaseRealtime.removeChannel(channel);
      void supabaseRealtime.realtime.setAuth();
    };
  }, [token, user?.id, refresh]);

  const value = useMemo<NotificationState>(
    () => ({
      notifications,
      unreadCount,
      loading,
      loadingMore,
      hasMore,
      refresh,
      loadMore,
      markOneRead,
      markAllRead,
      clearAll,
    }),
    [
      notifications,
      unreadCount,
      loading,
      loadingMore,
      hasMore,
      refresh,
      loadMore,
      markOneRead,
      markAllRead,
      clearAll,
    ]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}
