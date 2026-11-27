// 倒れた味方を引きずる（大規模戦。BattleBit: 倒れた味方を見て F。引きずりながら動けるが遅い。引きずりながら起こし始められる）
// research/WARBIT.md の 65。速さ・つなぐ長さは推測（本家の数字は見つからなかった）
//  - 引きずる人: 走れず撃てず構えられない。速さ 1.4m/s まで
//  - 倒れた人: 胴が、引きずる人から DRAG.len より離れないように引かれる（綱のように。近づくのは自由）。体の向きは変えない
//  - やめる: もう一度押す・引きずる人が倒れる/死ぬ・倒れた人が起きる/死ぬ・体が物に引っかかって離れすぎる
import { groundAt, pushOut } from './world.js';

export const DRAG = { speed: 1.4, len: 1.0, max: 2.6 };

// off: 倒れた体の原点から胴までのずれ（x, z）。interact.js が始めるときに測る
export function startDrag(S, a, b, off, ev) {
  if (a.drag != null) stopDrag(S, a, ev);
  if (b.dragBy != null) { const o = S.byId[b.dragBy]; if (o) stopDrag(S, o, ev); }
  a.drag = b.id; b.dragBy = a.id; a.dragOff = off || [0, 0];
  a.sprint = false; a.adsOn = false;
  if (ev) ev.push({ e: 'drag', id: a.id, tgt: b.id, on: true });
}
export function stopDrag(S, a, ev) {
  const b = a.drag != null ? S.byId[a.drag] : null;
  if (b && b.dragBy === a.id) b.dragBy = null;
  if (a.drag != null && ev) ev.push({ e: 'drag', id: a.id, tgt: b ? b.id : -1, on: false });
  a.drag = null; a.dragOff = null;
}

const _po = [0, 0, 0];
// 毎ステップ（人を動かしたあと）: 倒れた体を引く
export function stepDrag(S, w, ev) {
  for (const a of S.actors) {
    if (a.drag == null) continue;
    const b = S.byId[a.drag];
    if (!a.alive || a.down || a.dead || !b || !b.alive || !b.down || b.dragBy !== a.id) { stopDrag(S, a, ev); continue; }
    const off = a.dragOff || [0, 0];
    const tx = b.x + off[0], tz = b.z + off[1];
    const dx = a.x - tx, dz = a.z - tz, d = Math.hypot(dx, dz);
    if (d > DRAG.max || Math.abs(a.y - b.y) > 1.2) { stopDrag(S, a, ev); continue; }
    if (d <= DRAG.len) continue;
    const k = (d - DRAG.len) / d;
    let nx = b.x + dx * k, nz = b.z + dz * k;
    // 体は壁を抜けない（腰の高さの帯）。段差は 0.45m まで上り下りする
    pushOut(w, nx, nz, b.y + 0.15, b.y + 0.55, 0.22, S.doors, -1, _po);
    nx += _po[0]; nz += _po[1];
    const g = groundAt(w, nx, nz, b.y + 0.1);
    if (!isFinite(g) || g < b.y - 1.5) continue; // 落ちる所へは引かない
    b.x = nx; b.z = nz; b.y = g; b.vx = 0; b.vz = 0;
  }
}
