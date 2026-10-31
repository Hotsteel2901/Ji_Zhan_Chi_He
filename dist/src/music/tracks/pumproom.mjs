// ============================================================
//  曲目 4 · 泵房脉冲 PUMP ROOM
//  Jump-up / Neurofunk · 176 BPM · E phrygian · 96 bars ≈ 2:11
//  配方：Wobble 低音、重击鼓组、机械泵体节奏、警报、Rave 和弦刺
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

const ROOTS = [n('E1'), n('F1'), n('G1'), n('A1')];
const CHORDS = [
  chord(n('E3'), CH.min7),   // E G B D
  chord(n('F3'), CH.maj7),   // F A C E
  chord(n('G3'), CH.maj6),   // G B D E
  chord(n('A3'), CH.min7),   // A C E G
];

// 低音序列：[步, 时值, 相对根音半音, wobble 速率]
const BASS = [
  [0, 6, 0, 5.87],
  [6, 2, 0, 11.73],
  [8, 4, 0, 5.87],
  [12, 2, 3, 11.73],
  [14, 2, 5, 11.73],
];

const LEAD = [
  [0, 0, 76, 4], [0, 4, 79, 4], [0, 8, 81, 4], [0, 12, 83, 4],
  [1, 0, 81, 4], [1, 4, 79, 4], [1, 8, 76, 6],
  [2, 0, 76, 4], [2, 4, 77, 4], [2, 8, 79, 4], [2, 12, 81, 4],
  [3, 0, 83, 8], [3, 10, 79, 2], [3, 12, 76, 4],
];

function inDrop(sec) { return sec === 'dropA' || sec === 'dropB' || sec === 'dropC'; }

export const pumpRoom = {
  id: 'pump-room',
  name: '泵房脉冲',
  en: 'PUMP ROOM',
  bpm: 176,
  bars: 96,
  key: 'E phrygian',
  reverb: 0.2,
  reverbTime: 1.8,
  delayBeats: 0.5,
  desc: 'Jump-up｜水泵机房的低频脉冲贴着地面滚过来，Wobble 像失控的叶轮。',
  sections: SECTIONS,

  onBar(c) {
    const bar = c.bar;
    const sec = c.section;
    const ci = bar % 4;
    const root = ROOTS[ci];
    const chordNotes = CHORDS[ci];
    const drop = inDrop(sec);

    // ---------- 鼓 ----------
    if (sec === 'intro') {
      if (bar >= 2) {
        c.kick(0, 0.6, { f0: 140, f1: 40, click: false, drive: 1.4 });
        c.kick(8, 0.42, { f0: 130, f1: 40, click: false });
        for (let s = 0; s < 16; s++) c.hat(s, s % 2 === 0 ? 0.2 : 0.1);
        if (bar >= 4) c.clank(3, 0.2, 1.2);
      }
    } else if (sec === 'build') {
      dnbDrums(c, {
        variant: bar, vel: 0.58 + (bar - 8) * 0.05,
        hats: true, shaker: true, ghostChance: 0.5, ghosts32: 0.35,
        fill: bar === 15 ? 'long' : null,
        kickOpts: { drive: 2.2, f0: 145, f1: 40 },
      });
      if (bar >= 12) {
        for (let i = 0; i < 8; i++) c.ghost(12 + i * 0.5, 0.18 + i * 0.05);
      }
    } else if (drop) {
      dnbDrums(c, {
        variant: bar + (sec === 'dropB' ? 1 : 0), vel: 1.0,
        hats: true, shaker: sec !== 'dropA', ghostChance: 0.6, ghosts32: 0.32,
        openAt: [6, 14], fill: bar % 8 === 7 ? 'long' : null,
        kickOpts: { drive: 2.6, f0: 150, f1: 38, subFreq: 48, gain: 1.05 },
        snareOpts: { freq: 1650, bodyFreq: 172, gain: 1.1 },
      });
      c.clank(7, 0.3 + c.energy * 0.15, 1.4);
      if (c.rng() < 0.4) c.tom(15, 0.4, 40);
    } else if (sec === 'break') {
      heartbeat(c, 0.85, [0, 8]);
      for (let s = 0; s < 16; s += 4) c.hat(s, 0.22);
      c.clank(6, 0.25, 0.9);
      if (bar >= 44) c.siren(0, 24, 0.4);
    } else if (sec === 'bridge') {
      c.snare(4, 0.6); c.snare(12, 0.6);
      c.kick(0, 0.7, { drive: 2 });
      if (bar >= 74) {
        for (let i = 0; i < 16; i++) c.ghost(i * 0.5, 0.12 + i * 0.035);
      }
    } else if (sec === 'outro') {
      if (bar < 94) {
        c.kick(0, 0.6, { drive: 2, f0: 130, f1: 38, click: false });
        c.hat(4, 0.15); c.hat(12, 0.15);
      }
    }

    // ---------- 低音 ----------
    if (drop) {
      for (const [st, dur, off, rate] of BASS) {
        c.wobble(root + off, st, dur, st === 0 ? 0.95 : 0.75, {
          rate: rate * (sec === 'dropC' ? 1.12 : 1),
          depth: 900, drive: 3.6, q: 8,
        });
      }
      c.sub(root, 0, 6, 0.6);
      c.sub(root, 8, 4, 0.5);
    } else if (sec === 'build') {
      c.sub(root, 0, 12, 0.6);
      if (bar >= 12) c.wobble(root, 8, 6, 0.35, { rate: 8, depth: 700 });
    } else if (sec === 'break') {
      c.sub(root, 0, 16, 0.4);
    } else if (sec === 'bridge') {
      c.sub(root, 0, 12, 0.55);
      if (bar >= 76) c.wobble(root, 8, 8, 0.3, { rate: 5.87, depth: 800 });
    }

    // ---------- 和弦 / 刺音 ----------
    if (drop) {
      for (const st of [2, 6, 10, 14]) {
        c.stab(chordNotes, st, 1.6, 0.55, { cut: 3400, cutEnd: 900 });
      }
    }
    if (sec === 'intro') {
      c.pad(chordNotes, 0, 16, 0.35, { attack: 0.8, cut: 1000, release: 1.2 });
    }
    if (sec === 'break') {
      c.choir(chordNotes.map(x => x + 12), 0, 16, 0.3, { attack: 0.6, release: 1.2, formant: 700 });
    }

    // ---------- 主旋律 ----------
    if (sec === 'dropB' && bar < 60) {
      for (const [b, st, midi, dur] of LEAD) {
        if (b === (bar - 48) % 4) c.lead(midi, st, dur, 0.3, { cut: 3200, cutEnd: 1200, vibrato: 5.8 });
      }
    }
    if (sec === 'dropC' && bar < 88) {
      for (const [b, st, midi, dur] of LEAD) {
        if (b === (bar - 80) % 4) c.lead(midi + 12, st, dur, 0.26, { cut: 3600, cutEnd: 1400, vibrato: 6.2 });
      }
    }
    // 警报式高音短句
    if (drop && bar % 4 === 3) {
      c.bell(95, 14, 1, 0.18);
    }

    // ---------- 过渡 ----------
    if (bar === 8) c.impact(0, 0.5);
    if (bar === 12) c.riser(0, 32, 0.8);
    if (bar === 15) { c.reverse(0, 14, 0.8); c.siren(0, 12, 0.6); }
    if (bar === 16) c.impact(0, 1.0);
    if (bar === 39) c.reverse(0, 14, 0.9);
    if (bar === 40) { c.impact(0, 0.8); c.subdrop(0, 0.6); }
    if (bar === 46) c.riser(0, 32, 0.9);
    if (bar === 47) c.reverse(0, 14, 0.9);
    if (bar === 48) c.impact(0, 1.1);
    if (bar === 70) { c.reverse(0, 14, 0.8); c.siren(0, 16, 0.6); }
    if (bar === 71) c.riser(0, 16, 0.9);
    if (bar === 72) c.impact(0, 0.9);
    if (bar === 78) c.riser(0, 32, 1.0);
    if (bar === 79) c.reverse(0, 14, 1.0);
    if (bar === 80) c.impact(0, 1.2);
    if (bar === 91) c.reverse(0, 14, 0.9);
    if (bar === 92) { c.impact(0, 0.9); c.subdrop(0, 0.7); }
  },
};
