// ボットの目（11-20）: 木の葉のかさの向こうは見えにくい・胸が隠れていても頭が出ていれば見つける・視野の端は走る相手にだけ気づく
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt, los } from '../../src/war/world.js';

function game(o = {}) { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); }
const inp = (a, o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });
const put = (G, b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };

test('木の葉のかさを通る線は隠れる（かさの上を通る線は通らない）', async () => {
  const { bushesBetween } = await import('../../src/war/ai.js');
  const G = game(), w = G.w;
  // 近くに茂みもほかの木もない木
  const t = (w.trees || []).find(q => q.kind !== 'pine' && !(w.trees.some(o => o !== q && Math.hypot(o.x - q.x, o.z - q.z) < 14)) && !(w.bushes || []).some(b => Math.hypot(b.x - q.x, b.z - q.z) < 14));
  ok(t, '離れて立つ木がある');
  const s = t.s || 1, cy = t.y + 4.3 * s;
  ok(bushesBetween(w, t.x - 12, cy, t.z, t.x + 12, cy, t.z) >= 1, 'かさのまん中を通る線');
  ok(bushesBetween(w, t.x - 12, cy + 8 * s, t.z, t.x + 12, cy + 8 * s, t.z) === 0, 'かさの上を通る線');
});

// 開けた平らな所（まわり 40m に何もない）を探す
function openSpot(G) {
  const w = G.w;
  for (let z = 300; z < 1100; z += 23) for (let x = 300; x < 1100; x += 29) {
    const y = heightAt(w, x, z);
    let okk = true;
    for (const [dx, dz] of [[0, 30], [0, -30], [30, 0], [-30, 0], [20, 20], [-20, 20]]) {
      const y2 = heightAt(w, x + dx, z + dz);
      if (Math.abs(y2 - y) > 1.2 || !los(w, x, y + 0.4, z, x + dx, y2 + 0.4, z + dz)) { okk = false; break; }
    }
    if (okk) return [x, z];
  }
  return null;
}
function duel(G) {
  const S = G.S, me = S.actors[0];
  const foe = S.actors.find(b => b.team === 1 && b.ai);
  for (const b of S.actors) if (b !== me && b !== foe) { b.alive = false; b.dead = true; }
  return [S, me, foe];
}

test('視野の端（約 75°）: 止まっている相手には気づかず、走っている相手には気づく', () => {
  const G = game({ bots: true, per: 2 });
  const [S, me, foe] = duel(G);
  const sp = openSpot(G); ok(sp, '開けた所');
  const [cx, cz] = sp;
  // 敵ボットは +z を向き、相手は斜め 75° 先 25m
  const ang = 75 * Math.PI / 180, R = 25;
  const hold = (run) => { put(G, foe, cx, cz); foe.yaw = 0; foe.ai.tgt = null; put(G, me, cx + Math.sin(ang) * R, cz + Math.cos(ang) * R); if (run) { me.spd = 4.5; } };
  let saw = false;
  for (let i = 0; i < 240; i++) { hold(false); step(G, inp(me)); if (foe.ai.tgt === me.id) saw = true; }
  ok(!saw, '止まっている相手は見ない');
  for (let i = 0; i < 300 && !saw; i++) { hold(true); step(G, inp(me, { mx: 1, sprint: true })); if (foe.ai.tgt === me.id) saw = true; }
  ok(saw, '走っている相手には気づく');
});

test('壁の向こうの銃声: 見えなくても、音のしたおおよその向きへ振り向く', async () => {
  const { addBox, reindexBox } = await import('../../src/war/world.js');
  const G = game({ bots: true, per: 2 });
  const [S, me, foe] = duel(G);
  const sp = openSpot(G); ok(sp, '開けた所');
  const [cx, cz] = sp, y0 = heightAt(G.w, cx, cz);
  // 敵ボットの後ろ（-z）20m に自分、その間 8m に高い壁
  const wb = addBox(G.w, { x0: cx - 6, x1: cx + 6, z0: cz - 8.3, z1: cz - 7.7, y0: y0 - 1, y1: y0 + 6, mat: 0, kind: 'wall' }); reindexBox(G.w, wb);
  let turned = false;
  for (let i = 0; i < 240 && !turned; i++) {
    put(G, foe, cx, cz); if (i === 0) foe.yaw = 0; foe.ai.tgt = null;
    put(G, me, cx, cz - 20);
    me.fireK = 1;
    step(G, inp(me));
    const back = Math.abs(Math.atan2(Math.sin(foe.yaw - Math.PI), Math.cos(foe.yaw - Math.PI)));
    if (back < 0.5) turned = true;
  }
  ok(turned, '後ろ（音の方）を向いた ' + foe.yaw.toFixed(2));
});
