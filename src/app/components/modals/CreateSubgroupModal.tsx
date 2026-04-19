import { useState } from 'react';
import { X, Users, FileText, User, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { mockMembers, mockPastors, mockGroups } from '../../utils/mockData';

interface CreateSubgroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentGroupId: string;
  parentGroupName: string;
  onSave: (subgroupData: any) => void;
}

export default function CreateSubgroupModal({
  isOpen,
  onClose,
  parentGroupId,
  parentGroupName,
  onSave,
}: CreateSubgroupModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'ministry' as 'ministry' | 'music' | 'youth' | 'other',
    description: '',
    leaderId: '',
    tag: '',
  });

  const [tagError, setTagError] = useState('');

  const allLeaders = [...mockMembers, ...mockPastors];

  const checkTagUnique = (tag: string) => {
    if (!tag) {
      setTagError('');
      return true;
    }
    const tagExists = mockGroups.some(g => g.tag.toLowerCase() === tag.toLowerCase());
    if (tagExists) {
      setTagError('⚠️ This tag is already used by another group. Please choose a unique tag.');
      return false;
    }
    setTagError('');
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newSubgroup = {
      id: `sub-${Date.now()}`,
      name: formData.name,
      type: formData.type,
      description: formData.description,
      leaderId: formData.leaderId,
      memberIds: formData.leaderId ? [formData.leaderId] : [],
      parentGroupId: parentGroupId,
      churchId: '1',
      joinLink: `https://church.example.com/join/${formData.name.toLowerCase().replace(/\s+/g, '-')}`,
      publicViewLink: `https://church.example.com/groups/${formData.name.toLowerCase().replace(/\s+/g, '-')}`,
      qrCodePublic: '',
      qrCodeJoin: '',
      tag: formData.tag,
    };

    onSave(newSubgroup);
    handleClose();
  };

  const handleClose = () => {
    setFormData({
      name: '',
      type: 'ministry',
      description: '',
      leaderId: '',
      tag: '',
    });
    onClose();
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
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100">
                  <div>
                    <h2 className="text-2xl font-semibold text-gray-900">Create Subgroup</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Add a new subgroup to <strong>{parentGroupName}</strong>
                    </p>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="px-8 py-6 space-y-6">
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Users className="w-4 h-4 inline mr-2" />
                      Subgroup Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Vocal Team, Prayer Warriors, etc."
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Group Type *
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      {['ministry', 'music', 'youth', 'other'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormData({ ...formData, type: type as any })}
                          className={`px-4 py-3 rounded-xl border-2 transition-all ${
                            formData.type === type
                              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <FileText className="w-4 h-4 inline mr-2" />
                      Description *
                    </label>
                    <textarea
                      required
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Describe the purpose and activities of this subgroup..."
                      rows={4}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                    />
                  </div>

                  {/* Leader */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <User className="w-4 h-4 inline mr-2" />
                      Subgroup Leader *
                    </label>
                    <select
                      required
                      value={formData.leaderId}
                      onChange={(e) => setFormData({ ...formData, leaderId: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    >
                      <option value="">Select a leader...</option>
                      <optgroup label="Pastors">
                        {mockPastors.map((pastor) => (
                          <option key={pastor.id} value={pastor.id}>
                            {pastor.fullName}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Members">
                        {mockMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.fullName} ({member.email})
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  {/* Selected Leader Preview */}
                  {formData.leaderId && (() => {
                    const selectedLeader = allLeaders.find(l => l.id === formData.leaderId);
                    return selectedLeader ? (
                      <div className="bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-100 rounded-2xl p-4">
                        <p className="text-sm font-medium text-gray-500 mb-2">
                          Selected Leader
                        </p>
                        <div className="flex items-center space-x-3">
                          <img
                            src={selectedLeader.profileImage}
                            alt={selectedLeader.fullName}
                            className="w-12 h-12 rounded-xl object-cover"
                          />
                          <div>
                            <p className="font-semibold text-gray-900">{selectedLeader.fullName}</p>
                            <p className="text-sm text-gray-600">{selectedLeader.email}</p>
                          </div>
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Tag */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Tag className="w-4 h-4 inline mr-2" />
                      Tag (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.tag}
                      onChange={(e) => {
                        const tag = e.target.value;
                        setFormData({ ...formData, tag });
                        checkTagUnique(tag);
                      }}
                      placeholder="e.g., vocal-team, prayer-warriors, etc."
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                    {tagError && <p className="text-sm text-red-500 mt-1">{tagError}</p>}
                  </div>

                  {/* Info Box */}
                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                    <p className="text-sm text-blue-900">
                      💡 <strong>Tip:</strong> The subgroup will inherit the church from {parentGroupName}. 
                      Members can join via QR codes or join requests that you'll review.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="px-6 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm"
                    >
                      Create Subgroup
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}