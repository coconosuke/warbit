// 11-27 16:51「弾薬箱をくれ等の指示や要請ができるボタン。アイテム選択同様ホイールで選ぶ。ai もそれに反応するように」
//  要請（requests.js）: 弾薬をくれ・衛生兵・ついて来い・ここを守れ・敵発見・ありがとう。ボットが応える
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt } from '../../src/war/world.js';
import { REQ, REQ_ORDER } from '../../src/war/requests.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
// 自分と味方のボット 1 人だけ（ほかは消す）。場所は開けた所
function setup(o = {}) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: true, per: 4 });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const B = S.actors.find(b => b !== me && b.team === me.team && b.ai && b.alive);
  for (const b of S.actors) if (b !== me && b !== B) { b.alive = false; b.dead = true; }
  const x = 790, z = 705;
  Object.assign(me, { x, y: heightAt(G.w, x, z), z, vx: 0, vz: 0, yaw: 0 });
  const bx = x + (o.d || 22), bz = z + 4;
  Object.assign(B, { x: bx, y: heightAt(G.w, bx, bz), z: bz, vx: 0, vz: 0, squad: me.squad });
  B.ai.tgt = null;
  return { G, S, me, B };
}
const run = (G, me, sec, o = {}, stop) => { const S = G.S, L = []; for (let i = 0; i < Math.round(sec / S.dt); i++) { const ev = step(G, { [me.id]: idle(me, typeof o === 'function' ? o(i) : o) }); for (const e of ev) L.push(e); if (stop && stop(L)) break; } return L; };
const req = (G, me, k) => { const ev = step(G.G || G, { [me.id]: idle(me, { act: [{ a: 'req', k }] }) }); return ev.find(e => e.e === 'req'); };

test('要請の言葉: 円に出す 6 つ（弾薬・衛生兵・ついて来い・ここを守れ・敵発見・ありがとう）', () => {
  eq(REQ_ORDER.length, 6);
  for (const k of REQ_ORDER) ok(REQ[k] && REQ[k].label, k);
  eq(REQ.ammo.label, '弾薬をくれ');
});

test('弾薬をくれ: 弾薬箱を持った味方のボットが来て、足もとに箱を置く', () => {
  const { G, S, me, B } = setup();
  B.inv.gear = B.inv.gear.filter(g => g.id !== 'ammobig' && g.id !== 'ammosmall'); B.inv.gear.push({ id: 'ammobig', n: 2 });
  const e = req(G, me, 'ammo');
  ok(e && e.to.includes(B.id), '応えるのは弾薬箱を持ったボット ' + JSON.stringify(e));
  const L = run(G, me, 25, {}, L => L.some(x => x.e === 'reqDone'));
  const done = L.find(x => x.e === 'reqDone');
  ok(done && done.id === B.id && done.k === 'ammo', '箱を置いた');
  const box = (S.ammo || []).find(b => b.team === me.team);
  ok(box && Math.hypot(box.x - me.x, box.z - me.z) < 4.5, '自分の近くに箱 ' + (box ? Math.hypot(box.x - me.x, box.z - me.z).toFixed(1) : 'なし'));
  eq(B.inv.gear.find(g => g.id === 'ammobig').n, 1, '箱が 1 つ減った');
  // もう近くに箱がある: 「そこにある」（だれも来ない）
  for (let i = 0; i < 100; i++) step(G, {});
  const e2 = req(G, me, 'ammo'); ok(e2 && e2.why === 'box' && !e2.to.length, '近くに箱 ' + JSON.stringify(e2));
});

test('弾薬をくれ: 弾薬箱を持った味方がいなければ「いない」', () => {
  const { G, me, B } = setup();
  B.inv.gear = B.inv.gear.filter(g => g.id !== 'ammobig' && g.id !== 'ammosmall');
  const e = req(G, me, 'ammo'); ok(e && e.why === 'none' && !e.to.length, JSON.stringify(e));
});

test('衛生兵: けがをしていると衛生のボットが来て治す。けががなければ「大丈夫」', () => {
  const { G, me, B } = setup();
  const e0 = req(G, me, 'medic'); ok(e0 && e0.why === 'fine', 'けがなし ' + JSON.stringify(e0));
  for (let i = 0; i < 100; i++) step(G, {});
  B.warCls = 'medic'; me.hp = me.maxHp * 0.4;
  const e = req(G, me, 'medic'); ok(e && e.to.includes(B.id), '衛生が応える ' + JSON.stringify(e));
  const L = run(G, me, 40, {}, L => L.some(x => x.e === 'reqDone'));
  ok(L.some(x => x.e === 'reqDone' && x.k === 'medic'), '治し終えた（体力 ' + Math.round(me.hp) + '）');
  ok(me.hp >= me.maxHp * 0.95, '体力が戻った ' + Math.round(me.hp));
});

test('ついて来い: 分隊のボットが後ろについて来る。もう一度でやめる', () => {
  const { G, S, me, B } = setup({ d: 15 });
  const e = req(G, me, 'follow'); ok(e && e.to.includes(B.id), JSON.stringify(e));
  // 20 秒、北へ歩く
  run(G, me, 20, { mz: 1, yaw: 0 });
  const d = Math.hypot(B.x - me.x, B.z - me.z);
  ok(d < 10, 'ついて来ている ' + d.toFixed(1) + 'm（歩いた ' + (me.z - 705).toFixed(0) + 'm）');
  for (let i = 0; i < 100; i++) step(G, {});
  const off = req(G, me, 'follow'); ok(off && off.off && !B.ai.req, 'やめた');
});

test('ここを守れ: 分隊のボットがその場所のまわりへ行って見張る', () => {
  const { G, me, B } = setup({ d: 30 });
  const e = req(G, me, 'guard'); ok(e && e.to.includes(B.id), JSON.stringify(e));
  const x0 = me.x, z0 = me.z;
  run(G, me, 4, { mz: -1, yaw: 0 });
  run(G, me, 16);
  const d = Math.hypot(B.x - x0, B.z - z0);
  ok(d < 7, '言われた場所のまわり ' + d.toFixed(1) + 'm');
});

test('敵発見: 照準の先に印（分隊の知らせ）。分隊のボットがそちらを見る', () => {
  const { G, S, me, B } = setup();
  me.yaw = 0; me.pitch = -0.02;
  const e = req(G, me, 'enemy');
  ok(e && e.x != null && e.z > me.z + 5, '照準の先 ' + JSON.stringify([e && e.x, e && e.z]));
  ok(S.m.intel && S.m.intel[me.team].has('p' + me.id), '分隊の知らせに入る');
  ok(B.ai.look && Math.abs(B.ai.look[2] - e.z) < 1, 'ボットがそちらを見る');
});

test('ありがとう: 出来事だけ（ボットは動かない）。倒れている間は衛生兵とありがとうだけ', () => {
  const { G, me, B } = setup();
  const e = req(G, me, 'thanks'); ok(e && e.k === 'thanks' && !B.ai.req, JSON.stringify(e));
  for (let i = 0; i < 100; i++) step(G, {});
  me.down = true; me.dbno = 20;
  const e2 = step(G, { [me.id]: idle(me, { act: [{ a: 'req', k: 'ammo' }] }) }).find(x => x.e === 'req');
  ok(!e2, '倒れていると弾薬は頼めない');
});
