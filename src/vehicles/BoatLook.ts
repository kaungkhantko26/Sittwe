import * as THREE from 'three';
import { MODEL_GROUND_OFFSET, type VehicleVisual } from './VehicleModel';

/**
 * Visual side of the amphibious car: a white V hull slides out under the body,
 * the wheels fold up flat, a water jet sprays at the stern, and a foam wake
 * trails behind (stronger with speed). Used for your own car and for other
 * players' cars in a room. Parts are built on first use.
 */

let wakeTexture: THREE.CanvasTexture | null = null;
let foamTexture: THREE.CanvasTexture | null = null;

function canvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** V-shaped foam trail: bright at the stern (top of the texture), fading and widening behind. */
function makeWakeTexture(): THREE.CanvasTexture {
  return canvasTexture((g, w, h) => {
    for (let y = 0; y < h; y++) {
      const t = y / h; // 0 at the stern
      const spread = 0.12 + t * 0.36;
      const fade = (1 - t) ** 1.6;
      for (const side of [-1, 1]) {
        const cx = w / 2 + side * spread * w;
        const grad = g.createLinearGradient(cx - 10, 0, cx + 10, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, `rgba(255,255,255,${0.85 * fade})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(cx - 10, y, 20, 1);
      }
      // Turbulent centre line from the jet.
      const cw = 14 + t * 30;
      const grad = g.createLinearGradient(w / 2 - cw, 0, w / 2 + cw, 0);
      grad.addColorStop(0, 'rgba(235,248,255,0)');
      grad.addColorStop(0.5, `rgba(235,248,255,${0.7 * (1 - t) ** 2.4})`);
      grad.addColorStop(1, 'rgba(235,248,255,0)');
      g.fillStyle = grad;
      g.fillRect(w / 2 - cw, y, cw * 2, 1);
    }
  }, 128, 256);
}

/** Soft foam ring where the hull meets the water. */
function makeFoamTexture(): THREE.CanvasTexture {
  return canvasTexture((g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 64, 64);
}

/** Hull from cross-sections: deck edge, chine and keel, closing to a point at the bow. */
function hullGeometry(): THREE.BufferGeometry {
  const zs = [-2.6, -2.35, -2.0, -1.5, -0.5, 0.6, 1.6, 2.25];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const z of zs) {
    const bow = Math.max(0, Math.min(1, (z + 2.6) / 1.1)); // 0 at the bow tip → 1 behind it
    const w = 0.08 + 0.92 * Math.sqrt(bow);
    const keel = -0.22 + (1 - bow) * 0.38; // the bow rises out of the water
    const chineY = 0.04 + (1 - bow) * 0.18;
    // deck L, chine L, keel, chine R, deck R
    for (const [x, y] of [[-w, 0.36], [-w * 0.86, chineY], [0, keel], [w * 0.86, chineY], [w, 0.36]] as const) pos.push(x, y, z);
  }
  const n = 5;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
      idx.push(a, d, c, a, c, b);
    }
  }
  // Transom (flat stern).
  const s = (zs.length - 1) * n;
  idx.push(s, s + 1, s + 2, s, s + 2, s + 4, s + 2, s + 3, s + 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Parts {
  hull: THREE.Group;
  wake: THREE.Mesh;
  foam: THREE.Mesh;
  jet: THREE.Mesh;
  wakeMat: THREE.MeshBasicMaterial;
  foamMat: THREE.MeshBasicMaterial;
  jetMat: THREE.MeshBasicMaterial;
}

export class BoatLook {
  /** 0 = car, 1 = boat (animated). */
  blend = 0;
  private parts: Parts | null = null;
  private readonly wheelBase: THREE.Vector3[];
  private time = 0;

  constructor(private readonly visual: VehicleVisual, private readonly stripeColor: number) {
    this.wheelBase = visual.wheels.map((w) => w.pivot.position.clone());
  }

  private build(): Parts {
    const root = this.visual.root;
    const hull = new THREE.Group();
    hull.name = 'boat-hull';
    hull.position.y = -MODEL_GROUND_OFFSET;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f7, roughness: 0.45, side: THREE.DoubleSide });
    const stripe = new THREE.MeshStandardMaterial({ color: this.stripeColor, roughness: 0.4, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22272c, roughness: 0.6 });
    const shell = new THREE.Mesh(hullGeometry(), white);
    shell.castShadow = true;
    hull.add(shell);
    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 3.9), stripe);
      band.position.set(sx * 0.99, 0.27, 0.15);
      hull.add(band);
      // Rubber fender along the gunwale.
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 4.2), dark);
      fender.position.set(sx * 1.0, 0.35, 0.05);
      hull.add(fender);
    }
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.3, 12), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0.0, 2.33);
    hull.add(nozzle);
    hull.scale.set(1, 0.001, 1);
    hull.visible = false;
    root.add(hull);

    wakeTexture ??= makeWakeTexture();
    foamTexture ??= makeFoamTexture();
    const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 16), wakeMat);
    wake.rotation.x = -Math.PI / 2;
    wake.renderOrder = 1;
    wake.visible = false;
    root.add(wake);
    const foamMat = new THREE.MeshBasicMaterial({ map: foamTexture, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 5.8), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.renderOrder = 1;
    foam.visible = false;
    root.add(foam);
    const jetMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0, depthWrite: false });
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 10, 1, true), jetMat);
    jet.rotation.x = -Math.PI / 2 - 0.25;
    jet.visible = false;
    root.add(jet);
    return { hull, wake, foam, jet, wakeMat, foamMat, jetMat };
  }

  /** boat: in boat mode now; speed: forward speed in m/s. */
  update(dt: number, boat: boolean, speed: number): void {
    const target = boat ? 1 : 0;
    if (this.blend === target && !boat && !this.parts?.hull.visible) return;
    this.time += dt;
    this.blend += Math.sign(target - this.blend) * Math.min(Math.abs(target - this.blend), dt / 0.7);
    const b = this.blend;
    const p = (this.parts ??= this.build());
    const root = this.visual.root;
    p.hull.visible = b > 0.001;
    p.hull.scale.y = Math.max(0.001, b);
    // Fold the wheels up flat against the sides.
    this.visual.wheels.forEach((w, i) => {
      if (b <= 0.001) {
        w.pivot.rotation.z = 0;
        return;
      }
      const base = this.wheelBase[i]!;
      const side = base.x < 0 ? -1 : 1;
      w.pivot.position.set(base.x + side * 0.08 * b, base.y + 0.3 * b, base.z);
      w.pivot.rotation.z = side * (Math.PI / 2) * b;
      if (b > 0.5) w.pivot.rotation.y = 0;
    });
    // Water effects lie on the surface (world y ≈ 0), whatever the body's bob.
    const water = 0.03 - root.position.y;
    const speedT = Math.min(1, Math.abs(speed) / 14);
    const on = b > 0.98;
    p.wake.visible = p.foam.visible = on;
    p.jet.visible = on && speed > 0.5;
    if (!on) return;
    p.wake.position.set(0, water, 2.2 + 8);
    p.wakeMat.opacity = 0.15 + 0.75 * speedT;
    p.wake.scale.set(0.8 + 0.4 * speedT, 1, 0.5 + 0.5 * speedT);
    p.wake.position.z = 2.2 + 8 * p.wake.scale.z;
    p.foam.position.set(0, water + 0.01, -0.1);
    p.foamMat.opacity = 0.35 + 0.45 * speedT + Math.sin(this.time * 3) * 0.05;
    p.jet.position.set(0, water + 0.25, 2.6 + 0.55);
    p.jetMat.opacity = 0.25 + 0.45 * speedT;
    p.jet.scale.setScalar(0.6 + 0.6 * speedT + Math.sin(this.time * 23) * 0.05);
  }
}
