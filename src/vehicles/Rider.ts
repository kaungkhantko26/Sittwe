import * as THREE from 'three';
import type { PlayerRig } from '../player/PlayerModel';
import { MOTORBIKE_SEAT, TUKTUK_BENCH, type VehicleVisual } from './VehicleModel';

/** Hip height above the rig's feet (see CharacterModels). */
const HIP = 0.92;

/**
 * Seats a character on a motorbike or bicycle: hips on the seat, hands on the
 * handlebars, feet on the pegs (or pedalling on a bicycle). Call every frame
 * after the bike's transform is updated.
 */
export function seatRider(rig: PlayerRig, bike: VehicleVisual, kind: 'motorbike' | 'bicycle' | 'tuktuk', pedal: number, wheelie = 0): void {
  const seat = bike.seat ?? new THREE.Vector3(0, 0.35, 0.2);
  bike.root.updateMatrixWorld();
  rig.root.position.copy(seat).add(SEAT_OFFSET.set(0, -HIP + 0.04, 0)).applyMatrix4(bike.root.matrixWorld);
  rig.root.quaternion.copy(bike.root.quaternion);
  rig.body.position.set(0, HIP, 0);
  if (kind === 'tuktuk') {
    // Upright in the driver's seat, feet forward on the floor, hands on the handlebar.
    rig.body.rotation.set(0.06, 0, 0);
    rig.head.rotation.set(-0.08, 0, 0);
    rig.leftLeg.rotation.set(1.35, 0, 0.1);
    rig.rightLeg.rotation.set(1.35, 0, -0.1);
    rig.leftArm.rotation.set(1.15, 0, 0.28);
    rig.rightArm.rotation.set(1.15, 0, -0.28);
    for (const p of rig.lamps ?? []) p.visible = false;
    for (const p of rig.danceProps ?? []) p.visible = false;
    return;
  }
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

/**
 * Seats a passenger where friends can see them: on the back of a motorbike or
 * on a tuktuk's bench (seat 1..3). Returns false for cars, where passengers
 * sit hidden inside.
 */
export function seatPassenger(rig: PlayerRig, vehicle: THREE.Object3D, seat: number): boolean {
  if (vehicle.name === 'motorbike') { seatPillion(rig, vehicle); return true; }
  if (vehicle.name !== 'tuktuk') return false;
  const s = TUKTUK_BENCH[Math.min(2, Math.max(0, seat - 1))]!;
  vehicle.updateMatrixWorld();
  rig.root.position.set(s[0], s[1] - HIP + 0.04, s[2]).applyMatrix4(vehicle.matrixWorld);
  rig.root.quaternion.copy(vehicle.quaternion);
  rig.body.visible = true;
  rig.body.position.set(0, HIP, 0);
  rig.body.rotation.set(-0.06, 0, 0);
  rig.head.rotation.set(0, Math.sin(performance.now() / 2400 + seat) * 0.35, 0);
  rig.leftLeg.rotation.set(1.4, 0, 0.08);
  rig.rightLeg.rotation.set(1.4, 0, -0.08);
  rig.leftArm.rotation.set(0.55, 0, 0.12);
  rig.rightArm.rotation.set(0.55, 0, -0.12);
  for (const p of rig.lamps ?? []) p.visible = false;
  for (const p of rig.danceProps ?? []) p.visible = false;
  return true;
}

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
