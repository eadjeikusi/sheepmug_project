import { useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { resolveImpliedPermissions } from '../../permissions/catalog';

export function usePermissions() {
  const { user } = useAuth();

  const isOrgOwner = user?.is_org_owner === true;
  const permissions = user?.permissions ?? [];

  const effectivePerms = useMemo(() => {
    const raw = user?.permissions;
    if (!raw || !Array.isArray(raw)) return new Set<string>();
    return resolveImpliedPermissions(new Set(raw));
  }, [user?.permissions]);

  const can = useCallback(
    (permissionId: string): boolean => {
      if (!user) return false;
      if (user.is_org_owner === true) return true;
      if (user.is_super_admin === true) return true;
      const perms = user.permissions;
      if (perms === undefined) return true;
      if (effectivePerms.has(permissionId)) return true;
      const noteManage = 'manage_member_notes';
      const noteView = 'view_member_notes';
      const noteAdd = 'add_member_notes';
      const noteEdit = 'edit_member_notes';
      const noteDelete = 'delete_member_notes';
      const noteWriteIds = [noteView, noteAdd, noteEdit, noteDelete];
      if (perms.includes(noteManage) && noteWriteIds.includes(permissionId)) return true;
      if (
        permissionId === noteView &&
        (perms.includes(noteAdd) || perms.includes(noteEdit) || perms.includes(noteDelete))
      ) {
        return true;
      }
      return false;
    },
    [user, effectivePerms],
  );

  return { can, isOrgOwner, permissions };
}
