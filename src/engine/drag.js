// 倒れた味方を引きずる（大規模戦。BattleBit: 倒れた味方を見て F。引きずりながら動けるが遅い。引きずりながら起こし始められる）
// research/WARBIT.md の 65。速さ・つなぐ長さは推測（本家の数字は見つからなかった）
//  - 引きずる人: 走れず撃てず構えられない。速さ 1.4m/s まで
//  - 倒れた人: 胴が、引きずる人から DRAG.len より離れないように引かれる（綱のように。近づくのは自由）。体は頭が引く人の方へ回る（11-27）
//  - やめる: もう一度押す・引きずる人が倒れる/死ぬ・倒れた人が起きる/死ぬ・体が物に引っかかって離れすぎる
import { groundAt, pushOut } from './world.js';

// medic: 衛生は引きずるのが速い（BattleBit 3.0 の予定。研究メモ 70。速さは推測）
export const DRAG = { speed: 1.4, medic: 1.9, len: 1.0, max: 2.6 };

// off: 倒れた体の原点から胴までのずれ（x, z）。interact.js が始めるときに測る
export function startDrag(S, a, b, off, ev) {
  if (a.drag != null) stopDrag(S, a, ev);
  if (b.dragBy != null) { const o = S.byId[b.dragBy]; if (o) stopDrag(S, o, ev); }
  a.drag = b.id; b.dragBy = a.id; a.dragOff = off || [0, 0];
  a.dragPt = [b.x + a.dragOff[0], b.y + 0.3, b.z + a.dragOff[1]];
  a.sprint = false; a.adsOn = false;
  if (ev) ev.push({ e: 'drag', id: a.id, tgt: b.id, on: true });
}
export function stopDrag(S, a, ev) {
  const b = a.drag != null ? S.byId[a.drag] : null;
  if (b && b.dragBy === a.id) b.dragBy = null;
  if (a.drag != null && ev) ev.push({ e: 'drag', id: a.id, tgt: b ? b.id : -1, on: false });
  a.drag = null; a.dragOff = null; a.dragPt = null;
}

const _po = [0, 0, 0];
// 毎ステップ（人を動かしたあと）: 倒れた体を引く
export function stepDrag(S, w, ev) {
  for (const a of S.actors) {
    if (a.drag == null) continue;
    const b = S.byId[a.drag];
    if (!a.alive || a.down || a.dead || !b || !b.alive || !b.down || b.dragBy !== a.id) { stopDrag(S, a, ev); continue; }
    const off = a.dragOff || (a.dragOff = [0, 0]);
    // 体の向き: 頭を引く人の方へ（胸元をつかんで引くので、足は後ろに続く。前は倒れた向きのままで、足が引く人の足もとに
    //  重なって押し返し、引く速さが 2 割落ちていた）。つかんだ所を中心に 1 秒に 3 rad まで回す
    const L = Math.hypot(off[0], off[1]);
    if (L > 0.2) {
      const gx = b.x + off[0], gz = b.z + off[1];
      let d = Math.atan2(a.x - gx, a.z - gz) - Math.atan2(off[0], off[1]);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const lim = 3 * S.dt; d = Math.max(-lim, Math.min(lim, d));
      if (Math.abs(d) > 1e-4) {
        const c = Math.cos(d), sn = Math.sin(d), nx = off[0] * c + off[1] * sn, nz = off[1] * c - off[0] * sn;
        off[0] = nx; off[1] = nz; b.fallYaw = (b.fallYaw || 0) + d;
        b.x = gx - nx; b.z = gz - nz;
      }
    }
    const tx = b.x + off[0], tz = b.z + off[1];
    // 見た目: 引きずる人の左手の行き先（倒れた人の胸元）
    if (!a.dragPt) a.dragPt = [0, 0, 0];
    a.dragPt[0] = tx; a.dragPt[1] = b.y + 0.3; a.dragPt[2] = tz;
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
