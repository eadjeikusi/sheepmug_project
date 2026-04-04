import { useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Clock,
  Copy,
  GripVertical,
  MapPin,
  Mic2,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react';

export type ProgramItemDraft = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  duration_minutes: string;
  speaker: string;
  notes: string;
  location: string;
};

export type ProgramSectionDraft = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  notes: string;
  items: ProgramItemDraft[];
};

export type ProgramOutlineDocument = {
  version: 1;
  /** Proposed event length in decimal hours (e.g. 2.3). Optional budget for time warnings. */
  planned_duration_hours?: number | null;
  sections: ProgramSectionDraft[];
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyItem(): ProgramItemDraft {
  return {
    id: newId(),
    title: '',
    start_time: '',
    end_time: '',
    duration_minutes: '',
    speaker: '',
    notes: '',
    location: '',
  };
}

export function emptySection(): ProgramSectionDraft {
  return {
    id: newId(),
    title: '',
    start_time: '',
    end_time: '',
    notes: '',
    items: [emptyItem()],
  };
}

export function emptyDocument(): ProgramOutlineDocument {
  return { version: 1, sections: [emptySection()] };
}

function timeHmToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes covered by start→end (same day; end before start → next day). */
export function spanMinutesFromTimes(start: string, end: string): number | null {
  const a = timeHmToMinutes(start);
  const b = timeHmToMinutes(end);
  if (a === null || b === null) return null;
  let diff = b - a;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

/** Prefer explicit duration_minutes; else end−start. */
export function activityEffectiveMinutes(item: ProgramItemDraft): number {
  const d = item.duration_minutes.trim();
  if (d !== '' && !Number.isNaN(Number(d))) {
    const n = Number(d);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const span = spanMinutesFromTimes(item.start_time, item.end_time);
  if (span !== null && span > 0) return span;
  return 0;
}

function sectionBlockMinutes(s: ProgramSectionDraft): number | null {
  return spanMinutesFromTimes(s.start_time, s.end_time);
}

/**
 * Per part: if block start/end is set, count max(block span, sum of activities)
 * so empty activities still pick up the part window; activities longer than the block still count.
 */
export function sectionUsedMinutes(s: ProgramSectionDraft): number {
  const actSum = s.items.reduce((a, it) => a + activityEffectiveMinutes(it), 0);
  const block = sectionBlockMinutes(s);
  if (block !== null && block > 0) return Math.max(block, actSum);
  return actSum;
}

export function computeTotalUsedMinutes(doc: ProgramOutlineDocument): number {
  return doc.sections.reduce((a, s) => a + sectionUsedMinutes(s), 0);
}

/**
 * Human duration: sub-minute values show as 30mins; under 1hr use "Xmins";
 * 1hr+ uses "1hr 30mins" style.
 */
export function formatHoursMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '0mins';
  let m: number;
  if (totalMinutes < 1) {
    m = 30;
  } else {
    m = Math.round(totalMinutes);
  }
  if (m < 60) {
    return m === 1 ? '1min' : `${m}mins`;
  }
  const h = Math.floor(m / 60);
  const mins = m % 60;
  if (mins === 0) return `${h}hr`;
  return mins === 1 ? `${h}hr 1min` : `${h}hr ${mins}mins`;
}

/** "HH:mm" (24h) → "2:00pm", "4:40pm" */
function formatTime12h(hhmm: string): string | null {
  const mins = timeHmToMinutes(hhmm);
  if (mins === null) return null;
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  const mm = String(m).padStart(2, '0');
  return `${h}:${mm}${ap}`;
}

/** New row with copied field values — no shared references with the source. */
function copyActivityIndependent(item: ProgramItemDraft): ProgramItemDraft {
  return {
    id: newId(),
    title: item.title,
    start_time: item.start_time,
    end_time: item.end_time,
    duration_minutes: item.duration_minutes,
    speaker: item.speaker,
    notes: item.notes,
    location: item.location,
  };
}

function copyPartIndependent(section: ProgramSectionDraft): ProgramSectionDraft {
  return {
    id: newId(),
    title: section.title,
    start_time: section.start_time,
    end_time: section.end_time,
    notes: section.notes,
    items: section.items.map(copyActivityIndependent),
  };
}

/** Full outline copy with every part/activity id regenerated (e.g. duplicate template). */
export function freshDuplicateOutline(doc: ProgramOutlineDocument): ProgramOutlineDocument {
  return {
    version: 1,
    planned_duration_hours: doc.planned_duration_hours ?? null,
    sections: doc.sections.map((s) => copyPartIndependent(s)),
  };
}

function asNonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

function asItem(raw: unknown): ProgramItemDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyItem();
  const o = raw as Record<string, unknown>;
  return {
    id: asNonEmptyString(o.id) || newId(),
    title: asNonEmptyString(o.title),
    start_time: asNonEmptyString(o.start_time),
    end_time: asNonEmptyString(o.end_time),
    duration_minutes:
      typeof o.duration_minutes === 'number' && Number.isFinite(o.duration_minutes)
        ? String(o.duration_minutes)
        : asNonEmptyString(o.duration_minutes),
    speaker: asNonEmptyString(o.speaker),
    notes: asNonEmptyString(o.notes),
    location: asNonEmptyString(o.location),
  };
}

function asSection(raw: unknown): ProgramSectionDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptySection();
  const o = raw as Record<string, unknown>;
  const itemsRaw = o.items;
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.map(asItem)
    : [emptyItem()];
  return {
    id: asNonEmptyString(o.id) || newId(),
    title: asNonEmptyString(o.title),
    start_time: asNonEmptyString(o.start_time),
    end_time: asNonEmptyString(o.end_time),
    notes: asNonEmptyString(o.notes),
    items: items.length ? items : [emptyItem()],
  };
}

/** Load JSON from API / legacy shapes into editor model */
export function documentFromProgramOutline(obj: Record<string, unknown> | null | undefined): ProgramOutlineDocument {
  if (!obj || typeof obj !== 'object') return emptyDocument();
  const sectionsRaw = obj.sections;
  if (Array.isArray(sectionsRaw) && sectionsRaw.length > 0) {
    const pd = obj.planned_duration_hours;
    let planned_duration_hours: number | null = null;
    if (typeof pd === 'number' && Number.isFinite(pd) && pd > 0) planned_duration_hours = pd;
    return {
      version: 1,
      planned_duration_hours,
      sections: sectionsRaw.map(asSection),
    };
  }
  const itemsRaw = obj.items;
  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const pd0 = obj.planned_duration_hours;
    let planned0: number | null = null;
    if (typeof pd0 === 'number' && Number.isFinite(pd0) && pd0 > 0) planned0 = pd0;
    return {
      version: 1,
      planned_duration_hours: planned0,
      sections: [
        {
          id: newId(),
          title: asNonEmptyString(obj.block_title) || 'Schedule',
          start_time: asNonEmptyString(obj.start_time),
          end_time: asNonEmptyString(obj.end_time),
          notes: '',
          items: itemsRaw.map(asItem),
        },
      ],
    };
  }
  return emptyDocument();
}

function serializeItem(i: ProgramItemDraft): Record<string, unknown> {
  const duration = i.duration_minutes.trim();
  let duration_minutes: number | undefined;
  if (duration !== '' && !Number.isNaN(Number(duration))) {
    duration_minutes = Number(duration);
  }
  const row: Record<string, unknown> = {
    id: i.id,
    title: i.title.trim(),
    start_time: i.start_time.trim() || undefined,
    end_time: i.end_time.trim() || undefined,
    speaker: i.speaker.trim() || undefined,
    notes: i.notes.trim() || undefined,
    location: i.location.trim() || undefined,
  };
  if (duration_minutes !== undefined) row.duration_minutes = duration_minutes;
  Object.keys(row).forEach((k) => {
    if (row[k] === undefined) delete row[k];
  });
  return row;
}

/** Persist as JSON object for `program_outline` column */
export function documentToProgramOutline(doc: ProgramOutlineDocument): Record<string, unknown> {
  const sections = doc.sections.map((s) => {
    const sec: Record<string, unknown> = {
      id: s.id,
      title: s.title.trim(),
      items: s.items.map(serializeItem),
    };
    if (s.start_time.trim()) sec.start_time = s.start_time.trim();
    if (s.end_time.trim()) sec.end_time = s.end_time.trim();
    if (s.notes.trim()) sec.notes = s.notes.trim();
    if (!sec.title) delete sec.title;
    return sec;
  });
  const out: Record<string, unknown> = { version: 1, sections };
  if (doc.planned_duration_hours != null && doc.planned_duration_hours > 0) {
    out.planned_duration_hours = doc.planned_duration_hours;
  }
  return out;
}

export type ProgramOutlineEditorVariant = 'full' | 'budgetOnly' | 'scheduleOnly';

type Props = {
  value: ProgramOutlineDocument;
  onChange: (next: ProgramOutlineDocument) => void;
  /** Split modal: `budgetOnly` = planned hours + summary; `scheduleOnly` = parts & activities only. */
  variant?: ProgramOutlineEditorVariant;
};

const inputCls =
  'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15';
const labelCls = 'text-[11px] font-medium uppercase tracking-wide text-gray-500';

export default function ProgramOutlineAccordionEditor({ value, onChange, variant = 'full' }: Props) {
  const setSections = useCallback(
    (sections: ProgramSectionDraft[]) => {
      onChange({ ...value, sections: sections.length ? sections : [emptySection()] });
    },
    [onChange, value]
  );

  const setPlannedHours = (raw: string) => {
    if (raw.trim() === '') {
      onChange({ ...value, planned_duration_hours: null });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      onChange({ ...value, planned_duration_hours: n > 0 ? n : null });
    }
  };

  const usedMin = useMemo(() => computeTotalUsedMinutes(value), [value]);
  const plannedMin = useMemo(() => {
    const h = value.planned_duration_hours;
    if (h == null || !Number.isFinite(h) || h <= 0) return null;
    return Math.round(h * 60);
  }, [value.planned_duration_hours]);

  const exceeds = plannedMin != null && usedMin > plannedMin;
  const remaining = plannedMin != null ? plannedMin - usedMin : null;

  const moveSection = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= value.sections.length) return;
    const next = [...value.sections];
    [next[index], next[j]] = [next[j], next[index]];
    setSections(next);
  };

  const updateSection = (index: number, patch: Partial<ProgramSectionDraft>) => {
    const next = value.sections.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSections(next);
  };

  const removeSection = (index: number) => {
    if (value.sections.length <= 1) return;
    setSections(value.sections.filter((_, i) => i !== index));
  };

  const addSection = () => {
    setSections([...value.sections, emptySection()]);
  };

  const duplicateSection = (index: number) => {
    const s = value.sections[index];
    if (!s) return;
    const copy = copyPartIndependent(s);
    const next = [...value.sections.slice(0, index + 1), copy, ...value.sections.slice(index + 1)];
    setSections(next);
  };

  const moveItem = (secIndex: number, itemIndex: number, dir: -1 | 1) => {
    const sec = value.sections[secIndex];
    const j = itemIndex + dir;
    if (!sec || j < 0 || j >= sec.items.length) return;
    const items = [...sec.items];
    [items[itemIndex], items[j]] = [items[j], items[itemIndex]];
    updateSection(secIndex, { items });
  };

  const updateItem = (secIndex: number, itemIndex: number, patch: Partial<ProgramItemDraft>) => {
    const sec = value.sections[secIndex];
    if (!sec) return;
    const items = sec.items.map((it, i) => (i === itemIndex ? { ...it, ...patch } : it));
    updateSection(secIndex, { items });
  };

  const addItem = (secIndex: number) => {
    const sec = value.sections[secIndex];
    if (!sec) return;
    updateSection(secIndex, { items: [...sec.items, emptyItem()] });
  };

  const removeItem = (secIndex: number, itemIndex: number) => {
    const sec = value.sections[secIndex];
    if (!sec || sec.items.length <= 1) return;
    updateSection(secIndex, { items: sec.items.filter((_, i) => i !== itemIndex) });
  };

  const duplicateItem = (secIndex: number, itemIndex: number) => {
    const sec = value.sections[secIndex];
    if (!sec) return;
    const it = sec.items[itemIndex];
    if (!it) return;
    const copy = copyActivityIndependent(it);
    const items = [...sec.items.slice(0, itemIndex + 1), copy, ...sec.items.slice(itemIndex + 1)];
    updateSection(secIndex, { items });
  };

  const sectionSummaries = useMemo(
    () =>
      value.sections.map((s, idx) => {
        const label = s.title.trim() || `Part ${idx + 1}`;
        const sm = sectionUsedMinutes(s);
        const nActs = s.items.filter((i) => i.title.trim()).length;
        const actLabel = `${nActs} ${nActs === 1 ? 'activity' : 'activities'}`;

        const st = s.start_time.trim();
        const en = s.end_time.trim();
        const start12 = st ? formatTime12h(st) : null;
        const end12 = en ? formatTime12h(en) : null;
        const blockSpan = st && en ? spanMinutesFromTimes(st, en) : null;

        const parts: string[] = [];
        if (start12 && end12) {
          parts.push(
            blockSpan != null && blockSpan > 0
              ? `${start12}–${end12} · ${formatHoursMinutes(blockSpan)}`
              : `${start12}–${end12}`
          );
        } else if (start12) {
          parts.push(`${start12}–…`);
        } else if (end12) {
          parts.push(`…–${end12}`);
        } else if (sm > 0) {
          parts.push(formatHoursMinutes(sm));
        }

        parts.push(actLabel);
        const preview = parts.join(' · ');
        return { label, preview };
      }),
    [value.sections]
  );

  const showBudget = variant === 'full' || variant === 'budgetOnly';
  const showSchedule = variant === 'full' || variant === 'scheduleOnly';
  const scheduleScrollClass =
    variant === 'scheduleOnly'
      ? 'max-h-[min(70vh,calc(90vh-11rem))] md:max-h-[calc(90vh-13rem)]'
      : 'max-h-[min(52vh,420px)]';

  return (
    <div className={variant === 'full' ? 'space-y-3' : 'space-y-3 min-h-0'}>
      {showBudget ? (
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-3">
        <label className="text-xs font-medium text-gray-600">Hours</label>
        <input
          type="number"
          min={0}
          step={0.05}
          placeholder="—"
          className={`${inputCls} mt-1 bg-white`}
          value={value.planned_duration_hours ?? ''}
          onChange={(e) => setPlannedHours(e.target.value)}
        />
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Used</dt>
            <dd className="font-medium text-gray-900 tabular-nums">{formatHoursMinutes(usedMin)}</dd>
          </div>
          {plannedMin != null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">{exceeds ? 'Over' : 'Remaining'}</dt>
              <dd
                className={`font-medium tabular-nums ${exceeds ? 'text-red-600' : 'text-emerald-700'}`}
              >
                {exceeds && remaining != null
                  ? formatHoursMinutes(Math.abs(remaining))
                  : remaining != null
                    ? formatHoursMinutes(remaining)
                    : '—'}
              </dd>
            </div>
          ) : null}
        </dl>
        {exceeds && plannedMin != null ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
            Exceeds plan — adjust hours or schedule.
          </p>
        ) : null}
      </div>
      ) : null}

      {showSchedule ? (
        <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-700">Program schedule</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Parts (blocks) and activities — times, speakers, and notes. All optional except activity title when you need
            a row.
          </p>
        </div>
        <button
          type="button"
          onClick={addSection}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
        >
          <Plus className="h-3.5 w-3.5" />
          Part
        </button>
      </div>

      <div className={`space-y-2 ${scheduleScrollClass} overflow-y-auto pr-1`}>
        {value.sections.map((section, sIdx) => {
          const sum = sectionSummaries[sIdx];
          return (
            <details
              key={section.id}
              className="group/part rounded-xl border border-gray-200 bg-gray-50/50 open:bg-white open:shadow-sm"
              defaultOpen={sIdx === 0}
            >
              <summary className="group/partsum flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-left [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open/part:rotate-180" />
                <GripVertical className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-900">{sum.label}</span>
                  {sum.preview ? (
                    <span className="mt-0.5 block truncate text-xs text-gray-500">{sum.preview}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.preventDefault()}>
                  <button
                    type="button"
                    title="Duplicate part"
                    onClick={() => duplicateSection(sIdx)}
                    className="rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-indigo-50 hover:text-indigo-700 group-hover/partsum:opacity-100"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Move part up"
                    onClick={() => moveSection(sIdx, -1)}
                    disabled={sIdx === 0}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Move part down"
                    onClick={() => moveSection(sIdx, 1)}
                    disabled={sIdx === value.sections.length - 1}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Remove part"
                    onClick={() => removeSection(sIdx)}
                    disabled={value.sections.length <= 1}
                    className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </summary>

              <div className="space-y-3 border-t border-gray-100 px-3 pb-3 pt-2">
                <div>
                  <label className={labelCls}>Part title</label>
                  <input
                    className={`${inputCls} mt-1`}
                    placeholder="e.g. Main service, Youth session"
                    value={section.title}
                    onChange={(e) => updateSection(sIdx, { title: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`${labelCls} inline-flex items-center gap-1`}>
                      <Clock className="h-3 w-3" aria-hidden />
                      Block start
                    </label>
                    <input
                      type="time"
                      className={`${inputCls} mt-1`}
                      value={section.start_time}
                      onChange={(e) => updateSection(sIdx, { start_time: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`${labelCls} inline-flex items-center gap-1`}>
                      <Clock className="h-3 w-3" aria-hidden />
                      Block end
                    </label>
                    <input
                      type="time"
                      className={`${inputCls} mt-1`}
                      value={section.end_time}
                      onChange={(e) => updateSection(sIdx, { end_time: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className={`${labelCls} inline-flex items-center gap-1`}>
                    <StickyNote className="h-3 w-3" aria-hidden />
                    Part notes
                  </label>
                  <textarea
                    className={`${inputCls} mt-1 resize-none`}
                    rows={2}
                    placeholder="Optional notes for this part of the program"
                    value={section.notes}
                    onChange={(e) => updateSection(sIdx, { notes: e.target.value })}
                  />
                </div>

                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Activities</p>
                <div className="space-y-2">
                  {section.items.map((item, iIdx) => (
                    <details
                      key={item.id}
                      className="act-item group/act rounded-lg border border-gray-100 bg-white open:border-indigo-100 open:ring-1 open:ring-indigo-100"
                    >
                      <summary className="group/actsum flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-left text-sm [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-open/act:rotate-180" />
                        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                          {item.title.trim() || `Activity ${iIdx + 1}`}
                          {(() => {
                            const em = activityEffectiveMinutes(item);
                            return em > 0 ? (
                              <span className="ml-2 font-normal text-indigo-600">
                                · {formatHoursMinutes(em)}
                              </span>
                            ) : null;
                          })()}
                          {item.start_time.trim() ? (
                            <span className="ml-2 font-normal text-gray-500">{item.start_time}</span>
                          ) : null}
                          {item.speaker.trim() ? (
                            <span className="ml-2 truncate font-normal text-gray-500">· {item.speaker}</span>
                          ) : null}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.preventDefault()}>
                          <button
                            type="button"
                            title="Duplicate activity"
                            onClick={() => duplicateItem(sIdx, iIdx)}
                            className="rounded p-0.5 text-gray-500 opacity-0 transition-opacity hover:bg-indigo-50 hover:text-indigo-700 group-hover/actsum:opacity-100"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Move up"
                            onClick={() => moveItem(sIdx, iIdx, -1)}
                            disabled={iIdx === 0}
                            className="rounded p-0.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Move down"
                            onClick={() => moveItem(sIdx, iIdx, 1)}
                            disabled={iIdx === section.items.length - 1}
                            className="rounded p-0.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Remove activity"
                            onClick={() => removeItem(sIdx, iIdx)}
                            disabled={section.items.length <= 1}
                            className="rounded p-0.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </summary>
                      <div className="space-y-2 border-t border-gray-50 px-2.5 pb-2.5 pt-2">
                        <div>
                          <label className={labelCls}>Activity title</label>
                          <input
                            className={`${inputCls} mt-1`}
                            placeholder="e.g. Welcome, Sermon, Offering"
                            value={item.title}
                            onChange={(e) => updateItem(sIdx, iIdx, { title: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={labelCls}>Start time</label>
                            <input
                              type="time"
                              className={`${inputCls} mt-1`}
                              value={item.start_time}
                              onChange={(e) => updateItem(sIdx, iIdx, { start_time: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>End time</label>
                            <input
                              type="time"
                              className={`${inputCls} mt-1`}
                              value={item.end_time}
                              onChange={(e) => updateItem(sIdx, iIdx, { end_time: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={labelCls}>Duration (minutes)</label>
                            <input
                              type="number"
                              min={0}
                              className={`${inputCls} mt-1`}
                              placeholder="e.g. 15"
                              value={item.duration_minutes}
                              onChange={(e) => updateItem(sIdx, iIdx, { duration_minutes: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={`${labelCls} inline-flex items-center gap-1`}>
                              <MapPin className="h-3 w-3" aria-hidden />
                              Location
                            </label>
                            <input
                              className={`${inputCls} mt-1`}
                              placeholder="Room, stage, online link"
                              value={item.location}
                              onChange={(e) => updateItem(sIdx, iIdx, { location: e.target.value })}
                            />
                          </div>
                        </div>
                        <div>
                          <label className={`${labelCls} inline-flex items-center gap-1`}>
                            <Mic2 className="h-3 w-3" aria-hidden />
                            Speaker / host
                          </label>
                          <input
                            className={`${inputCls} mt-1`}
                            placeholder="Name or team"
                            value={item.speaker}
                            onChange={(e) => updateItem(sIdx, iIdx, { speaker: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Notes</label>
                          <textarea
                            className={`${inputCls} mt-1 resize-none`}
                            rows={2}
                            placeholder="Instructions, songs, scripture…"
                            value={item.notes}
                            onChange={(e) => updateItem(sIdx, iIdx, { notes: e.target.value })}
                          />
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addItem(sIdx)}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 py-2 text-xs font-medium text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add activity
                </button>
              </div>
            </details>
          );
        })}
      </div>
        </>
      ) : null}
    </div>
  );
}
