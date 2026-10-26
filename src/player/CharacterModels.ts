import * as THREE from 'three';
import type { PlayerRig } from './PlayerModel';
import { createNameTag } from './PlayerModel';

/**
 * Blocky (voxel-style) Rakhine characters in traditional dress, built from
 * boxes with procedurally drawn pixel-art textures — no external assets.
 *
 *  - Boy: white jacket with gold buttons, golden sash with a red flower,
 *    cream/gold checked longyi, white-and-gold headband (gaung baung) with a
 *    bow at the back, sandals.
 *  - Girl: long dark hair in a bun with a gold tiara and cascading jasmine,
 *    cream/gold blouse with gold bracelets, long gold-patterned longyi
 *    (htamein), flowing gold-and-white shawl, white/gold shoes.
 *
 * Both face -Z and expose the same pivots as PlayerRig, so the procedural
 * walk/run/jump/swim animations work unchanged.
 */

export type CharacterKind = 'boy' | 'girl';

// ---------------------------------------------------------------------------
// Pixel texture helpers
// ---------------------------------------------------------------------------

type Painter = (px: (x: number, y: number, c: string) => void, rect: (x: number, y: number, w: number, h: number, c: string) => void) => void;

function pixTex(w: number, h: number, paint: Painter): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const rect = (x: number, y: number, rw: number, rh: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, rw, rh);
  };
  paint((x, y, col) => rect(x, y, 1, 1, col), rect);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Deterministic noise so patterns look hand-placed rather than random each load. */
function hash(x: number, y: number, s = 0): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

const mat = (map: THREE.Texture | null, color = 0xffffff, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map, color, roughness: 0.85, ...extra });
const solid = (color: number) => mat(null, color);

/**
 * Box with per-face materials. Faces order: +X, -X, +Y, -Y, +Z(back), -Z(front).
 * `faces` may give fewer entries: missing ones use `side`.
 */
function box(w: number, h: number, d: number, side: THREE.Material, faces: Partial<Record<'right' | 'left' | 'top' | 'bottom' | 'back' | 'front', THREE.Material>> = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
    faces.right ?? side,
    faces.left ?? side,
    faces.top ?? side,
    faces.bottom ?? side,
    faces.back ?? side,
    faces.front ?? side,
  ]);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Shared palette (from the reference sheets)
// ---------------------------------------------------------------------------

const GOLD = '#e7b43c';
const GOLD_DARK = '#b8862a';
const GOLD_LIGHT = '#f6d77a';
const CREAM = '#f3e3bf';
const CREAM_LIGHT = '#fbf2dc';
const WHITE = '#f7f5f0';
const WHITE_SHADE = '#e3e0d8';
const RED = '#a3242a';

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

function faceTexture(kind: CharacterKind, closed: boolean, happy = false): THREE.CanvasTexture {
  const skin = kind === 'boy' ? '#e9b98f' : '#f4d2b2';
  const skinShade = kind === 'boy' ? '#d9a57c' : '#e8bf9c';
  const hair = kind === 'boy' ? '#1d1714' : '#2b1a12';
  return pixTex(16, 16, (px, rect) => {
    rect(0, 0, 16, 16, skin);
    // Hair fringe.
    rect(0, 0, 16, 4, hair);
    const fringe = kind === 'boy' ? [5, 4, 6, 5, 4, 5, 6, 4, 5, 6, 4, 5, 5, 4, 6, 5] : [6, 5, 4, 4, 4, 5, 4, 4, 4, 4, 5, 4, 4, 4, 5, 6];
    fringe.forEach((h, x) => rect(x, 0, 1, h, hair));
    if (kind === 'girl') {
      rect(0, 0, 2, 16, hair);
      rect(14, 0, 2, 16, hair);
    }
    // Eyebrows.
    rect(3, 7, 3, 1, hair);
    rect(10, 7, 3, 1, hair);
    if (happy) {
      // Smiling "^ ^" eyes.
      for (const ex of [3, 10]) {
        px(ex, 10, '#3a2414');
        px(ex + 1, 9, '#3a2414');
        px(ex + 2, 10, '#3a2414');
      }
    } else if (closed) {
      rect(3, 9, 3, 1, '#3a2414');
      rect(10, 9, 3, 1, '#3a2414');
    } else {
      // Big brown eyes with a highlight (2×3 like the sheets).
      for (const ex of [3, 10]) {
        rect(ex, 8, 3, 3, '#3a2414');
        rect(ex + 1, 9, 2, 2, '#6b4426');
        px(ex, 8, '#ffffff');
        if (kind === 'girl') rect(ex - (ex === 3 ? 1 : -3), 8, 1, 1, '#3a2414'); // lashes
      }
    }
    // Nose shade, cheeks, smile.
    px(7, 11, skinShade);
    px(8, 11, skinShade);
    if (kind === 'girl') {
      rect(2, 11, 2, 1, '#f1a7a0');
      rect(12, 11, 2, 1, '#f1a7a0');
    }
    rect(6, 13, 4, 1, '#b4524a');
    px(5, 12, '#b4524a');
    px(10, 12, '#b4524a');
    if (happy) rect(6, 14, 4, 1, '#d97a72'); // open smile
  });
}

// ---------------------------------------------------------------------------
// Cloth patterns
// ---------------------------------------------------------------------------

/** Cream longyi with gold checks (boy). */
function longyiCheckTex(): THREE.CanvasTexture {
  return pixTex(16, 16, (px, rect) => {
    rect(0, 0, 16, 16, CREAM);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if ((x % 4 === 0 || y % 4 === 0) && hash(x, y) > 0.25) px(x, y, '#ead2a0');
      if (x % 4 === 2 && y % 4 === 2) px(x, y, GOLD_LIGHT);
    }
    rect(0, 14, 16, 1, '#e1c27e');
  });
}

/** Gold ornament band on white (headband, sash edges). */
function ornamentTex(base: string, accent: string, seed: number): THREE.CanvasTexture {
  return pixTex(32, 8, (px, rect) => {
    rect(0, 0, 32, 8, base);
    for (let x = 0; x < 32; x++) {
      const y = 4 + Math.round(Math.sin(x * 0.8 + seed) * 1.6);
      px(x, y, accent);
      if (hash(x, seed) > 0.6) px(x, y - 1, GOLD_DARK);
    }
    // Central medallion.
    rect(13, 2, 6, 4, accent);
    rect(15, 1, 2, 6, accent);
    px(15, 3, GOLD_DARK);
    px(16, 4, GOLD_DARK);
  });
}

/** Golden sash with lacy pattern and a red flower. */
function sashTex(flower: boolean): THREE.CanvasTexture {
  return pixTex(8, 32, (px, rect) => {
    rect(0, 0, 8, 32, GOLD);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) {
      const h = hash(x, y, 3);
      if (h > 0.7) px(x, y, GOLD_LIGHT);
      else if (h < 0.18) px(x, y, GOLD_DARK);
    }
    rect(0, 0, 1, 32, GOLD_DARK);
    rect(7, 0, 1, 32, GOLD_DARK);
    if (flower) {
      rect(3, 9, 2, 2, RED);
      px(2, 10, RED);
      px(5, 9, RED);
      px(3, 8, RED);
      px(4, 11, RED);
      px(4, 10, '#f2c14e');
    }
  });
}

/** White jacket front: mandarin collar, gold buttons, pocket. */
function jacketFrontTex(): THREE.CanvasTexture {
  return pixTex(16, 16, (px, rect) => {
    rect(0, 0, 16, 16, WHITE);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (hash(x, y, 9) > 0.86) px(x, y, WHITE_SHADE);
    rect(5, 0, 6, 1, GOLD); // collar
    rect(7, 1, 2, 15, WHITE_SHADE); // placket
    for (const y of [3, 6, 9, 12]) px(8, y, GOLD);
    rect(2, 11, 3, 1, GOLD); // pocket line
    rect(0, 15, 16, 1, WHITE_SHADE);
  });
}

function sleeveTex(cloth: string, cuff: string, skin: string, sheer: boolean): THREE.CanvasTexture {
  return pixTex(4, 16, (px, rect) => {
    rect(0, 0, 4, 16, cloth);
    if (sheer) for (let y = 0; y < 12; y++) for (let x = 0; x < 4; x++) if (hash(x, y, 5) > 0.75) px(x, y, GOLD_LIGHT);
    rect(0, 10, 4, 1, cuff);
    rect(0, 11, 4, 1, sheer ? GOLD : cloth);
    rect(0, 12, 4, 4, skin);
  });
}

/** Girl's blouse: cream with gold lace and a gold neckline. */
function blouseTex(): THREE.CanvasTexture {
  return pixTex(16, 16, (px, rect) => {
    rect(0, 0, 16, 16, CREAM_LIGHT);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const h = hash(x, y, 11);
      if (h > 0.78) px(x, y, GOLD_LIGHT);
      else if (h > 0.72) px(x, y, GOLD);
    }
    rect(5, 0, 6, 1, GOLD);
    rect(6, 1, 4, 1, GOLD_DARK);
    rect(0, 14, 16, 2, GOLD); // waist band
    for (let x = 1; x < 16; x += 3) px(x, 15, GOLD_DARK);
  });
}

/** Girl's long longyi: white with bold gold floral bands. */
function htameinTex(): THREE.CanvasTexture {
  return pixTex(16, 32, (px, rect) => {
    rect(0, 0, 16, 32, CREAM_LIGHT);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
      const band = (y % 8 >= 2 && y % 8 <= 5);
      const h = hash(x, y, 21);
      if (band && h > 0.35) px(x, y, (x + y) % 3 ? GOLD : GOLD_DARK);
      else if (!band && h > 0.86) px(x, y, GOLD_LIGHT);
    }
    rect(0, 30, 16, 2, GOLD);
  });
}

function shawlTex(): THREE.CanvasTexture {
  return pixTex(8, 32, (px, rect) => {
    rect(0, 0, 8, 32, CREAM_LIGHT);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) if (hash(x, y, 31) > 0.62) px(x, y, GOLD_LIGHT);
    rect(0, 0, 1, 32, GOLD);
    rect(7, 0, 1, 32, GOLD);
    for (let y = 2; y < 32; y += 6) {
      rect(3, y, 2, 2, GOLD);
      px(2, y + 1, GOLD_DARK);
      px(5, y, GOLD_DARK);
    }
  });
}

function hairTex(color: string, seed: number): THREE.CanvasTexture {
  return pixTex(8, 8, (px, rect) => {
    rect(0, 0, 8, 8, color);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const h = hash(x, y, seed);
      if (h > 0.78) px(x, y, '#3d2a20');
      else if (h < 0.12) px(x, y, '#100b09');
    }
  });
}

// ---------------------------------------------------------------------------
// Rig assembly
// ---------------------------------------------------------------------------

interface Parts {
  root: THREE.Group;
  body: THREE.Group;
  headPivot: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  faceMat: THREE.MeshStandardMaterial;
  faceOpen: THREE.Texture;
  faceClosed: THREE.Texture;
  faceHappy: THREE.Texture;
}

const HEAD = 0.48;
const TORSO_H = 0.6;
const TORSO_W = 0.46;
const TORSO_D = 0.26;
const ARM_W = 0.18;
const ARM_L = 0.62;
const LEG_W = 0.2;
const LEG_L = 0.92;

function skeleton(kind: CharacterKind, skin: string, hairColor: string): Parts {
  const root = new THREE.Group();
  root.name = `player-${kind}`;
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);

  // Head (pivot at neck) with pixel face on the front.
  const headPivot = new THREE.Group();
  headPivot.position.y = TORSO_H;
  body.add(headPivot);
  const faceOpen = faceTexture(kind, false);
  const faceClosed = faceTexture(kind, true);
  const faceHappy = faceTexture(kind, false, true);
  const faceMat = mat(faceOpen);
  const hairMat = mat(hairTex(hairColor, kind === 'boy' ? 1 : 2));
  const skinCol = new THREE.Color(skin);
  const sideTex = pixTex(16, 16, (px, rect) => {
    rect(0, 0, 16, 16, `#${skinCol.getHexString()}`);
    rect(0, 0, 16, kind === 'girl' ? 16 : 6, hairColor);
    if (kind === 'girl') rect(5, 6, 6, 10, `#${skinCol.getHexString()}`);
    rect(7, 8, 2, 3, kind === 'girl' ? hairColor : '#d9a57c'); // ear / side lock
    void px;
  });
  const sideMat = mat(sideTex);
  const head = box(HEAD, HEAD, HEAD, sideMat, { front: faceMat, top: hairMat, back: hairMat, bottom: solid(new THREE.Color(skin).getHex()) });
  head.position.y = HEAD / 2;
  headPivot.add(head);

  // Arms (pivot at shoulders).
  const mkLimb = (w: number, l: number, d: number, m: THREE.Material | THREE.Material[]) => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, l, d).translate(0, -l / 2, 0), m);
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  };
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-(TORSO_W / 2 + ARM_W / 2), TORSO_H - 0.06, 0);
  rightArm.position.set(TORSO_W / 2 + ARM_W / 2, TORSO_H - 0.06, 0);
  body.add(leftArm, rightArm);

  const leftLeg = mkLimb(LEG_W, LEG_L, LEG_W, solid(new THREE.Color(skin).getHex()));
  const rightLeg = mkLimb(LEG_W, LEG_L, LEG_W, solid(new THREE.Color(skin).getHex()));
  leftLeg.position.set(-LEG_W / 2 - 0.01, 0, 0);
  rightLeg.position.set(LEG_W / 2 + 0.01, 0, 0);
  body.add(leftLeg, rightLeg);

  return { root, body, headPivot, leftArm, rightArm, leftLeg, rightLeg, faceMat, faceOpen, faceClosed, faceHappy };
}

function addArm(arm: THREE.Group, tex: THREE.Texture): void {
  const m = mat(tex);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(ARM_W, ARM_L, ARM_W).translate(0, -ARM_L / 2, 0), m);
  mesh.castShadow = true;
  arm.add(mesh);
}

function addFootwear(leg: THREE.Group, top: number, sole: number, open: boolean): void {
  const sole1 = new THREE.Mesh(new THREE.BoxGeometry(LEG_W + 0.04, 0.06, LEG_W + 0.1), solid(sole));
  sole1.position.set(0, -LEG_L + 0.03, -0.04);
  sole1.castShadow = true;
  leg.add(sole1);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(LEG_W + 0.05, open ? 0.05 : 0.1, open ? 0.08 : LEG_W + 0.08), solid(top));
  strap.position.set(0, -LEG_L + (open ? 0.09 : 0.1), open ? -0.08 : -0.04);
  leg.add(strap);
}

/** Small gold oil lamp (Si Mee) with a flickering flame and a soft glow. */
export function createOilLamp(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'oil-lamp';
  const gold = new THREE.MeshStandardMaterial({ color: 0xd99a2b, roughness: 0.4, metalness: 0.6 });
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.11, 0.03], [0.13, 0.07], [0.1, 0.075], [0, 0.06]].map(([r, y]) => new THREE.Vector2(r, y)), 10), gold);
  bowl.castShadow = true;
  g.add(bowl);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 8), new THREE.MeshBasicMaterial({ color: 0xffb640 }));
  flame.position.y = 0.14;
  flame.name = 'flame';
  g.add(flame);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,200,110,0.9)');
  grad.addColorStop(0.35, 'rgba(255,150,50,0.35)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(c);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(0.7);
  glow.position.y = 0.15;
  glow.name = 'glow';
  g.add(glow);
  g.visible = false;
  return g;
}

function finish(p: Parts, name: string, legAmp: number): PlayerRig {
  const nameTag = createNameTag(name);
  nameTag.position.y = 2.42;
  p.root.add(nameTag);
  return {
    root: p.root,
    body: p.body,
    head: p.headPivot as unknown as THREE.Mesh,
    leftArm: p.leftArm,
    rightArm: p.rightArm,
    leftLeg: p.leftLeg,
    rightLeg: p.rightLeg,
    nameTag,
    legAmp,
    blink: (closed: boolean) => {
      if (p.faceMat.map === p.faceHappy) return;
      p.faceMat.map = closed ? p.faceClosed : p.faceOpen;
    },
    expression: (e) => {
      p.faceMat.map = e === 'happy' ? p.faceHappy : p.faceOpen;
    },
  };
}

// ---------------------------------------------------------------------------
// Boy
// ---------------------------------------------------------------------------

export function createRakhineBoy(name: string): PlayerRig {
  const skin = '#e9b98f';
  const hair = '#1d1714';
  const p = skeleton('boy', skin, hair);

  // Messy voxel hair tufts on top.
  const hairMat = mat(hairTex(hair, 4));
  for (const [x, z, s] of [[-0.12, 0.05, 0.16], [0.1, -0.08, 0.18], [0.02, 0.14, 0.15], [-0.15, -0.12, 0.12], [0.16, 0.12, 0.12]] as const) {
    const t = box(s, 0.08, s, hairMat);
    t.position.set(x, HEAD + 0.03, z);
    p.headPivot.add(t);
  }

  // Headband (gaung baung): white with gold ornament, bow and tails at the back-left.
  const band = ornamentTex(WHITE, GOLD, 1);
  const bandMat = mat(band);
  const headband = box(HEAD + 0.03, 0.12, HEAD + 0.03, bandMat, { top: solid(0xf7f5f0), bottom: solid(0xf7f5f0) });
  headband.position.y = HEAD * 0.74;
  p.headPivot.add(headband);
  const white = solid(0xf7f5f0);
  const bow1 = box(0.12, 0.1, 0.06, white);
  bow1.position.set(-0.08, HEAD * 0.74, HEAD / 2 + 0.04);
  const bow2 = box(0.12, 0.1, 0.06, white);
  bow2.position.set(0.08, HEAD * 0.74, HEAD / 2 + 0.04);
  const tail = box(0.07, 0.22, 0.04, white);
  tail.position.set(-HEAD / 2 - 0.02, HEAD * 0.6, 0.12);
  tail.rotation.z = 0.15;
  p.headPivot.add(bow1, bow2, tail);

  // White jacket.
  const jacketSide = mat(pixTex(8, 16, (px, rect) => {
    rect(0, 0, 8, 16, WHITE);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) if (hash(x, y, 7) > 0.85) px(x, y, WHITE_SHADE);
  }));
  const torso = box(TORSO_W, TORSO_H, TORSO_D, jacketSide, { front: mat(jacketFrontTex()) });
  torso.position.y = TORSO_H / 2;
  p.body.add(torso);

  // Golden sash: diagonal across the front (left shoulder → right hip) and down the back.
  const sashFront = box(0.11, 0.78, 0.03, mat(sashTex(false)), { front: mat(sashTex(true)) });
  sashFront.position.set(0.02, TORSO_H * 0.5, -TORSO_D / 2 - 0.02);
  sashFront.rotation.z = 0.62;
  const sashBack = box(0.11, 0.9, 0.03, mat(sashTex(false)));
  sashBack.position.set(0.02, TORSO_H * 0.42, TORSO_D / 2 + 0.02);
  sashBack.rotation.z = -0.62;
  const sashHang = box(0.12, 0.55, 0.03, mat(sashTex(false)));
  sashHang.position.set(TORSO_W / 2 - 0.02, -0.05, 0.05);
  sashHang.rotation.y = Math.PI / 2;
  p.body.add(sashFront, sashBack, sashHang);

  // Arms: white sleeves with gold cuffs.
  const sleeve = sleeveTex(WHITE, GOLD, skin, false);
  addArm(p.leftArm, sleeve);
  addArm(p.rightArm, sleeve);

  // Longyi: cream/gold checks from the waist to mid-shin.
  const ly = longyiCheckTex();
  const longyi = box(TORSO_W + 0.04, 0.72, TORSO_D + 0.06, mat(ly));
  longyi.position.y = -0.36;
  p.body.add(longyi);
  const knot = box(0.1, 0.1, 0.06, mat(ly));
  knot.position.set(0, -0.04, -TORSO_D / 2 - 0.05);
  p.body.add(knot);

  addFootwear(p.leftLeg, 0xc89a55, 0x4a2f1e, true);
  addFootwear(p.rightLeg, 0xc89a55, 0x4a2f1e, true);
  return finish(p, name, 1);
}

// ---------------------------------------------------------------------------
// Girl
// ---------------------------------------------------------------------------

export function createRakhineGirl(name: string): PlayerRig {
  const skin = '#f4d2b2';
  const hair = '#2b1a12';
  const p = skeleton('girl', skin, hair);
  const hairMat = mat(hairTex(hair, 6));

  // Hair volume, bun, long back hair and side locks.
  const crown = box(HEAD + 0.04, 0.16, HEAD + 0.04, hairMat);
  crown.position.y = HEAD - 0.04;
  const bun = box(0.26, 0.2, 0.24, hairMat);
  bun.position.set(0, HEAD + 0.12, 0.06);
  const back = box(HEAD + 0.02, 0.62, 0.08, hairMat);
  back.position.set(0, HEAD - 0.36, HEAD / 2 + 0.02);
  const lockL = box(0.06, 0.42, 0.06, hairMat);
  lockL.position.set(-HEAD / 2 - 0.02, HEAD * 0.3 - 0.12, -HEAD / 2 + 0.1);
  const lockR = lockL.clone();
  lockR.position.x = HEAD / 2 + 0.02;
  p.headPivot.add(crown, bun, back, lockL, lockR);

  // Gold tiara on the crown.
  const gold = new THREE.MeshStandardMaterial({ color: 0xe1ad3a, roughness: 0.35, metalness: 0.7 });
  const tiaraBase = box(0.26, 0.04, 0.04, gold);
  tiaraBase.position.set(0, HEAD + 0.06, -0.14);
  p.headPivot.add(tiaraBase);
  for (const [x, h] of [[-0.09, 0.05], [0, 0.09], [0.09, 0.05]] as const) {
    const s = box(0.04, h, 0.03, gold);
    s.position.set(x, HEAD + 0.08 + h / 2, -0.14);
    p.headPivot.add(s);
  }
  // Chain across the back of the head.
  const chain = box(HEAD * 0.8, 0.025, 0.02, gold);
  chain.position.set(0, HEAD * 0.62, HEAD / 2 + 0.07);
  p.headPivot.add(chain);

  // Cascading jasmine (white/cream voxels) on the left side of the head.
  const jasmine = [new THREE.MeshStandardMaterial({ color: 0xf6f3e2, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0xe3ecc8, roughness: 0.7 })];
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), jasmine[i % 2]!);
    const col = i % 3;
    fl.position.set(-HEAD / 2 - 0.05 - (col === 1 ? 0.04 : 0), HEAD + 0.02 - t * 0.55, -0.06 + (col - 1) * 0.07 + Math.sin(i) * 0.02);
    p.headPivot.add(fl);
  }

  // Blouse.
  const blouse = mat(blouseTex());
  const torso = box(TORSO_W - 0.02, TORSO_H, TORSO_D, blouse);
  torso.position.y = TORSO_H / 2;
  p.body.add(torso);

  // Long longyi (htamein), slightly flared to the ankles.
  const skirtGeo = new THREE.BoxGeometry(TORSO_W + 0.02, 0.9, TORSO_D + 0.04);
  const pos = skirtGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) {
      pos.setX(i, pos.getX(i) * 1.22);
      pos.setZ(i, pos.getZ(i) * 1.35);
    }
  }
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeo, mat(htameinTex()));
  skirt.position.y = -0.45;
  skirt.castShadow = true;
  p.body.add(skirt);

  // Shawl: across the front from the right shoulder and flowing down the back.
  const sh = shawlTex();
  const shFront = box(0.13, 0.62, 0.03, mat(sh));
  shFront.position.set(-0.02, TORSO_H * 0.48, -TORSO_D / 2 - 0.02);
  shFront.rotation.z = -0.6;
  const shBack = box(0.42, 1.35, 0.03, mat(sh));
  shBack.position.set(0.04, -0.12, TORSO_D / 2 + 0.12);
  shBack.rotation.x = 0.16;
  p.body.add(shFront, shBack);

  // Sheer cream sleeves with gold bracelets.
  const sleeve = sleeveTex(CREAM_LIGHT, GOLD, skin, true);
  addArm(p.leftArm, sleeve);
  addArm(p.rightArm, sleeve);

  // Legs are hidden by the long skirt; white/gold shoes peek out.
  for (const leg of [p.leftLeg, p.rightLeg]) {
    (leg.children[0] as THREE.Mesh).visible = false;
    addFootwear(leg, 0xe2ad3c, 0xf4f1e8, false);
  }
  const rig = finish(p, name, 0.4);
  // Si Mee (ဆီမီး) oil lamps, carried in both hands while dancing.
  rig.lamps = [createOilLamp(), createOilLamp()];
  for (const l of rig.lamps) p.root.add(l);
  return rig;
}

export function createCharacter(kind: CharacterKind, name: string): PlayerRig {
  return kind === 'girl' ? createRakhineGirl(name) : createRakhineBoy(name);
}

/** Frees per-character GPU resources (textures, materials, geometries). */
export function disposeCharacter(rig: PlayerRig): void {
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) {
      (mm as THREE.MeshStandardMaterial).map?.dispose();
      mm.dispose();
    }
  });
}
