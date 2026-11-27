// 一人称の腕と銃: 腰だめ↔ADS（照準の線を目に合わせる）、揺れ（向きの慣性・歩き・呼吸）、撃った跳ね、リロード・ポンプ・持ち替え・ローレディ・ダッシュ・投げ物
import { MeshBuilder, hex, mulc } from './build.js';
import { LAYER } from './textures.js';
import { makeWorldMesh, drawMesh, delMesh } from './renderer.js';
import { bipodMatrix } from './guns.js';
import { WEAPONS, opticOf, swayCamK, PIP_MAX_ZOOM } from '../engine/data/weapons.js';
// スコープの中の像のレンズの大きさ（画面の縦の半分に対する半径。BattleBit の 4倍の見え方に合わせて約半分）
export const PIP_LENS = 0.5;
import { GEAR } from '../engine/data/equipment.js';
import { curWeapon } from '../engine/actor.js';
import { WV } from './build.js';
import { ACT_POSE, FREE_HANDS } from '../engine/data/acts.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const bell = (t) => Math.sin(Math.PI * clamp(t, 0, 1));
const lerp = (a, b, t) => a + (b - a) * t;
function rot(v, ax, ang) { const c = Math.cos(ang), s = Math.sin(ang), d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2]; const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; return [v[0] * c + cr[0] * s + ax[0] * d * (1 - c), v[1] * c + cr[1] * s + ax[1] * d * (1 - c), v[2] * c + cr[2] * s + ax[2] * d * (1 - c)]; }
function ik2(a, t, l1, l2, pole) {
  let d = [t[0] - a[0], t[1] - a[1], t[2] - a[2]]; let L = Math.hypot(d[0], d[1], d[2]);
  const maxL = (l1 + l2) * 0.999; if (L > maxL) { d = d.map(x => x * maxL / L); L = maxL; }
  const dn = d.map(x => x / Math.max(L, 1e-4));
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pd = pole[0] * dn[0] + pole[1] * dn[1] + pole[2] * dn[2];
  let p = [pole[0] - dn[0] * pd, pole[1] - dn[1] * pd, pole[2] - dn[2] * pd]; const pl = Math.hypot(p[0], p[1], p[2]) || 1; p = p.map(q => q / pl);
  return [a[0] + dn[0] * x + p[0] * h, a[1] + dn[1] * x + p[1] * h, a[2] + dn[2] * x + p[2] * h];
}

export class ViewModel {
  constructor(r, av) {
    this.r = r; this.av = av; this.gl = r.gl;
    this.on = false;
    this.sway = [0, 0]; this.swayV = [0, 0]; this.lastYaw = null; this.lastPitch = null;
    this.t = 0; this.drawK = 1; this.kick = 0; this.shotN = 0;
    this.M = new Float32Array(16); this.Mm = new Float32Array(16); this.Ms = new Float32Array(16); this.shieldOn = false;
    this.armVB = null; this.armN = 0;
    this.sleeve = hex('#232c3b'); this.glove = hex('#1c1d20');
    this.nadeMeshes = {};
    this.out = { muzzle: [0, 0, 0], fwd: [0, 0, 1], light: null, eject: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0] };
    this._off = [r.hook('viewmodel', (rr, f) => this.draw(f))];
  }
  dispose() {
    for (const f of this._off || []) f(); this._off = [];
    const gl = this.gl;
    try { for (const k of Object.keys(this.nadeMeshes || {})) delMesh(gl, this.nadeMeshes[k]); if (this.armVAO) { gl.deleteVertexArray(this.armVAO); gl.deleteBuffer(this.armVB); gl.deleteBuffer(this.armIB); } } catch (e) { /* 消えている */ }
    this.nadeMeshes = {}; this.armVAO = this.armVB = this.armIB = null;
  }
  setColors(sleeve, glove) { this.sleeve = sleeve; this.glove = glove; }
  nadeMesh(id) {
    if (this.nadeMeshes[id]) return this.nadeMeshes[id];
    const B = new MeshBuilder();
    if (id === 'frag' || id === 'impact') {
      // M67: 丸い本体（手の中で見える大きさ）
      const c = id === 'frag' ? hex('#4b5332') : hex('#5b5b3c');
      B.loft([{ y: -0.04, rx: 0.014, rz: 0.014 }, { y: -0.03, rx: 0.034, rz: 0.034 }, { y: 0.0, rx: 0.038, rz: 0.038 }, { y: 0.03, rx: 0.032, rz: 0.032 }, { y: 0.044, rx: 0.014, rz: 0.014 }], 10, LAYER.paint, c, { capTop: true, capBot: true });
      B.cyl(0, 0, 0.042, 0.066, 0.01, 0.01, 6, LAYER.metal, hex('#8a8a80'));
      B.box(0.008, 0.0, -0.009, 0.014, 0.064, 0.009, LAYER.metal, hex('#9a9a90'));
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    if (id === 'ammobig' || id === 'ammosmall') {
      // 弾薬箱（手に持つ。この作品の形: 暗い緑の小箱と取っ手）
      const k = id === 'ammobig' ? 0.8 : 0.62;
      B.box(-0.09 * k, -0.06 * k, -0.06 * k, 0.09 * k, 0.05 * k, 0.06 * k, LAYER.metal, hex('#2f3822'));
      B.box(-0.03 * k, 0.05 * k, -0.008, 0.03 * k, 0.07 * k, 0.008, LAYER.rubber, hex('#15170f'));
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    if (id === 'binoc') {
      // 双眼鏡（この作品の形: 2本の筒と真ん中の橋）
      for (const x of [-0.033, 0.033]) { B.box(x - 0.021, -0.021, -0.06, x + 0.021, 0.021, 0.05, LAYER.rubber, hex('#2a2c26')); B.box(x - 0.024, -0.024, 0.05, x + 0.024, 0.024, 0.064, LAYER.rubber, hex('#1d1f1a')); }
      B.box(-0.012, -0.01, -0.03, 0.012, 0.012, 0.03, LAYER.metal, hex('#3a3c34'));
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    if (id === 'apmine' || id === 'clay') {
      // 手に持った対人地雷（平たい丸）・クレイモア（反った箱）
      if (id === 'apmine') { B.cyl(0, 0, -0.022, 0.022, 0.045, 0.04, 10, LAYER.metal, hex('#4a4d38')); B.cyl(0, 0, 0.022, 0.032, 0.013, 0.013, 8, LAYER.metal, hex('#2c2e26')); }
      else { B.box(-0.055, -0.022, -0.01, 0.055, 0.022, 0.01, LAYER.plain, hex('#55593d')); B.box(-0.04, 0.022, -0.005, 0.04, 0.027, 0.005, LAYER.plain, hex('#3f4230')); }
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    if (id === 'c4' || id === 'c4det') {
      // C4（この作品の形）: 灰色がかったオリーブの板にテープの帯、上に小さな起爆の箱と赤い灯。起爆の装置: 黒い握りと短いアンテナ・赤いボタン
      if (id === 'c4') {
        B.box(-0.055, -0.022, -0.03, 0.055, 0.022, 0.03, LAYER.plain, hex('#7b7a66'));
        for (const x of [-0.03, 0.03]) B.box(x - 0.008, -0.0235, -0.0315, x + 0.008, 0.0235, 0.0315, LAYER.rubber, hex('#2c2d2a'));
        B.box(-0.014, 0.022, -0.012, 0.014, 0.036, 0.012, LAYER.metal, hex('#333538'));
        B.emit = 1.5; B.box(-0.004, 0.036, -0.004, 0.004, 0.04, 0.004, LAYER.plain, hex('#ff3a2e')); B.emit = 0;
      } else {
        B.box(-0.022, -0.05, -0.014, 0.022, 0.04, 0.014, LAYER.rubber, hex('#1f2023'));
        B.tube([0.012, 0.04, 0], [0.012, 0.11, 0], 0.003, 0.002, 6, LAYER.metal, hex('#2a2b2e'), { caps: true });
        B.emit = 1.2; B.box(-0.009, 0.04, -0.009, 0.005, 0.048, 0.005, LAYER.plain, hex('#d8322a')); B.emit = 0;
      }
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    if (id === 'hammer') {
      // 大ハンマー（この作品の形）: 木の柄（下が原点の近く、上へ +Y）と、上の鉄の頭（横に長い）。柄の下にゴムの握り
      B.tube([0, -0.36, 0], [0, 0.36, 0], 0.016, 0.017, 8, LAYER.wood, hex('#7a5a36'), { caps: true });
      B.tube([0, -0.4, 0], [0, -0.22, 0], 0.019, 0.019, 8, LAYER.rubber, hex('#1d1e1c'), { caps: true });
      B.box(-0.1, 0.34, -0.042, 0.1, 0.43, 0.042, LAYER.metal, hex('#3c3f42'));
      B.box(-0.112, 0.35, -0.034, -0.1, 0.42, 0.034, LAYER.metal, hex('#5a5e62')); B.box(0.1, 0.35, -0.034, 0.112, 0.42, 0.034, LAYER.metal, hex('#5a5e62'));
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    if (id === 'medkit') {
      // 医療キット（この作品の形: 暗い色の布の袋に、白い札と赤い十字）
      B.box(-0.05, -0.032, -0.03, 0.05, 0.032, 0.03, LAYER.cloth, hex('#3a3d2e'));
      // 札は手前（目の側）と上に
      B.box(-0.018, -0.018, -0.032, 0.018, 0.018, -0.0305, LAYER.metal, hex('#d9d4c8'));
      B.box(-0.004, -0.012, -0.0335, 0.004, 0.012, -0.032, LAYER.metal, hex('#a3241c'));
      B.box(-0.012, -0.004, -0.0335, 0.012, 0.004, -0.032, LAYER.metal, hex('#a3241c'));
      B.box(-0.018, 0.0305, -0.018, 0.018, 0.032, 0.018, LAYER.metal, hex('#d9d4c8'));
      B.box(-0.004, 0.032, -0.012, 0.004, 0.0335, 0.012, LAYER.metal, hex('#a3241c'));
      B.box(-0.012, 0.032, -0.004, 0.012, 0.0335, 0.004, LAYER.metal, hex('#a3241c'));
      const m = makeWorldMesh(this.gl, B); this.nadeMeshes[id] = m; return m;
    }
    const col = id === 'flash' ? hex('#3a4a3a') : id === 'stinger' ? hex('#3a3a40') : id === 'cs' ? hex('#5a5a40') : hex('#4a4a4a');
    B.cyl(0, 0, -0.06, 0.06, 0.03, 0.03, 10, LAYER.metal, col, { capB: true });
    B.cyl(0, 0, 0.06, 0.085, 0.012, 0.012, 6, LAYER.metal, hex('#8a8a80'));
    B.box(0.006, 0.02, -0.012, 0.012, 0.09, 0.012, LAYER.metal, hex('#9a9a90'));
    const m = makeWorldMesh(this.gl, B);
    this.nadeMeshes[id] = m;
    return m;
  }

  // このこまの銃と腕の位置を決める。a: 自分（エンジンの人）、cam: カメラ（世界）
  update(a, cam, dt, o = {}) {
    this.on = !!(a && a.alive && !a.down);
    if (!this.on) return;
    this.t += dt;
    const W = curWeapon(a) ? WEAPONS[curWeapon(a).id] : null;
    const wi = curWeapon(a);
    const ws = a.ws;
    // カメラの軸（ロール込み）
    const cp = Math.cos(cam.pitch), F = [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp];
    let R = [-Math.cos(cam.yaw), 0, Math.sin(cam.yaw)];
    let U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
    if (cam.roll) { const c = Math.cos(cam.roll), s = Math.sin(cam.roll); const U2 = [U[0] * c + R[0] * s, U[1] * c + R[1] * s, U[2] * c + R[2] * s]; R = [R[0] * c - U[0] * s, R[1] * c - U[1] * s, R[2] * c - U[2] * s]; U = U2; }
    // 揺れ（向きの慣性）
    if (this.lastYaw != null) {
      let dy = cam.yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const dp = cam.pitch - this.lastPitch;
      const k = 1 - 0.75 * a.ads;
      this.swayV[0] += clamp(-dy / Math.max(dt, 1e-3) * 0.012, -0.08, 0.08) * k;
      this.swayV[1] += clamp(-dp / Math.max(dt, 1e-3) * 0.012, -0.08, 0.08) * k;
    }
    this.lastYaw = cam.yaw; this.lastPitch = cam.pitch;
    for (let i = 0; i < 2; i++) { this.sway[i] += this.swayV[i]; this.swayV[i] = 0; this.sway[i] *= Math.exp(-dt * 9); this.sway[i] = clamp(this.sway[i], -0.12, 0.12); }
    // 手に持った特殊装備（slot 3）か銃
    const L3 = ws.slot === 3 && a.inv.long && a.inv.long !== 'none' ? a.inv.long : null;
    const gm = L3 ? this.av.longMesh(L3) : wi ? this.av.gunMesh(wi.id, wi.att) : null;
    const shieldUp = a.inv.long === 'shield' && ws.slot === 1 && !a.vault && ws.st !== 'holster';
    const P = gm ? gm.g.pts : { sightY: 0.05, eyeZ: -0.3, muzzle: 0.3, gripR: [0, -0.08, -0.05], gripL: [0, -0.04, 0.2] };
    const pistol = !!P.pistol;
    // 倍率スコープをのぞいている: 銃（筒とレンズのふた）は描かず、HUD のスコープの像に任せる（筒の中から見ると視界がふさがれていた）
    const os = P.optic && wi ? opticOf(wi) : null;
    // 構え 0.7〜0.95 で HUD のスコープの像が現れる（game.js _aimFx）。像がほぼ出そろう 0.9 で銃を消す（入れ替わりが目立たないように）
    // スコープの中の像（o.pip。倍率 6 未満）: 銃とスコープは描いたまま、目をレンズに寄せる。レンズの丸の中は renderer が拡大した世界を描く
    const pip = !!(o.pip && os && os.scope && os.zoom < PIP_MAX_ZOOM && P.optic.zb != null);
    this.pip = pip;
    this.scoped = !!(os && os.scope && a.ads > 0.9 && !pip);
    // ブースター（ホロ＋3倍）: 等倍のときは横へ倒す（0.25秒）
    //  ブースター（11-27 16:22。G33・6XMag）も同じ: 等倍のドット・ホロでのぞく間は倒す
    this.flipK = lerp(this.flipK || 0, os && (P.optic.kind === 'mag3' || P.boost) && !os.scope && !os.cant ? 1 : 0, 1 - Math.exp(-dt * 12));
    // 横・上の照準器（11-27 16:22）でのぞいている: 銃を傾け（オフセット）、その照準器を目の前へ
    this.cantK = lerp(this.cantK || 0, os && os.cant && P.cant ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.cantR = os && os.cant ? os.roll || 0 : this.cantR || 0;
    this.flipP = P.flipPivot || null;
    this.bipK = lerp(this.bipK || 0, a.bip ? 1 : 0, 1 - Math.exp(-dt * 14));
    // 状態の重み
    // 倒れた味方を引きずっている間（11-27）も、走る時と同じく銃を下げて横へ（片手がふさがる）
    const ads = sm(a.ads), low = sm(a.low), spr = a.sprint || a.drag != null ? 1 : 0;
    // 走るのをやめたら速く上げる（エンジンは 0.1〜0.25秒で撃てる。weapon.js sprintOutT）
    this.sprK = lerp(this.sprK || 0, spr, 1 - Math.exp(-dt * (spr ? 10 : 22)));
    let draw = 0;
    if (ws.st === 'holster') draw = 1 - clamp(ws.t / 0.22, 0, 1);
    else if (ws.st === 'draw') draw = clamp(ws.t / Math.max(0.2, W ? W.draw : 0.3), 0, 1);
    // 弾倉をまとめている（大規模戦）: 銃を少し下げる
    else if (ws.st === 'consol') draw = 0.35;
    this.drawK = lerp(this.drawK, draw, 1 - Math.exp(-dt * 25));
    // 特殊装備そのものを使う動作（破城槌・散弾・ワンド）は銃を下げない
    const ownAct = !!(a.act && L3 && ((L3 === 'ram' && a.act.k === 'ram') || (L3 === 'breacher' && a.act.k === 'breach') || (L3 === 'wand' && a.act.k === 'wand')));
    const act = a.act && !ownAct && !a.act.quick && a.act.pose !== 'knob' ? 1 : 0;
    this.actK = lerp(this.actK || 0, act, 1 - Math.exp(-dt * 8));
    // 両手を使う動作（拘束・作業・拾う・取りつけ・包帯）: 銃は下へ（吊る）、両手が前に出る
    const ap = a.act && !ownAct ? (a.act.pose || ACT_POSE[a.act.k] || null) : null;
    const actT = a.act ? clamp(a.act.t / Math.max(0.05, a.act.dur), 0, 1) : 0;
    const freeOn = !!(ap && FREE_HANDS.has(ap));
    this.freeK = lerp(this.freeK || 0, freeOn ? 1 : 0, 1 - Math.exp(-dt * 9));
    // 位置（カメラ空間: x右 y上 z前）と回転
    // 腰だめ: 画面の右下に収まり、銃口が画面の中央の少し下へ向く（スマホの小さい画面で大きすぎないよう、少し遠く・低く）
    // RPG-7 は右の肩に載せる（筒は照準の線の右下。腰だめでも筒の先と弾頭が画面の右に見える）
    const hip = P.heavy ? [0.05, -0.25, 0.5] : L3 === 'wand' ? [0.09, -0.2, 0.4] : P.rocket ? [0.1, -0.07, 0.22] : pistol ? [0.105, -0.112, 0.4] : [0.128, -0.128, 0.36];
    // 照準の窓が画面に対して大きすぎないよう、目を少し後ろに（スマホの小さい画面向け）
    const adsP = [0, -P.sightY, -P.eyeZ + (P.optic && !(os && os.scope) ? (pistol ? 0.03 : 0.09) : 0.04)];
    // スコープの中の像: 後ろのレンズ（半径 rr）が画面の縦の半分の PIP_LENS になる距離まで目を寄せる
    const tv = Math.tan((o.vmFov || 54 * Math.PI / 180) / 2);
    if (pip) adsP[2] = P.optic.rr / (PIP_LENS * tv) - P.optic.zb;
    let px = lerp(hip[0], adsP[0], ads), py = lerp(hip[1], adsP[1], ads) - bell(a.ads) * 0.012, pz = lerp(hip[2], adsP[2], ads);
    let yaw = lerp(pistol ? 0.03 : 0.05, 0, ads), pitch = 0, roll = 0;
    // 破城槌は体の前で斜めに抱える
    if (P.heavy) { yaw = 0.5; pitch = -0.1; roll = 0.22; }
    // 歩き・呼吸
    // 歩き・走りの揺れ（11-19 18:16: まっすぐ走ると細かく速く揺れていた）: エンジンの歩きの位相（ステップごとに飛ぶ）は使わず、
    //  なめらかにした速さでこまごとに位相を進める。走りは歩幅を長く（ゆっくり大きく）、横揺れ・傾きは控えめ
    this.spdS = lerp(this.spdS ?? (a.spd || 0), a.spd || 0, 1 - Math.exp(-dt * 8));
    this.gndK = lerp(this.gndK ?? 1, a.ground ? 1 : 0.3, 1 - Math.exp(-dt * 10));
    const stepL = this.sprK > 0.5 ? 1.35 : a.st > 1.5 ? 0.4 : a.st > 0.5 ? 0.6 : 0.8;
    this.ph = ((this.ph || 0) + this.spdS * dt * Math.PI / stepL) % (Math.PI * 2000);
    const amp = clamp(this.spdS / 2.4, 0, 1.3) * (1 - 0.82 * ads) * this.gndK;
    const ph = this.ph;
    px += Math.sin(ph) * 0.006 * amp; py += -Math.abs(Math.cos(ph)) * 0.009 * amp + Math.sin(this.t * 1.7) * 0.0018 * (1 - 0.7 * ads);
    roll += Math.sin(ph) * 0.014 * amp; pitch += Math.sin(this.t * 1.25) * 0.004 * (1 - 0.7 * ads);
    // 揺れ
    yaw += this.sway[0] * 0.6; pitch += this.sway[1] * 0.6; px -= this.sway[0] * 0.04; py -= this.sway[1] * 0.03;
    // 構えたときの照準の揺れ（エンジンの ws.sx/sy。度）のうち銃が受け持つ分（等倍の照準器は 65%。視界は残り。HUD の点も同じだけずれる）
    if (wi && a.ads > 0.01) { const g = 1 - swayCamK(wi, a.ads, pip); yaw += g * (ws.sx || 0) * Math.PI / 180; pitch += g * (ws.sy || 0) * Math.PI / 180; }
    // ローレディ・ダッシュ・動作中・持ち替え
    const lowK = Math.max(low, this.actK * (1 - this.freeK) * 0.9);
    pitch -= 1.25 * this.freeK; py -= 0.32 * this.freeK; px += 0.07 * this.freeK; pz -= 0.05 * this.freeK;
    // 蹴る: 体が前へ出る
    if (ap === 'kick') { const e = Math.sin(Math.PI * clamp((actT - 0.3) / 0.38, 0, 1)); py -= 0.035 * e; pz += 0.03 * e; pitch += 0.06 * e; }
    pitch -= 0.62 * lowK; py -= 0.05 * lowK; pz -= 0.04 * lowK; px += 0.02 * lowK;
    yaw += 0.95 * this.sprK; roll += 0.45 * this.sprK; pitch -= 0.25 * this.sprK; px -= 0.02 * this.sprK; py -= 0.04 * this.sprK;
    pitch -= 1.1 * this.drawK; py -= 0.22 * this.drawK;
    // 撃った跳ね
    const fk = clamp(a.fireK || 0, 0, 1);
    if ((a.stats.sh || 0) !== this.shotN) { this.shotN = a.stats.sh || 0; this.rollSign = (this.shotN % 2 ? 1 : -1); }
    const kick = W ? W.rc.kick : 1;
    pz -= 0.022 * fk * kick * (1 - 0.45 * ads); pitch += (pistol ? 0.09 : L3 === 'm320' ? 0.16 : 0.028) * fk * kick; roll += 0.018 * fk * (this.rollSign || 1);
    // 近接（銃床で殴る）: 少し引いて、銃を横へ倒しながら前へ突き出す
    if (a.melee) {
      const t = a.melee.t;
      const e1 = bell(clamp(t / 0.16, 0, 1)) * (t < 0.16 ? 1 : 0), e2 = t >= 0.1 ? bell(clamp((t - 0.1) / 0.42, 0, 1)) : 0;
      pz -= 0.05 * e1; px += 0.03 * e1; yaw += 0.25 * e1;
      px -= 0.11 * e2; pz += 0.11 * e2; py += 0.035 * e2; yaw -= 0.95 * e2; roll += 0.55 * e2; pitch += 0.12 * e2;
    }
    // 破城槌を振る・散弾で撃つ
    if (ownAct) {
      const t = clamp(a.act.t / Math.max(0.05, a.act.dur), 0, 1);
      if (L3 === 'ram') { pz += t < 0.55 ? -0.12 * sm(t / 0.55) : -0.12 + 0.36 * sm((t - 0.55) / 0.3); py += 0.05 * bell(t); }
      else if (L3 === 'breacher') { pitch -= 0.25 * sm(t / 0.3); py -= 0.06 * sm(t / 0.3); if (t > 0.85) { pitch += 0.2 * bell((t - 0.85) / 0.15); pz -= 0.04 * bell((t - 0.85) / 0.15); } }
      else if (L3 === 'wand') { pitch -= 0.6 * sm(t); py -= 0.1 * sm(t); }
    }
    // リロード
    let magOff = 0, magHide = false, pumpOff = 0, pumpRot = 0, boltHand = 0, lhand = null, rel = -1;
    // RPG: 込めていない（撃った後・予備がない）間は弾頭を描かない
    let rocketHide = !!(P.rocket && a.inv.rpg && !a.inv.rpg.in);
    const longRl = ws.slot === 3 && ws.lt > 0 && ws.rd > 0;
    if ((ws.st === 'reload' || longRl) && ws.rd > 0) {
      rel = 1 - (longRl ? ws.lt : ws.t) / ws.rd;
      const b = bell(rel);
      // 11-20: 銃を画面の中ほどへ寄せて、少し下げ・遠くする（前は右へ大きく持ち上がって画面をふさぎ、手が見えなかった）
      roll -= 0.5 * b; pitch += 0.1 * b; px -= 0.045 * b; py -= 0.01 * b; pz += 0.03 * b;
      if (P.revolver || P.breakAction) { roll -= 0.4 * b; }
      else if (P.rocket) {
        // RPG: 筒の先を少し上げて左へ寄せ、左手でポーチから弾頭を出して前から差し込む（0.55〜0.85）
        roll += 0.2 * b; pitch += 0.14 * b; px -= 0.02 * b; pz += 0.06 * b;
        if (rel < 0.55) rocketHide = true;
        else if (rel < 0.85) pumpOff = 0.28 * (1 - sm((rel - 0.55) / 0.3));
      } else {
        if (rel > 0.12 && rel < 0.35) magOff = -0.3 * sm((rel - 0.12) / 0.23);
        else if (rel >= 0.35 && rel < 0.58) magHide = true;
        else if (rel >= 0.58 && rel < 0.75) magOff = -0.22 * (1 - sm((rel - 0.58) / 0.17));
      }
    } else if (ws.st === 'shell') {
      const per = W && W.rl.shell ? W.rl.shell : 0.5;
      const c = (ws.t % per) / per;
      roll -= 0.55; pitch += 0.1; px -= 0.02; rel = 1 - c;
    } else if (ws.st === 'pump') {
      const pr = 1 - clamp(ws.t / (W && W.pump ? W.pump : 0.5), 0, 1);
      if (P.bolt) {
        // ボルト: 右手を握りから槓桿へ（〜0.16）→ 起こす（〜0.26）→ 引く（〜0.46）→ 押す（〜0.64）→ 倒す（〜0.74）→ 握りへ戻る
        boltHand = pr < 0.16 ? sm(pr / 0.16) : pr > 0.74 ? 1 - sm((pr - 0.74) / 0.26) : 1;
        const lift = pr < 0.16 ? 0 : pr < 0.26 ? sm((pr - 0.16) / 0.1) : pr < 0.64 ? 1 : pr < 0.74 ? 1 - sm((pr - 0.64) / 0.1) : 0;
        pumpRot = -1.2 * lift; // 銃身の軸のまわりに右から上へ約70°
        pumpOff = pr < 0.26 ? 0 : pr < 0.46 ? -P.pumpZ * sm((pr - 0.26) / 0.2) : pr < 0.64 ? -P.pumpZ * (1 - sm((pr - 0.46) / 0.18)) : 0;
        // 銃を少し左へ傾けて前・下へ出す（引いた右手が顔に近づきすぎないように）
        roll -= 0.14 * bell(pr); yaw -= 0.05 * bell(pr); py -= 0.035 * bell(pr); pz += 0.06 * bell(pr);
      } else pumpOff = -(P.pumpZ || 0.08) * bell(pr);
    }
    // 投げ物を持っている
    const nade = ws.slot === 2 && ws.gear && GEAR[ws.gear] && (GEAR[ws.gear].kind === 'nade' || GEAR[ws.gear].kind === 'ammo' || GEAR[ws.gear].kind === 'medkit' || GEAR[ws.gear].kind === 'binoc' || GEAR[ws.gear].kind === 'hammer' || GEAR[ws.gear].kind === 'c4' || GEAR[ws.gear].kind === 'mine');
    // 双眼鏡をのぞききったら、手と双眼鏡は描かない（のぞき窓の絵だけ）
    if (ws.slot === 2 && ws.gear === 'binoc' && a.ads > 0.9) this.scoped = true;
    // C4 は「起爆」の間は起爆の装置を持つ
    this.nade = nade ? (ws.gear === 'c4' && ws.c4m === 'det' ? 'c4det' : ws.gear) : null;
    // 世界へ
    let gR = R, gU = U, gF = F;
    const rotAll = (ax, ang) => { gR = rot(gR, ax, ang); gU = rot(gU, ax, ang); gF = rot(gF, ax, ang); };
    // オフセットの照準器: 右に 45° 傾けて付けてあるので、銃の上を左へ傾ける（のぞく間だけ）
    const ck = this.cantK * ads;
    if (ck > 0.001 && this.cantR) { const t = rot(U, F, this.cantR); roll -= (t[0] * R[0] + t[1] * R[1] + t[2] * R[2] < 0 ? 1 : -1) * this.cantR * ck; }
    rotAll(U, yaw); rotAll(gR, pitch); rotAll(gF, -roll);
    const cx = cam.x, cy = cam.y, cz = cam.z;
    const org = [cx + R[0] * px + U[0] * py + F[0] * pz, cy + R[1] * px + U[1] * py + F[1] * pz, cz + R[2] * px + U[2] * py + F[2] * pz];
    // 横・上の照準器を目の前へ: のぞく点（銃の座標 P.cant.p）が、目の前の P.cant.eye の距離に来るように銃をずらす
    if (ck > 0.001 && P.cant) {
      const c = P.cant.p, dist = c[2] - P.cant.eye;
      for (let i = 0; i < 3; i++) { const d = -gR[i] * c[0] + gU[i] * c[1] + gF[i] * c[2]; const tg = [cx, cy, cz][i] + F[i] * dist - d; org[i] += (tg - org[i]) * ck; }
    }
    const M = this.M;
    M[0] = -gR[0]; M[1] = -gR[1]; M[2] = -gR[2]; M[3] = 0;
    M[4] = gU[0]; M[5] = gU[1]; M[6] = gU[2]; M[7] = 0;
    M[8] = gF[0]; M[9] = gF[1]; M[10] = gF[2]; M[11] = 0;
    M[12] = org[0]; M[13] = org[1]; M[14] = org[2]; M[15] = 1;
    this.gm = nade ? null : gm; this.magOff = magOff; this.magHide = magHide; this.pumpOff = pumpOff; this.pumpRot = pumpRot; this.pumpHide = rocketHide && !(rel >= 0.55);
    const toW = (p) => [org[0] - gR[0] * p[0] + gU[0] * p[1] + gF[0] * p[2], org[1] - gR[1] * p[0] + gU[1] * p[1] + gF[1] * p[2], org[2] - gR[2] * p[0] + gU[2] * p[1] + gF[2] * p[2]];
    const camP = (x, y, z) => [cx + R[0] * x + U[0] * y + F[0] * z, cy + R[1] * x + U[1] * y + F[1] * z, cz + R[2] * x + U[2] * y + F[2] * z];
    this.out.muzzle = toW([0, 0, P.muzzle]); this.out.fwd = gF; this.out.right = gR; this.out.up = gU;
    // カメラの軸（一人称の銃の点を、世界の画角で同じ画面の位置に移すため。game.js のレーザー）
    const oc = this.out.cam || (this.out.cam = {}); oc.x = cx; oc.y = cy; oc.z = cz; oc.R = R; oc.U = U; oc.F = F; oc.fov = o.vmFov || 54 * Math.PI / 180;
    this.out.eject = toW([-0.02, 0.025, 0.02]);
    // スコープの後ろのレンズの、画面の上の位置（u・v は 0〜1、下が 0）と半径（縦の半分に対する割合）。向きは銃の向き
    this.out.lens = null;
    if (pip) {
      const Lw = toW([0, P.optic.y, P.optic.zb]), dx = Lw[0] - cx, dy = Lw[1] - cy, dz = Lw[2] - cz;
      const lx = dx * R[0] + dy * R[1] + dz * R[2], ly = dx * U[0] + dy * U[1] + dz * U[2], lz = dx * F[0] + dy * F[1] + dz * F[2];
      if (lz > 0.01) this.out.lens = { u: 0.5 + 0.5 * lx / lz / (tv * (o.aspect || 16 / 9)), v: 0.5 + 0.5 * ly / lz / tv, rf: P.optic.rr / lz / tv, fwd: gF, up: gU };
    }
    this.out.light = P.lightPt && wi && wi.lightOn && wi.att.light ? toW(P.lightPt) : null;
    this.out.laser = P.laserPt && wi && wi.lightOn && wi.att.laser ? toW(P.laserPt) : null;
    // 盾: 画面の左下。ADSでは下げて、拳銃の照準の邪魔にならないように
    this.shieldOn = shieldUp;
    let shieldHand = null;
    if (shieldUp) {
      const sx = lerp(-0.3, -0.35, ads) + Math.sin(ph) * 0.006 * amp - this.sway[0] * 0.03, sy = lerp(-0.4, -0.53, ads) - Math.abs(Math.cos(ph)) * 0.01 * amp - 0.3 * this.drawK - 0.2 * this.actK - this.sway[1] * 0.02, sz = lerp(0.56, 0.54, ads);
      const sc = camP(sx, sy, sz);
      // 少し右へ向けて、体の前を覆う
      const yawS = 0.12, cs = Math.cos(yawS), sn = Math.sin(yawS);
      const f2 = [F[0] * cs - R[0] * sn, F[1] * cs - R[1] * sn, F[2] * cs - R[2] * sn];
      const l2 = [-(R[0] * cs + F[0] * sn), -(R[1] * cs + F[1] * sn), -(R[2] * cs + F[2] * sn)];
      const S2 = this.Ms;
      S2[0] = l2[0]; S2[1] = l2[1]; S2[2] = l2[2]; S2[3] = 0; S2[4] = U[0]; S2[5] = U[1]; S2[6] = U[2]; S2[7] = 0;
      S2[8] = f2[0]; S2[9] = f2[1]; S2[10] = f2[2]; S2[11] = 0; S2[12] = sc[0]; S2[13] = sc[1]; S2[14] = sc[2]; S2[15] = 1;
      shieldHand = camP(sx + 0.01, sy - 0.02, sz - 0.07);
    }
    // 腕: 肩（カメラ空間）→ 手
    const shR = camP(0.17, -0.25, -0.08), shL = camP(-0.17, -0.24, -0.05);
    let hR, hL, handUp = null;
    if (nade) {
      const th = clamp(a.throwT || 0, 0, 1);
      // 11-19 23:27: 投げ物を持っている時も、銃と同じ歩き・走り・呼吸・見回しの揺れを手に（前は手が画面に貼りついて動かず、安っぽかった）。
      //  走ると少し下げ、持ち替えの間は下から上がる。向きも揺れで傾ける（gR・gU・gF）
      const bx = Math.sin(ph) * 0.007 * amp - this.sway[0] * 0.05;
      const by = -Math.abs(Math.cos(ph)) * 0.011 * amp + Math.sin(this.t * 1.7) * 0.0022 - this.sway[1] * 0.04 - 0.05 * this.sprK - 0.25 * this.drawK;
      // 11-20: 手に持つ物の向きは、銃の向き（腰だめのひねり・走りで銃を大きく横へ倒す）を使わず、カメラの向きに揺れだけ足す
      //  （前は箱や双眼鏡も、走ると銃と同じに 55° 横を向いた）
      let qR = R, qU = U, qF = F;
      const rq = (ax, ang) => { qR = rot(qR, ax, ang); qU = rot(qU, ax, ang); qF = rot(qF, ax, ang); };
      rq(U, this.sway[0] * 0.6 + 0.3 * this.sprK);
      rq(qR, this.sway[1] * 0.6 + Math.sin(this.t * 1.25) * 0.004 - 0.35 * this.sprK - 0.9 * this.drawK);
      rq(qF, -(Math.sin(ph) * 0.014 * amp + 0.12 * this.sprK));
      gR = qR; gU = qU; gF = qF;
      const kind = GEAR[ws.gear].kind;
      const side = (c, s, d, dn, bk) => [c[0] + qR[0] * s * d - qU[0] * dn - qF[0] * bk, c[1] + qR[1] * s * d - qU[1] * dn - qF[1] * bk, c[2] + qR[2] * s * d - qU[2] * dn - qF[2] * bk];
      let mAt;
      if (kind === 'ammo' || kind === 'medkit') {
        // 弾薬箱・医療キット: 両手で体の前に抱える。弾薬箱は手のひらを上へ向けて底の左右を持つ（指は前の縁）、医療キットは小さいので
        //  左右から手のひらで挟む（前の札が見えるように）。医療キットは使っている間（引き金）、仲間へは
        //  前へ差し出して小さく押し、自分へは胸へ引き寄せる。置いた直後（持ち替え）は下から上がる
        const hw = kind === 'medkit' ? 0.05 : (ws.gear === 'ammobig' ? 0.8 : 0.62) * 0.09;
        this.healK = lerp(this.healK || 0, kind === 'medkit' && (ws.healT || 0) > 0 ? 1 : 0, 1 - Math.exp(-dt * 10));
        const pump = this.healK * Math.sin(this.t * 9) * 0.008;
        const fwd = ws.healSelf ? -0.05 : 0.07;
        mAt = camP(0.04 + bx, (kind === 'medkit' ? -0.118 : -0.13) + by + (ws.healSelf ? -0.03 : 0.03) * this.healK, (kind === 'medkit' ? 0.36 : 0.38) + fwd * this.healK + pump);
        if (kind === 'medkit') {
          hR = side(mAt, 1, hw + 0.008, 0.045, -0.005); hL = side(mAt, -1, hw + 0.008, 0.045, -0.005);
          handUp = [qR, [-qR[0], -qR[1], -qR[2]]];
        } else {
          const bot = (ws.gear === 'ammobig' ? 0.8 : 0.62) * 0.06 + 0.014;
          hR = side(mAt, 1, hw * 0.6, bot, 0.035); hL = side(mAt, -1, hw * 0.6, bot, 0.035);
          const dn = [-qU[0], -qU[1], -qU[2]];
          handUp = [dn, dn];
        }
      } else if (kind === 'binoc') {
        // 双眼鏡: 両手で2本の筒を外から持ち、胸の高さ。構えると目の前へ上げる（0.9 で手と双眼鏡は消え、のぞき窓だけ）
        const k = sm(clamp(a.ads / 0.9, 0, 1));
        mAt = camP(lerp(0.03 + bx, 0, k), lerp(-0.115 + by, -0.006, k), lerp(0.32, 0.12, k));
        //  上げる途中は手を下の外へ逃がす（目の前で手が画面をふさがないように）
        hR = side(mAt, 1, 0.06 + 0.04 * k, 0.055 + 0.11 * k, 0.04); hL = side(mAt, -1, 0.06 + 0.04 * k, 0.055 + 0.11 * k, 0.04);
        handUp = [qR, [-qR[0], -qR[1], -qR[2]]];
      } else if (kind === 'hammer') {
        // 大ハンマー: 両手で柄の下を持ち、頭は右の上・少し前（斜めに構える）。振る（ws.swing 0〜0.9 秒）:
        //  右の肩の上へ振りかぶる（〜0.25）→ 前の下へ振り下ろす（〜0.42 で当たる）→ 戻す
        const sw = ws.swing != null ? ws.swing : -1;
        const KF = [[0, [0.12, -0.15, 0.45], [0.55, 0.55, 0.35]], [0.25, [0.3, -0.1, 0.15], [0.4, 0.7, -0.55]], [0.42, [0.03, -0.2, 0.5], [-0.05, -0.35, 1.0]], [0.9, [0.12, -0.15, 0.45], [0.55, 0.55, 0.35]]];
        let pos = KF[0][1], dir = KF[0][2];
        if (sw >= 0) for (let i = 0; i < KF.length - 1; i++) { const [t0, p0, d0] = KF[i], [t1, p1, d1] = KF[i + 1]; if (sw >= t0 && sw <= t1) { const u = sm((sw - t0) / (t1 - t0)); pos = lerpV(p0, p1, u); dir = lerpV(d0, d1, u); break; } }
        const hu = norm3([qR[0] * dir[0] + qU[0] * dir[1] + qF[0] * dir[2], qR[1] * dir[0] + qU[1] * dir[1] + qF[1] * dir[2], qR[2] * dir[0] + qU[2] * dir[1] + qF[2] * dir[2]]);
        let hx = norm3([hu[1] * qF[2] - hu[2] * qF[1], hu[2] * qF[0] - hu[0] * qF[2], hu[0] * qF[1] - hu[1] * qF[0]]);
        if (!isFinite(hx[0])) hx = qR;
        const hz = [hx[1] * hu[2] - hx[2] * hu[1], hx[2] * hu[0] - hx[0] * hu[2], hx[0] * hu[1] - hx[1] * hu[0]];
        mAt = camP(pos[0] + bx, pos[1] + by, pos[2]);
        const along = (d) => [mAt[0] + hu[0] * d, mAt[1] + hu[1] * d, mAt[2] + hu[2] * d];
        hR = along(-0.26); hL = along(-0.02);
        this.nadeM = this.Mm;
        this.Mm.set([hx[0], hx[1], hx[2], 0, hu[0], hu[1], hu[2], 0, hz[0], hz[1], hz[2], 0, mAt[0], mAt[1], mAt[2], 1]);
      } else {
        // 投げ物（11-20）: 右手で胸の高さ・体の右前に持ち、左手はピンの輪へ指を掛ける位置（前は顔の近くで大きく見えすぎた）
        //  右手は投げ物の右から指を回して握る（手のひらを内へ。前は手のひらが下を向いて投げ物の下に隠れていた）
        mAt = camP(0.13 + th * 0.05 + bx, -0.122 + th * 0.14 + by, 0.35 + th * 0.16);
        hR = side(mAt, 1, 0.045, 0.024, 0.006); hL = camP(0.03 + bx * 0.8, -0.197 + by * 0.9, 0.335);
        handUp = [qR, null];
      }
      if (kind !== 'hammer') { this.nadeM = this.Mm; this.Mm.set([-qR[0], -qR[1], -qR[2], 0, qU[0], qU[1], qU[2], 0, qF[0], qF[1], qF[2], 0, mAt[0], mAt[1], mAt[2], 1]); }
    } else {
      // 拳銃（11-20）: 手首を握りの後ろへ（手の箱は手首から前へ伸びるので、前は手が握りの前の引き金の下に浮いていた）。
      //  右手は手のひらが握りの背に当たり指が前へ回る。左手は右手の左下から包む（右手の指の上に左の指）
      const GR = pistol ? [P.gripR[0] - 0.004, P.gripR[1] - 0.004, P.gripR[2] - 0.03] : P.gripR;
      const GL = pistol ? [P.gripL[0] + 0.022, P.gripL[1] - 0.014, P.gripL[2] - 0.024] : P.gripL;
      hR = toW(GR);
      hL = toW(GL);
      // 手の甲の向き（11-20）: 前は両手とも甲が真上（手のひらが下）で、握りの上に平たい箱が載ったように見えた。
      //  右手は握り（縦の柄）を横から包む（甲は右・少し上）。左手: 拳銃は右手の指の上から包む（甲は左下・親指は前へ）、
      //  縦のグリップは右手と同じに縦に握る、ほかは前の筒を左下から支える（甲は左下・指は右の側へ回る）
      if (!P.rocket && !P.heavy) {
        const mix = (a, ka, b, kb, c, kc) => norm3([a[0] * ka + b[0] * kb + c[0] * kc, a[1] * ka + b[1] * kb + c[1] * kc, a[2] * ka + b[2] * kb + c[2] * kc]);
        const bR = mix(gR, 0.9, gU, 0.42, gF, 0);
        let bL = pistol ? mix(gR, -0.82, gU, -0.5, gF, 0.08) : P.vgrip ? mix(gR, -0.92, gU, 0.2, gF, 0) : mix(gR, -0.55, gU, -0.84, gF, 0);
        // リロードで弾倉を持つ間の左手は、手のひらを上へ（下から差し込む。甲は下）
        const rk = rel >= 0 && !P.tube ? (rel < 0.12 ? sm(rel / 0.12) : rel < 0.75 ? 1 : 1 - sm((rel - 0.75) / 0.2)) : 0;
        if (rk > 0) { const dn = mix(gR, -0.3, gU, -0.95, gF, 0); bL = norm3([bL[0] + (dn[0] - bL[0]) * rk, bL[1] + (dn[1] - bL[1]) * rk, bL[2] + (dn[2] - bL[2]) * rk]); }
        handUp = [bR, bL];
      }
      if (rel >= 0 && P.rocket) {
        // 左手: 前の握り → ポーチ（左下）→ 弾頭を持って筒の先へ → 押し込む → 前の握りへ
        const pouch = camP(-0.14, -0.4, 0.16), tip = toW([P.rocketX || 0, -0.01, 0.6 + pumpOff]);
        if (rel < 0.18) hL = lerpV(hL, pouch, sm(rel / 0.18));
        else if (rel < 0.32) hL = pouch;
        else if (rel < 0.55) hL = lerpV(pouch, tip, sm((rel - 0.32) / 0.23));
        else if (rel < 0.85) hL = tip;
        else hL = lerpV(tip, toW(GL), sm((rel - 0.85) / 0.15));
      } else if (rel >= 0 && !P.tube) {
        const well = toW(P.magWell || [0, -0.08, 0.04]);
        const pouch = camP(-0.12, -0.42, 0.18);
        const mag2 = [well[0] + gU[0] * magOff, well[1] + gU[1] * magOff, well[2] + gU[2] * magOff];
        if (rel < 0.12) hL = lerpV(hL, well, sm(rel / 0.12));
        else if (rel < 0.35) hL = mag2;
        else if (rel < 0.58) hL = lerpV(mag2, pouch, sm((rel - 0.35) / 0.1) - sm((rel - 0.48) / 0.1));
        else if (rel < 0.75) hL = mag2;
        else hL = lerpV(well, toW(GL), sm((rel - 0.75) / 0.2));
        if (pistol) hR = toW(GR);
      } else if (rel >= 0 && P.tube) {
        const port = toW(P.magWell || [0, -0.04, 0.05]);
        const below = [port[0] - gU[0] * 0.12, port[1] - gU[1] * 0.12, port[2] - gU[2] * 0.12];
        hL = lerpV(below, port, bell(1 - rel));
      }
      if (pumpOff && !P.bolt && !P.rocket) hL = [hL[0] + gF[0] * pumpOff, hL[1] + gF[1] * pumpOff, hL[2] + gF[2] * pumpOff];
      // ボルト: 右手は槓桿の丸い握り（回して引いた位置）
      if (boltHand > 0 && P.boltPt) {
        const c = Math.cos(pumpRot), sn = Math.sin(pumpRot), b = P.boltPt;
        hR = lerpV(hR, toW([b[0] * c - b[1] * sn, b[0] * sn + b[1] * c, b[2] + pumpOff]), boltHand);
      }
      if (this.sprK > 0.5 && pistol) hL = camP(-0.15, -0.35, 0.2);
      if (shieldHand) hL = shieldHand;
    }
    // ---- 動作の手（三人称の姿勢と同じ動き）。手を当てる所（世界の点）があれば、手はそこへ（腕の長さまで）
    let tool = null;
    const reachK = ap === 'cuff' ? sm((actT - 0.04) / 0.16) * (1 - sm((actT - 0.9) / 0.1)) : sm(actT / 0.16) * (1 - sm((actT - 0.93) / 0.07));
    const wob = (f, o) => Math.sin(this.t * f + o) * 0.01;
    const tgtW = a.act && a.act.tgt ? a.act.tgt : null;
    const at = (b, rx, uy, fz) => [b[0] + R[0] * rx + U[0] * uy + F[0] * fz, b[1] + R[1] * rx + U[1] * uy + F[1] * fz, b[2] + R[2] * rx + U[2] * uy + F[2] * fz];
    if (this.freeK > 0.01 && ap) {
      let tL = hL, tR = hR;
      if (ap === 'cuff') {
        // 相手の手首を左手で押さえ、右手で結束バンドを回して締める
        const base = tgtW || camP(0, -0.15, 0.42);
        const tie = clamp((actT - 0.62) / 0.2, 0, 1), loop = Math.sin(Math.PI * tie), ang = tie * Math.PI * 2;
        const pull = bell((actT - 0.82) / 0.1) * 0.07;
        tL = at(base, -0.06 - pull, 0.02 + wob(9, 0) * 0.5, -0.02);
        tR = at(base, 0.05 + pull - Math.cos(ang) * 0.05 * loop, Math.sin(ang) * 0.06 * loop - 0.005, -0.03 - 0.04 * loop);
        if (actT > 0.45 && actT < 0.97) tool = { k: 'zip', a: actT < 0.82 ? tR : lerpV(tL, tR, 0.5), b: actT < 0.82 ? at(base, 0, 0, 0) : lerpV(tL, tR, 0.5), on: actT >= 0.82, c: base, f: F, u: U, r: R };
      } else if (ap === 'kneel' || ap === 'peek') {
        const base = tgtW && ap !== 'peek' ? tgtW : camP(0, -0.15, 0.44);
        const k = a.act.k, lockK = k === 'pick' || k === 'lockgun';
        if (lockK) {
          // ピッキング: 左手のテンションレンチで鍵穴の下を押さえ、右手のピックを細かく動かす
          tL = at(base, -0.085, -0.04, -0.075); tR = at(base, 0.075 + wob(23, 1) * 0.6, -0.005 + wob(29, 0) * 0.8, -0.07);
        } else { tL = at(base, -0.075, wob(13, 0), -0.05); tR = at(base, 0.045, 0.015 + wob(17, 2), -0.04); }
        tool = { k: lockK ? 'pick' : k === 'wedge' || k === 'unwedge' ? 'wedge' : k === 'mirror' ? 'mirror' : k === 'revive' ? null : k === 'plant' ? 'box' : 'tool', at: tR, l: tL, c: base, f: F, u: U, r: R };
      } else if (ap === 'grab') {
        // 右手で拾って胸へ（左手はひざ）
        const up1 = sm((actT - 0.5) / 0.4);
        const base = tgtW || camP(0.03, -0.16, 0.46);
        tR = lerpV(at(base, 0, 0.03, -0.03), camP(0.1, -0.12, 0.33), up1); tL = camP(-0.16, -0.3, 0.3);
        if (up1 > 0.05) tool = { k: 'item', at: tR, f: F, u: U, r: R };
      } else if (ap === 'place') {
        const push = actT > 0.72 ? Math.sin(Math.PI * clamp((actT - 0.72) / 0.22, 0, 1)) * 0.04 : 0;
        const base = tgtW || camP(0, -0.09, 0.5);
        tL = at(base, -0.12, 0, -0.04 + push); tR = at(base, 0.12, 0, -0.04 + push);
        tool = { k: a.act.k === 'c2' ? 'c2' : a.act.k === 'frame' ? 'frame' : 'panel', a: tL, b: tR, f: F, u: U, r: R };
      } else if (ap === 'bandage') {
        const ang = actT * Math.PI * 8;
        tL = camP(-0.05, -0.16, 0.36); tR = camP(-0.01 + Math.cos(ang) * 0.04, -0.15 + Math.sin(ang) * 0.04, 0.38);
        tool = { k: 'bandage', at: tL, f: F, u: U, r: R };
      }
      const kk = this.freeK * (ap === 'peek' ? 1 : reachK);
      hL = lerpV(hL, tL, kk); hR = lerpV(hR, tR, kk);
      if (this.freeK > 0.9) this.gm = null; // 銃は吊った（画面の外）
    }
    if (ap === 'radio') { const r = sm(actT / 0.2) * (1 - sm((actT - 0.85) / 0.15)); hL = lerpV(hL, camP(-0.17, -0.15, 0.22), r); }
    // 蹴る: ひざを上げ、かかとから扉へ（当たる瞬間に画面の下へブーツが入る）
    if (ap === 'kick') { const e = Math.sin(Math.PI * clamp((actT - 0.3) / 0.38, 0, 1)); tool = { k: 'boot', at: camP(0.08, -0.6 + 0.38 * e, 0.4 + 0.36 * e), f: F, u: U, r: R }; }
    // ノブへ左手を伸ばす → 扉を押す・引く
    if (ap === 'knob') { const g = sm(actT / 0.8); hL = lerpV(hL, tgtW ? at(tgtW, 0, 0, -0.02) : camP(-0.07, -0.07, 0.58), g); }
    if (a.gest && a.gest.k === 'push') { const g = Math.sin(Math.PI * clamp(a.gest.t / a.gest.dur, 0, 1)); hL = lerpV(hL, a.gest.tgt ? at(a.gest.tgt, 0, 0, -0.02) : camP(-0.07, -0.07, 0.58), g); }
    if (a.gest && a.gest.k === 'grab') { const g = Math.sin(Math.PI * clamp(a.gest.t / a.gest.dur, 0, 1)); hL = lerpV(hL, a.gest.tgt ? at(a.gest.tgt, 0, 0.03, -0.03) : camP(-0.04, -0.45, 0.5), g); }
    // 腕の長さまで（肩から 0.6m。ひざをついて前へかがむ動作は体ごと伸ばすので少し長く）
    const armMax = ap === 'kneel' || ap === 'grab' || ap === 'place' ? 0.68 : 0.585;
    const clampArm = (sh, h) => { const d = [h[0] - sh[0], h[1] - sh[1], h[2] - sh[2]], l = Math.hypot(d[0], d[1], d[2]), mx = armMax; return l > mx ? [sh[0] + d[0] * mx / l, sh[1] + d[1] * mx / l, sh[2] + d[2] * mx / l] : h; };
    hL = clampArm(shL, hL); if (!this.gm || this.freeK > 0.5) hR = clampArm(shR, hR);
    this._arms(shR, hR, shL, hL, gF, gU, R, U, tool, this.freeK > 0.5 ? null : handUp);
  }

  // handUp: 手の甲の向き（右・左）。箱や双眼鏡を横から持つ時は、手のひらを内へ向ける
  _arms(shR, hR, shL, hL, gF, gU, R, U, tool, handUp) {
    const B = new MeshBuilder();
    // 動作の道具（結束バンド・ピック・ウェッジ・C2・包帯・ブーツ…）
    if (tool) {
      const tb = (c, r, u, f, hx, hy, hz, col, layer = LAYER.plain) => { B.xf = [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2], c[0], c[1], c[2]]; B.box(-hx, -hy, -hz, hx, hy, hz, layer, col); B.xf = null; };
      const t = tool;
      if (t.k === 'zip') {
        // 結束バンド: 右手から相手の手首へ回す帯。締めたら手首の2つの輪と、まん中の留め具
        const W = hex('#eceae2');
        if (!t.on) { B.tube(t.a, t.b, 0.005, 0.005, 5, LAYER.plain, W); B.tube(t.a, [t.a[0] - t.u[0] * 0.04, t.a[1] - t.u[1] * 0.04, t.a[2] - t.u[2] * 0.04], 0.005, 0.005, 5, LAYER.plain, W); }
        else {
          const c = t.c, r = t.r, u = t.u;
          for (const sx of [-0.045, 0.045]) {
            const cc = [c[0] + r[0] * sx, c[1] + r[1] * sx, c[2] + r[2] * sx];
            for (let q = 0; q < 6; q++) { const a0 = q / 6 * Math.PI * 2, a1 = (q + 1) / 6 * Math.PI * 2; const p = (a) => [cc[0] + u[0] * Math.cos(a) * 0.035 + t.f[0] * Math.sin(a) * 0.035, cc[1] + u[1] * Math.cos(a) * 0.035 + t.f[1] * Math.sin(a) * 0.035, cc[2] + u[2] * Math.cos(a) * 0.035 + t.f[2] * Math.sin(a) * 0.035]; B.tube(p(a0), p(a1), 0.006, 0.006, 4, LAYER.plain, W); }
          }
          B.tube([c[0] - r[0] * 0.045, c[1] - r[1] * 0.045, c[2] - r[2] * 0.045], [c[0] + r[0] * 0.045, c[1] + r[1] * 0.045, c[2] + r[2] * 0.045], 0.007, 0.007, 5, LAYER.plain, hex('#d8d6cc'));
        }
      } else if (t.at) {
        const c = t.at, f = t.f, u = t.u, r = t.r;
        const fw = (d) => [c[0] + f[0] * d, c[1] + f[1] * d, c[2] + f[2] * d];
        if (t.k === 'pick') {
          // ピック（右手 → 鍵穴）とテンションレンチ（左手 → 鍵穴の下）
          const kh = t.c, kl = [kh[0] - u[0] * 0.012, kh[1] - u[1] * 0.012, kh[2] - u[2] * 0.012];
          B.tube(c, kh, 0.0035, 0.0025, 4, LAYER.metal, hex('#c8ccd0'));
          if (t.l) B.tube(t.l, kl, 0.004, 0.004, 4, LAYER.metal, hex('#9aa0a6'));
          tb(fw(0.0), r, u, f, 0.008, 0.012, 0.03, hex('#2a2c30'));
        }
        else if (t.k === 'wedge') tb(fw(0.05), r, u, f, 0.025, 0.012, 0.05, hex('#3a3c40'), LAYER.rubber);
        else if (t.k === 'mirror') { B.tube(fw(0.0), fw(0.2), 0.006, 0.006, 6, LAYER.metal, hex('#5a5e64')); tb(fw(0.22), r, u, f, 0.03, 0.022, 0.004, hex('#b8c8d2'), LAYER.metal); }
        else if (t.k === 'tool') { tb(fw(0.04), r, u, f, 0.03, 0.015, 0.045, hex('#2f3236')); B.emit = 1.2; tb(fw(0.06), r, u, f, 0.006, 0.017, 0.006, hex('#40ff70')); B.emit = 0; }
        else if (t.k === 'box') { tb(fw(0.05), r, u, f, 0.06, 0.03, 0.05, hex('#3b4048')); B.emit = 1.5; tb(fw(0.05), r, [u[0], u[1], u[2]], f, 0.01, 0.032, 0.01, hex('#ff3a2e')); B.emit = 0; }
        else if (t.k === 'item') tb(fw(0.02), r, u, f, 0.04, 0.025, 0.06, hex('#3a3328'));
        else if (t.k === 'bandage') B.cyl(c[0], c[2], c[1] - 0.03, c[1] + 0.03, 0.03, 0.03, 8, LAYER.fabric, hex('#efece4'));
        else if (t.k === 'boot') { const leg = [c[0] - u[0] * 0.25 - f[0] * 0.1, c[1] - u[1] * 0.25 - f[1] * 0.1, c[2] - u[2] * 0.25 - f[2] * 0.1]; B.tube(leg, c, 0.06, 0.055, 8, LAYER.cloth, this.sleeve); tb(fw(0.06), r, u, f, 0.05, 0.05, 0.12, hex('#1a1b1d'), LAYER.rubber); }
      }
      if ((t.k === 'c2' || t.k === 'frame' || t.k === 'panel') && t.a) {
        const m = lerpV(t.a, t.b, 0.5), f = t.f, u = t.u, r = t.r;
        const c = [m[0] + f[0] * 0.04, m[1] + f[1] * 0.04, m[2] + f[2] * 0.04];
        if (t.k === 'c2') { tb(c, r, u, f, 0.07, 0.035, 0.03, hex('#8a8c7c')); B.emit = 1.2; tb([c[0] + f[0] * 0.031, c[1] + f[1] * 0.031, c[2] + f[2] * 0.031], r, u, f, 0.008, 0.008, 0.002, hex('#ff3a2e')); B.emit = 0; }
        else if (t.k === 'frame') tb(c, r, u, f, 0.2, 0.012, 0.03, hex('#6a6c5c'));
        else tb(c, r, u, f, 0.22, 0.16, 0.012, hex('#5d6066'), LAYER.metal);
      }
    }
    const down = [-U[0], -U[1], -U[2]];
    const poleR = [R[0] * 0.6 + down[0], R[1] * 0.6 + down[1], R[2] * 0.6 + down[2]];
    const poleL = [-R[0] * 0.6 + down[0], -R[1] * 0.6 + down[1], -R[2] * 0.6 + down[2]];
    const eR = ik2(shR, hR, 0.3, 0.29, poleR), eL = ik2(shL, hL, 0.3, 0.29, poleL);
    const gloveD = [this.glove[0] * 0.75, this.glove[1] * 0.75, this.glove[2] * 0.75];
    const sleeveD = [this.sleeve[0] * 0.8, this.sleeve[1] * 0.8, this.sleeve[2] * 0.8];
    // 手の向きの箱（中心 c、軸 r u f、半分の長さ）
    const hbox = (c, r, u, f, hx, hy, hz, col, rad) => { B.xf = [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2], c[0], c[1], c[2]]; B.bbox(-hx, -hy, -hz, hx, hy, hz, rad, LAYER.rubber, col); B.xf = null; };
    let side = 1;
    for (const [sh, el, hd, hu] of [[shR, eR, hR, handUp && handUp[0]], [shL, eL, hL, handUp && handUp[1]]]) {
      B.tube(sh, el, 0.052, 0.046, 9, LAYER.cloth, this.sleeve);
      // 肘のしわ（少し太い輪）
      B.tube(lerpV(sh, el, 0.9), lerpV(el, hd, 0.06), 0.05, 0.049, 9, LAYER.cloth, sleeveD);
      // 手首の少し手前までが袖、先は手袋（袖口は濃い色）
      const wr = lerpV(el, hd, 0.84);
      B.tube(el, wr, 0.046, 0.038, 9, LAYER.cloth, this.sleeve);
      B.tube(lerpV(el, hd, 0.8), wr, 0.041, 0.04, 9, LAYER.cloth, sleeveD, { caps: true });
      B.tube(wr, hd, 0.032, 0.03, 8, LAYER.rubber, this.glove);
      // 手: 手のひら（平たい箱）・握った指（下へ巻く）・親指（銃の横へ）。手袋の縫い目の濃い帯
      const f = norm3([hd[0] - el[0], hd[1] - el[1], hd[2] - el[2]]);
      const uu = hu || gU;
      let r = norm3([uu[1] * f[2] - uu[2] * f[1], uu[2] * f[0] - uu[0] * f[2], uu[0] * f[1] - uu[1] * f[0]]);
      const u = norm3([f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]);
      const at = (a, b, c) => [hd[0] + f[0] * a + u[0] * b + r[0] * c, hd[1] + f[1] * a + u[1] * b + r[1] * c, hd[2] + f[2] * a + u[2] * b + r[2] * c];
      hbox(at(0.035, 0, 0), r, u, f, 0.04, 0.022, 0.042, this.glove, 0.012);
      hbox(at(0.07, -0.022, 0), r, u, f, 0.038, 0.026, 0.02, gloveD, 0.011);
      hbox(at(0.008, 0.004, 0), r, u, f, 0.037, 0.024, 0.008, gloveD, 0.006);
      B.tube(at(0.02, 0.01, -0.034 * side), at(0.07, 0.006, -0.03 * side), 0.012, 0.01, 6, LAYER.rubber, this.glove, { caps: true });
      side = -1;
    }
    const { v, i } = B.arrays();
    const gl = this.gl;
    if (!this.armVB) {
      this.armVAO = gl.createVertexArray(); gl.bindVertexArray(this.armVAO);
      this.armVB = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.armVB); gl.bufferData(gl.ARRAY_BUFFER, 64 * 1024, gl.DYNAMIC_DRAW);
      const st = WV * 4, at = (l, n, o) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, st, o * 4); };
      at(0, 3, 0); at(1, 3, 3); at(2, 2, 6); at(3, 1, 8); at(4, 3, 9); at(5, 1, 12); at(6, 1, 13); at(7, 1, 14);
      this.armIB = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.armIB); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 16 * 1024, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.armVB); gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.armIB); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array(i));
    this.armN = i.length;
  }

  draw(f) {
    if (!this.on || f.hideVM || this.scoped) return;
    const r = this.r, gl = this.gl, P = r.P.world;
    r._bindLight(P, f);
    gl.uniformMatrix4fv(P.u.uVP, false, r.vmVP);
    if (P.u.uVM) gl.uniform1f(P.u.uVM, 1);
    if (f.vm && f.vm.room != null) gl.uniform1f(P.u.uRoomOverride, f.vm.room);
    // 銃
    if (this.gm) {
      gl.uniformMatrix4fv(P.u.uModel, false, this.M);
      drawMesh(gl, this.gm.body);
      if (this.gm.mag && !this.magHide) {
        const M2 = this.Mm, M = this.M;
        M2.set(M);
        M2[12] += M[4] * this.magOff; M2[13] += M[5] * this.magOff; M2[14] += M[6] * this.magOff;
        gl.uniformMatrix4fv(P.u.uModel, false, M2);
        drawMesh(gl, this.gm.mag);
      }
      if (this.gm.pump && !this.pumpHide) {
        const M2 = this.Mm, M = this.M;
        M2.set(M);
        // ボルトは銃身の軸（ローカルの Z）のまわりに回す
        if (this.pumpRot) { const c = Math.cos(this.pumpRot), sn = Math.sin(this.pumpRot); for (let i = 0; i < 3; i++) { const x = M[i], y = M[4 + i]; M2[i] = c * x + sn * y; M2[4 + i] = -sn * x + c * y; } }
        M2[12] += M[8] * this.pumpOff; M2[13] += M[9] * this.pumpOff; M2[14] += M[10] * this.pumpOff;
        gl.uniformMatrix4fv(P.u.uModel, false, M2);
        drawMesh(gl, this.gm.pump);
      }
      // バイポッドの脚（11-27 16:35）: 立てると留め金のまわりで下へ開く（0.2 秒ほど）
      if (this.gm.legs) {
        gl.uniformMatrix4fv(P.u.uModel, false, bipodMatrix(this.M, this.Mm, sm(this.bipK || 0), this.gm.g.pts.bipPivot));
        drawMesh(gl, this.gm.legs);
      }
      // ブースターの倒し: 左の蝶番（flipPivot）のまわりに、上から左へ 90°
      if (this.gm.flip) {
        const M2 = this.Mm, M = this.M, th = -Math.PI / 2 * sm(this.flipK || 0), c = Math.cos(th), sn = Math.sin(th), pv = this.flipP || [0, 0];
        M2.set(M);
        for (let i = 0; i < 3; i++) { const x = M[i], y = M[4 + i]; M2[i] = c * x + sn * y; M2[4 + i] = -sn * x + c * y; }
        const tx = pv[0] - (pv[0] * c - pv[1] * sn), ty = pv[1] - (pv[0] * sn + pv[1] * c);
        M2[12] += M[0] * tx + M[4] * ty; M2[13] += M[1] * tx + M[5] * ty; M2[14] += M[2] * tx + M[6] * ty;
        gl.uniformMatrix4fv(P.u.uModel, false, M2);
        drawMesh(gl, this.gm.flip);
      }
    } else if (this.nade) {
      gl.uniformMatrix4fv(P.u.uModel, false, this.Mm);
      drawMesh(gl, this.nadeMesh(this.nade));
    }
    // 盾
    if (this.shieldOn) {
      const sm = this.av.shieldMesh();
      gl.uniformMatrix4fv(P.u.uModel, false, this.Ms);
      drawMesh(gl, sm.body);
    }
    // 腕
    if (this.armN) {
      gl.uniformMatrix4fv(P.u.uModel, false, r.ident);
      gl.bindVertexArray(this.armVAO);
      gl.drawElements(gl.TRIANGLES, this.armN, gl.UNSIGNED_SHORT, 0);
    }
    gl.uniform1f(P.u.uRoomOverride, -1);
    if (P.u.uVM) gl.uniform1f(P.u.uVM, 0);
    gl.uniformMatrix4fv(P.u.uModel, false, r.ident);
  }
}
function lerpV(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
