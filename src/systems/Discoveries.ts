import { safeStorage } from './Settings';

/**
 * Landmarks the player has discovered, persisted in localStorage with a
 * versioned, validated schema (kept separate from the save game so a
 * discovery is never lost by loading an older save).
 */
const KEY = 'sittwe3d.discoveries';
const VERSION = 1;

export interface DiscoveryData {
  version: typeof VERSION;
  /** Landmark id → ISO date discovered. */
  found: Record<string, string>;
}

export function parseDiscoveries(raw: unknown): DiscoveryData {
  const empty: DiscoveryData = { version: VERSION, found: {} };
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  if (r['version'] !== VERSION || !r['found'] || typeof r['found'] !== 'object') return empty;
  const found: Record<string, string> = {};
  for (const [k, v] of Object.entries(r['found'] as Record<string, unknown>)) {
    if (typeof k === 'string' && k.length < 64 && typeof v === 'string' && !Number.isNaN(Date.parse(v))) found[k] = v;
  }
  return { version: VERSION, found };
}

export class Discoveries {
  private data: DiscoveryData;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    let raw: unknown = null;
    try {
      const s = this.storage?.getItem(KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    this.data = parseDiscoveries(raw);
  }

  has(id: string): boolean {
    return id in this.data.found;
  }

  when(id: string): string | undefined {
    return this.data.found[id];
  }

  get count(): number {
    return Object.keys(this.data.found).length;
  }

  /** Marks a landmark discovered. Returns true if it is new. */
  discover(id: string, at = new Date()): boolean {
    if (this.has(id)) return false;
    this.data.found[id] = at.toISOString();
    this.persist();
    return true;
  }

  clear(): void {
    this.data = { version: VERSION, found: {} };
    this.persist();
  }

  private persist(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: keep in memory */
    }
  }
}
