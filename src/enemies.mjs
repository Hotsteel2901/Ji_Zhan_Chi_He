// ============================================================
//  敌人：程序化骨骼模型 / AI / 游泳 / 命中区域 / 远程喷吐
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENEMY_TYPES, Y1 } from './config.mjs';
import { clamp, damp, lerp } from './util.mjs';
import { raySphere } from './collision.mjs';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

const ENEMY_AURA_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(200,240,255,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

function boxG(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}
function capG(r, len, seg = 8) {
  return new THREE.CapsuleGeometry(r, len, 3, seg);
}

/** 构建一只敌人的分层模型（每肢一段合并网格） */
function buildEnemyModel(def, isBrute) {
  const isBoss = !!def.boss;
  const root = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({
    color: isBrute ? 0x27333d : 0x223039, roughness: 0.5, metalness: 0.24,
    transparent: true, opacity: 0.96, emissive: 0x000000, emissiveIntensity: 0,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x10181e, roughness: 0.35, metalness: 0.4,
    emissive: def.eye, emissiveIntensity: 2.1,
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.eye, emissiveIntensity: 3.0 });

  const scale = def.scale;
  const hipY = 0.92 * scale;
  const chestY = 1.28 * scale;
  const neckY = 1.52 * scale;
  const shoulderY = 1.42 * scale;

  // 躯干
  const body = new THREE.Group();
  body.position.y = hipY;
  root.add(body);
  const torsoGeo = mergeGeometries([
    capG(0.3, 0.4, 9).translate(0, 0.16, 0),
    boxG(0.5, 0.34, 0.32, 0, 0.42, 0, 0, 0, 0),
    boxG(0.34, 0.22, 0.3, 0, 0.02, 0),
  ], false);
  const torso = new THREE.Mesh(torsoGeo, skinMat);
  body.add(torso);
  // 核心（发光）
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.14 * scale), glowMat);
  core.position.set(0, 0.32, -0.17);
  core.rotation.y = 0.6;
  body.add(core);
  // 胸口光晕（黑暗中也看得见轮廓）
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ENEMY_AURA_TEX, color: def.eye, transparent: true, opacity: 0.26,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  aura.scale.setScalar(1.45 * scale);
  aura.position.set(0, 0.3, 0.02);
  body.add(aura);
  // 背部骨刺
  const spikeGeos = [];
  for (let i = 0; i < 3; i++) {
    spikeGeos.push(boxG(0.06, 0.3 - i * 0.05, 0.05, 0, 0.42 - i * 0.14, 0.18, -0.5 - i * 0.15));
  }
  body.add(new THREE.Mesh(mergeGeometries(spikeGeos, false), skinMat));

  // 头部
  const head = new THREE.Group();
  head.position.y = neckY - hipY;
  body.add(head);
  const skullGeo = mergeGeometries([
    capG(0.2 * scale, 0.12, 9).scale(1, 1.05, 1.15),
    boxG(0.22 * scale, 0.2 * scale, 0.26 * scale, 0, -0.14 * scale, 0.05 * scale, 0.25),
  ], false);
  head.add(new THREE.Mesh(skullGeo, skinMat));
  const eyes = new THREE.Mesh(mergeGeometries([
    new THREE.SphereGeometry(0.042 * scale, 8, 8).translate(-0.075 * scale, 0.03 * scale, 0.16 * scale),
    new THREE.SphereGeometry(0.042 * scale, 8, 8).translate(0.075 * scale, 0.03 * scale, 0.16 * scale),
  ], false), eyeMat);
  head.add(eyes);
  const jaw = new THREE.Mesh(boxG(0.16 * scale, 0.08 * scale, 0.2 * scale, 0, -0.2 * scale, 0.09 * scale, 0.2), skinMat);
  head.add(jaw);

  // 手臂
  const mkArm = (side) => {
    const g = new THREE.Group();
    g.position.set(0.3 * scale * side, shoulderY - hipY, 0);
    const geo = mergeGeometries([
      capG(0.085 * scale, 0.3 * scale, 7),
      capG(0.07 * scale, 0.3 * scale, 7).translate(0, -0.42 * scale, 0),
      // 爪
      boxG(0.05 * scale, 0.2 * scale, 0.05 * scale, 0, -0.62 * scale, 0.02, 0.3),
      boxG(0.05 * scale, 0.2 * scale, 0.05 * scale, 0, -0.62 * scale, -0.03, -0.2),
      boxG(0.05 * scale, 0.2 * scale, 0.05 * scale, 0.04 * scale, -0.62 * scale, -0.01),
    ], false);
    g.add(new THREE.Mesh(geo, skinMat));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05 * scale, 0.24 * scale, 5), glowMat);
    tip.position.set(0, -0.74 * scale, 0);
    tip.rotation.x = Math.PI;
    g.add(tip);
    body.add(g);
    return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // 腿
  const mkLeg = (side) => {
    const g = new THREE.Group();
    g.position.set(0.16 * scale * side, hipY, 0);
    const geo = mergeGeometries([
      capG(0.1 * scale, 0.34 * scale, 7).translate(0, -0.24 * scale, 0),
      capG(0.08 * scale, 0.34 * scale, 7).translate(0, -0.66 * scale, 0.02 * scale),
      boxG(0.14 * scale, 0.1 * scale, 0.26 * scale, 0, -0.88 * scale, 0.06 * scale),
    ], false);
    g.add(new THREE.Mesh(geo, skinMat));
    root.add(g);
    return g;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  let bossHalo = null;
  if (isBoss) {
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x18232a, roughness: 0.42, metalness: 0.72, envMapIntensity: 0.7 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0x9c8c72, roughness: 0.68, metalness: 0.12 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0x5a3c12, emissive: 0xffb43c, emissiveIntensity: 0.75, roughness: 0.35, metalness: 0.8 });

    // 背部触须（更大、带暗金尖端）
    const tentacles = [];
    const tips = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      for (let k = 0; k < 3; k++) {
        const r0 = (0.16 - k * 0.035) * scale;
        const seg = new THREE.CylinderGeometry(r0 * 0.7, r0, 0.6 * scale, 6);
        seg.rotateX(Math.PI / 2.2);
        seg.rotateY(a);
        seg.translate(Math.cos(a) * (0.22 + k * 0.18) * scale, (0.5 - k * 0.14) * scale, (0.3 + k * 0.26) * scale);
        tentacles.push(seg);
      }
      const tip = new THREE.SphereGeometry(0.05 * scale, 6, 6);
      tip.translate(Math.cos(a) * 0.62 * scale, 0.18 * scale, 0.95 * scale);
      tips.push(tip);
    }
    body.add(new THREE.Mesh(mergeGeometries(tentacles, false), skinMat));
    body.add(new THREE.Mesh(mergeGeometries(tips, false), goldMat));

    // 肩甲与肩刺
    for (const side of [-1, 1]) {
      body.add(new THREE.Mesh(boxG(0.46 * scale, 0.2 * scale, 0.5 * scale, side * 0.36 * scale, shoulderY - hipY + 0.1 * scale, 0, 0, 0, side * 0.16), armorMat));
      body.add(new THREE.Mesh(boxG(0.06 * scale, 0.06 * scale, 0.52 * scale, side * 0.46 * scale, shoulderY - hipY + 0.18 * scale, 0), goldMat));
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06 * scale, 0.42 * scale, 5), boneMat);
      spike.position.set(side * 0.5 * scale, shoulderY - hipY + 0.28 * scale, 0);
      spike.rotation.z = -side * 0.6;
      body.add(spike);
    }

    // 肋骨
    for (let i = 0; i < 3; i++) {
      body.add(new THREE.Mesh(boxG((0.5 - i * 0.07) * scale, 0.05 * scale, 0.05 * scale, 0, (0.35 - i * 0.15) * scale, -0.16 * scale), boneMat));
    }

    // 破损的祭袍下摆
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x111c22, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide });
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.48 * scale, 0.86 * scale, 1.15 * scale, 10, 1, true), clothMat);
    skirt.position.y = -0.25 * scale;
    body.add(skirt);
    // 袍角裂口
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tatter = new THREE.Mesh(new THREE.ConeGeometry(0.1 * scale, 0.5 * scale, 4), clothMat);
      tatter.position.set(Math.cos(a) * 0.78 * scale, -0.78 * scale, Math.sin(a) * 0.78 * scale);
      tatter.rotation.x = Math.PI;
      body.add(tatter);
    }

    // 三叉戟：守潮者的仪式武器
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.028 * scale, 0.035 * scale, 3.3 * scale, 6), armorMat);
    staff.position.set(0.66 * scale, 0.15 * scale, 0.08 * scale);
    staff.rotation.z = 0.07;
    body.add(staff);
    const cross = new THREE.Mesh(boxG(0.5 * scale, 0.06 * scale, 0.06 * scale, 0.66 * scale, 1.82 * scale, 0.08 * scale), goldMat);
    body.add(cross);
    for (const [ox, h] of [[-0.2, 0.5], [0, 0.72], [0.2, 0.5]]) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.045 * scale, h * scale, 5), goldMat);
      prong.position.set((0.66 + ox) * scale, (1.98 + h * 0.35) * scale, 0.08 * scale);
      body.add(prong);
    }

    // 暗金冠环（会缓慢旋转）
    bossHalo = new THREE.Mesh(new THREE.TorusGeometry(0.22 * scale, 0.012 * scale, 6, 24), goldMat);
    bossHalo.rotation.x = Math.PI / 2;
    bossHalo.position.y = 0.3 * scale;
    head.add(bossHalo);

    // 双角 / 头鳍 / 第三只眼
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07 * scale, 0.62 * scale, 5), armorMat);
      horn.position.set(side * 0.2 * scale, 0.28 * scale, 0.02);
      horn.rotation.z = -side * 0.62;
      horn.rotation.x = -0.3;
      head.add(horn);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025 * scale, 0.14 * scale, 5), goldMat);
      tip.position.set(side * 0.37 * scale, 0.52 * scale, 0.02);
      tip.rotation.z = -side * 0.62;
      tip.rotation.x = -0.3;
      head.add(tip);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.09 * scale, 0.5 * scale, 4), skinMat);
      fin.position.set(side * 0.32 * scale, 0.05 * scale, 0.22 * scale);
      fin.rotation.z = -side * 1.1;
      fin.rotation.x = -0.35;
      head.add(fin);
    }
    const third = new THREE.Mesh(new THREE.SphereGeometry(0.045 * scale, 8, 8), eyeMat);
    third.position.set(0, 0.12 * scale, 0.19 * scale);
    head.add(third);

    // 胸口裂纹
    for (const [ox, oy, rz] of [[-0.06, 0.24, 0.4], [0.05, 0.16, -0.5], [-0.02, 0.05, 0.2]]) {
      body.add(new THREE.Mesh(boxG(0.035 * scale, 0.2 * scale, 0.025 * scale, ox * scale, oy * scale, -0.2 * scale, 0, 0, rz), goldMat));
    }

    // 更大、更暗的压迫光环
    aura.scale.setScalar(2.6 * scale);
    aura.material.opacity = 0.16;
    const halo = new THREE.PointLight(def.eye, 3.2, 12, 2);
    halo.position.y = 1.7 * scale;
    root.add(halo);
  }
  if (isBrute) {
    const halo = new THREE.PointLight(def.eye, 2.2, 6, 2);
    halo.position.y = 1.3 * scale;
    root.add(halo);
  }
  return { root, body, head, armL, armR, legL, legR, skinMat, glowMat, eyeMat, core, scale, hipY, neckY, shoulderY, jaw, torso, aura, bossHalo };
}

export class EnemyManager {
  constructor(scene, world, fx, audio, water) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.water = water;
    this.enemies = [];
    this.projectiles = [];
    this.time = 0;
    this.onDeath = null;         // (enemy) => void
    this.onAttackPlayer = null;  // (enemy) => void
    this.onBossSlam = null;      // (enemy, radius) => void
    this.onBossSlamWind = null;  // (enemy, radius) => void
    this.onBossSummon = null;    // (enemy) => void
    this.onBossEnrage = null;    // (enemy) => void
    this.maxEnemies = 14;
  }

  clear() {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies.length = 0;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }

  spawn(typeId, x, y, z, o = {}) {
    const def = ENEMY_TYPES[typeId];
    const isBrute = def.id === 'brute';
    const m = buildEnemyModel(def, isBrute);
    const group = m.root;
    group.position.set(x, y, z);
    this.scene.add(group);
    const e = {
      def, id: typeId, group, m,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      hp: def.hp * (o.hpScale || 1), maxHp: def.hp * (o.hpScale || 1),
      state: 'wander', stateT: 0, attackCd: 0.6 + Math.random() * 0.8, windup: -1,
      phase: Math.random() * 7, wander: new THREE.Vector3(), wanderCd: 0,
      hitFlash: 0, dying: false, deathT: 0, lean: 0, emerged: o.emerge ? 1.3 : 0,
      emergeT: o.emerge ? 1.3 : 0, inWater: false, submerged: false, bobY: 0,
      lastSeen: 0, spitCd: 1.5 + Math.random() * 2.5, radius: def.radius, speedNow: 0,
      avoid: new THREE.Vector3(), avoidT: 0, attackAnim: 0, spottedT: 0,
      pathT: Math.random() * 0.5, pathTarget: null, pathGoalY: 0,
      stuckT: 0, teleportCd: 4,
      boss: !!def.boss, slamCd: 4.2, summonCd: 9, volleyCd: 5.5, slamWind: 0, enraged: false,
    };
    this.enemies.push(e);
    if (o.emerge) {
      e.pos.y = (this.water.surfaceAt(x, z) ?? y) - 1.4;
      group.position.copy(e.pos);
      this.water.splash(x, z, e.pos.y, 1.6);
      this.audio.splash(1.4);
      this.audio.growl(typeId);
    }
    return e;
  }

  /** 射线检测命中区域 */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const e of this.enemies) {
      if (e.dying || e.emerged > 0.6) continue;
      const s = e.def.scale;
      const parts = [
        { part: 'head', c: _v1.set(e.pos.x, e.pos.y + (e.m.neckY + 0.05) * 1.0, e.pos.z), r: 0.26 * s },
        { part: 'body', c: _v2.set(e.pos.x, e.pos.y + e.m.hipY + 0.28 * s, e.pos.z), r: 0.42 * s },
        { part: 'body', c: new THREE.Vector3(e.pos.x, e.pos.y + e.m.hipY + 0.05 * s, e.pos.z), r: 0.4 * s },
        { part: 'leg', c: new THREE.Vector3(e.pos.x, e.pos.y + 0.42 * s, e.pos.z), r: 0.34 * s },
      ];
      for (const p of parts) {
        const t = raySphere(origin, dir, p.c, p.r, maxDist);
        if (t > 0 && (!best || t < best.dist)) {
          best = { enemy: e, part: p.part, dist: t, point: origin.clone().addScaledVector(dir, t) };
        }
      }
    }
    return best;
  }

  damage(e, amount, part, point, dir) {
    if (e.dying || e.emerged > 0.6) return;
    e.hp -= amount;
    e.hitFlash = 0.14;
    e.spottedT = 3;
    const stagger = amount * (e.def.stagger ?? 0.5);
    e.vel.x += dir.x * stagger * 0.5;
    e.vel.z += dir.z * stagger * 0.5;
    this.fx.burst(point || e.pos, e.def.eye, 5, 2, 0.35, 0.05, { grav: 8 });
    this.audio.enemyHit();
    if (e.hp <= 0) {
      e.dying = true;
      e.deathT = 0;
      this.audio.enemyDeath();
      this.fx.burst(e.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), e.def.eye, 18, 3.4, 0.8, 0.07, { grav: 4, up: 0.8 });
      this.onDeath && this.onDeath(e);
    }
  }

  update(dt, player) {
    this.time += dt;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const s = e.def.scale;

      // ---- 死亡 ----
      if (e.dying) {
        e.deathT += dt;
        e.group.position.y -= dt * 0.55;
        e.group.rotation.z = Math.min(1.4, e.deathT * 2.2);
        const op = Math.max(0, 1 - e.deathT / 1.2);
        e.m.skinMat.opacity = op * 0.96;
        e.m.eyeMat.opacity = op;
        e.m.glowMat.emissiveIntensity = 1.7 * op;
        if (Math.random() < dt * 14) {
          this.fx.spawnParticle(e.pos.x, e.pos.y + 0.8, e.pos.z,
            (Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.5) * 1.6, 0.5, e.def.eye, 0.05, { grav: 2 });
        }
        if (e.deathT > 1.3) {
          this.scene.remove(e.group);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      // ---- 命中闪光 ----
      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        e.m.skinMat.emissive.setHex(0xff5533);
        e.m.skinMat.emissiveIntensity = Math.max(0, e.hitFlash * 12);
        if (e.hitFlash <= 0) {
          e.m.skinMat.emissive.setHex(e._enrageVis ? 0x1a0400 : 0x000000);
          e.m.skinMat.emissiveIntensity = e._enrageVis ? 0.4 : 0;
        }
      }

      // ---- 涌水出现 ----
      if (e.emerged > 0) {
        e.emerged -= dt;
        e.pos.y += dt * 1.5;
        e.group.position.copy(e.pos);
        e.group.rotation.z = Math.sin(this.time * 6) * 0.08;
        if (e.emerged <= 0) {
          const g = this.world.groundAt(e.pos.x, e.pos.z, e.pos.y + 1.5, 2.5);
          if (g.found && Math.abs(g.y - e.pos.y) < 1.8) e.pos.y = g.y;
          e.group.rotation.z = 0;
        }
        continue;
      }

      const distXZ = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
      const dy = player.pos.y - e.pos.y;
      const dist3 = Math.hypot(distXZ, dy);
      // 首领不因距离被回收；远处冻结，等玩家接近再苏醒
      if (dist3 > 58 && !e.def.boss) { this.scene.remove(e.group); this.enemies.splice(i, 1); continue; }
      if (e.def.boss && dist3 > 55) { e.group.position.copy(e.pos); continue; }
      e.teleportCd = Math.max(0, e.teleportCd - dt);

      // ---- 水体判定 ----
      const vol = this.water.volumeAt(e.pos.x, e.pos.z);
      const surface = vol ? vol.surface : null;
      const feetBelow = surface !== null && e.pos.y < surface - 0.15;
      const depth = vol ? surface - e.pos.y : 0;
      const deepWater = feetBelow && depth > 1.15;
      e.inWater = feetBelow; e.submerged = deepWater;

      // ---- 面向 ----
      const targetYaw = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
      let yawDelta = targetYaw - e.group.rotation.y;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      e.group.rotation.y += clamp(yawDelta, -dt * 5.5, dt * 5.5);

      // ---- 行为 ----
      const aggro = distXZ < e.def.aggro * (Math.abs(dy) > 3 ? 1.6 : 1) && Math.abs(dy) < 22;
      if (e.spottedT > 0) e.spottedT -= dt;
      let spd = 0;
      const mv = _v1.set(0, 0, 0);

      if (deepWater) {
        // 游泳：浮至水面附近，缓慢接近
        const targetY = surface - 0.42;
        e.pos.y = damp(e.pos.y, targetY, 3.2, dt);
        e.vel.y = 0;
        spd = e.def.swimSpeed;
        mv.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z).normalize();
      } else if (aggro) {
        e.state = 'chase';
        const stopRange = (e.def.ranged ? 8 : 1.7) * s;
        if (Math.abs(dy) > 2.4) {
          // 垂直差：寻找楼梯/坡道接近
          e.pathT -= dt;
          if (e.pathTarget && Math.hypot(e.pathTarget.x - e.pos.x, e.pathTarget.z - e.pos.z) < 1.3
              && Math.abs(e.pathTarget.y - e.pos.y) < 0.9) {
            e.pathTarget = null; e.pathT = Math.min(e.pathT, 0.15);   // 到达路径点，重新规划下一段
          }
          if (e.pathT <= 0 || !e.pathTarget) {
            e.pathT = 0.6 + Math.random() * 0.4;
            e.pathTarget = this.findStairTarget(e, player);
          }
          spd = e.def.speed;
          if (e.pathTarget) {
            mv.set(e.pathTarget.x - e.pos.x, 0, e.pathTarget.z - e.pos.z);
            if (mv.lengthSq() > 0.04) mv.normalize();
          } else {
            mv.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z).normalize();
          }
        } else {
          e.pathTarget = null;
          if (distXZ > stopRange || Math.abs(dy) > 1.6) {
            spd = e.def.speed;
            mv.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z).normalize();
          }
        }
        // 远程攻击
        if (e.def.ranged && e.spitCd <= 0 && distXZ < 18 && Math.abs(dy) < 4 && deepWater === false) {
          e.spitCd = e.def.attackCd + Math.random() * 0.8;
          this.spit(e, player);
        }
        // 近战
        if (!e.def.ranged) {
          if (e.windup < 0 && e.attackCd <= 0 && distXZ < (1.95 * s + 0.6) && Math.abs(dy) < 2.3) {
            e.windup = 0.3;
            e.attackCd = e.def.attackCd;
            this.audio.growl(e.id);
          }
          if (e.windup >= 0) {
            e.windup -= dt;
            if (e.windup <= 0) {
              e.windup = -1;
              e.attackAnim = 0.24;
              if (distXZ < (2.4 * s + 0.7) && Math.abs(dy) < 2.6) {
                this.onAttackPlayer && this.onAttackPlayer(e);
              }
              this.audio.noise ? null : null;
            }
          }
        }
      } else {
        // 游荡
        e.wanderCd -= dt;
        if (e.wanderCd <= 0) {
          e.wander.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).normalize();
          e.wanderCd = 2.4 + Math.random() * 3;
        }
        spd = e.def.speed * 0.32;
        mv.copy(e.wander);
      }
      e.attackCd -= dt;
      e.spitCd -= dt;
      if (e.attackAnim > 0) e.attackAnim -= dt;
      if (e.def.boss) this.updateBossAbilities(e, dt, player, distXZ, dy);

      // 卡死/无法跨层兜底：一段时间内既没靠近也到不了玩家高度 → 在玩家附近重新出现
      const reachedLayer = Math.abs(dy) < 2.6;
      const makingProgress = distXZ < (e.lastDist ?? Infinity) - 0.05;
      e.lastDist = distXZ;
      if (aggro && (!reachedLayer || !makingProgress)) e.stuckT += dt;
      else e.stuckT = Math.max(0, e.stuckT - dt * 1.5);
      if (e.stuckT > 5 && e.teleportCd <= 0) {
        // 只在该敌人不在玩家视野正中时重定位，避免“瞬移”穿帮
        const toE = _v2.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z).normalize();
        const fwd = player.lookDirection ? player.lookDirection(_v1) : _v1.set(0, 0, -1);
        const visible = (toE.x * fwd.x + toE.z * fwd.z) < -0.55 && distXZ < 24;
        if (!visible) {
          const spot = this.world.randomSpot(Math.random, player.pos.x, player.pos.z, 11, 22, player.pos.y);
          if (spot && Math.abs(spot.y - player.pos.y) < 2.6) {
            const vol = this.water.volumeAt(spot.x, spot.z);
            if (vol && spot.y < vol.surface) {
              this.water.splash(spot.x, spot.z, spot.y, 1.4);
              this.audio.splash(1.2);
            }
            e.pos.set(spot.x, spot.y + 0.05, spot.z);
            e.vel.set(0, 0, 0);
            e.group.position.copy(e.pos);
            e.stuckT = 0;
            e.teleportCd = 6;
            e.pathTarget = null;
          }
        }
      }

      // 避障：撞墙后沿墙面切向滑行（而不是原路反弹）
      e.avoidT -= dt;
      if (e.avoidT > 0) {
        mv.addScaledVector(e.avoid, 2.2).normalize();
      }
      // 分离
      for (const o of this.enemies) {
        if (o === e || o.dying) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.4 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          mv.x += dx / d * 0.5; mv.z += dz / d * 0.5;
        }
      }
      if (mv.lengthSq() > 0.001) mv.normalize();

      e.vel.x += (mv.x * spd - e.vel.x) * Math.min(1, dt * 6);
      e.vel.z += (mv.z * spd - e.vel.z) * Math.min(1, dt * 6);
      if (!deepWater) {
        e.vel.y -= 22 * dt;
        e.vel.y = Math.max(-30, e.vel.y);
      }

      const out = {};
      _v2.set(e.vel.x * dt, e.vel.y * dt, e.vel.z * dt);
      this.world.moveAndCollide(e.pos, _v2, e.radius, 1.75 * s, 0.7, out);
      if (out.grounded) {
        e.vel.y = 0;
        e.vel.x *= 0.92; e.vel.z *= 0.92;
        // 台阶/矮墙：尝试跨过
      }
      if ((out.hitX || out.hitZ) && e.avoidT <= 0) {
        const nx = out.nx || 0, nz = out.nz || 0;
        let tx = -nz, tz = nx;                       // 墙面切向
        if (tx * mv.x + tz * mv.z < 0) { tx = -tx; tz = -tz; }   // 取与目标方向一致的一侧
        if (Math.abs(tx) + Math.abs(tz) < 0.01) { tx = 1; tz = 0; }
        e.avoid.set(tx, 0, tz).normalize();
        e.avoidT = 0.7;
      }
      // 深水
      if (deepWater) {
        e.vel.x *= 0.9; e.vel.z *= 0.9;
      }

      // ---- 动画 ----
      const spdNow = Math.hypot(e.vel.x, e.vel.z);
      e.speedNow = spdNow;
      e.phase += dt * (2.0 + spdNow * 1.9);
      const m = e.m;
      e.lean = damp(e.lean, deepWater ? 1.15 : (aggro ? 0.32 : 0.05), 4, dt);
      m.body.rotation.x = e.lean;
      const swim = deepWater ? 1 : 0;
      m.body.position.y = m.hipY + Math.sin(e.phase * 2) * 0.03 + swim * 0.25;
      m.head.rotation.z = Math.sin(e.phase) * 0.06;
      m.head.rotation.x = -e.lean * 0.6 + Math.sin(e.phase * 2 + 0.6) * 0.03;
      const swing = Math.sin(e.phase * 2) * (spdNow > 0.4 ? 0.7 : 0.1);
      if (e.windup >= 0) {
        const wt = 1 - Math.max(0, e.windup) / 0.3;
        m.armR.rotation.x = -2.5 * wt;
        m.armL.rotation.x = -0.5 * wt;
      } else if (e.attackAnim > 0) {
        const k = e.attackAnim / 0.24;
        m.armR.rotation.x = 1.5 * k;
        m.armL.rotation.x = 1.0 * k;
      } else {
        m.armR.rotation.x = -swing - (aggro ? 0.35 : 0.08) - swim * 0.6;
        m.armL.rotation.x = swing - (aggro ? 0.35 : 0.08) - swim * 0.6;
      }
      m.armR.rotation.z = 0.16 * (aggro ? 1.4 : 1);
      m.armL.rotation.z = -0.16 * (aggro ? 1.4 : 1);
      const legSwing = deepWater ? Math.sin(e.phase * 2) * 0.25 : swing;
      m.legL.rotation.x = legSwing;
      m.legR.rotation.x = -legSwing;
      m.legL.rotation.z = 0.04;
      m.legR.rotation.z = -0.04;
      if (e.def.boss && e.slamWind > 0) {
        m.armR.rotation.x = -2.7;
        m.armL.rotation.x = -2.5;
      }

      // 首领：冠环旋转、呼吸光、半血变色
      if (e.def.boss) {
        if (m.bossHalo) m.bossHalo.rotation.z += dt * (e.enraged ? 2.3 : 0.7);
        m.glowMat.emissiveIntensity = e.enraged ? 3.4 : 2.0 + Math.sin(this.time * 2.4) * 0.45;
        if (e.enraged && !e._enrageVis) {
          e._enrageVis = true;
          m.glowMat.emissive.setHex(0xff5a20);
          m.eyeMat.emissive.setHex(0xff3a1a);
          m.skinMat.emissive.setHex(0x1a0400);
          m.skinMat.emissiveIntensity = 0.4;
          if (m.aura) m.aura.material.color.setHex(0xff5a30);
        }
      }

      // 侧倾
      e.group.rotation.z = damp(e.group.rotation.z, swim ? 0 : Math.sin(e.phase) * (aggro ? 0.05 : 0.02), 5, dt);

      const bob = (!deepWater && spdNow > 0.4) ? Math.abs(Math.sin(e.phase)) * 0.045 : 0;
      e.group.position.set(e.pos.x, e.pos.y + bob, e.pos.z);
      // 模型朝向与 group.rotation.y 一致（lookAt 由 rotation.y 控制）
    }

    // ---- 喷吐物 ----
    this.updateProjectiles(dt, player);
  }

  updateBossAbilities(e, dt, player, dist, dy) {
    if (dist > 58 || Math.abs(dy) > 14) return;
    const def = e.def;
    e.slamCd -= dt; e.summonCd -= dt; e.volleyCd -= dt;

    // 半血狂暴
    if (!e.enraged && e.hp < e.maxHp * 0.4) {
      e.enraged = true;
      e.slamCd = 1.2;
      this.audio.bossRoar();
      this.onBossEnrage && this.onBossEnrage(e);
    }

    // 地面重击：蓄力 0.7s 后释放环形冲击
    if (e.slamWind > 0) {
      e.slamWind -= dt;
      e.m.armR.rotation.x = -2.8;
      e.m.armL.rotation.x = -2.8;
      if (e.slamWind <= 0) {
        this.audio.bossSlam();
        this.onBossSlam && this.onBossSlam(e, 8.5);
        e.slamCd = e.enraged ? 5.0 : 7.5;
      }
    } else if (e.slamCd <= 0 && dist < 9.5 && Math.abs(dy) < 5) {
      e.slamWind = 0.7;
      this.audio.growl('brute');
      this.onBossSlamWind && this.onBossSlamWind(e, 8.5);
    }

    // 召唤溺影
    if (e.summonCd <= 0 && dist < 45) {
      e.summonCd = 15;
      let n = 0;
      for (let i = 0; i < 10 && n < 2; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
        const r = 1.5 + Math.random() * 2.6;
        const x = e.pos.x + Math.cos(a) * r, z = e.pos.z + Math.sin(a) * r;
        const g = this.world.groundAt(x, z, e.pos.y + 3, 4);
        if (!g.found || Math.abs(g.y - e.pos.y) > 4) continue;
        if (this.world.blocked(x, g.y + 0.1, z, 0.45, 1.7)) continue;
        this.spawn('drowned', x, g.y + 0.05, z);
        n++;
      }
      if (n > 0) this.onBossSummon && this.onBossSummon(e);
    }

    // 扇形喷吐
    if (e.volleyCd <= 0 && dist < 38 && dist > 3.5) {
      e.volleyCd = e.enraged ? 6 : 9;
      this.spitFan(e, player, e.enraged ? 7 : 5);
    }
  }

  spitFan(e, player, count = 5) {
    const def = e.def;
    const origin = new THREE.Vector3(e.pos.x, e.pos.y + 1.6 * def.scale, e.pos.z);
    const target = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    const base = target.sub(origin).normalize();
    const spread = 0.23;
    for (let i = 0; i < count; i++) {
      const a = (i - (count - 1) / 2) * spread;
      const dir = base.clone();
      const cos = Math.cos(a), sin = Math.sin(a);
      const dx = dir.x * cos - dir.z * sin;
      const dz = dir.x * sin + dir.z * cos;
      dir.x = dx; dir.z = dz;
      dir.y += (Math.random() - 0.5) * 0.03;
      dir.normalize();
      this._spawnProjectile(origin, dir, def, 22, def.damage * 0.7, 1.2);
    }
    this.audio.spit();
  }

  _spawnProjectile(origin, dir, def, speed, damage, size = 1) {
    const geo = new THREE.IcosahedronGeometry(0.16 * size, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a2a10, emissive: def.eye, emissiveIntensity: 1.8, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel: dir.clone().multiplyScalar(speed), t: 0, damage, def });
    return mesh;
  }

  spit(e, player) {
    const def = e.def;
    const origin = new THREE.Vector3(e.pos.x, e.pos.y + 1.35 * def.scale, e.pos.z);
    const target = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    const dir = target.sub(origin).normalize();
    dir.x += (Math.random() - 0.5) * 0.05;
    dir.y += (Math.random() - 0.5) * 0.05;
    dir.z += (Math.random() - 0.5) * 0.05;
    dir.normalize();
    this._spawnProjectile(origin, dir, def, def.projectileSpeed, def.damage, 1);
    this.audio.spit();
  }

  updateProjectiles(dt, player) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      p.vel.y -= 8 * dt;
      const step = _v2.copy(p.vel).multiplyScalar(dt);
      const from = p.mesh.position.clone();
      const hit = this.world.raycast(from, _v1.copy(p.vel).normalize(), step.length());
      let hitPlayer = false;
      const pd = p.mesh.position.distanceTo(player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
      if (pd < 0.9) hitPlayer = true;

      if (hit.hit || hitPlayer || p.t > 4) {
        if (hitPlayer) this.onProjectileHit && this.onProjectileHit(p);
        else if (hit.hit) {
          this.fx.burst(hit.point, p.def.eye, 8, 2.2, 0.4, 0.05, { grav: 8 });
        }
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }
      p.mesh.position.add(step);
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 4;
    }
  }

  /** 找最近的、能把该敌人带向玩家高度的楼梯路径点 */
  findStairTarget(e, player) {
    const ramps = this.world.stairRamps;
    if (!ramps || !ramps.length) return null;
    const dy = player.pos.y - e.pos.y;
    // 1) 已经站在坡道上：直接朝该坡道通往玩家方向的一端走
    for (const r of ramps) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (Math.hypot(cx - e.pos.x, cz - e.pos.z) > 2.5) continue;
      if (!r.containsXZ(e.pos.x, e.pos.z, 0.45)) continue;
      const rh = r.heightAt(e.pos.x, e.pos.z);
      if (Math.abs(rh - e.pos.y) > 1.0) continue;              // 只有真正站在坡上才进入攀爬模式
      const e0 = this.rampEnd(r, r.a0), e1 = this.rampEnd(r, r.a1);
      const hi = e0.y > e1.y ? e0 : e1;
      const lo = e0.y > e1.y ? e1 : e0;
      const tgt = dy > 0 ? hi : lo;
      return { x: tgt.x, z: tgt.z, y: tgt.y };
    }
    // 2) 选择入口高度接近自身、且通往玩家高度的坡道端
    let best = null, bestScore = Infinity;
    for (const r of ramps) {
      const dx = (r.x0 + r.x1) / 2 - e.pos.x, dz = (r.z0 + r.z1) / 2 - e.pos.z;
      if (dx * dx + dz * dz > 34 * 34) continue;
      const e0 = this.rampEnd(r, r.a0), e1 = this.rampEnd(r, r.a1);
      const entries = [
        { x: e0.x, z: e0.z, y: e0.y, otherY: e1.y, otherX: e1.x, otherZ: e1.z },
        { x: e1.x, z: e1.z, y: e1.y, otherY: e0.y, otherX: e0.x, otherZ: e0.z },
      ];
      for (const en of entries) {
        if (Math.abs(en.y - e.pos.y) > 1.4) continue;            // 入口必须可达
        if (Math.abs(en.otherY - en.y) < 1.5) continue;          // 太矮的坡（滩涂）不作为跨层路径
        if (en.y < -0.25 && e.pos.y > -0.25) continue;           // 不主动下水
        const vol = this.water.volumeAt(en.x, en.z);
        if (vol && vol.surface - en.y > 0.6) continue;           // 入口在水下则跳过
        const dirOk = dy > 0 ? en.otherY > en.y + 0.5 : en.otherY < en.y - 0.5;
        if (!dirOk) continue;
        const dEn = Math.hypot(en.x - e.pos.x, en.z - e.pos.z);
        const score = dEn + Math.abs(en.otherY - player.pos.y) * 0.4;
        if (score < bestScore) {
          bestScore = score;
          // 目标稍微进入坡道内部
          best = { x: en.x + (en.otherX - en.x) * 0.18, z: en.z + (en.otherZ - en.z) * 0.18, y: en.y };
        }
      }
    }
    return best;
  }
  rampEnd(r, a) {
    if (r.axis === 'z') return { x: (r.x0 + r.x1) / 2, z: a, y: a === r.a0 ? r.y0 : r.y1 };
    return { x: a, z: (r.z0 + r.z1) / 2, y: a === r.a0 ? r.y0 : r.y1 };
  }

  countAlive() { return this.enemies.filter(e => !e.dying).length; }
}

void lerp; void Y1;