# Sittwe 3D

A browser-based 3D open-world exploration and driving game set in a real, geographically referenced **Sittwe (စစ်တွေ), Rakhine State, Myanmar**. Roads, building footprints, coastline, canals, bridges and landmarks are generated from OpenStreetMap data. Play as a **Rakhine boy or girl** in traditional dress, walk, swim, and drive across the Sittwe peninsula.

Solo exploration plus browser-hosted multiplayer rooms for up to eight players. The game deploys as a static site; room discovery uses PeerJS signaling and gameplay snapshots use WebRTC. No account is required.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

The processed map data is committed under `public/data/`, so the game runs straight after install. To refresh it from OpenStreetMap, run:

```bash
npm run data:all   # fetch → convert → chunks → validate
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Strict TypeScript check (game + data scripts) |
| `npm run test` | Unit tests (Vitest) |

## Controls

| On foot | | Driving | |
|---|---|---|---|
| W A S D | Move | W | Accelerate |
| Shift | Sprint | S | Brake / reverse |
| Space | Jump | A / D | Steer |
| Mouse / wheel | Camera / zoom | Space | Handbrake |
| F | Enter vehicle | F | Exit vehicle |
| E | Landmark info | L | Headlights |
| C | 3rd / 1st person / cinematic | C | Chase / far / hood / cinematic |
| | | R | Flip car upright |

General: **M** full-screen map (click to set a destination), **/** search places and navigate, **V** spawn a car nearby, **Esc** pause, **H** hide hints, **F5** quick save (it also autosaves every 30 s).

## The world

- **Origin:** OSM node 26576213 (place=city, စစ်တွေမြို့), 20.139197° N, 92.8970859° E, verified via Nominatim.
- **Area:** about 9.2 km × 8.2 km (`WORLD_BOUNDS` in `src/config.ts`), in 256 m chunks. It covers the Sittwe peninsula: town centre, Main Road, the Kaladan waterfront, Sittwe Airport and the western shore, north to the outskirts and south to the Point.
- **Data snapshot:** OSM as of 2026-10-26, retrieved via the Overpass API (endpoints and timestamps are in `data/geojson/meta.json`).
- **Data (Geofabrik Myanmar extract, OSM as of 2026-10-25):** 16,459 building footprints, 1,379 roads, 26 water bodies, 30 waterways, 14 bridges, 110 named landmarks, 66 named places, and the coastline (3 sea polygons). The road graph has about 8,000 junctions. The only mapped clock tower is "Sittwe Clock Tower" on a roundabout, styled as the New (Burmese-style) Clock Tower. The Old colonial tower (1887, near the Central Market) is not mapped in OSM, so it is not placed; it will appear automatically once mapped.
- **Map source:** OpenStreetMap only. Google Maps data, imagery and 3D buildings are **not** used: Google's terms forbid extracting them into other products.

### What is real vs. generated

| Real (from OSM) | Estimated | Generated / artistic |
|---|---|---|
| Road centerlines, classes, names | Building heights: **all 5,848** have no `height`/`building:levels` tag, so height is estimated from building type and footprint area (rules in `OSMParser.buildingHeight`) | Filler trees inside mapped green/residential areas |
| Building footprints (incl. courtyards) | Road widths without `width`/`lanes` tags | Streetlights along major roads (no lamps are mapped) |
| Coastline → sea, water bodies, waterways | Hipped roofs on small houses | Window/door detailing, facade colours |
| Land use, named landmarks & places | | Stupa markers at mapped Buddhist sites without a footprint |
| | | Flat terrain (no elevation model) |

Missing buildings or roads are never replaced with invented ones. Travel, spawn, save-restore and exiting a car always place the player at the nearest clear spot (never inside a building, tree, statue or water).

### Coordinates

`src/geo/GeoProjection.ts` uses a local tangent-plane projection on the WGS84 ellipsoid: **+X = East, +Y = Up, +Z = South**, in meters. `geoToWorld(lat, lon, alt)` and `worldToGeo(x, y, z)` are exact inverses (tested to 1e-9°). Within the world the scale error is under about 13 cm per km. Every system shares one origin: roads, buildings, player, vehicles, minimap and saves.

### Gameplay additions

- **Characters:** Rakhine boy (white jacket, golden sash, cream checked longyi, white-and-gold headband) and Rakhine girl (hair bun with tiara and jasmine, gold-lace blouse, long patterned longyi, flowing shawl). They are blocky, voxel-style models built in code (`src/player/CharacterModels.ts`) with pixel-art faces that blink. Choose one in the main menu or in Settings.
- **Search & navigation:** press **/** or open the map (**M**) and search landmarks, neighbourhoods and road names (English or Burmese script). Choosing a result or clicking the map computes a real route on the OSM road graph (`public/data/roadgraph.json`, A*). Driving routes use car roads and respect one-way streets; walking routes also use footpaths. The route shows on the minimap, the full map and as a guide line on the ground, with turn-by-turn instructions and automatic re-routing.
- **Traffic:** cars spawn randomly 70–260 m away and drive the real road graph in the right-hand lane. They turn randomly at junctions, follow one-way rules and brake for you and each other. Press **F** next to one to take it over; press **V** to spawn a drivable car nearby. Traffic density follows the graphics preset.
- **Sittwe Point:** the View Point at the southern tip gets a seaside promenade. Its outline is fitted to the real coastline; the detailing (terracotta paving, blue loop around a garden, statue, lighthouse, balustrade, palms, golden chinthe) is modelled on photos and is artistic.
- **Swimming:** the sea, ponds and canals are swimmable (slower movement, crawl/treading animations, splash sounds). Cars still stay out of water.
- **Bridges:** every mapped `bridge=yes` road gets red/white kerbs, walkways and railings. Bridges on major roads get steel bowstring arches, modelled on Sittwe's canal bridges such as the Bilu Ma (ဘီလူးမ) bridge on Main Road. Canals under mapped bridges are widened to about 55% of the bridge length (max 22 m) and given stone embankments; this is an estimate.
- **Landmark buildings:** each named landmark links to the building that contains it, or the nearest one within 15 m. That building is rendered in a matching style: church (bell tower), Buddhist monastery (tiered roof), mosque (dome), market, stadium, hospital (roof cross), civic, or school. Mapped "buildings" that enclose other buildings (e.g. the Sacred Heart compound) become perimeter walls. Statues and clock towers on mapped roundabouts get a plaza. Pagodas mapped as points get a stupa at the nearest clear spot.

## Data pipeline (`scripts/`)

**Fast path (recommended):** download the Geofabrik extract and cut out the world locally (about 20 s):
```bash
curl -L -o data/pbf/myanmar.osm.pbf https://download.geofabrik.de/asia/myanmar-latest.osm.pbf
npm run data:extract -- data/pbf/myanmar.osm.pbf
npm run data:convert && npm run data:chunks && npm run data:validate
```
`scripts/extract-pbf.ts` decodes the OSM PBF format directly (zlib blobs, DenseNodes, ways, relations) in three passes and writes the same JSON the Overpass path produces. When that file exists, `convert-osm.ts` uses it.

**Overpass path** (slower; public servers are often overloaded):

1. **`fetch-osm.ts`**: downloads the world in 2 × 2 bounded Overpass regions (plus a coastline query), with retry, backoff and mirror fallback. A region that keeps timing out is split automatically into 4 sub-regions. Raw responses are cached in `data/osm/` with their source, date, bbox and query.
2. **`convert-osm.ts`**: normalizes the raw elements to GeoJSON in `data/geojson/`. It assembles multipolygons, builds the sea from the coastline, classifies roads and land use, and estimates heights. It writes `meta.json` with stats, missing-data counts and the list of inferred features.
3. **`build-chunks.ts`**: projects to meters and clips roads and areas to 256 m chunks (buildings go to the chunk containing their centroid). It picks spawn points on real roads and writes `public/data/` (manifest, chunks, sea, minimap GeoJSON).
4. **`validate-map.ts`**: structural checks and finite-coordinate checks. Exits non-zero on errors.

## Architecture

```
src/
  core/      Game (state machine), GameLoop (fixed 60 Hz physics + interpolated render), Renderer, InputManager
  geo/       GeoProjection, OSMParser, geometry2d (clipping, ring assembly, coastline→sea), chunkFormat, MapDataLoader, validateChunk
  world/     WorldManager, ChunkManager (streaming), Road/Building/Terrain/Water/Vegetation/Landmark generators, StreetFurniture, SpatialIndex, materials
  player/    PlayerController (Rapier kinematic character controller), PlayerModel, PlayerAnimations, ThirdPersonCamera
  vehicles/  VehiclePhysics (Rapier raycast vehicle), Vehicle, VehicleModel, VehicleInteraction
  physics/   PhysicsWorld, CollisionLayers
  lighting/  DayNightCycle, LightingManager (sky, sun/moon, fog, streetlight pool), Weather (rain)
  ui/        HUD, Minimap + FullMap (MapLibre), Screens (loading/menu/pause/modals), SettingsPanel, i18n (English / ရခိုင် Rakhine)
  systems/   AudioManager (procedural Web Audio), SaveManager (versioned), Settings, PerformanceManager
```

Entity state (player and vehicle transforms) is kept in plain serializable objects, ready for future multiplayer sync. Multiplayer itself is not implemented.

## Performance

How it stays fast:
- One merged mesh per material per chunk, so every chunk shares about 12 materials.
- Instanced trees and lamps.
- Chunk builds staged across frames within a 6 ms budget.
- Physics colliders only for the 3 × 3 chunks around the player; GPU resources are disposed on unload.
- A constant light count (no shader recompiles at dusk).
- Shadow-frustum texel snapping.
- Vendor code split into parallel cacheable chunks.

**Historical baseline, before housing, NPCs and multiplayer:** measured in an embedded Chromium browser on the author's Mac, "High" preset:

| Measurement | Result |
|---|---|
| Frame rate | 144 FPS (display-capped) |
| Frame time | ~6.9 ms, p99 7.8 ms |
| Draw calls | ~270 |
| Triangles | ~98k |
| Driving between chunks | worst frames 9–14 ms |
| Teleporting across the whole map | one 61 ms first-load frame |

These numbers come from a single machine; low-end hardware has not been tested. Presets: Low / Medium / High / Ultra (pixel ratio, shadows, view distance, vegetation density, point lights, fog).

## Known limitations

- All building heights are estimates. OSM has no height data for this area. See "Next steps".
- Terrain is flat (no DEM). Players can swim; ground vehicles are kept out of deep water. Flying cars can cross above it.
- The vehicle is an arcade-style model on Rapier's raycast vehicle (suspension, tyre friction, rear-wheel drive). There is no gearbox or torque-curve simulation.
- Second UI language is **Rakhine (ရခိုင်, `rki`)**. The strings in `src/ui/i18n.ts` use the formal written register and need review by a native Rakhine speaker. Place/landmark labels use OSM `name:rki` when mapped (none are yet in Sittwe), otherwise the locally mapped Myanmar-script `name`.
- The character and car are procedural primitive models, not rigged GLB assets.

## Next steps

- Add building heights from **3D-GloBFP** (Che et al. 2024, CC BY 4.0) or **GlobalBuildingAtlas** (Zhu et al. 2025, **CC BY-NC 4.0, non-commercial only**). Match footprints in `convert-osm.ts` and keep `heightSource` so estimates stay distinguishable.
- Swap in licensed rigged GLB character and vehicle models.
- Expand `WORLD_HALF_SIZE` in `src/config.ts` and re-run `npm run data:all` to cover more of Sittwe.

## Deployment

The output is a static site. `vercel.json` is included (`npm run build`, output `dist/`). Any static host works.

GitHub Pages deploys automatically from `main` using `.github/workflows/deploy.yml`.
In the repository's **Settings → Pages**, select **GitHub Actions** as the source.
The published game is available at https://kaungkhantko26.github.io/Sittwe/ after the deployment succeeds.
The workflow runs type checks, tests and map validation before building and publishing `dist/`.
Relative asset paths support the `/Sittwe/` project path as well as root-domain hosting.

## Licensing & attribution

See [ATTRIBUTION.md](ATTRIBUTION.md). Map data © OpenStreetMap contributors (ODbL 1.0). No proprietary assets or code (including OpenTaxi's) and no Google Maps data are used.


## Housing, flying cars, touch controls and rooms

- **Home:** a reference-inspired Het Laung house with red corrugated gable, raised timber floor, porch lattice, stairs, an openable door, bed, shelf, pottery and fenced yard. New games start inside. The first-person camera avoids the cramped indoor third-person view; use **C** or the touch **View** button to change it.
- **Permanent local home:** open **M → search or select a pin → Check home plot → Make this my home**. Plot checks cover the whole 14 × 20 m yard, nearby road access, mapped residential land, buildings, water, restricted land, landmarks, trees, lamps and mapped fences. **Go home** returns to the house. Ownership is saved in this browser; it is not shared online real-estate ownership. Mapped buildings are not removed to make room.
- **Reference-inspired electric flying sedan:** player vehicles have a sculpted body, panoramic glass canopy, four physical rotor pods, animated fans and blue thruster accents. **V** spawns one only in a clear road space; **F** enters. **Space** takes off/ascends, **Ctrl** descends, **W/S** moves, **A/D** turns, **Shift** boosts, **G** toggles flight/landing, **X** is the ground handbrake, and **R** resets upright. Landing checks the surface below; exit is prevented at flight altitude. Ambient traffic uses ordinary ground cars.
- **NPCs:** eight occupational silhouettes with rounded faces and distinct clothing/props: vendor, neighbour, student with backpack, gardener, visitor, elder, worker and performer. They walk, pause, carry parcels, tend plants and perform idle activities. Populations are bounded and change with time of day; NPCs are decorative local simulations, not synchronized multiplayer agents.
- **Dance:** **J** performs the girl's Si Mee lamp sequence or the boy's shield-and-stick sequence inspired by the supplied Kyin board. These are artistic animations, not motion-captured or ethnographic reconstructions.
- **Touch:** phones and tablets automatically receive a joystick, drag-to-look area and action buttons. **Settings → Touch controls** can force these on or off for hybrid devices. New touch-device installations use Low graphics; saved preferences are preserved. Portrait, landscape, notches and tablet layouts are supported. Recent WebGL 2 browsers are required; physical-device performance varies.
- **Rooms:** **Play with friends → Create room**, share the six-character code, and **Back to game**. Friends select **Join room** and enter it. The host must keep the tab open. Up to eight players exchange bounded 12 Hz position/animation/car snapshots with interpolated rendering; slow channels drop snapshots rather than accumulating queues. No microphone or camera permissions are used. Public signaling availability, NAT/firewall restrictions and network latency can prevent a connection; dedicated TURN infrastructure is not configured. Homes, traffic and NPC simulation remain local. Rooms end when the host leaves.
- **Maps and streets:** the full map offers an online OpenStreetMap street basemap and a bundled game-map view. Names on the game map and 3D signposts use the 23 named streets in the source dataset. The selected location can be opened in Google Maps for comparison. Unnamed mapped roads remain unnamed rather than receiving guessed names.
- **Landmark fixes:** the clock model and its map marker now share the area centroid of its mapped roundabout (the original source point is retained). New tower colours follow photographic references. Vegetation and generated lights avoid pagoda courtyards, entrances and other landmark grounds. Courtyard fences leave stair entrances clear. Three explicitly mapped wall/fence lines are preserved from the PBF extract; this is not a complete survey of Sittwe property boundaries.

The five supplied PNG boards remain in the repository as design references. Runtime assets are Three.js geometry and procedural materials, not 3D meshes extracted from the PNGs. See [LANDMARK_SOURCES.md](LANDMARK_SOURCES.md) for evidence and remaining geographic limitations.

NPC citizens use 24 reference-inspired role designs, with block-built bodies, varied ages and outfits, patterned longyi and occupational props. Local routines include walking, gardening, reading, carrying, photography, waving and dance practice; population remains bounded for performance. The reference JPG also depicts transport and animals; those additional examples are not all implemented by the NPC redesign.

The discovery menu includes shortcuts to Lawkanandar, View Point and the clock tower. Touch buttons adapt to walking or driving, including vehicle reset, lights and handbrake. Adaptive resolution (enabled by default, optional in Graphics) lowers rendering resolution during sustained low frame rates and restores detail after sustained headroom; it does not change simulation or guarantee a frame rate.

For reliable rooms across different Wi-Fi/mobile networks, configure an active TURN relay using [relay-service/README.md](relay-service/README.md). The checked-in network configuration currently has no managed relay endpoint. Rooms → Test relay reports setup status; a successful allocation is not a substitute for testing two players on different networks.
