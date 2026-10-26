/**
 * Player preferences (graphics, audio, camera, language), persisted in
 * localStorage separately from the save game so a reset keeps preferences.
 */

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type Lang = 'en' | 'rki';

export interface Settings {
  quality: Quality;
  showFps: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  cameraDistance: number;
  fov: number;
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  muted: boolean;
  /** Real minutes per in-game day (0 = frozen clock). */
  dayLengthMinutes: number;
  rain: boolean;
  language: Lang;
  playerName: string;
  minimapRotate: boolean;
  character: 'boy' | 'girl';
}

export interface QualityPreset {
  label: string;
  pixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  viewRadius: number;
  physicsRadius: number;
  detailRadius: number;
  vegetationDensity: number;
  maxPointLights: number;
  fogFar: number;
  trafficCars: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { label: 'Low', pixelRatio: 1, antialias: false, shadowMapSize: 0, viewRadius: 1, physicsRadius: 1, detailRadius: 1, vegetationDensity: 0.35, maxPointLights: 2, fogFar: 380, trafficCars: 4 },
  medium: { label: 'Medium', pixelRatio: 1.25, antialias: true, shadowMapSize: 1024, viewRadius: 2, physicsRadius: 1, detailRadius: 1, vegetationDensity: 0.65, maxPointLights: 4, fogFar: 650, trafficCars: 8 },
  high: { label: 'High', pixelRatio: 1.5, antialias: true, shadowMapSize: 2048, viewRadius: 3, physicsRadius: 1, detailRadius: 2, vegetationDensity: 1, maxPointLights: 6, fogFar: 900, trafficCars: 12 },
  ultra: { label: 'Ultra', pixelRatio: 2, antialias: true, shadowMapSize: 4096, viewRadius: 4, physicsRadius: 1, detailRadius: 3, vegetationDensity: 1.3, maxPointLights: 8, fogFar: 1300, trafficCars: 18 },
};

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  showFps: true,
  mouseSensitivity: 1,
  invertY: false,
  cameraDistance: 5.5,
  fov: 62,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  ambienceVolume: 0.6,
  muted: false,
  dayLengthMinutes: 24,
  rain: false,
  language: 'en',
  playerName: 'Player',
  minimapRotate: false,
  character: 'boy',
};

const KEY = 'sittwe3d.settings.v1';

const num = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

/** Validates and clamps arbitrary input into a complete Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const quality = (['low', 'medium', 'high', 'ultra'] as const).includes(r['quality'] as Quality) ? (r['quality'] as Quality) : d.quality;
  // 'my' (Burmese) was the previous second language; migrate it to Rakhine.
  const language: Lang = r['language'] === 'rki' || r['language'] === 'my' ? 'rki' : r['language'] === 'en' ? 'en' : d.language;
  const name = typeof r['playerName'] === 'string' ? r['playerName'].trim().slice(0, 24) : '';
  return {
    quality,
    showFps: bool(r['showFps'], d.showFps),
    mouseSensitivity: num(r['mouseSensitivity'], 0.1, 3, d.mouseSensitivity),
    invertY: bool(r['invertY'], d.invertY),
    cameraDistance: num(r['cameraDistance'], 2.2, 16, d.cameraDistance),
    fov: num(r['fov'], 45, 90, d.fov),
    masterVolume: num(r['masterVolume'], 0, 1, d.masterVolume),
    sfxVolume: num(r['sfxVolume'], 0, 1, d.sfxVolume),
    ambienceVolume: num(r['ambienceVolume'], 0, 1, d.ambienceVolume),
    muted: bool(r['muted'], d.muted),
    dayLengthMinutes: num(r['dayLengthMinutes'], 0, 240, d.dayLengthMinutes),
    rain: bool(r['rain'], d.rain),
    language,
    playerName: name || d.playerName,
    minimapRotate: bool(r['minimapRotate'], d.minimapRotate),
    character: r['character'] === 'girl' ? 'girl' : 'boy',
  };
}

export class SettingsStore {
  private value: Settings;
  private readonly listeners: Array<(s: Settings, prev: Settings) => void> = [];

  constructor(private readonly storage: Storage | null = safeStorage()) {
    let raw: unknown = null;
    try {
      const s = this.storage?.getItem(KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    this.value = sanitizeSettings(raw);
  }

  get(): Settings {
    return this.value;
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.value.quality];
  }

  update(patch: Partial<Settings>): void {
    const prev = this.value;
    this.value = sanitizeSettings({ ...prev, ...patch });
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage full or unavailable: keep in memory */
    }
    for (const l of this.listeners) l(this.value, prev);
  }

  onChange(fn: (s: Settings, prev: Settings) => void): void {
    this.listeners.push(fn);
  }

  reset(): void {
    this.update(DEFAULT_SETTINGS);
  }
}

export function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const k = '__sittwe3d_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
