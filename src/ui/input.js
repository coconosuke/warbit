// 入力: タッチ（スティック・視点・ボタン、2本指以上の同時操作）、長押し、円形メニュー、ジャイロ、キーボードとマウス
// タップは pointerup で判定し、続く click は捨てる（iPhoneは2本目の指に click が来ない）
import { sprintZone } from './stick.js';
import { LookResampler } from './lookres.js';
let lastTapUp = 0;
export const tapHooks = [];
export const tapGuard = { drag: false };
function runHooks() { for (const f of tapHooks) { try { f(); } catch (e) { /* なし */ } } }
document.addEventListener('click', (e) => { if (e.isTrusted && performance.now() - lastTapUp < 600) { e.stopPropagation(); e.preventDefault(); } }, true);

export function onTap(el, fn, opt = {}) {
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; if (opt.press) opt.press(e); });
  el.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > (opt.slop ?? 18) || tapGuard.drag) return;
    lastTapUp = performance.now();
    e.preventDefault();
    runHooks();
    fn(e);
  });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runHooks(); fn(e); } });
}
export function onRepeat(el, fn) {
  let timer = null, n = 0;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); n = 0; const tick = () => { fn(n++); timer = setTimeout(tick, n < 2 ? 380 : 90); }; stop(); tick(); });
  el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('pointerleave', stop);
}

const DRAG_MENU = new Set(['nade', 'gad', 'gear']); // ずらすと選ぶ円が出るボタン
// 下投げにする、射撃の指をずらす距離（画面の基準 844×390 の点。射撃のボタンの半径 43 の少し外）
const UNDER_D = 52;
const LONG = 360; // 長押し（ms）。11-20: 420 → 360（伏せ・投げ物を選ぶ・弾倉をまとめる の長押しが遅く感じる）
// ダッシュの固定を続けるボタン（11-12）: 撃つ・構える・リーン・リロードの間は走らず、終わるとまた走る（押したままのダッシュと同じ）。
// 持ち替え・乗り越えも走ったまま。ほかのボタン（調べる・命令・装備・しゃがむなど）は、今までどおり固定をやめる
const KEEP_LOCK = new Set(['map', 'pause', 'fire', 'fireL', 'ads', 'leanL', 'leanR', 'reload', 'fmode', 'zoom', 'light', 'nvg', 'team', 'board', 'wpn1', 'wpn2', 'vault']);
// 出来事の時刻（performance.now と同じ基準）。古いブラウザで 0 や Date 基準なら今の時刻
const evT = (e) => { const t = e && e.timeStamp; const n = performance.now(); return t > 0 && t <= n + 50 && t > n - 60000 ? t : n; };

export class Input {
  constructor(stage, area, audio) {
    this.stage = stage; this.area = area; this.audio = audio;
    this.enabled = false;
    this.S = {}; // 設定
    this.mx = 0; this.mz = 0; this.lookDX = 0; this.lookDY = 0; this.lk = new LookResampler();
    this.ptr = new Map(); // pointerId → {kind: 'stick'|'look'|'btn', btn, x, y, t0, moved, long}
    this.stick = null;
    this.hold = new Set(); // 押している最中のボタン
    this.edges = []; // このこまの出来事: {b, k: 'tap'|'long'|'down'|'up', t}
    this.keys = new Set();
    this.mouseBtn = { l: false, r: false };
    this.touchUsed = false;
    // ダッシュを入れた回数（押し直した・スティックを押し込み直した。このこまの分）。リロードの最中ならやめる（game.js が動作 'sprint' を送る）
    this.sprintArm = false; this.sprintLock = false; this.sprPress = 0;
    this.toggles = { ads: false, leanL: false, leanR: false, crouch: false, prone: false, low: false };
    this.gyro = { on: false, ok: false, x: 0, y: 0, last: 0 };
    this.onStick = null; this.onRadial = null; this.onBtn = null; this.onDragMenu = null; this.onUnderRing = null;
    this.radial = null; // 開いている円形メニュー {btn, x, y, items, sel, pid}
    // タッチの記録（fps の表示）: cancel 指の取り消し・tcancel タッチの取り消し・lost つかみが外れた・stale 離したのが届かず捨てた
    this.diag = { cancel: 0, tcancel: 0, lost: 0, stale: 0 };
    this.getStickHome = null;
    this._bind();
  }
  setSettings(s) { this.S = s; this._gyroSetup(); }
  reset() {
    this.mx = this.mz = this.lookDX = this.lookDY = 0; this.lk = new LookResampler();
    this.ptr.clear(); this.stick = null; this.hold.clear(); this.edges.length = 0; this.keys.clear();
    this.sprintArm = false; this.sprintLock = false; this.sprPress = 0;
    this.mouseBtn = { l: false, r: false };
    this.radial = null; if (this.onRadial) this.onRadial(null);
    if (this.onStick) this.onStick(null);
    this.underArm = false; if (this.onUnderRing) this.onUnderRing(null);
    for (const el of this.area.querySelectorAll('.down')) el.classList.remove('down');
  }
  // 投げ物を持っている時の射撃の指（11-26 22:21 の指示）: 押して離すと上投げ、押したまま一定の距離（UNDER_D）より外へずらして離すと下投げ。
  //  投げ物を持っている間は、射撃の指をずらしても見回さない（ずらすのは下投げの選び）。game.js が nadeHeld を毎こま入れる
  //  境目の輪は、押した所ではなく射撃ボタンのまん中が起点（11-26 22:50）。半径はボタンより一回り大きく
  _underOf(p, sx, sy) { return Math.hypot(sx - (p.ux ?? p.x0), sy - (p.uy ?? p.y0)) > (p.ur || UNDER_D); }
  _underOrigin(p, el) {
    try {
      const r = el.getBoundingClientRect(), [cx, cy] = this.stage.toStage(r.left + r.width / 2, r.top + r.height / 2), [ex] = this.stage.toStage(r.right, r.top + r.height / 2);
      p.ux = cx; p.uy = cy; p.ur = Math.max(UNDER_D, Math.abs(ex - cx) + 24);
    } catch (e) { p.ux = p.x0; p.uy = p.y0; p.ur = UNDER_D; }
  }
  _btnOf(e) { let t = e.target; while (t && t !== this.area) { if (t.dataset && t.dataset.btn && !t.classList.contains('hidden')) return t; t = t.parentNode; } return null; }
  _bind() {
    const a = this.area;
    const unlock = () => this.audio && this.audio.unlock();
    a.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') this.touchUsed = true;
      const [sx, sy] = this.stage.toStage(e.clientX, e.clientY);
      try { a.setPointerCapture(e.pointerId); } catch (er) { /* なし */ }
      e.preventDefault();
      // 円形メニューが開いていて、タップで選ぶ方式
      if (this.radial && this.radial.tapMode) { this.ptr.set(e.pointerId, { kind: 'radialTap', x: sx, y: sy, pt: e.pointerType }); this._radialMove(sx, sy); return; }
      const el = this._btnOf(e);
      if (el) {
        const b = el.dataset.btn;
        // 時刻は出来事の起きた時（重いこまで処理が遅れても、短く押したのを長押しにしない）
        const p = { kind: 'btn', btn: b, el, x: sx, y: sy, x0: sx, y0: sy, t0: evT(e), tp: performance.now(), moved: 0, long: false, pt: e.pointerType, nade: (b === 'fire' || b === 'fireL') && !!this.nadeHeld };
        // 投げ物を持って射撃を押した: 下投げになる境目の輪を出す（11-26 22:29。起点は射撃ボタンのまん中）
        if (p.nade) { this._underOrigin(p, el); if (this.onUnderRing) this.onUnderRing({ x: p.ux, y: p.uy, r: p.ur, arm: this._underOf(p, sx, sy) }); }
        this.ptr.set(e.pointerId, p);
        if (this.sprintLock && !KEEP_LOCK.has(b)) { this.sprintLock = false; this.sprintArm = false; if (this.onStick) this.onStick(null); }
        this.hold.add(b); el.classList.add('down');
        if (b === 'sprint') this.sprPress++;
        this.edges.push({ b, k: 'down', sub: el.dataset.sub || null });
        if (this.onBtn) this.onBtn(b, 'down', p);
        return;
      }
      if (e.pointerType === 'mouse' && !this.touchUsed) {
        if (!document.pointerLockElement && a.requestPointerLock) { try { const r = a.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (er) { /* なし */ } }
        return;
      }
      const home = this.getStickHome ? this.getStickHome() : null;
      const fixed = this.S.stickMode === 'fixed' && home;
      // 11-20: 前のスティックの指の「離した」が届かず残っていた（ほかに触れている指がない）: その古いスティックを捨てる
      //  （残っていると、スティックの所に触れても見回しになり、離すまでスティックが効かなかった）
      if (this.stick && e.pointerType === 'touch' && this._touchN === 0 && this.stick.id !== e.pointerId) this._dropStale('stick');
      const leftZone = this.S.handed === 'left' ? sx > this.stage.w * 0.55 : sx < this.stage.w * 0.45;
      const onStick = fixed ? Math.hypot(sx - home.x, sy - home.y) < 95 * (home.s || 1) : leftZone;
      if (onStick && !this.stick) {
        // 触れたら固定をやめる。もう一度ダッシュの所まで押し込むと「入れ直し」（リロードをやめて走る）
        this.sprintLock = false; this.sprintArm = false;
        this.stick = { id: e.pointerId, ox: fixed ? home.x : sx, oy: fixed ? home.y : sy, x: sx, y: sy, fixed: !!fixed };
        this.ptr.set(e.pointerId, { kind: 'stick', pt: e.pointerType });
        if (this.onStick) this.onStick(this.stick, 0, 0);
        if (fixed) this._stickMove(sx, sy);
      } else {
        this.ptr.set(e.pointerId, { kind: 'look', x: sx, y: sy, pt: e.pointerType });
      }
    }, { passive: false });
    // 11-20: 動かす・離すは window で受ける（指が画面の部品の外へ出た・部品が作り直された・つかみ（capture）が外れた時も、
    //  指の番号で追い続ける。前は画面の area だけで受けていて、届かないとスティックが止まったり、離したのが届かず残ったりした）
    const onMove = (e) => {
      if (!this.enabled) return;
      const p = this.ptr.get(e.pointerId);
      if (!p) return;
      const [sx, sy] = this.stage.toStage(e.clientX, e.clientY);
      if (p.kind === 'stick') this._stickMove(sx, sy);
      else if (p.kind === 'look') { this._lookAdd(e, p, sx, sy); }
      else if (p.kind === 'radialTap') this._radialMove(sx, sy);
      else if (p.kind === 'btn') {
        p.moved = Math.max(p.moved, Math.hypot(sx - p.x0, sy - p.y0));
        // 投げ物・道具のボタン: 指をずらした時点で選ぶ円を出す（長押しを待たない。11-20 の要望）。円はその場ですぐ開き、続く動きで選ぶ
        if (!this.radial && !p.dragged && p.moved > 16 && this.onDragMenu && DRAG_MENU.has(p.btn)) { p.dragged = true; this.onDragMenu(p.btn, e.pointerId, p.x0, p.y0); }
        if (this.radial && this.radial.pid === e.pointerId) { this._radialMove(sx, sy); }
        else if (p.btn === 'fire' || p.btn === 'fireL') {
          if (p.nade) { p.x = sx; p.y = sy; const u = this._underOf(p, sx, sy); if (u !== !!this.underArm) { this.underArm = u; if (this.onUnderArm) this.onUnderArm(u); if (this.onUnderRing) this.onUnderRing({ x: p.ux, y: p.uy, r: p.ur, arm: u }); } return; }
          if (this.S.fireLook !== false) { this._lookAdd(e, p, sx, sy); return; }
        }
        p.x = sx; p.y = sy;
      }
    };
    window.addEventListener('pointermove', onMove, { passive: false, capture: true });
    // つかみが外れた: スティック・見回しの指はつかみ直す（外れたままだと、area の外の部品へ出来事が行く）
    a.addEventListener('lostpointercapture', (e) => { const p = this.ptr.get(e.pointerId); if (p && (p.kind === 'stick' || p.kind === 'look')) { this.diag.lost++; try { a.setPointerCapture(e.pointerId); } catch (er) { /* 離した後 */ } } });
    const up = (e, cancel) => {
      unlock();
      if (!this.enabled) return;
      const p = this.ptr.get(e.pointerId);
      this.ptr.delete(e.pointerId);
      if (!p) return;
      if (p.kind === 'stick') {
        // ダッシュの所で離した: 「ダッシュの固定」がオンなら走り続ける（PUBGM・CODM のように。スティックか、撃つ・構える・リーン・リロード以外のボタンに触れるとやめる）
        const lock = !cancel && this.sprintArm && this.S.stickLock === true;
        this.stick = null; this.mx = 0; this.mz = 0; this.sprintArm = lock; this.sprintLock = lock;
        if (this.onStick) this.onStick(null, 0, 0, lock, lock); return;
      }
      if (p.kind === 'radialTap') { if (!cancel) this._radialPick(true); return; }
      if (p.kind !== 'btn') return;
      this.hold.delete(p.btn); p.el.classList.remove('down');
      // 下投げ: 投げ物を持って押した射撃の指を、一定の距離より外へずらして離した（取り消しは除く）
      if ((p.btn === 'fire' || p.btn === 'fireL') && p.nade) {
        if (!cancel) { const [ux, uy] = this.stage.toStage(e.clientX, e.clientY); if (this._underOf(p, ux, uy)) this._underRel = true; }
        if (this.underArm) { this.underArm = false; if (this.onUnderArm) this.onUnderArm(false); }
        if (this.onUnderRing) this.onUnderRing(null);
      }
      lastTapUp = performance.now();
      if (this.radial && this.radial.pid === e.pointerId) {
        // 円形メニュー: 離した所を選ぶ。真ん中で離したら何も選ばずに閉じる（11-26 22:23: 前は真ん中で離すとタップで選ぶ方式に切り替わり、
        //  長押しで開いたメニューが離しても出たままになっていた）
        if (cancel) { this.closeRadial(); return; }
        this._radialPick(false);
        return;
      }
      const dur = evT(e) - p.t0;
      // 押している間に長押しを判定できなかった（こまが遅れ続けた）けれど長く押していた: 離した時に長押しとして扱う
      if (!cancel && !p.long && dur >= LONG && p.moved <= 36) { p.long = true; this.edges.push({ b: p.btn, k: 'long', pid: e.pointerId, x: p.x0, y: p.y0, sub: p.el.dataset.sub || null }); }
      const k = cancel ? 'cancel' : p.long ? 'longup' : (dur < LONG && p.moved < 36 ? 'tap' : 'up');
      this.edges.push({ b: p.btn, k, sub: p.el.dataset.sub || null, dur });
      if (this.onBtn) this.onBtn(p.btn, k, p);
    };
    window.addEventListener('pointerup', (e) => up(e, false), { capture: true });
    // 取り消し（端末やアプリが指を横取りした）の回数: 画面の右上の fps の表示に出す（タッチが切れる原因を探す）
    window.addEventListener('pointercancel', (e) => { if (this.enabled && this.ptr.has(e.pointerId)) this.diag.cancel++; up(e, true); }, { capture: true });
    // 11-20: iOS（Claude アプリの中の画面・Safari）: 遊んでいる間の指は、ページの側で使うと伝える（親の画面のスクロール・
    //  アプリのスワイプ・ブラウザの戻る操作・長押しの拡大鏡に指を取られて、見回しやスティックが途中で切れないように）。
    //  ボタンは pointer の出来事で受けるので、touchstart を止めても効く。出撃の画面・成績表・文字の欄は除く（スクロール・入力）
    const own = (e) => this.enabled && e.cancelable && !(e.target && e.target.closest && e.target.closest('.hud-deploy, .hud-board, input, textarea, select'));
    a.addEventListener('touchstart', (e) => { if (own(e)) e.preventDefault(); }, { passive: false });
    a.addEventListener('touchmove', (e) => { if (own(e)) e.preventDefault(); }, { passive: false });
    // 触れている指の数（タッチの出来事から）。指が全部離れたのに残っている指の記録は、少し待ってから捨てる
    //  （「離した」の出来事が届かなかった時の救い。スティックが残って効かなくなるのを防ぐ）
    this._touchN = 0;
    const tcount = (e) => { this._touchN = e.touches ? e.touches.length : 0; };
    window.addEventListener('touchstart', (e) => { tcount(e); this._touchT = performance.now(); }, { passive: true, capture: true });
    window.addEventListener('touchmove', tcount, { passive: true, capture: true });
    const tend = (e) => {
      tcount(e);
      if (this._touchN !== 0) return;
      const t0 = performance.now();
      setTimeout(() => { if (this._touchN === 0 && (this._touchT || 0) < t0) this._dropStale(); }, 120);
    };
    window.addEventListener('touchend', (e) => { unlock(); tend(e); }, { passive: true, capture: true });
    window.addEventListener('touchcancel', (e) => { if (this.enabled) this.diag.tcancel++; tend(e); }, { passive: true, capture: true });
    window.addEventListener('click', () => unlock(), true);
    // キーボード（パソコン）
    window.addEventListener('keydown', (e) => {
      unlock();
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.code;
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'ShiftLeft') this.sprPress++;
      const map = { KeyR: 'reload', KeyC: 'crouch', KeyZ: 'prone', KeyQ: 'leanL', KeyE: 'leanR', KeyF: 'shout', KeyV: 'use', KeyG: 'gear', KeyX: 'fmode', KeyB: 'zoom', KeyT: 'light', KeyN: 'nvg', KeyM: 'map', Escape: 'pause', KeyP: 'pause', Space: 'vault', Digit1: 'wpn1', Digit2: 'wpn2', Digit3: 'heal', Digit4: 'gad', Digit5: 'gad', KeyH: 'cmd', Tab: 'team', KeyK: 'drone', KeyY: 'melee' };
      const b = map[k];
      if (b) { e.preventDefault(); this.edges.push({ b, k: 'down', key: true }); this._keyT = this._keyT || {}; this._keyT[k] = performance.now(); }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.code;
      this.keys.delete(k);
      if (!this.enabled) return;
      const map = { KeyR: 'reload', KeyC: 'crouch', KeyZ: 'prone', KeyQ: 'leanL', KeyE: 'leanR', KeyF: 'shout', KeyV: 'use', KeyG: 'gear', KeyX: 'fmode', KeyB: 'zoom', KeyT: 'light', KeyN: 'nvg', KeyM: 'map', Escape: 'pause', KeyP: 'pause', Space: 'vault', Digit1: 'wpn1', Digit2: 'wpn2', Digit3: 'heal', Digit4: 'gad', Digit5: 'gad', KeyH: 'cmd', Tab: 'team', KeyK: 'drone', KeyY: 'melee' };
      const b = map[k];
      if (b) { const dur = performance.now() - ((this._keyT && this._keyT[k]) || 0); this.edges.push({ b, k: dur > LONG ? 'longup' : 'tap', key: true, dur }); }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseBtn = { l: false, r: false }; });
    document.addEventListener('mousemove', (e) => { if (!this.enabled || document.pointerLockElement !== this.area) return; this.lookDX += e.movementX; this.lookDY += e.movementY; });
    a.addEventListener('mousedown', (e) => { if (!this.enabled || !document.pointerLockElement) return; if (e.button === 0) this.mouseBtn.l = true; if (e.button === 1) { e.preventDefault(); this.edges.push({ b: 'spot', k: 'down', mouse: true }); } if (e.button === 2) { this.mouseBtn.r = true; this.edges.push({ b: 'ads', k: 'down', mouse: true }); } });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseBtn.l = false; if (e.button === 2) { this.mouseBtn.r = false; if (this.enabled) this.edges.push({ b: 'ads', k: 'up', mouse: true }); } });
    a.addEventListener('contextmenu', (e) => e.preventDefault());
    a.addEventListener('wheel', (e) => { if (this.enabled && document.pointerLockElement) this.edges.push({ b: e.deltaY > 0 ? 'wpn2' : 'wpn1', k: 'tap', wheel: true }); }, { passive: true });
  }
  // 届かなかった「離した」の代わり: タッチの指の記録（kind を指定すればその種類だけ）を捨てる
  // 見回しの指の動きを足す（11-26）: 重いこまで間の動きがまとめて届いたときは、まとめられた一つ一つ（時刻つき）を足す
  //  （時刻で直線に求める lookres.js が、こまの間の指の動きを正しくたどれる。動いた合計は同じ）
  _lookAdd(e, p, sx, sy) {
    const cs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (cs && cs.length > 1) {
      for (const c of cs) { const [cx, cy] = this.stage.toStage(c.clientX, c.clientY); this.lk.add(cx - p.x, cy - p.y, evT(c)); p.x = cx; p.y = cy; }
      if (p.x !== sx || p.y !== sy) { this.lk.add(sx - p.x, sy - p.y, evT(e)); p.x = sx; p.y = sy; }
      return;
    }
    this.lk.add(sx - p.x, sy - p.y, evT(e)); p.x = sx; p.y = sy;
  }
  _dropStale(kind) {
    for (const [pid, p] of this.ptr) {
      if (p.pt !== 'touch') continue;
      if (kind && p.kind !== kind) continue;
      this.ptr.delete(pid); this.diag.stale++;
      if (p.kind === 'btn') { this.hold.delete(p.btn); if (p.el) p.el.classList.remove('down'); this.edges.push({ b: p.btn, k: 'cancel', sub: p.el ? p.el.dataset.sub || null : null }); if (this.onBtn) this.onBtn(p.btn, 'cancel', p); }
      if (p.kind === 'radialTap' || (this.radial && this.radial.pid === pid)) this.closeRadial();
    }
    if (this.stick && (!kind || kind === 'stick') && !this.ptr.has(this.stick.id)) {
      this.stick = null; this.mx = 0; this.mz = 0;
      if (!this.sprintLock) this.sprintArm = false;
      if (this.onStick) this.onStick(null, 0, 0, this.sprintLock, this.sprintLock);
    }
  }
  _stickMove(sx, sy) {
    const st = this.stick;
    st.x = sx; st.y = sy;
    const home = this.getStickHome ? this.getStickHome() : null;
    const R = 58 * ((home && home.s) || 1), spr = (home && home.spr) || 1.25;
    let dx = (sx - st.ox) / R, dy = (sy - st.oy) / R;
    const l = Math.hypot(dx, dy);
    // スティックを上へ押し込む（ダッシュの印より上）とダッシュ（CODM・PUBGM）。作戦・対戦とも。少し斜めでもよい（stick.js）
    const arm = this.S.stickSprint !== false && sprintZone(dx, dy, spr, this.sprintArm);
    if (arm && !this.sprintArm) this.sprPress++;
    this.sprintArm = arm;
    if (l > 1) { dx /= l; dy /= l; }
    // 可変のスティック: 大きく離れたら土台がついてくる（ダッシュの印より外で）
    const follow = Math.max(1.9, spr + 0.45);
    if (!st.fixed && l > follow) { st.ox = sx - dx * R * follow; st.oy = sy - dy * R * follow; }
    const dz = 0.1, ll = Math.min(1, l);
    const k = ll < dz ? 0 : (ll - dz) / (1 - dz) / (ll || 1);
    this.mx = dx * k; this.mz = -dy * k;
    if (this.onStick) this.onStick(st, dx, dy, this.sprintArm);
  }
  // ---- 円形メニュー
  openRadial(btn, items, pid, cx, cy) {
    // 11-26: 指がもう離れている（重いこまで、長押しの知らせを読む前に離した）なら開かない。
    //  前は離した指の番号で開いて、その指の「離した」が二度と来ないので開いたままになった
    if (pid != null && !this.ptr.has(pid)) return;
    // ox, oy: 選ぶ向きを測る起点。ボタンから開いたときはボタンのまん中（11-26 22:51: 下投げの輪と同じく、押した所ではなくボタンが起点）。
    //  円の絵もボタンのまん中に出す（hud.js）。dz: ここより外へずらすと選ぶ（ボタンの縁）
    let ox = cx, oy = cy, dz = 22, anchor = false;
    const pp = pid != null ? this.ptr.get(pid) : null;
    if (pp && pp.el) {
      try {
        const r = pp.el.getBoundingClientRect(), [bx, by] = this.stage.toStage(r.left + r.width / 2, r.top + r.height / 2), [ex] = this.stage.toStage(r.right, r.top + r.height / 2);
        ox = bx; oy = by; dz = Math.max(22, Math.abs(ex - bx)); anchor = true;
      } catch (e) { /* なし */ }
    }
    this.radial = { btn, items, pid, x: ox, y: oy, ox, oy, dz, anchor, sel: -1, tapMode: pid == null, t0: performance.now() };
    if (this.onRadial) this.onRadial(this.radial);
  }
  closeRadial() { this.radial = null; if (this.onRadial) this.onRadial(null); }
  _radialMove(sx, sy) {
    const r = this.radial; if (!r) return;
    // 11-26 22:28 / 22:51: ボタンのまん中から測り、ボタンの縁（dz）より外へずらすだけで、その向きの物を選ぶ
    //  （前は円の絵の中心から 34 点×大きさで、画面の端で円がずれると名前の所までずらさないと選べなかった）。タップで選ぶ方式は今までどおり円の中心から
    const fx = r.tapMode ? r.x : r.ox ?? r.x, fy = r.tapMode ? r.y : r.oy ?? r.y;
    const dx = sx - fx, dy = sy - fy, d = Math.hypot(dx, dy);
    const n = r.items.length;
    if (d < (r.tapMode ? 34 * Math.max(0.8, r.scale || 1) : (r.dz || 22))) r.sel = -1;
    else { let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2; r.sel = Math.floor((a + Math.PI / n) / (Math.PI * 2 / n)) % n; if (!r.items[r.sel]) r.sel = -1; }
    if (this.onRadial) this.onRadial(r);
  }
  _radialPick(tap) {
    const r = this.radial; if (!r) return;
    const item = r.sel >= 0 ? r.items[r.sel] : null;
    this.closeRadial();
    if (item && !item.disabled) this.edges.push({ b: 'radial', k: 'pick', item, from: r.btn });
  }
  // ---- ジャイロ（iPhone は許可が要る: ボタンを押したときに呼ぶ）
  _gyroSetup() {
    const want = this.S.gyro && this.S.gyro !== 'off';
    if (want && !this._gyroBound) {
      this._gyroBound = true;
      window.addEventListener('devicemotion', (e) => {
        const r = e.rotationRate; if (!r) return;
        this.gyro.ok = true;
        const now = performance.now(), dt = this.gyro.last ? Math.min(0.05, (now - this.gyro.last) / 1000) : 0;
        this.gyro.last = now;
        // 横向き: 端末の向きで軸を入れ替える
        const o = typeof window.orientation === 'number' ? window.orientation : (screen.orientation && screen.orientation.angle) || 0;
        let yawRate, pitchRate;
        if (o === 90) { yawRate = r.alpha ?? 0; pitchRate = -(r.beta ?? 0); } // 実際の向きは端末で違うので、設定で反転できる
        else if (o === -90 || o === 270) { yawRate = r.alpha ?? 0; pitchRate = r.beta ?? 0; }
        else { yawRate = r.beta ?? 0; pitchRate = r.alpha ?? 0; }
        // 11-20: タッチと同じく時刻で直線に求めて取り出す（届く間隔とこまの間隔のずれで、かくつかない）
        (this.gk || (this.gk = new LookResampler())).add(yawRate * dt, pitchRate * dt, evT(e));
      });
    }
  }
  async requestGyro() {
    try { if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) { const r = await DeviceMotionEvent.requestPermission(); return r === 'granted'; } } catch (e) { return false; }
    return true;
  }
  // 1こま分を取り出す
  take() {
    // 開いたままの円形メニューを閉じる（11-26）: 開いた指がもういない（取り消し・捨てた）か、
    //  タップで選ぶ方式のまま 4 秒触らない
    const r = this.radial;
    if (r && ((r.pid != null && !this.ptr.has(r.pid)) || (r.pid == null && performance.now() - (r.t0 || 0) > 4000 && ![...this.ptr.values()].some(q => q.kind === 'radialTap')))) this.closeRadial();
    let mx = this.mx, mz = this.mz;
    if (this.sprintLock) { mx = 0; mz = 1; }
    const K = this.keys;
    if (K.size) {
      const kx = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
      const kz = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
      if (kx || kz) { mx = kx; mz = kz; const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
    }
    // タッチの見回しは時刻で直線に求めて取り出す（lookres.js）。マウスはそのまま
    const [tlx, tly] = this.lk.take(performance.now());
    const [tgx, tgy] = this.gk ? this.gk.take(performance.now()) : [0, 0];
    const out = {
      mx, mz, lookDX: this.lookDX + tlx, lookDY: this.lookDY + tly, gyroX: this.gyro.x + tgx, gyroY: this.gyro.y + tgy,
      fire: this.hold.has('fire') || this.hold.has('fireL') || this.mouseBtn.l,
      // 下投げ（11-26）: 射撃の指を一定の距離より外へずらして離した・右ボタンを押したまま左を離した
      under: this._underRel || (this.mouseBtn.r && !this.mouseBtn.l),
      sprint: this.sprintArm || this.sprintLock || K.has('ShiftLeft') || this.hold.has('sprint'), sprPress: this.sprPress,
      hold: this.hold, edges: this.edges.slice(),
      mouse: !!document.pointerLockElement, touch: this.touchUsed,
    };
    this.lookDX = 0; this.lookDY = 0; this.gyro.x = 0; this.gyro.y = 0;
    this.edges.length = 0; this.sprPress = 0; this._underRel = false;
    // 長押しの判定（押している最中）。こまが大きく遅れたとき（0.25秒より長い）は次のこまで判定する
    // （遅れている間に指を離した出来事が待っているかもしれない。離していれば短押し）
    const now = performance.now();
    // 1こまだけ待つ（遅いこまが続くときは次のこまで判定する）
    // こまが遅れた（150ms 以上あいた）ときは長押しを決めない: たまっていた「離した」がまだ届いていないかもしれない。
    // 長く押していたなら、離したときに長押しとして扱う（短く押したのが遅いこまのせいで長押しにならないように）
    // ただし、ずっと遅い端末（いつも150ms以上あく）では、いつもの間隔の2.2倍を超えたときだけ「遅れ」とみなす（でないと長押しが離すまで決まらない）
    const gap = this._lastTake != null ? now - this._lastTake : 0;
    const avg = this._avgGap ?? gap;
    // こまの間があまりに長い（長押しの時間の 8 割以上）ときも遅れとみなす: 離したのがまだ届いていないだけかもしれないので、
    //  長押しは離した時（出来事の時刻で測る）に決める（11-19: 遅い端末で、短く押したのが伏せになっていた）
    const hitch = this._lastTake != null && gap > 150 && (gap > 2.2 * avg || gap >= LONG * 0.8);
    this._avgGap = gap > 2000 ? avg : avg * 0.85 + gap * 0.15; // 一時停止などの長い空きは平均に入れない
    this._lastTake = now;
    for (const [pid, p] of this.ptr) {
      if (p.kind !== 'btn' || p.long || p.dragged || p.moved > 36 || hitch) continue;
      // 長押しは「押したのを受け取ってから」の時間で（受け取りが遅れたぶんで長押しにしない）
      if (now - (p.tp ?? p.t0) >= LONG) { p.long = true; out.edges.push({ b: p.btn, k: 'long', pid, x: p.x0, y: p.y0, sub: p.el.dataset.sub || null }); }
    }
    return out;
  }
}
