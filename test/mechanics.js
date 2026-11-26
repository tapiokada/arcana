// 第2弾で追加したルール（占術・共鳴・新誘発条件・アーティファクト・トークン）の単体テスト
const assert = require('assert');
const { normalizeDef } = require('../engine/cards');
const { Game } = require('../engine/game');
const set = require('../sets/ruins/set.json');
const starter = require('../sets/starter/set.json');
const defs = {};
for (const c of [...starter.cards, ...set.cards]) defs[c.id] = normalizeDef(c);
const byName = (n) => Object.values(defs).find((d) => d.name === n).id;
const results = [];
function test(name, fn) {
  try { fn(); results.push(`  ✓ ${name}`); } catch (e) { results.push(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

// 盤面を直接組み立てるヘルパー: p0 のメイン1・優先権ありの状態を作る
function setup({ hand = [], bf0 = [], bf1 = [], library0 = [] } = {}) {
  const filler = Array(40).fill(byName('平地'));
  const g = new Game({ defs, players: [{ name: 'A', deck: filler }, { name: 'B', deck: filler }], seed: 1 });
  g.decision = null; g.mulliganQueue = []; g.turn = 3; g.active = 0; g.step = 'main1'; g.priority = 0; g.events = [];
  for (const p of g.players) { for (const id of [...p.hand]) g.moveCard(id, 'library'); }
  const put = (name, owner, zone) => {
    const c = g.newCard({ defId: byName(name), owner, zone });
    if (zone === 'battlefield') { g.battlefield.push(c.id); c.sick = false; } else g.players[owner][zone].push(c.id);
    return c.id;
  };
  const ids = { hand: hand.map((n) => put(n, 0, 'hand')), bf0: bf0.map((n) => put(n, 0, 'battlefield')), bf1: bf1.map((n) => put(n, 1, 'battlefield')) };
  ids.lib = library0.map((n) => put(n, 0, 'library'));
  g.events = [];
  return { g, ids };
}
// スタックが空になる（または選択待ちになる）まで両者パス
function resolve(g) {
  let guard = 0;
  while (g.stack.length && !g.decision && g.priority !== null && guard++ < 20) g.act(g.priority, { type: 'pass' });
}
const lands = (color, n) => Array(n).fill({ W: '平地', U: '島', B: '沼', R: '山', G: '森' }[color]);

test('占術: 選んだカードがライブラリーの一番下へ、残りは上のまま', () => {
  const { g, ids } = setup({ hand: ['遺跡の書記官'], bf0: lands('U', 2), library0: ['山', '森', '島'] });
  assert.ok(g.act(0, { type: 'cast', cardId: ids.hand[0] }).ok);
  resolve(g);
  assert.strictEqual(g.decision && g.decision.kind, 'scry');
  const [top1, top2] = g.decision.cards; // 上から2枚 = 島, 森
  assert.deepStrictEqual([g.name(top1), g.name(top2)], ['島', '森']);
  assert.ok(g.act(0, { type: 'scry', bottom: [top1] }).ok);
  const lib = g.players[0].library;
  assert.strictEqual(g.name(lib[lib.length - 1]), '森', '森 が一番上に残る');
  assert.strictEqual(g.name(lib[0]), '島', '島 が一番下へ');
});

test('共鳴: アーティファクトがないと追加効果なし、あると発動', () => {
  for (const withArtifact of [false, true]) {
    const { g, ids } = setup({ hand: ['溶岩の噴出'], bf0: [...lands('R', 2), ...(withArtifact ? ['石の歩哨'] : [])] });
    assert.ok(g.act(0, { type: 'cast', cardId: ids.hand[0], targets: ['p1'] }).ok);
    resolve(g);
    assert.strictEqual(g.players[1].life, withArtifact ? 17 : 18);
  }
});

test('creature_dies: 他のクリーチャーの死亡で誘発（屍術師）', () => {
  const { g, ids } = setup({ hand: ['砕岩の一撃'], bf0: [...lands('R', 2), '墓守りの屍術師'], bf1: ['樫の森の熊'] });
  assert.ok(g.act(0, { type: 'cast', cardId: ids.hand[0], targets: [ids.bf1[0]] }).ok);
  resolve(g); // 呪文解決 → 熊死亡 → 誘発 → 誘発解決
  assert.strictEqual(g.players[1].life, 19);
  assert.strictEqual(g.players[0].life, 21);
});

test('遺物の欠片: 生成され、{2}と生け贄でカードを引ける', () => {
  const { g, ids } = setup({ hand: ['遺物の守り手'], bf0: lands('W', 4) });
  assert.ok(g.act(0, { type: 'cast', cardId: ids.hand[0] }).ok);
  resolve(g);
  const shard = g.battlefield.find((id) => g.name(id) === '遺物の欠片');
  assert.ok(shard, 'トークンが戦場にある');
  assert.ok(g.hasType(g.cards[shard], 'Artifact') && !g.isCreature(g.cards[shard]));
  const hand = g.players[0].hand.length;
  assert.ok(g.act(0, { type: 'activate', permId: shard, index: 0 }).ok);
  assert.ok(!g.battlefield.includes(shard), '生け贄に捧げられた');
  resolve(g);
  assert.strictEqual(g.players[0].hand.length, hand + 1);
});

test('artifact_etb_you_control: アーティファクトが出るとアウレリアが兵士を生成', () => {
  const { g, ids } = setup({ hand: ['石の歩哨'], bf0: [...lands('W', 2), '遺跡騎士団長アウレリア'] });
  assert.ok(g.act(0, { type: 'cast', cardId: ids.hand[0] }).ok);
  resolve(g);
  assert.ok(g.battlefield.some((id) => g.name(id) === '兵士'));
});

test('タップ状態で出る土地', () => {
  const { g, ids } = setup({ hand: ['崩れた神殿'] });
  assert.ok(g.act(0, { type: 'playLand', cardId: ids.hand[0] }).ok);
  resolve(g);
  const land = g.battlefield.find((id) => g.name(id) === '崩れた神殿');
  assert.ok(g.cards[land].tapped);
});

test('終わらない強制ループは引き分けになる', () => {
  // 旧ザルグラード（戦場に戻す対象に制限なし）を2枚使うと永久ループになる
  const loopDef = normalizeDef({ ...set.cards.find((c) => c.name === '屍王ザルグラード'), id: 'LOOP', text: '',
    abilities: [{ type: 'triggered', trigger: 'etb', effects: [{ action: 'return_from_graveyard', target: 'creature_card_in_your_graveyard', to: 'battlefield' }] }] });
  defs.LOOP = loopDef;
  const { g, ids } = setup({ hand: [], bf0: lands('B', 6) });
  const a = g.newCard({ defId: 'LOOP', owner: 0, zone: 'hand' }); g.players[0].hand.push(a.id);
  const b = g.newCard({ defId: 'LOOP', owner: 0, zone: 'graveyard' }); g.players[0].graveyard.push(b.id);
  assert.ok(g.act(0, { type: 'cast', cardId: a.id }).ok);
  resolve(g);
  assert.strictEqual(g.winner, 'draw');
  delete defs.LOOP;
  void ids;
});

console.log(results.join('\n'));
