import { 
  mockMembers, 
  mockChurches, 
  mockGroups, 
  mockEvents, 
  mockFamilies, 
  mockJoinRequests,
  getStats
} from './mockData';

const API_BASE_URL = '';
const TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'user';
let refreshInFlight: Promise<string | null> | null = null;

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function attemptTokenRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 403) {
        throw new Error((payload as { error?: string }).error || 'Access denied for this account.');
      }
      if (!response.ok || typeof payload.token !== 'string') {
        clearStoredSession();
        return null;
      }
      localStorage.setItem(TOKEN_KEY, payload.token);
      if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
        localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
      }
      if (payload.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
      }
      return payload.token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  hasRetried = false
): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const branchId = localStorage.getItem('selectedBranchId')?.trim();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    ...options.headers,
  };

  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(15000)
    : undefined;
  // #region agent log
  try {
    fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'vercel-prod-api-diff',hypothesisId:'D1',location:'src/app/utils/api.ts:apiRequest.beforeFetch',message:'api request start',data:{endpoint:`/api${endpoint}`,method:options.method || 'GET',hasToken:!!token,hasBranchId:!!branchId,hasRetried},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
    signal: options.signal ?? signal,
  });
  // #region agent log
  try {
    fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'vercel-prod-api-diff',hypothesisId:'D2',location:'src/app/utils/api.ts:apiRequest.afterFetch',message:'api response received',data:{endpoint:`/api${endpoint}`,status:response.status,ok:response.ok,contentType:response.headers.get('content-type') || ''},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion

  if (response.status === 401 && !hasRetried) {
    const refreshedToken = await attemptTokenRefresh();
    if (refreshedToken) {
      return apiRequest<T>(endpoint, options, true);
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const fallback = response.status === 403 ? 'Access denied for this account.' : 'API request failed';
    // #region agent log
    try {
      fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'vercel-prod-api-diff',hypothesisId:'D3',location:'src/app/utils/api.ts:apiRequest.nonOk',message:'api response non-ok',data:{endpoint:`/api${endpoint}`,status:response.status,errorMessage:(error as { error?: string }).error || null},timestamp:Date.now()})}).catch(()=>{});
    } catch {}
    // #endregion
    throw new Error((error as { error?: string }).error || fallback);
  }

  const data = await response.json();
  // #region agent log
  try {
    fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'vercel-prod-api-diff',hypothesisId:'D4',location:'src/app/utils/api.ts:apiRequest.success',message:'api response success',data:{endpoint:`/api${endpoint}`,status:response.status,keys:Array.isArray(data)?['__array__']:(data && typeof data === 'object'?Object.keys(data).slice(0,8):[])},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
  return data;
}

// ============================================
// ORGANIZATION API
// ============================================

export const organizationApi = {
  getAll: () => apiRequest('/organizations'),
  
  getById: (id: string) => apiRequest(`/organizations/${id}`),
  
  create: (data: any) => apiRequest('/organizations', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/organizations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) => apiRequest(`/organizations/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// BRANCH API
// ============================================

export const branchApi = {
  getAll: (organizationId?: string) => {
    const query = organizationId ? `?organization_id=${organizationId}` : '';
    return apiRequest(`/branches${query}`);
  },
  
  create: (data: any) => apiRequest('/branches', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/branches/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) => apiRequest(`/branches/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// MEMBER API
// ============================================

export const memberApi = {
  getAll: (params?: {
    organization_id?: string;
    branch_id?: string;
    status?: string;
    offset?: number;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (params?.status) queryParams.append('status', params.status);
    if (typeof params?.offset === 'number') queryParams.append('offset', String(params.offset));
    if (typeof params?.limit === 'number') queryParams.append('limit', String(params.limit));
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/members${query}`);
  },
  
  getById: (id: string) => apiRequest(`/members/${id}`),
  
  create: (data: any) => apiRequest('/members', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/members/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) => apiRequest(`/members/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// EVENT API
// ============================================

export const eventApi = {
  getAll: (params?: {
    organization_id?: string;
    branch_id?: string;
    status?: string;
    offset?: number;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (params?.status) queryParams.append('status', params.status);
    if (typeof params?.offset === 'number') queryParams.append('offset', String(params.offset));
    if (typeof params?.limit === 'number') queryParams.append('limit', String(params.limit));
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/events${query}`);
  },
  
  create: (data: any) => apiRequest('/events', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/events/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) => apiRequest(`/events/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// GROUP API
// ============================================

export const groupApi = {
  getAll: (params?: {
    organization_id?: string;
    branch_id?: string;
    group_type?: string;
    offset?: number;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (params?.group_type) queryParams.append('group_type', params.group_type);
    if (typeof params?.offset === 'number') queryParams.append('offset', String(params.offset));
    if (typeof params?.limit === 'number') queryParams.append('limit', String(params.limit));
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/groups${query}`);
  },
  
  create: (data: any) => apiRequest('/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),

  createTask: (anchorGroupId: string, data: {
    title: string;
    assignee_profile_id?: string;
    assignee_profile_ids?: string[];
    related_group_ids?: string[];
    description?: string;
    due_at?: string | null;
    checklist?: { label: string; done?: boolean }[];
  }) => {
    const ids =
      Array.isArray(data.assignee_profile_ids) && data.assignee_profile_ids.length > 0
        ? data.assignee_profile_ids
        : data.assignee_profile_id
          ? [data.assignee_profile_id]
          : [];
    const payload: Record<string, unknown> = {
      title: data.title,
      assignee_profile_ids: ids,
      assignee_profile_id: ids[0],
    };
    if (data.description !== undefined) payload.description = data.description;
    if (data.due_at !== undefined) payload.due_at = data.due_at;
    if (Array.isArray(data.related_group_ids) && data.related_group_ids.length > 0) {
      payload.related_group_ids = data.related_group_ids;
    }
    if (Array.isArray(data.checklist) && data.checklist.length > 0) {
      payload.checklist = data.checklist.map((item) => ({
        label: item.label,
        done: item.done === true,
      }));
    }
    return apiRequest(`/groups/${encodeURIComponent(anchorGroupId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  
  delete: (id: string) => apiRequest(`/groups/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// ATTENDANCE API
// ============================================

export const attendanceApi = {
  getAll: (params?: {
    event_id?: string;
    member_id?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.event_id) queryParams.append('event_id', params.event_id);
    if (params?.member_id) queryParams.append('member_id', params.member_id);
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/attendance${query}`);
  },
  
  record: (data: any) => apiRequest('/attendance', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

// ============================================
// NOTE API
// ============================================

export const noteApi = {
  getAll: (params?: {
    organization_id?: string;
    member_id?: string;
    note_type?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.member_id) queryParams.append('member_id', params.member_id);
    if (params?.note_type) queryParams.append('note_type', params.note_type);
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/notes${query}`);
  },
  
  create: (data: any) => apiRequest('/notes', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/notes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) => apiRequest(`/notes/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// MESSAGE API (legacy path; prefer orgMessagesApi)
// ============================================

export const messageApi = {
  getAll: (params?: {
    organization_id?: string;
    sender_id?: string;
    status?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.sender_id) queryParams.append('sender_id', params.sender_id);
    if (params?.status) queryParams.append('status', params.status);
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/messages${query}`);
  },
  
  create: (data: any) => apiRequest('/messages', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

/** Bulk SMS rows (Hubtel delivery stub — see notifyHubtelSmsPending). */
export const orgMessagesApi = {
  list: () => apiRequest('/org/messages'),
  create: (data: Record<string, unknown>) =>
    apiRequest('/org/messages', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ============================================
// FAMILY API
// ============================================

export const familyApi = {
  getAll: (params?: {
    organization_id?: string;
    branch_id?: string;
    offset?: number;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (typeof params?.offset === 'number') queryParams.append('offset', String(params.offset));
    if (typeof params?.limit === 'number') queryParams.append('limit', String(params.limit));
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return apiRequest(`/families${query}`);
  },
  
  getById: (id: string) => apiRequest(`/families/${id}`),
  
  create: (data: any) => apiRequest('/families', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: any) => apiRequest(`/families/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) => apiRequest(`/families/${id}`, {
    method: 'DELETE',
  }),
};

// ============================================
// MEMBER FAMILIES API (Junction Table)
// ============================================

export const memberFamiliesApi = {
  assign: (memberId: string, familyId: string) => apiRequest('/member-families', {
    method: 'POST',
    body: JSON.stringify({ member_id: memberId, family_id: familyId }),
  }),
  
  remove: (memberId: string, familyId: string) => apiRequest(`/member-families?member_id=${memberId}&family_id=${familyId}`, {
    method: 'DELETE',
  }),
  
  getByMember: (memberId: string) => apiRequest(`/member-families/member/${memberId}`),

  getByFamily: (familyId: string) =>
    apiRequest(`/member-families/family/${encodeURIComponent(familyId)}`).then((data: any) =>
      Array.isArray(data?.members) ? data.members : []
    ),
};

// ============================================
// DASHBOARD STATS API
// ============================================

export const statsApi = {
  getDashboard: (organizationId: string) => 
    apiRequest(`/stats/dashboard?organization_id=${organizationId}`),
};

// ============================================
// SUPERADMIN (cross-tenant; requires is_super_admin or SUPERADMIN_EMAILS)
// ============================================

export const superadminApi = {
  stats: () => apiRequest('/superadmin/stats'),
  orgs: (params?: { page?: number; pageSize?: number; search?: string; tier?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.search) q.set('search', params.search);
    if (params?.tier) q.set('tier', params.tier);
    const s = q.toString();
    return apiRequest(`/superadmin/orgs${s ? `?${s}` : ''}`);
  },
  orgById: (id: string) => apiRequest(`/superadmin/orgs/${encodeURIComponent(id)}`),
  patchOrg: (id: string, body: Record<string, unknown>) =>
    apiRequest(`/superadmin/orgs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  branches: (orgId?: string) => {
    const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return apiRequest(`/superadmin/branches${q}`);
  },
  users: (params?: { org_id?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set('org_id', params.org_id);
    if (params?.search) q.set('search', params.search);
    const s = q.toString();
    return apiRequest(`/superadmin/users${s ? `?${s}` : ''}`);
  },
  patchUser: (profileId: string, body: { is_active?: boolean }) =>
    apiRequest(`/superadmin/users/${encodeURIComponent(profileId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  growth: () => apiRequest('/superadmin/growth'),
};

export const notificationsApi = {
  list: (params?: { unread_only?: boolean; category?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.unread_only) q.set('unread_only', 'true');
    if (params?.category) q.set('category', params.category);
    if (params?.limit) q.set('limit', String(params.limit));
    if (typeof params?.offset === 'number' && params.offset > 0) q.set('offset', String(params.offset));
    const s = q.toString();
    return apiRequest(`/notifications${s ? `?${s}` : ''}`);
  },
  unreadCount: () => apiRequest('/notifications/unread-count'),
  markRead: (id: string) => apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  markAllRead: () => apiRequest('/notifications/read-all', { method: 'PATCH' }),
  remove: (id: string) => apiRequest(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getPreferences: () => apiRequest('/notification-preferences/me'),
  patchPreferences: (patch: Record<string, boolean>) =>
    apiRequest('/notification-preferences/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  listTestTypes: () => apiRequest('/notifications/test-types'),
  testSend: (payload: {
    type: string;
    recipient_profile_id: string;
    actor_profile_id?: string;
    entity_id?: string;
    action_path?: string;
    /** Bypass 60-minute QA dedupe (sends a new row). */
    force?: boolean;
  }) =>
    apiRequest('/notifications/test-send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testPreview: (recipientProfileId: string, limit = 25) =>
    apiRequest(
      `/notifications/test-preview?recipient_profile_id=${encodeURIComponent(recipientProfileId)}&limit=${encodeURIComponent(
        String(limit),
      )}`,
    ),
  testPreviewUnreadCount: (recipientProfileId: string) =>
    apiRequest(`/notifications/test-preview/unread-count?recipient_profile_id=${encodeURIComponent(recipientProfileId)}`),
};

// Test API connection
export const testConnection = () => apiRequest('/health');
