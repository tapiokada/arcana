'use strict';
// マナコストの解析と支払い計画

const COLORS = ['W', 'U', 'B', 'R', 'G'];
const MANA_TYPES = ['W', 'U', 'B', 'R', 'G', 'C'];

function emptyPool() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

/** "{2}{R}{R}" → { generic:2, W:0, U:0, B:0, R:2, G:0, C:0 } */
function parseManaCost(str) {
  const cost = { generic: 0, ...emptyPool() };
  if (!str) return cost;
  const re = /\{([^}]+)\}/g;
  let m;
  const rest = String(str).replace(re, '').trim();
  if (rest) throw new Error(`マナコストの書式が不正です: "${str}"`);
  while ((m = re.exec(str))) {
    const s = m[1].toUpperCase();
    if (/^\d+$/.test(s)) cost.generic += Number(s);
    else if (MANA_TYPES.includes(s)) cost[s]++;
    else throw new Error(`不明なマナ記号です: {${s}}`);
  }
  return cost;
}

function manaValue(cost) {
  return cost.generic + MANA_TYPES.reduce((a, c) => a + cost[c], 0);
}

function costColors(cost) {
  return COLORS.filter((c) => cost[c] > 0);
}

/**
 * 起動コストの解析。例: "{2}{R},{T}" / "{T}" / "{1},sacrifice" / "{B},life:2"
 */
function parseActivationCost(str) {
  const s = String(str || '');
  const tap = /\{T\}/i.test(s);
  const sacrifice = /sacrifice|\{SAC\}/i.test(s);
  const lifeM = s.match(/life:(\d+)/i);
  const manaStr = (s.replace(/\{T\}/gi, '').replace(/\{SAC\}/gi, '').match(/\{[^}]+\}/g) || []).join('');
  return { tap, sacrifice, life: lifeM ? Number(lifeM[1]) : 0, mana: parseManaCost(manaStr) };
}

function expandColors(produce) {
  const list = Array.isArray(produce) ? produce : [produce];
  const out = new Set();
  for (const p of list) {
    if (p === 'any') COLORS.forEach((c) => out.add(c));
    else out.add(String(p).toUpperCase());
  }
  return [...out];
}

/**
 * 支払い計画を立てる。
 * pool: 現在のマナ・プール / sources: [{id, colors:[...]}] (1つにつき1マナ)
 * 戻り値: { fromPool:{...}, taps:[{id,color}] } または null
 */
function planPayment(cost, pool, sources) {
  const p = { ...pool };
  const fromPool = emptyPool();
  const need = [];
  for (const c of MANA_TYPES) {
    let n = cost[c] || 0;
    const use = Math.min(n, p[c]);
    p[c] -= use;
    fromPool[c] += use;
    n -= use;
    for (let i = 0; i < n; i++) need.push(c);
  }
  // 事前チェック（色ごとの供給数）
  for (const c of MANA_TYPES) {
    const n = need.filter((x) => x === c).length;
    if (n && sources.filter((s) => s.colors.includes(c)).length < n) return null;
  }
  const srcs = sources.slice().sort((a, b) => a.colors.length - b.colors.length);
  const used = new Array(srcs.length).fill(null);
  let steps = 0;
  const bt = (i) => {
    if (i === need.length) return true;
    if (++steps > 20000) return false;
    for (let j = 0; j < srcs.length; j++) {
      if (used[j] === null && srcs[j].colors.includes(need[i])) {
        used[j] = need[i];
        if (bt(i + 1)) return true;
        used[j] = null;
      }
    }
    return false;
  };
  if (!bt(0)) return null;
  let g = cost.generic || 0;
  for (const c of ['C', ...COLORS]) {
    const use = Math.min(g, p[c]);
    p[c] -= use;
    fromPool[c] += use;
    g -= use;
  }
  for (let j = srcs.length - 1; j >= 0 && g > 0; j--) {
    if (used[j] === null) {
      used[j] = srcs[j].colors[0];
      g--;
    }
  }
  if (g > 0) return null;
  const taps = [];
  srcs.forEach((s, j) => used[j] !== null && taps.push({ id: s.id, color: used[j] }));
  return { fromPool, taps };
}

function costToString(cost) {
  let s = cost.generic ? `{${cost.generic}}` : '';
  for (const c of MANA_TYPES) s += `{${c}}`.repeat(cost[c] || 0);
  return s;
}

module.exports = {
  COLORS, MANA_TYPES, emptyPool, parseManaCost, manaValue, costColors,
  parseActivationCost, expandColors, planPayment, costToString,
};
