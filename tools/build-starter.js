// スターターセット set.json を生成するスクリプト（サンプル兼インポート仕様の例）
const fs = require('fs');
const path = require('path');
let n = 0;
const id = () => 'AD-' + String(++n).padStart(3, '0');
const C = (o) => ({ id: id(), image: null, ...o });
const cards = [
  // 白
  C({ name: '見習い衛兵', cost: '{W}', types: ['Creature'], subtypes: ['Human', 'Soldier'], power: 1, toughness: 2, rarity: 'common', flavor: '盾の重さを知る者こそ、守る重さを知る。' }),
  C({ name: '暁の天馬', cost: '{1}{W}', types: ['Creature'], subtypes: ['Pegasus'], power: 2, toughness: 1, keywords: ['flying'], rarity: 'common' }),
  C({ name: '聖堂の守護者', cost: '{3}{W}', types: ['Creature'], subtypes: ['Human', 'Knight'], power: 3, toughness: 4, keywords: ['vigilance'], rarity: 'common' }),
  C({ name: '癒しの光', cost: '{1}{W}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'gain_life', amount: 4 }, { action: 'draw', amount: 1 }] }] }),
  C({ name: '聖なる懲罰', cost: '{1}{W}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'destroy', target: { kind: 'creature', filter: { tapped: true } } }] }], text: 'タップ状態のクリーチャー1体を対象とする。それを破壊する。' }),
  C({ name: '守護の加護', cost: '{W}', types: ['Enchantment'], subtypes: ['Aura'], enchant: 'creature', rarity: 'uncommon', abilities: [{ type: 'static', affects: 'attached', modify: { power: 1, toughness: 2, keywords: ['vigilance'] } }] }),
  C({ name: '集いの角笛', cost: '{3}{W}', types: ['Sorcery'], rarity: 'uncommon', abilities: [{ type: 'spell', effects: [{ action: 'token', amount: 2, token: { name: '兵士', power: 1, toughness: 1, colors: ['W'], subtypes: ['Soldier'] } }] }] }),
  C({ name: '光輝の将軍セリア', cost: '{2}{W}{W}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Human', 'Knight'], power: 3, toughness: 3, rarity: 'rare', abilities: [{ type: 'static', affects: 'other_creatures_you_control', modify: { power: 1, toughness: 1 } }] }),
  // 青
  C({ name: '霧の斥候', cost: '{1}{U}', types: ['Creature'], subtypes: ['Bird', 'Scout'], power: 1, toughness: 2, keywords: ['flying'], rarity: 'common' }),
  C({ name: '叡智の閃き', cost: '{2}{U}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'draw', amount: 2 }] }] }),
  C({ name: '引き潮', cost: '{1}{U}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'bounce', target: 'creature' }] }] }),
  C({ name: '凍結の息吹', cost: '{U}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'tap', target: 'creature' }, { action: 'draw', amount: 1 }] }] }),
  C({ name: '否認の言葉', cost: '{U}{U}', types: ['Instant'], rarity: 'uncommon', abilities: [{ type: 'spell', effects: [{ action: 'counter', target: 'spell' }] }] }),
  C({ name: '風読みの精霊', cost: '{2}{U}', types: ['Creature'], subtypes: ['Elemental'], power: 2, toughness: 2, keywords: ['flying'], rarity: 'uncommon', abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'draw', amount: 1 }] }] }),
  C({ name: '深淵の大海蛇', cost: '{4}{U}', types: ['Creature'], subtypes: ['Serpent'], power: 4, toughness: 5, keywords: ['hexproof'], rarity: 'uncommon' }),
  C({ name: '時の賢者オルド', cost: '{2}{U}{U}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Human', 'Wizard'], power: 2, toughness: 4, rarity: 'rare', abilities: [{ type: 'triggered', trigger: 'upkeep', effects: [{ action: 'draw', amount: 1 }] }] }),
  // 黒
  C({ name: '腐肉喰らいの鼠', cost: '{B}', types: ['Creature'], subtypes: ['Rat'], power: 1, toughness: 1, keywords: ['deathtouch'], rarity: 'common' }),
  C({ name: '骨鳴りの兵', cost: '{1}{B}', types: ['Creature'], subtypes: ['Skeleton', 'Soldier'], power: 2, toughness: 1, rarity: 'common', abilities: [{ type: 'triggered', trigger: 'dies', effects: [{ action: 'lose_life', amount: 1, subject: 'each_opponent' }] }] }),
  C({ name: '生命吸収', cost: '{2}{B}', types: ['Sorcery'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'lose_life', amount: 3, target: 'opponent' }, { action: 'gain_life', amount: 3 }] }] }),
  C({ name: '墓所からの呼び声', cost: '{1}{B}', types: ['Sorcery'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'return_from_graveyard', target: 'creature_card_in_your_graveyard', to: 'hand' }] }] }),
  C({ name: '終焉の囁き', cost: '{2}{B}', types: ['Instant'], rarity: 'uncommon', abilities: [{ type: 'spell', effects: [{ action: 'destroy', target: 'creature' }] }] }),
  C({ name: '思考の腐蝕', cost: '{1}{B}', types: ['Sorcery'], rarity: 'uncommon', abilities: [{ type: 'spell', effects: [{ action: 'discard', amount: 2, target: 'opponent' }] }] }),
  C({ name: '夜宴の吸血鬼', cost: '{3}{B}', types: ['Creature'], subtypes: ['Vampire'], power: 3, toughness: 2, keywords: ['flying', 'lifelink'], rarity: 'uncommon' }),
  C({ name: '冥府の王ヴァルゴス', cost: '{3}{B}{B}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Demon'], power: 5, toughness: 5, keywords: ['menace'], rarity: 'mythic', abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'lose_life', amount: 2, subject: 'each_opponent' }, { action: 'gain_life', amount: 2 }] }] }),
  // 赤
  C({ name: '火花の小鬼', cost: '{R}', types: ['Creature'], subtypes: ['Goblin'], power: 1, toughness: 1, keywords: ['haste'], rarity: 'common' }),
  C({ name: '雷撃の矢', cost: '{R}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'damage', amount: 3, target: 'any' }] }] }),
  C({ name: '闘志の炎', cost: '{R}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'pump', power: 2, toughness: 0, keywords: ['first_strike'], target: 'creature' }] }] }),
  C({ name: '戦場の狂戦士', cost: '{2}{R}', types: ['Creature'], subtypes: ['Human', 'Berserker'], power: 3, toughness: 2, rarity: 'common', abilities: [{ type: 'triggered', trigger: 'attacks', effects: [{ action: 'pump', power: 1, toughness: 0 }] }] }),
  C({ name: 'ゴブリンの扇動者', cost: '{2}{R}', types: ['Creature'], subtypes: ['Goblin'], power: 2, toughness: 2, rarity: 'uncommon', abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'token', token: { name: 'ゴブリン', power: 1, toughness: 1, colors: ['R'], subtypes: ['Goblin'], keywords: ['haste'] } }] }] }),
  C({ name: '溶岩の巨人', cost: '{4}{R}', types: ['Creature'], subtypes: ['Giant'], power: 5, toughness: 4, keywords: ['trample'], rarity: 'uncommon' }),
  C({ name: '灼熱の嵐', cost: '{2}{R}{R}', types: ['Sorcery'], rarity: 'rare', abilities: [{ type: 'spell', effects: [{ action: 'damage', amount: 2, subject: 'all_creatures' }] }] }),
  C({ name: '紅蓮竜ヴォルカリオン', cost: '{4}{R}{R}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Dragon'], power: 5, toughness: 5, keywords: ['flying'], rarity: 'mythic', abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'damage', amount: 3, target: 'any' }] }] }),
  // 緑
  C({ name: '森のエルフ', cost: '{G}', types: ['Creature'], subtypes: ['Elf', 'Druid'], power: 1, toughness: 1, rarity: 'common', abilities: [{ type: 'mana', produce: ['G'] }] }),
  C({ name: '樫の森の熊', cost: '{1}{G}', types: ['Creature'], subtypes: ['Bear'], power: 2, toughness: 2, rarity: 'common' }),
  C({ name: '大樹の番人', cost: '{3}{G}', types: ['Creature'], subtypes: ['Treefolk'], power: 3, toughness: 5, keywords: ['reach'], rarity: 'common' }),
  C({ name: '野生の膨張', cost: '{G}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'pump', power: 3, toughness: 3, target: 'creature' }] }] }),
  C({ name: '成長の儀式', cost: '{1}{G}', types: ['Sorcery'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'counters', amount: 2, target: 'creature_you_control' }] }] }),
  C({ name: '自然の還元', cost: '{1}{G}', types: ['Instant'], rarity: 'common', abilities: [{ type: 'spell', effects: [{ action: 'destroy', target: 'artifact_or_enchantment' }] }] }),
  C({ name: '獣の咆哮', cost: '{2}{G}', types: ['Sorcery'], rarity: 'uncommon', abilities: [{ type: 'spell', effects: [{ action: 'token', token: { name: '獣', power: 3, toughness: 3, colors: ['G'], subtypes: ['Beast'] } }] }] }),
  C({ name: '古森の主グラドン', cost: '{3}{G}{G}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Elemental'], power: 5, toughness: 5, keywords: ['trample'], rarity: 'rare', abilities: [{ type: 'triggered', trigger: 'landfall', effects: [{ action: 'counters', amount: 1, subject: 'self' }] }] }),
  // 無色
  C({ name: '真鍮の番兵', cost: '{3}', types: ['Artifact', 'Creature'], subtypes: ['Construct'], power: 2, toughness: 3, rarity: 'common' }),
  C({ name: '魔力の宝珠', cost: '{2}', types: ['Artifact'], rarity: 'uncommon', abilities: [{ type: 'mana', produce: ['any'] }] }),
  C({ name: '勇者の長剣', cost: '{2}', types: ['Artifact'], subtypes: ['Equipment'], rarity: 'uncommon', abilities: [{ type: 'static', affects: 'attached', modify: { power: 2, toughness: 1 } }, { type: 'activated', cost: '{2}', speed: 'sorcery', effects: [{ action: 'attach', target: 'creature_you_control' }] }], text: '装備しているクリーチャーは+2/+1の修整を受ける。\n装備{2}（{2}：あなたがコントロールするクリーチャー1体を対象とし、それにつける。ソーサリー・タイミングでのみ起動できる）' }),
  C({ name: '賢者の書', cost: '{3}', types: ['Artifact'], rarity: 'rare', abilities: [{ type: 'activated', cost: '{2},{T}', effects: [{ action: 'draw', amount: 1 }] }] }),
];
const basics = [['平地', 'Plains'], ['島', 'Island'], ['沼', 'Swamp'], ['山', 'Mountain'], ['森', 'Forest']];
basics.forEach(([name, sub], i) => cards.push({ id: 'AD-L' + (i + 1), name, types: ['Land'], supertypes: ['Basic'], subtypes: [sub], rarity: 'basic', image: null }));
for (const c of cards) c.image = `images/${c.id}.svg`;
const set = {
  format: 'arcana-set/1',
  set: { code: 'AD1', name: 'アルカナの夜明け（スターター）', version: '1.0.0', author: 'Arcana Duel', description: '同梱のサンプル・セット。インポート仕様の記述例も兼ねる。', starter: true },
  cards,
};
const out = path.join(__dirname, '..', 'sets', 'starter', 'set.json');
fs.writeFileSync(out, JSON.stringify(set, null, 2));
console.log('wrote', out, cards.length, 'cards');
