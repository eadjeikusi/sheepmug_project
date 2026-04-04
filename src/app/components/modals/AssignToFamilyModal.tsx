import { useState } from 'react';
import { X, Home, Search, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Member, FamilyGroup } from '../../utils/mockData';

interface AssignToFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  familyGroups: FamilyGroup[];
  selectedMembers: Set<string>;
  onAssign: (familyIds: string[]) => void;
}

export default function AssignToFamilyModal({
  isOpen,
  onClose,
  members,
  familyGroups,
  selectedMembers,
  onAssign,
}: AssignToFamilyModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const selectedMembersList = members.filter(m => selectedMembers.has(m.id));
  
  const filteredFamilies = familyGroups.filter(family =>
    (family.familyName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (family.address?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const toggleFamilySelection = (familyId: string) => {
    const newSelectedFamilies = new Set(selectedFamilies);
    if (newSelectedFamilies.has(familyId)) {
      newSelectedFamilies.delete(familyId);
    } else {
      newSelectedFamilies.add(familyId);
    }
    setSelectedFamilies(newSelectedFamilies);
  };

  const handleAssign = async () => {
    setStatusMessage('Assign button clicked...');
    if (selectedFamilies.size > 0) {
      setIsLoading(true);
      setStatusMessage('Calling onAssign...');
      await onAssign(Array.from(selectedFamilies));
      setStatusMessage('onAssign completed.');
      setIsLoading(false);
      setSelectedFamilies(new Set());
      setSearchQuery('');
    } else {
      setStatusMessage('No families selected.');
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
                  <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                    <Home className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-gray-900">Assign to Family Group</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Select a family group for {selectedMembers.size} member{selectedMembers.size !== 1 ? 's' : ''}
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

              {/* Content Area */}
              <div className="flex flex-col md:flex-row h-[60vh]">
                {/* Left: Selected Members */}
                <div className="w-full md:w-1/3 border-r border-gray-100 bg-gray-50 p-6 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-900 mb-4">Selected Members ({selectedMembers.size})</p>
                  <div className="space-y-2">
                    {selectedMembersList.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center space-x-3 p-2 bg-white rounded-lg border border-gray-200"
                      >
                        <img
                          src={member.profileImage || '/default-avatar.png'}
                          alt={member.fullName || 'Member'}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                        <span className="text-sm font-medium text-gray-900 truncate">{member.fullName || 'Unknown Member'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Family Groups */}
                <div className="w-full md:w-2/3 flex flex-col h-full">
                  {/* Search */}
                  <div className="p-4 border-b border-gray-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search family groups..."
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Family Groups List */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {filteredFamilies.map((family) => {
                      const familyMembers = members.filter(m => m.familyIds?.includes(family.id));
                      const isSelected = selectedFamilies.has(family.id);
                      
                      return (
                        <button
                          key={family.id}
                          onClick={() => toggleFamilySelection(family.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-lg">
                              🏠
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm text-gray-900">{family.familyName}</h3>
                              <p className="text-xs text-gray-500">{familyMembers.length} members</p>
                            </div>
                          </div>

                          {isSelected && (
                            <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}

                    {filteredFamilies.length === 0 && (
                      <div className="text-center py-8 text-sm text-gray-500">No family groups found</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end space-x-3 px-8 py-4 border-t border-gray-100 bg-gray-50">
                {statusMessage && <p className="text-sm text-indigo-600">{statusMessage}</p>}
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={selectedFamilies.size === 0 || isLoading}
                  className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Assigning...</span>
                    </>
                  ) : (
                    <span>Assign to Family</span>
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