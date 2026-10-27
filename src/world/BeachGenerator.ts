import * as THREE from 'three';
import { SurfaceY } from './materials';

/**
 * Sandy beach band along the real sea coastline (generated: OpenStreetMap has
 * no beach areas mapped in Sittwe). It starts just under the water so no gap
 * shows, runs 8–18 m up the shore, is dark and wet at the waterline, dry and
 * pale higher up, and fades into the ground. Wild mangrove shores get darker,
 * muddier sand. The texture is generated: sand grains, wind ripples, shell
 * fragments and a matching normal map.
 */

const TEX = 512;
const UV_METRES = 6;

let material: THREE.MeshStandardMaterial | null = null;

function noise2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise (tileable over `period` cells). */
function smooth(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => noise2(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

function sandTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const height = new Float32Array(TEX * TEX);
  const color = document.createElement('canvas');
  color.width = color.height = TEX;
  const cg = color.getContext('2d')!;
  const img = cg.createImageData(TEX, TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const i = y * TEX + x;
    // Wind ripples: wavy parallel ridges, broken up by low-frequency noise.
    const warp = smooth(x / 64, y / 64, TEX / 64, 1) * 9;
    const ripple = Math.sin((y + warp * 4) / TEX * Math.PI * 2 * 22) * 0.5 + 0.5;
    const patch = smooth(x / 32, y / 32, TEX / 32, 2);
    const grain = noise2(x, y, 3);
    height[i] = ripple * 0.6 * (0.6 + patch * 0.4) + grain * 0.25;
    let r = 214, g = 196, b = 156; // dry sand
    const shade = 0.86 + patch * 0.12 + (grain - 0.5) * 0.16 + (ripple - 0.5) * 0.06;
    r *= shade; g *= shade; b *= shade;
    // Scattered darker mineral grains and pale shell fragments.
    const speck = noise2(x * 1.3, y * 1.7, 4);
    if (speck > 0.985) { r *= 0.55; g *= 0.52; b *= 0.5; }
    else if (speck < 0.004) { r = 238; g = 232; b = 218; }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  cg.putImageData(img, 0, 0);
  const normal = document.createElement('canvas');
  normal.width = normal.height = TEX;
  const ng = normal.getContext('2d')!;
  const nimg = ng.createImageData(TEX, TEX);
  const at = (x: number, y: number) => height[((y + TEX) % TEX) * TEX + ((x + TEX) % TEX)]!;
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * TEX + x) * 4;
    nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    nimg.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
    nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    nimg.data[i + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const nmap = new THREE.CanvasTexture(normal);
  for (const t of [map, nmap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, normal: nmap };
}

export function beachMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  const { map, normal } = sandTextures();
  material = new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.96,
    metalness: 0,
    vertexColors: true,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  return material;
}

export interface BeachContext {
  isWater: (x: number, z: number) => boolean;
  /** Wild (no buildings or roads nearby): muddy mangrove shore. */
  wild: (x: number, z: number) => boolean;
}

/** Builds the sand band for the coastline segments [x1,z1,x2,z2,…] of one chunk. */
export function buildBeachGeometry(coast: number[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, ctx: BeachContext): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const y = SurfaceY.landuse + 0.006;
  // Across the band: 2 m under the water, waterline, wet edge, dry sand, fade-out.
  const across = [-2, 0, 2.5, 0.65, 1];
  for (let i = 0; i < coast.length; i += 4) {
    let ax = coast[i]!, az = coast[i + 1]!, bx = coast[i + 2]!, bz = coast[i + 3]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (mx < bounds.minX || mx >= bounds.maxX || mz < bounds.minZ || mz >= bounds.maxZ) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    let nx = -uz, nz = ux;
    if (ctx.isWater(mx + nx * 4, mz + nz * 4)) { nx = -nx; nz = -nz; }
    if (ctx.isWater(mx + nx * 4, mz + nz * 4)) continue;
    // Overlap neighbours a little so corners have no gaps (same texture: no seams).
    ax -= ux * 1.5; az -= uz * 1.5; bx += ux * 1.5; bz += uz * 1.5;
    const width = (x: number, z: number) => 8 + 10 * (0.5 + 0.5 * Math.sin(x * 0.031 + z * 0.017) * Math.cos(z * 0.023 - x * 0.011));
    const wa = width(ax, az), wb = width(bx, bz);
    const mud = ctx.wild(mx + nx * 6, mz + nz * 6);
    const base = pos.length / 3;
    for (const [px, pz, w] of [[ax, az, wa], [bx, bz, wb]] as const) {
      across.forEach((k, j) => {
        const d = j === 0 ? -2 : j === 1 ? 0 : j === 2 ? 2.5 : k * w;
        const x = px + nx * d, z = pz + nz * d;
        pos.push(x, y, z);
        uv.push(x / UV_METRES, z / UV_METRES);
        // Wet sand is darker; mangrove mud darker and greyer still.
        const wet = j <= 1 ? 0.62 : j === 2 ? 0.8 : 1;
        const tint = mud ? [0.72, 0.68, 0.62] : [1, 1, 1];
        col.push(wet * tint[0]!, wet * tint[1]!, wet * tint[2]!, j === 4 ? 0 : 1);
      });
    }
    const n = across.length;
    for (let j = 0; j < n - 1; j++) {
      const a = base + j, b = base + j + 1, c = base + n + j, d = base + n + j + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  // Triangles may face either way depending on segment direction: make them face up.
  const p = g.getAttribute('position');
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const cross = (p.getX(i1) - p.getX(i0)) * (p.getZ(i2) - p.getZ(i0)) - (p.getZ(i1) - p.getZ(i0)) * (p.getX(i2) - p.getX(i0));
    if (cross > 0) { idx[t + 1] = i2; idx[t + 2] = i1; }
  }
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
