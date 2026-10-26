import * as THREE from 'three';
import type { ChunkArea } from '../geo/chunkFormat';
import { addFlatPolygon, GeometryBuilder } from './GeometryBuilder';
import { LANDUSE_COLORS, LANDUSE_PRIORITY, materials, SurfaceY } from './materials';

/**
 * Ground and land-use surfaces.
 *
 * Terrain is flat at sea level: Sittwe is low-lying coastal land and this MVP
 * uses no elevation model. The base ground is one large plane; real OSM
 * land-use/natural/leisure polygons are drawn on top of it per chunk.
 */
export function createGroundPlane(size: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, materials().ground);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export function buildLanduse(areas: ChunkArea[]): THREE.BufferGeometry | null {
  const b = new GeometryBuilder();
  // Draw low-priority kinds first; higher-priority ones sit a few mm higher.
  const sorted = [...areas].sort((a, c) => (LANDUSE_PRIORITY[a.k] ?? 0) - (LANDUSE_PRIORITY[c.k] ?? 0));
  for (const a of sorted) {
    const color = LANDUSE_COLORS[a.k];
    if (color === undefined) continue;
    b.setColor(color);
    const y = a.k === 'pier' ? SurfaceY.pier : SurfaceY.landuse + (LANDUSE_PRIORITY[a.k] ?? 0) * 0.004;
    addFlatPolygon(b, a.r, y);
  }
  return b.isEmpty() ? null : b.build();
}
