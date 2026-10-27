import type { Lang } from '../systems/Settings';

/**
 * UI strings in English and Rakhine (ရခိုင်, ISO 639-3 `rki`).
 *
 * Rakhine is written in the Myanmar script. These strings use the formal
 * written register shared by Rakhine writing; they were written for this
 * project and MUST be reviewed by a native Rakhine speaker — edit the `rki`
 * values below directly.
 */
const STRINGS = {
  title: { en: 'SITTWE 3D', rki: 'စစ်တွေ 3D' },
  subtitle: { en: 'Explore Sittwe, Myanmar', rki: 'စစ်တွေမြို့ကို လှည့်လည်ကြည့်ရှုပါ' },
  play: { en: 'Play Game', rki: 'ကစားမည်' },
  newGame: { en: 'New Game', rki: 'ဂိမ်းအသစ်' },
  continue: { en: 'Continue', rki: 'ဆက်ကစားမည်' },
  map: { en: 'Map', rki: 'မြေပုံ' },
  settings: { en: 'Settings', rki: 'ဆက်တင်များ' },
  controls: { en: 'Controls', rki: 'ထိန်းချုပ်ခလုတ်များ' },
  about: { en: 'About', rki: 'အကြောင်း' },
  loading: { en: 'Loading', rki: 'ဖွင့်နေသည်' },
  resume: { en: 'Resume', rki: 'ပြန်ဆက်မည်' },
  saveGame: { en: 'Save Game', rki: 'သိမ်းဆည်းမည်' },
  mainMenu: { en: 'Main Menu', rki: 'ပင်မမီနူး' },
  resetGame: { en: 'Reset Game', rki: 'ဂိမ်းကို ပြန်စမည်' },
  paused: { en: 'Paused', rki: 'ခေတ္တရပ်ထားသည်' },
  close: { en: 'Close', rki: 'ပိတ်မည်' },
  back: { en: 'Back', rki: 'နောက်သို့' },
  graphics: { en: 'Graphics', rki: 'ဂရပ်ဖစ်' },
  quality: { en: 'Quality', rki: 'အရည်အသွေး' },
  low: { en: 'Low', rki: 'နိမ့်' },
  medium: { en: 'Medium', rki: 'အလယ်အလတ်' },
  high: { en: 'High', rki: 'မြင့်' },
  ultra: { en: 'Ultra', rki: 'အမြင့်ဆုံး' },
  adaptiveResolution: { en: 'Adapt resolution for smoother play', rki: 'ချောမွေ့စေရန် ရုပ်ထွက်ကို အလိုအလျောက်ညှိမည်' },
  showFps: { en: 'Show FPS & diagnostics', rki: 'FPS ပြမည်' },
  camera: { en: 'Camera', rki: 'ကင်မရာ' },
  sensitivity: { en: 'Mouse sensitivity', rki: 'မောက်စ် အာရုံခံနိုင်မှု' },
  invertY: { en: 'Invert Y axis', rki: 'Y ဝင်ရိုး ပြောင်းပြန်' },
  cameraDistance: { en: 'Camera distance', rki: 'ကင်မရာ အကွာအဝေး' },
  fov: { en: 'Field of view', rki: 'မြင်ကွင်း' },
  timeWeather: { en: 'Time & Weather', rki: 'အချိန်နှင့် ရာသီဥတု' },
  timeOfDay: { en: 'Time of day', rki: 'နေ့အချိန်' },
  dayLength: { en: 'Day length (real minutes)', rki: 'တစ်ရက်ကြာချိန် (မိနစ်)' },
  rain: { en: 'Rain', rki: 'မိုးရွာ' },
  roomEnvironment: { en: 'In this room, time of day, day length and rain are set by the host.', rki: 'ဤအခန်းတွင် နေ့အချိန်၊ တစ်ရက်ကြာချိန်နှင့် မိုးကို အခန်းပိုင်ရှင်က သတ်မှတ်သည်။' },
  audio: { en: 'Audio', rki: 'အသံ' },
  masterVolume: { en: 'Master volume', rki: 'ပင်မအသံ' },
  sfxVolume: { en: 'Effects volume', rki: 'အသံပြယုဂ်' },
  ambienceVolume: { en: 'Ambience volume', rki: 'ပတ်ဝန်းကျင်အသံ' },
  mute: { en: 'Mute', rki: 'အသံပိတ်' },
  general: { en: 'General', rki: 'အထွေထွေ' },
  language: { en: 'Language', rki: 'ဘာသာစကား' },
  playerName: { en: 'Player name', rki: 'ကစားသမားအမည်' },
  minimapRotate: { en: 'Rotate minimap with heading', rki: 'မြေပုံငယ်ကို လှည့်မည်' },
  enterVehicle: { en: 'Press F to drive', rki: 'ကားမောင်းရန် F ကိုနှိပ်ပါ' },
  exitVehicle: { en: 'F — exit vehicle', rki: 'F — ကားမှဆင်းရန်' },
  headlights: { en: 'Lights', rki: 'မီး' },
  on: { en: 'On', rki: 'ဖွင့်' },
  off: { en: 'Off', rki: 'ပိတ်' },
  gear: { en: 'Gear', rki: 'ဂီယာ' },
  destination: { en: 'Destination', rki: 'သွားမည့်နေရာ' },
  clearDestination: { en: 'Clear destination', rki: 'သွားမည့်နေရာ ဖျက်မည်' },
  teleport: { en: 'Travel here', rki: 'ဤနေရာသို့ သွားမည်' },
  mapHint: { en: 'Click the map to set a destination. Distance shown is straight-line, not a road route.', rki: 'သွားမည့်နေရာ သတ်မှတ်ရန် မြေပုံကို နှိပ်ပါ။ ပြသသော အကွာအဝေးမှာ မျဉ်းဖြောင့် အကွာအဝေး ဖြစ်သည်။' },
  landmarks: { en: 'Landmarks', rki: 'မှတ်တိုင်နေရာများ' },
  saved: { en: 'Game saved', rki: 'သိမ်းဆည်းပြီးပါပြီ' },
  saveFailed: { en: 'Could not save (storage unavailable)', rki: 'သိမ်းဆည်း၍ မရပါ' },
  corruptSave: { en: 'Saved game could not be read and was reset.', rki: 'သိမ်းဆည်းထားသော ဂိမ်းကို ဖတ်၍မရပါ။' },
  resetConfirm: { en: 'Reset your saved game? This cannot be undone.', rki: 'သိမ်းဆည်းထားသော ဂိမ်းကို ဖျက်မည်လော။' },
  clickToPlay: { en: 'Click to look around', rki: 'ကြည့်ရန် နှိပ်ပါ' },
  carReset: { en: 'Vehicle reset upright', rki: 'ကားကို ပြန်တည့်ပြီး' },
  pressRToReset: { en: 'Press R to flip the car back', rki: 'ကားပြန်တည့်ရန် R ကိုနှိပ်ပါ' },
  water: { en: "You can't go into the water here", rki: 'ဤနေရာတွင် ရေထဲ မဝင်နိုင်ပါ' },
  character: { en: 'Character', rki: 'ဇာတ်ကောင်' },
  boy: { en: 'Rakhine Boy', rki: 'ရခိုင်ယောက်ျားလေး' },
  girl: { en: 'Rakhine Girl', rki: 'ရခိုင်မိန်းကလေး' },
  swimming: { en: 'Swimming', rki: 'ရေကူးနေသည်' },
  cameraMode: { en: 'Camera', rki: 'ကင်မရာ' },
  sittwe: { en: 'Sittwe', rki: 'စစ်တွေ' },
  unnamedRoad: { en: 'Unnamed road', rki: 'အမည်မဲ့လမ်း' },
  edgeOfMap: { en: 'Edge of the mapped area', rki: 'မြေပုံဧရိယာ အစွန်' },
  graphicsReload: { en: 'Anti-aliasing changes apply after reload.', rki: 'Anti-aliasing ပြောင်းလဲမှုများသည် ပြန်ဖွင့်ပြီးမှ သက်ရောက်မည်။' },
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
