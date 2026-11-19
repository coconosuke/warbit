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
test('前の「画面の揺れ: 弱」は揺れ 50% に移す。新しい項目の既定（名前 11px・敵の印あり・揺れ 100%・2回押し 0.4 秒）', async () => {
  const { loadSettings } = await import('../../src/app/settings.js');
  const mem = {};
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  try {
    let s = loadSettings();
    eq(s.nameSize, 11, '名前'); eq(s.showPings, true, '敵の印'); eq(s.shakeK, 1, '揺れ'); eq(s.rlDbl, 0.4, '2回押し');
    mem['hardentry.v1.settings'] = JSON.stringify({ shake: false });
    s = loadSettings();
    eq(s.shakeK, 0.5, '弱 → 50%');
    mem['hardentry.v1.settings'] = JSON.stringify({ shake: false, shakeK: 0.2 });
    eq(loadSettings().shakeK, 0.2, '新しい値があればそのまま');
  } finally { globalThis.localStorage = prev; }
});
