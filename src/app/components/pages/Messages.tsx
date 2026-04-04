import { useState } from 'react';
import { Search, Send, Users, UserCircle2, CheckCircle, Clock, XCircle, Plus, X, Filter, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface BulkMessage {
  id: string;
  subject: string;
  message: string;
  recipients: string;
  recipientCount: number;
  sentDate: string;
  status: 'sent' | 'delivered' | 'failed' | 'pending';
  deliveryRate: number;
  openRate: number;
}

const mockBulkMessages: BulkMessage[] = [
  {
    id: '1',
    subject: 'Easter Service Announcement',
    message: 'Join us for our special Easter Sunday service at 9:00 AM...',
    recipients: 'All Members',
    recipientCount: 324,
    sentDate: '2026-03-05',
    status: 'delivered',
    deliveryRate: 98,
    openRate: 87,
  },
  {
    id: '2',
    subject: 'Youth Ministry Retreat',
    message: 'Calling all youth! Sign up for our annual retreat happening next month...',
    recipients: 'Youth Ministry',
    recipientCount: 45,
    sentDate: '2026-03-04',
    status: 'delivered',
    deliveryRate: 100,
    openRate: 92,
  },
  {
    id: '3',
    subject: 'Volunteer Opportunity - Community Outreach',
    message: 'We need volunteers for our upcoming community outreach program...',
    recipients: 'Worship Team, Ushers',
    recipientCount: 78,
    sentDate: '2026-03-03',
    status: 'delivered',
    deliveryRate: 95,
    openRate: 76,
  },
  {
    id: '4',
    subject: 'Prayer Meeting Reminder',
    message: 'Don\'t forget our Wednesday night prayer meeting at 7:00 PM...',
    recipients: 'All Members',
    recipientCount: 324,
    sentDate: '2026-03-01',
    status: 'delivered',
    deliveryRate: 97,
    openRate: 64,
  },
  {
    id: '5',
    subject: 'Building Fund Update',
    message: 'Thank you for your generous contributions to our building fund...',
    recipients: 'All Members',
    recipientCount: 324,
    sentDate: '2026-02-28',
    status: 'delivered',
    deliveryRate: 99,
    openRate: 81,
  },
];

export default function Messages() {
  const [messages, setMessages] = useState<BulkMessage[]>(mockBulkMessages);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'sent' | 'delivered' | 'failed' | 'pending'>('all');
  
  // Compose modal states
  const [subject, setSubject] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [recipientType, setRecipientType] = useState<'all' | 'groups' | 'custom'>('all');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  
  // Schedule states
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  const availableGroups = [
    { id: 'youth', name: 'Youth Ministry', count: 45 },
    { id: 'worship', name: 'Worship Team', count: 32 },
    { id: 'ushers', name: 'Ushers', count: 28 },
    { id: 'choir', name: 'Choir', count: 40 },
    { id: 'kids', name: 'Kids Ministry', count: 67 },
    { id: 'seniors', name: 'Seniors Group', count: 52 },
  ];

  const handleToggleGroup = (groupId: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const handleSendMessage = () => {
    if (!subject.trim() || !messageContent.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    let recipientCount = 0;
    let recipientText = '';

    if (recipientType === 'all') {
      recipientCount = 324;
      recipientText = 'All Members';
    } else if (recipientType === 'groups' && selectedGroups.length > 0) {
      const selectedGroupNames = availableGroups
        .filter(g => selectedGroups.includes(g.id))
        .map(g => g.name);
      recipientCount = availableGroups
        .filter(g => selectedGroups.includes(g.id))
        .reduce((sum, g) => sum + g.count, 0);
      recipientText = selectedGroupNames.join(', ');
    } else {
      toast.error('Please select recipients');
      return;
    }

    // Check if scheduling is enabled
    if (scheduleEnabled) {
      if (!scheduleDate || !scheduleTime) {
        toast.error('Please select date and time for scheduled message');
        return;
      }

      const scheduledDateTime = `${scheduleDate}T${scheduleTime}`;
      const scheduledDate = new Date(scheduledDateTime);
      const now = new Date();

      if (scheduledDate <= now) {
        toast.error('Scheduled time must be in the future');
        return;
      }
    }

    const sentDate = scheduleEnabled ? scheduleDate : new Date().toISOString().split('T')[0];
    const status = scheduleEnabled ? 'pending' : 'sent';

    const newMessage: BulkMessage = {
      id: (messages.length + 1).toString(),
      subject,
      message: messageContent,
      recipients: recipientText,
      recipientCount,
      sentDate,
      status,
      deliveryRate: scheduleEnabled ? 0 : 0,
      openRate: scheduleEnabled ? 0 : 0,
    };

    setMessages([newMessage, ...messages]);
    
    if (scheduleEnabled) {
      toast.success(`Message scheduled for ${new Date(scheduleDate).toLocaleDateString()} at ${scheduleTime}`);
    } else {
      toast.success(`Message sent to ${recipientCount} recipients!`);
    }
    
    // Reset form
    setSubject('');
    setMessageContent('');
    setRecipientType('all');
    setSelectedGroups([]);
    setScheduleEnabled(false);
    setScheduleDate('');
    setScheduleTime('');
    setIsComposeOpen(false);
  };

  const filteredMessages = messages.filter(msg => {
    const matchesSearch = 
      msg.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.recipients.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filterStatus === 'all' || msg.status === filterStatus;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'sent':
        return <Clock className="w-5 h-5 text-blue-600" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      delivered: 'bg-green-50 text-green-700 border-green-200',
      sent: 'bg-blue-50 text-blue-700 border-blue-200',
      pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      failed: 'bg-red-50 text-red-700 border-red-200',
    };
    
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-gray-900 text-[20px]">Bulk Messages</h1>
          <p className="mt-2 text-gray-500">Send messages to members and groups</p>
        </div>
        <button
          onClick={() => setIsComposeOpen(true)}
          className="flex items-center px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-sm text-[12px]"
        >
          <Plus className="w-5 h-5 mr-2" />
          Compose Message
        </button>
      </div>

      {/* Filters and Search */}
      <div className="flex items-center justify-between gap-4">
        {/* Search */}
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-center space-x-2 bg-white rounded-xl border border-gray-200 p-1">
          {(['all', 'delivered', 'sent', 'pending', 'failed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-4 py-2 rounded-lg font-medium transition-all capitalize ${ filterStatus === status ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50' } text-[13px]`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Messages Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Recipients
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Date Sent
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Delivery Rate
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Open Rate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMessages.length > 0 ? (
                filteredMessages.map((message, index) => (
                  <motion.tr
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{message.subject}</p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">{message.message}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <Users className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-[13px]">{message.recipients}</p>
                          <p className="text-xs text-gray-500">{message.recipientCount} recipients</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span>{new Date(message.sentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(message.status)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[80px]">
                          <div
                            className="bg-green-600 h-2 rounded-full transition-all"
                            style={{ width: `${message.deliveryRate}%` }}
                          ></div>
                        </div>
                        <span className="font-medium text-gray-900 text-[13px]">{message.deliveryRate}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[80px]">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${message.openRate}%` }}
                          ></div>
                        </div>
                        <span className="font-medium text-gray-900 text-[13px]">{message.openRate}%</span>
                      </div>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                        <Send className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500 font-medium">No messages found</p>
                      <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compose Message Modal */}
      <AnimatePresence>
        {isComposeOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsComposeOpen(false)}
              className="fixed inset-0 bg-black/50 z-50"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-100">
                  <h2 className="text-2xl font-semibold text-gray-900">Compose Bulk Message</h2>
                  <button
                    onClick={() => setIsComposeOpen(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Subject */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Subject *
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Enter message subject..."
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>

                  {/* Message Content */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message *
                    </label>
                    <textarea
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      placeholder="Type your message here..."
                      rows={6}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>

                  {/* Recipient Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Send To *
                    </label>
                    
                    {/* Recipient Type Tabs */}
                    <div className="flex space-x-2 mb-4">
                      <button
                        onClick={() => setRecipientType('all')}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-all ${
                          recipientType === 'all'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <Users className="w-4 h-4 inline mr-2" />
                        All Members (324)
                      </button>
                      <button
                        onClick={() => setRecipientType('groups')}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-all ${
                          recipientType === 'groups'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <UserCircle2 className="w-4 h-4 inline mr-2" />
                        Specific Groups
                      </button>
                    </div>

                    {/* Group Selection */}
                    {recipientType === 'groups' && (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-600 mb-3">
                          Select ministry groups to send this message to:
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          {availableGroups.map((group) => (
                            <button
                              key={group.id}
                              onClick={() => handleToggleGroup(group.id)}
                              className={`p-3 rounded-xl border-2 transition-all text-left ${
                                selectedGroups.includes(group.id)
                                  ? 'border-indigo-600 bg-indigo-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">{group.count} members</p>
                                </div>
                                {selectedGroups.includes(group.id) && (
                                  <CheckCircle className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                        {selectedGroups.length > 0 && (
                          <p className="text-sm text-indigo-600 font-medium mt-3">
                            Total recipients: {availableGroups
                              .filter(g => selectedGroups.includes(g.id))
                              .reduce((sum, g) => sum + g.count, 0)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Schedule Message */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Schedule Message
                    </label>
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => setScheduleEnabled(!scheduleEnabled)}
                        className={`px-4 py-2.5 rounded-xl font-medium transition-all ${
                          scheduleEnabled
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {scheduleEnabled ? 'Disable' : 'Enable'} Scheduling
                      </button>
                      {scheduleEnabled && (
                        <>
                          <input
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                          />
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-100">
                  <button
                    onClick={() => setIsComposeOpen(false)}
                    className="px-6 py-2.5 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendMessage}
                    className="flex items-center px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-sm"
                  >
                    {scheduleEnabled ? (
                      <>
                        <Clock className="w-4 h-4 mr-2" />
                        Schedule Message
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Now
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}