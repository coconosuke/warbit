// 大規模戦のボット（2: 11-13 の作り直し。research/WARBIT.md の 15）
// 分隊: 目標の拠点へ、2人組ごとに少しずつ違う道で進む（ときどき横へ回り込む道）。仲間と 3m より近づかない。
// 撃ち合い: 見えた敵へ、近くの遮蔽物の後ろへ移りながら撃つ。遮蔽物の後ろでは「のぞいて撃つ・隠れる」をくり返す
//   （低い物は立って撃ちしゃがんで隠れる、高い物は横へ身を出す）。近い（18m まで）ときは横に動きながら撃つ。遠い（55m〜）と伏せる。
//   撃たれたら遮蔽物へ。隠れている間に弾を込める。
// 見失ったら: 最後に見た所を見張る・隠れた敵へ手榴弾・組の片方が横から回り込む。分隊で見つけた敵を分け合う（BattleBit の印のように）。
// 倒れた仲間を起こす（近くに敵が見えないとき。衛生兵と近い者が先）。体力が減ったら隠れて包帯。
// 拠点: 中の遮蔽物の後ろに散って、敵の来る方を見張る（ときどき場所を変える）。
// 茂みと麦畑の伏せは見つけにくい。考える重い処理（見る・道・遮蔽物探し）は数ステップに1回、交代で。
// 建物（11-27）: 中の道（inav.js）と出入り口で外の道とつなぐ。拠点の近くの建物の窓から見張る・中で撃ち合う時は窓を遮蔽物に・
//   建物の中に隠れた敵は中へ入って探す。
import { baseInput, pushAct, steerToward, turnToward, trigger, SKILL, angDiff, yawTo } from '../engine/ai/common.js';
import { eyeAI } from '../engine/combat.js';
import { curW, curWeapon, ammoCount } from '../engine/actor.js';
import { los as wLos, heightAt, ceilAt, groundAt, pushOut } from './world.js';
import { buildWarNav, findWarPath, navCellOf, navCenter, NS } from './nav.js';
import { bldOf, bldNav, navStep, navReady, cellOf, findInPath } from './inav.js';
import { hrand } from '../engine/rng.js';
import { smokeBetween, ROCKET } from '../engine/nades.js';

export const SQUAD = 8;           // 分隊の人数（BattleBit: research/WARBIT.md の 3）
const SCAN_EVERY = 6;             // 見回す間隔（ステップ）
const G = 9.81;
// 武器の種類ごとの交戦距離 [近い, ちょうどよい, 遠い]（BattleBit の大型アップデートの目安: SMG 0-35・AR 35-70・DMR/狙撃 100-300+）
const RANGE = { smg: [0, 40, 110], pistol: [0, 25, 70], shotgun: [0, 15, 40], rifle: [0, 70, 220], lmg: [0, 70, 240], dmr: [20, 120, 320], sniper: [40, 220, 500] };
const SEC = (S, s) => Math.round(s / S.dt);

function rangeOf(a) { const W = curW(a); return RANGE[W ? W.cat : 'rifle'] || RANGE.rifle; }
const flagById = (S, id) => S.m.flags.find(f => f.id === id);
// 目標（拠点、TDM は場所）。TDM は分隊を4人ずつの組に分けて別々に動く
const goalKey = (S, a) => S.m.mode === 'tdm' ? a.team + ':' + a.squad + ':' + ((a.sqIdx || 0) >> 2) : a.team + ':' + a.squad;
export function goalOf(S, a) {
  const g = S.m.sqGoal && S.m.sqGoal[goalKey(S, a)];
  return typeof g === 'string' ? flagById(S, g) : g || null;
}

// ---- 指揮: チームごとに分隊へ目標の拠点を割り当てる（2秒ごと）
export function command(S, w) {
  const m = S.m;
  if (m.mode === 'tdm') return commandTdm(S);
  for (let t = 0; t < 2; t++) {
    const hq = m.hq[t];
    const squads = new Map();
    for (const a of S.actors) if (a.team === t && a.squad != null) { if (!squads.has(a.squad)) squads.set(a.squad, []); squads.get(a.squad).push(a); }
    // 取りに行く拠点（自分の物でない）と、守る拠点（自分の物で敵が来ている）
    const near = (f, team) => S.actors.some(b => b.team === team && b.alive && !b.down && Math.hypot(b.x - f.x, b.z - f.z) < f.r * 2.2);
    const attack = m.flags.filter(f => f.owner !== t).map(f => ({ f, d: Math.hypot(f.x - hq[0], f.z - hq[1]) })).sort((p, q) => p.d - q.d).map(p => p.f);
    const defend = m.flags.filter(f => f.owner === t && near(f, 1 - t));
    const want = defend.concat(attack.slice(0, Math.max(1, Math.ceil(squads.size * 0.6))));
    if (!want.length) want.push(...m.flags);
    let k = 0;
    const ids = [...squads.keys()].sort((p, q) => p - q);
    m.sqGoal = m.sqGoal || {};
    for (const sq of ids) {
      const key = t + ':' + sq, cur = m.sqGoal[key];
      // 分隊長（人）が決めた目標はそのまま（攻める目標は奪い終えると解ける）
      const od = m.sqOrder && m.sqOrder[key];
      if (od && flagById(S, od.f)) { m.sqGoal[key] = od.f; continue; }
      const curF = cur && flagById(S, cur);
      // 今の目標がまだ要る（取れていない・守る必要がある）なら続ける
      if (curF && want.includes(curF) && !(curF.owner === t && !defend.includes(curF))) continue;
      m.sqGoal[key] = want[k++ % want.length].id;
    }
  }
}

// TDM: 組ごとに、いちばん近い敵のあたり（少しずらす）へ。着いたか 10 秒で選び直す
function commandTdm(S) {
  const m = S.m, R = m.rect;
  const groups = new Map();
  for (const a of S.actors) if (a.team >= 0 && a.team < 2 && a.squad != null && a.alive && !a.down) { const k = goalKey(S, a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  m.sqGoal = m.sqGoal || {};
  for (const [key, mem] of groups) {
    const cur = m.sqGoal[key];
    if (cur && S.t < cur.until && !mem.some(a => Math.hypot(a.x - cur.x, a.z - cur.z) < cur.r)) continue;
    const t = mem[0].team;
    let cx = 0, cz = 0; for (const a of mem) { cx += a.x; cz += a.z; } cx /= mem.length; cz /= mem.length;
    let best = null, bd = 1e9;
    for (const e of S.actors) if (e.team === 1 - t && e.alive && !e.down) { const d = Math.hypot(e.x - cx, e.z - cz); if (d < bd) { bd = d; best = e; } }
    const n = key.length * 7 + S.t;
    let x = best ? best.x + (hrand(S.seed, n, 91) - 0.5) * 40 : R[0] + (R[2] - R[0]) * hrand(S.seed, n, 92);
    let z = best ? best.z + (hrand(S.seed, n, 93) - 0.5) * 40 : R[1] + (R[3] - R[1]) * hrand(S.seed, n, 94);
    x = Math.max(R[0] + 8, Math.min(R[2] - 8, x)); z = Math.max(R[1] + 8, Math.min(R[3] - 8, z));
    m.sqGoal[key] = { id: 'pt' + S.t + key, x, z, r: 12, until: S.t + 600 };
  }
}

// 出撃する場所（ボット。コンクエストだけ）: 分隊の目標に一番近い、自分の持っている拠点（敵が近くにいない）。なければ本陣
export function botSpawnPoint(S, a) {
  const m = S.m;
  if (m.mode !== 'conquest') return null;
  const goal = m.sqGoal && flagById(S, m.sqGoal[a.team + ':' + a.squad]);
  let best = null, bd = 1e9;
  for (const f of m.flags) {
    if (f.owner !== a.team || f.contested) continue;
    const d = goal ? Math.hypot(f.x - goal.x, f.z - goal.z) : 0;
    if (d < bd) { bd = d; best = f; }
  }
  const [hx, hz] = m.hq[a.team];
  if (best && goal && bd < Math.hypot(hx - goal.x, hz - goal.z)) return { flag: best.id };
  return null;
}

// ---- 遮蔽物の表（道の格子と同じ 2m のマス）: マスの中の一番高い物の、地面からの高さ（0.1m 単位）と、茂み
function coverOf(w, nav) {
  if (nav.cover) return nav.cover;
  const { W, D } = nav, H = new Uint8Array(W * D), bush = new Uint8Array(W * D);
  const put = (x0, z0, x1, z1, h) => {
    const i0 = Math.max(0, Math.floor(x0 / NS)), i1 = Math.min(W - 1, Math.floor(x1 / NS)), j0 = Math.max(0, Math.floor(z0 / NS)), j1 = Math.min(D - 1, Math.floor(z1 / NS));
    const v = Math.max(0, Math.min(255, Math.round(h * 10)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (H[j * W + i] < v) H[j * W + i] = v;
  };
  for (const b of w.boxes) {
    if (!b.alive || b.hide && b.kind !== 'wall') continue;
    const g = heightAt(w, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    if (b.y0 > g + 0.6) continue; // 地面から離れた物（屋根・窓の上）
    const h = b.y1 - g;
    if (h < 0.5) continue;
    // 細い柱・柵の横木は遮蔽物にしない
    if (Math.min(b.x1 - b.x0, b.z1 - b.z0) < 0.12 && Math.max(b.x1 - b.x0, b.z1 - b.z0) < 0.5) continue;
    put(b.x0, b.z0, b.x1, b.z1, Math.min(3, h));
  }
  for (const c of w.cyls) if (c.alive && c.r > 0.15) put(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, Math.min(3, c.y1 - heightAt(w, c.x, c.z)));
  for (const b of w.bushes || []) {
    const i0 = Math.max(0, Math.floor((b.x - b.r * 0.8) / NS)), i1 = Math.min(W - 1, Math.floor((b.x + b.r * 0.8) / NS)), j0 = Math.max(0, Math.floor((b.z - b.r * 0.8) / NS)), j1 = Math.min(D - 1, Math.floor((b.z + b.r * 0.8) / NS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bush[j * W + i] = Math.max(bush[j * W + i], Math.min(255, Math.round(b.h * 10)));
  }
  // 地形の段（壕の縁・土手）: となりのマスの地面が 0.8m 以上高いと、その向きの遮蔽物
  const gh = new Float32Array(W * D);
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) gh[j * W + i] = heightAt(w, (i + 0.5) * NS, (j + 0.5) * NS);
  nav.cover = { H, bush, gh };
  return nav.cover;
}
// マス k から敵（tx, tz）の向きの遮蔽物: 0 なし・1 低い（しゃがむと隠れる・立つと撃てる）・2 高い（立っても隠れる。横へ身を出して撃つ）
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function coverAgainst(nav, cv, k, tx, tz) {
  const W = nav.W, i = k % W, j = (k - i) / W, cx = (i + 0.5) * NS, cz = (j + 0.5) * NS;
  const ang = Math.atan2(tz - cz, tx - cx), o = Math.round(ang / (Math.PI / 4)) & 7;
  let best = 0;
  for (const s of [0, -1, 1]) {
    const [di, dj] = DIRS[(o + s + 8) & 7], ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= W || jj >= nav.D) continue;
    const q = jj * W + ii;
    let h = cv.H[q] / 10;
    const step = cv.gh[q] - cv.gh[k];
    if (step > h) h = step;
    const v = h >= 1.45 ? 2 : h >= 0.75 ? 1 : 0;
    // まっすぐ前の物を一番に見る（斜めは半分）
    if (s === 0) best = Math.max(best, v); else if (v === 2 && best === 0) best = 1;
  }
  return best;
}
function bushAt(nav, cv, k) { return cv.bush[k] / 10; }

// 試合の始めに作っておく表（重い物。最初の見回しで作ると、そのステップが止まる）
export function warPrep(S, w) {
  const nav = buildWarNav(w, S.m.rect); coverOf(w, nav);
  treeGrid(w); bushGrid(w);
}
// ---- 1ステップ: 全部のボットの入力
export function warThink(S, w, dt) {
  const out = {};
  const m = S.m;
  if (!m.cmdT || S.t - m.cmdT >= 120) { m.cmdT = S.t; command(S, w); }
  const nav = buildWarNav(w, m.rect), cv = coverOf(w, nav);
  // 見る相手の一覧（チームごと・生きていて倒れていない）と、場所を取ったマス（同じ所へ集まらない）
  const live = [[], []];
  for (const b of S.actors) if (b.alive && !b.down && !b.isDrone && b.team >= 0 && b.team < 2) live[b.team].push(b);
  m.claim = m.claim || new Map();
  if (S.t % 60 === 0) for (const [k, v] of m.claim) if (S.t > v.until || !S.byId[v.id] || !S.byId[v.id].alive) m.claim.delete(k);
  m.intel = m.intel || [new Map(), new Map()];
  // 味方から離れるための近所の表（4m のマス。毎ステップ1回）
  const near = [new Map(), new Map()];
  for (let t = 0; t < 2; t++) for (const b of live[t]) { const k = Math.floor(b.x / 4) * 8192 + Math.floor(b.z / 4); let L = near[t].get(k); if (!L) near[t].set(k, L = []); L.push(b); }
  // 道を作る予算（11-26）: 1 ステップで調べるマスは合わせて 16000 まで（前は 4 本まで・1 本 24000 マスで、長い道が重なると
  //  1 ステップ 12〜24ms 止まった。予算を超えた分は次のステップへ回す）
  // inavN: 建物の中の道を作り進めるのは 1 ステップ 12 区切りまで（パソコンで 2〜3ms。アパートは全部で 100ms ほど）
  const ctx = { nav, cv, live, near, paths: 4, pathBudget: 16000, covers: 6, inavN: 12, M: matchMem(S) };
  for (const a of S.actors) {
    if (a.pid != null || !a.ai || a.ai.type !== 'war') continue;
    if (!a.alive) continue;
    out[a.id] = think(S, w, a, dt, ctx);
  }
  return out;
}

// 分隊で分け合う敵の場所（見えた・撃ってきた。8秒で古くなる）
function tellSquad(S, a, b) {
  const I = S.m.intel[a.team];
  I.set(b.id, { x: b.x, z: b.z, y: b.y, t: S.t, sq: a.squad });
}
function nearestIntel(S, a, maxD = 140) {
  const I = S.m.intel[a.team];
  let best = null, bd = maxD;
  for (const [id, p] of I) {
    if (S.t - p.t > SEC(S, 8)) { I.delete(id); continue; }
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function think(S, w, a, dt, ctx) {
  const ai = a.ai, sk = SKILL[ai.skill || 'bot2'];
  const inp = baseInput(a);
  inp.stance = 0;
  if (a.down) return downThink(S, w, a, inp, ctx, sk, dt);
  if (a.act) { inp.mx = 0; inp.mz = 0; inp.stance = a.act.k === 'revive' ? 1 : a.stance; return inp; }
  // 地雷を置いた: 銃へ戻す
  if (ai.mineBack && S.t >= ai.mineBack) { ai.mineBack = 0; pushAct(inp, { a: 'switch', slot: 0 }); }
  // RPG を持ったまま（撃ち終えた・敵を見失った）: 銃へ戻す
  if (a.ws.slot === 3 && !(ai.rpgUntil && S.t < ai.rpgUntil) && a.ws.st !== 'holster' && a.ws.st !== 'draw' && (!ai.selT || S.t - ai.selT > SEC(S, 1))) { ai.selT = S.t; pushAct(inp, { a: 'switch', slot: 0 }); }
  // 見回す（交代で）
  if ((S.t + a.id) % SCAN_EVERY === 0) scan(S, w, a, ctx, sk);
  let tgt = ai.tgt != null ? S.byId[ai.tgt] : null;
  if (tgt && (!tgt.alive || tgt.down || S.t - (ai.seenT ?? -1e9) >= SEC(S, 6))) { if (!tgt.alive || tgt.down) { ai.tgtPos = null; ai.tgtId = null; ai.flank = null; } ai.tgt = null; tgt = null; }
  const [, rEff, rMax] = rangeOf(a);
  // 撃たれた: 撃った方を覚えて、遮蔽物へ
  if (a.lastHit && a.lastHit.by >= 0 && S.t - a.lastHit.t < 3 && ai.hitSeen !== a.lastHit.t) {
    ai.hitSeen = a.lastHit.t;
    const b = S.byId[a.lastHit.by];
    if (b && b.team !== a.team) {
      // 人は撃たれた向きはおおよそ分かるが、居場所までは分からない（11-20。前は撃った相手のちょうどの位置を知り、分隊にも伝えていた）。
      //  向きは ±4〜11°（遠いほどずれる）、距離は ±20% ずれた所を「あのあたり」として見る・遮蔽物を選ぶ・分隊に伝える
      const dd = Math.hypot(b.x - a.x, b.z - a.z), err = (hrand(a.id, S.t, 41) - 0.5) * (0.14 + Math.min(0.24, dd / 400));
      const ang = yawTo(b.x - a.x, b.z - a.z) + err, r0 = dd * (0.8 + 0.4 * hrand(a.id, S.t, 42));
      const gx = a.x + Math.sin(ang) * r0, gz = a.z + Math.cos(ang) * r0;
      ai.threat = { x: gx, z: gz, y: b.y, t: S.t }; ai.wantCover = true;
      S.m.intel[a.team].set(b.id, { x: gx, z: gz, y: b.y, t: S.t, sq: a.squad });
      if (!tgt) { ai.look = [gx, b.y + 1.3, gz]; ai.lookT = S.t; }
    }
  }
  // 弾が尽きる（11-27 からボットの弾も減る）: 主の銃が空なら拳銃へ、戻ったら主の銃へ。少なくなったら近くの弾薬箱へ
  ammoSwitch(S, a, inp, tgt);
  // 弾倉（敵が見えていないときに込める）
  const wi = curWeapon(a);
  const lowMag = wi ? (() => { const [inMag] = ammoCount(wi); const cap = wi.cap || (curW(a) || {}).mag || 30; return inMag < cap * 0.45; })() : false;

  // ---- 倒れた仲間を起こす・自分の手当て（敵が見えていないとき）
  if (!tgt) {
    if (tryRevive(S, w, a, inp, ctx, sk, dt)) return inp;
    // 味方の要請（11-27 16:51。requests.js）: 弾薬箱を届ける・治しに行く・ついて行く・守る
    if (ai.req && serveReq(S, w, a, inp, ctx, sk, dt)) return inp;
    if (a.hp < a.maxHp * 0.5 && S.t - (ai.seenT ?? -1e9) > SEC(S, 3) && a.inv.gear.some(g => g.id === 'bandage' && g.n > 0) && a.ws.st === 'ready' && !ai.reviving) { pushAct(inp, { a: 'gear', id: 'bandage' }); inp.stance = 1; return inp; }
    if (lowMag && a.ws.st === 'ready') pushAct(inp, { a: 'reload' });
    if (S.t - (ai.seenT ?? -1e9) > SEC(S, 3) && toAmmo(S, w, a, inp, ctx, sk, dt)) return inp;
  }

  // ---- 撃ち合い
  if (tgt) { if (fight(S, w, a, inp, tgt, ctx, sk, dt, rEff, rMax)) return inp; }
  else if (ai.tgtPos && S.t - (ai.seenT ?? -1e9) < SEC(S, ai.clearing != null ? 22 : 9) && ai.tgtId != null) { if (lost(S, w, a, inp, ctx, sk, dt)) return inp; }
  else if (ai.look && S.t - ai.lookT < SEC(S, 1.5)) { const e = eyeAI(S, a); inp.yaw = turnToward(a.yaw, yawTo(ai.look[0] - e[0], ai.look[2] - e[2]), sk.turn * Math.PI / 180 * dt); inp.pitch = a.pitch * 0.9; ai.lookLock = true; }

  // ---- 目標の拠点へ（または拠点で守る）。音の方へ振り向いている間は、向きを変えずに歩く（振り向きを道の向きで消さない）
  objective(S, w, a, inp, ctx, sk, dt);
  ai.lookLock = false;
  return inp;
}

// ---- 弾（11-27: ボットの弾も減る。BattleBit の人のように、主の銃が尽きたら拳銃・少なくなったら弾薬箱）
const rounds = (wi) => { if (!wi) return 0; const [m, r] = ammoCount(wi); return m + r; };
// 予備がどれだけ残っているか（出撃した時を 1）
const spareK = (wi) => !wi ? 1 : wi.mags ? wi.mags.length / Math.max(1, wi.spare0 || 1) : (wi.res || 0) / Math.max(1, wi.spare0 || 1);
function ammoSwitch(S, a, inp, tgt) {
  const ai = a.ai, w0 = a.inv.w[0], w1 = a.inv.w[1];
  if (a.ws.st !== 'ready' || (ai.selT && S.t - ai.selT < SEC(S, 1))) return;
  if (a.ws.slot === 0 && w0 && rounds(w0) === 0 && w1 && rounds(w1) > 0) { ai.selT = S.t; pushAct(inp, { a: 'switch', slot: 1 }); }
  // 拳銃のまま: 主の銃に弾が戻り、撃ち合っていなければ戻す
  else if (a.ws.slot === 1 && w0 && rounds(w0) > 0 && !tgt) { ai.selT = S.t; pushAct(inp, { a: 'switch', slot: 0 }); }
}
// 弾が少ない（予備が 1/4 以下・拳銃に持ち替えた）: 45m 以内の味方の弾薬箱へ行って、満ちるまで立つ（走ると補給されない）。
//  どちらの銃も空で、40 秒たっても箱がない時は、倒れた人から拾ったことにして主の銃に 1 本（ボットだけの近道）
function toAmmo(S, w, a, inp, ctx, sk, dt) {
  const ai = a.ai, w0 = a.inv.w[0], w1 = a.inv.w[1];
  if (!w0) return false;
  const empty = rounds(w0) === 0 && rounds(w1) === 0;
  if (empty) { if (ai.dryT == null) ai.dryT = S.t; if (S.t - ai.dryT > SEC(S, 40)) { ai.dryT = null; if (w0.mags) w0.mags.push(w0.cap || 30); else w0.res = (w0.res || 0) + (w0.cap || 8); } }
  else ai.dryT = null;
  // 行き始めたら 9 割まで満ちるのを待つ（1/4 を越えたところで離れない）
  const low = spareK(w0) <= 0.25 || rounds(w0) === 0;
  if (spareK(w0) >= 0.9 || (!low && ai.boxGo == null)) { ai.boxGo = null; return false; }
  let box = ai.boxGo != null ? (S.ammo || []).find(b => b.id === ai.boxGo && b.left > 0) : null;
  if (!box) {
    let bd = 45;
    for (const b of S.ammo || []) { if (b.team !== a.team || b.left <= 0) continue; const d = Math.hypot(b.x - a.x, b.z - a.z); if (d < bd && Math.abs(b.y - a.y) < 6) { bd = d; box = b; } }
    ai.boxGo = box ? box.id : null;
  }
  if (!box) return false;
  const d = Math.hypot(box.x - a.x, box.z - a.z);
  if (d > 1.2) { moveToPoint(S, w, a, inp, [box.x, box.z, box.y], ctx, sk, dt, { sprint: d > 12, face: true }); return true; }
  // 着いた: 走らずに立って、まわりを見る
  inp.mx = 0; inp.mz = 0; inp.sprint = false; inp.stance = 0;
  return true;
}

// ---- 撃ち合い（見えている敵）。true: この入力で決まり
function fight(S, w, a, inp, tgt, ctx, sk, dt, rEff, rMax) {
  const ai = a.ai;
  const d = Math.hypot(tgt.x - a.x, tgt.z - a.z);
  const visible = S.t - ai.seenT < SCAN_EVERY * 2;
  const ready = S.t >= (ai.reactAt || 0);
  ai.tgtPos = [tgt.x, tgt.y, tgt.z]; ai.tgtId = tgt.id; ai.clearing = null;
  // 遠すぎる敵（交戦距離の外）は撃たずに進む（ときどき止まって撃つ）
  if (d > rMax) return false;
  // 遠い敵（ちょうどよい距離の 2 倍より先）: 撃たれていなければ、3秒ごとに半分だけ止まって撃ち、ほかは目標へ進む
  //  （遠くの敵に足を止めて撃ち合い続けると、拠点の取り合いが進まず当たりも少ない。11-19 の調整）
  const shotAt = a.lastHit && S.t - a.lastHit.t < SEC(S, 4);
  if (d > rEff * 2 && !shotAt && hrand(a.id, Math.floor(S.t / SEC(S, 3)), 5) >= 0.5) return false;
  const err = aimAtTgt(S, a, inp, visible ? tgt : null, sk, dt, visible);
  // 遮蔽物: 撃たれた・開けた所に立っている・前の遮蔽物が向きに合わない → 探す（2.5秒ごと）
  const cvNow = ai.cov && (ai.cov.win ? covAt(ai.cov, a) : ai.cov.k === navCellOf(ctx.nav, a.x, a.z)) ? covKind(ctx, ai.cov, tgt.x, tgt.z) : 0;
  // 建物の中: 外の遮蔽物を探すと外へ出てしまうので、同じ建物の近い窓（敵の方へ向いた）を遮蔽物にする
  const inB = bldOf(w, a.x, a.z);
  if ((ai.wantCover || !ai.cov || covKind(ctx, ai.cov, tgt.x, tgt.z) === 0) && S.t >= (ai.covT || 0) && ctx.covers > 0 && d > 9) {
    ctx.covers--; ai.covT = S.t + SEC(S, 2.5); ai.wantCover = false;
    const c = inB ? windowSpot(S, w, a, ctx, tgt.x, tgt.z, { blds: [inB], near: [a.x, a.z, 9] }) : findCover(S, w, a, ctx, tgt.x, tgt.z, { R: d < 25 ? 9 : 14, pref: rEff * 0.7, goal: goalOf(S, a) });
    if (c) { if (c.win) S.m.claim.set(c.key, { id: a.id, until: S.t + SEC(S, 12) }); else claimCell(S, a, c.k, SEC(S, 12)); ai.cov = c; ai.peek = null; }
  }
  const inCover = ai.cov && covAt(ai.cov, a);
  // 発煙弾（11-27 20:22「AI のスモークの使い方・使うタイミングをもっと賢く。むやみに使いすぎ」）: 開けた所で撃たれ続けていて（1 秒）、
  //  離れた遮蔽物（12m より先）へ移るか、体力が減っている時だけ、自分と敵の間に。敵が近すぎる（30m まで）・遠すぎる（150m より先）・
  //  建物の中・もう煙がある時は投げない。1 人 60 秒・分隊 25 秒に 1 回（smokeOK）
  if (!inCover && !inB) { if ((a.supp || 0) > 0.45) ai.suppT = (ai.suppT || 0) + dt; else ai.suppT = 0; }
  if (ai.smokePlan || (!inCover && !inB && (ai.suppT || 0) > 1.0 && d > 30 && d < 150
    && ((ai.cov && Math.hypot(ai.cov.x - a.x, ai.cov.z - a.z) > 12) || (!ai.cov && a.hp < a.maxHp * 0.7)))) {
    const ux = (tgt.x - a.x) / d, uz = (tgt.z - a.z) / d;
    if (!ai.smokePlan && smokeOK(S, a, a.x + ux * 8, a.z + uz * 8)) ai.smokePlan = { x: a.x + ux * 8, z: a.z + uz * 8, until: S.t + SEC(S, 3), r: 'move' };
    if (ai.smokePlan && smokeGo(S, a, inp, dt)) return true;
  }
  // 工兵の RPG
  if (rpgAt(S, a, inp, tgt, d, visible && ready, sk, dt)) return true;
  // 撃つ・のぞく
  let canShoot = visible && ready;
  if (inCover) {
    const kind = cvNow || covKind(ctx, ai.cov, tgt.x, tgt.z);
    // のぞく（撃つ）と隠れるをくり返す。撃たれている（制圧）と隠れる時間が長い
    if (!ai.peek || S.t >= ai.peek.until) {
      const out = !ai.peek || !ai.peek.out;
      const sup = Math.min(1, a.supp || 0);
      ai.peek = { out, until: S.t + SEC(S, out ? 1.6 + 1.6 * hrand(a.id, S.t, 51) : 0.4 + 0.6 * hrand(a.id, S.t, 52) + sup * 1.0) };
    }
    const out = ai.peek.out;
    // 低い遮蔽物: 立って撃ち・しゃがんで隠れる（伏せとの行き来は遅く、その間撃てないので使わない）
    if (kind === 1) inp.stance = out ? 0 : 1;
    else if (kind === 2) { inp.stance = 0; inp.lean = out ? (ai.cov.side || 1) : 0; }
    else inp.stance = d > 45 ? 1 : 0;
    if (!out) canShoot = false;
    // 隠れている間に弾を込める（半分より少ないとき）
    const wi2 = curWeapon(a);
    if (!out && wi2 && a.ws.st === 'ready') { const [inMag] = ammoCount(wi2); const cap = wi2.cap || (curW(a) || {}).mag || 30; if (inMag < cap * 0.5) pushAct(inp, { a: 'reload' }); }
    inp.mx = 0; inp.mz = 0;
  } else if (ai.cov && Math.hypot(ai.cov.x - a.x, ai.cov.z - a.z) < 16) {
    // 遮蔽物へ移りながら撃つ（遠いときは走る）
    moveToPoint(S, w, a, inp, ptOf(ai.cov), ctx, sk, dt, { sprint: d > 60 && !visible, face: false });
    inp.stance = 0;
  } else if (d < 20) {
    // 近い: 横へ動きながら撃つ（ときどき前後）
    if (!ai.strafeT || S.t > ai.strafeT) { ai.strafeT = S.t + SEC(S, 0.5 + 0.8 * hrand(a.id, S.t, 7)); ai.strafe = hrand(a.id, S.t, 8) < 0.5 ? -1 : 1; ai.fwd = hrand(a.id, S.t, 6) < 0.3 ? (d > 10 ? 0.5 : -0.4) : 0; }
    inp.mx = ai.strafe * 0.85; inp.mz = ai.fwd || 0;
    separate(S, a, inp, ctx, 2.5);
  } else {
    // 開けた所: 遠いと伏せ・しゃがみ、中くらいはしゃがんで少し動く
    // 遠い（90m〜）と伏せ・中くらいはしゃがむ。伏せたら起きない（行き来の間は撃てない）
    inp.stance = d > 90 || (a.st > 1.5 && d > 55) ? 2 : d > 30 ? 1 : 0;
    if (inp.stance < 2) { if (!ai.strafeT || S.t > ai.strafeT) { ai.strafeT = S.t + SEC(S, 0.8 + 1.0 * hrand(a.id, S.t, 7)); ai.strafe = hrand(a.id, S.t, 8) < 0.5 ? -1 : 1; } inp.mx = ai.strafe * 0.5; }
  }
  inp.ads = d > 12 && canShoot;
  if (canShoot) trigger(S, a, inp, d > rEff ? { ...sk, burst: [2, 4] } : sk, err < (d > 60 ? 0.02 : 0.06));
  ai.stuckT = 0;
  return true;
}

// ---- 工兵の RPG（11-20）: 15〜150m の見えている敵が、しゃがむ・伏せる・身を出している（物陰）か、5m 以内に2人以上固まっている、
//  または 3 割の運で、構えて撃つ（考えるのは 4 秒ごと、撃ったら 20〜35 秒は使わない）。味方が敵の 7m 以内にいれば撃たない。
//  ロケットは遅く落ちるので、体のまん中を狙い、落ちる分だけ上へ。撃ったら銃へ戻す。true: この入力で決まり
function rpgAt(S, a, inp, tgt, d, canShoot, sk, dt) {
  const ai = a.ai, rp = a.inv && a.inv.rpg;
  if (!rp) return false;
  if (!(ai.rpgUntil && S.t < ai.rpgUntil)) {
    if (S.t < (ai.rpgT || 0) || rp.in + rp.n <= 0 || !canShoot || d < 15 || d > 150) return false;
    ai.rpgT = S.t + SEC(S, 4);
    let crowd = 0, ally = false;
    for (const b of S.actors) {
      if (!b.alive || b.down || b === a || Math.hypot(b.x - tgt.x, b.z - tgt.z) > 7) continue;
      if (b.team === a.team) ally = true; else if (Math.hypot(b.x - tgt.x, b.z - tgt.z) < 5) crowd++;
    }
    const covered = tgt.st > 0.5 || Math.abs(tgt.lean || 0) > 0.3;
    if (ally || !(crowd >= 2 || covered || hrand(a.id, S.t, 61) < 0.3)) return false;
    ai.rpgUntil = S.t + SEC(S, 7); ai.rpgShot = false;
  }
  inp.mx = 0; inp.mz = 0; inp.stance = a.st > 1.5 ? 2 : a.st > 0.5 ? 1 : 0;
  const err = aimAtTgt(S, a, inp, tgt, sk, dt, true);
  if (a.ws.slot !== 3) { if (!ai.selT || S.t - ai.selT > SEC(S, 1)) { ai.selT = S.t; pushAct(inp, { a: 'long' }); } return true; }
  // 撃った（空になった）: 銃へ
  if (ai.rpgShot && !rp.in) { ai.rpgUntil = 0; ai.rpgT = S.t + SEC(S, 20 + 15 * hrand(a.id, S.t, 62)); ai.selT = S.t; pushAct(inp, { a: 'switch', slot: 0 }); return true; }
  // 体のまん中へ（aimAtTgt は胸か頭）・ロケットの落ちる分（弾の分は aimAtTgt が足している）
  const tofR = d / 170, tofB = d / 800;
  inp.pitch += Math.atan2(0.5 * G * ROCKET.g * tofR * tofR - 0.5 * G * tofB * tofB - 0.35, d);
  inp.ads = true;
  if (rp.in && a.ws.st === 'long' && !(a.ws.lt > 0) && a.ads > 0.8 && err < 0.035) { inp.fire = !ai.rpgPress; ai.rpgPress = !ai.rpgPress; if (inp.fire) ai.rpgShot = true; }
  else ai.rpgPress = false;
  return true;
}

// ---- 見失った（最後に見た所がある）: 見張る・手榴弾・回り込む。false なら目標へ進む
function lost(S, w, a, inp, ctx, sk, dt) {
  const ai = a.ai, [tx, ty, tz] = ai.tgtPos, since = (S.t - ai.seenT) * S.dt, d = Math.hypot(tx - a.x, tz - a.z);
  // 手榴弾（8〜38m の隠れた敵。近くに味方がいない。15秒に1回）
  if (since > 0.8 && since < 8 && d > 8 && d < 38 && S.t >= (ai.nadeT || 0) && a.inv.gear.some(g => g.id === 'frag' && g.n > 0)
    && !S.actors.some(b => b.team === a.team && b.alive && Math.hypot(b.x - tx, b.z - tz) < 8)) {
    if (throwAt(S, a, inp, dt, 'frag', tx, tz)) return true;
  }
  // 回り込む（組の片方。敵が 25〜90m で、3秒より長く見えない）
  if (!ai.flank && since > 3 && d > 25 && d < 90 && (a.sqIdx % 2 === 1) && hrand(a.id, ai.seenT, 61) < 0.6) {
    const side = hrand(a.id, ai.seenT, 62) < 0.5 ? -1 : 1, ux = (tx - a.x) / d, uz = (tz - a.z) / d;
    const fx = tx - ux * 22 + -uz * side * 26, fz = tz - uz * 22 + ux * side * 26;
    ai.flank = { x: fx, z: fz, until: S.t + SEC(S, 25) };
  }
  // 建物の中に隠れた敵: 中へ入って探す（組の片方か近い者。最後に見た所まで行って、いなければ忘れる）。11-27
  //  （11-27 16:51「自分が建物に入った時だけ極端に複数人入ってくる」: 自分で見た・撃ち合った相手だけ。建物ごとにチームで 2 人まで、ほかは外から見張る）
  const tb = bldOf(w, tx, tz);
  if (tb && since > 1.5 && d < 45 && (a.sqIdx % 2 === 0 || d < 20) && huntSlot(S, a, tb.id)) {
    ai.clearing = tb.id;
    if (Math.hypot(tx - a.x, tz - a.z) < 1.5 && Math.abs(ty - a.y) < 1.2) { ai.tgtPos = null; ai.tgtId = null; ai.clearing = null; return false; }
    moveToPoint(S, w, a, inp, [tx, tz, ty], ctx, sk, dt, { sprint: false, face: true });
    inp.stance = 0; inp.ads = d < 18;
    // 同じ建物の中で 10m より近い: 歩く向きではなく、最後に見た所（同じ階なら）へ銃を向けて進む（角の先を見ながら）
    if (d < 10 && bldOf(w, a.x, a.z) === tb && Math.abs(ty - a.y) < 1.5 && !ai.lookLock) {
      const e = eyeAI(S, a);
      inp.yaw = turnToward(a.yaw, yawTo(tx - e[0], tz - e[2]), sk.turn * 0.7 * Math.PI / 180 * dt); inp.pitch = a.pitch * 0.85;
    }
    return true;
  }
  ai.clearing = null;
  if (ai.flank) {
    if (S.t > ai.flank.until || Math.hypot(ai.flank.x - a.x, ai.flank.z - a.z) < 3) { ai.flank = null; }
    else { moveToPoint(S, w, a, inp, [ai.flank.x, ai.flank.z], ctx, sk, dt, { sprint: true, face: true }); return true; }
  }
  // 遮蔽物の後ろなら見張る（最後に見た所へ向く）
  const inCover = ai.cov && covAt(ai.cov, a);
  if (inCover && since < 7) {
    const e = eyeAI(S, a);
    inp.yaw = turnToward(a.yaw, yawTo(tx - e[0], tz - e[2]), sk.turn * 0.5 * Math.PI / 180 * dt);
    inp.pitch = a.pitch * 0.9;
    const kind = covKind(ctx, ai.cov, tx, tz);
    inp.stance = kind === 1 ? 1 : 0;
    inp.ads = since < 3;
    return true;
  }
  return false;
}

// ---- 目標の拠点へ進む・拠点の中で守る
function objective(S, w, a, inp, ctx, sk, dt) {
  const ai = a.ai, goalF = goalOf(S, a);
  if (!goalF) return;
  const threat = nearestIntel(S, a, 120);
  const inside = Math.hypot(a.x - goalF.x, a.z - goalF.z) < goalF.r;
  // 分隊が見つけた敵が建物の中（40m まで・8 秒以内）: 組の片方は中へ探しに行く（建物にこもった敵を放っておかない。11-27）
  //  11-27 16:51: 自分の分隊が見た・撃ち合った敵だけ（チームのほかの分隊の知らせでは入らない）、新しい知らせ（5 秒）だけ、建物ごとにチームで 2 人まで
  if (threat && threat.y != null && a.sqIdx % 2 === 0 && threat.sq === a.squad && S.t - threat.t < SEC(S, 5)) {
    const tb = bldOf(w, threat.x, threat.z), dT = Math.hypot(threat.x - a.x, threat.z - a.z);
    if (tb && dT < 40 && dT > 1.5 && huntSlot(S, a, tb.id)) { moveToPoint(S, w, a, inp, [threat.x, threat.z, threat.y], ctx, sk, dt, { sprint: false, face: true }); inp.stance = 0; return; }
  }
  // 拠点の中: 遮蔽物の後ろに散る（敵の来る方へ向けて）。20〜40秒で場所を変える。
  //  建物の窓・中の場所へ向かっている間も守る側のまま（窓は拠点の円の外のこともある）
  const toIn = ai.hold && ai.hold.y != null && ai.hold.f === goalF.id && S.t <= ai.hold.until;
  if (inside || toIn || Math.hypot(a.x - goalF.x, a.z - goalF.z) < goalF.r + 6) {
    const tz0 = threat || (() => { const h = S.m.hq[1 - a.team]; return { x: h[0], z: h[1] }; })();
    // 建物の中の場所へ向かっている間は、敵の場所が変わっても選び直さない（着く前に行き先が変わり続ける）
    if (!ai.hold || ai.hold.f !== goalF.id || S.t > ai.hold.until || (threat && ai.hold.tx !== threat.x && !(ai.hold.y != null && !ai.hold.at))) {
      if (ctx.covers > 0) {
        ctx.covers--;
        // 拠点の近くに建物があれば、建物を使う:
        //  守る（自分の拠点）: 4 割ほどは敵の来る方へ向いた窓から見張る（円から 15m まで・2 階も）、2 割ほどは円の中の建物にこもる
        //  取りに来た: 3 割ほどは円の中の建物に入る（取る数に入る）、1 割ほどは円の中の窓
        const bl = bldsNear(S, w, goalF), r = hrand(a.id, Math.floor(S.t / SEC(S, 20)), 73), own = goalF.owner === a.team;
        let wn = null;
        if (bl.length) {
          // 11-27 16:51「普段からも自然に出入りして建物や屋上を利用する」: 少し多めに（守る: 窓 42%・中 26%、取りに来た: 窓 15%・中 30%）
          const pw = own ? 0.42 : 0.15, pi2 = own ? 0.68 : 0.45;
          if (r < pw) wn = windowSpot(S, w, a, ctx, tz0.x, tz0.z, { blds: bl, f: goalF, fR: own ? 15 : 2, maxD: 40 });
          else if (r < pi2) wn = insideSpot(S, w, a, ctx, goalF, bl);
        }
        const c = wn || findCover(S, w, a, ctx, tz0.x, tz0.z, { R: goalF.r * 0.9, center: [goalF.x, goalF.z], pref: 0, spread: 4 });
        const sp = c ? [c.x, c.z] : spotIn(S, a, goalF);
        if (wn) S.m.claim.set(wn.key, { id: a.id, until: S.t + SEC(S, 40) }); else if (c) claimCell(S, a, c.k, SEC(S, 40));
        // 建物の中は着くまでが長い（階段・遠回り）ので、歩く時間の分だけ長く守る
        const trip = wn ? Math.hypot(wn.x - a.x, wn.z - a.z) / 2.5 + Math.abs(wn.y - a.y) * 1.5 + 6 : 0;
        ai.hold = { f: goalF.id, x: sp[0], z: sp[1], y: wn ? wn.y : null, win: wn && wn.win ? wn.n : null, k: c && !wn ? c.k : -1, side: c ? c.side : 1, until: S.t + SEC(S, 20 + 20 * hrand(a.id, S.t, 71) + trip), tx: threat ? threat.x : null, lx: tz0.x, lz: tz0.z };
        if (c && (!wn || wn.win)) ai.cov = { ...c };
      }
    }
    if (ai.hold) {
      const dh = Math.hypot(ai.hold.x - a.x, ai.hold.z - a.z), ind = ai.hold.y != null;
      const far = ind ? dh > 0.6 || Math.abs(ai.hold.y - a.y) > 1.2 : dh > 1.0;
      if (far) { moveToPoint(S, w, a, inp, ind ? [ai.hold.x, ai.hold.z, ai.hold.y] : [ai.hold.x, ai.hold.z], ctx, sk, dt, { sprint: dh > 18 && !threat, face: true }); return; }
      // 建物の中の場所に着いた: そこから 20 秒は守る
      if (ind && !ai.hold.at) { ai.hold.at = S.t; ai.hold.until = Math.max(ai.hold.until, S.t + SEC(S, 20)); }
      // 着いた: 敵の来る方へクレイモア・対人地雷を1つ置く（守る場所ごとに1回。敵が近い時は置かない。窓ではしない）
      if (!ind && !threat && !ai.tgt && ai.mineAt !== ai.hold.until && placeMineAt(S, a, inp, ai.hold.lx, ai.hold.lz, sk, dt)) return;
      // 着いた: 敵の来る方を見張る（しゃがむ・ときどき向きを少し変える）
      if (!ai.watchT || S.t > ai.watchT) { ai.watchT = S.t + SEC(S, 2.5 + 3 * hrand(a.id, S.t, 15)); ai.watchOff = (hrand(a.id, S.t, 16) - 0.5) * 1.4; }
      const lx = threat ? threat.x : ai.hold.lx, lz = threat ? threat.z : ai.hold.lz;
      inp.yaw = turnToward(a.yaw, yawTo(lx - a.x, lz - a.z) + (threat ? 0 : ai.watchOff), sk.turn * 0.4 * Math.PI / 180 * dt);
      inp.pitch = a.pitch * 0.9;
      inp.stance = ai.hold.win ? 0 : ind ? (hrand(a.id, Math.floor(S.t / SEC(S, 8)), 14) < 0.6 ? 1 : 0) : ai.hold.k >= 0 && coverAgainst(ctx.nav, ctx.cv, ai.hold.k, lx, lz) === 1 ? 1 : (hrand(a.id, Math.floor(S.t / SEC(S, 8)), 14) < 0.5 ? 1 : 0);
      // 窓: 窓の外を見る（敵の来る方が窓の向きから外れていたら、窓の向きのまま少し振る）
      if (ai.hold.win && !threat) { const n = ai.hold.win; inp.yaw = turnToward(a.yaw, yawTo(n[0], n[1]) + ai.watchOff * 0.8, sk.turn * 0.4 * Math.PI / 180 * dt); }
      return;
    }
  }
  // 拠点へ: 2人組ごとに違う道（回り込みの中継点）。敵が近いと走らず、ときどき遮蔽物で止まって見回す
  const dg = Math.hypot(goalF.x - a.x, goalF.z - a.z);
  const lane = ai.lane && ai.lane.f === goalF.id ? ai.lane : null;
  if (!lane) {
    const pair = (a.squad * 8 + (a.sqIdx >> 1)), r = hrand(S.seed + a.team * 3, pair, 81);
    let via = null;
    if (dg > 90 && r < 0.65) {
      const ux = (goalF.x - a.x) / dg, uz = (goalF.z - a.z) / dg, side = r < 0.33 ? -1 : 1, off = 25 + 40 * hrand(S.seed, pair, 82);
      const t = 0.55 + 0.2 * hrand(S.seed, pair, 83);
      via = [a.x + ux * dg * t - uz * side * off, a.z + uz * dg * t + ux * side * off];
      const R = S.m.rect; via[0] = Math.max(R[0] + 10, Math.min(R[2] - 10, via[0])); via[1] = Math.max(R[1] + 10, Math.min(R[3] - 10, via[1]));
    }
    // 町の中を通る時は、ときどき途中の建物の中（2 階・屋上も）を通り抜ける（11-27 16:51「普段から自然に出入りして建物や屋上を使う」）
    if (!via && dg > 40 && hrand(S.seed + a.id, pair, 84) < 0.3) via = bldVia(S, w, a, ctx, a.x + (goalF.x - a.x) * 0.5, a.z + (goalF.z - a.z) * 0.5, pair);
    ai.lane = { f: goalF.id, via };
  }
  let to = ai.lane.via || spotIn(S, a, goalF);
  //  建物の中の中継点（高さつき）は、そこまで行ってから次へ
  const viaIn = ai.lane.via && ai.lane.via.length > 2;
  if (ai.lane.via && (viaIn ? Math.hypot(ai.lane.via[0] - a.x, ai.lane.via[1] - a.z) < 1.2 && Math.abs(ai.lane.via[2] - a.y) < 1.2 : Math.hypot(ai.lane.via[0] - a.x, ai.lane.via[1] - a.z) < 12 || Math.hypot(goalF.x - a.x, goalF.z - a.z) < Math.hypot(goalF.x - ai.lane.via[0], goalF.z - ai.lane.via[1]))) { ai.lane.via = null; to = spotIn(S, a, goalF); }
  // 敵が近い: 跳び跳びに進む（遮蔽物まで進み、2〜3秒見回してまた進む）
  if (threat && Math.hypot(threat.x - a.x, threat.z - a.z) < 110 && !bldOf(w, a.x, a.z)) {
    if (ai.bound && S.t < ai.bound.until) {
      if (Math.hypot(ai.bound.x - a.x, ai.bound.z - a.z) > 1.0) { moveToPoint(S, w, a, inp, [ai.bound.x, ai.bound.z], ctx, sk, dt, { sprint: false, face: true }); return; }
      const e = eyeAI(S, a); inp.yaw = turnToward(a.yaw, yawTo(threat.x - e[0], threat.z - e[2]), sk.turn * 0.5 * Math.PI / 180 * dt); inp.pitch = a.pitch * 0.9; inp.stance = 1;
      return;
    }
    if ((!ai.bound || S.t > ai.bound.until + SEC(S, 3)) && ctx.covers > 0) {
      ctx.covers--;
      const ux = (to[0] - a.x), uz = (to[1] - a.z), L = Math.hypot(ux, uz) || 1, ah = Math.min(14, L);
      const c = findCover(S, w, a, ctx, threat.x, threat.z, { R: 10, center: [a.x + ux / L * ah, a.z + uz / L * ah], pref: 0 });
      if (c) { claimCell(S, a, c.k, SEC(S, 8)); ai.bound = { x: c.x, z: c.z, until: S.t + SEC(S, 4 + 3 * hrand(a.id, S.t, 72)) }; ai.cov = { ...c }; return; }
      ai.bound = { x: a.x, z: a.z, until: S.t - 1 };
    }
  }
  moveToPoint(S, w, a, inp, to, ctx, sk, dt, { sprint: dg > 30 && !threat && !a.ai.tgt, face: !a.ai.tgt });
}

// クレイモア・対人地雷を、敵の来る方（lx, lz）へ向けて足もとの前に置く。置き終えたら（か、持っていなければ）false
function placeMineAt(S, a, inp, lx, lz, sk, dt) {
  const ai = a.ai, g = a.inv.gear.find(x => (x.id === 'clay' || x.id === 'apmine') && x.n > 0);
  if (!g) { ai.mineAt = ai.hold.until; return false; }
  const want = yawTo(lx - a.x, lz - a.z);
  inp.yaw = turnToward(a.yaw, want, sk.turn * Math.PI / 180 * dt); inp.pitch = a.pitch * 0.9; inp.mx = 0; inp.mz = 0; inp.stance = 1;
  if (a.ws.slot !== 2 || a.ws.gear !== g.id) { if (!ai.selT || S.t - ai.selT > SEC(S, 1)) { ai.selT = S.t; pushAct(inp, { a: 'gear', id: g.id }); } return true; }
  if ((a.ws.st === 'gear' || a.ws.st === 'ready') && Math.abs(angDiff(a.yaw, want)) < 0.15) {
    const n0 = g.n; inp.fire = !ai.minePress; ai.minePress = !ai.minePress;
    if (inp.fire && n0 > 0) { ai.mineAt = ai.hold.until; ai.selT = S.t; ai.mineBack = S.t + SEC(S, 0.4); }
  }
  return true;
}

// 拠点の中の自分の場所（ボットごとに違う向き・距離。遮蔽物が見つからないとき）
function spotIn(S, a, f) {
  const ang = hrand(a.id, Math.floor(S.t / SEC(S, 10)), 11) * Math.PI * 2, rr = f.r * (0.25 + 0.5 * hrand(a.id, Math.floor(S.t / SEC(S, 10)), 12));
  return [f.x + Math.cos(ang) * rr, f.z + Math.sin(ang) * rr];
}

// ---- 遮蔽物を探す: まわりのマスを点数で比べる（敵の向きの遮蔽物・近さ・ちょうどよい距離・仲間から離れる・取られていない）
// o: { R: 探す半径, center: 探す中心（なければ自分）, pref: ちょうどよい距離（0 で見ない）, goal: 進む先（近づく方が少しよい）, spread: 仲間との間 }
function findCover(S, w, a, ctx, tx, tz, o = {}) {
  const { nav, cv } = ctx, W = nav.W, R = o.R || 12, [cx, cz] = o.center || [a.x, a.z];
  const ci = Math.floor(cx / NS), cj = Math.floor(cz / NS), rr = Math.ceil(R / NS);
  const friends = ctx.live[a.team];
  const claim = S.m.claim;
  const cand = [];
  for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
    const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= nav.D) continue;
    if (di * di + dj * dj > rr * rr) continue;
    const k = j * W + i; if (nav.block[k]) continue;
    const c = claim.get(k); if (c && c.id !== a.id && S.t < c.until) continue;
    const kind = coverAgainst(nav, cv, k, tx, tz);
    const bush = bushAt(nav, cv, k) > 1.0 ? 1 : 0;
    if (!kind && !bush) continue;
    const x = (i + 0.5) * NS, z = (j + 0.5) * NS;
    const dMe = Math.hypot(x - a.x, z - a.z), dT = Math.hypot(tx - x, tz - z);
    let s = (kind === 1 ? 1.0 : kind === 2 ? 0.8 : 0.35) - dMe * 0.045;
    if (o.pref) s -= Math.min(0.6, Math.abs(dT - o.pref) / o.pref * 0.35);
    if (o.goal) s += (Math.hypot(o.goal.x - a.x, o.goal.z - a.z) - Math.hypot(o.goal.x - x, o.goal.z - z)) * 0.015;
    // 敵より向こう（敵の後ろ）へ回るのは遠い
    if (dT < 6) s -= 1;
    let near = 0; for (const b of friends) if (b !== a && Math.hypot(b.x - x, b.z - z) < (o.spread || 3)) near++;
    s -= near * 0.45;
    cand.push({ s, k, x, z, kind });
  }
  if (!cand.length) return null;
  cand.sort((p, q) => q.s - p.s);
  // 上位3つだけ、撃てるか（低い物は立って上から・高い物は横から）を見通しで確かめる
  const ty = heightAt(w, tx, tz) + 1.3;
  for (let n = 0; n < Math.min(3, cand.length); n++) {
    const c = cand[n], gy = heightAt(w, c.x, c.z);
    if (c.kind === 1 || c.kind === 0) { if (wLos(w, c.x, gy + 1.55, c.z, tx, ty, tz)) return { ...c, side: 1 }; continue; }
    // 高い物: 左右へ 0.8m 身を出して見えるか
    const d = Math.hypot(tx - c.x, tz - c.z) || 1, px = -(tz - c.z) / d, pz = (tx - c.x) / d;
    // (px, pz) は敵を向いたときの右。見えた側へ身を出す（リーン +1 が右）
    for (const sd of [1, -1]) if (wLos(w, c.x + px * sd * 0.8, gy + 1.5, c.z + pz * sd * 0.8, tx, ty, tz)) return { ...c, side: sd };
  }
  // 撃てる所がなければ、一番よい隠れ場所（撃たずに隠れる）
  return cand[0].s > 0.3 ? { ...cand[0], side: 1 } : null;
}
function claimCell(S, a, k, dur) { S.m.claim.set(k, { id: a.id, until: S.t + dur }); }

// ---- 倒れた仲間を起こす（25m まで。衛生兵は 40m）。true: この入力で決まり
function tryRevive(S, w, a, inp, ctx, sk, dt) {
  const ai = a.ai, R = a.warCls === 'medic' ? 40 : 25;
  let b = ai.reviving != null ? S.byId[ai.reviving] : null;
  if (b && (!b.alive || !b.down)) { b = null; ai.reviving = null; }
  if (!b && (S.t + a.id) % 30 === 0) {
    let bd = R;
    for (const c of S.actors) {
      if (c === a || c.team !== a.team || !c.alive || !c.down) continue;
      const d = Math.hypot(c.x - a.x, c.z - a.z); if (d > bd) continue;
      // ほかの仲間がもう向かっている
      if (S.actors.some(q => q !== a && q.ai && q.ai.reviving === c.id && q.alive && !q.down)) continue;
      bd = d; b = c;
    }
    if (b) ai.reviving = b.id;
  }
  if (!b) return false;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  // 起こしに行く間、倒した敵（分隊が知っている・8 秒以内）から見える所なら、敵との間に発煙弾（起こす時の煙は本家でもよく使う）
  if (ai.smokePlan && smokeGo(S, a, inp, dt)) return true;
  //  衛生だけ・新しい知らせ（4 秒）・敵が 20〜100m（近すぎると煙より撃ち合い、遠いと煙が届かない）・半分ほど（人によって使わない）
  if (a.warCls === 'medic' && d > 3 && d < 35 && (S.t + a.id) % 10 === 0 && hrand(S.seed + a.id, b.id, 88) < 0.5) {
    const th = nearestIntel(S, b, 100);
    if (th && S.t - th.t < SEC(S, 4) && Math.hypot(th.x - b.x, th.z - b.z) > 20 && wLos(w, th.x, (th.y ?? heightAt(w, th.x, th.z)) + 1.5, th.z, b.x, b.y + 0.4, b.z) && smokeBetween(S, th.x, (th.y ?? b.y) + 1.5, th.z, b.x, b.y + 0.4, b.z) < 0.5) {
      const L = Math.hypot(th.x - b.x, th.z - b.z), sx = b.x + (th.x - b.x) / L * 5, sz = b.z + (th.z - b.z) / L * 5;
      if (Math.hypot(sx - a.x, sz - a.z) < 30 && smokeOK(S, a, sx, sz)) { ai.smokePlan = { x: sx, z: sz, until: S.t + SEC(S, 3), r: 'revive' }; if (smokeGo(S, a, inp, dt)) return true; }
    }
  }
  if (d > 1.3) { moveToPoint(S, w, a, inp, [b.x, b.z], ctx, sk, dt, { sprint: d > 6, face: true }); return true; }
  inp.stance = 1;
  pushAct(inp, { a: 'op', k: 'person', id: b.id, op: 'revive' });
  return true;
}

// ---- 倒れている（11-27 20:22「ダウン中の AI 全く動かない。賢く戦況に合わせて蘇生しやすい位置に移動するなど」）:
//  本家と同じくゆっくり這える。倒した敵（見ている・分隊が知っている）から見えていれば、近く（6m まで）の遮蔽物の陰へ。
//  見えていなければ、近くの衛生（なければ味方）の方へ少し（5m まで）寄る。起こされている・引きずられている・
//  起こしに来る味方がすぐそば（6m）にいる時は動かない（起こす人が追いかけなくてよいように）
function downThink(S, w, a, inp, ctx, sk, dt) {
  const ai = a.ai;
  inp.mx = 0; inp.mz = 0; inp.fire = false; inp.ads = false;
  if (a.dragBy != null || (a.revT != null && S.t - a.revT < SEC(S, 1))) { ai.dgo = null; return inp; }
  const helper = S.actors.find(q => q !== a && q.ai && q.ai.reviving === a.id && q.alive && !q.down);
  if (helper && Math.hypot(helper.x - a.x, helper.z - a.z) < 6) { ai.dgo = null; return inp; }
  if (ai.dgo && (S.t > ai.dgo.until || Math.hypot(ai.dgo.x - a.x, ai.dgo.z - a.z) < 0.6)) ai.dgo = null;
  if (!ai.dgo && (S.t + a.id) % 20 === 0) {
    const tb = ai.tgt != null ? S.byId[ai.tgt] : null;
    const th = tb && tb.alive && !tb.down ? tb : nearestIntel(S, a, 150);
    let goal = null;
    if (th && wLos(w, th.x, (th.y ?? heightAt(w, th.x, th.z)) + 1.5, th.z, a.x, a.y + 0.35, a.z)) {
      if (ctx.covers > 0) { ctx.covers--; const c = findCover(S, w, a, ctx, th.x, th.z, { R: 6, pref: 0 }); if (c) goal = [c.x, c.z]; }
    } else {
      let best = null, bs = 40;
      for (const q of ctx.live[a.team]) { if (q === a) continue; const sc = Math.hypot(q.x - a.x, q.z - a.z) * (q.warCls === 'medic' ? 0.6 : 1); if (sc < bs) { bs = sc; best = q; } }
      if (best) {
        const d = Math.hypot(best.x - a.x, best.z - a.z);
        if (d > 5) { const k = Math.min(5, d - 3) / d, gx = a.x + (best.x - a.x) * k, gz = a.z + (best.z - a.z) * k; if (!th || !wLos(w, th.x, (th.y ?? heightAt(w, th.x, th.z)) + 1.5, th.z, gx, heightAt(w, gx, gz) + 0.35, gz)) goal = [gx, gz]; }
      }
    }
    if (goal) ai.dgo = { x: goal[0], z: goal[1], until: S.t + SEC(S, 14) };
  }
  // 這う: 行きたい方を見て前へ（倒れている時の這う向きは見ている向き。move.js）
  if (ai.dgo) { inp.yaw = yawTo(ai.dgo.x - a.x, ai.dgo.z - a.z); inp.mz = 1; }
  return inp;
}

// ---- 味方の要請に応える（requests.js が ai.req を置く）。true: この入力で決まり
//  行き先は人が 3m 動くまで変えない（動く人を追うたびに道を作り直さない）
function serveReq(S, w, a, inp, ctx, sk, dt) {
  const ai = a.ai, r = ai.req, R = S.byId[r.id];
  if (S.t > r.until || (r.k !== 'guard' && (!R || !R.alive))) { ai.req = null; return false; }
  const goTo = (x, z, y, run, near) => {
    if (r.gx == null || Math.hypot(r.gx - x, r.gz - z) > 3 || Math.abs((r.gy ?? y) - y) > 1.5) { r.gx = x; r.gz = z; r.gy = y; }
    const d = Math.hypot(r.gx - a.x, r.gz - a.z), dy = Math.abs(r.gy - a.y);
    if (d <= near && dy < 2) return false;
    moveToPoint(S, w, a, inp, [r.gx, r.gz, r.gy], ctx, sk, dt, { sprint: run || d > 12, face: true });
    return true;
  };
  if (r.k === 'ammo') {
    if (goTo(R.x, R.z, R.y, false, 2.6)) return true;
    // 着いた: 人の方を向いて足もとへ箱を置く（requests.js の stepRequests）
    inp.mx = 0; inp.mz = 0; inp.stance = 1; inp.yaw = turnToward(a.yaw, yawTo(R.x - a.x, R.z - a.z), sk.turn * Math.PI / 180 * dt);
    r.drop = true; return true;
  }
  if (r.k === 'medic') {
    if (R.down) { ai.reviving = R.id; return tryRevive(S, w, a, inp, ctx, sk, dt); }
    if (goTo(R.x, R.z, R.y, false, 1.6)) return true;
    // そばで治す（war.js の衛生の治療は、敵を追っていない衛生が 2.5m 以内の人を治す）
    inp.mx = 0; inp.mz = 0; inp.stance = 1; inp.yaw = turnToward(a.yaw, yawTo(R.x - a.x, R.z - a.z), sk.turn * Math.PI / 180 * dt);
    return true;
  }
  if (r.k === 'follow') {
    // 人の後ろに扇に並ぶ（3.5m + 1.3m × 順番）。人が走れば走る、しゃがめばしゃがむ。人の見ている方を見る
    const n = r.n || 0, side = (n % 2 ? 1 : -1) * (0.5 + 0.25 * Math.floor(n / 2)), D = 3.5 + 1.3 * n;
    const ang = R.yaw + Math.PI + side;
    const gx = R.x + Math.sin(ang) * D, gz = R.z + Math.cos(ang) * D;
    if (goTo(gx, gz, R.y, !!R.sprint, 2.2)) return true;
    inp.mx = 0; inp.mz = 0; inp.stance = R.stance === 2 ? 1 : R.stance || 0;
    if (!lookSound(S, a, inp, sk, dt)) inp.yaw = turnToward(a.yaw, R.yaw + side * 0.6, sk.turn * 0.5 * Math.PI / 180 * dt);
    inp.pitch = a.pitch * 0.9;
    return true;
  }
  if (r.k === 'guard') {
    // 言われた場所のまわり（2.5〜5m の輪）に散って、言った人が見ていた方を見張る
    const n = r.n || 0, ang = r.yaw + (n - 2.5) * 0.7, D = 2.5 + (n % 3) * 1.2;
    const gx = r.x + Math.sin(ang) * D, gz = r.z + Math.cos(ang) * D;
    if (goTo(gx, gz, r.y, false, 1.4)) return true;
    inp.mx = 0; inp.mz = 0; inp.stance = 1;
    if (!ai.watchT || S.t > ai.watchT) { ai.watchT = S.t + SEC(S, 2.5 + 3 * hrand(a.id, S.t, 15)); ai.watchOff = (hrand(a.id, S.t, 16) - 0.5) * 1.4; }
    if (!lookSound(S, a, inp, sk, dt)) inp.yaw = turnToward(a.yaw, r.yaw + (n - 2.5) * 0.35 + ai.watchOff, sk.turn * 0.4 * Math.PI / 180 * dt);
    inp.pitch = a.pitch * 0.9;
    return true;
  }
  ai.req = null; return false;
}

// 音・撃たれた向き・「敵発見」の方を見る（1.5 秒）。true: 見ている
function lookSound(S, a, inp, sk, dt) {
  const ai = a.ai; if (!ai.look || S.t - ai.lookT >= SEC(S, 1.5)) return false;
  const e = eyeAI(S, a); inp.yaw = turnToward(a.yaw, yawTo(ai.look[0] - e[0], ai.look[2] - e[2]), sk.turn * Math.PI / 180 * dt);
  return true;
}

// 発煙弾を投げてよいか: 持っている・自分（60 秒）と分隊（25 秒）の間をあけた・その場所の近く（14m）にもう煙（立っている・飛んでいる）がない
function smokeOK(S, a, x, z) {
  const ai = a.ai;
  if (S.t < (ai.smokeT || 0) || !a.inv.gear.some(g => g.id === 'smoke' && g.n > 0)) return false;
  const Q = matchMem(S).sqSmoke || (matchMem(S).sqSmoke = new Map());
  if (S.t < (Q.get(a.team + ':' + a.squad) || 0)) return false;
  for (const c of S.clouds || []) if (c.type === 'smoke' && Math.hypot(c.x - x, c.z - z) < 14) return false;
  for (const n of S.nades || []) if (n.type === 'smoke' && n.team === a.team && Math.hypot(n.x - x, n.z - z) < 20) return false;
  return true;
}
// 決めた発煙弾を投げる（持ち替え → 向く → 投げる）。投げたら自分と分隊の間をあける。3 秒で投げられなければやめる
function smokeGo(S, a, inp, dt) {
  const ai = a.ai, P = ai.smokePlan;
  if (!P || S.t > P.until || !a.inv.gear.some(g => g.id === 'smoke' && g.n > 0)) { ai.smokePlan = null; return false; }
  throwAt(S, a, inp, dt, 'smoke', P.x, P.z);
  if (inp.fire) {
    const M = matchMem(S); (M.smokeWhy || (M.smokeWhy = {}))[P.r] = (M.smokeWhy[P.r] || 0) + 1;
    ai.smokePlan = null; ai.smokeT = S.t + SEC(S, 60);
    const Q = matchMem(S).sqSmoke || (matchMem(S).sqSmoke = new Map()); Q.set(a.team + ':' + a.squad, S.t + SEC(S, 25));
  }
  return true;
}

// 投げ物を点へ（持ち替え → 向く → 投げる）。true: 投げている途中
function throwAt(S, a, inp, dt, nade, tx, tz) {
  const ai = a.ai, d = Math.hypot(tx - a.x, tz - a.z);
  inp.yaw = turnToward(a.yaw, yawTo(tx - a.x, tz - a.z), 7 * dt);
  const th = 0.42;
  inp.pitch = turnToward(a.pitch, th - 0.12, 3 * dt);
  if (a.ws.slot !== 2 || a.ws.gear !== nade) { if (!ai.selT || S.t - ai.selT > SEC(S, 1)) { ai.selT = S.t; pushAct(inp, { a: 'gear', id: nade }); } return true; }
  if ((a.ws.st === 'gear' || a.ws.st === 'ready') && Math.abs(angDiff(a.yaw, yawTo(tx - a.x, tz - a.z))) < 0.1) {
    // 大規模戦の投げる速さ（6〜18m/s）から、届く力を逆算
    const v = Math.sqrt(Math.max(1, d) * G / Math.sin(2 * th));
    inp.power = Math.max(0.1, Math.min(1, (v - 6) / 12));
    inp.fire = true;
    ai.nadeT = S.t + SEC(S, 15);
  }
  return true;
}

// 仲間から離れる（近すぎると横へ押す）
function separate(S, a, inp, ctx, R = 3) {
  let px = 0, pz = 0;
  const G = ctx.near ? ctx.near[a.team] : null, ci = Math.floor(a.x / 4), cj = Math.floor(a.z / 4);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const list = G ? G.get((ci + di) * 8192 + cj + dj) : (di === 0 && dj === 0 ? ctx.live[a.team] : null);
    if (!list) continue;
    for (const b of list) {
      if (b === a) continue;
      const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
      if (d < R && d > 1e-3) { const k = (R - d) / R; px += dx / d * k; pz += dz / d * k; }
    }
  }
  if (!px && !pz) return;
  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
  inp.mz += (px * sy + pz * cy) * 0.8; inp.mx += (px * -cy + pz * sy) * 0.8;
  const L = Math.hypot(inp.mx, inp.mz); if (L > 1) { inp.mx /= L; inp.mz /= L; }
}

// ---- 建物（11-27「AI が建物の中に入ってこない」）
// 建物の中の道（作ってあるか、このステップの予算で作れるなら）
//  まだなら 1 ステップに 12 区切り（マス 200〜400 個）まで作り進める（アパートは 30 ステップほど。その間は null）
const _ns = { used: 0 };
function navFor(w, bd, ctx) {
  if (navReady(ctx.M, bd)) return bldNav(w, bd);
  if (ctx.inavN > 0) { const nav = navStep(w, bd, ctx.inavN, _ns, ctx.M); ctx.inavN -= _ns.used; return nav; }
  return null;
}
// 試合ごとの覚え（建物の道の進み・拠点の近くの建物）。S.m の中に置くと dump で JSON にされるので、外の WeakMap に
const MST = new WeakMap();
export function matchMem(S) { let o = MST.get(S.m); if (!o) MST.set(S.m, o = {}); return o; }
// 出入り口を選ぶ: 外の点 (px, pz) に近く、中の点 (qx, qz) にも近い所
function pickExit(nav, px, pz, qx, qz) {
  let best = null, bs = Infinity;
  for (const e of nav.exits) { const s = Math.hypot(e.x - px, e.z - pz) + Math.hypot(e.ix - qx, e.iz - qz) * 0.7; if (s < bs) { bs = s; best = e; } }
  return best;
}
// 道を作る: 外どうしは外の格子。始まりか終わりが建物の中なら、中の格子と出入り口でつなぐ（出る→外→入る）。
//  to: [x, z] か [x, z, 高さ]（2 階の窓など）。null: 建物の中の道がまだ作れない（次のステップで）
function planPath(S, w, a, to, ctx) {
  // 橋の下にいる（頭の上に板がある）なら、橋脚でふさがった地図で（外へ出てから橋を渡る）
  const low = sx0 => sx0 && groundAt(w, a.x, a.z, a.y + 8) > a.y + 1.5;
  const outP = (sx, sz, tx, tz) => { const q = findWarPath(ctx.nav, sx, sz, tx, tz, Math.min(24000, ctx.pathBudget), low(sx === a.x && sz === a.z)); ctx.pathBudget -= ctx.nav.lastExp || 0; return q || [[tx, tz]]; };
  const bs = bldOf(w, a.x, a.z), bt = bldOf(w, to[0], to[1]);
  if (!bs && !bt) return outP(a.x, a.z, to[0], to[1]);
  const ns = bs ? navFor(w, bs, ctx) : null, nt = bt ? (bt === bs ? ns : navFor(w, bt, ctx)) : null;
  if ((bs && !ns) || (bt && !nt)) return null;
  const ty = to.length > 2 && to[2] != null ? to[2] : bt ? bt.y : 0;
  if (bs && bs === bt) return findInPath(ns, cellOf(ns, a.x, a.y, a.z), cellOf(ns, to[0], ty, to[1])) || [[to[0], to[1], 1]];
  const P = [];
  let sx = a.x, sz = a.z;
  if (bs) {
    const e = pickExit(ns, to[0], to[1], a.x, a.z);
    if (e) { const ip = findInPath(ns, cellOf(ns, a.x, a.y, a.z), e.k); if (ip) P.push(...ip); P.push([e.ix, e.iz, 1], [e.x, e.z, 1]); sx = e.x; sz = e.z; }
  }
  if (bt) {
    const e = pickExit(nt, sx, sz, to[0], to[1]);
    if (!e) { P.push(...outP(sx, sz, to[0], to[1])); return P; }
    const op = outP(sx, sz, e.x, e.z); op[op.length - 1] = [e.x, e.z, 1]; P.push(...op, [e.ix, e.iz, 1]);
    const ip = findInPath(nt, e.k, cellOf(nt, to[0], ty, to[1]));
    if (ip) P.push(...ip); else P.push([to[0], to[1], 1]);
  } else P.push(...outP(sx, sz, to[0], to[1]));
  return P;
}
// 建物の中の敵を探しに入る人: チームで建物ごとに 2 人まで（3 秒ごとに入り直す。倒れた・離れた人の枠は空く）
function huntSlot(S, a, bid) {
  const mm = matchMem(S), H = mm.hunt || (mm.hunt = new Map()), key = a.team + ':' + bid;
  const L = (H.get(key) || []).filter(q => q.until > S.t && q.id !== a.id && S.byId[q.id] && S.byId[q.id].alive && !S.byId[q.id].down);
  if (L.length >= 2) { H.set(key, L); return false; }
  L.push({ id: a.id, until: S.t + SEC(S, 3) }); H.set(key, L);
  return true;
}
// 通り抜ける建物の中の点（x, z の近く 30m までの建物。立てるマスから運で。上の階・屋上も 4 割）。中の道がまだなければ null
function bldVia(S, w, a, ctx, x, z, pair) {
  let bd = null, bdD = 30;
  for (const b of w.blds || []) { if (b.down) continue; const r = b.rect, dd = Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - z, 0, z - r[3])); if (dd < bdD) { bdD = dd; bd = b; } }
  if (!bd) return null;
  const nav = navFor(w, bd, ctx); if (!nav || !nav.open.length) return null;
  const up = hrand(S.seed + a.id, pair, 85) < 0.4;
  for (let n = 0; n < 30; n++) {
    const k = Math.floor(hrand(S.seed + a.id + n, pair, 86) * nav.open.length);
    if (!nav.open[k]) continue;
    const l = Math.floor(k / nav.NC); if (up !== (l > 0)) continue;
    const c = k % nav.NC, i = c % nav.W, j = (c - i) / nav.W;
    return [nav.cx(i), nav.cz(j), nav.lv[l]];
  }
  return null;
}
// 拠点の近くの建物（拠点の円から 8m まで）。拠点ごとに覚えておく
function bldsNear(S, w, f) {
  const mm = matchMem(S), C = mm.fbld || (mm.fbld = new Map());
  let L = C.get(f.id);
  if (!L) {
    L = [];
    for (const bd of w.blds || []) { const r = bd.rect, dx = Math.max(r[0] - f.x, 0, f.x - r[2]), dz = Math.max(r[1] - f.z, 0, f.z - r[3]); if (Math.hypot(dx, dz) < f.r + 8) L.push(bd); }
    C.set(f.id, L);
  }
  return L.filter(bd => !bd.down);
}
// 窓の場所を選ぶ: 敵の来る方 (tx, tz) へ向いた窓（取られていない・仲間と離れる）。
//  o: { blds: 探す建物, near: [x, z, 半径]（この近くだけ）, f: 拠点（近いほどよい） }
function windowSpot(S, w, a, ctx, tx, tz, o) {
  let best = null, bsc = -Infinity;
  for (const bd of o.blds) {
    const nav = navFor(w, bd, ctx); if (!nav) continue;
    for (const wn of nav.wins) {
      if (o.near && Math.hypot(wn.x - o.near[0], wn.z - o.near[1]) > o.near[2]) continue;
      // 拠点を守る窓は拠点の円から o.fR（守る時 15m・取りに来た時 2m）まで。向かう間も「守る」のまま（objective）。遠すぎる窓は着くまでが長い
      if (o.f && Math.hypot(wn.x - o.f.x, wn.z - o.f.z) > o.f.r + (o.fR ?? 15)) continue;
      if (o.maxD && Math.hypot(wn.x - a.x, wn.z - a.z) > o.maxD) continue;
      const dx = tx - wn.x, dz = tz - wn.z, d = Math.hypot(dx, dz) || 1;
      const face = (wn.n[0] * dx + wn.n[1] * dz) / d; if (face < 0.35 || d < 6) continue;
      const key = 'w' + bd.id + ':' + wn.k, c = S.m.claim.get(key); if (c && c.id !== a.id && S.t < c.until) continue;
      // 2 階はよい・高すぎる（塔の上など）は上るのに長くかかるので少し悪い
      const up = wn.y - bd.y;
      let sc = face + (up > 2 && up < 8 ? 0.25 : 0) - Math.max(0, up - 8) * 0.05 - Math.hypot(wn.x - a.x, wn.z - a.z) * 0.02 + hrand(a.id, wn.k, 74) * 0.3;
      if (o.f) sc -= Math.hypot(wn.x - o.f.x, wn.z - o.f.z) / (o.f.r + 15) * 0.5;
      for (const b of ctx.live[a.team]) if (b !== a && Math.hypot(b.x - wn.x, b.z - wn.z) < 2.5 && Math.abs(b.y - wn.y) < 1.5) sc -= 0.6;
      if (sc > bsc) { bsc = sc; best = { x: wn.x, z: wn.z, y: wn.y, n: wn.n, key, win: true, k: -1, kind: 1, side: 1 }; }
    }
  }
  return best;
}
// 拠点の円の中にある建物の中の場所（立てるマスから運で選ぶ。仲間から離れる・取られていない）。拠点を取る数に入る
function insideSpot(S, w, a, ctx, f, bl) {
  let best = null, bsc = -Infinity;
  for (const bd of bl) {
    const nav = navFor(w, bd, ctx); if (!nav) continue;
    for (let n = 0; n < 24; n++) {
      const k = Math.floor(hrand(a.id + bd.id * 31, Math.floor(S.t / SEC(S, 20)), 90 + n) * nav.open.length);
      if (!nav.open[k]) continue;
      const l = Math.floor(k / nav.NC), c = k % nav.NC, i = c % nav.W, j = (c - i) / nav.W, x = nav.cx(i), z = nav.cz(j), y = nav.lv[l];
      if (Math.hypot(x - f.x, z - f.z) > f.r - 1 || Math.abs(y - f.y) > 10) continue;
      const key = 'i' + bd.id + ':' + k, cl = S.m.claim.get(key); if (cl && cl.id !== a.id && S.t < cl.until) continue;
      let sc = hrand(a.id, k, 91) - Math.hypot(x - a.x, z - a.z) * 0.01;
      for (const b of ctx.live[a.team]) if (b !== a && Math.hypot(b.x - x, b.z - z) < 3 && Math.abs(b.y - y) < 1.5) sc -= 0.6;
      if (sc > bsc) { bsc = sc; best = { x, z, y, key, k: -1, kind: 0, side: 1 }; }
    }
  }
  return best;
}
// 遮蔽物の向きの強さ（窓: 外へ向いて敵の方なら低い物と同じ 1）
function covKind(ctx, c, tx, tz) {
  if (c.win) return (c.n[0] * (tx - c.x) + c.n[1] * (tz - c.z)) / (Math.hypot(tx - c.x, tz - c.z) || 1) > 0.2 ? 1 : 0;
  return c.k >= 0 ? coverAgainst(ctx.nav, ctx.cv, c.k, tx, tz) : 0;
}
const covAt = (c, a) => Math.hypot(c.x - a.x, c.z - a.z) < (c.win ? 0.6 : 1.0) && (c.y == null || Math.abs(c.y - a.y) < 1.2);
const ptOf = (c) => c.y != null ? [c.x, c.z, c.y] : [c.x, c.z];
// 窓の見張りの場所に着いている

// 抜け出す向き: 8 方向へ 1m ずつ 8m まで、足元が今の高さ ±0.6m のまま・壁に当たらない所までの長さ。いちばん長い向きの先
function escapeDir(w, a) {
  let best = null, bl = 2;
  for (let k = 0; k < 8; k++) {
    const an = k * Math.PI / 4 + 0.3, dx = Math.sin(an), dz = Math.cos(an);
    let L = 0, y = a.y;
    for (let r = 1; r <= 8; r++) {
      const x = a.x + dx * r, z = a.z + dz * r, g = groundAt(w, x, z, y + 0.7);
      if (!isFinite(g) || Math.abs(g - y) > 0.6) break;
      pushOut(w, x, z, g + 0.3, g + 1.6, 0.3, _esc); if (_esc[2]) break;
      L = r; y = g;
    }
    if (L > bl) { bl = L; best = [a.x + dx * L, a.z + dz * L]; }
  }
  return best;
}
const _esc = [0, 0, 0];

// 点へ歩く（道を作り、詰まったら乗り越え・横へずれる・作り直す）
function moveToPoint(S, w, a, inp, to, ctx, sk, dt, o = {}) {
  const ai = a.ai;
  // 抜け出し中（橋の下の溝など、道の点が上の段にあって進めない時）: 同じ高さで歩ける向きへ少し歩いてから道を作り直す
  if (ai.esc && S.t < ai.esc.until) {
    steerToward(a, inp, ai.esc.x, ai.esc.z, 1);
    if (o.face && !ai.lookLock) inp.yaw = turnToward(a.yaw, yawTo(ai.esc.x - a.x, ai.esc.z - a.z), sk.turn * Math.PI / 180 * dt);
    inp.sprint = false;
    if (Math.hypot(ai.esc.x - a.x, ai.esc.z - a.z) > 1) return;
  }
  if (ai.esc) { ai.esc = null; ai.repath = true; }
  const need = !ai.path || !ai.pathTo || Math.hypot(ai.pathTo[0] - to[0], ai.pathTo[1] - to[1]) > (to[2] != null ? 1 : 4) || (to[2] != null && Math.abs((ai.pathTo[2] ?? -99) - to[2]) > 1) || S.t - ai.pathT > 900 || ai.repath;
  if (need && ctx.paths > 0 && ctx.pathBudget > 1500) {
    ctx.paths--;
    const np = planPath(S, w, a, to, ctx);
    // 建物の中の道がまだない（このステップでは作れない）: 前の道のまま、次のステップで作り直す
    if (np) { ai.path = np; ai.pi = 0; ai.pathTo = to.slice(); ai.pathT = S.t; ai.repath = false; } else ai.repath = true;
  }
  const P = ai.path || [to];
  // 中の点（3つめが 1: 建物の中・出入り口）は 0.45m まで寄ってから次へ（角を切ると壁に引っかかる）
  while (ai.pi < P.length - 1 && Math.hypot(P[ai.pi][0] - a.x, P[ai.pi][1] - a.z) < (P[ai.pi][2] ? 0.45 : 2.0)) ai.pi++;
  const p = P[Math.min(ai.pi || 0, P.length - 1)];
  if (o.face && !ai.lookLock) { inp.yaw = turnToward(a.yaw, yawTo(p[0] - a.x, p[1] - a.z), sk.turn * Math.PI / 180 * dt); inp.pitch = a.pitch * 0.85; }
  steerToward(a, inp, p[0], p[1], 1);
  separate(S, a, inp, ctx, p[2] ? 1.2 : 2.8);
  inp.sprint = !!o.sprint && !p[2] && Math.abs(angDiff(inp.yaw, a.yaw)) < 0.3 && inp.mz > 0.5;
  // 詰まり: 進みたいのに遅い
  const want = Math.hypot(inp.mx, inp.mz) > 0.3;
  if (want && a.spd < 0.4) ai.stuckT = (ai.stuckT || 0) + dt; else ai.stuckT = Math.max(0, (ai.stuckT || 0) - dt * 2);
  if (ai.stuckT > 0.8 && ai.stuckT - dt <= 0.8) pushAct(inp, { a: 'vault' });
  if (ai.stuckT > 1.6) { inp.mx = (a.id % 2 ? 1 : -1); inp.mz = -0.2; }
  if (ai.stuckT > 3) { ai.stuckT = 0; ai.repath = true; ai.pi = Math.min((ai.pi || 0) + 1, P.length - 1); }
  // 進んでいない（横へずれると速さは出るので、上の数え方では詰まりと分からない。溝の底など）: 4 秒、点へ 0.4m も近づけなければ、
  //  乗り越えを試して、次の点へ・道を作り直す（11-27）
  const dNow = Math.hypot(p[0] - a.x, p[1] - a.z);
  // 中の点のすぐそば（1m 以内）で 1.5 秒進めない（壁ぎわ・階段の端で 0.45m まで寄れない）: 次の点へ
  if (p[2] && dNow < 1.0 && ai.prog && ai.prog.P === P && ai.prog.pi === ai.pi && S.t - ai.prog.t > SEC(S, 1.5) && ai.pi < P.length - 1) { ai.pi++; ai.prog = null; }
  if (!want || (dNow < 0.8 && !p[2]) || !ai.prog || ai.prog.P !== P || ai.prog.pi !== ai.pi || dNow < ai.prog.d - 0.4) ai.prog = { P, pi: ai.pi, d: dNow, t: S.t };
  else if (S.t - ai.prog.t > SEC(S, 4)) { ai.prog = null; ai.repath = true; ai.pi = Math.min((ai.pi || 0) + 1, P.length - 1); pushAct(inp, { a: 'vault' }); }
  // 道が作り直され続けても、4 秒で 1.2m も動けていなければ（橋脚の角に向かって押し続ける など）: 抜け出す向きへ 2.5 秒歩く
  //  （8 方向で、同じ高さのまま歩ける距離がいちばん長い向き）
  if (!want) ai.mv = null;
  else if (!ai.mv || Math.hypot(a.x - ai.mv.x, a.z - ai.mv.z) > 1.2) ai.mv = { x: a.x, z: a.z, t: S.t };
  else if (S.t - ai.mv.t > SEC(S, 4)) { ai.mv = null; ai.repath = true; const e = escapeDir(w, a); if (e) ai.esc = { x: e[0], z: e[1], until: S.t + SEC(S, 2.5) }; }
}

// 見回す: 近い敵から順に、視野・音・見通しで探す。見つけたら反応の遅れを置いて狙う。茂みの向こう・麦畑の伏せは見つけにくい
function scan(S, w, a, ctx, sk) {
  const ai = a.ai, foes = ctx.live[1 - a.team];
  const e = eyeAI(S, a);
  const maxD = rangeOf(a)[2] * 1.1;
  const cand = [];
  for (const b of foes) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > maxD) continue;
    cand.push([d, b]);
  }
  cand.sort((p, q) => p[0] - q[0]);
  let found = null, n = 0;
  for (const [d, b] of cand) {
    if (n >= 4) break;
    const ang = Math.abs(angDiff(yawTo(b.x - a.x, b.z - a.z), a.yaw));
    // 聞こえる: 撃った音（90m まで）・走る足音（16m まで）
    const heard = (b.fireK || 0) > 0.2 && d < 90, steps = !heard && d < 16 && (b.spd || 0) > 3.2 && b.ground !== false;
    const fov = ai.tgt === b.id ? 2.0 : 1.05;
    // 視野の端（60°〜100°）: 走っている相手の動きだけ目に入る（人の目は端で動きに気づく。見つけるのは遅い。11-20）
    const edge = ang > fov && ang < 1.75 && d < 60 && (b.spd || 0) > 2.5;
    if (ang > fov && d > 20 && !heard && !edge && !steps) continue;
    n++;
    const by = b.y + (b.st > 1.5 ? 0.35 : b.st > 0.5 ? 0.95 : 1.35);
    const mem = ai.seen || (ai.seen = {});
    const r = mem[b.id] || (mem[b.id] = { det: 0, t: -1e9 });
    // 胸が隠れていても、頭が出ていれば（低い壁・窓の下・土のうの向こう）見える。体の一部だけなので見つけにくい（11-20）
    //  見通しの結果は 0.3 秒・どちらも 0.6m 動かない間は使い回す（11-26: 撃ち合いの間、同じ相手を何度も遠くまで調べて重かった）
    let part;
    const L = r.los;
    if (L && S.t - L.t < 18 && Math.abs(L.ax - a.x) + Math.abs(L.az - a.z) < 0.6 && Math.abs(L.bx - b.x) + Math.abs(L.bz - b.z) < 0.6 && L.st === b.st && L.ast === a.st) part = L.part;
    else {
      part = 1;
      if (!wLos(w, e[0], e[1], e[2], b.x, by, b.z)) {
        const hy = b.y + (b.st > 1.5 ? 0.45 : b.st > 0.5 ? 1.15 : 1.62);
        part = wLos(w, e[0], e[1], e[2], b.x, hy, b.z) ? 0.45 : 0;
      }
      r.los = { t: S.t, ax: a.x, az: a.z, bx: b.x, bz: b.z, st: b.st, ast: a.st, part };
    }
    // 見えないが聞こえた（壁・角の向こうの銃声や足音）: 人と同じく、音のしたおおよその向き（±8°・遠いほどずれる）へ振り向く（11-26）。
    //  狙う相手がいるとき・振り向いてすぐ（1.5 秒）はしない。振り向けば、見回しで見つけられる
    if (!part && (heard || steps) && ai.tgt == null && S.t - (ai.lookT ?? -1e9) > SEC(S, 1.5)) {
      const err = (hrand(a.id, S.t, 43) - 0.5) * (0.28 + Math.min(0.3, d / 300)), ang2 = yawTo(b.x - a.x, b.z - a.z) + err;
      ai.look = [a.x + Math.sin(ang2) * d, b.y + 1.3, a.z + Math.cos(ang2) * d]; ai.lookT = S.t;
    }
    if (!part) continue;
    // 煙（発煙弾）の向こうは見えない。薄いところは見つけにくい（11-19 18:16）
    const sm = smokeBetween(S, e[0], e[1], e[2], b.x, by, b.z);
    if (sm >= 0.6) continue;
    // 遠い・伏せ・しゃがみ・茂みの向こう・麦畑の伏せは見つけにくい（見ている時間をためる）
    let k = (d < 30 ? 1 : d < 100 ? 0.6 : 0.35) * (b.st > 1.5 ? 0.45 : b.st > 0.5 ? 0.75 : 1) * ((b.spd || 0) > 1 ? 1.3 : 1) * ((b.fireK || 0) > 0.2 ? 2 : 1) * (ang < 0.5 ? 1 : ang <= fov || heard ? 0.6 : 0.35) * part;
    if (d > 12 && (b.fireK || 0) < 0.2) {
      const ck = concealK(w, e, b, by); if (ck < 0.07) continue; k *= ck;
      // 明るい外から、屋根の下（建物の中の影）にいる相手は見えにくい（撃てば光で分かる）
      if (d > 8 && underRoof(w, b.x, b.y, b.z) && !underRoof(w, a.x, a.y, a.z)) k *= 0.55;
    }
    // 撃たれて頭を下げている（制圧）と、見回しが鈍る
    k *= 1 - 0.5 * Math.min(1, a.supp || 0);
    k *= 1 - sm;
    r.det = Math.min(1.5, r.det + k * SCAN_EVERY * S.dt * 2.4);
    r.t = S.t;
    if (r.det >= 1) { found = b; break; }
  }
  if (found) {
    if (ai.tgt !== found.id) { ai.tgt = found.id; ai.reactAt = S.t + Math.round((sk.react[0] + (sk.react[1] - sk.react[0]) * hrand(a.id, S.t, 21)) / S.dt); }
    ai.seenT = S.t; ai.tgtPos = [found.x, found.y, found.z]; ai.tgtId = found.id;
    tellSquad(S, a, found);
  }
}
// 屋根の下（頭の上 4m までに天井・床がある）
function underRoof(w, x, y, z) { return ceilAt(w, x, z, y + 0.5) < y + 4; }
// 隠れ具合（1 は丸見え）: 間の茂み（目の高さの線が茂みを通る）・木の葉のかさ（11-20）・麦畑で伏せ・しゃがみ
function concealK(w, e, b, by) {
  let k = 1;
  // 木の葉のかさ（だ円の玉で見る。まん中を通ると葉が厚く、ほぼ見えない・縁は半分）。幹は見通し（los）がふさぐ
  const T = w.trees;
  if (T && T.length) {
    const gi = treeGrid(w), dx = b.x - e[0], dy = by - e[1], dz = b.z - e[2], L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(L / 8));
    const seen = new Set();
    for (let s = 0; s <= n; s++) {
      const key = Math.floor((e[0] + dx * s / n) / 16) + ',' + Math.floor((e[2] + dz * s / n) / 16);
      const L2 = gi.get(key); if (!L2) continue;
      for (const q of L2) {
        if (seen.has(q)) continue; seen.add(q);
        const c = crownOf(q);
        // だ円をまるい玉にのばした空間で、線分のいちばん近い所
        const ox = (e[0] - c[0]) / c[3], oy = (e[1] - c[1]) / c[4], oz = (e[2] - c[2]) / c[3];
        const ux = dx / c[3], uy = dy / c[4], uz = dz / c[3], uu = ux * ux + uy * uy + uz * uz;
        if (uu < 1e-9) continue;
        const t = Math.max(0.03, Math.min(0.97, -(ox * ux + oy * uy + oz * uz) / uu));
        const r = Math.hypot(ox + ux * t, oy + uy * t, oz + uz * t);
        if (r < 0.75) k *= 0.15; else if (r < 1) k *= 0.5;
        if (k < 0.05) return k;
      }
    }
  }
  const B = w.bushes;
  if (B && B.length) {
    const gi = bushGrid(w), dx = b.x - e[0], dz = b.z - e[2], L = Math.hypot(dx, dz);
    const n = Math.ceil(L / 8);
    const seen = new Set();
    for (let s = 0; s <= n; s++) {
      const x = e[0] + dx * s / n, z = e[2] + dz * s / n, key = Math.floor(x / 16) + ',' + Math.floor(z / 16);
      const L2 = gi.get(key); if (!L2) continue;
      for (const q of L2) {
        if (seen.has(q)) continue; seen.add(q);
        const t = Math.max(0, Math.min(1, ((q.x - e[0]) * dx + (q.z - e[2]) * dz) / (L * L)));
        if (t < 0.03 || t > 0.97) continue;
        const px = e[0] + dx * t, pz = e[2] + dz * t, py = e[1] + (by - e[1]) * t;
        if (Math.hypot(px - q.x, pz - q.z) < q.r * 0.85 && py < q.y + q.h && py > q.y) k *= 0.25;
      }
    }
  }
  if (b.st > 1.5 && w.fields) for (const f of w.fields) if (f.kind === 'wheat' && b.x > f.x0 && b.x < f.x1 && b.z > f.z0 && b.z < f.z1) { k *= 0.3; break; }
  return k;
}
// 木の葉のかさ [中心 x, y, z, 横の半径, 縦の半径]（render.js の遠くの形と同じ大きさ）
const _crowns = new WeakMap();
function crownOf(q) {
  let c = _crowns.get(q);
  if (c) return c;
  const s = q.s || 1;
  const birch = q.kind !== 'pine' && ((q.cyl ?? 0) * 7919) % 100 < 22;
  c = q.kind === 'pine' ? [q.x, q.y + 4.0 * s, q.z, 1.6 * s, 3.0 * s] : birch ? [q.x, q.y + 4.6 * s, q.z, 1.6 * s, 1.9 * s] : [q.x, q.y + 4.3 * s, q.z, 2.6 * s, 2.1 * s];
  _crowns.set(q, c);
  return c;
}
function treeGrid(w) {
  if (w._treeGrid) return w._treeGrid;
  const m = new Map();
  for (const q of w.trees || []) {
    const c = crownOf(q);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const key = Math.floor((c[0] + ox * c[3]) / 16) + ',' + Math.floor((c[2] + oz * c[3]) / 16);
      if (!m.has(key)) m.set(key, new Set());
      m.get(key).add(q);
    }
  }
  const out = new Map(); for (const [k, s] of m) out.set(k, [...s]);
  w._treeGrid = out;
  return out;
}
function bushGrid(w) {
  if (w._bushGrid) return w._bushGrid;
  const m = new Map();
  for (const q of w.bushes || []) {
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const key = Math.floor((q.x + ox * q.r) / 16) + ',' + Math.floor((q.z + oz * q.r) / 16);
      if (!m.has(key)) m.set(key, new Set());
      m.get(key).add(q);
    }
  }
  const out = new Map(); for (const [k, s] of m) out.set(k, [...s]);
  w._bushGrid = out;
  return out;
}

// 狙う（弾の落ちと、相手の動きの見越しを足す）。戻り値: 狙いのずれ（ラジアン）
function aimAtTgt(S, a, inp, b0, sk, dt, visible) {
  const ai = a.ai, e = eyeAI(S, a);
  const b = b0 || { id: ai.tgt, x: ai.tgtPos[0], y: ai.tgtPos[1], z: ai.tgtPos[2], st: 0, vx: 0, vz: 0 };
  const head = Math.hypot(b.x - a.x, b.z - a.z) < 20 && hrand(a.id, Math.floor(S.t / 120), 22) < 0.35;
  const ty = b.y + (b.st > 1.5 ? 0.3 : b.st > 0.5 ? (head ? 1.15 : 0.85) : (head ? 1.62 : 1.25));
  const W = curW(a), v = (W && W.vel) || 800;
  const dx0 = b.x - e[0], dz0 = b.z - e[2], d = Math.hypot(dx0, dz0), tof = d / v;
  const tx = b.x + (b.vx || 0) * tof, tz = b.z + (b.vz || 0) * tof;
  const dx = tx - e[0], dy = ty - e[1], dz = tz - e[2], h = Math.hypot(dx, dz);
  let wantYaw = yawTo(dx, dz), wantPitch = Math.atan2(dy + 0.5 * G * tof * tof, h);
  // ぶれ: 目標が変わったら大きく、狙い続けると小さく。遠いと少し大きい（体が小さく見える）。動きながらは大きい
  if (ai.aimId !== b.id) { ai.aimId = b.id; ai.aimErr = sk.err * (0.7 + 0.6 * hrand(a.id, S.t, 31)) * Math.PI / 180; ai.aimT = 0; ai.aimDir = hrand(a.id, S.t, 32) * Math.PI * 2; }
  ai.aimT += dt;
  const settle = Math.exp(-ai.aimT * 1.4);
  const rk = h < 20 ? 1 : Math.max(0.35, 1 - (h - 20) / 200);
  const mv = Math.min(1, (a.spd || 0) / 4);
  let err = ai.aimErr * (0.22 + 0.78 * settle) * rk * (1 + (a.supp || 0)) * (visible ? 1 : 2) * (1 + mv * 0.6);
  const wob = ai.aimDir + ai.aimT * 0.9;
  wantYaw += Math.cos(wob) * err; wantPitch += Math.sin(wob) * err * 0.6;
  if (W) { wantPitch -= (a.ws.rp * Math.PI / 180) * sk.comp; wantYaw -= (a.ws.ry * Math.PI / 180) * sk.comp; }
  const step = sk.turn * Math.PI / 180 * dt;
  inp.yaw = turnToward(a.yaw, wantYaw, step);
  inp.pitch = a.pitch + Math.max(-step, Math.min(step, wantPitch - a.pitch));
  return Math.abs(angDiff(inp.yaw, wantYaw)) + Math.abs(inp.pitch - wantPitch);
}

// 見る線が通る茂みの数（テスト・ほかの処理用。2つ以上で見えない）
export function bushesBetween(w, ax, ay, az, bx, by, bz) {
  const k = concealK(w, [ax, ay, az], { x: bx, z: bz, st: 0 }, by);
  return k >= 0.99 ? 0 : k > 0.2 ? 1 : 2;
}

// テスト用（中の決まりを直接確かめる）
export const _aiT = { planPath, windowSpot, insideSpot, bldsNear };
