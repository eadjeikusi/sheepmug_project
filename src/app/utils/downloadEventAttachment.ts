import { withBranchScope } from './branchScopeHeaders';

/** Extract `event-files/...` path from a Supabase public object URL (legacy attachments). */
export function storagePathFromSupabaseMemberImagesUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const marker = '/storage/v1/object/public/member-images/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return u.pathname.slice(idx + marker.length).replace(/^\/+/, '');
  } catch {
    return null;
  }
}

/** Resolve `event-files/...` path for an attachment row (new `storage_path` or legacy public `url`). */
export function eventAttachmentStoragePath(a: {
  storage_path?: string | null;
  url?: string | null;
}): string | null {
  const p = typeof a.storage_path === 'string' ? a.storage_path.trim() : '';
  if (p) return p;
  const u = typeof a.url === 'string' ? a.url.trim() : '';
  if (u) return storagePathFromSupabaseMemberImagesUrl(u);
  return null;
}

export async function downloadEventAttachmentFile(params: {
  token: string;
  branchId?: string | null;
  storagePath: string;
  filename: string;
  contentType?: string | null;
}): Promise<void> {
  const q = new URLSearchParams();
  q.set('path', params.storagePath);
  q.set('name', params.filename);
  if (params.contentType?.trim()) q.set('type', params.contentType.trim());

  const res = await fetch(`/api/download-event-file?${q}`, {
    headers: withBranchScope(params.branchId, { Authorization: `Bearer ${params.token}` }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Download failed');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = params.filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
