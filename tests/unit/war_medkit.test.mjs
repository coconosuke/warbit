// 医療キット（衛生）: 押している間、前の傷ついた仲間（いなければ自分）の体力を戻し、血を止める。仲間を治すと点
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { classLoadout } from '../../src/war/classes.js';
import { heightAt } from '../../src/war/world.js';

function game(o = {}) { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); step(G, {}); return G; }
const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);

test('衛生は医療キットを持つ', () => { ok(classLoadout('medic').gear.some(g => g[0] === 'medkit'), '衛生'); ok(!classLoadout('assault').gear.some(g => g[0] === 'medkit'), '突撃は持たない'); });

test('前の傷ついた仲間を治す（1秒に 20・血が止まる）・仲間を治すと点・いなければ自分', () => {
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0];
  const mate = S.actors.find(b => b.team === me.team && b !== me);
  mate.ai = null;
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  me.inv.gear.push({ id: 'medkit', n: 1 });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'medkit' }] }) });
  for (let i = 0; i < 120 && me.ws.st !== 'gear'; i++) step(G, { [me.id]: idle(me) });
  const put = () => { mate.x = me.x + Math.sin(me.yaw) * 1.5; mate.z = me.z + Math.cos(me.yaw) * 1.5; mate.y = heightAt(G.w, mate.x, mate.z); mate.vx = mate.vz = 0; };
  put(); mate.hp = 30; mate.bleed = 2;
  const sc0 = me.stats.sc || 0;
  for (let i = 0; i < 60; i++) { put(); step(G, { [me.id]: idle(me, { fire: true }), [mate.id]: idle(mate) }); }
  ok(mate.hp > 45 && mate.hp < 55, '1秒で約 20 ' + mate.hp.toFixed(1));
  eq(mate.bleed, 0, '血が止まる');
  ok((me.stats.sc || 0) > sc0, '点 ' + me.stats.sc);
  // 仲間が満タンなら自分
  mate.hp = mate.maxHp; me.hp = 50;
  for (let i = 0; i < 30; i++) { put(); step(G, { [me.id]: idle(me, { fire: true }), [mate.id]: idle(mate) }); }
  ok(me.hp > 55, '自分 ' + me.hp.toFixed(1));
  eq(me.inv.gear.find(g => g.id === 'medkit').n, 1, 'なくならない');
});

test('ボットの衛生: 近くの傷ついた仲間の人を治す', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 4 }); step(G, {});
  const S = G.S, me = S.actors[0];
  const b = S.actors.find(a => a.ai && a.team === me.team);
  b.warCls = 'medic';
  for (let i = 0; i < 30; i++) step(G, {});
  me.hp = 40;
  for (let i = 0; i < 60; i++) { b.x = me.x + 1.5; b.z = me.z; b.y = me.y; b.ai.tgt = null; step(G, {}); }
  ok(me.hp > 50, '治った ' + me.hp.toFixed(1));
});
