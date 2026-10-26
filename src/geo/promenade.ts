/**
 * Fits a seaside promenade to the real shape of a headland, using only the
 * OSM coastline (sea polygons). From the mapped viewpoint node it finds the
 * inland direction (the longest run over land), then measures the land
 * width at stations along that axis, so the generated promenade follows the
 * actual tip of the peninsula and never extends over the sea.
 */
import { pointInRings, type Pt } from './geometry2d';

export interface Promenade {
  /** Unit vector pointing inland from the tip. */
  axis: [number, number];
  /** Stations from the tip inland: [x, z, leftExtent, rightExtent] (meters, measured perpendicular to the axis). */
  stations: number[];
}

export function fitPromenade(x: number, z: number, seaPolys: Pt[][][], length = 150, maxHalfWidth = 26): Promenade | null {
  const isSea = (px: number, pz: number) => seaPolys.some((p) => pointInRings(px, pz, p));
  if (isSea(x, z)) return null;
  // Inland direction = the ray that stays on land the longest.
  let bestDir: [number, number] = [0, -1];
  let bestRun = -1;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let run = 0;
    while (run < 600 && !isSea(x + dx * (run + 4), z + dz * (run + 4))) run += 4;
    if (run > bestRun) {
      bestRun = run;
      bestDir = [dx, dz];
    }
  }
  const [ux, uz] = bestDir;
  // Walk back toward the sea to find the tip (last land point behind the node).
  let tip = 0;
  while (tip < 200 && !isSea(x - ux * (tip + 3), z - uz * (tip + 3))) tip += 3;
  const sx = x - ux * Math.max(0, tip - 6);
  const sz = z - uz * Math.max(0, tip - 6);
  const stations: number[] = [];
  for (let d = 0; d <= length; d += 6) {
    const cx = sx + ux * d;
    const cz = sz + uz * d;
    const ext = (sign: number) => {
      let e = 0;
      // Perpendicular: (-uz, ux) is "left".
      while (e < maxHalfWidth && !isSea(cx + -uz * sign * (e + 2), cz + ux * sign * (e + 2))) e += 2;
      return Math.max(3, e - 2.5);
    };
    stations.push(Math.round(cx * 100) / 100, Math.round(cz * 100) / 100, ext(1), ext(-1));
  }
  return { axis: [Math.round(ux * 1000) / 1000, Math.round(uz * 1000) / 1000], stations };
}
