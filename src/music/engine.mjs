// ============================================================
//  BGM 引擎：五首 D&B 的实时编曲 / 前瞻调度 / 混音 / 自适应强度
//  - 绝对时间轴，主线程卡顿也不会抢拍
//  - 曲目间 crossfade，五首循环播放
//  - 支持 OfflineAudioContext 离线渲染（用于自动验证与导出试听）
// ============================================================
import { Synth, impulseBuffer } from './synth.mjs';
import { mulberry32, sectionAt } from './theory.mjs';
import { TRACKS } from './tracks/index.mjs';

const LOOKAHEAD = 0.32;
const TIMER_MS = 40;

export class MusicEngine {
  constructor(opts = {}) {
    this.volume = 1;
    this.ctx = null;
    this.playing = false;
    this.trackIndex = 0;
    this.track = null;
    this.active = null;
    this.bar = 0;
    this.nextBarTime = 0;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.underwater = false;
    this.paused = false;
    this.seed = opts.seed ?? ((Date.now() & 0x7fffffff) || 1);
    this.onTrackChange = opts.onTrackChange || null;
    this.onSection = opts.onSection || null;
    this._timer = null;
    this._queued = null;
    this._errors = 0;
    this._lastSection = null;
    this._uw = 0;
  }

  // ----------------------------------------------------------
  //  初始化 / 总线
  // ----------------------------------------------------------
  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('WebAudio unavailable');
    const ctx = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;

    this.mix = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.lp.Q.value = 0.4;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.4;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.09;

    this.mix.connect(this.master);
    this.master.connect(this.lp);
    this.lp.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // 混响
    this.revIn = ctx.createGain();
    this.rev = ctx.createConvolver();
    this.rev.buffer = impulseBuffer(ctx, 4.0, 2.5);
    this.revReturn = ctx.createGain();
    this.revReturn.gain.value = 0.75;
    this.revIn.connect(this.rev);
    this.rev.connect(this.revReturn);
    this.revReturn.connect(this.mix);

    // 反馈延迟（与 BPM 同步）
    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(4.0);
    this.delay.delayTime.value = 0.26;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.33;
    this.delayLp = ctx.createBiquadFilter();
    this.delayLp.type = 'lowpass';
    this.delayLp.frequency.value = 3200;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.55;
    this.delayIn.connect(this.delay);
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delayLp);
    this.delayLp.connect(this.delay);
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.mix);

    this.sends = { reverb: this.revIn, delay: this.delayIn };
  }

  // ----------------------------------------------------------
  //  播放控制
  // ----------------------------------------------------------
  start(index = 0) {
    this._ensure();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.paused ? this.volume * 0.3 : this.volume, ctx.currentTime, 0.25);
    if (this.playing && this.active) return;
    this.playing = true;
    this._beginTrack(index | 0, ctx.currentTime + 0.10, 1.2, 0.8);
    this.nextBarTime = ctx.currentTime + 0.10;
    this.bar = 0;
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), TIMER_MS);
    this._tick();
  }

  stop(fade = 0.7) {
    this.playing = false;
    this._queued = null;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.0001, t, fade / 3);
    const active = this.active;
    this.active = null;
    if (active) {
      active.gain.gain.cancelScheduledValues(t);
      active.gain.gain.setTargetAtTime(0.0001, t, 0.2);
      setTimeout(() => { try { active.gain.disconnect(); } catch (e) { /* ignore */ } }, (fade + 0.8) * 1000);
    }
  }

  toggle() {
    if (this.playing) this.stop(0.6);
    else this.start(this.trackIndex || 0);
    return this.playing;
  }

  next() { this.seek((this.trackIndex + 1) % TRACKS.length); return this.trackIndex; }
  prev() { this.seek((this.trackIndex - 1 + TRACKS.length) % TRACKS.length); return this.trackIndex; }

  seek(index) {
    const i = ((index | 0) % TRACKS.length + TRACKS.length) % TRACKS.length;
    this._queued = i;
    if (!this.playing) { this.start(i); this._queued = null; }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.paused ? this.volume * 0.3 : this.volume, this.ctx.currentTime, 0.15);
    }
  }

  setPaused(p) {
    this.paused = !!p;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(p ? this.volume * 0.3 : this.volume, this.ctx.currentTime, 0.25);
    }
  }

  setIntensity(v) {
    this.targetIntensity = Math.max(0, Math.min(1, v));
  }

  setUnderwater(on) {
    this.underwater = !!on;
  }

  // ----------------------------------------------------------
  //  曲目切换
  // ----------------------------------------------------------
  _beginTrack(index, atTime, fadeIn, fadeOut) {
    const ctx = this.ctx;
    const track = TRACKS[index];
    if (!track) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, atTime);
    gain.gain.linearRampToValueAtTime(1, atTime + fadeIn);
    gain.connect(this.mix);
    const synth = new Synth(ctx, gain, this.sends, {
      seed: (this.seed ^ ((index + 1) * 2654435761)) >>> 0,
    });
    synth.intensity = this.intensity;

    const old = this.active;
    this.active = { track, gain, synth };
    this.track = track;
    this.trackIndex = index;
    this.bar = 0;
    this._lastSection = null;

    if (old) {
      const cur = Math.max(0.0002, old.gain.gain.value || 1);
      old.gain.gain.cancelScheduledValues(atTime);
      old.gain.gain.setValueAtTime(cur, atTime);
      old.gain.gain.exponentialRampToValueAtTime(0.0002, atTime + fadeOut);
      setTimeout(() => {
        try { old.gain.disconnect(); } catch (e) { /* ignore */ }
        try { old.synth.dispose(); } catch (e) { /* ignore */ }
      }, (fadeOut + 0.4) * 1000);
    }

    // 混响量 / 延迟时间随曲目调整
    this.revReturn.gain.setTargetAtTime(0.45 + (track.reverb ?? 0.3) * 1.1, atTime, 0.4);
    const dly = (60 / track.bpm) * (track.delayBeats ?? 0.75);
    this.delay.delayTime.setTargetAtTime(dly, atTime, 0.08);

    if (this.onTrackChange) this.onTrackChange(track, index);
  }

  _autoAdvance(atTime) {
    const next = (this.trackIndex + 1) % TRACKS.length;
    this._beginTrack(next, atTime, 0.9, 1.3);
  }

  // ----------------------------------------------------------
  //  调度循环
  // ----------------------------------------------------------
  _tick() {
    if (!this.playing || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 强度 / 水下滤波平滑
    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    if (this.active) this.active.synth.intensity = this.intensity;
    const uwTarget = this.underwater ? 1 : 0;
    this._uw += (uwTarget - this._uw) * 0.12;
    const cutoff = 20000 - this._uw * 19300;
    this.lp.frequency.setTargetAtTime(cutoff, now, 0.08);

    // 严重滞后（后台标签页节流）时跳到下一个合法小节，避免一次性补播
    const barDur = (60 / this.active.track.bpm) * 4;
    if (now - this.nextBarTime > 0.55) {
      const skip = Math.ceil((now - this.nextBarTime) / barDur);
      this.bar += skip;
      this.nextBarTime += skip * barDur;
      while (this.bar >= this.active.track.bars) {
        this.bar -= this.active.track.bars;
        const next = (this.trackIndex + 1) % TRACKS.length;
        this._beginTrack(next, this.nextBarTime, 0.5, 0.5);
      }
    }

    let guard = 0;
    while (this.nextBarTime < now + LOOKAHEAD && guard++ < 10) {
      if (this._queued !== null) {
        const q = this._queued;
        this._queued = null;
        this._beginTrack(q, this.nextBarTime, 0.12, 0.35);
      }
      if (this.bar >= this.active.track.bars) {
        const at = this.nextBarTime;
        this._autoAdvance(at);
        continue;
      }
      const track = this.active.track;
      const c = new BarCtx(this, track, this.bar, this.nextBarTime, this.active.synth);
      if (c.section !== this._lastSection) {
        this._lastSection = c.section;
        if (this.onSection) this.onSection(track, c.section, this.bar);
      }
      try {
        track.onBar(c);
      } catch (err) {
        this._errors++;
        if (this._errors < 8) console.warn('[music] bar failed', track.id, this.bar, err);
      }
      this.bar++;
      this.nextBarTime += (60 / track.bpm) * 4;
    }
  }

  probe() {
    const t = this.active ? this.active.track : null;
    return {
      playing: this.playing,
      trackIndex: this.trackIndex,
      track: t ? t.name : null,
      bar: this.bar,
      bars: t ? t.bars : 0,
      bpm: t ? t.bpm : 0,
      section: t ? sectionAt(t.sections, Math.max(0, this.bar - 1)) : null,
      intensity: Number(this.intensity.toFixed(3)),
      underwater: this.underwater,
      queued: this._queued,
      errors: this._errors,
      ctxTime: this.ctx ? Number(this.ctx.currentTime.toFixed(2)) : null,
      state: this.ctx ? this.ctx.state : 'none',
    };
  }
}

// ============================================================
//  一个小节的可读作曲 API
// ============================================================
export class BarCtx {
  constructor(engine, track, bar, time, synth) {
    this.engine = engine;
    this.track = track;
    this.synth = synth || (engine.active && engine.active.synth);
    this.bar = bar;
    this.time = time;
    this.stepDur = (60 / track.bpm) / 4;
    this.barDur = this.stepDur * 16;
    this.section = sectionAt(track.sections, bar);
    this.energy = engine.intensity ?? 0;
    this.rng = mulberry32(((engine.seed ^ (bar * 2654435761) ^ (track.bpm * 97)) >>> 0));
  }
  at(step) { return this.time + step * this.stepDur; }

  kick(step, vel = 1, o) { this.synth.kick(this.at(step), vel, o); }
  snare(step, vel = 1, o) { this.synth.snare(this.at(step), vel, o); }
  ghost(step, vel = 0.4, o) { this.synth.ghost(this.at(step), vel, o); }
  hat(step, vel = 1, open = false) { this.synth.hat(this.at(step), vel, open); }
  ride(step, vel = 1) { this.synth.ride(this.at(step), vel); }
  shaker(step, vel = 1) { this.synth.shaker(this.at(step), vel); }
  rim(step, vel = 1) { this.synth.rim(this.at(step), vel); }
  tom(step, vel = 1, midi = 45) { this.synth.tom(this.at(step), vel, midi); }
  clank(step, vel = 1, pitch = 1) { this.synth.clank(this.at(step), vel, pitch); }

  sub(midi, step, durSteps, vel = 1, o) { this.synth.sub(this.at(step), midi, durSteps * this.stepDur, vel, o); }
  reese(midi, step, durSteps, vel = 1, o) { this.synth.reese(this.at(step), midi, durSteps * this.stepDur, vel, o); }
  wobble(midi, step, durSteps, vel = 1, o) { this.synth.wobble(this.at(step), midi, durSteps * this.stepDur, vel, o); }

  pad(notes, step, durSteps, vel = 1, o) { this.synth.pad(this.at(step), notes, durSteps * this.stepDur, vel, o); }
  piano(midi, step, durSteps, vel = 1, o) { this.synth.piano(this.at(step), midi, durSteps * this.stepDur, vel, o); }
  bell(midi, step, durSteps, vel = 1, o) { this.synth.bell(this.at(step), midi, durSteps * this.stepDur, vel, o); }
  pluck(midi, step, durSteps, vel = 1, o) { this.synth.pluck(this.at(step), midi, durSteps * this.stepDur, vel, o); }
  lead(midi, step, durSteps, vel = 1, o) { this.synth.lead(this.at(step), midi, durSteps * this.stepDur, vel, o); }
  choir(notes, step, durSteps, vel = 1, o) { this.synth.choir(this.at(step), notes, durSteps * this.stepDur, vel, o); }
  stab(notes, step, durSteps, vel = 1, o) { this.synth.stab(this.at(step), notes, durSteps * this.stepDur, vel, o); }

  riser(step, durSteps, vel = 1) { this.synth.riser(this.at(step), durSteps * this.stepDur, vel); }
  impact(step, vel = 1) { this.synth.impact(this.at(step), vel); }
  reverse(step, durSteps, vel = 1) { this.synth.reverse(this.at(step), durSteps * this.stepDur, vel); }
  subdrop(step, vel = 1) { this.synth.subdrop(this.at(step), vel); }
  siren(step, durSteps, vel = 1) { this.synth.siren(this.at(step), durSteps * this.stepDur, vel); }
  crackle(step, vel = 1) { this.synth.crackle(this.at(step), vel); }
}

// ============================================================
//  离线渲染（验证 / 试听导出）
// ============================================================
export async function renderTrackOffline(trackIndex, seconds, sampleRate = 44100, opts = {}) {
  const track = TRACKS[trackIndex];
  if (!track) throw new Error('no track ' + trackIndex);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);

  const mix = ctx.createGain();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 20000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 3;
  comp.attack.value = 0.005; comp.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.4; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.09;
  mix.connect(master); master.connect(lp); lp.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);

  const revIn = ctx.createGain();
  const rev = ctx.createConvolver();
  rev.buffer = impulseBuffer(ctx, 4.0, 2.5);
  const revReturn = ctx.createGain();
  revReturn.gain.value = 0.45 + (track.reverb ?? 0.3) * 1.1;
  revIn.connect(rev); rev.connect(revReturn); revReturn.connect(mix);

  const delayIn = ctx.createGain();
  const delay = ctx.createDelay(4);
  delay.delayTime.value = (60 / track.bpm) * (track.delayBeats ?? 0.75);
  const fb = ctx.createGain(); fb.gain.value = 0.33;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3200;
  const dret = ctx.createGain(); dret.gain.value = 0.55;
  delayIn.connect(delay); delay.connect(fb); fb.connect(dlp); dlp.connect(delay);
  delay.connect(dret); dret.connect(mix);

  const gain = ctx.createGain();
  gain.gain.value = 1;
  gain.connect(mix);
  const synth = new Synth(ctx, gain, { reverb: revIn, delay: delayIn }, { seed: opts.seed ?? 20240817 });
  const engineLike = { seed: opts.seed ?? 20240817, intensity: opts.intensity ?? 0.45, active: { synth } };

  let t = 0, bar = 0;
  const barDur = (60 / track.bpm) * 4;
  while (t < seconds) {
    if (bar >= track.bars) bar = 0;
    const c = new BarCtx(engineLike, track, bar, t, synth);
    track.onBar(c);
    bar++;
    t += barDur;
  }
  const buffer = await ctx.startRendering();
  return buffer;
}

/** AudioBuffer → 16bit PCM WAV（用于试听导出） */
export function bufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * numCh * 2));
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) data.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); data.setUint32(4, 36 + len * numCh * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
  data.setUint16(22, numCh, true); data.setUint32(24, sr, true);
  data.setUint32(28, sr * numCh * 2, true); data.setUint16(32, numCh * 2, true);
  data.setUint16(34, 16, true); writeStr(36, 'data'); data.setUint32(40, len * numCh * 2, true);
  let off = 44;
  const chans = [];
  for (let ch = 0; ch < numCh; ch++) chans.push(buffer.getChannelData(ch));
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const v = Math.max(-1, Math.min(1, chans[ch][i]));
      data.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return data.buffer;
}
