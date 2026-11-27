// 11-27 15:08「装備してるプレイヤーの見た目」: 大規模戦の兵士は兵科で背嚢・無線機・帽子が違う（形は独自）。偵察はヘルメットなし
import { test, ok } from '../lib/t.mjs';
import { lookFor, personMeshData } from '../../src/render/people.js';

const L = (cls) => lookFor({ seed: 7, kind: 'swat', war: true, cls, armor: 'heavy', helmet: cls === 'recon' ? 'none' : 'helmet', uniform: '#4f5739', gearCol: '#3f4631' });
test('兵科で見た目が違う: 援護は大きい背嚢・衛生は袋つきの背嚢・工兵はロケットの筒・分隊長は無線機・偵察はつばの広い帽子', () => {
  const g = (c) => L(c).gear;
  ok(g('support').includes('packBig'), '援護'); ok(g('medic').includes('packMed'), '衛生'); ok(g('engineer').includes('packRpg'), '工兵');
  ok(g('leader').includes('radio'), '分隊長'); ok(g('recon').includes('boonie') && !g('recon').includes('helmet'), '偵察');
  ok(!g('assault').some(x => /pack|radio|boonie/.test(x)), '突撃は身軽');
  const keys = new Set(['support', 'medic', 'engineer', 'leader', 'recon', 'assault'].map(c => personMeshData(L(c)).key));
  ok(keys.size === 6, '形が 6 通り');
  for (const c of ['support', 'medic', 'engineer', 'leader', 'recon']) { const { d } = personMeshData(L(c)); ok(d.v.length > 0 && d.i.length > 0 && !d.v.some(v => !Number.isFinite(v)), c + ' の形に壊れた数がない'); }
});
