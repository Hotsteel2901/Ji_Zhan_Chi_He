// ============================================================
//  曲目 3 · 氯气黎明 CHLORINE DAWN
//  Atmospheric / Liquid D&B · 168 BPM · D lydian · 104 bars ≈ 2:29
//  配方：清晨铃铛、FM 钢琴、明亮 Pad、轻盈 breakbeat、大七和弦
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
  [80, 96, 'dropC'],
  [96, 104, 'outro'],
];

const ROOTS = [n('D2'), n('B1'), n('G1'), n('A1')];
const CHORDS = [
  chord(n('D3'), CH.maj9),    // D F# A C# E
  chord(n('B2'), CH.min7),    // B D F# A
  chord(n('G2'), CH.maj7),    // G B D F#
  [n('A2'), n('D3'), n('E3'), n('G3')],  // A7sus4
];

// 4 小节铃铛主题
const BELL = [
  [0, 0, 78, 4], [0, 4, 76, 2], [0, 6, 74, 2], [0, 8, 69, 6],
  [1, 0, 71, 4], [1, 4, 74, 2], [1, 6, 78, 2], [1, 8, 76, 6],
  [2, 0, 79, 4], [2, 4, 78, 2], [2, 6, 76, 2], [2, 8, 74, 6],
  [3, 0, 76, 6], [3, 6, 73, 2], [3, 8, 69, 6],
];

// 高八度变奏（drop C）
const BELL_HI = [
  [0, 0, 86, 4], [0, 4, 84, 2], [0, 6, 81, 2], [0, 8, 78, 6],
  [1, 0, 83, 4], [1, 4, 81, 2], [1, 6, 78, 2], [1, 8, 76, 6],
  [2, 0, 88, 4], [2, 4, 84, 2], [2, 6, 81, 2], [2, 8, 79, 6],
  [3, 0, 84, 6], [3, 6, 81, 2], [3, 8, 78, 6],
];

const ARP = [0, 2, 4, 2, 3, 1, 4, 3];

function playBell(c, bar, startBar, notes, vel, octave = 0) {
  const off = (bar - startBar) % 4;
  if ((bar - startBar) < 0) return;
  for (const [b, st, midi, dur] of notes) {
    if (b === off) c.bell(midi + octave, st, dur * 2, vel);
  }
}

export const chlorineDawn = {
  id: 'chlorine-dawn',
  name: '氯气黎明',
  en: 'CHLORINE DAWN',
  bpm: 168,
  bars: 104,
  key: 'D major',
  reverb: 0.42,
  reverbTime: 4.2,
  delayBeats: 1.0,
  desc: 'Atmospheric D&B｜天窗漏下的第一束氯水色晨光，铃铛与钢琴在空池上漂着。',
  sections: SECTIONS,

  onBar(c) {
    const bar = c.bar;
    const sec = c.section;
    const ci = bar % 4;
    const root = ROOTS[ci];
    const chordNotes = CHORDS[ci];
    const drop = sec === 'dropA' || sec === 'dropB' || sec === 'dropC';

    // ---------- 鼓 ----------
    if (sec === 'intro') {
      if (bar >= 3) {
        dnbDrums(c, {
          variant: bar, vel: 0.38, hats: true, hatSkip: [1, 5, 9, 13],
          ghostChance: 0.2, ghosts32: 0.04, shaker: true, rim: true,
        });
      }
    } else if (sec === 'build') {
      dnbDrums(c, {
        variant: bar, vel: 0.58 + (bar - 8) * 0.04, hats: true, shaker: true, rim: true,
        ghostChance: 0.42, ghosts32: 0.2, fill: bar === 15 ? 'long' : null,
      });
    } else if (sec === 'dropA') {
      dnbDrums(c, {
        variant: bar, vel: 0.88, hats: true, shaker: true, rim: bar % 2 === 0,
        ghostChance: 0.5, ghosts32: 0.2, openAt: [6, 14],
        fill: bar % 8 === 7 ? 'long' : null,
      });
    } else if (sec === 'break') {
      dnbDrums(c, {
        halfTime: true, vel: 0.45, hats: true, hatSkip: [1, 3, 5, 7, 9, 11, 13, 15],
        shaker: true, ghostChance: 0.3, rim: true,
      });
    } else if (sec === 'dropB') {
      dnbDrums(c, {
        variant: bar, vel: 0.9, hats: true, shaker: true, rim: true,
        ghostChance: 0.55, ghosts32: 0.24, openAt: [10],
        ride: bar >= 56, fill: bar % 8 === 7 ? 'long' : null,
      });
    } else if (sec === 'bridge') {
      dnbDrums(c, {
        variant: bar, vel: 0.5, hats: true, hatSkip: [2, 6, 10, 14],
        ghostChance: 0.25, ghosts32: 0.08, rim: true,
      });
      heartbeat(c, 0.35, [0]);
    } else if (sec === 'dropC') {
      dnbDrums(c, {
        variant: bar, vel: 0.96, hats: true, shaker: true,
        ghostChance: 0.62, ghosts32: 0.3, ride: true,
        openAt: [6, 14], fill: bar % 8 === 7 ? 'long' : null,
      });
    } else if (sec === 'outro') {
      if (bar < 100) {
        dnbDrums(c, {
          halfTime: true, vel: 0.35, hats: true, shaker: true,
          ghostChance: 0.2, rim: true,
        });
      }
    }

    // ---------- 低音 ----------
    if (drop) {
      c.sub(root, 0, 11, 0.85);
      c.sub(root, 12, 3, 0.6);
      c.sub(root + 7, 14, 2, 0.42);
      c.reese(root + 12, 0, 6, 0.22 + c.energy * 0.05, { f0: 700, f1: 260, drive: 1.8, q: 4 });
    } else if (sec === 'break' || sec === 'outro') {
      c.sub(root, 0, 15, 0.42);
    } else if (sec !== 'intro') {
      c.sub(root, 0, 12, 0.55);
    }

    // ---------- 和声 ----------
    const padVel = drop ? 0.75 : 0.62;
    c.pad(chordNotes, 0, 16, padVel, {
      attack: sec === 'intro' ? 1.2 : 0.7,
      release: 1.6,
      cut: sec === 'break' ? 900 : drop ? 2400 : 1600,
      sweep: sec === 'intro' ? 2400 : 0,
    });
    if (sec === 'break' || sec === 'bridge' || sec === 'outro') {
      c.choir(chordNotes.map(x => x + 12), 0, 16, 0.35, {
        attack: 0.9, release: 1.6, formant: 900, cut: 2400,
      });
    }

    // ---------- 铃铛主题 ----------
    if (sec === 'intro' || sec === 'build') playBell(c, bar, 0, BELL, 0.36);
    if (sec === 'dropA') playBell(c, bar, 16, BELL, 0.5);
    if (sec === 'break') playBell(c, bar, 40, BELL, 0.46);
    if (sec === 'dropB') { playBell(c, bar, 48, BELL, 0.56); playBell(c, bar, 48, BELL, 0.2, 12); }
    if (sec === 'bridge') playBell(c, bar, 72, BELL, 0.44);
    if (sec === 'dropC') { playBell(c, bar, 80, BELL_HI, 0.5); playBell(c, bar, 80, BELL, 0.18); }
    if (sec === 'outro') playBell(c, bar, 96, BELL, 0.32);

    // ---------- 钢琴 / 琶音 ----------
    if (sec === 'intro' || sec === 'break' || sec === 'bridge') {
      for (const st of [0, 4, 8, 12]) {
        const note = chordNotes[(st / 4 + ci) % chordNotes.length] + 12;
        c.piano(note, st, 4, 0.32);
      }
    }
    if (drop && (c.energy > 0.3 || sec === 'dropC')) {
      for (let i = 0; i < 8; i++) {
        const note = chordNotes[ARP[i] % chordNotes.length] + 12;
        c.pluck(note, i * 2, 1, 0.2 + (i % 2 === 0 ? 0.06 : 0));
      }
    }

    // ---------- 过渡 ----------
    if (bar === 2) c.crackle(7, 0.7);
    if (bar === 8) c.impact(0, 0.4);
    if (bar === 12) c.riser(0, 32, 0.7);
    if (bar === 15) c.reverse(0, 14, 0.7);
    if (bar === 16) c.impact(0, 0.8);
    if (bar === 39) c.reverse(0, 14, 0.7);
    if (bar === 40) c.subdrop(0, 0.35);
    if (bar === 46) c.riser(0, 32, 0.8);
    if (bar === 47) c.reverse(0, 14, 0.8);
    if (bar === 48) c.impact(0, 0.9);
    if (bar === 71) { c.reverse(0, 14, 0.7); c.riser(8, 16, 0.6); }
    if (bar === 72) c.subdrop(0, 0.4);
    if (bar === 78) c.riser(0, 32, 0.95);
    if (bar === 79) c.reverse(0, 14, 0.9);
    if (bar === 80) c.impact(0, 1.0);
    if (bar === 94) c.riser(0, 32, 0.6);
    if (bar === 95) c.reverse(0, 14, 0.8);
    if (bar === 96) c.impact(0, 0.7);
  },
};
