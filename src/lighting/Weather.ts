import * as THREE from 'three';

/** Optional rain: GPU-cheap line particles in a box that follows the camera. */
export class Weather {
  readonly rain: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly count = 2600;
  private readonly box = new THREE.Vector3(60, 30, 60);
  /** Current rain amount 0..1 (eases toward the target). */
  amount = 0;
  target = 0;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(this.count * 6);
    this.speeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const x = (Math.random() - 0.5) * this.box.x;
      const y = Math.random() * this.box.y;
      const z = (Math.random() - 0.5) * this.box.z;
      this.positions.set([x, y, z, x + 0.05, y - 0.7, z + 0.02], i * 6);
      this.speeds[i] = 18 + Math.random() * 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.45, depthWrite: false });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.name = 'rain';
    scene.add(this.rain);
  }

  update(dt: number, center: THREE.Vector3): void {
    this.amount += (this.target - this.amount) * Math.min(1, dt * 0.5);
    if (this.amount < 0.01) {
      this.rain.visible = false;
      return;
    }
    this.rain.visible = true;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.45 * this.amount;
    this.rain.position.set(center.x, center.y - this.box.y * 0.4, center.z);
    const p = this.positions;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const dy = this.speeds[i]! * dt;
      p[o + 1]! -= dy;
      p[o + 4]! -= dy;
      if (p[o + 1]! < 0) {
        p[o + 1]! += this.box.y;
        p[o + 4]! += this.box.y;
      }
    }
    (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
