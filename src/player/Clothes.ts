import * as THREE from 'three';

/**
 * Makes a longyi / htamein follow the legs. The skirt pieces hang from a pivot
 * at the hips that turns with the average angle of both legs, so the skirt
 * stays down while walking (legs swing opposite ways) but lies along the lap
 * when sitting, riding or kneeling. Long drapes (a shawl or sash hanging down
 * the back) shorten while seated so they don't poke through the seat.
 * Runs automatically every time the scene's matrices update.
 */
export function attachSkirt(body: THREE.Object3D, leftLeg: THREE.Object3D, rightLeg: THREE.Object3D, pieces: THREE.Object3D[], drapes: THREE.Object3D[] = []): THREE.Group {
  const skirt = new THREE.Group();
  skirt.name = 'skirt';
  body.add(skirt);
  for (const p of pieces) skirt.add(p); // body space and skirt space match (hip pivot at y=0)
  const base = drapes.map((d) => {
    const box = new THREE.Box3().setFromObject(d);
    return { d, y: d.position.y, h: box.max.y - box.min.y };
  });
  const update = skirt.updateMatrixWorld.bind(skirt);
  skirt.updateMatrixWorld = (force?: boolean) => {
    const a = (leftLeg.rotation.x + rightLeg.rotation.x) / 2;
    skirt.rotation.x = a;
    // Seated: shorten drapes from the bottom, keeping their tops in place.
    const k = Math.min(1, Math.abs(a) / 1.1);
    for (const b of base) {
      const s = 1 - 0.55 * k;
      b.d.scale.y = s;
      b.d.position.y = b.y + (b.h * (1 - s)) / 2;
    }
    update(force);
  };
  return skirt;
}

/**
 * Seated poses shared by the player, friends and pagoda visitors. Rigs face -Z
 * and limbs hang down; positive leg/arm X rotation swings them forward.
 */
export type SitPose = 'kneel' | 'bench';

/** Kneeling on the folded legs with palms joined in front of the chest (praying). */
export function kneelPose(r: { body: THREE.Object3D; head: THREE.Object3D; leftLeg: THREE.Object3D; rightLeg: THREE.Object3D; leftArm: THREE.Object3D; rightArm: THREE.Object3D }, t: number): void {
  const breathe = Math.sin(t * 1.3) * 0.015;
  r.body.position.set(0, 0.3, 0);
  r.body.rotation.set(-0.1 + breathe, 0, 0);
  r.leftLeg.rotation.set(-1.32, 0, 0.04);
  r.rightLeg.rotation.set(-1.32, 0, -0.04);
  r.leftArm.rotation.set(1.75, 0, 0.5);
  r.rightArm.rotation.set(1.75, 0, -0.5);
  r.head.rotation.set(0.18, 0, 0);
}

/** Sitting on a log bench behind the spot, feet on the sand, hands on the knees. */
export function benchPose(r: { body: THREE.Object3D; head: THREE.Object3D; leftLeg: THREE.Object3D; rightLeg: THREE.Object3D; leftArm: THREE.Object3D; rightArm: THREE.Object3D }, t: number): void {
  r.body.position.set(0, 0.56, 0.32);
  r.body.rotation.set(-0.08 + Math.sin(t * 1.1) * 0.01, 0, 0);
  r.leftLeg.rotation.set(1.05, 0, 0.06);
  r.rightLeg.rotation.set(1.05, 0, -0.06);
  r.leftArm.rotation.set(0.75, 0, 0.12);
  r.rightArm.rotation.set(0.75, 0, -0.12);
  r.head.rotation.set(-0.05, Math.sin(t * 0.3) * 0.2, 0);
}

export function applySitPose(r: Parameters<typeof kneelPose>[0], pose: SitPose, t: number): void {
  if (pose === 'kneel') kneelPose(r, t);
  else benchPose(r, t);
}

/** Back to standing (call when a seated pose ends). */
export function resetPose(r: Parameters<typeof kneelPose>[0]): void {
  r.body.position.set(0, 0.92, 0);
  r.body.rotation.set(0, 0, 0);
  for (const o of [r.leftLeg, r.rightLeg, r.leftArm, r.rightArm, r.head]) o.rotation.set(0, 0, 0);
}
