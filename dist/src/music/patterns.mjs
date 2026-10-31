// ============================================================
//  D&B 节奏型 / 鼓组模板
// ============================================================

const VARIANTS = [
  { k: [0, 10], s: [4, 12], g: [7, 15] },
  { k: [0, 7, 10], s: [4, 12], g: [3, 6, 15] },
  { k: [0, 3, 10], s: [4, 12, 14], g: [7, 11] },
  { k: [0, 6, 11], s: [4, 12], g: [2, 7, 15] },
  { k: [0, 8, 11], s: [4, 12], g: [6, 14] },
];

/**
 * 标准 D&B 两小节鼓组（16 分音符栅格）
 * o: { variant, vel, halfTime, hats, openAt, hatSkip, ghostChance, ghosts32,
 *       shaker, ride, rim, fill, kickOpts, snareOpts, ghostOpts }
 */
export function dnbDrums(c, o = {}) {
  const half = !!o.halfTime;
  const p = half ? { k: [0], s: [8], g: [6, 14] } : VARIANTS[Math.abs(o.variant ?? c.bar) % VARIANTS.length];
  const vel = o.vel ?? 1;

  for (const s of p.k) c.kick(s, vel * (s === 0 ? 1 : 0.94), o.kickOpts);
  for (const s of p.s) c.snare(s, vel * (o.snareVel ?? 0.95), o.snareOpts);
  for (const s of p.g) {
    if (c.rng() < (o.ghostChance ?? 0.6)) c.ghost(s, vel * (0.4 + c.rng() * 0.28), o.ghostOpts);
  }
  if (!half && c.rng() < (o.ghosts32 ?? 0.22)) c.ghost(14.5, vel * 0.24);

  if (o.hats !== false) {
    const openAt = o.openAt || (half ? [] : [6, 14]);
    const skip = o.hatSkip || [];
    for (let s = 0; s < 16; s++) {
      if (skip.includes(s)) continue;
      const accent = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.62 : 0.34;
      const isOpen = openAt.includes(s);
      c.hat(s, vel * accent * (0.78 + c.rng() * 0.4), isOpen);
    }
    // 32 分重音（只有高能量/段落允许）
    if (!half && (o.flams || c.energy > 0.62)) {
      for (let s = 2; s < 16; s += 4) {
        if (c.rng() < 0.30) c.hat(s + 0.5, vel * 0.20);
      }
    }
  }
  if (o.shaker) {
    for (let s = 1; s < 16; s += 2) c.shaker(s, vel * (0.3 + c.rng() * 0.35));
  }
  if (o.ride) {
    for (let s = 0; s < 16; s += 4) c.ride(s, vel * (s % 8 === 0 ? 0.85 : 0.55));
  }
  if (o.rim) {
    for (const s of [2, 6, 10, 14]) c.rim(s, vel * 0.5);
  }
  if (o.fill) {
    const n = o.fill === 'long' ? 10 : 6;
    for (let i = 0; i < n; i++) {
      c.ghost(16 - n * 0.5 + i * 0.5, vel * (0.22 + i * 0.075));
    }
  }
}

/** 半拍铺底踢鼓（用于 breakdown 的心跳感） */
export function heartbeat(c, vel = 0.7, steps = [0, 8]) {
  for (const s of steps) c.kick(s, vel, { f0: 120, f1: 38, dur: 0.44, click: false });
}
