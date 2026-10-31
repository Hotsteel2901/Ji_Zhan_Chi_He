// ============================================================
//  房间类型与布局生成
//  - cellType 为纯函数：接缝生成/邻居推断不得依赖完整 plan
//  - 每种房型都保证：地面连通、上层环廊连通、楼梯可达
// ============================================================
import { CELL, H, WALL_T, SLAB_T, FLOOR_H, Y1, Y2, DOOR_W, DOOR_H, WALK_RING } from '../config.mjs';
import { hash2 } from '../util.mjs';

export const IW = H - WALL_T / 2;          // 内壁半宽 6.79
export const SPAWN = { cx: 0, cz: 0 };
export const TOP_SINGLE = Y1;
export const TOP_UPPER = Y2;
export const TOP_TOWER = Y2 + 1.1;

export const UPPER_TYPES = new Set(['pool', 'atrium', 'hall', 'tower']);

/** 3x3 房间为一个街区，按街区分配主题，让建筑有分区感 */
export function district(cx, cz, seed) {
  if (Math.abs(cx) <= 1 && Math.abs(cz) <= 1) return 'public';
  const bx = Math.floor((cx + 2) / 3), bz = Math.floor((cz + 2) / 3);
  const h = hash2(bx, bz, 77, seed);
  if (h < 0.30) return 'aqua';
  if (h < 0.58) return 'public';
  if (h < 0.80) return 'service';
  return 'roof';
}

const THEMES = {
  aqua:    [['pool', 0.34], ['lane', 0.17], ['spa', 0.13], ['slide', 0.12], ['atrium', 0.12], ['hall', 0.12]],
  public:  [['lobby', 0.20], ['hall', 0.20], ['atrium', 0.17], ['pool', 0.15], ['garden', 0.12], ['sauna', 0.09], ['spa', 0.07]],
  service: [['locker', 0.26], ['pump', 0.22], ['sauna', 0.13], ['filter', 0.16], ['spa', 0.10], ['hall', 0.13]],
  roof:    [['sky', 0.30], ['tower', 0.20], ['pool', 0.14], ['garden', 0.11], ['atrium', 0.15], ['hall', 0.10]],
};

export function cellType(cx, cz, seed) {
  if (cx === 0 && cz === 0) return 'lobby';
  if (cx === 1 && cz === 0) return 'pool';
  if (cx === -1 && cz === 0) return 'atrium';
  if (cx === 0 && cz === 1) return 'hall';
  if (cx === 0 && cz === 2) return 'locker';
  if (cx === 1 && cz === 1) return 'spa';
  if (cx === -1 && cz === -1) return 'pump';
  const table = THEMES[district(cx, cz, seed)] || THEMES.public;
  const h = hash2(cx, cz, 1, seed);
  let acc = 0;
  for (const [t, wgt] of table) {
    acc += wgt;
    if (h < acc) return t;
  }
  return table[table.length - 1][0];
}

export function hasUpper(type) { return UPPER_TYPES.has(type); }
export function topOf(type) {
  if (type === 'tower') return TOP_TOWER;
  if (hasUpper(type)) return TOP_UPPER;
  return TOP_SINGLE;
}
export function levelsOf(type) {
  if (type === 'tower') return [Y1, Y2];
  if (hasUpper(type)) return [Y1];
  return [];
}

// ------------------------------------------------------------
// 结构原语
// ------------------------------------------------------------
/** 上层环廊（可挖洞）。ring 顶面 = levelY */
export function ringDeck(b, levelY, holes = [], o = {}) {
  const w = o.width || WALK_RING;
  const th = SLAB_T;
  const yb = levelY - th;
  const strips = [
    { x0: -IW, z0: -IW, x1: IW, z1: -IW + w },
    { x0: -IW, z0: IW - w, x1: IW, z1: IW },
    { x0: -IW, z0: -IW + w, x1: -IW + w, z1: IW - w },
    { x0: IW - w, z0: -IW + w, x1: IW, z1: IW - w },
  ];
  for (const s of strips) carveBox(b, s, holes, yb, levelY, { bucket: o.bucket || 'tile', collide: true, tag: 'floor' });
}
/** 天花板/楼板（可挖洞），底面 = yBottom；默认带一圈发光灯槽 */
export function ceilingSlab(b, yBottom, holes = [], o = {}) {
  const th = o.th || SLAB_T;
  carveBox(b, { x0: -IW, z0: -IW, x1: IW, z1: IW }, holes, yBottom, yBottom + th, { bucket: o.bucket || 'tile', collide: o.collide !== false, tag: 'ceil' });
  if (o.cove === false) return;
  const cy = yBottom - 0.06;
  const inset = 1.0, strip = 0.22;
  const lis = [-IW + inset, IW - inset];
  for (const x of lis) {
    b.boxMM('panelCool', x - strip / 2, cy, -IW + inset, x + strip / 2, cy + 0.05, IW - inset, {});
  }
  for (const z of lis) {
    b.boxMM('panelCool', -IW + inset, cy, z - strip / 2, IW - inset, cy + 0.05, z + strip / 2, {});
  }
  // 灯槽照明（中央 + 四角，覆盖环廊）
  b.lamp(0, yBottom - 0.5, 0, 0xcfeeff, 6.5, 16, { kind: 'cool' });
  for (const [lx, lz] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
    b.lamp(lx, yBottom - 0.45, lz, 0xbfe6ff, 5.0, 12, { kind: 'cool' });
  }
}
/** 把一个水平矩形按若干洞口拆成盒体 */
export function carveBox(b, rect, holes, y0, y1, o = {}) {
  const parts = [[rect.x0, rect.z0, rect.x1, rect.z1]];
  const out = [];
  for (const part of parts) {
    let pieces = [part];
    for (const hole of holes) {
      const next = [];
      for (const p of pieces) {
        const [x0, z0, x1, z1] = p;
        const hx0 = Math.max(x0, hole.x0), hx1 = Math.min(x1, hole.x1);
        const hz0 = Math.max(z0, hole.z0), hz1 = Math.min(z1, hole.z1);
        if (hx0 >= hx1 || hz0 >= hz1) { next.push(p); continue; }
        if (hz0 > z0) next.push([x0, z0, x1, hz0]);
        if (hz1 < z1) next.push([x0, hz1, x1, z1]);
        if (hx0 > x0) next.push([x0, hz0, hx0, hz1]);
        if (hx1 < x1) next.push([hx1, hz0, x1, hz1]);
      }
      pieces = next;
    }
    out.push(...pieces);
  }
  for (const p of out) b.boxMM(o.bucket || 'tile', p[0], y0, p[1], p[2], y1, p[3], o);
  return out;
}

/** 折返楼梯：y0 → y1，贴 side 墙。占位宽 2.35，两跑并排 + 端部平台
 *  返回 { hole } —— 上层环廊需要挖掉的楼梯井矩形（B 跑上方） */
export function switchback(b, side, y0, y1, seedBias = 0) {
  const w = 2.35, laneW = w / 2;
  const run = 4.7, landing = 1.8;
  const mid = (y0 + y1) / 2;
  const alongZ = side === 'W' || side === 'E';
  const start = -IW + 1.0 + seedBias * 0.5;   // 沿墙起点（s 轴）
  const end = start + run;

  // s → 世界轴坐标（W/N 正映射，E/S 负映射）
  const sToU = (s) => (side === 'W' || side === 'N') ? s : -s;
  // 横向 t（0=墙）→ 世界坐标
  const lane = (t) => {
    if (side === 'W') return { axis: 'x', from: -IW + t, to: -IW + t };
    if (side === 'E') return { axis: 'x', from: IW - t, to: IW - t };
    if (side === 'N') return { axis: 'z', from: -IW + t, to: -IW + t };
    return { axis: 'z', from: IW - t, to: IW - t };
  };
  const rectFor = (sA, sB, tA, tB) => {
    const uA = sToU(sA), uB = sToU(sB);
    if (alongZ) {
      const xA = lane(tA).from, xB = lane(tB).from;
      return { x0: Math.min(xA, xB), x1: Math.max(xA, xB), z0: Math.min(uA, uB), z1: Math.max(uA, uB) };
    }
    const zA = lane(tA).from, zB = lane(tB).from;
    return { x0: Math.min(uA, uB), x1: Math.max(uA, uB), z0: Math.min(zA, zB), z1: Math.max(zA, zB) };
  };
  const yAt = (yA, uA, yB, uB) => (uA <= uB ? [yA, yB] : [yB, yA]);
  const axis = alongZ ? 'z' : 'x';

  const buildRun = (sA, sB, tA, tB, yA, yB) => {
    const r = rectFor(sA, sB, tA, tB);
    const uA = sToU(sA), uB = sToU(sB);
    const [ymin, ymax] = yAt(yA, uA, yB, uB);
    b.stairs(r.x0, r.z0, r.x1, r.z1, axis, ymin, ymax, { skirt: false });
    return { r, uA, uB, yA, yB };
  };

  // A 跑：s: start→end，lane 0..laneW，y0→mid
  buildRun(start, end, 0, laneW, y0, mid);
  // B 跑：s: end→start，lane laneW..w，mid→y1
  buildRun(end, start, laneW, w, mid, y1);
  // 中间平台（全宽，end..end+landing）
  const lr = rectFor(end, end + landing, 0, w);
  b.boxMM('tile', lr.x0, mid - SLAB_T, lr.z0, lr.x1, mid, lr.z1, { collide: true, tag: 'floor' });
  // 平台外沿矮墙
  const lrEnd = rectFor(end + landing - 0.08, end + landing, 0, w);
  b.boxMM('trim', lrEnd.x0, mid, lrEnd.z0, lrEnd.x1, mid + 0.9, lrEnd.z1, { collide: true, tag: 'trim' });

  // 扶手：两跑之间的分隔扶手 + 外侧临空扶手
  const dividerPos = (t, s) => {
    // 返回世界坐标 (x,z)
    const u = sToU(s);
    if (alongZ) return { x: lane(t).from, z: u };
    return { x: u, z: lane(t).from };
  };
  const railAlong = (t, sA, sB, yA, yB) => {
    const p0 = dividerPos(t, sA), p1 = dividerPos(t, sB);
    b.slopedRail(p0.x, yA, p0.z, p1.x, yB, p1.z);
  };
  railAlong(laneW, start, end, y0, mid);
  railAlong(laneW, end, start, mid, y1);
  railAlong(w, start, end, y0, mid);
  railAlong(w, end, start, mid, y1);
  // 平台外侧与端部平台扶手
  const lrRailA = dividerPos(w, end), lrRailB = dividerPos(w, end + landing);
  b.rail(lrRailA.x, lrRailA.z, lrRailB.x, lrRailB.z, mid, { h: 1.0, collide: false });

  // B 跑上方楼梯井
  const hole = rectFor(start - 0.1, end + 0.1, laneW - 0.05, w + 0.05);
  return { hole, side, mid, end };
}

/** 池体：矩形水池 + 滩涂入口 + 池壁碰撞 + 水体体积 */
export function buildPool(b, o) {
  const { x0, z0, x1, z1, deep, shallow } = o;
  const wallTag = o.tag || 'pool';
  // 池底
  b.boxMM('pool', x0, deep - 0.3, z0, x1, deep, z1, { collide: true, tag: 'pool' });
  // 池壁（四面，从池底到池沿 0）
  const t = 0.34;
  b.boxMM('pool', x0 - t, deep - 0.3, z0 - t, x0, 0.05, z1 + t, { collide: true, tag: wallTag });
  b.boxMM('pool', x1, deep - 0.3, z0 - t, x1 + t, 0.05, z1 + t, { collide: true, tag: wallTag });
  b.boxMM('pool', x0, deep - 0.3, z0 - t, x1, 0.05, z0, { collide: true, tag: wallTag });
  b.boxMM('pool', x0, deep - 0.3, z1, x1, 0.05, z1 + t, { collide: true, tag: wallTag });
  // 浅台
  if (shallow) {
    const s = shallow;
    b.boxMM('pool', s.x0, deep, s.z0, s.x1, deep + 0.12, s.z1, { collide: true, tag: 'pool' });
    b.boxMM('pool', s.x0 - 0.05, deep, s.z0 - 0.05, s.x1 + 0.05, deep + 0.12, s.z1 + 0.05, {});
  }
  // 滩涂坡道（从池沿下到浅台）
  if (o.beach) {
    const { x0: bx0, z0: bz0, x1: bx1, z1: bz1, axis, highY, lowY } = o.beach;
    b.stairs(bx0, bz0, bx1, bz1, axis, lowY, highY, { uv: 1 / 2.0 });
  }
  // 池沿压边
  const cop = 0.34, copH = 0.09;
  const cw = 1 / 2.2;
  b.boxMM('tile', x0 - cop, 0.0, z0 - cop, x1 + cop, copH, z0, { uv: cw });
  b.boxMM('tile', x0 - cop, 0.0, z1, x1 + cop, copH, z1 + cop, { uv: cw });
  b.boxMM('tile', x0 - cop, 0.0, z0, x0, copH, z1, { uv: cw });
  b.boxMM('tile', x1, 0.0, z0, x1 + cop, copH, z1, { uv: cw });
  // 水体
  b.water(x0, z0, x1, z1, -0.4, deep, o.kind || 'pool');
  // 池底焦散贴片
  b.emitter('caustic', { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: deep + 0.04, w: x1 - x0, d: z1 - z0 });
  // 排水口
  b.cyl('dark', 0.22, 0.22, 0.03, 10, (x0 + x1) / 2, deep + 0.02, (z0 + z1) / 2, {});
  // 池底灯
  const lx = (x0 + x1) / 2;
  for (const side of [-1, 1]) {
    b.box('panelCyan', 0.9, 0.26, 0.08, lx + side * (x1 - x0) * 0.28, deep + 0.55, z0 + 0.04, {});
    b.box('panelCyan', 0.9, 0.26, 0.08, lx + side * (x1 - x0) * 0.28, deep + 0.55, z1 - 0.04, {});
  }
  b.lamp(lx, deep + 0.6, (z0 + z1) / 2, 0x6fd8ff, 9, 12, { kind: 'pool' });
  // 泳池扶梯
  const lad = (lxx, lzz, ry) => {
    const g = { ry };
    for (const off of [-0.24, 0.24]) {
      b.cyl('metal', 0.035, 0.035, 1.15, 8, lxx + (g.ry ? 0 : off), 0.15, lzz + (g.ry ? off : 0), {});
    }
    for (let i = 0; i < 3; i++) {
      const r = b.cyl('metal', 0.024, 0.024, 0.5, 6, lxx, 0.06 + i * 0.4, lzz, { rz: g.ry ? 0 : Math.PI / 2, rx: g.ry ? Math.PI / 2 : 0 });
    }
    // 池内台阶
    for (let i = 0; i < 3; i++) {
      b.box('pool', 0.62, 0.14, 0.42, lxx, deep + 0.35 + i * 0.45, lzz, {});
    }
  };
  lad(x0 + 0.5, z0 + 0.5, true);
  lad(x1 - 0.5, z1 - 0.5, false);
}

/** 墙面细节：踢脚线 + 腰线 */
export function wallTrims(b, holesSides) {
  const bh = 0.14, bt = 0.07;
  const y = 0;
  // 踢脚线（四面，减去门洞大致位置：门两侧各 0.15）
  const sideDefs = [
    { x0: -IW, z: -IW + bt / 2, x1: IW, zz: true },
    { x0: -IW, z: IW - bt / 2, x1: IW, zz: true },
    { z0: -IW, x: -IW + bt / 2, z1: IW, zz: false },
    { z0: -IW, x: IW - bt / 2, z1: IW, zz: false },
  ];
  const doors = holesSides || {};
  for (let i = 0; i < 4; i++) {
    const sd = sideDefs[i];
    const dir = ['N', 'S', 'W', 'E'][i];
    const segs = subtractDoor(dir, doors[dir]);
    for (const [a, c] of segs) {
      if (sd.zz) b.boxMM('trim', a, y, sd.z - bt / 2, c, y + bh, sd.z + bt / 2, {});
      else b.boxMM('trim', sd.x - bt / 2, y, a, sd.x + bt / 2, y + bh, c, {});
    }
  }
}
function subtractDoor(dir, door) {
  const full = [-IW, IW];
  if (door === undefined || door === null) return [full];
  const half = DOOR_W / 2 + 0.12;
  const at = typeof door === 'number' ? door : (door.at || 0);
  const a = Math.max(-IW, at - half), c = Math.min(IW, at + half);
  const out = [];
  if (a > -IW + 0.02) out.push([-IW, a]);
  if (c < IW - 0.02) out.push([c, IW]);
  return out.length ? out : [full];
}

/** 吊顶灯具 */
export function ceilingFixture(b, x, z, y, o = {}) {
  const kind = o.kind || 'warm';
  const size = o.size || 2.2;
  b.box('metal', size + 0.16, 0.08, size + 0.16, x, y - 0.05, z, {});
  const panel = kind === 'warm' ? 'panelWarm' : kind === 'cyan' ? 'panelCyan' : kind === 'amber' ? 'panelAmber' : kind === 'red' ? 'panelRed' : 'panelCool';
  b.box(panel, size, 0.05, size, x, y - 0.12, z, {});
  const color = kind === 'warm' ? 0xffe2b8 : kind === 'cyan' ? 0x7fe4ff : kind === 'amber' ? 0xffc46a : kind === 'red' ? 0xff5a4a : 0xd8f2ff;
  b.lamp(x, y - 0.4, z, color, o.intensity || 7, o.distance || 13, { flicker: o.flicker || 0, kind });
}

/** 壁灯 */
export function wallLamp(b, x, y, z, o = {}) {
  b.box('metal', o.w || 0.5, 0.24, 0.2, x, y, z, {});
  b.box(o.kind === 'amber' ? 'panelAmber' : 'panelWarm', (o.w || 0.5) * 0.82, 0.16, 0.08, x, y, z + (o.dir || 1) * -0.1, {});
  b.lamp(x, y, z, o.color || 0xffe2b8, o.intensity || 5.5, o.distance || 10, { kind: o.kind || 'warm', flicker: o.flicker || 0 });
}

/** 天窗开口 + 光柱 + 地面光斑 */
export function skylight(b, rect, roofYBottom, o = {}) {
  const th = SLAB_T;
  const y0 = roofYBottom, y1 = roofYBottom + th;
  // 洞口边框
  const t = 0.18;
  b.boxMM('trim', rect.x0 - t, y0 - 0.12, rect.z0 - t, rect.x1 + t, y1 + 0.06, rect.z0, {});
  b.boxMM('trim', rect.x0 - t, y0 - 0.12, rect.z1, rect.x1 + t, y1 + 0.06, rect.z1 + t, {});
  b.boxMM('trim', rect.x0 - t, y0 - 0.12, rect.z0, rect.x0, y1 + 0.06, rect.z1, {});
  b.boxMM('trim', rect.x1, y0 - 0.12, rect.z0, rect.x1 + t, y1 + 0.06, rect.z1, {});
  // 玻璃（磨砂质感，避免看起来像“没有顶”的洞）
  b.box('glass', rect.x1 - rect.x0, 0.05, rect.z1 - rect.z0, (rect.x0 + rect.x1) / 2, y1 + 0.16, (rect.z0 + rect.z1) / 2, {});
  // 井字格栅
  const n = Math.max(2, Math.floor((rect.x1 - rect.x0) / 1.1));
  for (let i = 1; i < n; i++) {
    const x = rect.x0 + (rect.x1 - rect.x0) * i / n;
    b.box('metal', 0.07, 0.08, rect.z1 - rect.z0, x, y1 + 0.26, (rect.z0 + rect.z1) / 2, {});
    const z = rect.z0 + (rect.z1 - rect.z0) * i / n;
    b.box('metal', rect.x1 - rect.x0, 0.08, 0.07, (rect.x0 + rect.x1) / 2, y1 + 0.26, z, {});
  }
  // 光柱
  b.emitter('shaft', { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, yTop: y0 + 0.4, w: rect.x1 - rect.x0, d: rect.z1 - rect.z0, target: o.targetY ?? 0 });
  // 地面光斑
  b.emitter('lightpool', { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, y: (o.targetY ?? 0) + 0.02, w: (rect.x1 - rect.x0) * 1.35, d: (rect.z1 - rect.z0) * 1.35 });
  b.lamp((rect.x0 + rect.x1) / 2, y0 - 1.2, (rect.z0 + rect.z1) / 2, o.color || 0xfff2d8, o.intensity || 11, o.distance || (o.targetY ? 22 : 16), { kind: 'skylight' });
}

/** 简单的盆栽（o.y0 = 基座高度） */
export function plant(b, x, z, o = {}) {
  const s = o.scale || 1;
  const y0 = o.y0 || 0;
  b.cyl('dark', 0.42 * s, 0.3 * s, 0.5 * s, 10, x, y0 + 0.25 * s, z, { collide: true, tag: 'trim' });
  b.cyl('dark', 0.34 * s, 0.34 * s, 0.1 * s, 10, x, y0 + 0.52 * s, z, {});
  const g = o.green || 'foliage';
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + (o.seed || 0);
    b.cyl(g, 0.04, 0.07 * s, 1.1 * s, 5, x + Math.cos(a) * 0.18 * s, y0 + 1.1 * s, z + Math.sin(a) * 0.18 * s, { rz: Math.cos(a) * 0.42, rx: -Math.sin(a) * 0.42 });
  }
}

/** 长凳（o.y0 = 基座高度） */
export function bench(b, x, z, len, ry = 0, o = {}) {
  const bucket = o.bucket || 'plastic';
  const y0 = o.y0 || 0;
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => ({ x: x + lx * c - lz * s, z: z + lx * s + lz * c });
  b.box(bucket, len, 0.07, 0.5, x, y0 + 0.46, z, { ry });
  for (const off of [-len / 2 + 0.3, len / 2 - 0.3]) {
    const p = P(off, 0);
    b.box('metal', 0.08, 0.42, 0.42, p.x, y0 + 0.21, p.z, { ry });
  }
  b.collide(x - len / 2, y0, z - 0.3, x + len / 2, y0 + 0.5, z + 0.3, 'trim');
}

// ------------------------------------------------------------
// 各类房间
// ------------------------------------------------------------
export function buildCell(b, type, seed, cx, cz) {
  const rnd = (salt) => hash2(cx, cz, salt, seed);
  b.cell.type = type;

  switch (type) {
    case 'lobby': genLobby(b, rnd); break;
    case 'pool': genPool(b, rnd, seed, cx, cz); break;
    case 'lane': genLane(b, rnd, cx, cz); break;
    case 'atrium': genAtrium(b, rnd, cx, cz); break;
    case 'hall': genHall(b, rnd); break;
    case 'spa': genSpa(b, rnd, cx, cz); break;
    case 'locker': genLocker(b, rnd, cx, cz); break;
    case 'pump': genPump(b, rnd, cx, cz); break;
    case 'sky': genSky(b, rnd, cx, cz); break;
    case 'tower': genTower(b, rnd, seed, cx, cz); break;
    case 'sauna': genSauna(b, rnd, cx, cz); break;
    case 'slide': genSlide(b, rnd, cx, cz); break;
    case 'garden': genGarden(b, rnd, cx, cz); break;
    case 'filter': genFilter(b, rnd, cx, cz); break;
    default: genLobby(b, rnd); break;
  }

  // 通用：墙脚线（避开各侧门洞）
  wallTrims(b, b.cell.doorAt);
  b.cell.shardSpots = shardSpotsFor(cx, cz, type);
}

/** 基础楼板（可挖水池洞），洞用局部坐标矩形 */
function baseFloor(b, holes = [], o = {}) {
  carveBox(b, { x0: -IW, z0: -IW, x1: IW, z1: IW }, holes, -0.42, 0, { bucket: o.bucket || 'tile', collide: true, tag: 'floor', uv: o.uv });
}
/** 池洞矩形（含池壁厚） */
export function poolHole(x0, z0, x1, z1) {
  const t = 0.3;
  return { x0: Math.min(x0, x1) - t, z0: Math.min(z0, z1) - t, x1: Math.max(x0, x1) + t, z1: Math.max(z0, z1) + t };
}

function genLobby(b, rnd) {
  baseFloor(b);
  // 接待台
  b.box('tile', 4.8, 1.06, 0.72, -3.4, 0.53, -4.6, { collide: true, tag: 'trim' });
  b.box('trim', 5.0, 0.07, 0.84, -3.4, 1.1, -4.6, {});
  b.box('panelCyan', 1.6, 0.1, 0.5, -3.4, 1.14, -4.6, {});
  // 大标牌
  b.sign('title', 4.6, 0.9, 0, 3.5, -IW + 0.34, 0);
  b.box('trim', 4.9, 1.15, 0.1, 0, 3.5, -IW + 0.24, {});
  b.lamp(0, 3.0, -IW + 2, 0xbfe8ff, 4, 9, { kind: 'cool' });
  // 长凳 / 盆栽 / 贩卖机
  bench(b, 4.2, 1.6, 2.4, 0);
  bench(b, 4.2, 4.6, 2.4, 0);
  plant(b, -4.6, 4.2, { scale: 1.2, seed: rnd(7) * 6 });
  plant(b, 4.8, -3.2, { scale: 1.05, seed: rnd(8) * 6 });
  b.box('metal', 1.1, 2.0, 0.8, IW - 0.6, 1.0, 2.2, { collide: true, tag: 'trim' });
  b.box('panelCyan', 0.9, 0.5, 0.05, IW - 0.6, 1.4, 2.2 - 0.42, {});
  b.box('panelAmber', 0.9, 1.0, 0.05, IW - 0.6, 0.7, 2.2 - 0.42, {});
  // 吊顶
  ceilingFixture(b, -2.6, 0, FLOOR_H, { kind: 'cool' });
  ceilingFixture(b, 3.0, -1.6, FLOOR_H, { kind: 'warm' });
  // 地面指引
  b.box('accent', 3.4, 0.02, 0.18, 0, 0.01, 2.0, {});
  ceilingSlab(b, FLOOR_H);
}

function genPool(b, rnd, seed, cx, cz) {
  const ph = 3.9;
  const deep = -2.6;
  baseFloor(b, [poolHole(-ph, -ph, ph, ph)]);
  // 池体
  buildPool(b, {
    x0: -ph, z0: -ph, x1: ph, z1: ph, deep,
    shallow: { x0: 2.1, z0: -ph, x1: ph, z1: ph },
    beach: { x0: 2.1, z0: ph - 2.6, x1: ph, z1: ph, axis: 'x', highY: 0, lowY: -1.15 },
  });
  // 浮圈
  for (const [fx, fz, col] of [[-2.4, -1.2, 'ropeRed'], [1.4, 0.8, 'ropeWhite'], [2.8, -2.2, 'ropeBlue'], [-1.0, 2.4, 'ropeRed']]) {
    b.torus(col, 0.44, 0.12, 20, 8, fx, -0.33, fz, Math.PI / 2);
    b.torus('ropeWhite', 0.30, 0.035, 18, 6, fx, -0.32, fz, Math.PI / 2);
  }
  // 横跨水面的泳道绳
  for (let i = 0; i < 10; i++) {
    b.cyl(i % 2 ? 'ropeRed' : 'ropeWhite', 0.07, 0.07, 0.18, 7, -3.2 + i * 0.7, -0.08, 2.9, { rx: Math.PI / 2 });
  }
  // 救生员高椅
  const chx = -5.3, chz = 4.7;
  b.box('woodDark', 0.95, 0.12, 0.95, chx, 1.36, chz, { collide: true, tag: 'wood' });
  for (const [ox, oz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
    b.cyl('metal', 0.035, 0.045, 1.35, 6, chx + ox, 0.67, chz + oz, {});
  }
  b.box('woodDark', 0.95, 0.78, 0.1, chx, 1.78, chz + 0.48, {});
  b.box('plastic', 0.58, 0.06, 0.58, chx, 1.42, chz, {});
  b.cyl('metal', 0.05, 0.05, 1.9, 6, chx + 0.52, 2.15, chz, {});
  b.cyl('metal', 0.05, 0.05, 1.5, 6, chx + 0.52, 2.95, chz, { rz: Math.PI / 2 });
  b.box('panelRed', 0.35, 0.15, 0.05, chx + 0.52, 3.0, chz - 0.1, {});
  // 上二层
  const side = ['W', 'E', 'N', 'S'][Math.floor(rnd(3) * 4) % 4];
  const st = switchback(b, side, 0, Y1, rnd(4));
  ringDeck(b, Y1, [st.hole]);
  genRingRails(b, Y1);
  upperDressing(b, Y1);
  ceilingSlab(b, Y1 + FLOOR_H, [{ x0: -2.4, z0: -2.4, x1: 2.4, z1: 2.4 }]);
  skylight(b, { x0: -2.4, z0: -2.4, x1: 2.4, z1: 2.4 }, Y1 + FLOOR_H, { targetY: deep });
  // 环廊灯
  for (const [lx, lz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
    ceilingFixture(b, lx, lz, Y1 + FLOOR_H - 0.1, { kind: 'warm', size: 1.4, intensity: 4.5, distance: 10 });
  }
  void seed;
}

function genLane(b, rnd, cx, cz) {
  baseFloor(b, [poolHole(-2.3, -5.6, 2.3, 5.6)]);
  buildPool(b, { x0: -2.3, z0: -5.6, x1: 2.3, z1: 5.6, deep: -2.0, kind: 'pool' });
  // 泳道绳
  for (const lx of [-1.15, 0, 1.15]) {
    b.cyl('metal', 0.012, 0.012, 11.2, 4, lx, -0.1, 0, {});
    for (let i = 0; i < 22; i++) {
      const z = -5.4 + i * 0.5 + (lx + 1.5) * 0.07;
      b.cyl(i % 2 ? 'ropeRed' : 'ropeWhite', 0.075, 0.075, 0.22, 7, lx, -0.1, z, { rx: Math.PI / 2 });
    }
  }
  // 出发台
  for (const lx of [-1.15, 1.15]) {
    b.box('trim', 0.7, 0.5, 0.7, lx, 0.25, -5.2, { collide: true, tag: 'trim' });
    b.box('accent', 0.72, 0.06, 0.72, lx, 0.53, -5.2, {});
  }
  // 跳板
  b.box('plastic', 0.6, 0.08, 2.4, 0, 1.75, 6.0, {});
  b.box('metal', 0.5, 0.9, 0.5, 0, 1.3, 6.4, { collide: true, tag: 'trim' });
  b.cyl('metal', 0.05, 0.05, 1.4, 8, 0, 2.2, 6.4, {});
  // 天花板 + 天窗条
  ceilingSlab(b, FLOOR_H, [{ x0: -1.2, z0: -4.6, x1: 1.2, z1: 4.6 }]);
  skylight(b, { x0: -1.2, z0: -4.6, x1: 1.2, z1: 4.6 }, FLOOR_H, { targetY: 0 });
  for (const [lx, lz] of [[-5.4, -5], [5.4, -5], [-5.4, 5], [5.4, 5]]) {
    ceilingFixture(b, lx, lz, FLOOR_H, { kind: 'warm', size: 1.5, intensity: 5, distance: 11 });
  }
  // 深水牌
  b.sign('deep', 2.4, 0.6, 0, 2.6, IW - 0.14, Math.PI);
  void rnd; void cx; void cz;
}

function genAtrium(b, rnd, cx, cz) {
  baseFloor(b, [poolHole(-3.0, -3.0, 3.0, 3.0)]);
  // 中央浅水池
  buildPool(b, { x0: -3.0, z0: -3.0, x1: 3.0, z1: 3.0, deep: -0.6, kind: 'shallow' });
  // 踏石
  for (const [px, pz] of [[-1.6, 0], [0, 0], [1.6, 0]]) {
    b.box('concrete', 1.05, 0.2, 1.05, px, -0.28, pz, {});
  }
  const side = ['W', 'E', 'N', 'S'][Math.floor(rnd(5) * 4) % 4];
  const st = switchback(b, side, 0, Y1, rnd(6));
  ringDeck(b, Y1, [st.hole]);
  genRingRails(b, Y1);
  upperDressing(b, Y1);
  ceilingSlab(b, Y1 + FLOOR_H, [{ x0: -2.6, z0: -2.6, x1: 2.6, z1: 2.6 }]);
  skylight(b, { x0: -2.6, z0: -2.6, x1: 2.6, z1: 2.6 }, Y1 + FLOOR_H, { targetY: -0.6 });
  plant(b, -5.4, -5.4, { scale: 1.5, seed: rnd(9) * 6 });
  plant(b, 5.4, 5.4, { scale: 1.3, seed: rnd(10) * 6 });
  bench(b, -4.6, 4.6, 2.6, Math.PI / 2);
  bench(b, 4.6, -4.6, 2.6, Math.PI / 2);
  ceilingFixture(b, 0, 0, Y1 + FLOOR_H - 0.1, { kind: 'cool', size: 1.6, intensity: 5, distance: 14 });
  void cx; void cz;
}

function genHall(b, rnd) {
  b.boxMM('concrete', -IW, -0.42, -IW, IW, 0, IW, { collide: true, tag: 'floor' });
  const side = ['W', 'E', 'N', 'S'][Math.floor(rnd(11) * 4) % 4];
  // 柱阵（避开楼梯所贴的墙侧）
  for (const [px, pz] of [[-4.6, -4.6], [4.6, -4.6], [-4.6, 4.6], [4.6, 4.6]]) {
    if (side === 'W' && px < 0) continue;
    if (side === 'E' && px > 0) continue;
    if (side === 'N' && pz < 0) continue;
    if (side === 'S' && pz > 0) continue;
    b.box('tile', 1.0, Y1, 1.0, px, Y1 / 2, pz, { collide: true, tag: 'tile' });
    b.boxMM('trim', px - 0.6, 0, pz - 0.6, px + 0.6, 0.35, pz + 0.6, {});
    b.boxMM('trim', px - 0.6, Y1 - 0.4, pz - 0.6, px + 0.6, Y1 - 0.05, pz + 0.6, {});
  }
  const st = switchback(b, side, 0, Y1, rnd(12));
  ringDeck(b, Y1, [st.hole]);
  genRingRails(b, Y1);
  upperDressing(b, Y1);
  ceilingSlab(b, Y1 + FLOOR_H, [
    { x0: -4.5, z0: -1.5, x1: -1.5, z1: 1.5 },
    { x0: 1.5, z0: -1.5, x1: 4.5, z1: 1.5 },
  ]);
  skylight(b, { x0: -4.5, z0: -1.5, x1: -1.5, z1: 1.5 }, Y1 + FLOOR_H, { targetY: 0, intensity: 9 });
  skylight(b, { x0: 1.5, z0: -1.5, x1: 4.5, z1: 1.5 }, Y1 + FLOOR_H, { targetY: 0, intensity: 9 });
  // 横幅
  b.sign('title', 5.4, 1.2, 0, 3.1, -IW + 0.2, 0);
  b.sign('title', 5.4, 1.2, 0, 3.1, IW - 0.2, Math.PI);
  for (const [lx, lz] of [[-5.6, -5.6], [5.6, 5.6]]) ceilingFixture(b, lx, lz, Y1 + FLOOR_H - 0.1, { kind: 'amber', size: 1.5, intensity: 5, distance: 12 });
}

function genSpa(b, rnd, cx, cz) {
  // 方形温泉池（四角斜切，视觉接近八角）
  const h = 2.85, depth = -0.8;
  baseFloor(b, [poolHole(-h, -h, h, h)]);
  buildPool(b, { x0: -h, z0: -h, x1: h, z1: h, deep: depth, kind: 'tub' });
  // 四角斜切装饰（盖住方形洞角）
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.box('pool', 1.5, 1.0, 1.5, sx * (h + 0.1), -0.5, sz * (h + 0.1), { ry: Math.PI / 4 });
  }
  // 池内环形坐台
  for (const [px, pz, w, d] of [[0, -h + 0.55, h * 2 - 0.4, 0.7], [0, h - 0.55, h * 2 - 0.4, 0.7], [-h + 0.55, 0, 0.7, h * 2 - 1.4], [h - 0.55, 0, 0.7, h * 2 - 1.4]]) {
    b.boxMM('pool', px - w / 2, depth, pz - d / 2, px + w / 2, depth + 0.42, pz + d / 2, { collide: true, tag: 'pool' });
  }
  b.emitter('caustic', { x: 0, z: 0, y: depth + 0.04, w: h * 1.7, d: h * 1.7 });
  b.emitter('steam', { x: 0, y: -0.1, z: 0, r: h * 0.95 });
  b.lamp(0, depth + 0.9, 0, 0xffb87a, 8, 11, { kind: 'warm' });
  // 木质长凳 + 植物
  bench(b, -5.0, 3.4, 2.6, 0, { bucket: 'plastic' });
  bench(b, 5.0, -3.4, 2.6, 0, { bucket: 'plastic' });
  plant(b, 5.4, 5.4, { scale: 1.2, seed: rnd(13) * 6 });
  ceilingSlab(b, FLOOR_H, [{ x0: -1.4, z0: -1.4, x1: 1.4, z1: 1.4 }]);
  skylight(b, { x0: -1.4, z0: -1.4, x1: 1.4, z1: 1.4 }, FLOOR_H, { targetY: -0.8, color: 0xffd8b0, intensity: 7 });
  for (const [lx, lz] of [[-5.2, -5.2], [5.2, 5.2]]) ceilingFixture(b, lx, lz, FLOOR_H, { kind: 'amber', size: 1.4, intensity: 5.5, distance: 11 });
  void cx; void cz;
}

function genLocker(b, rnd, cx, cz) {
  baseFloor(b);
  // 整排储物柜（西墙）
  const cols = 5, w = 0.62, hgt = 2.0;
  for (let i = 0; i < cols; i++) {
    const z = -5 + i * 2.1;
    b.box('metal', 0.5, hgt, 2.0, -IW + 0.25, hgt / 2, z, { collide: true, tag: 'metal' });
    b.box('dark', 0.03, 1.3, 0.9, -IW + 0.51, 1.05, z, {});
    b.box('dark', 0.03, 1.3, 0.9, -IW + 0.51, 1.05, z + 1.0, {});
    b.cyl('metal', 0.028, 0.028, 0.12, 6, -IW + 0.54, 1.05, z + 0.28, { rz: Math.PI / 2 });
    b.cyl('metal', 0.028, 0.028, 0.12, 6, -IW + 0.54, 1.05, z + 0.72, { rz: Math.PI / 2 });
  }
  // 淋浴间（东墙）
  for (let i = 0; i < 3; i++) {
    const z = -3.6 + i * 3.0;
    b.boxMM('tile', IW - 1.9, 0, z - 1.4, IW, 2.3, z - 1.32, { collide: true, tag: 'tile' });
    b.boxMM('tile', IW - 1.9, 0, z + 1.32, IW, 2.3, z + 1.4, { collide: true, tag: 'tile' });
    b.cyl('metal', 0.03, 0.03, 1.0, 8, IW - 0.25, 2.4, z, { rz: Math.PI / 2.4 });
    b.cyl('metal', 0.11, 0.11, 0.06, 8, IW - 0.62, 2.0, z, {});
    b.emitter('drip', { x: IW - 0.64, y: 1.95, z, rate: 2.2 });
  }
  // 淋浴间地面浅水
  b.boxMM('pool', IW - 1.9, -0.12, -5.0, IW, -0.02, 5.0, { collide: true, tag: 'pool' });
  b.water(IW - 1.9, -5.0, IW, 5.0, 0.015, -0.12, 'puddle');
  // 中央长凳
  bench(b, 0, -2.2, 4.0, 0);
  bench(b, 0, 2.2, 4.0, 0);
  ceilingSlab(b, FLOOR_H);
  for (const [lx, lz] of [[-2.5, -4], [0, 0], [2.5, 4]]) ceilingFixture(b, lx, lz, FLOOR_H, { kind: 'amber', size: 1.3, intensity: 5, distance: 10 });
  void rnd; void cx; void cz;
}

function genPump(b, rnd, cx, cz) {
  b.boxMM('concrete', -IW, -0.42, -IW, IW, 0, IW, { collide: true, tag: 'floor' });
  // 机组
  for (const [px, pz, ry] of [[-3.6, -3.4, 0], [3.4, -3.0, Math.PI / 2], [-3.4, 3.4, Math.PI]]) {
    b.box('metal', 2.6, 1.5, 1.4, px, 0.75, pz, { collide: true, tag: 'metal', ry });
    b.cyl('metal', 0.5, 0.5, 1.5, 14, px, 1.75, pz, { rz: ry ? 0 : Math.PI / 2, rx: ry ? Math.PI / 2 : 0 });
    b.box('panelRed', 0.3, 0.2, 0.05, px, 1.1, pz - 0.73, {});
    b.box('panelAmber', 0.3, 0.2, 0.05, px, 1.1, pz + 0.73, {});
    b.cyl('metal', 0.14, 0.14, 0.7, 8, px + 1.0, 1.7, pz, {});
  }
  // 管道
  for (let i = 0; i < 4; i++) {
    const y = FLOOR_H - 0.5 - i * 0.28;
    const g = b.cyl(i % 2 ? 'metal' : 'ropeBlue', 0.09, 0.09, IW * 2, 10, 0, y, -2 + i * 0.3, { rz: Math.PI / 2 });
    void g;
  }
  // 地面警示 + 排水
  b.box('hazard', 3.0, 0.012, 1.6, 0, 0.012, 0.5, {});
  b.cyl('dark', 0.4, 0.4, 0.02, 10, 2.4, 0.015, 1.6, {});
  b.water(1.6, 0.9, 3.2, 2.4, 0.02, -0.02, 'puddle');
  // 闪烁灯
  ceilingFixture(b, 0, 0, FLOOR_H, { kind: 'cool', size: 1.6, intensity: 6, distance: 12, flicker: 0.85 });
  ceilingFixture(b, -4.6, 4.6, FLOOR_H, { kind: 'warm', size: 1.2, intensity: 4, distance: 9 });
  ceilingSlab(b, FLOOR_H);
  b.sign('caution', 2.2, 1.1, 0, 2.2, IW - 0.16, Math.PI);
  void rnd; void cx; void cz;
}

function genSky(b, rnd, cx, cz) {
  baseFloor(b, [poolHole(-5.0, -5.0, 5.0, 5.0)]);
  // 浅水池
  buildPool(b, { x0: -5.0, z0: -5.0, x1: 5.0, z1: 5.0, deep: -0.35, kind: 'shallow' });
  // 踏石
  b.box('concrete', 1.3, 0.24, 1.3, -2.4, -0.18, -2.4, {});
  b.box('concrete', 1.3, 0.24, 1.3, 0, -0.18, 0, {});
  b.box('concrete', 1.3, 0.24, 1.3, 2.4, -0.18, 2.4, {});
  // 顶部女儿墙
  const py = Y1 + 1.1;
  b.boxMM('concrete', -IW, Y1, -IW, -IW + 0.4, py, IW, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', IW - 0.4, Y1, -IW, IW, py, IW, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', -IW, Y1, -IW, IW, py, -IW + 0.4, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', -IW, Y1, IW - 0.4, IW, py, IW, { collide: true, tag: 'concrete' });
  // 灯柱
  for (const [px, pz] of [[-5.9, -5.9], [5.9, 5.9], [-5.9, 5.9], [5.9, -5.9]]) {
    b.cyl('metal', 0.09, 0.12, 3.0, 8, px, 1.5, pz, { collide: true, tag: 'metal' });
    b.box('panelCool', 0.5, 0.18, 0.5, px, 3.0, pz, {});
    b.lamp(px, 2.9, pz, 0xa8d8ff, 5, 14, { kind: 'cool' });
  }
  bench(b, 0, -5.8, 2.6, 0);
  void rnd; void cx; void cz;
}

function genTower(b, rnd, seed, cx, cz) {
  const ph = 1.7, depth = -1.35;
  baseFloor(b, [poolHole(-ph, -ph, ph, ph)]);
  // 中央 plunge 池
  buildPool(b, { x0: -ph, z0: -ph, x1: ph, z1: ph, deep: depth, kind: 'pool' });
  // 两段折返楼梯
  const stA = switchback(b, 'W', 0, Y1, rnd(15));
  ringDeck(b, Y1, [stA.hole]);
  genRingRails(b, Y1);
  upperDressing(b, Y1);
  const stB = switchback(b, 'E', Y1, Y2, rnd(16));
  // 天台：实心楼板，只留楼梯洞
  carveBox(b, { x0: -IW, z0: -IW, x1: IW, z1: IW }, [stB.hole], Y2 - SLAB_T, Y2, { bucket: 'tile', collide: true, tag: 'floor' });
  // 天台陈设：女儿墙内侧壁灯 + 屋顶设备（其余在下方已生成）
  for (const [lx, lz, axis, dir] of [
    [0, -IW + 0.5, 'z', 1], [0, IW - 0.5, 'z', -1],
    [-IW + 0.5, 0, 'x', 1], [IW - 0.5, 0, 'x', -1],
  ]) {
    wallLampAxis(b, lx, Y2 + 0.85, lz, axis, dir);
  }
  plant(b, -IW + 1.2, -IW + 1.2, { scale: 0.9, seed: 3, y0: Y2 });
  bench(b, 0, IW - 1.2, 2.2, Math.PI, { y0: Y2 });
  // 天台设备
  b.box('metal', 2.4, 1.4, 1.8, 3.6, Y2 + 0.7, -3.6, { collide: true, tag: 'metal' });
  b.cyl('metal', 0.5, 0.5, 1.2, 12, 3.6, Y2 + 2.0, -3.6, {});
  b.box('metal', 1.8, 1.1, 1.4, -3.8, Y2 + 0.55, 3.8, { collide: true, tag: 'metal' });
  b.cyl('metal', 0.09, 0.09, 5.0, 8, -5.6, Y2 + 2.5, 5.6, { collide: false });
  b.lamp(0, Y2 + 2.6, 0, 0xfff0c8, 7, 14, { kind: 'warm' });
  // 天台女儿墙
  const py = Y2 + 1.1;
  b.boxMM('concrete', -IW, Y2, -IW, -IW + 0.36, py, IW, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', IW - 0.36, Y2, -IW, IW, py, IW, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', -IW, Y2, -IW, IW, py, -IW + 0.36, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', -IW, Y2, IW - 0.36, IW, py, IW, { collide: true, tag: 'concrete' });
  // 各层灯
  ceilingFixture(b, 0, 0, FLOOR_H, { kind: 'cool', size: 1.5, intensity: 5, distance: 11 });
  for (const [lx, lz] of [[-4.6, -4.6], [4.6, 4.6]]) {
    ceilingFixture(b, lx, lz, Y1 + FLOOR_H - 0.1, { kind: 'amber', size: 1.3, intensity: 4, distance: 9 });
  }
  void seed; void cx; void cz;
}


// ------------------------------------------------------------
//  桑拿房
// ------------------------------------------------------------
function genSauna(b, rnd, cx, cz) {
  baseFloor(b, [poolHole(-5.9, 1.9, -2.9, 5.3)]);
  // 冷水池
  buildPool(b, { x0: -5.9, z0: 1.9, x1: -2.9, z1: 5.3, deep: -1.15, kind: 'tub' });
  b.emitter('caustic', { x: -4.4, z: 3.6, y: -1.11, w: 2.2, d: 2.6 });
  b.lamp(-4.4, -0.35, 3.6, 0x8fd8ff, 5, 8, { kind: 'pool' });

  // 中央阶梯长凳（岛式，四周留出 2m 通道，不堵门）
  b.boxMM('wood', 1.4, 0, -3.2, 4.6, 0.48, 3.2, { collide: true, tag: 'wood' });
  b.boxMM('wood', 3.1, 0, -3.2, 4.6, 0.9, 3.2, { collide: true, tag: 'wood' });
  b.boxMM('woodDark', 4.55, 0.9, -3.2, 4.7, 1.8, 3.2, {});
  // 长凳木条缝
  for (let z = -2.9; z <= 2.9; z += 1.25) {
    b.box('woodDark', 3.1, 0.02, 0.06, 3.0, 0.49, z, {});
    b.box('woodDark', 1.35, 0.02, 0.06, 3.85, 0.91, z, {});
  }
  // 毛巾
  for (const [x, z] of [[4.1, -2.2], [4.1, 0.0], [4.1, 2.2]]) {
    b.box('plastic', 0.5, 0.08, 0.9, x, 0.95, z, {});
  }
  // 炉子 + 石头
  b.box('metal', 1.35, 1.1, 1.35, -4.8, 0.55, -4.7, { collide: true, tag: 'metal' });
  b.box('panelRed', 0.4, 0.16, 0.04, -4.8, 0.72, -4.0, {});
  for (let i = 0; i < 7; i++) {
    const a = i * 1.9, r = 0.15 + (i % 3) * 0.12;
    b.cyl('dark', r, r * 0.8, r * 1.4, 6, -4.8 + Math.cos(a) * 0.42, 1.2 + (i % 2) * 0.08, -4.7 + Math.sin(a) * 0.42, {});
  }
  b.cyl('metal', 0.08, 0.1, 2.3, 7, -4.8, 2.4, -5.5, {});
  b.emitter('steam', { x: -4.8, y: 1.3, z: -4.7, r: 0.55 });
  b.lamp(-4.8, 1.8, -4.7, 0xff7a42, 4, 8, { kind: 'warm', flicker: 0.4 });

  // 木桶与舀勺
  b.cyl('wood', 0.3, 0.26, 0.55, 10, -1.6, 0.28, -4.9, { collide: true, tag: 'wood' });
  b.cyl('woodDark', 0.05, 0.05, 0.8, 5, -1.6, 0.75, -4.9, { rz: 0.9 });
  // 吊顶木条
  for (let z = -6; z <= 6; z += 1.1) b.box('woodDark', IW * 2, 0.08, 0.12, 0, FLOOR_H - 0.18, z, {});
  ceilingSlab(b, FLOOR_H, [], { cove: false });
  ceilingFixture(b, -2.4, -2.0, FLOOR_H - 0.1, { kind: 'warm', size: 1.2, intensity: 4.5, distance: 9 });
  ceilingFixture(b, 1.8, 3.6, FLOOR_H - 0.1, { kind: 'warm', size: 1.0, intensity: 3.5, distance: 8 });
  b.sign('sauna', 2.6, 0.65, 0, 2.7, IW - 0.14, Math.PI);
  void rnd; void cx; void cz;
}

// ------------------------------------------------------------
//  滑水道
// ------------------------------------------------------------
function genSlide(b, rnd, cx, cz) {
  baseFloor(b, [poolHole(-0.4, 3.0, 5.1, 6.4)]);
  // 落水池
  buildPool(b, { x0: -0.4, z0: 3.0, x1: 5.1, z1: 6.4, deep: -1.05, kind: 'pool' });
  b.emitter('caustic', { x: 2.35, z: 4.7, y: -1.01, w: 4.4, d: 3.0 });
  b.lamp(2.35, -0.3, 4.4, 0x6fd8ff, 6, 9, { kind: 'pool' });
  // 上游平台
  b.boxMM('tile', -0.8, 3.4, -6.5, 6.4, 3.62, -2.2, { collide: true, tag: 'floor' });
  for (const px of [0.0, 5.4]) {
    b.box('metal', 0.5, 3.4, 0.5, px, 1.7, -3.0, { collide: true, tag: 'metal' });
  }
  b.rail(6.4, -6.5, 6.4, -2.2, 3.62);
  b.rail(-0.8, -6.5, -0.8, -2.2, 3.62);
  // 上平台楼梯（贴东墙）
  b.stairs(4.7, -2.2, 6.4, 2.8, 'z', 3.62, 0, { ramp: true, uv: 1 / 2.2 });
  // 滑道：从平台边缘俯冲到落水池
  const len = 6.6, high = 3.62, low = 0.45, run = 6.4;
  const ang = Math.atan2(high - low, run);
  b.tiltBox('plastic', 1.85, 0.16, len, 2.35, (high + low) / 2, 1.0, ang, 0, { uv: 1 / 2 });
  b.tiltBox('ropeBlue', 1.15, 0.02, len - 0.2, 2.35, (high + low) / 2 + 0.1, 1.0, ang, 0, { uv: 1 / 2 });
  for (const sx of [1.35, 3.35]) {
    b.tiltBox('plastic', 0.12, 0.62, len, sx, (high + low) / 2 + 0.26, 1.0, ang, 0, { uv: 1 / 2 });
    b.tiltBox('metal', 0.06, 0.06, len, sx, (high + low) / 2 + 0.62, 1.0, ang, 0, { uv: 1 / 2 });
  }
  b.rampCollide(1.42, -2.2, 3.28, 4.2, 'z', high, low, 'stairs');
  // 平台入口护栏 + 水滑梯起点
  b.rail(1.2, -2.2, 4.7, -2.2, 3.62, { h: 0.9 });
  b.box('panelCyan', 1.6, 0.06, 0.06, 2.35, 3.68, -2.24, {});
  // 浮圈
  for (const [fx, fz, col] of [[1.0, 5.2, 'ropeRed'], [3.9, 5.6, 'ropeWhite'], [2.6, 4.2, 'ropeBlue']]) {
    b.torus(col, 0.48, 0.13, 20, 8, fx, -0.34, fz, Math.PI / 2);
    b.torus('ropeWhite', 0.32, 0.04, 18, 6, fx, -0.33, fz, Math.PI / 2);
  }
  // 墙边躺椅
  b.boxMM('plastic', -6.4, 0.2, 4.6, -4.4, 0.32, 5.7, { collide: true, tag: 'trim' });
  b.box('plastic', 1.9, 0.1, 0.6, -5.4, 0.55, 4.95, { rz: -0.5 });
  b.sign('slide', 3.0, 0.75, 0, 2.8, -IW + 0.14, 0);
  ceilingSlab(b, FLOOR_H, [{ x0: 0.2, z0: 3.0, x1: 4.6, z1: 5.9 }]);
  skylight(b, { x0: 0.2, z0: 3.0, x1: 4.6, z1: 5.9 }, FLOOR_H, { targetY: 0, intensity: 9 });
  for (const [lx, lz] of [[-4.6, -4.6], [4.4, -4.6], [-4.6, 4.4]]) {
    ceilingFixture(b, lx, lz, FLOOR_H, { kind: 'cool', size: 1.2, intensity: 4, distance: 9 });
  }
  void rnd; void cx; void cz;
}

// ------------------------------------------------------------
//  温室
// ------------------------------------------------------------
function tree(b, x, z, s = 1, y0 = 0) {
  b.cyl('woodDark', 0.14 * s, 0.22 * s, 1.5 * s, 8, x, y0 + 0.75 * s, z, { collide: true, tag: 'wood' });
  for (let i = 0; i < 3; i++) {
    b.cyl('leaf', 0.12 * s, (1.05 - i * 0.2) * s, 1.0 * s, 7, x, y0 + (1.5 + i * 0.42) * s, z, {});
  }
}

function genGarden(b, rnd, cx, cz) {
  baseFloor(b, [poolHole(2.8, 2.8, 6.4, 6.4)]);
  // 角落浅水池
  buildPool(b, { x0: 2.8, z0: 2.8, x1: 6.4, z1: 6.4, deep: -0.55, kind: 'shallow' });
  b.emitter('caustic', { x: 4.6, z: 4.6, y: -0.51, w: 3.2, d: 3.2 });
  b.lamp(4.6, -0.15, 4.6, 0x9fe8ff, 4, 8, { kind: 'pool' });
  // 中央种植台
  b.boxMM('concrete', -2.4, 0, -2.4, 2.4, 0.55, 2.4, { collide: true, tag: 'concrete' });
  b.boxMM('concrete', -2.55, 0.55, -2.55, 2.55, 0.62, 2.55, {});
  b.boxMM('leaf', -2.1, 0.62, -2.1, 2.1, 0.75, 2.1, {});
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, r = 0.7 + (i % 3) * 0.55;
    b.cyl('leaf', 0.1, 0.34, 0.55 + (i % 3) * 0.2, 6, Math.cos(a) * r, 0.95, Math.sin(a) * r, {});
    if (i % 2 === 0) b.cyl('ropeRed', 0.05, 0.08, 0.22, 5, Math.cos(a) * r, 1.25, Math.sin(a) * r, {});
  }
  // 大树
  tree(b, -4.6, -4.4, 1.25);
  tree(b, 4.8, -4.6, 1.05);
  tree(b, -4.8, 4.7, 0.9);
  // 四周花槽
  for (const [x, z, w, d] of [[-6.0, 0, 1.0, 8.0], [6.0, 0, 1.0, 8.0], [0, -6.0, 8.0, 1.0]]) {
    b.boxMM('concrete', x - w / 2, 0, z - d / 2, x + w / 2, 0.5, z + d / 2, { collide: true, tag: 'concrete' });
    b.boxMM('leaf', x - w / 2 + 0.1, 0.5, z - d / 2 + 0.1, x + w / 2 - 0.1, 0.62, z + d / 2 - 0.1, {});
    for (let i = 0; i < 4; i++) {
      const fx = x + (rnd(i + 3) - 0.5) * w * 0.5;
      const fz = z + (rnd(i + 5) - 0.5) * d * 0.5;
      b.cyl('ropeRed', 0.05, 0.08, 0.28, 5, fx, 0.78, fz, {});
      b.cyl('ropeWhite', 0.04, 0.06, 0.22, 5, fx + 0.12, 0.74, fz + 0.1, {});
    }
  }
  // 石径与长凳
  b.box('concrete', 2.2, 0.03, 10.4, 0, 0.015, 0, {});
  b.box('concrete', 10.4, 0.03, 2.0, 0, 0.016, 0, {});
  bench(b, -3.4, 3.7, 2.4, Math.PI / 2);
  bench(b, 3.5, -3.7, 2.4, Math.PI / 2);
  b.sign('garden', 3.0, 0.75, 0, 2.8, -IW + 0.14, 0);
  b.emitter('steam', { x: 0, y: 0.8, z: 0, r: 2.4 });
  ceilingSlab(b, FLOOR_H, [
    { x0: -4.4, z0: -1.2, x1: -1.2, z1: 1.2 },
    { x0: 1.2, z0: -1.2, x1: 4.4, z1: 1.2 },
  ]);
  skylight(b, { x0: -4.4, z0: -1.2, x1: -1.2, z1: 1.2 }, FLOOR_H, { targetY: 0, intensity: 9, color: 0xfff2d0 });
  skylight(b, { x0: 1.2, z0: -1.2, x1: 4.4, z1: 1.2 }, FLOOR_H, { targetY: 0, intensity: 9, color: 0xfff2d0 });
  ceilingFixture(b, 0, 4.6, FLOOR_H, { kind: 'warm', size: 1.0, intensity: 4, distance: 9 });
  void cx; void cz;
}

// ------------------------------------------------------------
//  过滤机房
// ------------------------------------------------------------
function genFilter(b, rnd, cx, cz) {
  b.boxMM('concrete', -IW, -0.42, -IW, IW, 0, IW, { collide: true, tag: 'floor' });
  b.boxMM('grate', -4.2, 0, 1.4, 4.2, 0.02, 6.4, {});
  const tanks = [[-3.7, -3.6], [3.7, -3.3], [-3.5, 3.6]];
  for (let i = 0; i < tanks.length; i++) {
    const [x, z] = tanks[i];
    b.cyl('metal', 1.55, 1.55, 3.8, 18, x, 1.9, z, { collide: true, tag: 'metal' });
    b.cyl('metal', 1.65, 1.65, 0.16, 18, x, 3.82, z, {});
    b.cyl('metal', 1.7, 1.7, 0.14, 18, x, 0.12, z, {});
    b.cyl('dark', 0.7, 0.7, 0.1, 12, x, 3.92, z, {});
    b.box('panelRed', 0.34, 0.2, 0.05, x, 2.7, z - 1.55, {});
    b.box('panelAmber', 0.12, 0.12, 0.05, x + 0.6, 2.7, z - 1.55, {});
    // 梯子
    for (const lx of [-0.38, 0.38]) b.cyl('metal', 0.035, 0.035, 2.8, 6, x + lx, 1.6, z - 1.7, {});
    for (let k = 0; k < 5; k++) b.cyl('metal', 0.02, 0.02, 0.8, 5, x, 0.6 + k * 0.55, z - 1.7, { rz: Math.PI / 2 });
    if (i === 1) b.lamp(x, 4.1, z, 0x9fe8ff, 5, 10, { kind: 'cool', flicker: 0.2 });
  }
  // 泵组
  for (const [px, pz, ry] of [[2.8, 2.6, 0.4], [-0.6, -5.2, -0.3]]) {
    b.box('metal', 2.0, 1.1, 1.2, px, 0.55, pz, { collide: true, tag: 'metal', ry });
    b.cyl('metal', 0.42, 0.42, 1.0, 12, px, 1.35, pz, { rz: Math.PI / 2 });
    b.box('panelCyan', 0.35, 0.14, 0.05, px, 0.9, pz - 0.63, {});
  }
  // 管道网络
  for (let i = 0; i < 5; i++) {
    b.cyl(i % 2 ? 'metal' : 'ropeBlue', 0.08, 0.08, IW * 2, 8, 0, 4.6 - i * 0.26, -2.4 + i * 0.35, { rz: Math.PI / 2 });
  }
  for (const [px, pz] of [[-3.7, 0], [3.7, 0], [0, 3.6]]) {
    b.cyl('metal', 0.11, 0.11, 2.4, 8, px, 1.6, pz, {});
    b.cyl('ropeBlue', 0.13, 0.13, 0.3, 10, px, 2.9, pz, {});
  }
  // 阀门与压力表
  for (const [vx, vz] of [[0.8, -1.4], [-1.2, 1.2], [2.2, -0.2]]) {
    b.cyl('metal', 0.28, 0.28, 0.12, 12, vx, 1.3, vz, { rx: Math.PI / 2 });
    b.cyl('panelRed', 0.09, 0.09, 0.2, 12, vx, 1.62, vz, {});
    b.cyl('ropeBlue', 0.045, 0.045, 0.55, 6, vx, 1.3, vz, { rz: Math.PI / 2 });
  }
  // 积水与蒸汽
  b.water(-1.2, -0.6, 2.2, 1.8, 0.02, -0.02, 'puddle');
  b.emitter('steam', { x: 0.4, y: 0.4, z: 0.2, r: 1.2 });
  b.emitter('drip', { x: -0.6, y: 3.9, z: -1.0, rate: 1.6 });
  b.box('hazard', 2.4, 0.012, 1.2, 3.2, 0.013, 5.4, {});
  b.sign('filter', 3.0, 0.75, 0, 2.8, -IW + 0.14, 0);
  b.sign('caution', 1.8, 0.9, IW - 0.16, 1.9, 4.2, Math.PI);
  ceilingSlab(b, FLOOR_H);
  ceilingFixture(b, 0, 0, FLOOR_H, { kind: 'cool', size: 1.4, intensity: 5, distance: 12, flicker: 0.55 });
  ceilingFixture(b, -4.4, -4.4, FLOOR_H, { kind: 'warm', size: 1.0, intensity: 3.5, distance: 8 });
  void rnd; void cx; void cz;
}

/** 上层环廊陈设：红色引导线 / 壁灯 / 植物 / 长凳 / 补充吊灯 */
export function upperDressing(b, levelY, o = {}) {
  const w = WALK_RING;
  const inner = IW - w;
  const y = levelY;
  const t = 0.12;
  // 红色引导线（沿内缘一圈）
  b.boxMM('accent', -inner - t, y + 0.004, -inner - t, inner + t, y + 0.022, -inner, {});
  b.boxMM('accent', -inner - t, y + 0.004, inner, inner + t, y + 0.022, inner + t, {});
  b.boxMM('accent', -inner - t, y + 0.004, -inner, -inner, y + 0.022, inner, {});
  b.boxMM('accent', inner, y + 0.004, -inner, inner + t, y + 0.022, inner, {});
  if (o.sparse) {
    // 顶层/屋顶：只放壁灯
    const ly = y + 0.8;
    wallLampAxis(b, 0, ly, -IW + 0.06, 'z', 1);
    wallLampAxis(b, 0, ly, IW - 0.06, 'z', -1);
    wallLampAxis(b, -IW + 0.06, ly, 0, 'x', 1);
    wallLampAxis(b, IW - 0.06, ly, 0, 'x', -1);
    return;
  }
  // 壁灯（四边中点，贴墙，灯面朝室内）
  const ly = y + 2.15;
  wallLampAxis(b, 0, ly, -IW + 0.06, 'z', 1);
  wallLampAxis(b, 0, ly, IW - 0.06, 'z', -1);
  wallLampAxis(b, -IW + 0.06, ly, 0, 'x', 1);
  wallLampAxis(b, IW - 0.06, ly, 0, 'x', -1);
  // 角落植物 + 长凳
  plant(b, -IW + 0.95, -IW + 0.95, { scale: 0.95, seed: levelY, y0: y });
  plant(b, IW - 0.95, IW - 0.95, { scale: 0.85, seed: levelY * 1.7, y0: y });
  bench(b, 0, -IW + w * 0.52, 2.1, 0, { y0: y, bucket: 'plastic' });
  // 补充吊灯
  if (o.ceiling !== false) {
    const cy = y + FLOOR_H - 0.12;
    ceilingFixture(b, -3.4, -3.4, cy, { kind: 'warm', size: 1.2, intensity: 4, distance: 9 });
    ceilingFixture(b, 3.4, 3.4, cy, { kind: 'warm', size: 1.2, intensity: 4, distance: 9 });
  }
}

function wallLampAxis(b, x, y, z, axis, dir) {
  if (axis === 'z') {
    b.box('metal', 0.52, 0.24, 0.2, x, y, z, {});
    b.box('panelWarm', 0.42, 0.16, 0.07, x, y, z + dir * 0.12, {});
  } else {
    b.box('metal', 0.2, 0.24, 0.52, x, y, z, {});
    b.box('panelWarm', 0.07, 0.16, 0.42, x + dir * 0.12, y, z, {});
  }
  b.lamp(x, y, z, 0xffe2b8, 5.2, 10, { kind: 'warm' });
}

/** 环廊栏杆：内缘一圈（楼梯井位于环廊宽度内，不破坏栏杆） */
function genRingRails(b, holeOrLevelY, o = {}) {
  const w = WALK_RING;
  const levelY = typeof holeOrLevelY === 'number' ? holeOrLevelY : (o.levelY ?? Y1);
  const red = o.red;
  void o.parapet;
  const segs = [
    { x0: -IW, z0: -IW + w, x1: IW, z1: -IW + w },
    { x0: -IW, z0: IW - w, x1: IW, z1: IW - w },
    { x0: -IW + w, z0: -IW + w, x1: -IW + w, z1: IW - w },
    { x0: IW - w, z0: -IW + w, x1: IW - w, z1: IW - w },
  ];
  for (const s of segs) b.rail(s.x0, s.z0, s.x1, s.z1, levelY, { red });
}

/** 每种房型的碎片候选点（世界坐标），纯函数：可在房间尚未构建时使用 */
export function shardSpotsFor(cx, cz, type) {
  const wx = cx * CELL, wz = cz * CELL;
  const spots = [];
  const L = (x, z, y, tag) => spots.push({ x: wx + x, z: wz + z, y, tag });
  switch (type) {
    case 'pool':
      L(0, 0, 0, 'deck'); L(-5.6, -5.6, Y1, 'ring'); L(5.6, 5.6, Y1, 'ring');
      L(2.9, 2.2, -1.15, 'shallow');
      break;
    case 'lane':
      L(-2.0, 5.0, 0, 'deck'); L(5.6, 0, 0, 'deck'); L(0, -5.0, 0, 'deck');
      break;
    case 'atrium':
      L(0, 1.6, -0.28, 'stone'); L(-5.6, 5.6, Y1, 'ring'); L(5.6, -5.6, Y1, 'ring');
      break;
    case 'hall':
      L(-4.6, 0, 0, 'floor'); L(5.6, -5.6, Y1, 'ring'); L(-5.6, 5.6, Y1, 'ring');
      break;
    case 'spa':
      L(-4.8, 4.2, 0, 'floor'); L(5.2, 5.2, 0, 'floor');
      break;
    case 'locker':
      L(0, 0, 0, 'floor'); L(-5.4, 4.4, 0, 'floor');
      break;
    case 'pump':
      L(-4.4, 0, 0, 'floor'); L(4.4, 4.4, 0, 'floor');
      break;
    case 'sky':
      L(0, 0, -0.18, 'stone'); L(-4.0, 4.0, -0.35, 'pool'); L(4.4, -4.4, 0, 'deck');
      break;
    case 'tower':
      L(-5.4, -5.4, Y1, 'ring'); L(5.4, 5.4, Y1, 'ring'); L(0, -5.4, Y2, 'roof'); L(5.4, 0, Y2, 'roof');
      break;
    case 'sauna':
      L(3.8, 0, 0.92, 'bench'); L(-5.0, 3.6, 0.2, 'plunge');
      break;
    case 'slide':
      L(3.2, -4.2, 3.64, 'platform'); L(2.4, 4.6, 0.1, 'pool');
      break;
    case 'garden':
      L(0, 0, 0.56, 'planter'); L(-4.8, 4.6, 0, 'floor');
      break;
    case 'filter':
      L(-4.6, -4.4, 0, 'floor'); L(4.4, 4.4, 0, 'floor');
      break;
    default:
      L(0, 0, 0, 'floor'); L(3.4, -3.4, 0, 'floor');
  }
  return spots;
}