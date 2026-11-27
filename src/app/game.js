// 1回の試合: エンジンを進め、入力を命令にし、出来事を音・効果・HUDへ。カメラ（一人称）と描画。
import { createGame, step, load } from '../engine/engine.js';
import { eyeOf, capsOf } from '../engine/combat.js';
import { curWeapon, curW, ammoCount, makeWeapon, magCap } from '../engine/actor.js';
import { contextOf, OP_NAME, doorOps, personOps, personPoint } from '../engine/interact.js';
import { WAR_DOWN_T } from '../engine/status.js';
import { spreadDeg, magNear } from '../engine/weapon.js';
import { vaultPlan, PRONE_TURN } from '../engine/move.js';
import { depSpot, DEP_WHY } from '../engine/deploy.js';
import { raycast, CS, LH, levelOfY, los } from '../engine/world.js';
import { smokeBetween, fuseOf } from '../engine/nades.js';
import { sensForZoom, fineAimK } from './settings.js';
import { TC } from '../ui/teamcol.js';
// 大規模戦のエイムアシストの強さ: [体の上での見回しの速さ]（敵の見かけの動きには 1 - これ だけついていく）
// 双眼鏡を構えている時の倍率（構えきるまでは 1）
const BINOC_OPTIC = { kind: 'binoc', scope: true, zoom: 6 };
function binocZoom(p) { const ws = p && p.ws; return ws && ws.slot === 2 && ws.gear === 'binoc' && GEAR.binoc ? (p.ads > 0.5 ? GEAR.binoc.zooms[ws.bz ?? GEAR.binoc.zi] : 1) : 0; }
const AA_WAR = { off: [1], weak: [0.85], mid: [0.75], strong: [0.65], max: [0.55] };
import { sideOf, isOpen } from '../engine/doors.js';
import { WEAPONS, ATTACH, attachOptions, zoomOf, opticOf, zoomsOf, swayCamK, scopePip } from '../engine/data/weapons.js';
import { GEAR, LONG } from '../engine/data/equipment.js';
import { MAPS } from '../engine/maps/index.js';
import { MISSIONS } from '../engine/data/missions.js';
import { M, MATS } from '../engine/data/materials.js';
import { ActorView, roomOf } from '../render/actors.js';
import { FX } from '../render/fx.js';
import { ViewModel } from '../render/viewmodel.js';
import { gunModel } from '../render/guns.js';
import { roomGraph } from '../engine/ai/nav.js';
import { LINES } from '../audio/lines.js';
import { vfovOf } from './settings.js';
import { gfxOf, WAR_SKY, WAR_GRADE } from '../render/renderer.js';
import { sunVisAt } from '../war/render.js';
import { carve, breakPane, collapseBld } from '../war/destruct.js';
import { los as warLos, camClear } from '../war/world.js';
// 目と壁の間（m）。近くを切る面（0.08m 先・画面の隅まで約 0.13m）が壁に入らないように
const CAM_CLR = 0.16;
import { OUT_LIMIT, canSpawnAt, canPick, squadEn, respawnT, WAR_MODES, sizeLabel, canSpawnOn } from '../engine/modes/war.js';
import { classGadgets, CLASSES, CLASS_LIST, classGuns, classSecs, classLoadout } from '../war/classes.js';
import { WarFlags, FLAG_COL } from '../render/warflags.js';
import { RALLY, rallyOf } from '../engine/rally.js';
import { WAR_MAPS } from '../war/maps/index.js';

// 大規模戦の描く距離（画質ごと）: 低 550m・中 800m・高 1050m（遠くはもやに溶かす）
function warView(st) { const g = gfxOf(st); return { viewDist: { near: 550, mid: 800, far: 1050, max: 1200 }[st.viewDistSel] || { low: 550, medium: 800, high: 1050, max: 1200 }[g.detail] || 800, nearDist: g.detail === 'low' ? 120 : g.detail === 'medium' ? 150 : 180, shadowR: g.shadow === 'high' ? 48 : 40, grassDist: { low: 0, medium: 55, high: 80, max: 100 }[g.detail] ?? 55, grassDens: g.detail === 'low' ? 0.6 : 1, lite: g.detail === 'low' }; }

const DEG = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const TEAMS = ['gold', 'red', 'blue'];
const TEAMCOL = { gold: '#e8b830', red: '#e5483f', blue: '#3d8cf0' };

// 手が届かない（遠い）ときは、調べるボタン・案内・メニューに何も出さない（11-12 14:23 の要望）。間に物があるときは出す
function tooFar(c) { return !!(c && c.def && c.def.far && c.def.why !== 'block'); }

export class Match {
  constructor(app, o) {
    this.app = app; this.o = o;
    this.r = app.renderer; this.au = app.audio; this.hud = app.hud;
    this.G = o.mirror ? { S: o.mirror.S, w: o.mirror.w } : o.dump ? load(o.dump) : createGame({ map: o.map, mode: o.mode, mission: o.mission, diff: o.diff, entry: o.entry, team: o.team, roster: o.roster, rules: o.rules, seed: o.seed, teams: o.teams, aiLoadouts: o.aiLoadouts, start: o.start, house: o.house, size: o.size, wmode: o.wmode, predeploy: o.predeploy });
    this.S = this.G.S; this.w = this.G.w;
    this.def = this.S.war ? null : MAPS[this.S.map];
    this.pid = o.pid ?? 0;
    this.p = this.S.actors.find(a => a.pid === this.pid) || this.S.actors[0];
    if (app.titleScene) app.titleScene.detach();
    this._setWorld();
    this.av = new ActorView(this.r); this.fx = new FX(this.r); this.vm = new ViewModel(this.r, this.av);
    this.fx.blood = app.settings.blood !== false;
    { const g = gfxOf(app.settings); this.fx.amount = { low: 0.5, normal: 1, high: 1.5 }[g.fx] || 1; this.fx.shells = g.shells !== false; }
    this.av.hidden.add(this.p.id);
    if (this.S.war) this.hud.setWarPlan(this.w, this.S.m); else this.hud.setPlan(this.w, this.def);
    this.hud.setMode({ pve: !this.S.pvp && !this.S.war, pvp: this.S.pvp && !this.S.war, drone: false, war: !!this.S.war, range: !!(this.S.war && this.S.m.mode === 'range') });
    this.yaw = o.cam ? o.cam.yaw : this.p.yaw; this.pitch = o.cam ? o.cam.pitch : 0;
    this.acc = 0; this.time = 0; this.dead = false; this.done = false;
    this.adsOn = false; this.leanSide = 0; this.stance = 0; this.team = 'gold'; this.nvgOn = false;
    this.gearSel = (this.p.inv.gear.find(g => GEAR[g.id].kind === 'nade') || this.p.inv.gear[0] || {}).id || null;
    // 大規模戦: 投げ物・道具のボタンで選んでいる物（円の並びの順で最初に持っている物）
    this.nadeSel = null; this.gadSel = null; this._fixSlots();
    // 投げ物・道具のボタンを指でずらしたら、その場で選ぶ円を出す（input.js）
    this.app.input.onDragMenu = (btn, pid, x, y) => { if (!this.p.alive) return; if (btn === 'gear') this._gearMenu({ pid, x, y }); else this._slotMenu(btn === 'nade' ? 'nade' : 'gad', pid, x, y); };
    this.acts = [];
    this.shake = 0; this.flashW = 0; this.dmgK = 0; this.suppK = 0; this.exposure = 1; this.blurK = 0;
    this.ctx = null; this.ctxT = 0;
    this.spec = null; // 倒れたあとに見る味方
    this.lastSub = {};
    this.mmZoom = 1;
    this.droneId = null;
    this.prevBul = new Map();
    this.pkYaw = 0; this.pkPitch = 0; this.pkEnd = false;
    // AI の隊員の色（服）
    this.vm.setColors(this.av.look(this.p).pal.slice(3, 6), [0.02, 0.02, 0.025]);
    this.net = o.net || null;
    if (this.net && this.net.role === 'host') this.netInitHost();
    if (this.net && this.net.role === 'guest') this.netInitGuest(o);
    // 音: 壁ごしはこもる（視線が通らない）、屋内と屋外で残響、環境音とBGM
    this.au.occluder = (x, y, z) => { const c = this.cam; if (!c) return 0; const d = Math.hypot(x - c.x, z - c.z); if (d < 1.5) return 0; return los(this.w, c.x, c.y, c.z, x, y, z, this.S.doors) ? 0 : Math.min(1, 0.55 + d / 60); };
    this.fx.onClink = (x, y, z) => this.au.sfx('shell', [x, y, z], { vol: 0.35 });
    this.startT = performance.now();
    this.intro = o.dump ? 0 : 1.2;
    this.au.stopMusic(2.5);
    this.au.playMusic(this.S.pvp ? 'pvp' : this.S.mode === 'pve' ? 'op' : 'menu', { fade: 3, vol: this.S.pvp ? 0.55 : this.S.mode === 'pve' ? 0.6 : 0.35 });
    if (!o.dump && !this.S.pvp && this.S.mode === 'pve') setTimeout(() => this._say(null, 'toc_start', false, 'TOC'), 900);
  }
  // 世界を描く物を用意する（大規模戦は地形の塊、ほかは建物のマス）
  _setWorld() {
    if (this.S.war) {
      const v = warView(this.app.settings);
      if (this.S.m.mode === 'range') { v.viewDist = Math.max(v.viewDist, 1180); v.sky = { ...WAR_SKY, fogD: 0.0005 }; }
      this.r.setWar(this.w, v); this.r.warmWar(this.p.x, this.p.z);
      if (this.wf) this.wf.dispose();
      this.wf = new WarFlags(this.r); this.wf.set(this.S.m.flags, this.w, this.p.team); this.wf.S = this.S;
    } else this.r.setMap(this.w, this.def, this.S);
  }
  destroy() { if (this.app.input.onDragMenu) this.app.input.onDragMenu = null; if (this.wf) { this.wf.dispose(); this.wf = null; } this.hud.warMarks(null); this.hud.deploy(null); this.r.clearMap(); this.fx.clear(); this.av.dispose(); this.fx.dispose(); this.vm.dispose(); this.au.occluder = null; this.au.ambience(false); this.au.stopMusic(1.5); this.au.loop('heart', false, { fade: 0.3 }); this.au.setHurt(0); }
  rebind(r) {
    if (r) { if (this.av) { this.av.dispose(); this.fx.dispose(); this.vm.dispose(); } this.r = r; this.av = new ActorView(r); this.fx = new FX(r); this.vm = new ViewModel(r, this.av); this.fx.blood = this.app.settings.blood !== false; { const g = gfxOf(this.app.settings); this.fx.amount = { low: 0.5, normal: 1, high: 1.5 }[g.fx] || 1; this.fx.shells = g.shells !== false; } this.av.hidden.add(this.p.id); this.vm.setColors(this.av.look(this.p).pal.slice(3, 6), [0.02, 0.02, 0.025]); this.fx.onClink = (x, y, z) => this.au.sfx('shell', [x, y, z], { vol: 0.35 }); }
    this._setWorld();
  }
  applySettings() { this.fx.blood = this.app.settings.blood !== false; }
  // 止まっている間の描き直し（画面の大きさが変わったときなど）
  redraw() { try { this._render(0, { lookDX: 0, lookDY: 0, edges: [] }); } catch (e) { console.warn('redraw', e); } }

  // ---- 1こま
  frame(dt, fo = {}) {
    if (this.done) return;
    if (this.net && this.net.role === 'guest') return this.guestFrame(dt, fo);
    this.time += dt;
    const app = this.app, st = app.settings;
    const inp = fo.input === false ? { mx: 0, mz: 0, lookDX: 0, lookDY: 0, gyroX: 0, gyroY: 0, fire: false, sprint: false, hold: new Set(), edges: [] } : app.input.take();
    this._look(inp, dt);
    this._edges(inp);
    // エンジンを進める（1/60秒ずつ。遅れたら最大4回）
    this.acc += Math.min(dt, 0.1);
    const step0 = this.S.dt;
    let n = 0;
    const ev = [];
    const hostNet = this.net && this.net.role === 'host';
    const waiting = hostNet && this.netWaiting();
    const tS = performance.now();
    while (this.acc >= step0 && n < 4) {
      const cmd = this._command(inp);
      if (waiting) { this.acc -= step0; n++; continue; }
      const inputs = { [this.p.id]: cmd, ...(this.droneId != null ? { [this.droneId]: this._droneCmd(inp) } : {}) };
      if (hostNet) this.netInputs(inputs);
      this._savePrev();
      const e = step(this.G, inputs);
      for (const x of e) ev.push(x);
      this.acc -= step0; n++;
      if (this.S.m && this.S.m.phase === 'end') break;
    }
    if (n === 4) this.acc = 0;
    const tE = performance.now();
    // 描くのは「1ステップ前とこのステップの間」（こまの速さとエンジンの 60 回/秒 がずれても、動きがカクつかない）
    this._alpha = Math.max(0, Math.min(1, this.acc / step0));
    if (hostNet) this.netAfterSteps(ev);
    this._events(ev);
    // 描く間だけ、照準の揺れと反動をステップの間の値にする（エンジンの値は描いたあと元に戻す）
    const ws = this.p.ws, A = this._prevAim, kk = 1 - this._alpha;
    let keep = null;
    if (ws && A && kk > 0.001 && !this.done) { keep = [ws.sx, ws.sy, ws.ry, ws.rp]; ws.sx = (ws.sx || 0) + (A[0] - (ws.sx || 0)) * kk; ws.sy = (ws.sy || 0) + (A[1] - (ws.sy || 0)) * kk; ws.ry = (ws.ry || 0) + (A[2] - (ws.ry || 0)) * kk; ws.rp = (ws.rp || 0) + (A[3] - (ws.rp || 0)) * kk; }
    // まだエンジンに渡していない反動の押さえも、描く向きには先に入れる（指を引いた分がすぐ映るように）
    if (ws && this.rcComp > 0 && !this.done) { if (!keep) keep = [ws.sx, ws.sy, ws.ry, ws.rp]; ws.rp = Math.max(0, (ws.rp || 0) - this.rcComp); }
    const tR = performance.now();
    // 画面が隠れている間は 3D を描かない・減らす（11-27「重くなった・発熱」。0.1.60 から大規模戦はメニューを開いても試合が進み、
    //  画面いっぱいの出撃の画面の下でも毎こま描いていた）: 出撃の画面の間は描かない、メニューの間は 4 こまに 1 回
    this._rk = (this._rk || 0) + 1;
    const cover = this.hud.deployOn ? 2 : fo.input === false ? 1 : 0;
    const drawNow = cover === 0 || (cover === 1 && this._rk % 4 === 0);
    try { if (drawNow) this._render(dt, inp); } finally { if (keep) { ws.sx = keep[0]; ws.sy = keep[1]; ws.ry = keep[2]; ws.rp = keep[3]; } }
    const tH = performance.now();
    this._hud(dt);
    // 1こまの時間の内訳（fps の表示に出す。重い原因を探す）: 動き（エンジン、こまあたり）・回数・出来事（音・効果）・描く・HUD
    { const P = this.prof || (this.prof = { sim: 0, n: 0, ev: 0, rd: 0, hud: 0 }), k = 0.1, tN = performance.now();
      P.sim += (tE - tS - P.sim) * k; P.n += (n - P.n) * k; P.ev += (tR - tE - P.ev) * k; P.rd += (tH - tR - P.rd) * k; P.hud += (tN - tH - P.hud) * k; }
    // 終わり
    const m = this.S.m;
    if (m && (m.phase === 'end' || m.over) && !this.done) {
      this.endT = (this.endT || 0) + dt;
      if (this.endT > (m.over ? 3.5 : 2.2)) { this.done = true; if (hostNet) app.netGameOver(this.result()); else app.endGame(this.result()); }
    }
  }

  _look(inp, dt) {
    const st = this.app.settings, p = this.p;
    const W = curW(p), wi = curWeapon(p);
    const ads = p.ads;
    const zoom = binocZoom(p) || zoomOf(wi);
    let k = (inp.mouse ? 0.0022 : 0.0052) * (st.sens || 1);
    // 倍率の照準器は「スコープ」の感度（4倍が基準）を倍率に合わせて変える（画面の上で同じ速さ。2倍は0.72・8倍は0.23）
    // 構えの途中（覗き込む 0.2〜0.8）は、腰だめと構えの感度の間をなめらかに移す（11-26: 前は半分を超えた瞬間に感度が跳んだ）
    { const kz = zoom >= 1.5 ? sensForZoom(st, zoom) : (st.sensAds || 0.75), u = clamp((ads - 0.2) / 0.6, 0, 1); k *= 1 + (kz - 1) * u * u * (3 - 2 * u); }
    if (inp.fire && !inp.mouse) k *= st.sensFire || 1;
    // エイムアシスト（タッチ）。対戦は部屋の設定（0なし・1弱い・2ふつう）
    let want = 1, track = null;
    const aa = this.S.war ? (st.aimAssist || 'mid') : this.S.pvp ? ['off', 'weak', 'strong'][this.S.rules.aimAssist ?? 1] : st.aimAssist;
    if (this.S.war) {
      // 大規模戦（11-19 23:27 の要望: オフ〜最大を選べる。最大でも撃ち合いが崩れない強さ）。照準を敵へ引き寄せることはしない
      //  ① 減速: 照準が敵の体の近くにある間、見回しをゆっくりに（体の見かけの大きさに合わせる。遠い敵ほど狭い）
      //  ② 追従: 照準が敵の体の上にあり、指で見回している・歩いている・構えている・撃っている時だけ、敵の見かけの動きの一部についていく
      const L = AA_WAR[aa] || AA_WAR.off;
      if (!inp.mouse && L[0] < 1) {
        const t = this._aaWar(ads > 0.5, zoom, dt);
        if (t) {
          if (t.k < 1.6) want = 1 - (1 - L[0]) * Math.min(1, (1.6 - t.k) / 0.6);
          // 追従は「敵に対しての動き」に減速をかけるのと同じ: 指の動きは遅く、敵の見かけの動きは (1 - 遅さ) だけ足す。
          //  指で正しく追えていれば速さは変わらず、追い足りない・追いすぎた分だけ助ける
          const busy = Math.hypot(inp.lookDX, inp.lookDY) > 0 || Math.hypot(p.vx || 0, p.vz || 0) > 0.6 || ads > 0.5 || inp.fire;
          if (busy && t.dy != null) track = { dy: t.dy, dp: t.dp };
        }
      }
    } else if (!inp.mouse && aa && aa !== 'off') {
      // 倍率が高いスコープでは、画面の上で同じくらいの範囲になるよう角度を狭める
      const near = this._nearTarget(0.06 / Math.max(1, (ads > 0.5 ? zoom : 1) / 2));
      if (near) want = aa === 'strong' ? 0.55 : 0.72;
    }
    // 急に遅く・速くならないように、0.12秒かけて寄せる（11-12: エイムがなめらかに動かない）
    this.aaK = this.aaK == null ? want : this.aaK + (want - this.aaK) * (1 - Math.exp(-dt / 0.12));
    if (track) { const f = 1 - this.aaK; track.dy *= f; track.dp *= f; }
    const slow = inp.mouse ? 1 : this.aaK;
    // タッチの見回し: 指の動きにそのまま比例（加速はしない）。なめらかさは入力の側で、指の位置を時刻で直線に求めて出す
    //  （11-19 23:27: 前の「20〜50ms のならし」は遅れ 7〜36ms・止めた後に尾。今は遅れ 2〜9ms・ぴたりと止まる。lookres.js）
    const rdx = inp.lookDX, rdy = inp.lookDY;
    // 高い倍率: 指をゆっくり動かした分は細かく（設定「スコープの細かい操作」。11-26）
    if (!inp.mouse && ads > 0.5 && zoom >= 3 && dt > 0) {
      const v = Math.hypot(rdx, rdy) / dt;
      this._fv = this._fv == null ? v : this._fv + (v - this._fv) * (1 - Math.exp(-dt / 0.06));
      k *= fineAimK(this._fv, zoom, st.fineAim || 'mid');
    } else this._fv = null;
    let dx = rdx * k * slow, dy = rdy * k * slow * 0.9;
    // ジャイロ
    const gy = st.gyro || 'off';
    if (gy === 'always' || (gy === 'ads' && ads > 0.5)) { const g = (st.gyroSens || 1) * DEG * (ads > 0.5 ? 0.7 : 1); dx -= inp.gyroX * g * (st.gyroInvX ? -1 : 1); dy -= inp.gyroY * g * (st.gyroInvY ? -1 : 1); }
    if (this.droneId != null) { const d = this.S.byId[this.droneId]; if (d && d.alive) { this.dyaw = (this.dyaw ?? d.yaw) - dx; this.dpitch = clamp((this.dpitch ?? 0) - dy * (st.invertY ? -1 : 1), -0.6, 0.6); return; } }
    // 監視カメラ: 向きは据え付けの向きから左右 60°・上下の範囲だけ
    if (this.camView != null) {
      const K = mapCams(this.w, this.def)[this.camView];
      if (K) { let d = this.camYaw - dx * 0.8 - K.yaw0; d = Math.atan2(Math.sin(d), Math.cos(d)); this.camYaw = K.yaw0 + clamp(d, -CAM_YAW, CAM_YAW); this.camPitch = clamp(this.camPitch - dy * 0.8 * (st.invertY ? -1 : 1), CAM_PITCH[0], CAM_PITCH[1]); }
      return;
    }
    // のぞいている（ミラー・オプティワンド）: 見回すのはカメラだけ。体は動かない
    if (p.peek) { const mx = p.peek.max || 1; this.pkYaw = clamp(this.pkYaw - dx * 0.8, -mx, mx); this.pkPitch = clamp(this.pkPitch - dy * 0.8 * (st.invertY ? -1 : 1), -0.55, 0.7); return; }
    let dYaw = -dx;
    let dP = -dy * (st.invertY ? -1 : 1);
    if (track) { dYaw += track.dy; dP += track.dp; }
    // 大規模戦の伏せ: 向きを変える速さに上限（エンジンと同じ。BattleBit の 2024 の手直し）
    if (this.S.war && p.alive && !p.down && p.st > 1.5 && dt > 0) {
      const m = PRONE_TURN * dt; if (Math.abs(dYaw) > m) dYaw = Math.sign(dYaw) * m;
      const d = Math.atan2(Math.sin(this.yaw - p.yaw), Math.cos(this.yaw - p.yaw)), lim = 0.25; // 体より先へ行きすぎない
      if (Math.abs(d + dYaw) > lim && Math.sign(dYaw) === Math.sign(d + dYaw)) dYaw = Math.sign(dYaw) * Math.max(0, lim - Math.abs(d));
    }
    this.yaw += dYaw;
    // 反動の押さえ（大規模戦。BattleBit の 2024 の手直し・research の 19）: 反動で上がっている間に下へ引いた分は、
    //  まず反動の分から引く（体の向きは下げない）。あとで反動が戻るときに二重に下がらない。エンジンへは cmd.rc（度）で渡す
    if (this.S.war && dP < 0 && p.ws && p.alive) {
      const left = (p.ws.rp || 0) - (this.rcComp || 0);
      if (left > 0) { const c = Math.min(left * DEG, -dP); this.rcComp = (this.rcComp || 0) + c / DEG; dP += c; }
    }
    this.pitch = clamp(this.pitch + dP, -1.4, 1.4);
    if (!p.alive || p.down && !this.S.pvp) return;
    // 手元の動作（拘束・作業・拾う・取りつけ）: 視線を手元へ寄せる（指で見回すのは続けられる）
    const x = p.act;
    if (x && (x.look || x.tgt) && !x.quick && x.kind !== 'self' && x.k !== 'report' && x.k !== 'bash' && x.k !== 'kick') {
      const e = eyeOf(this.S, p), lk = x.look || x.tgt;
      const tx = lk[0] - e[0], ty = lk[1] - e[1], tz = lk[2] - e[2];
      const hd = Math.hypot(tx, tz);
      // 足もと（扉の下・床の物）は深く見下ろす。真下に近いときは向きはそのまま
      const wantP = clamp(Math.atan2(ty, Math.max(hd, 0.05)) + 0.12, ty < -0.6 ? -1.4 : -1.25, 0.6);
      const prog = x.t / Math.max(0.05, x.dur);
      const kk = 1 - Math.exp(-dt * (prog < 0.35 ? 6 : 2.5));
      if (hd > 0.12) { let dyaw = Math.atan2(tx, tz) - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); this.yaw += dyaw * kk; }
      this.pitch += (wantP - this.pitch) * kk;
    }
  }
  // 大規模戦のエイムアシストの相手: 見えている敵のうち、照準に一番近いもの（体の見かけの大きさで割った角度 k。1 で体の端）。
  //  見えるかどうか（壁・煙）は 0.2 秒ごとに調べ直す。前のこまからの敵の見かけの動き（dy・dp）も返す
  _aaWar(adsOn, zoom, dt) {
    const S = this.S, p = this.p; if (!p.alive || p.down) { this._aaPrev = null; return null; }
    const e = eyeOf(S, p), R = adsOn ? Math.min(400, 70 * Math.max(1, zoom)) : 45;
    const vis = this._aaVis || (this._aaVis = new Map());
    let best = null;
    for (const b of S.actors) {
      if (b === p || !b.alive || b.down || b.isDrone || b.team === p.team || b.staged) continue;
      const hh = b.stance === 2 ? 0.3 : b.stance === 1 ? 0.85 : 1.2;
      const dx = b.x - e[0], dy = b.y + hh - e[1], dz = b.z - e[2], hd = Math.hypot(dx, dz), d = Math.hypot(hd, dy);
      if (d > R || d < 0.5) continue;
      const yw = Math.atan2(dx, dz), pt = Math.atan2(dy, hd);
      const ay = Math.atan2(Math.sin(yw - this.yaw), Math.cos(yw - this.yaw)) * Math.cos(pt), ap = pt - this.pitch;
      // 体の見かけの半分の幅（伏せは低く横に長いので縦を狭める）+ 少しの余裕
      const half = Math.atan2(b.stance === 2 ? 0.45 : 0.32, d) + 0.004, halfV = Math.atan2(b.stance === 2 ? 0.25 : b.stance === 1 ? 0.5 : 0.75, d) + 0.004;
      const k = Math.hypot(ay / half, ap / halfV);
      if (k > 2.2 || (best && k >= best.k)) continue;
      let v = vis.get(b.id);
      if (!v || this.time - v.t > 0.2) { v = { t: this.time, ok: warLos(this.w, e[0], e[1], e[2], b.x, b.y + hh, b.z) && smokeBetween(S, e[0], e[1], e[2], b.x, b.y + hh, b.z) < 0.6 }; vis.set(b.id, v); }
      if (!v.ok) continue;
      best = { k, id: b.id, yw, pt };
    }
    if (vis.size > 64) vis.clear();
    const pv = this._aaPrev;
    this._aaPrev = best ? { id: best.id, yw: best.yw, pt: best.pt } : null;
    if (!best) return null;
    if (pv && pv.id === best.id) {
      // 1こまの見かけの動き（大きすぎるのは相手が入れ替わった・飛んだとみなして使わない）
      const dyw = Math.atan2(Math.sin(best.yw - pv.yw), Math.cos(best.yw - pv.yw)), dpt = best.pt - pv.pt;
      if (Math.abs(dyw) < 0.05 && Math.abs(dpt) < 0.05) { best.dy = dyw; best.dp = dpt; }
    }
    return best;
  }
  // 色の調整（大規模戦）: コントラストの強さは設定（BattleBit の Contrast Intensity）。変わった時だけ作り直す
  _grade(st) {
    const c = st.contrast ?? 1;
    if (!this._gr || this._grC !== c) { this._grC = c; this._gr = { ...WAR_GRADE, contrast: WAR_GRADE.contrast * c }; }
    return this._gr;
  }
  // 照準の近くの敵（エイムアシスト用）
  _nearTarget(cone) {
    const p = this.p; if (!p.alive) return null;
    const e = eyeOf(this.S, p);
    let best = null, bd = cone;
    for (const b of this.S.actors) {
      if (b === p || !b.alive || b.isDrone) continue;
      const enemy = this.S.pvp ? b.team !== p.team : (b.kind === 'sus' && !b.comply && !b.cuffed);
      if (!enemy) continue;
      const dx = b.x - e[0], dy = b.y + 1.2 - e[1], dz = b.z - e[2], d = Math.hypot(dx, dy, dz);
      if (d > 40) continue;
      const yw = Math.atan2(dx, dz), pt = Math.atan2(dy, Math.hypot(dx, dz));
      const da = Math.abs(Math.atan2(Math.sin(yw - this.yaw), Math.cos(yw - this.yaw))) + Math.abs(pt - this.pitch);
      if (da < bd) { bd = da; best = b; }
    }
    return best;
  }

  // ボタンの出来事 → 状態と命令
  _edges(inp) {
    const st = this.app.settings, p = this.p;
    // ダッシュを入れ直した（押し直した・スティックを押し込み直した）: リロードの最中ならやめて走る（11-12。エンジンが決める。weapon.js）
    if (inp.sprPress && p && p.alive) this.acts.push({ a: 'sprint' });
    for (const e of inp.edges) {
      // キーボード: 大規模戦の G は投げ物。ほかのモードの 3・4・5 は前の「投げ物・装備」
      const b = this.S.war ? (e.b === 'gear' ? 'nade' : e.b) : (e.b === 'heal' || e.b === 'gad' ? 'gear' : e.b), k = e.k;
      switch (b) {
        case 'ads': {
          // C4 を持っている: 構えのボタン（右クリック）で起爆（本家と同じ）。構えにはしない
          if (p && p.ws && p.ws.slot === 2 && GEAR[p.ws.gear] && GEAR[p.ws.gear].kind === 'c4') { if (k === 'down') this.acts.push({ a: 'c4det' }); this.adsOn = false; break; }
          const mode = st.adsMode || 'tap';
          if (e.mouse) { this.adsOn = k === 'down'; break; }
          // ADS 長押しで息止め（11-26 の要望・大規模戦）: 押したままにすると息を止め、離すと戻る。構えは切替のまま残す。
          //  切替: 構えている時に押すと、離した時（短押し）に構えをやめる（長押しなら息止めだけ）
          if (this.S && this.S.war && st.adsBreath !== false) {
            if (k === 'long') { this._adsBr = true; break; }
            if (k !== 'down') this._adsBr = false;
            if (mode === 'tap') { if (k === 'down') { this._adsPress = !this.adsOn; this.adsOn = true; } else if (k === 'tap' && !this._adsPress) this.adsOn = false; break; }
            if (mode === 'hold') { this.adsOn = k === 'down'; break; }
          }
          if (mode === 'hold') { if (k === 'down') this.adsOn = true; else if (k !== 'long') this.adsOn = false; }
          // 切替: 離したら切り替える（長めに押しても。重いこまで短押しが長押しに見えても切り替わる）
          // 切替: 押した瞬間に切り替える（離すのを待たない）
          else if (mode === 'tap') { if (k === 'down') this.adsOn = !this.adsOn; }
          else { if (k === 'down') { this._adsWas = this.adsOn; this.adsOn = true; } else if (k === 'tap') this.adsOn = !this._adsWas; else if (k === 'up' || k === 'longup') this.adsOn = false; }
          break;
        }
        // 押した瞬間に反応する（長押しの動作はそのあとで上書き）
        // リロード（BattleBit に合わせる）: 1回押すと弾倉を残す（ポーチへ）、すばやく2回押すと弾倉を落として速く。長押しも速い。
        //  設定で「1回押しで落とす」にもできる
        case 'reload': {
          if (k === 'down') {
            const dbl = this.time - (this._rlT ?? -9) < (st.rlDbl ?? 0.4) && p.ws.st === 'reload' && p.ws.rk === 'tac';
            this.acts.push({ a: 'reload', fast: dbl || (this.S.war && st.reloadDrop === true) }); this._rlT = dbl ? -9 : this.time;
          } else if (k === 'long' || (k === 'longup' && e.key)) this.acts.push({ a: 'reload', fast: true });
          break;
        }
        // 弾の欄（大規模戦）: 押すと弾倉の残りを知らせる、長押しで弾倉をまとめる（BattleBit の H・P）
        case 'ammo': {
          if (!this.S.war || !p.alive || p.down) break;
          const wi = curWeapon(p);
          if (k === 'long') this.acts.push({ a: 'consol' });
          else if (k === 'tap' && wi && wi.mags) { this.hud.feed(`弾倉: ${[wi.mag + (wi.ch ? '+1' : '')].concat(wi.mags.slice().sort((a, b) => b - a).map(String)).join(' / ')}`, 'ok'); this.au.ui('tap'); }
          break;
        }
        case 'crouch': if (k === 'down') { this._stWas = this.stance; this.stance = this.stance === 0 ? 1 : this.stance === 1 ? 0 : 1; } else if (k === 'long' && !e.key) this.stance = this._stWas === 2 ? 0 : 2; break;
        case 'prone': if (k === 'down') this.stance = this.stance === 2 ? 0 : 2; break;
        // 乗り越え・跳ぶ（大規模戦。BattleBit と同じく1つのボタン。越える物がなければ跳ぶ）
        // ダウン中にあきらめる（大規模戦）: 2.5 秒以内にもう一度押すと、倒れたことにして出撃の画面へ
        case 'giveup': if (k === 'down' && this.S.war && p.alive && p.down) { if (this.time - (this._guT ?? -99) < 2.5) { this.acts.push({ a: 'warRedeploy' }); this._guT = -99; } else this._guT = this.time; this.au.ui('tap'); } break;
        // 跳ぶ: しゃがみ・伏せの間は、まず立つ（11-20 の要望。跳ばない）
        // 乗り越え: 本家と同じく1つのボタン（越える物がなければ跳ぶ・跳んで届く物には乗る）。設定で「分ける」にすると乗り越えだけ（11-26）
        case 'vault': if (k === 'down') { if (this.stance > 0) { this.stance = 0; break; } this.acts.push(this.S && this.S.war ? (st.jumpBtn ? { a: 'vault', over: 1 } : { a: 'vault', jump: 1 }) : { a: 'vault' }); } break;
        case 'jump': if (k === 'down' && this.S && this.S.war) { if (this.stance > 0) { this.stance = 0; break; } this.acts.push({ a: 'jump' }); } break;
        // 息止め（11-19 13:31: 切り替えで）: 押すたびに入る・切れる。構えをやめる・息が切れると切れる（_command）
        case 'breath': if (k === 'down' && (st.breathMode || 'toggle') === 'toggle') { this.breathOn = !this.breathOn; this._brT = this.time; } break;
        case 'leanL': case 'leanR': {
          const s = b === 'leanL' ? -1 : 1;
          if ((st.leanMode || 'toggle') === 'hold' || e.key) { if (k === 'down') this.leanSide = s; else if (k !== 'long' && this.leanSide === s) this.leanSide = 0; }
          else if (k === 'down') this.leanSide = this.leanSide === s ? 0 : s;
          break;
        }
        case 'shout': if (k === 'down') this.acts.push({ a: 'shout', line: this._shoutLine() }); break;
        case 'peekx': if (k === 'tap' || k === 'down') this._peekQuit(); break;
        // 落ちた弾倉を拾う（大規模戦。近くにある間だけボタンが出る。キーボードは V）
        // 11-27: 倒れた味方の近くでは「引きずる」、引きずっている間は「離す」（BattleBit の F）
        case 'pick': if (k === 'down') this._ctxUse(); break;
        case 'use':
          if (this.S.war) { if (k === 'down') this._ctxUse(); break; }
          if (p.peek) { if (k === 'tap' || (k === 'down' && e.key)) this._peekQuit(); break; }
          if (k === 'tap' || (k === 'down' && e.key)) { if (!e.key || k === 'down') this._useDefault(); }
          else if (k === 'long') this._useMenu(e);
          break;
        case 'cmd': if (this.S.pvp) break; if (k === 'tap') this._cmdDefault(); else if (k === 'long') this._cmdMenu(e); break;
        case 'team': if (k === 'down') { if (this.S.pvp || this.S.war) this.boardOn = !this.boardOn; else this.team = TEAMS[(TEAMS.indexOf(this.team) + 1) % 3]; } break;
        case 'board': if (k === 'down') this.boardOn = !this.boardOn; break;
        // 大規模戦: 投げ物（G）・包帯（3）・道具（4・5）のボタン（BattleBit のキーに合わせて分ける。11-20）
        case 'nade': if (k === 'tap') this._slotUse('nade'); else if (k === 'long' && !(this.app.input.radial)) this._slotMenu('nade', e.pid, e.x, e.y); break;
        case 'gad': if (k === 'tap') this._slotUse('gad'); else if (k === 'long' && !(this.app.input.radial)) this._slotMenu('gad', e.pid, e.x, e.y); break;
        // 包帯: 近くに倒れた味方がいれば起こす（本家と同じく包帯を1つ使う。11-26）。いなければ自分に巻く
        case 'heal': if (k === 'tap') { const g = p.inv.gear.find(x => x.id === 'bandage'); if (g && g.n > 0) { const rt = this.S.war ? this._reviveTgt() : null; this.acts.push(rt ? { a: 'op', k: 'person', id: rt.id, op: 'revive' } : { a: 'gear', id: 'bandage' }); } } break;
        case 'gear':
          // 手に持った物（投げ物・RPG など）を持っていれば銃に戻す。選んだのが RPG（@long）なら構える
          if (k === 'tap') { if (p.ws.slot === 2 || p.ws.slot === 3) this.acts.push({ a: 'switch', slot: p.ws.prev >= 0 && p.ws.prev < 2 ? p.ws.prev : 0 }); else if (this.gearSel === '@long') this.acts.push({ a: 'long' }); else if (this.gearSel) this.acts.push({ a: 'gear', id: this.gearSel }); }
          else if (k === 'long' && !this.app.input.radial) this._gearMenu(e);
          break;
        case 'wpn1': if (k === 'down' || (k === 'tap' && e.wheel)) this.acts.push({ a: 'switch', slot: 0 }); break;
        case 'wpn2': if (k === 'down' || (k === 'tap' && e.wheel)) this.acts.push({ a: 'switch', slot: 1 }); break;
        // 倍率を切り替えるか（構えている間）は手元で決めて送る（オンラインでホストの構えの具合とずれないように）
        // 射撃モード（フル・バースト・単発）。倍率は別のボタン（11-19 14:03）
        case 'fmode': if (k === 'down') this.acts.push({ a: 'mode', zoom: false }); break;
        case 'zoom': if (k === 'down') this.acts.push({ a: 'zoom' }); break;
        // 敵に印をつける（大規模戦。PC は中ボタン）
        case 'spot': if (k === 'down' && this.S.war && p.alive && !p.down) this.acts.push({ a: 'spot' }); break;
        case 'rally': if (k === 'down' && this.S.war && p.alive && !p.down) { this.acts.push({ a: 'rally' }); this.au.ui('tap'); } break;
        case 'light': if (k === 'down') this.acts.push({ a: 'light' }); break;
        case 'nvg': if (k === 'down' && p.armor.head === 'nvg') { this.nvgOn = !this.nvgOn; p.nvgOn = this.nvgOn; this.au.sfx('nvg', null, { vol: 0.5 }); } break;
        case 'map': if (k === 'tap' || (k === 'longup' && !e.key)) this.app.openTablet(); break;
        // 出撃の画面（大規模戦）
        case 'dsel': if (k === 'down' && this.S.war && !p.alive) { this.dsel = e.sub; if (p.deployAt) this.acts.push({ a: 'warDeploy', at: e.sub, ...this._warPick() }); } break;
        case 'dcls': if (k === 'down' && this.S.war && !p.alive && canPick(p, e.sub)) { this.dcls = e.sub; this._warPickSave(); } break;
        case 'dlo': if (k === 'down' && this.S.war) this.dlo = !this.dlo; break;
        case 'loadout': if (k === 'down' && this.S.war && this.S.m.mode === 'range' && p.alive) { this.acts.push({ a: 'warRedeploy' }); this.au.ui('tap'); } break;
        case 'dgun': case 'dsec': if (k === 'down' && this.S.war && !p.alive) { const W = this._warPrefs(); (b === 'dgun' ? W.guns : W.secs)[this.dcls] = e.sub; this._warPickSave(); } break;
        // 付属品（LOADOUT）: sub = 種類:物（例 grip:vert）。今の主の銃に付ける
        case 'dlotab': if (k === 'down' && this.S.war && !p.alive) { this.dloTab = e.sub; this.au.ui('tap'); } break;
        // 副の道具（LOADOUT の「道具」）
        case 'dgad': if (k === 'down' && this.S.war && !p.alive) { const W = this._warPrefs(); (W.gad || (W.gad = {}))[this.dcls || 'assault'] = e.sub; this._warPickSave(); this.au.ui('tap'); } break;
        case 'datt': if (k === 'down' && this.S.war && !p.alive) { const W = this._warPrefs(), d = this._warDeployData(), [kk, v] = String(e.sub).split(':'); const A = W.att[d.gun] || (W.att[d.gun] = {}); A[kk] = v; this._warPickSave(); this.au.ui('tap'); } break;
        // 出撃の予約（待ちの間に押した）をもう一度押すとやめる（11-27 04:01）。自動で出撃の設定でも、やめたらこの死では予約し直さない
        case 'dgo': if (k === 'down' && this.S.war && !p.alive && !this.S.m.over && p.deployAt) { this.acts.push({ a: 'warDeploy', cancel: true }); this._adT = this.kiaT; this.au.ui('tap'); break; }
          if (k === 'down' && this.S.war && !p.alive && !this.S.m.over) { if (this.S.m.mode === 'conquest' && this.S.m.tickets[p.team] <= 0) break; this.acts.push({ a: 'warDeploy', at: this.S.m.mode === 'conquest' || this.dsel === 'rally' || String(this.dsel).startsWith('sq:') ? (this.dsel || 'hq') : 'auto', ...this._warPick() }); this.au.ui('go'); } break;
        case 'pause': if (k === 'tap' || (k === 'down' && e.key)) this.app.pauseGame(); break;
        case 'drone': if (k === 'down') this._droneToggle(); break;
        case 'zone': if (k === 'down') this._zoneNext(); break;
        case 'cams': if (k === 'down') this._camNext(); else if (k === 'long') this._camExit(); break;
        case 'melee': if (k === 'down' && this.droneId == null) this.acts.push({ a: 'melee' }); break;
        case 'radial': if (k === 'pick' && e.item && e.item.go) e.item.go(); break;
      }
    }
  }
  _shoutLine() {
    // 見ている相手で台詞を変える
    const c = this.ctx;
    if (c && c.k === 'person') { const b = this.S.byId[c.id]; if (b && b.kind === 'civ') return 'swat_civ'; }
    const n = (this.shoutN = (this.shoutN || 0) + 1);
    return ['swat_police', 'swat_hands', 'swat_drop', 'swat_ground'][n % 4];
  }
  _command(inp) {
    const p = this.p;
    // 息止めの切り替え: 構えをやめた・倒れた・息が切れた（あえいでいる）ら切る。押しても止められなかった（息が戻っていない）ときも 0.35 秒で切る
    {
      const ws = p && p.ws;
      if (this.breathOn && (!this.adsOn || !p || !p.alive || p.down || (ws && ws.gasp > 0) || (!(ws && ws.holding) && this.time - (this._brT || 0) > 0.35))) this.breathOn = false;
    }
    // 走り出したらリーンをやめる（11-20 の要望。前はリーンしている間は走れず、スティックを押し込んでも歩いたまま）。
    //  走り出した時だけ（ダッシュの固定の間にリーンを押したときは、前と同じく走りを止めてリーンする）
    if (inp.sprint && !this._sprWas && this.leanSide && !this.adsOn) this.leanSide = 0;
    this._sprWas = !!inp.sprint;
    if (this._adsBr && (!inp.hold.has('ads') || !this.adsOn)) this._adsBr = false;
    const brBtn = ((this.app.settings.breathMode || 'toggle') === 'hold' ? inp.hold.has('breath') : !!this.breathOn) || !!this._adsBr;
    // 構える・構えをやめる: 銃を上げ下げする小さな音（自分だけ・大規模戦）
    if (this.adsOn !== this._adsWas) { if (this._adsWas != null && this.S && this.S.war && p && p.alive && !p.down) this.au.sfx('act', null, { vol: 0.1, rate: this.adsOn ? 1.4 : 1.2 }); this._adsWas = this.adsOn; }
    if (inp.under && !inp.fire) this._underUntil = performance.now() + 250;
    // C4 を持っている間は構えない（構えのボタンは起爆）
    if (p && p.ws && p.ws.slot === 2 && GEAR[p.ws.gear] && GEAR[p.ws.gear].kind === 'c4') this.adsOn = false;
    const cmd = {
      mx: inp.mx, mz: inp.mz, yaw: this.yaw, pitch: this.pitch,
      // ローレディは人の操作からはなくした（0.1.13。撃てなくなるだけで使う理由がない）。AI は今までどおり使う（銃を下げて歩く・投降など）
      fire: inp.fire && !this.app.input.radial, ads: this.adsOn, low: false, stance: this.stance, lean: this.leanSide, sprint: inp.sprint,
      // 息止め: ボタン（構えている間だけ出る。切替か長押し）か、構えているときの Shift（押している間。走りにはならない）
      breath: brBtn || (this.adsOn && !!(this.app.input.keys && this.app.input.keys.has('ShiftLeft'))),
      act: this.acts.length ? this.acts.splice(0) : null, power: 0.75,
      // 下投げ: 離した後 0.25 秒は残す（オンラインで、離したのと一緒に届くように）
      under: !!inp.under || performance.now() < (this._underUntil || 0),
      rc: this.rcComp > 0 ? this.rcComp : 0,
    };
    this.rcComp = 0;
    if (cmd.breath && this.adsOn) cmd.sprint = false;
    if (this.droneId != null) { cmd.mx = 0; cmd.mz = 0; cmd.fire = false; }
    if (this.camView != null) {
      const S = this.S;
      if (!p.alive || p.down || !S.cams || !S.cams[this.camView] || !S.cams[this.camView].ok) { if (S.cams && S.cams[this.camView] && !S.cams[this.camView].ok) this.hud.showBanner('カメラが壊された', 1300, 'bad'); this.camView = null; if (p.alive) cmd.act = (cmd.act || []).concat([{ a: 'camuse', i: -1 }]); }
      else if (Math.hypot(cmd.mx, cmd.mz) > 0.5) this._camExit();
      else {
        if (cmd.fire && (this._pinT == null || this.time - this._pinT > 0.5)) { this._pinT = this.time; cmd.act = (cmd.act || []).concat([{ a: 'campin', i: this.camView, yaw: this.camYaw, pitch: this.camPitch }]); }
        cmd.mx = 0; cmd.mz = 0; cmd.fire = false; cmd.ads = false;
      }
    }
    // のぞいている間: 撃つ・動くとやめる
    if (p.peek) { if (cmd.fire || Math.hypot(cmd.mx, cmd.mz) > 0.3) this._peekQuit(); cmd.fire = false; cmd.ads = false; }
    // しゃがみの状態を体に合わせる（伏せられないなど）
    return cmd;
  }

  // のぞいたときの見え方（11-12 22:05: 実際に沿って、程よく）。HUD へ渡す（hud.js）:
  //  ・等倍の照準器: 揺れのうち銃が受け持つ分だけ、照準の点が画面の真ん中からずれる（弾が飛ぶ所）
  //  ・スコープ: 目に寄せる途中（構え 0.7〜0.95）で接眼レンズの像が大きくなりながら現れる。目と筒の軸のずれで、
  //    丸い視界が少しずれて縁が暗く・ぼやける（スコープの影）: 反動で跳ね、向きを速く変えると遅れ、歩くと揺れ、揺れにもついていく
  // 目（カメラ）を壁から離す。起点: 体のまん中（足の上 = 体の当たりの円の中）を、目の高さで。ステップの間の補間も同じだけずらす
  _camOff(p, cam, e, q, kk) {
    const bx = q && kk > 0.001 ? p.x + (q[0] - p.x) * kk : p.x, bz = q && kk > 0.001 ? p.z + (q[2] - p.z) * kk : p.z;
    const o = camClear(this.w, bx, cam.y, bz, cam.x, cam.y, cam.z, CAM_CLR, this._cc || (this._cc = [0, 0, 0]));
    this.camPush = Math.hypot(o[0] - cam.x, o[1] - cam.y, o[2] - cam.z);
    cam.x = o[0]; cam.y = o[1]; cam.z = o[2];
  }
  // リロードの進み（0〜1。していなければ null）: 弾倉の入れ替え・まとめは残り時間から、1発ずつ込める銃は込めた数から
  _rlProg(p) {
    const ws = p && p.alive && p.ws; if (!ws) return null;
    if ((ws.st === 'reload' || ws.st === 'consol') && ws.rd > 0) return 1 - ws.t / ws.rd;
    if (ws.st === 'shell') { const wi = curWeapon(p), W = curW(p); if (!wi || !W || !W.rl) return null; const cap = magCap(wi) || 1, sh = W.rl.shell || 0.5; return Math.min(1, (wi.mag + Math.max(0, 1 - ws.t / sh)) / cap); }
    return null;
  }
  _aimFx(p, wi, cam, kc, swx, swy, cyaw, cpitch, dt) {
    const H = this.app.stage ? this.app.stage.h : 390, Wd = this.app.stage ? this.app.stage.w : 844;
    const ppr = (H / 2) / Math.tan(cam.fov / 2); // 画面の真ん中あたりの、1ラジアンあたりの画素
    const g = 1 - kc;
    this._retOff = [-g * swx * DEG * ppr, -g * swy * DEG * ppr];
    // 向きを変える速さ（ラジアン/秒。なめらかに）
    const lw = this._lastAim || [cyaw, cpitch];
    let wy = cyaw - lw[0]; wy = Math.atan2(Math.sin(wy), Math.cos(wy));
    const wp = cpitch - lw[1];
    this._lastAim = [cyaw, cpitch];
    const kk = 1 - Math.exp(-dt / 0.08), ww = this._aimW || [0, 0];
    ww[0] += ((dt > 0 ? wy / dt : 0) - ww[0]) * kk; ww[1] += ((dt > 0 ? wp / dt : 0) - ww[1]) * kk; this._aimW = ww;
    const o = binocZoom(p) ? BINOC_OPTIC : opticOf(wi);
    const a = Math.max(0, Math.min(1, (p.ads - 0.7) / 0.25)), k = a * a * (3 - 2 * a);
    if (!o.scope || k <= 0 || this._pipMode) { this._scopeFx = null; return; }
    const R = Math.min(H, Wd) * (0.3 + 0.13 * k); // 接眼レンズの像の半径（目に寄るほど大きい）
    const m = Math.min(1, (p.spd || 0) / 2.4), ph = p.phase || 0;
    let dx = ww[0] * 0.05 * R + Math.sin(ph) * m * 0.05 * R + (swx / 0.5) * 0.06 * R;
    let dy = ww[1] * 0.05 * R + (Math.abs(Math.cos(ph)) - 0.5) * m * 0.06 * R - (swy / 0.5) * 0.06 * R;
    const fk = Math.max(0, Math.min(1, p.fireK || 0));
    dy += fk * 0.09 * R; dx += fk * 0.03 * R * ((p.stats.sh || 0) % 2 ? 1 : -1);
    const d = Math.hypot(dx, dy), mx = 0.14 * R;
    if (d > mx) { dx *= mx / d; dy *= mx / d; }
    const off = Math.min(d, mx) / R;
    this._scopeFx = { k, r: R, dx, dy, e: R * (0.02 + 0.22 * off) };
  }

  // のぞくのをやめる（1回だけ送る）
  _peekQuit() { if (this.pkEnd || !this.p.peek) return; this.pkEnd = true; this.acts.push({ a: 'peekend' }); }

  // ---- 調べる（その時できること）
  _useDefault() {
    const c = contextOf(this.S, this.w, this.p);
    if (!c || tooFar(c)) { this.app.audio.ui('deny'); return; }
    this.acts.push({ a: 'use' });
  }
  _useMenu(e) {
    const c = contextOf(this.S, this.w, this.p);
    if (!c) return;
    if (tooFar(c)) return;
    const items = c.ops.map(o => ({ label: OP_NAME[o.op] || o.op, sub: o.far ? (o.why === 'block' ? '間に物' : '') : o.t ? o.t.toFixed(1) + '秒' : '', disabled: !!o.far, go: () => this.acts.push({ a: 'op', k: c.k, id: c.id, op: o.op }) }));
    if (!items.length) return;
    this.app.input.openRadial('use', items, e.pid, e.x, e.y);
    if (this.app.input.radial) this.app.input.radial.title = c.k === 'door' ? '扉' : c.k === 'person' ? '人' : c.k === 'item' ? '物' : '';
  }

  // ---- 命令（RoN）
  _lookTarget() {
    const S = this.S, w = this.w, p = this.p;
    const e = eyeOf(S, p);
    const cp = Math.cos(this.pitch), dx = Math.sin(this.yaw) * cp, dy = Math.sin(this.pitch), dz = Math.cos(this.yaw) * cp;
    const hits = raycast(w, e[0], e[1], e[2], dx, dy, dz, 40, S.doors, { out: [], seenProp: new Set(), seenDoor: new Set() });
    let door = -1, pt = null;
    for (const h of hits) {
      if (h.kind === 'door' || h.kind === 'bar') { if (h.t0 < 8) door = h.id; pt = [e[0] + dx * h.t0, e[1] + dy * h.t0, e[2] + dz * h.t0]; break; }
      if (h.mat === M.GLASS || h.mat === M.GLASSBROKEN) continue;
      pt = [e[0] + dx * h.t0, e[1] + dy * h.t0, e[2] + dz * h.t0];
      // 床に当たったら床の点、壁なら手前
      if (h.ny < 0.5) { pt[0] -= dx * 0.6; pt[2] -= dz * 0.6; }
      break;
    }
    // 近くの扉（見ている方向）
    if (door < 0) {
      let best = 4.5;
      for (const d of w.doors) {
        if (d.L !== levelOfY(p.y + 0.2)) continue;
        const ox = d.cx - p.x, oz = d.cz - p.z, dist = Math.hypot(ox, oz);
        if (dist > 4.5) continue;
        const f = (ox * dx + oz * dz) / Math.max(0.01, dist * Math.hypot(dx, dz));
        if (f < 0.8) continue;
        if (dist < best) { best = dist; door = d.id; }
      }
    }
    // 人
    let person = null;
    for (const b of S.actors) {
      if (b === p || b.kind === 'swat' || !b.alive) continue;
      const ox = b.x - e[0], oy = b.y + 1 - e[1], oz = b.z - e[2];
      const t = ox * dx + oy * dy + oz * dz;
      if (t < 0.3 || t > 12) continue;
      const perp = Math.sqrt(Math.max(0, ox * ox + oy * oy + oz * oz - t * t));
      if (perp < 0.7 && los(w, e[0], e[1], e[2], b.x, b.y + 1, b.z, S.doors)) { person = b; break; }
    }
    return { door, pt, person };
  }
  _cmdDefault() {
    const t = this._lookTarget();
    if (t.person && (t.person.comply || t.person.down || t.person.stun > 0)) return this._order({ cmd: 'restrain', target: t.person.id });
    if (t.door >= 0) {
      const ds = this.S.doors[t.door];
      if (ds && !isOpen(ds) && !ds.broken) return this._order({ cmd: 'stack', door: t.door, side: 'split' });
      return this._order({ cmd: 'breach', door: t.door, method: 'open', nade: 'none' });
    }
    if (t.pt) return this._order({ cmd: 'move', x: t.pt[0], y: t.pt[1], z: t.pt[2], yaw: this.yaw });
    this._order({ cmd: 'fallin' });
  }
  _cmdMenu(e) {
    const t = this._lookTarget();
    const S = this.S;
    const teamHas = (fn) => S.actors.some(a => a.kind === 'swat' && a.ai && a.alive && !a.down && (this.team === 'gold' || a.ai.squad === this.team) && fn(a));
    const hasNade = (id) => teamHas(a => a.inv.gear.some(g => g.id === id && g.n > 0));
    let items = [];
    if (t.door >= 0) {
      const ds = S.doors[t.door];
      const closed = ds && !isOpen(ds) && !ds.broken;
      const breach = (nade) => () => this._methodMenu(t.door, nade, e);
      items = [
        { label: '突入', sub: closed ? '開け方を選ぶ' : '入って確保', go: closed ? breach('none') : () => this._order({ cmd: 'breach', door: t.door, method: 'open', nade: 'none' }) },
        { label: '閃光で突入', disabled: !hasNade('flash'), go: closed ? breach('flash') : () => this._order({ cmd: 'breach', door: t.door, method: 'open', nade: 'flash' }) },
        { label: 'スティンガーで突入', disabled: !hasNade('stinger'), go: closed ? breach('stinger') : () => this._order({ cmd: 'breach', door: t.door, method: 'open', nade: 'stinger' }) },
        { label: 'ガスで突入', disabled: !hasNade('cs'), go: closed ? breach('cs') : () => this._order({ cmd: 'breach', door: t.door, method: 'open', nade: 'cs' }) },
        { label: 'ミラーで見る', disabled: !closed, go: () => this._order({ cmd: 'mirror', door: t.door }) },
        { label: 'スタック', sub: '分割', go: () => this._stackMenu(t.door, e) },
        { label: ds && ds.wedge ? 'ウェッジを外す' : 'ウェッジ', disabled: !closed || (!ds.wedge && !teamHas(a => a.inv.gear.some(g => g.id === 'wedge' && g.n > 0))), go: () => this._order({ cmd: ds && ds.wedge ? 'unwedge' : 'wedge', door: t.door }) },
        { label: ds && ds.trapSeen ? '罠を外す' : 'ピッキング', disabled: !closed || (!(ds && ds.trapSeen) && !(ds && ds.locked && !ds.lockBroken)), go: () => this._order({ cmd: ds && ds.trapSeen ? 'disarm' : 'pick', door: t.door }) },
      ];
    } else if (t.person) {
      items = [
        { label: '拘束', go: () => this._order({ cmd: 'restrain', target: t.person.id }) },
        { label: '捜索して確保', go: () => this._order({ cmd: 'search' }) },
        { label: '援護', go: () => this._order({ cmd: 'cover', x: t.person.x, y: t.person.y, z: t.person.z }) },
        { label: '集合', go: () => this._order({ cmd: 'fallin' }) },
      ];
    } else {
      const pt = t.pt;
      items = [
        { label: '移動', disabled: !pt, go: () => pt && this._order({ cmd: 'move', x: pt[0], y: pt[1], z: pt[2], yaw: this.yaw }) },
        { label: '集合', go: () => this._order({ cmd: 'fallin' }) },
        { label: '待機', go: () => this._order({ cmd: 'hold' }) },
        { label: '援護', disabled: !pt, go: () => pt && this._order({ cmd: 'cover', x: pt[0], y: pt[1], z: pt[2] }) },
        { label: '捜索して確保', go: () => this._order({ cmd: 'search' }) },
        { label: '閃光を投げる', disabled: !pt || !hasNade('flash'), go: () => this._order({ cmd: 'deploy', nade: 'flash', x: pt[0], y: pt[1], z: pt[2] }) },
        { label: 'スティンガーを投げる', disabled: !pt || !hasNade('stinger'), go: () => this._order({ cmd: 'deploy', nade: 'stinger', x: pt[0], y: pt[1], z: pt[2] }) },
        { label: 'ガスを投げる', disabled: !pt || !hasNade('cs'), go: () => this._order({ cmd: 'deploy', nade: 'cs', x: pt[0], y: pt[1], z: pt[2] }) },
      ];
    }
    this.app.input.openRadial('cmd', items, e.pid, e.x, e.y);
    if (this.app.input.radial) this.app.input.radial.title = `<span style="color:${TEAMCOL[this.team]}">${{ gold: '全員', red: '赤', blue: '青' }[this.team]}</span>へ命令`;
  }
  _methodMenu(door, nade, e) {
    const S = this.S;
    const teamHas = (fn) => S.actors.some(a => a.kind === 'swat' && a.ai && a.alive && !a.down && (this.team === 'gold' || a.ai.squad === this.team) && fn(a));
    const items = [
      { label: '開ける', go: () => this._order({ cmd: 'breach', door, method: 'open', nade }) },
      { label: '蹴る', go: () => this._order({ cmd: 'breach', door, method: 'kick', nade }) },
      { label: '破城槌', disabled: !teamHas(a => a.inv.long === 'ram'), go: () => this._order({ cmd: 'breach', door, method: 'ram', nade }) },
      { label: '散弾で開ける', disabled: !teamHas(a => a.inv.long === 'breacher'), go: () => this._order({ cmd: 'breach', door, method: 'breach', nade }) },
      { label: 'C2で爆破', disabled: !teamHas(a => a.inv.gear.some(g => g.id === 'c2' && g.n > 0)), go: () => this._order({ cmd: 'breach', door, method: 'c2', nade }) },
    ];
    setTimeout(() => { this.app.input.openRadial('cmd2', items, null, this.app.input.lastRadialX ?? this.app.stage.w / 2, this.app.stage.h / 2); this.app.input.radial.title = '開け方'; }, 30);
  }
  _stackMenu(door, e) {
    const items = [['分割', 'split'], ['左', 'left'], ['右', 'right']].map(([l, s]) => ({ label: l, go: () => this._order({ cmd: 'stack', door, side: s }) }));
    setTimeout(() => { this.app.input.openRadial('cmd2', items, null, this.app.stage.w / 2, this.app.stage.h / 2); this.app.input.radial.title = 'スタック'; }, 30);
  }
  _order(o) {
    this.acts.push({ a: 'cmd', team: this.team, ...o });
    this.app.audio.ui('cmd');
  }
  _gearMenu(e) {
    const p = this.p;
    const items = p.inv.gear.filter(g => g.n > 0).map(g => ({ label: GEAR[g.id].name.replace(/（.*）/, ''), sub: '×' + g.n, go: () => { this.gearSel = g.id; if (GEAR[g.id].kind === 'nade' || GEAR[g.id].kind === 'spray' || GEAR[g.id].kind === 'heal') this.acts.push({ a: 'gear', id: g.id }); } }));
    if (p.inv.long && p.inv.long !== 'none' && LONG[p.inv.long]) {
      const L = p.inv.long, on = L === 'shield' ? p.ws.slot === 1 : p.ws.slot === 3;
      const sub = L === 'm320' && p.inv.m320 ? '弾 ' + (p.inv.m320.flash + p.inv.m320.stinger + p.inv.m320.cs) : L === 'rpg' && p.inv.rpg ? '×' + (p.inv.rpg.in + p.inv.rpg.n) : on ? '銃に戻す' : '構える';
      // 大規模戦: 選ぶと装備のボタンの物になる（次からボタンを押すだけで構える）
      items.push({ label: LONG[L].name.replace(/（.*）/, '').replace(' グレネードランチャー', ''), sub, go: () => { if (this.S.war) this.gearSel = '@long'; if (!on) this.acts.push({ a: 'long' }); } });
    }
    if (!items.length) return;
    this.app.input.openRadial('gear', items, e.pid, e.x, e.y);
    if (this.app.input.radial) this.app.input.radial.title = '装備';
  }
  // ---- 大規模戦の投げ物・道具のボタン
  // 円の並びの1つ（設定の radNade・radGad の文字）→ 持っている物 { id, n, lb }（持っていなければ null）。
  // 'tool' 兵科の道具・'gad' 副の道具・'long' RPG など、ほかは道具の id そのもの
  _slotItem(c) {
    const p = this.p, G = p.inv.gear;
    const of = (id) => { const g = G.find(x => x.id === id); return g ? { id, n: g.n, lb: GEAR[id].name.replace(/（.*）/, '') } : null; };
    if (c === 'long') { const L = p.inv.long; if (!L || L === 'none' || !LONG[L]) return null; return { id: '@long', n: L === 'rpg' && p.inv.rpg ? p.inv.rpg.in + p.inv.rpg.n : null, lb: LONG[L].name.replace(/（.*）/, '') }; }
    if (c === 'tool') { for (const id of ['ammosmall', 'ammobig', 'medkit', 'binoc']) { const r = of(id); if (r) return r; } return null; }
    if (c === 'gad') { for (const id of ['c4', 'clay', 'apmine']) { const r = of(id); if (r) return r; } return null; }
    return c && GEAR[c] ? of(c) : null;
  }
  _slotIds(kind) { const st = this.app.settings; return (kind === 'nade' ? st.radNade : st.radGad) || []; }
  // 選んでいる物が持っていない物なら、並びの順で最初に持っている物（数が 0 でも）
  _fixSlots() {
    if (!this.S.war) return;
    for (const kind of ['nade', 'gad']) {
      const key = kind === 'nade' ? 'nadeSel' : 'gadSel', cur = this[key];
      const has = cur && (cur === '@long' ? this._slotItem('long') : this.p.inv.gear.some(g => g.id === cur));
      if (has) continue;
      let pick = null;
      for (const c of this._slotIds(kind)) { const it = this._slotItem(c); if (it) { pick = it.id; break; } }
      // 並びに入れていない物しか持っていない時
      if (!pick && kind === 'nade') { const g = this.p.inv.gear.find(x => GEAR[x.id].kind === 'nade'); pick = g ? g.id : null; }
      this[key] = pick;
    }
  }
  // 押した: 手に持っていれば銃に戻す。でなければ選んでいる物を持つ（数が 0 なら並びの次の物）
  _slotUse(kind) {
    const p = this.p; if (!p.alive) return;
    const held = p.ws.slot === 3 ? '@long' : p.ws.slot === 2 ? p.ws.gear : null;
    const isNade = (id) => id && id !== '@long' && GEAR[id] && GEAR[id].kind === 'nade';
    if (held && (kind === 'nade') === isNade(held) && held !== 'bandage') { this.acts.push({ a: 'switch', slot: p.ws.prev >= 0 && p.ws.prev < 2 ? p.ws.prev : 0 }); return; }
    let id = kind === 'nade' ? this.nadeSel : this.gadSel;
    const nOf = (q) => q === '@long' ? 1 : ((p.inv.gear.find(x => x.id === q) || { n: 0 }).n);
    if (!id || nOf(id) <= 0) { for (const c of this._slotIds(kind)) { const it = this._slotItem(c); if (it && (it.n == null || it.n > 0)) { id = it.id; break; } } }
    if (!id || nOf(id) <= 0) return;
    if (kind === 'nade') this.nadeSel = id; else this.gadSel = id;
    if (id === '@long') this.acts.push({ a: 'long' }); else this.acts.push({ a: 'gear', id });
  }
  // 選ぶ円（上・右・下・左の決まった場所。持っていない所は空き・数が 0 は薄く）。選ぶと持つ
  _slotMenu(kind, pid, x, y) {
    const p = this.p; if (!p.alive) return;
    const items = this._slotIds(kind).map(c => {
      const it = this._slotItem(c); if (!it) return null;
      return { label: it.lb, sub: it.n == null ? '' : '×' + it.n, disabled: it.n === 0, go: () => {
        if (kind === 'nade') this.nadeSel = it.id; else this.gadSel = it.id;
        if (it.id === '@long') { if (p.ws.slot !== 3) this.acts.push({ a: 'long' }); } else this.acts.push({ a: 'gear', id: it.id });
      } };
    });
    if (!items.some(Boolean)) return;
    this.app.input.openRadial(kind, items, pid, x, y);
    if (this.app.input.radial) this.app.input.radial.title = kind === 'nade' ? '投げ物' : '道具';
  }
  // HUD のボタンの表示
  _slotView() {
    const p = this.p, held = p.ws.slot === 3 ? '@long' : p.ws.slot === 2 ? p.ws.gear : null, out = {};
    for (const kind of ['nade', 'gad']) {
      const id = kind === 'nade' ? this.nadeSel : this.gadSel;
      const it = id ? this._slotItem(id === '@long' ? 'long' : id) : null;
      out[kind] = it ? { lb: it.lb, n: it.n, dis: it.n === 0, on: held === id } : { lb: '', n: null, dis: true, on: false };
    }
    const b = p.inv.gear.find(x => x.id === 'bandage'), rt = b && b.n > 0 ? this._reviveTgt() : null;
    out.heal = { lb: rt ? '起こす' : '包帯', n: b ? b.n : 0, dis: !b || b.n <= 0, on: held === 'bandage' || !!rt };
    return out;
  }
  // 拾う・引きずる・離す（大規模戦の「拾う」のボタンとキーボードの V）: 引きずっていれば離す、近くに倒れた味方がいれば引きずる、でなければ弾倉を拾う
  _ctxUse() {
    const S = this.S, p = this.p; if (!S || !S.war || !p.alive || p.down) return;
    if (p.drag != null) { this.acts.push({ a: 'op', k: 'person', id: p.drag, op: 'drag' }); return; }
    const rt = this._reviveTgt();
    if (rt) { this.acts.push({ a: 'op', k: 'person', id: rt.id, op: 'drag' }); return; }
    if (magNear(S, p)) this.acts.push({ a: 'pickmag' });
  }
  _ctxView() {
    const S = this.S, p = this.p; if (!S || !S.war || !p.alive || p.down) return null;
    if (p.drag != null) return 'drop';
    if (this._reviveTgt()) return 'drag';
    return magNear(S, p) ? 'pick' : null;
  }
  // 起こせる倒れた味方（大規模戦）: 自分が立っていて、1.8m 以内（横たわった胴の点から。エンジンは 1.9m まで届く）の倒れた味方のうち、近くて前にいる人
  _reviveTgt() {
    const S = this.S, p = this.p;
    if (!S || !S.war || !p || !p.alive || p.down || (p.act && p.act.k !== 'revive')) return null;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    let best = null, bs = 1e9;
    for (const b of S.actors) {
      if (b === p || !b.alive || !b.down || b.team !== p.team) continue;
      const tp = personPoint(S, b), dx = tp[0] - p.x, dz = tp[2] - p.z, d = Math.hypot(dx, dz);
      if (d > 1.8 || Math.abs(b.y - p.y) > 0.7) continue;
      const sc = d - 0.6 * (dx * fx + dz * fz) / (d || 1);
      if (sc < bs) { bs = sc; best = b; }
    }
    return best;
  }
  // ---- ドローン（対戦の攻撃側）
  _droneToggle() {
    if (this.droneId != null) { this.droneId = null; this.au.sfx('ui_back'); return; }
    // 自分のドローンがまだ動いていれば乗り移る（なければ新しく出す）
    const mine = this.S.actors.find(d => d.isDrone && d.owner === this.p.id && d.alive);
    if (mine) { this.droneId = mine.id; this.dyaw = mine.yaw; this.dpitch = 0; this.au.sfx('drone', null); return; }
    this.acts.push({ a: 'drone' });
  }
  // 監視カメラ（対戦の防衛側）: 押すたびに次のカメラ、最後の次（か長押し・移動）で戻る
  _camNext() {
    const S = this.S, m = S.m || {}, p = this.p;
    if (!S.pvp || m.kind === 'tdm' || p.team !== m.def || !p.alive || p.down || !S.cams || !S.cams.length) return;
    const n = S.cams.length;
    let i = this.camView == null ? (this._camLast ?? -1) : this.camView;
    for (let q = 0; q < n; q++) { i++; if (i >= n) { if (this.camView != null) return this._camExit(); i = 0; } if (S.cams[i].ok) break; if (q === n - 1) i = -1; }
    if (i < 0 || !S.cams[i] || !S.cams[i].ok) { this.hud.showBanner('使えるカメラがない', 1200); this.au.ui('deny'); return; }
    const K = mapCams(this.w, this.def)[i];
    this.camView = i; this._camLast = i; this.camYaw = K.yaw0; this.camPitch = K.pitch0;
    this.droneId = null; this.adsOn = false;
    this.acts.push({ a: 'camuse', i });
    this.au.sfx('drone', null, { vol: 0.4 });
  }
  _camExit() { if (this.camView == null) return; this.camView = null; this.acts.push({ a: 'camuse', i: -1 }); this.au.sfx('ui_back'); }
  // 出現地点（対戦の攻撃側・準備中）: 押すたびに次の地点
  _zoneNext() {
    const S = this.S, m = S.m || {};
    if (!S.pvp || m.kind === 'tdm' || this.p.team !== m.att || (m.phase !== 'pre' && m.phase !== 'prep')) return;
    const zs = attackZones(this.w, this.def);
    if (zs.length < 2) return;
    const z = ((this.p.zone ?? 0) + 1) % zs.length;
    this.p.zone = z;
    this.acts.push({ a: 'zone', z });
    this.au.ui('tap');
    this.hud.showBanner('出現地点: ' + zs[z].name, 1200);
  }
  _droneCmd(inp) {
    const d = this.S.byId[this.droneId];
    if (!d) return {}; // ゲスト: まだ写しに来ていない
    if (!d.alive) { this.droneId = null; return {}; }
    return { mx: inp.mx, mz: inp.mz, yaw: this.dyaw ?? d.yaw, pitch: this.dpitch ?? 0, fire: inp.fire, jump: inp.hold.has('vault') };
  }

  // ---- 出来事 → 音・効果・HUD
  _events(ev) {
    const S = this.S, p = this.p, hud = this.hud, fx = this.fx, au = this.au;
    const me = p.id;
    for (const e of ev) {
      switch (e.e) {
        case 'shot': {
          const a = S.byId[e.id]; if (!a) break;
          const W = WEAPONS[e.wid];
          let mz;
          if (a === p && this.vm.on) { mz = this.vm.out.muzzle; fx.muzzle(mz[0], mz[1], mz[2], this.vm.out.fwd[0], this.vm.out.fwd[1], this.vm.out.fwd[2], W.cat === 'pistol' ? 0.7 : 1, e.supp); const ej = this.vm.out.eject, r = this.vm.out.right; if (W.cat !== 'shotgun' && !W.revolver && !W.bolt) fx.shell(ej[0], ej[1], ej[2], -r[0] * 1.6 + this.vm.out.up[0], 1.4, -r[2] * 1.6 + this.vm.out.up[2], W.cal === '762x51' || W.cal === '762x39'); }
          // 遠い人（250m より先）の銃口の光は見えないので、銃の形を探さず、光も出さない（11-26: 大人数の撃ち合いで重かった）
          else if (Math.hypot(a.x - this.cam.x, a.z - this.cam.z) > 250) mz = [e.x, e.y + 1.4, e.z];
          else { const g = this._gunFrame(a); if (g) { const L = gunModel(e.wid, (curWeapon(a) || {}).att || {}); const ml = L ? L.len : 0.4; mz = [g.p[0] + g.f[0] * ml, g.p[1] + g.f[1] * ml, g.p[2] + g.f[2] * ml]; fx.muzzle(mz[0], mz[1], mz[2], g.f[0], g.f[1], g.f[2], 1, e.supp); } else mz = [e.x, e.y + 1.4, e.z]; }
          // 大規模戦: 遠い銃声（700m より先）は鳴らさず、遠くの銃声は 0.25 秒に 10 発まで（大人数で音が詰まらないように）
          let hear = true;
          if (S.war && a !== p) { const dd = Math.hypot(a.x - this.cam.x, a.z - this.cam.z); if (dd > 700) hear = false; else if (dd > 60) { if (this.time - (this._gunW || 0) > 0.25) { this._gunW = this.time; this._gunN = 0; } hear = ++this._gunN <= 10; } }
          if (hear) au.gun(e.wid, a === p ? null : mz, { supp: e.supp, local: a === p, n: e.n });
          { const d = a === p ? 0 : Math.hypot(a.x - this.cam.x, a.z - this.cam.z); this._heatUp(a === p ? 0.1 : (e.supp ? 0.12 : 0.3) * Math.max(0, 1 - d / 45)); }
          break;
        }
        case 'imp': if (!e.exit) { fx.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.m); if (Math.hypot(e.x - this.cam.x, e.z - this.cam.z) < 25) au.sfx(impSound(e.m), [e.x, e.y, e.z], { vol: 0.5 }); } else fx.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.m); break;
        case 'blood': {
          fx.bloodHit(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.n);
          // 後ろの壁や床に血の跡
          const hs = raycast(this.w, e.x, e.y, e.z, e.dx, e.dy - 0.3, e.dz, 2.2, S.doors, { out: [], seenProp: new Set(), seenDoor: new Set() });
          const h = hs.find(q => q.kind !== 'prop' || true);
          if (h) fx.bloodSplat(e.x + e.dx * h.t0, e.y + (e.dy - 0.3) * h.t0, e.z + e.dz * h.t0, h.nx || 0, h.ny || 0, h.nz || 0, 0.12 + 0.06 * e.n);
          break;
        }
        case 'hit': {
          const a = S.byId[e.id];
          // 当たりの印（BattleBit と同じく色で当たった所: 体 白・頭 黄・防具 青。research の 21）
          if (e.by === me && e.id !== me) { hud.hit(e.blocked ? 'armor' : e.hs || e.part === 'head' ? 'head' : ''); au.ui(e.blocked ? 'hitArmor' : 'hit'); }
          if (S.war && S.m.mode === 'range' && e.by === me && e.id !== me) {
            const PART = { head: '頭', neck: '首', chest: '胴', stomach: '腹', arm: '腕', leg: '脚' };
            this.rangeHit = { part: PART[e.part] || e.part, d: Math.round(e.d), m: Math.round(Math.hypot(e.x - p.x, e.y - p.y - 1.5, e.z - p.z)), t: this.time };
            hud.feed(`<b class="ally">${this.rangeHit.part}</b> ${this.rangeHit.d} ダメージ · ${this.rangeHit.m}m`, 'mine');
          }
          if (e.id === me) {
            const src = S.byId[e.by];
            if (src) hud.damageFrom(Math.atan2(src.x - p.x, src.z - p.z));
            this.dmgK = Math.min(1, this.dmgK + (e.d || 10) / 40); this.shake = Math.min(1, this.shake + (e.d || 10) / 60); this._heatUp(0.5);
            au.sfx(e.blocked ? 'plateHit' : 'fleshHit', null, { vol: 0.9 });
          } else if (a && Math.hypot(a.x - this.cam.x, a.z - this.cam.z) < 30) au.sfx(e.blocked ? 'plateHit' : 'fleshHit', [e.x, e.y, e.z], { vol: 0.5 });
          break;
        }
        // 近接: 振る音、当たった物の音（体・バリケードはそれぞれの出来事で）
        case 'melee': { const a = S.byId[e.id]; au.sfx('throw', e.id === me || !a ? null : [a.x, a.y + 1.3, a.z], { vol: e.id === me ? 0.75 : 0.55, rate: 1.3 }); break; }
        // C4: 起爆の音・切り替えの音
        // 投げるは射撃のボタン・起爆は構えのボタン（11-26）。貼っていない時の起爆は音だけ（文字は出さない。11-27 04:13: いらない文字を消す）
        case 'c4': if (e.id === me) { if (e.k === 'det') au.sfx('beep', null, { vol: 0.8, rate: 1.4 }); else if (e.k === 'none') au.sfx('dry', null, { vol: 0.5 }); } break;
        case 'mine': if (e.k === 'place' && e.by === me) au.sfx('cuffs', null, { vol: 0.5, rate: 0.8 }); break;
        case 'stick': { au.sfx('nadeBounce', [e.x, e.y, e.z], { vol: 0.6, rate: 0.7 }); break; }
        // 大ハンマー: 振る音・当たった音と粉（壁は面の色の欠片）
        case 'swing': { const a = S.byId[e.id]; if (a) au.sfx('air', a === p ? null : [a.x, a.y + 1.4, a.z], { vol: 0.7, rate: 0.55 }); break; }
        case 'hammer': {
          if (e.k === 'wall' && e.x != null) { au.sfx(impSound(e.m), [e.x, e.y, e.z], { vol: 1, rate: 0.8 }); au.sfx('barricade', [e.x, e.y, e.z], { vol: 0.5, rate: 1.3 }); if (fx.impact) for (let i = 0; i < 2; i++) fx.impact(e.x, e.y, e.z, e.nx || 0, e.ny || 0, e.nz || 0, e.m); }
          else if (e.k === 'body' && e.x != null) au.sfx('fleshHit', [e.x, e.y, e.z], { vol: 1, rate: 0.7 });
          if (e.id === me && e.k !== 'air') this.shake = Math.min(1, this.shake + 0.35);
          break;
        }
        case 'meleehit': if ((e.k === 'wall' || e.k === 'door') && e.x != null) { au.sfx(impSound(e.m), [e.x, e.y, e.z], { vol: 1 }); fx.impact && fx.impact(e.x, e.y, e.z, 0, 0, 0, e.m); } if (e.id === me && e.k !== 'air') this.shake = Math.min(1, this.shake + 0.3); break;
        case 'whiz': if (e.id === me) { this._heatUp(0.35); this.suppK = Math.min(1, this.suppK + e.k * 0.5); au.sfx('whiz', null, { vol: 0.4 + e.k * 0.5, rate: 0.9 + Math.random() * 0.2 }); } break;
        case 'kill': {
          const v = S.byId[e.id], k = S.byId[e.by];
          if (v && !v.isDrone) hud.feed(feedKill(k, v, e, p), k === p ? 'mine' : '');
          // 倒した印（赤）: 大規模戦では自分がダウンさせた相手には、ダウンの時に出す（あとで失血で死んだときに急に出さない）
          if (e.by === me && e.id !== me && !(this._downBy && this._downBy.get(e.id) > this.time - 120)) hud.hit('kill');
          if (this._downBy) this._downBy.delete(e.id);
          if (v === p) this._onDeath();
          if (v && v.kind === 'swat' && v !== p && !S.pvp) this._say(this._anyOfficer(v), 'swat_mandown');
          if (v && v.kind === 'sus' && k && k.kind === 'swat' && !S.pvp) this._say(k === p ? this._anyOfficer() : k, 'swat_susdown');
          break;
        }
        case 'down': {
          const v = S.byId[e.id];
          if (v === p && !S.war) { hud.showBanner(S.pvp ? 'ダウン — 救助待ち' : '行動不能', 3000, 'bad'); } // 大規模戦は倒れた時の案内（残り時間）だけ
          if (v && S.pvp) hud.feed(`${nm(S.byId[e.by])} が ${nm(v)} を倒した（ダウン）`);
          if (S.war && e.by === me && e.id !== me) { hud.hit('kill'); (this._downBy = this._downBy || new Map()).set(e.id, this.time); }
          break;
        }
        case 'cuffed': { const v = S.byId[e.id]; hud.feed(`${v.kind === 'sus' ? '容疑者' : '市民'}を拘束（${nm(S.byId[e.by])}）`, 'ok'); au.sfx('cuffs', [v.x, v.y + 0.8, v.z]); if (e.by !== me) this._say(S.byId[e.by], v.kind === 'sus' ? 'swat_cuffsus' : 'swat_cuffciv'); break; }
        case 'report': { const v = S.byId[e.id]; hud.feed(`TOCへ報告: ${v.kind === 'sus' ? '容疑者' : v.kind === 'civ' ? '市民' : '隊員'}（${e.st === 'dead' ? '死亡' : e.st === 'down' ? '行動不能' : '拘束'}）`, 'ok'); this._say(null, 'toc_copy', false, 'TOC'); break; }
        case 'evidence': hud.feed('証拠を回収', 'ok'); au.ui('pickup'); break;
        case 'bombdone': hud.feed('爆弾を解除', 'ok'); au.ui('ok'); this._say(null, 'toc_bomb', false, 'TOC'); break;
        case 'soft': hud.showBanner('主目的 達成<br><small>メニューから作戦終了、または続行</small>', 4500, 'ok'); au.ui('ok'); this._say(null, 'toc_soft', false, 'TOC'); break;
        case 'glass': {
          // 窓は1枚ぜんぶ割れる（マスごとに破片、音は1つ）
          const ks = e.ks && e.ks.length ? e.ks : [e.k], W = this.w.W, WD = this.w.W * this.w.D;
          for (const k of ks) { const i = k % W, j = Math.floor((k % WD) / W), L = Math.floor(k / WD); fx.glassBreak((i + 0.5) * CS, L * LH + 0.7, (j + 0.5) * CS); }
          { const k = e.k, i = k % W, j = Math.floor((k % WD) / W), L = Math.floor(k / WD); au.sfx('glass', [(i + 0.5) * CS, L * LH + 1.2, (j + 0.5) * CS], { vol: ks.length > 1 ? 1 : 0.85 }); }
          this.r.rebuildCells(ks, S); break;
        }
        case 'block': { const k = e.k, i = k % this.w.W, j = Math.floor((k % (this.w.W * this.w.D)) / this.w.W), L = Math.floor(k / (this.w.W * this.w.D)); fx.debris((i + 0.5) * CS, L * LH + e.q * 0.7 + 0.35, (j + 0.5) * CS, e.m === M.BRICK ? [0.45, 0.25, 0.2] : e.m === M.WOOD ? [0.5, 0.38, 0.25] : [0.82, 0.8, 0.76]); this._rebuild = this._rebuild || new Set(); this._rebuild.add(k); au.sfx('wallBreak', [(i + 0.5) * CS, L * LH + 1, (j + 0.5) * CS]); break; }
        case 'reinf': this._rebuild = this._rebuild || new Set(); this._rebuild.add(e.k); au.sfx('reinforce', null); break;
        case 'door': {
          const d = this.w.doors[e.d]; const pos = [d.cx, d.L * LH + 1, d.cz];
          const snd = { open: 'doorOpen', peek: 'doorOpen', close: 'doorClose', kickopen: 'doorKick', kickfail: 'doorKickFail', ram: 'doorRam', breach: 'doorBreach', locked: 'doorLocked', wedged: 'doorLocked', barred: 'doorLocked', unlock: 'lockPick', wedge: 'wedge', unwedge: 'wedge' }[e.k];
          if (snd) au.sfx(snd, pos);
          if (e.k === 'kickopen' || e.k === 'ram' || e.k === 'breach') { for (let i = 0; i < 3; i++) fx.smoke(d.cx, d.L * LH + 0.4, d.cz, 0.4, [0.7, 0.68, 0.64], 0.35, 1.5); }
          if (e.id === me && (e.k === 'locked' || e.k === 'wedged')) hud.showBanner(e.k === 'locked' ? '鍵がかかっている' : 'ウェッジで開かない', 1500);
          if (e.k === 'locked' && e.id !== me && S.byId[e.id] && S.byId[e.id].kind === 'swat') this._say(S.byId[e.id], 'swat_locked');
          break;
        }
        case 'deny': if (e.id === me) { const why = { locked: '鍵がかかっている', wedged: 'ウェッジで開かない', barred: 'バリケード', nogear: '残数なし', fullhp: '体力が満タン', nodet: '起爆対象なし', open: '開いている', broken: '破損', needdoor: '閉じた扉を見て使う', nolong: '特殊装備なし', noammo: '弾がない',  blocked: '間に物・人があって届かない', prepout: '準備中は建物の外に出られない', depspace: '前に置く場所がない', depfloor: '平らな床にしか置けない', depperson: '前に人がいる', depair: '立ってから置く' }[e.why]; if (why && !S.war) hud.showBanner(why, 1400); au.ui('deny'); } break; // 大規模戦は音だけ（11-27: いらない文字を消す）
        case 'nade': { if (e.type === 'frag' || e.type === 'impact') break; if (e.type === 'smoke') { for (let i = 0; i < 6; i++) fx.smoke(e.x, e.y + 0.5, e.z, 0.9, [0.62, 0.63, 0.64], 0.6, 3); au.sfx('gasPop', [e.x, e.y, e.z], { rate: 0.8 }); break; } if (e.type === 'cs') { for (let i = 0; i < 8; i++) fx.smoke(e.x, e.y + 0.4, e.z, 1.2, [0.85, 0.85, 0.8], 0.5, 6); au.sfx('gasPop', [e.x, e.y, e.z]); } else { fx.explosion(e.x, e.y, e.z, 3, e.type === 'flash' ? 'flash' : 'stinger'); au.sfx(e.type === 'flash' ? 'flashbang' : 'stinger', [e.x, e.y, e.z]); } const d = Math.hypot(e.x - this.cam.x, e.z - this.cam.z); this.shake = Math.max(this.shake, Math.max(0, 1 - d / 10) * 0.6); break; }
        // 建物が崩れた（大規模戦）: オンラインの参加側は自分の世界でも崩す。土ぼこり・がれき・低いとどろき・近いと揺れる
        case 'collapse': {
          let ks = e.ks || [];
          if (this.w && this.w.war) { const bd = (this.w.blds || []).find(q => q.id === e.bld); if (bd && !bd.down) ks = collapseBld(this.w, bd); }
          this.r.rebuildWarChunks && this.r.rebuildWarChunks(ks);
          const n = Math.min(14, Math.max(6, Math.round((e.w * e.d) / 10)));
          for (let i = 0; i < n; i++) { const x = e.x + (Math.random() - 0.5) * e.w, z = e.z + (Math.random() - 0.5) * e.d; fx.debris(x, e.y + 0.5 + Math.random() * 3, z, [0.55, 0.5, 0.45]); for (let q = 0; q < 2; q++) fx.smoke(x, e.y + 1 + Math.random() * 3, z, 2.2, [0.62, 0.58, 0.52], 0.55, 6); }
          au.boom([e.x, e.y + 2, e.z], { size: 1.3 }); au.sfx('wallBreak', [e.x, e.y + 1, e.z], { vol: 1, rate: 0.6 });
          const d = Math.hypot(e.x - this.cam.x, e.z - this.cam.z); this.shake = Math.max(this.shake, Math.max(0, 1 - d / 40) * 0.8);
          break;
        }
        // 大規模戦の窓ガラスが割れた（オンラインの参加側は、自分の世界でも同じ板を割る）
        case 'wglass': {
          let ks = e.ks || [];
          if (this.w && this.w.war) { const gb = this.w.boxes[e.id]; if (gb && gb.alive && gb.kind === 'glass') ks = breakPane(this.w, gb); }
          this.r.rebuildWarChunks && this.r.rebuildWarChunks(ks, 'glass');
          if (fx.glassBreak) fx.glassBreak(e.cx ?? e.x, (e.cy ?? e.y) - 0.6, e.cz ?? e.z);
          au.sfx('glass', [e.x, e.y, e.z], { vol: 0.85 });
          break;
        }
        case 'carve': {
          // オンラインの参加側（エンジンを回していない）: 自分の世界にも同じ穴を開ける
          let ks = e.ks || [];
          if (this.w && this.w.war && (this.w._carveN || 0) < (e.cn || 0)) { ks = carve(this.w, e.x, e.y, e.z, e.r || 1.3, e.o || (e.ham ? { force: true, w: 1.1, h: 1.3, floor: 1.1 } : {})); this.w._carveN = e.cn; }
          this.r.rebuildWarChunks && this.r.rebuildWarChunks(ks); const mat = [0.36, 0.31, 0.26]; if (fx.debris) for (let i = 0; i < (e.ham || e.shot ? 1 : 3); i++) fx.debris(e.x + (Math.random() - 0.5) * (e.shot ? 0.5 : 1.2), e.y + (Math.random() - 0.5) * (e.shot ? 0.4 : 1.0), e.z + (Math.random() - 0.5) * (e.shot ? 0.5 : 1.2), mat); au.sfx(e.shot ? 'wallBreak' : 'barricade', [e.x, e.y, e.z], { vol: e.shot ? 0.7 : 1, rate: e.shot ? 1.1 : 0.7 }); break; }
        case 'boom': case 'c2': { fx.explosion(e.x, e.y, e.z, Math.min(5, e.r || 3), e.kind || 'c2'); au.boom([e.x, e.y, e.z], { size: e.kind === 'frag' ? 1 : e.kind === 'rpg' ? 1.2 : e.kind === 'c4' ? 1.35 : 1.1 }); const d = Math.hypot(e.x - this.cam.x, e.z - this.cam.z); this.shake = Math.max(this.shake, Math.max(0, 1 - d / 18)); this._heatUp(0.5 * Math.max(0, 1 - d / 40)); break; }
        case 'flashed': if (e.id === me) { this.flashW = Math.max(this.flashW, Math.min(1, 0.4 + e.k * 1.2)); au.deafen(2 + 4 * e.k); } break;
        case 'stung': if (e.id === me) { this.shake = 1; this.blurK = Math.max(this.blurK, 0.8); } break;
        case 'tase': au.sfx('taser', S.byId[e.id] ? [S.byId[e.id].x, S.byId[e.id].y + 1, S.byId[e.id].z] : null); break;
        case 'spray': au.sfx('spray', S.byId[e.id] ? [S.byId[e.id].x, S.byId[e.id].y + 1.5, S.byId[e.id].z] : null); break;
        case 'reload': if (e.id === me) au.sfx(e.k === 'shell' ? 'shellStart' : 'magOut', null, { vol: 0.7 }); else { const a = S.byId[e.id]; if (a && a.kind === 'swat' && !S.pvp && Math.random() < 0.5) this._say(a, 'swat_reload'); if (a && this._nearCam(a, 20)) au.sfx('magOut', [a.x, a.y + 1.2, a.z], { vol: 0.5 }); } break;
        // ほかの人のリロード・持ち替え・ライトの音も近くなら聞こえる（11-20: 前は抜く音だけで、差す音・弾を込める音・持ち替えは自分だけ）
        case 'reloaded': if (e.id === me) au.sfx('magIn', null, { vol: 0.75 }); else { const a = S.byId[e.id]; if (a && this._nearCam(a, 18)) au.sfx('magIn', [a.x, a.y + 1.2, a.z], { vol: 0.45 }); } break;
        case 'shell': if (e.id === me) au.sfx('shellIn', null, { vol: 0.7 }); else { const a = S.byId[e.id]; if (a && this._nearCam(a, 14)) au.sfx('shellIn', [a.x, a.y + 1.2, a.z], { vol: 0.4 }); } break;
        case 'pumped': { const a = S.byId[e.id], wb = a && curWeapon(a); if (wb && WEAPONS[wb.id] && WEAPONS[wb.id].bolt) break; /* ボルトの音は 'bolt' で鳴らした */ if (e.id === me) au.sfx('pump', null, { vol: 0.75 }); else if (a) au.sfx('pump', [a.x, a.y + 1.2, a.z], { vol: 0.5 }); break; }
        // ボルトの操作の音（起こす・引く・押す・倒す。音の中の間合いは見た目の動きと同じ）
        case 'bolt': if (e.id === me) au.sfx('bolt', null, { vol: 0.8 }); else { const a = S.byId[e.id]; if (a) au.sfx('bolt', [a.x, a.y + 1.2, a.z], { vol: 0.55 }); } break;
        case 'zoom': if (e.id === me) { au.sfx('fmode', null, { vol: 0.5 }); if (!S.war) hud.showBanner(e.binoc ? `双眼鏡 ${e.z}倍` : e.sight === 'mag3' ? (e.z <= 1 ? 'ブースターを倒した（等倍）' : 'ブースター 3倍') : e.z <= 1 ? 'スコープ 等倍' : `スコープ ${e.z}倍`, 800); } break;
        case 'dry': if (e.id === me) au.sfx('dry', null, { vol: 0.6 }); break;
        case 'draw': if (e.id === me) au.sfx('draw', null, { vol: 0.45 }); else { const a = S.byId[e.id]; if (a && this._nearCam(a, 10)) au.sfx('draw', [a.x, a.y + 1.1, a.z], { vol: 0.3 }); } break;
        case 'fmode': if (e.id === me) { au.sfx('fmode', null, { vol: 0.5 }); if (!S.war) hud.showBanner(S.war ? (e.m === 'auto' ? 'AUTO' : e.m === 'burst' ? 'BURST' : 'SEMI') : e.m === 'auto' ? '連射' : '単発', 700); } break;
        case 'lightsw': if (e.id === me) au.sfx('click', null, { vol: 0.4 }); else { const a = S.byId[e.id]; if (a && this._nearCam(a, 6)) au.sfx('click', [a.x, a.y + 1.3, a.z], { vol: 0.25 }); } break;
        case 'step': { const a = S.byId[e.id]; if (a && a !== p) au.step(e.f, [e.x, e.y, e.z], e.loud); else if (a === p) au.step(e.f, null, e.loud * 0.6); break; }
        case 'shout': { const a = S.byId[e.id]; if (a) this._say(a, e.line > -1 || typeof e.line === 'string' ? e.line : 'swat_police', a === p); break; }
        case 'cmd': {
          const by = S.byId[e.id];
          if (by === p) { hud.feed(`<span style="color:${TEAMCOL[e.team] || '#ddd'}">■</span> ${cmdName(e.cmd)}`, 'cmd'); setTimeout(() => this._say(this._anyOfficer(null, e.team), 'swat_copy'), 350); }
          break;
        }
        case 'mirror': if (e.id === me || (S.byId[e.id] && S.byId[e.id].kind === 'swat')) { hud.showMirror(mirrorHTML(e, S)); if (e.id !== me) this._say(S.byId[e.id], e.seen.length ? (e.seen.some(s => s.kind === 'sus') ? 'swat_mirror_sus' : 'swat_mirror_civ') : 'swat_mirror_clear'); } break;
        case 'act': if (e.id === me) { const k = e.k; au.sfx(k === 'restrain' ? 'cuffsStart' : k === 'mirror' ? 'mirror' : k === 'plant' || k === 'defuse' || k === 'bombdefuse' ? 'beep' : 'act', null, { vol: 0.5 }); } break;
        case 'trap': au.sfx('explosion', null); break;
        case 'trapset': case 'c2set': au.sfx('act', null, { vol: 0.6 }); break;
        // バリケード: 打つ音・殴る／崩れる音（遠くまで聞こえる）・弾で削れた木っ端
        case 'barset': au.sfx('barricade', e.x != null ? [e.x, e.y, e.z] : null, { vol: e.id === me ? 0.6 : 1 }); break;
        case 'barhit': if (e.x != null) { if (e.big) { fx.splinter(e.x, e.y, e.z, true); au.sfx('barBreak', [e.x, e.y, e.z], { vol: 0.8 }); } else if (e.cut) { fx.splinter(e.x, e.y, e.z, false); au.sfx('woodHit', [e.x, e.y, e.z], { vol: 0.7 }); } } break;
        case 'barbreak': if (e.x != null) { if (!e.pry) fx.splinter(e.x, e.y, e.z, true, 0.7); au.sfx(e.pry ? 'woodHit' : 'barBreak', [e.x, e.y, e.z]); } break;
        case 'plant': hud.feed('解除装置を設置した', 'warn'); hud.showBanner('解除装置を設置！', 2500, 'warn'); au.ui('alarm'); break;
        case 'disable': hud.feed('解除装置を外した', 'ok'); break;
        case 'defpick': if (e.id === me) hud.showBanner('解除装置を拾った', 1500); break;
        case 'defdrop': hud.feed(`${nm(S.byId[e.id])} が解除装置を落とした`, 'warn'); break;
        case 'spotted': if (S.byId[e.by] && S.byId[e.by].team === p.team) au.ui('spot'); break;
        case 'drone': if (e.owner === me) { this.droneId = e.id; this.dyaw = p.yaw; this.dpitch = 0; au.sfx('drone', null); } break;
        case 'dronedead': if (e.id === this.droneId) { this.droneId = null; hud.showBanner('ドローンが壊された', 1500, 'bad'); } break;
        case 'camdead': if (e.x != null) { fx.impact && fx.impact(e.x, e.y, e.z, 0, 0, 0, M.METAL); au.sfx('impMetal', [e.x, e.y, e.z], { vol: 0.8 }); } if (e.by === me) hud.feed('監視カメラを壊した', 'mine'); break;
        // 防衛側が建物の外に出た（シージ）: 攻撃側には居場所、本人には警告
        case 'outside': { const a = S.byId[e.id]; if (!a) break; if (e.id === me) { hud.showBanner('建物の外 ― 居場所が知られた', 1800, 'bad'); au.ui('deny'); } else if (S.m && p.team === S.m.att) { hud.showBanner(`防衛側が外に出た（${a.name || ''}）`, 1600, 'warn'); au.ui('spot'); } break; }
        case 'phase': if (e.p === 'prep') hud.showBanner(S.m && p.team === S.m.att ? '準備フェーズ<br><small>ドローンで偵察・出現地点を選ぶ</small>' : '準備フェーズ<br><small>補強・バリケード（建物の外には出られない）</small>', 2600); else if (e.p === 'action') { hud.showBanner('行動開始', 1600, 'warn'); au.ui('go'); this.droneId = null; } break;
        case 'round': { const win = e.win; const mine = win === p.team; hud.showBanner(win < 0 ? '引き分け' : (mine ? 'ラウンド勝利' : 'ラウンド敗北') + `<br><small>${whyName(e.why)} ・ ${e.wins[p.team]} - ${e.wins[1 - p.team]}</small>`, 4000, win < 0 ? '' : mine ? 'ok' : 'bad'); au.ui(mine ? 'win' : 'lose'); break; }
        case 'roundstart': this.dead = false; this.spec = null; this._resetControls(); this.yaw = p.yaw; this.pitch = 0; this.av.hidden.add(me); this.fx.clear(); this.r.rebuildCells(Object.keys(this._lastBdiff || {}).map(Number).concat(this._allBroken()), S); this._lastBdiff = {}; this.r.setMap(this.w, this.def, S); { const st = S.m && S.m.sites && e.site >= 0 ? S.m.sites[e.site] : null; hud.showBanner(`ラウンド ${e.round}` + (st ? `　目標: ${st.name}` : ''), 2400); } break;
        case 'swap': hud.feed('攻守交代', 'warn'); break;
        case 'flag': {
          const f = S.m.flags.find(q => q.id === e.id), my = p.team;
          if (f) { const nm = `拠点${f.id}（${f.name}）`; if (e.owner === my) { hud.feed(`<b class="ally">${nm}</b> を確保`, 'mine'); au.ui('ok'); } else if (e.owner === 1 - my) { hud.feed(`<b class="enemy">${nm}</b> を奪われた`, ''); au.ui('deny'); } else if (e.prev === my) hud.feed(`${nm} が中立に戻された`, ''); else hud.feed(`${nm} を中立に戻した`, 'mine'); }
          break;
        }
        case 'matchend': if (S.war) { const win = e.win === p.team, draw = e.win < 0; const why = e.why === 'time' ? '時間切れ' : S.m.mode === 'conquest' ? (win ? '敵のチケットが尽きた' : 'チケットが尽きた') : S.m.mode === 'tdm' ? `${S.m.limit} キルに到達` : `${S.m.limit} 点に到達`; hud.showBanner(`${draw ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT'}<br><small>${draw ? '引き分け' : win ? '勝利' : '敗北'} ― ${why}</small>`, 4000, draw ? '' : win ? 'good' : 'bad'); au.ui(win ? 'win' : 'lose'); break; }
          { const mine = e.win === p.team; hud.showBanner(e.win < 0 ? '引き分け' : mine ? '勝利' : '敗北', 0, mine ? 'ok' : 'bad'); au.ui(mine ? 'win' : 'lose'); } break;
        case 'redeploy': if (e.id === me) { this.kiaT = -99; this.dlo = false; this._resetControls(); } break;
        case 'respawn': if (e.id === me) { this.dlo = false; hud.deploy(null); if (S.war) this.r.warmWar(p.x, p.z); this.dead = false; this.spec = null; this.yaw = p.yaw; this.pitch = 0; this._resetControls(); this.av.hidden.add(me); if (e.zone == null) hud.hideBanner();
          // 工兵で初めて出た時: RPG-7 の出し方（1回だけ）
        } break;
        case 'end': hud.showBanner(e.res === 'fail' ? '作戦失敗' : e.res === 'abort' ? '撤収' : '作戦完了', 0, e.res === 'fail' ? 'bad' : 'ok'); au.ui(e.res === 'fail' ? 'lose' : 'win'); break;
        case 'spot': if (e.by === me) { if (e.id < 0) au.ui('back'); else au.ui('spot'); } break;
        case 'score': if (e.id === me && S.war) this._score(e); break;
        case 'ammoBox': if (e.k === 'place') { au.sfx('land', [e.x, e.y + 0.2, e.z], { vol: 0.6, rate: 1.3 }); if (e.by === me) (S.war ? () => {} : hud.feed.bind(hud))(`${e.big ? '大きい' : '小さい'}弾薬箱を置いた（近くに立つと弾倉を補給）`, 'ok'); } break;
        case 'medkit': if (e.id === me) { au.sfx('bandage', null, { vol: 0.35, rate: 1.2 }); const t = S.byId[e.tgt]; (S.war ? () => {} : hud.feed.bind(hud))(t === p ? `自分を手当て（体力 ${e.hp}）` : `${t ? t.name : '仲間'} を手当て（体力 ${e.hp}）`, 'ok'); } else if (e.tgt === me) (S.war ? () => {} : hud.feed.bind(hud))(`${S.byId[e.id] ? S.byId[e.id].name : '衛生'} が手当てしている（体力 ${e.hp}）`, 'ok'); break;
        case 'resupply': if (e.id === me) { au.ui('pickup'); (S.war ? () => {} : hud.feed.bind(hud))(e.g ? `${e.g === 'rpg' ? 'RPG-7 の弾' : GEAR[e.g] ? GEAR[e.g].name.replace(/（.*）/, '') : ''}を補給した` : `弾倉を補給した（+${e.n}発）`, 'ok'); } break;
        case 'magDrop': au.sfx('magOut', [e.x, e.y + 0.1, e.z], { vol: 0.5, rate: 0.8 }); break;
        case 'magPick': if (e.id === me) { au.ui('pickup'); if (!S.war) hud.feed(e.swap != null ? `弾倉を取り替えた（${e.swap}発 → ${e.n}発）` : `弾倉を拾った（${e.n}発）`, 'ok'); } break;
        case 'magFull': if (e.id === me) { au.ui('deny'); if (!S.war) hud.feed('弾倉はいっぱい（持っている弾倉の方が多い）'); } break;
        case 'consol': if (e.id === me) { au.sfx('magOut', null, { vol: 0.5 }); if (!S.war) hud.feed('弾倉をまとめている…', 'ok'); } break;
        case 'consoled': if (e.id === me) { if (e.none) { au.ui('back'); (S.war ? () => {} : hud.feed.bind(hud))('まとめる弾倉がない（満タンでない弾倉が2本いる）', 'warn'); } else { au.ui('ok'); (S.war ? () => {} : hud.feed.bind(hud))('弾倉をまとめた', 'ok'); } } break;
        case 'order': if (S.war && e.team === p.team && e.sq === p.squad) { au.ui('spot'); hud.feed(`分隊の目標: 拠点 ${e.f} を${e.k === 'def' ? '守る' : '攻める'}`, 'ok'); } break;
        case 'sqp': if (S.war && e.team === p.team && e.sq === p.squad) hud.sqPoints(e.n, e.pts > 0 ? e.pts : 0); break;
        case 'rally': {
          if (!S.war) break;
          const mine = e.team === p.team && e.sq === p.squad;
          if (e.k === 'no' && e.by === me) { au.ui('back'); (S.war ? () => {} : hud.feed.bind(hud))(e.why === 'pts' ? `分隊ポイントが足りない（${RALLY.cost} 要る）` : e.why === 'cool' ? 'ビーコンはまだ置けない（壊されたばかり）' : e.why === 'ground' ? '地面に立って置く' : 'ビーコンは分隊長だけ', 'warn'); }
          else if (e.k === 'place') {  au.sfx('pump', [e.x, e.y + 0.3, e.z], { vol: 0.6, rate: 1.4 }); }
          else if (e.k === 'gone') { if (mine) hud.feed('ビーコンが壊された', 'warn'); fx.debris(e.x, e.y + 0.35, e.z, [0.29, 0.32, 0.21]); au.sfx('impMetal', [e.x, e.y + 0.3, e.z], { vol: 1 }); }
          break;
        }
        case 'revive': if (this._downBy) this._downBy.delete(e.id); if (e.by === me || e.id === me) hud.feed(`${nm(S.byId[e.by])} が ${nm(S.byId[e.id])} を起こした`, 'ok'); break;
        case 'bandaged': if (e.id === me) au.sfx('bandage', null); else { const a = S.byId[e.id]; if (a && this._nearCam(a, 8)) au.sfx('bandage', [a.x, a.y + 0.9, a.z], { vol: 0.35 }); } break;
        // 息が切れた（あえぐ）: 近くの人にも小さく聞こえる
        case 'gasp': if (e.id === me) au.sfx('gasp', null, { vol: 0.8 }); else { const a = S.byId[e.id]; if (a && this._nearCam(a, 7)) au.sfx('gasp', [a.x, a.y + 1.5, a.z], { vol: 0.3 }); } break;
        case 'exhale': if (e.id === me) au.sfx('exhale', null, { vol: 0.6 }); break;
        case 'inhale': if (e.id === me) au.sfx('inhale', null, { vol: 0.6 }); break;
        case 'jump': { const a = S.byId[e.id]; if (a) au.sfx('land', a === p ? null : [a.x, a.y + 0.2, a.z], { vol: a === p ? 0.3 : 0.25, rate: 1.5 }); break; }
        // 置いた物（置ける盾・有刺鉄線）
        case 'depset': au.sfx(e.k === 'wire' ? 'impMetal' : 'barricade', [e.x, e.y + 0.3, e.z], { vol: e.id === me ? 0.55 : 0.8, rate: e.k === 'wire' ? 1.4 : 0.8 }); break;
        case 'depbreak': if (e.why !== 'pick') { fx.debris(e.x, e.y, e.z, e.k === 'wire' ? [0.55, 0.56, 0.54] : [0.24, 0.26, 0.25]); au.sfx('impMetal', [e.x, e.y, e.z], { vol: 1, rate: 0.7 }); } else au.sfx('draw', [e.x, e.y, e.z], { vol: 0.5 }); break;
        case 'dephit': au.sfx('impMetal', [e.x, e.y, e.z], { vol: 0.8, rate: 1.3 }); break;
        // ヘルメット・顔の盾で弾がはじかれた（金属の高い音。撃たれた本人には近く大きく）・防弾板に当たった（鈍い音）
        case 'rico': if (e.x != null) au.sfx('impMetal', e.id === me ? null : [e.x, e.y, e.z], { vol: e.id === me ? 0.9 : 0.7, rate: 1.7 }); break;
        case 'plate': if (e.x != null) au.sfx('plateHit', e.id === me ? null : [e.x, e.y, e.z], { vol: e.id === me ? 0.8 : 0.6 }); break;
        // 構えの切り替え: 服のこすれ（伏せるときは低く重め）。ほかの人のは近くだけ（伏せ 14m・しゃがむ/立つ 8m）
        case 'stance': {
          if (e.id === me) au.sfx('act', null, { vol: e.pose === 2 ? 0.32 : 0.2, rate: e.pose === 2 ? 0.75 : e.pose === 1 ? 1.0 : 1.15 });
          else if (e.x != null) {
            const dd = Math.hypot(e.x - this.cam.x, e.z - this.cam.z);
            if (e.pose === 2 && dd < 14) au.sfx('act', [e.x, e.y + 0.4, e.z], { vol: 0.4, rate: 0.75 });
            else if (dd < 8) au.sfx('act', [e.x, e.y + 0.9, e.z], { vol: 0.25, rate: 1.05 });
          }
          break;
        }
        // リロードを途中でやめた（自分だけ。手を止める小さな音）
        case 'reloadx': if (e.id === me) au.sfx('click', null, { vol: 0.25, rate: 0.9 }); break;
        case 'wire': { const near = Math.hypot(e.x - this.cam.x, e.z - this.cam.z); if (near < 30) au.sfx('impMetal', e.id === me ? null : [e.x, e.y, e.z], { vol: e.id === me ? 0.35 : 0.55, rate: 1.6 + Math.random() * 0.3 }); break; }
        // 着地: 自分なら画面が揺れる。高い所から落ちたほど重い音（まわりにも聞こえる）
        case 'fall': {
          const big = (e.h || 0) > 2;
          if (e.id === me) { au.sfx('land', null, { vol: big ? 1 : 0.5, rate: big ? 0.8 : 1.1 }); if (big) { this.shake = Math.min(1, this.shake + 0.25 + 0.1 * e.h); this._heatUp(0.3); } }
          else if (e.x != null) {
            // ほかの人の着地: 高いほど重く遠くまで（跳んだだけの軽い着地も近くなら聞こえる）
            const dd = Math.hypot(e.x - this.cam.x, e.z - this.cam.z);
            if (big && dd < 35) au.sfx('land', [e.x, e.y + 0.2, e.z], { vol: Math.min(1, 0.4 + e.h * 0.15), rate: 0.75 });
            else if (!big && dd < 22) au.sfx('land', [e.x, e.y + 0.2, e.z], { vol: 0.35, rate: 1.15 });
          }
          break;
        }
        case 'throw': { if (e.hand) break; const a = S.byId[e.id]; au.sfx('throw', a === p ? null : [a.x, a.y + 1.5, a.z], { vol: e.under ? 0.4 : 0.6, rate: e.under ? 0.8 : 1 }); break; }
        // ピンを抜いた（投げ物を握った）: 自分だけ小さな金属の音
        case 'pin': if (e.id === me) au.sfx('click', null, { vol: 0.5, rate: 1.7 }); break;
        case 'bounce': if (e.v > 2) au.sfx('nadeBounce', [e.x, e.y, e.z], { vol: Math.min(1, e.v / 8) }); break;
        case 'launch': { const a = S.byId[e.id]; if (!a) break;
          if (e.type === 'rpg') {
            // RPG: 低い噴射の音と、後ろへ噴き出す煙（後方の噴射）
            au.sfx('launch', a === p ? null : [a.x, a.y + 1.4, a.z], { vol: 1, rate: 0.72 }); au.sfx('air', a === p ? null : [a.x, a.y + 1.4, a.z], { vol: 0.6, rate: 0.5 });
            const bx = -Math.sin(a.yaw), bz = -Math.cos(a.yaw);
            // 煙の尾の始まり（撃った所から）
            if (e.n != null) (this._rkL || (this._rkL = new Map())).set(e.n, [a.x + Math.sin(a.yaw) * 0.9, a.y + 1.5, a.z + Math.cos(a.yaw) * 0.9]);
            for (let i = 0; i < 6; i++) fx.smoke(a.x + bx * (0.8 + i * 0.35), a.y + 1.45 - i * 0.05, a.z + bz * (0.8 + i * 0.35), 0.5 + i * 0.08, [0.78, 0.77, 0.74], 0.4, 2.2);
            if (a === p) this.shake = Math.max(this.shake, 0.45);
            break;
          }
          au.sfx('launch', a === p ? null : [a.x, a.y + 1.4, a.z], { vol: 0.9 }); if (a === p) { this.shake = Math.max(this.shake, 0.3); if (this.vm.on) { const mz = this.vm.out.muzzle, f = this.vm.out.fwd; fx.smoke(mz[0] + f[0] * 0.1, mz[1], mz[2] + f[2] * 0.1, 0.25, [0.75, 0.74, 0.7], 0.25, 1.2); } } break; }
        case 'shieldhit': { const mine = e.id === me; au.sfx('plateHit', mine ? null : [e.x, e.y, e.z], { vol: mine ? 0.85 : 0.55 }); if (mine) { this.shake = Math.min(1, this.shake + (e.less ? 0.08 : 0.22)); const src = S.byId[e.by]; if (src) hud.damageFrom(Math.atan2(src.x - p.x, src.z - p.z)); } if (e.by === me) au.ui('hitArmor'); break; }
        case 'peek': if (e.id === me) { this.pkYaw = 0; this.pkPitch = e.door >= 0 ? 0.08 : 0; this.pkEnd = false; this.adsOn = false; au.sfx('mirror', null, { vol: 0.35 }); } break;
        case 'peekend': if (e.id === me) this.pkEnd = false; break;
        case 'longsel': if (e.id === me) au.sfx('draw', null, { vol: 0.5 }); break;
        case 'm320sel': if (e.id === me) { au.sfx('fmode', null, { vol: 0.5 }); hud.showBanner(`${ROUND_NAME[e.sel] || e.sel} ×${e.n ?? 0}`, 900); } break;
        case 'gearsel': if (e.id === me) au.sfx('draw', null, { vol: 0.3 }); break;
        case 'gearhint': if (e.id === me) hud.showBanner(`${GEAR[e.g] ? GEAR[e.g].name.replace(/（.*）/, '') : ''}<br><small>扉や壁を見て「調べる」を長押し</small>`, 2200); break;
      }
    }
    if (this._rebuild && this._rebuild.size) { this.r.rebuildCells([...this._rebuild], S); this._rebuild.clear(); }
  }
  _allBroken() { return []; }
  _gunFrame(a) { const e = this.av.list.find(x => x.a === a); return e && e.gun ? e.gun.f : null; }
  _anyOfficer(not, team) {
    const list = this.S.actors.filter(a => a.kind === 'swat' && a.ai && a.alive && !a.down && a !== not && (!team || team === 'gold' || a.ai.squad === team));
    return list[0] || null;
  }
  // 声と字幕
  _say(a, line, mine = false, who) {
    const L = LINES[line];
    if (!L) return;
    const now = performance.now();
    const key = (a ? a.id : 'x') + line;
    if (this.lastSub[key] && now - this.lastSub[key] < 2500) return;
    this.lastSub[key] = now;
    const v = L.v ? L.v[Math.floor(Math.random() * L.v.length)] : null;
    const speaker = who || (a ? (a === this.p ? (this.p.name || 'リード') : a.kind === 'swat' ? a.name : a.kind === 'sus' ? '容疑者' : a.kind === 'civ' ? '市民' : a.name) : '');
    const col = a && a.kind === 'sus' ? '#ff8a7a' : a && a.kind === 'civ' ? '#9fe0a0' : who === 'TOC' ? '#ffd27a' : '#9cd0ff';
    const idx = L.v ? L.v.indexOf(v) : 0;
    this.hud.subtitle(speaker, (L.ja && L.ja[idx]) || L.ja[0], col);
    const voice = a ? (a.kind === 'swat' ? (a === this.p ? 'p' : 'o' + ((a.ai && a.ai.slot) || 0)) : a.kind === 'sus' ? 's' + (a.id % 3) : 'c' + (a.id % 3)) : 'toc';
    this.au.voice(line, idx, voice, a && a !== this.p ? [a.x, a.y + 1.6, a.z] : null, { radio: !a || who === 'TOC' || (a.kind === 'swat' && a !== this.p && Math.hypot(a.x - this.p.x, a.z - this.p.z) > 12) });
  }
  // 倒れた・復帰した・ラウンドが変わった: 押しっぱなしの状態（リーン・しゃがみ・ADS・ダッシュの固定・カメラ）を戻す
  _resetControls() {
    this.adsOn = false; this.leanSide = 0; this.stance = 0;
    this.camView = null; this.droneId = null; this.pkEnd = false;
    const inp = this.app.input; if (inp) { inp.sprintLock = false; inp.sprintArm = false; if (inp.onStick) inp.onStick(null); if (inp.radial) inp.closeRadial(); }
    if (this.p) { this.p.lean = 0; this.p.ads = 0; this.p.low = 0; }
  }
  _onDeath() {
    this.dead = true; this.deathK = 1;
    this._resetControls();
    this.kiaT = this.time;
    this.hud.showBanner(this.S.war ? `KIA` : this.S.pvp ? (this.S.m.kind === 'tdm' ? 'KIA — 4秒後に復帰' : 'KIA — 観戦中') : 'KIA — 観戦中', 3000, 'bad');
    this.au.deafen(1.5);
  }

  // スコープのきらめき: 相手の銃の向きとこちらへの向きが近いほど強い（約 25° まで）。壁の向こうは光らない（0.25 秒ごとに見通しを調べる）
  _glints(dt) {
    const S = this.S, cam = this.cam, me = this.p;
    if (!cam) return;
    this._glT = (this._glT || 0) + dt;
    const recheck = this._glT > 0.25; if (recheck) this._glT = 0;
    const vis = this._glVis || (this._glVis = new Map());
    for (const a of S.actors) {
      if (a === me || !a.alive || a.down || (a.ads || 0) < 0.6 || a.team === me.team) continue;
      const wi = curWeapon(a); if (!wi) continue;
      const o = opticOf(wi); if (!o.scope) continue;
      const zs = zoomsOf(wi.att); if (Math.max(zoomOf(wi), ...(zs || [0])) < 6) continue; // 倍率を変えられるスコープは、いちばん高い倍率で決める
      const e = eyeOf(S, a), dx = cam.x - e[0], dy = cam.y - e[1], dz = cam.z - e[2], d = Math.hypot(dx, dy, dz);
      if (d < 4) continue;
      const cp = Math.cos(a.pitch), fx = Math.sin(a.yaw) * cp, fy = Math.sin(a.pitch), fz = Math.cos(a.yaw) * cp;
      const dot = (fx * dx + fy * dy + fz * dz) / d;
      if (dot < 0.9) { vis.delete(a.id); continue; }
      if (recheck || !vis.has(a.id)) vis.set(a.id, warLos(this.w, e[0], e[1], e[2], cam.x, cam.y, cam.z));
      if (!vis.get(a.id)) continue;
      // 大きさは見かけの角度で決める（遠くても点にならない: 芯 約 0.9°・まわりのにじみ 約 2.4°）。のぞいている倍率の分は小さく見える
      const k = Math.pow((dot - 0.9) / 0.1, 2), fl = 0.8 + 0.2 * Math.sin(this.time * 9 + a.id), zc = cam.fov ? Math.max(1, (55 * DEG) / cam.fov) : 1;
      const core = Math.max(0.12, d * 0.016 / Math.sqrt(zc)) * (0.55 + 0.45 * k), halo = core * 2.6;
      const x = e[0] + fx * 0.25, y = e[1] + fy * 0.25 - 0.02, z = e[2] + fz * 0.25, life = Math.max(0.02, dt * 1.05);
      this.fx.add({ x, y, z, vx: 0, vy: 0, vz: 0, life, s0: core, s1: core, c: [16 * k * fl, 15 * k * fl, 12 * k * fl, 1], add: true, sh: 0 });
      this.fx.add({ x, y, z, vx: 0, vy: 0, vz: 0, life, s0: halo, s1: halo, c: [1.6 * k * fl, 1.5 * k * fl, 1.3 * k * fl, 1], add: true, sh: 0 });
    }
  }

  // ステップの前の位置（描くときの補間に使う）
  _savePrev() {
    const P = this._prev || (this._prev = new Map());
    for (const a of this.S.actors) { let q = P.get(a.id); if (!q) P.set(a.id, q = [0, 0, 0]); q[0] = a.x; q[1] = a.y; q[2] = a.z; }
    // 自分の照準の揺れと反動も、ステップの間を補間して描く（こまとステップのずれで、スコープの像が小さく跳ねないように）
    const ws = this.p && this.p.ws;
    if (ws) { const A = this._prevAim || (this._prevAim = [0, 0, 0, 0]); A[0] = ws.sx || 0; A[1] = ws.sy || 0; A[2] = ws.ry || 0; A[3] = ws.rp || 0; }
  }
  // 補間した位置へ一時的に動かす（戻すのは _unlerp）
  _lerpActors() {
    const P = this._prev, k = 1 - (this._alpha ?? 1);
    if (!P || k <= 0.001) return null;
    const keep = [];
    for (const a of this.S.actors) {
      const q = P.get(a.id); if (!q) continue;
      const dx = q[0] - a.x, dy = q[1] - a.y, dz = q[2] - a.z;
      if (dx * dx + dy * dy + dz * dz > 1) continue; // 飛んだ（出現・乗り越えの始まり）
      keep.push(a, a.x, a.y, a.z);
      a.x += dx * k; a.y += dy * k; a.z += dz * k;
    }
    return keep;
  }
  _unlerp(keep) { if (!keep) return; for (let i = 0; i < keep.length; i += 4) { const a = keep[i]; a.x = keep[i + 1]; a.y = keep[i + 2]; a.z = keep[i + 3]; } }
  // ---- カメラと描画
  _render(dt, inp) {
    const S = this.S, p = this.p, r = this.r, st = this.app.settings;
    // 出撃の画面が開いている間は 3D を描かない（地図が画面全体をおおう。電池のため）
    if (S.war && this.hud.deployOn && !p.alive) { if (this.intro > 0) { this.intro = 0; this.app.fade(0); } return; }
    let cam;
    this._scopeFx = null; this._retOff = null; this._pipMode = false; // のぞいたときの見え方（生きて自分の目で見ているときだけ。_aimFx）
    const drone = this.droneId != null ? S.byId[this.droneId] : null;
    if (this._hidDrone != null && this._hidDrone !== this.droneId) { this.av.hidden.delete(this._hidDrone); this._hidDrone = null; }
    const CK = this.camView != null ? mapCams(this.w, this.def)[this.camView] : null;
    if (CK) {
      cam = { x: CK.x + Math.sin(this.camYaw) * 0.12, y: CK.y - 0.03, z: CK.z + Math.cos(this.camYaw) * 0.12, yaw: this.camYaw, pitch: this.camPitch, roll: 0, fov: 74 * DEG };
      this.av.hidden.delete(p.id);
    } else if (drone && drone.alive) {
      cam = { x: drone.x, y: drone.y + 0.14, z: drone.z, yaw: drone.yaw, pitch: drone.pitch, roll: 0, fov: 70 * DEG };
      this.av.hidden.delete(p.id); this.av.hidden.add(drone.id); this._hidDrone = drone.id;
    } else if (p.peek && p.alive && !(p.down && !S.pvp)) {
      // ミラー・オプティワンドの視点（扉の下・角の先）
      const pk = p.peek;
      cam = { x: pk.x, y: pk.y, z: pk.z, yaw: pk.yaw0 + this.pkYaw, pitch: this.pkPitch, roll: 0, fov: (pk.fov || 70) * DEG };
      if (!this.av.hidden.has(p.id)) this.av.hidden.add(p.id);
    } else if (p.staged) {
      // 準備中（攻撃側・体はまだ出ていない）: 味方のドローン、なければ出現地点から建物を見る
      const td = S.actors.find(d => d.isDrone && d.alive && d.team === p.team);
      if (td) { cam = { x: td.x, y: td.y + 0.14, z: td.z, yaw: td.yaw, pitch: td.pitch || 0, roll: 0, fov: 70 * DEG }; this.av.hidden.add(td.id); this._hidDrone = td.id; }
      else {
        const zs = attackZones(this.w, this.def), z = zs[p.zone ?? 0] || zs[0], tx = this.w.W * CS / 2, tz = this.w.D * CS / 2;
        cam = { x: z.x, y: 2.6, z: z.z, yaw: Math.atan2(tx - z.x, tz - z.z), pitch: -0.1, roll: 0, fov: 62 * DEG };
      }
      this.av.hidden.delete(p.id);
    } else if (p.alive && !(p.down && !S.pvp)) {
      const e0 = eyeOf(S, p), q = this._prev && this._prev.get(p.id), kk = 1 - (this._alpha ?? 1);
      // 目の位置もステップの間を補間（大きく飛んだときはそのまま）
      const e = q && kk > 0.001 && Math.hypot(q[0] - p.x, q[2] - p.z) < 1 ? [e0[0] + (q[0] - p.x) * kk, e0[1] + (q[1] - p.y) * kk, e0[2] + (q[2] - p.z) * kk] : e0;
      // 向きは指の動きをすぐ映す（エンジンのステップを待たない）。体が勝手に向く状態（テーザー・拘束）だけは体の向き
      // 大規模戦で倒れている間: 体は倒れた時の向きのまま回らず、目（頭）の位置も動かない。向きはまわりをぐるっと見渡せる
      //  （11-27 03:53: 前の版で見回す角度を左右 ±75° に絞ったが、要望は「目が大きく動く・めり込む」を直すことだけだった）
      const lookFree = !p.tased && !p.cuffed && !p.vault;
      const cyaw = lookFree ? this.yaw : p.yaw, cpitch = lookFree ? Math.max(-1.45, Math.min(1.45, this.pitch)) : p.pitch;
      const W = curW(p), wi = curWeapon(p);
      const zoom = binocZoom(p) || zoomOf(wi);
      const fov0 = vfovOf(st.hfov);
      // スコープ（11-19 23:27: BattleBit に合わせる）: どの倍率も画面ぜんたいを倍率どおりに寄せ、筒の黒い輪を重ねる。輪の外も同じ倍率で見える。
      //  前は 6倍未満だけ「レンズの中だけ拡大（外は寄せない）」で、倍率を変えると周りの見え方が変わっていた
      const pip = false;
      this._pipMode = pip; this._fov0 = fov0;
      const z = pip ? 1 + 0.2 * p.ads : 1 + (zoom - 1) * p.ads;
      // 被弾のぶれ（エイムパンチ）と揺れ
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const sh = this.shake * this.shake * (st.shakeK ?? 1);
      const t = this.time;
      // ボルトの操作中（スコープをのぞいたまま）: 像が少し跳ねて傾く（見た目だけ。狙いは変わらない）
      const bp = W && W.bolt && p.ws.st === 'pump' ? Math.sin(Math.PI * Math.max(0, Math.min(1, 1 - p.ws.t / (W.pump || 1)))) * p.ads : 0;
      // 照準の揺れ（ws.sx/sy。弾も同じ向きに飛ぶ）のうち視界が受け持つ分: スコープをのぞききると全部、等倍の照準器は35%（残りは銃と点が動く）
      const kc = swayCamK(wi, p.ads, pip), swx = p.ws.sx || 0, swy = p.ws.sy || 0;
      cam = {
        x: e[0], y: e[1], z: e[2],
        yaw: cyaw + ((p.ws.ry + kc * swx) * DEG) + Math.sin(t * 37) * 0.012 * sh + p.flinch * 0.03 * Math.sin(t * 23),
        pitch: cpitch + ((p.ws.rp + kc * swy) * DEG) + Math.sin(t * 41) * 0.012 * sh + p.flinch * 0.04 - bp * 0.006,
        roll: p.lean * 0.16 + Math.sin(t * 29) * 0.01 * sh + bp * 0.03,
        fov: 2 * Math.atan(Math.tan(fov0 / 2) / z),
      };
      this._aimFx(p, wi, cam, kc, swx, swy, cyaw, cpitch, dt);
      // 大規模戦: 目を壁・天井から離す（壁にくっつく・リーン・伏せで、近くを切る面が壁に入り、中や向こう側が見えていた。11-26）。
      //  起点は体のまん中（壁の外）の目の高さ。伏せは頭が体の前に出るので、腰の上から
      if (S.war && this.w && this.w.war) {
        // 倒れている: 目は地面から 0.3m より下げない（頭が地面・歩道の縁に入らないように）
        if (p.down) cam.y = Math.max(cam.y, p.y + 0.3);
        this._camOff(p, cam, e, q, kk);
      }
      if (!this.av.hidden.has(p.id)) this.av.hidden.add(p.id);
    } else {
      // 倒れた: 味方を見る（PvE は隊員、PvP は味方）
      const mates = S.actors.filter(a => a !== p && !a.isDrone && a.alive && !a.down && (S.pvp ? a.team === p.team : a.kind === 'swat'));
      if (!this.spec || !this.spec.alive || this.spec.down) this.spec = mates[0] || null;
      const t = this.spec;
      if (t) {
        const e = eyeOf(S, t);
        cam = { x: e[0] - Math.sin(t.yaw) * 1.6, y: e[1] + 0.35, z: e[2] - Math.cos(t.yaw) * 1.6, yaw: t.yaw, pitch: t.pitch - 0.1, roll: 0, fov: 60 * DEG };
        if (this.w && this.w.war) { const o = camClear(this.w, e[0], e[1], e[2], cam.x, cam.y, cam.z, CAM_CLR); cam.x = o[0]; cam.y = o[1]; cam.z = o[2]; }
      } else { const e = eyeOf(S, p); cam = { x: e[0], y: e[1] + 1.2, z: e[2], yaw: p.yaw, pitch: -0.6, roll: 0, fov: 60 * DEG }; }
      this.av.hidden.delete(p.id);
    }
    // 確かめ用の外からの視点（テストで動作の姿を横から撮る）
    if (this.debugCam) { cam = Object.assign({ roll: 0, fov: 60 * DEG }, this.debugCam); this.av.hidden.delete(p.id); }
    this.cam = cam;
    // 音は体の位置で聞く（のぞいているときも）
    if (p.peek && p.alive) { const e = eyeOf(S, p); this.au.listen(e[0], e[1], e[2], p.yaw, p.pitch); } else this.au.listen(cam.x, cam.y, cam.z, cam.yaw, cam.pitch);
    // 屋内か屋外か（残響と環境音）
    this._envT = (this._envT || 0) - dt;
    if (this._envT <= 0) {
      this._envT = 0.3;
      const ci = Math.floor(cam.x / CS), cj = Math.floor(cam.z / CS), cL = Math.max(0, Math.min(this.w.NL - 1, Math.floor(cam.y / LH)));
      const ind = this.S.war ? (sunVisAt(this.w, cam.x, cam.y - 1.6, cam.z) < 0.5 ? 1 : 0) : ci >= 0 && cj >= 0 && ci < this.w.W && cj < this.w.D && this.w.indoor[this.w.idx(cL, ci, cj)] ? 1 : 0;
      this._ind = this._ind == null ? ind : this._ind + (ind - this._ind) * 0.5;
      this.au.setEnv(this._ind);
      this.au.ambience(true, this._ind);
    }
    // 人と効果（ステップの間を補間した位置で）
    const keep = this._lerpActors();
    // 大規模戦: 遠すぎる人・画面の横より後ろの人は描かない（構えた倍率の分だけ遠くまで描く）
    let cull = null;
    if (S.war) {
      const zw = p.ads > 0.3 ? (binocZoom(p) || zoomOf(curWeapon(p)) || 1) : 1, asp = r.canvas.width / Math.max(1, r.canvas.height);
      const half = Math.atan(Math.tan((cam.fov || 60 * DEG) / 2) * asp);
      cull = { x: cam.x, z: cam.z, yaw: cam.yaw, d: 360 * Math.max(1, zw), cos: Math.cos(Math.min(Math.PI, half + 0.4)) };
    }
    this.av.prepare(S, this.w, { cull });
    this._unlerp(keep);
    this.av.hideCam = this.camView; // 見ているカメラ自身は描かない
    const fp = !this.dead && p.alive && !(p.down && !S.pvp) && !(drone && drone.alive) && this.camView == null && !p.peek && !this.debugCam;
    if (fp) this.vm.update(p, cam, dt, { pip: !!this._pipMode, vmFov: (st.vmFov || 54) * DEG, aspect: r.canvas.width / Math.max(1, r.canvas.height) }); else this.vm.on = false;
    // スコープの中の像: レンズの画面の上の位置と大きさ。像の向きは銃の向き（揺れ・反動の跳ねも映る）
    this._pip = null;
    { const L = fp && this._pipMode && p.ads > 0.3 ? this.vm.out.lens : null, wi2 = curWeapon(p);
      if (L && wi2) {
        const Hc = r.canvas.height, zm = zoomOf(wi2);
        this._pip = { c: [L.u, L.v], r: L.rf * Hc / 2, fov: 2 * Math.atan(L.rf * Math.tan(this._fov0 / 2) / zm), fwd: L.fwd, up: L.up, scale: st.quality === 'low' ? 0.6 : st.quality === 'high' ? 1 : 0.8,
          css: { x: L.u * (r.cssW || 1), y: (1 - L.v) * (r.cssH || 1), r: L.rf * (r.cssH || 1) / 2, k: Math.max(0, Math.min(1, (p.ads - 0.6) / 0.3)) } };
      }
    }
    // ボルトアクション: ボルトを引ききったところで薬莢が飛ぶ（一人称）
    if (fp && this.vm.on) {
      const Wb = curW(p);
      if (Wb && Wb.bolt && p.ws.st === 'pump') {
        const pr = 1 - p.ws.t / (Wb.pump || 1), n = p.stats.sh || 0;
        if (pr > 0.42 && this._boltEj !== n) { this._boltEj = n; const ej = this.vm.out.eject, r = this.vm.out.right, u = this.vm.out.up; this.fx.shell(ej[0], ej[1], ej[2], -r[0] * 1.3 + u[0] * 0.8, 1.6, -r[2] * 1.3 + u[2] * 0.8, true); }
      }
    }
    // 曳光弾
    for (const b of S.bullets) {
      if (!b.tr) continue;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const L = Math.min(sp * 0.018, 7);
      this.fx.tracer(b.x - b.vx / sp * L, b.y - b.vy / sp * L, b.z - b.vz / sp * L, b.x, b.y, b.z, b.less ? [1.5, 1.5, 1.2] : [9, 5, 2]);
    }
    // 残っているガスの雲（CS・ペッパー）: ときどき煙を足す
    this._cloudT = (this._cloudT || 0) + dt;
    if (this._cloudT > 0.25) {
      this._cloudT = 0;
      for (const c of S.clouds || []) { if (c.type === 'smoke') continue; const R = c.r || 1; const a = Math.random() * 6.28, d = Math.random() * R; this.fx.smoke(c.x + Math.cos(a) * d, c.y + 0.3 + Math.random() * 0.8, c.z + Math.sin(a) * d, Math.max(0.6, R * 0.6), c.type === 'pepper' ? [0.9, 0.75, 0.6] : [0.88, 0.88, 0.84], 0.32, 3.5); }
    }
    // RPG のロケット: 後ろに白い煙の尾（こまごとに、前のこまからの間を埋める）
    const RL = this._rkL || (this._rkL = new Map());
    for (const n of S.nades || []) {
      if (n.type !== 'rpg') continue;
      const key = n.id ?? Math.round(n.x * 10) + ':' + Math.round(n.z * 10), q = RL.get(key); RL.set(key, [n.x, n.y, n.z]);
      if (RL.size > 24) RL.delete(RL.keys().next().value);
      if (!q) continue;
      const d = Math.hypot(n.x - q[0], n.y - q[1], n.z - q[2]), k = Math.min(10, Math.ceil(d / 0.8));
      for (let i = 0; i < k; i++) { const t = i / k; this.fx.smoke(q[0] + (n.x - q[0]) * t, q[1] + (n.y - q[1]) * t, q[2] + (n.z - q[2]) * t, 0.32, [0.88, 0.87, 0.84], 0.42, 2.2); }
    }
    // 発煙弾の煙: 大きく濃い粒を絶えず足して、玉の形の壁にする
    this._smokeT = (this._smokeT || 0) + dt;
    if (this._smokeT > 0.08) {
      this._smokeT = 0;
      for (const c of S.clouds || []) {
        if (c.type !== 'smoke') continue;
        const R = Math.max(0.4, c.r || 1);
        for (let q = 0; q < 2; q++) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * R * 0.7, h = (Math.random() * 2 - 1) * R * 0.45; this.fx.smokeWall(c.x + Math.cos(a) * d, c.y + h - 0.2, c.z + Math.sin(a) * d, Math.max(0.6, R * 0.62), [0.58, 0.59, 0.6], 0.9, 3.6); }
      }
    }
    this.fx.update(dt);
    // スコープの反射（BattleBit の狙撃のスコープのきらめき）: 6倍以上のスコープをのぞいている相手が、こちらを向いていると光って見える。
    //  このこまだけの光（進めたあとに足すので、描くときに薄まらない）
    if (S.war) this._glints(dt);
    // 集合地点の雑音（近くにいると聞こえる。この作品の短い電子音を低く、2.4 秒ごと）
    if (S.war && S.rallies && S.rallies.length) { this._rlT = (this._rlT || 0) - dt; if (this._rlT <= 0) { this._rlT = 2.4; for (const r of S.rallies) if (Math.hypot(r.x - this.cam.x, r.z - this.cam.z) < 22) this.au.sfx('beep', [r.x, r.y + 0.4, r.z], { vol: 0.22, rate: 0.62, maxD: 22, verb: 0.2 }); } }
    this._lasers(fp, cam);
    this._tension(dt);
    // 動く光: 自分と隊員のライト、銃口・爆発
    const lights = [];
    const roomsFor = (x, y, z, R) => this._lightRooms(x, y, z, R);
    if (fp && this.vm.out.light) { const o = this.vm.out.light, f = this.vm.out.fwd; lights.push({ x: o[0] + f[0] * 0.05, y: o[1], z: o[2] + f[2] * 0.05, r: 22, col: [5.5, 5.2, 4.6], spot: { dx: f[0], dy: f[1], dz: f[2], cos: Math.cos(0.42) }, rooms: roomsFor(o[0], o[1], o[2], 22) }); }
    for (const e2 of this.av.list) {
      if (e2.drone || !e2.gun || !e2.gun.wi || !e2.gun.wi.lightOn || !e2.gun.wi.att.light || lights.length >= 6) continue;
      const g = e2.gun.f, gm = gunModel(e2.gun.wi.id, e2.gun.wi.att);
      const lp = gm && gm.pts.lightPt ? gm.pts.lightPt : [0, 0, 0.3];
      const x = g.p[0] + g.l[0] * lp[0] + g.u[0] * lp[1] + g.f[0] * lp[2], y = g.p[1] + g.l[1] * lp[0] + g.u[1] * lp[1] + g.f[1] * lp[2], z = g.p[2] + g.l[2] * lp[0] + g.u[2] * lp[1] + g.f[2] * lp[2];
      if (Math.hypot(x - cam.x, z - cam.z) > 35) continue;
      lights.push({ x, y, z, r: 18, col: [4.5, 4.3, 3.8], spot: { dx: g.f[0], dy: g.f[1], dz: g.f[2], cos: Math.cos(0.42) }, rooms: roomsFor(x, y, z, 18) });
    }
    this.fx.lights(lights, roomsFor);
    lights.sort((a, b) => (a.spot ? 0 : 1) - (b.spot ? 0 : 1));
    // 明るさに目が慣れる（屋内と屋外）
    const sky = r.sky;
    // 目の慣れ（自動露出）: まわりの明るさに合わせて、暗い部屋では明るく、外では抑える（ゆっくり追う）
    const lb = this._localBright(cam);
    const tgtE = (sky ? sky.exposure : 1) * (lb == null ? 1 : Math.max(0.8, Math.min(1.9, Math.pow(0.45 / (lb + 0.05), 0.45))));
    this.exposure += (tgtE - this.exposure) * (1 - Math.exp(-dt * (tgtE > this.exposure ? 1.2 : 2.2)));
    this.flashW = Math.max(0, this.flashW - dt * 0.35);
    this.dmgK = Math.max(0, this.dmgK - dt * 1.2);
    this.suppK = Math.max(0, this.suppK - dt * 0.8);
    this.blurK = Math.max(0, this.blurK - dt * 0.5);
    const gas = p.gas > 0 && p.armor.head !== 'gasmask' ? Math.min(1, p.gas / 4) : 0;
    const flash = Math.max(this.flashW, p.flash > 0 ? Math.min(1, p.flash / 3) : 0);
    const nvg = this.nvgOn && fp;
    // 煙の中にいる（カメラが煙の玉の中）
    let smk = 0;
    for (const c of S.clouds || []) { if (c.type !== 'smoke' || c.r < 0.6) continue; const d = Math.hypot(cam.x - c.x, (cam.y - c.y) * 1.4, cam.z - c.z); if (d < c.r) smk = Math.max(smk, Math.min(0.95, (c.r - d) / Math.max(0.4, c.r * 0.45))); }
    const lowHp = p.alive && p.hp < p.maxHp * 0.3 ? 0.35 : 0;
    // 範囲の外（大規模戦）: 色が抜けてざらつく（Battlefield の境界の画面）
    const oobK = S.war && p.alive && (p.oob || 0) > 0 ? Math.min(1, 0.5 + p.oob / OUT_LIMIT) : 0;
    // 部屋（一人称の光の届き方）
    const room = roomOf(this.w, cam.x, cam.y - 1, cam.z);
    r.render({
      cam, doors: S.doors, lights, dt,
      post: { smoke: smk, exposure: this.exposure * (st.bright || 1) * (S.war ? 1 : 1), nvg: nvg && !p.peek, flash, damage: Math.max(this.dmgK * 0.8, lowHp), supp: Math.max(this.suppK * 0.8, oobK * 0.7), gas, blur: Math.max(this.blurK, gas * 0.5, p.stun > 0 ? 0.4 : 0, flash * 0.6), vig: (p.peek ? 0.15 : (st.vignette === false ? 0.08 : 0.32)) + 0.22 * (this.hpK || 0), grade: S.war ? this._grade(st) : null, sat: (st.sat ?? 1.08) * (S.war ? WAR_GRADE.sat : 1) * (1 - 0.85 * oobK) * (1 - 0.45 * (this.hpK || 0)) * (1 - 0.7 * (this.deathK || 0)), peek: p.peek ? (p.peek.k === 'mirror' ? 2 : 1) : 0 },
      vm: fp ? { fov: (st.vmFov || 54) * DEG, room } : null, pip: this._pip, shadows: st.shadows !== 'off' && st.quality !== 'low',
      ambMin: nvg ? 0.02 : 0,
    });
    if (this.intro > 0) { this.intro -= dt; this.app.fade(Math.max(0, this.intro / 1.2)); if (this.intro <= 0) this.app.fade(0); }
  }
  // 撃ち合いの熱（0..1）: 近くの銃声・かすめた弾・当たった・爆発で上がり、14秒ほどで冷める
  _heatUp(k) { this.heat = Math.min(1, (this.heat || 0) + k); }
  // 緊張と重さ（毎こま）: 体力が少ない・最後の1人・撃ち合い → 心音・音のこもり・色・BGM の大きさ・準備の終わりの秒読み
  _tension(dt) {
    const S = this.S, p = this.p, m = S.m || {}, au = this.au;
    const alive = p.alive && !this.dead;
    const frac = (p.hp || 0) / (p.maxHp || 100);
    const hpK = alive ? Math.max(0, Math.min(1, (0.4 - frac) / 0.3)) : 0; // 体力40%から下で増え、10%で最大
    this.hpK = hpK;
    this.deathK = Math.max(0, (this.deathK || 0) - dt / 2.5);
    this.heat = Math.max(0, (this.heat || 0) - dt / 14);
    // 最後の1人（攻守のモードの行動中。味方が全員倒れ、相手が残っている）
    let clutch = false;
    if (S.pvp && m.kind !== 'tdm' && m.phase === 'action' && alive && !p.down) {
      let mates = 0, foes = 0;
      for (const a of S.actors) { if (a.isDrone || !a.alive || a.down || a.staged) continue; if (a.team === p.team) mates++; else foes++; }
      clutch = mates === 1 && foes >= 1;
      if (clutch && !this.clutch) this.hud.showBanner(foes > 1 ? `最後の1人<br><small>相手は${foes}人</small>` : '最後の1人<br><small>1対1</small>', 2200, 'warn');
    }
    this.clutch = clutch;
    // 心音（速さは体力で）
    const hv = Math.max(hpK * 0.55, clutch ? 0.2 : 0);
    if (hv > 0.02) { au.loop('heart', true, { vol: hv, fadeIn: 0.6 }); au.loopVol('heart', hv, 0.4); const h = au.loops && au.loops.heart; if (h && h.src) h.src.playbackRate.value = 1 + 0.45 * hpK + (clutch ? 0.12 : 0); }
    else au.loop('heart', false, { fade: 0.8 });
    au.setHurt(Math.max(hpK * 0.5, this.deathK * 0.9));
    // BGM: 作戦は静かな時に小さく、撃ち合いで大きく。対戦は行動中ほとんど鳴らさず（足音を聞く）、最後の1人・解除装置・残り30秒で上げる
    const el = (S.t - (m.phaseT || 0)) * S.dt;
    let k;
    if (S.pvp) {
      if (m.kind === 'tdm') k = Math.max(0.3, this.heat * 0.85);
      else if (m.phase === 'action') {
        const planted = m.defuser && m.defuser.planted && !m.defuser.disabled, late = m.roundTime && m.roundTime - el < 30;
        k = Math.max(0.12, this.heat * 0.45, clutch ? 0.9 : 0, planted ? 1 : 0, late ? 0.65 : 0);
      } else k = m.phase === 'post' ? 0.8 : 0.5;
    } else k = S.mode === 'pve' ? 0.3 + 0.7 * this.heat : 1;
    const mv = (S.pvp ? 0.55 : S.mode === 'pve' ? 0.6 : 0.35) * k;
    // （BGM の読み込みが遅れて既定の大きさで鳴り始めても合わせるよう、2秒ごとにも送る）
    this._mvT = (this._mvT || 0) - dt;
    if (Math.abs(mv - (this._mv ?? -1)) > 0.03 || this._mvT <= 0) { this._mv = mv; this._mvT = 2; au.musicVol(mv, 2.4); }
    // 準備の終わり（攻守のモード）: 3・2・1 の音
    if (S.pvp && m.phase === 'prep' && m.prepTime) { const s = Math.ceil(m.prepTime - el); if (s >= 1 && s <= 3 && s !== this._cdS) { this._cdS = s; au.ui('tick'); } }
    else this._cdS = null;
  }
  // レーザー: 赤は誰にでも見える。赤外線は暗視装置を着けているときだけ見える
  // 自分の点は弾の向き（反動込み）の先、ほかの人は銃の向きの先
  // 人がカメラから R m 以内（ほかの人の小さな音を近くだけ鳴らす）
  _nearCam(a, R) { const c = this.cam; return !!c && Math.hypot(a.x - c.x, a.z - c.z) < R && Math.abs(a.y - c.y) < 6; }
  _lasers(fp, cam) {
    const S = this.S, p = this.p, fx = this.fx;
    const nvg = !!(this.nvgOn && fp);
    // 色: 赤・緑（緑は目に明るく、昼でも見やすい）・赤外線（暗視装置でだけ白く）
    const COL = { red: [10, 0.35, 0.22], green: [0.5, 9, 0.9], ir: [6, 6, 6] }, colOf = (k) => COL[k] || COL.red;
    // 届く距離（何にも当たらなければ点は出さない。前は 60m 先の宙に点が浮いた）
    const RANGE = S.war ? 150 : 60;
    const opt = this._lzOpt || (this._lzOpt = { stopOpaque: true, out: [], seenProp: new Set(), seenDoor: new Set() });
    const hitAt = (ox, oy, oz, dx, dy, dz, skip) => {
      const hits = raycast(this.w, ox, oy, oz, dx, dy, dz, RANGE, S.doors, opt);
      let t = RANGE;
      for (const h of hits) { const m = MATS[h.mat]; if (m && m.see) continue; t = h.t0; break; }
      // 人: 立った円柱（しゃがみ・伏せで低く）
      const A = dx * dx + dz * dz;
      if (A > 1e-6) for (const a of S.actors) {
        if (a === skip || a.isDrone || !a.alive || a.staged) continue;
        const fx0 = ox - a.x, fz0 = oz - a.z, B = 2 * (fx0 * dx + fz0 * dz), C = fx0 * fx0 + fz0 * fz0 - 0.05;
        const disc = B * B - 4 * A * C; if (disc < 0) continue;
        const t0 = (-B - Math.sqrt(disc)) / (2 * A);
        if (t0 < 0.05 || t0 >= t) continue;
        const y = oy + dy * t0, top = a.y + (a.h || 1.8) * (a.stance === 2 ? 0.3 : a.stance === 1 ? 0.68 : 1);
        if (y >= a.y && y <= top) t = t0;
      }
      return t;
    };
    // 自分
    if (fp && p.laser && this.vm.out.laser && (p.laser !== 'ir' || nvg)) {
      const yaw = this.yaw + p.ws.ry * DEG, pitch = Math.max(-1.45, Math.min(1.45, this.pitch)) + p.ws.rp * DEG;
      const cp = Math.cos(pitch);
      let dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp, ox = cam.x, oy = cam.y, oz = cam.z;
      // 向き: 銃が狙いの向き（照準）に近い間は、弾の飛ぶ向き（照準）。走る・リロード・持ち替えで銃を横や下へ向けたら、
      //  銃の向きへ（11-20: 前は銃を横にしても線と点が正面を向いたまま）。6°〜11° の間でなめらかに移す
      const o = this.vm.out.laser, f = this.vm.out.fwd;
      {
        const ca = Math.max(-1, Math.min(1, dx * f[0] + dy * f[1] + dz * f[2])), u = Math.max(0, Math.min(1, (Math.acos(ca) - 0.1) / 0.1)), k = u * u * (3 - 2 * u);
        if (k > 0) {
          dx += (f[0] - dx) * k; dy += (f[1] - dy) * k; dz += (f[2] - dz) * k;
          const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
          ox += (o[0] - ox) * k; oy += (o[1] - oy) * k; oz += (o[2] - oz) * k;
        }
      }
      const t = hitAt(ox, oy, oz, dx, dy, dz, p);
      const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
      // 線は銃の少し先から（根元は見せない）。一人称の銃は別の画角（狭い）で描くので、その点を世界の画角で同じ画面の位置に移す
      //  （11-20: 前は線の始まりが銃から離れて見えた）
      let sx = o[0] + f[0] * 0.35, sy = o[1] + f[1] * 0.35, sz = o[2] + f[2] * 0.35;
      const C = this.vm.out.cam;
      if (C && cam.fov) {
        const kf = Math.tan(cam.fov / 2) / Math.tan(C.fov / 2), qx = sx - C.x, qy = sy - C.y, qz = sz - C.z;
        const lx = (qx * C.R[0] + qy * C.R[1] + qz * C.R[2]) * kf, ly = (qx * C.U[0] + qy * C.U[1] + qz * C.U[2]) * kf, lz = qx * C.F[0] + qy * C.F[1] + qz * C.F[2];
        sx = C.x + C.R[0] * lx + C.U[0] * ly + C.F[0] * lz; sy = C.y + C.R[1] * lx + C.U[1] * ly + C.F[1] * lz; sz = C.z + C.R[2] * lx + C.U[2] * ly + C.F[2] * lz;
      }
      fx.beam(sx, sy, sz, hx, hy, hz, colOf(p.laser), t < RANGE);
    }
    // ほかの人: 近い順に 10 人まで（大規模戦は 120m まで。赤い点と線は遠くからでも居場所が分かる）
    const far = S.war ? 120 : 45, cand = this._lzCand || (this._lzCand = []);
    cand.length = 0;
    for (const e2 of this.av.list) {
      if (e2.drone || !e2.gun || !e2.gun.wi || !e2.gun.wi.lightOn || !e2.gun.wi.att.laser) continue;
      if (e2.gun.wi.att.laser === 'ir' && !nvg) continue;
      const d = Math.hypot(e2.x - cam.x, e2.z - cam.z);
      if (d <= far) cand.push([d, e2]);
    }
    if (cand.length > 10) cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < cand.length && i < 10; i++) {
      const e2 = cand[i][1], kind = e2.gun.wi.att.laser;
      const g = e2.gun.f, gm = gunModel(e2.gun.wi.id, e2.gun.wi.att);
      const lp = gm && gm.pts.laserPt ? gm.pts.laserPt : [0, 0, 0.3];
      const ox = g.p[0] + g.l[0] * lp[0] + g.u[0] * lp[1] + g.f[0] * lp[2], oy = g.p[1] + g.l[1] * lp[0] + g.u[1] * lp[1] + g.f[1] * lp[2], oz = g.p[2] + g.l[2] * lp[0] + g.u[2] * lp[1] + g.f[2] * lp[2];
      const L = Math.hypot(g.f[0], g.f[1], g.f[2]) || 1, dx = g.f[0] / L, dy = g.f[1] / L, dz = g.f[2] / L;
      const t = hitAt(ox, oy, oz, dx, dy, dz, e2.a);
      fx.beam(ox, oy, oz, ox + dx * t, oy + dy * t, oz + dz * t, colOf(kind), t < RANGE);
    }
    cand.length = 0;
  }
  // カメラのまわり（5×5マス、床のマスだけ）の焼いた明るさの平均
  _localBright(cam) {
    if (this.S.war) return null;
    const w = this.w, b = w._bright; if (!b) return null;
    const ci = Math.floor(cam.x / CS), cj = Math.floor(cam.z / CS), L = Math.max(0, Math.min(w.NL - 1, Math.floor((cam.y - 0.3) / LH)));
    let s = 0, n = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= w.W || j >= w.D) continue;
      const k = w.idx(L, i, j), t = w.cell[k];
      if (t !== 1 && t !== 2 && t !== 10) continue; // 床・屋外・階段
      s += b[k]; n++;
    }
    return n ? s / n : null;
  }
  _localDark(cam) {
    if (this.S.war) return false;
    const b = this.w._bright; if (!b) return false;
    const i = Math.floor(cam.x / CS), j = Math.floor(cam.z / CS), L = Math.max(0, Math.min(this.w.NL - 1, Math.floor(cam.y / LH)));
    if (i < 0 || j < 0 || i >= this.w.W || j >= this.w.D) return false;
    return b[this.w.idx(L, i, j)] < 0.25;
  }
  // 動く光が届く部屋（今いる部屋＋開いた扉・開口・窓でつながる部屋、2段まで）
  _lightRooms(x, y, z, R) {
    const w = this.w, S = this.S;
    if (S.war) return [0];
    const r0 = roomOf(w, x, y - 1, z);
    const out = [r0];
    const rg = roomGraph(w);
    const seen = new Set([r0]);
    let front = [r0];
    for (let depth = 0; depth < 2; depth++) {
      const nx = [];
      for (const r of front) for (const p of rg.adj[r] || []) {
        const other = p.a === r ? p.b : p.a;
        if (seen.has(other)) continue;
        if (Math.hypot(p.x - x, p.z - z) > R) continue;
        let open = p.type !== 'wall';
        if (p.type === 'door') { const ds = S.doors[p.door]; open = ds && (ds.broken || ds.ang.some(a => Math.abs(a) > 0.15)); }
        if (p.type === 'wall') { const k = p.k; open = false; for (let q = 0; q < 4; q++) if (!w.blocks[k * 4 + q] && w.blocks0[k * 4 + q]) open = true; }
        if (!open) continue;
        seen.add(other); out.push(other); nx.push(other);
      }
      front = nx;
    }
    return out;
  }

  // ---- HUD
  _hud(dt) {
    const S = this.S, p = this.p, hud = this.hud;
    this.ctxT -= dt;
    if (this.ctxT <= 0) {
      this.ctxT = 0.12; this.ctx = p.alive && !S.war ? contextOf(S, this.w, p) : null;
      // 乗り越えられるか（ボタンを明るくするだけ。文字は出さない）
      const vp = p.alive && !p.vault ? vaultPlan(S, this.w, p, this._vp || (this._vp = {}), S.war && this.app.settings.jumpBtn ? { noHop: true } : undefined) : null;
      this.vaultOK = !!vp;
      // 置く物を手に持っている: 前に置けるか
      const hg = p.alive && p.ws && p.ws.slot === 2 && p.ws.gear && GEAR[p.ws.gear] && GEAR[p.ws.gear].kind === 'deploy' ? GEAR[p.ws.gear] : null;
      this.depHint = hg ? (depSpot(S, this.w, p, hg.dep) ? `${hg.name}: 射撃で前に置く` : `${hg.name}: ここには置けない（${{ space: '前に物がある', floor: '平らな床だけ', person: '前に人がいる', air: '足元が不安定' }[DEP_WHY] || '場所がない'}）`) : '';
    }
    const c = this.ctx;
    const wi = curWeapon(p);
    // 選んでいた物を持っていない（兵科を替えた・RPG のない兵科）: 投げ物の最初に戻す
    if (this.gearSel === '@long' ? !(p.inv.long && p.inv.long !== 'none' && LONG[p.inv.long]) : this.gearSel && !p.inv.gear.some(g => g.id === this.gearSel)) this.gearSel = (p.inv.gear.find(g => GEAR[g.id].kind === 'nade') || p.inv.gear[0] || {}).id || null;
    if (S.war) this._fixSlots();
    // 投げ物を手に持っている（下投げのボタンを出す・握っている間の信管の輪）
    const nadeHeld = !!(p.alive && !p.down && p.ws && p.ws.slot === 2 && p.ws.gear && GEAR[p.ws.gear] && GEAR[p.ws.gear].kind === 'nade');
    // 射撃の指: 投げ物を持っている間は、ずらすと下投げ（見回さない）
    this.app.input.nadeHeld = nadeHeld;
    const v = {
      p, wi, pvp: S.pvp, war: !!S.war, yaw: this.cam ? this.cam.yaw : p.yaw, adsOn: this.adsOn, slots: S.war ? this._slotView() : null, pick: S.war ? this._ctxView() : null, nadeHeld, underArm: nadeHeld && !!this.app.input.underArm,
      // ダッシュを押しているが、ほかの操作（構える・リーン・撃つ・リロード）が先で走っていない
      sprWait: !!(p.alive && !p.sprint && this.app.input && (this.app.input.sprintArm || this.app.input.sprintLock)), leanL: this.leanSide < 0, leanR: this.leanSide > 0, nvgOn: this.nvgOn, hasNvg: p.armor.head === 'nvg',
      gearSel: this.gearSel, gearId: p.ws.gear, team: this.team, c4n: S.war ? (S.nades || []).filter(n => n.type === 'c4' && n.by === p.id).length : 0,
      c4: !!(p.alive && !p.down && p.ws.slot === 2 && GEAR[p.ws.gear] && GEAR[p.ws.gear].kind === 'c4'), c4left: (p.inv.gear.find(g => g.id === 'c4') || { n: 0 }).n,
      spread: wi ? spreadDeg(S, p, WEAPONS[wi.id], wi) : 2,
      giveup: S.war && S.m.mode !== 'range' && p.alive && p.down ? (this.time - (this._guT ?? -99) < 2.5 ? 2 : 1) : 0,
      optic: p.ws && p.ws.slot === 2 && p.ws.gear === 'binoc' ? BINOC_OPTIC : null, canVault: this.vaultOK !== false, rally: this._rallyBtn(), rl: this._rlProg(p),
      ctxLabel: c && !tooFar(c) ? (c.def.far ? '回り込む' : (OP_NAME[c.def.op] || c.def.op)) : '',
      cmdLabel: '命令', mmZoom: this.mmZoom,
      droneOK: S.pvp && S.m.kind !== 'tdm' && p.team === S.m.att && (S.m.phase === 'prep' ? !!p.staged : S.m.phase === 'action' && p.alive && !p.down) && ((p.dronesLeft ?? 2) > 0 || S.actors.some(d => d.isDrone && d.owner === p.id && d.alive)),
      zoneOK: S.pvp && S.m.kind !== 'tdm' && p.team === S.m.att && (S.m.phase === 'pre' || S.m.phase === 'prep'),
      camsOK: S.pvp && S.m.kind !== 'tdm' && p.team === S.m.def && p.alive && !p.down && (S.m.phase === 'prep' || S.m.phase === 'action') && !!(S.cams && S.cams.some(c => c.ok)), camOn: this.camView != null,
    };
    if (v.zoneOK) { const zs = attackZones(this.w, this.def); v.zoneLabel = (zs[p.zone ?? 0] || zs[0] || {}).name || ''; if (zs.length < 2) v.zoneOK = false; }
    // 照準器の今の状態（倍率を切り替えると、模様・スコープの像・広い視野が変わる）
    if (wi) { const g = gunModel(wi.id, wi.att); if (g && g.pts.optic) { const o = opticOf(wi), key = wi.att.sight + o.kind + o.zoom; if (!this._opt || this._opt.key !== key || this._opt.base !== g.pts.optic) this._opt = { key, base: g.pts.optic, v: { ...g.pts.optic, kind: o.kind, scope: o.scope, wide: o.wide, zoom: o.zoom } }; v.optic = this._opt.v; } }
    v.retOff = this._retOff; v.scopeFx = this._scopeFx; v.pipFx = this._pip ? this._pip.css : null;
    if (this.droneId != null || this.camView != null) v.hideCross = true;
    // 案内
    let prompt = '';
    if (c && !tooFar(c)) prompt = `${ctxName(c, S)}: ${OP_NAME[c.def.op] || c.def.op}` + (c.def.far ? '（間に物がある）' : c.ops.length > 1 ? '（長押し: メニュー）' : '');
    if (!c && this.depHint) prompt = this.depHint;
    if (p.act) { v.prog = Math.min(1, p.act.t / p.act.dur); v.progLabel = S.war && p.act.k === 'revive' ? '起こす' : OP_NAME[p.act.k] || ''; prompt = ''; }
    // 投げ物を握っている（ピンを抜いた）: 信管の残りを輪で（離すと投げる。0 で手の中で爆発）
    else if (nadeHeld && p.ws.cook != null && !GEAR[p.ws.gear].impact) { const fz = fuseOf(S, p.ws.gear), left = Math.max(0, fz - p.ws.cook); v.prog = Math.min(1, p.ws.cook / fz); v.progLabel = `${left.toFixed(1)}秒`; }
    if (this.droneId != null) prompt = S.m && S.m.phase === 'prep' && p.staged ? 'ドローン ― 射撃: 敵にマーク／乗り越え: ジャンプ（準備が終わると出現地点に出る）' : 'ドローン ― 射撃: マーク／乗り越え: ジャンプ／ドローン: 戻る';
    else if (p.staged) prompt = '準備中 ― ドローンで偵察できる' + (v.zoneOK ? '（出現地点のボタンで出る場所を選ぶ）' : '');
    if (this.camView != null) prompt = `監視カメラ ${this.camView + 1}/${(S.cams || []).length} ― 射撃: 印をつける／カメラ: 次（長押し・動く: 戻る）`;
    // 防衛側が建物の外にいる: 2.5秒で居場所が知られる
    if (S.pvp && S.m && S.m.kind !== 'tdm' && p.team === S.m.def && (p.outT || 0) > 0 && p.alive) prompt = (p.outT >= OUT_GRACE ? '建物の外 ― 攻撃側に居場所が見えている' : `建物の外 ― あと${Math.max(0, OUT_GRACE - p.outT).toFixed(1)}秒で居場所が知られる`);
    // 手に持った特殊装備の使い方
    if (!p.act && p.ws.slot === 3 && !p.peek && p.ws.st !== 'holster') {
      const L = p.inv.long, door = c && c.k === 'door';
      if (L === 'ram' || L === 'breacher') prompt = door && c.ops.some(o => o.op === (L === 'ram' ? 'ram' : 'breach')) ? `射撃: ${L === 'ram' ? '破城槌で開ける' : '散弾で開ける'}` : '閉じた扉を見て、射撃で使う';
      else if (L === 'wand') prompt = door && c.ops.some(o => o.op === 'wand') ? '射撃: 扉の下をのぞく' : '射撃: 角の先をのぞく';
    }
    if (S.war) { prompt = this._warPrompt(prompt); this._warOverlay(); this._warDeploy(); }
    // 分隊ポイントの数（コンクエスト・ドミネーション）
    if (S.war && S.m.mode !== 'range' && S.m.mode !== 'tdm') { const n = (S.m.sqp || {})[p.team + ':' + p.squad] || 0; if (this._sqpN !== n) { this._sqpN = n; this.hud.sqPoints(n); } }
    else if (this._sqpN !== null) { this._sqpN = null; this.hud.sqPoints(null); }
    v.prompt = prompt;
    // のぞいている間
    hud.setPeek(p.peek && p.alive ? p.peek.k : null);
    // 目的
    const ob = this._objectives();
    v.objKey = ob.key; v.objHTML = ob.html;
    // 分隊の欄（大規模戦。設定で出す。BattleBit の Show Squad List）: 兵科・名前・体力・状態（ダウン・出撃待ち・距離）
    if (S.war && S.m.mode !== 'range' && this.app.settings.squadList) {
      const team = S.actors.filter(a => a !== p && a.team === p.team && a.squad === p.squad && !a.isDrone);
      const stOf = (a) => !a.alive ? '出撃待ち' : a.down ? 'ダウン' : Math.round(Math.hypot(a.x - p.x, a.z - p.z)) + 'm';
      v.squadKey = team.map(a => `${a.id}${Math.round(a.hp / 10)}${stOf(a)}${a.warCls || ''}`).join('|');
      v.squadHTML = team.map(a => `<div class="sq w${a.down || !a.alive ? ' dn' : ''}"><i></i><b>${(CLASSES[a.warCls] || {}).short || ''} ${a.name || ''}</b><em style="width:${a.alive ? Math.max(0, a.hp / a.maxHp * 100) : 0}%"></em><small>${stOf(a)}</small></div>`).join('');
    }
    // 隊員
    if (!S.pvp) {
      const team = S.actors.filter(a => a.kind === 'swat' && a !== p);
      v.squadKey = team.map(a => `${a.id}${Math.round(a.hp / 10)}${a.down ? 'd' : ''}${a.alive ? '' : 'x'}${a.ai && a.ai.order ? a.ai.order.cmd + (a.ai.order.stage || '') : ''}`).join('|');
      v.squadHTML = team.map(a => `<div class="sq ${a.ai ? a.ai.squad : 'p'}${a.down || !a.alive ? ' dn' : ''}"><i></i><b>${a.name}</b><em style="width:${Math.max(0, a.hp / a.maxHp * 100)}%"></em><small>${a.down || !a.alive ? '行動不能' : a.ai && a.ai.order ? cmdName(a.ai.order.cmd, a.ai.order.stage) : a.ai ? '追従' : ''}</small></div>`).join('');
    }
    // ミニマップの印
    const marks = [];
    for (const a of S.actors) {
      if (a === p || a.isDrone || (!a.alive && !a.dead)) continue;
      const mate = S.pvp ? a.team === p.team : a.kind === 'swat';
      if (mate) { marks.push({ x: a.x, z: a.z, col: a.alive ? (a.down ? '#ffaa33' : TC.ally) : '#666' }); continue; }
      // 見えている・印のついた相手
      const seenRecently = a.spot > 0 && (!S.pvp || a.spotTeam === p.team);
      const vis = this._visCache(a);
      if (seenRecently || vis) marks.push({ x: a.x, z: a.z, col: a.kind === 'civ' ? '#7be07b' : a.cuffed || a.comply ? '#ffd24a' : '#ff4a3a', r: 3 });
    }
    if (S.m && S.m.bombs) for (const b of S.m.bombs) if (!b.done && b.found) marks.push({ x: b.x, z: b.z, col: '#ff9a20', r: 4, sq: true });
    if (S.m && S.m.sites && S.pvp) for (const s2 of S.m.sites) if (S.m.target == null || s2.id === S.m.target) marks.push({ x: s2.x, z: s2.z, col: 'rgba(255,255,255,0.9)', r: 5, sq: true });
    // 味方の置いた物（置ける盾・有刺鉄線）
    if (S.rallies) for (const r of S.rallies) if (r.team === p.team && r.sq === p.squad) marks.push({ x: r.x, z: r.z, col: '#9be37a', r: 3.4, sq: true });
    if (S.deps) for (const d of S.deps) if (d.team === p.team && Math.abs(d.y - p.y) < 1.6) marks.push({ x: d.x, z: d.z, col: d.k === 'wire' ? 'rgba(190,190,180,0.85)' : 'rgba(120,160,140,0.95)', r: d.k === 'wire' ? 2.4 : 2.8, sq: true });
    v.marks = marks;
    hud.update(v);
    // スコア表（対戦）: 開いている間は 0.5 秒ごとに作り直す
    if (((S.pvp && !S.war) || (S.war && S.m.mode !== 'range')) && this.boardOn) { this._bdT = (this._bdT || 0) - dt; if (this._bdT <= 0) { this._bdT = 0.5; hud.board(this._boardData()); } }
    else hud.board(null);
    this._mmT = (this._mmT || 0) - dt;
    if (this._mmT <= 0) { this._mmT = 0.066; hud.drawMinimap(v); }
  }
  // 大規模戦: 拠点の中の案内（確保中・奪い合い・中立に戻している）
  _warPrompt(prompt) {
    const S = this.S, p = this.p, m = S.m;
    if (!p.alive) return '';
    // 倒れている: 起こしてもらえるまでの残り（起こされている間は止まる）
    if (p.down) { const left = Math.max(0, Math.ceil((p.dbno || 0) / 20 * WAR_DOWN_T)); return p.revT != null && S.t - p.revT <= 2 ? `${(S.byId[p.revBy] || {}).name || '味方'} が起こしている` : `倒れた ― 味方が起こせるのはあと ${left} 秒`; }
    // 近くに倒れた味方: 包帯のボタンで起こす
    if (p.drag != null && !p.act) { const b = S.byId[p.drag]; return `${(b && b.name) || '味方'} を引きずっている ― 離すのボタン・包帯のボタンで起こす`; }
    if (!p.act) { const rt = this._reviveTgt(); if (rt) return p.inv.gear.some(x => x.id === 'bandage' && x.n > 0) ? `${rt.name} を起こす ― 包帯のボタン（引きずる ― 引きずるのボタン）` : `${rt.name} を起こすには包帯が要る（引きずる ― 引きずるのボタン）`; }
    // 道具の使い方・弾薬箱の説明の文字は出さない（見るのを邪魔する。BattleBit も出さない）
    for (const f of m.flags) {
      if (Math.hypot(p.x - f.x, p.z - f.z) > f.r) continue;
      const my = p.team, mine = my === 0 ? f.prog : -f.prog, pct = Math.round(Math.abs(f.prog) * 100);
      const nm = f.id;
      if (f.contested && f.n[0] === f.n[1]) return `${nm} 奪い合い`;
      if (f.owner === my && mine >= 0.999) return '';
      if (f.owner === 1 - my) return `${nm} 中立へ ${100 - pct}%`;
      if (mine > 0) return `${nm} 確保中 ${pct}%`;
      return `${nm} 敵が確保中 ${pct}%`;
    }
    return prompt;
  }
  // 大規模戦: 世界の上の印（拠点の文字と距離・味方の頭の上の印）。画面の座標は描画の行列で求める
  _warOverlay() {
    const S = this.S, p = this.p, r = this.r, cam = this.cam;
    if (!cam || !r.vp) { this.hud.warMarks(null); return; }
    const vp = r.vp, W = this.hud.stage.w, H = this.hud.stage.h, list = [];
    const proj = (x, y, z) => { const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; if (cw < 0.1) return null; return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H]; };
    const my = p.team, goal = S.m.sqGoal && S.m.sqGoal[my + ':' + p.squad];
    const colOf = (o) => o < 0 ? 'rgba(235,235,230,0.95)' : o === my ? TC.ally : TC.enemy;
    for (const f of S.m.flags) {
      const q = proj(f.x, f.y + 11, f.z); if (!q) continue;
      const d = Math.hypot(f.x - cam.x, f.z - cam.z);
      const capping = Math.abs(f.prog) < 0.999 && (f.n[0] || f.n[1]);
      list.push({ k: 'flag', x: q[0], y: Math.max(14, Math.min(H - 14, q[1])), t: f.id, col: colOf(f.owner), d, prog: capping ? f.prog : null, pcol: f.prog > 0 ? (my === 0 ? TC.ally : TC.enemy) : (my === 1 ? TC.ally : TC.enemy), goal: f.id === goal ? (f.owner === my ? '防衛' : '攻撃') : '' });
    }
    if (S.rallies) for (const rl of S.rallies) {
      if (rl.team !== my || rl.sq !== p.squad) continue;
      const d = Math.hypot(rl.x - cam.x, rl.z - cam.z); if (d > 300) continue;
      const q = proj(rl.x, rl.y + 1.4, rl.z); if (!q || q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) continue;
      list.push({ k: 'sign', x: q[0], y: q[1], t: 'ビーコン ' + Math.round(d) + 'm', d });
    }
    if (this.w.signs) {
      const put = [];
      const sg2 = this.w.signs.map(sg => ({ sg, d: Math.hypot(sg.x - cam.x, sg.z - cam.z) })).sort((a, b) => a.d - b.d);
      for (const { sg, d } of sg2) {
        if (d > 1150) continue;
        const q = proj(sg.x, sg.y, sg.z); if (!q || q[0] < -30 || q[0] > W + 30 || q[1] < -20 || q[1] > H + 20) continue;
        if (put.some(o => Math.abs(o[0] - q[0]) < 50 && Math.abs(o[1] - q[1]) < 20)) continue;
        put.push(q);
        list.push({ k: 'sign', x: q[0], y: q[1], t: sg.d + 'm', d });
      }
    }
    // 倒れた味方（11-26。本家 1.31: 衛生には倒れた人の印と、あきらめるまでの残り時間が見える）:
    //  衛生は 150m 以内の倒れた味方すべてに十字と残りの輪。ほかの兵科は分隊の人（150m）と近くの味方（40m）に十字だけ
    const medic = p.warCls === 'medic' && p.alive && !p.down;
    for (const a of S.actors) {
      if (a === p || !a.alive || !a.down || a.team !== my) continue;
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      if (d > 150 || (!medic && a.squad !== p.squad && d > 40)) continue;
      const q = proj(a.x, a.y + 0.9, a.z); if (!q || q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) continue;
      list.push({ k: 'downm', x: q[0], y: q[1], d, left: medic ? Math.max(0, Math.min(1, (a.dbno || 0) / 20)) : null, rev: a.revT != null && S.t - a.revT <= 2 });
    }
    for (const a of S.actors) {
      if (a === p || !a.alive || a.down || a.team !== my) continue;
      const d = Math.hypot(a.x - cam.x, a.z - cam.z); if (d > 140) continue;
      const q = proj(a.x, a.y + bodyH(a) + 0.45, a.z); if (!q || q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) continue;
      const sq = a.squad === p.squad;
      list.push({ k: sq ? 'squad' : 'ally', x: q[0], y: q[1], col: a.down ? '#ffaa33' : sq ? '#6ee07a' : TC.ally, t: sq ? a.name : '', d });
    }
    // 印をつけた敵（分隊の誰かがつけた。10 秒。頭の上の赤い印と距離）
    for (const q of this.app.settings.showPings === false ? [] : S.m.spots || []) {
      if (q.team !== my || q.sq !== p.squad || q.until <= S.t) continue;
      const a = S.byId[q.id]; if (!a || !a.alive || a.down) continue;
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      const pr = proj(a.x, a.y + bodyH(a) + 0.55, a.z); if (!pr || pr[0] < -20 || pr[0] > W + 20 || pr[1] < -20 || pr[1] > H + 20) continue;
      list.push({ k: 'spot', x: pr[0], y: pr[1], col: '#ff3b2f', d });
    }
    this.hud.warMarks(list);
  }
  // 大規模戦: 兵科と銃の好み（プロフィールに残す）
  // LOADOUT の「道具」の行: 副の道具を「◀ 名前 ▶」で選ぶ
  _gadRow(cls, sel) {
    const gs = classGadgets(cls); if (!gs.length) return null;
    const list = gs.map(v => v === 'none' ? { v, name: 'なし', fx: '' } : { v, name: `${GEAR[v].name} ×${GEAR[v].max || 1}`, fx: GEAR[v].desc || '' });
    return { k: 'gad', lb: '副の道具', list, sel: gs.includes(sel) ? sel : gs[0] };
  }
  _warPrefs() {
    const P = this.app.profile;
    if (!P.war || typeof P.war !== 'object') P.war = {};
    const W = P.war; if (!W.guns) W.guns = {}; if (!W.secs) W.secs = {}; if (!W.att) W.att = {};
    return W;
  }
  _warPick() { const W = this._warPrefs(), c = this.dcls || 'assault'; return { cls: c, gun: W.guns[c], sec: W.secs[c], att: W.att, gad: (W.gad || {})[c] }; }
  _warPickSave() {
    const W = this._warPrefs(); W.cls = this.dcls;
    this.app.saveProfile();
    this.acts.push({ a: 'warClass', ...this._warPick() });
    if (this.p.deployAt) this.acts.push({ a: 'warDeploy', at: this.p.deployAt, ...this._warPick() });
  }
  // 大規模戦: 倒れている間（倒れて 1.8 秒あと）と試合の始めに、出撃の画面を出す
  _warDeploy() {
    const S = this.S, p = this.p, m = S.m;
    const show = !p.alive && !m.over && (!p.deployed || this.time - (this.kiaT ?? -99) > 1.8);
    if (!show) { this.hud.deploy(null); return; }
    if (!this.dcls) { const W = this._warPrefs(); this.dcls = canPick(p, W.cls) ? W.cls : 'assault'; this.acts.push({ a: 'warClass', ...this._warPick() }); }
    // 倒れたら自動で出撃（設定。BattleBit の Auto Ready When Dead）: 時間が来たら前に選んだ場所から出る（場所・兵科は変えられる）
    if (this.app.settings.autoDeploy && !p.deployAt && !m.over && m.mode !== 'range' && !(m.mode === 'conquest' && m.tickets[p.team] <= 0) && this._adT !== this.kiaT) {
      this._adT = this.kiaT;
      this.acts.push({ a: 'warDeploy', at: m.mode === 'conquest' || this.dsel === 'rally' || String(this.dsel).startsWith('sq:') ? (this.dsel || 'hq') : 'auto', ...this._warPick() });
    }
    this.hud.deploy(this._warDeployData());
  }
  // 集合地点のボタン: 分隊長（コンクエスト・ドミネーション）だけ。ポイントが足りない・待ち の間は薄く
  _rallyBtn() {
    const S = this.S, p = this.p, m = S.m;
    if (!S.war || !m || m.mode === 'range' || m.mode === 'tdm' || p.sqIdx !== 0 || !p.alive || p.down) return null;
    const key = p.team + ':' + p.squad, pts = (m.sqp || {})[key] || 0, cd = m.rallyCd && m.rallyCd[key] > S.t ? Math.ceil((m.rallyCd[key] - S.t) * S.dt) : 0;
    return { ok: pts >= RALLY.cost && !cd, lb: cd ? cd + 's' : rallyOf(S, p.team, p.squad) ? '置き直す' : 'ビーコン' };
  }
  // LOADOUT の付属品の行: 照準器・銃口・下・横。付けられる物だけ（attachOptions）。選んでいなければ makeWeapon の既定
  _attRows(gun, A) {
    const ao = attachOptions(gun), lo = classLoadout(this.dcls || 'assault', gun, null, { [gun]: A }), w = makeWeapon(lo.primary) || { att: {} };
    const L = [['sight', '照準器'], ['muzzle', '銃口'], ['grip', 'グリップ'], ['side', 'ライト類']];
    // 効き目の短い説明（縦・横の反動、初弾、構えの時間、音、腰だめ、倍率）
    const fx = (x) => { if (!x) return ''; const o = [], pc = (v) => (v < 1 ? '-' : '+') + Math.round(Math.abs(1 - v) * 100) + '%';
      if (x.zoom && x.zoom > 1.2) o.push(x.zooms ? x.zooms.join('/') + '倍' : x.zoom + '倍');
      if (x.rcv && x.rcv !== 1) o.push('縦の反動 ' + pc(x.rcv)); if (x.rch && x.rch !== 1) o.push('横の反動 ' + pc(x.rch)); if (x.rcfirst && x.rcfirst !== 1) o.push('初弾 ' + pc(x.rcfirst));
      if (x.ads) o.push('構え ' + (x.ads > 0 ? '+' : '-') + Math.round(Math.abs(x.ads) * 1000) + 'ms'); if (x.noise && x.noise !== 1) o.push('音 ' + pc(x.noise)); if (x.hip && x.hip !== 1) o.push('腰だめ ' + pc(x.hip)); if (x.light) o.push('ライト');
      return o.join('・'); };
    const short = (nm) => String(nm).replace(/（.*?）/g, '');
    return L.filter(([k]) => ao[k] && ao[k].length > 1).map(([k, lb]) => ({ k, lb, sel: w.att[k], list: ao[k].map(v => ({ v, name: short((ATTACH[k][v] || {}).name || v), fx: fx(ATTACH[k][v]) })) }));
  }
  _warDeployData() {
    const S = this.S, p = this.p, m = S.m, MD = WAR_MODES[m.mode] || WAR_MODES.conquest;
    const r = m.respawn.find(q => q.id === p.id);
    const left = r ? Math.max(0, (r.at - S.t) * S.dt) : 0;
    const opts = [];
    if (m.mode === 'conquest') {
      opts.push({ id: 'hq', label: 'HQ', x: m.hq[p.team][0], z: m.hq[p.team][1], hq: true });
      for (const f of m.flags) if (canSpawnAt(S, f, p.team)) opts.push({ id: f.id, label: f.id, x: f.x, z: f.z });
    }
    // 本家と同じく、分隊のビーコン（分隊長が置く）と、撃ち合いの最中でない分隊の仲間の上からも出られる（11-26 22:35）
    const rl = m.mode !== 'tdm' && m.mode !== 'range' ? rallyOf(S, p.team, p.squad) : null;
    const mates = m.mode !== 'range' && m.mode !== 'tdm' ? S.actors.filter(b => b !== p && b.team === p.team && b.squad === p.squad && b.alive && !b.down).sort((x, y) => (x.sqIdx || 0) - (y.sqIdx || 0)) : [];
    const mateOK = mates.filter(b => canSpawnOn(S, p, b));
    if ((rl || mateOK.length) && !opts.length) { const sp = m.spawns && m.spawns[p.team]; if (sp && sp.length) opts.push({ id: 'hq', label: '自陣', x: sp.reduce((s, q) => s + q[0], 0) / sp.length, z: sp.reduce((s, q) => s + q[1], 0) / sp.length, hq: true }); }
    if (rl) opts.push({ id: 'rally', label: 'ビーコン', x: rl.x, z: rl.z });
    // 仲間の印は、本陣・拠点・ビーコンの近く（40m）と、ほかの仲間の印の近く（12m）には出さない（11-27: 出撃のはじめは仲間が本陣に固まり、印が重なって読めなかった）
    const fixed = opts.slice();
    for (const b of mateOK) {
      if (fixed.some(o => Math.hypot(o.x - b.x, o.z - b.z) < 40)) continue;
      if (opts.some(o => o.mate && Math.hypot(o.x - b.x, o.z - b.z) < 12)) continue;
      opts.push({ id: 'sq:' + b.id, label: b.name || '仲間', x: b.x, z: b.z, mate: true });
    }
    // 選んでいた仲間が撃ち合いを始めた・倒れた: 選びを戻す（出撃の時もエンジンが確かめ、だめなら本陣から）
    if (opts.length && !opts.some(o => o.id === this.dsel)) this.dsel = 'hq';
    const W = this._warPrefs(), cls = this.dcls || 'assault', C = CLASSES[cls];
    const CAT = { rifle: 'RIFLE', sniper: 'SNIPER', smg: 'SMG', shotgun: 'SHOTGUN', pistol: 'PISTOL' };
    const gi = (id) => { const x = WEAPONS[id]; return { id, name: x.name, info: `${CAT[x.cat] || ''} · ${x.rpm} RPM · ${x.mag}` }; };
    const guns = classGuns(cls).map(gi), secs = classSecs(cls).map(gi);
    const gun = guns.some(g => g.id === W.guns[cls]) ? W.guns[cls] : guns[0].id, sec = secs.some(g => g.id === W.secs[cls]) ? W.secs[cls] : secs[0].id;
    const GN = { frag: '破片', impact: '衝撃', smoke: '発煙', flash: '閃光', bandage: '包帯' };
    // 投げ物と包帯は「投げ物」の行、弾薬箱・医療キット・双眼鏡・大ハンマーは「道具」の行（前は道具も投げ物の行に id のまま出ていた）
    const isThrow = (id) => !!GN[id];
    const toolTxt = (c, id0) => { const gs = classGadgets(id0), gd = gs.includes((W.gad || {})[id0]) ? (W.gad || {})[id0] : gs[0]; return c.gear.filter(([id]) => !isThrow(id)).map(([id, n]) => `${GEAR[id] ? GEAR[id].name : id}${n > 1 ? '×' + n : ''}`).concat(c.long ? [`${LONG[c.long].name}×${LONG[c.long].rockets || 1}`] : []).concat(gd && gd !== 'none' && GEAR[gd] ? [`${GEAR[gd].name}×${GEAR[gd].max || 1}`] : []).join('・'); };
    const squad = S.actors.filter(a => a.team === p.team && a.squad === p.squad).sort((x, y) => (x.sqIdx || 0) - (y.sqIdx || 0))
      .map(a => ({ name: a.name || '?', cls: a.warCls || 'assault', st: !a.alive ? (a.deployed === false ? 'wait' : 'dead') : a.down ? 'down' : 'alive', me: a === p }));
    const dots = [];
    for (const a of S.actors) if (a.team === p.team && a.alive && a !== p) dots.push({ x: a.x, z: a.z, sq: a.squad === p.squad });
    if (p.deployed) dots.push({ x: p.x, z: p.z, me: true });
    const ob = this._objectives();
    const tick = Math.floor(this.time * 2);
    return {
      board: m.mode !== 'range',
      title: (WAR_MAPS[this.w.mapId] || WAR_MAPS.riverbend).en, mode: m.mode === 'range' ? 'TRAINING' : `${MD.en} · ${sizeLabel(m.per)}`, scoreHtml: m.mode === 'range' ? '' : ob.html, scoreKey: m.mode === 'range' ? '' : ob.key, noSquad: m.mode === 'range',
      img: this.hud.plan && this.hud.plan.img, rect: m.rect, m, myTeam: p.team, mapKey: tick + '|' + m.flags.map(f => f.owner).join(','),
      opts, sel: this.dsel, dots, squad: { name: squadEn(p.squad, p.team), list: squad },
      cls, classes: CLASS_LIST.map(id => ({ id, en: CLASSES[id].en, short: CLASSES[id].short, name: CLASSES[id].name, hp: CLASSES[id].hp, desc: CLASSES[id].desc, tools: CLASSES[id].tools.join('・'), long: toolTxt(CLASSES[id], id), ok: canPick(p, id) })),
      lo: !!this.dlo, loTab: this.dloTab || 'gun', guns, secs, gun, sec, att: this._attRows(gun, W.att[gun] || {}), gad: this._gadRow(cls, (W.gad || {})[cls]), gunName: WEAPONS[gun].name, secName: WEAPONS[sec].name, gear: C.gear.filter(([id]) => isThrow(id)).map(([id, n]) => `${GN[id] || id}×${n}`).join('・'),
      left, queued: !!p.deployAt, canGo: !(m.mode === 'conquest' && m.tickets[p.team] <= 0),
      msg: p.deployAt && left > 0 ? 'もう一度押すとやめる' : m.mode === 'range' ? '射台から' : m.mode === 'conquest' && m.tickets[p.team] <= 0 ? 'NO TICKETS' : this.dsel === 'rally' ? 'ビーコンから' : String(this.dsel).startsWith('sq:') ? `${(S.byId[+String(this.dsel).slice(3)] || {}).name || '仲間'} のそばから` : m.mode === 'conquest' ? (this.dsel === 'hq' ? 'HQ から' : `拠点 ${this.dsel} から`) : '自陣の側から',
    };
  }
  _visCache(a) {
    const k = 'v' + a.id;
    this._vc = this._vc || {};
    const c = this._vc[k];
    if (c && this.time - c.t < 0.25) return c.v;
    const e = this.cam;
    const v = !!e && Math.hypot(a.x - e.x, a.z - e.z) < 30 && los(this.w, e.x, e.y, e.z, a.x, a.y + 1.2, a.z, this.S.doors) && smokeBetween(this.S, e.x, e.y, e.z, a.x, a.y + 1.2, a.z) < 0.9;
    this._vc[k] = { t: this.time, v };
    return v;
  }
  // スコア表の中身: 自分のチームが先。キル×2＋アシストの順。爆弾・殲滅戦は倒れている人を薄く
  // 点の表示（照準の下）。倒した時は頭への上乗せを別の行に分ける
  _score(e) {
    const S = this.S, hud = this.hud, v = S.byId[e.v];
    const LB = { assist: '倒すのを支援', revive: '仲間を起こした', cap: '拠点を奪った', neut: '拠点を中立に戻した', resupply: '弾を補給した', heal: '仲間を手当てした' };
    if (e.why === 'kill') {
      const W = WEAPONS[e.w];
      const line = `${v ? (v.name || '敵') : '敵'} を倒した${W ? '　' + W.name : ''}${e.d ? '　' + e.d + 'm' : ''}`;
      hud.points({ pts: e.pts - (e.hs || 0), label: '敵を倒した', line });
      if (e.hs) hud.points({ pts: e.hs, label: 'ヘッドショット' });
      return;
    }
    hud.points({ pts: e.pts, label: LB[e.why] || '点', line: e.why === 'cap' || e.why === 'neut' ? `拠点 ${e.f}` : '' });
  }
  _boardData() {
    const S = this.S, m = S.m || {}, p = this.p;
    const MODE = { tdm: 'チームデスマッチ', elim: '殲滅戦', bomb: '爆弾', war: S.war ? (WAR_MODES[m.mode] || WAR_MODES.conquest).en : '大規模戦' };
    const sideName = (t) => { const a = S.actors.find(x => x.team === t && !x.isDrone); return a && a.pvpSide === 'swat' ? 'SWAT' : a && a.pvpSide === 'sus' ? '立てこもり犯' : 'チーム' + (t + 1); };
    const score = (t) => m.kind === 'war' ? S.actors.filter(a => a.team === t).reduce((s, a) => s + a.stats.k, 0) : m.kind === 'tdm' ? (m.score || [0, 0])[t] : (m.wins || [0, 0])[t];
    const rows = (t) => S.actors.filter(a => !a.isDrone && a.team === t).map(a => ({ name: a.name || '?', k: a.stats.k, d: a.stats.d, a: a.stats.a, sc: a.stats.sc || 0, me: a === p, bot: a.pid == null, out: m.kind !== 'tdm' && !a.staged && (!a.alive || a.down) })).sort(m.kind === 'war' ? ((x, y) => y.sc - x.sc || y.k - x.k || x.d - y.d) : ((x, y) => (y.k * 2 + y.a) - (x.k * 2 + x.a) || x.d - y.d));
    const mine = p.team, foe = 1 - p.team;
    const sub = m.kind === 'war' ? sizeLabel(m.per) : m.kind === 'tdm' ? `目標 ${m.limit} キル` : `ラウンド ${m.round || 1}・先に ${m.winsNeeded} 勝`;
    if (m.kind === 'war') {
      // 大規模戦: 上位 10 人（自分が入っていなければ足す）。数字はチケット・点・キル
      const top = (t) => { const r = rows(t), k = r.slice(0, 10); const me = r.find(x => x.me); if (me && !k.includes(me)) k.push(me); return k; };
      const sc = (t) => Math.ceil((m.mode === 'conquest' ? m.tickets : m.score)[t]);
      return { sc: true, title: `${MODE.war}　${sub}`, teams: [{ name: 'ALLY', score: sc(mine), cls: 'mine', rows: top(mine) }, { name: 'ENEMY', score: sc(foe), cls: 'foe', rows: top(foe) }] };
    }
    return { title: `${MODE[m.kind] || '対戦'}　${sub}`, teams: [{ name: sideName(mine) + '（味方）', score: score(mine), cls: 'mine', rows: rows(mine) }, { name: sideName(foe), score: score(foe), cls: 'foe', rows: rows(foe) }] };
  }
  _objectives() {
    const S = this.S, m = S.m || {};
    if (S.war && m.mode === 'range') {
      // 射撃場: 名前と、最後に当てた所（部位・ダメージ・距離）
      const h = this.rangeHit;
      const txt = h ? `${h.part} ${h.d} · ${h.m}m` : '標的を撃つ（弾は減らない）';
      return { key: 'rg|' + txt, html: `<div class="wb rg"><b>SHOOTING RANGE</b><span>${txt}</span></div>` };
    }
    if (S.war) {
      // 上の帯: 味方の数字（チケット・点・キル）・拠点（持ち主の色。奪い合いは点滅。分隊の目標に印）・相手の数字。ドミネーション・TDM は残り時間と目標
      const p = this.p, my = p.team;
      const oob = p.alive && (p.oob || 0) > 0 ? Math.max(0, OUT_LIMIT - Math.floor(p.oob)) : 0;
      const goal = m.sqGoal && m.sqGoal[my + ':' + p.squad];
      const fl = [...m.flags].sort((a, b) => a.id < b.id ? -1 : 1).map(f => `<i class="fl${f.owner < 0 ? '' : f.owner === my ? ' o0' : ' o1'}${f.contested || (f.owner >= 0 && Math.abs(f.prog) < 0.999) ? ' ct' : ''}${f.id === goal ? ' goal' : ''}">${f.id}</i>`).join('');
      const v = m.mode === 'conquest' ? m.tickets : m.score;
      const t0 = Math.ceil(v[my]), t1 = Math.ceil(v[1 - my]);
      const left = m.timeLimit ? Math.max(0, m.timeLimit - (S.t - m.startT) * S.dt) : 0;
      const mid = m.mode === 'conquest' ? fl : `${fl}<span class="wt">${fmtT(left)}<small>${m.mode === 'tdm' ? 'KILLS' : 'SCORE'} ${m.limit}</small></span>`;
      const key = t0 + '|' + t1 + '|' + fl + '|' + oob + '|' + Math.floor(left);
      return { key, html: `<div class="wb${m.mode === 'conquest' ? '' : ' sc2'}"><b class="tk t0">${t0}</b>${mid}<b class="tk t1">${t1}</b>${oob ? `<span class="oob">範囲の外 ${oob}</span>` : ''}</div>` };
    }
    if (S.pvp) {
      const p = this.p;
      const el = (S.t - m.phaseT) * S.dt;
      if (m.kind === 'tdm') { const left = Math.max(0, m.timeLimit - el); return { key: m.score.join() + Math.floor(left), html: `<div class="sc"><b class="t0">${m.score[p.team]}</b><span>${fmtT(left)}<small>目標 ${m.limit}</small></span><b class="t1">${m.score[1 - p.team]}</b></div>` }; }
      let left = m.phase === 'prep' ? m.prepTime - el : m.phase === 'action' ? m.roundTime - el : 0;
      let sub = m.phase === 'prep' ? '準備' : m.phase === 'pre' ? '開始まで' : m.phase === 'post' ? 'ラウンド終了' : '';
      if (m.defuser && m.defuser.planted && !m.defuser.disabled) { left = 45 - m.defuser.t; sub = '解除装置'; }
      const att = m.kind === 'bomb' ? (p.team === m.att ? '攻撃（SWAT）' : '防衛（立てこもり犯）') : '';
      return { key: m.wins.join() + Math.floor(left) + m.phase + sub, html: `<div class="sc"><b class="t0">${m.wins[p.team]}</b><span>${fmtT(Math.max(0, left))}<small>ラウンド${m.round}${sub ? '・' + sub : ''}${att ? '・' + att : ''}</small></span><b class="t1">${m.wins[1 - p.team]}</b></div>` };
    }
    if (m.kind !== 'pve') return { key: 'train', html: '<div class="ob"><b>訓練</b></div>' };
    const sus = m.sus.map(id => S.byId[id]).filter(Boolean), civ = m.civ.concat(m.hostages).map(id => S.byId[id]).filter(Boolean);
    const sDone = sus.filter(a => !a.alive || a.cuffed).length, cDone = civ.filter(a => !a.alive || a.cuffed).length;
    const lines = [`容疑者 ${sDone}/${sus.length}`, `市民 ${cDone}/${civ.length}`];
    if (m.bombs.length) lines.push(`爆弾 ${m.bombs.filter(b => b.done).length}/${m.bombs.length}・残り ${fmtT(m.bombT)}`);
    if (m.softDone) lines.push('主目的 達成');
    return { key: lines.join('|') + (m.bombs.length ? Math.floor(m.bombT) : ''), html: `<div class="ob"><b>${MISSIONS[m.mission].name}</b><span>${lines.join('　')}</span></div>` };
  }
  result() {
    const S = this.S, m = S.m, p = this.p;
    if (S.war) {
      const rows = S.actors.map(a => ({ name: a.name, team: a.team, k: a.stats.k, d: a.stats.d, a: a.stats.a, me: a === p, bot: a.pid == null, pid: a.pid }));
      rows.sort((x, y) => y.k * 2 + y.a - (x.k * 2 + x.a));
      return { pvp: true, war: true, mode: 'war', wmode: m.mode, why: m.why, win: m.winner, myTeam: p.team, score: (m.mode === 'conquest' ? m.tickets : m.score).map(t => Math.ceil(t)), rows, map: S.map, size: m.size, per: m.per, time: (S.t - (m.startT || 0)) * S.dt };
    }
    if (S.pvp) {
      const rows = S.actors.filter(a => !a.isDrone).map(a => ({ name: a.name, team: a.team, k: a.stats.k, d: a.stats.d, a: a.stats.a, me: a === p, bot: a.pid == null, pid: a.pid }));
      rows.sort((x, y) => y.k * 2 + y.a - (x.k * 2 + x.a));
      return { pvp: true, mode: m.kind, win: m.winner, myTeam: p.team, score: m.kind === 'tdm' ? m.score : m.wins, rows, map: S.map, time: (S.t - (m.startT || 0)) * S.dt };
    }
    const sc = m.score || {};
    return { pvp: false, mission: m.mission, res: m.result, why: m.why, score: sc, map: S.map, diff: m.diff, me: { k: p.stats.k, sh: p.stats.sh, hi: p.stats.hi, arrest: p.stats.arrest, rescue: p.stats.rescue } };
  }
  // 撤収（本部に戻る）
  abort() { step(this.G, { [this.p.id]: { act: [{ a: 'abortMission' }] } }); const m = this.S.m; if (m && m.kind === 'pve' && m.phase === 'play') { import_end(this.S); } }
}
import { endMission } from '../engine/modes/pve.js';
import { attackZones, OUT_GRACE, mapCams, CAM_YAW, CAM_PITCH } from '../engine/modes/pvp.js';
import { netMixin } from './netgame.js';
netMixin(Match);
function import_end(S) { endMission(S, S.m.softDone ? 'done' : 'abort', 'player', []); }

function bodyH(a) { return a.st < 1 ? 1.8 - 0.6 * a.st : 1.2 - 0.7 * (a.st - 1); }
function fmtT(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function nm(a) { return a ? (a.pid != null ? a.name : a.kind === 'sus' ? '容疑者' : a.kind === 'civ' ? '市民' : a.name) : '?'; }
function feedKill(k, v, e, p) {
  const kn = k ? nm(k) : '?', vn = nm(v);
  if (!k && e.kind === 'redeploy') return `<b class="${v.team === p.team ? 'ally' : 'enemy'}">${vn}</b> <i>再出撃</i>`;
  const wpn = e.kind === 'oob' ? '範囲の外' : e.kind === 'melee' ? '近接' : e.kind === 'fall' ? '落下' : e.kind === 'blast' ? (k && k.inv && k.inv.long === 'rpg' && k.ws && k.ws.slot === 3 ? 'RPG-7' : '爆発') : k && curWeapon(k) ? WEAPONS[curWeapon(k).id].name : e.kind === 'bleed' ? '出血' : '';
  return `<b class="${k && k.team === p.team ? 'ally' : 'enemy'}">${kn}</b> <i>${wpn}${e.hs ? '・頭' : ''}</i> <b class="${v.team === p.team ? 'ally' : 'enemy'}">${vn}</b>`;
}
function ctxName(c, S) { return c.k === 'bar' ? (c.ops && c.ops[0] && c.ops[0].op === 'bar' ? '窓' : 'バリケード') : c.k === 'door' ? (S.doors[c.id] && S.doors[c.id].bar > 0 ? 'バリケード' : '扉') : c.k === 'person' ? (S.byId[c.id] ? (S.byId[c.id].kind === 'sus' ? '容疑者' : S.byId[c.id].kind === 'civ' ? '市民' : '隊員') : '人') : c.k === 'item' ? '物' : c.k === 'bomb' ? '爆弾' : c.k === 'site' ? '爆弾の場所' : c.k === 'wall' ? '壁' : ''; }
export function cmdName(c, stage) {
  return ({ move: '移動', hold: '待機', cover: '援護', fallin: '集合', stack: 'スタック', breach: stage === 'clear' ? '確保' : stage === 'enter' ? '突入中' : stage === 'nade' ? '投げ物' : stage === 'open' ? '開ける' : '突入', mirror: 'ミラー', wedge: 'ウェッジ', unwedge: 'ウェッジを外す', disarm: '罠の解除', pick: 'ピッキング', restrain: '拘束', deploy: '投入', search: '捜索して確保' })[c] || c;
}
function whyName(w) { return ({ elim: '全滅', time: '時間切れ', defuse: '解除装置が作動', disable: '解除装置を外した' })[w] || ''; }
const ROUND_NAME = { flash: '閃光弾', stinger: 'スティンガー弾', cs: 'CSガス弾' };
function mirrorHTML(e, S) {
  if (!e.seen.length && !e.trap) return '<b>ミラー</b>扉の向こうに人は見えない' + (e.locked ? '・鍵がかかっている' : '');
  const k = (s) => s.kind === 'sus' ? (s.armed ? '武装した容疑者' : '容疑者') : s.kind === 'civ' ? '市民' : '隊員';
  return '<b>ミラー</b>' + e.seen.map(s => `${k(s)}（${s.dist}m）`).join('・') + (e.trap ? '<br><span class="bad">扉に罠！</span>' : '') + (e.locked ? '<br>鍵がかかっている' : '');
}
function impSound(m) { return m === M.METAL || m === M.METALFURN || m === M.CAR || m === M.DOORMETAL ? 'impMetal' : m === M.WOOD || m === M.DOORWOOD || m === M.FURN ? 'impWood' : m === M.GLASS ? 'impGlass' : 'impHard'; }
