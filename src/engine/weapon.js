// 銃の動き: 撃つ・弾倉（1本ずつ残弾）・通常/速いリロード・1発ずつ込める・ポンプ・持ち替え・反動（BattleBit式）・散らばり
import { WEAPONS, AMMO, ATTACH, zoomsOf, swayOf } from './data/weapons.js';
import { LONG, HAND_LONG } from './data/equipment.js';
import { curWeapon, curW, magCap } from './actor.js';
import { spawnBullet } from './combat.js';
import { hrand } from './rng.js';
export { hrand };

const DEG = Math.PI / 180;
const _amCache = new WeakMap();
export function attMods(wi) {
  if (!wi) return { rcv: 1, rch: 1, rcfirst: 1, ads: 0, noise: 1, vel: 1, flash: 1, zoom: 1, scope: false, hip: 1, reload: 1, move: 1, spread: 1 };
  const key = wi.att.sight + wi.att.muzzle + wi.att.grip + wi.att.side + wi.att.mag + wi.att.stock;
  const c = _amCache.get(wi);
  if (c && c.key === key) return c.m;
  const m = { rcv: 1, rch: 1, rcfirst: 1, ads: 0, noise: 1, vel: 1, flash: 1, zoom: 1, scope: false, hip: 1, reload: 1, move: 1, spread: 1 };
  const A = ATTACH, a = wi.att;
  for (const x of [A.sight[a.sight], A.muzzle[a.muzzle], A.grip[a.grip], A.side[a.side], A.mag[a.mag], A.stock[a.stock]]) {
    if (!x) continue;
    if (x.rcv) m.rcv *= x.rcv; if (x.rch) m.rch *= x.rch; if (x.rcfirst) m.rcfirst *= x.rcfirst;
    if (x.ads) m.ads += x.ads; if (x.noise) m.noise *= x.noise; if (x.vel) m.vel *= x.vel; if (x.flash != null) m.flash *= x.flash;
    if (x.zoom) m.zoom = Math.max(m.zoom, x.zoom); if (x.scope) m.scope = true;
    if (x.reload) m.reload *= x.reload; if (x.move) m.move *= x.move; if (x.spread) m.spread *= x.spread;
    if (x.hip && !x.laser) m.hip *= x.hip; // レーザーの腰だめは点けている間だけ（spreadDeg）
  }
  if (a.muzzle === 'supp' && WEAPONS[wi.id].integral) m.noise = 0.25;
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
  return s;
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
    const ctrl = W.rc.ctrl * (since > 0.12 ? 1 : 0.25);
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
  // 突撃は構えるのが速い（BattleBit の 2024 の手直し。どれだけ速いかは書いていないので 0.85 倍は推測。research §30）
  const adsT = (W ? W.ads + attMods(wi).ads : 0.25) * (S.war && a.warCls === 'assault' ? CLS_FAST : 1);
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
  if (W && a.ads > 0.01) {
    const still = (a.spd || 0) < 0.3 && a.ads > 0.95;
    ws.calm = still ? Math.min(1, (ws.calm || 0) + dt / 1.5) : Math.max(0, (ws.calm || 0) - dt * 4);
    const fat = a.fat || 0;
    const A = swayOf(W) * a.ads * a.ads * (a.st > 1.5 ? 0.25 : a.st > 0.5 ? 0.5 : 1) * (1 + Math.min(1.5, (a.spd || 0) / 2.4) * 1.5) * (a.inj && a.inj.arm ? 1.8 : 1)
      * (Math.abs(a.lean || 0) > 0.3 ? 1.15 : 1) * (1 + 0.4 * fat) * (1 - 0.3 * ws.calm)
      * (1 - 0.9 * (ws.hold || 0)) * (1 + 0.9 * Math.min(1, (ws.gasp || 0) / 2.5));
    const t = S.t * S.dt + a.id * 7.3;
    // 息: ふだんは 1.55 rad/秒（約4秒）。走ったあとは大きく、速い息（2.7 rad/秒）が混ざる
    const br = 0.55 * (1 + 1.2 * fat) * Math.sin(t * 1.55) + 0.75 * fat * Math.sin(t * 2.7 + 0.5);
    ws.sx = A * (0.7 * (Math.sin(t * 0.83) * 0.65 + Math.sin(t * 1.91 + 1.3) * 0.35) + 0.15 * br + 0.05 * Math.sin(t * 10.3 + a.id));
    ws.sy = A * (0.5 * (Math.sin(t * 1.17 + 2.1) * 0.6 + Math.sin(t * 0.57 + 0.4) * 0.4) + br + 0.05 * Math.sin(t * 12.1 + 2 * a.id));
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
    // 倍率を切り替えられる照準器: 倍率のボタン（'zoom'。11-19 14:03 から射撃モードと別。BattleBit も別のキー）。
    //  古い手元（'mode' に zoom: true）も受ける
    else if ((ac.a === 'zoom' || (ac.a === 'mode' && ac.zoom === true)) && W && wi && zoomsOf(wi.att)) { const zs = zoomsOf(wi.att); wi.zi = ((wi.zi || 0) + 1) % zs.length; ev.push({ e: 'zoom', id: a.id, z: zs[wi.zi], sight: wi.att.sight }); }
    else if (ac.a === 'mode' && W && wi && W.modes.length > 1 && ws.st === 'ready') { wi.mode = (wi.mode + 1) % W.modes.length; ev.push({ e: 'fmode', id: a.id, m: W.modes[wi.mode] }); }
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
  return !!ws && ws.slot >= 0 && (ws.slot < 2 || (ws.slot === 3 && a.inv.long === 'm320') || (ws.slot === 2 && ws.gear === 'binoc')) && !a.down && !a.peek;
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

// 突撃の速さ（構える・リロード）
export const CLS_FAST = 0.85;
// 予備の弾が減らない: 対戦（作り直す前のモード）・射撃場・大規模戦のボット
function infAmmo(S, a) { return !!S.pvp && (!S.war || (S.m && S.m.mode === 'range') || a.pid == null); }
function finishState(S, a, ev) {
  const ws = a.ws, wi = curWeapon(a), W = curW(a);
  const st = ws.st;
  if (st === 'draw') { ws.st = 'ready'; ws.t = 0; }
  else if (st === 'holster') { ws.slot = ws.next; ws.next = -1; ws.st = 'draw'; const W2 = curW(a); ws.t = W2 ? W2.draw : ws.slot === 3 ? (LONG[a.inv.long] && LONG[a.inv.long].draw) || 0.6 : 0.3; if (ev) ev.push({ e: 'draw', id: a.id, slot: ws.slot }); }
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
        else if (ws.rk === 'fast' && wi.mag > 0 && S.war) dropMag(S, a, wi, wi.mag, ev);
        wi.mag = nm;
        if (!wi.ch && W.chamber) { if (wi.mag > 0) { wi.mag--; wi.ch = 1; } }
      }
    }
    // 対戦: 予備の弾倉は減らない（TDM で弾が尽きると死ぬしかなくなるため。作戦は RoN のとおり減る）
    // 大規模戦（11-19 23:27）: 人の弾は減る（BattleBit のとおり。抜いた弾倉は残り、まとめられる。補給は出撃し直すと満タン・弾薬箱は次に作る）。
    //  射撃場と、ボット（弾が尽きた時の動きがまだない）は減らない
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
// 落ちた弾倉（大規模戦）: S.mdrops。60 秒で消える。同じ銃を持つ人が上を歩くと拾う（弾倉の数が初めの数より少ない時）
export function dropMag(S, a, wi, n, ev) {
  const L = S.mdrops || (S.mdrops = []);
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const d = { id: (S.mdropN = (S.mdropN || 0) + 1), wid: wi.id, n, x: a.x + fx * 0.25 + Math.cos(a.yaw) * 0.12, y: a.y, z: a.z + fz * 0.25 - Math.sin(a.yaw) * 0.12, yaw: a.yaw + 0.7, t: S.t, by: a.id };
  L.push(d); if (L.length > 40) L.shift();
  if (ev) ev.push({ e: 'magDrop', id: a.id, x: d.x, y: d.y, z: d.z });
}
export function pickMags(S, ev) {
  const L = S.mdrops; if (!L || !L.length) return;
  const life = Math.round(60 / S.dt);
  for (let i = L.length - 1; i >= 0; i--) {
    const d = L[i];
    if (S.t - d.t > life) { L.splice(i, 1); continue; }
    // 落としてすぐは拾わない（0.6秒）
    if (S.t - d.t < Math.round(0.6 / S.dt)) continue;
    for (const a of S.actors) {
      if (a.pid == null || !a.alive || a.down || Math.abs(a.y - d.y) > 1.5 || Math.hypot(a.x - d.x, a.z - d.z) > 1.1) continue;
      const wi = a.inv && a.inv.w && a.inv.w.find(w => w && w.id === d.wid && w.mags);
      if (!wi || wi.mags.length >= (wi.spare0 || 0)) continue;
      wi.mags.push(d.n); L.splice(i, 1);
      if (ev) ev.push({ e: 'magPick', id: a.id, n: d.n });
      break;
    }
  }
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
  if (a.st > 1.5) mul *= 0.7; else if (a.st > 0.5) mul *= 0.85;
  if (a.inj.arm) mul *= 1.6;
  if (S.rules && S.rules.recoil) mul *= S.rules.recoil;
  ws.rp += kv * mul; ws.ry += kh * mul;
  ws.bloom = Math.min(W.sp.hip * 0.8, ws.bloom + W.sp.hip * 0.1 * (1 - 0.7 * a.ads));
  ws.shots++; ws.lastShot = S.t; a.stats.sh++; ws.pend = false;
  a.fireK = 1;
  // 音と光（AIは聞く）
  const supp = wi.att.muzzle === 'supp';
  ev.push({ e: 'shot', id: a.id, wid: wi.id, x: a.x, y: a.y, z: a.z, supp, loud: (W.less ? 0.4 : 1) * m.noise, fl: m.flash, n: ws.shots });
  // ボルトアクション: 撃ったらすぐボルトを操作する（音と薬莢は見る側で、操作の進み具合に合わせて出す）
  if (W.bolt && ws.st === 'pump') ev.push({ e: 'bolt', id: a.id, wid: wi.id, dur: ws.t });
}
