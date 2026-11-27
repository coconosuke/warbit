// 11-26 22:35: 本家と同じく、分隊の仲間の上（そば）からも出撃できる。撃ち合いの最中の仲間には出られない。出る所は立てる所（隙間に挟まらない）
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { canSpawnOn, standOK } from '../../src/engine/modes/war.js';
import { heightAt } from '../../src/war/world.js';

function game(o = {}) { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 4, ...o }); step(G, {}); return G; }
const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);

function setup() {
  const G = game(), S = G.S, me = S.actors[0];
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  const mate = S.actors.find(b => b !== me && b.team === me.team && b.squad === me.squad);
  // 敵は遠くへ（25m 以内に敵がいると出られない）
  for (const b of S.actors) if (b.team !== me.team) { b.alive = false; b.dead = true; }
  mate.ai = null;
  const f = S.m.flags[1];
  Object.assign(mate, { x: f.x + 30, z: f.z + 12, vx: 0, vz: 0 }); mate.y = heightAt(G.w, mate.x, mate.z);
  for (let i = 0; i < 10; i++) step(G, { [me.id]: idle(me), [mate.id]: idle(mate) });
  return { G, S, me, mate };
}
const die = (S, me) => { me.hp = 0; me.alive = false; me.dead = true; S.m.respawn.push({ id: me.id, at: S.t + 1 }); };

test('分隊の仲間のそばに出る（立てる所・仲間と同じ向き）', () => {
  const { G, S, me, mate } = setup();
  ok(canSpawnOn(S, me, mate), '出られる仲間');
  die(S, me);
  step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'sq:' + mate.id, cls: me.warCls }] }), [mate.id]: idle(mate) });
  for (let i = 0; i < 5 && !me.alive; i++) step(G, { [mate.id]: idle(mate) });
  ok(me.alive, '出撃した');
  const d = Math.hypot(me.x - mate.x, me.z - mate.z);
  ok(d > 0.6 && d < 4, '仲間のそば ' + d.toFixed(2));
  ok(Math.abs(me.yaw - mate.yaw) < 1e-6, '仲間と同じ向き');
  ok(me.st < 0.3 && me.stance === 0, '立って出る');
});

// 11-27 14:27: 出られない仲間を選んでいた時は、黙って本陣へ回さず、予約をやめて選び直してもらう
test('撃ち合いの最中（撃たれた・撃った・近くに敵）の仲間には出られず、予約がやめになる', () => {
  const { G, S, me, mate } = setup();
  mate.lastHit = { t: S.t, by: -1 };
  ok(!canSpawnOn(S, me, mate), '撃たれたばかりは出られない');
  die(S, me);
  const ev = step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'sq:' + mate.id, cls: me.warCls }] }), [mate.id]: idle(mate) });
  for (let i = 0; i < 5; i++) ev.push(...step(G, { [mate.id]: idle(mate) }));
  ok(!me.alive && me.deployAt == null, '出ない・予約がやめになった');
  ok(ev.some(e => e.e === 'deployCancel' && e.id === me.id && e.why === 'busy'), '理由: 撃ち合い');
});

test('出る所は立てる所: 頭の上と体のまわりが空いている', () => {
  const { G, S } = setup();
  const hq = S.m.hq[0];
  let n = 0, okN = 0;
  for (let i = 0; i < 40; i++) {
    const x = hq[0] + (i % 8 - 4) * 7, z = hq[1] + (Math.floor(i / 8) - 2) * 7, y = heightAt(G.w, x, z);
    n++; if (standOK(S, G.w, x, z, y)) okN++;
  }
  ok(okN > 0, '本陣のまわりに立てる所がある ' + okN + '/' + n);
});

// 11-27 04:01: 待ちの間に押した出撃の予約は、もう一度押すとやめられる（やめると時間が来ても出ない）
test('出撃の予約をやめると、待ちが終わっても出ない。また押せば出る', () => {
  const { G, S, me, mate } = setup();
  me.hp = 0; me.alive = false; me.dead = true; S.m.respawn.push({ id: me.id, at: S.t + Math.round(1 / S.dt) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'hq', cls: me.warCls }] }), [mate.id]: idle(mate) });
  ok(me.deployAt === 'hq', '予約した');
  step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', cancel: true }] }), [mate.id]: idle(mate) });
  ok(me.deployAt == null, '予約をやめた');
  for (let i = 0; i < Math.round(2 / S.dt); i++) step(G, { [mate.id]: idle(mate) });
  ok(!me.alive, '時間が来ても出ない');
  step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'hq', cls: me.warCls }] }), [mate.id]: idle(mate) });
  for (let i = 0; i < 5 && !me.alive; i++) step(G, { [mate.id]: idle(mate) });
  ok(me.alive, 'また押すと出た');
});

// 11-27 14:27「出撃確定させて待機中にビーコンや分隊長が破壊、死亡した場合は必ずキャンセルしてもう一度出撃地点を選ぶ」
test('待っている間に選んだ仲間が死ぬ・倒れると、予約がやめになり、時間が来ても出ない', () => {
  for (const how of ['dead', 'down']) {
    const { G, S, me, mate } = setup();
    me.hp = 0; me.alive = false; me.dead = true; S.m.respawn.push({ id: me.id, at: S.t + Math.round(2 / S.dt) });
    step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'sq:' + mate.id, cls: me.warCls }] }), [mate.id]: idle(mate) });
    ok(me.deployAt === 'sq:' + mate.id, how + ': 予約した');
    if (how === 'dead') { mate.alive = false; mate.dead = true; } else { mate.down = true; mate.dbno = 20; }
    const ev = [];
    for (let i = 0; i < Math.round(3 / S.dt); i++) ev.push(...step(G, {}));
    ok(me.deployAt == null && !me.alive, how + ': 予約がやめになり、出ない');
    ok(ev.some(e => e.e === 'deployCancel' && e.id === me.id && e.why === how), how + ': 理由 ' + JSON.stringify(ev.filter(e => e.e === 'deployCancel')));
  }
});
