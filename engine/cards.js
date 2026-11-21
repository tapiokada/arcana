'use strict';
// カード定義の正規化・検証（インポート仕様 docs/カードインポート仕様.md に対応）

const { parseManaCost, manaValue, costColors, parseActivationCost, COLORS } = require('./mana');

const FORMAT = 'arcana-set/1';
const CARD_TYPES = ['Land', 'Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact'];
const SUPERTYPES = ['Basic', 'Legendary'];
const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'basic', 'token'];
const KEYWORDS = [
  'flying', 'reach', 'first_strike', 'double_strike', 'trample', 'deathtouch', 'lifelink',
  'vigilance', 'haste', 'defender', 'menace', 'hexproof', 'indestructible', 'flash',
];
const KEYWORD_JA = {
  flying: '飛行', reach: '到達', first_strike: '先制攻撃', double_strike: '二段攻撃', trample: 'トランプル',
  deathtouch: '接死', lifelink: '絆魂', vigilance: '警戒', haste: '速攻', defender: '防衛', menace: '威迫',
  hexproof: '呪禁', indestructible: '破壊不能', flash: '瞬速',
};
const ACTIONS = [
  'damage', 'draw', 'gain_life', 'lose_life', 'destroy', 'exile', 'bounce', 'tap', 'untap', 'pump',
  'counters', 'token', 'counter', 'discard', 'mill', 'add_mana', 'return_from_graveyard', 'attach', 'sacrifice',
];
const TARGET_KINDS = [
  'any', 'player', 'opponent', 'creature', 'creature_you_control', 'creature_opponent_controls',
  'permanent', 'nonland_permanent', 'noncreature_permanent', 'artifact', 'enchantment', 'land',
  'artifact_or_enchantment', 'spell', 'creature_spell', 'noncreature_spell',
  'creature_card_in_your_graveyard', 'card_in_your_graveyard',
];
const SUBJECTS = [
  'you', 'self', 'each_opponent', 'each_player', 'all_creatures', 'creatures_you_control',
  'other_creatures_you_control', 'creatures_opponents_control', 'attached',
];
const TRIGGERS = [
  'etb', 'dies', 'attacks', 'upkeep', 'end_step', 'creature_etb_you_control', 'landfall',
  'cast_spell', 'deals_combat_damage_to_player',
];
const STATIC_AFFECTS = [
  'self', 'attached', 'creatures_you_control', 'other_creatures_you_control', 'creatures_opponents_control', 'all_creatures',
];
const BASIC_LAND_MANA = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const TYPE_JA = { Land: '土地', Creature: 'クリーチャー', Instant: 'インスタント', Sorcery: 'ソーサリー', Enchantment: 'エンチャント', Artifact: 'アーティファクト', Basic: '基本', Legendary: '伝説の' };

const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const normKw = (k) => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');

function normalizeAbility(ab) {
  const a = { ...ab };
  if (a.effects) a.effects = arr(a.effects).map((e) => ({ ...e }));
  if (a.type === 'activated') a.parsedCost = parseActivationCost(a.cost);
  if (a.type === 'mana') a.produce = arr(a.produce || 'C');
  if (a.type === 'static' && a.modify && a.modify.keywords) a.modify = { ...a.modify, keywords: arr(a.modify.keywords).map(normKw) };
  for (const e of a.effects || []) if (e.keywords) e.keywords = arr(e.keywords).map(normKw);
  return a;
}

/** 生のカードJSONをエンジン用に正規化する */
function normalizeDef(raw, setCode = '') {
  const d = {
    id: String(raw.id),
    set: setCode,
    name: String(raw.name || raw.id),
    cost: raw.cost || '',
    types: arr(raw.types),
    supertypes: arr(raw.supertypes),
    subtypes: arr(raw.subtypes),
    power: raw.power ?? null,
    toughness: raw.toughness ?? null,
    keywords: arr(raw.keywords).map(normKw),
    abilities: arr(raw.abilities).map(normalizeAbility),
    text: raw.text || '',
    flavor: raw.flavor || '',
    artist: raw.artist || '',
    rarity: raw.rarity || 'common',
    image: raw.image || null,
    imageType: raw.imageType || 'art',
    enchant: raw.enchant || null,
    price: raw.price ?? null,
  };
  d.manaCost = parseManaCost(d.cost);
  d.mv = manaValue(d.manaCost);
  d.colors = raw.colors ? arr(raw.colors).map((c) => String(c).toUpperCase()) : costColors(d.manaCost);
  d.isLand = d.types.includes('Land');
  d.isPermanent = !d.types.includes('Instant') && !d.types.includes('Sorcery');
  d.isAura = d.types.includes('Enchantment') && d.subtypes.includes('Aura');
  if (d.isAura && !d.enchant) d.enchant = 'creature';
  // 呪文効果（インスタント/ソーサリー）
  d.spellEffects = [];
  for (const ab of d.abilities) if (ab.type === 'spell') d.spellEffects.push(...ab.effects);
  if (raw.effects) d.spellEffects.push(...arr(raw.effects).map((e) => ({ ...e })));
  // 基本土地タイプ → マナ能力の自動付与
  if (d.isLand && !d.abilities.some((a) => a.type === 'mana')) {
    const prod = d.subtypes.filter((s) => BASIC_LAND_MANA[s]).map((s) => BASIC_LAND_MANA[s]);
    if (prod.length) d.abilities.push(normalizeAbility({ type: 'mana', produce: prod }));
  }
  if (!d.text) d.text = autoText(d);
  return d;
}

function typeLine(d) {
  const sup = d.supertypes.map((s) => TYPE_JA[s] || s).join('');
  const ty = d.types.map((t) => TYPE_JA[t] || t).join('・');
  return `${sup}${ty}${d.subtypes.length ? ' — ' + d.subtypes.join('・') : ''}`;
}

function describeTarget(t) {
  const k = typeof t === 'object' ? t.kind : t;
  const map = {
    any: 'クリーチャー1体かプレイヤー1人を対象とする', player: 'プレイヤー1人を対象とする', opponent: '対戦相手1人を対象とする',
    creature: 'クリーチャー1体を対象とする', creature_you_control: 'あなたがコントロールするクリーチャー1体を対象とする',
    creature_opponent_controls: '対戦相手がコントロールするクリーチャー1体を対象とする', permanent: 'パーマネント1つを対象とする',
    nonland_permanent: '土地でないパーマネント1つを対象とする', artifact: 'アーティファクト1つを対象とする',
    enchantment: 'エンチャント1つを対象とする', land: '土地1つを対象とする', spell: '呪文1つを対象とする',
    creature_spell: 'クリーチャー呪文1つを対象とする', noncreature_spell: 'クリーチャーでない呪文1つを対象とする',
    noncreature_permanent: 'クリーチャーでないパーマネント1つを対象とする', artifact_or_enchantment: 'アーティファクト1つかエンチャント1つを対象とする',
    card_in_your_graveyard: 'あなたの墓地のカード1枚を対象とする',
    creature_card_in_your_graveyard: 'あなたの墓地のクリーチャー・カード1枚を対象とする',
  };
  return map[k] || `${k}を対象とする`;
}

function describeEffect(e) {
  const n = e.amount ?? 1;
  const who = e.target ? '対象' : { you: 'あなた', each_opponent: '各対戦相手', each_player: '各プレイヤー', self: 'これ', all_creatures: '全てのクリーチャー', creatures_you_control: 'あなたのクリーチャー', creatures_opponents_control: '対戦相手のクリーチャー' }[e.subject] || '';
  switch (e.action) {
    case 'damage': return `${who}に${n}点のダメージを与える`;
    case 'draw': return `カードを${n}枚引く`;
    case 'gain_life': return `${who || 'あなた'}は${n}点のライフを得る`;
    case 'lose_life': return `${who}は${n}点のライフを失う`;
    case 'destroy': return `${who}を破壊する`;
    case 'exile': return `${who}を追放する`;
    case 'bounce': return `${who}をオーナーの手札に戻す`;
    case 'tap': return `${who}をタップする`;
    case 'untap': return `${who}をアンタップする`;
    case 'pump': return `ターン終了時まで${who}は+${e.power || 0}/+${e.toughness || 0}${e.keywords ? 'と' + e.keywords.map((k) => KEYWORD_JA[k] || k).join('・') : ''}を得る`.replace(/\+-/g, '-');
    case 'counters': return `${who}に+1/+1カウンターを${n}個置く`;
    case 'token': return `${e.token?.power}/${e.token?.toughness}の${e.token?.name || 'トークン'}を${n}体生成する`;
    case 'counter': return '対象の呪文を打ち消す';
    case 'discard': return `${who}はカードを${n}枚捨てる`;
    case 'mill': return `${who}はライブラリーの上から${n}枚を墓地に置く`;
    case 'add_mana': return `{${e.color || 'C'}}を加える`;
    case 'return_from_graveyard': return `対象のカードを${e.to === 'battlefield' ? '戦場' : '手札'}に戻す`;
    case 'attach': return '対象のクリーチャーにつける';
    case 'sacrifice': return 'これを生け贄に捧げる';
    default: return e.action;
  }
}

function autoText(d) {
  const lines = [];
  if (d.keywords.length) lines.push(d.keywords.map((k) => KEYWORD_JA[k] || k).join('、'));
  if (d.isAura) lines.push(`エンチャント（${d.enchant === 'creature' ? 'クリーチャー' : d.enchant}）`);
  const trig = { etb: 'これが戦場に出たとき', dies: 'これが死亡したとき', attacks: 'これが攻撃したとき', upkeep: 'あなたのアップキープの開始時', end_step: 'あなたの終了ステップの開始時', creature_etb_you_control: '他のクリーチャーがあなたのコントロール下で戦場に出るたび', landfall: '土地があなたのコントロール下で戦場に出るたび', cast_spell: 'あなたが呪文を唱えるたび', deals_combat_damage_to_player: 'これがプレイヤーに戦闘ダメージを与えるたび' };
  const eff = (es) => es.map((e) => (e.target && !String(e.target).startsWith('$') ? describeTarget(e.target) + '。' : '') + describeEffect(e)).join('。');
  if (d.spellEffects.length) lines.push(eff(d.spellEffects) + '。');
  for (const a of d.abilities) {
    if (a.type === 'triggered') lines.push(`${trig[a.trigger] || a.trigger}、${eff(a.effects || [])}。`);
    if (a.type === 'activated') lines.push(`${a.cost}：${eff(a.effects || [])}。${a.speed === 'sorcery' ? '（ソーサリー・タイミング）' : ''}`);
    if (a.type === 'static' && a.modify) {
      const af = { self: 'これ', attached: 'つけられているクリーチャー', creatures_you_control: 'あなたがコントロールするクリーチャー', other_creatures_you_control: 'あなたがコントロールする他のクリーチャー', creatures_opponents_control: '対戦相手がコントロールするクリーチャー', all_creatures: '全てのクリーチャー' }[a.affects] || a.affects;
      const m = a.modify;
      lines.push(`${af}は${m.power !== undefined || m.toughness !== undefined ? `${m.power >= 0 ? '+' : ''}${m.power || 0}/${m.toughness >= 0 ? '+' : ''}${m.toughness || 0}の修整を受ける` : ''}${m.keywords ? (m.power !== undefined ? 'とともに' : '') + m.keywords.map((k) => KEYWORD_JA[k] || k).join('・') + 'を持つ' : ''}。`);
    }
    if (a.type === 'mana' && !d.subtypes.some((s) => BASIC_LAND_MANA[s])) lines.push(`{T}：${a.produce.includes('any') ? '好きな色1色のマナ1点' : a.produce.map((c) => `{${c}}`).join('か')}を加える。`);
  }
  return lines.join('\n');
}

/** セットJSONの検証。{errors:[], warnings:[]} を返す */
function validateSet(json, fileExists = () => true) {
  const errors = [];
  const warnings = [];
  if (!json || typeof json !== 'object') return { errors: ['JSONオブジェクトではありません'], warnings };
  if (json.format !== FORMAT) errors.push(`format は "${FORMAT}" である必要があります`);
  const s = json.set || {};
  if (!s.code || !/^[A-Za-z0-9_-]{2,16}$/.test(s.code)) errors.push('set.code は英数字2〜16文字で必須です');
  if (!s.name) errors.push('set.name は必須です');
  if (!Array.isArray(json.cards) || !json.cards.length) errors.push('cards 配列が空です');
  const ids = new Set();
  (json.cards || []).forEach((c, i) => {
    const at = `cards[${i}]${c && c.id ? `(${c.id})` : ''}`;
    if (!c.id) errors.push(`${at}: id は必須です`);
    else if (ids.has(c.id)) errors.push(`${at}: id が重複しています`);
    ids.add(c.id);
    if (!c.name) errors.push(`${at}: name は必須です`);
    const types = arr(c.types);
    if (!types.length) errors.push(`${at}: types は必須です`);
    types.forEach((t) => !CARD_TYPES.includes(t) && errors.push(`${at}: 未対応のカード・タイプ "${t}"`));
    arr(c.supertypes).forEach((t) => !SUPERTYPES.includes(t) && errors.push(`${at}: 未対応の特殊タイプ "${t}"`));
    try { parseManaCost(c.cost); } catch (e) { errors.push(`${at}: ${e.message}`); }
    if (types.includes('Creature') && (typeof c.power !== 'number' || typeof c.toughness !== 'number')) errors.push(`${at}: クリーチャーには数値の power / toughness が必要です`);
    if (c.rarity && !RARITIES.includes(c.rarity)) errors.push(`${at}: rarity は ${RARITIES.join('/')} のいずれかです`);
    arr(c.keywords).forEach((k) => !KEYWORDS.includes(normKw(k)) && errors.push(`${at}: 未対応のキーワード "${k}"`));
    if (c.image && !String(c.image).startsWith('data:') && !fileExists(c.image)) errors.push(`${at}: 画像ファイルが見つかりません "${c.image}"`);
    if (!c.image) warnings.push(`${at}: image がありません（自動生成の絵柄で表示します）`);
    const checkEffects = (effs, where) => arr(effs).forEach((e, j) => {
      const w = `${at} ${where}.effects[${j}]`;
      if (!ACTIONS.includes(e.action)) errors.push(`${w}: 未対応の action "${e.action}"`);
      if (e.target !== undefined) {
        const k = typeof e.target === 'object' ? e.target.kind : e.target;
        if (!/^\$\d+$/.test(k) && !TARGET_KINDS.includes(k)) errors.push(`${w}: 未対応の target "${k}"`);
      }
      if (e.subject !== undefined && !SUBJECTS.includes(e.subject)) errors.push(`${w}: 未対応の subject "${e.subject}"`);
      if (e.action === 'token' && (!e.token || typeof e.token.power !== 'number')) errors.push(`${w}: token には token.power/toughness が必要です`);
    });
    checkEffects(c.effects, '');
    arr(c.abilities).forEach((a, j) => {
      const w = `abilities[${j}]`;
      if (!['spell', 'triggered', 'activated', 'static', 'mana'].includes(a.type)) errors.push(`${at} ${w}: 未対応の type "${a.type}"`);
      if (a.type === 'triggered' && !TRIGGERS.includes(a.trigger)) errors.push(`${at} ${w}: 未対応の trigger "${a.trigger}"`);
      if (a.type === 'activated') { try { parseActivationCost(a.cost); } catch (e) { errors.push(`${at} ${w}: ${e.message}`); } }
      if (a.type === 'static' && !STATIC_AFFECTS.includes(a.affects)) errors.push(`${at} ${w}: 未対応の affects "${a.affects}"`);
      if (a.type === 'mana') arr(a.produce || 'C').forEach((p) => p !== 'any' && ![...COLORS, 'C'].includes(String(p).toUpperCase()) && errors.push(`${at} ${w}: produce が不正 "${p}"`));
      checkEffects(a.effects, w);
    });
  });
  return { errors, warnings };
}

module.exports = {
  FORMAT, CARD_TYPES, KEYWORDS, KEYWORD_JA, ACTIONS, TARGET_KINDS, SUBJECTS, TRIGGERS, STATIC_AFFECTS, RARITIES,
  normalizeDef, validateSet, typeLine, describeTarget,
};
