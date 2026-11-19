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
