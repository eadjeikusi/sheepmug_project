import * as FileSystem from "expo-file-system/legacy";
import { normalizeImageUri } from "../imageUri";
import { getOfflineMeta, setOfflineMeta } from "../storage";

const IMAGE_DIR_NAME = "offline-images";
const IMAGE_MAP_META_KEY = "image_map_json";

const IMAGE_FIELD_NAMES = new Set([
  "avatar_url",
  "member_url",
  "profile_image",
  "memberimage_url",
  "cover_image_url",
  "member_image_url",
]);

function looksLikeImageField(key: string): boolean {
  const k = key.toLowerCase();
  return (
    IMAGE_FIELD_NAMES.has(k) ||
    k.endsWith("_image") ||
    k.endsWith("_image_url") ||
    k.endsWith("_avatar") ||
    k.endsWith("_avatar_url") ||
    k.endsWith("_url") ||
    k.includes("image") ||
    k.includes("avatar") ||
    k.includes("photo")
  );
}

function looksLikeImageUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (v.startsWith("file://")) return true;
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//") || v.startsWith("/")) {
    if (v.includes("/storage/v1/object/public/")) return true;
    if (v.includes("/uploads/")) return true;
    if (/\.(png|jpe?g|webp|gif|heic|bmp)(\?|$)/i.test(v)) return true;
    if (v.includes("image") || v.includes("avatar") || v.includes("photo")) return true;
  }
  return false;
}

let imageMapMemo: Record<string, string> | null = null;

function imageDir(): string {
  const root = FileSystem.documentDirectory || FileSystem.cacheDirectory || "";
  return `${root}${IMAGE_DIR_NAME}`;
}

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function imagePathForUrl(remoteUrl: string): string {
  const clean = remoteUrl.split("?")[0];
  const ext =
    clean.toLowerCase().endsWith(".png") ? ".png" :
    clean.toLowerCase().endsWith(".webp") ? ".webp" :
    clean.toLowerCase().endsWith(".gif") ? ".gif" : ".jpg";
  return `${imageDir()}/${stableHash(remoteUrl)}${ext}`;
}

async function ensureImageDir(): Promise<void> {
  const dir = imageDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function loadImageMap(): Promise<Record<string, string>> {
  if (imageMapMemo) return imageMapMemo;
  const raw = await getOfflineMeta(IMAGE_MAP_META_KEY);
  if (!raw) {
    imageMapMemo = {};
    return imageMapMemo;
  }
  try {
    imageMapMemo = JSON.parse(raw) as Record<string, string>;
    return imageMapMemo && typeof imageMapMemo === "object" ? imageMapMemo : {};
  } catch {
    imageMapMemo = {};
    return imageMapMemo;
  }
}

async function saveImageMap(next: Record<string, string>): Promise<void> {
  imageMapMemo = next;
  await setOfflineMeta(IMAGE_MAP_META_KEY, JSON.stringify(next));
}

export async function clearOfflineImageFiles(): Promise<void> {
  const dir = imageDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (info.exists) {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }
  await saveImageMap({});
}

export async function getOfflineImageCacheSizeBytes(): Promise<number> {
  const dir = imageDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists || !info.isDirectory) return 0;
  const files = await FileSystem.readDirectoryAsync(dir);
  let total = 0;
  for (const file of files) {
    const fInfo = await FileSystem.getInfoAsync(`${dir}/${file}`);
    const size = Number((fInfo as { size?: number }).size ?? 0);
    if (Number.isFinite(size) && size > 0) total += size;
  }
  return total;
}

export async function cacheImageAndGetLocalUri(rawUrl: string): Promise<string | null> {
  const remoteUrl = normalizeImageUri(rawUrl);
  if (!remoteUrl || remoteUrl.startsWith("file:")) return remoteUrl;
  const map = await loadImageMap();
  const mapped = map[remoteUrl];
  if (mapped) {
    const info = await FileSystem.getInfoAsync(mapped);
    if (info.exists) return mapped;
  }

  await ensureImageDir();
  const dest = imagePathForUrl(remoteUrl);
  try {
    await FileSystem.downloadAsync(remoteUrl, dest);
    const next = { ...map, [remoteUrl]: dest };
    await saveImageMap(next);
    return dest;
  } catch {
    return remoteUrl;
  }
}

export async function getCachedImageUri(rawUrl: string | null): Promise<string | null> {
  if (!rawUrl) return null;
  const remoteUrl = normalizeImageUri(rawUrl);
  if (!remoteUrl || remoteUrl.startsWith("file:")) return remoteUrl;
  const map = await loadImageMap();
  const mapped = map[remoteUrl];
  if (!mapped) return remoteUrl;
  const info = await FileSystem.getInfoAsync(mapped);
  return info.exists ? mapped : remoteUrl;
}

function collectImageUrls(input: unknown, out: Set<string>): void {
  if (Array.isArray(input)) {
    for (const item of input) collectImageUrls(item, out);
    return;
  }
  if (!input || typeof input !== "object") return;
  const obj = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && looksLikeImageField(key) && looksLikeImageUrl(value)) {
      out.add(value.trim());
      continue;
    }
    collectImageUrls(value, out);
  }
}

function deepReplaceImageUrls<T>(input: T, urlMap: Record<string, string>): T {
  if (Array.isArray(input)) {
    return input.map((item) => deepReplaceImageUrls(item, urlMap)) as T;
  }
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && looksLikeImageField(key) && looksLikeImageUrl(value)) {
      const normalized = normalizeImageUri(value.trim()) || value.trim();
      next[key] = urlMap[normalized] || normalized;
    } else {
      next[key] = deepReplaceImageUrls(value, urlMap);
    }
  }
  return next as T;
}

export async function hydratePayloadWithOfflineImages<T>(payload: T): Promise<T> {
  const urls = new Set<string>();
  collectImageUrls(payload, urls);
  if (urls.size === 0) return payload;

  const urlMap: Record<string, string> = {};
  for (const raw of urls) {
    const normalized = normalizeImageUri(raw) || raw;
    const local = await cacheImageAndGetLocalUri(normalized);
    if (local) urlMap[normalized] = local;
  }
  return deepReplaceImageUrls(payload, urlMap);
}
