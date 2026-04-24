import { CRUD_COLUMNS, PERMISSION_MATRIX_SECTIONS } from '../../../permissions/permissionMatrixLayout';

type Props = {
  permDraft: Set<string>;
  impliedByOther: Set<string>;
  onToggle: (permissionId: string) => void;
  disabled?: boolean;
};

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
          className="h-4 w-4 cursor-not-allowed rounded border-gray-200 opacity-35 grayscale"
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
            ? 'h-4 w-4 cursor-not-allowed rounded border-gray-300 text-blue-600 opacity-90'
            : 'h-4 w-4 rounded border-gray-300'
        }
      />
    </td>
  );
}

export function PermissionRoleMatrix({ permDraft, impliedByOther, onToggle, disabled }: Props) {
  return (
    <div className="space-y-8">
      {PERMISSION_MATRIX_SECTIONS.map((section) => (
        <section key={section.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
            <h4 className="text-sm font-semibold text-gray-900">{section.title}</h4>
          </div>

          <div className="overflow-x-auto">
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
                {section.matrixRows.map((row) => (
                  <tr key={row.rowId} className="bg-white">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-2 text-left text-xs font-medium text-gray-900 shadow-[1px_0_0_0_rgb(243_244_246)]"
                    >
                      {row.label}
                    </th>
                    {CRUD_COLUMNS.map((c) => (
                      <MatrixCell
                        key={c.key}
                        rowLabel={row.label}
                        colLabel={c.label}
                        permissionId={row.cells[c.key]}
                        permDraft={permDraft}
                        impliedByOther={impliedByOther}
                        onToggle={onToggle}
                        disabled={disabled}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
