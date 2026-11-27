// 11-27: 大規模戦のボットの弾も減る。主の銃が空になったら拳銃へ持ち替え、少なくなったら近くの味方の弾薬箱へ行って補給する
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt } from '../../src/war/world.js';

function setup() {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 2 }); step(G, {});
  const S = G.S, bot = S.actors.find(b => b.ai && b.team === 0);
  for (const b of S.actors) if (b !== bot) { b.alive = false; b.dead = true; }
  const put = (b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };
  put(bot, 790, 690);
  return { G, S, bot, put };
}

test('ボットの弾も減る・主の銃が空なら拳銃に持ち替える', () => {
  const { G, S, bot } = setup();
  for (let i = 0; i < 30; i++) step(G, {});
  const w0 = bot.inv.w[0];
  ok(w0.mags && w0.mags.length > 0, '予備あり');
  w0.mags.splice(0); w0.mag = 0; w0.ch = 0;
  let sw = false;
  for (let i = 0; i < 4 / S.dt && !sw; i++) { step(G, {}); if (bot.ws.slot === 1) sw = true; }
  ok(sw, '拳銃へ ' + bot.ws.slot);
  // リロードしても予備は増えない（前は空になると満タンに戻っていた）
  ok(w0.mags.length === 0, '主の銃の予備は 0 のまま ' + w0.mags.length);
});

test('弾が少ないボットは近くの弾薬箱へ行き、満ちるまで補給して、主の銃に戻る', () => {
  const { G, S, bot } = setup();
  for (let i = 0; i < 30; i++) step(G, {});
  const w0 = bot.inv.w[0], n0 = w0.spare0;
  w0.mags.splice(0); w0.mag = 0; w0.ch = 0;
  S.ammo = S.ammo || [];
  S.ammo.push({ id: 77, team: bot.team, big: true, aid: 100, thr: 50, gad: 100, left: 244, x: bot.x + 12, y: heightAt(G.w, bot.x + 12, bot.z), z: bot.z, yaw: 0, t: S.t, by: -1 });
  let near = false;
  for (let i = 0; i < 30 / S.dt; i++) { step(G, {}); if (Math.hypot(bot.x - (bot.x - bot.x + 802), bot.z - 690) < 2) near = true; if (w0.mags.length >= n0 * 0.9 && bot.ws.slot === 0) break; }
  ok(near, '箱のそばへ行った');
  ok(w0.mags.length >= Math.floor(n0 * 0.9), '補給された ' + w0.mags.length + '/' + n0);
  ok(bot.ws.slot === 0, '主の銃に戻った ' + bot.ws.slot);
});
