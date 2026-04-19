import type { NavigateFunction } from 'react-router';

/**
 * Web has no `/members/:id` route; the Members page opens a panel via `openMemberId` in location state.
 * Map `/members/:uuid` → `/members` with state so header + notifications list behave the same.
 */
const UUID_IN_PATH = /^[0-9a-fA-F-]{36}$/i;

function memberIdFromNotificationPayload(pl: Record<string, unknown>): string {
  const mid = typeof pl.member_id === 'string' ? pl.member_id.trim() : '';
  if (mid && UUID_IN_PATH.test(mid)) return mid;
  if (
    String(pl.entity_type || '').toLowerCase() === 'member' &&
    typeof pl.entity_id === 'string' &&
    UUID_IN_PATH.test(pl.entity_id.trim())
  ) {
    return pl.entity_id.trim();
  }
  return '';
}

export function navigateFromNotificationActionPath(
  navigate: NavigateFunction,
  actionPath: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
) {
  const rawPath = String(actionPath || '').trim() || '/notifications';
  const pl = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  // UUID segment may use uppercase hex; `[0-9a-f-]` alone does not match A–F.
  const memberPathMatch = /^\/members\/([0-9a-fA-F-]{36})$/i.exec(rawPath);
  const fromPayload = memberIdFromNotificationPayload(pl);
  const tasksWithMember =
    (rawPath === '/tasks' || rawPath.startsWith('/tasks?')) && Boolean(fromPayload);
  const navigatePath = memberPathMatch || tasksWithMember ? '/members' : rawPath;
  const state: Record<string, unknown> = { fromNotification: true, ...pl };
  if (memberPathMatch?.[1]) state.openMemberId = memberPathMatch[1];
  else if (tasksWithMember) state.openMemberId = fromPayload;
  navigate(navigatePath, { state });
}
