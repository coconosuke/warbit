// 11-26: 伏せの向きを変える速さに上限（BattleBit の 2024 の手直し「伏せの回る速さに上限」）。立っていればすぐ向く
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { PRONE_TURN } from '../../src/engine/move.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
const ang = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test('伏せていると向きを変える速さに上限（半回転に 1 秒以上）。立っていればすぐ向く', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  const S = G.S, me = S.actors[0];
  step(G, {});
  for (let i = 0; i < 180; i++) step(G, { [me.id]: idle(me, { stance: 2 }) });
  ok(me.st > 1.9, '伏せた ' + me.st);
  const y0 = me.yaw, want = y0 + Math.PI;
  const T = Math.round(0.5 / S.dt);
  for (let i = 0; i < T; i++) step(G, { [me.id]: idle(me, { stance: 2, yaw: want }) });
  const turned = ang(me.yaw, y0);
  ok(Math.abs(turned - PRONE_TURN * T * S.dt) < 0.08, `0.5 秒で ${(turned / Math.PI * 180).toFixed(0)}°`);
  ok(turned < Math.PI * 0.5, '半回転していない');
  for (let i = 0; i < 90; i++) step(G, { [me.id]: idle(me, { stance: 0, yaw: me.yaw }) });
  const y1 = me.yaw;
  step(G, { [me.id]: idle(me, { stance: 0, yaw: y1 + Math.PI }) });
  ok(ang(me.yaw, y1) > Math.PI - 0.01, '立っているとすぐ向く');
});
