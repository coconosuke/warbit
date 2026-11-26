// 大規模戦の壁と床を壊す（BattleBit の破壊: HEAT のロケットは壁と床に穴を開ける。research/WARBIT.md の 37・38）。
// 爆発の点のまわり（R）にある薄い壁（kind 'wall'・厚み 0.5m まで）と床（kind 'floor'）に、四角い穴を開ける。
//   壁: 幅 1.5m・高さ 1.6m（爆発の高さが中心）。床: 1.4m 四方。穴は箱を最大4つに分けて作る（元の箱は alive=false で残す）。
//   穴の中の窓枠など（trim の箱・描くだけの面）も消す。地面の高さの床（いちばん下の床）は壊さない。
//   壊れない物: コンクリートの壁は 2 回目から（1 回目は欠けるだけ。hp）、鉄（コンテナ・柵）、岩、土のう
// 戻り値: 変わった描く塊（64m の塊）の番号の配列。事実（穴の大きさ・コンクリートの耐え方）は推測
import { addBox, reindexBox, G, heightAt } from './world.js';
import { M } from '../engine/data/materials.js';

const CH = 64; // 描く塊の大きさ（render.js の CH と同じ）

export const HOLE = { w: 1.5, h: 1.6, floor: 1.4, thick: 0.5, minPiece: 0.08 };
const SOFT = new Set([M.BRICK, M.DRYWALL, M.WOOD, M.CONCRETE, M.FABRIC]);
const CONC_HITS = 2;

function nearBoxes(ww, x, z, R) {
  const out = new Set();
  const i0 = Math.max(0, Math.floor((x - R) / G)), i1 = Math.min(ww.GW - 1, Math.floor((x + R) / G));
  const j0 = Math.max(0, Math.floor((z - R) / G)), j1 = Math.min(ww.GD - 1, Math.floor((z + R) / G));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const id of ww.cellBox[j * ww.GW + i]) out.add(id);
  return [...out].map(id => ww.boxes[id]);
}
// 点から箱までの距離
function boxDist(b, x, y, z) {
  const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1), dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dy, dz);
}
function copyProps(b) {
  const o = { mat: b.mat, kind: b.kind, bld: b.bld, col: b.col, opaque: b.opaque, walk: b.walk, hp: b.hp };
  for (const k of ['layer', 'bev', 'detail', 'hide', 'far', 'cols', 'shape']) if (b[k] != null) o[k] = b[k];
  return o;
}
const chunkOf = (ww, x, z) => { const NX = Math.ceil(ww.sx / CH), NZ = Math.ceil(ww.sz / CH); return Math.min(NZ - 1, Math.max(0, Math.floor(z / CH))) * NX + Math.min(NX - 1, Math.max(0, Math.floor(x / CH))); };

// 箱 b から、範囲 [hx0,hx1]×[hy0,hy1]×[hz0,hz1] を抜いた残りの箱を作る（抜く向きの軸 ax: 'x'|'y'|'z' は箱を貫く）
function cut(ww, b, hx0, hy0, hz0, hx1, hy1, hz1, ax) {
  mods(ww); // 足す前の箱の数を覚える
  const P = copyProps(b), mp = HOLE.minPiece, made = [];
  const add = (x0, y0, z0, x1, y1, z1) => { if (x1 - x0 > mp && y1 - y0 > mp && z1 - z0 > mp) { const nb = addBox(ww, { ...P, x0, y0, z0, x1, y1, z1 }); nb.cut = (b.cut || 0) + 1; made.push(nb); } };
  if (ax === 'z') {
    // 壁が x にそっている（z が薄い）: 左右・下・上
    add(b.x0, b.y0, b.z0, hx0, b.y1, b.z1); add(hx1, b.y0, b.z0, b.x1, b.y1, b.z1);
    add(hx0, b.y0, b.z0, hx1, hy0, b.z1); add(hx0, hy1, b.z0, hx1, b.y1, b.z1);
  } else if (ax === 'x') {
    add(b.x0, b.y0, b.z0, b.x1, b.y1, hz0); add(b.x0, b.y0, hz1, b.x1, b.y1, b.z1);
    add(b.x0, b.y0, hz0, b.x1, hy0, hz1); add(b.x0, hy1, hz0, b.x1, b.y1, hz1);
  } else {
    // 床（y が薄い）: 手前・奥・左・右
    add(b.x0, b.y0, b.z0, b.x1, b.y1, hz0); add(b.x0, b.y0, hz1, b.x1, b.y1, b.z1);
    add(b.x0, b.y0, hz0, hx0, b.y1, hz1); add(hx1, b.y0, hz0, b.x1, b.y1, hz1);
  }
  b.alive = false; mods(ww).dead.push(b);
  for (const nb of made) reindexBox(ww, nb);
  return made;
}
// 試合で変えた物の記録（マップの形は試合をまたいで使い回すので、次の試合の前に戻す）
function mods(ww) { return ww._mods || (ww._mods = { base: ww.boxes.length, dead: [], dmg: [], decos: [] }); }
export function restoreWorld(ww) {
  if (ww) { ww._carveN = 0; ww._bdmg = null; }
  const m = ww && ww._mods; if (!m) return false;
  for (const b of m.dead) b.alive = true;
  for (const b of m.dmg) { b.dmg = 0; b.chip = false; }
  for (const d of m.decos) d.hide = false;
  if (ww.boxes.length > m.base) { ww.boxes.length = m.base; for (const c of ww.cellBox) for (let i = c.length - 1; i >= 0; i--) if (c[i] >= m.base) c.splice(i, 1); }
  ww._mods = null; ww._chunkItems = null;
  return true;
}

// 爆発（x,y,z）で壁と床に穴を開ける。R: 届く距離（壁の面まで）。o.force: コンクリートも 1 回で。
// o.w・o.h・o.floor: 穴の大きさ（既定は HOLE）。o.only: その箱だけ（大ハンマー）
export function carve(ww, x, y, z, R = 1.2, o = {}) {
  if (!ww || !ww.war || !ww.cellBox) return [];
  const changed = new Set(), hw = (o.w || HOLE.w) / 2, hh = (o.h || HOLE.h) / 2, hf = (o.floor || HOLE.floor) / 2;
  const holes = [], gone = [], made = [], hid = [];
  for (const b of nearBoxes(ww, x, z, R + 2)) {
    if (!b.alive || b.hide || (b.kind !== 'wall' && b.kind !== 'floor') || !SOFT.has(b.mat)) continue;
    if (o.only != null && b.id !== o.only) continue;
    if (boxDist(b, x, y, z) > R) continue;
    const sx = b.x1 - b.x0, sy = b.y1 - b.y0, sz = b.z1 - b.z0;
    let ax;
    if (b.kind === 'floor') { if (sy > HOLE.thick) continue; ax = 'y'; }
    else if (sz <= HOLE.thick && sx > sz) ax = 'z';
    else if (sx <= HOLE.thick && sz > sx) ax = 'x';
    else continue;
    // いちばん下の床（地面の上の板）は壊さない
    if (ax === 'y' && b.y0 < heightAt(ww, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) + 0.6) continue;
    // コンクリートは 1 回目は欠けるだけ
    if (b.mat === M.CONCRETE && !o.force) { if (!b.dmg) mods(ww).dmg.push(b); b.dmg = (b.dmg || 0) + 1; if (b.dmg < CONC_HITS) { b.chip = true; continue; } }
    const cx = Math.max(b.x0, Math.min(b.x1, x)), cy = Math.max(b.y0, Math.min(b.y1, y)), cz = Math.max(b.z0, Math.min(b.z1, z));
    let h;
    if (ax === 'z') h = [Math.max(b.x0, cx - hw), Math.max(b.y0, cy - hh), b.z0 - 0.01, Math.min(b.x1, cx + hw), Math.min(b.y1, cy + hh), b.z1 + 0.01];
    else if (ax === 'x') h = [b.x0 - 0.01, Math.max(b.y0, cy - hh), Math.max(b.z0, cz - hw), b.x1 + 0.01, Math.min(b.y1, cy + hh), Math.min(b.z1, cz + hw)];
    else h = [Math.max(b.x0, cx - hf), b.y0 - 0.01, Math.max(b.z0, cz - hf), Math.min(b.x1, cx + hf), b.y1 + 0.01, Math.min(b.z1, cz + hf)];
    // 下や上に細い帯だけ残るなら、そこまで抜く（扉のような穴に）
    if (ax !== 'y') { if (h[1] - b.y0 < 0.35) h[1] = b.y0 - 0.01; if (b.y1 - h[4] < 0.25) h[4] = b.y1 + 0.01; }
    for (const nb of cut(ww, b, h[0], h[1], h[2], h[3], h[4], h[5], ax)) made.push(nb);
    gone.push(b); holes.push(h);
    changed.add(chunkOf(ww, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));
  }
  if (!holes.length) return [];
  // 穴の中の窓枠・桟（trim の箱と、描くだけの面）を消す
  const inside = (px, py, pz, h, m = 0.25) => px >= h[0] - m && px <= h[3] + m && py >= h[1] - m && py <= h[4] + m && pz >= h[2] - m && pz <= h[5] + m;
  for (const b of nearBoxes(ww, x, z, R + 3)) {
    if (!b.alive || b.kind !== 'trim') continue;
    const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2, mz = (b.z0 + b.z1) / 2;
    if (holes.some(h => inside(mx, my, mz, h))) { b.alive = false; mods(ww).dead.push(b); gone.push(b); changed.add(chunkOf(ww, mx, mz)); }
  }
  for (const d of ww.decos || []) {
    if (d.hide) continue;
    const p0 = d.pts[0]; if (Math.abs(p0[0] - x) > R + 3 || Math.abs(p0[2] - z) > R + 3) continue;
    if (holes.some(h => d.pts.every(p => inside(p[0], p[1], p[2], h)))) { d.hide = true; mods(ww).decos.push(d); hid.push(d); changed.add(chunkOf(ww, p0[0], p0[2])); }
  }
  fixItems(ww, gone, made, hid);
  return [...changed];
}
// 窓ガラスを割る（11-20）: 箱を消す（元に戻すときは restoreWorld）。戻り値: 変わった描く塊
export function breakPane(ww, b) {
  if (!b || !b.alive || b.kind !== 'glass') return [];
  b.alive = false; mods(ww).dead.push(b);
  fixItems(ww, [b], [], []);
  return [chunkOf(ww, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)];
}
// 割って知らせる（エンジンの側。オンラインの参加側は 'wglass' の知らせで同じ板を割る）
export function shatter(S, ww, b, ev, x, y, z) {
  const ks = breakPane(ww, b); if (!ks.length) return false;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
  if (ev) ev.push({ e: 'wglass', id: b.id, x: x ?? cx, y: y ?? cy, z: z ?? cz, cx, cy, cz, ks });
  return true;
}
// 点のまわり R の窓ガラスをまとめて割る（爆発・乗り越え）。y0..y1: 高さの範囲（なければ全部）
export function shatterNear(S, ww, x, y, z, R, ev, y0 = -1e9, y1 = 1e9) {
  if (!ww || !ww.war || !ww.cellBox) return 0;
  let n = 0;
  for (const b of nearBoxes(ww, x, z, R + 1)) {
    if (!b.alive || b.kind !== 'glass' || b.y1 < y0 || b.y0 > y1 || boxDist(b, x, y, z) > R) continue;
    if (shatter(S, ww, b, ev)) n++;
  }
  return n;
}
// 描く塊ごとの物の表（render.js の sortIn）を、変わった物だけ直す（全部を作り直すと、穴を開けるたびに数十 ms 止まる）
function fixItems(ww, gone, made, hid) {
  const C = ww._chunkItems; if (!C) return;
  const ck = (x, z) => Math.min(C.NZ - 1, Math.max(0, Math.floor(z / CH))) * C.NX + Math.min(C.NX - 1, Math.max(0, Math.floor(x / CH)));
  const drop = (L, o) => { const i = L.indexOf(o); if (i >= 0) L.splice(i, 1); };
  for (const b of gone) drop(C.it[ck((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)].boxes, b);
  for (const b of made) C.it[ck((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)].boxes.push(b);
  for (const d of hid) { let x = 0, z = 0; for (const p of d.pts) { x += p[0]; z += p[2]; } drop(C.it[ck(x / d.pts.length, z / d.pts.length)].decos, d); }
}
