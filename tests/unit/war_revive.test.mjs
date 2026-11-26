// 11-26: 大規模戦で人が倒れた味方を起こす（本家: どの兵科も包帯 1 つで起こす・衛生は 2 倍速・起きると体力は約半分）
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { pvpDamage } from '../../src/engine/combat.js';
import { heightAt } from '../../src/war/world.js';
import { WAR_DOWN_T } from '../../src/engine/status.js';
import { personPoint } from '../../src/engine/interact.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function setup(cls) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const mate = S.actors.find(b => b !== me && b.team === me.team && b.ai);
  for (const b of S.actors) if (b !== me && b !== mate) { b.alive = false; b.dead = true; }
  mate.ai = null;
  if (cls) me.warCls = cls;
  // 平らな所に並べる（味方の 1.2m 前に立つ）
  const x = 790, z = 705, y = heightAt(G.w, x, z);
  Object.assign(me, { x, y, z, vx: 0, vz: 0, yaw: 0 }); Object.assign(mate, { x, y, z: z + 1.2, vx: 0, vz: 0 });
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  pvpDamage(S, mate, mate.hp + 5, null, 'chest', 0, 1, [], 'bullet');
  ok(mate.down && mate.alive, 'ダウンした');
  // 倒れきるまで（約 1 秒）。倒れた胴の 1.2m 手前に立つ
  for (let i = 0; i < 60; i++) step(G, { [me.id]: idle(me) });
  const tp = personPoint(S, mate);
  Object.assign(me, { z: tp[2] - 1.2, x: tp[0] });
  return { G, S, me, mate };
}
const band = (a) => (a.inv.gear.find(g => g.id === 'bandage') || { n: 0 }).n;

test('包帯を1つ使って起こす（突撃は 4 秒）。起きると体力は半分', () => {
  const { G, S, me, mate } = setup('assault');
  const n0 = band(me), ev = [];
  ev.push(...step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'revive' }] }) }));
  ok(me.act && me.act.k === 'revive', '起こし始めた ' + JSON.stringify(ev.filter(e => e.e === 'deny')));
  let t = 0;
  while (mate.down && t < 6 / S.dt) { ev.push(...step(G, { [me.id]: idle(me) })); t++; }
  ok(!mate.down && mate.alive, '起きた');
  ok(Math.abs(t * S.dt - 4) < 0.4, '約 4 秒 ' + (t * S.dt).toFixed(2));
  eq(mate.hp, Math.round(mate.maxHp * 0.5), '体力は半分');
  eq(band(me), n0 - 1, '包帯が1つ減った');
  ok(ev.some(e => e.e === 'revive' && e.by === me.id), '起こした出来事');
});

test('衛生は 2 倍速（2 秒）', () => {
  const { G, S, me, mate } = setup('medic');
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'revive' }] }) });
  let t = 0;
  while (mate.down && t < 6 / S.dt) { step(G, { [me.id]: idle(me) }); t++; }
  ok(!mate.down, '起きた');
  ok(Math.abs(t * S.dt - 2) < 0.3, '約 2 秒 ' + (t * S.dt).toFixed(2));
});

test('倒れていられるのは 30 秒。起こしている間は減らない', () => {
  eq(WAR_DOWN_T, 30);
  const { G, S, me, mate } = setup('assault');
  for (let i = 0; i < Math.round(19 / S.dt); i++) step(G, { [me.id]: idle(me) });
  ok(mate.alive && mate.down, '20 秒ではまだ倒れたまま');
  const d0 = mate.dbno;
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'revive' }] }) });
  for (let i = 0; i < Math.round(2 / S.dt); i++) step(G, { [me.id]: idle(me) });
  ok(mate.dbno >= d0 - 0.1, '起こしている間は減らない ' + d0.toFixed(2) + ' → ' + mate.dbno.toFixed(2));
});

test('起こさなければ約 30 秒で死ぬ', () => {
  const { G, S, mate, me } = setup('assault');
  let t = 0;
  while (mate.alive && t < 40 / S.dt) { step(G, { [me.id]: idle(me) }); t++; }
  ok(!mate.alive, '死んだ');
  ok(Math.abs(t * S.dt + 1 - 30) < 1, '約 30 秒 ' + (t * S.dt + 1).toFixed(1));
});

test('包帯がなければ起こせない', () => {
  const { G, me, mate } = setup('assault');
  me.inv.gear.find(g => g.id === 'bandage').n = 0;
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'revive' }] }) });
  ok(!me.act, '始まらない');
});

test('倒れている間は見回しても体は回らない（頭＝目が大きく動いて壁に入らない）', () => {
  const { G, S, me, mate } = setup('assault');
  const y0 = mate.yaw, x0 = mate.x, z0 = mate.z;
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me), [mate.id]: idle(mate, { yaw: y0 + 2.5 + i * 0.05 }) });
  ok(mate.down, '倒れたまま');
  ok(Math.abs(mate.yaw - y0) < 1e-6, '向きはそのまま ' + mate.yaw.toFixed(3) + ' / ' + y0.toFixed(3));
  ok(Math.hypot(mate.x - x0, mate.z - z0) < 0.05, '動かない');
});
