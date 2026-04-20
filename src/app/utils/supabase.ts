import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : ({
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ data: { user: null, session: null }, error: new Error('Auth disabled') }),
        signUp: async () => ({ data: { user: null, session: null }, error: new Error('Auth disabled') }),
        signOut: async () => ({ error: null }),
        resetPasswordForEmail: async () => ({
          data: null,
          error: new Error('Authentication is not configured. Please contact support.'),
        }),
        updateUser: async () => ({
          data: { user: null },
          error: new Error('Authentication is not configured. Please contact support.'),
        }),
        getUser: async () => ({ data: { user: null }, error: null }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      }),
      removeChannel: () => undefined,
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
        insert: async () => ({ data: null, error: null }),
        update: async () => ({ data: null, error: null }),
        delete: async () => ({ data: null, error: null }),
      }),
    } as any);

// Database types based on our schema
export interface Organization {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  timezone: string;
  currency: string;
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired';
  subscription_plan: string | null;
  trial_ends_at: string | null;
  settings: any;
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  is_main_branch: boolean;
  settings: any;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: 'super_admin' | 'admin' | 'pastor' | 'leader' | 'member';
  avatar_url: string | null;
  is_active: boolean;
  last_login_at: string | null;
  settings: any;
  created_at: string;
  updated_at: string;
  organization?: Organization; // Optional nested organization
}

export interface Member {
  id: string;
  organization_id: string;
  branch_id: string | null;
  family_id: string | null;
  member_id_string: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  marital_status: string | null;
  occupation: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  date_joined: string | null;
  status: string | null;
  member_url: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
}

export interface Event {
  id: string;
  organization_id: string;
  branch_id: string | null;
  name: string;
  description: string | null;
  event_type: 'service' | 'meeting' | 'conference' | 'outreach' | 'social' | 'other';
  start_date: string;
  end_date: string | null;
  location: string | null;
  max_capacity: number | null;
  registration_required: boolean;
  registration_deadline: string | null;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  cover_image_url: string | null;
  created_by: string;
  settings: any;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  organization_id: string | null;
  branch_id: string | null;
  parent_group_id: string | null;
  name: string;
  description: string | null;
  group_type: string | null;
  public_website_enabled: boolean | null;
  join_link_enabled: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  leader_id: string | null;
}

export interface Attendance {
  id: string;
  organization_id: string;
  event_id: string;
  member_id: string;
  check_in_time: string;
  check_in_method: 'manual' | 'qr_code' | 'ai_scan' | 'self_checkin';
  notes: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  organization_id: string;
  member_id: string | null;
  created_by: string;
  title: string | null;
  content: string | null;
  note_type: 'general' | 'prayer_request' | 'follow_up' | 'counseling' | 'urgent';
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  is_private: boolean;
  voice_recording_url: string | null;
  transcription: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  organization_id: string;
  sender_id: string;
  recipient_type: 'individual' | 'group' | 'branch' | 'all';
  recipient_id: string | null;
  subject: string | null;
  content: string;
  message_type: 'email' | 'sms' | 'push' | 'in_app';
  status: 'draft' | 'scheduled' | 'sent' | 'failed';
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface GroupMember {
  id: string;
  organization_id: string | null;
  branch_id: string | null;
  group_id: string | null;
  member_id: string | null;
  role_in_group: string | null;
  joined_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GroupRequest {
  id: string;
  organization_id: string | null;
  branch_id: string | null;
  group_id: string | null;
  member_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  dob?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'ignored' | null;
  requested_at?: string | null;
  reviewed_at?: string | null;
  reviewer_id?: string | null;
  created_at: string | null;
  updated_at: string | null;
}