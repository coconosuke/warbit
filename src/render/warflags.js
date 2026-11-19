// 大規模戦の拠点の旗: 竿と、持ち主の色の布（奪い合いの進み具合で上下する。Battlefield の旗と同じ見せ方）。地面に範囲の輪
// 色は見る人から見て 味方 青・敵 赤・中立 白（BattleBit の Ally / Enemy / Neutral Objective。research/WARBIT.md の 10）
import { MeshBuilder, hex } from './build.js';
import { LAYER } from './textures.js';
import { makeWorldMesh, drawMesh } from './renderer.js';
import { TC } from '../ui/teamcol.js';

const POLE_H = 9;
export const FLAG_COL = { [-1]: [0.85, 0.85, 0.82], 0: [0.18, 0.42, 0.95], 1: [0.92, 0.22, 0.16] };
// 味方・敵の色の設定（teamcol.js）が既定と違えば、旗の布の色もそれに（画面の色 → 布の色: だいたい 2.2 乗）
const FLAG_DEF = { 0: FLAG_COL[0].slice(), 1: FLAG_COL[1].slice() };
function syncFlagCols() {
  const c = (h) => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2) * 0.95);
  FLAG_COL[0] = TC.ally === '#4aa8ff' ? FLAG_DEF[0] : c(TC.ally);
  FLAG_COL[1] = TC.enemy === '#ff4b3e' ? FLAG_DEF[1] : c(TC.enemy);
}
const rel = (o, my) => o < 0 ? -1 : o === my ? 0 : 1;

export class WarFlags {
  constructor(r) {
    this.r = r; this.gl = r.gl;
    const P = new MeshBuilder();
    P.cyl(0, 0, -0.2, POLE_H, 0.07, 0.05, 8, LAYER.metal, hex('#b9bcbf'), { capT: true });
    P.cyl(0, 0, POLE_H, POLE_H + 0.18, 0.12, 0.0, 8, LAYER.metal, hex('#d0d2d4'), { capT: false });
    // 根もとのコンクリートの台
    P.box(-0.45, -0.3, -0.45, 0.45, 0.18, 0.45, LAYER.concrete, hex('#8f8d88'));
    this.pole = makeWorldMesh(this.gl, P);
    // 布（白。色はシェーダーの uTint）: 少し波打つ4枚
    const C = new MeshBuilder();
    const w = 2.2, h = 1.35;
    for (let k = 0; k < 4; k++) {
      const x0 = 0.06 + w * k / 4, x1 = 0.06 + w * (k + 1) / 4, z0 = Math.sin(k * 1.3) * 0.12, z1 = Math.sin((k + 1) * 1.3) * 0.12;
      const n = [-(z1 - z0), 0, x1 - x0], l = Math.hypot(n[0], n[2]) || 1;
      C.quad([x0, -h, z0], [x1, -h, z1], [x1, 0, z1], [x0, 0, z0], [n[0] / l, 0, n[2] / l], [0, 0, 1, 0, 1, 1, 0, 1], LAYER.cloth, hex('#e8e8e4'));
      C.quad([x1, -h, z1], [x0, -h, z0], [x0, 0, z0], [x1, 0, z1], [-n[0] / l, 0, -n[2] / l], [0, 0, 1, 0, 1, 1, 0, 1], LAYER.cloth, hex('#e8e8e4'));
    }
    this.cloth = makeWorldMesh(this.gl, C);
    // 地面の輪（半径1の輪。拡大して使う）
    const R = new MeshBuilder();
    const seg = 48;
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, r0 = 0.985, r1 = 1.0;
      R.quad([Math.cos(a0) * r0, 0, Math.sin(a0) * r0], [Math.cos(a0) * r1, 0, Math.sin(a0) * r1], [Math.cos(a1) * r1, 0, Math.sin(a1) * r1], [Math.cos(a1) * r0, 0, Math.sin(a1) * r0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], LAYER.plain, [1, 1, 1]);
    }
    this.ring = makeWorldMesh(this.gl, R);
    // 集合地点の形（この作品の物: 低い箱・取っ手・短いアンテナ・上に小さな灯り）
    const Q = new MeshBuilder();
    Q.box(-0.3, 0, -0.2, 0.3, 0.42, 0.2, LAYER.metal, hex('#4a5236'));
    Q.box(-0.32, 0.42, -0.22, 0.32, 0.47, 0.22, LAYER.metal, hex('#3b4229'));
    Q.box(-0.12, 0.47, -0.03, 0.12, 0.52, 0.03, LAYER.rubber, hex('#1f2219'));
    Q.box(0.2, 0.1, -0.205, 0.27, 0.32, -0.2, LAYER.metal, hex('#2a2e22'));
    Q.cyl(0.22, 0.12, 0.47, 1.15, 0.012, 0.008, 6, LAYER.metal, hex('#1c1d1a'), { capT: true });
    this.rallyBody = makeWorldMesh(this.gl, Q);
    const Lm = new MeshBuilder();
    Lm.box(-0.05, 0.47, 0.06, 0.05, 0.55, 0.14, LAYER.metal, hex('#ffffff'));
    this.rallyLamp = makeWorldMesh(this.gl, Lm);
    // 落ちた弾倉（大規模戦）: 小さい黒い箱を横に寝かせる
    const Mg = new MeshBuilder();
    Mg.box(-0.018, 0, -0.06, 0.018, 0.028, 0.06, LAYER.metal, hex('#22241f'));
    Mg.box(-0.012, 0.028, -0.055, 0.012, 0.034, -0.035, LAYER.metal, hex('#3a3c36'));
    this.magMesh = makeWorldMesh(this.gl, Mg);
    // 弾薬箱（この作品の形: 緑の箱・ふたの帯・取っ手。小さいのは縮める）
    const Ab = new MeshBuilder();
    Ab.box(-0.26, 0, -0.16, 0.26, 0.3, 0.16, LAYER.metal, hex('#4b5a34'));
    Ab.box(-0.27, 0.3, -0.17, 0.27, 0.34, 0.17, LAYER.metal, hex('#3d4a2b'));
    Ab.box(-0.08, 0.34, -0.025, 0.08, 0.37, 0.025, LAYER.rubber, hex('#1e2118'));
    Ab.box(-0.265, 0.12, -0.05, -0.255, 0.2, 0.05, LAYER.metal, hex('#d8c9a0'));
    Ab.box(0.255, 0.12, -0.05, 0.265, 0.2, 0.05, LAYER.metal, hex('#d8c9a0'));
    this.ammoMesh = makeWorldMesh(this.gl, Ab);
    this.M = new Float32Array(16);
    this.flags = [];
    this.wind = 0;
    this._off = [r.hook('opaque', (rr, f) => this.draw(f))];
  }
  dispose() { for (const f of this._off) f(); this._off = []; }
  set(flags, ww, myTeam = 0) { this.flags = flags; this.ww = ww; this.my = myTeam; }
  draw(f) {
    this._drawRallies(f);
    if (!this.flags.length) return;
    syncFlagCols();
    const r = this.r, gl = this.gl, P = r.P.world, M = this.M;
    r._bindLight(P, f);
    gl.uniformMatrix4fv(P.u.uVP, false, r.vp);
    if (P.u.uRoomOverride) gl.uniform1f(P.u.uRoomOverride, 1);
    this.wind += f.dt || 0.016;
    for (const fl of this.flags) {
      const y = fl.y;
      if (Math.hypot(fl.x - r.camPos[0], fl.z - r.camPos[2]) > (r.viewDist || 900)) continue;
      M.fill(0); M[0] = M[5] = M[10] = M[15] = 1; M[12] = fl.x; M[13] = y; M[14] = fl.z;
      gl.uniformMatrix4fv(P.u.uModel, false, M);
      gl.uniform3f(P.u.uTint, 1, 1, 1);
      drawMesh(gl, this.pole);
      // 布: 高さは進み具合（持ち主の側に寄るほど上）。色は持ち主、中立なら進んでいる側の色を薄く
      // 見る人のチームから見た向き（味方の側へ進む = +）
      const pr = (fl.prog || 0) * (this.my === 1 ? -1 : 1), own = rel(fl.owner, this.my);
      const k = own >= 0 ? Math.abs(pr) : Math.abs(pr);
      const col = own >= 0 ? FLAG_COL[own] : pr > 0.02 ? mix(FLAG_COL[-1], FLAG_COL[0], 0.5) : pr < -0.02 ? mix(FLAG_COL[-1], FLAG_COL[1], 0.5) : FLAG_COL[-1];
      const yy = y + 1.6 + (POLE_H - 1.7) * (own >= 0 ? k : Math.max(0.15, k));
      const sw = Math.sin(this.wind * 1.7 + fl.x) * 0.35;
      const c = Math.cos(sw), s = Math.sin(sw);
      M[0] = c; M[2] = -s; M[8] = s; M[10] = c; M[12] = fl.x; M[13] = yy; M[14] = fl.z;
      gl.uniformMatrix4fv(P.u.uModel, false, M);
      gl.uniform3f(P.u.uTint, col[0], col[1], col[2]);
      gl.disable(gl.CULL_FACE);
      drawMesh(gl, this.cloth);
      gl.enable(gl.CULL_FACE);
      // 地面の輪（地形に沿わないので少し浮かせる）
      M.fill(0); M[0] = fl.r; M[5] = 1; M[10] = fl.r; M[15] = 1; M[12] = fl.x; M[13] = y + 0.25; M[14] = fl.z;
      gl.uniformMatrix4fv(P.u.uModel, false, M);
      const rc = own >= 0 ? FLAG_COL[own] : FLAG_COL[-1];
      gl.uniform3f(P.u.uTint, rc[0] * 0.8, rc[1] * 0.8, rc[2] * 0.8);
      drawMesh(gl, this.ring);
    }
    M.fill(0); M[0] = M[5] = M[10] = M[15] = 1;
    gl.uniformMatrix4fv(P.u.uModel, false, M);
    gl.uniform3f(P.u.uTint, 1, 1, 1);
    if (P.u.uRoomOverride) gl.uniform1f(P.u.uRoomOverride, -1);
  }
}
// 集合地点: 味方の物は緑の灯り（点滅）、敵の物は赤
WarFlags.prototype._drawRallies = function (f) {
  const D = this.S && this.S.mdrops;
  if (D && D.length) this._drawMags(f, D);
  const A = this.S && this.S.ammo;
  if (A && A.length) this._drawMags(f, A, true);
  const L = this.S && this.S.rallies;
  if (!L || !L.length) return;
  const r = this.r, gl = this.gl, P = r.P.world, M = this.M;
  r._bindLight(P, f);
  gl.uniformMatrix4fv(P.u.uVP, false, r.vp);
  if (P.u.uRoomOverride) gl.uniform1f(P.u.uRoomOverride, 1);
  const blink = (performance.now() % 1200) < 600;
  for (const q of L) {
    if (q.hp <= 0 || Math.hypot(q.x - r.camPos[0], q.z - r.camPos[2]) > 250) continue;
    const c = Math.cos(q.yaw), s = Math.sin(q.yaw);
    M.fill(0); M[0] = c; M[2] = -s; M[5] = 1; M[8] = s; M[10] = c; M[15] = 1; M[12] = q.x; M[13] = q.y; M[14] = q.z;
    gl.uniformMatrix4fv(P.u.uModel, false, M);
    gl.uniform3f(P.u.uTint, 1, 1, 1);
    drawMesh(gl, this.rallyBody);
    const mine = q.team === this.my, k = blink ? 1.6 : 0.5;
    gl.uniform3f(P.u.uTint, mine ? 0.35 * k : 1.0 * k, mine ? 1.0 * k : 0.25 * k, mine ? 0.4 * k : 0.2 * k);
    drawMesh(gl, this.rallyLamp);
  }
  M.fill(0); M[0] = M[5] = M[10] = M[15] = 1;
  gl.uniformMatrix4fv(P.u.uModel, false, M);
  gl.uniform3f(P.u.uTint, 1, 1, 1);
  if (P.u.uRoomOverride) gl.uniform1f(P.u.uRoomOverride, -1);
};
WarFlags.prototype._drawMags = function (f, D, box) {
  const r = this.r, gl = this.gl, P = r.P.world, M = this.M;
  r._bindLight(P, f);
  gl.uniformMatrix4fv(P.u.uVP, false, r.vp);
  if (P.u.uRoomOverride) gl.uniform1f(P.u.uRoomOverride, 1);
  gl.uniform3f(P.u.uTint, 1, 1, 1);
  for (const q of D) {
    if (Math.hypot(q.x - r.camPos[0], q.z - r.camPos[2]) > (box ? 150 : 40)) continue;
    const k = box && !q.big ? 0.72 : 1, c = Math.cos(q.yaw) * k, s = Math.sin(q.yaw) * k;
    M.fill(0); M[0] = c; M[2] = -s; M[5] = k; M[8] = s; M[10] = c; M[15] = 1; M[12] = q.x; M[13] = q.y + 0.005; M[14] = q.z;
    gl.uniformMatrix4fv(P.u.uModel, false, M);
    drawMesh(gl, box ? this.ammoMesh : this.magMesh);
  }
  M.fill(0); M[0] = M[5] = M[10] = M[15] = 1;
  gl.uniformMatrix4fv(P.u.uModel, false, M);
  if (P.u.uRoomOverride) gl.uniform1f(P.u.uRoomOverride, -1);
};
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
