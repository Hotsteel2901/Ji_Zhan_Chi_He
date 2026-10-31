// ============================================================
//  光照：环境光 + 动态点光池（就近分配 + 遮挡剔除 + 闪烁）
// ============================================================
import * as THREE from 'three';
import { damp } from './util.mjs';

const _v = new THREE.Vector3();

export class Lighting {
  constructor(scene, world, maxLights = 8) {
    this.scene = scene;
    this.world = world;
    this.maxLights = maxLights;
    this.time = 0;
    this.assignTimer = 0;

    this.hemi = new THREE.HemisphereLight(0xdff2f6, 0x24353c, 0.5);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x7c96a0, 0.27);
    scene.add(this.ambient);
    this.sky = new THREE.DirectionalLight(0xdfeeff, 0.36);
    this.sky.position.set(-0.4, 1, 0.28);
    scene.add(this.sky);

    // 玩家随身补光（避免全黑角落，但很弱）
    this.playerLight = new THREE.PointLight(0xcfe8ff, 0.0, 9, 2);
    scene.add(this.playerLight);

    // 肩灯 / 头灯：向视线方向打一束柔和的聚光，暗房不至于瞎
    this.headLamp = new THREE.SpotLight(0xe6f6ff, 0, 30, 0.62, 0.82, 1.35);
    this.headLamp.position.set(0, 0, 0);
    scene.add(this.headLamp);
    scene.add(this.headLamp.target);
    this.headLampTarget = 0;

    // 池光
    this.pool = [];
    for (let i = 0; i < 16; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 16, 1.7);
      l.visible = false;
      scene.add(l);
      this.pool.push({ light: l, intensity: 0, lamp: null });
    }

    this.underwater = false;
    this.qualityScale = 1;
  }

  setMaxLights(n) {
    this.maxLights = n;
  }

  dispose() {
    this.scene.remove(this.hemi);
    this.scene.remove(this.ambient);
    this.scene.remove(this.sky);
    this.scene.remove(this.playerLight);
    for (const slot of this.pool) this.scene.remove(slot.light);
  }

  setUnderwater(on) { this.underwater = on; }

  update(dt, cameraPos, playerSubmerged, camera = null) {
    this.time += dt;
    // 头灯跟随视线
    if (camera) {
      const dir = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
      this.headLamp.position.set(cameraPos.x, cameraPos.y - 0.08, cameraPos.z);
      this.headLamp.target.position.set(cameraPos.x + dir.x * 9, cameraPos.y - 0.1 + dir.y * 9, cameraPos.z + dir.z * 9);
      this.headLamp.target.updateMatrixWorld();
      this.headLampTarget = playerSubmerged ? 8 : 2.4;
      this.headLamp.intensity = damp(this.headLamp.intensity, this.headLampTarget, 4, dt);
    }
    this.assignTimer -= dt;
    const maxN = Math.min(this.pool.length, this.maxLights);

    // 环境
    const uwK = playerSubmerged ? 1 : 0;
    this.hemi.intensity = damp(this.hemi.intensity, uwK ? 0.4 : 0.5, 3, dt);
    this.ambient.intensity = damp(this.ambient.intensity, uwK ? 0.4 : 0.27, 3, dt);
    this.hemi.color.setHex(uwK ? 0x7fd8ff : 0xdff2f6);
    this.ambient.color.setHex(uwK ? 0x4f8fa8 : 0x7c96a0);
    this.sky.intensity = damp(this.sky.intensity, uwK ? 0.14 : 0.36, 3, dt);
    this.playerLight.intensity = damp(this.playerLight.intensity, uwK ? 0.9 : 0.0, 3, dt);
    this.playerLight.color.setHex(uwK ? 0x6fd8ff : 0xcfe8ff);
    this.playerLight.position.set(cameraPos.x, cameraPos.y + 1.0, cameraPos.z);

    // 重新分配
    if (this.assignTimer <= 0) {
      this.assignTimer = 0.18;
      this.reassign(cameraPos, maxN);
    }

    // 闪烁 + 平滑
    for (const slot of this.pool) {
      if (!slot.lamp) { slot.intensity = damp(slot.intensity, 0, 6, dt); }
      else {
        let target = slot.lamp.intensity * 7.5;
        if (slot.lamp.flicker > 0) {
          // 偶发灯管故障：缓慢起伏 + 每秒最多一次的短暂熄灭（避免高频爆闪）
          const n = Math.sin(this.time * 3.1 + slot.lamp.x * 3.1) * Math.sin(this.time * 1.7 + slot.lamp.z * 2.3);
          const st = Math.sin(this.time * 0.43 + slot.lamp.x * 5.7);
          const dead = (st > 0.9995) ? 0.55 : 1;
          target *= (0.86 + 0.14 * (n * 0.5 + 0.5)) * dead;
        }
        slot.intensity = damp(slot.intensity, target, 9, dt);
      }
      slot.light.intensity = slot.intensity;
    }
  }

  reassign(cameraPos, maxN) {
    const lamps = this.world.lamps;
    const cands = [];
    for (const lamp of lamps) {
      const dx = lamp.x - cameraPos.x, dy = lamp.y - cameraPos.y, dz = lamp.z - cameraPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 26 * 26) continue;
      cands.push({ lamp, d2 });
    }
    cands.sort((a, b) => a.d2 - b.d2);
    const occupied = new Set();
    const chosen = [];
    const distTo = (lamp) => Math.sqrt((lamp.x - cameraPos.x) ** 2 + (lamp.y - cameraPos.y) ** 2 + (lamp.z - cameraPos.z) ** 2);
    const occluded = (lamp, d) => {
      _v.set(lamp.x - cameraPos.x, lamp.y - cameraPos.y, lamp.z - cameraPos.z).normalize();
      return this.world.raycast(cameraPos, _v, d - 0.35).hit;
    };
    // 1) 粘性保留：已在用的灯只要还在范围内且未被遮挡就继续用（避免灯切换造成远处爆闪）
    for (const slot of this.pool) {
      if (!slot.lamp || chosen.length >= maxN) continue;
      const d = distTo(slot.lamp);
      if (d > 24) continue;
      if (occupied.has(slot.lamp)) continue;
      if (occluded(slot.lamp, d)) continue;
      occupied.add(slot.lamp);
      chosen.push(slot.lamp);
    }
    // 2) 用最近的候选补齐
    let probes = 0;
    for (const c of cands) {
      if (chosen.length >= maxN) break;
      if (occupied.has(c.lamp)) continue;
      const d = Math.sqrt(c.d2);
      if (probes < maxN + 3) {
        probes++;
        if (occluded(c.lamp, d)) continue;
      }
      occupied.add(c.lamp);
      chosen.push(c.lamp);
    }
    // 3) 分配（保持已有灯不变，多余的槽位淡出）
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      const lamp = chosen[i] || null;
      if (lamp !== slot.lamp) {
        slot.lamp = lamp;
      }
      if (slot.lamp) {
        slot.light.visible = true;
        slot.light.color.setHex(slot.lamp.color);
        slot.light.distance = slot.lamp.distance + 2;
      }
    }
  }
}