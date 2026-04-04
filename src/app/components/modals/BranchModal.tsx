import { useState, useEffect } from 'react';
import { X, Building2, MapPin, Phone, Mail, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface Branch {
  id?: string;
  organization_id: string;
  name: string;
  location: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  phone_number: string;
  email: string;
  capacity?: number;
  established_date: string;
  is_active: boolean;
}

interface BranchModalProps {
  branch?: Branch | null;
  organizationId: string;
  onClose: () => void;
  onSave: (branch: Branch) => void;
}

export default function BranchModal({ branch, organizationId, onClose, onSave }: BranchModalProps) {
  const [formData, setFormData] = useState<Branch>({
    organization_id: organizationId,
    name: '',
    location: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    phone_number: '',
    email: '',
    capacity: undefined,
    established_date: new Date().toISOString().split('T')[0],
    is_active: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (branch) {
      setFormData(branch);
    }
  }, [branch]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = 'Branch name is required';
    if (!formData.location.trim()) newErrors.location = 'Location is required';
    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state.trim()) newErrors.state = 'State is required';
    if (!formData.zip_code.trim()) newErrors.zip_code = 'ZIP code is required';
    if (!formData.phone_number.trim()) newErrors.phone_number = 'Phone number is required';
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }
    if (!formData.established_date) newErrors.established_date = 'Established date is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    
    // Check for auth token
    const token = localStorage.getItem('auth_token');
    
    if (!token) {
      toast.error('Authentication required. Please log in again.');
      return;
    }
    
    if (!validateForm()) {
      toast.error('Please fill in all required fields');
      return;
    }

    onSave(formData);
  };

  const handleChange = (field: keyof Branch, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {branch ? 'Edit Branch' : 'Create New Branch'}
                </h2>
                <p className="text-sm text-gray-500">
                  {branch ? 'Update branch information' : 'Add a new church branch'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-200px)]">
            <div className="px-6 py-6 space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                  <Building2 className="w-4 h-4 mr-2" />
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Branch Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      placeholder="e.g., Main Branch"
                      className={`w-full px-4 py-2.5 border ${errors.name ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Location <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => handleChange('location', e.target.value)}
                      placeholder="e.g., Springfield, Illinois"
                      className={`w-full px-4 py-2.5 border ${errors.location ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.location && <p className="text-xs text-red-500 mt-1">{errors.location}</p>}
                  </div>
                </div>
              </div>

              {/* Address Information */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                  <MapPin className="w-4 h-4 mr-2" />
                  Address Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Street Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      placeholder="e.g., 100 Church Street"
                      className={`w-full px-4 py-2.5 border ${errors.address ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.address && <p className="text-xs text-red-500 mt-1">{errors.address}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      City <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      placeholder="e.g., Springfield"
                      className={`w-full px-4 py-2.5 border ${errors.city ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      State <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => handleChange('state', e.target.value)}
                      placeholder="e.g., Illinois"
                      className={`w-full px-4 py-2.5 border ${errors.state ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.state && <p className="text-xs text-red-500 mt-1">{errors.state}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      ZIP Code <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.zip_code}
                      onChange={(e) => handleChange('zip_code', e.target.value)}
                      placeholder="e.g., 62701"
                      className={`w-full px-4 py-2.5 border ${errors.zip_code ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.zip_code && <p className="text-xs text-red-500 mt-1">{errors.zip_code}</p>}
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                  <Phone className="w-4 h-4 mr-2" />
                  Contact Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.phone_number}
                      onChange={(e) => handleChange('phone_number', e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className={`w-full px-4 py-2.5 border ${errors.phone_number ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.phone_number && <p className="text-xs text-red-500 mt-1">{errors.phone_number}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="branch@church.org"
                      className={`w-full px-4 py-2.5 border ${errors.email ? 'border-red-300' : 'border-gray-200'} rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
                    />
                    {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center space-x-2"
              >
                <Building2 className="w-4 h-4" />
                <span>{branch ? 'Update Branch' : 'Create Branch'}</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}