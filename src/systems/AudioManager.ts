/**
 * Procedural audio synthesized with the Web Audio API — no sound files, so
 * there are no third-party audio licensing concerns. The AudioContext is
 * created only after a user gesture (browser autoplay rules).
 *
 * Layers: city/road rumble, wind, daytime birds, occasional distant horns,
 * rain, footsteps, and an engine tone that follows vehicle speed/throttle.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noise!: AudioBuffer;
  private city!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rain!: GainNode;
  private engineGain!: GainNode;
  private engineOsc1!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private hornTimer = 12;
  private birdTimer = 3;
  private time = 0;
  private volumes = { master: 0.8, sfx: 0.8, ambience: 0.6, muted: false };

  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (click / key press). */
  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);
    this.noise = this.makeNoise(ctx, 4);

    // City/road rumble: brown-ish noise, low-passed.
    this.city = ctx.createGain();
    this.city.gain.value = 0.22;
    const cityLp = ctx.createBiquadFilter();
    cityLp.type = 'lowpass';
    cityLp.frequency.value = 380;
    this.loopNoise(cityLp);
    cityLp.connect(this.city).connect(this.ambience);

    // Wind: band-passed noise with a slowly wandering centre frequency.
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.08;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.7;
    this.loopNoise(this.windFilter);
    this.windFilter.connect(this.wind).connect(this.ambience);

    // Rain: high-passed noise.
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1500;
    this.loopNoise(rainHp);
    rainHp.connect(this.rain).connect(this.ambience);

    // Engine: two detuned oscillators through a low-pass filter.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc1.connect(this.engineFilter);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    this.engineOsc2.connect(o2g).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.sfx);
    this.engineOsc1.start();
    this.engineOsc2.start();

    this.applyVolumes();
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04; // gentle low-frequency emphasis
      d[i] = white * 0.5 + last * 3;
    }
    return buf;
  }

  private loopNoise(dest: AudioNode): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    src.connect(dest);
    src.start(0, Math.random() * 3);
  }

  setVolumes(master: number, sfx: number, ambience: number, muted: boolean): void {
    this.volumes = { master, sfx, ambience, muted };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.muted ? 0 : this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ambience.gain.setTargetAtTime(this.volumes.ambience, t, 0.05);
  }

  /** Per-frame update of continuous layers. */
  update(dt: number, p: { day: number; rain: number; driving: boolean; speedKmh: number; throttle: number; nearWater: boolean }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.time += dt;
    const t = ctx.currentTime;
    this.city.gain.setTargetAtTime(0.1 + 0.16 * p.day, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(450 + Math.sin(this.time * 0.13) * 250 + Math.sin(this.time * 0.47) * 120, t, 0.8);
    this.wind.gain.setTargetAtTime((p.nearWater ? 0.14 : 0.07) + p.rain * 0.06, t, 0.8);
    this.rain.gain.setTargetAtTime(p.rain * 0.22, t, 0.5);

    const rpm = 800 + Math.min(p.speedKmh, 100) * 38 + p.throttle * 900;
    const freq = rpm / 60;
    this.engineOsc1.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(freq * 0.5 + 1.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(300 + p.throttle * 900 + p.speedKmh * 6, t, 0.08);
    this.engineGain.gain.setTargetAtTime(p.driving ? 0.07 + p.throttle * 0.07 : 0, t, 0.15);

    // Occasional distant horn (daytime traffic).
    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = 14 + Math.random() * 30;
      if (p.day > 0.4) this.horn();
    }
    // Birds by day.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2 + Math.random() * 6;
      if (p.day > 0.6 && p.rain < 0.3) this.chirp();
    }
  }

  footstep(running: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 280 + Math.random() * 160;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(running ? 0.5 : 0.32, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 3, 0.15);
  }

  /** Clock-tower chime: a short pentatonic bell phrase (approximation, not the actual tune). */
  chime(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const notes = [523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33, 523.25];
    const t = ctx.currentTime;
    notes.forEach((f, i) => {
      for (const [mult, amp] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const s = t + i * 0.45;
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.06 * amp * volume, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0005, s + 1.6);
        o.connect(g).connect(this.ambience);
        o.start(s);
        o.stop(s + 1.7);
      }
    });
  }

  private danceTimer: number | null = null;

  /**
   * Gentle procedural accompaniment for the Si Mee dance: a soft drone and a
   * slow pentatonic plucked melody (an original approximation, not a
   * recording of traditional music).
   */
  startDanceMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.danceTimer !== null) return;
    const scale = [293.66, 329.63, 392.0, 440.0, 493.88, 587.33, 659.25];
    const phrase = [0, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 3, 2, 3, 0];
    let step = 0;
    const play = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      const f = scale[phrase[step % phrase.length]!]!;
      for (const [mult, amp] of [[1, 1], [2, 0.3], [3, 0.12]] as const) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05 * amp, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
        o.connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 1);
      }
      if (step % 4 === 0) {
        // Soft drum on the beat.
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.25);
        o.connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 0.3);
      }
      step++;
    };
    play();
    this.danceTimer = window.setInterval(play, 550);
  }

  stopDanceMusic(): void {
    if (this.danceTimer !== null) window.clearInterval(this.danceTimer);
    this.danceTimer = null;
  }

  /** Swimming stroke splash. */
  splash(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1400 + Math.random() * 900;
    hp.Q.value = 0.7;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(hp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 3, 0.4);
  }

  private horn(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.018, t + 0.03);
    g.gain.setValueAtTime(0.018, t + 0.32);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.45);
    }
    lp.connect(g).connect(this.ambience);
  }

  private chirp(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + i * 0.13;
      const base = 2400 + Math.random() * 1600;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, s + 0.07);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.09);
      o.connect(g).connect(this.ambience);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  /** Short UI click. */
  click(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.07);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}
