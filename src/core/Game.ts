import * as THREE from 'three';
import { insideBounds, WORLD_BOUNDS } from '../config';
import type { WorldManifest } from '../geo/chunkFormat';
import { headingFromDirection } from '../geo/GeoProjection';
import { MapDataLoader } from '../geo/MapDataLoader';
import { DayNightCycle } from '../lighting/DayNightCycle';
import { LightingManager } from '../lighting/LightingManager';
import { Weather } from '../lighting/Weather';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController, type PlayerInput } from '../player/PlayerController';
import { ThirdPersonCamera, type CameraMode, type VehicleCameraMode } from '../player/ThirdPersonCamera';
import { AudioManager } from '../systems/AudioManager';
import { Housing, HOME_FLOOR, type HomeLocation } from '../systems/Housing';
import { Pedestrians } from '../systems/Pedestrians';
import { Rooms } from '../systems/Rooms';
import { RemotePlayers } from '../systems/RemotePlayers';
import { syncedHours, type PlayerSnapshot, type RoomEnvironment } from '../systems/RoomProtocol';
import { roomPanel } from '../ui/RoomPanel';
import { Navigation } from '../systems/Navigation';
import { Discoveries } from '../systems/Discoveries';
import { kneelPose, PagodaVisitors } from '../systems/PagodaVisitors';
import { initGoldEnvironment, updateGoldEnvironment } from '../world/goldEnvironment';
import { pagodaLayout, PLATFORM_Y } from '../geo/pagodaLayout';
import type { PagodaSite } from '../world/landmarks/LawkanandarPagoda';
import { worldToGeo } from '../geo/GeoProjection';
import {AdaptiveResolution} from '../systems/AdaptiveResolution';
import { PerformanceManager } from '../systems/PerformanceManager';
import { SaveManager, type SaveData } from '../systems/SaveManager';
import { QUALITY_PRESETS, safeStorage, SettingsStore, type Settings } from '../systems/Settings';
import { showFatalError } from '../ui/errors';
import { FullMap, type SearchEntry } from '../ui/Minimap';
import { TouchControls } from '../ui/TouchControls';
import { HUD } from '../ui/HUD';
import { getLang, setLang, t } from '../ui/i18n';
import { aboutContent, controlsContent, LoadingScreen, MainMenu, Modal, PauseMenu } from '../ui/Screens';
import { settingsContent } from '../ui/SettingsPanel';
import { VehicleSystem } from '../vehicles/VehicleInteraction';
import type { DriveInput } from '../vehicles/VehiclePhysics';
import { TrafficSystem } from '../vehicles/Traffic';
import { WorldManager } from '../world/WorldManager';
import { GameLoop } from './GameLoop';
import { InputManager } from './InputManager';
import { Renderer } from './Renderer';

type GameState = 'boot' | 'menu' | 'playing' | 'paused' | 'map';

const AUTOSAVE_SECONDS = 30;
const RAD2DEG = 180 / Math.PI;

/**
 * Top-level orchestrator: owns every subsystem and the game state machine
 * (boot → menu → playing ⇄ paused / map).
 */
export class Game {
  private readonly renderer: Renderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly loop: GameLoop;
  private readonly input: InputManager;
  private readonly settings = new SettingsStore();
  private readonly saves = new SaveManager(safeStorage());
  private readonly perf = new PerformanceManager();
  private readonly audio = new AudioManager();
  private readonly cycle = new DayNightCycle();
  private readonly loading: LoadingScreen;
  private readonly modal: Modal;

  private riding=false;
  private roomEnvironment=false;
  private readonly ridePosition=new THREE.Vector3();
  private rideYaw=0;
  private physics!: PhysicsWorld;
  private world!: WorldManager;
  private housing!: Housing;
  private pedestrians!: Pedestrians;
  private rooms!:Rooms;
  private remotePlayers!:RemotePlayers;
  private roomBadge:HTMLButtonElement|null=null;
  private homeCandidate: HomeLocation | null = null;
  private homeRequest = 0;
  private lighting!: LightingManager;
  private weather!: Weather;
  private player!: PlayerController;
  private vehicles!: VehicleSystem;
  private cam!: ThirdPersonCamera;
  private hud!: HUD;
  private fullMap!: FullMap;
  private menu!: MainMenu;
  private adaptive=new AdaptiveResolution();
  private touchControls!:TouchControls;
  private pauseMenu!: PauseMenu;
  private manifest: WorldManifest | null = null;
  private beacon!: THREE.Mesh;
  private nav: Navigation | null = null;
  private readonly discoveries = new Discoveries();
  private visitors!: PagodaVisitors;
  private discoveryTimer = 0;
  /** Seated at a meditation mat (pose held until the player moves). */
  private sitting = false;
  /** Cinematic fly-around for "View architectural details". */
  private detailView: { cx: number; cz: number; r: number; h: number; t: number } | null = null;
  private photoRequested = false;
  private traffic: TrafficSystem | null = null;

  private state: GameState = 'boot';
  private mapReturn: GameState = 'playing';
  private suppressPause = false;
  private jumpQueued = false;
  private destination: { x: number; z: number } | null = null;
  private selectedVehicle = 0;
  private autosaveTimer = AUTOSAVE_SECONDS;
  private edgeWarnTimer = 0;
  private hintsVisible = true;
  private lastHour = -1;
  private readonly focus = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();

  constructor(
    viewport: HTMLElement,
    private readonly ui: HTMLElement,
  ) {
    const s = this.settings.get();
    setLang(s.language);
    const preset = QUALITY_PRESETS[s.quality];
    this.renderer = new Renderer(viewport, { antialias: preset.antialias, pixelRatio: preset.pixelRatio, shadows: preset.shadowMapSize > 0 });
    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.3, 4000);
    this.renderer.onResize((w, h) => {
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    });
    this.renderer.resize();
    this.input = new InputManager(this.renderer.canvas);
    this.loading = new LoadingScreen(ui);
    this.modal = new Modal(ui);
    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      update: (dt, alpha) => this.update(dt, alpha),
      render: () => {
        this.renderer.render(this.scene, this.camera);
        if (this.photoRequested) this.capturePhoto();
      },
    });

    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    this.renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestPointerLock();
    });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('beforeunload', () => {
      if (this.state === 'playing' || this.state === 'paused') this.saveGame(false);
    });
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    try {
      this.loading.set(0.04, 'Initializing physics (Rapier)…');
      this.physics = await PhysicsWorld.create(WORLD_BOUNDS);

      this.loading.set(0.12, 'Loading Sittwe map data…');
      const loader = new MapDataLoader();
      const manifest = await loader.manifest().catch((e: unknown) => {
        throw new Error(`Could not load the world manifest (${(e as Error).message}). If you are running from source, run "npm run data:all" first.`);
      });
      this.manifest = manifest;
      const sea = await loader.sea();
      const graphData = await loader.roadGraph();

      const s = this.settings.get();
      const preset = this.settings.preset;
      this.lighting = new LightingManager(this.scene, { shadowMapSize: preset.shadowMapSize, maxPointLights: preset.maxPointLights, fogFar: preset.fogFar });
      this.weather = new Weather(this.scene);
      this.world = new WorldManager(this.scene, this.physics, loader, manifest, sea, {
        viewRadius: preset.viewRadius,
        physicsRadius: preset.physicsRadius,
        detailRadius: preset.detailRadius,
        vegetationDensity: preset.vegetationDensity,
        lang: s.language,
      });
      const boundaries=await loader.boundaries();
      this.world.setBoundaries(boundaries);
      this.housing = new Housing(loader, manifest, sea, safeStorage(),boundaries);
      await this.housing.init();
      this.world.setHome(this.housing.home);
      this.pedestrians = new Pedestrians(this.scene,this.world);
      this.visitors = new PagodaVisitors(this.scene);
      initGoldEnvironment(this.renderer.three);
      const sp = { ...this.housing.home, yaw: Math.PI };
      this.player = new PlayerController(this.physics, s.playerName, sp.x, sp.z, s.character);
      this.player.teleport(sp.x,sp.z,sp.yaw,HOME_FLOOR);
      // The player can swim anywhere there is water (sea, ponds, canals); cars stay out of it.
      this.player.water = (x, z) => this.world.isBlocked(x, z);
      this.player.onSwimChange = (swimming) => {
        if (swimming && this.state === 'playing') this.hud.toast(`🏊 ${t('swimming')}`, 1.5);
      };
      this.player.anim.onFootstep = (running) => this.audio.footstep(running);
      this.player.anim.onStroke = () => this.audio.splash();
      this.scene.add(this.player.rig.root);
      this.vehicles = new VehicleSystem(this.scene, this.physics, manifest.spawn.vehicles);
      this.cam = new ThirdPersonCamera(this.camera, this.physics);
      this.beacon = createBeacon();
      this.scene.add(this.beacon);

      if (graphData) {
        this.nav = new Navigation(graphData, this.scene);
        this.traffic = new TrafficSystem(this.scene, this.physics, this.nav.graph);
        this.traffic.maxCars = preset.trafficCars;
      }
      this.remotePlayers=new RemotePlayers(this.scene);
      this.rooms=new Rooms(()=>this.networkSnapshot());
      this.rooms.onPlayers=players=>this.remotePlayers.receive(players);
    this.rooms.onSeats=seats=>this.remotePlayers.setSeats(seats);
    this.rooms.onRideMessage=message=>this.hud.toast(message,3);
    this.rooms.onRide=seat=>{
      if(seat){this.stopDance();this.ridePosition.copy(this.player.renderPos);this.riding=true;this.player.setActive(false);this.cam.snapBehind(this.player.yaw);this.hud.toast('Passenger seat — F to leave once stopped and landed',4);}
      else if(this.riding){this.riding=false;this.player.setActive(true);const p=this.ridePosition;const spot=this.world.findFreeSpot(p.x+Math.cos(this.rideYaw)*3,p.z-Math.sin(this.rideYaw)*3);this.player.teleport(spot.x,spot.z,this.rideYaw);this.cam.snapBehind(this.rideYaw);this.hud.toast('You left the passenger seat',2);}
    };
      this.rooms.onJoin=s=>void this.joinRoomAt(s);
      this.rooms.environment=()=>({hours:this.cycle.hours,dayLengthMinutes:this.cycle.dayLengthMinutes,rain:this.weather.target>0.5});
      this.rooms.onEnvironment=env=>this.applyRoomEnvironment(env);
      this.rooms.onChange=()=>{if(this.roomBadge)this.roomBadge.textContent=this.rooms.status};
      this.buildUi(manifest);
      if (this.nav) {
        this.nav.onRouteChanged = (pts) => {
          this.hud.minimap.setRoute(pts);
          this.fullMap.setRoute(pts);
        };
        this.fullMap.setSearchIndex(this.buildSearchIndex(manifest));
      }
      {
        const major = manifest.landmarks.filter((l) => l.pg || l.ms || ['clock', 'monument', 'memorial', 'viewpoint'].includes(l.k));
        this.hud.minimap.setLandmarks(major.map((l) => ({ x: l.x, z: l.z, name: l.ne ?? l.n, kind: l.pg ? 'pagoda' : l.ms ? 'shrine' : 'monument' })));
      }
      this.applySettings(s, null);
      this.loop.start();

      await this.world.prepareArea(sp.x, sp.z, 1, (done, total) => this.loading.set(0.2 + 0.78 * (done / Math.max(1, total)), `Building Sittwe from OpenStreetMap… ${done}/${total} chunks`));
      this.loading.set(1, 'Ready');
      this.loading.show(false);
      this.showMenu();
    } catch (err) {
      console.error(err);
      this.loading.show(false);
      showFatalError(this.ui, 'Sittwe 3D failed to load', err instanceof Error ? err.message : String(err));
    }
  }

  private buildUi(manifest: WorldManifest): void {
    this.hud = new HUD(this.ui, {
      onToggleMute: () => this.settings.update({ muted: !this.settings.get().muted }),
      onOpenSettings: () => {
        this.pause();
        this.openSettings();
      },
      onOpenMap: () => this.openMap(),
    });
    this.roomBadge=document.createElement('button');this.roomBadge.className='btn room-badge';this.roomBadge.textContent='Rooms · Solo play';this.roomBadge.addEventListener('click',()=>this.openRooms());this.hud.root.append(this.roomBadge);
    this.touchControls=new TouchControls(this.hud.root,this.input,{map:()=>this.openMap(),pause:()=>this.pause()});
    this.fullMap = new FullMap(
      this.ui,
      {
        onSetDestination: (x, z) => { this.cancelHomePreview(); this.setDestination({ x, z }); },
        onPreviewHome: (x,z) => void this.previewHomeAt(x,z),
        onConfirmHome: () => void this.confirmHome(),
        onCancelHome: () => this.cancelHomePreview(),
        onGoHome: () => { this.closeMap(); void this.goHome(); },
        onClearDestination: () => this.setDestination(null),
        onTeleport: (x, z) => this.teleportTo(x, z),
        onClose: () => this.closeMap(),
        canTeleport: (x, z) => insideBounds(manifest.bounds, x, z, 5) && !this.world.isBlocked(x, z),
      },
      manifest.landmarks,
      manifest.bounds,
    );
    this.menu = new MainMenu(this.ui, {
      onPlay: () => void this.startGame(false),
      onContinue: () => void this.startGame(true),
      onMap: () => this.openMap(),
      onSettings: () => this.openSettings(),
      onControls: () => this.modal.open(t('controls'), controlsContent()),
      onAbout: () => this.modal.open(t('about'), aboutContent(this.manifest)),
      onLanguage: () => this.settings.update({ language: getLang() === 'en' ? 'rki' : 'en' }),
      onCharacter: (c) => this.settings.update({ character: c }),
    });
    this.menu.setDestinations(manifest.landmarks.filter(l=>['node/1230796347','node/2318570031','node/4303580092'].includes(l.id)).map(l=>({name:l.ne??l.n,x:l.x,z:l.z})),(x,z)=>{void this.startGame(true).then(()=>this.teleportTo(x,z));});
    const roomsButton=document.createElement('button');roomsButton.className='btn menu-btn';roomsButton.textContent='Play with friends · Rooms';roomsButton.addEventListener('click',()=>this.openRooms());this.menu.el.querySelector('.menu-buttons')!.append(roomsButton);
    this.pauseMenu = new PauseMenu(this.ui, {
      onResume: () => this.resume(),
      onSave: () => this.saveGame(true),
      onSettings: () => this.openSettings(),
      onControls: () => this.modal.open(t('controls'), controlsContent()),
      onMap: () => this.openMap(),
      onMainMenu: () => {
        this.saveGame(false);
        this.pauseMenu.show(false);
        this.showMenu();
      },
      onReset: () => this.resetGame(),
    });
    this.settings.onChange((s, prev) => this.applySettings(s, prev));
  }

  /** Searchable places: named landmarks, neighbourhoods and roads (all from OSM). */
  private buildSearchIndex(m: WorldManifest): SearchEntry[] {
    const out: SearchEntry[] = [];
    for (const l of m.landmarks) {
      const local = l.nl ?? l.n;
      const en = l.ne ?? (local === l.n ? undefined : l.n);
      out.push({ kind: 'landmark', name: en ?? local, ...(en && local !== en ? { alt: local } : {}), x: l.x, z: l.z });
    }
    for (const p of m.places) {
      const local = p.nameLocal ?? p.name;
      out.push({ kind: 'place', name: p.nameEn ?? local, ...(p.nameEn && local !== p.nameEn ? { alt: local } : {}), x: p.x, z: p.z });
    }
    const g = this.nav?.graph.data;
    if (g) for (let i = 0; i < g.namePoints.length; i += 3) out.push({ kind: 'road', name: g.names[g.namePoints[i]!]!, x: g.namePoints[i + 1]!, z: g.namePoints[i + 2]! });
    return out;
  }

  private travelMode(): 'drive' | 'walk' {
    return this.vehicles?.driving ? 'drive' : 'walk';
  }

  private openSettings(): void {
    this.modal.open(
      t('settings'),
      settingsContent(this.settings, {
        getTimeOfDay: () => this.cycle.hours,
        setTimeOfDay: (h) => { if (!this.rooms?.followsHost) this.cycle.setHours(h); },
        environmentLocked: () => !!this.rooms?.followsHost,
        onResetGame: () => this.resetGame(),
      }),
    );
  }

  private applySettings(s: Settings, prev: Settings | null): void {
    const touch=s.touchControls==='on'||(s.touchControls==='auto'&&matchMedia('(pointer: coarse)').matches);
    document.documentElement.classList.toggle('touch-enabled',touch);document.documentElement.classList.toggle('touch-disabled',!touch);
    const preset = QUALITY_PRESETS[s.quality];
    if (!prev || prev.quality !== s.quality || prev.adaptiveResolution!==s.adaptiveResolution) {
      this.adaptive.reset();
      this.renderer.setPixelRatio(preset.pixelRatio);
      this.renderer.setShadows(preset.shadowMapSize > 0);
      this.renderer.resize();
      this.lighting.applyOptions({ shadowMapSize: preset.shadowMapSize, maxPointLights: preset.maxPointLights, fogFar: preset.fogFar });
      if (this.traffic) this.traffic.maxCars = preset.trafficCars;
      this.world.setOptions({ viewRadius: preset.viewRadius, physicsRadius: preset.physicsRadius, detailRadius: preset.detailRadius, vegetationDensity: preset.vegetationDensity });
      // Shadow-casting flags changed: force material/program refresh.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    }
    this.cam.sensitivity = s.mouseSensitivity;
    this.cam.invertY = s.invertY;
    this.cam.distance = s.cameraDistance;
    if (this.camera.fov !== s.fov) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    // In a room, joiners keep the host's clock speed and weather until they leave.
    if (!this.rooms?.followsHost) {
      this.cycle.dayLengthMinutes = s.dayLengthMinutes;
      this.weather.target = s.rain ? 1 : 0;
    }
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambienceVolume, s.muted);
    this.hud.minimap.rotate = s.minimapRotate;
    if (prev && prev.playerName !== s.playerName) this.player.setName(s.playerName);
    if (prev && prev.character !== s.character) {
      this.stopDance();
      this.player.setCharacter(s.character, s.playerName);
    }
    this.menu.setCharacter(s.character);
    if (!prev || prev.language !== s.language) {
      setLang(s.language);
      this.world.setOptions({ lang: s.language });
      this.menu.refreshText();
      this.pauseMenu.refreshText();
      this.hud.refreshText(!!this.vehicles.driving);
      this.fullMap.refreshText();
    }
  }

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  private showMenu(): void {
    this.state = 'menu';
    this.hud.show(false);
    this.menu.setContinueEnabled(this.saves.load().ok);
    this.menu.refreshText();
    this.menu.show(true);
    this.input.clearTouch();
    this.input.exitPointerLock();
  }

  private async startGame(fromSave: boolean): Promise<void> {
    void this.audio.start();
    const m = this.manifest!;
    let save: SaveData | null = null;
    if (fromSave) {
      const res = this.saves.load();
      if (res.ok) save = res.data;
      else if (res.reason !== 'none') this.hud.toast(t('corruptSave'), 4);
    }
    const target = save ? save.player : { ...this.housing.home, y: HOME_FLOOR, yaw: Math.PI };
    this.menu.show(false);
    this.loading.show(true);
    this.loading.set(0, t('loading'));
    if (this.vehicles.driving) this.exitVehicle(true);
    await this.world.prepareArea(target.x, target.z, 1, (d, total) => this.loading.set(d / Math.max(1, total), `${t('loading')}… ${d}/${total}`));
    this.loading.show(false);

    if (save) {
      this.vehicles.restore(save.vehicles);
      const spot = this.world.findFreeSpot(save.player.x, save.player.z);
      const atHome=Math.abs(save.player.x-this.housing.home.x)<4.2 && Math.abs(save.player.z-this.housing.home.z)<4.2;
      this.player.teleport(atHome?save.player.x:spot.x,atHome?save.player.z:spot.z,save.player.yaw,atHome?Math.max(HOME_FLOOR,save.player.y):0);
      this.cycle.setHours(save.timeOfDay);
      this.cam.yaw = save.camera.yaw;
      this.cam.pitch = save.camera.pitch;
      this.cam.mode = (['third', 'first', 'cinematic'].includes(save.camera.mode) ? save.camera.mode : 'third') as CameraMode;
      this.cam.vehicleMode = (['chase', 'far', 'hood', 'cinematic'].includes(save.camera.vehicleMode) ? save.camera.vehicleMode : 'chase') as VehicleCameraMode;
      this.selectedVehicle = save.selectedVehicle;
      this.setDestination(save.destination);
      if (save.drivingVehicle !== null) {
        const v = this.vehicles.vehicles[save.drivingVehicle];
        if (v) this.enterVehicle(v);
      }
    } else {
      m.spawn.vehicles.forEach((v, i) => this.vehicles.vehicles[i]?.reset(v.x, v.z, v.yaw));
      this.player.teleport(this.housing.home.x,this.housing.home.z,Math.PI,HOME_FLOOR);
      this.cycle.setHours(8.5);
      this.cam.mode = 'first';
      this.cam.pitch = 0.3;
      this.setDestination(null);
    }
    this.cam.snapBehind(this.vehicles.driving ? this.vehicles.driving.yaw : this.player.yaw);
    this.state = 'playing';
    this.autosaveTimer = AUTOSAVE_SECONDS;
    this.hud.show(true);
    this.hud.refreshText(!!this.vehicles.driving);
    this.input.requestPointerLock();
    this.hud.toast(document.documentElement.classList.contains('touch-enabled')?'Left stick to move · Drag the right side to look · Map to return home':t('clickToPlay'), 5);
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.stopDanceMusic();
    this.pauseMenu.show(true);
    this.input.clearTouch();
    this.input.exitPointerLock();
    this.audio.suspend();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.modal.close();
    this.pauseMenu.show(false);
    this.state = 'playing';
    this.audio.resume();
    if (this.player.anim.dancing) this.audio.startDanceMusic();
    void this.audio.start();
    this.input.requestPointerLock();
  }

  private openMap(): void {
    if (this.state === 'map') return;
    this.mapReturn = this.state === 'boot' ? 'menu' : this.state;
    this.suppressPause = true;
    this.input.clearTouch();
    this.input.exitPointerLock();
    this.state = 'map';
    this.pauseMenu.show(false);
    this.menu.show(false);
    const p = this.focusPoint();
    this.fullMap.open({ x: p.x, z: p.z, heading: this.facingHeading() }, this.destination);
  }

  private closeMap(): void {
    if (this.state !== 'map') return;
    this.cancelHomePreview();
    this.fullMap.close();
    this.suppressPause = false;
    if (this.mapReturn === 'menu') {
      this.state = 'menu';
      this.menu.show(true);
    } else if (this.mapReturn === 'paused') {
      this.state = 'paused';
      this.pauseMenu.show(true);
    } else {
      this.state = 'playing';
      this.input.requestPointerLock();
    }
  }

  private onPointerLockChange(): void {
    if (this.input.isPointerLocked()) {
      this.suppressPause = false;
      return;
    }
    if (this.state === 'playing' && !this.suppressPause) this.pause();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'F5' && (this.state === 'playing' || this.state === 'paused')) {
      e.preventDefault();
      this.saveGame(true);
      return;
    }
    if (e.code === 'Escape') {
      if (this.modal.isOpen) this.modal.close();
      else if (this.state === 'map') this.closeMap();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'playing') this.pause();
      return;
    }
    if (e.code === 'Slash' && (this.state === 'playing' || this.state === 'paused' || this.state === 'menu')) {
      e.preventDefault();
      this.openMap();
      this.fullMap.focusSearch();
      return;
    }
    if (e.code === 'KeyP' && this.state === 'playing') {
      this.photoRequested = true;
      return;
    }
    if (e.code === 'KeyM') {
      if (this.state === 'map') this.closeMap();
      else if (this.state === 'playing' || this.state === 'paused') this.openMap();
    }
  }

  private resetGame(): void {
    if (!window.confirm(t('resetConfirm'))) return;
    this.saves.clear();
    this.discoveries.clear();
    this.modal.close();
    this.pauseMenu.show(false);
    if (this.state === 'menu') {
      this.menu.setContinueEnabled(false);
      return;
    }
    void this.startGame(false);
  }

  // -------------------------------------------------------------------------
  // Gameplay actions
  // -------------------------------------------------------------------------

  private enterVehicle(v: VehicleSystem['vehicles'][number]): void {
    this.stopDance();
    this.vehicles.enter(v, this.cycle.compute().night > 0.4);
    this.selectedVehicle = Math.max(0, this.vehicles.vehicles.indexOf(v));
    this.player.setActive(false);
    this.cam.snapBehind(v.yaw);
    this.hud.refreshText(true);
  }

  private exitVehicle(force = false): void {
    const v = this.vehicles.driving;
    if (!v) return;
    if(!force && v.physics.flying && v.position.y>1.5){this.hud.toast('Land before leaving the vehicle — G to descend',2);return;}
    if (!force && v.speedKmh > 25) {
      this.hud.toast('Slow down to exit', 1.5);
      return;
    }
    const pos = this.vehicles.exit((x, z) => this.world.isOccupied(x, z, 0.35));
    this.player.setActive(true);
    if (pos.y > 0) {
      // No room beside the car: step out at the nearest clear spot instead of onto the roof.
      const spot = this.world.findFreeSpot(pos.x, pos.z);
      this.player.teleport(spot.x, spot.z, pos.yaw);
    } else this.player.teleport(pos.x, pos.z, pos.yaw, pos.y);
    this.cam.snapBehind(pos.yaw);
    this.hud.refreshText(false);
  }

  private setDestination(d: { x: number; z: number } | null): void {
    // Pagoda complexes: navigate to the bottom of the main staircase, not the stupa centre.
    if (d) d = this.pagodaEntrance(d.x, d.z) ?? d;
    this.destination = d;
    this.hud.minimap.setDestination(d);
    this.beacon.visible = !!d;
    if (d) this.beacon.position.set(d.x, 0, d.z);
    if (this.nav) {
      const p = this.focusPoint();
      const ok = this.nav.navigate(p.x, p.z, d, this.travelMode());
      if (!ok && d) this.hud.toast('No road route found — showing straight-line distance', 3);
    }
  }

  /** Joiners follow the room host's time of day, day speed and rain; their own settings return when they leave. */
  private applyRoomEnvironment(env:RoomEnvironment|null):void {
    if(env){
      const first=!this.roomEnvironment;this.roomEnvironment=true;
      this.cycle.setHours(syncedHours(this.cycle.hours,env.hours));
      this.cycle.dayLengthMinutes=env.dayLengthMinutes;
      this.weather.target=env.rain?1:0;
      if(first)this.hud.toast('Time and weather now follow the room host',3);
      return;
    }
    if(!this.roomEnvironment)return;
    this.roomEnvironment=false;
    const s=this.settings.get();
    this.cycle.dayLengthMinutes=s.dayLengthMinutes;
    this.weather.target=s.rain?1:0;
  }

  private networkSnapshot():PlayerSnapshot {
    const v=this.vehicles.driving,p=v?v.position:this.riding?this.ridePosition:this.player.position,s=this.settings.get();
    return {seq:0,name:s.playerName.slice(0,32),character:s.character,x:p.x,y:v||this.riding?p.y:this.player.renderPos.y,z:p.z,yaw:v?v.yaw:this.riding?this.rideYaw:this.player.yaw,speed:v?Math.abs(v.physics.forwardSpeed()):this.player.groundSpeed,dancing:this.player.anim.dancing,vehicle:v?{x:p.x,y:p.y,z:p.z,yaw:v.yaw,flying:v.physics.flying,id:v.id,color:v.color,headlights:v.headlightsOn,braking:v.physics.braking,qx:v.quaternion.x,qy:v.quaternion.y,qz:v.quaternion.z,qw:v.quaternion.w}:null};
  }

  private openRooms():void {
    if(this.state==='playing')this.pause();
    this.modal.open('Play with friends',roomPanel(this.rooms,()=>{
      this.modal.close();if(this.state==='menu')void this.startGame(false);else if(this.state==='paused')this.resume();
    }));
  }

  private async joinRoomAt(s:PlayerSnapshot):Promise<void> {
    this.modal.close();
    if(this.state==='menu')await this.startGame(false);else if(this.state==='paused')this.resume();
    this.teleportTo(s.x+3,s.z+3);
  }

  private cancelHomePreview(): void {
    this.homeRequest++;
    this.homeCandidate=null;
    this.world.previewHome(null);
    this.fullMap?.setHomeStatus('Choose a map pin or search a place, then check a residential plot.',false);
  }

  private async previewHomeAt(x: number,z: number): Promise<void> {
    const request=++this.homeRequest;
    this.homeCandidate=null;this.world.previewHome(null);
    this.fullMap.setHomeStatus('Checking residential land, roads, water and buildings…',false);
    try {
      const p={x,z};const reason=await this.housing.validate(p);
      if(request!==this.homeRequest)return;
      if(reason){this.fullMap.setHomeStatus(reason,false);return;}
      await this.world.prepareArea(x,z,1);
      if(request!==this.homeRequest)return;
      this.homeCandidate=p;this.world.previewHome(p);
      this.fullMap.setHomeStatus('Clear residential plot: 14 × 20 m. Preview the footprint on the map, then make this your home.',true,p);
    } catch {if(request===this.homeRequest)this.fullMap.setHomeStatus('Could not load this area. Please try again.',false);}
  }

  private async confirmHome(): Promise<void> {
    const p=this.homeCandidate;if(!p)return;
    const request=++this.homeRequest;
    this.fullMap.setHomeStatus('Saving your home…',false);
    try {
      const reason=await this.housing.validate(p);
      if(request!==this.homeRequest)return;
      if(reason){this.fullMap.setHomeStatus(reason,false);return;}
      if(!this.housing.commit(p)){this.fullMap.setHomeStatus('Browser storage is unavailable. Your existing home is unchanged.',true,p);return;}
      this.world.setHome(p);this.cancelHomePreview();this.closeMap();
      await this.goHome();
      this.saveGame(false);this.hud.toast('Your Rakhine home is saved on this browser. M → Go home returns here.',5);
    } catch {this.fullMap.setHomeStatus('Could not save this plot. Please try again.',true,p);}
  }

  private async goHome(): Promise<void> {
    if(this.riding)this.rooms.leaveRide();
    if(this.vehicles.driving)this.exitVehicle(true);
    const p=this.housing.home;
    await this.world.prepareArea(p.x,p.z,1);
    this.player.teleport(p.x,p.z,Math.PI,HOME_FLOOR);
    this.cam.mode='first';this.cam.snapBehind(Math.PI);this.setDestination(null);
  }

  private teleportTo(x: number, z: number): void {
    if(this.riding)this.rooms.leaveRide();
    if (this.vehicles.driving) this.exitVehicle(true);
    this.loading.show(true);
    void this.world.prepareArea(x, z, 1, (d, total) => this.loading.set(d / Math.max(1, total), `${t('loading')}… ${d}/${total}`)).then(() => {
      this.loading.show(false);
      const spot = this.world.findFreeSpot(x, z);
      this.player.teleport(spot.x, spot.z);
      this.cam.snapBehind(this.player.yaw);
      this.setDestination(null);
      this.closeMap();
    });
  }

  private saveGame(notify: boolean): void {
    if (!this.manifest || this.state === 'boot' || this.state === 'menu') return;
    const p = this.riding?this.ridePosition:this.vehicles.driving ? this.vehicles.driving.position : this.player.position;
    const ok = this.saves.save({
      player: { x: p.x, y: Math.max(0,p.y-0.98), z: p.z, yaw: this.player.yaw },
      drivingVehicle: this.vehicles.driving ? this.vehicles.vehicles.indexOf(this.vehicles.driving) : null,
      selectedVehicle: this.selectedVehicle,
      vehicles: this.vehicles.snapshot(),
      timeOfDay: this.cycle.hours,
      camera: { yaw: this.cam.yaw, pitch: this.cam.pitch, distance: this.cam.distance, mode: this.cam.mode, vehicleMode: this.cam.vehicleMode },
      destination: this.destination,
    });
    if (notify) this.hud.toast(ok ? t('saved') : t('saveFailed'), 2);
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  private focusPoint(): THREE.Vector3 {
    if(this.riding)return this.focus.copy(this.ridePosition);
    if (this.vehicles?.driving) return this.focus.copy(this.vehicles.driving.position);
    if (this.player) return this.focus.copy(this.player.renderPos.lengthSq() > 0 ? this.player.renderPos : this.player.position);
    return this.focus.set(0, 0, 0);
  }

  /** Heading (deg) of the player or driven car. */
  private facingHeading(): number {
    const yaw = this.vehicles.driving ? this.vehicles.driving.yaw : this.player.yaw;
    return (((-yaw * RAD2DEG) % 360) + 360) % 360;
  }

  private fixedUpdate(dt: number): void {
    if (this.state !== 'playing') return;
    const inp = this.input;
    const driving = this.vehicles.driving;
    const drive: DriveInput = driving
      ? { throttle: Math.max(inp.isDown('KeyW') || inp.isDown('ArrowUp') ? 1 : 0,-inp.touchMove.y), brake: Math.max(inp.isDown('KeyS') || inp.isDown('ArrowDown') ? 1 : 0,inp.touchMove.y), steer: inp.axis('KeyD', 'KeyA') + inp.axis('ArrowRight', 'ArrowLeft') - inp.touchMove.x, handbrake: inp.isDown('KeyX'), lift:inp.isDown('Space'), descend:inp.isDown('ControlLeft')||inp.isDown('ControlRight'), boost:inp.isDown('ShiftLeft')||inp.isDown('ShiftRight') }
      : { throttle: 0, brake: 0, steer: 0, handbrake: false };
    drive.steer = Math.max(-1, Math.min(1, drive.steer));
    this.vehicles.fixedUpdate(dt, drive);

    if (!driving&&!this.riding) {
      const fwd = inp.axis('KeyS', 'KeyW') + inp.axis('ArrowDown', 'ArrowUp') - inp.touchMove.y;
      const right = inp.axis('KeyA', 'KeyD') + inp.axis('ArrowLeft', 'ArrowRight') + inp.touchMove.x;
      const yaw = this.cam.yaw;
      // Camera-relative movement: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
      const pi: PlayerInput = {
        moveX: -Math.sin(yaw) * fwd + Math.cos(yaw) * right,
        moveZ: -Math.cos(yaw) * fwd - Math.sin(yaw) * right,
        sprint: inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'),
        jump: this.jumpQueued,
      };
      this.jumpQueued = false;
      this.player.fixedUpdate(dt, pi);
    }
    if (this.traffic) {
      const p = driving ? driving.position : this.player.position;
      const obstacles: Array<[number, number]> = [[p.x, p.z],...this.vehicles.vehicles.filter(v=>v.position.y<3).map(v=>[v.position.x,v.position.z] as [number,number])];
      this.traffic.fixedUpdate(dt, p.x, p.z, obstacles, (x, z) => !this.world.isOccupied(x, z, 2));
    }
    this.physics.step();
    this.vehicles.postStep(dt, (x, z) => this.world.isBlocked(x, z));
  }

  private update(dt: number, alpha: number): void {
    this.perf.frame(dt);
    if(this.state==='playing'&&!document.hidden&&this.settings.get().adaptiveResolution){
      const scale=this.adaptive.sample(dt);if(scale!==null){this.renderer.setPixelRatio(QUALITY_PRESETS[this.settings.get().quality].pixelRatio*scale);this.renderer.resize();}
    }

    if(this.rooms){this.rooms.update(dt);const p=this.focusPoint();this.remotePlayers.update(dt,p.x,p.z,this.cycle.compute().night);}
    if(this.riding&&this.rooms.ride){const pose=this.remotePlayers.ridePose(this.rooms.ride.driverId);if(pose){this.ridePosition.copy(pose.position);this.rideYaw=pose.yaw;}}
    if (this.state === 'boot' && !this.world) return;
    const inp = this.input;

    if (this.state === 'playing') this.handleActions();

    // Visual interpolation.
    if (this.player) this.player.update(dt, this.state === 'playing' ? alpha : 1);
    if (this.vehicles) this.vehicles.update(dt, this.state === 'playing' ? alpha : 1);
    if (this.traffic) this.traffic.update(dt, this.cycle.compute().night > 0.4);

    const menuLike = this.state === 'menu' || this.state === 'boot' || (this.state === 'map' && this.mapReturn === 'menu');
    const spawn = this.manifest?.spawn.player ?? { x: 0, z: 0 };
    const focus = menuLike ? this.tmpV.set(spawn.x, 0, spawn.z) : this.focusPoint();

    if (this.world) this.world.update(dt, focus.x, focus.z);

    if (this.cam) {
      if (menuLike) {
        if(!this.modal.isOpen)this.cam.menuOrbit(dt, focus);
        inp.consumeMouse();inp.consumeWheel();
      } else if (this.state === 'playing' && this.detailView) {
        this.updateDetailView(dt);
      } else if (this.state === 'playing') {
        const m = inp.consumeMouse();
        this.cam.input(m.dx, m.dy, inp.consumeWheel());
        const driving = this.vehicles.driving;
        const pivot = this.riding?this.ridePosition.clone().add(new THREE.Vector3(0,1.2,0)):driving ? this.tmpV.copy(driving.visual.root.position).add(new THREE.Vector3(0, 1.2, 0)) : this.player.renderPos.clone().add(new THREE.Vector3(0, this.cam.isFirstPerson ? this.player.headHeight : this.player.pivotHeight, 0));
        this.cam.update(dt, {
          pivot,
          heading: driving ? driving.yaw : this.riding?this.rideYaw:this.player.yaw,
          speed: driving ? Math.abs(driving.physics.forwardSpeed()) : 0,
          inVehicle: !!driving||this.riding,
          ignore: [this.player.collider, ...this.vehicles.colliders, ...(this.traffic?.colliders() ?? [])],
        });
        this.player.setVisible(!this.cam.isFirstPerson || !!driving);
        if (this.cam.isFirstPerson && !driving&&!this.riding) this.player.faceYaw(this.cam.yaw);
      } else {
        inp.consumeMouse();
        inp.consumeWheel();
      }
    }

    // Lighting & weather.
    if (this.state === 'playing' || menuLike) this.cycle.update(dt);
    this.cycle.overcast = this.weather ? this.weather.amount : 0;
    const ls = this.cycle.compute();
    updateGoldEnvironment(ls.day, ls.night);
    if (this.lighting) {
      this.lighting.update(dt, ls, focus, this.camera, this.renderer.three, (x, z, r, n) => this.world.lampsNear(x, z, r, n), this.weather.amount);
      this.weather.update(dt, this.camera.position);
    }
    if (this.beacon?.visible) {
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.15 * Math.sin(performance.now() / 300);
    }

    if (this.state === 'playing' || this.state === 'paused') this.updateHud(dt, ls.day);
    if (this.state === 'playing') {
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = AUTOSAVE_SECONDS;
        this.saveGame(false);
      }
    }
    // Hourly chime from the Old (colonial) Clock Tower when the player is within earshot.
    const hour = Math.floor(this.cycle.hours);
    if (this.state === 'playing' && this.lastHour >= 0 && hour !== this.lastHour) {
      const p = this.focusPoint();
      for (const lm of this.manifest?.landmarks ?? []) {
        if (lm.k !== 'clock' || lm.cs !== 'colonial') continue;
        const d = Math.hypot(lm.x - p.x, lm.z - p.z);
        if (d < 400) this.audio.chime(Math.max(0.15, 1 - d / 400));
      }
    }
    this.lastHour = hour;
    if(this.state==='playing') {
      const focus=this.focusPoint();
      this.pedestrians.maxPeople=this.settings.get().quality==='low'?8:18;
      this.pedestrians.update(Math.min(dt,.05),focus.x,focus.z,this.cycle.hours);
      this.visitors.maxPerSite = this.settings.get().quality === 'low' ? 4 : 8;
      this.visitors.update(Math.min(dt, 0.05), this.world.pagodaSites(), focus.x, focus.z, this.cycle.hours);
      this.updateDiscoveries(dt, focus.x, focus.z);
      if (this.sitting) kneelPose(this.player.rig, performance.now() / 1000);
    }
    if (this.state === 'map') {
      const p = this.focusPoint();
      this.fullMap.updatePlayer({ x: p.x, z: p.z, heading: this.facingHeading() });
    }
    inp.endFrame();
  }

  private handleActions(): void {
    const inp = this.input;
    const driving = this.vehicles.driving;
    if(this.riding){
      if(inp.wasPressed('KeyF')){const pose=this.rooms.ride&&this.remotePlayers.ridePose(this.rooms.ride.driverId);if(pose&&(pose.state.vehicle?.flying||pose.state.speed>2))this.hud.toast('Ask the driver to stop and land before leaving',3);else this.rooms.leaveRide();}
      if(inp.wasPressed('KeyC'))this.cam.cycleMode(true);
      if(inp.wasPressed('Escape'))this.pause();
      return;
    }
    if (inp.wasPressed('Space') && !driving) this.jumpQueued = true;
    if (inp.wasPressed('KeyF')) {
      if (driving) this.exitVehicle();
      else {
        const ride=this.remotePlayers.nearestRide(this.player.position);
        if(ride){this.rooms.requestRide(ride.id);return;}
        const v = this.vehicles.nearest(this.player.position);
        if (v) this.enterVehicle(v);
        else if (this.traffic) {
          // Take over a passing traffic car: it becomes a normal drivable car.
          const i = this.traffic.nearest(this.player.position.x, this.player.position.z, 2.6);
          if (i >= 0) {
            const t0 = this.traffic.takeOver(i);
            this.enterVehicle(this.vehicles.spawnAt(t0.x, t0.z, t0.yaw, t0.color));
          }
        }
      }
    }
    if (inp.wasPressed('KeyV') && !driving) this.spawnCarNearby();
    // Si Mee (ဆီမီး) oil-lamp dance — performed by the Rakhine Girl.
    if (inp.wasPressed('KeyJ') && !driving) {
      if (this.player.anim.dancing) this.stopDance();
      else if (this.player.swimming || !this.player.isGrounded) this.hud.toast('Find solid ground to dance', 2);
      else {
        this.player.anim.startDance();
        this.audio.startDanceMusic();
        this.cam.snapBehind(this.player.yaw + Math.PI); // face the dancer
        this.hud.toast(this.player.character==='boy'?'Kyin-inspired shield dance — J or move to stop':'ဆီမီး Si Mee lamp dance — J or move to stop', 3);
      }
    }
    if (this.player.anim.dancing && (inp.isDown('KeyW') || inp.isDown('KeyA') || inp.isDown('KeyS') || inp.isDown('KeyD') || inp.isDown('Space') || Math.hypot(inp.touchMove.x,inp.touchMove.y)>.2)) this.stopDance();
    if (inp.wasPressed('KeyC')) this.hud.toast(`${t('cameraMode')}: ${this.cam.cycleMode(!!driving)}`, 1.2);
    if(inp.wasPressed('KeyG') && driving){driving.physics.toggleFlight();this.hud.toast(driving.physics.landing?'Landing — keep clear of buildings':driving.physics.flying?'Flight: Space up · Ctrl down · WASD steer · G land':'Ground drive',3);}
    if (inp.wasPressed('KeyL') && driving) this.vehicles.toggleHeadlights();
    if (inp.wasPressed('KeyR') && driving) {
      this.vehicles.resetDriven();
      this.hud.toast(t('carReset'), 1.5);
    }
    if (inp.wasPressed('KeyH')) {
      this.hintsVisible = !this.hintsVisible;
      this.ui.classList.toggle('hide-hints', !this.hintsVisible);
    }
    if (inp.wasPressed('KeyE') && !driving && this.world.nearHomeDoor(this.player.position.x,this.player.position.z)) {
      this.world.toggleHomeDoor();
    } else if (inp.wasPressed('KeyE') && !driving && this.pedestrians.nearby(this.player.position.x,this.player.position.z)) {
      this.hud.toast(this.pedestrians.nearby(this.player.position.x,this.player.position.z)!,3);
    } else if (inp.wasPressed('KeyE') && !driving && this.nearPagoda()) {
      const site = this.nearPagoda()!;
      const mat = this.nearMat(site);
      if (this.sitting) this.standUp();
      else if (mat) this.sitAt(mat);
      else this.openPagodaInfo(site);
    } else if (inp.wasPressed('KeyE') && !driving) {
      const lm = this.nearestLandmark(25);
      if (lm) this.hud.toast(`${lm.name} — ${lm.cat}`, 3);
    }
    if (this.sitting && (inp.isDown('KeyW') || inp.isDown('KeyA') || inp.isDown('KeyS') || inp.isDown('KeyD') || inp.isDown('Space'))) this.standUp();
  }

  private stopDance(): void {
    this.player.anim.stopDance();
    this.audio.stopDanceMusic();
  }

  /** Spawns a drivable car in the nearest road lane (keeps at most 4 player-spawned cars). */
  private spawnCarNearby(): void {
    const p = this.player.position;
    const g = this.nav?.graph;
    let x = p.x + 3;
    let z = p.z;
    let yaw = this.player.yaw;
    if (g) {
      const n = g.nearestNode(p.x, p.z, 'drive', 80);
      const nb = n >= 0 ? g.neighbors(n, 'drive') : [];
      if (nb.length) {
        const [to] = nb[0]!;
        const dx = g.x(to) - g.x(n);
        const dz = g.z(to) - g.z(n);
        const l = Math.hypot(dx, dz) || 1;
        const t = Math.min(6, l / 2);
        x = g.x(n) + (dx / l) * t + (-dz / l) * 1.8;
        z = g.z(n) + (dz / l) * t + (dx / l) * 1.8;
        yaw = Math.atan2(-dx, -dz);
      }
    }
    let spot:{x:number;z:number}|null=null;
    for(let i=0;i<18;i++) {
      const offset=(i%2?1:-1)*Math.ceil(i/2)*6;
      const cx=x-Math.sin(yaw)*offset,cz=z-Math.cos(yaw)*offset;
      if(this.world.hasChunkAt(cx,cz)&&this.world.isOnRoad(cx,cz,0)&&!this.world.isBlocked(cx,cz)&&this.vehicles.canPlace(cx,cz,yaw)){spot={x:cx,z:cz};break;}
    }
    if(!spot){this.hud.toast('No clear parking space nearby. Move along the road and try V again.',3);return;}
    const extras = this.vehicles.vehicles.slice(this.vehicles.baseCount).filter((v) => v !== this.vehicles.driving);
    if (extras.length >= 4) this.vehicles.remove(extras[0]!);
    this.vehicles.spawnAt(spot.x, spot.z, yaw, 0xf1f3f4);
    this.hud.toast('🚗 Car spawned nearby — press F to drive', 2);
  }

  // ---------------------------------------------------------------------------
  // Landmark sites: pagoda interactions, discovery, photos
  // ---------------------------------------------------------------------------

  /** The pagoda complex the player is standing in or right next to. */
  private nearPagoda(): PagodaSite | null {
    const p = this.player.position;
    for (const s of this.world.pagodaSites()) {
      const [cx, cz] = s.layout.centre;
      if (Math.hypot(p.x - cx, p.z - cz) < Math.max(s.layout.lenU, s.layout.lenV) / 2 + 6) return s;
    }
    return null;
  }

  private nearMat(site: PagodaSite): [number, number, number] | null {
    const p = this.player.position;
    return site.layout.mats.find(([x, z]) => Math.hypot(p.x - x, p.z - z) < 1.3) ?? null;
  }

  private sitAt(mat: [number, number, number]): void {
    this.stopDance();
    this.player.teleport(mat[0], mat[1], mat[2], PLATFORM_Y);
    this.sitting = true;
    this.hud.toast('Sitting quietly — move or press E to stand', 2.5);
  }

  private standUp(): void {
    if (!this.sitting) return;
    this.sitting = false;
    this.player.rig.body.position.y = 0.92;
    this.player.rig.body.rotation.set(0, 0, 0);
    this.player.rig.leftLeg.rotation.set(0, 0, 0);
    this.player.rig.rightLeg.rotation.set(0, 0, 0);
    this.player.rig.leftArm.rotation.set(0, 0, 0);
    this.player.rig.rightArm.rotation.set(0, 0, 0);
    this.player.rig.head.rotation.set(0, 0, 0);
  }

  private openPagodaInfo(site: PagodaSite): void {
    const [cx, cz] = site.layout.centre;
    const g = worldToGeo(cx, 0, cz);
    const found = this.discoveries.when(site.id);
    const total = this.manifest?.landmarks.length ?? 0;
    const el = document.createElement('div');
    el.className = 'about';
    const p = (text: string, cls = '') => {
      const e = document.createElement('p');
      if (cls) e.className = cls;
      e.textContent = text;
      el.appendChild(e);
    };
    if (site.nameLocal) p(site.nameLocal, 'lm-local');
    p(`Location: ${g.lat.toFixed(5)}° N, ${g.lon.toFixed(5)}° E · OpenStreetMap ${site.id}`);
    p(`Platform about ${Math.round(site.layout.lenU)} m × ${Math.round(site.layout.lenV)} m · about ${Math.round(site.layout.stupa.height)} m tall.`);
    p(site.note, 'muted small');
    p(found ? `Discovered ${new Date(found).toLocaleString()} · ${this.discoveries.count} of ${total} places discovered.` : `${this.discoveries.count} of ${total} places discovered.`, 'small');
    const row = document.createElement('div');
    row.className = 'row gap';
    const btn = (label: string, fn: () => void, cls = 'btn') => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = label;
      b.onclick = fn;
      row.appendChild(b);
    };
    btn('View architectural details', () => {
      this.modal.close();
      this.detailView = { cx, cz, r: Math.max(site.layout.lenU, site.layout.lenV) * 0.85, h: site.layout.stupa.height * 0.55, t: 0 };
      this.hud.toast('Architectural view — press any key to return', 3);
      this.input.requestPointerLock();
    }, 'btn primary');
    btn('Take photo (P)', () => {
      this.modal.close();
      this.photoRequested = true;
    });
    el.appendChild(row);
    this.input.exitPointerLock();
    this.modal.open(site.name, el);
  }

  private updateDetailView(dt: number): void {
    const v = this.detailView!;
    v.t += dt;
    const a = v.t * 0.12;
    this.camera.position.set(v.cx + Math.sin(a) * v.r, v.h * (0.55 + 0.25 * Math.sin(v.t * 0.2)), v.cz + Math.cos(a) * v.r);
    this.camera.lookAt(v.cx, v.h * 0.6, v.cz);
    const inp = this.input;
    const m = inp.consumeMouse();
    const anyKey = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'KeyF', 'Escape'].some((k) => inp.wasPressed(k));
    if (v.t > 40 || anyKey || Math.abs(m.dx) + Math.abs(m.dy) > 40) this.detailView = null;
  }

  /** Marks nearby landmarks discovered (larger radius for pagoda complexes). */
  private updateDiscoveries(dt: number, x: number, z: number): void {
    this.discoveryTimer -= dt;
    if (this.discoveryTimer > 0 || !this.manifest) return;
    this.discoveryTimer = 0.5;
    for (const lm of this.manifest.landmarks) {
      const r = lm.pg ? 70 : 30;
      if (Math.abs(lm.x - x) > r || Math.abs(lm.z - z) > r) continue;
      if (Math.hypot(lm.x - x, lm.z - z) > r) continue;
      if (this.discoveries.discover(lm.id)) {
        const name = getLang() === 'rki' ? (lm.nl ?? lm.n) : (lm.ne ?? lm.n);
        this.hud.toast(`✦ Discovered: ${name} (${this.discoveries.count}/${this.manifest.landmarks.length})`, 3.5);
      }
    }
  }

  /** Bottom of the main staircase when (x, z) is a pagoda complex; otherwise null. */
  private pagodaEntrance(x: number, z: number): { x: number; z: number } | null {
    const lm = this.manifest?.landmarks.find((l) => l.pg && Math.hypot(l.x - x, l.z - z) < 45);
    if (!lm?.pg) return null;
    const live = this.world.pagodaSites().find((s) => s.id === lm.id);
    const layout = live?.layout ?? pagodaLayout(lm.pg, lm, lm.pe ? { mainOut: lm.pe } : { roadDistance: (px, pz) => (this.nav ? Math.hypot(this.nav.graph.x(this.nav.graph.nearestNode(px, pz, 'walk', 400)) - px, this.nav.graph.z(this.nav.graph.nearestNode(px, pz, 'walk', 400)) - pz) : 0) });
    if (!layout) return null;
    const e = layout.entrances[layout.main]!;
    return { x: e.bottom[0] + e.out[0] * 1.5, z: e.bottom[1] + e.out[1] * 1.5 };
  }

  /** Saves the current frame as a PNG (call right after rendering). */
  private capturePhoto(): void {
    this.photoRequested = false;
    const canvas = this.renderer.canvas;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `sittwe-3d-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
    this.hud.toast('📷 Photo saved', 1.5);
  }

  private nearestLandmark(maxDist: number): { name: string; cat: string; dist: number } | null {
    const p = this.focusPoint();
    let best: { name: string; cat: string; dist: number } | null = null;
    for (const lm of this.manifest?.landmarks ?? []) {
      const d = Math.hypot(lm.x - p.x, lm.z - p.z);
      if (d < maxDist && (!best || d < best.dist)) {
        const name = getLang() === 'rki' ? (lm.nl ?? lm.n) : (lm.ne ?? lm.n);
        best = { name, cat: lm.cat, dist: d };
      }
    }
    return best;
  }

  private updateHud(dt: number, day: number): void {
    const s = this.settings.get();
    const driving = this.vehicles.driving;
    this.touchControls.setDriving(!!driving||this.riding,this.riding);
    const p = this.focusPoint();
    const camDir = this.camera.getWorldDirection(this.tmpV);
    const camHeading = headingFromDirection(camDir.x, camDir.z);

    let prompt: string | null = null;
    const ride=this.remotePlayers.nearestRide(this.player.position);
    if(this.riding)prompt='Passenger — F to leave when stopped and landed';
    else if(ride&&!driving)prompt=`F — Ride with ${ride.name}`;
    else if (!driving) {
      if (this.world.nearHomeDoor(p.x,p.z)) prompt = 'E — Open / close home door';
      else if(this.pedestrians.nearby(p.x,p.z)) prompt='E — '+this.pedestrians.nearby(p.x,p.z);
      else if (this.vehicles.nearest(this.player.position) || (this.traffic && this.traffic.nearest(this.player.position.x, this.player.position.z, 2.6) >= 0)) prompt = t('enterVehicle');
      else if (this.nearPagoda()) {
        const site = this.nearPagoda()!;
        prompt = this.sitting ? 'E — Stand up' : this.nearMat(site) ? 'E — Sit and meditate' : `E — ${site.name}: information`;
      } else {
        const lm = this.nearestLandmark(25);
        if (lm) prompt = `E — ${lm.name}`;
      }
    } else if (this.vehicles.needsReset) prompt = t('pressRToReset');

    // Location: nearest named road + nearest mapped neighbourhood.
    const road = this.world.roadNameAt(p.x, p.z);
    const place = this.world.nearestPlace(p.x, p.z);
    const placeName = place ? (getLang() === 'rki' ? (place.nameLocal ?? place.name) : (place.nameEn ?? place.name)) : null;
    const location = [road ?? t('unnamedRoad'), placeName, t('sittwe')].filter(Boolean).join(', ');

    let dest: { distance: number; bearing: number } | null = null;
    if (this.destination) {
      const dx = this.destination.x - p.x;
      const dz = this.destination.z - p.z;
      const distance = Math.hypot(dx, dz);
      dest = { distance, bearing: headingFromDirection(dx, dz) };
      if (distance < 12) {
        this.hud.toast(`✓ ${t('destination')}`, 2.5);
        this.setDestination(null);
        dest = null;
      }
    }
    const navState = this.destination && this.nav ? this.nav.update(dt, p.x, p.z, this.travelMode()) : null;
    if (navState) {
      // Arrived when the road route is (nearly) complete.
      if (navState.remaining < 10) {
        this.hud.toast(`✓ ${t('destination')}`, 2.5);
        this.setDestination(null);
      }
    }

    // Edge-of-world warning.
    this.edgeWarnTimer -= dt;
    if (this.manifest && !insideBounds(this.manifest.bounds, p.x, p.z, 15) && this.edgeWarnTimer <= 0) {
      this.hud.toast(t('edgeOfMap'), 2.5);
      this.edgeWarnTimer = 6;
    }

    const ws = this.world.stats();
    const rs = this.perf.renderStats(this.renderer.three);
    this.hud.update(dt, {
      clock: this.cycle.clockString(),
      location,
      playerName: s.playerName,
      heading: camHeading,
      muted: s.muted,
      driving: driving ? { speedKmh: driving.speedKmh, gear: driving.physics.gear, headlights: driving.headlightsOn } : null,
      prompt,
      destination: dest,
      nav: navState && this.destination ? { text: navState.nextText, turn: navState.nextTurn, nextIn: navState.nextIn, remaining: navState.remaining, mode: navState.mode } : null,
      stats: s.showFps
        ? { fps: this.perf.fps, ms: this.perf.avgMs, worst: this.perf.worstMs, heap: this.perf.heapMB(), calls: rs.calls, triangles: rs.triangles, quality: QUALITY_PRESETS[s.quality].label, chunks: `${ws.built} chunks${ws.pending ? ` (+${ws.pending})` : ''}` }
        : null,
    });
    this.hud.minimap.update(p.x, p.z, this.facingHeading(), performance.now());

    this.audio.update(dt, {
      day,
      rain: this.weather.amount,
      driving: !!driving,
      speedKmh: driving ? driving.speedKmh : 0,
      throttle: driving ? driving.physics.throttle : 0,
      nearWater: this.player.swimming,
    });
  }
}

function createBeacon(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(1.2, 1.2, 120, 16, 1, true).translate(0, 60, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xf5b84b, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'destination-beacon';
  m.visible = false;
  m.renderOrder = 5;
  return m;
}
