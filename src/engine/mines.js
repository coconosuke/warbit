// 対人地雷とクレイモア（大規模戦の副の道具。BattleBit: 全兵科 2 個ずつ。対人地雷 人 400・クレイモア 人 200（線に触れると）。
// research/WARBIT.md の 39・43）。手に持って引き金で足もとの前に置く（拾えない）。置いて 1.5 秒で使えるようになる。
//   対人地雷: 敵が 1m 以内に入ると爆発（半径 4m・2m までは倒れる）
//   クレイモア: 前の 3m・左右 35° に敵が入ると、前へ向けて爆発（前の 70° の扇の中だけ・9m まで）
// 置いた物は 10 分で消える。味方では作動しない。数値は推測（Wiki はダメージの数だけ）
const D = Math.PI / 180;
export const MINE = {
  apmine: { arm: 1.5, r: 1.0, blast: { r: 4, dmg: 400, fall: 2.0 } },
  clay: { arm: 1.5, reach: 3.0, cos: Math.cos(35 * D), blast: { r: 9, dmg: 260, fall: 1.3, cone: Math.cos(35 * D) } },
  life: 600,
};

export function placeMine(S, w, a, id, ev, groundY) {
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const x = a.x + fx * 0.8, z = a.z + fz * 0.8;
  const y = groundY ? groundY(x, z, a.y) : a.y;
  const m = { id: (S.mineN = (S.mineN || 0) + 1), kind: id, team: a.team, by: a.id, x, y, z, yaw: a.yaw, t: S.t, armAt: S.t + Math.round(MINE[id].arm / S.dt) };
  (S.mines || (S.mines = [])).push(m);
  if (ev) ev.push({ e: 'mine', k: 'place', id: m.id, by: a.id, kind: id, x, y, z });
  return m;
}

// 作動を見る（毎ステップ）
export function stepMines(S, ev) {
  const L = S.mines; if (!L || !L.length) return;
  const life = Math.round(MINE.life / S.dt);
  for (let i = L.length - 1; i >= 0; i--) {
    const m = L[i];
    if (S.t - m.t > life) { L.splice(i, 1); continue; }
    if (S.t < m.armAt) continue;
    const P = MINE[m.kind], fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    let hit = !!m.chain;
    if (!hit) for (const b of S.actors) {
      if (!b.alive || b.down || b.isDrone || b.team === m.team || b.dummy) continue;
      const dx = b.x - m.x, dz = b.z - m.z, d = Math.hypot(dx, dz);
      if (Math.abs(b.y - m.y) > 1.4) continue;
      if (m.kind === 'apmine') { if (d < P.r) { hit = true; break; } }
      else if (d < P.reach && d > 0.05 && (dx * fx + dz * fz) / d > P.cos) { hit = true; break; }
    }
    if (!hit) continue;
    L.splice(i, 1);
    const B = P.blast;
    S.blasts.push({ x: m.x + fx * (m.kind === 'clay' ? 0.15 : 0), y: m.y + 0.25, z: m.z + fz * (m.kind === 'clay' ? 0.15 : 0), r: B.r, dmg: B.dmg, fall: B.fall, kind: 'mine', by: m.by, t: 0, dir: m.kind === 'clay' ? [fx, fz] : null, cone: B.cone });
    if (ev) ev.push({ e: 'mine', k: 'boom', id: m.id, kind: m.kind, x: m.x, y: m.y, z: m.z });
  }
}
// 爆発で、まわりの地雷・クレイモアも誘爆する（同じ側の物も）
export function blastMines(S, x, y, z, R) {
  const L = S.mines; if (!L || !L.length) return;
  for (const m of L) if (Math.hypot(m.x - x, m.y - y, m.z - z) < Math.min(3, R * 0.5)) m.armAt = -1, m.chain = true;
}
