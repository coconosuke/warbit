// 11-27: 伏せ撃ち（ドロップショット）は反動が強い（BattleBit 3.0 の予定。研究メモ 70）。伏せ終わってからは伏せの小さい反動
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt } from '../../src/war/world.js';
import { DROPSHOT } from '../../src/engine/weapon.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
// stance0 で構えて待ち、stance1 に切り替えた n ステップ目に 1 発撃った反動
function kick(stance0, stance1, wait) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const x = 790, z = 705; Object.assign(me, { x, z, y: heightAt(G.w, x, z), vx: 0, vz: 0, yaw: 0 });
  me.inv.w[0].att.grip = 'none';
  for (let i = 0; i < 120; i++) step(G, { [me.id]: idle(me, { stance: stance0 }) });
  for (let i = 0; i < wait; i++) step(G, { [me.id]: idle(me, { stance: stance1 }) });
  const rp0 = me.ws.rp, sh = me.stats.sh, st = me.st;
  for (let i = 0; i < 4 && me.stats.sh === sh; i++) step(G, { [me.id]: idle(me, { stance: stance1, fire: true }) });
  return { k: me.ws.rp - rp0, st };
}
test('伏せていく途中で撃つと反動が強い・伏せ終わると小さい', () => {
  const stand = kick(0, 0, 10), drop = kick(0, 2, 20), prone = kick(2, 2, 10);
  ok(drop.st > 0.2 && drop.st < 1.9, '伏せていく途中 ' + drop.st.toFixed(2));
  ok(Math.abs(drop.k / stand.k - DROPSHOT.recoil) < 0.15, `途中 ${drop.k.toFixed(3)} / 立ち ${stand.k.toFixed(3)}`);
  ok(prone.k < stand.k * 0.8, `伏せ終わり ${prone.k.toFixed(3)} / 立ち ${stand.k.toFixed(3)}`);
});

test('DMR は速く撃つほど反動が大きい（3.0 の予定）', async () => {
  const { makeWeapon } = await import('../../src/engine/actor.js');
  const shot2 = (gapSteps) => {
    const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
    const S = G.S, me = S.actors[0];
    step(G, {});
    const x = 790, z = 705; Object.assign(me, { x, z, y: heightAt(G.w, x, z), vx: 0, vz: 0, yaw: 0 });
    me.inv.w[0] = makeWeapon({ id: 'hk417' }); me.ws.slot = 0; me.ws.st = 'ready';
    for (let i = 0; i < 60; i++) step(G, { [me.id]: idle(me) });
    // 撃ったこまの反動の跳ね（そのこまの前後の差）
    const fire1 = () => { const sh = me.stats.sh; let k = 0; for (let i = 0; i < 30 && me.stats.sh === sh; i++) { const b = me.ws.rp; step(G, { [me.id]: idle(me, { fire: true }) }); k = me.ws.rp - b; } return me.stats.sh > sh ? k : NaN; };
    fire1();
    for (let i = 0; i < gapSteps; i++) step(G, { [me.id]: idle(me) });
    // 比べやすく: 戻りの強さ（跳ね上がった分に比例）をそろえる
    me.ws.rp = 0;
    return fire1();
  };
  // どちらも 0.25 秒より短い間隔（初弾の跳ねに戻らない）。0.13 秒と 0.23 秒
  const fast = shot2(7), slow = shot2(13);
  ok(fast > slow * 1.1, `速く ${fast.toFixed(3)} / ゆっくり ${slow.toFixed(3)}`);
});
