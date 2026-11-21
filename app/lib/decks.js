'use strict';
// デッキ構築ルールとAI用デッキの自動生成
const DECK_RULES = { minCards: 60, maxCopies: 4, startingLife: 20 };

function isBasic(def) { return def.supertypes.includes('Basic') && def.isLand; }

/** デッキ(cards: {defId:count}) を検証。collection が渡されれば所持数もチェック */
function validateDeck(deck, defs, collection, rules = DECK_RULES) {
  const errors = [];
  let total = 0;
  for (const [id, n] of Object.entries(deck.cards || {})) {
    const d = defs[id];
    if (!d) { errors.push(`未知のカード: ${id}`); continue; }
    total += n;
    if (!isBasic(d) && n > rules.maxCopies) errors.push(`${d.name} は${rules.maxCopies}枚までです`);
    if (collection && !isBasic(d) && (collection[id] || 0) < n) errors.push(`${d.name} の所持数が足りません（${collection[id] || 0}/${n}）`);
  }
  if (total < rules.minCards) errors.push(`デッキは${rules.minCards}枚以上必要です（現在${total}枚）`);
  return errors;
}

function expandDeck(deck) {
  const out = [];
  for (const [id, n] of Object.entries(deck.cards)) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

/** AI用: 2色を選んで60枚デッキを組む */
function buildAIDeck(defList, seed = Date.now()) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const colors = ['W', 'U', 'B', 'R', 'G'];
  const c1 = colors[Math.floor(rnd() * 5)];
  let c2 = colors[Math.floor(rnd() * 5)];
  if (c2 === c1) c2 = colors[(colors.indexOf(c1) + 1) % 5];
  const pool = defList.filter((d) => !d.isLand && d.rarity !== 'token' && d.colors.every((c) => c === c1 || c === c2));
  pool.sort((a, b) => (b.types.includes('Creature') - a.types.includes('Creature')) || rnd() - 0.5);
  const cards = {};
  let n = 0;
  for (const d of pool) {
    if (n >= 36) break;
    const k = Math.min(4, 36 - n);
    cards[d.id] = k;
    n += k;
  }
  const basics = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const landFor = (c) => defList.find((d) => d.isLand && d.supertypes.includes('Basic') && d.subtypes.includes(basics[c]));
  const lands = 60 - n;
  const l1 = landFor(c1), l2 = landFor(c2);
  if (l1) cards[l1.id] = Math.ceil(lands / 2);
  if (l2) cards[l2.id] = (cards[l2.id] || 0) + Math.floor(lands / 2);
  return expandDeck({ cards });
}

module.exports = { DECK_RULES, validateDeck, expandDeck, buildAIDeck, isBasic };
