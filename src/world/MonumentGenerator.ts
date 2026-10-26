import * as THREE from 'three';
import type { ChunkLandmark, ChunkRoad } from '../geo/chunkFormat';
import { pointInRing, ringCentroid, type Pt } from '../geo/geometry2d';
import { addBeam, addFlatPolygon, GeometryBuilder } from './GeometryBuilder';
import { flagTexture } from './FlagTexture';
import { LABEL_FONT } from './LandmarkGenerator';
import { materials } from './materials';

/**
 * Statue/monument sites (OSM historic=monument|memorial, tourism=artwork,
 * memorial=statue). Placement is real: the figure stands at the mapped node,
 * and when that node lies inside a mapped closed road loop (a roundabout, as
 * at the U Ottama statue in Sittwe), the loop's real island shape becomes a
 * landscaped plaza. The statue, pedestal, flowerbeds, railing, flags and lamps
 * are an artistic representation, not a survey of the real site.
 */

export const MONUMENT_KINDS: ReadonlySet<string> = new Set(['monument', 'memorial', 'statue', 'artwork', 'clock']);

const BRONZE = () => new THREE.MeshStandardMaterial({ color: 0x5f4c34, roughness: 0.45, metalness: 0.65 });
const flatMat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

export interface MonumentObjects {
  group: THREE.Group;
  /** Collider cylinders: flat x, z, radius. */
  colliders: number[];
  /** Height of the tallest part (for label placement). */
  height: number;
}

/** Finds a closed road loop (roundabout) around the point; returns its ring and road half-width. */
function findIsland(x: number, z: number, roads: ChunkRoad[]): { ring: Pt[]; hw: number } | null {
  for (const r of roads) {
    const p = r.p;
    if (p.length < 8 || p[0] !== p[p.length - 2] || p[1] !== p[p.length - 1]) continue;
    const ring: Pt[] = [];
    for (let i = 0; i < p.length - 2; i += 2) ring.push([p[i]!, p[i + 1]!]);
    if (pointInRing(x, z, ring)) return { ring, hw: r.w / 2 };
  }
  return null;
}

function scaleRing(ring: Pt[], cx: number, cz: number, offset: number): Pt[] {
  // Moves each vertex toward the centroid by `offset` meters (inset).
  return ring.map(([px, pz]) => {
    const d = Math.hypot(px - cx, pz - cz) || 1;
    const k = Math.max(0.05, (d - offset) / d);
    return [cx + (px - cx) * k, cz + (pz - cz) * k];
  });
}

const flatten = (r: Pt[]) => r.flatMap((p) => p);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plaqueTexture(lm: ChunkLandmark): THREE.CanvasTexture {
  const my = lm.nl ?? lm.n;
  return canvasTexture(256, 320, (g) => {
    g.fillStyle = '#f3efe4';
    g.fillRect(0, 0, 256, 320);
    g.strokeStyle = '#b9a77a';
    g.lineWidth = 6;
    g.strokeRect(10, 10, 236, 300);
    g.fillStyle = '#7a5a20';
    g.textAlign = 'center';
    g.font = `600 30px ${LABEL_FONT}`;
    const words = my.split(/\s+/);
    words.slice(0, 3).forEach((w, i) => g.fillText(w, 128, 110 + i * 52, 220));
    g.fillStyle = 'rgba(122,90,32,0.45)';
    for (let i = 0; i < 4; i++) g.fillRect(48, 240 + i * 14, 160, 4);
  });
}

function clockFaceTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#f7f4ea';
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 8;
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineWidth = i % 3 ? 4 : 9;
      g.beginPath();
      g.moveTo(128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92);
      g.lineTo(128 + Math.sin(a) * 110, 128 - Math.cos(a) * 110);
      g.stroke();
    }
    g.lineCap = 'round';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + 50, 128 - 30);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 - 10, 128 - 88);
    g.stroke();
  });
}

/**
 * Clock towers (artistic, ~15 m) with four clock faces.
 *  - colonial: cream tower, red hip roof, weather vane (Old Clock Tower, 1887).
 *  - burmese: green-and-cream tower with gold trim and a tiered gold roof (New Clock Tower).
 */
function clockTower(own: (m: THREE.Material) => THREE.Material, style: 'colonial' | 'burmese' = 'colonial'): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  const burmese = style === 'burmese';
  const cream = own(flatMat(burmese ? 0x287154 : 0x8a3830));
  const trim = own(burmese ? new THREE.MeshStandardMaterial({ color: 0xd9a93c, roughness: 0.35, metalness: 0.7 }) : flatMat(0xb8463a));
  const box = (w: number, h: number, d: number, y: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.y = y + h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  box(3.4, 0.5, 3.4, 0, trim);
  box(2.6, 9, 2.6, 0.5, cream);
  if(burmese) for(const x of [-1.26,1.26]) for(const z of [-1.26,1.26]) {
    const rib=new THREE.Mesh(new THREE.BoxGeometry(.12,9.2,.12),trim);rib.position.set(x,5.1,z);group.add(rib);
  }
  if(burmese){
    const tex=canvasTexture(128,512,g=>{
      g.fillStyle='#3d8b52';g.fillRect(0,0,128,512);g.strokeStyle='#e7dba2';g.lineWidth=5;g.strokeRect(3,3,122,506);
      for(const x of [12,103]){g.fillStyle='#465d65';g.fillRect(x,25,13,110);g.fillRect(x,365,13,110)}
      g.strokeStyle='#e5d79b';g.lineWidth=4;
      for(let y=30;y<480;y+=50){g.beginPath();g.moveTo(64,y);g.bezierCurveTo(30,y+15,90,y+30,64,y+50);g.stroke();g.beginPath();g.ellipse(53,y+20,7,13,-.7,0,Math.PI*2);g.stroke()}
    });
    const panel=own(new THREE.MeshStandardMaterial({map:tex,roughness:.8}));
    for(let i=0;i<4;i++){const a=i*Math.PI/2,m=new THREE.Mesh(new THREE.PlaneGeometry(2.35,8.4),panel);m.position.set(Math.sin(a)*1.307,5,Math.cos(a)*1.307);m.rotation.y=a;group.add(m)}
  }
  box(3.0, 0.3, 3.0, 9.5, trim);
  box(2.8, 2.8, 2.8, 9.8, cream);
  box(3.1, 0.25, 3.1, 12.6, trim);
  if (burmese) {
    // Tiered (pyatthat-style) gold roof with a spire.
    let y = 12.85;
    [2.3, 1.7, 1.15, 0.7].forEach((r, i) => {
      const tier = new THREE.Mesh(new THREE.ConeGeometry(r, 0.9, 4).rotateY(Math.PI / 4), trim);
      tier.position.y = y + 0.45;
      tier.castShadow = true;
      group.add(tier);
      y += i < 3 ? 0.75 : 0.9;
    });
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 2.0, 6), trim);
    spire.position.y = y + 1.0;
    group.add(spire);
  } else {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.2, 4).rotateY(Math.PI / 4), trim);
    cap.position.y = 12.85 + 1.1;
    cap.castShadow = true;
    group.add(cap);
    // Weather vane: rod, arrow and N/S/E/W arms.
    const iron = own(flatMat(0x2b2b2b));
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.06), iron);
    rod.position.y = 15.1 + 0.7;
    const arrow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.12), iron);
    arrow.position.y = 16.5;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.28), iron);
    tail.position.set(-0.5, 16.5, 0);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.04), iron);
    arms.position.y = 16.1;
    const arms2 = arms.clone();
    arms2.rotation.y = Math.PI / 2;
    group.add(rod, arrow, tail, arms, arms2);
  }
  const face = own(new THREE.MeshStandardMaterial({ map: clockFaceTexture(), roughness: 0.5 }));
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), face);
    const a = (i * Math.PI) / 2;
    m.position.set(Math.sin(a) * 1.41, 11.2, Math.cos(a) * 1.41);
    m.rotation.y = a;
    group.add(m);
  }
  return { group, height: 15 };
}

export function robedFigure(): THREE.Group {
  const fig = new THREE.Group();
  const bronze = BRONZE();
  bronze.userData['own'] = true;
  const robe = new THREE.LatheGeometry(
    [
      [0, 0], [0.4, 0], [0.43, 0.12], [0.37, 0.7], [0.33, 1.2], [0.36, 1.45], [0.34, 1.62], [0.22, 1.74], [0.09, 1.78], [0, 1.78],
    ].map(([a, b]) => new THREE.Vector2(a, b)),
    14,
  ).scale(1, 1, 0.72);
  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, bronze);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    fig.add(m);
    return m;
  };
  add(robe);
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8), 0, 1.82);
  add(new THREE.SphereGeometry(0.15, 12, 10), 0, 1.98); // shaven head
  // Robe drape over the left shoulder.
  add(new THREE.BoxGeometry(0.16, 1.1, 0.5), -0.27, 1.15, 0, 0, 0.18);
  // Right arm hanging; left forearm across the waist.
  add(new THREE.CapsuleGeometry(0.065, 0.62, 3, 8), 0.4, 1.33, 0, 0, 0.08);
  add(new THREE.CapsuleGeometry(0.06, 0.4, 3, 8), -0.1, 1.15, -0.28, 0, Math.PI / 2 - 0.2);
  return fig;
}

/** Builds a monument site at a mapped landmark. Faces toward `faceYaw` (radians, 0 = -Z). */
export function buildMonument(lm: ChunkLandmark, roads: ChunkRoad[], faceYaw: number): MonumentObjects {
  const group = new THREE.Group();
  group.name = `monument_${lm.id}`;
  group.userData['artistic'] = true;
  const colliders: number[] = [];
  const own = (m: THREE.Material) => {
    m.userData['own'] = true;
    return m;
  };

  // --- Plaza on the real roundabout island (or a small paved square). ---
  const island = findIsland(lm.x, lm.z, roads);
  let ring: Pt[];
  let cx = lm.x;
  let cz = lm.z;
  if (island) {
    [cx,cz] = ringCentroid(island.ring);
    ring = scaleRing(island.ring, cx, cz, island.hw + 0.25);
  } else {
    ring = Array.from({ length: 12 }, (_, i): Pt => [lm.x + Math.cos((i / 12) * Math.PI * 2) * 5, lm.z + Math.sin((i / 12) * Math.PI * 2) * 5]);
  }
  const radius = ring.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / ring.length;

  const ground = new GeometryBuilder();
  ground.setColor(0x6f9a4c); // grass verge
  addFlatPolygon(ground, [flatten(ring)], 0.125);
  ground.setColor(0xd2cdc2); // paving
  addFlatPolygon(ground, [flatten(scaleRing(ring, cx, cz, Math.min(1.2, radius * 0.12)))], 0.13);
  const beds = new GeometryBuilder();
  const outer = scaleRing(ring, cx, cz, radius * 0.22);
  const inner = scaleRing(ring, cx, cz, radius * 0.36);
  // Flowerbed ring with a raised kerb.
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    // Skip two opposite segments to leave walkways to the statue.
    if (i % Math.max(2, Math.floor(outer.length / 2)) === 0) continue;
    beds.setColor(0xb8323a);
    beds.upTri(outer[i]![0], outer[i]![1], outer[j]![0], outer[j]![1], inner[j]![0], inner[j]![1], 0.32);
    beds.upTri(outer[i]![0], outer[i]![1], inner[j]![0], inner[j]![1], inner[i]![0], inner[i]![1], 0.32);
  }
  if(lm.k==='clock')for(let i=0;i<ring.length;i++){
    const a=ring[i]!,b=ring[(i+1)%ring.length]!;
    beds.setColor(i%2?0xf2eee5:0xb93632);addBeam(beds,a[0],.2,a[1],b[0],.2,b[1],.22,.3);
  }
  const groundMesh = new THREE.Mesh(ground.build(), materials().landuse);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  if (!beds.isEmpty()) {
    const bedMesh = new THREE.Mesh(beds.build(), materials().landuse);
    bedMesh.receiveShadow = true;
    group.add(bedMesh);
  }

  // Low white railing around the island edge.
  const rail = scaleRing(ring, cx, cz, 0.35);
  const white = own(flatMat(lm.k==='clock'&&lm.cs==='burmese'?0x51764b:0xf4f2ec));
  const railGroup = new THREE.Group();
  for (let i = 0; i < rail.length; i++) {
    const a = rail[i]!;
    const b = rail[(i + 1) % rail.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), white);
    bar.position.set((a[0] + b[0]) / 2, 0.6, (a[1] + b[1]) / 2);
    bar.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    railGroup.add(bar);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.1), white);
    post.position.set(a[0], 0.33, a[1]);
    railGroup.add(post);
  }
  group.add(railGroup);

  if (lm.k === 'clock') {
    const tower = clockTower(own, lm.cs ?? 'colonial');
    tower.group.position.set(cx, 0.13, cz);
    tower.group.rotation.y = faceYaw;
    group.add(tower.group);
    colliders.push(cx, cz, 1.8);
    return { group, colliders, height: tower.height };
  }

  // --- Pedestal and statue at the mapped node. ---
  const site = new THREE.Group();
  site.position.set(lm.x, 0.13, lm.z);
  site.rotation.y = faceYaw;
  const orange = own(flatMat(0xd8843a));
  const cream = own(flatMat(0xf1ece0));
  const box = (w: number, h: number, d: number, y: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.y = y + h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    site.add(mesh);
    return mesh;
  };
  box(3.0, 0.3, 3.0, 0, orange);
  box(2.4, 0.3, 2.4, 0.3, orange);
  box(1.55, 2.3, 1.55, 0.6, cream);
  box(1.8, 0.16, 1.8, 2.9, cream);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.45), own(new THREE.MeshStandardMaterial({ map: plaqueTexture(lm), roughness: 0.6 })));
  plaque.position.set(0, 1.8, -0.785);
  plaque.rotation.y = Math.PI;
  site.add(plaque);
  const figure = robedFigure();
  figure.position.y = 3.06;
  figure.scale.setScalar(1.25);
  site.add(figure);
  group.add(site);
  colliders.push(lm.x, lm.z, 1.55);

  // --- Flagpoles either side of the statue. ---
  const metal = materials().metal;
  const flags = [flagTexture(), flagTexture()];
  const side = Math.min(radius * 0.7, 5);
  [-1, 1].forEach((s, i) => {
    const px = lm.x + Math.cos(faceYaw) * side * s;
    const pz = lm.z - Math.sin(faceYaw) * side * s;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 9, 6), metal);
    pole.position.set(px, 4.6, pz);
    pole.castShadow = true;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.06, 6, 1), own(new THREE.MeshStandardMaterial({ map: flags[i]!, side: THREE.DoubleSide, roughness: 0.9 })));
    // Gentle static wave.
    const pos = flag.geometry.getAttribute('position');
    for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin((pos.getX(k) + 0.85) * 3) * 0.08);
    flag.geometry.computeVertexNormals();
    flag.position.set(px + Math.cos(faceYaw) * 0.88 * s, 8.4, pz - Math.sin(faceYaw) * 0.88 * s);
    flag.rotation.y = faceYaw;
    flag.castShadow = true;
    group.add(flag);
    colliders.push(px, pz, 0.15);
  });

  // --- Decorative twin-globe lamps on the diagonals. ---
  const lampR = Math.min(radius * 0.55, 6);
  for (let i = 0; i < 4; i++) {
    const a = faceYaw + Math.PI / 4 + (i * Math.PI) / 2;
    const px = cx + Math.cos(a) * lampR;
    const pz = cz + Math.sin(a) * lampR;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 6), metal);
    post.position.set(px, 1.93, pz);
    group.add(post);
    for (const o of [-0.28, 0.28]) {
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), materials().lampHead);
      globe.position.set(px + o, 3.85, pz);
      globe.userData['sharedMaterial'] = true;
      group.add(globe);
    }
    colliders.push(px, pz, 0.12);
  }

  return { group, colliders, height: 7.2 };
}

/** Disposes per-monument materials/textures (geometries are disposed with the chunk). */
export function disposeMonument(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && !Array.isArray(m) && m.userData['own']) {
      m.map?.dispose();
      m.dispose();
    }
  });
}
