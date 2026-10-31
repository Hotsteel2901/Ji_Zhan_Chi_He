// ============================================================
//  曲目 5 · 回声溺亡 ECHO DROWN
//  Deep / Tribal D&B · 170 BPM · C minor · 104 bars ≈ 2:27
//  配方：半拍重鼓、部落嗵鼓、低音合唱、极深 Sub、水滴与回声
// ============================================================
import { n, chord } from '../theory.mjs';
import { dnbDrums, heartbeat } from '../patterns.mjs';

const SECTIONS = [
  [0, 8, 'intro'],
  [8, 16, 'build'],
  [16, 40, 'dropA'],
  [40, 48, 'break'],
  [48, 72, 'dropB'],
  [72, 80, 'bridge'],
  [80, 96, 'dropC'],
  [96, 104, 'outro'],
];

const ROOTS = [n('C2'), n('Ab1'), n('F1'), n('Bb1')];
const CHORDS = [
  [n('C3'), n('Eb3'), n('G3'), n('D4')],       // Cm add9
  [n('Ab2'), n('C3'), n('Eb3'), n('G3')],      // Abmaj7
  [n('F2'), n('Ab2'), n('C3'), n('Eb3')],      // Fm7
  [n('Bb2'), n('D3'), n('F3'), n('A3')],       // Bb6
];

// 8 小节钟声 / 管风琴主题
const MOTIF = [
  [0, 0, 72, 8], [0, 8, 75, 4], [0, 12, 79, 4],
  [1, 0, 80, 8], [1, 8, 79, 4], [1, 12, 77, 4],
  [2, 0, 75, 8], [2, 8, 72, 8],
  [3, 0, 70, 4], [3, 4, 72, 4], [3, 8, 75, 8],
  [4, 0, 79, 8], [4, 8, 77, 4], [4, 12, 75, 4],
  [5, 0, 72, 8], [5, 8, 70, 8],
  [6, 0, 68, 8], [6, 8, 67, 8],
  [7, 0, 72, 16],
];

function playMotif(c, bar, start, vel, octave = 0) {
  const off = (bar - start) % 8;
  if (bar < start) return;
  for (const [b, st, midi, dur] of MOTIF) {
    if (b === off) c.bell(midi + octave, st, dur * 2, vel);
  }
}

function tribal(c, vel = 0.5) {
  const toms = [[3, 45], [7, 41], [11, 43], [15, 38]];
  for (const [st, midi] of toms) c.tom(st, vel * (0.7 + c.rng() * 0.5), midi);
  c.rim(5, vel * 0.5);
  c.rim(13, vel * 0.4);
}

export const echoDrown = {
  id: 'echo-drown',
  name: '回声溺亡',
  en: 'ECHO DROWN',
  bpm: 170,
  bars: 104,
  key: 'C minor',
  reverb: 0.5,
  reverbTime: 4.8,
  delayBeats: 1.5,
  desc: 'Deep D&B｜水下的合唱与部落鼓点，Sub 低音像深水压着胸口，回声一层层沉下去。',
  sections: SECTIONS,

  onBar(c) {
    const bar = c.bar;
    const sec = c.section;
    const ci = Math.floor(bar / 2) % 4;
    const root = ROOTS[ci];
    const chordNotes = CHORDS[ci];
    const drop = sec === 'dropA' || sec === 'dropB' || sec === 'dropC';

    // ---------- 鼓 ----------
    if (sec === 'intro') {
      if (bar >= 3) {
        dnbDrums(c, {
          halfTime: true, vel: 0.36, hats: true, shaker: true,
          ghostChance: 0.25, rim: true, hatSkip: [1, 3, 5, 7, 9, 11, 13, 15],
        });
        if (bar >= 5) tribal(c, 0.22);
      }
    } else if (sec === 'build') {
      dnbDrums(c, {
        halfTime: bar < 12, variant: bar, vel: 0.5 + (bar - 8) * 0.04,
        hats: true, shaker: true, ghostChance: 0.45, ghosts32: 0.15,
        fill: bar === 15 ? 'long' : null,
      });
      tribal(c, 0.35);
    } else if (sec === 'dropA') {
      dnbDrums(c, {
        halfTime: true, vel: 0.95, hats: true, shaker: true, ride: bar >= 24,
        ghostChance: 0.55, openAt: [6, 14],
      });
      tribal(c, 0.55 + c.energy * 0.15);
    } else if (sec === 'break') {
      heartbeat(c, 0.75, [0, 8]);
      tribal(c, 0.3);
      if (bar >= 44) {
        for (let s = 0; s < 16; s += 2) c.hat(s, 0.12);
      }
    } else if (sec === 'dropB') {
      dnbDrums(c, {
        halfTime: true, vel: 1.0, hats: true, shaker: true, ride: true,
        ghostChance: 0.6, openAt: [6, 10, 14],
      });
      tribal(c, 0.65);
      // 第二层快速踩镲
      if (bar % 2 === 0) {
        for (let s = 1; s < 16; s += 2) c.hat(s + 0.5, 0.12);
      }
    } else if (sec === 'bridge') {
      dnbDrums(c, {
        halfTime: true, vel: 0.42, hats: true, shaker: true,
        ghostChance: 0.3, rim: true,
      });
      tribal(c, 0.3);
      if (bar >= 76) {
        for (let i = 0; i < 16; i++) c.tom(12 + i * 0.25, 0.1 + i * 0.02, 36 + (i % 4));
      }
    } else if (sec === 'dropC') {
      dnbDrums(c, {
        halfTime: bar < 84, variant: bar, vel: 1.0, hats: true, shaker: true,
        ride: true, ghostChance: 0.7, ghosts32: 0.3, openAt: [6, 14],
        fill: bar % 8 === 7 ? 'long' : null,
      });
      tribal(c, 0.7);
    } else if (sec === 'outro') {
      if (bar < 100) {
        heartbeat(c, 0.5, [0, 8]);
        for (let s = 0; s < 16; s += 2) c.hat(s, 0.1);
        tribal(c, 0.2);
      }
    }

    // ---------- 低音 ----------
    if (drop) {
      c.sub(root, 0, 13, 0.9, { glide: bar % 8 === 2 ? -2 : 0 });
      c.sub(root, 13, 3, 0.55);
      if (sec === 'dropB' || sec === 'dropC') {
        c.reese(root + 12, 0, 8, 0.24 + c.energy * 0.06, { f0: 520, f1: 150, drive: 2.0, q: 4 });
      }
      if (sec === 'dropC' && bar % 4 === 3) c.sub(root - 2, 14, 2, 0.4);
    } else if (sec === 'break' || sec === 'outro') {
      c.sub(root, 0, 16, 0.34, { glide: -1 });
    } else if (sec !== 'intro') {
      c.sub(root, 0, 12, 0.5);
    }

    // ---------- 合唱 / 和声 ----------
    const choirVel = sec === 'break' ? 0.8 : drop ? 0.62 : 0.5;
    c.choir(chordNotes.map(x => x + 12), 0, sec === 'break' ? 16 : 15, choirVel, {
      attack: 0.35, release: 1.8, formant: 600, cut: 1700, q: 0.9,
    });
    c.pad(chordNotes, 0, 16, drop ? 0.5 : 0.42, {
      attack: 0.6, release: 2.0, cut: drop ? 900 : 650, q: 0.7,
    });

    // ---------- 主题 ----------
    if (sec === 'intro' || sec === 'build') playMotif(c, bar, 0, 0.3);
    if (sec === 'dropA') playMotif(c, bar, 16, 0.44);
    if (sec === 'break') playMotif(c, bar, 40, 0.5, -12);
    if (sec === 'dropB') { playMotif(c, bar, 48, 0.5); playMotif(c, bar, 48, 0.16, 12); }
    if (sec === 'bridge') playMotif(c, bar, 72, 0.46);
    if (sec === 'dropC') { playMotif(c, bar, 80, 0.54, 12); playMotif(c, bar, 80, 0.2); }
    if (sec === 'outro') playMotif(c, bar, 96, 0.3);

    // ---------- 水滴 / 环境 ----------
    if (bar % 2 === 0 && (sec === 'intro' || sec === 'break' || sec === 'outro')) {
      c.crackle(3 + c.rng() * 8, 0.8);
      c.bell(96 + Math.floor(c.rng() * 6), 6 + c.rng() * 6, 1, 0.1);
    }

    // ---------- 过渡 ----------
    if (bar === 8) c.impact(0, 0.5);
    if (bar === 12) c.riser(0, 32, 0.7);
    if (bar === 15) c.reverse(0, 14, 0.7);
    if (bar === 16) { c.impact(0, 1.0); c.subdrop(0, 0.7); }
    if (bar === 38) c.riser(8, 16, 0.6);
    if (bar === 39) c.reverse(0, 14, 0.8);
    if (bar === 40) { c.impact(0, 0.8); c.subdrop(0, 0.5); }
    if (bar === 46) c.riser(0, 32, 0.85);
    if (bar === 47) c.reverse(0, 14, 0.9);
    if (bar === 48) { c.impact(0, 1.1); c.siren(0, 16, 0.4); }
    if (bar === 70) { c.reverse(0, 14, 0.8); c.riser(8, 16, 0.7); }
    if (bar === 72) { c.impact(0, 0.8); c.subdrop(0, 0.6); }
    if (bar === 78) c.riser(0, 32, 0.9);
    if (bar === 79) c.reverse(0, 14, 0.9);
    if (bar === 80) { c.impact(0, 1.2); c.subdrop(0, 0.8); }
    if (bar === 94) { c.riser(0, 32, 0.7); c.reverse(0, 14, 0.7); }
    if (bar === 96) c.impact(0, 0.8);
  },
};
