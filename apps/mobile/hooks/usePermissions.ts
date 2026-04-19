import { useCallback, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";

const IMPLIES_MAP: Record<string, string[]> = {
  delete_members: ["view_deleted_members"],
  assign_event_members: ["view_members"],
  view_member_tasks: ["view_group_tasks"],
  monitor_member_tasks: ["view_member_tasks"],
  manage_member_tasks: ["view_member_tasks", "manage_member_task_checklist", "complete_member_task_checklist"],
  manage_member_task_checklist: ["complete_member_task_checklist"],
  monitor_group_tasks: ["view_group_tasks"],
  manage_group_tasks: ["view_group_tasks", "manage_group_task_checklist", "complete_group_task_checklist"],
  manage_group_task_checklist: ["complete_group_task_checklist"],
  approve_group_requests: ["view_group_requests"],
};

function resolveImplied(ids: Set<string>): Set<string> {
  const result = new Set(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    const implied = IMPLIES_MAP[id];
    if (!implied) continue;
    for (const imp of implied) {
      if (!result.has(imp)) {
        result.add(imp);
        queue.push(imp);
      }
    }
  }
  return result;
}

export function usePermissions() {
  const { user } = useAuth();

  const isOrgOwner = user?.is_org_owner === true;

  const effectivePerms = useMemo(() => {
    const raw = user?.permissions;
    if (!raw || !Array.isArray(raw)) return new Set<string>();
    return resolveImplied(new Set(raw));
  }, [user?.permissions]);

  const can = useCallback(
    (permissionId: string): boolean => {
      if (!user) return false;
      if (user.is_org_owner === true) return true;
      if (user.is_super_admin === true) return true;
      const perms = user.permissions;
      if (perms === undefined) return false;
      if (effectivePerms.has(permissionId)) return true;
      const noteManage = "manage_member_notes";
      const noteView = "view_member_notes";
      const noteAdd = "add_member_notes";
      const noteEdit = "edit_member_notes";
      const noteDelete = "delete_member_notes";
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
    [user, effectivePerms]
  );

  return { can, isOrgOwner, permissions: user?.permissions ?? [] };
}
