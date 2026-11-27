// 11-27: 援護の M249（BattleBit Wiki: 100 発・700 発/分・リロード 6.67 秒・走る速さ 0.93）。撃ち続けるほど反動を抑えやすい（3.0 の予定）
import { test, ok, eq } from '../lib/t.mjs';
import { WEAPONS, attachOptions } from '../../src/engine/data/weapons.js';
import { classGuns } from '../../src/war/classes.js';
import { warGun } from '../../src/war/guns.js';
import { gunModel } from '../../src/render/guns.js';
import { createGame, step } from '../../src/engine/engine.js';
import { makeWeapon } from '../../src/engine/actor.js';
import { heightAt } from '../../src/war/world.js';

test('M249: 援護が選べる・Wiki の数字・箱の弾倉は替えられない・形が作れる', () => {
  const W = WEAPONS.m249;
  ok(W, '定義がある');
  ok(classGuns('support').includes('m249'), '援護の銃');
  eq(W.mag, 100); eq(W.rpm, 700); eq(W.vel, 690); eq(W.rl.tac, 6.67);
  eq(warGun('m249').dmg, 31);
  eq(attachOptions('m249').mag.join(','), 'std', '弾倉は箱のまま');
  ok(attachOptions('m249').grip.includes('bipod'), '二脚を付けられる');
  const g = gunModel('m249', {});
  ok(g && g.body && g.mag, '形');
});

test('M249 は撃ち続けるほど 1 発の反動が小さくなる', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const x = 790, z = 705; Object.assign(me, { x, z, y: heightAt(G.w, x, z), vx: 0, vz: 0, yaw: 0 });
  me.inv.w[0] = makeWeapon({ id: 'm249' }); me.ws.slot = 0; me.ws.st = 'ready';
  for (let i = 0; i < 90; i++) step(G, { [me.id]: { mx: 0, mz: 0, yaw: 0, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null } });
  const kicks = [];
  for (let i = 0; i < 240 && kicks.length < 25; i++) {
    const sh = me.stats.sh, b = me.ws.rp;
    step(G, { [me.id]: { mx: 0, mz: 0, yaw: 0, pitch: 0, stance: 0, lean: 0, sprint: false, fire: true, ads: true, act: null } });
    if (me.stats.sh > sh) kicks.push(me.ws.rp - b + 0);
  }
  ok(kicks.length >= 20, '撃てた ' + kicks.length);
  // 戻りの影響を除くため、跳ねの大きさは連射の 2〜4 発目と 18〜20 発目の平均で比べる
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const early = avg(kicks.slice(1, 4)), late = avg(kicks.slice(17, 20));
  ok(late < early, `後の方が小さい ${early.toFixed(3)} → ${late.toFixed(3)}`);
});
