// 11-26: 大規模戦の窓ガラス。外壁の窓にある・透けて見える・弾で割れて弾は通る・爆発で割れる・乗り越えで割る・元に戻せる
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { los } from '../../src/war/world.js';
import { shatter, shatterNear, restoreWorld } from '../../src/war/destruct.js';

function game() { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); }
const panes = (w) => w.boxes.filter(b => b.kind === 'glass');

test('外壁の窓にガラスがあり、透けて見える（見通しはふさがない）', () => {
  const G = game(), P = panes(G.w);
  ok(P.length > 50, 'ガラスの数 ' + P.length);
  const b = P[0], cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
  const thinX = b.x1 - b.x0 < b.z1 - b.z0;
  const [ax, az, bx, bz] = thinX ? [cx - 2, cz, cx + 2, cz] : [cx, cz - 2, cx, cz + 2];
  ok(los(G.w, ax, cy, az, bx, cy, bz), 'ガラスごしに見える');
  ok(!b.opaque && b.alive, '透ける');
});
test('割る・爆発で割れる・元に戻す', () => {
  const G = game(), P = panes(G.w), b = P[1], ev = [];
  ok(shatter(G.S, G.w, b, ev), '割れた');
  ok(!b.alive && ev.some(e => e.e === 'wglass' && e.id === b.id), '知らせ');
  ok(!shatter(G.S, G.w, b, ev), '二度は割れない');
  const c = P[2], n = shatterNear(G.S, G.w, (c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2, 2.5, ev);
  ok(n >= 1 && !c.alive, '近くの爆発で割れた ' + n);
  restoreWorld(G.w);
  ok(b.alive && c.alive, '元に戻る');
});
test('弾が当たると割れて、弾はそのまま通る', async () => {
  const { stepBullets } = await import('../../src/engine/combat.js');
  const G = game(), S = G.S, w = G.w, b = panes(w)[3];
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2, thinX = b.x1 - b.x0 < b.z1 - b.z0;
  const dx = thinX ? 1 : 0, dz = thinX ? 0 : 1;
  const me = S.actors[0];
  S.bullets.push({ x: cx - dx * 1.5, y: cy, z: cz - dz * 1.5, vx: dx * 800, vy: 0, vz: dz * 800, pen: 700, pen0: 700, k: 1, owner: me.id, team: me.team, wid: 'm4a1', cal: '556', am: 'fmj', t: 0, dist: 0, pellet: false, tr: false, lag: 0, skip: me.id, less: false });
  const ev = []; for (let i = 0; i < 3; i++) ev.push(...step(G, {}));
  ok(!b.alive, 'ガラスが割れた');
  ok(ev.some(e => e.e === 'wglass'), '知らせ');
});
test('殴る・大ハンマーで割れる', async () => {
  const G = game(), S = G.S, w = G.w, me = S.actors[0];
  for (const [label, act] of [['殴る', { a: 'melee' }], ['大ハンマー', null]]) {
    const b = panes(w).find(q => q.alive && q.y0 - 0 < 1e9 && !q._used); b._used = true;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2, thinX = b.x1 - b.x0 < b.z1 - b.z0;
    // ガラスの前 0.8m・目の高さがガラスのまん中
    me.x = cx - (thinX ? 0.8 : 0); me.z = cz - (thinX ? 0 : 0.8); me.y = cy - 1.55; me.vy = 0;
    me.yaw = Math.atan2(cx - me.x, cz - me.z); me.pitch = 0;
    const evs = [];
    if (act) { for (let i = 0; i < 40 && b.alive; i++) { me.x = cx - (thinX ? 0.8 : 0); me.z = cz - (thinX ? 0 : 0.8); me.y = cy - 1.55; me.vy = 0; evs.push(...step(G, { [me.id]: { mx: 0, mz: 0, yaw: me.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: i === 0 ? [act] : null } })); } }
    else {
      const { hammerHitForTest } = await import('../../src/engine/interact.js');
      if (hammerHitForTest) hammerHitForTest(S, w, me, evs);
    }
    ok(!b.alive, label + 'で割れた');
  }
});
