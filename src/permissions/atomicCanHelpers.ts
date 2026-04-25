/**
 * Atomic permission helpers for UI. Pass `can` from usePermissions().
 * Avoid legacy bundle ids like `manage_*` in components.
 */

export type CanFn = (permissionId: string) => boolean;

const some = (can: CanFn, ids: readonly string[]) => ids.some((id) => can(id));

const ROLE_ADMIN: string[] = [
  "view_roles",
  "add_roles",
  "edit_roles",
  "delete_roles",
  "assign_staff_roles",
];

const STAFF_SETTINGS: string[] = [
  "view_staff",
  "edit_staff_access",
  "view_staff_profile_groups",
  "add_staff_profile_groups",
  "edit_staff_profile_groups",
  "delete_staff_profile_groups",
  "assign_staff_profile_groups",
  "view_staff_ministry_scope",
  "edit_staff_ministry_scope",
];

export function canAnyRoleAdmin(can: CanFn): boolean {
  return some(can, ROLE_ADMIN);
}

export function canAnyStaffSettings(can: CanFn): boolean {
  return some(can, STAFF_SETTINGS);
}

/** Legacy `manage_permissions` or `manage_staff` (roles UI, staff tools, linked surfaces). */
export function canAccessStaffOrRoleAdmin(can: CanFn): boolean {
  return canAnyRoleAdmin(can) || canAnyStaffSettings(can);
}

/** Root / sidebar: who may open Settings */
export function canOpenSettings(can: CanFn): boolean {
  if (can("system_settings") || can("edit_organization_name")) return true;
  if (canAnyRoleAdmin(can) || canAnyStaffSettings(can)) return true;
  if (some(can, ["view_event_types", "add_event_types", "edit_event_types", "delete_event_types"])) return true;
  if (some(can, ["add_program_templates", "edit_program_templates", "delete_program_templates"])) return true;
  return false;
}

export function canConfigureMemberStatusOptions(can: CanFn): boolean {
  if (some(can, ["add_member_status_options", "edit_member_status_options", "delete_member_status_options"])) return true;
  return can("system_settings") || canAnyRoleAdmin(can) || canAnyStaffSettings(can);
}

export function canConfigureGroupTypeOptions(can: CanFn): boolean {
  if (some(can, ["add_groups", "edit_groups", "archive_groups", "restore_groups", "purge_groups"])) return true;
  return can("system_settings") || canAnyRoleAdmin(can) || canAnyStaffSettings(can);
}

export function canConfigureCustomFieldsUi(can: CanFn): boolean {
  return can("system_settings") || canAnyRoleAdmin(can) || canAnyStaffSettings(can);
}

export function canViewOrEditEventTypesUi(can: CanFn): boolean {
  return some(can, ["view_event_types", "add_event_types", "edit_event_types", "delete_event_types"]);
}

export function canViewOrEditProgramTemplatesUi(can: CanFn): boolean {
  return some(can, ["add_program_templates", "edit_program_templates", "delete_program_templates"]);
}

export function canAddEvent(can: CanFn): boolean {
  return can("add_events");
}

export function canEditEvent(can: CanFn): boolean {
  return can("edit_events");
}

export function canDeleteEvent(can: CanFn): boolean {
  return can("delete_events");
}

export function canAddFamily(can: CanFn): boolean {
  return can("add_families");
}

export function canCreateGroup(can: CanFn): boolean {
  return can("add_groups");
}

export function canWriteMemberTasks(can: CanFn): boolean {
  return some(can, [
    "add_member_tasks",
    "edit_member_tasks",
    "delete_member_tasks",
    "edit_member_task_checklist",
    "complete_member_task_checklist",
  ]);
}

export function canWriteGroupTasks(can: CanFn): boolean {
  return some(can, [
    "add_group_tasks",
    "edit_group_tasks",
    "delete_group_tasks",
    "edit_group_task_checklist",
    "complete_group_task_checklist",
  ]);
}

/** Reshape checklist structure (excludes mark-done-only). */
export function canReshapeMemberTaskChecklist(can: CanFn): boolean {
  return some(can, ["add_member_tasks", "edit_member_tasks", "delete_member_tasks", "edit_member_task_checklist"]);
}

export function canReshapeGroupTaskChecklist(can: CanFn): boolean {
  return some(can, ["add_group_tasks", "edit_group_tasks", "delete_group_tasks", "edit_group_task_checklist"]);
}

const ANY_TASK_VIEW_OR_WRITE: string[] = [
  "view_member_tasks",
  "monitor_member_tasks",
  "add_member_tasks",
  "edit_member_tasks",
  "delete_member_tasks",
  "edit_member_task_checklist",
  "complete_member_task_checklist",
  "view_group_tasks",
  "monitor_group_tasks",
  "add_group_tasks",
  "edit_group_tasks",
  "delete_group_tasks",
  "edit_group_task_checklist",
  "complete_group_task_checklist",
];

export function canSeeAnyTaskPermission(can: CanFn): boolean {
  return some(can, ANY_TASK_VIEW_OR_WRITE);
}

export function canAccessEventAttendance(can: CanFn): boolean {
  return can("view_event_attendance") || can("record_event_attendance");
}

export function canRecordEventAttendance(can: CanFn): boolean {
  return can("record_event_attendance");
}
