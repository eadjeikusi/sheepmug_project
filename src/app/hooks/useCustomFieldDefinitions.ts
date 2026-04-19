import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import type { CustomFieldDefinition } from '@/types';

export function useCustomFieldDefinitions(
  appliesTo: 'member' | 'event' | 'group' | null,
  enabled: boolean,
): {
  definitions: CustomFieldDefinition[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !enabled || !appliesTo) {
      setDefinitions([]);
      return;
    }
    setLoading(true);
    try {
      const q = `?applies_to=${encodeURIComponent(appliesTo)}`;
      const res = await fetch(`/api/custom-field-definitions${q}`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setDefinitions([]);
        return;
      }
      setDefinitions(Array.isArray(data) ? (data as CustomFieldDefinition[]) : []);
    } finally {
      setLoading(false);
    }
  }, [token, appliesTo, enabled, selectedBranch?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { definitions, loading, refresh };
}
