import * as THREE from 'three';
import type { ChunkLandmark } from '../geo/chunkFormat';
import { addBeam, addFlatPolygon, GeometryBuilder } from './GeometryBuilder';
import { materials } from './materials';
import { palmGeometry } from './VegetationGenerator';

/**
 * Point Beach View Point (Sittwe Point), modelled on photos of the site and
 * the reference asset sheet: a circular viewing plaza at the tip with a
 * golden flute-playing statue on a lotus base and red stepped podium, a white
 * observation tower with a blue spiral stripe and red roof, a historic
 * cannon, terracotta walkway paving, a blue paved loop around an oval
 * garden, a white seawall balustrade with pillars, concrete tetrapod
 * wave-breakers, palms, black lamp posts, stone benches, a gazebo, a Myanmar
 * flag and the entrance sign.
 * Its outline is fitted to the real headland (see geo/promenade.ts); the
 * detailing is an artistic representation.
 */

function paveTexture(base: string, line: string, fans: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = line;
  g.lineWidth = 2;
  if (fans) {
    // Overlapping fan (scale) pattern like the Point's cobbles.
    for (let y = -16; y < 144; y += 16) {
      for (let x = (y / 16) % 2 ? -16 : 0; x < 144; x += 32) {
        for (let r = 4; r <= 16; r += 4) {
          g.beginPath();
          g.arc(x, y, r, Math.PI, 0);
          g.stroke();
        }
      }
    }
  } else {
    for (let i = 0; i < 128; i += 8) {
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(128, i);
      g.stroke();
      for (let x = (i / 8) % 2 ? 4 : 0; x < 128; x += 8) {
        g.beginPath();
        g.moveTo(x, i);
        g.lineTo(x, i + 8);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 4, 1 / 4); // one tile per 4 m (UVs are world meters)
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function vxOf(_ux: number, uz: number): number {
  return -uz;
}
function vzOf(ux: number, _uz: number): number {
  return ux;
}

/** Concentric red/grey ring tiles for the viewing plaza (UV 0..1 across the plaza). */
function circleTileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9c2b6';
  g.fillRect(0, 0, 512, 512);
  for (let r = 256; r > 10; r -= 22) {
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.fillStyle = (r / 22) % 2 < 1 ? '#a8574a' : '#d6cfc3';
    g.fill();
  }
  g.strokeStyle = 'rgba(80,40,30,0.35)';
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * 40, 256 + Math.sin(a) * 40);
    g.lineTo(256 + Math.cos(a) * 256, 256 + Math.sin(a) * 256);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White with a blue diagonal band that wraps into a spiral on a cylinder. */
function spiralTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f6f2';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#3a78c2';
  g.lineWidth = 34;
  for (let k = -2; k < 3; k++) {
    g.beginPath();
    g.moveTo(-20, 256 + k * 128);
    g.lineTo(276, k * 128);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1.5);
  return t;
}

function myanmarFlag(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 180;
  c.height = 120;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fecb00';
  g.fillRect(0, 0, 180, 40);
  g.fillStyle = '#34b233';
  g.fillRect(0, 40, 180, 40);
  g.fillStyle = '#ea2839';
  g.fillRect(0, 80, 180, 40);
  // White five-pointed star.
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 22 : 54;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    g.lineTo(90 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 166;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f4f8f';
  g.fillRect(0, 0, 384, 166);
  g.strokeStyle = '#e8eef6';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 368, 150);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '600 34px "Noto Sans Myanmar", "Myanmar Sangam MN", sans-serif';
  g.fillText('ပွိုင့်ကမ်းခြေ ရှုခင်းသာ', 192, 72);
  g.font = '600 28px Inter, sans-serif';
  g.fillText('Point Beach View Point', 192, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let tetraGeo: THREE.BufferGeometry | null = null;
/** Four-legged concrete wave-breaker (tetrapod), vertex-coloured grey. */
function tetrapodGeometry(): THREE.BufferGeometry {
  if (tetraGeo) return tetraGeo;
  const b = new GeometryBuilder();
  b.setColor(0xb9b5ab);
  const legs: Array<[number, number, number]> = [
    [0, 1, 0],
    [0.94, -0.33, 0],
    [-0.47, -0.33, 0.82],
    [-0.47, -0.33, -0.82],
  ];
  for (const [x, y, z] of legs) addBeam(b, 0, 0.6, 0, x * 1.1, 0.6 + y * 1.1, z * 1.1, 0.5, 0.5);
  tetraGeo = b.build();
  return tetraGeo;
}

/** Golden figure playing a flute, on the lotus base (artistic, modelled on the reference). */
function fluteFigure(): THREE.Group {
  const g = new THREE.Group();
  const gold = materials().gold;
  const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, gold);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
  };
  part(new THREE.CylinderGeometry(0.28, 0.42, 1.5, 12), 0, 0.75, 0); // lower robe
  part(new THREE.CylinderGeometry(0.26, 0.3, 0.8, 12), 0, 1.9, 0); // torso
  part(new THREE.SphereGeometry(0.22, 14, 10), 0, 2.5, 0); // head
  part(new THREE.ConeGeometry(0.2, 0.5, 8), 0, 2.85, 0); // crown
  part(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8), 0.28, 2.0, -0.18, 0.5, 0, 0.6); // right upper arm
  part(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8), -0.28, 2.0, -0.18, 0.5, 0, -0.6); // left upper arm
  part(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 8), 0.05, 2.32, -0.3, 0, 0, Math.PI / 2 - 0.25); // flute
  part(new THREE.TorusGeometry(0.42, 0.04, 6, 20), 0, 1.5, 0, Math.PI / 2, 0, 0); // sash ring
  return g;
}

export interface PromenadeObjects {
  group: THREE.Group;
  colliders: number[];
}

export function buildPromenade(lm: ChunkLandmark): PromenadeObjects | null {
  const pr = lm.pr;
  if (!pr || pr.stations.length < 16) return null;
  const group = new THREE.Group();
  group.name = 'point-promenade';
  group.userData['artistic'] = true;
  const colliders: number[] = [];
  const [ux, uz] = pr.axis;
  const lx = -uz;
  const lz = ux; // "left" perpendicular
  const st: Array<{ x: number; z: number; l: number; r: number }> = [];
  for (let i = 0; i < pr.stations.length; i += 4) st.push({ x: pr.stations[i]!, z: pr.stations[i + 1]!, l: pr.stations[i + 2]!, r: pr.stations[i + 3]! });
  const L = st.length;
  const edge = (s: (typeof st)[number], side: number, inset = 0) => [s.x + lx * side * ((side > 0 ? s.l : s.r) - inset), s.z + lz * side * ((side > 0 ? s.l : s.r) - inset)] as [number, number];

  const own: THREE.Material[] = [];
  // Layer order (bottom → top): paving, blue loop, garden. Offsets increase per layer.
  const texMat = (t: THREE.Texture, layer: number) => {
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 - layer, polygonOffsetUnits: -2 - layer * 2 });
    m.userData['own'] = true;
    own.push(m);
    return m;
  };

  // 1) Terracotta fan paving over the whole promenade outline.
  const ring: number[] = [];
  for (let i = 0; i < L; i++) ring.push(...edge(st[i]!, 1));
  for (let i = L - 1; i >= 0; i--) ring.push(...edge(st[i]!, -1));
  const pave = new GeometryBuilder();
  addFlatPolygon(pave, [ring], 0.16);
  const paveMesh = new THREE.Mesh(pave.build(), texMat(paveTexture('#a85a4c', '#8e4436', true), 0));
  paveMesh.receiveShadow = true;
  group.add(paveMesh);

  // 2) Blue loop around an oval garden, centred ~40% inland.
  const ci = Math.min(L - 1, Math.round(L * 0.66)); // garden loop sits inland of the tip plaza
  const c = st[ci]!;
  const halfLen = Math.min(45, (L * 6) * 0.22);
  const halfW = Math.max(5, Math.min(c.l, c.r) * 0.62);
  const oval = (a: number, b: number, n = 56): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2;
      // Superellipse: stadium-like shape.
      const ct = Math.cos(t);
      const sn = Math.sin(t);
      const ex = Math.sign(ct) * Math.abs(ct) ** 0.6 * a;
      const ey = Math.sign(sn) * Math.abs(sn) ** 0.8 * b;
      out.push(c.x + ux * ex + lx * ey, c.z + uz * ex + lz * ey);
    }
    return out;
  };
  const blue = new GeometryBuilder();
  addFlatPolygon(blue, [oval(halfLen, halfW), oval(halfLen - 5, halfW - 4.5)], 0.19);
  group.add(new THREE.Mesh(blue.build(), texMat(paveTexture('#3f5aa8', '#33498c', false), 1)));
  // Red borders on both sides of the loop and the garden.
  const solid = new GeometryBuilder();
  const borderLoop = (pts: number[], y: number, w: number, color: number) => {
    solid.setColor(color);
    for (let k = 0; k < pts.length; k += 2) {
      const n = (k + 2) % pts.length;
      addBeam(solid, pts[k]!, y, pts[k + 1]!, pts[n]!, y, pts[n + 1]!, w, 0.06);
    }
  };
  borderLoop(oval(halfLen, halfW), 0.2, 0.7, 0xc8442f);
  borderLoop(oval(halfLen - 5, halfW - 4.5), 0.2, 0.6, 0xc8442f);
  // Garden with hedge border.
  const garden = new GeometryBuilder();
  garden.setColor(0x7e9a4e);
  addFlatPolygon(garden, [oval(halfLen - 5.6, halfW - 5)], 0.24);
  const gardenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  gardenMat.userData['own'] = true;
  group.add(new THREE.Mesh(garden.build(), gardenMat));
  borderLoop(oval(halfLen - 5.8, halfW - 5.2), 0.45, 0.6, 0x2f5a2c);

  const m4 = new THREE.Matrix4();
  const palms: THREE.Matrix4[] = [];
  for (let k = -2; k <= 2; k++) palms.push(new THREE.Matrix4().makeTranslation(c.x + ux * k * (halfLen / 3.2), 0.24, c.z + uz * k * (halfLen / 3.2)).multiply(m4.makeScale(0.6, 0.6, 0.6)));

  // 3) Circular viewing plaza at the tip with the golden statue (Point Beach View Point).
  const tipSt = st[Math.min(4, L - 1)]!;
  const plazaR = Math.max(7, Math.min(16, Math.min(tipSt.l, tipSt.r) - 1.5));
  const px0 = tipSt.x;
  const pz0 = tipSt.z;
  const circle = (r: number, n = 48): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(px0 + Math.cos((k / n) * Math.PI * 2) * r, pz0 + Math.sin((k / n) * Math.PI * 2) * r);
    return out;
  };
  const plaza = new GeometryBuilder();
  addFlatPolygon(plaza, [circle(plazaR)], 0.2);
  const plazaMesh = new THREE.Mesh(plaza.build(), texMat(circleTileTexture(), 2));
  plazaMesh.geometry.computeBoundingBox();
  // Map UVs to the circle so the rings are concentric around the plaza centre.
  const uv = plazaMesh.geometry.getAttribute('uv');
  const pos = plazaMesh.geometry.getAttribute('position');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (pos.getX(k) - px0) / (plazaR * 2) + 0.5, (pos.getZ(k) - pz0) / (plazaR * 2) + 0.5);
  (plazaMesh.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
  plazaMesh.receiveShadow = true;
  group.add(plazaMesh);
  borderLoop(circle(plazaR), 0.22, 0.4, 0xf3efe6);
  // Red stepped round podium.
  const podium = [
    [3.6, 0.35, 0xf1ece2],
    [3.1, 0.35, 0xc23b2e],
    [2.5, 0.35, 0xf1ece2],
    [2.0, 0.35, 0xc23b2e],
  ] as const;
  let py = 0.2;
  for (const [r, h, col] of podium) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }));
    (m.material as THREE.Material).userData['own'] = true;
    m.position.set(px0, py + h / 2, pz0);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    py += h;
  }
  colliders.push(px0, pz0, 3.6);
  // Golden lotus base + flute-playing figure (artistic).
  const lotus = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [1.2, 0], [1.4, 0.25], [1.1, 0.5], [1.3, 0.75], [0.8, 1.0], [0.6, 1.1], [0, 1.1]].map(([r, y]) => new THREE.Vector2(r, y)), 16),
    materials().gold,
  );
  lotus.position.set(px0, py, pz0);
  lotus.castShadow = true;
  group.add(lotus);
  const deity = fluteFigure();
  deity.position.set(px0, py + 1.1, pz0);
  deity.rotation.y = Math.atan2(ux, uz) + Math.PI; // faces inland, toward visitors
  group.add(deity);
  // Stone benches around the plaza.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const bx = px0 + Math.cos(a) * (plazaR - 1.6);
    const bz = pz0 + Math.sin(a) * (plazaR - 1.6);
    solid.setColor(0xd8d4cc);
    addBeam(solid, bx - Math.sin(a) * 0.9, 0.42, bz + Math.cos(a) * 0.9, bx + Math.sin(a) * 0.9, 0.42, bz - Math.cos(a) * 0.9, 0.5, 0.44);
  }

  // 4) Observation tower: white with a blue spiral stripe, balcony and red roof.
  const ox = tipSt.x + lx * Math.min(plazaR + 5, tipSt.l - 3);
  const oz = tipSt.z + lz * Math.min(plazaR + 5, tipSt.l - 3);
  const towerMat = new THREE.MeshStandardMaterial({ map: spiralTexture(), roughness: 0.7 });
  towerMat.userData['own'] = true;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.3, 12, 24), towerMat);
  shaft.position.set(ox, 6.2, oz);
  shaft.castShadow = true;
  group.add(shaft);
  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7 }));
  (balcony.material as THREE.Material).userData['own'] = true;
  balcony.position.set(ox, 12.3, oz);
  group.add(balcony);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    solid.setColor(0x3a6fb5);
    addBeam(solid, ox + Math.cos(a) * 2.7, 12.45, oz + Math.sin(a) * 2.7, ox + Math.cos(a) * 2.7, 13.3, oz + Math.sin(a) * 2.7, 0.08, 0.08);
  }
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x99ccff, emissiveIntensity: 0.2, roughness: 0.2 }));
  (lantern.material as THREE.Material).userData['own'] = true;
  lantern.position.set(ox, 13.5, oz);
  group.add(lantern);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xd2453a, roughness: 0.6 }));
  (roof.material as THREE.Material).userData['own'] = true;
  roof.position.set(ox, 15.6, oz);
  roof.castShadow = true;
  group.add(roof);
  colliders.push(ox, oz, 2.4);

  // Historic cannon on a stone base, pointing out to sea.
  const cx0 = tipSt.x - lx * Math.min(plazaR + 2.5, tipSt.r - 2) - ux * 2;
  const cz0 = tipSt.z - lz * Math.min(plazaR + 2.5, tipSt.r - 2) - uz * 2;
  solid.setColor(0xb8ab92);
  addBeam(solid, cx0, 0.2, cz0, cx0, 1.1, cz0, 1.6, 1.6);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c2826, roughness: 0.45, metalness: 0.7 });
  metal.userData['own'] = true;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 14), metal);
  barrel.position.set(cx0 - ux * 0.6, 1.45, cz0 - uz * 0.6);
  barrel.lookAt(cx0 - ux * 3, 1.75, cz0 - uz * 3);
  barrel.rotateX(Math.PI / 2);
  barrel.castShadow = true;
  group.add(barrel);
  colliders.push(cx0, cz0, 1.0);

  // 5) Seawall balustrade with pillars on both sides, palms in planters, lamps, benches.
  const tetrapods: Array<[number, number, number]> = [];
  for (const side of [1, -1]) {
    let prev: [number, number] | null = null;
    for (let i = 0; i < L; i++) {
      const p = edge(st[i]!, side, 0.4);
      if (prev) {
        solid.setColor(0xf7f6f2);
        addBeam(solid, prev[0], 0.95, prev[1], p[0], 0.95, p[1], 0.18, 0.14);
        addBeam(solid, prev[0], 0.45, prev[1], p[0], 0.45, p[1], 0.12, 0.1);
      }
      // Pillar with an orange cap every station (6 m).
      solid.setColor(0xefe2c8);
      addBeam(solid, p[0], 0.16, p[1], p[0], 1.35, p[1], 0.6, 0.6);
      solid.setColor(0xd2773a);
      addBeam(solid, p[0], 1.35, p[1], p[0], 1.6, p[1], 0.75, 0.75);
      colliders.push(p[0], p[1], 0.45);
      prev = p;
      // Concrete tetrapod wave-breakers just outside the sea wall.
      for (const out of [1.6, 3.2]) {
        const w = edge(st[i]!, side, -out);
        tetrapods.push([w[0] + (i % 2) * ux * 1.5, w[1] + (i % 2) * uz * 1.5, (i * 1.3 + out) % 6.28]);
      }
      // Palms in white planters along the right-hand edge, a few on the left.
      if ((side < 0 && i > 1) || (side > 0 && i % 4 === 2)) {
        const q = edge(st[i]!, side, 3.2);
        solid.setColor(0xf3f1ea);
        addBeam(solid, q[0], 0.16, q[1], q[0], 0.6, q[1], 1.6, 1.6);
        palms.push(new THREE.Matrix4().makeTranslation(q[0], 0.6, q[1]).multiply(new THREE.Matrix4().makeRotationY(i * 1.7)).multiply(new THREE.Matrix4().makeScale(0.75, 0.75, 0.75)));
      }
      // Lamps.
      if (i % 2 === 1) {
        const q = edge(st[i]!, side, 1.8);
        solid.setColor(0x23262b);
        addBeam(solid, q[0], 0.16, q[1], q[0], 4.6, q[1], 0.14, 0.14);
        addBeam(solid, q[0], 4.6, q[1], q[0], 5.0, q[1], 0.42, 0.42);
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.3), materials().lampHead);
        g.position.set(q[0], 4.85, q[1]);
        group.add(g);
        // Stone bench between lamps.
        const bq = edge(st[i]!, side, 2.6);
        solid.setColor(0xd8d4cc);
        addBeam(solid, bq[0] - ux * 0.9, 0.42, bq[1] - uz * 0.9, bq[0] + ux * 0.9, 0.42, bq[1] + uz * 0.9, 0.5, 0.44);
      }
    }
  }

  // 6) Gazebo with a red roof, Myanmar flag and the entrance sign (inland end).
  const gi = Math.min(L - 1, Math.round(L * 0.4));
  const gs = st[gi]!;
  const gx = gs.x + lx * Math.max(4, gs.l - 5);
  const gz = gs.z + lz * Math.max(4, gs.l - 5);
  solid.setColor(0xf3f1ea);
  for (const [ox2, oz2] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]] as const) addBeam(solid, gx + ox2, 0.16, gz + oz2, gx + ox2, 2.8, gz + oz2, 0.25, 0.25);
  addBeam(solid, gx, 0.16, gz, gx, 0.35, gz, 3.8, 3.8);
  const gRoof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 1.6, 4).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0xc8392f, roughness: 0.6 }));
  (gRoof.material as THREE.Material).userData['own'] = true;
  gRoof.position.set(gx, 3.6, gz);
  gRoof.castShadow = true;
  group.add(gRoof);
  colliders.push(gx, gz, 0.4);
  const ei = Math.min(L - 1, L - 2);
  const es = st[ei]!;
  const fx = es.x - lx * Math.max(3, es.r - 3);
  const fz = es.z - lz * Math.max(3, es.r - 3);
  solid.setColor(0xe8e8e8);
  addBeam(solid, fx, 0.16, fz, fx, 9, fz, 0.12, 0.12);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshStandardMaterial({ map: myanmarFlag(), side: THREE.DoubleSide }));
  (flag.material as THREE.Material).userData['own'] = true;
  flag.position.set(fx + ux * 0.95, 8.3, fz + uz * 0.95);
  flag.rotation.y = Math.atan2(ux, uz) - Math.PI / 2;
  group.add(flag);
  const sx2 = es.x + lx * Math.max(3, es.l - 3);
  const sz2 = es.z + lz * Math.max(3, es.l - 3);
  solid.setColor(0x2b2f36);
  addBeam(solid, sx2 - vxOf(ux, uz) * 1.3, 0.16, sz2 - vzOf(ux, uz) * 1.3, sx2 - vxOf(ux, uz) * 1.3, 1.2, sz2 - vzOf(ux, uz) * 1.3, 0.12, 0.12);
  addBeam(solid, sx2 + vxOf(ux, uz) * 1.3, 0.16, sz2 + vzOf(ux, uz) * 1.3, sx2 + vxOf(ux, uz) * 1.3, 1.2, sz2 + vzOf(ux, uz) * 1.3, 0.12, 0.12);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.3), new THREE.MeshStandardMaterial({ map: signTexture(), side: THREE.DoubleSide }));
  (sign.material as THREE.Material).userData['own'] = true;
  sign.position.set(sx2, 1.85, sz2);
  sign.rotation.y = Math.atan2(ux, uz);
  group.add(sign);

  // Tetrapods (instanced).
  if (tetrapods.length) {
    const tet = new THREE.InstancedMesh(tetrapodGeometry(), materials().solid, tetrapods.length);
    const tm = new THREE.Matrix4();
    tetrapods.forEach(([x, z, r], k) => tet.setMatrixAt(k, tm.makeRotationY(r).setPosition(x, 0.1, z)));
    tet.castShadow = true;
    tet.computeBoundingSphere();
    group.add(tet);
  }

  const solidMesh = new THREE.Mesh(solid.build(), materials().solid);
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  group.add(solidMesh);
  const palmMesh = new THREE.InstancedMesh(palmGeometry(), materials().vegetation, palms.length);
  palms.forEach((m, i) => palmMesh.setMatrixAt(i, m));
  palmMesh.castShadow = true;
  palmMesh.computeBoundingSphere();
  group.add(palmMesh);
  return { group, colliders };
}
