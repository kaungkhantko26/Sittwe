import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { ChunkLandmark } from '../geo/chunkFormat';
import { projection } from '../geo/GeoProjection';
import { formatDistance } from './dom';
import { getLang, t } from './i18n';

/**
 * 2D maps rendered with MapLibre GL JS from the game's own locally cached
 * OSM-derived GeoJSON (public/data/geojson). No third-party tile service is
 * needed, so the map works offline and lines up exactly with the 3D world
 * (both use the same source geometry and the same projection origin).
 */

const DATA = `${import.meta.env.BASE_URL}data/geojson/`;

// Bundle MapLibre's web worker explicitly so it works in both dev and production builds.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

function mapStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      landuse: { type: 'geojson', data: `${DATA}landuse.geojson` },
      water: { type: 'geojson', data: `${DATA}water.geojson` },
      buildings: { type: 'geojson', data: `${DATA}buildings.geojson` },
      roads: { type: 'geojson', data: `${DATA}roads.geojson` },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#232a2f' } },
      {
        id: 'landuse',
        type: 'fill',
        source: 'landuse',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            ['park', 'grass', 'pitch', 'cemetery'],
            '#2e4a33',
            ['forest', 'orchard', 'scrub', 'wetland'],
            '#2a4430',
            ['farmland'],
            '#3b4630',
            ['sand', 'bare', 'mud'],
            '#4a4636',
            ['commercial', 'industrial', 'parking'],
            '#33363d',
            ['institutional', 'religious'],
            '#3a3a33',
            '#2b3134',
          ],
        },
      },
      { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#2f5267' } },
      { id: 'buildings', type: 'fill', source: 'buildings', minzoom: 14, paint: { 'fill-color': '#48505a', 'fill-outline-color': '#5a636e' } },
      {
        id: 'paths',
        type: 'line',
        source: 'roads',
        filter: ['in', ['get', 'cls'], ['literal', ['path', 'track', 'pedestrian', 'pier']]],
        paint: { 'line-color': '#8d8670', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 2], 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'roads',
        filter: ['!', ['in', ['get', 'cls'], ['literal', ['path', 'track', 'pedestrian', 'pier']]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'cls'], 'primary', '#f2c36b', 'secondary', '#e8d39a', 'tertiary', '#d9d2bc', '#b9b6ad'],
          'line-width': [
            'interpolate',
            ['exponential', 1.6],
            ['zoom'],
            13,
            ['match', ['get', 'cls'], 'primary', 2, 'secondary', 1.6, 'tertiary', 1.2, 0.6],
            18,
            ['match', ['get', 'cls'], 'primary', 16, 'secondary', 13, 'tertiary', 11, 7],
          ],
        },
      },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0b3a66', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 5, 18, 14] },
      },
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4fb3ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, 9] },
      },
    ],
  };
}

/** Canvas label images avoid a remote glyph service, including for Myanmar-script street names. */
async function addRoadLabels(map:maplibregl.Map,visible=true):Promise<void> {
 try {
  const src=map.getSource('roads') as maplibregl.GeoJSONSource;
  const data=await src.getData() as GeoJSON.FeatureCollection;
  const names=[...new Set(data.features.map(f=>f.properties?.['name']).filter((n):n is string=>typeof n==='string'&&n.length>0))];
  if(!names.length||map.getLayer('road-names'))return;
  const matches:unknown[]=['match',['get','name']];
  names.forEach((name,i)=>{
   const c=document.createElement('canvas');c.width=512;c.height=64;const g=c.getContext('2d')!;g.font='600 26px "Noto Sans Myanmar",sans-serif';g.textAlign='center';g.textBaseline='middle';g.lineWidth=5;g.strokeStyle='#17252b';g.fillStyle='#fff4d5';g.strokeText(name,256,32,500);g.fillText(name,256,32,500);
   const id=`road-name-${i}`;map.addImage(id,g.getImageData(0,0,512,64),{pixelRatio:2});matches.push(name,id);
  });matches.push('road-name-0');
  map.addLayer({id:'road-names',type:'symbol',source:'roads',minzoom:14.5,filter:['all',['has','name'],['!=',['get','name'],null]],layout:{'visibility':visible?'visible':'none','symbol-placement':'line','symbol-spacing':320,'icon-image':matches as maplibregl.ExpressionSpecification,'icon-size':.85,'icon-keep-upright':true,'icon-allow-overlap':false}},'route-casing');
 } catch(e){console.warn('[Map] road labels unavailable',e)}
}

/** Pushes a route (local meters) into a map's `route` source, waiting for the style if needed. */
function setRouteOn(map: maplibregl.Map, points: Array<[number, number]> | null): void {
  const apply = () => {
    const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: points ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(([x, z]) => lonLat(x, z)) } }] : [],
    });
  };
  if (map.isStyleLoaded()) apply();
  else map.once('load', apply);
}

export interface SearchEntry {
  kind: 'landmark' | 'place' | 'road';
  name: string;
  alt?: string;
  x: number;
  z: number;
}

function lonLat(x: number, z: number): [number, number] {
  return projection.xzToLonLat(x, z);
}

export class Minimap {
  readonly el: HTMLElement;
  private readonly map: maplibregl.Map;
  private readonly arrow: HTMLElement;
  private readonly northEl: HTMLElement;
  private destMarker: maplibregl.Marker | null = null;
  private zoom = 16.3;
  private lastUpdate = 0;
  rotate = false;
  ready = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    const mapDiv = document.createElement('div');
    mapDiv.className = 'minimap-canvas';
    this.arrow = document.createElement('div');
    this.arrow.className = 'player-arrow';
    this.northEl = document.createElement('div');
    this.northEl.className = 'minimap-north';
    this.northEl.textContent = 'N';
    this.el.append(mapDiv, this.arrow, this.northEl);
    parent.appendChild(this.el);
    const [lon, lat] = lonLat(0, 0);
    this.map = new maplibregl.Map({
      container: mapDiv,
      style: mapStyle(),
      center: [lon, lat],
      zoom: this.zoom,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    });
    this.map.on('load', () => (this.ready = true));
    this.map.on('error', (e) => console.warn('[Minimap]', e.error?.message ?? e));
  }

  zoomBy(d: number): void {
    this.zoom = Math.min(18.5, Math.max(13, this.zoom + d));
    this.map.setZoom(this.zoom);
  }

  /** Centres on the player. heading: degrees clockwise from north. */
  update(x: number, z: number, heading: number, now: number): void {
    if (now - this.lastUpdate < 50) return; // ~20 Hz is plenty for a minimap
    this.lastUpdate = now;
    const center = lonLat(x, z);
    if (this.rotate) {
      this.map.jumpTo({ center, bearing: heading, zoom: this.zoom });
      this.arrow.style.transform = 'translate(-50%, -50%) rotate(0deg)';
      this.northEl.style.transform = `rotate(${-heading}deg) translateY(-78px) rotate(${heading}deg)`;
    } else {
      this.map.jumpTo({ center, bearing: 0, zoom: this.zoom });
      this.arrow.style.transform = `translate(-50%, -50%) rotate(${heading}deg)`;
      this.northEl.style.transform = 'translateY(-78px)';
    }
  }

  setDestination(dest: { x: number; z: number } | null): void {
    this.destMarker?.remove();
    this.destMarker = null;
    if (!dest) return;
    const el = document.createElement('div');
    el.className = 'dest-marker small';
    this.destMarker = new maplibregl.Marker({ element: el }).setLngLat(lonLat(dest.x, dest.z)).addTo(this.map);
  }

  setRoute(points: Array<[number, number]> | null): void {
    setRouteOn(this.map, points);
  }

  private landmarkMarkers: maplibregl.Marker[] = [];

  /** Gold markers for major landmarks (pagoda complexes, shrines, monuments). */
  setLandmarks(list: Array<{ x: number; z: number; name: string; kind: 'pagoda' | 'shrine' | 'monument' }>): void {
    for (const m of this.landmarkMarkers) m.remove();
    this.landmarkMarkers = list.map((l) => {
      const el = document.createElement('div');
      el.className = `mm-landmark ${l.kind}`;
      el.title = l.name;
      el.textContent = l.kind === 'monument' ? '◆' : '▲';
      return new maplibregl.Marker({ element: el }).setLngLat(lonLat(l.x, l.z)).addTo(this.map);
    });
  }

  resize(): void {
    this.map.resize();
  }
}

export interface FullMapCallbacks {
  onSetDestination(x: number, z: number): void;
  onClearDestination(): void;
  onTeleport(x: number, z: number): void;
  onPreviewHome(x: number,z: number): void;
  onConfirmHome(): void;
  onCancelHome(): void;
  onGoHome(): void;
  onClose(): void;
  canTeleport(x: number, z: number): boolean;
}

/** Full-screen interactive map (M). Created lazily on first open. */
export class FullMap {
  readonly el: HTMLElement;
  private map: maplibregl.Map | null = null;
  private playerMarker: maplibregl.Marker | null = null;
  private destMarker: maplibregl.Marker | null = null;
  private readonly info: HTMLElement;
  private readonly list: HTMLElement;
  private readonly teleportBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private dest: { x: number; z: number } | null = null;
  private player = { x: 0, z: 0, heading: 0 };
  private landmarkMarkers: maplibregl.Marker[] = [];
  private routePoints: Array<[number, number]> | null = null;
  private search: SearchEntry[] = [];
  private readonly searchInput: HTMLInputElement;
  private readonly results: HTMLElement;
  private streetMap = true;

  constructor(
    parent: HTMLElement,
    private readonly cb: FullMapCallbacks,
    private readonly landmarks: ChunkLandmark[],
    private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'fullmap hidden';
    this.el.innerHTML = `
      <div class="fullmap-canvas"></div>
      <aside class="fullmap-side panel">
        <div class="fullmap-head"><h2 data-i18n="map"></h2><button class="btn icon close" aria-label="Close">✕</button></div>
        <input class="map-search" type="search" placeholder="Search places, roads, landmarks…" autocomplete="off" />
        <ul class="search-results"></ul>
        <button class="btn basemap-toggle">Show game map</button>
        <p class="tiny muted">Street map: OpenStreetMap (internet required). Game map: bundled map geometry.</p>
        <p class="muted small fullmap-hint"></p>
        <div class="fullmap-info"></div>
        <a class="btn google-reference" target="_blank" rel="noopener">View selected place in Google Maps ↗</a>
        <div class="row gap"><button class="btn primary teleport"></button><button class="btn clear"></button></div>
        <section class="home-map-panel">
          <h3>Your Rakhine home</h3>
          <p class="small muted">Search a ward or click the map. Choose an empty residential plot near a road.</p>
          <div class="row gap"><button class="btn home-check">Check home plot</button><button class="btn home-go">Go home</button></div>
          <p class="home-status small" role="status">Your home is stored locally in this browser.</p>
          <div class="row gap"><button class="btn primary home-confirm" disabled>Make this my home</button><button class="btn home-cancel">Cancel</button></div>
        </section>
        <h3 class="landmarks-title"></h3>
        <ul class="landmark-list"></ul>
        <p class="muted tiny attribution">© OpenStreetMap contributors (ODbL)</p>
      </aside>`;
    parent.appendChild(this.el);
    this.info = this.el.querySelector('.fullmap-info')!;
    this.list = this.el.querySelector('.landmark-list')!;
    this.teleportBtn = this.el.querySelector('.teleport')!;
    this.clearBtn = this.el.querySelector('.clear')!;
    this.searchInput = this.el.querySelector('.map-search')!;
    this.results = this.el.querySelector('.search-results')!;
    this.searchInput.addEventListener('input', () => this.runSearch());
    this.searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') (this.results.querySelector('li') as HTMLElement | null)?.click();
      if (e.key === 'Escape') this.cb.onClose();
    });
    this.el.querySelector('.basemap-toggle')!.addEventListener('click',()=>{this.streetMap=!this.streetMap;this.applyBasemap()});
    this.el.querySelector('.close')!.addEventListener('click', () => this.cb.onClose());
    this.teleportBtn.addEventListener('click', () => {
      if (this.dest && this.cb.canTeleport(this.dest.x, this.dest.z)) this.cb.onTeleport(this.dest.x, this.dest.z);
    });
    this.el.querySelector('.home-check')!.addEventListener('click',()=>{if(this.dest)this.cb.onPreviewHome(this.dest.x,this.dest.z);else this.setHomeStatus('Choose a place or map pin first.',false)});
    this.el.querySelector('.home-confirm')!.addEventListener('click',()=>this.cb.onConfirmHome());
    this.el.querySelector('.home-cancel')!.addEventListener('click',()=>this.cb.onCancelHome());
    this.el.querySelector('.home-go')!.addEventListener('click',()=>this.cb.onGoHome());
    this.clearBtn.addEventListener('click', () => {
      this.setDestination(null);
      this.cb.onClearDestination();
    });
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  open(player: { x: number; z: number; heading: number }, dest: { x: number; z: number } | null): void {
    this.player = player;
    this.el.classList.remove('hidden');
    this.refreshText();
    if (!this.map) this.createMap();
    else this.map.resize();
    const ll = lonLat(player.x, player.z);
    this.map!.jumpTo({ center: ll, zoom: 16 });
    this.updatePlayer(player);
    this.setDestination(dest);
  }

  close(): void {
    this.el.classList.add('hidden');
    this.searchInput.blur();
  }

  setSearchIndex(entries: SearchEntry[]): void {
    this.search = entries;
  }

  focusSearch(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  /** Case-insensitive substring search over names (English and Burmese/Rakhine script). */
  private runSearch(): void {
    const q = this.searchInput.value.trim().toLowerCase();
    this.results.innerHTML = '';
    if (q.length < 1) return;
    const scored = this.search
      .map((e) => {
        const n = e.name.toLowerCase();
        const a = (e.alt ?? '').toLowerCase();
        const pos = Math.min(...[n.indexOf(q), a.indexOf(q)].filter((i) => i >= 0), 999);
        return { e, score: pos === 999 ? -1 : (pos === 0 ? 0 : 10) + Math.hypot(e.x - this.player.x, e.z - this.player.z) / 1000 };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12);
    for (const { e } of scored) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="search-kind"></span><span class="lm-name"></span><span class="muted tiny lm-dist"></span>`;
      li.querySelector('.search-kind')!.textContent = e.kind;
      li.querySelector('.lm-name')!.textContent = e.alt ? `${e.name} · ${e.alt}` : e.name;
      li.querySelector('.lm-dist')!.textContent = formatDistance(Math.hypot(e.x - this.player.x, e.z - this.player.z));
      li.addEventListener('click', () => {
        this.map?.flyTo({ center: lonLat(e.x, e.z), zoom: 17 });
        this.setDestination({ x: e.x, z: e.z });
        this.cb.onSetDestination(e.x, e.z);
      });
      this.results.appendChild(li);
    }
    if (!scored.length) this.results.innerHTML = '<li class="muted">No results</li>';
  }

  setRoute(points: Array<[number, number]> | null): void {
    this.routePoints = points;
    if (this.map) setRouteOn(this.map, points);
  }

  private createMap(): void {
    const container = this.el.querySelector('.fullmap-canvas') as HTMLElement;
    const sw = lonLat(this.bounds.minX - 800, this.bounds.maxZ + 800);
    const ne = lonLat(this.bounds.maxX + 800, this.bounds.minZ - 800);
    this.map = new maplibregl.Map({
      container,
      style: mapStyle(),
      center: lonLat(this.player.x, this.player.z),
      zoom: 16,
      minZoom: 13,
      maxZoom: 19,
      maxBounds: [sw, ne],
      attributionControl: false,
      dragRotate: false,
    });
    this.map.on('load',()=>{this.applyBasemap();void addRoadLabels(this.map!,!this.streetMap);});
    this.map.on('error',e=>{if(((e as {sourceId?:string}).sourceId==='osm-streets'||/tile\.openstreetmap\.org/.test(e.error?.message??'')) && this.streetMap){this.streetMap=false;this.applyBasemap();this.el.querySelector('.fullmap-hint')!.textContent='Online street tiles are unavailable. Showing the bundled game map.';}});
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }), 'bottom-left');
    this.map.on('click', (e) => {
      const [x, z] = projection.lonLatToXZ(e.lngLat.lng, e.lngLat.lat);
      this.setDestination({ x, z });
      this.cb.onSetDestination(x, z);
    });
    const arrow = document.createElement('div');
    arrow.className = 'player-arrow big';
    this.playerMarker = new maplibregl.Marker({ element: arrow, rotationAlignment: 'map' }).setLngLat(lonLat(this.player.x, this.player.z)).addTo(this.map);
    this.buildLandmarks();
    if (this.routePoints) setRouteOn(this.map, this.routePoints);
  }

  private buildLandmarks(): void {
    for (const m of this.landmarkMarkers) m.remove();
    this.landmarkMarkers = [];
    this.list.innerHTML = '';
    const lang = getLang();
    const sorted = [...this.landmarks].sort((a, b) => Math.hypot(a.x - this.player.x, a.z - this.player.z) - Math.hypot(b.x - this.player.x, b.z - this.player.z));
    for (const lm of sorted) {
      const name = lang === 'rki' ? (lm.nl ?? lm.n) : (lm.ne ?? lm.n);
      const el = document.createElement('div');
      el.className = `lm-marker cat-${lm.cat}${lm.pg || lm.ms ? ' major' : ''}`;
      el.title = name;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.setDestination({ x: lm.x, z: lm.z });
        this.cb.onSetDestination(lm.x, lm.z);
      });
      if (this.map) this.landmarkMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(lonLat(lm.x, lm.z)).addTo(this.map));
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot cat-${lm.cat}"></span><span class="lm-name"></span><span class="muted tiny lm-dist"></span>`;
      li.querySelector('.lm-name')!.textContent = name;
      li.querySelector('.lm-dist')!.textContent = formatDistance(Math.hypot(lm.x - this.player.x, lm.z - this.player.z));
      li.addEventListener('click', () => {
        this.map?.flyTo({ center: lonLat(lm.x, lm.z), zoom: 17.2 });
        this.setDestination({ x: lm.x, z: lm.z });
        this.cb.onSetDestination(lm.x, lm.z);
      });
      this.list.appendChild(li);
    }
  }

  refreshText(): void {
    this.el.querySelector('[data-i18n="map"]')!.textContent = t('map');
    this.el.querySelector('.fullmap-hint')!.textContent = t('mapHint');
    this.el.querySelector('.landmarks-title')!.textContent = `${t('landmarks')} (${this.landmarks.length})`;
    this.teleportBtn.textContent = t('teleport');
    this.clearBtn.textContent = t('clearDestination');
    if (this.map) this.buildLandmarks();
    this.updateInfo();
  }

  updatePlayer(p: { x: number; z: number; heading: number }): void {
    this.player = p;
    this.playerMarker?.setLngLat(lonLat(p.x, p.z)).setRotation(p.heading);
    this.updateInfo();
  }

  setDestination(dest: { x: number; z: number } | null): void {
    this.dest = dest;
    this.destMarker?.remove();
    this.destMarker = null;
    if (dest && this.map) {
      const el = document.createElement('div');
      el.className = 'dest-marker';
      this.destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(lonLat(dest.x, dest.z)).addTo(this.map);
    }
    this.updateInfo();
  }

  private applyBasemap(): void {
    if(!this.map?.isStyleLoaded())return;
    if(!this.map.getSource('osm-streets')) {
      this.map.addSource('osm-streets',{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'});
      this.map.addLayer({id:'osm-streets',type:'raster',source:'osm-streets'},'landuse');
    }
    this.map.setLayoutProperty('osm-streets','visibility',this.streetMap?'visible':'none');
    for(const id of ['landuse','water','buildings','paths','roads',...(this.map.getLayer('road-names')?['road-names']:[])])this.map.setLayoutProperty(id,'visibility',this.streetMap?'none':'visible');
    this.el.querySelector('.basemap-toggle')!.textContent=this.streetMap?'Show game map':'Show real street map';
  }

  setHomeStatus(message: string, valid: boolean, plot?: {x: number;z: number}): void {
    this.el.querySelector('.home-status')!.textContent=message;
    (this.el.querySelector('.home-confirm') as HTMLButtonElement).disabled=!valid;
    if(!this.map)return;
    const source=this.map.getSource('home-preview') as maplibregl.GeoJSONSource | undefined;
    const data: GeoJSON.FeatureCollection={type:'FeatureCollection',features:plot?[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[lonLat(plot.x-7,plot.z-10),lonLat(plot.x+7,plot.z-10),lonLat(plot.x+7,plot.z+10),lonLat(plot.x-7,plot.z+10),lonLat(plot.x-7,plot.z-10)]]}}]:[]};
    if(source)source.setData(data);
    else if(this.map.isStyleLoaded()) {
      this.map.addSource('home-preview',{type:'geojson',data});
      this.map.addLayer({id:'home-preview-fill',type:'fill',source:'home-preview',paint:{'fill-color':'#e9b64f','fill-opacity':.45}});
      this.map.addLayer({id:'home-preview-line',type:'line',source:'home-preview',paint:{'line-color':'#ffe1a0','line-width':3}});
    }
  }

  private updateInfo(): void {
    const d = this.dest;
    const google=this.el.querySelector('.google-reference') as HTMLAnchorElement;
    const point=d??this.player,[gLng,gLat]=lonLat(point.x,point.z);
    google.href=`https://www.google.com/maps/search/?api=1&query=${gLat.toFixed(6)},${gLng.toFixed(6)}`;
    this.teleportBtn.disabled = !d || !this.cb.canTeleport(d.x, d.z);
    this.clearBtn.disabled = !d;
    if (!d) {
      this.info.textContent = '';
      return;
    }
    const dist = Math.hypot(d.x - this.player.x, d.z - this.player.z);
    const [lon, lat] = lonLat(d.x, d.z);
    this.info.innerHTML = `<div class="kv"><span>${t('destination')}</span><b>${formatDistance(dist)}</b></div><div class="muted tiny">${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E</div>`;
  }
}
