// ============================================================
//  音乐理论 / 记谱工具
//  —— 让五首曲子用同一套可读的音高、音阶、和弦语言
// ============================================================

export function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** 音名 → MIDI，例如 n('A4') === 69、n('C#5') === 73、n('Bb2') === 46 */
export function n(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name));
  if (!m) throw new Error('bad note: ' + name);
  return (Number(m[3]) + 1) * 12 + PC[(m[1].toUpperCase() + m[2])];
}

/** 取一组音名 */
export function ns(...names) { return names.map(n); }

export const SCALE = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic:   [0, 2, 3, 5, 7, 8, 11],
  pentMin:    [0, 3, 5, 7, 10],
  pentMaj:    [0, 2, 4, 7, 9],
};

/** 音阶级数（可越界，自动跨八度）：deg(57, SCALE.minor, 5) */
export function deg(rootMidi, scale, degree) {
  const s = scale.length;
  const oct = Math.floor(degree / s);
  const idx = ((degree % s) + s) % s;
  return rootMidi + oct * 12 + scale[idx];
}

/** 和弦：根音 + 音程列表。voicing(57, [0,3,7,10]) → [57,60,64,67] */
export function chord(rootMidi, intervals) {
  return intervals.map(i => rootMidi + i);
}

/** 把和弦整体移到目标音域（保证最低音在 lo..hi 之间） */
export function voice(chordNotes, targetRoot) {
  const root = chordNotes[0];
  const shift = Math.round((targetRoot - root) / 12) * 12;
  return chordNotes.map(x => x + shift);
}

export const CH = {
  min:     [0, 3, 7],
  maj:     [0, 4, 7],
  min7:    [0, 3, 7, 10],
  maj7:    [0, 4, 7, 11],
  dom7:    [0, 4, 7, 10],
  min9:    [0, 3, 7, 10, 14],
  maj9:    [0, 4, 7, 11, 14],
  sus2:    [0, 2, 7],
  sus4:    [0, 5, 7],
  add9:    [0, 4, 7, 14],
  min6:    [0, 3, 7, 9],
  maj6:    [0, 4, 7, 9],
  dim:     [0, 3, 6],
  aug:     [0, 4, 8],
};

/** 确定性随机（用于人性化鼓点 / 每次开局不同但内部可复现） */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 段落定位：bars = [ [start, endExclusive, name], ... ] */
export function sectionAt(sections, bar) {
  for (const s of sections) if (bar >= s[0] && bar < s[1]) return s[2];
  return sections[sections.length - 1][2];
}

/** 把 16 分音符序号换成字面量，便于写谱 */
export const S = (x) => x;
