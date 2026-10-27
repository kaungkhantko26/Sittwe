/**
 * Co-op missions at real mapped places in Sittwe.
 *
 * A mission is a chain of steps. Each step happens at a place (an OSM
 * landmark id, or the player's home) and is either "arrive" (someone, or the
 * whole team, gets there) or an action done with E there (buy, use, light,
 * release…). Steps can require the whole team to be together and/or night.
 * Purchases come out of a team budget in kyat; finishing pays every player.
 *
 * Pure logic: no Three.js, DOM or networking. In a room the host runs the
 * engine and shares its state; guests send their E presses to the host.
 */

export type Lang = 'en' | 'rki';
export type Text = { en: string; rki: string };

/** Where a step happens: a mapped landmark id or the player's home. */
export type PlaceRef = string;

export interface StepAction {
  verb: Text;
  /** Kyat taken from the team budget; `perPlayer` multiplies by team size. */
  cost?: number;
  perPlayer?: boolean;
  /** Item added to the team bag (count per player when `perPlayer`). */
  gives?: { item: ItemId; count: number };
  /** Item used up (count per player when `perPlayer`). */
  uses?: { item: ItemId; count: number };
  /** Every team member must do it (e.g. everyone drinks); otherwise anyone can. */
  each?: boolean;
  /** Visual effect played for everyone when the action happens. */
  fx?: FxKind;
}

export interface MissionStep {
  text: Text;
  place: PlaceRef;
  radius: number;
  together?: boolean;
  night?: boolean;
  /** First player to arrive wins (races). */
  race?: boolean;
  action?: StepAction;
}

export interface MissionDef {
  id: string;
  title: Text;
  intro: Text;
  icon: string;
  season: 'any' | 'thadingyut';
  /** Shown as "best with friends"; missions still work solo. */
  social: boolean;
  budget: number;
  reward: number;
  /** Extra kyat when finished at sunset (17:00–19:00). */
  sunsetBonus?: number;
  steps: MissionStep[];
}

export type ItemId = 'beer' | 'seafood' | 'coffee' | 'candles' | 'lantern' | 'fruit' | 'flowers';
export type FxKind = 'cheers' | 'lamps' | 'lanterns' | 'fireworks' | 'feast' | 'gadaw';

export const ITEMS: Record<ItemId, { icon: string; name: Text }> = {
  beer: { icon: '🍺', name: { en: 'Myanmar Beer', rki: 'မြန်မာဘီယာ' } },
  seafood: { icon: '🦐', name: { en: 'Seafood platter', rki: 'ပင်လယ်စာ' } },
  coffee: { icon: '☕', name: { en: 'Coffee', rki: 'ကော်ဖီ' } },
  candles: { icon: '🕯️', name: { en: 'Oil lamps & candles', rki: 'ဆီမီးနှင့် ဖယောင်းတိုင်' } },
  lantern: { icon: '🏮', name: { en: 'Paper sky lantern', rki: 'မီးပုံးပျံ' } },
  fruit: { icon: '🍌', name: { en: 'Fruit offering', rki: 'သစ်သီးလက်ဆောင်' } },
  flowers: { icon: '💐', name: { en: 'Flowers', rki: 'ပန်း' } },
};

// Real places (OpenStreetMap ids; Satkyar Muni is a documented user landmark).
export const PLACES = {
  goldenFish: 'node/4976166006', // Golden Fish Mini Market (shop=supermarket)
  viewPoint: 'node/2318570031', // View Point at Sittwe Point (Point Beach)
  theBay: 'node/3205205567', // The Bay restaurant, near the Point
  mayYu: 'node/12375856691', // May Yu Market (marketplace)
  lawkanandar: 'node/1230796347',
  satkyarMuni: 'user/satkyar-muni',
  cafeDeSittwe: 'node/4925512104',
  uOttama: 'node/4303566099', // U Ottama memorial statue
  clockTower: 'node/4303580092',
  home: 'home',
} as const;

const T = (en: string, rki: string): Text => ({ en, rki });

export const MISSIONS: MissionDef[] = [
  {
    id: 'point-beers',
    icon: '🍻',
    title: T('Sunset beers at Point Beach', 'ပွိုင့်ကမ်းခြေ နေဝင်ချိန် ဘီယာ'),
    intro: T('Buy beer at Golden Fish Mini Market, meet your friends at Point Beach and drink together. Finish at sunset for a bonus.', 'Golden Fish စတိုးတွင် ဘီယာဝယ်ပြီး ပွိုင့်ကမ်းခြေတွင် သူငယ်ချင်းများနှင့် အတူသောက်ပါ။'),
    season: 'any',
    social: true,
    budget: 12000,
    reward: 3000,
    sunsetBonus: 1500,
    steps: [
      { text: T('Go to Golden Fish Mini Market', 'Golden Fish စတိုးသို့ သွားပါ'), place: PLACES.goldenFish, radius: 20 },
      { text: T('Buy beer for everyone', 'လူတိုင်းအတွက် ဘီယာဝယ်ပါ'), place: PLACES.goldenFish, radius: 20, action: { verb: T('Buy Myanmar Beer (2,500 Ks each)', 'မြန်မာဘီယာ ဝယ်ရန် (တစ်ဗူး ၂,၅၀၀ ကျပ်)'), cost: 2500, perPlayer: true, gives: { item: 'beer', count: 1 } } },
      { text: T('Meet everyone at Point Beach', 'ပွိုင့်ကမ်းခြေတွင် အားလုံးဆုံပါ'), place: PLACES.viewPoint, radius: 60, together: true },
      { text: T('Cheers! Everyone drinks', 'ချီးယားစ်! အားလုံးသောက်ပါ'), place: PLACES.viewPoint, radius: 60, together: true, action: { verb: T('Drink your beer — cheers!', 'ဘီယာသောက်ရန် — ချီးယားစ်!'), each: true, uses: { item: 'beer', count: 1 }, fx: 'cheers' } },
    ],
  },
  {
    id: 'bay-seafood',
    icon: '🦐',
    title: T('Seafood dinner at The Bay', 'The Bay တွင် ပင်လယ်စာညစာ'),
    intro: T('Ride together to The Bay near Sittwe Point and share a seafood dinner.', 'ပွိုင့်အနီး The Bay သို့ အတူသွားပြီး ပင်လယ်စာ စားကြပါ။'),
    season: 'any',
    social: true,
    budget: 20000,
    reward: 2500,
    steps: [
      { text: T('Everyone meets at The Bay', 'The Bay တွင် အားလုံးဆုံပါ'), place: PLACES.theBay, radius: 30, together: true },
      { text: T('Order the seafood platter', 'ပင်လယ်စာ မှာပါ'), place: PLACES.theBay, radius: 30, together: true, action: { verb: T('Order seafood (15,000 Ks)', 'ပင်လယ်စာ မှာရန် (၁၅,၀၀၀ ကျပ်)'), cost: 15000, gives: { item: 'seafood', count: 1 }, fx: 'feast' } },
      { text: T('Watch the sea from View Point', 'View Point မှ ပင်လယ်ကို ကြည့်ပါ'), place: PLACES.viewPoint, radius: 60 },
    ],
  },
  {
    id: 'coffee-run',
    icon: '☕',
    title: T('Coffee run to the pagoda', 'ဘုရားသို့ ကော်ဖီပို့'),
    intro: T('Pick up coffee at Cafe de Sittwe and bring it to your friends at Lawkanandar Pagoda before it gets cold.', 'Cafe de Sittwe မှ ကော်ဖီဝယ်ပြီး လောကနန္ဒာဘုရားသို့ ပို့ပါ။'),
    season: 'any',
    social: false,
    budget: 6000,
    reward: 1500,
    steps: [
      { text: T('Go to Cafe de Sittwe', 'Cafe de Sittwe သို့ သွားပါ'), place: PLACES.cafeDeSittwe, radius: 25 },
      { text: T('Buy coffee', 'ကော်ဖီဝယ်ပါ'), place: PLACES.cafeDeSittwe, radius: 25, action: { verb: T('Buy coffee (1,500 Ks each)', 'ကော်ဖီဝယ်ရန် (၁,၅၀၀ ကျပ်)'), cost: 1500, perPlayer: true, gives: { item: 'coffee', count: 1 } } },
      { text: T('Deliver it to Lawkanandar Pagoda', 'လောကနန္ဒာဘုရားသို့ ပို့ပါ'), place: PLACES.lawkanandar, radius: 60, action: { verb: T('Share the coffee', 'ကော်ဖီ မျှသောက်ရန်'), uses: { item: 'coffee', count: 1 }, perPlayer: true, fx: 'cheers' } },
    ],
  },
  {
    id: 'race-point',
    icon: '🏁',
    title: T('Race: U Ottama statue to the Point', 'ပြိုင်ပွဲ: ဦးဥတ္တမရုပ်တုမှ ပွိုင့်သို့'),
    intro: T('Line up at the U Ottama statue, then race to View Point. Cars, flying and boats all allowed. First one there wins.', 'ဦးဥတ္တမရုပ်တုတွင် စုပြီး View Point သို့ ပြိုင်ပါ။ အရင်ရောက်သူ နိုင်သည်။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 2000,
    steps: [
      { text: T('Everyone lines up at the U Ottama statue', 'ဦးဥတ္တမရုပ်တုတွင် အားလုံးစုပါ'), place: PLACES.uOttama, radius: 35, together: true },
      { text: T('Race to View Point!', 'View Point သို့ ပြိုင်ပါ!'), place: PLACES.viewPoint, radius: 40, race: true },
    ],
  },
  {
    id: 'pagoda-pair',
    icon: '🛕',
    title: T('Two pagodas walk', 'ဘုရားနှစ်ဆူ ဖူးမြော်ခြင်း'),
    intro: T('Visit Lawkanandar Pagoda together, then cross to the mirror hall of Satkyar Muni Pagoda.', 'လောကနန္ဒာဘုရားနှင့် သကျမုနိဘုရားကို အတူဖူးပါ။'),
    season: 'any',
    social: true,
    budget: 3000,
    reward: 1500,
    steps: [
      { text: T('Buy flowers at May Yu Market', 'မေယုဈေးတွင် ပန်းဝယ်ပါ'), place: PLACES.mayYu, radius: 30, action: { verb: T('Buy flowers (1,000 Ks)', 'ပန်းဝယ်ရန် (၁,၀၀၀ ကျပ်)'), cost: 1000, gives: { item: 'flowers', count: 1 } } },
      { text: T('Offer flowers at Lawkanandar Pagoda together', 'လောကနန္ဒာဘုရားတွင် ပန်းကပ်ပါ'), place: PLACES.lawkanandar, radius: 60, together: true, action: { verb: T('Offer flowers', 'ပန်းကပ်လှူရန်'), uses: { item: 'flowers', count: 1 } } },
      { text: T('Walk to Satkyar Muni Pagoda', 'သကျမုနိဘုရားသို့ လျှောက်ပါ'), place: PLACES.satkyarMuni, radius: 25, together: true },
    ],
  },
  // ---- Thadingyut, the Festival of Lights ----
  {
    id: 'thadingyut-lamps',
    icon: '🪔',
    title: T('Thadingyut: light the pagoda', 'သီတင်းကျွတ်: ဘုရားမီးထွန်း'),
    intro: T('Buy oil lamps and candles at May Yu Market and light them together at Lawkanandar Pagoda after dark.', 'မေယုဈေးတွင် ဆီမီးနှင့် ဖယောင်းတိုင်ဝယ်ပြီး ညအချိန် လောကနန္ဒာဘုရားတွင် အတူမီးထွန်းပါ။'),
    season: 'thadingyut',
    social: true,
    budget: 8000,
    reward: 3500,
    steps: [
      { text: T('Buy lamps and candles at May Yu Market', 'မေယုဈေးတွင် ဆီမီးဝယ်ပါ'), place: PLACES.mayYu, radius: 30, action: { verb: T('Buy oil lamps & candles (2,000 Ks each)', 'ဆီမီး ဝယ်ရန် (၂,၀၀၀ ကျပ်)'), cost: 2000, perPlayer: true, gives: { item: 'candles', count: 1 } } },
      { text: T('Meet at Lawkanandar Pagoda after dark', 'ညအချိန် လောကနန္ဒာဘုရားတွင် ဆုံပါ'), place: PLACES.lawkanandar, radius: 60, together: true, night: true },
      { text: T('Everyone lights their lamps', 'အားလုံး မီးထွန်းပါ'), place: PLACES.lawkanandar, radius: 60, together: true, night: true, action: { verb: T('Light the oil lamps', 'ဆီမီးထွန်းရန်'), each: true, uses: { item: 'candles', count: 1 }, fx: 'lamps' } },
    ],
  },
  {
    id: 'thadingyut-lanterns',
    icon: '🏮',
    title: T('Thadingyut: sky lanterns at Point Beach', 'သီတင်းကျွတ်: ပွိုင့်တွင် မီးပုံးပျံလွှတ်'),
    intro: T('Buy paper lanterns at May Yu Market, then release them together over the sea at Point Beach at night.', 'မေယုဈေးတွင် မီးပုံးဝယ်ပြီး ညအချိန် ပွိုင့်ကမ်းခြေတွင် အတူလွှတ်ပါ။'),
    season: 'thadingyut',
    social: true,
    budget: 10000,
    reward: 4000,
    steps: [
      { text: T('Buy sky lanterns at May Yu Market', 'မေယုဈေးတွင် မီးပုံးဝယ်ပါ'), place: PLACES.mayYu, radius: 30, action: { verb: T('Buy sky lanterns (3,000 Ks each)', 'မီးပုံးပျံဝယ်ရန် (၃,၀၀၀ ကျပ်)'), cost: 3000, perPlayer: true, gives: { item: 'lantern', count: 1 } } },
      { text: T('Gather at Point Beach after dark', 'ညအချိန် ပွိုင့်ကမ်းခြေတွင် စုပါ'), place: PLACES.viewPoint, radius: 60, together: true, night: true },
      { text: T('Release your lanterns', 'မီးပုံးပျံ လွှတ်ပါ'), place: PLACES.viewPoint, radius: 60, together: true, night: true, action: { verb: T('Release the sky lantern', 'မီးပုံးပျံလွှတ်ရန်'), each: true, uses: { item: 'lantern', count: 1 }, fx: 'lanterns' } },
      { text: T('Watch the fireworks over the sea', 'ပင်လယ်ပေါ် မီးပန်းကြည့်ပါ'), place: PLACES.viewPoint, radius: 60, together: true, night: true, action: { verb: T('Start the fireworks', 'မီးပန်းဖောက်ရန်'), fx: 'fireworks' } },
    ],
  },
  {
    id: 'thadingyut-gadaw',
    icon: '🙏',
    title: T('Thadingyut: pay respects to elders', 'သီတင်းကျွတ်: သက်ကြီးဝါကြီး ကန်တော့'),
    intro: T('Thadingyut is the time to thank parents, teachers and elders (gadaw). Buy a fruit offering and bring it home.', 'သီတင်းကျွတ်တွင် မိဘ ဆရာသမားနှင့် သက်ကြီးဝါကြီးများကို ကန်တော့ကြသည်။ သစ်သီးဝယ်ပြီး အိမ်သို့ယူသွားပါ။'),
    season: 'thadingyut',
    social: false,
    budget: 5000,
    reward: 2500,
    steps: [
      { text: T('Buy a fruit offering at Golden Fish Mini Market', 'Golden Fish စတိုးတွင် သစ်သီးဝယ်ပါ'), place: PLACES.goldenFish, radius: 20, action: { verb: T('Buy fruit offering (3,000 Ks)', 'သစ်သီးဝယ်ရန် (၃,၀၀၀ ကျပ်)'), cost: 3000, gives: { item: 'fruit', count: 1 } } },
      { text: T('Bring it home and pay respects', 'အိမ်သို့ယူသွားပြီး ကန်တော့ပါ'), place: PLACES.home, radius: 14, action: { verb: T('Gadaw — pay respects to your elders', 'ကန်တော့ရန်'), uses: { item: 'fruit', count: 1 }, fx: 'gadaw' } },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export interface PlayerPos {
  id: string;
  name: string;
  x: number;
  z: number;
}

/** Shared mission state (sent from the host to every guest). */
export interface MissionState {
  id: string | null;
  step: number;
  items: Partial<Record<ItemId, number>>;
  budget: number;
  /** Players who already did an `each` action on this step. */
  acted: string[];
  /** Increments with every event, so guests show each event once. */
  n: number;
  event: { text: Text; fx?: FxKind; x?: number; z?: number } | null;
  /** Set when finished: kyat each player earns, and the race winner if any. */
  done: { reward: number; winner?: string; winnerName?: string; at: number } | null;
}

export function emptyState(): MissionState {
  return { id: null, step: 0, items: {}, budget: 0, acted: [], n: 0, event: null, done: null };
}

export interface MissionContext {
  /** Everyone in the team (just you when playing solo). */
  players: PlayerPos[];
  /** Game clock, 0–24. */
  hours: number;
  /** Position of a place, or null if it is not on this map. */
  place: (ref: PlaceRef) => { x: number; z: number } | null;
}

/** Extra kyat for whoever wins a race. */
export const RACE_WIN_BONUS = 1000;

export const isNight = (h: number) => h >= 18 || h < 5;
export const isSunset = (h: number) => h >= 17 && h < 19;

function near(p: PlayerPos, at: { x: number; z: number }, r: number): boolean {
  return Math.hypot(p.x - at.x, p.z - at.z) <= r;
}

/** Why a step cannot progress right now (shown in the tracker), or null if it can. */
export function blocker(step: MissionStep, ctx: MissionContext, at: { x: number; z: number }): Text | null {
  if (step.night && !isNight(ctx.hours)) return T('Wait for dark (after 18:00)', 'မှောင်သည်အထိ စောင့်ပါ (၁၈:၀၀ နောက်)');
  if (step.together) {
    const away = ctx.players.filter((p) => !near(p, at, step.radius));
    if (away.length) return T(`Waiting for ${away.map((p) => p.name).join(', ')}`, `${away.map((p) => p.name).join('၊ ')} ကို စောင့်နေသည်`);
  }
  return null;
}

/** Runs one mission for the team. The host (or solo player) owns the only engine. */
export class MissionEngine {
  state: MissionState = emptyState();

  get def(): MissionDef | undefined {
    return this.state.id ? missionById(this.state.id) : undefined;
  }

  get currentStep(): MissionStep | undefined {
    const d = this.def;
    return d && !this.state.done ? d.steps[this.state.step] : undefined;
  }

  start(id: string, festival: boolean): Text | null {
    const def = missionById(id);
    if (!def) return T('Unknown mission', 'မသိသော မစ်ရှင်');
    if (def.season === 'thadingyut' && !festival) return T('This mission is only during Thadingyut', 'ဤမစ်ရှင်သည် သီတင်းကျွတ်အတွင်းသာ');
    this.state = { ...emptyState(), id, budget: def.budget, n: this.state.n + 1, event: { text: def.title } };
    return null;
  }

  quit(): void {
    this.state = { ...emptyState(), n: this.state.n + 1 };
  }

  private emit(text: Text, fx?: FxKind, at?: { x: number; z: number }): void {
    this.state.n++;
    this.state.event = { text, ...(fx ? { fx } : {}), ...(at ? { x: at.x, z: at.z } : {}) };
  }

  private advance(ctx: MissionContext, winner?: PlayerPos): void {
    const def = this.def!;
    this.state.step = winner ? def.steps.length : this.state.step + 1;
    this.state.acted = [];
    if (this.state.step < def.steps.length) return;
    const bonus = def.sunsetBonus && isSunset(ctx.hours) ? def.sunsetBonus : 0;
    const reward = def.reward + bonus;
    const ks = reward.toLocaleString('en-US');
    this.state.done = { reward, at: Date.now(), ...(winner ? { winner: winner.id, winnerName: winner.name } : {}) };
    const head = winner ? `🏁 ${winner.name} wins the race! ` : '';
    const headR = winner ? `🏁 ${winner.name} ပြိုင်ပွဲနိုင်သည်! ` : '';
    this.emit(T(`${head}Mission complete! +${ks} Ks${bonus ? ' (sunset bonus)' : ''}${winner ? ` · winner +${RACE_WIN_BONUS.toLocaleString('en-US')} Ks` : ''}`, `${headR}မစ်ရှင်ပြီးပါပြီ! +${ks} ကျပ်`), winner ? 'fireworks' : undefined, winner ? ctx.place(def.steps[def.steps.length - 1]!.place) ?? undefined : undefined);
  }

  /** Checks arrival steps; call a few times per second. */
  update(ctx: MissionContext): void {
    const step = this.currentStep;
    if (!step || step.action) return;
    const at = ctx.place(step.place);
    if (!at) return;
    if (blocker(step, ctx, at)) return;
    const arrived = ctx.players.filter((p) => near(p, at, step.radius));
    if (!arrived.length) return;
    if (step.race) {
      // Players are listed in a stable order; the first one inside the finish wins.
      this.advance(ctx, arrived[0]!);
      return;
    }
    this.emit(step.text, undefined, at);
    this.advance(ctx);
  }

  /** What E would do for this player right now (for the on-screen prompt), or null. */
  actionFor(playerId: string, ctx: MissionContext): Text | null {
    const step = this.currentStep;
    if (!step?.action) return null;
    const at = ctx.place(step.place);
    const p = ctx.players.find((v) => v.id === playerId);
    if (!at || !p || !near(p, at, step.radius)) return null;
    if (step.action.each && this.state.acted.includes(playerId)) return null;
    return step.action.verb;
  }

  /** A player pressed E. Returns a message when it did not work. */
  act(playerId: string, ctx: MissionContext): Text | null {
    const step = this.currentStep;
    if (!step?.action) return null;
    const a = step.action;
    const at = ctx.place(step.place);
    const p = ctx.players.find((v) => v.id === playerId);
    if (!at || !p || !near(p, at, step.radius)) return null;
    const why = blocker(step, ctx, at);
    if (why) return why;
    if (a.each && this.state.acted.includes(playerId)) return T('You already did this — wait for the others', 'ပြီးပါပြီ — အခြားသူများကို စောင့်ပါ');
    const team = Math.max(1, ctx.players.length);
    const times = a.perPlayer && !a.each ? team : 1;
    const cost = (a.cost ?? 0) * times;
    if (cost > this.state.budget) return T('Not enough money in the team budget', 'ငွေမလုံလောက်ပါ');
    if (a.uses) {
      const need = a.uses.count * times;
      if ((this.state.items[a.uses.item] ?? 0) < need) return T(`You need ${ITEMS[a.uses.item].name.en}`, `${ITEMS[a.uses.item].name.rki} လိုအပ်သည်`);
      this.state.items[a.uses.item] = (this.state.items[a.uses.item] ?? 0) - need;
    }
    this.state.budget -= cost;
    if (a.gives) this.state.items[a.gives.item] = (this.state.items[a.gives.item] ?? 0) + a.gives.count * times;
    const who = p.name;
    this.emit(T(`${who}: ${a.verb.en}`, `${who}: ${a.verb.rki}`), a.fx, a.fx === 'cheers' || a.fx === 'gadaw' ? { x: p.x, z: p.z } : at);
    if (a.each) {
      this.state.acted.push(playerId);
      if (!ctx.players.every((v) => this.state.acted.includes(v.id))) return null;
    }
    this.advance(ctx);
    return null;
  }
}

/** Accepts only well-formed state from the network. */
export function validMissionState(raw: unknown): raw is MissionState {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as MissionState;
  if (s.id !== null && (typeof s.id !== 'string' || !missionById(s.id))) return false;
  if (!Number.isInteger(s.step) || s.step < 0 || s.step > 20) return false;
  if (!Number.isInteger(s.n) || s.n < 0 || !Number.isFinite(s.budget) || s.budget < 0 || s.budget > 1e7) return false;
  if (!s.items || typeof s.items !== 'object' || Object.entries(s.items).some(([k, v]) => !(k in ITEMS) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > 100)) return false;
  if (!Array.isArray(s.acted) || s.acted.length > 16 || s.acted.some((a) => typeof a !== 'string' || a.length > 100)) return false;
  if (s.event !== null && (typeof s.event !== 'object' || typeof s.event.text?.en !== 'string' || s.event.text.en.length > 300 || typeof s.event.text.rki !== 'string' || s.event.text.rki.length > 300)) return false;
  if (s.done !== null && (typeof s.done !== 'object' || !Number.isFinite(s.done.reward) || s.done.reward < 0 || s.done.reward > 1e6)) return false;
  return true;
}

/** Per-device progress: wallet, completions and the festival switch. */
export interface MissionProgress {
  v: 1;
  kyat: number;
  done: Record<string, number>;
  festival: 'auto' | 'on' | 'off';
}

const KEY = 'sittwe3d.missions.v1';

export function loadProgress(store: Pick<Storage, 'getItem'> | null): MissionProgress {
  const base: MissionProgress = { v: 1, kyat: 0, done: {}, festival: 'auto' };
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<MissionProgress> | null;
    if (!raw || raw.v !== 1) return base;
    return {
      v: 1,
      kyat: Number.isFinite(raw.kyat) && raw.kyat! >= 0 ? Math.floor(raw.kyat!) : 0,
      done: raw.done && typeof raw.done === 'object' ? Object.fromEntries(Object.entries(raw.done).filter(([k, n]) => missionById(k) && Number.isInteger(n) && n > 0)) : {},
      festival: raw.festival === 'on' || raw.festival === 'off' ? raw.festival : 'auto',
    };
  } catch {
    return base;
  }
}

export function saveProgress(store: Pick<Storage, 'setItem'> | null, p: MissionProgress): void {
  try {
    store?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* Storage can be blocked; progress then lasts for this visit only. */
  }
}
