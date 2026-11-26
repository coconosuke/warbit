// 11-26 22:48: 高い倍率で細かい狙いが効かない → ゆっくり動かした分は細かく・高い倍率は揺れを少し小さく
import { test, ok, near } from '../lib/t.mjs';
import { fineAimK } from '../../src/app/settings.js';

test('スコープの細かい操作: 3倍以上でゆっくり動かすと感度が下がり、速く動かすといつもどおり', () => {
  near(fineAimK(10, 1.5, 'mid'), 1, 1e-9, '等倍・低倍率は変えない');
  near(fineAimK(10, 8, 'off'), 1, 1e-9, 'オフ');
  const slow = fineAimK(20, 8, 'mid'), fast = fineAimK(600, 8, 'mid');
  ok(slow < 0.6 && slow > 0.4, '8倍でゆっくり ' + slow.toFixed(2));
  near(fast, 1, 1e-9, '速い時はそのまま');
  ok(fineAimK(20, 4, 'mid') > slow, '4倍は 8倍より弱く');
  ok(fineAimK(20, 8, 'strong') < slow && fineAimK(20, 8, 'weak') > slow, '強さの順');
  let prev = 0; for (let v = 0; v <= 500; v += 10) { const k = fineAimK(v, 8, 'mid'); ok(k >= prev - 1e-9, 'なめらかに増える'); prev = k; }
});
