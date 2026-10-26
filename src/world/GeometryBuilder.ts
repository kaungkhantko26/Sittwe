import * as THREE from 'three';

/**
 * Accumulates indexed triangles with per-vertex normal, color and uv, then
 * produces one BufferGeometry. Generators use this to merge every feature of
 * a chunk into a single draw call per material.
 */
export class GeometryBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  setColor(hex: number): this {
    const c = tmpColor.setHex(hex, THREE.SRGBColorSpace);
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    return this;
  }

  /** Adds a vertex and returns its index. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(this.r, this.g, this.b);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /** Adds a horizontal triangle, flipping winding so it faces +Y. */
  upTri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, y: number): void {
    // Facing +Y requires (b - a) × (c - a) to have positive y: (bz-az)(cx-ax) - (bx-ax)(cz-az) > 0
    const cross = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const i0 = this.vertex(ax, y, az, 0, 1, 0, ax, az);
    const i1 = this.vertex(bx, y, bz, 0, 1, 0, bx, bz);
    const i2 = this.vertex(cx, y, cz, 0, 1, 0, cx, cz);
    if (cross >= 0) this.tri(i0, i1, i2);
    else this.tri(i0, i2, i1);
  }

  isEmpty(): boolean {
    return this.indices.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    const count = this.positions.length / 3;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const tmpColor = new THREE.Color();

/**
 * Triangulates a polygon given as flat x,z rings (first = outer) and appends
 * it to the builder as an upward-facing surface at height y.
 */
export function addFlatPolygon(b: GeometryBuilder, rings: number[][], y: number): void {
  const outer = rings[0];
  if (!outer || outer.length < 6) return;
  const contour = toV2(outer);
  const holes = rings.slice(1).filter((h) => h.length >= 6).map(toV2);
  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  } catch {
    return;
  }
  const all = contour.concat(...holes);
  for (const f of faces) {
    const a = all[f[0]!];
    const c1 = all[f[1]!];
    const c2 = all[f[2]!];
    if (!a || !c1 || !c2) continue;
    b.upTri(a.x, a.y, c1.x, c1.y, c2.x, c2.y, y);
  }
}

export function toV2(flat: number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i]!, flat[i + 1]!));
  // Drop duplicated closing point.
  if (out.length > 1 && out[0]!.equals(out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * Adds a rectangular beam (box) from point A to point B with cross-section
 * width × height, using the current color. Used for bridge arches, kerbs, rails.
 */
export function addBeam(b: GeometryBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, height: number): void {
  const d = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = d.length();
  if (len < 1e-4) return;
  d.divideScalar(len);
  // Side vector: horizontal, perpendicular to the beam.
  const side = new THREE.Vector3(-d.z, 0, d.x);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, d).normalize();
  if (up.y < 0) up.negate();
  const hw = width / 2;
  const hh = height / 2;
  const corner = (px: number, py: number, pz: number, s: number, u: number) =>
    new THREE.Vector3(px + side.x * s * hw + up.x * u * hh, py + side.y * s * hw + up.y * u * hh, pz + side.z * s * hw + up.z * u * hh);
  const A = [corner(ax, ay, az, -1, -1), corner(ax, ay, az, 1, -1), corner(ax, ay, az, 1, 1), corner(ax, ay, az, -1, 1)];
  const B = [corner(bx, by, bz, -1, -1), corner(bx, by, bz, 1, -1), corner(bx, by, bz, 1, 1), corner(bx, by, bz, -1, 1)];
  const face = (p: THREE.Vector3[], n: THREE.Vector3) => {
    const i = p.map((v) => b.vertex(v.x, v.y, v.z, n.x, n.y, n.z));
    // Wind so the face points along n.
    const e1 = p[1]!.clone().sub(p[0]!);
    const e2 = p[2]!.clone().sub(p[0]!);
    if (e1.cross(e2).dot(n) >= 0) b.quad(i[0]!, i[1]!, i[2]!, i[3]!);
    else b.quad(i[0]!, i[3]!, i[2]!, i[1]!);
  };
  const nSide = side.clone();
  const nUp = up.clone();
  face([A[1]!, B[1]!, B[2]!, A[2]!], nSide);
  face([A[0]!, A[3]!, B[3]!, B[0]!], nSide.clone().negate());
  face([A[3]!, A[2]!, B[2]!, B[3]!], nUp);
  face([A[0]!, B[0]!, B[1]!, A[1]!], nUp.clone().negate());
  face([A[0]!, A[1]!, A[2]!, A[3]!], d.clone().negate());
  face([B[0]!, B[3]!, B[2]!, B[1]!], d.clone());
}
