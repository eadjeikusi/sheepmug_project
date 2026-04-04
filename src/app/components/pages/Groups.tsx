import { useState } from 'react';
import { Plus, Users, Link2, ChevronRight, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { mockGroups, mockPastors, mockMembers, type Group } from '../../utils/mockData';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { useBranch } from '../../contexts/BranchContext';

export default function Groups() {
  const navigate = useNavigate();
  const { selectedBranch } = useBranch();
  const [groups] = useState<Group[]>(mockGroups);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  const getLeaderName = (leaderId: string) => {
    const member = mockMembers.find(m => m.id === leaderId);
    if (member) return member.fullName;
    return mockPastors.find(p => p.id === leaderId)?.fullName || 'Unknown';
  };

  const getSubgroups = (parentId: string) => {
    return groups.filter(g => g.parentGroupId === parentId);
  };

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const getGroupTypeColor = (type: Group['type']) => {
    switch (type) {
      case 'youth': return 'bg-orange-50 text-orange-700';
      case 'music': return 'bg-purple-50 text-purple-700';
      case 'ministry': return 'bg-blue-50 text-blue-700';
      default: return 'bg-gray-50 text-gray-700';
    }
  };

  const getGroupIcon = (type: Group['type']) => {
    switch (type) {
      case 'youth': return '🎯';
      case 'music': return '🎵';
      case 'ministry': return '⛪';
      default: return '👥';
    }
  };

  // Filter groups by selected branch
  const filteredGroups = selectedBranch 
    ? groups.filter(g => g.churchId === selectedBranch.id)
    : groups;

  const mainGroups = filteredGroups.filter(g => !g.parentGroupId);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-gray-900 text-[20px]">Groups & Ministries</h1>
          <p className="mt-2 text-gray-500 text-[13px]">Manage ministry groups, music teams, youth groups, and more</p>
          <p className="mt-1 text-sm text-gray-400">
            💡 Looking for family groups? They're in the Members section
          </p>
        </div>
        <button
          onClick={() => toast.info('Add Group modal would open')}
          className="flex items-center px-4 py-2.5 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-sm text-[14px]"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Group
        </button>
      </div>

      {/* Groups Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {mainGroups.map((group, index) => {
          const subgroups = getSubgroups(group.id);
          const hasSubgroups = subgroups.length > 0;
          const isExpanded = expandedGroups.includes(group.id);

          return (
            <motion.div
              key={group.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => navigate(`/groups/${group.id}`)}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all overflow-hidden group cursor-pointer"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-2xl group-hover:bg-blue-100 transition-all">
                    {getGroupIcon(group.type)}
                  </div>
                  <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                    {hasSubgroups && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(group.id);
                        }}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-all"
                      >
                        <ChevronRight
                          className={`w-5 h-5 transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenu(activeMenu === group.id ? null : group.id);
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    
                    {activeMenu === group.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setActiveMenu(null)}
                        />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="absolute right-6 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-20"
                        >
                          <button
                            onClick={() => {
                              toast.info('Edit modal would open');
                              setActiveMenu(null);
                            }}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Edit2 className="w-4 h-4 mr-3" />
                            Edit Group
                          </button>
                          <button
                            onClick={() => {
                              toast.info('Add Subgroup modal would open');
                              setActiveMenu(null);
                            }}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Plus className="w-4 h-4 mr-3" />
                            Add Subgroup
                          </button>
                          <button
                            onClick={() => {
                              toast.error('Delete confirmation would show');
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
                </div>

                <div className="mb-3">
                  <h3 className="font-semibold text-gray-900 mb-1 text-[15px]">{group.name}</h3>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium ${getGroupTypeColor(group.type)}`}>
                    {group.type}
                  </span>
                </div>
                
                <p className="text-gray-600 mb-4 line-clamp-2 text-[14px]">{group.description}</p>
                
                {/* Stats */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center text-gray-600 text-[14px]">
                    <Users className="w-4 h-4 mr-2 text-gray-400" />
                    {group.memberIds.length} Members
                  </div>
                  <div className="flex items-center text-gray-600">
                    <div className="w-4 h-4 mr-2" />
                    <span className="text-gray-500 text-[14px]">Leader:</span>
                    <span className="ml-1 font-medium text-gray-900 text-[14px]">{getLeaderName(group.leaderId)}</span>
                  </div>
                </div>

                {/* Join Link */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(group.joinLink);
                    toast.success('Join link copied!');
                  }}
                  className="flex items-center w-full px-3 py-2 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-all"
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  Copy Join Link
                </button>
              </div>

              {/* Subgroups */}
              {hasSubgroups && isExpanded && (
                <div className="bg-gray-50 border-t border-gray-100 p-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Subgroups</h4>
                  <div className="space-y-2">
                    {subgroups.map((subgroup) => (
                      <div
                        key={subgroup.id}
                        className="bg-white rounded-lg p-3 border border-gray-200"
                      >
                        <h5 className="font-medium text-gray-900 text-sm">{subgroup.name}</h5>
                        <p className="text-sm text-gray-500 mt-1">{subgroup.memberIds.length} Members</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}