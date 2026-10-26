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
import type { PlayerSnapshot } from '../systems/RoomProtocol';
import { roomPanel } from '../ui/RoomPanel';
import { Navigation } from '../systems/Navigation';
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
  private pauseMenu!: PauseMenu;
  private manifest: WorldManifest | null = null;
  private beacon!: THREE.Mesh;
  private nav: Navigation | null = null;
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
      render: () => this.renderer.render(this.scene, this.camera),
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
      this.rooms.onJoin=s=>void this.joinRoomAt(s);
      this.rooms.onChange=()=>{if(this.roomBadge)this.roomBadge.textContent=this.rooms.status};
      this.buildUi(manifest);
      if (this.nav) {
        this.nav.onRouteChanged = (pts) => {
          this.hud.minimap.setRoute(pts);
          this.fullMap.setRoute(pts);
        };
        this.fullMap.setSearchIndex(this.buildSearchIndex(manifest));
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
    new TouchControls(this.hud.root,this.input,{map:()=>this.openMap(),pause:()=>this.pause()});
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
        setTimeOfDay: (h) => this.cycle.setHours(h),
        onResetGame: () => this.resetGame(),
      }),
    );
  }

  private applySettings(s: Settings, prev: Settings | null): void {
    const touch=s.touchControls==='on'||(s.touchControls==='auto'&&matchMedia('(pointer: coarse)').matches);
    document.documentElement.classList.toggle('touch-enabled',touch);document.documentElement.classList.toggle('touch-disabled',!touch);
    const preset = QUALITY_PRESETS[s.quality];
    if (!prev || prev.quality !== s.quality) {
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
    this.cycle.dayLengthMinutes = s.dayLengthMinutes;
    this.weather.target = s.rain ? 1 : 0;
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
    if (e.code === 'KeyM') {
      if (this.state === 'map') this.closeMap();
      else if (this.state === 'playing' || this.state === 'paused') this.openMap();
    }
  }

  private resetGame(): void {
    if (!window.confirm(t('resetConfirm'))) return;
    this.saves.clear();
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

  private networkSnapshot():PlayerSnapshot {
    const v=this.vehicles.driving,p=v?v.position:this.player.position,s=this.settings.get();
    return {seq:0,name:s.playerName.slice(0,32),character:s.character,x:p.x,y:v?p.y:this.player.renderPos.y,z:p.z,yaw:v?v.yaw:this.player.yaw,speed:v?Math.abs(v.physics.forwardSpeed()):this.player.groundSpeed,dancing:this.player.anim.dancing,vehicle:v?{x:p.x,y:p.y,z:p.z,yaw:v.yaw,flying:v.physics.flying}:null};
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
    if(this.vehicles.driving)this.exitVehicle(true);
    const p=this.housing.home;
    await this.world.prepareArea(p.x,p.z,1);
    this.player.teleport(p.x,p.z,Math.PI,HOME_FLOOR);
    this.cam.mode='first';this.cam.snapBehind(Math.PI);this.setDestination(null);
  }

  private teleportTo(x: number, z: number): void {
    if (this.vehicles.driving) this.exitVehicle(true);
    this.loading.show(true);
    void this.world.prepareArea(x, z, 1, (d, total) => this.loading.set(d / Math.max(1, total), `${t('loading')}… ${d}/${total}`)).then(() => {
      this.loading.show(false);
      const spot = this.world.findFreeSpot(x, z);
      this.player.teleport(spot.x, spot.z);
      this.setDestination(null);
      this.closeMap();
    });
  }

  private saveGame(notify: boolean): void {
    if (!this.manifest || this.state === 'boot' || this.state === 'menu') return;
    const p = this.vehicles.driving ? this.vehicles.driving.position : this.player.position;
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

    if (!driving) {
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
    if(this.rooms){this.rooms.update(dt);const p=this.focusPoint();this.remotePlayers.update(dt,p.x,p.z);}
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
        this.cam.menuOrbit(dt, focus);
      } else if (this.state === 'playing') {
        const m = inp.consumeMouse();
        this.cam.input(m.dx, m.dy, inp.consumeWheel());
        const driving = this.vehicles.driving;
        const pivot = driving ? this.tmpV.copy(driving.visual.root.position).add(new THREE.Vector3(0, 1.2, 0)) : this.player.renderPos.clone().add(new THREE.Vector3(0, this.cam.isFirstPerson ? this.player.headHeight : this.player.pivotHeight, 0));
        this.cam.update(dt, {
          pivot,
          heading: driving ? driving.yaw : this.player.yaw,
          speed: driving ? Math.abs(driving.physics.forwardSpeed()) : 0,
          inVehicle: !!driving,
          ignore: [this.player.collider, ...this.vehicles.colliders, ...(this.traffic?.colliders() ?? [])],
        });
        this.player.setVisible(!this.cam.isFirstPerson || !!driving);
        if (this.cam.isFirstPerson && !driving) this.player.faceYaw(this.cam.yaw);
      } else {
        inp.consumeMouse();
        inp.consumeWheel();
      }
    }

    // Lighting & weather.
    if (this.state === 'playing' || menuLike) this.cycle.update(dt);
    this.cycle.overcast = this.weather ? this.weather.amount : 0;
    const ls = this.cycle.compute();
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
    if (inp.wasPressed('Space') && !driving) this.jumpQueued = true;
    if (inp.wasPressed('KeyF')) {
      if (driving) this.exitVehicle();
      else {
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
    } else if (inp.wasPressed('KeyE') && !driving) {
      const lm = this.nearestLandmark(25);
      if (lm) this.hud.toast(`${lm.name} — ${lm.cat}`, 3);
    }
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
    const p = this.focusPoint();
    const camDir = this.camera.getWorldDirection(this.tmpV);
    const camHeading = headingFromDirection(camDir.x, camDir.z);

    let prompt: string | null = null;
    if (!driving) {
      if (this.world.nearHomeDoor(p.x,p.z)) prompt = 'E — Open / close home door';
      else if(this.pedestrians.nearby(p.x,p.z)) prompt='E — '+this.pedestrians.nearby(p.x,p.z);
      else if (this.vehicles.nearest(this.player.position) || (this.traffic && this.traffic.nearest(this.player.position.x, this.player.position.z, 2.6) >= 0)) prompt = t('enterVehicle');
      else {
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
