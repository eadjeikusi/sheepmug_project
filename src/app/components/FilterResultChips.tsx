import { X } from 'lucide-react';

import { cn } from './ui/utils';

export type FilterChipItem = {
  id: string;
  /** Full chip text, e.g. `Status: Active` */
  label: string;
  onRemove: () => void;
  /** When false, chip is display-only (no dismiss control). */
  removable?: boolean;
};

type FilterResultChipsProps = {
  /** Screen-reader / prefix label */
  title?: string;
  chips: FilterChipItem[];
  className?: string;
  onClearAll?: () => void;
};

export function FilterResultChips({
  title = 'Filtered by',
  chips,
  className,
  onClearAll,
}: FilterResultChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/90 px-3 py-2.5',
        className,
      )}
      role="region"
      aria-label={title}
    >
      <span className="text-[11px] font-semibold text-gray-500 shrink-0">{title}</span>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {chips.map((c) => {
          const removable = c.removable !== false;
          return (
            <span
              key={c.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-white pl-2.5 pr-1 py-0.5 text-xs font-medium text-gray-800 shadow-sm"
            >
              <span className="min-w-0 truncate">{c.label}</span>
              {removable ? (
                <button
                  type="button"
                  onClick={c.onRemove}
                  className="shrink-0 rounded-full p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  aria-label={`Remove filter: ${c.label}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      {onClearAll && chips.length > 0 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          Clear All
        </button>
      ) : null}
    </div>
  );
}
