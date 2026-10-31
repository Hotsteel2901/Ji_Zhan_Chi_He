// ============================================================
//  世界：确定性规划 + 分块流式构建 + 空间查询
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, H, CHUNK, FLOOR_H, Y1, Y2, WATER_Y, QUALITY } from '../config.mjs';
import { CollisionWorld } from '../collision.mjs';
import { texLib } from '../util.mjs';
import { Builder, materials } from './build.mjs';
import { buildCell, cellType, hasUpper, topOf, levelsOf, shardSpotsFor } from './cells.mjs';
import { buildSeam, seamDoorAt } from './seams.mjs';

const AO_BUCKETS = new Set(['tile', 'pool', 'concrete', 'metal', 'trim', 'accent', 'grate', 'hazard', 'plastic', 'dark', 'ropeRed', 'ropeWhite', 'ropeBlue', 'wood', 'woodDark', 'leaf', 'foliage']);

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.collision = new CollisionWorld();
    this.cells = new Map();
    this.chunks = new Map();
    this.buildQueue = [];
    this.waterVolumes = [];
    this.stairRamps = [];
    this.lamps = [];
    this.emitters = [];
    this.visits = new Set();
    this.lastChunk = { x: Infinity, z: Infinity };
    this.renderDist = 1;
    this.buildBudget = 3;         // 每帧最多生成的房间数
    this.onChunkBuilt = null;
    this._pendingColliders = [];
    this._pendingRamps = [];
    this._pendingWater = [];
    this._aoCache = null;
    this.stats = { cells: 0, builds: 0 };
  }

  setQuality(preset) {
    const q = QUALITY[preset] || QUALITY.high;
    this.renderDist = q.renderDist;
    this.buildBudget = preset === 'low' ? 4 : 3;
  }

  cellKey(cx, cz) { return cx + ',' + cz; }
  chunkKey(bcx, bcz) { return bcx + ',' + bcz; }

  // ----------------------------------------------------------
  // 规划 & 构建
  // ----------------------------------------------------------
  ensureCell(cx, cz) {
    const key = this.cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (cell) return cell;
    const type = cellType(cx, cz, this.seed);
    cell = {
      key, cx, cz, type,
      cxw: cx * CELL, czw: cz * CELL,
      hasUpper: hasUpper(type), top: topOf(type), levels: levelsOf(type),
      doorAt: {
        E: seamDoorAt(cx, cz, 'E', this.seed),
        S: seamDoorAt(cx, cz, 'S', this.seed),
        N: seamDoorAt(cx, cz - 1, 'S', this.seed),
        W: seamDoorAt(cx - 1, cz, 'E', this.seed),
      },
      colliders: [], ramps: [], geo: {}, decals: [], signs: [],
      lamps: [], water: [], emitters: [], shardSpots: [],
      built: false, chunk: this.chunkKey(Math.floor(cx / CHUNK), Math.floor(cz / CHUNK)),
    };
    this.cells.set(key, cell);
    const b = new Builder(cell, this);
    buildCell(b, type, this.seed, cx, cz);
    // 该房间拥有的接缝（东/南）
    buildSeam(b, 'E', this.seed);
    buildSeam(b, 'S', this.seed);
    // 碰撞入网
    for (const c of this._pendingColliders) this.collision.addCollider(c);
    for (const r of this._pendingRamps) {
      this.collision.addRamp(r);
      if (r.tag === 'stairs') this.stairRamps.push(r);
    }
    this._pendingColliders.length = 0;
    this._pendingRamps.length = 0;
    for (const v of this._pendingWater) this.waterVolumes.push(v);
    this._pendingWater.length = 0;
    for (const l of cell.lamps) this.lamps.push(l);
    for (const e of cell.emitters) this.emitters.push(e);
    this.bakeAO(cell);
    this.stats.cells++;
    return cell;
  }

  // ----------------------------------------------------------
  // 环境光遮蔽（顶点色）：平面占用图 + 模糊，成本低、效果明显
  // ----------------------------------------------------------
  bakeAO(cell) {
    const N = 28, res = CELL / N;
    const ox = cell.cxw - H, oz = cell.czw - H;
    const maps = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
    const bands = [[-8, Y1 - 0.06], [Y1 - 0.06, Y2 - 0.06], [Y2 - 0.06, 99]];
    for (const c of cell.colliders) {
      if (c.ramp) continue;
      for (let bi = 0; bi < 3; bi++) {
        const [b0, b1] = bands[bi];
        if (c.maxY < b0 || c.minY > b1) continue;
        const pad = 0.5;
        const x0 = Math.max(0, Math.floor((c.minX - pad - ox) / res));
        const x1 = Math.min(N - 1, Math.ceil((c.maxX + pad - ox) / res));
        const z0 = Math.max(0, Math.floor((c.minZ - pad - oz) / res));
        const z1 = Math.min(N - 1, Math.ceil((c.maxZ + pad - oz) / res));
        const m = maps[bi];
        for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) m[iz * N + ix] = 1;
      }
    }
    // 模糊两遍
    for (let pass = 0; pass < 2; pass++) {
      for (let bi = 0; bi < 3; bi++) {
        const m = maps[bi], out = new Float32Array(N * N);
        for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
          let s = 0, n = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || xx >= N || zz < 0 || zz >= N) continue;
            s += m[zz * N + xx]; n++;
          }
          out[z * N + x] = s / n;
        }
        maps[bi] = out;
      }
    }
    const aoAt = (x, y, z) => {
      const bi = y < Y1 - 0.06 ? 0 : y < Y2 - 0.06 ? 1 : 2;
      const ix = Math.max(0, Math.min(N - 1, Math.floor((x - ox) / res)));
      const iz = Math.max(0, Math.min(N - 1, Math.floor((z - oz) / res)));
      return 1 - 0.44 * maps[bi][iz * N + ix];
    };
    const col = new THREE.Color();
    for (const name in cell.geo) {
      if (!AO_BUCKETS.has(name)) continue;
      for (const geo of cell.geo[name]) {
        const pos = geo.getAttribute('position');
        const nor = geo.getAttribute('normal');
        if (!pos) continue;
        const colors = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          let v = aoAt(pos.getX(i), pos.getY(i), pos.getZ(i));
          if (nor && nor.getY(i) > 0.7) v = 1 - (1 - v) * 0.5;   // 地板/走道：AO 减半，避免窄环廊发黑
          if (nor && nor.getY(i) < -0.4) v *= 0.86;              // 底面更暗
          col.setScalar(v);
          colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
    }
  }

  // ----------------------------------------------------------
  // 区块合并渲染
  // ----------------------------------------------------------
  matForBucket(name, mats) {
    if (name.startsWith('sign:')) {
      const key = name.slice(5);
      if (!mats['sign_' + key]) {
        const tex = (texLib.signs && texLib.signs[key]) || null;
        mats['sign_' + key] = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, side: THREE.FrontSide });
      }
      return mats['sign_' + key];
    }
    return mats[name] || null;
  }

  mergeChunk(chunk) {
    const mats = materials();
    const buckets = {};
    const push = (name, geo) => { (buckets[name] || (buckets[name] = [])).push(geo); };
    for (const cell of chunk.cells) {
      for (const name in cell.geo) {
        for (const geo of cell.geo[name]) push(name, geo);
      }
      // 水体
      for (const v of cell.water) {
        const w = v.maxX - v.minX, d = v.maxZ - v.minZ;
        const segX = Math.max(4, Math.min(24, Math.round(w / 1.4)));
        const segZ = Math.max(4, Math.min(24, Math.round(d / 1.4)));
        const plane = new THREE.PlaneGeometry(w, d, segX, segZ);
        plane.rotateX(-Math.PI / 2);
        plane.translate((v.minX + v.maxX) / 2, v.surface, (v.minZ + v.maxZ) / 2);
        push('water', plane);
      }
      // 装饰发射器 → 静态几何
      for (const e of cell.emitters) {
        if (e.type === 'caustic') {
          const g = new THREE.PlaneGeometry(e.w, e.d);
          g.rotateX(-Math.PI / 2); g.translate(e.x, e.y, e.z);
          push('caustic', g);
        } else if (e.type === 'lightpool') {
          const g = new THREE.PlaneGeometry(e.w, e.d);
          g.rotateX(-Math.PI / 2); g.translate(e.x, e.y, e.z);
          push('lightpool', g);
        } else if (e.type === 'shaft') {
          const hgt = Math.max(1, e.yTop - e.target);
          const g = new THREE.CylinderGeometry(e.w * 0.42, e.w * 0.95, hgt, 14, 1, true);
          g.translate(e.x, e.target + hgt / 2, e.z);
          push('shaft', g);
        }
      }
      for (const g of cell.decals) push('shadow', g);
      for (const s of cell.signs) {
        const g = new THREE.PlaneGeometry(s.w, s.h);
        g.rotateY(s.ry || 0);
        g.translate(s.x, s.y, s.z);
        push('sign:' + s.tex, g);
      }
    }
    const group = new THREE.Group();
    group.name = 'chunk_' + chunk.key;
    const signMats = this._signMats || (this._signMats = {});
    for (const cell of chunk.cells) cell.geo = {};
    for (const name in buckets) {
      const list = buckets[name];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      list.length = 0;
      if (!merged) continue;
      let mat;
      if (name.startsWith('sign:')) {
        mat = this.matForBucket(name, signMats);
      } else {
        mat = mats[name];
      }
      if (!mat) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      if (name === 'water') { mesh.renderOrder = 3; mesh.frustumCulled = true; mesh.layers.set(2); }
      if (name === 'shaft') { mesh.renderOrder = 4; }
      if (name === 'lightpool' || name === 'caustic' || name === 'shadow') { mesh.renderOrder = 2; }
      group.add(mesh);
    }
    this.scene.add(group);
    chunk.group = group;
    chunk.built = true;
    this.stats.builds++;
    if (this.onChunkBuilt) this.onChunkBuilt(chunk);
  }

  unloadChunk(chunk) {
    if (chunk.group) {
      this.scene.remove(chunk.group);
      chunk.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      chunk.group = null;
    }
    const cellKeys = new Set(chunk.cells.map(c => c.key));
    this.collision.removeWhere((c) => cellKeys.has(c.owner));
    this.waterVolumes = this.waterVolumes.filter(v => !cellKeys.has(v.owner));
    this.stairRamps = this.stairRamps.filter(r => !cellKeys.has(r.owner));
    this.lamps = this.lamps.filter(l => !cellKeys.has(l.owner));
    this.emitters = this.emitters.filter(e => !cellKeys.has(e.owner));
    for (const cell of chunk.cells) {
      for (const name in cell.geo) for (const g of cell.geo[name]) g.dispose();
      cell.geo = {};
      this.cells.delete(cell.key);
    }
    chunk.cells = [];
  }

  update(px, pz) {
    const bcx = Math.floor((px + H) / (CELL * CHUNK));
    const bcz = Math.floor((pz + H) / (CELL * CHUNK));
    if (bcx !== this.lastChunk.x || bcz !== this.lastChunk.z) {
      this.lastChunk = { x: bcx, z: bcz };
      const viewR = this.renderDist;
      const buildR = viewR + 1;               // 提前 1 个区块构建（视野外就绪，不出现弹入）
      const keepR = viewR + 1;                // 滞后 1 个区块卸载（来回走动不再反复重建）
      const inBuild = (dx, dz) => Math.abs(dx) <= buildR && Math.abs(dz) <= buildR;
      const inKeep = (dx, dz) => Math.abs(dx) <= keepR && Math.abs(dz) <= keepR;
      // 卸载：超出保留半径才卸载（且绝不卸载玩家所在区块）
      for (const [k, chunk] of this.chunks) {
        const dx = chunk.bcx - bcx, dz = chunk.bcz - bcz;
        if (inKeep(dx, dz)) continue;
        this.unloadChunk(chunk);
        this.chunks.delete(k);
      }
      const needed = new Set();
      for (let dx = -buildR; dx <= buildR; dx++)
        for (let dz = -buildR; dz <= buildR; dz++)
          if (inBuild(dx, dz)) needed.add(this.chunkKey(bcx + dx, bcz + dz));
      this.buildQueue = [];
      for (const k of needed) {
        if (this.chunks.has(k)) continue;
        const [x, z] = k.split(',').map(Number);
        const chunk = { key: k, bcx: x, bcz: z, group: null, built: false, cells: [], pending: [] };
        for (let cx = x * CHUNK; cx < x * CHUNK + CHUNK; cx++)
          for (let cz = z * CHUNK; cz < z * CHUNK + CHUNK; cz++)
            chunk.pending.push([cx, cz]);
        this.chunks.set(k, chunk);
        this.buildQueue.push(chunk);
      }
      // 最近的先建
      this.buildQueue.sort((a, b) => (Math.abs(a.bcx - bcx) + Math.abs(a.bcz - bcz)) - (Math.abs(b.bcx - bcx) + Math.abs(b.bcz - bcz)));
    }
    // 预算内构建（积压越多越快补齐）
    let budget = this.buildBudget;
    if (this.buildQueue.length > 6) budget = this.buildBudget * 2;
    if (this.buildQueue.length > 14) budget = this.buildBudget * 4;
    while (budget > 0 && this.buildQueue.length) {
      const chunk = this.buildQueue[0];
      while (budget > 0 && chunk.pending.length) {
        const [cx, cz] = chunk.pending.shift();
        const cell = this.ensureCell(cx, cz);
        chunk.cells.push(cell);
        budget--;
      }
      if (!chunk.pending.length) {
        if (!chunk.group) this.mergeChunk(chunk);
        if (chunk.built) this.buildQueue.shift();
        break;
      }
    }
    this.visits.add(this.cellKey(Math.round(px / CELL), Math.round(pz / CELL)));
  }

  /** 预热：同步生成以 (cx,cz) 为中心的一圈，用于开局 */
  warmup(cx, cz) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.ensureCell(cx + dx, cz + dz);
    const b = this.cellKey(cx, cz);
    void b;
  }

  /** 同步预建区块（把出生区直接合并好，避免开局透过未建好的墙看到亮雾） */
  prewarm(px, pz, chunkR = 1) {
    const bcx = Math.floor((px + H) / (CELL * CHUNK));
    const bcz = Math.floor((pz + H) / (CELL * CHUNK));
    for (let dx = -chunkR; dx <= chunkR; dx++) {
      for (let dz = -chunkR; dz <= chunkR; dz++) {
        const key = this.chunkKey(bcx + dx, bcz + dz);
        if (this.chunks.has(key)) continue;
        const chunk = { key, bcx: bcx + dx, bcz: bcz + dz, group: null, built: false, cells: [], pending: [] };
        for (let cx = chunk.bcx * CHUNK; cx < chunk.bcx * CHUNK + CHUNK; cx++)
          for (let cz = chunk.bcz * CHUNK; cz < chunk.bcz * CHUNK + CHUNK; cz++)
            chunk.cells.push(this.ensureCell(cx, cz));
        this.mergeChunk(chunk);
        this.chunks.set(key, chunk);
      }
    }
    this.lastChunk = { x: bcx, z: bcz };
  }

  // ----------------------------------------------------------
  // 查询
  // ----------------------------------------------------------
  groundAt(x, z, refY, stepUp = 0.01) {
    return this.collision.groundProbe(x, z, refY, stepUp);
  }
  ceilingAt(x, z, refY, headH = 1.8) {
    return this.collision.ceilingProbe(x, z, refY, headH);
  }
  /** 返回水体信息或 null */
  waterAt(x, z) {
    for (const v of this.waterVolumes) {
      if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ) return v;
    }
    return null;
  }
  /** 水体表面（考虑脚部位置：只有低于表面才算入水） */
  liquidAt(x, z) { return this.waterAt(x, z); }
  raycast(origin, dir, maxDist) { return this.collision.raycast(origin, dir, maxDist); }
  blocked(x, y, z, r, h) { return this.collision.blocked(x, y, z, r, h); }
  moveAndCollide(pos, delta, r, h, stepUp, out) { return this.collision.moveAndCollide(pos, delta, r, h, stepUp, out); }

  // ----------------------------------------------------------
  // 目标点
  // ----------------------------------------------------------
  shardPlan(count, seed) {
    const cands = [];
    for (let ring = 2; ring <= 9; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (dx === 0 && dz === 0) continue;
        cands.push([dx, dz]);
      }
    }
    const out = [];
    const used = new Set();
    let i = 0;
    while (out.length < count && i < cands.length * 3) {
      const c = cands[Math.floor(hashSeq(i, seed) * cands.length)];
      i++;
      const [dx, dz] = c;
      if (used.has(dx + ',' + dz)) continue;
      used.add(dx + ',' + dz);
      const type = cellType(dx, dz, this.seed);
      const spots = shardSpotsFor(dx, dz, type);
      if (!spots.length) continue;
      const sp = spots[Math.floor(hashSeq(i * 7 + 3, seed) * spots.length)];
      out.push({ cx: dx, cz: dz, spot: sp, index: out.length });
    }
    return out;
  }

  exitPlan(seed) {
    for (let ring = 5; ring <= 11; ring++) {
      const towers = [];
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (cellType(dx, dz, this.seed) === 'tower') towers.push([dx, dz]);
      }
      if (towers.length) {
        const t = towers[Math.floor(hashSeq(ring * 13, seed) * towers.length)];
        const spots = shardSpotsFor(t[0], t[1], 'tower');
        const roof = spots.find(s => s.tag === 'roof') || spots[0];
        return { cx: t[0], cz: t[1], spot: roof };
      }
    }
    return { cx: 8, cz: 8, spot: { x: 8 * CELL, z: 8 * CELL, y: Y2, tag: 'roof' } };
  }

  /** 随机可站立点（敌人生成） */
  randomSpot(rng, px, pz, minR, maxR, nearY) {
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2;
      const r = minR + rng() * (maxR - minR);
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
      if (!this.cells.has(this.cellKey(cx, cz))) continue;
      const baseY = nearY ?? 0;
      // 优先选择与目标同层的可站立面（避免刷在无法到达的上层）
      const g = this.groundAt(x, z, baseY + 1.1, 1.1);
      if (!g.found) continue;
      if (Math.abs(g.y - baseY) > 2.4) continue;
      if (this.blocked(x, g.y, z, 0.45, 1.7)) continue;
      return { x, y: g.y, z };
    }
    return null;
  }
}

function hashSeq(i, seed) {
  let n = (i * 2654435761 + seed * 2246822519) | 0;
  n = (n ^ (n >>> 15)) * 2246822519;
  n = (n ^ (n >>> 13)) >>> 0;
  return n / 4294967296;
}

void FLOOR_H; void WATER_Y;