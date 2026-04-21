import { getWebOrigin } from "./groupPublicUrls";

/**
 * Branch id for the public self-serve registration link: prefer the selected branch,
 * else the profile default (covers loading/error cases where branch pickers are empty).
 */
export function resolveMemberJoinBranchId(
  selectedBranchId: string | undefined | null,
  userBranchId: string | undefined | null
): string {
  return String(selectedBranchId || userBranchId || "").trim();
}

/** Public self-serve member registration URL (same path as web `/cms/register/member/:code`). */
export function getMemberJoinRegisterUrl(
  selectedBranchId: string | undefined | null,
  userBranchId?: string | undefined | null
): string {
  const branchCode = resolveMemberJoinBranchId(selectedBranchId, userBranchId);
  if (!branchCode) return "";
  const origin = getWebOrigin();
  return `${origin}/register/member/${encodeURIComponent(branchCode)}`;
}

export function getMemberJoinQrImageUrl(registerUrl: string): string {
  const u = registerUrl.trim();
  if (!u) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(u)}`;
}
