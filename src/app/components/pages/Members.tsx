import { useState, useMemo, useEffect, useCallback } from 'react';
import { Plus, Search, MoreVertical, Edit2, Trash2, Download, Upload, Mic, Mail, Phone, Users as UsersIcon, Home, QrCode, Share2, ExternalLink, CheckSquare, Square, X, Clock, Check, Eye, XCircle, MapPin, Copy, Loader2, RotateCcw, GitFork } from 'lucide-react';
import { mockGroups } from '../../utils/mockData';
import { Member, Family } from '@/types';
import { familyApi, memberApi, memberFamiliesApi } from '../../utils/api';
import { motion, AnimatePresence } from 'motion/react';
import MemberModal from '../modals/MemberModal';
import DeleteModal from '../modals/DeleteModal';
import AIVoiceNoteModal from '../modals/AIVoiceNoteModal';
import FamilyGroupModal from '../modals/FamilyGroupModal';
import FamilyGroupDetailModal from '../modals/FamilyGroupDetailModal';
import AssignMenuModal from '../modals/AssignMenuModal';
import AssignToFamilyModal from '../modals/AssignToFamilyModal';
import AssignMinistryModal from '../modals/AssignMinistryModal';
import MemberDetailPanel from '../panels/MemberDetailPanel';
import ExportModal from '../modals/ExportModal';
import MemberRegistrationFormModal from '../modals/MemberRegistrationFormModal';
import { toast } from 'sonner';
import AssignToGroupModal from '../modals/AssignToGroupModal';
import MemberLinkModal from '../modals/MemberLinkModal';
import QRCodeLib from 'qrcode';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';

type ViewType = 'members' | 'families' | 'requests';

export interface MemberRequest {
  id: string;
  // The form_data will contain original fields from MemberRegistration.tsx
  form_data: {
    firstName: string;
    lastName: string;
    email?: string;
    phoneNumber: string;
    location: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    dateOfBirth?: string;
    gender?: string;
    maritalStatus?: string;
    occupation?: string;
    dateJoined?: string;
    profileImage: string; // This will be the URL after upload
  };
  email: string;
  submittedDate: string;
  status: 'pending' | 'approved' | 'rejected';
  branch_id: string;
  organization_id: string;
}

// Mock pending member requests
const mockMemberRequests: MemberRequest[] = [
  {
    id: 'req1',
    fullName: 'David Johnson',
    email: 'david.johnson@email.com',
    phoneNumber: '+1 (555) 234-5678',
    location: 'Brooklyn, NY',
    emergencyContact: '+1 (555) 234-5679',
    submittedDate: '2024-03-02',
    status: 'pending',
    profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
    notes: 'Interested in joining the youth ministry'
  },
  {
    id: 'req2',
    fullName: 'Emily Rodriguez',
    email: 'emily.rodriguez@email.com',
    phoneNumber: '+1 (555) 345-6789',
    location: 'Queens, NY',
    emergencyContact: '+1 (555) 345-6790',
    submittedDate: '2024-03-03',
    status: 'pending',
    profileImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
    notes: 'Would like to volunteer in children\'s ministry'
  },
  {
    id: 'req3',
    fullName: 'Michael Chen',
    email: 'michael.chen@email.com',
    phoneNumber: '+1 (555) 456-7890',
    location: 'Manhattan, NY',
    emergencyContact: '+1 (555) 456-7891',
    submittedDate: '2024-03-04',
    status: 'pending',
    profileImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop',
    notes: 'Moving to the area, looking for a church home'
  },
];

export default function Members() {
  const { selectedBranch, branches } = useBranch();
  const { user, token, loading: authLoading } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [familyGroups, setFamilyGroups] = useState<Family[]>([]);
  const [loadingFamilies, setLoadingFamilies] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewType, setViewType] = useState<ViewType>(() => {
    const savedViewType = localStorage.getItem('viewType');
    const savedShowDeleted = localStorage.getItem('showDeletedMembers');
    if (savedViewType === 'members' && savedShowDeleted === 'true') {
      return 'members'; // If last view was deleted members, keep viewType as members
    }
    return savedViewType ? JSON.parse(savedViewType) : 'members';
  });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);
  const [viewingFamily, setViewingFamily] = useState<Family | undefined>();
  const [editingMember, setEditingMember] = useState<Member | undefined>();
  const [editingFamily, setEditingFamily] = useState<Family | undefined>();
  const [deletingMember, setDeletingMember] = useState<Member | undefined>();
  const [deletingFamily, setDeletingFamily] = useState<Family | undefined>();
  const [memberToRemove, setMemberToRemove] = useState<{ member: Member, familyId: string } | undefined>();
  const [aiNoteMember, setAiNoteMember] = useState<Member | undefined>();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [showRegistrationQR, setShowRegistrationQR] = useState(false);
  const [registrationQRCode, setRegistrationQRCode] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedDeletedMembers, setSelectedDeletedMembers] = useState<Set<string>>(new Set());
  const [isAssignMenuModalOpen, setIsAssignMenuModalOpen] = useState(false);
  const [isAssignToFamilyModalOpen, setIsAssignToFamilyModalOpen] = useState(false);
  const [viewingMemberDetail, setViewingMemberDetail] = useState<Member | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [memberRequests, setMemberRequests] = useState<MemberRequest[]>([]); // Initialize empty, will fetch from API
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [reviewingRequest, setReviewingRequest] = useState<MemberRequest | null>(null);
  const [editingRequest, setEditingRequest] = useState<MemberRequest | null>(null);
  const [isMemberLinkModalOpen, setIsMemberLinkModalOpen] = useState(false);
  const [isRegistrationFormOpen, setIsRegistrationFormOpen] = useState(false);
  const [isAssignMinistryModalOpen, setIsAssignMinistryModalOpen] = useState(false);
  const [isAssignToGroupModalOpen, setIsAssignToGroupModalOpen] = useState(false);
  const [memberToAssign, setMemberToAssign] = useState<Member | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('viewType', JSON.stringify(viewType));
  }, [viewType]);

  const fetchFamilyGroups = useCallback(async () => {
    if (!selectedBranch) return;
    setLoadingFamilies(true);
    try {
      const data = await familyApi.getAll({ branch_id: selectedBranch.id });
      const mappedFamilies: Family[] = data.map((f: any) => ({
        id: f.id,
        familyName: f.family_name || 'Unnamed Family',
        headOfHousehold: f.head_of_household || '',
        memberIds: f.member_ids || [],
        address: f.address || '',
        phoneNumber: f.phone_number || '',
        churchId: f.branch_id,
        joinedDate: f.joined_date || '',
      }));
      setFamilyGroups(mappedFamilies);
    } catch (error) {
      toast.error('Failed to load family groups');
    } finally {
      setLoadingFamilies(false);
    }
  }, [selectedBranch]);

  const [showDeletedMembers, setShowDeletedMembers] = useState(() => {
    const savedState = localStorage.getItem('showDeletedMembers');
    const initialState = savedState ? JSON.parse(savedState) : false;
    return initialState;
  });

  useEffect(() => {
    localStorage.setItem('showDeletedMembers', JSON.stringify(showDeletedMembers));
  }, [showDeletedMembers]);

  const fetchMembers = useCallback(async () => {
    if (!token) {
      if (!authLoading) setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const url = new URL('/api/members', window.location.origin);
      if (selectedBranch) {
        url.searchParams.append('branch_id', selectedBranch.id);
      }
      // Always fetch all members; filtering for display (active/deleted) happens in filteredMembers useMemo
      // No longer appending showDeleted to URL here
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch members: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      // Map database fields to frontend Member type
      const mappedMembers: Member[] = data.map((m: any) => ({
        ...m,
        fullName: `${m.first_name} ${m.last_name}`,
        phoneNumber: m.phone || m.phone_number || '',
        location: m.address || '',
        emergencyContactName: m.emergency_contact_name || '',
        emergencyContactPhone: m.emergency_contact_phone || '',
        profileImage: m.memberimage_url || m.member_url || m.profile_image || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop',
        memberUrl: m.member_url || '',
        churchId: m.branch_id,
        is_deleted: m.is_deleted || false,
        deleted_at: m.deleted_at || null,
      }));
      
      setMembers(mappedMembers);
    } catch (error) {
      toast.error('Failed to load members');
    } finally {
      setIsLoading(false);
    }
  }, [token, selectedBranch, authLoading]);

  const handleAssignToGroupClick = useCallback((member: Member) => {
    setMemberToAssign(member);
    setIsAssignToGroupModalOpen(true);
  }, []);

  const handleAssignmentComplete = useCallback(() => {
    setIsAssignToGroupModalOpen(false);
    setMemberToAssign(null);
    fetchMembers(); // Re-fetch members to update their assigned groups
  }, [fetchMembers]);

  const fetchMemberRequests = useCallback(async () => {
    if (!token) {
      return;
    }
    if (!selectedBranch) {
      setMemberRequests([]);
      return;
    }

    try {
      const url = new URL('/api/member-requests', window.location.origin);
      url.searchParams.append('status', 'pending'); // Only fetch pending requests
      url.searchParams.append('branch_id', selectedBranch.id);

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch member requests');

      const data = await response.json();
      const rows = Array.isArray(data) ? data : [];
      setMemberRequests(
        rows.map((req: any) => ({
          id: req.id,
          form_data: req.form_data ?? {},
          email: req.form_data?.email ?? '',
          submittedDate: req.created_at ?? req.submitted_at ?? '',
          status: req.status,
          branch_id: req.branch_id,
          organization_id: req.organization_id,
        }))
      );
    } catch (error) {
      toast.error('Failed to load member requests');
      setMemberRequests([]);
    }
  }, [token, selectedBranch]);

  useEffect(() => {
    fetchFamilyGroups();

    if (selectedBranch && token) {
      fetchMemberRequests();
    } else if (!selectedBranch) {
      setMemberRequests([]);
    }

    if (viewType === 'members' && token && selectedBranch && !authLoading) {
      fetchMembers();
    }
  }, [fetchFamilyGroups, fetchMemberRequests, fetchMembers, token, selectedBranch, authLoading, viewType]);

  const handleApproveRequest = useCallback(async (requestId: string) => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }
    try {
      const response = await fetch(`/api/member-requests/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to approve member request');
      }

      toast.success('Member request approved!');
      setReviewingRequest(null);
      setEditingRequest(null);
      fetchMemberRequests();
      fetchMembers();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve member request');
    }
  }, [token, fetchMemberRequests, fetchMembers]);

  const handleRejectRequest = useCallback(async (requestId: string) => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }
    try {
      const response = await fetch(`/api/member-requests/${requestId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to reject member request');
      }

      toast.success('Member request rejected!');
      setReviewingRequest(null);
      setEditingRequest(null);
      fetchMemberRequests();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject member request');
    }
  }, [token, fetchMemberRequests]);

  const handleUpdateEditedRequest = useCallback(async () => {
    if (!token || !editingRequest) {
      toast.error('Authentication session expired or no request to edit.');
      return;
    }
    try {
      // Assuming there's an API endpoint to update member requests
      // This might be part of the approve/reject flow or a separate 'edit pending request' endpoint
      const response = await fetch(`/api/member-requests/${editingRequest.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ form_data: editingRequest.form_data }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update member request details');
      }

      const updated = await response.json();
      const mapped = {
        id: updated.id,
        form_data: updated.form_data ?? {},
        email: updated.form_data?.email ?? '',
        submittedDate: updated.created_at ?? '',
        status: updated.status,
        branch_id: updated.branch_id,
        organization_id: updated.organization_id,
      };
      toast.success('Member request details updated!');
      setMemberRequests((prev) => prev.map((r) => (r.id === mapped.id ? mapped : r)));
      setReviewingRequest(mapped);
      setEditingRequest(null);
      fetchMemberRequests();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update member request details');
    }
  }, [token, editingRequest, fetchMemberRequests]);

  const registrationCode = useMemo(() => {
    // Generate a simple code based on branch ID or a unique identifier
    // This should ideally come from the backend when a branch is created
    return selectedBranch ? selectedBranch.id : null;
  }, [selectedBranch]);

  const registrationLink = useMemo(
    () => (registrationCode ? `${window.location.origin}/register/member/${registrationCode}` : ''),
    [registrationCode]
  );

  useEffect(() => {
    setRegistrationQRCode('');
  }, [registrationLink]);

  // Generate QR code when panel is opened
  const handleShowRegistrationQR = async () => {
    if (!registrationQRCode && registrationLink) {
      const qrDataUrl = await QRCodeLib.toDataURL(registrationLink, { width: 300 });
      setRegistrationQRCode(qrDataUrl);
    }
    setShowRegistrationQR(!showRegistrationQR);
  };

  const downloadRegistrationQR = () => {
    if (!registrationQRCode) {
      toast.error('QR Code not generated yet.');
      return;
    }
    const link = document.createElement('a');
    link.href = registrationQRCode;
    link.download = 'member-registration-qr.png';
    link.click();
    toast.success('QR Code downloaded!');
  };

  const shareRegistrationLink = () => {
    if (!registrationLink) {
      toast.error('Select a branch to generate a registration link.');
      return;
    }
    navigator.clipboard.writeText(registrationLink);
    toast.success('Registration link copied to clipboard!');
  };

  const toggleMemberSelection = (memberId: string) => {
    const newSelection = new Set(selectedMembers);
    if (newSelection.has(memberId)) {
      newSelection.delete(memberId);
    } else {
      newSelection.add(memberId);
    }
    setSelectedMembers(newSelection);
  };

  const toggleRequestSelection = (requestId: string) => {
    const newSelection = new Set(selectedRequests);
    if (newSelection.has(requestId)) {
      newSelection.delete(requestId);
    } else {
      newSelection.add(requestId);
    }
    setSelectedRequests(newSelection);
  };

  const clearSelection = () => {
    setSelectedMembers(new Set());
    setSelectedRequests(new Set());
    setSelectedDeletedMembers(new Set());
  };

  // Filter members by selected branch first, then by search query
  const filteredMembers = useMemo(() => {
    if (isLoading || viewType !== 'members') {
      return [];
    }

    let currentMembers = members.filter(member => {
      const matchBranch = !selectedBranch || member.churchId === selectedBranch.id;
      return matchBranch;
    });

    currentMembers = currentMembers.filter(member => {
      const matchDeletedStatus = member.is_deleted === showDeletedMembers;
      return matchDeletedStatus;
    });

    return currentMembers
      .filter(member => {
        const searchStr = searchQuery.toLowerCase();
        const matchSearch = (
          member.fullName?.toLowerCase().includes(searchStr) ||
          member.email?.toLowerCase().includes(searchStr) ||
          member.location?.toLowerCase().includes(searchStr) ||
          member.phone?.toLowerCase().includes(searchStr) ||
          member.phoneNumber?.toLowerCase().includes(searchStr) ||
          member.member_id_string?.toLowerCase().includes(searchStr)
        );
        return matchSearch;
      });
  }, [members, selectedBranch, searchQuery, isLoading]);

  // Filter families by selected branch first, then by search query
  const filteredFamilies = useMemo(() => {
    return familyGroups
      .filter(family => !selectedBranch || family.churchId === selectedBranch.id)
      .filter(family =>
        family.familyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        family.address?.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [familyGroups, selectedBranch, searchQuery]);

  const filteredRequests = useMemo(() => {
    const searchStr = searchQuery.trim().toLowerCase();
    if (!searchStr) return memberRequests;
    return memberRequests.filter((request) => {
      const fd = request.form_data;
      if (!fd) return false;
      const haystack = [
        fd.firstName,
        fd.lastName,
        fd.email,
        fd.location,
        fd.phoneNumber,
      ]
        .map((v) => (v == null ? '' : String(v)).toLowerCase())
        .join(' ');
      return haystack.includes(searchStr);
    });
  }, [memberRequests, searchQuery]);

  const handleSaveMember = async (memberData: Partial<Member>) => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }

    const branchId = selectedBranch?.id || user?.branch_id || (branches.length > 0 ? branches[0].id : null);

    if (!branchId) {
      toast.error('Please select a branch first.');
      return;
    }
    
    try {
      const payload: any = {
        first_name: memberData.firstName,
        last_name: memberData.lastName,
        email: memberData.email,
        phone: memberData.phoneNumber,
        address: memberData.location,
        emergency_contact_name: memberData.emergencyContactName,
        emergency_contact_phone: memberData.emergencyContactPhone,
        member_url: memberData.profileImage, // Using member_url for profileImage
        dob: memberData.dateOfBirth,
        gender: memberData.gender,
        marital_status: memberData.maritalStatus,
        occupation: memberData.occupation,
        date_joined: memberData.dateJoined,
        branch_id: branchId,
        // Add other fields as necessary from the Member interface
      };

      const payloadStr = JSON.stringify(payload);

      const response = await fetch(editingMember ? `/api/members/${editingMember.id}` : '/api/members', {
        method: editingMember ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 413) {
          toast.error('The image is too large. Please use a smaller image.');
          throw new Error('Image too large (413)');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to save member');
      }

      toast.success(editingMember ? 'Member updated successfully!' : 'Member added successfully!');
      fetchMembers();
      setEditingMember(undefined);
      setIsAddModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save member');
    }
  };

  const handleDeleteMember = async () => {
    if (deletingMember && token) {
      try {
        const response = await fetch(`/api/members/${deletingMember.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) throw new Error('Failed to soft-delete member');

        setMembers(prevMembers => prevMembers.map(m => 
          m.id === deletingMember.id ? { ...m, is_deleted: true, deleted_at: new Date().toISOString() } : m
        ));
        toast.success('Member soft-deleted successfully!');
        // No need to fetchMembers here as local state is updated. Fetch will happen on tab switch.
      } catch (error) {
        toast.error('Failed to soft-delete member');
      } finally {
        setDeletingMember(undefined);
      }
    }
  };

  const handleRestoreMember = async (memberIds: string[]) => {
    if (!token || memberIds.length === 0) return;

    try {
      // For bulk restore, iterate and send individual requests or create a new bulk API endpoint.
      // For now, sending individual requests as a simple approach.
      await Promise.all(memberIds.map(async (memberId) => {
        const response = await fetch(`/api/members/${memberId}/restore`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) throw new Error(`Failed to restore member ${memberId}`);
      }));

      setMembers(prevMembers => prevMembers.map(m => 
        memberIds.includes(m.id) ? { ...m, is_deleted: false, deleted_at: null } : m
      ));
      toast.success(`${memberIds.length} member(s) restored successfully!`);
    } catch (error) {
      toast.error('Failed to restore member(s)');
    }
  };

  const handleDeleteFamily = async () => {
    if (!deletingFamily || !token) return;
    try {
      const response = await fetch(`/api/families/${deletingFamily.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to delete family group');
      setFamilyGroups(familyGroups.filter(f => f.id !== deletingFamily.id));
      setViewingFamily(undefined);
      toast.success('Family group deleted successfully!');
    } catch (error) {
      toast.error('Failed to delete family group');
    } finally {
      setDeletingFamily(undefined);
    }
  };

  const handleSaveFamily = async (familyData: Partial<Family>) => {
    if (!token) {
      toast.error('You must be logged in to save family groups');
      return;
    }

    const branchId = selectedBranch?.id || user?.branch_id || (branches.length > 0 ? branches[0].id : null);

    if (!branchId) {
      toast.error('Please select a branch first.');
      return;
    }

    try {
      const url = editingFamily ? `/api/families/${editingFamily.id}` : '/api/families';
      const method = editingFamily ? 'PUT' : 'POST';
      
      const payload = {
        ...familyData,
        branch_id: branchId,
        churchId: branchId, // Keep for compatibility
      };

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save family group');
      }

      const savedFamilyRaw = await response.json();
      const savedFamily: Family = {
        id: savedFamilyRaw.id,
        familyName: savedFamilyRaw.family_name || 'Unnamed Family',
        headOfHousehold: savedFamilyRaw.head_of_household || '',
        memberIds: savedFamilyRaw.member_ids || [],
        address: savedFamilyRaw.address || '',
        phoneNumber: savedFamilyRaw.phone_number || '',
        churchId: savedFamilyRaw.branch_id,
        joinedDate: savedFamilyRaw.joined_date || '',
      };
      
      if (editingFamily) {
        setFamilyGroups(familyGroups.map(f => f.id === savedFamily.id ? savedFamily : f));
        toast.success('Family group updated!');
      } else {
        setFamilyGroups([...familyGroups, savedFamily]);
        toast.success('Family group created!');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save family group');
    } finally {
      setEditingFamily(undefined);
      setIsFamilyModalOpen(false);
    }
  };

  const handleExport = () => {
    toast.success(`Exporting ${viewType === 'members' ? 'members' : 'families'} to Excel...`);
  };

  const handleImport = () => {
    toast.info('Import feature will open file picker');
  };

  const getFamilyMembers = (familyId: string) => {
    return members.filter(m => m.familyIds?.includes(familyId));
  };

  const getHeadOfHousehold = (memberId: string) => {
    return members.find(m => m.id === memberId);
  };

  const handleAssignMinistry = async (ministryIds: string[]) => {
    const selectedMemberIds = Array.from(selectedMembers);
    try {
      await Promise.all(selectedMemberIds.map(async (memberId) => {
        const member = members.find(m => m.id === memberId);
        if (member) {
          const currentGroupIds = member.groupIds || [];
          const updatedGroupIds = Array.from(new Set([...currentGroupIds, ...ministryIds]));
          await memberApi.update(memberId, { groupIds: updatedGroupIds });
        }
      }));
      setMembers(members.map(m => {
        if (selectedMemberIds.includes(m.id)) {
          const currentGroupIds = m.groupIds || [];
          const updatedGroupIds = Array.from(new Set([...currentGroupIds, ...ministryIds]));
          return { ...m, groupIds: updatedGroupIds };
        }
        return m;
      }));
      toast.success(`${selectedMemberIds.length} member(s) assigned to ${ministryIds.length} ministry/ministries successfully!`);
      setSelectedMembers(new Set());
      setIsAssignMinistryModalOpen(false);
    } catch (error: any) {
      toast.error('Failed to assign members');
    }
  };

  const handleAssignFamilyGroup = async (familyIds: string[]) => {
    toast.info('Assigning members to family groups...');
    const selectedMemberIds = Array.from(selectedMembers);
    try {
      await Promise.all(
        selectedMemberIds.flatMap(memberId =>
          familyIds.map(familyId => memberFamiliesApi.assign(memberId, familyId))
        )
      );
      setMembers(members.map(m => {
        if (selectedMemberIds.includes(m.id)) {
          const newFamilyIds = [...new Set([...(m.familyIds || []), ...familyIds])];
          return { ...m, familyIds: newFamilyIds };
        }
        return m;
      }));
      toast.success(`${selectedMemberIds.length} member(s) assigned to ${familyIds.length} family group(s) successfully!`);
      setSelectedMembers(new Set());
      setIsAssignToFamilyModalOpen(false);
      // Redirect to member list page
      setViewType('members');
    } catch (error: any) {
      toast.error('Failed to assign members to family groups.');
    }
  };

  const handleUpdateFamilyName = async (id: string, name: string) => {
    try {
      await familyApi.update(id, { family_name: name });
      const updatedFamilyGroups = familyGroups.map(f => f.id === id ? { ...f, familyName: name } : f);
      setFamilyGroups(updatedFamilyGroups);
      if (viewingFamily && viewingFamily.id === id) {
        const updatedFamily = updatedFamilyGroups.find(f => f.id === id);
        setViewingFamily(updatedFamily);
      }
      toast.success('Family name updated!');
    } catch (error: any) {
      toast.error('Failed to update family name');
    }
  };

  const handleRemoveMemberFromFamily = async () => {
    if (!memberToRemove) return;
    try {
      await memberFamiliesApi.remove(memberToRemove.member.id, memberToRemove.familyId);
      setMembers(prev => prev.map(m => m.id === memberToRemove.member.id ? { 
        ...m, 
        familyIds: (m.familyIds || []).filter(id => id !== memberToRemove.familyId) 
      } : m));
      setMemberToRemove(undefined);
      toast.success('Member removed!');
    } catch (error: any) {
      toast.error('Failed to remove member');
    }
  };

  const handleDeleteFamilyFromModal = (family: Family) => {
    setDeletingFamily(family);
  };
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-gray-900 text-[20px]">Members & Families</h1>
          <p className="mt-2 text-gray-500 text-[12px]">Manage your church members and family groups</p>
        </div>
        <div className="flex items-center space-x-3">
          {viewType === 'members' && (
            <button
              onClick={async () => {
                if (!registrationLink) {
                  toast.error('Select a branch to generate a registration link.');
                  return;
                }
                if (!registrationQRCode) {
                  const qrDataUrl = await QRCodeLib.toDataURL(registrationLink, { width: 400 });
                  setRegistrationQRCode(qrDataUrl);
                }
                setIsMemberLinkModalOpen(true);
              }}
              className="flex items-center px-6 py-3 text-green-700 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl hover:from-green-100 hover:to-emerald-100 transition-all shadow-sm text-[14px]"
            >
              <QrCode className="w-5 h-5 mr-2" />
              Member Link
            </button>
          )}
          <button
            onClick={handleImport}
            className="flex items-center px-4 py-2.5 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm text-[14px]"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import
          </button>
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center px-4 py-2.5 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm text-[14px]"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </button>
          <button
            onClick={() => {
              viewType === 'members' ? setIsAddModalOpen(true) : setIsFamilyModalOpen(true);
            }}
            className="flex items-center px-4 py-2.5 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-sm text-[14px]"
          >
            <Plus className="w-4 h-4 mr-2" />
            {viewType === 'members' ? 'Add Member' : 'Add Family'}
          </button>
        </div>
      </div>

      {/* View Toggle and Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setViewType('members');
              setShowDeletedMembers(false);
            }}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ viewType === 'members' && !showDeletedMembers ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <UsersIcon className="w-4 h-4 mr-2" />
            Members
            <span className={`ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              viewType === 'members' && !showDeletedMembers
                ? 'bg-indigo-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {members.filter(m => !m.is_deleted).length}
            </span>
          </button>
          <button
            onClick={() => setViewType('families')}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ viewType === 'families' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <Home className="w-4 h-4 mr-2" />
            Family Groups
            <span className={`ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              viewType === 'families'
                ? 'bg-indigo-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {filteredFamilies.length}
            </span>
          </button>
          <button
            onClick={() => setViewType('requests')}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ viewType === 'requests' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <Clock className="w-4 h-4 mr-2" />
            Requests
            <span className={`ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              viewType === 'requests'
                ? 'bg-indigo-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {memberRequests.length}
            </span>
          </button>
          <button
            onClick={() => {
              setViewType('members'); // Keep viewType as 'members' for consistent rendering of the table structure
              setShowDeletedMembers(true);
            }}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ showDeletedMembers && viewType === 'members' ? 'bg-red-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Deleted ({members.filter(m => m.is_deleted).length})
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              viewType === 'members'
                ? 'Search members...'
                : viewType === 'requests'
                  ? 'Search requests...'
                  : 'Search families...'
            }
            className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        </div>
      </div>

      {/* Members View - Table Format */}
      {viewType === 'members' && (
        <div className="space-y-6">
          {/* Bulk Actions Header for Members */}
          <AnimatePresence>
            {selectedMembers.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-semibold">
                      {selectedMembers.size}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {selectedMembers.size} {selectedMembers.size === 1 ? 'Member' : 'Members'} Selected
                      </p>
                      <p className="text-sm text-gray-600">Choose an action below</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => {
                        setIsAssignToGroupModalOpen(true);
                      }}
                      className="flex items-center px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-sm font-medium"
                    >
                      <GitFork className="w-4 h-4 mr-2" />
                      Assign to Group
                    </button>
                    <button
                      onClick={() => setIsAssignToFamilyModalOpen(true)}
                      className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
                    >
                      <Home className="w-4 h-4 mr-2" />
                      Assign to Family
                    </button>
                    <button
                      onClick={clearSelection}
                      className="p-2.5 text-gray-600 hover:text-gray-800 hover:bg-white rounded-xl transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 w-16">
                    {viewType === 'members' && showDeletedMembers && filteredMembers.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectedDeletedMembers.size === filteredMembers.length) {
                            setSelectedDeletedMembers(new Set());
                          } else {
                            setSelectedDeletedMembers(new Set(filteredMembers.map(m => m.id)));
                          }
                        }}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          selectedDeletedMembers.size === filteredMembers.length && filteredMembers.length > 0
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'bg-white border-gray-300 hover:border-red-400'
                        }`}
                      >
                        {selectedDeletedMembers.size === filteredMembers.length && filteredMembers.length > 0 && (
                          <CheckSquare className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">Member</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">Phone</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">Email</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">Address</th>
                  {!showDeletedMembers && (
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">Joined Date</th>
                  )}
                  {!showDeletedMembers && (
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">Status</th>
                  )}
                  {!showDeletedMembers && (
                    <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4 w-20">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
                        <p className="text-gray-500 text-sm">Loading members...</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <AnimatePresence>
                    {filteredMembers.map((member, index) => (
                      <motion.tr
                        key={member.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: index * 0.02 }}
                        onMouseEnter={() => setHoveredMemberId(member.id)}
                        onMouseLeave={() => setHoveredMemberId(null)}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          setViewingMemberDetail(member);
                        }}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-all cursor-pointer ${
                          (selectedMembers.has(member.id) && !showDeletedMembers) || (selectedDeletedMembers.has(member.id) && showDeletedMembers) ? 'bg-indigo-50' : ''
                        } ${member.familyIds && member.familyIds.length > 0 ? 'opacity-50' : ''}`}
                      >
                        {/* Cell 1: Member (Flex Container with Image + Name) */}
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-3">
                            {/* Selection Checkbox */}
                            {(hoveredMemberId === member.id || selectedMembers.size > 0 || (showDeletedMembers && selectedDeletedMembers.size > 0)) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showDeletedMembers) {
                                    const newSelection = new Set(selectedDeletedMembers);
                                    if (newSelection.has(member.id)) {
                                      newSelection.delete(member.id);
                                    } else {
                                      newSelection.add(member.id);
                                    }
                                    setSelectedDeletedMembers(newSelection);
                                  } else {
                                    toggleMemberSelection(member.id);
                                  }
                                }}
                                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                                  (showDeletedMembers && selectedDeletedMembers.has(member.id))
                                    ? 'bg-red-600 border-red-600 text-white'
                                    : (selectedMembers.has(member.id)
                                      ? 'bg-indigo-600 border-indigo-600 text-white'
                                      : 'bg-white border-gray-300 hover:border-indigo-400')
                                }`}
                              >
                                {(showDeletedMembers && selectedDeletedMembers.has(member.id)) && <CheckSquare className="w-3 h-3" />}
                                {(!showDeletedMembers && selectedMembers.has(member.id)) && <CheckSquare className="w-3 h-3" />}
                              </button>
                            )}

                            {/* Avatar */}
                            <img
                              src={member.profileImage}
                              alt={member.fullName}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-gray-100"
                              referrerPolicy="no-referrer"
                            />

                            {/* Name */}
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-gray-900 truncate text-[14px]">{member.fullName}</span>
                            </div>
                          </div>
                        </td>

                        {/* Cell 3: Phone */}
                        <td className="px-6 py-4">
                          <span className="text-gray-900 text-[14px]">{member.phoneNumber || 'N/A'}</span>
                        </td>

                        {/* Cell 2: Email */}
                        <td className="px-6 py-4">
                          <span className="text-gray-900 truncate block text-[14px]">{member.email || 'N/A'}</span>
                        </td>

                        {/* Cell 4: Address */}
                        <td className="px-6 py-4">
                          <span className="text-gray-600 text-[14px]">{member.location || 'N/A'}</span>
                        </td>

                        {/* Conditional rendering for other cells */}
                        {!showDeletedMembers && (
                          <>
                            {/* Cell 5: Joined Date */}
                            <td className="px-6 py-4">
                              <span className="text-gray-600 text-[14px]">
                                N/A
                              </span>
                            </td>

                            {/* Cell 6: Status */}
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-green-50 text-green-700 border-green-200`}>
                                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 bg-green-500`}></div>
                                Active
                              </span>
                            </td>

                            {/* Cell 7: Actions */}
                            <td className="px-6 py-4">
                              <div className="relative flex justify-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenu(activeMenu === member.id ? null : member.id);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>

                                {activeMenu === member.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setActiveMenu(null)}
                                    />
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.95 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-20"
                                    >
                                      <button
                                        onClick={() => {
                                          setEditingMember(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Edit2 className="w-4 h-4 mr-3" />
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => {
                                          setAiNoteMember(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Mic className="w-4 h-4 mr-3" />
                                        AI Voice Note
                                      </button>
                                      <button
                                        onClick={() => {
                                          handleAssignToGroupClick(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <GitFork className="w-4 h-4 mr-3" />
                                        Assign to Group
                                      </button>
                                      <div className="border-t border-gray-100 my-1"></div>
                                      <button
                                        onClick={() => {
                                          setDeletingMember(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-4 h-4 mr-3" />
                                        Delete
                                      </button>
                                    </motion.div>
                                  </>
                                )}
                              </div>
                            </td>
                          </>
                        )}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
              </tbody>
            </table>
          </div>

          {!isLoading && filteredMembers.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500">No members found matching your search.</p>
            </div>
          )}
        </div>
        </div>
      )}

      {/* Family Groups View */}
      {viewType === 'families' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredFamilies.map((family, index) => {
              const familyMembers = getFamilyMembers(family.id);
              const head = getHeadOfHousehold(family.headOfHousehold);

              return (
                <motion.div
                  key={family.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ 
                    scale: 1.02,
                    y: -4,
                    transition: { duration: 0.2 }
                  }}
                  onClick={() => setViewingFamily(family)}
                  className="bg-white rounded-2xl p-6 shadow-sm border-2 border-gray-100 hover:shadow-xl hover:border-blue-400 hover:shadow-blue-100/50 transition-all relative group cursor-pointer"
                >
                  {/* Menu Button */}
                  <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setActiveMenu(activeMenu === family.id ? null : family.id)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-all"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    
                    {activeMenu === family.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setActiveMenu(null)}
                        />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-20"
                        >
                          <button
                            onClick={() => {
                              setEditingFamily(family);
                              setActiveMenu(null);
                            }}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Edit2 className="w-4 h-4 mr-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setDeletingFamily(family);
                              setActiveMenu(null);
                            }}
                            className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4 mr-3" />
                            Delete
                          </button>
                        </motion.div>
                      </>
                    )}
                  </div>

                  {/* Family Header */}
                  <div className="flex items-start space-x-4 mb-6">
                    <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center text-2xl">
                      🏠
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{family.familyName}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{familyMembers.length} members</p>
                      <div className="mt-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-700">
                          Family Unit
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Head of Household */}
                  {head && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-500 mb-2">Head of Household</p>
                      <div className="flex items-center space-x-2">
                        <img
                          src={head.profileImage}
                          alt={head.fullName}
                          className="w-8 h-8 rounded-lg object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{head.fullName}</p>
                          <p className="text-sm text-gray-500">{family.phoneNumber}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Family Members */}
                  <div className="space-y-2 mb-4">
                    <p className="text-sm text-gray-500 font-medium">Family Members</p>
                    <div className="flex -space-x-2">
                      {familyMembers.slice(0, 5).map((member) => (
                        <img
                          key={member.id}
                          src={member.profileImage}
                          alt={member.fullName}
                          title={member.fullName}
                          className="w-10 h-10 rounded-full border-2 border-white object-cover"
                        />
                      ))}
                      {familyMembers.length > 5 && (
                        <div className="w-10 h-10 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600">
                          +{familyMembers.length - 5}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Address */}
                  <div className="pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Address</p>
                    <p className="text-sm text-gray-900">{family.address}</p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {loadingFamilies ? (
            <div className="col-span-full text-center py-16">
              <p>Loading family groups...</p>
            </div>
          ) : filteredFamilies.length === 0 && (
            <div className="col-span-full text-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Home className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500">No family groups found matching your search.</p>
            </div>
          )}
        </div>
      )}

      {/* Member Requests View */}
      {viewType === 'requests' && (
        <div className="space-y-6">
          {/* Bulk Actions Header */}
          <AnimatePresence>
            {selectedRequests.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-semibold">
                      {selectedRequests.size}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {selectedRequests.size} {selectedRequests.size === 1 ? 'Request' : 'Requests'} Selected
                      </p>
                      <p className="text-sm text-gray-600">Choose an action below</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => {
                        const selectedReqs = memberRequests.filter(r => selectedRequests.has(r.id));
                        const newMembers = selectedReqs.map((req, idx) => ({
                          id: String(members.length + idx + 1),
                          profileImage: req.profileImage || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop',
                          fullName: req.fullName,
                          email: req.email,
                          phoneNumber: req.phoneNumber,
                          location: req.location,
                          emergencyContact: req.emergencyContact,
                          churchId: '1',
                        } as Member));
                        setMembers([...members, ...newMembers]);
                        setMemberRequests(memberRequests.filter(r => !selectedRequests.has(r.id)));
                        setSelectedRequests(new Set());
                        toast.success(`${selectedReqs.length} ${selectedReqs.length === 1 ? 'request' : 'requests'} approved!`);
                      }}
                      className="flex items-center px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all shadow-sm font-medium"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Approve Selected
                    </button>
                    <button
                      onClick={() => {
                        setMemberRequests(memberRequests.filter(r => !selectedRequests.has(r.id)));
                        setSelectedRequests(new Set());
                        toast.success('Selected requests rejected');
                      }}
                      className="flex items-center px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-sm font-medium"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject Selected
                    </button>
                    <button
                      onClick={() => setSelectedRequests(new Set())}
                      className="p-2.5 text-gray-600 hover:text-gray-800 hover:bg-white rounded-xl transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Requests List Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Table Header */}
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <div className="flex items-center">
                <div className="w-12 flex items-center justify-center">
                  <button
                    onClick={() => {
                      if (selectedRequests.size === filteredRequests.length) {
                        setSelectedRequests(new Set());
                      } else {
                        setSelectedRequests(new Set(filteredRequests.map(r => r.id)));
                      }
                    }}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                      selectedRequests.size === filteredRequests.length && filteredRequests.length > 0
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white border-gray-300 hover:border-indigo-400'
                    }`}
                  >
                    {selectedRequests.size === filteredRequests.length && filteredRequests.length > 0 && (
                      <CheckSquare className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-12 gap-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="col-span-3">Applicant</div>
                  <div className="col-span-3">Contact</div>
                  <div className="col-span-2">Location</div>
                  <div className="col-span-2">Submitted</div>
                  <div className="col-span-2 text-right">Actions</div>
                </div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-gray-100">
              <AnimatePresence>
                {filteredRequests.map((request, index) => (
                  <motion.div
                    key={request.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className={`px-6 py-4 hover:bg-gray-50 transition-all cursor-pointer ${
                      selectedRequests.has(request.id) ? 'bg-indigo-50' : ''
                    }`}
                    onClick={() => setReviewingRequest(request)}
                  >
                    <div className="flex items-center">
                      <div className="w-12 flex items-center justify-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent opening review panel
                            toggleRequestSelection(request.id);
                          }}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                            selectedRequests.has(request.id)
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white border-gray-300 hover:border-indigo-400'
                          }`}
                        >
                          {selectedRequests.has(request.id) && <CheckSquare className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                        {/* Applicant */}
                        <div className="col-span-3 flex items-center space-x-3">
                          <img
                            src={request.form_data.profileImage || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop'}
                            alt={`${request.form_data.firstName} ${request.form_data.lastName}`}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                          <p className="font-medium text-gray-900">{request.form_data.firstName} {request.form_data.lastName}</p>
                        </div>

                        {/* Contact */}
                        <div className="col-span-3 text-sm text-gray-700">
                          <div className="flex items-center space-x-1 mb-1">
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span>{request.form_data.email || 'N/A'}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Phone className="w-4 h-4 text-gray-400" />
                            <span>{request.form_data.phoneNumber}</span>
                          </div>
                        </div>

                        {/* Location */}
                        <div className="col-span-2 text-sm text-gray-700">
                          <div className="flex items-center space-x-1">
                            <MapPin className="w-4 h-4 text-gray-400" />
                            <span>{request.form_data.location}</span>
                          </div>
                        </div>

                        {/* Submitted */}
                        <div className="col-span-2 text-sm text-gray-700">
                          <div className="flex items-center space-x-1">
                            <Clock className="w-4 h-4 text-gray-400" />
                            <span>{new Date(request.submittedDate).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="col-span-2 flex items-center justify-end space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewingRequest(request);
                            }}
                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApproveRequest(request.id);
                            }}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                            title="Approve"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRejectRequest(request.id);
                            }}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Reject"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {filteredRequests.length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500">
                  {memberRequests.length > 0 && searchQuery.trim()
                    ? 'No requests match your search. Clear the search box to see all pending requests.'
                    : 'No member requests found.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Request Review/Edit Panel */}
      <AnimatePresence>
        {reviewingRequest && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setReviewingRequest(null);
                setEditingRequest(null);
              }}
              className="fixed inset-0 bg-black/30 z-40"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto"
            >
              <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-6 border-b border-gray-200 z-10">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-semibold text-white">Review Application</h2>
                  <button
                    onClick={() => {
                      setReviewingRequest(null);
                      setEditingRequest(null);
                    }}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="px-3 py-1 bg-yellow-400 text-yellow-900 rounded-lg text-sm font-semibold">
                    ⏳ Pending Review
                  </span>
                  <span className="text-sm text-white/90">
                    Submitted {new Date(reviewingRequest.submittedDate).toLocaleDateString('en-US', { 
                      month: 'long', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}
                  </span>
                </div>
              </div>

              <div className="p-8 space-y-6">
                <div className="flex items-start space-x-6 p-6 bg-gray-50 rounded-2xl">
                  <img
                    src={reviewingRequest.form_data.profileImage || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop'}
                    alt={`${reviewingRequest.form_data.firstName} ${reviewingRequest.form_data.lastName}`}
                    className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-lg"
                  />
                  <div className="flex-1">
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">{reviewingRequest.form_data.firstName} {reviewingRequest.form_data.lastName}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Gender</p>
                        <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.gender || 'Not specified'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Marital Status</p>
                        <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.maritalStatus || 'Not specified'}</p>
                      </div>

                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Occupation</p>
                        <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.occupation || 'Not specified'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {editingRequest ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-gray-900">Edit Application Details</h4>
                      <button
                        onClick={() => setEditingRequest(null)}
                        className="text-sm text-gray-600 hover:text-gray-800"
                      >
                        Cancel Edit
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.firstName}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, firstName: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.lastName}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, lastName: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input
                          type="email"
                          value={editingRequest.form_data.email || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, email: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                        <input
                          type="tel"
                          value={editingRequest.form_data.phoneNumber}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, phoneNumber: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.location}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, location: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Emergency Contact Name</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.emergencyContactName}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, emergencyContactName: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Emergency Contact Phone</label>
                        <input
                          type="tel"
                          value={editingRequest.form_data.emergencyContactPhone}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, emergencyContactPhone: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
                        <input
                          type="date"
                          value={editingRequest.form_data.dateOfBirth || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, dateOfBirth: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                        <select
                          value={editingRequest.form_data.gender || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, gender: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">Select Gender</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Marital Status</label>
                        <select
                          value={editingRequest.form_data.maritalStatus || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, maritalStatus: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">Select Status</option>
                          <option value="single">Single</option>
                          <option value="married">Married</option>
                          <option value="divorced">Divorced</option>
                          <option value="widowed">Widowed</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Occupation</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.occupation || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, occupation: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Date Joined</label>
                        <input
                          type="date"
                          value={editingRequest.form_data.dateJoined || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, dateJoined: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end space-x-3 mt-6">
                      <button
                        onClick={() => setEditingRequest(null)}
                        className="px-5 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleUpdateEditedRequest}
                        className="px-5 py-2.5 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-sm font-medium"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-900">Contact Information</h4>
                        <button
                          onClick={() => setEditingRequest(reviewingRequest)}
                          className="flex items-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          <Edit2 className="w-4 h-4 mr-1" />
                          Edit Details
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Email Address</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.email || 'N/A'}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Phone Number</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.phoneNumber}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Location</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.location}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Emergency Contact Name</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.emergencyContactName}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Emergency Contact Phone</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.emergencyContactPhone}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Date of Birth</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.dateOfBirth || 'N/A'}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">Date Joined</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.dateJoined || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {reviewingRequest.form_data.notes && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Additional Notes</h4>
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                          <p className="text-sm text-gray-700">{reviewingRequest.form_data.notes}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 bg-white border-t border-gray-200 px-8 py-6 flex items-center justify-between">
                <button
                  onClick={() => handleRejectRequest(reviewingRequest!.id)}
                  className="flex items-center px-6 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-all font-medium"
                >
                  <XCircle className="w-5 h-5 mr-2" />
                  Reject Application
                </button>
                <button
                  onClick={() => handleApproveRequest(reviewingRequest!.id)}
                  className="flex items-center px-8 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all shadow-lg font-medium"
                >
                  <Check className="w-5 h-5 mr-2" />
                  Approve & Add Member
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      <MemberModal
        isOpen={isAddModalOpen || !!editingMember}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingMember(undefined);
        }}
        member={editingMember}
        onSave={handleSaveMember}
      />

      <FamilyGroupModal
        isOpen={isFamilyModalOpen || !!editingFamily}
        onClose={() => {
          setIsFamilyModalOpen(false);
          setEditingFamily(undefined);
        }}
        familyGroup={editingFamily}
        onSave={handleSaveFamily}
      />

      <FamilyGroupDetailModal
        isOpen={!!viewingFamily}
        onClose={() => setViewingFamily(undefined)}
        familyGroup={viewingFamily!}
        members={viewingFamily ? getFamilyMembers(viewingFamily.id) : []}
        onUpdateFamilyName={handleUpdateFamilyName}
        onInitiateRemoveMember={(member, familyId) => setMemberToRemove({ member, familyId })}
        onInitiateDeleteFamily={handleDeleteFamilyFromModal}
      />

      <DeleteModal
        isOpen={!!memberToRemove}
        onClose={() => setMemberToRemove(undefined)}
        onConfirm={handleRemoveMemberFromFamily}
        title="Remove Member"
        message={`Are you sure you want to remove ${memberToRemove?.member.fullName} from this family? This action cannot be reversed.`}
      />

      <DeleteModal
        isOpen={!!deletingMember}
        onClose={() => setDeletingMember(undefined)}
        onConfirm={handleDeleteMember}
        title="Delete Member"
        message={`Are you sure you want to delete ${deletingMember?.fullName}? This action cannot be undone.`}
      />

      <DeleteModal
        isOpen={!!deletingFamily}
        onClose={() => setDeletingFamily(undefined)}
        onConfirm={handleDeleteFamily}
        title="Delete Family Group"
        message={`Are you sure you want to delete ${deletingFamily?.familyName}? This action cannot be undone.`}
      />

      <AIVoiceNoteModal
        isOpen={!!aiNoteMember}
        onClose={() => setAiNoteMember(undefined)}
        memberName={aiNoteMember?.fullName || ''}
      />

      <AssignToFamilyModal
        isOpen={isAssignToFamilyModalOpen}
        onClose={() => setIsAssignToFamilyModalOpen(false)}
        members={members}
        familyGroups={familyGroups}
        selectedMembers={selectedMembers}
        onAssign={handleAssignFamilyGroup}
      />

      <AssignMinistryModal
        isOpen={isAssignMinistryModalOpen}
        onClose={() => setIsAssignMinistryModalOpen(false)}
        members={members}
        selectedMembers={selectedMembers}
        onAssign={handleAssignMinistry}
      />

      <AssignToGroupModal
        isOpen={isAssignToGroupModalOpen}
        onClose={() => {
          setIsAssignToGroupModalOpen(false);
          setMemberToAssign(null);
        }}
        members={members}
        selectedMemberIds={memberToAssign ? [memberToAssign.id] : Array.from(selectedMembers)}
        onAssignmentComplete={handleAssignmentComplete}
      />

      <MemberLinkModal
        isOpen={isMemberLinkModalOpen}
        onClose={() => setIsMemberLinkModalOpen(false)}
        registrationLink={registrationLink}
        registrationQRCode={registrationQRCode}
        downloadQRCode={downloadRegistrationQR}
        shareLink={shareRegistrationLink}
      />

      <MemberDetailPanel
        isOpen={!!viewingMemberDetail}
        onClose={() => setViewingMemberDetail(null)}
        member={viewingMemberDetail as any}
        familyGroups={familyGroups as any}
        allMembers={members as any}
        onEdit={(updated) => {
          setMembers((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } as Member : m))
          );
          setViewingMemberDetail(updated as Member);
        }}
      />
    </>
  );
}
