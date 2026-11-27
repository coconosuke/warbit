// 11-27 15:08「アタッチメントとか装備の名前も本家準拠。グリップは正式名称で◯◯グリップ」: 大規模戦で選べる銃口・グリップ・横のレールは
//  BattleBit の名前（en に英語の正式名）と数字（Wiki の Attachments の表。research の 73）
import { test, ok, eq } from '../lib/t.mjs';
import { ATTACH, attachOptions, isSupp } from '../../src/engine/data/weapons.js';
import { makeWeapon } from '../../src/engine/actor.js';
import { attMods } from '../../src/engine/weapon.js';
import { classGuns } from '../../src/war/classes.js';
import { gunModel } from '../../src/render/guns.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('本家の名前: 大規模戦で選べる銃口・グリップ・ライト類はどれも英語の正式名がある', () => {
  const ids = new Set();
  for (const cls of ['assault', 'medic', 'support', 'engineer', 'recon', 'leader']) for (const g of classGuns(cls)) ids.add(g);
  let n = 0;
  for (const id of ids) {
    const ao = attachOptions(id);
    for (const k of ['muzzle', 'grip', 'side']) for (const v of ao[k] || []) {
      if (v === 'none' || v === 'choke') continue;
      ok(ATTACH[k][v] && ATTACH[k][v].en, `${id} の ${k}: ${v} に正式名`); n++;
    }
    ok(!(ao.grip || []).includes('handstop'), id + ': 本家にないハンドストップは選べない');
    ok(!(ao.side || []).some(v => v === 'combo' || v === 'ir'), id + ': 本家にないライト＋レーザー・赤外線は選べない');
  }
  ok(n > 50, '数 ' + n);
  eq(ATTACH.grip.vert.name, 'バーティカルグリップ'); eq(ATTACH.grip.vert.en, 'Vertical Grip');
  eq(ATTACH.grip.angled.name, 'アングルドグリップ'); eq(ATTACH.grip.stubby.name, 'スタビーグリップ');
});

test('本家のグリップ 14 種＋バイポッドが小銃に付く（M4A1）', () => {
  const g = attachOptions('m4a1').grip;
  for (const k of ['vert', 'angled', 'stubby', 'b25', 'bcm', 'fab', 'hera', 'magang', 'rk6', 'se5', 'shift', 'stabil', 'vskel', 'vtac', 'bipod']) ok(g.includes(k), k);
});

test('数字は Wiki の表のとおり: バーティカルグリップ 縦 -20%・横 +4%・構え +10%', () => {
  const m = attMods(makeWeapon({ id: 'm4a1', grip: 'vert' }));
  ok(near(m.rcv, 0.8) && near(m.rch, 1.04) && near(m.adsK, 1.1), JSON.stringify({ rcv: m.rcv, rch: m.rch, adsK: m.adsK }));
  const s = attMods(makeWeapon({ id: 'm4a1', grip: 'stabil' }));
  ok(near(s.rcfirst, 0.87), 'スタビルグリップは初弾 -13%');
});

test('銃口: ロングバレルはダメージと弾速 +5%・+10%、散らばりが小さい。サプレッサーは音が小さく、消音の音になる', () => {
  const L = attMods(makeWeapon({ id: 'm4a1', muzzle: 'long' }));
  ok(near(L.dmg, 1.05) && near(L.vel, 1.1) && L.acc < 1, JSON.stringify({ dmg: L.dmg, vel: L.vel, acc: L.acc }));
  const sl = attMods(makeWeapon({ id: 'm4a1', muzzle: 'suppL' })), ss = attMods(makeWeapon({ id: 'm4a1', muzzle: 'supp' }));
  ok(sl.noise < ss.noise && ss.noise < 1, 'ロングの方が静か');
  ok(isSupp('supp') && isSupp('suppL') && isSupp('osprey') && !isSupp('long'), '消音器の判定');
  ok(attachOptions('m4a1').muzzle.includes('nt4') && !attachOptions('m4a1').muzzle.includes('dgn'), '5.56 は NT-4、7.62 の物は付かない');
  ok(attachOptions('scarh').muzzle.includes('dgn'), '7.62x51 は DGN-308');
});

test('新しい銃口・グリップも銃の形に出る（銃口の先が伸びる）', () => {
  const base = gunModel('m4a1', {}), lg = gunModel('m4a1', { muzzle: 'long' }), sl = gunModel('m4a1', { muzzle: 'suppL' });
  ok(lg.pts.muzzle > base.pts.muzzle + 0.05 && sl.pts.muzzle > lg.pts.muzzle, JSON.stringify([base.pts.muzzle, lg.pts.muzzle, sl.pts.muzzle]));
  const vg = gunModel('m4a1', { grip: 'vskel' });
  ok(vg.pts.gripL, 'スケルトングリップも左手の握る所がある');
});

// 11-27 16:07（案A）・16:22「なるべく実物に寄せて。ブースターや横に付ける等倍の照準器も」
test('照準器: 本家の物（実物の倍率）・実物の等倍〜4/8 倍。2 倍の ACOG・ホロ一体のブースターは別の枠に', async () => {
  const { opticOf, zoomOf } = await import('../../src/engine/data/weapons.js');
  const s = attachOptions('m4a1').sight;
  for (const k of ['slip', 'flir', 'prisma', 'burris', 'echo', 'm125', 'acog', 'tri4', 'lpvo', 'lpvo8']) ok(s.includes(k), 'M4A1 に ' + k);
  for (const k of ['acog2', 'mag3']) ok(!s.includes(k), k + ' は選べない');
  const Z = { slip: 2, flir: 2.5, prisma: 3, burris: 3, echo: 3, m125: 3.2, acog: 4, tri4: 4 };
  for (const [k, z] of Object.entries(Z)) { const wi = makeWeapon({ id: 'm4a1', sight: k }); eq(zoomOf(wi), z, k + ' の倍率'); ok(ATTACH.sight[k].en, k + ' の正式名'); }
  ok(opticOf(makeWeapon({ id: 'm4a1', sight: 'flir' })).thermal, 'FLIR は熱を見る');
  ok(attachOptions('akm').sight.includes('p78') && zoomOf(makeWeapon({ id: 'akm', sight: 'p78' })) === 2.8, 'AK に 1P78（2.8 倍）');
  for (const k of ['slip', 'flir', 'prisma', 'echo', 'm125', 'tri4', 'burris']) { const g = gunModel('m4a1', { sight: k }); ok(g.pts.optic && g.pts.optic.scope, k + ' の形にレンズ'); }
  ok(gunModel('akm', { sight: 'p78' }).pts.optic, 'AK の 1P78 の形');
});

test('ブースター: ドット・ホロの後ろに 3 倍（G33）・6 倍（6XMag）。倍率のボタンで横へ倒すと等倍。倍率の照準器には付かない', async () => {
  const { opticOf, zoomOf, zoomsOf } = await import('../../src/engine/data/weapons.js');
  ok(attachOptions('m4a1').boost.includes('g33') && attachOptions('m4a1').boost.includes('mag6'), 'M4A1 に付く');
  const wi = makeWeapon({ id: 'm4a1', sight: 'holo', boost: 'g33' });
  eq(wi.att.boost, 'g33'); eq(zoomsOf(wi.att).join(), '3,1.1', '3 倍 → 倒してホロ（等倍）');
  ok(opticOf(wi).scope && zoomOf(wi) === 3, 'はじめは 3 倍のスコープの像');
  wi.zi = 1; ok(!opticOf(wi).scope && opticOf(wi).flip && opticOf(wi).kind === 'holo', '倒すとホロでのぞく');
  eq(zoomOf(makeWeapon({ id: 'm4a1', sight: 'reddot', boost: 'mag6' })), 6, '6XMag は 6 倍');
  eq(makeWeapon({ id: 'm4a1', sight: 'acog', boost: 'g33' }).att.boost, 'none', 'ACOG にブースターは付かない');
  const g = gunModel('m4a1', { sight: 'holo', boost: 'g33' });
  ok(g.flip && g.pts.flipPivot && g.pts.boost, '倒れる別の部品');
});

test('横・上の照準器: 倍率の照準器と一緒に。倍率のボタンで切り替え（オフセットは 45° 傾けてのぞく・上のドットは傾けない）', async () => {
  const { opticOf, zoomsOf } = await import('../../src/engine/data/weapons.js');
  for (const k of ['cIron', 'cDot', 'tDot']) ok(attachOptions('m4a1').cant.includes(k) && ATTACH.cant[k].en, 'M4A1 に ' + k);
  const wi = makeWeapon({ id: 'm4a1', sight: 'acog', cant: 'cDot' });
  eq(zoomsOf(wi.att).length, 2, '4 倍 → 横のドット');
  wi.zi = 1; const o = opticOf(wi);
  ok(o.cant === 'cDot' && !o.scope && Math.abs(o.roll - Math.PI / 4) < 1e-6 && o.zoom < 1.1, '横のドットは等倍で 45° 傾ける');
  const t = makeWeapon({ id: 'm4a1', sight: 'lpvo8', cant: 'tDot' }); eq(zoomsOf(t.att).length, 3, '8 倍・等倍・上のドット'); t.zi = 2; eq(opticOf(t).roll, 0, '上のドットは傾けない');
  eq(makeWeapon({ id: 'm4a1', sight: 'reddot', cant: 'cDot' }).att.cant, 'none', '等倍のドットには付かない');
  for (const k of ['cIron', 'cDot', 'tDot']) { const g = gunModel('m4a1', { sight: 'acog', cant: k }); ok(g.pts.cant && g.pts.cant.p.length === 3 && g.pts.cant.eye < g.pts.cant.p[2], k + ' ののぞく点'); }
  const gc = gunModel('m4a1', { sight: 'acog', cant: 'cDot' }).pts.cant.p; ok(gc[0] < -0.015, 'オフセットは右（-x）に付く');
});

// 11-27 16:39: 本家の Control は構えた時の揺れ（反動の戻りではない）。ロングバレルで反動の戻りが遅くならず、揺れが大きくなる
test('Control は揺れ: ロングバレルは揺れが大きく、反動の戻りは変わらない。アングルドグリップは揺れが小さい', async () => {
  const { swayK } = await import('../../src/engine/weapon.js');
  const { createGame, step } = await import('../../src/engine/engine.js');
  ok(swayK(makeWeapon({ id: 'm4a1', muzzle: 'long' })) > 1.2, 'ロングバレルは揺れが大きい');
  ok(swayK(makeWeapon({ id: 'm4a1', grip: 'angled' })) < 1, 'アングルドグリップは揺れが小さい');
  eq(swayK(makeWeapon({ id: 'm4a1' })), 1, '付けていない');
  const back = (muzzle) => {
    const G = createGame({ map: 'riverbend', mode: 'war', size: 'small', seed: 3, bots: false }), S = G.S, me = S.actors[0];
    step(G, {}); me.inv.w[0] = makeWeapon({ id: 'm4a1', muzzle }); me.ws.slot = 0; me.ws.st = 'idle'; me.ws.lastShot = -99;
    me.ws.rp = 6; for (let i = 0; i < Math.round(0.3 / S.dt); i++) step(G, { [me.id]: { yaw: me.yaw, pitch: 0 } });
    return me.ws.rp;
  };
  const a = back('none'), b = back('long');
  ok(Math.abs(a - b) < 1e-6, '反動の戻りは同じ ' + a.toFixed(3) + ' / ' + b.toFixed(3));
});
