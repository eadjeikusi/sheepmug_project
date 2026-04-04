import { useState, useRef } from 'react';
import { X, Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { Member } from '../../utils/mockData';
import imageCompression from 'browser-image-compression';
import { toast } from 'sonner';

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member?: Member;
  onSave: (member: Partial<Member>) => void;
}

export default function MemberModal({ isOpen, onClose, member, onSave }: MemberModalProps) {
  const [formData, setFormData] = useState({
    first_name: member?.first_name || '',
    last_name: member?.last_name || '',
    phone: member?.phone || member?.phoneNumber || '',
    email: member?.email || '',
    address: member?.address || member?.location || '',
    emergency_contact_name: member?.emergency_contact_name || '',
    emergency_contact_phone: member?.emergency_contact_phone || member?.emergencyContact || '',
    member_url: member?.member_url || member?.profileImage || '',
    dob: member?.dob || '',
    gender: member?.gender || '',
    marital_status: member?.marital_status || '',
    occupation: member?.occupation || '',
    member_id_string: member?.member_id_string || '',
    status: member?.status || 'active',
    date_joined: member?.date_joined || new Date().toISOString().split('T')[0],
  });
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    setIsCompressing(true);
    try {
      const options = {
        maxSizeMB: 0.05, // Max 50KB for even smaller size
        maxWidthOrHeight: 600,
        useWebWorker: true,
      };

      const compressedFile = await imageCompression(file, options);
      
      if (compressedFile.size > 1024 * 1024) { // 1MB limit check
        toast.error('Image is still too large. Please use a smaller image.');
        setIsCompressing(false);
        return;
      }

      // Upload to server
      const formData = new FormData();
      formData.append('image', compressedFile);
      
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error('Failed to upload image');
      
      const { url } = await response.json();
      setFormData(prev => ({ ...prev, member_url: url }));
      setIsCompressing(false);
      toast.success('Image uploaded successfully');
    } catch (error) {
      setIsCompressing(false);
      toast.error('Failed to optimize image');
    }
  };

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
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-8 border-b border-gray-100">
          <h2 className="text-2xl font-semibold text-gray-900">
            {member ? 'Edit Member' : 'Add New Member'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form id="member-form" onSubmit={handleSubmit} className="p-8 overflow-y-auto flex-1">
          <div className="space-y-6">
            {/* Image Upload Section */}
            <div className="flex flex-col items-center justify-center mb-6">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="relative w-32 h-32 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all overflow-hidden group"
              >
                {formData.member_url ? (
                  <>
                    <img src={formData.member_url} alt="Profile" className="w-full h-full object-cover pointer-events-none" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity">
                      <Upload className="w-8 h-8 text-white mb-1" />
                      <span className="text-white text-xs font-medium">Change Photo</span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    {isCompressing ? (
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    ) : (
                      <>
                        <ImageIcon className="w-8 h-8 mb-2" />
                        <span className="text-xs font-medium">Upload Photo</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                className="hidden" 
                accept="image/*"
              />
              <p className="mt-2 text-xs text-gray-500">Optimized for low bandwidth</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={formData.dob}
                  onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender
                </label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Marital Status
                </label>
                <select
                  value={formData.marital_status}
                  onChange={(e) => setFormData({ ...formData, marital_status: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                >
                  <option value="">Select Status</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Occupation
                </label>
                <input
                  type="text"
                  value={formData.occupation}
                  onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Emergency Contact Name
                </label>
                <input
                  type="text"
                  value={formData.emergency_contact_name}
                  onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Emergency Contact Phone
                </label>
                <input
                  type="tel"
                  value={formData.emergency_contact_phone}
                  onChange={(e) => setFormData({ ...formData, emergency_contact_phone: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Member ID String
                </label>
                <input
                  type="text"
                  value={formData.member_id_string}
                  onChange={(e) => setFormData({ ...formData, member_id_string: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                  placeholder="e.g. MEM-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Joined
                </label>
                <input
                  type="date"
                  value={formData.date_joined}
                  onChange={(e) => setFormData({ ...formData, date_joined: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Actions */}
        <div className="flex justify-end space-x-3 px-8 pb-8 pt-6 border-t border-gray-100 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all font-medium"
          >
            Cancel
          </button>
          <button
            form="member-form"
            type="submit"
            disabled={isCompressing}
            className="px-6 py-3 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isCompressing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {member ? 'Save Changes' : 'Add Member'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
