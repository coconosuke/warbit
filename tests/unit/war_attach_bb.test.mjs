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
