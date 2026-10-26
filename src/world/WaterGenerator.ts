import * as THREE from 'three';
import type { ChunkArea, ChunkWaterway, SeaData } from '../geo/chunkFormat';
import { addFlatPolygon, GeometryBuilder } from './GeometryBuilder';
import { addStrip, miterNormals } from './RoadGenerator';
import { SurfaceY } from './materials';

/**
 * Water surfaces: the sea/estuary polygon (from the OSM coastline), mapped
 * water bodies, and waterway lines (drains, canals, streams). All share one
 * animated shader material.
 */

const waterVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform float uDay;
  varying vec3 vWorld;

  float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + uTime * s); }

  void main() {
    vec2 p = vWorld.xz;
    // Analytic normal from a sum of directional sine waves.
    float e = 0.15;
    float h0 = wave(p, vec2(0.8, 0.6), 0.35, 1.3) + 0.6 * wave(p, vec2(-0.5, 0.86), 0.7, 1.9) + 0.3 * wave(p, vec2(0.2, -0.98), 1.6, 2.7);
    float hx = wave(p + vec2(e, 0.0), vec2(0.8, 0.6), 0.35, 1.3) + 0.6 * wave(p + vec2(e, 0.0), vec2(-0.5, 0.86), 0.7, 1.9) + 0.3 * wave(p + vec2(e, 0.0), vec2(0.2, -0.98), 1.6, 2.7);
    float hz = wave(p + vec2(0.0, e), vec2(0.8, 0.6), 0.35, 1.3) + 0.6 * wave(p + vec2(0.0, e), vec2(-0.5, 0.86), 0.7, 1.9) + 0.3 * wave(p + vec2(0.0, e), vec2(0.2, -0.98), 1.6, 2.7);
    vec3 n = normalize(vec3(-(hx - h0) / e * 0.08, 1.0, -(hz - h0) / e * 0.08));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    vec3 base = mix(uShallow, uDeep, 0.55 + 0.25 * h0 / 1.9);
    vec3 col = mix(base, uSky, fres * 0.55);
    vec3 r = reflect(-uSunDir, n);
    float spec = pow(max(dot(r, viewDir), 0.0), 120.0) * uDay;
    col += uSunColor * spec * 1.6;
    gl_FragColor = vec4(col, 0.94);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

let waterMat: THREE.ShaderMaterial | null = null;

export function waterMaterial(): THREE.ShaderMaterial {
  if (waterMat) return waterMat;
  waterMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        // Sittwe's estuary water is silty: muddy olive-brown rather than blue.
        uDeep: { value: new THREE.Color(0x4e5f4f) },
        uShallow: { value: new THREE.Color(0x7d8462) },
        uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSky: { value: new THREE.Color(0x9cc7e8) },
        uDay: { value: 1 },
      },
    ]),
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    fog: true,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  return waterMat;
}

export function buildWater(water: ChunkArea[], waterways: ChunkWaterway[]): { water: THREE.BufferGeometry | null; banks: THREE.BufferGeometry | null } {
  const b = new GeometryBuilder();
  const banks = new GeometryBuilder();
  banks.setColor(0x7a766c);
  for (const w of water) addFlatPolygon(b, w.r, SurfaceY.water);
  for (const w of waterways) {
    if (w.p.length < 4) continue;
    const n = miterNormals(w.p);
    addStrip(b, w.p, n, -w.w / 2, w.w / 2, SurfaceY.water + 0.004);
    // Stone/concrete embankments along canals and streams.
    if (w.w >= 2.5) {
      const bw = Math.min(1.6, 0.5 + w.w * 0.06);
      addStrip(banks, w.p, n, w.w / 2, w.w / 2 + bw, SurfaceY.landuse + 0.045);
      addStrip(banks, w.p, n, -w.w / 2, -(w.w / 2 + bw), SurfaceY.landuse + 0.045);
    }
  }
  return { water: b.isEmpty() ? null : b.build(), banks: banks.isEmpty() ? null : banks.build() };
}

/** One mesh for the whole sea/estuary polygon (it is not chunked). */
export function buildSea(sea: SeaData): THREE.Mesh | null {
  const b = new GeometryBuilder();
  for (const poly of sea.polygons) addFlatPolygon(b, poly, SurfaceY.water - 0.005);
  if (b.isEmpty()) return null;
  const mesh = new THREE.Mesh(b.build(), waterMaterial());
  mesh.name = 'sea';
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
