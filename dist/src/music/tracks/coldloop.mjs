// ============================================================
//  曲目 1 · 冷水循环 COLD LOOP
//  Liquid Drum & Bass · 174 BPM · A minor · 104 bars ≈ 2:23
//  配方：温暖钢琴动机、亚麻音色 Pad、滚动 breakbeat、Reese 低音、铃铛对句
// ============================================================
import { n, chord, CH } from '../theory.mjs';
import { dnbDrums } from '../patterns.mjs';

const SECTIONS = [
  [0, 8, 'intro'],
  [8, 16, 'build'],
  [16, 48, 'dropA'],
  [48, 56, 'break'],
  [56, 88, 'dropB'],
  [88, 96, 'bridge'],
  [96, 104, 'outro'],
];

const ROOTS = [n('A1'), n('F1'), n('C2'), n('G1')];
const CHORDS = [
  chord(n('A3'), CH.min9),   // A C E G B
  chord(n('F3'), CH.maj9),   // F A C E G
  chord(n('C4'), CH.maj9),   // C E G B D
  chord(n('G3'), CH.add9),   // G B D A
];

// 8 小节钢琴主题：[小节偏移, 16分步, MIDI, 时值(16分)]
const MEL = [
  [0, 0, 69, 6], [0, 6, 72, 2], [0, 8, 76, 8],
  [1, 0, 74, 4], [1, 4, 72, 4], [1, 8, 69, 8],
  [2, 0, 65, 6], [2, 6, 69, 2], [2, 8, 72, 8],
  [3, 0, 76, 4], [3, 4, 74, 4], [3, 8, 72, 8],
  [4, 0, 67, 6], [4, 6, 71, 2], [4, 8, 74, 8],
  [5, 0, 76, 4], [5, 4, 74, 4], [5, 8, 71, 8],
  [6, 0, 69, 8], [6, 8, 72, 8],
  [7, 0, 71, 4], [7, 4, 74, 4], [7, 8, 67, 8],
];

// 高音对句（drop B）
const COUNTER = [
  [0, 2, 88, 4], [0, 8, 86, 4], [0, 12, 84, 4],
  [1, 2, 83, 4], [1, 8, 84, 6],
  [2, 4, 84, 4], [2, 10, 79, 6],
  [3, 2, 83, 4], [3, 8, 86, 6],
];

const ARP_ORDER = [0, 2, 4, 3, 1, 3, 4, 2];

function inDrop(c) {
  return c.section === 'dropA' || c.section === 'dropB';
}

export const coldLoop = {
  id: 'cold-loop',
  name: '冷水循环',
  en: 'COLD LOOP',
  bpm: 174,
  bars: 104,
  key: 'A minor',
  reverb: 0.34,
  reverbTime: 3.4,
  delayBeats: 0.75,
  desc: '液 Drum & Bass｜温暖的钢琴动机在空旷的池厅里回响，Reese 低音推着水流向前。',
  sections: SECTIONS,

  onBar(c) {
    const bar = c.bar;
    const sec = c.section;
    const ci = Math.floor(bar / 2) % 4;
    const chordNotes = CHORDS[ci];
    const root = ROOTS[ci];
    const drop = inDrop(c);
    const intensity = c.energy;

    // ---------- 鼓 ----------
    if (sec === 'intro') {
      if (bar >= 4) {
        dnbDrums(c, {
          variant: bar, vel: 0.42, hats: true, hatSkip: [1, 5, 9, 13],
          ghostChance: 0.25, ghosts32: 0.05, kickOpts: { gain: 0.8 },
        });
      }
    } else if (sec === 'build') {
      dnbDrums(c, {
        variant: bar, vel: 0.62 + (bar - 8) * 0.045, hats: true,
        ghostChance: 0.5, ghosts32: 0.25, fill: bar === 15 ? 'long' : null,
      });
    } else if (sec === 'dropA') {
      dnbDrums(c, {
        variant: bar, vel: 0.96, hats: true, shaker: true,
        ghostChance: 0.62, ghosts32: 0.28, fill: bar % 8 === 7 ? 'long' : null,
        openAt: [6, 14],
      });
    } else if (sec === 'break') {
      dnbDrums(c, {
        halfTime: true, vel: 0.50, hats: false, shaker: true,
        ghostChance: 0.4, rim: true,
      });
    } else if (sec === 'dropB') {
      dnbDrums(c, {
        variant: bar, vel: 0.98, hats: true, shaker: true, ride: bar >= 64,
        ghostChance: 0.68, ghosts32: 0.34, fill: bar % 8 === 7 ? 'long' : null,
        openAt: [6, 14],
      });
    } else if (sec === 'bridge') {
      dnbDrums(c, {
        variant: bar, vel: 0.55, hats: true, hatSkip: [3, 7, 11, 15],
        ghostChance: 0.3, ghosts32: 0.1, rim: true,
      });
    } else if (sec === 'outro') {
      if (bar < 100) dnbDrums(c, { halfTime: true, vel: 0.40, hats: true, shaker: true, ghostChance: 0.25 });
    }

    // ---------- 低音 ----------
    if (sec !== 'intro' && sec !== 'break' && sec !== 'outro') {
      c.sub(root, 0, 10, 0.92);
      c.sub(root, 10, 3, 0.72);
      c.sub(root + 7, 14, 2, 0.5);
      if (drop || sec === 'build') {
        c.reese(root + 12, 0, 5, 0.32 + intensity * 0.08, { f0: 920, f1: 260, drive: 2.1 });
        c.reese(root + 12, 8, 4, 0.28, { f0: 760, f1: 210, drive: 2.0 });
      }
    } else if (sec === 'break' || sec === 'outro') {
      c.sub(root, 0, 14, 0.52);
    }

    // ---------- 和声 ----------
    const padCut = drop ? 2100 : sec === 'break' ? 1100 : 1500;
    c.pad(chordNotes, 0, 30, drop ? 0.72 : 0.6, {
      attack: 0.7, release: 1.5, cut: padCut,
      sweep: sec === 'intro' ? padCut + 700 : 0,
    });
    if (sec === 'break' || sec === 'bridge' || sec === 'outro') {
      c.choir(chordNotes.map(x => x + 12), 0, 28, 0.45, { attack: 0.8, release: 1.6, formant: 760 });
    }

    // ---------- 钢琴主题 ----------
    const melVel = sec === 'intro' ? 0.34 : sec === 'build' ? 0.45 : sec === 'outro' ? 0.38 : 0.58;
    if (sec !== 'outro' || bar < 100) {
      for (const [b, st, midi, dur] of MEL) {
        if (b !== bar % 8) continue;
        if (sec === 'intro' && bar < 2 && st > 4) continue;
        c.piano(midi, st, dur, melVel);
      }
    } else {
      // 尾声：主题最后一句自行解决到 A
      if (bar === 100) { c.piano(76, 0, 8, 0.4); c.piano(72, 8, 8, 0.36); }
      if (bar === 101) { c.piano(69, 0, 16, 0.38); }
    }

    // ---------- 对句 / 琶音 ----------
    if (sec === 'dropB') {
      for (const [b, st, midi, dur] of COUNTER) {
        if (b === (bar - 56) % 4) c.bell(midi, st, dur * 2, 0.32);
      }
      // 16 分琶音
      for (let i = 0; i < 8; i++) {
        const st = i * 2;
        const note = chordNotes[ARP_ORDER[i] % chordNotes.length] + 12;
        c.pluck(note, st, 1, 0.26 + (i % 4 === 0 ? 0.08 : 0));
      }
    }
    if (sec === 'dropA' && (bar - 16) >= 16) {
      for (let i = 0; i < 4; i++) {
        c.pluck(chordNotes[(i + ci) % chordNotes.length] + 12, i * 4, 2, 0.18);
      }
    }

    // ---------- 过渡 ----------
    if (bar === 4) c.crackle(3, 0.8);
    if (bar === 6) c.crackle(7, 0.6);
    if (bar === 9) c.impact(0, 0.5);
    if (bar === 12) c.riser(0, 32, 0.8);
    if (bar === 15) c.reverse(0, 14, 0.9);
    if (bar === 16) c.impact(0, 1.0);
    if (bar === 47) c.reverse(0, 14, 0.8);
    if (bar === 48) c.subdrop(0, 0.6);
    if (bar === 54) c.riser(0, 32, 0.95);
    if (bar === 55) c.reverse(0, 14, 1.0);
    if (bar === 56) c.impact(0, 1.1);
    if (bar === 87) { c.riser(8, 16, 0.7); c.reverse(0, 14, 0.7); }
    if (bar === 88) c.subdrop(0, 0.55);
    if (bar === 94) c.riser(0, 32, 0.9);
    if (bar === 95) c.reverse(0, 14, 0.9);
    if (bar === 96) c.impact(0, 0.8);

    // 战斗中：镲片/碎片感高频层
    if (drop && intensity > 0.55 && bar % 2 === 0) {
      c.crackle(5, 0.4 + intensity * 0.3);
    }
  },
};
