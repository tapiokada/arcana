'use strict';
// シンプルなヒューリスティックAI。Game インスタンスを直接参照して次のアクションを返す。

const HARMFUL = new Set(['damage', 'destroy', 'exile', 'bounce', 'tap', 'lose_life', 'discard', 'mill', 'counter', 'sacrifice']);

function value(game, id) {
  const c = game.cards[id];
  if (!c) return 0;
  const d = game.def(c);
  if (game.isCreature(c)) {
    const ch = game.chars(c);
    return ch.power * 2 + ch.toughness + ch.keywords.size + d.mv;
  }
  return d.mv + (d.isLand ? 0 : 1);
}

function effectsOfSlot(effects, map, slot) {
  return effects.filter((e, i) => map[i] === slot);
}

/** 1スロット分の対象を選ぶ。適切な対象がなければ null */
function pickTarget(game, p, options, effs) {
  const harmful = effs.some((e) => HARMFUL.has(e.action) || (e.action === 'pump' && ((e.power || 0) < 0 || (e.toughness || 0) < 0)));
  const opp = 'p' + game.opp(p);
  const mine = (id) => (id[0] === 'p' ? id === 'p' + p : game.cards[id] && game.cards[id].controller === p);
  if (effs.some((e) => e.action === 'counter')) {
    const theirs = options.filter((id) => game.cards[id] && game.cards[id].controller !== p);
    return theirs.sort((a, b) => value(game, b) - value(game, a))[0] || null;
  }
  if (harmful) {
    const cands = options.filter((id) => !mine(id));
    if (!cands.length) return null;
    const dmg = effs.find((e) => e.action === 'damage');
    if (dmg) {
      const amt = dmg.amount ?? 1;
      if (cands.includes(opp) && game.players[game.opp(p)].life <= amt) return opp;
      const kill = cands.filter((id) => id[0] !== 'p' && game.isCreature(game.cards[id]) && game.chars(game.cards[id]).toughness - game.cards[id].damage <= amt && !game.kw(game.cards[id], 'indestructible'));
      if (kill.length) return kill.sort((a, b) => value(game, b) - value(game, a))[0];
      if (cands.includes(opp)) return opp;
      return null;
    }
    const perms = cands.filter((id) => id[0] !== 'p');
    if (perms.length) {
      const best = perms.sort((a, b) => value(game, b) - value(game, a))[0];
      if (effs.some((e) => e.action === 'tap') && game.cards[best].tapped) return null;
      return best;
    }
    return cands.includes(opp) ? opp : null;
  }
  // 有益な効果
  const own = options.filter(mine);
  if (!own.length) {
    // 墓地からの回収など
    const gy = options.filter((id) => game.cards[id] && game.cards[id].zone === 'graveyard');
    return gy.sort((a, b) => value(game, b) - value(game, a))[0] || null;
  }
  const self = own.find((id) => id === 'p' + p);
  if (self) return self;
  return own.sort((a, b) => value(game, b) - value(game, a))[0];
}

function pickTargets(game, p, slotsWithOptions, effects, map) {
  const out = [];
  for (let i = 0; i < slotsWithOptions.length; i++) {
    const t = pickTarget(game, p, slotsWithOptions[i].options, effectsOfSlot(effects, map, i));
    if (!t) return null;
    out.push(t);
  }
  return out;
}

function sortForBottom(game, p, ids) {
  const lands = ids.filter((id) => game.def(game.cards[id]).isLand);
  const spells = ids.filter((id) => !game.def(game.cards[id]).isLand).sort((a, b) => game.def(game.cards[b]).mv - game.def(game.cards[a]).mv);
  const landsOnBf = game.battlefield.filter((id) => game.cards[id].controller === p && game.def(game.cards[id]).isLand).length;
  // 土地が十分なら土地から、足りないなら重い呪文から
  return landsOnBf + lands.length > 4 ? [...lands, ...spells] : [...spells, ...lands];
}

function canBlock(game, blockerId, attackerId) {
  const A = game.cards[attackerId];
  const B = game.cards[blockerId];
  return !game.kw(A, 'flying') || game.kw(B, 'flying') || game.kw(B, 'reach');
}

function kills(game, srcId, dstId) {
  const s = game.cards[srcId];
  const d = game.cards[dstId];
  const sp = game.chars(s).power;
  if (sp <= 0) return false;
  if (game.kw(d, 'indestructible')) return false;
  return game.kw(s, 'deathtouch') || sp >= game.chars(d).toughness - d.damage;
}

function chooseAttackers(game, p, options) {
  const opp = game.opp(p);
  const blockers = game.battlefield.filter((id) => {
    const c = game.cards[id];
    return c.controller === opp && game.isCreature(c) && !c.tapped;
  });
  const oppLife = game.players[opp].life;
  const totalPower = options.reduce((s, id) => s + Math.max(0, game.chars(game.cards[id]).power), 0);
  const alpha = totalPower >= oppLife + blockers.length * 2;
  return options.filter((id) => {
    const A = game.cards[id];
    if (game.chars(A).power <= 0) return false;
    if (alpha) return true;
    const threats = blockers.filter((b) => canBlock(game, b, id) && kills(game, b, id) && !kills(game, id, b));
    return threats.length === 0;
  });
}

function chooseBlocks(game, p) {
  const blocks = [];
  const avail = new Set(game.eligibleBlockers(p));
  const atks = game.combat.attackers.map((a) => a.id).sort((a, b) => game.chars(game.cards[b]).power - game.chars(game.cards[a]).power);
  let incoming = atks.reduce((s, id) => s + Math.max(0, game.chars(game.cards[id]).power), 0);
  const life = game.players[p].life;
  for (const a of atks) {
    if (game.kw(game.cards[a], 'menace')) continue;
    const cands = [...avail].filter((b) => canBlock(game, b, a));
    // 倒せて生き残る → 生き残る → 相打ち → 致死なら chump
    let pick = cands.find((b) => kills(game, b, a) && !kills(game, a, b))
      || cands.find((b) => !kills(game, a, b))
      || cands.find((b) => kills(game, b, a) && value(game, b) <= value(game, a));
    if (!pick && incoming >= life && cands.length) pick = cands.sort((x, y) => value(game, x) - value(game, y))[0];
    if (pick) {
      blocks.push({ blocker: pick, attacker: a });
      avail.delete(pick);
      incoming -= Math.max(0, game.chars(game.cards[a]).power);
    }
  }
  return blocks;
}

function chooseAction(game, p) {
  if (game.winner !== null) return null;
  const d = game.decision;
  if (d) {
    if (d.player !== p) return null;
    const pl = game.players[p];
    switch (d.kind) {
      case 'mulligan': {
        const lands = pl.hand.filter((id) => game.def(game.cards[id]).isLand).length;
        return { type: 'mulligan', keep: pl.hand.length - pl.mulligans <= 5 || (lands >= 2 && lands <= 5) };
      }
      case 'bottom': return { type: 'bottom', cardIds: sortForBottom(game, p, pl.hand).slice(0, d.n) };
      case 'discard': return { type: 'discard', cardIds: sortForBottom(game, p, pl.hand).slice(0, d.n) };
      case 'attackers': return { type: 'declareAttackers', attackers: chooseAttackers(game, p, d.options) };
      case 'blockers': return { type: 'declareBlockers', blocks: chooseBlocks(game, p) };
      case 'targets': {
        const { map } = game.slotsFromEffects(d.trigger.effects);
        const t = pickTargets(game, p, d.slots, d.trigger.effects, map) || d.slots.map((s) => s.options[0]);
        return { type: 'chooseTargets', targets: t };
      }
      default: return null;
    }
  }
  if (game.priority !== p) return null;
  const acts = game.legalActions(p);
  if (!acts.length) return { type: 'pass' };
  const land = acts.find((a) => a.type === 'playLand');
  if (land) return land;

  const top = game.stack[game.stack.length - 1];
  const casts = acts.filter((a) => a.type === 'cast').map((a) => {
    const def = game.def(game.cards[a.cardId]);
    const sp = game.spellSlots(def);
    const effects = def.isAura ? (def.abilities.find((x) => x.type === 'static') || {}).modify ? [{ action: 'pump', power: 1 }] : [] : def.spellEffects;
    const map = def.isAura ? [0] : sp.map;
    const targets = a.slots.length ? pickTargets(game, p, a.slots, effects, map) : [];
    return { a, def, targets };
  }).filter((x) => x.targets);

  if (top) {
    if (top.controller !== p) {
      const counter = casts.find((x) => x.def.spellEffects.some((e) => e.action === 'counter') && x.targets.includes(top.cardId));
      if (counter) return { type: 'cast', cardId: counter.a.cardId, targets: counter.targets };
    }
    return { type: 'pass' };
  }

  const myTurn = game.active === p;
  const main = myTurn && (game.step === 'main1' || game.step === 'main2');
  if (main) {
    const nonCounter = casts.filter((x) => !x.def.spellEffects.some((e) => e.action === 'counter'));
    nonCounter.sort((x, y) => (y.def.types.includes('Creature') - x.def.types.includes('Creature')) || y.def.mv - x.def.mv);
    const pick = nonCounter[0];
    if (pick) return { type: 'cast', cardId: pick.a.cardId, targets: pick.targets };
  }
  // 相手の終了ステップ / 自分の第2メインで起動型能力
  if ((!myTurn && game.step === 'end') || (myTurn && game.step === 'main2')) {
    if (!myTurn) {
      const inst = casts.find((x) => !x.def.spellEffects.some((e) => e.action === 'counter'));
      if (inst) return { type: 'cast', cardId: inst.a.cardId, targets: inst.targets };
    }
    for (const a of acts.filter((x) => x.type === 'activate')) {
      const c = game.cards[a.permId];
      const ab = game.def(c).abilities[a.index];
      const effs = ab.effects || [];
      if (ab.parsedCost.sacrifice) continue;
      if (effs.some((e) => e.action === 'attach') && c.attachedTo) continue;
      const { map } = game.slotsFromEffects(effs);
      const targets = a.slots.length ? pickTargets(game, p, a.slots, effs, map) : [];
      if (targets) return { type: 'activate', permId: a.permId, index: a.index, targets };
    }
  }
  return { type: 'pass' };
}

module.exports = { chooseAction };
