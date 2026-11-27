// 大規模戦の要請（11-27 16:51「弾薬箱をくれ等の指示や要請ができるボタン。アイテム選択同様ホイールで選ぶ。ai もそれに反応する」）
// 本家は声（近くの声・分隊・分隊長の無線）と中ボタンの印で伝える（research/WARBIT.md の 77）。スマホでは声を出しにくいので、
//  Battlefield の Commo Rose のような円で言葉を選ぶ。味方には頭の上の印と出来事の欄で伝わり、ボットは応える:
//  弾薬をくれ: 弾薬箱を持っている近くの味方（分隊を先に）が来て、足もとへ箱を置く（近くに箱があれば「そこにある」）
//  衛生兵: 近くの衛生兵が来て治す・起こす（倒れていて衛生兵がいなければ分隊の近い人）
//  ついて来い: 分隊のボット（4 人まで）が 90 秒ついて来る（もう一度で解く）
//  ここを守れ: 分隊のボットが、その場所のまわりで 2 分守る
//  敵発見: 照準の先の敵に印（見えていなければ照準の先の場所）。分隊のボットがそちらを見て、向かう
//  ありがとう: 出来事に出るだけ
import { placeAmmo } from '../engine/ammobox.js';
import { eyeOf } from '../engine/combat.js';
import { raycast, heightAt } from './world.js';

export const REQ = {
  ammo: { label: '弾薬をくれ', say: '弾薬をくれ！' },
  medic: { label: '衛生兵！', say: '衛生兵！' },
  follow: { label: 'ついて来い', say: 'ついて来い！' },
  guard: { label: 'ここを守れ', say: 'ここを守れ！' },
  enemy: { label: '敵発見', say: '敵発見！' },
  thanks: { label: 'ありがとう', say: 'ありがとう！' },
};
export const REQ_ORDER = ['ammo', 'medic', 'follow', 'guard', 'enemy', 'thanks'];
const SECS = { ammo: 45, medic: 60, follow: 90, guard: 120 };
const T = (S, s) => Math.round(s / S.dt);

const bots = (S, a) => S.actors.filter(b => b !== a && b.ai && b.ai.type === 'war' && b.team === a.team && b.alive && !b.down && b.deployed !== false && !b.dummy);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hasBox = (b) => b.inv && b.inv.gear && b.inv.gear.some(g => (g.id === 'ammobig' || g.id === 'ammosmall') && g.n > 0);
// 近い順（分隊の人は近く見る。撃ち合っている人は後）
function pick(S, a, L, maxD) {
  let best = null, bs = Infinity;
  for (const b of L) {
    const d = dist(a, b); if (d > maxD) continue;
    if (b.ai.req && b.ai.req.id !== a.id && S.t <= b.ai.req.until) continue;
    const s = d * (b.squad === a.squad ? 1 : 1.6) + (b.ai.tgt != null ? 40 : 0);
    if (s < bs) { bs = s; best = b; }
  }
  return best;
}
const give = (S, b, a, k, o = {}) => {
  b.ai.req = { k, id: a.id, t: S.t, until: S.t + T(S, SECS[k] || 60), ...o };
  // 倒れた人の「衛生兵」: 起こしに行く（ai.js の tryRevive が続ける）
  if (k === 'medic' && a.down) b.ai.reviving = a.id;
};

// 照準の先（建物・地面。300m まで。当たらなければ 150m 先）
export function aimPoint(S, w, a) {
  const e = eyeOf(S, a), cp = Math.cos(a.pitch), dx = Math.sin(a.yaw) * cp, dy = Math.sin(a.pitch), dz = Math.cos(a.yaw) * cp;
  let t = 300;
  try { for (const h of raycast(w, e[0], e[1], e[2], dx, dy, dz, 300)) if (h.t0 > 0.4 && h.t0 < t) t = h.t0; } catch (er) { /* なし */ }
  for (let s = 1; s < t; s += 1.5) { const x = e[0] + dx * s, z = e[2] + dz * s; if (e[1] + dy * s < heightAt(w, x, z)) { t = s; break; } }
  if (t >= 300) t = 150;
  return [e[0] + dx * t, Math.max(heightAt(w, e[0] + dx * t, e[2] + dz * t), e[1] + dy * t), e[2] + dz * t];
}

// 要請を出す（war.js の act から）。spot: 敵に印をつける関数（war.js の spotEnemy。循環の import を避けて渡す）
export function request(S, w, a, k, ev, spot) {
  if (!REQ[k] || !a.alive || a.pid == null && !a.ai) return;
  // 倒れている間は「衛生兵」と「ありがとう」だけ
  if (a.down && k !== 'medic' && k !== 'thanks') return;
  if ((a.reqT || -1e9) > S.t) return;
  a.reqT = S.t + T(S, 1.5);
  const out = { e: 'req', id: a.id, team: a.team, sq: a.squad, k, to: [], x: a.x, y: a.y, z: a.z };
  const L = bots(S, a);
  if (k === 'ammo') {
    const box = (S.ammo || []).find(b => b.team === a.team && b.left > 0 && Math.hypot(b.x - a.x, b.z - a.z) < 12 && Math.abs(b.y - a.y) < 4);
    const cur = L.find(b => b.ai.req && b.ai.req.k === 'ammo' && b.ai.req.id === a.id && S.t <= b.ai.req.until);
    if (box) out.why = 'box';
    else if (cur) out.to.push(cur.id);
    else { const b = pick(S, a, L.filter(hasBox), 150); if (b) { give(S, b, a, 'ammo'); out.to.push(b.id); } else out.why = 'none'; }
  } else if (k === 'medic') {
    if (!a.down && a.hp >= a.maxHp * 0.95) out.why = 'fine';
    else {
      const cur = L.find(b => b.ai.req && b.ai.req.k === 'medic' && b.ai.req.id === a.id && S.t <= b.ai.req.until);
      let b = cur || pick(S, a, L.filter(q => q.warCls === 'medic'), 150);
      // 倒れていて衛生兵がいない: 分隊の近い人が起こしに来る（ボットはだれでも起こせる）
      if (!b && a.down) b = pick(S, a, L.filter(q => q.squad === a.squad), 60);
      if (b) { if (!cur) give(S, b, a, 'medic'); out.to.push(b.id); } else out.why = 'none';
    }
  } else if (k === 'follow') {
    const sq = L.filter(b => b.squad === a.squad);
    const on = sq.filter(b => b.ai.req && b.ai.req.k === 'follow' && b.ai.req.id === a.id && S.t <= b.ai.req.until);
    if (on.length) { for (const b of on) b.ai.req = null; out.off = true; out.to = on.map(b => b.id); }
    else {
      const near = sq.filter(b => dist(a, b) < 150).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 4);
      near.forEach((b, i) => { give(S, b, a, 'follow', { n: i }); out.to.push(b.id); });
      if (!near.length) out.why = 'none';
    }
  } else if (k === 'guard') {
    const near = L.filter(b => b.squad === a.squad && dist(a, b) < 200).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 6);
    near.forEach((b, i) => { give(S, b, a, 'guard', { n: i, x: a.x, y: a.y, z: a.z, yaw: a.yaw }); out.to.push(b.id); });
    if (!near.length) out.why = 'none';
  } else if (k === 'enemy') {
    const e = spot ? spot(S, w, a, ev, { deg: 8, noFlag: true }) : null;
    const p = e ? [e.x, e.y, e.z] : aimPoint(S, w, a);
    out.x = p[0]; out.y = p[1]; out.z = p[2]; out.tgt = e ? e.id : -1;
    const m = S.m;
    if (m.intel && m.intel[a.team]) m.intel[a.team].set(e ? e.id : 'p' + a.id, { x: p[0], z: p[2], y: p[1], t: S.t, sq: a.squad });
    // 分隊のボット（150m まで）: そちらを見る
    for (const b of L) {
      if (b.squad !== a.squad || dist(a, b) > 150) continue;
      b.ai.look = [p[0], p[1] + 1.2, p[2]]; b.ai.lookT = S.t; out.to.push(b.id);
      if (b.ai.tgt == null) b.ai.threat = { x: p[0], z: p[2], y: p[1], t: S.t };
    }
  }
  if (ev) ev.push(out);
}

// 毎ステップ（war.js の step）: 着いたボットが箱を置く・治し終えた・時間切れ
export function stepRequests(S, w, ev) {
  for (const b of S.actors) {
    const r = b.ai && b.ai.req; if (!r) continue;
    const a = S.byId[r.id];
    if (!b.alive || b.down || S.t > r.until || (r.k !== 'guard' && (!a || !a.alive))) { b.ai.req = null; continue; }
    if (r.k === 'ammo' && r.drop) {
      const g = b.inv.gear.find(x => x.id === 'ammobig' && x.n > 0) || b.inv.gear.find(x => x.id === 'ammosmall' && x.n > 0);
      b.ai.req = null;
      if (!g) continue;
      g.n--; placeAmmo(S, b, g.id, ev);
      if (ev) ev.push({ e: 'reqDone', id: b.id, to: a.id, k: 'ammo', team: b.team });
    } else if (r.k === 'medic' && !a.down && a.hp >= a.maxHp * 0.98 && dist(a, b) < 4) {
      b.ai.req = null;
      if (ev) ev.push({ e: 'reqDone', id: b.id, to: a.id, k: 'medic', team: b.team });
    }
  }
}
