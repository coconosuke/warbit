import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { ceilAt, makeWarWorld, addBox, addRamp, finishWorld } from '../../src/war/world.js';
import { moveActor } from '../../src/engine/move.js';
import { M } from '../../src/engine/data/materials.js';

// 建物の階段: リバーベンドの階段のある建物を全部、1階から階段をつないで最上階（アパート・事務所は屋上の階段小屋の扉の外）まで
// 上がり、また1階まで下りる。どこでも止まらない・高さが合う・瞬間移動しない（建物の外へ放り出されない）・天井でかがまない
const UP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
function ends(r) {
  const [fx, fz] = UP[r.dir], alongZ = fz !== 0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  return { fx, fz, lo: alongZ ? [cx, fz > 0 ? r.z0 : r.z1] : [fx > 0 ? r.x0 : r.x1, cz], hi: alongZ ? [cx, fz > 0 ? r.z1 : r.z0] : [fx > 0 ? r.x1 : r.x0, cz] };
}
function routes(seed) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed, bots: false });
  const S = G.S, ww = G.w, a = S.actors[0];
  const inp = (o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });
  const goTo = (x, z) => {
    let jump = 0, crouch = 0, px = a.x, pz = a.z;
    for (let n = 0; n < 360; n++) {
      const dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz); if (d < 0.18) break;
      a.oob = 0; step(G, inp({ mz: Math.min(1, d / 0.5 + 0.2), yaw: Math.atan2(dx, dz) }));
      jump = Math.max(jump, Math.hypot(a.x - px, a.z - pz)); px = a.x; pz = a.z; if (a.st > 0.5) crouch++;
    }
    return { ok: Math.hypot(x - a.x, z - a.z) < 0.4, jump, crouch };
  };
  const byB = new Map(), bad = [], kinds = new Map();
  for (const r of ww.ramps) if (r.kind === 'stair' && r.bld >= 0) { if (!byB.has(r.bld)) byB.set(r.bld, []); byB.get(r.bld).push(r); }
  for (const [bid, rs] of byB) {
    const b = ww.blds.find(q => q.id === bid); rs.sort((p, q) => p.y0 - q.y0);
    const pts = [];
    for (const r of rs) { const e = ends(r); pts.push([e.lo[0] - e.fx * 0.6, e.lo[1] - e.fz * 0.6, r.y0], [e.hi[0] + e.fx * 0.5, e.hi[1] + e.fz * 0.5, r.y1]); }
    const last = rs[rs.length - 1], le = ends(last), roof = b.kind === 'apartment' || b.kind === 'office';
    if (roof) {
      const hx = (Math.min(...rs.map(r => r.x0)) + Math.max(...rs.map(r => r.x1))) / 2, hz = (Math.min(...rs.map(r => r.z0)) + Math.max(...rs.map(r => r.z1))) / 2;
      pts.push([le.fz ? hx : le.hi[0] + le.fx * 0.6, le.fz ? le.hi[1] + le.fz * 0.6 : hz, last.y1], [le.fz ? hx : le.hi[0] + le.fx * 2.6, le.fz ? le.hi[1] + le.fz * 2.6 : hz, last.y1]);
    }
    Object.assign(a, { x: pts[0][0], z: pts[0][1], y: pts[0][2], vx: 0, vz: 0, vy: 0, alive: true, dead: false, down: false, st: 0, oob: 0 }); a.hp = a.maxHp;
    for (let i = 0; i < 10; i++) step(G, inp());
    const why = [];
    const leg = (i, tag) => { const [x, z, y] = pts[i], r = goTo(x, z); if (!r.ok) return why.push(`${tag} ${i} に着かない`); if (Math.abs(a.y - y) > 0.35) return why.push(`${tag} ${i} 高さ ${a.y.toFixed(2)}≠${y.toFixed(2)}`); if (r.jump > 0.4) why.push(`${tag} ${i} 瞬間移動 ${r.jump.toFixed(2)}m`); if (r.crouch > 5) why.push(`${tag} ${i} かがむ`); };
    for (let i = 1; i < pts.length && !why.length; i++) leg(i, '上り');
    if (!why.length && roof && ceilAt(ww, a.x, a.z, a.y) - a.y < 50) why.push('屋上に出ていない');
    for (let i = pts.length - 2; i >= 0 && !why.length; i--) leg(i, '下り');
    kinds.set(b.kind, (kinds.get(b.kind) || 0) + 1);
    if (why.length) bad.push(`${b.kind}#${bid}: ${why.join(' / ')}`);
  }
  return { bad, kinds };
}

test('war stairs: 階段のある建物を全部、1階から最上階・屋上まで上がって下りられる（2つの並び）', () => {
  for (const seed of [3, 7]) {
    const { bad, kinds } = routes(seed);
    for (const k of ['house', 'apartment', 'office', 'shop', 'tower', 'chapel', 'barn', 'warehouse']) ok((kinds.get(k) || 0) > 0, `${k} がある（seed ${seed}）`);
    ok(bad.length === 0, `seed ${seed}: ${bad.slice(0, 4).join(' | ')}`);
  }
});

test('war stairs: 上へ歩いて頭が屋根の板に入っても、建物の外へ放り出されない（動く前の所で止まる）', () => {
  // 10m 四方の屋根の板（高さ 2.75〜3.0）の下で、坂を上がって板に頭が入る
  const ww = makeWarWorld({ sx: 64, sz: 64, hs: 2 });
  addBox(ww, { x0: 20, y0: 2.75, z0: 20, x1: 30, y1: 3.0, z1: 30, kind: 'floor', mat: M.CONCRETE });
  addRamp(ww, { x0: 24, z0: 20, x1: 25.2, z1: 26, y0: 0, y1: 2.4, dir: 'n' });
  finishWorld(ww);
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  const S = G.S, a = S.actors[0];
  Object.assign(a, { x: 24.6, z: 26.3, y: 0, vx: 0, vz: 0, vy: 0, st: 0, yaw: Math.PI });
  let maxJump = 0;
  let minRoom = 9;
  for (let i = 0; i < 600; i++) {
    const px = a.x, pz = a.z;
    moveActor(S, ww, a, { mx: 0, mz: 1, yaw: Math.PI, pitch: 0, stance: 0, lean: 0, sprint: false }, 1 / 60, null);
    maxJump = Math.max(maxJump, Math.hypot(a.x - px, a.z - pz)); minRoom = Math.min(minRoom, 2.75 - a.y);
  }
  ok(minRoom < 0.9, `板の近くまで上がる（すき間 ${minRoom.toFixed(2)}m）`);
  ok(maxJump < 0.3, `一度に動いた最大 ${maxJump.toFixed(2)}m`);
  ok(a.x > 20 && a.x < 30 && a.z > 20 && a.z < 30, `屋根の下にいる（${a.x.toFixed(1)}, ${a.z.toFixed(1)}）`);
});
