'use strict';
// マッチング＆中継サーバー。ゲームの内容には関与せず、2クライアント間のメッセージを中継する。
// 使い方: node server/relay.js [port]   (既定 7700)
const http = require('http');
const { WebSocketServer } = require('ws');

const PROTOCOL = 1;

function startRelay(port = 7700, { log = console.log } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Arcana Duel relay server (protocol ${PROTOCOL}) clients=${clients.size} rooms=${rooms.size}\n`);
  });
  const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 * 1024 });
  const clients = new Set();
  const rooms = new Map(); // code -> host ws
  const queue = [];
  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  const pair = (host, guest) => {
    host.peer = guest; guest.peer = host;
    send(host, { t: 'matched', role: 'host', opponent: guest.name });
    send(guest, { t: 'matched', role: 'guest', opponent: host.name });
    log(`[relay] matched ${host.name} vs ${guest.name}`);
  };
  const leave = (ws) => {
    const qi = queue.indexOf(ws);
    if (qi >= 0) queue.splice(qi, 1);
    if (ws.room) { rooms.delete(ws.room); ws.room = null; }
    if (ws.peer) { send(ws.peer, { t: 'opponentLeft' }); ws.peer.peer = null; ws.peer = null; }
  };
  const genCode = () => {
    let c;
    do { c = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(c));
    return c;
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.name = '名無し';
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf); } catch { return; }
      switch (m.t) {
        case 'hello':
          ws.name = String(m.name || '名無し').slice(0, 24);
          if (m.protocol !== PROTOCOL) send(ws, { t: 'error', msg: 'プロトコルのバージョンが一致しません' });
          else send(ws, { t: 'welcome', protocol: PROTOCOL });
          break;
        case 'queue':
          leave(ws);
          if (queue.length) pair(queue.shift(), ws);
          else { queue.push(ws); send(ws, { t: 'queued' }); }
          break;
        case 'createRoom':
          leave(ws);
          ws.room = genCode();
          rooms.set(ws.room, ws);
          send(ws, { t: 'roomCreated', code: ws.room });
          break;
        case 'joinRoom': {
          leave(ws);
          const code = String(m.code || '').toUpperCase();
          const host = rooms.get(code);
          if (!host || host === ws) { send(ws, { t: 'error', msg: 'ルームが見つかりません' }); break; }
          rooms.delete(code); host.room = null;
          pair(host, ws);
          break;
        }
        case 'relay':
          if (ws.peer) send(ws.peer, { t: 'relay', data: m.data });
          break;
        case 'leave':
          leave(ws);
          break;
        default: break;
      }
    });
    ws.on('close', () => { leave(ws); clients.delete(ws); });
  });

  const iv = setInterval(() => {
    for (const ws of clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 20000);
  wss.on('close', () => clearInterval(iv));

  wss.on('error', () => {}); // ポート使用中エラーは server 側で処理する
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      clearInterval(iv);
      reject(e.code === 'EADDRINUSE' ? new Error(`ポート ${port} は既に使用中です（中継サーバーが起動済みか、別のプログラムが使っています）`) : e);
    });
    server.listen(port, () => {
      log(`[relay] listening on port ${server.address().port}`);
      resolve({ server, wss, port: server.address().port, close: () => { clearInterval(iv); wss.close(); server.close(); } });
    });
  });
}

if (require.main === module) {
  startRelay(Number(process.argv[2] || process.env.RELAY_PORT || 7700)).catch((e) => { console.error('[relay] 起動に失敗しました:', e.message); process.exit(1); });
}

module.exports = { startRelay, PROTOCOL };
