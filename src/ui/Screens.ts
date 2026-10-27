import type { WorldManifest } from '../geo/chunkFormat';
import { h } from './dom';
import { t } from './i18n';

/** Loading screen with a progress bar and status line. */
export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;

  constructor(parent: HTMLElement) {
    this.bar = h('div.progress-fill');
    this.status = h('div.loading-status', {}, 'Starting…');
    this.el = h(
      'div.screen.loading',
      {},
      h('div.loading-card', {}, h('div.brand', {}, h('span.brand-mark'), 'SITTWE 3D'), h('div.progress', {}, this.bar), this.status, h('div.muted.tiny', {}, 'Map data © OpenStreetMap contributors')),
    );
    parent.appendChild(this.el);
  }

  set(progress: number, status: string): void {
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    this.status.textContent = status;
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
  }
}

/** Generic modal dialog. */
export class Modal {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private previousFocus:HTMLElement|null=null;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, cls = '') {
    this.titleEl = h('h2');
    this.body = h('div.modal-body');
    this.closeBtn = h('button.btn.icon', { 'aria-label': 'Close', onclick: () => this.close() }, '✕') as HTMLButtonElement;
    this.el = h(`div.modal-backdrop.hidden${cls ? `.${cls}` : ''}`, {}, h('div.modal.panel', {role:'dialog','aria-modal':'true','aria-label':'Game dialog'}, h('div.modal-head', {}, this.titleEl, this.closeBtn), this.body));
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();}
      if(e.key==='Tab'){
        const elements=[...this.el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
        const first=elements[0],last=elements.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    });
    parent.appendChild(this.el);
  }

  open(title: string, content: Node): void {
    if(!this.isOpen)this.previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    this.titleEl.textContent = title;
    this.el.querySelector('[role=dialog]')?.setAttribute('aria-label',title);
    this.body.innerHTML = '';
    this.body.appendChild(content);
    this.el.classList.remove('hidden');
    this.closeBtn.focus();
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    this.previousFocus?.focus();
    this.onClose?.();
  }
}

export function controlsContent(): HTMLElement {
  const table = (title: string, rows: Array<[string, string]>) =>
    h('div.controls-col', {}, h('h3', {}, title), ...rows.map(([k, v]) => h('div.hint-row', {}, h('kbd', {}, k), h('span', {}, v))));
  return h(
    'div.controls-grid',
    {},
    table('On foot', [
      ['W A S D', 'Move'],
      ['Shift', 'Sprint'],
      ['Space', 'Jump'],
      ['Mouse', 'Rotate camera'],
      ['Wheel', 'Camera distance'],
      ['E', 'Interact'],
      ['F', 'Enter vehicle (parked or passing traffic)'],
      ['V', 'Spawn a car nearby'],
      ['B', 'Spawn a motorbike nearby'],
      ['N', 'Spawn a bicycle nearby'],
      ['K', 'Missions'],
      ['J', 'Traditional dance (shield / oil lamps)'],
      ['C', 'Third / first person / cinematic'],
    ]),
    table('Driving', [
      ['W', 'Accelerate'],
      ['S', 'Brake / reverse'],
      ['A / D', 'Steer'],
      ['Space', 'Take off / Ascend'],
      ['Ctrl', 'Descend'],
      ['G', 'Toggle flight / Land'],
      ['Shift', 'Flight boost'],
      ['X', 'Handbrake'],
      ['L', 'Headlights'],
      ['R', 'Flip car upright'],
      ['C', 'Chase / far / hood / cinematic'],
      ['F', 'Exit vehicle'],
    ]),
    table('General', [
      ['M', 'Full-screen map'],
      ['/', 'Search places & navigate'],
      ['Esc', 'Pause / release mouse'],
      ['H', 'Hide control hints'],
      ['F5', 'Quick save (also autosaves)'],
    ]),
  );
}

export function aboutContent(manifest: WorldManifest | null): HTMLElement {
  const src = manifest?.sources ?? [];
  const latest = src.map((s) => s.osmBaseTimestamp).filter(Boolean).sort().pop();
  return h(
    'div.about',
    {},
    h('p', {}, 'Sittwe 3D is an open-world exploration and driving game set in a real, geographically referenced part of Sittwe (စစ်တွေ), Rakhine State, Myanmar.'),
    h('h3', {}, 'Map data'),
    h(
      'p',
      { html: 'Roads, buildings, coastline, water, land use, trees and landmarks come from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>. © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0).' },
    ),
    h(
      'ul.small',
      {},
      h('li', {}, `Origin: ${manifest ? `${manifest.origin.lat}, ${manifest.origin.lon}` : '—'} (${manifest?.origin.source ?? ''})`),
      h('li', {}, `Area: ${manifest ? `${((manifest.bounds.maxX - manifest.bounds.minX) / 1000).toFixed(1)} km × ${((manifest.bounds.maxZ - manifest.bounds.minZ) / 1000).toFixed(1)} km` : '—'} in ${manifest?.chunks.length ?? 0} chunks of ${manifest?.chunkSize ?? 0} m`),
      h('li', {}, `OSM data snapshot: ${latest ?? 'unknown'} · retrieved ${src[0]?.retrievedAt?.slice(0, 10) ?? 'unknown'} via Overpass API`),
    ),
    h('h3', {}, 'What is real and what is generated'),
    h(
      'ul.small',
      {},
      h('li', {}, 'Real (from OSM): road centerlines & classes, building footprints, coastline, water bodies, land-use areas, mapped trees, named landmarks and their positions.'),
      h('li', {}, 'Estimated: building heights without height/levels tags (by type and footprint area), road widths without width/lanes tags, roof shapes.'),
      h('li', {}, 'Generated / artistic: filler trees inside mapped green and residential areas, streetlights along major roads, window and door details, stupa markers at mapped Buddhist sites without a footprint, sea waves and shore foam, beach sand and coastal palms and mangroves along the real coastline, the Point Beach campfire, seagulls and jumping fish, the flat terrain (no elevation data).'),
    ),
    h('h3', {}, 'Software'),
    h('p.small', {}, 'Three.js (MIT), Rapier physics (Apache-2.0), MapLibre GL JS (BSD-3-Clause), Vite (MIT). 3D models and sounds are authored procedurally in code. The flag image was supplied by the user; other surface details use procedural materials.'),
    h('p.small.muted', {}, 'Not affiliated with OpenTaxi or any map provider. The game map uses bundled OSM data. The optional street basemap loads OpenStreetMap tiles. Multiplayer uses PeerJS signaling and WebRTC.'),
  );
}

export interface MainMenuCallbacks {
  onPlay(): void;
  onContinue(): void;
  onMap(): void;
  onSettings(): void;
  onControls(): void;
  onAbout(): void;
  onLanguage(): void;
  onCharacter(c: 'boy' | 'girl'): void;
}

export class MainMenu {
  readonly el: HTMLElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly buttons: Record<string, HTMLButtonElement> = {};
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly langBtn: HTMLButtonElement;
  private readonly charBtns: Record<'boy' | 'girl', HTMLButtonElement>;

  constructor(parent: HTMLElement, cb: MainMenuCallbacks) {
    const btn = (key: 'play' | 'continue' | 'map' | 'settings' | 'controls' | 'about', fn: () => void, cls = '') => {
      const b = h(`button.btn.menu-btn${cls}`, { onclick: fn }) as HTMLButtonElement;
      this.buttons[key] = b;
      return b;
    };
    this.title = h('h1.title');
    this.subtitle = h('p.subtitle');
    this.continueBtn = btn('continue', cb.onContinue);
    this.langBtn = h('button.btn.lang-toggle', { onclick: cb.onLanguage }) as HTMLButtonElement;
    this.charBtns = {
      boy: h('button.btn.char-btn', { onclick: () => cb.onCharacter('boy') }) as HTMLButtonElement,
      girl: h('button.btn.char-btn', { onclick: () => cb.onCharacter('girl') }) as HTMLButtonElement,
    };
    this.el = h(
      'div.screen.main-menu.hidden',
      {},
      h(
        'div.menu-card',
        {},
        h('div.menu-eyebrow',{},'RAKHINE STATE · MYANMAR'),
        this.title,
        this.subtitle,
        h('p.menu-intro',{},'Wander the streets. Meet the neighbours. Make yourself at home.'),
        h('div.char-pick', {}, this.charBtns.boy, this.charBtns.girl),
        h('div.menu-buttons', {}, btn('play', cb.onPlay, '.primary'), this.continueBtn, btn('map', cb.onMap), btn('settings', cb.onSettings), btn('controls', cb.onControls), btn('about', cb.onAbout)),
        h('div.menu-foot', {}, this.langBtn, h('span.muted.tiny', { html: 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' })),
      ),
    );
    this.el.append(h('aside.discovery-panel',{},h('div.menu-eyebrow',{},'A CITY TO CALL HOME'),h('h2',{},'Find your own',h('br'),h('em',{},'way through Sittwe.')),h('p',{},'From golden pagodas to the coast, a new corner is always waiting.'),h('div.discovery-stats',{},h('span',{},h('strong',{},'110'),' mapped places'),h('span',{},h('strong',{},'24'),' citizen roles'),h('span',{},h('strong',{},'8'),' players per room')),h('div.destination-list'),h('p.discovery-note',{},'Explore solo or invite friends with a room code.')));
    parent.appendChild(this.el);
    this.refreshText();
  }

  setDestinations(places:Array<{name:string;x:number;z:number}>,visit:(x:number,z:number)=>void):void {
    const list=this.el.querySelector('.destination-list')!;
    list.append(h('div.menu-eyebrow',{},'START EXPLORING'),...places.map((p,i)=>h('button.destination-card',{onclick:()=>visit(p.x,p.z)},h('span.destination-number',{},`0${i+1}`),h('span',{},p.name),h('span',{'aria-hidden':'true'},'↗'))));
  }

  refreshText(): void {
    this.title.textContent = t('title');
    this.subtitle.textContent = t('subtitle');
    this.buttons['play']!.textContent = t('play');
    this.charBtns.boy.textContent = `👦 ${t('boy')}`;
    this.charBtns.girl.textContent = `👧 ${t('girl')}`;
    this.buttons['continue']!.textContent = t('continue');
    this.buttons['map']!.textContent = t('map');
    this.buttons['settings']!.textContent = t('settings');
    this.buttons['controls']!.textContent = t('controls');
    this.buttons['about']!.textContent = t('about');
    this.langBtn.textContent = document.documentElement.classList.contains('lang-rki') ? 'English' : 'ရခိုင်';
  }

  setCharacter(c: 'boy' | 'girl'): void {
    this.charBtns.boy.classList.toggle('active', c === 'boy');
    this.charBtns.girl.classList.toggle('active', c === 'girl');
    this.charBtns.boy.setAttribute('aria-pressed',String(c==='boy'));
    this.charBtns.girl.setAttribute('aria-pressed',String(c==='girl'));
  }

  setContinueEnabled(v: boolean): void {
    this.continueBtn.disabled = !v;
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
    if(v)this.el.scrollTop=0;
  }
}

export interface PauseCallbacks {
  onResume(): void;
  onSave(): void;
  onSettings(): void;
  onControls(): void;
  onMap(): void;
  onMainMenu(): void;
  onReset(): void;
}

export class PauseMenu {
  readonly el: HTMLElement;
  private readonly labels: Array<[HTMLElement, Parameters<typeof t>[0]]> = [];

  constructor(parent: HTMLElement, cb: PauseCallbacks) {
    const b = (key: Parameters<typeof t>[0], fn: () => void, cls = '') => {
      const el = h(`button.btn.menu-btn${cls}`, { onclick: fn });
      this.labels.push([el, key]);
      return el;
    };
    const title = h('h2');
    this.labels.push([title, 'paused']);
    this.el = h(
      'div.screen.pause.hidden',
      {},
      h(
        'div.menu-card.compact',
        {},
        title,
        h(
          'div.menu-buttons',
          {},
          b('resume', cb.onResume, '.primary'),
          b('saveGame', cb.onSave),
          b('map', cb.onMap),
          b('settings', cb.onSettings),
          b('controls', cb.onControls),
          b('mainMenu', cb.onMainMenu),
          b('resetGame', cb.onReset, '.danger'),
        ),
      ),
    );
    parent.appendChild(this.el);
    this.refreshText();
  }

  refreshText(): void {
    for (const [el, k] of this.labels) el.textContent = t(k);
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
