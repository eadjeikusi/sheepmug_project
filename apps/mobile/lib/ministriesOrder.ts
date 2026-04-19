import type { Group } from "@sheepmug/shared-api";

function systemKind(g: Group): string | null {
  const sk = (g as { system_kind?: string | null }).system_kind;
  return typeof sk === "string" ? sk : null;
}

/**
 * Puts the branch "All Members" system group (`system_kind === "all_members"`) first,
 * then sorts the rest by name (matches web expectations when the user has that assignment).
 */
export function sortMinistriesGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => {
    const aAll = systemKind(a) === "all_members";
    const bAll = systemKind(b) === "all_members";
    if (aAll && !bAll) return -1;
    if (!aAll && bAll) return 1;
    const an = (a.name || "").trim().toLowerCase();
    const bn = (b.name || "").trim().toLowerCase();
    return an.localeCompare(bn);
  });
}
