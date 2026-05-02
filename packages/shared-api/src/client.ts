import type {
  AppNotification,
  AuthSessionPayload,
  AuthUser,
  Branch,
  CustomFieldDefinition,
  Family,
  EventAttendanceRow,
  EventItem,
  EventTypeRow,
  EventUpsertPayload,
  Group,
  GroupTypeOption,
  GroupMemberItem,
  GroupRequestItem,
  Member,
  MemberEventItem,
  MemberImportantDate,
  MemberNote,
  MemberStatusOption,
  NotificationPreferences,
  ReportDefinition,
  ReportExportResponse,
  ReportFilterPayload,
  ReportGeneratedPayload,
  ReportHistoryTableRow,
  ReportRun,
  ReportSummaryResponse,
  ReportType,
  TaskItem,
  UpcomingImportantDateItem,
} from "./types";

type TokenProvider = () => string | null;
type BranchProvider = () => string | null;
type RefreshTokenProvider = () => string | null;
type AuthTokensHandler = (tokens: { token: string; refreshToken?: string | null }) => void | Promise<void>;
type AuthFailureHandler = (reason: "unauthorized" | "refresh_failed") => void | Promise<void>;

interface ApiClientOptions {
  baseUrl: string;
  getToken?: TokenProvider;
  getBranchId?: BranchProvider;
  getRefreshToken?: RefreshTokenProvider;
  onAuthTokens?: AuthTokensHandler;
  onAuthFailure?: AuthFailureHandler;
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status = 500, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || "").trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const getToken = options.getToken ?? (() => null);
  const getBranchId = options.getBranchId ?? (() => null);
  const getRefreshToken = options.getRefreshToken ?? (() => null);
  const onAuthTokens = options.onAuthTokens;
  const onAuthFailure = options.onAuthFailure;
  let inFlightRefresh: Promise<string | null> | null = null;

  async function requestRaw(path: string, init: RequestInit = {}, tokenOverride?: string | null) {
    const token = tokenOverride === undefined ? getToken() : tokenOverride;
    const branchId = getBranchId();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { "X-Branch-Id": branchId } : {}),
      ...((init.headers as Record<string, string> | undefined) || {}),
    };

    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(15000)
      : undefined;
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: init.signal ?? signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (inFlightRefresh) return inFlightRefresh;
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    inFlightRefresh = (async () => {
      try {
        const { response, payload } = await requestRaw(
          "/api/auth/refresh",
          {
            method: "POST",
            body: JSON.stringify({ refresh_token: refreshToken }),
          },
          null
        );
        if (response.status === 403) {
          const msg =
            typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : "Access denied for this account.";
          throw new ApiError(msg, 403, payload);
        }
        if (!response.ok || typeof (payload as { token?: unknown }).token !== "string") {
          return null;
        }
        const nextToken = (payload as { token: string }).token;
        const nextRefreshToken =
          typeof (payload as { refresh_token?: unknown }).refresh_token === "string"
            ? ((payload as { refresh_token: string }).refresh_token || null)
            : refreshToken;
        if (onAuthTokens) {
          await onAuthTokens({ token: nextToken, refreshToken: nextRefreshToken });
        }
        return nextToken;
      } catch {
        return null;
      } finally {
        inFlightRefresh = null;
      }
    })();
    return inFlightRefresh;
  }

  async function request<T>(path: string, init: RequestInit = {}, hasRetried = false): Promise<T> {
    const { response, payload } = await requestRaw(path, init);

    if (
      response.status === 401 &&
      !hasRetried &&
      path !== "/api/auth/refresh" &&
      path !== "/api/auth/login"
    ) {
      let refreshedToken: string | null = null;
      try {
        refreshedToken = await refreshAccessToken();
      } catch (refreshError) {
        if (refreshError instanceof ApiError && refreshError.status === 403) {
          if (onAuthFailure) {
            await onAuthFailure("unauthorized");
          }
          throw refreshError;
        }
        throw refreshError;
      }
      if (refreshedToken) {
        return request<T>(path, init, true);
      }
      if (onAuthFailure) {
        await onAuthFailure("refresh_failed");
      }
      throw new ApiError("Session expired. Please log in again.", 401, payload);
    }

    if (!response.ok) {
      const message =
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `Request failed (${response.status})`;
      if (response.status === 401 && onAuthFailure) {
        await onAuthFailure("unauthorized");
      }
      throw new ApiError(message, response.status, payload);
    }

    return payload as T;
  }

  function parseMembersListPayload(payload: unknown): { members: Member[]; total_count: number } {
    if (Array.isArray(payload)) {
      return { members: payload as Member[], total_count: payload.length };
    }
    const o = payload as { members?: Member[]; total_count?: unknown };
    const members = Array.isArray(o.members) ? o.members : [];
    const total_count = typeof o.total_count === "number" ? o.total_count : members.length;
    return { members, total_count };
  }

  function parseEventsListPayload(payload: unknown): { events: EventItem[]; total_count: number } {
    if (Array.isArray(payload)) {
      return { events: payload as EventItem[], total_count: payload.length };
    }
    const o = payload as { events?: EventItem[]; total_count?: unknown };
    const events = Array.isArray(o.events) ? o.events : [];
    const total_count = typeof o.total_count === "number" ? o.total_count : events.length;
    return { events, total_count };
  }

  function parseTasksListPayload(payload: unknown): { tasks: TaskItem[]; total_count: number } {
    if (Array.isArray(payload)) {
      return { tasks: payload as TaskItem[], total_count: payload.length };
    }
    const o = payload as { tasks?: TaskItem[]; total_count?: unknown };
    const tasks = Array.isArray(o.tasks) ? o.tasks : [];
    const total_count = typeof o.total_count === "number" ? o.total_count : tasks.length;
    return { tasks, total_count };
  }

  return {
    auth: {
      login: (email: string, password: string) =>
        request<AuthSessionPayload>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      refresh: (refreshToken: string) =>
        request<AuthSessionPayload>("/api/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refreshToken }),
        }),
      me: () => request<{ user: AuthUser }>("/api/auth/me"),
      updateProfile: (body: {
        first_name?: string;
        last_name?: string;
        email?: string;
        profile_image?: string | null;
      }) =>
        request<{ user: AuthUser }>("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
    },

    branches: {
      list: async () => {
        const payload = await request<Branch[] | { branches?: Branch[] }>("/api/branches");
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.branches) ? payload.branches : [];
      },
      update: (id: string, body: Partial<Pick<Branch, "name" | "timezone" | "important_dates_default_reminder_time">> & {
        is_active?: boolean;
      }) =>
        request<Branch>(`/api/branches/${id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      updateTimezone: (
        id: string,
        body: { timezone: string; important_dates_default_reminder_time?: string | null },
      ) =>
        request<Branch>(`/api/branches/${id}/timezone`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
    },

    /** Staff profiles for task assignee pickers (`GET /api/org/staff`). */
    org: {
      staff: async () => {
        const payload = await request<{
          staff?: {
            id: string;
            email: string | null;
            first_name: string | null;
            last_name: string | null;
            branch_id: string | null;
          }[];
        }>("/api/org/staff");
        return Array.isArray(payload.staff) ? payload.staff : [];
      },
    },

    dashboard: {
      recentMembers: async (params?: { limit?: number }) => {
        const qs = new URLSearchParams();
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const q = qs.toString();
        const payload = await request<{ mode?: string; members?: Member[] }>(
          `/api/dashboard/recent-members${q ? `?${q}` : ""}`
        );
        const mode =
          payload.mode === "new_members" || payload.mode === "group_assignments" ? payload.mode : "group_assignments";
        return { mode, members: Array.isArray(payload.members) ? payload.members : [] };
      },
    },

    importantDates: {
      upcoming: async (params?: { range_days?: number; q?: string }) => {
        const qs = new URLSearchParams();
        if (typeof params?.range_days === "number" && Number.isFinite(params.range_days)) {
          qs.set("range_days", String(Math.max(1, Math.min(366, Math.floor(params.range_days)))));
        }
        if (typeof params?.q === "string" && params.q.trim()) {
          qs.set("q", params.q.trim());
        }
        const payload = await request<
          UpcomingImportantDateItem[] | { items?: UpcomingImportantDateItem[] }
        >(`/api/important-dates/upcoming${qs.toString() ? `?${qs.toString()}` : ""}`);
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.items) ? payload.items : [];
      },
    },

    members: {
      list: async (params?: {
        include_deleted?: boolean;
        /** When true, only soft-deleted (trash) members; implies include_deleted. */
        deleted_only?: boolean;
        not_in_group_id?: string;
        offset?: number;
        limit?: number;
      }) => {
        const qs = new URLSearchParams();
        if (typeof params?.include_deleted === "boolean") {
          qs.set("include_deleted", params.include_deleted ? "true" : "false");
        }
        if (params?.deleted_only === true) {
          qs.set("deleted_only", "true");
        }
        if (params?.not_in_group_id) qs.set("not_in_group_id", params.not_in_group_id);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<Member[] | { members?: Member[]; total_count?: number }>(
          `/api/members${query ? `?${query}` : ""}`
        );
        return parseMembersListPayload(payload);
      },
      get: async (memberId: string) => {
        const payload = await request<Member | { member?: Member }>(
          `/api/members/${encodeURIComponent(memberId)}`
        );
        if (payload && typeof payload === "object" && "member" in payload && (payload as { member?: Member }).member) {
          return (payload as { member: Member }).member;
        }
        return payload as Member;
      },
      create: async (body: Record<string, unknown>) => {
        const payload = await request<Member | { member?: Member }>("/api/members", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (payload && typeof payload === "object" && "member" in payload && (payload as { member?: Member }).member) {
          return (payload as { member: Member }).member;
        }
        return payload as Member;
      },
      update: async (memberId: string, body: Record<string, unknown>) => {
        const payload = await request<Member | { member?: Member }>(
          `/api/members/${encodeURIComponent(memberId)}`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          }
        );
        if (payload && typeof payload === "object" && "member" in payload && (payload as { member?: Member }).member) {
          return (payload as { member: Member }).member;
        }
        return payload as Member;
      },
      remove: async (memberId: string) => {
        await request<{ message?: string; error?: string }>(
          `/api/members/${encodeURIComponent(memberId)}`,
          { method: "DELETE" }
        );
      },
      /** Permanently remove soft-deleted members (trash). Requires `delete_members`. */
      batchPurge: async (memberIds: string[]) => {
        return request<{ purged: number; errors?: string[] }>("/api/members/batch-purge", {
          method: "POST",
          body: JSON.stringify({ ids: memberIds }),
        });
      },
      groups: async (memberId: string) => {
        const payload = await request<Group[] | { groups?: Group[] }>(
          `/api/members/${encodeURIComponent(memberId)}/groups`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.groups) ? payload.groups : [];
      },
      events: async (memberId: string) => {
        const payload = await request<MemberEventItem[] | { events?: MemberEventItem[] }>(
          `/api/members/${encodeURIComponent(memberId)}/events?limit=200&offset=0`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.events) ? payload.events : [];
      },
      tasks: async (memberId: string) => {
        const payload = await request<TaskItem[] | { tasks?: TaskItem[] }>(
          `/api/members/${encodeURIComponent(memberId)}/tasks`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.tasks) ? payload.tasks : [];
      },
      notes: {
        list: async (memberId: string) => {
          const payload = await request<MemberNote[] | { notes?: MemberNote[] }>(
            `/api/members/${encodeURIComponent(memberId)}/notes`
          );
          if (Array.isArray(payload)) return payload;
          return Array.isArray(payload.notes) ? payload.notes : [];
        },
        create: (memberId: string, content: string) =>
          request<{ note?: MemberNote }>(`/api/members/${encodeURIComponent(memberId)}/notes`, {
            method: "POST",
            body: JSON.stringify({ content }),
          }),
        update: (memberId: string, noteId: string, content: string) =>
          request<{ note?: MemberNote }>(
            `/api/members/${encodeURIComponent(memberId)}/notes/${encodeURIComponent(noteId)}`,
            {
              method: "PUT",
              body: JSON.stringify({ content }),
            }
          ),
        remove: (memberId: string, noteId: string) =>
          request<{ ok?: boolean }>(
            `/api/members/${encodeURIComponent(memberId)}/notes/${encodeURIComponent(noteId)}`,
            { method: "DELETE" }
          ),
      },
      importantDates: {
        list: async (memberId: string) => {
          const payload = await request<MemberImportantDate[] | { important_dates?: MemberImportantDate[] }>(
            `/api/members/${encodeURIComponent(memberId)}/important-dates`
          );
          if (Array.isArray(payload)) return payload;
          return Array.isArray(payload.important_dates) ? payload.important_dates : [];
        },
        create: (
          memberId: string,
          body: {
            title: string;
            description?: string;
            date_value: string;
            time_value?: string | null;
            date_type?: "birthday" | "anniversary" | "custom";
            is_recurring_yearly?: boolean;
            reminder_offsets?: string[];
            default_alert_enabled?: boolean;
          }
        ) =>
          request<{ important_date?: MemberImportantDate }>(
            `/api/members/${encodeURIComponent(memberId)}/important-dates`,
            {
              method: "POST",
              body: JSON.stringify(body),
            }
          ),
        update: (
          memberId: string,
          dateId: string,
          body: {
            title: string;
            description?: string;
            date_value: string;
            time_value?: string | null;
            date_type?: "birthday" | "anniversary" | "custom";
            is_recurring_yearly?: boolean;
            reminder_offsets?: string[];
            default_alert_enabled?: boolean;
          }
        ) =>
          request<{ important_date?: MemberImportantDate }>(
            `/api/members/${encodeURIComponent(memberId)}/important-dates/${encodeURIComponent(dateId)}`,
            {
              method: "PATCH",
              body: JSON.stringify(body),
            }
          ),
        remove: (memberId: string, dateId: string) =>
          request<{ ok?: boolean }>(
            `/api/members/${encodeURIComponent(memberId)}/important-dates/${encodeURIComponent(dateId)}`,
            { method: "DELETE" }
          ),
      },
      assignToGroup: (memberId: string, body: { group_id: string; role_in_group: string }) =>
        request<{ id?: string; error?: string }>("/api/group-members", {
          method: "POST",
          body: JSON.stringify({
            member_id: memberId,
            group_id: body.group_id,
            role_in_group: body.role_in_group,
          }),
        }),
      /** Batch add members to one group — one aggregated notification for the actor. */
      assignToGroupBulk: (body: { group_id: string; member_ids: string[]; role_in_group?: string }) =>
        request<{
          added?: string[];
          skipped?: { member_id: string; reason: string }[];
          inserted_count?: number;
          error?: string;
          code?: string;
        }>("/api/group-members/bulk", {
          method: "POST",
          body: JSON.stringify({
            group_id: body.group_id,
            member_ids: body.member_ids,
            role_in_group: body.role_in_group ?? "member",
          }),
        }),
      assignToFamily: (memberId: string, familyId: string) =>
        request<{ id?: string; error?: string }>("/api/member-families", {
          method: "POST",
          body: JSON.stringify({ member_id: memberId, family_id: familyId }),
        }),
      createTask: (
        memberId: string,
        body: {
          title: string;
          description?: string;
          /** Single assignee (legacy); ignored when `assignee_profile_ids` is set. */
          assignee_profile_id?: string;
          /** One or more leader assignees; first is primary `assignee_profile_id` on the server. */
          assignee_profile_ids?: string[];
          due_at?: string | null;
          related_member_ids?: string[];
          /** Checklist rows (server: `{ label, done }[]`). */
          checklist?: { label: string; done?: boolean }[];
          urgency?: "low" | "urgent" | "high";
        }
      ) => {
        const ids =
          body.assignee_profile_ids && body.assignee_profile_ids.length > 0
            ? body.assignee_profile_ids
            : body.assignee_profile_id
              ? [body.assignee_profile_id]
              : [];
        const payload: Record<string, unknown> = {
          title: body.title,
          assignee_profile_ids: ids,
          assignee_profile_id: ids[0],
        };
        if (body.description !== undefined) payload.description = body.description;
        if (body.due_at !== undefined) payload.due_at = body.due_at;
        if (body.urgency) payload.urgency = body.urgency;
        if (body.related_member_ids && body.related_member_ids.length > 0) {
          payload.related_member_ids = body.related_member_ids;
        }
        if (body.checklist && body.checklist.length > 0) {
          payload.checklist = body.checklist.map((item) => ({
            label: item.label,
            done: item.done === true,
          }));
        }
        return request<{ task?: TaskItem; error?: string }>(`/api/members/${encodeURIComponent(memberId)}/tasks`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      },
      /** PATCH `/api/member-tasks/:taskId` — status, checklist, fields per server rules. */
      patchMemberTask: (taskId: string, body: Record<string, unknown>) =>
        request<{ task?: TaskItem; error?: string }>(`/api/member-tasks/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      deleteMemberTask: (taskId: string) =>
        request<{ ok?: boolean; error?: string }>(`/api/member-tasks/${encodeURIComponent(taskId)}`, {
          method: "DELETE",
        }),
    },

    groups: {
      list: async (params?: {
        tree?: boolean;
        parent_group_id?: string;
        group_type?: string;
        offset?: number;
        limit?: number;
      }) => {
        const qs = new URLSearchParams();
        if (params?.tree) qs.set("tree", "1");
        if (params?.parent_group_id) qs.set("parent_group_id", params.parent_group_id);
        if (params?.group_type) qs.set("group_type", params.group_type);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const path = query ? `/api/groups?${query}` : "/api/groups";
        const payload = await request<Group[] | { groups?: Group[] }>(path);
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.groups) ? payload.groups : [];
      },
      detail: async (groupId: string) => {
        const payload = await request<Group | { group?: Group }>(`/api/groups/${encodeURIComponent(groupId)}`);
        if (payload && typeof payload === "object" && "group" in payload && payload.group) return payload.group;
        return payload as Group;
      },
      /** POST `/api/groups` — `group_type` must match a configured label (or legacy free text). */
      create: (body: {
        name: string;
        description?: string;
        group_type: string;
        parent_group_id?: string | null;
        leader_id?: string | null;
      }) => {
        const payload: Record<string, unknown> = {
          name: body.name.trim(),
          description: (body.description ?? "").trim() || null,
          group_type: body.group_type.trim(),
        };
        if (body.parent_group_id && String(body.parent_group_id).trim()) {
          payload.parent_group_id = String(body.parent_group_id).trim();
        }
        if (body.leader_id && String(body.leader_id).trim()) {
          payload.leader_id = String(body.leader_id).trim();
        }
        return request<Group>("/api/groups", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      },
      /** PUT `/api/groups/:id` — partial update; send only fields to change. */
      update: (groupId: string, body: { name?: string; description?: string | null; group_type?: string | null }) =>
        request<Group>(`/api/groups/${encodeURIComponent(groupId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      members: async (groupId: string) => {
        const payload = await request<GroupMemberItem[] | { members?: GroupMemberItem[] }>(
          `/api/group-members?group_id=${encodeURIComponent(groupId)}`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.members) ? payload.members : [];
      },
      events: async (groupId: string) => {
        const payload = await request<EventItem[] | { events?: EventItem[] }>(
          `/api/groups/${encodeURIComponent(groupId)}/events`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.events) ? payload.events : [];
      },
      tasks: async (
        groupId: string,
        params?: { offset?: number; limit?: number }
      ) => {
        const qs = new URLSearchParams();
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        } else {
          qs.set("limit", "100");
        }
        const query = qs.toString();
        const path = `/api/groups/${encodeURIComponent(groupId)}/tasks?${query}`;
        const payload = await request<TaskItem[] | { tasks?: TaskItem[] }>(path);
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.tasks) ? payload.tasks : [];
      },
      /** POST `/api/groups/:anchorGroupId/tasks` — create group follow-up task (anchor group). */
      createTask: (
        anchorGroupId: string,
        body: {
          title: string;
          assignee_profile_id?: string;
          assignee_profile_ids?: string[];
          related_group_ids?: string[];
          description?: string;
          due_at?: string | null;
          checklist?: { label: string; done?: boolean }[];
          urgency?: "low" | "urgent" | "high";
        }
      ) => {
        const ids =
          body.assignee_profile_ids && body.assignee_profile_ids.length > 0
            ? body.assignee_profile_ids
            : body.assignee_profile_id
              ? [body.assignee_profile_id]
              : [];
        const payload: Record<string, unknown> = {
          title: body.title,
          assignee_profile_ids: ids,
          assignee_profile_id: ids[0],
        };
        if (body.description !== undefined) payload.description = body.description;
        if (body.due_at !== undefined) payload.due_at = body.due_at;
        if (body.related_group_ids && body.related_group_ids.length > 0) {
          payload.related_group_ids = body.related_group_ids;
        }
        if (body.checklist && body.checklist.length > 0) {
          payload.checklist = body.checklist.map((item) => ({
            label: item.label,
            done: item.done === true,
          }));
        }
        if (body.urgency) payload.urgency = body.urgency;
        return request<{ task?: TaskItem; error?: string }>(
          `/api/groups/${encodeURIComponent(anchorGroupId)}/tasks`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        );
      },
      /** PATCH `/api/group-tasks/:taskId` — same field rules as member tasks for managers/assignees. */
      patchGroupTask: (taskId: string, body: Record<string, unknown>) =>
        request<{ task?: TaskItem; error?: string }>(`/api/group-tasks/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      deleteGroupTask: (taskId: string) =>
        request<{ ok?: boolean; error?: string }>(`/api/group-tasks/${encodeURIComponent(taskId)}`, {
          method: "DELETE",
        }),
      requests: async (groupId: string) => {
        const payload = await request<GroupRequestItem[] | { requests?: GroupRequestItem[] }>(
          `/api/group-requests?status=pending&group_id=${encodeURIComponent(groupId)}`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.requests) ? payload.requests : [];
      },
    },

    groupTypeOptions: {
      list: async () => {
        const payload = await request<GroupTypeOption[] | { error?: string }>("/api/group-type-options");
        return Array.isArray(payload) ? payload : [];
      },
    },

    families: {
      list: async (params?: { branch_id?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.branch_id) qs.set("branch_id", params.branch_id);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<Family[] | { families?: Family[] }>(
          `/api/families${query ? `?${query}` : ""}`
        );
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload.families) ? payload.families : [];
      },
      /** GET `/api/member-families/member/:memberId` — nested `families` rows from `member_families`. */
      forMember: async (memberId: string) => {
        const payload = await request<unknown[]>(
          `/api/member-families/member/${encodeURIComponent(memberId)}`
        );
        if (!Array.isArray(payload)) return [] as Family[];
        const out: Family[] = [];
        const seen = new Set<string>();
        for (const row of payload) {
          if (!row || typeof row !== "object") continue;
          const nested = (row as { families?: unknown }).families;
          if (nested && typeof nested === "object" && nested !== null && "id" in nested) {
            const f = nested as Family;
            const id = String(f.id || "");
            if (id && !seen.has(id)) {
              seen.add(id);
              out.push(f);
            }
          }
        }
        return out;
      },
      /** GET `/api/member-families/family/:familyId` — members in family (same shape as `GET /api/members`). */
      members: async (familyId: string) => {
        const payload = await request<{ members?: Member[]; error?: string }>(
          `/api/member-families/family/${encodeURIComponent(familyId)}`
        );
        if (payload && typeof payload === "object" && Array.isArray(payload.members)) {
          return payload.members;
        }
        return [];
      },
    },

    events: {
      list: async (params?: { offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<EventItem[] | { events?: EventItem[]; total_count?: number }>(
          `/api/events${query ? `?${query}` : ""}`
        );
        return parseEventsListPayload(payload);
      },
      detail: async (eventId: string) => {
        const payload = await request<EventItem | { event?: EventItem }>(`/api/events/${encodeURIComponent(eventId)}`);
        if (payload && typeof payload === "object" && "event" in payload && payload.event) return payload.event;
        return payload as EventItem;
      },
      create: (payload: EventUpsertPayload) =>
        request<EventItem>("/api/events", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      update: (eventId: string, payload: EventUpsertPayload) =>
        request<EventItem>(`/api/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }),
      attendance: {
        get: (eventId: string) =>
          request<{
            event_id?: string;
            event_start?: string | null;
            attendance_opens_at?: string | null;
            members?: Member[];
            attendance?: EventAttendanceRow[];
            assigned_groups?: Group[];
            filter_groups?: Group[];
          }>(`/api/events/${encodeURIComponent(eventId)}/attendance`),
        update: (
          eventId: string,
          updates: Array<{ member_id: string; status: "not_marked" | "present" | "absent" | "unsure"; notes?: string }>
        ) =>
          request<{ attendance?: EventAttendanceRow[] }>(`/api/events/${encodeURIComponent(eventId)}/attendance`, {
            method: "PUT",
            body: JSON.stringify({ updates }),
          }),
      },
    },

    eventTypes: {
      /** GET `/api/event-types` — branch-scoped rows from organization settings. */
      list: async () => {
        const payload = await request<EventTypeRow[] | unknown>("/api/event-types");
        return Array.isArray(payload) ? (payload as EventTypeRow[]) : [];
      },
      update: (eventTypeId: string, body: Record<string, unknown>) =>
        request<EventTypeRow>(`/api/event-types/${encodeURIComponent(eventTypeId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (eventTypeId: string) =>
        request<{ ok: boolean; moved_events?: number; moved_templates?: number; replacement_slug?: string }>(
          `/api/event-types/${encodeURIComponent(eventTypeId)}`,
          { method: "DELETE" },
        ),
    },

    tasks: {
      mine: async (params?: {
        status?: "open" | "all";
        offset?: number;
        limit?: number;
        urgency?: "low" | "urgent" | "high" | "all";
      }) => {
        const qs = new URLSearchParams();
        if (params?.status === "all") qs.set("status", "all");
        if (params?.urgency && params.urgency !== "all") qs.set("urgency", params.urgency);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<TaskItem[] | { tasks?: TaskItem[]; total_count?: number }>(
          `/api/tasks/mine${query ? `?${query}` : ""}`
        );
        return parseTasksListPayload(payload);
      },
      /** Branch monitoring list; `orgWide` is org-owner-only (all branches). */
      branch: async (params?: {
        status?: "open" | "all";
        orgWide?: boolean;
        month?: string;
        dueFromIso?: string;
        dueToIso?: string;
        assigneeProfileId?: string;
        createdByProfileId?: string;
        urgency?: "low" | "urgent" | "high" | "all";
        offset?: number;
        limit?: number;
      }) => {
        const qs = new URLSearchParams();
        if (params?.status === "all") qs.set("status", "all");
        else qs.set("status", "open");
        if (params?.orgWide) qs.set("org_wide", "1");
        if (params?.month?.trim()) qs.set("month", params.month.trim());
        if (params?.dueFromIso?.trim()) qs.set("due_from", params.dueFromIso.trim());
        if (params?.dueToIso?.trim()) qs.set("due_to", params.dueToIso.trim());
        if (params?.assigneeProfileId?.trim()) qs.set("assignee_profile_id", params.assigneeProfileId.trim());
        if (params?.createdByProfileId?.trim())
          qs.set("created_by_profile_id", params.createdByProfileId.trim());
        if (params?.urgency && params.urgency !== "all") qs.set("urgency", params.urgency);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<TaskItem[] | { tasks?: TaskItem[]; total_count?: number }>(
          `/api/tasks/branch${query ? `?${query}` : ""}`
        );
        return parseTasksListPayload(payload);
      },
    },

    reports: {
      summary: (params?: { range_days?: number; group_id?: string }) => {
        const qs = new URLSearchParams();
        if (typeof params?.range_days === "number" && Number.isFinite(params.range_days)) {
          qs.set("range_days", String(Math.max(1, Math.min(3650, Math.floor(params.range_days)))));
        }
        if (params?.group_id && params.group_id.trim()) {
          qs.set("group_id", params.group_id.trim());
        }
        const query = qs.toString();
        return request<ReportSummaryResponse>(`/api/reports/summary${query ? `?${query}` : ""}`);
      },
      generate: (payload: { name?: string; description?: string; report_type: ReportType; filters?: ReportFilterPayload }) =>
        request<{ report: ReportGeneratedPayload; run_id: string | null; generated_at: string | null }>("/api/reports/generate", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      preview: (payload: { report_type: ReportType; filters?: ReportFilterPayload }) =>
        request<{ preview: ReportGeneratedPayload }>("/api/reports/preview", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      listDefinitions: () => request<{ definitions: ReportDefinition[] }>("/api/reports/definitions"),
      listRuns: (params?: { limit?: number }) => {
        const qs = new URLSearchParams();
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        return request<{ runs: ReportRun[] }>(`/api/reports/runs${query ? `?${query}` : ""}`);
      },
      historyTable: (params?: { limit?: number }) => {
        const qs = new URLSearchParams();
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        return request<{ rows: ReportHistoryTableRow[] }>(`/api/reports/history-table${query ? `?${query}` : ""}`);
      },
      listLeaders: () =>
        request<{
          leaders: Array<{
            id: string;
            first_name?: string | null;
            last_name?: string | null;
            email?: string | null;
            avatar_url?: string | null;
            group_count?: number;
          }>;
        }>("/api/reports/leaders"),
      leaderDetail: (profileId: string) =>
        request<{
          leader: {
            id: string;
            first_name?: string | null;
            last_name?: string | null;
            email?: string | null;
            avatar_url?: string | null;
            group_count: number;
          };
          groups: Array<{
            id: string;
            name: string;
            member_count: number;
            leader_id?: string | null;
            member_preview?: Array<{ member_id: string; image_url: string | null; initials: string }>;
          }>;
          members: Array<{ id: string; first_name: string | null; last_name: string | null; image_url?: string | null }>;
          tasks?: Array<{
            id: string;
            task_type: "member" | "group";
            title: string;
            status: string;
            due_at: string | null;
            member_id?: string;
            group_id?: string;
            members?: Array<{ id: string; first_name: string | null; last_name: string | null }>;
            groups?: Array<{ id: string; name: string | null }>;
          }>;
        }>(`/api/reports/leaders/${encodeURIComponent(profileId)}`),
      getDefinition: (id: string) =>
        request<ReportDefinition>(`/api/reports/definitions/${encodeURIComponent(id)}`),
      createDefinition: (payload: {
        name: string;
        description?: string;
        report_type: ReportType;
        filters?: ReportFilterPayload;
        output?: Record<string, unknown>;
        is_shared?: boolean;
      }) =>
        request<ReportDefinition>("/api/reports/definitions", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      updateDefinition: (
        id: string,
        payload: Partial<{
          name: string;
          report_type: ReportType;
          filters: ReportFilterPayload;
          output: Record<string, unknown>;
          is_shared: boolean;
          is_archived: boolean;
        }>
      ) =>
        request<ReportDefinition>(`/api/reports/definitions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }),
      runDefinition: (id: string) =>
        request<{ report: ReportGeneratedPayload; run_id: string; generated_at: string }>(
          `/api/reports/definitions/${encodeURIComponent(id)}/run`,
          { method: "POST" }
        ),
      export: (payload: {
        format: "csv" | "pdf";
        run_id?: string;
        definition_id?: string;
        report?: ReportGeneratedPayload;
      }) =>
        request<ReportExportResponse>("/api/reports/exports", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
    },

    memberRequests: {
      list: async (params?: { status?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<unknown[] | { requests?: unknown[]; total_count?: number }>(`/api/member-requests${query ? `?${query}` : ""}`);
        if (Array.isArray(payload)) return payload;
        return Array.isArray((payload as any).requests) ? (payload as any).requests : [];
      },
      update: (requestId: string, updates: Record<string, unknown>) =>
        request<unknown>(`/api/member-requests/${encodeURIComponent(requestId)}`, {
          method: "PUT",
          body: JSON.stringify(updates),
        }),
      approve: (requestId: string) =>
        request<unknown>(`/api/member-requests/${encodeURIComponent(requestId)}/approve`, {
          method: "POST",
        }),
      reject: (requestId: string) =>
        request<unknown>(`/api/member-requests/${encodeURIComponent(requestId)}/reject`, {
          method: "POST",
        }),
    },

    groupRequests: {
      list: async (params?: { status?: string; group_id?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.group_id) qs.set("group_id", params.group_id);
        if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
          qs.set("offset", String(Math.floor(params.offset)));
        }
        if (typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
          qs.set("limit", String(Math.floor(params.limit)));
        }
        const query = qs.toString();
        const payload = await request<unknown[] | { requests?: unknown[]; total_count?: number }>(`/api/group-requests${query ? `?${query}` : ""}`);
        if (Array.isArray(payload)) return payload;
        return Array.isArray((payload as any).requests) ? (payload as any).requests : [];
      },
      approve: (requestId: string) =>
        request<unknown>(`/api/group-requests/${encodeURIComponent(requestId)}/approve`, {
          method: "POST",
        }),
      reject: (requestId: string) =>
        request<unknown>(`/api/group-requests/${encodeURIComponent(requestId)}/reject`, {
          method: "POST",
        }),
      ignore: (requestId: string) =>
        request<unknown>(`/api/group-requests/${encodeURIComponent(requestId)}/ignore`, {
          method: "POST",
        }),
    },

    notifications: {
      list: (params?: { limit?: number; offset?: number }) => {
        const limit = typeof params?.limit === "number" ? params.limit : 40;
        const offset = typeof params?.offset === "number" ? params.offset : 0;
        const qs = new URLSearchParams();
        qs.set("limit", String(limit));
        if (offset > 0) qs.set("offset", String(offset));
        return request<{ notifications: AppNotification[] }>(`/api/notifications?${qs.toString()}`);
      },
      unreadCount: () => request<{ unread_count: number }>("/api/notifications/unread-count"),
      markRead: (id: string) =>
        request<{ ok?: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }),
      markAllRead: () => request<{ ok?: boolean }>("/api/notifications/read-all", { method: "PATCH" }),
      clearAll: () => request<{ ok?: boolean }>("/api/notifications/clear-all", { method: "DELETE" }),
      deleteOne: (id: string) =>
        request<{ ok?: boolean }>(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" }),
    },

    notificationPreferences: {
      get: async () => {
        const payload = await request<{ preferences?: NotificationPreferences }>(
          "/api/notification-preferences/me"
        );
        return payload.preferences;
      },
      patch: (updates: Partial<NotificationPreferences>) =>
        request<{ preferences?: NotificationPreferences }>("/api/notification-preferences/me", {
          method: "PATCH",
          body: JSON.stringify(updates),
        }),
    },

    customFieldDefinitions: async (appliesTo: "member" | "event" | "group") => {
      try {
        const payload = await request<CustomFieldDefinition[]>(
          `/api/custom-field-definitions?applies_to=${encodeURIComponent(appliesTo)}`
        );
        return Array.isArray(payload) ? payload : [];
      } catch {
        return [];
      }
    },

    memberStatusOptions: async () => {
      try {
        const payload = await request<MemberStatusOption[]>("/api/member-status-options");
        return Array.isArray(payload) ? payload : [];
      } catch {
        return [];
      }
    },
  };
}
