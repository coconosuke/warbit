// 11-26: ダウンした人（ボット）がとどめを刺されて死ぬ時、死体が一度起き上がってから倒れ直していた
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { pvpDamage, poseInput } from '../../src/engine/combat.js';
import { computePose } from '../../src/engine/pose.js';
import { NBONE } from '../../src/engine/pose.js';

const headY = (a) => { const B = new Float32Array(NBONE * 12); computePose(poseInput(a, {}), B); return B[4 * 12 + 1] - a.y; };

test('ダウンからの死: 横たわったまま（倒れる時間も倒れる向きも続く）', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 });
  const S = G.S, bot = S.actors.find(b => b.ai && b.team === 1), shooter = S.actors.find(b => b.team === 0);
  step(G, {}); // モードの規則（ダウンできるか）は最初のこまで決まる
  // ダウンさせる（胴に大きな傷）
  pvpDamage(S, bot, bot.hp + 5, shooter, 'chest', 0, 1, [], 'bullet');
  ok(bot.down && bot.alive, 'ダウンした');
  for (let i = 0; i < 120; i++) step(G, {});
  ok(bot.down, 'まだダウン');
  const t0 = bot.stateT, fy = bot.fallYaw, h0 = headY(bot);
  ok(h0 < 0.6, '横たわっている ' + h0.toFixed(2));
  // 反対の向きから、とどめ
  pvpDamage(S, bot, 200, shooter, 'chest', 1, 0, [], 'bullet');
  ok(!bot.alive && bot.dead, '死んだ');
  ok(bot.stateT >= t0, '倒れる時間は 0 に戻らない');
  ok(bot.fallYaw === fy, '倒れた向きのまま');
  const h1 = headY(bot);
  ok(h1 < 0.6, '起き上がらない ' + h1.toFixed(2));
  step(G, {});
  ok(headY(bot) < 0.6, '次のこまも横たわったまま');
});

test('立っている人が死ぬ時は、今までどおり倒れる動きから', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 });
  const S = G.S, bot = S.actors.find(b => b.ai && b.team === 1), shooter = S.actors.find(b => b.team === 0);
  pvpDamage(S, bot, 500, shooter, 'head', 0, 1, [], 'head');
  ok(bot.dead, '即死');
  ok(bot.stateT === 0, '倒れる時間は 0 から');
  ok(headY(bot) > 1.2, 'まだ立っている姿から倒れ始める');
});
