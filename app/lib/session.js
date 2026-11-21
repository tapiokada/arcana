'use strict';
// 対戦セッション管理（AI対戦 / オンライン対戦のホスト・ゲスト）
const WebSocket = require('ws');
const { Game, STEPS } = require('../../engine/game');
const { chooseAction } = require('../../engine/ai');
const { normalizeDef, validateSet, FORMAT } = require('../../engine/cards');
const { expandDeck, buildAIDeck, validateDeck } = require('./decks');
const { PROTOCOL } = require('../../server/relay');

const ALL_STOPS = STEPS.flatMap((s) => ['my_' + s, 'opp_' + s]);

class Session {
  constructor({ store, profile, broadcast }) {
    this.store = store;
    this.profile = profile;
    this.broadcast = broadcast;
    this.reset();
  }

  reset() {
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
    clearTimeout(this.aiTimer);
    this.ws = null;
    this.mode = 'idle'; // idle | searching | match
    this.kind = null; // ai | online
    this.role = null; // host | guest
    this.game = null;
    this.lastView = null;
    this.rewarded = false;
    this.statusText = '';
    this.roomCode = null;
    this.opponentName = null;
    this.remoteDeck = null;
    this.store.setMatchCards({}, {});
  }

  status() {
    return { mode: this.mode, kind: this.kind, role: this.role, text: this.statusText, code: this.roomCode, opponent: this.opponentName };
  }
  pushStatus() { this.broadcast({ t: 'status', status: this.status() }); }
  error(msg) { this.broadcast({ t: 'error', msg }); }

  onUiConnect(send) {
    send({ t: 'status', status: this.status() });
    if (this.lastView) send({ t: 'view', view: this.lastView });
  }

  handle(m) {
    switch (m.t) {
      case 'startAI': return this.startAI(m.deckId);
      case 'online': return this.startOnline(m.mode, m.deckId, m.code);
      case 'cancel': case 'leaveMatch': this.leave(); return;
      case 'action': return this.localAction(m.action);
      default: return;
    }
  }

  myDeck(deckId) {
    const deck = this.profile.getDeck(deckId);
    if (!deck) return { error: 'デッキを選択してください' };
    const errs = this.profile.deckErrors(deck);
    if (errs.length) return { error: 'デッキが不正です: ' + errs.join(' / ') };
    return { list: expandDeck(deck), deck };
  }

  stopsSetting() { return this.profile.data.settings.stopAll ? ALL_STOPS : undefined; }

  // ---------- AI対戦 ----------
  startAI(deckId) {
    if (this.mode !== 'idle') this.leave();
    const d = this.myDeck(deckId);
    if (d.error) return this.error(d.error);
    const defs = this.store.defs;
    const aiDeck = buildAIDeck(Object.values(defs).filter((x) => x.set), Date.now());
    this.kind = 'ai';
    this.mode = 'match';
    this.opponentName = 'AI';
    this.game = new Game({ defs, players: [{ name: this.profile.data.name, deck: d.list, stops: this.stopsSetting() }, { name: 'AI', deck: aiDeck }], seed: Date.now() });
    this.pushStatus();
    this.afterChange();
  }

  // ---------- オンライン ----------
  startOnline(mode, deckId, code) {
    if (this.mode !== 'idle') this.leave();
    const d = this.myDeck(deckId);
    if (d.error) return this.error(d.error);
    const url = this.profile.data.settings.serverUrl;
    this.kind = 'online';
    this.mode = 'searching';
    this.myList = d.list;
    this.statusText = `サーバーに接続中… (${url})`;
    this.pushStatus();
    let ws;
    try { ws = new WebSocket(url, { maxPayload: 32 * 1024 * 1024 }); } catch (e) { this.reset(); this.pushStatus(); return this.error('サーバーURLが不正です: ' + e.message); }
    this.ws = ws;
    const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
    this.netSend = send;
    ws.on('open', () => {
      send({ t: 'hello', name: this.profile.data.name, protocol: PROTOCOL });
      if (mode === 'queue') send({ t: 'queue' });
      else if (mode === 'create') send({ t: 'createRoom' });
      else send({ t: 'joinRoom', code });
    });
    ws.on('error', (e) => {
      if (this.ws !== ws) return;
      this.error('サーバーに接続できません: ' + e.message);
      this.reset(); this.pushStatus();
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      if (this.mode === 'match' && this.lastView && this.lastView.winner === null) this.opponentGone('サーバーとの接続が切れました');
      else if (this.mode === 'searching') { this.reset(); this.pushStatus(); }
    });
    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf); } catch { return; }
      this.onNet(m);
    });
  }

  onNet(m) {
    switch (m.t) {
      case 'error': this.error(m.msg); if (this.mode === 'searching' && !this.roomCode) { this.reset(); this.pushStatus(); } break;
      case 'queued': this.statusText = '対戦相手を探しています…'; this.pushStatus(); break;
      case 'roomCreated': this.roomCode = m.code; this.statusText = `ルームコード ${m.code} を相手に伝えてください`; this.pushStatus(); break;
      case 'matched':
        this.role = m.role;
        this.opponentName = m.opponent;
        this.statusText = `${m.opponent} とマッチしました。デッキを交換中…`;
        this.pushStatus();
        this.netSend({ t: 'relay', data: { k: 'deck', format: FORMAT, name: this.profile.data.name, list: this.myList, ...this.store.deckPackage(this.myList) } });
        break;
      case 'opponentLeft': this.opponentGone('対戦相手が切断しました'); break;
      case 'relay': this.onPeer(m.data || {}); break;
      default: break;
    }
  }

  onPeer(d) {
    if (d.k === 'deck') {
      if (this.role === 'host') this.hostStart(d);
      else this.store.setMatchCards({}, d.images || {});
    } else if (d.k === 'view' && this.role === 'guest') {
      this.mode = 'match';
      this.statusText = '';
      if (!this.lastView) this.pushStatus();
      this.onView(d.view);
    } else if (d.k === 'action' && this.role === 'host' && this.game) {
      const r = this.game.act(1, d.action);
      if (!r.ok) this.netSend({ t: 'relay', data: { k: 'error', msg: r.error } });
      this.afterChange();
    } else if (d.k === 'error') {
      this.error(d.msg);
    }
  }

  hostStart(d) {
    // 相手カード定義の検証と名前空間の衝突回避
    const cards = Array.isArray(d.cards) ? d.cards : [];
    const v = validateSet({ format: FORMAT, set: { code: 'REMOTE', name: 'remote' }, cards });
    if (v.errors.length) { this.error('相手のカードデータが不正です'); this.netSend({ t: 'relay', data: { k: 'error', msg: 'カードデータが不正なため開始できません: ' + v.errors.slice(0, 3).join(' / ') } }); return this.leave(); }
    const rename = {};
    const defs = {};
    for (const id of new Set(this.myList)) defs[id] = this.store.defs[id];
    const images = {};
    for (const c of cards) {
      let id = c.id;
      const mine = this.store.raw[id];
      const same = mine && JSON.stringify(normalizeDef({ ...mine, image: null })) === JSON.stringify(normalizeDef({ ...c, image: null }));
      if (mine && !same) id = 'opp:' + c.id;
      rename[c.id] = id;
      if (!defs[id]) defs[id] = normalizeDef({ ...c, id }, c.set || 'REMOTE');
      if (d.images && d.images[c.id]) images[id] = d.images[c.id];
    }
    const list = (d.list || []).map((id) => rename[id]).filter(Boolean);
    const errs = validateDeck({ cards: list.reduce((a, id) => ((a[id] = (a[id] || 0) + 1), a), {}) }, defs, null);
    if (errs.length || list.length !== (d.list || []).length) {
      this.netSend({ t: 'relay', data: { k: 'error', msg: 'デッキが不正です: ' + errs.join(' / ') } });
      this.error('相手のデッキが不正です');
      return this.leave();
    }
    this.store.setMatchCards({}, images);
    this.mode = 'match';
    this.statusText = '';
    this.game = new Game({ defs, players: [{ name: this.profile.data.name, deck: this.myList, stops: this.stopsSetting() }, { name: d.name || this.opponentName, deck: list, stops: d.stops }], seed: Math.floor(Math.random() * 2 ** 31) });
    this.pushStatus();
    this.afterChange();
  }

  localAction(action) {
    if (!action) return;
    if (this.mode !== 'match') return;
    if (this.kind === 'online' && this.role === 'guest') {
      this.netSend({ t: 'relay', data: { k: 'action', action } });
      return;
    }
    if (!this.game) return;
    const r = this.game.act(0, action);
    if (!r.ok) this.error(r.error);
    this.afterChange();
  }

  afterChange() {
    if (!this.game) return;
    this.onView(this.game.view(0));
    if (this.kind === 'online' && this.role === 'host') this.netSend({ t: 'relay', data: { k: 'view', view: this.game.view(1) } });
    if (this.kind === 'ai') this.scheduleAI();
  }

  scheduleAI() {
    clearTimeout(this.aiTimer);
    const g = this.game;
    if (!g || g.winner !== null) return;
    const a = chooseAction(g, 1);
    if (!a) return;
    const delay = a.type === 'pass' ? 30 : 700;
    this.aiTimer = setTimeout(() => {
      if (this.game !== g) return;
      const r = g.act(1, a);
      if (!r.ok) { console.error('AI illegal action', a, r.error); g.act(1, { type: 'concede' }); }
      this.afterChange();
    }, delay);
  }

  onView(view) {
    this.lastView = view;
    this.broadcast({ t: 'view', view });
    if (view.winner !== null && !this.rewarded) {
      this.rewarded = true;
      const won = view.winner === view.you;
      const reward = this.profile.reward(this.kind, won);
      this.broadcast({ t: 'matchEnd', won, draw: view.winner === 'draw', reward, gold: this.profile.data.gold });
    }
  }

  opponentGone(msg) {
    if (this.mode === 'match' && !this.rewarded) {
      this.rewarded = true;
      const reward = this.profile.reward(this.kind, true);
      this.broadcast({ t: 'matchEnd', won: true, reason: msg, reward, gold: this.profile.data.gold });
    } else this.error(msg);
    this.reset();
    this.lastView = null;
    this.pushStatus();
  }

  leave() {
    if (this.mode === 'match' && this.game && this.game.winner === null) this.game.act(0, { type: 'concede' });
    if (this.mode === 'match' && this.kind === 'online' && this.role === 'guest' && this.lastView && this.lastView.winner === null) this.netSend({ t: 'relay', data: { k: 'action', action: { type: 'concede' } } });
    if (this.game) this.afterChange();
    if (this.ws) { try { this.netSend({ t: 'leave' }); } catch { /* ignore */ } }
    this.reset();
    this.pushStatus();
  }
}

module.exports = { Session, ALL_STOPS };
