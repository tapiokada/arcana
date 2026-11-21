// スターターセットの絵柄（SVG）を自動生成する
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'sets', 'starter');
const set = JSON.parse(fs.readFileSync(path.join(dir, 'set.json'), 'utf8'));
const PAL = { W: ['#fff6d5', '#d9c37a'], U: ['#bfe3ff', '#2b6cb0'], B: ['#b9a8c9', '#2d1f3d'], R: ['#ffc2a1', '#b8321b'], G: ['#c9f2c0', '#2f7a34'], C: ['#e2e6ea', '#7b8794'] };
const LAND = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
for (const c of set.cards) {
  const cols = (c.cost || '').match(/[WUBRG]/g) || (c.subtypes || []).map((s) => LAND[s]).filter(Boolean);
  const col = cols[0] || 'C';
  const [a, b] = PAL[col];
  const h = hash(c.id);
  const shapes = [];
  for (let i = 0; i < 7; i++) {
    const x = (h >> i) % 300, y = ((h >> (i + 3)) % 180) + 20, r = 15 + ((h >> (i + 5)) % 50);
    shapes.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? a : b}" opacity="0.35"/>`);
  }
  const t = c.types || [];
  const glyph = t.includes('Land') ? '<path d="M0 220 L80 120 L140 170 L210 90 L300 220 Z" fill="#0004"/>'
    : t.includes('Creature') ? '<path d="M150 50 C200 50 220 110 200 150 L230 220 L70 220 L100 150 C80 110 100 50 150 50 Z" fill="#0005"/>'
    : t.includes('Artifact') ? '<rect x="105" y="70" width="90" height="110" rx="10" fill="#0005" transform="rotate(15 150 125)"/>'
    : t.includes('Enchantment') ? '<circle cx="150" cy="120" r="60" fill="none" stroke="#fff8" stroke-width="10"/>'
    : '<path d="M150 30 L175 110 L260 120 L180 150 L200 220 L150 175 L100 220 L120 150 L40 120 L125 110 Z" fill="#fff7"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 220"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="300" height="220" fill="url(#g)"/>${shapes.join('')}${glyph}</svg>`;
  fs.writeFileSync(path.join(dir, c.image), svg);
}
console.log('generated', set.cards.length, 'images');
