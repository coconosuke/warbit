// 大ハンマー（分隊長・突撃・偵察）: 振って壁に穴（レンガ・木 2 回、コンクリート 4 回）・近くの敵は 1 回で倒れる
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { classLoadout } from '../../src/war/classes.js';
import { heightAt, los } from '../../src/war/world.js';
import { M } from '../../src/engine/data/materials.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch || 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function hold(G, me) {
  if (!me.inv.gear.some(g => g.id === 'hammer')) me.inv.gear.push({ id: 'hammer', n: 1, n0: 1 });
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id: 'hammer' }] }) });
  for (let i = 0; i < 120 && !(me.ws.slot === 2 && me.ws.st === 'gear'); i++) step(G, { [me.id]: idle(me) });
}
function swing(G, me) { step(G, { [me.id]: idle(me, { fire: true }) }); for (let i = 0; i < Math.round(1.0 / G.S.dt); i++) step(G, { [me.id]: idle(me) }); }

test('大ハンマーは分隊長・突撃・偵察が持つ', () => {
  for (const c of ['leader', 'assault', 'recon']) ok(classLoadout(c).gear.some(g => g[0] === 'hammer'), c);
  for (const c of ['medic', 'support', 'engineer']) ok(!classLoadout(c).gear.some(g => g[0] === 'hammer'), c + ' は持たない');
});

function wallGame(mat) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, ww = G.w, me = S.actors[0];
  for (const b of S.actors) if (b !== me) { b.alive = false; b.dead = true; }
  const b = ww.boxes.find(q => q.alive && q.kind === 'wall' && q.mat === mat && q.z1 - q.z0 < 0.4 && q.x1 - q.x0 > 3 && q.y1 - q.y0 > 2.4 && Math.abs(q.y0 - heightAt(ww, (q.x0 + q.x1) / 2, q.z0 - 1.2)) < 0.4);
  if (!b) return null;
  const cx = (b.x0 + b.x1) / 2;
  me.x = cx; me.z = b.z0 - 1.2; me.y = heightAt(ww, me.x, me.z); me.vx = me.vz = 0; me.yaw = 0; me.pitch = -0.1;
  return { G, S, ww, me, b, cx };
}

test('レンガ（か木）の壁: 2 回叩くと穴が開いて向こうが見える', () => {
  const r = wallGame(M.BRICK) || wallGame(M.WOOD);
  ok(r, '壁');
  const { G, ww, me, b, cx } = r;
  hold(G, me);
  swing(G, me);
  ok(b.alive, '1 回では残る');
  swing(G, me);
  ok(!b.alive, '2 回で穴');
  const y = me.y + 1.3;
  ok(los(ww, cx, y, b.z0 - 0.5, cx, y, b.z1 + 0.5), '向こうが見える');
});

test('コンクリートの壁は 4 回', () => {
  const r = wallGame(M.CONCRETE);
  if (!r) { ok(true, 'コンクリートの壁がない'); return; }
  const { G, me, b } = r;
  hold(G, me);
  for (let i = 0; i < 3; i++) swing(G, me);
  ok(b.alive, '3 回では残る');
  swing(G, me);
  ok(!b.alive, '4 回で穴');
});

test('1.5m 先の敵は 1 回で倒れる（味方は叩かない）', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, me = S.actors[0], foe = S.actors.find(b => b.team !== me.team), mate = S.actors.find(b => b.team === me.team && b !== me);
  for (const b of S.actors) if (b !== me && b !== foe && b !== mate) { b.alive = false; b.dead = true; }
  for (const b of [foe, mate]) b.ai = null;
  const put = (b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
  put(me, 790, 690); put(mate, 790, 691.5);
  me.yaw = 0; me.pitch = -0.15;
  hold(G, me);
  swing(G, me);
  eq(mate.hp, mate.maxHp, '味方は無事');
  put(mate, 795, 700); put(foe, 790, 691.5);
  swing(G, me);
  ok(!foe.alive || foe.down, '敵は倒れた hp=' + foe.hp);
});
