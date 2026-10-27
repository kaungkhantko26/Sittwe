import * as THREE from 'three';
import type { VehicleVisual } from './VehicleModel';

/**
 * Visible headlights for cars that are not lit by the local driver's
 * spotlights (other players' cars in a room): a soft additive light cone from
 * each lamp, a glow at the lamp and a light pool on the road ahead. They are
 * cheap meshes, so every remote car can show them without adding scene lights.
 */
export interface HeadlightBeams {
  group: THREE.Group;
  /** Hidden while flying, when the road is far below. */
  pool: THREE.Mesh;
  set(on: boolean, strength: number, flying: boolean): void;
}

const BEAM_LENGTH = 15;
const BEAM_RADIUS = 2.6;

let poolTexture: THREE.CanvasTexture | null = null;
let glowTexture: THREE.CanvasTexture | null = null;

function radialTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(0xfff0d0) } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uColor;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Bright at the lamp (uv.y = 1 at the cone tip), fading along the beam,
        // and softer at the silhouette so the cone has no hard edges.
        float along = pow(vAlong, 1.6);
        float facing = pow(abs(dot(vNormal, vView)), 1.4);
        gl_FragColor = vec4(uColor, along * facing * uStrength);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Adds headlight beams in front of the car's own lamp meshes. */
export function createHeadlightBeams(visual: VehicleVisual): HeadlightBeams {
  const lamps: THREE.Mesh[] = [];
  visual.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === visual.headMat) lamps.push(m);
  });
  const parent = lamps[0]?.parent ?? visual.root;
  const group = new THREE.Group();
  group.name = 'headlight-beams';
  parent.add(group);

  poolTexture ??= radialTexture([[0, 'rgba(255,240,208,0.9)'], [0.45, 'rgba(255,236,200,0.35)'], [1, 'rgba(255,230,190,0)']]);
  glowTexture ??= radialTexture([[0, 'rgba(255,255,245,1)'], [0.25, 'rgba(255,240,210,0.6)'], [1, 'rgba(255,230,190,0)']]);

  const beamMat = beamMaterial();
  // Cone tip at the lamp, opening forward (-Z), tilted slightly toward the road.
  const coneGeo = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 20, 1, true);
  coneGeo.translate(0, -BEAM_LENGTH / 2, 0);
  coneGeo.rotateX(Math.PI / 2 + 0.07);
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0xfff2d8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });

  const positions = lamps.length ? lamps.map((l) => l.position.clone()) : [new THREE.Vector3(-0.62, 0.66, -2.16), new THREE.Vector3(0.62, 0.66, -2.16)];
  for (const p of positions) {
    const cone = new THREE.Mesh(coneGeo, beamMat);
    cone.position.set(p.x, p.y, p.z - 0.04);
    cone.renderOrder = 2;
    cone.frustumCulled = false;
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(p.x, p.y, p.z - 0.08);
    glow.scale.setScalar(0.9);
    group.add(cone, glow);
  }
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 13), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.06, -(Math.abs(positions[0]!.z) + 7));
  pool.renderOrder = 1;
  group.add(pool);
  group.visible = false;

  return {
    group,
    pool,
    set(on, strength, flying) {
      group.visible = on && strength > 0.01;
      if (!group.visible) return;
      beamMat.uniforms['uStrength']!.value = 0.22 * strength;
      glowMat.opacity = 0.5 + 0.5 * strength;
      poolMat.opacity = 0.55 * strength;
      pool.visible = !flying;
    },
  };
}
