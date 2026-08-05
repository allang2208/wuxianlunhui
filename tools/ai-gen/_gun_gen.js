// 枪械图标批量生成调度（4 并发，文件存在即视为成功——ComfyUI 客户端超时后图仍会落盘）
// 用法: node tools/ai-gen/_gun_gen.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROMPT_DIR = 'Y:\\工作\\无尽轮回\\scratch\\craft-icons\\prompts\\gun';
const RAW_DIR = 'Y:\\工作\\无尽轮回\\scratch\\craft-icons\\raw';
const SEED_BASE = 900001;
const CONCURRENCY = 4;

const keys = fs.readdirSync(PROMPT_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.slice(0, -4))
  .sort();

function existsOk(file) {
  try {
    return fs.existsSync(file) && fs.statSync(file).size > 10 * 1024;
  } catch {
    return false;
  }
}

function runOne(key, seed, attempt) {
  return new Promise((resolve) => {
    const out = path.join(RAW_DIR, `${key}.png`);
    const args = [
      'tools\\ai-gen\\comfyui-gen.py', '--host', '192.168.3.142',
      '--model', 'flux2-dev-fp8',
      '--prompt-file', path.join(PROMPT_DIR, `${key}.txt`),
      '--seed', String(seed),
      '--out', out,
      '--timeout', '420',
    ];
    const t0 = Date.now();
    const child = spawn('python', args, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    child.on('close', (code) => {
      const ok = existsOk(out);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (ok) {
        console.log(`[OK] ${key} (${secs}s, code=${code})`);
        resolve({ key, status: 'ok', attempt });
      } else {
        console.log(`[FAIL] ${key} code=${code} exists=${fs.existsSync(out)} (${secs}s)`);
        console.log(log.split('\n').slice(-6).join('\n'));
        resolve({ key, status: 'fail', attempt });
      }
    });
    child.on('error', (e) => {
      console.log(`[ERR] ${key}: ${e.message}`);
      resolve({ key, status: 'fail', attempt });
    });
  });
}

(async () => {
  const raw = fs.existsSync(RAW_DIR) ? fs.readdirSync(RAW_DIR) : [];
  const done = new Set();
  for (const f of raw) if (f.endsWith('.png') && existsOk(path.join(RAW_DIR, f))) done.add(f.slice(0, -4));
  const queue = keys.filter((k) => !done.has(k));
  let idx = 0;
  console.log(`total=${keys.length} done=${done.size} todo=${queue.length} start=${new Date().toISOString()}`);
  const results = [];
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    const outs = await Promise.all(batch.map((key) => runOne(key, SEED_BASE + idx++, 0)));
    for (const r of outs) {
      if (r.status !== 'ok') {
        const r2 = await runOne(r.key, SEED_BASE + idx++, 1);
        results.push(r2);
      } else {
        results.push(r);
      }
    }
    console.log(`progress: ${results.length}/${keys.length} ${new Date().toISOString()}`);
  }
  const fails = results.filter((r) => r.status !== 'ok');
  console.log(`DONE total=${results.length} fails=${fails.length} ${new Date().toISOString()}`);
  if (fails.length) console.log('FAILED:', fails.map((f) => f.key).join(', '));
})();
