/**
 * Rapier interaction groups. A group value packs 16 "membership" bits (high)
 * and 16 "filter" bits (low): two colliders interact when each one's
 * membership overlaps the other's filter.
 */
export const Layer = {
  Ground: 1 << 0,
  Building: 1 << 1,
  Prop: 1 << 2,
  Player: 1 << 3,
  Vehicle: 1 << 4,
  Boundary: 1 << 5,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

const ALL = 0xffff;

export const Groups = {
  ground: groups(Layer.Ground, ALL),
  building: groups(Layer.Building, ALL),
  prop: groups(Layer.Prop, ALL),
  boundary: groups(Layer.Boundary, ALL),
  player: groups(Layer.Player, ALL),
  vehicle: groups(Layer.Vehicle, ALL),
  /** Camera occlusion rays hit static world geometry only. */
  cameraRay: groups(ALL, Layer.Building | Layer.Prop | Layer.Ground),
  /** Wheel suspension rays: ground, buildings, props (never the chassis itself). */
  wheelRay: groups(ALL, Layer.Ground | Layer.Building | Layer.Prop | Layer.Boundary),
} as const;
