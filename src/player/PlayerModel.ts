import * as THREE from 'three';
import { LABEL_FONT } from '../world/LandmarkGenerator';

/**
 * Shared player rig interface and name tag. The character models themselves
 * (Rakhine boy / girl) live in CharacterModels.ts. Models face -Z; limbs are
 * pivoted groups animated procedurally by PlayerAnimations.
 */
export interface PlayerRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  nameTag: THREE.Sprite;
  /** Leg swing multiplier (long skirts swing less). */
  legAmp?: number;
  /** Swaps the face texture for a blink. */
  blink?: (closed: boolean) => void;
  /** Facial expression (pixel-face characters). */
  expression?: (e: 'neutral' | 'happy') => void;
  /** Oil lamps for the Si Mee dance (children of root; hidden unless dancing). */
  lamps?: THREE.Object3D[];
}

export function createNameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `600 34px ${LABEL_FONT}`;
  const w = Math.ceil(ctx.measureText(name).width + 36);
  c.width = Math.max(64, Math.min(w, 512));
  c.height = 56;
  ctx.fillStyle = 'rgba(10,16,24,0.7)';
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 16);
  ctx.fill();
  ctx.font = `600 34px ${LABEL_FONT}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, c.width / 2, c.height / 2 + 1, c.width - 20);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const h = 0.24;
  sprite.scale.set((h * c.width) / c.height, h, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export function setNameTagText(rig: PlayerRig, name: string): void {
  const old = rig.nameTag;
  const tag = createNameTag(name);
  tag.position.copy(old.position);
  rig.root.remove(old);
  old.material.map?.dispose();
  old.material.dispose();
  rig.root.add(tag);
  rig.nameTag = tag;
}
