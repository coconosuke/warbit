// C4（副の道具。既定）: 投げると物に貼りつく → 射撃モードで「起爆」→ 引き金でまとめて爆発。壁に 2m の穴（コンクリートも 1 回）
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { classLoadout } from '../../src/war/classes.js';
import { heightAt, los } from '../../src/war/world.js';
import { M } from '../../src/engine/data/materials.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch || 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);

test('副の道具: 衛生のほかは C4 ×4（既定）。「なし」も選べる', () => {
  for (const c of ['leader', 'assault', 'engineer', 'support', 'recon']) { const g = classLoadout(c).gear.find(x => x[0] === 'c4'); ok(g && g[1] === 4, c); }
  ok(!classLoadout('medic').gear.some(x => x[0] === 'c4'), '衛生は医療キット');
  ok(!classLoadout('assault', null, null, null, 'none').gear.some(x => x[0] === 'c4'), 'なし');
});

test('壁に投げて貼り、起爆すると壁に穴・そばの敵は倒れる。射撃モードで投げる／起爆を切り替える', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, ww = G.w, me = S.actors[0], foe = S.actors.find(b => b.team !== me.team);
  for (const b of S.actors) if (b !== me && b !== foe) { b.alive = false; b.dead = true; }
  foe.ai = null;
  const b = ww.boxes.find(q => q.alive && q.kind === 'wall' && (q.mat === M.BRICK || q.mat === M.CONCRETE) && q.z1 - q.z0 < 0.4 && q.x1 - q.x0 > 3 && q.y1 - q.y0 > 2.4 && Math.abs(q.y0 - heightAt(ww, (q.x0 + q.x1) / 2, q.z0 - 3)) < 0.4);
  ok(b, '壁');
  const cx = (b.x0 + b.x1) / 2;
  me.x = cx; me.z = b.z0 - 3; me.y = heightAt(ww, me.x, me.z); me.vx = me.vz = 0; me.yaw = 0; me.pitch = -0.05;
  foe.x = cx + 1.2; foe.z = b.z0 - 1.0; foe.y = heightAt(ww, foe.x, foe.z); foe.vx = foe.vz = 0;
  if (!me.inv.gear.some(g => g.id === 'c4')) me.inv.gear.push({ id: 'c4', n: 4, n0: 4 });
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'c4' }] }) });
  for (let i = 0; i < 120 && !(me.ws.slot === 2 && me.ws.st === 'gear'); i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { fire: true }) }); step(G, { [me.id]: idle(me) });
  eq(me.ws.c4m, 'throw', '投げても残りがあれば投げるのまま（いくつも貼れる）');
  for (let i = 0; i < 90; i++) step(G, { [me.id]: idle(me) });
  const n = S.nades.find(q => q.type === 'c4' && q.by === me.id);
  ok(n && n.stuck, '貼りついた');
  ok(n && Math.abs(n.z - b.z0) < 0.3, '壁の面 ' + (n && n.z.toFixed(2)) + ' / ' + b.z0.toFixed(2));
  eq(me.inv.gear.find(g => g.id === 'c4').n, 3, '残り 3');
  // 射撃モードで起爆へ・また投げるへ・また起爆へ
  step(G, { [me.id]: idle(me, { act: [{ a: 'mode' }] }) }); eq(me.ws.c4m, 'det', '起爆へ');
  step(G, { [me.id]: idle(me, { act: [{ a: 'mode' }] }) }); eq(me.ws.c4m, 'throw', '投げるへ');
  step(G, { [me.id]: idle(me, { act: [{ a: 'mode' }] }) }); eq(me.ws.c4m, 'det', '起爆へ');
  me.x = cx; me.z = b.z0 - 9; me.y = heightAt(ww, me.x, me.z);
  step(G, { [me.id]: idle(me, { fire: true }) });
  for (let i = 0; i < 5; i++) step(G, { [me.id]: idle(me) });
  ok(!S.nades.some(q => q.type === 'c4'), '爆発した');
  ok(!b.alive, '壁に穴');
  ok(!foe.alive || foe.down, 'そばの敵は倒れた');
  ok(me.alive && me.hp === me.maxHp, '離れた自分は無事');
  eq(me.ws.c4m, 'throw', '起爆したら投げるへ戻る');
});

test('C4 をいくつも貼ってから、まとめて起爆する（BattleBit と同じ）。4つ投げ切ると起爆へ', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); step(G, {});
  const S = G.S, me = S.actors[0];
  if (!me.inv.gear.some(g => g.id === 'c4')) me.inv.gear.push({ id: 'c4', n: 4, n0: 4 });
  me.inv.gear.find(g => g.id === 'c4').n = 4;
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'c4' }] }) });
  for (let i = 0; i < 120 && !(me.ws.slot === 2 && me.ws.st === 'gear'); i++) step(G, { [me.id]: idle(me) });
  const throwOnce = () => { step(G, { [me.id]: idle(me, { fire: true }) }); for (let i = 0; i < 45; i++) step(G, { [me.id]: idle(me) }); };
  const cnt = () => S.nades.filter(q => q.type === 'c4' && q.by === me.id).length;
  throwOnce(); throwOnce();
  // すぐ続けて押しても 0.6 秒の間は投げない
  step(G, { [me.id]: idle(me, { fire: true }) }); step(G, { [me.id]: idle(me) }); step(G, { [me.id]: idle(me, { fire: true }) });
  eq(cnt(), 3, '3つ貼った（続けて押した2回めは投げない）');
  eq(me.ws.c4m, 'throw', 'まだ投げる');
  for (let i = 0; i < 45; i++) step(G, { [me.id]: idle(me) });
  throwOnce();
  eq(cnt(), 4, '4つめ');
  eq(me.ws.c4m, 'det', '投げ切ると起爆へ');
  for (let i = 0; i < 60; i++) step(G, { [me.id]: idle(me) });
  me.x += 30;
  step(G, { [me.id]: idle(me, { fire: true }) });
  for (let i = 0; i < 5; i++) step(G, { [me.id]: idle(me) });
  eq(S.nades.filter(q => q.type === 'c4' && q.by === me.id).length, 0, '4つまとめて爆発');
});
