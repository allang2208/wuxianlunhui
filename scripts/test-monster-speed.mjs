/**
 * 全局怪物移速 -25% 契约测试（2026-08-15）
 *
 * 规则：Enemy 构造器对 speed>0 的怪应用 enemyDefaults.globalSpeedMultiplier（0.75），
 * 站桩怪（speed=0）天然排除；冲锋/扑击等攻击位移不在本链路。
 *
 * 说明：enemy.js 依赖链含 Phaser/循环依赖，node 直接 import 不可行（已在 CDP 实机探针
 * 覆盖真实构造行为）；本测试锁定数据契约 + enemy.js 源码接线，防止配置/接线被改没。
 *
 * 用法：node scripts/test-monster-speed.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: combatCfg } = await import('../data/combat-config.json');
const { default: enemyCfg } = await import('../data/enemy-config.json');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '：' + detail : ''}`); }
    else { fail++; console.error(`  ✗ ${name}${detail ? '：' + detail : ''}`); }
}

// 1. 倍率配置存在且为 0.75
const mul = combatCfg.enemyDefaults && combatCfg.enemyDefaults.globalSpeedMultiplier;
check('enemyDefaults.globalSpeedMultiplier = 0.75', mul === 0.75, `实际 ${mul}`);

// 2. 全量怪物配置：speed 合法（0=站桩 或 >=1 正数），站桩清单不意外扩大
const stationary = [];
let badSpeed = [];
for (const [k, v] of Object.entries(enemyCfg)) {
    if (!v || typeof v !== 'object' || !('speed' in v)) continue;
    const s = v.speed;
    if (s === 0) stationary.push(k);
    else if (!(typeof s === 'number' && (s >= 1 || s === 0))) badSpeed.push(`${k}=${s}`);
}
check('speed 值全部合法（0=站桩 / >=1）', badSpeed.length === 0, badSpeed.join(','));
check(
    '站桩怪清单 = 矿洞/墓碑/煮锅/集合体',
    JSON.stringify([...stationary].sort()) === JSON.stringify(['amalgamZombie', 'cauldron', 'mineCave', 'tombstone']),
    stationary.join(','),
);

// 3. 减速后期望值抽查（构造器公式：speed>0 → round(speed×0.75×100)/100）
const expected = (s) => Math.round(s * 0.75 * 100) / 100;
check('zombieDog 250 → 187.5', expected(enemyCfg.zombieDog.speed) === 187.5);
check('timeAgentAssault 160 → 120', expected(enemyCfg.timeAgentAssault.speed) === 120);

// 4. enemy.js 源码接线：倍率读取 / speed>0 守卫 / this.config 浅拷贝同步（time-agent 运行时回读路径）
const src = fs.readFileSync(path.join(ROOT, 'src/entities/enemy.js'), 'utf-8');
check('enemy.js 读取 globalSpeedMultiplier', /globalSpeedMultiplier/.test(src));
check('enemy.js 有 speed>0 守卫（站桩排除）', /globalSpeedMul[\s\S]{0,200}this\.speed > 0/.test(src));
check('enemy.js 浅拷贝 config 同步缩放（time-agent 路径）', /config = \{ \.\.\.config, speed: this\.speed \}/.test(src));
check('enemy.js 未污染共享单例（浅拷贝后才写回 this.config）', /this\.config = config;[\s\S]{0,80}?\}/.test(src));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
