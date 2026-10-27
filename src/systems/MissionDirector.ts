import { ITEMS, type ItemId, blocker, emptyState, loadProgress, MissionEngine, missionById, RACE_WIN_BONUS, saveProgress, validMissionState, type FxKind, type Lang, type MissionContext, type MissionProgress, type MissionState, type PlaceRef, type PlayerPos, type Text } from './Missions';
import { festivalActive } from './Thadingyut';
import type { Rooms } from './Rooms';

export interface DirectorHooks {
  rooms: Rooms;
  /** You first, then everyone else in the room. */
  players: () => PlayerPos[];
  hours: () => number;
  place: (ref: PlaceRef) => { x: number; z: number } | null;
  /** Free beach spots to scatter pickups. */
  scatter: (x: number, z: number, count: number, spread: number) => Array<[number, number]>;
  lang: () => Lang;
  toast: (text: string, seconds: number) => void;
  fx: (kind: FxKind, x: number, z: number) => void;
  /** Called when the mission moves to a new place, to route the player there. */
  target: (at: { x: number; z: number } | null) => void;
  onChange: () => void;
}

type GuestRequest = { m: 'start'; id: string } | { m: 'act' } | { m: 'quit' };

function safeStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * Runs missions solo, or shares them in a room: the host owns the only engine
 * and sends its state with every room update; guests send requests (start,
 * E presses, quit) to the host and show the host's state.
 */
export class MissionDirector {
  private readonly engine = new MissionEngine();
  private hostView: MissionState | null = null;
  progress: MissionProgress;
  private lastN = -1;
  private lastId: string | null = null;
  private lastStep = -1;
  private sawRunning = false;
  private tick = 0;

  constructor(private readonly h: DirectorHooks, private readonly store: Storage | null = safeStore()) {
    this.progress = loadProgress(store);
    h.rooms.gameState = () => (h.rooms.isHost ? this.engine.state : null);
    h.rooms.onGameState = (data) => { if (validMissionState(data)) this.hostView = data; };
    h.rooms.onGameMessage = (peer, data) => this.fromGuest(peer, data);
  }

  /** The host (or a solo player) runs missions; guests follow the host. */
  get authority(): boolean {
    return !this.h.rooms.active || this.h.rooms.isHost;
  }

  get state(): MissionState {
    return this.authority ? this.engine.state : this.hostView ?? emptyState();
  }

  get festival(): boolean {
    return festivalActive(this.progress.festival, new Date());
  }

  setFestival(v: MissionProgress['festival']): void {
    this.progress.festival = v;
    saveProgress(this.store, this.progress);
    this.h.onChange();
  }

  private selfId(): string {
    return this.h.players()[0]?.id ?? 'me';
  }

  private ctx(): MissionContext {
    return { players: this.h.players(), hours: this.h.hours(), place: this.h.place, now: Date.now(), scatter: this.h.scatter };
  }

  private say(t: Text, seconds = 3): void {
    this.h.toast(t[this.h.lang()] || t.en, seconds);
  }

  start(id: string): void {
    if (!this.authority) { this.h.rooms.sendToHost({ m: 'start', id }); return; }
    const err = this.engine.start(id, this.festival, this.ctx());
    if (err) this.say(err);
    this.h.onChange();
  }

  quit(): void {
    if (!this.authority) { this.h.rooms.sendToHost({ m: 'quit' }); return; }
    this.engine.quit();
    this.h.target(null);
    this.h.onChange();
  }

  /** E pressed. Returns true when a mission action used it. */
  pressE(): boolean {
    if (!this.prompt()) return false;
    if (!this.authority) { this.h.rooms.sendToHost({ m: 'act' }); return true; }
    const err = this.engine.act(this.selfId(), this.ctx());
    if (err) this.say(err);
    return true;
  }

  /** Text for the E prompt when a mission action is available here. */
  prompt(): string | null {
    const mirror = new MissionEngine();
    mirror.state = this.state;
    const t = mirror.actionFor(this.selfId(), this.ctx());
    return t ? t[this.h.lang()] || t.en : null;
  }

  private fromGuest(peer: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as GuestRequest;
    if (r.m === 'start' && typeof r.id === 'string' && missionById(r.id) && !this.engine.state.id) {
      const err = this.engine.start(r.id, this.festival, this.ctx());
      if (err) this.say(err);
    } else if (r.m === 'act') {
      this.engine.act(peer, this.ctx());
    } else if (r.m === 'quit') {
      this.engine.quit();
    }
    this.h.onChange();
  }

  update(dt: number): void {
    this.tick -= dt;
    if (this.authority && this.tick <= 0) {
      this.tick = 0.25;
      this.engine.update(this.ctx());
    }
    const s = this.state;
    // Show each new event once (toast + effect), for host and guests alike.
    if (s.n !== this.lastN) {
      const first = this.lastN < 0 && !this.authority;
      this.lastN = s.n;
      if (s.event && !first) {
        this.say(s.event.text, 3.5);
        if (s.event.fx) {
          const me = this.h.players()[0];
          this.h.fx(s.event.fx, s.event.x ?? me?.x ?? 0, s.event.z ?? me?.z ?? 0);
        }
      }
      if (s.id && !s.done) this.sawRunning = true;
      if (s.done && s.id && this.sawRunning) {
        // Pay out once, only to players who took part while it was running.
        this.sawRunning = false;
        const won = s.done.winner === this.selfId();
        this.progress.kyat += s.done.reward + (won ? RACE_WIN_BONUS : 0);
        this.progress.done[s.id] = (this.progress.done[s.id] ?? 0) + 1;
        saveProgress(this.store, this.progress);
      }
      this.h.onChange();
    }
    // Route to the next place whenever the step changes.
    if (s.id !== this.lastId || s.step !== this.lastStep) {
      this.lastId = s.id;
      this.lastStep = s.step;
      const step = s.id && !s.done ? missionById(s.id)?.steps[s.step] : undefined;
      this.h.target(step ? this.h.place(step.place) : null);
      this.h.onChange();
    }
  }

  /** What the on-screen tracker shows. */
  tracker(): null | { icon: string; title: string; step: string; wait: string | null; distance: number | null; items: string; budget: number; done: boolean; stepNo: string } {
    const s = this.state;
    const def = s.id ? missionById(s.id) : undefined;
    if (!def) return null;
    const lang = this.h.lang();
    const pick = (t: Text) => t[lang] || t.en;
    const step = s.done ? undefined : def.steps[s.step];
    const at = step ? this.h.place(step.place) : null;
    const me = this.h.players()[0];
    const items = Object.entries(s.items).filter(([, n]) => n! > 0).map(([k, n]) => `${ITEMS[k as ItemId].icon}×${n}`).join(' ');
    let wait: Text | null = step && at && !step.collect && !step.tag && !step.hide ? blocker(step, this.ctx(), at) : null;
    // Live mini-game status.
    const players = this.h.players();
    const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? '?';
    const left = s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : 0;
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (step?.collect) {
      const got = s.pickups.filter((_, k) => k % 3 === 2 && s.pickups[k]! >= 0).length;
      const board = players.map((p) => `${p.name} ${s.scores[p.id] ?? 0}`).join(' · ');
      const total = s.pickups.length / 3 || step.collect.count;
      wait = { en: `${ITEMS[step.collect.item].icon} ${got}/${total} found${step.collect.competitive ? ` — ${board}` : ''}`, rki: `${ITEMS[step.collect.item].icon} ${got}/${total}${step.collect.competitive ? ` — ${board}` : ''}` };
    } else if (step?.tag) {
      const me = s.it === this.selfId();
      wait = { en: `${me ? '🔴 YOU are IT — touch someone!' : `🏃 ${nameOf(s.it)} is IT — run!`} · ${clock} left`, rki: `${me ? '🔴 မင်း IT ဖြစ်နီရေ!' : `🏃 ${nameOf(s.it)} IT ဖြစ်နီရေ`} · ${clock}` };
    } else if (step?.hide) {
      const seeking = s.phase === 'seek';
      const me = s.seeker === this.selfId();
      const hiders = players.length - 1;
      wait = { en: me ? (seeking ? `👀 Find everyone! ${s.found.length}/${hiders} · ${clock} left` : `🙈 Counting… ${left}s`) : seeking ? `🤫 ${nameOf(s.seeker)} is seeking · ${clock} left` : `🏃 Hide! ${nameOf(s.seeker)} is counting · ${left}s`, rki: me ? `👀 ရှာ! ${s.found.length}/${hiders} · ${clock}` : `🤫 ${nameOf(s.seeker)} ရှာနီရေ · ${clock}` };
    }
    return {
      icon: def.icon,
      title: pick(def.title),
      step: s.done ? (s.event ? pick(s.event.text) : 'Mission complete!') : pick(step!.text),
      wait: wait ? pick(wait) : null,
      distance: at && me ? Math.hypot(at.x - me.x, at.z - me.z) : null,
      items,
      budget: s.budget,
      done: !!s.done,
      stepNo: `${Math.min(s.step + 1, def.steps.length)}/${def.steps.length}`,
    };
  }

  /** Clears a finished mission from the tracker. */
  dismiss(): void {
    if (this.state.done) this.quit();
  }
}
