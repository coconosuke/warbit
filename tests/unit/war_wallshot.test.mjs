// 11-20: 弾でも、れんが・木・石膏の壁は少しずつ崩れる（BattleBit の 52）。コンクリートは崩れない
import { test, ok, eq } from '../lib/t.mjs';
import { createGame } from '../../src/engine/engine.js';
import { wallShot } from '../../src/engine/combat.js';
import { M } from '../../src/engine/data/materials.js';

function game() { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); }
const thin = (b) => Math.min(b.x1 - b.x0, b.z1 - b.z0) <= 0.5 && Math.max(b.x1 - b.x0, b.z1 - b.z0) > 2 && b.y1 - b.y0 > 2;
function shoot(G, b, n, pen0 = 700) {
  const S = G.S, w = G.w, ev = [];
  const hx = (b.x0 + b.x1) / 2, hy = b.y0 + 1.3, hz = (b.z0 + b.z1) / 2;
  for (let i = 0; i < n; i++) wallShot(S, w, { kind: 'box', id: b.id, nx: 0, ny: 0, nz: 0 }, hx, hy, hz, { pen0, pellet: false }, ev);
  return ev.filter(e => e.e === 'carve');
}
test('れんがの壁: 小銃の弾 60 発で 0.7m の穴（59 発では開かない）', () => {
  const G = game(), b = G.w.boxes.find(q => q.alive && q.kind === 'wall' && q.mat === M.BRICK && thin(q));
  ok(b, 'れんがの薄い壁がある');
  eq(shoot(G, b, 59).length, 0, '59 発');
  const c = shoot(G, b, 1);
  eq(c.length, 1, '60 発目で穴');
  ok(!b.alive, '元の箱は壊れて分かれた');
});
test('コンクリートの壁は弾では崩れない', () => {
  const G = game(), b = G.w.boxes.find(q => q.alive && q.kind === 'wall' && q.mat === M.CONCRETE && thin(q));
  if (!b) { ok(true, 'コンクリートの薄い壁がない'); return; }
  eq(shoot(G, b, 300).length, 0, '300 発');
  ok(b.alive, 'そのまま');
});
