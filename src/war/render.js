// WAR BIT の世界の形（描く物）。64m の塊ごとに:
//   遠い形（いつも持つ）: 地形 8m ごと＋すそ（つなぎ目のすき間を隠す）・簡単な木・箱（建物・塀・岩）
//   近い形（近づいたときだけ作る）: 地形 2m ごと・道の帯（アスファルトと中央線）・細かい木・箱・階段
// 見た目（research/WARBIT.md の 4）: 地形はなめらかな面に頂点の色（草のむら・乾いた所・土・岩・川床・道）、
// 物は角ばった低ポリ（木の葉は面ごとの平らな光）。建物の中の面は日が当たらない（頂点の room＝日の当たり方）。
import { MeshBuilder, hex, mixc, mulc } from '../render/build.js';
import { LAYER } from '../render/textures.js';
import { M } from '../engine/data/materials.js';
import { heightAt } from './world.js';
import { mulberry, fbm } from './noise.js';

export const CH = 64;

// 色（独自）
const C = {
  // 11-19: BattleBit の落ち着いた色に（草と葉の緑を黄みのオリーブへ寄せ、鮮やかさを抜く）
  lush: hex('#56653a'), dry: hex('#6f6e47'), dark: hex('#47563a'), dirt: hex('#6c5c45'), rock: hex('#6e6a63'), mount: hex('#5a6145'),
  sand: hex('#8e7d5e'), road: hex('#3f3e3b'), edge: hex('#69645a'), pad: hex('#6f6653'), mud: hex('#5e4f3b'),
  wheat: hex('#a69a55'), wheat2: hex('#968a49'), plow: hex('#5d4a35'), plow2: hex('#6e5940'), pasture: hex('#526238'), paved: hex('#a39d90'), yard: hex('#8c8a83'),
};
const BUSH = [hex('#44532f'), hex('#4b5b33'), hex('#3d4a2b'), hex('#525f36')];
const WALKC = hex('#a29d91');
const MATCOL = { [M.BRICK]: '#a77a5e', [M.CONCRETE]: '#a3a39b', [M.DRYWALL]: '#d6d0c2', [M.WOOD]: '#8a6a44', [M.METAL]: '#7d878a', [M.FABRIC]: '#a28f68', [M.EARTH]: '#6f5c43', [M.FENCE]: '#8a9094', [M.CAR]: '#6c7a86' };
const MATLAYER = { [M.BRICK]: LAYER.brick, [M.CONCRETE]: LAYER.concrete, [M.DRYWALL]: LAYER.plaster, [M.WOOD]: LAYER.wood, [M.METAL]: LAYER.metal, [M.FABRIC]: LAYER.fabric, [M.EARTH]: LAYER.dirt, [M.FENCE]: LAYER.metal, [M.CAR]: LAYER.paint };
const PINE = [hex('#3a5136'), hex('#41583a'), hex('#344a32')], OAK = [hex('#56683a'), hex('#5e7040'), hex('#4f6136')], TRUNK = hex('#58463a');
const ROADC = hex('#4a4845'), LINEC = hex('#d8d2b8');

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function jitter(c, r, k = 0.06) { const f = 1 + (r() * 2 - 1) * k; return [c[0] * f, c[1] * f, c[2] * f]; }
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// 建物ごとの屋根の高さ（床の板の一番上）。中の面の判定・人の明るさに使う
function bldTops(ww) {
  if (ww._bldTop) return ww._bldTop;
  const m = new Map();
  for (const bd of ww.blds || []) m.set(bd.id, { ...bd, top: bd.y });
  for (const b of ww.boxes) if (b.bld >= 0 && b.kind === 'floor') { const q = m.get(b.bld); if (q) q.top = Math.max(q.top, b.y1); }
  // 切妻の屋根（坂の板）: 屋根裏まで中
  for (const r of ww.ramps) if (r.bld >= 0 && r.kind === 'roof') { const q = m.get(r.bld); if (q) q.top = Math.max(q.top, Math.min(r.y0, r.y1) + 0.5); }
  ww._bldTop = m;
  return m;
}
function insideBld(q, x, y, z) {
  const r = q.rect;
  return x > r[0] + 0.02 && x < r[2] - 0.02 && z > r[1] + 0.02 && z < r[3] - 0.02 && y < q.top - 0.02 && y > q.y - 0.6;
}
// その場所の日の当たり方（外 1・建物の中 0.25）。人や手元の銃の明るさに使う
export function sunVisAt(ww, x, y, z) {
  const m = bldTops(ww);
  for (const q of m.values()) if (insideBld(q, x, y + 1.0, z)) return 0.25;
  return 1;
}

// 地面の色（2m の格子の点ごと、一度だけ作る）と、道の帯の切れ端（塊ごと）
export function prepGround(ww) {
  if (ww._gcol) return;
  const { HW, HD, hs, h } = ww, n = HW * HD;
  const col = new Float32Array(n * 3);
  // 道までの距離
  const rd = new Float32Array(n).fill(1e9);
  for (const r of ww.roads || []) for (let k = 0; k + 1 < r.length; k++) {
    const [ax, az] = r[k], [bx, bz] = r[k + 1];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 8) / hs)), i1 = Math.min(HW - 1, Math.ceil((Math.max(ax, bx) + 8) / hs));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - 8) / hs)), j1 = Math.min(HD - 1, Math.ceil((Math.max(az, bz) + 8) / hs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = segDist(i * hs, j * hs, ax, az, bx, bz); const q = j * HW + i; if (d < rd[q]) rd[q] = d; }
  }
  // 建物のまわり（踏み固めた地面）
  const near = new Uint8Array(n);
  for (const bd of ww.blds || []) {
    const [x0, z0, x1, z1] = bd.rect, m = bd.kind === 'tower' ? 2 : 4;
    for (let j = Math.max(0, Math.floor((z0 - m) / hs)); j <= Math.min(HD - 1, Math.ceil((z1 + m) / hs)); j++)
      for (let i = Math.max(0, Math.floor((x0 - m) / hs)); i <= Math.min(HW - 1, Math.ceil((x1 + m) / hs)); i++) near[j * HW + i] = 1;
  }
  // 踏み固めた地面（マップが決めた四角。射撃場の射台のまわりなど）
  for (const [x0, z0, x1, z1] of ww.pads || [])
    for (let j = Math.max(0, Math.floor(z0 / hs)); j <= Math.min(HD - 1, Math.ceil(z1 / hs)); j++)
      for (let i = Math.max(0, Math.floor(x0 / hs)); i <= Math.min(HW - 1, Math.ceil(x1 / hs)); i++) near[j * HW + i] = 1;
  // 畑（ww.fields: { x0,z0,x1,z1, kind: wheat 麦・plow 耕した土・pasture 牧草・vine ぶどう・orchard 果樹, dir: 列の向き 'x'|'z' }）と舗装（ww.paved: [x0,z0,x1,z1,kind]）
  const fieldAt = new Int16Array(n).fill(-1), pavedAt = new Uint8Array(n);
  (ww.fields || []).forEach((f, fi) => {
    for (let j = Math.max(0, Math.ceil(f.z0 / hs)); j <= Math.min(HD - 1, Math.floor(f.z1 / hs)); j++)
      for (let i = Math.max(0, Math.ceil(f.x0 / hs)); i <= Math.min(HW - 1, Math.floor(f.x1 / hs)); i++) fieldAt[j * HW + i] = fi;
  });
  for (const [x0, z0, x1, z1, kind] of ww.paved || [])
    for (let j = Math.max(0, Math.ceil(z0 / hs)); j <= Math.min(HD - 1, Math.floor(z1 / hs)); j++)
      for (let i = Math.max(0, Math.ceil(x0 / hs)); i <= Math.min(HW - 1, Math.floor(x1 / hs)); i++) pavedAt[j * HW + i] = kind === 'yard' ? 2 : 1;
  // 地面の面の種類（草か土）と、草の生え方（0〜1・1 は麦）
  const lay = new Uint8Array(n).fill(LAYER.grass), gw = new Float32Array(n), gk = new Uint8Array(n);
  // 山の色が始まる所（中心からの距離。正方形でないマップは x と z で別に）
  const cx = ww.sx / 2, cz = ww.sz / 2, [mx, mz] = ww.mountIn || [ww.sx / 2 - 110, ww.sz / 2 - 110];
  const r = mulberry(91);
  for (let j = 0; j < HD; j++) for (let i = 0; i < HW; i++) {
    const q = j * HW + i, x = i * hs, z = j * hs;
    const hl = h[j * HW + Math.max(0, i - 1)], hr = h[j * HW + Math.min(HW - 1, i + 1)], hu = h[Math.max(0, j - 1) * HW + i], hd = h[Math.min(HD - 1, j + 1) * HW + i];
    const dx = (hr - hl) / (2 * hs), dz = (hd - hu) / (2 * hs), ny = 1 / Math.hypot(dx, 1, dz), slope = 1 - ny;
    // 草のむら（青い所・乾いた所・暗い所）
    const p = fbm(x, z, 95, 3, 41), p2 = fbm(x, z, 33, 2, 77);
    let c = mixc(C.lush, C.dry, sstep(-0.15, 0.55, p));
    c = mixc(c, C.dark, sstep(0.25, 0.7, p2) * 0.6);
    // 細かいむら（BattleBit の地面は土の出た所と濃い草がまだら。research の 20）
    const p3 = fbm(x, z, 11, 2, 113), dp = sstep(0.1, 0.42, p3);
    c = mixc(mulc(c, (0.92 + 0.12 * (r() - 0.5)) * (1 - 0.22 * sstep(-0.05, -0.4, p3))), mixc(C.dirt, C.mud, 0.35), dp * 0.72);
    let g = (1 - sstep(0.14, 0.3, slope)) * (1 - dp * 0.6), dirt = false;
    // 畑（列の縞は 2m ごとの点で交互）
    const fi = fieldAt[q];
    if (fi >= 0) {
      const fd = ww.fields[fi], u = Math.round((fd.dir === 'x' ? z : x) / hs);
      if (fd.kind === 'wheat') { c = mixc(C.wheat, C.wheat2, u % 2 ? 0.75 : 0.15); gk[q] = 1; g = 1; }
      else if (fd.kind === 'plow') { c = u % 2 ? C.plow : C.plow2; g = 0.04; dirt = true; }
      else if (fd.kind === 'pasture') { c = mixc(c, C.pasture, 0.75); g = Math.min(1, g * 1.1); }
      else if (fd.kind === 'vine') { c = mixc(c, u % 2 ? C.dirt : C.dry, 0.55); g *= 0.45; }
      else if (fd.kind === 'orchard') { c = mixc(c, C.lush, 0.5); }
    }
    // 坂は土、急な所は岩
    c = mixc(c, C.dirt, sstep(0.1, 0.22, slope));
    c = mixc(c, C.rock, sstep(0.26, 0.42, slope));
    if (slope > 0.3) dirt = true;
    // 遊べる範囲の外の山
    const e = Math.max(Math.abs(x - cx) - mx, Math.abs(z - cz) - mz);
    c = mixc(c, C.mount, sstep(0, 60, e) * 0.7);
    g *= 1 - sstep(-20, 30, e) * 0.6;
    // 川床（山の中までは続けない）
    if (ww.riverX) { const dr = Math.abs(x - ww.riverX(z)), kr = (1 - sstep(8, 15, dr)) * (1 - sstep(-40, 10, e)); c = mixc(c, C.sand, kr); g *= 1 - kr; if (kr > 0.5) dirt = true; }
    // 小川の底（乾いた泥）と、岸の濃い草
    if (ww.creekDist) { const dc = ww.creekDist(x, z); if (dc < 7) { const km = 1 - sstep(1.2, 3.6, dc); c = mixc(mixc(c, C.dark, (1 - sstep(3, 7, dc)) * 0.6), C.mud, km); g *= 1 - km * 0.8; if (km > 0.5) dirt = true; } }
    // 舗装（広場・工場の構内）
    if (pavedAt[q]) { c = pavedAt[q] === 2 ? C.yard : C.paved; g = 0; dirt = true; }
    // 建物のまわり
    if (near[q]) { c = mixc(c, C.pad, 0.65); g *= 0.15; dirt = true; }
    // 道（帯は近くだけ描くので、遠くでも道に見えるよう地面の色も変える）
    const d = rd[q];
    if (d < 6) { c = mixc(c, C.edge, 1 - sstep(4.2, 6, d)); g *= sstep(4.6, 7.5, d); if (d < 5.2) dirt = true; }
    if (d < 4.4) c = mixc(c, C.road, 1 - sstep(3.4, 4.4, d));
    gw[q] = Math.max(0, Math.min(1, g)); if (dirt) lay[q] = LAYER.dirt;
    const f = 1 + (r() * 2 - 1) * 0.035;
    col[q * 3] = c[0] * f; col[q * 3 + 1] = c[1] * f; col[q * 3 + 2] = c[2] * f;
  }
  ww._gcol = col; ww._glay = lay; ww._gw = gw; ww._gk = gk;
  // 道の帯の切れ端（2m ごと）を塊へ
  const NX = Math.ceil(ww.sx / CH), NZ = Math.ceil(ww.sz / CH);
  const pieces = Array.from({ length: NX * NZ }, () => []);
  for (const rl of ww.roads || []) for (let k = 0; k + 1 < rl.length; k++) {
    const [ax, az] = rl[k], [bx, bz] = rl[k + 1], L = Math.hypot(bx - ax, bz - az), N = Math.max(1, Math.round(L / 2));
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = 0; s < N; s++) {
      const t0 = s / N * L, t1 = (s + 1) / N * L, mx = ax + ux * (t0 + t1) / 2, mz = az + uz * (t0 + t1) / 2;
      const ci = Math.min(NX - 1, Math.max(0, Math.floor(mx / CH))), cj = Math.min(NZ - 1, Math.max(0, Math.floor(mz / CH)));
      // 交差点の手前は中央線を描かない
      const line = (t0 > 10 && t1 < L - 10) && (Math.floor((t0 + t1) / 2 / 3) % 2 === 0);
      pieces[cj * NX + ci].push({ ax: ax + ux * t0, az: az + uz * t0, bx: ax + ux * t1, bz: az + uz * t1, ux, uz, line });
    }
  }
  ww._roadPieces = pieces;
  // 歩道（ww.walks: 町の通りの折れ線）: 道の両側 4.0〜6.2m。交わる道の上は描かない
  const walks = Array.from({ length: NX * NZ }, () => []);
  for (const wl of ww.walks || []) for (let k = 0; k + 1 < wl.length; k++) {
    const [ax, az] = wl[k], [bx, bz] = wl[k + 1], L = Math.hypot(bx - ax, bz - az), N = Math.max(1, Math.round(L / 2));
    const ux = (bx - ax) / L, uz = (bz - az) / L, px = -uz, pz = ux;
    for (let s = 0; s < N; s++) for (const sd of [-1, 1]) {
      const t0 = s / N * L, t1 = (s + 1) / N * L;
      const pts = [[ax + ux * t0 + px * sd * 4, az + uz * t0 + pz * sd * 4], [ax + ux * t1 + px * sd * 4, az + uz * t1 + pz * sd * 4], [ax + ux * t1 + px * sd * 6.2, az + uz * t1 + pz * sd * 6.2], [ax + ux * t0 + px * sd * 6.2, az + uz * t0 + pz * sd * 6.2]];
      // ほかの道の上（交差点）は描かない
      let cross = false;
      for (const rl of ww.roads || []) {
        for (let m = 0; m + 1 < rl.length && !cross; m++) {
          const [cx0, cz0] = rl[m], [cx1, cz1] = rl[m + 1], sl = Math.hypot(cx1 - cx0, cz1 - cz0) || 1;
          // 同じ線の上の道（この歩道の道）は数えない
          const par = Math.abs((cx1 - cx0) * uz - (cz1 - cz0) * ux) / sl < 0.01, onLine = Math.abs((ax - cx0) * (cz1 - cz0) - (az - cz0) * (cx1 - cx0)) / sl < 0.5;
          if (par && onLine) continue;
          for (const [qx, qz] of pts) if (segDist(qx, qz, cx0, cz0, cx1, cz1) < 4.2) { cross = true; break; }
        }
        if (cross) break;
      }
      if (cross) continue;
      const mxw = (pts[0][0] + pts[2][0]) / 2, mzw = (pts[0][1] + pts[2][1]) / 2;
      const ci = Math.min(NX - 1, Math.max(0, Math.floor(mxw / CH))), cj = Math.min(NZ - 1, Math.max(0, Math.floor(mzw / CH)));
      walks[cj * NX + ci].push({ pts, sd, px: px * sd, pz: pz * sd });
    }
  }
  ww._walkPieces = walks;
  // 横断歩道（町の交差点の手前 7m。歩道のある通りだけ）: 交差点 = ほかの道が 4.5m 以内を通る折れ線の点
  const xw = Array.from({ length: NX * NZ }, () => []), RL = ww.roads || [];
  const nearRoad = (x, z, skip) => RL.some((rl, ri) => ri !== skip && rl.some((_, m) => m + 1 < rl.length && segDist(x, z, rl[m][0], rl[m][1], rl[m + 1][0], rl[m + 1][1]) < 4.5));
  const nearWalk = (x, z) => (ww.walks || []).some(wl => wl.some((_, m) => m + 1 < wl.length && segDist(x, z, wl[m][0], wl[m][1], wl[m + 1][0], wl[m + 1][1]) < 6));
  const seenX = new Set();
  RL.forEach((rl, ri) => {
    for (let k = 0; k + 1 < rl.length; k++) {
      const [ax, az] = rl[k], [bx, bz] = rl[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 18) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (const [px0, pz0, sg] of [[ax, az, 1], [bx, bz, -1]]) {
        if (!nearRoad(px0, pz0, ri) || !nearWalk(px0, pz0)) continue;
        const cx = px0 + ux * sg * 7.5, cz = pz0 + uz * sg * 7.5, key = Math.round(cx) + ',' + Math.round(cz);
        if (seenX.has(key)) continue; seenX.add(key);
        const ci = Math.min(NX - 1, Math.max(0, Math.floor(cx / CH))), cj = Math.min(NZ - 1, Math.max(0, Math.floor(cz / CH)));
        xw[cj * NX + ci].push({ cx, cz, ux, uz });
      }
    }
  });
  // 交差点の真ん中を通り抜ける道（T 字の上の棒）も、交わる道の両側に
  RL.forEach((rl, ri) => {
    for (let k = 0; k + 1 < rl.length; k++) {
      const [ax, az] = rl[k], [bx, bz] = rl[k + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      RL.forEach((r2, rj) => {
        if (rj === ri) return;
        // 交わる点: 向こうの道の端か、向こうの線分とこちらの線分が交わる点（十字路）
        const hits = [r2[0], r2[r2.length - 1]];
        for (let m = 0; m + 1 < r2.length; m++) {
          const [cx0, cz0] = r2[m], [cx1, cz1] = r2[m + 1], dx = cx1 - cx0, dz = cz1 - cz0, den = ux * dz - uz * dx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((cx0 - ax) * dz - (cz0 - az) * dx) / den, s = ((cx0 - ax) * uz - (cz0 - az) * ux) / den;
          if (t > 0 && t < L && s > 0 && s < 1) hits.push([ax + ux * t, az + uz * t]);
        }
        for (const q of hits) {
          const t = (q[0] - ax) * ux + (q[1] - az) * uz;
          if (t < 12 || t > L - 12 || segDist(q[0], q[1], ax, az, bx, bz) > 4.5 || !nearWalk(q[0], q[1])) continue;
          for (const sg of [-1, 1]) {
            const cx = ax + ux * (t + sg * 7.5), cz = az + uz * (t + sg * 7.5), key = Math.round(cx) + ',' + Math.round(cz);
            if (seenX.has(key)) continue; seenX.add(key);
            const ci = Math.min(NX - 1, Math.max(0, Math.floor(cx / CH))), cj = Math.min(NZ - 1, Math.max(0, Math.floor(cz / CH)));
            xw[cj * NX + ci].push({ cx, cz, ux, uz });
          }
        }
      });
    }
  });
  ww._xwalkPieces = xw;
}
// 横断歩道の白い縞（近い形だけ）: 道の向きに長さ 2.6m・幅 0.5m の帯を、横へ 1m ごとに 7 本
function xwalkMesh(B, ww, list) {
  B.room = 1;
  for (const p of list) {
    const px = -p.uz, pz = p.ux, y = 0.07 + 0.014;
    for (let s = -3; s <= 3; s++) {
      const o = s * 1.0, w = 0.25, l = 1.3, mx = p.cx + px * o, mz = p.cz + pz * o;
      const pts = [[mx - p.ux * l + px * w, mz - p.uz * l + pz * w], [mx - p.ux * l - px * w, mz - p.uz * l - pz * w], [mx + p.ux * l - px * w, mz + p.uz * l - pz * w], [mx + p.ux * l + px * w, mz + p.uz * l + pz * w]].map(([x, z]) => [x, heightAt(ww, x, z) + y, z]);
      B.poly(pts, [0, 1, 0], LAYER.paint, mulc(LINEC, 0.96));
    }
  }
}

// 地形の格子（なめらかな面）。step は ww.hs の倍数。skirt: すその深さ（0 なら作らない）
function terrainMesh(B, ww, x0, z0, x1, z1, step, skirt) {
  const { hs, HW, HD, h } = ww, col = ww._gcol, k = Math.max(1, Math.round(step / hs));
  const i0 = Math.round(x0 / hs), j0 = Math.round(z0 / hs), i1 = Math.min(HW - 1, Math.round(x1 / hs)), j1 = Math.min(HD - 1, Math.round(z1 / hs));
  const nx = Math.ceil((i1 - i0) / k), nz = Math.ceil((j1 - j0) / k), W1 = nx + 1;
  const base = B.n;
  B.room = 1; B.emit = 0;
  for (let b = 0; b <= nz; b++) for (let a = 0; a <= nx; a++) {
    const gi = Math.min(i1, i0 + a * k), gj = Math.min(j1, j0 + b * k), q = gj * HW + gi;
    const il = Math.max(0, gi - k), ir = Math.min(HW - 1, gi + k), ju = Math.max(0, gj - k), jd = Math.min(HD - 1, gj + k);
    const dx = (h[gj * HW + ir] - h[gj * HW + il]) / ((ir - il) * hs), dz = (h[jd * HW + gi] - h[ju * HW + gi]) / ((jd - ju) * hs);
    const l = Math.hypot(dx, 1, dz), x = gi * hs, z = gj * hs;
    B.vert([x, h[q], z], [-dx / l, 1 / l, -dz / l], x * 0.3, z * 0.3, ww._glay ? ww._glay[q] : LAYER.grass, [col[q * 3], col[q * 3 + 1], col[q * 3 + 2]], 1);
  }
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const p00 = base + b * W1 + a, p10 = p00 + 1, p01 = p00 + W1, p11 = p01 + 1;
    B.i.push(p00, p01, p10, p11, p10, p01);
  }
  if (!skirt) return;
  const edges = [[], [], [], []];
  for (let a = 0; a <= nx; a++) { edges[0].push(base + a); edges[1].push(base + nz * W1 + a); }
  for (let b = 0; b <= nz; b++) { edges[2].push(base + b * W1); edges[3].push(base + b * W1 + nx); }
  for (const E of edges) {
    const low = E.map(t => { const o = t * 15, v = B.v.slice(o, o + 15); v[1] -= skirt; for (const x of v) B.v.push(x); return B.n++; });
    for (let s = 0; s + 1 < E.length; s++) {
      const a = E[s], b2 = E[s + 1], la = low[s], lb = low[s + 1];
      B.i.push(a, la, b2, b2, la, lb, a, b2, la, b2, lb, la);
    }
  }
}

// 道の帯（近い形だけ）: 幅 8m を4つに分けて地形に沿わせる。中央の白い破線
function roadMesh(B, ww, pieces) {
  B.room = 1;
  const lift = 0.07, half = 4, nX = 4;
  for (const p of pieces) {
    const px = -p.uz, pz = p.ux; // 左右
    const row = (x, z) => { const out = []; for (let s = 0; s <= nX; s++) { const o = -half + (2 * half) * s / nX, X = x + px * o, Z = z + pz * o; out.push([X, heightAt(ww, X, Z) + lift, Z]); } return out; };
    const A = row(p.ax, p.az), Bq = row(p.bx, p.bz);
    for (let s = 0; s < nX; s++) {
      const a0 = A[s], a1 = A[s + 1], b0 = Bq[s], b1 = Bq[s + 1];
      const e1 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]], e2 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; n = n.map(v => v / l); if (n[1] < 0) n = n.map(v => -v);
      const edge = s === 0 || s === nX - 1;
      B.poly([a0, a1, b1, b0], n, LAYER.asphalt, edge ? mulc(ROADC, 1.06) : ROADC);
    }
    if (p.line) {
      const w = 0.09, y = lift + 0.012;
      const pts = [[p.ax + px * w, p.az + pz * w], [p.ax - px * w, p.az - pz * w], [p.bx - px * w, p.bz - pz * w], [p.bx + px * w, p.bz + pz * w]].map(([x, z]) => [x, heightAt(ww, x, z) + y, z]);
      B.poly(pts, [0, 1, 0], LAYER.paint, LINEC);
    }
  }
}

// 歩道（近い形だけ）: 縁石の高さ 0.13m の帯と、道の側の縁石の面
function walkMesh(B, ww, pieces) {
  B.room = 1;
  const top = 0.13;
  for (const p of pieces) {
    const P = p.pts.map(([x, z]) => [x, heightAt(ww, x, z) + top, z]);
    B.poly(P, [0, 1, 0], LAYER.sidewalk, WALKC);
    // 縁石（道の側: pts[0]→pts[1]）
    const a = p.pts[0], b = p.pts[1], ya = heightAt(ww, a[0], a[1]), yb = heightAt(ww, b[0], b[1]);
    B.poly([[a[0], ya, a[1]], [b[0], yb, b[1]], [b[0], yb + top, b[1]], [a[0], ya + top, a[1]]], [-p.px, 0, -p.pz], LAYER.concrete, mulc(WALKC, 0.86));
  }
}
// 舗装（近い形だけ）: 2m ごとに地形に沿わせた板（広場は石畳、構内はコンクリート）
function pavedMesh(B, ww, rect, x0, z0, x1, z1) {
  const [px0, pz0, px1, pz1, kind] = rect, a0 = Math.max(px0, x0), b0 = Math.max(pz0, z0), a1 = Math.min(px1, x1), b1 = Math.min(pz1, z1);
  if (a1 <= a0 || b1 <= b0) return;
  B.room = 1;
  const lift = 0.05, st = 2, col = kind === 'yard' ? C.yard : C.paved, layer = kind === 'yard' ? LAYER.concrete : LAYER.sidewalk;
  for (let z = b0; z < b1 - 1e-6; z += st) for (let x = a0; x < a1 - 1e-6; x += st) {
    const xa = x, xb = Math.min(a1, x + st), za = z, zb = Math.min(b1, z + st);
    const P = [[xa, za], [xb, za], [xb, zb], [xa, zb]].map(([px, pz]) => [px, heightAt(ww, px, pz) + lift, pz]);
    B.poly(P, [0, 1, 0], layer, col);
  }
}

// 面ごとに平らな光の円すい台（木の葉・幹）。r1=0 で円すい
function facetCyl(B, x, z, y0, y1, r0, r1, seg, layer, col, o = {}) {
  const rot = o.rot || 0;
  for (let k = 0; k < seg; k++) {
    const a0 = rot + (k / seg) * Math.PI * 2, a1 = rot + ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], p1 = [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0];
    const q0 = [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], q1 = [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1];
    const sl = (r0 - r1) / Math.max(1e-6, y1 - y0), nl = Math.hypot(1, sl);
    const n = [Math.cos(am) / nl, sl / nl, Math.sin(am) / nl];
    const c = o.shade ? mulc(col, 0.92 + 0.16 * ((k * 7) % seg) / seg) : col;
    if (r1 > 1e-4) B.poly([p0, p1, q1, q0], n, layer, c); else B.poly([p0, p1, q0], n, layer, c);
  }
  if (o.capB && r0 > 0) { const pts = []; for (let k = seg - 1; k >= 0; k--) { const a = rot + (k / seg) * Math.PI * 2; pts.push([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0]); } B.poly(pts, [0, -1, 0], layer, mulc(col, 0.7)); }
  if (o.capT && r1 > 0) { const pts = []; for (let k = 0; k < seg; k++) { const a = rot + (k / seg) * Math.PI * 2; pts.push([x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1]); } B.poly(pts, [0, 1, 0], layer, mulc(col, 1.08)); }
}
// ---- 植物の部品（11-19: BattleBit の木と茂みに寄せて作り込む。research/WARBIT.md の 18）
// 正二十面体を少しゆがめた葉のかたまり（面ごとに平らな光。下の面ほど暗い＝葉の陰）。rx・ry・rz は半径
const ICO_V = (() => { const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]; return v.map(p => { const l = Math.hypot(...p); return p.map(q => q / l); }); })();
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
function triN(a, b, c) { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; return [n[0] / l, n[1] / l, n[2] / l]; }
function lump(B, x, y, z, rx, ry, rz, col, r, o = {}) {
  const j = o.jit ?? 0.18, flat = o.flat ?? 0.55, rot = r() * 6.28, cs = Math.cos(rot), sn = Math.sin(rot);
  const P = ICO_V.map(v => { const f = 1 + (r() * 2 - 1) * j; let px = v[0] * rx * f, py = v[1] * ry * f, pz = v[2] * rz * f; if (py < 0) py *= flat; return [x + px * cs - pz * sn, y + py, z + px * sn + pz * cs]; });
  for (const [a, b, c] of ICO_F) {
    const A = P[a], Bv = P[b], C = P[c], n = triN(A, Bv, C);
    const k = 0.74 + 0.3 * Math.max(0, n[1]) - 0.1 * Math.max(0, -n[1]) + (r() - 0.5) * 0.08;
    B.poly([A, Bv, C], n, o.layer ?? LAYER.leaves, mulc(col, k));
  }
}
// 2点を結ぶ先細りの筒（幹と枝。面ごとに平らな光）
function tube(B, a, b, r0, r1, seg, layer, col, r) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, w = d.map(q => q / L);
  const up = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]]; const ul = Math.hypot(...u); u = u.map(q => q / ul);
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]], rot = r ? r() * 6.28 : 0;
  const ring = (c, rr, k) => { const t = rot + k / seg * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t); return [c[0] + (u[0] * ct + v[0] * st) * rr, c[1] + (u[1] * ct + v[1] * st) * rr, c[2] + (u[2] * ct + v[2] * st) * rr]; };
  for (let k = 0; k < seg; k++) {
    const p0 = ring(a, r0, k), p1 = ring(a, r0, k + 1), q1 = ring(b, r1, k + 1), q0 = ring(b, r1, k), tm = rot + (k + 0.5) / seg * Math.PI * 2;
    const n = [u[0] * Math.cos(tm) + v[0] * Math.sin(tm), u[1] * Math.cos(tm) + v[1] * Math.sin(tm), u[2] * Math.cos(tm) + v[2] * Math.sin(tm)];
    B.poly([p0, p1, q1, q0], n, layer, mulc(col, 0.9 + 0.18 * ((k * 5) % seg) / seg));
  }
}
// 針葉樹の段（星形の縁が少し垂れたかさ。下にふた）
function pineTier(B, x, z, y0, y1, R, pts, col, r, rot, under = true) {
  const ring = [];
  for (let k = 0; k < pts * 2; k++) { const a = rot + k / (pts * 2) * Math.PI * 2, rr = R * (k % 2 ? 0.66 + r() * 0.08 : 0.94 + r() * 0.12); ring.push([x + Math.cos(a) * rr, y0 - (k % 2 ? 0 : R * 0.16), z + Math.sin(a) * rr]); }
  const apex = [x + (r() - 0.5) * R * 0.08, y1, z + (r() - 0.5) * R * 0.08];
  for (let k = 0; k < ring.length; k++) { const A = ring[k], Bv = ring[(k + 1) % ring.length], n = triN(A, Bv, apex); const nn = n[1] < 0 ? n.map(q => -q) : n; B.poly([A, Bv, apex], nn, LAYER.leaves, mulc(col, 0.8 + 0.28 * Math.max(0, nn[1]) + (r() - 0.5) * 0.06)); }
  if (under) { const c = [x, y0 + R * 0.06, z]; for (let k = 0; k < ring.length; k++) B.poly([ring[(k + 1) % ring.length], ring[k], c], [0, -1, 0], LAYER.leaves, mulc(col, 0.5)); }
}
const BIRCH = hex('#d9d6cc'), BIRCH_MARK = hex('#3a3632');
// ---- 葉の板（抜きのある四角）: 中心 C・横の半分 R・縦の半分 U。法線は nf(点) で頂点ごと（房の丸い明るさ）。両面
function card(B, C, R, U, layer, col, nf, ao = 1, uv = [0, 0, 1, 1]) {
  const P = [[C[0] - R[0] - U[0], C[1] - R[1] - U[1], C[2] - R[2] - U[2]], [C[0] + R[0] - U[0], C[1] + R[1] - U[1], C[2] + R[2] - U[2]], [C[0] + R[0] + U[0], C[1] + R[1] + U[1], C[2] + R[2] + U[2]], [C[0] - R[0] + U[0], C[1] - R[1] + U[1], C[2] - R[2] + U[2]]];
  const T = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
  const e0 = B.emit; B.emit = -2;
  const i0 = B.vert(P[0], nf(P[0]), T[0][0], T[0][1], layer, col, ao); B.vert(P[1], nf(P[1]), T[1][0], T[1][1], layer, col, ao); B.vert(P[2], nf(P[2]), T[2][0], T[2][1], layer, col, ao); B.vert(P[3], nf(P[3]), T[3][0], T[3][1], layer, col, ao);
  B.emit = e0;
  B.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
}
const nrmz = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
// 丸い房の法線（中心から外へ＋少し上）
const sphN = (cx, cy, cz, up = 0.45) => (p) => nrmz([p[0] - cx, (p[1] - cy) + up * 2, p[2] - cz]);
// 葉の房: 中の暗いかたまり＋まわりに向きのばらばらな葉の板 k 枚
function leafClump(B, x, y, z, rr, col, r, k, ctr) {
  lump(B, x, y, z, rr * 0.55, rr * 0.5, rr * 0.55, mulc(col, 0.72), r, { jit: 0.1 });
  const nf = sphN(ctr[0], ctr[1], ctr[2], 0.5);
  for (let q = 0; q < k; q++) {
    // 板の向き: でたらめな法線から横・縦の向きを作る（真横すぎ・真上すぎを少し避ける）
    const th = r() * 6.283, ph = (r() - 0.5) * 2.4, n = [Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)];
    const a0 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let Rv = nrmz([n[1] * a0[2] - n[2] * a0[1], n[2] * a0[0] - n[0] * a0[2], n[0] * a0[1] - n[1] * a0[0]]);
    let Uv = nrmz([n[1] * Rv[2] - n[2] * Rv[1], n[2] * Rv[0] - n[0] * Rv[2], n[0] * Rv[1] - n[1] * Rv[0]]);
    const rot = r() * 6.283, cs = Math.cos(rot), sn = Math.sin(rot), h = rr * (0.8 + r() * 0.3);
    const R2 = [(Rv[0] * cs + Uv[0] * sn) * h, (Rv[1] * cs + Uv[1] * sn) * h, (Rv[2] * cs + Uv[2] * sn) * h], U2 = [(-Rv[0] * sn + Uv[0] * cs) * h, (-Rv[1] * sn + Uv[1] * cs) * h, (-Rv[2] * sn + Uv[2] * cs) * h];
    const d = rr * (0.25 + r() * 0.35), dir = nrmz([r() - 0.5, (r() - 0.35) * 0.8, r() - 0.5]);
    card(B, [x + dir[0] * d, y + dir[1] * d, z + dir[2] * d], R2, U2, LAYER.foliage, mulc(col, 0.88 + r() * 0.24), nf, 1);
  }
}
function treeMesh(B, t, far) {
  // 色と形は木ごとに決まる（近い形と遠い形で同じ）。BattleBit のように葉は「葉の絵の板」を重ねた房（research の 20）
  const r = mulberry(5000 + (t.cyl ?? Math.round(t.x * 31 + t.z * 17)) * 7);
  const s = t.s, x = t.x, z = t.z, y = t.y, rot = r() * 6.28;
  B.room = 1;
  if (t.kind === 'pine') {
    // 針葉樹: 細い幹に、段ごとに放射状の垂れた枝の板（上から見た針葉の枝の絵）と、中の暗い星形のかさ
    const c = jitter(PINE[Math.floor(r() * PINE.length)], r, 0.06), H = 7.2 * s;
    if (far) { pineTier(B, x, z, y + 1.4 * s, y + 4.8 * s, 2.0 * s, 4, c, r, rot, false); pineTier(B, x, z, y + 3.6 * s, y + H, 1.35 * s, 4, mulc(c, 1.05), r, rot + 0.5, false); return; }
    tube(B, [x, y - 0.3, z], [x, y + H * 0.85, z], 0.21 * s, 0.06 * s, 6, LAYER.wood, TRUNK, r);
    const tiers = 5, nf = (p) => nrmz([(p[0] - x) * 0.6, 1.0, (p[2] - z) * 0.6]);
    for (let k = 0; k < tiers; k++) {
      const f = k / (tiers - 1), y0 = y + (1.15 + f * 4.0) * s, R = (2.2 - f * 1.45) * s * (0.92 + r() * 0.16), cc = mulc(c, 0.9 + f * 0.14);
      pineTier(B, x, z, y0 - 0.1 * s, y0 + (1.2 - f * 0.2) * s, R * 0.62, 5, mulc(cc, 0.62), r, rot + k * 0.7, false);
      const nb = 7 - Math.floor(f * 2);
      for (let q = 0; q < nb; q++) {
        const a = rot + k * 0.7 + q / nb * 6.283 + (r() - 0.5) * 0.3, dx = Math.cos(a), dz = Math.sin(a), L = R * (0.9 + r() * 0.2), droop = 0.32 + r() * 0.12, W = L * 0.42;
        // 枝の板: 幹から外へ L・幅 W。少し垂れ、横は少し起こす（横から見ても板が見える）
        const C = [x + dx * L * 0.5, y0 + 0.35 * s - droop * L * 0.5, z + dz * L * 0.5];
        const Rv = [dx * L * 0.5, -droop * L * 0.5, dz * L * 0.5], side = nrmz([-dz, 0.3, dx]), Uv = [side[0] * W * 0.5, side[1] * W * 0.5, side[2] * W * 0.5];
        card(B, C, Rv, Uv, LAYER.needles, mulc(cc, 0.9 + r() * 0.2), nf, 1);
      }
    }
    // てっぺん: 細い星形と、縦の針葉の板2枚
    pineTier(B, x, z, y + 5.6 * s, y + H + 0.3 * s, 0.55 * s, 5, mulc(c, 1.06), r, rot, false);
  } else if (((t.cyl ?? 0) * 7919) % 100 < 22) {
    // 白樺（広葉樹の2割ほど）: 白い幹に黒い節、小さい葉の房
    const c = jitter(hex('#6d7a45'), r, 0.08), H = 6.4 * s, lean = [(r() - 0.5) * 0.5 * s, (r() - 0.5) * 0.5 * s];
    if (far) { farCanopy(B, x + lean[0], y + 4.6 * s, z + lean[1], 1.6 * s, 1.9 * s, c, r); return; }
    for (let k = 0; k < 4; k++) { const a = k / 4, b = (k + 1) / 4; tube(B, [x + lean[0] * a, y - 0.3 + (H + 0.3) * a, z + lean[1] * a], [x + lean[0] * b, y - 0.3 + (H + 0.3) * b, z + lean[1] * b], 0.17 * s * (1 - a * 0.5), 0.17 * s * (1 - b * 0.5), 5, LAYER.wood, k % 2 ? BIRCH : mixc(BIRCH, BIRCH_MARK, 0.18), r); }
    const ctr = [x + lean[0] * 0.75, y + 4.8 * s, z + lean[1] * 0.75];
    for (let k = 0; k < 5; k++) { const a = rot + k * 1.3, h = (3.4 + k * 0.6) * s, d = (0.5 + r() * 0.6) * s; leafClump(B, x + lean[0] * h / H + Math.cos(a) * d, y + h, z + lean[1] * h / H + Math.sin(a) * d, (0.9 + r() * 0.3) * s, mulc(c, 0.92 + r() * 0.16), r, 5, ctr); }
  } else {
    // 広葉樹: 少し傾いた幹から枝を3〜4本、枝の先と真ん中に葉の房
    const c = jitter(OAK[Math.floor(r() * OAK.length)], r, 0.06), H = 3.0 * s, lx = (r() - 0.5) * 0.5 * s, lz = (r() - 0.5) * 0.5 * s;
    if (far) { farCanopy(B, x + lx, y + 4.3 * s, z + lz, 2.6 * s, 2.1 * s, c, r); return; }
    const top = [x + lx, y + H, z + lz], ctr = [x + lx, y + H + 1.6 * s, z + lz];
    tube(B, [x, y - 0.3, z], top, 0.3 * s, 0.2 * s, 6, LAYER.wood, TRUNK, r);
    tube(B, top, [x + lx * 1.4, y + H + 1.3 * s, z + lz * 1.4], 0.2 * s, 0.12 * s, 5, LAYER.wood, TRUNK, r);
    const nb = 3 + (r() < 0.5 ? 1 : 0);
    leafClump(B, x + lx * 1.4, y + H + 2.1 * s, z + lz * 1.4, 1.7 * s, mulc(c, 1.04), r, 8, ctr);
    for (let k = 0; k < nb; k++) {
      const a = rot + k / nb * Math.PI * 2 + (r() - 0.5) * 0.6, d = (1.35 + r() * 0.5) * s, h = H - 0.4 * s + r() * 0.8 * s;
      const e = [top[0] + Math.cos(a) * d, y + h + 0.9 * s, top[2] + Math.sin(a) * d];
      tube(B, [top[0], y + h - 0.5 * s, top[2]], e, 0.12 * s, 0.05 * s, 4, LAYER.wood, TRUNK, r);
      leafClump(B, e[0], e[1] + 0.35 * s, e[2], (1.15 + r() * 0.35) * s, mulc(c, 0.9 + r() * 0.16), r, 6, ctr);
    }
  }
}
// 遠い木の葉: 中の暗いかたまり＋縦の葉の板3枚の十字（少ない三角で、近い形と同じ葉の見え方）
function farCanopy(B, x, y, z, rw, rh, c, r) {
  lump(B, x, y, z, rw * 0.7, rh * 0.62, rw * 0.7, mulc(c, 0.7), r, { jit: 0.12 });
  const nf = sphN(x, y, z, 0.6), a0 = r() * 3.14;
  for (let q = 0; q < 3; q++) { const a = a0 + q * 1.047; card(B, [x, y, z], [Math.cos(a) * rw, 0, Math.sin(a) * rw], [0, rh, 0], LAYER.foliage, mulc(c, 0.95 + r() * 0.1), nf, 1); }
  card(B, [x, y + rh * 0.3, z], [rw * 0.9, 0, 0], [0, 0, rw * 0.9], LAYER.foliage, c, nf, 1);
}

// 茂み: 中の暗いかたまり＋葉の板（低く横に広い）。遠くは1つのかたまり
function blob(B, x, y, z, r0, h, seg, col, rot, rr) { lump(B, x, y + h * 0.45, z, r0, h * 0.55, r0, col, rr || mulberry(Math.round(x * 13 + z * 7 + h * 100))); }
function bushMesh(B, b, far) {
  const r = mulberry(7000 + Math.round(b.x * 13 + b.z * 7));
  const c0 = b.col ? hex(b.col) : jitter(BUSH[Math.floor(r() * BUSH.length)], r, 0.07);
  B.room = 1;
  if (far) { lump(B, b.x, b.y + b.h * 0.42, b.z, b.r * 0.95, b.h * 0.55, b.r * 0.95, c0, r, { jit: 0.12 }); return; }
  const n = b.n || 2 + Math.floor(r() * 2), ctr = [b.x, b.y + b.h * 0.3, b.z];
  for (let k = 0; k < n; k++) {
    const a = r() * 6.28, d = k ? b.r * (0.35 + r() * 0.3) : 0, rr = b.r * (k ? 0.55 + r() * 0.2 : 0.8), hh = b.h * (k ? 0.6 + r() * 0.3 : 1);
    leafClump(B, b.x + Math.cos(a) * d, b.y - 0.05 + hh * 0.5, b.z + Math.sin(a) * d, Math.max(rr, hh * 0.55), mulc(c0, 0.9 + r() * 0.18), r, 5, ctr);
  }
}
// 岩: 箱の中に収まる低ポリの塊（下・中・上の輪を少しずつずらし、面ごとに平らな光）
function rockMesh(B, b, col, onGround) {
  const r = mulberry(3000 + b.id * 7);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, rx = (b.x1 - b.x0) / 2, rz = (b.z1 - b.z0) / 2, H = b.y1 - b.y0, n = 7, rot = r() * 6.28;
  const ring = (t, s, j) => Array.from({ length: n }, (_, k) => { const a = rot + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.35, f = s * (0.82 + r() * 0.22); return [cx + Math.cos(a) * rx * f, b.y0 + H * t + (r() - 0.5) * H * j, cz + Math.sin(a) * rz * f]; });
  const R0 = ring(0, 0.9, 0), R1 = ring(0.5, 1.0, 0.14), R2 = ring(0.88, 0.62, 0.08), peak = [cx + (r() - 0.5) * rx * 0.3, b.y1, cz + (r() - 0.5) * rz * 0.3];
  const tri = (a, b2, c) => {
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...nn) || 1; nn = nn.map(q => q / l);
    const mx = (a[0] + b2[0] + c[0]) / 3 - cx, my = (a[1] + b2[1] + c[1]) / 3 - (b.y0 + H * 0.4), mz = (a[2] + b2[2] + c[2]) / 3 - cz;
    if (nn[0] * mx + nn[1] * my + nn[2] * mz < 0) nn = nn.map(q => -q);
    B.poly([a, b2, c], nn, LAYER.concrete, mulc(col, 0.86 + 0.22 * Math.max(0, nn[1]) + r() * 0.06));
  };
  B.room = 1;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    tri(R0[k], R0[k1], R1[k1]); tri(R0[k], R1[k1], R1[k]);
    tri(R1[k], R1[k1], R2[k1]); tri(R1[k], R2[k1], R2[k]);
    tri(R2[k], R2[k1], peak);
  }
  if (!onGround) { const pts = R0.slice().reverse(); B.poly(pts, [0, -1, 0], LAYER.concrete, mulc(col, 0.7)); }
}

// 箱（建物の壁・床・屋根・塀・コンテナ・岩）。建物の中の面は日が当たらない（room 0）・暗め（ao）
function boxMesh(B, ww, b, tops, near) {
  if (b.hide) return;
  const r = mulberry(1000 + b.id * 13);
  const col = jitter(hex(b.col || MATCOL[b.mat] || '#a0a0a0'), r, b.kind === 'trim' ? 0.02 : 0.05);
  const gy = heightAt(ww, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
  const onGround = b.y0 <= gy + 0.05;
  B.room = 1;
  // 車輪: 横向きの円筒（タイヤ＋ホイールの円盤）。軸は b.shape = 'wheelX' | 'wheelZ'
  if (b.shape === 'wheelX' || b.shape === 'wheelZ') { wheelMesh(B, b, col, near); return; }
  // コンテナ（近く）: 側面の波板の筋・扉の縦の棒・上下の枠
  if (b.kind === 'container' && near) { containerMesh(B, b, col, r, onGround); return; }
  if (b.bev && b.bld < 0) {
    // 小物（車・防護柵・木箱など）: 角を落とした箱。面ごとの色（cols）も使える
    const cols = b.cols ? b.cols.map(c => c && jitter(hex(c), r, 0.03)) : null;
    B.bbox(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.bev, b.layer ?? (MATLAYER[b.mat] ?? LAYER.concrete), col, { faces: onGround ? 63 & ~8 : 63, uv: 0.5, cols });
    // 生け垣の上の葉のかたまり（近くだけ。四角い上面をくずす）
    if (near && b.kind === 'hedge') {
      const alongX = b.x1 - b.x0 >= b.z1 - b.z0, L = alongX ? b.x1 - b.x0 : b.z1 - b.z0, th = alongX ? b.z1 - b.z0 : b.x1 - b.x0, m = Math.max(1, Math.round(L / 1.6));
      for (let k = 0; k < m; k++) {
        const t = (k + 0.5) / m, x = alongX ? b.x0 + L * t : (b.x0 + b.x1) / 2, z = alongX ? (b.z0 + b.z1) / 2 : b.z0 + L * t;
        blob(B, x + (r() - 0.5) * 0.3, b.y1 - 0.28, z + (r() - 0.5) * 0.3, th * (0.42 + r() * 0.12), 0.45 + r() * 0.25, 6, mulc(col, 0.95 + r() * 0.12), r() * 6.28);
      }
    }
    return;
  }
  if (b.kind === 'rock') { rockMesh(B, b, col, onGround); return; }
  if (b.kind === 'sandbag' && near) { sandbagMesh(B, b, r, col); return; }
  const layer = b.layer ?? (b.kind === 'container' ? LAYER.metal : (MATLAYER[b.mat] ?? LAYER.concrete));
  const q = b.bld >= 0 ? tops.get(b.bld) : null;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2, e = 0.15;
  const pts = [[b.x1 + e, cy, cz], [b.x0 - e, cy, cz], [cx, b.y1 + e, cz], [cx, b.y0 - e, cz], [cx, cy, b.z1 + e], [cx, cy, b.z0 - e]];
  for (let f = 0; f < 6; f++) {
    const bit = 1 << f;
    if (bit === 8 && onGround) continue;
    const inside = q && insideBld(q, pts[f][0], pts[f][1], pts[f][2]);
    B.room = inside ? 0 : 1;
    const ao = inside ? (b.mat === M.DRYWALL || b.kind === 'floor' ? 0.62 : 0.52) : 1;
    B.box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, layer, col, { faces: bit, uv: 0.5, aoTop: ao, aoBottom: inside ? ao * 0.8 : (onGround && f !== 2 ? 0.85 : 1) });
  }
  B.room = 1;
}
// 車輪（横向きの円筒。近くは12角でホイールの円盤とハブ、遠くは8角）
function wheelMesh(B, b, col, near) {
  const ax = b.shape === 'wheelX', cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
  const half = ax ? (b.x1 - b.x0) / 2 : (b.z1 - b.z0) / 2, R = (b.y1 - b.y0) / 2, seg = near ? 12 : 8;
  const P = (t, a, rr) => ax ? [cx + t, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr] : [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz + t];
  const tire = mulc(col, 1), rim = [0.6, 0.62, 0.64], hub = [0.42, 0.43, 0.45];
  B.room = 1;
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
    const n = ax ? [0, Math.sin(am), Math.cos(am)] : [Math.cos(am), Math.sin(am), 0];
    B.poly([P(-half, a0, R), P(-half, a1, R), P(half, a1, R), P(half, a0, R)], n, LAYER.rubber, mulc(tire, 0.9 + 0.12 * Math.max(0, n[1])));
  }
  for (const sd of [-1, 1]) {
    const n = ax ? [sd, 0, 0] : [0, 0, sd], ring = [], inner = [];
    for (let k = 0; k < seg; k++) { const a = k / seg * Math.PI * 2; ring.push(P(sd * half, a, R)); inner.push(P(sd * (half + 0.005), a, R * 0.62)); }
    B.poly(ring, n, LAYER.rubber, mulc(tire, 0.8));
    if (near) { B.poly(inner, n, LAYER.metal, rim); const hc = []; for (let k = 0; k < 6; k++) hc.push(P(sd * (half + 0.012), k / 6 * Math.PI * 2, R * 0.2)); B.poly(hc, n, LAYER.metal, hub); }
  }
}
// コンテナ（近い形）: 本体の箱＋長い側面の縦の筋（波板）＋扉側の縦の棒2本＋上の縁
function containerMesh(B, b, col, r, onGround) {
  const L = LAYER.metal, dx = b.x1 - b.x0, dz = b.z1 - b.z0, alongX = dx >= dz;
  B.room = 1;
  B.box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, L, col, { faces: onGround ? 63 & ~8 : 63, uv: 0.5 });
  const dark = mulc(col, 0.82), lite = mulc(col, 1.06), len = alongX ? dx : dz, n = Math.floor((len - 0.3) / 0.28);
  for (let k = 0; k < n; k++) {
    const t = 0.15 + (k + 0.5) * (len - 0.3) / n;
    if (k % 2) continue;
    if (alongX) { const x = b.x0 + t; B.box(x - 0.06, b.y0 + 0.12, b.z0 - 0.035, x + 0.06, b.y1 - 0.1, b.z0, L, dark, { faces: 63 & ~8 & ~16 }); B.box(x - 0.06, b.y0 + 0.12, b.z1, x + 0.06, b.y1 - 0.1, b.z1 + 0.035, L, dark, { faces: 63 & ~8 & ~32 }); }
    else { const z = b.z0 + t; B.box(b.x0 - 0.035, b.y0 + 0.12, z - 0.06, b.x0, b.y1 - 0.1, z + 0.06, L, dark, { faces: 63 & ~8 & ~1 }); B.box(b.x1, b.y0 + 0.12, z - 0.06, b.x1 + 0.035, b.y1 - 0.1, z + 0.06, L, dark, { faces: 63 & ~8 & ~2 }); }
  }
  // 扉の端（長い向きの片側）: 縦の締め棒と取っ手
  for (const f of [0.3, 0.42, 0.58, 0.7]) {
    if (alongX) { const z = b.z0 + dz * f; B.box(b.x1, b.y0 + 0.15, z - 0.025, b.x1 + 0.05, b.y1 - 0.12, z + 0.025, L, lite, {}); }
    else { const x = b.x0 + dx * f; B.box(x - 0.025, b.y0 + 0.15, b.z1, x + 0.025, b.y1 - 0.12, b.z1 + 0.05, L, lite, {}); }
  }
  B.box(b.x0 - 0.02, b.y1 - 0.1, b.z0 - 0.02, b.x1 + 0.02, b.y1, b.z1 + 0.02, L, mulc(col, 0.9), { faces: 63 & ~8 });
}
// 土のう: 袋を互い違いに積む（近い形だけ。遠くは1つの箱）
function sandbagMesh(B, b, r, col) {
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0, L = alongX ? b.x1 - b.x0 : b.z1 - b.z0, th = alongX ? b.z1 - b.z0 : b.x1 - b.x0;
  const layers = 3, lh = (b.y1 - b.y0) / layers, bl = 0.62;
  B.room = 1;
  for (let k = 0; k < layers; k++) {
    const off = (k % 2) * bl / 2, y0 = b.y0 + k * lh, y1 = y0 + lh, ins = k * 0.04;
    for (let s = -off; s < L - 1e-3; s += bl) {
      const a = Math.max(0, s) + 0.015, e = Math.min(L, s + bl) - 0.015;
      if (e - a < 0.12) continue;
      const c = mulc(col, 0.88 + r() * 0.2), dy = (r() - 0.5) * 0.03;
      if (alongX) B.bbox(b.x0 + a, y0, b.z0 + ins, b.x0 + e, y1 + dy, b.z1 - ins, 0.07, LAYER.fabric, c, { faces: k ? 63 : 63 & ~8 });
      else B.bbox(b.x0 + ins, y0, b.z0 + a, b.x1 - ins, y1 + dy, b.z0 + e, 0.07, LAYER.fabric, c, { faces: k ? 63 : 63 & ~8 });
    }
  }
}
function rampMesh(B, rp, r, tops) {
  const col = jitter(hex(rp.col || '#8d8a84'), r, 0.04);
  const q = rp.bld >= 0 ? tops.get(rp.bld) : null;
  B.room = q ? 0 : 1;
  const ao = q ? 0.6 : 1;
  if (rp.smooth) { B.room = 1; smoothRamp(B, rp, col, rp.layer); B.room = 1; return; }
  const len = rp.dir === 'n' || rp.dir === 's' ? rp.z1 - rp.z0 : rp.x1 - rp.x0, n = Math.max(2, Math.round((rp.y1 - rp.y0) / 0.25));
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n, y = rp.y0 + (rp.y1 - rp.y0) * (k + 1) / n;
    let x0 = rp.x0, x1 = rp.x1, z0 = rp.z0, z1 = rp.z1;
    if (rp.dir === 'n') { z1 = rp.z1 - len * t0; z0 = rp.z1 - len * t1; }
    else if (rp.dir === 's') { z0 = rp.z0 + len * t0; z1 = rp.z0 + len * t1; }
    else if (rp.dir === 'e') { x0 = rp.x0 + len * t0; x1 = rp.x0 + len * t1; }
    else { x1 = rp.x1 - len * t0; x0 = rp.x1 - len * t1; }
    B.box(x0, y - 0.25, z0, x1, y, z1, LAYER.concrete, col, { uv: 0.5, aoTop: ao, aoBottom: ao * 0.8 });
  }
  B.room = 1;
}

// なめらかな坂の板（橋）: 上面・下面・両側・両端
function smoothRamp(B, rp, col, layer = LAYER.concrete) {
  const H = (x, z) => { let t; if (rp.dir === 'n') t = (rp.z1 - z) / (rp.z1 - rp.z0); else if (rp.dir === 's') t = (z - rp.z0) / (rp.z1 - rp.z0); else if (rp.dir === 'e') t = (x - rp.x0) / (rp.x1 - rp.x0); else t = (rp.x1 - x) / (rp.x1 - rp.x0); return rp.y0 + (rp.y1 - rp.y0) * Math.max(0, Math.min(1, t)); };
  const c = [[rp.x0, rp.z0], [rp.x1, rp.z0], [rp.x1, rp.z1], [rp.x0, rp.z1]];
  const top = c.map(([x, z]) => [x, H(x, z), z]), bot = c.map(([x, z]) => [x, H(x, z) - rp.th, z]);
  const n = (a, b, d) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]; let w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...w) || 1; return w.map(q => q / l); };
  let nt = n(top[0], top[3], top[1]); if (nt[1] < 0) nt = nt.map(q => -q);
  B.poly(top, nt, layer, col);
  B.poly(bot, nt.map(q => -q), layer, mulc(col, 0.7));
  for (let k = 0; k < 4; k++) { const a = k, b = (k + 1) % 4; const mx = (c[a][0] + c[b][0]) / 2 - (rp.x0 + rp.x1) / 2, mz = (c[a][1] + c[b][1]) / 2 - (rp.z0 + rp.z1) / 2, l = Math.hypot(mx, mz) || 1; B.poly([top[a], top[b], bot[b], bot[a]], [mx / l, 0, mz / l], layer, mulc(col, 0.85)); }
}
// 小物の円柱（ドラム缶・電柱・サイロ・干し草）
function cylMesh(B, c) {
  const col = hex(c.col);
  B.room = 1;
  facetCyl(B, c.x, c.z, c.y0, c.y1, c.r, c.r1 ?? c.r, c.seg || 8, c.layer ?? LAYER.metal, col, { capT: true, shade: true, rot: c.rot || 0 });
}
// 描くだけの面（切妻の三角の壁など）
function decoMesh(B, d, tops) {
  const q = d.bld >= 0 ? tops.get(d.bld) : null;
  B.room = 1;
  B.poly(d.pts, d.n, d.layer ?? LAYER.concrete, hex(d.col));
  // 裏側（中から見たとき）は暗く
  B.room = q ? 0 : 1;
  B.poly(d.pts.slice().reverse(), d.n.map(v => -v), d.layer ?? LAYER.concrete, mulc(hex(d.col), 0.6));
  B.room = 1;
}
// 塊の割り当て（箱・坂・木を中心のある塊へ）
function sortIn(ww) {
  if (ww._chunkItems) return ww._chunkItems;
  const NX = Math.ceil(ww.sx / CH), NZ = Math.ceil(ww.sz / CH);
  const it = Array.from({ length: NX * NZ }, () => ({ boxes: [], ramps: [], trees: [], cyls: [], decos: [], bushes: [], wires: [] }));
  const ck = (x, z) => Math.min(NZ - 1, Math.max(0, Math.floor(z / CH))) * NX + Math.min(NX - 1, Math.max(0, Math.floor(x / CH)));
  for (const b of ww.boxes) if (b.alive) it[ck((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)].boxes.push(b);
  for (const rp of ww.ramps) it[ck((rp.x0 + rp.x1) / 2, (rp.z0 + rp.z1) / 2)].ramps.push(rp);
  for (const t of ww.trees || []) it[ck(t.x, t.z)].trees.push(t);
  for (const c of ww.cyls) if (c.col && c.alive) it[ck(c.x, c.z)].cyls.push(c);
  for (const d of ww.decos || []) { if (d.hide) continue; let x = 0, z = 0; for (const p of d.pts) { x += p[0]; z += p[2]; } it[ck(x / d.pts.length, z / d.pts.length)].decos.push(d); }
  for (const b of ww.bushes || []) it[ck(b.x, b.z)].bushes.push(b);
  for (const wi of ww.wires || []) it[ck((wi.a[0] + wi.b[0]) / 2, (wi.a[2] + wi.b[2]) / 2)].wires.push(wi);
  ww._chunkItems = { NX, NZ, it };
  return ww._chunkItems;
}

// 遠い形を全部の塊について作る。戻り値: [{ k, x0,z0,x1,z1,y0,y1, B }]
export function buildWarFar(ww) {
  prepGround(ww);
  const { NX, NZ } = sortIn(ww), out = [];
  for (let k = 0; k < NX * NZ; k++) out.push(buildWarFarChunk(ww, k));
  return out;
}
// 遠い形（1つの塊）。壁・床が壊れた時はその塊だけ作り直す
export function buildWarFarChunk(ww, k) {
  prepGround(ww);
  const tops = bldTops(ww), { NX, it } = sortIn(ww);
  {
    const cx = k % NX, cz = Math.floor(k / NX), x0 = cx * CH, z0 = cz * CH, x1 = Math.min(ww.sx, x0 + CH), z1 = Math.min(ww.sz, z0 + CH);
    const B = new MeshBuilder();
    terrainMesh(B, ww, x0, z0, x1, z1, 8, 6);
    let y0 = 1e9, y1 = -1e9;
    for (let j = Math.floor(z0 / ww.hs); j <= Math.min(ww.HD - 1, Math.ceil(z1 / ww.hs)); j++) for (let i = Math.floor(x0 / ww.hs); i <= Math.min(ww.HW - 1, Math.ceil(x1 / ww.hs)); i++) { const hv = ww.h[j * ww.HW + i]; if (hv < y0) y0 = hv; if (hv > y1) y1 = hv; }
    for (const b of it[k].boxes) { if ((b.kind === 'crate' || b.kind === 'rail' || b.detail) && !b.far || b.kind === 'glass') continue; boxMesh(B, ww, b, tops, false); y1 = Math.max(y1, b.y1); y0 = Math.min(y0, b.y0); }
    for (const rp of it[k].ramps) if (rp.kind === 'roof' || rp.kind === 'bridge') { smoothRamp(B, rp, hex(rp.col || '#8d8a84'), rp.layer ?? LAYER.concrete); y1 = Math.max(y1, rp.y1); }
    for (const c of it[k].cyls) if (c.far) { cylMesh(B, c); y1 = Math.max(y1, c.y1); }
    for (const d of it[k].decos) if (d.far) { decoMesh(B, d, tops); for (const p of d.pts) y1 = Math.max(y1, p[1]); }
    for (const t of it[k].trees) { treeMesh(B, t, true); y1 = Math.max(y1, t.y + 7 * t.s); }
    // 茂みは大きい物だけ遠い形にも入れる（小さい物は近い形だけ）
    for (const b of it[k].bushes) if (b.h > 1.45 && b.r > 1.25) { bushMesh(B, b, true); y1 = Math.max(y1, b.y + b.h); }
    return { k, x0, z0, x1, z1, y0: y0 - 7, y1: y1 + 1, B };
  }
}
// 近い形（1つの塊）
// o.lite: 画質「低」。窓の桟・扉の板などの描くだけの細かい面と電線は省く
// o.split: 地形・木など（B）と、建物の箱・坂・柱・描くだけの面（BX）を分けて返す { B, BX }。壁が壊れた時は BX だけ作り直す
//  （塊の時間のほとんどは地形と木。箱は数 ms）
export function buildWarNear(ww, k, o = {}) {
  prepGround(ww);
  const { NX } = sortIn(ww);
  const cx = k % NX, cz = Math.floor(k / NX), x0 = cx * CH, z0 = cz * CH, x1 = Math.min(ww.sx, x0 + CH), z1 = Math.min(ww.sz, z0 + CH);
  const B = new MeshBuilder();
  terrainMesh(B, ww, x0, z0, x1, z1, ww.hs, 1.5);
  roadMesh(B, ww, ww._roadPieces[k] || []);
  xwalkMesh(B, ww, ww._xwalkPieces ? ww._xwalkPieces[k] || [] : []);
  walkMesh(B, ww, ww._walkPieces ? ww._walkPieces[k] || [] : []);
  for (const pr of ww.paved || []) pavedMesh(B, ww, pr, x0, z0, x1, z1);
  const BX = o.split ? new MeshBuilder() : B;
  buildWarNearBoxes(ww, k, o, BX);
  const { it } = sortIn(ww);
  for (const t of it[k].trees) treeMesh(B, t, false);
  for (const b of it[k].bushes) bushMesh(B, b, false);
  // 電線: たるんだ線（8つに分けた細い三角の筒）
  if (!o.lite) for (const wi of it[k].wires) {
    const N = 8, P = (t) => [wi.a[0] + (wi.b[0] - wi.a[0]) * t, wi.a[1] + (wi.b[1] - wi.a[1]) * t - 4 * wi.sag * t * (1 - t), wi.a[2] + (wi.b[2] - wi.a[2]) * t];
    for (let q = 0; q < N; q++) tube(B, P(q / N), P((q + 1) / N), 0.018, 0.018, 3, LAYER.rubber, [0.09, 0.09, 0.1], null);
  }
  return o.split ? { B, BX } : B;
}
// 近い形のうち、建物の箱・坂・柱・描くだけの面（壊れると作り直す）
export function buildWarNearBoxes(ww, k, o = {}, BX = new MeshBuilder()) {
  const tops = bldTops(ww), { it } = sortIn(ww);
  for (const b of it[k].boxes) if (b.kind !== 'glass') boxMesh(BX, ww, b, tops, true);
  const rr = mulberry(8000 + k);
  for (const rp of it[k].ramps) rampMesh(BX, rp, rr, tops);
  for (const c of it[k].cyls) cylMesh(BX, c);
  for (const d of it[k].decos) if (d.far || !o.lite) decoMesh(BX, d, tops);
  return BX;
}
// 窓ガラス（近い形だけ。透ける板は描く側がガラスの描き方で、奥から順に重ねる）
export function buildWarGlass(ww, k) {
  const { it } = sortIn(ww), G = new MeshBuilder(), c = hex('#a9c2cc');
  for (const b of it[k].boxes) if (b.kind === 'glass' && b.alive) G.box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, LAYER.plain, c);
  return G;
}
// 草（見る位置のまわりの塊だけ）: 地面の草の生え方（gw）に合わせて、細い葉3〜4枚の株を散らす。麦畑は高い金色の株。
// 頂点の emit = -1 が草のしるし（シェーダーで遠い所から少しずつ消す・裏も同じ明るさ）
export function buildWarGrass(ww, k, dens = 1) {
  prepGround(ww);
  const NX = Math.ceil(ww.sx / CH), cx = k % NX, cz = Math.floor(k / NX), x0 = cx * CH, z0 = cz * CH;
  const B = new MeshBuilder(), { HW, HD, hs } = ww, gw = ww._gw, gk = ww._gk, col = ww._gcol, r = mulberry(91000 + k);
  B.room = 1; B.emit = -1;
  const N = Math.round(1150 * dens);
  for (let t = 0; t < N; t++) {
    const x = x0 + r() * CH, z = z0 + r() * CH, i = Math.min(HW - 1, Math.round(x / hs)), j = Math.min(HD - 1, Math.round(z / hs)), q = j * HW + i;
    const w = gw[q];
    if (!(w > 0.02) || r() > w) continue;
    const y = heightAt(ww, x, z) - 0.04, wheat = gk[q] === 1;
    const H = wheat ? 0.78 + r() * 0.32 : 0.28 + r() * 0.5;
    const base = [col[q * 3], col[q * 3 + 1], col[q * 3 + 2]];
    // 株の色: 地面より少し暗い緑が多く、ときどき枯れた茶・赤みの雑草（BattleBit の草むらは暗くまだら。research の 20）
    const kk = r(), tip = wheat ? mixc(base, [0.8, 0.74, 0.48], 0.4)
      : kk < 0.16 ? mixc(base, [0.52, 0.42, 0.27], 0.55 + r() * 0.2)
      : kk < 0.22 ? mixc(base, [0.48, 0.27, 0.2], 0.5)
      : mixc(mulc(base, 0.9 + r() * 0.12), [0.45, 0.47, 0.3], 0.1 + r() * 0.12);
    const cB = mulc(base, 0.48), cT = tip;
    // 草の株の絵の板を2枚十字に（BattleBit の草と同じ作り。research の 20）。下は暗く、先は明るい
    const rot = r() * 3.1416, W = H * (wheat ? 0.55 : 0.85), nU = [0, 1, 0];
    for (let b = 0; b < 2; b++) {
      const a = rot + b * 1.5708, dx = Math.cos(a) * W * 0.5, dz = Math.sin(a) * W * 0.5, lean = (r() - 0.5) * 0.25 * H;
      const lx = Math.cos(a + 1.5708) * lean, lz = Math.sin(a + 1.5708) * lean;
      const i0 = B.vert([x - dx, y, z - dz], nU, 0, 1, LAYER.tuft, cB, 1);
      B.vert([x + dx, y, z + dz], nU, 1, 1, LAYER.tuft, cB, 1);
      B.vert([x + dx + lx, y + H, z + dz + lz], nU, 1, 0, LAYER.tuft, cT, 1);
      B.vert([x - dx + lx, y + H, z - dz + lz], nU, 0, 0, LAYER.tuft, cT, 1);
      B.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
    }
  }
  B.emit = 0;
  return B;
}
