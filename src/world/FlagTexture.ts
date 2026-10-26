import * as THREE from 'three';
/** Exact white/red/blue-emblem flag supplied by the user, used for every in-game flag. */
export function flagTexture():THREE.Texture {
 const texture=new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/rakhine-flag.png`);
 texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
