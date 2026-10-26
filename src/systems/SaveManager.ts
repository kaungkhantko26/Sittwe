/**
 * Versioned local save game. Preferences (graphics/audio/camera settings) are
 * persisted by SettingsStore; the save stores world state.
 */

export const SAVE_VERSION = 1;
const KEY = 'sittwe3d.save';
const BACKUP_KEY = 'sittwe3d.save.corrupt-backup';

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  savedAt: string;
  player: { x: number; y: number; z: number; yaw: number };
  /** Index of the vehicle being driven, or null when on foot. */
  drivingVehicle: number | null;
  /** Index of the player's chosen/last-used vehicle. */
  selectedVehicle: number;
  vehicles: VehicleState[];
  timeOfDay: number;
  camera: { yaw: number; pitch: number; distance: number; mode: string; vehicleMode: string };
  destination: { x: number; z: number } | null;
}

export type LoadResult = { ok: true; data: SaveData } | { ok: false; reason: 'none' | 'corrupt' | 'version' | 'invalid'; detail?: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Bounds a value must stay within (meters from the origin). */
const MAX_COORD = 50_000;

export function validateSave(raw: unknown): LoadResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid', detail: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r['version'] !== SAVE_VERSION) return { ok: false, reason: 'version', detail: `unsupported version ${String(r['version'])}` };
  const p = r['player'] as Record<string, unknown> | undefined;
  if (!p || !isNum(p['x']) || !isNum(p['y']) || !isNum(p['z']) || !isNum(p['yaw'])) return { ok: false, reason: 'invalid', detail: 'player' };
  if (Math.abs(p['x']) > MAX_COORD || Math.abs(p['z']) > MAX_COORD) return { ok: false, reason: 'invalid', detail: 'player out of bounds' };
  const vehicles = r['vehicles'];
  if (!Array.isArray(vehicles)) return { ok: false, reason: 'invalid', detail: 'vehicles' };
  for (const v of vehicles) {
    const o = v as Record<string, unknown>;
    if (!o || !['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw'].every((k) => isNum(o[k]))) return { ok: false, reason: 'invalid', detail: 'vehicle state' };
  }
  const driving = r['drivingVehicle'];
  if (driving !== null && !(Number.isInteger(driving) && (driving as number) >= 0 && (driving as number) < vehicles.length)) return { ok: false, reason: 'invalid', detail: 'drivingVehicle' };
  const sel = r['selectedVehicle'];
  if (!Number.isInteger(sel) || (sel as number) < 0) return { ok: false, reason: 'invalid', detail: 'selectedVehicle' };
  if (!isNum(r['timeOfDay']) || (r['timeOfDay'] as number) < 0 || (r['timeOfDay'] as number) >= 24) return { ok: false, reason: 'invalid', detail: 'timeOfDay' };
  const cam = r['camera'] as Record<string, unknown> | undefined;
  if (!cam || !isNum(cam['yaw']) || !isNum(cam['pitch']) || !isNum(cam['distance'])) return { ok: false, reason: 'invalid', detail: 'camera' };
  const dest = r['destination'];
  if (dest !== null && dest !== undefined) {
    const d = dest as Record<string, unknown>;
    if (!isNum(d['x']) || !isNum(d['z'])) return { ok: false, reason: 'invalid', detail: 'destination' };
  }
  const data: SaveData = {
    version: SAVE_VERSION,
    savedAt: typeof r['savedAt'] === 'string' ? r['savedAt'] : new Date(0).toISOString(),
    player: { x: p['x'], y: p['y'], z: p['z'], yaw: p['yaw'] },
    drivingVehicle: driving as number | null,
    selectedVehicle: sel as number,
    vehicles: vehicles as VehicleState[],
    timeOfDay: r['timeOfDay'] as number,
    camera: {
      yaw: cam['yaw'] as number,
      pitch: cam['pitch'] as number,
      distance: cam['distance'] as number,
      mode: typeof cam['mode'] === 'string' ? cam['mode'] : 'third',
      vehicleMode: typeof cam['vehicleMode'] === 'string' ? cam['vehicleMode'] : 'chase',
    },
    destination: dest ? { x: (dest as { x: number }).x, z: (dest as { z: number }).z } : null,
  };
  return { ok: true, data };
}

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data);
}

export class SaveManager {
  constructor(private readonly storage: Storage | null) {}

  hasSave(): boolean {
    return this.load().ok;
  }

  save(data: Omit<SaveData, 'version' | 'savedAt'>): boolean {
    if (!this.storage) return false;
    const full: SaveData = { ...data, version: SAVE_VERSION, savedAt: new Date().toISOString() };
    try {
      this.storage.setItem(KEY, serializeSave(full));
      return true;
    } catch (e) {
      console.warn('[Save] could not write save', e);
      return false;
    }
  }

  load(): LoadResult {
    if (!this.storage) return { ok: false, reason: 'none' };
    let text: string | null;
    try {
      text = this.storage.getItem(KEY);
    } catch {
      return { ok: false, reason: 'none' };
    }
    if (!text) return { ok: false, reason: 'none' };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      this.quarantine(text);
      return { ok: false, reason: 'corrupt', detail: (e as Error).message };
    }
    const res = validateSave(raw);
    if (!res.ok) this.quarantine(text);
    return res;
  }

  /** Moves an unreadable save aside so it does not block new saves. */
  private quarantine(text: string): void {
    try {
      this.storage?.setItem(BACKUP_KEY, text);
      this.storage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
