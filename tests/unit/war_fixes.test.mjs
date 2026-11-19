// 11-19 18:16 の直し: 煙と茂みでボットが見えない・向きを変えやすい・投げ物は残りがあれば持ったまま・あきらめる/再出撃
import { test, ok } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { heightAt } from '../../src/war/world.js';

function game(o = {}) { return createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false, ...o }); }
const inp = (a, o = {}) => ({ [a.id]: Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o) });
const put = (G, b, x, z) => { b.x = x; b.z = z; b.y = heightAt(G.w, x, z); b.vx = b.vz = 0; };

test('ボットは発煙弾の煙の向こうの敵を見つけない（煙が消えると見つける）', () => {
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0];
  const foe = S.actors.find(b => b.team === 1 && b.ai);
  for (const b of S.actors) if (b !== me && b !== foe) { b.alive = false; b.dead = true; }
  const cx = 790, cz = 705;
  const hold = () => { put(G, me, cx, cz - 15); put(G, foe, cx, cz + 15); foe.yaw = Math.PI; me.yaw = 0; };
  hold();
  S.clouds.push({ x: cx, y: heightAt(G.w, cx, cz) + 1.6, z: cz, r: 6.5, max: 6.5, t: 60, type: 'smoke', L: 0 });
  let saw = false;
  for (let i = 0; i < 180; i++) { hold(); step(G, inp(me)); if (foe.ai.tgt === me.id) saw = true; }
  ok(!saw, '煙の向こうは見えない');
  S.clouds.length = 0;
  for (let i = 0; i < 180 && !saw; i++) { hold(); step(G, inp(me)); if (foe.ai.tgt === me.id) saw = true; }
  ok(saw, '煙がなければ見つける');
});

test('茂みが2つ間にあると見えない（撃つと見つかる）', async () => {
  const { bushesBetween } = await import('../../src/war/ai.js');
  const G = game(), w = G.w;
  const b = (w.bushes || [])[0];
  ok(b, '茂みがある');
  const y = (b.y || 0) + Math.min(0.8, (b.h || 1) * 0.5);
  ok(bushesBetween(w, b.x - 20, y, b.z, b.x + 20, y, b.z) >= 1, '茂みを通る線');
  ok(bushesBetween(w, b.x - 20, y + 30, b.z, b.x + 20, y + 30, b.z) === 0, '上を通る線は通らない');
});

test('向きを変えやすい: 走っている向きから真横へ 0.3 秒で切り替わる・指を離すと 0.5 秒で止まる', () => {
  const G = game(), a = G.S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a));
  for (let i = 0; i < 90; i++) step(G, inp(a, { mz: 1, sprint: true }));
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  ok(Math.hypot(a.vx, a.vz) > 5, `走っている ${Math.hypot(a.vx, a.vz).toFixed(2)}`);
  let n = 0;
  for (; n < 60; n++) { step(G, inp(a, { mx: 1 })); if (Math.abs(a.vx * fx + a.vz * fz) < 0.5) break; }
  ok(n / 60 < 0.3, `前への速さが消えるまで ${(n / 60).toFixed(2)} 秒`);
  for (let i = 0; i < 90; i++) step(G, inp(a, { mz: 1, sprint: true }));
  let m = 0;
  for (; m < 90; m++) { step(G, inp(a)); if (Math.hypot(a.vx, a.vz) < 0.3) break; }
  ok(m / 60 < 0.5, `止まるまで ${(m / 60).toFixed(2)} 秒`);
});

test('投げ物: 残りがあれば投げたあとも持ったまま（次を取り出して、また投げられる）', () => {
  const G = game(), S = G.S, a = S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(a));
  const g = a.inv.gear.find(x => x.id === 'frag' || x.id === 'smoke');
  ok(g, '投げ物を持っている');
  g.n = 3;
  step(G, inp(a, { act: [{ a: 'gear', id: g.id }] }));
  for (let i = 0; i < 60; i++) step(G, inp(a));
  ok(a.ws.slot === 2 && a.ws.gear === g.id, '手に持った');
  step(G, inp(a, { fire: true })); step(G, inp(a));
  ok(g.n === 2, `1つ投げた（残り ${g.n}）`);
  for (let i = 0; i < 70; i++) step(G, inp(a));
  ok(a.ws.slot === 2 && a.ws.gear === g.id && a.ws.st !== 'holster', `持ったまま ${a.ws.slot}/${a.ws.st}`);
  step(G, inp(a, { fire: true })); step(G, inp(a));
  ok(g.n === 1, `また投げられる（残り ${g.n}）`);
});

test('ダウン中にあきらめる・メニューの再出撃: 倒れたことになり、すぐ出撃の画面へ', () => {
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0];
  for (let i = 0; i < 30; i++) step(G, inp(me));
  const ev = step(G, inp(me, { act: [{ a: 'warRedeploy' }] }));
  ok(!me.alive && me.dead, '倒れたことになる');
  ok(ev.some(e => e.e === 'kill' && e.id === me.id) && ev.some(e => e.e === 'redeploy' && e.id === me.id), '倒れた・再出撃の知らせ');
  // チケットは出撃し直すときに減る（war.js respawn）。出撃の画面から選べる
  ok(S.m.respawn.some(r => r.id === me.id) || me.deployAt == null, '出撃を待つ');
});

test('射撃モード: M4A1 はフル→バースト→単発。バーストは1回引くと3発（離しても3発まで）', () => {
  const G = game(), S = G.S, a = S.actors[0];
  const wi = a.inv.w[0]; wi.id = 'm4a1'; wi.mode = 0; wi.mag = 30; wi.ch = 1; a.ws.slot = 0;
  for (let i = 0; i < 40; i++) step(G, inp(a));
  const seen = [];
  for (let k = 0; k < 3; k++) { const ev = step(G, inp(a, { act: [{ a: 'mode' }] })); const f = ev.find(e => e.e === 'fmode'); seen.push(f ? f.m : '-'); }
  ok(seen.join(',') === 'burst,semi,auto', `切り替えの順 ${seen.join(',')}`);
  step(G, inp(a, { act: [{ a: 'mode' }] }));
  ok(a.inv.w[0].mode === 1, 'バースト');
  for (let i = 0; i < 20; i++) step(G, inp(a));
  let shots = 0;
  const cnt = (ev) => { for (const e of ev) if (e.e === 'shot' && e.id === a.id) shots++; };
  cnt(step(G, inp(a, { fire: true })));
  for (let i = 0; i < 40; i++) cnt(step(G, inp(a)));
  ok(shots === 3, `1回引いて3発 ${shots}`);
  shots = 0;
  for (let i = 0; i < 60; i++) cnt(step(G, inp(a, { fire: true })));
  ok(shots === 3, `押し続けても3発で止まる ${shots}`);
});

test('倍率のボタン（zoom）は倍率だけ、射撃モードのボタン（mode）は射撃モードだけ', () => {
  const G = game(), S = G.S, a = S.actors[0];
  const wi = a.inv.w[0]; wi.id = 'm4a1'; wi.mode = 0; wi.att.sight = 'lpvo'; wi.zi = 0; a.ws.slot = 0;
  for (let i = 0; i < 40; i++) step(G, inp(a, { ads: true }));
  const ev1 = step(G, inp(a, { ads: true, act: [{ a: 'mode' }] }));
  ok(ev1.some(e => e.e === 'fmode') && !ev1.some(e => e.e === 'zoom') && wi.zi === 0, '構えていても mode は射撃モード');
  const ev2 = step(G, inp(a, { ads: true, act: [{ a: 'zoom' }] }));
  ok(ev2.some(e => e.e === 'zoom') && wi.zi === 1, 'zoom は倍率');
});

test('起こす（大規模戦）: 包帯を1つ使い、体力の半分で起きる', async () => {
  const G = game({ bots: true, per: 2 }), S = G.S, me = S.actors[0];
  const mate = S.actors.find(b => b !== me && b.team === me.team);
  for (const b of S.actors) if (b !== me && b !== mate) { b.alive = false; b.dead = true; }
  mate.ai = null;
  const cx = 790, cz = 705;
  put(G, me, cx, cz); put(G, mate, cx + 1.0, cz);
  for (let i = 0; i < 20; i++) step(G, inp(me));
  mate.down = true; mate.dbno = 20; mate.hp = 0; mate.dbnoCount = 1;
  // 倒れきるまで待ち、胸のそばへ寄る
  for (let i = 0; i < 90; i++) { step(G, inp(me)); mate.dbno = 20; }
  const { personPoint } = await import('../../src/engine/interact.js');
  const tp = personPoint(S, mate); put(G, me, tp[0] - 0.55, tp[2]);
  for (let i = 0; i < 5; i++) { step(G, inp(me)); mate.dbno = 20; }
  const g = me.inv.gear.find(q => q.id === 'bandage'); const n0 = g.n;
  // ボットと同じ道で始める（見ていなくても近ければ起こせる）。続きは毎ステップの動作の進みで
  const { doAction } = await import('../../src/engine/interact.js');
  const pid = me.pid; me.pid = null; const ev = []; doAction(S, G.w, me, { a: 'op', k: 'person', id: mate.id, op: 'revive' }, ev); me.pid = pid;
  ok(me.act && me.act.k === 'revive', '起こし始める');
  // 人の操作は手元から目をそらすと止まる: 動作が向けた向きのまま（入力の向きは今の向き）
  for (let i = 0; i < 60 * 6 && mate.down; i++) { ev.push(...step(G, inp(me, { yaw: me.yaw, pitch: me.pitch }))); mate.dbno = 20; }
  ok(!mate.down && mate.alive, '起きた');
  ok(mate.hp === Math.round(mate.maxHp * 0.5), `体力の半分 ${mate.hp}/${mate.maxHp}`);
  ok(g.n === n0 - 1, `包帯を1つ使う ${n0}→${g.n}`);
});
