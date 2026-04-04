import { AlertCircle, UserCheck, Calendar, Users, MessageSquare, Trophy, Settings as SettingsIcon, Bell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'alert' | 'member' | 'event' | 'group' | 'message' | 'attendance' | 'permission' | 'system';
  icon: LucideIcon;
  title: string;
  message: string;
  time: string;
  read: boolean;
  urgency: 'high' | 'medium' | 'low';
  timestamp: Date;
}

export const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'alert',
    icon: AlertCircle,
    title: 'Low Attendance Alert',
    message: '5 members have missed the last 3 services. Consider a follow-up.',
    time: '10 minutes ago',
    read: false,
    urgency: 'high',
    timestamp: new Date(Date.now() - 10 * 60 * 1000),
  },
  {
    id: '2',
    type: 'member',
    icon: UserCheck,
    title: 'New Member Added',
    message: 'Jessica Williams has been added to the Youth Ministry group.',
    time: '2 hours ago',
    read: false,
    urgency: 'medium',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: '3',
    type: 'event',
    icon: Calendar,
    title: 'Upcoming Event',
    message: 'Spring Conference is scheduled for March 15, 2026.',
    time: '5 hours ago',
    read: false,
    urgency: 'low',
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000),
  },
  {
    id: '4',
    type: 'alert',
    icon: AlertCircle,
    title: 'Member Concern',
    message: 'AI detected a concern note for David Thompson - marked as urgent.',
    time: '1 day ago',
    read: true,
    urgency: 'high',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: '5',
    type: 'group',
    icon: Users,
    title: 'New Group Request',
    message: 'Sarah Johnson requested to join the Worship Team ministry.',
    time: '1 day ago',
    read: true,
    urgency: 'medium',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: '6',
    type: 'message',
    icon: MessageSquare,
    title: 'New Message',
    message: 'Pastor Mark sent you a message about the upcoming retreat.',
    time: '2 days ago',
    read: true,
    urgency: 'low',
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
  {
    id: '7',
    type: 'attendance',
    icon: Trophy,
    title: 'Attendance Milestone',
    message: 'Youth Ministry reached 50 consecutive weeks of 90%+ attendance!',
    time: '3 days ago',
    read: true,
    urgency: 'low',
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  },
  {
    id: '8',
    type: 'permission',
    icon: SettingsIcon,
    title: 'Permission Changed',
    message: 'Your role has been updated to "Youth Leader" with additional access.',
    time: '1 week ago',
    read: true,
    urgency: 'medium',
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  },
];

export const getUnreadCount = (notifications: Notification[]) => {
  return notifications.filter(n => !n.read).length;
};

export const getUrgencyColor = (urgency: string) => {
  switch (urgency) {
    case 'high': 
      return { 
        bg: 'bg-red-50', 
        icon: 'bg-red-100', 
        iconColor: 'text-red-600',
        border: 'border-red-200'
      };
    case 'medium': 
      return { 
        bg: 'bg-yellow-50', 
        icon: 'bg-yellow-100', 
        iconColor: 'text-yellow-600',
        border: 'border-yellow-200'
      };
    default: 
      return { 
        bg: 'bg-blue-50', 
        icon: 'bg-blue-100', 
        iconColor: 'text-blue-600',
        border: 'border-blue-200'
      };
  }
};
