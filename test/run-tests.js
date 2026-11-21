// テスト一式: エンジン・シミュレーション / インポート検証 / オンライン対戦
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  console.log('[1] AI同士の対戦シミュレーション');
  console.log(execFileSync('node', [path.join(__dirname, 'sim.js'), '300']).toString().trim());

  console.log('[2] インポート検証');
  const { validateSet } = require('../engine/cards');
  const bad = validateSet({ format: 'arcana-set/1', set: { code: 'X1', name: 'x' }, cards: [{ id: 'a', name: 'a', types: ['Creature'], cost: '{Q}' }] });
  if (bad.errors.length < 2) throw new Error('validation should fail');
  console.log('  不正データ検出 OK:', bad.errors.join(' | '));

  console.log('[3] オンライン対戦（中継サーバー + アプリ2台）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcana-'));
  const procs = [
    spawn('node', [path.join(ROOT, 'server/relay.js'), '17700']),
    spawn('node', [path.join(ROOT, 'app/main.js'), '--port', '13101', '--no-open', '--data', path.join(tmp, 'a')]),
    spawn('node', [path.join(ROOT, 'app/main.js'), '--port', '13102', '--no-open', '--data', path.join(tmp, 'b')]),
  ];
  try {
    await sleep(1200);
    for (const port of [13101, 13102]) await fetch(`http://localhost:${port}/api/profile`, { method: 'POST', body: JSON.stringify({ settings: { serverUrl: 'ws://localhost:17700' } }) });
    const r = await require('./online')(13101, 13102);
    console.log('  結果:', JSON.stringify(r));
    if (r.imageStatusOnGuest !== 200) throw new Error('image not served');
    console.log('ALL TESTS PASSED');
  } finally {
    procs.forEach((p) => p.kill());
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
