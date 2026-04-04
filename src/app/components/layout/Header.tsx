import { Search, Bell, MessageSquare, X, MapPin, LogOut, User, ChevronDown, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { mockNotifications, getUnreadCount } from '../../utils/notificationData';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AuthModal } from '../modals/AuthModal';

interface HeaderProps {
  setActiveTab?: (tab: string) => void;
}

export default function Header({ setActiveTab }: HeaderProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isBranchOpen, setIsBranchOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const { selectedBranch, branches, setSelectedBranch, loading: branchLoading } = useBranch();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  
  const unreadCount = getUnreadCount(mockNotifications);
  const recentNotifications = mockNotifications.slice(0, 5);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsNotificationOpen(false);
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
        setIsBranchOpen(false);
      }
    };

    if (isNotificationOpen || isProfileOpen || isBranchOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNotificationOpen, isProfileOpen, isBranchOpen]);

  const handleViewAll = () => {
    setIsNotificationOpen(false);
    if (setActiveTab) {
      setActiveTab('notifications');
    }
  };

  const handleLogout = async () => {
    logout();
    toast.info('Logged out successfully');
  };

  const handleProfileClick = () => {
    setIsProfileOpen(false);
    if (setActiveTab) {
      setActiveTab('profile');
    }
  };

  return (
    <header className="h-20 bg-white border-b border-gray-100 flex items-center justify-between px-8">
      {/* Left Section: Branch Selection */}
      <div className="flex items-center space-x-4">
        <div className="relative" ref={branchDropdownRef}>
          <div className="flex items-center space-x-2">
            {branchLoading ? (
              <div className="flex items-center space-x-3 px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 animate-pulse">
                <div className="w-8 h-8 rounded-lg bg-gray-200" />
                <div className="flex flex-col space-y-1">
                  <div className="w-16 h-2 bg-gray-200 rounded" />
                  <div className="w-24 h-3 bg-gray-200 rounded" />
                </div>
              </div>
            ) : selectedBranch ? (
              <div className="flex items-center space-x-3 px-4 py-2 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest leading-none mb-1">Active Branch</span>
                  <span className="text-sm font-bold text-indigo-900 leading-none">{selectedBranch.name}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center space-x-3 px-4 py-2 bg-gray-50 rounded-xl border border-gray-100">
                <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">No Branch</span>
                  <span className="text-sm font-bold text-gray-500 leading-none">Select Branch</span>
                </div>
              </div>
            )}
            
            <button
              onClick={() => setIsBranchOpen(!isBranchOpen)}
              disabled={branchLoading}
              className={`p-2 rounded-xl border transition-all duration-200 ${
                isBranchOpen 
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200' 
                  : 'bg-white border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600'
              } ${branchLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isBranchOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Animated Dropdown */}
          <AnimatePresence>
            {isBranchOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="absolute left-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden"
              >
                {/* Dropdown Header */}
                <div className="px-4 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Your Branches</h3>
                  <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-[10px] font-bold">
                    {branches.length}
                  </span>
                </div>

                {/* Branches List */}
                <div className="max-h-[320px] overflow-y-auto py-2">
                  {branches.length > 0 ? (
                    branches.map((branch, index) => (
                      <motion.button
                        key={branch.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 }}
                        onClick={() => {
                          setSelectedBranch(branch);
                          setIsBranchOpen(false);
                          toast.success(`Switched to ${branch.name}`);
                        }}
                        className={`w-full px-4 py-3 flex items-center space-x-3 hover:bg-indigo-50/50 transition-colors group ${
                          selectedBranch?.id === branch.id ? 'bg-indigo-50/30' : ''
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                          selectedBranch?.id === branch.id ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400 group-hover:bg-indigo-100 group-hover:text-indigo-600'
                        }`}>
                          <MapPin className="w-5 h-5" />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className={`text-sm font-bold truncate ${selectedBranch?.id === branch.id ? 'text-indigo-900' : 'text-gray-700'}`}>
                            {branch.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{branch.location || 'No location set'}</p>
                        </div>
                        {selectedBranch?.id === branch.id && (
                          <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </motion.button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">No branches found</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex-1 max-w-2xl mx-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search members, groups, events..."
            className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center space-x-3">
        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsNotificationOpen(!isNotificationOpen)}
            className="relative p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-semibold rounded-full px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Animated Dropdown */}
          <AnimatePresence>
            {isNotificationOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="absolute right-0 mt-2 w-96 bg-white rounded-2xl shadow-xl border border-gray-200 z-50 overflow-hidden"
              >
                {/* Dropdown Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900">Notifications</h3>
                  <button
                    onClick={() => setIsNotificationOpen(false)}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Notifications List */}
                <div className="max-h-[400px] overflow-y-auto">
                  {recentNotifications.length > 0 ? (
                    recentNotifications.map((notification, index) => {
                      const Icon = notification.icon;
                      const bgColor = !notification.read ? 'bg-blue-50/30' : '';
                      const iconBgColor = notification.urgency === 'high' ? 'bg-red-100' : notification.urgency === 'medium' ? 'bg-yellow-100' : 'bg-blue-100';
                      const iconColor = notification.urgency === 'high' ? 'text-red-600' : notification.urgency === 'medium' ? 'text-yellow-600' : 'text-blue-600';
                      
                      return (
                        <motion.div
                          key={notification.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className={`px-4 py-3 hover:bg-gray-50 transition-all cursor-pointer border-b border-gray-50 ${bgColor}`}
                        >
                          <div className="flex items-start space-x-3">
                            <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconBgColor}`}>
                              <Icon className={`w-4 h-4 ${iconColor}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between">
                                <p className="text-sm font-medium text-gray-900 truncate pr-2">
                                  {notification.title}
                                  {!notification.read && (
                                    <span className="ml-1.5 inline-block w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
                                  )}
                                </p>
                              </div>
                              <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">
                                {notification.message}
                              </p>
                              <p className="text-sm text-gray-400 mt-1">{notification.time}</p>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">No notifications</p>
                    </div>
                  )}
                </div>

                {/* Dropdown Footer */}
                {recentNotifications.length > 0 && (
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                    <button
                      onClick={handleViewAll}
                      className="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      View All Notifications
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Messages */}
        <button className="relative p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all">
          <MessageSquare className="w-5 h-5" />
        </button>

        {/* Profile or Login Button */}
        {isAuthenticated && user ? (
          <div className="relative" ref={profileDropdownRef}>
            <button 
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center space-x-3 pl-3 pr-4 py-2 hover:bg-gray-50 rounded-xl transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-semibold text-sm">
                {user.first_name?.[0]}
              </div>
              <div className="hidden lg:block text-left">
                <p className="text-sm font-medium text-gray-900">{user.first_name} {user.last_name}</p>
                <p className="text-sm text-gray-500 capitalize">{user.is_super_admin ? 'Super Admin' : 'Admin'}</p>
              </div>
            </button>

            {/* Profile Dropdown */}
            <AnimatePresence>
              {isProfileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900 truncate">{user.first_name} {user.last_name}</p>
                    <p className="text-sm text-gray-500 truncate">{user.email}</p>
                  </div>
                  <div className="py-2">
                    <button
                      onClick={handleProfileClick}
                      className="w-full flex items-center space-x-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-all"
                    >
                      <User className="w-4 h-4" />
                      <span>Profile Settings</span>
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center space-x-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-all"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Logout</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button 
            onClick={() => setIsAuthModalOpen(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium text-sm rounded-xl transition-all shadow-sm hover:shadow-md"
          >
            Sign In
          </button>
        )}
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultMode="login"
        onSuccess={() => {
          setIsAuthModalOpen(false);
          toast.success('Welcome to ChurchHub!');
        }}
      />
    </header>
  );
}