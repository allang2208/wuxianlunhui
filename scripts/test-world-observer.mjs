/**
 * 观察模式 + 指挥模式 RTS 化回归（2026-08-19）：
 * - 世界切换面板切世界 = 仅相机跳转（观察模式不生成玩家、自动进指挥模式）；
 * - 玩家坐标按世界记忆，返回本体原位恢复；
 * - 指挥模式 RTS 化：边缘平移 / 双击同类复选 / Ctrl+数字编队 / Shift 加编 / 数字选中；
 * - 中键轮盘统一：指挥模式下指令下达全部选中单位（队友视同仓鼠友军）；
 * - 观察模式守卫：仓鼠不跟随不在场玩家、出兵集结点回建筑自身。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sceneMgr = read('src/world/scene-manager.js');
const gameSrc = read('src/game.js');
const gsSrc = read('src/phaser/scenes/GameScene.js');
const panel = read('src/ui/world-switch-panel.js');
const rts = read('src/ui/rts-command.js');
const wheel = read('src/ui/companion-command-wheel.js');
const inputSrc = read('src/ui/input.js');

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

// ---- 1. 观察模式核心 ----
check('switchScene 支持 opts.observer 并维护观察状态机',
    /switchScene\(sceneId, player, mode, opts = \{\}\)/.test(sceneMgr)
    && /opts\.observer/.test(sceneMgr)
    && /_observerHomeScene = this\.currentScene/.test(sceneMgr));
check('离场按世界记忆玩家坐标（_worldPlayerPos）',
    /_worldPlayerPos\[this\.currentScene\] = \{ x: player\.x, y: player\.y \}/.test(sceneMgr));
check('122 观察模式不生成玩家、相机落基地中心',
    /if \(player && !Game\._observerMode\)/.test(sceneMgr)
    && /Camera\.x = DEFENSE_CONFIG\.base\.x/.test(sceneMgr));
check('122 正常进入按坐标记忆原位恢复',
    /Game\._worldPlayerPos\.scene8/.test(sceneMgr));
check('123/124 观察模式不生成玩家（两处分支）',
    (sceneMgr.match(/else if \(Game\._observerMode\)/g) || []).length >= 3);
check('Game 声明观察模式状态', /_observerMode: false/.test(gameSrc)
    && /_observerHomeScene: null/.test(gameSrc) && /_worldPlayerPos: \{\}/.test(gameSrc));
check('观察/指挥模式相机不跟随玩家（game.js + GameScene 双卡口）',
    /this\._observerMode \|\| \(RTSCommand && RTSCommand\.enabled\)/.test(gameSrc)
    && /RTSCommand\.enabled\)\) \{/.test(gsSrc));

// ---- 2. 世界切换面板 = 相机跳转 + 自动指挥模式 ----
check('面板 _travel：非本体世界 → observer + 自动进指挥模式',
    /const observer = target !== home/.test(panel)
    && /RTSCommand\.setEnabled\(observer\)/.test(panel));
check('面板标记本体所在世界并给返回入口',
    /_observerHomeScene/.test(panel) && /返回本体/.test(panel) && /ws-home-badge/.test(panel));

// ---- 3. 指挥模式 RTS 化 ----
check('指挥模式可用域 = 122 或观察模式', /sceneId === 'scene8' \|\| observer/.test(rts));
check('边缘平移（四缘 24px / 900px/s / dt 缩放 / 世界边界钳制）',
    /_edgePan\(dt/.test(rts) && /EDGE = 24/.test(rts) && /Camera\.x = Math\.max\(0, Math\.min\(W/.test(rts));
check('双击同类复选（350ms 同窗 + 屏幕内同类型全选）',
    /_lastClick\.at <= 350/.test(rts) && /_selectSameTypeOnScreen/.test(rts) && /_unitTypeKey/.test(rts));
check('编队：Ctrl 编 / Shift 加 / 数字选中（capture 先于快捷栏）',
    /keydown.*true\)/.test(rts) && /\^Digit\(\[0-9\]\)/.test(rts)
    && /ctrlKey \|\| e\.metaKey/.test(rts) && /_groups\.set\(d/.test(rts));
check('退出指挥模式镜头回归玩家（观察模式除外）',
    /Camera\.follow\(g\.player\)/.test(rts));
check('快捷栏数字键在指挥模式让位', /_rtsDigits/.test(inputSrc)
    && /!_rtsDigits && \(code === CONFIG\.KEYS\.ITEM_1/.test(inputSrc));

// ---- 4. 中键轮盘统一 ----
check('轮盘在指挥模式有选中单位即可开（不再只限队友）',
    /hasAllySelection\(\)/.test(wheel) && /!rtsActive &&/.test(wheel));
check('轮盘打开使用解析后的目标数量，不再把 RTS 的空 targetIds 误判为无目标',
    /const targetCount = this\._resolveTargets\(false\)/.test(wheel)
    && /if \(!targetCount\) return/.test(wheel)
    && /return n;/.test(wheel));
check('轮盘指挥模式走统一出口 issueWheelCommand',
    /RTSCommand\.issueWheelCommand\(cmd\.id, this\._worldPoint\)/.test(wheel));
check('统一出口：队友 PartySystem + 非成员直写 _command + 模式映射',
    /issueWheelCommand\(mode, point\)/.test(rts)
    && /PartySystem\.setCommand\(memberIds, mode, point\)/.test(rts)
    && /_mapWheelModeForUnit/.test(rts)
    && /mode === 'gather'\) return u\._isHamsterMiner/.test(rts));

// ---- 5. 观察模式守卫 ----
check('仓鼠单位观察模式不跟随不在场玩家（8 实体）',
    ['warrior', 'guard', 'militia', 'shooter', 'scout', 'musketeer', 'miner', 'priest']
        .every((k) => /!game\._observerMode/.test(read(`src/entities/hamster-${k}.js`))));
check('出兵集结点观察模式兜底回建筑自身（兵营/矿场/产兵）',
    ['hamster-barracks-system.js', 'hamster-hut-system.js', 'producer-building-system.js']
        .every((f) => /Game\._observerMode \? \{ x: this\.x, y: this\.y \}/.test(read(`src/world/${f}`))));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
