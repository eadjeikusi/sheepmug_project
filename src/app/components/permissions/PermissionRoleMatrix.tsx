import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Info, ChevronRight, ChevronDown } from 'lucide-react';
import { useCallback, useState } from 'react';
import { getPermissionDef } from '../../../permissions/catalog';
import {
  CRUD_COLUMNS,
  type PermissionMatrixRow,
  PERMISSION_MATRIX_SECTIONS,
} from '../../../permissions/permissionMatrixLayout';
import { cn } from '../ui/utils';

type Props = {
  permDraft: Set<string>;
  impliedByOther: Set<string>;
  onToggle: (permissionId: string) => void;
  onApplySection: (sectionId: string) => void;
  disabled?: boolean;
};

function capFirst(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PermRowInfo({ row }: { row: PermissionMatrixRow }) {
  const lines: { name: string; description: string }[] = [];
  for (const c of CRUD_COLUMNS) {
    const id = row.cells[c.key];
    if (!id) continue;
    const def = getPermissionDef(id);
    if (def) {
      lines.push({ name: capFirst(def.name), description: def.description });
    } else {
      lines.push({ name: id, description: '' });
    }
  }
  if (lines.length === 0) return null;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gray-400"
          aria-label={`What these permissions do: ${row.label}`}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          align="start"
          sideOffset={6}
          className={cn(
            'z-[100] max-w-xs select-none rounded-lg border border-gray-200/90 bg-white p-2.5 text-left text-xs text-gray-700 shadow-lg shadow-gray-200/50',
            'data-[side=right]:slide-in-from-left-2 data-[side=left]:slide-in-from-right-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <p className="mb-1.5 font-semibold text-gray-900">{capFirst(row.label)}</p>
          <ul className="list-none space-y-1.5">
            {lines.map((line, i) => (
              <li key={`${i}-${line.name}`}>
                <span className="font-medium text-gray-800">{line.name}</span>
                {line.description ? <span className="text-gray-600"> — {line.description}</span> : null}
              </li>
            ))}
          </ul>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

function MatrixCell({
  rowLabel,
  colLabel,
  permissionId,
  permDraft,
  impliedByOther,
  onToggle,
  disabled,
}: {
  rowLabel: string;
  colLabel: string;
  permissionId: string | undefined;
  permDraft: Set<string>;
  impliedByOther: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  if (!permissionId) {
    return (
      <td className="border-b border-gray-100 bg-gray-50/70 px-1 py-2 text-center align-middle">
        <input
          type="checkbox"
          disabled
          aria-hidden
          className="h-5 w-5 cursor-not-allowed rounded border-gray-200 opacity-35 grayscale sm:h-4 sm:w-4"
        />
      </td>
    );
  }

  const explicit = permDraft.has(permissionId);
  const impliedOnly = !explicit && impliedByOther.has(permissionId);
  const checked = explicit || impliedOnly;
  const cellDisabled = disabled || impliedOnly;
  const ariaLabel = impliedOnly
    ? `${rowLabel} · ${colLabel} · ${permissionId} · included`
    : `${rowLabel} · ${colLabel} · ${permissionId}`;

  return (
    <td className="border-b border-gray-100 px-1 py-2 text-center align-middle">
      <input
        type="checkbox"
        checked={checked}
        disabled={cellDisabled}
        onChange={() => {
          if (!cellDisabled) onToggle(permissionId);
        }}
        aria-label={ariaLabel}
        className={
          cellDisabled && impliedOnly
            ? 'h-5 w-5 cursor-not-allowed rounded border-gray-300 text-blue-600 opacity-90 sm:h-4 sm:w-4'
            : 'h-5 w-5 rounded border-gray-300 sm:h-4 sm:w-4'
        }
      />
    </td>
  );
}

export function PermissionRoleMatrix({ permDraft, impliedByOther, onToggle, onApplySection, disabled }: Props) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <TooltipPrimitive.Provider delayDuration={200} skipDelayDuration={300}>
      <div className="space-y-2">
        {PERMISSION_MATRIX_SECTIONS.map((section) => {
          const isOpen = openSections.has(section.id);
          return (
            <section key={section.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="flex min-h-[3rem] items-stretch border-b border-gray-100 bg-gray-50">
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isOpen}
                  aria-controls={`perm-matrix-${section.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100/80 sm:px-4"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                  )}
                  <span className="min-w-0">{capFirst(section.title)}</span>
                </button>
                <div className="flex shrink-0 items-center border-l border-gray-100 bg-gray-50/50">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      onApplySection(section.id);
                    }}
                    className="h-full px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 sm:px-4"
                  >
                    Apply all
                  </button>
                </div>
              </div>

              {isOpen ? (
                <div
                  id={`perm-matrix-${section.id}`}
                  className="touch-pan-x overflow-x-auto overscroll-x-contain"
                >
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          className="sticky left-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-500 shadow-[1px_0_0_0_rgb(229_231_235)]"
                        >
                          Resource
                        </th>
                        {CRUD_COLUMNS.map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            className="border-b border-gray-200 bg-gray-50/90 px-2 py-2 text-center text-xs font-semibold text-gray-600"
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.matrixRows.map((row) => {
                        const displayLabel = capFirst(row.label);
                        return (
                          <tr key={row.rowId} className="bg-white">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-2 text-left text-xs font-medium text-gray-900 shadow-[1px_0_0_0_rgb(243_244_246)]"
                            >
                              <div className="flex items-center gap-1.5 pr-1">
                                <span className="min-w-0 break-words">{displayLabel}</span>
                                <PermRowInfo row={row} />
                              </div>
                            </th>
                            {CRUD_COLUMNS.map((c) => (
                              <MatrixCell
                                key={c.key}
                                rowLabel={displayLabel}
                                colLabel={c.label}
                                permissionId={row.cells[c.key]}
                                permDraft={permDraft}
                                impliedByOther={impliedByOther}
                                onToggle={onToggle}
                                disabled={disabled}
                              />
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </TooltipPrimitive.Provider>
  );
}
