// ============================================================
//  接缝（房间之间的墙）：门洞 / 上层走道口 / 门框
//  - 每个接缝由坐标键较小的一侧拥有并构建，保证只建一次
//  - 洞口位置由接缝哈希决定，两侧一致
// ============================================================
import { CELL, H, DOOR_W, DOOR_H, UDOOR_W, UDOOR_H, WALL_T } from '../config.mjs';
import { hash2 } from '../util.mjs';
import { cellType, hasUpper, topOf, levelsOf } from './cells.mjs';

const clampDoor = (v) => Math.max(-2.2, Math.min(2.2, v));

/** 门洞偏移：同排/同列的接缝使用同一基准 → 形成贯通走廊，布局更合理 */
export function seamDoorAt(cx, cz, dir, seed) {
  const sx = Math.min(cx, cx + (dir === 'E' ? 1 : 0));
  const sz = Math.min(cz, cz + (dir === 'S' ? 1 : 0));
  const jitter = (hash2(sx, sz, dir === 'E' ? 53 : 54, seed) - 0.5) * 0.9;
  if (dir === 'E') {
    const base = (hash2(0, sz, 51, seed) - 0.5) * 3.6;      // 按行对齐（东西向走廊）
    return clampDoor(base + jitter);
  }
  const base = (hash2(sx, 0, 52, seed) - 0.5) * 3.6;        // 按列对齐（南北向走廊）
  return clampDoor(base + jitter);
}
export function seamUpperAt(cx, cz, dir, seed) {
  const sx = Math.min(cx, cx + (dir === 'E' ? 1 : 0));
  const sz = Math.min(cz, cz + (dir === 'S' ? 1 : 0));
  const jitter = (hash2(sx, sz, dir === 'E' ? 63 : 64, seed) - 0.5) * 0.7;
  if (dir === 'E') {
    const base = (hash2(0, sz, 61, seed) - 0.5) * 3.2;
    return clampDoor(base + jitter);
  }
  const base = (hash2(sx, 0, 62, seed) - 0.5) * 3.2;
  return clampDoor(base + jitter);
}

export function neighborMeta(cx, cz, dir, seed) {
  const nx = cx + (dir === 'E' ? 1 : dir === 'W' ? -1 : 0);
  const nz = cz + (dir === 'S' ? 1 : dir === 'N' ? -1 : 0);
  const t = cellType(nx, nz, seed);
  return { type: t, hasUpper: hasUpper(t), top: topOf(t), levels: levelsOf(t), cx: nx, cz: nz };
}

/** 构建接缝墙（由 owner cell 调用）。dir 仅 'E' | 'S' */
export function buildSeam(b, dir, seed) {
  const cell = b.cell;
  const cx = cell.cx, cz = cell.cz;
  const meta = neighborMeta(cx, cz, dir, seed);
  const myMeta = { type: cell.type, hasUpper: hasUpper(cell.type), top: topOf(cell.type), levels: levelsOf(cell.type) };
  const top = Math.max(myMeta.top, meta.top);
  const isX = dir === 'E';
  const fixed = isX ? cx * CELL + H : cz * CELL + H;
  const a0 = isX ? cz * CELL - H : cx * CELL - H;
  const a1 = isX ? cz * CELL + H : cx * CELL + H;
  const doorCenter = (isX ? cz * CELL : cx * CELL) + seamDoorAt(cx, cz, dir, seed);

  // 洞口集合：底层门 + 两侧共有的上层走道口
  const openings = [{ a0: doorCenter - DOOR_W / 2, a1: doorCenter + DOOR_W / 2, y0: 0, y1: DOOR_H }];
  const upperOpen = [];
  for (const lv of myMeta.levels) {
    if (!meta.levels.includes(lv)) continue;
    const uc = (isX ? cz * CELL : cx * CELL) + seamUpperAt(cx, cz, dir, seed);
    const op = { a0: uc - UDOOR_W / 2, a1: uc + UDOOR_W / 2, y0: lv, y1: lv + UDOOR_H, level: lv };
    openings.push(op);
    upperOpen.push(op);
  }

  // 墙体（下段瓷砖 / 上段混凝土）
  const tileTop = 2.4;
  if (top > 0.02) {
    if (tileTop < top) {
      b.wallSegments(isX, fixed, a0, a1, 0, Math.min(tileTop, top), openings, { bucket: 'tile', uv: 1 / 2.2, collide: true, world: true });
      b.wallSegments(isX, fixed, a0, a1, Math.min(tileTop, top), top, openings, { bucket: 'concrete', uv: 1 / 2.6, collide: true, world: true });
    } else {
      b.wallSegments(isX, fixed, a0, a1, 0, top, openings, { bucket: 'tile', uv: 1 / 2.2, collide: true, world: true });
    }
  }

  // 接缝楼板：补齐门洞下方 0.42m 的缺板（宽度严格等于墙厚，避免与两侧地板共面重叠产生 z-fighting）
  {
    const th = WALL_T;
    const len = a1 - a0;
    const cx = isX ? fixed : (a0 + a1) / 2;
    const cz = isX ? (a0 + a1) / 2 : fixed;
    const w = isX ? th : len;
    const d = isX ? len : th;
    b._boxW('tile', w, 0.42, d, cx, -0.213, cz, { collide: true, tag: 'floor', uv: 1 / 2.2 });
    // 上层走道口踏板：比环廊低 6mm，避免共面闪烁（台阶自动跨越无感）
    for (const op of upperOpen) {
      const oc = (op.a0 + op.a1) / 2;
      const olen = (op.a1 - op.a0) + 0.6;
      const ocx = isX ? fixed : oc;
      const ocz = isX ? oc : fixed;
      const ow = isX ? WALL_T : olen;
      const od = isX ? olen : WALL_T;
      b._boxW('tile', ow, 0.36, od, ocx, op.y0 - 0.186, ocz, { collide: true, tag: 'floor', uv: 1 / 2.2 });
    }
  }

  // 门框 + 门槛 + 红色门楣
  const frame = (center, y0, h, w, lintel) => {
    for (const sgn of [-1, 1]) {
      const off = center + sgn * (w / 2 + 0.16);
      if (isX) b._boxW('metal', WALL_T + 0.1, h + 0.3, 0.32, fixed, y0 + (h + 0.3) / 2, off, { uv: 0.5 });
      else b._boxW('metal', 0.32, h + 0.3, WALL_T + 0.1, off, y0 + (h + 0.3) / 2, fixed, { uv: 0.5 });
    }
    if (lintel) {
      if (isX) b._boxW('accent', WALL_T + 0.16, 0.22, w + 0.9, fixed, y0 + h + 0.11, center, { uv: 0.5 });
      else b._boxW('accent', w + 0.9, 0.22, WALL_T + 0.16, center, y0 + h + 0.11, fixed, { uv: 0.5 });
    }
  };
  frame(doorCenter, 0, DOOR_H, DOOR_W, true);
  for (const op of upperOpen) frame((op.a0 + op.a1) / 2, op.y0, UDOOR_H, UDOOR_W, true);

  // 门槛金属条
  if (isX) b._boxW('metal', WALL_T + 0.2, 0.05, DOOR_W, fixed, 0.025, doorCenter, { uv: 0.4 });
  else b._boxW('metal', DOOR_W, 0.05, WALL_T + 0.2, doorCenter, 0.025, fixed, { uv: 0.4 });

  // 上层走道口地面金属压条（让环廊接缝更自然）
  for (const op of upperOpen) {
    const c = (op.a0 + op.a1) / 2;
    if (isX) b._boxW('metal', WALL_T + 0.2, 0.04, UDOOR_W, fixed, op.y0 + 0.02, c, { uv: 0.4 });
    else b._boxW('metal', UDOOR_W, 0.04, WALL_T + 0.2, c, op.y0 + 0.02, fixed, { uv: 0.4 });
  }
}