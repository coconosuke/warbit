// 11-27 14:22「ダウン中の移動おかしい。反転してる？」: 倒れて這う向きは、見ている向き（カメラ）が前。
//  体（頭）は這う向きへ少しずつ向く（胸を中心に回すので目が大きく振れない）
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { pvpDamage } from '../../src/engine/combat.js';
import { heightAt } from '../../src/war/world.js';
import { personPoint } from '../../src/engine/interact.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function downed() {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 });
  const S = G.S, me = S.actors[0];
  step(G, {});
  for (const b of S.actors) if (b !== me) { b.alive = false; b.dead = true; }
  const x = 790, z = 705, y = heightAt(G.w, x, z);
  Object.assign(me, { x, y, z, vx: 0, vz: 0, yaw: 0 });
  for (let i = 0; i < 30; i++) step(G, { [me.id]: idle(me) });
  pvpDamage(S, me, me.hp + 5, null, 'chest', 0, 1, [], 'bullet');
  ok(me.down && me.alive, '倒れた');
  for (let i = 0; i < 70; i++) step(G, { [me.id]: idle(me) });
  return { G, S, me };
}
const wrap = (d) => Math.atan2(Math.sin(d), Math.cos(d));

for (const look of [0, Math.PI / 2, Math.PI, -2.2]) {
  test(`倒れて這う: スティックを前へ倒すと見ている向き（${look.toFixed(1)}）へ進む`, () => {
    const { G, S, me } = downed();
    const y0 = me.yaw, ly = y0 + look;
    const c0 = personPoint(S, me);
    for (let i = 0; i < Math.round(3 / S.dt); i++) step(G, { [me.id]: idle(me, { yaw: ly, mz: 1 }) });
    const c1 = personPoint(S, me), dx = c1[0] - c0[0], dz = c1[2] - c0[2], d = Math.hypot(dx, dz);
    ok(d > 0.5, '進んだ ' + d.toFixed(2));
    const err = Math.abs(wrap(Math.atan2(dx, dz) - ly));
    ok(err < 0.6, '見ている向きへ（ずれ ' + err.toFixed(2) + ' rad）');
    ok(me.alive && me.down, 'まだ倒れている');
  });
}

test('倒れて這う: 体（頭）が這う向きへ向いていく', () => {
  const { G, S, me } = downed();
  const ly = me.yaw + me.fallYaw + Math.PI;
  const e0 = Math.abs(wrap(me.yaw + me.fallYaw - ly));
  for (let i = 0; i < Math.round(3 / S.dt); i++) step(G, { [me.id]: idle(me, { yaw: ly, mz: 1 }) });
  const e1 = Math.abs(wrap(me.yaw + me.fallYaw - ly));
  ok(e1 < e0 - 2, '頭の向きが近づいた ' + e0.toFixed(2) + ' → ' + e1.toFixed(2));
});

test('倒れて這う: 後ろへ倒すと見ている向きの逆へ', () => {
  const { G, S, me } = downed();
  const ly = me.yaw + 1.0;
  const c0 = personPoint(S, me);
  for (let i = 0; i < Math.round(2 / S.dt); i++) step(G, { [me.id]: idle(me, { yaw: ly, mz: -1 }) });
  const c1 = personPoint(S, me), dx = c1[0] - c0[0], dz = c1[2] - c0[2];
  ok(Math.hypot(dx, dz) > 0.2, '進んだ');
  ok(Math.abs(wrap(Math.atan2(dx, dz) - (ly + Math.PI))) < 0.9, '逆へ');
});
