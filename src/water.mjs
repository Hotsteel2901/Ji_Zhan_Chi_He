// ============================================================
//  水体交互：涟漪 / 浪花 / 水面射线 / 入水判定
//  （水面网格本身由世界分块合并渲染，这里只管动态效果与查询）
// ============================================================
import * as THREE from 'three';

const RIPPLE_COUNT = 22;

function rippleTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 3; i++) {
    const r = S * (0.18 + i * 0.14);
    g.strokeStyle = `rgba(210,245,255,${0.55 - i * 0.15})`;
    g.lineWidth = 3.5 - i;
    g.beginPath();
    g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WaterSystem {
  constructor(scene, world, fx) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = null;                 // 由 game 注入
    this.ripples = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const tex = rippleTexture();
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 5;
      scene.add(m);
      this.ripples.push({ m, life: 0, dur: 1, size: 1 });
    }
    }

  dispose() {
    for (const r of this.ripples) {
      this.scene.remove(r.m);
      r.m.material.dispose();
    }
    this.ripples = [];
  }

  /** 水面高度（若点在某个水体内；不检查 y） */
  surfaceAt(x, z) {
    const v = this.world.waterAt(x, z);
    return v ? v.surface : null;
  }

  volumeAt(x, z) { return this.world.waterAt(x, z); }

  /** 判断某点是否在水下 */
  isUnder(x, y, z) {
    const v = this.world.waterAt(x, z);
    return v ? y < v.surface : false;
  }

  /** 射线与最近水面求交（用于射击） */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const v of this.world.waterVolumes) {
      if (dir.y === 0) continue;
      const t = (v.surface - origin.y) / dir.y;
      if (t < 0 || t > maxDist) continue;
      const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
      if (px < v.minX || px > v.maxX || pz < v.minZ || pz > v.maxZ) continue;
      if (!best || t < best.t) best = { t, point: new THREE.Vector3(px, v.surface, pz), volume: v };
    }
    return best;
  }

  /** 子弹入水：浪花 + 涟漪 */
  bulletImpact(point, power = 1) {
    this.splash(point.x, point.z, point.y, power, { bullet: true });
    if (this.audio) this.audio.waterHit(power);
  }

  splash(x, z, y, power = 1, o = {}) {
    const surf = this.surfaceAt(x, z) ?? y;
    const n = o.bullet ? 7 : 14;
    this.fx.burst({ x, y: surf + 0.05, z }, o.bullet ? 0xcfeff8 : 0xbfe8f4, n * power, o.bullet ? 2.4 : 3.2, 0.55, o.bullet ? 0.05 : 0.075, { grav: 12, up: 1.1 });
    this.ripple(x, z, surf, Math.min(2.4, 0.8 + power));
    if (!o.bullet && this.audio) this.audio.splash(power);
  }

  ripple(x, z, y, power = 1) {
    for (const r of this.ripples) {
      if (r.life > 0) continue;
      r.life = 0.9 + power * 0.25;
      r.dur = r.life;
      r.size = 0.7 + power * 0.9;
      r.m.position.set(x, y + 0.035, z);
      r.m.visible = true;
      return;
    }
  }

  update(dt) {
    for (const r of this.ripples) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.life / r.dur;
      const s = r.size * (0.5 + k * 2.6);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = Math.max(0, 0.75 * (1 - k));
    }
  }
}