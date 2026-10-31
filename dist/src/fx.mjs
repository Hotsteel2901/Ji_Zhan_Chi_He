// ============================================================
//  特效：粒子 / 曳光 / 弹孔贴花 / 水花 / 蒸汽 / 伤害数字
// ============================================================
import * as THREE from 'three';
import { glowTexture, softShadowTexture, clamp, randRange } from './util.mjs';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _col = new THREE.Color();

export class FX {
  constructor(scene, camera, quality = 1) {
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.ui = null;

    // ---- 火花/血/水花（加色，实例化）----
    const sparkCount = Math.round(420 * quality);
    const sparkGeo = new THREE.PlaneGeometry(1, 1);
    const sparkMat = new THREE.MeshBasicMaterial({
      map: glowTexture('rgba(255,255,255,1)', 'rgba(255,220,160,0.45)'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, Math.max(32, sparkCount));
    this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks.frustumCulled = false;
    this.sparks.count = 0;
    scene.add(this.sparks);
    this.sparkData = [];

    // ---- 蒸汽/烟雾（普通混合 sprite 池）----
    const smokeTex = glowTexture('rgba(230,245,255,0.85)', 'rgba(180,210,225,0.35)');
    this.smokePool = [];
    this.smokeTex = smokeTex;
    const smokeN = Math.round(26 * quality) + 8;
    for (let i = 0; i < smokeN; i++) {
      const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      scene.add(sp);
      this.smokePool.push({ sp, life: 0, dur: 1, vy: 0, vx: 0, vz: 0, size0: 1, size1: 2 });
    }

    // ---- 曳光弹（实例化）----
    const trGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    const trMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(trGeo, trMat, 64);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    scene.add(this.tracers);
    this.tracerData = [];
    this._trQuat = new THREE.Quaternion();
    this._trM = new THREE.Matrix4();

    // ---- 轨道炮光束（少量独立网格，便于做粗光束）----
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.railBeams = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(beamGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.railBeams.push({ m, life: 0, dur: 0.18 });
    }

    // ---- 弹孔贴花（实例化）----
    const decalTex = makeDecalTexture();
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, 64);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.frustumCulled = false;
    this.decals.count = 0;
    scene.add(this.decals);
    this.decalData = [];
    this._decQuat = new THREE.Quaternion();
    this._decNorm = new THREE.Vector3();
    this._decUp = new THREE.Vector3(0, 1, 0);

    // ---- 弹壳 ----
    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd8b25c, metalness: 0.9, roughness: 0.32 });
    this.shellGeo = shellGeo; this.shellMat = shellMat;

    // ---- 蒸汽发射器注册 ----
    this.steamEmitters = [];
    void softShadowTexture;
  }

  setQuality(q) {
    this.quality = q;
  }

  // ----------------------------------------------------------
  // 粒子
  // ----------------------------------------------------------
  spawnParticle(x, y, z, vx, vy, vz, life, color, size, o = {}) {
    if (this.sparkData.length >= this.sparks.instanceMatrix.count) {
      this.sparkData.shift();
    }
    this.sparkData.push({
      x, y, z, vx, vy, vz, life, maxLife: life, color: new THREE.Color(color), size,
      grav: o.grav ?? 9, drag: o.drag ?? 0, buoy: o.buoy ?? 0, spin: (Math.random() - 0.5) * 8,
    });
  }

  burst(pos, color, count = 8, speed = 3, life = 0.4, size = 0.06, o = {}) {
    const n = Math.max(1, Math.round(count * this.quality));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = o.up ?? 0.6;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.spawnParticle(pos.x, pos.y, pos.z,
        Math.cos(a) * sp, up * sp * (0.5 + Math.random()), Math.sin(a) * sp,
        life * (0.6 + Math.random() * 0.7), color, size * (0.6 + Math.random() * 0.9), o);
    }
  }

  // ----------------------------------------------------------
  // 轨道炮粗光束
  // ----------------------------------------------------------
  railBeam(from, to, color = 0x9fe8ff) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.02) return;
    let b = this.railBeams.find(x => x.life <= 0);
    if (!b) b = this.railBeams[0];
    b.m.position.copy(from).add(to).multiplyScalar(0.5);
    b.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    b.m.scale.set(0.05, len, 0.05);
    b.m.material.color.setHex(color);
    b.m.material.opacity = 0.95;
    b.m.visible = true;
    b.life = 0.18;
    b.dur = 0.18;
  }

  // ----------------------------------------------------------
  // 曳光
  // ----------------------------------------------------------
  tracer(from, to, color = 0xffe2a0) {
    if (this.tracerData.length >= this.tracers.instanceMatrix.count) this.tracerData.shift();
    this.tracerData.push({ from: from.clone(), to: to.clone(), t: 0, dur: 0.07, color: new THREE.Color(color) });
  }

  // ----------------------------------------------------------
  // 弹孔
  // ----------------------------------------------------------
  impact(point, normal, scale = 1, tag = 'tile') {
    if (this.decalData.length >= this.decals.instanceMatrix.count) this.decalData.shift();
    const rot = Math.random() * Math.PI * 2;
    this.decalData.push({ point: point.clone(), normal: normal.clone(), scale: (0.16 + Math.random() * 0.06) * scale, rot, t: 0, dur: 22 });
  }

  // ----------------------------------------------------------
  // 弹壳
  // ----------------------------------------------------------
  ejectShell(pos, camQuat, power = 2.4) {
    if (this.shells.length > 10) {
      const old = this.shells.shift();
      this.scene.remove(old.m);
    }
    const m = new THREE.Mesh(this.shellGeo, this.shellMat);
    m.position.copy(pos);
    this.scene.add(m);
    const right = new THREE.Vector3(1, 0.25, 0).applyQuaternion(camQuat);
    this.shells.push({ m, v: right.multiplyScalar(power).add(new THREE.Vector3(0, 2.0, 0)), spin: (Math.random() - 0.5) * 22, t: 0 });
  }

  // ----------------------------------------------------------
  // 烟雾/蒸汽
  // ----------------------------------------------------------
  smoke(x, y, z, size0, size1, life, vy = 0.8, o = {}) {
    const item = this.smokePool.find(s => s.life <= 0);
    if (!item) return;
    item.life = life; item.dur = life;
    item.vx = o.vx || 0; item.vy = vy; item.vz = o.vz || 0;
    item.size0 = size0; item.size1 = size1;
    item.sp.position.set(x, y, z);
    item.sp.visible = true;
    item.sp.material.opacity = o.opacity ?? 0.5;
    item.sp.material.color.set(o.color ?? 0xdfeef8);
    item.baseOpacity = o.opacity ?? 0.5;
    item.sp.scale.setScalar(size0);
  }

  registerSteamEmitter(e) {
    this.steamEmitters.push({ ...e, acc: 0 });
  }
  unregisterSteamByOwner(owner) {
    this.steamEmitters = this.steamEmitters.filter(e => e.owner !== owner);
  }

  /** 每帧更新；dt 已带慢动作缩放 */
  update(dt, time) {
    // --- 实例化火花 ---
    const camQ = this.camera.quaternion;
    let n = 0;
    for (let i = this.sparkData.length - 1; i >= 0; i--) {
      const p = this.sparkData[i];
      p.life -= dt;
      if (p.life <= 0) { this.sparkData.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.vy += p.buoy * dt;
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.life / p.maxLife;
      _s.setScalar(p.size * (0.35 + t * 0.85));
      _p.set(p.x, p.y, p.z);
      _m.compose(_p, camQ, _s);
      this.sparks.setMatrixAt(n, _m);
      _col.copy(p.color).multiplyScalar(0.35 + t * 0.75);
      this.sparks.setColorAt(n, _col);
      n++;
    }
    this.sparks.count = n;
    if (n > 0) {
      this.sparks.instanceMatrix.needsUpdate = true;
      if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
      else if (this.sparks.setColorAt) this.sparks.instanceColor.needsUpdate = true;
    }

    // --- 曳光 ---
    let tn = 0;
    for (let i = this.tracerData.length - 1; i >= 0; i--) {
      const tr = this.tracerData[i];
      tr.t += dt;
      if (tr.t > tr.dur) { this.tracerData.splice(i, 1); continue; }
      const mid = _p.copy(tr.from).add(tr.to).multiplyScalar(0.5);
      const dir = tr.to.clone().sub(tr.from);
      const len = dir.length() || 0.001;
      this._trQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      _s.set(1, 1, len);
      this._trM.compose(mid, this._trQuat, _s);
      this.tracers.setMatrixAt(tn, this._trM);
      this.tracers.setColorAt(tn, tr.color);
      tn++;
    }
    this.tracers.count = tn;
    if (tn > 0) {
      this.tracers.instanceMatrix.needsUpdate = true;
      if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    }

    // --- 轨道炮光束 ---
    for (const b of this.railBeams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.m.visible = false; continue; }
      const k = b.life / b.dur;
      b.m.material.opacity = k * 0.9;
      const w = 0.02 + 0.05 * k;
      b.m.scale.x = w; b.m.scale.z = w;
    }

    // --- 弹孔 ---
    let dn = 0;
    for (let i = this.decalData.length - 1; i >= 0; i--) {
      const d = this.decalData[i];
      d.t += dt;
      if (d.t > d.dur) { this.decalData.splice(i, 1); continue; }
      this._decNorm.copy(d.normal).normalize();
      this._decQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._decNorm);
      const spin = new THREE.Quaternion().setFromAxisAngle(this._decNorm, d.rot);
      this._decQuat.premultiply(spin);
      _p.copy(d.point).addScaledVector(this._decNorm, 0.012);
      _s.setScalar(d.scale);
      this._decM = this._decM || new THREE.Matrix4();
      this._decM.compose(_p, this._decQuat, _s);
      this.decals.setMatrixAt(dn, this._decM);
      dn++;
    }
    this.decals.count = dn;
    if (dn > 0) this.decals.instanceMatrix.needsUpdate = true;

    // --- 弹壳 ---
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt; sh.v.y -= 14 * dt;
      sh.m.position.addScaledVector(sh.v, dt);
      sh.m.rotation.x += sh.spin * dt; sh.m.rotation.z += sh.spin * 0.7 * dt;
      if (sh.t > 0.9) { this.scene.remove(sh.m); this.shells.splice(i, 1); }
    }

    // --- 烟雾池 ---
    for (const s of this.smokePool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sp.visible = false; continue; }
      const k = 1 - s.life / s.dur;
      s.sp.position.x += s.vx * dt;
      s.sp.position.y += s.vy * dt;
      s.sp.position.z += s.vz * dt;
      s.sp.scale.setScalar(s.size0 + (s.size1 - s.size0) * k);
      s.sp.material.opacity = (s.baseOpacity || 0.5) * (1 - k) * Math.min(1, k * 6);
    }

    // --- 蒸汽发射器 ---
    for (const e of this.steamEmitters) {
      if (e.type === 'steam') {
        e.acc += dt * this.quality * 1.4;
        while (e.acc > 1) {
          e.acc -= 1;
          const a = Math.random() * Math.PI * 2, r = Math.random() * (e.r || 1.5);
          this.smoke(e.x + Math.cos(a) * r, e.y + 0.2, e.z + Math.sin(a) * r,
            0.6, 2.6, 2.4 + Math.random() * 1.4, 0.35, { opacity: 0.28, color: 0xd8ecf5, vx: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.2 });
        }
      } else if (e.type === 'drip') {
        e.acc += dt * (e.rate || 2);
        while (e.acc > 1) {
          e.acc -= 1;
          this.spawnParticle(e.x, e.y, e.z, 0, -0.4, 0, 1.4, 0x9fd8e8, 0.035, { grav: 9.5, drag: 0.1 });
        }
      }
    }
    void time;
  }

  // 伤害数字（交给 UI 层做屏幕投影）
  damageNumber(worldPos, amount, o = {}) {
    if (this.ui) this.ui.spawnDamageNumber(worldPos, amount, o);
  }
}

function makeDecalTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(8,10,12,0.95)');
  grad.addColorStop(0.35, 'rgba(12,16,18,0.8)');
  grad.addColorStop(0.62, 'rgba(30,36,38,0.35)');
  grad.addColorStop(1, 'rgba(40,46,48,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(160,170,172,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 14;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

void clamp; void randRange;