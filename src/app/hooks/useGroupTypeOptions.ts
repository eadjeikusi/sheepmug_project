import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';
import { withBranchScope } from '../utils/branchScopeHeaders';
import type { GroupTypeOption } from '../../types';

export function useGroupTypeOptions(enabled = true) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [options, setOptions] = useState<GroupTypeOption[]>([]);
  const [loading, setLoading] = useState(false);
  /** True when DB migration `group_type_options` has not been applied. */
  const [tableMissing, setTableMissing] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !enabled) {
      if (!token) setOptions([]);
      setTableMissing(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/group-type-options', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setTableMissing(true);
        setOptions([]);
        return;
      }
      setTableMissing(false);
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load group types');
      setOptions(Array.isArray(data) ? (data as GroupTypeOption[]) : []);
    } catch {
      setOptions([]);
      setTableMissing(false);
    } finally {
      setLoading(false);
    }
  }, [token, selectedBranch?.id, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { options, loading, refresh, tableMissing };
}
