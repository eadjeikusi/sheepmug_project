import { useState } from 'react';
import { X, Mic, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

interface AIVoiceNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  memberName: string;
}

export default function AIVoiceNoteModal({ isOpen, onClose, memberName }: AIVoiceNoteModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high'>('medium');

  if (!isOpen) return null;

  const handleStartRecording = () => {
    setIsRecording(true);
    toast.info('Recording started... Speak now');
    
    setTimeout(() => {
      setIsRecording(false);
      setTranscribedText('Member expressed concerns about personal challenges and requested prayer support. Follow-up needed within the next week.');
      toast.success('Voice note transcribed successfully!');
    }, 3000);
  };

  const handleSave = () => {
    toast.success(`AI note saved for ${memberName} and sent to supervisor!`);
    onClose();
    setTranscribedText('');
  };

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
        className="relative bg-white rounded-3xl shadow-xl w-full max-w-lg mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-8 border-b border-gray-100">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">AI Voice Note</h2>
            <p className="text-sm text-gray-500 mt-1">For {memberName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          {/* Recording Button */}
          <div className="flex flex-col items-center">
            <button
              onClick={handleStartRecording}
              disabled={isRecording}
              className={`w-28 h-28 rounded-3xl flex items-center justify-center transition-all shadow-lg ${
                isRecording
                  ? 'bg-red-600 animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <Mic className="w-14 h-14 text-white" />
            </button>
            <p className="mt-4 text-sm text-gray-600 font-medium">
              {isRecording ? 'Recording... Speak now' : 'Click to record voice note'}
            </p>
          </div>

          {/* Transcribed Text */}
          {transcribedText && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Transcribed Text
              </label>
              <textarea
                value={transcribedText}
                onChange={(e) => setTranscribedText(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all resize-none"
                placeholder="AI transcription will appear here..."
              />
            </div>
          )}

          {/* Urgency Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Urgency Level
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setUrgency(level)}
                  className={`px-4 py-3 rounded-xl border-2 transition-all font-medium ${
                    urgency === level
                      ? level === 'high'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : level === 'medium'
                        ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                        : 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="flex items-start space-x-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-medium">AI Note Feature</p>
              <p className="mt-1 text-blue-700">
                This note will be automatically sent to the member's supervisor for review.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 px-8 pb-8 pt-6 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!transcribedText}
            className="px-6 py-3 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save & Send
          </button>
        </div>
      </motion.div>
    </div>
  );
}
