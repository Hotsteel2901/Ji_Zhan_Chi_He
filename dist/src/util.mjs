// ============================================================
//  工具：随机 / 数学 / 程序化贴图 / 几何构建
// ============================================================
import * as THREE from 'three';

// ---------- 随机 ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z, salt = 0, seed = 1337) {
  let n = (x * 374761393 + z * 668265263 + salt * 1442695041 + seed * 2246822519 + 0x9e3779b9) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

export function hashStr(s) {
  let n = 0;
  for (const ch of s) n = ((n << 5) - n + ch.charCodeAt(0)) | 0;
  return Math.abs(n) || 1;
}

// ---------- 数学 ----------
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const randRange = (rng, a, b) => a + rng() * (b - a);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ---------- 2D 值噪声 ----------
export function noise2(x, y, seed = 7) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, 1, seed), b = hash2(xi + 1, yi, 2, seed);
  const c = hash2(xi, yi + 1, 3, seed), d = hash2(xi + 1, yi + 1, 4, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, oct = 4, seed = 7) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f, seed + i * 13) * amp; amp *= 0.5; f *= 2; }
  return s;
}

// ---------- 程序化贴图 ----------
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function toTex(canvas, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

/** 从灰度高度图生成法线贴图 */
function normalFromHeight(heightCanvas) {
  const size = heightCanvas.width;
  const hg = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const og = out.getContext('2d');
  const img = og.createImageData(size, size);
  const h = (x, y) => hg[((y & (size - 1)) * size + (x & (size - 1))) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 2.2;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return toTex(out, { srgb: false });
}

export const texLib = {};

export function buildTextures() {
  // -------- 瓷砖（亮面小方砖）--------
  {
    const S = 256, N = 4, ts = S / N;
    const color = makeCanvas(S), height = makeCanvas(S), rough = makeCanvas(S);
    const cg = color.getContext('2d'), hg = height.getContext('2d'), rg = rough.getContext('2d');
    cg.fillStyle = '#5d7f85'; cg.fillRect(0, 0, S, S);          // 缝隙
    hg.fillStyle = '#3a3a3a'; hg.fillRect(0, 0, S, S);
    rg.fillStyle = '#c8c8c8'; rg.fillRect(0, 0, S, S);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = 0.93 + Math.random() * 0.12;
      const r = Math.round(224 * v), g = Math.round(240 * v), b = Math.round(238 * v);
      cg.fillStyle = `rgb(${r},${g},${b})`;
      cg.fillRect(x * ts + 2.5, y * ts + 2.5, ts - 5, ts - 5);
      // 砖面斑驳
      for (let i = 0; i < 5; i++) {
        cg.fillStyle = `rgba(${140 + Math.random() * 60 | 0},${170 + Math.random() * 50 | 0},${175 + Math.random() * 50 | 0},0.06)`;
        cg.beginPath();
        cg.arc(x * ts + 4 + Math.random() * (ts - 8), y * ts + 4 + Math.random() * (ts - 8), 3 + Math.random() * 9, 0, 7);
        cg.fill();
      }
      const hv = Math.round(190 + Math.random() * 40);
      hg.fillStyle = `rgb(${hv},${hv},${hv})`;
      hg.fillRect(x * ts + 2.5, y * ts + 2.5, ts - 5, ts - 5);
      hg.fillStyle = '#1f1f1f';
      hg.fillRect(x * ts + 2.5, y * ts + 2.5, ts - 5, 1.6);
      rg.fillStyle = `rgb(${Math.round(70 + Math.random() * 35)},${Math.round(70 + Math.random() * 35)},${Math.round(70 + Math.random() * 35)})`;
      rg.fillRect(x * ts + 2.5, y * ts + 2.5, ts - 5, ts - 5);
    }
    texLib.tile = toTex(color);
    texLib.tileRough = toTex(rough, { srgb: false });
    texLib.tileNormal = normalFromHeight(height);
  }
  // -------- 泳池砖（青蓝马赛克）--------
  {
    const S = 256, N = 8, ts = S / N;
    const color = makeCanvas(S), height = makeCanvas(S);
    const cg = color.getContext('2d'), hg = height.getContext('2d');
    cg.fillStyle = '#2c5d70'; cg.fillRect(0, 0, S, S);
    hg.fillStyle = '#303030'; hg.fillRect(0, 0, S, S);
    const pal = ['#4fa8c4', '#5fbfd8', '#3f92ad', '#6fd0e4', '#57b0ca'];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      cg.fillStyle = pal[Math.floor(Math.random() * pal.length)];
      cg.fillRect(x * ts + 1.6, y * ts + 1.6, ts - 3.2, ts - 3.2);
      const hv = Math.round(180 + Math.random() * 55);
      hg.fillStyle = `rgb(${hv},${hv},${hv})`;
      hg.fillRect(x * ts + 1.6, y * ts + 1.6, ts - 3.2, ts - 3.2);
    }
    texLib.pool = toTex(color);
    texLib.poolNormal = normalFromHeight(height);
  }
  // -------- 混凝土 --------
  {
    const S = 256;
    const color = makeCanvas(S), height = makeCanvas(S);
    const cg = color.getContext('2d'), hg = height.getContext('2d');
    cg.fillStyle = '#8d9b9c'; cg.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    const img = cg.getImageData(0, 0, S, S), himg = hg.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = fbm2(x / 34, y / 34, 5, 21);
      const stain = fbm2(x / 90 + 40, y / 90, 3, 33);
      const shade = 0.78 + n * 0.32 - (stain > 0.66 ? 0.16 : 0);
      const i = (y * S + x) * 4;
      img.data[i] = clamp(150 * shade, 0, 255);
      img.data[i + 1] = clamp(160 * shade, 0, 255);
      img.data[i + 2] = clamp(158 * shade, 0, 255);
      img.data[i + 3] = 255;
      const hv = clamp(120 + (n - 0.5) * 60, 0, 255);
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
    cg.putImageData(img, 0, 0); hg.putImageData(himg, 0, 0);
    // 分格缝
    cg.strokeStyle = 'rgba(60,72,72,0.5)'; cg.lineWidth = 2;
    cg.strokeRect(0.5, 0.5, S - 1, S - 1);
    texLib.concrete = toTex(color);
    texLib.concreteNormal = normalFromHeight(height);
  }
  // -------- 金属拉丝 --------
  {
    const S = 256;
    const color = makeCanvas(S), rough = makeCanvas(S);
    const cg = color.getContext('2d'), rg = rough.getContext('2d');
    cg.fillStyle = '#93a4aa'; cg.fillRect(0, 0, S, S);
    rg.fillStyle = '#5a5a5a'; rg.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * S;
      const a = 0.03 + Math.random() * 0.07;
      cg.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(30,45,50,${a})`;
      cg.beginPath(); cg.moveTo(0, y); cg.lineTo(S, y + (Math.random() - 0.5) * 3); cg.stroke();
      rg.strokeStyle = `rgba(${Math.random() < 0.5 ? 40 : 110},${Math.random() < 0.5 ? 40 : 110},${Math.random() < 0.5 ? 40 : 110},0.2)`;
      rg.beginPath(); rg.moveTo(0, y); rg.lineTo(S, y); rg.stroke();
    }
    texLib.metal = toTex(color);
    texLib.metalRough = toTex(rough, { srgb: false });
  }
  // -------- 警示条纹 --------
  {
    const S = 128;
    const c = makeCanvas(S), g = c.getContext('2d');
    g.fillStyle = '#e8b23a'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1c2226';
    for (let i = -S; i < S * 2; i += 32) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - S, S); g.lineTo(i - S, S);
      g.closePath(); g.fill();
    }
    texLib.hazard = toTex(c);
  }
  // -------- 防滑格栅（粗糙度+法线质感）--------
  {
    const S = 128;
    const c = makeCanvas(S), g = c.getContext('2d');
    g.fillStyle = '#7f8c8e'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = `rgba(210,220,220,${0.16 + Math.random() * 0.2})`;
      g.fillRect(x * 32 + 3, y * 32 + 3, 26, 26);
      g.fillStyle = 'rgba(40,50,52,0.85)';
      g.fillRect(x * 32, y * 32, 32, 2.6);
      g.fillRect(x * 32, y * 32, 2.6, 32);
    }
    texLib.grate = toTex(c);
  }
  // -------- 木材（桑拿 / 长凳）--------
  {
    const S = 256;
    const color = makeCanvas(S), height = makeCanvas(S);
    const cg = color.getContext('2d'), hg = height.getContext('2d');
    cg.fillStyle = '#8a6040'; cg.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (let i = 0; i < 46; i++) {
      const y = Math.random() * S;
      const w = 0.5 + Math.random() * 2.2;
      cg.strokeStyle = Math.random() < 0.5 ? 'rgba(58,36,20,0.20)' : 'rgba(214,176,136,0.12)';
      cg.lineWidth = w;
      cg.beginPath();
      cg.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) cg.lineTo(x, y + Math.sin(x * 0.04 + i) * 4 + (Math.random() - 0.5) * 2);
      cg.stroke();
      hg.strokeStyle = Math.random() < 0.5 ? 'rgba(40,40,40,0.3)' : 'rgba(190,190,190,0.25)';
      hg.lineWidth = w;
      hg.beginPath(); hg.moveTo(0, y); hg.lineTo(S, y + (Math.random() - 0.5) * 3); hg.stroke();
    }
    // 板缝
    cg.fillStyle = 'rgba(38,22,12,0.55)';
    for (let i = 0; i < 4; i++) cg.fillRect(0, i * 64 + 1, S, 2.5);
    texLib.wood = toTex(color);
    texLib.woodNormal = normalFromHeight(height);
  }
  // -------- 标牌：POOLCORE / 方向 / 深水 --------
  texLib.signs = {
    title: makeSign('POOLCORE', '#dff7fa', '#0d2a33', 512, 128),
    deep: makeSign('深水区  DEEP END', '#ffe9b0', '#5a1d12', 512, 128),
    shallow: makeSign('浅水区  SHALLOW', '#bdf5e0', '#0f3a2e', 512, 128),
    exitSign: makeSign('出 口  EXIT', '#d8ffe9', '#0c3a22', 512, 128),
    lane1: makeSign('泳道 1', '#9fd8ea', '#0c2a36', 256, 256),
    lane2: makeSign('泳道 2', '#9fd8ea', '#0c2a36', 256, 256),
    caution: makeSign('注意 湿滑\nCAUTION WET FLOOR', '#ffd66b', '#3a2c08', 512, 256),
    sauna: makeSign('桑 拿  SAUNA', '#ffe0b0', '#3a1f10', 512, 128),
    slide: makeSign('滑 水 道  SLIDE', '#bdf5ff', '#0b3040', 512, 128),
    garden: makeSign('温 室  GARDEN', '#d8ffe0', '#123a24', 512, 128),
    filter: makeSign('过 滤 机 房  FILTER', '#cfe8ff', '#1b2a36', 512, 128),
  };
  // -------- 灯具漫射板 --------
  {
    const S = 128;
    const c = makeCanvas(S), g = c.getContext('2d');
    g.fillStyle = '#f4efe2'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 236 + Math.random() * 18 | 0;
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
    }
    g.fillStyle = 'rgba(120,120,120,0.5)';
    for (let i = 0; i <= 4; i++) { g.fillRect(i * 32 - 1, 0, 2, S); g.fillRect(0, i * 32 - 1, S, 2); }
    texLib.panel = toTex(c, { repeat: false });
  }
  texLib.checker = (() => {
    const S = 64, c = makeCanvas(S), g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#eee';
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
      if ((x + y) % 2 === 0) g.fillRect(x * 32, y * 32, 32, 32);
    return toTex(c);
  })();
}

function makeSign(text, fg, bg, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = Math.max(2, h * 0.035);
  g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
  g.fillStyle = fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  const fs = Math.min(h / (lines.length + 0.6), w / (text.length * 0.62));
  g.font = `600 ${fs}px "PingFang SC","Noto Sans SC",sans-serif`;
  lines.forEach((ln, i) => g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.25));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(150,220,255,0.45)', size = 128) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner); grad.addColorStop(0.38, mid); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softShadowTexture() {
  const size = 128, c = makeCanvas(size), g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.28)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// ---------- 几何 ----------
export function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
export function cyl(rTop, rBot, h, seg, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}
export function quadTo(list, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz]);
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const normals = new Float32Array(18);
  for (let i = 0; i < 6; i++) { normals[i * 3] = nx; normals[i * 3 + 1] = ny; normals[i * 3 + 2] = nz; }
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 3, 4, 5]);
  list.push(geo);
  return geo;
}

/** 三平面世界 UV 工具（给合并几何设置 uv2? 不需要，用 shader 世界坐标） */
export function applyAOTint(geos, aoAt) {
  for (const g of geos) {
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ao = aoAt(pos.getX(i), pos.getY(i), pos.getZ(i));
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

// ---------- 屏幕投影 ----------
const _v = new THREE.Vector3();
export function projectToScreen(pos, camera, w, h) {
  _v.copy(pos).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, visible: _v.z < 1 };
}