import { describe, expect, it } from 'vitest';
import { SaveManager, serializeSave, validateSave, SAVE_VERSION, type SaveData } from '../src/systems/SaveManager';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/systems/Settings';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const sample: Omit<SaveData, 'version' | 'savedAt'> = {
  player: { x: 12.5, y: 0, z: -40, yaw: 1.2 },
  drivingVehicle: null,
  selectedVehicle: 1,
  vehicles: [{ x: 1, y: 0.6, z: 2, qx: 0, qy: 0.1, qz: 0, qw: 0.99 }, { x: 5, y: 0.6, z: 9, qx: 0, qy: 0, qz: 0, qw: 1 }],
  timeOfDay: 18.25,
  camera: { yaw: 0.3, pitch: 0.2, distance: 6, mode: 'third', vehicleMode: 'chase' },
  destination: { x: 100, z: 200 },
};

describe('SaveManager', () => {
  it('round-trips a save', () => {
    const s = new SaveManager(new MemStorage());
    expect(s.save(sample)).toBe(true);
    const r = s.load();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.version).toBe(SAVE_VERSION);
      expect(r.data.player).toEqual(sample.player);
      expect(r.data.vehicles).toEqual(sample.vehicles);
      expect(r.data.destination).toEqual(sample.destination);
    }
  });

  it('reports "none" when nothing is saved', () => {
    expect(new SaveManager(new MemStorage()).load()).toEqual({ ok: false, reason: 'none' });
    expect(new SaveManager(null).load().ok).toBe(false);
  });

  it('handles corrupted JSON gracefully and quarantines it', () => {
    const st = new MemStorage();
    st.setItem('sittwe3d.save', '{not json');
    const s = new SaveManager(st);
    const r = s.load();
    expect(r).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(st.getItem('sittwe3d.save')).toBeNull();
    expect(st.getItem('sittwe3d.save.corrupt-backup')).toBe('{not json');
  });

  it('rejects wrong versions and invalid fields', () => {
    const full = { ...sample, version: SAVE_VERSION, savedAt: 'x' };
    expect(validateSave({ ...full, version: 99 })).toMatchObject({ ok: false, reason: 'version' });
    expect(validateSave({ ...full, player: { x: Number.NaN, y: 0, z: 0, yaw: 0 } }).ok).toBe(false);
    expect(validateSave({ ...full, timeOfDay: 30 }).ok).toBe(false);
    expect(validateSave({ ...full, drivingVehicle: 7 }).ok).toBe(false);
    expect(validateSave(JSON.parse(serializeSave(full as SaveData))).ok).toBe(true);
  });
});

describe('settings validation', () => {
  it('clamps and defaults', () => {
    const s = sanitizeSettings({ quality: 'insane', mouseSensitivity: 99, playerName: '   ', language: 'my', fov: 'x' });
    expect(sanitizeSettings({ language: 'rki' }).language).toBe('rki');
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.mouseSensitivity).toBe(3);
    expect(s.playerName).toBe('Player');
    expect(s.language).toBe('rki'); // legacy Burmese setting migrates to Rakhine
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov);
  });
});
