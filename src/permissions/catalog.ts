/**
 * Canonical permission IDs for org RBAC. Stable — do not rename without a migration path.
 */

export type PermissionDef = {
  id: string;
  name: string;
  description: string;
  implies?: string[];
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
      { id: "view_dashboard", name: "View dashboard", description: "Access dashboard and summary widgets" },
    ],
  },
  {
    id: "members",
    label: "Members",
    permissions: [
      { id: "view_members", name: "View members", description: "See member list and profiles" },
      { id: "add_members", name: "Add members", description: "Create new member records" },
      { id: "edit_members", name: "Edit members", description: "Update member details" },
      {
        id: "import_members",
        name: "Import members",
        description: "Run CSV member import with precheck, duplicate review, and commit",
      },
      {
        id: "manage_member_statuses",
        name: "Manage member statuses",
        description: "Configure membership status labels (active, transferred, etc.) used on member profiles",
      },
      {
        id: "view_deleted_members",
        name: "View deleted members",
        description: "Open the deleted members list (soft-deleted records are often removed from ministry groups, so this is separate from viewing active members in your scope)",
      },
      {
        id: "delete_members",
        name: "Delete members",
        description: "Soft-delete or remove members",
        implies: ["view_deleted_members"],
      },
      {
        id: "view_member_notes",
        name: "View member notes",
        description: "Read profile notes (text and voice) on a member; implied if Add, Edit, or Delete member notes is granted",
      },
      {
        id: "add_member_notes",
        name: "Add member notes",
        description: "Create new profile notes and upload voice clips for new notes",
      },
      {
        id: "edit_member_notes",
        name: "Edit member notes",
        description: "Change text on existing profile notes",
      },
      {
        id: "delete_member_notes",
        name: "Delete member notes",
        description: "Remove profile notes",
      },
      {
        id: "manage_member_notes",
        name: "Manage member notes (full access)",
        description:
          "Shorthand: view, add, edit, and delete all member notes. Use for coordinator roles; use the four permissions above for fine-grained control.",
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
        description:
          "See tasks assigned to you and follow-up tasks on member profiles you can access (not branch-wide). Also grants View group tasks.",
        implies: ["view_group_tasks"],
      },
      {
        id: "monitor_member_tasks",
        name: "Monitor member tasks",
        description:
          "View all follow-up tasks assigned to staff in this branch for oversight (read-only)",
        implies: ["view_member_tasks"],
      },
      {
        id: "manage_member_tasks",
        name: "Manage member tasks",
        description:
          "Create, assign, edit, or delete follow-up tasks on member profiles; includes branch task list access",
        implies: ["view_member_tasks", "manage_member_task_checklist", "complete_member_task_checklist"],
      },
      {
        id: "manage_member_task_checklist",
        name: "Manage task checklist (todos)",
        description: "Add, remove, or rename checklist steps on member tasks",
        implies: ["complete_member_task_checklist"],
      },
      {
        id: "complete_member_task_checklist",
        name: "Complete checklist items & task progress",
        description: "Mark checklist items done and update task status on your assignments",
      },
      {
        id: "view_group_tasks",
        name: "View group tasks",
        description:
          "See tasks assigned to you and follow-up tasks on ministry/group pages (not branch-wide)",
      },
      {
        id: "monitor_group_tasks",
        name: "Monitor group tasks",
        description:
          "View all group follow-up tasks assigned to staff in this branch for oversight (read-only)",
        implies: ["view_group_tasks"],
      },
      {
        id: "manage_group_tasks",
        name: "Manage group tasks",
        description:
          "Create, assign, edit, or delete follow-up tasks on ministry/group pages; includes branch task list access",
        implies: ["view_group_tasks", "manage_group_task_checklist", "complete_group_task_checklist"],
      },
      {
        id: "manage_group_task_checklist",
        name: "Manage group task checklist",
        description: "Add, remove, or rename checklist steps on group tasks",
        implies: ["complete_group_task_checklist"],
      },
      {
        id: "complete_group_task_checklist",
        name: "Complete group checklist items",
        description: "Mark checklist items done and update group task status on your assignments",
      },
    ],
  },
  {
    id: "member_requests",
    label: "Member requests",
    permissions: [
      { id: "view_member_requests", name: "View member requests", description: "See pending registration requests" },
      { id: "approve_member_requests", name: "Approve / reject member requests", description: "Approve or reject join requests" },
    ],
  },
  {
    id: "families",
    label: "Families",
    permissions: [
      { id: "view_families", name: "View families", description: "See family records" },
      { id: "manage_families", name: "Manage families", description: "Create, edit, or delete families" },
    ],
  },
  {
    id: "groups",
    label: "Ministries & groups",
    permissions: [
      { id: "view_groups", name: "View groups", description: "See ministries and groups" },
      { id: "manage_groups", name: "Manage groups", description: "Create, edit, archive, restore, purge groups" },
      { id: "assign_groups", name: "Assign members to groups", description: "Add or remove group membership" },
      {
        id: "view_group_requests",
        name: "View group join requests",
        description: "See pending ministry join requests (without approving)",
      },
      {
        id: "approve_group_requests",
        name: "Approve group requests",
        description: "Handle join requests to ministries",
        implies: ["view_group_requests"],
      },
    ],
  },
  {
    id: "events",
    label: "Events",
    permissions: [
      { id: "view_events", name: "View events", description: "See event calendar and details" },
      { id: "manage_events", name: "Manage events", description: "Create, edit, or delete events" },
      {
        id: "assign_event_members",
        name: "Assign members to event roster",
        description:
          "Choose specific members to include on an event attendance roster (in addition to linked ministries). Organization owners always have this.",
        implies: ["view_members"],
      },
    ],
  },
  {
    id: "event_setup",
    label: "Event setup",
    permissions: [
      { id: "manage_event_types", name: "Manage event types", description: "Configure event type presets" },
      { id: "manage_program_templates", name: "Manage program templates", description: "Edit reusable program outlines" },
    ],
  },
  {
    id: "attendance",
    label: "Attendance",
    permissions: [
      { id: "track_attendance", name: "Track attendance", description: "View and record event attendance" },
    ],
  },
  {
    id: "messaging",
    label: "Messaging & notifications",
    permissions: [
      { id: "send_messages", name: "Send messages", description: "Use messaging to reach members" },
      { id: "manage_notifications", name: "Manage notifications", description: "Send or configure notifications" },
    ],
  },
  {
    id: "analytics",
    label: "Reports",
    permissions: [
      { id: "view_analytics", name: "View analytics", description: "Access reports and analytics" },
      { id: "export_data", name: "Export data", description: "Export data to files" },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    permissions: [
      { id: "view_branches", name: "View branches", description: "See branch list" },
      { id: "manage_branches", name: "Manage branches", description: "Create or edit branches" },
      {
        id: "edit_organization_name",
        name: "Edit organization name",
        description: "Change the organization display name in Settings (organization owners always can)",
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    permissions: [
      { id: "manage_permissions", name: "Manage roles & permissions", description: "Create roles and assign permissions" },
      { id: "manage_staff", name: "Manage staff accounts", description: "Provision staff logins and assign roles" },
      { id: "system_settings", name: "System settings", description: "Access app settings (excluding roles)" },
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
