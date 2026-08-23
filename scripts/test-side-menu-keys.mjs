/**
 * 侧栏改版 + 快捷键整合回归（2026-08-19）：
 * - 世界切换按钮用素材库正式图标（world_switch.png），不再 emoji 注入；
 * - 侧栏顺序：技能↔背包对调、世界传送（原组队位）↔组队（队尾）对调；
 * - 快捷键徽标同款同位置：世界传送 O / 队员管理 P / 图鉴让位 U；
 * - 暂停整合进菜单（Esc 开菜单即暂停），P 键不再独立暂停。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const misc = read('src/ui/panels/hud-panels-misc.js');
const inputSrc = read('src/ui/input.js');
const configSrc = read('src/config/config.js');
const menuSrc = read('src/ui/game-menu.js');
const panel = read('src/ui/world-switch-panel.js');
const mainSrc = read('src/main.js');

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

// ---- 1. 图标 ----
check('世界切换按钮用正式图标（world_switch.png，非 emoji）',
    /world_switch\.png/.test(misc) && !/side-menu-emoji/.test(panel));
check('图标文件存在且为 RGBA 透明底', fs.existsSync(path.join(ROOT, 'assets/ui/icons/world_switch.png')));

// ---- 2. 侧栏顺序 ----
const idx = (needle) => misc.indexOf(needle);
check('技能在背包前（对调后）', idx("tab: 'skill'") > idx("tab: 'status'") && idx("tab: 'skill'") < idx("tab: 'equip'"));
check('世界传送在任务后、队员管理前（对调后）',
    idx("WorldSwitchPanel.toggle()") > idx("QuestSystem.toggle()")
    && idx("WorldSwitchPanel.toggle()") < idx("CompanionPanel.toggleManage()"));
check('侧栏按钮携带 worldSwitchBtn id（探针锚点）', /id: 'worldSwitchBtn'/.test(misc));

// ---- 3. 快捷键徽标同款同位置 ----
check('徽标：世界传送 O / 队员 P / 图鉴 U（参考其他栏目 key-hint 位置）',
    /title: '世界传送 \(O\)'.*key: 'O'/.test(misc.replace(/\n/g, ''))
    && /title: '管理队员 \(P\)'.*key: 'P'/.test(misc.replace(/\n/g, ''))
    && /title: '图鉴 \(U\)'.*key: 'U'/.test(misc.replace(/\n/g, '')));

// ---- 4. 键位表与输入链 ----
check('键位表：PARTY=KeyP / WORLD=KeyO / CODEX=KeyU / PAUSE 已移除',
    /PARTY: 'KeyP'/.test(configSrc) && /WORLD: 'KeyO'/.test(configSrc)
    && /CODEX: 'KeyU'/.test(configSrc) && !/PAUSE/.test(configSrc));
check('输入链：P 队员管理 / O 世界传送（守卫+常态双分支）',
    (inputSrc.match(/CONFIG\.KEYS\.PARTY/g) || []).length >= 2
    && (inputSrc.match(/CONFIG\.KEYS\.WORLD/g) || []).length >= 2);
check('P 键独立暂停已拆除', !/KEYS\.PAUSE/.test(inputSrc));

// ---- 5. 菜单=暂停整合 ----
check('打开菜单即暂停（旧循环+定时器+Phaser 三重）',
    /Game\._paused = true/.test(menuSrc) && /TimerManager\.pause\(\)/.test(menuSrc));
check('关闭菜单即恢复', /Game\._paused = false/.test(menuSrc) && /TimerManager\.resume\(\)/.test(menuSrc));

// ---- 6. 面板与主入口解耦 ----
check('面板不再注入侧栏按钮（init 移除）+ 全局挂载保留',
    !/init\(\) \{/.test(panel) && /window\.WorldSwitchPanel = WorldSwitchPanel/.test(mainSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
