// ============================================================
//  曲目 2 · 瓷砖深渊 TILE ABYSS
//  Techstep / Neurofunk · 172 BPM · F# phrygian · 96 bars ≈ 2:14
//  配方：失真 Reese、工业金属敲击、低频 drone、半拍崩塌段、升调终段
// ============================================================
import { n, chord, CH } from '../theory.mjs';
import { dnbDrums, heartbeat } from '../patterns.mjs';

const SECTIONS = [
  [0, 8, 'intro'],
  [8, 16, 'build'],
  [16, 40, 'dropA'],
  [40, 48, 'break'],
  [48, 72, 'dropB'],
  [72, 80, 'bridge'],
  [80, 92, 'dropC'],
  [92, 96, 'outro'],
];

const ROOT = n('F#1');
const DRONE = chord(n('F#2'), CH.min);       // F# A C#
const STAB = [n('F#3'), n('A3'), n('C#4')];
const LEAD = [
  [0, 0, 66, 8], [0, 8, 73, 6],
  [1, 2, 69, 4], [1, 8, 67, 8],
  [2, 0, 66, 6], [2, 6, 64, 2], [2, 8, 61, 8],
  [3, 0, 62, 12],
  [4, 0, 66, 4], [4, 4, 69, 4], [4, 8, 73, 8],
  [5, 0, 71, 6], [5, 6, 69, 2], [5, 8, 66, 8],
  [6, 0, 67, 8], [6, 8, 69, 8],
  [7, 0, 66, 16],
];

// 低音 riff：[步, 时值, 相对根音半音]
const RIFF = [
  [0, 4, 0], [4, 2, 0], [6, 2, 1], [8, 4, 3], [12, 2, 7], [14, 2, 5],
];

function inDrop(sec) { return sec === 'dropA' || sec === 'dropB' || sec === 'dropC'; }

export const tileAbyss = {
  id: 'tile-abyss',
  name: '瓷砖深渊',
  en: 'TILE ABYSS',
  bpm: 172,
  bars: 96,
  key: 'F# phrygian',
  reverb: 0.27,
  reverbTime: 2.2,
  delayBeats: 0.5,
  desc: 'Techstep｜瓷砖缝里渗出的电流声，失真 Reese 与金属敲击把走廊压成一条黑线。',
  sections: SECTIONS,

  onBar(c) {
    const bar = c.bar;
    const sec = c.section;
    const tr = sec === 'dropC' ? 1 : 0;      // 终段升半音，制造压迫感
    const root = ROOT + tr;
    const drop = inDrop(sec);

    // ---------- 鼓 ----------
    if (sec === 'intro') {
      if (bar >= 2) {
        c.kick(0, 0.42, { f0: 120, f1: 40, click: false });
        for (let s = 0; s < 16; s += 2) c.hat(s, 0.18 + (s % 4 === 0 ? 0.12 : 0));
        c.clank(3, 0.35, 0.9 + c.rng() * 0.2);
        if (bar >= 4) c.clank(11, 0.28, 1.1);
      }
    } else if (sec === 'build') {
      dnbDrums(c, {
        variant: bar, vel: 0.55 + (bar - 8) * 0.05, hats: true,
        ghostChance: 0.4, ghosts32: 0.3, fill: bar === 15 ? 'long' : null,
        kickOpts: { drive: 1.6, f0: 130, f1: 42 },
      });
      c.clank(3, 0.3, 1); c.clank(11, 0.3, 1.2);
    } else if (drop) {
      dnbDrums(c, {
        variant: bar + (sec === 'dropB' ? 1 : 0), vel: 1.0,
        hats: true, hatSkip: [2, 5, 10, 13], shaker: false,
        ghostChance: 0.55, ghosts32: 0.2,
        fill: bar % 8 === 7 ? 'long' : null,
        kickOpts: { drive: 2.2, f0: 135, f1: 40, subFreq: 50 },
        snareOpts: { freq: 1750, bodyFreq: 180 },
      });
      // 工业敲击
      c.clank(3, 0.42 + c.energy * 0.2, 0.9 + c.rng() * 0.25);
      c.clank(11, 0.34, 1.15 + c.rng() * 0.2);
      if (c.rng() < 0.45) c.clank(15, 0.2, 1.5);
      if (c.rng() < 0.35) c.tom(14, 0.45, 38 + tr);
      if (bar % 4 === 3) { c.tom(15, 0.5, 41 + tr); c.tom(15.5, 0.35, 36 + tr); }
    } else if (sec === 'break') {
      heartbeat(c, 0.8, [0, 6, 10]);
      c.clank(4, 0.3, 0.8);
      c.clank(12, 0.25, 1.3);
      if (bar >= 44) c.hat(bar - 44, 0.4);
    } else if (sec === 'bridge') {
      dnbDrums(c, {
        variant: bar, vel: 0.5, hats: true, hatSkip: [1, 3, 5, 7, 9, 11, 13, 15],
        ghostChance: 0.25, ghosts32: 0.05, kickOpts: { drive: 1.5 },
      });
      if (bar >= 76) {
        for (let i = 0; i < 8; i++) c.ghost(12 + i * 0.5, 0.2 + i * 0.06);
      }
    } else if (sec === 'outro') {
      if (bar < 94) {
        c.kick(0, 0.6, { drive: 2, click: false, f0: 120, f1: 38 });
        c.clank(8, 0.25, 0.9);
      }
    }

    // ---------- 低音 ----------
    if (drop) {
      for (const [st, dur, off] of RIFF) {
        c.reese(root + off, st, dur, st === 0 ? 0.92 : 0.72, {
          f0: 1150, f1: 240, drive: 3.2, q: 7, gain: 0.85,
        });
      }
      c.sub(root, 0, 6, 0.8);
      c.sub(root + 3, 8, 5, 0.6);
      // 结尾段的第二条锯齿
      if (sec === 'dropC') c.reese(root + 12, 0, 12, 0.24, { f0: 800, f1: 160, drive: 3.6 });
    } else if (sec === 'build' || sec === 'bridge') {
      c.sub(root, 0, 12, 0.55);
      if (bar % 2 === 0) c.reese(root + 12, 8, 6, 0.22, { f0: 600, f1: 180, drive: 2.5 });
    } else if (sec === 'break') {
      c.sub(root, 0, 16, 0.34);
    }

    // ---------- 和声 ----------
    c.pad(DRONE.map(x => x + 12 + tr), 0, 16, drop ? 0.5 : 0.42, {
      attack: 0.4, release: 1.2, cut: drop ? 1200 : 700, q: 0.8,
    });
    if (drop) {
      const stab = STAB.map(x => x + tr);
      for (const st of [3, 7, 11, 15]) {
        c.stab(stab, st, 1.2, 0.5, { cut: 3000, cutEnd: 700 });
      }
    }
    if (sec === 'break') {
      c.choir(DRONE.map(x => x + 12 + tr), 0, 28, 0.55, { attack: 1.2, release: 1.8, formant: 620 });
    }

    // ---------- 主旋律 ----------
    if (sec === 'dropA' && bar < 24) {
      for (const [b, st, midi, dur] of LEAD) {
        if (b === bar - 16) c.lead(midi, st, dur, 0.24, { cut: 2200, cutEnd: 900, vibrato: 4.2 });
      }
    }
    if (sec === 'dropB' && bar < 56) {
      for (const [b, st, midi, dur] of LEAD) {
        if (b === bar - 48) c.lead(midi + 12, st, dur, 0.2, { cut: 2800, cutEnd: 1100, vibrato: 5.0 });
      }
    }
    if (sec === 'dropC' && bar < 88) {
      for (const [b, st, midi, dur] of LEAD) {
        if (b === bar - 80) c.lead(midi + tr, st, dur, 0.26, { cut: 3000, cutEnd: 1000, vibrato: 4.6 });
      }
    }

    // ---------- 过渡 ----------
    if (bar === 8) c.impact(0, 0.6);
    if (bar === 12) c.riser(0, 32, 0.8);
    if (bar === 15) { c.reverse(0, 14, 0.8); c.siren(0, 24, 0.5); }
    if (bar === 16) c.impact(0, 1.0);
    if (bar === 39) c.reverse(0, 14, 0.8);
    if (bar === 40) { c.impact(0, 0.8); c.subdrop(0, 0.5); }
    if (bar === 44) c.siren(0, 32, 0.65);
    if (bar === 47) c.riser(0, 16, 1.0);
    if (bar === 48) c.impact(0, 1.0);
    if (bar === 71) { c.reverse(0, 14, 0.8); c.siren(0, 16, 0.5); }
    if (bar === 72) c.impact(0, 0.7);
    if (bar === 78) c.riser(0, 32, 1.0);
    if (bar === 79) c.reverse(0, 14, 0.9);
    if (bar === 80) c.impact(0, 1.2);
    if (bar === 91) c.reverse(0, 14, 0.8);
    if (bar === 92) { c.subdrop(0, 0.8); c.impact(0, 0.9); }
  },
};
