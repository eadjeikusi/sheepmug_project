import { Bell, MessageSquare, X, LogOut, User, Menu } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { useBranch } from '@/contexts/BranchContext';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useNotifications } from '@/contexts/NotificationContext';
import { usePermissions } from '@/hooks/usePermissions';
import GlobalSearchBar from './GlobalSearchBar';
import { formatNotificationDateTime } from '@/utils/dateDisplayFormat';
import { notificationImageUri, rightAlignedMemberThumbnail } from '@/utils/notificationPayloadDisplay';
import { navigateFromNotificationActionPath } from '@/utils/notificationNavigate';

interface HeaderProps {
  setActiveTab?: (tab: string) => void;
  onOpenMobileNav?: () => void;
}

const SA_ACT_KEY = 'superadmin_act_as';

export default function Header({ setActiveTab, onOpenMobileNav }: HeaderProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [saActBanner, setSaActBanner] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const { user, isAuthenticated, logout } = useAuth();
  const { currentOrganization } = useApp();
  const { selectedBranch, refreshBranches } = useBranch();
  const navigate = useNavigate();
  const { can } = usePermissions();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SA_ACT_KEY);
      setSaActBanner(user?.is_super_admin === true && !!raw?.trim());
    } catch {
      setSaActBanner(false);
    }
  }, [user?.is_super_admin, currentOrganization?.id, selectedBranch?.id]);

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

  const exitSuperadminContext = () => {
    localStorage.removeItem(SA_ACT_KEY);
    setSaActBanner(false);
    void refreshBranches();
    toast.info('Exited tenant view');
    navigate('/superadmin');
  };

  return (
    <header className="flex min-h-14 flex-col gap-0 border-b border-gray-200/70 bg-[#fbfcfb] px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] sm:min-h-16 sm:gap-3 sm:px-4 sm:py-0">
      {saActBanner ? (
        <div className="mb-1 flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950 sm:text-sm">
          <span className="min-w-0 truncate">
            SuperAdmin: viewing <strong>{currentOrganization?.name ?? 'organization'}</strong>
            {selectedBranch?.name ? (
              <>
                {' '}
                — <strong>{selectedBranch.name}</strong>
              </>
            ) : null}
          </span>
          <button
            type="button"
            onClick={exitSuperadminContext}
            className="shrink-0 rounded-md bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-800"
          >
            Exit
          </button>
        </div>
      ) : null}
      <div className="flex w-full min-w-0 items-center gap-2 sm:gap-3">
      {onOpenMobileNav ? (
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="shrink-0 rounded-lg p-2.5 text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" strokeWidth={2} />
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 justify-center sm:pl-0">
        {can('view_members') || can('view_events') || can('view_groups') || can('view_families') ? (
          <div className="w-full max-w-2xl min-w-0">
            <GlobalSearchBar />
          </div>
        ) : (
          <div className="flex-1" aria-hidden />
        )}
      </div>

      {/* Right Section */}
      <div className="flex flex-shrink-0 items-center gap-0.5 sm:gap-2 sm:space-x-0">
        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsNotificationOpen(!isNotificationOpen)}
            className="relative min-h-11 min-w-11 p-2.5 text-gray-600 transition-all hover:border-blue-100 hover:bg-blue-50 hover:text-blue-800 sm:min-h-0 sm:min-w-0 sm:p-2"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
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
                className="absolute right-0 z-50 mt-2 w-[min(100vw-1.25rem,24rem)] max-w-[min(100vw-1.25rem,24rem)] overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl"
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
            className="relative min-h-11 min-w-11 p-2.5 text-gray-600 transition-all hover:border-blue-100 hover:bg-blue-50 hover:text-blue-800 sm:min-h-0 sm:min-w-0 sm:rounded-md sm:p-2"
            aria-label="Messages"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
        ) : null}

        {/* Profile or Login Button */}
        {isAuthenticated && user ? (
          <div className="relative" ref={profileDropdownRef}>
            <button
              type="button"
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex min-h-11 min-w-0 items-center space-x-2.5 rounded-md border border-transparent py-1.5 pl-1.5 pr-2 transition-all hover:border-gray-200 hover:bg-white sm:min-h-0 sm:pl-2.5 sm:pr-3"
            >
              {user.profile_image ? (
                <img
                  src={user.profile_image}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-white ring-offset-1 ring-offset-[#fbfcfb] border border-gray-200/80"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-semibold text-white ring-2 ring-white ring-offset-1 ring-offset-[#fbfcfb]">
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
                  className="absolute right-0 z-50 mt-2 w-[min(100vw-1.25rem,16rem)] max-w-[min(100vw-1.25rem,16rem)] overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl"
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
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full min-h-10 items-center space-x-3 px-4 py-2.5 text-sm text-gray-800 transition-all hover:bg-blue-50"
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
            onClick={() => navigate('/login')}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-medium text-sm rounded-md transition-all shadow-sm hover:shadow-md"
          >
            Sign In
          </button>
        )}
      </div>
      </div>
    </header>
  );
}