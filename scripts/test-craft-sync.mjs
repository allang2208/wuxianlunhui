// registry 三角同步检查：data/craft-config.json 中的每个改造效果键，
// 必须同时被 ①_applyModEffects 收集 ②craft-effect-registry 注册 ③战斗代码消费。
// 防"注册未生产/生产未注册/注册未消费"漂移（历史案例：穿甲/后坐/移速改造失效）。
// 用法：node scripts/test-craft-sync.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ① 配置端：craft-config.json 全部效果键
const craftConfig = JSON.parse(read('data/craft-config.json'));
const configKeys = new Set();
function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
        if (node.effects && typeof node.effects === 'object') {
            for (const k of Object.keys(node.effects)) configKeys.add(k);
        }
        for (const v of Object.values(node)) walk(v);
    }
}
walk(craftConfig);

// ② 收集端：_applyModEffects 的 opt.effects.X 收集
const craftSrc = read('src/ui/craft-system.js');
const collectedKeys = new Set([...craftSrc.matchAll(/opt\.effects\.(\w+)/g)].map(m => m[1]));

// ③ 注册端：craft-effect-registry.js 顶层键
const registrySrc = read('src/config/craft-effect-registry.js');
const registeredKeys = new Set([...registrySrc.matchAll(/^    (\w+): \{/gm)].map(m => m[1]));

// ④ 消费端：战斗代码中的 _craftEffects.X / ce.X 引用
const consumerFiles = [
    'src/combat', 'src/entities', 'src/systems', 'src/config',
].flatMap(d => fs.readdirSync(path.join(ROOT, d), { recursive: true })
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(d, f)));
const consumerSrc = consumerFiles.map(f => {
    try { return read(f); } catch { return ''; }
}).join('\n');
const consumedKeys = new Set();
for (const k of configKeys) {
    const patterns = [
        new RegExp(`_craftEffects\\.${k}\\b`),
        new RegExp(`\\bce\\.${k}\\b`),
        new RegExp(`craftEffects\\.${k}\\b`),
    ];
    if (patterns.some(p => p.test(consumerSrc))) consumedKeys.add(k);
}

let fail = 0;
const report = (title, keys) => {
    if (keys.length === 0) return;
    fail += keys.length;
    console.log(`\n✗ ${title}（${keys.length}）:`);
    keys.forEach(k => console.log(`  - ${k}`));
};

const allKeys = [...configKeys];
report('配置存在但未注册（registry 缺定义）', allKeys.filter(k => !registeredKeys.has(k)));
report('配置存在但未收集（_applyModEffects 漏收）', allKeys.filter(k => !collectedKeys.has(k)));
report('配置存在但无消费端（战斗代码未引用）', allKeys.filter(k => !consumedKeys.has(k)));

console.log(`\n配置效果键 ${configKeys.size} 个 | 注册 ${registeredKeys.size} | 收集 ${collectedKeys.size} | 消费 ${consumedKeys.size}`);
if (fail === 0) {
    console.log('✓ registry 三角同步检查全部通过');
} else {
    console.log(`✗ 共 ${fail} 项不同步`);
    process.exit(1);
}
