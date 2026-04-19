import { X, Users, Calendar, Plus, QrCode, User, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { Group, Member, Pastor, Event } from '../../utils/mockData';
import { mockMembers, mockPastors, mockEvents, mockGroups } from '../../utils/mockData';
import CreateEventModal from './CreateEventModal';
import EventAttendanceModal from './EventAttendanceModal';
import { toast } from 'sonner';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';

interface GroupDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: Group;
}

export default function GroupDetailModal({ isOpen, onClose, group }: GroupDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'events'>('overview');
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | undefined>();

  if (!isOpen) return null;

  const members = mockMembers.filter(m => group.memberIds.includes(m.id));
  const leader = mockMembers.find(m => m.id === group.leaderId) || mockPastors.find(p => p.id === group.leaderId);
  const groupEvents = mockEvents.filter(e => e.groupId === group.id);
  const subgroups = mockGroups.filter(g => g.parentGroupId === group.id);
  const parentGroup = group.parentGroupId ? mockGroups.find(g => g.id === group.parentGroupId) : null;

  const handleCreateEvent = (eventData: any) => {
    toast.success(`Event "${eventData.title}" created for ${group.name}!`);
    setIsCreateEventOpen(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-8 border-b border-gray-100">
          <div className="flex items-start space-x-4 flex-1">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
              <Users className="w-8 h-8 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <h2 className="text-2xl font-semibold text-gray-900">{group.name}</h2>
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
              <p className="text-sm text-gray-500 mb-3">{group.description}</p>
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
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all ml-4"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center space-x-1 px-8 pt-6 border-b border-gray-100">
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
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Leader Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">
                  Group Leader
                </h3>
                {leader && (
                  <div className="bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-100 rounded-2xl p-6">
                    <div className="flex items-center space-x-4">
                      <img
                        src={leader.profileImage}
                        alt={leader.fullName}
                        className="w-16 h-16 rounded-xl object-cover"
                      />
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900">{leader.fullName}</h4>
                        <p className="text-sm text-gray-600 mt-1">{leader.email}</p>
                        <p className="text-sm text-gray-600">{leader.phoneNumber}</p>
                      </div>
                      <div className="text-center">
                        <User className="w-8 h-8 text-blue-600 mx-auto mb-1" />
                        <p className="text-sm text-gray-500">Leader</p>
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
                        <div key={subgroup.id} className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-blue-200 hover:shadow-sm transition-all">
                          <div className="flex items-start justify-between mb-2">
                            <h4 className="font-semibold text-gray-900">{subgroup.name}</h4>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${getTypeColor(subgroup.type)}`}>
                              {subgroup.type}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mb-3">{subgroup.description}</p>
                          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                            <div className="flex items-center space-x-2 text-sm text-gray-500">
                              <Users className="w-4 h-4" />
                              <span>{subgroup.memberIds.length} members</span>
                            </div>
                            {subLeader && (
                              <div className="flex items-center space-x-2">
                                <img
                                  src={subLeader.profileImage}
                                  alt={subLeader.fullName}
                                  className="w-6 h-6 rounded-full object-cover"
                                />
                                <span className="text-sm text-gray-600">{subLeader.fullName}</span>
                              </div>
                            )}
                          </div>
                        </div>
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

              {/* Join Link */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">
                  Join Link
                </h3>
                <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between">
                  <code className="text-sm text-gray-700">{group.joinLink}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(group.joinLink);
                      toast.success('Link copied to clipboard!');
                    }}
                    className="px-4 py-2 text-sm text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-all"
                  >
                    Copy Link
                  </button>
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
                      src={member.profileImage}
                      alt={member.fullName}
                      className="w-14 h-14 rounded-xl object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900">{member.fullName}</h4>
                      <p className="text-sm text-gray-500 mb-2">{member.email}</p>
                      
                      {/* Stats */}
                      <div className="flex items-center space-x-3 mt-3">
                        <div>
                          <p className="text-sm text-gray-500">Attendance</p>
                          <p className="text-sm font-semibold text-gray-900">{member.attendanceRate}%</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Groups</p>
                          <p className="text-sm font-semibold text-gray-900">{member.groupIds.length}</p>
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
              {/* Create Event Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setIsCreateEventOpen(true)}
                  className="flex items-center px-4 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Event
                </button>
              </div>

              {/* Events List */}
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
                            <p className="text-sm text-blue-600">Attended</p>
                          </div>
                          <button
                            onClick={() => setSelectedEvent(event)}
                            className="flex items-center px-3 py-1.5 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-all"
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
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 px-8 pb-8 pt-6 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
          >
            Close
          </button>
        </div>
      </motion.div>

      {/* Create Event Modal */}
      <CreateEventModal
        isOpen={isCreateEventOpen}
        onClose={() => setIsCreateEventOpen(false)}
        groupId={group.id}
        groupName={group.name}
        onSave={handleCreateEvent}
      />

      {/* Event Attendance Modal */}
      {selectedEvent && (
        <EventAttendanceModal
          isOpen={!!selectedEvent}
          onClose={() => setSelectedEvent(undefined)}
          event={selectedEvent}
          groupMembers={members}
        />
      )}
    </div>
  );
}