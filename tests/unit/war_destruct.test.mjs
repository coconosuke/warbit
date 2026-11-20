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

test('RPG を壁に撃つと穴が開き、試合を作り直すと元に戻る', async () => {
  const { createGame, step } = await import('../../src/engine/engine.js');
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, ww = G.w, me = S.actors[0];
  for (const b of S.actors) if (b !== me) { b.alive = false; b.dead = true; }
  // 外から 12m 手前に開けた所があるレンガの壁
  let pick = null;
  for (const b of ww.boxes) {
    if (!b.alive || b.kind !== 'wall' || b.mat !== M.BRICK || b.z1 - b.z0 > 0.4 || b.x1 - b.x0 < 3 || b.y1 - b.y0 < 2.4) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, gy = heightAt(ww, cx, cz);
    if (b.y0 > gy + 0.3 || b.y0 < gy - 0.6) continue;
    for (const s of [-1, 1]) {
      const sz = cz + s * 12, sy = heightAt(ww, cx, sz) + 1.5;
      if (Math.abs(sy - (b.y0 + 1.5)) > 1) continue;
      if (los(ww, cx, sy, sz, cx, b.y0 + 1.3, cz + s * 0.4)) { pick = { b, cx, cz, sz, s }; break; }
    }
    if (pick) break;
  }
  ok(pick, '壁が見つかった');
  const { b, cx, cz, sz, s } = pick;
  me.x = cx; me.z = sz; me.y = heightAt(ww, cx, sz); me.vx = me.vz = 0;
  me.inv.long = 'rpg'; me.inv.rpg = { in: 1, n: 5, n0: 5 };
  const idle = (o = {}) => Object.assign({ mx: 0, mz: 0, yaw: me.yaw, pitch: me.pitch || 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle() });
  step(G, { [me.id]: idle({ act: [{ a: 'long' }] }) });
  for (let i = 0; i < 200 && !(me.ws.slot === 3 && me.ws.st === 'long'); i++) step(G, { [me.id]: idle() });
  me.yaw = Math.atan2(0, cz - sz); me.pitch = Math.atan2(b.y0 + 1.3 - (me.y + 1.55), 12);
  for (let i = 0; i < 90 && me.ads < 0.95; i++) step(G, { [me.id]: idle({ yaw: me.yaw, pitch: me.pitch, ads: true }) });
  const evs = [];
  const o1 = step(G, { [me.id]: idle({ yaw: me.yaw, pitch: me.pitch, ads: true, fire: true }) }); if (Array.isArray(o1)) evs.push(...o1);
  for (let i = 0; i < 30; i++) { const o = step(G, { [me.id]: idle({ yaw: me.yaw, pitch: me.pitch, ads: true }) }); if (Array.isArray(o)) evs.push(...o); }
  ok(evs.some(e => e.e === 'carve'), '壁が壊れた出来事');
  ok(!b.alive, '壁の箱が壊れた');
  ok((S.carves || []).length === 1, '記録');
  const G2 = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  ok(b.alive && G2.w === ww, '次の試合では元どおり（同じマップの形を使い回す）');
});

test('穴を開けたとき、描く塊ごとの物の表は変わった物だけ直す（全部を作り直した表と同じ）', async () => {
  const { buildWarFarChunk } = await import('../../src/war/render.js');
  const ww = warWorld('riverbend');
  restoreWorld(ww);
  buildWarFarChunk(ww, 0); // 表を作る
  const b = findWall(ww, M.BRICK);
  const cx = (b.x0 + b.x1) / 2, cy = b.y0 + 1.3, cz = (b.z0 + b.z1) / 2;
  const ks = carve(ww, cx, cy, cz - 0.3, 1.2);
  ok(ww._chunkItems, '表は捨てずに直す');
  const sig = (C) => C.it.map(c => c.boxes.map(q => q.id).sort((p, q) => p - q).join(',') + '|' + c.decos.length).join(';');
  const inc = sig(ww._chunkItems);
  ww._chunkItems = null; buildWarFarChunk(ww, ks[0]);
  ok(inc === sig(ww._chunkItems), '全部を作り直した表と同じ');
  restoreWorld(ww);
});
