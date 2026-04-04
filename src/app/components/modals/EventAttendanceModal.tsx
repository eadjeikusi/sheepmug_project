import { X, QrCode, Check, UserCheck, Users, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { Event, Member } from '../../utils/mockData';
import { toast } from 'sonner';

interface EventAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: Event;
  groupMembers: Member[];
}

export default function EventAttendanceModal({ isOpen, onClose, event, groupMembers }: EventAttendanceModalProps) {
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);

  if (!isOpen) return null;

  const toggleAttendance = (memberId: string) => {
    const newAttendees = new Set(attendees);
    if (newAttendees.has(memberId)) {
      newAttendees.delete(memberId);
      toast.info('Attendance removed');
    } else {
      newAttendees.add(memberId);
      toast.success('Attendance marked');
    }
    setAttendees(newAttendees);
  };

  const simulateQRScan = () => {
    setIsScanning(true);
    toast.info('QR Scanner activated...');
    
    // Simulate scanning a random member after 2 seconds
    setTimeout(() => {
      const unattended = groupMembers.filter(m => !attendees.has(m.id));
      if (unattended.length > 0) {
        const randomMember = unattended[Math.floor(Math.random() * unattended.length)];
        const newAttendees = new Set(attendees);
        newAttendees.add(randomMember.id);
        setAttendees(newAttendees);
        toast.success(`${randomMember.fullName} checked in via QR!`);
      }
      setIsScanning(false);
    }, 2000);
  };

  const handleSave = () => {
    toast.success(`Attendance saved! ${attendees.size} members attended.`);
    onClose();
  };

  const exportAttendance = () => {
    toast.success('Exporting attendance to Excel...');
  };

  const attendanceRate = groupMembers.length > 0 
    ? Math.round((attendees.size / groupMembers.length) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-8 border-b border-gray-100">
          <div className="flex-1">
            <h2 className="text-2xl font-semibold text-gray-900">Take Attendance</h2>
            <p className="text-sm text-gray-500 mt-1">{event.title}</p>
            <div className="flex items-center space-x-4 mt-3 text-sm text-gray-600">
              <span>📅 {new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span>🕒 {event.time}</span>
              <span>📍 {event.location}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all ml-4"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Stats */}
        <div className="px-8 pt-6 pb-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
              <Users className="w-6 h-6 text-gray-400 mx-auto mb-2" />
              <p className="text-2xl font-semibold text-gray-900">{groupMembers.length}</p>
              <p className="text-sm text-gray-500 mt-1">Total Members</p>
            </div>
            <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
              <UserCheck className="w-6 h-6 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-semibold text-green-700">{attendees.size}</p>
              <p className="text-sm text-gray-500 mt-1">Present</p>
            </div>
            <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
              <Check className="w-6 h-6 text-indigo-600 mx-auto mb-2" />
              <p className="text-2xl font-semibold text-indigo-700">{attendanceRate}%</p>
              <p className="text-sm text-gray-500 mt-1">Attendance Rate</p>
            </div>
          </div>
        </div>

        {/* QR Scanner Button */}
        <div className="px-8 pt-6 pb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Mark attendance manually or scan QR codes</p>
          <button
            onClick={simulateQRScan}
            disabled={isScanning}
            className={`flex items-center px-4 py-2.5 text-white rounded-xl transition-all shadow-sm ${
              isScanning 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            <QrCode className={`w-4 h-4 mr-2 ${isScanning ? 'animate-pulse' : ''}`} />
            {isScanning ? 'Scanning...' : 'Scan QR Code'}
          </button>
        </div>

        {/* Members List */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groupMembers.map((member) => {
              const isPresent = attendees.has(member.id);
              return (
                <motion.button
                  key={member.id}
                  onClick={() => toggleAttendance(member.id)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`flex items-center space-x-3 p-4 rounded-2xl border-2 transition-all text-left ${
                    isPresent
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="relative">
                    <img
                      src={member.profileImage}
                      alt={member.fullName}
                      className="w-12 h-12 rounded-xl object-cover"
                    />
                    {isPresent && (
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center border-2 border-white">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-semibold ${isPresent ? 'text-green-900' : 'text-gray-900'}`}>
                      {member.fullName}
                    </h4>
                    <p className={`text-sm ${isPresent ? 'text-green-600' : 'text-gray-500'}`}>
                      {member.email}
                    </p>
                  </div>
                  {isPresent && (
                    <div className="text-green-600">
                      <Check className="w-6 h-6" />
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>

          {groupMembers.length === 0 && (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No members in this group.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-8 pb-8 pt-6 border-t border-gray-100">
          <button
            onClick={exportAttendance}
            className="flex items-center px-4 py-2.5 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all font-medium"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </button>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-6 py-3 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-3 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-sm font-medium"
            >
              Save Attendance ({attendees.size})
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}