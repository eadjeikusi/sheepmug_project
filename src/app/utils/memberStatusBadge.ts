import type { MemberStatusOption } from '../../types';

const PRESET: Record<string, string> = {
  green: 'bg-blue-50 text-blue-700 border-blue-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  gray: 'bg-gray-50 text-gray-700 border-gray-200',
  indigo: 'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-blue-50 text-blue-700 border-blue-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
  teal: 'bg-blue-50 text-blue-800 border-blue-200',
  cyan: 'bg-blue-50 text-blue-800 border-blue-200',
  orange: 'bg-orange-50 text-orange-800 border-orange-200',
  emerald: 'bg-blue-50 text-blue-800 border-blue-200',
};

const DOT: Record<string, string> = {
  green: 'bg-blue-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  gray: 'bg-gray-500',
  indigo: 'bg-blue-500',
  violet: 'bg-blue-500',
  blue: 'bg-blue-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-400',
  teal: 'bg-blue-500',
  cyan: 'bg-blue-500',
  orange: 'bg-orange-500',
  emerald: 'bg-blue-500',
};

/** When Settings has no color, map common words in the label to a palette key. */
function inferPresetFromLabel(label: string): keyof typeof PRESET | null {
  const s = label.toLowerCase().trim();
  if (!s) return null;

  if (/\b(deceas|died|passed away|funeral)\b/.test(s)) return 'gray';
  if (/\b(active|engaged|participat)\b/.test(s) || s === 'active' || s === 'new') return 'green';
  if (/\b(new|visitor|guest|first.?time)\b/.test(s)) return 'emerald';
  if (/\b(stop|inactive|pause|suspens|not active|withdraw|left)\b/.test(s)) return 'amber';
  if (/\b(transfer|travel|relocat|move abroad)\b/.test(s)) return 'indigo';
  if (/\b(pend|prospect|inquir|follow)\b/.test(s)) return 'violet';
  if (/\b(absent|miss|unreach)\b/.test(s)) return 'orange';
  if (/\b(block|remov|ban)\b/.test(s)) return 'red';
  if (/\b(lead|shepherd|care)\b/.test(s)) return 'blue';

  return null;
}

/** Stable pseudo-random color per label when no rule matches. */
function hashToPresetKey(label: string): keyof typeof PRESET {
  const pool: (keyof typeof PRESET)[] = [
    'blue',
    'indigo',
    'violet',
    'teal',
    'cyan',
    'rose',
    'green',
    'emerald',
    'orange',
  ];
  let h = 0;
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 33 + label.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(h) % pool.length];
}

function resolvePresetKey(
  status: string,
  opts: Pick<MemberStatusOption, 'label' | 'color'>[],
): keyof typeof PRESET {
  const row = opts.find((o) => o.label === status);
  const fromDb = (row?.color ?? '').trim().toLowerCase();
  if (fromDb && PRESET[fromDb]) return fromDb as keyof typeof PRESET;

  const inferred = inferPresetFromLabel(status);
  if (inferred) return inferred;

  return hashToPresetKey(status);
}

export function memberStatusBadgePair(
  status: string | null | undefined,
  opts: Pick<MemberStatusOption, 'label' | 'color'>[],
): { chipClass: string; dotClass: string; text: string } {
  const text = (status ?? '').trim() || '—';
  if (text === '—') {
    return {
      chipClass: `${PRESET.slate} border`,
      dotClass: DOT.slate,
      text,
    };
  }
  const key = resolvePresetKey(text, opts);
  return {
    chipClass: `${PRESET[key]} border`,
    dotClass: DOT[key] ?? DOT.slate,
    text,
  };
}
