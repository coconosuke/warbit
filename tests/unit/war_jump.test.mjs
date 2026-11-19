import { test, ok, near } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';

function game(o = {}) { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); }
const inp = (a, o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });

test('跳ぶ: 越える物がない所で乗り越えのボタン（jump 付き）→ 約 0.66m 跳んで同じ高さに降りる', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a));
  const y0 = a.y;
  const ev = step(G, inp(a, { act: [{ a: 'vault', jump: 1 }] }));
  ok(ev.some(e => e.e === 'jump' && e.id === a.id), '跳んだ合図');
  let top = a.y, n = 0, landed = false, air = false;
  for (; n < 120; n++) {
    const e = step(G, inp(a));
    top = Math.max(top, a.y);
    if (!a.ground) air = true;
    if (e.some(x => x.e === 'fall' && x.id === a.id && x.d === 0)) landed = true;
    if (air && a.ground) break;
  }
  ok(air, '宙に出る');
  ok(top - y0 > 0.55 && top - y0 < 0.8, `高さ ${(top - y0).toFixed(2)}m`);
  ok(n / 60 > 0.55 && n / 60 < 0.9, `宙にいる時間 ${(n / 60).toFixed(2)} 秒`);
  near(a.y, y0, 0.05, '同じ高さに降りる');
  ok(landed, '軽い着地の音');
  ok(a.hp === a.maxHp, '傷つかない');
});

test('跳ぶ: jump の付かない乗り越え（ボット）や、しゃがみ・宙では跳ばない', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a));
  const y0 = a.y;
  step(G, inp(a, { act: [{ a: 'vault' }] }));
  for (let i = 0; i < 10; i++) step(G, inp(a));
  near(a.y, y0, 0.01, 'jump なしは跳ばない');
  for (let i = 0; i < 40; i++) step(G, inp(a, { stance: 1 }));
  step(G, inp(a, { stance: 1, act: [{ a: 'vault', jump: 1 }] }));
  for (let i = 0; i < 10; i++) step(G, inp(a, { stance: 1 }));
  near(a.y, y0, 0.01, 'しゃがんでいると跳ばない');
  for (let i = 0; i < 40; i++) step(G, inp(a));
  step(G, inp(a, { act: [{ a: 'vault', jump: 1 }] }));
  for (let i = 0; i < 6; i++) step(G, inp(a));
  const y1 = a.y;
  step(G, inp(a, { act: [{ a: 'vault', jump: 1 }] }));
  step(G, inp(a));
  ok(a.y < y1 + 0.2 && !(a.vy > 3), '宙ではもう一度跳ばない');
});

test('跳ぶ: 走って跳ぶと勢いのまま前へ進み、宙では照準が広がる', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 90; i++) step(G, inp(a, { mz: 1, sprint: true }));
  const sp = Math.hypot(a.vx, a.vz);
  step(G, inp(a, { mz: 1, sprint: true, act: [{ a: 'vault', jump: 1 }] }));
  for (let i = 0; i < 15; i++) step(G, inp(a, { mz: 1, sprint: true }));
  ok(!a.ground && Math.hypot(a.vx, a.vz) > sp * 0.8, `宙でも速さを保つ ${Math.hypot(a.vx, a.vz).toFixed(2)} / ${sp.toFixed(2)}`);
  ok((a.airT || 0) > 0.12, '宙にいる時間が数えられる（照準が広がる）');
});

test('反動の押さえ: 下へ引いた分（inp.rc 度）は反動の分から引き、0 より下にはしない', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a, { ads: true }));
  for (let i = 0; i < 6; i++) step(G, inp(a, { ads: true, fire: true }));
  const rp = a.ws.rp;
  ok(rp > 0.3, `撃つと反動で上がる ${rp.toFixed(2)}°`);
  step(G, inp(a, { ads: true, fire: false, rc: rp * 0.5 }));
  ok(a.ws.rp < rp * 0.55, `押さえた分だけ下がる ${a.ws.rp.toFixed(2)}° < ${(rp * 0.55).toFixed(2)}°`);
  step(G, inp(a, { ads: true, rc: 50 }));
  ok(a.ws.rp === 0, '0 より下にはならない');
});
