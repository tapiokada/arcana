'use strict';
/* Arcana Duel クライアントUI */

const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const S = {
  screen: 'top', profile: null, rules: null, cards: [], cardMap: {}, sets: [], status: { mode: 'idle' },
  view: null, matchEnd: null, deckEdit: null, deckFilter: { colors: new Set(), type: '', q: '', owned: false },
  shopTab: 'pack', lastPack: null, ui: {},
};
const COLOR_JA = { W: '白', U: '青', B: '黒', R: '赤', G: '緑', C: '無色' };
const TYPE_JA = { Creature: 'クリーチャー', Instant: 'インスタント', Sorcery: 'ソーサリー', Enchantment: 'エンチャント', Artifact: 'アーティファクト', Land: '土地' };
const STEP_SHORT = [['upkeep', 'ｱｯﾌﾟｷｰﾌﾟ'], ['draw', 'ドロー'], ['main1', 'メイン1'], ['beginCombat', '戦闘開始'], ['declareAttackers', '攻撃'], ['declareBlockers', 'ブロック'], ['combatDamage', 'ダメージ'], ['endCombat', '戦闘終了'], ['main2', 'メイン2'], ['end', '終了']];
const SPEC_JA = {
  any: 'クリーチャーかプレイヤー', player: 'プレイヤー', opponent: '対戦相手', creature: 'クリーチャー',
  creature_you_control: 'あなたのクリーチャー', creature_opponent_controls: '相手のクリーチャー', permanent: 'パーマネント',
  nonland_permanent: '土地でないパーマネント', noncreature_permanent: 'クリーチャーでないパーマネント', artifact: 'アーティファクト', enchantment: 'エンチャント', land: '土地',
  artifact_or_enchantment: 'アーティファクトかエンチャント', spell: '呪文', creature_spell: 'クリーチャー呪文', noncreature_spell: 'クリーチャーでない呪文',
  creature_card_in_your_graveyard: 'あなたの墓地のクリーチャー・カード', card_in_your_graveyard: 'あなたの墓地のカード',
};
const specJa = (s) => SPEC_JA[typeof s === 'object' ? s.kind : s] || String(s);

// ---------- 通信 ----------
async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ui`);
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 1500);
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
function onMsg(m) {
  if (m.t === 'status') {
    const prev = S.status.mode;
    S.status = m.status;
    if (m.status.mode === 'match' && S.screen !== 'game') go('game');
    if (prev === 'match' && m.status.mode !== 'match' && S.screen === 'game' && !S.matchEnd) go('battle');
    if (S.screen === 'battle') renderBattle();
  } else if (m.t === 'view') {
    const old = S.view;
    S.view = m.view;
    if (!old || !sameDecision(old, m.view)) S.ui = {};
    else S.ui.pending = null;
    if (S.screen === 'game') renderGame();
  } else if (m.t === 'error') toast(m.msg);
  else if (m.t === 'matchEnd') {
    S.matchEnd = m;
    loadProfile().then(renderWho);
    if (S.screen === 'game') renderGame();
  }
}
function sameDecision(a, b) {
  const ka = a.decision && a.decision.kind;
  const kb = b.decision && b.decision.kind;
  return ka && ka === kb && ['attackers', 'blockers', 'bottom', 'discard', 'mulligan'].includes(ka);
}
function toast(msg, cls = '') {
  const d = h('div', { class: cls }, msg);
  $('#toast').append(d);
  setTimeout(() => d.remove(), 4000);
}

async function loadProfile() {
  const r = await api('/api/profile');
  S.profile = r.profile; S.rules = r.rules; S.prices = r.prices; S.packPrice = r.packPrice;
  return r;
}
async function loadCards() {
  const [c, s] = await Promise.all([api('/api/cards'), api('/api/sets')]);
  S.cards = c.cards; S.cardMap = Object.fromEntries(c.cards.map((x) => [x.id, x])); S.sets = s.sets; S.loadErrors = s.loadErrors;
}
function renderWho() {
  const p = S.profile;
  $('#who').innerHTML = p ? `${esc(p.name)}　<b>${p.gold.toLocaleString()} G</b>　<span class="muted">戦績 ${p.stats.wins}勝${p.stats.losses}敗</span>` : '';
}

// ---------- 画面遷移 ----------
function go(screen) {
  S.screen = screen;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === 'scr-' + screen));
  ({ top: renderTop, battle: renderBattle, deck: renderDeck, shop: renderShop, settings: renderSettings, game: renderGame })[screen]();
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g && S.status.mode !== 'match') go(g.dataset.go);
  if (!e.target.closest('#menu')) $('#menu').classList.add('hidden');
});

// ---------- カード描画 ----------
function manaHtml(cost) {
  return String(cost || '').replace(/\{([^}]+)\}/g, (_, s) => `<span class="mana ${/^\d+$/.test(s) ? 'N' : s}">${/^[WUBRG]$/.test(s) ? '' : s}</span>`);
}
function frameClass(c) {
  if ((c.types || []).includes('Land')) return 'f-L';
  const cols = c.colors || [];
  if (cols.length > 1) return 'f-M';
  return 'f-' + (cols[0] || 'C');
}
function cardEl(c, { w, small, cls = '', onclick, oncontextmenu, preview = true } = {}) {
  const pt = c.power !== undefined && c.power !== null ? `${c.power}/${c.toughness}` : null;
  let ptCls = '';
  if (pt && c.basePower !== undefined) ptCls = c.power > c.basePower || c.toughness > c.baseToughness ? 'buff' : c.power < c.basePower || c.toughness < c.baseToughness ? 'hurt' : '';
  const full = c.imageType === 'full' && c.image;
  const el = h('div', { class: `card ${frameClass(c)} ${small ? 'small' : ''} ${full ? 'full' : ''} ${cls}`, style: w ? `--w:${w}px` : null, onclick, oncontextmenu });
  const inner = h('div', { class: 'inner' });
  if (full) inner.append(h('img', { class: 'c-full', src: c.image, onerror: (e) => e.target.remove() }));
  inner.append(
    h('div', { class: 'c-head' }, h('span', { class: 'c-name' }, c.name), h('span', { html: manaHtml(c.cost) })),
    h('div', { class: 'c-art' }, c.image ? h('img', { src: c.image, loading: 'lazy', onerror: (e) => e.target.remove() }) : null),
    h('div', { class: 'c-type' }, c.typeLine || ''),
    h('div', { class: 'c-text', html: manaHtml(esc(c.text)) + (c.flavor && !small ? `<div style="font-style:italic;opacity:.7;margin-top:.3em">${esc(c.flavor)}</div>` : '') }),
  );
  el.append(inner);
  if (pt) el.append(h('div', { class: 'c-pt ' + ptCls }, pt));
  if (c.rarity) el.append(h('div', { class: 'rar ' + c.rarity }));
  if (preview) el.addEventListener('mouseenter', () => showPreview(c));
  return el;
}
function showPreview(c) {
  const p = $('.preview');
  if (!p) return;
  p.innerHTML = '';
  p.append(cardEl(c, { preview: false }));
  if (c.keywordsJa && c.keywordsJa.length) p.append();
}

// ---------- トップ画面 ----------
function renderTop() {
  const el = $('#scr-top');
  el.innerHTML = '';
  const items = [
    ['①', '対戦', '通信対戦（ランダムマッチ／ルーム）・AI対戦', 'battle'],
    ['②', 'デッキ作成', '所持カードからデッキを組む', 'deck'],
    ['③', 'カード入手・売却', 'パック購入・シングル購入・売却', 'shop'],
    ['⚙', '設定・カードインポート', 'プレイヤー名、サーバー、オリジナルカードの取り込み', 'settings'],
  ];
  el.append(
    h('div', { class: 'hero' }, h('h1', { html: 'ARCANA <span>DUEL</span>' }), h('p', {}, 'オリジナルカードで遊ぶ、MTG風トレーディングカードゲーム')),
    h('div', { class: 'menu-grid' }, items.map(([n, t, d, g]) => h('div', { class: 'menu-item', 'data-go': g }, h('div', { class: 'num' }, n), h('div', { class: 't' }, t), h('div', { class: 'd' }, d)))),
  );
}

// ---------- 対戦メニュー ----------
function deckSelect(id) {
  const sel = h('select', { id });
  for (const d of S.profile.decks) sel.append(h('option', { value: d.id }, `${d.name}（${d.count}枚）${d.errors.length ? ' ※不正' : ''}`));
  const last = localStorage.getItem('lastDeck');
  if (last && S.profile.decks.some((d) => d.id === last)) sel.value = last;
  sel.onchange = () => localStorage.setItem('lastDeck', sel.value);
  return sel;
}
function renderBattle() {
  const el = $('#scr-battle');
  el.innerHTML = '';
  const st = S.status;
  const sel = deckSelect('battle-deck');
  const deckId = () => sel.value;
  const busy = st.mode !== 'idle';
  const code = h('input', { placeholder: 'ルームコード', size: 10, style: 'text-transform:uppercase' });
  el.append(
    h('h2', {}, '① 対戦'),
    h('div', { class: 'row', style: 'margin-bottom:16px' }, '使用デッキ: ', sel, h('button', { 'data-go': 'deck' }, 'デッキ編集')),
    h('div', { class: 'battle-grid' },
      h('div', { class: 'panel' }, h('h3', {}, '通信対戦'),
        h('p', { class: 'muted' }, `サーバー: ${S.profile.settings.serverUrl}`),
        h('div', { class: 'row' }, h('button', { class: 'primary', disabled: busy, onclick: () => send({ t: 'online', mode: 'queue', deckId: deckId() }) }, 'ランダムマッチ')),
        h('h3', {}, '友人と対戦（ルーム）'),
        h('div', { class: 'row' }, h('button', { disabled: busy, onclick: () => send({ t: 'online', mode: 'create', deckId: deckId() }) }, 'ルームを作成')),
        h('div', { class: 'row', style: 'margin-top:8px' }, code, h('button', { disabled: busy, onclick: () => send({ t: 'online', mode: 'join', code: code.value.trim(), deckId: deckId() }) }, 'ルームに参加'))),
      h('div', { class: 'panel' }, h('h3', {}, 'AI対戦'),
        h('p', { class: 'muted' }, 'コンピューターと対戦します。AIは同梱・インポート済みの全カードから2色デッキを自動構築します。'),
        h('button', { class: 'primary', disabled: busy, onclick: () => send({ t: 'startAI', deckId: deckId() }) }, 'AIと対戦する'))),
  );
  if (st.mode === 'searching') {
    el.append(h('div', { class: 'status-box' }, st.code ? h('div', {}, 'ルームコード: ', h('span', { class: 'code' }, st.code)) : null,
      h('div', {}, st.text || '接続中…'), h('button', { style: 'margin-top:10px', onclick: () => send({ t: 'cancel' }) }, 'キャンセル')));
  }
}

// ---------- デッキ作成 ----------
function renderDeck() {
  const el = $('#scr-deck');
  el.innerHTML = '';
  if (!S.deckEdit) {
    const d = S.profile.decks[0];
    S.deckEdit = d ? { id: d.id, name: d.name, cards: { ...d.cards } } : { id: null, name: '新しいデッキ', cards: {} };
  }
  const de = S.deckEdit;
  const f = S.deckFilter;
  const left = h('div');
  const right = h('div', { class: 'panel' });
  el.append(h('div', { class: 'deck-layout' }, left, right));

  // フィルタ
  const q = h('input', { placeholder: 'カード名・テキスト検索', value: f.q, oninput: (e) => { f.q = e.target.value; drawGrid(); } });
  const typeSel = h('select', { onchange: (e) => { f.type = e.target.value; drawGrid(); } }, h('option', { value: '' }, '全タイプ'), Object.entries(TYPE_JA).map(([k, v]) => h('option', { value: k, selected: f.type === k }, v)));
  const colorBtns = ['W', 'U', 'B', 'R', 'G', 'C'].map((c) => h('button', { class: `cbtn mana ${c} ${f.colors.has(c) ? 'on' : ''}`, title: COLOR_JA[c], onclick: (e) => { f.colors.has(c) ? f.colors.delete(c) : f.colors.add(c); e.target.classList.toggle('on'); drawGrid(); } }, c === 'C' ? '◇' : ''));
  const owned = h('label', {}, h('input', { type: 'checkbox', checked: f.owned, onchange: (e) => { f.owned = e.target.checked; drawGrid(); } }), ' 所持カードのみ');
  const grid = h('div', { class: 'grid' });
  left.append(h('div', { class: 'filters' }, h('h2', { style: 'margin:0 10px 0 0' }, '② デッキ作成'), q, typeSel, colorBtns, owned, h('span', { class: 'muted', style: 'font-size:12px' }, 'クリック: 追加 / 右クリック: 削除')), grid);

  const inDeck = (id) => de.cards[id] || 0;
  const add = (c, n) => {
    const cur = inDeck(c.id);
    const next = cur + n;
    if (next < 0) return;
    if (n > 0 && !c.basic) {
      if (next > S.rules.maxCopies) return toast(`同名カードは${S.rules.maxCopies}枚までです`);
      if (next > c.owned) return toast(`所持数が足りません（${c.owned}枚所持）`);
    }
    if (next === 0) delete de.cards[c.id]; else de.cards[c.id] = next;
    drawGrid(); drawList();
  };

  function drawGrid() {
    grid.innerHTML = '';
    const ql = f.q.toLowerCase();
    const list = S.cards.filter((c) => {
      if (f.owned && !c.owned && !c.basic) return false;
      if (f.type && !c.types.includes(f.type)) return false;
      if (f.colors.size) {
        const cols = c.colors.length ? c.colors : ['C'];
        if (!cols.some((x) => f.colors.has(x))) return false;
      }
      if (ql && !(c.name.toLowerCase().includes(ql) || c.text.toLowerCase().includes(ql) || c.subtypes.join(' ').toLowerCase().includes(ql))) return false;
      return true;
    }).sort((a, b) => (a.basic - b.basic) || (a.colors.join('') || 'Z').localeCompare(b.colors.join('') || 'Z') || a.mv - b.mv || a.name.localeCompare(b.name));
    for (const c of list) {
      const cell = h('div', { class: `cell ${!c.owned && !c.basic ? 'unowned' : ''}` },
        cardEl(c, { w: 150, onclick: () => add(c, 1), oncontextmenu: (e) => { e.preventDefault(); add(c, -1); } }),
        inDeck(c.id) ? h('div', { class: 'count-badge' }, '×' + inDeck(c.id)) : null,
        h('div', { class: 'under' }, c.basic ? '基本土地（無制限）' : `所持 ${c.owned}`));
      grid.append(cell);
    }
    if (!list.length) grid.append(h('p', { class: 'muted' }, '該当するカードがありません'));
  }

  function drawList() {
    right.innerHTML = '';
    const sel = h('select', { onchange: (e) => {
      const d = S.profile.decks.find((x) => x.id === e.target.value);
      S.deckEdit = d ? { id: d.id, name: d.name, cards: { ...d.cards } } : { id: null, name: '新しいデッキ', cards: {} };
      renderDeck();
    } }, S.profile.decks.map((d) => h('option', { value: d.id, selected: d.id === de.id }, d.name)), h('option', { value: '', selected: !de.id }, '＋ 新しいデッキ'));
    const name = h('input', { value: de.name, style: 'width:100%', oninput: (e) => { de.name = e.target.value; } });
    const total = Object.values(de.cards).reduce((a, b) => a + b, 0);
    const entries = Object.entries(de.cards).map(([id, n]) => ({ c: S.cardMap[id], n })).filter((x) => x.c);
    const groups = {};
    for (const e of entries) {
      const t = e.c.types.includes('Creature') ? 'Creature' : e.c.types.includes('Land') ? 'Land' : 'Spell';
      (groups[t] = groups[t] || []).push(e);
    }
    const curve = new Array(8).fill(0);
    entries.forEach((e) => { if (!e.c.types.includes('Land')) curve[Math.min(7, e.c.mv)] += e.n; });
    const mx = Math.max(1, ...curve);
    const errs = [];
    if (total < S.rules.minCards) errs.push(`${S.rules.minCards}枚以上必要です（あと${S.rules.minCards - total}枚）`);
    right.append(
      h('div', { class: 'row' }, sel),
      h('div', { style: 'margin:10px 0' }, name),
      h('div', { class: 'row' }, h('b', { style: 'font-size:18px' }, `${total} 枚`), h('span', { class: 'muted' }, `（最低${S.rules.minCards}枚・同名${S.rules.maxCopies}枚まで）`)),
      h('div', { class: 'curve' }, curve.map((n, i) => h('div', { style: `height:${(n / mx) * 100}%`, title: `${n}枚` }, h('span', {}, i === 7 ? '7+' : i)))),
      h('div', { style: 'height:12px' }),
      errs.length ? h('div', { class: 'errors' }, errs.join(' / ')) : h('div', { class: 'oklabel' }, '✓ デッキ枚数OK'),
      h('div', { class: 'deck-list' }, [['Creature', 'クリーチャー'], ['Spell', '呪文'], ['Land', '土地']].map(([k, label]) => groups[k] ? [
        h('h3', {}, `${label}（${groups[k].reduce((a, b) => a + b.n, 0)}）`),
        groups[k].sort((a, b) => a.c.mv - b.c.mv).map(({ c, n }) => {
          const line = h('div', { class: 'line' }, h('b', {}, n), h('span', { class: 'nm' }, c.name), h('span', { html: manaHtml(c.cost) }),
            h('button', { onclick: () => add(c, -1) }, '−'), h('button', { onclick: () => add(c, 1) }, '+'));
          line.addEventListener('mouseenter', () => {});
          return line;
        }),
      ] : null)),
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: 'primary', onclick: saveDeck }, '保存'),
        de.id ? h('button', { class: 'danger', onclick: delDeck }, '削除') : null,
        h('button', { onclick: autoLands }, '土地を自動調整')),
    );
  }
  async function saveDeck() {
    const r = await api('/api/decks', 'POST', de);
    de.id = r.deck.id;
    await loadProfile();
    toast(r.errors.length ? '保存しました（注意: ' + r.errors.join(' / ') + '）' : '保存しました', r.errors.length ? '' : 'info');
    drawList();
  }
  async function delDeck() {
    if (!confirm(`デッキ「${de.name}」を削除しますか？`)) return;
    await api('/api/decks/' + encodeURIComponent(de.id), 'DELETE');
    await loadProfile();
    S.deckEdit = null;
    renderDeck();
  }
  function autoLands() {
    // 色の比率に応じて基本土地を配分（合計 minCards 枚になるよう）
    const basics = S.cards.filter((c) => c.basic);
    for (const b of basics) delete de.cards[b.id];
    const spells = Object.entries(de.cards).reduce((a, [, n]) => a + n, 0);
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const [id, n] of Object.entries(de.cards)) for (const m of (S.cardMap[id].cost.match(/[WUBRG]/g) || [])) pips[m] += n;
    const totalPips = Object.values(pips).reduce((a, b) => a + b, 0) || 1;
    const lands = Math.max(0, S.rules.minCards - spells);
    const sub = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    let given = 0;
    const cols = Object.keys(pips).filter((c) => pips[c] > 0).sort((a, b) => pips[b] - pips[a]);
    cols.forEach((c, i) => {
      const land = basics.find((b) => b.subtypes.includes(sub[c]));
      if (!land) return;
      const n = i === cols.length - 1 ? lands - given : Math.round((lands * pips[c]) / totalPips);
      if (n > 0) { de.cards[land.id] = n; given += n; }
    });
    drawGrid(); drawList();
  }
  drawGrid();
  drawList();
}

// ---------- ショップ ----------
function renderShop() {
  const el = $('#scr-shop');
  el.innerHTML = '';
  const tab = (k, l) => h('button', { class: S.shopTab === k ? 'on' : '', onclick: () => { S.shopTab = k; renderShop(); } }, l);
  el.append(h('h2', {}, '③ カード入手・売却'), h('div', { class: 'tabs' }, tab('pack', 'ブースターパック'), tab('buy', 'シングル購入'), tab('sell', '売却')));
  const refresh = async () => { await Promise.all([loadProfile(), loadCards()]); renderWho(); renderShop(); };
  if (S.shopTab === 'pack') {
    for (const s of S.sets) {
      el.append(h('div', { class: 'panel pack', style: 'margin-bottom:12px' },
        h('div', { class: 'pack-art' }, s.code),
        h('div', { style: 'flex:1' }, h('b', {}, s.name), h('div', { class: 'muted' }, `${s.cardCount}種類 / 1パック8枚（コモン5・アンコモン2・レア以上1）`), s.description ? h('div', { class: 'muted', style: 'font-size:12px' }, s.description) : null),
        h('button', { class: 'primary', onclick: async () => {
          const r = await api('/api/shop/pack', 'POST', { set: s.code });
          if (!r.ok) return toast(r.error);
          S.lastPack = r.cards;
          await refresh();
        } }, `購入（${S.packPrice} G）`)));
    }
    if (S.lastPack) {
      el.append(h('h3', {}, '開封結果'), h('div', { class: 'grid reveal' }, S.lastPack.map((id, i) => {
        const c = cardEl(S.cardMap[id], { w: 160 });
        c.style.animationDelay = `${i * 0.12}s`;
        return c;
      })));
    }
  } else {
    const buy = S.shopTab === 'buy';
    const list = S.cards.filter((c) => !c.basic && (buy || c.owned > 0)).sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
    if (!list.length) el.append(h('p', { class: 'muted' }, '売却できるカードがありません'));
    el.append(h('div', { class: 'grid' }, list.map((c) => h('div', { class: 'cell' }, cardEl(c, { w: 150 }),
      h('div', { class: 'under' }, `所持 ${c.owned}`),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:4px' },
        h('button', { onclick: async () => {
          const r = await api(buy ? '/api/shop/buy' : '/api/shop/sell', 'POST', { id: c.id });
          if (!r.ok) return toast(r.error);
          if (r.warning) toast(r.warning);
          await refresh();
        } }, buy ? `購入 ${c.price} G` : `売却 +${c.sellPrice} G`))))));
  }
}

// ---------- 設定・インポート ----------
function renderSettings() {
  const el = $('#scr-settings');
  el.innerHTML = '';
  const p = S.profile;
  const name = h('input', { value: p.name });
  const url = h('input', { value: p.settings.serverUrl, size: 36 });
  const stopAll = h('input', { type: 'checkbox', checked: !!p.settings.stopAll });
  const result = h('div');
  const folder = h('input', { type: 'file', webkitdirectory: true, multiple: true });
  const files = h('input', { type: 'file', multiple: true, accept: '.json,image/*' });
  const doImport = async (fileList) => {
    result.innerHTML = '';
    const arr = [...fileList];
    const setFile = arr.find((f) => f.name === 'set.json') || arr.find((f) => f.name.endsWith('.json'));
    if (!setFile) return result.append(h('div', { class: 'errors' }, 'set.json が見つかりません'));
    const base = (setFile.webkitRelativePath || setFile.name).split('/').slice(0, -1).join('/');
    const readText = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); });
    const readUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const fileMap = {};
    for (const f of arr) {
      if (f === setFile || !/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)) continue;
      let rel = f.webkitRelativePath || f.name;
      if (base && rel.startsWith(base + '/')) rel = rel.slice(base.length + 1);
      fileMap[rel] = await readUrl(f);
      if (!f.webkitRelativePath) fileMap['images/' + f.name] = fileMap[rel];
    }
    let setJson;
    try { setJson = JSON.parse(await readText(setFile)); } catch (e) { return result.append(h('div', { class: 'errors' }, 'JSONの構文エラー: ' + e.message)); }
    const r = await api('/api/import', 'POST', { setJson, files: fileMap });
    if (r.ok) {
      result.append(h('div', { class: 'oklabel' }, `✓ 「${r.set.name}」(${r.set.code}) を ${r.cardCount}枚 インポートしました`));
      await Promise.all([loadCards(), loadProfile()]);
      renderWho();
      setTimeout(renderSettings, 1500);
    } else result.append(h('div', { class: 'errors' }, h('b', {}, 'インポートに失敗しました'), h('ul', {}, (r.errors || []).slice(0, 30).map((e) => h('li', {}, e)))));
    if (r.warnings && r.warnings.length) result.append(h('details', {}, h('summary', { class: 'muted' }, `警告 ${r.warnings.length}件`), h('ul', { class: 'muted' }, r.warnings.map((w) => h('li', {}, w)))));
  };
  folder.onchange = () => doImport(folder.files);
  files.onchange = () => doImport(files.files);
  el.append(
    h('h2', {}, '設定・カードインポート'),
    h('div', { class: 'battle-grid' },
      h('div', { class: 'panel' }, h('h3', {}, 'プレイヤー設定'),
        h('div', { class: 'row' }, 'プレイヤー名 ', name),
        h('div', { class: 'row', style: 'margin-top:8px' }, '中継サーバーURL ', url),
        h('div', { class: 'muted', style: 'font-size:12px;margin:4px 0' }, '例: ws://192.168.1.10:7700 / wss://relay.example.com'),
        h('label', { class: 'row', style: 'margin-top:8px' }, stopAll, '全てのステップで優先権を止める（上級者向け）'),
        h('button', { class: 'primary', style: 'margin-top:12px', onclick: async () => {
          await api('/api/profile', 'POST', { name: name.value, settings: { serverUrl: url.value.trim(), stopAll: stopAll.checked } });
          await loadProfile(); renderWho(); toast('保存しました', 'info');
        } }, '保存')),
      h('div', { class: 'panel' }, h('h3', {}, 'オリジナルカードのインポート'),
        h('p', { class: 'muted', style: 'font-size:13px' }, 'set.json と画像を含むフォルダを選択してください。形式は ', h('a', { href: '/docs/カードインポート仕様.md', target: '_blank', style: 'color:var(--accent)' }, 'カードインポート仕様'), ' を参照。'),
        h('div', { class: 'row' }, 'フォルダ選択: ', folder),
        h('div', { class: 'row', style: 'margin-top:6px' }, 'ファイル選択: ', files),
        result)),
    h('h3', {}, '読み込み済みセット'),
    h('div', { class: 'panel' }, S.sets.map((s) => h('div', { class: 'row', style: 'padding:6px 0;border-bottom:1px solid var(--line)' },
      h('b', { style: 'min-width:60px' }, s.code), h('span', { style: 'flex:1' }, `${s.name}  v${s.version || '-'}  ${s.author ? '/ ' + s.author : ''}  （${s.cardCount}枚）`),
      s.builtin ? h('span', { class: 'muted' }, '同梱') : h('button', { class: 'danger', onclick: async () => {
        if (!confirm(`セット ${s.code} を削除しますか？（所持数データは残ります）`)) return;
        await api('/api/sets/' + encodeURIComponent(s.code), 'DELETE');
        await loadCards(); renderSettings();
      } }, '削除'))),
    (S.loadErrors || []).length ? h('div', { class: 'errors' }, '読み込みエラー: ', S.loadErrors.map((e) => h('div', {}, `${e.dir}: ${e.errors.join(' / ')}`))) : null),
  );
}

// ---------- ゲーム画面 ----------
const act = (action) => send({ t: 'action', action });

function renderGame() {
  const el = $('#scr-game');
  const v = S.view;
  el.innerHTML = '';
  if (!v) { el.append(h('div', { style: 'padding:40px' }, '対戦準備中…')); return; }
  const me = v.you;
  const op = 1 - me;
  const ui = S.ui;
  const dec = v.decision && v.decision.kind !== 'waiting' ? v.decision : null;

  // 現在の「対象選択」状態
  const targeting = ui.pending ? ui.pending : dec && dec.kind === 'targets' ? { kind: 'trigger', slots: dec.slots, chosen: ui.chosen || [] } : null;
  const curSlot = targeting ? targeting.slots[targeting.chosen.length] : null;
  const isTarget = (id) => curSlot && curSlot.options.includes(id);
  const pickTarget = (id) => {
    targeting.chosen.push(id);
    if (targeting.chosen.length >= targeting.slots.length) {
      if (targeting.kind === 'trigger') act({ type: 'chooseTargets', targets: targeting.chosen });
      else act({ ...targeting.action, targets: targeting.chosen });
      S.ui = {};
    } else if (targeting.kind === 'trigger') ui.chosen = targeting.chosen;
    renderGame();
  };

  const actionsFor = (id) => v.actions.filter((a) => a.cardId === id || a.permId === id);
  const startAction = (a) => {
    $('#menu').classList.add('hidden');
    const base = a.type === 'cast' ? { type: 'cast', cardId: a.cardId } : a.type === 'activate' ? { type: 'activate', permId: a.permId, index: a.index } : a;
    if (a.slots && a.slots.length) { S.ui = { pending: { kind: 'action', action: base, slots: a.slots, chosen: [] } }; renderGame(); } else act(base);
  };
  const showMenu = (ev, items) => {
    const m = $('#menu');
    m.innerHTML = '';
    for (const [label, fn] of items) m.append(h('button', { onclick: (e) => { e.stopPropagation(); m.classList.add('hidden'); fn(); } }, label));
    m.style.left = Math.min(ev.clientX, innerWidth - 200) + 'px';
    m.style.top = Math.min(ev.clientY, innerHeight - 40 * items.length - 10) + 'px';
    m.classList.remove('hidden');
    ev.stopPropagation();
  };

  const attackers = v.combat ? v.combat.attackers : [];
  const attackerIds = new Set(attackers.map((a) => a.id));
  const blockMap = {};
  attackers.forEach((a) => a.blockers.forEach((b) => { blockMap[b] = a.id; }));
  const nameOf = (id) => (v.battlefield.find((c) => c.id === id) || {}).name || '';

  // パーマネント描画
  const permEl = (c) => {
    const mine = c.controller === me;
    const acts = mine ? actionsFor(c.id) : [];
    const canMana = mine && c.manaColors && !c.tapped && v.priority === me && !dec;
    let cls = 'slot';
    if (c.tapped) cls += ' tapped';
    if (attackerIds.has(c.id)) cls += ' attacking';
    if (blockMap[c.id]) cls += ' blocking';
    let label = null;
    let onclick = null;
    if (targeting) {
      if (isTarget(c.id)) { cls += ' targetable'; onclick = () => pickTarget(c.id); }
    } else if (dec && dec.kind === 'attackers') {
      if (dec.options.includes(c.id)) {
        ui.attackers = ui.attackers || new Set();
        if (ui.attackers.has(c.id)) cls += ' selected'; else cls += ' can-act';
        onclick = () => { ui.attackers.has(c.id) ? ui.attackers.delete(c.id) : ui.attackers.add(c.id); renderGame(); };
      }
    } else if (dec && dec.kind === 'blockers') {
      ui.blocks = ui.blocks || [];
      const myBlock = ui.blocks.find((b) => b.blocker === c.id);
      if (dec.blockers.includes(c.id)) {
        if (ui.selBlocker === c.id) cls += ' selected'; else if (!myBlock) cls += ' can-act';
        if (myBlock) { cls += ' blocking'; label = '→ ' + nameOf(myBlock.attacker); }
        onclick = () => {
          if (myBlock) ui.blocks = ui.blocks.filter((b) => b !== myBlock);
          else ui.selBlocker = ui.selBlocker === c.id ? null : c.id;
          renderGame();
        };
      } else if (dec.attackers.includes(c.id) && ui.selBlocker) {
        cls += ' targetable';
        onclick = () => { ui.blocks.push({ blocker: ui.selBlocker, attacker: c.id }); ui.selBlocker = null; renderGame(); };
      }
    } else if (acts.length || canMana) {
      cls += ' can-act';
      onclick = (ev) => {
        const items = [];
        if (canMana) for (const col of c.manaColors) items.push([`マナを出す {${col}}`, () => act({ type: 'tapMana', permId: c.id, color: col })]);
        for (const a of acts) items.push([`能力を起動: ${a.cost}`, () => startAction(a)]);
        if (items.length === 1) items[0][1](); else showMenu(ev, items);
      };
    }
    if (!label && blockMap[c.id]) label = '→ ' + nameOf(blockMap[c.id]);
    if (!label && c.attachedTo) label = '⇢ ' + nameOf(c.attachedTo);
    return h('div', { class: cls, onclick },
      cardEl(c, { small: true, cls: onclick ? 'clickable' : '' }),
      c.damage ? h('div', { class: 'dmg' }, `-${c.damage}`) : null,
      c.counters ? h('div', { class: 'ctr' }, `${c.counters > 0 ? '+' : ''}${c.counters}/${c.counters > 0 ? '+' : ''}${c.counters}`) : null,
      c.sick ? h('div', { class: 'sick', title: '召喚酔い' }, '💤') : null,
      label ? h('div', { class: 'att' }, label) : null);
  };
  const bfHalf = (p) => {
    const mine = v.battlefield.filter((c) => c.controller === p);
    const lands = mine.filter((c) => c.types.includes('Land'));
    const perms = mine.filter((c) => !c.types.includes('Land'));
    return h('div', { class: `bf-half ${p === op ? 'opp' : 'me'}` },
      h('div', { class: 'zone perms' }, perms.map(permEl)),
      h('div', { class: 'zone lands' }, lands.map(permEl)));
  };
  const zoneModal = (title, cards) => {
    const m = $('#modal');
    m.innerHTML = '';
    m.append(h('div', { class: 'box' }, h('h2', {}, title), h('div', { class: 'grid' }, cards.length ? cards.map((c) => {
      const opt = isTarget(c.id);
      return cardEl(c, { w: 140, cls: opt ? 'targetable' : '', onclick: opt ? () => { m.classList.add('hidden'); pickTarget(c.id); } : null });
    }) : h('p', { class: 'muted' }, 'カードがありません')), h('button', { onclick: () => m.classList.add('hidden') }, '閉じる')));
    m.classList.remove('hidden');
    m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
  };
  const pbar = (p) => {
    const pl = v.players[p];
    const pid = 'p' + p;
    const t = isTarget(pid);
    const pool = Object.entries(pl.pool).filter(([, n]) => n > 0).map(([c, n]) => `<span class="mana ${c}">${n}</span>`).join('');
    return h('div', { class: `pbar ${v.active === p ? 'active-turn' : ''} ${v.priority === p ? 'has-prio' : ''} ${t ? 'targetable' : ''}`, onclick: t ? () => pickTarget(pid) : null },
      h('span', { class: 'life' }, '♥ ' + pl.life),
      h('span', { class: 'nm' }, pl.name + (p === me ? '（あなた）' : '')),
      h('span', { class: 'muted' }, `手札 ${pl.handCount}`),
      h('span', { class: 'muted' }, `ライブラリー ${pl.libraryCount}`),
      h('span', { class: 'z', onclick: (e) => { e.stopPropagation(); zoneModal(`${pl.name} の墓地`, pl.graveyard); } }, `墓地 ${pl.graveyard.length}`),
      pl.exile.length ? h('span', { class: 'z', onclick: (e) => { e.stopPropagation(); zoneModal(`${pl.name} の追放領域`, pl.exile); } }, `追放 ${pl.exile.length}`) : null,
      pool ? h('span', { class: 'pool', html: 'マナ: ' + pool }) : null,
      p === op ? h('div', { class: 'opp-hand' }, Array.from({ length: Math.min(pl.handCount, 12) }, () => h('div', { class: 'card-back' }))) : null);
  };

  // プロンプト & ボタン
  const prompt = h('div', { class: 'prompt' });
  const buttons = h('div', { class: 'row' });
  const myTurn = v.active === me;
  if (v.winner !== null) {
    prompt.append(v.winner === 'draw' ? '引き分け' : v.winner === me ? '勝利しました！' : '敗北しました');
  } else if (targeting) {
    const i = targeting.chosen.length;
    prompt.append(h('div', {}, `🎯 対象を選んでください（${i + 1}/${targeting.slots.length}）: `, h('b', {}, specJa(curSlot.spec))));
    const names = (id) => (id[0] === 'p' ? v.players[+id.slice(1)].name : (v.battlefield.find((c) => c.id === id) || v.stack.map((s) => s.card).find((c) => c && c.id === id) || v.players.flatMap((p) => p.graveyard).find((c) => c.id === id) || { name: id }).name);
    prompt.append(h('div', { class: 'chips' }, curSlot.options.map((id) => h('button', { onclick: () => pickTarget(id) }, names(id)))));
    if (targeting.kind === 'action') buttons.append(h('button', { onclick: () => { S.ui = {}; renderGame(); } }, 'キャンセル'));
  } else if (dec) {
    switch (dec.kind) {
      case 'mulligan': prompt.append('手札をキープしますか？'); break;
      case 'bottom': case 'discard': {
        ui.sel = ui.sel || new Set();
        prompt.append(dec.kind === 'bottom' ? `ライブラリーの一番下に置くカードを ${dec.n} 枚選んでください` : `捨てるカードを ${dec.n} 枚選んでください`, ` （${ui.sel.size}/${dec.n}）`);
        buttons.append(h('button', { class: 'primary', disabled: ui.sel.size !== dec.n, onclick: () => act({ type: dec.kind, cardIds: [...ui.sel] }) }, '決定'));
        break;
      }
      case 'attackers': {
        ui.attackers = ui.attackers || new Set();
        prompt.append('⚔ 攻撃するクリーチャーを選んでください');
        buttons.append(
          h('button', { onclick: () => { ui.attackers = new Set(dec.options); renderGame(); } }, '全員'),
          h('button', { class: 'primary', onclick: () => act({ type: 'declareAttackers', attackers: [...ui.attackers] }) }, ui.attackers.size ? `攻撃する（${ui.attackers.size}体）` : '攻撃しない'));
        break;
      }
      case 'blockers': {
        ui.blocks = ui.blocks || [];
        prompt.append(ui.selBlocker ? '🛡 ブロックする攻撃クリーチャーを選んでください' : '🛡 ブロックに使うクリーチャーを選んでください（もう一度クリックで解除）');
        buttons.append(h('button', { class: 'primary', onclick: () => act({ type: 'declareBlockers', blocks: ui.blocks }) }, ui.blocks.length ? `ブロック決定（${ui.blocks.length}）` : 'ブロックしない'));
        break;
      }
      default: break;
    }
  } else if (v.decision && v.decision.kind === 'waiting') {
    prompt.append(h('span', { class: 'muted' }, { mulligan: '相手がマリガンを検討中…', attackers: '相手が攻撃を選んでいます…', blockers: '相手がブロックを選んでいます…', targets: '相手が対象を選んでいます…', discard: '相手がカードを捨てています…', bottom: '相手がカードを選んでいます…' }[v.decision.for] || '相手の選択を待っています…'));
  } else if (v.priority === me) {
    if (v.stack.length) {
      const top = v.stack[v.stack.length - 1];
      prompt.append(`スタックの一番上: `, h('b', {}, top.name), top.controller === me ? '' : '（相手）', ' — 対応しますか？');
      buttons.append(h('button', { class: 'primary', onclick: () => act({ type: 'pass' }) }, 'パス（解決させる）'));
    } else {
      prompt.append(myTurn ? `あなたの${v.stepJa}ステップ` : `相手の${v.stepJa}ステップ — 対応できます`);
      if (v.actions.length) prompt.append(h('span', { class: 'muted' }, '　（緑に光るカードを使えます）'));
      const nextLabel = myTurn ? (v.step === 'main1' ? '戦闘へ' : v.step === 'main2' ? 'ターン終了' : '次へ') : '次へ';
      buttons.append(h('button', { class: 'primary', onclick: () => act({ type: 'pass' }) }, nextLabel));
    }
  } else {
    prompt.append(h('span', { class: 'muted' }, '相手の行動を待っています…'));
  }

  // 手札
  const hand = h('div', { class: 'handzone' }, (v.players[me].hand || []).map((c) => {
    let cls = '';
    let onclick = null;
    if (dec && (dec.kind === 'bottom' || dec.kind === 'discard')) {
      const sel = ui.sel || (ui.sel = new Set());
      cls = sel.has(c.id) ? 'selected' : 'can-act';
      onclick = () => { sel.has(c.id) ? sel.delete(c.id) : sel.size < dec.n && sel.add(c.id); renderGame(); };
    } else if (!targeting && !dec) {
      const acts = actionsFor(c.id);
      if (acts.length) { cls = 'can-act'; onclick = () => startAction(acts[0]); }
    }
    return cardEl(c, { cls, onclick });
  }));

  // スタック
  const stack = h('div', { class: 'stack' }, v.stack.map((s) => {
    const t = s.card && isTarget(s.card.id);
    return h('div', { class: 'item', title: s.targets.length ? '対象: ' + s.targets.map((x) => x.name).join('、') : '' },
      s.card ? cardEl(s.card, { small: true, cls: t ? 'targetable' : '', onclick: t ? () => pickTarget(s.card.id) : null })
        : h('div', { class: 'ab' }, h('b', {}, s.name), ' の能力', s.targets.length ? h('div', {}, '→ ' + s.targets.map((x) => x.name).join('、')) : null));
  }));

  const phases = h('div', { class: 'phases' }, h('span', { class: 'muted', style: 'background:none' }, `T${v.turn} ${myTurn ? 'あなた' : '相手'}`),
    STEP_SHORT.map(([k, l]) => h('span', { class: v.step === k || (k === 'combatDamage' && v.step === 'firstStrikeDamage') ? 'on' : '' }, l)));

  const field = h('div', { class: 'field' },
    pbar(op), bfHalf(op),
    h('div', { class: 'center' }, h('div', {}, phases, h('div', { style: 'height:4px' }), stack), prompt, buttons),
    bfHalf(me), pbar(me), hand);

  const log = h('div', { class: 'log' }, v.log.slice().reverse().map((l) => h('div', {}, l)));
  const stopAll = h('label', {}, h('input', { type: 'checkbox', checked: v.stops.length > 10, onchange: (e) => {
    const all = []; for (const [k] of STEP_SHORT) all.push('my_' + k, 'opp_' + k);
    act({ type: 'setStops', stops: e.target.checked ? all : ['my_main1', 'my_main2', 'my_declareBlockers', 'opp_declareAttackers', 'opp_declareBlockers', 'opp_end'] });
  } }), ' 全ステップで停止');
  const side = h('div', { class: 'side' }, h('div', { class: 'preview' }, h('div', { class: 'muted', style: 'align-self:center' }, 'カードにマウスを乗せると拡大表示'))
    , log, h('div', { class: 'tools' }, stopAll,
      v.winner === null ? h('button', { class: 'danger', onclick: () => confirm('投了しますか？') && act({ type: 'concede' }) }, '投了')
        : h('button', { class: 'primary', onclick: () => { $('#modal').classList.add('hidden'); S.matchEnd = null; S.view = null; send({ t: 'leaveMatch' }); go('top'); } }, 'トップへ戻る')));
  el.append(h('div', { class: 'board' }, field, side));

  // マリガンのモーダル / 結果
  const modal = $('#modal');
  if (dec && dec.kind === 'mulligan') {
    modal.innerHTML = '';
    const mul = v.players[me].mulligans;
    modal.append(h('div', { class: 'box', style: 'text-align:center' }, h('h2', {}, mul ? `マリガン ${mul}回目（キープ後 ${mul}枚をライブラリーの下へ）` : '初期手札'),
      h('div', { class: 'grid', style: 'justify-content:center' }, v.players[me].hand.map((c) => cardEl(c, { w: 130 }))),
      h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'primary', onclick: () => { modal.classList.add('hidden'); act({ type: 'mulligan', keep: true }); } }, 'キープ'),
        h('button', { onclick: () => { modal.classList.add('hidden'); act({ type: 'mulligan', keep: false }); } }, 'マリガン'))));
    modal.classList.remove('hidden');
    modal.onclick = null;
  } else if (S.matchEnd) {
    const m = S.matchEnd;
    modal.innerHTML = '';
    modal.append(h('div', { class: 'box', style: 'text-align:center;min-width:360px' },
      h('div', { class: `result ${m.won ? 'win' : 'lose'}` }, m.draw ? 'DRAW' : m.won ? 'VICTORY' : 'DEFEAT'),
      m.reason ? h('p', { class: 'muted' }, m.reason) : null,
      h('p', {}, `報酬: +${m.reward} G（所持 ${m.gold} G）`),
      h('button', { class: 'primary', onclick: () => { modal.classList.add('hidden'); S.matchEnd = null; S.view = null; send({ t: 'leaveMatch' }); go('top'); } }, 'トップへ戻る'),
      h('button', { style: 'margin-left:8px', onclick: () => modal.classList.add('hidden') }, '盤面を見る')));
    modal.classList.remove('hidden');
    modal.onclick = null;
  } else if (!modal.classList.contains('hidden') && !modal.querySelector('.grid .targetable') && modal.dataset.keep !== '1') {
    // 墓地表示などはそのまま、マリガン後は閉じる
    if (modal.querySelector('.result') || modal.textContent.includes('初期手札') || modal.textContent.includes('マリガン')) modal.classList.add('hidden');
  }
}

// ---------- 起動 ----------
(async function init() {
  await Promise.all([loadProfile(), loadCards()]);
  renderWho();
  connect();
  go(S.status.mode === 'match' ? 'game' : 'top');
})();
