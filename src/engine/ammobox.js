// 弾薬箱（大規模戦）: 援護は大きい弾薬箱 ×2、突撃は小さい弾薬箱 ×1。手に持って引き金で足もとの前へ置く（拾えない）。
// 味方（人）が近く（2m）に立っていると、0.8 秒ごとに弾倉を1本ずつ補給する（スマホ向けに、見て押すのではなく近くにいれば補給）。
// 箱の中身は弾の数で数える: 大きい 244・小さい 90（大きいのは BattleBit の Heavy Ammo Kit の「弾 244」。小さいのは推測）。
// 中身がなくなるか、4 分で消える。置いた人以外に補給すると、置いた人に点（1本 10。推測）。research/WARBIT.md §32
import { magCap } from './actor.js';

export const AMMOBOX = { big: 244, small: 90, r: 2.0, every: 0.8, life: 240, pts: 10 };
// 救急（包帯）と投げ物も補給する（BattleBit の重い弾薬箱: 救急 100・投げ物 50。1つ 25 で数える。小さい箱は弾だけ）。4 秒に1つ
export const AIDBOX = { aid: 100, thr: 50, cost: 25, every: 4 };

export function placeAmmo(S, a, id, ev) {
  const big = id === 'ammobig';
  const L = S.ammo || (S.ammo = []);
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const b = { id: (S.ammoN = (S.ammoN || 0) + 1), team: a.team, big, aid: big ? AIDBOX.aid : 0, thr: big ? AIDBOX.thr : 0, left: big ? AMMOBOX.big : AMMOBOX.small, x: a.x + fx * 0.75, y: a.y, z: a.z + fz * 0.75, yaw: a.yaw, t: S.t, by: a.id };
  L.push(b);
  if (ev) ev.push({ e: 'ammoBox', k: 'place', id: b.id, by: a.id, team: a.team, x: b.x, y: b.y, z: b.z, big });
  return b;
}

// 1本補給する: 弾倉の数が初めより少なければ満タンを1本足す。そうでなければ、いちばん少ない途中の弾倉を満タンに。足した弾の数を返す
function giveMag(wi, budget) {
  if (!wi || !wi.mags || budget <= 0) return 0;
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
      if (a.pid == null || a.team !== b.team || !a.alive || a.down || a.sprint) continue;
      if (Math.abs(a.y - b.y) > 1.6 || Math.hypot(a.x - b.x, a.z - b.z) > AMMOBOX.r) continue;
      const due = a._ammoT == null || S.t - a._ammoT >= every;
      if (!due) continue;
      // 救急と投げ物（大きい箱）: 4 秒に1つ。出撃した時の数まで
      if ((b.aid > 0 || b.thr > 0) && (a._aidT == null || S.t - a._aidT >= Math.round(AIDBOX.every / S.dt))) {
        const gs = (a.inv && a.inv.gear) || [];
        const ban = gs.find(g => g.id === 'bandage' && g.n < (g.n0 || 0));
        const thr = gs.find(g => (g.id === 'frag' || g.id === 'impact' || g.id === 'smoke') && g.n < (g.n0 || 0));
        if (ban && b.aid >= AIDBOX.cost) { ban.n++; b.aid -= AIDBOX.cost; a._aidT = S.t; if (ev) ev.push({ e: 'resupply', id: a.id, box: b.id, g: 'bandage' }); }
        else if (thr && b.thr >= AIDBOX.cost) { thr.n++; b.thr -= AIDBOX.cost; a._aidT = S.t; if (ev) ev.push({ e: 'resupply', id: a.id, box: b.id, g: thr.id }); }
      }
      // 主の銃から、満タンなら拳銃
      const w = a.inv && a.inv.w || [];
      let n = giveMag(w[0], b.left);
      if (!n) n = giveMag(w[1], b.left);
      a._ammoT = S.t;
      if (!n) continue;
      b.left -= n;
      if (ev) ev.push({ e: 'resupply', id: a.id, box: b.id, n, left: b.left });
      if (award && b.by !== a.id) award(S.byId[b.by], AMMOBOX.pts, 'resupply', { v: a.id });
    }
  }
}
