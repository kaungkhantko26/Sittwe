import * as THREE from 'three';
import type { ChunkLandmark } from '../../geo/chunkFormat';
import type { PagodaLayout } from '../../geo/pagodaLayout';
import { addBeam, GeometryBuilder } from '../GeometryBuilder';
import { makeFloodlit, makeReflective } from '../goldEnvironment';
import { materials } from '../materials';
import type { PagodaSite } from './LawkanandarPagoda';

/**
 * Satkyar Muni Pagoda — the "mirror building" image house linked to
 * Lawkanandar Pagoda, modelled on the user's asset board: a raised white
 * marble platform with a red-carpeted stair, a pavilion of golden columns and
 * mirror-glass walls under a three-tier gold roof, and a seated Buddha with a
 * dark ornate body and gilded face on a golden throne, flanked by flower
 * vases. A covered colonnade links it to Lawkanandar's west staircase.
 *
 * Not mapped in OpenStreetMap: placed from the project owner's description
 * relative to the mapped Lawkanandar platform. Everything here is an artistic
 * reconstruction and is labelled as such in game.
 */

const BASE_Y = 1.0; // platform height
const HALF = 7.5; // platform half size
const PAV = 4.6; // pavilion half size
const COL_H = 4.8;

let columnGeo: THREE.BufferGeometry | null = null;

let shared: {
  gold: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  mosaic: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
  frieze: THREE.MeshStandardMaterial;
  vase: THREE.MeshStandardMaterial;
  flower: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
} | null = null;

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function mats() {
  if (shared) return shared;
  // Dark mosaic with gold flecks for the Buddha's body (board: ornate surface).
  const mosaic = tex(128, 128, (g) => {
    g.fillStyle = '#2a2018';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      g.fillStyle = Math.random() < 0.55 ? '#c99a3a' : '#5c4428';
      g.fillRect(x, y, 2, 2);
    }
  }, [3, 3]);
  const frieze = tex(256, 32, (g) => {
    g.fillStyle = '#d6a43e';
    g.fillRect(0, 0, 256, 32);
    g.strokeStyle = '#8a6420';
    g.lineWidth = 2;
    for (let x = 0; x < 256; x += 32) {
      g.beginPath();
      g.moveTo(x, 28);
      g.quadraticCurveTo(x + 16, 2, x + 32, 28);
      g.stroke();
      g.beginPath();
      g.arc(x + 16, 18, 4, 0, Math.PI * 2);
      g.stroke();
    }
  }, [4, 1]);
  shared = {
    gold: makeFloodlit(makeReflective(new THREE.MeshStandardMaterial({ color: 0xe2ad46, metalness: 1, roughness: 0.27 })), 0.35),
    // Mirror glass: reflective and partly transparent so the statue stays visible.
    glass: makeReflective(new THREE.MeshStandardMaterial({ color: 0xbfe3e6, metalness: 0.9, roughness: 0.06, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })),
    marble: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0xa61f28, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    mosaic: makeReflective(new THREE.MeshStandardMaterial({ map: mosaic, metalness: 0.6, roughness: 0.45 })),
    face: makeReflective(new THREE.MeshStandardMaterial({ color: 0xe8b84e, metalness: 1, roughness: 0.22 })),
    frieze: makeReflective(new THREE.MeshStandardMaterial({ map: frieze, metalness: 0.9, roughness: 0.35 })),
    vase: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.25 }),
    flower: new THREE.MeshStandardMaterial({ color: 0xe35d86, roughness: 0.8 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9 }),
  };
  return shared;
}

export interface MirrorShrineObjects {
  group: THREE.Group;
  colliders: number[];
  boxes: number[];
  ramps: number[][];
  site: PagodaSite;
}

export function buildMirrorShrine(lm: ChunkLandmark): MirrorShrineObjects | null {
  if (!lm.ms) return null;
  const M = mats();
  const group = new THREE.Group();
  group.name = 'satkyar-muni-mirror-shrine';
  group.userData['artistic'] = true;
  const near = new THREE.Group();
  const far = new THREE.Group();
  group.add(far, near);
  const colliders: number[] = [];
  const boxes: number[] = [];
  const ramps: number[][] = [];
  const yaw = lm.ms.yaw; // local -Z faces the front (toward Lawkanandar)
  const cx = lm.x;
  const cz = lm.z;
  const fwd: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
  const side: [number, number] = [-fwd[1], fwd[0]];
  const P = (a: number, b: number): [number, number] => [cx + side[0] * a + fwd[0] * b, cz + side[1] * a + fwd[1] * b];
  const solid = new GeometryBuilder();
  const detail = new GeometryBuilder();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Platform (white marble, gold band) with a walkable top.
  const plat = add(new THREE.BoxGeometry(HALF * 2, BASE_Y, HALF * 2), M.marble, far, cx, BASE_Y / 2, cz, yaw);
  plat.receiveShadow = true;
  boxes.push(cx, BASE_Y / 2, cz, HALF, BASE_Y / 2, HALF, yaw);
  const band = add(new THREE.BoxGeometry(HALF * 2 + 0.1, 0.16, HALF * 2 + 0.1), M.gold, far, cx, BASE_Y - 0.12, cz, yaw);
  band.castShadow = false;

  // Front stair (red carpet) + walkable ramp; balustrade around the platform.
  const stairW = 4;
  const run = 2.6;
  const [fx, fz] = P(0, HALF);
  for (let k = 0; k < 4; k++) {
    const h = (BASE_Y * (k + 1)) / 4;
    const d = run - (run / 4) * (k + 0.5);
    const x = fx + fwd[0] * d;
    const z = fz + fwd[1] * d;
    solid.setColor(0xf1ede5);
    addBeam(solid, x - side[0] * (stairW / 2 + 0.4), h / 2, z - side[1] * (stairW / 2 + 0.4), x + side[0] * (stairW / 2 + 0.4), h / 2, z + side[1] * (stairW / 2 + 0.4), run / 4, h);
    solid.setColor(0xa61f28);
    addBeam(solid, x - side[0] * stairW * 0.35, h + 0.012, z - side[1] * stairW * 0.35, x + side[0] * stairW * 0.35, h + 0.012, z + side[1] * stairW * 0.35, run / 4, 0.02);
  }
  {
    const pts: number[] = [];
    for (const s of [-1, 1]) {
      const ax = side[0] * s * (stairW / 2);
      const az = side[1] * s * (stairW / 2);
      pts.push(fx + fwd[0] * run + ax, 0.08, fz + fwd[1] * run + az, fx - fwd[0] * 0.4 + ax, BASE_Y, fz - fwd[1] * 0.4 + az, fx - fwd[0] * 0.4 + ax, 0.08, fz - fwd[1] * 0.4 + az);
    }
    ramps.push(pts);
  }
  const corners: Array<[number, number]> = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const spans: Array<[[number, number], [number, number]]> = [];
    if (i === 2) {
      // Front edge (b = HALF): leave the stair opening.
      spans.push([[HALF, HALF], [stairW / 2 + 0.4, HALF]], [[-(stairW / 2 + 0.4), HALF], [-HALF, HALF]]);
    } else spans.push([a, b]);
    for (const [s0, s1] of spans) {
      const [x0, z0] = P(s0[0], s0[1]);
      const [x1, z1] = P(s1[0], s1[1]);
      solid.setColor(0xf6f3ec);
      addBeam(solid, x0, BASE_Y + 0.95, z0, x1, BASE_Y + 0.95, z1, 0.22, 0.14);
      addBeam(solid, x0, BASE_Y + 0.15, z0, x1, BASE_Y + 0.15, z1, 0.26, 0.14);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 0.4));
      for (let k = 1; k < n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        detail.setColor(0xd8a640); // gold balusters as on the board
        addBeam(detail, x, BASE_Y + 0.22, z, x, BASE_Y + 0.88, z, 0.08, 0.08);
      }
      boxes.push((x0 + x1) / 2, BASE_Y + 0.55, (z0 + z1) / 2, 0.12, 0.55, len / 2, Math.atan2(-(x1 - x0) / len, -(z1 - z0) / len));
    }
    // Corner posts with twin-globe lamps.
    const [px, pz] = P(a[0], a[1]);
    solid.setColor(0xf6f3ec);
    addBeam(solid, px, BASE_Y, pz, px, BASE_Y + 1.3, pz, 0.55, 0.55);
    detail.setColor(0xd8a640);
    addBeam(detail, px, BASE_Y + 1.3, pz, px, BASE_Y + 3.6, pz, 0.12, 0.12);
    for (const o of [-0.35, 0.35]) {
      const glob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), materials().lampHead);
      glob.position.set(px + side[0] * o, BASE_Y + 3.75, pz + side[1] * o);
      near.add(glob);
    }
  }

  // Pavilion: 12 golden columns, mirror-glass walls with a front doorway.
  const colSpots: Array<[number, number]> = [];
  for (const a of [-PAV, -PAV / 3, PAV / 3, PAV]) {
    colSpots.push([a, -PAV], [a, PAV]);
  }
  for (const b of [-PAV / 3, PAV / 3]) colSpots.push([-PAV, b], [PAV, b]);
  columnGeo ??= new THREE.CylinderGeometry(0.26, 0.3, COL_H, 16);
  const col = new THREE.InstancedMesh(columnGeo, M.gold, colSpots.length);
  const m4 = new THREE.Matrix4();
  colSpots.forEach(([a, b], i) => {
    const [x, z] = P(a, b);
    col.setMatrixAt(i, m4.makeTranslation(x, BASE_Y + COL_H / 2, z));
    colliders.push(x, z, 0.35);
  });
  col.castShadow = true;
  col.computeBoundingSphere();
  far.add(col);
  // Glass panels between columns (front middle bay is the doorway).
  const bays: Array<[[number, number], [number, number], boolean]> = [];
  const edgeCols = (fixed: 'a' | 'b', value: number) => {
    const ts = [-PAV, -PAV / 3, PAV / 3, PAV];
    for (let i = 0; i < 3; i++) {
      const p0: [number, number] = fixed === 'b' ? [ts[i]!, value] : [value, ts[i]!];
      const p1: [number, number] = fixed === 'b' ? [ts[i + 1]!, value] : [value, ts[i + 1]!];
      bays.push([p0, p1, fixed === 'b' && value === PAV && i === 1]);
    }
  };
  edgeCols('b', -PAV);
  edgeCols('b', PAV);
  edgeCols('a', -PAV);
  edgeCols('a', PAV);
  for (const [p0, p1, door] of bays) {
    const [x0, z0] = P(p0[0], p0[1]);
    const [x1, z1] = P(p1[0], p1[1]);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    if (door) {
      // Glass transom above the doorway only.
      const top = add(new THREE.PlaneGeometry(len - 0.5, 1.2), M.glass, near, mx, BASE_Y + COL_H - 0.7, mz, ry);
      top.castShadow = false;
      continue;
    }
    const pane = add(new THREE.PlaneGeometry(len - 0.5, COL_H - 0.3), M.glass, near, mx, BASE_Y + (COL_H - 0.3) / 2, mz, ry);
    pane.castShadow = false;
    // Gold mullion bars.
    detail.setColor(0xd8a640);
    for (const t of [0.33, 0.66]) {
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      addBeam(detail, x, BASE_Y, z, x, BASE_Y + COL_H, z, 0.06, 0.06);
    }
    boxes.push(mx, BASE_Y + COL_H / 2, mz, 0.08, COL_H / 2, len / 2, Math.atan2(-(x1 - x0) / len, -(z1 - z0) / len));
  }
  // Ornamented frieze and three-tier gold roof with crests and spire.
  const frieze = add(new THREE.BoxGeometry(PAV * 2 + 0.8, 0.7, PAV * 2 + 0.8), [M.frieze, M.frieze, M.gold, M.gold, M.frieze, M.frieze] as unknown as THREE.Material, far, cx, BASE_Y + COL_H + 0.35, cz, yaw);
  frieze.castShadow = true;
  boxes.push(cx, BASE_Y + COL_H + 0.35, cz, PAV + 0.4, 0.35, PAV + 0.4, yaw);
  for (let t = 0; t < 3; t++) {
    const k = 1 - t * 0.28;
    const roof = add(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4), M.gold, far, cx, BASE_Y + COL_H + 1.25 + t * 1.15, cz, yaw);
    roof.scale.set((PAV * 2 + 1.8) * k, 1.6, (PAV * 2 + 1.8) * k);
    // Upturned crest finials at the corners of each tier.
    for (const [a, b] of corners) {
      const [x, z] = P((a / HALF) * (PAV + 0.9) * k, (b / HALF) * (PAV + 0.9) * k);
      const fin = add(new THREE.ConeGeometry(0.14, 0.9, 6), M.gold, near, x, BASE_Y + COL_H + 0.75 + t * 1.15, z);
      fin.rotation.z = 0.25;
    }
  }
  add(new THREE.ConeGeometry(0.3, 3.4, 10), M.gold, far, cx, BASE_Y + COL_H + 5.5, cz);
  for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.42 - k * 0.08, 0.46 - k * 0.08, 0.2, 12), M.gold, near, cx, BASE_Y + COL_H + 4.2 + k * 0.4, cz);

  // Interior: red carpet, gold throne, the seated Buddha and offerings.
  {
    const carpet = add(new THREE.PlaneGeometry(PAV * 2 - 0.4, PAV * 2 - 0.4), M.carpet, near, cx, BASE_Y + 0.02, cz, 0);
    carpet.rotation.x = -Math.PI / 2;
    carpet.rotation.z = yaw;
    carpet.castShadow = false;
    const [tx, tz] = P(0, -PAV + 1.8);
    for (let t = 0; t < 3; t++) {
      const step = add(new THREE.BoxGeometry(3.2 - t * 0.5, 0.35, 2.0 - t * 0.3), M.gold, near, tx, BASE_Y + 0.18 + t * 0.35, tz, yaw);
      step.receiveShadow = true;
    }
    boxes.push(tx, BASE_Y + 0.55, tz, 1.6, 0.55, 1.0, yaw);
    const buddha = ornateBuddha(M);
    buddha.position.set(tx, BASE_Y + 1.05, tz);
    buddha.rotation.y = yaw; // faces the doorway
    near.add(buddha);
    for (const s of [-1, 1]) {
      const [vx, vz] = P(s * 2.2, -PAV + 2.4);
      add(new THREE.LatheGeometry([[0, 0], [0.22, 0], [0.3, 0.3], [0.18, 0.62], [0.24, 0.75], [0, 0.75]].map(([r, y]) => new THREE.Vector2(r, y)), 12), M.vase, near, vx, BASE_Y, vz);
      for (let f = 0; f < 7; f++) {
        const a = (f / 7) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.12, 8, 6), f % 2 ? M.flower : M.leaf, near, vx + Math.cos(a) * 0.18, BASE_Y + 0.9 + (f % 3) * 0.06, vz + Math.sin(a) * 0.18);
      }
      colliders.push(vx, vz, 0.35);
    }
  }

  // Covered colonnade linking to Lawkanandar's west staircase.
  {
    const [x0, z0, x1, z1] = lm.ms.link;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    const nx = -dz;
    const nz = dx;
    const w = 3.2;
    const path = new GeometryBuilder();
    path.setColor(0xe9e5dc);
    path.upTri(x0 + nx * w / 2, z0 + nz * w / 2, x1 + nx * w / 2, z1 + nz * w / 2, x1 - nx * w / 2, z1 - nz * w / 2, 0.11);
    path.upTri(x0 + nx * w / 2, z0 + nz * w / 2, x1 - nx * w / 2, z1 - nz * w / 2, x0 - nx * w / 2, z0 - nz * w / 2, 0.11);
    const pm = new THREE.Mesh(path.build(), materials().landuse);
    pm.receiveShadow = true;
    far.add(pm);
    const n = Math.max(1, Math.round(len / 3.5));
    for (let k = 0; k <= n; k++) {
      for (const s of [-1, 1]) {
        const x = x0 + dx * len * (k / n) + nx * s * (w / 2 + 0.2);
        const z = z0 + dz * len * (k / n) + nz * s * (w / 2 + 0.2);
        solid.setColor(0xf6f3ec);
        addBeam(solid, x, 0.08, z, x, 3.2, z, 0.3, 0.3);
        colliders.push(x, z, 0.22);
      }
    }
    solid.setColor(0xf6f3ec);
    addBeam(solid, x0, 3.35, z0, x1, 3.35, z1, w + 1.0, 0.3);
    solid.setColor(0xd8a640);
    addBeam(solid, x0 + nx * (w / 2 + 0.5), 3.5, z0 + nz * (w / 2 + 0.5), x1 + nx * (w / 2 + 0.5), 3.5, z1 + nz * (w / 2 + 0.5), 0.12, 0.2);
    addBeam(solid, x0 - nx * (w / 2 + 0.5), 3.5, z0 - nz * (w / 2 + 0.5), x1 - nx * (w / 2 + 0.5), 3.5, z1 - nz * (w / 2 + 0.5), 0.12, 0.2);
  }

  const sm = new THREE.Mesh(solid.build(), materials().solid);
  sm.castShadow = true;
  sm.receiveShadow = true;
  far.add(sm);
  const dm = new THREE.Mesh(detail.build(), materials().solid);
  dm.castShadow = true;
  near.add(dm);

  // A small layout so visitors, mats, info and discovery work like the pagoda.
  const mats3: Array<[number, number, number]> = [-1.4, 0, 1.4].map((s) => {
    const [x, z] = P(s, -PAV + 4.2);
    return [x, z, yaw + Math.PI];
  });
  const circuit: Array<[number, number]> = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = HALF - 1.2;
    const sq = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    circuit.push(P((Math.cos(a) / sq) * r, (Math.sin(a) / sq) * r));
  }
  const layout: PagodaLayout = {
    centre: [cx, cz],
    ring: corners.map(([a, b]) => P(a, b)),
    u: side,
    v: fwd,
    lenU: HALF * 2,
    lenV: HALF * 2,
    minSide: HALF * 2,
    stairWidth: stairW,
    entrances: [{ edge: [fx, fz], bottom: [fx + fwd[0] * (run + 0.5), fz + fwd[1] * (run + 0.5)], out: fwd, along: side }],
    main: 0,
    stupa: { baseR: PAV, height: BASE_Y + COL_H + 7, terraceR: [PAV + 1], terraceH: BASE_Y },
    smallStupas: { radius: 0, angles: [] },
    hall: null,
    circuit,
    prayerSpots: [[...P(0, PAV + 1.3), yaw + Math.PI] as [number, number, number]],
    mats: mats3,
  };
  let level = -1;
  const site: PagodaSite = {
    id: lm.id,
    name: lm.ne ?? lm.n,
    ...(lm.nl ? { nameLocal: lm.nl } : {}),
    layout,
    note: 'Not mapped in OpenStreetMap: placed from the project owner\'s description, west of Lawkanandar Pagoda and linked to it by a covered walkway. The mirror building, statue and interior are an artistic reconstruction based on reference images.',
    update(px, pz) {
      const next = Math.hypot(px - cx, pz - cz) < 140 ? 0 : 1;
      if (next === level) return;
      level = next;
      near.visible = level === 0;
    },
  };
  site.update(cx + 1e6, cz);
  return { group, colliders, boxes, ramps, site };
}

/** Seated Buddha: dark ornate mosaic body, gilded face, holding a gold star lotus. Artistic. */
function ornateBuddha(M: ReturnType<typeof mats>): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.LatheGeometry([[0, 0], [1.25, 0], [1.35, 0.15], [1.1, 0.32], [1.3, 0.45], [0, 0.45]].map(([r, y]) => new THREE.Vector2(r, y)), 20), M.gold, 0, -0.45, 0);
  add(new THREE.SphereGeometry(0.95, 20, 12), M.mosaic, 0, 0.3, 0, 1.0, 0.36, 0.64);
  add(new THREE.SphereGeometry(0.56, 20, 14), M.mosaic, 0, 1.05, 0.05, 1.0, 1.25, 0.72);
  add(new THREE.SphereGeometry(0.34, 20, 16), M.face, 0, 1.92, -0.02, 1, 1.12, 1);
  add(new THREE.ConeGeometry(0.22, 0.42, 14), M.mosaic, 0, 2.38, 0);
  for (const x of [-0.34, 0.34]) add(new THREE.BoxGeometry(0.07, 0.38, 0.14), M.face, x, 1.84, 0);
  // Gold star-lotus held in the lap.
  const star = new THREE.Shape();
  for (let k = 0; k < 16; k++) {
    const r = k % 2 ? 0.11 : 0.26;
    const a = (k * Math.PI) / 8;
    if (k === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const lotus = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.08, bevelEnabled: false }), M.face);
  lotus.position.set(0, 0.78, -0.48);
  lotus.rotation.x = -0.9;
  g.add(lotus);
  return g;
}
