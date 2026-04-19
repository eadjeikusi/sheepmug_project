import type { CustomFieldDefinition } from '@/types';
import { DatePickerField } from '@/components/datetime';
import { capitalizeSentencesForUi } from '@/utils/sentenceCaseDisplay';

function parseOptions(def: CustomFieldDefinition): string[] {
  const o = def.options;
  if (Array.isArray(o)) return o.map((x) => String(x).trim()).filter(Boolean);
  return [];
}

type Props = {
  definitions: CustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  readOnly?: boolean;
  className?: string;
};

export default function CustomFieldsSection({
  definitions,
  values,
  onChange,
  readOnly = false,
  className = '',
}: Props) {
  const sorted = [...definitions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label),
  );

  if (sorted.length === 0) return null;

  return (
    <div className={`space-y-4 ${className}`}>
      {sorted.map((def) => {
        const key = def.field_key;
        const raw = values[key];
        const label = (
          <label className="block text-sm font-medium text-gray-700">
            {def.label}
            {def.required ? <span className="text-red-500"> *</span> : null}
          </label>
        );

        if (def.field_type === 'file') {
          return (
            <div key={key}>
              {label}
              <p className="mt-1 text-xs text-gray-400">File uploads are not available yet for this field.</p>
            </div>
          );
        }

        if (def.field_type === 'checkbox') {
          const checked = raw === true || raw === 'true';
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`cf-${key}`}
                checked={checked}
                disabled={readOnly}
                onChange={(e) => onChange(key, e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
              />
              <label htmlFor={`cf-${key}`} className="text-sm text-gray-800">
                {def.label}
                {def.required ? <span className="text-red-500"> *</span> : null}
              </label>
            </div>
          );
        }

        if (def.field_type === 'dropdown') {
          const opts = parseOptions(def);
          const strVal = raw == null ? '' : String(raw);
          return (
            <div key={key}>
              {label}
              <select
                value={strVal}
                disabled={readOnly}
                onChange={(e) => onChange(key, e.target.value || null)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50"
              >
                <option value="">{def.placeholder || '— Select —'}</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (def.field_type === 'textarea') {
          return (
            <div key={key}>
              {label}
              <textarea
                value={raw == null ? '' : String(raw)}
                readOnly={readOnly}
                onChange={(e) => onChange(key, e.target.value)}
                placeholder={def.placeholder || ''}
                rows={3}
                className="mt-1 w-full resize-y rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 read-only:bg-gray-50"
              />
            </div>
          );
        }

        if (def.field_type === 'date') {
          const displayVal = raw == null ? '' : String(raw);
          return (
            <div key={key}>
              {label}
              <div className="mt-1">
                <DatePickerField
                  value={displayVal}
                  onChange={(v) => onChange(key, v)}
                  disabled={readOnly}
                  placeholder={def.placeholder || 'Select date'}
                  triggerClassName="h-auto min-h-[40px] w-full rounded-xl border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm read-only:bg-gray-50 disabled:opacity-60"
                />
              </div>
            </div>
          );
        }

        const inputType =
          def.field_type === 'number'
            ? 'number'
            : def.field_type === 'email'
              ? 'email'
              : def.field_type === 'phone'
                ? 'tel'
                : 'text';

        const displayVal =
          def.field_type === 'number' && typeof raw === 'number'
            ? String(raw)
            : raw == null
              ? ''
              : String(raw);

        return (
          <div key={key}>
            {label}
            <input
              type={inputType}
              value={displayVal}
              readOnly={readOnly}
              onChange={(e) => {
                const v = e.target.value;
                if (def.field_type === 'number') {
                  if (v === '') {
                    onChange(key, null);
                    return;
                  }
                  const n = Number(v);
                  onChange(key, Number.isFinite(n) ? n : null);
                } else {
                  onChange(key, v);
                }
              }}
              placeholder={def.placeholder || ''}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 read-only:bg-gray-50"
            />
          </div>
        );
      })}
    </div>
  );
}

/** Read-only list of label / value for detail views */
export function CustomFieldsReadOnlyList({
  definitions,
  values,
}: {
  definitions: CustomFieldDefinition[];
  values: Record<string, unknown> | null | undefined;
}) {
  const v = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const sorted = [...definitions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label),
  );
  const rows: { label: string; text: string }[] = [];
  for (const def of sorted) {
    const val = v[def.field_key];
    if (val === null || val === undefined || val === '') {
      rows.push({ label: def.label, text: '—' });
    } else if (typeof val === 'boolean') {
      rows.push({ label: def.label, text: val ? 'Yes' : 'No' });
    } else {
      const rawText = String(val);
      const text =
        def.field_type === 'textarea' ? capitalizeSentencesForUi(rawText) : rawText;
      rows.push({ label: def.label, text });
    }
  }
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs text-gray-500">{r.label}</dt>
          <dd
            className={`text-sm font-medium text-gray-900 break-words${
              r.text.includes('\n') ? ' whitespace-pre-wrap' : ''
            }`}
          >
            {r.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}
