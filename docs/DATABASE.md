# Database documentation

> Consolidated project docs: `docs/PROJECT_DOCUMENTATION.md`

## Canonical structure export

The file **`app_database strucure.txt`** (in this folder) is a **human-readable snapshot** of the live Supabase schema as maintained in your project. *(The filename uses the historical spelling “strucure”; renaming to `app_database_structure.txt` is optional.)*

Each row describes one **column × RLS policy** combination (the same physical column appears multiple times when several policies apply).

| Column in the export | Meaning |
| -------------------- | ------- |
| `table_name` | Postgres table. |
| `column_name` | Column on that table. |
| `data_type` | Declared type. |
| `is_nullable` | `YES` / `NO`. |
| `column_description` | Supabase column comment / notes (when set). |
| `rls_policy_name` | Name of the Row Level Security policy. |
| `rls_event` | Policy command: `SELECT`, `INSERT`, `UPDATE`, `ALL`, etc. |
| `rls_definition` | Policy `USING` / `WITH CHECK` expression (abbreviated in export). |

Use this file to **discover** tables, columns, and RLS surface area. It is **not** a migration script: row order and duplication reflect the export format, not DDL execution order.

## Executable changes (migrations)

Folder **`/migrations`** at the repo root holds **SQL snippets** you run in the Supabase SQL editor (or your migration runner) to change the database. These are the **authoritative steps** for reproducing schema changes on another environment.

Examples of what lives there:

- `event_attachments.sql` — `events.attachments` (`jsonb`) for event file metadata.
- `event_groups.sql`, `event_assigned_members.sql` — event ↔ ministry ↔ member links.
- `groups_soft_delete.sql` — soft delete columns on `groups`.
- `groups_join_invite_token.sql` — opaque per-group token for `/join-group/:token` (still supports UUID).
- Other fixes and additive columns as named in each file.

After you run new SQL in Supabase, refresh **`docs/app_database strucure.txt`** so the dump stays aligned with production (or your staging) schema.

## Suggested workflow

1. **Implement a schema change** — Prefer adding a file under `migrations/` and running it, so the change is versioned.
2. **Apply** in Supabase (SQL editor or CI).
3. **Re-export** the structure you used (`app_database strucure.txt`) when you want docs and repo to match.
4. **API / app** — Update `server.ts` and the client if new columns or shapes are required (see comments in migration files and code).

## Notes for AI / contributors

- RLS in the export is **per policy**; infer access by reading all rows for a given `table_name` + `column_name`.
- The Node server often uses **`supabaseAdmin`** (service role), which **bypasses RLS**; policies still matter for direct client access to Supabase.
- Storage paths for event files: bucket **`member-images`**, prefix **`event-files/`**; downloads go through **`GET /api/download-event-file`** (see `server.ts`).
