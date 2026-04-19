import React from 'react';
import { X, QrCode, Copy, Download, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface MemberLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  registrationLink: string;
  registrationQRCode: string;
  downloadQRCode: () => void;
  shareLink: () => void;
}

const MemberLinkModal: React.FC<MemberLinkModalProps> = ({
  isOpen,
  onClose,
  registrationLink,
  registrationQRCode,
  downloadQRCode,
    shareLink
}) => {
  const copyLinkToClipboard = () => {
    navigator.clipboard.writeText(registrationLink);
    toast.success('Registration link copied to clipboard!');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Member Registration Link</h2>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-6 h-6 text-gray-600" />
              </button>
            </div>

            <div className="space-y-4 text-center">
              {registrationQRCode ? (
                <div className="flex flex-col items-center justify-center bg-gray-50 p-4 rounded-xl">
                  <img src={registrationQRCode} alt="QR Code" className="w-48 h-48 object-contain mb-4 border border-gray-200 rounded-lg" />
                  <p className="text-gray-600 text-sm">Scan this QR code to register.</p>
                </div>
              ) : (
                <div className="flex items-center justify-center bg-gray-50 p-6 rounded-xl">
                  <p className="text-gray-500">Generating QR code...</p>
                </div>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between space-x-3">
                <p className="text-sm text-gray-700 truncate">{registrationLink}</p>
                <button
                  onClick={copyLinkToClipboard}
                  className="flex-shrink-0 p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors shadow-sm"
                  title="Copy link"
                >
                  <Copy className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={downloadQRCode}
                className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors shadow-sm"
                disabled={!registrationQRCode}
              >
                <Download className="w-5 h-5 mr-2" />
                Download QR
              </button>
              <button
                onClick={shareLink}
                className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors shadow-sm"
              >
                <Share2 className="w-5 h-5 mr-2" />
                Share Link
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MemberLinkModal;
