const STORE_KEY = 'sheepmug-debug-log';
const MAX_ENTRIES = 500;

type DebugEntry = { t: number; event: string; data: Record<string, unknown> };

function readStore(): DebugEntry[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeStore(entries: DebugEntry[]): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore */
  }
}

export function dlog(event: string, data: Record<string, unknown> = {}): void {
  const entry: DebugEntry = { t: Date.now(), event, data };
  try {
    // eslint-disable-next-line no-console
    console.log(`[sheepmug-debug] ${event}`, data);
  } catch {
    /* ignore */
  }
  try {
    const entries = readStore();
    entries.push(entry);
    writeStore(entries);
  } catch {
    /* ignore */
  }
}

let dumped = false;
export function dumpPriorDebugLogs(tag = 'prior'): void {
  if (dumped) return;
  dumped = true;
  try {
    const entries = readStore();
    if (!entries.length) {
      // eslint-disable-next-line no-console
      console.log(`[sheepmug-debug ${tag}] (no prior entries)`);
      return;
    }
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[sheepmug-debug ${tag}] ${entries.length} entries from previous page(s)`);
    for (const e of entries) {
      const ts = new Date(e.t).toISOString().slice(11, 23);
      // eslint-disable-next-line no-console
      console.log(`${ts} ${e.event}`, e.data);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  } catch {
    /* ignore */
  }
}

export function clearDebugLogs(): void {
  try {
    sessionStorage.removeItem(STORE_KEY);
    dumped = false;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).sheepmugClearDebug = clearDebugLogs;
  }
}

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.sheepmugDumpDebug = () => {
    dumped = false;
    dumpPriorDebugLogs('on-demand');
  };
  w.sheepmugClearDebug = clearDebugLogs;
}
