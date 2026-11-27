// ボットが建物に入る（11-27「AI が建物の中に入ってこない。まだまだ人間っぽくない」）
//  - 建物の中の道（inav.js）: 出入り口・窓・階段のつながり
//  - 建物の中に隠れた敵の最後の場所へ、外から出入り口を通って入り（2 階なら階段を上り）、着く
//  - 拠点の近くの建物では、敵の来る方へ向いた窓を見張りの場所に選べる
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { bldNav, bldOf, findInPath, cellOf } from '../../src/war/inav.js';
import { _aiT } from '../../src/war/ai.js';
import { buildWarNav, navCellOf } from '../../src/war/nav.js';

function world(bots) { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots, per: bots ? 2 : 0 }); step(G, {}); return G; }

test('建物の中の道: どの建物にも出入り口があり、窓が見つかり、上の階へ階段でつながる', () => {
  const G = world(false), w = G.w;
  let n = 0, noExit = [], noWin = 0, multi = 0, up = 0, ms = 0; const noReach = [];
  for (const bd of w.blds) {
    if (bd.down) continue;
    const t0 = performance.now(), nav = bldNav(w, bd); ms += performance.now() - t0; n++;
    if (!nav.exits.length) noExit.push(bd.kind + bd.id);
    if (!nav.wins.length) noWin++;
    // 2 階のある建物: 2 階の床（1 階の上 2.5m より高い所）の立てるマスへ、出入り口から行ける
    if (bd.floors > 1 && nav.exits.length) {
      multi++;
      let top = -1; for (let k = nav.open.length - 1; k >= 0 && top < 0; k--) if (nav.open[k] && nav.lv[Math.floor(k / nav.NC)] > bd.y + 2.5) top = k;
      if (top >= 0 && findInPath(nav, nav.exits[0].k, top)) up++;
    }
    // 立てるマスは全部、出入り口から行ける（行けない屋根の上は消してある）
    if (nav.exits.length) for (let l = 0; l < nav.L; l++) { let k = -1; for (let q = nav.NC - 1; q >= 0 && k < 0; q--) if (nav.open[l * nav.NC + q]) k = l * nav.NC + q; if (k >= 0 && !findInPath(nav, nav.exits[0].k, k, 20000)) { noReach.push(bd.kind + bd.id); break; } }
  }
  ok(n > 5, '建物 ' + n);
  ok(noExit.length <= Math.max(1, n * 0.1), '出入り口のない建物 ' + noExit.join(','));
  ok(noWin <= n * 0.3, '窓のない建物 ' + noWin + '/' + n);
  ok(multi > 0 && up >= multi * 0.9, '上の階へ ' + up + '/' + multi);
  ok(noReach.length <= n * 0.05, '行けないマスが残る ' + noReach.slice(0, 5).join(','));
  ok(ms / n < 80, '1 つ作るのに ' + (ms / n).toFixed(1) + 'ms');
});

// 建物の外 10m にボットを置き、建物の中（l: 階）に「見失った敵」がいることにして、入ってそこへ着くか
function enter(G, bd, lvl) {
  const S = G.S, w = G.w, nav = bldNav(w, bd), wnav = buildWarNav(w, S.m.rect);
  const l = Math.min(lvl, nav.L - 1);
  // 中の点: その階の、建物のまん中にいちばん近い立てるマス（なければ下の階）
  let k = -1, ll = l;
  for (; ll >= 0 && k < 0; ll--) k = nav.nearOpen(ll, (nav.x0 + nav.x1) / 2, (nav.z0 + nav.z1) / 2, 30);
  ll++;
  if (k < 0) return null;
  const c = k % nav.NC, i = c % nav.W, j = (c - i) / nav.W, tx = nav.cx(i), tz = nav.cz(j), ty = nav.lv[ll];
  // 外の場所: 出入り口から外へ 10m（通れる所）
  let start = null;
  for (const e of nav.exits) {
    const dx = e.x - e.ix, dz = e.z - e.iz, L = Math.hypot(dx, dz) || 1;
    const sx = e.x + dx / L * 10, sz = e.z + dz / L * 10, q = navCellOf(wnav, sx, sz);
    if (q >= 0 && !wnav.block[q] && !bldOf(w, sx, sz)) { start = [sx, sz]; break; }
  }
  if (!start) return null;
  const bots = S.actors.filter(a => a.ai);
  const bot = bots[0], foe = bots.find(a => a.team !== bot.team);
  // ほかのボットは遠くで止める（見えない・聞こえない）
  for (const a of bots) if (a !== bot) { a.ai.type = 'idle'; Object.assign(a, { x: S.m.rect[a.team ? 2 : 0] + (a.team ? -5 : 5), z: S.m.rect[1] + 5 }); }
  for (const a of S.actors) if (a.pid != null) Object.assign(a, { x: S.m.rect[0] + 8, z: S.m.rect[3] - 8 });
  Object.assign(bot.ai, { path: null, pathTo: null, pi: 0, cov: null, hold: null, bound: null, lane: null, stuckT: 0, clearing: null });
  Object.assign(bot, { x: start[0], z: start[1], vx: 0, vz: 0, vy: 0, alive: true, down: false, dead: false, st: 0 });
  for (let n = 0; n < 5; n++) step(G, {});
  let best = 1e9, inside = false, reached = false;
  const N = Math.round(40 / S.dt);
  for (let n = 0; n < N && !reached; n++) {
    // 見失った敵（最後に見た所が建物の中）を、ずっと新しく保つ
    Object.assign(bot.ai, { tgt: null, tgtPos: [tx, ty, tz], tgtId: foe.id, seenT: S.t - Math.round(2 / S.dt), flank: null });
    bot.hp = bot.maxHp; bot.supp = 0;
    step(G, {});
    if (bldOf(w, bot.x, bot.z) === bd) inside = true;
    const d = Math.hypot(bot.x - tx, bot.z - tz);
    if (Math.abs(bot.y - ty) < 1.2) best = Math.min(best, d);
    if (d < 1.6 && Math.abs(bot.y - ty) < 1.2) reached = true;
  }
  return { inside, reached, best, kind: bd.kind, up: ty > bd.y + 2.5 };
}

test('ボット: 建物の中に隠れた敵の所へ、出入り口から入って着く（1 階・上の階）', () => {
  const G = world(true), w = G.w;
  // 種類ごとに 1 つ（2 階のある家・店・アパート・事務所・平屋・小屋）
  const pick = [], seen = new Set();
  for (const bd of w.blds) { const key = bd.kind + (bd.floors > 1 ? '2' : ''); if (bd.down || seen.has(key) || !['house2', 'shop2', 'apartment2', 'office2', 'bungalow', 'shed', 'house'].includes(key)) continue; seen.add(key); pick.push(bd); }
  let tried = 0, good = 0, upT = 0, upG = 0; const why = [];
  for (const bd of pick) for (const lvl of bd.floors > 1 ? [0, 2] : [0]) {
    const r = enter(G, bd, lvl);
    if (!r) continue;
    if (r.up) upT++; else tried++;
    if (r.reached) { if (r.up) upG++; else good++; } else why.push(`${r.kind}${bd.id} ${r.up ? '上の階' : '1 階'} 中に${r.inside ? '入った' : '入らない'} 残り${r.best.toFixed(1)}m`);
  }
  ok(tried >= 4, '試した建物 ' + tried);
  ok(good >= tried - 1, `1 階 ${good}/${tried} ` + why.join(' | '));
  ok(upT >= 2 && upG >= upT - 1, `上の階 ${upG}/${upT} ` + why.join(' | '));
});

test('拠点の近くの建物では、敵の来る方へ向いた窓を見張りの場所に選べる', () => {
  const G = world(true), S = G.S, w = G.w;
  const bot = S.actors.find(a => a.ai && a.ai.type === 'war');
  const ctx = { nav: buildWarNav(w, S.m.rect), live: [[], []], inavN: 1e9, covers: 9, M: {} };
  S.m.claim = S.m.claim || new Map();
  let found = 0, faced = 0;
  for (const f of S.m.flags) {
    const bl = _aiT.bldsNear(S, w, f); if (!bl.length) continue;
    // 敵の本陣の向き
    const h = S.m.hq[1 - bot.team];
    const wn = _aiT.windowSpot(S, w, bot, ctx, h[0], h[1], { blds: bl, f });
    if (!wn) continue;
    found++;
    const dx = h[0] - wn.x, dz = h[1] - wn.z, d = Math.hypot(dx, dz);
    if ((wn.n[0] * dx + wn.n[1] * dz) / d > 0.3) faced++;
    ok(Math.hypot(wn.x - f.x, wn.z - f.z) <= f.r + 15.01, '拠点の近く');
  }
  ok(found >= 1, '窓のある拠点 ' + found);
  ok(faced === found, '敵の方へ向いた窓 ' + faced + '/' + found);
});
