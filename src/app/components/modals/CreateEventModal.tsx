import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  X,
  Calendar,
  MapPin,
  ImagePlus,
  Users,
  Building2,
  Search,
  ChevronRight,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

export interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, event is created via `/api/events` and `onCreated` runs after success. */
  token?: string | null;
  onCreated?: () => void;
  /** Demo / legacy: fixed ministry and callback instead of API (e.g. mock GroupDetail). */
  groupId?: string;
  groupName?: string;
  onSave?: (eventData: Record<string, unknown>) => void;
}

type GroupOption = { id: string; name: string; group_type?: string | null };
type ApiEventType = { id: string; name: string; slug: string };
type OutlineTpl = { id: string; name: string; program_outline?: Record<string, unknown> | null };

const LEGACY_TYPES = [
  { slug: 'service', label: 'Service' },
  { slug: 'meeting', label: 'Meeting' },
  { slug: 'conference', label: 'Conference' },
  { slug: 'outreach', label: 'Outreach' },
  { slug: 'social', label: 'Social' },
  { slug: 'other', label: 'Other' },
] as const;

export default function CreateEventModal({
  isOpen,
  onClose,
  token = null,
  onCreated,
  groupId,
  groupName,
  onSave,
}: CreateEventModalProps) {
  const [title, setTitle] = useState('');
  /** `c:${uuid}` = organization event type; `l:${slug}` = built-in slug */
  const [typeSelection, setTypeSelection] = useState<string>('l:service');
  const [eventTypesList, setEventTypesList] = useState<ApiEventType[]>([]);
  const [outlineTemplates, setOutlineTemplates] = useState<OutlineTpl[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [programOutlineText, setProgramOutlineText] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationType, setLocationType] = useState('');
  const [locationDetails, setLocationDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [groupScope, setGroupScope] = useState<'organization' | 'group'>('organization');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const coverFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || token) return;
    if (groupId) {
      setGroupScope('group');
      setSelectedGroupId(groupId);
    }
  }, [isOpen, token, groupId]);

  useEffect(() => {
    if (!isOpen || !token) return;
    setGroupSearch('');
    setGroupPickerOpen(false);
    let cancelled = false;
    (async () => {
      setLoadingGroups(true);
      try {
        const [grRes, etRes] = await Promise.all([
          fetch('/api/groups?tree=1', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/event-types', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const gData = await grRes.json().catch(() => []);
        if (!grRes.ok) {
          throw new Error((gData as { error?: string }).error || 'Could not load ministries');
        }
        const list = Array.isArray(gData)
          ? gData.map((g: { id: string; name: string; group_type?: string | null }) => ({
              id: g.id,
              name: g.name,
              group_type: g.group_type,
            }))
          : [];
        const etBody = await etRes.json().catch(() => []);
        const types: ApiEventType[] = etRes.ok && Array.isArray(etBody)
          ? etBody.map((r: { id: string; name: string; slug: string }) => ({
              id: r.id,
              name: r.name,
              slug: r.slug,
            }))
          : [];
        if (!cancelled) {
          setGroups(list.sort((a, b) => a.name.localeCompare(b.name)));
          setEventTypesList(types);
          if (types.length) {
            setTypeSelection((prev) => {
              if (prev.startsWith('c:') && types.some((t) => `c:${t.id}` === prev)) return prev;
              return `c:${types[0].id}`;
            });
          } else {
            setTypeSelection((prev) => (prev.startsWith('l:') ? prev : 'l:service'));
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Could not load ministries');
          setGroups([]);
          setEventTypesList([]);
        }
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token]);

  const selectedCustomTypeId = typeSelection.startsWith('c:') ? typeSelection.slice(2) : '';

  useEffect(() => {
    if (!isOpen || !token || !selectedCustomTypeId) {
      setOutlineTemplates([]);
      setTemplateId('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/event-outline-templates?event_type_id=${encodeURIComponent(selectedCustomTypeId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json().catch(() => []);
        if (!res.ok) {
          throw new Error((data as { error?: string }).error || 'Could not load templates');
        }
        const list = Array.isArray(data)
          ? data.map((r: { id: string; name: string; program_outline?: Record<string, unknown> | null }) => ({
              id: r.id,
              name: r.name,
              program_outline: r.program_outline ?? {},
            }))
          : [];
        if (!cancelled) {
          setOutlineTemplates(list);
          setTemplateId('');
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setOutlineTemplates([]);
          toast.error(e instanceof Error ? e.message : 'Could not load templates');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, selectedCustomTypeId]);

  useEffect(() => {
    if (!isOpen) return;
    const t = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (groupPickerOpen) setGroupPickerOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [isOpen, onClose, groupPickerOpen]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || (g.group_type && g.group_type.toLowerCase().includes(q))
    );
  }, [groups, groupSearch]);

  const selectedGroupLabel = useMemo(() => {
    if (groupScope !== 'group' || !selectedGroupId) return '';
    return groups.find((g) => g.id === selectedGroupId)?.name || '';
  }, [groupScope, selectedGroupId, groups]);

  const resetForm = () => {
    setTitle('');
    setTypeSelection(eventTypesList.length ? `c:${eventTypesList[0].id}` : 'l:service');
    setTemplateId('');
    setProgramOutlineText('');
    setStartTime('');
    setEndTime('');
    setLocationType('');
    setLocationDetails('');
    setNotes('');
    setCoverImageUrl('');
    setCoverUploading(false);
    setGroupScope('organization');
    setSelectedGroupId('');
  };

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setCoverUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Upload failed');
      }
      const url = (data as { url?: string }).url;
      if (!url) throw new Error('No image URL returned');
      setCoverImageUrl(url);
      toast.success('Cover image uploaded');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setCoverUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Enter an event title');
      return;
    }
    if (!startTime) {
      toast.error('Choose a start date and time');
      return;
    }
    if (groupScope === 'group' && !selectedGroupId) {
      toast.error('Choose a ministry or switch to organization-wide');
      return;
    }

    const startIso = new Date(startTime).toISOString();
    let endIso: string | null = null;
    if (endTime) {
      const end = new Date(endTime);
      if (Number.isNaN(end.getTime())) {
        toast.error('Invalid end time');
        return;
      }
      endIso = end.toISOString();
    }

    let eventTypeSlug: string | null = null;
    if (typeSelection.startsWith('c:')) {
      const id = typeSelection.slice(2);
      const t = eventTypesList.find((x) => x.id === id);
      eventTypeSlug = t?.slug ?? null;
    } else if (typeSelection.startsWith('l:')) {
      eventTypeSlug = typeSelection.slice(2) || null;
    }

    let program_outline: Record<string, unknown> | undefined;
    const pot = programOutlineText.trim();
    if (pot) {
      try {
        const parsed = JSON.parse(pot) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.error('Program outline must be a JSON object');
          return;
        }
        program_outline = parsed as Record<string, unknown>;
      } catch {
        toast.error('Program outline is not valid JSON');
        return;
      }
    }

    if (onSave && !token) {
      onSave({
        title: title.trim(),
        start_time: startIso,
        end_time: endIso,
        event_type: eventTypeSlug,
        location_type: locationType.trim() || null,
        location_details: locationDetails.trim() || null,
        notes: notes.trim() || null,
        cover_image_url: coverImageUrl.trim() || null,
        group_scope: groupScope,
        group_id: groupScope === 'group' ? selectedGroupId : null,
        groupName: groupName ?? null,
        ...(program_outline !== undefined ? { program_outline } : {}),
      });
      resetForm();
      onClose();
      return;
    }

    if (!token) {
      toast.error('Sign in required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          start_time: startIso,
          end_time: endIso,
          event_type: eventTypeSlug,
          location_type: locationType.trim() || null,
          location_details: locationDetails.trim() || null,
          notes: notes.trim() || null,
          cover_image_url: coverImageUrl.trim() || null,
          group_scope: groupScope,
          group_id: groupScope === 'group' ? selectedGroupId : null,
          ...(program_outline !== undefined ? { program_outline } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Could not create event');
      }
      toast.success('Event created');
      resetForm();
      onCreated?.();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={() => (groupPickerOpen ? setGroupPickerOpen(false) : onClose())}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-event-title"
        className="fixed left-1/2 top-1/2 z-[120] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 max-h-[min(92vh,900px)] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="create-event-title" className="text-lg font-semibold text-white truncate">
                New event
              </h2>
              <p className="text-xs text-white/85">Add to your calendar and optional ministry</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-white/90 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 p-5">
          <div>
            <label htmlFor="ev-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Title
            </label>
            <input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Youth night"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ev-type" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Type
              </label>
              <select
                id="ev-type"
                value={typeSelection}
                onChange={(e) => {
                  setTypeSelection(e.target.value);
                  setTemplateId('');
                  setProgramOutlineText('');
                }}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                {eventTypesList.length > 0 && (
                  <optgroup label="Your event types">
                    {eventTypesList.map((t) => (
                      <option key={t.id} value={`c:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Built-in">
                  {LEGACY_TYPES.map((t) => (
                    <option key={t.slug} value={`l:${t.slug}`}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label
                htmlFor="ev-loc-type"
                className="block text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                Location type
              </label>
              <select
                id="ev-loc-type"
                value={locationType}
                onChange={(e) => setLocationType(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">— Not set —</option>
                <option value="on_site">On-site</option>
                <option value="online">Online</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Program outline</p>
            <p className="text-xs text-indigo-900/75">
              {selectedCustomTypeId
                ? 'Optional: apply a saved template for this event type, then edit the JSON if needed.'
                : 'Optional JSON program structure (no saved templates for built-in types).'}
            </p>
            {selectedCustomTypeId && outlineTemplates.length > 0 && (
              <div>
                <label
                  htmlFor="ev-template"
                  className="block text-xs font-semibold text-gray-500 uppercase tracking-wide"
                >
                  Template
                </label>
                <select
                  id="ev-template"
                  value={templateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTemplateId(id);
                    const tpl = outlineTemplates.find((x) => x.id === id);
                    if (tpl?.program_outline) {
                      setProgramOutlineText(JSON.stringify(tpl.program_outline, null, 2));
                    }
                  }}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">— None — start from scratch</option>
                  {outlineTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label
                htmlFor="ev-outline"
                className="block text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                JSON object
              </label>
              <textarea
                id="ev-outline"
                value={programOutlineText}
                onChange={(e) => setProgramOutlineText(e.target.value)}
                spellCheck={false}
                rows={5}
                placeholder='e.g. { "sections": [ { "title": "Welcome", "minutes": 5 } ] }'
                className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="ev-start"
                className="block text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                Starts
              </label>
              <input
                id="ev-start"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>
            <div>
              <label htmlFor="ev-end" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Ends <span className="font-normal normal-case text-gray-400">(optional)</span>
              </label>
              <input
                id="ev-end"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ev-loc-details"
              className="block text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Location details
              </span>
            </label>
            <input
              id="ev-loc-details"
              value={locationDetails}
              onChange={(e) => setLocationDetails(e.target.value)}
              placeholder="Room, address, or meeting link"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label htmlFor="ev-notes" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Notes
            </label>
            <textarea
              id="ev-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes…"
              className="mt-1.5 w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              <span className="inline-flex items-center gap-1">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                Cover image
              </span>
            </p>
            <input
              ref={coverFileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void handleCoverFileChange(e)}
            />
            <div className="mt-1.5 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-4">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-stretch">
                <div className="flex h-28 w-full max-w-[200px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 ring-1 ring-black/5 sm:h-24 sm:w-40">
                  {coverUploading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-500" aria-hidden />
                  ) : coverImageUrl ? (
                    <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-10 w-10 text-gray-300" aria-hidden />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 text-center sm:text-left">
                  <p className="text-xs text-gray-500">
                    JPG, PNG, or WebP — resized automatically (max ~800px) for fast loading.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <button
                      type="button"
                      disabled={coverUploading}
                      onClick={() => coverFileRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {coverUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Upload className="h-4 w-4" aria-hidden />
                      )}
                      {coverImageUrl ? 'Replace image' : 'Upload image'}
                    </button>
                    {coverImageUrl && !coverUploading && (
                      <button
                        type="button"
                        onClick={() => setCoverImageUrl('')}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-800 flex items-center gap-2">
              <Users className="h-3.5 w-3.5" />
              Assignment
            </p>
            <p className="mt-1 text-xs text-violet-900/70">
              Organization-wide events are visible for the whole church; ministry-specific ties this event to one
              group.
            </p>

            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent bg-white/70 p-3 has-[:checked]:border-violet-300 has-[:checked]:bg-white">
                <input
                  type="radio"
                  name="groupScope"
                  className="mt-0.5 h-4 w-4 text-indigo-600"
                  checked={groupScope === 'organization'}
                  onChange={() => {
                    setGroupScope('organization');
                    setSelectedGroupId('');
                  }}
                />
                <span>
                  <span className="text-sm font-medium text-gray-900">Entire organization</span>
                  <span className="mt-0.5 block text-xs text-gray-500">All groups — not tied to one ministry</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent bg-white/70 p-3 has-[:checked]:border-violet-300 has-[:checked]:bg-white">
                <input
                  type="radio"
                  name="groupScope"
                  className="mt-0.5 h-4 w-4 text-indigo-600"
                  checked={groupScope === 'group'}
                  onChange={() => setGroupScope('group')}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-900">Specific ministry</span>
                  <span className="mt-0.5 block text-xs text-gray-500">Link this event to one group</span>
                </span>
              </label>
            </div>

            {groupScope === 'group' && (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setGroupPickerOpen(true)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-left text-sm text-gray-900 shadow-sm hover:bg-violet-50/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-violet-600" />
                    <span className="truncate">
                      {selectedGroupId ? selectedGroupLabel || 'Selected ministry' : 'Choose ministry…'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Create event'}
            </button>
          </div>
        </form>
      </div>

      {groupPickerOpen && (
        <>
          <div
            className="fixed inset-0 z-[130] bg-black/40"
            aria-hidden
            onClick={() => setGroupPickerOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-[140] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">Choose ministry</p>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setGroupPickerOpen(false)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="Search ministries…"
                  className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  autoFocus
                />
              </label>
            </div>
            <div className="max-h-64 overflow-y-auto border-t border-gray-100 px-2 py-1">
              {loadingGroups ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : filteredGroups.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No ministries match.</p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredGroups.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGroupId(g.id);
                          setGroupPickerOpen(false);
                        }}
                        className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                          selectedGroupId === g.id ? 'bg-indigo-50 font-medium text-indigo-900' : 'text-gray-800'
                        }`}
                      >
                        <span className="truncate">{g.name}</span>
                        {g.group_type && (
                          <span className="ml-2 shrink-0 text-xs text-gray-500">({g.group_type})</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
