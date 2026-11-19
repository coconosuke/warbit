// 双眼鏡（偵察・分隊長）: 持って引き金で、遠く（800m まで・細い向き）の敵に印
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { classLoadout } from '../../src/war/classes.js';
import { heightAt } from '../../src/war/world.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);

test('双眼鏡: 偵察と分隊長が持つ', () => { ok(classLoadout('recon').gear.some(g => g[0] === 'binoc'), '偵察'); ok(classLoadout('leader').gear.some(g => g[0] === 'binoc'), '分隊長'); });

test('双眼鏡: 引き金で 600m 先の敵に印（印のボタンの 450m より遠く）', () => {
  const G = createGame({ map: 'range', mode: 'war', wmode: 'range', seed: 3, bots: false }); step(G, {});
  const S = G.S, me = S.actors[0];
  const foe = S.actors.find(a => a.dummy && a.dummy.d >= 500 && a.dummy.d <= 700) || S.actors.find(a => a.dummy && a.dummy.d >= 400);
  ok(foe, '人形');
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  me.inv.gear.push({ id: 'binoc', n: 1 });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'binoc' }] }) });
  for (let i = 0; i < 120 && me.ws.st !== 'gear'; i++) step(G, { [me.id]: idle(me) });
  const ey = me.y + 1.55, ty = foe.y + 1.3;
  me.yaw = Math.atan2(foe.x - me.x, foe.z - me.z); me.pitch = Math.atan2(ty - ey, Math.hypot(foe.x - me.x, foe.z - me.z));
  const ev = [];
  step(G, { [me.id]: idle(me, { yaw: me.yaw, pitch: me.pitch, fire: true }) });
  step(G, { [me.id]: idle(me, { yaw: me.yaw, pitch: me.pitch }) });
  ok((S.m.spots || []).some(s => s.id === foe.id), '印 ' + JSON.stringify((S.m.spots || []).map(s => s.id)) + ' d=' + Math.round(Math.hypot(foe.x - me.x, foe.z - me.z)));
});

test('双眼鏡の倍率: 倍率のボタンで 6 → 8 → 4 → 6（BattleBit は 4〜8 倍）', async () => {
  const { GEAR } = await import('../../src/engine/data/equipment.js');
  const G = createGame({ map: 'range', mode: 'war', wmode: 'range', seed: 3, bots: false }); step(G, {});
  const S = G.S, me = S.actors[0];
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  me.inv.gear.push({ id: 'binoc', n: 1 });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'binoc' }] }) });
  for (let i = 0; i < 120 && me.ws.st !== 'gear'; i++) step(G, { [me.id]: idle(me) });
  const z = () => GEAR.binoc.zooms[me.ws.bz ?? GEAR.binoc.zi];
  ok(z() === 6, '既定 6');
  const seq = [];
  for (let k = 0; k < 3; k++) { step(G, { [me.id]: idle(me, { act: [{ a: 'zoom' }] }) }); seq.push(z()); }
  ok(seq.join(',') === '8,4,6', seq.join(','));
});
