// 建物の中の道（11-27: 「ボットが建物の中に入ってこない」）。外の道（nav.js）は建物の敷地をふさいでいるので、建物ごとに別に持つ:
//  - 高さ（床・踊り場・階段の上と下）ごとの 0.5m の格子。立てるマス = その高さの床があり、頭の上 1.85m が空き、体（半径 0.28m）が壁に当たらない
//  - 階段: 下の端の手前と上の端の先のマスをつなぐ（道の点は階段の両端。歩けば坂を上り下りする）
//  - 出入り口: 1 階の壁ぎわのマスのうち、外へ 0.7m 出た所に立てて、間に壁がない所
//  - 窓: 壁ぎわのマスのうち、目の高さで外へ見通せ（ガラスか何もない）、腰の高さに壁がある所（外向きの向きつき）
//  - 出入り口から歩いて行けないマス（上れない屋根の上など）は立てないことにする
// 作るのは、その建物が初めて要るとき。大きい建物（アパート・事務所）は 50〜150ms かかるので、ボットは少しずつ作る
//  （navStep: 1 ステップに少しずつ。できるまでは外の道を使う）。bldNav はその場で全部作る（テスト・試合の前）
import { groundAt, ceilAt, pushOut, raycast } from './world.js';
import { M } from '../engine/data/materials.js';

export const IS = 0.5;
const UP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const SQ2 = Math.SQRT2;
const _po = [0, 0, 0], _rh = [];
const HMAX = 65536, _hk = new Int32Array(HMAX), _hf = new Float64Array(HMAX);

// 16m の升目ごとに、かかる建物を覚えておく（ボットが 1 ステップに何十回も聞くので、全部の建物を見ない）
const BG = 16;
function bldGrid(ww) {
  const n = (ww.blds || []).length;
  if (ww._bg && ww._bg.n === n) return ww._bg;
  const m = new Map();
  for (const bd of ww.blds || []) {
    const r = bd.rect;
    for (let j = Math.floor(r[1] / BG); j <= Math.floor(r[3] / BG); j++) for (let i = Math.floor(r[0] / BG); i <= Math.floor(r[2] / BG); i++) {
      const k = i * 65536 + j; let L = m.get(k); if (!L) m.set(k, L = []); L.push(bd);
    }
  }
  return (ww._bg = { n, m });
}
export function bldOf(ww, x, z) {
  const L = bldGrid(ww).m.get(Math.floor(x / BG) * 65536 + Math.floor(z / BG));
  if (L) for (const bd of L) { const r = bd.rect; if (!bd.down && x > r[0] + 0.05 && x < r[2] - 0.05 && z > r[1] + 0.05 && z < r[3] - 0.05) return bd; }
  return null;
}
export function hasNav(ww, bd) { return !!(ww._inav && ww._inav.has(bd.id)); }

// その場で全部作る
export function bldNav(ww, bd) {
  ww._inav = ww._inav || new Map();
  const old = ww._inav.get(bd.id); if (old) return old;
  const job = newJob(ww, bd);
  while (!job.done) step1(job);
  return job.nav;
}
// 少しずつ作る（試合ごとに数える）: n 区切り（1 区切りはマス 16〜32 個）だけ進める。時計ではなく量で区切る。
//  M: その試合の進み。マップの形は試合をまたいで使い回すので、前の試合で作った道があっても、
//  この試合では作るのと同じ区切りの数を数え終わるまで使わない（同じ種なら毎回同じに動く）。
//  できたら道（nav）を返す。まだなら null。o.used に使った区切りの数
export function navStep(ww, bd, n, o, M) {
  const P = M.prog || (M.prog = new Map());
  const st = P.get(bd.id);
  ww._inav = ww._inav || new Map();
  if (st === true) { if (o) o.used = 0; return ww._inav.get(bd.id); }
  const cached = ww._inav.get(bd.id);
  if (cached) {
    const c = st || 0, give = Math.max(0, Math.min(n, cached.units - c));
    if (o) o.used = give;
    if (c + give >= cached.units) { P.set(bd.id, true); return cached; }
    P.set(bd.id, c + give); return null;
  }
  const J = M.jobs || (M.jobs = new Map());
  let job = J.get(bd.id); if (!job) { job = newJob(ww, bd); J.set(bd.id, job); }
  let k = 0;
  while (!job.done && k < n) { step1(job); k++; }
  if (o) o.used = k;
  if (job.done) { J.delete(bd.id); P.set(bd.id, true); return job.nav; }
  return null;
}
// この試合で使えるようになっている
export function navReady(M, bd) { return !!(M.prog && M.prog.get(bd.id) === true); }
function newJob(ww, bd) { return { it: build(ww, bd), done: false, nav: null, n: 0 }; }
function step1(job) {
  job.n++;
  const r = job.it.next();
  if (r.done) { job.done = true; job.nav = r.value; if (!job.nav.units) job.nav.units = job.n; }
}
// 作る本体（ジェネレーター: 何マスかごとに yield して、続きは次の呼び出しで）
function* build(ww, bd) {
  const [x0, z0, x1, z1] = bd.rect, W = Math.max(1, Math.round((x1 - x0) / IS)), D = Math.max(1, Math.round((z1 - z0) / IS));
  // 高さ: 1 階・床の上面・階段の上と下（近い物はまとめる）
  const hs = [bd.y];
  for (const b of ww.boxes) if (b.bld === bd.id && b.kind === 'floor' && b.alive) hs.push(b.y1);
  const stairs = ww.ramps.filter(r => r.bld === bd.id && r.kind === 'stair' && !r.dead);
  for (const r of stairs) hs.push(r.y0, r.y1);
  hs.sort((a, b) => a - b);
  const lv = []; for (const h of hs) if (!lv.length || h - lv[lv.length - 1] > 0.3) lv.push(h);
  const L = lv.length, NC = W * D, open = new Uint8Array(L * NC);
  const cx = (i) => x0 + (i + 0.5) * (x1 - x0) / W, cz = (j) => z0 + (j + 0.5) * (z1 - z0) / D;
  let tick = 0;
  for (let l = 0; l < L; l++) {
    const F = lv[l];
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      if ((++tick & 31) === 0) yield;
      const x = cx(i), z = cz(j), g = groundAt(ww, x, z, F + 0.25);
      if (!(Math.abs(g - F) < 0.22)) continue;
      if (ceilAt(ww, x, z, g) - g < 1.85) continue;
      pushOut(ww, x, z, g, g + 1.7, 0.28, _po); if (_po[2]) continue;
      open[l * NC + j * W + i] = 1;
    }
  }
  const cellAt = (l, x, z) => { const i = Math.floor((x - x0) / (x1 - x0) * W), j = Math.floor((z - z0) / (z1 - z0) * D); return i < 0 || j < 0 || i >= W || j >= D ? -1 : l * NC + j * W + i; };
  const nearOpen = (l, x, z, r = 3) => {
    const i0 = Math.floor((x - x0) / (x1 - x0) * W), j0 = Math.floor((z - z0) / (z1 - z0) * D);
    for (let s = 0; s <= r; s++) for (let dj = -s; dj <= s; dj++) for (let di = -s; di <= s; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== s) continue;
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= W || j >= D) continue;
      const k = l * NC + j * W + i; if (open[k]) return k;
    }
    return -1;
  };
  const lvOf = (y) => { let best = -1, bd2 = 0.3; for (let l = 0; l < L; l++) { const d = Math.abs(lv[l] - y); if (d < bd2) { bd2 = d; best = l; } } return best; };
  // 階段のつながり
  const links = new Map();
  const link = (a, b, cost, pts) => { if (!links.has(a)) links.set(a, []); links.get(a).push({ to: b, cost, pts }); };
  for (const r of stairs) {
    const [fx, fz] = UP[r.dir] || [0, 1], ccx = (r.x0 + r.x1) / 2, ccz = (r.z0 + r.z1) / 2;
    const lo = fz ? [ccx, fz > 0 ? r.z0 : r.z1] : [fx > 0 ? r.x0 : r.x1, ccz], hi = fz ? [ccx, fz > 0 ? r.z1 : r.z0] : [fx > 0 ? r.x1 : r.x0, ccz];
    const l0 = lvOf(r.y0), l1 = lvOf(r.y1); if (l0 < 0 || l1 < 0 || l0 === l1) continue;
    const a = nearOpen(l0, lo[0] - fx * 0.4, lo[1] - fz * 0.4, 2), b = nearOpen(l1, hi[0] + fx * 0.4, hi[1] + fz * 0.4, 2);
    if (a < 0 || b < 0) continue;
    const len = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], r.y1 - r.y0) + 1;
    link(a, b, len, [[lo[0] - fx * 0.15, lo[1] - fz * 0.15], [hi[0] + fx * 0.15, hi[1] + fz * 0.15]]);
    link(b, a, len, [[hi[0] + fx * 0.15, hi[1] + fz * 0.15], [lo[0] - fx * 0.15, lo[1] - fz * 0.15]]);
  }
  // 壁ぎわのマスの外向き（いちばん近い辺）
  const edgeN = (x, z) => { const d = [x - x0, x1 - x, z - z0, z1 - z], m = Math.min(...d), k = d.indexOf(m); return { d: m, n: k === 0 ? [-1, 0] : k === 1 ? [1, 0] : k === 2 ? [0, -1] : [0, 1] }; };
  // 出入り口（いちばん下の高さ）
  const exits = [], l0 = lvOf(bd.y) >= 0 ? lvOf(bd.y) : 0, F0 = lv[l0];
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const k = l0 * NC + j * W + i; if (!open[k]) continue;
    if ((++tick & 15) === 0) yield;
    const x = cx(i), z = cz(j), e = edgeN(x, z); if (e.d > 0.8) continue;
    const ox = x + e.n[0] * (e.d + 0.7), oz = z + e.n[1] * (e.d + 0.7), g = groundAt(ww, ox, oz, F0 + 0.4);
    if (!(Math.abs(g - F0) < 0.45)) continue;
    pushOut(ww, ox, oz, g, g + 1.7, 0.3, _po); if (_po[2]) continue;
    const mx = x + e.n[0] * e.d, mz = z + e.n[1] * e.d; pushOut(ww, mx, mz, F0, F0 + 1.7, 0.24, _po); if (_po[2]) continue;
    exits.push({ k, x: ox, z: oz, ix: x, iz: z });
  }
  // 出入り口から歩いて行けないマス（上れない屋根の上・閉じた小部屋）は使わない（そこの窓を選ぶと着けない）
  {
    const reach = new Uint8Array(L * NC), q = [];
    for (const e of exits) if (!reach[e.k]) { reach[e.k] = 1; q.push(e.k); }
    while (q.length) {
      const k = q.pop(), l = Math.floor(k / NC), c = k % NC, i = c % W, j = (c - i) / W;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= D) continue;
        const n = l * NC + jj * W + ii; if (!open[n] || reach[n]) continue;
        if (di && dj && (!open[l * NC + j * W + ii] || !open[l * NC + jj * W + i])) continue;
        reach[n] = 1; q.push(n);
      }
      const ls = links.get(k); if (ls) for (const e of ls) if (!reach[e.to]) { reach[e.to] = 1; q.push(e.to); }
    }
    for (let k = 0; k < open.length; k++) if (open[k] && !reach[k]) open[k] = 0;
  }
  // 窓（どの高さでも）: 目の高さで外へ見通せて、腰の高さに壁がある
  const wins = [];
  for (let l = 0; l < L; l++) {
    const F = lv[l];
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const k = l * NC + j * W + i; if (!open[k]) continue;
      const x = cx(i), z = cz(j), e = edgeN(x, z); if (e.d > 0.8) continue;
      if ((++tick & 15) === 0) yield;
      const reach = e.d + 0.5;
      const eye = raycast(ww, x, F + 1.45, z, e.n[0], 0, e.n[1], reach, { out: _rh });
      let clear = true; for (const h of eye) if (h.t0 < reach && !(h.kind === 'box' && h.mat === M.GLASS)) { clear = false; break; }
      if (!clear) continue;
      const low = raycast(ww, x, F + 0.5, z, e.n[0], 0, e.n[1], reach, { out: _rh });
      if (!low.some(h => h.t0 < reach)) continue; // 戸口（腰の高さも抜ける）
      wins.push({ k, l, x, z, y: F, n: e.n });
    }
  }
  const nav = { bd, x0, z0, x1, z1, W, D, L, NC, lv, open, links, exits, wins, cellAt, nearOpen, lvOf, cx, cz,
    g: new Float32Array(L * NC), from: new Int32Array(L * NC), via: new Int32Array(L * NC), seen: new Uint32Array(L * NC), closed: new Uint32Array(L * NC), gen: 1 };
  ww._inav = ww._inav || new Map();
  // 別の試合が先に作り終えていたら、そちらを使う（中身は同じ）
  const had = ww._inav.get(bd.id); if (had) return had;
  ww._inav.set(bd.id, nav);
  return nav;
}
// 建物の中の点 (x, y, z) のマス（いちばん近い高さの、近い立てるマス）
export function cellOf(nav, x, y, z) {
  const l = nav.lvOf(y) >= 0 ? nav.lvOf(y) : (() => { let b = 0, bd = 1e9; for (let i = 0; i < nav.L; i++) { const d = Math.abs(nav.lv[i] - y); if (d < bd) { bd = d; b = i; } } return b; })();
  return nav.nearOpen(l, x, z, 4);
}
const ptOf = (nav, k) => { const c = k % nav.NC, i = c % nav.W, j = (c - i) / nav.W; return [nav.cx(i), nav.cz(j)]; };
// 建物の中の A*（同じ高さは 8 方向・階段はつながり）。戻り値: 点の列 [[x, z, 1], ...]（1 = 中の点: 曲がり角で近くまで寄る）。届かなければ null
export function findInPath(nav, s, t, max = 6000) {
  if (s < 0 || t < 0) return null;
  const { W, NC, open, links, g, from, via, seen, closed } = nav;
  const gen = ++nav.gen;
  const tl = Math.floor(t / NC), tc = t % NC, ti = tc % W, tj = (tc - ti) / W;
  const hOf = (k) => { const l = Math.floor(k / NC), c = k % NC, i = c % W, j = (c - i) / W; return (Math.hypot(i - ti, j - tj) + Math.abs(l - tl) * 6) * IS; };
  seen[s] = gen; g[s] = 0; from[s] = -1; via[s] = -1;
  let exp = 0;
  // 二分ヒープ（大きい建物は数千マス。線形の取り出しだと 1 回 8ms かかった）
  const hk = _hk, hf = _hf; let hn = 0;
  const push = (k, fv) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= fv) break; hk[i] = hk[p]; hf[i] = hf[p]; i = p; } hk[i] = k; hf[i] = fv; };
  const pop = () => { const k = hk[0], lk = hk[--hn], lf = hf[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hk[i] = hk[c]; hf[i] = hf[c]; i = c; } hk[i] = lk; hf[i] = lf; return k; };
  push(s, hOf(s));
  while (hn && exp < max && hn < HMAX - 16) {
    const k = pop();
    if (closed[k] === gen) continue; closed[k] = gen; exp++;
    if (k === t) break;
    const l = Math.floor(k / NC), c = k % NC, i = c % W, j = (c - i) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= nav.D) continue;
      const q = l * NC + jj * W + ii; if (!open[q] || closed[q] === gen) continue;
      if (di && dj && (!open[l * NC + j * W + ii] || !open[l * NC + jj * W + i])) continue;
      const ng = g[k] + (di && dj ? SQ2 : 1) * IS;
      if (seen[q] === gen && ng >= g[q]) continue;
      seen[q] = gen; g[q] = ng; from[q] = k; via[q] = -1; push(q, ng + hOf(q));
    }
    const ls = links.get(k);
    if (ls) for (let li = 0; li < ls.length; li++) {
      const e = ls[li], q = e.to; if (closed[q] === gen) continue;
      const ng = g[k] + e.cost;
      if (seen[q] === gen && ng >= g[q]) continue;
      seen[q] = gen; g[q] = ng; from[q] = k; via[q] = li; push(q, ng + hOf(q));
    }
  }
  if (closed[t] !== gen) return null;
  const cells = []; for (let k = t; k >= 0 && cells.length < 4000; k = from[k]) cells.push(k);
  cells.reverse();
  // 点の列: 同じ高さで見通せる間は飛ばす。階段はその両端の点
  const pts = [];
  let a = 0;
  while (a < cells.length - 1) {
    const nx = cells[a + 1];
    if (Math.floor(nx / NC) !== Math.floor(cells[a] / NC)) {
      const e = links.get(cells[a])[via[nx]]; for (const p of e.pts) pts.push([p[0], p[1], 1]);
      a++; continue;
    }
    let b = a + 1;
    while (b + 1 < cells.length && Math.floor(cells[b + 1] / NC) === Math.floor(cells[a] / NC) && lineIn(nav, cells[a], cells[b + 1])) b++;
    const p = ptOf(nav, cells[b]); pts.push([p[0], p[1], 1]);
    a = b;
  }
  if (!pts.length) { const p = ptOf(nav, t); pts.push([p[0], p[1], 1]); }
  return pts;
}
function lineIn(nav, a, b) {
  const { W, NC, open } = nav, l = Math.floor(a / NC);
  const ca = a % NC, cb = b % NC;
  let x0 = ca % W, y0 = (ca - x0) / W; const x1 = cb % W, y1 = (cb - x1) / W;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, guard = 0;
  while (guard++ < 200) {
    if (!open[l * NC + y0 * W + x0]) return false;
    // 太さ: 斜めに進む時は両脇も空いていること
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return false;
}
