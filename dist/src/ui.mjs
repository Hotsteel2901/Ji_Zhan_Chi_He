// ============================================================
//  UI：菜单流转 / HUD / 设置 / 小地图 / 罗盘 / 伤害反馈
// ============================================================
import { projectToScreen, clamp } from './util.mjs';
import { GUN_ORDER, SHARD_COUNT, CELL, SHARD_TYPES, SHARD_ORDER } from './config.mjs';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(settings, handlers = {}) {
    this.settings = settings;
    this.handlers = handlers;
    this.audio = null;
    this.el = {};
    for (const id of [
      'hud', 'shardNum', 'shardPips', 'compassWrap', 'compassNeedle', 'compassVert', 'compassDist', 'compassWrap', 'crystalMarker', 'crystalDist', 'minimap', 'mapCoord', 'killfeed',
      'streakBanner', 'exitHint', 'healthNum', 'healthFill', 'healthDelayed', 'statusRow',
      'objTitle', 'objSub', 'objSide', 'echoHud', 'echoCharges', 'bossBar', 'bossFill', 'bossPct',
      'screen-journal', 'journalBody', 'btnJournalBack',
      'weaponSlots', 'weaponName', 'ammoMag', 'ammoReserve', 'reloadFill', 'fireMode',
      'moveState', 'prompt', 'crosshair', 'hitmarker', 'dmgdir', 'dmgNumbers', 'interactDot',
      'perf', 'banner', 'fx-underwater', 'fx-damage', 'fx-lowhp', 'fx-heal', 'fx-slowmo', 'fx-fade',
      'screen-loading', 'loadingFill', 'loadingText', 'screen-title', 'screen-settings', 'screen-pause',
      'screen-dead', 'screen-win', 'screen-help', 'seedInput', 'musicLabel', 'pauseSub',
      'deadStats', 'winStats', 'toasts',
      'btnStart', 'btnContinue', 'btnSettings', 'btnHelp', 'btnResume', 'btnPauseSettings',
      'btnRestart', 'btnQuit', 'btnDeadRetry', 'btnDeadQuit', 'btnWinAgain', 'btnWinQuit',
      'btnSettingsBack', 'btnSettingsApply', 'btnSettingsReset', 'btnHelpBack', 'seedRandom', 'seedCopy',
    ]) this.el[id] = $(id);

    this.currentScreen = 'loading';
    this.dmgNumbers = [];
    this.dmgArcs = [];
    this.toastTimer = [];
    this.killMsgs = [];
    this.shardPips = [];
    this.lastPips = -1;
    this.perfAcc = 0;
    this._setupPips();
    this._setupDamageArcs();
    this._setupSegments();
    this._bindMenus();
    this._bindCrosshair();
  }

  // ----------------------------------------------------------
  // 屏幕流转
  // ----------------------------------------------------------
  showScreen(name) {
    const map = {
      loading: 'screen-loading', title: 'screen-title', settings: 'screen-settings',
      pause: 'screen-pause', dead: 'screen-dead', win: 'screen-win', help: 'screen-help',
      journal: 'screen-journal', none: null,
    };
    for (const k in map) {
      const id = map[k];
      if (!id) continue;
      const el = this.el[id];
      if (el) el.classList.toggle('hidden', k !== name);
    }
    const hudVisible = name === 'none';
    this.el.hud.classList.toggle('hidden', !hudVisible);
    this.currentScreen = name;
  }

  setLoading(pct, text) {
    this.el.loadingFill.style.width = Math.round(pct * 100) + '%';
    if (text) this.el.loadingText.textContent = text;
  }

  toast(text, kind = '') {
    const div = document.createElement('div');
    div.className = 'toast ' + kind;
    div.textContent = text;
    this.el.toasts.appendChild(div);
    setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 420); }, 2600);
    if (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  }

  banner(text, dur = 2.2) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), dur * 1000);
  }

  killFeed(enemyName, head, weaponName) {
    const div = document.createElement('div');
    div.className = 'kill-msg' + (head ? ' head' : '');
    div.innerHTML = `${head ? '⌖ 爆头 ' : ''}${enemyName} <span style="opacity:.5">·</span> ${weaponName}`;
    this.el.killfeed.appendChild(div);
    if (this.el.killfeed.children.length > 4) this.el.killfeed.firstChild.remove();
    setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 520); }, 3200);
  }

  _setupPips() {
    const pips = this.el.shardPips;
    pips.innerHTML = '';
    this.shardPips = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      const p = document.createElement('i');
      pips.appendChild(p);
      this.shardPips.push(p);
    }
  }

  _setupDamageArcs() {
    const svg = this.el.dmgdir;
    svg.innerHTML = '';
    this.dmgArcs = [];
    for (let i = 0; i < 6; i++) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(path);
      this.dmgArcs.push({ path, t: 0, angle: 0, active: false });
    }
  }

  damageArc(angle) {
    const slot = this.dmgArcs.find(a => !a.active) || this.dmgArcs[0];
    slot.active = true; slot.t = 0; slot.angle = angle;
    return slot;
  }

  _updateDamageArcs(dt) {
    for (const a of this.dmgArcs) {
      if (!a.active) continue;
      a.t += dt;
      const k = clamp(a.t / 0.9, 0, 1);
      const span = Math.PI * 0.34;
      const r0 = 76, r1 = 88;
      const a0 = a.angle - span / 2, a1 = a.angle + span / 2;
      a.path.setAttribute('d', describeArc(r0, a0, a1));
      a.path.setAttribute('stroke-width', String(9 * (1 - k * 0.3)));
      a.path.setAttribute('opacity', String(Math.max(0, 1 - k)));
      if (k >= 1) { a.active = false; a.path.setAttribute('d', ''); }
      void r1;
    }
  }

  _setupSegments() {
    // 分段按钮绑定
    const segs = [
      ['setPreset', 'preset', null], ['setAA', 'aa', null], ['setPerf', 'perf', (v) => v === '1'],
      ['setInvert', 'invertY', (v) => v === '1'], ['setAdsMode', 'adsMode', null],
      ['setAutoSprint', 'autoSprint', (v) => v === '1'],
    ];
    for (const [id, key, conv] of segs) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const raw = btn.dataset.v;
        const val = conv ? conv(raw) : raw;
        this.settings[key] = val;
        this._refreshSeg(id, key, conv);
        this.audio && this.audio.ui('click');
        this.handlers.onSettingChange && this.handlers.onSettingChange(key, val);
      });
    }
    // 滑块
    const ranges = [
      ['setResScale', 'outResScale', 'resScale', (v) => v + '%'],
      ['setFov', 'outFov', 'fov', (v) => v + '°'],
      ['setExposure', 'outExposure', 'exposure', (v) => String(v)],
      ['setBloom', 'outBloom', 'bloom', (v) => String(v)],
      ['setLights', 'outLights', 'maxLights', (v) => String(v)],
      ['setParticles', 'outParticles', 'particles', (v) => (v / 100).toFixed(1) + 'x'],
      ['setGrain', 'outGrain', 'grain', (v) => String(v)],
      ['setVolMaster', 'outVolMaster', 'volMaster', (v) => v + '%'],
      ['setVolMusic', 'outVolMusic', 'volMusic', (v) => v + '%'],
      ['setVolSfx', 'outVolSfx', 'volSfx', (v) => v + '%'],
      ['setMuffle', 'outMuffle', 'muffle', (v) => v + '%'],
      ['setSens', 'outSens', 'sens', (v) => (v / 100).toFixed(2)],
      ['setAdsSens', 'outAdsSens', 'adsSens', (v) => (v / 100).toFixed(2)],
    ];
    for (const [id, out, key, fmt] of ranges) {
      const input = $(id);
      if (!input) continue;
      const update = () => {
        const v = Number(input.value);
        this.settings[key] = key === 'particles' ? v / 100 : v;
        $(out).textContent = fmt(v);
      };
      input.addEventListener('input', update);
      input.addEventListener('change', () => {
        this.handlers.onSettingChange && this.handlers.onSettingChange(key, this.settings[key]);
      });
      input._update = update;
    }
    this.refreshAll();
  }

  _bindCrosshair() {
    const ch = this.el.crosshair;
    const apply = () => {
      const s = this.settings;
      ch.style.setProperty('--ch-color', s.crosshairColor || '#dcfaff');
      ch.style.setProperty('--ch-len', (s.crosshairSize || 8) + 'px');
      ch.style.setProperty('--ch-gap', (s.crosshairGap || 5) + 'px');
      ch.style.setProperty('--ch-dot', s.crosshairDot ? '2.5px' : '0px');
      ch.classList.toggle('hidden-style', s.crosshairStyle === 'dot');
    };
    apply();
  }

  setCrosshairGap(px) {
    this.el.crosshair.style.setProperty('--ch-gap', px.toFixed(1) + 'px');
  }

  hitmark(head, kill) {
    const hm = this.el.hitmarker;
    hm.classList.remove('show', 'kill');
    void hm.offsetWidth;
    if (kill) hm.classList.add('kill');
    hm.classList.add('show');
    this.el.crosshair.classList.add('hit');
    clearTimeout(this._chT);
    this._chT = setTimeout(() => this.el.crosshair.classList.remove('hit'), 90);
  }

  _refreshSeg(id, key, conv) {
    const el = $(id);
    if (!el) return;
    const cur = this.settings[key];
    for (const b of el.querySelectorAll('button')) {
      const raw = b.dataset.v;
      const val = conv ? conv(raw) : raw;
      b.classList.toggle('active', String(val) === String(cur));
    }
  }

  refreshAll() {
    const s = this.settings;
    const setVal = (id, out, key) => {
      const input = $(id);
      if (!input) return;
      const display = key === 'particles' ? Math.round(s[key] * 100) : s[key];
      input.value = display;
      if (input._update) input._update();
    };
    setVal('setResScale', 'outResScale', 'resScale');
    setVal('setFov', 'outFov', 'fov');
    setVal('setExposure', 'outExposure', 'exposure');
    setVal('setBloom', 'outBloom', 'bloom');
    setVal('setLights', 'outLights', 'maxLights');
    setVal('setParticles', 'outParticles', 'particles');
    setVal('setGrain', 'outGrain', 'grain');
    setVal('setVolMaster', 'outVolMaster', 'volMaster');
    setVal('setVolMusic', 'outVolMusic', 'volMusic');
    setVal('setVolSfx', 'outVolSfx', 'volSfx');
    setVal('setMuffle', 'outMuffle', 'muffle');
    setVal('setSens', 'outSens', 'sens');
    setVal('setAdsSens', 'outAdsSens', 'adsSens');
    this._refreshSeg('setPreset', 'preset');
    this._refreshSeg('setAA', 'aa');
    this._refreshSeg('setPerf', 'perf', (v) => v === '1');
    this._refreshSeg('setInvert', 'invertY', (v) => v === '1');
    this._refreshSeg('setAdsMode', 'adsMode');
    this._refreshSeg('setAutoSprint', 'autoSprint', (v) => v === '1');
  }

  _bindMenus() {
    const click = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { this.audio && this.audio.ui(); fn(); }); };
    const h = this.handlers;
    click('btnStart', () => h.onStart && h.onStart());
    click('btnContinue', () => h.onContinue && h.onContinue());
    click('btnSettings', () => this.showScreen('settings'));
    click('btnHelp', () => this.showScreen('help'));
    click('btnHelpBack', () => this.showScreen(h.helpBack || 'title'));
    click('btnJournalBack', () => { if (h.onJournalClose) h.onJournalClose(); else this.showScreen('none'); });
    click('btnResume', () => h.onResume && h.onResume());
    click('btnPauseSettings', () => this.showScreen('settings'));
    click('btnSettingsBack', () => this.showScreen(h.settingsBack || 'title'));
    click('btnSettingsApply', () => { h.onSettingsApply && h.onSettingsApply(); this.showScreen(h.settingsBack || 'title'); });
    click('btnSettingsReset', () => { h.onSettingsReset && h.onSettingsReset(); this.refreshAll(); });
    click('btnRestart', () => h.onRestart && h.onRestart());
    click('btnQuit', () => h.onQuit && h.onQuit());
    click('btnDeadRetry', () => h.onRestart && h.onRestart());
    click('btnDeadQuit', () => h.onQuit && h.onQuit());
    click('btnWinAgain', () => h.onRestart && h.onRestart());
    click('btnWinQuit', () => h.onQuit && h.onQuit());
    click('seedRandom', () => {
      const v = Math.floor(Math.random() * 899999 + 100000).toString(36).toUpperCase();
      this.el.seedInput.value = v;
    });
    click('seedCopy', () => {
      const v = this.el.seedInput.value || '';
      if (navigator.clipboard) navigator.clipboard.writeText(v).catch(() => {});
      this.toast('种子已复制：' + (v || '随机'), 'good');
    });
    // 标签页
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('hidden', p.dataset.page !== tab.dataset.tab));
      });
    }
  }

  setSeed(seed) {
    if (this.el.seedInput) this.el.seedInput.value = seed || '';
  }
  getSeed() {
    return (this.el.seedInput && this.el.seedInput.value.trim()) || null;
  }

  // ----------------------------------------------------------
  //  v4：碎片 / 目标 / 回声 / 首领 / 日志
  // ----------------------------------------------------------
  setShardPlan(types) {
    this.shardPlan = types;
    this._echoMax = -1;
  }

  markShard(index, type) {
    const pip = this.shardPips[index];
    if (!pip) return;
    pip.classList.add('on');
    if (type && type.css) pip.style.setProperty('--pip', type.css);
  }

  setObjective(title, desc, val, target) {
    if (this.el.objTitle && this._objTitle !== title) {
      this.el.objTitle.textContent = title;
      this._objTitle = title;
    }
    if (this.el.objSub) {
      const txt = desc + ' · ' + val + '/' + target;
      if (this._objSub !== txt) {
        this.el.objSub.textContent = txt;
        this._objSub = txt;
      }
    }
  }

  setExitHint(text) {
    const el = this.el.exitHint;
    if (!el) return;
    if (this._exitText !== text) {
      el.innerHTML = '<span class="beacon-ico"></span>' + text;
      this._exitText = text;
    }
  }

  setSideQuest(text) {
    if (!this.el.objSide) return;
    if (this._sideText !== text) {
      this.el.objSide.textContent = text || '';
      this._sideText = text;
    }
  }

  updateEchoHud(p) {
    const max = Math.max(1, p.echoMax || 3);
    if (this._echoMax !== max) {
      this._echoMax = max;
      this.el.echoCharges.innerHTML = '';
      this._echoDots = [];
      for (let i = 0; i < max; i++) {
        const d = document.createElement('i');
        d.className = 'echo-charge';
        this.el.echoCharges.appendChild(d);
        this._echoDots.push(d);
      }
    }
    if (!this._echoDots) return;
    for (let i = 0; i < this._echoDots.length; i++) {
      this._echoDots[i].classList.toggle('on', i < p.echo);
    }
    this.el.echoHud.classList.toggle('cd', p.echoCd > 0);
  }

  flashEcho() {
    const el = this.el.echoHud;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    clearTimeout(this._echoT);
    this._echoT = setTimeout(() => el.classList.remove('flash'), 380);
  }

  updateBoss(boss, player) {
    const el = this.el.bossBar;
    if (!el) return;
    const show = !!(boss && !boss.dying && player && boss.pos.distanceTo(player.pos) < 52);
    el.classList.toggle('show', show);
    if (!show || !boss) return;
    const pct = clamp(boss.hp / boss.maxHp, 0, 1);
    this.el.bossFill.style.width = (pct * 100).toFixed(1) + '%';
    this.el.bossPct.textContent = Math.ceil(pct * 100) + '%';
  }

  renderJournal(d) {
    const bar = (v, t) => '<div class="j-bar"><i style="width:' + clamp(v / Math.max(1, t), 0, 1) * 100 + '%"></i></div>';
    const main = d.main.map(q => {
      const cls = 'j-item' + (q.done ? ' done' : q.active ? ' active' : '');
      return '<div class="' + cls + '">' +
        '<div class="j-name">' + q.title + '<em>' + q.value + ' / ' + q.target + '</em></div>' +
        '<div class="j-desc">' + q.desc + '</div>' + bar(q.value, q.target) + '</div>';
    }).join('');
    const side = d.side.map(q => {
      const cls = 'j-item' + (q.done ? ' done' : '');
      return '<div class="' + cls + '">' +
        '<div class="j-name">' + q.title + '<em>' + q.value + ' / ' + q.target + '</em></div>' +
        '<div class="j-desc">' + q.desc + '</div>' + bar(q.value, q.target) + '</div>';
    }).join('');

    const shards = SHARD_ORDER.map(id => {
      const t = SHARD_TYPES[id];
      const n = d.shardCounts[id] || 0;
      const res = n >= 3 ? ' · 共鸣' : '';
      return '<div class="j-shard" style="--c:' + t.css + '">' +
        '<span class="gem"></span>' +
        '<span class="txt"><b>' + t.name + ' ' + n + '/3' + res + '</b><i>' + t.desc + '</i></span></div>';
    }).join('');

    const b = d.bonuses;
    const chips = [];
    if (b.damage > 0) chips.push('伤害 +' + b.damage + '%');
    if (b.fireRate > 0) chips.push('射速 +' + b.fireRate + '%');
    if (b.speed > 0) chips.push('移速 +' + b.speed + '%');
    if (b.reload > 0) chips.push('换弹 +' + b.reload + '%');
    if (b.maxHp > 100) chips.push('生命上限 ' + b.maxHp);
    const bonusHTML = chips.length ? '<div class="j-bonus">' + chips.map(c => '<span>' + c + '</span>').join('') + '</div>' : '<div class="journal-foot-note">还没有获得增益 —— 去收集碎片。</div>';

    const tr = d.track;
    const music = tr
      ? '<b>' + tr.name + '</b> · ' + tr.en + '<br>' +
        '<span style="color:#a9c9cf">' + (tr.desc || '') + '</span><br>' +
        '<em>' + tr.bpm + ' BPM · ' + tr.key + '</em> · 第 ' + (d.trackIndex + 1) + ' / ' + d.trackCount + ' 首' +
        (d.musicPlaying ? '' : '（暂停）')
      : '待机';

    this.el.journalBody.innerHTML =
      '<div class="journal-col">' +
        '<div class="journal-sec"><h3>主线目标 <span>OBJECTIVE</span></h3>' + main + '</div>' +
        '<div class="journal-sec"><h3>支线行动 <span>SIDE OPS</span></h3>' + side + '</div>' +
      '</div>' +
      '<div class="journal-col">' +
        '<div class="journal-sec"><h3>回声碎片 <span>' + d.shardTotal + ' / ' + d.shardCount + '</span></h3><div class="j-shards">' + shards + '</div></div>' +
        '<div class="journal-sec"><h3>当前增益 <span>ECHO BONUS</span></h3>' + bonusHTML + '</div>' +
        '<div class="journal-sec"><h3>本局记录 <span>RUN STATS</span></h3><div class="j-grid">' +
          '<div class="j-stat"><span>击杀</span><b>' + d.stats.kills + '</b></div>' +
          '<div class="j-stat"><span>探索房间</span><b>' + d.stats.rooms + '</b></div>' +
          '<div class="j-stat"><span>用时</span><b>' + d.stats.time + '</b></div>' +
          '<div class="j-stat"><span>守潮者</span><b>' + (d.stats.bossDefeated ? '已沉没' : '未击败') + '</b></div>' +
        '</div></div>' +
        '<div class="journal-sec"><h3>正在播放 <span>BGM</span></h3><div class="j-music">' + music + '<br><span style="color:#7ea6ad;font-size:10px">M 开关 · [ ] 切歌 · 每首 2 分钟以上完整编曲</span></div></div>' +
      '</div>';
  }

  // ----------------------------------------------------------
  // HUD 更新
  // ----------------------------------------------------------
  updateHUD(g, dt) {
    const p = g.player;
    const s = this.settings;

    // 碎片
    this.el.shardNum.textContent = String(g.collected.size);
    if (this.el.shardNum.textContent !== String(this.lastPips)) {
      this.lastPips = g.collected.size;
    }
    for (let i = 0; i < this.shardPips.length; i++) this.shardPips[i].classList.toggle('on', i < g.collected.size);

    // 生命
    const hp = Math.max(0, Math.round(p.hp));
    this.el.healthNum.textContent = String(hp);
    const pct = clamp(p.hp / (p.maxHp || 100), 0, 1);
    this.el.healthFill.style.width = (pct * 100) + '%';
    this.el.healthDelayed.style.width = (pct * 100) + '%';
    this.el.healthFill.classList.toggle('hurt', pct <= 0.6 && pct > 0.3);
    this.el.healthFill.classList.toggle('crit', pct <= 0.3);
    this.el.healthNum.classList.toggle('hurt', pct <= 0.3);
    this.el['fx-lowhp'].classList.toggle('on', pct <= 0.3);

    // 状态
    const chips = [];
    if (p.submerged) chips.push(['潜泳', '']);
    else if (p.inWater) chips.push(['涉水', '']);
    if (p.hurtCd > 0.15) chips.push(['受伤', 'warn']);
    if (g.time - p.lastDamage > 7 && p.hp < p.maxHp) chips.push(['回复中', 'good']);
    if (p.boostT > 0) chips.push(['加速', 'good']);
    if (g.slowmoT > 0) chips.push(['子弹时间', 'good']);
    const chipsHTML = chips.map(c => `<span class="status-chip ${c[1]}">${c[0]}</span>`).join('');
    if (this._chipsHTML !== chipsHTML) {
      this.el.statusRow.innerHTML = chipsHTML;
      this._chipsHTML = chipsHTML;
    }

    // 武器
    const ws = g.weapons;
    const def = ws.def, slot = ws.slot;
    this.el.weaponName.textContent = def.name;
    this.el.ammoMag.textContent = slot.reloading && def.kind !== 'pump' ? '··' : String(slot.ammo).padStart(2, '0');
    this.el.ammoReserve.textContent = '/ ' + slot.reserve;
    this.el.ammoMag.classList.toggle('low', slot.ammo <= Math.max(1, Math.round(def.magSize * 0.25)) && !slot.reloading);
    this.el.fireMode.textContent = def.kind === 'auto' ? '全自动' : def.kind === 'pump' ? '泵动' : '半自动';
    if (slot.reloading) {
      const total = def.kind === 'pump' ? 0.55 : def.reloadTime;
      this.el.reloadFill.style.width = (100 - clamp(slot.reloadT / total, 0, 1) * 100) + '%';
    } else {
      this.el.reloadFill.style.width = '0%';
    }
    // 槽位
    let slotsHTML = '';
    const shortName = { smg: '冲锋', rifle: '步枪', shotgun: '霰弹', rail: '轨道' };
    for (let i = 0; i < GUN_ORDER.length; i++) {
      const id = GUN_ORDER[i];
      const st = ws.slots[id];
      const cls = 'wslot' + (id === ws.currentId ? ' active' : '') + (st.unlocked ? '' : ' locked');
      slotsHTML += `<span class="${cls}">${i + 1} ${st.unlocked ? (shortName[id] || st.def.short) : '——'}</span>`;
    }
    if (this._slotsHTML !== slotsHTML) {
      this.el.weaponSlots.innerHTML = slotsHTML;
      this._slotsHTML = slotsHTML;
    }

    // 移动状态
    this.el.moveState.textContent = p.moveState;
    this.el.moveState.classList.toggle('show', !!p.moveState);

    // 准星扩散
    const bloom = slot.bloom || 0;
    this.setCrosshairGap((s.crosshairGap || 5) + bloom * 260 + (p.speedNow > 5 ? 2 : 0));

    // 连杀
    const streak = g.streak;
    if (streak.n >= 2 && g.time - streak.t < 2.6) {
      this.el.streakBanner.textContent = `连杀 ×${streak.n}`;
      this.el.streakBanner.classList.add('show');
    } else {
      this.el.streakBanner.classList.remove('show');
    }
    this.el.exitHint.classList.toggle('show', !!g.exitActive);

    // 回声 / 首领
    this.updateEchoHud(p);
    this.updateBoss(g.boss, p);

    // 水晶指示器 + 小地图（小地图 12fps 足够，省 CPU）
    this.updateCompass(g);
    this.updateCrystalMarker(g);
    this._mapAcc = (this._mapAcc || 0) + dt;
    if (this._mapAcc > 0.083) {
      this._mapAcc = 0;
      this.drawMinimap(g);
    }

    // 伤害数字
    this.updateDamageNumbers(g, dt);
    this._updateDamageArcs(dt);

    // 性能
    if (s.perf) {
      this.perfAcc += dt;
      if (this.perfAcc > 0.25) {
        this.perfAcc = 0;
        this.el.perf.textContent =
          `FPS ${g.fps.toFixed(0)}  绘制 ${g.drawCalls}\n` +
          `房间 ${g.world.cells.size}  区块 ${g.world.chunks.size}\n` +
          `敌人 ${g.enemies.countAlive()}  碎片 ${g.collected.size}/${SHARD_COUNT}\n` +
          `坐标 ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}\n` +
          `音乐 ${g.boss ? 'BOSS' : 'BGM'} 能量 ${(g.musicMood * 100).toFixed(0)}%`;
      }
      this.el.perf.classList.remove('hidden');
    } else {
      this.el.perf.classList.add('hidden');
    }
  }

  spawnDamageNumber(worldPos, amount, o = {}) {
    if (this.dmgNumbers.length > 26) {
      const old = this.dmgNumbers.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'dmg-num' + (o.head ? ' head' : '') + (o.kill ? ' kill' : '');
    el.textContent = (o.head ? '✦' : '') + Math.round(amount);
    this.el.dmgNumbers.appendChild(el);
    this.dmgNumbers.push({ el, world: worldPos.clone(), t: 0 });
  }

  updateDamageNumbers(g, dt) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.dmgNumbers.length - 1; i >= 0; i--) {
      const d = this.dmgNumbers[i];
      d.t += dt;
      if (d.t > 0.85) { d.el.remove(); this.dmgNumbers.splice(i, 1); continue; }
      const p = projectToScreen(d.world, g.camera, w, h);
      if (!p.visible) { d.el.style.opacity = '0'; continue; }
      d.el.style.left = p.x + 'px';
      d.el.style.top = (p.y - d.t * 26) + 'px';
    }
  }

  setPrompt(text) {
    const el = this.el.prompt;
    if (text) {
      if (this._promptText !== text) { el.innerHTML = text; this._promptText = text; }
      el.classList.add('show');
    } else el.classList.remove('show');
  }
  setInteractDot(on) { this.el.interactDot.classList.toggle('show', on); }

  setUnderwater(on) {
    this.el['fx-underwater'].classList.toggle('on', on);
  }
  damageFlash() {
    const d = this.el['fx-damage'];
    d.classList.remove('flash');
    void d.offsetWidth;
    d.classList.add('flash');
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => d.classList.remove('flash'), 750);
  }
  healFlash() {
    const d = this.el['fx-heal'];
    d.classList.remove('flash');
    void d.offsetWidth;
    d.classList.add('flash');
    clearTimeout(this._healT);
    this._healT = setTimeout(() => d.classList.remove('flash'), 850);
  }
  setSlowmo(on) { this.el['fx-slowmo'].classList.toggle('on', on); }

  /** 开局黑场淡入：消除“突然全亮”的炫光观感 */
  fadeFromBlack(ms = 520) {
    const el = this.el['fx-fade'];
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '1';
    void el.offsetWidth;
    el.style.transition = `opacity ${ms}ms ease-out`;
    el.style.opacity = '0';
  }

  setMusicLabel(text) { if (this.el.musicLabel) this.el.musicLabel.textContent = text; }
  setPauseSub(text) { this.el.pauseSub.textContent = text; }
  setDeadStats(html) { this.el.deadStats.innerHTML = html; }
  setWinStats(html) { this.el.winStats.innerHTML = html; }

  // ----------------------------------------------------------
  // 罗盘 / 小地图
  // ----------------------------------------------------------
  updateCompass(g) {
    const wrap = this.el.compassWrap;
    const needle = this.el.compassNeedle;
    const vert = this.el.compassVert;
    const distEl = this.el.compassDist;
    const t = g.compassTargets && g.compassTargets[0];
    if (!t) { wrap.style.opacity = '0.25'; distEl.textContent = '—'; return; }
    wrap.style.opacity = '1';
    // 旋转指针（CSS 顺时针为正，故取负号）
    const rel = t.yaw - g.playerYaw;
    needle.style.transform = `rotate(${(-rel).toFixed(3)}rad)`;
    wrap.style.setProperty('--gem', t.color || '#7ce7ff');
    wrap.classList.toggle('exit', t.kind === 'exit' && t.color === '#ffcf7a');
    wrap.classList.toggle('boss', t.kind === 'boss');
    // 垂直提示
    if (t.vertical > 0) { vert.textContent = '▲'; vert.style.color = '#8ef0ff'; }
    else if (t.vertical < 0) { vert.textContent = '▼'; vert.style.color = '#ffb27a'; }
    else { vert.textContent = '◆'; vert.style.color = '#bff3f7'; }
    distEl.textContent = t.dist != null ? Math.round(t.dist) + ' m' : '—';
  }

  updateCrystalMarker(g) {
    const el = this.el.crystalMarker;
    const t = g.compassTargets && g.compassTargets[0];
    if (!t || !t.pos || t.dist > 90) { el.classList.add('hidden'); return; }
    const w = window.innerWidth, h = window.innerHeight;
    const p = projectToScreen(t.pos, g.camera, w, h);
    if (!p.visible || p.x < 24 || p.x > w - 24 || p.y < 24 || p.y > h - 24) { el.classList.add('hidden'); return; }
    // 遮挡检测：隔着墙就不显示屏幕标记（罗盘指针仍然指向）
    if (g.world && g.world.raycast) {
      const cam = g.camera.position;
      const dx = t.pos.x - cam.x, dy = t.pos.y - cam.y, dz = t.pos.z - cam.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const hit = g.world.raycast(cam, { x: dx / dist, y: dy / dist, z: dz / dist }, dist - 0.6);
      if (hit.hit) { el.classList.add('hidden'); return; }
    }
    el.classList.remove('hidden');
    const gem = el.querySelector('.cm-gem');
    if (gem) {
      const c = t.color || '#7ce7ff';
      gem.style.background = 'linear-gradient(135deg, #fff, ' + c + ' 55%, ' + c + '55)';
      gem.style.boxShadow = '0 0 14px ' + c + ', 0 0 4px #fff';
    }
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    this.el.crystalDist.textContent = Math.round(t.dist) + 'm';
  }

  drawMinimap(g) {
    const cv = this.el.minimap;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const world = g.world;
    const p = g.player;
    const cellPx = 15;
    const px = p.pos.x / CELL, pz = p.pos.z / CELL;
    const cx = Math.round(px), cz = Math.round(pz);
    const range = Math.ceil((W / 2) / cellPx) + 1;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    const dpr = 1;
    void dpr;
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const x = cx + dx, z = cz + dz;
        const key = x + ',' + z;
        const visited = world.visits.has(key);
        const cell = world.cells.get(key);
        if (!visited && !cell) continue;
        const sx = (x - px) * cellPx;
        const sz = (z - pz) * cellPx;
        const type = cell ? cell.type : null;
        if (!visited) {
          ctx.fillStyle = 'rgba(10, 26, 31, 0.35)';
        } else if (type === 'pool' || type === 'lane' || type === 'sky' || type === 'spa' || type === 'slide') {
          ctx.fillStyle = 'rgba(24, 78, 96, 0.72)';
        } else if (type === 'garden') {
          ctx.fillStyle = 'rgba(28, 70, 52, 0.72)';
        } else if (type === 'sauna') {
          ctx.fillStyle = 'rgba(72, 52, 34, 0.72)';
        } else if (type === 'filter' || type === 'pump') {
          ctx.fillStyle = 'rgba(46, 54, 60, 0.75)';
        } else {
          ctx.fillStyle = 'rgba(18, 44, 52, 0.72)';
        }
        ctx.fillRect(sx - cellPx / 2 + 0.5, sz - cellPx / 2 + 0.5, cellPx - 1, cellPx - 1);
        if (visited && cell && (cell.hasUpper)) {
          ctx.strokeStyle = 'rgba(120, 220, 240, 0.25)';
          ctx.strokeRect(sx - cellPx / 2 + 2.5, sz - cellPx / 2 + 2.5, cellPx - 5, cellPx - 5);
        }
      }
    }
    // 水体
    for (const v of world.waterVolumes) {
      const vx = (v.minX / CELL - px) * cellPx, vz = (v.minZ / CELL - pz) * cellPx;
      const vw = (v.maxX - v.minX) / CELL * cellPx, vh = (v.maxZ - v.minZ) / CELL * cellPx;
      if (vw < 0.5) continue;
      ctx.fillStyle = 'rgba(80, 200, 235, 0.3)';
      ctx.fillRect(vx, vz, vw, vh);
    }
    // 碎片（按类型着色）
    for (const s of g.shards) {
      if (s.collected) continue;
      const sx = (s.entry.spot.x / CELL - px) * cellPx;
      const sz = (s.entry.spot.z / CELL - pz) * cellPx;
      const type = SHARD_TYPES[s.type];
      ctx.fillStyle = type ? type.css : '#7ce7ff';
      ctx.beginPath(); ctx.arc(sx, sz, 3.6, 0, 7); ctx.fill();
    }
    // 出口 / 首领
    if (g.exitActive && g.exitPos) {
      const sx = (g.exitPos.x / CELL - px) * cellPx;
      const sz = (g.exitPos.z / CELL - pz) * cellPx;
      const gold = g.exitUnlocked;
      ctx.fillStyle = gold ? '#ffcf7a' : '#ff6a55';
      ctx.beginPath(); ctx.arc(sx, sz, 4.6, 0, 7); ctx.fill();
      ctx.strokeStyle = gold ? 'rgba(255, 220, 150, 0.75)' : 'rgba(255, 106, 85, 0.75)';
      ctx.beginPath(); ctx.arc(sx, sz, 6.8, 0, 7); ctx.stroke();
    }
    if (g.boss && !g.boss.dying) {
      const sx = (g.boss.pos.x / CELL - px) * cellPx;
      const sz = (g.boss.pos.z / CELL - pz) * cellPx;
      const pulse = 4.5 + Math.sin(performance.now() / 180) * 1.4;
      ctx.fillStyle = '#ff5a44';
      ctx.beginPath(); ctx.arc(sx, sz, 4.2, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 140, 90, 0.85)';
      ctx.beginPath(); ctx.arc(sx, sz, pulse + 3, 0, 7); ctx.stroke();
    }
    // 敌人（近处警觉）
    for (const e of g.enemies.enemies) {
      if (e.dying) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d > 26 || e.spottedT <= 0) continue;
      const sx = (e.pos.x / CELL - px) * cellPx;
      const sz = (e.pos.z / CELL - pz) * cellPx;
      ctx.fillStyle = d < 12 ? '#ff5a44' : 'rgba(255, 90, 68, 0.6)';
      ctx.beginPath(); ctx.arc(sx, sz, 3, 0, 7); ctx.fill();
    }
    // 玩家
    ctx.save();
    ctx.rotate(-g.playerYaw);
    ctx.fillStyle = '#eaffff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(0, 2.6); ctx.lineTo(-4.4, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 边框/准心
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, 7); ctx.stroke();
    ctx.restore();
    this.el.mapCoord.textContent = `${cx} : ${cz}`;
  }
}

function describeArc(r, a0, a1) {
  const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
  const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}