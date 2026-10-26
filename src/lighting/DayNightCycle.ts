import * as THREE from 'three';

/**
 * Simulated game clock and the lighting state derived from it.
 *
 * The sun path is a simple stylised arc: sunrise at 06:00 due east, highest
 * at 12:00 (tilted slightly south, as at Sittwe's latitude of ~20° N),
 * sunset at 18:00 due west. It is NOT an astronomical calculation.
 */

export interface LightingState {
  hours: number;
  /** Unit vector pointing from the scene toward the sun. */
  sunDir: THREE.Vector3;
  /** Sun elevation, -1..1 (sine of the arc angle). */
  elevation: number;
  /** 0 at night → 1 in full daylight. */
  day: number;
  /** 0 by day → 1 at full night. */
  night: number;
  /** Strength of sunrise/sunset tint, 0..1. */
  twilight: number;
  keyColor: THREE.Color;
  keyIntensity: number;
  /** Direction of the key light (sun by day, moon by night). */
  keyDir: THREE.Vector3;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  exposure: number;
  stars: number;
}

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const SKY_TOP_DAY = C(0x3f80c8);
const SKY_HOR_DAY = C(0xc2dbee);
const SKY_TOP_NIGHT = C(0x060b1a);
const SKY_HOR_NIGHT = C(0x14203a);
const SKY_TOP_DUSK = C(0x37477a);
const SKY_HOR_DUSK = C(0xf09a5c);
const SUN_DAY = C(0xfff3df);
const SUN_LOW = C(0xffa45e);
const MOON = C(0x9fb4ff);
const GROUND_DAY = C(0x6f6b4f);
const GROUND_NIGHT = C(0x1a1d26);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class DayNightCycle {
  /** Current time of day in hours [0, 24). */
  hours = 9;
  /** Real-time minutes for one full 24 h game day. 0 = time frozen. */
  dayLengthMinutes = 24;
  /** Darkening from weather (0 = clear, 1 = heavy overcast). */
  overcast = 0;

  private readonly state: LightingState = {
    hours: 9,
    sunDir: new THREE.Vector3(),
    elevation: 0,
    day: 1,
    night: 0,
    twilight: 0,
    keyColor: new THREE.Color(),
    keyIntensity: 1,
    keyDir: new THREE.Vector3(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    fogColor: new THREE.Color(),
    exposure: 1,
    stars: 0,
  };

  update(dt: number): void {
    if (this.dayLengthMinutes <= 0) return;
    this.hours = (this.hours + (dt * 24) / (this.dayLengthMinutes * 60)) % 24;
  }

  setHours(h: number): void {
    if (!Number.isFinite(h)) return;
    this.hours = ((h % 24) + 24) % 24;
  }

  /** "HH:MM" */
  clockString(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  compute(): LightingState {
    const s = this.state;
    s.hours = this.hours;
    const theta = ((this.hours - 6) / 12) * Math.PI; // 0 at 06:00, π at 18:00
    const elev = Math.sin(theta);
    s.elevation = elev;
    // East (+X) → up/south → west (-X).
    s.sunDir.set(Math.cos(theta), Math.sin(theta) * 0.94, Math.sin(theta) * 0.34).normalize();
    const day = smoothstep(-0.12, 0.22, elev);
    const twilight = Math.exp(-(((elev - 0.02) / 0.16) ** 2));
    const oc = this.overcast;
    s.day = day;
    s.night = 1 - smoothstep(-0.2, 0.08, elev);
    s.twilight = twilight;

    s.skyTop.copy(SKY_TOP_NIGHT).lerp(SKY_TOP_DAY, day).lerp(SKY_TOP_DUSK, twilight * 0.6);
    s.skyHorizon.copy(SKY_HOR_NIGHT).lerp(SKY_HOR_DAY, day).lerp(SKY_HOR_DUSK, twilight * 0.75);
    if (oc > 0) {
      const grey = new THREE.Color(0x8a9097).multiplyScalar(0.25 + 0.75 * day);
      s.skyTop.lerp(grey, oc * 0.8);
      s.skyHorizon.lerp(grey, oc * 0.7);
    }
    s.fogColor.copy(s.skyHorizon);

    if (elev > -0.05) {
      s.keyDir.copy(s.sunDir);
      if (s.keyDir.y < 0.05) s.keyDir.y = 0.05;
      s.keyDir.normalize();
      s.keyColor.copy(SUN_DAY).lerp(SUN_LOW, Math.min(1, twilight * 1.1));
      s.keyIntensity = (0.15 + 2.9 * day) * (1 - oc * 0.6);
    } else {
      // Moonlight from the opposite side of the sky.
      s.keyDir.set(-s.sunDir.x * 0.6, 0.75, -s.sunDir.z - 0.2).normalize();
      s.keyColor.copy(MOON);
      s.keyIntensity = 0.32 * s.night * (1 - oc * 0.7);
    }

    s.hemiSky.copy(s.skyTop).lerp(s.skyHorizon, 0.4);
    s.hemiGround.copy(GROUND_NIGHT).lerp(GROUND_DAY, day);
    s.hemiIntensity = (0.35 + 1.05 * day) * (1 - oc * 0.25);
    s.exposure = 1.0 + s.night * 0.25;
    s.stars = smoothstep(0.35, 0.95, s.night) * (1 - oc);
    return s;
  }
}
