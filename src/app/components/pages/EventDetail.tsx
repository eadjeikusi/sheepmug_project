import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Image as ImageIcon,
  Plus,
  Pencil,
  Users,
  UserCheck,
  BarChart3,
  FileText,
  Paperclip,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import {
  downloadEventAttachmentFile,
  eventAttachmentStoragePath,
} from '../../utils/downloadEventAttachment';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import type { EventAttachmentItem, EventRow } from './Events';
import CreateEventModal from '../modals/CreateEventModal';
import {
  documentFromProgramOutline,
  computeTotalUsedMinutes,
  formatHoursMinutes,
  activityEffectiveMinutes,
  type ProgramItemDraft,
  type ProgramOutlineDocument,
} from './ProgramOutlineAccordionEditor';
import EventAttendanceTab from './EventAttendanceTab';
import { useCustomFieldDefinitions } from '../../hooks/useCustomFieldDefinitions';
import { CustomFieldsReadOnlyList } from '../CustomFieldsSection';
import { capitalizeSentencesForUi } from '@/utils/sentenceCaseDisplay';
import { displayTitleWords } from '@/utils/displayText';
import { formatLongWeekdayDateTime, formatCalendarCountdown } from '@/utils/dateDisplayFormat';
import { locationModeDisplayLabel, normalizeLocationTypeInput } from '@/utils/eventLocation';

/** Typography aligned with dashboard-style settings pages */
const type = {
  eyebrow: 'text-[10px] font-semibold text-gray-400 sm:text-[11px]',
  label: 'text-xs font-medium text-gray-500',
  mini: 'text-[11px] leading-snug text-gray-500',
  body: 'text-sm font-normal leading-relaxed text-gray-700',
  bodyMuted: 'text-sm font-normal text-gray-500',
  value: 'text-sm font-semibold text-gray-900',
  valueLg: 'text-base font-semibold text-gray-900',
  cardTitle: 'text-lg font-semibold text-gray-900',
  pageTitle: 'text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.65rem]',
  stat: 'text-2xl font-semibold tabular-nums text-gray-900 sm:text-3xl',
} as const;

const cardBase = 'rounded-2xl border border-gray-100 bg-white shadow-sm';

function typeBadgeClass(t: string | null | undefined) {
  const x = (t || '').toLowerCase();
  if (x === 'service') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (x === 'meeting') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (x === 'conference') return 'bg-amber-50 text-amber-900 border-amber-200';
  if (x === 'outreach') return 'bg-blue-50 text-blue-900 border-blue-200';
  if (x === 'social') return 'bg-pink-50 text-pink-900 border-pink-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function isHexColor(c: string | null | undefined): c is string {
  if (!c || typeof c !== 'string') return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

function eventDurationLabel(startIso: string, endIso: string | null | undefined): string | null {
  if (!endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  const mins = Math.round((b - a) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

interface EventTypeRow {
  id: string;
  slug: string;
  name: string;
  color?: string | null;
}

function FieldBlock({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className={type.label}>{label}</p>
      {description ? <p className={type.mini}>{description}</p> : null}
      <div className={type.value}>{children}</div>
    </div>
  );
}

function SectionRule() {
  return <div className="my-6 h-px w-full bg-gray-100" role="presentation" />;
}

function MainCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${cardBase} p-6 sm:p-8 ${className}`}>{children}</div>;
}

function activityRowVisible(it: ProgramItemDraft): boolean {
  const mins = activityEffectiveMinutes(it);
  return Boolean(
    it.title.trim() || it.speaker.trim() || it.start_time || it.duration_minutes || mins > 0,
  );
}

function activityHasMoreDetail(it: ProgramItemDraft): boolean {
  if (it.speaker.trim() || it.location.trim() || it.notes.trim()) return true;
  if (it.start_time || it.end_time) return true;
  const d = it.duration_minutes.trim();
  return Boolean(d && !Number.isNaN(Number(d)) && Number(d) > 0);
}

const partBadgeTones = [
  'bg-amber-100 text-amber-900',
  'bg-sky-100 text-sky-900',
  'bg-rose-100 text-rose-900',
  'bg-blue-100 text-blue-900',
] as const;

function PartNumberBadge({ n, toneIndex }: { n: number; toneIndex: number }) {
  const tone = partBadgeTones[toneIndex % partBadgeTones.length];
  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${tone}`}
    >
      {n}
    </div>
  );
}

function ActivityNumberBadge({ n }: { n: number }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-700">
      {n}
    </div>
  );
}

function formatAttachmentBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeEventAttachments(raw: unknown): EventAttachmentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: EventAttachmentItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const storage_path = typeof o.storage_path === 'string' ? o.storage_path.trim() : '';
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name || (!storage_path && !url)) continue;
    const row: EventAttachmentItem = { name };
    if (storage_path) row.storage_path = storage_path;
    if (url) row.url = url;
    if (typeof o.size_bytes === 'number' && Number.isFinite(o.size_bytes)) row.size_bytes = o.size_bytes;
    if (typeof o.content_type === 'string') row.content_type = o.content_type || null;
    if (typeof o.uploaded_at === 'string') row.uploaded_at = o.uploaded_at || null;
    out.push(row);
  }
  return out;
}

function ExpandCircleToggle() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors group-data-[state=open]:border-gray-300 group-data-[state=open]:bg-gray-50 group-data-[state=open]:text-gray-700">
      <Plus className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-45" strokeWidth={2} />
    </span>
  );
}

function ActivityExpandToggle() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors group-data-[state=open]:border-gray-300 group-data-[state=open]:bg-gray-50">
      <Plus className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-45" strokeWidth={2} />
    </span>
  );
}

function ActivityDetailPanel({ it }: { it: ProgramItemDraft }) {
  const lines: { label: string; value: string }[] = [];
  if (it.start_time || it.end_time) {
    lines.push({
      label: 'Time',
      value: `${it.start_time || '—'}${it.end_time ? ` – ${it.end_time}` : ''}`,
    });
  }
  const d = it.duration_minutes.trim();
  if (d && !Number.isNaN(Number(d)) && Number(d) > 0) {
    lines.push({ label: 'Duration', value: formatHoursMinutes(Number(d)) });
  }
  if (it.speaker.trim()) lines.push({ label: 'Speaker', value: it.speaker.trim() });
  if (it.location.trim()) lines.push({ label: 'Place', value: it.location.trim() });
  if (it.notes.trim()) lines.push({ label: 'Notes', value: it.notes.trim() });
  const eff = activityEffectiveMinutes(it);
  if (eff > 0 && !lines.some((l) => l.label === 'Duration')) {
    lines.push({ label: 'Duration', value: formatHoursMinutes(eff) });
  }

  return (
    <div className="space-y-2 border-t border-gray-100 bg-white px-4 py-3">
      {lines.map((row) => (
        <div key={row.label}>
          <p className={type.label}>{row.label}</p>
          <p className={'mt-0.5 whitespace-pre-wrap text-sm text-gray-900'}>
            {row.label === 'Notes' ? capitalizeSentencesForUi(row.value) : row.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProgramReadOnly({ doc }: { doc: ProgramOutlineDocument }) {
  const hasContent = doc.sections.some(
    (s) =>
      s.title.trim() || s.items.some((it) => activityRowVisible(it)),
  );
  if (!hasContent) {
    return <p className={type.bodyMuted}>No program items yet. Edit the event to add parts and activities.</p>;
  }
  return (
    <Accordion type="multiple" className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white">
      {doc.sections.map((section, si) => {
        const partTitle = section.title.trim() || `Part ${si + 1}`;
        const partTime =
          section.start_time || section.end_time
            ? `${section.start_time || ''}${section.end_time ? ` – ${section.end_time}` : ''}`.trim()
            : '';
        const visible = section.items.filter(activityRowVisible);
        const noteExcerpt = section.notes.trim();
        const partSubtitle = partTime
          ? noteExcerpt
            ? `${partTime} · ${noteExcerpt.length > 72 ? `${noteExcerpt.slice(0, 72)}…` : noteExcerpt}`
            : partTime
          : noteExcerpt
            ? noteExcerpt.length > 100
              ? `${noteExcerpt.slice(0, 100)}…`
              : noteExcerpt
            : visible.length > 0
              ? `${visible.length} activit${visible.length === 1 ? 'y' : 'ies'} in this part`
              : 'No activities in this part yet';

        let activityOrdinal = 0;
        return (
          <AccordionItem
            key={section.id || `section-${si}`}
            value={`part-${si}-${section.id || ''}`}
            className="border-0 border-b border-gray-100 last:border-b-0"
          >
            <AccordionTrigger
              className="group flex w-full items-center gap-4 px-4 py-4 hover:bg-gray-50/70 hover:no-underline [&>svg]:hidden"
            >
              <PartNumberBadge n={si + 1} toneIndex={si} />
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[15px] font-semibold leading-snug text-gray-900">{partTitle}</p>
                <p className="mt-1 text-sm leading-snug text-gray-500">{partSubtitle}</p>
              </div>
              <ExpandCircleToggle />
            </AccordionTrigger>
            <AccordionContent className="bg-slate-50/50 pb-0">
              {visible.length === 0 ? (
                <p className={'border-t border-gray-100 px-4 py-4 text-sm text-gray-500'}>
                  No activities in this part.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {section.items.map((it, ii) => {
                    if (!activityRowVisible(it)) return null;
                    activityOrdinal += 1;
                    const mins = activityEffectiveMinutes(it);
                    const title = it.title.trim() || `Activity ${ii + 1}`;
                    const expandable = activityHasMoreDetail(it);
                    const activityHint =
                      mins > 0
                        ? formatHoursMinutes(mins)
                        : it.start_time
                          ? `${it.start_time}${it.end_time ? ` – ${it.end_time}` : ''}`
                          : null;

                    if (!expandable) {
                      return (
                        <li key={it.id || ii}>
                          <div className="flex items-center gap-3 px-4 py-3.5">
                            <ActivityNumberBadge n={activityOrdinal} />
                            <div className="min-w-0 flex-1 text-left">
                              <p className="text-sm font-semibold text-gray-900">{title}</p>
                              {activityHint ? (
                                <p className="mt-0.5 text-xs text-gray-500">{activityHint}</p>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={it.id || ii} className="list-none">
                        <Collapsible className="group">
                          <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/80">
                            <ActivityNumberBadge n={activityOrdinal} />
                            <div className="min-w-0 flex-1 text-left">
                              <p className="text-sm font-semibold text-gray-900">{title}</p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {activityHint || 'Tap + for full details'}
                              </p>
                            </div>
                            <ActivityExpandToggle />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <ActivityDetailPanel it={it} />
                          </CollapsibleContent>
                        </Collapsible>
                      </li>
                    );
                  })}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [coverLightboxOpen, setCoverLightboxOpen] = useState(false);
  const { definitions: eventCustomFieldDefs } = useCustomFieldDefinitions('event', Boolean(event && token));

  const load = useCallback(async () => {
    if (!token || !eventId) {
      setEvent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to load event');
      }
      setEvent(data as EventRow);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load event');
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [token, eventId, selectedBranch?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) {
      setEventTypes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/event-types', {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data) || cancelled) return;
        setEventTypes(
          data.map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ''),
            slug: String(row.slug ?? ''),
            name: String(row.name ?? row.slug ?? ''),
            color: typeof row.color === 'string' ? row.color : null,
          })),
        );
      } catch {
        if (!cancelled) setEventTypes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selectedBranch?.id]);

  const typeMeta = useMemo(() => {
    const slug = (event?.event_type || '').trim().toLowerCase();
    if (!slug) return null;
    return eventTypes.find((t) => t.slug.toLowerCase() === slug) ?? null;
  }, [event?.event_type, eventTypes]);

  const typeLabel = displayTitleWords(
    typeMeta?.name || (event?.event_type ? event.event_type.replace(/-/g, ' ') : 'Event'),
  );
  const outlineDoc = useMemo(
    () => documentFromProgramOutline(event?.program_outline ?? {}),
    [event?.program_outline],
  );
  const programMinutes = useMemo(() => computeTotalUsedMinutes(outlineDoc), [outlineDoc]);
  const partCount = outlineDoc.sections.length;
  const activityCount = useMemo(
    () => outlineDoc.sections.reduce((n, s) => n + s.items.length, 0),
    [outlineDoc.sections],
  );

  const eventAttachmentsList = useMemo(() => normalizeEventAttachments(event?.attachments), [event?.attachments]);

  const g = event?.groups && typeof event.groups === 'object' && !Array.isArray(event.groups) ? event.groups : null;
  const ministryName = event?.group_id ? g?.name?.trim() || 'Ministry' : null;
  const linkedMinistries =
    event && Array.isArray(event.linked_groups) && event.linked_groups.length > 0
      ? event.linked_groups
      : event?.group_id && ministryName
        ? [{ id: event.group_id, name: ministryName }]
        : [];
  const hasAttendanceAudience =
    linkedMinistries.length > 0 || (event?.assigned_member_ids?.length ?? 0) > 0;
  const locModeLabel = event?.location_type
    ? locationModeDisplayLabel(normalizeLocationTypeInput(event.location_type) || event.location_type)
    : '';

  if (!eventId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 px-4 py-16 text-center">
        <p className={type.bodyMuted}>Invalid event link.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center bg-gray-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600" />
        <p className={'mt-4 ' + type.bodyMuted}>Loading event…</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className={type.body}>We couldn’t find that event.</p>
        <Link
          to="/events"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to events
        </Link>
      </div>
    );
  }

  const duration = eventDurationLabel(event.start_time, event.end_time);
  const startCountdown = formatCalendarCountdown(event.start_time);
  const typeColor = typeMeta?.color;

  const tabTriggerBase =
    'group relative rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-medium text-gray-500 shadow-none transition-colors hover:text-gray-800 data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none';

  return (
    <div className="min-h-0 bg-gray-50 pb-16">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-8 flex flex-col gap-4 border-b border-gray-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className={'inline-flex shrink-0 items-center gap-1.5 ' + type.bodyMuted + ' hover:text-gray-900'}
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back
            </button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-wrap items-center gap-1 border-l border-gray-200 pl-3 sm:pl-4"
            >
              <Link to="/events" className={'shrink-0 text-xs font-medium text-gray-400 hover:text-gray-600'}>
                Events
              </Link>
              <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
              <span className={'min-w-0 max-w-[min(100%,28rem)] truncate text-xs font-semibold text-gray-700'}>
                {displayTitleWords(event.title)}
              </span>
            </nav>
          </div>
          <button
            type="button"
            onClick={() => setEditModalOpen(true)}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit Event
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Left — profile-style column (~⅓) */}
          <aside className="lg:col-span-4">
            <div className={`${cardBase} p-6 lg:sticky lg:top-6`}>
              {/* Cover */}
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-gray-100">
                {event.cover_image_url?.trim() ? (
                  <button
                    type="button"
                    onClick={() => setCoverLightboxOpen(true)}
                    className="group relative block h-full w-full overflow-hidden rounded-2xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    aria-label="View cover image at full size"
                  >
                    <img
                      src={event.cover_image_url.trim()}
                      alt={event.title ? `Cover: ${event.title}` : 'Event cover'}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                    <span
                      className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400">
                    <ImageIcon className="h-12 w-12 opacity-35" strokeWidth={1.25} />
                    <span className={type.eyebrow}>No cover image</span>
                  </div>
                )}
              </div>

              <h1 className={'mt-6 ' + type.pageTitle}>{displayTitleWords(event.title)}</h1>
            </div>
          </aside>

          {/* Right — tabbed main card */}
          <div className="min-w-0 lg:col-span-8">
            <MainCard className="overflow-hidden p-0">
              <Tabs defaultValue="details" className="gap-0">
                <div className="border-b border-gray-100 px-6 pt-2 sm:px-8">
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-x-6 gap-y-0 rounded-none border-0 bg-transparent p-0">
                    <TabsTrigger value="details" className={tabTriggerBase}>
                      <FileText className="mr-1.5 h-4 w-4 opacity-60 group-data-[state=active]:opacity-100" />
                      Details
                    </TabsTrigger>
                    <TabsTrigger value="program" className={tabTriggerBase}>
                      <ClipboardList className="mr-1.5 h-4 w-4 opacity-60 group-data-[state=active]:opacity-100" />
                      Program
                    </TabsTrigger>
                    <TabsTrigger value="files" className={tabTriggerBase}>
                      <Paperclip className="mr-1.5 h-4 w-4 opacity-60 group-data-[state=active]:opacity-100" />
                      Files
                    </TabsTrigger>
                    <TabsTrigger value="group" className={tabTriggerBase}>
                      <Users className="mr-1.5 h-4 w-4 opacity-60 group-data-[state=active]:opacity-100" />
                      Group
                    </TabsTrigger>
                    <TabsTrigger value="attendance" className={tabTriggerBase}>
                      <UserCheck className="mr-1.5 h-4 w-4 opacity-60 group-data-[state=active]:opacity-100" />
                      Attendance
                    </TabsTrigger>
                    <TabsTrigger value="stats" className={tabTriggerBase}>
                      <BarChart3 className="mr-1.5 h-4 w-4 opacity-60 group-data-[state=active]:opacity-100" />
                      Stats
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="details" className="m-0 px-6 py-5 sm:px-8 sm:py-6">
                  <div className="space-y-5">
                    <div>
                      <p className={type.eyebrow + ' mb-2'}>Type</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {isHexColor(typeColor) ? (
                          <span
                            className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                            style={{
                              backgroundColor: `${typeColor}18`,
                              color: typeColor,
                              borderColor: `${typeColor}44`,
                            }}
                          >
                            {typeLabel}
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeBadgeClass(event.event_type)}`}
                          >
                            {typeLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="h-px w-full bg-gray-100" role="presentation" />

                    <div>
                      <p className={type.eyebrow + ' mb-3'}>When & where</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                        <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                          <p className={type.label}>Start</p>
                          <p className={'mt-0.5 text-sm font-semibold text-gray-900'}>
                            {formatLongWeekdayDateTime(event.start_time) || '—'}
                          </p>
                          {startCountdown ? <p className={'mt-0.5 ' + type.mini}>{startCountdown}</p> : null}
                        </div>
                        <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                          <p className={type.label}>End</p>
                          <p className={'mt-0.5 text-sm font-semibold text-gray-900'}>
                            {event.end_time ? formatLongWeekdayDateTime(event.end_time) || '—' : '—'}
                          </p>
                          {duration ? <p className={'mt-1 ' + type.mini}>{duration}</p> : null}
                        </div>
                        <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 sm:col-span-2">
                          <p className={type.label}>Location</p>
                          {locModeLabel ? (
                            <p className={'mt-0.5 text-sm font-semibold text-gray-900'}>{locModeLabel}</p>
                          ) : null}
                          {event.location_details?.trim() ? (
                            <p className={'mt-1 text-sm text-gray-800'}>
                              {displayTitleWords(event.location_details.trim())}
                            </p>
                          ) : null}
                          {event.online_meeting_url?.trim() ? (
                            <a
                              href={event.online_meeting_url.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 block break-all text-sm font-medium text-blue-600 hover:text-blue-800"
                            >
                              {event.online_meeting_url.trim()}
                            </a>
                          ) : null}
                          {!locModeLabel && !event.location_details?.trim() && !event.online_meeting_url?.trim() ? (
                            <p className={'mt-0.5 text-sm text-gray-500'}>—</p>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="h-px w-full bg-gray-100" role="presentation" />

                    <div>
                      <p className={type.eyebrow + ' mb-2'}>About Event</p>
                      {event.notes?.trim() ? (
                        <p className={`${type.body} whitespace-pre-wrap`}>
                          {capitalizeSentencesForUi(event.notes.trim())}
                        </p>
                      ) : (
                        <p className={type.bodyMuted}>No description added yet.</p>
                      )}
                    </div>

                    {eventCustomFieldDefs.length > 0 ? (
                      <>
                        <div className="h-px w-full bg-gray-100" role="presentation" />
                        <div>
                          <p className={type.eyebrow + ' mb-3'}>Additional fields</p>
                          <CustomFieldsReadOnlyList
                            definitions={eventCustomFieldDefs}
                            values={event.custom_fields}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent value="program" className="m-0 px-6 py-5 sm:px-8 sm:py-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className={type.eyebrow}>Program</p>
                    {programMinutes > 0 ? (
                      <p
                        className={`${type.eyebrow} font-normal normal-case tracking-normal text-gray-500 tabular-nums`}
                      >
                        {formatHoursMinutes(programMinutes)} total
                      </p>
                    ) : null}
                  </div>
                  <p className={'mt-1 ' + type.mini}>
                    Open each part for activities. Expand an activity to see times, speaker, and notes.
                  </p>
                  <div className="mt-4">
                    <ProgramReadOnly doc={outlineDoc} />
                  </div>
                </TabsContent>

                <TabsContent value="files" className="m-0 px-6 py-5 sm:px-8 sm:py-6">
                  <p className={type.eyebrow}>Attachments</p>
                  <p className={'mt-1 ' + type.mini}>
                    Download copies use the original file names. Files are served from this app, not raw storage URLs.
                  </p>
                  {eventAttachmentsList.length === 0 ? (
                    <p className={'mt-6 ' + type.bodyMuted}>
                      No files attached yet. Edit the event to upload documents.
                    </p>
                  ) : (
                    <ul className="mt-6 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                      {eventAttachmentsList.map((a, i) => (
                        <li
                          key={`${a.storage_path ?? a.url ?? i}-${i}`}
                          className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5"
                        >
                          <Paperclip className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900">{a.name}</p>
                            <p className="mt-0.5 text-xs text-gray-500 tabular-nums">
                              {typeof a.size_bytes === 'number'
                                ? formatAttachmentBytes(a.size_bytes)
                                : 'Size unknown'}
                              {a.content_type ? ` · ${a.content_type}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void (async () => {
                                if (!token) {
                                  toast.error('Sign in required');
                                  return;
                                }
                                const path = eventAttachmentStoragePath(a);
                                if (path) {
                                  try {
                                    await downloadEventAttachmentFile({
                                      token,
                                      branchId: selectedBranch?.id,
                                      storagePath: path,
                                      filename: a.name,
                                      contentType: a.content_type,
                                    });
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : 'Download failed');
                                  }
                                } else if (a.url?.trim()) {
                                  window.open(a.url.trim(), '_blank', 'noopener,noreferrer');
                                } else {
                                  toast.error('This file cannot be downloaded.');
                                }
                              })();
                            }}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                          >
                            Download
                            <Download className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="group" className="m-0 px-6 py-6 sm:px-8 sm:py-8">
                  <p className={type.eyebrow}>Audience</p>
                  <p className={'mt-1 ' + type.cardTitle}>Ministries & members</p>
                  <SectionRule />
                  {linkedMinistries.length > 0 ? (
                    <div className="flex flex-col gap-5">
                      {linkedMinistries.map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <FieldBlock label="Linked Ministry" description="Roster includes this group’s members">
                            <span className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-blue-600" />
                              {displayTitleWords(m.name)}
                            </span>
                          </FieldBlock>
                          <Link
                            to={`/groups/${m.id}`}
                            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                          >
                            Open Ministry
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Link>
                        </div>
                      ))}
                      {(event.assigned_member_ids?.length ?? 0) > 0 ? (
                        <p className={'text-sm text-gray-600 ' + type.mini}>
                          Plus {event.assigned_member_ids!.length} specific member
                          {event.assigned_member_ids!.length === 1 ? '' : 's'} on the attendance roster (union with
                          ministries).
                        </p>
                      ) : null}
                    </div>
                  ) : (event.assigned_member_ids?.length ?? 0) > 0 ? (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 px-6 py-8">
                      <Users className="h-9 w-9 text-blue-500" />
                      <p className={'mt-4 ' + type.value}>Members-only event</p>
                      <p className={'mt-2 ' + type.mini}>
                        No ministry link — the roster is the specific people chosen for this event. Edit the event to add
                        ministries or change the member list.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/50 px-6 py-10 text-center">
                      <Users className="mx-auto h-9 w-9 text-amber-400" />
                      <p className={'mt-4 ' + type.value}>No audience defined</p>
                      <p className={'mt-2 ' + type.mini}>
                        Link one or more ministries and/or specific members so attendance has a roster.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="attendance" className="m-0 space-y-0 px-6 py-6 sm:px-8 sm:py-8">
                  <EventAttendanceTab
                    eventId={event.id}
                    token={token}
                    branchId={selectedBranch?.id ?? null}
                    eventHasGroup={hasAttendanceAudience}
                  />
                </TabsContent>

                <TabsContent value="stats" className="m-0 px-6 py-6 sm:px-8 sm:py-8">
                  <p className={type.eyebrow}>Program metrics</p>
                  <p className={'mt-1 ' + type.cardTitle}>At a glance</p>
                  <SectionRule />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5">
                      <p className={type.eyebrow}>Parts</p>
                      <p className={'mt-3 ' + type.stat}>{partCount}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5">
                      <p className={type.eyebrow}>Activities</p>
                      <p className={'mt-3 ' + type.stat}>{activityCount}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5">
                      <p className={type.eyebrow}>Program time</p>
                      <p className={'mt-3 text-xl font-semibold tabular-nums text-gray-900 sm:text-2xl'}>
                        {formatHoursMinutes(programMinutes)}
                      </p>
                    </div>
                  </div>
                  {typeof outlineDoc.planned_duration_hours === 'number' &&
                  Number.isFinite(outlineDoc.planned_duration_hours) ? (
                    <>
                      <SectionRule />
                      <FieldBlock
                        label="Planned duration budget"
                        description="From program outline (hours)"
                      >
                        {String(outlineDoc.planned_duration_hours)} hr
                      </FieldBlock>
                    </>
                  ) : null}
                </TabsContent>
              </Tabs>
            </MainCard>
          </div>
        </div>
      </div>

      <CreateEventModal
        isOpen={editModalOpen}
        editingEvent={editModalOpen ? event : null}
        onClose={() => setEditModalOpen(false)}
        token={token}
        onUpdated={() => void load()}
      />

      {event.cover_image_url?.trim() ? (
        <Dialog open={coverLightboxOpen} onOpenChange={setCoverLightboxOpen}>
          <DialogContent
            className="max-h-[90vh] max-w-[min(96vw,1200px)] gap-0 border-0 bg-transparent p-0 shadow-none [&>button]:text-white [&>button]:opacity-90 [&>button]:drop-shadow-md [&>button]:hover:opacity-100"
          >
            <DialogTitle className="sr-only">Event cover</DialogTitle>
            <img
              src={event.cover_image_url.trim()}
              alt={event.title ? `Cover: ${event.title}` : 'Event cover'}
              className="max-h-[85vh] w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
