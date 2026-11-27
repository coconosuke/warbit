// ボットの人間らしさの点検: node tools/aiaudit.mjs [秒 300] [small|medium|large] [種 3]
//  棒立ち（遮蔽物・守りの場所・戦い・作業のどれでもなく 4 秒より長く止まる）・味方との近さ・伏せ/しゃがみ/走り・
//  撃った弾のうち動きながら/遮蔽物から/構えて・手榴弾・蘇生・キル・味方のキル
const secs = +(process.argv[2] || 300), size = process.argv[3] || 'medium', seed = +(process.argv[4] || 3);
const { createGame, step } = await import('../src/engine/engine.js');
const G = createGame({ map: 'riverbend', mode: 'war', size, seed, roster: [] });
const S = G.S, w = G.w;
const still = new Map(); // id → {x,z,t}
let pistol = 0, dry = 0, toBox = 0, boxes = 0;
let samples = 0, idleOpen = 0, idleLong = 0, crowd = 0, nnSum = 0, nnN = 0, shots = 0, shotsMove = 0, shotsCover = 0, shotsADS = 0, prone = 0, crouch = 0, sprint = 0, fighting = 0, nades = 0, revives = 0, kills = 0, tk = 0;
const lastFire = new Map();
for (let i = 0; i < 60 * secs; i++) {
  const ev = step(G, {});
  for (const e of ev) {
    if (e.e === 'ammoBox' && e.k === 'place') boxes++;
    if (e.e === 'shot' || e.e === 'fire') { const a = S.byId[e.id]; if (a && a.ai) { shots++; const v = Math.hypot(a.vx, a.vz); if (v > 1) shotsMove++; if (a.ai.cov && Math.hypot(a.ai.cov.x - a.x, a.ai.cov.z - a.z) < 1.2) shotsCover++; if (a.ads > 0.5) shotsADS++; } }
    if (e.e === 'nade' || e.e === 'throw') nades++;
    if (e.e === 'revive' || e.e === 'revived') revives++;
    if (e.e === 'kill') { kills++; const k = S.byId[e.by], v = S.byId[e.id]; if (k && v && k.team === v.team && k !== v) tk++; }
  }
  if (i % 30) continue;
  const live = S.actors.filter(a => a.ai && a.alive && !a.down);
  for (const a of live) {
    samples++;
    const v = Math.hypot(a.vx, a.vz);
    if (a.st > 1.5) prone++; else if (a.st > 0.5) crouch++;
    if (a.ws.slot === 1) pistol++;
    if (a.ai.boxGo != null) toBox++;
    { const t = (wi) => !wi ? 0 : wi.mag + (wi.ch || 0) + (wi.mags ? wi.mags.reduce((x, y) => x + y, 0) : wi.res || 0); if (t(a.inv.w[0]) + t(a.inv.w[1]) === 0) dry++; }
    if (a.sprint) sprint++;
    if (a.ai.tgt != null) fighting++;
    // 近い味方
    let nn = 1e9; for (const b of live) if (b !== a && b.team === a.team) nn = Math.min(nn, Math.hypot(b.x - a.x, b.z - a.z));
    if (nn < 1e9) { nnSum += Math.min(nn, 60); nnN++; if (nn < 1.5) crowd++; }
    // 棒立ち: 4 秒で 0.5m も動かず、遮蔽物・守りの場所・蘇生・戦いのどれでもない
    const s = still.get(a.id);
    if (!s || Math.hypot(s.x - a.x, s.z - a.z) > 0.5) still.set(a.id, { x: a.x, z: a.z, t: i });
    else if (i - s.t > 60 * 4) {
      const inCov = a.ai.cov && Math.hypot(a.ai.cov.x - a.x, a.ai.cov.z - a.z) < 1.2;
      const holding = a.ai.hold && Math.hypot(a.ai.hold.x - a.x, a.ai.hold.z - a.z) < 1.2;
      if (!inCov && !holding && a.ai.tgt == null && !a.act) { idleOpen++; if (i - s.t > 60 * 10) idleLong++; }
    }
  }
}
const pc = (n, d = samples) => (100 * n / Math.max(1, d)).toFixed(1) + '%';
console.log(`${secs}s ${size} seed ${seed}: idleOpen ${pc(idleOpen)} (>10s ${pc(idleLong)}) crowd<1.5m ${pc(crowd, nnN)} nnAvg ${(nnSum / nnN).toFixed(1)}m prone ${pc(prone)} crouch ${pc(crouch)} sprint ${pc(sprint)} fighting ${pc(fighting)} | shots ${shots} moving ${pc(shotsMove, shots)} cover ${pc(shotsCover, shots)} ads ${pc(shotsADS, shots)} | nades ${nades} revives ${revives} kills ${kills} tk ${tk} | pistol ${pc(pistol)} dry ${pc(dry)} toBox ${pc(toBox)} boxesPlaced ${boxes}`);
