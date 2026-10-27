import * as THREE from 'three';
import type { PlayerRig } from '../player/PlayerModel';
import { MOTORBIKE_SEAT, type VehicleVisual } from './VehicleModel';

/** Hip height above the rig's feet (see CharacterModels). */
const HIP = 0.92;

/**
 * Seats a character on a motorbike or bicycle: hips on the seat, hands on the
 * handlebars, feet on the pegs (or pedalling on a bicycle). Call every frame
 * after the bike's transform is updated.
 */
export function seatRider(rig: PlayerRig, bike: VehicleVisual, kind: 'motorbike' | 'bicycle', pedal: number, wheelie = 0): void {
  const seat = bike.seat ?? new THREE.Vector3(0, 0.35, 0.2);
  bike.root.updateMatrixWorld();
  rig.root.position.copy(seat).add(SEAT_OFFSET.set(0, -HIP + 0.04, 0)).applyMatrix4(bike.root.matrixWorld);
  rig.root.quaternion.copy(bike.root.quaternion);
  rig.body.position.set(0, HIP, 0);
  // Lean forward to the bars; in a wheelie lean back against the lift.
  rig.body.rotation.set((kind === 'motorbike' ? 0.18 : 0.32) - wheelie * 0.9, 0, 0);
  rig.head.rotation.set(-0.15, 0, 0);
  if (kind === 'bicycle') {
    // Legs follow the pedals, half a turn apart.
    rig.leftLeg.rotation.set(1.05 + Math.sin(pedal) * 0.35, 0, 0);
    rig.rightLeg.rotation.set(1.05 + Math.sin(pedal + Math.PI) * 0.35, 0, 0);
  } else {
    // Feet down on the floorboard, knees apart around the leg shield.
    rig.leftLeg.rotation.set(1.0, 0, 0.14);
    rig.rightLeg.rotation.set(1.0, 0, -0.14);
  }
  rig.leftArm.rotation.set(1.2 + wheelie * 0.5, 0, 0.2);
  rig.rightArm.rotation.set(1.2 + wheelie * 0.5, 0, -0.2);
  for (const p of rig.lamps ?? []) p.visible = false;
  for (const p of rig.danceProps ?? []) p.visible = false;
}

const SEAT_OFFSET = new THREE.Vector3();

/** How far behind the rider the passenger sits on a motorbike. */
const PILLION_BACK = 0.44;

/**
 * Seats a passenger on the back of a motorbike: sitting upright behind the
 * rider, feet on the rear pegs, hands holding the rider's waist.
 */
export function seatPillion(rig: PlayerRig, bike: THREE.Object3D): void {
  bike.updateMatrixWorld();
  rig.root.position.copy(MOTORBIKE_SEAT).add(SEAT_OFFSET.set(0, -HIP + 0.1, PILLION_BACK)).applyMatrix4(bike.matrixWorld);
  rig.root.quaternion.copy(bike.quaternion);
  rig.body.visible = true;
  rig.body.position.set(0, HIP, 0);
  rig.body.rotation.set(0.06, 0, 0);
  rig.head.rotation.set(-0.05, 0, 0);
  rig.leftLeg.rotation.set(1.05, 0, 0.34);
  rig.rightLeg.rotation.set(1.05, 0, -0.34);
  rig.leftArm.rotation.set(0.6, 0, -0.12);
  rig.rightArm.rotation.set(0.6, 0, 0.12);
  for (const p of rig.lamps ?? []) p.visible = false;
  for (const p of rig.danceProps ?? []) p.visible = false;
}
