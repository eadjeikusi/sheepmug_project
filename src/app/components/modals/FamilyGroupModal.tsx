import { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { FamilyGroup } from '../../utils/mockData';

interface FamilyGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  familyGroup?: FamilyGroup;
  onSave: (familyGroup: Partial<FamilyGroup>) => void;
}

export default function FamilyGroupModal({ isOpen, onClose, familyGroup, onSave }: FamilyGroupModalProps) {
  const [formData, setFormData] = useState({
    familyName: familyGroup?.familyName || '',
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
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
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-8 border-b border-gray-100">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">
              {familyGroup ? 'Edit Family Group' : 'Add New Family Group'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">Create a family unit for members living together</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-8 overflow-y-auto max-h-[calc(90vh-180px)]">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Family Name
              </label>
              <input
                type="text"
                value={formData.familyName}
                onChange={(e) => setFormData({ ...formData, familyName: e.target.value })}
                placeholder="e.g., Johnson Family"
                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                required
              />
            </div>

            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-sm text-blue-900">
                <span className="font-medium">Tip:</span> After creating the family group, you can assign members to it by editing each member's profile.
              </p>
            </div>
          </div>
        </form>

        {/* Actions */}
        <div className="flex justify-end space-x-3 px-8 pb-8 pt-6 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
          >
            {familyGroup ? 'Save Changes' : 'Create Family Group'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
