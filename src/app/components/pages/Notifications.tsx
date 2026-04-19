import { Bell, CheckCheck, Trash2, Filter } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useNotifications } from '@/contexts/NotificationContext';
import { getUrgencyColor } from '../../utils/notificationData';
import { FilterResultChips, type FilterChipItem } from '../FilterResultChips';
import { formatNotificationDateTime } from '@/utils/dateDisplayFormat';
import {
  notificationImageUri,
  notificationRichSubtitle,
  rightAlignedMemberThumbnail,
} from '@/utils/notificationPayloadDisplay';
import { navigateFromNotificationActionPath } from '@/utils/notificationNavigate';

type FilterType = 'all' | 'unread' | 'today' | 'week';

export default function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>('all');
  const {
    notifications,
    unreadCount,
    loadingMore,
    hasMore,
    loadMoreNotifications,
    markOneRead,
    markAllRead,
    deleteOne,
    clearAll,
    iconForNotification,
  } = useNotifications();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filteredNotifications = useMemo(() => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    switch (filter) {
      case 'unread':
        return notifications.filter(n => !n.read_at);
      case 'today':
        return notifications.filter(n => new Date(n.created_at).getTime() >= oneDayAgo);
      case 'week':
        return notifications.filter(n => new Date(n.created_at).getTime() >= oneWeekAgo);
      default:
        return notifications;
    }
  }, [filter, notifications]);

  const clearNotificationFilter = useCallback(() => setFilter('all'), []);

  const notificationFilterChips = useMemo((): FilterChipItem[] => {
    if (filter === 'all') return [];
    const labels: Record<Exclude<FilterType, 'all'>, string> = {
      unread: 'Unread',
      today: 'Today',
      week: 'This week',
    };
    return [
      {
        id: 'view',
        label: `View: ${labels[filter as Exclude<FilterType, 'all'>]}`,
        onRemove: clearNotificationFilter,
      },
    ];
  }, [filter, clearNotificationFilter]);

  const handleMarkAllRead = async () => {
    await markAllRead();
    toast.success('All notifications marked as read');
  };

  const handleClearAll = async () => {
    await clearAll();
    toast.success('All notifications cleared');
  };

  const handleMarkAsRead = (id: string) => {
    void markOneRead(id);
    toast.success('Marked as read');
  };

  const handleDelete = (id: string) => {
    void deleteOne(id);
    toast.success('Notification deleted');
  };

  useEffect(() => {
    if (loadingMore || !hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void loadMoreNotifications();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadingMore, hasMore, loadMoreNotifications]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Notifications</h1>
          <p className="mt-2 text-gray-500">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up! 🎉'}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className={`flex items-center px-4 py-2.5 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm ${
              unreadCount === 0 ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <CheckCheck className="w-4 h-4 mr-2" />
            Mark All Read
          </button>
          <button
            onClick={handleClearAll}
            disabled={notifications.length === 0}
            className={`flex items-center px-4 py-2.5 text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-all shadow-sm ${
              notifications.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-2xl p-2 shadow-sm border border-gray-100 inline-flex">
        {(['all', 'unread', 'today', 'week'] as FilterType[]).map((filterOption) => (
          <button
            key={filterOption}
            onClick={() => setFilter(filterOption)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === filterOption
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {filterOption === 'all' ? 'All' : filterOption === 'unread' ? 'Unread' : filterOption === 'today' ? 'Today' : 'This Week'}
            {filterOption === 'unread' && unreadCount > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                filter === filterOption ? 'bg-white/20' : 'bg-gray-200 text-gray-700'
              }`}>
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {notificationFilterChips.length > 0 ? (
        <FilterResultChips chips={notificationFilterChips} onClearAll={clearNotificationFilter} />
      ) : null}

      {/* Notifications List */}
      <div className="space-y-4">
        {filteredNotifications.map((notification, index) => {
          const colors = getUrgencyColor(notification.severity);
          const Icon = iconForNotification(notification);
          const pl =
            notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
              ? (notification.payload as Record<string, unknown>)
              : {};
          const imgUri = notificationImageUri(pl);
          const richSubtitle = notificationRichSubtitle(pl);
          const thumbRight = rightAlignedMemberThumbnail(notification.type, pl);

          return (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={async () => {
                if (!notification.read_at) await markOneRead(notification.id);
                const payload =
                  notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
                    ? (notification.payload as Record<string, unknown>)
                    : {};
                navigateFromNotificationActionPath(navigate, notification.action_path, payload);
              }}
              className={`bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer ${
                !notification.read_at ? 'ring-2 ring-blue-100' : ''
              }`}
            >
              <div
                className={
                  thumbRight
                    ? 'flex items-start justify-between gap-4'
                    : 'flex items-start space-x-4'
                }
              >
                {!thumbRight ? (
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden">
                    {imgUri ? (
                      <img src={imgUri} alt="" className="w-12 h-12 object-cover" />
                    ) : (
                      <div className={`w-12 h-12 rounded-xl ${colors.icon} flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 ${colors.iconColor}`} />
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <h3 className={`text-sm font-semibold ${!notification.read_at ? 'text-gray-900' : 'text-gray-600'}`}>
                        {notification.title}
                        {!notification.read_at && (
                          <span className="ml-2 inline-block w-2 h-2 bg-blue-600 rounded-full align-middle" />
                        )}
                      </h3>
                      {richSubtitle ? (
                        <p className="text-xs text-gray-500 mt-0.5 font-medium">{richSubtitle}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      {!notification.read_at && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkAsRead(notification.id);
                          }}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="Mark as read"
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(notification.id);
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete notification"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 pr-1">{notification.message}</p>
                  <p className="text-xs text-gray-400 mt-2">{formatNotificationDateTime(notification.created_at)}</p>
                </div>

                {thumbRight && imgUri ? (
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
                    <img src={imgUri} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : null}
              </div>
            </motion.div>
          );
        })}
      </div>
      {hasMore ? <div ref={sentinelRef} className="h-6" /> : null}
      {loadingMore ? <p className="text-xs text-gray-500">Loading more notifications...</p> : null}

      {/* Empty State */}
      {filteredNotifications.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium mb-1">No notifications</p>
          <p className="text-sm text-gray-400">
            {filter !== 'all' ? `No ${filter} notifications found` : 'You\'re all caught up!'}
          </p>
        </div>
      )}
    </div>
  );
}