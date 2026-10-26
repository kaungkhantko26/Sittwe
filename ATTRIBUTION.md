# Attribution & licensing

## Map data

**© OpenStreetMap contributors.** Available under the [Open Database License (ODbL 1.0)](https://opendatacommons.org/licenses/odbl/1-0/). See https://www.openstreetmap.org/copyright.

- Used for roads, building footprints, coastline, water, land use, mapped trees and named landmarks and places.
- Current world data: Geofabrik OpenStreetMap extract for Myanmar (`myanmar-261025.osm.pbf`, OSM data as of 2026-10-25, https://download.geofabrik.de/asia/myanmar.html), cut to the game area locally. Earlier builds used the Overpass API. Sources and bounding boxes are recorded in `data/osm/*.json` and `data/geojson/meta.json`.
- The processed files in `public/data/` are a Derivative Database of OpenStreetMap and are distributed under the ODbL. The attribution is shown in the main menu, the About screen and the full-screen map.

## Building heights

This version uses **no external height dataset**. Heights are estimated from OSM building type and footprint area (documented in `src/geo/OSMParser.ts`). If a height dataset is added later, credit it here. Candidates:

- [3D-GloBFP](https://doi.org/10.5281/zenodo.15487037) (Che et al. 2024), CC BY 4.0.
- [GlobalBuildingAtlas](https://github.com/zhu-xlab/GlobalBuildingAtlas) (Zhu et al. 2025, TU Munich), CC BY-NC 4.0. **Non-commercial use only.**

## Software

| Package | License |
|---|---|
| three.js 0.186.1 | MIT |
| @dimforge/rapier3d-compat 0.21.0 | Apache-2.0 |
| maplibre-gl 6.16.0 | BSD-3-Clause |
| Vite 8.3.5, Vitest 5.0.5, TypeScript 7.0.2, tsx 4.23.15 | MIT / Apache-2.0 |

## Fonts (loaded from Google Fonts)

Noto Sans Myanmar, Inter, Saira Condensed and Share Tech Mono: SIL Open Font License 1.1.

## 3D models, textures and audio

All are generated procedurally in code by this project: the character, car, trees, stupa marker, facade textures, sky, water shader, and all sounds (via the Web Audio API). No third-party asset files are used.

## Not affiliated

This project is not affiliated with OpenTaxi, Google or any map provider. No proprietary code, models, textures or imagery from them are used.

## Added reference-driven features

The Het Laung house, electric flying sedan, NPC occupations, shield dance and cannon are procedural interpretations of the five design boards supplied by the user. The boards remain unchanged in the repository. Landmark research and uncertainty are recorded in [LANDMARK_SOURCES.md](LANDMARK_SOURCES.md).

Mapped boundary lines and street names are OpenStreetMap data under the attribution/license above. Online street-map tiles are served by OpenStreetMap and credited in the map. The selected-place Google Maps link opens a separate reference view; Google map data and imagery are not redistributed.

PeerJS (MIT) provides optional room signaling; WebRTC carries multiplayer snapshots. No audio/video capture is used. Rooms are browser-hosted sessions rather than an authoritative hosted game server.

The flag texture is the exact image supplied by the user (`public/assets/rakhine-flag.png`), replacing the previous generated flags.

The additional Sittwe NPC Asset Pack JPG supplied by the user guides the block-built citizen proportions, patterned longyi, clothing, occupational props and role animations. It is included unchanged as a reference, not as a ready-made mesh pack.
