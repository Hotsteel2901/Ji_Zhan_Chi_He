// ============================================================
//  POOLCORE v3 — 全局配置 / 画质档位 / 玩家设置
// ============================================================

export const CELL = 14;                 // 房间格边长（米）
export const H = CELL / 2;
export const WALL_T = 0.42;             // 墙厚
export const SLAB_T = 0.42;             // 楼板厚
export const FLOOR_H = 5.4;             // 一层净高
export const Y1 = FLOOR_H + SLAB_T;     // 二层楼面 ≈5.82
export const Y2 = Y1 + FLOOR_H + SLAB_T; // 塔楼三层楼面 ≈11.64
export const CEIL_H = 5.0;              // 有上层时一层顶到二层板底
export const INSET = 0.2;               // 内壁内缩

export const DOOR_W = 5.2;              // 底层门洞宽
export const DOOR_H = 3.4;              // 底层门洞高
export const UDOOR_W = 4.6;             // 上层走道连接口宽
export const UDOOR_H = 2.9;

export const WALK_RING = 2.6;           // 上层环廊宽度
export const EYE = 1.62;
export const PLAYER_H = 1.8;
export const PLAYER_R = 0.4;

export const GRAV = 24;
export const JUMP_V = 7.9;
export const AUTO_STEP = 0.62;
export const COYOTE = 0.14;
export const JUMP_BUF = 0.15;
export const WALK = 4.8, SPRINT = 7.6, AIR_CTRL = 2.8, SWIM_V = 3.4, SWIM_UP = 4.4, WADE = 3.1;

export const WATER_Y = -0.4;            // 全局水面高度
export const WATER_DEEP = 2.6;          // 深水
export const WATER_SHALLOW = 1.15;      // 浅水

export const CHUNK = 4;                 // 区块 = 4x4 房间
export const RENDER_DIST = 1;           // 渲染半径（区块）
export const SHARD_COUNT = 12;

export const MAX_HP = 100;
export const REGEN_DELAY = 7;
export const REGEN_RATE = 9;
export const FALL_SAFE = 5.6;

export const GUNS = {
  smg: {
    id: 'smg', name: '回声-9 冲锋枪', short: 'ECHO-9',
    kind: 'auto', damage: 15, headMult: 1.7, legMult: 0.82,
    rpm: 750, magSize: 30, reserve: 120, maxReserve: 240,
    spread: 0.016, adsSpread: 0.006, bloomPerShot: 0.0085, bloomMax: 0.05,
    recoilV: 0.75, recoilH: 0.42, kick: 0.55,
    falloffStart: 18, falloffEnd: 46, falloffMin: 0.55,
    reloadTime: 1.5, range: 90, penetration: 1, adsFov: 58, moveMult: 1.0,
  },
  rifle: {
    id: 'rifle', name: '破浪者 步枪', short: 'TIDEBREAKER',
    kind: 'auto', damage: 26, headMult: 2.0, legMult: 0.85,
    rpm: 520, magSize: 25, reserve: 100, maxReserve: 200,
    spread: 0.011, adsSpread: 0.0028, bloomPerShot: 0.012, bloomMax: 0.055,
    recoilV: 1.35, recoilH: 0.55, kick: 0.9,
    falloffStart: 30, falloffEnd: 70, falloffMin: 0.7,
    reloadTime: 1.85, range: 130, penetration: 2, adsFov: 50, moveMult: 0.95,
  },
  shotgun: {
    id: 'shotgun', name: '浅滩 霰弹枪', short: 'SHOAL',
    kind: 'pump', damage: 11, pellets: 9, headMult: 1.35, legMult: 0.8,
    rpm: 68, magSize: 6, reserve: 36, maxReserve: 72,
    spread: 0.05, adsSpread: 0.034, bloomPerShot: 0.01, bloomMax: 0.06,
    recoilV: 3.6, recoilH: 0.8, kick: 2.2,
    falloffStart: 7, falloffEnd: 22, falloffMin: 0.25,
    reloadTime: 2.6, range: 40, penetration: 1, adsFov: 62, moveMult: 0.9,
  },
  rail: {
    id: 'rail', name: '深渊长矛 轨道枪', short: 'ABYSS LANCE',
    kind: 'rail', damage: 210, headMult: 2.4, legMult: 0.9,
    rpm: 48, magSize: 4, reserve: 16, maxReserve: 36,
    spread: 0.0022, adsSpread: 0.0004, bloomPerShot: 0.018, bloomMax: 0.03,
    recoilV: 4.4, recoilH: 0.55, kick: 2.8,
    falloffStart: 90, falloffEnd: 200, falloffMin: 0.85,
    reloadTime: 2.8, range: 180, penetration: 5, penWidth: 2.4,
    adsFov: 42, moveMult: 0.86, rail: true,
  },
};
export const GUN_ORDER = ['smg', 'rifle', 'shotgun', 'rail'];

export const ENEMY_TYPES = {
  drowned: {
    id: 'drowned', name: '溺影', hp: 52, speed: 4.5, damage: 9, attackCd: 0.9,
    scale: 0.82, aggro: 30, eye: 0x54ffd8, score: 10, radius: 0.42, headY: 1.52,
    swimSpeed: 2.6, stagger: 0.7,
  },
  stalker: {
    id: 'stalker', name: '潜渊者', hp: 105, speed: 3.2, damage: 15, attackCd: 1.15,
    scale: 1.0, aggro: 34, eye: 0xff7a3d, score: 20, radius: 0.48, headY: 1.7,
    swimSpeed: 2.2, stagger: 0.5,
  },
  brute: {
    id: 'brute', name: '渊重装', hp: 300, speed: 2.35, damage: 26, attackCd: 1.7,
    scale: 1.42, aggro: 38, eye: 0xff3057, score: 50, radius: 0.68, headY: 2.05,
    swimSpeed: 1.6, stagger: 0.28,
  },
  spitter: {
    id: 'spitter', name: '喷吐者', hp: 78, speed: 2.9, damage: 12, attackCd: 1.9,
    scale: 0.95, aggro: 32, eye: 0xb6ff4a, score: 30, radius: 0.46, headY: 1.62,
    swimSpeed: 2.0, stagger: 0.6, ranged: true, projectileSpeed: 26,
  },
  warden: {
    id: 'warden', name: '守潮者', hp: 1500, speed: 2.25, damage: 30, attackCd: 1.6,
    scale: 1.75, aggro: 70, eye: 0xffc858, score: 500, radius: 0.95, headY: 3.0,
    swimSpeed: 1.4, stagger: 0.07, boss: true,
  },
};

// ------------------------------------------------------------
//  回声碎片：四类，每类三枚；集齐同类触发“共鸣”
// ------------------------------------------------------------
export const SHARD_ORDER = ['tide', 'ember', 'drift', 'void'];
export const SHARD_PER_TYPE = 3;
export const SHARD_TYPES = {
  tide: {
    id: 'tide', name: '潮汐碎片', short: '潮', color: 0x67e0ff, css: '#67e0ff',
    maxHp: 10, heal: 22, desc: '生命上限 +10 · 回复 22',
    resonance: '共鸣 · 潮汐心脏：生命上限 +30，立刻全恢复',
  },
  ember: {
    id: 'ember', name: '余烬碎片', short: '烬', color: 0xff9a5c, css: '#ff9a5c',
    damage: 0.07, desc: '武器伤害 +7%',
    resonance: '共鸣 · 余烬膛线：武器伤害 +15%，爆头伤害 +20%',
  },
  drift: {
    id: 'drift', name: '漂流碎片', short: '漂', color: 0x8effc0, css: '#8effc0',
    speed: 0.06, reload: 0.07, desc: '移速 +6% · 换弹 +7%',
    resonance: '共鸣 · 漂流本能：移速 +15%，换弹速度 +20%',
  },
  void: {
    id: 'void', name: '虚空碎片', short: '虚', color: 0xc79bff, css: '#c79bff',
    fireRate: 0.06, echo: 1, desc: '射速 +6% · 回声能量 +1',
    resonance: '共鸣 · 虚空过载：射速 +15%，回声能量上限 +1',
  },
};

export const ECHO_MAX = 3;
export const ECHO_KILL_COST = 8;
export const ECHO_PULSE_RADIUS = 10;
export const ECHO_PULSE_DAMAGE = 60;
export const ECHO_COOLDOWN = 1.1;

export const QUALITY = {
  low:    { resScale: 0.7,  bloom: 0,    maxLights: 3,  particles: 0.45, grain: 0, aa: 'off',  renderDist: 1, shadows: false, waterSubdiv: 14 },
  medium: { resScale: 0.85, bloom: 14,   maxLights: 5,  particles: 0.7,  grain: 4, aa: 'fxaa', renderDist: 1, shadows: false, waterSubdiv: 20 },
  high:   { resScale: 1.0,  bloom: 22,   maxLights: 8,  particles: 1.0,  grain: 5, aa: 'fxaa', renderDist: 1, shadows: false, waterSubdiv: 28 },
  ultra:  { resScale: 1.0,  bloom: 30,  maxLights: 11, particles: 1.35, grain: 6, aa: 'smaa', renderDist: 2, shadows: true,  waterSubdiv: 36 },
};

export const DEFAULT_SETTINGS = {
  preset: 'high', resScale: 1.0, fov: 82, exposure: 78, bloom: 22,
  maxLights: 8, particles: 1.0, grain: 5, aa: 'fxaa', perf: false,
  volMaster: 80, volMusic: 62, volSfx: 85, muffle: 70,
  sens: 55, adsSens: 65, invertY: false, adsMode: 'hold', autoSprint: false,
  crosshairColor: '#dcfaff', crosshairStyle: 'cross', crosshairSize: 8, crosshairGap: 5, crosshairDot: true,
};

const LS_KEY = 'poolcore.settings.v3d';

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch (e) { /* ignore */ }
  const clampN = (k, a, b) => { if (typeof s[k] === 'number') s[k] = Math.max(a, Math.min(b, s[k])); };
  clampN('exposure', 50, 120);
  clampN('bloom', 0, 110);
  clampN('resScale', 0.5, 1);
  clampN('maxLights', 2, 12);
  clampN('particles', 0.2, 1.5);
  clampN('grain', 0, 12);
  clampN('fov', 65, 110);
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

export function applyPreset(s, preset) {
  const q = QUALITY[preset];
  if (!q) return s;
  s.preset = preset;
  s.resScale = q.resScale;
  s.bloom = q.bloom;
  s.maxLights = q.maxLights;
  s.particles = q.particles;
  s.grain = q.grain;
  s.aa = q.aa;
  return s;
}

export const SEED = (() => {
  const q = new URLSearchParams(location.search).get('seed');
  if (!q) return null;
  let n = 0;
  for (const ch of q) n = ((n << 5) - n + ch.charCodeAt(0)) | 0;
  return Math.abs(n) || 1;
})();

export const HAS_URL_SEED = new URLSearchParams(location.search).has('seed');

export function randomSeed() {
  return (Math.floor(Math.random() * 899999) + 100000).toString(36).toUpperCase();
}