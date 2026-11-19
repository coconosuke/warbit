// RPG-7（大規模戦の工兵）: 込めた1発と予備2発（BattleBit の Wiki の 3 発）。肩から撃ち、当たった所で爆発。撃つと 4.2 秒で込め直す。遠いほど落ちる
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { classLoadout } from '../../src/war/classes.js';
import { makeInventory } from '../../src/engine/actor.js';
import { LONG } from '../../src/engine/data/equipment.js';
import { ROCKET } from '../../src/engine/nades.js';
import { heightAt } from '../../src/war/world.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch || 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
const put = (G, b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
// 工兵の RPG を持たせて構える
function arm(G, me) {
  me.inv.long = 'rpg'; me.inv.rpg = { in: 1, n: 5, n0: 5 };
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'long' }] }) });
  for (let i = 0; i < 200 && !(me.ws.slot === 3 && (me.ws.st === 'long' || me.ws.st === 'ready')); i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me) });
}

test('工兵は RPG-7 を持つ（込めた1発と予備2発）。ほかの兵科は持たない', () => {
  eq(classLoadout('engineer').long, 'rpg', '工兵');
  eq(classLoadout('assault').long, 'none', '突撃');
  const inv = makeInventory(classLoadout('engineer'));
  eq(inv.rpg.in, 1, '込めてある'); eq(inv.rpg.n, 2, '予備 2'); eq(LONG.rpg.rockets, 3, '3 発');
});

test('撃つ: ロケットが飛び、30m 先の敵に当たると爆発して倒す（撃った人は無事）', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, me = S.actors[0], foe = S.actors.find(b => b.team !== me.team);
  for (const b of S.actors) if (b !== me) b.ai = null;
  for (const b of S.actors) if (b !== me && b !== foe) { b.alive = false; b.dead = true; }
  put(G, me, 790, 690); put(G, foe, 790, 720);
  arm(G, me);
  me.yaw = Math.atan2(foe.x - me.x, foe.z - me.z); me.pitch = Math.atan2(foe.y + 1.0 - (me.y + 1.55), 30);
  // 構えてから撃つ（腰だめはばらつく）
  for (let i = 0; i < 90 && me.ads < 0.95; i++) step(G, { [me.id]: idle(me, { yaw: me.yaw, pitch: me.pitch, ads: true }) });
  ok(me.ads > 0.9, '構えた ' + me.ads);
  step(G, { [me.id]: idle(me, { yaw: me.yaw, pitch: me.pitch, fire: true, ads: true }) });
  ok(S.nades.some(n => n.type === 'rpg'), 'ロケットが出た');
  eq(me.inv.rpg.in, 0, '撃つと空');
  for (let i = 0; i < 40 && foe.alive && !foe.down; i++) step(G, { [me.id]: idle(me, { yaw: me.yaw, pitch: me.pitch, ads: true }) });
  ok(!foe.alive || foe.down, '敵を倒した hp=' + foe.hp);
  ok(me.alive && me.hp === me.maxHp, '撃った人は無事 ' + me.hp);
  ok(!S.nades.some(n => n.type === 'rpg'), 'ロケットはなくなった');
});

test('込め直し: 撃つと 4.2 秒で次の1発（その間は撃てない）。持っている分（ここでは 6 発）で尽きる', () => {
  const G = createGame({ map: 'range', mode: 'war', wmode: 'range', seed: 3, bots: false }); step(G, {});
  const S = G.S, me = S.actors[0];
  arm(G, me);
  me.pitch = 0.05;
  const fire = () => { step(G, { [me.id]: idle(me, { fire: true }) }); step(G, { [me.id]: idle(me) }); };
  let shots = 0;
  const count = () => S.rocketN || 0;
  fire(); shots = count();
  eq(shots, 1, '1発目');
  // すぐはもう撃てない
  fire(); eq(count(), 1, '込めている間は撃てない');
  const per = Math.round(LONG.rpg.reload / S.dt);
  for (let i = 0; i < per - 10; i++) step(G, { [me.id]: idle(me) });
  eq(me.inv.rpg.in, 0, 'まだ込め終わっていない');
  for (let i = 0; i < 20; i++) step(G, { [me.id]: idle(me) });
  eq(me.inv.rpg.in, 1, '込め終わった'); eq(me.inv.rpg.n, 4, '予備 4');
  for (let k = 0; k < 8; k++) { fire(); for (let i = 0; i < per + 5; i++) step(G, { [me.id]: idle(me) }); }
  eq(count(), 6, '6 発で尽きる');
  eq(me.inv.rpg.in + me.inv.rpg.n, 0, '空');
});

test('遠いほど落ちる: 1.2 秒で、まっすぐの線より 2.5〜4m 下（重力 0.45 倍）。速さは 190m/s まで上がる', () => {
  const G = createGame({ map: 'range', mode: 'war', wmode: 'range', seed: 3, bots: false }); step(G, {});
  const S = G.S, me = S.actors[0];
  arm(G, me);
  const pitch = 0.03;
  step(G, { [me.id]: idle(me, { pitch, fire: true, ads: true }) });
  const n = S.nades.find(q => q.type === 'rpg');
  ok(n, 'ロケット');
  const x0 = n.x, y0 = n.y, z0 = n.z, dir = [n.vx, n.vy, n.vz], L0 = Math.hypot(...dir);
  let t = 0;
  while (t < 1.2 && S.nades.includes(n)) { step(G, { [me.id]: idle(me, { pitch }) }); t += S.dt; }
  ok(S.nades.includes(n), 'まだ飛んでいる');
  const sp = Math.hypot(n.vx, n.vy, n.vz);
  ok(sp > 185 && sp < 195, '速さ ' + sp.toFixed(0));
  const d = Math.hypot(n.x - x0, n.z - z0);
  const straightY = y0 + d * dir[1] / Math.hypot(dir[0], dir[2]);
  const drop = straightY - n.y;
  ok(drop > 2.5 && drop < 4, '落ち ' + drop.toFixed(2) + 'm（' + d.toFixed(0) + 'm 先）');
  ok(ROCKET.g < 1, '重力は弱め');
});

test('大きい弾薬箱で RPG の予備が戻る', async () => {
  const { placeAmmo, stepAmmo } = await import('../../src/engine/ammobox.js');
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, me = S.actors[0];
  put(G, me, 790, 690);
  me.inv.long = 'rpg'; me.inv.rpg = { in: 0, n: 2, n0: 5 };
  me.inv.gear = me.inv.gear.filter(g => g.id !== 'bandage' && g.id !== 'frag' && g.id !== 'smoke' && g.id !== 'impact');
  const b = placeAmmo(S, { ...me, id: -5, yaw: 0 }, 'ammobig', null);
  b.x = me.x; b.z = me.z; b.y = me.y;
  for (let i = 0; i < 6 / S.dt; i++) { S.t++; stepAmmo(S, null, null); }
  ok(me.inv.rpg.n > 2, '予備が増えた ' + me.inv.rpg.n);
});

test('ボットの工兵: 固まった敵（40m）へ RPG を撃ち、撃ったら銃に戻す。味方が敵のそばにいると撃たない', () => {
  const run = (withAlly) => {
    const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 5, bots: true, per: 4 }); step(G, {});
    const S = G.S;
    const eng = S.actors.find(b => b.ai && b.team === 0);
    const foes = S.actors.filter(b => b.team === 1).slice(0, 3);
    const mate = S.actors.find(b => b.team === 0 && b !== eng && b.ai);
    for (const b of S.actors) if (b !== eng && !foes.includes(b) && !(withAlly && b === mate)) { b.alive = false; b.dead = true; }
    for (const b of foes) b.ai = null;
    if (withAlly) mate.ai = null;
    put(G, eng, 790, 690);
    foes.forEach((b, i) => { put(G, b, 790 + (i - 1) * 1.5, 730); b.yaw = Math.PI; });
    if (withAlly) put(G, mate, 792, 731);
    eng.inv.long = 'rpg'; eng.inv.rpg = { in: 1, n: 5, n0: 5 };
    const n0 = S.rocketN || 0;
    let fired = -1, back = false;
    for (let i = 0; i < 20 / S.dt; i++) {
      step(G, {});
      for (const b of foes) { b.hp = b.maxHp; b.down = false; b.alive = true; b.dead = false; }
      if (fired < 0 && (S.rocketN || 0) > n0) fired = i;
      if (fired >= 0 && eng.ws.slot === 0 && i > fired) { back = true; break; }
    }
    return { fired: fired >= 0, back, slot: eng.ws.slot };
  };
  const r1 = run(false);
  ok(r1.fired, '撃った');
  ok(r1.back, '銃に戻した ' + r1.slot);
  const r2 = run(true);
  ok(!r2.fired, '味方がそばにいると撃たない');
});
