import { getOfflineMeta, setOfflineMeta } from "../storage";

const OFFLINE_MANIFEST_KEY = "manifest_v1_json";

export type OfflineManifest = {
  version: number;
  last_bootstrap_at: string | null;
  last_delta_at: string | null;
  bootstrapped_entities: string[];
  cursors: Record<string, string>;
};

function defaultManifest(): OfflineManifest {
  return {
    version: 1,
    last_bootstrap_at: null,
    last_delta_at: null,
    bootstrapped_entities: [],
    cursors: {},
  };
}

export async function getOfflineManifest(): Promise<OfflineManifest> {
  const raw = await getOfflineMeta(OFFLINE_MANIFEST_KEY);
  if (!raw) return defaultManifest();
  try {
    const parsed = JSON.parse(raw) as OfflineManifest;
    if (!parsed || typeof parsed !== "object") return defaultManifest();
    return {
      version: Number(parsed.version || 1),
      last_bootstrap_at: parsed.last_bootstrap_at || null,
      last_delta_at: parsed.last_delta_at || null,
      bootstrapped_entities: Array.isArray(parsed.bootstrapped_entities)
        ? parsed.bootstrapped_entities.map((x) => String(x))
        : [],
      cursors: parsed.cursors && typeof parsed.cursors === "object" ? parsed.cursors : {},
    };
  } catch {
    return defaultManifest();
  }
}

export async function setOfflineManifest(next: OfflineManifest): Promise<void> {
  await setOfflineMeta(OFFLINE_MANIFEST_KEY, JSON.stringify(next));
}

export async function patchOfflineManifest(
  patch: Partial<OfflineManifest>
): Promise<OfflineManifest> {
  const prev = await getOfflineManifest();
  const next: OfflineManifest = {
    ...prev,
    ...patch,
    bootstrapped_entities: patch.bootstrapped_entities ?? prev.bootstrapped_entities,
    cursors: patch.cursors ?? prev.cursors,
  };
  await setOfflineManifest(next);
  return next;
}
