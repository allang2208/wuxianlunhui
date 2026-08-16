#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9399;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-diag-'));
console.log('edge exists:', fs.existsSync(EDGE));
const args = process.argv[2] ? process.argv[2].split(' ') : ['--headless=new'];
const edge = spawn(EDGE, [...args, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
edge.on('error', (e) => console.log('spawn error:', e.message));
edge.on('exit', (code, sig) => console.log('edge exit:', code, sig));
await new Promise(r => setTimeout(r, 8000));
console.log('edge alive:', edge.exitCode === null);
try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    console.log('cdp version status:', r.status);
    console.log('body:', (await r.text()).slice(0, 200));
} catch (e) {
    console.log('cdp fetch fail:', e.message);
}
try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    console.log('list:', (await r.text()).slice(0, 300));
} catch (e) {
    console.log('list fetch fail:', e.message);
}
try { edge.kill('SIGKILL'); } catch {}
await new Promise(r => setTimeout(r, 800));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
