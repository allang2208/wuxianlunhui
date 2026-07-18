// registry 三角同步检查：data/craft-config.json 中的每个改造效果键，
// 必须同时被 ①craft-effect-registry 注册 ②战斗代码消费。
// 聚合端自 v3.2 起由 craft-effects.js 按 registry 的 applyMode 驱动（收集≡注册，
// 不再人工收集），本脚本相应检查：聚合器确为 registry 驱动 + 配置键全部注册 +
// 配置键全部有消费端 + registry 条目结构完整（applyMode 合法且有 display）。
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

// ② 聚合端：craft-effects.js 必须为 registry 驱动（收集≡注册，无需逐键核对）
const aggregatorSrc = read('src/ui/craft/craft-effects.js');
const aggregatorIsRegistryDriven =
    aggregatorSrc.includes('CRAFT_EFFECT_REGISTRY') && aggregatorSrc.includes('applyMode');

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

// ⑤ registry 条目结构：applyMode 合法 + display 为函数
const VALID_APPLY_MODES = new Set(['add', 'multiply', 'override', 'flag']);
const badEntries = [];
for (const key of registeredKeys) {
    const blockMatch = registrySrc.match(new RegExp(`^    ${key}: \\{([\\s\\S]*?)^    \\}`, 'm'));
    const block = blockMatch ? blockMatch[1] : '';
    const modeMatch = block.match(/applyMode:\s*'(\w+)'/);
    if (!modeMatch || !VALID_APPLY_MODES.has(modeMatch[1])) badEntries.push(`${key}（applyMode 缺失/非法）`);
    if (!/display:\s*\(/.test(block)) badEntries.push(`${key}（display 缺失）`);
}

let fail = 0;
const report = (title, keys) => {
    if (keys.length === 0) return;
    fail += keys.length;
    console.log(`\n✗ ${title}（${keys.length}）:`);
    keys.forEach(k => console.log(`  - ${k}`));
};

const allKeys = [...configKeys];
if (!aggregatorIsRegistryDriven) {
    fail += 1;
    console.log('\n✗ 聚合器未按 registry 驱动（craft-effects.js 缺 CRAFT_EFFECT_REGISTRY/applyMode 引用）');
}
report('配置存在但未注册（registry 缺定义）', allKeys.filter(k => !registeredKeys.has(k)));
report('配置存在但无消费端（战斗代码未引用）', allKeys.filter(k => !consumedKeys.has(k)));
report('registry 条目结构不完整', badEntries);

console.log(`\n配置效果键 ${configKeys.size} 个 | 注册 ${registeredKeys.size} | 聚合 registry 驱动${aggregatorIsRegistryDriven ? '✓' : '✗'} | 消费 ${consumedKeys.size}`);
if (fail === 0) {
    console.log('✓ registry 三角同步检查全部通过');
} else {
    console.log(`✗ 共 ${fail} 项不同步`);
    process.exit(1);
}
