import { useState, useRef, useEffect, useMemo } from 'react';
import { X, Edit2, Mail, Phone, MapPin, Calendar, Users, Home, TrendingUp, Award, Clock, CheckCircle, XCircle, AlertCircle, Send, FileText, Trash2, Plus, Mic, Square, Play, Pause } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import type { Member, FamilyGroup } from '../../utils/mockData';
import { mockGroups as allMockGroups, mockMembers as allMockMembers } from '../../utils/mockData';

interface MemberDetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  familyGroups?: FamilyGroup[]; // Changed from familyGroup?: FamilyGroup
  allMembers: Member[];
  onEdit: (updatedMember: Member) => void;
}

interface Note {
  id: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  audioUrl?: string;
  audioDuration?: number;
}

// Mock data for events and groups
const mockEvents = [
  { id: '1', name: 'Sunday Service', date: '2026-02-22', attended: true, type: 'worship' },
  { id: '2', name: 'Bible Study', date: '2026-02-25', attended: true, type: 'study' },
  { id: '3', name: 'Youth Conference', date: '2026-02-28', attended: false, type: 'conference' },
  { id: '4', name: 'Prayer Meeting', date: '2026-03-01', attended: true, type: 'prayer' },
  { id: '5', name: 'Community Outreach', date: '2026-03-05', attended: false, type: 'outreach' },
];

const mockUpcomingEvents = [
  { id: '1', name: 'Sunday Worship', date: '2026-03-09', time: '10:00 AM', type: 'worship' },
  { id: '2', name: 'Bible Study', date: '2026-03-11', time: '7:00 PM', type: 'study' },
  { id: '3', name: 'Youth Night', date: '2026-03-14', time: '6:30 PM', type: 'youth' },
  { id: '4', name: 'Prayer Vigil', date: '2026-03-16', time: '9:00 PM', type: 'prayer' },
];

const mockGroups = [
  { id: '1', name: 'Worship Team', role: 'Member' },
  { id: '2', name: 'Youth Ministry', role: 'Leader' },
  { id: '3', name: 'Prayer Warriors', role: 'Member' },
];

export default function MemberDetailPanel({
  isOpen,
  onClose,
  member,
  familyGroups,
  allMembers,
  onEdit,
}: MemberDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'family' | 'ministries' | 'attendance' | 'analytics' | 'notes'>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editedMember, setEditedMember] = useState<Member | null>(null);
  const [showFullImage, setShowFullImage] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Upload to server
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error('Failed to upload image');
      
      const { url } = await response.json();
      
      // Update member with new image URL
      onEdit({ ...member, profileImage: url });
      toast.success('Profile image updated successfully');
    } catch (error) {
      toast.error('Failed to update profile image');
    }
  };
  
  // Notes state
  const [notes, setNotes] = useState<Note[]>([
    {
      id: '1',
      content: 'Member expressed interest in joining the worship team. Follow up scheduled for next Sunday.',
      createdBy: 'Pastor John',
      createdAt: '2026-03-05T10:30:00',
    },
    {
      id: '2',
      content: 'Requested prayer for family situation. Providing pastoral support.',
      createdBy: 'Rev. Sarah',
      createdAt: '2026-03-02T14:20:00',
      audioUrl: 'data:audio/wav;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA',
      audioDuration: 45,
    },
  ]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [deleteConfirmNoteId, setDeleteConfirmNoteId] = useState<string | null>(null);
  
  const [selectedGroup, setSelectedGroup] = useState<{ name: string; members: Member[] } | null>(null);

  const handleOpenGroupModal = (group: any) => {
    const membersInGroup = allMockMembers.filter(m => group.memberIds.includes(m.id));
    setSelectedGroup({ name: group.name, members: membersInGroup });
  };

  const getMemberGroups = (memberId: string) => {
    const trimmedMemberId = String(memberId).trim();
    const groups = allMockGroups.filter(g => g.memberIds.includes(trimmedMemberId));
    return groups;
  };
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playingNoteId, setPlayingNoteId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize edited member when member changes
  useEffect(() => {
    if (member && !editedMember) {
      setEditedMember(member);
    }
  }, [member, editedMember]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  const memberFamilies = useMemo(() => {
    if (!member || !familyGroups?.length) return [];
    const mid = String(member.id).trim();
    return familyGroups.filter((fg) => {
      const inFamilyMemberList = (fg.memberIds || []).some((id) => String(id).trim() === mid);
      const inMemberFamilyIds = member.familyIds?.includes(fg.id) ?? false;
      return inFamilyMemberList || inMemberFamilyIds;
    });
  }, [member, familyGroups]);

  if (!member) return null;

  const currentMember = isEditing && editedMember ? editedMember : member;

  const handleSave = () => {
    // Save logic here - would update the actual member data
    setIsEditing(false);
    onEdit(currentMember); // Notify parent component
  };

  const handleCancel = () => {
    setEditedMember(member);
    setIsEditing(false);
  };

  const updateField = (field: keyof Member, value: string) => {
    if (editedMember) {
      setEditedMember({ ...editedMember, [field]: value });
    }
  };

  // Notes functions
  const handleAddNote = () => {
    // Use the new function that handles both text and audio
    handleAddNoteWithAudio();
  };

  const handleEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingNoteContent(note.content);
  };

  const handleSaveEditNote = (noteId: string) => {
    if (!editingNoteContent.trim()) {
      toast.error('Note content cannot be empty');
      return;
    }

    setNotes(notes.map(note => 
      note.id === noteId 
        ? { ...note, content: editingNoteContent, updatedAt: new Date().toISOString() }
        : note
    ));
    setEditingNoteId(null);
    setEditingNoteContent('');
    toast.success('Note updated successfully');
  };

  const handleCancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteContent('');
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes(notes.filter(note => note.id !== noteId));
    setDeleteConfirmNoteId(null);
    toast.success('Note deleted successfully');
  };

  const formatNoteDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
      }
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
      });
    }
  };

  // Voice recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioBlob(audioBlob);
        setAudioUrl(url);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      // Start timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      toast.success('Recording started');
    } catch (error) {
      toast.error('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
    setRecordingDuration(0);
    setAudioBlob(null);
    setAudioUrl(null);
    audioChunksRef.current = [];
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAddNoteWithAudio = () => {
    if (!newNoteContent.trim() && !audioUrl) {
      toast.error('Please add text or voice note');
      return;
    }

    const newNote: Note = {
      id: Date.now().toString(),
      content: newNoteContent,
      createdBy: 'Current User',
      createdAt: new Date().toISOString(),
      ...(audioUrl && { audioUrl, audioDuration: recordingDuration }),
    };

    setNotes([newNote, ...notes]);
    setNewNoteContent('');
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingDuration(0);
    toast.success('Note added successfully');
  };

  const getEventIcon = (attended: boolean) => {
    if (attended) return <CheckCircle className="w-4 h-4 text-green-600" />;
    return <XCircle className="w-4 h-4 text-red-600" />;
  };

  const getEventTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      worship: 'bg-purple-50 text-purple-700 border-purple-200',
      study: 'bg-blue-50 text-blue-700 border-blue-200',
      prayer: 'bg-pink-50 text-pink-700 border-pink-200',
      conference: 'bg-orange-50 text-orange-700 border-orange-200',
      outreach: 'bg-green-50 text-green-700 border-green-200',
      youth: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    };
    return colors[type] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Group Members Modal */}
          <AnimatePresence>
            {selectedGroup && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedGroup(null)}
                  className="fixed inset-0 bg-black/50 z-[60]"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                >
                  <div className="bg-white rounded-2xl p-6 shadow-xl w-full max-w-md">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">{selectedGroup.name} Members</h3>
                      <button onClick={() => setSelectedGroup(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="space-y-3">
                      {selectedGroup.members.map(member => (
                        <div key={member.id} className="flex items-center space-x-3 p-2 bg-gray-50 rounded-lg">
                          <img src={member.profileImage} alt={member.fullName} className="w-8 h-8 rounded-full object-cover" />
                          <span className="text-sm font-medium text-gray-900">{member.fullName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* Side Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-3xl bg-gray-50 z-50 shadow-2xl overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
              <div className="flex items-center justify-between px-8 py-6">
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col items-center space-y-2">
                    <button 
                      onClick={() => setShowFullImage(true)}
                      className="focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-full"
                    >
                      <img
                        src={member.profileImage}
                        alt={member.fullName}
                        className="w-16 h-16 rounded-full object-cover shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Change Photo
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleImageUpload} 
                      className="hidden" 
                      accept="image/*"
                    />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-gray-900">{member.fullName}</h2>
                    <p className="text-gray-500 mt-1">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleCancel}
                        className="px-4 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-sm font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-4 py-2.5 text-white bg-green-600 hover:bg-green-700 rounded-xl transition-all text-sm font-medium"
                      >
                        Save Changes
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowMessageModal(true)}
                        className="px-4 py-2.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all text-sm font-medium flex items-center space-x-2"
                        title="Send Message"
                      >
                        <Send className="w-4 h-4" />
                        <span>Send Message</span>
                      </button>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="p-2.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        title="Edit Member"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={onClose}
                        className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center space-x-1 px-8 pb-4">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'overview'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('family')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'family'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Family
                </button>
                <button
                  onClick={() => setActiveTab('ministries')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'ministries'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Ministries
                </button>
                <button
                  onClick={() => setActiveTab('attendance')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'attendance'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Attendance
                </button>
                <button
                  onClick={() => setActiveTab('analytics')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'analytics'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Analytics
                </button>
                <button
                  onClick={() => setActiveTab('notes')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'notes'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Notes
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-8 py-6 space-y-6">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <>
                  {/* Contact Information */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Mail className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 mb-1">Email</p>
                          {isEditing ? (
                            <input
                              type="email"
                              value={currentMember.email}
                              onChange={(e) => updateField('email', e.target.value)}
                              className="w-full px-3 py-2 font-medium text-gray-900 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          ) : (
                            <p className="font-medium text-gray-900">{currentMember.email}</p>
                          )}
                        </div>
                        {!isEditing && (
                          <button className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-all font-medium flex-shrink-0">
                            Send
                          </button>
                        )}
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Phone className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 mb-1">Phone Number</p>
                          {isEditing ? (
                            <input
                              type="tel"
                              value={currentMember.phone || currentMember.phoneNumber || ''}
                              onChange={(e) => updateField('phone', e.target.value)}
                              className="w-full px-3 py-2 font-medium text-gray-900 border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          ) : (
                            <p className="font-medium text-gray-900">{currentMember.phone || currentMember.phoneNumber}</p>
                          )}
                        </div>
                        {!isEditing && (
                          <button className="px-4 py-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-all font-medium flex-shrink-0">
                            Call
                          </button>
                        )}
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 mb-1">Location</p>
                          {isEditing ? (
                            <input
                              type="text"
                              value={currentMember.address || currentMember.location || ''}
                              onChange={(e) => updateField('address', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm font-medium text-gray-900 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <p className="text-sm font-medium text-gray-900">{currentMember.address || currentMember.location}</p>
                          )}
                        </div>
                      </div>

                      {(currentMember.emergency_contact_phone || currentMember.emergencyContact || isEditing) && (
                        <div className="flex items-center space-x-3 pt-4 border-t border-gray-100">
                          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                            <AlertCircle className="w-5 h-5 text-red-600" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs text-gray-500 mb-1">Emergency Contact</p>
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={currentMember.emergency_contact_name || ''}
                                  onChange={(e) => updateField('emergency_contact_name', e.target.value)}
                                  placeholder="Contact Name"
                                  className="w-full px-3 py-1.5 text-sm font-medium text-gray-900 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                                <input
                                  type="tel"
                                  value={currentMember.emergency_contact_phone || currentMember.emergencyContact || ''}
                                  onChange={(e) => updateField('emergency_contact_phone', e.target.value)}
                                  placeholder="Contact Phone"
                                  className="w-full px-3 py-1.5 text-sm font-medium text-gray-900 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                              </div>
                            ) : (
                              <div className="text-sm font-medium text-gray-900">
                                <p>{currentMember.emergency_contact_name || 'N/A'}</p>
                                <p className="text-xs text-gray-500">{currentMember.emergency_contact_phone || currentMember.emergencyContact || 'N/A'}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  </div>

                  {/* Member Information */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Member Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Gender</p>
                        {isEditing ? (
                          <select
                            value={currentMember.gender || ''}
                            onChange={(e) => updateField('gender', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="">Select Gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.gender || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Date of Birth</p>
                        {isEditing ? (
                          <input
                            type="date"
                            value={currentMember.dob || ''}
                            onChange={(e) => updateField('dob', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.dob || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Marital Status</p>
                        {isEditing ? (
                          <select
                            value={currentMember.marital_status || ''}
                            onChange={(e) => updateField('marital_status', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="">Select Status</option>
                            <option value="Single">Single</option>
                            <option value="Married">Married</option>
                            <option value="Divorced">Divorced</option>
                            <option value="Widowed">Widowed</option>
                          </select>
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.marital_status || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Occupation</p>
                        {isEditing ? (
                          <input
                            type="text"
                            value={currentMember.occupation || ''}
                            onChange={(e) => updateField('occupation', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.occupation || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Member ID</p>
                        <p className="font-medium text-gray-900">{currentMember.member_id_string || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Date Joined</p>
                        <p className="font-medium text-gray-900">{currentMember.date_joined || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Personal Information */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Member Information</h3>
                    <div className="grid grid-cols-2 gap-4">

                      <div>
                        <p className="text-xs text-gray-500 mb-1">Member ID</p>
                        <p className="text-sm font-medium text-gray-900">#{member.id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Last Attendance</p>
                        <p className="text-sm font-medium text-gray-900">
                          {new Date(member.lastAttendance).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Status</p>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700">
                          Active
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Family Tab */}
              {activeTab === 'family' && (
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Family Groups ({memberFamilies.length})</h3>
                  {memberFamilies.length > 0 ? (
                    <div className="space-y-2">
                      {memberFamilies.map((familyGroup) => {
                        const memberCount = (familyGroup.memberIds || []).length
                          || allMembers.filter((m) => m.familyIds?.includes(familyGroup.id)).length;
                        return (
                          <div key={familyGroup.id} className="p-4 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{familyGroup.familyName}</span>
                              <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">{memberCount} members</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">This member is not assigned to any family group.</p>
                  )}
                </div>
              )}
              
              {/* Ministries Tab */}
              {activeTab === 'ministries' && (
                <>
                  {mockGroups.length > 0 ? (
                    <>
                      {/* Ministry Summary Cards */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-5 shadow-lg text-white text-center">
                          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <Users className="w-6 h-6" />
                          </div>
                          <p className="text-2xl font-bold">{mockGroups.length}</p>
                          <p className="text-xs text-indigo-100 mt-1">Total Groups</p>
                        </div>

                        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-5 shadow-lg text-white text-center">
                          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <Award className="w-6 h-6" />
                          </div>
                          <p className="text-2xl font-bold">{mockGroups.filter(g => g.role === 'Leader').length}</p>
                          <p className="text-xs text-purple-100 mt-1">Leadership Roles</p>
                        </div>

                        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white text-center">
                          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <CheckCircle className="w-6 h-6" />
                          </div>
                          <p className="text-2xl font-bold">95%</p>
                          <p className="text-xs text-blue-100 mt-1">Participation</p>
                        </div>
                      </div>

                      {/* Ministry Groups List */}
                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">Active Ministry Groups</h3>
                          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-lg">
                            {mockGroups.length} Groups
                          </span>
                        </div>
                        <div className="space-y-4">
                          {mockGroups.map((group) => (
                            <div
                              key={group.id}
                              className="p-5 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-3">
                                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                    group.role === 'Leader'
                                      ? 'bg-gradient-to-br from-purple-500 to-purple-600 text-white'
                                      : 'bg-indigo-50'
                                  }`}>
                                    {group.role === 'Leader' ? (
                                      <Award className="w-6 h-6" />
                                    ) : (
                                      <Users className="w-6 h-6 text-indigo-600" />
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="font-semibold text-gray-900 text-base">{group.name}</h4>

                                  </div>
                                </div>
                                <span
                                  className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                                    group.role === 'Leader'
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-indigo-100 text-indigo-700'
                                  }`}
                                >
                                  {group.role}
                                </span>
                              </div>

                              {/* Group Activity Details */}
                              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-200">
                                <div className="text-center">
                                  <p className="text-lg font-bold text-gray-900">24</p>
                                  <p className="text-xs text-gray-500">Meetings</p>
                                </div>
                                <div className="text-center border-l border-r border-gray-200">
                                  <p className="text-lg font-bold text-gray-900">92%</p>
                                  <p className="text-xs text-gray-500">Attendance</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-lg font-bold text-gray-900">18m</p>
                                  <p className="text-xs text-gray-500">Duration</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Ministry Engagement Chart */}
                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Ministry Engagement Timeline</h3>
                        <div className="space-y-4">
                          {mockGroups.map((group, index) => (
                            <div key={group.id}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-700">{group.name}</span>
                                <span className="text-sm font-semibold text-gray-900">
                                  {95 - index * 3}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2.5">
                                <div
                                  className={`h-2.5 rounded-full transition-all ${
                                    group.role === 'Leader'
                                      ? 'bg-gradient-to-r from-purple-500 to-purple-600'
                                      : 'bg-gradient-to-r from-indigo-500 to-blue-500'
                                  }`}
                                  style={{ width: `${95 - index * 3}%` }}
                                />
                              </div>

                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Ministry Impact */}
                      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 shadow-lg text-white">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold">Ministry Impact Score</h3>
                          <Award className="w-8 h-8 text-white/80" />
                        </div>
                        <div className="mb-4">
                          <div className="flex items-end space-x-2 mb-2">
                            <p className="text-5xl font-bold">9.2</p>
                            <p className="text-xl text-white/80 mb-2">/10</p>
                          </div>
                          <p className="text-sm text-white/80">
                            Outstanding contributor across {mockGroups.length} ministry groups
                          </p>
                        </div>
                        <div className="w-full bg-white/20 rounded-full h-3">
                          <div className="bg-white h-3 rounded-full transition-all" style={{ width: '92%' }} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-200 text-center">
                      <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-4xl">
                        👥
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No Ministry Groups</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        This member hasn't joined any ministry groups yet.
                      </p>
                      <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all text-sm font-medium">
                        Add to Ministry
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Attendance Tab */}
              {activeTab === 'attendance' && (
                <>
                  {/* Member Statistics */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                      <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Calendar className="w-6 h-6 text-purple-600" />
                      </div>
                      <p className="text-2xl font-bold text-gray-900">
                        Active
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Status</p>
                    </div>

                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                      <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                        <CheckCircle className="w-6 h-6 text-green-600" />
                      </div>
                      <p className="text-2xl font-bold text-gray-900">N/A</p>
                      <p className="text-xs text-gray-500 mt-1">Attendance Rate</p>
                      <p className="text-xs text-gray-400 mt-1">Last 12 months</p>
                    </div>

                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                      <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Users className="w-6 h-6 text-blue-600" />
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{mockGroups.length}</p>
                      <p className="text-xs text-gray-500 mt-1">Groups Joined</p>
                      <p className="text-xs text-gray-400 mt-1">Active member</p>
                    </div>
                  </div>

                  {/* Upcoming Events */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Upcoming Events</h3>
                      <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-lg">
                        {mockUpcomingEvents.length} Events
                      </span>
                    </div>
                    <div className="space-y-3">
                      {mockUpcomingEvents.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-center justify-between p-4 border-l-4 border-indigo-500 bg-indigo-50/50 rounded-lg hover:bg-indigo-50 transition-all"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                              <Calendar className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                              <h4 className="font-medium text-gray-900">{event.name}</h4>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {new Date(event.date).toLocaleDateString()} at {event.time}
                              </p>
                            </div>
                          </div>
                          <span className={`px-3 py-1 rounded-lg text-xs font-medium border ${getEventTypeColor(event.type)}`}>
                            {event.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Event Attendance History */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold text-gray-900">Event Attendance History</h3>
                      <div className="flex items-center space-x-2">
                        <span className="flex items-center space-x-1 text-xs text-gray-500">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>Attended</span>
                        </span>
                        <span className="text-gray-300">|</span>
                        <span className="flex items-center space-x-1 text-xs text-gray-500">
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span>Missed</span>
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {mockEvents.map((event) => (
                        <div
                          key={event.id}
                          className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                            event.attended
                              ? 'bg-green-50/50 border-green-200'
                              : 'bg-red-50/50 border-red-200'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              event.attended ? 'bg-green-100' : 'bg-red-100'
                            }`}>
                              {getEventIcon(event.attended)}
                            </div>
                            <div>
                              <h4 className="font-medium text-gray-900">{event.name}</h4>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {new Date(event.date).toLocaleDateString('en-US', {
                                  weekday: 'short',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className={`px-3 py-1 rounded-lg text-xs font-medium border ${getEventTypeColor(event.type)}`}>
                              {event.type}
                            </span>
                            <span
                              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                                event.attended
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {event.attended ? 'Attended' : 'Missed'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Analytics Tab */}
              {activeTab === 'analytics' && (
                <>
                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 shadow-lg text-white">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                          <TrendingUp className="w-6 h-6" />
                        </div>
                        <span className="px-3 py-1 bg-white/20 rounded-lg text-xs font-medium">
                          +12%
                        </span>
                      </div>
                      <p className="text-3xl font-bold">N/A</p>
                      <p className="text-sm text-purple-100 mt-1">Attendance Rate</p>
                    </div>

                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 shadow-lg text-white">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                          <Award className="w-6 h-6" />
                        </div>
                        <span className="px-3 py-1 bg-white/20 rounded-lg text-xs font-medium">
                          Top 10%
                        </span>
                      </div>
                      <p className="text-3xl font-bold">8.5</p>
                      <p className="text-sm text-blue-100 mt-1">Engagement Score</p>
                    </div>
                  </div>

                  {/* Monthly Attendance Trend */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-6">Monthly Attendance Trend</h3>
                    <div className="space-y-4">
                      {[
                        { month: 'January', rate: 95, events: 12 },
                        { month: 'February', rate: 88, events: 11 },
                        { month: 'March', rate: 92, events: 8 },
                      ].map((data) => (
                        <div key={data.month}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">{data.month}</span>
                            <span className="text-sm font-semibold text-gray-900">{data.rate}%</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2.5">
                            <div
                              className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all"
                              style={{ width: `${data.rate}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{data.events} events attended</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Activity Summary */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Summary</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200">
                        <div className="flex items-center space-x-2 mb-2">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <p className="text-sm font-medium text-gray-700">Events Attended</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">32</p>
                        <p className="text-xs text-gray-500 mt-1">Last 90 days</p>
                      </div>

                      <div className="p-4 bg-gradient-to-br from-red-50 to-rose-50 rounded-xl border border-red-200">
                        <div className="flex items-center space-x-2 mb-2">
                          <XCircle className="w-5 h-5 text-red-600" />
                          <p className="text-sm font-medium text-gray-700">Events Missed</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">4</p>
                        <p className="text-xs text-gray-500 mt-1">Last 90 days</p>
                      </div>

                      <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                        <div className="flex items-center space-x-2 mb-2">
                          <Users className="w-5 h-5 text-blue-600" />
                          <p className="text-sm font-medium text-gray-700">Group Activities</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">18</p>
                        <p className="text-xs text-gray-500 mt-1">Last 90 days</p>
                      </div>

                      <div className="p-4 bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl border border-purple-200">
                        <div className="flex items-center space-x-2 mb-2">
                          <Clock className="w-5 h-5 text-purple-600" />
                          <p className="text-sm font-medium text-gray-700">Avg. Duration</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">2.5h</p>
                        <p className="text-xs text-gray-500 mt-1">Per event</p>
                      </div>
                    </div>
                  </div>

                  {/* Engagement Level */}
                  <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 shadow-lg text-white">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Overall Engagement Level</h3>
                      <Award className="w-8 h-8 text-white/80" />
                    </div>
                    <div className="mb-4">
                      <div className="flex items-end space-x-2 mb-2">
                        <p className="text-5xl font-bold">8.5</p>
                        <p className="text-xl text-white/80 mb-2">/10</p>
                      </div>
                      <p className="text-sm text-white/80">Excellent - Top 10% of members</p>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-3">
                      <div className="bg-white h-3 rounded-full transition-all" style={{ width: '85%' }} />
                    </div>
                  </div>
                </>
              )}

              {/* Notes Tab */}
              {activeTab === 'notes' && (
                <>
                  {/* Add New Note */}
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <Plus className="w-4 h-4 text-indigo-600" />
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900">Add New Note</h3>
                    </div>
                    
                    <textarea
                      value={newNoteContent}
                      onChange={(e) => setNewNoteContent(e.target.value)}
                      rows={3}
                      placeholder="Enter note about this member..."
                      style={{ fontSize: '13px' }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                    />

                    {/* Voice Recording Section */}
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Mic className="w-4 h-4 text-gray-600" />
                          <span className="text-sm font-medium text-gray-700">Voice Note</span>
                        </div>
                        
                        {!isRecording && !audioUrl && (
                          <button
                            onClick={startRecording}
                            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all text-sm font-medium flex items-center gap-1.5"
                          >
                            <Mic className="w-3.5 h-3.5" />
                            Record
                          </button>
                        )}

                        {isRecording && (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg">
                              <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
                              <span className="text-sm font-mono font-semibold">
                                {formatDuration(recordingDuration)}
                              </span>
                            </div>
                            <button
                              onClick={stopRecording}
                              className="p-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all"
                              title="Stop recording"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={cancelRecording}
                              className="p-1.5 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-all"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {audioUrl && !isRecording && (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg">
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span className="text-sm font-semibold">
                                {formatDuration(recordingDuration)}
                              </span>
                            </div>
                            <audio src={audioUrl} controls className="h-8" style={{ fontSize: '11px' }} />
                            <button
                              onClick={cancelRecording}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                              title="Remove recording"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleAddNote}
                        disabled={!newNoteContent.trim() && !audioUrl}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Note
                      </button>
                    </div>
                  </div>

                  {/* Notes List */}
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900">Member Notes</h3>
                      </div>
                      <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-medium rounded">
                        {notes.length}
                      </span>
                    </div>

                    {notes.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                          <FileText className="w-6 h-6 text-gray-400" />
                        </div>
                        <p style={{ fontSize: '13px' }} className="text-gray-500 mb-1">No notes yet</p>
                        <p className="text-xs text-gray-400">Add your first note above</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {notes.map((note) => (
                          <div
                            key={note.id}
                            className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-all"
                          >
                            {editingNoteId === note.id ? (
                              // Edit Mode
                              <div className="space-y-2">
                                <textarea
                                  value={editingNoteContent}
                                  onChange={(e) => setEditingNoteContent(e.target.value)}
                                  rows={3}
                                  style={{ fontSize: '13px' }}
                                  className="w-full px-3 py-2 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                                  autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={handleCancelEditNote}
                                    className="px-3 py-1.5 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all text-sm font-medium"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveEditNote(note.id)}
                                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all text-sm font-medium"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              // View Mode
                              <>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex-1">
                                    {note.content && (
                                      <p style={{ fontSize: '13px' }} className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                                        {note.content}
                                      </p>
                                    )}
                                    {note.audioUrl && (
                                      <div className="mt-2 flex items-center gap-2 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                                        <Mic className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                                        <audio 
                                          src={note.audioUrl} 
                                          controls 
                                          className="flex-1 h-8" 
                                          style={{ maxWidth: '100%' }}
                                        />
                                        <span className="text-xs text-indigo-600 font-medium whitespace-nowrap">
                                          {formatDuration(note.audioDuration || 0)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-0.5 flex-shrink-0">
                                    <button
                                      onClick={() => handleEditNote(note)}
                                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all"
                                      title="Edit note"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirmNoteId(note.id)}
                                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                      title="Delete note"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-[10px] font-semibold">
                                      {note.createdBy.split(' ').map(n => n[0]).join('')}
                                    </div>
                                    <span className="font-medium text-gray-700">{note.createdBy}</span>
                                  </div>
                                  <span>•</span>
                                  <span>{formatNoteDate(note.createdAt)}</span>
                                  {note.updatedAt && (
                                    <>
                                      <span>•</span>
                                      <span className="text-gray-400">(edited)</span>
                                    </>
                                  )}
                                </div>

                                {/* Delete Confirmation */}
                                {deleteConfirmNoteId === note.id && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg"
                                  >
                                    <p style={{ fontSize: '13px' }} className="text-red-800 mb-2">
                                      Are you sure you want to delete this note? This action cannot be undone.
                                    </p>
                                    <div className="flex justify-end gap-2">
                                      <button
                                        onClick={() => setDeleteConfirmNoteId(null)}
                                        className="px-3 py-1.5 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all text-sm font-medium"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleDeleteNote(note.id)}
                                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all text-sm font-medium"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </motion.div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Notes Statistics */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 text-center">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center mx-auto mb-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-gray-900">{notes.length}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Total Notes</p>
                    </div>

                    <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 text-center">
                      <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center mx-auto mb-2">
                        <Clock className="w-4 h-4 text-green-600" />
                      </div>
                      <p style={{ fontSize: '13px' }} className="font-bold text-gray-900">
                        {notes.length > 0 ? formatNoteDate(notes[0].createdAt) : '-'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Last Updated</p>
                    </div>

                    <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 text-center">
                      <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center mx-auto mb-2">
                        <Users className="w-4 h-4 text-purple-600" />
                      </div>
                      <p className="text-xl font-bold text-gray-900">
                        {new Set(notes.map(n => n.createdBy)).size}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Contributors</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}

      {/* Full Image Modal */}
      <AnimatePresence>
        {showFullImage && (
          <motion.div key="full-image-modal">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFullImage(false)}
              className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
            >
              {/* Close Button */}
              <button
                onClick={() => setShowFullImage(false)}
                className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Image */}
              <motion.img
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                src={member.profileImage}
                alt={member.fullName}
                className="max-w-2xl max-h-[80vh] w-auto h-auto rounded-3xl shadow-2xl object-contain"
                onClick={(e) => e.stopPropagation()}
              />

              {/* Member Name Label */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ delay: 0.1 }}
                className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-white/10 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/20"
              >
                <p className="text-white font-semibold text-lg">{member.fullName}</p>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Send Message Modal */}
      <AnimatePresence>
        {showMessageModal && (
          <motion.div key="message-modal">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMessageModal(false)}
              className="fixed inset-0 bg-black/50 z-[60]"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-white rounded-2xl shadow-2xl z-[70] max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-indigo-500 to-indigo-600">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                    <Send className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Send Message</h3>
                    <p className="text-sm text-white/90">To: {member.fullName}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMessageModal(false)}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-180px)]">
                {/* Delivery Method */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery Method
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button className="flex flex-col items-center p-4 border-2 border-indigo-600 bg-indigo-50 rounded-xl transition-all">
                      <Phone className="w-6 h-6 text-indigo-600 mb-2" />
                      <span className="text-sm font-medium text-indigo-600">WhatsApp</span>
                      <span className="text-xs text-indigo-500 mt-1">✓ Verified</span>
                    </button>
                    <button className="flex flex-col items-center p-4 border-2 border-gray-200 hover:border-gray-300 bg-white rounded-xl transition-all">
                      <Phone className="w-6 h-6 text-gray-600 mb-2" />
                      <span className="text-sm font-medium text-gray-700">SMS</span>
                      <span className="text-xs text-gray-500 mt-1">Available</span>
                    </button>
                    <button className="flex flex-col items-center p-4 border-2 border-gray-200 hover:border-gray-300 bg-white rounded-xl transition-all">
                      <Mail className="w-6 h-6 text-gray-600 mb-2" />
                      <span className="text-sm font-medium text-gray-700">Email</span>
                      <span className="text-xs text-gray-500 mt-1">Available</span>
                    </button>
                  </div>
                </div>

                {/* Message Subject (for Email) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    placeholder="Enter message subject..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>

                {/* Message Content */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Message
                  </label>
                  <textarea
                    rows={6}
                    placeholder="Type your message here..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">💡 Use WhatsApp for instant delivery</p>
                </div>

                {/* Schedule Option */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Schedule for later</span>
                      <p className="text-xs text-gray-500">Send this message at a specific date and time</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => setShowMessageModal(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    toast.success('Message sent successfully!');
                    setShowMessageModal(false);
                  }}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-sm font-medium flex items-center space-x-2"
                >
                  <Send className="w-4 h-4" />
                  <span>Send Message</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}