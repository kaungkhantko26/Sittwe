import * as THREE from 'three';
import { addBeam, addFlatPolygon, GeometryBuilder } from './GeometryBuilder';
import { LANDUSE_COLORS, SurfaceY } from './materials';
import { addStrip, miterNormals } from './RoadGenerator';

/**
 * Sittwe Airport (VYSW), built from OpenStreetMap aeroway features extracted
 * by scripts/extract-airport.ts (© OpenStreetMap contributors, ODbL).
 *
 * Mapped and used as-is: the runway centreline (11/29), taxiways, apron and
 * the terminal building footprint. OSM gives no widths, so the runway uses a
 * typical 30 m and taxiways 15 m. Markings follow the ICAO standard layout
 * (threshold bars, designators, aiming points, centreline, edge lines).
 * Nothing that is not mapped (control tower, fire station, fences) is added.
 */

export interface AirportFeature {
  id: number;
  tags: Record<string, string>;
  closed: boolean;
  /** Local x,z points. */
  points: Array<[number, number]>;
}

export interface AirportData {
  source: string;
  features: AirportFeature[];
  nodes: Array<{ id: number; tags: Record<string, string>; x: number; z: number }>;
}

export function validAirport(raw: unknown): raw is AirportData {
  if (!raw || typeof raw !== 'object') return false;
  const a = raw as AirportData;
  const pt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 50000);
  return (
    Array.isArray(a.features) &&
    a.features.every((f) => f && Number.isSafeInteger(f.id) && f.tags && typeof f.tags === 'object' && Array.isArray(f.points) && f.points.length >= 2 && f.points.every(pt)) &&
    Array.isArray(a.nodes ?? [])
  );
}

export const RUNWAY_WIDTH = 30;
const TAXIWAY_WIDTH = 15;
const TERMINAL_HEIGHT = 6;

/** OSM ids of the terminal buildings, which the airport model replaces in the chunk data. */
export function airportBuildingIds(a: AirportData): string[] {
  return a.features.filter(isTerminal).map((f) => `way/${f.id}`);
}

/** The mapped terminal, or a building the extract found touching it (tagged sittwe3d:part=terminal). */
function isTerminal(f: AirportFeature): boolean {
  return f.tags['aeroway'] === 'terminal' || f.tags['sittwe3d:part'] === 'terminal';
}

export interface AirportObjects {
  group: THREE.Group;
  /** Convex hulls (flat x,y,z lists) for solid parts: terminal and parked aircraft. */
  hulls: number[][];
  /** Runway edge lights (glow at night). */
  lightMat: THREE.MeshStandardMaterial;
  /** Terminal centre and runway info, for labels and the map. */
  terminal: { x: number; z: number } | null;
  dispose(): void;
}

/** Point, direction and left normal at distance d along a polyline. */
function along(p: Array<[number, number]>, d: number): { x: number; z: number; dx: number; dz: number } {
  let rest = d;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i]!, [bx, bz] = p[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (rest <= len || i === p.length - 2) {
      const t = Math.max(0, Math.min(1, rest / len));
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
    }
    rest -= len;
  }
  const [x, z] = p[0]!;
  return { x, z, dx: 1, dz: 0 };
}

function lengthOf(p: Array<[number, number]>): number {
  let l = 0;
  for (let i = 0; i < p.length - 1; i++) l += Math.hypot(p[i + 1]![0] - p[i]![0], p[i + 1]![1] - p[i]![1]);
  return l;
}

/** Seven-segment digits (top, top-right, bottom-right, bottom, bottom-left, top-left, middle). */
const DIGITS: Record<string, string> = {
  '0': '1111110', '1': '0110000', '2': '1101101', '3': '1111001', '4': '0110011',
  '5': '1011011', '6': '1011111', '7': '1110000', '8': '1111111', '9': '1111011',
};

export function buildAirport(a: AirportData): AirportObjects {
  const group = new THREE.Group();
  group.name = 'sittwe-airport';
  const flatFx = (color: number, units: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -units;
    m.polygonOffsetUnits = -units * 2;
    return m;
  };
  const mats = {
    grass: flatFx(LANDUSE_COLORS['grass'] ?? 0x7da359, 1),
    concrete: flatFx(0x9d9b95, 3),
    taxi: flatFx(0x5a5b5e, 4),
    runway: flatFx(0x3b3d41, 5),
    white: flatFx(0xeeeeea, 7, { roughness: 0.7 }),
    yellow: flatFx(0xe0b52a, 7, { roughness: 0.7 }),
  };
  const solids = new GeometryBuilder();
  const hulls: number[][] = [];
  const geos: THREE.BufferGeometry[] = [];
  const add = (b: GeometryBuilder, m: THREE.Material, receive = true, cast = false) => {
    if (b.isEmpty()) return;
    const g = b.build();
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = receive;
    mesh.castShadow = cast;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };

  const runway = a.features.find((f) => f.tags['aeroway'] === 'runway');
  const grass = new GeometryBuilder();
  const concrete = new GeometryBuilder();
  const taxi = new GeometryBuilder();
  const rw = new GeometryBuilder();
  const white = new GeometryBuilder();
  const yellow = new GeometryBuilder();

  // A flat rectangle in the runway frame: centre at distance s along it and
  // offset o to the left; length l along, width w across.
  const rect = (b: GeometryBuilder, p: Array<[number, number]>, s: number, o: number, l: number, w: number, y: number) => {
    const c = along(p, s);
    const nx = -c.dz, nz = c.dx;
    const cx = c.x + nx * o, cz = c.z + nz * o;
    const hx = c.dx * l / 2, hz = c.dz * l / 2, wx = nx * w / 2, wz = nz * w / 2;
    b.upTri(cx - hx - wx, cz - hz - wz, cx + hx - wx, cz + hz - wz, cx + hx + wx, cz + hz + wz, y);
    b.upTri(cx - hx - wx, cz - hz - wz, cx + hx + wx, cz + hz + wz, cx - hx + wx, cz - hz + wz, y);
  };

  const lightPts: number[] = [];
  const endLights: Array<{ x: number; z: number; green: boolean }> = [];
  if (runway) {
    const p = runway.points;
    const flatP = p.flat();
    const nrm = miterNormals(flatP);
    const L = lengthOf(p);
    const hw = RUNWAY_WIDTH / 2;
    // Mown grass strip around the runway, then the runway itself.
    addStrip(grass, flatP, nrm, -75, 75, SurfaceY.landuse + 0.01);
    addStrip(rw, flatP, nrm, -hw, hw, SurfaceY.asphalt + 0.01);
    const my = SurfaceY.marking + 0.01;
    // Edge lines.
    addStrip(white, flatP, nrm, hw - 1.4, hw - 0.5, my);
    addStrip(white, flatP, nrm, -hw + 0.5, -hw + 1.4, my);
    // Each end: threshold bars, designator, aiming point; d = 1 from the start, -1 from the end.
    const ref = (runway.tags['ref'] ?? '').split('/');
    for (const [end, label] of [[0, ref[0] ?? ''], [1, ref[1] ?? '']] as Array<[number, string]>) {
      const at = (d: number) => (end === 0 ? d : L - d);
      // Digits face aircraft landing from this end. The rect() offset o is
      // toward (-dz, dx), which is the pilot's right when landing at end 0.
      const flip = end === 0 ? -1 : 1;
      // Threshold: 8 bars, 1.8 m wide, 30 m long, starting 6 m in.
      for (let i = 0; i < 4; i++) {
        const o = 3 + i * 3.4;
        rect(white, p, at(6 + 15), o, 30, 1.8, my);
        rect(white, p, at(6 + 15), -o, 30, 1.8, my);
      }
      // Designator digits, 9 m tall, 12 m after the threshold bars.
      const digits = label.replace(/[^0-9]/g, '').slice(0, 2).split('');
      const dh = 9, dw = 4, t = 0.9, gap = 2;
      const base = 6 + 30 + 12; // distance to the digit's near edge
      digits.forEach((ch, k) => {
        const segs = DIGITS[ch];
        if (!segs) return;
        // Across offset (to the pilot's right is -left): digits read left-to-right.
        const total = digits.length * dw + (digits.length - 1) * gap;
        const left = total / 2 - k * (dw + gap); // left edge offset (positive = pilot's left)
        const oc = (left - dw / 2) * flip; // centre offset in the runway's left frame
        const seg = (on: string, s0: number, o0: number, l: number, w: number) => {
          if (on === '1') rect(white, p, at(s0), o0 * flip + oc, l, w, my);
        };
        // Along-runway distance grows toward the top of the digit as the pilot reads it.
        const s = (v: number) => base + v; // v in 0..dh from the digit's bottom
        seg(segs[0]!, s(dh - t / 2), 0, t, dw);
        seg(segs[3]!, s(t / 2), 0, t, dw);
        seg(segs[6]!, s(dh / 2), 0, t, dw);
        seg(segs[1]!, s(dh * 0.75), -(dw / 2 - t / 2), dh / 2, t);
        seg(segs[2]!, s(dh * 0.25), -(dw / 2 - t / 2), dh / 2, t);
        seg(segs[5]!, s(dh * 0.75), dw / 2 - t / 2, dh / 2, t);
        seg(segs[4]!, s(dh * 0.25), dw / 2 - t / 2, dh / 2, t);
      });
      // Aiming point: two 45 m bars 300 m from the threshold.
      rect(white, p, at(300), 6.5, 45, 4, my);
      rect(white, p, at(300), -6.5, 45, 4, my);
      // Threshold lights: green facing in, at the very end.
      for (let o = -hw; o <= hw; o += 5) {
        const c = along(p, at(0.5));
        endLights.push({ x: c.x - c.dz * o, z: c.z + c.dx * o, green: true });
      }
    }
    // Centreline: 30 m dashes, 20 m gaps, between the designators.
    for (let d = 90; d < L - 90; d += 50) rect(white, p, d + 15, 0, 30, 0.9, my);
    // Edge lights every 60 m.
    for (let d = 0; d <= L; d += 60) {
      const c = along(p, d);
      for (const side of [1, -1]) lightPts.push(c.x - c.dz * (hw + 1.5) * side, c.z + c.dx * (hw + 1.5) * side);
    }
  }

  // Apron and taxiways (concrete / asphalt with yellow centrelines).
  for (const f of a.features) {
    const k = f.tags['aeroway'];
    const flatP = f.points.flat();
    if (k === 'apron' && f.closed) addFlatPolygon(concrete, [flatP], SurfaceY.asphalt - 0.01);
    else if (k === 'taxiway') {
      const nrm = miterNormals(flatP);
      addStrip(taxi, flatP, nrm, -TAXIWAY_WIDTH / 2, TAXIWAY_WIDTH / 2, SurfaceY.asphalt);
      addStrip(yellow, flatP, nrm, -0.25, 0.25, SurfaceY.marking);
    }
  }

  // Terminal on its mapped footprint (the named terminal plus the building OSM
  // maps against it): a modest single-storey block, glass band all round,
  // flat roof with a parapet, and a canopy over the landside entrance.
  const pieces = a.features.filter((f) => f.closed && isTerminal(f)).map((f) => {
    const ring = f.points.slice(0, -1);
    // Wind each ring so the wall normal (dz, -dx) of every edge points outward.
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i]!, [x2, z2] = ring[(i + 1) % ring.length]!;
      area += x1 * z2 - x2 * z1;
    }
    if (area < 0) ring.reverse();
    return ring;
  });
  let terminal: { x: number; z: number } | null = null;
  const glassB = new GeometryBuilder();
  const wallB = new GeometryBuilder();
  const roofB = new GeometryBuilder();
  if (pieces.length) {
    const all = pieces.flat();
    const cx = all.reduce((s, q) => s + q[0], 0) / all.length;
    const cz = all.reduce((s, q) => s + q[1], 0) / all.length;
    terminal = { x: cx, z: cz };
    const H = TERMINAL_HEIGHT;
    const wallQuad = (b: GeometryBuilder, x1: number, z1: number, x2: number, z2: number, y0: number, y1: number, out: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
      const ox = nx * out, oz = nz * out;
      const i0 = b.vertex(x1 + ox, y0, z1 + oz, nx, 0, nz);
      const i1 = b.vertex(x2 + ox, y0, z2 + oz, nx, 0, nz);
      const i2 = b.vertex(x2 + ox, y1, z2 + oz, nx, 0, nz);
      const i3 = b.vertex(x1 + ox, y1, z1 + oz, nx, 0, nz);
      b.tri(i0, i2, i1);
      b.tri(i0, i3, i2);
    };
    // A wall two pieces share is inside the building: skip it.
    const onOther = (k: number, x: number, z: number) => pieces.some((r, j) => j !== k && r.some((q) => Math.hypot(q[0] - x, q[1] - z) < 0.5));
    const apron = a.features.find((f) => f.tags['aeroway'] === 'apron');
    const ac = apron ? apron.points.reduce((s, q) => [s[0] + q[0] / apron.points.length, s[1] + q[1] / apron.points.length], [0, 0]) : [cx, cz + 50];
    const entrance: { edge: [number, number, number, number] | null; len: number } = { edge: null, len: 0 };
    wallB.setColor(0xe9e4d6);
    glassB.setColor(0x56788f);
    roofB.setColor(0x8c8a84);
    pieces.forEach((ring, k) => {
      const hull: number[] = [];
      for (let i = 0; i < ring.length; i++) {
        const [x1, z1] = ring[i]!, [x2, z2] = ring[(i + 1) % ring.length]!;
        hull.push(x1, 0, z1, x1, H + 0.6, z1);
        if (onOther(k, x1, z1) && onOther(k, x2, z2)) continue;
        wallQuad(wallB, x1, z1, x2, z2, 0, H + 0.6, 0);
        wallQuad(glassB, x1, z1, x2, z2, 1.2, 3.3, 0.06);
        // Landside entrance: the longest outside wall facing away from the apron.
        const len = Math.hypot(x2 - x1, z2 - z1);
        const away = ((x1 + x2) / 2 - cx) * (ac[0]! - cx) + ((z1 + z2) / 2 - cz) * (ac[1]! - cz) < 0;
        if (away && len > entrance.len) entrance.edge = [x1, z1, x2, z2], entrance.len = len;
      }
      hulls.push(hull);
      addFlatPolygon(roofB, [ring.flat()], H);
    });
    if (entrance.edge) {
      const [x1, z1, x2, z2] = entrance.edge;
      const len = Math.hypot(x2 - x1, z2 - z1);
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
      const mx = (x1 + x2) / 2 + nx * 3, mz = (z1 + z2) / 2 + nz * 3;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      solids.setColor(0xd8d4c8);
      addBeam(solids, mx - ux * len * 0.25, 3.7, mz - uz * len * 0.25, mx + ux * len * 0.25, 3.7, mz + uz * len * 0.25, 6, 0.3);
      solids.setColor(0xbdb8aa);
      for (const t of [-0.24, 0, 0.24]) {
        const px = mx + ux * len * t + nx * 2, pz = mz + uz * len * t + nz * 2;
        addBeam(solids, px, 0, pz, px, 3.6, pz, 0.35, 0.35);
      }
      const sign = nameSign();
      if (sign) {
        sign.position.set((x1 + x2) / 2 + nx * 0.12, H - 0.9, (z1 + z2) / 2 + nz * 0.12);
        sign.rotation.y = Math.atan2(nx, nz);
        group.add(sign);
      }
    }
  }

  // Windsock beside the runway, opposite the terminal side near midfield.
  if (runway && terminal) {
    const L = lengthOf(runway.points);
    const c = along(runway.points, L * 0.45);
    const nx = -c.dz, nz = c.dx;
    const side = (terminal.x - c.x) * nx + (terminal.z - c.z) * nz > 0 ? 1 : -1;
    const wx = c.x + nx * 60 * side, wz = c.z + nz * 60 * side;
    solids.setColor(0xd9d9d9);
    addBeam(solids, wx, 0, wz, wx, 6.5, wz, 0.15, 0.15);
    const sock = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.45, 3.2, 12, 4, true).rotateZ(Math.PI / 2).translate(-1.6, 0, 0);
    geos.push(cone);
    // Orange and white bands (painted with vertex colours by height of the cone).
    const pos = cone.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const band = Math.floor(((-pos.getX(i)) / 3.2) * 5) % 2 === 0;
      col.set(band ? [1, 0.38, 0.05] : [0.95, 0.95, 0.95], i * 3);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sockMesh = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }));
    sockMesh.castShadow = true;
    sock.add(sockMesh);
    sock.position.set(wx, 6.3, wz);
    sock.name = 'windsock';
    group.add(sock);
  }

  // One generic, unbranded twin-turboprop parked on the apron, nose toward the terminal.
  const apronF = a.features.find((f) => f.tags['aeroway'] === 'apron');
  if (apronF && terminal) {
    const pts = apronF.points;
    const acx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const acz = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const plane = buildTurboprop();
    plane.position.set(acx, 0, acz);
    plane.rotation.y = Math.atan2(-(terminal.x - acx), -(terminal.z - acz));
    group.add(plane);
    plane.updateMatrixWorld(true);
    // Fuselage collider (wings are high enough to walk under).
    const fus: number[] = [];
    for (const [x, y, z] of [[-1.4, 0.4, -13], [1.4, 0.4, -13], [-1.4, 3.4, -13], [1.4, 3.4, -13], [-1.4, 0.4, 13], [1.4, 0.4, 13], [-1.4, 3.4, 13], [1.4, 3.4, 13]] as const) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(plane.matrixWorld);
      fus.push(v.x, v.y, v.z);
    }
    hulls.push(fus);
  }

  add(grass, mats.grass);
  add(concrete, mats.concrete);
  add(taxi, mats.taxi);
  add(rw, mats.runway);
  add(white, mats.white);
  add(yellow, mats.yellow);
  add(wallB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), true, true);
  add(glassB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), true, false);
  add(roofB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), true, true);
  add(solids, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true, true);

  // Runway lights: small posts with a lens that glows at night.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x5bd36a, emissive: new THREE.Color(0x36ff60), emissiveIntensity: 0 });
  const lensGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.35, 8).translate(0, 0.35, 0);
  geos.push(lensGeo);
  const mk = (pts: Array<[number, number]>, m: THREE.Material) => {
    if (!pts.length) return;
    const inst = new THREE.InstancedMesh(lensGeo, m, pts.length);
    const mtx = new THREE.Matrix4();
    pts.forEach(([x, z], i) => inst.setMatrixAt(i, mtx.makeTranslation(x, 0, z)));
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    group.add(inst);
  };
  const edge: Array<[number, number]> = [];
  for (let i = 0; i < lightPts.length; i += 2) edge.push([lightPts[i]!, lightPts[i + 1]!]);
  mk(edge, lightMat);
  mk(endLights.map((l) => [l.x, l.z]), greenMat);
  lightMat.userData['green'] = greenMat;

  return {
    group,
    hulls,
    lightMat,
    terminal,
    dispose() {
      for (const g of geos) g.dispose();
      group.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mm of Array.isArray(m) ? m : [m]) { (mm as THREE.MeshStandardMaterial).map?.dispose(); mm.dispose(); }
      });
      group.removeFromParent();
    },
  };
}

/** Night glow for the runway lights (0 by day → 1 at night). */
export function setAirportLights(o: AirportObjects, night: number): void {
  const k = night > 0.25 ? 2.4 : 0;
  o.lightMat.emissiveIntensity = k;
  const g = o.lightMat.userData['green'] as THREE.MeshStandardMaterial | undefined;
  if (g) g.emissiveIntensity = k;
}

/** "Sittwe Airport" name board in English and Myanmar script. */
function nameSign(): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#1d3b5a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 54px "Noto Sans Myanmar", "Myanmar Text", Padauk, sans-serif';
  g.fillText('စစ်တွေလေဆိပ်', c.width / 2, 52);
  g.font = 'bold 50px system-ui, sans-serif';
  g.fillText('SITTWE AIRPORT', c.width / 2, 118);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.name = 'airport-sign';
  return m;
}

/** A generic high-wing twin-turboprop (no airline livery), nose toward -Z, about 27 m long. */
function buildTurboprop(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'parked-turboprop';
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.45, metalness: 0.1 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  // Fuselage, nose and tail cones.
  add(new THREE.CylinderGeometry(1.35, 1.35, 18, 18).rotateX(Math.PI / 2), white, 0, 2.2, 0);
  add(new THREE.SphereGeometry(1.35, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 1.8), white, 0, 2.2, -9);
  add(new THREE.CylinderGeometry(1.35, 0.35, 7, 18, 1, true).rotateX(-Math.PI / 2), white, 0, 2.55, 12.5).position.y = 2.6;
  // Belly stripe and cockpit windows.
  add(new THREE.BoxGeometry(2.74, 0.25, 18), grey, 0, 1.55, 0);
  add(new THREE.BoxGeometry(2.0, 0.45, 0.9), dark, 0, 2.95, -10.3);
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.35, 0.3), dark, s * 1.34, 2.55, -6.5 + i * 1.25);
  // High wing with two engine nacelles and propellers.
  add(new THREE.BoxGeometry(27, 0.35, 2.4), white, 0, 3.75, -1.5);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(1.1, 1.1, 4.2), white, s * 4.1, 3.2, -2.4);
    add(new THREE.CylinderGeometry(0.25, 0.25, 0.4, 10).rotateX(Math.PI / 2), dark, s * 4.1, 3.2, -4.65);
    const prop = add(new THREE.BoxGeometry(0.22, 3.6, 0.08), dark, s * 4.1, 3.2, -4.9);
    prop.rotation.z = s * 0.6;
  }
  // T-tail.
  add(new THREE.BoxGeometry(0.3, 4.2, 3.2), white, 0, 5.3, 13.5).rotation.x = -0.35;
  add(new THREE.BoxGeometry(8, 0.25, 1.8), white, 0, 7.2, 14.6);
  // Landing gear.
  add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12).rotateZ(Math.PI / 2), dark, 0, 0.35, -7.5);
  add(new THREE.BoxGeometry(0.15, 1.2, 0.15), grey, 0, 1.0, -7.5);
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 12).rotateZ(Math.PI / 2), dark, s * 1.6, 0.45, 0.5);
    add(new THREE.BoxGeometry(0.6, 0.8, 1.8), grey, s * 1.55, 1.1, 0.5);
  }
  return g;
}
