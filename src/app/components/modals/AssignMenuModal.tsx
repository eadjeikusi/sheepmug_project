import { X, Users, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AssignMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: 'ministry' | 'family') => void;
}

export default function AssignMenuModal({ isOpen, onClose, onSelect }: AssignMenuModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">Assign Member</h2>
                <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-3">
                <button
                  onClick={() => onSelect('ministry')}
                  className="w-full flex items-center p-4 bg-gray-50 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-all text-left"
                >
                  <Users className="w-6 h-6 mr-4" />
                  <span className="font-medium">Assign to Ministry</span>
                </button>
                <button
                  onClick={() => onSelect('family')}
                  className="w-full flex items-center p-4 bg-gray-50 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-all text-left"
                >
                  <Home className="w-6 h-6 mr-4" />
                  <span className="font-medium">Assign to Family</span>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
