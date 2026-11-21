'use strict';
// プレイヤー・プロフィール（所持カード・ゴールド・デッキ・設定）とショップ
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateDeck, isBasic } = require('./decks');

const PRICES = { common: 20, uncommon: 60, rare: 200, mythic: 500, basic: 0 };
const SELL_RATE = 0.4;
const PACK_PRICE = 150;
const PACK_SLOTS = { common: 5, uncommon: 2, rare: 1 };
const REWARDS = { online: { win: 100, loss: 30 }, ai: { win: 50, loss: 10 } };

class Profile {
  constructor(file, store) {
    this.file = file;
    this.store = store;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (!this.data) {
      this.data = {
        name: 'プレイヤー' + Math.floor(Math.random() * 9000 + 1000), gold: 1000, collection: {}, decks: [],
        settings: { serverUrl: 'ws://localhost:7700', stopAll: false }, stats: { wins: 0, losses: 0 }, starterGranted: [],
      };
    }
    this.grantStarters();
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** set.starter=true のセットは初回に配布し、スターターデッキを作る */
  grantStarters() {
    for (const s of this.store.sets) {
      if (!s.starter || this.data.starterGranted.includes(s.code)) continue;
      const defs = Object.values(this.store.defs).filter((d) => d.set === s.code);
      for (const d of defs) {
        const n = { common: 4, uncommon: 2, rare: 1 }[d.rarity] || 0;
        if (n) this.data.collection[d.id] = (this.data.collection[d.id] || 0) + n;
      }
      for (const colors of [['R', 'G'], ['W', 'U'], ['B', 'R']]) {
        const deck = this.buildDeck(defs, colors);
        if (deck) this.data.decks.push(deck);
      }
      this.data.starterGranted.push(s.code);
    }
  }

  buildDeck(defs, colors) {
    const cards = {};
    let n = 0;
    const pool = defs.filter((d) => !d.isLand && d.colors.length && d.colors.every((c) => colors.includes(c)) && this.data.collection[d.id]);
    pool.sort((a, b) => (b.types.includes('Creature') - a.types.includes('Creature')) || a.mv - b.mv);
    for (const d of pool) {
      if (n >= 36) break;
      const k = Math.min(this.data.collection[d.id], 4, 36 - n);
      cards[d.id] = k; n += k;
    }
    const sub = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    const lands = 60 - n;
    colors.forEach((c, i) => {
      const l = defs.find((d) => isBasic(d) && d.subtypes.includes(sub[c]));
      if (l) cards[l.id] = i === 0 ? Math.ceil(lands / 2) : Math.floor(lands / 2);
    });
    const names = { W: '白', U: '青', B: '黒', R: '赤', G: '緑' };
    return { id: crypto.randomUUID(), name: `スターター（${colors.map((c) => names[c]).join('')}）`, cards };
  }

  public() {
    return { ...this.data, decks: this.data.decks.map((d) => ({ ...d, errors: this.deckErrors(d), count: Object.values(d.cards).reduce((a, b) => a + b, 0) })) };
  }

  update({ name, settings }) {
    if (name !== undefined) this.data.name = String(name).slice(0, 24) || this.data.name;
    if (settings) this.data.settings = { ...this.data.settings, ...settings };
    this.save();
  }

  deckErrors(deck) { return validateDeck(deck, this.store.defs, this.data.collection); }

  saveDeck(deck) {
    const d = { id: deck.id || crypto.randomUUID(), name: String(deck.name || '新しいデッキ').slice(0, 40), cards: {} };
    for (const [id, n] of Object.entries(deck.cards || {})) if (n > 0 && this.store.defs[id]) d.cards[id] = Math.floor(n);
    const i = this.data.decks.findIndex((x) => x.id === d.id);
    if (i >= 0) this.data.decks[i] = d; else this.data.decks.push(d);
    this.save();
    return { ok: true, deck: d, errors: this.deckErrors(d) };
  }

  deleteDeck(id) {
    this.data.decks = this.data.decks.filter((d) => d.id !== id);
    this.save();
    return { ok: true };
  }

  getDeck(id) { return this.data.decks.find((d) => d.id === id); }

  // ---- ショップ ----
  price(def) { return def.price ?? PRICES[def.rarity] ?? 0; }
  sellPrice(def) { return Math.floor(this.price(def) * SELL_RATE); }

  buyPack(setCode) {
    const defs = Object.values(this.store.defs).filter((d) => d.set === setCode && d.rarity !== 'basic' && d.rarity !== 'token');
    if (!defs.length) return { ok: false, error: 'このセットのパックは販売されていません' };
    if (this.data.gold < PACK_PRICE) return { ok: false, error: 'ゴールドが足りません' };
    const pick = (r) => { const l = defs.filter((d) => d.rarity === r); return l.length ? l[Math.floor(Math.random() * l.length)] : null; };
    const got = [];
    for (const [r, n] of Object.entries(PACK_SLOTS)) {
      for (let i = 0; i < n; i++) {
        let rar = r;
        if (r === 'rare' && Math.random() < 1 / 8) rar = 'mythic';
        const d = pick(rar) || pick(r) || pick('common') || defs[Math.floor(Math.random() * defs.length)];
        got.push(d.id);
      }
    }
    this.data.gold -= PACK_PRICE;
    for (const id of got) this.data.collection[id] = (this.data.collection[id] || 0) + 1;
    this.save();
    return { ok: true, cards: got, gold: this.data.gold };
  }

  buy(defId, count = 1) {
    const d = this.store.defs[defId];
    if (!d || isBasic(d)) return { ok: false, error: '購入できないカードです' };
    const cost = this.price(d) * count;
    if (this.data.gold < cost) return { ok: false, error: 'ゴールドが足りません' };
    this.data.gold -= cost;
    this.data.collection[defId] = (this.data.collection[defId] || 0) + count;
    this.save();
    return { ok: true, gold: this.data.gold };
  }

  sell(defId, count = 1) {
    const d = this.store.defs[defId];
    const have = this.data.collection[defId] || 0;
    if (!d || have < count) return { ok: false, error: '所持数が足りません' };
    // デッキで使用中の枚数を下回らないか確認
    const used = Math.max(0, ...this.data.decks.map((k) => k.cards[defId] || 0));
    this.data.collection[defId] = have - count;
    this.data.gold += this.sellPrice(d) * count;
    this.save();
    return { ok: true, gold: this.data.gold, warning: have - count < used ? 'デッキで使用中のカードが所持数を下回りました' : null };
  }

  reward(kind, won) {
    const g = REWARDS[kind][won ? 'win' : 'loss'];
    this.data.gold += g;
    if (kind === 'online') this.data.stats[won ? 'wins' : 'losses']++;
    this.save();
    return g;
  }
}

module.exports = { Profile, PRICES, PACK_PRICE, PACK_SLOTS, SELL_RATE, REWARDS };
