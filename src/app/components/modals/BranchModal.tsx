import { useState, useEffect, useMemo } from 'react';
import { X, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

/** Minimal payload — only the branch display name is collected in the UI. */
export interface BranchFormPayload {
  id?: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  timezone?: string;
  important_dates_default_reminder_time?: string;
}

interface BranchModalProps {
  branch?: BranchFormPayload | null;
  organizationId: string;
  onClose: () => void;
  onSave: (branch: BranchFormPayload) => void;
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'Africa/Accra',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function formatUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

function timezoneOffsetMinutes(timezone: string, at: Date): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = formatter.formatToParts(at);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = Number(byType.get('year'));
    const month = Number(byType.get('month'));
    const day = Number(byType.get('day'));
    const hour = Number(byType.get('hour'));
    const minute = Number(byType.get('minute'));
    const second = Number(byType.get('second'));
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

export default function BranchModal({ branch, organizationId, onClose, onSave }: BranchModalProps) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Africa/Accra');
  const [timezoneQuery, setTimezoneQuery] = useState('');
  const [reminderTime, setReminderTime] = useState('08:00');
  const [nameError, setNameError] = useState('');

  const timezoneOptions = useMemo(() => {
    const now = new Date();
    const intlWithSupported = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
    const values = typeof intlWithSupported.supportedValuesOf === 'function'
      ? intlWithSupported.supportedValuesOf('timeZone')
      : FALLBACK_TIMEZONES;
    return values
      .map((value) => {
        const offset = timezoneOffsetMinutes(value, now);
        return {
          value,
          offset: offset ?? 0,
          label: `${value} (${formatUtcOffset(offset ?? 0)})`,
        };
      })
      .sort((a, b) => (a.offset - b.offset) || a.value.localeCompare(b.value));
  }, []);

  const filteredTimezoneOptions = useMemo(() => {
    const query = timezoneQuery.trim().toLowerCase();
    if (!query) return timezoneOptions;
    return timezoneOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [timezoneOptions, timezoneQuery]);

  useEffect(() => {
    if (branch) {
      setName(branch.name || '');
      setTimezone(branch.timezone || 'Africa/Accra');
      setTimezoneQuery('');
      setReminderTime((branch.important_dates_default_reminder_time || '08:00').slice(0, 5));
    } else {
      setName('');
      setTimezone('Africa/Accra');
      setTimezoneQuery('');
      setReminderTime('08:00');
    }
    setNameError('');
  }, [branch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) {
      toast.error('Authentication required. Please log in again.');
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Branch name is required');
      toast.error('Please enter a branch name');
      return;
    }
    setNameError('');
    onSave({
      id: branch?.id,
      organization_id: organizationId,
      name: trimmed,
      is_active: branch?.is_active !== false,
      timezone: timezone.trim() || 'Africa/Accra',
      important_dates_default_reminder_time: reminderTime || '08:00',
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {branch ? 'Edit Branch' : 'Create New Branch'}
                </h2>
                {!branch ? (
                  <p className="text-sm text-gray-500">
                    Add another branch to your organization
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="px-6 py-6">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Branch name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError('');
                }}
                placeholder="e.g., Youth Campus"
                autoFocus
                className={`w-full px-4 py-2.5 border ${
                  nameError ? 'border-red-300' : 'border-gray-200'
                } rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all`}
              />
              {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
              {!branch ? (
                <p className="text-xs text-gray-500 mt-3">
                  Members, events, and groups are scoped to the branch you select in the header.
                </p>
              ) : null}
              <label className="block text-sm font-medium text-gray-700 mt-5 mb-1.5">
                Timezone
              </label>
              <input
                type="text"
                value={timezoneQuery}
                onChange={(e) => setTimezoneQuery(e.target.value)}
                placeholder="Search timezone or UTC offset (e.g. +03:00)"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all mb-2"
              />
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
              >
                {filteredTimezoneOptions.length > 0 ? (
                  filteredTimezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                ) : (
                  <option value={timezone}>{timezone}</option>
                )}
              </select>
              {!branch ? (
                <p className="text-xs text-gray-500 mt-1">
                  Used for important-date reminders and local date checks in this branch.
                </p>
              ) : null}
              <label className="block text-sm font-medium text-gray-700 mt-4 mb-1.5">
                Default reminder time
              </label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
              />
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center space-x-2"
              >
                <Building2 className="w-4 h-4" />
                <span>{branch ? 'Save' : 'Create branch'}</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
