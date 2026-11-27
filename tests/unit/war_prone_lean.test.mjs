// 11-27 14:18「伏せリーンできない」: 伏せたままリーンすると、目（胴と頭）が横へ出る
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt } from '../../src/war/world.js';
import { eyeOf } from '../../src/engine/combat.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
test('伏せたままリーンすると目が横へ出る（右・左）', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const x = 790, z = 705; Object.assign(me, { x, z, y: heightAt(G.w, x, z), vx: 0, vz: 0, yaw: 0 });
  for (let i = 0; i < 150; i++) step(G, { [me.id]: idle(me, { stance: 2 }) });
  ok(me.st > 1.95, '伏せた');
  const e0 = eyeOf(S, me).slice();
  for (let i = 0; i < 40; i++) step(G, { [me.id]: idle(me, { stance: 2, lean: 1 }) });
  ok(me.lean > 0.9, 'リーンした ' + me.lean.toFixed(2));
  const eR = eyeOf(S, me).slice();
  for (let i = 0; i < 60; i++) step(G, { [me.id]: idle(me, { stance: 2, lean: -1 }) });
  const eL = eyeOf(S, me).slice();
  // 右は -x（yaw 0 で前が +z）
  const dR = e0[0] - eR[0], dL = eL[0] - e0[0];
  ok(dR > 0.2, '右へ ' + dR.toFixed(2) + 'm');
  ok(dL > 0.2, '左へ ' + dL.toFixed(2) + 'm');
  ok(Math.abs(eR[1] - e0[1]) < 0.15, '高さはほぼそのまま ' + (eR[1] - e0[1]).toFixed(2));
});
