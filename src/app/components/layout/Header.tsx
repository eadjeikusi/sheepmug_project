import { Bell, MessageSquare, X, LogOut, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AuthModal } from '../modals/AuthModal';
import { useNotifications } from '@/contexts/NotificationContext';
import { usePermissions } from '@/hooks/usePermissions';
import GlobalSearchBar from './GlobalSearchBar';
import { formatNotificationDateTime } from '@/utils/dateDisplayFormat';
import { notificationImageUri, rightAlignedMemberThumbnail } from '@/utils/notificationPayloadDisplay';
import { navigateFromNotificationActionPath } from '@/utils/notificationNavigate';

interface HeaderProps {
  setActiveTab?: (tab: string) => void;
}

export default function Header({ setActiveTab }: HeaderProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const { notifications, unreadCount, markOneRead, iconForNotification } = useNotifications();
  const recentNotifications = notifications.slice(0, 5);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsNotificationOpen(false);
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };

    if (isNotificationOpen || isProfileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNotificationOpen, isProfileOpen]);

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
    <header className="h-16 bg-[#fbfcfb] border-b border-gray-200/70 flex items-center gap-4 px-4">
      <div className="flex-1 min-w-0 flex justify-center">
        {can('view_members') || can('view_events') || can('view_groups') || can('view_families') ? (
          <div className="w-full max-w-2xl">
            <GlobalSearchBar />
          </div>
        ) : (
          <div className="flex-1" aria-hidden />
        )}
      </div>

      {/* Right Section */}
      <div className="flex items-center space-x-2 flex-shrink-0">
        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsNotificationOpen(!isNotificationOpen)}
            className="relative p-2 text-gray-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-all border border-transparent hover:border-blue-100"
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
                className="absolute right-0 mt-2 w-96 bg-white rounded-md shadow-xl border border-gray-200 z-50 overflow-hidden"
              >
                {/* Dropdown Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
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
                      const Icon = iconForNotification(notification);
                      const bgColor = !notification.read_at ? 'bg-blue-50/40' : '';
                      const iconBgColor = notification.severity === 'high' ? 'bg-red-100' : notification.severity === 'medium' ? 'bg-yellow-100' : 'bg-blue-100';
                      const iconColor = notification.severity === 'high' ? 'text-red-600' : notification.severity === 'medium' ? 'text-yellow-700' : 'text-blue-700';
                      const pl =
                        notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
                          ? (notification.payload as Record<string, unknown>)
                          : {};
                      const imgUri = notificationImageUri(pl);
                      const thumbRight = rightAlignedMemberThumbnail(notification.type, pl);

                      return (
                        <motion.div
                          key={notification.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={async () => {
                            if (!notification.read_at) await markOneRead(notification.id);
                            setIsNotificationOpen(false);
                            navigateFromNotificationActionPath(navigate, notification.action_path, pl);
                          }}
                          className={`px-4 py-3 hover:bg-gray-50 transition-all cursor-pointer border-b border-gray-100 ${bgColor}`}
                        >
                          <div
                            className={
                              thumbRight ? 'flex items-start justify-between gap-3' : 'flex items-start space-x-3'
                            }
                          >
                            {!thumbRight ? (
                              <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconBgColor}`}>
                                <Icon className={`w-4 h-4 ${iconColor}`} />
                              </div>
                            ) : null}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 pr-2">
                                {notification.title}
                                {!notification.read_at && (
                                  <span className="ml-1.5 inline-block w-1.5 h-1.5 bg-blue-700 rounded-full align-middle" />
                                )}
                              </p>
                              <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{notification.message}</p>
                              <p className="text-xs text-gray-400 mt-1">{formatNotificationDateTime(notification.created_at)}</p>
                            </div>
                            {thumbRight && imgUri ? (
                              <div className="flex-shrink-0 w-11 h-11 rounded-lg overflow-hidden border border-gray-100 bg-gray-50">
                                <img src={imgUri} alt="" className="w-full h-full object-cover" />
                              </div>
                            ) : null}
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
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                    <button
                      onClick={handleViewAll}
                      className="w-full text-center text-sm font-medium text-blue-700 hover:text-blue-800 transition-colors"
                    >
                      View All Notifications
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Messages — same permission as sidebar */}
        {can('send_messages') ? (
          <button
            type="button"
            onClick={() => navigate('/messages')}
            className="relative p-2 text-gray-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-all border border-transparent hover:border-blue-100"
            aria-label="Messages"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        ) : null}

        {/* Profile or Login Button */}
        {isAuthenticated && user ? (
          <div className="relative" ref={profileDropdownRef}>
            <button 
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center space-x-2.5 pl-2.5 pr-3 py-1.5 hover:bg-white rounded-md transition-all border border-transparent hover:border-gray-200"
            >
              {user.profile_image ? (
                <img
                  src={user.profile_image}
                  alt=""
                  className="w-8 h-8 rounded-md object-cover bg-gray-100 border border-gray-200"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-md bg-blue-700 flex items-center justify-center text-white font-semibold text-sm">
                  {user.first_name?.[0]}
                </div>
              )}
              <div className="hidden lg:block text-left">
                <p className="text-[13px] font-medium text-gray-900">{user.first_name} {user.last_name}</p>
                <p className="text-xs text-gray-500">{user.is_super_admin ? 'Super Admin' : 'Admin'}</p>
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
                  className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-xl border border-gray-200 z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <p className="text-sm font-medium text-gray-900 truncate">{user.first_name} {user.last_name}</p>
                    <p className="text-sm text-gray-500 truncate">{user.email}</p>
                  </div>
                  <div className="py-2">
                    <button
                      onClick={handleProfileClick}
                      className="w-full flex items-center space-x-3 px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 transition-all"
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
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium text-sm rounded-md transition-all shadow-sm hover:shadow-md"
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
          toast.success('Welcome to SheepMug!');
        }}
      />
    </header>
  );
}