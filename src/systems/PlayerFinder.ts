/** Helpers for finding other room players on the maps (pure, no DOM or Three.js). */

export interface FoundPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  inVehicle: boolean;
  flying: boolean;
  /** What they drive or ride, if anything. */
  ride?: 'car' | 'motorbike' | 'bicycle' | 'tuktuk' | null;
}

export type FindMode = 'navigate' | 'follow' | 'goto';

/** A stable, distinct colour per player id, so a friend has the same colour on every map. */
export function playerColor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  return `hsl(${hue} 85% 58%)`;
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Compass direction from (fromX, fromZ) to (toX, toZ); X = east, Z = south. */
export function compassDirection(fromX: number, fromZ: number, toX: number, toZ: number): string {
  const bearing = (Math.atan2(toX - fromX, -(toZ - fromZ)) * 180) / Math.PI;
  return DIRS[Math.round(((bearing + 360) % 360) / 45) % 8]!;
}

/**
 * Where a player marker goes on a round minimap: at its own position when it
 * is inside the circle, otherwise pinned to the rim pointing toward it.
 * dx, dy: screen offset from the minimap centre; radius: usable radius in px.
 */
export function rimPosition(dx: number, dy: number, radius: number): { x: number; y: number; outside: boolean; angle: number } {
  const d = Math.hypot(dx, dy);
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (d <= radius) return { x: dx, y: dy, outside: false, angle };
  const k = radius / d;
  return { x: dx * k, y: dy * k, outside: true, angle };
}

/** While following a moving friend, re-route only once they have moved this far from the current target. */
export function shouldReroute(target: { x: number; z: number } | null, player: { x: number; z: number }, threshold = 20): boolean {
  return !target || Math.hypot(target.x - player.x, target.z - player.z) > threshold;
}

/** Players sorted nearest first, with distance and direction from (x, z). */
export function byDistance(list: FoundPlayer[], x: number, z: number): Array<FoundPlayer & { distance: number; direction: string }> {
  return list
    .map((p) => ({ ...p, distance: Math.hypot(p.x - x, p.z - z), direction: compassDirection(x, z, p.x, p.z) }))
    .sort((a, b) => a.distance - b.distance);
}
