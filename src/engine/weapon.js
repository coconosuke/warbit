// 銃の動き: 撃つ・弾倉（1本ずつ残弾）・通常/速いリロード・1発ずつ込める・ポンプ・持ち替え・反動（BattleBit式）・散らばり
import { WEAPONS, AMMO, ATTACH, zoomsOf, zoomOf, swayOf, isSupp } from './data/weapons.js';
import { LONG, HAND_LONG, GEAR } from './data/equipment.js';
import { curWeapon, curW, magCap } from './actor.js';
import { spawnBullet, eyeOf } from './combat.js';
import { raycast } from './world.js';
import { hrand } from './rng.js';
export { hrand };

const DEG = Math.PI / 180;
const _amCache = new WeakMap();
export function attMods(wi) {
  if (!wi) return { rcv: 1, rch: 1, rcfirst: 1, ads: 0, adsK: 1, drawK: 1, noise: 1, vel: 1, flash: 1, zoom: 1, scope: false, hip: 1, reload: 1, move: 1, spread: 1, dmg: 1, acc: 1, ctrl: 1 };
  const key = wi.att.sight + wi.att.muzzle + wi.att.grip + wi.att.side + wi.att.mag + wi.att.stock;
  const c = _amCache.get(wi);
  if (c && c.key === key) return c.m;
  const m = { rcv: 1, rch: 1, rcfirst: 1, ads: 0, adsK: 1, drawK: 1, noise: 1, vel: 1, flash: 1, zoom: 1, scope: false, hip: 1, reload: 1, move: 1, spread: 1, dmg: 1, acc: 1, ctrl: 1 };
  const A = ATTACH, a = wi.att;
  for (const x of [A.sight[a.sight], A.muzzle[a.muzzle], A.grip[a.grip], A.side[a.side], A.mag[a.mag], A.stock[a.stock]]) {
    if (!x) continue;
    if (x.rcv) m.rcv *= x.rcv; if (x.rch) m.rch *= x.rch; if (x.rcfirst) m.rcfirst *= x.rcfirst;
    if (x.bipod) m.bipod = true;
    if (x.adsK) m.adsK *= x.adsK; if (x.drawK) m.drawK *= x.drawK;
    if (x.ads) m.ads += x.ads; if (x.noise) m.noise *= x.noise; if (x.vel) m.vel *= x.vel; if (x.flash != null) m.flash *= x.flash;
    if (x.zoom) m.zoom = Math.max(m.zoom, x.zoom); if (x.scope) m.scope = true;
    if (x.reload) m.reload *= x.reload; if (x.move) m.move *= x.move; if (x.spread) m.spread *= x.spread;
    if (x.dmg) m.dmg *= x.dmg; if (x.acc) m.acc *= x.acc; if (x.ctrl) m.ctrl *= x.ctrl;
    if (x.hip && !x.laser) m.hip *= x.hip; // レーザーの腰だめは点けている間だけ（spreadDeg）
  }
  if (isSupp(a.muzzle) && WEAPONS[wi.id].integral) m.noise = 0.25;
  m.laserHip = (A.side[a.side] && A.side[a.side].laser && A.side[a.side].hip) || 1;
  _amCache.set(wi, { key, m });
  return m;
}

// 今の散らばり（度）
export function spreadDeg(S, a, W, wi) {
  const sp = W.sp, am = attMods(wi);
  // 腰だめ: 銃床をたたむと良く、レーザーを点けているとさらに良い（構えるほど効かない）
  const hipK = am.hip * (wi && wi.lightOn && wi.att.laser ? am.laserHip : 1);
  let s = sp.hip * hipK + (sp.ads - sp.hip * hipK) * a.ads;
  s += sp.move * Math.min(1.5, a.spd / 2.4) * (1 - 0.6 * a.ads);
  s += a.ws.bloom;
  if (a.st > 1.5) s *= 0.6; else if (a.st > 0.5) s *= 0.8;
  if (a.inj.arm) s *= 1.4;
  if (a.flash > 0.2 || (a.gas > 0 && a.armor.head !== 'gasmask')) s *= 1.6;
  if (a.supp > 0) s *= 1 + 0.4 * a.supp;
  if ((!a.ground && (a.airT || 0) > 0.12) || a.vault) s += 4;
  // 銃口の Accuracy（BattleBit の Barrels）
  s *= am.acc;
  return s;
}

// 二脚が立つか（伏せ: 銃の前 0.8m の地面が体の高さから ±0.3m。立ち・しゃがみ: 止まっていて、銃の 0.6m 先の真下 0.3m 以内に物の面があり、銃の先が壁に入っていない）
// バイポッド（BattleBit Wiki の Bipod）: 立てた時の反動（推測）・立てていない時の反動・初弾の跳ね・反動の戻り・上下に向けられる角度（rad。推測）
export const BIPOD = { recoil: 0.6, offRecoil: 1.4, offFirst: 1.6, offCtrl: 0.6, pitch: 0.44 };
export const DROPSHOT = { recoil: 1.8 };
const _bh = [];
const minT = (h) => { let t = 1e9; for (const q of h) if (q.t0 < t) t = q.t0; return t; };
function bipodUp(S, w, a) {
  // 上や下へ向けすぎると立たない（本家も「上下に向けすぎるとバイポッドの効き目が消える」）
  if (a.sprint || a.vault || a.air || a.down || (a.spd || 0) > 0.35 || Math.abs(a.lean || 0) > 0.3 || Math.abs(a.pitch || 0) > BIPOD.pitch) return false;
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  if (a.st > 1.5) {
    const y0 = a.y + 0.45, t = minT(raycast(w, a.x + fx * 0.8, y0, a.z + fz * 0.8, 0, -1, 0, 0.8, S.doors, { out: _bh }));
    return t < 0.8 && Math.abs(y0 - t - a.y) < 0.3;
  }
  const e = eyeOf(S, a), gy = e[1] - 0.12;
  if (minT(raycast(w, e[0], gy, e[2], fx, 0, fz, 0.75, S.doors, { out: _bh })) < 0.35) return false;
  return minT(raycast(w, e[0] + fx * 0.6, gy + 0.02, e[2] + fz * 0.6, 0, -1, 0, 0.32, S.doors, { out: _bh })) < 0.32;
}
// 1ステップ。inp: { fire, ads, low } と act の配列（reload/switch/mode/light）
export function stepWeapon(S, w, a, inp, dt, ev) {
  const ws = a.ws;
  if (!a.alive || a.dead || a.cuffed || (a.down && !S.pvp)) { ws.trigWas = !!inp.fire; return; }
  if (ws.cd > 0) ws.cd -= dt;
  // 反動の戻り（撃ち続けている間は弱く）
  const W = curW(a), wi = curWeapon(a);
  const since = (S.t - ws.lastShot) * S.dt;
  // 指で下へ押さえた分（大規模戦の人の操作 inp.rc 度）は反動の分から引く（戻りで二重に下がらない。game.js _look）
  if (inp.rc > 0 && ws.rp > 0) ws.rp = Math.max(0, ws.rp - Math.min(inp.rc, 30));
  if (W) {
    // バイポッドを付けていて立っていない: 反動の戻り（コントロール）が 4 割弱い（BattleBit Wiki の Bipod）
    //  銃口・グリップの Control（BattleBit の Barrels・Grips）も掛ける
    const amc = wi ? attMods(wi) : null;
    const ctrl = W.rc.ctrl * (since > 0.12 ? 1 : 0.25) * (amc && !a.bip && amc.bipod ? BIPOD.offCtrl : 1) * (amc ? amc.ctrl : 1);
    const dec = ctrl * dt;
    if (ws.rp > 0) ws.rp = Math.max(0, ws.rp - dec); else ws.rp = Math.min(0, ws.rp + dec);
    ws.ry *= since > 0.12 ? Math.pow(0.02, dt) : Math.pow(0.6, dt);
    if (Math.abs(ws.ry) < 1e-3) ws.ry = 0;
    ws.bloom = Math.max(0, ws.bloom - dt * 3.0);
    if (since > 0.25) ws.shots = 0;
  }
  a.fireK = Math.max(0, a.fireK - dt * 9);
  a.throwT = Math.max(0, a.throwT - dt * 1.8);
  // ADS とローレディ（構えるのはダッシュより先: 構えたい間は走らない。move.js）
  const busy = ws.st === 'draw' || ws.st === 'holster' || a.sprint || a.vault || (a.act && a.act.noAds);
  a.adsOn = !!inp.ads && !busy && canAim(a);
  a.lowOn = !!inp.low && !a.adsOn;
  // 突撃は近い照準器（2 倍まで）で構えるのが 20% 速い（BattleBit の Wiki の Classes。research の 41）
  const adsT = (W ? (W.ads + attMods(wi).ads) * attMods(wi).adsK : 0.25) * (S.war && a.warCls === 'assault' && zoomOf(wi) <= 2 ? CLS.adsK : 1);
  a.ads = Math.max(0, Math.min(1, a.ads + (a.adsOn ? dt / adsT : -dt / (adsT * 0.8))));
  a.low = Math.max(0, Math.min(1, a.low + (a.lowOn ? dt * 5 : -dt * 6)));
  // 構えたときの照準の揺れ（度。弾も揺れた向きへ飛ぶ。11-12 22:05: どの銃も。実際に沿って、強さは程よく）
  //  ゆっくりした8の字のずれ ＋ 息（約4秒で上下）＋ 手の小さなふるえ。しゃがむと半分、伏せると4分の1、動くと大きい、
  //  腕のけがで大きい、リーンで少し大きい。走ったあとは息が上がって大きく速くなり（数秒で戻る。move.js a.fat）、
  //  止まって構えていると1.5秒で少し落ち着く。時間と体の状態だけで決まる（乱数なし）ので、オンラインのゲストの手元とホストでほぼ同じになる
  // 息止め（BattleBit の Shift。research/WARBIT.md の 16）: 構えている間、押している間だけ揺れがほとんど止まる（0.25秒で効く）。
  //  息は約5秒（走った直後は短い）。切れると2.5秒は息が上がって揺れが大きく、その間は止められない。離すと約4秒で戻る
  {
    if (ws.br == null) ws.br = 1;
    const want = !!inp.breath && a.ads > 0.6 && !a.sprint && !a.down;
    if (ws.gasp > 0) ws.gasp = Math.max(0, ws.gasp - dt);
    if (want && ws.br > 0 && !(ws.gasp > 0) && (ws.holding || ws.br > 0.2)) {
      if (!ws.holding) ev.push({ e: 'inhale', id: a.id });
      ws.holding = true;
      ws.hold = Math.min(1, (ws.hold || 0) + dt / 0.25);
      ws.br -= dt / 5 * (1 + 0.8 * (a.fat || 0));
      if (ws.br <= 0) { ws.br = 0; ws.gasp = 2.5; ws.holding = false; ev.push({ e: 'gasp', id: a.id }); }
    } else {
      if (ws.holding) ev.push({ e: 'exhale', id: a.id });
      ws.holding = false;
      ws.hold = Math.max(0, (ws.hold || 0) - dt / 0.2);
      if (!(ws.gasp > 0)) ws.br = Math.min(1, ws.br + dt / 4);
    }
  }
  // 二脚（11-27）: 伏せるか、止まって銃を物の上に載せると自動で立つ（4 ステップごとに確かめる）
  // 立てるのは構えている時だけ（本家: 伏せるか物に載せて、狙っている時に自動で立つ。切り替えのキーはない）
  if (W && wi && attMods(wi).bipod && a.ads > 0.3) { if (((S.t + a.id) & 3) === 0 || a.bip == null) a.bip = bipodUp(S, w, a); }
  else a.bip = false;
  if (W && a.ads > 0.01) {
    const still = (a.spd || 0) < 0.3 && a.ads > 0.95;
    ws.calm = still ? Math.min(1, (ws.calm || 0) + dt / 1.5) : Math.max(0, (ws.calm || 0) - dt * 4);
    const fat = a.fat || 0;
    const A = swayOf(W) * a.ads * a.ads * (a.st > 1.5 ? 0.25 : a.st > 0.5 ? 0.5 : 1) * (1 + Math.min(1.5, (a.spd || 0) / 2.4) * 1.5) * (a.inj && a.inj.arm ? 1.8 : 1)
      * (Math.abs(a.lean || 0) > 0.3 ? 1.15 : 1) * (1 + 0.4 * fat) * (1 - 0.3 * ws.calm)
      * (1 - 0.9 * (ws.hold || 0)) * (1 + 0.9 * Math.min(1, (ws.gasp || 0) / 2.5))
      // 高い倍率では揺れの角度を少し小さく（11-26 22:48: 8倍で揺れが細かい狙いを押し流していた。4倍 0.83・8倍 0.63・12倍 0.5）
      * (S.war ? 1 / (1 + 0.1 * Math.max(0, zoomOf(curWeapon(a)) - 2)) : 1);
    const t = S.t * S.dt + a.id * 7.3;
    // 息: ふだんは 1.55 rad/秒（約4秒）。走ったあとは大きく、速い息（2.7 rad/秒）が混ざる
    const br = 0.55 * (1 + 1.2 * fat) * Math.sin(t * 1.55) + 0.75 * fat * Math.sin(t * 2.7 + 0.5);
    // 二脚が立っている間は揺れない（BattleBit: 伏せて平らな所に置くと二脚が立ち、揺れがなくなる。research の 19）
    const Ab = a.bip ? 0 : A;
    ws.sx = Ab * (0.7 * (Math.sin(t * 0.83) * 0.65 + Math.sin(t * 1.91 + 1.3) * 0.35) + 0.15 * br + 0.05 * Math.sin(t * 10.3 + a.id));
    ws.sy = Ab * (0.5 * (Math.sin(t * 1.17 + 2.1) * 0.6 + Math.sin(t * 0.57 + 0.4) * 0.4) + br + 0.05 * Math.sin(t * 12.1 + 2 * a.id));
  } else { ws.sx = 0; ws.sy = 0; ws.calm = 0; }
  // 走るのをやめた: 銃を上げるまで撃てない（重い銃ほど長い 0.1〜0.25秒）。その間に引いた引き金は覚えておき、上がったら撃つ
  if (ws.sprWas && !a.sprint) ws.so = sprintOutT(W);
  ws.sprWas = !!a.sprint;
  if (ws.so > 0) ws.so = Math.max(0, ws.so - dt);
  // 状態の時間
  if (ws.t > 0) ws.t -= dt;
  if (ws.t <= 0) finishState(S, a, ev);
  // 操作
  for (const ac of (inp.act || [])) {
    if (ac.a === 'reload') startReload(S, a, !!ac.fast, ev);
    else if (ac.a === 'consol') startConsol(S, a, ev);
    else if (ac.a === 'switch') switchTo(S, a, ac.slot, ev);
    else if (ac.a === 'mode' && ws.slot === 3) m320Next(a, ev);
    // C4 を持っている: 構えのボタン（右クリック）で、貼った C4 をまとめて起爆（11-26。本家と同じ: 左で投げる・右で起爆。research の 58）
    else if (ac.a === 'c4det' && ws.slot === 2 && ws.gear && GEAR[ws.gear] && GEAR[ws.gear].kind === 'c4') {
      let n = 0;
      for (const q of S.nades || []) if (q.type === 'c4' && q.by === a.id) { q.t = q.fuse; n++; }
      ev.push({ e: 'c4', id: a.id, k: n ? 'det' : 'none', n });
    }
    // 双眼鏡の倍率（BattleBit の双眼鏡は 4〜8 倍を変えられる。research の 39）: 倍率のボタンで 4 → 6 → 8
    else if (ac.a === 'zoom' && ws.slot === 2 && ws.gear === 'binoc') { const Z = GEAR.binoc.zooms; ws.bz = ((ws.bz ?? GEAR.binoc.zi) + 1) % Z.length; ev.push({ e: 'zoom', id: a.id, z: Z[ws.bz], binoc: true }); }
    // 倍率を切り替えられる照準器: 倍率のボタン（'zoom'。11-19 14:03 から射撃モードと別。BattleBit も別のキー）。
    //  古い手元（'mode' に zoom: true）も受ける
    else if ((ac.a === 'zoom' || (ac.a === 'mode' && ac.zoom === true)) && W && wi && zoomsOf(wi.att)) { const zs = zoomsOf(wi.att); wi.zi = ((wi.zi || 0) + 1) % zs.length; ev.push({ e: 'zoom', id: a.id, z: zs[wi.zi], sight: wi.att.sight }); }
    else if (ac.a === 'mode' && W && wi && W.modes.length > 1 && ws.st === 'ready') { wi.mode = (wi.mode + 1) % W.modes.length; ev.push({ e: 'fmode', id: a.id, m: W.modes[wi.mode] }); }
    else if (ac.a === 'pickmag') pickMagNear(S, a, ev);
    else if (ac.a === 'light' && wi && (wi.att.light || wi.att.laser)) { wi.lightOn = !wi.lightOn; ev.push({ e: 'lightsw', id: a.id, on: wi.lightOn }); }
  }
  // a.light: ライトが点いている（レーザーだけなら false）。a.laser: レーザーが点いている
  if (wi) { a.light = !!(wi.lightOn && wi.att.light); a.laser = wi.lightOn && wi.att.laser ? wi.att.laser : null; } else { a.light = false; a.laser = null; }
  // 撃つ
  const trig = !!inp.fire;
  if (W && wi && (trig || ws.pend || ws.burstLeft > 0)) tryFire(S, w, a, W, wi, inp, ev);
  if (!trig) ws.burstN = 0;
  if (!(ws.so > 0)) ws.pend = false; // 銃が上がったときに撃てなかった（リロード中など）: 覚えていた引き金は捨てる
  ws.trigWas = trig;
}

// 構えられる物を持っている（銃・M320）
export function canAim(a) {
  const ws = a.ws;
  return !!ws && ws.slot >= 0 && (ws.slot < 2 || (ws.slot === 3 && (a.inv.long === 'm320' || a.inv.long === 'rpg')) || (ws.slot === 2 && ws.gear === 'binoc')) && !a.down && !a.peek;
}
// 走るのをやめてから撃てるまで（秒）。重い銃ほど長い（拳銃 0.1・小銃 0.15・狙撃銃 0.24）
export function sprintOutT(W) { return W ? Math.min(0.25, 0.08 + 0.025 * (W.kg || 3)) : 0.1; }

// リロードをやめる（ダッシュを入れ直したとき）。弾倉を替えるのは終わったときなので、替えていない。
// 1発ずつ込める銃は込めた分が残る。薬室が空で弾があれば、送り込んでから（ポンプ）
export function cancelReload(a, ev) {
  const ws = a.ws, W = curW(a), wi = curWeapon(a);
  if (!ws || (ws.st !== 'reload' && ws.st !== 'shell' && ws.st !== 'consol')) return false;
  if (ws.st === 'shell' && W && wi && W.chamber && !wi.ch && wi.mag > 0) { ws.st = 'pump'; ws.t = W.pump || 0.35; }
  else { ws.st = 'ready'; ws.t = 0; }
  ws.rk = null; ws.stopShell = false;
  if (ev) ev.push({ e: 'reloadx', id: a.id });
  return true;
}

// 突撃の速さ（BattleBit の Wiki の Classes: リロード 25%・近い照準器の ADS 20%・持ち替え 25% 速い。research の 41）
//  速さ 1.25 倍 → 時間 0.8 倍、1.2 倍 → 0.833 倍
export const CLS = { reloadK: 0.8, adsK: 1 / 1.2, swapK: 0.8 };
export const CLS_FAST = CLS.reloadK;
// 予備の弾が減らない: 対戦（作り直す前のモード）・射撃場。大規模戦のボットも 11-27 から減る（拳銃へ持ち替え・弾薬箱へ行く。war/ai.js）
function infAmmo(S, a) { return !!S.pvp && (!S.war || (S.m && S.m.mode === 'range')); }
function finishState(S, a, ev) {
  const ws = a.ws, wi = curWeapon(a), W = curW(a);
  const st = ws.st;
  if (st === 'draw') { ws.st = 'ready'; ws.t = 0; }
  else if (st === 'holster') { ws.slot = ws.next; ws.next = -1; ws.st = 'draw'; const W2 = curW(a); ws.t = (W2 ? W2.draw * attMods(curWeapon(a)).drawK : ws.slot === 3 ? (LONG[a.inv.long] && LONG[a.inv.long].draw) || 0.6 : 0.3) * (S.war && a.warCls === 'assault' ? CLS.swapK : 1); if (ev) ev.push({ e: 'draw', id: a.id, slot: ws.slot }); }
  else if (st === 'reload' && wi && W) {
    // 弾倉を替える
    if (ws.rk === 'rev') { const need = magCap(wi) - wi.mag; const take = Math.min(need, wi.res); wi.mag += take; wi.res -= take; }
    else if (ws.rk === 'break') { const need = magCap(wi) - wi.mag; const take = Math.min(need, wi.res); wi.mag += take; wi.res -= take; }
    else if (wi.mags) {
      // いちばん多い弾倉を入れる。通常は抜いた弾倉を残す、速いときは捨てる
      let bi = -1; for (let i = 0; i < wi.mags.length; i++) if (bi < 0 || wi.mags[i] > wi.mags[bi]) bi = i;
      if (bi >= 0) {
        const nm = wi.mags[bi]; wi.mags.splice(bi, 1);
        if (ws.rk === 'tac' && wi.mag > 0) wi.mags.push(wi.mag);
        // 速いリロード（大規模戦）: 抜いた弾倉は足もとに落ちる。弾が残っていれば、上を歩くと拾える（BattleBit。research §30）
        else if (ws.rk === 'fast' && S.war) dropMag(S, a, wi, wi.mag, ev);
        wi.mag = nm;
        if (!wi.ch && W.chamber) { if (wi.mag > 0) { wi.mag--; wi.ch = 1; } }
      }
    }
    // 対戦: 予備の弾倉は減らない（TDM で弾が尽きると死ぬしかなくなるため。作戦は RoN のとおり減る）
    // 大規模戦（11-19 23:27）: 人の弾は減る（BattleBit のとおり。抜いた弾倉は残り、まとめられる。補給は出撃し直すと満タン・弾薬箱）。
    //  射撃場は減らない。ボットも減る（11-27）
    if (infAmmo(S, a)) { if (wi.mags) wi.mags = new Array(Math.max(1, wi.spare0 || W.spare || 1)).fill(magCap(wi)); else wi.res = Math.max(wi.res, wi.spare0 || W.spare || 0); }
    ws.st = 'ready'; ws.t = 0; ws.rk = null;
    if (ev) ev.push({ e: 'reloaded', id: a.id });
  } else if (st === 'shell' && wi && W) {
    // 1発込めた
    if (wi.res > 0 && wi.mag < magCap(wi)) { wi.mag++; wi.res--; if (infAmmo(S, a)) wi.res = Math.max(wi.res, wi.spare0 || W.spare || 0); if (ev) ev.push({ e: 'shell', id: a.id }); }
    if (!wi.ch && wi.mag > 0 && W.chamber) { wi.mag--; wi.ch = 1; ws.st = 'pump'; ws.t = (W.pump || 0.35); return; }
    if (wi.mag < magCap(wi) && wi.res > 0 && !ws.stopShell) { ws.t = W.rl.shell; }
    else { ws.st = 'ready'; ws.t = 0; ws.stopShell = false; }
  } else if (st === 'pump' && wi && W) {
    if (!wi.ch && wi.mag > 0) { wi.mag--; wi.ch = 1; }
    ws.st = 'ready'; ws.t = 0;
    if (ev) ev.push({ e: 'pumped', id: a.id });
  } else if (st === 'consol' && wi && W && wi.mags) {
    // 弾倉をまとめた（BattleBit の 2024 の手直し: 1回で、いちばん多い途中の弾倉を、いちばん少ない弾倉から順に満タンにする）
    const cap = magCap(wi);
    const part = wi.mags.map((n, i) => [n, i]).filter(q => q[0] > 0 && q[0] < cap).sort((a, b) => b[0] - a[0]);
    if (part.length >= 2) {
      const tgt = part[0];
      for (let k = part.length - 1; k >= 1 && tgt[0] < cap; k--) { const take = Math.min(cap - tgt[0], part[k][0]); tgt[0] += take; part[k][0] -= take; }
      for (const q of part) wi.mags[q[1]] = q[0];
      wi.mags = wi.mags.filter(n => n > 0);
    }
    ws.st = 'ready'; ws.t = 0;
    if (ev) ev.push({ e: 'consoled', id: a.id, n: wi.mags.length });
  } else if (st === 'gear') { /* 投げ物を持っている */ }
}

// 弾倉をまとめる（BattleBit の P 長押し）: 満タンでない弾倉が2本以上ある時。1回で1本を満タンに（足りなければできるだけ）。0.6秒 + 使う弾倉1本 0.35秒（時間は推測）。撃てない。ダッシュを入れ直すとやめる
export const CONSOL = { base: 0.6, per: 0.35 };
export function startConsol(S, a, ev) {
  const ws = a.ws, wi = curWeapon(a), W = curW(a);
  if (!wi || !W || !wi.mags || ws.st !== 'ready' || a.vault) return false;
  const cap = magCap(wi), P = wi.mags.filter(n => n > 0 && n < cap).sort((x, y) => y - x);
  if (P.length < 2) { if (ev) ev.push({ e: 'consoled', id: a.id, none: true }); return false; }
  // 使う弾倉の数（少ない方から、いちばん多い弾倉が満タンになるまで）
  let need = cap - P[0], used = 0; for (let k = P.length - 1; k >= 1 && need > 0; k--) { need -= P[k]; used++; }
  ws.st = 'consol'; ws.t = CONSOL.base + CONSOL.per * used; ws.rd = ws.t; if (a.sprint) a.sprint = false;
  if (ev) ev.push({ e: 'consol', id: a.id, dur: ws.t, n: used });
  return true;
}
// 落ちた弾倉（大規模戦）: S.mdrops。手の高さから足もとの少し前へ落ちる（見下ろすと見える）。弾の残った弾倉は 60 秒、空の弾倉は 20 秒で消える。
// 同じ銃を持つ人が上（0.9m）を歩くと拾う（弾倉の数が初めの数より少ない時。空の弾倉は拾わない）。
// 落とした本人は、いったん 1.3m 離れてから戻ると拾う（落としてその場に立っていると、すぐ拾ってしまい落ちた弾倉が消えて見えたため）
export function dropMag(S, a, wi, n, ev) {
  const L = S.mdrops || (S.mdrops = []);
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const d = { id: (S.mdropN = (S.mdropN || 0) + 1), wid: wi.id, n, x: a.x + fx * 0.5 - Math.cos(a.yaw) * 0.14, y: a.y, z: a.z + fz * 0.5 + Math.sin(a.yaw) * 0.14, y0: a.y + 1.15, yaw: a.yaw + 0.7, t: S.t, by: a.id, away: false };
  L.push(d); if (L.length > 40) L.shift();
  if (ev) ev.push({ e: 'magDrop', id: a.id, x: d.x, y: d.y, z: d.z, n });
}
export function pickMags(S, ev) {
  const L = S.mdrops; if (!L || !L.length) return;
  const life = Math.round(60 / S.dt), lifeE = Math.round(20 / S.dt);
  for (let i = L.length - 1; i >= 0; i--) {
    const d = L[i];
    if (S.t - d.t > (d.n > 0 ? life : lifeE)) { L.splice(i, 1); continue; }
    if (d.n <= 0) continue;
    // 落とした本人: 1.3m 離れたら拾えるようになる
    if (!d.away) { const o = S.byId[d.by]; if (!o || !o.alive || Math.hypot(o.x - d.x, o.z - d.z) > 1.3) d.away = true; }
    // 落としてすぐは拾わない（0.6秒）
    if (S.t - d.t < Math.round(0.6 / S.dt)) continue;
    for (const a of S.actors) {
      if (a.pid == null || !a.alive || a.down || (a.id === d.by && !d.away) || Math.abs(a.y - d.y) > 1.5 || Math.hypot(a.x - d.x, a.z - d.z) > 0.9) continue;
      const wi = a.inv && a.inv.w && a.inv.w.find(w => w && w.id === d.wid && w.mags);
      // 射撃場（弾が減らない）は、弾倉がいっぱいでも拾う（拾えるのを確かめられるように。弾倉はリロードで満タンに戻る）
      const inf = infAmmo(S, a);
      if (!wi || (wi.mags.length >= (wi.spare0 || 0) && !inf)) continue;
      if (wi.mags.length < (wi.spare0 || 0)) wi.mags.push(d.n);
      L.splice(i, 1);
      if (ev) ev.push({ e: 'magPick', id: a.id, n: d.n });
      break;
    }
  }
}
// 拾うボタン（11-20）: 近く（2m）の、弾の残った弾倉（持っている銃と同じ物）。落とした本人もすぐ拾える
export function magNear(S, a, R = 2) {
  const L = S.mdrops; if (!L || !L.length || !a || !a.alive || a.down) return null;
  let best = null, bd = R;
  for (const d of L) {
    if (d.n <= 0 || Math.abs(a.y - d.y) > 1.5) continue;
    const dd = Math.hypot(a.x - d.x, a.z - d.z); if (dd > bd) continue;
    if (!(a.inv && a.inv.w && a.inv.w.some(w => w && w.id === d.wid && w.mags))) continue;
    bd = dd; best = d;
  }
  return best;
}
// 拾う: 弾倉に空きがあれば足す。いっぱいなら、いちばん少ない弾倉と取り替える（取り替えた弾倉はその場に置く）。射撃場は拾うだけ
export function pickMagNear(S, a, ev) {
  const d = magNear(S, a); if (!d) return false;
  const wi = a.inv.w.find(w => w && w.id === d.wid && w.mags), L = S.mdrops;
  if (infAmmo(S, a) || wi.mags.length < (wi.spare0 || 0)) {
    if (wi.mags.length < (wi.spare0 || 0)) wi.mags.push(d.n);
    L.splice(L.indexOf(d), 1);
    if (ev) ev.push({ e: 'magPick', id: a.id, n: d.n });
    return true;
  }
  let lo = -1; for (let k = 0; k < wi.mags.length; k++) if (lo < 0 || wi.mags[k] < wi.mags[lo]) lo = k;
  if (lo >= 0 && wi.mags[lo] < d.n) {
    const old = wi.mags[lo]; wi.mags[lo] = d.n;
    d.n = old; d.t = S.t; d.by = a.id; d.away = false; d.y0 = d.y;
    if (ev) ev.push({ e: 'magPick', id: a.id, n: wi.mags[lo], swap: old });
    return true;
  }
  if (ev) ev.push({ e: 'magFull', id: a.id });
  return false;
}
export function startReload(S, a, fast, ev) {
  const ws = a.ws, wi = curWeapon(a), W = curW(a);
  // 押してすぐ普通のリロードが始まり、そのまま長押しなら速いリロード（弾倉を落とす）に切り替える
  if (fast && wi && W && ws.st === 'reload' && ws.rk === 'tac' && ws.rd - ws.t < 0.7 && W.rl.fast) {
    const done = ws.rd - ws.t, empty = !wi.ch && W.chamber;
    ws.rk = 'fast'; ws.rd = (W.rl.fast + (empty ? W.rl.empty : 0)) * attMods(wi).reload * (a.inj.arm ? 1.15 : 1) * (S.war && a.warCls === 'assault' ? CLS_FAST : 1); ws.t = Math.max(0.05, ws.rd - done);
    if (ev) ev.push({ e: 'reload', id: a.id, k: 'fast', dur: ws.t, empty, up: 1 });
    return true;
  }
  if (!wi || !W || (ws.st !== 'ready' && ws.st !== 'pump')) return false;
  if (a.vault) return false;
  // 走っていても、リロードが先（走るのをやめる。リロードの間は走らない。ダッシュを入れ直すとやめる。move.js）
  const run = a.sprint;
  if (W.tube) {
    if (wi.mag >= magCap(wi) || wi.res <= 0) return false;
    ws.st = 'shell'; ws.t = W.rl.start + W.rl.shell; ws.stopShell = false; if (run) a.sprint = false;
    if (ev) ev.push({ e: 'reload', id: a.id, k: 'shell' });
    return true;
  }
  if (W.revolver || W.breakAction) {
    if (wi.mag >= magCap(wi) || wi.res <= 0) return false;
    ws.st = 'reload'; ws.rk = W.revolver ? 'rev' : 'break'; ws.t = W.rl.tac; ws.rd = ws.t; if (run) a.sprint = false;
    if (ev) ev.push({ e: 'reload', id: a.id, k: ws.rk, dur: ws.t });
    return true;
  }
  if (!wi.mags || !wi.mags.length) return false;
  if (wi.mag >= magCap(wi) && (wi.ch || !W.chamber)) return false;
  const empty = !wi.ch && W.chamber;
  ws.rk = fast ? 'fast' : 'tac';
  ws.t = ((fast ? W.rl.fast : W.rl.tac) + (empty ? W.rl.empty : 0)) * attMods(wi).reload * (S.war && a.warCls === 'assault' ? CLS_FAST : 1);
  if (a.inj.arm) ws.t *= 1.15;
  ws.rd = ws.t; ws.st = 'reload'; if (run) a.sprint = false;
  if (ev) ev.push({ e: 'reload', id: a.id, k: ws.rk, dur: ws.t, empty });
  return true;
}

export function switchTo(S, a, slot, ev) {
  const ws = a.ws;
  if (slot === ws.slot && ws.st !== 'holster') return false;
  if (slot >= 0 && slot < 2 && !a.inv.w[slot]) return false;
  if (slot === 3 && !HAND_LONG[a.inv.long]) return false;
  // 持ち替える前の物（特殊装備・投げ物から戻るとき）
  if (ws.slot >= 0 && ws.slot < 2) ws.prev = ws.slot;
  ws.next = slot; ws.st = 'holster'; ws.t = 0.22; ws.rk = null;
  if (ev) ev.push({ e: 'holster', id: a.id });
  return true;
}

// M320 の弾を替える（残っている次の種類へ）
export function m320Next(a, ev) {
  const m = a.inv.m320; if (!m) return;
  const order = ['flash', 'stinger', 'cs'];
  let i = order.indexOf(m.sel);
  for (let n = 0; n < 3; n++) { i = (i + 1) % 3; if (m[order[i]] > 0) break; }
  m.sel = order[i];
  if (ev) ev.push({ e: 'm320sel', id: a.id, sel: m.sel, n: m[m.sel] });
}

function tryFire(S, w, a, W, wi, inp, ev) {
  const ws = a.ws;
  if (a.sprint || a.vault || a.low > 0.5 || (a.act && !a.act.canFire) || a.comply || a.down && !S.pvp) return;
  if (ws.so > 0) { if (inp.fire && !ws.trigWas) ws.pend = true; return; } // 走るのをやめて銃を上げている間
  if (ws.st === 'shell') { if (wi.ch || wi.mag > 0) { ws.stopShell = true; ws.st = 'ready'; ws.t = 0; } else return; }
  if (ws.st !== 'ready') return;
  if (ws.cd > 0) return;
  const mode = W.modes[wi.mode] || 'semi';
  if (mode === 'semi' && ws.trigWas && !ws.pend) return;
  // 3点バースト: 引いた時に3発。撃ち終わるまで離しても続く。撃ち終えたら引き直すまで撃たない
  if (mode === 'burst') {
    if (!(ws.burstLeft > 0)) { if (inp.fire && (!ws.trigWas || ws.pend)) ws.burstLeft = 3; else return; }
  } else ws.burstLeft = 0;
  if (W.range && a.ai == null) { /* テーザーの射程は弾で判定 */ }
  // 弾があるか
  const hasRound = W.chamber ? wi.ch > 0 : wi.mag > 0;
  if (!hasRound) {
    if (!ws.trigWas || ws.pend) ev.push({ e: 'dry', id: a.id });
    ws.cd = 0.25; ws.pend = false; ws.burstLeft = 0;
    return;
  }
  // 撃つ
  if (W.chamber) {
    wi.ch = 0;
    if (W.pump) { ws.st = 'pump'; ws.t = W.pump; }
    else if (wi.mag > 0) { wi.mag--; wi.ch = 1; }
  } else wi.mag--;
  ws.cd = 60 / W.rpm;
  if (ws.burstLeft > 0) ws.burstLeft--;
  const m = attMods(wi);
  const am = AMMO[W.cal][wi.am];
  // 散らばりと反動
  const sh = ws.shots;
  const sprd = spreadDeg(S, a, W, wi) * DEG;
  const baseYaw = a.yaw + (ws.ry + (ws.sx || 0)) * DEG, basePitch = a.pitch + (ws.rp + (ws.sy || 0)) * DEG;
  const pellets = am.pellets || 1;
  const seed = a.stats.sh + 1;
  for (let p = 0; p < pellets; p++) {
    // 円の中で一様に
    const r1 = hrand(a.id, seed, p * 2 + 1), r2 = hrand(a.id, seed, p * 2 + 2);
    let ang = Math.sqrt(r1) * (pellets > 1 ? Math.max(sprd * 0.4, (am.spread || 3) * m.spread * DEG * (1 - 0.25 * a.ads)) : sprd), th = r2 * Math.PI * 2;
    if (pellets > 1 && p === 0) ang *= 0.3;
    const yaw = baseYaw + Math.cos(th) * ang, pit = basePitch + Math.sin(th) * ang;
    const cp = Math.cos(pit);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pit), dz = Math.cos(yaw) * cp;
    spawnBullet(S, a, W, wi, am, dx, dy, dz, m, p > 0);
  }
  // 反動
  let kv = W.rc.v * (sh === 0 ? W.rc.first * m.rcfirst : 1) * m.rcv;
  let kh = (hrand(a.id, seed, 77) * 2 - 1) * W.rc.h * m.rch + W.rc.bias * W.rc.h * 0.6;
  let mul = 1 - 0.2 * a.ads;
  // 伏せ撃ち（ドロップショット）: 大規模戦では、伏せていく途中は反動が強く、伏せの小さい反動は伏せ終わってから
  //  （BattleBit 3.0 の予定「ドロップショットは反動が強くなる」。研究メモ 70。倍率は推測）
  const dropping = S.war && a.stance === 2 && a.st < 1.95;
  if (dropping) mul *= DROPSHOT.recoil;
  else if (a.st > 1.5) mul *= 0.7; else if (a.st > 0.5) mul *= 0.85;
  if (a.inj.arm) mul *= 1.6;
  // BattleBit 3.0 の予定（研究メモ 70。倍率は推測）: DMR（単発だけの小銃）は速く撃つほど反動が大きい（0.35 秒より短い間隔で最大 1.7 倍）。
  //  M249 は撃ち続けるほど反動を抑えやすい（1 発ごとに 1.5% 小さく、0.7 倍まで）
  if (S.war && W.cat === 'rifle' && (W.modes || []).length && !(W.modes || []).includes('auto') && ws.lastShot != null) {
    const gap = (S.t - ws.lastShot) * S.dt; if (gap < 0.35) mul *= 1 + 0.7 * (0.35 - gap) / 0.35;
  }
  if (S.war && wi.id === 'm249') mul *= Math.max(0.7, 1 - 0.015 * sh);
  // バイポッド: 立っている間は反動が小さい（0.6 倍。推測）。付けていて立っていない時は反動 1.4 倍・初弾の跳ね 1.6 倍（BattleBit Wiki の Bipod:
  //  「立てると反動がとても良くなり揺れがなくなるが、立てていない時は反動がとても悪くなる」。縦・横 +40%・初弾 +60%）
  if (a.bip) mul *= BIPOD.recoil;
  else if (m.bipod) { kv *= sh === 0 ? BIPOD.offFirst : BIPOD.offRecoil; kh *= BIPOD.offRecoil; }
  if (S.rules && S.rules.recoil) mul *= S.rules.recoil;
  ws.rp += kv * mul; ws.ry += kh * mul;
  ws.bloom = Math.min(W.sp.hip * 0.8, ws.bloom + W.sp.hip * 0.1 * (1 - 0.7 * a.ads));
  ws.shots++; ws.lastShot = S.t; a.stats.sh++; ws.pend = false;
  a.fireK = 1;
  // 音と光（AIは聞く）
  const supp = isSupp(wi.att.muzzle);
  ev.push({ e: 'shot', id: a.id, wid: wi.id, x: a.x, y: a.y, z: a.z, supp, loud: (W.less ? 0.4 : 1) * m.noise, fl: m.flash, n: ws.shots });
  // ボルトアクション: 撃ったらすぐボルトを操作する（音と薬莢は見る側で、操作の進み具合に合わせて出す）
  if (W.bolt && ws.st === 'pump') ev.push({ e: 'bolt', id: a.id, wid: wi.id, dur: ws.t });
}
