// 11-27: 倒れた味方を引きずる（BattleBit の F）。引きずる人は遅く（1.4m/s まで）・撃てず・走れない。もう一度押すと離す
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { pvpDamage } from '../../src/engine/combat.js';
import { heightAt } from '../../src/war/world.js';
import { personPoint } from '../../src/engine/interact.js';
import { DRAG } from '../../src/engine/drag.js';
import { poseInput } from '../../src/engine/combat.js';
import { computePose, NBONE } from '../../src/engine/pose.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function setup() {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const mate = S.actors.find(b => b !== me && b.team === me.team && b.ai);
  for (const b of S.actors) if (b !== me && b !== mate) { b.alive = false; b.dead = true; }
  mate.ai = null;
  const x = 790, z = 705, y = heightAt(G.w, x, z);
  Object.assign(me, { x, y, z, vx: 0, vz: 0, yaw: 0 }); Object.assign(mate, { x, y, z: z + 1.2, vx: 0, vz: 0 });
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  pvpDamage(S, mate, mate.hp + 5, null, 'chest', 0, 1, [], 'bullet');
  for (let i = 0; i < 60; i++) step(G, { [me.id]: idle(me) });
  const tp = personPoint(S, mate);
  Object.assign(me, { z: tp[2] - 1.0, x: tp[0] });
  return { G, S, me, mate };
}

test('倒れた味方を引きずると、歩いた方へついて来る。遅い・撃てない・走れない', () => {
  const { G, S, me, mate } = setup();
  ok(mate.down && mate.alive, '倒れた');
  const ev = step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'drag' }] }) });
  eq(me.drag, mate.id, '引きずり始めた ' + JSON.stringify(ev.filter(e => e.e === 'deny')));
  eq(mate.dragBy, me.id);
  // 後ろ（-z）へ 3 秒歩く（向きは倒れた人の方のまま。走るを押しても走らない）
  const z0 = mate.z, mz0 = me.z, shots0 = me.stats.sh;
  let vmax = 0;
  for (let i = 0; i < Math.round(3 / S.dt); i++) { const zb = me.z; step(G, { [me.id]: idle(me, { mz: -1, sprint: true, fire: true }) }); vmax = Math.max(vmax, Math.abs(me.z - zb) / S.dt); }
  ok(vmax <= DRAG.speed + 0.05, '速さ ' + vmax.toFixed(2));
  ok(!me.sprint, '走らない');
  eq(me.stats.sh, shots0, '撃っていない');
  ok(z0 - mate.z > 1.0 && Math.abs((z0 - mate.z) - (mz0 - me.z)) < 1.2, `体がついて来た ${(z0 - mate.z).toFixed(2)}m（歩いたのは ${(mz0 - me.z).toFixed(2)}m）`);
  ok(mate.down && mate.alive, 'まだ倒れている');
  const tp = personPoint(S, mate);
  ok(Math.hypot(tp[0] - me.x, tp[2] - me.z) <= DRAG.len + 0.15, '胴は手の届く所');
  // もう一度押すと離す
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'drag' }] }) });
  ok(me.drag == null && mate.dragBy == null, '離した');
});

test('引きずっている途中で起こせる（起きたら引きずるのは終わる）', () => {
  const { G, S, me, mate } = setup();
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'drag' }] }) });
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me, { mz: -1 }) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'revive' }] }) });
  ok(me.act && me.act.k === 'revive', '起こし始めた');
  for (let i = 0; i < Math.round(6 / S.dt) && mate.down; i++) step(G, { [me.id]: idle(me) });
  ok(!mate.down && mate.alive, '起きた');
  step(G, { [me.id]: idle(me) });
  ok(me.drag == null && mate.dragBy == null, '引きずるのは終わった');
});

test('引きずる人が倒れると離す', () => {
  const { G, S, me, mate } = setup();
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'drag' }] }) });
  pvpDamage(S, me, me.hp + 5, null, 'chest', 0, 1, [], 'bullet');
  step(G, {});
  ok(me.drag == null && mate.dragBy == null, '離した');
});

test('引きずる人の見た目: 左手が倒れた人の胸元へ下りる・銃は下げる（ほかの人の画面にも送る）', async () => {
  const { G, S, me, mate } = setup();
  const B = new Float32Array(NBONE * 12);
  computePose(poseInput(me, {}), B);
  const hand0 = B[7 * 12 + 1] - me.y;
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'drag' }] }) });
  ok(me.drag === mate.id && me.dragPt, '引きずり中・手の行き先');
  const p = poseInput(me, {});
  ok(p.act === 'drag' && p.low === 1, '動作 drag・銃を下げる ' + p.act + ' ' + p.low);
  computePose(p, B);
  const hand1 = B[7 * 12 + 1] - me.y;
  ok(hand1 < hand0 - 0.15, '左手が下がる ' + hand0.toFixed(2) + '→' + hand1.toFixed(2));
  // 送る形: ほかの人の画面でも drag の動作になる
  const { packSnap } = await import('../../src/net/snap.js');
  const sn = packSnap(S, G.w, [], [me.pid], false), row = sn.A.find(r => r[0] === me.id);
  ok(row && row[25] === 10, '送る形に drag（10）' + (row ? row[25] : '-'));
  step(G, { [me.id]: idle(me, { act: [{ a: 'op', k: 'person', id: mate.id, op: 'drag' }] }) });
  ok(me.drag == null && !me.dragPt, '離すと戻る');
});
