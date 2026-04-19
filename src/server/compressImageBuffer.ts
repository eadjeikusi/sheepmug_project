import sharp from "sharp";

/** Hard cap for images stored via `/api/upload-image` (and image event attachments). */
export const MAX_STORED_PUBLIC_IMAGE_BYTES = 80 * 1024;

/**
 * Ensures buffer is at most {@link MAX_STORED_PUBLIC_IMAGE_BYTES}.
 * Re-encodes to JPEG when compression is required (GIF uses first frame only).
 */
export async function compressImageBufferForPublicUpload(
  input: Buffer,
  originalMime: string
): Promise<{ buffer: Buffer; contentType: string; fileExt: string }> {
  const mime = (originalMime || "").toLowerCase();
  const underCap = input.length <= MAX_STORED_PUBLIC_IMAGE_BYTES;
  if (underCap) {
    if (mime === "image/jpeg" || mime === "image/jpg") {
      return { buffer: input, contentType: "image/jpeg", fileExt: "jpg" };
    }
    if (mime === "image/png") {
      return { buffer: input, contentType: "image/png", fileExt: "png" };
    }
    if (mime === "image/webp") {
      return { buffer: input, contentType: "image/webp", fileExt: "webp" };
    }
    if (mime === "image/gif") {
      return { buffer: input, contentType: "image/gif", fileExt: "gif" };
    }
  }

  let maxSide = 1920;
  let quality = 80;

  for (let attempt = 0; attempt < 40; attempt++) {
    const buf = await sharp(input, {
      failOn: "none",
      animated: false,
      limitInputPixels: 268_402_689,
    })
      .rotate()
      .resize({
        width: maxSide,
        height: maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toBuffer();

    if (buf.length <= MAX_STORED_PUBLIC_IMAGE_BYTES) {
      return { buffer: buf, contentType: "image/jpeg", fileExt: "jpg" };
    }

    if (quality > 32) {
      quality -= 5;
    } else {
      maxSide = Math.max(240, Math.floor(maxSide * 0.78));
      quality = 78;
    }
  }

  const last = await sharp(input, {
    failOn: "none",
    animated: false,
    limitInputPixels: 268_402_689,
  })
    .rotate()
    .resize(240, 240, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 26, mozjpeg: true })
    .toBuffer();

  if (last.length > MAX_STORED_PUBLIC_IMAGE_BYTES) {
    throw new Error("Image could not be compressed under the storage limit");
  }
  return { buffer: last, contentType: "image/jpeg", fileExt: "jpg" };
}
