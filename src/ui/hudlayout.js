// HUD のボタンの既定の配置（CODモバイル／PUBGモバイルを参考）。基準は 844×390 の横画面。
// ax: 'l'|'r'|'c'（左右の基準）、ay: 't'|'b'|'c'。x, y は基準からの距離（中心まで）、s は直径、o は濃さ。
// 設定の hud[id] = { x, y, s, o, hide } で上書きする（HUD の編集）。
export const BTN = {
  fire: { name: '射撃', ax: 'r', ay: 'b', x: 92, y: 118, s: 86, icon: 'fire' },
  fireL: { name: '射撃（左）', ax: 'l', ay: 'b', x: 64, y: 226, s: 58, icon: 'fire', opt: 'leftFire' },
  ads: { name: '構える（ADS）', ax: 'r', ay: 'b', x: 178, y: 68, s: 58, icon: 'ads' },
  reload: { name: 'リロード', ax: 'r', ay: 'b', x: 36, y: 205, s: 50, icon: 'reload' },
  crouch: { name: 'しゃがむ（長押しで伏せ）', ax: 'r', ay: 'b', x: 36, y: 40, s: 50, icon: 'crouch' },
  breath: { name: '息止め（構えている間）', ax: 'r', ay: 'b', x: 240, y: 126, s: 50, icon: 'breath', warOnly: true, adsOnly: true, opt: 'breathBtn' },
  vault: { name: '乗り越え・跳ぶ', ax: 'r', ay: 'b', x: 160, y: 200, s: 48, icon: 'jump' },
  // ジャンプ（設定で乗り越えと分けた時だけ出る。11-26）
  jump: { name: 'ジャンプ（乗り越えと分けた時）', ax: 'r', ay: 'b', x: 110, y: 26, s: 44, icon: 'jump', warOnly: true, optOn: 'jumpBtn' },
  // 近接: 上のライトのボタンと重なっていたので、構えるボタンの左へ（11-19）
  melee: { name: '近接（銃床で殴る）', ax: 'r', ay: 'b', x: 252, y: 30, s: 44, icon: 'melee' },
  leanL: { name: '左にリーン', ax: 'l', ay: 'b', x: 36, y: 168, s: 48, icon: 'leanL' },
  leanR: { name: '右にリーン', ax: 'l', ay: 'b', x: 210, y: 168, s: 48, icon: 'leanR' },
  shout: { name: '警告（呼びかけ）', ax: 'r', ay: 'b', x: 252, y: 52, s: 60, icon: 'shout', noWar: true },
  use: { name: '調べる（長押しでメニュー）', ax: 'r', ay: 'b', x: 238, y: 140, s: 58, icon: 'use', noWar: true },
  cmd: { name: '命令（長押しでメニュー）', ax: 'r', ay: 'b', x: 316, y: 98, s: 56, icon: 'cmd', pve: true },
  team: { name: '命令する隊', ax: 'r', ay: 'b', x: 316, y: 160, s: 38, icon: 'team', pve: true },
  gear: { name: '投げ物・装備（長押しで選ぶ）', ax: 'r', ay: 'b', x: 92, y: 236, s: 52, icon: 'gear', noWar: true },
  // 大規模戦（11-20）: BattleBit のキー（投げ物 G・包帯 3・道具 4/5）に合わせ、投げ物・包帯・道具の3つに分ける。
  // 投げ物と道具は、指をずらすとすぐ選ぶ円が出る（長押しを待たない）。円の並びは設定で決め、数が変わっても動かない
  nade: { name: '投げ物（ずらすと種類を選ぶ）', ax: 'r', ay: 'b', x: 92, y: 236, s: 52, icon: 'gear', warOnly: true },
  heal: { name: '包帯', ax: 'r', ay: 't', x: 126, y: 92, s: 40, icon: 'heal', warOnly: true },
  gad: { name: '道具（ずらすと選ぶ）', ax: 'r', ay: 'b', x: 36, y: 270, s: 46, icon: 'gad', warOnly: true },
  // 落ちた弾倉を拾う（11-20）: 近く（2m）に拾える弾倉がある間だけ出る
  pick: { name: '拾う（近くに落ちた弾倉がある間）', ax: 'r', ay: 'b', x: 250, y: 196, s: 46, icon: 'pick', warOnly: true },
  fmode: { name: '射撃モード', ax: 'r', ay: 't', x: 214, y: 92, s: 36, icon: 'fmode' },
  spot: { name: '敵に印（分隊に知らせる）', ax: 'l', ay: 't', x: 170, y: 40, s: 40, icon: 'spot', warOnly: true },
  rally: { name: 'ビーコンを置く（分隊長・分隊ポイント 200）', ax: 'l', ay: 't', x: 218, y: 40, s: 40, icon: 'rally', warOnly: true },
  zoom: { name: 'スコープの倍率', ax: 'r', ay: 't', x: 258, y: 92, s: 36, icon: 'zoom', zoomOnly: true },
  light: { name: 'ライト', ax: 'r', ay: 't', x: 170, y: 92, s: 36, icon: 'light' },
  nvg: { name: '暗視装置', ax: 'r', ay: 't', x: 126, y: 92, s: 36, icon: 'nvg', noWar: true },
  pause: { name: 'メニュー', ax: 'r', ay: 't', x: 30, y: 28, s: 38, icon: 'pause' },
  drone: { name: 'ドローン', ax: 'r', ay: 't', x: 82, y: 92, s: 40, icon: 'drone', pvp: true },
  loadout: { name: '兵科・装備（射撃場）', ax: 'r', ay: 't', x: 76, y: 28, s: 40, icon: 'loadout', rangeOnly: true },
  cams: { name: '監視カメラ（対戦の防衛側）', ax: 'r', ay: 't', x: 82, y: 140, s: 40, icon: 'cams', pvp: true },
  zone: { name: '出現地点（攻撃側の準備中）', ax: 'c', ay: 't', x: 0, y: 98, s: 34, w: 190, icon: 'zone', pvp: true },
  wpn1: { name: '主武器', ax: 'c', ay: 'b', x: -64, y: 22, s: 40, w: 120, icon: 'wpn', group: 'wpn' },
  wpn2: { name: '副武器', ax: 'c', ay: 'b', x: 64, y: 22, s: 40, w: 120, icon: 'wpn', group: 'wpn' },
};
// 情報の場所（編集でも動かせる）
export const INFO = {
  minimap: { name: 'ミニマップ', ax: 'l', ay: 't', x: 72, y: 72, s: 120 },
  squad: { name: '隊員', ax: 'l', ay: 't', x: 206, y: 58, s: 124, w: 124 },
  compass: { name: '方位', ax: 'c', ay: 't', x: 0, y: 16, s: 22, w: 260 },
  obj: { name: '目的', ax: 'c', ay: 't', x: 0, y: 46, s: 30, w: 300 },
  feed: { name: '出来事', ax: 'r', ay: 't', x: 128, y: 150, s: 80, w: 240 },
  vitals: { name: '体力', ax: 'c', ay: 'b', x: -230, y: 22, s: 30, w: 150 },
  ammo: { name: '弾', ax: 'c', ay: 'b', x: 210, y: 26, s: 38, w: 110 },
  subs: { name: '字幕', ax: 'c', ay: 'b', x: 0, y: 78, s: 30, w: 340 },
};
export const ICONS = {
  loadout: '<path d="M4 8h11l2-2h3v4h-3l-1 1H8l-1 3H5l1-3H4z" fill="currentColor"/><path d="M6 17h12M15 14l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  cams: '<path d="M3 8l12-3 2 6-12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="15.2" cy="9.2" r="1.3" fill="currentColor"/><path d="M8 13l1 4H5M17 9l4-1v4l-4 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  melee: '<path d="M5 19l9-9M14 10l2-6 4 4-6 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 17.5l3 3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M17 15l2.5 1M15.5 18l1.5 2M19.5 12l2 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  zone: '<path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.6" fill="currentColor"/>',
  board: '<path d="M4 5h16M4 10h16M4 15h16M4 20h16M9 3v19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  fire: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="currentColor" stroke-width="2"/>',
  ads: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5v4M12 15v4M5 12h4M15 12h4" stroke="currentColor" stroke-width="2"/>',
  // リロード: 弾丸を円の矢印が囲む（主なスマホFPSと同じ形。11-13 14:35）
  reload: '<path d="M19.36 7.75A8.5 8.5 0 1 1 14.2 3.79" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M17.1 4.5L12.7 6.1 14 1z" fill="currentColor"/><path d="M9.7 11C9.7 9.1 10.85 7.55 12 7 13.15 7.55 14.3 9.1 14.3 11zM9.6 11.7h4.8v4.8H9.6zM9.1 16.9h5.8v1.3H9.1z" fill="currentColor"/>',
  // 息止め: 肺の形
  breath: '<path d="M12 3v7M12 9c-1.5 1.5-3 2-4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 9c1.5 1.5 3 2 4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9.6 7.6C6.3 7 3.6 11 3.4 16.3c-.1 2.6 1.2 3.9 3.2 3.4 2.6-.6 3.6-2.3 3.6-5.3V8.2zM14.4 7.6c3.3-.6 6 3.4 6.2 8.7.1 2.6-1.2 3.9-3.2 3.4-2.6-.6-3.6-2.3-3.6-5.3V8.2z" fill="currentColor"/>',
  crouch: '<circle cx="13" cy="5" r="2.5" fill="currentColor"/><path d="M12 8l-3 6h6l-2 6M9 14l-3 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  // 跳ぶ（11-19 18:16: 乗り越えの絵から変更）: 地面の線から上へ向かう矢印
  jump: '<path d="M4 21h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 17.5V4.5M6.5 10 12 4.5 17.5 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17.5h2M15 17.5h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>',
  vault: '<path d="M3 20h18M7 20v-7h10v7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 9c3-6 9-6 13-1l-2-3M18 8l-3 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  leanL: '<path d="M10 4l-4 4 4 4M6 8h8a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  leanR: '<path d="M14 4l4 4-4 4M18 8h-8a5 5 0 0 0 0 10h3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  shout: '<path d="M3 10v4h4l7 5V5L7 10z" fill="currentColor"/><path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  use: '<path d="M9 11V5a1.5 1.5 0 0 1 3 0v5V4a1.5 1.5 0 0 1 3 0v6V6a1.5 1.5 0 0 1 3 0v8c0 4-3 7-7 7s-6-3-7-5l-2-4a1.5 1.5 0 0 1 2.6-1.5L9 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  cmd: '<path d="M5 21V3M5 4h12l-3 4 3 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  team: '<circle cx="8" cy="9" r="3" fill="currentColor"/><circle cx="16" cy="9" r="3" fill="currentColor"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6M10 20c0-4 3-6 6-6s6 2 6 6" fill="currentColor"/>',
  gear: '<rect x="8" y="7" width="8" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 7V4h4v3M14 4l4-2" fill="none" stroke="currentColor" stroke-width="2"/>',
  // 包帯: 巻いた包帯と十字
  heal: '<rect x="3" y="7" width="18" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9.2v5.6M9.2 12h5.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  // 道具: 取っ手のある箱
  // 投げ物を上から投げる（丸い手榴弾と上へ弧を描く矢印）。下投げは under（下から弧）
  nadeThrow: '<circle cx="8" cy="15" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.8V9h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 11c2-5 5-7 8.5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2.2 2.4"/><path d="M17.5 2.8l3 1.2-1.6 2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  // C4 を投げる（四角い爆薬と矢印）・起爆（起爆装置の握りと火花）
  c4throw: '<rect x="3" y="11" width="11" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15h7" stroke="currentColor" stroke-width="1.6"/><path d="M14 9l6-5M15.5 4H20v4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  c4det: '<rect x="6" y="9" width="8" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 12l5-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M10 9V6M7 3.5l1.6 2.2M13 3.5l-1.6 2.2M18.5 4.5l1 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  under: '<path d="M4 6c3 0 5 2 6.5 5.5S14 18 19 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2.2 2.6"/><circle cx="19" cy="18" r="2.6" fill="currentColor"/><path d="M3 9.5l2.5-4.5 2.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  pick: '<path d="M12 3v9M8.5 8.5 12 12l3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="14" width="12" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/>',
  gad: '<rect x="3" y="8" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 8V5h6v3M3 13h18" fill="none" stroke="currentColor" stroke-width="2"/>',
  // 敵に印: 目と小さな菱形
  rally: '<rect x="6" y="14" width="12" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 14V6" stroke="currentColor" stroke-width="2"/><path d="M8.2 7.2a5.4 5.4 0 0 1 7.6 0M5.6 4.6a9 9 0 0 1 12.8 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  spot: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.6l3 3.4-3 3.4-3-3.4z" fill="currentColor"/>',
  // 倍率（11-19 14:03）: 虫めがね
  zoom: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M8 10.5h5M10.5 8v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  fmode: '<text x="12" y="16" font-size="9" text-anchor="middle" fill="currentColor" font-family="sans-serif" font-weight="700">FM</text>',
  light: '<path d="M4 9h9l6-4v14l-6-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  nvg: '<circle cx="7.5" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16.5" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11.5 13h1M9 6h6" stroke="currentColor" stroke-width="2"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  drone: '<circle cx="5" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="19" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="10" width="8" height="6" rx="2" fill="currentColor"/><path d="M7 8l2 3M17 8l-2 3" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="19" r="2" fill="currentColor"/><circle cx="17" cy="19" r="2" fill="currentColor"/>',
  wpn: '',
};
