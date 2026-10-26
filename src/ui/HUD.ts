import { compassPoint, formatDistance, h } from './dom';
import { t } from './i18n';
import { Minimap } from './Minimap';

export interface HudCallbacks {
  onToggleMute(): void;
  onOpenSettings(): void;
  onOpenMap(): void;
}

export interface HudFrame {
  clock: string;
  location: string;
  playerName: string;
  heading: number;
  muted: boolean;
  driving: { speedKmh: number; gear: string; headlights: boolean } | null;
  prompt: string | null;
  destination: { distance: number; bearing: number } | null;
  nav: { text: string; turn: string; nextIn: number; remaining: number; mode: 'drive' | 'walk' } | null;
  stats: { fps: number; ms: number; worst: number; heap: number | null; calls: number; triangles: number; quality: string; chunks: string } | null;
}

/** In-game heads-up display. DOM-based; text updates are throttled. */
export class HUD {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  private readonly clock: HTMLElement;
  private readonly location: HTMLElement;
  private readonly name: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly compassStrip: HTMLElement;
  private readonly headingText: HTMLElement;
  private readonly destPanel: HTMLElement;
  private readonly destArrow: HTMLElement;
  private readonly destText: HTMLElement;
  private readonly vehiclePanel: HTMLElement;
  private readonly navPanel: HTMLElement;
  private readonly navArrow: HTMLElement;
  private readonly navText: HTMLElement;
  private readonly navMeta: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly speedArc: SVGPathElement;
  private readonly gear: HTMLElement;
  private readonly lights: HTMLElement;
  private readonly exitHint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly hints: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private textTimer = 0;

  constructor(parent: HTMLElement, cb: HudCallbacks) {
    this.root = h('div.hud.hidden');
    this.clock = h('div.hud-clock');
    this.location = h('div.hud-location');
    this.name = h('div.hud-name');
    this.muteBtn = h('button.btn.icon.small', { 'aria-label': 'Toggle sound', onclick: () => cb.onToggleMute() }) as HTMLButtonElement;
    const topLeft = h('div.hud-topleft.panel', {}, h('div.row', {}, this.clock, this.muteBtn), this.location, this.name);

    this.compassStrip = h('div.compass-strip');
    for (let d = -360; d <= 720; d += 15) {
      const deg = ((d % 360) + 360) % 360;
      const major = deg % 45 === 0;
      const label = major ? compassPoint(deg) : '';
      this.compassStrip.append(h(`div.tick${major ? '.major' : ''}${deg % 90 === 0 ? '.cardinal' : ''}`, { style: `left:${(d + 360) * 2}px` }, label));
    }
    this.headingText = h('div.compass-heading');
    this.destArrow = h('div.dest-arrow', {}, '▲');
    this.destText = h('span');
    this.destPanel = h('div.compass-dest.hidden', {}, this.destArrow, this.destText);
    const compass = h('div.hud-compass.panel', {}, h('div.compass-window', {}, this.compassStrip, h('div.compass-needle')), this.headingText);
    this.navArrow = h('div.nav-arrow');
    this.navText = h('div.nav-text');
    this.navMeta = h('div.nav-meta');
    this.navPanel = h('div.hud-nav.panel.hidden', {}, this.navArrow, h('div', {}, this.navText, this.navMeta));
    const topCenter = h('div.hud-topcenter', {}, compass, this.navPanel, this.destPanel);

    const mapWrap = h('div.hud-topright');
    this.minimap = new Minimap(mapWrap);
    const mapButtons = h(
      'div.minimap-buttons',
      {},
      h('button.btn.icon.small', { 'aria-label': 'Zoom in', onclick: () => this.minimap.zoomBy(0.6) }, '+'),
      h('button.btn.icon.small', { 'aria-label': 'Zoom out', onclick: () => this.minimap.zoomBy(-0.6) }, '−'),
      h('button.btn.icon.small', { 'aria-label': 'Full-screen map (M)', title: 'Map (M)', onclick: () => cb.onOpenMap() }, '⛶'),
      h('button.btn.icon.small', { 'aria-label': 'Settings', title: 'Settings', onclick: () => cb.onOpenSettings() }, '⚙'),
    );
    mapWrap.append(mapButtons);

    this.hints = h('div.hud-hints.panel');
    this.stats = h('div.hud-stats.panel');

    this.speed = h('div.speed-value', {}, '0');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.classList.add('speed-dial');
    const bg = document.createElementNS(svgNS, 'path');
    bg.setAttribute('d', arcPath(1));
    bg.setAttribute('class', 'dial-bg');
    this.speedArc = document.createElementNS(svgNS, 'path');
    this.speedArc.setAttribute('class', 'dial-fg');
    svg.append(bg, this.speedArc);
    this.gear = h('div.vh-item');
    this.lights = h('div.vh-item');
    this.exitHint = h('div.vh-hint');
    this.vehiclePanel = h(
      'div.hud-vehicle.panel.hidden',
      {},
      h('div.speedo', {}, svg, h('div.speed-center', {}, this.speed, h('div.speed-unit', {}, 'km/h'))),
      h('div.vh-col', {}, this.gear, this.lights, this.exitHint),
    );
    this.prompt = h('div.hud-prompt.hidden');
    this.toastEl = h('div.hud-toast.hidden');

    this.root.append(topLeft, topCenter, mapWrap, this.hints, this.stats, this.vehiclePanel, this.prompt, this.toastEl, h('div.crosshair'));
    parent.appendChild(this.root);
    this.refreshText(false);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (v) this.minimap.resize();
  }

  refreshText(driving: boolean): void {
    const rows = driving
      ? [['W / S', 'Accelerate / Brake · Reverse'], ['A / D', 'Steer'], ['Space', 'Take off / Ascend'], ['Ctrl', 'Descend'], ['G', 'Flight / Land'], ['X', 'Handbrake'], ['Shift', 'Flight boost'], ['L', 'Headlights'], ['C', 'Camera'], ['R', 'Reset car'], ['F', 'Exit vehicle'], ['M', 'Map'], ['Esc', 'Pause']]
      : [['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['Mouse', 'Look'], ['F', 'Enter vehicle'], ['V', 'Spawn car'], ['J', 'Dance'], ['/', 'Search'], ['C', 'Camera'], ['M', 'Map'], ['Esc', 'Pause']];
    this.hints.innerHTML = '';
    for (const [k, v] of rows) this.hints.append(h('div.hint-row', {}, h('kbd', {}, k!), h('span', {}, v!)));
    this.exitHint.textContent = t('exitVehicle');
  }

  toast(text: string, seconds = 2.5): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  update(dt: number, f: HudFrame): void {
    // Compass: 2 px per degree.
    this.compassStrip.style.transform = `translateX(${-(f.heading + 360) * 2}px)`;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toastEl.classList.add('hidden');

    // Prompt (visibility changes immediately).
    if (f.prompt) {
      this.prompt.textContent = f.prompt;
      this.prompt.classList.remove('hidden');
    } else this.prompt.classList.add('hidden');

    this.navPanel.classList.toggle('hidden', !f.nav);
    if (f.nav) {
      const arrows: Record<string, string> = { start: '↑', straight: '↑', left: '↰', right: '↱', 'slight-left': '↖', 'slight-right': '↗', arrive: '⚑' };
      this.navArrow.textContent = arrows[f.nav.turn] ?? '↑';
      this.navText.textContent = f.nav.text;
      const mins = Math.max(1, Math.round(f.nav.remaining / (f.nav.mode === 'drive' ? 8 : 1.3) / 60));
      this.navMeta.textContent = `${f.nav.turn === 'arrive' ? '' : `in ${formatDistance(f.nav.nextIn)} · `}${formatDistance(f.nav.remaining)} left · ~${mins} min ${f.nav.mode === 'drive' ? '🚗' : '🚶'}`;
    }
    if (f.destination && !f.nav) {
      this.destPanel.classList.remove('hidden');
      const rel = f.destination.bearing - f.heading;
      this.destArrow.style.transform = `rotate(${rel}deg)`;
    } else this.destPanel.classList.add('hidden');

    this.vehiclePanel.classList.toggle('hidden', !f.driving);
    if (f.driving) {
      const sp = Math.round(f.driving.speedKmh);
      this.speed.textContent = String(sp);
      this.speedArc.setAttribute('d', arcPath(Math.min(1, f.driving.speedKmh / 120)));
    }

    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 0.2;
    this.clock.textContent = f.clock;
    this.location.textContent = f.location;
    this.name.textContent = f.playerName;
    this.muteBtn.textContent = f.muted ? '🔇' : '🔊';
    this.headingText.textContent = `${Math.round(f.heading)}° ${compassPoint(f.heading)}`;
    if (f.destination) this.destText.textContent = `${t('destination')} · ${formatDistance(f.destination.distance)}`;
    if (f.driving) {
      this.gear.innerHTML = `<span class="muted">${t('gear')}</span> <b>${f.driving.gear}</b>`;
      this.lights.innerHTML = `<span class="muted">${t('headlights')}</span> <b class="${f.driving.headlights ? 'on' : ''}">${f.driving.headlights ? t('on') : t('off')}</b>`;
    }
    this.stats.classList.toggle('hidden', !f.stats);
    if (f.stats) {
      const s = f.stats;
      const heap = s.heap !== null ? ` · ${s.heap.toFixed(0)} MB` : '';
      this.stats.innerHTML = `<div><b class="${s.fps >= 55 ? 'good' : s.fps >= 30 ? 'ok' : 'bad'}">${s.fps.toFixed(0)} FPS</b> · ${s.ms.toFixed(1)} ms (p99 ${s.worst.toFixed(1)})</div><div class="muted">${s.calls} draws · ${(s.triangles / 1000).toFixed(0)}k tris${heap}</div><div class="muted">${s.chunks} · <span class="badge">${s.quality}</span></div>`;
    }
  }
}

/** SVG arc for the speedometer (240° sweep). */
function arcPath(frac: number): string {
  const start = (150 * Math.PI) / 180;
  const sweep = ((240 * Math.PI) / 180) * Math.max(0.0001, frac);
  const r = 50;
  const cx = 60;
  const cy = 60;
  const x0 = cx + r * Math.cos(start);
  const y0 = cy + r * Math.sin(start);
  const x1 = cx + r * Math.cos(start + sweep);
  const y1 = cy + r * Math.sin(start + sweep);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
