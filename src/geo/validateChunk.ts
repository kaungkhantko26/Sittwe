import type { ChunkData } from './chunkFormat';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const finite = (arr: unknown): arr is number[] => Array.isArray(arr) && arr.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * Structural validation of a chunk. Used by the pipeline (validate-map) and by
 * the game loader, which drops invalid features instead of crashing.
 */
export function validateChunk(data: unknown, chunkSize: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!data || typeof data !== 'object') return { errors: ['chunk is not an object'], warnings };
  const c = data as Partial<ChunkData>;
  if (typeof c.cx !== 'number' || typeof c.cz !== 'number') errors.push('missing chunk coordinates');
  for (const key of ['roads', 'buildings', 'water', 'waterways', 'landuse', 'landmarks'] as const) {
    if (!Array.isArray(c[key])) errors.push(`missing array "${key}"`);
  }
  if (errors.length) return { errors, warnings };
  const d = c as ChunkData;
  const minX = d.cx * chunkSize - 0.05;
  const maxX = (d.cx + 1) * chunkSize + 0.05;
  const minZ = d.cz * chunkSize - 0.05;
  const maxZ = (d.cz + 1) * chunkSize + 0.05;
  const inChunk = (p: number[]) => {
    for (let i = 0; i < p.length; i += 2) if (p[i]! < minX || p[i]! > maxX || p[i + 1]! < minZ || p[i + 1]! > maxZ) return false;
    return true;
  };

  d.roads.forEach((r, i) => {
    if (!finite(r.p) || r.p.length < 4 || r.p.length % 2) errors.push(`road #${i} (${r.id}) has invalid coordinates`);
    else if (!inChunk(r.p)) errors.push(`road #${i} (${r.id}) extends outside its chunk`);
    if (!(r.w > 0 && r.w < 60)) errors.push(`road #${i} (${r.id}) has invalid width ${r.w}`);
  });
  d.buildings.forEach((b, i) => {
    if (!finite(b.p) || b.p.length < 6 || b.p.length % 2) errors.push(`building #${i} (${b.id}) has invalid footprint`);
    if (!(b.h > 0 && b.h < 400)) errors.push(`building #${i} (${b.id}) has invalid height ${b.h}`);
    if (b.mh >= b.h) warnings.push(`building ${b.id} min_height >= height`);
  });
  for (const key of ['water', 'landuse'] as const) {
    d[key].forEach((a, i) => {
      if (!Array.isArray(a.r) || a.r.length === 0 || !a.r.every((ring) => finite(ring) && ring.length >= 6)) errors.push(`${key} #${i} (${a.id}) has invalid rings`);
      else if (!inChunk(a.r[0]!)) errors.push(`${key} #${i} (${a.id}) extends outside its chunk`);
    });
  }
  if (d.trees && !finite(d.trees)) errors.push('invalid tree coordinates');
  return { errors, warnings };
}
