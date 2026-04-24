/** Tab id / first path segment → required permission(s). Null = any authenticated user. */

export function permissionsForPath(pathname: string): string[] | null {
  const p = pathname === '/' ? '' : pathname.replace(/^\//, '').split('/')[0] || '';

  const multiMap: Record<string, string[]> = {
    tasks: [
      'view_member_tasks',
      'monitor_member_tasks',
      'manage_member_tasks',
      'manage_member_task_checklist',
      'complete_member_task_checklist',
      'view_group_tasks',
      'monitor_group_tasks',
      'manage_group_tasks',
      'manage_group_task_checklist',
      'complete_group_task_checklist',
    ],
  };
  if (p in multiMap) return multiMap[p];

  const map: Record<string, string | null> = {
    '': 'view_dashboard',
    dashboard: 'view_dashboard',
    members: 'view_members',
    groups: 'view_groups',
    events: 'view_events',
    messages: 'send_messages',
    notifications: null,
    settings: null,
    profile: null,
    /** Enforced in Root with `user.is_super_admin`; API uses requireSuperAdmin. */
    superadmin: null,
  };

  if (p in map) {
    const v = map[p];
    return v === null ? null : [v];
  }
  return ['view_dashboard'];
}

/** @deprecated Prefer permissionsForPath — kept for callers that expect a single id. */
export function permissionForPath(pathname: string): string | null {
  const perms = permissionsForPath(pathname);
  if (perms === null) return null;
  return perms[0] ?? null;
}
