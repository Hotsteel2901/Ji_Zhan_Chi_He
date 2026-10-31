// ============================================================
//  玩家：移动 / 跳跃 / 游泳（已移除跑酷机制：滑铲/壁跑/蹬墙跳/翻越/翻滚）
// ============================================================
import * as THREE from 'three';
import {
  GRAV, JUMP_V, AUTO_STEP, COYOTE, JUMP_BUF,
  WALK, SPRINT, AIR_CTRL, SWIM_V, SWIM_UP, WADE,
  EYE, PLAYER_H, PLAYER_R, MAX_HP, FALL_SAFE, ECHO_MAX, REGEN_DELAY, REGEN_RATE,
} from './config.mjs';
import { clamp, damp } from './util.mjs';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Player {
  constructor(world, camera, audio, water, fx) {
    this.world = world;
    this.camera = camera;
    this.audio = audio;
    this.water = water;
    this.fx = fx;

    this.pos = new THREE.Vector3(0, 0.05, 2.5);
    this.vel = new THREE.Vector3();
    this.input = { fwd: 0, strafe: 0, sprint: false, up: false, down: false, fire: false, aim: false, jump: false };
    this.onGround = false;
    this.groundTag = 'tile';
    this.coyote = 0;
    this.jumpBuf = 0;
    this.contact = { t: 0, nx: 0, nz: 0 };
    this.fallPeak = 0;
    this.inWater = false;
    this.submerged = false;
    this.waterSurface = null;
    this.waterDepth = 0;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.speedMult = 1;
    this.reloadMult = 1;
    this.echoMax = ECHO_MAX;
    this.echo = 1;
    this.echoCd = 0;
    this.hurtCd = 0;
    this.lastDamage = -99;
    this.dead = false;
    this.boostT = 0;
    this.landing = 0;
    this.bobPhase = 0;
    this.bobY = 0;
    this.stepAcc = 0;
    this.swimAcc = 0;
    this.wakeAcc = 0;
    this.bubbleAcc = 0;
    this.crouch = 0;
    this.jumpCount = 0;
    this.speedNow = 0;
    this.moveState = '';
    this._colOut = {};
  }

  get eyeY() { return this.pos.y + EYE - this.crouch; }

  lookDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  tryJumpBuffered() { this.jumpBuf = JUMP_BUF; }

  damage(amount, cause = 'enemy') {
    if (this.hurtCd > 0 && cause !== 'fall') return;
    if (this.dead) return;
    this.hp -= amount;
    this.hurtCd = cause === 'fall' ? 0.9 : 0.55;
    this.lastDamage = this.worldTime || 0;
    this.audio.hurt();
    this.onDamage && this.onDamage(amount, cause);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }
  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  update(dt, time) {
    this.worldTime = time;
    const p = this;
    const inp = this.input;

    // ---- 水体状态 ----
    const vol = p.water.volumeAt(p.pos.x, p.pos.z);
    const surface = vol ? vol.surface : null;
    p.waterSurface = surface;
    const feetBelow = surface !== null && p.pos.y < surface - 0.06;
    const headBelow = surface !== null && (p.pos.y + EYE) < surface;
    p.waterDepth = vol ? Math.max(0, surface - p.pos.y) : 0;

    // ---- 期望方向 ----
    _fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion); _fwd.y = 0; _fwd.normalize();
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion); _right.y = 0; _right.normalize();

    let speed = WALK;
    if (feetBelow) speed = headBelow ? SWIM_V : WADE;
    if (inp.sprint && !feetBelow && !p.submerged) speed = SPRINT;
    if (p.boostT > 0) speed *= 1.2;
    speed *= p.speedMult;
    if (inp.aim) speed *= 0.58;

    _wish.set(0, 0, 0).addScaledVector(_fwd, inp.fwd).addScaledVector(_right, inp.strafe);
    if (_wish.lengthSq() > 0) _wish.normalize().multiplyScalar(speed);

    if (p.submerged) {
      // 游泳：沿视线推进
      const look = this.lookDirection(_look);
      const k = Math.min(1, dt * 3.4);
      const wish3 = new THREE.Vector3();
      if (inp.fwd) wish3.addScaledVector(look, inp.fwd);
      if (inp.strafe) wish3.addScaledVector(_right, inp.strafe);
      if (wish3.lengthSq() > 0) wish3.normalize().multiplyScalar(SWIM_V);
      p.vel.x += (wish3.x - p.vel.x) * k;
      p.vel.z += (wish3.z - p.vel.z) * k;
    } else {
      const kAccel = p.onGround ? Math.min(1, dt * 11) : Math.min(1, dt * AIR_CTRL);
      p.vel.x += (_wish.x - p.vel.x) * kAccel;
      p.vel.z += (_wish.z - p.vel.z) * kAccel;
    }

    // ---- 纵向 ----
    p.coyote -= dt; p.jumpBuf -= dt;
    if (p.jumpBuf > 0 && !p.dead) {
      if (p.submerged) {
        p.vel.y = Math.min(SWIM_UP, p.vel.y + 3.2);
        p.jumpBuf = 0;
      } else if (p.onGround || p.coyote > 0) {
        p.vel.y = JUMP_V;
        p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
        p.fallPeak = p.pos.y;
        if (inp.sprint) { p.vel.x += _fwd.x * 1.5; p.vel.z += _fwd.z * 1.5; }
      }
    }

    if (p.submerged) {
      p.vel.y -= GRAV * 0.1 * dt;
      if (inp.up) p.vel.y += 9 * dt;
      if (inp.down) p.vel.y -= 7 * dt;
      const headDepth = surface - (p.pos.y + EYE);
      if (headDepth > 0 && headDepth < 1.2 && !inp.down) p.vel.y += 5.5 * dt * (1.2 - headDepth);
      p.vel.y *= (1 - Math.min(1, dt * 2.2));
      p.vel.y = clamp(p.vel.y, -3.4, SWIM_UP);
      p.swimAcc += Math.hypot(p.vel.x, p.vel.z) * dt;
      if (p.swimAcc > 2.0) { p.swimAcc = 0; this.audio.swim(); }
    } else if (feetBelow) {
      p.vel.y -= GRAV * 0.55 * dt;
      if (p.vel.y < 0) p.vel.y *= 1 - Math.min(1, dt * 3.2);
      if (inp.up && p.vel.y < 2.4) p.vel.y += 17 * dt;
    } else {
      if (!(p.onGround || p.coyote > 0)) p.vel.y -= GRAV * dt;
      else if (p.vel.y < 0) p.vel.y = -1.6;
      p.vel.y = Math.max(-34, p.vel.y);
    }

    if (p.submerged) p.fallPeak = p.pos.y;
    else p.fallPeak = Math.max(p.fallPeak ?? p.pos.y, p.pos.y);

    // ---- 位移 + 碰撞 ----
    _delta.set(p.vel.x * dt, p.vel.y * dt, p.vel.z * dt);
    const stepUp = p.onGround ? AUTO_STEP : 0.06;
    this.world.moveAndCollide(p.pos, _delta, PLAYER_R, PLAYER_H, stepUp, this._colOut);
    const wasOnGround = p.onGround;
    p.onGround = this._colOut.grounded;
    if (p.onGround) {
      p.groundTag = this._colOut.groundTag || 'tile';
      p.coyote = COYOTE;
    } else if (wasOnGround && p.vel.y <= 0) {
      p.coyote = COYOTE;
    }
    if (!wasOnGround && p.onGround && p.vel.y <= 0) {
      const impact = -p.vel.y;
      p.vel.y = 0;
      if (impact > 2) this.onLand(impact, feetBelow);
    }
    if (this._colOut.hitX || this._colOut.hitZ) {
      p.contact.t = 0.14;
      const l = Math.hypot(this._colOut.nx, this._colOut.nz) || 1;
      p.contact.nx = this._colOut.nx / l;
      p.contact.nz = this._colOut.nz / l;
    } else {
      p.contact.t = Math.max(0, p.contact.t - dt);
    }

    // 顶棚
    if (p.vel.y > 0 && !p.submerged) {
      const ceil = this.world.ceilingAt(p.pos.x, p.pos.z, p.pos.y, PLAYER_H);
      if (ceil < Infinity && p.pos.y + PLAYER_H > ceil) {
        p.pos.y = ceil - PLAYER_H;
        p.vel.y = 0;
      }
    }

    // 兜底
    if (p.pos.y < -12) {
      const g = this.world.groundAt(p.pos.x, p.pos.z, 99, 99);
      p.pos.y = (g.found ? g.y : 0) + 0.1;
      p.vel.set(0, 0, 0);
      p.fallPeak = p.pos.y;
    }

    // ---- 水体事件 ----
    const wasIn = p.inWater;
    p.inWater = feetBelow;
    p.submerged = headBelow;
    if (feetBelow && !wasIn) {
      const power = clamp(-p.vel.y * 0.22, 0.6, 2.6);
      this.water.splash(p.pos.x, p.pos.z, p.pos.y, power);
      this.audio.land(false);
      if (p.vel.y < -8) this.audio.dive();
    }
    if (!feetBelow && wasIn) {
      this.water.splash(p.pos.x, p.pos.z, p.pos.y, 0.8);
    }

    // ---- 脚步 & 摆动 ----
    const hspd = Math.hypot(p.vel.x, p.vel.z);
    p.speedNow = hspd;
    if (p.onGround && hspd > 0.7 && !feetBelow) {
      p.stepAcc += hspd * dt;
      const stride = inp.sprint ? 2.6 : 2.1;
      if (p.stepAcc > stride) { p.stepAcc = 0; this.audio.step(p.groundTag === 'pool' ? 'water' : 'tile'); }
      p.bobPhase += dt * (inp.sprint ? 13.5 : 9.5);
      p.bobY += (Math.sin(p.bobPhase) * 0.045 - p.bobY) * Math.min(1, dt * 12);
    } else if (p.submerged) {
      p.bobY += (Math.sin(time * 1.4) * 0.03 - p.bobY) * Math.min(1, dt * 3);
    } else {
      p.bobY *= Math.max(0, 1 - dt * 7);
    }

    // 水面尾迹 / 水下气泡
    if (feetBelow && surface !== null) {
      p.wakeAcc += hspd * dt;
      const wakeStep = p.submerged ? 1.15 : 1.9;
      if (p.wakeAcc > wakeStep && hspd > 0.35) {
        p.wakeAcc = 0;
        this.water.ripple(p.pos.x, p.pos.z, surface, p.submerged ? 0.55 : 0.85);
      }
    }
    if (p.submerged) {
      p.bubbleAcc += dt;
      if (p.bubbleAcc > 0.2 && this.fx) {
        p.bubbleAcc = 0;
        const a = Math.random() * Math.PI * 2;
        this.fx.spawnParticle(
          p.pos.x + Math.cos(a) * 0.25, p.pos.y + 1.25 + Math.random() * 0.4, p.pos.z + Math.sin(a) * 0.25,
          (Math.random() - 0.5) * 0.3, 1.1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3,
          0.85 + Math.random() * 0.5, 0x9fe8ff, 0.022 + Math.random() * 0.02,
          { grav: -0.25, buoy: 1.8, drag: 1.4 }
        );
      }
    }

    p.landing = Math.max(0, p.landing - dt * 3);
    p.crouch = damp(p.crouch, 0, 8, dt);

    // 脱战缓慢回血
    if (!p.dead && p.hp < p.maxHp && time - p.lastDamage > REGEN_DELAY) {
      p.hp = Math.min(p.maxHp, p.hp + REGEN_RATE * dt);
    }

    // 状态文本（仅保留非跑酷状态）
    if (p.submerged) p.moveState = '潜泳';
    else if (hspd > SPRINT - 0.5) p.moveState = '疾跑';
    else p.moveState = '';
  }

  onLand(impact, inWater) {
    const p = this;
    const drop = Math.max(0, p.fallPeak - p.pos.y);
    if (drop > FALL_SAFE && !inWater) {
      const dmg = (drop - FALL_SAFE) * 12;
      p.damage(Math.min(85, dmg), 'fall');
      this.audio.land(true);
    } else if (drop > 1.4) {
      this.audio.land(false);
    }
    p.landing = clamp(impact * 0.05, 0, 0.5);
    p.fallPeak = p.pos.y;
  }
}
