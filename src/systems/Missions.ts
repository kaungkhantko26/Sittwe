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
  /** `each` actions must all happen within a few seconds of each other (e.g. cheers together). */
  sync?: boolean;
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
  /** Items scattered around the place; walk over them to pick up. Competitive: most pickups wins. */
  collect?: { item: ItemId; count: number; spread: number; competitive?: boolean };
  /** Tag: whoever is "IT" passes it by touching someone; least time as IT wins. */
  tag?: { seconds: number };
  /** Hide and seek: the seeker waits, then has a time limit to find everyone. */
  hide?: { hideSeconds: number; seekSeconds: number };
  /** Lineup steps: everyone must be riding this (e.g. a motorbike race). */
  ride?: Ride;
  /**
   * Checkpoint race: a countdown from the lineup, then each racer passes the
   * checkpoints in order and finishes at the step's place. Ranked by time.
   */
  circuit?: { checkpoints: Array<{ place: PlaceRef; radius: number }>; countdown: number; ride?: Ride; timeLimit: number };
}

export type Ride = 'car' | 'motorbike' | 'bicycle' | 'tuktuk';

export interface MissionDef {
  id: string;
  title: Text;
  intro: Text;
  icon: string;
  season: 'any' | 'thadingyut';
  /** Shown as "best with friends". */
  social: boolean;
  /** Friends-only missions need this many players in a room. */
  minPlayers?: number;
  budget: number;
  reward: number;
  /** Extra kyat when finished at sunset (17:00–19:00). */
  sunsetBonus?: number;
  steps: MissionStep[];
}

export type ItemId = 'beer' | 'seafood' | 'coffee' | 'candles' | 'lantern' | 'fruit' | 'flowers' | 'driftwood' | 'shell';
export type FxKind = 'cheers' | 'lamps' | 'lanterns' | 'fireworks' | 'feast' | 'gadaw' | 'campfire' | 'dance' | 'pickup' | 'tag' | 'sit';

export const ITEMS: Record<ItemId, { icon: string; name: Text }> = {
  beer: { icon: '🍺', name: { en: 'Myanmar Beer', rki: 'မြန်မာဘီယာ' } },
  seafood: { icon: '🦐', name: { en: 'Seafood platter', rki: 'ပင်လယ်စာ' } },
  coffee: { icon: '☕', name: { en: 'Coffee', rki: 'ကော်ဖီ' } },
  candles: { icon: '🕯️', name: { en: 'Oil lamps & candles', rki: 'ဆီမီးနန့် ဖယောင်းတိုင်' } },
  lantern: { icon: '🏮', name: { en: 'Paper sky lantern', rki: 'မီးပုံးပျံ' } },
  fruit: { icon: '🍌', name: { en: 'Fruit offering', rki: 'သစ်သီးလက်ဆောင်' } },
  driftwood: { icon: '🪵', name: { en: 'Driftwood', rki: 'ပင်လယ်ထင်း' } },
  shell: { icon: '🐚', name: { en: 'Sea shell', rki: 'ခရုခွံ' } },
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
  danyawaddyStadium: 'node/12382017184', // Danyawaddy Stadium
  home: 'home',
  /** The beach campfire near Sittwe Point (placed on the sand at load). */
  campfire: 'campfire',
} as const;

const T = (en: string, rki: string): Text => ({ en, rki });

export const MISSIONS: MissionDef[] = [
  {
    id: 'point-beers',
    minPlayers: 2,
    icon: '🍻',
    title: T('Sunset beers at Point Beach', 'ပွိုင့်ကမ်းခြေ နီဝင်ချိန်မှာ ဘီယာသောက်ဖို့'),
    intro: T('Buy beer at Golden Fish Mini Market, meet your friends at Point Beach and drink together. Finish at sunset for a bonus.', 'Golden Fish စတိုးမှာ ဘီယာဝယ်ပြီး ပွိုင့်ကမ်းခြေမှာ အပေါင်းအသင်းတိနန့် အတူသောက်ကတ်မေ။ နီဝင်ချိန်မှာ ပြီးကေ ဆုကြေးအပိုရဖို့။'),
    season: 'any',
    social: true,
    budget: 12000,
    reward: 3000,
    sunsetBonus: 1500,
    steps: [
      { text: T('Go to Golden Fish Mini Market', 'Golden Fish စတိုးကို လားပါ'), place: PLACES.goldenFish, radius: 20 },
      { text: T('Buy beer for everyone', 'အဖွဲ့သားတိအားလုံးအတွက် ဘီယာဝယ်ပါ'), place: PLACES.goldenFish, radius: 20, action: { verb: T('Buy Myanmar Beer (2,500 Ks each)', 'မြန်မာဘီယာ ဝယ်ဖို့ (တဗူး ၂,၅၀၀ ကျပ်)'), cost: 2500, perPlayer: true, gives: { item: 'beer', count: 1 } } },
      { text: T('Meet everyone at Point Beach', 'ပွိုင့်ကမ်းခြေမှာ အားလုံးဆုံကတ်ပါ'), place: PLACES.viewPoint, radius: 60, together: true },
      { text: T('Cheers! Everyone drinks', 'ချီးယားစ်! အားလုံး သောက်ကတ်မေ'), place: PLACES.viewPoint, radius: 60, together: true, action: { verb: T('Drink your beer — cheers! (all within 5 s)', 'ဘီယာသောက်ဖို့ — ချီးယားစ်! (၅ စက္ကန့်အတွင်း အားလုံး)'), each: true, sync: true, uses: { item: 'beer', count: 1 }, fx: 'cheers' } },
    ],
  },
  {
    id: 'bay-seafood',
    minPlayers: 2,
    icon: '🦐',
    title: T('Seafood dinner at The Bay', 'The Bay မှာ ပင်လယ်စာညစာ'),
    intro: T('Ride together to The Bay near Sittwe Point and share a seafood dinner.', 'ပွိုင့်နားက The Bay ကို အတူလားပြီး ပင်လယ်စာ စားကတ်မေ။'),
    season: 'any',
    social: true,
    budget: 20000,
    reward: 2500,
    steps: [
      { text: T('Everyone meets at The Bay', 'The Bay မှာ အားလုံးဆုံကတ်ပါ'), place: PLACES.theBay, radius: 30, together: true },
      { text: T('Order the seafood platter', 'ပင်လယ်စာ မှာပါ'), place: PLACES.theBay, radius: 30, together: true, action: { verb: T('Order seafood (15,000 Ks)', 'ပင်လယ်စာ မှာဖို့ (၁၅,၀၀၀ ကျပ်)'), cost: 15000, gives: { item: 'seafood', count: 1 }, fx: 'feast' } },
      { text: T('Watch the sea from View Point', 'View Point က ပင်လယ်ကို ကြည့်ကတ်မေ'), place: PLACES.viewPoint, radius: 60 },
    ],
  },
  {
    id: 'coffee-run',
    icon: '☕',
    title: T('Coffee run to the pagoda', 'ဘုရားကို ကော်ဖီပို့ဖို့'),
    intro: T('Pick up coffee at Cafe de Sittwe and bring it to your friends at Lawkanandar Pagoda before it gets cold.', 'Cafe de Sittwe က ကော်ဖီဝယ်ပြီး မအေးခင် လောကနန္ဒာဘုရားမှာ ဟိရေ အပေါင်းအသင်းတိကို ပို့ပါ။'),
    season: 'any',
    social: false,
    budget: 6000,
    reward: 1500,
    steps: [
      { text: T('Go to Cafe de Sittwe', 'Cafe de Sittwe ကို လားပါ'), place: PLACES.cafeDeSittwe, radius: 25 },
      { text: T('Buy coffee', 'ကော်ဖီဝယ်ပါ'), place: PLACES.cafeDeSittwe, radius: 25, action: { verb: T('Buy coffee (1,500 Ks each)', 'ကော်ဖီဝယ်ဖို့ (တခွက် ၁,၅၀၀ ကျပ်)'), cost: 1500, perPlayer: true, gives: { item: 'coffee', count: 1 } } },
      { text: T('Deliver it to Lawkanandar Pagoda', 'လောကနန္ဒာဘုရားကို ပို့ပါ'), place: PLACES.lawkanandar, radius: 60, action: { verb: T('Share the coffee', 'ကော်ဖီ မျှသောက်ဖို့'), uses: { item: 'coffee', count: 1 }, perPlayer: true, fx: 'cheers' } },
    ],
  },
  {
    id: 'race-point',
    minPlayers: 2,
    icon: '🏁',
    title: T('Race: U Ottama statue to the Point', 'ပြိုင်ပွဲ: ဦးဥတ္တမရုပ်တုက ပွိုင့်အထိ'),
    intro: T('Line up at the U Ottama statue, then race to View Point. Cars, flying and boats all allowed. First one there wins.', 'ဦးဥတ္တမရုပ်တုမှာ စုကတ်ပြီး View Point အထိ ပြိုင်ကတ်မေ။ ကား၊ လီယာဉ်နန့် လှေ အကုန်သုံးလို့ရရေ။ အယင်ရောက်ရေလူ နိုင်ဖို့။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 2000,
    steps: [
      { text: T('Everyone lines up at the U Ottama statue', 'ဦးဥတ္တမရုပ်တုမှာ အားလုံးစုကတ်ပါ'), place: PLACES.uOttama, radius: 35, together: true },
      { text: T('Race to View Point!', 'View Point အထိ ပြိုင်ကတ်မေ!'), place: PLACES.viewPoint, radius: 40, race: true },
    ],
  },
  {
    id: 'bike-race-town',
    minPlayers: 2,
    icon: '🏍️',
    title: T('Motorbike race: town loop', 'မော်တော်ဆိုင်ကယ်ပြိုင်ပွဲ: မြို့ပတ်'),
    intro: T('Everyone on a motorbike (press B for one) at the Clock Tower. After the countdown, ride through May Yu Market, Lawkanandar Pagoda and Danyawaddy Stadium, then back to the Clock Tower. Fastest time wins.', 'နာရီစင်မှာ အားလုံး မော်တော်ဆိုင်ကယ်နန့် စုကတ်ပါ (B နှိပ်ကေ ရဖို့)။ ရေတွက်ပြီးကေ မေယုဈေး၊ လောကနန္ဒာဘုရား၊ ဓညဝတီကွင်း ဖြတ်ပြီး နာရီစင်ကို ပြန်လာကတ်မေ။ အမြန်ဆုံးလူ နိုင်ဖို့။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 2500,
    steps: [
      { text: T('Line up at the Clock Tower on your motorbikes', 'နာရီစင်မှာ ဆိုင်ကယ်နန့် စုကတ်ပါ'), place: PLACES.clockTower, radius: 30, together: true, ride: 'motorbike' },
      {
        text: T('Race! Checkpoints, then back to the Clock Tower', 'ပြိုင်ကတ်! စစ်ဆေးမှတ်တိ ဖြတ်ပြီး နာရီစင်ကို ပြန်လာ'),
        place: PLACES.clockTower,
        radius: 30,
        circuit: {
          checkpoints: [
            { place: PLACES.mayYu, radius: 40 },
            { place: PLACES.lawkanandar, radius: 70 },
            { place: PLACES.danyawaddyStadium, radius: 60 },
          ],
          countdown: 3,
          ride: 'motorbike',
          timeLimit: 480,
        },
      },
    ],
  },
  {
    id: 'pagoda-pair',
    icon: '🛕',
    title: T('Two pagodas walk', 'ဘုရားနှစ်ဆူ လားဖူးဖို့'),
    intro: T('Visit Lawkanandar Pagoda together, then cross to the mirror hall of Satkyar Muni Pagoda.', 'လောကနန္ဒာဘုရားကို အတူဖူးပြီး သကျမုနိဘုရားက မှန်ကျောင်းဆောင်ကို လားကတ်မေ။'),
    season: 'any',
    social: true,
    budget: 3000,
    reward: 1500,
    steps: [
      { text: T('Buy flowers at May Yu Market', 'မေယုဈေးမှာ ပန်းဝယ်ပါ'), place: PLACES.mayYu, radius: 30, action: { verb: T('Buy flowers (1,000 Ks)', 'ပန်းဝယ်ဖို့ (၁,၀၀၀ ကျပ်)'), cost: 1000, gives: { item: 'flowers', count: 1 } } },
      { text: T('Offer flowers at Lawkanandar Pagoda together', 'လောကနန္ဒာဘုရားမှာ အတူပန်းကပ်ကတ်ပါ'), place: PLACES.lawkanandar, radius: 60, together: true, action: { verb: T('Offer flowers', 'ပန်းကပ်လှူဖို့'), uses: { item: 'flowers', count: 1 } } },
      { text: T('Walk to Satkyar Muni Pagoda', 'သကျမုနိဘုရားကို လမ်းလျှောက်လားပါ'), place: PLACES.satkyarMuni, radius: 25, together: true },
    ],
  },
  // ---- Friends-only mini-games ----
  {
    id: 'campfire-night',
    minPlayers: 2,
    icon: '🔥',
    title: T('Beach campfire night', 'ကမ်းခြေ မီးပုံပွဲည'),
    intro: T('Collect driftwood along Point Beach, light the campfire together after dark, sit around it and dance.', 'ပွိုင့်ကမ်းခြေမှာ ပင်လယ်ထင်း ကောက်ပြီး ညမှောင်ရေအခါ မီးပုံ အတူမွှေးကတ်၊ ထိုင်ပြီး ကကတ်မေ။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 3500,
    steps: [
      { text: T('Collect 5 pieces of driftwood on the beach', 'ကမ်းခြေမှာ ပင်လယ်ထင်း ၅ ချောင်း ကောက်ပါ'), place: PLACES.campfire, radius: 200, collect: { item: 'driftwood', count: 5, spread: 110 } },
      { text: T('Light the campfire together after dark', 'ညမှောင်ရေအခါ မီးပုံ အတူမွှေးပါ'), place: PLACES.campfire, radius: 9, together: true, night: true, action: { verb: T('Light the campfire', 'မီးပုံ မွှေးဖို့'), uses: { item: 'driftwood', count: 5 }, fx: 'campfire' } },
      { text: T('Everyone sits by the fire', 'အားလုံး မီးပုံဘေးမှာ ထိုင်ကတ်'), place: PLACES.campfire, radius: 9, together: true, action: { verb: T('Sit by the fire', 'မီးပုံဘေး ထိုင်ဖို့'), each: true, fx: 'sit' } },
      { text: T('Dance around the fire together!', 'မီးပုံပတ်ပြီး အတူ ကကတ်!'), place: PLACES.campfire, radius: 12, together: true, action: { verb: T('Dance! (all within 5 s)', 'ကဖို့! (၅ စက္ကန့်အတွင်း)'), each: true, sync: true, fx: 'dance' } },
    ],
  },
  {
    id: 'shell-hunt',
    minPlayers: 2,
    icon: '🐚',
    title: T('Shell treasure hunt', 'ခရုခွံ ရှာပွဲ'),
    intro: T('Ten shells are hidden on the sand along Point Beach, around the campfire. Grab them before your friends do — most shells wins.', 'ပွိုင့်ကမ်းခြေမှာ ခရုခွံ ၁၀ ခု ဝှက်ထားရေ။ အများဆုံး ကောက်ရသူ နိုင်ရေ။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 2500,
    steps: [
      { text: T('Grab the most shells!', 'ခရုခွံ အများဆုံး ကောက်ပါ!'), place: PLACES.campfire, radius: 300, collect: { item: 'shell', count: 10, spread: 150, competitive: true } },
    ],
  },
  {
    id: 'tag-point',
    minPlayers: 2,
    icon: '🏃',
    title: T('Tag at the Point', 'ပွိုင့်မှာ ဖမ်းတမ်းကစား'),
    intro: T('One player is IT and passes it by touching someone. After 2 minutes, whoever was IT the least wins. Stay near View Point!', 'IT ဖြစ်ရေလူက တခြားလူကို ထိရေ။ ၂ မိနစ်ပြီးရေအခါ IT အနည်းဆုံးဖြစ်ခရေလူ နိုင်ရေ။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 2000,
    steps: [
      { text: T('Everyone meets at View Point', 'View Point မှာ အားလုံးဆုံကတ်'), place: PLACES.viewPoint, radius: 45, together: true },
      { text: T('Tag! Don\'t be IT when time runs out', 'ဖမ်းတမ်း! အချိန်ကုန်ရေအခါ IT မဖြစ်စီနန့်'), place: PLACES.viewPoint, radius: 200, tag: { seconds: 120 } },
    ],
  },
  {
    id: 'hide-seek',
    minPlayers: 2,
    icon: '🙈',
    title: T('Hide and seek at the Point', 'ပွိုင့်မှာ ပုန်းတမ်းကစား'),
    intro: T('Meet at View Point. The seeker\'s screen goes dark for 25 s while everyone hides; then they have 3 minutes to find you.', 'View Point မှာဆုံပါ။ ရှာမည့်သူ မျက်စိမှိတ်ထားစဉ် ပုန်းကတ်၊ ပြီးရင် ၃ မိနစ်အတွင်း ရှာရေ။'),
    season: 'any',
    social: true,
    budget: 0,
    reward: 2500,
    steps: [
      { text: T('Everyone meets at View Point', 'View Point မှာ အားလုံးဆုံကတ်'), place: PLACES.viewPoint, radius: 45, together: true },
      { text: T('Hide and seek!', 'ပုန်းတမ်း!'), place: PLACES.viewPoint, radius: 250, hide: { hideSeconds: 25, seekSeconds: 180 } },
    ],
  },
  // ---- Thadingyut, the Festival of Lights ----
  {
    id: 'thadingyut-lamps',
    icon: '🪔',
    title: T('Thadingyut: light the pagoda', 'သီတင်းကျွတ်: ဘုရားမီးထွန်း'),
    intro: T('Buy oil lamps and candles at May Yu Market and light them together at Lawkanandar Pagoda after dark.', 'မေယုဈေးမှာ ဆီမီးနန့် ဖယောင်းတိုင်ဝယ်ပြီး မှောင်လာကေ လောကနန္ဒာဘုရားမှာ အတူမီးထွန်းကတ်မေ။'),
    season: 'thadingyut',
    social: true,
    budget: 8000,
    reward: 3500,
    steps: [
      { text: T('Buy lamps and candles at May Yu Market', 'မေယုဈေးမှာ ဆီမီးဝယ်ပါ'), place: PLACES.mayYu, radius: 30, action: { verb: T('Buy oil lamps & candles (2,000 Ks each)', 'ဆီမီး ဝယ်ဖို့ (တယောက် ၂,၀၀၀ ကျပ်)'), cost: 2000, perPlayer: true, gives: { item: 'candles', count: 1 } } },
      { text: T('Meet at Lawkanandar Pagoda after dark', 'မှောင်လာကေ လောကနန္ဒာဘုရားမှာ ဆုံကတ်ပါ'), place: PLACES.lawkanandar, radius: 60, together: true, night: true },
      { text: T('Everyone lights their lamps', 'အားလုံး မီးထွန်းကတ်မေ'), place: PLACES.lawkanandar, radius: 60, together: true, night: true, action: { verb: T('Light the oil lamps', 'ဆီမီးထွန်းဖို့'), each: true, uses: { item: 'candles', count: 1 }, fx: 'lamps' } },
    ],
  },
  {
    id: 'thadingyut-lanterns',
    minPlayers: 2,
    icon: '🏮',
    title: T('Thadingyut: sky lanterns at Point Beach', 'သီတင်းကျွတ်: ပွိုင့်မှာ မီးပုံးပျံလွှတ်ဖို့'),
    intro: T('Buy paper lanterns at May Yu Market, then release them together over the sea at Point Beach at night.', 'မေယုဈေးမှာ မီးပုံးပျံဝယ်ပြီး ညအချိန် ပွိုင့်ကမ်းခြေမှာ အတူလွှတ်ကတ်မေ။'),
    season: 'thadingyut',
    social: true,
    budget: 10000,
    reward: 4000,
    steps: [
      { text: T('Buy sky lanterns at May Yu Market', 'မေယုဈေးမှာ မီးပုံးပျံဝယ်ပါ'), place: PLACES.mayYu, radius: 30, action: { verb: T('Buy sky lanterns (3,000 Ks each)', 'မီးပုံးပျံဝယ်ဖို့ (တလုံး ၃,၀၀၀ ကျပ်)'), cost: 3000, perPlayer: true, gives: { item: 'lantern', count: 1 } } },
      { text: T('Gather at Point Beach after dark', 'မှောင်လာကေ ပွိုင့်ကမ်းခြေမှာ စုကတ်ပါ'), place: PLACES.viewPoint, radius: 60, together: true, night: true },
      { text: T('Release your lanterns', 'မီးပုံးပျံ လွှတ်ကတ်မေ'), place: PLACES.viewPoint, radius: 60, together: true, night: true, action: { verb: T('Release the sky lantern', 'မီးပုံးပျံလွှတ်ဖို့'), each: true, uses: { item: 'lantern', count: 1 }, fx: 'lanterns' } },
      { text: T('Watch the fireworks over the sea', 'ပင်လယ်ပေါ်က မီးပန်းတိကို ကြည့်ကတ်မေ'), place: PLACES.viewPoint, radius: 60, together: true, night: true, action: { verb: T('Start the fireworks', 'မီးပန်းဖောက်ဖို့'), fx: 'fireworks' } },
    ],
  },
  {
    id: 'thadingyut-gadaw',
    icon: '🙏',
    title: T('Thadingyut: pay respects to elders', 'သီတင်းကျွတ်: သက်ကြီးဝါကြီး ကန်တော့'),
    intro: T('Thadingyut is the time to thank parents, teachers and elders (gadaw). Buy a fruit offering and bring it home.', 'သီတင်းကျွတ်မှာ မိဘ၊ ဆရာသမားနန့် သက်ကြီးဝါကြီးတိကို ကျေးဇူးတင် ကန်တော့ကတ်ရေ။ သစ်သီးဝယ်ပြီး အိမ်ကို ယူလားပါ။'),
    season: 'thadingyut',
    social: false,
    budget: 5000,
    reward: 2500,
    steps: [
      { text: T('Buy a fruit offering at Golden Fish Mini Market', 'Golden Fish စတိုးမှာ သစ်သီးဝယ်ပါ'), place: PLACES.goldenFish, radius: 20, action: { verb: T('Buy fruit offering (3,000 Ks)', 'သစ်သီးဝယ်ဖို့ (၃,၀၀၀ ကျပ်)'), cost: 3000, gives: { item: 'fruit', count: 1 } } },
      { text: T('Bring it home and pay respects', 'အိမ်ကို ယူလားပြီး ကန်တော့ပါ'), place: PLACES.home, radius: 14, action: { verb: T('Gadaw — pay respects to your elders', 'ကန်တော့ဖို့'), uses: { item: 'fruit', count: 1 }, fx: 'gadaw' } },
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
  /** What they are driving or riding, if anything. */
  ride?: Ride | null;
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
  /** Mini-games. Pickups are [x, z, takenBy-index-or--1] triples. */
  pickups: number[];
  scores: Record<string, number>;
  /** Tag: who is IT, and how long each player has been IT (s). */
  it: string | null;
  itTime: Record<string, number>;
  /** Hide and seek. */
  seeker: string | null;
  phase: 'hide' | 'seek' | 'countdown' | 'racing' | null;
  found: string[];
  /** Timers (ms since epoch). */
  endsAt: number | null;
  lastTick: number;
  lastTag: number;
  /** First `sync` action time (ms). */
  syncStart: number;
  /** Checkpoint race: start time (ms, after the countdown), finishers in order with their times, last countdown number shown. */
  goAt?: number | null;
  finish?: Array<{ id: string; ms: number }>;
  beat?: number;
}

export function emptyState(): MissionState {
  return { id: null, step: 0, items: {}, budget: 0, acted: [], n: 0, event: null, done: null, pickups: [], scores: {}, it: null, itTime: {}, seeker: null, phase: null, found: [], endsAt: null, lastTick: 0, lastTag: 0, syncStart: 0 };
}

export interface MissionContext {
  /** Everyone in the team (just you when playing solo). */
  players: PlayerPos[];
  /** Game clock, 0–24. */
  hours: number;
  /** Position of a place, or null if it is not on this map. */
  place: (ref: PlaceRef) => { x: number; z: number } | null;
  /** Current time (ms); defaults to Date.now(). */
  now?: number;
  /** Free spots to scatter pickups around a point (beach sand where possible). */
  scatter?: (x: number, z: number, count: number, spread: number) => Array<[number, number]>;
}

/** Extra kyat for whoever wins a race. */
export const RACE_WIN_BONUS = 1000;
/** Window for synced `each` actions (cheers together). */
export const SYNC_MS = 5000;

export const isNight = (h: number) => h >= 18 || h < 5;
export const isSunset = (h: number) => h >= 17 && h < 19;

function near(p: PlayerPos, at: { x: number; z: number }, r: number): boolean {
  return Math.hypot(p.x - at.x, p.z - at.z) <= r;
}

/** 1st, 2nd, 3rd… */
export function ordinal(n: number): string {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Race time as m:ss.t */
export function raceTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

/** Why a step cannot progress right now (shown in the tracker), or null if it can. */
export function blocker(step: MissionStep, ctx: MissionContext, at: { x: number; z: number }): Text | null {
  if (step.night && !isNight(ctx.hours)) return T('Wait for dark (after 18:00)', 'မှောင်လာရေအထိ စောင့်ပါ (၁၈:၀၀ နောက်)');
  if (step.ride) {
    const off = ctx.players.filter((p) => p.ride !== step.ride);
    if (off.length) return T(`Waiting for ${off.map((p) => p.name).join(', ')} to get on a ${step.ride} (press B)`, `${off.map((p) => p.name).join('၊ ')} ဆိုင်ကယ်စီးဖို့ စောင့်နီရေ (B)`);
  }
  if (step.together) {
    const away = ctx.players.filter((p) => !near(p, at, step.radius));
    if (away.length) return T(`Waiting for ${away.map((p) => p.name).join(', ')}`, `${away.map((p) => p.name).join('၊ ')} ကို စောင့်နီရေ`);
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

  start(id: string, festival: boolean, ctx?: MissionContext): Text | null {
    const def = missionById(id);
    if (!def) return T('Unknown mission', 'မသိရေ မစ်ရှင်');
    if (def.season === 'thadingyut' && !festival) return T('This mission is only during Thadingyut', 'ဒေမစ်ရှင်ကို သီတင်းကျွတ်အချိန်မှာရာ ကစားလို့ရရေ');
    if (def.minPlayers && (ctx?.players.length ?? 1) < def.minPlayers) return T(`Friends only: needs ${def.minPlayers}+ players — invite friends with Rooms`, `သူငယ်ချင်းတိနန့်ရာ: လူ ${def.minPlayers} ယောက်အထက် လိုရေ — Rooms ကနေ ဖိတ်ပါ`);
    this.state = { ...emptyState(), id, budget: def.budget, n: this.state.n + 1, event: { text: def.title } };
    if (ctx) this.enterStep(ctx);
    return null;
  }

  private now(ctx: MissionContext): number {
    return ctx.now ?? Date.now();
  }

  /** Sets up the mini-game of the step that just began. */
  private enterStep(ctx: MissionContext): void {
    const step = this.currentStep;
    const st = this.state;
    st.pickups = [];
    st.it = null;
    st.seeker = null;
    st.phase = null;
    st.found = [];
    st.endsAt = null;
    st.syncStart = 0;
    st.goAt = null;
    st.finish = [];
    st.beat = 0;
    if (!step) return;
    const now = this.now(ctx);
    st.lastTick = now;
    const at = ctx.place(step.place);
    const pick = () => ctx.players[Math.floor(Math.random() * ctx.players.length)]!;
    if (step.collect && at) {
      const pts = ctx.scatter?.(at.x, at.z, step.collect.count, step.collect.spread) ?? [];
      // Always place the full count, so steps that use them stay possible.
      for (let i = pts.length; i < step.collect.count; i++) pts.push([at.x + Math.cos(i * 2.4) * (8 + i * 4), at.z + Math.sin(i * 2.4) * (8 + i * 4)]);
      for (const [x, z] of pts) st.pickups.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10, -1);
      st.scores = {};
    }
    if (step.tag && ctx.players.length) {
      st.it = pick().id;
      st.itTime = {};
      st.endsAt = now + step.tag.seconds * 1000;
      st.lastTag = now;
      const it = ctx.players.find((p) => p.id === st.it)!;
      this.emit(T(`🏃 ${it.name} is IT! Run!`, `🏃 ${it.name} က IT ဖြစ်ယာ! ပြေးကတ်!`), 'tag', { x: it.x, z: it.z });
    }
    if (step.circuit) {
      st.scores = {};
      st.phase = 'countdown';
      st.goAt = now + step.circuit.countdown * 1000;
      st.endsAt = st.goAt + step.circuit.timeLimit * 1000;
      st.beat = step.circuit.countdown + 1;
    }
    if (step.hide && ctx.players.length) {
      st.seeker = pick().id;
      st.phase = 'hide';
      st.endsAt = now + step.hide.hideSeconds * 1000;
      const seeker = ctx.players.find((p) => p.id === st.seeker)!;
      this.emit(T(`🙈 ${seeker.name} is the seeker — everyone else, hide! (${step.hide.hideSeconds}s)`, `🙈 ${seeker.name} က ရှာမည့်သူ — ကျန်လူတိ ပုန်းကတ်!`));
    }
  }

  quit(): void {
    this.state = { ...emptyState(), n: this.state.n + 1 };
  }

  private emit(text: Text, fx?: FxKind, at?: { x: number; z: number }): void {
    this.state.n++;
    this.state.event = { text, ...(fx ? { fx } : {}), ...(at ? { x: at.x, z: at.z } : {}) };
  }

  private advance(ctx: MissionContext, winner?: PlayerPos, results?: Text): void {
    const def = this.def!;
    this.state.step = winner ? def.steps.length : this.state.step + 1;
    this.state.acted = [];
    if (this.state.step < def.steps.length) { this.enterStep(ctx); return; }
    const bonus = def.sunsetBonus && isSunset(ctx.hours) ? def.sunsetBonus : 0;
    const reward = def.reward + bonus;
    const ks = reward.toLocaleString('en-US');
    this.state.done = { reward, at: Date.now(), ...(winner ? { winner: winner.id, winnerName: winner.name } : {}) };
    const head = winner ? `🏆 ${winner.name} wins! ` : '';
    const headR = winner ? `🏆 ${winner.name} နိုင်လားယာ! ` : '';
    const tail = results ? ` · ${results.en}` : '';
    const tailR = results ? ` · ${results.rki}` : '';
    this.emit(T(`${head}Mission complete! +${ks} Ks${bonus ? ' (sunset bonus)' : ''}${winner ? ` · winner +${RACE_WIN_BONUS.toLocaleString('en-US')} Ks` : ''}${tail}`, `${headR}မစ်ရှင်ပြီးလားယာ! +${ks} ကျပ်${tailR}`), winner ? 'fireworks' : undefined, winner ? ctx.place(def.steps[def.steps.length - 1]!.place) ?? undefined : undefined);
  }

  /** Checks arrival steps; call a few times per second. */
  update(ctx: MissionContext): void {
    const step = this.currentStep;
    if (!step) return;
    if (step.collect) { this.updateCollect(step, ctx); return; }
    if (step.tag) { this.updateTag(step, ctx); return; }
    if (step.hide) { this.updateHide(step, ctx); return; }
    if (step.circuit) { this.updateCircuit(step, ctx); return; }
    if (step.action) {
      // Synced actions: if the team was too slow, start the round again.
      if (step.action.sync && this.state.acted.length > 0 && this.now(ctx) - this.state.syncStart > SYNC_MS && this.state.acted.length < ctx.players.length) {
        this.state.acted = [];
        this.state.syncStart = 0;
        this.emit(T('Too slow! Everyone together this time — cheers again!', 'နှေးလွန်းယာ! အားလုံး တပြိုင်နက် ထပ်ချီးယားစ်!'));
      }
      return;
    }
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

  private winnerBy(ctx: MissionContext, score: (id: string) => number, lowest = false): PlayerPos | undefined {
    let best: PlayerPos | undefined;
    for (const p of ctx.players) if (!best || (lowest ? score(p.id) < score(best.id) : score(p.id) > score(best.id))) best = p;
    return best;
  }

  private updateCollect(step: MissionStep, ctx: MissionContext): void {
    const st = this.state, c = step.collect!;
    let left = 0;
    for (let i = 0; i < st.pickups.length; i += 3) {
      if (st.pickups[i + 2]! >= 0) continue;
      const x = st.pickups[i]!, z = st.pickups[i + 1]!;
      const who = ctx.players.findIndex((p) => Math.hypot(p.x - x, p.z - z) < 2.4);
      if (who < 0) { left++; continue; }
      const p = ctx.players[who]!;
      st.pickups[i + 2] = who;
      st.items[c.item] = (st.items[c.item] ?? 0) + 1;
      st.scores[p.id] = (st.scores[p.id] ?? 0) + 1;
      const got = st.pickups.filter((_, k) => k % 3 === 2 && st.pickups[k]! >= 0).length;
      const total = st.pickups.length / 3;
      this.emit(T(`${ITEMS[c.item].icon} ${p.name} found ${ITEMS[c.item].name.en.toLowerCase()} (${got}/${total})`, `${ITEMS[c.item].icon} ${p.name} ${ITEMS[c.item].name.rki} တွိလားယာ (${got}/${total})`), 'pickup', { x, z });
    }
    if (left === 0 && st.pickups.length) this.advance(ctx, c.competitive ? this.winnerBy(ctx, (id) => st.scores[id] ?? 0) : undefined);
  }

  private updateTag(_step: MissionStep, ctx: MissionContext): void {
    const st = this.state, now = this.now(ctx);
    const dt = Math.min(1, (now - st.lastTick) / 1000);
    st.lastTick = now;
    if (!st.it) return;
    st.itTime[st.it] = (st.itTime[st.it] ?? 0) + dt;
    const it = ctx.players.find((p) => p.id === st.it);
    if (it && now - st.lastTag > 2500) {
      const touched = ctx.players.find((p) => p.id !== it.id && Math.hypot(p.x - it.x, p.z - it.z) < 1.9);
      if (touched) {
        st.it = touched.id;
        st.lastTag = now;
        this.emit(T(`👋 ${it.name} tagged ${touched.name} — ${touched.name} is IT!`, `👋 ${it.name} က ${touched.name} ကို ထိလိုက်ယာ — ${touched.name} IT ဖြစ်ယာ!`), 'tag', { x: touched.x, z: touched.z });
      }
    }
    if (st.endsAt && now >= st.endsAt) this.advance(ctx, this.winnerBy(ctx, (id) => st.itTime[id] ?? 0, true));
  }

  private updateCircuit(step: MissionStep, ctx: MissionContext): void {
    const st = this.state, c = step.circuit!, now = this.now(ctx);
    const goAt = st.goAt ?? now;
    const finish = (st.finish ??= []);
    if (now < goAt) {
      // Countdown: 3, 2, 1…
      const left = Math.ceil((goAt - now) / 1000);
      if (left < (st.beat ?? Infinity)) { st.beat = left; this.emit(T(`🏁 ${left}…`, `🏁 ${left}…`)); }
      return;
    }
    if (st.phase === 'countdown') {
      st.phase = 'racing';
      st.beat = 0;
      this.emit(T('🏁 GO! GO! GO!', '🏁 စ! စ! စ!'));
    }
    const finishAt = ctx.place(step.place);
    for (const p of ctx.players) {
      if (finish.some((f) => f.id === p.id)) continue;
      // Checkpoints only count while riding the right vehicle.
      if (c.ride && p.ride !== c.ride) continue;
      const done = st.scores[p.id] ?? 0;
      if (done < c.checkpoints.length) {
        const cp = c.checkpoints[done]!;
        const at = ctx.place(cp.place);
        if (at && near(p, at, cp.radius)) {
          st.scores[p.id] = done + 1;
          this.emit(T(`✅ ${p.name}: checkpoint ${done + 1}/${c.checkpoints.length}`, `✅ ${p.name}: စစ်ဆေးမှတ် ${done + 1}/${c.checkpoints.length}`), 'pickup', at);
        }
      } else if (finishAt && near(p, finishAt, step.radius)) {
        const ms = now - goAt;
        finish.push({ id: p.id, ms });
        this.emit(T(`🏁 ${p.name} finishes ${ordinal(finish.length)} — ${raceTime(ms)}`, `🏁 ${p.name} အဆင့် ${finish.length} — ${raceTime(ms)}`), finish.length === 1 ? 'fireworks' : 'cheers', { x: p.x, z: p.z });
      }
    }
    // Ends when everyone is in, 45 s after the winner, or at the time limit.
    const all = ctx.players.every((p) => finish.some((f) => f.id === p.id));
    const late = finish.length > 0 && now - goAt - finish[0]!.ms > 45000;
    if (all || late || (st.endsAt !== null && now >= st.endsAt)) {
      const name = (id: string) => ctx.players.find((p) => p.id === id)?.name ?? '?';
      const list = finish.map((f, i) => `${i + 1}. ${name(f.id)} ${raceTime(f.ms)}`);
      const dnf = ctx.players.filter((p) => !finish.some((f) => f.id === p.id)).map((p) => `${p.name} DNF`);
      const results = [...list, ...dnf].join(' · ');
      const winner = finish[0] ? ctx.players.find((p) => p.id === finish[0]!.id) : undefined;
      this.advance(ctx, winner, T(results, results));
    }
  }

  private updateHide(step: MissionStep, ctx: MissionContext): void {
    const st = this.state, now = this.now(ctx), h = step.hide!;
    const seeker = ctx.players.find((p) => p.id === st.seeker);
    if (!seeker) return;
    if (st.phase === 'hide' && st.endsAt && now >= st.endsAt) {
      st.phase = 'seek';
      st.endsAt = now + h.seekSeconds * 1000;
      this.emit(T(`👀 Ready or not, here ${seeker.name} comes!`, `👀 ${seeker.name} ရှာလာပြီ!`));
      return;
    }
    if (st.phase !== 'seek') return;
    for (const p of ctx.players) {
      if (p.id === seeker.id || st.found.includes(p.id)) continue;
      if (Math.hypot(p.x - seeker.x, p.z - seeker.z) < 3.5) {
        st.found.push(p.id);
        this.emit(T(`🔎 ${seeker.name} found ${p.name}!`, `🔎 ${seeker.name} က ${p.name} ကို တွိလားယာ!`), 'pickup', { x: p.x, z: p.z });
      }
    }
    const hiders = ctx.players.filter((p) => p.id !== seeker.id);
    if (hiders.every((p) => st.found.includes(p.id))) { this.advance(ctx, seeker); return; }
    if (st.endsAt && now >= st.endsAt) this.advance(ctx, hiders.find((p) => !st.found.includes(p.id)));
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
    if (a.each && this.state.acted.includes(playerId)) return T('You already did this — wait for the others', 'လုပ်ပြီးလားယာ — တခြားလူတိကို စောင့်ပါ');
    const team = Math.max(1, ctx.players.length);
    const times = a.perPlayer && !a.each ? team : 1;
    const cost = (a.cost ?? 0) * times;
    if (cost > this.state.budget) return T('Not enough money in the team budget', 'အဖွဲ့ပိုက်ဆံ မလောက်ပါ');
    if (a.uses) {
      const need = a.uses.count * times;
      if ((this.state.items[a.uses.item] ?? 0) < need) return T(`You need ${ITEMS[a.uses.item].name.en}`, `${ITEMS[a.uses.item].name.rki} လိုနီရေ`);
      this.state.items[a.uses.item] = (this.state.items[a.uses.item] ?? 0) - need;
    }
    this.state.budget -= cost;
    if (a.gives) this.state.items[a.gives.item] = (this.state.items[a.gives.item] ?? 0) + a.gives.count * times;
    const who = p.name;
    this.emit(T(`${who}: ${a.verb.en}`, `${who}: ${a.verb.rki}`), a.fx, a.fx === 'cheers' || a.fx === 'gadaw' || a.fx === 'sit' || a.fx === 'dance' ? { x: p.x, z: p.z } : at);
    if (a.each) {
      if (a.sync && !this.state.acted.length) this.state.syncStart = this.now(ctx);
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
  const id = (v: unknown) => v === null || (typeof v === 'string' && v.length < 100);
  const record = (r: unknown) => !!r && typeof r === 'object' && Object.keys(r).length <= 16 && Object.values(r as object).every((v) => Number.isFinite(v) && v >= 0 && v < 1e5);
  if (!Array.isArray(s.pickups) || s.pickups.length > 90 || s.pickups.some((v) => !Number.isFinite(v) || Math.abs(v) > 50000)) return false;
  if (!record(s.scores) || !record(s.itTime) || !id(s.it) || !id(s.seeker)) return false;
  if (s.phase !== null && !['hide', 'seek', 'countdown', 'racing'].includes(s.phase)) return false;
  if (s.goAt !== undefined && s.goAt !== null && !Number.isFinite(s.goAt)) return false;
  if (s.beat !== undefined && !Number.isFinite(s.beat)) return false;
  if (s.finish !== undefined && (!Array.isArray(s.finish) || s.finish.length > 16 || !s.finish.every((f) => f && typeof f.id === 'string' && f.id.length < 100 && Number.isFinite(f.ms) && f.ms >= 0))) return false;
  if (!Array.isArray(s.found) || s.found.length > 16 || !s.found.every((f) => typeof f === 'string' && f.length < 100)) return false;
  if (s.endsAt !== null && !Number.isFinite(s.endsAt)) return false;
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
