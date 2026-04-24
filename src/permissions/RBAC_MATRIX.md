# Atomic RBAC matrix (reference)

This doc summarizes where permissions are enforced after the atomic split. For the exact list of IDs, see `catalog.ts` and `atomicCanHelpers.ts`. Legacy bundle strings in the database are expanded at runtime (`expandStoredPermissionIds`) or via `migrations/expand_legacy_role_permissions_to_atomic.sql`.

## Database

| Store | Behavior |
|-------|----------|
| `roles.permissions` | Array of permission id strings. Prefer atomic ids; legacy `manage_*` / `track_attendance` are expanded in app and should be normalized by the migration. |
| Client `user.permissions` | Same strings; `usePermissions()` expands + resolves `implies`. |

## Server API (representative)

| Area | Typical `requirePermission` / `requireAnyPermission` |
|------|--------------------------------------------------------|
| Org roles CRUD | `view_roles`, `add_roles`, `edit_roles`, `delete_roles` |
| Staff / profile groups / ministry scope | `view_staff`, `edit_staff_access`, `assign_staff_roles`, `*_staff_profile_groups`, `*_staff_ministry_scope` |
| Members | `view_members`, `add_members`, `edit_members`, `delete_members`, `import_members`, notes perms, `view_deleted_members` |
| Families | `view_families`, `add_families`, `edit_families`, `delete_families` |
| Groups | `view_groups`, `add_groups`, `edit_groups`, `archive_groups`, `restore_groups`, `purge_groups` |
| Member / group tasks | `view_*_tasks`, `monitor_*_tasks`, `add_*_tasks`, `edit_*_tasks`, `delete_*_tasks`, `edit_*_task_checklist`, `complete_*_task_checklist` |
| Events | `view_events`, `add_events`, `edit_events`, `delete_events`, `assign_event_members` |
| Event types / program templates | `view_event_types`, add/edit/delete `event_types` / `program_templates` |
| Attendance (GET/PUT) | `view_event_attendance`, `record_event_attendance` (read vs write paths differ) |
| Custom fields, member status, group type options | Match `atomicCanHelpers` + `*_OPTION_WRITE` constants in `server.ts` |
| Requests | `view_*_requests`, `approve_*_requests`, `reject_*_requests` (separate) |
| Notifications QA | `configure_notifications` / `send_notifications` (routes); role admin surfaces use role/staff atomics |

Search `server.ts` for `requirePermission` / `requireAnyPermission` for the full set.

## Web UI

| Surface | Gating |
|---------|--------|
| Settings (route) | `canOpenSettings` (`atomicCanHelpers`) |
| Settings tabs | `canConfigure*`, `canAnyRoleAdmin`, `canViewOrEditEventTypesUi`, etc. |
| Events list actions | `add_events`, `edit_events`, `delete_events` |
| Task / member / group UIs | `canWrite*Tasks`, `canReshape*Checklist` |

## Mobile

| Area | Gating |
|------|--------|
| Tabs / lists | `usePermissions().can` + `atomicCanHelpers` for settings-shaped checks |
| Create event | `add_events` |
| Create task | `add_member_tasks` / `add_group_tasks` |
| Attendance edit | `record_event_attendance` (offline queue matches) |
| Reminders (local) | `view_event_attendance` or `record_event_attendance` (or legacy `track_attendance` in raw storage) |

## Smoke test (restrictive role)

1. **Migrate DB** (optional): run `expand_legacy_role_permissions_to_atomic.sql` on a copy first; re-login and confirm `GET /api/me` permissions look atomic.
2. Create a role with **only** `view_members` + `add_member_tasks` (no `edit_member_tasks`). Confirm: can add a task, cannot delete another’s task (unless assignee/creator rules allow).
3. Create a role with **only** `view_events` + `record_event_attendance` (not `add_events`). Confirm: can open attendance, cannot create an event.
4. Confirm Settings hidden unless `canOpenSettings` is true for that user.

## Rollback

There is no automatic SQL rollback. Restore a DB backup or re-assign roles from a export taken before the migration.
