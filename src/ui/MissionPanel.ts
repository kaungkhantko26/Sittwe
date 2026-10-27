import { MISSIONS, type Lang, type MissionProgress } from '../systems/Missions';
import { thadingyutFullMoon } from '../systems/Thadingyut';
import type { MissionDirector } from '../systems/MissionDirector';
import { formatDistance, h } from './dom';

const ks = (n: number) => `${n.toLocaleString('en-US')} Ks`;

/** Mission board (K): pick a mission, see your wallet, switch the Thadingyut festival. */
export function missionPanel(d: MissionDirector, lang: Lang, inRoom: boolean, isHost: boolean, close: () => void): HTMLElement {
  const pick = (t: { en: string; rki: string }) => t[lang] || t.en;
  const festival = d.festival;
  const moon = thadingyutFullMoon(new Date().getFullYear());
  const moonText = moon.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Yangon' });

  const fest = h('select') as HTMLSelectElement;
  fest.append(h('option', { value: 'auto' }, `Automatic (full moon ≈ ${moonText})`), h('option', { value: 'on' }, 'Always on'), h('option', { value: 'off' }, 'Off'));
  fest.value = d.progress.festival;
  fest.addEventListener('change', () => { d.setFestival(fest.value as MissionProgress['festival']); close(); });

  const running = d.state.id;
  const list = h('div.mission-list');
  for (const m of MISSIONS) {
    const locked = m.season === 'thadingyut' && !festival;
    const count = d.progress.done[m.id] ?? 0;
    const start = h(`button.btn${locked ? '' : '.primary'}`, { type: 'button', disabled: locked || !!running, onclick: () => { d.start(m.id); close(); } }, running === m.id ? 'In progress' : 'Start');
    list.append(h(`article.mission-card${m.season === 'thadingyut' ? '.festival' : ''}${locked ? '.locked' : ''}`, {},
      h('div.mission-head', {}, h('span.mission-icon', {}, m.icon), h('div', {}, h('h3', {}, pick(m.title)),
        h('div.mission-tags', {},
          m.social ? h('span.tag', {}, '👥 Best with friends') : null,
          m.season === 'thadingyut' ? h('span.tag.fest', {}, '🏮 Thadingyut') : null,
          h('span.tag', {}, `Reward ${ks(m.reward)}`),
          m.budget ? h('span.tag', {}, `Budget ${ks(m.budget)}`) : null,
          count ? h('span.tag.done', {}, `✓ ×${count}`) : null))),
      h('p.small', {}, pick(m.intro)),
      locked ? h('p.tiny.muted', {}, 'Available during Thadingyut (or switch the festival on below).') : null,
      h('div.row', {}, start)));
  }
  return h('div.missions', {},
    h('div.mission-wallet', {}, h('span', {}, '💰 Your wallet'), h('b', {}, ks(d.progress.kyat))),
    inRoom ? h('p.small.muted', {}, isHost ? 'You are the host: the mission you start is shared with everyone in the room.' : 'In a room the host runs the mission for everyone; starting one here asks the host.') : h('p.small.muted', {}, 'Missions work solo, and are shared with friends when you play in a room.'),
    running ? h('div.row.gap', {}, h('button.btn', { type: 'button', onclick: () => { d.quit(); close(); } }, 'Abandon current mission')) : null,
    list,
    h('section.settings-section', {}, h('h3', {}, '🏮 Thadingyut — Festival of Lights'),
      h('p.small', {}, festival ? 'The festival is on: oil lamps at the pagodas, sky lanterns and fireworks over the Point at night.' : 'The festival is off. Thadingyut is the full moon of the Myanmar month Thadingyut, in October.'),
      h('label.setting-row', {}, h('span.setting-label', {}, 'Festival'), h('span.setting-control', {}, fest)),
      h('p.tiny.muted', {}, 'Dates are approximated from the full moon. Shops and places are real OpenStreetMap locations; items and prices are game content.')),
  );
}

/** Small mission tracker shown on the HUD. */
export class MissionTracker {
  readonly el: HTMLElement;
  constructor(parent: HTMLElement, private readonly d: MissionDirector, private readonly navigate: () => void, private readonly openBoard: () => void) {
    this.el = h('div.mission-tracker.hidden');
    parent.appendChild(this.el);
  }

  refresh(): void {
    const t = this.d.tracker();
    this.el.classList.toggle('hidden', !t);
    if (!t) return;
    const parts: Array<HTMLElement | null> = [
      h('div.mt-head', {}, h('span', {}, `${t.icon} ${t.title}`), h('span.mt-step', {}, t.done ? '✓' : t.stepNo)),
      h('div.mt-text', {}, t.step),
      t.wait ? h('div.mt-wait', {}, `⏳ ${t.wait}`) : null,
      h('div.mt-meta', {}, t.distance !== null && !t.done ? h('span', {}, `📍 ${formatDistance(t.distance)}`) : null, t.items ? h('span', {}, t.items) : null, t.budget ? h('span', {}, `💵 ${ks(t.budget)}`) : null),
      h('div.row.gap', {},
        !t.done ? h('button.btn.small', { type: 'button', onclick: () => this.navigate() }, 'Route') : null,
        t.done ? h('button.btn.small', { type: 'button', onclick: () => this.d.dismiss() }, 'Close') : h('button.btn.small', { type: 'button', onclick: () => this.openBoard() }, 'K — missions')),
    ];
    this.el.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }
}
