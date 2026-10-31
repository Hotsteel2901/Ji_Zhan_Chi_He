// ============================================================
//  BGM 入口：五首程序化 D&B（WebAudio 实时合成，无音频文件）
//  控制：M 开关 / [ ] 切歌；游戏内根据战斗强度自动加层
// ============================================================
import { MusicEngine } from './src/music/engine.mjs';
import { TRACKS } from './src/music/tracks/index.mjs';

let label = '待机';

const engine = new MusicEngine({
  onTrackChange: (track, index) => {
    label = track ? track.name + ' — ' + track.en : '待机';
    if (typeof window !== 'undefined' && window.__pcMusicTick) window.__pcMusicTick(track, index);
    if (bgm._onChange) bgm._onChange(track, index);
  },
});
engine.setVolume(0.7);

const bgm = {
  tracks: TRACKS,
  songs: TRACKS,
  get idx() { return engine.trackIndex; },
  get playing() { return engine.playing; },
  get ready() { return !!engine.ctx; },
  get current() { return engine.track; },
  get label() { return label; },
  start() { engine.start(engine.trackIndex || 0); engine.setVolume(this._vol ?? 0.7); },
  toggle() { engine.toggle(); return engine.playing; },
  next() { return engine.next(); },
  prev() { return engine.prev(); },
  seek(i) { engine.seek(i); },
  stop() { engine.stop(); },
  setVolume(v) { this._vol = v; engine.setVolume(v); },
  setIntensity(v) { engine.setIntensity(v); },
  setUnderwater(v) { engine.setUnderwater(v); },
  setPaused(v) { engine.setPaused(v); },
  _probe() { return engine.probe(); },
  _engine: engine,
  _el() { return null; },
};

export { bgm, TRACKS };
