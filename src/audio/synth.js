// 効果音を手続きで作る（外部の音素材は使わない）。DOMを使わないので Node でも書き出して検査できる。
// 銃声は「銃口の爆風（広い帯域の破裂）」「胴の響き（低い山）」「超音速の弾のクラック（小銃）」「機関部の金属音」の重ね合わせ。
// 残響（屋内・屋外）は再生側（audio.js）で付ける。
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const TAU = Math.PI * 2;

function lp(x, fc, sr) { const a = Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = x[i] * (1 - a) + y * a; x[i] = y; } return x; }
function hp(x, fc, sr) { const a = Math.exp(-TAU * fc / sr); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } return x; }
function bp(x, f, q, sr) {
  const w = TAU * f / sr, al = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; const y = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
// 時間で変わるローパス（f0 → f1）
function lpSweep(x, f0, f1, sr) { let y = 0; for (let i = 0; i < x.length; i++) { const f = f0 * Math.pow(f1 / f0, i / x.length); const a = Math.exp(-TAU * f / sr); y = x[i] * (1 - a) + y * a; x[i] = y; } return x; }
function env(n, sr, a, d, curve = 3) { const e = new Float32Array(n); const na = Math.max(1, Math.floor(a * sr)); for (let i = 0; i < n; i++) e[i] = i < na ? i / na : Math.pow(Math.max(0, 1 - (i - na) / Math.max(1, d * sr)), curve); return e; }
// 指数の減衰（tau 秒で 1/e）
function expEnv(n, sr, a, tau) { const e = new Float32Array(n); const na = Math.max(1, Math.floor(a * sr)); for (let i = 0; i < n; i++) e[i] = i < na ? i / na : Math.exp(-(i - na) / (tau * sr)); return e; }
function mixInto(dst, src, at = 0, g = 1) { at = Math.max(0, Math.floor(at)); for (let i = 0; i < src.length && at + i < dst.length; i++) dst[at + i] += src[i] * g; return dst; }
function noise(n, r) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; }
function normalize(x, peak = 0.9) { let m = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }
function sine(n, sr, f0, f1 = f0, ph = 0) { const x = new Float32Array(n); let p = ph; for (let i = 0; i < n; i++) { const f = f0 * Math.pow(f1 / f0, i / n); p += TAU * f / sr; x[i] = Math.sin(p); } return x; }
function mulEnv(x, e) { for (let i = 0; i < x.length; i++) x[i] *= e[i]; return x; }
function sat(x, drive) { const k = Math.tanh(drive); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k; return x; }
function buf(sr, dur) { return new Float32Array(Math.max(1, Math.floor(sr * dur))); }
const S = (sr, t) => Math.floor(sr * t);
// 端をなめらかに（プツッと鳴らないように）
function fadeEdges(x, sr, a = 0.0005, b = 0.01) { const na = Math.max(1, S(sr, a)), nb = Math.max(1, S(sr, b)); for (let i = 0; i < na && i < x.length; i++) x[i] *= i / na; for (let i = 0; i < nb && i < x.length; i++) x[x.length - 1 - i] *= i / nb; return x; }

// ---- 部品
// 金属のカチッ（共鳴する小さな部品）
function clack(sr, r, f = 2400, dur = 0.05, g = 1) {
  const n = S(sr, dur), out = new Float32Array(n);
  const nz = noise(n, r); hp(nz, 1500, sr); mulEnv(nz, expEnv(n, sr, 0.0003, 0.004)); mixInto(out, nz, 0, 0.8 * g);
  for (const m of [1, 1.47, 2.31, 3.1]) { const s = sine(n, sr, f * m * (0.97 + r() * 0.06)); mulEnv(s, expEnv(n, sr, 0.0002, 0.006 + r() * 0.01)); mixInto(out, s, 0, 0.25 * g / m); }
  return out;
}
// 低い山（胴の響き）
function thump(sr, r, f0, f1, dur, g = 1) { const n = S(sr, dur); const s = sine(n, sr, f0, f1, r() * TAU); mulEnv(s, expEnv(n, sr, 0.0015, dur * 0.28)); for (let i = 0; i < n; i++) s[i] *= g; return s; }
// 破裂（爆風）: 広い帯域、立ち上がりが鋭い
function blast(sr, r, dur, bright, tau) { const n = S(sr, dur); const x = noise(n, r); lpSweep(x, bright, Math.max(300, bright * 0.12), sr); hp(x, 90, sr); mulEnv(x, expEnv(n, sr, 0.0002, tau)); return x; }
// 超音速の弾のクラック（N字の波）
function crack(sr, r, len = 0.0016) { const n = S(sr, 0.02), out = new Float32Array(n), m = Math.max(4, S(sr, len)); for (let i = 0; i < m; i++) out[i] = 1 - 2 * i / m; const t = noise(n, r); hp(t, 3000, sr); mulEnv(t, expEnv(n, sr, 0.0001, 0.0025)); mixInto(out, t, 0, 0.5); return out; }

// ---- 銃声。o: { blast:秒, bright:Hz, boom:[f0,f1,秒,強さ], crack:超音速か, mech:機関部の周波数, tail:尾の長さ, loud }
const GUNS = {
  r556: { b: 0.14, br: 9000, tau: 0.012, boom: [150, 55, 0.18, 0.9], crack: true, mech: 2600, tail: 0.32, sat: 1.6 },
  r545: { b: 0.14, br: 8600, tau: 0.012, boom: [140, 52, 0.18, 0.9], crack: true, mech: 2400, tail: 0.32, sat: 1.6 },
  r762: { b: 0.17, br: 7800, tau: 0.016, boom: [115, 42, 0.24, 1.15], crack: true, mech: 2100, tail: 0.4, sat: 1.9 },
  p9: { b: 0.1, br: 6500, tau: 0.009, boom: [180, 70, 0.12, 0.7], crack: false, mech: 3000, tail: 0.22, sat: 1.3 },
  p45: { b: 0.11, br: 5600, tau: 0.011, boom: [150, 60, 0.15, 0.85], crack: false, mech: 2700, tail: 0.24, sat: 1.4 },
  p46: { b: 0.1, br: 8000, tau: 0.008, boom: [200, 80, 0.1, 0.55], crack: true, mech: 3300, tail: 0.2, sat: 1.2 },
  p57: { b: 0.1, br: 8200, tau: 0.008, boom: [190, 75, 0.1, 0.55], crack: true, mech: 3200, tail: 0.2, sat: 1.2 },
  h9: { b: 0.1, br: 6200, tau: 0.01, boom: [170, 65, 0.13, 0.75], crack: false, mech: 2900, tail: 0.24, sat: 1.35 },
  h45: { b: 0.11, br: 5200, tau: 0.012, boom: [140, 55, 0.16, 0.9], crack: false, mech: 2500, tail: 0.26, sat: 1.4 },
  h357: { b: 0.15, br: 7000, tau: 0.016, boom: [120, 45, 0.22, 1.2], crack: true, mech: 1900, tail: 0.38, sat: 2.0 },
  h57: { b: 0.1, br: 8200, tau: 0.008, boom: [190, 78, 0.1, 0.55], crack: true, mech: 3200, tail: 0.2, sat: 1.2 },
  sg: { b: 0.2, br: 5200, tau: 0.022, boom: [95, 38, 0.3, 1.4], crack: false, mech: 1700, tail: 0.45, sat: 2.2 },
  // 狙撃銃（7.62mm NATO・長い銃身）: 太く長い響き。ボルトアクションなので撃った瞬間の機関部の音はない
  r308: { b: 0.19, br: 7600, tau: 0.018, boom: [105, 38, 0.3, 1.25], crack: true, mech: 0, tail: 0.55, sat: 2.0, bolt: true },
};
function gunNear(sr, seed, k) {
  const g = GUNS[k], r = rng(seed);
  const out = buf(sr, 0.5);
  mixInto(out, blast(sr, r, g.b, g.br * (0.92 + r() * 0.16), g.tau * (0.9 + r() * 0.2)), 0, 1.0);
  // 2つ目の短い破裂（銃口の跳ね返り）で厚みを出す
  mixInto(out, blast(sr, r, g.b * 0.6, g.br * 0.5, g.tau * 1.8), S(sr, 0.0015), 0.45);
  const [f0, f1, bd, bg] = g.boom;
  mixInto(out, thump(sr, r, f0 * (0.95 + r() * 0.1), f1, bd, bg), 0, 1.0);
  if (g.crack) mixInto(out, crack(sr, r), 0, 0.55);
  if (!g.bolt) mixInto(out, clack(sr, r, g.mech, 0.06, 0.35), S(sr, 0.028 + r() * 0.012), 1);
  // 短い尾（銃の近くの空気の揺れ）
  const tn = S(sr, g.tail); const tl = noise(tn, r); lp(tl, 1400, sr); hp(tl, 120, sr); mulEnv(tl, expEnv(tn, sr, 0.004, g.tail * 0.22)); mixInto(out, tl, S(sr, 0.004), 0.22);
  sat(out, g.sat);
  return fadeEdges(normalize(out, 0.95), sr);
}
// 遠くの銃声: 高い音が抜けて、尾が長い。小銃はクラックが先に届く
function gunFar(sr, seed, kind) {
  const r = rng(seed), out = buf(sr, 1.4);
  const rifle = kind === 'r', sg = kind === 's';
  if (rifle) mixInto(out, crack(sr, r, 0.0011), 0, 0.5);
  const at = rifle ? S(sr, 0.012) : 0;
  const n = S(sr, 0.35); const b = noise(n, r); lp(b, sg ? 700 : rifle ? 1300 : 1000, sr); hp(b, 60, sr); mulEnv(b, expEnv(n, sr, 0.003, sg ? 0.07 : 0.05)); mixInto(out, b, at, 1);
  mixInto(out, thump(sr, r, sg ? 80 : 100, 40, 0.35, 1.1), at, 1);
  // こだま
  for (let k = 0; k < 4; k++) { const m = S(sr, 0.5); const e = noise(m, r); lp(e, 500 - k * 70, sr); mulEnv(e, expEnv(m, sr, 0.01, 0.12)); mixInto(out, e, at + S(sr, 0.12 + k * 0.17 + r() * 0.05), 0.35 / (k + 1)); }
  return fadeEdges(normalize(out, 0.9), sr, 0.0005, 0.05);
}
// 消音器付き: 爆風は弱く「パシュッ」、機関部の音が目立つ。小銃は弾のクラックが残る
function gunSupp(sr, seed, kind) {
  const r = rng(seed), out = buf(sr, 0.35);
  const n = S(sr, 0.08); const p = noise(n, r); bp(p, kind === 'r' ? 1500 : 1100, 0.8, sr); mulEnv(p, expEnv(n, sr, 0.0006, 0.012)); mixInto(out, p, 0, 1);
  mixInto(out, thump(sr, r, 140, 70, 0.08, 0.5), 0, 1);
  if (kind === 'r') mixInto(out, crack(sr, r), 0, 0.5);
  mixInto(out, clack(sr, r, kind === 'r' ? 2500 : 3100, 0.07, 0.8), S(sr, 0.018), 1);
  mixInto(out, clack(sr, r, 1900, 0.05, 0.45), S(sr, 0.05), 1);
  return fadeEdges(normalize(out, 0.75), sr);
}
// ビーンバッグ（弱い装薬の散弾）・ペッパーボール（圧縮空気）・テーザー
function beanShot(sr, seed) { const r = rng(seed), out = buf(sr, 0.35); mixInto(out, blast(sr, r, 0.1, 3800, 0.012), 0, 1); mixInto(out, thump(sr, r, 120, 50, 0.18, 1), 0, 1); mixInto(out, clack(sr, r, 1800, 0.05, 0.3), S(sr, 0.03), 1); return fadeEdges(normalize(sat(out, 1.3), 0.85), sr); }
// M320（40mm）: 低い「ポン」と、筒の響き
function launchShot(sr, seed) { const r = rng(seed), out = buf(sr, 0.6); mixInto(out, blast(sr, r, 0.12, 2400, 0.02), 0, 0.8); mixInto(out, thump(sr, r, 85, 38, 0.32, 1.4), 0, 1); const n = S(sr, 0.4); const t = noise(n, r); bp(t, 420, 2.5, sr); mulEnv(t, expEnv(n, sr, 0.004, 0.12)); mixInto(out, t, S(sr, 0.01), 0.5); mixInto(out, clack(sr, r, 1500, 0.06, 0.4), S(sr, 0.04), 1); return fadeEdges(normalize(sat(out, 1.4), 0.9), sr); }
function airShot(sr, seed) { const r = rng(seed), out = buf(sr, 0.22); const n = S(sr, 0.09); const p = noise(n, r); bp(p, 1800, 0.7, sr); mulEnv(p, expEnv(n, sr, 0.0008, 0.02)); mixInto(out, p, 0, 1); mixInto(out, thump(sr, r, 220, 120, 0.05, 0.4), 0, 1); mixInto(out, clack(sr, r, 2800, 0.04, 0.4), S(sr, 0.03), 1); return fadeEdges(normalize(out, 0.7), sr); }
function taserShot(sr, seed) {
  const r = rng(seed), out = buf(sr, 1.4);
  mixInto(out, airShot(sr, seed + 1), 0, 0.6);
  // バチバチという電気の音（19回/秒のパルス）
  for (let k = 0; k < 24; k++) { const m = S(sr, 0.02); const z = noise(m, r); hp(z, 2000, sr); mulEnv(z, expEnv(m, sr, 0.0002, 0.003)); mixInto(out, z, S(sr, 0.08 + k / 19 + r() * 0.004), 0.8); }
  const hn = S(sr, 1.3); const hm = sine(hn, sr, 2600); for (let i = 0; i < hn; i++) hm[i] = Math.sign(hm[i]) * 0.15; mulEnv(hm, env(hn, sr, 0.05, 1.2, 1)); mixInto(out, hm, S(sr, 0.08), 0.3);
  return fadeEdges(normalize(out, 0.8), sr);
}

// ---- 足音（材質ごと）: かかと→つま先＋装備がこすれる音
function step(sr, seed, kind) {
  const r = rng(seed), out = buf(sr, 0.32);
  const P = { hard: [1900, 1.3, 90, 0.9], tile: [2600, 1.6, 110, 1], wood: [900, 1.0, 85, 1], soft: [700, 0.7, 70, 0.45], grass: [2400, 0.6, 60, 0.5], dirt: [1200, 0.8, 70, 0.6], metal: [1500, 2.5, 120, 1.1] }[kind] || [1500, 1, 90, 1];
  const [f, q, tf, g] = P;
  for (const [t, gg] of [[0, 1], [0.04 + r() * 0.025, 0.55]]) {
    const m = S(sr, 0.09);
    const nz = noise(m, r); bp(nz, f * (0.85 + r() * 0.3), q, sr); mulEnv(nz, expEnv(m, sr, 0.0008, kind === 'soft' ? 0.02 : 0.012));
    mixInto(out, nz, S(sr, t), gg * g);
    mixInto(out, thump(sr, r, tf * (0.9 + r() * 0.2), tf * 0.6, 0.07, 0.6), S(sr, t), gg);
  }
  if (kind === 'grass' || kind === 'dirt') { const m = S(sr, 0.15); const z = noise(m, r); hp(z, 3000, sr); mulEnv(z, env(m, sr, 0.02, 0.12, 2)); mixInto(out, z, S(sr, 0.01), 0.35); }
  if (kind === 'wood' && r() < 0.5) { const m = S(sr, 0.12); const s = sine(m, sr, 420 + r() * 200, 380); mulEnv(s, env(m, sr, 0.02, 0.1, 2)); mixInto(out, s, S(sr, 0.05), 0.12); }
  if (kind === 'metal') mixInto(out, clack(sr, r, 900 + r() * 300, 0.12, 0.5), 0, 1);
  // 装備のこすれ（ポーチ・スリング）
  const m = S(sr, 0.12); const z = noise(m, r); bp(z, 3500, 1.2, sr); mulEnv(z, env(m, sr, 0.01, 0.1, 2)); mixInto(out, z, S(sr, 0.02 + r() * 0.04), 0.12);
  return fadeEdges(normalize(out, 0.8), sr);
}

// ---- 当たった音
function impact(sr, seed, kind) {
  const r = rng(seed), out = buf(sr, kind === 'metal' ? 0.4 : 0.25);
  if (kind === 'metal') { mixInto(out, clack(sr, r, 1800 + r() * 1500, 0.35, 1), 0, 1); const n = S(sr, 0.3); const s = sine(n, sr, 3000 + r() * 2500, 2500); mulEnv(s, expEnv(n, sr, 0.0005, 0.06)); mixInto(out, s, 0, 0.3); }
  else if (kind === 'wood') { const n = S(sr, 0.12); const z = noise(n, r); bp(z, 800 + r() * 400, 1.1, sr); mulEnv(z, expEnv(n, sr, 0.0005, 0.018)); mixInto(out, z, 0, 1); mixInto(out, thump(sr, r, 220, 120, 0.06, 0.5), 0, 1); }
  else if (kind === 'glass') { for (let k = 0; k < 8; k++) { const n = S(sr, 0.05); const s = sine(n, sr, 3500 + r() * 5000); mulEnv(s, expEnv(n, sr, 0.0003, 0.01)); mixInto(out, s, S(sr, r() * 0.12), 0.4); } const n = S(sr, 0.05); const z = noise(n, r); hp(z, 4000, sr); mulEnv(z, expEnv(n, sr, 0.0003, 0.008)); mixInto(out, z, 0, 0.8); }
  else if (kind === 'soft') { const n = S(sr, 0.08); const z = noise(n, r); lp(z, 900, sr); mulEnv(z, expEnv(n, sr, 0.0008, 0.015)); mixInto(out, z, 0, 1); }
  else { // 硬い（コンクリ・レンガ）: 欠ける音と砂の落ちる音
    const n = S(sr, 0.06); const z = noise(n, r); bp(z, 2200 + r() * 1200, 0.9, sr); mulEnv(z, expEnv(n, sr, 0.0003, 0.007)); mixInto(out, z, 0, 1);
    const m = S(sr, 0.2); const g = noise(m, r); hp(g, 2500, sr); mulEnv(g, env(m, sr, 0.01, 0.18, 2)); mixInto(out, g, S(sr, 0.01), 0.18);
  }
  return fadeEdges(normalize(out, 0.75), sr);
}
function fleshHit(sr, seed) { const r = rng(seed), out = buf(sr, 0.18); const n = S(sr, 0.1); const z = noise(n, r); lp(z, 1200, sr); mulEnv(z, expEnv(n, sr, 0.0006, 0.018)); mixInto(out, z, 0, 1); mixInto(out, thump(sr, r, 110, 60, 0.1, 0.9), 0, 1); return fadeEdges(normalize(sat(out, 1.5), 0.8), sr); }
function plateHit(sr, seed) { const r = rng(seed), out = buf(sr, 0.3); mixInto(out, fleshHit(sr, seed), 0, 0.6); mixInto(out, clack(sr, r, 1300 + r() * 400, 0.25, 1.1), 0, 1); return fadeEdges(normalize(out, 0.85), sr); }
// 弾がそばを抜ける（パシッ＋ヒュン）
function whiz(sr, seed) { const r = rng(seed), out = buf(sr, 0.25); mixInto(out, crack(sr, r, 0.0009), 0, 0.9); const n = S(sr, 0.18); const z = noise(n, r); bp(z, 2600 + r() * 1500, 2.5, sr); mulEnv(z, env(n, sr, 0.01, 0.16, 2)); mixInto(out, z, S(sr, 0.004), 0.6); return fadeEdges(normalize(out, 0.8), sr); }
function shellCase(sr, seed, sg) {
  const r = rng(seed), out = buf(sr, 0.5);
  for (let k = 0; k < 3; k++) { const n = S(sr, 0.12); const t = S(sr, k * (0.07 + r() * 0.05)); if (sg) { const z = noise(n, r); bp(z, 700, 1.5, sr); mulEnv(z, expEnv(n, sr, 0.0005, 0.015)); mixInto(out, z, t, 0.8 / (k + 1)); } else { const s = sine(n, sr, 4200 + r() * 2200); mulEnv(s, expEnv(n, sr, 0.0002, 0.03)); mixInto(out, s, t, 0.6 / (k + 1)); const s2 = sine(n, sr, 7900 + r() * 1500); mulEnv(s2, expEnv(n, sr, 0.0002, 0.015)); mixInto(out, s2, t, 0.25 / (k + 1)); } }
  return fadeEdges(normalize(out, 0.6), sr);
}
// ---- 扉
function latch(sr, r) { const o = buf(sr, 0.12); mixInto(o, clack(sr, r, 1500, 0.06, 1), 0, 1); mixInto(o, clack(sr, r, 2100, 0.05, 0.7), S(sr, 0.05), 1); return o; }
function creak(sr, r, dur, base) {
  const n = S(sr, dur), out = new Float32Array(n);
  let t = 0, k = 0;
  while (t < dur - 0.02) { const f = base * (0.85 + 0.3 * Math.sin(t * 7 + r()) ); const m = S(sr, 0.012); const s = sine(m, sr, f * 3, f * 2.7); mulEnv(s, expEnv(m, sr, 0.0005, 0.004)); mixInto(out, s, S(sr, t), 0.5 + 0.5 * Math.sin(t / dur * Math.PI)); t += 1 / (f * 0.12) * (0.8 + r() * 0.4); if (++k > 4000) break; }
  bp(out, base * 3, 1.3, sr);
  return out;
}
function doorOpen(sr, seed) { const r = rng(seed), out = buf(sr, 1.0); mixInto(out, latch(sr, r), 0, 1); if (r() < 0.7) mixInto(out, creak(sr, r, 0.7, 260 + r() * 140), S(sr, 0.08), 0.35); return fadeEdges(normalize(out, 0.7), sr); }
function doorClose(sr, seed) { const r = rng(seed), out = buf(sr, 0.4); mixInto(out, thump(sr, r, 120, 60, 0.15, 1), 0, 1); const n = S(sr, 0.1); const z = noise(n, r); bp(z, 600, 1, sr); mulEnv(z, expEnv(n, sr, 0.001, 0.02)); mixInto(out, z, 0, 0.7); mixInto(out, latch(sr, r), S(sr, 0.01), 0.7); return fadeEdges(normalize(out, 0.8), sr); }
function woodBang(sr, r, g = 1, dur = 0.5) { const out = buf(sr, dur); const n = S(sr, 0.2); const z = noise(n, r); bp(z, 500, 0.8, sr); mulEnv(z, expEnv(n, sr, 0.0005, 0.03)); mixInto(out, z, 0, g); mixInto(out, thump(sr, r, 90, 45, 0.3, 1.2 * g), 0, 1); for (let k = 0; k < 6; k++) { const m = S(sr, 0.05); const s = noise(m, r); bp(s, 1500 + r() * 2000, 3, sr); mulEnv(s, expEnv(m, sr, 0.0005, 0.01)); mixInto(out, s, S(sr, 0.02 + r() * 0.15), 0.3 * g); } return out; }
function doorKick(sr, seed) { const r = rng(seed), out = buf(sr, 0.9); mixInto(out, woodBang(sr, r, 1.2, 0.6), 0, 1); mixInto(out, clack(sr, r, 1200, 0.1, 0.8), S(sr, 0.01), 1); mixInto(out, thump(sr, r, 100, 50, 0.2, 0.8), S(sr, 0.3), 1); return fadeEdges(normalize(sat(out, 1.4), 0.92), sr); }
function doorKickFail(sr, seed) { const r = rng(seed), out = buf(sr, 0.5); mixInto(out, woodBang(sr, r, 0.9, 0.5), 0, 1); mixInto(out, clack(sr, r, 900, 0.08, 0.5), 0, 1); return fadeEdges(normalize(out, 0.85), sr); }
function doorRam(sr, seed) { const r = rng(seed), out = buf(sr, 0.9); mixInto(out, woodBang(sr, r, 1.4, 0.7), 0, 1); mixInto(out, clack(sr, r, 700, 0.2, 1.2), 0, 1); mixInto(out, thump(sr, r, 70, 35, 0.35, 1.2), 0, 1); return fadeEdges(normalize(sat(out, 1.6), 0.95), sr); }
function doorBreach(sr, seed) { const r = rng(seed), out = buf(sr, 1.0); mixInto(out, gunNear(sr, seed + 7, 'sg'), 0, 1); mixInto(out, woodBang(sr, r, 1, 0.7), S(sr, 0.02), 0.8); mixInto(out, clack(sr, r, 1000, 0.15, 0.9), S(sr, 0.03), 1); return fadeEdges(normalize(out, 0.95), sr); }
function doorLocked(sr, seed) { const r = rng(seed), out = buf(sr, 0.45); for (let k = 0; k < 3; k++) mixInto(out, clack(sr, r, 1300 + r() * 300, 0.07, 0.8), S(sr, k * 0.11 + r() * 0.02), 1); return fadeEdges(normalize(out, 0.7), sr); }
function lockPick(sr, seed) { const r = rng(seed), out = buf(sr, 0.8); for (let k = 0; k < 9; k++) mixInto(out, clack(sr, r, 3500 + r() * 2000, 0.03, 0.4 + r() * 0.4), S(sr, k * 0.07 + r() * 0.03), 1); mixInto(out, clack(sr, r, 1600, 0.08, 1), S(sr, 0.68), 1); return fadeEdges(normalize(out, 0.6), sr); }
function wedge(sr, seed) { const r = rng(seed), out = buf(sr, 0.4); const n = S(sr, 0.25); const z = noise(n, r); bp(z, 1200, 1.2, sr); mulEnv(z, env(n, sr, 0.03, 0.2, 1.5)); mixInto(out, z, 0, 0.6); mixInto(out, woodBang(sr, r, 0.4, 0.3), S(sr, 0.18), 1); return fadeEdges(normalize(out, 0.65), sr); }

// ---- 爆発物・投げ物
function boom(sr, seed, big) {
  const r = rng(seed), out = buf(sr, big ? 2.4 : 1.6);
  mixInto(out, blast(sr, r, 0.6, 5000, big ? 0.08 : 0.05), 0, 1);
  mixInto(out, thump(sr, r, big ? 55 : 70, 25, big ? 1.6 : 1.0, 1.6), 0, 1);
  const n = S(sr, big ? 2.2 : 1.4); const rb = noise(n, r); lp(rb, 300, sr); mulEnv(rb, expEnv(n, sr, 0.02, big ? 0.5 : 0.3)); mixInto(out, rb, S(sr, 0.02), 0.9);
  for (let k = 0; k < 12; k++) { const m = S(sr, 0.04); const z = noise(m, r); bp(z, 1000 + r() * 3000, 2, sr); mulEnv(z, expEnv(m, sr, 0.0005, 0.01)); mixInto(out, z, S(sr, 0.1 + r() * 0.9), 0.25); }
  return fadeEdges(normalize(sat(out, 2.2), 0.98), sr, 0.0005, 0.1);
}
// 遠くの爆発（11-19 18:16）: 高い音は空気に吸われて、低いとどろきと長い尾だけ。建物や地面の反射で少し遅れてもう一度
function boomFar(sr, seed) {
  const r = rng(seed), out = buf(sr, 3.4);
  mixInto(out, thump(sr, r, 48, 22, 1.8, 1.8), 0, 1);
  const n = S(sr, 3.2); const rb = noise(n, r); lp(rb, 180, sr); mulEnv(rb, expEnv(n, sr, 0.04, 0.9)); mixInto(out, rb, S(sr, 0.01), 1.1);
  const m = S(sr, 2.6); const e2 = noise(m, r); lp(e2, 140, sr); mulEnv(e2, expEnv(m, sr, 0.08, 0.8)); mixInto(out, e2, S(sr, 0.35 + r() * 0.2), 0.45);
  const b = S(sr, 0.5); const cr = noise(b, r); bp(cr, 700, 0.8, sr); mulEnv(cr, expEnv(b, sr, 0.005, 0.12)); mixInto(out, cr, 0, 0.25);
  return fadeEdges(normalize(sat(out, 1.6), 0.95), sr, 0.002, 0.3);
}
function flashBang(sr, seed) { const r = rng(seed), out = buf(sr, 1.6); mixInto(out, blast(sr, r, 0.35, 12000, 0.03), 0, 1.2); mixInto(out, thump(sr, r, 90, 40, 0.5, 1.3), 0, 1); const n = S(sr, 1.4); const rb = noise(n, r); lp(rb, 900, sr); mulEnv(rb, expEnv(n, sr, 0.01, 0.25)); mixInto(out, rb, 0, 0.5); return fadeEdges(normalize(sat(out, 2.5), 0.98), sr); }
function stingerBang(sr, seed) { const r = rng(seed), out = buf(sr, 1.4); mixInto(out, flashBang(sr, seed), 0, 0.8); for (let k = 0; k < 40; k++) { const m = S(sr, 0.03); const z = noise(m, r); bp(z, 2000 + r() * 3000, 3, sr); mulEnv(z, expEnv(m, sr, 0.0003, 0.006)); mixInto(out, z, S(sr, 0.03 + r() * 0.5), 0.3); } return fadeEdges(normalize(out, 0.95), sr); }
function gasPop(sr, seed) { const r = rng(seed), out = buf(sr, 2.5); mixInto(out, clack(sr, r, 1100, 0.1, 1), 0, 1); mixInto(out, thump(sr, r, 160, 90, 0.1, 0.6), 0, 1); const n = S(sr, 2.3); const h = noise(n, r); hp(h, 1800, sr); bp(h, 4500, 0.7, sr); mulEnv(h, env(n, sr, 0.15, 2.0, 1.2)); mixInto(out, h, S(sr, 0.12), 0.7); return fadeEdges(normalize(out, 0.75), sr); }
function nadeBounce(sr, seed) { const r = rng(seed), out = buf(sr, 0.2); mixInto(out, clack(sr, r, 900 + r() * 500, 0.12, 1), 0, 1); mixInto(out, thump(sr, r, 180, 100, 0.05, 0.4), 0, 1); return fadeEdges(normalize(out, 0.6), sr); }
function throwW(sr, seed) { const r = rng(seed), out = buf(sr, 0.35); const n = S(sr, 0.3); const z = noise(n, r); bp(z, 900, 0.9, sr); mulEnv(z, env(n, sr, 0.12, 0.17, 2)); mixInto(out, z, 0, 1); return fadeEdges(normalize(out, 0.5), sr); }
// ---- 銃の扱い
function magOut(sr, seed) { const r = rng(seed), out = buf(sr, 0.35); mixInto(out, clack(sr, r, 1700, 0.05, 1), 0, 1); const n = S(sr, 0.18); const z = noise(n, r); bp(z, 2400, 1.5, sr); mulEnv(z, env(n, sr, 0.02, 0.15, 2)); mixInto(out, z, S(sr, 0.04), 0.5); return fadeEdges(normalize(out, 0.6), sr); }
function magIn(sr, seed) { const r = rng(seed), out = buf(sr, 0.45); mixInto(out, clack(sr, r, 1400, 0.06, 1), 0, 1); mixInto(out, thump(sr, r, 200, 120, 0.05, 0.5), 0, 1); mixInto(out, clack(sr, r, 2300, 0.07, 1.1), S(sr, 0.25), 1); return fadeEdges(normalize(out, 0.65), sr); }
function pump(sr, seed) { const r = rng(seed), out = buf(sr, 0.45); mixInto(out, clack(sr, r, 1100, 0.08, 1), 0, 1); const n = S(sr, 0.12); const z = noise(n, r); bp(z, 1600, 1.2, sr); mulEnv(z, env(n, sr, 0.01, 0.1, 2)); mixInto(out, z, S(sr, 0.02), 0.5); mixInto(out, clack(sr, r, 1300, 0.08, 1.1), S(sr, 0.2), 1); return fadeEdges(normalize(out, 0.7), sr); }
// ボルトの操作: 起こす（カチッ）→ 引く（こすれ）→ 引ききる（薬莢が抜ける）→ 押す（こすれ）→ 押しきる（弾が入る）→ 倒す（カチッ）。
// 間合いは見た目の動き（AT308 のボルトの時間 0.95秒の 16〜26%・26〜46%・46〜64%・64〜74%）に合わせる
function boltS(sr, seed, T = 0.95) {
  const r = rng(seed), out = buf(sr, T + 0.1);
  const at = (f) => S(sr, T * f);
  mixInto(out, clack(sr, r, 1500, 0.06, 0.9), at(0.17), 1);
  { const n = S(sr, T * 0.2); const z = noise(n, r); bp(z, 2600, 1.4, sr); mulEnv(z, env(n, sr, 0.02, T * 0.16, 1.5)); mixInto(out, z, at(0.26), 0.45); }
  mixInto(out, clack(sr, r, 2100, 0.05, 0.7), at(0.45), 1);
  { const n = S(sr, T * 0.17); const z = noise(n, r); bp(z, 2200, 1.4, sr); mulEnv(z, env(n, sr, 0.02, T * 0.14, 1.5)); mixInto(out, z, at(0.47), 0.4); }
  mixInto(out, clack(sr, r, 1250, 0.07, 1.0), at(0.63), 1);
  mixInto(out, clack(sr, r, 1700, 0.06, 0.9), at(0.735), 1);
  return fadeEdges(normalize(out, 0.62), sr);
}
function shellIn(sr, seed) { const r = rng(seed), out = buf(sr, 0.25); mixInto(out, clack(sr, r, 1200 + r() * 200, 0.06, 0.8), 0, 1); const n = S(sr, 0.08); const z = noise(n, r); bp(z, 1800, 1.5, sr); mulEnv(z, env(n, sr, 0.01, 0.07, 2)); mixInto(out, z, S(sr, 0.03), 0.4); return fadeEdges(normalize(out, 0.55), sr); }
function dry(sr, seed) { const r = rng(seed), out = buf(sr, 0.12); mixInto(out, clack(sr, r, 2200, 0.08, 1), 0, 1); return fadeEdges(normalize(out, 0.5), sr); }
function cloth(sr, seed, dur = 0.3, f = 2600) { const r = rng(seed), out = buf(sr, dur); const n = S(sr, dur); const z = noise(n, r); bp(z, f, 1.1, sr); mulEnv(z, env(n, sr, dur * 0.25, dur * 0.7, 2)); mixInto(out, z, 0, 1); return fadeEdges(normalize(out, 0.4), sr); }
function draw(sr, seed) { const r = rng(seed), out = buf(sr, 0.4); mixInto(out, cloth(sr, seed, 0.25), 0, 0.8); mixInto(out, clack(sr, r, 1900, 0.06, 0.7), S(sr, 0.22), 1); return fadeEdges(normalize(out, 0.5), sr); }
function cuffs(sr, seed) { const r = rng(seed), out = buf(sr, 0.7); for (let k = 0; k < 14; k++) { const m = S(sr, 0.015); const z = noise(m, r); bp(z, 3000 + k * 60, 4, sr); mulEnv(z, expEnv(m, sr, 0.0002, 0.003)); mixInto(out, z, S(sr, 0.05 + k * 0.035), 0.8); } return fadeEdges(normalize(out, 0.55), sr); }
function bandage(sr, seed) { const r = rng(seed), out = buf(sr, 0.8); const n = S(sr, 0.6); const z = noise(n, r); bp(z, 2000, 0.8, sr); for (let i = 0; i < n; i++) z[i] *= 0.5 + 0.5 * Math.sin(i / sr * 60 + r()); mulEnv(z, env(n, sr, 0.05, 0.55, 1.2)); mixInto(out, z, 0, 1); return fadeEdges(normalize(out, 0.5), sr); }
// 息: 吸う（短く上がる）・吐く（長く下がる）・息切れ（あえぐ2回）
function breathS(sr, seed, kind) {
  const r = rng(seed), d = kind === 'in' ? 0.42 : kind === 'out' ? 0.75 : 1.3, out = buf(sr, d);
  const parts = kind === 'gasp' ? [[0, 0.45, 900], [0.6, 0.55, 750]] : [[0, d * 0.95, kind === 'in' ? 1150 : 820]];
  for (const [t0, dur, f] of parts) { const n = S(sr, dur); const z = noise(n, r); bp(z, f, 0.9, sr); lp(z, 2600, sr); mulEnv(z, kind === 'in' ? env(n, sr, dur * 0.7, dur * 0.3, 1.5) : env(n, sr, dur * 0.12, dur * 0.85, 1.6)); mixInto(out, z, S(sr, t0), 1); }
  return fadeEdges(normalize(out, kind === 'gasp' ? 0.42 : 0.3), sr);
}
function sprayS(sr, seed) { const r = rng(seed), out = buf(sr, 0.7); const n = S(sr, 0.6); const z = noise(n, r); hp(z, 2500, sr); mulEnv(z, env(n, sr, 0.03, 0.55, 1.2)); mixInto(out, z, 0, 1); return fadeEdges(normalize(out, 0.55), sr); }
function glassBreak(sr, seed) { const r = rng(seed), out = buf(sr, 1.0); mixInto(out, impact(sr, seed, 'glass'), 0, 1); for (let k = 0; k < 30; k++) { const n = S(sr, 0.06); const s = sine(n, sr, 2500 + r() * 6500); mulEnv(s, expEnv(n, sr, 0.0003, 0.012)); mixInto(out, s, S(sr, 0.05 + r() * 0.7), 0.25 * (1 - k / 40)); } return fadeEdges(normalize(out, 0.8), sr); }
function wallBreak(sr, seed) { const r = rng(seed), out = buf(sr, 0.9); mixInto(out, impact(sr, seed, 'hard'), 0, 1); const n = S(sr, 0.8); const z = noise(n, r); lp(z, 1800, sr); mulEnv(z, env(n, sr, 0.02, 0.75, 2)); mixInto(out, z, S(sr, 0.03), 0.6); mixInto(out, thump(sr, r, 120, 60, 0.2, 0.6), 0, 1); return fadeEdges(normalize(out, 0.85), sr); }
function reinforce(sr, seed) { const r = rng(seed), out = buf(sr, 0.9); mixInto(out, clack(sr, r, 600, 0.4, 1.3), 0, 1); mixInto(out, clack(sr, r, 800, 0.3, 1), S(sr, 0.35), 1); const n = S(sr, 0.3); const z = noise(n, r); hp(z, 3000, sr); mulEnv(z, env(n, sr, 0.02, 0.28, 2)); mixInto(out, z, S(sr, 0.5), 0.4); return fadeEdges(normalize(out, 0.75), sr); }
function hammer(sr, seed) { const r = rng(seed), out = buf(sr, 1.1); for (let k = 0; k < 4; k++) mixInto(out, woodBang(sr, r, 0.6, 0.25), S(sr, k * 0.26), 1); return fadeEdges(normalize(out, 0.7), sr); }
function droneLoop(sr, seed) { const r = rng(seed), out = buf(sr, 1.0); const n = out.length; const a = sine(n, sr, 180, 180); const b = sine(n, sr, 362, 362); for (let i = 0; i < n; i++) out[i] = (Math.sign(a[i]) * 0.3 + b[i] * 0.2) * (0.8 + 0.2 * Math.sin(i / sr * TAU * 8)); const z = noise(n, r); bp(z, 900, 2, sr); mixInto(out, z, 0, 0.3); lp(out, 2500, sr); for (let i = 0; i < n; i++) { const t = i / sr; out[i] *= Math.min(1, t / 0.06) * Math.min(1, (1.0 - t) / 0.3); } return normalize(out, 0.4); }
function nvgWhine(sr, seed) { const out = buf(sr, 0.6); const n = out.length; const s = sine(n, sr, 3000, 9000); mulEnv(s, env(n, sr, 0.3, 0.3, 1)); mixInto(out, s, 0, 1); return fadeEdges(normalize(out, 0.18), sr); }
function ring(sr) { const out = buf(sr, 4.0); const n = out.length; const s = sine(n, sr, 4100, 3950); mulEnv(s, env(n, sr, 0.05, 3.9, 1.6)); mixInto(out, s, 0, 1); return fadeEdges(normalize(out, 0.5), sr); }
// ---- 体と装備の音（11-27 14:29「ジャンプの音がチープ。衣服や装備の擦れる音、装備の揺れる音のようなリアルな音に」）
// 布のこすれ（制服・プレートキャリアのナイロン）: 細かい粒（2〜9ms のパチパチ）を動きの山に沿ってばらまき、下に体の動きのさっと流れる音を敷く
function rustle(sr, r, dur, o = {}) {
  const n = S(sr, dur), out = new Float32Array(n);
  const f = o.f || 2400, dens = o.dens || 900, peak = o.peak || 0.25;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / n; e[i] = t < peak ? Math.pow(t / peak, 1.5) : Math.pow(Math.max(0, 1 - (t - peak) / (1 - peak)), 2.2); }
  // さっと流れる音は低め（体の大きな動き・厚い布）
  const sw = noise(n, r); bp(sw, f * 0.18, 0.7, sr); lp(sw, 1800, sr);
  for (let i = 0; i < n; i++) sw[i] *= e[i];
  mixInto(out, sw, 0, 1.0);
  // 粒は、3つの帯に分けた雑音から切り出す（粒ごとに作り直すと重い）
  const bands = [0.45, 0.75, 1.15].map(k => lp(bp(noise(n, r), f * k, 1.8, sr), 5000, sr));
  const cnt = Math.round(dens * dur);
  for (let k = 0; k < cnt; k++) {
    let t = r(); for (let q = 0; q < 6 && r() > e[Math.min(n - 1, Math.floor(t * n))]; q++) t = r();
    const m = S(sr, 0.002 + r() * 0.007), at = Math.min(n - m - 1, S(sr, t * dur)), B = bands[(r() * 3) | 0], g = (0.15 + Math.pow(r(), 2) * 0.85) * e[Math.min(n - 1, at)] * 1.3;
    for (let i = 0; i < m; i++) out[at + i] += B[at + i] * Math.sin(Math.PI * i / m) * g;
  }
  return out;
}
// 装備の当たる小さな音。k: buckle（樹脂のバックル・ポーチの留め具）・mag（弾倉どうし。鈍い）・metal（スリングの金具・カラビナ）・rifle（銃がプレートに当たる）
// 減衰する正弦（回転で作る。sine＋expEnv より軽い）
function dsin(n, sr, f, tau, ph = 0) { const x = new Float32Array(n), w = TAU * f / sr, c = Math.cos(w), sn = Math.sin(w), d = Math.exp(-1 / (tau * sr)); let re = Math.cos(ph), im = Math.sin(ph); for (let i = 0; i < n; i++) { x[i] = im; const nr = (re * c - im * sn) * d; im = (re * sn + im * c) * d; re = nr; } return x; }
function gearHit(sr, r, k, g = 1) {
  const dur = k === 'rifle' ? 0.1 : 0.05, n = S(sr, dur), out = new Float32Array(n);
  if (k === 'metal') {
    const z = noise(S(sr, 0.006), r); hp(z, 2500, sr); mulEnv(z, expEnv(z.length, sr, 0.0002, 0.0015)); mixInto(out, z, 0, 0.6 * g);
    const f = 2600 + r() * 2200; for (const [m, a] of [[1, 0.35], [1.53, 0.2], [2.41, 0.12]]) mixInto(out, dsin(n, sr, f * m * (0.98 + r() * 0.04), 0.008 + r() * 0.01, r() * TAU), 0, a * g);
    return out;
  }
  const f = k === 'buckle' ? 1000 + r() * 900 : k === 'mag' ? 520 + r() * 380 : 210 + r() * 120;
  const z = noise(n, r); bp(z, f * 1.6, k === 'buckle' ? 2.2 : 1.4, sr); mulEnv(z, expEnv(n, sr, 0.0002, k === 'rifle' ? 0.012 : 0.006)); mixInto(out, z, 0, g);
  mixInto(out, dsin(n, sr, f, k === 'rifle' ? 0.022 : k === 'mag' ? 0.012 : 0.007, r() * TAU), 0, 0.6 * g);
  if (k === 'rifle') mixInto(out, dsin(n, sr, f * 2.6, 0.01, r() * TAU), 0, 0.3 * g);
  return out;
}
// 装備の揺れ: t0 から span 秒の間に cnt 回（はじめに固まる）。跳ね返りで小さくもう一度
function rattle(out, sr, r, t0, span, cnt, g = 1, mix = { buckle: 0.4, mag: 0.33, metal: 0.15, rifle: 0.12 }) {
  const ks = Object.keys(mix);
  for (let i = 0; i < cnt; i++) {
    let u = r(), k = ks[ks.length - 1]; for (const q of ks) { if (u < mix[q]) { k = q; break; } u -= mix[q]; }
    const tt = Math.pow(r(), 1.6) * span, gg = g * (0.45 + r() * 0.55) * (1 - 0.5 * tt / span);
    mixInto(out, gearHit(sr, r, k, gg), S(sr, t0 + tt), 1);
    if (r() < 0.45) mixInto(out, gearHit(sr, r, k, gg * 0.4), S(sr, t0 + tt + 0.012 + r() * 0.03), 1);
  }
}
// ナイロンのベルト・スリングがきしむ（細かいこすれの連なり）
function strap(sr, r, dur, f = 1300) { const n = S(sr, dur), out = new Float32Array(n); let t = 0.004; while (t < dur - 0.008) { const m = S(sr, 0.004), z = noise(m, r); mulEnv(z, expEnv(m, sr, 0.0001, 0.0008)); mixInto(out, z, S(sr, t), 0.5 + 0.5 * Math.sin(Math.PI * t / dur)); t += 1 / (90 + r() * 70); } bp(out, f, 1.6, sr); return out; }
// 跳ぶ（踏み切り）: 体重をかけて蹴る低い押し込み・靴底のこすれ・体が伸びる時の布・遅れて付いてくる装備が当たる
function jumpUp(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.6);
  // 踏み込む重さ（低い押し込み＋体の重さの低いうなり）
  mixInto(out, thump(sr, r, 74 + r() * 10, 44, 0.18, 1.0), 0, 1);
  // スマホのスピーカーでも重さが出るように、胸の高さの響き（150〜250Hz）も
  mixInto(out, thump(sr, r, 210 + r() * 30, 140, 0.07, 0.45), 0, 1);
  { const m = S(sr, 0.12), z = noise(m, r); lp(z, 160, sr); mulEnv(z, env(m, sr, 0.01, 0.1, 2)); mixInto(out, z, 0, 1.6); }
  { const m = S(sr, 0.07), z = noise(m, r); bp(z, 1100 + r() * 300, 1.0, sr); mulEnv(z, env(m, sr, 0.004, 0.06, 2)); mixInto(out, z, 0, 0.22); }
  mixInto(out, rustle(sr, r, 0.34, { f: 2000, dens: 650, peak: 0.18 }), S(sr, 0.01), 0.55);
  mixInto(out, strap(sr, r, 0.16, 900 + r() * 300), S(sr, 0.02), 0.2);
  rattle(out, sr, r, 0.03, 0.2, 8, 1.0);
  lp(out, 6500, sr); hp(out, 35, sr);
  return fadeEdges(normalize(out, 0.75), sr);
}
// 着地: 靴底が着く重い衝撃（脚と体の重さ）・体が沈む布のばさっ・装備がいっせいに跳ねて、落ち着くまで小さく鳴る。big は高い所から
function jumpLand(sr, seed, big) {
  const r = rng(seed), out = buf(sr, big ? 1.0 : 0.8);
  mixInto(out, thump(sr, r, (big ? 62 : 72) + r() * 8, big ? 30 : 36, big ? 0.36 : 0.24, big ? 1.6 : 1.25), 0, 1);
  mixInto(out, thump(sr, r, (big ? 170 : 200) + r() * 30, 120, big ? 0.12 : 0.08, big ? 0.9 : 0.7), 0, 1);
  { const m = S(sr, 0.16), z = noise(m, r); lp(z, 180, sr); mulEnv(z, expEnv(m, sr, 0.002, big ? 0.06 : 0.04)); mixInto(out, z, 0, big ? 2.4 : 1.8); }
  { const m = S(sr, 0.06), z = noise(m, r); bp(z, 320 + r() * 80, 0.8, sr); mulEnv(z, expEnv(m, sr, 0.0006, big ? 0.02 : 0.014)); mixInto(out, z, 0, big ? 1 : 0.8); }
  mixInto(out, rustle(sr, r, big ? 0.3 : 0.22, { f: 1800, dens: 800, peak: 0.08 }), 0, 0.5);
  rattle(out, sr, r, 0.004, 0.11, big ? 14 : 10, 1.0, { buckle: 0.35, mag: 0.35, metal: 0.15, rifle: 0.15 });
  rattle(out, sr, r, 0.13, big ? 0.45 : 0.32, big ? 6 : 4, 0.45);
  mixInto(out, strap(sr, r, 0.12, 900 + r() * 300), S(sr, 0.03), 0.18);
  lp(out, 7000, sr); hp(out, 30, sr);
  return fadeEdges(normalize(sat(out, big ? 1.4 : 1.2), big ? 0.95 : 0.85), sr);
}
// 構えの切り替え（11-27 14:29「音は重厚感とリアルさ」）。k: prone（伏せる: ひざ→胸が地面に落ちる 2 つの重い音と装備の跳ね）・
//  rise（伏せから起きる: 腕で押し上げる・布・装備）・crouch（しゃがむ: ひざの軽い音・布・装備）・stand（立つ: 布と装備）
function stanceS(sr, seed, k) {
  const r = rng(seed), out = buf(sr, k === 'prone' ? 0.9 : 0.6);
  const thud = (t, f, g, d) => { mixInto(out, thump(sr, r, f + r() * 8, f * 0.55, d, g), S(sr, t), 1); mixInto(out, thump(sr, r, f * 2.6, f * 1.8, d * 0.5, g * 0.45), S(sr, t), 1); const m = S(sr, 0.05), z = noise(m, r); bp(z, 380 + r() * 120, 0.8, sr); mulEnv(z, expEnv(m, sr, 0.0008, 0.012)); mixInto(out, z, S(sr, t), g * 0.6); };
  if (k === 'prone') {
    mixInto(out, rustle(sr, r, 0.6, { f: 1900, dens: 700, peak: 0.3 }), 0, 0.6);
    thud(0.12, 70, 0.8, 0.14); rattle(out, sr, r, 0.125, 0.08, 6, 0.8);
    thud(0.3, 60, 1.2, 0.22); rattle(out, sr, r, 0.305, 0.12, 9, 1.0, { buckle: 0.3, mag: 0.4, metal: 0.12, rifle: 0.18 });
    rattle(out, sr, r, 0.45, 0.3, 3, 0.35);
  } else if (k === 'rise') {
    mixInto(out, rustle(sr, r, 0.5, { f: 2000, dens: 650, peak: 0.35 }), 0, 0.65);
    thud(0.06, 90, 0.4, 0.1); rattle(out, sr, r, 0.1, 0.3, 6, 0.7);
    mixInto(out, strap(sr, r, 0.18, 1000), S(sr, 0.12), 0.18);
  } else if (k === 'crouch') {
    mixInto(out, rustle(sr, r, 0.32, { f: 2100, dens: 600, peak: 0.25 }), 0, 0.6);
    thud(0.11, 95, 0.45, 0.09); rattle(out, sr, r, 0.1, 0.16, 5, 0.65);
  } else {
    mixInto(out, rustle(sr, r, 0.34, { f: 2200, dens: 600, peak: 0.3 }), 0, 0.65);
    rattle(out, sr, r, 0.06, 0.2, 5, 0.6); mixInto(out, strap(sr, r, 0.14, 1100), S(sr, 0.05), 0.15);
  }
  lp(out, 7000, sr); hp(out, 30, sr);
  return fadeEdges(normalize(sat(out, 1.15), 0.7), sr);
}
// 乗り越え: 手を縁につく（手袋の平手が硬い面を打つ）→ 体を振り上げる布と装備 → 向こう側へ足をつく
function vaultS(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.9);
  for (const t of [0, 0.03]) { const m = S(sr, 0.04), z = noise(m, r); bp(z, 1500 + r() * 500, 0.9, sr); mulEnv(z, expEnv(m, sr, 0.0004, 0.008)); mixInto(out, z, S(sr, t), 0.8); mixInto(out, thump(sr, r, 180, 110, 0.05, 0.5), S(sr, t), 1); }
  mixInto(out, rustle(sr, r, 0.5, { f: 2100, dens: 800, peak: 0.35 }), S(sr, 0.04), 0.75);
  rattle(out, sr, r, 0.1, 0.3, 8, 0.85);
  mixInto(out, strap(sr, r, 0.2, 1000), S(sr, 0.12), 0.2);
  mixInto(out, thump(sr, r, 80, 44, 0.16, 0.8), S(sr, 0.52), 1); rattle(out, sr, r, 0.53, 0.12, 6, 0.7);
  lp(out, 7500, sr); hp(out, 30, sr);
  return fadeEdges(normalize(sat(out, 1.2), 0.75), sr);
}
// ---- 弾倉のリロード（11-27「音は重厚感とリアルさ」）: 一人称の手の動き（抜く 12〜35%・新しい弾倉 35〜58%・差す 58〜75%）に合わせて分けて鳴らす
// 抜く: リリースボタンのカチッ → 弾倉が擦れて抜ける → 抜けきる時に弾倉の口が当たり、中の弾が鳴る
function rlOut(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.4);
  mixInto(out, clack(sr, r, 2500 + r() * 400, 0.03, 0.55), 0, 1);
  { const m = S(sr, 0.13), z = noise(m, r); bp(z, 1700 + r() * 300, 1.3, sr); mulEnv(z, env(m, sr, 0.03, 0.1, 1.6)); mixInto(out, z, S(sr, 0.025), 0.45); }
  mixInto(out, dsin(S(sr, 0.12), sr, 820 + r() * 120, 0.025, r() * TAU), S(sr, 0.13), 0.35);
  for (let k = 0; k < 3; k++) mixInto(out, gearHit(sr, r, 'metal', 0.3), S(sr, 0.13 + k * 0.025 + r() * 0.01), 1);
  return fadeEdges(normalize(out, 0.62), sr);
}
// 新しい弾倉を出す: ポーチのふた（ベルクロのバリッ）・ナイロンのこすれ・弾倉が手の中で当たる
function rlPouch(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.4);
  mixInto(out, rustle(sr, r, 0.3, { f: 2400, dens: 900, peak: 0.3 }), 0, 0.6);
  { const n = S(sr, 0.09), v = new Float32Array(n), z = noise(n, r); hp(z, 2500, sr); for (let i = 0; i < n; i++) v[i] = z[i] * (r() < 0.12 ? 1 : 0.15); mulEnv(v, env(n, sr, 0.005, 0.08, 1.2)); mixInto(out, v, S(sr, 0.03), 0.55); }
  mixInto(out, gearHit(sr, r, 'mag', 0.9), S(sr, 0.2), 1);
  return fadeEdges(normalize(out, 0.5), sr);
}
// 差す: 差し込む擦れ → ラッチがかかる確かな「カチャッ」と胴の響き → 手のひらで下から叩く
function rlIn(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.45);
  { const m = S(sr, 0.09), z = noise(m, r); bp(z, 1400 + r() * 300, 1.2, sr); mulEnv(z, env(m, sr, 0.07, 0.02, 1)); mixInto(out, z, 0, 0.4); }
  mixInto(out, clack(sr, r, 1450 + r() * 200, 0.07, 1.1), S(sr, 0.085), 1);
  mixInto(out, thump(sr, r, 210, 130, 0.06, 0.7), S(sr, 0.085), 1);
  mixInto(out, dsin(S(sr, 0.1), sr, 640 + r() * 80, 0.03, 0), S(sr, 0.088), 0.3);
  { const m = S(sr, 0.04), z = noise(m, r); bp(z, 650, 0.8, sr); mulEnv(z, expEnv(m, sr, 0.0005, 0.01)); mixInto(out, z, S(sr, 0.16), 0.55); mixInto(out, thump(sr, r, 140, 90, 0.05, 0.5), S(sr, 0.16), 1); }
  return fadeEdges(normalize(sat(out, 1.2), 0.7), sr);
}
// ボルトを戻す（空からのリロード）: ボルトキャッチを押す小さなカチッ → ばねでボルトが走って閉じる「シャキン」と、銃の胴の響き
function rlBolt(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.4);
  mixInto(out, clack(sr, r, 2100, 0.03, 0.45), 0, 1);
  { const m = S(sr, 0.03), z = noise(m, r); hp(z, 2800, sr); mulEnv(z, env(m, sr, 0.005, 0.025, 1)); mixInto(out, z, S(sr, 0.035), 0.5); }
  mixInto(out, clack(sr, r, 1750 + r() * 200, 0.1, 1.2), S(sr, 0.06), 1);
  for (const [f, a] of [[2350, 0.3], [3650, 0.18], [5200, 0.08]]) mixInto(out, dsin(S(sr, 0.2), sr, f * (0.97 + r() * 0.06), 0.035, r() * TAU), S(sr, 0.06), a);
  mixInto(out, thump(sr, r, 170, 100, 0.07, 0.7), S(sr, 0.06), 1);
  return fadeEdges(normalize(sat(out, 1.25), 0.75), sr);
}
// 走る時の装備の揺れ（一歩ごと。弾倉・バックル・スリングの金具が当たり、布がこすれる）
function gearRun(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.3);
  mixInto(out, rustle(sr, r, 0.2, { f: 2100, dens: 500, peak: 0.25 }), 0, 0.45);
  rattle(out, sr, r, 0.01, 0.12, 5, 0.8, { buckle: 0.35, mag: 0.4, metal: 0.15, rifle: 0.1 });
  mixInto(out, strap(sr, r, 0.08, 1100), S(sr, 0.01), 0.12);
  lp(out, 7000, sr);
  return fadeEdges(normalize(out, 0.6), sr);
}
// 重い箱を置く（弾薬箱）: 箱の鈍い音・中の弾の箱がずれる・取っ手の金具
function boxDown(sr, seed) {
  const r = rng(seed), out = buf(sr, 0.5);
  mixInto(out, thump(sr, r, 110, 60, 0.14, 1), 0, 1);
  { const m = S(sr, 0.05), z = noise(m, r); bp(z, 600, 1.1, sr); mulEnv(z, expEnv(m, sr, 0.0005, 0.012)); mixInto(out, z, 0, 0.8); }
  rattle(out, sr, r, 0.008, 0.12, 6, 0.7, { mag: 0.6, metal: 0.4 });
  return fadeEdges(normalize(sat(out, 1.3), 0.75), sr);
}
function landS(sr, seed) { const r = rng(seed), out = buf(sr, 0.3); mixInto(out, thump(sr, r, 90, 45, 0.2, 1), 0, 1); mixInto(out, step(sr, seed, 'hard'), 0, 0.6); return fadeEdges(normalize(out, 0.8), sr); }
function radioClick(sr, seed, on) { const r = rng(seed), out = buf(sr, 0.18); const n = S(sr, on ? 0.1 : 0.16); const z = noise(n, r); bp(z, 2200, 0.7, sr); mulEnv(z, env(n, sr, 0.003, n / sr - 0.004, on ? 4 : 1)); mixInto(out, z, 0, on ? 0.6 : 0.9); mixInto(out, clack(sr, r, 2600, 0.03, 0.5), 0, 1); return fadeEdges(normalize(out, 0.45), sr); }
function beep(sr, f = 1500, d = 0.08, g = 0.5) { const out = buf(sr, d + 0.02); const n = S(sr, d); const s = sine(n, sr, f); mulEnv(s, env(n, sr, 0.004, d - 0.004, 1)); mixInto(out, s, 0, 1); return fadeEdges(normalize(out, g), sr); }
function tones(sr, list, g = 0.5) { const tot = list.reduce((m, [, t, d]) => Math.max(m, t + d), 0) + 0.05; const out = buf(sr, tot); for (const [f, t, d, gg = 1] of list) { const n = S(sr, d); const s = sine(n, sr, f); const s2 = sine(n, sr, f * 2); mixInto(s, s2, 0, 0.25); mulEnv(s, env(n, sr, 0.006, d - 0.006, 1.6)); mixInto(out, s, S(sr, t), gg); } return fadeEdges(normalize(out, g), sr); }
// 環境音（ループ）: 屋外の夜（虫と遠くの車）・屋内の蛍光灯と空調
function ambOut(sr, seed) {
  const r = rng(seed), out = buf(sr, 6.0), n = out.length;
  const z = noise(n, r); lp(z, 400, sr); mixInto(out, z, 0, 0.5);
  for (let k = 0; k < 90; k++) { const m = S(sr, 0.05); const s = sine(m, sr, 4200 + r() * 600); for (let i = 0; i < m; i++) s[i] *= Math.max(0, Math.sin(i / m * Math.PI)) * (0.5 + 0.5 * Math.sign(Math.sin(i / sr * TAU * 60))); mixInto(out, s, S(sr, r() * 5.9), 0.05); }
  // 端を重ねてつなぎ目をなくす
  return loopify(normalize(out, 0.35), sr);
}
function ambIn(sr, seed) { const r = rng(seed), out = buf(sr, 4.0), n = out.length; const h = sine(n, sr, 120); const h2 = sine(n, sr, 240); for (let i = 0; i < n; i++) out[i] = h[i] * 0.25 + h2[i] * 0.12; const z = noise(n, r); lp(z, 600, sr); hp(z, 80, sr); mixInto(out, z, 0, 0.5); return loopify(normalize(out, 0.3), sr); }
function loopify(x, sr) { const L = S(sr, 0.25), n = x.length; for (let i = 0; i < L; i++) { const t = i / L; x[i] = x[i] * t + x[n - L + i] * (1 - t); } return x.subarray(0, n - L); }

// 名前 → [作り方, 何種類]
// 心音（どくん・どくん）。くり返して鳴らす
function heart(sr, seed) {
  const r = rng(seed), n = S(sr, 0.86), out = new Float32Array(n);
  mixInto(out, thump(sr, r, 64, 40, 0.17, 1), 0, 1);
  mixInto(out, thump(sr, r, 56, 36, 0.19, 0.72), S(sr, 0.25), 1);
  lp(out, 180, sr);
  return fadeEdges(normalize(out, 0.9), sr, 0.002, 0.03);
}
export const SFX = {
  // 銃（近い）
  ...Object.fromEntries(Object.keys(GUNS).map(k => [k, [(sr, i) => gunNear(sr, 1000 + i * 17 + k.length * 3 + k.charCodeAt(1), k), 3]])),
  far_r: [(sr, i) => gunFar(sr, 77 + i, 'r'), 2], far_p: [(sr, i) => gunFar(sr, 91 + i, 'p'), 2], far_s: [(sr, i) => gunFar(sr, 99 + i, 's'), 2],
  sup_r: [(sr, i) => gunSupp(sr, 120 + i, 'r'), 3], sup_p: [(sr, i) => gunSupp(sr, 140 + i, 'p'), 3],
  bean: [(sr, i) => beanShot(sr, 160 + i), 2], launch: [(sr, i) => launchShot(sr, 165 + i), 1], air: [(sr, i) => airShot(sr, 170 + i), 2], taser: [(sr, i) => taserShot(sr, 180 + i), 1],
  // 足音
  step_hard: [(sr, i) => step(sr, 200 + i, 'hard'), 4], step_tile: [(sr, i) => step(sr, 210 + i, 'tile'), 4], step_wood: [(sr, i) => step(sr, 220 + i, 'wood'), 4],
  step_soft: [(sr, i) => step(sr, 230 + i, 'soft'), 4], step_grass: [(sr, i) => step(sr, 240 + i, 'grass'), 4], step_dirt: [(sr, i) => step(sr, 250 + i, 'dirt'), 4], step_metal: [(sr, i) => step(sr, 260 + i, 'metal'), 4],
  land: [(sr, i) => landS(sr, 270 + i), 1],
  stProne: [(sr, i) => stanceS(sr, 1240 + i, 'prone'), 2], stRise: [(sr, i) => stanceS(sr, 1245 + i, 'rise'), 2], stCrouch: [(sr, i) => stanceS(sr, 1250 + i, 'crouch'), 2], stStand: [(sr, i) => stanceS(sr, 1255 + i, 'stand'), 2], vaultS: [(sr, i) => vaultS(sr, 1260 + i), 2],
  gearRun: [(sr, i) => gearRun(sr, 1270 + i), 4],
  rlOut: [(sr, i) => rlOut(sr, 1280 + i), 2], rlPouch: [(sr, i) => rlPouch(sr, 1285 + i), 2], rlIn: [(sr, i) => rlIn(sr, 1290 + i), 2], rlBolt: [(sr, i) => rlBolt(sr, 1295 + i), 2],
  jumpUp: [(sr, i) => jumpUp(sr, 1200 + i), 3], jumpLand: [(sr, i) => jumpLand(sr, 1210 + i, false), 3], fallLand: [(sr, i) => jumpLand(sr, 1220 + i, true), 2], boxDown: [(sr, i) => boxDown(sr, 1230 + i), 2],
  // 当たる
  impHard: [(sr, i) => impact(sr, 300 + i, 'hard'), 3], impWood: [(sr, i) => impact(sr, 310 + i, 'wood'), 3], impMetal: [(sr, i) => impact(sr, 320 + i, 'metal'), 3], impGlass: [(sr, i) => impact(sr, 330 + i, 'glass'), 2], impSoft: [(sr, i) => impact(sr, 340 + i, 'soft'), 2],
  fleshHit: [(sr, i) => fleshHit(sr, 350 + i), 3], plateHit: [(sr, i) => plateHit(sr, 360 + i), 3], whiz: [(sr, i) => whiz(sr, 370 + i), 3],
  shell: [(sr, i) => shellCase(sr, 380 + i, false), 3], shellSg: [(sr, i) => shellCase(sr, 390 + i, true), 2],
  glass: [(sr, i) => glassBreak(sr, 400 + i), 2], wallBreak: [(sr, i) => wallBreak(sr, 410 + i), 2], reinforce: [(sr, i) => reinforce(sr, 420 + i), 1],
  // 扉
  doorOpen: [(sr, i) => doorOpen(sr, 500 + i), 3], doorClose: [(sr, i) => doorClose(sr, 510 + i), 2], doorKick: [(sr, i) => doorKick(sr, 520 + i), 2], doorKickFail: [(sr, i) => doorKickFail(sr, 530 + i), 2],
  doorRam: [(sr, i) => doorRam(sr, 540 + i), 1], doorBreach: [(sr, i) => doorBreach(sr, 550 + i), 1], doorLocked: [(sr, i) => doorLocked(sr, 560 + i), 2], lockPick: [(sr, i) => lockPick(sr, 570 + i), 1], wedge: [(sr, i) => wedge(sr, 580 + i), 1],
  barricade: [(sr, i) => hammer(sr, 590 + i), 1], barBreak: [(sr, i) => doorKick(sr, 600 + i), 1], woodHit: [(sr, i) => impact(sr, 610 + i, 'wood'), 2],
  // 爆発物
  explosion: [(sr, i) => boom(sr, 700 + i, true), 2], explosion_far: [(sr, i) => boomFar(sr, 740 + i), 2], flashbang: [(sr, i) => flashBang(sr, 710 + i), 2], stinger: [(sr, i) => stingerBang(sr, 720 + i), 1], gasPop: [(sr, i) => gasPop(sr, 730 + i), 1],
  nadeBounce: [(sr, i) => nadeBounce(sr, 740 + i), 2], throw: [(sr, i) => throwW(sr, 750 + i), 2],
  // 銃と装備の扱い
  magOut: [(sr, i) => magOut(sr, 800 + i), 2], magIn: [(sr, i) => magIn(sr, 810 + i), 2], pump: [(sr, i) => pump(sr, 820 + i), 1], bolt: [(sr, i) => boltS(sr, 1020 + i), 2], shellIn: [(sr, i) => shellIn(sr, 830 + i), 2], shellStart: [(sr, i) => cloth(sr, 840 + i, 0.2, 2000), 1],
  dry: [(sr, i) => dry(sr, 850 + i), 1], draw: [(sr, i) => draw(sr, 860 + i), 2], fmode: [(sr, i) => dry(sr, 870 + i), 1], click: [(sr, i) => dry(sr, 880 + i), 1],
  cuffs: [(sr, i) => cuffs(sr, 900 + i), 1], cuffsStart: [(sr, i) => cloth(sr, 910 + i, 0.35, 1800), 1], mirror: [(sr, i) => cloth(sr, 920 + i, 0.3, 3200), 1], act: [(sr, i) => cloth(sr, 930 + i, 0.25, 2400), 2],
  bandage: [(sr, i) => bandage(sr, 940 + i), 1], inhale: [(sr, i) => breathS(sr, 1100 + i, 'in'), 2], exhale: [(sr, i) => breathS(sr, 1110 + i, 'out'), 2], gasp: [(sr, i) => breathS(sr, 1120 + i, 'gasp'), 1], spray: [(sr, i) => sprayS(sr, 950 + i), 1], nvg: [(sr, i) => nvgWhine(sr, 960 + i), 1], drone: [(sr, i) => droneLoop(sr, 970 + i), 1],
  ring: [(sr) => ring(sr), 1], radioOn: [(sr, i) => radioClick(sr, 980 + i, true), 2], radioOff: [(sr, i) => radioClick(sr, 990 + i, false), 2],
  beep: [(sr) => beep(sr, 1900, 0.07, 0.45), 1], heart: [(sr, i) => heart(sr, 1010 + i), 1],
  // 画面の音
  ui_tap: [(sr) => tones(sr, [[1400, 0, 0.035]], 0.3), 1], ui_back: [(sr) => tones(sr, [[900, 0, 0.04], [700, 0.04, 0.05]], 0.3), 1], ui_deny: [(sr) => tones(sr, [[300, 0, 0.09], [240, 0.09, 0.12]], 0.4), 1],
  ui_ok: [(sr) => tones(sr, [[880, 0, 0.08], [1320, 0.08, 0.14]], 0.4), 1], ui_cmd: [(sr) => tones(sr, [[1200, 0, 0.04], [1600, 0.05, 0.05]], 0.3), 1],
  ui_hit: [(sr) => tones(sr, [[2600, 0, 0.03]], 0.35), 1], ui_hitArmor: [(sr) => tones(sr, [[1500, 0, 0.04, 1], [3000, 0, 0.04, 0.4]], 0.35), 1], ui_kill: [(sr) => tones(sr, [[2200, 0, 0.05], [3300, 0.04, 0.07]], 0.4), 1],
  ui_alarm: [(sr) => tones(sr, [[1000, 0, 0.15], [700, 0.18, 0.15], [1000, 0.36, 0.15], [700, 0.54, 0.15]], 0.45), 1], ui_spot: [(sr) => tones(sr, [[1800, 0, 0.05], [1800, 0.08, 0.05]], 0.3), 1],
  ui_go: [(sr) => tones(sr, [[660, 0, 0.12], [990, 0.12, 0.2]], 0.45), 1], ui_win: [(sr) => tones(sr, [[523, 0, 0.18], [659, 0.15, 0.18], [784, 0.3, 0.4]], 0.5), 1], ui_lose: [(sr) => tones(sr, [[392, 0, 0.25], [330, 0.22, 0.25], [262, 0.44, 0.5]], 0.5), 1],
  ui_pickup: [(sr) => tones(sr, [[1000, 0, 0.05], [1500, 0.05, 0.07]], 0.35), 1], ui_tick: [(sr) => tones(sr, [[1250, 0, 0.06]], 0.35), 1],
  amb_out: [(sr) => ambOut(sr, 1), 1], amb_in: [(sr) => ambIn(sr, 2), 1],
};
export function renderSfx(name, i, sr) { const d = SFX[name]; if (!d) return new Float32Array(1); return d[0](sr, i); }
// 銃の音の種類 → 近い音・遠い音・消音器の音
export function gunKeys(snd) {
  const rifle = snd && snd[0] === 'r' || snd === 'p46' || snd === 'p57' || snd === 'h57' || snd === 'h357';
  if (snd === 'sup9') return { near: 'sup_p', far: 'sup_p', supp: 'sup_p' };
  if (snd === 'bean') return { near: 'bean', far: 'far_s', supp: 'bean' };
  if (snd === 'air') return { near: 'air', far: 'air', supp: 'air' };
  if (snd === 'taser') return { near: 'taser', far: 'taser', supp: 'taser' };
  return { near: GUNS[snd] ? snd : 'p9', far: snd === 'sg' ? 'far_s' : rifle ? 'far_r' : 'far_p', supp: rifle && snd[0] === 'r' ? 'sup_r' : 'sup_p' };
}
export { GUNS };
