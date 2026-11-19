// 大規模戦の点: 倒す 200（ダウンさせた時に入る・起こされても取り消さない・二重に入らない）、頭は距離で上乗せ、支援・起こす・拠点
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { pvpDamage } from '../../src/engine/combat.js';
import WAR, { PTS, hsBonus } from '../../src/engine/modes/war.js';
import { heightAt } from '../../src/war/world.js';

// 1歩進めておく（ダウンの規則などのフックが入る）
function game(o = {}) { const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); step(G, {}); return G; }
const put = (G, b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
// 撃った結果の出来事を、戦のモードの onEvents に通す（step の中と同じ）
function hit(G, v, d, by, part = 'chest') { const ev = []; pvpDamage(G.S, v, d, by, part, 0, 1, ev, 'bullet'); WAR.onEvents(G.S, G.w, ev); return ev; }

test('倒す: ダウンさせた時に 200 が入り、出血で死んでも二重には入らない', () => {
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0];
  const foe = S.actors.find(b => b.team === 1);
  put(G, me, 790, 690); put(G, foe, 790, 720);
  const ev = hit(G, foe, 500, me);
  ok(foe.down, 'ダウンした');
  const sc = ev.filter(e => e.e === 'score' && e.id === me.id);
  eq(sc.length, 1, '点の出来事は1つ');
  eq(sc[0].pts, PTS.kill, '200'); eq(sc[0].why, 'kill', '倒した'); eq(sc[0].d, 30, '距離 30m');
  eq(me.stats.sc, 200, '自分の点');
  hit(G, foe, 500, me);
  ok(foe.dead, '止め');
  eq(me.stats.sc, 200, '止めでは増えない');
});

test('頭への一発: 距離で上乗せ（近くは 100、400m で 400）', () => {
  eq(hsBonus(20), 100, '近い'); eq(hsBonus(400), 400, '400m'); eq(hsBonus(2000), 500, '上限');
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0];
  const foe = S.actors.find(b => b.team === 1);
  put(G, me, 790, 600); put(G, foe, 790, 800);
  const ev = hit(G, foe, 500, me, 'head');
  const s = ev.find(e => e.e === 'score' && e.id === me.id);
  ok(s, '点が入る');
  eq(s.hs, hsBonus(s.d), '上乗せ'); eq(s.pts, 200 + s.hs, '合計');
});

test('支援と起こす: 30 以上撃った味方に 100、ダウンした味方を起こすと 100（起きた敵をまた倒すとまた入る）', () => {
  const G = game({ bots: true, per: 3 }), S = G.S, me = S.actors[0];
  const mate = S.actors.find(b => b.team === 0 && b !== me), foe = S.actors.find(b => b.team === 1);
  const foe2 = S.actors.find(b => b.team === 1 && b !== foe);
  put(G, me, 790, 690); put(G, mate, 792, 690); put(G, foe, 790, 720);
  hit(G, foe, 40, me);
  hit(G, foe, 500, mate);
  ok(foe.down, 'ダウン');
  eq(mate.stats.sc, 200, '倒した味方');
  eq(me.stats.sc, 100, '支援');
  // 敵が起こされる（起こした敵に 100）→ もう一度倒すと、また入る
  foe2.pid = 99;
  const ev = [{ e: 'revive', id: foe.id, by: foe2.id }];
  foe.down = false; foe.dbno = 0; foe.hp = 50;
  WAR.onEvents(S, G.w, ev);
  eq(foe2.stats.sc, 100, '起こした');
  ok(ev.some(e => e.e === 'score' && e.id === foe2.id && e.why === 'revive'), '人には点の出来事');
  foe.dmgBy = {};
  hit(G, foe, 500, me);
  eq(me.stats.sc, 300, 'もう一度倒すと入る');
});

test('拠点: 奪った時に範囲にいた側の全員へ 200（範囲の外はなし）', () => {
  const G = game({ bots: true, per: 3 }), S = G.S;
  const f = S.m.flags[0];
  const mine = S.actors.filter(b => b.team === 0);
  for (const b of S.actors) if (b.team === 1) { b.alive = false; b.dead = true; }
  put(G, mine[0], f.x, f.z); put(G, mine[1], f.x + 1, f.z); put(G, mine[2], f.x + f.r + 30, f.z);
  for (const b of mine) b.ai = null;
  f.owner = -1; f.prog = 0.98;
  const inp = {}; for (const b of mine) inp[b.id] = { mx: 0, mz: 0, yaw: b.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null };
  let got = false;
  for (let i = 0; i < 60 && !got; i++) { for (const b of mine.slice(0, 2)) put(G, b, b === mine[0] ? f.x : f.x + 1, f.z); step(G, inp); got = f.owner === 0; }
  ok(got, '奪った');
  eq(mine[0].stats.sc, PTS.cap, '範囲の中'); eq(mine[1].stats.sc, PTS.cap, '範囲の中');
  ok(!mine[2].stats.sc, '範囲の外はなし');
});

test('分隊長の目標: 敵のいない向きで印 → 狙っている拠点が分隊の目標（ボットの指揮より優先）。分隊長でないと決められない', async () => {
  const { goalOf } = await import('../../src/war/ai.js');
  const G = game({ bots: true, per: 4 }), S = G.S, me = S.actors[0];
  ok(me.sqIdx === 0, '自分は分隊長');
  for (const b of S.actors) if (b.team === 1) { b.alive = false; b.dead = true; }
  const key = me.team + ':' + me.squad;
  const want = S.m.flags.find(f => f.id !== S.m.sqGoal[key]) || S.m.flags[0];
  me.yaw = Math.atan2(want.x - me.x, want.z - me.z); me.pitch = 0;
  const ev = []; me.spotT = -1e9;
  const { spotEnemy } = await import('../../src/engine/modes/war.js');
  spotEnemy(S, G.w, me, ev);
  const o = ev.find(e => e.e === 'order');
  ok(o && o.f === want.id, '目標の出来事 ' + JSON.stringify(ev));
  eq(S.m.sqGoal[key], want.id, '分隊の目標');
  for (let i = 0; i < 200; i++) step(G, {});
  eq(S.m.sqGoal[key], want.id, '指揮（2秒ごと）でも変わらない');
  const mate = S.actors.find(b => b.team === me.team && b.squad === me.squad && b !== me && b.ai);
  ok(!mate || goalOf(S, mate) === want, '分隊のボットもそこへ');
  // 分隊長でない人
  const m2 = S.actors.find(b => b.team === me.team && b.sqIdx === 1);
  const ev2 = []; m2.alive = true; m2.down = false; m2.spotT = -1e9; m2.yaw = me.yaw;
  spotEnemy(S, G.w, m2, ev2);
  ok(!ev2.some(e => e.e === 'order'), '分隊長でないと決められない');
});

test('分隊ポイント: 目標の範囲で倒すと 50、目標を奪うと 1000（目標でない拠点は 0）', () => {
  const G = game({ bots: true, per: 3 }), S = G.S, me = S.actors[0];
  const key = me.team + ':' + me.squad;
  const f = S.m.flags[0], g = S.m.flags[1];
  S.m.sqOrder = { [key]: { f: f.id, by: me.id, own: false } }; S.m.sqGoal[key] = f.id;
  const foe = S.actors.find(b => b.team === 1);
  put(G, me, f.x, f.z); put(G, foe, f.x + 5, f.z);
  const ev = hit(G, foe, 500, me);
  const sp = ev.find(e => e.e === 'sqp');
  ok(sp && sp.pts === 50 && sp.n === 50, '目標で倒すと 50 ' + JSON.stringify(sp));
  // 目標でない拠点を奪う: 分隊ポイントは入らない（個人の点は入る）
  for (const b of S.actors) if (b.team === 1) { b.alive = false; b.dead = true; }
  for (const b of S.actors) if (b.team === 0 && b !== me) { b.alive = false; b.dead = true; }
  const run = (fl) => { fl.owner = -1; fl.prog = 0.98; for (let i = 0; i < 60 && fl.owner !== 0; i++) { put(G, me, fl.x, fl.z); step(G, { [me.id]: { mx: 0, mz: 0, yaw: me.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null } }); } return fl.owner === 0; };
  ok(run(g), '目標でない拠点を奪った');
  eq(S.m.sqp[key], 50, '目標でない拠点は 0');
  S.m.sqOrder[key] = { f: f.id, by: me.id, own: false }; S.m.sqGoal[key] = f.id;
  ok(run(f), '目標を奪った');
  eq(S.m.sqp[key], 1050, '目標を奪うと 1000');
  ok(!S.m.sqOrder[key], '奪い終えると分隊長の目標は解ける');
});
