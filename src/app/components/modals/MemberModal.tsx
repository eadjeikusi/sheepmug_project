import { useState, useRef, useMemo, useEffect } from 'react';
import { X, Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { Member } from '../../utils/mockData';
import {
  compressImageForUpload,
  MAX_STORED_IMAGE_BYTES,
  MEMBER_PROFILE_PHOTO_OPTIONS,
} from '../../utils/compressImageForUpload';
import { toast } from 'sonner';
import { useMemberStatusOptions } from '../../hooks/useMemberStatusOptions';
import { useCustomFieldDefinitions } from '../../hooks/useCustomFieldDefinitions';
import CustomFieldsSection from '../CustomFieldsSection';
import PhoneCountryInput from '../PhoneCountryInput';
import { DatePickerField } from '@/components/datetime';
import { e164ToCountryAndNational } from '@/lib/phoneE164';

const DEFAULT_PHONE_REGION = 'US';

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member?: Member;
  onSave: (member: Partial<Member>) => void;
}

export default function MemberModal({ isOpen, onClose, member, onSave }: MemberModalProps) {
  const { options: memberStatusPicklist } = useMemberStatusOptions(isOpen);
  const { definitions: memberCustomFieldDefs } = useCustomFieldDefinitions('member', isOpen);
  const sortedStatusLabels = useMemo(
    () =>
      [...memberStatusPicklist].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [memberStatusPicklist],
  );

  const dobMaxDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const [formData, setFormData] = useState({
    first_name: member?.first_name || '',
    last_name: member?.last_name || '',
    phone_country_iso: DEFAULT_PHONE_REGION,
    phone_national: '',
    email: member?.email || '',
    address: member?.address || member?.location || '',
    emergency_contact_name: member?.emergency_contact_name || '',
    emergency_contact_phone_country_iso: DEFAULT_PHONE_REGION,
    emergency_contact_phone_national: '',
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
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!isOpen) return;
    const raw = member?.custom_fields;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      setCustomFieldValues({ ...(raw as Record<string, unknown>) });
    } else {
      setCustomFieldValues({});
    }
  }, [isOpen, member]);

  useEffect(() => {
    if (!isOpen) return;
    const m = member;
    const p = e164ToCountryAndNational(
      m?.phone || m?.phoneNumber || '',
      (m as Member & { phone_country_iso?: string })?.phone_country_iso || DEFAULT_PHONE_REGION,
    );
    const e = e164ToCountryAndNational(
      m?.emergency_contact_phone || m?.emergencyContact || '',
      (m as Member & { emergency_contact_phone_country_iso?: string })?.emergency_contact_phone_country_iso ||
        DEFAULT_PHONE_REGION,
    );
    setFormData({
      first_name: m?.first_name || '',
      last_name: m?.last_name || '',
      phone_country_iso: p.countryIso,
      phone_national: p.national,
      email: m?.email || '',
      address: m?.address || m?.location || '',
      emergency_contact_name: m?.emergency_contact_name || '',
      emergency_contact_phone_country_iso: e.countryIso,
      emergency_contact_phone_national: e.national,
      member_url: m?.member_url || m?.profileImage || '',
      dob: m?.dob || '',
      gender: m?.gender || '',
      marital_status: m?.marital_status || '',
      occupation: m?.occupation || '',
      member_id_string: m?.member_id_string || '',
      status: m?.status || 'active',
      date_joined: m?.date_joined || new Date().toISOString().split('T')[0],
    });
  }, [isOpen, member]);

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
      const compressedFile = await compressImageForUpload(file, MEMBER_PROFILE_PHOTO_OPTIONS);

      if (compressedFile.size > MAX_STORED_IMAGE_BYTES) {
        toast.error('Image is still too large after optimization. Try a simpler photo.');
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
    onSave({
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email,
      address: formData.address,
      phone: formData.phone_national,
      phone_country_iso: formData.phone_country_iso,
      emergency_contact_name: formData.emergency_contact_name,
      emergency_contact_phone: formData.emergency_contact_phone_national,
      emergency_contact_phone_country_iso: formData.emergency_contact_phone_country_iso,
      member_url: formData.member_url,
      dob: formData.dob,
      gender: formData.gender,
      marital_status: formData.marital_status,
      occupation: formData.occupation,
      member_id_string: formData.member_id_string,
      status: formData.status,
      date_joined: formData.date_joined,
      custom_fields: customFieldValues,
    });
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
                className="relative w-32 h-32 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all overflow-hidden group"
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
                      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
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
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
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
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <PhoneCountryInput
                label="Phone number"
                countryIso={formData.phone_country_iso}
                onCountryChange={(iso) => setFormData((f) => ({ ...f, phone_country_iso: iso }))}
                national={formData.phone_national}
                onNationalChange={(v) => setFormData((f) => ({ ...f, phone_national: v }))}
                required
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth
                </label>
                <DatePickerField
                  value={formData.dob}
                  onChange={(v) => setFormData({ ...formData, dob: v })}
                  placeholder="Date of birth"
                  maxDate={dobMaxDate}
                  triggerClassName="h-auto min-h-[48px] rounded-xl border-transparent bg-gray-50 px-4 py-3 text-gray-900 shadow-none focus-visible:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender
                </label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
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
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
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
                  Membership status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  disabled={sortedStatusLabels.length === 0}
                >
                  {sortedStatusLabels.length === 0 ? (
                    <option value={formData.status || 'active'}>
                      {formData.status || 'active'} (add statuses in Settings)
                    </option>
                  ) : (
                    <>
                      {sortedStatusLabels.every((o) => o.label !== formData.status) && formData.status ? (
                        <option value={formData.status}>{formData.status} (current)</option>
                      ) : null}
                      {sortedStatusLabels.map((o) => (
                        <option key={o.id} value={o.label}>
                          {o.label}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {sortedStatusLabels.length === 0 && (
                  <p className="text-xs text-amber-700 mt-1">Open Settings → Member statuses and load or add labels.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Occupation
                </label>
                <input
                  type="text"
                  value={formData.occupation}
                  onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
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
                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
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
                  className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
              <PhoneCountryInput
                label="Emergency contact phone"
                countryIso={formData.emergency_contact_phone_country_iso}
                onCountryChange={(iso) =>
                  setFormData((f) => ({ ...f, emergency_contact_phone_country_iso: iso }))
                }
                national={formData.emergency_contact_phone_national}
                onNationalChange={(v) =>
                  setFormData((f) => ({ ...f, emergency_contact_phone_national: v }))
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Joined
                </label>
                <DatePickerField
                  value={formData.date_joined}
                  onChange={(v) => setFormData({ ...formData, date_joined: v })}
                  placeholder="Date joined"
                  triggerClassName="h-auto min-h-[48px] rounded-xl border-transparent bg-gray-50 px-4 py-3 text-gray-900 shadow-none focus-visible:ring-blue-500"
                />
              </div>
            </div>

            {memberCustomFieldDefs.length > 0 ? (
              <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Additional fields</h3>
                <CustomFieldsSection
                  definitions={memberCustomFieldDefs}
                  values={customFieldValues}
                  onChange={(key, value) =>
                    setCustomFieldValues((prev) => ({ ...prev, [key]: value }))
                  }
                />
              </div>
            ) : null}
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
            className="px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isCompressing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {member ? 'Save Changes' : 'Add Member'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
