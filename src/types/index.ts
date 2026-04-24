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
  /** DB column (signup uses `free`, etc.) */
  subscription_tier?: string | null;
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired';
  subscription_plan: string | null;
  trial_ends_at: string | null;
  settings: any;
  created_at: string;
  updated_at: string;
  /** SuperAdmin overrides; null = use tier defaults from subscriptionPlans */
  max_members?: number | null;
  max_groups?: number | null;
  max_branches?: number | null;
  max_events_per_month?: number | null;
  max_staff?: number | null;
  hubtel_subscription_id?: string | null;
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
  timezone?: string | null;
  important_dates_default_reminder_time?: string | null;
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
  /** From API (organizations.name); may be absent on older cached sessions until refresh. */
  organization_name?: string | null;
  /** Set when `profiles.cms_onboarding_completed_at` is non-null (web CMS tour). */
  cms_onboarding_completed?: boolean;
  branch_id?: string;
  organization?: any;
  role_id?: string | null;
  role?: any;
  is_super_admin?: boolean;
  /** Org signup account — full access in API */
  is_org_owner?: boolean;
  /** Effective permission ids from assigned role (or all if org owner) */
  permissions?: string[];
  /** Server: ministry directory scope for staff (Settings assignments + All Members). */
  ministry_scope?: {
    kind: 'bypass' | 'branch_all' | 'groups';
    group_ids: string[];
  };
  profile_image?: string | null;
  /** Same URL as profile_image when stored on profiles row (Optional). */
  avatar_url?: string | null;
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
  /** E.164 international format from API */
  phone: string | null;
  /** ISO 3166-1 alpha-2 for primary phone country (UI + parsing) */
  phone_country_iso?: string | null;
  dob: string | null;
  gender: string | null;
  marital_status: string | null;
  occupation: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_phone_country_iso?: string | null;
  date_joined: string | null;
  status: string | null;
  /** Primary photo URL when present (some DBs use memberimage_url / member_url instead). */
  avatar_url?: string | null;
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
  /** Org custom field values keyed by `field_key` (from Settings → Custom fields). */
  custom_fields?: Record<string, unknown> | null;
}

/** Admin-defined custom field (matches `custom_field_definitions` / GET /api/custom-field-definitions). */
export interface CustomFieldDefinition {
  id: string;
  organization_id: string;
  field_key: string;
  label: string;
  field_type: string;
  required: boolean;
  placeholder: string | null;
  options: unknown;
  default_value: string | null;
  sort_order: number;
  applies_to: string[];
  show_on_public: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Organization picklist for `members.status` (label text is stored on the member row). */
export interface MemberStatusOption {
  id: string;
  organization_id: string;
  label: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Branch-scoped picklist for `groups.group_type` (label text stored on each group row). */
export interface GroupTypeOption {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MemberImportantDate {
  id: string;
  title: string;
  description: string | null;
  date_value: string;
  time_value: string | null;
  date_type?: 'birthday' | 'anniversary' | 'custom';
  is_recurring_yearly?: boolean;
  reminder_offsets?: string[];
  default_alert_enabled?: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface UpcomingImportantDateItem {
  id: string;
  member_id: string;
  member_display_name: string;
  member_image_url?: string | null;
  title: string;
  description?: string | null;
  date_type: 'birthday' | 'anniversary' | 'custom';
  occurs_on: string;
  time_value?: string | null;
  days_until: number;
  source: 'member_important_date' | 'member_birthday';
  default_alert_enabled?: boolean;
  reminder_offsets?: string[];
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
  contact_phone_country_iso?: string | null;
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
  profiles?: {
    first_name: string | null;
    last_name: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
  /** Staff with ministry access covering this group (Settings → Staff & leaders). Populated on GET /api/groups/:id. */
  ministry_scope_leader_profiles?: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>;
  program_outline_content?: string | null;
  /** Root → parent chain from GET /api/groups/:id (excludes current group) */
  breadcrumb?: { id: string; name: string }[];
  /** Org custom field values for group public page (see Settings → Custom fields, applies to group). */
  custom_fields?: Record<string, unknown> | null;
  /** System-managed row (e.g. All Members); hidden from normal ministry lists. */
  is_system?: boolean | null;
  system_kind?: string | null;
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

/** Row from GET /api/org/messages (bulk SMS; metadata from migrations/messages_metadata.sql). */
export interface OrgBulkMessageRow {
  id: string;
  subject: string | null;
  content: string;
  recipient_type: string;
  status: string;
  scheduled_for?: string | null;
  created_at: string;
  sender_id?: string;
  branch_id?: string;
  metadata?: {
    channel?: string;
    recipient_label?: string;
    recipient_count?: number;
    recipient_scope?: string;
    recurrence?: { frequency?: string; end_date?: string | null };
  };
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
