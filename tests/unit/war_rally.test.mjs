// 集合地点: 分隊長が分隊ポイント 200 で置く・分隊はそこから出撃・敵の弾数発・爆発で壊れ、30 秒は置けない
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { RALLY, rallyOf } from '../../src/engine/rally.js';
import { placeRally } from '../../src/engine/modes/war.js';
import { heightAt } from '../../src/war/world.js';

function game(o = {}) { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); step(G, {}); return G; }
const put = (G, b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);

test('置く: 分隊ポイントが 200 ないと置けない・置くと 200 減る・分隊長でないと置けない', () => {
  const G = game({ bots: true, per: 4 }), S = G.S, me = S.actors[0], key = me.team + ':' + me.squad;
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  const ev = [];
  ok(!placeRally(S, G.w, me, ev), 'ポイントが足りない');
  ok(ev.some(e => e.e === 'rally' && e.k === 'no' && e.why === 'pts'), '理由');
  S.m.sqp = { [key]: 250 };
  const r = placeRally(S, G.w, me, []);
  ok(r && rallyOf(S, me.team, me.squad) === r, '置けた');
  eq(S.m.sqp[key], 50, '200 減る');
  ok(Math.abs(r.y - heightAt(G.w, r.x, r.z)) < 0.5, '地面の上');
  const m2 = S.actors.find(b => b.team === me.team && b.squad === me.squad && b.sqIdx === 1);
  S.m.sqp[key] = 900;
  ok(!placeRally(S, G.w, m2, []), '分隊長でないと置けない');
  // 置き直すと前の物は消える（分隊に1つ）
  put(G, me, me.x + 20, me.z);
  const r2 = placeRally(S, G.w, me, []);
  eq(S.rallies.filter(q => q.team === me.team && q.sq === me.squad).length, 1, '分隊に1つ');
  ok(rallyOf(S, me.team, me.squad) === r2, '新しい物');
});

test('出撃: 人は集合地点を選ぶとそのまわりに出る', () => {
  const G = game({ bots: true, per: 4 }), S = G.S, me = S.actors[0], key = me.team + ':' + me.squad;
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  const f = S.m.flags[2];
  put(G, me, f.x + 40, f.z + 10);
  S.m.sqp = { [key]: 200 };
  const r = placeRally(S, G.w, me, []);
  ok(r, '置けた');
  // 自分が倒れて、集合地点から出る
  me.hp = 0; me.alive = false; me.dead = true; S.m.respawn.push({ id: me.id, at: S.t + 1 });
  step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'rally', cls: me.warCls }] }) });
  for (let i = 0; i < 5 && !me.alive; i++) step(G, {});
  ok(me.alive, '出撃した');
  const d = Math.hypot(me.x - r.x, me.z - r.z);
  ok(d < 3.5, '集合地点のまわり ' + d.toFixed(1));
});

test('壊れる: 敵の弾 3〜4 発・爆発で壊れ、30 秒は置けない。味方の弾では壊れない', async () => {
  const { hitRally, blastRallies } = await import('../../src/engine/rally.js');
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0], key = me.team + ':' + me.squad;
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  const foe = S.actors.find(b => b.team !== me.team);
  S.m.sqp = { [key]: 600 };
  const r = placeRally(S, G.w, me, []);
  hitRally(S, r, RALLY.bullet, me.id, []);
  eq(r.hp, RALLY.hp, '味方の弾では減らない');
  let n = 0; const ev = [];
  while (r.hp > 0 && n < 10) { hitRally(S, r, RALLY.bullet, foe.id, ev); n++; }
  ok(n >= 3 && n <= 4, '3〜4 発 ' + n);
  ok(!rallyOf(S, me.team, me.squad), 'なくなった');
  ok(ev.some(e => e.e === 'rally' && e.k === 'gone'), '壊れた出来事');
  const ev2 = [];
  ok(!placeRally(S, G.w, me, ev2), 'すぐは置けない');
  ok(ev2.some(e => e.why === 'cool'), '理由は待ち');
  S.m.rallyCd[key] = S.t - 1;
  const r2 = placeRally(S, G.w, me, []);
  ok(r2, '時間が過ぎれば置ける');
  blastRallies(S, r2.x + 1, r2.y + 0.5, r2.z, 3, foe.id, []);
  ok(!rallyOf(S, me.team, me.squad), '爆発で壊れる');
});

test('撃つ: 敵の弾が当たると集合地点で止まって壊れていく', async () => {
  const { fireBullet } = await import('../../src/engine/combat.js').catch(() => ({}));
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0], key = me.team + ':' + me.squad;
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  const foe = S.actors.find(b => b.team !== me.team);
  S.m.sqp = { [key]: 200 };
  const r = placeRally(S, G.w, me, []);
  // 敵の弾を集合地点へまっすぐ飛ばす（弾の形は engine と同じ）
  const sx = r.x - 10, sy = r.y + RALLY.cy, sz = r.z;
  S.bullets.push({ x: sx, y: sy, z: sz, vx: 700, vy: 0, vz: 0, t: 0, dist: 0, owner: foe.id, team: foe.team, pen: 100, pen0: 100, k: 1, cal: '556', am: 'fmj', wid: 'm4a1', skip: foe.id });
  const hp0 = r.hp;
  for (let i = 0; i < 3; i++) step(G, { [me.id]: idle(me) });
  ok(r.hp < hp0, '当たって減る ' + r.hp);
});

test('ボットの分隊長: 分隊ポイントがたまると、目標の手前に集合地点を置く', () => {
  const G = game({ bots: true, per: 8 }), S = G.S;
  for (let i = 0; i < 30; i++) step(G, {});
  const L = S.actors.find(a => a.ai && a.sqIdx === 0 && a.team === 1);
  const key = L.team + ':' + L.squad;
  S.m.sqp = { [key]: 400 };
  let placed = null;
  for (let i = 0; i < 30 * 90 && !placed; i++) { step(G, {}); placed = (S.rallies || []).find(r => r.team === L.team && r.sq === L.squad); }
  ok(placed, '置いた');
  eq(S.m.sqp[key], 200, '200 使った');
});
