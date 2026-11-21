'use strict';
// カードセットの読み込み・インポート・画像提供
const fs = require('fs');
const path = require('path');
const { normalizeDef, validateSet } = require('../../engine/cards');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function safeRel(p) {
  const n = path.posix.normalize(String(p).replace(/\\/g, '/'));
  if (n.startsWith('..') || path.posix.isAbsolute(n) || n.includes('\0')) throw new Error(`不正なパス: ${p}`);
  return n;
}

class CardStore {
  constructor(builtinDir, userDir) {
    this.builtinDir = builtinDir;
    this.userDir = userDir;
    fs.mkdirSync(userDir, { recursive: true });
    this.reload();
    this.matchDefs = {}; // 対戦相手から受信したカード（対戦中のみ）
    this.matchImages = {};
  }

  reload() {
    this.sets = [];
    this.defs = {};
    this.raw = {};
    this.images = {};
    this.loadErrors = [];
    const dirs = [];
    for (const base of [this.builtinDir, this.userDir]) {
      if (!fs.existsSync(base)) continue;
      for (const name of fs.readdirSync(base)) {
        const dir = path.join(base, name);
        if (fs.existsSync(path.join(dir, 'set.json'))) dirs.push({ dir, builtin: base === this.builtinDir });
      }
    }
    for (const { dir, builtin } of dirs) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'set.json'), 'utf8'));
        const { errors, warnings } = validateSet(json, (f) => fs.existsSync(path.join(dir, safeRel(f))));
        if (errors.length) { this.loadErrors.push({ dir, errors }); continue; }
        if (this.sets.some((s) => s.code === json.set.code)) { this.loadErrors.push({ dir, errors: [`セットコード重複: ${json.set.code}`] }); continue; }
        const dup = json.cards.find((c) => this.defs[c.id]);
        if (dup) { this.loadErrors.push({ dir, errors: [`カードID重複: ${dup.id}`] }); continue; }
        for (const c of json.cards) {
          this.defs[c.id] = normalizeDef(c, json.set.code);
          this.raw[c.id] = c;
          if (c.image) this.images[c.id] = c.image.startsWith('data:') ? c.image : path.join(dir, safeRel(c.image));
        }
        this.sets.push({ ...json.set, dir, builtin, cardCount: json.cards.length, warnings });
      } catch (e) {
        this.loadErrors.push({ dir, errors: [e.message] });
      }
    }
  }

  /**
   * インポート: setJson（オブジェクトまたは文字列）と files { 相対パス: dataURL }
   */
  importSet(setJson, files = {}) {
    const json = typeof setJson === 'string' ? JSON.parse(setJson) : setJson;
    const fileMap = {};
    for (const [k, v] of Object.entries(files)) fileMap[safeRel(k)] = v;
    // フォルダごと選択された場合は set.json の位置を基準にする
    const { errors, warnings } = validateSet(json, (f) => !!fileMap[safeRel(f)]);
    if (errors.length) return { ok: false, errors, warnings };
    const existing = this.sets.find((s) => s.code === json.set.code);
    if (existing && existing.builtin) return { ok: false, errors: [`同梱セットと同じコードです: ${json.set.code}`] };
    const others = Object.values(this.defs).filter((d) => d.set !== json.set.code);
    const dup = json.cards.find((c) => others.some((d) => d.id === c.id));
    if (dup) return { ok: false, errors: [`他のセットとカードIDが重複しています: ${dup.id}`] };
    const dir = path.join(this.userDir, json.set.code);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const c of json.cards) {
      if (!c.image || c.image.startsWith('data:')) continue;
      const rel = safeRel(c.image);
      const m = /^data:([^;]+);base64,(.*)$/s.exec(fileMap[rel]);
      if (!m) return { ok: false, errors: [`画像データが不正です: ${rel}`] };
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_IMAGE_BYTES) return { ok: false, errors: [`画像が大きすぎます（2MBまで）: ${rel}`] };
      if (!MIME[path.extname(rel).toLowerCase()]) return { ok: false, errors: [`未対応の画像形式です: ${rel}`] };
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), buf);
    }
    fs.writeFileSync(path.join(dir, 'set.json'), JSON.stringify(json, null, 2));
    this.reload();
    return { ok: true, warnings, set: json.set, cardCount: json.cards.length };
  }

  deleteSet(code) {
    const s = this.sets.find((x) => x.code === code);
    if (!s) return { ok: false, errors: ['セットが見つかりません'] };
    if (s.builtin) return { ok: false, errors: ['同梱セットは削除できません'] };
    fs.rmSync(s.dir, { recursive: true, force: true });
    this.reload();
    return { ok: true };
  }

  /** 画像を { mime, data(Buffer) } で返す */
  image(defId) {
    let src = this.matchImages[defId] || this.images[defId];
    if (!src && defId.startsWith('opp:')) src = this.images[defId.slice(4)];
    if (!src) return null;
    if (src.startsWith('data:')) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
      return m ? { mime: m[1], data: Buffer.from(m[2], 'base64') } : null;
    }
    if (!fs.existsSync(src)) return null;
    return { mime: MIME[path.extname(src).toLowerCase()] || 'application/octet-stream', data: fs.readFileSync(src) };
  }

  imageDataUrl(defId) {
    const img = this.image(defId);
    return img ? `data:${img.mime};base64,${img.data.toString('base64')}` : null;
  }

  /** 対戦相手に送るデッキ・パッケージ（カード定義＋画像） */
  deckPackage(defIds) {
    const uniq = [...new Set(defIds)];
    const raw = uniq.map((id) => this.raw[id]);
    const images = {};
    for (const id of uniq) { const u = this.imageDataUrl(id); if (u) images[id] = u; }
    return { cards: raw.map((r) => ({ ...r, image: null, set: this.defs[r.id].set })), images };
  }

  setMatchCards(defs, images) {
    this.matchDefs = defs || {};
    this.matchImages = images || {};
  }
}

module.exports = { CardStore };
