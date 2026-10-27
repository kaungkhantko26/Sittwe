import type { Quality, Settings, SettingsStore } from '../systems/Settings';
import { h } from './dom';
import { t, type StringKey } from './i18n';

export interface SettingsHooks {
  getTimeOfDay(): number;
  setTimeOfDay(h: number): void;
  /** True while a room host controls time and weather. */
  environmentLocked?(): boolean;
  onResetGame(): void;
}

/** Builds the settings form; changes apply immediately and persist. */
export function settingsContent(store: SettingsStore, hooks: SettingsHooks): HTMLElement {
  const s = store.get();
  const section = (title: StringKey, ...rows: HTMLElement[]) => h('section.settings-section', {}, h('h3', {}, t(title)), ...rows);
  const row = (label: string, control: HTMLElement, value?: HTMLElement) => h('label.setting-row', {}, h('span.setting-label', {}, label), h('span.setting-control', {}, control, value ?? null));

  const slider = (key: keyof Settings, label: StringKey, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const val = h('span.setting-value', {}, fmt(s[key] as number));
    const input = h('input', { type: 'range', min, max, step, value: s[key] as number }) as HTMLInputElement;
    input.addEventListener('input', () => {
      val.textContent = fmt(Number(input.value));
      store.update({ [key]: Number(input.value) } as Partial<Settings>);
    });
    return row(t(label), input, val);
  };
  const toggle = (key: keyof Settings, label: StringKey) => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = s[key] as boolean;
    input.addEventListener('change', () => store.update({ [key]: input.checked } as Partial<Settings>));
    return row(t(label), input);
  };

  const qualities: Quality[] = ['low', 'medium', 'high', 'ultra'];
  const seg = h('div.segmented');
  for (const q of qualities) {
    const b = h(`button.btn.seg${s.quality === q ? '.active' : ''}`, { type: 'button' }, t(q));
    b.addEventListener('click', () => {
      store.update({ quality: q });
      seg.querySelectorAll('.seg').forEach((e) => e.classList.remove('active'));
      b.classList.add('active');
    });
    seg.appendChild(b);
  }

  // Time of day (stored in the game state, not settings).
  const tod = hooks.getTimeOfDay();
  const fmtTime = (v: number) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`;
  const todVal = h('span.setting-value', {}, fmtTime(tod));
  const todInput = h('input', { type: 'range', min: 0, max: 23.99, step: 0.05, value: tod }) as HTMLInputElement;
  todInput.addEventListener('input', () => {
    todVal.textContent = fmtTime(Number(todInput.value));
    hooks.setTimeOfDay(Number(todInput.value));
  });
  const presets = h(
    'div.row.gap.small',
    {},
    ...[
      ['06:00', 6],
      ['12:00', 12],
      ['18:00', 18],
      ['22:00', 22],
    ].map(([label, v]) =>
      h('button.btn.small', {
        type: 'button',
        text: label as string,
        onclick: () => {
          hooks.setTimeOfDay(v as number);
          todInput.value = String(v);
          todVal.textContent = fmtTime(v as number);
        },
      }),
    ),
  );

  const lang = h('select') as HTMLSelectElement;
  lang.append(h('option', { value: 'en' }, 'English'), h('option', { value: 'rki' }, 'ရခိုင် (Rakhine)'));
  lang.value = s.language;
  lang.addEventListener('change', () => store.update({ language: lang.value as Settings['language'] }));

  const touch=h('select') as HTMLSelectElement;touch.append(h('option',{value:'auto'},'Automatic'),h('option',{value:'on'},'On'),h('option',{value:'off'},'Off'));touch.value=s.touchControls;touch.addEventListener('change',()=>store.update({touchControls:touch.value as Settings['touchControls']}));

  const name = h('input', { type: 'text', maxlength: 24, value: s.playerName }) as HTMLInputElement;
  name.addEventListener('change', () => store.update({ playerName: name.value }));

  const charSeg = h('div.segmented');
  for (const c of ['boy', 'girl'] as const) {
    const btn = h(`button.btn.seg${s.character === c ? '.active' : ''}`, { type: 'button' }, t(c));
    btn.addEventListener('click', () => {
      store.update({ character: c });
      charSeg.querySelectorAll('.seg').forEach((e) => e.classList.remove('active'));
      btn.classList.add('active');
    });
    charSeg.appendChild(btn);
  }

  const reset = h('button.btn.danger', { type: 'button', text: t('resetGame'), onclick: () => hooks.onResetGame() });

  const timeWeather = section('timeWeather', row(t('timeOfDay'), todInput, todVal), presets, slider('dayLengthMinutes', 'dayLength', 0, 120, 1, (v) => (v === 0 ? '∞ (paused)' : `${v} min`)), toggle('rain', 'rain'));
  if (hooks.environmentLocked?.()) {
    timeWeather.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((el) => (el.disabled = true));
    timeWeather.classList.add('locked');
    timeWeather.appendChild(h('p.muted.tiny', {}, t('roomEnvironment')));
  }

  return h(
    'div.settings',
    {},
    section('graphics', row(t('quality'), seg), toggle('adaptiveResolution','adaptiveResolution'), toggle('showFps', 'showFps'), h('p.muted.tiny', {}, t('graphicsReload'))),
    section('camera', slider('mouseSensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)), slider('cameraDistance', 'cameraDistance', 2.5, 14, 0.5, (v) => `${v.toFixed(1)} m`), slider('fov', 'fov', 50, 85, 1, (v) => `${v}°`), toggle('invertY', 'invertY')),
    timeWeather,
    section('audio', slider('masterVolume', 'masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`), slider('sfxVolume', 'sfxVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`), slider('ambienceVolume', 'ambienceVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`), toggle('muted', 'mute')),
    section('general', row('Touch controls',touch), row(t('character'), charSeg), row(t('language'), lang), row(t('playerName'), name), toggle('minimapRotate', 'minimapRotate'), h('div.row', {}, reset)),
  );
}
