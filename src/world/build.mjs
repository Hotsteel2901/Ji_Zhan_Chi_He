// ============================================================
//  世界构建工具箱：材质 / UV / 结构原语 / 灯光登记
// ============================================================
import * as THREE from 'three';
import { buildTextures, texLib, box, cyl, softShadowTexture } from '../util.mjs';
import { Ramp, Collider } from '../collision.mjs';

// ------------------------------------------------------------
// 材质库
// ------------------------------------------------------------
let _mats = null;
export function materials() {
  if (_mats) return _mats;
  buildTextures();

  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true }, o));
  _mats = {
    tile: std({ envMapIntensity: 0.045, map: texLib.tile, normalMap: texLib.tileNormal, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: texLib.tileRough, roughness: 0.5, metalness: 0.04, color: 0xdfeff0 }),
    pool: std({ envMapIntensity: 0.035, map: texLib.pool, normalMap: texLib.poolNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.42, metalness: 0.02, color: 0xd8f2f6 }),
    concrete: std({ envMapIntensity: 0.035, map: texLib.concrete, normalMap: texLib.concreteNormal, normalScale: new THREE.Vector2(0.65, 0.65), roughness: 0.92, metalness: 0.0, color: 0xa9b6b6 }),
    metal: std({ envMapIntensity: 0.62, map: texLib.metal, roughnessMap: texLib.metalRough, roughness: 0.34, metalness: 0.82, color: 0xc3d0d4 }),
    trim: std({ envMapIntensity: 0.12, color: 0x2a3a40, roughness: 0.7, metalness: 0.25 }),
    accent: std({ envMapIntensity: 0.18, color: 0xff5a34, roughness: 0.44, metalness: 0.1, emissive: 0x8f1e08, emissiveIntensity: 0.42 }),
    grate: std({ envMapIntensity: 0.18, map: texLib.grate, roughness: 0.8, metalness: 0.5, color: 0x9aa8aa }),
    hazard: std({ envMapIntensity: 0.1, map: texLib.hazard, roughness: 0.55, metalness: 0.25, color: 0xffffff }),
    wood: std({ envMapIntensity: 0.05, map: texLib.wood, normalMap: texLib.woodNormal, normalScale: new THREE.Vector2(0.4, 0.4), color: 0xd8b58e, roughness: 0.72, metalness: 0.02 }),
    woodDark: std({ envMapIntensity: 0.04, map: texLib.wood, color: 0x8a5f3e, roughness: 0.8, metalness: 0.02 }),
    leaf: std({ envMapIntensity: 0.03, color: 0x3f7d4f, roughness: 0.86, metalness: 0.02 }),
    glass: new THREE.MeshStandardMaterial({ envMapIntensity: 0.28, color: 0xbfe6f0, transparent: true, opacity: 0.34, roughness: 0.22, metalness: 0.2, emissive: 0x1b3540, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
    panelWarm: panelStd(0xffe3b8, 0.48),
    panelCool: panelStd(0xcfeaff, 0.48),
    panelAmber: panelStd(0xffc978, 0.5),
    panelRed: panelStd(0xff5a44, 0.75),
    panelCyan: panelStd(0x7fe9ff, 0.75),
    ropeRed: std({ color: 0xe0503a, roughness: 0.65, metalness: 0.02 }),
    ropeWhite: std({ color: 0xe8eef0, roughness: 0.6, metalness: 0.02 }),
    ropeBlue: std({ color: 0x3e7fd8, roughness: 0.62, metalness: 0.02 }),
    foliage: std({ color: 0x35604a, roughness: 0.85, metalness: 0.02 }),
    plastic: std({ color: 0xd8d2c4, roughness: 0.55, metalness: 0.02 }),
    dark: std({ color: 0x141c20, roughness: 0.62, metalness: 0.2 }),
    shadowDecal: new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, opacity: 0.5, depthWrite: false, color: 0x04121a }),
  };
  _mats.water = makeWaterMaterial();
  _mats.caustic = new THREE.MeshBasicMaterial({
    map: makeCausticTexture(), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
    depthWrite: false, color: 0x9fdcff, side: THREE.DoubleSide,
  });
  _mats.caustic.map.wrapS = _mats.caustic.map.wrapT = THREE.RepeatWrapping;
  _mats.lightpool = new THREE.MeshBasicMaterial({
    map: makeRadialTexture('rgba(255,244,214,0.85)', 'rgba(255,220,150,0.25)'),
    transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: 0xffeec8,
  });
  _mats.shaft = makeShaftMaterial();
  return _mats;
}

function panelStd(emissive, intensity) {
  return new THREE.MeshStandardMaterial({
    color: 0x2a2f33, emissive, emissiveIntensity: intensity,
    roughness: 0.95, metalness: 0.0, map: texLib.panel, emissiveMap: texLib.panel, envMapIntensity: 0.05,
  });
}

// ------------------------------------------------------------
// 水体 / 焦散 / 光柱 材质
// ------------------------------------------------------------
function makeRadialTexture(inner, mid) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(0.5, mid); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeCausticTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(190,235,255,${0.25 + Math.random() * 0.5})`;
    g.lineWidth = 0.8 + Math.random() * 1.5;
    g.beginPath();
    const x0 = Math.random() * S, y0 = Math.random() * S;
    g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + (Math.random() - 0.5) * 110, y0 + (Math.random() - 0.5) * 110,
      x0 + (Math.random() - 0.5) * 110, y0 + (Math.random() - 0.5) * 110,
      x0 + (Math.random() - 0.5) * 150, y0 + (Math.random() - 0.5) * 150);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const WATER_WAVE = `
float H(vec2 p,float t){
  return sin(p.x*0.45+t*1.25)*0.052 + cos(p.y*0.6+t*0.9)*0.052
       + sin((p.x+p.y)*0.31+t*0.75)*0.034 + sin((p.x-p.y)*0.87+t*1.6)*0.016;
}`;

function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFoam: { value: 1 },
      uEnvMap: { value: null },
      uEnvK: { value: 0 },
      uPlayer: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld; varying vec3 vView;
      float H(vec2 p,float t){
        return sin(p.x*0.45+t*1.25)*0.072 + cos(p.y*0.6+t*0.9)*0.072
             + sin((p.x+p.y)*0.31+t*0.75)*0.046 + sin((p.x-p.y)*0.87+t*1.6)*0.022
             + sin(p.x*1.9 - p.y*1.3 + t*2.6)*0.010;
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += H(wp.xz, uTime);
        vWorld = wp.xyz;
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uFoam;
      uniform samplerCube uEnvMap; uniform float uEnvK;
      uniform vec2 uPlayer;
      varying vec3 vWorld; varying vec3 vView;
      float H(vec2 p,float t){
        return sin(p.x*0.45+t*1.25)*0.072 + cos(p.y*0.6+t*0.9)*0.072
             + sin((p.x+p.y)*0.31+t*0.75)*0.046 + sin((p.x-p.y)*0.87+t*1.6)*0.022;
      }
      void main(){
        vec2 e = vec2(0.055, 0.0);
        float hx = H(vWorld.xz + e.xy, uTime) - H(vWorld.xz - e.xy, uTime);
        float hz = H(vWorld.xz + e.yx, uTime) - H(vWorld.xz - e.yx, uTime);
        float camDist = length(vView);
        float normalFade = 1.0 / (1.0 + camDist * 0.13);
        vec3 n = normalize(vec3(-hx * 3.1 * normalFade, 1.0, -hz * 3.1 * normalFade));
        vec3 V = normalize(vView);
        vec3 L1 = normalize(vec3(0.35, 0.86, 0.28));
        vec3 L2 = normalize(vec3(-0.55, 0.42, -0.5));
        float fres = pow(1.0 - max(dot(V, n), 0.0), 3.1);

        vec3 deep = vec3(0.010, 0.070, 0.120);
        vec3 shal = vec3(0.045, 0.235, 0.30);
        vec3 base = mix(deep, shal, 0.30 + 0.70 * fres);
        float diff = max(dot(n, L1), 0.0);
        vec3 col = base * (0.52 + 0.48 * diff);

        // 环境反射（房间/天窗的模糊倒影）
        vec3 R = reflect(-V, n);
        vec3 env = textureCube(uEnvMap, R).rgb;
        col = mix(col, env * vec3(0.62, 0.84, 1.0) * 0.85, fres * uEnvK);

        // 第二盏灯的冷色边缘 + 日光闪烁
        float rim2 = pow(1.0 - max(dot(V, n), 0.0), 6.0) * 0.22;
        col += vec3(0.55, 0.82, 1.0) * rim2;
        float sp1 = pow(max(dot(V, reflect(-L1, n)), 0.0), 260.0);
        float sp2 = pow(max(dot(V, reflect(-L2, n)), 0.0), 110.0);
        col += vec3(1.0, 0.985, 0.92) * sp1 * 0.62 * normalFade;
        col += vec3(0.70, 0.90, 1.0) * sp2 * 0.18 * normalFade;

        // 细碎波纹闪光
        float spark = pow(max(0.0, sin(vWorld.x * 9.0 + uTime * 3.3) * sin(vWorld.z * 8.0 - uTime * 2.7)), 70.0);
        col += vec3(0.78, 0.94, 1.0) * spark * 0.09 * normalFade;

        // 水面焦散光纹
        vec2 cq = vWorld.xz * 0.85;
        float ca = sin(cq.x + sin(cq.y * 0.8 + uTime * 0.5) * 2.0 + uTime * 0.7)
                 * sin(cq.y * 1.13 - cos(cq.x * 0.7 - uTime * 0.4) * 2.0 - uTime * 0.55);
        float cMask = smoothstep(0.45, 1.0, ca);
        col += vec3(0.30, 0.62, 0.72) * cMask * 0.075 * normalFade;

        // 玩家游动尾迹
        float pd = length(vWorld.xz - uPlayer);
        float wake = sin(pd * 3.4 - uTime * 4.5) * exp(-pd * 0.55) * 0.032;
        col += vec3(0.52, 0.82, 0.92) * max(0.0, wake);

        // 水面泡沫
        float foamWave = sin(vWorld.x * 2.7 + uTime * 2.2) * sin(vWorld.z * 2.3 - uTime * 1.7);
        col += vec3(0.75, 0.90, 0.95) * max(0.0, foamWave) * 0.03 * uFoam;

        float alpha = mix(0.70, 0.965, fres);
        gl_FragColor = vec4(col, alpha);
      }`,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

function makeShaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 mvPosition;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mvPosition = mv.xyz;
        vV = normalize(-mv.xyz);
        vY = uv.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vV; varying float vY;
      uniform float uTime;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float vert = smoothstep(0.02, 0.35, vY) * smoothstep(1.0, 0.45, vY);
        float flicker = 0.96 + 0.04 * sin(uTime * 0.6 + vY * 3.0);
        float farFade = 1.0 / (1.0 + length(mvPosition) * 0.05);   // 远处光柱淡化，避免闪烁感
        float a = rim * vert * 0.2 * flicker * farFade;
        gl_FragColor = vec4(vec3(1.0, 0.974, 0.9) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------
// UV 工具：按世界尺寸缩放贴图，保持每面纹理密度一致
// ------------------------------------------------------------
export function boxUV(geo, w, h, d, scale = 1 / 2.2) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const su = faces[f][0] * scale, sv = faces[f][1] * scale;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
export function fitUV(geo, su, sv = su) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------
// CellBuilder：收集一个房间格的几何 / 碰撞 / 灯光 / 水体
// ------------------------------------------------------------
export class Builder {
  constructor(cell, world) {
    this.cell = cell;
    this.world = world;
    this.mats = materials();
    this.ox = cell.cxw;      // 本格原点：所有局部坐标统一在此偏移到世界坐标
    this.oz = cell.czw;
  }
  bucket(name) {
    const g = this.cell.geo;
    if (!g[name]) g[name] = [];
    return g[name];
  }
  /** 世界坐标盒体（不做原点偏移，内部使用） */
  _boxW(bucket, w, h, d, x, y, z, o = {}) {
    const geo = box(w, h, d, x, y, z, o.ry || 0);
    boxUV(geo, w, h, d, o.uv || (bucket === 'pool' ? 1 / 2.0 : 1 / 2.2));
    this.bucket(bucket).push(geo);
    if (o.collide) this._collideW(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2, o.tag || bucket);
    return geo;
  }
  /** 简单盒体（局部坐标，自动偏移） */
  box(bucket, w, h, d, x, y, z, o = {}) {
    return this._boxW(bucket, w, h, d, x + this.ox, y, z + this.oz, o);
  }
  /** 最小/最大角盒体（局部坐标） */
  boxMM(bucket, x0, y0, z0, x1, y1, z1, o = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0 || h <= 0 || d <= 0) return null;
    return this._boxW(bucket, w, h, d, (x0 + x1) / 2 + this.ox, (y0 + y1) / 2, (z0 + z1) / 2 + this.oz, o);
  }
  cyl(bucket, rTop, rBot, h, seg, x, y, z, o = {}) {
    const geo = cyl(rTop, rBot, h, seg, x + this.ox, y, z + this.oz, o.rx || 0, o.rz || 0);
    fitUV(geo, o.uv || Math.max(0.5, rTop * 2) / 2.2, h / 2.2);
    this.bucket(bucket).push(geo);
    if (o.collide) {
      const r = Math.max(rTop, rBot);
      this._collideW(x + this.ox - r, y - h / 2, z + this.oz - r, x + this.ox + r, y + h / 2, z + this.oz + r, o.tag || bucket);
    }
    return geo;
  }
  _collideW(minX, minY, minZ, maxX, maxY, maxZ, tag) {
    const c = new Collider(minX, minY, minZ, maxX, maxY, maxZ, tag);
    c.owner = this.cell.key;
    this.cell.colliders.push(c);
    this.world._pendingColliders.push(c);
    return c;
  }
  /** 局部坐标碰撞盒 */
  collide(minX, minY, minZ, maxX, maxY, maxZ, tag) {
    return this._collideW(minX + this.ox, minY, minZ + this.oz, maxX + this.ox, maxY, maxZ + this.oz, tag);
  }
  rampCollide(x0, z0, x1, z1, axis, y0, y1, tag) {
    const r = new Ramp(x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, axis, y0, y1, tag);
    r.owner = this.cell.key;
    this.cell.ramps.push(r);
    this.world._pendingRamps.push(r);
    return r;
  }
  /** 墙壁（在轴向区间上挖洞）。isX 表示墙沿 x 方向延伸（法线朝 z）。
   *  o.world = true 时坐标已是世界坐标，不再叠加房间原点（接缝墙用）。 */
  wallSegments(isX, fixed, a0, a1, y0, y1, openings, o = {}) {
    const ops = (openings || []).slice().sort((p, q) => p.a0 - q.a0);
    const thickness = o.thickness || 0.42;
    const bucket = o.bucket || 'tile';
    const tag = o.tag || bucket;
    const seg = (sa, sb, sy0, sy1) => {
      if (sb - sa < 0.02 || sy1 - sy0 < 0.02) return;
      const cx = isX ? (sa + sb) / 2 : fixed;
      const cz = isX ? fixed : (sa + sb) / 2;
      const w = isX ? sb - sa : thickness;
      const d = isX ? thickness : sb - sa;
      const opts = { collide: o.collide !== false, tag, uv: o.uv };
      if (o.world) this._boxW(bucket, w, sy1 - sy0, d, cx, (sy0 + sy1) / 2, cz, opts);
      else this.box(bucket, w, sy1 - sy0, d, cx, (sy0 + sy1) / 2, cz, opts);
    };
    let cur = a0;
    for (const op of ops) {
      const oa = Math.max(a0, op.a0), ob = Math.min(a1, op.a1);
      if (ob <= oa) continue;
      if (oa > cur) seg(cur, oa, y0, y1);
      if (op.y0 > y0) seg(oa, ob, y0, Math.min(op.y0, y1));
      if (op.y1 < y1) seg(oa, ob, Math.max(op.y1, y0), y1);
      cur = Math.max(cur, ob);
    }
    if (cur < a1) seg(cur, a1, y0, y1);
    void this;
  }
  /** 水平栏杆：立柱 + 顶杆 + 中杆 */
  rail(x0, z0, x1, z1, y, o = {}) {
    const bucket = o.red ? 'accent' : (o.bucket || 'metal');
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const ry = Math.atan2(dx, dz) + Math.PI / 2;
    const h = o.h || 1.02;
    // 顶杆
    this.box(bucket, len, 0.055, 0.055, (x0 + x1) / 2, y + h, (z0 + z1) / 2, { ry, uv: 0.35 });
    // 中杆
    this.box(bucket, len, 0.03, 0.03, (x0 + x1) / 2, y + h * 0.58, (z0 + z1) / 2, { ry, uv: 0.3 });
    // 立柱
    const n = Math.max(2, Math.round(len / 1.9));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + dx * t, pz = z0 + dz * t;
      this.box(bucket, 0.06, h, 0.06, px, y + h / 2, pz, { uv: 0.3 });
    }
    if (o.collide) {
      this.collide(Math.min(x0, x1) - 0.08, y, Math.min(z0, z1) - 0.08,
        Math.max(x0, x1) + 0.08, y + h, Math.max(z0, z1) + 0.08, 'trim');
    }
  }
  /** 斜向栏杆（楼梯扶手）：单段斜杆 + 立柱（局部坐标） */
  slopedRail(x0, y0, z0, x1, y1, z1, side = 1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    const ry = Math.atan2(dx, dz) + Math.PI / 2;
    const geo = new THREE.BoxGeometry(len, 0.055, 0.055);
    const ang = Math.atan2(dy, len);
    // 先绕局部 z 旋转出坡度，再绕 y 对齐方向
    geo.rotateZ(-ang);
    geo.rotateY(ry);
    geo.translate((x0 + x1) / 2 + this.ox, (y0 + y1) / 2 + 1.0, (z0 + z1) / 2 + this.oz);
    fitUV(geo, 0.4, 0.4);
    this.bucket('metal').push(geo);
    const n = Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + dx * t, py = y0 + dy * t, pz = z0 + dz * t;
      this.box('metal', 0.05, 1.02, 0.05, px, py + 0.51, pz, { uv: 0.3 });
    }
    void side;
  }
  /** 台阶（斜向坡道的可视化）：steps 个盒子 + 可选坡道碰撞
   *  yAtMin / yAtMax 分别对应轴坐标较小/较大端的高度（axis='x' 用 x，'z' 用 z） */
  stairs(x0, z0, x1, z1, axis, yAtMin, yAtMax, o = {}) {
    const steps = Math.max(4, Math.round(Math.abs(yAtMax - yAtMin) / 0.185));
    const rise = (yAtMax - yAtMin) / steps;
    const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
    const zMin = Math.min(z0, z1), zMax = Math.max(z0, z1);
    const along = axis === 'z' ? (zMax - zMin) : (xMax - xMin);
    const depth = along / steps;
    for (let i = 0; i < steps; i++) {
      const yA = yAtMin + rise * i, yB = yAtMin + rise * (i + 1);
      const top = Math.max(yA, yB), bottom = Math.min(yA, yB) - 0.18;
      const cy = (top + bottom) / 2, hh = Math.max(0.12, top - bottom);
      if (axis === 'z') {
        const cz = zMin + depth * (i + 0.5);
        this.box('tile', xMax - xMin, hh, depth + 0.02, (xMin + xMax) / 2, cy, cz, { uv: o.uv });
      } else {
        const cx = xMin + depth * (i + 0.5);
        this.box('tile', depth + 0.02, hh, zMax - zMin, cx, cy, (zMin + zMax) / 2, { uv: o.uv });
      }
    }
    // 侧挡板（楼梯外沿）
    if (o.skirt !== false) {
      this.boxMM('trim', xMin, Math.min(yAtMin, yAtMax) - 0.1, zMin, xMax, Math.max(yAtMin, yAtMax) - 0.02, zMin + 0.05, {});
      this.boxMM('trim', xMin, Math.min(yAtMin, yAtMax) - 0.1, zMax - 0.05, xMax, Math.max(yAtMin, yAtMax) - 0.02, zMax, {});
    }
    if (o.ramp !== false) this.rampCollide(x0, z0, x1, z1, axis, yAtMin, yAtMax, 'stairs');
  }
  lamp(x, y, z, color = 0xffe6c0, intensity = 8, distance = 13, o = {}) {
    this.cell.lamps.push({ x: x + this.ox, y, z: z + this.oz, color, intensity, distance, flicker: o.flicker || 0, kind: o.kind || 'warm', owner: this.cell.key, on: true });
  }
  emitter(type, data) {
    const d = { ...data };
    if (d.x !== undefined) d.x += this.ox;
    if (d.z !== undefined) d.z += this.oz;
    d.owner = this.cell.key;
    this.cell.emitters.push(d);
  }
  water(minX, minZ, maxX, maxZ, surface, floor, kind = 'pool') {
    const vol = {
      minX: Math.min(minX, maxX) + this.ox, maxX: Math.max(minX, maxX) + this.ox,
      minZ: Math.min(minZ, maxZ) + this.oz, maxZ: Math.max(minZ, maxZ) + this.oz,
      surface, floor, kind, owner: this.cell.key,
    };
    this.cell.water.push(vol);
    this.world._pendingWater.push(vol);
    return vol;
  }
  /** 地面阴影贴片（软接触阴影，按区块合并渲染） */
  shadowBlob(x, z, y, size) {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x + this.ox, y + 0.014, z + this.oz);
    (this.cell.decals || (this.cell.decals = [])).push(geo);
  }
  /** 圆环（局部坐标）：泳圈、浮标、管道箍 */
  torus(bucket, R, r, seg, tubeSeg, x, y, z, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.TorusGeometry(R, r, tubeSeg || 8, seg || 20);
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x + this.ox, y, z + this.oz);
    fitUV(geo, 0.7, 0.7);
    this.bucket(bucket).push(geo);
    return geo;
  }
  /** 倾斜盒体（局部坐标）：滑水道、斜面装饰；碰撞请另用 rampCollide */
  tiltBox(bucket, w, h, d, x, y, z, rx = 0, rz = 0, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rx) geo.rotateX(rx);
    if (rz) geo.rotateZ(rz);
    geo.translate(x + this.ox, y, z + this.oz);
    fitUV(geo, o.uv || 1 / 2.2, (o.uv || 1 / 2.2) * 1.2);
    this.bucket(bucket).push(geo);
    return geo;
  }
  /** 标牌（局部坐标） */
  sign(tex, w, h, x, y, z, ry = 0) {
    (this.cell.signs || (this.cell.signs = [])).push({ tex, w, h, x: x + this.ox, y, z: z + this.oz, ry });
  }
}