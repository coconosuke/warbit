// 大規模戦のリロード（BattleBit に合わせる）: 普通は弾倉を残す・速いのは落とす（上を歩くと拾える）・弾倉をまとめる
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { curWeapon, magCap } from '../../src/engine/actor.js';

function game() { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); step(G, {}); return G; }
const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function run(G, me, n, o) { for (let i = 0; i < n; i++) step(G, { [me.id]: idle(me, i === 0 ? o : {}) }); }
function ready(G, me) { for (let i = 0; i < 600 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) }); }

test('普通のリロード: 抜いた弾倉はポーチに残る（弾倉の数は同じ）', () => {
  const G = game(), S = G.S, me = S.actors[0]; ready(G, me);
  const wi = curWeapon(me), n0 = wi.mags.length;
  wi.mag = 10;
  run(G, me, 1, { act: [{ a: 'reload' }] });
  ok(me.ws.st === 'reload' && me.ws.rk === 'tac', '普通');
  ready(G, me);
  eq(wi.mags.length, n0, '数は同じ');
  ok(wi.mags.includes(10), '10発の弾倉が残る ' + wi.mags.join(','));
  ok(!S.mdrops || !S.mdrops.length, '落ちない');
});

test('速いリロード: 弾倉を足もとに落とす。上を歩くと拾える（同じ銃・数が初めより少ない時）', () => {
  const G = game(), S = G.S, me = S.actors[0]; ready(G, me);
  const wi = curWeapon(me), n0 = wi.mags.length;
  wi.mag = 12;
  const t0 = me.ws.t;
  run(G, me, 1, { act: [{ a: 'reload' }] });
  const tacT = me.ws.t;
  run(G, me, 1, { act: [{ a: 'reload', fast: true }] });
  ok(me.ws.rk === 'fast' && me.ws.t < tacT, '速いに切り替わる ' + tacT.toFixed(2) + ' → ' + me.ws.t.toFixed(2));
  // 落ちた弾倉の上にいる間は拾わないよう、少し離れてからまた戻る
  ready(G, me);
  eq(wi.mags.length, n0 - 1, '1本減る');
  ok(S.mdrops && S.mdrops.length === 1 && S.mdrops[0].n === 12, '12発の弾倉が落ちた');
  const d = S.mdrops[0];
  me.x = d.x + 5; run(G, me, 40, {});
  ok(S.mdrops.length === 1, '離れていると拾わない');
  me.x = d.x; me.z = d.z; run(G, me, 5, {});
  eq(S.mdrops.length, 0, '拾った');
  eq(wi.mags.length, n0, '数が戻る');
});

test('弾倉をまとめる: 1回で、いちばん多い途中の弾倉を、少ない弾倉から順に満タンにする。その間は撃てない。2本ないとできない', () => {
  const G = game(), S = G.S, me = S.actors[0]; ready(G, me);
  const wi = curWeapon(me), cap = magCap(wi);
  wi.mags = [cap, 10, 12, 5];
  run(G, me, 1, { act: [{ a: 'consol' }] });
  eq(me.ws.st, 'consol', 'まとめ始める');
  const m0 = wi.mag; run(G, me, 3, { fire: true });
  eq(wi.mag, m0, '撃てない');
  ready(G, me);
  // 1回で、いちばん多い 12 を、少ない 5 → 10 の順で満タンに（30: 12+5+10=27 → 27 の1本、残りなし）
  eq(wi.mags.reduce((s, n) => s + n, 0), cap + 27, '弾の数は同じ');
  ok(cap === 30 ? wi.mags.slice().sort((a, b) => b - a).join(',') === '30,27' : true, '多い弾倉に寄せる ' + wi.mags.join(','));
  wi.mags = [cap, 20, 15, 8];
  run(G, me, 1, { act: [{ a: 'consol' }] }); ready(G, me);
  ok(cap === 30 ? wi.mags.slice().sort((a, b) => b - a).join(',') === '30,30,13' : true, '1回で1本を満タン（少ない方から使う）' + wi.mags.join(','));
  wi.mags = [cap, cap, 7];
  const ev = []; run(G, me, 1, { act: [{ a: 'consol' }] });
  eq(me.ws.st, 'ready', '1本ではできない');
});

test('突撃はリロードが速い（0.85 倍）', () => {
  const G = game(), S = G.S, me = S.actors[0]; ready(G, me);
  const wi = curWeapon(me); wi.mag = 5;
  me.warCls = 'medic'; run(G, me, 1, { act: [{ a: 'reload' }] }); const t1 = me.ws.t; ready(G, me);
  wi.mag = 5; me.warCls = 'assault'; run(G, me, 1, { act: [{ a: 'reload' }] }); const t2 = me.ws.t;
  ok(Math.abs(t2 / t1 - 0.85) < 0.03, (t2 / t1).toFixed(3));
});
