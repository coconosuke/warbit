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

test('撃ち合いの最中（撃たれた・撃った・近くに敵）の仲間には出られず、本陣から出る', () => {
  const { G, S, me, mate } = setup();
  mate.lastHit = { t: S.t, by: -1 };
  ok(!canSpawnOn(S, me, mate), '撃たれたばかりは出られない');
  die(S, me);
  step(G, { [me.id]: idle(me, { act: [{ a: 'warDeploy', at: 'sq:' + mate.id, cls: me.warCls }] }), [mate.id]: idle(mate) });
  for (let i = 0; i < 5 && !me.alive; i++) step(G, { [mate.id]: idle(mate) });
  ok(me.alive, '出撃した');
  const hq = S.m.hq[me.team];
  ok(Math.hypot(me.x - hq[0], me.z - hq[1]) < Math.hypot(me.x - mate.x, me.z - mate.z), '本陣の方');
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
