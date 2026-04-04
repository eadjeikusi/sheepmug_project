import { useState } from 'react';
import { X, Users, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Member } from '../../utils/mockData';
import { mockGroups } from '../../utils/mockData';

interface AssignMinistryModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  selectedMembers: Set<string>;
  onAssign: (ministryIds: string[]) => Promise<void>;
}

export default function AssignMinistryModal({
  isOpen,
  onClose,
  members,
  selectedMembers,
  onAssign,
}: AssignMinistryModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMinistries, setSelectedMinistries] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const selectedMembersList = members.filter(m => selectedMembers.has(m.id));
  
  const filteredMinistries = mockGroups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleMinistry = (ministryId: string) => {
    const newSelection = new Set(selectedMinistries);
    if (newSelection.has(ministryId)) {
      newSelection.delete(ministryId);
    } else {
      newSelection.add(ministryId);
    }
    setSelectedMinistries(newSelection);
  };

  const handleAssign = async () => {
    if (selectedMinistries.size > 0) {
      setIsLoading(true);
      await onAssign(Array.from(selectedMinistries));
      setIsLoading(false);
      setSelectedMinistries(new Set());
      setSearchQuery('');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-gray-900">Assign to Ministry</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Select a ministry for {selectedMembers.size} member{selectedMembers.size !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Selected Members Preview */}
              <div className="px-8 py-4 bg-purple-50 border-b border-purple-100">
                <p className="text-sm font-medium text-purple-900 mb-3">Selected Members:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedMembersList.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-white rounded-lg border border-purple-200"
                    >
                      <img
                        src={member.profileImage}
                        alt={member.fullName}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                      <span className="text-sm font-medium text-gray-900">{member.fullName}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Search */}
              <div className="px-8 py-4 border-b border-gray-100">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search ministries..."
                    className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Ministries List */}
              <div className="px-8 py-4 max-h-96 overflow-y-auto">
                <div className="space-y-2">
                  {filteredMinistries.map((ministry) => {
                    const ministryMembers = members.filter(m => m.groupIds?.includes(ministry.id));
                    
                    return (
                      <button
                        key={ministry.id}
                        onClick={() => toggleMinistry(ministry.id)}
                        className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left ${
                          selectedMinistries.has(ministry.id)
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
                            <span className="text-sm font-semibold text-orange-600 border border-orange-200 px-2 py-0.5 rounded">
                              {ministry.tag}
                            </span>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{ministry.name}</h3>
                            <p className="text-sm text-gray-500">{ministry.description}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {ministryMembers.length} current member{ministryMembers.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        {selectedMinistries.has(ministry.id) && (
                          <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {filteredMinistries.length === 0 && (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Users className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500">No ministries found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end space-x-3 px-8 py-6 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={selectedMinistries.size === 0 || isLoading}
                  className="px-6 py-2.5 text-white bg-purple-600 rounded-xl hover:bg-purple-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Assigning...</span>
                    </>
                  ) : (
                    <span>Assign to Ministry</span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
