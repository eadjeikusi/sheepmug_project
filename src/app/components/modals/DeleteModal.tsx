import { AlertTriangle, X } from 'lucide-react';
import { motion } from 'motion/react';

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** Primary action label (default: "Delete") */
  confirmLabel?: string;
  /** danger = destructive delete styling; caution = warning / remove-without-delete */
  variant?: 'danger' | 'caution';
}

export default function DeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  variant = 'danger',
}: DeleteModalProps) {
  if (!isOpen) return null;

  const iconWrap =
    variant === 'caution'
      ? 'bg-amber-100'
      : 'bg-red-100';
  const iconClass =
    variant === 'caution'
      ? 'text-amber-600'
      : 'text-red-600';
  const confirmBtn =
    variant === 'caution'
      ? 'bg-amber-600 hover:bg-amber-700'
      : 'bg-red-600 hover:bg-red-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-8">
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0">
              <div className={`w-14 h-14 ${iconWrap} rounded-2xl flex items-center justify-center`}>
                <AlertTriangle className={`w-7 h-7 ${iconClass}`} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
              <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{message}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all ml-2 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 px-8 pb-8">
          <button
            onClick={onClose}
            className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-6 py-3 text-white rounded-xl transition-all shadow-sm font-medium ${confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
