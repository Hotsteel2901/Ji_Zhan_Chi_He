// ============================================================
//  碰撞系统：AABB 空间哈希 + 斜坡面 + 胶囊解算 + 射线检测
//  - 静态世界只增不减（分块流式加载时按区块增删）
//  - 玩家/敌人解算：逐轴圆-盒推挤，台阶自动跨越由地面探测处理
// ============================================================
import * as THREE from 'three';

export const GRID = 8;

let _colId = 1;

export class Collider {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, tag = 'tile') {
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
    this.tag = tag;
    this.id = _colId++;
    this.removed = false;
  }
  get cx() { return (this.minX + this.maxX) / 2; }
  get cz() { return (this.minZ + this.maxZ) / 2; }
  containsXZ(x, z, pad = 0) {
    return x >= this.minX - pad && x <= this.maxX + pad && z >= this.minZ - pad && z <= this.maxZ + pad;
  }
}

export class Ramp {
  constructor(x0, z0, x1, z1, axis, y0, y1, tag = 'ramp') {
    this.x0 = Math.min(x0, x1); this.x1 = Math.max(x0, x1);
    this.z0 = Math.min(z0, z1); this.z1 = Math.max(z0, z1);
    this.axis = axis;
    this.a0 = axis === 'z' ? this.z0 : this.x0;
    this.a1 = axis === 'z' ? this.z1 : this.x1;
    this.y0 = y0; this.y1 = y1;
    this.tag = tag;
    this.ramp = true;
  }
  heightAt(x, z) {
    const c = this.axis === 'z' ? z : x;
    const t = Math.max(0, Math.min(1, (c - this.a0) / ((this.a1 - this.a0) || 1)));
    return this.y0 + (this.y1 - this.y0) * t;
  }
  containsXZ(x, z, pad = 0.001) {
    return x >= this.x0 - pad && x <= this.x1 + pad && z >= this.z0 - pad && z <= this.z1 + pad;
  }
  normal() {
    const run = (this.a1 - this.a0) || 1;
    const g = (this.y1 - this.y0) / run;
    if (this.axis === 'z') return new THREE.Vector3(0, 1, -g).normalize();
    return new THREE.Vector3(-g, 1, 0).normalize();
  }
}

export class CollisionWorld {
  constructor() {
    this.grid = new Map();
    this.colliders = [];
    this.ramps = [];
    this.stamp = new Map();
    this._stampId = 1;
    this.version = 0;
  }

  _key(ix, iz) { return ix + ',' + iz; }

  addCollider(c) {
    this.colliders.push(c);
    const ix0 = Math.floor(c.minX / GRID), ix1 = Math.floor(c.maxX / GRID);
    const iz0 = Math.floor(c.minZ / GRID), iz1 = Math.floor(c.maxZ / GRID);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = this._key(ix, iz);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(c);
    }
    this.version++;
    return c;
  }

  addBox(cx, cy, cz, hx, hy, hz, tag) {
    return this.addCollider(new Collider(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz, tag));
  }
  addBoxMinMax(minX, minY, minZ, maxX, maxY, maxZ, tag) {
    return this.addCollider(new Collider(minX, minY, minZ, maxX, maxY, maxZ, tag));
  }
  addRamp(r) {
    this.ramps.push(r);
    const ix0 = Math.floor(r.x0 / GRID), ix1 = Math.floor(r.x1 / GRID);
    const iz0 = Math.floor(r.z0 / GRID), iz1 = Math.floor(r.z1 / GRID);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = this._key(ix, iz);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(r);
    }
    this.version++;
    return r;
  }

  /** 删除命中 predicate 的碰撞体（区块卸载用） */
  removeWhere(pred) {
    let n = 0;
    this.colliders = this.colliders.filter(c => { if (pred(c)) { c.removed = true; n++; return false; } return true; });
    this.ramps = this.ramps.filter(r => !pred(r));
    if (n) { this._rebuildGrid(); }
    return n;
  }

  _rebuildGrid() {
    this.grid.clear();
    this.stamp.clear();
    for (const c of this.colliders) this._insertOnly(c);
    for (const r of this.ramps) this._insertOnly(r);
    this.version++;
  }

  _insertOnly(c) {
    const isRamp = !!c.ramp;
    const minX = isRamp ? c.x0 : c.minX, maxX = isRamp ? c.x1 : c.maxX;
    const minZ = isRamp ? c.z0 : c.minZ, maxZ = isRamp ? c.z1 : c.maxZ;
    const ix0 = Math.floor(minX / GRID), ix1 = Math.floor(maxX / GRID);
    const iz0 = Math.floor(minZ / GRID), iz1 = Math.floor(maxZ / GRID);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = this._key(ix, iz);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(c);
    }
  }

  /** 查询 XZ 包围盒内的碰撞体（去重） */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const ix0 = Math.floor(minX / GRID), ix1 = Math.floor(maxX / GRID);
    const iz0 = Math.floor(minZ / GRID), iz1 = Math.floor(maxZ / GRID);
    const sid = this._stampId++;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const arr = this.grid.get(this._key(ix, iz));
      if (!arr) continue;
      for (const c of arr) {
        const key = c.ramp ? undefined : c.id;
        if (key !== undefined) {
          if (this.stamp.get(key) === sid) continue;
          this.stamp.set(key, sid);
        } else {
          if (c._qs === sid) continue;
          c._qs = sid;
        }
        out.push(c);
      }
    }
    return out;
  }

  /** 斜坡侧面/底部阻挡：坡面高于可跨越高度时视为实体墙 */
  _rampSideBlock(c, pos, r, h, startY, stepUp) {
    if (!c.containsXZ(pos.x, pos.z, r * 0.6)) return false;
    const ry = c.heightAt(pos.x, pos.z);
    if (ry <= startY + stepUp + 0.04) return false;       // 可以走上去
    if (ry - 0.3 >= startY + h + 0.2) return false;       // 整个坡体都在头顶上方（可从下方穿过）
    return true;
  }

  _overlapCircleAABB(x, z, r, c) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    return dx * dx + dz * dz < r * r;
  }

  /** 地面探测：返回 foot 附近下方最高可站立面 */
  groundProbe(x, z, footY, stepUp = 0.01) {
    const list = this.query(x - 0.9, z - 0.9, x + 0.9, z + 0.9);
    const limit = footY + stepUp;
    let bestY = -Infinity, bestTag = null;
    for (const c of list) {
      if (c.ramp) {
        if (!c.containsXZ(x, z)) continue;
        const y = c.heightAt(x, z);
        if (y <= limit + 0.001 && y > bestY) { bestY = y; bestTag = c.tag; }
      } else {
        if (!c.containsXZ(x, z, -0.02)) continue;
        if (c.maxY <= limit + 0.001 && c.maxY > bestY) { bestY = c.maxY; bestTag = c.tag; }
      }
    }
    return { y: bestY, tag: bestTag, found: bestY > -Infinity };
  }

  /** 顶棚探测：返回 refY+eye 上方最近的底面 */
  ceilingProbe(x, z, refY, headH) {
    const list = this.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6);
    let best = Infinity;
    for (const c of list) {
      if (c.ramp) continue;
      if (!c.containsXZ(x, z, -0.05)) continue;
      if (c.minY >= refY + headH - 0.05 && c.minY < best) best = c.minY;
    }
    return best;
  }

  /** 玩家/敌人移动解算。pos 会被修改；返回碰撞信息 */
  moveAndCollide(pos, delta, r, h, stepUp, out = { hitX: false, hitZ: false, nx: 0, nz: 0, grounded: false, groundY: pos.y, headHit: false }) {
    out.hitX = out.hitZ = false; out.nx = out.nz = 0; out.headHit = false;
    const startY = pos.y;

    // ---- X / Z（圆形 vs AABB，最小平移量推出，避免大体积地板把玩家弹飞）----
    const resolveCircle = (c) => {
      if (c.ramp) {
        const block = this._rampSideBlock(c, pos, r, h, startY, stepUp);
        if (!block) return;
        // 沿运动轴抬到坡体侧沿
        if (delta.x > 0) { pos.x = c.x0 - r; out.nx -= 1; out.hitX = true; }
        else if (delta.x < 0) { pos.x = c.x1 + r; out.nx += 1; out.hitX = true; }
        if (delta.z > 0) { pos.z = c.z0 - r; out.nz -= 1; out.hitZ = true; }
        else if (delta.z < 0) { pos.z = c.z1 + r; out.nz += 1; out.hitZ = true; }
        return;
      }
      if (c.maxY <= startY + stepUp + 0.001) return;             // 台阶/地面，交给地面探测
      if (pos.y + h <= c.minY + 0.001 || pos.y >= c.maxY - 0.001) return;
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = r - d;                                       // 小量 mtv
        pos.x += dx / d * push;
        pos.z += dz / d * push;
        out.nx -= dx / d; out.nz -= dz / d;
      } else {
        // 圆心在盒内：沿最近面推出（单次不超过 2m，避免巨大地板把玩家弹飞）
        const dl = pos.x - (c.minX - r), dr = (c.maxX + r) - pos.x;
        const dn = pos.z - (c.minZ - r), df = (c.maxZ + r) - pos.z;
        const m = Math.min(dl, dr, dn, df);
        const cap = 2.0;
        if (m === dl) { pos.x = Math.max(c.minX - r, pos.x - cap); out.nx -= 1; }
        else if (m === dr) { pos.x = Math.min(c.maxX + r, pos.x + cap); out.nx += 1; }
        else if (m === dn) { pos.z = Math.max(c.minZ - r, pos.z - cap); out.nz -= 1; }
        else { pos.z = Math.min(c.maxZ + r, pos.z + cap); out.nz += 1; }
      }
      if (delta.x !== 0) out.hitX = true;
      if (delta.z !== 0) out.hitZ = true;
    };

    if (delta.x !== 0) {
      pos.x += delta.x;
      const list = this.query(pos.x - r - 0.05, pos.z - r - 0.05, pos.x + r + 0.05, pos.z + r + 0.05);
      for (const c of list) resolveCircle(c);
    }
    if (delta.z !== 0) {
      pos.z += delta.z;
      const list = this.query(pos.x - r - 0.05, pos.z - r - 0.05, pos.x + r + 0.05, pos.z + r + 0.05);
      for (const c of list) resolveCircle(c);
    }

    // 二次修正：再迭代一轮消除角落穿插（同样使用有界 MTV）
    {
      const list = this.query(pos.x - r - 0.05, pos.z - r - 0.05, pos.x + r + 0.05, pos.z + r + 0.05);
      for (const c of list) resolveCircle(c);
    }

    // ---- Y ----
    if (delta.y <= 0) {
      const probe = this.groundProbe(pos.x, pos.z, startY, stepUp);
      const targetY = pos.y + delta.y;
      if (probe.found && probe.y <= startY + stepUp + 0.001 && targetY <= probe.y + 0.001) {
        pos.y = probe.y;
        out.grounded = true;
        out.groundY = probe.y;
        out.groundTag = probe.tag;
      } else {
        pos.y += delta.y;
        out.grounded = false;
      }
    } else {
      pos.y += delta.y;
      const list = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
      for (const c of list) {
        if (c.ramp) continue;
        if (!c.containsXZ(pos.x, pos.z, -0.02)) continue;
        if (pos.y + h > c.minY && startY + h <= c.minY + 0.001) {
          pos.y = c.minY - h;
          out.headHit = true;
        }
      }
      out.grounded = false;
    }
    return out;
  }

  /** 圆形区域内是否有实体阻挡（出生点校验） */
  blocked(x, y, z, r, h) {
    const list = this.query(x - r, z - r, x + r, z + r);
    for (const c of list) {
      if (c.ramp) continue;
      if (c.maxY <= y + 0.06 || c.minY >= y + h) continue;
      if (this._overlapCircleAABB(x, z, r, c)) return true;
    }
    return false;
  }

  /** 射线检测（DDA 沿网格推进），返回最近命中 */
  raycast(origin, dir, maxDist, opts = {}) {
    const hit = { hit: false, t: maxDist, point: null, normal: null, tag: null, collider: null };
    const seen = new Set();
    let ix = Math.floor(origin.x / GRID), iz = Math.floor(origin.z / GRID);
    const stepX = dir.x > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const invX = dir.x !== 0 ? 1 / Math.abs(dir.x) : Infinity;
    const invZ = dir.z !== 0 ? 1 / Math.abs(dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? (((dir.x > 0 ? (ix + 1) * GRID : ix * GRID) - origin.x) / dir.x) : Infinity;
    let tMaxZ = dir.z !== 0 ? (((dir.z > 0 ? (iz + 1) * GRID : iz * GRID) - origin.z) / dir.z) : Infinity;
    const tDeltaX = GRID * invX, tDeltaZ = GRID * invZ;

    let t = 0;
    let guard = 0;
    while (t <= maxDist && guard++ < 400) {
      const arr = this.grid.get(this._key(ix, iz));
      if (arr) {
        for (const c of arr) {
          let key;
          if (c.ramp) { key = 'r' + c.x0 + c.z0 + c.y0 + c.y1; }
          else { key = c.id; }
          if (seen.has(key)) continue;
          seen.add(key);
          if (opts.ignore && opts.ignore(c)) continue;
          if (c.ramp) {
            const h = rayRamp(origin, dir, c, maxDist);
            if (h && h.t < hit.t) { hit.hit = true; hit.t = h.t; hit.point = h.point; hit.normal = h.normal; hit.tag = c.tag; hit.collider = c; }
          } else {
            const h = rayAABB(origin, dir, c, maxDist);
            if (h && h.t < hit.t) { hit.hit = true; hit.t = h.t; hit.point = h.point; hit.normal = h.normal; hit.tag = c.tag; hit.collider = c; }
          }
        }
      }
      if (tMaxX < tMaxZ) { t = tMaxX; ix += stepX; tMaxX += tDeltaX; }
      else { t = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ; }
      if (t > maxDist) break;
      if (hit.hit && t > hit.t) break;
    }
    return hit;
  }
}

const _min = new THREE.Vector3(), _max = new THREE.Vector3();
export function rayAABB(o, d, c, maxDist = Infinity) {
  let tmin = 0, tmax = maxDist;
  let nx = 0, ny = 0, nz = 0;
  // X
  if (Math.abs(d.x) < 1e-9) { if (o.x < c.minX || o.x > c.maxX) return null; }
  else {
    let t1 = (c.minX - o.x) / d.x, t2 = (c.maxX - o.x) / d.x;
    let sign = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = sign; ny = 0; nz = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Y
  if (Math.abs(d.y) < 1e-9) { if (o.y < c.minY || o.y > c.maxY) return null; }
  else {
    let t1 = (c.minY - o.y) / d.y, t2 = (c.maxY - o.y) / d.y;
    let sign = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = sign; nz = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Z
  if (Math.abs(d.z) < 1e-9) { if (o.z < c.minZ || o.z > c.maxZ) return null; }
  else {
    let t1 = (c.minZ - o.z) / d.z, t2 = (c.maxZ - o.z) / d.z;
    let sign = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = sign; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin < 0) return null;
  return { t: tmin, point: new THREE.Vector3(o.x + d.x * tmin, o.y + d.y * tmin, o.z + d.z * tmin), normal: new THREE.Vector3(nx, ny, nz) };
}

export function rayRamp(o, d, r, maxDist = Infinity) {
  const run = (r.a1 - r.a0) || 1;
  const g = (r.y1 - r.y0) / run;
  let t;
  if (r.axis === 'z') {
    const denom = d.y - g * d.z;
    if (Math.abs(denom) < 1e-9) return null;
    t = (r.y0 + g * (o.z - r.z0) - o.y) / denom;
  } else {
    const denom = d.y - g * d.x;
    if (Math.abs(denom) < 1e-9) return null;
    t = (r.y0 + g * (o.x - r.x0) - o.y) / denom;
  }
  if (t < 0 || t > maxDist) return null;
  const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
  if (!r.containsXZ(px, pz)) return null;
  return { t, point: new THREE.Vector3(px, py, pz), normal: r.normal() };
}

/** 球体射线（敌人命中） */
export function raySphere(o, d, center, radius, maxDist = Infinity) {
  const ox = o.x - center.x, oy = o.y - center.y, oz = o.z - center.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = -b + Math.sqrt(disc);
  return (t > 0 && t <= maxDist) ? t : -1;
}

void _min; void _max;