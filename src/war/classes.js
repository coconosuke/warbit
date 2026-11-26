// 大規模戦の兵科（BattleBit の6つ。research/WARBIT.md の 3・9・10）
// 体力: 突撃・衛生・工兵・分隊長 100、援護 125、偵察 90（BattleBit 大型アップデートの日誌の値）。
// 銃は兵科ごとの種類から選ぶ（陣営で服だけ違う。BattleBit も銃は両陣営で同じ）。投げ物と道具は兵科ごと。
// tools（道具）はまだ使えない（M3 で入れる）。出撃の画面では「準備中」と出す
import { WEAPONS } from '../engine/data/weapons.js';
import { GEAR } from '../engine/data/equipment.js';

export const CLASSES = {
  leader: {
    name: '分隊長', en: 'SQUAD LEADER', short: 'LEADER', hp: 100,
    desc: '分隊を率いる。分隊の1人目だけが選べる。',
    guns: ['m4a1', 'hk416', 'akm', 'scarh', 'g36c', 'mini14', 'sks'],
    sec: ['m17', 'g19', 'm92'],
    // 手榴弾は1つ（BattleBit の公式 wiki: 援護だけ 2、ほかは 1。research/WARBIT.md の 56）。包帯は wiki の表で突撃・援護・工兵 6、衛生 20、偵察 5
    //  （分隊長は表に無いので 6。research の 57）
    gear: [['frag', 1], ['smoke', 3], ['bandage', 6], ['binoc', 1], ['hammer', 1]],
    tools: [],
  },
  assault: {
    name: '突撃', en: 'ASSAULT', short: 'ASSAULT', hp: 100,
    desc: '前に出て撃ち合う。リロードと持ち替えが 25%、近い照準器で構えるのが 20% 速い。破片と衝撃の手榴弾を持つ。',
    guns: ['m4a1', 'akm', 'hk416', 'mk18', 'aks74u', 'vz58', 'g36c', 'scarl', 'aug', 'tavor', 'mcx'],
    sec: ['m17', 'g17', 'm1911'],
    gear: [['frag', 1], ['impact', 1], ['smoke', 2], ['bandage', 6], ['ammosmall', 1], ['hammer', 1]],
    tools: [],
  },
  medic: {
    name: '衛生', en: 'MEDIC', short: 'MEDIC', hp: 100,
    desc: '短い銃で仲間についていく。包帯が多く（20）、巻くのが 2 倍速い。医療キットで仲間を治す。',
    guns: ['mp7', 'mp5', 'ump45', 'vector', 'p90', 'mpx', 'bizon', 'mk18', 'aks74u'],
    sec: ['m17', 'g19', 'makarov'],
    gear: [['frag', 1], ['smoke', 2], ['bandage', 20], ['medkit', 1]],
    tools: [],
  },
  engineer: {
    name: '工兵', en: 'ENGINEER', short: 'ENGINEER', hp: 100,
    desc: '短い銃・散弾銃・DMR と RPG-7。固まった敵や物陰の敵をロケットで吹き飛ばす。',
    guns: ['mk18', 'mp7', 'ump45', 'm4super', 'saiga', 'mini14', 'hk417'],
    sec: ['m17', 'g17', 'm92'],
    gear: [['frag', 1], ['smoke', 2], ['bandage', 6]],
    long: 'rpg',
    tools: ['修理工具'],
  },
  support: {
    name: '援護', en: 'SUPPORT', short: 'SUPPORT', hp: 125,
    desc: '機関銃で制圧する。体力が多い（125）。',
    guns: ['m249', 'rpk'],
    sec: ['m17', 'm92', 'm1911'],
    gear: [['frag', 2], ['smoke', 2], ['bandage', 6], ['ammobig', 2]],
    tools: [],
  },
  recon: {
    name: '偵察', en: 'RECON', short: 'RECON', hp: 90,
    desc: '狙撃銃と DMR で遠くから。800m より遠いと胴に1発で倒せる。ヘルメットなし（90）。',
    guns: ['at308', 'hk417', 'sks', 'mini14', 'g3'],
    sec: ['deagle', 'm17', 'm1911'],
    gear: [['frag', 1], ['smoke', 2], ['bandage', 5], ['binoc', 1], ['hammer', 1]],
    tools: [],
    noHelmet: true,
  },
};
// 出撃の画面の並び（BattleBit の Class list と同じ順）
export const CLASS_LIST = ['leader', 'assault', 'medic', 'engineer', 'support', 'recon'];
// 照準器の既定（銃の種類で）
const SIGHT = { at308: null, hk417: 'acog', sks: 'acog', mini14: 'acog', g3: 'acog', scarh: 'acog', m249: 'holo', rpk: 'reddot' };
// 兵科の銃（まだない銃は除く）
export const classGuns = (cls) => (CLASSES[cls] || CLASSES.assault).guns.filter(id => WEAPONS[id]);
export const classSecs = (cls) => (CLASSES[cls] || CLASSES.assault).sec.filter(id => WEAPONS[id]);
// 副の道具（出撃の画面の LOADOUT の「道具」で選ぶ。BattleBit は全兵科が C4・地雷などから選べる。衛生は医療キットで決まり。
//  research の 39・42）。既定は C4
export const GADGETS = ['c4', 'clay', 'apmine', 'none'];
export function classGadgets(cls) { return cls === 'medic' ? [] : GADGETS; }
// 兵科と銃から装備を作る（engine の makeInventory に渡す形）。gad: 副の道具
export function classLoadout(cls, gun, sec, att, gad) {
  const C = CLASSES[cls] || CLASSES.assault;
  const G = classGuns(cls), Ss = classSecs(cls);
  const g = gun && G.includes(gun) ? gun : G[0];
  const s = sec && Ss.includes(sec) ? sec : Ss[0];
  const prim = { id: g, ammo: 'ap' };
  const sight = g in SIGHT ? SIGHT[g] : 'holo';
  if (sight) prim.sight = sight;
  // 付属品（出撃の画面の LOADOUT で選ぶ。付けられない物は makeWeapon が外す）
  const A = att && att[g];
  if (A) for (const k of ['sight', 'muzzle', 'grip', 'side']) if (A[k]) prim[k] = A[k];
  const gear = C.gear.map(x => x.slice());
  const gs = classGadgets(cls), gd = gs.includes(gad) ? gad : gs[0];
  if (gd && gd !== 'none' && GEAR[gd]) gear.push([gd, GEAR[gd].max || 1]);
  return { war: true, primary: prim, secondary: { id: s, ammo: 'ap' }, long: C.long || 'none', gear, vest: 'light', plate: 'ceramic', helmet: C.noHelmet ? 'none' : 'helmet', head: 'none' };
}
