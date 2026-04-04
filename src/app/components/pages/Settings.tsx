import { useState, useEffect, useCallback } from 'react';
import { User, Bell, Shield, Database, Palette, Globe, Users, CheckSquare, Square, Save, Plus, Trash2, GripVertical, Type, Hash, Calendar as CalendarIcon, CheckCircle, List, FileText, Upload, Edit, Edit2, MessageSquare, Phone, Mail, Key, Tag, MapPin, Building2, ChevronRight, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';
import DatabaseConnectionTest from '../DatabaseConnectionTest';
import BranchModal from '../modals/BranchModal';
import { useApp } from '../../contexts/AppContext';

type Permission = {
  id: string;
  name: string;
  description: string;
};

type Role = {
  id: string;
  name: string;
  color: string;
  description: string;
  permissions: Set<string>;
};

type FieldType = 'text' | 'number' | 'email' | 'phone' | 'date' | 'dropdown' | 'checkbox' | 'textarea' | 'file';

type CustomField = {
  id: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  placeholder?: string;
  options?: string[]; // For dropdown
  defaultValue?: string;
  appliesTo: ('member' | 'event')[];
};

type EventType = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  isDefault: boolean;
};

type Ministry = {
  id: string;
  name: string;
  children?: Ministry[];
};

const allPermissions: Permission[] = [
  { id: 'view_dashboard', name: 'View Dashboard', description: 'Access dashboard and analytics' },
  { id: 'view_members', name: 'View Members', description: 'View member list and details' },
  { id: 'add_members', name: 'Add Members', description: 'Register new members' },
  { id: 'edit_members', name: 'Edit Members', description: 'Modify member information' },
  { id: 'delete_members', name: 'Delete Members', description: 'Remove members from system' },
  { id: 'view_groups', name: 'View Groups', description: 'View ministry groups' },
  { id: 'manage_groups', name: 'Manage Groups', description: 'Create, edit, and delete groups' },
  { id: 'assign_groups', name: 'Assign to Groups', description: 'Add/remove members from groups' },
  { id: 'view_branches', name: 'View Branches', description: 'View church branches' },
  { id: 'manage_branches', name: 'Manage Branches', description: 'Create and edit branches' },
  { id: 'view_events', name: 'View Events', description: 'View scheduled events' },
  { id: 'manage_events', name: 'Manage Events', description: 'Create, edit, and delete events' },
  { id: 'track_attendance', name: 'Track Attendance', description: 'Mark attendance for events' },
  { id: 'view_analytics', name: 'View Analytics', description: 'Access reports and analytics' },
  { id: 'send_messages', name: 'Send Messages', description: 'Send messages to members' },
  { id: 'manage_notifications', name: 'Manage Notifications', description: 'Send system notifications' },
  { id: 'export_data', name: 'Export Data', description: 'Export data to CSV/PDF' },
  { id: 'manage_permissions', name: 'Manage Permissions', description: 'Assign roles and permissions' },
  { id: 'system_settings', name: 'System Settings', description: 'Configure system-wide settings' },
];

const defaultRoles: Role[] = [
  {
    id: 'admin',
    name: 'Admin',
    color: 'bg-red-500',
    description: 'Full system access with all permissions',
    permissions: new Set(allPermissions.map(p => p.id)),
  },
  {
    id: 'pastor',
    name: 'Pastor',
    color: 'bg-indigo-500',
    description: 'Senior leadership with broad access',
    permissions: new Set([
      'view_dashboard', 'view_members', 'add_members', 'edit_members',
      'view_groups', 'manage_groups', 'assign_groups', 'view_branches',
      'view_events', 'manage_events', 'track_attendance', 'view_analytics',
      'send_messages', 'manage_notifications', 'export_data'
    ]),
  },
  {
    id: 'group_leader',
    name: 'Group Leader',
    color: 'bg-green-500',
    description: 'Manage specific ministry groups',
    permissions: new Set([
      'view_dashboard', 'view_members', 'view_groups', 'assign_groups',
      'view_events', 'track_attendance', 'send_messages'
    ]),
  },
  {
    id: 'volunteer',
    name: 'Volunteer',
    color: 'bg-blue-500',
    description: 'Basic access for volunteers',
    permissions: new Set([
      'view_dashboard', 'view_members', 'view_groups', 'view_events'
    ]),
  },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'general' | 'permissions' | 'customFields' | 'eventTypes' | 'integrations' | 'branches' | 'database'>('general');
  const [roles, setRoles] = useState<Role[]>(defaultRoles);
  const { selectedBranch, setSelectedBranch, branches, refreshBranches } = useBranch();
  const { currentOrganization } = useApp();
  const { user } = useAuth();
  
  // Debug: Check auth status on component mount
  useEffect(() => {
  }, [user, currentOrganization, branches]);
  
  const [showAssignLeaderModal, setShowAssignLeaderModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState('');
  const [selectedRole, setSelectedRole] = useState('group_leader');
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  const [expandedMinistries, setExpandedMinistries] = useState<Set<string>>(new Set());
  
  // Branch management states
  const [dbBranches, setDbBranches] = useState<any[]>([]);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<any | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([
    {
      id: '1',
      label: 'Emergency Contact',
      fieldType: 'phone',
      required: true,
      placeholder: 'Enter emergency contact number',
      appliesTo: ['member'],
    },
    {
      id: '2',
      label: 'Preferred Ministry',
      fieldType: 'dropdown',
      required: false,
      options: ['Worship Team', 'Children Ministry', 'Youth Ministry', 'Outreach'],
      appliesTo: ['member'],
    },
  ]);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);

  // Event Types
  const [eventTypes, setEventTypes] = useState<EventType[]>([
    { id: '1', name: 'Service', emoji: '⛪', color: 'bg-purple-500', isDefault: true },
    { id: '2', name: 'Meeting', emoji: '👥', color: 'bg-blue-500', isDefault: true },
    { id: '3', name: 'Conference', emoji: '🎯', color: 'bg-orange-500', isDefault: true },
    { id: '4', name: 'Other', emoji: '📅', color: 'bg-gray-500', isDefault: true },
  ]);
  const [showEventTypeEditor, setShowEventTypeEditor] = useState(false);
  const [editingEventType, setEditingEventType] = useState<EventType | null>(null);

  // Integration states
  const [integrationTab, setIntegrationTab] = useState<'whatsapp' | 'sms' | 'email'>('whatsapp');
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);

  const togglePermission = (roleId: string, permissionId: string) => {
    setRoles(roles.map(role => {
      if (role.id === roleId) {
        const newPermissions = new Set(role.permissions);
        if (newPermissions.has(permissionId)) {
          newPermissions.delete(permissionId);
        } else {
          newPermissions.add(permissionId);
        }
        return { ...role, permissions: newPermissions };
      }
      return role;
    }));
  };

  const handleSavePermissions = () => {
    // In real implementation, this would save to backend
    toast.success('Permissions saved successfully!');
  };

  // Sample data for member selection
  const mockMembers = [
    { id: '1', name: 'Emma Thompson', email: 'emma.t@church.com', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100' },
    { id: '2', name: 'David Martinez', email: 'david.m@church.com', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100' },
    { id: '3', name: 'Lisa Anderson', email: 'lisa.a@church.com', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100' },
    { id: '4', name: 'James Wilson', email: 'james.w@church.com', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100' },
  ];

  // Sample ministries with tree structure
  const availableMinistries: Ministry[] = [
    {
      id: 'worship',
      name: 'Worship Team',
      children: [
        { id: 'worship-vocals', name: 'Vocals' },
        { id: 'worship-instruments', name: 'Instruments' },
        { id: 'worship-tech', name: 'Technical Support' }
      ]
    },
    {
      id: 'youth',
      name: 'Youth Ministry',
      children: [
        { id: 'youth-teens', name: 'Teenagers (13-17)' },
        { id: 'youth-young-adults', name: 'Young Adults (18-25)' }
      ]
    },
    {
      id: 'children',
      name: 'Children Ministry',
      children: [
        { id: 'children-nursery', name: 'Nursery (0-2)' },
        { id: 'children-preschool', name: 'Preschool (3-5)' },
        { id: 'children-elementary', name: 'Elementary (6-12)' }
      ]
    },
    {
      id: 'media',
      name: 'Media Ministry',
      children: [
        { id: 'media-sound', name: 'Sound Engineering' },
        { id: 'media-video', name: 'Video Production' },
        { id: 'media-graphics', name: 'Graphics & Design' }
      ]
    },
    { id: 'outreach', name: 'Outreach' },
    { id: 'prayer', name: 'Prayer Ministry' },
    { id: 'community', name: 'Community' },
    { id: 'missions', name: 'Missions' },
    { id: 'events', name: 'Events' },
    { id: 'sunday-school', name: 'Sunday School' },
    { id: 'intercession', name: 'Intercession' },
    { id: 'hospitality', name: 'Hospitality' },
    { id: 'ushers', name: 'Ushers' }
  ];

  const handleAssignLeader = () => {
    if (!selectedMember) {
      toast.error('Please select a member');
      return;
    }
    if (selectedMinistries.length === 0) {
      toast.error('Please select at least one ministry');
      return;
    }
    
    // In real implementation, this would save to backend
    toast.success('Leader assigned successfully!');
    setShowAssignLeaderModal(false);
    setSelectedMember('');
    setSelectedRole('group_leader');
    setSelectedMinistries([]);
    setExpandedMinistries(new Set());
  };

  const toggleMinistry = (ministryId: string) => {
    setSelectedMinistries(prev =>
      prev.includes(ministryId)
        ? prev.filter(m => m !== ministryId)
        : [...prev, ministryId]
    );
  };

  const toggleExpanded = (ministryId: string) => {
    setExpandedMinistries(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ministryId)) {
        newSet.delete(ministryId);
      } else {
        newSet.add(ministryId);
      }
      return newSet;
    });
  };

  const renderMinistryTree = (ministry: Ministry, level: number = 0) => {
    const hasChildren = ministry.children && ministry.children.length > 0;
    const isExpanded = expandedMinistries.has(ministry.id);
    const isSelected = selectedMinistries.includes(ministry.id);

    return (
      <div key={ministry.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(ministry.id);
            }
            toggleMinistry(ministry.id);
          }}
          className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all text-left flex items-center ${
            isSelected
              ? 'border-purple-500 bg-purple-100 text-purple-700'
              : 'border-gray-200 hover:border-gray-300 text-gray-700 bg-white'
          }`}
          style={{ marginLeft: `${level * 20}px` }}
        >
          {hasChildren && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(ministry.id);
              }}
              className="mr-1 flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
          )}
          {!hasChildren && <span className="w-4 mr-1" />}
          <span className="flex-1">{ministry.name}</span>
          {isSelected && (
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>
        {hasChildren && isExpanded && (
          <div className="mt-1 space-y-1">
            {ministry.children!.map(child => renderMinistryTree(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const fetchBranches = useCallback(async () => {
    setLoadingBranches(true);
    setTimeout(() => {
      setDbBranches(branches || []);
      setLoadingBranches(false);
    }, 500);
  }, [branches]);

  // Fetch branches from database (Mocked)
  useEffect(() => {
    if (activeTab === 'branches') {
      fetchBranches();
    }
  }, [activeTab, fetchBranches]);

  const handleSaveBranch = async (branchData: any) => {
    toast.success(editingBranch ? 'Branch updated successfully!' : 'Branch created successfully!');
    setShowBranchModal(false);
    setEditingBranch(null);
  };

  const handleDeleteBranch = async (branchId: string) => {
    if (!confirm('Are you sure you want to delete this branch? This action cannot be undone.')) {
      return;
    }
    toast.success('Branch deleted successfully!');
  };

  const settingsSections = [
    {
      icon: User,
      title: 'Profile Settings',
      description: 'Manage your account information and preferences',
      color: 'bg-blue-50',
      iconColor: 'text-blue-600',
    },
    {
      icon: Bell,
      title: 'Notifications',
      description: 'Configure how you receive notifications',
      color: 'bg-purple-50',
      iconColor: 'text-purple-600',
    },
    {
      icon: Shield,
      title: 'Privacy & Security',
      description: 'Control your privacy and security settings',
      color: 'bg-green-50',
      iconColor: 'text-green-600',
    },
    {
      icon: Database,
      title: 'Data Management',
      description: 'Import, export, and manage your data',
      color: 'bg-orange-50',
      iconColor: 'text-orange-600',
    },
    {
      icon: Palette,
      title: 'Appearance',
      description: 'Customize the look and feel',
      color: 'bg-pink-50',
      iconColor: 'text-pink-600',
    },
    {
      icon: Globe,
      title: 'Church Settings',
      description: 'Configure church-wide settings',
      color: 'bg-indigo-50',
      iconColor: 'text-indigo-600',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-semibold text-gray-900 text-[24px]">Settings</h1>
        <p className="mt-2 text-gray-500">Manage your application settings and preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'general'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          General Settings
        </button>
        <button
          onClick={() => setActiveTab('permissions')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'permissions'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" />
          Roles & Permissions
        </button>
        <button
          onClick={() => setActiveTab('customFields')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'customFields'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Type className="w-4 h-4 inline mr-2" />
          Custom Fields
        </button>
        <button
          onClick={() => setActiveTab('eventTypes')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'eventTypes'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tag className="w-4 h-4 inline mr-2" />
          Event Types
        </button>
        <button
          onClick={() => setActiveTab('integrations')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'integrations'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <MessageSquare className="w-4 h-4 inline mr-2" />
          Integrations
        </button>
        <button
          onClick={() => setActiveTab('branches')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'branches'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 className="w-4 h-4 inline mr-2" />
          Branch Selection
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'database'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Database className="w-4 h-4 inline mr-2" />
          Database
        </button>
      </div>

      {/* General Settings Tab */}
      {activeTab === 'general' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {settingsSections.map((section, index) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => toast.info(`Opening ${section.title}...`)}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className={`w-12 h-12 ${section.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <section.icon className={`w-6 h-6 ${section.iconColor}`} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{section.title}</h3>
              <p className="text-sm text-gray-600">{section.description}</p>
              <div className="mt-4 text-sm text-indigo-600 font-medium group-hover:translate-x-1 transition-transform inline-flex items-center">
                Configure →
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
          {/* Header with Save Button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 text-[16px]">Manage User Roles</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure permissions for different user roles in your organization
              </p>
            </div>
            <button
              onClick={handleSavePermissions}
              className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all text-[14px]"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </button>
          </div>

          {/* Leaders Assignment Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Section Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 text-[16px]">Leaders & Ministry Assignments</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Assign members as leaders and manage their ministry responsibilities
                  </p>
                </div>
                <button
                  onClick={() => setShowAssignLeaderModal(true)}
                  className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all text-[14px]"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Assign Leader
                </button>
              </div>
            </div>

            {/* Leaders Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Leader
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Ministries
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {/* Leader Row 1 */}
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <img
                          src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop"
                          alt="Leader"
                          className="w-10 h-10 rounded-xl object-cover"
                        />
                        <div>
                          <p className="font-medium text-gray-900 text-[13px]">John Smith</p>
                          <p className="text-sm text-gray-500">john.smith@church.com</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option>Pastor</option>
                        <option>Group Leader</option>
                        <option>Volunteer</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Worship Team
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Sound
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Media
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Leader Row 2 */}
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <img
                          src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop"
                          alt="Leader"
                          className="w-10 h-10 rounded-xl object-cover"
                        />
                        <div>
                          <p className="font-medium text-gray-900 text-[13px]">Sarah Johnson</p>
                          <p className="text-sm text-gray-500">sarah.j@church.com</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option>Group Leader</option>
                        <option>Pastor</option>
                        <option>Volunteer</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Youth Ministry
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Sunday School
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Leader Row 3 */}
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <img
                          src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop"
                          alt="Leader"
                          className="w-10 h-10 rounded-xl object-cover"
                        />
                        <div>
                          <p className="font-medium text-gray-900 text-[13px]">Michael Chen</p>
                          <p className="text-sm text-gray-500">m.chen@church.com</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option>Pastor</option>
                        <option>Group Leader</option>
                        <option>Volunteer</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Outreach
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Community
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Missions
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Events
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Leader Row 4 */}
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <img
                          src="https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop"
                          alt="Leader"
                          className="w-10 h-10 rounded-xl object-cover"
                        />
                        <div>
                          <p className="font-medium text-gray-900 text-[13px]">Emily Davis</p>
                          <p className="text-sm text-gray-500">emily.d@church.com</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option>Group Leader</option>
                        <option>Pastor</option>
                        <option>Volunteer</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Prayer Ministry
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-100 text-purple-700">
                          Intercession
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">4</span> leaders
              </p>
              <div className="flex items-center space-x-2">
                <button className="px-3 py-1.5 text-sm text-gray-600 hover:bg-white rounded-lg border border-gray-200 transition-all">
                  Previous
                </button>
                <button className="px-3 py-1.5 text-sm text-gray-600 hover:bg-white rounded-lg border border-gray-200 transition-all">
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Roles Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {roles.map((role) => (
              <div
                key={role.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                {/* Role Header */}
                <div className={`${role.color} px-6 py-4`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-white text-[15px]">{role.name}</h3>
                      <p className="text-sm text-white/90 mt-1">{role.description}</p>
                    </div>
                    <div className="bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5">
                      <span className="text-sm font-medium text-white">
                        {role.permissions.size}/{allPermissions.length}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Permissions List */}
                <div className="p-6">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Permissions
                  </h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {allPermissions.map((permission) => {
                      const hasPermission = role.permissions.has(permission.id);
                      const isAdmin = role.id === 'admin';
                      
                      return (
                        <button
                          key={permission.id}
                          onClick={() => !isAdmin && togglePermission(role.id, permission.id)}
                          disabled={isAdmin}
                          className={`w-full flex items-start space-x-3 p-3 rounded-lg transition-all text-left ${
                            isAdmin
                              ? 'bg-gray-50 cursor-not-allowed opacity-75'
                              : 'hover:bg-gray-50 cursor-pointer'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                            hasPermission
                              ? `${role.color} border-transparent`
                              : 'bg-white border-gray-300'
                          }`}>
                            {hasPermission && (
                              <CheckSquare className="w-3 h-3 text-white" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 text-[13px]">{permission.name}</p>
                            <p className="text-gray-500 mt-0.5 text-[12px]">{permission.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {role.id === 'admin' && (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        🔒 Admin role has all permissions by default and cannot be modified
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Permission Categories Legend */}
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Permission Categories</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Member Management</p>
                  <p className="text-sm text-gray-500 mt-0.5">View, add, edit, and delete members</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Group Management</p>
                  <p className="text-sm text-gray-500 mt-0.5">Manage ministries and assign members</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Database className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">System Access</p>
                  <p className="text-sm text-gray-500 mt-0.5">Analytics, exports, and settings</p>
                </div>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900">About Roles & Permissions</h4>
                <p className="text-sm text-gray-600 mt-2">
                  Roles define what users can do in the system. Assign roles to users to control their access levels. Changes to permissions will take effect immediately for all users with that role.
                </p>
                <div className="mt-3 flex items-center space-x-4 text-xs text-gray-500">
                  <span>• Admin: Full access</span>
                  <span>• Pastor: Leadership access</span>
                  <span>• Group Leader: Ministry management</span>
                  <span>• Volunteer: Basic access</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Fields Tab */}
      {activeTab === 'customFields' && (
        <div className="space-y-6">
          {/* Header with Add Button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Manage Custom Fields</h2>
              <p className="text-sm text-gray-500 mt-1">
                Add and configure custom fields for members and events
              </p>
            </div>
            <button
              onClick={() => {
                setEditingField(null);
                setShowFieldEditor(true);
              }}
              className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Field
            </button>
          </div>

          {/* Custom Fields Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {customFields.map((field) => (
              <div
                key={field.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                {/* Field Header */}
                <div className="bg-gray-50 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{field.label}</h3>
                      <p className="text-sm text-gray-500 mt-1">{field.fieldType}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          setEditingField(field);
                          setShowFieldEditor(true);
                        }}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setCustomFields(customFields.filter(f => f.id !== field.id));
                          toast.success('Field deleted successfully!');
                        }}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Field Details */}
                <div className="p-6">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Details
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <CheckSquare className="w-4 h-4 text-gray-500" />
                      <p className="text-sm text-gray-500">
                        {field.required ? 'Required' : 'Optional'}
                      </p>
                    </div>
                    {field.placeholder && (
                      <div className="flex items-center space-x-2">
                        <Type className="w-4 h-4 text-gray-500" />
                        <p className="text-sm text-gray-500">
                          Placeholder: {field.placeholder}
                        </p>
                      </div>
                    )}
                    {field.options && (
                      <div className="flex items-center space-x-2">
                        <List className="w-4 h-4 text-gray-500" />
                        <p className="text-sm text-gray-500">
                          Options: {field.options.join(', ')}
                        </p>
                      </div>
                    )}
                    {field.defaultValue && (
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 text-gray-500" />
                        <p className="text-sm text-gray-500">
                          Default Value: {field.defaultValue}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <Users className="w-4 h-4 text-gray-500" />
                      <p className="text-sm text-gray-500">
                        Applies To: {field.appliesTo.join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Field Editor */}
          {showFieldEditor && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-6">
              <div className="bg-gray-50 px-6 py-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingField ? 'Edit Field' : 'Add New Field'}
                </h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Label</label>
                    <input
                      type="text"
                      value={editingField?.label || ''}
                      onChange={(e) => {
                        if (editingField) {
                          setEditingField({ ...editingField, label: e.target.value });
                        }
                      }}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Field Type</label>
                    <select
                      value={editingField?.fieldType || 'text'}
                      onChange={(e) => {
                        if (editingField) {
                          setEditingField({ ...editingField, fieldType: e.target.value as FieldType });
                        }
                      }}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      <option value="date">Date</option>
                      <option value="dropdown">Dropdown</option>
                      <option value="checkbox">Checkbox</option>
                      <option value="textarea">Textarea</option>
                      <option value="file">File</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Required</label>
                    <div className="mt-1">
                      <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={editingField?.required || false}
                          onChange={(e) => {
                            if (editingField) {
                              setEditingField({ ...editingField, required: e.target.checked });
                            }
                          }}
                          className="form-checkbox h-4 w-4 text-indigo-600"
                        />
                        <span className="ml-2 text-sm text-gray-500">This field is required</span>
                      </label>
                    </div>
                  </div>
                  {editingField?.fieldType === 'text' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Placeholder</label>
                      <input
                        type="text"
                        value={editingField?.placeholder || ''}
                        onChange={(e) => {
                          if (editingField) {
                            setEditingField({ ...editingField, placeholder: e.target.value });
                          }
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                  )}
                  {editingField?.fieldType === 'dropdown' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Options</label>
                      <input
                        type="text"
                        value={editingField?.options?.join(', ') || ''}
                        onChange={(e) => {
                          if (editingField) {
                            setEditingField({ ...editingField, options: e.target.value.split(',').map(o => o.trim()) });
                          }
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                  )}
                  {editingField?.fieldType === 'checkbox' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Default Value</label>
                      <div className="mt-1">
                        <label className="inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={editingField?.defaultValue === 'true'}
                            onChange={(e) => {
                              if (editingField) {
                                setEditingField({ ...editingField, defaultValue: e.target.checked ? 'true' : 'false' });
                              }
                            }}
                            className="form-checkbox h-4 w-4 text-indigo-600"
                          />
                          <span className="ml-2 text-sm text-gray-500">Checked by default</span>
                        </label>
                      </div>
                    </div>
                  )}
                  {editingField?.fieldType === 'textarea' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Placeholder</label>
                      <input
                        type="text"
                        value={editingField?.placeholder || ''}
                        onChange={(e) => {
                          if (editingField) {
                            setEditingField({ ...editingField, placeholder: e.target.value });
                          }
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                  )}
                  {editingField?.fieldType === 'file' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Placeholder</label>
                      <input
                        type="text"
                        value={editingField?.placeholder || ''}
                        onChange={(e) => {
                          if (editingField) {
                            setEditingField({ ...editingField, placeholder: e.target.value });
                          }
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-700">Applies To</label>
                    <div className="mt-1">
                      <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={editingField?.appliesTo.includes('member')}
                          onChange={(e) => {
                            if (editingField) {
                              const newAppliesTo = e.target.checked
                                ? [...editingField.appliesTo, 'member']
                                : editingField.appliesTo.filter(a => a !== 'member');
                              setEditingField({ ...editingField, appliesTo: newAppliesTo });
                            }
                          }}
                          className="form-checkbox h-4 w-4 text-indigo-600"
                        />
                        <span className="ml-2 text-sm text-gray-500">Members</span>
                      </label>
                      <label className="inline-flex items-center ml-4">
                        <input
                          type="checkbox"
                          checked={editingField?.appliesTo.includes('event')}
                          onChange={(e) => {
                            if (editingField) {
                              const newAppliesTo = e.target.checked
                                ? [...editingField.appliesTo, 'event']
                                : editingField.appliesTo.filter(a => a !== 'event');
                              setEditingField({ ...editingField, appliesTo: newAppliesTo });
                            }
                          }}
                          className="form-checkbox h-4 w-4 text-indigo-600"
                        />
                        <span className="ml-2 text-sm text-gray-500">Events</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setShowFieldEditor(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (editingField) {
                        setCustomFields(customFields.map(f => f.id === editingField.id ? editingField : f));
                        toast.success('Field updated successfully!');
                      } else {
                        setCustomFields([...customFields, { ...editingField!, id: (customFields.length + 1).toString() }]);
                        toast.success('Field added successfully!');
                      }
                      setShowFieldEditor(false);
                    }}
                    className="ml-4 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Event Types Tab */}
      {activeTab === 'eventTypes' && (
        <div className="space-y-6">
          {/* Header with Add Button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Manage Event Types</h2>
              <p className="text-sm text-gray-500 mt-1">
                Customize the types of events available in your church
              </p>
            </div>
            <button
              onClick={() => {
                setEditingEventType({
                  id: '',
                  name: '',
                  emoji: '📅',
                  color: 'bg-gray-500',
                  isDefault: false
                });
                setShowEventTypeEditor(true);
              }}
              className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Event Type
            </button>
          </div>

          {/* Event Types Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {eventTypes.map((eventType, index) => (
              <motion.div
                key={eventType.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-all"
              >
                {/* Header */}
                <div className={`${eventType.color} px-6 py-4`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center text-2xl">
                        {eventType.emoji}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{eventType.name}</h3>
                        {eventType.isDefault && (
                          <span className="text-xs text-white/80">Default Type</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-4 flex items-center justify-end space-x-2">
                  <button
                    onClick={() => {
                      setEditingEventType(eventType);
                      setShowEventTypeEditor(true);
                    }}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-all"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  {!eventType.isDefault && (
                    <button
                      onClick={() => {
                        setEventTypes(eventTypes.filter(et => et.id !== eventType.id));
                        toast.success('Event type deleted successfully!');
                      }}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Event Type Editor */}
          {showEventTypeEditor && editingEventType && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-6 py-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingEventType.id ? 'Edit Event Type' : 'Add New Event Type'}
                </h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Event Type Name
                    </label>
                    <input
                      type="text"
                      value={editingEventType.name}
                      onChange={(e) => setEditingEventType({ ...editingEventType, name: e.target.value })}
                      placeholder="e.g., Baptism, Retreat, Workshop"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>

                  {/* Emoji Icon */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Icon (Emoji)
                    </label>
                    <div className="flex items-center space-x-3">
                      <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center text-3xl border-2 border-gray-200">
                        {editingEventType.emoji}
                      </div>
                      <input
                        type="text"
                        value={editingEventType.emoji}
                        onChange={(e) => setEditingEventType({ ...editingEventType, emoji: e.target.value })}
                        placeholder="📅"
                        maxLength={2}
                        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                      />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Paste an emoji to use as the icon</p>
                  </div>

                  {/* Color */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color Theme
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { value: 'bg-purple-500', label: 'Purple' },
                        { value: 'bg-blue-500', label: 'Blue' },
                        { value: 'bg-green-500', label: 'Green' },
                        { value: 'bg-yellow-500', label: 'Yellow' },
                        { value: 'bg-orange-500', label: 'Orange' },
                        { value: 'bg-red-500', label: 'Red' },
                        { value: 'bg-pink-500', label: 'Pink' },
                        { value: 'bg-gray-500', label: 'Gray' },
                      ].map((colorOption) => (
                        <button
                          key={colorOption.value}
                          onClick={() => setEditingEventType({ ...editingEventType, color: colorOption.value })}
                          className={`p-3 rounded-xl border-2 transition-all ${
                            editingEventType.color === colorOption.value
                              ? 'border-gray-900 shadow-sm'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className={`w-full h-8 ${colorOption.value} rounded-lg mb-2`}></div>
                          <p className="text-xs font-medium text-gray-700">{colorOption.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowEventTypeEditor(false);
                      setEditingEventType(null);
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!editingEventType.name.trim()) {
                        toast.error('Please enter a name for the event type');
                        return;
                      }
                      
                      if (editingEventType.id) {
                        // Update existing
                        setEventTypes(eventTypes.map(et => 
                          et.id === editingEventType.id ? editingEventType : et
                        ));
                        toast.success('Event type updated successfully!');
                      } else {
                        // Add new
                        setEventTypes([...eventTypes, { 
                          ...editingEventType, 
                          id: (eventTypes.length + 1).toString() 
                        }]);
                        toast.success('Event type added successfully!');
                      }
                      setShowEventTypeEditor(false);
                      setEditingEventType(null);
                    }}
                    className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all"
                  >
                    {editingEventType.id ? 'Update' : 'Add'} Event Type
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Tag className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900">About Event Types</h4>
                <p className="text-sm text-gray-600 mt-2">
                  Event types help categorize and organize your church events. Default types cannot be deleted, but you can customize their appearance. Create custom event types for special occasions like baptisms, retreats, or workshops.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Messaging Integrations</h2>
              <p className="text-sm text-gray-500 mt-1">
                Connect your messaging providers to enable seamless communication with members
              </p>
            </div>
          </div>

          {/* Integration Tabs */}
          <div className="flex items-center space-x-2 border-b border-gray-200">
            <button
              onClick={() => setIntegrationTab('whatsapp')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
                integrationTab === 'whatsapp'
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <MessageSquare className="w-4 h-4 inline mr-2" />
              WhatsApp Business
            </button>
            <button
              onClick={() => setIntegrationTab('sms')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
                integrationTab === 'sms'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Phone className="w-4 h-4 inline mr-2" />
              SMS Provider
            </button>
            <button
              onClick={() => setIntegrationTab('email')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
                integrationTab === 'email'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Mail className="w-4 h-4 inline mr-2" />
              Email Service
            </button>
          </div>

          {/* WhatsApp Business Integration */}
          {integrationTab === 'whatsapp' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                      <MessageSquare className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">WhatsApp Business API</h3>
                      <p className="text-sm text-white/90">Send messages via WhatsApp Business Platform</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={whatsappEnabled}
                      onChange={(e) => setWhatsappEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-white/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white/50"></div>
                  </label>
                </div>
              </div>

              {/* Configuration Form */}
              <div className="p-6">
                {whatsappEnabled ? (
                  <div className="space-y-5">
                    {/* Status Indicator */}
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-medium text-green-800">Integration Enabled</span>
                      </div>
                    </div>

                    {/* Business Account Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          WhatsApp Business Phone Number
                        </label>
                        <input
                          type="text"
                          placeholder="+1 234 567 8900"
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
                        />
                        <p className="mt-1 text-sm text-gray-500">Your verified WhatsApp Business number</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Business Account Name
                        </label>
                        <input
                          type="text"
                          placeholder="Your Church Name"
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
                        />
                        <p className="mt-1 text-sm text-gray-500">Display name for messages</p>
                      </div>
                    </div>

                    {/* API Credentials */}
                    <div className="border-t border-gray-200 pt-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                        <Key className="w-4 h-4 mr-2 text-gray-500" />
                        API Credentials
                      </h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Phone Number ID
                          </label>
                          <input
                            type="text"
                            placeholder="Enter your Phone Number ID"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono text-sm"
                          />
                          <p className="mt-1 text-xs text-gray-500">Found in your WhatsApp Business API dashboard</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            WhatsApp Business Account ID
                          </label>
                          <input
                            type="text"
                            placeholder="Enter your Business Account ID"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Access Token
                          </label>
                          <input
                            type="password"
                            placeholder="Enter your Access Token"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono text-sm"
                          />
                          <p className="mt-1 text-xs text-gray-500">Your permanent access token from Meta Business</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Webhook Verify Token
                          </label>
                          <input
                            type="text"
                            placeholder="Enter your Webhook Verify Token"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono text-sm"
                          />
                          <p className="mt-1 text-xs text-gray-500">For receiving delivery status and replies</p>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                      <button
                        onClick={() => toast.info('Testing connection...')}
                        className="px-4 py-2 text-sm font-medium text-green-600 border border-green-600 rounded-xl hover:bg-green-50 transition-all"
                      >
                        Test Connection
                      </button>
                      <button
                        onClick={() => toast.success('WhatsApp configuration saved!')}
                        className="px-6 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all shadow-sm"
                      >
                        Save Configuration
                      </button>
                    </div>

                    {/* Info Box */}
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mt-4">
                      <h5 className="text-sm font-medium text-blue-900 mb-2">Getting Started with WhatsApp Business API</h5>
                      <ul className="text-xs text-blue-800 space-y-1">
                        <li>• Register for WhatsApp Business API through Meta Business</li>
                        <li>• Verify your business and phone number</li>
                        <li>• Create message templates for approval</li>
                        <li>• Copy your credentials from the API dashboard</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MessageSquare className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600 mb-2">WhatsApp Integration is currently disabled</p>
                    <p className="text-sm text-gray-500">Enable it to start sending messages via WhatsApp</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* SMS Provider Integration */}
          {integrationTab === 'sms' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                      <Phone className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">SMS Provider</h3>
                      <p className="text-sm text-white/90">Send SMS messages through your preferred provider</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smsEnabled}
                      onChange={(e) => setSmsEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-white/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white/50"></div>
                  </label>
                </div>
              </div>

              {/* Configuration Form */}
              <div className="p-6">
                {smsEnabled ? (
                  <div className="space-y-5">
                    {/* Status Indicator */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-medium text-blue-800">Integration Enabled</span>
                      </div>
                    </div>

                    {/* Provider Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        SMS Provider
                      </label>
                      <select className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                        <option value="">Select a provider</option>
                        <option value="twilio">Twilio</option>
                        <option value="nexmo">Vonage (Nexmo)</option>
                        <option value="messagebird">MessageBird</option>
                        <option value="plivo">Plivo</option>
                        <option value="aws-sns">AWS SNS</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">Choose your SMS service provider</p>
                    </div>

                    {/* Provider Credentials */}
                    <div className="border-t border-gray-200 pt-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                        <Key className="w-4 h-4 mr-2 text-gray-500" />
                        Provider Credentials
                      </h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Account SID / API Key
                          </label>
                          <input
                            type="text"
                            placeholder="Enter your Account SID or API Key"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Auth Token / API Secret
                          </label>
                          <input
                            type="password"
                            placeholder="Enter your Auth Token or API Secret"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Sender ID / Phone Number
                          </label>
                          <input
                            type="text"
                            placeholder="+1 234 567 8900 or CHURCHNAME"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                          />
                          <p className="mt-1 text-xs text-gray-500">Your verified sender ID or phone number</p>
                        </div>
                      </div>
                    </div>

                    {/* Advanced Settings */}
                    <div className="border-t border-gray-200 pt-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Advanced Settings</h4>
                      <div className="space-y-3">
                        <label className="flex items-center space-x-3">
                          <input type="checkbox" className="form-checkbox h-4 w-4 text-blue-600 rounded" />
                          <span className="text-sm text-gray-700">Enable delivery reports</span>
                        </label>
                        <label className="flex items-center space-x-3">
                          <input type="checkbox" className="form-checkbox h-4 w-4 text-blue-600 rounded" />
                          <span className="text-sm text-gray-700">Enable Unicode (for special characters)</span>
                        </label>
                        <label className="flex items-center space-x-3">
                          <input type="checkbox" className="form-checkbox h-4 w-4 text-blue-600 rounded" />
                          <span className="text-sm text-gray-700">Split long messages into multiple SMS</span>
                        </label>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                      <button
                        onClick={() => toast.info('Sending test SMS...')}
                        className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-xl hover:bg-blue-50 transition-all"
                      >
                        Send Test SMS
                      </button>
                      <button
                        onClick={() => toast.success('SMS configuration saved!')}
                        className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm"
                      >
                        Save Configuration
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Phone className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600 mb-2">SMS Integration is currently disabled</p>
                    <p className="text-sm text-gray-500">Enable it to start sending SMS messages</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Email Service Integration */}
          {integrationTab === 'email' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                      <Mail className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">Email Service</h3>
                      <p className="text-sm text-white/90">Configure your email delivery service</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={emailEnabled}
                      onChange={(e) => setEmailEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-white/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white/50"></div>
                  </label>
                </div>
              </div>

              {/* Configuration Form */}
              <div className="p-6">
                {emailEnabled ? (
                  <div className="space-y-5">
                    {/* Status Indicator */}
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-medium text-purple-800">Integration Enabled</span>
                      </div>
                    </div>

                    {/* Provider Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email Provider
                      </label>
                      <select className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all">
                        <option value="">Select a provider</option>
                        <option value="smtp">SMTP (Custom Server)</option>
                        <option value="sendgrid">SendGrid</option>
                        <option value="mailgun">Mailgun</option>
                        <option value="ses">Amazon SES</option>
                        <option value="postmark">Postmark</option>
                        <option value="mailchimp">Mailchimp Transactional</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">Choose your email service provider</p>
                    </div>

                    {/* SMTP Configuration */}
                    <div className="border-t border-gray-200 pt-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                        <Key className="w-4 h-4 mr-2 text-gray-500" />
                        SMTP Configuration
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            SMTP Host
                          </label>
                          <input
                            type="text"
                            placeholder="smtp.example.com"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            SMTP Port
                          </label>
                          <input
                            type="text"
                            placeholder="587"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                          <p className="mt-1 text-xs text-gray-500">Usually 587 (TLS) or 465 (SSL)</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Encryption
                          </label>
                          <select className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all">
                            <option value="tls">TLS</option>
                            <option value="ssl">SSL</option>
                            <option value="none">None</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Username
                          </label>
                          <input
                            type="text"
                            placeholder="your@email.com"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Password
                          </label>
                          <input
                            type="password"
                            placeholder="••••••••"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Sender Information */}
                    <div className="border-t border-gray-200 pt-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Sender Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            From Name
                          </label>
                          <input
                            type="text"
                            placeholder="Your Church Name"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            From Email
                          </label>
                          <input
                            type="email"
                            placeholder="noreply@yourchurch.com"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Reply-To Email
                          </label>
                          <input
                            type="email"
                            placeholder="info@yourchurch.com"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            BCC Email (Optional)
                          </label>
                          <input
                            type="email"
                            placeholder="admin@yourchurch.com"
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Advanced Settings */}
                    <div className="border-t border-gray-200 pt-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Advanced Settings</h4>
                      <div className="space-y-3">
                        <label className="flex items-center space-x-3">
                          <input type="checkbox" className="form-checkbox h-4 w-4 text-purple-600 rounded" />
                          <span className="text-sm text-gray-700">Track email opens</span>
                        </label>
                        <label className="flex items-center space-x-3">
                          <input type="checkbox" className="form-checkbox h-4 w-4 text-purple-600 rounded" />
                          <span className="text-sm text-gray-700">Track link clicks</span>
                        </label>
                        <label className="flex items-center space-x-3">
                          <input type="checkbox" className="form-checkbox h-4 w-4 text-purple-600 rounded" />
                          <span className="text-sm text-gray-700">Enable unsubscribe link</span>
                        </label>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                      <button
                        onClick={() => toast.info('Sending test email...')}
                        className="px-4 py-2 text-sm font-medium text-purple-600 border border-purple-600 rounded-xl hover:bg-purple-50 transition-all"
                      >
                        Send Test Email
                      </button>
                      <button
                        onClick={() => toast.success('Email configuration saved!')}
                        className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-all shadow-sm"
                      >
                        Save Configuration
                      </button>
                    </div>

                    {/* Info Box */}
                    <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 mt-4">
                      <h5 className="text-sm font-medium text-yellow-900 mb-2">⚠️ Important Notes</h5>
                      <ul className="text-xs text-yellow-800 space-y-1">
                        <li>• Test your configuration before sending to members</li>
                        <li>• Ensure your domain is verified with your email provider</li>
                        <li>��� Configure SPF and DKIM records for better deliverability</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Mail className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600 mb-2">Email Integration is currently disabled</p>
                    <p className="text-sm text-gray-500">Enable it to start sending email messages</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Branches Tab */}
      {activeTab === 'branches' && (
        <div className="space-y-6 max-w-4xl">
          {/* Header with Create Button */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Branch Management</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create and manage your church branches
              </p>
            </div>
            <button
              onClick={() => {
                setEditingBranch(null);
                setShowBranchModal(true);
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create Branch</span>
            </button>
          </div>

          {/* Branches List */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-medium text-gray-900">All Branches</h3>
              <p className="text-xs text-gray-500 mt-0.5">Manage all branches in your organization</p>
            </div>
            
            {loadingBranches ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-3">Loading branches...</p>
              </div>
            ) : dbBranches.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-600 mb-2">No branches found</p>
                <p className="text-sm text-gray-500 mb-4">Create your first branch to get started</p>
                <button
                  onClick={() => {
                    setEditingBranch(null);
                    setShowBranchModal(true);
                  }}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors inline-flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Branch</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {dbBranches.map((branch, index) => (
                  <motion.div
                    key={branch.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-4 hover:bg-gray-50 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          branch.is_active ? 'bg-gray-900' : 'bg-gray-300'
                        }`}>
                          <Building2 className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className="text-sm font-semibold text-gray-900">{branch.name}</h4>
                            {branch.is_active ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-600 mr-1"></div>
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                            <div className="flex items-center space-x-1.5 text-xs text-gray-600">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{branch.location}</span>
                            </div>
                            <div className="flex items-center space-x-1.5 text-xs text-gray-600">
                              <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>{branch.phone_number}</span>
                            </div>
                            <div className="flex items-center space-x-1.5 text-xs text-gray-600">
                              <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{branch.email}</span>
                            </div>
                            {branch.pastor_name && (
                              <div className="flex items-center space-x-1.5 text-xs text-gray-600">
                                <User className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{branch.pastor_name}</span>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            {branch.address}, {branch.city}, {branch.state} {branch.zip_code}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => {
                            setEditingBranch(branch);
                            setShowBranchModal(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Edit branch"
                        >
                          <Edit2 className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => handleDeleteBranch(branch.id)}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete branch"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h5 className="text-xs font-semibold text-blue-900 mb-2 flex items-center">
              <Globe className="w-3.5 h-3.5 mr-1.5" />
              About Branches
            </h5>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Each branch can have its own members, events, and groups</li>
              <li>• You can assign pastors and set capacity for each branch</li>
              <li>• All data is filtered by the branch you select in the header</li>
              <li>• Inactive branches won't appear in branch selection dropdowns</li>
            </ul>
          </div>
        </div>
      )}

      {/* Database Tab */}
      {activeTab === 'database' && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900">Database Configuration</h2>
            <p className="text-sm text-gray-600 mt-1">
              Test and verify your Supabase database connection and configuration.
            </p>
          </div>

          <DatabaseConnectionTest />

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h5 className="text-xs font-semibold text-blue-900 mb-2 flex items-center">
              <Database className="w-3.5 h-3.5 mr-1.5" />
              Database Information
            </h5>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Your Supabase project is connected and ready to use</li>
              <li>• All tables have been created with proper Row Level Security policies</li>
              <li>• Real-time subscriptions are enabled for live data updates</li>
              <li>• Run the connection test above to verify everything is working</li>
            </ul>
          </div>
        </div>
      )}
      
      {/* Assign Leader Modal */}
      {showAssignLeaderModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
          >
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Assign Leader</h2>
                  <p className="text-sm text-gray-600 mt-1">Select a member and assign them to ministries</p>
                </div>
                <button
                  onClick={() => {
                    setShowAssignLeaderModal(false);
                    setSelectedMember('');
                    setSelectedRole('group_leader');
                    setSelectedMinistries([]);
                  }}
                  className="p-2 hover:bg-white/50 rounded-lg transition-all"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
              {/* Member Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Member <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedMember}
                  onChange={(e) => setSelectedMember(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="">Choose a member...</option>
                  {mockMembers.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.name} - {member.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selected Member Preview */}
              {selectedMember && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  {(() => {
                    const member = mockMembers.find(m => m.id === selectedMember);
                    return member ? (
                      <div className="flex items-center space-x-3">
                        <img
                          src={member.avatar}
                          alt={member.name}
                          className="w-12 h-12 rounded-xl object-cover"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{member.name}</p>
                          <p className="text-xs text-gray-500">{member.email}</p>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Role Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Leadership Role <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'pastor', name: 'Pastor', color: 'indigo' },
                    { id: 'group_leader', name: 'Group Leader', color: 'green' },
                    { id: 'volunteer', name: 'Volunteer', color: 'blue' }
                  ].map(role => (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRole(role.id)}
                      className={`px-4 py-3 rounded-xl border-2 transition-all text-sm font-medium ${
                        selectedRole === role.id
                          ? `border-${role.color}-500 bg-${role.color}-50 text-${role.color}-700`
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {role.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ministry Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assign to Ministries <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-gray-500 mb-3">Select one or more ministries this leader will manage</p>
                <div className="space-y-1 max-h-64 overflow-y-auto p-1">
                  {availableMinistries.map(ministry => renderMinistryTree(ministry))}
                </div>
                {selectedMinistries.length > 0 && (
                  <p className="text-xs text-gray-600 mt-2">
                    {selectedMinistries.length} {selectedMinistries.length === 1 ? 'ministry' : 'ministries'} selected
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAssignLeaderModal(false);
                  setSelectedMember('');
                  setSelectedRole('group_leader');
                  setSelectedMinistries([]);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white border border-gray-200 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignLeader}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all flex items-center"
              >
                <Save className="w-4 h-4 mr-2" />
                Assign Leader
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Branch Modal */}
      {showBranchModal && user?.organization_id && (
        <BranchModal
          branch={editingBranch}
          organizationId={user.organization_id}
          onClose={() => {
            setShowBranchModal(false);
            setEditingBranch(null);
          }}
          onSave={handleSaveBranch}
        />
      )}
    </div>
  );
}