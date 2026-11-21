'use strict';
// Arcana Duel ローカル・アプリ本体。
// 起動: node app/main.js [--port 3000] [--relay 7700] [--no-open] [--data <dir>]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');
const { CardStore } = require('./lib/cardstore');
const { Profile, PRICES, PACK_PRICE, SELL_RATE } = require('./lib/profile');
const { Session } = require('./lib/session');
const { DECK_RULES } = require('./lib/decks');
const { typeLine } = require('../engine/cards');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const PORT = Number(arg('--port', process.env.PORT || 3000));
const DATA = path.resolve(arg('--data', process.env.ARCANA_DATA || path.join(__dirname, '..', 'data')));
const ROOT = path.join(__dirname, '..');

const store = new CardStore(path.join(ROOT, 'sets'), path.join(DATA, 'sets'));
const profile = new Profile(path.join(DATA, 'profile.json'), store);
const uiSockets = new Set();
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const ws of uiSockets) if (ws.readyState === 1) ws.send(s); };
const session = new Session({ store, profile, broadcast });

function cardList() {
  const col = profile.data.collection;
  return Object.values(store.defs).map((d) => ({
    id: d.id, set: d.set, name: d.name, cost: d.cost, mv: d.mv, colors: d.colors, types: d.types, subtypes: d.subtypes,
    supertypes: d.supertypes, typeLine: typeLine(d), power: d.power, toughness: d.toughness, text: d.text, flavor: d.flavor,
    rarity: d.rarity, image: `/img/${encodeURIComponent(d.id)}`, imageType: d.imageType, owned: col[d.id] || 0,
    basic: d.isLand && d.supertypes.includes('Basic'), price: profile.price(d), sellPrice: profile.sellPrice(d),
  }));
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('リクエストが大きすぎます')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(n ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json' };

async function api(req, res, url) {
  const p = url.pathname;
  const M = req.method;
  if (p === '/api/profile' && M === 'GET') return sendJson(res, 200, { profile: profile.public(), rules: DECK_RULES, prices: PRICES, packPrice: PACK_PRICE, sellRate: SELL_RATE, status: session.status() });
  if (p === '/api/profile' && M === 'POST') { profile.update(await readBody(req)); return sendJson(res, 200, { ok: true, profile: profile.public() }); }
  if (p === '/api/cards' && M === 'GET') return sendJson(res, 200, { cards: cardList() });
  if (p === '/api/sets' && M === 'GET') return sendJson(res, 200, { sets: store.sets.map(({ dir, ...s }) => s), loadErrors: store.loadErrors });
  if (p === '/api/import' && M === 'POST') {
    const b = await readBody(req);
    let r;
    try { r = store.importSet(b.setJson, b.files || {}); } catch (e) { r = { ok: false, errors: [e.message] }; }
    if (r.ok) profile.grantStarters();
    profile.save();
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  if (p.startsWith('/api/sets/') && M === 'DELETE') return sendJson(res, 200, store.deleteSet(decodeURIComponent(p.slice(10))));
  if (p === '/api/decks' && M === 'POST') return sendJson(res, 200, profile.saveDeck(await readBody(req)));
  if (p.startsWith('/api/decks/') && M === 'DELETE') return sendJson(res, 200, profile.deleteDeck(decodeURIComponent(p.slice(11))));
  if (p === '/api/shop/pack' && M === 'POST') { const b = await readBody(req); return sendJson(res, 200, profile.buyPack(b.set)); }
  if (p === '/api/shop/buy' && M === 'POST') { const b = await readBody(req); return sendJson(res, 200, profile.buy(b.id, b.count || 1)); }
  if (p === '/api/shop/sell' && M === 'POST') { const b = await readBody(req); return sendJson(res, 200, profile.sell(b.id, b.count || 1)); }
  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/img/')) {
      const img = store.image(decodeURIComponent(url.pathname.slice(5)));
      if (!img) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': img.mime, 'cache-control': 'no-cache' });
      return res.end(img.data);
    }
    if (url.pathname.startsWith('/docs/')) {
      const f = path.join(ROOT, 'docs', path.basename(decodeURIComponent(url.pathname)));
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': STATIC['.md'] }); return res.end(fs.readFileSync(f)); }
    }
    const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^[/\\]+/, '');
    const f = path.join(__dirname, 'public', rel);
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': STATIC[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message, errors: [e.message] });
  }
});

const wss = new WebSocketServer({ server, path: '/ui' });
wss.on('connection', (ws, req) => {
  // ローカルからの接続のみ許可
  const origin = req.headers.origin || '';
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { ws.close(); return; }
  uiSockets.add(ws);
  session.onUiConnect((m) => ws.send(JSON.stringify(m)));
  ws.on('message', (buf) => { try { session.handle(JSON.parse(buf)); } catch (e) { ws.send(JSON.stringify({ t: 'error', msg: e.message })); } });
  ws.on('close', () => uiSockets.delete(ws));
});

async function main() {
  const relayPort = arg('--relay', null);
  if (relayPort) {
    const { startRelay } = require('../server/relay');
    await startRelay(relayPort === true ? 7700 : Number(relayPort));
  }
  server.listen(PORT, '127.0.0.1', () => {
    const u = `http://localhost:${PORT}/`;
    console.log(`Arcana Duel を起動しました: ${u}`);
    console.log(`データ保存先: ${DATA}`);
    if (store.loadErrors.length) console.warn('読み込めなかったセット:', JSON.stringify(store.loadErrors, null, 1));
    if (!arg('--no-open', false) && !process.env.NO_OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
      exec(cmd, () => {});
    }
  });
}
main();
