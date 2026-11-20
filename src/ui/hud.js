// HUD（CODモバイル／PUBGモバイル風）: ボタン、ミニマップ、方位、目的、出来事、隊員、体力、弾、字幕、照準、命中、被弾の向き、円形メニュー、HUDの編集
import { BTN, INFO, ICONS } from './hudlayout.js';
import { onTap } from './input.js';
import { C, CS, LH, isWallish } from '../engine/world.js';
import { M } from '../engine/data/materials.js';
import { WEAPONS, zoomsOf, zoomOf } from '../engine/data/weapons.js';
import { GEAR, LONG } from '../engine/data/equipment.js';
import { ammoCount } from '../engine/actor.js';
import { warPlanImage, drawWarMarks, WAR_PX } from './warplan.js';
import { DeployScreen } from './deployscreen.js';
import { setTeamCols } from './teamcol.js';

// 移動スティックの既定の場所（左下から。左利きは左右が入れ替わる）
const STICK_DEF = { name: '移動スティック', ax: 'l', ay: 'b', x: 118, y: 96 };

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const svg = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ''}</svg>`;
const TEAMCOL = { gold: '#e8b830', red: '#e5483f', blue: '#3d8cf0' };
const TEAMJA = { gold: '全員', red: '赤', blue: '青' };

export class Hud {
  constructor(stage, root) {
    this.stage = stage; this.root = root;
    this.S = {}; this.on = false; this.mode = { pve: true, pvp: false };
    this.btn = {}; this.info = {};
    this.cache = {};
    this.feedItems = [];
    this.dmgArcs = [];
    this.stickHome = null;
    this._build();
    stage.onLayout(() => this.layout());
  }
  _build() {
    const r = this.root;
    r.innerHTML = '';
    // スコープの像（外側の黒）はいちばん下に置く。上に置くと、ミニマップ・体力・弾数・味方・方位などが黒に隠れていた（11-12 22:05）
    this.scope = el('div', 'hud-scope', '<div class="ret"></div>'); r.appendChild(this.scope);
    // 大規模戦: 世界の上の印（拠点・味方）を描く透明な画面と、出撃の場所を選ぶ板
    this.ov = document.createElement('canvas'); this.ov.className = 'hud-ov'; r.appendChild(this.ov); this.ovCtx = this.ov.getContext('2d');
    this.deployEl = el('div', 'hud-deploy'); r.appendChild(this.deployEl);
    // 情報
    // ミニマップ: タップで地図を開く（地図のボタンの代わり）
    const mm = el('div', 'hud-mm'); const mc = document.createElement('canvas'); mc.width = 240; mc.height = 240; mm.appendChild(mc); mm.appendChild(el('div', 'hud-mm-n', 'N')); mm.appendChild(el('div', 'hud-mm-x', svg('expand')));
    mm.dataset.btn = 'map'; mm.setAttribute('role', 'button'); mm.setAttribute('aria-label', '地図を開く');
    this.info.minimap = mm; this.mmCanvas = mc; this.mmCtx = mc.getContext('2d');
    this.info.compass = el('div', 'hud-compass', '<div class="hud-compass-in"></div><div class="hud-compass-tick"></div>');
    this.info.obj = el('div', 'hud-obj');
    this.info.feed = el('div', 'hud-feed');
    this.info.squad = el('div', 'hud-squad');
    this.info.vitals = el('div', 'hud-vitals', '<div class="sqp"><span>分隊ポイント</span><b>0</b><em></em></div><div class="hp"><i></i><b></b></div><div class="plates"></div><div class="st"></div>');
    this.info.ammo = el('div', 'hud-ammo', '<div class="mode"></div><div class="cnt"><b>0</b><span>/0</span></div><div class="mags"></div>');
    this.info.subs = el('div', 'hud-subs'); this.subs = this.info.subs;
    for (const [id, e] of Object.entries(this.info)) { e.dataset.info = id; r.appendChild(e); }
    // 中央の物
    this.cross = el('div', 'hud-cross', '<i class="c"></i><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i>'); r.appendChild(this.cross);
    this.reticle = el('div', 'hud-reticle'); r.appendChild(this.reticle);
    // 息の残り（息止めの間と、戻るまで。構えているときだけ）
    this.breathEl = el('div', 'hud-breath', '<i></i>'); r.appendChild(this.breathEl);
    this.hitm = el('div', 'hud-hit', '<i></i><i></i><i></i><i></i>'); r.appendChild(this.hitm);
    // 点（大規模戦）: 照準の下に合計と内訳。続けて入ると足していく
    this.ptsEl = el('div', 'hud-pts', '<div class="kl"></div><div class="tot"></div><div class="rs"></div>'); r.appendChild(this.ptsEl);
    // ダウン中にあきらめて出撃の画面へ（大規模戦。指だと2回押す。11-19 18:16）
    this.giveup = el('div', 'hud-giveup', '<b>GIVE UP</b><span>出撃の画面へ</span>'); this.giveup.dataset.btn = 'giveup'; this.giveup.setAttribute('role', 'button'); r.appendChild(this.giveup);
    this.dmg = el('div', 'hud-dmg'); r.appendChild(this.dmg);
    this.prog = el('div', 'hud-prog', '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" class="bg"/><circle cx="32" cy="32" r="26" class="fg"/></svg><div class="lb"></div>'); r.appendChild(this.prog);
    this.prompt = el('div', 'hud-prompt'); r.appendChild(this.prompt);
    this.banner = el('div', 'hud-banner'); r.appendChild(this.banner);
    this.mirror = el('div', 'hud-mirror'); r.appendChild(this.mirror);
    // のぞいている間（ミラー・オプティワンド）
    this.peekEl = el('div', 'hud-peek', '<div class="pk-hint">スワイプで見回す・動くと戻る</div><div class="pk-x" data-btn="peekx" role="button">戻る</div>'); r.appendChild(this.peekEl);
    this.stickEl = el('div', 'hud-stick', '<div class="knob"></div><div class="spr">ダッシュ</div>'); this.stickEl.dataset.edit = 'stick'; r.appendChild(this.stickEl);
    // スコア表（対戦）: 画面上部のスコアをタップ（PC は Tab）で開く。表をタップで閉じる
    this.boardEl = el('div', 'hud-board'); this.boardEl.dataset.btn = 'board'; r.appendChild(this.boardEl);
    this.radialEl = el('div', 'hud-radial'); r.appendChild(this.radialEl);
    // ボタン
    for (const [id, b] of Object.entries(BTN)) {
      const e = el('div', 'hb' + (b.group ? ' hb-' + b.group : ''), (b.icon && b.icon !== 'wpn' ? svg(b.icon) : '') + '<span class="lb"></span><span class="ct"></span>');
      e.dataset.btn = id;
      e.setAttribute('role', 'button'); e.setAttribute('aria-label', b.name);
      r.appendChild(e);
      this.btn[id] = e;
    }
    this.btn.team.querySelector('.lb').textContent = '全員';
    // 編集の道具
    this.editBar = el('div', 'hud-editbar', `<div class="r1"><div class="grip" role="button" aria-label="この欄を動かす"><i></i><i></i><i></i></div><div class="nm">項目を選択</div><button data-a="hide">隠す</button></div>
      <div class="r2"><label>大きさ <input type="range" min="0.6" max="1.8" step="0.05" data-k="s"></label>
      <label>濃さ <input type="range" min="0.15" max="1" step="0.05" data-k="o"></label></div>
      <label class="sprl" hidden>ダッシュの位置 <input type="range" min="1" max="2.4" step="0.05" data-k="spr"></label>
      <div class="r3"><button data-a="reset1">元に戻す</button><button data-a="resetAll">すべて初期化</button><button data-a="done" class="pri">保存</button></div>`);
    r.appendChild(this.editBar);
  }
  setSettings(s) {
    this.S = s; this.root.style.setProperty('--subbg', String(s.subBg ?? 0.42));
    // 照準の大きさ・濃さ・ヒットマーカーの色（設定）
    setTeamCols(s);
    const R = this.root.style, hc = s.hitCol || {};
    R.setProperty('--cs', String(s.crossSize ?? 1)); R.setProperty('--co', String(s.crossOpacity ?? 1));
    R.setProperty('--hit-body', hc.body || '#ffffff'); R.setProperty('--hit-head', hc.head || '#ffe600'); R.setProperty('--hit-armor', hc.armor || '#3d7dff'); R.setProperty('--hit-kill', hc.kill || '#ff2a1f');
    this.layout();
  }
  setMode(m) {
    this.mode = m;
    // 対戦: 画面上部のスコア（目的の欄）をタップするとスコア表（専用のボタンはない）
    // 大規模戦: 弾の欄を押すと弾倉の残り・長押しで弾倉をまとめる
    if (this.info.ammo) { if (m && m.war && !m.edit) { this.info.ammo.dataset.btn = 'ammo'; this.info.ammo.setAttribute('role', 'button'); this.info.ammo.setAttribute('aria-label', '弾倉（長押しでまとめる）'); } else { delete this.info.ammo.dataset.btn; this.info.ammo.removeAttribute('role'); } }
    if (this.info.obj) { if (m && (m.pvp || (m.war && !m.range))) { this.info.obj.dataset.btn = 'board'; this.info.obj.setAttribute('role', 'button'); this.info.obj.setAttribute('aria-label', 'スコア表を開く'); } else { delete this.info.obj.dataset.btn; this.info.obj.removeAttribute('role'); } }
    this.layout();
  }
  show(on) { this.on = on; this.root.classList.toggle('on', on); }

  k() { return Math.max(0.8, Math.min(1.35, this.stage.h / 390)) * (this.S.hudScale || 1); }
  posOf(def, ov) {
    const st = this.stage, sf = st.safe, k = this.k();
    const x = (ov && ov.x != null) ? ov.x : def.x, y = (ov && ov.y != null) ? ov.y : def.y;
    if (ov && ov.ay) def = { ...def, ay: ov.ay };
    let px, py;
    const left = this.S.handed === 'left' ? (def.ax === 'l' ? 'r' : def.ax === 'r' ? 'l' : 'c') : def.ax;
    if (left === 'l') px = sf.l + x * k; else if (left === 'r') px = st.w - sf.r - x * k; else px = st.w / 2 + (this.S.handed === 'left' ? -x : x) * k;
    if (def.ay === 't') py = Math.max(sf.t, 6) + y * k; else if (def.ay === 'b') py = st.h - Math.max(sf.b, 4) - y * k; else py = st.h / 2 + y * k;
    return [px, py];
  }
  layout() {
    if (!this.stage.w) return;
    const k = this.k(), H = this.S.hud || {};
    const op = this.S.hudOpacity ?? 0.85;
    for (const [id, def] of Object.entries(BTN)) {
      // 投げ物のボタン（大規模戦）は、前の「投げ物・装備」のボタンを動かしていればその場所を引き継ぐ
      const e = this.btn[id], ov = H[id] || (id === 'nade' && H.gear) || {};
      let hide = !!ov.hide;
      if (def.pve && !this.mode.pve) hide = true;
      if (def.pvpOnly && !this.mode.pvp) hide = true;
      if (def.pvp && !this.mode.drone) hide = true;
      if (def.noWar && this.mode.war) hide = true;
      if (def.rangeOnly && !this.mode.range) hide = true;
      if (def.warOnly && !this.mode.war) hide = true;
      // 設定で消したボタン（左の射撃）: 配置を動かしたことがあっても消す（動かすと設定が効かなくなっていた）
      const offBySetting = def.opt === 'leftFire' && this.S.leftFire === false;
      if (offBySetting) hide = true;
      // 編集のときも、このモードで使わないボタン（大規模戦の 警告・調べる・暗視 など）は出さない（11-19 14:03）
      // 11-19 23:27: 編集の時もここで隠す（前は薄くなるだけで、監視カメラ・命令・警告などが出ていた）。
      // 編集は大規模戦の配置: 作り直す前の物（命令・警告・調べる・暗視・ドローン・監視カメラ・出現地点）は出さない。射撃場だけの物は置けるように出す
      if (this.editing) hide = !!(def.pve || def.pvp || def.pvpOnly || def.noWar);
      e.classList.toggle('hidden', hide);
      const [x, y] = this.posOf(def, ov);
      const s = (ov.s || 1) * def.s * k;
      const wdt = def.w ? def.w * (ov.s || 1) * k : s;
      e.style.left = (x - wdt / 2) + 'px'; e.style.top = (y - s / 2) + 'px'; e.style.width = wdt + 'px'; e.style.height = s + 'px';
      e.style.opacity = this.editing && (ov.hide || offBySetting) ? 0.25 : (ov.o ?? op);
      e.style.setProperty('--bs', s + 'px');
    }
    for (const [id, def] of Object.entries(INFO)) {
      const e = this.info[id], ov = H['i_' + id] || {};
      const [x, y] = this.posOf(def, ov);
      const sc = (ov.s || 1) * k;
      e.style.left = x + 'px'; e.style.top = y + 'px';
      e.style.transform = `translate(-50%,-50%) scale(${sc})`;
      e.classList.toggle('hidden', (!!ov.hide && !this.editing) || (id === 'squad' && !((this.mode.pve && !this.editing) || (this.mode.war && !this.mode.range && this.S.squadList))) || (id === 'minimap' && this.S.minimap === false) || (id === 'subs' && (this.mode.war || (this.S.subtitles === false && !this.editing))));
      if (this.editing) e.style.opacity = ov.hide ? 0.25 : 1; else e.style.opacity = '';
    }
    // 移動スティック: 位置（固定のとき・待っているときの場所）・大きさ・濃さ・ダッシュの判定位置は HUD の設定（H.stick）
    const so = H.stick || {};
    const [sx, sy] = this.posOf(STICK_DEF, so);
    this.stickHome = { x: sx, y: sy, s: k * (so.s || 1), o: so.o ?? 0.55, spr: so.spr ?? 1.25 };
    this.stickEl.classList.toggle('sel', this.editing && this.sel === 'stick');
    if (!this.stickActive) this._stickIdle();
  }
  // ダッシュの印: スティックの中心から spr×半径 だけ上（指がそこより上へ行くとダッシュ）
  _sprMark(R) {
    const h = this.stickHome, m = this.stickEl.lastChild;
    m.style.top = (R - (h ? h.spr : 1.25) * R) + 'px';
  }
  _stickIdle() {
    const h = this.stickHome; if (!h) return;
    const R = 60 * h.s;
    const e = this.stickEl;
    e.style.left = (h.x - R) + 'px'; e.style.top = (h.y - R) + 'px'; e.style.width = e.style.height = (R * 2) + 'px';
    e.classList.remove('act');
    e.classList.toggle('show-spr', !!this.editing || !!this.sprLocked);
    e.classList.toggle('spr-on', !!this.sprLocked);
    e.style.opacity = this.editing ? Math.max(0.45, h.o) : h.o;
    this._sprMark(R);
    e.firstChild.style.transform = this.sprLocked ? `translate(-50%, calc(-50% - ${R * 0.8}px))` : 'translate(-50%,-50%)';
  }
  stick(st, dx, dy, spr, lock) {
    this.sprLocked = !!lock;
    if (!st) { this.stickActive = false; this._stickIdle(); if (!lock) this.stickEl.classList.remove('spr-on'); return; }
    this.stickActive = true;
    const h = this.stickHome || { s: this.k(), o: 0.55, spr: 1.25 };
    const R = 60 * h.s;
    const e = this.stickEl;
    e.classList.add('act'); e.classList.add('show-spr');
    e.style.opacity = Math.min(1, h.o + 0.45);
    e.style.left = (st.ox - R) + 'px'; e.style.top = (st.oy - R) + 'px'; e.style.width = e.style.height = (R * 2) + 'px';
    e.firstChild.style.transform = `translate(calc(-50% + ${(dx || 0) * R}px), calc(-50% + ${(dy || 0) * R}px))`;
    this._sprMark(R);
    e.classList.toggle('spr-on', !!spr);
  }

  // ---- スコア表: d = { title, teams: [{ name, score, cls, rows: [{ name, k, d, a, me, bot, out }] }] } か null
  board(d) {
    const e = this.boardEl;
    if (!d) { if (this._boardKey) { this._boardKey = ''; e.classList.remove('on'); e.innerHTML = ''; } return; }
    const key = JSON.stringify(d);
    if (key === this._boardKey) return;
    this._boardKey = key;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let h = `<div class="bd"><div class="bh">${esc(d.title)}<small>タップで閉じる</small></div><div class="bt">`;
    for (const t of d.teams) {
      h += `<div class="tm ${t.cls}"><div class="tn"><b>${esc(t.name)}</b><em>${t.score}</em></div><table><tr><th class="nm">名前</th>${d.sc ? '<th>スコア</th>' : ''}<th>キル</th><th>デス</th><th>アシスト</th><th>K/D</th></tr>`;
      for (const r of t.rows) h += `<tr class="${r.me ? 'me' : ''}${r.out ? ' out' : ''}"><td class="nm">${esc(r.name)}${r.bot ? '<i>BOT</i>' : ''}</td>${d.sc ? `<td class="sc">${r.sc || 0}</td>` : ''}<td>${r.k}</td><td>${r.d}</td><td>${r.a}</td><td>${r.d ? (r.k / r.d).toFixed(2) : r.k.toFixed(2)}</td></tr>`;
      h += '</table></div>';
    }
    h += '</div></div>';
    e.innerHTML = h;
    e.classList.add('on');
  }

  // ---- 円形メニュー
  radial(r) {
    const e = this.radialEl;
    if (!r) { e.classList.remove('on'); e.innerHTML = ''; return; }
    const rs = this.S.radialScale || 1, k = this.k(), R = 92 * k * rs;
    r.scale = k * rs;
    e.classList.add('on');
    let cx = r.x, cy = r.y;
    cx = Math.max(R + 40, Math.min(this.stage.w - R - 40, cx)); cy = Math.max(R + 30, Math.min(this.stage.h - R - 30, cy));
    if (r.x !== cx || r.y !== cy) { r.x = cx; r.y = cy; }
    const n = r.items.length;
    let h = `<div class="rc" style="left:${cx}px;top:${cy}px;width:${R * 2}px;height:${R * 2}px;--rs:${(k * rs).toFixed(3)}"><div class="mid">${r.title || ''}</div>`;
    r.items.forEach((it, i) => {
      if (!it) return; // 空きの場所（並びを決めた円で、その物を持っていない）
      const a = (i / n) * Math.PI * 2;
      const x = Math.sin(a) * R * 0.86, y = -Math.cos(a) * R * 0.86;
      h += `<div class="ri${i === r.sel ? ' sel' : ''}${it.disabled ? ' dis' : ''}" style="left:${R + x}px;top:${R + y}px">${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</div>`;
    });
    h += '</div>';
    e.innerHTML = h;
  }

  // ---- 毎こま
  update(v) {
    if (!this.on) return;
    const p = v.p;
    if (this.stickEl && this.cache.sprWait !== !!v.sprWait) { this.cache.sprWait = !!v.sprWait; this.stickEl.classList.toggle('spr-wait', !!v.sprWait); }
    // 照準
    const ads = p ? p.ads : 0;
    const optic = v.optic;
    // 照準の十字: 構え始め・やめの途中で出たり消えたりしないよう、消す 0.6・出す 0.45 の幅を持たせる。
    // 開きはなめらかに追い、1px 単位で変える（小数の位置で線がにじんで点滅して見えないように。11-13 20:50）
    const hideNow = this.cache.crossHid ? ads > 0.45 : ads > 0.6;
    this.cache.crossHid = hideNow;
    // 十字が点滅していた本当の原因: 最後の v.hideCross が undefined のとき toggle が「切り替え」になり、毎こま出たり消えたりしていた（!! で真偽に）
    this.cross.classList.toggle('hidden', !!(!p || hideNow || this.S.crosshair === 'none' || v.hideCross));
    if (p && !hideNow) {
      const gt = Math.max(3, Math.min(40, (v.spread || 2) * 5)), now = performance.now(), dtc = Math.min(0.1, Math.max(0, (now - (this.cache.gapT || now)) / 1000));
      this.cache.gapT = now;
      this.cache.gapS = this.cache.gapS == null ? gt : this.cache.gapS + (gt - this.cache.gapS) * (1 - Math.exp(-dtc * 14));
      const g = Math.round(this.cache.gapS);
      if (this.cache.gap !== g) { this.cache.gap = g; this.cross.style.setProperty('--gap', g + 'px'); }
      this.cross.classList.toggle('dot', this.S.crosshair === 'dot');
    }
    { const gk = v.giveup || 0; if (this.cache.giveup !== gk) { this.cache.giveup = gk; this.giveup.classList.toggle('on', gk > 0); this.giveup.classList.toggle('arm', gk === 2); this.giveup.lastChild.textContent = gk === 2 ? 'もう一度押すと出撃の画面へ' : '出撃の画面へ'; } }
    // 息止め: ボタンは構えている間だけ出す。息の残りの棒は、止めている間と戻るまで
    {
      const ws = p && p.ws, on = !!(p && p.alive && ads > 0.6);
      const bk = on ? 1 : 0;
      if (this.btn.breath && this.cache.brOn !== bk && !this.editing) { this.cache.brOn = bk; this.btn.breath.classList.toggle('ads-off', !on); }
      if (this.btn.breath) this._flag('breath', !!(ws && ws.holding));
      const br = ws && ws.br != null ? ws.br : 1, show = !!(on && (br < 0.995 || (ws && ws.holding)));
      const key = show ? Math.round(br * 100) + (ws.gasp > 0 ? 'g' : '') : '';
      if (this.cache.brKey !== key) { this.cache.brKey = key; this.breathEl.classList.toggle('on', show); this.breathEl.classList.toggle('gasp', !!(ws && ws.gasp > 0)); if (show) this.breathEl.firstChild.style.width = (br * 100).toFixed(0) + '%'; }
    }
    const retOn = !!(optic && ads > 0.85 && !optic.scope);
    this.reticle.className = 'hud-reticle' + (retOn ? ' on ' + optic.kind : '');
    // 等倍の照準器: 揺れのうち銃が受け持つ分だけ、点が真ん中からずれる（弾が飛ぶ所。game.js _aimFx）
    const ro = retOn && v.retOff ? 'translate(' + v.retOff[0].toFixed(1) + 'px,' + v.retOff[1].toFixed(1) + 'px)' : '';
    if (this.cache.retT !== ro) { this.cache.retT = ro; this.reticle.style.transform = ro; }
    // スコープ: 目に寄せる途中（構え 0.7〜0.95）で接眼レンズの像が大きくなりながら現れ、目と筒のずれで丸い視界がずれて縁が暗くなる
    // スコープの中の像（大規模戦・倍率 6 未満）: 照準の模様はレンズの丸の上だけに（外は銃と世界がそのまま見える）
    const pf = optic && optic.scope ? v.pipFx : null;
    const fx = optic && optic.scope && !pf ? v.scopeFx : null;
    const sk = pf ? 'hud-scope on pip ' + optic.kind : fx ? 'hud-scope on ' + optic.kind + (optic.wide ? ' wide' : '') : 'hud-scope';
    if (this.cache.scope !== sk) { this.cache.scope = sk; this.scope.className = sk; }
    if (pf) {
      const key = 'p' + Math.round(pf.r * 2) + ',' + Math.round(pf.x * 2) + ',' + Math.round(pf.y * 2) + ',' + Math.round(pf.k * 20);
      if (this.cache.sfx !== key) {
        this.cache.sfx = key;
        const st = this.scope.style, W2 = this.scope.clientWidth || 0, H2 = this.scope.clientHeight || 0;
        st.setProperty('--sr', pf.r.toFixed(1) + 'px'); st.setProperty('--scx', (pf.x - W2 / 2).toFixed(1) + 'px'); st.setProperty('--scy', (pf.y - H2 / 2).toFixed(1) + 'px');
        st.opacity = pf.k >= 0.99 ? '' : pf.k.toFixed(2);
      }
    } else if (fx) {
      const key = Math.round(fx.r) + ',' + Math.round(fx.dx * 2) + ',' + Math.round(fx.dy * 2) + ',' + Math.round(fx.e) + ',' + Math.round(fx.k * 50);
      if (this.cache.sfx !== key) {
        this.cache.sfx = key;
        const st = this.scope.style;
        st.setProperty('--sr', fx.r.toFixed(1) + 'px'); st.setProperty('--scx', fx.dx.toFixed(1) + 'px'); st.setProperty('--scy', fx.dy.toFixed(1) + 'px'); st.setProperty('--se', fx.e.toFixed(1) + 'px');
        st.opacity = fx.k >= 0.99 ? '' : fx.k.toFixed(2);
      }
    } else if (this.cache.sfx) { this.cache.sfx = null; this.scope.style.opacity = ''; }
    // 体力・防具
    if (p) {
      const hp = Math.max(0, Math.round(p.hp)), max = p.maxHp || 100;
      const key = hp + '|' + max + '|' + (p.bleed > 0) + '|' + p.inj.arm + p.inj.leg + '|' + (p.armor ? p.armor.pf + ',' + p.armor.pb + ',' + p.armor.helm : '') + '|' + (p.down ? 1 : 0);
      if (this.cache.vit !== key) {
        this.cache.vit = key;
        const vt = this.info.vitals;
        vt.querySelector('.hp i').style.width = (100 * hp / max) + '%';
        vt.querySelector('.hp b').textContent = p.down ? 'ダウン' : hp;
        vt.classList.toggle('low', hp < max * 0.35);
        const pl = [];
        if (p.armor && p.armor.vest !== 'none' && !v.pvp) {
          const P = p.armor.plate;
          if (P === 'ceramic') pl.push(`<span class="pl" title="前の板">前${'▮'.repeat(p.armor.pf)}${'▯'.repeat(Math.max(0, 4 - p.armor.pf))}</span>`, `<span class="pl">後${'▮'.repeat(p.armor.pb)}${'▯'.repeat(Math.max(0, 4 - p.armor.pb))}</span>`);
          else pl.push(`<span class="pl">${P === 'steel' ? 'スチール' : 'ケブラー'}</span>`);
        }
        if (p.armor && p.armor.helmet !== 'none' && !v.pvp) pl.push(`<span class="pl">兜${p.armor.helm > 0 ? '▮'.repeat(p.armor.helm) : '×'}</span>`);
        vt.querySelector('.plates').innerHTML = pl.join('');
        const st = [];
        if (p.bleed > 0) st.push('<span class="bad">出血</span>');
        if (p.inj.arm) st.push('<span class="warn">腕の負傷</span>');
        if (p.inj.leg) st.push(`<span class="warn">脚の負傷×${p.inj.leg}</span>`);
        vt.querySelector('.st').innerHTML = st.join('');
      }
      // 弾
      const wi = v.wi, W = wi ? WEAPONS[wi.id] : null;
      let akey = '';
      if (p.ws.slot === 2 && v.gearId) { const g = p.inv.gear.find(x => x.id === v.gearId); akey = 'g|' + v.gearId + '|' + (g ? g.n : 0) + '|' + (p.ws.c4m || '') + '|' + (v.c4n || 0); }
      else if (p.ws.slot === 3 && p.inv.long) { const m = p.inv.m320, rp = p.inv.rpg; akey = 'L|' + p.inv.long + '|' + (m ? [m.sel, m.flash, m.stinger, m.cs].join(',') : rp ? rp.in + ',' + rp.n : '') + '|' + (p.ws.lt > 0 ? 1 : 0); }
      else if (wi && W) { const [m, r] = ammoCount(wi); akey = wi.id + '|' + m + '|' + r + '|' + wi.mode + '|' + (wi.zi || 0) + '|' + (wi.mags ? wi.mags.join(',') : '') + '|' + p.ws.st; }
      if (this.cache.ammo !== akey) {
        this.cache.ammo = akey;
        const am = this.info.ammo;
        if (akey.startsWith('L|')) {
          const L = p.inv.long, m = p.inv.m320;
          const RN = { flash: '閃光弾', stinger: 'スティンガー弾', cs: 'CSガス弾' };
          if (L === 'm320' && m) {
            am.querySelector('.mode').textContent = (RN[m.sel] || '') + (p.ws.lt > 0 ? '・装填中' : '');
            am.querySelector('.cnt').innerHTML = `<b class="${m[m.sel] ? '' : 'empty'}">${m[m.sel] || 0}</b><span>/${m.flash + m.stinger + m.cs}</span>`;
            am.querySelector('.mags').innerHTML = ['flash', 'stinger', 'cs'].map(k => `<em class="${k === m.sel ? 'on' : ''}">${RN[k].slice(0, 2)}${m[k]}</em>`).join('');
          } else if (L === 'rpg' && p.inv.rpg) {
            // RPG-7: 込めた弾（0/1）と予備
            const rp = p.inv.rpg;
            am.querySelector('.mode').textContent = 'RPG-7' + (p.ws.lt > 0 ? '・装填中' : '');
            am.querySelector('.cnt').innerHTML = `<b class="${rp.in ? '' : 'empty'}">${rp.in}</b><span>/${rp.n}</span>`;
            am.querySelector('.mags').innerHTML = '';
          } else {
            am.querySelector('.mode').textContent = '';
            am.querySelector('.cnt').innerHTML = `<b class="lname">${LONG[L] ? LONG[L].name : ''}</b>`;
            am.querySelector('.mags').innerHTML = '';
          }
        } else if (akey.startsWith('g|')) {
          const g = p.inv.gear.find(x => x.id === v.gearId);
          am.querySelector('.mode').textContent = (GEAR[v.gearId] ? GEAR[v.gearId].name : '') + (v.gearId === 'c4' ? (p.ws.c4m === 'det' ? `・起爆（置いた ${v.c4n || 0}）` : '・投げる') : '');
          am.querySelector('.cnt').innerHTML = `<b>${g ? g.n : 0}</b><span>個</span>`;
          am.querySelector('.mags').innerHTML = '';
        } else if (wi && W) {
          const [m, r] = ammoCount(wi);
          am.querySelector('.mode').textContent = v.war
            ? (W.bolt ? 'BOLT' : W.modes[wi.mode] === 'auto' ? 'AUTO' : W.modes[wi.mode] === 'burst' ? 'BURST' : 'SEMI') + (zoomsOf(wi.att) ? (zoomOf(wi) <= 1 ? ' · 1x' : ` · ${zoomOf(wi)}x`) : '') + (p.ws.st === 'consol' ? ' · 弾倉をまとめる' : p.ws.st === 'reload' ? ' · RELOAD' : p.ws.st === 'shell' ? ' · LOAD' : '')
            : (W.bolt ? 'ボルト' : W.modes[wi.mode] === 'auto' ? '連射' : W.modes[wi.mode] === 'burst' ? '3点' : '単発') + (zoomsOf(wi.att) ? (zoomOf(wi) <= 1 ? '・等倍' : `・${zoomOf(wi)}倍`) : '') + (p.ws.st === 'reload' ? '・リロード中' : p.ws.st === 'shell' ? '・装填中' : '');
          // 対戦は予備が減らない（∞）
          // 大規模戦は弾倉の数（BattleBit も残りを弾倉で見せる）
          const inf = v.pvp && !v.war;
          am.querySelector('.cnt').innerHTML = `<b class="${m === 0 ? 'empty' : m <= (wi.cap || W.mag) * 0.25 ? 'lowa' : ''}">${m}</b><span>/${inf ? '∞' : wi.mags ? (v.war ? '×' + wi.mags.length : wi.mags.length + '本') : r}</span>`;
          // 弾倉ごとの残り（RoN の弾倉の確認のように）
          am.querySelector('.mags').innerHTML = wi.mags && !inf ? wi.mags.slice().sort((a, b) => b - a).map(n => `<i style="--f:${n / (wi.cap || W.mag)}"></i>`).join('') : '';
        } else { am.querySelector('.mode').textContent = ''; am.querySelector('.cnt').innerHTML = '<b>-</b>'; am.querySelector('.mags').innerHTML = ''; }
      }
      // 武器の切り替え
      const wkey = (p.inv.w[0] ? p.inv.w[0].id : '') + '|' + (p.inv.w[1] ? p.inv.w[1].id : '') + '|' + p.ws.slot;
      if (this.cache.wpn !== wkey) {
        this.cache.wpn = wkey;
        for (const [i, id] of [[0, 'wpn1'], [1, 'wpn2']]) {
          const w2 = p.inv.w[i];
          const e = this.btn[id];
          e.querySelector('.lb').textContent = w2 ? WEAPONS[w2.id].name : 'なし';
          e.classList.toggle('cur', p.ws.slot === i || (p.ws.next === i && p.ws.st === 'holster'));
          e.classList.toggle('dis', !w2);
        }
      }
      // ボタンの状態
      this._flag('ads', v.adsOn); this._flag('crouch', p.stance >= 1); this._flag('leanL', v.leanL); this._flag('leanR', v.leanR);
      this._flag('light', !!(wi && wi.lightOn)); this._flag('nvg', !!v.nvgOn);
      this.btn.nvg.classList.toggle('dis', !v.hasNvg);
      this.btn.light.classList.toggle('dis', !(wi && wi.att && (wi.att.light || wi.att.laser)));
      const m320 = p.ws.slot === 3 && p.inv.long === 'm320';
      // 射撃モードのボタン: 射撃モードだけ（フル・バースト・単発）。倍率は別のボタン（倍率を切り替えられる照準器の時だけ出す。11-19 14:03）
      const bino = p.ws.slot === 2 && p.ws.gear === 'binoc' && GEAR.binoc;
      const zs = bino ? GEAR.binoc.zooms : !m320 && W && wi ? zoomsOf(wi.att) : null;
      // C4 を持っている: 射撃モードのボタンで「投げる／起爆」
      const c4 = p.ws.slot === 2 && GEAR[p.ws.gear] && GEAR[p.ws.gear].kind === 'c4';
      const fm = c4 ? (p.ws.c4m === 'det' ? '起爆' : '投げる') : m320 ? '弾種' : W ? (W.bolt ? 'BOLT' : W.modes[wi.mode] === 'auto' ? 'AUTO' : W.modes[wi.mode] === 'burst' ? 'BURST' : 'SEMI') : '';
      const zl = bino ? `×${GEAR.binoc.zooms[p.ws.bz ?? GEAR.binoc.zi]}` : zs ? (zoomOf(wi) <= 1 ? '×1' : `×${zoomOf(wi)}`) : '';
      const fk = fm + '|' + zl + '|' + (zs ? 1 : 0) + (c4 || m320 || (W && W.modes.length > 1) ? 1 : 0);
      if (this.cache.fmk !== fk) {
        this.cache.fmk = fk;
        this.btn.fmode.querySelector('.lb').textContent = fm;
        this.btn.fmode.classList.toggle('dis', !c4 && !m320 && !(W && W.modes.length > 1));
        this.btn.zoom.querySelector('.lb').textContent = zl;
        this.btn.zoom.classList.toggle('na', !zs);
      }
      // '@long' は手に持つ特殊装備（大規模戦の工兵の RPG-7）
      const lg = v.gearSel === '@long' && LONG[p.inv.long] ? p.inv.long : null;
      const gtxt = lg ? LONG[lg].name : v.gearSel ? (GEAR[v.gearSel] ? GEAR[v.gearSel].name.replace(/（.*）/, '') : '') : '';
      const gn = lg ? (p.inv.rpg ? p.inv.rpg.in + p.inv.rpg.n : 1) : v.gearSel ? (p.inv.gear.find(x => x.id === v.gearSel) || { n: 0 }).n : 0;
      const gk = gtxt + gn;
      if (this.cache.gear !== gk) { this.cache.gear = gk; this.btn.gear.querySelector('.lb').textContent = gtxt; this.btn.gear.querySelector('.ct').textContent = v.gearSel ? gn : ''; }
      // 大規模戦: 投げ物・包帯・道具のボタン（選んでいる物の名前と数。持っていない・0 なら薄く）
      if (this.mode.war && v.slots) {
        for (const [id, o] of Object.entries(v.slots)) {
          const e = this.btn[id]; if (!e) continue;
          const key = o.lb + '|' + o.n + '|' + (o.dis ? 1 : 0) + '|' + (o.on ? 1 : 0);
          if (this.cache['sl_' + id] === key) continue;
          this.cache['sl_' + id] = key;
          e.querySelector('.lb').textContent = o.lb; e.querySelector('.ct').textContent = o.n == null ? '' : o.n;
          e.classList.toggle('dis', !!o.dis); e.classList.toggle('on', !!o.on);
        }
      }
      if (this.btn.rally) { const rk = (v.rally ? 1 : 0) + '|' + (v.rally && v.rally.ok ? 1 : 0) + '|' + (v.rally ? v.rally.lb : ''); if (this.cache.rally !== rk) { this.cache.rally = rk; this.btn.rally.classList.toggle('na', !v.rally); this.btn.rally.classList.toggle('dis', !!v.rally && !v.rally.ok); this.btn.rally.querySelector('.lb').textContent = v.rally ? v.rally.lb : ''; } }
      this.btn.vault.classList.toggle('dis', !v.canVault && !this.mode.war); // 乗り越えのボタンは文字を出さない（11-12 の要望）。大規模戦は越える物がなくても跳ぶ
      this.btn.reload.classList.toggle('dis', false);
      // 調べる: その時できること
      const ukey = v.ctxLabel || '';
      if (this.cache.use !== ukey) { this.cache.use = ukey; this.btn.use.querySelector('.lb').textContent = ukey ? ukey.split('|')[0] : ''; this.btn.use.classList.toggle('dis', !ukey); }
      const ck = v.cmdLabel || '';
      if (this.cache.cmd !== ck) { this.cache.cmd = ck; this.btn.cmd.querySelector('.lb').textContent = ck; }
      const tk = v.team || 'gold';
      if (this.cache.team !== tk) { this.cache.team = tk; this.btn.team.style.color = TEAMCOL[tk]; this.btn.team.querySelector('.lb').textContent = TEAMJA[tk]; this.btn.cmd.style.color = TEAMCOL[tk]; }
      this.btn.drone.classList.toggle('hidden', !v.droneOK && !this.editing);
      if (this.btn.cams) { this.btn.cams.classList.toggle('hidden', !v.camsOK && !this.editing); this.btn.cams.classList.toggle('on', v.camOn === true); }
      if (this.btn.zone) {
        this.btn.zone.classList.toggle('hidden', !v.zoneOK && !this.editing);
        const zl = v.zoneOK ? '出現: ' + (v.zoneLabel || '') : '出現地点';
        if (this.cache.zone !== zl) { this.cache.zone = zl; this.btn.zone.querySelector('.lb').textContent = zl; }
      }
    }
    // 案内の文字
    const pr = v.prompt || '';
    if (this.cache.prompt !== pr) { this.cache.prompt = pr; this.prompt.textContent = pr; this.prompt.classList.toggle('on', !!pr); }
    // 進みの輪
    if (v.prog != null) {
      this.prog.classList.add('on');
      this.prog.querySelector('.fg').style.strokeDashoffset = String(163.4 * (1 - v.prog));
      const pl = v.progLabel || '';
      if (this.cache.progL !== pl) { this.cache.progL = pl; this.prog.querySelector('.lb').textContent = pl; }
    } else this.prog.classList.remove('on');
    // 方位
    const deg = (((Math.PI - (v.yaw || 0)) * 180 / Math.PI) % 360 + 360) % 360;
    const ck = Math.round(deg * 2);
    if (this.cache.comp !== ck) { this.cache.comp = ck; this.info.compass.firstChild.innerHTML = compassHTML(deg); }
    // 目的
    const ok = v.objKey || '';
    if (this.cache.obj !== ok) { this.cache.obj = ok; this.info.obj.innerHTML = v.objHTML || ''; }
    // 隊員
    const sq = v.squadKey || '';
    if (this.cache.squad !== sq) { this.cache.squad = sq; this.info.squad.innerHTML = v.squadHTML || ''; }
    // 被弾の向き
    const now = performance.now();
    this.dmgArcs = this.dmgArcs.filter(a => now - a.t < 1200);
    const dk = this.dmgArcs.map(a => Math.round(a.ang * 10)).join(',') + '|' + Math.floor(now / 100);
    if (this.cache.dmg !== dk) {
      this.cache.dmg = dk;
      this.dmg.innerHTML = this.dmgArcs.map(a => { const rel = a.ang - (v.yaw || 0); const op = 1 - (now - a.t) / 1200; return `<i style="transform:translate(-50%,-50%) rotate(${-rel}rad) translateY(-70px);opacity:${op}"></i>`; }).join('');
    }
  }
  // のぞいている間の表示（カメラの映像だけ。戻るボタンと短い案内）。k: 'mirror' | 'wand' | null
  setPeek(k) {
    const key = k || '';
    if (this.cache.peek === key) return;
    this.cache.peek = key;
    this.peekEl.classList.toggle('on', !!k);
    this.root.classList.toggle('peeking', !!k);
  }
  _flag(id, on) { const e = this.btn[id]; if (e && (e._on !== !!on)) { e._on = !!on; e.classList.toggle('on', !!on); } }

  // ---- 出来事
  feed(html, kind = '') {
    const e = el('div', 'fi ' + kind, html);
    this.info.feed.prepend(e);
    while (this.info.feed.children.length > 6) this.info.feed.lastChild.remove();
    setTimeout(() => { e.classList.add('old'); setTimeout(() => e.remove(), 600); }, 5200);
  }
  subtitle(who, text, col) {
    if (this.S.subtitles === false) return;
    const e = el('div', 'si', `<b style="color:${col || '#9cd0ff'}">${who}</b>${text}`);
    this.subs.appendChild(e);
    while (this.subs.children.length > 2) this.subs.firstChild.remove();
    setTimeout(() => { e.classList.add('old'); setTimeout(() => e.remove(), 500); }, 3600);
  }
  // 当たりの印: 照準の真ん中は空けた4本の斜めの線。倒した印（赤）は大きく長く。続けて当たると出し直す
  hit(kind) {
    if (this._hitKind === 'kill' && kind !== 'kill' && this.hitm.classList.contains('on')) return;
    this._hitKind = kind || '';
    this.hitm.className = 'hud-hit ' + (kind || ''); void this.hitm.offsetWidth; this.hitm.className = 'hud-hit on ' + (kind || '');
    clearTimeout(this._hitT); this._hitT = setTimeout(() => { this.hitm.className = 'hud-hit fade ' + (kind || ''); this._hitKind = ''; }, kind === 'kill' ? 420 : 150);
  }
  // 点: o = { pts, label, line }。3 秒の間に続けて入ると合計を足し、同じ内訳はまとめる
  points(o) {
    const e = this.ptsEl, now = performance.now();
    const P = this._pts && now - this._pts.t < 3000 ? this._pts : (this._pts = { tot: 0, rows: [], line: '' });
    P.t = now; P.tot += o.pts;
    if (o.line) P.line = o.line;
    const r = P.rows.find(x => x[0] === o.label);
    if (r) { r[1] += o.pts; r[2]++; } else { P.rows.push([o.label, o.pts, 1]); if (P.rows.length > 4) P.rows.shift(); }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    e.children[0].innerHTML = P.line ? esc(P.line) : '';
    e.children[1].textContent = '+' + P.tot;
    e.children[2].innerHTML = P.rows.map(x => `<div><span>${esc(x[0])}${x[2] > 1 ? ' ×' + x[2] : ''}</span><b>${x[1]}</b></div>`).join('');
    e.className = 'hud-pts'; void e.offsetWidth; e.className = 'hud-pts on';
    clearTimeout(this._ptsT); this._ptsT = setTimeout(() => { e.className = 'hud-pts on fade'; }, 2600);
  }
  // 分隊ポイント（大規模戦）: 体力の上に数と、増えた分を少しの間
  sqPoints(n, add) {
    const e = this.info.vitals.querySelector('.sqp'); if (!e) return;
    if (n == null) { e.classList.remove('on'); return; }
    e.classList.add('on'); e.children[1].textContent = n;
    if (add) { const x = e.children[2]; x.textContent = '+' + add; x.className = ''; void x.offsetWidth; x.className = 'on'; clearTimeout(this._sqpT); this._sqpT = setTimeout(() => { x.className = ''; }, 2400); }
  }
  damageFrom(ang) { this.dmgArcs.push({ ang, t: performance.now() }); }
  showBanner(html, ms = 2600, cls = '') { this.banner.innerHTML = html; this.banner.className = 'hud-banner on ' + cls; clearTimeout(this._banT); if (ms > 0) this._banT = setTimeout(() => { this.banner.className = 'hud-banner'; }, ms); }
  hideBanner() { this.banner.className = 'hud-banner'; }
  showMirror(html) { this.mirror.innerHTML = html; this.mirror.classList.add('on'); clearTimeout(this._mirT); this._mirT = setTimeout(() => this.mirror.classList.remove('on'), 6000); }

  // ---- 大規模戦: 世界の上の印。list: [{ x, y（画面）, k: 'flag'|'ally'|'squad'|'enemy', t: 文字, col, d: 距離m }]
  warMarks(list) {
    const cv = this.ov, st = this.stage, dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(st.w * dpr), H = Math.round(st.h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = st.w + 'px'; cv.style.height = st.h + 'px'; }
    const c = this.ovCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, st.w, st.h);
    if (!list || !list.length) return;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // 印の大きさ（設定。BattleBit の旗・印・名前の大きさ）: 拠点の印と、ほかの印（仲間・敵・集合など）を別に
    const fS = this.S.flagMarkSize ?? 1, mS = this.S.markSize ?? 1;
    // 味方の名前の文字（px。印の大きさで縮めない）
    this._nameF = `700 ${Math.round((this.S.nameSize ?? 11) / mS * 10) / 10}px "Noto Sans JP", sans-serif`;
    for (const m of list) {
      const sc = m.k === 'flag' ? fS : mS;
      if (sc !== 1) { c.save(); c.translate(m.x, m.y); c.scale(sc, sc); c.translate(-m.x, -m.y); }
      this._mark(c, m);
      if (sc !== 1) c.restore();
    }
    c.globalAlpha = 1;
  }
  _mark(c, m) {
    {
      if (m.k === 'flag') {
        c.globalAlpha = 0.92;
        c.beginPath(); c.arc(m.x, m.y, 11, 0, Math.PI * 2); c.fillStyle = 'rgba(8,12,18,0.6)'; c.fill();
        c.lineWidth = 2.5; c.strokeStyle = m.col; c.stroke();
        if (m.prog != null) { c.beginPath(); c.arc(m.x, m.y, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.abs(m.prog)); c.strokeStyle = m.pcol || m.col; c.lineWidth = 3.5; c.stroke(); }
        c.fillStyle = m.col; c.font = '900 12px Inter, sans-serif'; c.fillText(m.t, m.x, m.y + 0.5);
        if (m.goal) {
          // 分隊の目標: 輪の外に黄色の角と、上に「攻撃」「防衛」
          c.strokeStyle = '#ffd84a'; c.lineWidth = 2;
          for (let i = 0; i < 4; i++) { const a0 = i * Math.PI / 2 + Math.PI / 4; c.beginPath(); c.arc(m.x, m.y, 15, a0 - 0.32, a0 + 0.32); c.stroke(); }
          c.font = '800 10px "Noto Sans JP", sans-serif'; const tw = c.measureText(m.goal).width + 8;
          c.fillStyle = 'rgba(8,12,18,0.7)'; c.fillRect(m.x - tw / 2, m.y - 33, tw, 14);
          c.fillStyle = '#ffd84a'; c.fillText(m.goal, m.x, m.y - 25.5);
        }
        if (m.d != null) { c.font = '700 10px Inter, sans-serif'; c.fillStyle = 'rgba(235,240,245,0.9)'; c.fillText(Math.round(m.d) + 'm', m.x, m.y + 20); }
      } else if (m.k === 'sign') {
        // 射撃場の距離の札
        c.globalAlpha = 0.9; c.font = '800 11px Inter, sans-serif';
        const w = c.measureText(m.t).width + 10;
        c.fillStyle = 'rgba(8,12,18,0.62)'; c.fillRect(m.x - w / 2, m.y - 9, w, 18);
        c.fillStyle = '#f2f4f5'; c.fillText(m.t, m.x, m.y + 0.5);
      } else if (m.k === 'spot') {
        // 印をつけた敵: 赤い菱形と距離
        c.globalAlpha = 0.95; const s = 6;
        c.fillStyle = m.col; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(m.x, m.y - s); c.lineTo(m.x + s * 0.8, m.y); c.lineTo(m.x, m.y + s); c.lineTo(m.x - s * 0.8, m.y); c.closePath(); c.fill(); c.stroke();
        c.font = '700 10px Inter, sans-serif'; c.fillStyle = 'rgba(255,215,210,0.95)'; c.fillText(Math.round(m.d) + 'm', m.x, m.y - s - 7);
      } else {
        // 味方: 頭の上の小さな山形（分隊は緑・ほかは青）。近いほど大きく
        const s = Math.max(3.5, Math.min(7, 7 - (m.d || 0) / 40));
        c.globalAlpha = m.k === 'enemy' ? 0.95 : 0.85;
        c.fillStyle = m.col;
        c.beginPath(); c.moveTo(m.x - s, m.y - s * 0.9); c.lineTo(m.x + s, m.y - s * 0.9); c.lineTo(m.x, m.y + s * 0.5); c.closePath(); c.fill();
        if (m.t && (m.d || 0) < 30) { c.font = this._nameF || '700 11px "Noto Sans JP", sans-serif'; c.fillStyle = m.col; c.fillText(m.t, m.x, m.y - s - 7); }
      }
    }
    c.globalAlpha = 1;
  }
  // 出撃の画面（倒れている間・試合の始め）。d: null で隠す / game.js の _warDeployData()
  deploy(d) {
    if (!d) { if (this.deployOn) { this.deployOn = false; this.deployEl.classList.remove('on'); } return; }
    if (!this.dps) this.dps = new DeployScreen(this.deployEl);
    if (!this.deployOn) { this.deployOn = true; this.deployEl.classList.add('on'); this.dps.cache = {}; }
    this.dps.update(d);
  }

  // ---- ミニマップ
  setPlan(w, def) {
    this.plan = buildPlan(w, def);
    this.planW = w;
  }
  // 大規模戦: 地図全体の絵（1画素 2m）を回して切り出す
  setWarPlan(ww, m) { this.plan = { war: true, img: warPlanImage(ww, m), m }; this.planW = ww; }
  _drawWarMinimap(v) {
    const ctx = this.mmCtx, Wc = 240, p = v.p, P = this.plan;
    const ppm = 1.25 * (v.mmZoom || 1), a = Math.PI + (v.yaw || 0), c = Math.cos(a), s = Math.sin(a);
    ctx.save();
    ctx.clearRect(0, 0, Wc, Wc);
    ctx.beginPath(); ctx.arc(Wc / 2, Wc / 2, Wc / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(10,14,18,0.78)'; ctx.fillRect(0, 0, Wc, Wc);
    ctx.translate(Wc / 2, Wc / 2); ctx.rotate(a); ctx.scale(ppm * WAR_PX, ppm * WAR_PX);
    ctx.globalAlpha = 0.92; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(P.img, -p.x / WAR_PX, -p.z / WAR_PX);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const toXY = (x, z) => { const u = (x - p.x) * ppm, w = (z - p.z) * ppm; return [Wc / 2 + u * c - w * s, Wc / 2 + u * s + w * c]; };
    drawWarMarks(ctx, P.m, p.team, toXY, 1);
    for (const mk of v.marks || []) { const [x, y] = toXY(mk.x, mk.z); ctx.fillStyle = mk.col; ctx.beginPath(); if (mk.sq) ctx.rect(x - 3, y - 3, 6, 6); else ctx.arc(x, y, mk.r ? Math.min(4, mk.r) : 3.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#ffd34a';
    ctx.beginPath(); ctx.moveTo(Wc / 2, Wc / 2 - 9); ctx.lineTo(Wc / 2 + 6, Wc / 2 + 6); ctx.lineTo(Wc / 2, Wc / 2 + 2); ctx.lineTo(Wc / 2 - 6, Wc / 2 + 6); ctx.closePath(); ctx.fill();
    const n = this.info.minimap.querySelector('.hud-mm-n'), yw = v.yaw || 0;
    n.style.transform = `translate(-50%,-50%) translate(${-Math.sin(yw) * 54}px, ${Math.cos(yw) * 54}px)`;
  }
  drawMinimap(v) {
    if (!this.plan || !v.p || this.S.minimap === false) return;
    if (this.plan.war) return this._drawWarMinimap(v);
    const ctx = this.mmCtx, Wc = 240, s = this.plan.s;
    const p = v.p, L = Math.max(0, Math.min(this.planW.NL - 1, Math.floor((p.y + 0.4) / LH)));
    ctx.save();
    ctx.clearRect(0, 0, Wc, Wc);
    ctx.beginPath(); ctx.arc(Wc / 2, Wc / 2, Wc / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(10,14,18,0.78)'; ctx.fillRect(0, 0, Wc, Wc);
    const f = 4.6 * (v.mmZoom || 1) * CS / s; // 1m = 4.6画素（半径およそ26m）
    ctx.translate(Wc / 2, Wc / 2);
    ctx.rotate(Math.PI + (v.yaw || 0)); // 自分の向きが上
    ctx.scale(f, f);
    const px = p.x / CS * s, pz = p.z / CS * s;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.plan.levels[L], -px, -pz);
    ctx.globalAlpha = 1;
    // 印
    const dot = (x, z, col, r = 3.2, sq = false) => { ctx.fillStyle = col; const X = x / CS * s - px, Z = z / CS * s - pz; ctx.beginPath(); if (sq) ctx.rect(X - r, Z - r, r * 2, r * 2); else ctx.arc(X, Z, r, 0, Math.PI * 2); ctx.fill(); };
    for (const m of v.marks || []) dot(m.x, m.z, m.col, m.r || 3.2, m.sq);
    ctx.restore();
    // 自分（真ん中の矢印）
    ctx.fillStyle = '#ffd34a';
    ctx.beginPath(); ctx.moveTo(Wc / 2, Wc / 2 - 9); ctx.lineTo(Wc / 2 + 6, Wc / 2 + 6); ctx.lineTo(Wc / 2, Wc / 2 + 2); ctx.lineTo(Wc / 2 - 6, Wc / 2 + 6); ctx.closePath(); ctx.fill();
    // 北の印の位置
    const n = this.info.minimap.querySelector('.hud-mm-n');
    const yw = v.yaw || 0;
    n.style.transform = `translate(-50%,-50%) translate(${-Math.sin(yw) * 54}px, ${Math.cos(yw) * 54}px)`;
  }

  // ---- HUD の編集
  edit(settings, onSave, onDone) {
    this.editing = true; this.sel = null;
    // 編集は大規模戦の配置で見せる（タイトルの設定から開いても、作り直す前のモードのボタンを出さない）
    this._modeBak = this.mode; if (!this.mode || !this.mode.war) this.mode = { war: true, edit: true };
    this.root.classList.add('editing');
    this.layout();
    const H = settings.hud || (settings.hud = {});
    const bar = this.editBar;
    const defOf = (id) => id === 'stick' ? STICK_DEF : id.startsWith('i_') ? INFO[id.slice(2)] : BTN[id];
    const pick = (id) => {
      this.sel = id;
      for (const e of this.root.querySelectorAll('.sel')) e.classList.remove('sel');
      const e = id === 'stick' ? this.stickEl : id.startsWith('i_') ? this.info[id.slice(2)] : this.btn[id];
      if (e) e.classList.add('sel');
      const def = defOf(id);
      bar.querySelector('.nm').textContent = def ? def.name : id;
      const ov = H[id] || {};
      bar.querySelector('[data-k="s"]').value = ov.s || 1;
      bar.querySelector('[data-k="o"]').value = ov.o ?? (id === 'stick' ? 0.55 : (settings.hudOpacity ?? 0.85));
      bar.querySelector('[data-k="spr"]').value = ov.spr ?? 1.25;
      bar.querySelector('.sprl').hidden = id !== 'stick';
      bar.querySelector('[data-a="hide"]').hidden = id === 'stick';
      bar.querySelector('[data-a="hide"]').textContent = ov.hide ? '表示' : '隠す';
      placeBar();
    };
    // 設定の欄の場所: 自分で動かした時はそこ。動かしていなければ、選んだ項目が上半分なら下・下半分なら上に出す（上の方の HUD が欄に隠れて設定しにくかった。11-19 23:27）
    const placeBar = () => {
      const P = settings.hudBarPos;
      bar.classList.toggle('free', !!P);
      if (P) {
        const W = this.stage.w, Hh = this.stage.h, bw = bar.offsetWidth, bh = bar.offsetHeight;
        const x = Math.max(4, Math.min(W - bw - 4, P.x * W)), y = Math.max(4, Math.min(Hh - bh - 4, P.y * Hh));
        bar.classList.remove('bot', 'top', 'mid');
        bar.style.left = x + 'px'; bar.style.top = y + 'px';
        return;
      }
      // 自動: 上から下まで何段か試し、見えている HUD の項目に重ならない（重なりが一番小さい）所に置く。選んでいる項目には重ねない
      bar.classList.remove('bot', 'top', 'mid'); bar.classList.add('free');
      const W = this.stage.w, Hh = this.stage.h, bw = bar.offsetWidth, bh = bar.offsetHeight;
      const k0 = this.stage.toStage(0, 0), sc = this.stage.toStage(1, 1);
      const sx = sc[0] - k0[0] || 1, sy = sc[1] - k0[1] || 1;
      const rects = [];
      const selEl = !this.sel ? null : this.sel === 'stick' ? this.stickEl : this.sel.startsWith('i_') ? this.info[this.sel.slice(2)] : this.btn[this.sel];
      for (const e of this.root.querySelectorAll('[data-btn], [data-info], .hud-stick')) {
        if (e.closest('.hud-editbar') || e.classList.contains('hidden') || getComputedStyle(e).display === 'none') continue;
        const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const [x0, y0] = this.stage.toStage(r.left, r.top);
        rects.push({ x0, y0, x1: x0 + r.width * sx, y1: y0 + r.height * sy, w: e === selEl ? 50 : 1 });
      }
      const x = Math.max(4, (W - bw) / 2);
      let best = null;
      for (let t = 0; t <= 20; t++) {
        const y = 4 + (Hh - bh - 8) * t / 20;
        let cost = Math.abs(y + bh / 2 - Hh / 2) * 0.02;
        for (const q of rects) { const ox = Math.min(x + bw, q.x1) - Math.max(x, q.x0), oy = Math.min(y + bh, q.y1) - Math.max(y, q.y0); if (ox > 0 && oy > 0) cost += ox * oy * q.w; }
        if (!best || cost < best.cost) best = { y, cost };
      }
      bar.style.left = x + 'px'; bar.style.top = best.y + 'px';
    };
    const grip = bar.querySelector('.grip');
    let gd = null;
    grip.onpointerdown = (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = bar.getBoundingClientRect(), [bx, by] = this.stage.toStage(r.left, r.top), [sx, sy] = this.stage.toStage(e.clientX, e.clientY);
      gd = { pid: e.pointerId, dx: sx - bx, dy: sy - by };
      try { grip.setPointerCapture(e.pointerId); } catch (er) { /* なし */ }
    };
    grip.onpointermove = (e) => {
      if (!gd || e.pointerId !== gd.pid) return;
      e.preventDefault(); e.stopPropagation();
      const [sx, sy] = this.stage.toStage(e.clientX, e.clientY);
      settings.hudBarPos = { x: (sx - gd.dx) / this.stage.w, y: (sy - gd.dy) / this.stage.h };
      placeBar();
    };
    grip.onpointerup = grip.onpointercancel = (e) => { if (gd && e.pointerId === gd.pid) { gd = null; onSave(settings); } };
    // 2回続けて押すと、自動の場所に戻す
    grip.ondblclick = () => { delete settings.hudBarPos; placeBar(); onSave(settings); };
    placeBar();
    let drag = null;
    this._editDown = (e) => {
      let t = e.target, id = null;
      while (t && t !== this.root) { if (t.dataset && t.dataset.edit) { id = t.dataset.edit; break; } if (t.dataset && t.dataset.info) { id = 'i_' + t.dataset.info; break; } if (t.dataset && t.dataset.btn) { id = t.dataset.btn; break; } if (t === bar) return; t = t.parentNode; }
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      pick(id);
      const [sx, sy] = this.stage.toStage(e.clientX, e.clientY);
      const def = defOf(id);
      const ov = H[id] || {};
      drag = { id, sx, sy, x0: ov.x ?? def.x, y0: ov.y ?? def.y, pid: e.pointerId, def };
      try { this.root.setPointerCapture(e.pointerId); } catch (er) { /* なし */ }
    };
    this._editMove = (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const [sx, sy] = this.stage.toStage(e.clientX, e.clientY);
      const k = this.k(), d = drag.def;
      let dx = (sx - drag.sx) / k, dy = (sy - drag.sy) / k;
      const lr = this.S.handed === 'left' ? (d.ax === 'l' ? 'r' : d.ax === 'r' ? 'l' : 'c') : d.ax;
      const ov = H[drag.id] || (H[drag.id] = {});
      ov.x = Math.round(drag.x0 + (lr === 'r' ? -dx : lr === 'c' && this.S.handed === 'left' ? -dx : dx));
      ov.y = Math.round(drag.y0 + ((ov.ay || d.ay) === 'b' ? -dy : dy));
      delete ov.preset;
      this.layout();
    };
    this._editUp = (e) => { if (drag && e.pointerId === drag.pid) { drag = null; onSave(settings); } };
    this.root.addEventListener('pointerdown', this._editDown, true);
    this.root.addEventListener('pointermove', this._editMove, true);
    this.root.addEventListener('pointerup', this._editUp, true);
    const inputs = bar.querySelectorAll('input');
    inputs.forEach(inp => { inp.oninput = () => { if (!this.sel) return; const ov = H[this.sel] || (H[this.sel] = {}); ov[inp.dataset.k] = +inp.value; this.layout(); onSave(settings); }; });
    const btns = {};
    bar.querySelectorAll('button').forEach(b => { btns[b.dataset.a] = b; });
    onTap(btns.hide, () => { if (!this.sel) return; const ov = H[this.sel] || (H[this.sel] = {}); ov.hide = !ov.hide; pick(this.sel); this.layout(); onSave(settings); });
    onTap(btns.reset1, () => { if (!this.sel) return; delete H[this.sel]; pick(this.sel); this.layout(); onSave(settings); });
    let armed = false;
    onTap(btns.resetAll, () => { if (!armed) { armed = true; btns.resetAll.textContent = 'もう一度押して初期化'; setTimeout(() => { armed = false; btns.resetAll.textContent = 'すべて初期化'; }, 2500); return; } armed = false; btns.resetAll.textContent = 'すべて初期化'; for (const k of Object.keys(H)) delete H[k]; delete settings.hudBarPos; this.layout(); onSave(settings); });
    onTap(btns.done, () => {
      this.editing = false;
      if (this._modeBak) { this.mode = this._modeBak; this._modeBak = null; }
      this.root.classList.remove('editing');
      for (const e of this.root.querySelectorAll('.sel')) e.classList.remove('sel');
      this.root.removeEventListener('pointerdown', this._editDown, true);
      this.root.removeEventListener('pointermove', this._editMove, true);
      this.root.removeEventListener('pointerup', this._editUp, true);
      this.layout();
      onSave(settings);
      onDone();
    });
  }
}

function compassHTML(deg) {
  // 幅 260px に ±65° を表示
  const out = [];
  const lbl = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let a = Math.floor((deg - 70) / 15) * 15; a <= deg + 70; a += 15) {
    const d = a - deg, x = 130 + d * 2;
    const n = ((a % 360) + 360) % 360;
    out.push(`<span style="left:${x}px" class="${lbl[n] ? (n % 90 ? 'm' : 'M') : ''}">${lbl[n] || '|'}</span>`);
  }
  return out.join('') + `<em>${Math.round(deg) % 360}°</em>`;
}

// 見取り図（ミニマップと地図の画面で使う）: 1マス = s 画素
export function buildPlan(w, def, s = 4) {
  const levels = [];
  for (let L = 0; L < w.NL; L++) {
    const c = document.createElement('canvas');
    c.width = w.W * s; c.height = w.D * s;
    const x = c.getContext('2d');
    for (let j = 0; j < w.D; j++) for (let i = 0; i < w.W; i++) {
      const k = w.idx(L, i, j), t = w.cell[k];
      let col = null;
      if (t === C.FLOOR || (t === C.STAIR && w.indoor[k])) col = '#57606a';
      else if (t === C.OUT) col = '#2e3a33';
      else if (t === C.STAIR) col = '#4a5650';
      else if (t === C.DOOR) col = '#a0643a';
      else if (t === C.WINDOW || t === C.GLASSWALL) col = '#4aa3d8';
      else if (t === C.OPEN) col = '#57606a';
      else if (t === C.LOW || t === C.FENCE) col = '#6d7a72';
      else if (t === C.WALL) col = '#d8dde2';
      if (!col) continue;
      x.fillStyle = col;
      if (isWallish(t) && t !== C.OPEN) {
        x.fillStyle = (t === C.FLOOR) ? col : (w.indoor[k] ? '#57606a' : '#2e3a33');
        x.fillRect(i * s, j * s, s, s);
        x.fillStyle = col;
        for (let n = 0; n < w.nbox[k]; n++) { const o = k * 8 + n * 4; x.fillRect(w.boxes[o] / CS * s, w.boxes[o + 1] / CS * s, Math.max(1, (w.boxes[o + 2] - w.boxes[o]) / CS * s), Math.max(1, (w.boxes[o + 3] - w.boxes[o + 1]) / CS * s)); }
      } else x.fillRect(i * s, j * s, s, s);
    }
    x.fillStyle = 'rgba(200,190,160,0.55)';
    for (const p of w.props) if (p.L === L && p.solid) x.fillRect((p.x - p.w / 2) / CS * s, (p.z - p.d / 2) / CS * s, p.w / CS * s, p.d / CS * s);
    levels.push(c);
  }
  return { levels, s };
}
