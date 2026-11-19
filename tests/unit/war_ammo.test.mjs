// 弾薬箱: 援護は大きい ×2・突撃は小さい ×1。置くと、近くに立った味方（人）に弾倉を補給。中身が尽きると消える。置いた人に点
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { curWeapon, magCap } from '../../src/engine/actor.js';
import { AMMOBOX } from '../../src/engine/ammobox.js';
import { classLoadout } from '../../src/war/classes.js';

function game() { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); step(G, {}); return G; }
const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);

test('兵科: 援護は大きい弾薬箱 2・突撃は小さい弾薬箱 1', () => {
  const s = classLoadout('support'), a = classLoadout('assault');
  ok(s.gear.some(g => g[0] === 'ammobig' && g[1] === 2), '援護');
  ok(a.gear.some(g => g[0] === 'ammosmall' && g[1] === 1), '突撃');
});

test('置く: 手に持って引き金で足もとの前に置く。近くに立つと弾倉が戻り、箱の中身が減る', () => {
  const G = game(), S = G.S, me = S.actors[0];
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  me.inv.gear.push({ id: 'ammobig', n: 2 });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'ammobig' }] }) });
  for (let i = 0; i < 120 && me.ws.st !== 'gear'; i++) step(G, { [me.id]: idle(me) });
  eq(me.ws.st, 'gear', '持った');
  step(G, { [me.id]: idle(me, { fire: true }) });
  ok(S.ammo && S.ammo.length === 1, '置いた');
  const b = S.ammo[0];
  ok(Math.hypot(b.x - me.x, b.z - me.z) < 1, '足もとの前');
  eq(me.inv.gear.find(g => g.id === 'ammobig').n, 1, '1つ減る');
  const wi = curWeapon(me) || me.inv.w[0];
  const w0 = me.inv.w[0];
  w0.mags.splice(0, 3);
  const n0 = w0.mags.length, left0 = b.left;
  for (let i = 0; i < Math.round(3 / S.dt); i++) step(G, { [me.id]: idle(me) });
  ok(w0.mags.length > n0, '弾倉が戻る ' + n0 + ' → ' + w0.mags.length);
  ok(b.left < left0, '箱の中身が減る ' + b.left);
});

test('中身が尽きると消える・遠いと補給しない', () => {
  const G = game(), S = G.S, me = S.actors[0];
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  const w0 = me.inv.w[0];
  S.ammo = [{ id: 1, team: me.team, big: false, left: 20, x: me.x + 6, y: me.y, z: me.z, yaw: 0, t: S.t, by: me.id }];
  w0.mags.splice(0, 2);
  const n0 = w0.mags.length;
  for (let i = 0; i < 90; i++) step(G, { [me.id]: idle(me) });
  eq(w0.mags.length, n0, '6m は遠い');
  S.ammo[0].x = me.x + 1;
  for (let i = 0; i < 180; i++) step(G, { [me.id]: idle(me) });
  ok(w0.mags.length === n0 + 1 && w0.mags.includes(20), '残りの 20 発だけ ' + w0.mags.join(','));
  eq(S.ammo.length, 0, '尽きて消えた');
});

test('ボットの援護: 近くの仲間の人の予備が2本以下だと弾薬箱を置く', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 4 }); step(G, {});
  const S = G.S, me = S.actors[0];
  const b = S.actors.find(a => a.ai && a.team === me.team);
  b.inv.gear.push({ id: 'ammobig', n: 2 });
  for (let i = 0; i < 30; i++) step(G, {});
  me.inv.w[0].mags.splice(0, me.inv.w[0].mags.length - 1);
  let placed = false;
  for (let i = 0; i < 200 && !placed; i++) { b.x = me.x + 3; b.z = me.z; b.y = me.y; b.ai.tgt = null; step(G, {}); placed = (S.ammo || []).some(x => x.by === b.id); }
  ok(placed, '置いた');
});

test('大きい弾薬箱は包帯と投げ物も補給する（出撃した時の数まで・4 秒に1つ）', () => {
  const G = game(), S = G.S, me = S.actors[0];
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  const ban = me.inv.gear.find(g => g.id === 'bandage'), fr = me.inv.gear.find(g => g.id === 'frag');
  ok(ban && ban.n0 > 0, '出撃した時の数を覚えている');
  ban.n = 0; if (fr) fr.n = 0;
  S.ammo = [{ id: 1, team: me.team, big: true, aid: 100, thr: 50, left: 244, x: me.x + 1, y: me.y, z: me.z, yaw: 0, t: S.t, by: me.id }];
  for (let i = 0; i < Math.round(9 / S.dt); i++) step(G, { [me.id]: idle(me) });
  ok(ban.n >= 2, '包帯 ' + ban.n);
  ok(ban.n <= ban.n0, '出撃した時の数まで');
});
