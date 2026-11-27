// 倍率ごとの感度（BattleBit のように倍率ごとに選べる）
import { test, ok, eq } from '../lib/t.mjs';
import { DEFAULTS, sensForZoom } from '../../src/app/settings.js';

test('倍率ごとの感度: その倍率の値。間の倍率は下の倍率の値を倍率で割る（画面の上の速さがそろう）', () => {
  const st = { sensZ: { ...DEFAULTS.sensZ } };
  eq(sensForZoom(st, 4), DEFAULTS.sensZ[4], '4倍');
  eq(sensForZoom(st, 6), DEFAULTS.sensZ[6], '6倍');
  ok(Math.abs(sensForZoom(st, 5) - DEFAULTS.sensZ[4] * 4 / 5) < 1e-9, '5倍は 4倍の値 × 4/5');
  ok(Math.abs(sensForZoom(st, 12) - DEFAULTS.sensZ[8] * 8 / 12) < 1e-9, '12倍は 8倍の値 × 8/12');
  st.sensZ[4] = 0.9;
  eq(sensForZoom(st, 4), 0.9, '変えた値');
  eq(sensForZoom(st, 2), DEFAULTS.sensZ[2], 'ほかは変わらない');
});
test('前の感度（スコープ 1つ）と同じ速さ（既定）', () => {
  const old = (z) => 0.45 * Math.min(1.6, 4 / z);
  for (const z of [2, 3, 4, 6, 8, 12]) ok(Math.abs(sensForZoom({ sensZ: DEFAULTS.sensZ }, z) - old(z)) < 0.002, z + '倍 ' + sensForZoom({ sensZ: DEFAULTS.sensZ }, z).toFixed(3) + ' / ' + old(z).toFixed(3));
});
test('前の「画面の揺れ: 弱」は揺れ 50% に移す。新しい項目の既定（名前 10px（11-20 に小さく）・味方の印の濃さ 80%・敵の印あり・揺れ 100%・2回押し 0.4 秒）', async () => {
  const { loadSettings } = await import('../../src/app/settings.js');
  const mem = {};
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  try {
    let s = loadSettings();
    eq(s.nameSize, 10, '名前'); eq(s.markAlpha, 0.8, '味方の印の濃さ'); eq(s.showPings, true, '敵の印'); eq(s.shakeK, 1, '揺れ'); eq(s.rlDbl, 0.4, '2回押し');
    mem['hardentry.v1.settings'] = JSON.stringify({ shake: false });
    s = loadSettings();
    eq(s.shakeK, 0.5, '弱 → 50%');
    mem['hardentry.v1.settings'] = JSON.stringify({ shake: false, shakeK: 0.2 });
    eq(loadSettings().shakeK, 0.2, '新しい値があればそのまま');
  } finally { globalThis.localStorage = prev; }
});

test('15・20・40 倍は倍率ごとに感度を決められる（既定は前と同じ効き方）', () => {
  const st = { sensZ: { ...DEFAULTS.sensZ } };
  for (const z of [15, 20, 40]) {
    ok(DEFAULTS.sensZ[z] != null, z + '倍の項目');
    ok(Math.abs(sensForZoom(st, z) - DEFAULTS.sensZ[8] * 8 / z) < 0.0005, z + '倍の既定は前（8 倍の値 × 8/倍率）と同じ ' + sensForZoom(st, z).toFixed(4));
  }
  st.sensZ[20] = 0.2;
  eq(sensForZoom(st, 20), 0.2, '20倍だけ変わる');
  ok(Math.abs(sensForZoom(st, 15) - DEFAULTS.sensZ[15]) < 1e-9, '15倍はそのまま');
  ok(Math.abs(sensForZoom(st, 40) - DEFAULTS.sensZ[40]) < 1e-9, '40倍はそのまま');
});
