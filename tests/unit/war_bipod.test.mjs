// 11-27: 二脚（伏せるか物に載せると自動で立ち、揺れがなくなり反動が小さい）と、16 倍より上のスコープ（15・20・40 倍）
import { test, ok, eq } from '../lib/t.mjs';
import { createGame, step } from '../../src/engine/engine.js';
import { attachOptions, zoomOf, ATTACH, opticOf } from '../../src/engine/data/weapons.js';
import { heightAt } from '../../src/war/world.js';
import { BIPOD } from '../../src/engine/weapon.js';

const idle = (a, o = {}) => Object.assign({ mx: 0, mz: 0, yaw: a.yaw, pitch: 0, stance: 0, lean: 0, sprint: false, fire: false, ads: false, act: null }, o);
function setup(grip) {
  const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false });
  const S = G.S, me = S.actors[0];
  step(G, {});
  const x = 790, z = 705; Object.assign(me, { x, z, y: heightAt(G.w, x, z), vx: 0, vz: 0, yaw: 0 });
  const wi = me.inv.w[0]; wi.att.grip = grip;
  return { G, S, me, wi };
}

test('狙撃銃に 15・20・40 倍のスコープと二脚を付けられる。倍率は固定で、照準の模様は狙撃用', () => {
  const o = attachOptions('at308');
  for (const s of ['scope15', 'scope20', 'scope40']) ok(o.sight.includes(s), s);
  ok(o.grip.includes('bipod'), '二脚');
  eq(zoomOf({ att: { sight: 'scope40' } }), 40);
  eq(opticOf({ att: { sight: 'scope20' } }).kind, 'sniper');
  ok(ATTACH.grip.bipod.bipod, '二脚の印');
});

test('二脚: 伏せて構えると立ち、揺れがなくなる。立って何もない所では立たない', () => {
  const { G, S, me } = setup('bipod');
  for (let i = 0; i < 200; i++) step(G, { [me.id]: idle(me, { stance: 2, ads: true }) });
  ok(me.st > 1.9 && me.ads > 0.9, '伏せて構えた');
  ok(me.bip, '二脚が立った');
  eq(me.ws.sx, 0, '横の揺れなし'); eq(me.ws.sy, 0, '縦の揺れなし');
  for (let i = 0; i < 200; i++) step(G, { [me.id]: idle(me, { stance: 0, ads: true }) });
  ok(!me.bip, '立つと二脚は立たない');
  ok(Math.abs(me.ws.sx) + Math.abs(me.ws.sy) > 0, '揺れる');
});

test('二脚が立っている間は反動が小さい（0.6 倍）。二脚がなければ伏せても立たない', () => {
  const kick = (grip) => {
    const { G, S, me } = setup(grip);
    for (let i = 0; i < 200; i++) step(G, { [me.id]: idle(me, { stance: 2, ads: true }) });
    const rp0 = me.ws.rp, sh = me.stats.sh, bip = !!me.bip;
    for (let i = 0; i < 4 && me.stats.sh === sh; i++) step(G, { [me.id]: idle(me, { stance: 2, ads: true, fire: true }) });
    return { k: me.ws.rp - rp0, bip };
  };
  const a = kick('bipod'), b = kick('none');
  ok(a.bip && !b.bip, '二脚の有無');
  ok(Math.abs(a.k / b.k - BIPOD.recoil) < 0.08, `反動 ${a.k.toFixed(3)} / ${b.k.toFixed(3)}`);
});

test('バイポッド（本家の Wiki）: 立てていない時は反動 1.4 倍・腰だめでは立たない・上下に向けすぎると立たない・構えが遅い', () => {
  const kick = (grip, o = {}) => {
    const { G, S, me } = setup(grip);
    for (let i = 0; i < 200; i++) step(G, { [me.id]: idle(me, { stance: o.stance ?? 0, ads: o.ads ?? true, pitch: o.pitch ?? 0 }) });
    const rp0 = me.ws.rp, sh = me.stats.sh, bip = !!me.bip, ads = me.ads;
    for (let i = 0; i < 4 && me.stats.sh === sh; i++) step(G, { [me.id]: idle(me, { stance: o.stance ?? 0, ads: o.ads ?? true, pitch: o.pitch ?? 0, fire: true }) });
    return { k: me.ws.rp - rp0, bip, ads };
  };
  // 立って何もない所（立たない）: バイポッドあり / なし
  const off = kick('bipod'), none = kick('none');
  ok(!off.bip, '立たない');
  ok(Math.abs(off.k / none.k - BIPOD.offFirst) < 0.12, `立てていない時の初弾の反動 ${off.k.toFixed(3)} / ${none.k.toFixed(3)}`);
  // 伏せて腰だめ: 立たない。伏せて構える: 立つ。伏せて構えても真上近くを向くと立たない
  ok(!kick('bipod', { stance: 2, ads: false }).bip, '腰だめでは立たない');
  ok(kick('bipod', { stance: 2 }).bip, '伏せて構えると立つ');
  ok(!kick('bipod', { stance: 2, pitch: 0.6 }).bip, '上へ向けすぎると立たない');
  // 構えの時間: 付けるだけで遅い
  const t = (grip) => { const { G, S, me } = setup(grip); for (let i = 0; i < 120; i++) step(G, { [me.id]: idle(me) }); let n = 0; for (; n < 300 && me.ads < 0.99; n++) step(G, { [me.id]: idle(me, { ads: true }) }); return n; };
  const tb = t('bipod'), tn = t('none');
  ok(tb > tn * 1.5, '構えが遅い ' + tb + ' / ' + tn);
});
