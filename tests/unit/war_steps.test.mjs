import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';

// 足音（11-20）: 人の走りの歩数に近い（全力でも 1 秒に約 3 歩。前は 7 歩近く）。宙にいる間は足音が鳴らない（走って跳んでも）
function game() { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); }
const inp = (a, o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });
// 開けた所を探す（2 方向へ 30m 歩ける）
function open(G, a) {
  for (let i = 0; i < 30; i++) step(G, inp(a));
  return a.yaw;
}
function rate(G, a, o, secs) {
  let n = 0;
  for (let i = 0; i < 60; i++) step(G, inp(a, o)); // 走り出し
  for (let i = 0; i < secs * 60; i++) { a.oob = 0; n += step(G, inp(a, o)).filter(e => e.e === 'step' && e.id === a.id).length; }
  return n / secs;
}
test('足音の歩数: 歩き 約 2.5〜3 歩/秒・全力 約 3〜3.6 歩/秒・しゃがみ歩き 約 2〜2.6 歩/秒', () => {
  const G = game(), a = G.S.actors[0]; open(G, a);
  const x0 = a.x, z0 = a.z, h0 = a.y, y0 = a.yaw;
  const walk = rate(G, a, { mz: 1, yaw: y0 }, 3);
  a.x = x0; a.z = z0; a.y = h0; a.vx = a.vz = a.vy = 0; a.sprT = 0;
  const run = rate(G, a, { mz: 1, sprint: true, yaw: y0 }, 3);
  a.x = x0; a.z = z0; a.y = h0; a.vx = a.vz = a.vy = 0; a.sprT = 0;
  const cr = rate(G, a, { mz: 1, stance: 1, yaw: y0 }, 3);
  ok(walk > 2.3 && walk < 3.1, `歩き ${walk.toFixed(2)} 歩/秒`);
  ok(run > 2.9 && run < 3.7, `全力 ${run.toFixed(2)} 歩/秒`);
  ok(cr > 1.9 && cr < 2.7, `しゃがみ ${cr.toFixed(2)} 歩/秒`);
});
test('走って跳ぶと、宙にいる間は足音が鳴らない', () => {
  const G = game(), a = G.S.actors[0]; open(G, a);
  for (let i = 0; i < 90; i++) step(G, inp(a, { mz: 1, sprint: true }));
  step(G, inp(a, { mz: 1, sprint: true, act: [{ a: 'vault', jump: 1 }] }));
  let air = 0, inAir = 0;
  for (let i = 0; i < 60 && (i < 3 || !a.ground); i++) {
    const ev = step(G, inp(a, { mz: 1, sprint: true }));
    if (!a.ground) { air++; inAir += ev.filter(e => e.e === 'step' && e.id === a.id).length; }
  }
  ok(air > 20, `宙にいた ${air} ステップ`);
  ok(inAir === 0, `宙の足音 ${inAir}`);
});
test('構えを変えると音の知らせが 1 回だけ出る（立つ→伏せ→しゃがむ）', () => {
  const G = game(), a = G.S.actors[0]; open(G, a);
  const evs = [];
  for (const s of [2, 2, 2, 1, 1]) for (let i = 0; i < 20; i++) evs.push(...step(G, inp(a, { stance: s })).filter(e => e.e === 'stance' && e.id === a.id));
  ok(evs.length === 2, `知らせ ${evs.length} 回`);
  ok(evs[0].pose === 2 && evs[1].pose === 1, `順番 ${evs.map(e => e.pose).join(',')}`);
});
