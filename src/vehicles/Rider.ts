import * as THREE from 'three';
import type { PlayerRig } from '../player/PlayerModel';
import type { VehicleVisual } from './VehicleModel';

/** Hip height above the rig's feet (see CharacterModels). */
const HIP = 0.92;

/**
 * Seats a character on a motorbike or bicycle: hips on the seat, hands on the
 * handlebars, feet on the pegs (or pedalling on a bicycle). Call every frame
 * after the bike's transform is updated.
 */
export function seatRider(rig: PlayerRig, bike: VehicleVisual, kind: 'motorbike' | 'bicycle', pedal: number): void {
  const seat = bike.seat ?? new THREE.Vector3(0, 0.35, 0.2);
  bike.root.updateMatrixWorld();
  rig.root.position.copy(seat).add(SEAT_OFFSET.set(0, -HIP + 0.04, 0)).applyMatrix4(bike.root.matrixWorld);
  rig.root.quaternion.copy(bike.root.quaternion);
  rig.body.position.y = HIP;
  rig.body.rotation.set(kind === 'motorbike' ? 0.18 : 0.32, 0, 0); // lean forward to the bars
  rig.head.rotation.set(-0.15, 0, 0);
  if (kind === 'bicycle') {
    // Legs follow the pedals, half a turn apart.
    rig.leftLeg.rotation.set(1.05 + Math.sin(pedal) * 0.35, 0, 0);
    rig.rightLeg.rotation.set(1.05 + Math.sin(pedal + Math.PI) * 0.35, 0, 0);
  } else {
    rig.leftLeg.rotation.set(1.25, 0, 0.12);
    rig.rightLeg.rotation.set(1.25, 0, -0.12);
  }
  rig.leftArm.rotation.set(1.2, 0, 0.2);
  rig.rightArm.rotation.set(1.2, 0, -0.2);
  for (const p of rig.lamps ?? []) p.visible = false;
  for (const p of rig.danceProps ?? []) p.visible = false;
}

const SEAT_OFFSET = new THREE.Vector3();
