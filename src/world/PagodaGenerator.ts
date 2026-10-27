import * as THREE from 'three';
import type { ChunkLandmark } from '../geo/chunkFormat';
import {distToSegmentSq,type Pt} from '../geo/geometry2d';
import { orientedRect } from './BuildingGenerator';
import { addBeam, addFlatPolygon, GeometryBuilder } from './GeometryBuilder';
import { materials } from './materials';

/**
 * Pagoda complex on a real mapped footprint (e.g. Lawkanandar Pagoda,
 * Sittwe). The footprint polygon is the mapped platform; on it we build a
 * blue/white checkered courtyard, a large gold stupa on white terraces, a
 * ring of small stupas, corner pavilions with tiered roofs, golden entrance
 * gates with red-carpeted stairs on four sides, a white railing and lamps —
 * modelled on photos of Lawkanandar. Size and position follow the real
 * footprint; the architecture is an artistic representation.
 */

const PLATFORM_Y = 1.2;

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#f4f6f8' : '#4f86c6';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 3, 1 / 3); // a 4×4 tile block every 3 m
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Bell-shaped stupa profile (height 1), Burmese style. */
function stupaGeometry(segments = 20): THREE.BufferGeometry {
  const pts = [
    [0.0, 0], [0.5, 0], [0.5, 0.06], [0.44, 0.06], [0.44, 0.12], [0.38, 0.12], [0.38, 0.18],
    [0.36, 0.26], [0.33, 0.36], [0.27, 0.45], [0.2, 0.52], [0.16, 0.55], [0.16, 0.59],
    [0.13, 0.62], [0.13, 0.65], [0.1, 0.7], [0.075, 0.78], [0.05, 0.86], [0.03, 0.93], [0.012, 0.98], [0, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, segments);
}

export interface PagodaObjects {
  group: THREE.Group;
  /** Collider cylinders: x, z, radius. */
  colliders: number[];
  /** Collider boxes: x, y, z, hx, hy, hz, yaw. */
  boxes: number[];
  /** Walkable ramps under the stairs (convex hulls, flat x,y,z lists). */
  ramps: number[][];
}

export function buildPagoda(lm: ChunkLandmark): PagodaObjects | null {
  const flat = lm.pg;
  if (!flat || flat.length < 6) return null;
  const ring: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i]!, flat[i + 1]!]);
  const rect = orientedRect(ring, 1);
  const [A, B, , D] = rect as [Pt, Pt, Pt, Pt];
  const lenU = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const lenV = Math.hypot(D[0] - A[0], D[1] - A[1]);
  const ux = (B[0] - A[0]) / lenU;
  const uz = (B[1] - A[1]) / lenU;
  const vx = (D[0] - A[0]) / lenV;
  const vz = (D[1] - A[1]) / lenV;
  const cx = (rect[0]![0] + rect[2]![0]) / 2;
  const cz = (rect[0]![1] + rect[2]![1]) / 2;
  const minSide = Math.min(lenU, lenV);
  const at = (u: number, v: number): [number, number] => [cx + ux * u + vx * v, cz + uz * u + vz * v];
  const yawU = Math.atan2(-ux, -uz);

  const group = new THREE.Group();
  group.name = `pagoda_${lm.id}`;
  group.userData['artistic'] = true;
  const colliders: number[] = [];
  const boxes: number[] = [];
  const ramps: number[][] = [];
  const gold = materials().gold;
  const solid = new GeometryBuilder();

  // 1) Tiled courtyard on the real footprint (top of the platform).
  const court = new GeometryBuilder();
  addFlatPolygon(court, [flat], PLATFORM_Y + 0.02);
  const courtMat = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.35, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  courtMat.userData['own'] = true;
  const courtMesh = new THREE.Mesh(court.build(), courtMat);
  courtMesh.receiveShadow = true;
  group.add(courtMesh);

  const stairW = Math.min(6, minSide * 0.12 + 2);
  const sides: Array<{ u: number; v: number; nu: number; nv: number; yaw: number }> = [
    { u: 0, v: -lenV / 2, nu: 0, nv: -1, yaw: yawU },
    { u: 0, v: lenV / 2, nu: 0, nv: 1, yaw: yawU },
    { u: -lenU / 2, v: 0, nu: -1, nv: 0, yaw: yawU + Math.PI / 2 },
    { u: lenU / 2, v: 0, nu: 1, nv: 0, yaw: yawU + Math.PI / 2 },
  ];
  // Intersect each approach with the actual footprint, including concave courtyards.
  for (const side of sides) {
    const dx=ux*side.nu+vx*side.nv,dz=uz*side.nu+vz*side.nv;
    let distance=Infinity;
    for(let i=0;i<ring.length;i++){
      const a=ring[i]!,b=ring[(i+1)%ring.length]!,ex=b[0]-a[0],ez=b[1]-a[1];
      const cross=dx*ez-dz*ex;if(Math.abs(cross)<1e-8)continue;
      const ax=a[0]-cx,az=a[1]-cz,t=(ax*ez-az*ex)/cross,u=(ax*dz-az*dx)/cross;
      if(t>=0&&u>=0&&u<=1)distance=Math.min(distance,t);
    }
    if(Number.isFinite(distance)){side.u=side.nu*distance;side.v=side.nv*distance;}
  }
  const entrances=sides.map(side=>at(side.u,side.v));
  // Fence panels leave an entrance in the middle of each edge, aligned with the stairs.
  for (let i=0;i<ring.length;i++) {
    const a=ring[i]!,b=ring[(i+1)%ring.length]!;
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const gaps=entrances.filter(([x,z])=>distToSegmentSq(x,z,a[0],a[1],b[0],b[1])<.1)
      .map(([x,z])=>{const t=((x-a[0])*(b[0]-a[0])+(z-a[1])*(b[1]-a[1]))/(len*len),half=(stairW/2+.5)/len;return [Math.max(0,t-half),Math.min(1,t+half)] as const;}).sort((a,b)=>a[0]-b[0]);
    const panels:number[][]=[];let cursor=0;
    for(const [lo,hi] of gaps){if(lo>cursor)panels.push([cursor,lo]);cursor=Math.max(cursor,hi);}
    if(cursor<1)panels.push([cursor,1]);
    for(const [lo,hi] of panels) {
      const ax=a[0]+(b[0]-a[0])*lo!,az=a[1]+(b[1]-a[1])*lo!;
      const bx=a[0]+(b[0]-a[0])*hi!,bz=a[1]+(b[1]-a[1])*hi!;
      solid.setColor(0xd9a93c);addBeam(solid,ax,PLATFORM_Y-.08,az,bx,PLATFORM_Y-.08,bz,.12,.14);
      solid.setColor(0xf7f6f1);
      for(const y of [.5,.95])addBeam(solid,ax,PLATFORM_Y+y,az,bx,PLATFORM_Y+y,bz,.12,.12);
      const n=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/2.5));
      for(let k=0;k<=n;k++){const x=ax+(bx-ax)*k/n,z=az+(bz-az)*k/n;addBeam(solid,x,PLATFORM_Y,z,x,PLATFORM_Y+1,z,.2,.2)}
      boxes.push((ax+bx)/2,PLATFORM_Y+.5,(az+bz)/2,Math.hypot(bx-ax,bz-az)/2,.5,.08,-Math.atan2(bz-az,bx-ax));
    }
  }

  // 3) Stairs + golden gates on all four sides (centre of each rect edge).
  for (const s of sides) {
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      const out = 0.45 * (steps - k) - 0.2; // outward distance of this step's centre
      const top = (PLATFORM_Y * (k + 1)) / steps;
      const [x, z] = at(s.u + s.nu * out, s.v + s.nv * out);
      const along: [number, number] = s.nu !== 0 ? [vx, vz] : [ux, uz];
      solid.setColor(k % 2 ? 0xb5262c : 0xc8323a);
      addBeam(solid, x - along[0] * stairW / 2, top / 2, z - along[1] * stairW / 2, x + along[0] * stairW / 2, top / 2, z + along[1] * stairW / 2, 0.45, top);
      // Box local Z runs along the platform's u axis (yawU), local X along v.
    }
    // Invisible ramp under the stairs (about 34°): the character controller climbs
    // slopes reliably, whereas auto-stepping onto box edges is unreliable.
    {
      const along: [number, number] = s.nu !== 0 ? [vx, vz] : [ux, uz];
      const [ox, oz] = at(s.u + s.nu * 1.8, s.v + s.nv * 1.8); // bottom edge, on the ground
      const [ix, iz] = at(s.u - s.nu * 0.3, s.v - s.nv * 0.3); // top edge, just inside the platform
      const hw = stairW / 2;
      const pts: number[] = [];
      for (const side of [-1, 1]) {
        const ax2 = along[0] * hw * side;
        const az2 = along[1] * hw * side;
        pts.push(ox + ax2, 0.08, oz + az2, ix + ax2, PLATFORM_Y, iz + az2, ix + ax2, 0.08, iz + az2);
      }
      ramps.push(pts);
    }
    // Gate: two gold pillars and an ornate tiered crest over the stair top.
    const along: [number, number] = s.nu !== 0 ? [vx, vz] : [ux, uz];
    const [gx, gz] = at(s.u - s.nu * 1.2, s.v - s.nv * 1.2);
    for (const side of [-1, 1]) {
      const px = gx + along[0] * side * (stairW / 2 + 0.3);
      const pz = gz + along[1] * side * (stairW / 2 + 0.3);
      solid.setColor(0xd9a93c);
      addBeam(solid, px, PLATFORM_Y, pz, px, PLATFORM_Y + 4.2, pz, 0.6, 0.6);
      colliders.push(px, pz, 0.4);
    }
    solid.setColor(0xd9a93c);
    const w = stairW + 1.2;
    addBeam(solid, gx - along[0] * w / 2, PLATFORM_Y + 4.5, gz - along[1] * w / 2, gx + along[0] * w / 2, PLATFORM_Y + 4.5, gz + along[1] * w / 2, 0.6, 0.6);
    for (let t = 0; t < 3; t++) {
      const ww = w * (0.8 - t * 0.22);
      addBeam(solid, gx - along[0] * ww / 2, PLATFORM_Y + 5.1 + t * 0.6, gz - along[1] * ww / 2, gx + along[0] * ww / 2, PLATFORM_Y + 5.1 + t * 0.6, gz + along[1] * ww / 2, 0.4, 0.5);
    }
    // Twin-globe lamps beside the stairs on the ground.
    for (const side of [-1, 1]) {
      const [lx, lz] = at(s.u + s.nu * 2.6 + (s.nu === 0 ? side * (stairW / 2 + 1.5) : 0), s.v + s.nv * 2.6 + (s.nv === 0 ? side * (stairW / 2 + 1.5) : 0));
      solid.setColor(0xf2f0ea);
      addBeam(solid, lx, 0, lz, lx, 3.6, lz, 0.14, 0.14);
      for (const o of [-0.3, 0.3]) {
        const globe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), materials().lampHead);
        globe.position.set(lx + along[0] * o, 3.8, lz + along[1] * o);
        group.add(globe);
      }
    }
  }

  // 4) Main stupa on three white terraces, centred on the mapped node when it is inside.
  const centre = Math.hypot(lm.x - cx, lm.z - cz) < minSide * 0.25 ? [lm.x, lm.z] : [cx, cz];
  const baseR = Math.max(4, minSide * 0.2);
  const H = Math.min(38, Math.max(14, minSide * 0.5));
  const yawRect = Math.atan2(-ux, -uz);
  for (let t = 0; t < 3; t++) {
    const s = baseR * (2.3 - t * 0.35);
    const y = PLATFORM_Y + t * 0.9;
    solid.setColor(t % 2 ? 0xd9a93c : 0xf6f4ee);
    // Square terrace aligned with the platform.
    addBeam(solid, centre[0]! - ux * s / 2, y + 0.45, centre[1]! - uz * s / 2, centre[0]! + ux * s / 2, y + 0.45, centre[1]! + uz * s / 2, s, 0.9);
  }
  boxes.push(centre[0]!, PLATFORM_Y + 1.35, centre[1]!, baseR * 1.15, 1.35, baseR * 1.15, yawRect);
  const stupa = new THREE.Mesh(stupaGeometry(28), gold);
  stupa.scale.set(baseR * 2, H, baseR * 2);
  stupa.position.set(centre[0]!, PLATFORM_Y + 2.7, centre[1]!);
  stupa.castShadow = true;
  stupa.receiveShadow = true;
  group.add(stupa);
  // Umbrella (hti) rings near the top.
  for (let k = 0; k < 4; k++) {
    const ring3 = new THREE.Mesh(new THREE.CylinderGeometry(0.5 - k * 0.1, 0.55 - k * 0.1, 0.25, 12), gold);
    ring3.position.set(centre[0]!, PLATFORM_Y + 2.7 + H * (0.86 + k * 0.03), centre[1]!);
    group.add(ring3);
  }
  colliders.push(centre[0]!, centre[1]!, baseR * 1.1);

  // 5) Ring of small stupas.
  const smallGeo = stupaGeometry(14);
  const ringR = Math.min(minSide * 0.36, baseR * 2.2);
  const count = 8;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + Math.PI / 8;
    const [sx, sz] = [centre[0]! + Math.cos(a) * ringR, centre[1]! + Math.sin(a) * ringR];
    solid.setColor(0xf6f4ee);
    addBeam(solid, sx, PLATFORM_Y, sz, sx, PLATFORM_Y + 1.2, sz, 2.2, 2.2);
    const m = new THREE.Mesh(smallGeo, gold);
    m.scale.set(1.9, 5.5, 1.9);
    m.position.set(sx, PLATFORM_Y + 1.2, sz);
    m.castShadow = true;
    group.add(m);
    colliders.push(sx, sz, 1.2);
  }

  // 6) Corner pavilions with tiered red-and-gold roofs.
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const [px, pz] = at(su * (lenU / 2 - 4), sv * (lenV / 2 - 4));
    solid.setColor(0xf6f4ee);
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const [qx, qz] = [px + (ux * ox + vx * oz) * 1.3, pz + (uz * ox + vz * oz) * 1.3];
      addBeam(solid, qx, PLATFORM_Y, qz, qx, PLATFORM_Y + 3, qz, 0.28, 0.28);
    }
    for (let t = 0; t < 3; t++) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4 - t * 0.6, 0.9, 4).rotateY(Math.PI / 4 + yawRect), t % 2 ? gold : new THREE.MeshStandardMaterial({ color: 0x9a2a24, roughness: 0.7 }));
      if (!(t % 2)) (roof.material as THREE.Material).userData['own'] = true;
      roof.position.set(px, PLATFORM_Y + 3.4 + t * 0.7, pz);
      roof.castShadow = true;
      group.add(roof);
    }
    colliders.push(px, pz, 1.6);
  }

  const solidMesh = new THREE.Mesh(solid.build(), materials().solid);
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  group.add(solidMesh);
  return { group, colliders, boxes, ramps };
}
