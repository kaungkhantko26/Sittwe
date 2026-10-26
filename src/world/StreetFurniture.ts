import * as THREE from 'three';
import { materials } from './materials';
import type { PolygonIndex } from './SpatialIndex';

/**
 * Streetlights. Positions come from OSM highway=street_lamp nodes when mapped;
 * otherwise from generated candidates along major roads (RoadGenerator).
 * Generated lamps are decorative props, not real-world lamp locations.
 */

const POLE_HEIGHT = 6.2;
export const LAMP_LIGHT_HEIGHT = POLE_HEIGHT - 0.3;

let poleGeo: THREE.BufferGeometry | null = null;
let headGeo: THREE.BufferGeometry | null = null;

function geometries(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (!poleGeo || !headGeo) {
    poleGeo = new THREE.CylinderGeometry(0.06, 0.09, POLE_HEIGHT, 6).translate(0, POLE_HEIGHT / 2, 0);
    headGeo = new THREE.BoxGeometry(0.5, 0.14, 0.28).translate(0, POLE_HEIGHT - 0.1, 0);
  }
  return [poleGeo, headGeo];
}

export interface StreetLights {
  pole: THREE.InstancedMesh | null;
  head: THREE.InstancedMesh | null;
  /** Final lamp positions, flat x,z. */
  positions: number[];
}

export function buildStreetLights(candidates: number[], mapped: number[], buildings: PolygonIndex): StreetLights {
  const positions: number[] = [];
  // Mapped lamps first; generated candidates only where no mapped lamp is within 15 m.
  const src = [...mapped];
  for (let i = 0; i < candidates.length; i += 2) {
    let near = false;
    for (let j = 0; j < mapped.length && !near; j += 2) near = Math.hypot(mapped[j]! - candidates[i]!, mapped[j + 1]! - candidates[i + 1]!) < 15;
    if (!near) src.push(candidates[i]!, candidates[i + 1]!);
  }
  for (let i = 0; i < src.length; i += 2) {
    const x = src[i]!;
    const z = src[i + 1]!;
    if (buildings.hit(x, z, 0.6)) continue;
    positions.push(x, z);
  }
  const count = positions.length / 2;
  if (count === 0) return { pole: null, head: null, positions };
  const [pg, hg] = geometries();
  const pole = new THREE.InstancedMesh(pg, materials().metal, count);
  const head = new THREE.InstancedMesh(hg, materials().lampHead, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(positions[i * 2]!, 0, positions[i * 2 + 1]!);
    pole.setMatrixAt(i, m);
    head.setMatrixAt(i, m);
  }
  pole.castShadow = true;
  pole.computeBoundingSphere();
  head.computeBoundingSphere();
  return { pole, head, positions };
}
