import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, useEffect } from 'react';
import type { Family, Member } from '../../utils/mockData';
import { toast } from 'sonner';

interface FamilyGroupDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  familyGroup: Family;
  members: Member[];
  onUpdateFamilyName: (id: string, name: string) => void;
  onInitiateRemoveMember: (member: Member, familyId: string) => void;
  onInitiateDeleteFamily: (family: Family) => void;
}

export default function FamilyGroupDetailModal({ isOpen, onClose, familyGroup, members, onUpdateFamilyName, onInitiateRemoveMember, onInitiateDeleteFamily }: FamilyGroupDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [familyName, setFamilyName] = useState(familyGroup?.familyName || '');

  useEffect(() => {
    setFamilyName(familyGroup?.familyName || '');
  }, [familyGroup?.familyName]);

  if (!isOpen || !familyGroup) return null;

  const handleSaveName = () => {
    onUpdateFamilyName(familyGroup.id, familyName);
    setIsEditing(false);
  };

  const headOfHousehold = members.find(m => m.id === familyGroup.headOfHousehold);

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
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-8 border-b border-gray-100">
          <div className="flex items-start space-x-4">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-3xl">
              🏠
            </div>
            <div>
              {isEditing ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    className="text-2xl font-semibold text-gray-900 border-b border-blue-500 focus:outline-none"
                  />
                  <button onClick={handleSaveName} className="text-sm text-blue-600 hover:text-blue-800">Save</button>
                  <button onClick={() => { setFamilyName(familyGroup.familyName); setIsEditing(false); }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <h2 className="text-2xl font-semibold text-gray-900">{familyGroup.familyName}</h2>
                  <button onClick={() => { setFamilyName(familyGroup.familyName); setIsEditing(true); }} className="text-sm text-gray-500 hover:text-blue-600">Edit</button>
                </div>
              )}
              <p className="text-sm text-gray-500 mt-1">{members.length} family members</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto max-h-[calc(90vh-180px)]">
          {/* Family Info */}
          <div className="mb-8" />

          {/* Head of Household */}
          {headOfHousehold && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 mb-3">
                Head of Household
              </h3>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                <div className="flex items-center space-x-4">
                  <img
                    src={headOfHousehold.profileImage}
                    alt={headOfHousehold.fullName}
                    className="w-16 h-16 rounded-xl object-cover"
                  />
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{headOfHousehold.fullName}</h4>
                    <p className="text-sm text-gray-600 mt-1">{headOfHousehold.email}</p>
                    <p className="text-sm text-gray-600">{headOfHousehold.phoneNumber}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-semibold text-blue-600">N/A</p>
                    <p className="text-sm text-gray-500 mt-1">Attendance</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Family Members */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              Family Members
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-semibold text-gray-900">{member.fullName}</h4>
                      </div>
                      <p className="text-sm text-gray-500 mb-2">{member.email}</p>
                      
                      {/* Stats */}
                      <div className="flex items-center space-x-4 mt-3">
                        <div>
                          <p className="text-sm text-gray-500">Attendance</p>
                          <p className="text-sm font-semibold text-gray-900">N/A</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Status</p>
                          <p className="text-sm font-semibold text-gray-900">Active</p>
                        </div>
                      </div>

                      {/* Contact Actions */}
                      <div className="flex items-center space-x-2 mt-3">
                        <button className="flex-1 flex items-center justify-center px-2 py-1.5 text-sm text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all">
                          Email
                        </button>
                        <button 
                          onClick={() => onInitiateRemoveMember(member, familyGroup.id)}
                          className="flex-1 flex items-center justify-center px-2 py-1.5 text-sm text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-all"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between px-8 pb-8 pt-6 border-t border-gray-100">
          <button
            onClick={() => onInitiateDeleteFamily(familyGroup)}
            className="px-6 py-3 text-red-600 bg-red-50 rounded-xl hover:bg-red-100 transition-all font-medium"
          >
            Delete Family
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}