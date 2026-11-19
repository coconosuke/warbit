// 付属品（LOADOUT）: 選んだ照準器・銃口・グリップ・横の物が出撃した銃に付く。付けられない物は外れる
import { test, ok, eq } from '../lib/t.mjs';
import { classLoadout } from '../../src/war/classes.js';
import { makeWeapon } from '../../src/engine/actor.js';
import { attachOptions } from '../../src/engine/data/weapons.js';
import { createGame, step } from '../../src/engine/engine.js';

test('付属品: 選んだ物が付く（付けられない物は外れる）', () => {
  const ao = attachOptions('m4a1');
  const grip = (ao.grip || []).find(v => v !== 'none'), muz = (ao.muzzle || []).find(v => v !== 'none');
  ok(grip && muz, '選べる物がある ' + JSON.stringify(ao));
  const lo = classLoadout('assault', 'm4a1', null, { m4a1: { grip, muzzle: muz, sight: 'acog' } });
  const w = makeWeapon(lo.primary);
  eq(w.att.grip, grip, 'グリップ'); eq(w.att.muzzle, muz, '銃口'); eq(w.att.sight, 'acog', '照準器');
  const w2 = makeWeapon(classLoadout('assault', 'm4a1', null, { m4a1: { grip: 'nonexistent' } }).primary);
  ok(ao.grip.includes(w2.att.grip), '付けられない物は外れる');
});

test('付属品: 出撃の操作で渡すと、その銃で出る', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); step(G, {});
  const S = G.S, me = S.actors[0];
  const ao = attachOptions('m4a1'), grip = ao.grip.find(v => v !== 'none');
  me.hp = 0; me.alive = false; me.dead = true; S.m.respawn.push({ id: me.id, at: S.t + 1 });
  const idle = { mx: 0, mz: 0, yaw: 0, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false };
  step(G, { [me.id]: { ...idle, act: [{ a: 'warDeploy', at: 'hq', cls: 'assault', gun: 'm4a1', att: { m4a1: { grip } } }] } });
  for (let i = 0; i < 10 && !me.alive; i++) step(G, {});
  ok(me.alive, '出撃');
  eq(me.inv.w[0].att.grip, grip, '付いている');
});
