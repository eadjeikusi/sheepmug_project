import imageCompression from 'browser-image-compression';

/** Must match server `MAX_STORED_PUBLIC_IMAGE_BYTES` in `src/server/compressImageBuffer.ts`. */
export const MAX_STORED_IMAGE_BYTES = 80 * 1024;
export const MAX_STORED_IMAGE_MB = MAX_STORED_IMAGE_BYTES / 1024 / 1024;

/** Profile / member avatar uploads — tight dimension cap helps hit storage limit before upload. */
export const MEMBER_PROFILE_PHOTO_OPTIONS = {
  maxWidthOrHeight: 900,
  maxSizeMB: MAX_STORED_IMAGE_MB,
} as const;

/** Event covers & public ministry banners — still capped at {@link MAX_STORED_IMAGE_BYTES} on the server. */
export const PUBLIC_BANNER_IMAGE_OPTIONS = {
  maxWidthOrHeight: 1600,
  maxSizeMB: MAX_STORED_IMAGE_MB,
} as const;

async function compressOnce(
  file: File,
  maxWidthOrHeight: number,
  maxSizeMB: number,
): Promise<File> {
  return imageCompression(file, {
    maxSizeMB,
    maxWidthOrHeight,
    useWebWorker: true,
    initialQuality: 0.82,
  });
}

/** Resize (fit inside box) and compress in the browser before upload. Aspect ratio is preserved. */
export async function compressImageForUpload(
  file: File,
  options?: {
    maxWidthOrHeight?: number;
    maxSizeMB?: number;
  },
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;

  const startMaxW = options?.maxWidthOrHeight ?? 1200;
  let maxSizeMB = options?.maxSizeMB ?? MAX_STORED_IMAGE_MB;
  let dim = startMaxW;

  try {
    let out = await compressOnce(file, dim, maxSizeMB);
    for (let i = 0; i < 16 && out.size > MAX_STORED_IMAGE_BYTES; i++) {
      maxSizeMB = Math.max(0.02, maxSizeMB * 0.86);
      dim = Math.max(400, Math.floor(dim * 0.86));
      out = await compressOnce(out, dim, maxSizeMB);
    }
    return out;
  } catch {
    return file;
  }
}
