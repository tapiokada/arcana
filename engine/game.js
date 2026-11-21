'use strict';
// ルールエンジン（ホスト権威型）。MTG総合ルールの主要部分を実装。

const { emptyPool, expandColors, planPayment, MANA_TYPES } = require('./mana');
const { normalizeDef, typeLine, KEYWORD_JA } = require('./cards');

const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers',
  'firstStrikeDamage', 'combatDamage', 'endCombat', 'main2', 'end', 'cleanup'];
const STEP_JA = {
  untap: 'アンタップ', upkeep: 'アップキープ', draw: 'ドロー', main1: '第1メイン', beginCombat: '戦闘開始',
  declareAttackers: '攻撃クリーチャー指定', declareBlockers: 'ブロック・クリーチャー指定',
  firstStrikeDamage: '先制攻撃ダメージ', combatDamage: '戦闘ダメージ', endCombat: '戦闘終了', main2: '第2メイン',
  end: '終了', cleanup: 'クリンナップ',
};
const DEFAULT_STOPS = ['my_main1', 'my_main2', 'my_declareBlockers', 'opp_declareAttackers', 'opp_declareBlockers', 'opp_end'];
const HAND_SIZE = 7;
const START_LIFE = 20;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Game {
  /**
   * @param {object} opts { defs: {id: normalizedDef}, players: [{name, deck:[defId]}], seed }
   */
  constructor(opts) {
    this.defs = opts.defs;
    this.rand = mulberry32(opts.seed ?? Date.now());
    this.nextId = 1;
    this.cards = {};
    this.players = opts.players.map((p, i) => ({
      index: i, name: p.name, life: START_LIFE, library: [], hand: [], graveyard: [], exile: [],
      pool: emptyPool(), landsPlayed: 0, mulligans: 0, drewFromEmpty: false, lost: false,
      stops: new Set(p.stops || DEFAULT_STOPS),
    }));
    this.battlefield = [];
    this.stack = [];
    this.log = [];
    this.turn = 0;
    this.step = null;
    this.priority = null;
    this.passes = 0;
    this.decision = null;
    this.pendingDiscards = [];
    this.triggerQueue = [];
    this.events = [];
    this.combat = null;
    this.winner = null;
    this.version = 0;
    opts.players.forEach((p, i) => {
      for (const defId of p.deck) {
        if (!this.defs[defId]) throw new Error(`未知のカードID: ${defId}`);
        this.players[i].library.push(this.newCard({ defId, owner: i, zone: 'library' }).id);
      }
      this.shuffle(i);
    });
    this.startPlayer = Math.floor(this.rand() * 2);
    this.active = this.startPlayer;
    this.addLog(`${this.players[this.startPlayer].name} が先攻です`);
    for (const p of this.players) this.draw(p.index, 7);
    this.mulliganQueue = [this.startPlayer, 1 - this.startPlayer];
    this.decision = { kind: 'mulligan', player: this.mulliganQueue[0] };
  }

  // ---------- 基本ユーティリティ ----------
  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }
  shuffle(p) {
    const a = this.players[p].library;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  newCard(props) {
    const c = {
      id: 'c' + this.nextId++, defId: null, tokenDef: null, owner: 0, controller: props.owner, zone: 'library',
      tapped: false, sick: true, damage: 0, dt: false, counters: 0, temp: [], attachedTo: null, isToken: false,
      ...props,
    };
    this.cards[c.id] = c;
    return c;
  }
  def(c) { return c.tokenDef || this.defs[c.defId]; }
  name(id) {
    if (typeof id === 'string' && id[0] === 'p') return this.players[+id.slice(1)].name;
    const c = this.cards[id];
    return c ? this.def(c).name : '(不明)';
  }
  hasType(c, t) { return this.def(c).types.includes(t); }
  isCreature(c) { return this.hasType(c, 'Creature'); }
  opp(p) { return 1 - p; }

  /** 継続的効果を適用した特性値 */
  chars(c) {
    const d = this.def(c);
    let power = d.power ?? 0;
    let toughness = d.toughness ?? 0;
    const kw = new Set(d.keywords);
    power += c.counters;
    toughness += c.counters;
    for (const t of c.temp) {
      power += t.power || 0;
      toughness += t.toughness || 0;
      (t.keywords || []).forEach((k) => kw.add(k));
    }
    if (c.zone === 'battlefield') {
      for (const sid of this.battlefield) {
        const s = this.cards[sid];
        for (const ab of this.def(s).abilities) {
          if (ab.type !== 'static' || !ab.modify || !this.staticAffects(s, ab.affects, c)) continue;
          power += ab.modify.power || 0;
          toughness += ab.modify.toughness || 0;
          (ab.modify.keywords || []).forEach((k) => kw.add(k));
        }
      }
    }
    return { power, toughness, keywords: kw };
  }
  staticAffects(src, affects, c) {
    const cr = this.isCreature(c);
    switch (affects) {
      case 'self': return src === c;
      case 'attached': return src.attachedTo === c.id;
      case 'creatures_you_control': return cr && c.controller === src.controller;
      case 'other_creatures_you_control': return cr && c !== src && c.controller === src.controller;
      case 'creatures_opponents_control': return cr && c.controller !== src.controller;
      case 'all_creatures': return cr;
      default: return false;
    }
  }
  kw(c, k) { return this.chars(c).keywords.has(k); }

  // ---------- 領域移動 ----------
  zoneList(c) {
    if (c.zone === 'battlefield') return this.battlefield;
    if (c.zone === 'stack') return null;
    return this.players[c.owner][c.zone];
  }
  moveCard(id, zone, opts = {}) {
    const c = this.cards[id];
    if (!c) return null;
    const from = c.zone;
    const list = this.zoneList(c);
    if (list) {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    }
    delete this.cards[id];
    if (from === 'battlefield' && zone === 'graveyard' && this.isCreature(c)) {
      this.events.push({ type: 'dies', snapshot: { defId: c.defId, tokenDef: c.tokenDef, controller: c.controller, name: this.def(c).name } });
    }
    if (c.isToken && zone !== 'battlefield') return null; // トークンは消滅
    const n = this.newCard({
      defId: c.defId, tokenDef: c.tokenDef, owner: c.owner, isToken: c.isToken, zone,
      controller: zone === 'battlefield' ? (opts.controller ?? c.controller) : c.owner,
    });
    if (zone === 'battlefield') {
      this.battlefield.push(n.id);
      this.events.push({ type: 'etb', id: n.id });
    } else if (zone !== 'stack') {
      const l = this.players[n.owner][zone];
      if (opts.bottom) l.unshift(n.id); else l.push(n.id);
    }
    return n.id;
  }
  draw(p, n = 1) {
    const pl = this.players[p];
    for (let i = 0; i < n; i++) {
      if (!pl.library.length) { pl.drewFromEmpty = true; return; }
      const id = pl.library[pl.library.length - 1];
      this.moveCard(id, 'hand');
    }
  }
  createToken(spec, controller) {
    const def = normalizeDef({
      id: 'token', rarity: 'token', types: ['Creature'], ...spec,
      name: spec.name || 'トークン',
    });
    const c = this.newCard({ tokenDef: def, owner: controller, controller, zone: 'battlefield', isToken: true });
    this.battlefield.push(c.id);
    this.events.push({ type: 'etb', id: c.id });
    return c.id;
  }

  // ---------- マナ ----------
  manaSources(p, excludeId) {
    const out = [];
    for (const id of this.battlefield) {
      const c = this.cards[id];
      if (c.controller !== p || c.tapped || id === excludeId) continue;
      if (this.isCreature(c) && c.sick && !this.kw(c, 'haste')) continue;
      for (const ab of this.def(c).abilities) {
        if (ab.type === 'mana') { out.push({ id, colors: expandColors(ab.produce) }); break; }
      }
    }
    return out;
  }
  planCost(p, cost, excludeId) {
    return planPayment(cost, this.players[p].pool, this.manaSources(p, excludeId));
  }
  payPlan(p, plan) {
    const pool = this.players[p].pool;
    for (const c of MANA_TYPES) pool[c] -= plan.fromPool[c];
    for (const t of plan.taps) this.cards[t.id].tapped = true;
  }
  emptyPools() { for (const p of this.players) p.pool = emptyPool(); }

  // ---------- 対象 ----------
  slotsFromEffects(effects) {
    const slots = [];
    const map = [];
    for (const e of effects) {
      if (e.target === undefined) map.push(null);
      else if (typeof e.target === 'string' && /^\$\d+$/.test(e.target)) map.push(Number(e.target.slice(1)));
      else { slots.push(e.target); map.push(slots.length - 1); }
    }
    return { slots, map };
  }
  spellSlots(d) {
    if (d.isAura) return { slots: [d.enchant], map: [] };
    if (d.isPermanent) return { slots: [], map: [] };
    return this.slotsFromEffects(d.spellEffects);
  }
  matchTarget(spec, controller, id) {
    const kind = typeof spec === 'object' ? spec.kind : spec;
    const f = (typeof spec === 'object' && spec.filter) || {};
    if (typeof id === 'string' && id[0] === 'p') {
      const idx = Number(id.slice(1));
      if (!this.players[idx]) return false;
      return kind === 'any' || kind === 'player' || (kind === 'opponent' && idx !== controller);
    }
    const c = this.cards[id];
    if (!c) return false;
    const d = this.def(c);
    if (c.zone === 'stack') {
      if (kind === 'spell') return true;
      if (kind === 'creature_spell') return d.types.includes('Creature');
      if (kind === 'noncreature_spell') return !d.types.includes('Creature');
      return false;
    }
    if (c.zone === 'graveyard') {
      if (c.owner !== controller) return false;
      if (kind === 'card_in_your_graveyard') return true;
      if (kind === 'creature_card_in_your_graveyard') return d.types.includes('Creature');
      return false;
    }
    if (c.zone !== 'battlefield') return false;
    const ch = this.chars(c);
    if (ch.keywords.has('hexproof') && c.controller !== controller) return false;
    const t = d.types;
    const cr = t.includes('Creature');
    let ok;
    switch (kind) {
      case 'any': case 'creature': ok = cr; break;
      case 'creature_you_control': ok = cr && c.controller === controller; break;
      case 'creature_opponent_controls': ok = cr && c.controller !== controller; break;
      case 'permanent': ok = true; break;
      case 'nonland_permanent': ok = !t.includes('Land'); break;
      case 'noncreature_permanent': ok = !cr; break;
      case 'artifact': ok = t.includes('Artifact'); break;
      case 'enchantment': ok = t.includes('Enchantment'); break;
      case 'land': ok = t.includes('Land'); break;
      case 'artifact_or_enchantment': ok = t.includes('Artifact') || t.includes('Enchantment'); break;
      default: ok = false;
    }
    if (!ok) return false;
    if (f.maxPower !== undefined && ch.power > f.maxPower) return false;
    if (f.minPower !== undefined && ch.power < f.minPower) return false;
    if (f.maxManaValue !== undefined && d.mv > f.maxManaValue) return false;
    if (f.tapped !== undefined && c.tapped !== f.tapped) return false;
    if (f.color && !d.colors.includes(f.color)) return false;
    if (f.notColor && d.colors.includes(f.notColor)) return false;
    if (f.keyword && !ch.keywords.has(f.keyword)) return false;
    if (f.attacking && !(this.combat && this.combat.attackers.some((a) => a.id === id))) return false;
    return true;
  }
  targetOptions(spec, controller) {
    const all = ['p0', 'p1', ...this.battlefield];
    for (const s of this.stack) if (s.kind === 'spell') all.push(s.cardId);
    for (const p of this.players) all.push(...p.graveyard);
    return all.filter((id) => this.matchTarget(spec, controller, id));
  }
  slotOptions(slots, controller) {
    return slots.map((spec) => ({ spec, options: this.targetOptions(spec, controller) }));
  }

  // ---------- 合法アクション ----------
  sorcerySpeed(p) {
    return this.active === p && (this.step === 'main1' || this.step === 'main2') && this.stack.length === 0;
  }
  canActivateTap(c) {
    return !c.tapped && !(this.isCreature(c) && c.sick && !this.kw(c, 'haste'));
  }
  legalActions(p) {
    if (this.winner !== null || this.decision || this.priority !== p) return [];
    const acts = [];
    const pl = this.players[p];
    const ss = this.sorcerySpeed(p);
    for (const id of pl.hand) {
      const c = this.cards[id];
      const d = this.def(c);
      if (d.isLand) {
        if (ss && pl.landsPlayed < 1) acts.push({ type: 'playLand', cardId: id });
        continue;
      }
      const instant = d.types.includes('Instant') || d.keywords.includes('flash');
      if (!instant && !ss) continue;
      const { slots } = this.spellSlots(d);
      const so = this.slotOptions(slots, p);
      if (so.some((s) => !s.options.length)) continue;
      if (!this.planCost(p, d.manaCost)) continue;
      acts.push({ type: 'cast', cardId: id, slots: so });
    }
    for (const id of this.battlefield) {
      const c = this.cards[id];
      if (c.controller !== p) continue;
      this.def(c).abilities.forEach((ab, index) => {
        if (ab.type !== 'activated') return;
        if (ab.speed === 'sorcery' && !ss) return;
        const pc = ab.parsedCost;
        if (pc.tap && !this.canActivateTap(c)) return;
        if (pc.life && pl.life < pc.life) return;
        const { slots } = this.slotsFromEffects(ab.effects || []);
        const so = this.slotOptions(slots, p);
        if (so.some((s) => !s.options.length)) return;
        if (!this.planCost(p, pc.mana, pc.tap ? id : null)) return;
        acts.push({ type: 'activate', permId: id, index, cost: ab.cost, slots: so });
      });
    }
    return acts;
  }

  shouldAutoPass(p) {
    const acts = this.legalActions(p);
    if (!acts.length) return true;
    if (this.stack.length) return this.stack[this.stack.length - 1].controller === p;
    const key = (this.active === p ? 'my_' : 'opp_') + this.step;
    return !this.players[p].stops.has(key);
  }

  // ---------- 公開API ----------
  /** プレイヤー p のアクションを処理。{ok, error} */
  act(p, action) {
    try {
      const r = this._act(p, action);
      if (r && r.error) return { ok: false, error: r.error };
      this.run();
      this.version++;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _act(p, a) {
    if (this.winner !== null) return { error: 'ゲームは終了しています' };
    if (a.type === 'concede') {
      this.players[p].lost = true;
      this.addLog(`${this.players[p].name} が投了しました`);
      this.checkWinner();
      return;
    }
    if (a.type === 'setStops') {
      this.players[p].stops = new Set(a.stops || []);
      return;
    }
    const d = this.decision;
    if (d) {
      if (d.player !== p) return { error: '相手の選択を待っています' };
      return this.answerDecision(p, d, a);
    }
    if (this.priority !== p) return { error: '優先権がありません' };
    switch (a.type) {
      case 'pass': this.doPass(p); return;
      case 'tapMana': return this.doTapMana(p, a);
      case 'playLand': return this.doPlayLand(p, a);
      case 'cast': return this.doCast(p, a);
      case 'activate': return this.doActivate(p, a);
      default: return { error: '不明なアクション: ' + a.type };
    }
  }

  doPass(p) {
    this.passes++;
    if (this.passes >= 2) {
      this.passes = 0;
      if (this.stack.length) {
        this.resolveTop();
        this.priority = this.active;
      } else {
        this.nextStep();
      }
    } else {
      this.priority = this.opp(p);
    }
  }

  doTapMana(p, a) {
    const c = this.cards[a.permId];
    if (!c || c.controller !== p || c.zone !== 'battlefield') return { error: '不正なパーマネント' };
    const src = this.manaSources(p).find((s) => s.id === a.permId);
    if (!src) return { error: 'このパーマネントからマナは出せません' };
    const color = a.color || src.colors[0];
    if (!src.colors.includes(color)) return { error: 'その色のマナは出せません' };
    c.tapped = true;
    this.players[p].pool[color]++;
  }

  findAction(p, pred) { return this.legalActions(p).find(pred); }

  checkTargets(so, targets) {
    targets = targets || [];
    if (targets.length !== so.length) return '対象の数が正しくありません';
    for (let i = 0; i < so.length; i++) if (!so[i].options.includes(targets[i])) return `対象が不正です: ${this.name(targets[i])}`;
    return null;
  }

  doPlayLand(p, a) {
    if (!this.findAction(p, (x) => x.type === 'playLand' && x.cardId === a.cardId)) return { error: '今は土地をプレイできません' };
    const nm = this.name(a.cardId);
    this.moveCard(a.cardId, 'battlefield', { controller: p });
    this.players[p].landsPlayed++;
    this.addLog(`${this.players[p].name} は ${nm} をプレイした`);
    this.passes = 0;
  }

  doCast(p, a) {
    const act = this.findAction(p, (x) => x.type === 'cast' && x.cardId === a.cardId);
    if (!act) return { error: 'この呪文は今唱えられません' };
    const err = this.checkTargets(act.slots, a.targets);
    if (err) return { error: err };
    const c = this.cards[a.cardId];
    const d = this.def(c);
    const plan = this.planCost(p, d.manaCost);
    if (!plan) return { error: 'マナが足りません' };
    this.payPlan(p, plan);
    const newId = this.moveCard(a.cardId, 'stack');
    const sp = this.spellSlots(d);
    this.stack.push({
      id: newId, kind: 'spell', cardId: newId, controller: p, name: d.name, sourceId: newId,
      effects: d.spellEffects, slots: sp.slots, map: sp.map, targets: a.targets || [],
    });
    this.addLog(`${this.players[p].name} は ${d.name} を唱えた${(a.targets || []).length ? `（対象: ${a.targets.map((t) => this.name(t)).join('、')}）` : ''}`);
    this.events.push({ type: 'cast', controller: p, creature: d.types.includes('Creature') });
    this.passes = 0;
  }

  doActivate(p, a) {
    const act = this.findAction(p, (x) => x.type === 'activate' && x.permId === a.permId && x.index === a.index);
    if (!act) return { error: 'この能力は今起動できません' };
    const err = this.checkTargets(act.slots, a.targets);
    if (err) return { error: err };
    const c = this.cards[a.permId];
    const d = this.def(c);
    const ab = d.abilities[a.index];
    const pc = ab.parsedCost;
    const plan = this.planCost(p, pc.mana, pc.tap ? c.id : null);
    if (!plan) return { error: 'マナが足りません' };
    this.payPlan(p, plan);
    if (pc.tap) c.tapped = true;
    if (pc.life) this.players[p].life -= pc.life;
    const { slots, map } = this.slotsFromEffects(ab.effects || []);
    const item = {
      id: 'a' + this.nextId++, kind: 'ability', controller: p, name: d.name, sourceId: c.id,
      effects: ab.effects || [], slots, map, targets: a.targets || [], sourceSnapshot: { defId: c.defId, tokenDef: c.tokenDef },
    };
    if (pc.sacrifice) this.moveCard(c.id, 'graveyard');
    this.stack.push(item);
    this.addLog(`${this.players[p].name} は ${d.name} の能力を起動した`);
    this.passes = 0;
  }

  // ---------- 選択（決定）処理 ----------
  answerDecision(p, d, a) {
    const pl = this.players[p];
    switch (d.kind) {
      case 'mulligan': {
        if (a.type !== 'mulligan') return { error: 'マリガンの選択をしてください' };
        if (!a.keep && pl.mulligans < 6) {
          pl.mulligans++;
          for (const id of [...pl.hand]) this.moveCard(id, 'library');
          this.shuffle(p);
          this.draw(p, 7);
          this.addLog(`${pl.name} はマリガンした（${pl.mulligans}回目）`);
          return;
        }
        this.addLog(`${pl.name} は手札をキープした`);
        if (pl.mulligans > 0) { this.decision = { kind: 'bottom', player: p, n: pl.mulligans }; return; }
        return this.nextMulligan();
      }
      case 'bottom': {
        const ids = a.cardIds || [];
        if (a.type !== 'bottom' || ids.length !== d.n || new Set(ids).size !== d.n || ids.some((id) => !pl.hand.includes(id))) return { error: `手札から${d.n}枚選んでください` };
        for (const id of ids) this.moveCard(id, 'library', { bottom: true });
        return this.nextMulligan();
      }
      case 'attackers': {
        if (a.type !== 'declareAttackers') return { error: '攻撃クリーチャーを指定してください' };
        const ids = [...new Set(a.attackers || [])];
        if (ids.some((id) => !d.options.includes(id))) return { error: '攻撃できないクリーチャーが含まれています' };
        this.decision = null;
        if (!ids.length) { this.addLog('攻撃なし'); this.enterStep('main2'); return; }
        this.combat = { defender: this.opp(p), attackers: ids.map((id) => ({ id, blockers: [], blocked: false })), firstStrikeDone: new Set() };
        for (const id of ids) {
          const c = this.cards[id];
          if (!this.kw(c, 'vigilance')) c.tapped = true;
          this.events.push({ type: 'attacks', id });
        }
        this.addLog(`${pl.name} は ${ids.map((i) => this.name(i)).join('、')} で攻撃した`);
        this.priority = this.active;
        this.passes = 0;
        return;
      }
      case 'blockers': {
        if (a.type !== 'declareBlockers') return { error: 'ブロック・クリーチャーを指定してください' };
        const blocks = a.blocks || [];
        const err = this.validateBlocks(p, blocks);
        if (err) return { error: err };
        this.decision = null;
        for (const b of blocks) {
          const at = this.combat.attackers.find((x) => x.id === b.attacker);
          at.blockers.push(b.blocker);
          at.blocked = true;
        }
        if (blocks.length) this.addLog(blocks.map((b) => `${this.name(b.blocker)} が ${this.name(b.attacker)} をブロック`).join('、'));
        else this.addLog('ブロックなし');
        this.priority = this.active;
        this.passes = 0;
        return;
      }
      case 'discard': {
        const ids = a.cardIds || [];
        if (a.type !== 'discard' || ids.length !== d.n || new Set(ids).size !== d.n || ids.some((id) => !pl.hand.includes(id))) return { error: `手札から${d.n}枚捨ててください` };
        for (const id of ids) this.moveCard(id, 'graveyard');
        this.addLog(`${pl.name} は ${d.n}枚捨てた`);
        this.decision = null;
        return;
      }
      case 'targets': {
        if (a.type !== 'chooseTargets') return { error: '対象を選んでください' };
        const err = this.checkTargets(d.slots, a.targets);
        if (err) return { error: err };
        const t = d.trigger;
        this.decision = null;
        this.pushTriggerToStack(t, a.targets);
        return;
      }
      default: return { error: '不明な選択' };
    }
  }

  nextMulligan() {
    this.mulliganQueue.shift();
    if (this.mulliganQueue.length) { this.decision = { kind: 'mulligan', player: this.mulliganQueue[0] }; return; }
    this.decision = null;
    this.nextTurn();
  }

  validateBlocks(p, blocks) {
    const used = new Set();
    const eligible = this.eligibleBlockers(p);
    const count = {};
    for (const b of blocks) {
      if (!eligible.includes(b.blocker)) return `${this.name(b.blocker)} はブロックできません`;
      if (used.has(b.blocker)) return '1体のクリーチャーがブロックできるのは1体までです';
      used.add(b.blocker);
      const at = this.combat.attackers.find((x) => x.id === b.attacker);
      if (!at) return '不正な攻撃クリーチャー';
      const A = this.cards[b.attacker];
      const B = this.cards[b.blocker];
      if (this.kw(A, 'flying') && !this.kw(B, 'flying') && !this.kw(B, 'reach')) return `${this.name(b.attacker)} は飛行を持っています`;
      count[b.attacker] = (count[b.attacker] || 0) + 1;
    }
    for (const [id, n] of Object.entries(count)) if (n === 1 && this.kw(this.cards[id], 'menace')) return `${this.name(id)} は威迫を持つので2体以上でブロックする必要があります`;
    return null;
  }

  eligibleAttackers(p) {
    return this.battlefield.filter((id) => {
      const c = this.cards[id];
      return c.controller === p && this.isCreature(c) && !c.tapped && !(c.sick && !this.kw(c, 'haste')) && !this.kw(c, 'defender');
    });
  }
  eligibleBlockers(p) {
    return this.battlefield.filter((id) => {
      const c = this.cards[id];
      return c.controller === p && this.isCreature(c) && !c.tapped;
    });
  }

  // ---------- ターン進行 ----------
  nextTurn() {
    this.turn++;
    this.active = this.turn === 1 ? this.startPlayer : this.opp(this.active);
    this.players[this.active].landsPlayed = 0;
    this.addLog(`―― ターン${this.turn}（${this.players[this.active].name}）――`);
    this.enterStep('untap');
  }

  nextStep() {
    if (this.step === 'cleanup') { this.nextTurn(); return; }
    this.enterStep(STEPS[STEPS.indexOf(this.step) + 1]);
  }

  enterStep(step) {
    this.step = step;
    this.emptyPools();
    this.passes = 0;
    this.priority = this.active;
    const ap = this.active;
    switch (step) {
      case 'untap':
        for (const id of this.battlefield) {
          const c = this.cards[id];
          if (c.controller === ap) { c.tapped = false; c.sick = false; }
        }
        this.priority = null;
        break;
      case 'upkeep':
        this.events.push({ type: 'step', step: 'upkeep', active: ap });
        break;
      case 'draw':
        if (!(this.turn === 1)) this.draw(ap, 1);
        break;
      case 'main2':
        this.combat = null;
        break;
      case 'declareAttackers': {
        const opts = this.eligibleAttackers(ap);
        if (!opts.length) { this.enterStep('main2'); return; }
        this.decision = { kind: 'attackers', player: ap, options: opts };
        break;
      }
      case 'declareBlockers': {
        const dp = this.opp(ap);
        if (this.eligibleBlockers(dp).length) this.decision = { kind: 'blockers', player: dp };
        break;
      }
      case 'firstStrikeDamage': {
        const any = this.combatants().some((id) => this.kw(this.cards[id], 'first_strike') || this.kw(this.cards[id], 'double_strike'));
        if (!any) { this.enterStep('combatDamage'); return; }
        this.combatDamage(true);
        break;
      }
      case 'combatDamage':
        this.combatDamage(false);
        break;
      case 'end':
        this.events.push({ type: 'step', step: 'end', active: ap });
        break;
      case 'cleanup': {
        const over = this.players[ap].hand.length - HAND_SIZE;
        if (over > 0) this.pendingDiscards.push({ player: ap, n: over });
        for (const id of this.battlefield) {
          const c = this.cards[id];
          c.damage = 0; c.dt = false; c.temp = [];
        }
        this.priority = null;
        break;
      }
      default: break;
    }
  }

  combatants() {
    if (!this.combat) return [];
    const ids = [];
    for (const a of this.combat.attackers) {
      if (this.cards[a.id]) ids.push(a.id);
      for (const b of a.blockers) if (this.cards[b]) ids.push(b);
    }
    return ids;
  }

  combatDamage(first) {
    if (!this.combat) return;
    const fsd = this.combat.firstStrikeDone;
    const deals = (id) => {
      const c = this.cards[id];
      if (!c || c.zone !== 'battlefield') return false;
      const fs = this.kw(c, 'first_strike');
      const ds = this.kw(c, 'double_strike');
      if (first) return fs || ds;
      return ds || !fsd.has(id);
    };
    const assigns = []; // {src, to, amt}
    for (const a of this.combat.attackers) {
      if (!deals(a.id)) continue;
      const A = this.cards[a.id];
      let power = this.chars(A).power;
      if (power <= 0) continue;
      const trample = this.kw(A, 'trample');
      const dt = this.kw(A, 'deathtouch');
      if (!a.blocked) { assigns.push({ src: a.id, to: 'p' + this.combat.defender, amt: power }); continue; }
      const bl = a.blockers.filter((b) => this.cards[b] && this.cards[b].zone === 'battlefield');
      if (!bl.length) { if (trample) assigns.push({ src: a.id, to: 'p' + this.combat.defender, amt: power }); continue; }
      for (let i = 0; i < bl.length && power > 0; i++) {
        const B = this.cards[bl[i]];
        const lethal = dt ? 1 : Math.max(0, this.chars(B).toughness - B.damage);
        let amt = Math.min(power, lethal);
        if (i === bl.length - 1 && !trample) amt = power;
        if (amt > 0) assigns.push({ src: a.id, to: B.id, amt });
        power -= amt;
      }
      if (power > 0) assigns.push({ src: a.id, to: trample ? 'p' + this.combat.defender : bl[bl.length - 1], amt: power });
    }
    for (const a of this.combat.attackers) {
      for (const b of a.blockers) {
        if (!deals(b) || !this.cards[a.id]) continue;
        const p = this.chars(this.cards[b]).power;
        if (p > 0) assigns.push({ src: b, to: a.id, amt: p });
      }
    }
    if (first) for (const id of this.combatants()) if (deals(id)) fsd.add(id);
    for (const x of assigns) this.dealDamage(x.src, x.to, x.amt, true);
    if (assigns.length) this.addLog(`戦闘ダメージ: ${assigns.map((x) => `${this.name(x.src)}→${this.name(x.to)} ${x.amt}`).join('、')}`);
  }

  dealDamage(srcId, to, amt, combat = false, srcSnapshot = null) {
    if (amt <= 0) return;
    const src = this.cards[srcId];
    const kws = src ? this.chars(src).keywords : srcSnapshot ? new Set(this.def(srcSnapshot).keywords) : new Set();
    const srcCtrl = src ? src.controller : null;
    if (to[0] === 'p') {
      const p = this.players[Number(to.slice(1))];
      p.life -= amt;
      if (combat && src) this.events.push({ type: 'combatDamagePlayer', sourceId: srcId });
    } else {
      const c = this.cards[to];
      if (!c || c.zone !== 'battlefield') return;
      c.damage += amt;
      if (kws.has('deathtouch')) c.dt = true;
    }
    if (kws.has('lifelink') && srcCtrl !== null) this.players[srcCtrl].life += amt;
  }

  // ---------- 解決 ----------
  resolveTop() {
    const item = this.stack.pop();
    const legal = item.targets.map((t, i) => this.matchTarget(item.slots[i], item.controller, t));
    const fizzle = item.targets.length > 0 && legal.every((x) => !x);
    if (item.kind === 'spell') {
      const c = this.cards[item.cardId];
      if (!c) return;
      const d = this.def(c);
      if (fizzle) {
        this.addLog(`${d.name} は対象が不正になり打ち消された`);
        this.moveCard(c.id, 'graveyard');
        return;
      }
      if (d.isPermanent) {
        const nid = this.moveCard(c.id, 'battlefield', { controller: item.controller });
        if (d.isAura && nid) this.cards[nid].attachedTo = item.targets[0];
        this.addLog(`${d.name} が戦場に出た`);
      } else {
        this.addLog(`${d.name} が解決された`);
        this.applyEffects(item, legal);
        if (this.cards[c.id]) this.moveCard(c.id, 'graveyard');
      }
    } else {
      if (fizzle) { this.addLog(`${item.name} の能力は対象不正で打ち消された`); return; }
      this.addLog(`${item.name} の能力が解決された`);
      this.applyEffects(item, legal);
    }
  }

  selectSubject(subject, item, action) {
    const p = item.controller;
    const def = ['draw', 'gain_life', 'lose_life', 'add_mana', 'token', 'discard', 'mill'].includes(action) ? 'you' : 'self';
    const bfCreatures = () => this.battlefield.filter((id) => this.isCreature(this.cards[id]));
    switch (subject || def) {
      case 'you': return ['p' + p];
      case 'self': return this.cards[item.sourceId] ? [item.sourceId] : [];
      case 'each_opponent': return ['p' + this.opp(p)];
      case 'each_player': return ['p0', 'p1'];
      case 'all_creatures': return bfCreatures();
      case 'creatures_you_control': return bfCreatures().filter((id) => this.cards[id].controller === p);
      case 'other_creatures_you_control': return bfCreatures().filter((id) => this.cards[id].controller === p && id !== item.sourceId);
      case 'creatures_opponents_control': return bfCreatures().filter((id) => this.cards[id].controller !== p);
      case 'attached': { const s = this.cards[item.sourceId]; return s && s.attachedTo && this.cards[s.attachedTo] ? [s.attachedTo] : []; }
      default: return [];
    }
  }

  applyEffects(item, legal) {
    item.effects.forEach((e, i) => {
      const si = item.map[i];
      const targets = si === null || si === undefined ? this.selectSubject(e.subject, item, e.action) : legal[si] ? [item.targets[si]] : [];
      this.doEffect(e, targets.filter((t) => t[0] === 'p' || this.cards[t]), item);
    });
  }

  doEffect(e, targets, item) {
    const amt = e.amount ?? 1;
    const P = (t) => this.players[Number(t.slice(1))];
    const isP = (t) => t[0] === 'p';
    for (const t of targets) {
      const c = isP(t) ? null : this.cards[t];
      switch (e.action) {
        case 'damage': this.dealDamage(item.sourceId, t, amt, false, item.sourceSnapshot); break;
        case 'draw': if (isP(t)) this.draw(Number(t.slice(1)), amt); break;
        case 'gain_life': if (isP(t)) P(t).life += amt; break;
        case 'lose_life': if (isP(t)) P(t).life -= amt; break;
        case 'destroy': if (c && c.zone === 'battlefield' && !this.kw(c, 'indestructible')) this.moveCard(t, 'graveyard'); break;
        case 'exile': if (c) this.moveCard(t, 'exile'); break;
        case 'bounce': if (c && c.zone === 'battlefield') this.moveCard(t, 'hand'); break;
        case 'tap': if (c) c.tapped = true; break;
        case 'untap': if (c) c.tapped = false; break;
        case 'pump': if (c) c.temp.push({ power: e.power || 0, toughness: e.toughness || 0, keywords: e.keywords || [] }); break;
        case 'counters': if (c) c.counters += amt; break;
        case 'token': if (isP(t)) for (let i = 0; i < amt; i++) this.createToken(e.token, Number(t.slice(1))); break;
        case 'counter': {
          const si = this.stack.findIndex((s) => s.kind === 'spell' && s.cardId === t);
          if (si >= 0) {
            this.stack.splice(si, 1);
            this.addLog(`${this.name(t)} は打ち消された`);
            this.moveCard(t, 'graveyard');
          }
          break;
        }
        case 'discard':
          if (isP(t)) {
            const pi = Number(t.slice(1));
            if (e.random) {
              for (let i = 0; i < amt && P(t).hand.length; i++) this.moveCard(P(t).hand[Math.floor(this.rand() * P(t).hand.length)], 'graveyard');
            } else {
              const n = Math.min(amt, P(t).hand.length);
              if (n > 0) this.pendingDiscards.push({ player: pi, n });
            }
          }
          break;
        case 'mill':
          if (isP(t)) for (let i = 0; i < amt && P(t).library.length; i++) this.moveCard(P(t).library[P(t).library.length - 1], 'graveyard');
          break;
        case 'add_mana': if (isP(t)) P(t).pool[(e.color || 'C').toUpperCase()] += amt; break;
        case 'return_from_graveyard':
          if (c && c.zone === 'graveyard') this.moveCard(t, e.to === 'battlefield' ? 'battlefield' : 'hand', { controller: item.controller });
          break;
        case 'attach': {
          const s = this.cards[item.sourceId];
          if (s && c && c.zone === 'battlefield') s.attachedTo = t;
          break;
        }
        case 'sacrifice': if (c && c.zone === 'battlefield') this.moveCard(t, 'graveyard'); break;
        default: break;
      }
    }
  }

  // ---------- 誘発型能力 ----------
  collectTriggers() {
    const evs = this.events;
    this.events = [];
    for (const ev of evs) {
      if (ev.type === 'dies') {
        const d = ev.snapshot.tokenDef || this.defs[ev.snapshot.defId];
        for (const ab of d.abilities) {
          if (ab.type === 'triggered' && ab.trigger === 'dies') {
            this.triggerQueue.push({ controller: ev.snapshot.controller, sourceId: null, name: d.name, effects: ab.effects || [], sourceSnapshot: ev.snapshot });
          }
        }
      }
      for (const sid of this.battlefield) {
        const s = this.cards[sid];
        for (const ab of this.def(s).abilities) {
          if (ab.type !== 'triggered') continue;
          if (this.triggerMatches(ab, s, ev)) {
            this.triggerQueue.push({ controller: s.controller, sourceId: sid, name: this.def(s).name, effects: ab.effects || [], sourceSnapshot: { defId: s.defId, tokenDef: s.tokenDef } });
          }
        }
      }
    }
  }

  triggerMatches(ab, s, ev) {
    const evc = ev.id ? this.cards[ev.id] : null;
    switch (ab.trigger) {
      case 'etb': return ev.type === 'etb' && ev.id === s.id;
      case 'creature_etb_you_control': return ev.type === 'etb' && ev.id !== s.id && evc && this.isCreature(evc) && evc.controller === s.controller;
      case 'landfall': return ev.type === 'etb' && evc && this.hasType(evc, 'Land') && evc.controller === s.controller;
      case 'attacks': return ev.type === 'attacks' && ev.id === s.id;
      case 'upkeep': return ev.type === 'step' && ev.step === 'upkeep' && ev.active === s.controller;
      case 'end_step': return ev.type === 'step' && ev.step === 'end' && ev.active === s.controller;
      case 'cast_spell': return ev.type === 'cast' && ev.controller === s.controller && (ab.filter !== 'noncreature' || !ev.creature);
      case 'deals_combat_damage_to_player': return ev.type === 'combatDamagePlayer' && ev.sourceId === s.id;
      default: return false;
    }
  }

  flushTriggers() {
    // APNAP順
    this.triggerQueue.sort((a, b) => (a.controller === this.active ? 0 : 1) - (b.controller === this.active ? 0 : 1));
    while (this.triggerQueue.length) {
      const t = this.triggerQueue.shift();
      const { slots } = this.slotsFromEffects(t.effects);
      if (!slots.length) { this.pushTriggerToStack(t, []); continue; }
      const so = this.slotOptions(slots, t.controller);
      if (so.some((s) => !s.options.length)) { this.addLog(`${t.name} の誘発型能力は対象がないため取り除かれた`); continue; }
      if (so.every((s) => s.options.length === 1)) { this.pushTriggerToStack(t, so.map((s) => s.options[0])); continue; }
      this.decision = { kind: 'targets', player: t.controller, trigger: t, slots: so, name: t.name };
      return;
    }
  }

  pushTriggerToStack(t, targets) {
    const { slots, map } = this.slotsFromEffects(t.effects);
    this.stack.push({
      id: 'a' + this.nextId++, kind: 'ability', controller: t.controller, name: t.name, sourceId: t.sourceId,
      effects: t.effects, slots, map, targets, sourceSnapshot: t.sourceSnapshot, triggered: true,
    });
    this.addLog(`${t.name} の誘発型能力がスタックに置かれた`);
    this.passes = 0;
    if (this.priority === null && this.step !== 'cleanup') this.priority = this.active;
  }

  // ---------- 状況起因処理 ----------
  checkSBA() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (const p of this.players) {
        if (!p.lost && (p.life <= 0 || p.drewFromEmpty)) {
          p.lost = true;
          this.addLog(`${p.name} は${p.life <= 0 ? 'ライフが0以下になった' : '空のライブラリーから引こうとした'}`);
        }
      }
      if (this.checkWinner()) return;
      const legends = {};
      for (const id of [...this.battlefield]) {
        const c = this.cards[id];
        if (!c) continue;
        const d = this.def(c);
        if (this.isCreature(c)) {
          const ch = this.chars(c);
          if (ch.toughness <= 0) { this.addLog(`${d.name} はタフネスが0以下になり墓地に置かれた`); this.moveCard(id, 'graveyard'); changed = true; continue; }
          if ((c.damage >= ch.toughness || (c.dt && c.damage > 0)) && !ch.keywords.has('indestructible')) {
            this.addLog(`${d.name} は破壊された`);
            this.moveCard(id, 'graveyard'); changed = true; continue;
          }
        }
        if (d.isAura) {
          const host = c.attachedTo && this.cards[c.attachedTo];
          if (!host || host.zone !== 'battlefield' || !this.matchTargetIgnoringHexproof(d.enchant, host)) { this.moveCard(id, 'graveyard'); changed = true; continue; }
        }
        if (c.attachedTo && !d.isAura) {
          const host = this.cards[c.attachedTo];
          if (!host || host.zone !== 'battlefield' || !this.isCreature(host)) c.attachedTo = null;
        }
        if (d.supertypes.includes('Legendary')) {
          const k = c.controller + ':' + d.name;
          (legends[k] = legends[k] || []).push(id);
        }
      }
      for (const ids of Object.values(legends)) {
        if (ids.length > 1) {
          for (const id of ids.slice(0, -1)) { this.addLog(`レジェンド・ルールにより ${this.name(id)} が墓地に置かれた`); this.moveCard(id, 'graveyard'); }
          changed = true;
        }
      }
    }
  }
  matchTargetIgnoringHexproof(spec, c) {
    const kind = typeof spec === 'object' ? spec.kind : spec;
    if (kind === 'creature') return this.isCreature(c);
    if (kind === 'creature_you_control') return this.isCreature(c);
    return true;
  }
  checkWinner() {
    const lost = this.players.filter((p) => p.lost);
    if (!lost.length) return false;
    this.winner = lost.length === 2 ? 'draw' : this.players.find((p) => !p.lost).index;
    this.decision = null;
    this.priority = null;
    this.addLog(this.winner === 'draw' ? '引き分け' : `${this.players[this.winner].name} の勝利！`);
    return true;
  }

  // ---------- メインループ ----------
  run() {
    let guard = 0;
    while (guard++ < 5000) {
      if (this.winner !== null) return;
      this.checkSBA();
      if (this.winner !== null) return;
      this.collectTriggers();
      if (this.decision) return;
      if (this.pendingDiscards.length) {
        const pd = this.pendingDiscards.shift();
        const n = Math.min(pd.n, this.players[pd.player].hand.length);
        if (n > 0) { this.decision = { kind: 'discard', player: pd.player, n }; return; }
        continue;
      }
      if (this.triggerQueue.length) { this.flushTriggers(); if (this.decision) return; continue; }
      if (this.priority === null) { this.nextStep(); continue; }
      if (this.shouldAutoPass(this.priority)) { this.doPass(this.priority); continue; }
      return;
    }
  }

  // ---------- ビュー（各プレイヤーから見える情報） ----------
  cardView(id, viewer) {
    const c = this.cards[id];
    if (!c) return null;
    const d = this.def(c);
    const v = {
      id, defId: c.defId, token: c.isToken, name: d.name, cost: d.cost, mv: d.mv, colors: d.colors, typeLine: typeLine(d),
      types: d.types, subtypes: d.subtypes, text: d.text, rarity: d.rarity, owner: c.owner, controller: c.controller,
      image: c.isToken ? null : `/img/${encodeURIComponent(c.defId)}`, imageType: d.imageType,
    };
    if (d.types.includes('Creature')) {
      const ch = this.chars(c);
      v.power = ch.power; v.toughness = ch.toughness; v.basePower = d.power; v.baseToughness = d.toughness;
      v.keywords = [...ch.keywords];
      v.keywordsJa = v.keywords.map((k) => KEYWORD_JA[k] || k);
    }
    if (c.zone === 'battlefield') {
      Object.assign(v, { tapped: c.tapped, sick: c.sick && this.isCreature(c) && !this.kw(c, 'haste'), damage: c.damage, counters: c.counters, attachedTo: c.attachedTo });
      v.manaColors = (this.manaSources(c.controller).find((s) => s.id === id) || {}).colors || null;
      if (viewer !== c.controller) v.manaColors = null;
    }
    return v;
  }

  view(p) {
    const me = this.players[p];
    const dec = this.decision;
    let decision = null;
    if (dec) {
      if (dec.player === p) {
        decision = { kind: dec.kind, n: dec.n, options: dec.options, name: dec.name, slots: dec.slots };
        if (dec.kind === 'blockers') {
          decision.blockers = this.eligibleBlockers(p);
          decision.attackers = this.combat.attackers.map((a) => a.id);
        }
      } else decision = { kind: 'waiting', for: dec.kind };
    }
    return {
      you: p,
      version: this.version,
      turn: this.turn,
      active: this.active,
      step: this.step,
      stepJa: STEP_JA[this.step] || 'マリガン',
      priority: this.priority,
      winner: this.winner,
      players: this.players.map((pl) => ({
        index: pl.index, name: pl.name, life: pl.life, libraryCount: pl.library.length, handCount: pl.hand.length,
        hand: pl.index === p ? pl.hand.map((id) => this.cardView(id, p)) : null,
        graveyard: pl.graveyard.map((id) => this.cardView(id, p)),
        exile: pl.exile.map((id) => this.cardView(id, p)),
        pool: pl.pool, landsPlayed: pl.landsPlayed, mulligans: pl.mulligans,
      })),
      battlefield: this.battlefield.map((id) => this.cardView(id, p)),
      stack: this.stack.map((s) => ({
        id: s.id, kind: s.kind, name: s.name, controller: s.controller, targets: s.targets.map((t) => ({ id: t, name: this.name(t) })),
        card: s.kind === 'spell' ? this.cardView(s.cardId, p) : null,
        text: s.kind === 'spell' ? null : (s.sourceSnapshot ? (this.def(s.sourceSnapshot) || {}).text : ''),
      })),
      combat: this.combat ? { defender: this.combat.defender, attackers: this.combat.attackers.map((a) => ({ id: a.id, blockers: a.blockers, blocked: a.blocked })) } : null,
      decision,
      actions: this.legalActions(p),
      stops: [...me.stops],
      log: this.log.slice(-60),
    };
  }
}

module.exports = { Game, STEPS, STEP_JA, DEFAULT_STOPS };
