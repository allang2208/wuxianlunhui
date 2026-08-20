/**
 * 世界-122 指挥模式回归：
 * - 矿工移动/待命命令；
 * - 指挥与建筑模式互斥；
 * - 离场清理跨场景命令；
 * - 直接仓鼠单位移动命令立即打断攻击；
 * - 身体矩形选中与面板真实数据源。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRtsMoveDestination } from '../src/ai/rts-command-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

const rtsSrc = fs.readFileSync(path.join(ROOT, 'src/ui/rts-command.js'), 'utf8');
const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8');
const minerAiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-miner-ai.js'), 'utf8');
const minerEntitySrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-miner.js'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-guard-ai.js'), 'utf8');
const militiaSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-militia-ai.js'), 'utf8');
const shooterSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-shooter-ai.js'), 'utf8');
const scoutSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-scout-ai.js'), 'utf8');
const warriorSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-warrior-ai.js'), 'utf8');
const musketeerSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-musketeer-ai.js'), 'utf8');
const priestSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-priest-ai.js'), 'utf8');
const knightSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-knight-ai.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');
const wheelSrc = fs.readFileSync(path.join(ROOT, 'src/ui/companion-command-wheel.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');

check('指挥模式启用时关闭建筑界面',
    /setEnabled\(on\)[\s\S]{0,120}if \(on\) this\._closeBuildingUI\(\)/.test(rtsSrc));
check('建筑模式开启时关闭指挥模式',
    /Game\.RTSCommand && Game\.RTSCommand\.enabled[\s\S]{0,80}setEnabled\(false\)/.test(buildingSrc));
check('RTS 鼠标过滤建筑面板',
    /wall-editor-panel/.test(rtsSrc)
    && /world-switch-panel/.test(rtsSrc)
    && /producer-building-panel/.test(rtsSrc));
check('掩体详情走 BuildingSystem.open，不再手动 active+裸建面板',
    /if \(!bs\.active && typeof bs\.open === 'function'\) bs\.open\(\)/.test(rtsSrc)
    && !/bs\.active = true/.test(rtsSrc));
check('离开任一持久世界时重置全队命令/目标/路径',
    /leavingWorld[\s\S]{0,180}_resetPartyCommandsForSceneExit/.test(rtsSrc)
    && /PartySystem\.setCommand\('all', 'follow'\)/.test(rtsSrc)
    && /m\._pathManager\._clearPath\(\)/.test(rtsSrc));
check('矿工 AI 每帧优先消费非 follow 指令',
    /const cmd = m\._command[\s\S]{0,160}this\._applyCommand\(cmd\)/.test(minerAiSrc));
check('移动/待命下发前取消直接单位攻击动作',
    /u\._ai\.cancelForCommand\(\)/.test(rtsSrc));
check('四类攻击仓鼠均提供 cancelForCommand',
    [guardSrc, militiaSrc, shooterSrc, scoutSrc].every((s) => /cancelForCommand\(\)/.test(s)));
check('矿工攻击命令降级为 hold',
    /mode === 'attack' && u\._rtsCanAttack === false[\s\S]{0,180}mode: 'hold'/.test(rtsSrc));
check('矿工声明不可执行攻击指令', /this\._rtsCanAttack = false/.test(minerEntitySrc));
check('矿工 move 设置战术目标并进入 walk',
    /if \(cmd\.mode === 'move'\)[\s\S]{0,520}m\._tacticalTarget = dest[\s\S]{0,120}m\._animState = 'walk'/.test(minerAiSrc));
check('矿工 hold/attack 清目标并站定',
    /m\._tacticalTarget = null[\s\S]{0,180}m\._animState = 'idle'[\s\S]{0,100}m\.maxSpeed = 0/.test(minerAiSrc));
check('点击与框选使用身体屏幕矩形',
    /_unitScreenRect\(e\)/.test(rtsSrc)
    && /r\.x1 >= x0 && r\.x0 <= x1/.test(rtsSrc)
    && /const visualY = e\.y - \(Number\(e\.z\) \|\| 0\)/.test(rtsSrc));
check('属性面板攻击读取运行时AI/aiConfig',
    /e\._ai\._attackDamage/.test(rtsSrc)
    && /e\.aiConfig\.attackDamage/.test(rtsSrc));
check('属性面板移速优先读取配置速度',
    /e\.aiConfig\?\.walkSpeed/.test(rtsSrc));
check('右键攻击仅在实际下达攻击后触发目标红白闪现',
    /const attackers = this\._issueCommandToAllies\('attack', null, hit\.ref\)/.test(rtsSrc)
    && /if \(attackers > 0\) \{[\s\S]{0,100}this\._flashAttackTarget\(hit\.ref\)/.test(rtsSrc)
    && /target\._rtsAttackFlashUntil = now \+ 720/.test(rtsSrc));
check('GameScene逐帧把攻击指令反馈渲染为红白交替贴图',
    /e\._rtsAttackFlashUntil/.test(gameSceneSrc)
    && /elapsed \/ 90/.test(gameSceneSrc)
    && /0xff3030 : 0xffffff/.test(gameSceneSrc));
check('RTS 自己捕获右键并在 tick 中消费',
    /_pendingRightClick = \{ x: e\.clientX, y: e\.clientY \}/.test(rtsSrc)
    && /const pendingRightClick = this\._pendingRightClick/.test(rtsSrc)
    && /this\._handleRightClick\(pendingRightClick\.x, pendingRightClick\.y\)/.test(rtsSrc));
check('观察模式任意世界允许鼠标选择/框选',
    /_isCommandable\(\)/.test(rtsSrc)
    && /PERSISTENT_WORLDS\.has\(this\._scene\) \|\| !!g\?\._observerMode/.test(rtsSrc)
    && !/_onMouseDown\(e\) \{\s*if \(!this\.enabled \|\| this\._scene !== 'scene8'\)/.test(rtsSrc));
check('右键表面解析通过 window.Game 惰性句柄且无未声明 g',
    /const defenseSystem = _game\(\)\?\.DefenseSystem/.test(rtsSrc)
    && /defenseSystem\?\.resolveSurfaceTarget/.test(rtsSrc));
check('观察世界不收集本体世界 Party 幽灵单位',
    /if \(!g\?\._observerMode\)[\s\S]{0,180}PartySystem\.members/.test(rtsSrc));
check('高架单位选中圈使用视觉脚底 y-z',
    (rtsSrc.match(/ring\.setPosition\(e\.x, e\.y - \(Number\(e\.z\) \|\| 0\)\)/g) || []).length === 2);
check('牧师消费 move/attack/hold 指令',
    /const command = m\._command/.test(priestSrc)
    && /_applyCommand\(command\)/.test(priestSrc)
    && /command\.mode === 'attack'/.test(priestSrc));
check('所有可选仓鼠兵种支持墙顶 route 航点',
    [minerAiSrc, guardSrc, militiaSrc, shooterSrc, scoutSrc, warriorSrc, musketeerSrc, priestSrc, knightSrc]
        .every((source) => /resolveRtsMoveDestination|point\?\.route/.test(source)));
check('跨世界选择与编队召回按当前世界可选对象清理',
    /const allies = new Set\(this\._collectAllies\(\)\)/.test(rtsSrc)
    && /const selectable = new Set\(this\._collectAllies\(\)\)/.test(rtsSrc));
check('鼠标停在 UI 边缘时禁止相机边缘平移',
    /this\._pointerOverUi = this\._isPointerBlocked\(e\)/.test(rtsSrc)
    && /if \(this\._pointerOverUi\) return/.test(rtsSrc));
check('墙顶单位右键地面会生成反向下楼路线',
    /routeSurfaceMoveForUnit\(unit, target\)/.test(defenseSrc)
    && /staircase\.routePoints\(\).*reverse\(\)/s.test(defenseSrc)
    && /defenseSystem\.routeSurfaceMoveForUnit\(unit, point\)/.test(rtsSrc));
check('指挥模式左键小地图跳转镜头并阻止世界点击穿透',
    /e\.button === 0 && this\._tryMinimapCameraJump\(e\.clientX, e\.clientY\)/.test(rtsSrc)
    && /Camera\.x = point\.x[\s\S]{0,80}Camera\.y = point\.y/.test(rtsSrc)
    && /e\.stopImmediatePropagation\(\)/.test(rtsSrc));
check('小地图绘制与点击反算共享同一布局真源',
    /_minimapLayout\(\)/.test(gameSceneSrc)
    && /minimapClientRect\(\)/.test(gameSceneSrc)
    && /minimapWorldPointAt\(clientX, clientY\)/.test(gameSceneSrc)
    && /nx \* layout\.worldW/.test(gameSceneSrc)
    && /ny \* layout\.worldH/.test(gameSceneSrc));
check('RTS 中键轮盘按实际选中数量打开',
    /const targetCount = this\._resolveTargets\(false\)/.test(wheelSrc)
    && /if \(!targetCount\) return/.test(wheelSrc)
    && /this\._targetIds = \[\][\s\S]{0,100}return n/.test(wheelSrc));

const routeEntity = { x: 0, y: 0, z: 0, _surfaceKind: 'ground' };
const routeCommand = {
    mode: 'move',
    point: {
        x: 100,
        y: 0,
        z: 20,
        route: [
            { x: 0, y: 0, z: 0, surfaceKind: 'ground' },
            { x: 100, y: 0, z: 20, surfaceKind: 'stairs' },
        ],
    },
};
const approachEntity = { x: -200, y: 0, z: 0, _surfaceKind: 'ground' };
const approachCommand = {
    mode: 'move',
    point: {
        x: 100,
        y: 0,
        z: 20,
        route: routeCommand.point.route.map((step) => ({ ...step })),
    },
};
const groundApproach = resolveRtsMoveDestination(approachEntity, approachCommand);
check('地面单位先用普通 A* 接近楼梯入口，不提前关闭地面寻路与脱困',
    groundApproach.routeStage === 'ground_approach'
    && approachEntity._surfaceRouteActive === false
    && groundApproach.destination.surfaceKind === 'ground');
const firstWaypoint = resolveRtsMoveDestination(routeEntity, routeCommand);
check('统一 route 解析跳过已抵达节点并保留高架路线状态',
    routeCommand.routeIndex === 1
    && firstWaypoint.destination.x === 100
    && routeEntity._surfaceRouteActive === true);
routeEntity.x = 100;
routeEntity.z = 20;
routeEntity._surfaceKind = 'stairs';
const finalWaypoint = resolveRtsMoveDestination(routeEntity, routeCommand);
check('统一 route 解析抵达末节点后清理高架路线状态',
    finalWaypoint.arrived === true && routeEntity._surfaceRouteActive === false);

const descendEntity = {
    x: 0,
    y: 0,
    z: 20,
    _surfaceKind: 'stairs',
    _surfaceStaircase: { id: 'stair_down' },
};
const descendCommand = {
    mode: 'move',
    routeIndex: 0,
    point: {
        x: 20,
        y: 0,
        z: 0,
        surfaceKind: 'ground',
        staircaseId: 'stair_down',
        route: [
            { x: 0, y: 0, z: 20, surfaceKind: 'stairs', staircaseId: 'stair_down' },
            { x: 20, y: 0, z: 0, surfaceKind: 'ground', staircaseId: 'stair_down',
                transition: 'stairs_to_ground' },
        ],
    },
};
const pendingGroundHandoff = resolveRtsMoveDestination(descendEntity, descendCommand);
check('下楼路线先取得down许可并等待真实ground身份后才完成',
    pendingGroundHandoff.destination.surfaceKind === 'ground'
    && pendingGroundHandoff.arrived === false
    && pendingGroundHandoff.routeStage === 'stairs_to_ground');
descendEntity.x = 20;
descendEntity.z = 0;
descendEntity._surfaceKind = 'ground';
descendEntity._surfaceStaircase = null;
const confirmedGroundHandoff = resolveRtsMoveDestination(descendEntity, descendCommand);
check('原子提交ground身份后下楼节点正常完成且不残留routeActive',
    confirmedGroundHandoff.arrived === true
    && descendEntity._surfaceRouteActive === false);

const wallHandoffEntity = {
    x: 220,
    y: 110,
    z: 125,
    _surfaceKind: 'stairs',
    _surfaceStaircase: { id: 'stair_a' },
};
const wallHandoffCommand = {
    mode: 'move',
    point: {
        x: 220,
        y: 110,
        z: 125,
        surfaceKind: 'wall_walk',
        wallId: 'wall_a',
        route: [{
            x: 220,
            y: 110,
            z: 125,
            surfaceKind: 'wall_walk',
            wallId: 'wall_a',
        }],
    },
};
const pendingWallHandoff = resolveRtsMoveDestination(
    wallHandoffEntity,
    wallHandoffCommand
);
check('楼梯顶部与墙顶同高时不会提前完成墙面节点',
    pendingWallHandoff.arrived === false
    && pendingWallHandoff.routeStage === 'handoff_to_wall'
    && wallHandoffEntity._surfaceRouteActive === true);
wallHandoffEntity._surfaceKind = 'wall_walk';
wallHandoffEntity._surfaceWall = { id: 'wall_a' };
const confirmedWallHandoff = resolveRtsMoveDestination(
    wallHandoffEntity,
    wallHandoffCommand
);
check('取得目标墙面身份后才完成并清理高架路线',
    confirmedWallHandoff.arrived === true
    && wallHandoffEntity._surfaceRouteActive === false);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
