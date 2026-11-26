// 第2弾エキスパンション「遺跡の目覚め」(AD2) の set.json と絵柄を生成する
// 実行: node tools/build-ruins.js
const fs = require('fs');
const path = require('path');
const { render } = require('./art');

const SHARD = {
  name: '遺物の欠片', types: ['Artifact'], subtypes: ['Relic'], colors: [],
  abilities: [{ type: 'activated', cost: '{2},sacrifice', effects: [{ action: 'draw' }] }],
};
const RESONANCE = { youControl: { type: 'Artifact', min: 1 } }; // 共鳴
const shard = (extra = {}) => ({ action: 'token', token: SHARD, ...extra });

let n = 0;
const cards = [];
// art: [scene, motif]
function C(o, art) {
  const id = o.id || 'AD2-' + String(++n).padStart(3, '0');
  const color = (o.cost || '').match(/[WUBRG]/) ? o.cost.match(/[WUBRG]/)[0] : (o.artColor || 'C');
  delete o.artColor;
  cards.push({ id, ...o, image: `images/${id}.svg`, _art: { scene: art[0], motif: art[1], color } });
}

// ============ 白：遺跡を守る聖騎士団 ============
C({ name: '遺跡の衛兵', cost: '{1}{W}', types: ['Creature'], subtypes: ['Human', 'Soldier'], power: 2, toughness: 2, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'gain_life', amount: 3, condition: RESONANCE }] }],
  flavor: '崩れた門の前に、今も一人の衛兵が立っている。' }, ['ruins', 'spearman']);
C({ name: '封印の巫女', cost: '{W}', types: ['Creature'], subtypes: ['Human', 'Cleric'], power: 1, toughness: 2, keywords: ['lifelink'], rarity: 'common',
  flavor: '祈りは鎖となり、千年の眠りを守る。' }, ['temple', 'priestess']);
C({ name: '黎明の翼獅子', cost: '{3}{W}', types: ['Creature'], subtypes: ['Griffin'], power: 2, toughness: 3, keywords: ['flying', 'vigilance'], rarity: 'common' }, ['dawn', 'griffin']);
C({ name: '遺物の守り手', cost: '{1}{W}', types: ['Creature'], subtypes: ['Human', 'Artificer'], power: 1, toughness: 3, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [shard()] }] }, ['ruins', 'keeper']);
C({ name: '封印の光', cost: '{1}{W}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'exile', target: { kind: 'creature', filter: { minPower: 4 } } }] }],
  text: 'パワーが4以上のクリーチャー1体を対象とする。それを追放する。' }, ['night', 'sealCircle']);
C({ name: '聖域の守護騎士', cost: '{2}{W}', types: ['Creature'], subtypes: ['Human', 'Knight'], power: 3, toughness: 2, keywords: ['first_strike'], rarity: 'uncommon',
  abilities: [{ type: 'triggered', trigger: 'attacks', effects: [{ action: 'pump', power: 1, toughness: 1, condition: RESONANCE }] }] }, ['temple', 'knight']);
C({ name: '光盾の号令', cost: '{2}{W}{W}', types: ['Sorcery'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'counters', amount: 1, subject: 'creatures_you_control' }] }],
  flavor: '「盾を掲げよ。遺跡は我らの背にある。」' }, ['ruins', 'banner']);
C({ name: '天翔ける加護', cost: '{1}{W}', types: ['Enchantment'], subtypes: ['Aura'], enchant: 'creature', rarity: 'uncommon',
  abilities: [{ type: 'static', affects: 'attached', modify: { power: 1, toughness: 1, keywords: ['flying'] } }] }, ['sky', 'wings']);
C({ name: '遺跡騎士団長アウレリア', cost: '{2}{W}{W}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Human', 'Knight'], power: 3, toughness: 4, keywords: ['vigilance'], rarity: 'rare',
  abilities: [{ type: 'triggered', trigger: 'artifact_etb_you_control', effects: [{ action: 'token', token: { name: '兵士', power: 1, toughness: 1, colors: ['W'], subtypes: ['Soldier'] } }] }],
  flavor: '遺物が一つ目覚めるたび、彼女の軍勢は一人増える。' }, ['temple', 'commander']);
C({ name: '封印の大天使セラフィナ', cost: '{3}{W}{W}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Angel'], power: 4, toughness: 4, keywords: ['flying', 'lifelink'], rarity: 'mythic',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'counters', amount: 1, subject: 'other_creatures_you_control' }] }] }, ['sky', 'angel']);

// ============ 青：古代の叡智と占術 ============
C({ name: '遺跡の書記官', cost: '{1}{U}', types: ['Creature'], subtypes: ['Human', 'Wizard'], power: 1, toughness: 3, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'scry', amount: 2 }] }],
  flavor: '崩れた碑文の一文字ごとに、未来が一つ見える。' }, ['library', 'scribe']);
C({ name: '古文書の解読', cost: '{U}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'draw', amount: 1 }, { action: 'scry', amount: 1 }] }] }, ['library', 'scroll']);
C({ name: '石翼の見張り', cost: '{2}{U}', types: ['Creature'], subtypes: ['Bird', 'Construct'], power: 2, toughness: 2, keywords: ['flying'], rarity: 'common' }, ['ruins', 'owl']);
C({ name: '渦潮の帰還', cost: '{2}{U}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'bounce', target: 'nonland_permanent' }] }] }, ['sea', 'vortex']);
C({ name: '呪文封じの紋', cost: '{1}{U}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'counter', target: 'noncreature_spell' }] }] }, ['night', 'rune']);
C({ name: '機巧の魔術師', cost: '{2}{U}', types: ['Creature'], subtypes: ['Human', 'Artificer'], power: 2, toughness: 3, rarity: 'uncommon',
  abilities: [{ type: 'triggered', trigger: 'cast_spell', filter: 'noncreature', effects: [{ action: 'scry', amount: 1 }] }] }, ['library', 'gearMage']);
C({ name: '時止めの砂嵐', cost: '{3}{U}', types: ['Sorcery'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'tap', subject: 'creatures_opponents_control' }, { action: 'draw', amount: 1 }] }] }, ['desert', 'hourglass']);
C({ name: '叡智の泉', cost: '{3}{U}', types: ['Instant'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'draw', amount: 2 }, { action: 'scry', amount: 2, condition: RESONANCE }] }] }, ['cave', 'fountain']);
C({ name: '遺跡の守護霊メルヴァ', cost: '{3}{U}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Spirit'], power: 3, toughness: 3, keywords: ['flying'], rarity: 'rare',
  abilities: [{ type: 'triggered', trigger: 'upkeep', effects: [{ action: 'scry', amount: 2 }] }],
  flavor: '彼女は遺跡に訪れる者すべての行く末を知っている。' }, ['night', 'spirit']);
C({ name: '古代機神オラクリオン', cost: '{4}{U}{U}', types: ['Artifact', 'Creature'], supertypes: ['Legendary'], subtypes: ['Construct'], power: 5, toughness: 6, keywords: ['hexproof'], rarity: 'mythic',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'draw', amount: 2 }] }],
  flavor: '巨神の瞳が開いたとき、遺跡は再び呼吸を始めた。' }, ['temple', 'colossusEye']);

// ============ 黒：墓所の死者たち ============
C({ name: '遺跡の亡者', cost: '{1}{B}', types: ['Creature'], subtypes: ['Zombie'], power: 2, toughness: 2, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'dies', effects: [shard()] }],
  flavor: '死してなお、握りしめた遺物を手放さない。' }, ['crypt', 'zombie']);
C({ name: '腐蝕の指', cost: '{B}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'pump', power: -2, toughness: -2, target: 'creature' }] }] }, ['swamp', 'hand']);
C({ name: '墓所の蝙蝠', cost: '{2}{B}', types: ['Creature'], subtypes: ['Bat'], power: 2, toughness: 1, keywords: ['flying', 'lifelink'], rarity: 'common' }, ['night', 'bat']);
C({ name: '魂の取り立て', cost: '{3}{B}', types: ['Sorcery'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'destroy', target: 'creature' }, { action: 'lose_life', amount: 2, subject: 'you' }] }] }, ['crypt', 'scythe']);
C({ name: '骸骨の発掘者', cost: '{4}{B}', types: ['Creature'], subtypes: ['Skeleton'], power: 3, toughness: 3, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'return_from_graveyard', target: 'creature_card_in_your_graveyard', to: 'hand' }] }] }, ['cave', 'digger']);
C({ name: '墓守りの屍術師', cost: '{2}{B}', types: ['Creature'], subtypes: ['Human', 'Warlock'], power: 2, toughness: 2, rarity: 'uncommon',
  abilities: [{ type: 'triggered', trigger: 'creature_dies', effects: [{ action: 'lose_life', amount: 1, subject: 'each_opponent' }, { action: 'gain_life', amount: 1 }] }] }, ['crypt', 'necromancer']);
C({ name: '瘴気の霧', cost: '{2}{B}', types: ['Sorcery'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'pump', power: -1, toughness: -1, subject: 'all_creatures' }] }] }, ['swamp', 'skullCloud']);
C({ name: '禁断の契約', cost: '{1}{B}', types: ['Sorcery'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'draw', amount: 2 }, { action: 'lose_life', amount: 2, subject: 'you' }] }],
  flavor: '頁をめくるたび、命が一滴ずつ吸われていく。' }, ['night', 'tome']);
C({ name: '墓所の女王ネクレア', cost: '{2}{B}{B}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Vampire'], power: 3, toughness: 4, keywords: ['deathtouch'], rarity: 'rare',
  abilities: [{ type: 'triggered', trigger: 'creature_dies', effects: [{ action: 'counters', amount: 1, subject: 'self' }] }] }, ['crypt', 'vampireQueen']);
C({ name: '屍王ザルグラード', cost: '{4}{B}{B}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Zombie', 'King'], power: 6, toughness: 6, keywords: ['menace'], rarity: 'mythic',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'return_from_graveyard', target: { kind: 'creature_card_in_your_graveyard', filter: { maxManaValue: 4 } }, to: 'battlefield' }] }],
  text: '威迫\nこれが戦場に出たとき、あなたの墓地にあるマナ総量4以下のクリーチャー・カード1枚を対象とする。それを戦場に戻す。',
  flavor: '王の帰還に、墓所の兵がひとり、またひとりと続いた。' }, ['cave', 'lichKing']);

// ============ 赤：遺跡の守護獣と炎 ============
C({ name: '遺跡荒らしのゴブリン', cost: '{1}{R}', types: ['Creature'], subtypes: ['Goblin'], power: 2, toughness: 1, keywords: ['haste'], rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'attacks', effects: [{ action: 'pump', power: 1, toughness: 0, condition: RESONANCE }] }] }, ['ruins', 'goblin']);
C({ name: '溶岩の噴出', cost: '{1}{R}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'damage', amount: 2, target: 'any' }, { action: 'damage', amount: 1, target: '$0', condition: RESONANCE }] }] }, ['volcano', 'eruption']);
C({ name: '火口の番犬', cost: '{2}{R}', types: ['Creature'], subtypes: ['Elemental', 'Dog'], power: 3, toughness: 2, keywords: ['menace'], rarity: 'common' }, ['volcano', 'hound']);
C({ name: '砕岩の一撃', cost: '{1}{R}', types: ['Sorcery'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'damage', amount: 4, target: 'creature' }] }] }, ['cave', 'fist']);
C({ name: '炎舞の祈祷師', cost: '{1}{R}', types: ['Creature'], subtypes: ['Human', 'Shaman'], power: 1, toughness: 3, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'cast_spell', filter: 'noncreature', effects: [{ action: 'pump', power: 2, toughness: 0 }] }] }, ['volcano', 'dancer']);
C({ name: '古代の溶鉱炉', cost: '{2}{R}', types: ['Artifact'], rarity: 'uncommon',
  abilities: [{ type: 'activated', cost: '{2},{T}', effects: [{ action: 'damage', amount: 1, target: 'any' }] }] }, ['cave', 'furnace']);
C({ name: '炎翼の幼竜', cost: '{3}{R}', types: ['Creature'], subtypes: ['Dragon'], power: 2, toughness: 3, keywords: ['flying'], rarity: 'uncommon',
  abilities: [{ type: 'triggered', trigger: 'attacks', effects: [{ action: 'pump', power: 1, toughness: 0 }] }] }, ['sky', 'whelp']);
C({ name: '鬨の雄叫び', cost: '{2}{R}', types: ['Sorcery'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'pump', power: 2, toughness: 0, keywords: ['haste'], subject: 'creatures_you_control' }] }] }, ['ruins', 'warhorn']);
C({ name: '噴炎の巨人', cost: '{3}{R}{R}', types: ['Creature'], subtypes: ['Giant'], power: 5, toughness: 4, keywords: ['trample'], rarity: 'rare',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'damage', amount: 2, subject: 'creatures_opponents_control' }] }] }, ['volcano', 'giant']);
C({ name: '遺跡竜イグナロス', cost: '{4}{R}{R}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Dragon'], power: 6, toughness: 5, keywords: ['flying'], rarity: 'mythic',
  abilities: [{ type: 'triggered', trigger: 'attacks', effects: [{ action: 'damage', amount: 2, target: 'any' }] }],
  flavor: '千年分の怒りが、一息で吐き出された。' }, ['volcano', 'dragon']);

// ============ 緑：遺跡を呑む森 ============
C({ name: '苔むした石像', cost: '{1}{G}', types: ['Creature'], subtypes: ['Plant', 'Golem'], power: 0, toughness: 3, keywords: ['defender'], rarity: 'common',
  abilities: [{ type: 'mana', produce: ['G'] }] }, ['forest', 'mossStatue']);
C({ name: '蔦の抱擁', cost: '{G}', types: ['Instant'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'pump', power: 2, toughness: 2, keywords: ['reach'], target: 'creature_you_control' }] }] }, ['forest', 'vine']);
C({ name: '遺跡の大猪', cost: '{3}{G}', types: ['Creature'], subtypes: ['Boar'], power: 4, toughness: 3, keywords: ['trample'], rarity: 'common' }, ['ruins', 'boar']);
C({ name: '森林の探索者', cost: '{1}{G}', types: ['Creature'], subtypes: ['Elf', 'Scout'], power: 2, toughness: 1, rarity: 'common',
  abilities: [{ type: 'triggered', trigger: 'landfall', effects: [{ action: 'pump', power: 1, toughness: 1 }] }] }, ['forest', 'elfScout']);
C({ name: '芽吹きの呼び声', cost: '{2}{G}', types: ['Sorcery'], rarity: 'common',
  abilities: [{ type: 'spell', effects: [{ action: 'token', token: { name: '苗木の守り手', power: 2, toughness: 2, colors: ['G'], subtypes: ['Plant'], keywords: ['reach'] } }, { action: 'gain_life', amount: 2 }] }] }, ['dawn', 'sprout']);
C({ name: '根絡みの崩壊', cost: '{2}{G}', types: ['Instant'], rarity: 'uncommon',
  abilities: [{ type: 'spell', effects: [{ action: 'destroy', target: 'artifact_or_enchantment' }, { action: 'draw', amount: 1 }] }] }, ['ruins', 'roots']);
C({ name: '苔纏いの巨獣', cost: '{4}{G}', types: ['Creature'], subtypes: ['Beast'], power: 5, toughness: 5, keywords: ['reach'], rarity: 'uncommon' }, ['forest', 'beast']);
C({ name: '森の導き手', cost: '{2}{G}', types: ['Creature'], subtypes: ['Elf', 'Druid'], power: 2, toughness: 3, rarity: 'uncommon',
  abilities: [{ type: 'triggered', trigger: 'landfall', effects: [{ action: 'scry', amount: 1 }] }] }, ['swamp', 'druid']);
C({ name: '芽吹く大聖堂', cost: '{2}{G}{G}', types: ['Enchantment'], rarity: 'rare',
  abilities: [{ type: 'triggered', trigger: 'landfall', effects: [{ action: 'token', token: { name: '苗木', power: 1, toughness: 1, colors: ['G'], subtypes: ['Plant'] } }] }],
  flavor: '石の聖堂は、いまや一本の大樹の幹の中にある。' }, ['forest', 'treeChapel']);
C({ name: '遺跡喰らいゴルモス', cost: '{5}{G}{G}', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Beast'], power: 8, toughness: 8, keywords: ['trample'], rarity: 'mythic',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'pump', power: 2, toughness: 2, keywords: ['trample'], subject: 'other_creatures_you_control' }] }],
  flavor: '背負った塔は、かつて王都と呼ばれていた。' }, ['ruins', 'behemoth']);

// ============ 無色：目覚める遺物 ============
C({ name: '石の歩哨', cost: '{2}', types: ['Artifact', 'Creature'], subtypes: ['Construct'], power: 1, toughness: 4, keywords: ['defender'], rarity: 'common' }, ['ruins', 'sentinel']);
C({ name: '遺跡のゴーレム', cost: '{4}', types: ['Artifact', 'Creature'], subtypes: ['Golem'], power: 4, toughness: 4, rarity: 'common', flavor: '命令を与えた者が滅びても、命令だけは残った。' }, ['cave', 'golem']);
C({ name: '探索者の羅針盤', cost: '{1}', types: ['Artifact'], rarity: 'uncommon',
  abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'scry', amount: 2 }] }, { type: 'activated', cost: '{2},sacrifice', effects: [{ action: 'draw' }] }] }, ['desert', 'compass']);
C({ name: '機械蜘蛛', cost: '{3}', types: ['Artifact', 'Creature'], subtypes: ['Spider', 'Construct'], power: 1, toughness: 3, keywords: ['reach', 'deathtouch'], rarity: 'uncommon' }, ['cave', 'spider']);
C({ name: '封印の大鍵', cost: '{3}', types: ['Artifact'], rarity: 'rare',
  abilities: [{ type: 'activated', cost: '{4},{T}', effects: [{ action: 'exile', target: 'nonland_permanent' }] }],
  flavor: 'この鍵が回るとき、何かが封じられ、何かが解き放たれる。' }, ['temple', 'key']);
C({ name: '原初機構アルケイン', cost: '{6}', types: ['Artifact', 'Creature'], supertypes: ['Legendary'], subtypes: ['Construct'], power: 5, toughness: 5, keywords: ['trample'], rarity: 'mythic',
  abilities: [
    { type: 'triggered', trigger: 'etb', effects: [shard({ amount: 2 })] },
    { type: 'triggered', trigger: 'artifact_etb_you_control', effects: [{ action: 'counters', amount: 1, subject: 'self' }] },
  ] }, ['night', 'machineCore']);

// ============ 土地 ============
const tapped = { type: 'triggered', trigger: 'etb', effects: [{ action: 'tap', subject: 'self' }] };
const dual = (name, a, b, art, flavor) => C({ name, types: ['Land'], rarity: 'common', abilities: [tapped, { type: 'mana', produce: [a, b] }],
  text: `これが戦場に出たとき、これをタップする。\n{T}：{${a}}か{${b}}を加える。`, flavor, artColor: a }, art);
dual('崩れた神殿', 'W', 'U', ['dawn', 'crumbledTemple']);
dual('沈んだ書庫', 'U', 'B', ['sea', 'sunkenArchive']);
dual('燻る地下墓所', 'B', 'R', ['cave', 'emberCrypt']);
dual('溶岩苔の谷', 'R', 'G', ['volcano', 'mossValley']);
dual('蔦覆いの聖堂', 'G', 'W', ['forest', 'ivyChapel']);

// ============ 出力 ============
// 絵の重複チェック（主題の使い回しなし）
const seen = new Map();
for (const c of cards) {
  if (seen.has(c._art.motif)) throw new Error(`motif "${c._art.motif}" が ${seen.get(c._art.motif)} と ${c.name} で重複しています`);
  seen.set(c._art.motif, c.name);
}
const dir = path.join(__dirname, '..', 'sets', 'ruins');
fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
for (const c of cards) fs.writeFileSync(path.join(dir, c.image), render(c._art));
const out = cards.map(({ _art, ...c }) => c);
const set = {
  format: 'arcana-set/1',
  set: { code: 'AD2', name: '遺跡の目覚め', version: '1.0.0', author: 'Arcana Duel',
    description: '第2弾。封印された古代遺跡が目覚める。新ルール「占術」「共鳴」、遺物の欠片トークン、新しい誘発条件を収録。' },
  cards: out,
};
fs.writeFileSync(path.join(dir, 'set.json'), JSON.stringify(set, null, 2));
const r = {};
out.forEach((c) => { r[c.rarity] = (r[c.rarity] || 0) + 1; });
console.log(`wrote ${out.length} cards`, r);
