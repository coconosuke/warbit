// 11-26: 形を作る道具と大規模戦の形の段。頂点の書き方を変えても形は同じ・近い形は少しずつ作れて結果は同じ・遠い形の2段目は三角形が少ない
import { test, ok, eq } from '../lib/t.mjs';
import { createGame } from '../../src/engine/engine.js';
import { MeshBuilder, WV } from '../../src/render/build.js';
import { buildWarNear, buildWarNearJob, buildWarFarChunk, buildWarFar2Chunk, CH } from '../../src/war/render.js';

function game() { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }); }

test('MeshBuilder: 伸びる配列・すその複製・空にする・足し合わせ', () => {
  const B = new MeshBuilder();
  for (let k = 0; k < 3000; k++) B.box(k, 0, 0, k + 1, 1, 1, 0, [0.5, 0.5, 0.5]);
  eq(B.n, 3000 * 24, '頂点の数');
  const { v, i } = B.arrays();
  eq(v.length, B.n * WV, '使っている長さだけ渡す');
  ok(i instanceof Uint32Array, '6万頂点を超えたら 32bit の番号');
  const t = B.dupVert(3, -2);
  eq(B.v[t * WV + 1], B.v[3 * WV + 1] - 2, 'すその頂点は下へずれる');
  eq(B.v[t * WV], B.v[3 * WV], 'ほかは同じ');
  const C = new MeshBuilder(); C.box(0, 0, 0, 1, 1, 1, 0, [1, 0, 0]);
  const n0 = C.n; C.append(B);
  eq(C.n, n0 + B.n, '足した頂点の数'); eq(C.i[C.i.length - 1], B.i[B.i.length - 1] + n0, '番号はずらす');
  C.reset(); eq(C.n, 0); eq(C.i.length, 0);
});

test('近い形は少しずつ作っても、一度に作ったのと同じ', () => {
  const G = game(), ww = G.w;
  const NX = Math.ceil(ww.sx / CH), NZ = Math.ceil(ww.sz / CH);
  // 箱がいちばん多い塊（町）
  let k = 0, best = -1;
  for (let q = 0; q < NX * NZ; q++) { const cx = q % NX, cz = Math.floor(q / NX); const n = ww.boxes.filter(b => b.alive && Math.floor((b.x0 + b.x1) / 2 / CH) === cx && Math.floor((b.z0 + b.z1) / 2 / CH) === cz).length; if (n > best) { best = n; k = q; } }
  const a = buildWarNear(ww, k, { split: true });
  const g = buildWarNearJob(ww, k, { split: true });
  let steps = 0, r; do { r = g.next(); steps++; } while (!r.done);
  ok(steps > 5, '何回かに分かれる ' + steps);
  for (const key of ['B', 'BX']) {
    const x = a[key].arrays(), y = r.value[key].arrays();
    eq(x.v.length, y.v.length, key + ' 頂点'); eq(x.i.length, y.i.length, key + ' 番号');
    let d = 0; for (let q = 0; q < x.v.length; q++) d = Math.max(d, Math.abs(x.v[q] - y.v[q]));
    ok(d === 0, key + ' 同じ値');
  }
});

test('遠い形の2段目: どの塊も作れて、三角形は遠い形より少ない（全体で 7 割以下）', () => {
  const G = game(), ww = G.w;
  const NX = Math.ceil(ww.sx / CH), NZ = Math.ceil(ww.sz / CH);
  let t1 = 0, t2 = 0;
  for (let k = 0; k < NX * NZ; k++) {
    const f = buildWarFarChunk(ww, k).B, f2 = buildWarFar2Chunk(ww, k).B;
    t1 += f.i.length / 3; t2 += f2.i.length / 3;
    ok(f2.i.length <= f.i.length, '塊 ' + k + ' で増えない');
  }
  ok(t2 < t1 * 0.7, `遠い形 ${t1} → 2段目 ${t2}`);
});
