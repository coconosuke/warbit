// 壁と床を壊す（RPG の HEAT）: 薄い壁に四角い穴、床に穴。コンクリートは 2 回目から。試合をまたいで元に戻す
import { test, ok, eq } from '../lib/t.mjs';
import { warWorld } from '../../src/war/maps/index.js';
import { carve, restoreWorld, HOLE } from '../../src/war/destruct.js';
import { los, heightAt } from '../../src/war/world.js';
import { M } from '../../src/engine/data/materials.js';

// 2 階より上の、レンガの外壁（x にそって薄い）を探す
function findWall(ww, mat) {
  return ww.boxes.find(b => b.alive && b.kind === 'wall' && b.mat === mat && b.z1 - b.z0 < 0.4 && b.x1 - b.x0 > 3 && b.y1 - b.y0 > 2.4 && b.y0 > heightAt(ww, b.x0, b.z0) - 0.5);
}

test('レンガの壁: 爆発の所に 1.5m の穴が開き、穴を見通せる。まわりの壁は残る。元に戻せる', () => {
  const ww = warWorld('riverbend');
  restoreWorld(ww);
  const b = findWall(ww, M.BRICK);
  ok(b, 'レンガの壁');
  const n0 = ww.boxes.length;
  const cx = (b.x0 + b.x1) / 2, cy = b.y0 + 1.3, cz = (b.z0 + b.z1) / 2;
  ok(!los(ww, cx, cy, cz - 1, cx, cy, cz + 1), '前は見通せない');
  const ks = carve(ww, cx, cy, cz - 0.3, 1.2);
  ok(ks.length >= 1, '塊が変わった');
  ok(!b.alive, '元の箱は壊れた');
  ok(ww.boxes.length > n0, '残りの箱');
  ok(los(ww, cx, cy, cz - 1, cx, cy, cz + 1), '穴を見通せる');
  ok(!los(ww, cx + HOLE.w, cy, cz - 1, cx + HOLE.w, cy, cz + 1), '穴の外は見通せない');
  ok(restoreWorld(ww), '戻した');
  ok(b.alive && ww.boxes.length === n0, '元どおり');
  ok(!los(ww, cx, cy, cz - 1, cx, cy, cz + 1), '戻すと見通せない');
});

test('コンクリートの壁は 1 回目は欠けるだけ、2 回目で穴', () => {
  const ww = warWorld('riverbend');
  restoreWorld(ww);
  const b = findWall(ww, M.CONCRETE);
  if (!b) { ok(true, 'コンクリートの壁がない'); return; }
  const cx = (b.x0 + b.x1) / 2, cy = b.y0 + 1.3, cz = (b.z0 + b.z1) / 2;
  carve(ww, cx, cy, cz - 0.3, 1.2);
  ok(b.alive, '1 回目は残る');
  carve(ww, cx, cy, cz - 0.3, 1.2);
  ok(!b.alive, '2 回目で穴');
  restoreWorld(ww);
  ok(b.alive && !b.dmg, '戻す');
});

test('遠い爆発（壁から 2m）は穴を開けない', () => {
  const ww = warWorld('riverbend');
  restoreWorld(ww);
  const b = findWall(ww, M.BRICK);
  const cx = (b.x0 + b.x1) / 2, cy = b.y0 + 1.3, cz = (b.z0 + b.z1) / 2;
  eq(carve(ww, cx, cy, b.z0 - 2, 1.2).length, 0, '変わらない');
  ok(b.alive, '残る');
});
