// 大規模戦（WAR BIT）のモード。BattleBit に合わせる（research/WARBIT.md の 1・2・3・7・11）。足りない人数はボット（src/war/ai.js）
// - CONQUEST: 拠点を奪い合い、相手のチケットを 0 にする。人数で範囲が変わる（16・32・64 対）。チケットは出撃のたびに1減り、
//   拠点を過半数持つ側が相手を（拠点の差×0.3）/秒 減らす
// - DOMINATION: 乗り物なし。狭い範囲に拠点3つ。奪うのはコンクエストの倍の速さ。持っている拠点1つにつき 3 秒ごとに1点。
//   先に 200 点か、15 分で多い方の勝ち。拠点には出撃できない（自陣の側の出撃の場所から）
// - TEAM DEATHMATCH: 乗り物なし。町の中。倒した数が先に 50（8対8）・100（16対16）か、10 分で多い方の勝ち
// 共通: 拠点は範囲に立つと奪える（味方が多いほど速く 4 人分まで、同数なら止まる。敵の拠点はまず中立に戻す）。
// 範囲の外に 10 秒いると死ぬ。倒されたら数秒で出撃し直す（人は出撃の画面で兵科と場所を選ぶ）
import { createActor, makeInventory, makeArmor } from '../actor.js';
import { killActor, eyeOf } from '../combat.js';
import { los as warLos } from '../../war/world.js';
import { smokeBetween } from '../nades.js';
import { groundAt, pushOut } from '../world.js';
import { heightAt, groundAt as wGround, ceilAt as wCeil } from '../../war/world.js';
import { warThink, warPrep, botSpawnPoint, goalOf, SQUAD } from '../../war/ai.js';
import { CLASSES, classLoadout, classGuns } from '../../war/classes.js';
import { hrand } from '../rng.js';
import { WEAPONS } from '../data/weapons.js';
import { RALLY, rallyOf, rallyKey } from '../rally.js';
import { pickMags } from '../weapon.js';
import { stepAmmo, placeAmmo } from '../ammobox.js';
import { stepMines } from '../mines.js';

export const OUT_LIMIT = 10;
// 落ちた弾倉の落ちる先（11-20）: 前は落とした人の足の高さに置いていて、坂や段の上では地面に埋まった。
//  手の高さから真下のいちばん上の面（地面・床・台）へ。前の 0.5m が壁の向こうなら、足もと寄りへ
function settleDrops(S, w) {
  for (const d of S.mdrops) {
    if (d.gy) continue;
    d.gy = 1;
    const o = S.byId[d.by], hy = d.y0 != null ? d.y0 : d.y + 1.15;
    if (o && !warLos(w, o.x, hy - 0.4, o.z, d.x, hy - 0.4, d.z)) { d.x = o.x + (d.x - o.x) * 0.2; d.z = o.z + (d.z - o.z) * 0.2; }
    const g = wGround(w, d.x, d.z, hy - 0.3);
    if (g > -50) d.y = g;
  }
}
// 点（自分の点。BattleBit に合わせる: 敵を倒すと 200。頭への一発は上乗せ（長距離の狙撃で 400 の例。距離で増える形は推測）。
// 支援・起こす・拠点は BattleBit の数字が見つからないので仮。research/WARBIT.md §25）
export const PTS = { kill: 200, assist: 100, revive: 100, cap: 200, neut: 100 };
export function hsBonus(d) { return Math.max(100, Math.min(500, Math.round(d / 10) * 10)); }
function award(S, a, pts, why, ev, extra) {
  if (!a || !a.stats || pts <= 0) return;
  a.stats.sc = (a.stats.sc || 0) + pts;
  if (a.pid != null) ev.push({ e: 'score', id: a.id, pts, why, ...(extra || {}) });
}
// 倒した点: ダウンさせた時に入る（起こされても取り消さない）。ダウンを経ずに死んだ時は死んだ時に入る
function creditKill(S, v, k, part, ev) {
  const m = S.m, cr = m.scd || (m.scd = {});
  if (cr[v.id]) return;
  cr[v.id] = 1;
  if (k && k.team !== v.team) {
    const d = Math.round(Math.hypot(k.x - v.x, (k.y || 0) - (v.y || 0), k.z - v.z));
    const wi = k.ws && k.ws.slot >= 0 && k.inv && k.inv.w ? k.inv.w[k.ws.slot] : null;
    const hs = part === 'head' ? hsBonus(d) : 0;
    award(S, k, PTS.kill + hs, 'kill', ev, { v: v.id, d, hs, w: wi ? wi.id : '' });
    const gid = m.sqGoal && k.squad != null && m.sqGoal[k.team + ':' + k.squad], gf = gid && m.flags.find(f => f.id === gid);
    if (gf && (Math.hypot(v.x - gf.x, v.z - gf.z) <= gf.r || Math.hypot(k.x - gf.x, k.z - gf.z) <= gf.r)) sqPoints(S, k.team, k.squad, SQP.objKill, 'objKill', ev, gf.id);
  }
  for (const [id, dmg] of Object.entries(v.dmgBy || {})) {
    const x = S.byId[id];
    if (!x || x === k || x.team === v.team || dmg < 30) continue;
    award(S, x, PTS.assist, 'assist', ev, { v: v.id });
  }
}
export const TICKETS = { small: 300, medium: 500, large: 800 };
export const CAP_T = 10;        // 1人で中立→自軍（敵の拠点はこれを2回）。ドミネーションは半分
export const BLEED = 0.3;       // 拠点の差1つあたり、毎秒
export const DOM_RATE = 3;      // ドミネーション: 拠点1つにつき何秒ごとに1点
export const WAR_MODES = {
  conquest: { name: 'コンクエスト', en: 'CONQUEST', desc: '拠点を奪い合い、相手のチケットを 0 にする。人数で戦場の広さが変わる。',
    sizes: { small: { per: 16, area: 'small', tickets: 300 }, medium: { per: 32, area: 'medium', tickets: 500 }, large: { per: 64, area: 'large', tickets: 800 } }, capT: CAP_T, respawn: 7 },
  domination: { name: 'ドミネーション', en: 'DOMINATION', desc: '乗り物なし。狭い範囲の拠点3つ。持っている数だけ点が入り、先に 200 点。',
    sizes: { small: { per: 16 }, medium: { per: 32 } }, area: 'dom', score: 200, time: 15 * 60, capT: CAP_T / 2, respawn: 5 },
  tdm: { name: 'チームデスマッチ', en: 'TEAM DEATHMATCH', desc: '乗り物なし。町の中で、倒した数を先に決まった数まで。',
    sizes: { small: { per: 8, kills: 50 }, medium: { per: 16, kills: 100 } }, area: 'tdm', time: 10 * 60, respawn: 5 },
  // 射撃場（訓練）: 弾は減らない。標的の人形は倒れて 3 秒で起き上がる。兵科と銃はいつでも変えられる
  range: { name: '射撃場', en: 'SHOOTING RANGE', desc: '10m〜1000m の標的で銃を試す。弾は減らない。', sizes: { small: { per: 0 } }, area: 'range', respawn: 3, training: true },
};
export const WAR_MODE_LIST = ['conquest', 'domination', 'tdm'];
export const sizeLabel = (per) => `${per} vs ${per}`;
export const RESPAWN_T = 7;
export const respawnT = (m) => (WAR_MODES[m.mode] || WAR_MODES.conquest).respawn;
export const modeName = (m) => (WAR_MODES[m.mode] || WAR_MODES.conquest).en;

// ボットの兵科（分隊の1人目は分隊長。ほかは重みつき）
const BOT_CLS = [['assault', 34], ['medic', 20], ['support', 14], ['engineer', 16], ['recon', 16]];
const SKILLS = ['bot1', 'bot2', 'bot2', 'bot2', 'bot3'];
function botClass(S, t, k) {
  if (k % SQUAD === 0) return 'leader';
  const tot = BOT_CLS.reduce((s, x) => s + x[1], 0);
  let r = hrand(S.seed + t * 7, k, 63) * tot;
  for (const [c, wgt] of BOT_CLS) { r -= wgt; if (r <= 0) return c; }
  return 'assault';
}
function botGun(S, cls, t, k) {
  const L = classGuns(cls);
  return L[Math.floor(hrand(S.seed + t * 11, k, 61) * L.length) % L.length];
}
// 分隊の名前（フォネティックコード。チーム 0 は A〜H、チーム 1 は O〜V で、結果の表で見分けられるように）
const SQ_NAME = [['アルファ', 'ブラボー', 'チャーリー', 'デルタ', 'エコー', 'フォックストロット', 'ゴルフ', 'ホテル'], ['オスカー', 'パパ', 'ケベック', 'ロメオ', 'シエラ', 'タンゴ', 'ユニフォーム', 'ビクター']];
const SQ_EN = [['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL'], ['OSCAR', 'PAPA', 'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR']];
export const squadName = (sq, t = 0) => { const L = SQ_NAME[t ? 1 : 0]; return L[sq % L.length] + (sq >= L.length ? Math.floor(sq / L.length) + 1 : ''); };
export const squadEn = (sq, t = 0) => { const L = SQ_EN[t ? 1 : 0]; return L[sq % L.length] + (sq >= L.length ? ' ' + (Math.floor(sq / L.length) + 1) : ''); };

// 立って出られる所か（11-26 22:35: 変な隙間に出て、伏せ・しゃがみから始まることがあった）:
//  頭の上 1.95m まで何もない・体（半径 0.38）が物にめり込まない・急な斜面でない・ほかの人と重ならない・建物の中でない（out: false で建物の中も可）
const _po = [0, 0, 0];
export function standOK(S, w, x, z, y, o = {}) {
  if (!isFinite(y)) return false;
  if (o.out !== false && (w.blds || []).some(b => x > b.rect[0] - 0.5 && x < b.rect[2] + 0.5 && z > b.rect[1] - 0.5 && z < b.rect[3] + 0.5)) return false;
  if (wCeil(w, x, z, y + 0.2) - y < 1.95) return false;
  pushOut(w, x, z, y + 0.25, y + 1.9, 0.38, null, -1, _po);
  if (_po[2]) return false;
  // 足もとの段差（隙間にはまる）: まわり 0.5m の地面の高さが大きく違わない
  for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) { const g = groundAt(w, x + dx, z + dz, y + 0.6); if (!isFinite(g) || Math.abs(g - y) > 0.45) return false; }
  for (const b of S.actors) if (b.alive && b.id !== o.skip && Math.hypot(b.x - x, b.z - z) < 0.8 && Math.abs(b.y - y) < 1.5) return false;
  return true;
}
// (x, z) のまわりで立って出られる所を探す（まず r の中を乱数で、なければ外へ渦巻きに 40m まで）
function safeAround(S, w, cx, cz, r, seed, k, o = {}) {
  const tryAt = (x, z) => { const g = heightAt(w, x, z), y = groundAt(w, x, z, g + 0.3); if (y > g + 0.5) return null; return standOK(S, w, x, z, y, o) ? { x, z, y } : null; };
  // まず決まった所（本陣の並び）そのもの。立てるならそこ
  if (o.center) { const q = tryAt(cx, cz); if (q) return q; }
  for (let t = 0; t < 24; t++) {
    const a = hrand(seed, k * 13 + t, 71) * Math.PI * 2, rr = r * (0.2 + 0.6 * hrand(seed, k * 13 + t, 72));
    const q = tryAt(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr); if (q) return q;
  }
  for (let ring = 1; ring <= 20; ring++) {
    const R = r + ring * 2, n = 8 + ring * 2;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + hrand(seed, k, 75 + ring); const q = tryAt(cx + Math.cos(a) * R, cz + Math.sin(a) * R); if (q) return q; }
  }
  return null;
}
// 本陣のまわりの出撃位置（チーム t、k 番目）
export function hqSpot(S, w, t, k) {
  const [hx, hz] = S.m.hq[t];
  const toward = S.m.hq[1 - t][0] > hx ? 1 : -1; // 本陣から戦場の向き（x）
  const a = (k * 2.399) % (Math.PI * 2), r = 3 + (k % 9) * 1.5;
  const x = hx + Math.cos(a) * r + toward * 4, z = hz + Math.sin(a) * r;
  const yaw = toward > 0 ? Math.PI / 2 : -Math.PI / 2;
  const q = (S.actors ? safeAround(S, w, x, z, 2, t * 17 + 3, k, { center: true }) : null);
  return q ? { ...q, yaw } : { x, z, y: groundAt(w, x, z, heightAt(w, x, z) + 0.3), yaw };
}
// (x, z) のまわり r の中で、立って出られる所（建物の外）
export function freeSpot(S, w, cx, cz, r, seed, k) {
  const q = safeAround(S, w, cx, cz, r, seed, k);
  if (q) return { ...q, yaw: hrand(seed, k, 73) * Math.PI * 2 };
  return { x: cx, z: cz, y: groundAt(w, cx, cz, heightAt(w, cx, cz) + 0.3), yaw: 0 };
}
// 分隊の仲間の上に出撃（11-26。本家: 分隊の仲間か出撃ビーコンの上に出られる。撃ち合いの最中の仲間には出られない）
//  撃ち合いの最中: 6 秒以内に撃った・撃たれた、または 25m 以内に見える敵がいる
export const SQ_SPAWN_CALM = 6;
export function canSpawnOn(S, a, b) {
  if (!b || b === a || !b.alive || b.down || b.team !== a.team || b.squad !== a.squad || S.m.mode === 'range' || S.m.mode === 'tdm') return false;
  const calm = Math.round(SQ_SPAWN_CALM / S.dt);
  if (b.lastHit && S.t - b.lastHit.t < calm) return false;
  if (b.ws && b.ws.lastShot != null && b.ws.lastShot >= 0 && S.t - b.ws.lastShot < calm) return false; // -99 はまだ撃っていない
  if (b.vault || b.air) return false;
  for (const e of S.actors) if (e.alive && !e.down && e.team !== b.team && e.team >= 0 && Math.hypot(e.x - b.x, e.z - b.z) < 25) return false;
  return true;
}
// 仲間の後ろ（1.5〜3m）で、仲間が見える立てる所。無ければ仲間のまわり
function mateSpot(S, w, b, k) {
  for (let i = 0; i < 16; i++) {
    const an = b.yaw + Math.PI + (hrand(b.id, k, 81 + i) - 0.5) * 2.2, d = 1.4 + hrand(b.id, k, 91 + i) * 1.8;
    const x = b.x + Math.sin(an) * d, z = b.z + Math.cos(an) * d, y = groundAt(w, x, z, b.y + 0.6);
    if (!isFinite(y) || Math.abs(y - b.y) > 0.8) continue;
    if (!standOK(S, w, x, z, y, { out: false, skip: b.id })) continue;
    if (!warLos(w, b.x, b.y + 1.2, b.z, x, y + 1.2, z)) continue;
    return { x, z, y, yaw: b.yaw };
  }
  const q = safeAround(S, w, b.x, b.z, 3, b.id, k, { out: false });
  return q ? { ...q, yaw: b.yaw } : null;
}
export const flagSpot = (S, w, f, k) => freeSpot(S, w, f.x, f.z, f.r, f.id.charCodeAt(0), k);
// ドミネーション・TDM: 出撃の場所の候補から、敵が近くにいない所（ボットは分隊の目標に近い所、人は少しばらつく）
function zoneSpot(S, w, a, k) {
  const m = S.m, cand = m.spawns[a.team];
  const g = a.ai ? goalOf(S, a) : null;
  let best = cand[0], bs = 1e9;
  for (let i = 0; i < cand.length; i++) {
    const [x, z] = cand[i];
    let s = 0;
    for (const b of S.actors) if (b.alive && !b.down && b.team !== a.team && b.team >= 0) { const d = Math.hypot(b.x - x, b.z - z); if (d < 60) s += (60 - d) * 10; }
    s += g ? Math.hypot(g.x - x, g.z - z) * 0.2 : hrand(S.seed + a.id, k, 74 + i) * 40;
    if (s < bs) { bs = s; best = cand[i]; }
  }
  return freeSpot(S, w, best[0], best[1], 7, a.id * 31 + 5, k);
}
export function inArea(S, x, z) { const r = S.m.rect; return x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]; }
// 出撃できる拠点（コンクエストだけ。自軍の物で、敵が奪いかけていない）
export function canSpawnAt(S, f, team) { return S.m.mode === 'conquest' && f.owner === team && !f.contested && !(team === 0 ? f.prog < 0.999 : f.prog > -0.999); }
// 兵科を選べるか（分隊長は分隊の1人目だけ）
export function canPick(a, cls) { return !!CLASSES[cls] && (cls !== 'leader' || a.sqIdx === 0); }

// 兵科と銃を決める（次の出撃から）
function setClass(a, cls, gun, sec, att, gad) {
  if (!canPick(a, cls)) cls = 'assault';
  a.warCls = cls;
  a.warLo = classLoadout(cls, gun, sec, att, gad);
}

// 出撃し直す（at: 'hq' か拠点の id。ドミネーション・TDM は出撃の場所から）
function redeploy(S, w, a, at) {
  const m = S.m, k = (m.spawnN = (m.spawnN || 0) + 1);
  let p;
  if (a.dummy) p = { x: a.dummy.x, z: a.dummy.z, y: groundAt(w, a.dummy.x, a.dummy.z, heightAt(w, a.dummy.x, a.dummy.z) + 0.3), yaw: a.dummy.yaw };
  else if (at === 'rally' && rallyOf(S, a.team, a.squad)) p = rallySpot(S, w, rallyOf(S, a.team, a.squad), k);
  else if (typeof at === 'string' && at.startsWith('sq:') && canSpawnOn(S, a, S.byId[+at.slice(3)])) p = mateSpot(S, w, S.byId[+at.slice(3)], k);
  if (!p && typeof at === 'string' && at.startsWith('sq:')) at = 'hq';
  if (p) { /* 決まった */ }
  else if (m.mode === 'conquest') {
    const f = at && at !== 'hq' ? m.flags.find(q => q.id === at) : null;
    p = f && canSpawnAt(S, f, a.team) ? flagSpot(S, w, f, k) : hqSpot(S, w, a.team, k);
  } else p = zoneSpot(S, w, a, k);
  const onMate = typeof at === 'string' && at.startsWith('sq:') && p && canSpawnOn(S, a, S.byId[+at.slice(3)]);
  const C = CLASSES[a.warCls] || CLASSES.assault;
  Object.assign(a, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, alive: true, dead: false, down: false, dbno: 0, dbnoCount: 0, hp: C.hp, maxHp: C.hp, oob: 0,
    stun: 0, flash: 0, gas: 0, tased: 0, deaf: 0, supp: 0, bleed: 0, flinch: 0, act: null, st: 0, stance: 0, vault: null, air: false, airTop: null, lean: 0, ads: 0, low: 0, adsOn: false, lowOn: false, sprint: false, sprT: 0, fat: 0, peek: null, melee: null, gest: null, spot: 0,
    inj: { arm: 0, leg: 0, head: 0 }, spawnProt: 2, stateT: 0, dmgBy: {}, lastHit: null, deployAt: null, deployed: true, drag: null, dragBy: null, dragOff: null });
  // 向き: 敵の本陣の方（仲間の上に出た時は仲間と同じ向き）
  const eh = m.hq[1 - a.team]; a.yaw = onMate ? p.yaw : Math.atan2(eh[0] - a.x, eh[1] - a.z);
  const lo = a.warLo || classLoadout('assault');
  a.inv = makeInventory(lo); a.armor = makeArmor(lo);
  a.ws = { slot: a.inv.w[0] ? 0 : 1, next: -1, st: 'draw', t: 0.4, cd: 0, trigWas: false, rp: 0, ry: 0, bloom: 0, shots: 0, lastShot: -99, rk: null, rd: 0, gear: -1, pumpNeed: false, barrel: 0 };
  if (a.ai) { const keep = { type: a.ai.type, skill: a.ai.skill }; a.ai = keep; }
  if (m.mode === 'conquest') m.tickets[a.team] = Math.max(0, m.tickets[a.team] - 1);
}

// 印: S.m.spots = [{ id, team, sq, by, until }]（10 秒。付け直すと延びる）。分隊のボットも場所を知る（ai の intel）
export const SPOT_T = 10;
// 分隊長の目標（BattleBit: 分隊長が拠点に印をつけると分隊の目標。research §26）
// 印の向きに敵がいなければ、狙っている向きの拠点（左右 6° か、拠点の範囲が見える角度の内）を分隊の目標にする。分隊長（分隊の1人目）だけ
// 分隊ポイント: 目標を中立に戻す・奪うと 1000、目標の範囲で敵を倒すと 50（分隊みんなで1つ）
export const SQP = { obj: 1000, objKill: 50 };
export function orderFlag(S, a, ev) {
  const m = S.m;
  if (a.sqIdx !== 0 || !m.flags || !m.flags.length || m.mode === 'range' || m.mode === 'tdm') return null;
  let best = null, bk = 1;
  for (const f of m.flags) {
    const dx = f.x - a.x, dz = f.z - a.z, d = Math.hypot(dx, dz);
    let da = Math.atan2(dx, dz) - a.yaw; da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
    const tol = Math.max(6 * Math.PI / 180, Math.atan2(f.r, Math.max(1, d)));
    if (da / tol < bk) { bk = da / tol; best = f; }
  }
  if (!best) return null;
  const key = a.team + ':' + a.squad;
  (m.sqOrder || (m.sqOrder = {}))[key] = { f: best.id, by: a.id, own: best.owner === a.team };
  (m.sqGoal || (m.sqGoal = {}))[key] = best.id;
  if (ev) ev.push({ e: 'order', team: a.team, sq: a.squad, f: best.id, by: a.id, k: best.owner === a.team ? 'def' : 'atk' });
  return best;
}
// 集合地点を置く（分隊長。分隊ポイント 200。立って地面の上。置き直すと前の物は消える）。置けない時は理由の出来事
export function placeRally(S, w, a, ev) {
  const m = S.m, key = rallyKey(a.team, a.squad), P = m.sqp || (m.sqp = {});
  const no = (why) => { if (ev) ev.push({ e: 'rally', k: 'no', why, by: a.id, team: a.team, sq: a.squad }); return null; };
  if (!a.alive || a.down || a.sqIdx !== 0 || m.mode === 'range' || m.mode === 'tdm') return no('who');
  if ((P[key] || 0) < RALLY.cost) return no('pts');
  if (m.rallyCd && (m.rallyCd[key] || 0) > S.t) return no('cool');
  if (a.air || Math.abs(a.vy || 0) > 0.5 || a.climb) return no('ground');
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  let x = a.x + fx * 0.7, z = a.z + fz * 0.7;
  if (!warLos(w, a.x, a.y + 0.5, a.z, x, a.y + 0.5, z)) { x = a.x; z = a.z; }
  const y = groundAt(w, x, z, a.y + 0.6);
  if (!isFinite(y) || Math.abs(y - a.y) > 0.8) return no('ground');
  const L = S.rallies || (S.rallies = []);
  const old = L.findIndex(r => r.team === a.team && r.sq === a.squad);
  if (old >= 0) L.splice(old, 1);
  const r = { id: (m.rallyN = (m.rallyN || 0) + 1), team: a.team, sq: a.squad, x, y, z, yaw: a.yaw, hp: RALLY.hp, t: S.t, by: a.id };
  L.push(r);
  P[key] -= RALLY.cost;
  if (ev) { ev.push({ e: 'rally', k: 'place', id: r.id, team: a.team, sq: a.squad, by: a.id, x, y, z }); ev.push({ e: 'sqp', team: a.team, sq: a.squad, pts: -RALLY.cost, why: 'rally', n: P[key] }); }
  return r;
}
// 集合地点の近くの空いた所（集合地点のまわり 1.5〜3m）
function rallySpot(S, w, r, k) {
  for (let i = 0; i < 16; i++) {
    const an = hrand(r.id, k, 81 + i) * Math.PI * 2, d = 1.5 + hrand(r.id, k, 91 + i) * 1.5;
    const x = r.x + Math.sin(an) * d, z = r.z + Math.cos(an) * d, y = groundAt(w, x, z, r.y + 0.6);
    if (!isFinite(y) || Math.abs(y - r.y) > 1.2) continue;
    if (!standOK(S, w, x, z, y, { out: false })) continue;
    if (!warLos(w, r.x, r.y + 0.6, r.z, x, y + 0.6, z)) continue;
    return { x, z, y, yaw: r.yaw };
  }
  const q = safeAround(S, w, r.x, r.z, 3, r.id, k, { out: false });
  return q ? { ...q, yaw: r.yaw } : { x: r.x, z: r.z, y: r.y, yaw: r.yaw };
}
function sqPoints(S, team, sq, pts, why, ev, f) {
  const m = S.m, key = team + ':' + sq, P = m.sqp || (m.sqp = {});
  P[key] = (P[key] || 0) + pts;
  ev.push({ e: 'sqp', team, sq, pts, why, f, n: P[key] });
}
export function spotEnemy(S, w, a, ev, o = {}) {
  if (!a.alive || a.down || (a.spotT || -1e9) > S.t) return null;
  a.spotT = S.t + Math.round(0.4 / S.dt);
  const e = eyeOf(S, a), cp = Math.cos(a.pitch), fx = Math.sin(a.yaw) * cp, fy = Math.sin(a.pitch), fz = Math.cos(a.yaw) * cp;
  let best = null, bc = Math.cos((o.deg || 5) * Math.PI / 180);
  for (const b of S.actors) {
    if (!b.alive || b.down || b.team === a.team || b.team < 0 || b.team > 1 || b.dummy && false) continue;
    const ty = b.y + (b.st > 1.5 ? 0.3 : b.st > 0.5 ? 0.9 : 1.3), dx = b.x - e[0], dy = ty - e[1], dz = b.z - e[2], d = Math.hypot(dx, dy, dz);
    if (d > (o.range || 450) || d < 0.5) continue;
    const c = (dx * fx + dy * fy + dz * fz) / d;
    if (c <= bc) continue;
    if (!warLos(w, e[0], e[1], e[2], b.x, ty, b.z) || smokeBetween(S, e[0], e[1], e[2], b.x, ty, b.z) >= 0.6) continue;
    bc = c; best = b;
  }
  if (!best) { const f = orderFlag(S, a, ev); if (!f && ev) ev.push({ e: 'spot', id: -1, by: a.id }); return null; }
  const m = S.m, L = m.spots || (m.spots = []);
  const old = L.find(q => q.id === best.id && q.team === a.team);
  const until = S.t + Math.round(SPOT_T / S.dt);
  if (old) { old.until = until; old.sq = a.squad; old.by = a.id; } else L.push({ id: best.id, team: a.team, sq: a.squad, by: a.id, until });
  if (m.intel && m.intel[a.team]) m.intel[a.team].set(best.id, { x: best.x, z: best.z, y: best.y, t: S.t, sq: a.squad });
  if (ev) ev.push({ e: 'spot', id: best.id, by: a.id });
  return best;
}

function stepFlags(S, w, dt, ev) {
  const m = S.m;
  const rate = dt / m.capT;
  for (const f of m.flags) {
    let n0 = 0, n1 = 0;
    for (const a of S.actors) { if (!a.alive || a.down || a.isDrone) continue; if (Math.hypot(a.x - f.x, a.z - f.z) > f.r || Math.abs(a.y - f.y) > 12) continue; if (a.team === 0) n0++; else if (a.team === 1) n1++; }
    f.n = [n0, n1];
    f.contested = n0 > 0 && n1 > 0;
    const before = f.owner;
    if (n0 !== n1) {
      const s = Math.sign(n0 - n1), k = Math.min(4, Math.abs(n0 - n1));
      f.prog = Math.max(-1, Math.min(1, f.prog + s * k * rate));
    } else if (!n0 && f.owner >= 0) {
      // 誰もいない: 持ち主の側へゆっくり戻る
      const tgt = f.owner === 0 ? 1 : -1; f.prog += Math.sign(tgt - f.prog) * Math.min(Math.abs(tgt - f.prog), rate * 0.25);
    } else if (!n0 && f.owner < 0 && f.prog !== 0) {
      f.prog -= Math.sign(f.prog) * Math.min(Math.abs(f.prog), rate * 0.25);
    }
    // 持ち主: 端まで行けばその側、0 を越えたら中立
    if (f.prog >= 1) f.owner = 0; else if (f.prog <= -1) f.owner = 1;
    else if ((f.owner === 0 && f.prog <= 0) || (f.owner === 1 && f.prog >= 0)) f.owner = -1;
    if (f.owner !== before) {
      ev.push({ e: 'flag', id: f.id, owner: f.owner, prev: before });
      // 拠点の点: 奪った（自軍になった）・中立に戻した 時に、範囲にいた側の全員へ
      const t = f.owner >= 0 ? f.owner : (before === 0 ? 1 : 0);
      const pts = f.owner >= 0 ? PTS.cap : PTS.neut, why = f.owner >= 0 ? 'cap' : 'neut';
      const sqs = new Set();
      if (m.mode !== 'range') for (const a of S.actors) { if (a.team !== t || !a.alive || a.down || a.isDrone) continue; if (Math.hypot(a.x - f.x, a.z - f.z) > f.r || Math.abs(a.y - f.y) > 12) continue; award(S, a, pts, why, ev, { f: f.id }); if (a.squad != null) sqs.add(a.squad); }
      for (const sq of sqs) {
        const key = t + ':' + sq;
        if (m.sqGoal && m.sqGoal[key] === f.id) sqPoints(S, t, sq, SQP.obj, why, ev, f.id);
        // 攻める目標を奪い終えたら、分隊長の目標は解く（次の目標は分隊長が決める。ボットの分隊は自動）
        if (f.owner === t && m.sqOrder && m.sqOrder[key] && m.sqOrder[key].f === f.id && !m.sqOrder[key].own) delete m.sqOrder[key];
      }
    }
  }
  const c = [0, 0]; for (const f of m.flags) if (f.owner >= 0) c[f.owner]++;
  if (m.mode === 'conquest') {
    // チケットの減り（拠点を過半数持つ側が、相手を減らす）
    const half = m.flags.length / 2;
    for (let t = 0; t < 2; t++) if (c[t] > half) m.tickets[1 - t] = Math.max(0, m.tickets[1 - t] - (c[t] - c[1 - t]) * BLEED * dt);
  } else if (m.mode === 'domination') {
    // 点: 持っている拠点1つにつき DOM_RATE 秒ごとに1点
    m.domAcc = (m.domAcc || 0) + dt;
    while (m.domAcc >= DOM_RATE) { m.domAcc -= DOM_RATE; for (let t = 0; t < 2; t++) m.score[t] += c[t]; }
  }
}
// 射撃場: 人の予備の弾倉と投げ物を、兵科の数まで戻す（撃ちっぱなしで試せる）
function refill(S) {
  for (const a of S.actors) {
    if (a.pid == null || !a.alive || !a.inv) continue;
    for (const wi of a.inv.w) {
      if (!wi) continue;
      const W = WEAPONS[wi.id]; if (!W) continue;
      if (wi.mags) { const cap = wi.cap || W.mag; for (let i = 0; i < wi.mags.length; i++) wi.mags[i] = cap; while (wi.mags.length < (W.spare || 3)) wi.mags.push(cap); }
      else if (W.spare != null) wi.res = W.spare;
    }
    const want = new Map((a.warLo && a.warLo.gear || []).map(([id, n]) => [id, n]));
    for (const g of a.inv.gear) if (want.has(g.id)) g.n = Math.max(g.n, want.get(g.id));
  }
}
function finish(S, ev, win, why) {
  const m = S.m;
  m.over = true; m.winner = win; m.endT = S.t; m.why = why;
  ev.push({ e: 'matchend', win, why });
}

export default {
  init(S, w, o) {
    const mode = WAR_MODES[o.wmode] ? o.wmode : 'conquest', MD = WAR_MODES[mode];
    const size = MD.sizes[o.size] ? o.size : Object.keys(MD.sizes)[0], SZ = MD.sizes[size];
    const A = w.areas[SZ.area || MD.area];
    S.war = true;
    S.rules.ff = false; S.rules.dbno = true;
    const T = SZ.tickets || 0;
    S.m = { kind: 'war', mode, size, per: SZ.per, rect: A.rect.slice(), hq: A.hq.map(p => p.slice()), spawns: A.spawns ? A.spawns.map(l => l.map(p => p.slice())) : null,
      tickets: [T, T], tickets0: T, score: [0, 0], limit: mode === 'domination' ? MD.score : mode === 'tdm' ? SZ.kills : 0, timeLimit: MD.time || 0, capT: MD.capT || CAP_T,
      over: false, winner: -1, startT: S.t, spawnN: 0,
      flags: (A.flags || []).map(id => { const d = w.flagDefs[id]; return { id, name: d.name, x: d.x, z: d.z, r: d.r, y: heightAt(w, d.x, d.z), owner: -1, prog: 0, contested: false, n: [0, 0] }; }),
      respawn: [], sqGoal: {} };
    const roster = o.roster || [{ pid: 0, name: 'あなた', team: 0 }];
    const per = o.bots === false ? 0 : (o.per ?? SZ.per ?? 16);
    const cnt = [0, 0];
    const add = (t, r, isBot) => {
      const k = cnt[t]++, p = S.m.mode === 'conquest' ? hqSpot(S, w, t, k) : freeSpot(S, w, S.m.spawns[t][k % S.m.spawns[t].length][0], S.m.spawns[t][k % S.m.spawns[t].length][1], 8, t * 97 + 3, k);
      const sq = Math.floor(k / SQUAD), sqIdx = k % SQUAD;
      const name = r.name || `${squadName(sq, t)}${sqIdx + 1}`;
      const a = createActor(S, { kind: 'soldier', team: t, pid: r.pid ?? null, name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: 100, lo: r.lo || classLoadout('assault'), h: 1.72 + hrand(S.seed, k * 3 + t, 81) * 0.16 });
      a.role = 'soldier'; a.oob = 0; a.squad = sq; a.sqIdx = sqIdx;
      // 向き: 敵の本陣の方
      { const eh = S.m.hq[1 - t]; a.yaw = Math.atan2(eh[0] - a.x, eh[1] - a.z); }
      if (r.lo) { a.warCls = r.cls || 'assault'; a.warLo = r.lo; }
      // ボットの副の道具: クレイモア 4 割・対人地雷 3 割・C4 3 割（守る拠点に地雷を置く。C4 はまだ使わない）
      else if (isBot) { const c = botClass(S, t, k), r = hrand(S.seed, t * 100 + k, 91); setClass(a, c, botGun(S, c, t, k), null, null, r < 0.4 ? 'clay' : r < 0.7 ? 'apmine' : 'c4'); }
      else setClass(a, r.cls || 'assault', r.gun, r.sec);
      a.inv = makeInventory(a.warLo); a.armor = makeArmor(a.warLo);
      a.ws.slot = a.inv.w[0] ? 0 : 1;
      a.hp = a.maxHp = (CLASSES[a.warCls] || CLASSES.assault).hp;
      if (isBot) a.ai = { type: 'war', skill: SKILLS[Math.floor(hrand(S.seed, k * 5 + t, 82) * SKILLS.length)] };
      // 出撃の画面から始める（人だけ）: 倒れた扱いで、場所を選ぶまで待つ
      if (!isBot && o.predeploy) { a.alive = false; a.dead = true; a.deployed = false; S.m.respawn.push({ id: a.id, at: S.t }); }
      else a.deployed = true;
      return a;
    };
    for (const r of roster) add(r.team ?? 0, r, false);
    for (let t = 0; t < 2; t++) while (cnt[t] < per) add(t, {}, true);
    if (mode === 'range') {
      // 標的の人形（敵の服・ヘルメットと胴の防具。動かない）。倒れずにそのまま倒れる（ダウンなし）
      S.rules.dbno = false;
      const [lx, lz] = S.m.hq[0];
      for (const t of w.rangeTargets || []) {
        const y = groundAt(w, t.x, t.z, heightAt(w, t.x, t.z) + 0.3), yaw = Math.atan2(lx - t.x, lz - t.z);
        const a = createActor(S, { kind: 'soldier', team: 1, pid: null, name: `TARGET ${t.d}m`, x: t.x, y, z: t.z, yaw, hp: 100, lo: classLoadout('assault'), h: 1.78 });
        a.role = 'soldier'; a.oob = 0; a.squad = null; a.dummy = { x: t.x, z: t.z, yaw, d: t.d };
        a.warCls = 'assault'; a.warLo = classLoadout('assault'); a.inv = makeInventory(a.warLo); a.armor = makeArmor(a.warLo);
        a.ws.slot = a.inv.w[0] ? 0 : 1; a.hp = a.maxHp = 100; a.ai = null; a.deployed = true;
      }
    }
    // ボットの目で使う表（木の葉・茂み・道）を最初に作る（11-26: 前は最初に敵を見つけた時に作って、そのステップが 25〜50ms 止まった）
    if (S.m.mode !== 'range') warPrep(S, w);
  },
  canDown() { return true; },
  think(S, w, dt, ev) { return S.m.mode === 'range' ? {} : warThink(S, w, dt, ev); },
  // 出撃の画面から（倒れている間）: 兵科・銃を変える、出撃する場所を選ぶ
  act(S, w, a, ac, ev) {
    if (ac.a === 'warClass') { if (!a.alive) setClass(a, ac.cls, ac.gun, ac.sec, ac.att, ac.gad); return true; }
    // 敵に印をつける（BattleBit の中ボタン。分隊に見える。11-19・research の 24）: 狙っている向きから 5° 以内・450m 以内・見えている敵のうち一番まっすぐの1人
    if (ac.a === 'spot') { spotEnemy(S, w, a, ev); return true; }
    if (ac.a === 'rally') { placeRally(S, w, a, ev); return true; }
    if (ac.a === 'warRedeploy') {
      if (!a.alive) return true;
      // 射撃場: その場で出撃の画面へ（倒されたことにはしない）
      if (S.m.mode === 'range') {
        Object.assign(a, { alive: false, dead: true, down: false, deployed: false, deployAt: null, act: null, ads: 0, adsOn: false, sprint: false });
        S.m.respawn.push({ id: a.id, at: S.t });
        ev.push({ e: 'redeploy', id: a.id });
        return true;
      }
      // 試合: ダウン中にあきらめる・メニューの再出撃（11-19 18:16）。倒れたことになり（チケットも減る）、すぐ出撃の画面へ。
      //  ダウンさせた相手・最後に撃った相手の手柄になる（killActor が lastHit を見る）
      killActor(S, a, null, ev, a.down ? 'bleed' : 'redeploy');
      ev.push({ e: 'redeploy', id: a.id });
      return true;
    }
    if (ac.a !== 'warDeploy') return false;
    if (a.alive) return true;
    // 出撃の予約をやめる（11-27。待ちの間にもう一度押した）
    if (ac.cancel) { a.deployAt = null; return true; }
    if (ac.cls) setClass(a, ac.cls, ac.gun, ac.sec, ac.att, ac.gad);
    a.deployAt = ac.at || 'hq';
    return true;
  },
  step(S, w, dt, ev) {
    const m = S.m;
    if (m.over) return;
    if (m.spots && m.spots.length && S.t % 30 === 0) m.spots = m.spots.filter(q => q.until > S.t && S.byId[q.id] && S.byId[q.id].alive && !S.byId[q.id].down);
    stepFlags(S, w, dt, ev);
    if (S.mdrops && S.mdrops.length) { settleDrops(S, w); pickMags(S, ev); }
    if (S.ammo && S.ammo.length) stepAmmo(S, ev, (a, pts, why, ex) => award(S, a, pts, why, ev, ex));
    if (S.mines && S.mines.length) stepMines(S, ev);
    // ボットの衛生: 近く（2.5m）の仲間の人が傷ついていて、敵を追っていない時に医療キットで治す（1 秒に 20。持ち替えの見た目は省く）
    if (m.mode !== 'range') for (const b of S.actors) {
      if (!b.ai || b.warCls !== 'medic' || !b.alive || b.down || b.ai.tgt != null) continue;
      const h = S.actors.find(a => a.pid != null && a.team === b.team && a.alive && !a.down && a.hp < a.maxHp * 0.85 && Math.hypot(a.x - b.x, a.z - b.z) < 2.5 && Math.abs(a.y - b.y) < 1.5);
      if (!h) continue;
      h.hp = Math.min(h.maxHp, h.hp + 20 * dt); h.bleed = 0;
      if ((S.t + b.id) % Math.max(1, Math.round(0.5 / S.dt)) === 0) ev.push({ e: 'medkit', id: b.id, tgt: h.id, hp: Math.round(h.hp) });
    }
    // ボットの援護・突撃: 近く（8m）の仲間の人の予備の弾倉が2本以下で、敵を追っていない時に弾薬箱を置く（2 秒ごとに調べる）
    if (m.mode !== 'range' && S.t % Math.max(1, Math.round(2 / S.dt)) === 1) {
      for (const b of S.actors) {
        if (!b.ai || !b.alive || b.down || b.ai.tgt != null || !b.inv || !b.inv.gear) continue;
        const g = b.inv.gear.find(x => (x.id === 'ammobig' || x.id === 'ammosmall') && x.n > 0); if (!g) continue;
        const h = S.actors.find(a => a.pid != null && a.team === b.team && a.alive && !a.down && Math.hypot(a.x - b.x, a.z - b.z) < 8 && a.inv && a.inv.w[0] && a.inv.w[0].mags && a.inv.w[0].mags.length <= 2);
        if (!h || (S.ammo || []).some(x => x.team === b.team && Math.hypot(x.x - h.x, x.z - h.z) < 10)) continue;
        g.n--; placeAmmo(S, b, g.id, ev);
      }
    }
    // ボットの分隊長: 分隊ポイントがたまり、目標の手前（35〜110m）で敵を追っていない時に集合地点を置く（2 秒ごとに調べる）
    if (m.mode !== 'range' && m.mode !== 'tdm' && S.t % Math.max(1, Math.round(2 / S.dt)) === 0) {
      for (const a of S.actors) {
        if (!a.ai || a.sqIdx !== 0 || !a.alive || a.down || a.ai.tgt != null) continue;
        const key = rallyKey(a.team, a.squad);
        if (((m.sqp || {})[key] || 0) < RALLY.cost || (m.rallyCd && (m.rallyCd[key] || 0) > S.t)) continue;
        const g = goalOf(S, a); if (!g) continue;
        const d = Math.hypot(a.x - g.x, a.z - g.z); if (d < 35 || d > 110) continue;
        const cur = rallyOf(S, a.team, a.squad);
        if (cur && Math.hypot(cur.x - g.x, cur.z - g.z) < 150) continue;
        placeRally(S, w, a, ev);
      }
    }
    // 出撃し直す: ボットは時間が来たら、人は場所を選んでから
    for (let i = m.respawn.length - 1; i >= 0; i--) {
      const r = m.respawn[i]; if (S.t < r.at) continue;
      const a = S.byId[r.id]; if (!a || !a.dead) { m.respawn.splice(i, 1); continue; }
      if (m.mode === 'conquest' && m.tickets[a.team] <= 0) continue;
      if (a.pid != null && !a.deployAt) continue;
      m.respawn.splice(i, 1);
      let at = a.pid != null ? a.deployAt : (botSpawnPoint(S, a) || {}).flag || 'hq';
      if (a.pid == null) {
        const rl = rallyOf(S, a.team, a.squad), g = rl && goalOf(S, a);
        if (rl && g) {
          const f0 = at !== 'hq' && m.flags.find(q => q.id === at), hq = m.hq[a.team];
          const d0 = f0 ? Math.hypot(f0.x - g.x, f0.z - g.z) : Math.hypot(hq[0] - g.x, hq[1] - g.z);
          if (Math.hypot(rl.x - g.x, rl.z - g.z) < d0 - 20) at = 'rally';
        }
      }
      redeploy(S, w, a, at);
      ev.push({ e: 'respawn', id: a.id, at });
    }
    if (m.mode === 'range' && S.t % 30 === 0) refill(S);
    // 範囲の外: 10秒で死ぬ（戻れば消える）
    for (const a of S.actors) {
      if (!a.alive) continue;
      if (inArea(S, a.x, a.z)) { if (a.oob) { a.oob = 0; if (a.pid != null) ev.push({ e: 'oob', id: a.id, t: 0 }); } continue; }
      const was = a.oob || 0;
      a.oob = was + dt;
      if (a.pid != null && Math.floor(was) !== Math.floor(a.oob)) ev.push({ e: 'oob', id: a.id, t: OUT_LIMIT - Math.floor(a.oob) });
      if (a.oob >= OUT_LIMIT) { a.oob = 0; a.lastHit = null; killActor(S, a, null, ev, 'oob', ''); }
    }
    // 勝ち負け
    if (m.mode === 'conquest') {
      for (let t = 0; t < 2; t++) if (m.tickets[t] <= 0 && !m.over) finish(S, ev, 1 - t, 'tickets');
      return;
    }
    if (m.mode === 'range') return;
    const s = m.score;
    if (s[0] >= m.limit || s[1] >= m.limit) { finish(S, ev, s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1, 'score'); return; }
    if (m.timeLimit && (S.t - m.startT) * S.dt >= m.timeLimit) finish(S, ev, s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1, 'time');
  },
  onEvents(S, w, evs) {
    const m = S.m;
    const n0 = evs.length;
    for (let i = 0; i < n0; i++) {
      const e = evs[i];
      // 双眼鏡の印（射撃場でも）
      if (e.e === 'binocSpot') { const a = S.byId[e.id]; if (a && !m.over) spotEnemy(S, w, a, evs, { range: 800, deg: 2.5 }); continue; }
      if (m.mode === 'range' || m.over) { if (e.e === 'kill' && m.scd) delete m.scd[e.id]; if (e.e !== 'kill') continue; }
      else if (e.e === 'down') { const v = S.byId[e.id]; if (v) creditKill(S, v, S.byId[e.by], e.part, evs); continue; }
      else if (e.e === 'healPts') { award(S, S.byId[e.id], 10, 'heal', evs, { v: e.v }); continue; }
      else if (e.e === 'revive') { const v = S.byId[e.id], b = S.byId[e.by]; if (m.scd) delete m.scd[e.id]; if (b && v && b !== v) award(S, b, PTS.revive, 'revive', evs, { v: v.id }); continue; }
      if (e.e !== 'kill') continue;
      const v = S.byId[e.id], k = S.byId[e.by];
      if (!v) continue;
      if (m.mode !== 'range' && !m.over) creditKill(S, v, k, e.part, evs);
      if (m.scd) delete m.scd[v.id];
      v.stats.d++;
      if (k && k.team !== v.team) { k.stats.k++; if (m.mode === 'tdm' && !m.over) m.score[k.team]++; }
      for (const as of e.as || []) { const x = S.byId[as]; if (x && x.team !== v.team) x.stats.a++; }
      v.deployAt = null;
      m.respawn.push({ id: v.id, at: S.t + Math.round(respawnT(m) / S.dt) });
    }
  },
};
