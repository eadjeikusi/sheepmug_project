import { AlertTriangle, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** May return a Promise for async work; see `closeOnConfirm` and `isConfirming`. */
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  /** Primary action label (default: "Delete") */
  confirmLabel?: string;
  /** danger = destructive delete styling; caution = warning / remove-without-delete */
  variant?: 'danger' | 'caution';
  /** e.g. z-[200] when stacking above another modal */
  stackZClass?: string;
  /** Shows spinner on the confirm button and blocks dismiss actions. */
  isConfirming?: boolean;
  /** If false, modal stays open until `onClose` — use when `onConfirm` is async and parent closes after work. */
  closeOnConfirm?: boolean;
}

export default function DeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  variant = 'danger',
  stackZClass = 'z-50',
  isConfirming = false,
  closeOnConfirm = true,
}: DeleteModalProps) {
  if (!isOpen) return null;

  const busy = Boolean(isConfirming);

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
    <div className={`fixed inset-0 ${stackZClass} flex items-center justify-center p-4`}>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onClose();
        }}
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
            type="button"
            disabled={busy}
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all ml-2 shrink-0 disabled:opacity-50 disabled:pointer-events-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 px-8 pb-8">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all font-medium disabled:opacity-50 disabled:pointer-events-none"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                try {
                  await Promise.resolve(onConfirm());
                  if (closeOnConfirm) onClose();
                } catch {
                  /* parent may toast; keep modal open when closeOnConfirm is false */
                }
              })();
            }}
            className={`inline-flex items-center justify-center gap-2 min-w-[7.5rem] px-6 py-3 text-white rounded-xl transition-all shadow-sm font-medium disabled:opacity-70 disabled:pointer-events-none ${confirmBtn}`}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : null}
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
