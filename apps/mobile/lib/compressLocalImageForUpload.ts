import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";

/** Match server `/api/upload-image` cap (see `src/server/compressImageBuffer.ts`). */
export const MAX_PROFILE_IMAGE_UPLOAD_BYTES = 80 * 1024;

/**
 * Resize/recompress a local image URI until it is under {@link MAX_PROFILE_IMAGE_UPLOAD_BYTES}
 * (or attempts exhausted). Returns a JPEG `file://` URI suitable for multipart upload.
 */
function fileSizeIfKnown(info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>>): number | null {
  if (!info.exists) return null;
  const sz = (info as { size?: unknown }).size;
  return typeof sz === "number" && sz > 0 ? sz : null;
}

export async function compressLocalImageForUpload(localUri: string): Promise<string> {
  try {
    const initialInfo = await FileSystem.getInfoAsync(localUri);
    const initialSize = fileSizeIfKnown(initialInfo);
    if (initialSize != null && initialSize <= MAX_PROFILE_IMAGE_UPLOAD_BYTES) {
      return localUri;
    }
  } catch {
    // continue with compression
  }

  let width = 1100;
  let compress = 0.82;
  let uri = localUri;

  for (let i = 0; i < 28; i++) {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress, format: ImageManipulator.SaveFormat.JPEG }
    );
    uri = result.uri;

    const info = await FileSystem.getInfoAsync(uri);
    const size = fileSizeIfKnown(info) ?? 0;
    if (size > 0 && size <= MAX_PROFILE_IMAGE_UPLOAD_BYTES) {
      return uri;
    }

    if (compress > 0.38) {
      compress -= 0.07;
    } else {
      width = Math.max(280, Math.floor(width * 0.82));
      compress = 0.78;
    }
  }

  return uri;
}
