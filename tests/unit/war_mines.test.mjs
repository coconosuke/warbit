// 対人地雷・クレイモア（副の道具）: 置いて 1.5 秒後から、敵が近づくと爆発。味方では作動しない。クレイモアは前の扇の中だけ
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { classLoadout } from '../../src/war/classes.js';
import { heightAt } from '../../src/war/world.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch || 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function setup() {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 3 }); step(G, {});
  const S = G.S, me = S.actors[0];
  const foes = S.actors.filter(b => b.team !== me.team).slice(0, 2), mate = S.actors.find(b => b.team === me.team && b !== me);
  for (const b of S.actors) if (b !== me && b !== mate && !foes.includes(b)) { b.alive = false; b.dead = true; }
  for (const b of [mate, ...foes]) b.ai = null;
  const put = (b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
  put(me, 790, 690); put(mate, 800, 690); put(foes[0], 820, 690); put(foes[1], 822, 690);
  me.yaw = 0;
  return { G, S, me, mate, foes, put };
}
function placeOne(G, me, id) {
  me.inv.gear = me.inv.gear.filter(g => g.id !== id); me.inv.gear.push({ id, n: 2, n0: 2 });
  for (let i = 0; i < 60 && me.ws.st !== 'ready'; i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { act: [{ a: 'gear', id }] }) });
  for (let i = 0; i < 120 && !(me.ws.slot === 2 && me.ws.st === 'gear'); i++) step(G, { [me.id]: idle(me) });
  step(G, { [me.id]: idle(me, { fire: true }) }); step(G, { [me.id]: idle(me) });
  return G.S.mines[G.S.mines.length - 1];
}

test('副の道具は C4・クレイモア・対人地雷・なし から選ぶ', () => {
  ok(classLoadout('assault', null, null, null, 'clay').gear.some(g => g[0] === 'clay' && g[1] === 2), 'クレイモア 2');
  ok(classLoadout('recon', null, null, null, 'apmine').gear.some(g => g[0] === 'apmine' && g[1] === 2), '対人地雷 2');
});

test('対人地雷: 置いてすぐは作動しない。味方が乗っても作動しない。敵が乗ると爆発して倒れる', () => {
  const { G, S, me, mate, foes, put } = setup();
  const m = placeOne(G, me, 'apmine');
  ok(m && m.kind === 'apmine', '置いた');
  eq(me.inv.gear.find(g => g.id === 'apmine').n, 1, '残り 1');
  put(foes[0], m.x, m.z);
  step(G, {});
  ok(S.mines.includes(m), '置いてすぐは作動しない');
  put(foes[0], 820, 690);
  for (let i = 0; i < 2 / S.dt; i++) step(G, {});
  put(mate, m.x + 0.3, m.z); for (let i = 0; i < 10; i++) step(G, {});
  ok(S.mines.includes(m), '味方では作動しない');
  put(mate, 800, 700); put(me, 790, 670);
  put(foes[0], m.x + 0.4, m.z);
  for (let i = 0; i < 5; i++) step(G, {});
  ok(!S.mines.includes(m), '爆発した');
  ok(!foes[0].alive || foes[0].down, '敵は倒れた');
});

test('クレイモア: 前の 3m に入った敵で爆発。後ろの敵では作動せず、爆発は前の扇の中だけ', () => {
  const { G, S, me, mate, foes, put } = setup();
  const m = placeOne(G, me, 'clay');
  for (let i = 0; i < 2 / S.dt; i++) step(G, {});
  put(me, 790, 670); put(mate, 800, 700);
  // 後ろ（-z）の敵
  put(foes[0], m.x, m.z - 1.5); for (let i = 0; i < 5; i++) step(G, {});
  ok(S.mines.includes(m), '後ろでは作動しない');
  // 前の敵（2m）と、横 2m の敵
  put(foes[0], m.x, m.z + 2); put(foes[1], m.x + 2.5, m.z - 0.2);
  for (let i = 0; i < 5; i++) step(G, {});
  ok(!S.mines.includes(m), '爆発した');
  ok(!foes[0].alive || foes[0].down, '前の敵は倒れた');
  ok(foes[1].alive && !foes[1].down && foes[1].hp === foes[1].maxHp, '扇の外の敵は無事 ' + foes[1].hp);
});

test('ボット: 守る拠点に着くとクレイモアか地雷を置いて、銃に戻す', () => {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 9, bots: true, per: 8 }); step(G, {});
  const S = G.S;
  let placed = 0, holding = 0;
  for (let i = 0; i < 150 / S.dt; i++) { step(G, {}); }
  placed = (S.mines || []).filter(m => S.byId[m.by] && S.byId[m.by].ai).length;
  holding = S.actors.filter(a => a.ai && a.alive && a.ws.slot === 2 && (a.ws.gear === 'clay' || a.ws.gear === 'apmine')).length;
  ok(placed > 0, 'ボットが置いた ' + placed);
  ok(holding <= 2, '持ったままのボットは少ない ' + holding);
});

// 11-27（BattleBit の wiki）: 撃たれると爆発する（作動前でも・どちらの側の弾でも）。1 人 4 つまで。誘爆の距離は爆発物ごと
import { placeMine, MINE } from '../../src/engine/mines.js';
import { spawnBullet } from '../../src/engine/combat.js';
import { curW, curWeapon } from '../../src/engine/actor.js';
import { AMMO } from '../../src/engine/data/weapons.js';
test('対人地雷を撃つと爆発する（置いてすぐでも）。近くの敵は巻き込まれる', () => {
  const { G, S, me, mate, foes, put } = setup();
  put(mate, 760, 700);
  const m = placeMine(S, G.w, foes[0], 'apmine', []);
  m.y = heightAt(G.w, m.x, m.z);
  put(me, m.x - 6, m.z); put(foes[1], m.x + 0.8, m.z + 0.3); put(foes[0], m.x + 30, m.z);
  // 自分の銃の弾を、地雷の 1.5m 上から真下へ（撃った弾が地面より先に地雷に当たるように）
  const W = curW(me), wi = curWeapon(me), am = AMMO[W.cal][wi.am];
  const b = spawnBullet(S, me, W, wi, am, 0, -1, 0);
  b.x = m.x; b.y = m.y + 1.5; b.z = m.z; b.dist = 5;
  for (let i = 0; i < 6; i++) step(G, {});
  ok(!S.mines.includes(m), '撃って爆発した');
  ok(!foes[1].alive || foes[1].down, 'そばの敵は倒れた');
});
test('置いておけるのは 1 人 4 つまで（5 つ目で古い物が消える）', () => {
  const { G, S, me } = setup();
  const L = [];
  for (let i = 0; i < 5; i++) { me.x += 2; L.push(placeMine(S, G.w, me, 'clay', [])); }
  const mine = S.mines.filter(q => q.by === me.id && q.kind === 'clay');
  eq(mine.length, MINE.max, '4 つ');
  ok(!S.mines.includes(L[0]) && S.mines.includes(L[4]), 'いちばん古い物が消えた');
});
test('誘爆の距離: 対人地雷 8m・クレイモア 4m（wiki の Triggerable）', () => {
  eq(MINE.apmine.trig, 8); eq(MINE.clay.trig, 4);
  eq(MINE.apmine.blast.r, 5); eq(MINE.clay.blast.r, 4); eq(MINE.clay.blast.dmg, 200);
});
