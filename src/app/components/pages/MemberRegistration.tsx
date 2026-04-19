import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Upload, User, MapPin, AlertCircle, Calendar, Mail, Check, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { compressImageForUpload, MEMBER_PROFILE_PHOTO_OPTIONS } from '../../utils/compressImageForUpload';
import PhoneCountryInput from '../PhoneCountryInput';
import { DatePickerField } from '@/components/datetime';

const DEFAULT_PHONE_REGION = 'US';

export default function MemberRegistration() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [photoOptimizing, setPhotoOptimizing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const dobMaxDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phoneNational: '',
    phoneCountryIso: DEFAULT_PHONE_REGION,
    location: '',
    emergencyContactName: '',
    emergencyContactNational: '',
    emergencyContactCountryIso: DEFAULT_PHONE_REGION,
    dateOfBirth: '',
    gender: '',
    maritalStatus: '',
    occupation: '',
    dateJoined: new Date().toISOString().split('T')[0],
    profileImage: null as File | null,
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setPhotoOptimizing(true);
    try {
      const optimized = await compressImageForUpload(file, MEMBER_PROFILE_PHOTO_OPTIONS);
      setFormData((prev) => ({ ...prev, profileImage: optimized }));
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(optimized);
    } catch {
      toast.error('Could not process that image. Try another photo.');
    } finally {
      setPhotoOptimizing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || submitLockRef.current) return;
    submitLockRef.current = true;

    if (!code) {
      toast.error('Invalid registration link. Please contact your church admin.');
      submitLockRef.current = false;
      return;
    }

    if (!formData.profileImage) {
      toast.error('Please upload a profile photo.');
      submitLockRef.current = false;
      return;
    }

    // Validate required fields (avoid native HTML5 on hidden file input — it blocks submit with no visible hint)
    if (
      !formData.firstName?.trim() ||
      !formData.lastName?.trim() ||
      !formData.phoneNational.trim() ||
      !formData.location?.trim() ||
      !formData.emergencyContactName?.trim() ||
      !formData.emergencyContactNational.trim()
    ) {
      toast.error('Please fill in all required fields.');
      submitLockRef.current = false;
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Upload image (already optimized when selected; aspect ratio preserved)
      const imageFormData = new FormData();
      imageFormData.append('image', formData.profileImage);
      
      const uploadResponse = await fetch('/api/upload-image', {
        method: 'POST',
        body: imageFormData
      });
      
      if (!uploadResponse.ok) throw new Error('Failed to upload image');
      const { url: imageUrl } = await uploadResponse.json();

      // 2. Submit form with image URL
      const registrationData = {
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        phone: formData.phoneNational.trim(),
        phone_country_iso: formData.phoneCountryIso,
        location: formData.location,
        emergency_contact_name: formData.emergencyContactName,
        emergency_contact_phone: formData.emergencyContactNational.trim(),
        emergency_contact_phone_country_iso: formData.emergencyContactCountryIso,
        dob: formData.dateOfBirth,
        gender: formData.gender,
        marital_status: formData.maritalStatus,
        occupation: formData.occupation,
        date_joined: formData.dateJoined,
        member_url: imageUrl
      };
      
      // 3. Submit request to backend (stored in member_requests)
      const submitResponse = await fetch(`/api/member-requests/public/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData)
      });

      const submitResult = await submitResponse.json().catch(() => ({}));
      if (!submitResponse.ok) {
        throw new Error(submitResult.error || 'Failed to submit registration request');
      }
      
      setIsSubmitted(true);
      toast.success('Registration submitted successfully!');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to submit registration';
      toast.error(msg);
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-2xl p-8 max-w-lg w-full text-center"
        >
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-3">
            Registration Complete!
          </h1>
          <p className="text-gray-600 mb-6">
            Thank you for registering. A church leader will review your information and contact you shortly.
          </p>
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-6">
            <p className="text-sm text-blue-900">
              📧 You'll receive a confirmation email at <strong>{formData.email || 'your email'}</strong> once your registration is approved.
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all"
          >
            Return to Home
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-600 px-8 py-8 text-white">
            <h1 className="text-3xl font-semibold mb-2">New Member Registration</h1>
            <p className="text-blue-100">
              Welcome! Please fill out the form below to join our church community.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="px-8 py-8 space-y-6">
            {/* Profile Image Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                <Upload className="w-4 h-4 inline mr-2" />
                Profile Photo *
              </label>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <div className="w-24 h-24 rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden border-2 border-gray-200">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-10 h-10 text-gray-400" />
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="profile-image"
                    disabled={photoOptimizing || isSubmitting}
                  />
                  <label
                    htmlFor="profile-image"
                    className={`inline-flex items-center px-4 py-2.5 text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-xl transition-all ${
                      photoOptimizing ? 'cursor-wait opacity-70' : 'hover:bg-blue-100 cursor-pointer'
                    }`}
                  >
                    {photoOptimizing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    {photoOptimizing ? 'Optimizing…' : 'Upload Photo'}
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    Photos are resized and compressed on your device before upload (aspect ratio kept). GIFs upload as-is.
                  </p>
                </div>
              </div>
            </div>

            {/* Personal Information */}
            <div className="space-y-6">
              {/* Full Name */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <User className="w-4 h-4 inline mr-2" />
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={formData.firstName}
                    disabled={isSubmitting}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="Enter first name"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <User className="w-4 h-4 inline mr-2" />
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={formData.lastName}
                    disabled={isSubmitting}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="Enter last name"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Email & Phone */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Mail className="w-4 h-4 inline mr-2" />
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="your.email@example.com"
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  />
                </div>
                <PhoneCountryInput
                  label="Phone number *"
                  countryIso={formData.phoneCountryIso}
                  onCountryChange={(iso) => setFormData({ ...formData, phoneCountryIso: iso })}
                  national={formData.phoneNational}
                  onNationalChange={(v) => setFormData({ ...formData, phoneNational: v })}
                  disabled={isSubmitting}
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <MapPin className="w-4 h-4 inline mr-2" />
                  Location/Address *
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="City, State or Full Address"
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                />
              </div>

              {/* Additional Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Calendar className="w-4 h-4 inline mr-2" />
                    Date of Birth <span className="text-gray-400 text-xs">(Optional)</span>
                  </label>
                  <DatePickerField
                    value={formData.dateOfBirth}
                    onChange={(v) => setFormData({ ...formData, dateOfBirth: v })}
                    placeholder="Date of birth"
                    disabled={isSubmitting}
                    maxDate={dobMaxDate}
                    triggerClassName="h-auto min-h-[48px] rounded-xl border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-none focus-visible:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gender
                  </label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Marital Status
                  </label>
                  <select
                    value={formData.maritalStatus}
                    onChange={(e) => setFormData({ ...formData, maritalStatus: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  >
                    <option value="">Select status</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
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
                    placeholder="Enter occupation"
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date Joined
                  </label>
                  <DatePickerField
                    value={formData.dateJoined}
                    onChange={(v) => setFormData({ ...formData, dateJoined: v })}
                    placeholder="Date joined"
                    disabled={isSubmitting}
                    triggerClassName="h-auto min-h-[48px] rounded-xl border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-none focus-visible:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Emergency Contact Section */}
            <div className="pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                <AlertCircle className="w-5 h-5 inline mr-2 text-red-600" />
                Emergency Contact Information
              </h3>
              <div className="space-y-6">
                {/* Emergency Contact Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Emergency Contact Name *
                  </label>
                  <input
                    type="text"
                    value={formData.emergencyContactName}
                    onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                    placeholder="Full name"
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-60"
                  />
                </div>

                <PhoneCountryInput
                  label="Emergency contact phone *"
                  countryIso={formData.emergencyContactCountryIso}
                  onCountryChange={(iso) => setFormData({ ...formData, emergencyContactCountryIso: iso })}
                  national={formData.emergencyContactNational}
                  onNationalChange={(v) => setFormData({ ...formData, emergencyContactNational: v })}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
              <p className="text-sm text-blue-900">
                🔒 <strong>Privacy Notice:</strong> Your information will be kept confidential and only used for church communication and emergency purposes.
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => navigate('/')}
                disabled={isSubmitting}
                className="px-6 py-3 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={photoOptimizing || isSubmitting}
                className="inline-flex items-center justify-center gap-2 min-w-[200px] px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    Submitting…
                  </>
                ) : (
                  'Submit registration'
                )}
              </button>
            </div>
          </form>
        </motion.div>

        {/* Footer Info */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Registration Code: <code className="bg-gray-100 px-2 py-1 rounded text-blue-600">{code}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
