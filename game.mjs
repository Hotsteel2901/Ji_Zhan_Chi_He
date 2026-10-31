// ============================================================
//  池核 POOLCORE v3 — 主程序
//  世界 / 玩家 / 枪械 / 敌人 / 水体 / 光照 / 特效 / UI 编排
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { bgm } from './bgm.mjs';

import {
  CELL, H, WATER_Y, SHARD_COUNT, GUNS, GUN_ORDER, ENEMY_TYPES, QUALITY,
  loadSettings, saveSettings, applyPreset, DEFAULT_SETTINGS, EYE,
  SHARD_TYPES, SHARD_ORDER, SHARD_PER_TYPE,
  ECHO_MAX, ECHO_KILL_COST, ECHO_PULSE_RADIUS, ECHO_PULSE_DAMAGE, ECHO_COOLDOWN,
} from './src/config.mjs';
import { clamp, damp, mulberry32, hashStr } from './src/util.mjs';
import { World } from './src/world/world.mjs';
import { materials } from './src/world/build.mjs';
import { WaterSystem } from './src/water.mjs';
import { FX } from './src/fx.mjs';
import { AudioSys } from './src/audio.mjs';
import { Lighting } from './src/lighting.mjs';
import { Player } from './src/player.mjs';
import { WeaponSystem } from './src/weapons.mjs';
import { EnemyManager } from './src/enemies.mjs';
import { UI } from './src/ui.mjs';

const QP = new URLSearchParams(location.search);

// ============================================================
//  设置
// ============================================================
const settings = loadSettings();
if (QP.get('quality') && QUALITY[QP.get('quality')]) applyPreset(settings, QP.get('quality'));

// ============================================================
//  渲染基础
// ============================================================
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;   // 手动重置以统计包含后期在内的总 draw calls
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = settings.exposure / 100;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// PBR 环境反射：低亮度青灰程序化环境图，给金属/玻璃一点反射
// （不用 RoomEnvironment：它会把瓷砖整体照得过亮，破坏池核的暗调）
(() => {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#07141a');
  grad.addColorStop(0.35, '#16343d');
  grad.addColorStop(0.52, '#3f6a74');
  grad.addColorStop(0.56, '#6f949c');
  grad.addColorStop(0.68, '#142830');
  grad.addColorStop(1.00, '#040a0d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 5; i++) {
    const x = 40 + i * 100;
    const lg = g.createRadialGradient(x, 52, 2, x, 52, 46);
    lg.addColorStop(0, 'rgba(210,245,255,0.85)');
    lg.addColorStop(1, 'rgba(120,190,210,0)');
    g.fillStyle = lg;
    g.beginPath(); g.ellipse(x, 52, 46, 12, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(110,200,225,0.10)';
  g.fillRect(0, 150, 512, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.environment = tex;
})();
const SKY_COLOR = 0x8fb3bd;
const UW_COLOR = 0x0d4256;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.FogExp2(SKY_COLOR, 0.018);

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.06, 220);
camera.rotation.order = 'YXZ';
camera.layers.enable(1);   // layer 1 = 枪械视角模型（专用补光）
camera.layers.enable(2);   // layer 2 = 水面（反射相机不渲染）
scene.add(camera);

// ------------------------------------------------------------
// 后期处理
// ------------------------------------------------------------
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSub: { value: 0 },
    uVig: { value: 0.42 }, uGrain: { value: 0.05 }, uAberr: { value: 0.0022 },
    uSat: { value: 1.06 }, uFlash: { value: 0 }, uPixel: { value: 1 },
    uCold: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime,uSub,uVig,uGrain,uAberr,uSat,uFlash,uPixel,uCold;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + uTime*17.0)*43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      float r2 = dot(cc, cc);
      // 水下折射
      uv += vec2(sin(uv.y*38.0 + uTime*2.4), cos(uv.x*31.0 - uTime*2.0)) * 0.0035 * uSub;
      vec3 col;
      float aberr = uAberr * (1.0 + uSub*1.6);
      col.r = texture2D(tDiffuse, uv + cc*r2*aberr*2.4).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - cc*r2*aberr*2.4).b;
      float luma = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(luma), col, uSat);
      // 冷色调 / 水下偏青
      col = mix(col, col*vec3(0.9,1.0,1.05), uCold);
      col = mix(col, col*vec3(0.72,1.0,1.12), uSub*0.85);
      col *= 1.0 - smoothstep(0.32,1.1,r2)*uVig;
      col += (hash(uv*vec2(1920.0,1080.0))-0.5)*uGrain*(1.0-uSub*0.45)*(0.05/max(0.02,uPixel));
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

let composer, renderPass, bloomPass, outputPass, gradePass, fxaaPass, smaaPass;
function buildComposer() {
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bStrength = (settings.bloom / 100) * 0.8;
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), bStrength, 0.66, 0.94);
  composer.addPass(bloomPass);
  outputPass = new OutputPass();
  composer.addPass(outputPass);
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);
  smaaPass = new SMAAPass(innerWidth, innerHeight);
  composer.addPass(smaaPass);
  setAAMode(settings.aa);
}
buildComposer();

function setAAMode(mode) {
  fxaaPass.enabled = mode === 'fxaa';
  smaaPass.enabled = mode === 'smaa';
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.setSize(w / 2, h / 2);
  smaaPass.setSize(w, h);
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
  gradePass.uniforms.uPixel.value = pr;
}
addEventListener('resize', resize);

// ------------------------------------------------------------
// 水面环境反射：64px cubemap，低开销；水面在 layer 2，反射相机看不到自己
// ------------------------------------------------------------
const reflectionRT = new THREE.WebGLCubeRenderTarget(32, {
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
});
const reflectionCam = new THREE.CubeCamera(0.2, 90, reflectionRT);
reflectionCam.position.set(0, 2, 2);
scene.add(reflectionCam);
let reflectionAcc = 0;
let reflectionCaptured = false;
const waterMat = materials().water;
waterMat.uniforms.uEnvMap.value = reflectionRT.texture;
waterMat.uniforms.uEnvK.value = 0;

// ============================================================
//  系统
// ============================================================
const audio = new AudioSys(settings);
const ui = new UI(settings, {
  onStart: () => startRun(false),
  onContinue: () => startRun(true),
  onResume: () => requestLock(),
  onRestart: () => restartRun(),
  onQuit: () => quitToTitle(),
  onJournalClose: () => closeJournal(),
  onSettingsApply: () => applySettings(true),
  onSettingsReset: () => {
    Object.assign(settings, DEFAULT_SETTINGS);
    applySettings(true);
    ui.refreshAll();
    ui.toast('设置已恢复默认', 'good');
  },
  onSettingChange: (k, v) => { applySettings(false, k, v); },
  get settingsBack() { return ui._settingsBack || 'title'; },
  helpBack: 'title',
});
ui.audio = audio;

bgm._onChange = () => updateMusicLabel();

let world = new World(scene, 1337);
let water = new WaterSystem(scene, world, null);
let fx = new FX(scene, camera, settings.particles);
let lighting = new Lighting(scene, world, settings.maxLights);
let player = new Player(world, camera, audio, water, fx);
let weapons = new WeaponSystem(camera, scene, world, water, fx, audio);
let enemies = new EnemyManager(scene, world, fx, audio, water);
fx.ui = ui;
fx.quality = settings.particles;
water.audio = audio;
weapons.player = player;
weapons.enemies = enemies;
weapons.onAmmoChange = () => ui.updateHUD(game, 0);
weapons.onLookDelta = (dp, dy) => { look.pitch += dp; look.yaw += dy; look.pitch = clamp(look.pitch, -1.53, 1.53); };
weapons.onHitmark = (head, kill) => { ui.hitmark(head, kill); };
weapons.onKillFeed = (def, e, head) => { ui.killFeed(e.def.name, head, def.short); };

// ============================================================
//  游戏状态
// ============================================================
const game = {
  time: 0, kills: 0, collected: new Set(), slowmoT: 0, streak: { n: 0, t: -9 },
  shards: [], pickups: [], exitPos: null, exitActive: false, exitMesh: null,
  state: 'boot', fps: 60, drawCalls: 0,
  world, player, weapons, enemies, camera, ui, settings,
  // —— 新系统状态 ——
  shardCounts: { tide: 0, ember: 0, drift: 0, void: 0 },
  shardTypes: [],
  boss: null, bossDefeated: false, bossSpawned: false,
  exitUnlocked: false,
  pulseRings: [],
  quest: { stage: 0, kills: 0, crates: 0, pulses: 0, sideDone: new Set(), stageDone: new Set() },
  questUiT: 0,
  musicMood: 0,
};

// ============================================================
//  任务链 / 支线
// ============================================================
const QUEST_MAIN = [
  { id: 'shards4', title: '回声初响', desc: '在池核中收集 4 枚回声碎片', target: 4, get: () => game.collected.size },
  { id: 'shards8', title: '深水回响', desc: '继续深入，收集 8 枚回声碎片', target: 8, get: () => game.collected.size },
  { id: 'shards12', title: '信标共鸣', desc: '集齐 12 枚碎片，点亮塔顶信标', target: 12, get: () => game.collected.size },
  { id: 'warden', title: '守潮者', desc: '击碎封锁信标的守潮者', target: 1, get: () => game.bossDefeated ? 1 : 0 },
  { id: 'escape', title: '离开池核', desc: '进入塔顶信标，逃出激战池核', target: 1, get: () => game.state === 'win' ? 1 : 0 },
];

const QUEST_SIDE = [
  { id: 'kills', title: '清剿溺影', desc: '击杀 20 只溺影', target: 20, get: () => game.kills, reward: () => { weapons.addAmmoAll(45); ui.toast('支线完成 · 全武器弹药 +45', 'good'); } },
  { id: 'rooms', title: '测绘池核', desc: '探索 14 个房间', target: 14, get: () => world.visits.size, reward: () => { player.heal(30); ui.toast('支线完成 · 生命 +30', 'good'); } },
  { id: 'crates', title: '搜刮补给', desc: '打开 2 个武器补给箱', target: 2, get: () => game.quest.crates, reward: () => { player.echo = Math.min(player.echoMax, player.echo + 1); ui.toast('支线完成 · 回声能量 +1', 'good'); } },
  { id: 'pulses', title: '释放回声', desc: '使用 3 次回声脉冲', target: 3, get: () => game.quest.pulses, reward: () => { weapons.addAmmoAll(30); ui.toast('支线完成 · 弹药 +30', 'good'); } },
];
const look = { yaw: 0, pitch: 0, roll: 0 };
let shake = 0;
let submergeAmt = 0;
let elapsedRun = 0;
let deathHandled = false;
let prevShot = { x: 0, z: 0 };
let cameraIdleT = 0;

// ============================================================
//  输入
// ============================================================
const keys = new Set();
const input = { fwd: 0, strafe: 0, sprint: false, up: false, down: false, fire: false, aim: false };
let pointerLocked = false;

function bindInput() {
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) { keys.add(e.code); return; }
    keys.add(e.code);
    if (e.code === 'Space') player.tryJumpBuffered();
    if (e.code === 'KeyR' && isPlaying()) weapons.startReload();
    if (e.code === 'KeyQ' && isPlaying()) weapons.nextWeapon(-1);
    if (e.code === 'Digit1') weapons.switchTo(GUN_ORDER[0]);
    if (e.code === 'Digit2') weapons.switchTo(GUN_ORDER[1]);
    if (e.code === 'Digit3') weapons.switchTo(GUN_ORDER[2]);
    if (e.code === 'Digit4') weapons.switchTo(GUN_ORDER[3]);
    if (e.code === 'KeyF' && isPlaying()) useEchoPulse();
    if (e.code === 'Tab') { e.preventDefault(); toggleJournal(); }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      settings.exposure = clamp((settings.exposure ?? 78) - 5, 50, 120);
      applySettings(false); ui.toast(`亮度 ${settings.exposure}%`, '');
    }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      settings.exposure = clamp((settings.exposure ?? 78) + 5, 50, 120);
      applySettings(false); ui.toast(`亮度 ${settings.exposure}%`, '');
    }
    if (e.code === 'KeyM') { bgm.toggle(); updateMusicLabel(); }
    if (e.code === 'BracketLeft') { bgm.prev(); updateMusicLabel(); }
    if (e.code === 'BracketRight') { bgm.next(); updateMusicLabel(); }
    if (e.code === 'Escape') {
      if (game.state === 'journal') closeJournal();
      else if (ui.currentScreen === 'settings') ui.showScreen(game.state === 'paused' ? 'pause' : 'title');
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); input.fire = input.aim = false; });

  const canvas = renderer.domElement;
  canvas.addEventListener('mousedown', (e) => {
    if (!isPlaying()) return;
    if (e.button === 0) input.fire = true;
    if (e.button === 2) setAim(true);
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) setAim(false);
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    const sens = 0.0022 * (settings.sens / 55) * (aimHeld || weapons.aimK > 0.4 ? settings.adsSens / 65 : 1);
    look.yaw -= e.movementX * sens;
    look.pitch -= e.movementY * sens * (settings.invertY ? -1 : 1);
    look.pitch = clamp(look.pitch, -1.53, 1.53);
  });
  addEventListener('wheel', (e) => {
    if (!isPlaying()) return;
    weapons.nextWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (pointerLocked) {
      if (game.state === 'paused') resumeGame();
    } else if (game.state === 'playing') {
      pauseGame();
    }
  });
  addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'playing') pauseGame(); });
}

let aimHeld = false;
function setAim(v) {
  if (settings.adsMode === 'toggle') {
    if (v) aimHeld = !aimHeld;
  } else aimHeld = v;
}

const debugInput = { enabled: false, fwd: 0, strafe: 0, sprint: false, up: false, down: false, fire: false, aim: false };

function readInput() {
  if (debugInput.enabled) {
    input.fwd = debugInput.fwd; input.strafe = debugInput.strafe; input.sprint = debugInput.sprint;
    input.up = debugInput.up; input.down = debugInput.down; input.aim = debugInput.aim;
    input.fire = debugInput.fire;
  } else {
    input.fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    input.strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || settings.autoSprint;
    input.up = keys.has('Space');
    input.down = keys.has('KeyC') || keys.has('ControlLeft');
    input.aim = aimHeld;
    input.fire = input.fire && pointerLocked;
  }
  player.input.fwd = input.fwd;
  player.input.strafe = input.strafe;
  player.input.sprint = input.sprint;
  player.input.up = input.up;
  player.input.down = input.down;
  player.input.fire = input.fire;
  player.input.aim = input.aim;
}

function requestLock() {
  const canvas = renderer.domElement;
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

// ============================================================
//  世界 / 局内对象
// ============================================================
function setupWorld(seed) {
  teardownWorld();
  if (lighting && lighting.dispose) lighting.dispose();
  if (water && water.dispose) water.dispose();
  world = new World(scene, seed);
  world.setQuality(settings.preset);
  water = new WaterSystem(scene, world, fx);
  water.audio = audio;
  lighting = new Lighting(scene, world, settings.maxLights);
  game.world = world;
  player.world = world;
  player.water = water;
  weapons.world = world;
  weapons.water = water;
  enemies.world = world;
  enemies.water = water;
  // 预生成出生区与目标
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) world.ensureCell(dx, dz);
  world.warmup(0, 0);
  player.pos.set(0, 0.1, 2.0);
  player.vel.set(0, 0, 0);
  player.hp = 100;
  player.dead = false;
  player.fallPeak = player.pos.y;
  const g = world.groundAt(0, 0, 2, 1.5);
  if (g.found) player.pos.y = g.y + 0.02;

  buildShards();
  buildExit();
  buildWeaponCrates();
  if (world.prewarm) world.prewarm(0, 0, 1);
}

function teardownWorld() {
  for (const [, chunk] of world.chunks) world.unloadChunk(chunk);
  for (const s of game.shards) scene.remove(s.group);
  if (game.exitMesh) scene.remove(game.exitMesh);
  for (const p of game.pickups) scene.remove(p.group);
  game.shards = [];
  game.pickups = [];
  game.exitMesh = null;
  game.exitActive = false;
  game.exitPos = null;
  enemies.clear();
  fx.ui = ui;
  document.getElementById('exitHint').classList.remove('show');
}

// ------------------------------------------------------------
// 碎片
// ------------------------------------------------------------
function buildShards() {
  for (const s of game.shards) scene.remove(s.group);
  game.shards = [];
  const plan = world.shardPlan(SHARD_COUNT, hashStr('shards' + world.seed));
  const rand = mulberry32(world.seed ^ 0x5eed);

  // 四类各三枚，按种子洗牌
  const types = [];
  for (const id of SHARD_ORDER) for (let k = 0; k < SHARD_PER_TYPE; k++) types.push(id);
  const trng = mulberry32((world.seed ^ 0xa53f7b) >>> 0);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(trng() * (i + 1));
    const t = types[i]; types[i] = types[j]; types[j] = t;
  }
  game.shardTypes = types.slice();
  game.collectOrder = [];

  plan.forEach((entry, i) => {
    const spot = { ...entry.spot };
    const vol = world.waterAt(spot.x, spot.z);
    if (vol && spot.y < vol.surface) spot.y = vol.surface + 0.45;
    const type = types[i % types.length];
    const group = makeShardMesh(rand, i, type);
    const gemY = spot.y + 0.85;
    group.position.set(spot.x, gemY, spot.z);
    scene.add(group);
    game.shards.push({ entry, group, baseY: gemY, collected: false, type, idx: i });
  });
  ui.setShardPlan(types);
}

function makeShardMesh(rand, i, typeId) {
  const type = SHARD_TYPES[typeId] || SHARD_TYPES.tide;
  const color = type.color;
  const g = new THREE.Group();

  let coreGeo;
  if (typeId === 'ember') coreGeo = new THREE.TetrahedronGeometry(0.34);
  else if (typeId === 'drift') coreGeo = new THREE.IcosahedronGeometry(0.3, 0);
  else if (typeId === 'void') coreGeo = new THREE.DodecahedronGeometry(0.28);
  else coreGeo = new THREE.OctahedronGeometry(0.3);

  const core = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: color, emissiveIntensity: 2.8, roughness: 0.14, metalness: 0.4,
  }));
  g.add(core);

  const cage = new THREE.Mesh(
    typeId === 'void' ? new THREE.DodecahedronGeometry(0.52, 0) : new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({
      color: 0x0d2228, emissive: color, emissiveIntensity: 0.5,
      roughness: 0.35, metalness: 0.85, wireframe: true,
    })
  );
  g.add(cage);

  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.012, 6, 32), ringMat);
  ringA.rotation.x = Math.PI / 2;
  ringA.name = 'ringA';
  g.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.009, 6, 28), ringMat.clone());
  ringB.rotation.set(Math.PI / 2, 0, 0.72);
  ringB.name = 'ringB';
  g.add(ringB);

  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: shardGlow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  spr.scale.set(2.1, 2.1, 1);
  g.add(spr);

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.14, 42, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 20;
  beam.name = 'beam';
  g.add(beam);

  const disc = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.72, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.85;
  disc.name = 'disc';
  g.add(disc);

  g.userData.i = i;
  g.userData.type = typeId;
  void rand;
  return g;
}
const shardGlow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.42, 'rgba(220,240,248,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ------------------------------------------------------------
// 出口
// ------------------------------------------------------------
function buildExit() {
  if (game.exitMesh) { scene.remove(game.exitMesh); game.exitMesh = null; }
  const plan = world.exitPlan(hashStr('exit' + world.seed));
  game.exitPos = new THREE.Vector3(plan.spot.x, plan.spot.y, plan.spot.z);
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.13, 12, 44),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9a8, emissiveIntensity: 0.7, roughness: 0.3 }));
  ring.name = 'ring';
  g.add(ring);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff4cf, transparent: true, opacity: 0.16, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.name = 'inner';
  g.add(inner);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: exitGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  spr.scale.set(6, 6, 1);
  spr.name = 'exitSprite';
  g.add(spr);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 60, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffdf8a, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 29;
  beam.name = 'exitBeam';
  g.add(beam);
  g.position.set(plan.spot.x, plan.spot.y + 1.1, plan.spot.z);
  scene.add(g);
  game.exitMesh = g;
  setExitState('dormant');
}
const exitGlow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.4, 'rgba(255,200,120,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ------------------------------------------------------------
// 武器箱 / 掉落
// ------------------------------------------------------------
function buildWeaponCrates() {
  const planRifle = world.shardPlan(3, hashStr('crate-rifle' + world.seed));
  const planShot = world.shardPlan(3, hashStr('crate-shot' + world.seed));
  const place = (entry, kind) => {
    const vol = world.waterAt(entry.spot.x, entry.spot.z);
    let y = entry.spot.y;
    if (vol && y < vol.surface) y = vol.surface + 0.1;
    spawnPickup(kind, new THREE.Vector3(entry.spot.x, y + 0.45, entry.spot.z), true);
  };
  place(planRifle[1] || planRifle[0], 'rifle');
  place(planShot[2] || planShot[0], 'shotgun');
}

const pickupGlowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,200,120,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

function spawnPickup(kind, pos, isCrate = false) {
  const isHealth = kind === 'health';
  const isAmmo = kind === 'ammo';
  const color = isHealth ? 0x54ff9a : isAmmo ? 0xffc766 : 0x6fd8ff;
  const g = new THREE.Group();
  if (isCrate) {
    const boxM = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1c2a30, roughness: 0.5, metalness: 0.5 }));
    g.add(boxM);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.52),
      new THREE.MeshStandardMaterial({ color: 0x123, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 }));
    trim.position.y = 0.18;
    g.add(trim);
  } else {
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(isHealth ? 0.24 : 0.2),
      new THREE.MeshStandardMaterial({ color: isHealth ? 0x8fffab : 0xffd77a, emissive: isHealth ? 0x2adf6a : 0xe89b28, emissiveIntensity: 2.2, roughness: 0.3 }));
    g.add(core);
  }
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: pickupGlowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  spr.scale.setScalar(isCrate ? 2.2 : 1.6);
  g.add(spr);
  g.position.copy(pos);
  scene.add(g);
  game.pickups.push({ kind, group: g, baseY: pos.y, t: 0, crate: isCrate });
}

// ============================================================
//  玩家受伤 / 状态
// ============================================================
player.onDamage = (amount, cause) => {
  ui.damageFlash();
  shake += clamp(amount * 0.03, 0.25, 0.8);
  if (cause === 'fall') {
    const arc = ui.damageArc(0);
    arc.angle = 0;
  }
};

function hurtFrom(amount, sourcePos) {
  player.damage(amount, 'enemy');
  if (sourcePos) {
    const dx = sourcePos.x - player.pos.x, dz = sourcePos.z - player.pos.z;
    const worldYaw = Math.atan2(-dx, -dz);   // 与相机 yaw 约定一致：forward = (-sin yaw, -cos yaw)
    let rel = worldYaw - look.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const slot = ui.damageArc(rel);
    slot.angle = rel;
  }
}

enemies.onAttackPlayer = (e) => {
  hurtFrom(e.def.damage, e.pos);
  shake += 0.4;
  e.attackAnim = 0.3;
};
enemies.onProjectileHit = (p) => {
  hurtFrom(p.damage, p.mesh.position);
  shake += 0.25;
};
enemies.onBossSlamWind = (e, radius) => {
  spawnPulseRing(e.pos, radius, 0xff5a44, 0.72, 0);
};
enemies.onBossSlam = (e, radius) => {
  spawnPulseRing(e.pos, radius, 0xffcf7a, 1.2, 0.62);
  shake += 0.95;
  fx.burst(e.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffcf7a, 26, 5.5, 0.7, 0.08, { grav: 6, up: 0.4 });
  const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
  if (d < radius && Math.abs(player.pos.y - e.pos.y) < 4.5) {
    hurtFrom(e.def.damage * 1.4, e.pos);
  }
};
enemies.onBossSummon = () => {
  ui.toast('守潮者唤出了溺影', 'warn');
  audio.growl('drowned');
};
enemies.onBossEnrage = () => {
  ui.banner('守潮者 · 怒潮', 2.0);
  audio.alarm();
  spawnPulseRing(player.pos, 14, 0xff6a55, 0.8, 0.9);
};
enemies.onDeath = (e) => {
  game.kills++;
  // 每 8 杀回复声能量
  if (game.kills % ECHO_KILL_COST === 0 && player.echo < player.echoMax) {
    player.echo++;
    ui.toast('回声能量 +1 · 按 F 释放', 'good');
    audio.chime();
  }
  if (e.def.boss) { onBossDeath(e); return; }
  streakOnKill();
  // 掉落
  const drop = Math.random();
  const pos = e.pos.clone();
  pos.y += 0.4;
  if (Math.random() < 0.34) spawnPickup('health', pos);
  else if (drop < 0.72) spawnPickup('ammo', pos);
};

function streakOnKill() {
  const st = game.streak;
  if (game.time - st.t < 4.5) st.n++; else st.n = 1;
  st.t = game.time;
  if (st.n >= 2) {
    audio.streak(st.n);
    if (st.n >= 3) {
      const healed = player.heal(Math.min(28, st.n * 4));
      if (healed > 0) ui.healFlash();
    }
  }
}

// ============================================================
//  回声碎片 / 脉冲 / 守潮者 / 任务日志
// ============================================================
function applyShard(s) {
  const t = SHARD_TYPES[s.type];
  if (!t) return;
  const n = (game.shardCounts[s.type] = (game.shardCounts[s.type] || 0) + 1);

  if (t.maxHp) { player.maxHp += t.maxHp; player.heal(t.heal); }
  if (t.damage) weapons.damageMult += t.damage;
  if (t.speed) {
    player.speedMult += t.speed;
    player.reloadMult = Math.max(0.5, player.reloadMult - t.reload);
    weapons.reloadMult = player.reloadMult;
  }
  if (t.fireRate) weapons.fireRateMult += t.fireRate;
  if (t.echo) {
    player.echoMax = Math.min(6, player.echoMax + t.echo);
    player.echo = Math.min(player.echoMax, player.echo + 1);
  }

  // 通用小收益
  player.heal(8);
  weapons.addAmmoAll(6);
  player.boostT = 2.2;
  ui.markShard(game.collected.size - 1, t);

  // 同类三枚 → 共鸣
  if (n === SHARD_PER_TYPE) {
    if (s.type === 'tide') { player.maxHp += 30; player.hp = player.maxHp; }
    else if (s.type === 'ember') { weapons.damageMult += 0.15; weapons.headBonus += 0.2; }
    else if (s.type === 'drift') {
      player.speedMult += 0.15;
      player.reloadMult = Math.max(0.4, player.reloadMult * 0.8);
      weapons.reloadMult = player.reloadMult;
    } else if (s.type === 'void') {
      weapons.fireRateMult += 0.15;
      player.echoMax = Math.min(6, player.echoMax + 1);
      player.echo = player.echoMax;
    }
    ui.banner(t.resonance, 3.4);
    ui.toast(t.resonance, 'good');
    audio.resonance();
    spawnPulseRing(player.pos, 7, t.color, 0.7, 0);
    fx.burst(player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), t.color, 30, 4.5, 0.9, 0.08, { grav: 2 });
    shake += 0.25;
  }

  const total = game.collected.size;
  if (total === 4) {
    player.echo = Math.min(player.echoMax, player.echo + 1);
    player.heal(18);
    weapons.addAmmoAll(24);
    ui.toast('回声共鸣 · 获得 1 点回声能量', 'good');
  } else if (total === 8) {
    const isNew = weapons.unlock('rail');
    if (isNew) {
      ui.banner('获得 · 深渊长矛 轨道枪', 3);
      ui.toast('按 4 切换轨道枪 · 穿透一切', 'good');
      audio.chime();
    }
  } else if (total >= SHARD_COUNT) {
    activateExit();
  }
}

function useEchoPulse() {
  if (!isPlaying() || player.dead) return;
  if (player.echoCd > 0) return;
  if (player.echo <= 0) {
    ui.toast('回声能量不足 · 击杀溺影充能', 'warn');
    audio.dryFire();
    return;
  }
  player.echo--;
  player.echoCd = ECHO_COOLDOWN;
  game.quest.pulses++;
  const origin = player.pos.clone();
  const radius = ECHO_PULSE_RADIUS;
  const base = ECHO_PULSE_DAMAGE * (1 + 0.2 * (game.shardCounts.void || 0));
  const dir = new THREE.Vector3();
  let hit = 0;
  for (const e of enemies.enemies) {
    if (e.dying) continue;
    const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z;
    const dy = e.pos.y - origin.y;
    const d = Math.hypot(dx, dz);
    if (d > radius || Math.abs(dy) > 6.5) continue;
    dir.set(dx, 0, dz).normalize();
    e.vel.x += dir.x * 8.5;
    e.vel.z += dir.z * 8.5;
    e.vel.y = Math.max(e.vel.y, 2.5);
    e.spottedT = Math.max(e.spottedT, 6);
    enemies.damage(e, base * (1 - 0.4 * (d / radius)), 'body', e.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), dir);
    hit++;
  }
  spawnPulseRing(origin, radius, 0x9fe8ff, 1.0, 0);
  spawnPulseRing(origin, radius * 0.62, 0xc79bff, 1.15, 0.08);
  fx.burst(origin.clone().add(new THREE.Vector3(0, 1.1, 0)), 0x9fe8ff, 34, 6.5, 0.65, 0.075, { grav: 1, up: 0.25 });
  audio.echoPulse();
  shake += 0.32;
  ui.flashEcho();
  if (hit === 0) ui.toast('回声脉冲 · 范围内没有目标', '');
}

function spawnPulseRing(pos, radius, color = 0x9fe8ff, dur = 0.9, delay = 0) {
  const geo = new THREE.TorusGeometry(1, 0.045, 6, 64);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, pos.y + 0.14, pos.z);
  m.scale.setScalar(0.2);
  m.frustumCulled = false;
  scene.add(m);
  game.pulseRings.push({ m, t: -delay, dur: Math.max(0.15, dur), radius });
}

function updatePulseRings(dt) {
  for (let i = game.pulseRings.length - 1; i >= 0; i--) {
    const r = game.pulseRings[i];
    r.t += dt;
    if (r.t < 0) { r.m.visible = false; continue; }
    r.m.visible = true;
    const k = clamp(r.t / r.dur, 0, 1);
    const s = 0.2 + (r.radius - 0.2) * (1 - Math.pow(1 - k, 3));
    r.m.scale.set(s, s, s);
    r.m.material.opacity = (1 - k) * 0.9;
    if (k >= 1) {
      scene.remove(r.m);
      r.m.geometry.dispose();
      r.m.material.dispose();
      game.pulseRings.splice(i, 1);
    }
  }
}

// ---------- 守潮者 ----------
function setExitState(mode) {
  const g = game.exitMesh;
  if (!g) return;
  const ring = g.getObjectByName('ring');
  const inner = g.getObjectByName('inner');
  const beam = g.getObjectByName('exitBeam');
  const sprite = g.getObjectByName('exitSprite');
  const sealed = mode === 'sealed';
  const open = mode === 'open';
  const ringColor = sealed ? 0xff5a44 : open ? 0xffe9a8 : 0x7ce7ff;
  const fillColor = sealed ? 0xff7a5c : open ? 0xfff4cf : 0xbfeaff;
  const beamColor = sealed ? 0xff5a44 : open ? 0xffdf8a : 0x7ce7ff;
  if (ring) {
    ring.material.emissive.setHex(ringColor);
    ring.material.emissiveIntensity = sealed ? 0.95 : open ? 3.4 : 0.65;
  }
  if (inner) {
    inner.material.color.setHex(fillColor);
    inner.material.opacity = sealed ? 0.1 : open ? 0.46 : 0.14;
  }
  if (beam) {
    beam.material.color.setHex(beamColor);
    beam.material.opacity = sealed ? 0.02 : open ? 0.065 : 0.04;
  }
  if (sprite) sprite.material.color.setHex(sealed ? 0xff7a5c : 0xffffff);
}

function spawnBossAtExit() {
  if (!game.exitPos || game.bossSpawned) return;
  game.bossSpawned = true;
  setExitState('sealed');
  let spot = null;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = game.exitPos.x + Math.cos(a) * 4.2;
    const z = game.exitPos.z + Math.sin(a) * 4.2;
    const g = world.groundAt(x, z, game.exitPos.y + 2.5, 2.5);
    if (g.found && Math.abs(g.y - game.exitPos.y) < 2.2 && !world.blocked(x, g.y + 0.1, z, 1.0, 2.5)) {
      spot = { x, y: g.y, z };
      break;
    }
  }
  if (!spot) spot = { x: game.exitPos.x + 3, y: game.exitPos.y, z: game.exitPos.z };
  const e = enemies.spawn('warden', spot.x, spot.y + 0.06, spot.z);
  game.boss = e;
  audio.bossRoar();
  ui.banner('守潮者 · 潮母苏醒', 3.4);
  ui.toast('它封锁了信标 —— 击败它才能离开', 'warn');
  fx.burst(new THREE.Vector3(spot.x, spot.y + 1.8, spot.z), 0xffc858, 40, 6, 1.1, 0.09, { grav: 3 });
  shake += 0.6;
}

function onBossDeath(e) {
  game.bossDefeated = true;
  game.exitUnlocked = true;
  game.boss = null;
  game.slowmoT = 2.4;
  audio.bossDeath();
  setTimeout(() => audio.portalOpen(), 650);
  setExitState('open');
  ui.setExitHint('出口信标已点亮 —— 前往塔顶信标');
  ui.banner('守潮者已沉没 · 信标解锁', 4.0);
  ui.toast('进入金色信标，离开激战池核', 'good');
  shake += 1.2;
  player.echo = player.echoMax;
  player.heal(35);
  const p = e.pos.clone();
  for (let i = 0; i < 3; i++) {
    const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3));
    spawnPickup(i === 0 ? 'health' : 'ammo', q);
  }
  if (weapons.slots.rail.unlocked) {
    const s = weapons.slots.rail;
    s.reserve = Math.min(s.def.maxReserve, s.reserve + 16);
    s.ammo = s.def.magSize;
  }
  fx.burst(p.clone().add(new THREE.Vector3(0, 1.6, 0)), 0xffc858, 60, 8, 1.4, 0.1, { grav: 2.5, up: 1 });
}

// ---------- 任务 ----------
function updateQuest(dt) {
  const q = game.quest;
  const stage = QUEST_MAIN[q.stage];
  if (stage) {
    const val = stage.get();
    if (val >= stage.target) {
      q.stage++;
      if (!q.stageDone.has(stage.id)) {
        q.stageDone.add(stage.id);
        audio.objective();
        if (stage.id !== 'escape') {
          ui.banner('目标完成 · ' + stage.title, 2.2);
          ui.toast(stage.title + ' · ' + stage.desc, 'good');
        }
      }
    }
  }
  for (const s of QUEST_SIDE) {
    if (q.sideDone.has(s.id)) continue;
    if (s.get() >= s.target) {
      q.sideDone.add(s.id);
      audio.objective();
      ui.banner('支线完成 · ' + s.title, 1.8);
      s.reward();
    }
  }
  q.stageDone.size; // noop guard
  game.questUiT -= dt;
  if (game.questUiT <= 0) {
    game.questUiT = 0.15;
    refreshObjective();
  }
}

function refreshObjective() {
  const stage = QUEST_MAIN[Math.min(QUEST_MAIN.length - 1, game.quest.stage)];
  if (!stage) return;
  const val = Math.min(stage.target, stage.get());
  ui.setObjective(stage.title, stage.desc, val, stage.target, game.collected.size, SHARD_COUNT);
  const side = QUEST_SIDE.find(q => !game.quest.sideDone.has(q.id) && q.get() < q.target);
  if (side) ui.setSideQuest('支线 · ' + side.title + ' ' + Math.min(side.target, side.get()) + '/' + side.target);
  else ui.setSideQuest('支线全部完成');
  if (game.exitActive) {
    ui.setExitHint(game.exitUnlocked ? '出口信标已点亮 —— 前往塔顶信标' : '信标被守潮者封锁 —— 击败它');
  }
}

function buildJournalData() {
  const stage = QUEST_MAIN[Math.min(QUEST_MAIN.length - 1, game.quest.stage)];
  const m = Math.floor(elapsedRun / 60), s = Math.floor(elapsedRun % 60);
  return {
    stageIndex: game.quest.stage,
    main: QUEST_MAIN.map((q, i) => ({
      title: q.title, desc: q.desc, target: q.target,
      value: Math.min(q.target, q.get()),
      done: i < game.quest.stage && !(q.id === 'escape' && game.state !== 'win'),
      active: i === game.quest.stage,
    })),
    side: QUEST_SIDE.map(q => ({
      title: q.title, desc: q.desc, target: q.target,
      value: Math.min(q.target, q.get()),
      done: game.quest.sideDone.has(q.id),
    })),
    shardCounts: { ...game.shardCounts },
    shardTotal: game.collected.size,
    shardCount: SHARD_COUNT,
    stats: {
      kills: game.kills,
      rooms: world.visits.size,
      time: String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'),
      bossDefeated: game.bossDefeated,
    },
    bonuses: {
      damage: Math.round((weapons.damageMult - 1) * 100),
      fireRate: Math.round((weapons.fireRateMult - 1) * 100),
      speed: Math.round((player.speedMult - 1) * 100),
      reload: Math.round((1 - player.reloadMult) * 100),
      maxHp: player.maxHp,
    },
    track: bgm.current,
    trackIndex: bgm.idx,
    trackCount: bgm.tracks.length,
    musicPlaying: bgm.playing,
  };
}

function openJournal() {
  if (game.state !== 'playing') return;
  game.state = 'journal';
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear(); input.fire = false; input.aim = false; aimHeld = false;
  bgm.setPaused(true);
  ui.renderJournal(buildJournalData());
  ui.showScreen('journal');
  audio.ui('click');
}

function closeJournal() {
  if (game.state !== 'journal') return;
  game.state = 'playing';
  ui.showScreen('none');
  bgm.setPaused(false);
  requestLock();
  audio.ui('click');
}

function toggleJournal() {
  if (game.state === 'playing') openJournal();
  else if (game.state === 'journal') closeJournal();
}

// ============================================================
//  生成 / 更新
// ============================================================
const spawnRng = mulberry32(0x1234abcd);

function updateSpawns(dt) {
  const grace = game.time > 8;
  const target = grace ? Math.min(13, 4 + Math.floor(game.kills / 3) + Math.floor(game.time / 50)) : 0;
  if (enemies.countAlive() >= target) return;
  if (spawnRng() > dt * 1.6) return;
  const typeRoll = spawnRng();
  const tier = Math.min(2, Math.floor(game.time / 70) + (game.kills > 12 ? 1 : 0));
  let type = 'drowned';
  if (tier >= 2 && typeRoll < 0.16) type = 'brute';
  else if (tier >= 1 && typeRoll < 0.4) type = 'stalker';
  else if (typeRoll < 0.62) type = 'drowned';
  else if (typeRoll < 0.8) type = 'spitter';
  else type = 'stalker';

  // 水中涌现优先（离玩家近的水体）
  if (spawnRng() < 0.4) {
    const vols = world.waterVolumes.filter(v => {
      const cx = (v.minX + v.maxX) / 2, cz = (v.minZ + v.maxZ) / 2;
      const d = Math.hypot(cx - player.pos.x, cz - player.pos.z);
      return d > 8 && d < 34;
    });
    if (vols.length) {
      const v = vols[Math.floor(spawnRng() * vols.length)];
      const x = v.minX + spawnRng() * (v.maxX - v.minX);
      const z = v.minZ + spawnRng() * (v.maxZ - v.minZ);
      enemies.spawn(type, x, 0, z, { emerge: true });
      return;
    }
  }
  const spot = world.randomSpot(spawnRng, player.pos.x, player.pos.z, 13, 30, player.pos.y);
  if (spot) enemies.spawn(type, spot.x, spot.y + 0.05, spot.z);
}

function updatePickups(dt) {
  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const o = game.pickups[i];
    o.t += dt;
    o.group.rotation.y += dt * 1.6;
    o.group.position.y = o.baseY + Math.sin(game.time * 2.4 + o.t) * 0.12;
    const d = o.group.position.distanceTo(player.pos);
    if (d < (o.crate ? 1.5 : 1.2)) {
      if (o.kind === 'health') {
        const healed = player.heal(30);
        if (healed > 0) ui.healFlash();
        ui.toast('+30 生命', 'good');
        audio.pickup('health');
      } else if (o.kind === 'ammo') {
        weapons.addAmmoAll(30);
        ui.toast('+30 弹药', 'good');
        audio.pickup('ammo');
      } else {
        const isNew = weapons.unlock(o.kind);
        weapons.switchTo(o.kind);
        ui.banner(isNew ? `获得武器 · ${GUNS[o.kind].name}` : `${GUNS[o.kind].name} 弹药补满`);
        const key = o.kind === 'rifle' ? '2' : o.kind === 'shotgun' ? '3' : '4';
        ui.toast(`按 ${key} 切换`, 'good');
        audio.chime();
        fx.burst(o.group.position, 0x6fd8ff, 16, 3.2, 0.7, 0.06, { grav: 3 });
        if (o.crate) game.quest.crates++;
      }
      scene.remove(o.group);
      game.pickups.splice(i, 1);
    }
  }
}

function updateShards(dt) {
  for (const s of game.shards) {
    if (s.collected) continue;
    const t = game.time;
    s.group.rotation.y += dt * 1.15;
    s.group.position.y = s.baseY + Math.sin(t * 1.8 + s.entry.index) * 0.14;
    const ringA = s.group.getObjectByName('ringA');
    const ringB = s.group.getObjectByName('ringB');
    if (ringA) { ringA.rotation.z += dt * 0.9; ringA.rotation.y += dt * 0.35; }
    if (ringB) { ringB.rotation.z -= dt * 1.3; ringB.rotation.x += dt * 0.4; }
    const disc = s.group.getObjectByName('disc');
    if (disc) { const k = 0.85 + Math.sin(t * 2.2 + s.entry.index) * 0.15; disc.scale.setScalar(k); }
    const beam = s.group.getObjectByName('beam');
    if (beam) beam.material.opacity = 0.11 + Math.abs(Math.sin(t * 0.7 + s.entry.index)) * 0.03;
    if (s.group.position.distanceTo(player.pos) < 1.75) {
      s.collected = true;
      game.collected.add(s.entry.index);
      game.collectOrder.push(s.type);
      scene.remove(s.group);
      const type = SHARD_TYPES[s.type] || SHARD_TYPES.tide;
      audio.shardType(s.type);
      ui.toast(`${type.name} · ${type.desc}`, 'good');
      ui.toast(`回声碎片 ${game.collected.size} / ${SHARD_COUNT}`, '');
      fx.burst(s.group.position, type.color, 24, 3.8, 0.85, 0.075, { grav: 2 });
      spawnPulseRing(s.group.position, 3.2, type.color, 0.55, 0);
      shake += 0.12;
      applyShard(s);
    }
  }
}

function activateExit() {
  if (game.exitActive) return;
  game.exitActive = true;
  game.slowmoT = 2.4;
  audio.slowmo(true);
  audio.chime();
  setExitState('sealed');
  ui.banner('信标共鸣 · 守潮者苏醒', 3.6);
  ui.toast('塔顶信标被守潮者封锁 —— 击败它', 'warn');
  ui.setExitHint('信标被守潮者封锁 —— 击败它');
  spawnBossAtExit();
}

function checkExit() {
  if (!game.exitActive || !game.exitUnlocked || !game.exitPos) return;
  if (game.exitPos.distanceTo(player.pos) < 2.8) {
    winRun();
  }
}

// ============================================================
//  屏幕流转
// ============================================================
function isPlaying() { return game.state === 'playing'; }

function startRun(continueRun) {
  audio.init();
  audio.resume();
  const seedStr = ui.getSeed();
  const seed = seedStr ? hashStr(seedStr) : (game._runSeed || (Date.now() % 100000 | 1));
  if (world.seed !== seed || continueRun === 'fresh') {
    // 种子变化才重建世界（重建后同步把出生区建好，避免开局亮雾/白闪）
    game._runSeed = seed;
    setupWorld(seed);
  } else {
    game._runSeed = seed;
  }
  resetRunState();
  game.state = 'playing';
  ui.showScreen('none');
  ui.setPauseSub(`回声碎片 ${game.collected.size} / ${SHARD_COUNT}`);
  bgm.start();
  bgm.setVolume(settings.volMusic / 100);
  bgm.setPaused(false);
  updateMusicLabel();
  ui.fadeFromBlack(560);
  requestLock();
  ui.banner('进入激战池核', 1.6);
}

function resetRunState() {
  enemies.clear();
  game.time = 0;
  elapsedRun = 0;
  game.kills = 0;
  game.collected = new Set();
  game.slowmoT = 0;
  game.streak = { n: 0, t: -9 };
  deathHandled = false;
  game.exitActive = false;
  game.exitUnlocked = false;
  game.boss = null;
  game.bossSpawned = false;
  game.bossDefeated = false;
  game.shardCounts = { tide: 0, ember: 0, drift: 0, void: 0 };
  game.shardTypes = [];
  game.collectOrder = [];
  game.quest = { stage: 0, kills: 0, crates: 0, pulses: 0, sideDone: new Set(), stageDone: new Set() };
  game.questUiT = 0;
  game.musicMood = 0;
  for (const r of game.pulseRings) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }
  game.pulseRings = [];

  player.pos.set(0, 0.1, 2.0);
  const g = world.groundAt(0, 0, 2, 1.5);
  if (g.found) player.pos.y = g.y + 0.02;
  player.vel.set(0, 0, 0);
  player.hp = 100;
  player.maxHp = 100;
  player.dead = false;
  player.fallPeak = player.pos.y;
  player.boostT = 0;
  player.speedMult = 1;
  player.reloadMult = 1;
  player.echoMax = ECHO_MAX;
  player.echo = 1;
  player.echoCd = 0;
  look.yaw = 0; look.pitch = 0;

  weapons.damageMult = 1;
  weapons.fireRateMult = 1;
  weapons.reloadMult = 1;
  weapons.headBonus = 0;
  weapons.slots.smg.unlocked = true;
  weapons.slots.rifle.unlocked = false;
  weapons.slots.shotgun.unlocked = false;
  weapons.slots.rail.unlocked = false;
  weapons.slots.smg.ammo = GUNS.smg.magSize;
  weapons.slots.smg.reserve = GUNS.smg.reserve;
  weapons.slots.rifle.ammo = 0; weapons.slots.rifle.reserve = 0;
  weapons.slots.shotgun.ammo = 0; weapons.slots.shotgun.reserve = 0;
  weapons.slots.rail.ammo = 0; weapons.slots.rail.reserve = 0;
  weapons.currentId = 'smg';

  // 重建碎片与出口
  buildShards();
  buildExit();
  for (const p of game.pickups) scene.remove(p.group);
  game.pickups = [];
  buildWeaponCrates();
  refreshObjective();
}

function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  ui.setPauseSub(`回声碎片 ${game.collected.size} / ${SHARD_COUNT} · 击杀 ${game.kills}`);
  ui._settingsBack = 'pause';
  ui.showScreen('pause');
  input.fire = false; input.aim = false; aimHeld = false;
  keys.clear();
  bgm.setPaused(true);
}
function resumeGame() {
  game.state = 'playing';
  ui.showScreen('none');
  bgm.setPaused(false);
  requestLock();
}
function restartRun() {
  startRun(false);   // 保留当前种子，复用/重建同一座建筑
}
function quitToTitle() {
  game.state = 'title';
  ui._settingsBack = 'title';
  ui.showScreen('title');
  if (document.pointerLockElement) document.exitPointerLock();
  bgm.stop();
  updateMusicLabel();
}
function gameOver() {
  if (deathHandled) return;
  deathHandled = true;
  game.state = 'dead';
  if (document.pointerLockElement) document.exitPointerLock();
  ui.setDeadStats(statsHTML());
  ui.showScreen('dead');
  bgm.setPaused(true);
}
function winRun() {
  game.state = 'win';
  if (document.pointerLockElement) document.exitPointerLock();
  ui.setWinStats(statsHTML());
  ui.showScreen('win');
  audio.chime();
  bgm.setPaused(true);
}
function statsHTML() {
  const m = Math.floor(elapsedRun / 60), s = Math.floor(elapsedRun % 60);
  const echoes = `潮 ${game.shardCounts.tide} · 烬 ${game.shardCounts.ember} · 漂 ${game.shardCounts.drift} · 虚 ${game.shardCounts.void}`;
  return `回声碎片 <b>${game.collected.size}/${SHARD_COUNT}</b> · 击杀 <b>${game.kills}</b><br>` +
    `碎片构成 <b>${echoes}</b><br>` +
    (game.bossDefeated ? '守潮者 <b>已沉没</b> · ' : '') +
    `探索房间 <b>${world.visits.size}</b> · 用时 <b>${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</b><br>` +
    `种子 <b>${ui.getSeed() || '随机'}</b>`;
}

// ============================================================
//  设置应用
// ============================================================
function applySettings(save = false, key = null, value = null) {
  if (key === 'preset') {
    applyPreset(settings, value);
    ui.refreshAll();
  }
  const pr = Math.min(devicePixelRatio || 1, 1.6) * clamp(settings.resScale, 0.5, 1);
  renderer.setPixelRatio(pr);
  renderer.toneMappingExposure = settings.exposure / 100;
  bloomPass.strength = (settings.bloom / 100) * 0.8;
  bloomPass.enabled = settings.bloom > 0;
  lighting.setMaxLights(settings.maxLights);
  fx.setQuality(settings.particles);
  world.setQuality(settings.preset);
  gradePass.uniforms.uGrain.value = settings.grain * 0.012;
  gradePass.uniforms.uVig.value = 0.42;
  setAAMode(settings.aa);
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  audio.applySettings();
  bgm.setVolume(settings.volMusic / 100);
  resize();
  if (save) {
    saveSettings(settings);
    ui.toast('设置已保存', 'good');
  }
}

function updateMusicLabel() {
  const cur = bgm.current;
  ui.setMusicLabel(cur && bgm.playing
    ? `♪ ${cur.name} · ${cur.en} · ${cur.bpm} BPM`
    : '♪ 五首程序化 D&B · 待机');
}

// ============================================================
//  模拟
// ============================================================
function simStep(dt) {
  game.time += dt;
  elapsedRun += dt;
  if (game.slowmoT > 0) game.slowmoT = Math.max(0, game.slowmoT - dt);

  if (player.hurtCd > 0) player.hurtCd = Math.max(0, player.hurtCd - dt);
  if (player.echoCd > 0) player.echoCd = Math.max(0, player.echoCd - dt);
  player.boostT = Math.max(0, player.boostT - dt);
  readInput();
  player.update(dt, game.time);
  weapons.update(dt, input, enemies);
  enemies.update(dt, player);
  water.update(dt);
  fx.update(dt, game.time);
  updatePickups(dt);
  updateShards(dt);
  updateSpawns(dt);
  updateQuest(dt);
  updatePulseRings(dt);
  checkExit();

  // 音乐跟随战斗强度（探索轻盈 / 战斗加层 / 首领压迫）
  const bossAlive = !!(game.boss && !game.boss.dying);
  const aliveN = enemies.countAlive();
  const moodTarget = clamp(
    0.10 + aliveN * 0.052 + (bossAlive ? 0.28 : 0) + (player.hp < 40 ? 0.16 : 0) + (game.slowmoT > 0 ? 0.08 : 0),
    0, 1
  );
  game.musicMood = damp(game.musicMood, moodTarget, 1.6, dt);
  bgm.setIntensity(game.musicMood);
  bgm.setUnderwater(player.submerged);

  // 罗盘目标
  const targets = [];
  if (bossAlive) {
    targets.push({ pos: game.boss.pos, color: '#ff6a55', kind: 'boss' });

    targets.push({ pos: game.exitPos, color: game.exitUnlocked ? '#ffcf7a' : '#ff6a55', kind: 'exit' });
  } else {
    let best = null, bd = Infinity;
    for (const s of game.shards) {
      if (s.collected) continue;
      const d = s.group.position.distanceToSquared(player.pos);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) targets.push({ pos: best.group.position, color: '#7ce7ff', kind: 'shard' });
  }
  game.compassTargets = targets.map(t => {
    const dx = t.pos.x - player.pos.x, dz = t.pos.z - player.pos.z;
    const dy = t.pos.y - (player.pos.y + 1.6);
    return {
      yaw: Math.atan2(-dx, -dz), color: t.color, kind: t.kind,
      vertical: Math.abs(dy) > 3.2 ? (dy > 0 ? 1 : -1) : 0,
      dist: Math.hypot(dx, dz),
      pos: t.pos.clone(),
    };
  });
  game.playerYaw = look.yaw;

  // 交互提示
  let prompt = '';
  let nearPickup = null;
  for (const o of game.pickups) {
    const d = o.group.position.distanceTo(player.pos);
    if (d < 2.6) { nearPickup = o; break; }
  }
  if (nearPickup) {
    const label = nearPickup.kind === 'health' ? '生命包' : nearPickup.kind === 'ammo' ? '弹药' : GUNS[nearPickup.kind].name;
    prompt = '靠近拾取 · ' + label;
  }
  if (game.exitActive && game.exitPos && game.exitPos.distanceTo(player.pos) < 8) {
    prompt = game.exitUnlocked ? '进入信标 · 逃离池核' : '击败守潮者 · 信标被封锁';
  }
  ui.setPrompt(prompt);

  // 冲刺 / 瞄准 FOV
  const sprintFov = (player.speedNow > 5 && input.sprint) ? 4 : 0;
  const targetFov = settings.fov + sprintFov - (settings.fov - weapons.def.adsFov) * weapons.aimK;
  camera.fov = damp(camera.fov, targetFov, 10, dt);
  camera.updateProjectionMatrix();

  if (player.dead) gameOver();
  audio.tick(dt);
}

// ============================================================
//  主循环
// ============================================================
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0;

function updateCamera(dt) {
  const eye = EYE - player.crouch;
  const bob = player.bobY;
  camera.position.set(player.pos.x, player.pos.y + eye + bob, player.pos.z);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.06;
    camera.position.y += (Math.random() - 0.5) * shake * 0.06;
    camera.position.z += (Math.random() - 0.5) * shake * 0.06;
    shake *= Math.max(0, 1 - 8 * dt);
  }
  camera.rotation.set(look.pitch, look.yaw, 0);
}

function updateEnvironment(dt) {
  const t = game.time;
  const mat = materials();
  mat.water.uniforms.uTime.value = t;
  mat.shaft.uniforms.uTime.value = t;
  mat.caustic.map.offset.x = t * 0.014;
  mat.caustic.map.offset.y = t * 0.011;
  // 水下 / 空中过渡
  submergeAmt = damp(submergeAmt, player.submerged ? 1 : 0, 6, dt);
  gradePass.uniforms.uSub.value = submergeAmt;
  gradePass.uniforms.uTime.value += dt;
  const uwK = submergeAmt;
  scene.fog.color.setHex(SKY_COLOR).lerp(new THREE.Color(UW_COLOR), uwK);
  scene.background.copy(scene.fog.color);
  scene.fog.density = 0.018 + uwK * 0.06;
  audio.setWater(player.inWater, player.submerged);
  audio.setUnderwater(player.submerged && submergeAmt > 0.5);
  ui.setUnderwater(player.submerged && submergeAmt > 0.45);
  ui.setSlowmo(game.slowmoT > 0);
  lighting.setUnderwater(player.submerged);

  // 水面：玩家尾迹 + 周期性环境反射
  const wm = mat.water;
  wm.uniforms.uPlayer.value.set(player.pos.x, player.pos.z);
  const envTarget = settings.preset === 'ultra' ? 0.55 : settings.preset === 'high' ? 0.4 : 0.22;
  wm.uniforms.uEnvK.value = damp(wm.uniforms.uEnvK.value, envTarget, 2.5, dt);
  reflectionAcc += dt;
  const wantLiveReflect = (settings.preset === 'high' || settings.preset === 'ultra') && game.fps > 47;
  if (reflectionAcc > 0.85 && game.state === 'playing' && (wantLiveReflect || !reflectionCaptured)) {
    reflectionAcc = 0;
    reflectionCaptured = true;
    reflectionCam.position.set(camera.position.x, Math.max(WATER_Y + 1.05, camera.position.y), camera.position.z);
    reflectionCam.update(renderer, scene);
  }
}

function animate() {
  requestAnimationFrame(animate);
  renderer.info.reset();
  const rawDt = Math.min(clock.getDelta(), 0.05);
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc > 0.4) { game.fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  const dt = game.slowmoT > 0 ? rawDt * 0.35 : rawDt;

  if (game.state === 'playing') {
    simStep(dt);
    world.update(player.pos.x, player.pos.z);
    lighting.update(dt, camera.position, player.submerged, camera);
    updateCamera(dt);
    updateEnvironment(dt);
    ui.updateHUD(game, rawDt);
    ui.el.hud.classList.remove('hidden');
  } else {
    // 空闲：世界保持渲染，轻微动画
    game.time += rawDt;
    if (game.state === 'title') {
      cameraIdleT += rawDt;
      const r = 7.5;
      camera.position.set(Math.sin(cameraIdleT * 0.1) * r, 2.6, Math.cos(cameraIdleT * 0.1) * r + 2);
      camera.lookAt(0, 1.6, 0);
      look.yaw = camera.rotation.y;
    } else {
      updateCamera(rawDt);
    }
    world.update(camera.position.x, camera.position.z);
    lighting.update(rawDt, camera.position, false, camera);
    water.update(rawDt);
    fx.update(rawDt, game.time);
    updatePulseRings(rawDt);
    updateEnvironment(rawDt);
    if (game.state === 'dead' || game.state === 'win') {
      enemies.update(rawDt * 0.3, player);
    }
  }

  // 环境动画（碎片/出口/水面）
  for (const s of game.shards) {
    if (s.collected) continue;
    s.group.rotation.y += dt * 1.2;
  }
  if (game.exitMesh) {
    const ring = game.exitMesh.getObjectByName('ring');
    if (ring) ring.rotation.z += dt * (game.exitActive ? 1.4 : 0.4);
    game.exitMesh.rotation.y += dt * 0.3;
  }

  game.drawCalls = renderer.info.render.calls;
  if (NOPOST) renderer.render(scene, camera);
  else composer.render();
}
const NOPOST = QP.get('nopost') === '1';

// ============================================================
//  启动
// ============================================================
function boot() {
  bindInput();
  ui.setSeed(QP.get('seed') || '');
  ui.showScreen('loading');
  applySettings(false);

  // 初始世界：标题背景用
  const seedStr = QP.get('seed');
  const seed = seedStr ? hashStr(seedStr) : 20240817;
  game._runSeed = seed;
  setupWorld(seed);
  player.pos.set(0, 0.1, 2);

  // 淡出加载
  let pct = 0;
  const steps = ['正在注水……', '铺贴瓷砖……', '点亮灯管……', '注入回声……', '校准 D&B 节拍……'];
  const timer = setInterval(() => {
    pct += 0.2;
    ui.setLoading(Math.min(1, pct), steps[Math.min(steps.length - 1, Math.floor(pct * steps.length))]);
    if (pct >= 1) {
      clearInterval(timer);
      if (game.state !== 'boot') return;
      ui.showScreen('title');
      game.state = 'title';
      ui._settingsBack = 'title';
      updateMusicLabel();
    }
  }, 110);
  animate();
}
boot();

// ============================================================
//  调试钩子（无头测试用）
// ============================================================
window.__pc = {
  game, world: () => world, player, weapons, enemies, ui, audio, settings, camera, bgm, scene, renderer,
  water: () => water, fx, lighting: () => lighting,
  look,
  pulse: () => useEchoPulse(),
  openJournal: () => openJournal(),
  closeJournal: () => closeJournal(),
  boss: () => game.boss,
  quest: () => game.quest,
  setState: (s) => { game.state = s; ui.showScreen(s === 'playing' ? 'none' : s); },
  startGame: () => { startRun(false); game.state = 'playing'; ui.showScreen('none'); },
  step: (dt) => { if (game.state === 'playing') { simStep(dt); world.update(player.pos.x, player.pos.z); lighting.update(dt, camera.position, player.submerged, camera); updateCamera(dt); updateEnvironment(dt); ui.updateHUD(game, dt); } },
  teleport: (x, y, z) => { player.pos.set(x, y, z); player.vel.set(0, 0, 0); },
  setInput: (o) => { Object.assign(debugInput, o); debugInput.enabled = true; },
  clearInput: () => { debugInput.enabled = false; debugInput.fwd = debugInput.strafe = 0; debugInput.sprint = debugInput.up = debugInput.down = debugInput.fire = debugInput.aim = false; },
  setLook: (yaw, pitch) => { look.yaw = yaw; look.pitch = pitch; },
  fire: () => weapons.fire(),
  reload: () => weapons.startReload(),
  spawnEnemy: (type, x, y, z) => enemies.spawn(type || 'stalker', x ?? player.pos.x + 5, y ?? player.pos.y, z ?? player.pos.z),
  hurtPlayer: (n) => hurtFrom(n, null),
  collectNearest: () => {
    let best = null, bd = Infinity;
    for (const s of game.shards) { if (s.collected) continue; const d = s.group.position.distanceToSquared(player.pos); if (d < bd) { bd = d; best = s; } }
    if (best) { player.pos.copy(best.group.position); }
  },
  forceShards: () => {
    for (const s of game.shards) {
      if (s.collected) continue;
      s.collected = true; game.collected.add(s.entry.index); scene.remove(s.group);
    }
    activateExit();
  },
  getState: () => game.state,
  getExit: () => game.exitPos,
  stats: () => ({ calls: renderer.info.render.calls, cells: world.cells.size, chunks: world.chunks.size, enemies: enemies.countAlive(), fps: game.fps, state: game.state, music: bgm._probe() }),
};
