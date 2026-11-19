// タッチの見回しの取り出し: 遅れが小さく、こまごとの動きがそろい、止めるとぴたりと止まり、合計は指の動きと同じ
import { test, ok, eq } from '../lib/t.mjs';
import { LookResampler } from '../../src/ui/lookres.js';

function sim(evHz, fps, v, aligned) {
  const R = new LookResampler(), out = [];
  let last = 0, applied = 0;
  const stop = 900, end = 1300, pos = (t) => v * Math.min(t, stop) / 1000;
  const evs = [];
  if (aligned) for (let f = 0; f < end; f += 1000 / fps) evs.push(f - 1.5); else for (let t = 3; t < end; t += 1000 / evHz) evs.push(t);
  let ei = 0;
  for (let f = 0; f < end; f += 1000 / fps) {
    while (ei < evs.length && evs[ei] <= f) { const p = pos(evs[ei]); R.add(p - last, 0, evs[ei]); last = p; ei++; }
    applied += R.take(f)[0];
    out.push([f, applied, last]);
  }
  const st = out.filter(o => o[0] > 200 && o[0] < stop - 30);
  const lag = st.reduce((s, o) => s + (o[2] - o[1]), 0) / st.length / v * 1000;
  const sp = []; for (let i = 1; i < st.length; i++) sp.push((st[i][1] - st[i - 1][1]));
  const m = sp.reduce((s, q) => s + q, 0) / sp.length, cv = Math.sqrt(sp.reduce((s, q) => s + (q - m) ** 2, 0) / sp.length) / m;
  const tail = out.find(o => o[0] > stop && Math.abs(o[1] - pos(stop)) < 0.3);
  return { lag, cv, tail: tail ? tail[0] - stop : 999, err: out[out.length - 1][1] - pos(stop) };
}

test('こまの直前に届く（iPhone の Safari）: 遅れ 8ms 未満・そろっている・すぐ止まる・合計は同じ', () => {
  const r = sim(0, 60, 400, true);
  ok(r.lag < 8, '遅れ ' + r.lag.toFixed(1)); ok(r.cv < 0.02, 'ばらつき ' + r.cv.toFixed(3)); ok(r.tail < 34, '尾 ' + r.tail); ok(Math.abs(r.err) < 1e-6, '合計');
});
test('120Hz で届く・こまは 60: 遅れ 8ms 未満・そろっている', () => {
  const r = sim(120, 60, 400, false);
  ok(r.lag < 8, '遅れ ' + r.lag.toFixed(1)); ok(r.cv < 0.03, 'ばらつき ' + r.cv.toFixed(3)); ok(Math.abs(r.err) < 1e-6, '合計');
});
test('ゆっくり（30px/s）でも段にならない', () => {
  const r = sim(60, 60, 30, false);
  ok(r.cv < 0.05, 'ばらつき ' + r.cv.toFixed(3)); ok(r.lag < 10, '遅れ ' + r.lag.toFixed(1));
});
test('止まっていた後の動き出し: 止まっていた時間に動きを広げない（次のこまから動く）', () => {
  const R = new LookResampler();
  R.add(5, 0, 0); R.take(20); R.take(40);
  eq(R.pending()[0], 0, '全部出た');
  R.add(10, 0, 500);
  const d = R.take(517)[0] + R.take(534)[0];
  ok(d > 9.9, '2こまで出る ' + d.toFixed(2));
});
