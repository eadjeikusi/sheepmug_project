/**
 * Canonical permission IDs for org RBAC. Stable — do not rename without a migration path.
 * Each assignable permission is a single action (plus narrow domain verbs: assign, complete, monitor, etc.).
 */

export type PermissionActionKind =
  | "view"
  | "add"
  | "edit"
  | "delete"
  | "import"
  | "export"
  | "manage"
  | "monitor"
  | "complete"
  | "approve"
  | "reject"
  | "assign"
  | "track"
  | "send"
  | "configure";

export type PermissionDef = {
  id: string;
  name: string;
  description: string;
  implies?: string[];
  actionKinds: PermissionActionKind[];
};

export type PermissionCategory = {
  id: string;
  label: string;
  description?: string;
  permissions: PermissionDef[];
};

export const PERMISSION_CATALOG: PermissionCategory[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Home and overview",
    permissions: [
      {
        id: "view_dashboard",
        name: "View dashboard",
        description: "Access dashboard and summary widgets",
        actionKinds: ["view"],
      },
    ],
  },
  {
    id: "members",
    label: "Members",
    permissions: [
      { id: "view_members", name: "View members", description: "See member list and profiles", actionKinds: ["view"] },
      { id: "add_members", name: "Add members", description: "Create new member records", actionKinds: ["add"] },
      { id: "edit_members", name: "Edit members", description: "Update member details", actionKinds: ["edit"] },
      {
        id: "import_members",
        name: "Import members",
        description: "Run CSV member import with precheck, duplicate review, and commit",
        actionKinds: ["import"],
      },
      {
        id: "add_member_status_options",
        name: "Add member status labels",
        description: "Create membership status options for member profiles",
        actionKinds: ["add"],
      },
      {
        id: "edit_member_status_options",
        name: "Edit member status labels",
        description: "Rename or reorder membership status options",
        actionKinds: ["edit"],
      },
      {
        id: "delete_member_status_options",
        name: "Delete member status labels",
        description: "Remove membership status options",
        actionKinds: ["delete"],
      },
      {
        id: "view_deleted_members",
        name: "View deleted members",
        description:
          "Open the deleted members list (soft-deleted records are often removed from ministry groups, so this is separate from viewing active members in your scope)",
        actionKinds: ["view"],
      },
      {
        id: "delete_members",
        name: "Delete members",
        description: "Soft-delete or remove members",
        implies: ["view_deleted_members"],
        actionKinds: ["delete"],
      },
      {
        id: "view_member_notes",
        name: "View member notes",
        description: "Read profile notes (text and voice) on a member",
        actionKinds: ["view"],
      },
      {
        id: "add_member_notes",
        name: "Add member notes",
        description: "Create new profile notes and upload voice clips for new notes",
        implies: ["view_member_notes"],
        actionKinds: ["add"],
      },
      {
        id: "edit_member_notes",
        name: "Edit member notes",
        description: "Change text on existing profile notes",
        implies: ["view_member_notes"],
        actionKinds: ["edit"],
      },
      {
        id: "delete_member_notes",
        name: "Delete member notes",
        description: "Remove profile notes",
        implies: ["view_member_notes"],
        actionKinds: ["delete"],
      },
    ],
  },
  {
    id: "tasks",
    label: "Tasks",
    description: "Follow-up task assignments for members and groups/ministries",
    permissions: [
      {
        id: "view_member_tasks",
        name: "View member tasks",
        description: "See tasks on member profiles you can access (not branch-wide)",
        actionKinds: ["view"],
      },
      {
        id: "monitor_member_tasks",
        name: "Monitor member tasks",
        description: "View all follow-up tasks assigned to staff in this branch (read-only)",
        implies: ["view_member_tasks"],
        actionKinds: ["monitor", "view"],
      },
      {
        id: "add_member_tasks",
        name: "Add member tasks",
        description: "Create follow-up tasks on member profiles",
        implies: ["view_member_tasks"],
        actionKinds: ["add"],
      },
      {
        id: "edit_member_tasks",
        name: "Edit member tasks",
        description: "Change title, assignees, status, due date, and related members on member tasks",
        implies: ["view_member_tasks"],
        actionKinds: ["edit"],
      },
      {
        id: "delete_member_tasks",
        name: "Delete member tasks",
        description: "Remove follow-up tasks on member profiles",
        implies: ["view_member_tasks"],
        actionKinds: ["delete"],
      },
      {
        id: "edit_member_task_checklist",
        name: "Edit member task checklists",
        description: "Add, remove, or rename checklist steps on member tasks",
        implies: ["complete_member_task_checklist"],
        actionKinds: ["edit"],
      },
      {
        id: "complete_member_task_checklist",
        name: "Complete member task checklist items",
        description: "Mark checklist items done and update task progress on your assignments",
        actionKinds: ["complete"],
      },
      {
        id: "view_group_tasks",
        name: "View group tasks",
        description: "See tasks on ministry/group pages you can access",
        actionKinds: ["view"],
      },
      {
        id: "monitor_group_tasks",
        name: "Monitor group tasks",
        description: "View all group follow-up tasks assigned to staff in this branch (read-only)",
        implies: ["view_group_tasks"],
        actionKinds: ["monitor", "view"],
      },
      {
        id: "add_group_tasks",
        name: "Add group tasks",
        description: "Create follow-up tasks on ministry/group pages",
        implies: ["view_group_tasks"],
        actionKinds: ["add"],
      },
      {
        id: "edit_group_tasks",
        name: "Edit group tasks",
        description: "Change title, assignees, status, due date, and related groups on group tasks",
        implies: ["view_group_tasks"],
        actionKinds: ["edit"],
      },
      {
        id: "delete_group_tasks",
        name: "Delete group tasks",
        description: "Remove follow-up tasks on ministry/group pages",
        implies: ["view_group_tasks"],
        actionKinds: ["delete"],
      },
      {
        id: "edit_group_task_checklist",
        name: "Edit group task checklists",
        description: "Add, remove, or rename checklist steps on group tasks",
        implies: ["complete_group_task_checklist"],
        actionKinds: ["edit"],
      },
      {
        id: "complete_group_task_checklist",
        name: "Complete group task checklist items",
        description: "Mark checklist items done and update group task status on your assignments",
        actionKinds: ["complete"],
      },
    ],
  },
  {
    id: "member_requests",
    label: "Member requests",
    permissions: [
      {
        id: "view_member_requests",
        name: "View member requests",
        description: "See pending registration requests",
        actionKinds: ["view"],
      },
      {
        id: "approve_member_requests",
        name: "Approve member requests",
        description: "Approve pending registration requests",
        implies: ["view_member_requests"],
        actionKinds: ["approve"],
      },
      {
        id: "reject_member_requests",
        name: "Reject member requests",
        description: "Reject pending registration requests",
        implies: ["view_member_requests"],
        actionKinds: ["reject"],
      },
    ],
  },
  {
    id: "families",
    label: "Families",
    permissions: [
      { id: "view_families", name: "View families", description: "See family records", actionKinds: ["view"] },
      { id: "add_families", name: "Add families", description: "Create family records", actionKinds: ["add"] },
      { id: "edit_families", name: "Edit families", description: "Update family records", actionKinds: ["edit"] },
      { id: "delete_families", name: "Delete families", description: "Remove family records", actionKinds: ["delete"] },
    ],
  },
  {
    id: "groups",
    label: "Ministries & groups",
    permissions: [
      { id: "view_groups", name: "View groups", description: "See ministries and groups", actionKinds: ["view"] },
      { id: "add_groups", name: "Add groups", description: "Create ministries and groups", actionKinds: ["add"] },
      { id: "edit_groups", name: "Edit groups", description: "Update group details and settings", actionKinds: ["edit"] },
      {
        id: "archive_groups",
        name: "Archive groups",
        description: "Soft-delete groups (move to trash)",
        actionKinds: ["delete"],
      },
      { id: "restore_groups", name: "Restore groups", description: "Restore groups from trash", actionKinds: ["edit"] },
      { id: "purge_groups", name: "Purge groups", description: "Permanently delete groups in trash", actionKinds: ["delete"] },
      {
        id: "assign_groups",
        name: "Assign members to groups",
        description: "Add or remove group membership",
        actionKinds: ["assign"],
      },
      {
        id: "view_group_requests",
        name: "View group join requests",
        description: "See pending ministry join requests (without approving)",
        actionKinds: ["view"],
      },
      {
        id: "approve_group_requests",
        name: "Approve group requests",
        description: "Approve join requests to ministries",
        implies: ["view_group_requests"],
        actionKinds: ["approve"],
      },
      {
        id: "reject_group_requests",
        name: "Reject group requests",
        description: "Reject or ignore join requests to ministries",
        implies: ["view_group_requests"],
        actionKinds: ["reject"],
      },
      {
        id: "add_group_type_options",
        name: "Add group type labels",
        description: "Create group type picklist options",
        actionKinds: ["add"],
      },
      {
        id: "edit_group_type_options",
        name: "Edit group type labels",
        description: "Rename or reorder group type options",
        actionKinds: ["edit"],
      },
      {
        id: "delete_group_type_options",
        name: "Delete group type labels",
        description: "Remove group type options",
        actionKinds: ["delete"],
      },
    ],
  },
  {
    id: "events",
    label: "Events",
    permissions: [
      { id: "view_events", name: "View events", description: "See event calendar and details", actionKinds: ["view"] },
      { id: "add_events", name: "Add events", description: "Create events", actionKinds: ["add"] },
      { id: "edit_events", name: "Edit events", description: "Update event details", actionKinds: ["edit"] },
      { id: "delete_events", name: "Delete events", description: "Remove events", actionKinds: ["delete"] },
      {
        id: "assign_event_members",
        name: "Assign members to event roster",
        description:
          "Choose specific members to include on an event attendance roster (in addition to linked ministries). Organization owners always have this.",
        implies: ["view_members"],
        actionKinds: ["assign"],
      },
    ],
  },
  {
    id: "event_setup",
    label: "Event setup",
    permissions: [
      {
        id: "view_event_types",
        name: "View event types",
        description: "See event type presets",
        actionKinds: ["view"],
      },
      {
        id: "add_event_types",
        name: "Add event types",
        description: "Create event type presets",
        implies: ["view_event_types"],
        actionKinds: ["add"],
      },
      {
        id: "edit_event_types",
        name: "Edit event types",
        description: "Update event type presets",
        implies: ["view_event_types"],
        actionKinds: ["edit"],
      },
      {
        id: "delete_event_types",
        name: "Delete event types",
        description: "Remove event type presets",
        implies: ["view_event_types"],
        actionKinds: ["delete"],
      },
      {
        id: "add_program_templates",
        name: "Add program templates",
        description: "Create reusable program outlines",
        actionKinds: ["add"],
      },
      {
        id: "edit_program_templates",
        name: "Edit program templates",
        description: "Update reusable program outlines",
        actionKinds: ["edit"],
      },
      {
        id: "delete_program_templates",
        name: "Delete program templates",
        description: "Remove reusable program outlines",
        actionKinds: ["delete"],
      },
    ],
  },
  {
    id: "attendance",
    label: "Attendance",
    permissions: [
      {
        id: "view_event_attendance",
        name: "View event attendance",
        description: "See attendance rosters and recorded attendance",
        actionKinds: ["view"],
      },
      {
        id: "record_event_attendance",
        name: "Record event attendance",
        description: "Mark attendance for members at events",
        implies: ["view_event_attendance"],
        actionKinds: ["track"],
      },
    ],
  },
  {
    id: "messaging",
    label: "Messaging & notifications",
    permissions: [
      { id: "send_messages", name: "Send messages", description: "Use messaging to reach members", actionKinds: ["send"] },
      {
        id: "send_notifications",
        name: "Send notifications",
        description: "Trigger notification deliveries where applicable",
        actionKinds: ["send"],
      },
      {
        id: "configure_notifications",
        name: "Configure notifications",
        description: "Change notification templates and settings",
        actionKinds: ["configure"],
      },
    ],
  },
  {
    id: "analytics",
    label: "Reports",
    permissions: [
      { id: "view_analytics", name: "View analytics", description: "Access reports and analytics", actionKinds: ["view"] },
      { id: "export_data", name: "Export data", description: "Export data to files", actionKinds: ["export"] },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    permissions: [
      { id: "view_branches", name: "View branches", description: "See branch list", actionKinds: ["view"] },
      { id: "add_branches", name: "Add branches", description: "Create branches (organization owner rules still apply)", actionKinds: ["add"] },
      { id: "edit_branches", name: "Edit branches", description: "Update branch settings and timezone", actionKinds: ["edit"] },
      { id: "delete_branches", name: "Delete branches", description: "Remove branches (organization owner rules still apply)", actionKinds: ["delete"] },
      {
        id: "edit_organization_name",
        name: "Edit organization name",
        description: "Change the organization display name in Settings (organization owners always can)",
        actionKinds: ["edit"],
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    permissions: [
      {
        id: "view_roles",
        name: "View roles",
        description: "See roles and their permission assignments",
        actionKinds: ["view"],
      },
      {
        id: "add_roles",
        name: "Add roles",
        description: "Create new roles",
        implies: ["view_roles"],
        actionKinds: ["add"],
      },
      {
        id: "edit_roles",
        name: "Edit roles",
        description: "Rename roles and change which permissions they grant",
        implies: ["view_roles"],
        actionKinds: ["edit"],
      },
      {
        id: "delete_roles",
        name: "Delete roles",
        description: "Remove unused roles",
        implies: ["view_roles"],
        actionKinds: ["delete"],
      },
      {
        id: "assign_staff_roles",
        name: "Assign staff roles",
        description: "Change which role a staff member has",
        actionKinds: ["assign"],
      },
      {
        id: "view_staff",
        name: "View staff",
        description: "See staff directory and profiles in Settings",
        actionKinds: ["view"],
      },
      {
        id: "edit_staff_access",
        name: "Edit staff access",
        description: "Suspend or restore platform access for staff",
        implies: ["view_staff"],
        actionKinds: ["edit"],
      },
      {
        id: "view_staff_profile_groups",
        name: "View staff access groups",
        description: "See named staff access groups",
        implies: ["view_staff"],
        actionKinds: ["view"],
      },
      {
        id: "add_staff_profile_groups",
        name: "Add staff access groups",
        description: "Create staff access groups",
        implies: ["view_staff_profile_groups"],
        actionKinds: ["add"],
      },
      {
        id: "edit_staff_profile_groups",
        name: "Edit staff access groups",
        description: "Rename or reconfigure staff access groups and bulk membership",
        implies: ["view_staff_profile_groups"],
        actionKinds: ["edit"],
      },
      {
        id: "delete_staff_profile_groups",
        name: "Delete staff access groups",
        description: "Remove staff access groups",
        implies: ["view_staff_profile_groups"],
        actionKinds: ["delete"],
      },
      {
        id: "assign_staff_profile_groups",
        name: "Assign staff to access groups",
        description: "Add or remove individual staff from access groups",
        implies: ["view_staff_profile_groups"],
        actionKinds: ["assign"],
      },
      {
        id: "view_staff_ministry_scope",
        name: "View staff ministry scope",
        description: "See which ministries a staff member can access",
        implies: ["view_staff"],
        actionKinds: ["view"],
      },
      {
        id: "edit_staff_ministry_scope",
        name: "Edit staff ministry scope",
        description: "Change ministry visibility for staff",
        implies: ["view_staff_ministry_scope"],
        actionKinds: ["edit"],
      },
      {
        id: "system_settings",
        name: "System settings",
        description: "Access app settings (excluding roles and granular staff tools)",
        actionKinds: ["configure"],
      },
    ],
  },
];

export const ALL_PERMISSION_IDS: string[] = PERMISSION_CATALOG.flatMap((c) =>
  c.permissions.map((p) => p.id),
);

const ALLOWED = new Set(ALL_PERMISSION_IDS);

export function isValidPermissionId(id: string): boolean {
  return ALLOWED.has(id);
}

export function validatePermissionIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && isValidPermissionId(id)) out.push(id);
  }
  return [...new Set(out)];
}

/** Build a map: permission id -> all ids it transitively implies. */
const _impliesMap = new Map<string, string[]>();
for (const cat of PERMISSION_CATALOG) {
  for (const p of cat.permissions) {
    if (p.implies && p.implies.length > 0) _impliesMap.set(p.id, p.implies);
  }
}

/** Recursively resolve all implied permissions for a given set of checked ids. */
export function resolveImpliedPermissions(ids: Set<string>): Set<string> {
  const result = new Set(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    const implied = _impliesMap.get(id);
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

/**
 * Legacy bundled permission IDs stored in older roles.rows.permissions.
 * Expanded before `implies` resolution so unmigrated rows keep working.
 * @see ../../migrations/expand_legacy_role_permissions_to_atomic.sql to normalize the DB
 */
export const LEGACY_PERMISSION_ALIASES: Record<string, string[]> = {
  manage_member_notes: ["view_member_notes", "add_member_notes", "edit_member_notes", "delete_member_notes"],
  manage_events: ["add_events", "edit_events", "delete_events"],
  manage_families: ["add_families", "edit_families", "delete_families"],
  manage_groups: ["add_groups", "edit_groups", "archive_groups", "restore_groups", "purge_groups"],
  manage_member_tasks: [
    "add_member_tasks",
    "edit_member_tasks",
    "delete_member_tasks",
    "edit_member_task_checklist",
    "complete_member_task_checklist",
  ],
  manage_member_task_checklist: ["edit_member_task_checklist", "complete_member_task_checklist"],
  manage_group_tasks: [
    "add_group_tasks",
    "edit_group_tasks",
    "delete_group_tasks",
    "edit_group_task_checklist",
    "complete_group_task_checklist",
  ],
  manage_group_task_checklist: ["edit_group_task_checklist", "complete_group_task_checklist"],
  manage_event_types: ["view_event_types", "add_event_types", "edit_event_types", "delete_event_types"],
  manage_program_templates: ["add_program_templates", "edit_program_templates", "delete_program_templates"],
  track_attendance: ["view_event_attendance", "record_event_attendance"],
  manage_notifications: ["send_notifications", "configure_notifications"],
  manage_branches: ["add_branches", "edit_branches", "delete_branches"],
  manage_member_statuses: ["add_member_status_options", "edit_member_status_options", "delete_member_status_options"],
  manage_permissions: ["view_roles", "add_roles", "edit_roles", "delete_roles", "assign_staff_roles"],
  manage_staff: [
    "view_staff",
    "edit_staff_access",
    "view_staff_profile_groups",
    "add_staff_profile_groups",
    "edit_staff_profile_groups",
    "delete_staff_profile_groups",
    "assign_staff_profile_groups",
    "view_staff_ministry_scope",
    "edit_staff_ministry_scope",
    "assign_staff_roles",
  ],
  approve_member_requests: ["approve_member_requests", "reject_member_requests"],
  approve_group_requests: ["approve_group_requests", "reject_group_requests"],
};

export function expandStoredPermissionIds(raw: Set<string> | Iterable<string>): Set<string> {
  const base = new Set<string>();
  for (const id of raw) {
    const mapped = LEGACY_PERMISSION_ALIASES[id];
    // Only expand true legacy bundle ids, not current catalog atoms that also have an alias key.
    if (mapped && !isValidPermissionId(id)) for (const m of mapped) base.add(m);
    else base.add(id);
  }
  return resolveImpliedPermissions(base);
}
