import * as THREE from 'three';
import type { ChunkLandmark } from '../../geo/chunkFormat';
import { PLATFORM_Y, type PagodaLayout } from '../../geo/pagodaLayout';
import { addBeam, addFlatPolygon, GeometryBuilder } from '../GeometryBuilder';
import { makeFloodlit, makeReflective } from '../goldEnvironment';
import { materials } from '../materials';
import { broadleafGeometry, palmGeometry } from '../VegetationGenerator';

/**
 * Lawkanandar Pagoda (လောကနန္ဒာ စေတီတော်), Sittwe — a modular, procedural
 * landmark modelled on the user's asset board and photos. Position, platform
 * outline and orientation come from OSM (node 1230796347 and its mapped
 * footprint); the stupa is sized from published figures (≈49 m tall). The
 * architecture, ornament and the main-hall interior are an artistic
 * reconstruction, labelled as such in game.
 *
 * Geometry and materials are cached and shared between chunk rebuilds.
 * Repeated parts (balustrade posts, small stupas, columns, lamps) are
 * instanced. Three detail levels: full detail near the player, a simplified
 * complex at medium range and the stupa silhouette far away.
 */

// ---------------------------------------------------------------------------
// Shared materials (created once)
// ---------------------------------------------------------------------------

interface PagodaMaterials {
  gold: THREE.MeshStandardMaterial;
  stupaGold: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  courtyard: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
}
let mats: PagodaMaterials | null = null;

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

/** Converts a grey height canvas into a tangent-space normal map. */
function normalFromHeight(src: HTMLCanvasElement, strength = 2): THREE.CanvasTexture {
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const H = (x: number, y: number) => data[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  const out = canvas(w, h, () => undefined);
  const g = out.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function tiled(c: HTMLCanvasElement, metersPerRepeat: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metersPerRepeat, 1 / metersPerRepeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pagodaMaterials(): PagodaMaterials {
  if (mats) return mats;
  // Light marble slabs of slightly varied grey, as seen on aerial imagery of
  // the complex (4 × 4 slabs of 1.2 m per texture repeat).
  const tile = canvas(256, 256, (g) => {
    g.fillStyle = '#c9c6bf';
    g.fillRect(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = 222 + Math.floor(rnd() * 26);
        g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
        g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        // Faint veining.
        g.strokeStyle = 'rgba(150,150,150,0.18)';
        g.beginPath();
        g.moveTo(x * 64 + rnd() * 60, y * 64 + 2);
        g.quadraticCurveTo(x * 64 + rnd() * 64, y * 64 + 32, x * 64 + rnd() * 60, y * 64 + 62);
        g.stroke();
      }
    }
  });
  const tileHeight = canvas(256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#808080';
    g.lineWidth = 4;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 128);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
  });
  const ceiling = canvas(128, 128, (g) => {
    g.fillStyle = '#8e1f22';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#e0b04a';
    g.lineWidth = 4;
    g.strokeRect(4, 4, 120, 120);
    g.beginPath();
    g.moveTo(64, 14);
    g.lineTo(114, 64);
    g.lineTo(64, 114);
    g.lineTo(14, 64);
    g.closePath();
    g.stroke();
    g.fillStyle = '#e8b84f';
    g.beginPath();
    g.arc(64, 64, 14, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.arc(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26, 5, 0, Math.PI * 2);
      g.fill();
    }
  });
  const plasterBump = canvas(64, 64, (g) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = 200 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  });
  const ceilingTex = tiled(ceiling, 2.5);
  mats = {
    gold: makeReflective(new THREE.MeshStandardMaterial({ color: 0xe0ac48, metalness: 1, roughness: 0.32 })),
    stupaGold: makeFloodlit(makeReflective(new THREE.MeshStandardMaterial({ color: 0xe5b04a, metalness: 1, roughness: 0.28 })), 0.45),
    bronze: makeReflective(new THREE.MeshStandardMaterial({ color: 0x8c5e27, metalness: 0.85, roughness: 0.38 })),
    plaster: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.82, normalMap: normalFromHeight(plasterBump, 0.6), normalScale: new THREE.Vector2(0.4, 0.4) }),
    marble: new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 0.35 }),
    courtyard: new THREE.MeshStandardMaterial({
      map: tiled(tile, 4.8),
      normalMap: (() => {
        const n = normalFromHeight(tileHeight, 3);
        n.repeat.set(1 / 4.8, 1 / 4.8);
        return n;
      })(),
      roughness: 0.42,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }),
    carpet: new THREE.MeshStandardMaterial({ color: 0xa3232b, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
    // Interior ceiling: lit by warm "baked" emissive light so the hall reads indoors.
    ceiling: new THREE.MeshStandardMaterial({ map: ceilingTex, emissiveMap: ceilingTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.55, roughness: 0.6, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x24303a, roughness: 0.15, metalness: 0.3 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.75 }),
  };
  return mats;
}

// ---------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
const sharedGeos = new Set<THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    geoCache.set(key, (g = make()));
    sharedGeos.add(g);
  }
  return g;
}

/** Burmese bell stupa (height 1): moulded base rings, bell, banded lotus, spire. */
function bellProfile(): THREE.Vector2[] {
  return [
    [0, 0], [0.5, 0], [0.5, 0.035], [0.47, 0.04], [0.47, 0.075], [0.44, 0.08], [0.44, 0.11], [0.41, 0.115],
    [0.4, 0.16], [0.385, 0.24], [0.355, 0.32], [0.31, 0.39], [0.25, 0.44], [0.19, 0.47], [0.16, 0.48],
    [0.16, 0.5], [0.13, 0.505], [0.13, 0.53], [0.115, 0.535], [0.1, 0.56], [0.112, 0.58], [0.09, 0.6],
    [0.1, 0.62], [0.075, 0.645], [0.085, 0.66], [0.06, 0.69], [0.05, 0.74], [0.038, 0.8], [0.028, 0.86],
    [0.018, 0.92], [0.008, 0.97], [0, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y));
}

function stupaGeo(segments: number): THREE.BufferGeometry {
  return cached(`stupa${segments}`, () => new THREE.LatheGeometry(bellProfile(), segments));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface PagodaSite {
  id: string;
  name: string;
  nameLocal?: string;
  layout: PagodaLayout;
  /** Artistic-reconstruction note for the info panel. */
  note: string;
  /** Per-frame LOD update by player position. */
  update(px: number, pz: number): void;
}

export interface LawkanandarObjects {
  group: THREE.Group;
  colliders: number[];
  boxes: number[];
  ramps: number[][];
  site: PagodaSite;
}

export function buildLawkanandar(lm: ChunkLandmark, L: PagodaLayout): LawkanandarObjects {
  const M = pagodaMaterials();
  const group = new THREE.Group();
  group.name = 'lawkanandar-pagoda';
  group.userData['artistic'] = true;
  const near = new THREE.Group(); // detail: props, interior, ornaments (< 170 m)
  const mid = new THREE.Group(); // complex: hall, gates, small stupas, railing (< 420 m)
  const core = new THREE.Group(); // always: courtyard, terraces, main stupa
  group.add(core, mid, near);
  const colliders: number[] = [];
  const boxes: number[] = [];
  const ramps: number[][] = [];
  const [cx, cz] = L.centre;
  const top = PLATFORM_Y;

  const solid = new GeometryBuilder(); // vertex-coloured white/gold/red structure (mid)
  const detail = new GeometryBuilder(); // small vertex-coloured details (near)

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    // Cached geometries are shared across chunk rebuilds and must not be disposed with the chunk.
    m.userData['sharedGeometry'] = sharedGeos.has(geo);
    parent.add(m);
    return m;
  };

  // 1) Courtyard tiles on the real footprint.
  const court = new GeometryBuilder();
  addFlatPolygon(court, [L.ring.flatMap((p) => p)], top + 0.02);
  mesh(court.build(), M.courtyard, core, false);

  // 2) Gold band + white balustrade with stupa fence posts, open at the entrances.
  const posts: Array<[number, number]> = [];
  const gapHalf = L.stairWidth / 2 + 0.6;
  for (let i = 0; i < L.ring.length; i++) {
    const a = L.ring[i]!;
    const b = L.ring[(i + 1) % L.ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.2) continue;
    // Split around any entrance lying on this edge.
    const cuts: Array<[number, number]> = [];
    for (const e of L.entrances) {
      const t = ((e.edge[0] - a[0]) * (b[0] - a[0]) + (e.edge[1] - a[1]) * (b[1] - a[1])) / (len * len);
      const px = a[0] + (b[0] - a[0]) * t;
      const pz = a[1] + (b[1] - a[1]) * t;
      if (t > -0.05 && t < 1.05 && Math.hypot(px - e.edge[0], pz - e.edge[1]) < 0.6) cuts.push([t - gapHalf / len, t + gapHalf / len]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    let cur = 0;
    const spans: Array<[number, number]> = [];
    for (const [lo, hi] of cuts) {
      if (lo > cur) spans.push([cur, lo]);
      cur = Math.max(cur, hi);
    }
    if (cur < 1) spans.push([cur, 1]);
    solid.setColor(0xd8a640);
    addBeam(solid, a[0], top - 0.1, a[1], b[0], top - 0.1, b[1], 0.16, 0.18);
    for (const [lo, hi] of spans) {
      const ax = a[0] + (b[0] - a[0]) * Math.max(0, lo);
      const az = a[1] + (b[1] - a[1]) * Math.max(0, lo);
      const bx = a[0] + (b[0] - a[0]) * Math.min(1, hi);
      const bz = a[1] + (b[1] - a[1]) * Math.min(1, hi);
      const sl = Math.hypot(bx - ax, bz - az);
      if (sl < 0.3) continue;
      solid.setColor(0xf6f3ec);
      addBeam(solid, ax, top + 1.0, az, bx, top + 1.0, bz, 0.22, 0.14);
      addBeam(solid, ax, top + 0.18, az, bx, top + 0.18, bz, 0.26, 0.16);
      // Balusters.
      const n = Math.max(1, Math.round(sl / 0.45));
      for (let k = 1; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        detail.setColor(0xf6f3ec);
        addBeam(detail, x, top + 0.26, z, x, top + 0.94, z, 0.1, 0.1);
      }
      const pn = Math.max(1, Math.round(sl / 4));
      for (let k = 0; k <= pn; k++) posts.push([ax + ((bx - ax) * k) / pn, az + ((bz - az) * k) / pn]);
      // Wall collider: keeps people on the platform except at the stairs.
      boxes.push((ax + bx) / 2, top + 0.6, (az + bz) / 2, 0.12, 0.6, sl / 2, Math.atan2(-(bx - ax) / sl, -(bz - az) / sl));
    }
  }
  // Stupa fence posts (white with gold finials), instanced.
  {
    const postGeo = cached('fencePost', () => {
      const b = new GeometryBuilder();
      b.setColor(0xf6f3ec);
      addBeam(b, 0, 0, 0, 0, 1.35, 0, 0.42, 0.42);
      b.setColor(0xd8a640);
      addBeam(b, 0, 1.35, 0, 0, 1.5, 0, 0.5, 0.5);
      addBeam(b, 0, 1.5, 0, 0, 1.95, 0, 0.12, 0.12);
      return b.build();
    });
    const im = new THREE.InstancedMesh(postGeo, materials().solid, posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach(([x, z], i) => im.setMatrixAt(i, m4.makeTranslation(x, top, z)));
    im.castShadow = true;
    im.computeBoundingSphere();
    mid.add(im);
  }

  // 3) Staircases (red carpet, white side walls) with walkable ramps; gates.
  L.entrances.forEach((e, idx) => {
    const isMain = idx === L.main;
    const w = L.stairWidth;
    const steps = 6;
    const run = 2.4;
    for (let k = 0; k < steps; k++) {
      const h = (top * (k + 1)) / steps;
      const d = run - (run / steps) * (k + 0.5);
      const x = e.edge[0] + e.out[0] * d;
      const z = e.edge[1] + e.out[1] * d;
      solid.setColor(0xebe5da);
      addBeam(solid, x - e.along[0] * w / 2, h / 2, z - e.along[1] * w / 2, x + e.along[0] * w / 2, h / 2, z + e.along[1] * w / 2, run / steps, h);
      solid.setColor(0xa3232b); // red carpet runner
      addBeam(solid, x - e.along[0] * w * 0.3, h + 0.012, z - e.along[1] * w * 0.3, x + e.along[0] * w * 0.3, h + 0.012, z + e.along[1] * w * 0.3, run / steps, 0.02);
    }
    // Side walls of the stair, white with gold coping.
    for (const s of [-1, 1]) {
      const ox = e.along[0] * s * (w / 2 + 0.25);
      const oz = e.along[1] * s * (w / 2 + 0.25);
      solid.setColor(0xf6f3ec);
      addBeam(solid, e.edge[0] + ox, (top + 0.9) / 2, e.edge[1] + oz, e.edge[0] + e.out[0] * run + ox, 0.45, e.edge[1] + e.out[1] * run + oz, 0.5, top + 0.9);
      solid.setColor(0xd8a640);
      addBeam(solid, e.edge[0] + ox, top + 0.95, e.edge[1] + oz, e.edge[0] + e.out[0] * run + ox, 0.95, e.edge[1] + e.out[1] * run + oz, 0.56, 0.1);
      boxes.push(e.edge[0] + e.out[0] * run / 2 + ox, top / 2 + 0.3, e.edge[1] + e.out[1] * run / 2 + oz, 0.25, top / 2 + 0.4, run / 2, Math.atan2(-e.out[0], -e.out[1]));
      if (isMain) {
        // Naga (serpent) heads guarding the main stair.
        const nx = e.edge[0] + e.out[0] * (run + 0.3) + ox;
        const nz = e.edge[1] + e.out[1] * (run + 0.3) + oz;
        const body = new THREE.Mesh(cached('nagaBody', () => new THREE.TorusGeometry(0.6, 0.18, 8, 16, Math.PI * 1.2)), M.gold);
        body.position.set(nx, 0.75, nz);
        body.rotation.y = Math.atan2(e.out[0], e.out[1]) + Math.PI / 2;
        body.userData['sharedGeometry'] = true;
        near.add(body);
        const head = new THREE.Mesh(cached('nagaHead', () => new THREE.ConeGeometry(0.28, 0.8, 6).rotateX(Math.PI / 2.4)), M.gold);
        head.position.set(nx + e.out[0] * 0.5, 1.5, nz + e.out[1] * 0.5);
        head.rotation.y = Math.atan2(e.out[0], e.out[1]);
        head.userData['sharedGeometry'] = true;
        near.add(head);
      }
    }
    // Invisible ramp (≈27°) the character controller climbs; walkers only.
    const pts: number[] = [];
    for (const s of [-1, 1]) {
      const ax2 = e.along[0] * s * (w / 2);
      const az2 = e.along[1] * s * (w / 2);
      pts.push(
        e.edge[0] + e.out[0] * run + ax2, 0.08, e.edge[1] + e.out[1] * run + az2,
        e.edge[0] - e.out[0] * 0.4 + ax2, top, e.edge[1] - e.out[1] * 0.4 + az2,
        e.edge[0] - e.out[0] * 0.4 + ax2, 0.08, e.edge[1] - e.out[1] * 0.4 + az2,
      );
    }
    ramps.push(pts);
    if (!L.hall || !isMain) buildGatePavilion(solid, mid, M, e, w, top, colliders, Math.abs(e.out[1]) > 0.7);
    if (isMain) buildApproachProps(near, detail, M, e, w, colliders, lm);
  });

  // 4) Eight-pointed star stepped base (white bottom tier, gilded upper tiers)
  //    and the main stupa — the star plan is clearly visible on aerial imagery.
  const { baseR, height, terraceR, terraceH } = L.stupa;
  const rot = Math.atan2(L.u[1], L.u[0]); // align star points with the platform axes
  terraceR.forEach((r, i) => {
    const y = top + i * terraceH;
    const tier = mesh(cached(`starTier`, () => starTierGeometry()), i === 0 ? M.plaster : M.gold, core);
    tier.scale.set(r, terraceH, r);
    tier.position.set(cx, y, cz);
    tier.rotation.y = -rot;
    if (i === 0) {
      const band = mesh(cached('starBand', () => starTierGeometry()), M.gold, mid, false);
      band.scale.set(r + 0.05, 0.14, r + 0.05);
      band.position.set(cx, y + terraceH - 0.1, cz);
      band.rotation.y = -rot;
    }
  });
  colliders.push(cx, cz, terraceR[0]! + 0.2);
  const stupaBase = top + terraceR.length * terraceH;
  const stupaH = Math.max(10, height - (stupaBase - 0.08));
  const stupaNear = mesh(stupaGeo(48), M.stupaGold, core);
  const stupaFar = mesh(stupaGeo(14), M.stupaGold, core);
  for (const s of [stupaNear, stupaFar]) {
    s.scale.set(baseR * 2, stupaH, baseR * 2);
    s.position.set(cx, stupaBase, cz);
    s.userData['sharedGeometry'] = true;
  }
  stupaFar.visible = false;
  // Full-height colliders following the bell profile (stacked octagons from two
  // rotated boxes), so no vehicle — flying ones included — clips through.
  {
    const prof = bellProfile();
    for (let k = 0; k < prof.length - 1; k += 2) {
      const a = prof[k]!;
      const b = prof[Math.min(prof.length - 1, k + 2)]!;
      const r = Math.max(a.x, b.x) * baseR * 2 * 0.92;
      if (r < 0.15) continue;
      const y0 = stupaBase + a.y * stupaH;
      const y1 = stupaBase + b.y * stupaH;
      for (const yaw of [0, Math.PI / 4]) boxes.push(cx, (y0 + y1) / 2, cz, r, (y1 - y0) / 2, r, yaw);
    }
  }
  // Hti (umbrella) tiers, banner vane and diamond bud at the top.
  const htiY = stupaBase + stupaH * 0.84;
  for (let k = 0; k < 5; k++) {
    const r = baseR * (0.085 - k * 0.013);
    const h = mesh(cached('hti', () => new THREE.CylinderGeometry(0.85, 1, 1, 16)), M.gold, mid, false);
    h.scale.set(r, 0.45, r);
    h.position.set(cx, htiY + k * stupaH * 0.028, cz);
    h.userData['sharedGeometry'] = true;
  }
  const vane = mesh(cached('vane', () => new THREE.BoxGeometry(0.06, 0.7, 1.4)), M.gold, near, false);
  vane.position.set(cx, stupaBase + stupaH * 0.985, cz + 0.4);
  vane.userData['sharedGeometry'] = true;
  const bud = mesh(cached('bud', () => new THREE.SphereGeometry(0.35, 12, 10)), M.gold, mid, false);
  bud.position.set(cx, stupaBase + stupaH + 0.25, cz);
  bud.userData['sharedGeometry'] = true;

  // 5) Small gold stupas standing on the eight points of the star base.
  {
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < 8; k++) {
      const a = rot + (k * Math.PI) / 4;
      const r = terraceR[0]! - 1.7;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    const small = new THREE.InstancedMesh(stupaGeo(16), M.stupaGold, pts.length);
    const m4 = new THREE.Matrix4();
    pts.forEach(([x, z], i) => small.setMatrixAt(i, m4.compose(new THREE.Vector3(x, top + terraceH, z), new THREE.Quaternion(), new THREE.Vector3(2.2, 7, 2.2))));
    small.castShadow = true;
    small.computeBoundingSphere();
    mid.add(small);
  }

  // 6) Main hall (only when the layout asks for one; the Lawkanandar complex
  //    uses walk-through gate pavilions instead, and its image house is the
  //    separate Satkyar Muni mirror shrine).
  if (L.hall) buildHall(L, solid, detail, near, mid, M, colliders, boxes);

  // 7) Corner pavilions with tiered gold roofs (where the platform has room).
  {
    const hu = L.lenU / 2 - 5;
    const hv = L.lenV / 2 - 5;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = cx + L.u[0] * su * hu + L.v[0] * sv * hv;
      const z = cz + L.u[1] * su * hu + L.v[1] * sv * hv;
      if (!insideRing(x, z, L.ring, 2.5)) continue;
      if (Math.hypot(x - cx, z - cz) < L.smallStupas.radius + 3) continue;
      for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]] as const) {
        const px = x + L.u[0] * ox + L.v[0] * oz;
        const pz = z + L.u[1] * ox + L.v[1] * oz;
        solid.setColor(0xf6f3ec);
        addBeam(solid, px, top, pz, px, top + 3.1, pz, 0.32, 0.32);
      }
      const yaw = Math.atan2(L.u[0], L.u[1]) + Math.PI / 4;
      for (let t = 0; t < 3; t++) {
        const roof = mesh(cached('pavRoof', () => new THREE.ConeGeometry(1, 1, 4)), M.gold, mid);
        roof.scale.set(2.7 - t * 0.7, 0.8, 2.7 - t * 0.7);
        roof.position.set(x, top + 3.45 + t * 0.62, z);
        roof.rotation.y = yaw;
        roof.userData['sharedGeometry'] = true;
      }
      colliders.push(x, z, 2.0);
    }
  }

  // 8) Palms around the outside of the platform.
  {
    const palmSpots: THREE.Matrix4[] = [];
    for (let i = 0; i < L.ring.length; i++) {
      const a = L.ring[i]!;
      const b = L.ring[(i + 1) % L.ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.floor(len / 7);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const ox = x - cx;
        const oz = z - cz;
        const ol = Math.hypot(ox, oz) || 1;
        const px = x + (ox / ol) * 4.5;
        const pz = z + (oz / ol) * 4.5;
        if (L.entrances.some((e) => Math.hypot(e.bottom[0] - px, e.bottom[1] - pz) < 6)) continue;
        palmSpots.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 1.3), new THREE.Vector3(1.05, 1.05, 1.05)));
      }
    }
    // Aerial imagery shows a continuous line of trees around the platform: mostly
    // broadleaf trees with some palms.
    const broad = palmSpots.filter((_, i) => i % 3 !== 0);
    const palmsOnly = palmSpots.filter((_, i) => i % 3 === 0);
    for (const [geo, list] of [[broadleafGeometry(), broad], [palmGeometry(), palmsOnly]] as const) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, materials().vegetation, list.length);
      list.forEach((m4, i) => im.setMatrixAt(i, m4));
      im.castShadow = true;
      im.computeBoundingSphere();
      mid.add(im);
    }
  }

  mesh(solid.build(), materials().solid, mid);
  if (!detail.isEmpty()) mesh(detail.build(), materials().solid, near);

  // LOD by player distance.
  let level = -1;
  const site: PagodaSite = {
    id: lm.id,
    name: lm.ne ?? lm.n,
    ...(lm.nl ? { nameLocal: lm.nl } : {}),
    layout: L,
    note: 'Position from OpenStreetMap (node 1230796347). The courtyard is a square fitted inside the mapped ring road, since the mapped footprint is a rough circle. Stupa size from published figures (about 49 m / 162 ft tall). The star-shaped base, gates, pavilions and ornament are an artistic reconstruction based on reference images. Its image house is the linked Satkyar Muni mirror shrine to the west.',
    update(px, pz) {
      const d = Math.hypot(px - cx, pz - cz);
      const next = d < 170 ? 0 : d < 420 ? 1 : 2;
      if (next === level) return;
      level = next;
      near.visible = level === 0;
      mid.visible = level <= 1;
      stupaNear.visible = level <= 1;
      stupaFar.visible = level === 2;
    },
  };
  site.update(cx + 1e6, cz); // start at the far level until the first real update
  return { group, colliders, boxes, ramps, site };
}

function insideRing(x: number, z: number, ring: Array<[number, number]>, margin: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (!inside) return false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!;
    const [bx, bz] = ring[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(ax + dx * t - x, az + dz * t - z) < margin) return false;
  }
  return true;
}

/** 8-pointed star prism (unit outer radius, unit height, base at y = 0). */
function starTierGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let k = 0; k < 16; k++) {
    const r = k % 2 ? 0.8 : 1;
    const a = (k * Math.PI) / 8;
    if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // extrude upward; shape lies in the XZ plane
  return g;
}

/** Walk-through gate pavilion over a staircase: white columns and a tiered gold roof. */
function buildGatePavilion(solid: GeometryBuilder, mid: THREE.Group, M: PagodaMaterials, e: PagodaLayout['entrances'][number], w: number, top: number, colliders: number[], large: boolean): void {
  const depth = large ? 6 : 4;
  const half = w / 2 + 0.6;
  const H = large ? 4.8 : 4.2;
  for (const s of [-1, 1]) {
    for (const d of [0.4, -depth + 0.4]) {
      const px = e.edge[0] + e.along[0] * s * half + e.out[0] * d;
      const pz = e.edge[1] + e.along[1] * s * half + e.out[1] * d;
      solid.setColor(0xf6f3ec);
      addBeam(solid, px, top, pz, px, top + H, pz, 0.55, 0.55);
      solid.setColor(0xd8a640);
      addBeam(solid, px, top + H - 0.3, pz, px, top + H, pz, 0.7, 0.7);
      colliders.push(px, pz, 0.4);
    }
  }
  const cxp = e.edge[0] - e.out[0] * (depth / 2 - 0.4);
  const czp = e.edge[1] - e.out[1] * (depth / 2 - 0.4);
  const yaw = Math.atan2(e.out[0], e.out[1]);
  const tiers = large ? 4 : 3;
  for (let t = 0; t < tiers; t++) {
    const k = 1 - t * 0.24;
    const roof = new THREE.Mesh(cached('gateRoof', () => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)), M.gold);
    roof.scale.set((half * 2 + 1.6) * k, 1.05, (depth + 1.4) * k);
    roof.position.set(cxp, top + H + 0.5 + t * 0.85, czp);
    roof.rotation.y = yaw;
    roof.castShadow = true;
    roof.userData['sharedGeometry'] = true;
    mid.add(roof);
  }
  const spire = new THREE.Mesh(cached('gateSpire', () => new THREE.ConeGeometry(0.22, 2.2, 8)), M.gold);
  spire.position.set(cxp, top + H + 0.5 + tiers * 0.85 + 0.9, czp);
  spire.userData['sharedGeometry'] = true;
  mid.add(spire);
}

/** Ornate golden gate (pillars + arch + tiered crest) at a side entrance. */
export function buildGate(solid: GeometryBuilder, near: THREE.Group, M: PagodaMaterials, e: PagodaLayout['entrances'][number], w: number, top: number, colliders: number[]): void {
  const gx = e.edge[0] - e.out[0] * 0.8;
  const gz = e.edge[1] - e.out[1] * 0.8;
  for (const s of [-1, 1]) {
    const px = gx + e.along[0] * s * (w / 2 + 0.45);
    const pz = gz + e.along[1] * s * (w / 2 + 0.45);
    solid.setColor(0xf6f3ec);
    addBeam(solid, px, top, pz, px, top + 4.4, pz, 0.7, 0.7);
    solid.setColor(0xd8a640);
    addBeam(solid, px, top + 4.4, pz, px, top + 4.7, pz, 0.85, 0.85);
    colliders.push(px, pz, 0.45);
  }
  const arch = new THREE.Mesh(cached('gateArch', () => new THREE.TorusGeometry(1, 0.12, 8, 24, Math.PI)), M.gold);
  arch.scale.set(w / 2 + 0.45, w / 2 + 0.45, 1);
  arch.position.set(gx, top + 4.4, gz);
  arch.rotation.y = Math.atan2(e.along[0], e.along[1]) + Math.PI / 2;
  arch.userData['sharedGeometry'] = true;
  near.add(arch);
  for (let t = 0; t < 3; t++) {
    const crest = new THREE.Mesh(cached('gateCrest', () => new THREE.ConeGeometry(1, 1, 4)), M.gold);
    crest.scale.set((w / 2) * (0.75 - t * 0.2), 0.9, 0.5);
    crest.position.set(gx, top + 4.4 + w / 2 + 0.2 + t * 0.7, gz);
    crest.rotation.y = Math.atan2(e.along[0], e.along[1]);
    crest.userData['sharedGeometry'] = true;
    near.add(crest);
  }
}

/** Stone lions, the bilingual sign board, twin-globe lamps along the main approach. */
function buildApproachProps(near: THREE.Group, detail: GeometryBuilder, M: PagodaMaterials, e: PagodaLayout['entrances'][number], w: number, colliders: number[], lm: ChunkLandmark): void {
  const [bx, bz] = e.bottom;
  const yaw = Math.atan2(e.out[0], e.out[1]);
  for (const s of [-1, 1]) {
    // Guardian lion (chinthe), white stone, sitting on a plinth.
    const lx = bx + e.out[0] * 1.2 + e.along[0] * s * (w / 2 + 1.6);
    const lz = bz + e.out[1] * 1.2 + e.along[1] * s * (w / 2 + 1.6);
    detail.setColor(0xd9d3c6);
    addBeam(detail, lx, 0, lz, lx, 1.0, lz, 1.4, 1.4);
    const lion = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, M.stone);
      m.position.set(x, y, z);
      m.castShadow = true;
      lion.add(m);
    };
    part(new THREE.BoxGeometry(0.7, 0.9, 1.0), 0, 1.45, 0.1);
    part(new THREE.BoxGeometry(0.75, 0.7, 0.65), 0, 2.15, -0.3);
    part(new THREE.BoxGeometry(0.9, 0.35, 0.35), 0, 2.55, -0.25);
    lion.position.set(lx, 0, lz);
    lion.rotation.y = yaw + Math.PI;
    near.add(lion);
    colliders.push(lx, lz, 0.9);
    // Twin-globe classic lamps.
    for (const d of [5, 11]) {
      const px = bx + e.out[0] * d + e.along[0] * s * (w / 2 + 1.2);
      const pz = bz + e.out[1] * d + e.along[1] * s * (w / 2 + 1.2);
      detail.setColor(0x2a2c30);
      addBeam(detail, px, 0, pz, px, 3.8, pz, 0.14, 0.14);
      addBeam(detail, px - e.along[0] * 0.45, 3.8, pz - e.along[1] * 0.45, px + e.along[0] * 0.45, 3.8, pz + e.along[1] * 0.45, 0.08, 0.08);
      for (const o of [-0.45, 0.45]) {
        const g = new THREE.Mesh(cached('globe', () => new THREE.SphereGeometry(0.22, 12, 10)), materials().lampHead);
        g.position.set(px + e.along[0] * o, 4.05, pz + e.along[1] * o);
        g.userData['sharedGeometry'] = true;
        near.add(g);
      }
    }
  }
  // Sign board (Burmese / English).
  const sx = bx + e.out[0] * 3 + e.along[0] * (w / 2 + 4.2);
  const sz = bz + e.out[1] * 3 + e.along[1] * (w / 2 + 4.2);
  detail.setColor(0x6b4b2a);
  for (const o of [-1.1, 1.1]) addBeam(detail, sx + e.along[0] * o, 0, sz + e.along[1] * o, sx + e.along[0] * o, 1.4, sz + e.along[1] * o, 0.14, 0.14);
  const c = canvas(512, 220, (g) => {
    g.fillStyle = '#1f3d2a';
    g.fillRect(0, 0, 512, 220);
    g.strokeStyle = '#d8a640';
    g.lineWidth = 10;
    g.strokeRect(8, 8, 496, 204);
    g.fillStyle = '#f3e3b0';
    g.textAlign = 'center';
    g.font = '600 46px "Noto Sans Myanmar", "Myanmar Sangam MN", sans-serif';
    g.fillText(lm.nl ?? 'လောကနန္ဒာ စေတီတော်', 256, 96, 470);
    g.font = '600 38px Inter, sans-serif';
    g.fillText(lm.ne ?? 'Lawkanandar Pagoda', 256, 168, 470);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
  signMat.userData['own'] = true;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), signMat);
  sign.position.set(sx, 1.8, sz);
  sign.rotation.y = yaw;
  near.add(sign);
}

/** Main hall: tiered gold roof, ornate arched facade, interior with columns and a seated Buddha. */
function buildHall(L: PagodaLayout, solid: GeometryBuilder, detail: GeometryBuilder, near: THREE.Group, mid: THREE.Group, M: PagodaMaterials, colliders: number[], boxes: number[]): void {
  const hall = L.hall!;
  const [hx, hz] = hall.centre;
  const o = hall.out;
  const s: [number, number] = [-o[1], o[0]];
  const W = hall.width;
  const D = hall.depth;
  const H = hall.height;
  const top = PLATFORM_Y;
  const P = (a: number, b: number): [number, number] => [hx + s[0] * a + o[0] * b, hz + s[1] * a + o[1] * b];
  const yaw = Math.atan2(-o[0], -o[1]); // local -Z = out (toward the main entrance)
  const wall = 0.4;
  const doorW = 3.4;
  const doorH = 4.4;

  const wallSeg = (a0: number, b0: number, a1: number, b1: number, y0: number, y1: number) => {
    const [x0, z0] = P(a0, b0);
    const [x1, z1] = P(a1, b1);
    solid.setColor(0xf6f3ec);
    addBeam(solid, x0, (y0 + y1) / 2, z0, x1, (y0 + y1) / 2, z1, wall, y1 - y0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    boxes.push((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, wall / 2, (y1 - y0) / 2, len / 2, Math.atan2(-(x1 - x0) / len, -(z1 - z0) / len));
  };
  // Back and side walls; front wall with a door opening.
  wallSeg(-W / 2, -D / 2, W / 2, -D / 2, top, top + H);
  wallSeg(-W / 2, -D / 2, -W / 2, D / 2, top, top + H);
  wallSeg(W / 2, -D / 2, W / 2, D / 2, top, top + H);
  wallSeg(-W / 2, D / 2, -doorW / 2, D / 2, top, top + H);
  wallSeg(doorW / 2, D / 2, W / 2, D / 2, top, top + H);
  wallSeg(-doorW / 2, D / 2, doorW / 2, D / 2, top + doorH, top + H);
  // Gold trim at the eaves and base.
  for (const y of [top + 0.15, top + H - 0.1]) {
    const corners = [P(-W / 2 - 0.25, -D / 2 - 0.25), P(W / 2 + 0.25, -D / 2 - 0.25), P(W / 2 + 0.25, D / 2 + 0.25), P(-W / 2 - 0.25, D / 2 + 0.25)];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      solid.setColor(0xd8a640);
      addBeam(solid, a[0], y, a[1], b[0], y, b[1], 0.12, 0.22);
    }
  }
  // Roof slab (also keeps the camera inside when the player is in the hall).
  boxes.push(hx, top + H + 0.15, hz, W / 2 + 0.3, 0.15, D / 2 + 0.3, yaw);

  // Tiered gold roof.
  for (let t = 0; t < 3; t++) {
    const k = 1 - t * 0.27;
    const roof = new THREE.Mesh(cached('hallRoof', () => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)), M.gold);
    roof.scale.set((W + 1.6) * k, 1.6, (D + 1.6) * k);
    roof.position.set(hx, top + H + 0.85 + t * 1.15, hz);
    roof.rotation.y = yaw;
    roof.castShadow = true;
    roof.userData['sharedGeometry'] = true;
    mid.add(roof);
  }
  const spire = new THREE.Mesh(cached('hallSpire', () => new THREE.ConeGeometry(0.35, 3.2, 8)), M.gold);
  spire.position.set(hx, top + H + 5.2, hz);
  spire.userData['sharedGeometry'] = true;
  mid.add(spire);

  // Ornate front arch (pointed, extruded gold) with a tiered crest.
  {
    const shape = new THREE.Shape();
    const ow = doorW / 2 + 0.8;
    shape.moveTo(-ow, 0);
    shape.lineTo(-ow, doorH);
    shape.quadraticCurveTo(-ow, doorH + 2.2, 0, doorH + 3.0);
    shape.quadraticCurveTo(ow, doorH + 2.2, ow, doorH);
    shape.lineTo(ow, 0);
    shape.lineTo(doorW / 2, 0);
    shape.lineTo(doorW / 2, doorH);
    shape.quadraticCurveTo(doorW / 2, doorH + 1.3, 0, doorH + 1.9);
    shape.quadraticCurveTo(-doorW / 2, doorH + 1.3, -doorW / 2, doorH);
    shape.lineTo(-doorW / 2, 0);
    shape.closePath();
    const arch = new THREE.Mesh(cached('hallArch', () => new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false })), M.gold);
    const [ax, az] = P(0, D / 2 + 0.25);
    arch.position.set(ax, top, az);
    arch.rotation.y = yaw + Math.PI;
    arch.castShadow = true;
    arch.userData['sharedGeometry'] = true;
    mid.add(arch);
    for (let t = 0; t < 4; t++) {
      const crest = new THREE.Mesh(cached('crest', () => new THREE.ConeGeometry(1, 1, 4)), M.gold);
      crest.scale.set(ow * (0.95 - t * 0.2), 0.8, 0.35);
      crest.position.set(ax, top + doorH + 3.2 + t * 0.6, az);
      crest.rotation.y = yaw + Math.PI / 4;
      crest.userData['sharedGeometry'] = true;
      near.add(crest);
    }
  }
  // Arched windows on the side walls (dark glass, gold frame), both faces.
  for (const side of [-1, 1]) {
    for (const b of [-D / 4, D / 4]) {
      for (const face of [1, -1]) {
        const [wx, wz] = P(side * (W / 2 + (face * (wall / 2 + 0.02))), b);
        const win = new THREE.Mesh(cached('window', () => {
          const sh = new THREE.Shape();
          sh.moveTo(-0.7, 0);
          sh.lineTo(0.7, 0);
          sh.lineTo(0.7, 1.6);
          sh.quadraticCurveTo(0, 2.6, -0.7, 1.6);
          sh.closePath();
          return new THREE.ShapeGeometry(sh);
        }), M.glass);
        win.position.set(wx, top + 1.6, wz);
        win.rotation.y = yaw + (side * face > 0 ? -Math.PI / 2 : Math.PI / 2);
        win.userData['sharedGeometry'] = true;
        near.add(win);
      }
    }
  }

  // --- Interior ---
  // Marble floor and red carpet runner from the door to the altar.
  {
    const floor = new GeometryBuilder();
    const c = [P(-W / 2, -D / 2), P(W / 2, -D / 2), P(W / 2, D / 2), P(-W / 2, D / 2)];
    floor.upTri(c[0]![0], c[0]![1], c[1]![0], c[1]![1], c[2]![0], c[2]![1], top + 0.04);
    floor.upTri(c[0]![0], c[0]![1], c[2]![0], c[2]![1], c[3]![0], c[3]![1], top + 0.04);
    near.add(new THREE.Mesh(floor.build(), M.marble));
    const run = new GeometryBuilder();
    const r = [P(-1.1, -D / 2 + 2.4), P(1.1, -D / 2 + 2.4), P(1.1, D / 2), P(-1.1, D / 2)];
    run.upTri(r[0]![0], r[0]![1], r[1]![0], r[1]![1], r[2]![0], r[2]![1], top + 0.06);
    run.upTri(r[0]![0], r[0]![1], r[2]![0], r[2]![1], r[3]![0], r[3]![1], top + 0.06);
    near.add(new THREE.Mesh(run.build(), M.carpet));
  }
  // Decorated ceiling (warm emissive = baked interior light).
  {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W - wall, D - wall), M.ceiling);
    ceil.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.position.set(hx, top + H - 0.05, hz);
    g.rotation.y = yaw;
    g.add(ceil);
    near.add(g);
  }
  // Golden columns (two rows), instanced.
  {
    const spots: Array<[number, number]> = [];
    for (const a of [-W / 2 + 2.4, W / 2 - 2.4]) for (const b of [-D / 2 + 2.6, 0, D / 2 - 2.4]) spots.push(P(a, b));
    const col = new THREE.InstancedMesh(cached('column', () => new THREE.CylinderGeometry(0.34, 0.38, 1, 16)), M.gold, spots.length);
    const base = new THREE.InstancedMesh(cached('columnBase', () => new THREE.CylinderGeometry(0.55, 0.6, 0.5, 8)), M.carpet, spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      col.setMatrixAt(i, m4.compose(new THREE.Vector3(x, top + H / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, H, 1)));
      base.setMatrixAt(i, m4.makeTranslation(x, top + 0.25, z));
      colliders.push(x, z, 0.45);
    });
    for (const im of [col, base]) {
      im.computeBoundingSphere();
      near.add(im);
    }
  }
  // Altar and seated Buddha at the back wall, facing the door.
  {
    const [ax, az] = P(0, -D / 2 + 1.4);
    for (let t = 0; t < 3; t++) {
      detail.setColor(t % 2 ? 0x8e1f22 : 0xd8a640);
      const [x0, z0] = P(-2.2 + t * 0.35, -D / 2 + 1.4);
      const [x1, z1] = P(2.2 - t * 0.35, -D / 2 + 1.4);
      addBeam(detail, x0, top + 0.3 + t * 0.45, z0, x1, top + 0.3 + t * 0.45, z1, 2.2 - t * 0.3, 0.45);
    }
    boxes.push(ax, top + 0.7, az, 2.3, 0.7, 1.2, yaw);
    const buddha = seatedBuddha(M);
    buddha.position.set(ax, top + 1.35, az);
    buddha.rotation.y = yaw; // faces the door (local -Z = out)
    near.add(buddha);
    // Halo behind the head.
    const halo = new THREE.Mesh(cached('halo', () => new THREE.TorusGeometry(0.75, 0.06, 8, 32)), M.gold);
    const [hx2, hz2] = P(0, -D / 2 + 0.7);
    halo.position.set(hx2, top + 3.35, hz2);
    halo.rotation.y = yaw;
    halo.userData['sharedGeometry'] = true;
    near.add(halo);
  }
  // Meditation mats, donation box, incense pot and a bronze bell outside.
  for (const [x, z] of L.mats) {
    detail.setColor(0xb43a2e);
    addBeam(detail, x - s[0] * 0.5, top + 0.07, z - s[1] * 0.5, x + s[0] * 0.5, top + 0.07, z + s[1] * 0.5, 0.8, 0.04);
  }
  {
    const [dx, dz] = P(W / 2 - 1.2, D / 2 - 1.2);
    detail.setColor(0x8e5a2a);
    addBeam(detail, dx, top, dz, dx, top + 1.0, dz, 0.6, 0.5);
    detail.setColor(0xd8a640);
    addBeam(detail, dx, top + 1.0, dz, dx, top + 1.1, dz, 0.66, 0.56);
    colliders.push(dx, dz, 0.4);
    const [ix, iz] = P(-W / 2 - 3, D / 2 + 2.5);
    const pot = new THREE.Mesh(cached('incense', () => new THREE.CylinderGeometry(0.55, 0.4, 0.7, 12)), M.bronze);
    pot.position.set(ix, top + 0.35, iz);
    pot.userData['sharedGeometry'] = true;
    near.add(pot);
    colliders.push(ix, iz, 0.6);
    const [bx, bz] = P(W / 2 + 3, D / 2 + 2.5);
    detail.setColor(0x6b4b2a);
    addBeam(detail, bx - s[0], top, bz - s[1], bx - s[0], top + 2.6, bz - s[1], 0.16, 0.16);
    addBeam(detail, bx + s[0], top, bz + s[1], bx + s[0], top + 2.6, bz + s[1], 0.16, 0.16);
    addBeam(detail, bx - s[0] * 1.1, top + 2.6, bz - s[1] * 1.1, bx + s[0] * 1.1, top + 2.6, bz + s[1] * 1.1, 0.18, 0.18);
    const bell = new THREE.Mesh(cached('bell', () => new THREE.LatheGeometry([[0, 0.9], [0.18, 0.88], [0.32, 0.6], [0.4, 0.2], [0.48, 0], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 16)), M.bronze);
    bell.position.set(bx, top + 1.6, bz);
    bell.userData['sharedGeometry'] = true;
    near.add(bell);
    colliders.push(bx, bz, 0.6);
  }
}

/** Respectful, simplified seated Buddha (bronze with gold robe edge). Artistic. */
function seatedBuddha(M: PagodaMaterials): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.LatheGeometry([[0, 0], [1.1, 0], [1.2, 0.12], [1.0, 0.3], [1.15, 0.42], [0.9, 0.5], [0, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 16), M.gold, 0, -0.5, 0);
  add(new THREE.SphereGeometry(0.85, 16, 10), M.bronze, 0, 0.25, 0, 1.0, 0.35, 0.62); // crossed legs
  add(new THREE.SphereGeometry(0.5, 16, 12), M.bronze, 0, 0.95, 0.05, 1.0, 1.25, 0.72); // torso
  add(new THREE.SphereGeometry(0.2, 12, 8), M.bronze, 0, 0.5, -0.32, 1.6, 0.6, 0.9); // hands in the lap
  add(new THREE.SphereGeometry(0.3, 16, 12), M.bronze, 0, 1.75, 0, 1, 1.12, 1); // head
  add(new THREE.SphereGeometry(0.13, 10, 8), M.bronze, 0, 2.08, 0); // ushnisha
  for (const x of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.06, 0.32, 0.12), M.bronze, x, 1.68, 0); // ears
  add(new THREE.TorusGeometry(0.5, 0.05, 6, 24, Math.PI), M.gold, 0, 1.2, -0.05, 1, 1, 1); // robe edge
  return g;
}
