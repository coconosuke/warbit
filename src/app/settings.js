// 設定の既定値と保存。sv: 設定の形の版（形を変えたら上げて、古い値を直す）
import { load, save } from './save.js';
import { LOADOUTS, PVP_LOADOUTS } from '../engine/data/npc.js';

export const DEFAULTS = {
  sv: 2,
  // 視点と照準
  sens: 1.0, sensAds: 0.75, sensScope: 0.45, sensFire: 1.0, invertY: false, fireLook: true,
  // 倍率ごとの感度（BattleBit の 1x・2x・4x・8x… の感度に合わせ、倍率ごとに選べる。11-20）。間の倍率は近い下の値を倍率で割って同じ画面の速さに
  sensZ: { 2: 0.72, 3: 0.6, 4: 0.45, 6: 0.3, 8: 0.225 },
  aimAssist: 'mid', // off | weak | mid | strong | max（大規模戦。タッチだけ。11-19 23:27）
  gyro: 'off', gyroSens: 1.0, gyroInvX: false, gyroInvY: false,
  // 操作
  reloadDrop: false, // 大規模戦: 1回押しのリロードで弾倉を落とす（速い）。2回押しはいつも落とす
  adsMode: 'tap', // tap（押すたび切替）| hold（押している間）| mixed（短く押すと切替・長く押すと押している間）
  leanMode: 'toggle', breathMode: 'toggle', stickMode: 'float', stickSprint: true, handed: 'right', leftFire: true, stickLock: false, radialScale: 1, confirm: 'auto',
  // HUD
  hud: {}, hudOpacity: 0.85, hudScale: 1.0, crosshair: 'cross', crossColor: '#ffffff', minimap: true, subtitles: true, subBg: 0.42, hitMarker: true,
  // BattleBit のゲームの設定に合わせて足した物（11-20）: 照準の大きさ・濃さ、ヒットマーカーの色（体・頭・防具・倒した）、倒れたら自動で出撃、描画距離
  crossSize: 1, crossOpacity: 1, hitCol: { body: '#ffffff', head: '#ffe600', armor: '#3d7dff', kill: '#ff2a1f' }, autoDeploy: false, viewDistSel: 'auto', allyCol: '#4aa8ff', enemyCol: '#ff4b3e', flagMarkSize: 1, markSize: 1, squadList: false, contrast: 1,
  // 11-20 続き（BattleBit の Friendly Name Tag Size・Show Pings・Screen Shake・2回押しのリロードの間）: 味方の名前の大きさ（文字の px）、
  //  敵の印を出す、画面の揺れ（0〜1。前の「画面の揺れ」標準／弱 は効いていなかった）、リロードの2回押しとみなす間（秒）
  nameSize: 11, showPings: true, shakeK: 1, rlDbl: 0.4,
  // 大規模戦の 投げ物・道具 のボタンの円の並び（上・右・下・左。'' は空き）。数が変わっても場所は変わらない（11-20）
  //  投げ物: frag 破片・impact 衝撃・smoke 発煙・flash 閃光。道具: tool 兵科の道具（弾薬箱・医療キット・双眼鏡）・gad 副の道具（C4・地雷）・hammer ハンマー・long RPG など
  radNade: ['frag', 'impact', 'smoke', 'flash'], radGad: ['tool', 'gad', 'hammer', 'long'],
  // 画面
  quality: 'medium', // low | medium | high | custom（下の gfx を自分で選ぶ）
  gfx: { detail: 'medium', shadow: 'low', bloom: true, aa: 'fxaa', lights: 6, fx: 'normal', shells: true },
  fps: 60, scale: 1.0, autoRes: true, hfov: 82, vmFov: 54, scopePip: 'on', sat: 1.08, vignette: true, blood: true, shake: true, showFps: false, bright: 1.0,
  // 音
  vol: { master: 0.9, bgm: 0.5, sfx: 0.9, voice: 1.0, ui: 0.7 }, playSilent: false,
};

export function loadSettings() {
  const s = load('settings', {}) || {};
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(out)) if (s[k] !== undefined) out[k] = (typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) ? { ...out[k], ...s[k] } : s[k];
  // 版1 → 2: 視野角は縦の角度 → 横の角度（16:9の画面で）
  if ((s.sv || 1) < 2 && typeof s.fov === 'number' && s.hfov === undefined) out.hfov = Math.round(2 * Math.atan(Math.tan(s.fov * Math.PI / 360) * 16 / 9) * 180 / Math.PI);
  if (!['low', 'medium', 'high', 'custom'].includes(out.quality)) out.quality = 'medium';
  // 前の「スコープ」の感度（1つ）を変えていた人: 倍率ごとの値をその割合で
  if (s.sensScope !== undefined && s.sensZ === undefined && s.sensScope !== DEFAULTS.sensScope) { const f = s.sensScope / DEFAULTS.sensScope; for (const k of Object.keys(out.sensZ)) out.sensZ[k] = +(DEFAULTS.sensZ[k] * f).toFixed(3); }
  // 前の「画面の揺れ: 弱」→ 揺れ 50%
  if (s.shake === false && s.shakeK === undefined) out.shakeK = 0.5;
  // 円の並びは4つの文字の列（違えば既定に）
  for (const k of ['radNade', 'radGad']) if (!Array.isArray(out[k]) || out[k].length !== 4 || out[k].some(x => typeof x !== 'string')) out[k] = DEFAULTS[k].slice();
  out.sv = DEFAULTS.sv;
  return out;
}
export function saveSettings(s) { save('settings', s); }
// 倍率 z の感度（倍率ごとの設定から）
export function sensForZoom(st, z) {
  const Z = st.sensZ || DEFAULTS.sensZ, keys = Object.keys(Z).map(Number).sort((a, b) => a - b);
  let k = keys[0]; for (const q of keys) if (q <= z + 1e-6) k = q;
  return (Z[k] ?? DEFAULTS.sensZ[k]) * Math.min(1.25, k / Math.max(1, z));
}
// 横の視野角（16:9の画面で）→ 縦の視野角（ラジアン）。横に長い画面ほど横が広く見える
export function vfovOf(hfovDeg) { return 2 * Math.atan(Math.tan((hfovDeg || 82) * Math.PI / 360) * 9 / 16); }

// 名前（オンラインと結果に出る）
export const DEFAULT_PROFILE = { name: 'リード' };
export function loadProfile() { const p = { ...DEFAULT_PROFILE, ...(load('profile', {}) || {}) }; if (p.name === 'あなた') p.name = DEFAULT_PROFILE.name; return p; }
export function saveProfile(p) { save('profile', p); }

// 装備（自分とAI隊員4人、対戦の陣営ごと）
export function loadLoadouts() {
  const L = load('loadouts', null) || {};
  const def = JSON.parse(JSON.stringify({ player: LOADOUTS.player, ai: [LOADOUTS.red1, LOADOUTS.red2, LOADOUTS.blue1, LOADOUTS.blue2], pvp: PVP_LOADOUTS }));
  const pvp = L.pvp && L.pvp.swat && L.pvp.sus ? L.pvp : def.pvp;
  return { player: L.player || def.player, ai: Array.isArray(L.ai) && L.ai.length === 4 ? L.ai : def.ai, pvp };
}
export function saveLoadouts(L) { save('loadouts', L); }
