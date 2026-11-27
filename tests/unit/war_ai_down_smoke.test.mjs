// 11-27 20:22「ダウン中の AI 全く動かない。賢く戦況に合わせて蘇生しやすい位置に移動するなど」
//  「AI のスモークグレネードの使い方、使うタイミングをもっと賢く。むやみに使いすぎかも」
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { pvpDamage } from '../../src/engine/combat.js';
import { heightAt } from '../../src/war/world.js';
import { matchMem } from '../../src/war/ai.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function downedBot(d) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 4 });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const B = S.actors.find(b => b !== me && b.team === me.team && b.ai && b.alive);
  for (const b of S.actors) if (b !== me && b !== B) { b.alive = false; b.dead = true; }
  const x = 790, z = 705;
  Object.assign(me, { x, y: heightAt(G.w, x, z), z, vx: 0, vz: 0, yaw: 0 });
  const bx = x + d, bz = z;
  Object.assign(B, { x: bx, y: heightAt(G.w, bx, bz), z: bz, vx: 0, vz: 0 });
  for (let i = 0; i < 10; i++) step(G, { [me.id]: idle(me) });
  pvpDamage(S, B, B.hp + 5, null, 'chest', 0, 1, [], 'bullet');
  return { G, S, me, B };
}

test('倒れたボット: 敵が見えていなければ、近くの味方の方へ這って寄る', () => {
  const { G, S, me, B } = downedBot(18);
  ok(B.down && B.alive, '倒れた');
  const d0 = Math.hypot(B.x - me.x, B.z - me.z);
  for (let i = 0; i < Math.round(12 / S.dt); i++) step(G, { [me.id]: idle(me) });
  const d1 = Math.hypot(B.x - me.x, B.z - me.z);
  ok(B.down && d1 < d0 - 1, '味方へ寄った ' + d0.toFixed(1) + ' → ' + d1.toFixed(1));
  ok(d1 > 2.5, '味方のすぐ横までは来ない（起こす人が来る）');
});

test('倒れたボット: 起こしに来る味方がすぐそばにいれば動かない', () => {
  const { G, S, me, B } = downedBot(18);
  const H = S.actors.find(b => b !== me && b !== B && b.team === me.team && b.ai);
  Object.assign(H, { alive: true, dead: false, down: false, hp: H.maxHp, x: B.x + 4, z: B.z, y: heightAt(G.w, B.x + 4, B.z) });
  H.ai.reviving = B.id;
  const x0 = B.x, z0 = B.z;
  for (let i = 0; i < Math.round(1.0 / S.dt); i++) step(G, { [me.id]: idle(me) });
  ok(Math.hypot(B.x - x0, B.z - z0) < 0.3, '動かない ' + Math.hypot(B.x - x0, B.z - z0).toFixed(2));
});

test('発煙弾: 理由（起こしに行く・離れた遮蔽物へ移る）がある時だけ。1 人 60 秒・分隊 25 秒あける・数が多すぎない', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 7, bots: true });
  const S = G.S, seen = new Map(), L = [];
  for (let i = 0; i < Math.round(240 / S.dt); i++) {
    step(G, {});
    for (const n of S.nades || []) if (n.type === 'smoke' && !seen.has(n.id)) { seen.set(n.id, 1); const a = S.byId[n.by]; L.push({ t: S.t * S.dt, by: n.by, sq: a ? a.team + ':' + a.squad : '' }); }
  }
  const why = matchMem(S).smokeWhy || {}, nWhy = Object.values(why).reduce((s, v) => s + v, 0);
  const bots = L.filter(x => S.byId[x.by] && S.byId[x.by].ai);
  ok(nWhy === bots.length, 'どれも理由がある ' + JSON.stringify(why) + ' / ' + bots.length);
  for (const x of bots) {
    const same = bots.filter(y => y !== x && y.by === x.by && y.t > x.t);
    ok(!same.some(y => y.t - x.t < 59.5), '同じ人は 60 秒あける');
    const sq = bots.filter(y => y !== x && y.sq === x.sq && y.t > x.t);
    ok(!sq.some(y => y.t - x.t < 24.5), '同じ分隊は 25 秒あける');
  }
  const per = bots.length / 4 / (S.actors.length / 32);
  ok(per <= 3, '32 人あたり 1 分に 3 回まで（' + per.toFixed(1) + '）');
});
