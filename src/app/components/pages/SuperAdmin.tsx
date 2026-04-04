import { useState } from 'react';
import { 
  Building2, 
  Users, 
  Calendar, 
  DollarSign, 
  Search,
  Plus,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  TrendingUp,
  Shield
} from 'lucide-react';
import AddChurchModal from '../modals/AddChurchModal';
import DeleteModal from '../modals/DeleteModal';

interface Church {
  id: string;
  name: string;
  pastor: string;
  email: string;
  phone: string;
  members: number;
  branches: number;
  plan: 'Free' | 'Basic' | 'Pro' | 'Enterprise';
  status: 'Active' | 'Inactive' | 'Suspended';
  joinedDate: string;
  revenue: number;
}

const mockChurches: Church[] = [
  {
    id: '1',
    name: 'Grace Community Church',
    pastor: 'Rev. John Smith',
    email: 'john@gracechurch.org',
    phone: '+1 234 567 8900',
    members: 450,
    branches: 3,
    plan: 'Pro',
    status: 'Active',
    joinedDate: '2024-01-15',
    revenue: 299
  },
  {
    id: '2',
    name: 'Faith Baptist Church',
    pastor: 'Pastor Sarah Johnson',
    email: 'sarah@faithbaptist.org',
    phone: '+1 234 567 8901',
    members: 280,
    branches: 2,
    plan: 'Basic',
    status: 'Active',
    joinedDate: '2024-02-20',
    revenue: 99
  },
  {
    id: '3',
    name: 'Hope Fellowship',
    pastor: 'Rev. Michael Brown',
    email: 'michael@hopefellowship.org',
    phone: '+1 234 567 8902',
    members: 620,
    branches: 5,
    plan: 'Enterprise',
    status: 'Active',
    joinedDate: '2023-11-10',
    revenue: 599
  },
  {
    id: '4',
    name: 'New Life Church',
    pastor: 'Pastor Emily Davis',
    email: 'emily@newlifechurch.org',
    phone: '+1 234 567 8903',
    members: 150,
    branches: 1,
    plan: 'Free',
    status: 'Active',
    joinedDate: '2024-03-05',
    revenue: 0
  },
  {
    id: '5',
    name: 'Cornerstone Church',
    pastor: 'Rev. David Wilson',
    email: 'david@cornerstone.org',
    phone: '+1 234 567 8904',
    members: 95,
    branches: 1,
    plan: 'Basic',
    status: 'Suspended',
    joinedDate: '2024-01-28',
    revenue: 99
  }
];

export default function SuperAdmin() {
  const [churches, setChurches] = useState<Church[]>(mockChurches);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPlan, setFilterPlan] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Calculate overview stats
  const totalChurches = churches.length;
  const totalMembers = churches.reduce((sum, church) => sum + church.members, 0);
  const totalRevenue = churches.reduce((sum, church) => sum + church.revenue, 0);
  const activeChurches = churches.filter(c => c.status === 'Active').length;

  // Filter churches
  const filteredChurches = churches.filter(church => {
    const matchesSearch = church.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         church.pastor.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         church.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlan = filterPlan === 'all' || church.plan === filterPlan;
    const matchesStatus = filterStatus === 'all' || church.status === filterStatus;
    return matchesSearch && matchesPlan && matchesStatus;
  });

  const handleEdit = (church: Church) => {
    setSelectedChurch(church);
    setShowAddModal(true);
    setActiveDropdown(null);
  };

  const handleDelete = (church: Church) => {
    setSelectedChurch(church);
    setShowDeleteModal(true);
    setActiveDropdown(null);
  };

  const confirmDelete = () => {
    if (selectedChurch) {
      setChurches(churches.filter(c => c.id !== selectedChurch.id));
      setShowDeleteModal(false);
      setSelectedChurch(null);
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'Enterprise': return 'bg-purple-100 text-purple-700';
      case 'Pro': return 'bg-blue-100 text-blue-700';
      case 'Basic': return 'bg-green-100 text-green-700';
      case 'Free': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-green-100 text-green-700';
      case 'Inactive': return 'bg-gray-100 text-gray-700';
      case 'Suspended': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">SuperAdmin Dashboard</h1>
              <p className="text-base text-gray-500 mt-1">Manage all churches and organizations</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            setSelectedChurch(null);
            setShowAddModal(true);
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-base rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Church
        </button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Total Churches</p>
              <p className="text-3xl font-semibold text-gray-900">{totalChurches}</p>
              <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />
                {activeChurches} Active
              </p>
            </div>
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-indigo-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Total Members</p>
              <p className="text-3xl font-semibold text-gray-900">{totalMembers.toLocaleString()}</p>
              <p className="text-sm text-gray-500 mt-2">Across all churches</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Monthly Revenue</p>
              <p className="text-3xl font-semibold text-gray-900">${totalRevenue.toLocaleString()}</p>
              <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />
                +12.5% from last month
              </p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Total Branches</p>
              <p className="text-3xl font-semibold text-gray-900">
                {churches.reduce((sum, c) => sum + c.branches, 0)}
              </p>
              <p className="text-sm text-gray-500 mt-2">All locations</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by church name, pastor, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-base border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Plan Filter */}
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="px-4 py-2.5 text-base border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
          >
            <option value="all">All Plans</option>
            <option value="Free">Free</option>
            <option value="Basic">Basic</option>
            <option value="Pro">Pro</option>
            <option value="Enterprise">Enterprise</option>
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2.5 text-base border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
          >
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Churches Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Church</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Pastor</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Contact</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Members</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Branches</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Plan</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Status</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Revenue</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Joined</th>
                <th className="text-right px-6 py-4 text-sm font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredChurches.map((church) => (
                <tr key={church.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-base font-medium text-gray-900">{church.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-base text-gray-900">{church.pastor}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-600">{church.email}</p>
                    <p className="text-sm text-gray-500">{church.phone}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-base text-gray-900">{church.members.toLocaleString()}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-base text-gray-900">{church.branches}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getPlanColor(church.plan)}`}>
                      {church.plan}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(church.status)}`}>
                      {church.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-base font-medium text-gray-900">
                      ${church.revenue}/mo
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-600">
                      {new Date(church.joinedDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4 text-gray-600" />
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setActiveDropdown(activeDropdown === church.id ? null : church.id)}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-600" />
                        </button>
                        {activeDropdown === church.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-10">
                            <button
                              onClick={() => handleEdit(church)}
                              className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                              Edit Church
                            </button>
                            <button
                              onClick={() => handleDelete(church)}
                              className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete Church
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredChurches.length === 0 && (
            <div className="text-center py-12">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-base text-gray-500">No churches found matching your filters</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddChurchModal
          church={selectedChurch}
          onClose={() => {
            setShowAddModal(false);
            setSelectedChurch(null);
          }}
          onSave={(churchData) => {
            if (selectedChurch) {
              // Edit existing
              setChurches(churches.map(c => 
                c.id === selectedChurch.id ? { ...c, ...churchData } : c
              ));
            } else {
              // Add new
              setChurches([...churches, {
                id: Date.now().toString(),
                ...churchData,
                members: 0,
                branches: 1,
                joinedDate: new Date().toISOString().split('T')[0],
                revenue: churchData.plan === 'Free' ? 0 : 
                        churchData.plan === 'Basic' ? 99 :
                        churchData.plan === 'Pro' ? 299 : 599
              }]);
            }
            setShowAddModal(false);
            setSelectedChurch(null);
          }}
        />
      )}

      {showDeleteModal && selectedChurch && (
        <DeleteModal
          isOpen
          title="Delete Church"
          message={`Are you sure you want to delete "${selectedChurch.name}"? This action cannot be undone and will remove all associated data.`}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedChurch(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
