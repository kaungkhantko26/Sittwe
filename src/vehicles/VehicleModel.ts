import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly four-door car built from primitives (no external asset). Faces -Z.
 * Dimensions roughly match a small sedan: 1.8 m wide, 4.3 m long, 1.45 m tall.
 */
export interface VehicleVisual {
  root: THREE.Group;
  /** Wheel pivots: FL, FR, RL, RR. Each contains a spinning child. */
  wheels: Array<{ pivot: THREE.Group; spin: THREE.Group }>;
  brakeMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
}

const WHEEL_RADIUS = 0.34;
/** Distance from the physics body origin down to the ground when at rest. */
export const MODEL_GROUND_OFFSET = 0.54;
export const WHEEL_POSITIONS: Array<[number, number, number]> = [
  [-0.78, 0, -1.33],
  [0.78, 0, -1.33],
  [-0.78, 0, 1.3],
  [0.78, 0, 1.3],
];

export const BODY_COLORS = [0xd8d3c8, 0xb52b2b, 0x2a5aa8, 0x2f2f33, 0xe7b23a, 0x3e7d5b];

/** Merges the body parts into one mesh per material (≈6 draw calls instead of ≈17). */
function mergeShell(shell: THREE.Group): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  shell.updateMatrixWorld(true);
  for (const child of [...shell.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const list = byMat.get(mesh.material as THREE.Material) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    byMat.set(mesh.material as THREE.Material, list);
    shell.remove(mesh);
    mesh.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    shell.add(m);
  }
}

export function createVehicleModel(color: number): VehicleVisual {
  const root = new THREE.Group();
  root.name = 'vehicle';
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2a38, roughness: 0.1, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf6f3e8, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: new THREE.Color(0xff2020), emissiveIntensity: 0.15 });

  // The root follows the physics body; the shell is shifted so that the
  // model's ground level (y = 0) sits at the wheels' contact height.
  const shell = new THREE.Group();
  shell.position.y = -MODEL_GROUND_OFFSET;
  root.add(shell);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    shell.add(mesh);
    return mesh;
  };

  // Lower body.
  add(new THREE.BoxGeometry(1.78, 0.5, 4.3), paint, 0, 0.55, 0);
  // Bonnet slope + boot.
  const hood = add(new THREE.BoxGeometry(1.7, 0.16, 1.2), paint, 0, 0.84, -1.45);
  hood.rotation.x = 0.08;
  add(new THREE.BoxGeometry(1.7, 0.14, 0.8), paint, 0, 0.84, 1.68);
  // Cabin (tapered).
  const cabinGeo = new THREE.BoxGeometry(1.6, 0.56, 2.2, 1, 1, 1);
  const pos = cabinGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.88);
      pos.setZ(i, pos.getZ(i) * 0.78);
    }
  }
  cabinGeo.computeVertexNormals();
  add(cabinGeo, glass, 0, 1.08, 0.12);
  add(new THREE.BoxGeometry(1.36, 0.06, 1.66), paint, 0, 1.38, 0.12); // roof
  // Bumpers and grille.
  add(new THREE.BoxGeometry(1.82, 0.18, 0.16), dark, 0, 0.36, -2.18);
  add(new THREE.BoxGeometry(1.82, 0.18, 0.16), dark, 0, 0.36, 2.18);
  add(new THREE.BoxGeometry(0.8, 0.14, 0.04), chrome, 0, 0.62, -2.16);
  // Lights.
  for (const sx of [-0.62, 0.62]) {
    add(new THREE.BoxGeometry(0.34, 0.12, 0.05), headMat, sx, 0.66, -2.16);
    add(new THREE.BoxGeometry(0.36, 0.12, 0.05), brakeMat, sx, 0.66, 2.16);
  }
  // Mirrors.
  for (const sx of [-0.95, 0.95]) add(new THREE.BoxGeometry(0.12, 0.1, 0.18), paint, sx, 0.98, -0.55);

  mergeShell(shell);

  // Wheels.
  const tire = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xa3a8ad, roughness: 0.4, metalness: 0.7 });
  const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 14).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.58, WHEEL_RADIUS * 0.58, 0.25, 8).rotateZ(Math.PI / 2);
  const wheels: VehicleVisual['wheels'] = [];
  for (const [x, y, z] of WHEEL_POSITIONS) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tireGeo, tire);
    t.castShadow = true;
    const r = new THREE.Mesh(rimGeo, rim);
    spin.add(t, r);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin });
  }

  return { root, wheels, brakeMat, headMat };
}

export { WHEEL_RADIUS };
