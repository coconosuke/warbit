// 11-26: 建物が崩れる（BattleBit: 構造を RPG・C4 で壊すと崩れ、中の人はがれきで死ぬ。大きい建物は崩れない）
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { groundAt } from '../../src/war/world.js';
import { STRUCT, structHit, collapseBld, restoreWorld } from '../../src/war/destruct.js';

function game() { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); }
test('家は C4 3 個で崩れ（2 個では崩れない）、箱と段が消えてがれきが残る。元に戻せる', () => {
  const G = game(), w = G.w, bd = w.blds.find(b => b.kind === 'house');
  ok(bd, '家がある');
  const cx = (bd.rect[0] + bd.rect[2]) / 2, cz = (bd.rect[1] + bd.rect[3]) / 2;
  eq(structHit(w, cx, bd.y + 1, cz, 1).length, 0, '1 個');
  eq(structHit(w, cx, bd.y + 1, cz, 1).length, 0, '2 個');
  const hit = structHit(w, cx, bd.y + 1, cz, 1);
  eq(hit.length, 1, '3 個で崩れる');
  const nb = w.boxes.filter(b => b.bld === bd.id && b.alive).length;
  const ks = collapseBld(w, bd);
  ok(ks.length > 0 && bd.down, '崩れた');
  eq(w.boxes.filter(b => b.bld === bd.id && b.alive).length, 0, '建物の箱は残らない（前は ' + nb + '）');
  ok(w.ramps.filter(r => r.bld === bd.id).every(r => r.dead), '段も消える');
  ok(w.boxes.some(b => b.kind === 'rubble' && b.alive), 'がれき');
  restoreWorld(w);
  ok(!bd.down && w.boxes.filter(b => b.bld === bd.id && b.alive).length === nb && !w.boxes.some(b => b.kind === 'rubble'), '元に戻る');
});
test('集合住宅・事務所・倉庫は崩れない', () => {
  for (const k of ['apartment', 'office', 'warehouse', 'bunker']) ok(!STRUCT[k], k);
  const G = game(), w = G.w, bd = w.blds.find(b => b.kind === 'apartment');
  if (!bd) return;
  const cx = (bd.rect[0] + bd.rect[2]) / 2, cz = (bd.rect[1] + bd.rect[3]) / 2;
  for (let i = 0; i < 20; i++) eq(structHit(w, cx, bd.y + 1, cz, 1).length, 0, 'C4 ' + (i + 1));
});
test('C4 の爆発で崩れると、中の人は死ぬ（外の人は無事）', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }), S = G.S, w = G.w, bd = w.blds.find(b => b.kind === 'house');
  const [x0, z0, x1, z1] = bd.rect, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const me = S.actors[0], [a, b] = S.actors.filter(q => q !== me && q.ai);
  a.x = cx; a.z = cz; a.y = groundAt(w, cx, cz, bd.y + 1.5); a.team = 1;
  b.x = x1 + 6; b.z = cz; b.y = groundAt(w, b.x, b.z, bd.y + 1.5); b.team = 1;
  for (const q of [a, b]) { q.alive = true; q.dead = false; q.hp = 100; q.deployed = true; }
  const evs = [];
  for (let i = 0; i < 3; i++) { S.blasts.push({ x: x0 + 0.6, y: bd.y + 1, z: z0 + 0.6, r: 1.5, dmg: 1, kind: 'c4', by: me.id, t: 0 }); evs.push(...step(G, {})); }
  ok(bd.down && evs.some(e => e.e === 'collapse' && e.bld === bd.id), '崩れた');
  ok(!a.alive || a.down, '中の人');
  ok(b.alive && !b.down, '外の人は無事');
});
