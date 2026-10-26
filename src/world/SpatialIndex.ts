import { distToSegmentSq, pointInRing, ringBounds, type Pt, type Rect } from '../geo/geometry2d';

/** Uniform-grid index over polygons, for fast point-in-footprint tests. */
export class PolygonIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly bounds: Rect[];

  constructor(
    readonly polys: Pt[][],
    private readonly cell = 16,
  ) {
    this.bounds = polys.map(ringBounds);
    this.bounds.forEach((b, i) => {
      for (let x = Math.floor(b.minX / cell); x <= Math.floor(b.maxX / cell); x++) {
        for (let z = Math.floor(b.minY / cell); z <= Math.floor(b.maxY / cell); z++) {
          const k = `${x},${z}`;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(i);
        }
      }
    });
  }

  /** True if (x, z) is inside any polygon, or within `margin` meters of one. */
  hit(x: number, z: number, margin = 0): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const r = margin > 0 ? Math.ceil(margin / this.cell) : 0;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const arr = this.cells.get(`${ix},${iz}`);
        if (!arr) continue;
        for (const i of arr) {
          const b = this.bounds[i]!;
          if (x < b.minX - margin || x > b.maxX + margin || z < b.minY - margin || z > b.maxY + margin) continue;
          const poly = this.polys[i]!;
          if (pointInRing(x, z, poly)) return true;
          if (margin > 0) {
            for (let a = 0, c = poly.length - 1; a < poly.length; c = a++) {
              if (distToSegmentSq(x, z, poly[c]![0], poly[c]![1], poly[a]![0], poly[a]![1]) < margin * margin) return true;
            }
          }
        }
      }
    }
    return false;
  }
}

/** Uniform-grid index over polyline segments with per-line half-widths (roads). */
export class SegmentIndex {
  private readonly cells = new Map<string, number[]>();
  /** Flat [ax, az, bx, bz, halfWidth] per segment. */
  private readonly segs: number[] = [];
  readonly names: Array<string | undefined> = [];

  constructor(private readonly cell = 16) {}

  addLine(p: number[], halfWidth: number, name?: string): void {
    for (let i = 0; i < p.length - 2; i += 2) {
      const idx = this.segs.length / 5;
      const ax = p[i]!;
      const az = p[i + 1]!;
      const bx = p[i + 2]!;
      const bz = p[i + 3]!;
      this.segs.push(ax, az, bx, bz, halfWidth);
      this.names.push(name);
      const pad = halfWidth;
      for (let x = Math.floor((Math.min(ax, bx) - pad) / this.cell); x <= Math.floor((Math.max(ax, bx) + pad) / this.cell); x++) {
        for (let z = Math.floor((Math.min(az, bz) - pad) / this.cell); z <= Math.floor((Math.max(az, bz) + pad) / this.cell); z++) {
          const k = `${x},${z}`;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(idx);
        }
      }
    }
  }

  /** True if (x, z) lies on any line (within its half-width + margin). */
  hit(x: number, z: number, margin = 0): boolean {
    return this.nearest(x, z, margin, true) !== null;
  }

  /** Nearest segment within its half-width + margin; returns index & distance. */
  nearest(x: number, z: number, margin: number, firstOnly = false): { index: number; dist: number } | null {
    const r = Math.ceil(margin / this.cell) + 1;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best: { index: number; dist: number } | null = null;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const arr = this.cells.get(`${ix},${iz}`);
        if (!arr) continue;
        for (const i of arr) {
          const s = i * 5;
          const d = Math.sqrt(distToSegmentSq(x, z, this.segs[s]!, this.segs[s + 1]!, this.segs[s + 2]!, this.segs[s + 3]!));
          if (d <= this.segs[s + 4]! + margin && (!best || d < best.dist)) {
            best = { index: i, dist: d };
            if (firstOnly) return best;
          }
        }
      }
    }
    return best;
  }
}
