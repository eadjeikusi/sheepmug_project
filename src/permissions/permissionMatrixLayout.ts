/**
 * UI layout for Settings → Roles & permissions matrix.
 * Every catalog permission appears in exactly one cell (View / Add / Edit / Delete).
 * Rows are ordered logically within each section (e.g. core Members first, then related member capabilities).
 */

import { ALL_PERMISSION_IDS, validatePermissionIds } from './catalog';

export type CrudKey = 'view' | 'add' | 'edit' | 'delete';

export const CRUD_COLUMNS: { key: CrudKey; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'add', label: 'Add' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
];

export type PermissionMatrixRow = {
  rowId: string;
  label: string;
  cells: Partial<Record<CrudKey, string>>;
};

export type PermissionMatrixSection = {
  id: string;
  title: string;
  /** Explicit order — not re-sorted */
  matrixRows: PermissionMatrixRow[];
};

/**
 * Column mapping for non-CRUD verbs (single best fit for the four headers):
 * - approve → Add, reject → Delete, assign/configure/import/export/monitor/complete/track/send → see row comments
 */
const RAW_SECTIONS: PermissionMatrixSection[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    matrixRows: [
      {
        rowId: 'dashboard',
        label: 'Dashboard',
        cells: { view: 'view_dashboard' },
      },
    ],
  },
  {
    id: 'members',
    title: 'Members',
    matrixRows: [
      {
        rowId: 'members-directory',
        label: 'Members',
        cells: {
          view: 'view_members',
          add: 'add_members',
          edit: 'edit_members',
          delete: 'delete_members',
        },
      },
      {
        rowId: 'members-deleted-list',
        label: 'Deleted members (list)',
        cells: { view: 'view_deleted_members' },
      },
      {
        rowId: 'members-import',
        label: 'Member import',
        cells: { add: 'import_members' },
      },
      {
        rowId: 'member-notes',
        label: 'Member notes',
        cells: {
          view: 'view_member_notes',
          add: 'add_member_notes',
          edit: 'edit_member_notes',
          delete: 'delete_member_notes',
        },
      },
      {
        rowId: 'member-requests',
        label: 'Member requests',
        cells: {
          view: 'view_member_requests',
          add: 'approve_member_requests',
          delete: 'reject_member_requests',
        },
      },
      {
        rowId: 'member-status-labels',
        label: 'Member status labels',
        cells: {
          add: 'add_member_status_options',
          edit: 'edit_member_status_options',
          delete: 'delete_member_status_options',
        },
      },
      {
        rowId: 'member-tasks',
        label: 'Member tasks',
        cells: {
          view: 'view_member_tasks',
          add: 'add_member_tasks',
          edit: 'edit_member_tasks',
          delete: 'delete_member_tasks',
        },
      },
      {
        rowId: 'member-tasks-monitor',
        label: 'Member tasks (monitor all)',
        cells: { view: 'monitor_member_tasks' },
      },
      {
        rowId: 'member-task-checklist-structure',
        label: 'Member task control',
        cells: { edit: 'edit_member_task_checklist' },
      },
      {
        rowId: 'member-task-checklist-complete',
        label: 'Member task todo',
        cells: { edit: 'complete_member_task_checklist' },
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    matrixRows: [
      {
        rowId: 'group-tasks',
        label: 'Group tasks',
        cells: {
          view: 'view_group_tasks',
          add: 'add_group_tasks',
          edit: 'edit_group_tasks',
          delete: 'delete_group_tasks',
        },
      },
      {
        rowId: 'group-tasks-monitor',
        label: 'Group tasks (monitor all)',
        cells: { view: 'monitor_group_tasks' },
      },
      {
        rowId: 'group-task-checklist-structure',
        label: 'Group task control',
        cells: { edit: 'edit_group_task_checklist' },
      },
      {
        rowId: 'group-task-checklist-complete',
        label: 'Group task todo',
        cells: { edit: 'complete_group_task_checklist' },
      },
    ],
  },
  {
    id: 'families',
    title: 'Families',
    matrixRows: [
      {
        rowId: 'families',
        label: 'Families',
        cells: {
          view: 'view_families',
          add: 'add_families',
          edit: 'edit_families',
          delete: 'delete_families',
        },
      },
    ],
  },
  {
    id: 'groups',
    title: 'Ministries & groups',
    matrixRows: [
      {
        rowId: 'groups-ministries',
        label: 'Groups (ministries)',
        cells: {
          view: 'view_groups',
          add: 'add_groups',
          edit: 'edit_groups',
          delete: 'archive_groups',
        },
      },
      {
        rowId: 'groups-trash',
        label: 'Groups (trash)',
        cells: {
          edit: 'restore_groups',
          delete: 'purge_groups',
        },
      },
      {
        rowId: 'group-membership',
        label: 'Group membership',
        cells: { edit: 'assign_groups' },
      },
      {
        rowId: 'ministry-leader-formal',
        label: 'Ministry leader (formal)',
        cells: { edit: 'assign_ministry_leaders' },
      },
      {
        rowId: 'group-type-labels',
        label: 'Group type labels',
        cells: {
          add: 'add_group_type_options',
          edit: 'edit_group_type_options',
          delete: 'delete_group_type_options',
        },
      },
      {
        rowId: 'group-join-requests',
        label: 'Group join requests',
        cells: {
          view: 'view_group_requests',
          add: 'approve_group_requests',
          delete: 'reject_group_requests',
        },
      },
    ],
  },
  {
    id: 'events_and_attendance',
    title: 'Events & attendance',
    matrixRows: [
      {
        rowId: 'events',
        label: 'Events',
        cells: {
          view: 'view_events',
          add: 'add_events',
          edit: 'edit_events',
          delete: 'delete_events',
        },
      },
      {
        rowId: 'event-roster',
        label: 'Event roster (assign members)',
        cells: { edit: 'assign_event_members' },
      },
      {
        rowId: 'event-types',
        label: 'Event types',
        cells: {
          view: 'view_event_types',
          add: 'add_event_types',
          edit: 'edit_event_types',
          delete: 'delete_event_types',
        },
      },
      {
        rowId: 'program-templates',
        label: 'Program templates',
        cells: {
          add: 'add_program_templates',
          edit: 'edit_program_templates',
          delete: 'delete_program_templates',
        },
      },
      {
        rowId: 'event-attendance',
        label: 'Event attendance',
        cells: {
          view: 'view_event_attendance',
          edit: 'record_event_attendance',
        },
      },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging & notifications',
    matrixRows: [
      {
        rowId: 'send-messages',
        label: 'Send messages',
        cells: { add: 'send_messages' },
      },
      {
        rowId: 'notification-settings',
        label: 'Notification settings',
        cells: { edit: 'configure_notifications' },
      },
    ],
  },
  {
    id: 'analytics',
    title: 'Reports',
    matrixRows: [
      {
        rowId: 'analytics',
        label: 'Analytics',
        cells: { view: 'view_analytics' },
      },
      {
        rowId: 'data-export',
        label: 'Data export',
        cells: { edit: 'export_data' },
      },
    ],
  },
  {
    id: 'organization',
    title: 'Organization',
    matrixRows: [
      {
        rowId: 'branches',
        label: 'Branches',
        cells: {
          view: 'view_branches',
          add: 'add_branches',
          edit: 'edit_branches',
          delete: 'delete_branches',
        },
      },
      {
        rowId: 'organization-name',
        label: 'Organization name',
        cells: { edit: 'edit_organization_name' },
      },
      {
        rowId: 'subscription',
        label: 'Subscription',
        cells: { edit: 'manage_subscription' },
      },
    ],
  },
  {
    id: 'administration',
    title: 'Administration',
    matrixRows: [
      {
        rowId: 'roles',
        label: 'Roles',
        cells: {
          view: 'view_roles',
          add: 'add_roles',
          edit: 'edit_roles',
          delete: 'delete_roles',
        },
      },
      {
        rowId: 'assign-staff-roles',
        label: 'Assign staff roles',
        cells: { edit: 'assign_staff_roles' },
      },
      {
        rowId: 'staff',
        label: 'Staff',
        cells: {
          view: 'view_staff',
          edit: 'edit_staff_access',
        },
      },
      {
        rowId: 'staff-access-groups',
        label: 'Staff access groups',
        cells: {
          view: 'view_staff_profile_groups',
          add: 'add_staff_profile_groups',
          edit: 'edit_staff_profile_groups',
          delete: 'delete_staff_profile_groups',
        },
      },
      {
        rowId: 'assign-staff-access-groups',
        label: 'Assign staff to access groups',
        cells: { edit: 'assign_staff_profile_groups' },
      },
      {
        rowId: 'staff-ministry-scope',
        label: 'Staff ministry scope',
        cells: {
          view: 'view_staff_ministry_scope',
          edit: 'edit_staff_ministry_scope',
        },
      },
      {
        rowId: 'system-settings',
        label: 'System settings',
        cells: { edit: 'system_settings' },
      },
    ],
  },
];

export const PERMISSION_MATRIX_SECTIONS: PermissionMatrixSection[] = RAW_SECTIONS;

/** All assignable permission ids for a matrix section, in a stable order (row order, then view → add → edit → delete). */
export function getMatrixSectionPermissionIds(sectionId: string): string[] {
  const sec = PERMISSION_MATRIX_SECTIONS.find((s) => s.id === sectionId);
  if (!sec) return [];
  const raw: string[] = [];
  for (const row of sec.matrixRows) {
    for (const col of CRUD_COLUMNS) {
      const id = row.cells[col.key];
      if (id) raw.push(id);
    }
  }
  return validatePermissionIds(raw);
}

const _catalogSet = new Set(ALL_PERMISSION_IDS);

function collectLayoutIds(): Set<string> {
  const out = new Set<string>();
  for (const sec of PERMISSION_MATRIX_SECTIONS) {
    for (const row of sec.matrixRows) {
      for (const col of CRUD_COLUMNS) {
        const id = row.cells[col.key];
        if (id) out.add(id);
      }
    }
  }
  return out;
}

if (import.meta.env?.DEV) {
  const layoutIds = collectLayoutIds();
  for (const id of ALL_PERMISSION_IDS) {
    if (!layoutIds.has(id)) {
      // eslint-disable-next-line no-console -- dev-only coverage guard
      console.warn('[permissionMatrixLayout] catalog id missing from matrix layout:', id);
    }
  }
  for (const id of layoutIds) {
    if (!_catalogSet.has(id)) {
      // eslint-disable-next-line no-console -- dev-only coverage guard
      console.warn('[permissionMatrixLayout] layout references unknown id:', id);
    }
  }
  if (layoutIds.size !== ALL_PERMISSION_IDS.length) {
    // eslint-disable-next-line no-console -- dev-only coverage guard
    console.warn('[permissionMatrixLayout] layout count', layoutIds.size, 'catalog', ALL_PERMISSION_IDS.length);
  }
}
