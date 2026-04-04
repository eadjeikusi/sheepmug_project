import { Bell, CheckCheck, Trash2, Filter } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useState, useMemo } from 'react';
import { mockNotifications, getUrgencyColor, type Notification } from '../../utils/notificationData';

type FilterType = 'all' | 'unread' | 'today' | 'week';

export default function Notifications() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

  const filteredNotifications = useMemo(() => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    switch (filter) {
      case 'unread':
        return notifications.filter(n => !n.read);
      case 'today':
        return notifications.filter(n => n.timestamp.getTime() >= oneDayAgo);
      case 'week':
        return notifications.filter(n => n.timestamp.getTime() >= oneWeekAgo);
      default:
        return notifications;
    }
  }, [filter, notifications]);
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
    toast.success('All notifications marked as read');
  };

  const handleClearAll = () => {
    setNotifications([]);
    toast.success('All notifications cleared');
  };

  const handleMarkAsRead = (id: string) => {
    setNotifications(notifications.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
    toast.success('Marked as read');
  };

  const handleDelete = (id: string) => {
    setNotifications(notifications.filter(n => n.id !== id));
    toast.success('Notification deleted');
  };

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
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize ${
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

      {/* Notifications List */}
      <div className="space-y-4">
        {filteredNotifications.map((notification, index) => {
          const colors = getUrgencyColor(notification.urgency);
          const Icon = notification.icon;
          
          return (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all ${
                !notification.read ? 'ring-2 ring-indigo-100' : ''
              }`}
            >
              <div className="flex items-start space-x-4">
                <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${colors.icon} flex items-center justify-center`}>
                  <Icon className={`w-6 h-6 ${colors.iconColor}`} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className={`text-sm font-semibold ${!notification.read ? 'text-gray-900' : 'text-gray-600'}`}>
                        {notification.title}
                        {!notification.read && (
                          <span className="ml-2 inline-block w-2 h-2 bg-indigo-600 rounded-full"></span>
                        )}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                      <p className="text-xs text-gray-400 mt-2">{notification.time}</p>
                    </div>
                    
                    <div className="flex items-center space-x-2 ml-4">
                      {!notification.read && (
                        <button
                          onClick={() => handleMarkAsRead(notification.id)}
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          title="Mark as read"
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(notification.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete notification"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

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