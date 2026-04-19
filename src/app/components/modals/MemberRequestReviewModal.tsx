import { useState } from 'react';
import { X, Eye, Check, XCircle, Edit2, Clock, Mail, Phone, MapPin, User, Briefcase, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import type { MemberRequest } from '../pages/Members';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';

interface MemberRequestReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: MemberRequest[];
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export default function MemberRequestReviewModal({
  isOpen,
  onClose,
  requests,
  onApprove,
  onReject,
}: MemberRequestReviewModalProps) {
  const [selectedRequest, setSelectedRequest] = useState<MemberRequest | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedRequest, setEditedRequest] = useState<MemberRequest | null>(null);

  const pendingRequests = requests.filter(r => r.status === 'pending');

  const handleView = (request: MemberRequest) => {
    setSelectedRequest(request);
    setEditedRequest(request);
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editedRequest) {
      // In real implementation, this would update the backend
      toast.success('Changes saved successfully!');
      setSelectedRequest(editedRequest);
      setIsEditing(false);
    }
  };

  const handleApprove = (requestId: string) => {
    onApprove(requestId);
    setSelectedRequest(null);
  };

  const handleReject = (requestId: string) => {
    onReject(requestId);
    setSelectedRequest(null);
  };

  const formatDate = (dateString: string) => {
    return formatLongWeekdayDate(dateString) || dateString;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Member Requests</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {pendingRequests.length} pending {pendingRequests.length === 1 ? 'request' : 'requests'}
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                    {/* Requests List */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Pending Requests
                      </h3>
                      
                      {pendingRequests.length === 0 ? (
                        <div className="text-center py-12 bg-gray-50 rounded-2xl">
                          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500">No pending requests</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {pendingRequests.map((request) => (
                            <motion.div
                              key={request.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`bg-white border-2 rounded-2xl p-4 cursor-pointer transition-all ${
                                selectedRequest?.id === request.id
                                  ? 'border-blue-500 shadow-lg'
                                  : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
                              }`}
                              onClick={() => handleView(request)}
                            >
                              <div className="flex items-start space-x-3">
                                <img
                                  src={request.profileImage || ''}
                                  alt={request.fullName}
                                  className="w-12 h-12 rounded-xl object-cover"
                                />
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-semibold text-gray-900">{request.fullName}</h4>
                                  <p className="text-sm text-gray-500">{request.email}</p>
                                  <div className="flex items-center space-x-2 mt-2">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-yellow-50 text-yellow-700">
                                      <Clock className="w-3 h-3 mr-1" />
                                      Pending
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {formatDate(request.submittedDate)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Request Detail */}
                    <div className="space-y-4">
                      {selectedRequest ? (
                        <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-semibold text-gray-900">
                              Request Details
                            </h3>
                            {!isEditing && (
                              <button
                                onClick={handleEdit}
                                className="flex items-center px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
                              >
                                <Edit2 className="w-3 h-3 mr-2" />
                                Edit
                              </button>
                            )}
                          </div>

                          {/* Profile Image */}
                          <div className="flex justify-center mb-6">
                            <img
                              src={selectedRequest.profileImage || ''}
                              alt={selectedRequest.fullName}
                              className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-md"
                            />
                          </div>

                          {/* Details Grid */}
                          <div className="space-y-4">
                            {/* Full Name */}
                            <div>
                              <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                <User className="w-3 h-3 mr-2" />
                                Full Name
                              </label>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editedRequest?.fullName}
                                  onChange={(e) => setEditedRequest(editedRequest ? { ...editedRequest, fullName: e.target.value } : null)}
                                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p className="text-gray-900 font-medium">{selectedRequest.fullName}</p>
                              )}
                            </div>

                            {/* Email */}
                            <div>
                              <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                <Mail className="w-3 h-3 mr-2" />
                                Email Address
                              </label>
                              {isEditing ? (
                                <input
                                  type="email"
                                  value={editedRequest?.email}
                                  onChange={(e) => setEditedRequest(editedRequest ? { ...editedRequest, email: e.target.value } : null)}
                                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p className="text-gray-900">{selectedRequest.email}</p>
                              )}
                            </div>

                            {/* Phone Number */}
                            <div>
                              <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                <Phone className="w-3 h-3 mr-2" />
                                Phone Number
                              </label>
                              {isEditing ? (
                                <input
                                  type="tel"
                                  value={editedRequest?.phoneNumber}
                                  onChange={(e) => setEditedRequest(editedRequest ? { ...editedRequest, phoneNumber: e.target.value } : null)}
                                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p className="text-gray-900">{selectedRequest.phoneNumber}</p>
                              )}
                            </div>

                            {/* Location */}
                            <div>
                              <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                <MapPin className="w-3 h-3 mr-2" />
                                Location
                              </label>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editedRequest?.location}
                                  onChange={(e) => setEditedRequest(editedRequest ? { ...editedRequest, location: e.target.value } : null)}
                                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p className="text-gray-900">{selectedRequest.location}</p>
                              )}
                            </div>

                            {/* Emergency Contact */}
                            <div>
                              <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                <Phone className="w-3 h-3 mr-2" />
                                Emergency Contact
                              </label>
                              {isEditing ? (
                                <input
                                  type="tel"
                                  value={editedRequest?.emergencyContact}
                                  onChange={(e) => setEditedRequest(editedRequest ? { ...editedRequest, emergencyContact: e.target.value } : null)}
                                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p className="text-gray-900">{selectedRequest.emergencyContact}</p>
                              )}
                            </div>

                            {/* Additional Info Grid */}
                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                              {selectedRequest.dateOfBirth && (
                                <div>
                                  <label className="text-sm font-medium text-gray-500 mb-2 block">
                                    Date of Birth
                                  </label>
                                  <p className="text-gray-900">{formatDate(selectedRequest.dateOfBirth)}</p>
                                </div>
                              )}
                              {selectedRequest.gender && (
                                <div>
                                  <label className="text-sm font-medium text-gray-500 mb-2 block">
                                    Gender
                                  </label>
                                  <p className="text-gray-900">{selectedRequest.gender}</p>
                                </div>
                              )}
                              {selectedRequest.occupation && (
                                <div>
                                  <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                    <Briefcase className="w-3 h-3 mr-2" />
                                    Occupation
                                  </label>
                                  <p className="text-gray-900">{selectedRequest.occupation}</p>
                                </div>
                              )}
                              {selectedRequest.maritalStatus && (
                                <div>
                                  <label className="flex items-center text-sm font-medium text-gray-500 mb-2">
                                    <Heart className="w-3 h-3 mr-2" />
                                    Marital Status
                                  </label>
                                  <p className="text-gray-900">{selectedRequest.maritalStatus}</p>
                                </div>
                              )}
                            </div>

                            {/* Notes */}
                            {selectedRequest.notes && (
                              <div className="pt-4 border-t border-gray-200">
                                <label className="text-sm font-medium text-gray-500 mb-2 block">
                                  Notes
                                </label>
                                {isEditing ? (
                                  <textarea
                                    value={editedRequest?.notes}
                                    onChange={(e) => setEditedRequest(editedRequest ? { ...editedRequest, notes: e.target.value } : null)}
                                    rows={3}
                                    className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                ) : (
                                  <p className="text-gray-900 text-sm">{selectedRequest.notes}</p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center space-x-3 mt-6 pt-6 border-t border-gray-200">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={handleSaveEdit}
                                  className="flex-1 flex items-center justify-center px-4 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all font-medium"
                                >
                                  <Check className="w-4 h-4 mr-2" />
                                  Save Changes
                                </button>
                                <button
                                  onClick={() => {
                                    setEditedRequest(selectedRequest);
                                    setIsEditing(false);
                                  }}
                                  className="flex-1 flex items-center justify-center px-4 py-3 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all font-medium"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleApprove(selectedRequest.id)}
                                  className="flex-1 flex items-center justify-center px-4 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all font-medium"
                                >
                                  <Check className="w-4 h-4 mr-2" />
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject(selectedRequest.id)}
                                  className="flex-1 flex items-center justify-center px-4 py-3 text-white bg-red-600 rounded-xl hover:bg-red-700 transition-all font-medium"
                                >
                                  <XCircle className="w-4 h-4 mr-2" />
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded-2xl p-12 border border-gray-200 text-center">
                          <Eye className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500">Select a request to view details</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}