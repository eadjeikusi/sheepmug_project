import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Users, Calendar, Plus, QrCode, User, ChevronRight, Download, Share2, Check, X, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import type { Group, Member, Event, JoinRequest } from '../../utils/mockData';
import { mockMembers, mockPastors, mockEvents, mockGroups, mockJoinRequests } from '../../utils/mockData';
import CreateEventModal from '../modals/CreateEventModal';
import EventAttendanceModal from '../modals/EventAttendanceModal';
import CreateSubgroupModal from '../modals/CreateSubgroupModal';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { memberStatusBadgePair } from '../../utils/memberStatusBadge';
import { displayTitleWords } from '@/utils/displayText';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';

export default function GroupDetail() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'events' | 'requests' | 'subgroups'>('overview');
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | undefined>();
  const [qrCodePublic, setQrCodePublic] = useState('');
  const [qrCodeJoin, setQrCodeJoin] = useState('');
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>(mockJoinRequests);
  const [isCreateSubgroupOpen, setIsCreateSubgroupOpen] = useState(false);
  const [showPublicQRModal, setShowPublicQRModal] = useState(false);
  const [showJoinQRModal, setShowJoinQRModal] = useState(false);

  const group = mockGroups.find(g => g.id === groupId);

  useEffect(() => {
    if (group) {
      // Generate QR codes
      QRCode.toDataURL(group.publicViewLink, { width: 200 }).then(setQrCodePublic);
      QRCode.toDataURL(group.joinLink, { width: 200 }).then(setQrCodeJoin);
    }
  }, [group]);

  if (!group) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Group Not Found</h2>
          <button
            onClick={() => navigate('/groups')}
            className="text-blue-600 hover:text-blue-700"
          >
            Back to Groups
          </button>
        </div>
      </div>
    );
  }

  const members = mockMembers.filter(m => group.memberIds.includes(m.id));
  const leader = mockMembers.find(m => m.id === group.leaderId) || mockPastors.find(p => p.id === group.leaderId);
  const groupEvents = mockEvents.filter(e => e.groupId === group.id);
  const subgroups = mockGroups.filter(g => g.parentGroupId === group.id);
  const parentGroup = group.parentGroupId ? mockGroups.find(g => g.id === group.parentGroupId) : null;
  const groupJoinRequests = joinRequests.filter(r => r.groupId === group.id);
  const pendingRequests = groupJoinRequests.filter(r => r.status === 'pending');

  const handleCreateEvent = (eventData: any) => {
    toast.success(`Event "${eventData.title}" created for ${group.name}!`);
    setIsCreateEventOpen(false);
  };

  const handleCreateSubgroup = (subgroupData: any) => {
    toast.success(`Subgroup "${subgroupData.name}" created successfully!`);
    setIsCreateSubgroupOpen(false);
  };

  const handleApproveRequest = (requestId: string) => {
    setJoinRequests(prev =>
      prev.map(r => r.id === requestId ? { ...r, status: 'approved' as const } : r)
    );
    toast.success('Join request approved!');
  };

  const handleRejectRequest = (requestId: string) => {
    setJoinRequests(prev =>
      prev.map(r => r.id === requestId ? { ...r, status: 'rejected' as const } : r)
    );
    toast.error('Join request rejected');
  };

  const downloadQRCode = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    toast.success('QR Code downloaded!');
  };

  const shareLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success('Link copied to clipboard!');
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'youth': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'music': return 'bg-pink-50 text-pink-700 border-pink-200';
      case 'ministry': return 'bg-blue-50 text-blue-700 border-blue-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/groups')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Groups
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-4 flex-1">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
              <Users className="w-8 h-8 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <h1 className="text-3xl font-semibold text-gray-900">{displayTitleWords(group.name)}</h1>
                <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-medium border ${getTypeColor(group.type)}`}>
                  {group.type}
                </span>
                {group.parentGroupId && parentGroup && (
                  <span className="inline-flex items-center text-sm text-gray-500">
                    <ChevronRight className="w-3 h-3 mx-1" />
                    Subgroup of {parentGroup.name}
                  </span>
                )}
              </div>
              <p className="text-gray-500 mb-3">{group.description}</p>
              <div className="flex items-center space-x-4 text-sm">
                <div className="flex items-center text-gray-600">
                  <Users className="w-4 h-4 mr-1.5" />
                  <span>{members.length} members</span>
                </div>
                <div className="flex items-center text-gray-600">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  <span>{groupEvents.length} events</span>
                </div>
                {subgroups.length > 0 && (
                  <div className="flex items-center text-gray-600">
                    <Users className="w-4 h-4 mr-1.5" />
                    <span>{subgroups.length} subgroups</span>
                  </div>
                )}
                {pendingRequests.length > 0 && (
                  <div className="flex items-center text-amber-600 font-medium">
                    <Clock className="w-4 h-4 mr-1.5" />
                    <span>{pendingRequests.length} pending requests</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowPublicQRModal(true)}
              className="flex items-center px-4 py-2.5 text-blue-600 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-all shadow-sm"
            >
              <QrCode className="w-4 h-4 mr-2" />
              Public QR
            </button>
            <button
              onClick={() => setShowJoinQRModal(true)}
              className="flex items-center px-4 py-2.5 text-blue-600 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-all shadow-sm"
            >
              <QrCode className="w-4 h-4 mr-2" />
              Join QR
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-6 py-3 font-medium rounded-t-xl transition-all ${
            activeTab === 'overview'
              ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`px-6 py-3 font-medium rounded-t-xl transition-all ${
            activeTab === 'members'
              ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          Members ({members.length})
        </button>
        <button
          onClick={() => setActiveTab('events')}
          className={`px-6 py-3 font-medium rounded-t-xl transition-all ${
            activeTab === 'events'
              ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          Events ({groupEvents.length})
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-6 py-3 font-medium rounded-t-xl transition-all relative ${
            activeTab === 'requests'
              ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          Requests ({pendingRequests.length})
          {pendingRequests.length > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('subgroups')}
          className={`px-6 py-3 font-medium rounded-t-xl transition-all ${
            activeTab === 'subgroups'
              ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          Subgroups ({subgroups.length})
        </button>
      </div>

      {/* Content */}
      <div>
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* QR Codes Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Public View QR Code */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-50 rounded-2xl p-6 border border-blue-100">
                <h3 className="text-sm font-medium text-gray-900 mb-4">
                  🌐 Public View Link
                </h3>
                <p className="text-xs text-gray-600 mb-4">
                  Share this QR code or link publicly to let anyone view group details and events
                </p>
                {qrCodePublic && (
                  <div className="bg-white rounded-xl p-4 flex flex-col items-center mb-4">
                    <img src={qrCodePublic} alt="Public View QR Code" className="w-48 h-48 mb-3" />
                    <code className="text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-lg mb-3">
                      {group.publicViewLink}
                    </code>
                  </div>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={() => downloadQRCode(qrCodePublic, `${group.name}-public-qr.png`)}
                    className="flex-1 flex items-center justify-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </button>
                  <button
                    onClick={() => shareLink(group.publicViewLink)}
                    className="flex-1 flex items-center justify-center px-4 py-2 text-sm text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-all"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </button>
                </div>
              </div>

              {/* Member Join QR Code */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-50 rounded-2xl p-6 border border-blue-100">
                <h3 className="text-sm font-medium text-gray-900 mb-4">
                  ✅ Member Join Link
                </h3>
                <p className="text-xs text-gray-600 mb-4">
                  Share this with existing members to let them request to join the group
                </p>
                {qrCodeJoin && (
                  <div className="bg-white rounded-xl p-4 flex flex-col items-center mb-4">
                    <img src={qrCodeJoin} alt="Member Join QR Code" className="w-48 h-48 mb-3" />
                    <code className="text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-lg mb-3">
                      {group.joinLink}
                    </code>
                  </div>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={() => downloadQRCode(qrCodeJoin, `${group.name}-join-qr.png`)}
                    className="flex-1 flex items-center justify-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </button>
                  <button
                    onClick={() => shareLink(group.joinLink)}
                    className="flex-1 flex items-center justify-center px-4 py-2 text-sm text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-all"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </button>
                </div>
              </div>
            </div>

            {/* Leader Section */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-3">
                Group Leader
              </h3>
              {leader && (
                <div className="bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-100 rounded-2xl p-6">
                  <div className="flex items-center space-x-4">
                    <img
                      src={leader.profile_image || (leader as Member).member_url}
                      alt={`${leader.first_name} ${leader.last_name}`}
                      className="w-16 h-16 rounded-xl object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{leader.first_name} {leader.last_name}</h4>
                      <p className="text-sm text-gray-600 mt-1">{leader.email}</p>
                      <p className="text-sm text-gray-600">{leader.phone}</p>
                    </div>
                    <div className="text-center">
                      <User className="w-8 h-8 text-blue-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">Leader</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Subgroups Section */}
            {subgroups.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">
                  Subgroups ({subgroups.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {subgroups.map((subgroup) => {
                    const subLeader = mockMembers.find(m => m.id === subgroup.leaderId) || 
                                     mockPastors.find(p => p.id === subgroup.leaderId);
                    return (
                      <button
                        key={subgroup.id}
                        onClick={() => navigate(`/groups/${subgroup.id}`)}
                        className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-blue-200 hover:shadow-sm transition-all text-left"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{displayTitleWords(subgroup.name)}</h4>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${getTypeColor(subgroup.type)}`}>
                            {subgroup.type}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mb-3">{subgroup.description}</p>
                        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                          <div className="flex items-center space-x-2 text-sm text-gray-500">
                            <Users className="w-4 h-4" />
                            <span>{subgroup.memberIds.length} members</span>
                          </div>
                          {subLeader && (
                            <div className="flex items-center space-x-2">
                              <img
                                src={subLeader.profile_image || (subLeader as Member).member_url || ''}
                                alt={`${subLeader.first_name} ${subLeader.last_name}`}
                                className="w-6 h-6 rounded-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                              <span className="text-xs text-gray-600">{subLeader.first_name} {subLeader.last_name}</span>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-3">
                Quick Stats
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-2xl p-6">
                  <p className="text-sm text-gray-500 mb-2">Total Members</p>
                  <p className="text-3xl font-semibold text-gray-900">{members.length}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-6">
                  <p className="text-sm text-gray-500 mb-2">Upcoming Events</p>
                  <p className="text-3xl font-semibold text-gray-900">
                    {groupEvents.filter(e => new Date(e.date) >= new Date()).length}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-6">
                  <p className="text-sm text-gray-500 mb-2">Avg Attendance</p>
                  <p className="text-3xl font-semibold text-gray-900">
                    {members.length > 0 ? Math.round(members.reduce((acc, m) => acc + m.attendanceRate, 0) / members.length) : 0}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Members Tab */}
        {activeTab === 'members' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map((member) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
              >
                <div className="flex items-start space-x-3">
                  <img
                    src={member.member_url || ''}
                    alt={`${member.first_name} ${member.last_name}`}
                    className="w-14 h-14 rounded-xl object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900">{member.first_name} {member.last_name}</h4>
                    <p className="text-xs text-gray-500 mb-2">{member.email}</p>
                    
                    <div className="flex items-center space-x-3 mt-3">
                      <div>
                        <p className="text-xs text-gray-500">Status</p>
                        {(() => {
                          const { chipClass, dotClass, text } = memberStatusBadgePair(member.status, []);
                          return (
                            <span
                              className={`inline-flex items-center mt-0.5 px-2 py-0.5 rounded-md text-xs font-semibold border ${chipClass}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full mr-1 ${dotClass}`} />
                              {text}
                            </span>
                          );
                        })()}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Joined</p>
                        <p className="text-sm font-semibold text-gray-900">{member.date_joined ? formatLongWeekdayDate(member.date_joined) || 'N/A' : 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {members.length === 0 && (
              <div className="col-span-full text-center py-12">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No members in this group yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Events Tab */}
        {activeTab === 'events' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setIsCreateEventOpen(true)}
                className="flex items-center px-4 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Event
              </button>
            </div>

            {groupEvents.length > 0 ? (
              <div className="space-y-3">
                {groupEvents.map((event) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-blue-200 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h4 className="font-semibold text-gray-900">{event.title}</h4>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700">
                            {event.type}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
                          <span>📅 {formatLongWeekdayDate(String(event.date)) || '—'}</span>
                          <span>🕒 {event.time}</span>
                          <span>📍 {event.location}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          {event.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs bg-gray-100 text-gray-600">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-end space-y-2 ml-4">
                        <div className="text-center px-4 py-2 bg-blue-50 rounded-xl">
                          <p className="text-2xl font-semibold text-blue-700">{event.attendanceCount}</p>
                          <p className="text-xs text-blue-600">Attended</p>
                        </div>
                        <button
                          onClick={() => setSelectedEvent(event)}
                          className="flex items-center px-3 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-all"
                        >
                          <QrCode className="w-3 h-3 mr-1.5" />
                          Take Attendance
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-2xl">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">No events scheduled for this group yet.</p>
                <button
                  onClick={() => setIsCreateEventOpen(true)}
                  className="inline-flex items-center px-4 py-2 text-sm text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-all"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Event
                </button>
              </div>
            )}
          </div>
        )}

        {/* Requests Tab */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-6">
              <p className="text-sm text-blue-900">
                <strong>Join Requests:</strong> Review and approve members who want to join this group. Members must be in the church database to request to join.
              </p>
            </div>

            {groupJoinRequests.length > 0 ? (
              <div className="space-y-3">
                {groupJoinRequests.map((request) => {
                  const member = mockMembers.find(m => m.id === request.memberId);
                  if (!member) return null;

                  return (
                    <motion.div
                      key={request.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`bg-white border-2 rounded-2xl p-6 transition-all ${
                        request.status === 'pending'
                          ? 'border-amber-200'
                          : request.status === 'approved'
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-4 flex-1">
                          <img
                            src={member.member_url || ''}
                            alt={`${member.first_name} ${member.last_name}`}
                            className="w-16 h-16 rounded-xl object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <h4 className="font-semibold text-gray-900">{member.first_name} {member.last_name}</h4>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${
                                request.status === 'pending'
                                  ? 'bg-amber-100 text-amber-700'
                                  : request.status === 'approved'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {request.status}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{member.email}</p>
                            <p className="text-sm text-gray-900 mb-3 italic">"{request.message}"</p>
                            <div className="flex items-center space-x-4 text-xs text-gray-500">
                              <span>📅 Requested: {formatLongWeekdayDate(String(request.requestDate)) || '—'}</span>
                              <span>📊 Attendance Rate: {member.attendanceRate}%</span>
                              <span>👥 Current Groups: {member.groupIds.length}</span>
                            </div>
                          </div>
                        </div>

                        {request.status === 'pending' && (
                          <div className="flex space-x-2 ml-4">
                            <button
                              onClick={() => handleApproveRequest(request.id)}
                              className="flex items-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all"
                            >
                              <Check className="w-4 h-4 mr-1.5" />
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectRequest(request.id)}
                              className="flex items-center px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all"
                            >
                              <X className="w-4 h-4 mr-1.5" />
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-2xl">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No join requests yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Subgroups Tab */}
        {activeTab === 'subgroups' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="bg-gradient-to-r from-blue-50 to-pink-50 border border-blue-100 rounded-2xl p-4 flex-1 mr-4">
                <p className="text-sm text-blue-900">
                  <strong>Subgroups:</strong> These are specialized teams or divisions within{' '}
                  {displayTitleWords(group.name)}. Click any subgroup to view its full details, members, events, and manage
                  join requests.
                </p>
              </div>
              <button
                onClick={() => setIsCreateSubgroupOpen(true)}
                className="flex items-center px-4 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm whitespace-nowrap"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Subgroup
              </button>
            </div>

            {subgroups.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {subgroups.map((subgroup, index) => {
                  const subLeader = mockMembers.find(m => m.id === subgroup.leaderId) || 
                                   mockPastors.find(p => p.id === subgroup.leaderId);
                  const subgroupMembers = mockMembers.filter(m => subgroup.memberIds.includes(m.id));
                  const subgroupEvents = mockEvents.filter(e => e.groupId === subgroup.id);
                  
                  return (
                    <motion.div
                      key={subgroup.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="bg-white border-2 border-gray-200 rounded-2xl p-6 hover:border-blue-300 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="text-lg font-semibold text-gray-900 mb-1">
                            {displayTitleWords(subgroup.name)}
                          </h4>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium border ${getTypeColor(subgroup.type)}`}>
                            {subgroup.type}
                          </span>
                        </div>
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-4">{subgroup.description}</p>
                      
                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs text-gray-500 mb-1">Members</p>
                          <p className="text-xl font-semibold text-gray-900">{subgroup.memberIds.length}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs text-gray-500 mb-1">Events</p>
                          <p className="text-xl font-semibold text-gray-900">{subgroupEvents.length}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs text-gray-500 mb-1">Avg Rate</p>
                          <p className="text-xl font-semibold text-gray-900">
                            {subgroupMembers.length > 0 
                              ? Math.round(subgroupMembers.reduce((acc, m) => acc + m.attendanceRate, 0) / subgroupMembers.length) 
                              : 0}%
                          </p>
                        </div>
                      </div>

                      {/* Leader */}
                      {subLeader && (
                        <div className="flex items-center space-x-3 p-3 bg-gradient-to-r from-blue-50 to-blue-50 rounded-xl mb-4">
                          <img
                            src={subLeader.profile_image || (subLeader as Member).member_url || ''}
                            alt={`${subLeader.first_name} ${subLeader.last_name}`}
                            className="w-10 h-10 rounded-lg object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500">Leader</p>
                            <p className="text-sm font-medium text-gray-900 truncate">{subLeader.first_name} {subLeader.last_name}</p>
                          </div>
                        </div>
                      )}

                      {/* View Details Button */}
                      <button
                        onClick={() => navigate(`/groups/${subgroup.id}`)}
                        className="w-full flex items-center justify-center px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all"
                      >
                        <ChevronRight className="w-4 h-4 mr-2" />
                        View Full Details
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-2xl">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-2">No subgroups yet.</p>
                <p className="text-xs text-gray-400">Subgroups help organize specialized teams within this ministry.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateEventModal
        isOpen={isCreateEventOpen}
        onClose={() => setIsCreateEventOpen(false)}
        groupId={group.id}
        groupName={group.name}
        onSave={handleCreateEvent}
      />

      {selectedEvent && (
        <EventAttendanceModal
          isOpen={!!selectedEvent}
          onClose={() => setSelectedEvent(undefined)}
          event={selectedEvent}
          groupMembers={members}
        />
      )}

      <CreateSubgroupModal
        isOpen={isCreateSubgroupOpen}
        onClose={() => setIsCreateSubgroupOpen(false)}
        parentGroupId={group.id}
        parentGroupName={group.name}
        onSave={handleCreateSubgroup}
      />

      {/* Public QR Code Modal */}
      {showPublicQRModal && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPublicQRModal(false)}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-2xl shadow-2xl z-[60]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-blue-600">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <QrCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">🌐 Public View QR Code</h3>
                  <p className="text-sm text-white/90">Share group details publicly</p>
                </div>
              </div>
              <button
                onClick={() => setShowPublicQRModal(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-50 rounded-2xl p-6 border border-blue-100">
                <p className="text-sm text-gray-700 mb-4 text-center">
                  Share this QR code or link publicly to let anyone view group details and events
                </p>
                {qrCodePublic && (
                  <div className="bg-white rounded-xl p-6 flex flex-col items-center mb-4">
                    <img src={qrCodePublic} alt="Public View QR Code" className="w-64 h-64 mb-4" />
                    <code className="text-xs text-gray-600 bg-gray-50 px-4 py-3 rounded-lg w-full text-center break-all">
                      {group.publicViewLink}
                    </code>
                  </div>
                )}
                <div className="flex space-x-3">
                  <button
                    onClick={() => downloadQRCode(qrCodePublic, `${group.name}-public-qr.png`)}
                    className="flex-1 flex items-center justify-center px-4 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download QR
                  </button>
                  <button
                    onClick={() => shareLink(group.publicViewLink)}
                    className="flex-1 flex items-center justify-center px-4 py-3 text-sm font-medium text-blue-600 bg-white border-2 border-blue-200 rounded-xl hover:bg-blue-50 transition-all"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Copy Link
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowPublicQRModal(false)}
                className="px-6 py-2.5 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-all shadow-sm font-medium"
              >
                Close
              </button>
            </div>
          </motion.div>
        </>
      )}

      {/* Join QR Code Modal */}
      {showJoinQRModal && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowJoinQRModal(false)}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-2xl shadow-2xl z-[60]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-blue-600">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <QrCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">✅ Member Join QR Code</h3>
                  <p className="text-sm text-white/90">Let members request to join</p>
                </div>
              </div>
              <button
                onClick={() => setShowJoinQRModal(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-50 rounded-2xl p-6 border border-blue-100">
                <p className="text-sm text-gray-700 mb-4 text-center">
                  Share this with existing members to let them request to join the group
                </p>
                {qrCodeJoin && (
                  <div className="bg-white rounded-xl p-6 flex flex-col items-center mb-4">
                    <img src={qrCodeJoin} alt="Member Join QR Code" className="w-64 h-64 mb-4" />
                    <code className="text-xs text-gray-600 bg-gray-50 px-4 py-3 rounded-lg w-full text-center break-all">
                      {group.joinLink}
                    </code>
                  </div>
                )}
                <div className="flex space-x-3">
                  <button
                    onClick={() => downloadQRCode(qrCodeJoin, `${group.name}-join-qr.png`)}
                    className="flex-1 flex items-center justify-center px-4 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download QR
                  </button>
                  <button
                    onClick={() => shareLink(group.joinLink)}
                    className="flex-1 flex items-center justify-center px-4 py-3 text-sm font-medium text-blue-600 bg-white border-2 border-blue-200 rounded-xl hover:bg-blue-50 transition-all"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Copy Link
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowJoinQRModal(false)}
                className="px-6 py-2.5 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-all shadow-sm font-medium"
              >
                Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}