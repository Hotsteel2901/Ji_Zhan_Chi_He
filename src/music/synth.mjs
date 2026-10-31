// ============================================================
//  程序化 D&B 合成器
//  —— 鼓组 / 次低频 / Reese / Wobble / Pad / FM 钢琴 / 铃声 / 人声
//  —— 全部由 WebAudio 振荡器与噪声实时生成，无采样
// ============================================================
import { mtof, mulberry32 } from './theory.mjs';

// ---------- 共享缓冲 ----------
const NOISE_CACHE = new WeakMap();
export function noiseBuffer(ctx) {
  let b = NOISE_CACHE.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * 2);
  b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.35 + white * 0.65;       // 轻微低通，噪声更厚
    d[i] = last;
  }
  NOISE_CACHE.set(ctx, b);
  return b;
}

const IMPULSE_CACHE = new WeakMap();
export function impulseBuffer(ctx, seconds = 3.1, decay = 2.6) {
  let map = IMPULSE_CACHE.get(ctx);
  if (!map) { map = new Map(); IMPULSE_CACHE.set(ctx, map); }
  const key = seconds + ':' + decay;
  if (map.has(key)) return map.get(key);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const early = (i < ctx.sampleRate * 0.06) ? 0.55 : 0.2;
      const env = Math.pow(1 - t, decay) * (0.55 + 0.45 * Math.sin(t * 37.0 + ch * 1.7));
      d[i] = (Math.random() * 2 - 1) * env * early;
    }
  }
  map.set(key, buf);
  return buf;
}

// ---------- 失真曲线 ----------
const CURVES = new Map();
function curveFor(drive) {
  const key = Math.round(drive * 10) / 10;
  if (CURVES.has(key)) return CURVES.get(key);
  const N = 2048;
  const c = new Float32Array(N);
  const k = Math.max(0.2, key);
  const norm = Math.tanh(k);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / norm;
  }
  CURVES.set(key, c);
  return c;
}

export class Synth {
  constructor(ctx, out, sends = {}, opts = {}) {
    this.ctx = ctx;
    this.out = out;
    this.sends = sends;
    this.rng = mulberry32(opts.seed ?? 1);
    this.intensity = 0;
    this.time = 0;

    // ---------- 总线 ----------
    this.drums = this._bus(0.9, 0.06, 0);
    this.bass = this._bus(0.92, 0, 0);
    this.leadBus = this._bus(0.8, 0.22, 0.30);
    this.fx = this._bus(0.75, 0.30, 0.10);

    // 和声组经过侧链 duck，让 kick 有呼吸感
    this.music = ctx.createGain();
    this.music.gain.value = 0.86;
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;
    this.music.connect(this.duckGain);
    this.duckGain.connect(this.out);
    this._send(this.duckGain, 0.34, 0.05);

    this.noise = noiseBuffer(ctx);
    this.toneCalls = 0;
  }

  _send(node, rev, dly) {
    const ctx = this.ctx;
    if (rev && this.sends.reverb) {
      const g = ctx.createGain();
      g.gain.value = rev;
      node.connect(g);
      g.connect(this.sends.reverb);
    }
    if (dly && this.sends.delay) {
      const g = ctx.createGain();
      g.gain.value = dly;
      node.connect(g);
      g.connect(this.sends.delay);
    }
  }

  _bus(gain, rev, dly) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(this.out);
    this._send(g, rev, dly);
    return g;
  }

  _pan(v) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, v));
    return p;
  }

  _osc(type, freq, t, dur, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.06);
    return o;
  }

  _perc(t, attack, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0003, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  _sus(t, attack, peak, dur, release) {
    const g = this.ctx.createGain();
    const atk = Math.min(attack, dur * 0.4);
    const rel = Math.min(release, dur * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0003, peak), t + atk);
    const hold = Math.max(t + atk + 0.005, t + dur - rel);
    g.gain.setValueAtTime(Math.max(0.0003, peak), hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  _filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _shaper(drive) {
    const ws = this.ctx.createWaveShaper();
    ws.curve = curveFor(drive);
    ws.oversample = '2x';
    return ws;
  }

  _noiseSrc(t, dur, o = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = o.rate ?? 1;
    const f = this._filter(o.type || 'bandpass', o.freq ?? 1200, o.q ?? 1);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t + dur);
    const g = this._perc(t, o.attack ?? 0.002, o.gain ?? 0.3, dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.bus || this.drums);
    src.start(t, Math.random() * 1.4);
    src.stop(t + dur + 0.04);
  }

  // ==========================================================
  //  鼓组
  // ==========================================================
  kick(t, vel = 1, o = {}) {
    const ctx = this.ctx;
    const dur = o.dur ?? 0.34;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = o.f0 ?? 155, f1 = o.f1 ?? 44;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + (o.pd ?? 0.085));
    const g = this._perc(t, 0.003, 0.95 * vel * (o.gain ?? 1), dur);
    if (o.drive) {
      const ws = this._shaper(o.drive);
      osc.connect(ws); ws.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(this.drums);
    osc.start(t);
    osc.stop(t + dur + 0.04);
    if (o.click !== false) {
      this._noiseSrc(t, 0.022, { type: 'highpass', freq: 2200, q: 0.6, gain: 0.16 * vel, bus: this.drums });
    }
    if (o.sub !== false) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(o.subFreq ?? 52, t);
      const sg = this._perc(t, 0.006, 0.28 * vel, dur * 1.05);
      sub.connect(sg); sg.connect(this.drums);
      sub.start(t); sub.stop(t + dur + 0.06);
    }
    this.duck(t, o.duck ?? 0.22, o.duckDur ?? 0.16);
  }

  snare(t, vel = 1, o = {}) {
    const ctx = this.ctx;
    const dur = o.dur ?? 0.22;
    this._noiseSrc(t, dur, {
      type: 'bandpass', freq: o.freq ?? 1850, q: o.q ?? 0.75,
      gain: 0.56 * vel * (o.gain ?? 1), bus: this.drums,
    });
    this._noiseSrc(t, dur * 0.6, {
      type: 'highpass', freq: 5200, q: 0.5, gain: 0.16 * vel, bus: this.drums,
    });
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(o.bodyFreq ?? 196, t);
    body.frequency.exponentialRampToValueAtTime((o.bodyFreq ?? 196) * 0.72, t + 0.1);
    const g = this._perc(t, 0.002, 0.30 * vel, dur * 0.9);
    body.connect(g); g.connect(this.drums);
    body.start(t); body.stop(t + dur);
  }

  ghost(t, vel = 0.4, o = {}) {
    this.snare(t, vel * 0.5, { freq: 2450, q: 1.3, dur: 0.08, bodyFreq: 240, gain: 0.75, ...o });
  }

  hat(t, vel = 1, open = false) {
    const dur = open ? 0.24 : 0.046;
    this._noiseSrc(t, dur, {
      type: 'highpass', freq: open ? 7200 : 8800, q: 0.65,
      gain: (open ? 0.15 : 0.12) * vel, bus: this.drums,
    });
    if (open) this._noiseSrc(t, 0.1, { type: 'bandpass', freq: 11500, q: 2, gain: 0.05 * vel, bus: this.drums });
  }

  ride(t, vel = 1) {
    this._noiseSrc(t, 0.55, { type: 'highpass', freq: 9200, q: 0.6, gain: 0.055 * vel, bus: this.drums });
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(6350, t);
    const g = this._perc(t, 0.002, 0.024 * vel, 0.4);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 0.45);
  }

  shaker(t, vel = 1) {
    this._noiseSrc(t, 0.052, { type: 'bandpass', freq: 6200, q: 2.6, gain: 0.1 * vel, bus: this.drums });
  }

  rim(t, vel = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1720, t);
    const g = this._perc(t, 0.001, 0.12 * vel, 0.03);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 0.05);
    this._noiseSrc(t, 0.035, { type: 'bandpass', freq: 3400, q: 2, gain: 0.14 * vel, bus: this.drums });
  }

  tom(t, vel = 1, midi = 45) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = this._perc(t, 0.004, 0.5 * vel, 0.34);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 0.38);
    this._noiseSrc(t, 0.05, { type: 'lowpass', freq: 900, q: 0.8, gain: 0.12 * vel, bus: this.drums });
  }

  clank(t, vel = 1, pitch = 1) {
    const ctx = this.ctx;
    const ws = this._shaper(2.2);
    const g = this._perc(t, 0.001, 0.20 * vel, 0.17);
    ws.connect(g); g.connect(this.fx);
    for (const [freq, type] of [[210 * pitch, 'square'], [517 * pitch, 'sawtooth'], [1230 * pitch, 'square']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.14);
      o.connect(ws);
      o.start(t); o.stop(t + 0.2);
    }
    this._noiseSrc(t, 0.13, { type: 'bandpass', freq: 2900, q: 3.5, gain: 0.16 * vel, bus: this.fx });
  }

  // ==========================================================
  //  低频
  // ==========================================================
  sub(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.glide !== undefined) {
      osc.frequency.setValueAtTime(f, t + Math.max(0, dur * 0.35));
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, mtof(midi + o.glide)), t + dur * 0.85);
    }
    const g = this._sus(t, 0.012, 0.62 * vel, dur, 0.11);
    osc.connect(g); g.connect(this.bass);
    osc.start(t); osc.stop(t + dur + 0.08);
    // 一点点三角波增加在小音箱上的可听度
    const hi = ctx.createOscillator();
    hi.type = 'triangle';
    hi.frequency.setValueAtTime(f * 2, t);
    const hg = this._sus(t, 0.01, 0.09 * vel, dur, 0.1);
    hi.connect(hg); hg.connect(this.bass);
    hi.start(t); hi.stop(t + dur + 0.08);
  }

  reese(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filt = this._filter('lowpass', o.f0 ?? 780, o.q ?? 5.5);
    filt.frequency.setValueAtTime(o.f0 ?? 780, t);
    filt.frequency.exponentialRampToValueAtTime(o.f1 ?? 180, t + Math.min(dur * 0.9, 0.55));
    const ws = this._shaper(o.drive ?? 2.4);
    filt.connect(ws);
    const g = this._sus(t, 0.008, 0.34 * vel * (o.gain ?? 1), dur, 0.1);
    ws.connect(g); g.connect(this.bass);
    for (const det of [-13, 0, 13]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(det, t);
      osc.connect(filt);
      osc.start(t); osc.stop(t + dur + 0.08);
    }
    // 低八度衬底
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f * 0.5, t);
    const sg = this._sus(t, 0.01, 0.18 * vel, dur, 0.1);
    sub.connect(sg); sg.connect(this.bass);
    sub.start(t); sub.stop(t + dur + 0.08);
  }

  wobble(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filt = this._filter('lowpass', 430, o.q ?? 8);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(o.rate ?? 5.8, t);
    if (o.rateEnd) lfo.frequency.linearRampToValueAtTime(o.rateEnd, t + dur);
    const depth = ctx.createGain();
    depth.gain.value = o.depth ?? 820;
    lfo.connect(depth);
    depth.connect(filt.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    const ws = this._shaper(o.drive ?? 3.4);
    filt.connect(ws);
    const g = this._sus(t, 0.006, 0.3 * vel, dur, 0.08);
    ws.connect(g); g.connect(this.bass);
    for (const det of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(det, t);
      osc.connect(filt);
      osc.start(t); osc.stop(t + dur + 0.06);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f * 0.5, t);
    const sg = this._sus(t, 0.005, 0.22 * vel, dur, 0.08);
    sub.connect(sg); sg.connect(this.bass);
    sub.start(t); sub.stop(t + dur + 0.06);
  }

  // ==========================================================
  //  和声 / 旋律
  // ==========================================================
  pad(t, notes, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const filt = this._filter('lowpass', o.cut ?? 1500, o.q ?? 0.6);
    if (o.sweep) {
      filt.frequency.setValueAtTime(o.cut ?? 900, t);
      filt.frequency.linearRampToValueAtTime(o.sweep, t + dur * 0.8);
    }
    const g = this._sus(t, o.attack ?? 0.7, 0.105 * vel, dur, o.release ?? 1.1);
    filt.connect(g);
    g.connect(this.music);
    for (let i = 0; i < notes.length; i++) {
      const f = mtof(notes[i]);
      const pan = this._pan((i / Math.max(1, notes.length - 1) - 0.5) * 0.55);
      pan.connect(filt);
      this._osc('sawtooth', f, t, dur, pan, -7);
      this._osc('sawtooth', f, t, dur, pan, 7);
      const tri = this._osc('triangle', f * 2, t, dur, filt);
      tri.detune.value = 0;
    }
  }

  piano(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(f, t);
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(f * (o.ratio ?? 2), t);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * (o.index ?? 2.2), t);
    modGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const g = this._perc(t, 0.004, 0.20 * vel, dur);
    carrier.connect(g);
    g.connect(this.music);
    carrier.start(t); carrier.stop(t + dur + 0.05);
    mod.start(t); mod.stop(t + dur + 0.05);
    // 高八度泛音，增加琴键质感
    const h = ctx.createOscillator();
    h.type = 'triangle';
    h.frequency.setValueAtTime(f * 2.01, t);
    const hg = this._perc(t, 0.003, 0.028 * vel, dur * 0.55);
    h.connect(hg); hg.connect(this.music);
    h.start(t); h.stop(t + dur * 0.6);
  }

  bell(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(f, t);
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(f * (o.ratio ?? 3.5), t);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * (o.index ?? 1.8), t);
    modGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    mod.connect(modGain); modGain.connect(carrier.frequency);
    const g = this._perc(t, 0.002, 0.15 * vel, dur);
    carrier.connect(g); g.connect(this.music);
    carrier.start(t); carrier.stop(t + dur + 0.05);
    mod.start(t); mod.stop(t + dur + 0.05);
  }

  pluck(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filt = this._filter('lowpass', o.cut ?? 3400, o.q ?? 2.2);
    filt.frequency.setValueAtTime(o.cut ?? 3400, t);
    filt.frequency.exponentialRampToValueAtTime(o.cutEnd ?? 700, t + Math.min(dur, 0.2));
    const g = this._perc(t, 0.002, 0.17 * vel, dur);
    filt.connect(g);
    g.connect(o.bus || this.leadBus);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sawtooth';
    osc.frequency.setValueAtTime(f, t);
    osc.connect(filt);
    osc.start(t); osc.stop(t + dur + 0.04);
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(f * 0.5, t);
    const sg = this._perc(t, 0.002, 0.05 * vel, dur * 0.8);
    sub.connect(sg); sg.connect(o.bus || this.leadBus);
    sub.start(t); sub.stop(t + dur);
  }

  lead(t, midi, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filt = this._filter('lowpass', o.cut ?? 2600, o.q ?? 3);
    filt.frequency.setValueAtTime(o.cut ?? 2600, t);
    filt.frequency.exponentialRampToValueAtTime(o.cutEnd ?? 1300, t + Math.min(dur * 0.8, 0.6));
    const g = this._sus(t, 0.012, 0.13 * vel, dur, 0.1);
    filt.connect(g); g.connect(this.leadBus);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(f, t);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(f * 0.5, t);
    o2.detune.setValueAtTime(4, t);
    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.setValueAtTime(o.vibrato ?? 5.4, t);
    const vg = ctx.createGain();
    vg.gain.value = o.vibDepth ?? 7;
    vib.connect(vg); vg.connect(o1.detune); vg.connect(o2.detune);
    o1.connect(filt); o2.connect(filt);
    for (const x of [o1, o2, vib]) { x.start(t); x.stop(t + dur + 0.06); }
  }

  choir(t, notes, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const bp = this._filter('bandpass', o.formant ?? 780, o.q ?? 1.1);
    const lp = this._filter('lowpass', o.cut ?? 2100, 0.7);
    bp.connect(lp);
    const g = this._sus(t, o.attack ?? 0.45, 0.06 * vel, dur, o.release ?? 1.3);
    lp.connect(g); g.connect(this.music);
    for (let i = 0; i < notes.length; i++) {
      const f = mtof(notes[i]);
      const p = this._pan((i / Math.max(1, notes.length - 1) - 0.5) * 0.7);
      p.connect(bp);
      this._osc('sawtooth', f, t, dur, p, -9);
      this._osc('sawtooth', f, t, dur, p, 9);
      this._osc('triangle', f, t, dur, bp, 0);
    }
  }

  stab(t, notes, dur, vel = 1, o = {}) {
    const ctx = this.ctx;
    const filt = this._filter('lowpass', o.cut ?? 2600, o.q ?? 2.4);
    filt.frequency.setValueAtTime(o.cut ?? 2600, t);
    filt.frequency.exponentialRampToValueAtTime(o.cutEnd ?? 700, t + dur * 0.85);
    const g = this._perc(t, 0.003, 0.09 * vel, dur);
    filt.connect(g); g.connect(this.leadBus);
    for (const midi of notes) {
      const f = mtof(midi);
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(f, t);
      o1.connect(filt);
      o1.start(t); o1.stop(t + dur + 0.03);
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.setValueAtTime(f * 1.005, t);
      o2.connect(filt);
      o2.start(t); o2.stop(t + dur + 0.03);
    }
  }

  // ==========================================================
  //  FX
  // ==========================================================
  riser(t, dur, vel = 1) {
    const ctx = this.ctx;
    this._noiseSrc(t, dur, {
      type: 'bandpass', freq: 320, to: 8600, q: 1.6,
      gain: 0.001, attack: dur * 0.92, bus: this.fx,
    });
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035 * vel, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.02);
    o.connect(g); g.connect(this.fx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  impact(t, vel = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.85);
    const g = this._perc(t, 0.004, 0.75 * vel, 1.15);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 1.2);
    this._noiseSrc(t, 0.55, { type: 'lowpass', freq: 700, to: 120, q: 0.8, gain: 0.25 * vel, bus: this.fx });
  }

  reverse(t, dur, vel = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this._filter('highpass', 3400, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    src.connect(f); f.connect(g); g.connect(this.fx);
    src.start(t, Math.random()); src.stop(t + dur + 0.03);
  }

  subdrop(t, vel = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(22, t + 1.6);
    const g = this._perc(t, 0.01, 0.55 * vel, 1.7);
    o.connect(g); g.connect(this.bass);
    o.start(t); o.stop(t + 1.75);
  }

  siren(t, dur, vel = 1) {
    const ctx = this.ctx;
    const filt = this._filter('bandpass', 1100, 3);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.linearRampToValueAtTime(880, t + dur * 0.5);
    o.frequency.linearRampToValueAtTime(360, t + dur);
    const g = this._sus(t, 0.15, 0.045 * vel, dur, 0.3);
    o.connect(filt); filt.connect(g); g.connect(this.fx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  crackle(t, vel = 1) {
    this._noiseSrc(t, 0.02, { type: 'bandpass', freq: 1600, q: 1.4, gain: 0.028 * vel, bus: this.fx });
  }

  duck(t, depth = 0.25, dur = 0.18) {
    const p = this.duckGain.gain;
    p.setValueAtTime(1, t);
    p.linearRampToValueAtTime(Math.max(0.2, 1 - depth), t + 0.008);
    p.linearRampToValueAtTime(1, t + dur);
  }

  dispose() {
    for (const b of [this.drums, this.bass, this.leadBus, this.fx, this.music, this.duckGain]) {
      try { b.disconnect(); } catch (e) { /* ignore */ }
    }
  }
}