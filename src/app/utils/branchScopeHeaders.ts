/**
 * Server scope uses `X-Branch-Id` only (header branch switcher), not query `branch_id`.
 */
export function resolveBranchIdForApi(explicit: string | null | undefined): string | null {
  const e = explicit?.trim();
  if (e) return e;
  if (typeof localStorage === "undefined") return null;
  const fromStorage = localStorage.getItem("selectedBranchId")?.trim();
  return fromStorage || null;
}

export function withBranchScope(
  branchId: string | null | undefined,
  headers: Record<string, string>,
): Record<string, string> {
  const id = resolveBranchIdForApi(branchId);
  if (!id) return { ...headers };
  return { ...headers, "X-Branch-Id": id };
}
