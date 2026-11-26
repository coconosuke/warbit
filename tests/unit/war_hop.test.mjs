// 11-26 22:40: ジャンプで上に乗りたいのに乗り越えてしまう → 跳んで届く低い物で上に立てる広さがあれば、越えずに上に乗る（本家も同じボタンで、届く高さは跳ぶ）
import { test, ok, near } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { addBox, reindexBox, heightAt } from '../../src/war/world.js';
import { VAULT } from '../../src/engine/move.js';

const inp = (a, o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });
function setup(h, depth) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }), a = G.S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a));
  a.yaw = 0;
  for (let i = 0; i < 5; i++) step(G, inp(a));
  const g = a.y, b = addBox(G.w, { x0: a.x - 0.9, x1: a.x + 0.9, z0: a.z + 0.55, z1: a.z + 0.55 + depth, y0: g - 0.3, y1: g + h, kind: 'crate' });
  reindexBox(G.w, b);
  return { G, a, g, b };
}
// 世界は同じ地図で使い回されるので、足した箱は終わったら消す
const done = (b) => { b.alive = false; };
function press(G, a) {
  const ev = step(G, inp(a, { mz: 1, act: [{ a: 'vault', jump: 1 }] }));
  for (let i = 0; i < 90 && a.vault; i++) step(G, inp(a));
  for (let i = 0; i < 20; i++) step(G, inp(a));
  return ev;
}

test('低い木箱（0.6m・奥 1.2m）: 越えずに上に乗る', () => {
  const { G, a, g, b } = setup(0.6, 1.2);
  ok(VAULT.hop >= 0.6, 'hop ' + VAULT.hop);
  const ev = press(G, a);
  ok(ev.some(e => e.e === 'jump' && e.id === a.id), '跳ぶ合図');
  near(a.y, g + 0.6, 0.05, '上に乗った');
  ok(a.z > b.z0 && a.z < b.z1, '箱の上 z=' + a.z.toFixed(2));
  done(b);
});

test('低い塀（0.6m・厚さ 0.2m）: 上に立てないので向こうへ越える', () => {
  const { G, a, g, b } = setup(0.6, 0.2);
  press(G, a);
  ok(a.z > b.z1, '向こうへ z=' + a.z.toFixed(2) + ' 塀 ' + b.z1.toFixed(2));
  near(a.y, heightAt(G.w, a.x, a.z), 0.1, '地面');
  done(b);
});

test('高い物（1.1m・奥 1.2m）: 今までどおり乗り越える（跳んでは届かない）', () => {
  const { G, a, b } = setup(1.1, 1.2);
  press(G, a);
  ok(a.z > b.z1 || a.y > b.y1 - 0.05, '越えた・乗った z=' + a.z.toFixed(2) + ' y=' + a.y.toFixed(2));
  done(b);
});

test('低い木箱（0.6m）は歩いても通り抜けない（11-26: 段差が二重に効いて 0.4〜0.7m の物を通り抜けていた）', () => {
  const { G, a, b } = setup(0.6, 1.2);
  for (let i = 0; i < 60; i++) step(G, inp(a, { mz: 1 }));
  ok(a.z < b.z0, '手前で止まる z=' + a.z.toFixed(2) + ' 箱 ' + b.z0.toFixed(2));
  done(b);
});

test('乗り越えとジャンプを分けた時: 乗り越えのボタン（over）は低い木箱も越える・ジャンプのボタンは乗る／何もなければ跳ぶ', () => {
  let { G, a, b } = setup(0.6, 1.2);
  step(G, inp(a, { mz: 1, act: [{ a: 'vault', over: 1 }] }));
  for (let i = 0; i < 90 && a.vault; i++) step(G, inp(a));
  for (let i = 0; i < 20; i++) step(G, inp(a));
  ok(a.z > b.z1, '越えた z=' + a.z.toFixed(2));
  done(b);
  ({ G, a, b } = setup(0.6, 1.2));
  const ev = step(G, inp(a, { mz: 1, act: [{ a: 'jump' }] }));
  ok(ev.some(e => e.e === 'jump') && a.vault && a.vault.hop, '跳んで乗る');
  for (let i = 0; i < 90 && a.vault; i++) step(G, inp(a));
  ok(a.z > b.z0 && a.z < b.z1, '上 z=' + a.z.toFixed(2));
  done(b);
  ({ G, a, b } = setup(0.6, 0.2));
  step(G, inp(a, { act: [{ a: 'jump' }] }));
  ok(!a.vault && a.air, '薄い塀の前では乗り越えずに跳ぶ');
  done(b);
});
