// 大規模戦は味方撃ちなし（BattleBit: Steam の掲示板「Currently there is no friendly fire」）。爆発も味方には当たらない。自分の爆発は自分に当たる
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt } from '../../src/war/world.js';

test('爆発（手榴弾・RPG・C4・地雷）は味方を傷つけない・敵と自分は傷つく', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 3 }); step(G, {});
  const S = G.S, me = S.actors[0];
  const mate = S.actors.find(b => b.team === me.team && b !== me), foe = S.actors.find(b => b.team !== me.team);
  for (const b of S.actors) if (b !== me && b !== mate && b !== foe) { b.alive = false; b.dead = true; }
  for (const b of [mate, foe]) b.ai = null;
  const put = (b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
  put(me, 790, 690); put(mate, 792, 690); put(foe, 790, 692);
  const hp0 = [me.hp, mate.hp, foe.hp];
  S.blasts.push({ x: 791, y: me.y + 0.3, z: 690.8, r: 6, dmg: 60, fall: 0.7, kind: 'frag', by: me.id, t: 0 });
  step(G, {});
  ok(mate.hp === hp0[1] && mate.alive && !mate.down, '味方は無傷 ' + hp0[1] + '→' + mate.hp);
  ok(foe.hp < hp0[2] || foe.down, '敵は傷つく ' + hp0[2] + '→' + foe.hp);
  ok(me.hp < hp0[0] || me.down, '自分も傷つく ' + hp0[0] + '→' + me.hp);
});
