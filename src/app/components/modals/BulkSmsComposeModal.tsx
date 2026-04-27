import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Send, Clock, Smartphone, Search, Users, UserCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import type { Group } from '@/types';
import { orgMessagesApi } from '@/utils/api';
import { notifyHubtelSmsPending } from '@/utils/notifyHubtelSmsPending';
import { DatePickerField, TimePickerField } from '@/components/datetime';

export type BulkSmsComposeMode = 'free' | 'group' | 'member';

export interface BulkSmsComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: BulkSmsComposeMode;
  /** Ministry / group page */
  lockedGroup?: { id: string; name: string; memberCount?: number; subgroupCount?: number };
  /** Member profile panel */
  lockedMember?: { id: string; name: string; email?: string };
  onSaved?: () => void;
}

type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly';

export default function BulkSmsComposeModal({
  isOpen,
  onClose,
  mode,
  lockedGroup,
  lockedMember,
  onSaved,
}: BulkSmsComposeModalProps) {
  const { token, authLoading } = useAuth();
  const { selectedBranch } = useBranch();

  const [subject, setSubject] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [recipientScope, setRecipientScope] = useState<'all' | 'groups'>('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [includeSubgroups, setIncludeSubgroups] = useState(true);
  const [groupSearch, setGroupSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('none');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setSubject('');
    setMessageContent('');
    setRecipientScope('all');
    setSelectedGroupIds([]);
    setIncludeSubgroups(true);
    setGroupSearch('');
    setScheduleEnabled(false);
    setScheduleDate('');
    setScheduleTime('');
    setRecurrenceFrequency('none');
    setRecurrenceEndDate('');
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    resetForm();
    if (mode === 'group' && lockedGroup?.id) {
      setSelectedGroupIds([lockedGroup.id]);
      setRecipientScope('groups');
    }
  }, [isOpen, mode, lockedGroup?.id, resetForm]);

  const loadGroups = useCallback(async () => {
    if (!token || authLoading || mode !== 'free') return;
    setGroupsLoading(true);
    try {
      const url = new URL('/api/groups', window.location.origin);
      url.searchParams.set('tree', '1');
      url.searchParams.set('include_system', '1');
      if (selectedBranch) url.searchParams.append('branch_id', selectedBranch.id);
      const res = await fetch(url.toString(), {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) throw new Error('Failed to load groups');
      const data = await res.json();
      const gArr = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
      setGroups(gArr as Group[]);
    } catch {
      toast.error('Could not load groups');
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  }, [token, authLoading, mode, selectedBranch]);

  useEffect(() => {
    if (isOpen && mode === 'free') void loadGroups();
  }, [isOpen, mode, loadGroups]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => (g.name || '').toLowerCase().includes(q));
  }, [groups, groupSearch]);

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const buildScheduledForIso = (): string | null => {
    if (!scheduleEnabled || !scheduleDate || !scheduleTime) return null;
    const d = new Date(`${scheduleDate}T${scheduleTime}`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const handleSubmit = async () => {
    if (!messageContent.trim()) {
      toast.error('Enter the SMS text');
      return;
    }

    if (mode === 'group' && !lockedGroup?.id) {
      toast.error('Missing group');
      return;
    }
    if (mode === 'member' && !lockedMember?.id) {
      toast.error('Missing member');
      return;
    }

    if (mode === 'free' && recipientScope === 'groups' && selectedGroupIds.length === 0) {
      toast.error('Select at least one group');
      return;
    }

    const scheduledFor = buildScheduledForIso();
    if (scheduleEnabled && !scheduledFor) {
      toast.error('Pick a valid date and time for scheduling');
      return;
    }
    if (scheduleEnabled && scheduledFor) {
      if (new Date(scheduledFor) <= new Date()) {
        toast.error('Schedule time must be in the future');
        return;
      }
    }

    const recurrence =
      recurrenceFrequency === 'none'
        ? { frequency: 'none' as const }
        : {
            frequency: recurrenceFrequency,
            end_date: recurrenceEndDate || null,
          };

    let recipient_scope: 'all' | 'groups' | 'member';
    let group_ids: string[] = [];
    let member_id: string | null = null;
    let include_subgroups_flag = false;

    if (mode === 'member') {
      recipient_scope = 'member';
      member_id = lockedMember!.id;
    } else if (mode === 'group') {
      recipient_scope = 'groups';
      group_ids = [lockedGroup!.id];
      include_subgroups_flag = includeSubgroups;
    } else {
      recipient_scope = recipientScope === 'all' ? 'all' : 'groups';
      group_ids = recipientScope === 'groups' ? selectedGroupIds : [];
      include_subgroups_flag = recipientScope === 'groups' ? includeSubgroups : false;
    }

    setSubmitting(true);
    try {
      await orgMessagesApi.create({
        subject: subject.trim() || null,
        content: messageContent.trim(),
        recipient_scope,
        group_ids,
        include_subgroups: include_subgroups_flag,
        member_id,
        scheduled_for: scheduledFor,
        recurrence,
      });
      toast.success(scheduledFor ? 'SMS scheduled (saved).' : 'SMS draft saved.');
      notifyHubtelSmsPending();
      onSaved?.();
      onClose();
      resetForm();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not save message');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col pointer-events-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-700 to-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">Bulk SMS</h2>
                      {mode === 'group' && lockedGroup?.memberCount != null ? (
                        <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
                          {lockedGroup.memberCount} {lockedGroup.memberCount === 1 ? 'member' : 'members'}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-white/80">
                      {mode === 'member' && lockedMember
                        ? `To: ${lockedMember.name}`
                        : mode === 'group' && lockedGroup
                          ? `To: ${lockedGroup.name}`
                          : 'Compose SMS (delivery via Hubtel — not connected yet)'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Label (Optional)</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Internal label for your list…"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">SMS text *</label>
                  <textarea
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    placeholder="Type the SMS body…"
                    rows={5}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {mode === 'free' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Send to *</label>
                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setRecipientScope('all')}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium ${
                          recipientScope === 'all'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <Users className="w-4 h-4" />
                        All members
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecipientScope('groups')}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium ${
                          recipientScope === 'groups'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <UserCircle2 className="w-4 h-4" />
                        Groups
                      </button>
                    </div>

                    {recipientScope === 'groups' && (
                      <div className="space-y-3 border border-gray-100 rounded-xl p-3 bg-gray-50">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={groupSearch}
                            onChange={(e) => setGroupSearch(e.target.value)}
                            placeholder="Search groups…"
                            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={includeSubgroups}
                            onChange={(e) => setIncludeSubgroups(e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          Include subgroups for selected groups
                        </label>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {groupsLoading ? (
                            <p className="text-sm text-gray-500 py-2">Loading groups…</p>
                          ) : (
                            filteredGroups.map((g) => (
                              <label
                                key={g.id}
                                className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer text-sm ${
                                  selectedGroupIds.includes(g.id) ? 'bg-blue-50 border border-blue-200' : 'hover:bg-white border border-transparent'
                                }`}
                                style={{ paddingLeft: g.parent_group_id ? 16 : 8 }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedGroupIds.includes(g.id)}
                                  onChange={() => toggleGroup(g.id)}
                                  className="rounded border-gray-300 text-blue-600"
                                />
                                <span className="flex-1 font-medium text-gray-900">{g.name}</span>
                                <span className="text-xs text-gray-500">{g.member_count ?? 0} members</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {mode === 'group' && lockedGroup && (
                  <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                    <p className="text-sm text-gray-700">
                      Note: this message will be sent to <span className="font-semibold">this ministry</span> and{" "}
                      <span className="font-semibold">all subgroups</span> under it.
                      {lockedGroup.memberCount != null ? (
                        <>
                          {" "}
                          <span className="text-gray-500">
                            ({lockedGroup.memberCount} {lockedGroup.memberCount === 1 ? 'member' : 'members'}
                            {lockedGroup.subgroupCount != null ? `, ${lockedGroup.subgroupCount} subgroups` : ''}
                            )
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                )}

                <div className="space-y-3 border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">Schedule</span>
                    <button
                      type="button"
                      onClick={() => setScheduleEnabled(!scheduleEnabled)}
                      className={`text-sm px-3 py-1.5 rounded-lg font-medium ${
                        scheduleEnabled ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {scheduleEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  {scheduleEnabled && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <DatePickerField
                        value={scheduleDate}
                        onChange={setScheduleDate}
                        placeholder="Send date"
                        className="min-w-[11rem]"
                        triggerClassName="rounded-lg border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-none"
                      />
                      <TimePickerField
                        value={scheduleTime}
                        onChange={setScheduleTime}
                        placeholder="Send time"
                        className="min-w-[9rem]"
                        triggerClassName="rounded-lg border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Repeat (metadata only; no auto-send yet)</label>
                    <select
                      value={recurrenceFrequency}
                      onChange={(e) => setRecurrenceFrequency(e.target.value as RecurrenceFrequency)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                    {recurrenceFrequency !== 'none' && (
                      <div className="mt-2">
                        <DatePickerField
                          value={recurrenceEndDate}
                          onChange={setRecurrenceEndDate}
                          placeholder="End date (Optional)"
                          triggerClassName="w-full rounded-lg border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 text-gray-700 border border-gray-200 rounded-xl hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scheduleEnabled ? <Clock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  {scheduleEnabled ? 'Save schedule' : 'Save SMS'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
