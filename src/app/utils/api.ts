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

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
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
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (params?.status) queryParams.append('status', params.status);
    
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
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (params?.status) queryParams.append('status', params.status);
    
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
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    if (params?.group_type) queryParams.append('group_type', params.group_type);
    
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
// MESSAGE API
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

// ============================================
// FAMILY API
// ============================================

export const familyApi = {
  getAll: (params?: {
    organization_id?: string;
    branch_id?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.organization_id) queryParams.append('organization_id', params.organization_id);
    if (params?.branch_id) queryParams.append('branch_id', params.branch_id);
    
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
};

// ============================================
// DASHBOARD STATS API
// ============================================

export const statsApi = {
  getDashboard: (organizationId: string) => 
    apiRequest(`/stats/dashboard?organization_id=${organizationId}`),
};

// Test API connection
export const testConnection = () => apiRequest('/health');
