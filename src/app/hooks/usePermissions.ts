import { useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  expandStoredPermissionIds,
  isValidPermissionId,
  LEGACY_PERMISSION_ALIASES,
} from '../../permissions/catalog';

export function usePermissions() {
  const { user } = useAuth();

  const isOrgOwner = user?.is_org_owner === true;
  const permissions = user?.permissions ?? [];

  const effectivePerms = useMemo(() => {
    const raw = user?.permissions;
    if (!raw || !Array.isArray(raw)) return new Set<string>();
    return expandStoredPermissionIds(new Set(raw));
  }, [user?.permissions]);

  const can = useCallback(
    (permissionId: string): boolean => {
      if (!user) return false;
      if (user.is_org_owner === true) return true;
      if (user.is_super_admin === true) return true;
      if (user.permissions === undefined) return false;
      if (effectivePerms.has(permissionId)) return true;
      const bundle = LEGACY_PERMISSION_ALIASES[permissionId];
      if (bundle && !isValidPermissionId(permissionId)) {
        return bundle.every((p) => effectivePerms.has(p));
      }
      return false;
    },
    [user, effectivePerms],
  );

  return { can, isOrgOwner, permissions };
}
