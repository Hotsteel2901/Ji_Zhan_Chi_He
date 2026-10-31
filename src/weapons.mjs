// ============================================================
//  枪械：精细程序化模型 / 弹道 / 后坐力 / ADS / 换弹 / 三种武器
// ============================================================
import * as THREE from 'three';
import { GUNS, GUN_ORDER } from './config.mjs';
import { clamp, damp, glowTexture } from './util.mjs';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _v = new THREE.Vector3();

export class WeaponSystem {
  constructor(camera, scene, world, water, fx, audio) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;
    this.water = water;
    this.fx = fx;
    this.audio = audio;
    this.onHitmark = null;     // (head, kill) => void
    this.onKillFeed = null;    // (weaponDef, enemyType, head) => void
    this.onAmmoChange = null;
    this.player = null;        // 由 game 注入
    this.enemies = null;

    this.slots = {
      smg: { def: GUNS.smg, ammo: GUNS.smg.magSize, reserve: GUNS.smg.reserve, unlocked: true, reloadT: 0, reloading: false, reloadShell: false, cooldown: 0, pumpT: 0, bloom: 0, shotsFired: 0 },
      rifle: { def: GUNS.rifle, ammo: 0, reserve: 0, unlocked: false, reloadT: 0, reloading: false, reloadShell: false, cooldown: 0, pumpT: 0, bloom: 0, shotsFired: 0 },
      shotgun: { def: GUNS.shotgun, ammo: 0, reserve: 0, unlocked: false, reloadT: 0, reloading: false, reloadShell: false, cooldown: 0, pumpT: 0, bloom: 0, shotsFired: 0 },
      rail: { def: GUNS.rail, ammo: 0, reserve: 0, unlocked: false, reloadT: 0, reloading: false, reloadShell: false, cooldown: 0, pumpT: 0, bloom: 0, shotsFired: 0 },
    };
    // 碎片 / 共鸣带来的武器系数
    this.damageMult = 1;
    this.fireRateMult = 1;
    this.reloadMult = 1;
    this.headBonus = 0;
    this.currentId = 'smg';
    this.time = 0;
    this.kick = 0;          // 视觉后坐
    this.kickRot = 0;
    this.recoverPitch = 0;  // 待回落的相机后坐量
    this.recoverYaw = 0;
    this.onLookDelta = null; // (dpitch, dyaw) 由 game 注入
    this.onShake = null;     // (amount) 由 game 注入
    this.sway = new THREE.Vector2();
    this.switchT = 0;
    this.lastFire = -99;
    this.aimK = 0;
    this.wasAiming = false;
    this.models = {};
    for (const id of GUN_ORDER) {
      const m = buildGunModel(id);
      m.group.visible = false;
      camera.add(m.group);
      this.models[id] = m;
    }
    this.flashTex = glowTexture('rgba(255,255,245,1)', 'rgba(255,190,90,0.5)');
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flash.scale.set(0.5, 0.5, 1);
    this.flash.visible = false;
    scene.add(this.flash); // 世界空间（跟随枪口）
    this.flashLight = new THREE.PointLight(0xffc070, 0, 12, 2);
    scene.add(this.flashLight);
    this.flashT = 0;
    this.ejectAcc = 0;
    // 只照枪械的视角补光（layer 1）
    this.viewLight = new THREE.PointLight(0xdff0ff, 0.6, 3.4, 2);
    this.viewLight.layers.set(1);
    this.viewLight.position.set(0.28, 0.18, -0.24);
    camera.add(this.viewLight);
    this.rimLight = new THREE.PointLight(0x5fd8ff, 0.32, 2.6, 2);
    this.rimLight.layers.set(1);
    this.rimLight.position.set(-0.35, 0.05, -0.35);
    camera.add(this.rimLight);
  }

  get def() { return this.slots[this.currentId].def; }
  get slot() { return this.slots[this.currentId]; }

  unlock(id) {
    const s = this.slots[id];
    if (!s) return false;
    const isNew = !s.unlocked;
    s.unlocked = true;
    s.ammo = s.def.magSize;
    s.reserve = s.def.reserve;
    if (isNew) this.onAmmoChange && this.onAmmoChange();
    return isNew;
  }
  addAmmo(amount) {
    const s = this.slot;
    s.reserve = Math.min(s.def.maxReserve, s.reserve + amount);
    this.onAmmoChange && this.onAmmoChange();
  }
  addAmmoAll(amount) {
    for (const id of GUN_ORDER) {
      const s = this.slots[id];
      if (!s.unlocked) continue;
      const amt = id === 'rail' ? Math.max(1, Math.round(amount * 0.14)) : amount;
      s.reserve = Math.min(s.def.maxReserve, s.reserve + amt);
    }
    this.onAmmoChange && this.onAmmoChange();
  }

  switchTo(id) {
    if (id === this.currentId || !this.slots[id] || !this.slots[id].unlocked) return false;
    if (this.slot.reloading) this.cancelReload();
    this.currentId = id;
    this.switchT = 0.45;
    this.kick = 0.6;
    this.audio.reloadStep(1);
    this.onAmmoChange && this.onAmmoChange();
    return true;
  }
  nextWeapon(dir = 1) {
    const unlocked = GUN_ORDER.filter(id => this.slots[id].unlocked);
    if (unlocked.length < 2) return false;
    const i = unlocked.indexOf(this.currentId);
    return this.switchTo(unlocked[(i + dir + unlocked.length) % unlocked.length]);
  }

  startReload() {
    const s = this.slot;
    if (s.reloading || s.ammo >= s.def.magSize || s.reserve <= 0) return;
    s.reloading = true;
    s.reloadShell = s.def.kind === 'pump';
    s.reloadT = (s.reloadShell ? 0.55 : s.def.reloadTime) * this.reloadMult;
    s.reloadStep = 0;
    this.audio.reloadStep(0);
    this.onAmmoChange && this.onAmmoChange();
  }
  cancelReload() {
    const s = this.slot;
    s.reloading = false;
    s.reloadT = 0;
    this.onAmmoChange && this.onAmmoChange();
  }

  // ----------------------------------------------------------
  fire() {
    const s = this.slot, def = s.def;
    const p = this.player;
    if (!p || p.dead) return;
    if (s.reloading) {
      if (s.reloadShell && s.ammo > 0) this.cancelReload();
      else return;
    }
    if (s.cooldown > 0 || this.switchT > 0.3) return;
    if (s.ammo <= 0) {
      this.audio.dryFire();
      this.startReload();
      s.cooldown = 0.25;
      return;
    }
    s.ammo--;
    s.cooldown = (60 / def.rpm) / Math.max(0.25, this.fireRateMult);
    s.shotsFired++;
    this.onAmmoChange && this.onAmmoChange();

    // 后坐力：立即上跳 + 随时间回落
    const adsK = this.aimK;
    const kickScale = adsK > 0.5 ? 0.72 : 1;
    this.kick = Math.min(2.6, this.kick + def.kick);
    this.kickRot = Math.min(0.22, this.kickRot + def.recoilV * 0.014 * kickScale);
    const pitchKick = def.recoilV * 0.0042 * kickScale * (0.8 + Math.random() * 0.4);
    const yawKick = def.recoilH * 0.0034 * kickScale * (Math.random() * 2 - 1);
    this.recoverPitch += pitchKick;
    this.recoverYaw += yawKick;
    if (this.onLookDelta) this.onLookDelta(pitchKick, yawKick);
    s.bloom = Math.min(def.bloomMax, s.bloom + def.bloomPerShot);

    // 音效 / 枪口
    this.audio.gunshot(def.id);
    this.flashT = def.rail ? 0.13 : 0.055;
    if (def.rail) {
      this.kick = Math.min(4.2, this.kick + 1.6);
      if (this.onShake) this.onShake(0.7);
    }
    this.models[this.currentId].slideOffset = 1;
    this.ejectShell();

    // 弹道
    const submerged = p.submerged;
    const spreadBase = (adsK > 0.5 ? def.adsSpread : def.spread) * (p.onGround ? 1 : 1.6) + s.bloom;
    const pellets = def.pellets || 1;
    p.lookDirection(_dir);
    _origin.copy(this.camera.position);

    for (let i = 0; i < pellets; i++) {
      const dir = _dir.clone();
      if (pellets > 1) {
        dir.x += (Math.random() - 0.5) * spreadBase * 2;
        dir.y += (Math.random() - 0.5) * spreadBase * 2;
        dir.z += (Math.random() - 0.5) * spreadBase * 2;
      } else {
        dir.x += (Math.random() - 0.5) * spreadBase * 2;
        dir.y += (Math.random() - 0.5) * spreadBase * 2;
      }
      dir.normalize();
      this.castBullet(_origin, dir, def, submerged);
    }
    if (pellets > 1) this.audio.gunshot('shotgun');
  }

  castBullet(origin, dir, def, submerged) {
    let remainingRange = def.range * (submerged ? 0.35 : 1);
    let damage = def.damage * this.damageMult;
    let pen = def.penetration;
    let start = origin.clone();
    let underwater = submerged;
    const maxSegments = def.rail ? 5 : 3;

    for (let seg = 0; seg < maxSegments; seg++) {
      const solid = this.world.raycast(start, dir, remainingRange);
      const enemyHit = this.enemies ? this.enemies.raycast(start, dir, remainingRange) : null;
      // 空中射击时检测水面入射；已在水下则无水面可穿
      const liquid = underwater ? null : this.water.raycast(start, dir, remainingRange);
      const waterEntry = liquid && liquid.t > 0.05 ? liquid : null;

      let nearest = 'none';
      let t = remainingRange;
      if (solid.hit && solid.t < t) { nearest = 'solid'; t = solid.t; }
      if (enemyHit && enemyHit.dist < t) { nearest = 'enemy'; t = enemyHit.dist; }
      if (waterEntry && waterEntry.t < t) { nearest = 'water'; t = waterEntry.t; }

      if (nearest === 'none') {
        this.tracerTo(start.clone().addScaledVector(dir, remainingRange), def);
        return;
      }
      const point = start.clone().addScaledVector(dir, t);

      if (nearest === 'water') {
        this.water.bulletImpact(waterEntry.point, 1);
        this.fx.spawnParticle(waterEntry.point.x, waterEntry.point.y - 0.1, waterEntry.point.z, dir.x * 2, -1.5, dir.z * 2, 0.5, 0xa8dcf0, 0.04, { grav: 2, buoy: 4, drag: 1.2 });
        this.tracerTo(waterEntry.point, def);
        // 入水后：减速 + 伤害衰减，继续一段
        underwater = true;
        damage *= 0.55;
        remainingRange = Math.min(remainingRange - t, 7);
        start = waterEntry.point.clone().addScaledVector(dir, 0.05);
        if (remainingRange < 0.5) return;
        continue;
      }

      if (nearest === 'enemy') {
        const before = enemyHit.enemy.hp;
        const dmg = damage * (underwater ? 0.7 : 1);
        const partMult = enemyHit.part === 'head' ? def.headMult * (1 + this.headBonus) : enemyHit.part === 'leg' ? def.legMult : 1;
        const dealt = dmg * partMult;
        this.enemies.damage(enemyHit.enemy, dealt, enemyHit.part, point, dir);
        const killed = before > 0 && enemyHit.enemy.hp <= 0;
        this.fx.damageNumber(point, dealt, { head: enemyHit.part === 'head', kill: killed });
        this.fx.burst(point, enemyHit.enemy.def.eye, def.rail ? 14 : 6, def.rail ? 4.2 : 2.4, 0.38, def.rail ? 0.07 : 0.05, { grav: 7 });
        this.tracerTo(point, def);
        this.onHitmark && this.onHitmark(enemyHit.part === 'head', killed);
        if (killed) this.onKillFeed && this.onKillFeed(def, enemyHit.enemy, enemyHit.part === 'head');
        this.audio.hitmark(enemyHit.part === 'head');
        return;
      }

      // 命中实体
      const mat = solid.tag || 'tile';
      this.fx.impact(solid.point, solid.normal, mat === 'metal' ? 0.8 : 1, mat);
      this.fx.burst(solid.point, def.rail ? 0x9fe8ff : mat === 'metal' ? 0xffd9a0 : 0xd8d2c4, mat === 'metal' ? 8 : 6, 2.6, 0.3, 0.045, { grav: 12 });
      this.tracerTo(solid.point, def);
      if (mat === 'metal') this.audio.noise(0.06, 0.1, { freq: 2600, q: 3 });
      else this.audio.noise(0.05, 0.07, { freq: 1400, q: 2 });

      // 穿透
      if (pen > 0 && !underwater) {
        const width = solidHitWidth(solid);
        if (width < (def.penWidth ?? 0.75)) {
          pen--;
          damage *= def.rail ? 0.86 : 0.62;
          remainingRange -= t;
          start = solid.point.clone().addScaledVector(dir, width + 0.06);
          if (remainingRange < 0.5) return;
          continue;
        }
      }
      return;
    }
  }

  tracerTo(point, def) {
    const from = this.muzzleWorld();
    if (def && def.rail && this.fx.railBeam) this.fx.railBeam(from, point, 0x9fe8ff);
    else this.fx.tracer(from, point, def && def.rail ? 0x9fe8ff : 0xffe0a0);
  }

  ejectShell() {
    const m = this.models[this.currentId];
    m.eject.getWorldPosition(_v);
    this.fx.ejectShell(_v, this.camera.quaternion, this.def.kind === 'shotgun' ? 3 : 2.2);
  }

  muzzleWorld() {
    const m = this.models[this.currentId];
    if (m) m.muzzle.getWorldPosition(_muzzle);
    else _muzzle.copy(this.camera.position);
    return _muzzle.clone();
  }

  // ----------------------------------------------------------
  update(dt, input, enemies) {
    this.time += dt;
    this.enemies = enemies;
    const s = this.slot, def = s.def;
    const p = this.player;
    this.switchT = Math.max(0, this.switchT - dt);
    s.cooldown = Math.max(0, s.cooldown - dt);
    if (s.pumpT > 0) s.pumpT = Math.max(0, s.pumpT - dt);

    // 换弹
    if (s.reloading) {
      s.reloadT -= dt;
      if (s.reloadShell) {
        if (s.reloadT <= 0) {
          if (s.ammo < def.magSize && s.reserve > 0) {
            s.ammo++; s.reserve--; s.reloadStep++;
            this.audio.reloadStep(s.reloadStep);
            this.onAmmoChange && this.onAmmoChange();
            if (s.ammo < def.magSize && s.reserve > 0) s.reloadT = 0.55 * this.reloadMult;
            else { s.reloading = false; this.audio.reloadDone(); }
          } else { s.reloading = false; }
        }
      } else if (s.reloadT <= 0) {
        const take = Math.min(def.magSize - s.ammo, s.reserve);
        s.ammo += take; s.reserve -= take;
        s.reloading = false;
        this.audio.reloadDone();
        this.onAmmoChange && this.onAmmoChange();
      }
    }

    // 开火
    const wantFire = !!(input.fire && p && !p.dead);
    if (wantFire) {
      if (def.kind === 'pump') {
        if (s.pumpT <= 0 && s.cooldown <= 0) {
          this.fire();
          if (s.ammo > 0) s.pumpT = 0.62;
          else s.pumpT = 0.3;
        }
      } else {
        this.fire();
      }
    }
    if (!wantFire) s.bloom = Math.max(0, s.bloom - dt * 0.09);

    // 瞄准
    const aiming = input.aim && !p?.dead && !p?.submerged && this.switchT <= 0.2;
    this.aimK = damp(this.aimK, aiming ? 1 : 0, 12, dt);
    if (aiming !== this.wasAiming) { this.wasAiming = aiming; }

    // 相机后坐力回落
    this.recoverPitch = Math.max(0, this.recoverPitch);
    if (this.recoverPitch > 0 || Math.abs(this.recoverYaw) > 0) {
      const rate = aiming ? 2.6 : 3.6;
      const backP = Math.min(this.recoverPitch, dt * rate);
      const backY = clamp(this.recoverYaw, -dt * rate * 0.5, dt * rate * 0.5);
      if (this.onLookDelta) this.onLookDelta(-backP * 0.9, -backY);
      this.recoverPitch -= backP;
      this.recoverYaw -= backY;
    }

    // 模型动画
    const m = this.models[this.currentId];
    if (!m) return;
    for (const id of GUN_ORDER) this.models[id].group.visible = id === this.currentId && !p?.dead;
    if (!p) return;

    const braking = p.onGround && p.speedNow > 0.5;
    const bob = braking ? Math.sin(p.bobPhase) * (p.input.sprint ? 0.016 : 0.01) : 0;
    const bobV = braking ? Math.cos(p.bobPhase * 2) * 0.008 : 0;
    this.sway.x = damp(this.sway.x, clamp(-p.input.strafe * 0.012, -0.03, 0.03), 8, dt);
    this.sway.y = damp(this.sway.y, clamp(p.vel.y * 0.004, -0.02, 0.02), 8, dt);

    this.kick = damp(this.kick, 0, 11, dt);
    this.kickRot = damp(this.kickRot, 0, 10, dt);

    const ads = this.aimK;
    const basePos = m.basePos;
    const adsPos = m.adsPos;
    const sprintK = (p.input.sprint && p.speedNow > 5 && p.onGround) ? 1 : 0;
    const reloadK = s.reloading ? 1 : 0;
    const reloadDip = reloadK ? Math.sin(clamp(1 - Math.max(0, s.reloadT) / (def.kind === 'pump' ? 0.55 : def.reloadTime), 0, 1) * Math.PI) : 0;
    const switchK = this.switchT > 0 ? Math.sin(clamp(this.switchT / 0.45, 0, 1) * Math.PI) : 0;

    const tp = {
      x: basePos.x + (adsPos.x - basePos.x) * ads + bob + this.sway.x - sprintK * 0.06,
      y: basePos.y + (adsPos.y - basePos.y) * ads + bobV + this.sway.y - reloadDip * 0.16 - switchK * 0.3,
      z: basePos.z + (adsPos.z - basePos.z) * ads + this.kick * 0.045,
    };
    m.group.position.set(tp.x, tp.y, tp.z);
    m.group.rotation.set(
      this.kickRot * 0.9 - reloadDip * 0.85 - switchK * 0.4,
      -(1 - ads) * 0.04 + switchK * 0.3,
      reloadDip * 0.3 + (1 - ads) * 0.015,
    );
    // 枪机/泵动
    if (m.slide) {
      m.slideOffset = damp(m.slideOffset || 0, 0, 16, dt);
      m.slide.position.z = m.slideZ + m.slideOffset * (def.kind === 'pump' ? 0.05 : 0.035);
    }
    if (m.pump && s.pumpT > 0) {
      const k = Math.sin((1 - s.pumpT / 0.62) * Math.PI);
      m.pump.position.z = m.pumpZ - k * 0.06;
    } else if (m.pump) m.pump.position.z = damp(m.pump.position.z, m.pumpZ, 14, dt);

    // 枪口火光
    if (this.flashT > 0) {
      this.flashT -= dt;
      const mp = this.muzzleWorld();
      this.flash.position.copy(mp);
      this.flash.scale.setScalar(0.34 + Math.random() * 0.3);
      this.flash.visible = true;
      this.flash.material.rotation = Math.random() * 6.28;
      this.flashLight.position.copy(mp);
      this.flashLight.intensity = 26;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}

function solidHitWidth(solid) {
  const n = solid.normal;
  const c = solid.collider;
  if (!c || c.ramp) return 0.3;
  if (Math.abs(n.x) > 0.5) return c.maxX - c.minX;
  if (Math.abs(n.y) > 0.5) return c.maxY - c.minY;
  return c.maxZ - c.minZ;
}

// ============================================================
//  程序化枪械模型
// ============================================================
function buildGunModel(kind) {
  const def = GUNS[kind];
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x4b565e, roughness: 0.32, metalness: 0.78 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x323b42, roughness: 0.58, metalness: 0.4 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x20272e, roughness: 0.72, metalness: 0.16 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x1a3d49, emissive: 0x2fe0f5, emissiveIntensity: 1.25, roughness: 0.4 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa8843c, roughness: 0.35, metalness: 0.9 });

  const add = (geo, mat, x = 0, y = 0, z = 0, o = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    group.add(m);
    return m;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (r, h, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg);

  let slide = null, pump = null, slideZ = 0, pumpZ = 0;
  let barrelLen = 0.42, muzzleZ = -0.5, caliber = 0.02;
  const railTeeth = [];

  if (kind === 'smg') {
    barrelLen = 0.3; muzzleZ = -0.46; caliber = 0.018;
    // 机匣
    add(B(0.075, 0.085, 0.34), steel, 0, 0.035, -0.08);
    add(B(0.078, 0.02, 0.36), accent, 0, 0.085, -0.08);
    // 上机匣细节
    add(B(0.082, 0.03, 0.1), dark, 0, 0.062, -0.2);
    for (let i = 0; i < 7; i++) railTeeth.push(add(B(0.052, 0.008, 0.012), dark, 0, 0.1, 0.04 - i * 0.035));
    // 护木 + 散热孔
    add(B(0.07, 0.07, 0.2), polymer, 0, 0.03, -0.32);
    for (const sx of [-0.036, 0.036]) for (let i = 0; i < 4; i++) add(C(0.014, 0.012, 6), dark, sx, 0.03, -0.26 - i * 0.04, { rz: Math.PI / 2 });
    // 枪管 + 消焰器
    add(C(caliber, 0.2, 10), steel, 0, 0.03, -0.37, { rx: Math.PI / 2 });
    add(C(0.03, 0.05, 10), steel, 0, 0.03, -0.48, { rx: Math.PI / 2 });
    // 弹匣
    const mag = add(B(0.055, 0.24, 0.09), dark, 0, -0.13, -0.03, { rx: 0.08 });
    mag.userData.mag = true;
    // 握把
    add(B(0.06, 0.19, 0.085), polymer, 0, -0.12, 0.07, { rx: 0.32 });
    add(B(0.064, 0.02, 0.088), accent, 0, -0.05, 0.085, { rx: 0.32 });
    // 扳机护圈 + 扳机
    add(new THREE.TorusGeometry(0.032, 0.006, 6, 12, Math.PI), steel, 0, -0.06, -0.03, { rx: Math.PI / 2 });
    add(B(0.01, 0.045, 0.012), steel, 0, -0.06, -0.025);
    // 枪托（折叠）
    add(B(0.03, 0.05, 0.16), dark, 0, 0.02, 0.16);
    add(B(0.05, 0.1, 0.02), polymer, 0, 0.0, 0.245);
    // 瞄具
    add(B(0.014, 0.03, 0.014), accent, 0, 0.115, -0.24);
    add(B(0.05, 0.018, 0.012), steel, 0, 0.108, 0.1);
    add(C(0.012, 0.02, 8), accent, 0, 0.118, -0.24);
    // 枪机拉柄
    slide = add(B(0.02, 0.018, 0.06), steel, 0.045, 0.065, -0.12);
    slideZ = slide.position.z;
    // 抛壳口
  } else if (kind === 'rifle') {
    barrelLen = 0.55; muzzleZ = -0.64; caliber = 0.021;
    add(B(0.08, 0.09, 0.4), steel, 0, 0.04, -0.1);
    add(B(0.084, 0.02, 0.42), dark, 0, 0.092, -0.1);
    for (let i = 0; i < 9; i++) railTeeth.push(add(B(0.054, 0.009, 0.013), dark, 0, 0.108, 0.06 - i * 0.038));
    // 护木带 M-LOK 槽
    add(B(0.072, 0.075, 0.34), polymer, 0, 0.035, -0.46);
    for (const sx of [-0.038, 0.038]) for (let i = 0; i < 5; i++) add(B(0.01, 0.03, 0.05), dark, sx, 0.03, -0.36 - i * 0.06);
    // 枪管 + 制退器
    add(C(caliber, 0.36, 10), steel, 0, 0.035, -0.46, { rx: Math.PI / 2 });
    add(C(0.032, 0.07, 10), steel, 0, 0.035, -0.68, { rx: Math.PI / 2 });
    for (let i = 0; i < 3; i++) add(B(0.07, 0.008, 0.012), dark, 0, 0.035, -0.66 - i * 0.02);
    // 光学瞄具
    add(B(0.05, 0.055, 0.14), dark, 0, 0.14, -0.16);
    add(C(0.024, 0.16, 12), steel, 0, 0.15, -0.16, { rx: Math.PI / 2 });
    add(C(0.02, 0.006, 12), accent, 0, 0.15, -0.24, { rx: Math.PI / 2 });
    // 弹匣（弧形）
    const mag = add(B(0.06, 0.26, 0.1), dark, 0, -0.15, -0.02, { rx: 0.12 });
    mag.userData.mag = true;
    add(B(0.064, 0.03, 0.02), steel, 0, -0.26, -0.07);
    // 握把 + 枪托
    add(B(0.062, 0.2, 0.09), polymer, 0, -0.13, 0.09, { rx: 0.34 });
    add(B(0.066, 0.022, 0.094), accent, 0, -0.05, 0.105, { rx: 0.34 });
    add(B(0.05, 0.075, 0.22), polymer, 0, 0.03, 0.2);
    add(B(0.05, 0.12, 0.03), dark, 0, 0.015, 0.32);
    // 拉机柄
    slide = add(B(0.024, 0.02, 0.07), steel, 0.05, 0.07, -0.14);
    slideZ = slide.position.z;
    add(B(0.01, 0.04, 0.02), brass, 0.05, 0.07, -0.19);
  } else if (kind === 'rail') {
    barrelLen = 0.78; muzzleZ = -0.94; caliber = 0.026;
    // 主机匣：长而窄的轨道炮身
    add(B(0.085, 0.095, 0.48), steel, 0, 0.04, -0.16);
    add(B(0.09, 0.022, 0.5), dark, 0, 0.098, -0.16);
    add(B(0.1, 0.05, 0.2), polymer, 0, 0.02, 0.05);
    // 上下导轨
    for (let i = 0; i < 10; i++) add(B(0.055, 0.01, 0.014), dark, 0, 0.114, 0.06 - i * 0.052);
    // 两侧磁轨
    for (const sx of [-0.048, 0.048]) {
      add(B(0.024, 0.035, 0.62), accent, sx, 0.02, -0.42);
      add(B(0.012, 0.018, 0.64), steel, sx, 0.02, -0.42);
    }
    // 线圈（发光环）
    for (let i = 0; i < 5; i++) {
      add(new THREE.TorusGeometry(0.072, 0.013, 6, 14), accent, 0, 0.026, -0.32 - i * 0.13, { rx: Math.PI / 2 });
    }
    // 炮管 + 炮口制退器
    add(C(caliber, 0.66, 10), steel, 0, 0.032, -0.55, { rx: Math.PI / 2 });
    add(C(0.038, 0.1, 10), steel, 0, 0.032, -0.91, { rx: Math.PI / 2 });
    add(C(0.024, 0.012, 10), accent, 0, 0.032, -0.965, { rx: Math.PI / 2 });
    // 枪口侧向泄压口
    for (const sx of [-0.05, 0.05]) add(B(0.02, 0.024, 0.08), dark, sx, 0.032, -0.88);
    // 光学瞄具（青色镜片）
    add(B(0.052, 0.06, 0.2), dark, 0, 0.152, -0.12);
    add(C(0.03, 0.21, 14), steel, 0, 0.158, -0.12, { rx: Math.PI / 2 });
    add(C(0.025, 0.008, 14), accent, 0, 0.158, -0.23, { rx: Math.PI / 2 });
    add(C(0.02, 0.008, 14), accent, 0, 0.158, -0.01, { rx: Math.PI / 2 });
    // 弹匣（方形能量电池）
    const mag = add(B(0.075, 0.22, 0.14), dark, 0, -0.14, 0.02, { rx: 0.06 });
    mag.userData.mag = true;
    add(B(0.078, 0.03, 0.145), accent, 0, -0.25, 0.02);
    // 握把 / 枪托 / 贴腮板
    add(B(0.062, 0.2, 0.095), polymer, 0, -0.13, 0.12, { rx: 0.3 });
    add(B(0.066, 0.022, 0.1), accent, 0, -0.05, 0.13, { rx: 0.3 });
    add(B(0.055, 0.085, 0.26), polymer, 0, 0.035, 0.26);
    add(B(0.06, 0.14, 0.035), dark, 0, 0.0, 0.4);
    add(B(0.055, 0.04, 0.16), dark, 0, 0.1, 0.22);
    // 充能拉柄
    slide = add(B(0.026, 0.02, 0.08), steel, 0.052, 0.075, -0.05);
    slideZ = slide.position.z;
    add(B(0.012, 0.03, 0.02), accent, 0.052, 0.075, -0.1);
  } else {
    barrelLen = 0.5; muzzleZ = -0.62; caliber = 0.026;
    add(B(0.085, 0.095, 0.34), steel, 0, 0.04, -0.08);
    add(B(0.088, 0.02, 0.36), dark, 0, 0.095, -0.08);
    // 泵动护木
    pump = add(B(0.075, 0.07, 0.2), polymer, 0, 0.02, -0.36);
    pumpZ = pump.position.z;
    for (const sx of [-0.038, 0.038]) for (let i = 0; i < 3; i++) add(B(0.008, 0.04, 0.03), dark, sx, 0.02, -0.3 - i * 0.05);
    // 弹仓管 + 枪管
    add(C(0.03, 0.42, 10), steel, 0, -0.005, -0.42, { rx: Math.PI / 2 });
    add(C(caliber, 0.46, 10), steel, 0, 0.035, -0.44, { rx: Math.PI / 2 });
    add(C(0.036, 0.06, 10), steel, 0, 0.035, -0.68, { rx: Math.PI / 2 });
    // 机匣抛壳口 + 弹壳
    add(B(0.02, 0.05, 0.08), dark, 0.04, 0.05, -0.08);
    // 握把 + 固定托
    add(B(0.065, 0.2, 0.1), polymer, 0, -0.13, 0.08, { rx: 0.3 });
    add(B(0.07, 0.022, 0.104), accent, 0, -0.05, 0.095, { rx: 0.3 });
    add(B(0.055, 0.09, 0.26), polymer, 0, 0.02, 0.2);
    add(B(0.055, 0.13, 0.035), dark, 0, 0.0, 0.33);
    // 瞄具
    add(B(0.012, 0.028, 0.012), brass, 0, 0.112, -0.56);
    add(B(0.05, 0.016, 0.012), steel, 0, 0.105, 0.02);
    // 弹管箍
    add(B(0.09, 0.06, 0.02), steel, 0, 0.02, -0.5);
  }

  group.traverse((o) => { if (o.isMesh || o.isSprite) o.layers.enable(1); });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.035, muzzleZ);
  group.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.05, 0.06, -0.08);
  group.add(eject);

  // 手持位置 / ADS 位置：缩放 0.52，ADS 时让瞄具落在屏幕中心
  const SCALE = 0.52;
  const basePos = new THREE.Vector3(0.185, -0.2, -0.54);
  const adsPos = kind === 'rifle'
    ? new THREE.Vector3(0, -0.088, -0.52)
    : kind === 'shotgun'
      ? new THREE.Vector3(0, -0.075, -0.5)
      : kind === 'rail'
        ? new THREE.Vector3(0, -0.1, -0.56)
        : new THREE.Vector3(0, -0.078, -0.5);

  group.position.copy(basePos);
  group.rotation.y = -0.04;
  group.scale.setScalar(SCALE);
  void barrelLen; void railTeeth;
  return { group, muzzle, eject, slide, pump, slideZ, pumpZ, basePos, adsPos, kind };
}