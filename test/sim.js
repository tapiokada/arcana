// AI同士の対戦を多数回シミュレーションしてエンジンの健全性を確認
const fs = require('fs');
const path = require('path');
const { normalizeDef, validateSet } = require('../engine/cards');
const { Game } = require('../engine/game');
const { chooseAction } = require('../engine/ai');
const { buildAIDeck } = require('../app/lib/decks');
const set = JSON.parse(fs.readFileSync(path.join(__dirname, '../sets/starter/set.json'), 'utf8'));
const v = validateSet(set, (f) => fs.existsSync(path.join(__dirname, '../sets/starter', f)));
if (v.errors.length) { console.error(v.errors); process.exit(1); }
const defs = {};
for (const c of set.cards) defs[c.id] = normalizeDef(c, 'AD1');
let wins = [0, 0, 0], turns = 0;
const N = +(process.argv[2] || 200);
for (let g = 0; g < N; g++) {
  const d0 = buildAIDeck(Object.values(defs), g);
  const d1 = buildAIDeck(Object.values(defs), g + 1000);
  const game = new Game({ defs, players: [{ name: 'A', deck: d0 }, { name: 'B', deck: d1 }], seed: g + 1 });
  let steps = 0;
  while (game.winner === null && steps < 20000) {
    let acted = false;
    for (const p of [0, 1]) {
      const a = chooseAction(game, p);
      if (a) {
        const r = game.act(p, a);
        if (!r.ok) { console.error('game', g, 'illegal AI action', a, r.error, game.step, game.log.slice(-5)); process.exit(1); }
        acted = true; steps++;
      }
    }
    if (!acted) { console.error('stuck', g, game.step, game.decision, game.priority); process.exit(1); }
    if (game.turn > 80) { game.act(0, { type: 'concede' }); }
  }
  // ビュー生成も確認
  JSON.stringify(game.view(0)); JSON.stringify(game.view(1));
  wins[game.winner === 'draw' ? 2 : game.winner]++;
  turns += game.turn;
}
console.log(`games=${N} wins=${wins} avgTurns=${(turns / N).toFixed(1)}`);
