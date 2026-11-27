// 11-27: ほかの人から見た体: 跳んでいる間は足を引き上げる・乗り越えは片手を物の上につき、足をそろえて振り上げる
import { test, ok } from '../lib/t.mjs';
import { computePose, NBONE } from '../../src/engine/pose.js';

const base = () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, h: 1.8, stance: 0, lean: 0, moveX: 0, moveZ: 0, phase: 0, hold: 'rifle', ads: 0, low: 0, reload: -1, fire: 0, state: 'normal', stateT: 0 });
const pose = (p) => { const B = new Float32Array(NBONE * 12); computePose(p, B); return B; };
const Y = (B, i) => B[i * 12 + 1];
// 骨の番号: 7 handL・13 footL・16 footR
test('跳んでいる: 足が上がる', () => {
  const g = pose(base()), a = pose(Object.assign(base(), { air: 1 }));
  ok(Y(a, 13) > Y(g, 13) + 0.12, '左足 ' + Y(g, 13).toFixed(2) + '→' + Y(a, 13).toFixed(2));
  ok(Y(a, 16) > Y(g, 16) + 0.08, '右足 ' + Y(g, 16).toFixed(2) + '→' + Y(a, 16).toFixed(2));
});
test('乗り越え: 越える間は足を振り上げ、左手を物の上（前の 0.9m の高さ）につく', () => {
  const g = pose(base()), v = pose(Object.assign(base(), { vaultU: 0.35, vaultP: [0, 0.9, 0.5], stance: 0.5 }));
  ok(Y(v, 13) > Y(g, 13) + 0.15, '足 ' + Y(g, 13).toFixed(2) + '→' + Y(v, 13).toFixed(2));
  const hx = v[7 * 12], hy = Y(v, 7), hz = v[7 * 12 + 2];
  ok(Math.hypot(hx - 0, hy - 0.9, hz - 0.5) < 0.25, '手が物の上 ' + [hx, hy, hz].map(n => n.toFixed(2)).join(','));
});
