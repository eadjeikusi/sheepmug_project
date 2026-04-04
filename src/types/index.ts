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
  email: string;
  first_name: string;
  last_name: string;
  organization_id: string;
  branch_id?: string;
  organization?: any;
  role_id?: string;
  role?: any;
  is_super_admin?: boolean;
  profile_image?: string | null;
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
  // Frontend specific fields
  fullName?: string;
  phoneNumber?: string;
  location?: string;
  profileImage?: string;
  churchId?: string;
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
  /** Unique per group; used in public /join-group/:token (subgroup vs parent each has its own). */
  join_invite_token?: string | null;
  public_link_slug?: string | null; // Added for public facing URL
  announcements_content?: string | null;
  cover_image_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  created_at: string | null;
  updated_at: string | null;
  leader_id: string | null;
  member_count?: number; // For displaying on the card
  /** Up to 3 members for avatar stack on list cards (from GET /api/groups) */
  member_preview?: Array<{
    member_id: string;
    image_url: string | null;
    initials: string;
  }>;
  profiles?: { first_name: string | null; last_name: string | null } | null;
  program_outline_content?: string | null;
  /** Root → parent chain from GET /api/groups/:id (excludes current group) */
  breadcrumb?: { id: string; name: string }[];
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
  updated_at: string;
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
  /** Set when the public form verified an existing directory member (name + DOB). */
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
