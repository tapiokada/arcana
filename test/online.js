// 2つのアプリ・インスタンスを中継サーバー経由で対戦させる統合テスト
// 前提: 中継サーバーとアプリ2つが起動していること（run-tests.js が起動する）
const WebSocket = require('ws');
function client(port, label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ui`);
    const c = { ws, label, view: null, status: null, end: null, errors: [] };
    ws.on('message', (b) => {
      const m = JSON.parse(b);
      if (m.t === 'status') c.status = m.status;
      if (m.t === 'view') { c.view = m.view; clearTimeout(c.timer); c.timer = setTimeout(() => step(c), 40); }
      if (m.t === 'matchEnd') c.end = m;
      if (m.t === 'error') c.errors.push(m.msg);
    });
    ws.on('open', () => resolve(c));
  });
}
function step(c) {
  const v = c.view;
  if (!v || v.winner !== null) return;
  const send = (action) => c.ws.send(JSON.stringify({ t: 'action', action }));
  const d = v.decision;
  if (d && d.kind !== 'waiting') {
    if (d.kind === 'mulligan') return send({ type: 'mulligan', keep: true });
    if (d.kind === 'attackers') return send({ type: 'declareAttackers', attackers: d.options });
    if (d.kind === 'blockers') return send({ type: 'declareBlockers', blocks: [] });
    if (d.kind === 'bottom' || d.kind === 'discard') return send({ type: d.kind, cardIds: v.players[v.you].hand.slice(0, d.n).map((x) => x.id) });
    if (d.kind === 'targets') return send({ type: 'chooseTargets', targets: d.slots.map((s) => s.options[0]) });
    return;
  }
  if (d || v.priority !== v.you) return;
  const a = v.actions.find((x) => x.type === 'playLand') || v.actions.find((x) => x.type === 'cast' && !v.stack.length);
  if (a) return send({ ...a, targets: (a.slots || []).map((s) => s.options[0]), slots: undefined });
  send({ type: 'pass' });
}
module.exports = async function onlineTest(portA, portB) {
  const A = await client(portA, 'A');
  const B = await client(portB, 'B');
  const deck = async (port) => (await (await fetch(`http://localhost:${port}/api/profile`)).json()).profile.decks[0].id;
  A.ws.send(JSON.stringify({ t: 'online', mode: 'create', deckId: await deck(portA) }));
  for (let i = 0; i < 50 && !(A.status && A.status.code); i++) await new Promise((r) => setTimeout(r, 100));
  if (!A.status.code) throw new Error('room not created: ' + JSON.stringify(A.status) + A.errors);
  B.ws.send(JSON.stringify({ t: 'online', mode: 'join', code: A.status.code, deckId: await deck(portB) }));
  const t0 = Date.now();
  while (!(A.end && B.end) && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 200));
  if (!A.end || !B.end) throw new Error(`match did not finish: A=${JSON.stringify(A.view && A.view.step)} errA=${A.errors} errB=${B.errors}`);
  if (A.end.won === B.end.won) throw new Error('both sides report same result');
  const imgOk = (await fetch(`http://localhost:${portB}${A.view.battlefield.concat(...A.view.players.map(p=>p.graveyard))[0].image}`)).status;
  A.ws.close(); B.ws.close();
  return { turns: A.view.turn, winnerA: A.end.won, imageStatusOnGuest: imgOk, errors: [...A.errors, ...B.errors].filter((e) => !/優先権/.test(e)) };
};
