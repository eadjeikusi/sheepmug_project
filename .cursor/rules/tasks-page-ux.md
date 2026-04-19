# Tasks page UX (reference for future work)

Applies when editing `Tasks.tsx`, `AssignTaskModal.tsx`, `AssignGroupTaskModal.tsx`.

1. **Create task** — Split/dropdown: **Member task** vs **Group task**; open the matching modal. Group flow needs a **ministry picker** when no `groupId` (Tasks page). Permission-gate each option (`manage_member_tasks` / `manage_group_tasks`).

2. **Branch-wide list — type filter** — Segmented **All | Member | Group** (not duplicate full tabs). Client-side filter on merged branch tasks; combine with search.

3. **Filter bar** — **Clean, modern** layout: clear hierarchy, one cohesive toolbar, generous spacing; avoid a cluttered grid of mismatched controls.

4. **Icons** — Use **lucide-react** for key filters to improve scanability (type, status, dates, assignee, search, refresh). Pair icons with **visible text** or **`aria-label` / `title`** — no icon-only primary actions without a tooltip/label.

5. **Copy** — Avoid redundant “branch + tasks” in headings; e.g. **Follow-ups in this branch**; search placeholder e.g. **Search follow-ups…**.

6. **Visual consistency** — Match existing app tokens (rounded-xl, borders, indigo accents) unless this screen intentionally pilots a new pattern.
