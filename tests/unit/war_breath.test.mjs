import { test, ok, near } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';

function game(o = {}) { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); }
const inp = (a, o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });
// 構えている間の揺れの大きさ（1.5 秒の間の sx・sy の振れ幅）
function swayRange(G, a, o, n = 90) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) { step(G, inp(a, o)); const s = a.ws; x0 = Math.min(x0, s.sx); x1 = Math.max(x1, s.sx); y0 = Math.min(y0, s.sy); y1 = Math.max(y1, s.sy); }
  return Math.hypot(x1 - x0, y1 - y0);
}

test('息止め: 構えて押すと揺れがほぼ止まり、約5秒で切れて息が上がる（揺れが大きい）・離すと戻る', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 60; i++) step(G, inp(a, { ads: true }));
  const base = swayRange(G, a, { ads: true });
  const ev = [];
  for (let i = 0; i < 20; i++) ev.push(...step(G, inp(a, { ads: true, breath: true })));
  ok(ev.some(e => e.e === 'inhale' && e.id === a.id), '吸う音の合図');
  const held = swayRange(G, a, { ads: true, breath: true }, 90);
  ok(held < base * 0.3, `止めている間の揺れ ${held.toFixed(3)} < ふだん ${base.toFixed(3)} の3割`);
  let gasp = -1;
  for (let i = 0; i < 60 * 6 && gasp < 0; i++) for (const e of step(G, inp(a, { ads: true, breath: true }))) if (e.e === 'gasp' && e.id === a.id) gasp = i;
  ok(gasp >= 0, '息が切れる');
  const total = (20 + 90 + gasp) / 60;
  ok(total > 4.3 && total < 5.7, `もつ時間 ${total.toFixed(2)} 秒`);
  ok(a.ws.br === 0 && a.ws.gasp > 2, '息が上がっている');
  const gs = swayRange(G, a, { ads: true, breath: true }, 90);
  ok(gs > base * 1.1, `息が上がると揺れが大きい ${gs.toFixed(3)} > ${base.toFixed(3)}`);
  for (let i = 0; i < 60 * 6; i++) step(G, inp(a, { ads: true }));
  near(a.ws.br, 1, 1e-6, '離すと戻る');
});

test('息止め: 構えていないときと走っているときは効かない', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a, { breath: true }));
  ok(!a.ws.holding && (a.ws.br ?? 1) === 1, '腰だめでは止めない');
});

test('包帯: 体力が満タンなら使えない（減っていると使える）', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 10; i++) step(G, inp(a));
  const g = a.inv.gear.find(x => x.id === 'bandage'), n0 = g.n;
  let ev = [];
  for (let i = 0; i < 5; i++) ev.push(...step(G, inp(a, { act: i === 0 ? [{ a: 'gear', id: 'bandage' }] : null })));
  ok(ev.some(e => e.e === 'deny' && e.why === 'fullhp'), '満タン: 断られる');
  ok(g.n === n0 && !a.act, '数は減らず、巻き始めない');
  a.hp = a.maxHp - 30;
  ev = [];
  for (let i = 0; i < 5; i++) ev.push(...step(G, inp(a, { act: i === 0 ? [{ a: 'gear', id: 'bandage' }] : null })));
  ok(g.n === n0 - 1 && a.act && a.act.k === 'bandage', '減っている: 巻き始める');
});
