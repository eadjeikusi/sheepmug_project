# Notification features registry

Living document for **in-app**, **push** (Expo), and (planned) **email** notification behavior. When you add or change a notification, **append a new row** to the table below and note the date in the changelog.

## How to extend this doc

1. Add a row to **Implemented notifications** (or extend an existing row if the change is a variant).
2. For each channel, mark: **Yes** (implemented), **Planned**, or **—** (not applicable).
3. Record the `type` string stored in `notifications.type` (must match server code).
4. When email is implemented, add an **Email** column or a linked subsection per feature.

---

## Changelog

| Date       | Change |
| ---------- | ------ |
| 2026-04-18 | Registry started with **member/group assignment** (`member_assigned_group`); **pending join requests** (`pending_group_join_request`, `pending_member_join_request`) — in-app + push and deep links documented. |

---

## Implemented notifications

| Feature (user-facing) | `notifications.type` | Category (`notifications.category`) | In-app | Push | Email | Recipients | Trigger / notes |
| --------------------- | -------------------- | ----------------------------------- | ------ | ---- | ----- | ---------- | ----------------- |
| Member added to a ministry/group (assignee) | `member_assigned_group` | `assignments` | Yes | Yes | Planned | **Directory member** whose email matches a staff `profiles` row in the org (the person was linked to the group). | `POST /api/group-members`, `POST /api/group-members/bulk` after insert. Title: **Added to a group**. Message references the group display name. `action_path` targets the member profile. |
| Member added to a ministry/group (staff alert) | `member_assigned_group` | `assignments` | Yes | Yes | Planned | **Org owners** (`profiles.is_org_owner`), plus **staff** whose **ministry visibility** includes the target group: `profile_ministry_scope` roots expanded with subgroup descendants, and branch-wide **All Members** scope. The **actor** who performed the assignment is included unless they are only the assignee (self-add edge case). **Assignees** are excluded from this staff alert (they get the assignee copy above when applicable). | Same endpoints. Titles: **Member assigned to group** (single) or **Members assigned to group** (bulk). Bulk may use `action_path` with `?tab=members&highlight=…` for multiple adds. |
| New **group join** request (public join link) | `pending_group_join_request` | `requests` | Yes | Yes | Planned | **`approve_group_requests`** permission holders in the branch, **union** staff who **see that ministry** (same `profile_ministry_scope` expansion as assignment alerts), plus org owners. | `POST /api/group-requests` after insert (verified-member and legacy flows). Title: **New group join request**. `action_path`: `/groups/{groupId}?tab=requests` (web ministry **Requests** tab; mobile ministry with `tab=requests`). |
| New **member registration** request (public branch link) | `pending_member_join_request` | `requests` | Yes | Yes | Planned | Profiles with **`approve_member_requests`** or **`view_member_requests`** in the branch, plus org owners. | `POST /api/member-requests/public/:code` after insert. Title: **New member request**. `action_path`: `/members?tab=requests` (alias `/member-join-requests` on web). Mobile: `/member-join-requests`. |

### Preference keys (granular)

- Type `member_assigned_group` uses granular preference key **`member_assigned`** (see `granularKeyForType` in `server.ts`).
- Category column for prefs: **`assignments_enabled`** (assignments category).
- Pending group join: granular key **`group_join_request`**; pending member request: **`member_request`**. Category: **`requests_enabled`**.

### Implementation references

- Server: `createNotification`, `createNotificationsForRecipients`, `profileIdsStaffWhoSeeMinistryGroup` — `server.ts`
- Push: Expo after successful insert when `profiles.expo_push_token` is set for the recipient.
- Clients: web `NotificationContext`, mobile `apps/mobile/contexts/NotificationContext.tsx`; list via `GET /api/notifications`.

---

## Planned (not yet documented in table rows)

- **Email** channel: add a column or separate matrix when the first email notification ships; mirror the same `type` / templates where possible.
