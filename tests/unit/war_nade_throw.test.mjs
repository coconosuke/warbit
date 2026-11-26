// 11-26 の要望: 投げ物は押すとピンを抜き、離すと投げる（握っている間も信管が進む）。下投げのボタンの上で離すと近くへ軽く放る
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { fuseOf } from '../../src/engine/nades.js';

function game() { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); step(G, {}); return G; }
const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function hold(G, me, id = 'frag', n = 2) {
  const S = G.S;
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  const g = me.inv.gear.find(q => q.id === id); if (g) g.n = n; else me.inv.gear.push({ id, n });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id }] }) });
  for (let i = 0; i < 120 && me.ws.st !== 'gear'; i++) step(G, { [me.id]: idle(me) });
  eq(me.ws.st, 'gear', '手に持った');
  return S;
}

test('大規模戦の破片手榴弾: 信管 5 秒（BattleBit）、威力は半径 8m', () => {
  const G = game();
  eq(fuseOf(G.S, 'frag'), 5, '5 秒');
});

test('押しただけでは投げず、離すと投げる。握っていた分だけ信管が短い', () => {
  const G = game(), me = G.S.actors[0], S = hold(G, me);
  step(G, { [me.id]: idle(me, { fire: true }) });
  eq(S.nades.length, 0, '押しただけ');
  ok(me.ws.cook != null, 'ピンを抜いた');
  const T = Math.round(1.5 / S.dt);
  for (let i = 0; i < T; i++) step(G, { [me.id]: idle(me, { fire: true }) });
  eq(S.nades.length, 0, '握っている間は投げない');
  step(G, { [me.id]: idle(me, { fire: false }) });
  eq(S.nades.length, 1, '離すと投げる');
  const n = S.nades[0];
  ok(Math.abs(n.fuse - (5 - 1.5)) < 0.1, '信管の残り ' + n.fuse.toFixed(2));
  eq(me.inv.gear.find(q => q.id === 'frag').n, 1, '1つ減った');
});

test('握りすぎると手の中で爆発する', () => {
  const G = game(), me = G.S.actors[0], S = hold(G, me);
  const ev = [];
  for (let i = 0; i < Math.round(5.2 / S.dt) && me.alive && !me.down; i++) ev.push(...step(G, { [me.id]: idle(me, { fire: true }) }));
  ok(ev.some(e => e.e === 'throw' && e.hand), '手の中');
  for (let i = 0; i < 5; i++) ev.push(...step(G, { [me.id]: idle(me, { fire: true }) }));
  ok(!me.alive || me.down || me.hp < 30, '自分が巻き込まれた ' + me.hp);
});

test('下投げ: 上投げより低い所から、遅く短く放る', () => {
  const thr = (under) => {
    const G = game(), me = G.S.actors[0], S = hold(G, me);
    step(G, { [me.id]: idle(me, { fire: true }) });
    step(G, { [me.id]: idle(me, { fire: false, under }) });
    const n = S.nades[0];
    return { sp: Math.hypot(n.vx, n.vz), y: n.y - me.y };
  };
  const o = thr(false), u = thr(true);
  ok(u.sp < o.sp * 0.7, `速さ 上 ${o.sp.toFixed(1)} 下 ${u.sp.toFixed(1)}`);
  ok(u.y < o.y - 0.4, `高さ 上 ${o.y.toFixed(2)} 下 ${u.y.toFixed(2)}`);
});

test('衝撃手榴弾は握っても時間が進まない（手の中で爆発しない）', () => {
  const G = game(), me = G.S.actors[0], S = hold(G, me, 'impact', 1);
  for (let i = 0; i < Math.round(12 / S.dt); i++) step(G, { [me.id]: idle(me, { fire: true }) });
  eq(S.nades.length, 0, 'まだ持っている');
  ok(me.alive && !me.down, '無事');
  step(G, { [me.id]: idle(me, { fire: false }) });
  eq(S.nades.length, 1, '離すと投げる');
});

test('持ち替えると握りは取り消し（ピンを戻す。次に持った時にすぐ爆発しない）', () => {
  const G = game(), me = G.S.actors[0], S = hold(G, me);
  for (let i = 0; i < Math.round(3 / S.dt); i++) step(G, { [me.id]: idle(me, { fire: true }) });
  step(G, { [me.id]: idle(me, { fire: true, act: [{ a: 'switch', slot: 0 }] }) });
  for (let i = 0; i < 90; i++) step(G, { [me.id]: idle(me) });
  eq(S.nades.length, 0, '持ち替えでは投げない');
  ok(me.ws.slot === 0, '銃に持ち替えた');
  hold(G, me);
  step(G, { [me.id]: idle(me, { fire: true }) });
  ok(me.ws.cook != null && me.ws.cook < 0.1, '握り直しは 0 から ' + me.ws.cook);
  eq(S.nades.length, 0, '何も投げていない');
});
