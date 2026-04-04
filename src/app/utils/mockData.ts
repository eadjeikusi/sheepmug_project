// Mock data for the Church Management System

export interface Member {
  id: string;
  organization_id?: string;
  branch_id?: string;
  familyIds?: string[]; // Changed from family_id?: string
  member_id_string?: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  dob?: string;
  gender?: string;
  marital_status?: string;
  occupation?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  date_joined?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  member_url?: string;
  // UI Helper fields
  fullName: string;
  profileImage: string;
  churchId: string;
  location?: string; // Legacy field used in some components
  phoneNumber?: string; // Legacy field used in some components
  emergencyContact?: string; // Legacy field used in some components
}

export interface Church {
  id: string;
  name: string;
  location: string;
  pastorId: string;
  memberCount: number;
  established: string;
}

export interface Group {
  id: string;
  name: string;
  type: 'ministry' | 'music' | 'youth' | 'other';
  leaderId: string;
  memberIds: string[];
  churchId: string;
  parentGroupId?: string;
  description: string;
  joinLink: string;
  publicViewLink: string;
  qrCodePublic: string;
  qrCodeJoin: string;
  tag: string; // Single keyword tag (e.g., "Youth", "Music", "Prayer")
}

export interface JoinRequest {
  id: string;
  groupId: string;
  memberId: string;
  requestDate: string;
  status: 'pending' | 'approved' | 'rejected';
  message?: string;
}

export interface Family {
  id: string;
  familyName: string;
  headOfHousehold: string; // member id
  memberIds: string[];
  address: string;
  phoneNumber: string;
  churchId: string;
  joinedDate: string;
}

export type FamilyGroup = Family;

export interface Pastor {
  id: string;
  fullName: string;
  profileImage: string;
  email: string;
  phoneNumber: string;
  assignedGroupIds: string[];
  churchId: string;
}

export interface Event {
  id: string;
  title: string;
  type: 'service' | 'meeting' | 'conference' | 'other';
  date: string;
  time: string;
  location: string;
  groupId?: string;
  attendanceCount: number;
  reviewLink: string;
  tags: string[];
}

export interface ActivityLog {
  id: string;
  memberId: string;
  type: 'attendance' | 'note' | 'checkup' | 'other';
  description: string;
  timestamp: string;
  urgency?: 'low' | 'medium' | 'high';
}

// Mock Members - Organized by Family Groups
export const mockMembers: Member[] = [
  // Johnson Family (Family 1)
  {
    id: '1',
    profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
    fullName: 'Michael Johnson',
    phoneNumber: '+1 (555) 123-4567',
    location: 'Downtown Branch',
    emergencyContact: '+1 (555) 123-4568',
    email: 'michael.johnson@email.com',
    churchId: '1',
  },
  {
    id: '2',
    profileImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
    fullName: 'Sarah Johnson',
    phoneNumber: '+1 (555) 123-4567',
    location: 'Downtown Branch',
    emergencyContact: '+1 (555) 123-4568',
    email: 'sarah.johnson@email.com',
    churchId: '1',
  },
  {
    id: '3',
    profileImage: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop',
    fullName: 'Emma Johnson',
    phoneNumber: '+1 (555) 123-4567',
    location: 'Downtown Branch',
    emergencyContact: '+1 (555) 123-4568',
    email: 'emma.johnson@email.com',
    churchId: '1',
  }
];

// Mock Churches
export const mockChurches: Church[] = [
  {
    id: '1',
    name: 'Grace Community Church - Downtown',
    location: 'Downtown District',
    pastorId: '1',
    memberCount: 250,
    established: '2015-08-20',
  },
  {
    id: '2',
    name: 'Grace Community Church - Westside',
    location: 'West District',
    pastorId: '2',
    memberCount: 180,
    established: '2018-03-15',
  },
  {
    id: '3',
    name: 'Grace Community Church - Eastside',
    location: 'East District',
    pastorId: '3',
    memberCount: 120,
    established: '2020-01-10',
  },
];

// Mock Pastors
export const mockPastors: Pastor[] = [
  {
    id: '1',
    fullName: 'Pastor John Williams',
    profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop',
    email: 'john.williams@gracechurch.org',
    phoneNumber: '+1 (555) 111-2222',
    assignedGroupIds: ['1', '3'],
    churchId: '1',
  },
  {
    id: '2',
    fullName: 'Pastor Maria Garcia',
    profileImage: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop',
    email: 'maria.garcia@gracechurch.org',
    phoneNumber: '+1 (555) 222-3333',
    assignedGroupIds: ['2', '4'],
    churchId: '2',
  },
  {
    id: '3',
    fullName: 'Pastor James Anderson',
    profileImage: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400&h=400&fit=crop',
    email: 'james.anderson@gracechurch.org',
    phoneNumber: '+1 (555) 333-4444',
    assignedGroupIds: ['5'],
    churchId: '3',
  },
  {
    id: '4',
    fullName: 'Pastor Sarah Johnson',
    profileImage: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=400&h=400&fit=crop',
    email: 'sarah.johnson@gracechurch.org',
    phoneNumber: '+1 (555) 444-5555',
    assignedGroupIds: ['1a', '1b', '1c'],
    churchId: '1',
  },
  {
    id: '5',
    fullName: 'Pastor David Rodriguez',
    profileImage: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&h=400&fit=crop',
    email: 'david.rodriguez@gracechurch.org',
    phoneNumber: '+1 (555) 555-6666',
    assignedGroupIds: ['2a', '2b', '2c'],
    churchId: '2',
  },
  {
    id: '6',
    fullName: 'Pastor Emily Thompson',
    profileImage: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop',
    email: 'emily.thompson@gracechurch.org',
    phoneNumber: '+1 (555) 666-7777',
    assignedGroupIds: ['3a', '3b', '3c'],
    churchId: '1',
  },
  {
    id: '7',
    fullName: 'Pastor Michael Martinez',
    profileImage: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&h=400&fit=crop',
    email: 'michael.martinez@gracechurch.org',
    phoneNumber: '+1 (555) 777-8888',
    assignedGroupIds: ['4a', '4b', '4c'],
    churchId: '2',
  },
  {
    id: '8',
    fullName: 'Pastor Robert Chen',
    profileImage: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=400&fit=crop',
    email: 'robert.chen@gracechurch.org',
    phoneNumber: '+1 (555) 888-9999',
    assignedGroupIds: ['5a', '5b'],
    churchId: '3',
  },
];

// Mock Groups (Ministries only - NO family groups here)
export const mockGroups: Group[] = [
  // Youth Ministry with Subgroups
  {
    id: '1',
    name: 'Youth Ministry',
    type: 'youth',
    leaderId: '1',
    memberIds: ['3', '4', '7', '8', '12', '15', '16', '19', '20', '22', '23', '26', '28'],
    churchId: '1',
    description: 'Ministry focused on youth development and spiritual growth for ages 13-18',
    joinLink: 'https://church.example.com/join/youth-ministry',
    publicViewLink: 'https://church.example.com/groups/youth-ministry',
    qrCodePublic: 'https://church.example.com/groups/youth-ministry/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/youth-ministry/qr-code-join',
    tag: 'Youth',
  },
  {
    id: '1a',
    name: 'Youth Worship Team',
    type: 'music',
    leaderId: '3',
    memberIds: ['3', '15', '19', '26'],
    churchId: '1',
    parentGroupId: '1',
    description: 'Youth-led worship team for youth services',
    joinLink: 'https://church.example.com/join/youth-worship',
    publicViewLink: 'https://church.example.com/groups/youth-worship',
    qrCodePublic: 'https://church.example.com/groups/youth-worship/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/youth-worship/qr-code-join',
    tag: 'Music',
  },
  {
    id: '1b',
    name: 'Youth Small Groups',
    type: 'youth',
    leaderId: '4',
    memberIds: ['4', '7', '8', '16', '20', '23', '28'],
    churchId: '1',
    parentGroupId: '1',
    description: 'Weekly small group meetings for deeper connections',
    joinLink: 'https://church.example.com/join/youth-small-groups',
    publicViewLink: 'https://church.example.com/groups/youth-small-groups',
    qrCodePublic: 'https://church.example.com/groups/youth-small-groups/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/youth-small-groups/qr-code-join',
    tag: 'Youth',
  },
  {
    id: '1c',
    name: 'Youth Outreach Team',
    type: 'youth',
    leaderId: '12',
    memberIds: ['12', '22'],
    churchId: '1',
    parentGroupId: '1',
    description: 'Reaching out to youth in the community',
    joinLink: 'https://church.example.com/join/youth-outreach',
    publicViewLink: 'https://church.example.com/groups/youth-outreach',
    qrCodePublic: 'https://church.example.com/groups/youth-outreach/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/youth-outreach/qr-code-join',
    tag: 'Youth',
  },

  // Worship Team with Subgroups
  {
    id: '2',
    name: 'Worship Team',
    type: 'music',
    leaderId: '2',
    memberIds: ['1', '13', '14', '17', '25', '26'],
    churchId: '2',
    description: 'Leading worship and praise during services with excellence',
    joinLink: 'https://church.example.com/join/worship-team',
    publicViewLink: 'https://church.example.com/groups/worship-team',
    qrCodePublic: 'https://church.example.com/groups/worship-team/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/worship-team/qr-code-join',
    tag: 'Music',
  },
  {
    id: '2a',
    name: 'Vocal Team',
    type: 'music',
    leaderId: '25',
    memberIds: ['25', '26'],
    churchId: '2',
    parentGroupId: '2',
    description: 'Lead vocalists and choir members',
    joinLink: 'https://church.example.com/join/vocal-team',
    publicViewLink: 'https://church.example.com/groups/vocal-team',
    qrCodePublic: 'https://church.example.com/groups/vocal-team/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/vocal-team/qr-code-join',
    tag: 'Music',
  },
  {
    id: '2b',
    name: 'Instrumental Team',
    type: 'music',
    leaderId: '1',
    memberIds: ['1', '13', '17'],
    churchId: '2',
    parentGroupId: '2',
    description: 'Musicians playing instruments for worship',
    joinLink: 'https://church.example.com/join/instrumental-team',
    publicViewLink: 'https://church.example.com/groups/instrumental-team',
    qrCodePublic: 'https://church.example.com/groups/instrumental-team/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/instrumental-team/qr-code-join',
    tag: 'Music',
  },
  {
    id: '2c',
    name: 'Sound & Tech Team',
    type: 'other',
    leaderId: '14',
    memberIds: ['14'],
    churchId: '2',
    parentGroupId: '2',
    description: 'Audio/visual and technical support for worship',
    joinLink: 'https://church.example.com/join/sound-tech',
    publicViewLink: 'https://church.example.com/groups/sound-tech',
    qrCodePublic: 'https://church.example.com/groups/sound-tech/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/sound-tech/qr-code-join',
    tag: 'Tech',
  },

  // Children Ministry with Subgroups
  {
    id: '3',
    name: 'Children Ministry',
    type: 'ministry',
    leaderId: '1',
    memberIds: ['2', '3', '7', '15', '18', '20', '23', '25', '27'],
    churchId: '1',
    description: 'Teaching and caring for children in the church (ages 3-12)',
    joinLink: 'https://church.example.com/join/children-ministry',
    publicViewLink: 'https://church.example.com/groups/children-ministry',
    qrCodePublic: 'https://church.example.com/groups/children-ministry/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/children-ministry/qr-code-join',
    tag: 'Children',
  },
  {
    id: '3a',
    name: 'Nursery Team',
    type: 'ministry',
    leaderId: '2',
    memberIds: ['2', '18'],
    churchId: '1',
    parentGroupId: '3',
    description: 'Care for infants and toddlers (ages 0-3)',
    joinLink: 'https://church.example.com/join/nursery',
    publicViewLink: 'https://church.example.com/groups/nursery',
    qrCodePublic: 'https://church.example.com/groups/nursery/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/nursery/qr-code-join',
    tag: 'Children',
  },
  {
    id: '3b',
    name: 'Elementary Team',
    type: 'ministry',
    leaderId: '25',
    memberIds: ['7', '15', '20', '23', '25', '27'],
    churchId: '1',
    parentGroupId: '3',
    description: 'Teaching elementary-aged children (ages 6-12)',
    joinLink: 'https://church.example.com/join/elementary',
    publicViewLink: 'https://church.example.com/groups/elementary',
    qrCodePublic: 'https://church.example.com/groups/elementary/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/elementary/qr-code-join',
    tag: 'Children',
  },
  {
    id: '3c',
    name: 'Kids Worship',
    type: 'music',
    leaderId: '3',
    memberIds: ['3'],
    churchId: '1',
    parentGroupId: '3',
    description: 'Leading worship for children services',
    joinLink: 'https://church.example.com/join/kids-worship',
    publicViewLink: 'https://church.example.com/groups/kids-worship',
    qrCodePublic: 'https://church.example.com/groups/kids-worship/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/kids-worship/qr-code-join',
    tag: 'Music',
  },

  // Prayer Warriors with Subgroups
  {
    id: '4',
    name: 'Prayer Warriors',
    type: 'ministry',
    leaderId: '2',
    memberIds: ['2', '6', '9', '11', '14', '18', '21'],
    churchId: '2',
    description: 'Dedicated prayer and intercession group meeting weekly',
    joinLink: 'https://church.example.com/join/prayer-warriors',
    publicViewLink: 'https://church.example.com/groups/prayer-warriors',
    qrCodePublic: 'https://church.example.com/groups/prayer-warriors/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/prayer-warriors/qr-code-join',
    tag: 'Prayer',
  },
  {
    id: '4a',
    name: 'Morning Prayer',
    type: 'ministry',
    leaderId: '6',
    memberIds: ['6', '9', '18'],
    churchId: '2',
    parentGroupId: '4',
    description: 'Early morning prayer meetings',
    joinLink: 'https://church.example.com/join/morning-prayer',
    publicViewLink: 'https://church.example.com/groups/morning-prayer',
    qrCodePublic: 'https://church.example.com/groups/morning-prayer/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/morning-prayer/qr-code-join',
    tag: 'Prayer',
  },
  {
    id: '4b',
    name: 'Intercessory Prayer',
    type: 'ministry',
    leaderId: '2',
    memberIds: ['2', '11', '21'],
    churchId: '2',
    parentGroupId: '4',
    description: 'Deep intercession for church and community',
    joinLink: 'https://church.example.com/join/intercessory',
    publicViewLink: 'https://church.example.com/groups/intercessory',
    qrCodePublic: 'https://church.example.com/groups/intercessory/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/intercessory/qr-code-join',
    tag: 'Prayer',
  },
  {
    id: '4c',
    name: 'Prayer Chain',
    type: 'ministry',
    leaderId: '14',
    memberIds: ['14'],
    churchId: '2',
    parentGroupId: '4',
    description: 'Coordinating urgent prayer requests',
    joinLink: 'https://church.example.com/join/prayer-chain',
    publicViewLink: 'https://church.example.com/groups/prayer-chain',
    qrCodePublic: 'https://church.example.com/groups/prayer-chain/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/prayer-chain/qr-code-join',
    tag: 'Prayer',
  },

  // Community Outreach with Subgroups
  {
    id: '5',
    name: 'Community Outreach',
    type: 'ministry',
    leaderId: '3',
    memberIds: ['5', '10', '13', '24'],
    churchId: '3',
    description: 'Serving the local community with love and practical help',
    joinLink: 'https://church.example.com/join/community-outreach',
    publicViewLink: 'https://church.example.com/groups/community-outreach',
    qrCodePublic: 'https://church.example.com/groups/community-outreach/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/community-outreach/qr-code-join',
    tag: 'Outreach',
  },
  {
    id: '5a',
    name: 'Food Bank Ministry',
    type: 'ministry',
    leaderId: '24',
    memberIds: ['24', '13'],
    churchId: '3',
    parentGroupId: '5',
    description: 'Distributing food to families in need',
    joinLink: 'https://church.example.com/join/food-bank',
    publicViewLink: 'https://church.example.com/groups/food-bank',
    qrCodePublic: 'https://church.example.com/groups/food-bank/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/food-bank/qr-code-join',
    tag: 'Outreach',
  },
  {
    id: '5b',
    name: 'Street Evangelism',
    type: 'ministry',
    leaderId: '5',
    memberIds: ['5', '10'],
    churchId: '3',
    parentGroupId: '5',
    description: 'Sharing the gospel in the streets',
    joinLink: 'https://church.example.com/join/street-evangelism',
    publicViewLink: 'https://church.example.com/groups/street-evangelism',
    qrCodePublic: 'https://church.example.com/groups/street-evangelism/qr-code-public',
    qrCodeJoin: 'https://church.example.com/groups/street-evangelism/qr-code-join',
    tag: 'Outreach',
  },
];

// Mock Family Groups
export const mockFamilies: Family[] = [
  {
    id: '1',
    familyName: 'Johnson Family',
    headOfHousehold: '1',
    memberIds: ['1', '2', '3', '4'],
    address: '123 Main Street, Downtown District',
    phoneNumber: '+1 (555) 123-4567',
    churchId: '1',
    joinedDate: '2023-01-15',
  },
  {
    id: '2',
    familyName: 'Rodriguez Family',
    headOfHousehold: '5',
    memberIds: ['5', '6', '7', '8', '9'],
    address: '456 Oak Avenue, West District',
    phoneNumber: '+1 (555) 345-6789',
    churchId: '2',
    joinedDate: '2023-03-10',
  },
  {
    id: '3',
    familyName: 'Thompson Family',
    headOfHousehold: '10',
    memberIds: ['10', '11', '12'],
    address: '789 Pine Road, East District',
    phoneNumber: '+1 (555) 456-7890',
    churchId: '3',
    joinedDate: '2021-11-05',
  },
  {
    id: '4',
    familyName: 'Williams Family',
    headOfHousehold: '13',
    memberIds: ['13', '14', '15', '16'],
    address: '321 Elm Street, Downtown District',
    phoneNumber: '+1 (555) 567-8901',
    churchId: '1',
    joinedDate: '2024-02-01',
  },
  {
    id: '5',
    familyName: 'Chen Family',
    headOfHousehold: '17',
    memberIds: ['17', '18', '19', '20'],
    address: '654 Maple Drive, West District',
    phoneNumber: '+1 (555) 678-9012',
    churchId: '2',
    joinedDate: '2022-06-20',
  },
  {
    id: '6',
    familyName: 'Martinez Family',
    headOfHousehold: '21',
    memberIds: ['21', '22', '23'],
    address: '987 Cedar Lane, East District',
    phoneNumber: '+1 (555) 789-0123',
    churchId: '3',
    joinedDate: '2023-09-15',
  },
  {
    id: '7',
    familyName: 'Anderson Family',
    headOfHousehold: '24',
    memberIds: ['24', '25', '26', '27', '28'],
    address: '147 Birch Boulevard, Downtown District',
    phoneNumber: '+1 (555) 890-1234',
    churchId: '1',
    joinedDate: '2020-05-10',
  },
];

// Mock Events
export const mockEvents: Event[] = [
  {
    id: '1',
    title: 'Sunday Service',
    type: 'service',
    date: '2026-03-07',
    time: '10:00 AM',
    location: 'Main Sanctuary',
    attendanceCount: 245,
    reviewLink: 'https://church.example.com/events/1/review',
    tags: ['worship', 'teaching'],
  },
  {
    id: '2',
    title: 'Youth Meeting',
    type: 'meeting',
    date: '2026-03-10',
    time: '6:30 PM',
    location: 'Youth Center',
    groupId: '1',
    attendanceCount: 42,
    reviewLink: 'https://church.example.com/events/2/review',
    tags: ['youth', 'fellowship'],
  },
  {
    id: '3',
    title: 'Spring Conference',
    type: 'conference',
    date: '2026-03-15',
    time: '9:00 AM',
    location: 'Convention Center',
    attendanceCount: 520,
    reviewLink: 'https://church.example.com/events/3/review',
    tags: ['conference', 'leadership'],
  },
  {
    id: '4',
    title: 'Prayer Meeting',
    type: 'meeting',
    date: '2026-03-12',
    time: '7:00 PM',
    location: 'Prayer Room',
    groupId: '4',
    attendanceCount: 28,
    reviewLink: 'https://church.example.com/events/4/review',
    tags: ['prayer', 'intercession'],
  },
];

// Mock Activity Logs
export const mockActivityLogs: ActivityLog[] = [
  {
    id: '1',
    memberId: '2',
    type: 'attendance',
    description: 'Attended Sunday Service',
    timestamp: '2026-02-28T10:00:00Z',
  },
  {
    id: '2',
    memberId: '10',
    type: 'note',
    description: 'Member expressed interest in volunteering',
    timestamp: '2026-02-25T14:30:00Z',
    urgency: 'medium',
  },
  {
    id: '3',
    memberId: '1',
    type: 'checkup',
    description: 'Follow-up call completed',
    timestamp: '2026-03-01T16:00:00Z',
  },
  {
    id: '4',
    memberId: '10',
    type: 'attendance',
    description: 'Missed last 2 services',
    timestamp: '2026-03-01T09:00:00Z',
    urgency: 'high',
  },
];

export const getStats = () => ({
  totalMembers: mockMembers.length,
  totalChurches: mockChurches.length,
  totalGroups: mockGroups.length,
  totalFamilies: mockFamilies.length,
  totalEvents: mockEvents.length,
  averageAttendance: Math.round(mockMembers.reduce((acc, m) => acc + m.attendanceRate, 0) / mockMembers.length),
  upcomingEvents: mockEvents.filter(e => new Date(e.date) >= new Date()).length,
});

// Mock Join Requests
export const mockJoinRequests: JoinRequest[] = [
  {
    id: 'req1',
    groupId: '1',
    memberId: '10',
    requestDate: '2026-03-01T14:30:00Z',
    status: 'pending',
    message: 'I would love to help mentor the youth and share my testimony with them.',
  },
  {
    id: 'req2',
    groupId: '2',
    memberId: '11',
    requestDate: '2026-02-28T10:15:00Z',
    status: 'pending',
    message: 'I play piano and would love to contribute to the worship team.',
  },
  {
    id: 'req3',
    groupId: '1',
    memberId: '21',
    requestDate: '2026-02-27T16:45:00Z',
    status: 'pending',
    message: 'My son is interested in joining the youth ministry. Can we both join?',
  },
  {
    id: 'req4',
    groupId: '3',
    memberId: '5',
    requestDate: '2026-02-26T09:20:00Z',
    status: 'approved',
    message: 'I have experience working with children and would like to volunteer.',
  },
  {
    id: 'req5',
    groupId: '4',
    memberId: '24',
    requestDate: '2026-02-25T11:00:00Z',
    status: 'approved',
    message: 'I feel called to intercessory prayer and would like to join this group.',
  },
  {
    id: 'req6',
    groupId: '2',
    memberId: '9',
    requestDate: '2026-02-24T13:30:00Z',
    status: 'rejected',
    message: 'I sing in my church choir and want to join the worship team.',
  },
  {
    id: 'req7',
    groupId: '1a',
    memberId: '27',
    requestDate: '2026-03-02T15:00:00Z',
    status: 'pending',
    message: 'I play guitar and am passionate about leading youth worship.',
  },
  {
    id: 'req8',
    groupId: '5',
    memberId: '14',
    requestDate: '2026-03-01T08:45:00Z',
    status: 'pending',
    message: 'I want to serve the community and help with outreach programs.',
  },
];