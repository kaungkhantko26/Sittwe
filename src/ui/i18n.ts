import type { Lang } from '../systems/Settings';

/** UI copy in English and conversational Rakhine, following the player's preferred wording. */
const STRINGS = {
  title: { en: 'SITTWE 3D', rki: 'စစ်တွေ 3D' },
  subtitle: { en: 'Explore Sittwe, Myanmar', rki: 'စစ်တွေမြို့ကို လှည့်ပတ်ကြည့်ကတ်မေ' },
  play: { en: 'Play Game', rki: 'ဂိမ်းကစားဖို့' },
  newGame: { en: 'New Game', rki: 'ဂိမ်းအသစ်' },
  continue: { en: 'Continue', rki: 'ဆက်ကစားဖို့' },
  map: { en: 'Map', rki: 'မြေပုံ' },
  settings: { en: 'Settings', rki: 'ပြင်ဆင်စရာတိ' },
  controls: { en: 'Controls', rki: 'ထိန်းချုပ်ခလုတ်တိ' },
  about: { en: 'About', rki: 'ဂိမ်းအကြောင်း' },
  loading: { en: 'Loading', rki: 'ဖွင့်နီရေ' },
  resume: { en: 'Resume', rki: 'ဂိမ်းပြန်စဖို့' },
  saveGame: { en: 'Save Game', rki: 'ဂိမ်းသိမ်းထားဖို့' },
  mainMenu: { en: 'Main Menu', rki: 'ပင်မမီနူး' },
  resetGame: { en: 'Reset Game', rki: 'ဂိမ်းအစက ပြန်စဖို့' },
  paused: { en: 'Paused', rki: 'တနားချေရပ်ထားရေ' },
  close: { en: 'Close', rki: 'ပိတ်ဖို့' },
  back: { en: 'Back', rki: 'နောက်ပြန်လားဖို့' },
  graphics: { en: 'Graphics', rki: 'ဂရပ်ဖစ်' },
  quality: { en: 'Quality', rki: 'အရည်အသွေး' },
  low: { en: 'Low', rki: 'နိမ့်' },
  medium: { en: 'Medium', rki: 'အလယ်အလတ်' },
  high: { en: 'High', rki: 'မြင့်' },
  ultra: { en: 'Ultra', rki: 'အမြင့်ဆုံး' },
  adaptiveResolution: { en: 'Adapt resolution for smoother play', rki: 'ဂိမ်းချောချောမွေ့မွေ့ ကစားရအောင် ရုပ်ထွက်ကို အလိုအလျောက်ညှိဖို့' },
  showFps: { en: 'Show FPS & diagnostics', rki: 'FPS နန့် အခြေအနေတိ ပြဖို့' },
  camera: { en: 'Camera', rki: 'ကင်မရာ' },
  sensitivity: { en: 'Mouse sensitivity', rki: 'မောက်စ် လှုပ်ရှားနှုန်း' },
  invertY: { en: 'Invert Y axis', rki: 'အထက်အောက် ကြည့်စွာကို ပြောင်းပြန်လုပ်ဖို့' },
  cameraDistance: { en: 'Camera distance', rki: 'ကင်မရာ အကွာအဝေး' },
  fov: { en: 'Field of view', rki: 'မြင်ကွင်း' },
  timeWeather: { en: 'Time & Weather', rki: 'အချိန်နန့် ရာသီဥတု' },
  timeOfDay: { en: 'Time of day', rki: 'နေ့အချိန်' },
  dayLength: { en: 'Day length (real minutes)', rki: 'တရက်ကြာချိန် (အပြင်မိနစ်)' },
  rain: { en: 'Rain', rki: 'မိုးရွာဖို့' },
  roomEnvironment: { en: 'In this room, time of day, day length and rain are set by the host.', rki: 'ဒေအခန်းမှာ နေ့အချိန်၊ တရက်ကြာချိန်နန့် မိုးရွာဖို့စွာကို အခန်းဖွင့်ထားရေလူက သတ်မှတ်ထားရေ။' },
  audio: { en: 'Audio', rki: 'အသံ' },
  masterVolume: { en: 'Master volume', rki: 'ပင်မအသံ' },
  sfxVolume: { en: 'Effects volume', rki: 'လှုပ်ရှားမှုအသံ' },
  ambienceVolume: { en: 'Ambience volume', rki: 'ပတ်ဝန်းကျင်အသံ' },
  mute: { en: 'Mute', rki: 'အသံပိတ်' },
  general: { en: 'General', rki: 'အထွေထွေ' },
  language: { en: 'Language', rki: 'ဘာသာစကား' },
  playerName: { en: 'Player name', rki: 'ကစားရေလူ နာမည်' },
  minimapRotate: { en: 'Rotate minimap with heading', rki: 'ကိုယ်လှည့်ရေဘက်အတိုင်း မြေပုံချေကို လှည့်ဖို့' },
  enterVehicle: { en: 'Press F to drive', rki: 'ကားမောင်းဖို့ F ကိုနှိပ်ပါ' },
  exitVehicle: { en: 'F — exit vehicle', rki: 'F — ကားထဲက ဆင်းဖို့' },
  headlights: { en: 'Lights', rki: 'မီး' },
  on: { en: 'On', rki: 'ဖွင့်' },
  off: { en: 'Off', rki: 'ပိတ်' },
  gear: { en: 'Gear', rki: 'ဂီယာ' },
  destination: { en: 'Destination', rki: 'လားဖို့နီရာ' },
  clearDestination: { en: 'Clear destination', rki: 'လားဖို့နီရာကို ဖျက်ဖို့' },
  teleport: { en: 'Travel here', rki: 'ဒေနီရာကို လားဖို့' },
  mapHint: { en: 'Click the map to set a destination. Distance shown is straight-line, not a road route.', rki: 'လားဖို့နီရာ သတ်မှတ်ဖို့ မြေပုံကို နှိပ်ပါ။ ပြထားရေ အကွာအဝေးက လမ်းအတိုင်းမဟုတ်ဘဲ မျဉ်းဖြောင့်တိုင်းထားစွာ ဖြစ်ရေ။' },
  landmarks: { en: 'Landmarks', rki: 'အထင်ကရနီရာတိ' },
  saved: { en: 'Game saved', rki: 'ဂိမ်းကို သိမ်းထားပြီးယာ' },
  saveFailed: { en: 'Could not save (storage unavailable)', rki: 'ဂိမ်းကို သိမ်းထားလို့ မရပါ' },
  corruptSave: { en: 'Saved game could not be read and was reset.', rki: 'သိမ်းထားရေ ဂိမ်းကို ဖတ်လို့မရလို့ အစက ပြန်စထားရေ။' },
  resetConfirm: { en: 'Reset your saved game? This cannot be undone.', rki: 'သိမ်းထားရေ ဂိမ်းကို ဖျက်ဖို့လား။ ဖျက်ပြီးကေ ပြန်ယူလို့ မရပါ။' },
  clickToPlay: { en: 'Click to look around', rki: 'ပတ်ဝန်းကျင်ကို ကြည့်ဖို့ နှိပ်ပါ' },
  carReset: { en: 'Vehicle reset upright', rki: 'ကားကို ပြန်တည့်ထားပြီးယာ' },
  pressRToReset: { en: 'Press R to flip the car back', rki: 'ကားကို ပြန်တည့်ဖို့ R ကိုနှိပ်ပါ' },
  water: { en: "You can't go into the water here", rki: 'ဒေနီရာမှာ ရီထဲ ဝင်လို့မရပါ' },
  character: { en: 'Character', rki: 'ဇာတ်ကောင်' },
  boy: { en: 'Rakhine Boy', rki: 'ရခိုင်သားချေ' },
  girl: { en: 'Rakhine Girl', rki: 'ရခိုင်သမချေ' },
  swimming: { en: 'Swimming', rki: 'ရီကူးနီရေ' },
  cameraMode: { en: 'Camera', rki: 'ကင်မရာ' },
  sittwe: { en: 'Sittwe', rki: 'စစ်တွေ' },
  unnamedRoad: { en: 'Unnamed road', rki: 'နာမည်မဟိရေလမ်း' },
  edgeOfMap: { en: 'Edge of the mapped area', rki: 'မြေပုံဧရိယာ အစွန်းကို ရောက်နီရေ' },
  graphicsReload: { en: 'Anti-aliasing changes apply after reload.', rki: 'Anti-aliasing ပြောင်းထားစွာတိက ဂိမ်းကို ပြန်ဖွင့်ပြီးမှ အလုပ်လုပ်ဖို့။' },
} as const;

export type StringKey = keyof typeof STRINGS;

let current: Lang = 'en';

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l === 'rki' ? 'rki' : 'en';
  document.documentElement.classList.toggle('lang-rki', l === 'rki');
}

export function getLang(): Lang {
  return current;
}

export function t(key: StringKey): string {
  return STRINGS[key][current];
}
