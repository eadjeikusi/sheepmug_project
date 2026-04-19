import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';
import { withBranchScope } from '../utils/branchScopeHeaders';
import type { MemberStatusOption } from '../../types';

export function useMemberStatusOptions(enabled = true) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [options, setOptions] = useState<MemberStatusOption[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !enabled) {
      if (!token) setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/member-status-options', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load statuses');
      setOptions(Array.isArray(data) ? (data as MemberStatusOption[]) : []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [token, selectedBranch?.id, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { options, loading, refresh };
}
