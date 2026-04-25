# Permission matrix reference (as coded)

This table follows **[`permissionMatrixLayout.ts`](./permissionMatrixLayout.ts)** section order, resource rows, and **View / Add / Edit / Delete** columns. Descriptions come from **[`catalog.ts`](./catalog.ts)** (`PermissionDef.description`).

Some permissions are **not** literally “add” or “delete” in the API but are placed in that matrix column for layout (e.g. approve → **Add**, reject → **Delete**, import → **Add**). The **Catalog action kinds** column lists the real `actionKinds` from the catalog.

**Changes needed** is the **last column** (far right). Edit the cell on each row (between the final two `|` characters). Placeholder `—` means “nothing yet”—replace it with your notes.

| Section | Resource row | Matrix column | Permission ID | Catalog name | Catalog action kinds | What it does | Changes needed |
|--------|--------------|---------------|---------------|--------------|----------------------|--------------|------------------------|
| Dashboard | Dashboard | View | `view_dashboard` | View dashboard | view | Access dashboard and summary widgets | — |
| Members | Members | View | `view_members` | View members | view | See member list and profiles | — |
| Members | Members | Add | `add_members` | Add members | add | Create new member records | — |
| Members | Members | Edit | `edit_members` | Edit members | edit | Update member details | — |
| Members | Members | Delete | `delete_members` | Delete members | delete | Soft-delete or remove members | — |
| Members | Deleted members (list) | View | `view_deleted_members` | View deleted members | view | Open the deleted members list (soft-deleted records are often removed from ministry groups, so this is separate from viewing active members in your scope) | — |
| Members | Member import | Add | `import_members` | Import members | import | Run CSV member import with precheck, duplicate review, and commit | — |
| Members | Member notes | View | `view_member_notes` | View member notes | view | Read profile notes (text and voice) on a member | — |
| Members | Member notes | Add | `add_member_notes` | Add member notes | add | Create new profile notes and upload voice clips for new notes | — |
| Members | Member notes | Edit | `edit_member_notes` | Edit member notes | edit | Change text on existing profile notes | — |
| Members | Member notes | Delete | `delete_member_notes` | Delete member notes | delete | Remove profile notes | — |
| Members | Member requests | View | `view_member_requests` | View member requests | view | See pending registration requests | — |
| Members | Member requests | Add | `approve_member_requests` | Approve member requests | approve | Approve pending registration requests | — |
| Members | Member requests | Delete | `reject_member_requests` | Reject member requests | reject | Reject pending registration requests | — |
| Members | Member status labels | Add | `add_member_status_options` | Add member status labels | add | Create membership status options for member profiles | — |
| Members | Member status labels | Edit | `edit_member_status_options` | Edit member status labels | edit | Rename or reorder membership status options | — |
| Members | Member status labels | Delete | `delete_member_status_options` | Delete member status labels | delete | Remove membership status options | — |
| Members | Member tasks | View | `view_member_tasks` | View member tasks | view | See tasks on member profiles you can access (not branch-wide) | — |
| Members | Member tasks | Add | `add_member_tasks` | Add member tasks | add | Create follow-up tasks on member profiles | — |
| Members | Member tasks | Edit | `edit_member_tasks` | Edit member tasks | edit | Change title, assignees, status, due date, and related members on member tasks | — |
| Members | Member tasks | Delete | `delete_member_tasks` | Delete member tasks | delete | Remove follow-up tasks on member profiles | — |
| Members | Member tasks (monitor all) | View | `monitor_member_tasks` | Monitor member tasks | monitor, view | View all follow-up tasks assigned to staff in this branch (read-only) | — |
| Members | Member task control | Edit | `edit_member_task_checklist` | Member task control | edit | Add, remove, or rename checklist steps on member tasks | — |
| Members | Member task todo | Edit | `complete_member_task_checklist` | Member task todo | complete | Mark checklist items done and update task progress on your assignments | — |
| Tasks | Group tasks | View | `view_group_tasks` | View group tasks | view | See tasks on ministry/group pages you can access | — |
| Tasks | Group tasks | Add | `add_group_tasks` | Add group tasks | add | Create follow-up tasks on ministry/group pages | — |
| Tasks | Group tasks | Edit | `edit_group_tasks` | Edit group tasks | edit | Change title, assignees, status, due date, and related groups on group tasks | — |
| Tasks | Group tasks | Delete | `delete_group_tasks` | Delete group tasks | delete | Remove follow-up tasks on ministry/group pages | — |
| Tasks | Group tasks (monitor all) | View | `monitor_group_tasks` | Monitor group tasks | monitor, view | View all group follow-up tasks assigned to staff in this branch (read-only) | — |
| Tasks | Group task control | Edit | `edit_group_task_checklist` | Group task control | edit | Add, remove, or rename checklist steps on group tasks | — |
| Tasks | Group task todo | Edit | `complete_group_task_checklist` | Group task todo | complete | Mark checklist items done and update group task status on your assignments | — |
| Families | Families | View | `view_families` | View families | view | See family records | — |
| Families | Families | Add | `add_families` | Add families | add | Create family records | — |
| Families | Families | Edit | `edit_families` | Edit families | edit | Update family records | — |
| Families | Families | Delete | `delete_families` | Delete families | delete | Remove family records | — |
| Ministries & groups | Groups (ministries) | View | `view_groups` | View groups | view | See ministries and groups | — |
| Ministries & groups | Groups (ministries) | Add | `add_groups` | Add groups | add | Create ministries and groups | — |
| Ministries & groups | Groups (ministries) | Edit | `edit_groups` | Edit groups | edit | Update group details and settings | — |
| Ministries & groups | Groups (ministries) | Delete | `archive_groups` | Archive groups | delete | Soft-delete groups (move to trash) | — |
| Ministries & groups | Groups (trash) | Edit | `restore_groups` | Restore groups | edit | Restore groups from trash | — |
| Ministries & groups | Groups (trash) | Delete | `purge_groups` | Purge groups | delete | Permanently delete groups in trash | — |
| Ministries & groups | Group membership | Edit | `assign_groups` | Assign members to groups | assign | Add or remove group membership | — |
| Ministries & groups | Group type labels | Add | `add_group_type_options` | Add group type labels | add | Create group type picklist options | — |
| Ministries & groups | Group type labels | Edit | `edit_group_type_options` | Edit group type labels | edit | Rename or reorder group type options | — |
| Ministries & groups | Group type labels | Delete | `delete_group_type_options` | Delete group type labels | delete | Remove group type options | — |
| Ministries & groups | Group join requests | View | `view_group_requests` | View group join requests | view | See pending ministry join requests (without approving) | — |
| Ministries & groups | Group join requests | Add | `approve_group_requests` | Approve group requests | approve | Approve join requests to ministries | — |
| Ministries & groups | Group join requests | Delete | `reject_group_requests` | Reject group requests | reject | Reject or ignore join requests to ministries | — |
| Events & attendance | Events | View | `view_events` | View events | view | See event calendar and details | — |
| Events & attendance | Events | Add | `add_events` | Add events | add | Create events | — |
| Events & attendance | Events | Edit | `edit_events` | Edit events | edit | Update event details | — |
| Events & attendance | Events | Delete | `delete_events` | Delete events | delete | Remove events | — |
| Events & attendance | Event roster (assign members) | Edit | `assign_event_members` | Assign members to event roster | assign | Choose specific members to include on an event attendance roster (in addition to linked ministries). Organization owners always have this. | — |
| Events & attendance | Event types | View | `view_event_types` | View event types | view | See event type presets | — |
| Events & attendance | Event types | Add | `add_event_types` | Add event types | add | Create event type presets | — |
| Events & attendance | Event types | Edit | `edit_event_types` | Edit event types | edit | Update event type presets | — |
| Events & attendance | Event types | Delete | `delete_event_types` | Delete event types | delete | Remove event type presets | — |
| Events & attendance | Program templates | Add | `add_program_templates` | Add program templates | add | Create reusable program outlines | — |
| Events & attendance | Program templates | Edit | `edit_program_templates` | Edit program templates | edit | Update reusable program outlines | — |
| Events & attendance | Program templates | Delete | `delete_program_templates` | Delete program templates | delete | Remove reusable program outlines | — |
| Events & attendance | Event attendance | View | `view_event_attendance` | View event attendance | view | See attendance rosters and recorded attendance | — |
| Events & attendance | Event attendance | Edit | `record_event_attendance` | Record event attendance | track | Mark attendance for members at events | — |
| Messaging & notifications | Send messages | Add | `send_messages` | Send messages | send | Use messaging to reach members | — |
| Messaging & notifications | Notification settings | Edit | `configure_notifications` | Configure notifications | configure | Change notification templates and settings | — |
| Reports | Analytics | View | `view_analytics` | View analytics | view | Access reports and analytics | — |
| Reports | Data export | Edit | `export_data` | Export data | export | Export data to files | — |
| Organization | Branches | View | `view_branches` | View branches | view | See branch list | — |
| Organization | Branches | Add | `add_branches` | Add branches | add | Create branches (organization owner rules still apply) | — |
| Organization | Branches | Edit | `edit_branches` | Edit branches | edit | Update branch settings and timezone | — |
| Organization | Branches | Delete | `delete_branches` | Delete branches | delete | Remove branches (organization owner rules still apply) | — |
| Organization | Organization name | Edit | `edit_organization_name` | Edit organization name | edit | Change the organization display name in Settings (organization owners always can) | — |
| Administration | Roles | View | `view_roles` | View roles | view | See roles and their permission assignments | — |
| Administration | Roles | Add | `add_roles` | Add roles | add | Create new roles | — |
| Administration | Roles | Edit | `edit_roles` | Edit roles | edit | Rename roles and change which permissions they grant | — |
| Administration | Roles | Delete | `delete_roles` | Delete roles | delete | Remove unused roles | — |
| Administration | Assign staff roles | Edit | `assign_staff_roles` | Assign staff roles | assign | Change which role a staff member has | — |
| Administration | Staff | View | `view_staff` | View staff | view | See staff directory and profiles in Settings | — |
| Administration | Staff | Edit | `edit_staff_access` | Edit staff access | edit | Suspend or restore platform access for staff | — |
| Administration | Staff access groups | View | `view_staff_profile_groups` | View staff access groups | view | See named staff access groups | — |
| Administration | Staff access groups | Add | `add_staff_profile_groups` | Add staff access groups | add | Create staff access groups | — |
| Administration | Staff access groups | Edit | `edit_staff_profile_groups` | Edit staff access groups | edit | Rename or reconfigure staff access groups and bulk membership | — |
| Administration | Staff access groups | Delete | `delete_staff_profile_groups` | Delete staff access groups | delete | Remove staff access groups | — |
| Administration | Assign staff to access groups | Edit | `assign_staff_profile_groups` | Assign staff to access groups | assign | Add or remove individual staff from access groups | — |
| Administration | Staff ministry scope | View | `view_staff_ministry_scope` | View staff ministry scope | view | See which ministries a staff member can access | — |
| Administration | Staff ministry scope | Edit | `edit_staff_ministry_scope` | Edit staff ministry scope | edit | Change ministry visibility for staff | — |
| Administration | System settings | Edit | `system_settings` | System settings | configure | Access app settings (excluding roles and granular staff tools) | — |

---

## Row count

- **87** permission rows (one row per atomic permission in the matrix).

## Implied permissions (not separate rows)

The catalog defines `implies` edges (e.g. `delete_members` implies `view_deleted_members`). Those implied grants are still enforced in the app when you toggle permissions; they are not extra lines in this table.

## Source files

- Layout: [`permissionMatrixLayout.ts`](./permissionMatrixLayout.ts)
- Definitions: [`catalog.ts`](./catalog.ts)
