// 弾薬箱（大規模戦）: 援護は大きい弾薬箱 ×2、突撃は小さい弾薬箱 ×1。手に持って引き金で足もとの前へ置く（拾えない）。
// 味方（人）が近く（2m）に立っていると、0.8 秒ごとに弾倉を1本ずつ補給する（スマホ向けに、見て押すのではなく近くにいれば補給）。
// 主の銃と拳銃はかわるがわる。包帯・投げ物・道具は 4 秒ごとに枠ごと1つ。
// 箱の中身は弾の数で数える: 大きい 244・小さい 150（BattleBit の Wiki の Heavy Ammo Kit「弾 244」・Small Ammo Kit「弾 150」。research の 39）。
// 中身がなくなるか、4 分で消える。置いた人以外に補給すると、置いた人に点（1本 10。推測）。research/WARBIT.md §32
import { magCap } from './actor.js';

export const AMMOBOX = { big: 244, small: 150, r: 2.0, every: 0.8, life: 240, pts: 10 };
// 救急（包帯）と投げ物・RPG の弾も補給する（BattleBit の重い弾薬箱: 救急 100・投げ物 50・重い道具 100。小さい箱は救急 40 だけ）。
//  包帯・投げ物は 1つ 25、RPG は 1 発 40（Wiki の補給の重さ）。4 秒に1つ
export const AIDBOX = { aid: 100, thr: 50, gad: 100, aidSmall: 40, cost: 25, rpg: 40, c4: 20, every: 4 };

export function placeAmmo(S, a, id, ev) {
  const big = id === 'ammobig';
  const L = S.ammo || (S.ammo = []);
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const b = { id: (S.ammoN = (S.ammoN || 0) + 1), team: a.team, big, aid: big ? AIDBOX.aid : AIDBOX.aidSmall, thr: big ? AIDBOX.thr : 0, gad: big ? AIDBOX.gad : 0, left: big ? AMMOBOX.big : AMMOBOX.small, x: a.x + fx * 0.75, y: a.y, z: a.z + fz * 0.75, yaw: a.yaw, t: S.t, by: a.id };
  L.push(b);
  if (ev) ev.push({ e: 'ammoBox', k: 'place', id: b.id, by: a.id, team: a.team, x: b.x, y: b.y, z: b.z, big });
  return b;
}

// 1本補給する: 弾倉の数が初めより少なければ満タンを1本足す。そうでなければ、いちばん少ない途中の弾倉を満タンに。足した弾の数を返す
// 弾倉のない銃（散弾銃の筒・中折れ）は、1回に1つの装弾数ぶんの弾を予備へ（出撃した時の予備まで）
export function giveAmmo(wi, budget) {
  if (!wi || budget <= 0) return 0;
  if (!wi.mags) {
    const need = (wi.spare0 || 0) - (wi.res || 0);
    if (need <= 0) return 0;
    const n = Math.min(need, Math.max(1, magCap(wi)), budget); wi.res = (wi.res || 0) + n; return n;
  }
  const cap = magCap(wi);
  if (wi.mags.length < (wi.spare0 || 0)) { const n = Math.min(cap, budget); wi.mags.push(n); return n; }
  let bi = -1; for (let i = 0; i < wi.mags.length; i++) if (wi.mags[i] < cap && (bi < 0 || wi.mags[i] < wi.mags[bi])) bi = i;
  if (bi < 0) return 0;
  const n = Math.min(cap - wi.mags[bi], budget); wi.mags[bi] += n; return n;
}

export function stepAmmo(S, ev, award) {
  const L = S.ammo; if (!L || !L.length) return;
  const life = Math.round(AMMOBOX.life / S.dt), every = Math.max(1, Math.round(AMMOBOX.every / S.dt));
  for (let i = L.length - 1; i >= 0; i--) {
    const b = L[i];
    if (b.left <= 0 || S.t - b.t > life) { L.splice(i, 1); if (ev) ev.push({ e: 'ammoBox', k: 'gone', id: b.id }); continue; }
    for (const a of S.actors) {
      // 人もボットも（ボットの弾も 11-27 から減る）
      if (a.team !== b.team || !a.alive || a.down || a.sprint) continue;
      if (Math.abs(a.y - b.y) > 1.6 || Math.hypot(a.x - b.x, a.z - b.z) > AMMOBOX.r) continue;
      const due = a._ammoT == null || S.t - a._ammoT >= every;
      if (!due) continue;
      // 救急・投げ物・道具: 4 秒ごとに、箱の中の別々の枠からそれぞれ1つ（包帯と手榴弾は一緒に戻る）。出撃した時の数まで
      //  本家の箱は 救急・投げ物・軽い道具・重い道具 の枠が別（Wiki の Heavy Ammo Kit。小さい箱は救急 40 だけ）
      if ((b.aid > 0 || b.thr > 0 || b.gad > 0) && (a._aidT == null || S.t - a._aidT >= Math.round(AIDBOX.every / S.dt))) {
        const gs = (a.inv && a.inv.gear) || [];
        const ban = gs.find(g => g.id === 'bandage' && g.n < (g.n0 || 0));
        const thr = gs.find(g => (g.id === 'frag' || g.id === 'impact' || g.id === 'smoke') && g.n < (g.n0 || 0));
        // 工兵の RPG の予備も（BattleBit の重い弾薬箱は道具も補充する。重い道具の枠から 1 発 40）
        const rp = a.inv && a.inv.rpg && a.inv.rpg.n + a.inv.rpg.in < (a.inv.rpg.n0 || 0) + 1 ? a.inv.rpg : null;
        const c4 = gs.find(g => (g.id === 'c4' || g.id === 'apmine' || g.id === 'clay') && g.n < (g.n0 || 0));
        let got = false;
        const give = (g) => { got = true; if (ev) ev.push({ e: 'resupply', id: a.id, box: b.id, g }); };
        if (ban && b.aid >= AIDBOX.cost) { ban.n++; b.aid -= AIDBOX.cost; give('bandage'); }
        if (thr && b.thr >= AIDBOX.cost) { thr.n++; b.thr -= AIDBOX.cost; give(thr.id); }
        if (rp && (b.gad || 0) >= AIDBOX.rpg) { rp.n++; b.gad -= AIDBOX.rpg; give('rpg'); }
        // C4・地雷（Wiki の補給の重さ 20。援護の重い弾薬箱は C4 も補給する）
        else if (c4 && (b.gad || 0) >= AIDBOX.c4) { c4.n++; b.gad -= AIDBOX.c4; give(c4.id); }
        if (got) a._aidT = S.t;
      }
      // 弾: 主の銃と拳銃を、かわるがわる（初めは手に持っている銃。11-27「メイン武器の弾薬だけ」→ 本家は箱を開いて補給する物を選べる。
      //  スマホは近くに立つだけなので、足りない物を順に。research の 67）
      const w = a.inv && a.inv.w || [];
      const fresh = a._ammoT == null || S.t - a._ammoT > every * 3;
      const s0 = !fresh && a._ammoNx != null ? a._ammoNx : (a.ws && a.ws.slot === 1 ? 1 : 0);
      let n = 0, k = s0;
      for (let j = 0; j < 2 && !n; j++) { k = (s0 + j) % 2; n = giveAmmo(w[k], b.left); }
      a._ammoNx = (k + 1) % 2;
      a._ammoT = S.t;
      if (!n) continue;
      b.left -= n;
      if (ev) ev.push({ e: 'resupply', id: a.id, box: b.id, n, left: b.left });
      if (award && b.by !== a.id) award(S.byId[b.by], AMMOBOX.pts, 'resupply', { v: a.id });
    }
  }
}
