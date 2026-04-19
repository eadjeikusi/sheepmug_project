import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { usePermissions } from '@/hooks/usePermissions';

export const MEMBER_TASKS_CHANGED = 'member-tasks-changed';

export function notifyMemberTasksChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MEMBER_TASKS_CHANGED));
  }
}

export function useMyOpenTaskCount() {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!token || !can('view_group_tasks')) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch('/api/tasks/my-open-count', {
        headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { count?: number };
      setCount(typeof data.count === 'number' ? data.count : 0);
    } catch {
      setCount(0);
    }
  }, [token, selectedBranch?.id, can]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onRefresh = () => void refresh();
    window.addEventListener('focus', onRefresh);
    window.addEventListener(MEMBER_TASKS_CHANGED, onRefresh);
    return () => {
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener(MEMBER_TASKS_CHANGED, onRefresh);
    };
  }, [refresh]);

  return { count, refresh };
}
