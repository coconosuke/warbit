// 投げ物と爆発: 閃光・スティンガー・CSガス・罠（破片）・C2・壁用の爆破薬。ガスの雲。
import { raycast, los, CS, LH, levelOfY, NB } from './world.js';
import { hrand } from './rng.js';
import { eyeOf, hurt, killActor, pvpDamage, damageBlock, breakGlass, downActor, breakCamAt, capsOf } from './combat.js';
import { rayCapsule } from './pose.js';
import { M, MATS } from './data/materials.js';
import { blastBars } from './barricade.js';
import { blastDeps } from './deploy.js';
import { blastRallies } from './rally.js';
import { GEAR } from './data/equipment.js';
import { carve } from '../war/destruct.js';
import { blastMines } from './mines.js';

const _rc = { out: [], seenProp: new Set(), seenDoor: new Set() };

export function throwNade(S, a, type, power, ev) {
  const eye = eyeOf(S, a);
  // 大規模戦は遠くまで投げる（M67 は約35m。research/WARBIT.md の 6）
  const pw = Math.max(0.15, Math.min(1, power)), cp = Math.cos(a.pitch + 0.12), v = S.war ? 6 + 12 * pw : 4 + 9 * pw;
  const dx = Math.sin(a.yaw) * cp, dy = Math.sin(a.pitch + 0.12), dz = Math.cos(a.yaw) * cp;
  const G = GEAR[type] || {};
  const n = { id: S.nextItem++, type, x: eye[0] + dx * 0.3, y: eye[1] - 0.1, z: eye[2] + dz * 0.3, vx: dx * v + a.vx * 0.5, vy: dy * v + 1.2, vz: dz * v + a.vz * 0.5, t: 0, fuse: G.fuse ?? (type === 'cs' ? 1.6 : 1.5), impact: !!G.impact, by: a.id, team: a.team, rest: false };
  S.nades.push(n);
  a.throwT = 1;
  ev.push({ e: 'throw', id: a.id, type, n: n.id });
  return n;
}
// M320 の弾: まっすぐ速く飛び、当たったら作動
export function launchNade(S, a, type, ev) {
  const eye = eyeOf(S, a);
  const cp = Math.cos(a.pitch), v = 55;
  const dx = Math.sin(a.yaw) * cp, dy = Math.sin(a.pitch), dz = Math.cos(a.yaw) * cp;
  S.nades.push({ id: S.nextItem++, type, x: eye[0] + dx * 0.5, y: eye[1] - 0.05, z: eye[2] + dz * 0.5, vx: dx * v, vy: dy * v + 1.5, vz: dz * v, t: 0, fuse: 9, impact: true, by: a.id, team: a.team });
  ev.push({ e: 'launch', id: a.id, type });
}

// RPG-7 のロケット（大規模戦の工兵。research/WARBIT.md の 37）: 出てすぐ 120m/s、0.4 秒で 190m/s まで加速。重力は 0.45 倍（遠いほど落ちる。
//  200m で約 2.5m 下がる）。腰だめは 1.2°・構えると 0.3° ばらつく。人か物に当たると爆発（HEAT: 半径 7m、近いほど強い。3m までは倒れる）。
//  撃った人には 0.3 秒は当たらない。5 秒（約 900m）で自爆。数値は推測（資料は「HEAT は人も建物も倒す」「200m より遠いと当てにくい」）
export const ROCKET = { v0: 120, v1: 190, acc: 0.4, g: 0.45, hip: 1.2, ads: 0.3, life: 5, r: 7, dmg: 420, fall: 1.8, arm: 0.3 };
export function launchRocket(S, a, ev) {
  const eye = eyeOf(S, a);
  const sp = (a.ads > 0.8 ? ROCKET.ads : ROCKET.hip) * Math.PI / 180, k = (S.rocketN = (S.rocketN || 0) + 1);
  const yaw = a.yaw + (hrand(a.id, k, 1) - 0.5) * 2 * sp, pitch = a.pitch + (hrand(a.id, k, 2) - 0.5) * 2 * sp;
  const cp = Math.cos(pitch), dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
  // 照準の線の上から出る（筒は目の右下にあるが、狙った所へまっすぐ行くように）
  const n = { id: S.nextItem++, type: 'rpg', rocket: true, x: eye[0] + dx * 0.9, y: eye[1] + dy * 0.9 - 0.02, z: eye[2] + dz * 0.9, vx: dx * ROCKET.v0, vy: dy * ROCKET.v0, vz: dz * ROCKET.v0, t: 0, fuse: ROCKET.life, impact: true, by: a.id, team: a.team };
  S.nades.push(n);
  ev.push({ e: 'launch', id: a.id, type: 'rpg', n: n.id });
  return n;
}
// ロケットの線分が人に当たるか（体の形の筒）。当たった距離（なければ -1）
function rocketHitsActor(S, n, dx, dy, dz, L) {
  let best = -1;
  for (const a of S.actors) {
    if (!a.alive || a.isDrone) continue;
    if (a.id === n.by && n.t < ROCKET.arm) continue;
    const ox = a.x - n.x, oy = a.y + 0.9 - n.y, oz = a.z - n.z, tc = ox * dx + oy * dy + oz * dz;
    if (tc < -1.5 || tc > L + 1.5 || ox * ox + oy * oy + oz * oz - tc * tc > 2.6) continue;
    // 弾頭の太さ（半径 4cm）と、かすっても信管が働く分を足す
    for (const c of capsOf(S, a)) { const t = rayCapsule(n.x, n.y, n.z, dx, dy, dz, L, c.a, c.b, c.r + 0.07); if (t >= 0 && (best < 0 || t < best)) best = t; }
  }
  return best;
}

export function stepNades(S, w, dt, ev) {
  for (let i = S.nades.length - 1; i >= 0; i--) {
    const n = S.nades[i];
    n.t += dt;
    if (n.rocket) {
      // 加速（向きはそのまま）
      const s0 = Math.hypot(n.vx, n.vy, n.vz), want = n.t < ROCKET.acc ? ROCKET.v0 + (ROCKET.v1 - ROCKET.v0) * n.t / ROCKET.acc : ROCKET.v1;
      if (s0 > 1 && want > s0) { const f = want / s0; n.vx *= f; n.vy *= f; n.vz *= f; }
      n.vy -= 9.81 * ROCKET.g * dt;
      const sp = Math.hypot(n.vx, n.vy, n.vz), L = sp * dt, dx = n.vx / sp, dy = n.vy / sp, dz = n.vz / sp;
      let tHit = -1;
      for (const x of raycast(w, n.x, n.y, n.z, dx, dy, dz, L + 0.06, S.doors, _rc)) { if (x.mat === M.GLASSBROKEN) continue; if (x.mat === M.GLASS) { breakGlass(S, w, x, ev); continue; } tHit = x.t0; break; }
      const tA = rocketHitsActor(S, n, dx, dy, dz, L);
      if (tA >= 0 && (tHit < 0 || tA < tHit)) tHit = tA;
      if (tHit >= 0 && tHit <= L + 0.06) { const t = Math.max(0, tHit - 0.05); n.x += dx * t; n.y += dy * t; n.z += dz * t; n.t = n.fuse; }
      else { n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt; }
      if (n.t >= n.fuse) { detonate(S, w, n, ev); S.nades.splice(i, 1); }
      continue;
    }
    if (!n.rest) {
      n.vy -= 9.81 * dt;
      const sp = Math.hypot(n.vx, n.vy, n.vz);
      if (sp > 0.05) {
        const L = sp * dt, dx = n.vx / sp, dy = n.vy / sp, dz = n.vz / sp;
        const hits = raycast(w, n.x, n.y, n.z, dx, dy, dz, L + 0.06, S.doors, _rc);
        let h = null;
        for (const x of hits) { const m = MATS[x.mat]; if (x.mat === M.GLASSBROKEN) continue; if (x.mat === M.GLASS) { breakGlass(S, w, x, ev); continue; } h = x; break; }
        if (h) {
          const t = Math.max(0, h.t0 - 0.06);
          n.x += dx * t; n.y += dy * t; n.z += dz * t;
          if (n.impact) { n.t = n.fuse; }
          // C4: 当たった面に貼りつく（面の向きを覚える。描く時に向きをそろえる）
          else if (n.sticky) { n.x -= dx * 0.02; n.y -= dy * 0.02; n.z -= dz * 0.02; n.vx = n.vy = n.vz = 0; n.rest = true; n.stuck = true; n.nx = h.nx || 0; n.ny = h.ny ?? 1; n.nz = h.nz || 0; ev.push({ e: 'stick', n: n.id, x: n.x, y: n.y, z: n.z }); }
          else {
            // 跳ね返り
            const nx = h.nx || 0, ny = h.ny || 0, nz = h.nz || 0;
            const vd = n.vx * nx + n.vy * ny + n.vz * nz;
            n.vx -= 1.6 * vd * nx; n.vy -= 1.6 * vd * ny; n.vz -= 1.6 * vd * nz;
            n.vx *= 0.45; n.vy *= 0.45; n.vz *= 0.45;
            if (ny > 0.6 && Math.abs(n.vy) < 1.2) { n.vy = 0; n.vx *= 0.6; n.vz *= 0.6; if (Math.hypot(n.vx, n.vz) < 0.3) n.rest = true; }
            ev.push({ e: 'bounce', n: n.id, x: n.x, y: n.y, z: n.z, v: sp });
          }
        } else { n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt; }
      }
    }
    if (n.t >= n.fuse) { detonate(S, w, n, ev); S.nades.splice(i, 1); }
  }
}

function detonate(S, w, n, ev) {
  const by = S.byId[n.by];
  ev.push({ e: 'nade', type: n.type, x: n.x, y: n.y, z: n.z, by: n.by });
  if (n.type === 'flash') {
    for (const a of S.actors) {
      if (!a.alive || a.isDrone) continue;
      const eye = eyeOf(S, a);
      const dx = n.x - eye[0], dy = n.y - eye[1], dz = n.z - eye[2], d = Math.hypot(dx, dy, dz);
      if (d > 12) continue;
      const see = los(w, eye[0], eye[1], eye[2], n.x, n.y + 0.05, n.z, S.doors);
      // 見ている向き
      const cp = Math.cos(a.pitch), fx = Math.sin(a.yaw) * cp, fy = Math.sin(a.pitch), fz = Math.cos(a.yaw) * cp;
      const facing = (dx * fx + dy * fy + dz * fz) / Math.max(0.01, d);
      let k = (1 - d / 12) * (see ? (facing > 0.3 ? 1 : facing > -0.3 ? 0.65 : 0.35) : (d < 3 ? 0.25 : 0));
      if (a.armor && a.armor.head === 'goggles') k *= 0.4;
      if (k <= 0.02) { if (d < 8) a.deaf = Math.max(a.deaf, 1.5); continue; }
      a.flash = Math.max(a.flash, 0.8 + 4.5 * k);
      a.deaf = Math.max(a.deaf, 2 + 4 * k);
      if (a.ai) { a.stun = Math.max(a.stun, 1.5 + 4 * k); if (a.ai.morale != null) a.ai.morale -= 0.4 * k + 0.1; }
      ev.push({ e: 'flashed', id: a.id, k });
    }
  } else if (n.type === 'stinger') {
    for (const a of S.actors) {
      if (!a.alive || a.isDrone) continue;
      const d = Math.hypot(a.x - n.x, a.y + 1 - n.y, a.z - n.z);
      if (d > 5.5) continue;
      if (!los(w, n.x, n.y + 0.1, n.z, a.x, a.y + 1.0, a.z, S.doors)) continue;
      const k = 1 - d / 5.5;
      a.stun = Math.max(a.stun, (a.ai ? 1.5 : 0.6) + 2.5 * k);
      a.deaf = Math.max(a.deaf, 1.5);
      if (a.ai && a.ai.morale != null) a.ai.morale -= 0.25 + 0.25 * k;
      const dmg = 3 + 7 * k;
      if (S.pvp) pvpDamage(S, a, dmg, by, 'chest', a.x - n.x, a.z - n.z, ev, 'stinger');
      else hurt(S, w, a, dmg, 'chest', by, null, a.x - n.x, a.z - n.z, ev, 'less');
      ev.push({ e: 'stung', id: a.id, k });
      if (by && !S.pvp) S.harms.push({ t: S.t, by: by.id, tgt: a.id, how: 'less', d: dmg, part: 'chest', kind: a.kind, threat: a.ai ? (S.t - (a.ai.threatT ?? -1e9)) * S.dt < 2 : false, warned: a.ai ? a.ai.warned || 0 : 0, armed: !!(a.inv.w[0] || a.inv.w[1]), comply: a.comply, cuffed: a.cuffed, down: a.down });
    }
  } else if (n.type === 'cs') {
    S.clouds.push({ x: n.x, y: n.y, z: n.z, r: 0.5, max: 4.6, t: 20, type: 'cs', L: levelOfY(n.y) });
  } else if (n.type === 'smoke') {
    // 煙: 床から立ちのぼって半径 3.2m の玉になる（目の高さを覆うよう、中心は床から 1.1m）
    // 大規模戦（屋外）: 半径 6.5m・30 秒（BattleBit の発煙弾は大きく濃い。research の 21）
    if (S.war) S.clouds.push({ x: n.x, y: n.y + 1.6, z: n.z, r: 0.6, max: 6.5, t: 30, type: 'smoke', L: levelOfY(n.y) });
    else S.clouds.push({ x: n.x, y: n.y + 1.1, z: n.z, r: 0.4, max: 3.2, t: 16, type: 'smoke', L: levelOfY(n.y) });
  } else if (n.type === 'frag') {
    // 大規模戦の M67: 5m でほぼ致命、15m まで（research/WARBIT.md の 6）。今までのモードの罠は 5m
    if (S.war) S.blasts.push({ x: n.x, y: n.y + 0.2, z: n.z, r: 15, dmg: 250, fall: 2.2, kind: 'frag', by: n.by, t: 0 });
    else S.blasts.push({ x: n.x, y: n.y + 0.2, z: n.z, r: 5, dmg: 150, kind: 'frag', by: n.by, t: 0 });
  } else if (n.type === 'impact') {
    S.blasts.push({ x: n.x, y: n.y + 0.2, z: n.z, r: 8, dmg: 170, fall: 1.9, kind: 'frag', by: n.by, t: 0 });
  } else if (n.type === 'rpg') {
    S.blasts.push({ x: n.x, y: n.y + 0.1, z: n.z, r: ROCKET.r, dmg: ROCKET.dmg, fall: ROCKET.fall, kind: 'rpg', by: n.by, t: 0 });
  } else if (n.type === 'c4') {
    const C = GEAR.c4;
    S.blasts.push({ x: n.x, y: n.y + 0.05, z: n.z, r: C.r, dmg: C.dmg, fall: C.fall, kind: 'c4', by: n.by, t: 0 });
  }
}

// 煙がさえぎる度合い（0..1）: 2点の間の線が煙の玉の中を通るか（中心に近いほど濃い）
export function smokeBetween(S, ax, ay, az, bx, by, bz) {
  const cl = S.clouds; if (!cl || !cl.length) return 0;
  let best = 0;
  const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
  for (const c of cl) {
    if (c.type !== 'smoke' || c.r < 0.8) continue;
    let t = L2 > 1e-6 ? ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - c.x, py = ay + dy * t - c.y, pz = az + dz * t - c.z;
    const d = Math.hypot(px, py * 1.4, pz), R = c.r * 0.92;
    if (d >= R) continue;
    const k = Math.min(1, (R - d) / Math.max(0.3, R * 0.35));
    if (k > best) best = k;
    if (best >= 1) break;
  }
  return best;
}
// ガスの雲: 広がって薄れる。中の人（マスクなし）に効く
export function stepClouds(S, w, dt, ev) {
  for (let i = S.clouds.length - 1; i >= 0; i--) {
    const c = S.clouds[i];
    c.t -= dt;
    c.r = Math.min(c.max, c.r + dt * 1.6);
    if (c.t <= 0) { S.clouds.splice(i, 1); continue; }
    if (c.type === 'smoke') { if (c.t < 3) c.r = Math.max(0.1, c.max * c.t / 3); continue; } // 煙は害がない（終わりは薄れて縮む）
    if (S.t % 6 !== 0) continue;
    for (const a of S.actors) {
      if (!a.alive || a.isDrone) continue;
      const d = Math.hypot(a.x - c.x, (a.y + 1.4) - c.y, a.z - c.z);
      if (d > c.r) continue;
      if (a.armor && a.armor.head === 'gasmask') continue;
      // 壁の向こうには届かない
      if (!los(w, c.x, c.y + 0.2, c.z, a.x, a.y + 1.4, a.z, S.doors)) continue;
      const k = c.type === 'pepper' ? 0.6 : 1;
      a.gas = Math.max(a.gas, 4 * k);
      if (a.ai) { if (a.ai.morale != null) a.ai.morale -= 0.05 * k; a.ai.gasCough = 1; }
    }
  }
}

// 爆発（罠・C2・壁の爆破薬）: 見通しのある人にダメージ、石膏の壁を壊す
export function stepBlasts(S, w, dt, ev) {
  for (let i = S.blasts.length - 1; i >= 0; i--) {
    const b = S.blasts[i];
    b.t -= dt;
    if (b.t > 0) continue;
    S.blasts.splice(i, 1);
    const by = S.byId[b.by];
    if (b.kind !== 'c2') ev.push({ e: 'boom', x: b.x, y: b.y, z: b.z, kind: b.kind, r: b.r });
    for (const a of S.actors) {
      if (!a.alive) continue;
      if (b.only != null && a.id !== b.only) continue;
      const d = Math.hypot(a.x - b.x, a.y + 0.9 - b.y, a.z - b.z);
      if (d > b.r) continue;
      // クレイモア: 前の扇の中だけ
      if (b.dir) { const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz); if (l > 0.4 && (dx * b.dir[0] + dz * b.dir[1]) / l < b.cone) continue; }
      if (!los(w, b.x, b.y, b.z, a.x, a.y + 0.9, a.z, S.doors) && !los(w, b.x, b.y, b.z, a.x, a.y + 1.6, a.z, S.doors)) continue;
      const k = Math.pow(1 - d / b.r, b.fall || 1.3);
      const dmg = b.dmg * k;
      a.stun = Math.max(a.stun, 1.5 * k + 0.5); a.deaf = Math.max(a.deaf, 4);
      if (S.pvp) pvpDamage(S, a, dmg, by, 'chest', a.x - b.x, a.z - b.z, ev, 'blast');
      else {
        let dd = dmg;
        if (a.armor && a.armor.vest !== 'none') dd *= 0.75;
        if (a.kind === 'swat' && a.pid != null && by && by.kind === 'sus') dd = Math.min(dd, 95);
        hurt(S, w, a, dd, 'chest', by, null, a.x - b.x, a.z - b.z, ev, 'blast');
        if (by) S.harms.push({ t: S.t, by: by.id, tgt: a.id, how: 'blast', d: dd, part: 'chest', kind: a.kind, threat: a.ai ? (S.t - (a.ai.threatT ?? -1e9)) * S.dt < 2 : false, warned: a.ai ? a.ai.warned || 0 : 0, armed: !!(a.inv.w[0] || a.inv.w[1]), comply: a.comply, cuffed: a.cuffed, down: a.down });
      }
      if (a.ai && a.ai.morale != null) a.ai.morale -= 0.4 * k;
    }
    // 監視カメラ: 2m 以内は壊れる
    if (S.cams && w._cams) for (let ci = 0; ci < S.cams.length; ci++) { const K = w._cams[ci]; if (K && S.cams[ci].ok && Math.hypot(K.x - b.x, K.y - b.y, K.z - b.z) < 2.0) breakCamAt(S, ci, b.by ?? -1, ev, K.x, K.y, K.z); }
    // バリケード: 爆発のまわりの板を吹き飛ばす（破片・罠 1.7m、C2 2.4m、壁の爆破薬 2.0m）
    blastBars(S, w, b.x, b.y, b.z, b.kind === 'c2' ? 2.4 : b.kind === 'frame' ? 2.0 : 1.7, ev, b.by ?? -1);
    // 置ける盾・有刺鉄線も吹き飛ぶ
    blastDeps(S, w, b.x, b.y, b.z, b.kind === 'c2' ? 2.4 : b.kind === 'frame' ? 2.0 : 1.7, ev, b.by ?? -1);
    // 集合地点（大規模戦）
    blastRallies(S, b.x, b.y, b.z, (b.r || 4) * 0.6, b.by ?? -1, ev);
    // 地雷・クレイモアの誘爆
    blastMines(S, b.x, b.y, b.z, b.r || 4);
    // 大規模戦: RPG（HEAT）は壁と床に穴を開ける（war/destruct.js）。描く側は 'carve' の出来事で塊を作り直す
    if (w.war && (b.kind === 'rpg' || b.kind === 'c4')) {
      // C4 はコンクリートも 1 回で、穴も大きい（2m）
      const c4 = b.kind === 'c4', R = c4 ? 1.0 : 1.3, o = c4 ? { force: true, w: GEAR.c4.hole, h: GEAR.c4.hole, floor: GEAR.c4.hole } : {};
      const ks = carve(w, b.x, b.y, b.z, R, o);
      if (ks.length) { (S.carves || (S.carves = [])).push([b.x, b.y, b.z, R, c4 ? 2 : 0]); w._carveN = (w._carveN || 0) + 1; ev.push({ e: 'carve', x: b.x, y: b.y, z: b.z, r: R, ks, cn: w._carveN, o }); }
    }
    // 壁（石膏・木）を壊す
    if (!w.war && (b.kind === 'c2' || b.kind === 'frame' || b.kind === 'frag')) {
      const R = b.kind === 'frame' ? 1.4 : b.kind === 'c2' ? 0.9 : 0.6;
      const L = levelOfY(b.y - 1);
      for (let j = Math.floor((b.z - R) / CS); j <= Math.floor((b.z + R) / CS); j++) for (let ii = Math.floor((b.x - R) / CS); ii <= Math.floor((b.x + R) / CS); ii++) {
        if (ii < 0 || j < 0 || ii >= w.W || j >= w.D) continue;
        const k = w.idx(L, ii, j);
        for (let q = 0; q < NB; q++) {
          const y = L * LH + q * 0.7 + 0.35;
          const d = Math.hypot((ii + 0.5) * CS - b.x, y - b.y, (j + 0.5) * CS - b.z);
          if (d > R + 0.35) continue;
          if (b.kind === 'frame' && S.reinf && S.reinf[k]) { S.reinf[k] = 0; }
          damageBlock(S, w, k, q, b.kind === 'frame' ? 999 : b.kind === 'c2' ? 160 : 60, ev);
          if (w.blocks[k * NB + q] === M.GLASS) breakGlass(S, w, { k, q }, ev);
        }
      }
    }
  }
}
