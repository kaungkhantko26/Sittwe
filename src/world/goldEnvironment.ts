import * as THREE from 'three';

/**
 * Physically based gold needs something to reflect: without an environment
 * map, metallic surfaces only show the sun's highlight and look dull brown.
 * We build a small sky-gradient environment (PMREM) once and give it to the
 * gold materials; its intensity follows the day/night cycle. At night the
 * registered landmark materials receive a warm "floodlit" emissive term
 * (static lighting — no extra dynamic lights).
 */

let envMap: THREE.Texture | null = null;
const reflective = new Set<THREE.MeshStandardMaterial>();
const floodlit = new Map<THREE.MeshStandardMaterial, number>();

function skyCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#5f8fc9'); // zenith
  grad.addColorStop(0.45, '#cfe0ef'); // horizon
  grad.addColorStop(0.52, '#b7aa8a'); // ground at the horizon
  grad.addColorStop(1, '#5b5447'); // ground
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  // A soft bright patch for the sun so gold gets a broad warm sheen.
  const sun = g.createRadialGradient(64, 34, 0, 64, 34, 40);
  sun.addColorStop(0, 'rgba(255,244,214,0.95)');
  sun.addColorStop(1, 'rgba(255,244,214,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 256, 128);
  return c;
}

/** Call once after the renderer exists. */
export function initGoldEnvironment(renderer: THREE.WebGLRenderer): void {
  if (envMap || typeof document === 'undefined') return;
  const tex = new THREE.CanvasTexture(skyCanvas());
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  for (const m of reflective) {
    m.envMap = envMap;
    if (typeof m.userData['metalness'] === 'number') m.metalness = m.userData['metalness'] as number;
    m.needsUpdate = true;
  }
}

/** Registers a metallic material to reflect the environment. */
export function makeReflective(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  reflective.add(m);
  if (envMap) {
    m.envMap = envMap;
    m.needsUpdate = true;
  } else {
    // Without an environment, fully metallic surfaces render nearly black.
    // Use a safe partly-metallic look until initGoldEnvironment() runs.
    m.userData['metalness'] = m.metalness;
    m.metalness = Math.min(m.metalness, 0.45);
  }
  return m;
}

/** Registers a material to glow warmly at night (floodlighting) with the given strength. */
export function makeFloodlit(m: THREE.MeshStandardMaterial, strength: number, color = 0xffc86a): THREE.MeshStandardMaterial {
  m.emissive = new THREE.Color(color);
  m.emissiveIntensity = 0;
  floodlit.set(m, strength);
  return m;
}

export function releaseMaterial(m: THREE.MeshStandardMaterial): void {
  reflective.delete(m);
  floodlit.delete(m);
}

/** Per-frame: reflections follow daylight; floodlights come on at night. */
export function updateGoldEnvironment(day: number, night: number): void {
  const k = 0.25 + 0.85 * day;
  for (const m of reflective) m.envMapIntensity = k;
  const glow = Math.max(0, (night - 0.25) / 0.75);
  for (const [m, s] of floodlit) m.emissiveIntensity = glow * s;
}
