import { useState } from 'react';
import { Church, Building2, Loader2, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { organizationApi, branchApi } from '../../utils/api';
import { useApp } from '../../contexts/AppContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';

export default function InitialSetup() {
  const navigate = useNavigate();
  const { setCurrentOrganization, setCurrentBranchId } = useApp();
  const [step, setStep] = useState<'organization' | 'branch' | 'complete'>('organization');
  const [loading, setLoading] = useState(false);
  const [createdOrg, setCreatedOrg] = useState<any>(null);

  const [orgData, setOrgData] = useState({
    name: '',
    email: '',
    phone: '',
    timezone: 'America/New_York',
    currency: 'USD',
  });

  const [branchData, setBranchData] = useState({
    name: 'Main Campus',
    city: '',
    state: '',
    country: 'United States',
  });

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const slug = orgData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      const response = await organizationApi.create({
        name: orgData.name,
        slug: slug,
        email: orgData.email || null,
        phone: orgData.phone || null,
        timezone: orgData.timezone,
        currency: orgData.currency,
        subscription_status: 'trial',
        settings: {},
      });

      if (response.success) {
        setCreatedOrg(response.data);
        setCurrentOrganization(response.data);
        toast.success('Organization created successfully!');
        setStep('branch');
      } else {
        toast.error(`Failed to create organization: ${response.error}`);
      }
    } catch (error) {
      toast.error('An error occurred while creating the organization');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const slug = branchData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      const response = await branchApi.create({
        organization_id: createdOrg.id,
        name: branchData.name,
        slug: slug,
        city: branchData.city || null,
        state: branchData.state || null,
        country: branchData.country,
        is_main_branch: true,
        settings: {},
      });

      if (response.success) {
        setCurrentBranchId(response.data.id);
        toast.success('Branch created successfully!');
        setStep('complete');
        
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        toast.error(`Failed to create branch: ${response.error}`);
      }
    } catch (error) {
      toast.error('An error occurred while creating the branch');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl"
      >
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-6 text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <Church className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Welcome to ChurchHub!</h1>
                <p className="text-blue-100 text-sm mt-1">
                  Let's set up your church management system
                </p>
              </div>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="px-8 py-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === 'organization' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'
                }`}>
                  {step === 'organization' ? '1' : <CheckCircle className="w-5 h-5" />}
                </div>
                <span className="text-sm font-medium text-gray-900">Organization</span>
              </div>

              <div className="flex-1 h-0.5 bg-gray-200 mx-4" />

              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === 'branch' ? 'bg-blue-600 text-white' : 
                  step === 'complete' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {step === 'complete' ? <CheckCircle className="w-5 h-5" /> : '2'}
                </div>
                <span className="text-sm font-medium text-gray-900">Branch</span>
              </div>

              <div className="flex-1 h-0.5 bg-gray-200 mx-4" />

              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === 'complete' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {step === 'complete' ? <CheckCircle className="w-5 h-5" /> : '3'}
                </div>
                <span className="text-sm font-medium text-gray-900">Complete</span>
              </div>
            </div>
          </div>

          <div className="px-8 py-8">
            {/* Step 1: Create Organization */}
            {step === 'organization' && (
              <motion.form
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onSubmit={handleCreateOrganization}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">Create Your Organization</h2>
                  <p className="text-sm text-gray-600">
                    Enter your church or organization details to get started
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Organization Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={orgData.name}
                      onChange={(e) => setOrgData({ ...orgData, name: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., Grace Community Church"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={orgData.email}
                        onChange={(e) => setOrgData({ ...orgData, email: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="church@example.com"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={orgData.phone}
                        onChange={(e) => setOrgData({ ...orgData, phone: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Timezone
                      </label>
                      <select
                        value={orgData.timezone}
                        onChange={(e) => setOrgData({ ...orgData, timezone: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="America/New_York">Eastern Time</option>
                        <option value="America/Chicago">Central Time</option>
                        <option value="America/Denver">Mountain Time</option>
                        <option value="America/Los_Angeles">Pacific Time</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Currency
                      </label>
                      <select
                        value={orgData.currency}
                        onChange={(e) => setOrgData({ ...orgData, currency: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !orgData.name}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating Organization...
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </motion.form>
            )}

            {/* Step 2: Create Branch */}
            {step === 'branch' && (
              <motion.form
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onSubmit={handleCreateBranch}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">Create Your First Branch</h2>
                  <p className="text-sm text-gray-600">
                    Set up your main campus or branch location
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Branch Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={branchData.name}
                      onChange={(e) => setBranchData({ ...branchData, name: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., Main Campus"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        City
                      </label>
                      <input
                        type="text"
                        value={branchData.city}
                        onChange={(e) => setBranchData({ ...branchData, city: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="New York"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        State/Province
                      </label>
                      <input
                        type="text"
                        value={branchData.state}
                        onChange={(e) => setBranchData({ ...branchData, state: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="NY"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Country
                    </label>
                    <input
                      type="text"
                      value={branchData.country}
                      onChange={(e) => setBranchData({ ...branchData, country: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="United States"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !branchData.name}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating Branch...
                    </>
                  ) : (
                    'Complete Setup'
                  )}
                </button>
              </motion.form>
            )}

            {/* Step 3: Complete */}
            {step === 'complete' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-12 h-12 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Setup Complete!</h2>
                <p className="text-gray-600 mb-8">
                  Your organization has been created successfully.<br />
                  Redirecting to your dashboard...
                </p>
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
              </motion.div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-600 mt-6">
          Need help? Contact support at support@churchhub.com
        </p>
      </motion.div>
    </div>
  );
}
