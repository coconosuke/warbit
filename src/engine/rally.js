// 集合地点（大規模戦）: 分隊長が分隊ポイント 200 で地面に置く。分隊に1つ（置き直すと前の物は消える）。
// 分隊の人はそこから出撃できる。敵に撃たれると数発で壊れ、手榴弾などの爆発でも壊れる。壊れると 30 秒は置けない（research/WARBIT.md §27。
// 200・分隊に1つ・撃つとすぐ壊れる・壊れると少し置けない は資料の通り。耐える数（100 = 3〜4発）と 30 秒は推測）
export const RALLY = { cost: 200, hp: 100, cool: 30, bullet: 34, r: 0.42, cy: 0.32 };

export const rallyKey = (team, sq) => team + ':' + sq;
export function rallyOf(S, team, sq) { return (S.rallies || []).find(r => r.team === team && r.sq === sq && r.hp > 0) || null; }

// 弾・爆発が当たった。敵の物だけ壊れる
export function hitRally(S, r, dmg, by, ev, x, y, z) {
  if (!r || r.hp <= 0) return;
  const shooter = S.byId[by];
  if (shooter && shooter.team === r.team) return;
  r.hp -= dmg;
  if (ev) ev.push({ e: 'rallyHit', id: r.id, x: x ?? r.x, y: y ?? r.y + RALLY.cy, z: z ?? r.z });
  if (r.hp > 0) return;
  r.hp = 0;
  S.rallies = (S.rallies || []).filter(q => q !== r);
  const m = S.m, cd = m.rallyCd || (m.rallyCd = {});
  cd[rallyKey(r.team, r.sq)] = S.t + Math.round(RALLY.cool / S.dt);
  if (ev) ev.push({ e: 'rally', k: 'gone', id: r.id, team: r.team, sq: r.sq, by, x: r.x, y: r.y, z: r.z });
}

// 爆発の範囲にある集合地点を壊す
export function blastRallies(S, x, y, z, R, by, ev) {
  if (!S.rallies || !S.rallies.length) return;
  for (const r of S.rallies.slice()) if (Math.hypot(r.x - x, r.y + RALLY.cy - y, r.z - z) < Math.max(2.5, R)) hitRally(S, r, 999, by, ev);
}
