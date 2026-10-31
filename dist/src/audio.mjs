// ============================================================
//  音频：WebAudio 合成音效 + 总线 + 水下滤波 + 环境底噪
// ============================================================

export class AudioSys {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.underwater = false;
    this.inWater = false;
    this.noiseBuf = null;
    this._last = {};
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = (this.settings.volMaster ?? 80) / 100;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 8;

    this.sfx = ctx.createGain();
    this.sfx.gain.value = (this.settings.volSfx ?? 85) / 100;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.6;

    this.sfx.connect(this.filter);
    this.filter.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // 简易混响（反馈延迟）
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.16;
    const delay = ctx.createDelay(0.6);
    delay.delayTime.value = 0.11;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.reverb.connect(delay);
    delay.connect(lp); lp.connect(fb); fb.connect(delay);
    delay.connect(this.master);

    // 噪声缓冲
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // 环境底噪：远处水声 + 电气嗡鸣
    this.hum = ctx.createGain();
    this.hum.gain.value = 0.05;
    const humSrc = ctx.createBufferSource();
    humSrc.buffer = buf; humSrc.loop = true;
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass'; humLp.frequency.value = 320; humLp.Q.value = 0.4;
    humSrc.connect(humLp); humLp.connect(this.hum); this.hum.connect(this.master);
    humSrc.start();

    // 水面/水下环境层：缓慢拍打的水声
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = buf; waterSrc.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'lowpass'; this.waterFilter.frequency.value = 520; this.waterFilter.Q.value = 0.7;
    const waterPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    waterSrc.connect(this.waterFilter);
    if (waterPan) { waterPan.pan.value = 0; this.waterFilter.connect(waterPan); waterPan.connect(this.waterGain); }
    else this.waterFilter.connect(this.waterGain);
    this.waterGain.connect(this.master);
    waterSrc.start();

    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  applySettings() {
    if (!this.ready) return;
    this.master.gain.value = (this.settings.volMaster ?? 80) / 100;
    this.sfx.gain.value = (this.settings.volSfx ?? 85) / 100;
  }

  setUnderwater(on) { this.underwater = on; }
  setWater(inWater, submerged) { this.inWater = !!inWater; this.underwater = !!submerged; }

  tick(dt) {
    if (!this.ready) return;
    const m = (this.settings.muffle ?? 70) / 100;
    const target = this.underwater ? 20000 - m * 19400 : 20000;
    this.filter.frequency.value += (target - this.filter.frequency.value) * Math.min(1, dt * 6);
    const humT = this.underwater ? 0.09 : 0.045;
    this.hum.gain.value += (humT - this.hum.gain.value) * Math.min(1, dt * 4);
    if (this.waterGain) {
      const wt = this.underwater ? 0.075 : this.inWater ? 0.032 : 0.0;
      this.waterGain.gain.value += (wt - this.waterGain.gain.value) * Math.min(1, dt * 2.5);
      this.waterFilter.frequency.value += ((this.underwater ? 260 : 620) - this.waterFilter.frequency.value) * Math.min(1, dt * 3);
      if (this.underwater && this.throttle('bubble', 1700)) {
        this.tone(260 + Math.random() * 220, 0.12, 0.018, 'sine', { to: 520, attack: 0.01 });
      }
    }
  }

  // ---------- 基础发声 ----------
  _t() { return this.ctx.currentTime; }
  tone(freq, dur, gain, type = 'sine', o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this._t();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    if (o.reverb) g.connect(this.reverb);
    g.connect(this.sfx);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  noise(dur, gain, o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this._t();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 900, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    f.Q.value = o.q ?? 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    if (o.reverb) g.connect(this.reverb);
    g.connect(this.sfx);
    src.start(t, Math.random() * 1.2); src.stop(t + dur + 0.03);
  }
  throttle(key, ms) {
    const now = performance.now();
    if (this._last[key] && now - this._last[key] < ms) return false;
    this._last[key] = now;
    return true;
  }

  // ---------- 游戏音效 ----------
  gunshot(kind = 'smg') {
    if (kind === 'rail') {
      this.noise(0.5, 0.7, { freq: 900, to: 120, q: 0.7, rate: 0.65, reverb: true });
      this.tone(58, 0.55, 0.55, 'square', { to: 28 });
      this.tone(1200, 0.35, 0.14, 'sawtooth', { to: 180, attack: 0.004 });
      this.noise(0.9, 0.16, { freq: 3200, to: 400, q: 0.5, attack: 0.03, reverb: true });
      return;
    }
    if (kind === 'shotgun') {
      this.noise(0.32, 0.75, { freq: 1100, to: 180, q: 0.6, rate: 0.75, reverb: true });
      this.tone(70, 0.28, 0.5, 'square', { to: 38 });
      this.noise(0.5, 0.18, { freq: 400, to: 120, q: 0.5, attack: 0.05, reverb: true });
    } else if (kind === 'rifle') {
      this.noise(0.16, 0.62, { freq: 1900, to: 320, q: 0.7, rate: 1.05, reverb: true });
      this.tone(120, 0.15, 0.4, 'square', { to: 52 });
      this.noise(0.36, 0.13, { freq: 600, to: 160, q: 0.5, attack: 0.03, reverb: true });
    } else {
      this.noise(0.09, 0.5, { freq: 2200, to: 500, q: 0.8, rate: 1.25, reverb: true });
      this.tone(150, 0.09, 0.3, 'square', { to: 70 });
      this.noise(0.24, 0.09, { freq: 700, to: 200, q: 0.5, attack: 0.02, reverb: true });
    }
  }
  dryFire() { this.tone(2100, 0.035, 0.12, 'square'); }
  reloadStep(i) {
    const f = [1300, 900, 1500, 700][i % 4];
    this.noise(0.05, 0.16, { freq: f, q: 2.5 });
    this.tone(300 + i * 60, 0.04, 0.07, 'triangle');
  }
  reloadDone() { this.noise(0.07, 0.2, { freq: 1000, q: 2 }); this.tone(520, 0.07, 0.12, 'triangle'); }
  step(surface = 'tile') {
    if (!this.throttle('step', 120)) return;
    if (surface === 'water') this.noise(0.16, 0.24, { freq: 1500, to: 500, q: 0.7 });
    else this.noise(0.07, 0.12, { freq: 500 + Math.random() * 260, q: 1.4 });
  }
  land(hard) {
    this.noise(hard ? 0.26 : 0.12, hard ? 0.4 : 0.18, { freq: hard ? 220 : 420, q: 0.7 });
    this.tone(hard ? 68 : 110, 0.1, 0.2, 'sine', { to: hard ? 40 : 80 });
  }
  slide() { this.noise(0.5, 0.2, { freq: 900, to: 300, q: 0.5, attack: 0.02 }); }
  wallJump() { this.noise(0.08, 0.2, { freq: 1200, q: 1.5 }); this.tone(360, 0.09, 0.14, 'triangle', { to: 500 }); }
  vault() { this.noise(0.1, 0.14, { freq: 700, q: 1.2 }); }
  splash(power = 1) {
    this.noise(0.34 * power, 0.3 * power, { freq: 1400, to: 400, q: 0.6, attack: 0.004 });
    this.tone(180, 0.2, 0.07 * power, 'sine', { to: 90 });
    this.noise(0.5, 0.08 * power, { freq: 800, to: 200, q: 0.5, attack: 0.05, reverb: true });
  }
  waterHit(power = 1) { this.noise(0.13, 0.22 * power, { freq: 2600, to: 700, q: 0.8 }); }
  swim() { if (this.throttle('swim', 500)) this.noise(0.24, 0.1, { freq: 600, to: 250, q: 0.6 }); }
  dive() { this.noise(0.6, 0.3, { freq: 900, to: 180, q: 0.5, attack: 0.01 }); }
  hurt() {
    this.tone(88, 0.22, 0.28, 'square', { to: 60 });
    this.noise(0.2, 0.16, { freq: 260, q: 0.9 });
  }
  heal() { this.tone(660, 0.16, 0.1, 'sine', { to: 880 }); this.tone(990, 0.2, 0.08, 'sine', { attack: 0.06 }); }
  hitmark(head) {
    if (head) { this.tone(1200, 0.05, 0.14, 'triangle'); this.tone(1800, 0.06, 0.1, 'sine'); }
    else this.tone(760, 0.045, 0.12, 'triangle');
  }
  kill() { this.tone(340, 0.12, 0.16, 'triangle', { to: 180 }); this.noise(0.2, 0.1, { freq: 900, to: 300, q: 0.7 }); }
  growl(type) {
    const base = type === 'brute' ? 92 : type === 'stalker' ? 150 : type === 'spitter' ? 210 : 190;
    this.tone(base, 0.55, 0.16, 'sawtooth', { to: base * 0.6, attack: 0.08, reverb: true });
    this.noise(0.45, 0.07, { freq: 400, to: 150, q: 0.6, attack: 0.06 });
  }
  enemyHit() { this.noise(0.08, 0.16, { freq: 1200, q: 1.2 }); this.tone(220, 0.07, 0.1, 'square', { to: 140 }); }
  enemyDeath() { this.tone(200, 0.5, 0.2, 'sawtooth', { to: 55, attack: 0.01, reverb: true }); this.noise(0.45, 0.16, { freq: 500, to: 120, q: 0.6 }); }
  spit() { this.noise(0.16, 0.2, { freq: 1600, to: 400, q: 0.8 }); this.tone(420, 0.12, 0.09, 'sawtooth', { to: 180 }); }
  pickup(kind) {
    if (kind === 'health') { this.tone(620, 0.14, 0.1); this.tone(930, 0.18, 0.1, 'sine', { attack: 0.05 }); }
    else { this.tone(440, 0.1, 0.1, 'triangle'); this.tone(660, 0.12, 0.09, 'triangle', { attack: 0.04 }); }
  }
  shard() {
    this.tone(880, 0.22, 0.1, 'sine', { to: 1320 });
    this.tone(1320, 0.3, 0.08, 'sine', { attack: 0.06 });
    this.noise(0.3, 0.05, { freq: 3200, q: 2, attack: 0.02 });
  }
  chime() {
    this.tone(520, 0.4, 0.1, 'sine', { to: 780, attack: 0.02, reverb: true });
    this.tone(1040, 0.6, 0.08, 'sine', { attack: 0.1, reverb: true });
  }
  alarm() { this.tone(680, 0.3, 0.1, 'square', { to: 620 }); setTimeout(() => this.tone(680, 0.3, 0.1, 'square', { to: 620, attack: 0.02 }), 380); }
  ui(kind = 'click') {
    if (kind === 'hover') this.tone(1200, 0.025, 0.03, 'sine');
    else this.tone(760, 0.05, 0.06, 'triangle', { to: 980 });
  }
  streak(n) {
    const base = 480 + Math.min(8, n) * 120;
    this.tone(base, 0.12, 0.12, 'triangle');
    setTimeout(() => this.tone(base * 1.5, 0.16, 0.1, 'sine'), 70);
  }
  slowmo(on) { if (on) this.tone(420, 0.8, 0.1, 'sine', { to: 120, attack: 0.06, reverb: true }); }

  // ---------- 新系统音效 ----------
  echoPulse() {
    this.tone(90, 0.5, 0.4, 'sine', { to: 40, attack: 0.005 });
    this.tone(320, 0.35, 0.12, 'triangle', { to: 900, attack: 0.004, reverb: true });
    this.noise(0.55, 0.22, { freq: 500, to: 4200, q: 0.8, attack: 0.003, reverb: true });
    this.noise(0.7, 0.12, { freq: 2200, to: 400, q: 0.5, attack: 0.06, reverb: true });
  }
  shardType(type) {
    const bases = { tide: 660, ember: 560, drift: 740, void: 500 };
    const b = bases[type] || 660;
    this.tone(b, 0.3, 0.1, 'sine', { to: b * 1.5, attack: 0.01, reverb: true });
    this.tone(b * 1.5, 0.45, 0.08, 'sine', { attack: 0.06, reverb: true });
    this.tone(b * 2, 0.6, 0.05, 'triangle', { attack: 0.1, reverb: true });
  }
  resonance() {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.tone(440 * Math.pow(1.26, i), 0.5, 0.09, 'triangle', { attack: 0.02, reverb: true }), i * 90);
    }
    this.noise(0.5, 0.07, { freq: 4200, q: 1.6, attack: 0.05, reverb: true });
  }
  objective() {
    this.tone(523, 0.22, 0.09, 'sine', { attack: 0.01, reverb: true });
    setTimeout(() => this.tone(784, 0.3, 0.08, 'sine', { attack: 0.02, reverb: true }), 110);
    setTimeout(() => this.tone(1046, 0.5, 0.06, 'sine', { attack: 0.04, reverb: true }), 220);
  }
  bossRoar() {
    this.tone(64, 1.5, 0.35, 'sawtooth', { to: 38, attack: 0.12, reverb: true });
    this.tone(96, 1.2, 0.2, 'square', { to: 52, attack: 0.08, reverb: true });
    this.noise(1.4, 0.16, { freq: 380, to: 90, q: 0.6, attack: 0.12, reverb: true });
  }
  bossSlam() {
    this.tone(55, 0.7, 0.5, 'sine', { to: 26, attack: 0.004 });
    this.noise(0.55, 0.34, { freq: 420, to: 90, q: 0.6, attack: 0.004, reverb: true });
    this.noise(0.9, 0.12, { freq: 1200, to: 200, q: 0.5, attack: 0.04, reverb: true });
  }
  bossDeath() {
    this.tone(140, 2.2, 0.3, 'sawtooth', { to: 32, attack: 0.02, reverb: true });
    this.noise(1.8, 0.24, { freq: 900, to: 70, q: 0.5, attack: 0.01, reverb: true });
    this.tone(660, 1.6, 0.08, 'sine', { to: 330, attack: 0.3, reverb: true });
  }
  portalOpen() {
    this.tone(220, 1.0, 0.12, 'sine', { to: 660, attack: 0.1, reverb: true });
    this.tone(330, 1.4, 0.1, 'sine', { to: 990, attack: 0.2, reverb: true });
    this.noise(1.2, 0.08, { freq: 3000, q: 1.2, attack: 0.3, reverb: true });
  }
}