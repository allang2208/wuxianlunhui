/**
 * 世界-122 防守地图系统（雏形，2026-08-04）
 *
 * 玩法设计（业内防守玩法第一版，后续打磨）：
 * - 地图边界布置刷怪点，按「怪物类型 × 权重」加权随机生成可移动怪物（站桩单位不生成）；
 * - 怪物锁定基地/防御塔（_preferDefenseTargets），持续向基地核心发起进攻；
 * - 防御塔：独立装备栏，可装载「除手枪外的远程武器」；弹道/开火特效直接复用现有
 *   Combatant.fireProjectile + 枪口火焰/弹壳特效；每发伤害参考玩家六维属性；
 * - 升级：玩家支付金币升级（攻击/耐久成长），升级费用指数递增。
 */
import { Game } from '../game.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth, structureDepthAtY } from './structure-depth.js';
import { pathFinder } from '../ai/pathfinder.js';
import { Combatant } from '../entities/combatant.js';
import { getAmmoConfig, resolveGunAttackInterval } from '../config/gun-ammo.js';
import {
    BlackWolf, ZombieDogEnemy, ZombieWizard, Mutant3, SpitterZombie, FatZombie,
    Zombie, ArmoredKnight, Shounao, FlySwarm, FlyHand, PoisonMaggot, MinerZombie,
    LanternMinerZombie, ForemanZombie, OreSpider, Witch,
} from '../entities/enemy-types.js';
import { WEAPON_ATTACK_CONFIG, createAttackFromConfig } from '../config/weapon-attack-config.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EquipManager } from '../ui/equip-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { EffectFactory } from '../utils/effect-factory.js';
import { createWeaponRicochetHandler } from '../combat/weapon-ricochet.js';
import { createLegendaryLmgHitHandler } from '../combat/weapon-legendary-lmg.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SoundManager } from '../ui/sound-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { mountRightSidebarPanel } from '../ui/right-sidebar-panel-layer.js';
import { Renderer } from './renderer.js';
// SceneManager 导入已于 2026-08-15 移除：E 键修理监听器停用后不再引用
import { loadImage } from '../utils/image-loader.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { computeWeaponAttack, getAttackFormula } from '../config/attack-formula.js';
import { findWeaponConfig } from '../ui/equip-data-manager.js';
import { applyResearchHp } from './research-system.js';
import { World122TributeSystem } from './world122-tribute-system.js';
import { TechnologySystem } from './technology-system.js';
import {
    applyIsoFootprintFromSegment,
    isoFootprintVertices,
    isoLocalToWorldDelta,
    distanceToIsoFootprint,
    pointInIsoFootprint,
    worldDeltaToIsoLocal,
} from '../physics/iso-footprint.js';
import { circleOverlapsActiveGate } from './gate-occupancy.js';
import { Collider } from '../physics/collider.js';
import {
    ONE_CELL_BUILDING_FOOT,
    TWO_BY_TWO_BUILDING_FOOT,
    FOUR_BY_FOUR_BASE_FOOT,
    applyBuildingFootprint,
    applyWallStairFootprint,
} from './building-footprint.js';
import defenseStructuresJson from '../../data/defense-structures.json';
import {
    chooseElevatedSurfaceCandidate,
    commitElevatedSurfaceIdentity,
} from './elevated-surface-state.js';
import {
    createWallStairGroupRegistry,
    wallStairGroupId,
    wallStairsShareGroup,
} from './wall-stair-group.js';
import {
    clampStairGroupPortalLane,
    createUnifiedElevatedNavigation,
    resolveStairGroundPortalTransition,
    stairGroundPortal,
    stairGroupGroundPoint,
} from './unified-elevated-navigation.js';
import { ElevatedTopology } from './elevated-topology.js';
import { ElevatedNavigationController } from '../ai/elevated-navigation-controller.js';
import {
    projectileTargetZ,
    wallHitSupportsTarget,
} from '../combat/elevated-ranged.js';

// ==================== 配置 ====================

const stairCfg = defenseStructuresJson.wallStaircase || {};
const wallWalkCfg = defenseStructuresJson.wallWalk || {};

export const WALL_STAIR_CONFIG = Object.freeze({
    id: stairCfg.id || 'wall_staircase',
    name: stairCfg.name || '城墙楼梯',
    costPerSegment: Number(stairCfg.costPerSegment) || 200,
    hpPerSegment: Number(stairCfg.hpPerSegment) || 400,
    risePerSegment: Number(stairCfg.risePerSegment) || 62.5,
    minSegments: Math.max(1, Number(stairCfg.minSegments) || 1),
    maxSegments: Math.max(1, Number(stairCfg.maxSegments) || 8),
    stepCountPerSegment: Math.max(1, Number(stairCfg.stepCountPerSegment) || 9),
    walkWidth: Number(stairCfg.walkWidth) || 80,
    edgeHalfThick: Math.max(0, Number(stairCfg.edgeHalfThick) || 0.5),
    edgeRecoveryPadding: Math.max(
        0.5,
        Number(stairCfg.edgeRecoveryPadding) || 2
    ),
    edgeRecoverySteps: Math.max(
        2,
        Math.min(16, Number(stairCfg.edgeRecoverySteps) || 8)
    ),
    entryRailInset: Math.max(
        0,
        Number.isFinite(Number(stairCfg.entryRailInset))
            ? Number(stairCfg.entryRailInset)
            : 36
    ),
    displayWidth: Number(stairCfg.displayWidth) || 220,
    displayHeight: Number(stairCfg.displayHeight) || 220,
    attachRadius: Number(stairCfg.attachRadius) || 420,
    groupCenterTolerance: Math.max(1, Number(stairCfg.groupCenterTolerance) || 8),
    groupRunTolerance: Math.max(0.25, Number(stairCfg.groupRunTolerance) || 1.5),
    groupRailGapTolerance: Math.max(8, Number(stairCfg.groupRailGapTolerance) || 48),
    groupSeamMargin: Math.max(0, Number(stairCfg.groupSeamMargin) || 4),
    handoffTopProgress: Math.max(
        0.5,
        Math.min(0.9, Number(stairCfg.handoffTopProgress) || 0.65)
    ),
    handoffCaptureMargin: Math.max(
        4,
        Number(stairCfg.handoffCaptureMargin) || 24
    ),
    handoffStairOverlap: Math.max(
        4,
        Math.min(32, Number(stairCfg.handoffStairOverlap) || 16)
    ),
    connectorRailWallClearance: Math.max(
        0,
        Number.isFinite(Number(stairCfg.connectorRailWallClearance))
            ? Number(stairCfg.connectorRailWallClearance)
            : 2
    ),
    variants: Object.freeze(stairCfg.variants || {}),
});

export const WALL_WALK_CONFIG = Object.freeze({
    routeMinAlignment: Math.max(
        0,
        Math.min(1, Number(wallWalkCfg.routeMinAlignment) || 0.2)
    ),
    routeNodeSwitchT: Math.max(
        0.9,
        Math.min(1, Number(wallWalkCfg.routeNodeSwitchT) || 0.995)
    ),
    portalPreferenceMargin: Math.max(
        0,
        Math.min(1, Number(wallWalkCfg.portalPreferenceMargin) || 0.2)
    ),
    defaultTopZ: Number(wallWalkCfg.defaultTopZ) || 125,
    laneWidth: Number(wallWalkCfg.laneWidth) || 48,
    attachInset: Number(wallWalkCfg.attachInset) || 0,
    maxUnitRadius: Number(wallWalkCfg.maxUnitRadius) || 30,
    surfaceUnitRadius: Math.max(
        1,
        Math.min(
            Number(wallWalkCfg.maxUnitRadius) || 30,
            Number(wallWalkCfg.surfaceUnitRadius) || 24
        )
    ),
    commandPickTolerance: Math.max(0, Number(wallWalkCfg.commandPickTolerance) || 16),
    surfaceNavigation: Object.freeze({
        ...(wallWalkCfg.surfaceNavigation || {}),
        maxUnitRadius: Number(wallWalkCfg.maxUnitRadius) || 30,
        portalCaptureMargin: Math.max(
            2,
            Number(wallWalkCfg.surfaceNavigation?.portalCaptureMargin) || 18
        ),
        handoffStuckFrameThreshold: Math.max(
            2,
            Number(wallWalkCfg.surfaceNavigation?.handoffStuckFrameThreshold) || 3
        ),
        handoffRecoveryStep: Math.max(
            1,
            Math.min(
                3,
                Number(wallWalkCfg.surfaceNavigation?.handoffRecoveryStep) || 3
            )
        ),
    }),
    blockTopSurface: Object.freeze(wallWalkCfg.blockTopSurface || {}),
});

const unifiedElevatedNavigation = createUnifiedElevatedNavigation({
    chooseCandidate: chooseElevatedSurfaceCandidate,
    candidateAllowed: (unit, candidate) => {
        if (candidate?.surface?.kind !== 'stairs') return true;
        const staircaseId = candidate?.staircase?.id
            || candidate?.surface?.staircase?.id
            || candidate?.surface?.owner?.id;
        if (!staircaseId) return false;
        if (unit?._surfaceKind === 'wall_walk'
            && ElevatedNavigationController.isRouteControlled(unit)) {
            return ElevatedNavigationController.canCrossPortal(unit, staircaseId, 'down');
        }
        // ground 和无路线墙顶单位要先完成候选选择，再对唯一选中的Portal申请许可；
        // 不能在候选收集阶段依次预约多座重叠楼梯。
        return true;
    },
    maxStaircaseDistance: 240,
});

export function getWallStairVariant(dir = 'e2', ascendingSign = 1) {
    const key = `${dir === 'e1' ? 'e1' : 'e2'}_${ascendingSign === -1 ? 'neg' : 'pos'}`;
    return WALL_STAIR_CONFIG.variants[key] || WALL_STAIR_CONFIG.variants.e2_pos || null;
}

export function wallStairAnchorOffset(variant, partName, anchorName) {
    const part = variant && variant[partName];
    const pixel = part && part[`${anchorName}Px`];
    if (!Array.isArray(pixel) || pixel.length < 2) return { x: 0, y: 0 };
    const displayWidth = Number(variant.displayWidth) || WALL_STAIR_CONFIG.displayWidth;
    const displayHeight = Number(variant.displayHeight) || WALL_STAIR_CONFIG.displayHeight;
    return {
        x: (Number(pixel[0]) - 512) * displayWidth / 1024,
        y: (Number(pixel[1]) - 512) * displayHeight / 1024,
    };
}

/** 收集与目标墙端点连续相接的完整可行走墙链（含转角）。 */
export function collectConnectedWalkableWalls(rootWall, entitySource = null) {
    if (!rootWall) return [];
    const source = entitySource || Game?.entities;
    if (rootWall._isBlockCover) {
        return _blockWallComponent(rootWall, _blockWallIndex(source));
    }
    const candidates = source?.values ? Array.from(source.values()) : Array.from(source || []);
    const walls = candidates.filter((wall) =>
        wall?.active && wall._isWalkableWall && Array.isArray(wall._faceLine));
    const connected = [];
    const seen = new Set();
    const queue = [rootWall];
    const JOIN_DISTANCE = 90;
    const endpointsTouch = (left, right) => {
        for (const a of left._faceLine || []) {
            for (const b of right._faceLine || []) {
                if (Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_DISTANCE) return true;
            }
        }
        return false;
    };
    while (queue.length) {
        const wall = queue.shift();
        if (!wall || seen.has(wall)) continue;
        seen.add(wall);
        connected.push(wall);
        for (const candidate of walls) {
            if (seen.has(candidate)) continue;
            if (Math.abs((Number(candidate._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ)
                - (Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ)) > 1) continue;
            if (endpointsTouch(wall, candidate)) queue.push(candidate);
        }
    }
    return connected;
}

export const DEFENSE_CONFIG = {
    mapName: '世界-122',
    base: {
        // 2026-08-16：基地右移到沙漠贴图区（固定沙地补丁中心、1700px，见
        // scene-manager._loadScene8 sandPatches.fixed）；场地 6144×4096 → 12288×8192
        // 翻倍后按原相对位置等比右移（0.342×12288 ≈ 4200），菱形房跨 x 3688..4712，
        // 距菱形左边界真实垂距 ~1878px ≥ 补丁半径+余量（850+60），沙地不越界；
        // 门洞开在 RB 边中点。
        x: 4200, y: 4096,
        hp: 5000, radius: FOUR_BY_FOUR_BASE_FOOT.collisionRadius, def: 90, mdef: 90,
    },
    // 掩体（可被攻击的防御墙段，def/mdef 均为 0）：F→A 六档生命值，
    // 每组含水平摆(_h)/垂直摆(_v)两张贴图（30° 底边斜向互为镜像）
    covers: {
        hp: { F: 400, E: 700, D: 1100, C: 1600, B: 2200, A: 3000 },
        // 预置掩体环由 _buildBaseRoom() 生成（基地菱形房，2026-08-05 修正版）
        layout: [],
    },
    // 基地菱形房（2026-08-05 修正版 v2）：四边用新掩体墙（可被攻击，def/mdef=0），
    // 夹角按预制件 26.57° 参考（ry/rx = 0.5，与地板透视一致，见 tools/wall-room-sim.py）；
    // h="\"（TR/LB 边）、v="/"（TL/RB 边）；开口在 RB 边中点，只此一处。
    // 拼接规则（skill 沉淀）：face 线步长 = (176, ±87) − 40px 端帽叠合 ≈ (140, ∓69)，
    // 相邻件 face 重叠 40px（端帽完全叠合互盖，无缝隙）；cornerExtend 让边链端帽越过顶点，
    // 转角由相邻两边端帽互相叠盖，实心无洞。
      room: {
          enabled: true,
          rx: 512,            // 房间宽 = 2*rx = 1024
          ry: 256,            // ry/rx = 0.5（墙底边斜率 0.5）
          coverGrade: 'D',
          // 边链 face 向两端顶点各延伸的量（2026-08-08 修正：按真实投影计算后
          // 该值才是实际越界量；45 过大导致转角侵入式叠合 ~147px）。
          // 29 = 两臂 face 端点正好在角点 face 交线交点相接（干净斜接，不侵入），
          // 墙体本体仍靠 17px 端帽叠盖保证转角实心。按 rx/ry=2 菱形算得，
          // 改房间比例需重算（面线相对边线有垂直偏移）。
          cornerExtend: 29,
          // 转角图层：'rightOnTop' = 右侧臂盖左侧臂（上角 TR 盖 TL、下角 RB 盖 LB；
          // 2026-08-08 上夹角 A/B 实机对比 + GLM：右盖左砖纹连贯、无暗缝）；
          // 'leftOnTop' = 旧行为（上角 TL 盖 TR、下角 LB 盖 RB）
          cornerLayer: 'rightOnTop',
          openEdge: 'RB',
          openRadius: 90,     // 开放带半宽：face 命中该带的边链件跳过 → 居中门洞（一格门 196.77，
                              // 两侧邻墙段由下方 post-pass 收拢对齐门 face 端点）
          doorAlignY: 0,      // 新拼接规则下门柱底边与墙线天然共线，无需旧版下移精调
          // 2026-08-17：1×1 方格块模式（用户方向）——基地改为 8 格/边方块环，
          // 块 footprint = 1 格（64×32），四边零缝隙；门（4 格）待后续接入。
          blockMode: true,
      },
    // 无预置防御塔（玩家用 B 建筑面板自行摆放）
    towers: [],
    tower: {
        hp: 1400, radius: TWO_BY_TWO_BUILDING_FOOT.collisionRadius, def: 70, mdef: 70,
        // 摧毁后重建 / 出售（2026-08-14）：重建 = 原建造能源价；出售返还 50% 建造能源
        rebuildCost: 1000,
        sellRefundRatio: 0.5,
        // 六维芯片（2026-08-16 重构：取代原塔等级，与改造模块并存）：
        // - 芯片属性初始 base、单项上限 max；升级属性本身不加攻击，
        //   只强化「与该属性挂钩的已装载武器」的攻击力；
        // - 金币费用逐级递增：round(baseCost × growth^(当前值 - base))
        chip: {
            base: 10,
            max: 30,
            upgrade: { baseCost: 60, costGrowth: 1.28 },
            stats: {
                str:  { name: '力量', icon: '💪' },
                dex:  { name: '敏捷', icon: '💨' },
                con:  { name: '体质', icon: '❤️' },
                int:  { name: '智力', icon: '🧠' },
                wis:  { name: '精神', icon: '✨' },
                luck: { name: '幸运', icon: '🍀' },
            },
        },
        // 武器 ↔ 芯片主属性挂钩（2026-08-16）：默认取该武器攻击公式的首个 attrs 属性，
        // 此处仅做显式覆盖/微调。面板逐属性「每点+X攻击力 / 无影响」由真实公式差分实时计算，
        // 强化/改造/附魔自动计入，禁止硬编码数值。
        chipWeaponStat: {
            pkm: 'str',
            rpd: 'str',
            m249: 'str',
            ultimax100: 'str',
            mg42: 'str',
            fusion_core_lmg: 'str',
            singularity_loom_lmg: 'str',
            celestial_cartographer_lmg: 'str',
            grave_covenant_cantor_lmg: 'str',
            qjb201: 'str',
            energy_lmg: 'str',
            akm: 'int',
            stg44: 'int',
            m416: 'int',
            qbz95: 'int',
            frontier_rifle: 'int',
            vengeance_rifle: 'int',
            astral_tide_rifle: 'int',
            zero_point_rifle: 'int',
            corona_cadence_rifle: 'int',
            terminal_echo_rifle: 'int',
            qbz191: 'int',
            shotgun: 'con',
            bow: 'dex',
        },
        // 改造模块（2026-08-16 重新引入，与六维芯片并存）：
        // - 芯片管「伤害挂钩主属性」；改造模块直接强化武器参数
        //   （伤害%/射程/射速/换弹/过热/散热），图标 = assets/ui/tower 抠图成品卡；
        // - 费用 round(baseCost × growth^(等级-1)) 逐级递增，独立升级无槽位限制。
        modules: {
            damage:    { name: '伤害强化', icon: 'assets/ui/tower/tower-module-damage.png',    per: 0.10, maxLevel: 5, baseCost: 150, costGrowth: 1.45, desc: '每发伤害 +{pct}%' },
            range:     { name: '射程增强', icon: 'assets/ui/tower/tower-module-range.png',     per: 0.12, maxLevel: 4, baseCost: 130, costGrowth: 1.45, desc: '射程 +{pct}%' },
            attackSpd: { name: '速射模块', icon: 'assets/ui/tower/tower-module-attspd.png',    per: -0.08, maxLevel: 5, baseCost: 140, costGrowth: 1.45, desc: '攻击间隔 -{pct}%' },
            reload:    { name: '快速换弹', icon: 'assets/ui/tower/tower-module-reload.png',    per: -0.10, maxLevel: 4, baseCost: 100, costGrowth: 1.45, desc: '换弹时间 -{pct}%' },
            overheat:  { name: '过热抑制', icon: 'assets/ui/tower/tower-module-overheat.png',  per: 0.12, maxLevel: 4, baseCost: 120, costGrowth: 1.45, desc: '过热时间 +{pct}%' },
            cooling:   { name: '快速散热', icon: 'assets/ui/tower/tower-module-cooling.png',   per: -0.12, maxLevel: 4, baseCost: 120, costGrowth: 1.45, desc: '过热冷却 -{pct}%' },
        },
    },
    // 修理（2026-08-14）：掩体/防御塔受伤后，靠近按住 E 消耗背包能源持续修理。
    // hpPerEnergy = 每点能源可修复的 HP（掩体 2HP/能、塔 3HP/能）；tickHp = 每 tick 修复量上限。
    // （2026-08-15 变更：E 键长按修理已停用——与用户快捷键冲突；掩体修理改由建筑面板
    //  详情视图「修理」按钮进行，费率仍取本配置 coverHpPerEnergy）
    repair: {
        range: 150,
        coverHpPerEnergy: 8,
        towerHpPerEnergy: 7,
        tickMs: 100,
        tickHp: 25,
    },
    spawn: {
        // 2026-08-14 离散波次重构（用户要求）：
        // 进入世界-122 后 30s 准备期（怪物不进攻）→ 第 1 波一次性刷 batch → 清空 → 10s 休息 → 下一波…
        prepMs: 30000,          // 准备期：30s 后怪物才开始进攻
        waveBreakMs: 10000,     // 波间休息（修塔/建掩体窗口）
        maxAlive: 40,
        baseCount: 6,           // 离散波批量 = baseCount + wave × countPerWave（第1波 8 只，封顶 24）
        countPerWave: 2,
        countCap: 24,
        hpPerWave: 0.16,
        atkPerWave: 0.08,
        alertRange: 9000, // 2026-08-16 地图翻倍 12288×8192：最远刷怪点距基地 ~7976，索敌需覆盖
        // A 移动（2026-08-15）：怪物最终目标仍是基地/建筑，但沿途交战半径内的
        // 玩家/侍从也会被锁定攻击（类似 RTS 的 A 键攻击移动）；脱离后自动回归推进
        engageHostileRange: 320,
        // 防守局内金币经济（2026-08-07）：击杀掉落走本倍率（怪物标 _noGoldDrop，
        // 不走地面掉落物，直接进背包），随波次成长；精英 ×2 / 领主 ×3
        goldDropMul: 6,
        goldRandomMin: 1,
        goldRandomMax: 8,
        // 精英/领主定时刷（仅在波次战斗阶段，在普通波次之上额外生成）
        // （2026-08-15 起停用计时器：精英/领主改由 wavePlan 随波次脚本化生成，字段保留兼容）
        eliteEveryMs: 30000,
        lordEveryMs: 90000,
        eliteHpMul: 1.4,
        lordHpMul: 2.8,
        // 胜利结算（2026-08-14）：第 victoryWave 波清空即防守胜利，发放奖励
        victoryWave: 10,
        victoryReward: { gold: 500, energy: 500 },
        // ==================== 波次预算制配波（2026-08-15，用户确认方案）====================
        // 每波按威胁预算（TP）配怪：预算 ÷ 怪物 TP = 只数，角色配比 + 硬约束替代旧"只数公式+单一随机池"。
        // 预算曲线 26 × 1.15^(n-1)：W1≈8只 / W10≈24只，与旧 countCap 曲线对齐；
        // HP/攻击仍走 hpPerWave/atkPerWave 成长（预算只管数量与构成，不重复放大血量）。
        waveBudgetBase: 26,
        waveBudgetGrowth: 1.15,
        // 角色解锁时间表（教学式节奏）；ratios = 占本波预算比例；elites/lords = 脚本化生成数量，
        // eliteMul/lordMul 可覆盖默认血量倍率（如 W5 迷你领主 0.6 × lordHpMul）
        wavePlan: {
            1:  { theme: '尸潮',     ratios: { fodder: 1.0 },                                              elites: 0, lords: 0 },
            2:  { theme: '尸潮+',    ratios: { fodder: 0.8, tank: 0.2 },                                   elites: 0, lords: 0 },
            3:  { theme: '犬袭',     ratios: { fodder: 0.6, fast: 0.4 },                                   elites: 1, lords: 0 },
            4:  { theme: '酸液',     ratios: { fodder: 0.6, ranged: 0.25, tank: 0.15 },                    elites: 0, lords: 0 },
            5:  { theme: '空袭',     ratios: { fast: 0.4, air: 0.3, fodder: 0.3 },                         elites: 0, lords: 1, lordMul: 0.6 },
            6:  { theme: '重压',     ratios: { tank: 0.4, fodder: 0.4, ranged: 0.2 },                      elites: 2, lords: 0 },
            7:  { theme: '混合突击', ratios: { fodder: 0.35, tank: 0.25, fast: 0.2, ranged: 0.1, air: 0.1 }, elites: 0, lords: 0 },
            8:  { theme: '精英卫队', ratios: { fodder: 0.5, tank: 0.3, ranged: 0.2 },                      elites: 2, lords: 1 },
            9:  { theme: '总攻预演', ratios: { fodder: 0.3, tank: 0.3, fast: 0.15, ranged: 0.15, air: 0.1 }, elites: 2, lords: 0 },
            10: { theme: '决战',     ratios: { fodder: 0.4, tank: 0.3, fast: 0.15, ranged: 0.15 },         elites: 2, lords: 2 },
        },
        // 配波硬约束（防脸黑）：单一类型 ≤ 单波只数 40%；远程+空中 ≤ 预算 30%；快速 ≤ 预算 35%
        waveMaxSameTypeRatio: 0.4,
        waveMaxRangedAirBudgetRatio: 0.3,
        waveMaxFastBudgetRatio: 0.35,
    },
    // 刷怪点（2026-08-16 v3：场地翻倍 12288×8192 后按原相对位置 ×2 等比平移，
    // 中心 (6144,4096)、菱形 rx=6144/ry=3072）：
    // 右顶点主路 + 沿右上/右下两条边（边线内侧 ~120px，法向入菱形）各 3 点 + 两点中距，
    // 全部落点在菱形内（|dx|/6144+|dy|/3072 ∈ 0.92~0.95），怪物从右往左攻、多路有纵深。
    spawnPoints: [
        { x: 12176, y: 4096 },
        { x: 11600, y: 3992 },
        { x: 10800, y: 3592 },
        { x: 10000, y: 3192 },
        { x: 11600, y: 4200 },
        { x: 10800, y: 4600 },
        { x: 10000, y: 5000 },
        { x: 9400, y: 2800 },
        { x: 9400, y: 5400 },
    ],
};

/** 防御塔可装载武器（远程武器，手枪除外） */
const TOWER_WEAPON_TYPES = ['bow', 'pkm', 'rpd', 'm249', 'ultimax100', 'mg42', 'fusion_core_lmg', 'singularity_loom_lmg', 'celestial_cartographer_lmg', 'grave_covenant_cantor_lmg', 'akm', 'stg44', 'm416', 'qbz95', 'frontier_rifle', 'vengeance_rifle', 'astral_tide_rifle', 'zero_point_rifle', 'corona_cadence_rifle', 'terminal_echo_rifle', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'];

/**
 * 防御塔命中盒（世界坐标，相对塔脚）：覆盖原始 170×262 塔身与挂载武器。
 * 悬停金色轮廓共用此矩形（旧版仅塔脚 70px 圆，点塔身/塔顶脱靶）。
 */
const TOWER_HIT = { cx: 0, cy: -135, hw: 115, hh: 175 };

/** 世界点是否命中防御塔（整塔矩形） */
function pointHitsTower(wx, wy, t) {
    const groundY = t.y + (Number(t._visualGroundOffsetY) || 0);
    return wx >= t.x + TOWER_HIT.cx - TOWER_HIT.hw && wx <= t.x + TOWER_HIT.cx + TOWER_HIT.hw
        && wy >= groundY + TOWER_HIT.cy - TOWER_HIT.hh && wy <= groundY + TOWER_HIT.cy + TOWER_HIT.hh;
}

/** 弹丸贴图直接复用现有武器贴图（无映射则默认曳光弹） */
const WEAPON_IMAGE_PATHS = {
    pkm: 'assets/icons/pkm_side_clean.png',
    rpd: 'assets/weapons/rpd-equip.png',
    m249: 'assets/weapons/m249-equip.png',
    ultimax100: 'assets/weapons/ultimax100-equip.png',
    mg42: 'assets/weapons/mg42-equip.png',
    fusion_core_lmg: 'assets/weapons/fusion-core-lmg-equip.png',
    singularity_loom_lmg: 'assets/weapons/singularity-loom-lmg-equip.png',
    celestial_cartographer_lmg: 'assets/weapons/celestial-cartographer-lmg-equip.png',
    grave_covenant_cantor_lmg: 'assets/weapons/grave-covenant-cantor-lmg-equip.png',
    akm: 'assets/weapons/akm-equip.png',
    stg44: 'assets/weapons/stg44-equip.png',
    qbz95: 'assets/weapons/qbz95-equip.png',
    frontier_rifle: 'assets/weapons/frontier-rifle-equip.png',
    vengeance_rifle: 'assets/weapons/vengeance-rifle-equip.png',
    astral_tide_rifle: 'assets/weapons/astral-tide-rifle-equip.png',
    zero_point_rifle: 'assets/weapons/zero-point-arbitrator-equip.png',
    corona_cadence_rifle: 'assets/weapons/corona-cadence-rifle-equip.png',
    terminal_echo_rifle: 'assets/weapons/terminal-echo-rifle-equip.png',
    qbz191: 'assets/icons/191icon.png',
    qjb201: 'assets/icons/201-icon.png',
    energy_lmg: 'assets/icons/devotion-icon.png',
    super90: 'assets/icons/M4s90_icon.png',
    saiga12k: 'assets/icons/S12k-icon.png',
    bow: 'assets/icons/bow_icon.png',
};

/**
 * 面板武器贴图路径（2026-08-16，数据驱动，零硬编码）：
 * 实例自带字段 > EquipDataManager 全量源 > 弹丸贴图兜底。
 */
function towerWeaponImagePath(item) {
    if (!item) return null;
    const pick = (o) => (o && (o.iconImage || o.equipImage || o.slotImage || o.dropImage)) || null;
    return pick(item)
        || pick(findWeaponConfig(item.weaponId, item.name))
        || WEAPON_IMAGE_PATHS[item.weaponId]
        || WEAPON_IMAGE_PATHS[item.weaponType]
        || null;
}

/** 防御塔开火音效（按武器类型；无则静音） */
const TOWER_FIRE_SOUNDS = {
    pkm: 'assets/sounds/weapons/pkm_half_sec.wav',
    rpd: 'assets/sounds/weapons/rpd_fire.wav',
    m249: 'assets/sounds/weapons/m249_fire.wav',
    ultimax100: 'assets/sounds/weapons/ultimax100_fire.wav',
    mg42: 'assets/sounds/weapons/mg42_fire.wav',
    fusion_core_lmg: 'assets/sounds/weapons/fusion_core_lmg_fire.wav',
    singularity_loom_lmg: 'assets/sounds/weapons/singularity_loom_lmg_fire.wav',
    celestial_cartographer_lmg: 'assets/sounds/weapons/celestial_cartographer_lmg_fire.wav',
    grave_covenant_cantor_lmg: 'assets/sounds/weapons/grave_covenant_cantor_lmg_fire.wav',
    akm: 'assets/sounds/weapons/akm_burst.mp3',
    stg44: 'assets/sounds/weapons/stg44_fire.wav',
    qbz95: 'assets/sounds/weapons/qbz95_fire.wav',
    frontier_rifle: 'assets/sounds/weapons/m416_fire.wav',
    vengeance_rifle: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    astral_tide_rifle: 'assets/sounds/weapons/m416_fire.wav',
    zero_point_rifle: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    corona_cadence_rifle: 'assets/sounds/weapons/m416_fire.wav',
    terminal_echo_rifle: 'assets/sounds/weapons/m416_fire.wav',
    qbz191: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    qjb201: 'assets/sounds/weapons/qjb201_single_600ms.wav',
    m416: 'assets/sounds/weapons/m416_fire.wav',
    energy_lmg: 'assets/sounds/weapons/apex_shot_600ms.wav',
    super90: 'assets/sounds/weapons/apex2_shot_1s.wav',
    saiga12k: 'assets/sounds/weapons/apex2_shot_1s.wav',
    bow: 'assets/sounds/bow/arrow_whoosh_sharp.wav',
};

/** 刷怪池（只含可移动怪物；站桩单位不生成）。
 * 普通怪 = 常规流；精英 30s 一刷；领主 90s 一刷（在普通流之上额外生成）。 */
const NORMAL_POOL = [
    { type: 'zombie', weight: 16 },
    { type: 'minerZombie', weight: 12 },
    { type: 'fatZombie', weight: 11 },
    // 僵尸犬（2026-08-15 恢复）：类构造器已合并 enemyConfigData（08-15 早些时候修复
    // 「测试敌人」兜底根因）+ showWeapon 默认 false，无配置构造即完整可用。
    { type: 'zombieDog', weight: 8 },
    { type: 'blackWolf', weight: 9 },
    { type: 'spitterZombie', weight: 7 },
    { type: 'flySwarm', weight: 7 },
];
const ELITE_POOL = [
    { type: 'lanternMinerZombie', weight: 5 },
    { type: 'oreSpider', weight: 5 },
    { type: 'zombieWizard', weight: 4 },
    { type: 'armoredKnight', weight: 4 },
    { type: 'poisonMaggot', weight: 4 },
    { type: 'mutant3', weight: 3 },
];
const LORD_POOL = [
    { type: 'foremanZombie', weight: 4 },
    { type: 'shounao', weight: 4 },
    { type: 'flyHand', weight: 3 },
    { type: 'witch', weight: 3 },
];

/**
 * 角色池（2026-08-15 预算制配波）：tp = 威胁值（Threat Point），配波货币；weight = 角色内抽取权重。
 * TP 依据 HP/速度/射程/攻击频率综合评定：炮灰 僵尸3/矿工4；坦克 胖5/矿工4；快速 狗3/狼5；
 * 远程 喷吐6（射程930 > 塔基准800，白嫖风险高 → 高TP）；空中 蝇群2
 */
const ROLE_POOLS = {
    fodder: [ { type: 'zombie', tp: 3, weight: 3 }, { type: 'minerZombie', tp: 4, weight: 2 } ],
    tank:   [ { type: 'fatZombie', tp: 5, weight: 3 }, { type: 'minerZombie', tp: 4, weight: 1 } ],
    fast:   [ { type: 'zombieDog', tp: 3, weight: 3 }, { type: 'blackWolf', tp: 5, weight: 2 } ],
    ranged: [ { type: 'spitterZombie', tp: 6, weight: 1 } ],
    air:    [ { type: 'flySwarm', tp: 2, weight: 1 } ],
};

const MONSTER_FACTORY = {
    zombie: Zombie,
    minerZombie: MinerZombie,
    fatZombie: FatZombie,
    zombieDog: ZombieDogEnemy,
    blackWolf: BlackWolf,
    spitterZombie: SpitterZombie,
    flySwarm: FlySwarm,
    lanternMinerZombie: LanternMinerZombie,
    oreSpider: OreSpider,
    zombieWizard: ZombieWizard,
    armoredKnight: ArmoredKnight,
    poisonMaggot: PoisonMaggot,
    mutant3: Mutant3,
    foremanZombie: ForemanZombie,
    shounao: Shounao,
    flyHand: FlyHand,
    witch: Witch,
};

function canUseMonsterSpawnPoint(x, y, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (WallSystem?.canMoveTo && !WallSystem.canMoveTo(x, y, radius)) return false;
    // 开门会临时移除 WallSystem 门段；出生校验仍按城门固定 footprint 排除门洞。
    return !circleOverlapsActiveGate(x, y, radius, Game?.entities?.values?.());
}

function findMonsterSpawnNear(x, y, radius) {
    if (canUseMonsterSpawnPoint(x, y, radius)) return { x, y };
    if (WallSystem?.findSafeSpawn) {
        const safe = WallSystem.findSafeSpawn(x, y, radius);
        if (safe && canUseMonsterSpawnPoint(safe.x, safe.y, radius)) return safe;
    }
    // findSafeSpawn 不把常开门视为障碍，可能原样返回门洞；再绕固定占地作小范围确定性搜索。
    const step = Math.max(64, radius * 2 + 16);
    for (let ring = 1; ring <= 5; ring++) {
        const samples = ring * 8;
        for (let index = 0; index < samples; index++) {
            const angle = index * Math.PI * 2 / samples;
            const px = x + Math.cos(angle) * step * ring;
            const py = y + Math.sin(angle) * step * ring;
            if (canUseMonsterSpawnPoint(px, py, radius)) return { x: px, y: py };
        }
    }
    return null;
}

/** 掩体贴图内容框宽高比（2026-08-05 圆角 bevel 后复测），显示宽度统一 260，高度按比例 */
// 显示宽高比（路线 B：Blender 完整 box 棱柱 + 8 角 bevel，sizeH=259 使世界底边斜率 = 0.4976）
const COVER_ASPECT = {
    F: { h: 1.004, v: 1.004 },
    E: { h: 1.004, v: 1.004 },
    D: { h: 1.004, v: 1.004 },
    C: { h: 1.004, v: 1.004 },
    B: { h: 1.004, v: 1.004 },
    A: { h: 1.004, v: 1.004 },
};
const COVER_DISPLAY_W = 260;

/** 世界-122 铁栅栏滑动门几何（2026-08-15，Blender 建模 + 掩体同款砖墙/铸铁贴图，F→A 六档共用）。
 * 门体：左右两根细立柱 + 纤细铁栅栏 + 每扇叶上下两条水平横杆（rail，穿过该叶竖杆）。
 * 横杆与竖杆同烘焙在 `_bars` 16 帧表内，`_play()` 切帧即同步开合。
 * 几何标定（compose-cover-gate.py 输出 + 2026-08-16「一格 = 一堵墙」重建，纹理 cell 640×634，y 向下）：
 * - face 线 = 门底边线（与 COVER_FACE v 同斜率 -0.497、同接地偏移），关闭时覆盖门洞；
 * - worldFaceLen = 176（水平跨度）= 墙 face 水平跨度（COVER_FACE ±88）——门占一格 = 一堵墙；
 * - 16 帧滑动动画：frame 0 = 关闭（两扇叶在中间合拢），frame 15 = 打开（扇叶滑出画面外隐藏）。
 */
const GATE_GRADES = ['F', 'E', 'D', 'C', 'B', 'A'];
const GATE_GEOM = {
    cellW: 640,
    cellH: 634,
    frames: 16,
    animMs: 650,
    halfThick: 26,
    // 2026-08-16 重标定：门整体缩放到「一格 = 墙」，face 水平半跨 = 88 display px。
    // faceA/B 由重建后贴图实测（bars 中段斜率 -0.4962，延伸至内容边缘 x 105.4/534.6）。
    faceA: { x: 105.4, y: 584.0 },
    faceB: { x: 534.6, y: 371.0 },
    faceLen: 479.2,
    worldFaceLen: 176,
    // 显示比例：与掩体墙同尺度（掩体 1024tex→260px；门 cell 640→262px，内容已内缩至墙宽）。
    displayScale: 0.410,
    // bars 层贴图裁剪窗（cell 像素）：只显示左右石柱之间的门洞区（重建后柱内缘 x 174/466；
    // 右缘取 467 而非 466——裁剪窗右边界不含端点，466 恰好是贴柱像素，取 466 会留 1px 缝）。
    // 开门时钢管滑出该窗即被裁剪，不再在石柱外残留；柱体贴图由 pillarL/R 单独渲染。
    barCrop: { x: 174, y: 0, w: 293, h: 634 },
};
/** 4 格门栅栏视觉参数：预览与 BuildableGate 实体共用，禁止两处各写近似值。 */
const GATE4_VISUAL = {
    scaleX: 0.437,
    scaleY: 0.5,
    footOffsetY: 83,
};
const gateConfigFor = (grade) => ({ ...GATE_GEOM, grade, tex: `cover_gate_${grade}` });
const GATE_CONFIG = gateConfigFor('D'); // 基地固定门（D 级）

/** 门的三段深度面线全局注册表（供 WallSystem 遮挡仲裁逐帧并入，2026-08-15）。 */
function gateSegRegistry() {
    if (typeof window === 'undefined') return null;
    if (!window.GateFaceSegs) window.GateFaceSegs = [];
    return window.GateFaceSegs;
}

/**
 * 门的三段遮挡面线（沿 face 线切分）：
 * 左柱段（深端）/ 栅栏段（中点）/ 右柱段（浅端）——各自独立深度，
 * 让右柱（浅端）前实体自然浮到右柱之上、左柱（深端）仍能遮挡其后实体。
 */
function gateDepthSegs(A, B, depthL, depthR, depthBars) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const half = 22; // 柱宽在 face 线上的投影（世界 px，一格门重建后柱显示宽 ~45）
    return [
        { A: { x: A.x, y: A.y }, B: { x: A.x + ux * half, y: A.y + uy * half }, depth: depthL },
        { A: { x: A.x + ux * half, y: A.y + uy * half }, B: { x: B.x - ux * half, y: B.y - uy * half }, depth: depthBars },
        { A: { x: B.x - ux * half, y: B.y - uy * half }, B: { x: B.x, y: B.y }, depth: depthR },
    ];
}

/** 创建门的三段精灵（左柱/右柱静态图 + 栅栏/水平横杆 16 帧），各按自身底边线深度锚定。
 *  flip=镜像（h）：整门翻转换了视觉左右，左右柱深度随之互换（面线端点不变）。 */
function createGateSprites(cfg, cx, cy, k, depthL, depthR, depthBars, flip, barsOnly, k2) {
    const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
    if (!scene) return null;
    const out = { spriteL: null, spriteR: null, bars: null };
    // 4 格门（barsOnly，2026-08-17）：石柱由方块墙实体承担，门只渲中间铁栅栏
    if (!barsOnly) {
        if (scene.textures.exists(`${cfg.tex}_pillarL`)) {
            out.spriteL = scene.add.image(cx, cy, `${cfg.tex}_pillarL`);
            out.spriteL.setOrigin(0.5, 0.5);
            out.spriteL.setScale(k, k);
            out.spriteL.setDepth(flip ? depthR : depthL);
            out.spriteL.setFlipX(flip);
        }
        if (scene.textures.exists(`${cfg.tex}_pillarR`)) {
            out.spriteR = scene.add.image(cx, cy, `${cfg.tex}_pillarR`);
            out.spriteR.setOrigin(0.5, 0.5);
            out.spriteR.setScale(k, k);
            out.spriteR.setDepth(flip ? depthL : depthR);
            out.spriteR.setFlipX(flip);
        }
    }
    if (scene.textures.exists(`${cfg.tex}_bars`)) {
        out.bars = scene.add.sprite(cx, cy, `${cfg.tex}_bars`, 0);
        out.bars.setOrigin(0.5, 0.5);
        out.bars.setScale(k, k2 || k);
        out.bars.setDepth(depthBars);
        out.bars.setFlipX(flip);
          const crop = cfg.barCrop;
          if (crop && typeof out.bars.setCrop === 'function') {
              // Phaser 4 的 setCrop 写入 GameObject._crop（按当前帧算 UV），
              // _play() 每次 setFrame 切帧后 _crop 仍是旧帧 UV —— 动画会冻结/裁剪失效。
              // 包一层 setFrame：切帧后按新帧重算裁剪窗（六档门共用同一张表，窗口恒定）。
              const applyCrop = () => out.bars.setCrop(crop.x, crop.y, crop.w, crop.h);
              const origSetFrame = out.bars.setFrame.bind(out.bars);
              out.bars.setFrame = (frame, updateSize, updateOrigin) => {
                  const ret = origSetFrame(frame, updateSize, updateOrigin);
                  applyCrop();
                  return ret;
              };
              applyCrop();
          }
    }
    return out;
}

/**
 * 掩体墙段底边线（face line）端点偏移（相对掩体脚底 x/y，世界像素），按级别标定。
 * 与 building-system 的吸附端点同源（贴图内容底边 = 墙段接地线）：
 * - v（"/"）：A=低端（近地），B=高端（远地）
 * - h（"\"）：镜像，A=高端，B=低端
 * 数值来源：路线 B（Blender 完整 box 棱柱 + 8 角 bevel + AI 材质纹理）渲染图底边端点标定
 * （prep-cover-render.py，2026-08-05 圆角后复标：A(-88,-21)/B(88,-108)）。
 * 完整 box 实心端帽使端帽底部与正面底边共线，拼接处脚底线连续无凸起。
 * 几何统一 → 6 级 face 完全一致，
 * 同向/跨级拼接天然共线；h 一律 = v 镜像派生。
 * 供图层排序（深度锚点 = max 底边端点 y + 12）和遮挡仲裁（junctionCorrectedDepth 面线）使用。
 */
export const COVER_FACE = {
    F: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    E: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    D: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    C: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    B: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    A: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
};
/** 兼容旧访问（COVER_FACE.v / COVER_FACE.h）：默认取 D 级 */
COVER_FACE.v = COVER_FACE.D.v;
COVER_FACE.h = COVER_FACE.D.h;

/**
 * 玩家摆放掩体的碰撞 footprint（墙段底部判定面积，参考 WallSystem 障碍物 foot 口径）：
 * 墙段 face 从 (x±88, y-21..y-108) → 沿墙段 ±thick 的轴对齐 AABB 198×133，
 * 中心上移 offY=-68（对准墙段主体）。thick = 墙厚一半（52 世界 → 26）。
 * v/h 是镜像，AABB 相同。colliderOffsetY 让矩形中心对准墙段（旧 46×300 竖矩形
 * 只有视觉 26% 宽且偏下，怪物可穿墙段大部分——用户反馈"障碍物根本没碰撞体积"根因）。
 * 注意：线段碰撞（_canPlace / isoSegments）必须用 thick（26），不能用
 * min(collisionWidth, collisionHeight)（会把 140 当墙厚 → 140px 空气墙，吸附右侧被拒）。
 */
export const COVER_FOOT = {
    v: { w: 198, d: 133, offY: -68, thick: 26 },
    h: { w: 198, d: 133, offY: -68, thick: 26 },
};

/** 1×1 方格块（2026-08-17）：footprint = 1 格（128×64），单一贴图，无 v/h 变体。
 * face 线取格子底边（斜率 -0.5，跨度 1 格边 71.55），深度/碰撞沿用现有规则。 */
export const BLOCK_FOOT = {
    w: ONE_CELL_BUILDING_FOOT.w,
    d: ONE_CELL_BUILDING_FOOT.d,
    offY: ONE_CELL_BUILDING_FOOT.offY,
    thick: 26,
};
export const BLOCK_FACE = {
    // 2026-08-17 二修：face 从格底移到格心（穿过格心，斜率 -0.5）——
    // 否则朝下邻格心距 face 仅 36px < 半厚26+半径28=54，右下/左下永远放不下。
    // 格心 face 使四邻格心距离 57.2px > 54，4 向都能吸附拼接。
    v: { A: { x: -32, y: 16 }, B: { x: 32, y: -16 } },
    h: { A: { x: -32, y: -16 }, B: { x: 32, y: 16 } },
};
export const BLOCK_VISUAL = Object.freeze({
    w: 260,     // 贴图内容约 122px ≈ 1 格
    h: 259,
    footOffsetY: 61,
});
export const BLOCK_FOOT_OFFSET = BLOCK_VISUAL.footOffsetY;

function _closestPointOnPolygon(x, y, vertices) {
    let best = null;
    for (let index = 0; index < vertices.length; index++) {
        const a = vertices[index];
        const b = vertices[(index + 1) % vertices.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq > 1e-9
            ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq))
            : 0;
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const dist = Math.hypot(x - px, y - py);
        if (!best || dist < best.distance) best = { x: px, y: py, distance: dist };
    }
    return best;
}

function _convexHull(points) {
    const sorted = points
        .map((point, index) => ({ ...point, _order: index }))
        .sort((a, b) => a.x - b.x || a.y - b.y);
    if (sorted.length <= 2) return sorted;
    const cross = (o, a, b) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const point of sorted) {
        while (lower.length >= 2
            && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-8) {
            lower.pop();
        }
        lower.push(point);
    }
    const upper = [];
    for (let index = sorted.length - 1; index >= 0; index--) {
        const point = sorted[index];
        while (upper.length >= 2
            && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-8) {
            upper.pop();
        }
        upper.push(point);
    }
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}

/** 方块墙贴图真实顶面：像素顶面先转成屏幕偏移，再把topZ加回地面世界坐标。 */
export function blockWallTopWalkGeometry(wall) {
    if (!wall?._isBlockCover) return null;
    const cfg = WALL_WALK_CONFIG.blockTopSurface;
    const source = Array.isArray(cfg.sourceSize) ? cfg.sourceSize : [1024, 1024];
    const verticesPx = cfg.verticesPx || {};
    const ordered = [
        ['rear', verticesPx.rear],
        ['right', verticesPx.right],
        ['front', verticesPx.front],
        ['left', verticesPx.left],
    ];
    if (ordered.some(([, point]) => !Array.isArray(point) || point.length < 2)) return null;
    const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
    const cacheKey = `${wall.x}:${wall.y}:${topZ}:${BLOCK_VISUAL.w}:${BLOCK_VISUAL.h}`;
    if (wall._wallTopWalkGeometry?.cacheKey === cacheKey) return wall._wallTopWalkGeometry;
    const sx = BLOCK_VISUAL.w / Math.max(1, Number(source[0]) || 1024);
    const sy = BLOCK_VISUAL.h / Math.max(1, Number(source[1]) || 1024);
    const localVertices = ordered.map(([key, point]) => ({
        key,
        x: (Number(point[0]) - source[0] / 2) * sx,
        y: -BLOCK_FOOT_OFFSET + (Number(point[1]) - source[1] / 2) * sy + topZ,
    }));
    const footprint = {
        x: wall.x,
        y: wall.y,
        _pixelFootprintLocal: localVertices,
    };
    const vertices = isoFootprintVertices(footprint);
    const center = {
        x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
        y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length,
    };
    wall._wallTopWalkGeometry = {
        cacheKey,
        footprint,
        vertices,
        center,
        edgeTolerance: Math.max(0, Number(cfg.edgeTolerance) || 0),
        stairAttachTolerance: Math.max(0, Number(cfg.stairAttachTolerance) || 0),
        wallConnectorTolerance: Math.max(0, Number(cfg.wallConnectorTolerance) || 0),
        wallConnectorOverlap: Math.max(0, Number(cfg.wallConnectorOverlap) || 0),
        wallConnectorSideMargin: Math.max(0, Number(cfg.wallConnectorSideMargin) || 0),
        wallJunctionOverlap: Math.max(0, Number(cfg.wallJunctionOverlap) || 0),
        neighborCenterTolerance: Math.max(0, Number(cfg.neighborCenterTolerance) || 0),
        footprintSamples: Math.max(8, Number(cfg.footprintSamples) || 24),
        footprintTolerance: Math.max(0, Number(cfg.footprintTolerance) || 0),
    };
    return wall._wallTopWalkGeometry;
}

function _edgeFacingPoint(vertices, target) {
    let best = null;
    for (let index = 0; index < vertices.length; index++) {
        const a = vertices[index];
        const b = vertices[(index + 1) % vertices.length];
        const midpoint = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
        const distance = Math.hypot(midpoint.x - target.x, midpoint.y - target.y);
        if (!best || distance < best.distance) best = { a, b, midpoint, distance, index };
    }
    return best;
}

function _movePointToward(point, target, distance) {
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6 || distance <= 0) return { x: point.x, y: point.y };
    const travel = Math.min(distance, length * 0.35);
    return {
        x: point.x + dx / length * travel,
        y: point.y + dy / length * travel,
    };
}

/**
 * 两块相邻同高方块墙的连续墙顶接缝。连接面会分别压进两侧墙顶，并沿接缝横向
 * 略微放宽；同一拓扑组件因此按“墙顶多边形并集”移动，不再逐块跨越零宽边界。
 */
export function blockWallTopConnectorGeometry(wallA, wallB) {
    if (!wallA?._isBlockCover || !wallB?._isBlockCover || wallA === wallB) return null;
    const topA = Number(wallA._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
    const topB = Number(wallB._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
    if (Math.abs(topA - topB) > 1) return null;
    const geometryA = blockWallTopWalkGeometry(wallA);
    const geometryB = blockWallTopWalkGeometry(wallB);
    if (!geometryA || !geometryB) return null;
    const expectedDistance = Math.hypot(
        ONE_CELL_BUILDING_FOOT.w / 2,
        ONE_CELL_BUILDING_FOOT.d / 2
    );
    const centerDistance = Math.hypot(wallB.x - wallA.x, wallB.y - wallA.y);
    const tolerance = Math.max(
        geometryA.neighborCenterTolerance,
        geometryB.neighborCenterTolerance
    );
    if (Math.abs(centerDistance - expectedDistance) > tolerance) return null;

    const overlap = Math.max(
        geometryA.wallConnectorOverlap,
        geometryB.wallConnectorOverlap
    );
    const sideMargin = Math.max(
        geometryA.wallConnectorSideMargin,
        geometryB.wallConnectorSideMargin
    );
    const cacheKey = [
        'wall-component-seam-v3',
        geometryA.cacheKey,
        geometryB.cacheKey,
        overlap,
        sideMargin,
    ].join('|');
    if (!wallA._wallTopConnectorCache) wallA._wallTopConnectorCache = new Map();
    const wallBKey = wallB.id || `${wallB.x},${wallB.y}`;
    const cached = wallA._wallTopConnectorCache.get(wallBKey);
    if (cached?.cacheKey === cacheKey) return cached;

    const edgeA = _edgeFacingPoint(geometryA.vertices, geometryB.center);
    const edgeB = _edgeFacingPoint(geometryB.vertices, geometryA.center);
    if (!edgeA || !edgeB) return null;
    let b1 = edgeB.a;
    let b2 = edgeB.b;
    const direct = Math.hypot(edgeA.a.x - b1.x, edgeA.a.y - b1.y)
        + Math.hypot(edgeA.b.x - b2.x, edgeA.b.y - b2.y);
    const crossed = Math.hypot(edgeA.a.x - b2.x, edgeA.a.y - b2.y)
        + Math.hypot(edgeA.b.x - b1.x, edgeA.b.y - b1.y);
    if (crossed < direct) [b1, b2] = [b2, b1];
    // 用两条相对墙顶边的共同切线生成规则连接面。这样旧存档存在1~2px格心偏差时，
    // 四个顶点仍保持两两平行，不会出现轴对齐矩形或斜切梯形侵入墙外。
    const edgeADx = edgeA.b.x - edgeA.a.x;
    const edgeADy = edgeA.b.y - edgeA.a.y;
    const edgeBDx = b2.x - b1.x;
    const edgeBDy = b2.y - b1.y;
    const edgeALength = Math.hypot(edgeADx, edgeADy);
    const edgeBLength = Math.hypot(edgeBDx, edgeBDy);
    if (edgeALength <= 1e-6 || edgeBLength <= 1e-6) return null;
    const tangentAX = edgeADx / edgeALength;
    const tangentAY = edgeADy / edgeALength;
    const tangentBX = edgeBDx / edgeBLength;
    const tangentBY = edgeBDy / edgeBLength;
    const tangentLength = Math.hypot(tangentAX + tangentBX, tangentAY + tangentBY);
    const tangentX = tangentLength > 1e-6
        ? (tangentAX + tangentBX) / tangentLength
        : tangentAX;
    const tangentY = tangentLength > 1e-6
        ? (tangentAY + tangentBY) / tangentLength
        : tangentAY;
    const halfSpan = Math.min(edgeALength, edgeBLength) * 0.5 + sideMargin;
    const insetA = _movePointToward(edgeA.midpoint, geometryA.center, overlap);
    const insetB = _movePointToward(edgeB.midpoint, geometryB.center, overlap);
    const normalX = -tangentY;
    const normalY = tangentX;
    const seamCenter = {
        x: (insetA.x + insetB.x) * 0.5,
        y: (insetA.y + insetB.y) * 0.5,
    };
    const signedHalfGap = ((insetB.x - insetA.x) * normalX
        + (insetB.y - insetA.y) * normalY) * 0.5;
    const alignedA = {
        x: seamCenter.x - normalX * signedHalfGap,
        y: seamCenter.y - normalY * signedHalfGap,
    };
    const alignedB = {
        x: seamCenter.x + normalX * signedHalfGap,
        y: seamCenter.y + normalY * signedHalfGap,
    };
    const a1 = { x: alignedA.x - tangentX * halfSpan, y: alignedA.y - tangentY * halfSpan };
    const a2 = { x: alignedA.x + tangentX * halfSpan, y: alignedA.y + tangentY * halfSpan };
    b1 = { x: alignedB.x - tangentX * halfSpan, y: alignedB.y - tangentY * halfSpan };
    b2 = { x: alignedB.x + tangentX * halfSpan, y: alignedB.y + tangentY * halfSpan };
    const vertices = [
        { key: 'a1', x: a1.x, y: a1.y },
        { key: 'b1', x: b1.x, y: b1.y },
        { key: 'b2', x: b2.x, y: b2.y },
        { key: 'a2', x: a2.x, y: a2.y },
    ];
    const footprint = {
        x: 0,
        y: 0,
        _pixelFootprintLocal: vertices,
    };
    const connector = {
        cacheKey,
        wallA,
        wallB,
        topZ: (topA + topB) * 0.5,
        vertices,
        footprint,
        center: {
            x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
            y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length,
        },
        tolerance: Math.max(
            geometryA.wallConnectorTolerance,
            geometryB.wallConnectorTolerance
        ),
        overlap,
        sideMargin,
    };
    wallA._wallTopConnectorCache.set(wallBKey, connector);
    return connector;
}

/** 四块同高相邻墙围成的最小网格中心补片；沿墙顶四个内角生成菱形，不扩大外墙边界。 */
export function blockWallTopJunctionGeometry(walls) {
    const uniqueWalls = Array.from(new Set(walls || [])).filter((wall) => wall?._isBlockCover);
    if (uniqueWalls.length !== 4) return null;
    const geometries = uniqueWalls.map((wall) => blockWallTopWalkGeometry(wall));
    if (geometries.some((geometry) => !geometry)) return null;
    const topZs = uniqueWalls.map((wall) =>
        Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ);
    if (Math.max(...topZs) - Math.min(...topZs) > 1) return null;
    const center = {
        x: geometries.reduce((sum, geometry) => sum + geometry.center.x, 0) / geometries.length,
        y: geometries.reduce((sum, geometry) => sum + geometry.center.y, 0) / geometries.length,
    };
    const overlap = Math.max(...geometries.map((geometry) => geometry.wallJunctionOverlap));
    const vertices = geometries.map((geometry, index) => {
        const corner = geometry.vertices.reduce((best, point) => {
            const distance = Math.hypot(point.x - center.x, point.y - center.y);
            return !best || distance < best.distance ? { point, distance } : best;
        }, null)?.point;
        if (!corner) return null;
        const inset = _movePointToward(corner, geometry.center, overlap);
        return {
            key: `j${index}`,
            x: inset.x,
            y: inset.y,
        };
    }).filter(Boolean).sort((left, right) =>
        Math.atan2(left.y - center.y, left.x - center.x)
        - Math.atan2(right.y - center.y, right.x - center.x));
    if (vertices.length !== 4) return null;
    const footprint = { x: 0, y: 0, _pixelFootprintLocal: vertices };
    return {
        cacheKey: ['wall-junction-v1', ...geometries.map((geometry) => geometry.cacheKey).sort(), overlap].join('|'),
        walls: uniqueWalls,
        topZ: topZs.reduce((sum, value) => sum + value, 0) / topZs.length,
        vertices,
        footprint,
        center,
        tolerance: Math.max(...geometries.map((geometry) => geometry.wallConnectorTolerance)),
        overlap,
    };
}

const elevatedTopology = new ElevatedTopology({
    isWall: (wall) => !!(wall?._isWalkableWall && !wall?._sinking
        && Array.isArray(wall?._faceLine)),
    getTopZ: (wall) => Number(wall?._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ,
    connectorFor: (wallA, wallB) => blockWallTopConnectorGeometry(wallA, wallB),
    junctionFor: (walls) => blockWallTopJunctionGeometry(walls),
    neighborToleranceFor: (wall) =>
        blockWallTopWalkGeometry(wall)?.neighborCenterTolerance || 0,
    stepVectors: [
        [ONE_CELL_BUILDING_FOOT.w / 2, ONE_CELL_BUILDING_FOOT.d / 2],
        [-ONE_CELL_BUILDING_FOOT.w / 2, -ONE_CELL_BUILDING_FOOT.d / 2],
        [-ONE_CELL_BUILDING_FOOT.w / 2, ONE_CELL_BUILDING_FOOT.d / 2],
        [ONE_CELL_BUILDING_FOOT.w / 2, -ONE_CELL_BUILDING_FOOT.d / 2],
    ],
});

function _blockWallIndex(entitySource) {
    return elevatedTopology.ensure(entitySource, DefenseSystem?.staircases || []);
}

function _blockWallNeighbors(wall, index) {
    if (!wall || !index) return [];
    if (typeof index.neighbors === 'function') return index.neighbors(wall);
    const stepX = ONE_CELL_BUILDING_FOOT.w / 2;
    const stepY = ONE_CELL_BUILDING_FOOT.d / 2;
    const tolerance = blockWallTopWalkGeometry(wall)?.neighborCenterTolerance || 0;
    const findAt = (x, y) => {
        const roundedX = Math.round(x);
        const roundedY = Math.round(y);
        const exact = index.get(`${roundedX},${roundedY}`);
        if (exact) return Array.isArray(exact) ? exact[0] : exact;
        if (tolerance <= 0) return null;
        const radius = Math.ceil(tolerance);
        let best = null;
        for (let ox = -radius; ox <= radius; ox++) {
            for (let oy = -radius; oy <= radius; oy++) {
                const values = index.get(`${roundedX + ox},${roundedY + oy}`);
                for (const candidate of (Array.isArray(values) ? values : [values])) {
                    if (!candidate) continue;
                    const distance = Math.hypot(candidate.x - x, candidate.y - y);
                    if (distance > tolerance) continue;
                    if (!best || distance < best.distance) best = { candidate, distance };
                }
            }
        }
        return best?.candidate || null;
    };
    return [
        [stepX, stepY],
        [-stepX, -stepY],
        [-stepX, stepY],
        [stepX, -stepY],
    ].map(([dx, dy]) => findAt(wall.x + dx, wall.y + dy)).filter(Boolean);
}

/** 在方块墙顶按四邻格寻找连续路线，供远端/转角墙顶RTS目标使用。 */
export function blockWallTopRoute(startWall, targetWall, entitySource = null) {
    if (!startWall?._isBlockCover || !targetWall?._isBlockCover) return [];
    if (startWall === targetWall) return [startWall];
    const source = entitySource || Game?.entities;
    const index = _blockWallIndex(source);
    if (typeof index.route === 'function') return index.route(startWall, targetWall);
    const queue = [startWall];
    const previous = new Map([[startWall, null]]);
    while (queue.length) {
        const wall = queue.shift();
        for (const neighbor of _blockWallNeighbors(wall, index)) {
            if (previous.has(neighbor)) continue;
            const topA = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            const topB = Number(neighbor._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            if (Math.abs(topA - topB) > 1) continue;
            if (!blockWallTopConnectorGeometry(wall, neighbor)) continue;
            previous.set(neighbor, wall);
            if (neighbor === targetWall) {
                const route = [];
                let cursor = targetWall;
                while (cursor) {
                    route.push(cursor);
                    cursor = previous.get(cursor) || null;
                }
                return route.reverse();
            }
            queue.push(neighbor);
        }
    }
    return [];
}

function liveWallsForStaircase(staircase, entitySource = null) {
    const wall = staircase?.wall;
    if (!wall?.active) return [];
    const source = entitySource || Game?.entities;
    if (wall._isBlockCover && source) {
        const component = _blockWallIndex(source).component(wall);
        return component.length ? component.filter((candidate) => candidate?.active) : [wall];
    }
    return collectConnectedWalkableWalls(wall, source);
}

function staircaseServesWall(staircase, wall, entitySource = null) {
    if (!staircase?.active || !wall?.active) return false;
    if (staircase.wall === wall) return true;
    return liveWallsForStaircase(staircase, entitySource).includes(wall);
}

function appendWallTopRoutePoints(route, wallPath, fallbackZ) {
    for (const wall of wallPath || []) {
        const geometry = blockWallTopWalkGeometry(wall);
        if (!geometry) continue;
        const previous = route[route.length - 1];
        if (previous && Math.hypot(
            previous.x - geometry.center.x,
            previous.y - geometry.center.y
        ) < 1) continue;
        route.push({
            x: geometry.center.x,
            y: geometry.center.y,
            z: Number(wall._wallTopZ) || fallbackZ || WALL_WALK_CONFIG.defaultTopZ,
            surfaceKind: 'wall_walk',
            wallId: wall.id,
        });
    }
    return route;
}

function appendUniqueRouteTarget(route, target) {
    const previous = route[route.length - 1];
    if (!previous || Math.hypot(previous.x - target.x, previous.y - target.y) >= 1) {
        route.push({ ...target });
    }
    return route;
}

function finalizeSurfaceRoute(route) {
    if (!Array.isArray(route)) return [];
    for (let index = 1; index < route.length; index++) {
        const previous = route[index - 1];
        const current = route[index];
        const fromKind = previous?.surfaceKind || ((Number(previous?.z) || 0) > 1 ? 'elevated' : 'ground');
        const toKind = current?.surfaceKind || ((Number(current?.z) || 0) > 1 ? 'elevated' : 'ground');
        if (fromKind === 'ground' && toKind === 'stairs') {
            current.transition = 'ground_to_stairs';
        } else if (fromKind === 'stairs' && toKind === 'ground') {
            current.transition = 'stairs_to_ground';
        } else if (fromKind === 'stairs' && toKind === 'wall_walk') {
            current.transition = 'stairs_to_wall';
        } else if (fromKind === 'wall_walk' && toKind === 'stairs') {
            current.transition = 'wall_to_stairs';
        } else if (toKind === 'stairs') {
            current.transition = 'stair_traverse';
        } else if (toKind === 'wall_walk') {
            current.transition = 'wall_traverse';
        } else {
            delete current.transition;
        }
    }
    return route;
}

function _blockWallComponent(startWall, index) {
    if (!startWall || !index) return [];
    if (typeof index.component === 'function') return index.component(startWall);
    const queue = [startWall];
    const seen = new Set();
    const walls = [];
    while (queue.length) {
        const wall = queue.shift();
        if (!wall || seen.has(wall)) continue;
        seen.add(wall);
        walls.push(wall);
        for (const neighbor of _blockWallNeighbors(wall, index)) {
            if (seen.has(neighbor)) continue;
            const topA = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            const topB = Number(neighbor._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            if (Math.abs(topA - topB) <= 1
                && blockWallTopConnectorGeometry(wall, neighbor)) queue.push(neighbor);
        }
    }
    return walls;
}

function _projectPointToSegment(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const rawT = lengthSq > 1e-9
        ? ((x - a.x) * dx + (y - a.y) * dy) / lengthSq
        : 0;
    const t = Math.max(0, Math.min(1, rawT));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    return { x: px, y: py, t, rawT, distance: Math.hypot(x - px, y - py) };
}

/**
 * Stronghold式墙顶导航图：墙块中心=节点，相邻墙=边，楼梯连接面=Portal边。
 * 返回输入点在当前连续墙图上的最近投影。
 */
export function wallTopGraphProjection(
    x,
    y,
    startWall,
    entitySource = null,
    staircases = null,
    localOnly = false,
    preferredAxis = null,
    movementIntent = null
) {
    if (!startWall?._isBlockCover) return null;
    const source = entitySource || Game?.entities;
    const index = _blockWallIndex(source);
    const component = _blockWallComponent(startWall, index);
    if (!component.length) return null;
    const componentSet = new Set(component);
    const seenEdges = new Set();
    const edges = [];
    for (const wall of component) {
        const geometry = blockWallTopWalkGeometry(wall);
        if (!geometry) continue;
        for (const neighbor of _blockWallNeighbors(wall, index)) {
            if (!componentSet.has(neighbor)) continue;
            const leftKey = wall.id || `${wall.x},${wall.y}`;
            const rightKey = neighbor.id || `${neighbor.x},${neighbor.y}`;
            const edgeKey = leftKey < rightKey
                ? `${leftKey}|${rightKey}`
                : `${rightKey}|${leftKey}`;
            if (seenEdges.has(edgeKey)) continue;
            seenEdges.add(edgeKey);
            const neighborGeometry = blockWallTopWalkGeometry(neighbor);
            if (!neighborGeometry || !blockWallTopConnectorGeometry(wall, neighbor)) continue;
            edges.push({
                kind: 'wall',
                wallA: wall,
                wallB: neighbor,
                a: geometry.center,
                b: neighborGeometry.center,
            });
        }
    }
    for (const staircase of staircases || []) {
        if (!staircase?.active || !componentSet.has(staircase.wall)) continue;
        const wallGeometry = blockWallTopWalkGeometry(staircase.wall);
        const connector = staircase.wallConnectorSurface?.();
        if (!wallGeometry || !connector) continue;
        edges.push({
            kind: 'stair_portal',
            wallA: staircase.wall,
            wallB: staircase.wall,
            staircase,
            a: wallGeometry.center,
            b: connector.entry,
        });
    }
    const candidateEdges = localOnly
        ? edges.filter((edge) => edge.wallA === startWall || edge.wallB === startWall)
        : edges;
    let best = null;
    let bestAlignment = -Infinity;
    if (!candidateEdges.length) {
        const geometry = blockWallTopWalkGeometry(startWall);
        return geometry ? {
            x: geometry.center.x,
            y: geometry.center.y,
            distance: Math.hypot(x - geometry.center.x, y - geometry.center.y),
            wall: startWall,
            kind: 'wall_node',
            component,
        } : null;
    }
    for (const edge of candidateEdges) {
        const projected = _projectPointToSegment(x, y, edge.a, edge.b);
        let alignment = 0;
        if (localOnly && preferredAxis) {
            const from = edge.wallA === startWall ? edge.a : edge.b;
            const to = edge.wallA === startWall ? edge.b : edge.a;
            const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            alignment = ((to.x - from.x) / length) * preferredAxis.x
                + ((to.y - from.y) / length) * preferredAxis.y;
            if (alignment < bestAlignment - 1e-5) continue;
            if (alignment > bestAlignment + 1e-5) {
                best = null;
                bestAlignment = alignment;
            }
        }
        if (best && projected.distance >= best.distance) continue;
        let projectedWall;
        if (edge.kind !== 'wall' || !localOnly) {
            projectedWall = edge.kind === 'wall' && projected.t >= 0.5
                ? edge.wallB
                : edge.wallA;
        } else if (edge.wallA === startWall) {
            projectedWall = projected.t >= WALL_WALK_CONFIG.routeNodeSwitchT
                ? edge.wallB
                : startWall;
        } else {
            projectedWall = projected.t <= 1 - WALL_WALK_CONFIG.routeNodeSwitchT
                ? edge.wallA
                : startWall;
        }
        best = {
            ...projected,
            kind: edge.kind,
            edge,
            staircase: edge.staircase || null,
            wall: projectedWall,
            component,
        };
    }
    if (localOnly && best?.kind === 'wall' && movementIntent) {
        const intentLength = Math.hypot(movementIntent.x, movementIntent.y);
        const orientedEdge = (edge, fromWall) => {
            if (edge?.kind !== 'wall') return null;
            if (edge.wallA === fromWall) {
                return {
                    from: edge.a,
                    to: edge.b,
                    nextWall: edge.wallB,
                    rawT: edge === best.edge ? best.rawT : 0,
                };
            }
            if (edge.wallB === fromWall) {
                return {
                    from: edge.b,
                    to: edge.a,
                    nextWall: edge.wallA,
                    rawT: edge === best.edge ? 1 - best.rawT : 0,
                };
            }
            return null;
        };
        const first = orientedEdge(best.edge, startWall);
        if (intentLength > 1e-6 && first?.rawT > 1 + 1e-6) {
            const firstLength = Math.hypot(
                first.to.x - first.from.x,
                first.to.y - first.from.y
            ) || 1;
            let remaining = (first.rawT - 1) * firstLength;
            let nodeWall = first.nextWall;
            let nodePoint = first.to;
            let previousEdge = best.edge;
            for (let hop = 0; hop < 4 && remaining > 1e-6; hop++) {
                let next = null;
                for (const edge of edges) {
                    if (edge === previousEdge || edge.kind !== 'wall') continue;
                    const oriented = orientedEdge(edge, nodeWall);
                    if (!oriented) continue;
                    const length = Math.hypot(
                        oriented.to.x - oriented.from.x,
                        oriented.to.y - oriented.from.y
                    ) || 1;
                    const alignment = (
                        (oriented.to.x - oriented.from.x) * movementIntent.x
                        + (oriented.to.y - oriented.from.y) * movementIntent.y
                    ) / (length * intentLength);
                    if (alignment < WALL_WALK_CONFIG.routeMinAlignment) continue;
                    if (!next || alignment > next.alignment) {
                        next = { edge, oriented, length, alignment };
                    }
                }
                if (!next) {
                    return {
                        ...best,
                        x: nodePoint.x,
                        y: nodePoint.y,
                        distance: Math.hypot(x - nodePoint.x, y - nodePoint.y),
                        wall: nodeWall,
                    };
                }
                const travel = Math.min(remaining, next.length);
                const progress = travel / next.length;
                const px = next.oriented.from.x
                    + (next.oriented.to.x - next.oriented.from.x) * progress;
                const py = next.oriented.from.y
                    + (next.oriented.to.y - next.oriented.from.y) * progress;
                const projectedWall = progress >= WALL_WALK_CONFIG.routeNodeSwitchT
                    ? next.oriented.nextWall
                    : nodeWall;
                if (remaining <= next.length + 1e-6) {
                    return {
                        ...best,
                        x: px,
                        y: py,
                        t: progress,
                        rawT: progress,
                        distance: Math.hypot(x - px, y - py),
                        edge: next.edge,
                        wall: projectedWall,
                    };
                }
                remaining -= next.length;
                nodeWall = next.oriented.nextWall;
                nodePoint = next.oriented.to;
                previousEdge = next.edge;
            }
            return {
                ...best,
                x: nodePoint.x,
                y: nodePoint.y,
                distance: Math.hypot(x - nodePoint.x, y - nodePoint.y),
                wall: nodeWall,
            };
        }
    }
    return best;
}

function _blockWallUnionAtPoint(x, y, index, margin = 0, preferredWall = null) {
    if (!index) return null;
    let best = null;
    const indexedWalls = typeof index.nearbyWalls === 'function'
        ? index.nearbyWalls(x, y)
        : Array.from(index.values()).flatMap((value) => Array.isArray(value) ? value : [value]);
    for (const wall of indexedWalls) {
        const geometry = blockWallTopWalkGeometry(wall);
        if (!geometry || !pointInIsoFootprint(x, y, geometry.footprint, margin)) continue;
        const distance = Math.hypot(x - geometry.center.x, y - geometry.center.y);
        const hit = { wall, geometry, connector: null, distance };
        if (wall === preferredWall) return hit;
        if (!best || distance < best.distance) best = hit;
    }
    if (best) return best;

    const hasIndexedConnectors = typeof index.nearbyConnectors === 'function';
    const hasIndexedJunctions = typeof index.nearbyJunctions === 'function';
    if (hasIndexedConnectors) {
        for (const connector of index.nearbyConnectors(x, y)) {
            if (!connector || !pointInIsoFootprint(
                x,
                y,
                connector.footprint,
                margin
            )) continue;
            const { wallA, wallB } = connector;
            const preferred = preferredWall === wallA
                ? wallA
                : (preferredWall === wallB ? wallB : null);
            const owner = preferred || (
                Math.hypot(x - wallA.x, y - wallA.y)
                    <= Math.hypot(x - wallB.x, y - wallB.y)
                    ? wallA
                    : wallB
            );
            return {
                wall: owner,
                geometry: blockWallTopWalkGeometry(owner),
                connector,
                distance: Math.hypot(x - connector.center.x, y - connector.center.y),
            };
        }
    }
    if (hasIndexedJunctions) {
        for (const junction of index.nearbyJunctions(x, y)) {
            if (!junction || !pointInIsoFootprint(
                x,
                y,
                junction.footprint,
                margin
            )) continue;
            const preferred = junction.walls.includes(preferredWall) ? preferredWall : null;
            const owner = preferred || junction.walls.reduce((best, wall) =>
                !best || Math.hypot(x - wall.x, y - wall.y)
                    < Math.hypot(x - best.x, y - best.y)
                    ? wall
                    : best, null);
            return {
                wall: owner,
                geometry: blockWallTopWalkGeometry(owner),
                connector: null,
                junction,
                distance: Math.hypot(x - junction.center.x, y - junction.center.y),
            };
        }
    }
    if (hasIndexedConnectors || hasIndexedJunctions) return null;

    const seen = new Set();
    for (const wall of indexedWalls) {
        for (const neighbor of _blockWallNeighbors(wall, index)) {
            const leftKey = wall.id || `${wall.x},${wall.y}`;
            const rightKey = neighbor.id || `${neighbor.x},${neighbor.y}`;
            const pairKey = leftKey < rightKey
                ? `${leftKey}|${rightKey}`
                : `${rightKey}|${leftKey}`;
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);
            const connector = blockWallTopConnectorGeometry(wall, neighbor);
            if (!connector || !pointInIsoFootprint(
                x,
                y,
                connector.footprint,
                margin
            )) continue;
            const preferred = preferredWall === wall
                ? wall
                : (preferredWall === neighbor ? neighbor : null);
            const owner = preferred || (
                Math.hypot(x - wall.x, y - wall.y)
                    <= Math.hypot(x - neighbor.x, y - neighbor.y)
                    ? wall
                    : neighbor
            );
            return {
                wall: owner,
                geometry: blockWallTopWalkGeometry(owner),
                connector,
                distance: Math.hypot(x - connector.center.x, y - connector.center.y),
            };
        }
    }
    return null;
}

/**
 * 用单位真实groundRadius检查整个脚底圆是否被“墙顶多边形∪墙间连接面”承托。
 * 采样在未压缩的iso地面平面生成，再投回屏幕世界坐标。
 */
function _blockWallFootprintSupport(unit, x, y, index, preferredWall = null) {
    if (!index) return null;
    const centerHit = _blockWallUnionAtPoint(x, y, index, 0, preferredWall);
    if (!centerHit) return null;
    // footprint半径小于一格，只需检查当前承托墙、连接面的两端墙及其四邻格。
    const localIndex = new Map();
    const addLocal = (wall) => {
        if (!wall) return;
        const key = `${Math.round(wall.x)},${Math.round(wall.y)}`;
        const walls = localIndex.get(key) || [];
        if (!walls.includes(wall)) walls.push(wall);
        localIndex.set(key, walls);
    };
    const seeds = new Set([
        centerHit.wall,
        centerHit.connector?.wallA,
        centerHit.connector?.wallB,
        ...(centerHit.junction?.walls || []),
    ].filter(Boolean));
    for (const wall of seeds) {
        addLocal(wall);
        for (const neighbor of _blockWallNeighbors(wall, index)) addLocal(neighbor);
    }
    const localWalls = new Set(Array.from(localIndex.values()).flat());
    const localConnectors = typeof index.nearbyConnectors === 'function'
        ? index.nearbyConnectors(x, y, 192).filter((connector) =>
            localWalls.has(connector.wallA) && localWalls.has(connector.wallB))
        : [];
    const localJunctions = typeof index.nearbyJunctions === 'function'
        ? index.nearbyJunctions(x, y, 192).filter((junction) =>
            junction.walls.every((wall) => localWalls.has(wall)))
        : [];
    if (localConnectors.length || localJunctions.length) {
        localIndex.nearbyConnectors = () => localConnectors;
        localIndex.nearbyJunctions = () => localJunctions;
    }
    const geometry = centerHit.geometry;
    const radius = Math.max(
        0,
        Number(unit?._wallWalkSupportRadius)
            || Number(unit?.groundRadius)
            || Number(unit?.collisionRadius)
            || 0
    );
    if (radius > WALL_WALK_CONFIG.maxUnitRadius + 1e-6) return null;
    if (radius <= 1e-6) return { ...centerHit, radius };
    const samples = geometry?.footprintSamples || 24;
    const tolerance = geometry?.footprintTolerance || 0;
    for (const ratio of [1, 0.7]) {
        for (let indexSample = 0; indexSample < samples; indexSample++) {
            const angle = indexSample / samples * Math.PI * 2;
            const local = isoLocalToWorldDelta(
                Math.cos(angle) * radius * ratio,
                Math.sin(angle) * radius * ratio
            );
            if (!_blockWallUnionAtPoint(
                x + local.x,
                y + local.y,
                localIndex,
                tolerance,
                preferredWall
            )) return null;
        }
    }
    return { ...centerHit, radius };
}

function _clampBlockWallFootprintToSupport(unit, x, y, wall, index) {
    const supported = _blockWallFootprintSupport(unit, x, y, index, wall);
    if (supported) return { x, y, support: supported };
    const geometry = blockWallTopWalkGeometry(wall);
    if (!geometry) return null;
    const safe = _blockWallFootprintSupport(
        unit,
        geometry.center.x,
        geometry.center.y,
        index,
        wall
    );
    if (!safe) return null;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 18; iteration++) {
        const t = (low + high) * 0.5;
        const px = x + (geometry.center.x - x) * t;
        const py = y + (geometry.center.y - y) * t;
        if (_blockWallFootprintSupport(unit, px, py, index, wall)) high = t;
        else low = t;
    }
    const px = x + (geometry.center.x - x) * high;
    const py = y + (geometry.center.y - y) * high;
    return {
        x: px,
        y: py,
        support: _blockWallFootprintSupport(unit, px, py, index, wall),
    };
}

function _nearestBlockWallFootprintSupport(unit, x, y, index, preferredWall = null) {
    if (!index) return null;
    // 恢复只能落在当前载体或直接邻墙，禁止扫描整条连通墙链后把单位跳到远端墙心。
    const walls = preferredWall
        ? [preferredWall, ...(index.neighbors?.(preferredWall) || [])]
        : (index.nearbyWalls?.(x, y, 192) || []);
    const candidates = walls
        .filter((wall, position) => wall?.active && walls.indexOf(wall) === position)
        .map((wall) => ({ wall, geometry: blockWallTopWalkGeometry(wall) }))
        .filter((candidate) => candidate.geometry)
        .sort((left, right) =>
            Math.hypot(x - left.geometry.center.x, y - left.geometry.center.y)
            - Math.hypot(x - right.geometry.center.x, y - right.geometry.center.y));
    for (const candidate of candidates) {
        const support = _blockWallFootprintSupport(
            unit,
            candidate.geometry.center.x,
            candidate.geometry.center.y,
            index,
            candidate.wall
        );
        if (support) {
            return {
                x: candidate.geometry.center.x,
                y: candidate.geometry.center.y,
                support,
            };
        }
    }
    return null;
}

/** 调试/验证入口：查询指定单位的完整脚底footprint是否被墙顶道路联合区域承托。 */
export function blockWallFootprintSupportAt(
    unit,
    x,
    y,
    entitySource = null,
    preferredWall = null
) {
    const source = entitySource || Game?.entities;
    return _blockWallFootprintSupport(
        unit,
        x,
        y,
        _blockWallIndex(source),
        preferredWall
    );
}

/**
 * 防御塔视觉几何（2026-08-04 从塔图分离标定，arm 贴图本地坐标）：
 * - 塔基座贴图 = 塔图去掉顶部机械臂（正面平视，170×262 显示，footOffsetY 131）；
 * - 机械臂贴图 = 从塔图裁出的顶部臂区（347×64），枢轴=塔顶中心 (173,64)，
 *   臂尖挂载点=(331,5)；臂显示按宽度 170 等比缩放（s≈0.49）；
 * - pivotWorldY：枢轴世界 Y 相对塔脚底的偏移（≈塔可见顶面）。
 */
export const DEFENSE_TOWER_VISUAL = {
    scale: 1,
    base: {
        w: 170,
        h: 262,
        footOffsetY: 131,
        // 防御塔实体仍以前顶点为逻辑锚点；贴图接地点移动到标准 2x2 footprint 中心。
        footprintCenterOffsetY: TWO_BY_TWO_BUILDING_FOOT.offY,
    },
    arm: {
        // 2026-08-14 预渲染 3D 旋转帧：Blender 绕塔顶轴渲染 48 帧（7.5°×48），
        // 每帧真等距透视（肘关节/前臂随角度真实转动），游戏按 aimAngle 选帧显示，
        // 不再对单帧贴图做 2D 旋转。标定见 tools/prep-defense-tower-frames.py。
        w: 137,
        h: 86,
        s: 137 / 261,
        frames: 48,
        frameW: 261,
        frameH: 164,
        pivot: { x: 131, y: 82 }, // 帧内枢轴像素（竖枢轴柱投影，各帧恒定）
        pivotWorldY: 235,
        // 臂尖椭圆路径（模型单位，等距投影：x 全量、y 按 0.5 缩短）：
        // tipOX = gameScale*k*reach*cosθ；tipOY = gameScale*k*(0.5*reach*sinθ - 0.866*dz)
        // （θ=aimAngle，游戏 y 向下；2026-08-14 修正下半区枪口落到塔顶的符号 bug）
        reach: 50,
        dz: 0,
        k: 2.56,
        gameScale: 0.524691,
        naturalAngle: 0,
    },
    weapon: {
        // 挂载武器显示高度（按高度等比缩放，与玩家枪械 setScale 口径一致；朝左 flipY）
        // 2026-08-14：按新短臂（70px 高）等比缩小约 40%
        heights: { bow: 48, pkm: 40, rpd: 40, m249: 40, ultimax100: 40, mg42: 40, fusion_core_lmg: 40, singularity_loom_lmg: 40, celestial_cartographer_lmg: 40, grave_covenant_cantor_lmg: 40, akm: 38, stg44: 38, m416: 38, qbz95: 37, frontier_rifle: 38, vengeance_rifle: 40, astral_tide_rifle: 40, zero_point_rifle: 40, corona_cadence_rifle: 40, terminal_echo_rifle: 40, qbz191: 37, qjb201: 40, shotgun: 42, energy_lmg: 40 },
        defaultHeight: 36,
        // 枪管裁剪（"枪插进机械臂"假象，2026-08-14）：武器贴图只取前 1/3 枪管段，
        // 切口端（origin x=0）对齐臂尖，看起来枪管从机械臂/钩子里伸出。
        // 纹理坐标 = 贴图内枪管段裁剪框；height = 枪管显示厚度（游戏px，对齐臂梁 ~11px）。
        // 按 weaponId 配置（霰弹 super90/saiga12k 同 type 不同贴图必须区分）；
        // 未配置的武器（如弓）退回整枪渲染（heights）。
        barrel: {
            weapon6:  { x: 1326, y: 950,  w: 619, h: 149, height: 11 }, // PKM
            weapon31: { x: 1336, y: 863,  w: 624, h: 498, height: 12 }, // RPD
            weapon32: { x: 1336, y: 832,  w: 624, h: 560, height: 12 }, // M249 SAW
            weapon33: { x: 1336, y: 876,  w: 624, h: 472, height: 12 }, // Ultimax 100 Mk8
            weapon34: { x: 1336, y: 999,  w: 624, h: 150, height: 12 }, // MG42
            weapon35: { x: 1336, y: 803,  w: 624, h: 618, height: 12 }, // 熔核轻机枪
            weapon36: { x: 1335, y: 925,  w: 625, h: 300, height: 12 }, // 奇点织机
            weapon37: { x: 1335, y: 900,  w: 625, h: 300, height: 12 }, // 天穹测绘者
            weapon38: { x: 1335, y: 900,  w: 625, h: 300, height: 12 }, // 冥约颂炮
            weapon7:  { x: 1337, y: 884,  w: 623, h: 183, height: 11 }, // AKM
            weapon23: { x: 1336, y: 818,  w: 624, h: 588, height: 11 }, // STG-44
            weapon21: { x: 1334, y: 828,  w: 623, h: 193, height: 11 }, // M416
            weapon24: { x: 1336, y: 754,  w: 624, h: 716, height: 12 }, // QBZ-95
            weapon25: { x: 1336, y: 870,  w: 625, h: 310, height: 12 }, // 边境突击步枪
            weapon26: { x: 1335, y: 900,  w: 625, h: 300, height: 13 }, // 复仇之神
            weapon27: { x: 1335, y: 900,  w: 625, h: 300, height: 13 }, // 星潮协议
            weapon28: { x: 1335, y: 900,  w: 625, h: 300, height: 13 }, // 零点仲裁
            weapon29: { x: 1335, y: 900,  w: 625, h: 300, height: 13 }, // 日冕裁律
            weapon30: { x: 1335, y: 900,  w: 625, h: 300, height: 13 }, // 终末回声
            weapon8:  { x: 1335, y: 586,  w: 625, h: 251, height: 12 }, // QBZ-191
            weapon11: { x: 1325, y: 916,  w: 619, h: 151, height: 11 }, // QJB-201
            weapon12: { x: 1335, y: 1010, w: 625, h: 175, height: 12 }, // Super90
            weapon13: { x: 1335, y: 500,  w: 625, h: 283, height: 14 }, // SAIGA-12K
            weapon15: { x: 1335, y: 886,  w: 625, h: 381, height: 16 }, // 能量轻机枪
        },
    },
};

/** 城墙楼梯单段预览与实体共用的显示标定。 */
export const WALL_STAIR_VISUAL = Object.freeze({
    // 单段占一个 128×64 等距格；多段由同一贴图按格位与 baseZ 逐段拼接。
    scale: 1,
    w: WALL_STAIR_CONFIG.displayWidth,
    h: WALL_STAIR_CONFIG.displayHeight,
    offsetX: 0,
    footOffsetY: 0,
});

// ==================== 基地核心 ====================

class DefenseBase extends Combatant {
    constructor(x, y, config = {}) {
        super(x, y, {
            faction: 'player',
            hp: config.hp ?? DEFENSE_CONFIG.base.hp,
            maxHp: config.maxHp ?? DEFENSE_CONFIG.base.hp,
            size: config.size ?? 46,
            collisionRadius: config.radius ?? DEFENSE_CONFIG.base.radius,
            name: config.name ?? '基地核心',
        });
        this.id = config.id || 'defense_base';
        this._isDefenseStructure = true;
        this._isDefenseBase = true; // 2026-08-15：过门追击逻辑的最高优先级目标标记
        this._attackSlots = 6; // 基地 footprint 大，可同时容纳更多攻击者（拥挤分摊上限，2026-08-16）
        this.noSeparation = true;
        this.immovable = true; // 基地核心同掩体口径：不可被击退/移动（2026-08-14 补齐）
        this.noNameLabel = true; // 名字/HP 走 _syncNeutralEntities 的贴图标签（避免与 HUD 重复）
        this._noShadow = true;   // 障碍物取消脚底阴影（贴图自带接地底座，无投影）
        const def = config.def ?? DEFENSE_CONFIG.base.def;
        const mdef = config.mdef ?? DEFENSE_CONFIG.base.mdef;
        this.def = def;
        this.mdef = mdef;
        this.data.def = def;
        this.data.mdef = mdef;
        // 贴图：Blender 建模重建（立方体 + 扁平底座 + 大理石贴图，2026-08-16，
        // 规格 _blockout_specs/defense_base.json，渲染 assets/terrain/defense_base.png）
        this.spriteCfg = {
            idleKey: 'defense_base',
            size: 440,
            sizeH: 366,
            footOffsetY: 184,
            visualFootprint: {
                centerXRatio: 0.5,
                centerYRatio: 0.653005,
                widthRatio: 1,
                depthRatio: 0.699454,
                scaleMode: 'strict',
            },
            autoFootprint: false,
        };
        this.footOffsetY = 184;
        applyBuildingFootprint(this, 4);
        // 统一遮挡锚线（接地线 = 贴图显示半宽；单位在其后 → 被建筑遮挡，在前/同线 → 盖过建筑）
        setupStructureDepth(this);
        this._onDestroyed = config.onDestroyed || null;
        this.rebuildCollider();
    }

    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡由 onDeath 接管（避免默认 active=false + 血雾，保持精灵下沉）
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 基地核心沉陷死亡（2026-08-16 推广）：触发失败回调 + 沉陷清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        if (typeof this._onDestroyed === 'function') this._onDestroyed(this);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 70, '基地核心被摧毁！防守失败', '#ff5555'));
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    update(dt) {
        super.update(dt);
    }
}

// ==================== 防御塔 ====================

// ==================== 掩体（可被攻击的防御墙段）====================

class DefenseCover extends Combatant {
    constructor(x, y, config = {}) {
        const grade = config.grade || 'F';
        const orient = config.orient || 'h';
        // 有效朝向：镜像（F）只翻贴图，视觉方向 = 逻辑方向 h/v 互换。
        // 吸附端点、碰撞 footprint、底边线（face line）一律按有效朝向取，
        // 保证「镜像后拼接吸附 + 碰撞体积跟随视觉」一致（2026-08-05 优化）。
        const mirror = !!config.mirror;
        const eff = mirror ? (orient === 'v' ? 'h' : 'v') : orient;
        const isBlock = !!config.block; // 2026-08-17：1×1 方格块（单一贴图）
        const hp = config.hp ?? (DEFENSE_CONFIG.covers.hp[grade] ?? 400);
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: config.size ?? 60,
            collisionRadius: 26,
            name: config.name ?? `掩体·${grade}级`,
        });
        this.id = config.id || `defense_cover_${grade}_${orient}_${Math.random().toString(36).slice(2, 7)}`;
          this._isDefenseCover = true; // HUD 专用：满血不显示名字/血量文字，残血只显示血条
        this._isDefenseStructure = true;
        this._isBlockCover = !!isBlock; // 2026-08-17：方块墙（建筑面板网格吸附用）
        this._dormantBand = true; // 2026-08-19：静态结构进休眠带（主循环 1/4 帧率聚合 dt）
        this.noSeparation = true;
        this.noNameLabel = true;
        this._noShadow = true;   // 障碍物取消脚底阴影
        this.immovable = true; // 掩体不可被击退/移动（任何位移通道一律无效）
        // 掩体不设置任何防御/魔法防御（怪物可攻击，伤害全额结算）
        this.def = 0;
        this.mdef = 0;
        this.data.def = 0;
        this.data.mdef = 0;
        // 矩形 footprint（长边=有效朝向的水平/垂直摆方向），供怪物碰撞与近战判定；
        // 镜像后 h/v 互换，避免“视觉横墙、碰撞竖矩形”错位
        const foot = isBlock
            ? BLOCK_FOOT
            : (config.w && config.d)
            ? (mirror ? { w: config.d, d: config.w } : { w: config.w, d: config.d })
            : (COVER_FOOT[eff] || COVER_FOOT[orient] || COVER_FOOT.v);
        this.collisionShape = 'rect';
        this.collisionWidth = foot.w;
        this.collisionHeight = foot.d;
        this.colliderOffsetY = foot.offY ?? 0;
        this._coverHalfThick = foot.thick ?? 26; // 墙厚一半（线段碰撞/阻挡宽度用）
        this.grade = grade;
        this.orient = orient;
        this._facingLeft = mirror; // 镜像：中立精灵渲染 flipX
        // 城墙顶面是独立于贴图深度的逻辑可行走表面。当前六档掩体共用同一几何，
        // 后续若高墙/塔墙高度不同，只需由配置或构造参数覆盖 topZ。
        this._isWalkableWall = config.walkable !== false;
        this._wallTopZ = Number.isFinite(config.topZ) ? config.topZ : WALL_WALK_CONFIG.defaultTopZ;
        this._wallWalkWidth = Number.isFinite(config.walkWidth) ? config.walkWidth : WALL_WALK_CONFIG.laneWidth;
        // 图层深度锚点：按墙段底边线（贴图接地线）的 max 端点 y + 12。
        // 注意不能用 e.y+12：e.y 是贴图显示框底边，比接地线深 22~137px（贴图内容
        // 在框内偏上），会导致“墙前实体（脚线在接地线之下、但仍在 e.y 之上）被
        // 错误排到墙后被盖”——2026-08-05 实机复现（怪物 depth 2100 < 掩体 2121）。
        const face = isBlock
            ? (BLOCK_FACE[eff] || BLOCK_FACE.v)
            : (COVER_FACE[grade] && COVER_FACE[grade][eff])
            || COVER_FACE.D[eff] || COVER_FACE.D.v;
        if (face) {
            this._faceLine = [
                { x: x + face.A.x, y: y + face.A.y },
                { x: x + face.B.x, y: y + face.B.y },
            ];
            // depthBias：上夹角左臂（TL 边）加 0.5，让左臂盖住右臂（TR），
            // 否则两臂 faceDepth 相同 + TL 先建 → 右挡左（2026-08-06 用户反馈）
            this._faceDepth = structureDepthAtY(
                Math.max(this._faceLine[0].y, this._faceLine[1].y),
                config.depthBias || 0
            );
            if (isBlock) {
                this.collisionShape = 'iso_rect';
                this.collisionWidth = BLOCK_FOOT.w;
                this.collisionHeight = BLOCK_FOOT.d;
                this.collisionIsoHalfU = BLOCK_FOOT.w / (2 * Math.SQRT2);
                this.collisionIsoHalfV = BLOCK_FOOT.w / (2 * Math.SQRT2);
                this.collisionRadius = BLOCK_FOOT.w / 2;
                this.colliderOffsetX = 0;
                this.colliderOffsetY = 0;
            } else {
                applyIsoFootprintFromSegment(this, this._faceLine[0], this._faceLine[1], this._coverHalfThick);
            }
        } else {
            this._faceDepth = structureDepthAtY(y);
        }
        // 墙段 face 线段注册进 WallSystem.isoSegments：怪物移动/投射物/寻路自动被
        // 墙段阻挡（与成功案例墙段/门闸同管线，skill #33 冰墙经验）。
        // halfThick = 墙厚一半（52 世界 → 26），阻挡宽度匹配视觉墙厚。
        if (WallSystem && WallSystem.isoSegments && this._faceLine) {
            this._coverSeg = {
                x1: this._faceLine[0].x, y1: this._faceLine[0].y,
                x2: this._faceLine[1].x, y2: this._faceLine[1].y,
                halfThick: this._coverHalfThick,
                _cover: true,
                _owner: this, // 回链：怪物被挡路时转火本掩体（movement-system 卡住检测用）
            };
            WallSystem.isoSegments.push(this._coverSeg);
            // [PERF-2026-08-08] 掩体墙段注册后只局部失效该线段周边（bbox 外扩 800px 由
            // invalidateRegion 内部处理），不再核弹级全清——世界-122 掩体增删频繁，
            // 全清会让全部怪的路径/格子缓存集体冷启动
            if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
                const s = this._coverSeg;
                pathFinder.invalidateRegion(
                    Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                    Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)
                );
            }
          }
          // 贴图：随机变体库（2026-08-05）——同档 5 个高度类似变体随机选，防单调：
        // v1=定稿（无后缀）；v2~v5=细节微调变体（A 级符文形态随机替换）。
        // 变体 2~5 同时入库 _v/_h 两向；镜像仍由 flipX 派生（视觉方向跟随镜像）。
        // 变体 2~5 同时入库 _v/_h 两向；镜像仍由 flipX 派生（视觉方向跟随镜像）
        const variant = isBlock ? 1 : 1 + Math.floor(Math.random() * 5);
        const tex = isBlock
            ? TechnologySystem.getWallTextureKey()
            : variant === 1
            ? `obstacle_cover_${grade}_${orient}`
            : `obstacle_cover_${grade}_v${variant}_${orient}`;
        const aspect = isBlock ? (BLOCK_VISUAL.w / BLOCK_VISUAL.h) : ((COVER_ASPECT[grade] && COVER_ASPECT[grade][orient]) || 1);
        const sizeH = isBlock ? BLOCK_VISUAL.h : Math.round(COVER_DISPLAY_W / aspect);
        const footOff = isBlock ? BLOCK_FOOT_OFFSET : sizeH / 2;
        this.spriteCfg = { idleKey: tex, size: isBlock ? BLOCK_VISUAL.w : COVER_DISPLAY_W, sizeH, footOffsetY: footOff };
        this.footOffsetY = footOff;
        if (isBlock) applyResearchHp(this, hp);
        this.rebuildCollider();
    }

    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡逻辑在 onDeath 接管（DamageableEntity.onDeath 默认 active=false +
        // 血雾/死亡粒子，掩体需要保持活跃让精灵下沉）
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 掩体沉陷死亡（2026-08-16 试点）：不设 active=false、不播血雾/死亡粒子；
     *  精灵随 BuildingSinkEffect 下沉 + 底部灰烟掩盖，结束后清除实体（无废墟） */
    onDeath(_source) {
        this.active = true; // 保持活跃让中性精灵继续渲染；下沉结束时由特效置 false
        this.hittable = false;
        this._sinking = true;
        this.removeFromCollision();
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '掩体被摧毁', '#ff8855'));
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 从 WallSystem.isoSegments 移除本墙段（销毁/场景清理时调用） */
    removeFromCollision() {
        DefenseSystem?.invalidateElevatedTopology?.();
        if (this._coverSeg && WallSystem && WallSystem.isoSegments) {
            const i = WallSystem.isoSegments.indexOf(this._coverSeg);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
              // [PERF-2026-08-08] 局部失效前先取线段 bbox（随后 _coverSeg 置空）；
              // 只清该线段周边缓存，不再全清（掩体被摧毁在世界-122 高频发生）
              const s = this._coverSeg;
              this._coverSeg = null;
            if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
                pathFinder.invalidateRegion(
                    Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                    Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)
                );
            }
          }
      }

    update(dt) {
        super.update(dt);
    }
}

class DefenseTower extends Combatant {
    constructor(x, y, config = {}) {
        super(x, y, {
            faction: 'player',
            hp: config.hp ?? DEFENSE_CONFIG.tower.hp,
            maxHp: config.maxHp ?? DEFENSE_CONFIG.tower.hp,
            size: config.size ?? 30,
            collisionRadius: config.radius ?? DEFENSE_CONFIG.tower.radius,
            name: config.name ?? '防御塔',
        });
        this.id = config.id || `defense_tower_${Math.random().toString(36).slice(2, 8)}`;
        this._isDefenseStructure = true;
        this._noShadow = true;   // 障碍物取消脚底阴影
        this._isDefenseTower = true;
        this._attackSlots = 2; // 塔 footprint 小，同时攻击者上限收紧（拥挤分摊，2026-08-16）
        this._skipNeutralSprite = true; // 塔由 GameScene._syncDefenseTowers 三层渲染（基座/臂/武器）
        this.noSeparation = true;
        this.immovable = true; // 防御塔同掩体口径：不可被击退/移动（2026-08-14 补齐）
        const def = config.def ?? DEFENSE_CONFIG.tower.def;
        const mdef = config.mdef ?? DEFENSE_CONFIG.tower.mdef;
        this.def = def;
        this.mdef = mdef;
        this.data.def = def;
        this.data.mdef = mdef;
        // 贴图：世界-122 防御塔（2026-08-12 Blender 圆柱塔基 + 机械臂，纯色参考版；
        // 内容框 324×498，显示 170×262）
        const visualFootOffsetY = DEFENSE_TOWER_VISUAL.base.footOffsetY
            - DEFENSE_TOWER_VISUAL.base.footprintCenterOffsetY;
        this.spriteCfg = {
            idleKey: 'obstacle_defense_tower',
            size: DEFENSE_TOWER_VISUAL.base.w,
            sizeH: DEFENSE_TOWER_VISUAL.base.h,
            footOffsetY: visualFootOffsetY,
        };
        this.footOffsetY = visualFootOffsetY;
        this._visualGroundOffsetY = DEFENSE_TOWER_VISUAL.base.footprintCenterOffsetY;
        this._visualFootOffsetY = visualFootOffsetY;
        applyBuildingFootprint(this, 2);
        // 地面 footprint 深度与塔身垂直高度分离，避免 2x2 占地被当成弹道发射高度。
        this.collisionBodyHeight = DEFENSE_TOWER_VISUAL.base.h;
        // 统一遮挡锚线（塔三层贴图深度一律从 _faceDepth 取，见 GameScene._syncDefenseTowers）
        setupStructureDepth(this);
        this.weaponItem = null;
        this._attackKey = null;
        this._rampProgress = 0;
        this._rampDecayDelay = 0;
        this._calibrationShotState = null;
        this._rhythmBurstState = null;
        this._convergenceState = null;
        this.range = 800;
        // 六维芯片（2026-08-16 重构：取代原塔等级，与改造模块并存）：
        // 属性初始 base，升级本身不加攻击，只强化「与该属性挂钩的已装载武器」
        const chipBase = DEFENSE_CONFIG.tower.chip?.base ?? 10;
        this.chip = { str: chipBase, dex: chipBase, con: chipBase, int: chipBase, wis: chipBase, luck: chipBase };
        // 改造模块状态：{ moduleId: level }（2026-08-16 重新引入，与芯片独立升级）
        this.modules = {};
        this._currentSpreadFactor = 0.08;
        this._currentSpreadMaxAngle = 7;
        // 机械臂朝向（世界角，y 向下；自然姿态=臂贴图原始朝向）
        this.aimAngle = DEFENSE_TOWER_VISUAL.arm.naturalAngle;
        this._aimTargetPos = null;
        this.rebuildCollider();
    }

    /** 弹药存在判定（玩家口径）：弹匣有剩余且非换弹中 */
    _hasAmmo(slot) {
        if (!this._ammoState || !this._ammoState[slot]) {
            this._initAmmoForSlot(slot);
        }
        const state = this._ammoState && this._ammoState[slot];
        return state && state.current > 0 && !state.reloading;
    }

    /** 消耗 1 发弹药；打空自动进入换弹 */
    _consumeAmmo(slot) {
        const state = this._ammoState && this._ammoState[slot];
        if (!state || state.current <= 0) return false;
        state.current--;
        if (state.current <= 0) {
            this._startReload(slot);
        }
        return true;
    }

    /** 换弹守卫：换弹中/满弹不重复触发（基类会无条件重置换弹计时，
     *  否则 canFire 每帧自动换弹导致永远装不完） */
    _startReload(slot) {
        const state = this._ammoState && this._ammoState[slot];
        if (!state || state.reloading || state.current >= state.max) return false;
        const started = super._startReload(slot);
        if (started) {
            // 单发装填标记（Super90 管仓式：一次一发；玩家口径读 getAmmoConfig）
            const item = this.equipments && this.equipments[slot];
            const ammoCfg = getAmmoConfig(item);
            state.singleReloadMode = !!(ammoCfg && ammoCfg.singleReloadMode);
        }
        return started;
    }

    /** 换弹推进（2026-08-15 Super90 重设计）：单发装填一次一发、装满才停；
     *  装填中 canFire 拦截 → "没有装满不开火"。普通武器仍一次装满。 */
    _updateReload(dt) {
        const state = this._ammoState && this._ammoState.weapon;
        if (!state || !state.reloading) return;
        state.reloadTimer -= dt;
        if (state.reloadTimer <= 0) {
            state.reloadTimer = 0;
            if (state.singleReloadMode) {
                state.current = Math.min(state.max, state.current + 1);
                if (state.current >= state.max) {
                    state.reloading = false;
                    state.singleReloadMode = false;
                } else {
                    state.reloadTimer = state.reloadTime; // 继续装下一发
                }
            } else {
                state.reloading = false;
                state.current = state.max;
            }
        }
    }

    /** 是否防御塔可装载武器（远程武器，手枪除外） */
    static isTowerWeapon(item) {
        return !!item && item.category === 'weapon_ranged' && TOWER_WEAPON_TYPES.includes(item.weaponType);
    }

    _resolveAttackKey(item) {
        if (item.attackKey) return item.attackKey;
        if (item.weaponType === 'shotgun') return item.weaponId === 'saiga12k' ? 'saiga12k' : 'super90';
        if (item.weaponType === 'bow') return 'ranged';
        return item.weaponType;
    }

    /** 装载武器（从背包取出后调用；返回是否成功） */
    equipWeapon(item) {
        if (!DefenseTower.isTowerWeapon(item)) return false;
        this.weaponItem = item;
        this.equipments.weapon = item;
        this.weaponMode = 'weapon';
        const attackKey = this._resolveAttackKey(item);
        this._attackKey = attackKey;
        this._rampProgress = 0;
        this._rampDecayDelay = 0;
        this._calibrationShotState = null;
        // 写回攻击键：Combatant.fireProjectile 内部按 item.attackKey || item.weaponType 查表，
        // 霰弹枪（weaponType=shotgun）/弓（bow）无同名键，必须让物品携带解析后的攻击键
        item.attackKey = attackKey;
        if (!this.attacks[attackKey]) {
            const cfg = WEAPON_ATTACK_CONFIG[attackKey] || WEAPON_ATTACK_CONFIG.ranged;
            this.attacks[attackKey] = createAttackFromConfig(cfg);
        }
        // 攻击间隔/射程：读装备 attack 配置（覆盖攻击配置占位值）
        const atkCfg = item.attack || {};
        if (atkCfg.attackInterval) {
            this.attacks[attackKey].config.cooldown = atkCfg.attackInterval;
            this.attacks[attackKey].maxCooldown = atkCfg.attackInterval;
            this.attacks[attackKey].baseMaxCooldown = atkCfg.attackInterval;
        }
        this.range = atkCfg.range || this.attacks[attackKey].config.projectileRange || 900;
        // 弹药初始化（Combatant 默认无限弹药；枪械弹匣状态仅供换弹动画/节奏使用）
        this._initAmmoForSlot('weapon');
        // 改造模块倍率应用到武器参数（射程/射速/换弹）
        this._applyModuleWeaponParams();
        // 弹丸贴图直接复用现有武器贴图（无则默认曳光弹）
        const path = WEAPON_IMAGE_PATHS[item.weaponId] || WEAPON_IMAGE_PATHS[item.weaponType];
        if (path) this.weaponImages[item.weaponType] = loadImage(path);
        this._recalcDamage();
        return true;
    }

    /** 卸下武器（返回被卸下的物品） */
    unequipWeapon() {
        if (!this.weaponItem) return null;
        const item = this.weaponItem;
        this.weaponItem = null;
        this.equipments.weapon = null;
        this._attackKey = null;
        this._rampProgress = 0;
        this._rampDecayDelay = 0;
        this._calibrationShotState = null;
        this._rhythmBurstState = null;
        this._convergenceState = null;
        this.range = 800;
        return item;
    }

    // ==================== 六维芯片（2026-08-16 重构，取代原等级/模块升级） ====================

    /** 当前武器挂钩的芯片主属性（配置覆盖 > 攻击公式首个属性；无挂钩返回 null） */
    getChipWeaponStat(item) {
        if (!item) return null;
        const table = DEFENSE_CONFIG.tower.chipWeaponStat || {};
        const hit = table[item.weaponId] || table[item.weaponType];
        if (hit) return hit;
        const formula = getAttackFormula(item);
        const attrs = formula && Array.isArray(formula.attrs) ? formula.attrs : [];
        return attrs.length > 0 ? attrs[0].key : null;
    }

    /** 芯片合成射手属性：只喂「与武器挂钩的主属性」，其余为 0 → 未挂钩属性对伤害零影响 */
    _chipDataFor(item) {
        const stat = this.getChipWeaponStat(item);
        const d = { str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0 };
        if (stat) d[stat] = this.chip[stat] || 0;
        return d;
    }

    /**
     * 指定武器装载到本塔后的每发伤害（零硬编码，实时公式）：
     * 复用 computeWeaponAttack —— 强化等级/改造(独头弹·伤害%)/附魔自动计入；
     * skills 传 null（塔不吃玩家熟练度）；再乘改造模块「伤害强化」倍率。
     */
    _computeDamageFor(item) {
        if (!item) return 0;
        const base = computeWeaponAttack(item, this._chipDataFor(item), null);
        return Math.max(1, Math.round(base * this.moduleMults().damage));
    }

    /** 当前已装载武器的每发伤害 */
    _computeDamage() {
        return this._computeDamageFor(this.weaponItem);
    }

    /** 指定属性 +1 后的精确伤害（真实公式差分；未挂钩属性差为 0） */
    _computeDamageWithStat(statKey, value) {
        if (!this.weaponItem) return this._computeDamage();
        const data = this._chipDataFor(this.weaponItem);
        data[statKey] = value;
        return Math.max(1, Math.round(computeWeaponAttack(this.weaponItem, data, null) * this.moduleMults().damage));
    }

    /** 属性每点对当前武器的边际攻击力（+10 区间均值，平滑取整抖动；真实公式差分） */
    _statMarginalPerPoint(statKey) {
        if (!this.weaponItem) return 0;
        const data = this._chipDataFor(this.weaponItem);
        const cur = data[statKey] || 0;
        const mm = this.moduleMults().damage;
        const d0 = Math.max(1, Math.round(computeWeaponAttack(this.weaponItem, data, null) * mm));
        const d10 = this._computeDamageWithStat(statKey, cur + 10);
        return (d10 - d0) / 10;
    }

    /** 单项属性当前升级费用：round(baseCost × growth^(当前值 - base))，逐级递增 */
    getChipUpgradeCost(statKey) {
        const cfg = DEFENSE_CONFIG.tower.chip || {};
        const baseVal = cfg.base ?? 10;
        const cur = this.chip[statKey] ?? baseVal;
        const base = cfg.upgrade && cfg.upgrade.baseCost != null ? cfg.upgrade.baseCost : 60;
        const growth = cfg.upgrade && cfg.upgrade.costGrowth != null ? cfg.upgrade.costGrowth : 1.28;
        return Math.round(base * Math.pow(growth, Math.max(0, cur - baseVal)));
    }

    /** 玩家支付金币升级芯片属性；不直接加攻，只强化挂钩武器 */
    upgradeStat(statKey, _player) {
        const cfg = DEFENSE_CONFIG.tower.chip || {};
        const s = cfg.stats && cfg.stats[statKey];
        if (!s) return { ok: false, reason: '未知属性' };
        const baseVal = cfg.base ?? 10;
        const cur = this.chip[statKey] ?? baseVal;
        if (cur >= (cfg.max ?? 30)) return { ok: false, reason: `${s.name}已达上限` };
        const cost = this.getChipUpgradeCost(statKey);
        const payment = payBuildingUpgradeCost({ gold: cost });
        if (!payment.ok) return payment;
        this.chip[statKey] = cur + 1;
        this._recalcDamage();
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, statKey, value: this.chip[statKey], name: s.name };
    }

    // ==================== 改造模块（2026-08-16 重新引入，与六维芯片并存） ====================

    /** 当前模块倍率表（damage/range/overheatTime 为增倍率，interval/reload/overheatCooldown 为减倍率） */
    moduleMults() {
        const m = this.modules || {};
        const cfg = DEFENSE_CONFIG.tower.modules || {};
        const out = {
            damage: 1, range: 1, attackInterval: 1, reload: 1, overheatTime: 1, overheatCooldown: 1,
        };
        const d = cfg.damage;    if (d && m.damage)    out.damage = 1 + d.per * m.damage;
        const r = cfg.range;     if (r && m.range)     out.range = 1 + r.per * m.range;
        const a = cfg.attackSpd; if (a && m.attackSpd) out.attackInterval = 1 + a.per * m.attackSpd;
        const rel = cfg.reload;  if (rel && m.reload)  out.reload = Math.max(0.2, 1 + rel.per * m.reload);
        const oh = cfg.overheat; if (oh && m.overheat) out.overheatTime = 1 + oh.per * m.overheat;
        const co = cfg.cooling;  if (co && m.cooling)  out.overheatCooldown = Math.max(0.2, 1 + co.per * m.cooling);
        return out;
    }

    /** 模块升级费用：round(baseCost × growth^(当前等级-1))，逐级递增 */
    getModuleCost(moduleId) {
        const mod = DEFENSE_CONFIG.tower.modules?.[moduleId];
        if (!mod) return 0;
        const cur = this.modules[moduleId] || 0;
        return Math.round(mod.baseCost * Math.pow(mod.costGrowth, Math.max(0, cur - 1)));
    }

    /** 玩家支付金币升级改造模块；成功则立即重算武器参数与伤害 */
    upgradeModule(moduleId, _player) {
        const mod = DEFENSE_CONFIG.tower.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        const cur = this.modules[moduleId] || 0;
        if (cur >= mod.maxLevel) return { ok: false, reason: `${mod.name}已满级` };
        const cost = this.getModuleCost(moduleId);
        const payment = payBuildingUpgradeCost({ gold: cost });
        if (!payment.ok) return payment;
        this.modules[moduleId] = cur + 1;
        this._applyModuleWeaponParams();
        this._recalcDamage();
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId, level: this.modules[moduleId], name: mod.name };
    }

    /** 将模块倍率应用到武器参数（射程/射速/换弹），在升级模块或装载武器后调用 */
    _applyModuleWeaponParams() {
        if (!this.weaponItem || !this._attackKey) return;
        const mults = this.moduleMults();
        const atk = this.attacks[this._attackKey];
        const atkCfg = this.weaponItem.attack || {};
        // 射程：基础配置 × 模块倍率
        const baseRange = atkCfg.range || atk.config?.projectileRange || 900;
        this.range = Math.round(baseRange * mults.range);
        // 射速：基础间隔 × 模块倍率（保留原冷却语义，baseMaxCooldown 同步）
        if (atkCfg.attackInterval) {
            const interval = Math.max(80, Math.round(atkCfg.attackInterval * mults.attackInterval));
            atk.config.cooldown = interval;
            atk.maxCooldown = interval;
            atk.baseMaxCooldown = interval;
        }
        // 换弹：由 _initAmmoForSlot 覆盖统一处理（读模块倍率）
        if (this._ammoState && this._ammoState.weapon) {
            const st = this._ammoState.weapon;
            st.reloadTime = Math.max(120, Math.round(st.reloadTime * mults.reload));
            if (!st.reloading) st.reloadTimer = 0;
        }
    }

    /** 换弹时间覆盖：基础弹药配置 × 模块倍率（与玩家口径一致：读 _craftEffects 后乘模块） */
    _initAmmoForSlot(slot) {
        super._initAmmoForSlot(slot);
        if (slot !== 'weapon' || !this._ammoState || !this._ammoState.weapon) return;
        const st = this._ammoState.weapon;
        st.reloadTime = Math.max(120, Math.round(st.reloadTime * this.moduleMults().reload));
    }

    /** 过热/散热模块倍率：Combatant._updateOverheat 读 weapon.heatParams，此处按模块倍率改写后委托 */
    _updateOverheat(dt, isFiring) {
        const weapon = this.getCurrentWeapon ? this.getCurrentWeapon() : (this.weaponItem || null);
        if (!weapon) return;
        const mults = this.moduleMults();
        const hp = weapon.heatParams || {};
        const ohTime = Math.max(500, hp.overheatTime || 5000);
        const cooldownTime = Math.max(500, hp.overheatCooldownTime || hp.overheatRecoverTime || 1500);
        const recoverTime = Math.max(500, hp.overheatRecoverTime || hp.overheatCooldownTime || 1500);
        weapon.heatParams = {
            ...hp,
            overheatTime: ohTime * mults.overheatTime,
            overheatCooldownTime: cooldownTime * mults.overheatCooldown,
            overheatRecoverTime: recoverTime * mults.overheatCooldown,
        };
        super._updateOverheat(dt, isFiring);
        // 还原，避免污染武器配置
        weapon.heatParams = hp;
    }

    _recalcDamage() {
        if (!this._attackKey || !this.attacks[this._attackKey]) return;
        const dmg = this._computeDamage();
        this.attacks[this._attackKey].config.damage = { min: dmg, max: dmg };
    }

    /** 面板预览：当前伤害 + 挂钩主属性 +1 后的伤害 */
    getPreviewDamage() {
        const current = this._computeDamage();
        let next = current;
        let stat = null;
        if (this.weaponItem) {
            stat = this.getChipWeaponStat(this.weaponItem);
            if (stat) next = this._computeDamageWithStat(stat, (this.chip[stat] ?? 0) + 1);
        }
        return { current, next, stat };
    }

    /** 防御塔只忽略己方防御墙；真实墙、敌方墙仍交给高度弹道判定。 */
    _projectileWallIgnore() {
        if (!WallSystem || !Array.isArray(WallSystem.isoSegments)) return null;
        const segs = WallSystem.isoSegments.filter((segment) => {
            if (!segment?._cover) return false;
            const faction = segment._owner?._faction;
            return !faction
                || faction === this._faction
                || (this._faction === 'player' && faction === 'companion')
                || (this._faction === 'companion' && faction === 'player');
        });
        return { segs: new Set(segs) };
    }

    /** 统一取得目标的地面坐标、真实瞄准高度与屏幕瞄准点。 */
    _targetAimPoint(target) {
        const colliderX = Number(target?.collider?.x);
        const colliderY = Number(target?.collider?.y);
        const groundX = Number.isFinite(colliderX) ? colliderX : (Number(target?.x) || 0);
        const groundY = Number.isFinite(colliderY) ? colliderY : (Number(target?.y) || 0);
        const targetZ = projectileTargetZ(target);
        return {
            groundX,
            groundY,
            targetZ,
            screenX: groundX,
            screenY: groundY - targetZ,
        };
    }

    /** 索敌从 2x2 footprint 中心、塔顶枪架高度出发，不再从前顶点做二维射线。 */
    _targetingOrigin() {
        return {
            x: Number(this.collider?.x) || this.x,
            y: Number(this.collider?.y) || (this.y + (Number(this._visualGroundOffsetY) || 0)),
            z: (Number(this.z) || 0) + DEFENSE_TOWER_VISUAL.arm.pivotWorldY,
        };
    }

    _acquireTarget(entities) {
        let best = null;
        let bestD = Infinity;
        const arr = entities && entities.values ? Array.from(entities.values()) : (Array.isArray(entities) ? entities : []);
        const origin = this._targetingOrigin();
        const wallIgnore = this._projectileWallIgnore();
        for (const e of arr) {
            if (!e || e === this || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
            const aim = this._targetAimPoint(e);
            const d = Math.hypot(aim.groundX - origin.x, aim.groundY - origin.y);
            if (d > this.range) continue;
            // 与实际弹丸使用同一套高度墙体检测；目标站在墙顶时允许命中其支撑墙后的模型。
            if (WallSystem && typeof WallSystem.projectileWallHit === 'function') {
                const wallHit = WallSystem.projectileWallHit(
                    origin.x, origin.y, origin.z,
                    aim.groundX, aim.groundY, aim.targetZ,
                    wallIgnore
                );
                if (wallHit && !wallHitSupportsTarget(wallHit, e)) continue;
            } else if (WallSystem && typeof WallSystem.blocked === 'function') {
                if (WallSystem.blocked(origin.x, origin.y, aim.groundX, aim.groundY, wallIgnore)) continue;
            }
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    _fireAtTarget(target, entities) {
        if (!this.weaponItem || !this._attackKey) return;
        const attack = this.attacks[this._attackKey];
        if (!attack || !attack.canUse()) return;
        const aim = this._targetAimPoint(target);
        if (this.weaponItem.weaponType === 'shotgun') {
            // 散弹：一次击发 = 1 发弹壳，多发弹丸共享一个枪口 + 一次特效（2026-08-15 修复）
            const pellets = this.weaponItem.pelletCount || (this.weaponItem.weaponId === 'saiga12k' ? 4 : 6);
            this._fireBlast(aim, entities, pellets);
        } else {
            this._fireShot(aim, entities);
        }
    }

    /** 挂载升速枪械消费各自的升速参数；目标存在等价于玩家持续按住扳机。 */
    _updateRampFire(dt, isFiring) {
        const item = this.weaponItem;
        const ramp = item?.rampFireParams;
        const energy = item?.energyLMGParams;
        const attack = this._attackKey ? this.attacks[this._attackKey] : null;
        if ((!ramp && !energy) || !attack) {
            this._rampProgress = 0;
            this._rampDecayDelay = 0;
            return;
        }
        const ce = item._craftEffects || {};
        const rampUpTime = Math.max(400,
            (Number(energy?.rampUpTime ?? ramp?.rampUpTime) || 2000)
            + (Number(energy ? ce.energyRampUpTimeDelta : ce.rampUpTimeDelta) || 0));
        const decayDelay = energy ? 0 : Math.max(0, Number(ramp?.decayDelay) || 0);
        const decayTime = energy ? Math.max(1, dt) : Math.max(250, Number(ramp?.decayTime) || 1500);
        if (isFiring) {
            this._rampProgress = Math.min(1, this._rampProgress + dt / rampUpTime);
            this._rampDecayDelay = decayDelay;
        } else if (this._rampDecayDelay > 0) {
            this._rampDecayDelay = Math.max(0, this._rampDecayDelay - dt);
        } else {
            this._rampProgress = Math.max(0, this._rampProgress - dt / decayTime);
        }
        const attackSpeedMul = this.moduleMults().attackInterval;
        const baseSource = energy?.baseCooldown ?? item.attack?.attackInterval;
        const baseInterval = Math.max(40, Math.round(
            resolveGunAttackInterval(item, baseSource) * attackSpeedMul));
        const minCooldown = Math.max(40,
            (Number(energy?.maxCooldown ?? ramp?.minCooldown) || item.attack?.attackInterval || 80)
            + (Number(energy ? ce.energyPeakCooldownDelta : ce.rampMinCooldownDelta) || 0));
        const peakInterval = Math.max(40, Math.round(
            resolveGunAttackInterval(item, minCooldown) * attackSpeedMul));
        const interval = Math.round(baseInterval + (peakInterval - baseInterval) * this._rampProgress);
        attack.config.cooldown = interval;
        attack.maxCooldown = interval;
        attack.baseMaxCooldown = baseInterval;
    }

    /** 枪口点 = 屏幕枪口 + 对应的地面平面坐标和真实发射高度。 */
    _muzzlePoint() {
        const V = DEFENSE_TOWER_VISUAL;
        const pivotX = this.x;
        const pivotY = this.y + (Number(this._visualGroundOffsetY) || 0) - V.arm.pivotWorldY;
        const m = this._mirrored ? -1 : 1;
        const tipOX = V.arm.gameScale * V.arm.k * V.arm.reach * Math.cos(this.aimAngle) * m;
        const tipOY = V.arm.gameScale * V.arm.k * (0.5 * V.arm.reach * Math.sin(this.aimAngle) - 0.866 * V.arm.dz);
        const barrelCfg = V.weapon.barrel && this.weaponItem && (V.weapon.barrel[this.weaponItem.weaponId] || V.weapon.barrel[this.weaponItem.weaponType]);
        let wAng = Math.atan2(0.5 * V.arm.reach * Math.sin(this.aimAngle) - 0.866 * V.arm.dz, V.arm.reach * Math.cos(this.aimAngle));
        if (this._mirrored) wAng = Math.PI - wAng;
        const muzzleLen = barrelCfg ? barrelCfg.w * (barrelCfg.height / barrelCfg.h) : 16;
        const rootInset = barrelCfg ? (barrelCfg.inset ?? 7) : 0;
        const mx = pivotX + tipOX + Math.cos(wAng) * (muzzleLen - rootInset);
        const my = pivotY + tipOY + Math.sin(wAng) * (muzzleLen - rootInset);
        const startZ = (Number(this.z) || 0) + V.arm.pivotWorldY;
        return { mx, my, startZ, groundY: my + startZ };
    }

    /** 枪口特效（火焰/开火火光/弹壳/音效）——散弹一次击发只播一次 */
    _muzzleEffects(mx, my, aimX, aimY) {
        const angle = Math.atan2(aimY - my, aimX - mx);
        EffectFactory.createMuzzleFlash(mx, my, angle, 1.4);
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.playMuzzleFire === 'function') {
            scene.playMuzzleFire(mx, my);
        }
        EffectFactory.createShellCasing(mx, my, angle, this.y);
        const snd = TOWER_FIRE_SOUNDS[this.weaponItem ? this.weaponItem.weaponId : ''] || TOWER_FIRE_SOUNDS[this.weaponItem ? this.weaponItem.weaponType : ''];
        if (snd && SoundManager && typeof SoundManager.playFile === 'function') {
            if (SoundManager.playGunshotAt) SoundManager.playGunshotAt(snd, this.x, this.y);
            else if (SoundManager.playGunshot) SoundManager.playGunshot(snd);
            else SoundManager.playFile(snd);
        }
    }

    /** 单发开火：枪口偏移 + 墙体回退 + 弹丸（复用 Combatant.fireProjectile）+ 枪口特效 */
    _fireShot(aim, entities) {
        if (!this._attackKey || !this.attacks[this._attackKey]) return false;
        const p = this._muzzlePoint();
        const mx = p.mx, my = p.my;
        const params = this.weaponItem?.calibrationShotParams;
        let calibration = null;
        if (params) {
            if (!this._calibrationShotState) this._calibrationShotState = { hits: 0, charged: false };
            const ce = this.weaponItem?._craftEffects || {};
            const required = Math.max(2, Math.round((Number(params.hitsRequired) || 8) + (Number(ce.calibrationHitsRequiredDelta) || 0)));
            const multiplier = Math.max(1, (Number(params.damageMultiplier) || 1.8) + (Number(ce.calibrationDamageMultiplierDelta) || 0));
            const bonus = Math.max(0, Math.round((Number(params.piercingBonus) || 2) + (Number(ce.calibrationPiercingBonusDelta) || 0)));
            const charged = this._calibrationShotState.charged;
            if (charged) {
                this._calibrationShotState.charged = false;
                this._calibrationShotState.hits = 0;
            }
            calibration = {
                damageMultiplier: charged ? multiplier : 1,
                piercingBonus: charged ? bonus : 0,
                onFirstHit: charged ? null : () => {
                    if (this._calibrationShotState.charged) return;
                    this._calibrationShotState.hits += 1;
                    if (this._calibrationShotState.hits >= required) {
                        this._calibrationShotState.hits = 0;
                        this._calibrationShotState.charged = true;
                    }
                }
            };
        }
        const rhythmParams = this.weaponItem?.rhythmBurstParams;
        let rhythm = null;
        if (rhythmParams) {
            if (!this._rhythmBurstState) this._rhythmBurstState = { shot: 0, lastShotAt: 0 };
            const ce = this.weaponItem?._craftEffects || {};
            const resetMs = Math.max(100, (Number(rhythmParams.resetMs) || 450) + (Number(ce.rhythmResetMsDelta) || 0));
            const now = Date.now();
            if (now - this._rhythmBurstState.lastShotAt > resetMs) this._rhythmBurstState.shot = 0;
            this._rhythmBurstState.lastShotAt = now;
            this._rhythmBurstState.shot += 1;
            const startShot = Math.max(1, Math.round((Number(rhythmParams.startShot) || 5) + (Number(ce.rhythmStartShotDelta) || 0)));
            const endShot = Math.max(startShot, Math.round((Number(rhythmParams.endShot) || 12) + (Number(ce.rhythmEndShotDelta) || 0)));
            const multiplier = Math.max(1, (Number(rhythmParams.damageMultiplier) || 1.28) + (Number(ce.rhythmDamageMultiplierDelta) || 0));
            const sweet = this._rhythmBurstState.shot >= startShot && this._rhythmBurstState.shot <= endShot;
            rhythm = { sweet, damageMultiplier: sweet ? multiplier : 1 };
        }
        const convergenceParams = this.weaponItem?.convergenceParams;
        const convergenceStateBefore = convergenceParams && this._convergenceState
            ? { ...this._convergenceState }
            : null;
        let convergence = null;
        if (convergenceParams) {
            if (!this._convergenceState) this._convergenceState = { shot: 0, lastShotAt: 0 };
            const ce = this.weaponItem?._craftEffects || {};
            const resetMs = Math.max(100, (Number(convergenceParams.resetMs) || 320) + (Number(ce.convergenceResetMsDelta) || 0));
            const now = Date.now();
            if (now - this._convergenceState.lastShotAt > resetMs) this._convergenceState.shot = 0;
            this._convergenceState.lastShotAt = now;
            this._convergenceState.shot += 1;
            const startShot = Math.max(2, Math.round((Number(convergenceParams.startShot) || 6) + (Number(ce.convergenceStartShotDelta) || 0)));
            const maxStacks = Math.max(1, Math.round((Number(convergenceParams.maxStacks) || 10) + (Number(ce.convergenceMaxStacksDelta) || 0)));
            const stack = Math.min(maxStacks, Math.max(0, this._convergenceState.shot - startShot + 1));
            const damagePerStack = Math.max(0, (Number(convergenceParams.damagePerStack) || 0.02) + (Number(ce.convergenceDamagePerStackDelta) || 0));
            const spreadPerStack = Math.max(0, (Number(convergenceParams.spreadPerStack) || 0.035) + (Number(ce.convergenceSpreadPerStackDelta) || 0));
            convergence = {
                stack,
                damageMultiplier: 1 + stack * damagePerStack,
                spreadMultiplier: Math.max(0.35, 1 - stack * spreadPerStack),
            };
        }
        const attackCfg = this.attacks[this._attackKey].config;
        const rawDamage = attackCfg.damage || { min: 1, max: 1 };
        const craftEffects = this.weaponItem?._craftEffects || {};
        const energyAtPeak = !!(this.weaponItem?.energyLMGParams && this._rampProgress >= 0.999);
        const energyPeakDamageMultiplier = energyAtPeak
            ? Math.max(1, 1 + (Number(craftEffects.energyPeakDamageMultiplierDelta) || 0))
            : 1;
        const energyPeakPiercingBonus = energyAtPeak
            ? Math.max(0, Math.round(Number(craftEffects.energyPeakPiercingBonus) || 0))
            : 0;
        const damageOverride = (calibration || rhythm || convergence || energyPeakDamageMultiplier > 1) ? {
            min: Number(rawDamage.min ?? rawDamage) * (calibration?.damageMultiplier || 1) * (rhythm?.damageMultiplier || 1) * (convergence?.damageMultiplier || 1) * energyPeakDamageMultiplier,
            max: Number(rawDamage.max ?? rawDamage) * (calibration?.damageMultiplier || 1) * (rhythm?.damageMultiplier || 1) * (convergence?.damageMultiplier || 1) * energyPeakDamageMultiplier,
        } : null;
        const ricochetOnHit = createWeaponRicochetHandler(this, this.weaponItem, entities);
        const legendaryLmgOnHit = createLegendaryLmgHitHandler(this, this.weaponItem, entities);
        const fired = this.fireProjectile(aim.screenX, aim.screenY, entities, {
            slot: 'weapon',
            spawnX: mx,
            spawnY: my,
            startZ: p.startZ,
            groundY: p.groundY,
            groundTargetY: aim.groundY,
            targetZ: aim.targetZ,
            aimDistance: Math.hypot(aim.groundX - mx, aim.groundY - p.groundY),
            wallContext: this._projectileWallIgnore(),
            // 塔的枪口层在 _muzzleEffects 中按“一次击发”统一播声；避免基类先播一次后重复。
            suppressFireSound: true,
            damageOverride,
            piercingOverride: (typeof attackCfg.piercing === 'number' ? attackCfg.piercing : 0)
                + (calibration?.piercingBonus || 0)
                + energyPeakPiercingBonus,
            onFirstHit: calibration?.onFirstHit || ricochetOnHit || legendaryLmgOnHit,
            isPurple: calibration?.damageMultiplier > 1,
            isCrimson: rhythm?.sweet === true || !!this.weaponItem?.runeLitanyParams,
            isCyan: energyAtPeak
                || (convergence?.stack || 0) > 0
                || !!this.weaponItem?.ricochetParams
                || !!this.weaponItem?.constellationParams,
            spreadMultiplier: (rhythm?.sweet ? 0.45 : 1) * (convergence?.spreadMultiplier || 1),
        });
        if (!fired) {
            if (convergenceParams) this._convergenceState = convergenceStateBefore;
            return false;
        }
        this._muzzleEffects(mx, my, aim.screenX, aim.screenY);
        return true;
    }

    /** 散弹一次击发：多发弹丸共享一个枪口、扣 1 发弹壳、播一次特效（2026-08-15 修复） */
    _fireBlast(aim, entities, pelletCount) {
        if (!this._attackKey || !this.attacks[this._attackKey]) return false;
        const p = this._muzzlePoint();
        const mx = p.mx, my = p.my;
        const attack = this.attacks[this._attackKey];
        const wallContext = this._projectileWallIgnore();
        let fired = false;
        for (let i = 0; i < pelletCount; i++) {
            attack.cooldown = 0; // 弹丸间不互相挡冷却
            const jx = aim.groundX + (Math.random() - 0.5) * 90;
            const jGroundY = aim.groundY + (Math.random() - 0.5) * 90;
            const jScreenY = jGroundY - aim.targetZ;
            if (this.fireProjectile(jx, jScreenY, entities, {
                slot: 'weapon',
                noAmmoConsume: true,
                spawnX: mx,
                spawnY: my,
                startZ: p.startZ,
                groundY: p.groundY,
                groundTargetY: jGroundY,
                targetZ: aim.targetZ,
                aimDistance: Math.hypot(jx - mx, jGroundY - p.groundY),
                wallContext,
                // 散弹每颗 pellet 都复用 fireProjectile，但整次击发只能在 _muzzleEffects 播一次声。
                suppressFireSound: true,
            })) fired = true;
        }
        if (!fired) return false;
        this._consumeAmmo('weapon'); // 一次击发 = 1 发弹壳
        this._muzzleEffects(mx, my, aim.screenX, aim.screenY);
        return true;
    }

    /** 机械臂瞄准：向目标最短弧平滑旋转；无目标回自然姿态 */
    _updateAim(dt, target) {
        const V = DEFENSE_TOWER_VISUAL;
        let desired = V.arm.naturalAngle;
        if (target && target.active) {
            const pivotY = this.y + (Number(this._visualGroundOffsetY) || 0) - V.arm.pivotWorldY;
            const aim = this._targetAimPoint(target);
            desired = Math.atan2(aim.screenY - pivotY, aim.screenX - this.x);
        }
        let diff = desired - this.aimAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const speed = target && target.active ? 9 : 4; // rad/s
        const maxStep = speed * (dt / 1000);
        this.aimAngle += Math.max(-maxStep, Math.min(maxStep, diff));
    }

    /** 塔被摧毁：停火、停止渲染、从实体分离中移除（怪物可穿过废墟）；登记废墟供重建 */
    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡由 onDeath 接管
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 防御塔沉陷死亡（2026-08-16 推广，无废墟）：三层精灵随特效下沉清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        // 从 towers 数组移除（不再登记废墟/重建——用户口径：被摧毁即清除）
        if (DefenseSystem && DefenseSystem.towers) {
            const i = DefenseSystem.towers.indexOf(this);
            if (i >= 0) DefenseSystem.towers.splice(i, 1);
        }
        if (DefenseSystem && DefenseSystem._panel && DefenseSystem._panel.isOpen
            && DefenseSystem._panel.tower === this) {
            DefenseSystem._panel.close();
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '防御塔被摧毁', '#ff8855'));
            // 塔是专属三层渲染（基座/臂/武器），从 _defenseSprites 接管后整体下沉
            EffectManager.add(new BuildingSinkEffect(this, (t) => {
                const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
                if (scene && scene._defenseSprites) scene._defenseSprites.delete(t);
                return sp ? [sp.base, sp.arm, sp.weapon] : [];
            }));
        }
    }

    update(dt, entities) {
        super.update(dt);
        if (!this.active || this.hp <= 0) return;
        if (!this.weaponItem || !this._attackKey) return;
        const attack = this.attacks[this._attackKey];
        if (!attack) return;
        attack.update(dt);
        if (typeof this._updateReload === 'function') this._updateReload(dt);
        this._recalcDamage();
        const target = this._acquireTarget(entities);
        this.target = target || null;
        this._updateAim(dt, target);
        // 过热驱动（与玩家"持续开火"口径一致）：普通机枪过热后停火；
        // 红热增压机枪允许过热后继续压制，并在持续出弹时保持红热状态。
        // 冷却（attack.canUse）不参与——机枪连续压制时枪管持续升温
        const mayFireOverheated = this.weaponItem?.overdriveHeatParams?.continueFiring === true;
        const isFiring = !!(target && target.active
            && this._hasAmmo('weapon')
            && !this._isReloading('weapon')
            && !(this._overheatOverheated && this.weaponItem
                && this.weaponItem.weaponType === this._overheatWeaponType && !mayFireOverheated));
        if (typeof this._updateOverheat === 'function') this._updateOverheat(dt, isFiring);
        this._updateRampFire(dt, isFiring);
        if (target) {
            const aim = this._targetAimPoint(target);
            this._aimTargetPos = {
                x: aim.screenX,
                y: aim.screenY,
            };
            this._fireAtTarget(target, entities);
        }
    }
}

// ==================== 防御塔面板 ====================

class DefenseTowerPanel extends BasePanel {
    constructor() {
        super({
            id: 'defenseTowerPanel',
            className: 'defense-tower-panel',
            stateKey: 'defenseTower',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            shouldCloseOnOutsidePointer: (event) =>
                !window.Game?.BuildingSystem?._eventHitsBuilding?.(event),
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        this.tower = null;
        this.player = null;
        this._telemetryTimer = null;
    }

    buildContent(el) {
        el.style.cssText = [
            'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:410px;',
            'max-height:88vh;overflow-y:auto;',
            'background:rgba(16,15,13,0.97);border:2px solid #6a5a3a;border-radius:10px;',
            'padding:16px 18px;color:#d4c5a9;font-family:SimHei,"Microsoft YaHei",sans-serif;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
        ].join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div id="dtTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="dtSell" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:pointer;">出售</button>
                    <button id="dtClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
            </div>
            <div id="dtBuildingDetail"></div>
            <div style="font-size:13px;font-weight:700;color:#ffd700;margin:2px 0 6px;">特殊功能 · 武器装载与塔防强化</div>
            <div id="dtWeaponSlot" style="border:1px dashed #6a5a3a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(0,0,0,0.25);"></div>
            <div style="font-size:13px;color:#9a8a6a;margin-bottom:6px;">可装载武器（背包 · 远程 · 手枪除外）</div>
            <div id="dtWeaponList" style="max-height:150px;overflow-y:auto;border:1px solid #3a3528;border-radius:8px;padding:4px 8px;margin-bottom:12px;"></div>
            <div id="dtChip" style="border:1px solid #2a6a5f;border-radius:8px;padding:12px;background:rgba(12,30,28,0.28);"></div>
            <div id="dtModules" style="margin-top:10px;border:1px solid #6a5a3a;border-radius:8px;padding:12px;background:rgba(40,32,18,0.22);"></div>
            <div id="dtRepair" style="margin-top:10px;border:1px solid #4a6a6a;border-radius:8px;padding:10px;background:rgba(20,50,50,0.18);"></div>
        `;
        el.querySelector('#dtClose').addEventListener('click', () => this.close());
    }

    openFor(tower, player) {
        this.tower = tower;
        this.player = player;
        this.open();
        this.refresh();
    }

    onOpen() {
        this.refresh();
        this._startWeaponTelemetry();
    }

    onClose() {
        this._stopWeaponTelemetry();
        this.tower = null;
        this.player = null;
    }

    _startWeaponTelemetry() {
        this._stopWeaponTelemetry();
        this._refreshWeaponTelemetry();
        if (typeof window === 'undefined') return;
        this._telemetryTimer = window.setInterval(() => this._refreshWeaponTelemetry(), 100);
    }

    _stopWeaponTelemetry() {
        if (this._telemetryTimer == null) return;
        if (typeof window !== 'undefined') window.clearInterval(this._telemetryTimer);
        this._telemetryTimer = null;
    }

    /**
     * 只刷新武器运行遥测，不重建芯片/模块按钮，避免面板打开时的高频 DOM 抖动。
     * 弹药、换弹和过热均只读取 DefenseTower 已有运行状态，不另建第二套规则。
     */
    _refreshWeaponTelemetry() {
        const t = this.tower;
        const box = this.el && this.el.querySelector('#dtWeaponTelemetry');
        if (!t || !t.weaponItem || !box) return;

        const item = t.weaponItem;
        const ammo = t._ammoState && t._ammoState.weapon;
        const maxAmmo = Number(ammo && ammo.max);
        const infiniteAmmo = ammo && !Number.isFinite(maxAmmo);
        const currentAmmo = ammo ? Math.max(0, Math.floor(Number(ammo.current) || 0)) : null;
        const ammoText = !ammo ? '—' : (infiniteAmmo ? '∞' : `${currentAmmo} / ${Math.max(0, Math.floor(maxAmmo))}`);
        const lowAmmo = ammo && !infiniteAmmo && maxAmmo > 0 && currentAmmo <= maxAmmo * 0.2;

        const attack = t._attackKey && t.attacks ? t.attacks[t._attackKey] : null;
        const interval = Math.max(0, Number(attack && (attack.maxCooldown || attack.config?.cooldown))
            || Number(item.attack && item.attack.attackInterval) || 0);
        const rpm = interval > 0 ? Math.round(60000 / interval) : 0;
        const range = Math.max(0, Math.round(Number(t.range) || 0));

        const reloading = !!(ammo && ammo.reloading);
        const reloadDuration = Math.max(1, Number(ammo && (ammo.reloadDuration || ammo.reloadTime)) || 1);
        const reloadRemaining = Math.max(0, Number(ammo && ammo.reloadTimer) || 0);
        const reloadProgress = reloading
            ? Math.max(0, Math.min(1, 1 - reloadRemaining / reloadDuration))
            : 0;
        const heatMax = Math.max(0.001, Number(t._overheatMax) || 1);
        const heatProgress = Math.max(0, Math.min(1, (Number(t._overheatValue) || 0) / heatMax));
        const overheated = !!t._overheatOverheated;
        const showHeat = overheated || !!t._overheatActive || t._overheatWeaponType === item.weaponType;
        const overdrive = item.overdriveHeatParams?.continueFiring === true;
        const stateText = reloading ? '换弹中' : (overheated ? (overdrive ? '红热增压' : '过热冷却') : '自动索敌');
        const stateColor = reloading ? '#8ad0ff' : (overheated ? '#ff8a66' : '#7fe0c8');
        const ammoColor = lowAmmo ? '#ff8a66' : '#e8ddc0';

        const html = `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px;">
                <div style="background:rgba(255,255,255,0.035);border:1px solid #3a3528;border-radius:6px;padding:6px;text-align:center;">
                    <div style="font-size:10px;color:#8f846e;">弹药</div>
                    <div style="font-size:14px;font-weight:700;color:${ammoColor};">${ammoText}</div>
                </div>
                <div style="background:rgba(255,255,255,0.035);border:1px solid #3a3528;border-radius:6px;padding:6px;text-align:center;">
                    <div style="font-size:10px;color:#8f846e;">理论射速</div>
                    <div style="font-size:14px;font-weight:700;color:#e8ddc0;">${rpm > 0 ? `${rpm} RPM` : '—'}</div>
                </div>
                <div style="background:rgba(255,255,255,0.035);border:1px solid #3a3528;border-radius:6px;padding:6px;text-align:center;">
                    <div style="font-size:10px;color:#8f846e;">射程</div>
                    <div style="font-size:14px;font-weight:700;color:#e8ddc0;">${range || '—'}</div>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px;font-size:11px;">
                <span style="color:#8f846e;">运行状态</span>
                <span style="color:${stateColor};font-weight:700;">${stateText}</span>
            </div>
            ${reloading ? `
                <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:#7899a8;">
                    <span>${ammo.singleReloadMode ? '逐发装填' : '整匣换弹'}</span>
                    <span>${Math.ceil(reloadRemaining / 100) / 10}s</span>
                </div>
                <div style="height:6px;background:#20262a;border:1px solid #3f5e6b;border-radius:3px;overflow:hidden;margin-top:3px;">
                    <div style="width:${Math.round(reloadProgress * 100)}%;height:100%;background:#62b7df;"></div>
                </div>` : ''}
            ${showHeat ? `
                <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:#a88772;">
                    <span>枪管热量</span><span>${Math.round(heatProgress * 100)}%</span>
                </div>
                <div style="height:6px;background:#2a211d;border:1px solid #6b4938;border-radius:3px;overflow:hidden;margin-top:3px;">
                    <div style="width:${Math.round(heatProgress * 100)}%;height:100%;background:${overheated ? '#ff654f' : '#d68a45'};"></div>
                </div>` : ''}`;

        if (box.dataset.telemetryHtml === html) return;
        box.innerHTML = html;
        box.dataset.telemetryHtml = html;
    }

    /**
     * 按钮维修（2026-08-15 用户要求）：点击一次修满，能源不足修到能负担的上限；
     * 与掩体建筑面板修理同口径，费率 DEFENSE_CONFIG.repair.towerHpPerEnergy。
     */
    _repairTower() {
        const t = this.tower;
        if (!t || !t.active || t.hp >= t.maxHp) return;
        const rate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.towerHpPerEnergy) || 3;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const want = Math.min(t.maxHp - t.hp, energy * rate);
        if (want <= 0) {
            this._notify('能源不足，无法修理', '#ff5555');
            return;
        }
        const cost = Math.max(1, Math.ceil(want / rate));
        if (!EnergyManager || !EnergyManager.deductEnergy(cost)) {
            this._notify('能源不足，无法修理', '#ff5555');
            return;
        }
        t.hp = Math.min(t.maxHp, t.hp + want);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(t.x, t.y - 40, `+${Math.round(want)} 修理`, '#7fd4ff'));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        this.refresh();
    }

    _notify(text, color) {
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, text, color || '#d4c5a9'));
        }
    }

    _equip(tower, item, _player) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.indexOf(item);
        if (idx >= 0) bp.splice(idx, 1);
        if (tower.equipWeapon(item)) {
            this._notify(`${item.name} 已装载到防御塔`, '#ffd700');
        } else {
            bp.push(item);
            this._notify('该武器无法装载（仅限远程武器，手枪除外）', '#ff5555');
        }
        this.refresh();
    }

    _unequip(tower, _player) {
        const item = tower.weaponItem;
        if (!item) return;
        if (EquipManager.addToBackpack(item)) {
            tower.unequipWeapon();
            this._notify(`${item.name} 已卸下`, '#8a9aff');
        } else {
            this._notify('背包已满，无法卸下', '#ff5555');
        }
        this.refresh();
    }

    _upgradeChipStat(tower, statKey, _player) {
        const res = tower.upgradeStat(statKey, _player);
        if (res.ok) {
            this._notify(`${res.name} 强化至 ${res.value}（-${res.cost} 金币）`, '#ffd700');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    _upgradeModule(tower, moduleId, _player) {
        const res = tower.upgradeModule(moduleId, _player);
        if (res.ok) {
            this._notify(`${res.name} 升至 Lv.${res.level}（-${res.cost} 金币）`, '#ffd700');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    refresh() {
        const el = this.el;
        if (!el) return;
        if (!this.tower) return;
        const t = this.tower;
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        el.querySelector('#dtTitle').textContent = t.name;
        const detail = el.querySelector('#dtBuildingDetail');
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: t.spriteCfg?.idleKey || 'obstacle_defense_tower',
                name: t.name,
                hp: t.hp,
                maxHp: t.maxHp,
                accent: '#ffd700',
                status: t.weaponItem ? '已装载武器 · 自动索敌中' : '未装载武器',
                statusColor: t.weaponItem ? '#7fe0c8' : '#9a9a9a',
            });
        }

        // 武器槽
        const slot = el.querySelector('#dtWeaponSlot');
        slot.innerHTML = '';
        if (t.weaponItem) {
            const it = t.weaponItem;
            const dmg = t.getPreviewDamage().current;
            const img = towerWeaponImagePath(it);
            const elv = it.enhanceLevel || 0;
            slot.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                        ${img
                            ? `<img src="${img}" alt="" style="height:42px;max-width:130px;object-fit:contain;filter:drop-shadow(0 0 4px rgba(0,0,0,0.5));">`
                            : `<span style="font-size:26px;">${it.icon || '🔫'}</span>`}
                        <div style="min-width:0;">
                            <div style="font-weight:700;">${it.name}${elv > 0 ? ` <span style="color:#ffd700;font-size:12px;">强化 +${elv}</span>` : ''}</div>
                            <div style="font-size:12px;color:#9a9a9a;">每发伤害 ≈ ${dmg}（已含芯片/改造模块/强化加成）</div>
                        </div>
                    </div>
                    <button id="dtUnequip" style="flex-shrink:0;background:#5a3028;color:#ffd7d0;border:1px solid #8a4a3a;border-radius:6px;padding:4px 10px;cursor:pointer;">卸下</button>
                </div>
                <div id="dtWeaponTelemetry" aria-live="polite"></div>`;
            slot.querySelector('#dtUnequip').addEventListener('click', () => this._unequip(t, player));
            this._refreshWeaponTelemetry();
        } else {
            slot.innerHTML = '<div style="color:#8a8a8a;font-size:13px;">未装备武器 —— 从下方列表选择一件远程武器（手枪除外）</div>';
        }

        // 可装载武器列表（背包）
        const list = el.querySelector('#dtWeaponList');
        list.innerHTML = '';
        const weapons = (EquipManager.backpackItems || []).filter(i => DefenseTower.isTowerWeapon(i));
        if (weapons.length === 0) {
            list.innerHTML = '<div style="color:#8a8a8a;padding:8px;">背包中没有可装载的远程武器（手枪除外）</div>';
        }
        weapons.forEach((it) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 2px;border-bottom:1px solid #2e2a22;gap:8px;';
            const dmg = t._computeDamageFor(it);
            const img = towerWeaponImagePath(it);
            row.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                    ${img
                        ? `<img src="${img}" alt="" style="height:30px;max-width:90px;object-fit:contain;">`
                        : `<span>${it.icon || '🔫'}</span>`}
                    <span style="min-width:0;">${it.name} <span style="color:#8a8a8a;font-size:12px;">(${dmg}/发)</span></span>
                </div>
                <button style="flex-shrink:0;background:#3a5a3a;color:#d4ffd0;border:1px solid #5a8a5a;border-radius:6px;padding:3px 10px;cursor:pointer;">装载</button>`;
            row.querySelector('button').addEventListener('click', () => this._equip(t, it, player));
            list.appendChild(row);
        });

        // 维修区（2026-08-15 用户要求）：与建筑面板掩体详情修理同口径——
        // 底部信息 + 一次修满按钮，费率读取 towerHpPerEnergy 配置。
        const rp = el.querySelector('#dtRepair');
        if (rp) {
            const rate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.towerHpPerEnergy) || 3;
            const rhp = Math.max(0, Math.ceil(t.hp));
            const rmax = t.maxHp || 1;
            const rpct = Math.round((rhp / rmax) * 100);
            const rbar = rpct > 60 ? '#7fd47f' : (rpct > 30 ? '#ffd700' : '#ff6666');
            const rneed = Math.ceil((rmax - rhp) / rate);
            rp.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="font-size:13px;color:#a8e0e0;font-weight:700;">🔧 维修</div>
                    <div style="font-size:12px;color:#9a9a9a;">费率 ${rate} 耐久 / 1 能源</div>
                </div>
                <div style="height:8px;background:#26261e;border:1px solid #4a6a6a;border-radius:4px;overflow:hidden;margin-bottom:8px;">
                    <div style="width:${rpct}%;height:100%;background:${rbar};"></div>
                </div>
                <button id="dtRepairBtn" ${rhp >= rmax ? 'disabled' : ''} style="width:100%;background:#263a3a;color:#7fd4ff;border:1px solid #4a6a6a;border-radius:6px;padding:7px 0;${rhp >= rmax ? 'opacity:0.45;cursor:default;' : 'cursor:pointer;'}">${rhp >= rmax ? '耐久已满' : `修 理（-${rneed} 能源）`}</button>`;
            rp.querySelector('#dtRepairBtn').addEventListener('click', () => this._repairTower());
        }

        // 神经芯片 · 六维强化（2026-08-16 重构：取代原塔等级，与改造模块并存）：
        // 每张属性卡 = 当前值 + 对当前武器的实时边际注释（真实公式差分，未挂钩=无影响）+ 逐级递增金币升级
        const chip = el.querySelector('#dtChip');
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const chipCfg = DEFENSE_CONFIG.tower.chip || {};
        const chipStats = chipCfg.stats || {};
        const maxVal = chipCfg.max ?? 30;
        const weaponItem = t.weaponItem;
        const mountedStat = t.getChipWeaponStat(weaponItem);
        const preview = t.getPreviewDamage();
        const chipCells = Object.entries(chipStats).map(([key, s]) => {
            const val = t.chip[key] ?? chipCfg.base ?? 10;
            const marg = t._statMarginalPerPoint(key);
            const maxed = val >= maxVal;
            const cost = maxed ? 0 : t.getChipUpgradeCost(key);
            let effectText;
            if (!weaponItem) {
                effectText = '<span style="color:#5a7a72;">未装备武器</span>';
            } else if (Math.abs(marg) < 0.05) {
                effectText = '<span style="color:#7a6a5a;">无影响</span>';
            } else {
                effectText = `<span style="color:#7fe0c8;">每点${s.name} +${marg.toFixed(1)} 攻击力</span>`;
            }
            const previewLine = (weaponItem && key === mountedStat && !maxed)
                ? `<div style="font-size:11px;color:#8ad0ff;margin-top:2px;">升级后伤害 ${preview.current} → ${preview.next}</div>`
                : '';
            const btn = maxed
                ? '<span style="color:#8a8a8a;font-size:11px;">已达上限</span>'
                : `<button data-chip="${key}" style="width:100%;background:#2a4a3a;color:#c8ffe0;border:1px solid #3a7a5a;border-radius:6px;padding:4px 0;cursor:pointer;font-size:12px;">+1（-${cost} 金）</button>`;
            return `
                <div style="border:1px solid #234a44;border-radius:6px;background:rgba(0,0,0,0.3);padding:8px 6px;text-align:center;display:flex;flex-direction:column;gap:4px;">
                    <div style="font-size:12px;color:#7fb8ac;">${s.icon} ${s.name}</div>
                    <div style="font-size:18px;font-weight:700;color:#e8f4f0;">${val}</div>
                    <div style="font-size:11px;line-height:1.4;min-height:26px;">${effectText}${previewLine}</div>
                    ${btn}
                </div>`;
        }).join('');
        chip.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#7fe0c8;">🧠 神经芯片 · 六维强化</span>
                <span style="font-size:12px;color:#9adfcf;">持有 <b style="color:#ffd700;">${gold}</b> 金币</span>
            </div>
            <div style="font-size:11px;color:#6a9a92;margin-bottom:8px;line-height:1.6;">
                属性升级不直接增加攻击力，只强化「与当前武器挂钩」的主属性（如 PKM ↔ 力量）。
                强化/改造/附魔自动计入公式；金币逐级递增。
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">${chipCells}</div>`;
        chip.querySelectorAll('[data-chip]').forEach((btn) => {
            btn.addEventListener('click', () => this._upgradeChipStat(t, btn.dataset.chip, player));
        });

        // 改造模块（2026-08-16 重新引入，与六维芯片并存）：
        // 6 张抠图卡片（伤害强化/射程增强/速射模块/快速换弹/过热抑制/快速散热），
        // 图标 = assets/ui/tower/*.png；升级直接改武器参数，金币逐级递增。
        const modBox = el.querySelector('#dtModules');
        if (modBox) {
            const modCfg = DEFENSE_CONFIG.tower.modules || {};
            const modCards = Object.entries(modCfg).map(([mid, mod]) => {
                const lv = t.modules[mid] || 0;
                const maxedMod = lv >= mod.maxLevel;
                const cost = maxedMod ? 0 : t.getModuleCost(mid);
                const pct = Math.round(Math.abs(mod.per) * 100);
                const descCur = mod.desc.replace('{pct}', `${pct * lv}`);
                const descNext = mod.desc.replace('{pct}', `${pct * Math.min(mod.maxLevel, lv + 1)}`);
                const btn = maxedMod
                    ? '<span style="color:#8a8a8a;font-size:11px;">已满级</span>'
                    : `<button data-mod="${mid}" style="width:100%;background:#4a3a1a;color:#ffe9a0;border:1px solid #8a7a3a;border-radius:6px;padding:4px 0;cursor:pointer;font-size:12px;">+1（-${cost} 金）</button>`;
                return `
                    <div style="border:1px solid #4a4a2a;border-radius:8px;background:rgba(60,50,20,0.18);padding:8px 6px;text-align:center;display:flex;flex-direction:column;gap:4px;">
                        <img src="${mod.icon}" alt="" style="height:44px;object-fit:contain;align-self:center;">
                        <div style="font-size:12px;color:#ffd700;">${mod.name} <span style="color:#c8b98a;">Lv.${lv}/${mod.maxLevel}</span></div>
                        <div style="font-size:11px;line-height:1.4;color:#c8b98a;min-height:26px;">${lv > 0 ? descCur : '未升级'}</div>
                        ${!maxedMod ? `<div style="font-size:10px;color:#8a9a6a;">${descNext}</div>` : ''}
                        ${btn}
                    </div>`;
            }).join('');
            modBox.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;color:#ffd700;">🛠 改造模块</span>
                    <span style="font-size:12px;color:#9a9a9a;">伤害/射程/射速/换弹/过热/散热</span>
                </div>
                <div style="font-size:11px;color:#8a7a5a;margin-bottom:8px;line-height:1.6;">
                    芯片管伤害挂钩主属性；改造模块直接强化武器参数，金币逐级递增，与芯片独立升级。
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">${modCards}</div>`;
            modBox.querySelectorAll('[data-mod]').forEach((btn) => {
                btn.addEventListener('click', () => this._upgradeModule(t, btn.dataset.mod, player));
            });
        }

        // 出售（2026-08-14）：返还 50% 建造能源，武器归还背包
        const sellBtn = el.querySelector('#dtSell');
        if (sellBtn) {
            sellBtn.style.display = '';
            const durability = Math.max(0, Math.min(1,
                Number(t.hp) / Math.max(1, Number(t.maxHp) || 1)));
            const refund = Math.floor((t._buildCost ?? DEFENSE_CONFIG.tower.rebuildCost ?? 1000)
                * (DEFENSE_CONFIG.tower.sellRefundRatio ?? 0.5) * durability);
            sellBtn.title = `出售返还 ${refund} 能源（武器归还背包）`;
            sellBtn.onclick = () => {
                const res = DefenseSystem.sellTower(t, player);
                this._notify(res.ok ? `已出售（+${res.refund} 能源）` : res.reason, res.ok ? '#ffd700' : '#ff5555');
                this.refresh();
            };
        }
    }

}

// ==================== 防守系统 ====================

export const DefenseSystem = {
    active: false,
    defeated: false,
    victory: false,     // 防守胜利（清完 victoryWave 波，2026-08-14）
    _victoryGranted: false,
    base: null,
    towers: [],
    staircases: [],
    _wallTopGuardSegs: [],
    _wallTopGuardRevision: 0,
    // 离散波次状态机（2026-08-14）：'prep' 准备期 → 'wave' 战斗中 → 'break' 波间休息
    _phase: 'prep',
    _wave: 0,
    _phaseTimer: 0,
    _hudEl: null,
    _hudTimer: 0,
    _spawnTimer: 0,
    _eliteTimer: 0,
    _lordTimer: 0,
    _elapsed: 0,
    _seq: 0,
    _goldGranted: null,
    _panel: null,
    // 修理状态（E 键长按，2026-08-14）
    _repairHeld: false,
    _repairTimer: 0,
    _repairTarget: null,
    _repairFlash: 0,
    _elevatedNavUnits: new Set(),
    _managedExternally: false,
    _managedConfig: null,
    _managedResolved: null,
    _worldId: null,

    _ensurePanel() {
        if (!this._panel) this._panel = new DefenseTowerPanel();
        return this._panel;
    },

    setup(player, options = {}) {
        this.teardown();
        this.active = true;
        this.defeated = false;
        this.victory = false;
        this._victoryGranted = false;
        this._elapsed = 0;
        // 离散波次：准备期 30s（怪物不进攻），波号从 1 起
        this._phase = 'prep';
        this._wave = 0;
        this._phaseTimer = DEFENSE_CONFIG.spawn.prepMs;
        this._eliteTimer = 0;
        this._lordTimer = 0;
        this._seq = 0;
        this._goldGranted = new Set();
        this._managedExternally = options.managedExternally === true;
        this._managedConfig = null;
        this._managedResolved = null;
        this._worldId = options.worldId || null;
        this._elevatedNavUnits.clear();
        ElevatedNavigationController.reset();
        this.towers = [];
        this.gates = [];
        this.staircases = [];
        this.base = options.targetEntity || null;
        if (this._managedExternally) {
            // scene8~scene11 共用“世界模式”献祭 Buff；离开常驻世界后由 teardown 停用。
            World122TributeSystem.setup(player);
            return;
        }
        this._buildBaseRoom();

        const baseCfg = DEFENSE_CONFIG.base;
        const core = new DefenseBase(baseCfg.x, baseCfg.y, { onDestroyed: () => this._onBaseDestroyed() });
        Game.entities.set('defense_base', core);
        this.base = core;
        World122TributeSystem.setup(player);

        this.towers = [];
        this.gates = []; // 建筑面板放置的铁栅栏门
        this.staircases = [];
        DEFENSE_CONFIG.towers.forEach((p, i) => {
            const tower = new DefenseTower(p.x, p.y, { id: `defense_tower_${i}` });
            Game.entities.set(`defense_tower_${i}`, tower);
            this.towers.push(tower);
        });

        // 原型演示：1 号塔预装 PKM（其余塔由玩家从背包装载；卸下会归还背包）
        this._presetTowerWeapon(this.towers[0], 'weapon6');
        // 掩体防线（可被攻击，def/mdef=0）
          (DEFENSE_CONFIG.covers.layout || []).forEach((c, i) => {
              const cover = new DefenseCover(c.x, c.y, {
                  grade: c.grade,
                  orient: c.orient,
                  w: c.w,
                  d: c.d,
                  depthBias: c.depthBias,
                  block: c.block, // 2026-08-17：1×1 方格块
                  id: `defense_cover_${i}`,
              });
              Game.entities.set(`defense_cover_${i}`, cover);
          });
          // 基地不预置楼梯，由玩家在 B 建筑面板贴墙建造。
          // 基地铁栅栏滑动门（D 级，2026-08-15）：状态机默认关闭；
          // 友军（玩家/侍从）靠近自动打开，离开 1.2s 后自动关闭（阻挡门洞）。
          // 2026-08-16：基地门改用 BuildableGate（Combatant）——可被怪物攻击、
          // 沉陷死亡动画、建筑面板详情（常锁/常开/修理）与玩家建造门完全同构；
          // 几何 face 线公式与旧 CoverGate.place 一致（_buildBaseRoom 已核对）。
          const gs = DEFENSE_CONFIG.covers.gate;
          if (this._baseGate4Pos) {
              // 4 格门（2026-08-17）：石柱由上方方块墙实体承担，门实体 = 2 格铁栅栏
              const g4 = this._baseGate4Pos;
              const gate = new BuildableGate(g4.x, g4.y, {
                  grade: 'D',
                  orient: 'v',
                  barCells: 2,
                  barsOnly: true,
                  id: 'defense_base_gate',
              });
              Game.entities.set(gate.id, gate);
              this.gate = gate;
          } else if (gs) {
              const gate = new BuildableGate(gs.x, gs.y, {
                  grade: 'D',
                  orient: 'v', // RB 边（从 R 到 B）为 v 向，与 _buildBaseRoom 门洞一致
                  id: 'defense_base_gate',
              });
              Game.entities.set(gate.id, gate);
              this.gate = gate;
          }
          // 掩体墙段已注册进 WallSystem.isoSegments：让寻路器把静态掩体墙纳入
          // 阻挡网格（怪物绕墙走/从门洞进，不再直线穿墙后在夹角被卡），2026-08-08
          if (pathFinder && typeof pathFinder.invalidateCache === 'function') {
              pathFinder.invalidateCache();
          }

          // 顶部 HUD（波次状态 + 金币/能源实时显示）+ 开战提示（30s 准备期）
          this._createHud();
          if (player) {
              EffectManager.add(new FloatingTextEffect(player.x, player.y - 60, `世界-122 防守战开始！${Math.round(DEFENSE_CONFIG.spawn.prepMs / 1000)} 秒后怪物来袭`, '#ffd700'));
          }
    },

    /**
     * 生成基地菱形掩体环（新掩体墙，2026-08-05 v2）：
     * 四边按 h/v 方向铺放，face 线相邻件重叠 40px（端帽叠合，无缝隙），
     * 边链两端各延伸 cornerExtend，转角由相邻两边端帽互相叠盖。
     * 开口：openEdge 边中点的开放带内的件跳过 → 天然形成居中门洞。
     */
    _buildBaseRoom() {
        const room = DEFENSE_CONFIG.room;
        if (!room || !room.enabled) return;
        const b = DEFENSE_CONFIG.base;
        const T = { x: b.x, y: b.y - room.ry }, R = { x: b.x + room.rx, y: b.y },
              B = { x: b.x, y: b.y + room.ry }, L = { x: b.x - room.rx, y: b.y };
        // 1×1 方格块模式（2026-08-17）：基地不预置墙——用户用建筑面板自行搭建。
        // （此前预置 8 格/边方块环 + 4 格门被用户判为"构建错误"，改为空布局）
        if (room.blockMode) {
            DEFENSE_CONFIG.covers.layout = [];
            return;
        }
        const edges = [
            { key: 'TL', from: T, to: L, orient: 'v' },
            { key: 'TR', from: T, to: R, orient: 'h' },
            { key: 'LB', from: L, to: B, orient: 'h' },
            { key: 'RB', from: R, to: B, orient: 'v' },
        ];
        // face 线几何（6 级统一，见 COVER_FACE）：|A→B| = 196.33px，端帽叠合 40px
        const face = (COVER_FACE[room.coverGrade] && COVER_FACE[room.coverGrade].v) || COVER_FACE.D.v;
        const faceLen = Math.hypot(face.B.x - face.A.x, face.B.y - face.A.y);
        const joinOverlap = 40; // 与 building-system SNAP_OVERLAP 同源（端帽宽 ≈52 ≥ 40）
        const step = faceLen - joinOverlap; // 相邻件中心沿墙步长 ≈156.33
        const cornerExt = room.cornerExtend ?? 45;
        // 转角图层（2026-08-08）：上角 TR(h) 盖 TL(v)、下角 RB(v) 盖 LB(h) 时
        // 砖纹过渡更连贯（A/B 实机对比 + GLM）；旧行为左臂在上（TL/LB +0.5）
        const rightOnTop = room.cornerLayer !== 'leftOnTop';
        const openEdge = room.openEdge;
        const layout = [];
        let gatePos = null; // 2026-08-17：门占一个完整墙位（大小=墙，face 196.77）
        for (const e of edges) {
            const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
            const len = Math.hypot(dx, dy);
            const ux = dx / len, uy = dy / len;
            // ⚠ 2026-08-08 修正：face 端点在边方向上的投影不对称（朝顶点端
            // 127px、朝另一端 69.3px），旧代码用 faceLen/2（98px）当对称半跨，
            // 导致转角件实际越过顶点 73.8px（意图 cornerExtend），两臂在角点
            // 侵入式叠合 ~147px。这里按真实投影定首/末件位置：
            const g = (COVER_FACE[room.coverGrade] && COVER_FACE[room.coverGrade][e.orient])
                || COVER_FACE.D[e.orient] || COVER_FACE.D.v;
            const projA = g.A.x * ux + g.A.y * uy;
            const projB = g.B.x * ux + g.B.y * uy;
            // 朝顶点（t 减小方向）的端点是投影更小的一端
            const towardV = projA < projB ? 'A' : 'B';
            const halfToV = Math.abs(towardV === 'A' ? projA : projB);   // 朝顶点半跨 127
            const halfAway = Math.abs(towardV === 'A' ? projB : projA);  // 另一端半跨 69.3
            // 首件中心：朝顶点端 face 端点落在 t = −cornerExt
            const t0 = -cornerExt + halfToV;
            // 末件中心：另一端 face 端点落在 t = len + cornerExt
            const tLast = len + cornerExt - halfAway;
            // n 件均布：相邻 face 重叠 ≥ joinOverlap（spacing ≤ step）
            const span = tLast - t0;
            const n = Math.max(2, Math.ceil(span / step) + 1);
            const spacing = n > 1 ? span / (n - 1) : 0;
            // 单边 4 段（用户口径）：openEdge 第 2 段（i=2）替换为门，其余为墙
            const gateSlot = e.key === openEdge ? Math.min(n - 1, Math.max(1, Math.floor(n / 2))) : null;
            const alignY = e.key === openEdge ? (room.doorAlignY || 0) : 0;
            // 上夹角 TL/TR 边：整条边共享同一纹理变体（相邻件端帽互叠，
            // 独立随机会在接缝处出现"两层墙皮"式砖纹错位）；
            for (let i = 0; i < n; i++) {
                const t = t0 + i * spacing;
                if (i === gateSlot) {
                    gatePos = {
                        x: Math.round(e.from.x + ux * t),
                        y: Math.round(e.from.y + uy * t) + alignY,
                    };
                    continue; // 该墙位由门占据
                }
                layout.push({
                    x: Math.round(e.from.x + ux * t),
                    y: Math.round(e.from.y + uy * t) + alignY,
                    grade: room.coverGrade,
                    orient: e.orient,
                    edge: e.key,
                    t,
                    // 图层覆盖顺序（2026-08-08 A/B 实测定稿）：
                    // - 上角 TR(h) 盖 TL(v)：TR 边 +0.5
                    // - 下角 RB(v) 盖 LB(h)：RB 边 +0.5
                    // 两臂 faceDepth 相同，偏置决定谁在上；右盖左时转角无暗缝
                    depthBias: (rightOnTop ? (e.key === 'TR' || e.key === 'RB') : (e.key === 'TL' || e.key === 'LB')) ? 0.5 : 0,
                });
            }
        }
        // 基地门（占一个完整墙位）：face = 墙 face（worldFaceLen 176 水平 = 196.77 沿边），
        // 与相邻墙段按墙-墙 40px 端帽重叠拼接。
        if (gatePos) {
            const gx = gatePos.x;
            const gy = gatePos.y;
            const half = GATE_CONFIG.worldFaceLen / 2;
            const midY = gy - 65; // COVER_FACE v 中点偏移（接地线过 (x, y-65)）
            const ge = edges.find((e) => e.key === openEdge);
            if (ge && ge.orient === 'v') {
                DEFENSE_CONFIG.covers.gate = {
                    x: gx, y: gy,
                    A: { x: Math.round(gx - half), y: Math.round(midY + half * 0.5) },
                    B: { x: Math.round(gx + half), y: Math.round(midY - half * 0.5) },
                };
            } else {
                DEFENSE_CONFIG.covers.gate = {
                    x: gx, y: gy,
                    A: { x: Math.round(gx - half), y: Math.round(midY - half * 0.5) },
                    B: { x: Math.round(gx + half), y: Math.round(midY + half * 0.5) },
                };
            }
        }
        DEFENSE_CONFIG.covers.layout = layout;
    },

    teardown() {
        this._clearWallTopGuardSegs();
        World122TributeSystem.teardown();
        this.active = false;
        this.defeated = false;
        this.victory = false;
        this._victoryGranted = false;
        if (this.gate) { this.gate.destroy(); this.gate = null; }
        if (this.gates) {
            for (const g of this.gates) { if (g && typeof g.destroy === 'function') g.destroy(); }
            this.gates = [];
        }
        if (this.staircases) {
            for (const p of [...this.staircases]) {
                if (p && typeof p.destroy === 'function') p.destroy();
            }
            this.staircases = [];
        }
        this._wallStairGroupSignature = '';
        this._wallStairGroupVersion = 0;
        this._wallStairGroupCheckTimer = 0;
        this._elevatedTopologySignature = '';
        this._elevatedTopologyVersion = 0;
        this._wallTopGuardRevision = 0;
        elevatedTopology.reset();
        this.base = null;
        this.towers = [];
        this._phase = 'prep';
        this._wave = 0;
        this._phaseTimer = 0;
        this._destroyHud();
        this._spawnTimer = 0;
          this._eliteTimer = 0;
          this._lordTimer = 0;
          this._elapsed = 0;
          this._goldScanTimer = 0;
          this._aliveCountCache = undefined;
          this._aliveCountTime = 0;
        this._seq = 0;
          this._managedExternally = false;
          this._managedConfig = null;
          this._managedResolved = null;
          this._worldId = null;
          this._elevatedNavUnits.clear();
          ElevatedNavigationController.reset();
          if (this._goldGranted) this._goldGranted.clear();
          this._goldGranted = null;
          // 掩体墙段已移除：寻路网格随之重建（怪物不再绕不存在的墙）
          if (pathFinder && typeof pathFinder.invalidateCache === 'function') {
              pathFinder.invalidateCache();
          }
          if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.tower = null;
            this._panel.player = null;
        }
        // 场景切换时实体由 switchScene 统一清空；场景内手动 teardown 由调用方负责清理实体
    },

    _presetTowerWeapon(tower, weaponId) {
        const item = findWeaponConfig(weaponId);
        if (!item || !tower) return;
        tower.equipWeapon(JSON.parse(JSON.stringify(item)));
    },

    update(dt) {
        if (!this.active || this.defeated) return;
        World122TributeSystem.update();
        syncGateSeamDepths(); // 拼接缝图层偏置（左门右柱盖右门左柱）随放置/拆除每帧同步
        this._elapsed += dt;
        this._repairTick(dt);
        this._wallStairGroupCheckTimer = (Number(this._wallStairGroupCheckTimer) || 0) - dt;
        if (this._wallStairGroupCheckTimer <= 0) {
            this._wallStairGroupCheckTimer = 250;
            ensureWallStairGroups(this.staircases);
            this._refreshElevatedTopologyRevision();
        }
        if (this.gate) this.gate.update(dt); // 友军靠近自动开门 / 离开延时关门
        for (const g of this.gates) { if (g && g.active) g.update(dt); } // 已放置的铁栅栏门
        this._updateElevatedSurfaceStates(dt);
        this._grantMonsterGold(dt);
        this._updateHud(dt);
        if (this._managedExternally && !this._managedConfig) return;
        if (this._managedExternally && this.base
            && (this.base._portalDestroyed || this.base.hp <= 0 || this.base.active === false)) {
            this._onBaseDestroyed();
            return;
        }
        if (this.victory) return;

        // ==================== 离散波次状态机（2026-08-14）====================
        // prep（30s 准备，怪物不进攻）→ wave（一批刷出，清空才结束）→ break（10s 修整）→ 下一波
        this._phaseTimer -= dt;
        switch (this._phase) {
            case 'prep':
                if (this._phaseTimer <= 0) {
                    this._wave = 1;
                    this._startWave();
                }
                break;
            case 'wave':
                // 波内怪物全部死亡 → 波次结束：最后一波胜利，否则进入波间休息
                if (this._aliveCount() === 0) {
                    const victoryWave = this._managedConfig?.waveCount
                        || DEFENSE_CONFIG.spawn.victoryWave || 10;
                    if (this._wave >= victoryWave) {
                        this._onVictory();
                    } else {
                        this._phase = 'break';
                        this._phaseTimer = this._managedConfig?.waveBreakMs
                            || DEFENSE_CONFIG.spawn.waveBreakMs || 10000;
                        this._announce(`第 ${this._wave} 波已清除！${Math.round(this._phaseTimer / 1000)} 秒后下一波`, '#9dff9d');
                    }
                }
                break;
            case 'break':
                if (this._phaseTimer <= 0) {
                    this._wave++;
                    this._startWave();
                }
                break;
        }
        // 精英/领主旧计时器已停用（2026-08-15 用户确认方案）：改由 _startWave 按 wavePlan
        // 脚本化生成，与波次节奏挂钩；旧配置字段 eliteEveryMs/lordEveryMs 保留兼容，不再驱动生成
    },

    _refreshElevatedTopologyRevision() {
        // 建筑集合沿用同一个 Map，单靠引用相等无法发现外部会话/脚本直接增删墙体。
        // 仅按既有 250ms 节流重算轻量签名；签名未变时 refresh 会立即返回，不把扫描摊到每个单位。
        const topologyChanged = elevatedTopology.refresh(Game?.entities, this.staircases || []);
        const registeredSegments = new Set(WallSystem?.isoSegments || []);
        const guardsMissing = (this._wallTopGuardSegs || []).some((segment) =>
            !registeredSegments.has(segment));
        if (topologyChanged || guardsMissing
            || this._wallTopGuardRevision !== elevatedTopology.revision) {
            this._rebuildWallTopGuardSegs(elevatedTopology);
        }
        this._elevatedTopologySignature = elevatedTopology.signature;
        this._elevatedTopologyVersion = elevatedTopology.revision;
        return this._elevatedTopologyVersion;
    },

    invalidateElevatedTopology() {
        elevatedTopology.invalidate();
        this._wallStairGroupCheckTimer = 0;
    },

    _clearWallTopGuardSegs() {
        const guards = new Set(this._wallTopGuardSegs || []);
        if (WallSystem?.isoSegments && (guards.size
            || WallSystem.isoSegments.some((segment) => segment?._surfaceWallTopGuard))) {
            WallSystem.isoSegments = WallSystem.isoSegments.filter((segment) =>
                !guards.has(segment) && !segment?._surfaceWallTopGuard);
        }
        this._wallTopGuardSegs = [];
    },

    /**
     * 墙顶防坠线只覆盖连续墙体的真实外轮廓。墙墙共享边与墙梯入口边都是Portal，
     * 必须保持开放；不能再由楼梯向墙外伸线，否则会重新切断宽入口。
     */
    _rebuildWallTopGuardSegs(topology = elevatedTopology) {
        this._clearWallTopGuardSegs();
        if (!WallSystem?.isoSegments || !topology) return;
        const guards = [];
        for (const wall of topology.values()) {
            const geometry = blockWallTopWalkGeometry(wall);
            if (!geometry?.vertices?.length) continue;
            const openEdges = new Set();
            for (const neighbor of topology.neighbors(wall)) {
                const neighborGeometry = blockWallTopWalkGeometry(neighbor);
                const sharedEdge = neighborGeometry
                    ? _edgeFacingPoint(geometry.vertices, neighborGeometry.center)
                    : null;
                if (sharedEdge) openEdges.add(sharedEdge.index);
            }
            for (const staircase of this.staircases || []) {
                if (!staircase?.active || staircase.wall !== wall) continue;
                const connector = staircase.wallConnectorSurface?.();
                if (Number.isInteger(connector?.wallEdgeIndex)) {
                    openEdges.add(connector.wallEdgeIndex);
                }
            }
            const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            for (let edgeIndex = 0; edgeIndex < geometry.vertices.length; edgeIndex++) {
                if (openEdges.has(edgeIndex)) continue;
                const a = geometry.vertices[edgeIndex];
                const b = geometry.vertices[(edgeIndex + 1) % geometry.vertices.length];
                const guard = {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    halfThick: WALL_STAIR_CONFIG.edgeHalfThick,
                    _surfaceZ1: topZ,
                    _surfaceZ2: topZ,
                    _surfaceWallGuard: true,
                    _surfaceWallTopGuard: true,
                    _elevatedOnly: true,
                    _stairEdge: true,
                    _owner: wall,
                };
                WallSystem.isoSegments.push(guard);
                guards.push(guard);
            }
        }
        this._wallTopGuardSegs = guards;
        this._wallTopGuardRevision = Number(topology.revision) || 0;
    },

    elevatedNavigationRevision() {
        return Number(elevatedTopology.revision) || Number(this._elevatedTopologyVersion) || 0;
    },

    /** 左下角“范围”开关使用：直接暴露当前导航真源，不另算一套调试几何。 */
    debugElevatedNavigationGeometry(entitySource = null) {
        ensureWallStairGroups(this.staircases || []);
        const topology = _blockWallIndex(entitySource || Game?.entities);
        if (this._wallTopGuardRevision !== topology.revision) {
            this._rebuildWallTopGuardSegs(topology);
        }
        return {
            revision: topology.revision,
            walls: Array.from(topology.values()),
            wallConnectors: Array.from(topology.connectors()),
            wallJunctions: Array.from(topology.junctions()),
            wallGuards: [...(this._wallTopGuardSegs || [])],
            staircases: (this.staircases || []).filter((staircase) => staircase?.active),
        };
    },

    isWallStairAttachmentEligible(wall, stepX, stepY) {
        if (!wall?._isBlockCover || !wall?._isWalkableWall) return false;
        const topology = _blockWallIndex(Game?.entities);
        return topology.isExternalAttachment(wall, stepX, stepY);
    },

    /** 全局入侵调度器接管波次。世界本身常驻建筑系统，只有五日入侵到来时才启动刷怪。 */
    beginManagedInvasion(config, targetEntity, onResolved) {
        if (!this.active || !this._managedExternally || !targetEntity) return false;
        this.base = targetEntity;
        this.defeated = false;
        this.victory = false;
        this._managedConfig = {
            ...config,
            waves: (config?.waves || []).map((wave) => wave.slice()),
            spawnPoints: (config?.spawnPoints || []).map((point) => ({ ...point })),
        };
        this._managedResolved = onResolved || null;
        this._wave = Math.max(1, Number(config?.startWave) || 1);
        this._phase = 'wave';
        this._phaseTimer = 0;
        this._startWave();
        return true;
    },

    stopManagedInvasion({ clearMonsters = true } = {}) {
        if (clearMonsters && Game?.entities) {
            for (const [key, entity] of Array.from(Game.entities.entries())) {
                if (!entity?._defenseMonster) continue;
                // 位面毁灭挑战与五日入侵并行；结束普通入侵不能清掉无尽挑战怪潮。
                if (entity._destructionChallengeMonster) continue;
                entity.active = false;
                entity._destroyPhaserSprite?.();
                Game.entities.delete(key);
            }
        }
        this._managedConfig = null;
        this._managedResolved = null;
        this._phase = 'prep';
        this._phaseTimer = 0;
        this._wave = 0;
        this.defeated = false;
        this.victory = false;
    },

    getManagedInvasionState() {
        if (!this._managedConfig) return null;
        return {
            worldId: this._worldId,
            wave: this._wave,
            waveCount: this._managedConfig.waveCount,
            phase: this._phase,
            alive: this._aliveCount(),
        };
    },

    /** 实体分离后的高架最终提交，不重复推进卡死看门狗。 */
    reconcileElevatedSurfaces() {
        this._updateElevatedSurfaceStates(0, {
            elevatedOnly: true,
            reconcileOnly: true,
        });
    },

    /** 墙顶道路允许的移动轴：相邻方块墙中心方向 + 当前墙直连楼梯方向。 */
    _wallWalkMoveAxes(wall) {
        if (!wall?.active) return [];
        const axes = [];
        const addAxis = (dx, dy, kind = 'wall', staircase = null, target = null) => {
            const length = Math.hypot(dx, dy);
            if (length <= 1e-6) return;
            const axis = {
                x: dx / length,
                y: dy / length,
                kind,
                staircaseId: staircase?.id || null,
                targetX: Number.isFinite(target?.x) ? target.x : null,
                targetY: Number.isFinite(target?.y) ? target.y : null,
            };
            const existing = axes.find((candidate) =>
                Math.abs(candidate.x - axis.x) < 1e-4
                && Math.abs(candidate.y - axis.y) < 1e-4);
            if (existing) {
                // 同方向同时存在墙边和Portal时，保留墙边语义，避免楼梯抢占普通移动。
                if (existing.kind !== 'wall' && kind === 'wall') {
                    existing.kind = 'wall';
                    existing.staircaseId = null;
                }
                return;
            }
            axes.push(axis);
        };
        const blockGeometry = blockWallTopWalkGeometry(wall);
        if (blockGeometry && Game?.entities) {
            const index = _blockWallIndex(Game.entities);
            for (const neighbor of _blockWallNeighbors(wall, index)) {
                const geometry = blockWallTopWalkGeometry(neighbor);
                if (geometry && blockWallTopConnectorGeometry(wall, neighbor)) {
                    addAxis(
                        geometry.center.x - blockGeometry.center.x,
                        geometry.center.y - blockGeometry.center.y,
                        'wall',
                        null,
                        geometry.center
                    );
                }
            }
            for (const staircase of this.staircases || []) {
                if (!staircase?.active || staircase.wall !== wall) continue;
                const connector = staircase.wallConnectorSurface?.();
                if (connector) {
                    addAxis(
                        connector.entry.x - blockGeometry.center.x,
                        connector.entry.y - blockGeometry.center.y,
                        'stair_portal',
                        staircase,
                        connector.entry
                    );
                }
            }
            return axes;
        }
        const [a, b] = wall._faceLine || [];
        if (a && b) {
            addAxis(b.x - a.x, b.y - a.y);
            addAxis(a.x - b.x, a.y - b.y);
        }
        return axes;
    },

    /**
     * 楼梯上的移动只能沿踏步坡向，或沿同层并排楼梯的共享缝横移。
     * 把这两类真实可走方向交给 WallSystem 做速度投影，避免斜向输入持续顶住侧轨。
     */
    _stairMoveAxes(staircase, surface = null) {
        if (!staircase?.active) return [];
        const axes = [];
        const addAxis = (dx, dy, kind = 'stair_run', target = null) => {
            const length = Math.hypot(dx, dy);
            if (length <= 1e-6) return;
            const axis = {
                x: dx / length,
                y: dy / length,
                kind,
                staircaseId: staircase.id || null,
                targetX: Number.isFinite(target?.x) ? target.x : null,
                targetY: Number.isFinite(target?.y) ? target.y : null,
            };
            if (!axes.some((candidate) =>
                Math.abs(candidate.x - axis.x) < 1e-4
                && Math.abs(candidate.y - axis.y) < 1e-4)) axes.push(axis);
        };
        const segmentIndex = Math.max(0, staircase.segments?.indexOf(surface?.segment) ?? 0);
        const walk = staircase.visualSegments?.[segmentIndex]?.walkSurface
            || staircase.visualSegments?.[0]?.walkSurface;
        if (walk) {
            const dx = walk.exit.x - walk.entry.x;
            const dy = walk.exit.y - walk.entry.y;
            addAxis(dx, dy, 'stair_run', walk.exit);
            addAxis(-dx, -dy, 'stair_run', walk.entry);
        }
        for (const seam of staircase._sharedStairSurfaces || []) {
            if (seam.connector || seam.segmentIndex !== segmentIndex) continue;
            const railAMid = {
                x: (seam.railA[0].x + seam.railA[1].x) * 0.5,
                y: (seam.railA[0].y + seam.railA[1].y) * 0.5,
            };
            const railBMid = {
                x: (seam.railB[0].x + seam.railB[1].x) * 0.5,
                y: (seam.railB[0].y + seam.railB[1].y) * 0.5,
            };
            const dx = railBMid.x - railAMid.x;
            const dy = railBMid.y - railAMid.y;
            addAxis(dx, dy, 'stair_lateral', railBMid);
            addAxis(-dx, -dy, 'stair_lateral', railAMid);
        }
        return axes;
    },

    /**
     * 实体分离可能在高架首次提交后把单位推入楼梯外侧护栏。楼梯四边形仍会认为
     * 该点有承托，但 WallSystem 会拒绝之后的所有落点，形成永久卡死。这里只在
     * 当前楼梯组的真实外侧护栏已经重叠时，把单位横向移到同一进度的最近安全点；
     * 不改变纵向进度、Z 或表面身份，并排楼梯已删除的内部护栏不会参与。
     */
    _recoverStairEdgeOverlap(unit, surface, staircase, querySurfaceAt) {
        if (!unit || surface?.kind !== 'stairs' || surface.connector
            || surface.sharedSeam || !staircase?.active
            || typeof querySurfaceAt !== 'function') return null;
        const radius = Math.max(
            1,
            Number(unit.groundRadius)
                || Number(unit.collisionRadius)
                || WALL_WALK_CONFIG.surfaceUnitRadius
        );
        const segmentIndex = staircase.segments?.indexOf(surface.segment) ?? -1;
        if (segmentIndex < 0) return null;
        const groupMembers = Array.isArray(staircase._wallStairGroupMembers)
            ? staircase._wallStairGroupMembers
            : [staircase];
        let overlapsOuterRail = false;
        for (const member of groupMembers) {
            if (!member?.active) continue;
            for (const edge of member._edgeSegs || []) {
                if (!edge?._stairEdge || edge._surfaceConnectorEdge
                    || edge._surfaceSegmentIndex !== segmentIndex) continue;
                const distance = WallSystem._groundPointSegDist(
                    unit.x,
                    unit.y,
                    edge
                );
                if (distance < radius + (Number(edge.halfThick) || 0) - 0.05) {
                    overlapsOuterRail = true;
                    break;
                }
            }
            if (overlapsOuterRail) break;
        }
        if (!overlapsOuterRail) return null;

        const walkSurface = staircase.visualSegments?.[segmentIndex]?.walkSurface
            || surface.segment?.walkSurface;
        const coords = staircase._walkSurfaceCoordinates?.(
            walkSurface,
            unit.x,
            unit.y
        );
        if (!walkSurface || !coords) return null;
        const progress = Math.max(0, Math.min(1, Number(coords.progress) || 0));
        const sideA = {
            x: walkSurface.entryA.x
                + (walkSurface.exitA.x - walkSurface.entryA.x) * progress,
            y: walkSurface.entryA.y
                + (walkSurface.exitA.y - walkSurface.entryA.y) * progress,
        };
        const sideB = {
            x: walkSurface.entryB.x
                + (walkSurface.exitB.x - walkSurface.entryB.x) * progress,
            y: walkSurface.entryB.y
                + (walkSurface.exitB.y - walkSurface.entryB.y) * progress,
        };
        const center = {
            x: (sideA.x + sideB.x) * 0.5,
            y: (sideA.y + sideB.y) * 0.5,
        };
        const dx = center.x - unit.x;
        const dy = center.y - unit.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 1e-6) return null;
        const ignore = WallSystem.ignoreForEntity(unit);
        const steps = WALL_STAIR_CONFIG.edgeRecoverySteps;
        const padding = WALL_STAIR_CONFIG.edgeRecoveryPadding;
        for (let index = 1; index <= steps; index++) {
            const travel = Math.min(distance, padding + distance * index / steps);
            const ratio = travel / distance;
            const x = unit.x + dx * ratio;
            const y = unit.y + dy * ratio;
            if (!WallSystem.canMoveTo(x, y, radius, ignore)) continue;
            const recovered = querySurfaceAt(x, y);
            if (recovered.surface?.kind !== 'stairs'
                || !wallStairsShareGroup(
                    recovered.staircase || recovered.surface.staircase,
                    staircase
                )) continue;
            return { ...recovered, x, y, distance: travel };
        }
        return null;
    },

    /** 查询单位脚下的城墙顶面；低空地面单位不能直接被吸到墙顶。 */
    _wallWalkSurfaceAt(unit, x, y) {
        const Game = (typeof window !== 'undefined') ? window.Game : null;
        if (!Game || !Game.entities) return null;
        const currentZ = Math.max(0, Number(unit?.z) || 0);
        const blockIndex = _blockWallIndex(Game.entities);
        let best = null;
        const blockSupport = _blockWallFootprintSupport(
            unit,
            x,
            y,
            blockIndex,
            unit?._surfaceWall || null
        );
        if (blockSupport) {
            const wall = blockSupport.wall;
            const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            const continuing = unit?._surfaceKind === 'wall_walk';
            if (continuing || currentZ >= topZ - WALL_STAIR_CONFIG.risePerSegment - 2) {
                const connector = blockSupport.connector;
                const junction = blockSupport.junction;
                best = {
                    kind: 'wall_walk',
                    z: junction?.topZ ?? connector?.topZ ?? topZ,
                    owner: wall,
                    wall,
                    walls: blockIndex.component(wall),
                    renderDepth: junction
                        ? Math.max(...junction.walls.map((candidate) =>
                            Number(candidate?._faceDepth) || 0))
                        : (connector
                        ? Math.max(
                            Number(connector.wallA?._faceDepth) || 0,
                            Number(connector.wallB?._faceDepth) || 0
                        )
                        : (Number(wall._faceDepth) || structureDepthAtY(wall.y))),
                    distance: blockSupport.distance,
                    projection: { x, y },
                    walkGeometry: blockSupport.geometry,
                    walkConnector: connector || null,
                    walkJunction: junction || null,
                    footprintRadius: blockSupport.radius,
                };
            }
        }
        for (const wall of blockIndex.nearbyWalls(x, y, 240)) {
            if (!wall || !wall.active || !wall._isWalkableWall || !Array.isArray(wall._faceLine)) continue;
            if (wall._isBlockCover) continue; // 方块墙已按完整单位footprint联合区域判定
            const [a, b] = wall._faceLine;
            if (!a || !b) continue;
            const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            const continuing = unit?._surfaceKind === 'wall_walk' && unit?._surfaceWall === wall;
            if (!continuing && currentZ < topZ - WALL_STAIR_CONFIG.risePerSegment - 2) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 <= 1e-6) continue;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
            const px = a.x + dx * t;
            const py = a.y + dy * t;
            const distance = Math.hypot(x - px, y - py);
            const laneWidth = Number(wall._wallWalkWidth) || WALL_WALK_CONFIG.laneWidth;
            if (distance > laneWidth / 2) continue;
            if (!best || distance < best.distance) {
                best = {
                    kind: 'wall_walk',
                    z: topZ,
                    owner: wall,
                    wall,
                    // 旧式长墙不使用方块网格连接器；继续按端点实时收集连通墙，
                    // 否则每段都会得到独立componentId并被误判为不同承载面。
                    walls: wall._isBlockCover
                        ? (blockIndex.component(wall).length ? blockIndex.component(wall) : [wall])
                        : collectConnectedWalkableWalls(wall, Game.entities),
                    renderDepth: Number(wall._faceDepth) || structureDepthAtY(Math.max(a.y, b.y)),
                    distance,
                    projection: { x: px, y: py },
                };
            }
        }
        return best;
    },

    /**
     * 按真实物理平面坐标解析撞击点承载层。
     * 与 resolveSurfaceTarget 的“屏幕投影点击”语义分离，避免用弹体中心 Z 反推屏幕 Y
     * 后在窄墙顶/楼梯边缘命中相邻层。返回值不做 RTS 路线或单位半径内收。
     */
    resolvePhysicalSurface(x, y, impactZ = 0) {
        const pointX = Number(x) || 0;
        const pointY = Number(y) || 0;
        const hitZ = Number(impactZ) || 0;
        const candidates = [{ x: pointX, y: pointY, z: 0, surfaceKind: 'ground' }];
        const pushCandidate = (candidate) => {
            const z = Number(candidate?.z);
            if (!Number.isFinite(z)) return;
            candidates.push({
                x: pointX,
                y: pointY,
                z,
                surfaceKind: candidate.surfaceKind || candidate.kind || null,
                wallId: candidate.wallId || candidate.wall?.id || null,
                staircaseId: candidate.staircaseId || candidate.staircase?.id || null,
            });
        };

        for (const staircase of this.staircases || this.platforms || []) {
            if (!staircase?.active || typeof staircase.surfaceAt !== 'function') continue;
            const surface = staircase.surfaceAt(pointX, pointY);
            if (!surface) continue;
            pushCandidate({
                ...surface,
                surfaceKind: 'stairs',
                staircase: staircase,
            });
        }

        const blockIndex = Game?.entities ? _blockWallIndex(Game.entities) : null;
        if (Game?.entities) {
            for (const wall of Game.entities.values()) {
                if (!wall?.active || !wall._isWalkableWall || !Array.isArray(wall._faceLine)) continue;
                const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
                const blockGeometry = blockWallTopWalkGeometry(wall);
                if (blockGeometry) {
                    let supported = pointInIsoFootprint(
                        pointX,
                        pointY,
                        blockGeometry.footprint,
                        blockGeometry.edgeTolerance
                    );
                    if (!supported) {
                        for (const neighbor of _blockWallNeighbors(wall, blockIndex)) {
                            const connector = blockWallTopConnectorGeometry(wall, neighbor);
                            if (connector && pointInIsoFootprint(
                                pointX,
                                pointY,
                                connector.footprint,
                                connector.tolerance
                            )) {
                                supported = true;
                                break;
                            }
                        }
                    }
                    if (!supported && typeof blockIndex?.nearbyJunctions === 'function') {
                        for (const junction of blockIndex.nearbyJunctions(pointX, pointY)) {
                            if (!junction?.walls?.includes(wall)) continue;
                            if (!pointInIsoFootprint(
                                pointX,
                                pointY,
                                junction.footprint,
                                junction.tolerance
                            )) continue;
                            supported = true;
                            break;
                        }
                    }
                    if (supported) {
                        pushCandidate({ z: topZ, surfaceKind: 'wall_walk', wall });
                    }
                    continue;
                }

                const [a, b] = wall._faceLine;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len2 = dx * dx + dy * dy;
                if (len2 <= 1e-6) continue;
                const t = Math.max(0, Math.min(1, ((pointX - a.x) * dx + (pointY - a.y) * dy) / len2));
                const px = a.x + dx * t;
                const py = a.y + dy * t;
                const halfWidth = (Number(wall._wallWalkWidth) || WALL_WALK_CONFIG.laneWidth) / 2;
                if (Math.hypot(pointX - px, pointY - py) <= halfWidth) {
                    pushCandidate({ z: topZ, surfaceKind: 'wall_walk', wall });
                }
            }
        }

        let best = candidates[0];
        let bestDistance = Math.abs(hitZ - best.z);
        for (let index = 1; index < candidates.length; index++) {
            const candidate = candidates[index];
            const distance = Math.abs(hitZ - candidate.z);
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
        return best;
    },

    /**
     * 把RTS/点击目标解析成带高度与表面路线的位置。
     * 墙顶目标自动附带：楼梯底段 → 各段中心 → 墙顶投影点。
     */
    resolveSurfaceTarget(x, y) {
        let stairTarget = null;
        for (const staircase of this.staircases || []) {
            if (!staircase?.active || typeof staircase.surfaceAt !== 'function') continue;
            for (const segment of staircase.segments || []) {
                const steps = staircase.stepCountPerSegment || WALL_STAIR_CONFIG.stepCountPerSegment;
                const rise = segment.topZ - segment.baseZ;
                // 鼠标给的是最终屏幕位置；逐级加回真实踏步Z，只有落进同一段、同一级
                // Blender通道四边形的候选才成立。
                for (let stepIndex = 1; stepIndex <= steps; stepIndex++) {
                    const stepZ = segment.baseZ + rise * stepIndex / steps;
                    const groundY = y + stepZ;
                    const surface = staircase.surfaceAt(x, groundY);
                    if (!surface || surface.segment !== segment || surface.stepIndex !== stepIndex) continue;
                    const wallGeometry = blockWallTopWalkGeometry(surface.wall);
                    if (wallGeometry && pointInIsoFootprint(
                        x,
                        groundY,
                        wallGeometry.footprint,
                        wallGeometry.edgeTolerance
                    )) {
                        // 最后一级踏步/连接面与墙顶重叠处，点击语义交给后面的墙顶解析。
                        continue;
                    }
                    const local = worldDeltaToIsoLocal(x, groundY);
                    // 与Blender 30°/45°正交相机同向的深度：同一屏幕像素存在多个合法
                    // 踏步候选时，取离相机最近者；不同段重叠时先服从Phaser实际段图层。
                    const cameraDepth = (local.u + local.v)
                        * Math.cos(Math.PI / 6) / Math.SQRT2
                        + stepZ * 0.5;
                    const renderDepth = staircase.renderDepthForSegment(segment.index);
                    const target = {
                        x,
                        y: groundY,
                        z: surface.z,
                        surfaceKind: 'stairs',
                        stairGroupId: wallStairGroupId(staircase),
                    };
                    const candidate = {
                        ...target,
                        staircaseId: staircase.id,
                        route: typeof staircase.routePoints === 'function'
                            ? staircase.routePoints(target, segment.index)
                            : [],
                        _renderDepth: renderDepth,
                        _cameraDepth: cameraDepth,
                    };
                    if (!stairTarget
                        || candidate._renderDepth > stairTarget._renderDepth
                        || (candidate._renderDepth === stairTarget._renderDepth
                            && candidate._cameraDepth > stairTarget._cameraDepth)) {
                        stairTarget = candidate;
                    }
                }
            }
        }
        if (stairTarget) {
            const { _renderDepth, _cameraDepth, ...target } = stairTarget;
            return { ...target, renderDepth: _renderDepth };
        }
        const Game = (typeof window !== 'undefined') ? window.Game : null;
        const blockIndex = Game?.entities ? _blockWallIndex(Game.entities) : null;
        let wallSurface = null;
        if (Game?.entities) {
            for (const wall of Game.entities.values()) {
                if (!wall?.active || !wall._isWalkableWall || !Array.isArray(wall._faceLine)) continue;
                const [a, b] = wall._faceLine;
                const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
                const groundY = y + topZ;
                const blockGeometry = blockWallTopWalkGeometry(wall);
                if (blockGeometry) {
                    // 指挥拾取区可以比真实可行走面稍宽，但最终目标仍会按完整单位 footprint
                    // 向墙顶安全区内收。这样低缩放下不必精确点中只有数像素宽的顶面边缘，
                    // 同时不会把墙立面扩成可通行区域。
                    const insideWall = pointInIsoFootprint(
                        x,
                        groundY,
                        blockGeometry.footprint,
                        blockGeometry.edgeTolerance + WALL_WALK_CONFIG.commandPickTolerance
                    );
                    if (insideWall) {
                        const distance = Math.hypot(
                            x - blockGeometry.center.x,
                            groundY - blockGeometry.center.y
                        );
                        const projection = pointInIsoFootprint(x, groundY, blockGeometry.footprint)
                            ? { x, y: groundY }
                            : (_closestPointOnPolygon(x, groundY, blockGeometry.vertices)
                                || { x, y: groundY });
                        if (!wallSurface || distance < wallSurface.distance) {
                            wallSurface = {
                                wall,
                                x: projection.x,
                                y: projection.y,
                                distance,
                            };
                        }
                        continue;
                    }
                    for (const neighbor of _blockWallNeighbors(wall, blockIndex)) {
                        const connector = blockWallTopConnectorGeometry(wall, neighbor);
                        if (!connector || !pointInIsoFootprint(
                            x,
                            groundY,
                            connector.footprint,
                            connector.tolerance
                        )) continue;
                        const distance = Math.hypot(
                            x - connector.center.x,
                            groundY - connector.center.y
                        );
                        if (!wallSurface || distance < wallSurface.distance) {
                            wallSurface = {
                                wall,
                                x,
                                y: groundY,
                                distance,
                                connector,
                            };
                        }
                    }
                    for (const junction of blockIndex?.nearbyJunctions?.(x, groundY) || []) {
                        if (!junction?.walls?.includes(wall) || !pointInIsoFootprint(
                            x,
                            groundY,
                            junction.footprint,
                            junction.tolerance
                        )) continue;
                        const distance = Math.hypot(
                            x - junction.center.x,
                            groundY - junction.center.y
                        );
                        if (!wallSurface || distance < wallSurface.distance) {
                            wallSurface = {
                                wall,
                                x,
                                y: groundY,
                                distance,
                                junction,
                            };
                        }
                    }
                    continue;
                }
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len2 = dx * dx + dy * dy;
                if (len2 <= 1e-6) continue;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (groundY - a.y) * dy) / len2));
                const px = a.x + dx * t;
                const py = a.y + dy * t;
                const distance = Math.hypot(x - px, groundY - py);
                if (distance > (Number(wall._wallWalkWidth) || WALL_WALK_CONFIG.laneWidth) / 2 + 18) continue;
                if (!wallSurface || distance < wallSurface.distance) {
                    wallSurface = { wall, x: px, y: py, distance };
                }
            }
        }
        if (wallSurface) {
            if (wallSurface.wall?._isBlockCover
                && Game?.entities) {
                const graph = wallTopGraphProjection(
                    wallSurface.x,
                    wallSurface.y,
                    wallSurface.wall,
                    Game.entities,
                    this.staircases
                );
                if (graph) {
                    wallSurface.x = graph.x;
                    wallSurface.y = graph.y;
                    wallSurface.wall = graph.wall || wallSurface.wall;
                }
            }
            const staircase = (this.staircases || []).find((candidate) =>
                staircaseServesWall(candidate, wallSurface.wall, Game?.entities));
            const topZ = Number(wallSurface.wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            const renderDepth = wallSurface.junction
                ? Math.max(...wallSurface.junction.walls.map((candidate) =>
                    Number(candidate?._faceDepth) || 0))
                : (wallSurface.connector
                    ? Math.max(
                        Number(wallSurface.connector.wallA?._faceDepth) || 0,
                        Number(wallSurface.connector.wallB?._faceDepth) || 0
                    )
                    : (Number(wallSurface.wall?._faceDepth)
                        || structureDepthAtY(wallSurface.wall?.y || wallSurface.y)));
            if (!staircase) {
                return {
                    x: wallSurface.x,
                    y: wallSurface.y,
                    z: topZ,
                    surfaceKind: 'wall_walk',
                    wallId: wallSurface.wall.id,
                    staircaseId: null,
                    renderDepth,
                    route: [],
                    unreachable: true,
                    reason: '需要城墙楼梯',
                };
            }
            const route = staircase && typeof staircase.routePoints === 'function'
                ? staircase.routePoints()
                : [];
            const wallPath = blockWallTopRoute(
                staircase.wall,
                wallSurface.wall,
                Game?.entities
            );
            appendWallTopRoutePoints(route, wallPath, topZ);
            appendUniqueRouteTarget(route, {
                x: wallSurface.x,
                y: wallSurface.y,
                z: topZ,
                surfaceKind: 'wall_walk',
                wallId: wallSurface.wall.id,
            });
            finalizeSurfaceRoute(route);
            return {
                x: wallSurface.x,
                y: wallSurface.y,
                z: topZ,
                surfaceKind: 'wall_walk',
                wallId: wallSurface.wall.id,
                staircaseId: staircase?.id || null,
                renderDepth,
                route,
            };
        }
        return { x, y, z: 0, surfaceKind: 'ground', route: [] };
    },

    /**
     * 按单位当前表面补全 RTS 移动路线。
     * resolveSurfaceTarget 负责目标侧；这里补“墙顶/楼梯 → 地面”的反向下楼路线。
     */
    routeSurfaceMoveForUnit(unit, target) {
        if (!unit || !target) return target;
        const Game = (typeof window !== 'undefined') ? window.Game : null;
        const fitGroundPortalsToUnit = (route) => (route || []).map((step) => {
            if (step?.surfaceKind !== 'ground' || !step.staircaseId) return { ...step };
            const staircase = (this.staircases || []).find((entry) => entry?.id === step.staircaseId);
            const portal = staircase?.groundPortal?.();
            if (!staircase || !portal?.entry) return { ...step };
            const unitRadius = Math.max(
                0,
                Number(unit.groundRadius) || Number(unit.collisionRadius) || 0
            );
            const safePoint = stairGroupGroundPoint(
                staircase,
                portal.entry,
                Math.max(8, Number(WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius) || 14)
                    + unitRadius + 4
            );
            return safePoint ? { ...step, x: safePoint.x, y: safePoint.y } : { ...step };
        });
        // 地面单位上墙时按“每个单位”选择最近的可用楼梯。resolveSurfaceTarget 只负责确定
        // 被点击的墙顶；若所有选中单位复用它碰到的第一座楼梯，远处单位很容易从错误一侧
        // 直冲墙体，多个楼梯并存时也无法利用更近入口。
        if (target.surfaceKind === 'wall_walk'
            && unit._surfaceKind !== 'wall_walk'
            && unit._surfaceKind !== 'stairs') {
            const targetWall = Game?.entities
                ? Array.from(Game.entities.values()).find((wall) =>
                    wall?.active && wall.id === target.wallId)
                : null;
            const candidates = targetWall
                ? (this.staircases || []).filter((staircase) =>
                    typeof staircase?.routePoints === 'function'
                    && staircaseServesWall(staircase, targetWall, Game?.entities))
                : [];
            let chosen = null;
            for (const staircase of candidates) {
                const stairRoute = staircase.routePoints();
                const entry = stairRoute[0];
                if (!entry) continue;
                const score = Math.hypot(entry.x - unit.x, entry.y - unit.y)
                    + ElevatedNavigationController.portalPenalty(staircase.id, 'up');
                if (!chosen || score < chosen.score) chosen = { staircase, stairRoute, score };
            }
            if (chosen) {
                const route = fitGroundPortalsToUnit(chosen.stairRoute);
                const wallPath = blockWallTopRoute(
                    chosen.staircase.wall,
                    targetWall,
                    Game?.entities
                );
                appendWallTopRoutePoints(route, wallPath, target.z);
                appendUniqueRouteTarget(route, {
                    x: target.x,
                    y: target.y,
                    z: target.z,
                    surfaceKind: 'wall_walk',
                    wallId: target.wallId,
                });
                finalizeSurfaceRoute(route);
                return {
                    ...target,
                    staircaseId: chosen.staircase.id,
                    route,
                    unreachable: false,
                    reason: null,
                    routeRevision: this.elevatedNavigationRevision(),
                };
            }
        }
        if (target.surfaceKind === 'wall_walk'
            && (unit._surfaceKind === 'wall_walk' || unit._surfaceKind === 'stairs')) {
            const targetWall = Game?.entities
                ? Array.from(Game.entities.values()).find((wall) =>
                    wall?.active && wall.id === target.wallId)
                : null;
            const currentStaircase = unit._surfaceKind === 'stairs'
                ? unit._surfaceStaircase
                : null;
            const startWall = unit._surfaceWall || currentStaircase?.wall || null;
            const wallPath = blockWallTopRoute(startWall, targetWall, Game?.entities);
            if (targetWall && startWall && wallPath.length) {
                const route = fitGroundPortalsToUnit(currentStaircase?.routePoints?.() || []);
                appendWallTopRoutePoints(route, wallPath, target.z);
                appendUniqueRouteTarget(route, {
                    x: target.x,
                    y: target.y,
                    z: target.z,
                    surfaceKind: 'wall_walk',
                    wallId: target.wallId,
                });
                finalizeSurfaceRoute(route);
                return {
                    ...target,
                    staircaseId: currentStaircase?.id || target.staircaseId || null,
                    route,
                    unreachable: false,
                    reason: null,
                    routeRevision: this.elevatedNavigationRevision(),
                };
            }
            const connectedStairs = (wall) => (this.staircases || []).filter((staircase) =>
                typeof staircase?.routePoints === 'function'
                && staircaseServesWall(staircase, wall, Game?.entities));
            const descentCandidates = startWall ? connectedStairs(startWall) : [];
            const ascentCandidates = targetWall ? connectedStairs(targetWall) : [];
            let descent = null;
            for (const staircase of descentCandidates) {
                const top = staircase.topCenter?.() || staircase;
                const score = Math.hypot(top.x - unit.x, top.y - unit.y)
                    + ElevatedNavigationController.portalPenalty(staircase.id, 'down');
                if (!descent || score < descent.score) descent = { staircase, score };
            }
            let ascent = null;
            const descentRoute = descent?.staircase.routePoints?.() || [];
            const descentEntry = descentRoute[0] || unit;
            for (const staircase of ascentCandidates) {
                const stairRoute = staircase.routePoints();
                const entry = stairRoute[0];
                if (!entry) continue;
                const score = Math.hypot(entry.x - descentEntry.x, entry.y - descentEntry.y)
                    + ElevatedNavigationController.portalPenalty(staircase.id, 'up');
                if (!ascent || score < ascent.score) ascent = { staircase, stairRoute, score };
            }
            if (descent && ascent) {
                const route = fitGroundPortalsToUnit(descentRoute).reverse();
                const ascentEntry = ascent.stairRoute[0];
                route.push({
                    x: ascentEntry.x,
                    y: ascentEntry.y,
                    z: 0,
                    surfaceKind: 'ground',
                    staircaseId: ascent.staircase.id,
                });
                for (const step of ascent.stairRoute.slice(1)) route.push({ ...step });
                const targetWallPath = blockWallTopRoute(
                    ascent.staircase.wall,
                    targetWall,
                    Game?.entities
                );
                appendWallTopRoutePoints(route, targetWallPath, target.z);
                appendUniqueRouteTarget(route, {
                    x: target.x,
                    y: target.y,
                    z: target.z,
                    surfaceKind: 'wall_walk',
                    wallId: target.wallId,
                });
                const fittedRoute = fitGroundPortalsToUnit(route);
                finalizeSurfaceRoute(fittedRoute);
                return {
                    ...target,
                    staircaseId: descent.staircase.id,
                    route: fittedRoute,
                    unreachable: false,
                    reason: null,
                    routeRevision: this.elevatedNavigationRevision(),
                };
            }
            return {
                ...target,
                route: [],
                unreachable: true,
                reason: '当前高架区域与目标墙不连通',
                routeRevision: this.elevatedNavigationRevision(),
            };
        }
        const route = Array.isArray(target.route) ? target.route : [];
        if (route.length || target.surfaceKind !== 'ground') {
            return {
                ...target,
                route: fitGroundPortalsToUnit(route),
                routeRevision: this.elevatedNavigationRevision(),
            };
        }
        if (unit._surfaceKind !== 'wall_walk' && unit._surfaceKind !== 'stairs') return target;

        const wall = unit._surfaceWall || unit._surfaceStaircase?.wall || null;
        const currentStaircase = unit._surfaceKind === 'stairs'
            && unit._surfaceStaircase?.active
            && typeof unit._surfaceStaircase.routePoints === 'function'
            ? unit._surfaceStaircase
            : null;
        const staircase = currentStaircase || (this.staircases || [])
            .filter((candidate) => typeof candidate?.routePoints === 'function'
                && (candidate === unit._surfaceStaircase
                    || staircaseServesWall(candidate, wall, Game?.entities)))
            .map((candidate) => {
                const top = candidate.topCenter?.() || candidate;
                return {
                    candidate,
                    score: Math.hypot(top.x - unit.x, top.y - unit.y)
                        + ElevatedNavigationController.portalPenalty(candidate.id, 'down'),
                };
            })
            .sort((left, right) => left.score - right.score)[0]?.candidate || null;
        if (!staircase || typeof staircase.routePoints !== 'function') {
            return {
                ...target,
                unreachable: true,
                reason: '当前高架区域没有可用楼梯',
            };
        }
        const downRoute = [];
        if (unit._surfaceKind === 'wall_walk') {
            const wallPath = blockWallTopRoute(wall, staircase.wall, Game?.entities);
            appendWallTopRoutePoints(
                downRoute,
                wallPath,
                Number(wall?._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ
            );
        }
        for (const step of staircase.routePoints().map((point) => ({ ...point })).reverse()) {
            appendUniqueRouteTarget(downRoute, step);
        }
        downRoute.push({ x: target.x, y: target.y, z: 0, surfaceKind: 'ground' });
        const fittedDownRoute = fitGroundPortalsToUnit(downRoute);
        finalizeSurfaceRoute(fittedDownRoute);
        return {
            ...target,
            staircaseId: staircase.id,
            route: fittedDownRoute,
            routeRevision: this.elevatedNavigationRevision(),
        };
    },

    /** 把现有 AI 已选定的语义目标翻译成跨表面路线，不接管索敌或战术目标所有权。 */
    planSurfaceRouteForUnit(unit, surfaceTarget) {
        if (!unit || !surfaceTarget) return null;
        const kind = surfaceTarget._surfaceKind || surfaceTarget.surfaceKind
            || ((Number(surfaceTarget.z) || 0) > 1 ? 'elevated' : 'ground');
        if (kind === 'wall_walk') {
            const wall = surfaceTarget._surfaceWall || surfaceTarget._surfaceStaircase?.wall || null;
            if (!wall?.active) return { unreachable: true, reason: '目标墙面已失效', route: [] };
            return this.routeSurfaceMoveForUnit(unit, {
                x: surfaceTarget.x,
                y: surfaceTarget.y,
                z: Number(surfaceTarget.z) || Number(wall._wallTopZ)
                    || WALL_WALK_CONFIG.defaultTopZ,
                surfaceKind: 'wall_walk',
                wallId: wall.id,
                route: [],
            });
        }
        if (kind === 'stairs') {
            const staircase = surfaceTarget._surfaceStaircase
                || (this.staircases || []).find((candidate) =>
                    candidate?.active && candidate.id === surfaceTarget.staircaseId);
            if (!staircase?.active || typeof staircase.routePoints !== 'function') {
                return { unreachable: true, reason: '目标楼梯已失效', route: [] };
            }
            const target = {
                x: surfaceTarget.x,
                y: surfaceTarget.y,
                z: Number(surfaceTarget.z) || 0,
                surfaceKind: 'stairs',
                staircaseId: staircase.id,
                stairGroupId: wallStairGroupId(staircase),
            };
            const surface = staircase.surfaceAt?.(
                surfaceTarget.x,
                surfaceTarget.y,
                surfaceTarget
            );
            const targetSegmentIndex = Math.max(0, staircase.segments.indexOf(surface?.segment));
            const allStairNodes = staircase.routePoints()
                .filter((node) => node.surfaceKind === 'stairs')
                .map((node) => ({ ...node }));
            const currentZ = Number(unit.z) || 0;
            const targetZ = Number(target.z) || 0;
            const route = [];

            if (unit._surfaceKind === 'wall_walk') {
                const Game = (typeof window !== 'undefined') ? window.Game : null;
                const startWall = unit._surfaceWall || null;
                const wallPath = blockWallTopRoute(startWall, staircase.wall, Game?.entities);
                appendWallTopRoutePoints(
                    route,
                    wallPath,
                    Number(startWall?._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ
                );
                for (const node of allStairNodes.slice().reverse()) {
                    if ((Number(node.z) || 0) > targetZ + 1) appendUniqueRouteTarget(route, node);
                }
                appendUniqueRouteTarget(route, target);
            } else if (unit._surfaceKind === 'stairs'
                && (unit._surfaceStaircase === staircase
                    || wallStairsShareGroup(unit._surfaceStaircase, staircase))) {
                const ordered = targetZ < currentZ
                    ? allStairNodes.slice().reverse()
                    : allStairNodes;
                for (const node of ordered) {
                    const nodeZ = Number(node.z) || 0;
                    if (targetZ < currentZ) {
                        if (nodeZ < currentZ - 1 && nodeZ > targetZ + 1) {
                            appendUniqueRouteTarget(route, node);
                        }
                    } else if (nodeZ > currentZ + 1 && nodeZ < targetZ - 1) {
                        appendUniqueRouteTarget(route, node);
                    }
                }
                appendUniqueRouteTarget(route, target);
            } else if (unit._surfaceKind === 'stairs' || unit._surfaceKind === 'wall_walk') {
                const groundPortal = staircase.groundPortal?.();
                const descent = groundPortal
                    ? this.routeSurfaceMoveForUnit(unit, {
                        x: groundPortal.groundPoint.x,
                        y: groundPortal.groundPoint.y,
                        z: 0,
                        surfaceKind: 'ground',
                        route: [],
                    })
                    : null;
                for (const node of descent?.route || []) appendUniqueRouteTarget(route, { ...node });
                for (const node of staircase.routePoints(target, targetSegmentIndex)) {
                    appendUniqueRouteTarget(route, { ...node });
                }
            } else {
                for (const node of staircase.routePoints(target, targetSegmentIndex)) {
                    appendUniqueRouteTarget(route, { ...node });
                }
            }
            return {
                ...target,
                route: finalizeSurfaceRoute(route),
                routeRevision: this.elevatedNavigationRevision(),
            };
        }
        if (kind !== 'ground') {
            return { unreachable: true, reason: '目标不在正式高架导航面', route: [] };
        }
        return this.routeSurfaceMoveForUnit(unit, {
            x: surfaceTarget.x,
            y: surfaceTarget.y,
            z: 0,
            surfaceKind: 'ground',
            route: [],
        });
    },

    replanSurfaceRouteForUnit(unit, point) {
        if (!point) return null;
        if (point.surfaceKind === 'stairs') {
            return this.planSurfaceRouteForUnit(unit, {
                ...point,
                route: undefined,
            });
        }
        return this.routeSurfaceMoveForUnit(unit, {
            ...point,
            route: [],
            routeRevision: undefined,
        });
    },

    trackElevatedNavigationUnit(unit) {
        if (unit?.active !== false) this._elevatedNavUnits.add(unit);
    },

    /**
     * 城墙楼梯/墙顶表面判定：玩家、侍从和世界-122友军共用同一个连续 z。
     * 楼梯优先于墙顶；离开墙顶且没有进入楼梯时把单位约束回原墙顶通道，防止侧向坠落。
     */
    _updateElevatedSurfaceStates(dt = 16, options = null) {
        const elevatedOnly = !!options?.elevatedOnly;
        const reconcileOnly = !!options?.reconcileOnly;
        const units = [];
        const Game = (typeof window !== 'undefined') ? window.Game : null;
        if (Game && Game.player) units.push(Game.player);
        if (Game && Game.PartySystem && Array.isArray(Game.PartySystem.members)) {
            for (const m of Game.PartySystem.members) if (m && m.active !== false) units.push(m);
        }
        if (Game && Array.isArray(Game.friendlyUnits)) {
            for (const u of Game.friendlyUnits) {
                if (u && u !== Game.player && u.active !== false && !units.includes(u)) units.push(u);
            }
        }
        for (const u of this._elevatedNavUnits || []) {
            if (!u || u.active === false) {
                this._elevatedNavUnits.delete(u);
                continue;
            }
            if (!units.includes(u)) units.push(u);
        }
        for (const u of units) {
            if (elevatedOnly
                && u._surfaceKind !== 'wall_walk'
                && u._surfaceKind !== 'stairs'
                && (Number(u.z) || 0) <= 1) continue;
            const lastValidated = u._elevatedState?.lastValidated || null;
            let previousSafeX = Number(lastValidated?.x);
            let previousSafeY = Number(lastValidated?.y);
            u._wallWalkSupportRadius = (u._surfaceKind === 'wall_walk' || u._surfaceKind === 'stairs')
                ? Math.min(
                    Number(u.groundRadius) || Number(u.collisionRadius) || WALL_WALK_CONFIG.maxUnitRadius,
                    WALL_WALK_CONFIG.surfaceUnitRadius
                )
                : null;
            const attemptedX = u.x;
            const attemptedY = u.y;
            const topology = _blockWallIndex(Game?.entities);
            u._surfaceQueryMotionIntent = Number.isFinite(previousSafeX)
                && Number.isFinite(previousSafeY)
                ? {
                    x: attemptedX - previousSafeX,
                    y: attemptedY - previousSafeY,
                }
                : null;
            const querySurfaceAt = (x, y) => {
                const selected = unifiedElevatedNavigation.query(
                    u,
                    x,
                    y,
                    topology.nearbyStaircases(x, y),
                    (px, py) => this._wallWalkSurfaceAt(u, px, py)
                );
                u._surfaceCandidateCount = selected.candidateCount;
                if (selected.surface) {
                    selected.surface.topologyRevision = topology.revision;
                    const supportWall = selected.surface.wall || selected.staircase?.wall;
                    selected.surface.topologyComponentId = supportWall?._isBlockCover
                        ? topology.componentId(supportWall)
                        : null;
                }
                return {
                    surface: selected.surface,
                    staircase: selected.staircase,
                };
            };
            let queried = querySurfaceAt(attemptedX, attemptedY);
            let surface = queried.surface;
            let staircase = queried.staircase;
            let surfaceTransition = null;
            let missedSurfaceAtAttempt = !surface;
            u._surfaceSweepClamped = false;
            u._surfaceBoundarySlid = false;
            u._surfaceBoundaryInset = 0;
            const previousZ = Math.max(0, Number(u.z) || 0);
            const wasElevated = u._surfaceKind === 'wall_walk' || u._surfaceKind === 'stairs';
            let anchorInvalidated = false;
            const anchorRevision = Number(lastValidated?.revision) || 0;
            if (wasElevated && anchorRevision && anchorRevision !== topology.revision
                && Number.isFinite(previousSafeX) && Number.isFinite(previousSafeY)) {
                const anchorQuery = querySurfaceAt(previousSafeX, previousSafeY);
                const anchorSurface = anchorQuery?.surface;
                const anchorMatches = lastValidated.kind === 'stairs'
                    ? anchorSurface?.kind === 'stairs'
                        && (anchorQuery.staircase === lastValidated.staircase
                            || wallStairsShareGroup(
                                anchorQuery.staircase,
                                lastValidated.staircase
                            )
                            || (lastValidated.stairGroupId
                                && anchorSurface.stairGroupId === lastValidated.stairGroupId))
                    : anchorSurface?.kind === 'wall_walk'
                        && (!lastValidated.wall
                            || anchorSurface.wall === lastValidated.wall
                            || anchorSurface.walls?.includes(lastValidated.wall));
                if (anchorMatches) {
                    lastValidated.revision = topology.revision;
                } else {
                    anchorInvalidated = true;
                    previousSafeX = Number.NaN;
                    previousSafeY = Number.NaN;
                    u._surfaceQueryMotionIntent = null;
                    if (u._elevatedState) u._elevatedState.lastValidated = null;
                    u._surfaceNavRetryAt = 0;
                }
            }
            if (!wasElevated && previousZ <= 1) {
                // ground只能从首段底部门户进入stairs，禁止侧向、投影重叠或墙面重叠吸附。
                // ground也绝不能直接取得wall_walk身份。
                if (Game?.showAttackRange) u._surfacePortalDebug = null;
                if (surface?.kind === 'stairs') {
                    const storedGround = u._elevatedState?.lastGround || null;
                    const hasUsableGround = Number.isFinite(storedGround?.x)
                        && Number.isFinite(storedGround?.y)
                        && Math.hypot(
                            attemptedX - storedGround.x,
                            attemptedY - storedGround.y
                        ) <= 192;
                    const fallbackGround = staircase
                        ? stairGroupGroundPoint(
                            staircase,
                            { x: attemptedX, y: attemptedY },
                            WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius
                        )
                        : null;
                    const entryGround = hasUsableGround ? storedGround : fallbackGround;
                    const fallbackMayEnter = hasUsableGround
                        || (surface.segment === staircase?.segments?.[0]
                            && Number(surface.progress) <= 0.35);
                    const entryTransition = fallbackMayEnter && entryGround && staircase
                        ? resolveStairGroundPortalTransition(
                            staircase,
                            entryGround,
                            { x: attemptedX, y: attemptedY },
                            'enter',
                            {
                                outsideDistance: WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius,
                                captureMargin: WALL_WALK_CONFIG.surfaceNavigation.portalCaptureMargin,
                            }
                        )
                        : null;
                    const portalGranted = entryTransition
                        && ElevatedNavigationController.canCrossPortal(u, staircase.id, 'up');
                    if (Game?.showAttackRange) {
                        u._surfacePortalDebug = {
                            status: portalGranted ? 'accepted' : 'rejected',
                            reason: !entryTransition ? 'portal_geometry' : 'traffic_permission',
                            x: attemptedX,
                            y: attemptedY,
                            at: Date.now(),
                            staircase,
                            portal: entryTransition?.portal || null,
                        };
                    }
                    if (portalGranted) {
                        const laneInset = Math.max(
                            2,
                            Number(u.groundRadius)
                                || Number(u.collisionRadius)
                                || WALL_WALK_CONFIG.surfaceUnitRadius
                        ) + WALL_STAIR_CONFIG.edgeHalfThick + 2;
                        const lanePoint = clampStairGroupPortalLane(
                            entryTransition.portal,
                            { x: attemptedX, y: attemptedY },
                            laneInset
                        );
                        if (Number.isFinite(lanePoint?.x) && Number.isFinite(lanePoint?.y)) {
                            u.x = lanePoint.x;
                            u.y = lanePoint.y;
                            const laneQuery = querySurfaceAt(u.x, u.y);
                            if (laneQuery.surface?.kind === 'stairs') {
                                surface = laneQuery.surface;
                                staircase = laneQuery.staircase;
                            } else {
                                u.x = attemptedX;
                                u.y = attemptedY;
                            }
                        }
                        surfaceTransition = { ...entryTransition, staircase };
                    } else {
                        // 首次追踪/读档/传送后可能还没有上一帧地面锚点。此时必须退到
                        // 当前楼梯入口外侧播种锚点，不能把ground身份留在踏步内部，
                        // 否则下一帧from/to都在入口内侧，会永久失去合法穿越机会。
                        if (Number.isFinite(entryGround?.x) && Number.isFinite(entryGround?.y)) {
                            u.x = entryGround.x;
                            u.y = entryGround.y;
                        }
                        surface = null;
                        staircase = null;
                    }
                } else if (surface?.kind === 'wall_walk') {
                    surface = null;
                    staircase = null;
                }
                missedSurfaceAtAttempt = !surface;
            }
            if (wasElevated && Number.isFinite(previousSafeX) && Number.isFinite(previousSafeY)) {
                const swept = unifiedElevatedNavigation.sweep(
                    { x: previousSafeX, y: previousSafeY },
                    { x: attemptedX, y: attemptedY },
                    querySurfaceAt,
                    3,
                    (sample) => {
                        const sampleSurface = sample.previous?.surface;
                        const sampleStaircase = sample.previous?.staircase
                            || u._surfaceStaircase
                            || null;
                        const firstSegment = sampleStaircase?.segments?.[0] || null;
                        if (sampleSurface?.kind !== 'stairs'
                            || !sampleStaircase
                            || sampleSurface.segment !== firstSegment
                            || Number(sampleSurface.progress) > 0.35) return null;
                        const transition = resolveStairGroundPortalTransition(
                            sampleStaircase,
                            sample.from,
                            sample.to,
                            'exit',
                            {
                                outsideDistance: WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius,
                                captureMargin: WALL_WALK_CONFIG.surfaceNavigation.portalCaptureMargin,
                            }
                        );
                        if (!transition || !ElevatedNavigationController.canCrossPortal(
                            u,
                            sampleStaircase.id,
                            'down'
                        )) return null;
                        return { ...transition, staircase: sampleStaircase };
                    }
                );
                if (swept.transition) {
                    u.x = swept.x;
                    u.y = swept.y;
                    surface = null;
                    staircase = null;
                    surfaceTransition = swept.transition;
                    missedSurfaceAtAttempt = false;
                } else if (swept.surface) {
                    u.x = swept.x;
                    u.y = swept.y;
                    surface = swept.surface;
                    staircase = swept.staircase;
                    if (!swept.completed) {
                        missedSurfaceAtAttempt = true;
                        u._surfaceSweepClamped = true;
                    }
                }
            }
            if (surface?.kind === 'stairs' && staircase) {
                const recovered = this._recoverStairEdgeOverlap(
                    u,
                    surface,
                    staircase,
                    querySurfaceAt
                );
                if (recovered) {
                    u.x = recovered.x;
                    u.y = recovered.y;
                    surface = recovered.surface;
                    staircase = recovered.staircase;
                    missedSurfaceAtAttempt = false;
                    u._surfaceSweepClamped = false;
                    u._surfaceBoundarySlid = true;
                    u._surfaceBoundaryInset = recovered.distance;
                    u._surfaceEdgeRecovered = true;
                } else {
                    u._surfaceEdgeRecovered = false;
                }
            } else {
                u._surfaceEdgeRecovered = false;
            }
            if (!surface && u._surfaceKind === 'wall_walk' && u._surfaceWall?.active) {
                // 最后有效点因拓扑变化失效时，只允许回夹到仍有真实footprint承托的位置。
                const wall = u._surfaceWall;
                const blockGeometry = blockWallTopWalkGeometry(wall);
                if (blockGeometry) {
                    const blockIndex = _blockWallIndex(Game.entities);
                    const clamped = _clampBlockWallFootprintToSupport(
                        u,
                        attemptedX,
                        attemptedY,
                        wall,
                        blockIndex
                    ) || _nearestBlockWallFootprintSupport(
                        u,
                        attemptedX,
                        attemptedY,
                        blockIndex,
                        wall
                    );
                    if (clamped?.support) {
                        u.x = clamped.x;
                        u.y = clamped.y;
                        queried = querySurfaceAt(u.x, u.y);
                        surface = queried.surface;
                        staircase = queried.staircase;
                        u._surfaceSweepClamped = !!surface;
                    }
                }
            }
            if (missedSurfaceAtAttempt && surface?.kind === 'wall_walk') {
                const baseX = u.x;
                const baseY = u.y;
                const remainingX = attemptedX - baseX;
                const remainingY = attemptedY - baseY;
                const remainingDistance = Math.hypot(remainingX, remainingY);
                const axes = this._wallWalkMoveAxes(surface.wall);
                const intent = u._surfaceInputIntent;
                const intentX = intent && Math.hypot(intent.x, intent.y) > 1e-6
                    ? intent.x
                    : remainingX;
                const intentY = intent && Math.hypot(intent.x, intent.y) > 1e-6
                    ? intent.y
                    : remainingY;
                const intentDistance = Math.hypot(intentX, intentY);
                const candidates = [];
                if (remainingDistance > 1e-6 && intentDistance > 1e-6) {
                    for (const axis of axes) {
                        const dot = intentX * axis.x + intentY * axis.y;
                        if (dot <= 0.01) continue;
                        candidates.push({
                            axis,
                            dot,
                            alignment: dot / intentDistance,
                        });
                    }
                    candidates.sort((left, right) => right.dot - left.dot);
                    const bestWall = candidates.find((candidate) =>
                        candidate.axis.kind !== 'stair_portal');
                    const bestPortal = candidates.find((candidate) =>
                        candidate.axis.kind === 'stair_portal');
                    if (bestWall && bestPortal
                        && bestPortal.alignment > bestWall.alignment
                        && bestPortal.alignment - bestWall.alignment
                            < WALL_WALK_CONFIG.portalPreferenceMargin) {
                        const wallIndex = candidates.indexOf(bestWall);
                        if (wallIndex > 0) {
                            candidates.splice(wallIndex, 1);
                            candidates.unshift(bestWall);
                        }
                    }
                }
                let slid = false;
                const launchPoints = [{ x: baseX, y: baseY, inset: 0 }];
                const wallGeometry = blockWallTopWalkGeometry(surface.wall);
                if (wallGeometry) {
                    const centerDx = wallGeometry.center.x - baseX;
                    const centerDy = wallGeometry.center.y - baseY;
                    const centerDistance = Math.hypot(centerDx, centerDy);
                    if (centerDistance > 1e-6) {
                        for (const inset of [1.5, 3, 5]) {
                            launchPoints.push({
                                x: baseX + centerDx / centerDistance * Math.min(inset, centerDistance),
                                y: baseY + centerDy / centerDistance * Math.min(inset, centerDistance),
                                inset,
                            });
                        }
                    }
                }
                for (const launch of launchPoints) {
                    if (launch.inset > 0 && !querySurfaceAt(launch.x, launch.y).surface) continue;
                    for (const candidate of candidates) {
                        const directions = [];
                        if (Number.isFinite(candidate.axis.targetX)
                            && Number.isFinite(candidate.axis.targetY)) {
                            const targetDx = candidate.axis.targetX - launch.x;
                            const targetDy = candidate.axis.targetY - launch.y;
                            const targetDistance = Math.hypot(targetDx, targetDy);
                            if (targetDistance > 1e-6) {
                                directions.push({
                                    x: targetDx / targetDistance,
                                    y: targetDy / targetDistance,
                                });
                            }
                        }
                        if (!directions.some((direction) =>
                            Math.abs(direction.x - candidate.axis.x) < 1e-4
                            && Math.abs(direction.y - candidate.axis.y) < 1e-4)) {
                            directions.push({ x: candidate.axis.x, y: candidate.axis.y });
                        }
                        for (const direction of directions) {
                            const samples = Math.max(2, Math.ceil(remainingDistance / 2));
                            for (let index = samples; index >= 1; index--) {
                                const t = index / samples;
                                const px = launch.x + direction.x * remainingDistance * t;
                                const py = launch.y + direction.y * remainingDistance * t;
                                if (Math.hypot(px - baseX, py - baseY) < 0.05) continue;
                                const slideQuery = querySurfaceAt(px, py);
                                if (!slideQuery.surface) continue;
                                u.x = px;
                                u.y = py;
                                surface = slideQuery.surface;
                                staircase = slideQuery.staircase;
                                u._surfaceBoundarySlid = true;
                                u._surfaceBoundaryInset = launch.inset;
                                slid = true;
                                break;
                            }
                            if (slid) break;
                        }
                        if (slid) break;
                    }
                    if (slid) break;
                }
            }
            if (!reconcileOnly) {
                const navDestination = u._surfaceNavDestination;
                const recoveryIntent = u._surfaceInputIntent
                    || (Number.isFinite(navDestination?.x) && Number.isFinite(navDestination?.y)
                        ? {
                            x: navDestination.x - u.x,
                            y: navDestination.y - u.y,
                        }
                        : null);
                const recoveryIntentLength = Math.hypot(
                    Number(recoveryIntent?.x) || 0,
                    Number(recoveryIntent?.y) || 0
                );
                const movedFromSafe = Number.isFinite(previousSafeX) && Number.isFinite(previousSafeY)
                    ? Math.hypot(u.x - previousSafeX, u.y - previousSafeY)
                    : Infinity;
                u._surfaceHandoffRecovered = false;
                const connector = staircase?.wallConnectorSurface?.() || null;
                const topSegment = staircase?.segments?.length
                    ? staircase.segments[staircase.segments.length - 1]
                    : null;
                const onTopHandoff = surface?.kind === 'stairs'
                    && connector
                    && Number(surface?.z) >= (Number(staircase?.targetTopZ) || 0) - 2
                    && (surface?.connector
                        || surface?.handoffDown
                        || surface?.segment === topSegment
                        || u._elevatedNavigationBridge);
                let handoffTarget = null;
                let handoffStage = null;
                const handoffDirectionAlignment = Math.max(
                    0.05,
                    Number(WALL_WALK_CONFIG.surfaceNavigation.portalDirectionMinAlignment)
                        || 0.15
                );
                if (onTopHandoff && recoveryIntentLength > 1e-6) {
                    const routeStage = u._surfaceRouteStage;
                    if (routeStage === 'handoff_to_wall') {
                        handoffTarget = connector.exit;
                        handoffStage = routeStage;
                    } else if (routeStage === 'handoff_to_stairs') {
                        handoffTarget = connector.entry;
                        handoffStage = routeStage;
                    } else {
                        const runX = connector.exit.x - connector.entry.x;
                        const runY = connector.exit.y - connector.entry.y;
                        const runLength = Math.hypot(runX, runY);
                        const alignment = runLength > 1e-6
                            ? (recoveryIntent.x * runX + recoveryIntent.y * runY)
                                / (recoveryIntentLength * runLength)
                            : 0;
                        if (alignment >= handoffDirectionAlignment) {
                            handoffTarget = connector.exit;
                            handoffStage = 'handoff_to_wall';
                        } else if (alignment <= -handoffDirectionAlignment) {
                            handoffTarget = connector.entry;
                            handoffStage = 'handoff_to_stairs';
                        }
                    }
                }
                if (handoffTarget
                    && Number.isFinite(movedFromSafe)
                    && movedFromSafe < 0.05) {
                    u._surfaceHandoffStuckFrames =
                        (Number(u._surfaceHandoffStuckFrames) || 0) + 1;
                } else {
                    u._surfaceHandoffStuckFrames = 0;
                }
                if (handoffTarget
                    && u._surfaceHandoffStuckFrames
                        >= WALL_WALK_CONFIG.surfaceNavigation.handoffStuckFrameThreshold) {
                    const targetDx = handoffTarget.x - u.x;
                    const targetDy = handoffTarget.y - u.y;
                    const targetDistance = Math.hypot(targetDx, targetDy);
                    if (targetDistance > 0.05) {
                        const recoveryStep = Math.min(
                            targetDistance,
                            WALL_WALK_CONFIG.surfaceNavigation.handoffRecoveryStep
                        );
                        for (const step of [recoveryStep, recoveryStep * 0.5]) {
                            if (step < 0.05) continue;
                            const px = u.x + targetDx / targetDistance * step;
                            const py = u.y + targetDy / targetDistance * step;
                            const recoveryQuery = querySurfaceAt(px, py);
                            if (!recoveryQuery.surface) continue;
                            const remainingDistance = Math.hypot(
                                handoffTarget.x - px,
                                handoffTarget.y - py
                            );
                            if (remainingDistance >= targetDistance - 0.05) continue;
                            u.x = px;
                            u.y = py;
                            surface = recoveryQuery.surface;
                            staircase = recoveryQuery.staircase;
                            u._surfaceHandoffRecovered = true;
                            u._surfaceHandoffRecoveryStage = handoffStage;
                            u._surfaceHandoffRecoveryDistance = step;
                            u._surfaceHandoffStuckFrames = 0;
                            break;
                        }
                    }
                }
            }
            const previousStaircase = u._surfaceStaircase || null;
            const atStairTop = u._surfaceKind === 'stairs' && previousStaircase
                && previousZ >= (Number(previousStaircase.targetTopZ) || 0) - 2;
            const carrierRemoved = (u._surfaceKind === 'wall_walk'
                && (!u._surfaceWall?.active || u._surfaceWall?._sinking))
                || (u._surfaceKind === 'stairs' && (!previousStaircase?.active
                    || (atStairTop && (!previousStaircase.wall?.active
                        || previousStaircase.wall?._sinking))));
            if (carrierRemoved) {
                surface = null;
                staircase = null;
                surfaceTransition = {
                    kind: 'carrier_removed',
                    fromKind: u._surfaceKind,
                    toKind: 'ground',
                    staircase: previousStaircase,
                };
                const portal = previousStaircase?.groundPortal?.();
                if (portal?.groundPoint) {
                    u.x = portal.groundPoint.x;
                    u.y = portal.groundPoint.y;
                }
            }
            let transitioningToGround = surfaceTransition?.toKind === 'ground';
            if (!surface && wasElevated && !transitioningToGround) {
                if (Number.isFinite(previousSafeX) && Number.isFinite(previousSafeY)) {
                    u.x = previousSafeX;
                    u.y = previousSafeY;
                    queried = querySurfaceAt(u.x, u.y);
                    surface = queried.surface;
                    staircase = queried.staircase;
                }
                if (!surface) {
                    u._surfaceUnsupportedFrames = (Number(u._surfaceUnsupportedFrames) || 0) + 1;
                    if (anchorInvalidated || u._surfaceUnsupportedFrames >= 2) {
                        // 真实拓扑已变化且局部载体/直接邻居均无法恢复：确定性受控落地，
                        // 禁止永久保留悬空Z和陈旧surface身份。
                        surfaceTransition = {
                            kind: 'support_invalidated',
                            fromKind: u._surfaceKind,
                            toKind: 'ground',
                            staircase: previousStaircase,
                        };
                        surface = null;
                        staircase = null;
                        transitioningToGround = true;
                        const portal = previousStaircase?.groundPortal?.();
                        const lastGround = u._elevatedState?.lastGround;
                        if (portal?.groundPoint) {
                            u.x = portal.groundPoint.x;
                            u.y = portal.groundPoint.y;
                        } else if (Number.isFinite(lastGround?.x)
                            && Number.isFinite(lastGround?.y)
                            && Math.hypot(lastGround.x - u.x, lastGround.y - u.y) <= 192
                            && WallSystem.canMoveTo(lastGround.x, lastGround.y, u.groundRadius || 20)) {
                            u.x = lastGround.x;
                            u.y = lastGround.y;
                        }
                    } else {
                        u.z = previousZ;
                        u._surfaceNavRetryAt = 0;
                        u._surfaceRouteActive = false;
                        if (u.collider && typeof u.collider.syncPosition === 'function') {
                            u.collider.syncPosition();
                        }
                        continue;
                    }
                }
            } else {
                u._surfaceUnsupportedFrames = 0;
            }
            let targetZ = surface ? surface.z : 0;
            const currentZ = Math.max(0, Number(u.z) || 0);
            const wasOnStairs = u._surfaceKind === 'stairs';
            const enteringWallFromStairs = wasOnStairs && surface?.kind === 'wall_walk';
            let enteringStairsFromWall = u._surfaceKind === 'wall_walk'
                && surface?.kind === 'stairs';
            if (enteringStairsFromWall && !ElevatedNavigationController.canCrossPortal(
                u,
                staircase?.id,
                'down'
            )) {
                // 无路线单位也必须在切面前排队；保持在最后确认的墙顶点，不能先进入楼梯。
                if (Number.isFinite(previousSafeX) && Number.isFinite(previousSafeY)) {
                    u.x = previousSafeX;
                    u.y = previousSafeY;
                    queried = querySurfaceAt(u.x, u.y);
                    surface = queried.surface;
                    staircase = queried.staircase;
                } else {
                    surface = null;
                    staircase = null;
                }
                enteringStairsFromWall = false;
                targetZ = surface ? surface.z : 0;
            }
            if (!surfaceTransition && enteringWallFromStairs) {
                surfaceTransition = {
                    kind: 'stairs_to_wall',
                    fromKind: 'stairs',
                    toKind: 'wall_walk',
                    staircase: previousStaircase,
                };
            } else if (!surfaceTransition && enteringStairsFromWall) {
                surfaceTransition = {
                    kind: 'wall_to_stairs',
                    fromKind: 'wall_walk',
                    toKind: 'stairs',
                    staircase,
                };
            }
            let z;
            if (surface?.kind === 'stairs' || enteringWallFromStairs || transitioningToGround) {
                // 踏步直接贴当前一级顶面；正常情况下只有楼梯下入口允许切回地面。
                // 承托结构已被拆除/沉陷时允许受控落地，避免保留失效高架身份永久卡死。
                z = targetZ;
            } else {
                const seconds = Math.min(0.05, Math.max(0, Number(dt) || 0) / 1000);
                const speed = targetZ > currentZ ? 245 : 330;
                z = currentZ + Math.sign(targetZ - currentZ)
                    * Math.min(Math.abs(targetZ - currentZ), speed * seconds);
            }
            u.z = z;
            u._surfaceTargetZ = targetZ;
            if (u.collider && typeof u.collider.syncPosition === 'function') u.collider.syncPosition();
            commitElevatedSurfaceIdentity(u, surface, staircase, z, surfaceTransition);
            unifiedElevatedNavigation.commitFlags(u, surface);
            if (surfaceTransition) {
                ElevatedNavigationController.onSurfaceTransition(u, surfaceTransition);
            }
            ElevatedNavigationController.syncSurfaceOccupancy(u);
            u._surfaceWasSharedSeam = !!surface?.sharedSeam;
            u._surfaceRenderDepth = Number.isFinite(surface?.renderDepth)
                ? surface.renderDepth
                : (Number.isFinite(surface?.segment?.y) ? surface.segment.y + 12 : null);
            u._surfaceMoveAxes = surface?.kind === 'stairs'
                ? this._stairMoveAxes(staircase, surface)
                : null;
            u._surfaceMoveMinAlignment = surface?.kind === 'stairs'
                ? Math.max(
                    0.05,
                    Number(WALL_WALK_CONFIG.surfaceNavigation.stairMoveMinAlignment) || 0.2
                )
                : null;
            u._surfacePortalOverrideMargin = null;
            u._surfaceMoveChosenAxis = null;
        }
    },

    /**
     * 开一波（2026-08-15 预算制重构）：
     * 有 wavePlan 配置 → _composeWave 按威胁预算+角色配比+硬约束配怪，精英/领主脚本化生成；
     * 无配置 → 旧逻辑回退（一次性刷 batch = baseCount + wave×countPerWave，封顶 countCap，受 maxAlive 约束）
     */
    _startWave() {
        this._phase = 'wave';
        this._phaseTimer = 0;
        if (this._managedExternally && this._managedConfig) {
            let alive = this._aliveCount();
            const types = this._managedConfig.waves?.[this._wave - 1] || [];
            for (const type of types) {
                if (alive >= (this._managedConfig.maxAlive || DEFENSE_CONFIG.spawn.maxAlive)) break;
                if (this._spawnMonster(this._wave, null, 1, type)) alive++;
            }
            this._announce(`第 ${this._wave}/${this._managedConfig.waveCount} 波入侵！`, '#ff7755');
            return;
        }
        const cfg = DEFENSE_CONFIG.spawn;
        const plan = cfg.wavePlan ? cfg.wavePlan[this._wave] : null;
        let alive = this._aliveCount();
        const composed = plan ? this._composeWave(this._wave, plan) : null;
        if (composed) {
            for (const type of composed) {
                if (alive >= cfg.maxAlive) break;
                if (this._spawnMonster(this._wave, null, 1, type)) alive++;
            }
            // 脚本化精英/领主（eliteMul/lordMul 可覆盖默认血量倍率，如 W5 迷你领主）
            for (let i = 0; i < (plan.elites || 0); i++) {
                if (alive >= cfg.maxAlive) break;
                if (this._spawnElite(plan.eliteMul)) alive++;
            }
            for (let i = 0; i < (plan.lords || 0); i++) {
                if (alive >= cfg.maxAlive) break;
                if (this._spawnLord(plan.lordMul)) alive++;
            }
            this._announce(`第 ${this._wave} 波 · ${plan.theme || '来袭'}！`, '#ffd700');
            return;
        }
        const count = Math.min(
            cfg.countCap,
            Math.floor(cfg.baseCount + this._wave * cfg.countPerWave)
        );
        for (let i = 0; i < count; i++) {
            if (alive >= cfg.maxAlive) break;
            if (this._spawnMonster(this._wave, NORMAL_POOL)) alive++;
        }
        this._announce(`第 ${this._wave} 波来袭！`, '#ffd700');
    },

    /**
     * 预算制配波（2026-08-15）：返回本波怪物类型数组
     * 1) 预算 = waveBudgetBase × waveBudgetGrowth^(wave-1)；各角色目标 = 预算 × 配比
     * 2) 硬约束钳制：远程+空中合计 ≤ 预算 30%；快速 ≤ 预算 35%
     * 3) 角色内按权重随机抽怪填满目标预算；单一类型 ≤ 单波只数 40%
     * 4) 多样性兜底：类型数 ≥ min(3, 本波解锁类型数)
     */
    _composeWave(wave, plan) {
        const cfg = DEFENSE_CONFIG.spawn;
        const budget = Math.max(1, Math.round((cfg.waveBudgetBase || 26) * Math.pow(cfg.waveBudgetGrowth || 1.15, wave - 1)));
        const ratios = plan.ratios || { fodder: 1 };
        const target = {};
        for (const r in ratios) target[r] = budget * ratios[r];
        // 硬约束钳制：远程+空中合计、快速
        const raCap = budget * (cfg.waveMaxRangedAirBudgetRatio ?? 0.3);
        const raSum = (target.ranged || 0) + (target.air || 0);
        if (raSum > raCap && raSum > 0) {
            const k = raCap / raSum;
            if (target.ranged) target.ranged *= k;
            if (target.air) target.air *= k;
        }
        const fastCap = budget * (cfg.waveMaxFastBudgetRatio ?? 0.35);
        if ((target.fast || 0) > fastCap) target.fast = fastCap;
        // 逐角色按预算抽样（角色内权重随机；只选 TP 不超剩余预算且不违反单一类型上限的类型）
        const list = [];
        const typeCount = {};
        // 本波解锁类型表（扁平化，含 TP，供上限计算与兜底填充共用）
        const unlockedTypes = [];
        for (const role in target) {
            for (const m of (ROLE_POOLS[role] || [])) {
                if (!unlockedTypes.some(u => u.type === m.type)) unlockedTypes.push(m);
            }
        }
        // 单一类型上限：解锁类型 ≥3 时按配置 40%；类型不足时放宽到 1/类型数（否则约束数学上不可满足）
        const sameRatio = Math.max(cfg.waveMaxSameTypeRatio ?? 0.4, 1 / Math.max(1, unlockedTypes.length));
        for (const role in target) {
            let remaining = target[role];
            let guard = 200;
            while (guard-- > 0 && remaining > 0) {
                const capNow = Math.max(2, Math.ceil((list.length + 1) * sameRatio));
                const cand = (ROLE_POOLS[role] || []).filter(
                    m => m.tp <= remaining + 0.001 && (typeCount[m.type] || 0) < capNow
                );
                if (!cand.length) break;
                const total = cand.reduce((s, m) => s + (m.weight || 1), 0);
                let roll = Math.random() * total, pick = cand[0];
                for (const m of cand) { roll -= (m.weight || 1); if (roll <= 0) { pick = m; break; } }
                remaining -= pick.tp;
                list.push(pick.type);
                typeCount[pick.type] = (typeCount[pick.type] || 0) + 1;
            }
        }
        // 剩余预算兜底填充：各角色取整浪费的 TP 汇总后按低 TP 优先填缝，保证只数贴齐预算曲线
        {
            let remaining = Math.max(0, budget - list.reduce((s, t) => {
                const m = unlockedTypes.find(u => u.type === t);
                return s + (m ? m.tp : 0);
            }, 0));
            let guard = 200;
            while (guard-- > 0 && remaining > 0) {
                const capNow = Math.max(2, Math.ceil((list.length + 1) * sameRatio));
                // 兜底只从炮灰角色取（避免低TP的空中/快速类型被填充放大、冲垮角色占比）；
                // 本波无炮灰时退化为全解锁类型（不会发生：当前 wavePlan 每波均含 fodder）
                const fillPool = (ROLE_POOLS.fodder && target.fodder) ? ROLE_POOLS.fodder : unlockedTypes;
                const cand = fillPool.filter(m => m.tp <= remaining + 0.001 && (typeCount[m.type] || 0) < capNow);
                if (!cand.length) break;
                cand.sort((a, b) => a.tp - b.tp);
                const pick = cand[Math.floor(Math.random() * Math.min(2, cand.length))];
                remaining -= pick.tp;
                list.push(pick.type);
                typeCount[pick.type] = (typeCount[pick.type] || 0) + 1;
            }
        }
        if (!list.length) return null;
        // 多样性兜底：不足 min(3, 解锁类型数) 时，把数量最多的类型替换一只为未出场类型
        const unlocked = unlockedTypes.map(m => m.type);
        const wantDistinct = Math.min(3, unlocked.length, list.length);
        let guard2 = 50;
        while (new Set(list).size < wantDistinct && guard2-- > 0) {
            const counts = {};
            for (const t of list) counts[t] = (counts[t] || 0) + 1;
            const most = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            const missing = unlocked.filter(t => !counts[t]);
            if (!missing.length || !most) break;
            list[list.indexOf(most)] = missing[Math.floor(Math.random() * missing.length)];
        }
        return list;
    },

    // ==================== 顶部 HUD（波次 + 货币实时）====================

    _createHud() {
        if (typeof document === 'undefined') return;
        this._destroyHud();
        const el = document.createElement('div');
        el.className = 'defense-hud';
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:14px;width:100%;">
                <span id="dhPhase">准备中…</span>
                <span id="dhMoney">💰 0&nbsp;&nbsp;⚡ 0</span>
            </div>
            <div id="dhWaveRow" style="display:none;align-items:center;gap:8px;">
                <div style="position:relative;flex:1;height:10px;background:rgba(255,255,255,0.10);border-radius:5px;overflow:hidden;">
                    <div id="dhWaveBar" style="position:absolute;left:0;top:0;bottom:0;width:0%;background:linear-gradient(90deg,#ffd700,#7fe0c8);border-radius:5px;transition:width 0.2s linear;"></div>
                </div>
                <span id="dhWavePct" style="font-size:11px;color:#9a9a9a;font-weight:700;min-width:34px;text-align:right;">0%</span>
            </div>`;
        document.body.appendChild(el);
        this._hudEl = el;
        this._hudTimer = 0;
    },

    _destroyHud() {
        if (this._hudEl) {
            this._hudEl.remove();
            this._hudEl = null;
        }
    },

    /** 每 100ms 刷新一次 HUD：波次阶段/倒计时/剩余数 + 金币能源 + 来袭进度条（同仓鼠兵营节奏） */
    _updateHud(dt) {
        if (!this._hudEl) return;
        this._hudTimer -= dt;
        if (this._hudTimer > 0) return;
        this._hudTimer = 100;
        const spawn = DEFENSE_CONFIG.spawn;
        let phaseText;
        if (this.victory) {
            phaseText = `防守胜利！撑过 ${spawn.victoryWave || 10} 波`;
        } else if (this._phase === 'prep') {
            phaseText = `准备中 · ${Math.ceil(Math.max(0, this._phaseTimer) / 1000)} 秒后怪物进攻`;
        } else if (this._phase === 'wave') {
            phaseText = `第 ${this._wave}/${spawn.victoryWave || 10} 波 · 剩余 ${this._aliveCount()} 只`;
        } else {
            phaseText = `第 ${this._wave} 波已清除 · ${Math.ceil(Math.max(0, this._phaseTimer) / 1000)} 秒后下一波`;
        }
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const ph = this._hudEl.querySelector('#dhPhase');
        const mo = this._hudEl.querySelector('#dhMoney');
        if (ph) ph.textContent = phaseText;
        if (mo) mo.innerHTML = `💰 ${gold}&nbsp;&nbsp;⚡ ${energy}`;
        // 怪物来袭倒计时进度条（2026-08-16，与仓鼠兵营同款：0.2s transition + 颜色渐变）
        const waveRow = this._hudEl.querySelector('#dhWaveRow');
        const bar = this._hudEl.querySelector('#dhWaveBar');
        const pct = this._hudEl.querySelector('#dhWavePct');
        if (waveRow && bar && pct) {
            let total = 0;
            if (this._phase === 'prep') total = spawn.prepMs || 30000;
            else if (this._phase === 'break') total = spawn.waveBreakMs || 10000;
            if (total > 0) {
                const progress = Math.max(0, Math.min(1, 1 - Math.max(0, this._phaseTimer) / total));
                const p = Math.round(progress * 100);
                // 颜色反向（2026-08-16 用户口径）：<50% 青绿（安全准备）、<80% 橙、≥80% 红（即将来袭）
                const color = progress < 0.5 ? '#7fe0c8' : (progress < 0.8 ? '#ff9d45' : '#ff5555');
                bar.style.width = `${p}%`;
                bar.style.background = `linear-gradient(90deg, ${color}, #7fe0c8)`;
                pct.textContent = `${p}%`;
                pct.style.color = color;
                waveRow.style.display = 'flex';
            } else {
                waveRow.style.display = 'none';
            }
        }
    },

    /** E 键按下/松开（全局监听写入；仅世界-122 且系统激活时生效） */
    _setRepairHeld(held) {
        if (!this.active || !Game || !Game.isRunning) {
            this._repairHeld = false;
            return;
        }
        this._repairHeld = !!held;
        if (!this._repairHeld) {
            this._repairTarget = null;
            this._repairTimer = 0;
        }
    },

    /**
     * 修理 tick：按住 E 时对玩家附近最近的受伤掩体/防御塔持续修理，
     * 消耗背包能源（费率见 DEFENSE_CONFIG.repair），修满自动切目标。
     */
    _repairTick(dt) {
        this._repairFlash = Math.max(0, this._repairFlash - dt);
        if (!this._repairHeld) return;
        const player = Game.player;
        if (!player || Game._buildMode || Game._wallEditMode) return;
        const cfg = DEFENSE_CONFIG.repair;
        // 找目标：优先沿用当前目标（未满血且在范围内），否则扫最近的受伤建筑
        const targetOk = this._repairTarget && this._repairTarget.active
            && this._repairTarget.hp < this._repairTarget.maxHp
            && Math.hypot(this._repairTarget.x - player.x, this._repairTarget.y - player.y) <= cfg.range;
        if (!targetOk) {
            this._repairTarget = null;
            let best = null;
            let bestD = Infinity;
            for (const e of Game.entities.values()) {
                if (!e || !e.active) continue;
                if (e._isDefenseTower) {
                    const d = Math.hypot(e.x - player.x, e.y - player.y);
                    if (d <= cfg.range && e.hp < e.maxHp && d < bestD) { best = e; bestD = d; }
                } else if (e.orient && (e.orient === 'h' || e.orient === 'v')) {
                    // 掩体（DefenseCover：orient h/v 标识）
                    const d = Math.hypot(e.x - player.x, e.y - player.y);
                    if (d <= cfg.range && e.hp < e.maxHp && d < bestD) { best = e; bestD = d; }
                }
            }
            this._repairTarget = best;
        }
        const target = this._repairTarget;
        if (!target) {
            // 范围内没有受伤建筑：不耗能，不提示（避免刷屏）
            return;
        }
        this._repairTimer += dt;
        if (this._repairTimer < cfg.tickMs) return;
        this._repairTimer = 0;
        const hpPerEnergy = target._isDefenseTower ? cfg.towerHpPerEnergy : cfg.coverHpPerEnergy;
        const missing = target.maxHp - target.hp;
        const want = Math.min(missing, cfg.tickHp);
        const cost = Math.max(1, Math.ceil(want / hpPerEnergy));
        if (!EnergyManager || !EnergyManager.deductEnergy(cost)) {
            if (EffectManager && this._repairFlash <= 0) {
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 50, '能源不足，无法修理', '#ff5555'));
                this._repairFlash = 1200;
            }
            return;
        }
        target.hp = Math.min(target.maxHp, target.hp + want);
        if (EffectManager && this._repairFlash <= 0) {
            EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, `+${want} 修理`, '#7fd4ff'));
            this._repairFlash = 600;
        }
        if (target.hp >= target.maxHp) {
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, '修理完成', '#9dff9d'));
            }
            this._repairTarget = null;
        }
    },

    _aliveCount() {
        // [PERF] 计数节流：250ms 内复用缓存结果，避免每帧全表扫描 Game.entities
        const now = this._elapsed || 0;
        if (this._aliveCountCache !== undefined && now - this._aliveCountTime < 250) {
            return this._aliveCountCache;
        }
        let n = 0;
        for (const e of Game.entities.values()) {
            if (e && e._defenseMonster && !e._destructionChallengeMonster
                && e.active && e.hp > 0) n++;
        }
        this._aliveCountCache = n;
        this._aliveCountTime = now;
        return n;
    },

    /** 防守击杀金币结算：怪物死亡标记后由本钩子统一发金币（地面掉落物已按 _noGoldDrop 关闭） */
    _grantMonsterGold(dt) {
        if (!this.active || !Game || !Game.entities) return;
        // [PERF] 结算节流：每 250ms 扫描一次尸体统一发金币（金币延迟 ≤250ms 可接受）
        this._goldScanTimer = (this._goldScanTimer || 0) + (dt || 0);
        if (this._goldScanTimer < 250) return;
        this._goldScanTimer = 0;
        if (!this._goldGranted) this._goldGranted = new Set();
        const wave = this._wave || 1;
        let grantedThisFrame = 0;
        for (const e of Game.entities.values()) {
            if (!e || !e._defenseMonster || e._destructionChallengeMonster || !e._noGoldDrop) continue;
            if (e.hp > 0 || e.active) continue;
            if (this._goldGranted.has(e.id)) continue;
            this._goldGranted.add(e.id);
            const cfg = DEFENSE_CONFIG.spawn;
            const base = wave * (cfg.goldDropMul || 1);
            const randMin = cfg.goldRandomMin ?? 1;
            const randMax = cfg.goldRandomMax ?? 8;
            const amount = Math.max(1, Math.round(base + (randMax > randMin ? Math.random() * (randMax - randMin) : 0)));
            if (GoldManager && typeof GoldManager.addGold === 'function') GoldManager.addGold(amount);
            if (Game.player && EffectManager) {
                EffectManager.add(new FloatingTextEffect(e.x, e.y - 30, `+${amount} 金币`, '#ffd700'));
            }
            // 建筑面板开着时同步金币显示（BuildingSystem 从未导入，typeof 恒 false，
            // 收敛为仅 window.__BuildingSystem 引用，消除 no-undef）
            const bs = typeof window !== 'undefined' ? window.__BuildingSystem : null;
            if (bs && bs._panel && typeof bs._refreshGold === 'function') {
                bs._refreshGold();
            }
            grantedThisFrame++;
            if (grantedThisFrame >= 8) break;
        }
    },

    _spawnMonster(wave, pool, hpMulExtra = 1, forceType = null, options = {}) {
        const type = forceType || this._pickMonsterType(pool);
        const Factory = MONSTER_FACTORY[type];
        if (!Factory) return;
        const spawnPoints = options.spawnPoints?.length
            ? options.spawnPoints
            : (this._managedConfig?.spawnPoints?.length
                ? this._managedConfig.spawnPoints
                : DEFENSE_CONFIG.spawnPoints);
        if (!spawnPoints?.length) return;
        const pt = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
        const monster = new Factory(pt.x, pt.y);
        const radius = monster.groundRadius || monster.collisionRadius || 20;
        const orderedSpawnPoints = [pt, ...spawnPoints.filter((point) => point !== pt)];
        let safeSpawn = null;
        for (const point of orderedSpawnPoints) {
            safeSpawn = findMonsterSpawnNear(point.x, point.y, radius);
            if (safeSpawn) break;
        }
        // 所有正式刷怪点及其邻域均不可用时宁可跳过本只，也不能塞进开启中的城门。
        if (!safeSpawn) return;
        monster.x = safeSpawn.x;
        monster.y = safeSpawn.y;
        monster.collider?.syncPosition?.();
        monster._defenseMonster = true;
        if (options.destructionChallenge) {
            monster._destructionChallengeMonster = true;
            monster._destructionChallengeWorldId = options.sceneId || this._worldId;
            monster._destructionChallengeEpoch = Math.max(0,
                Math.floor(Number(options.worldEpoch) || 0));
            monster._destructionChallengeTier = options.destructionTier || 'normal';
        }
        monster._elevatedNavigationMode = WALL_WALK_CONFIG.surfaceNavigation
            .enemyArchetypes?.[type] || null;
        // 防守击杀金币：不走地面掉落物，由 DefenseSystem 结算直接进背包
        monster._noGoldDrop = true;
        monster._defenseGoldMul = DEFENSE_CONFIG.spawn.goldDropMul || 1;
        // 防守模式：最终目标基地/建筑（_preferDefenseTargets），沿途交战见 _engageHostileRange
        monster._preferDefenseTargets = true;
        monster._engageHostileRange = DEFENSE_CONFIG.spawn.engageHostileRange;
        monster._alertRange = DEFENSE_CONFIG.spawn.alertRange;
        // aggro 归一化：pacing AI 怪（黑狼 _aggroRange 2500）出生点距基地 ~3000px，
        // aggro 小于 alertRange 会原地踱步不进场；统一抬到 alertRange（ai.defenseAggroRange 可覆盖）
        const defAggro = (monster.ai && monster.ai.defenseAggroRange) || DEFENSE_CONFIG.spawn.alertRange;
        if (monster._aggroRange && monster._aggroRange < defAggro) {
            monster._aggroRange = defAggro;
        }
        // 出生即持有战略推进目标，避免整批怪物以“无目标”状态在首帧反复执行全量感知。
        // 局部交战单位与更合适的防御结构仍由 PerceptionSystem 后续切换。
        if (this.base?.active !== false && !this.base?._portalDestroyed && this.base?.hp > 0) {
            monster.target = this.base;
            monster._lastKnownTargetPos = { x: this.base.x, y: this.base.y };
        }
        // 波次成长：HP/攻击随波次提升
        const hpPerWave = options.ignoreManagedScaling
            ? 0 : (this._managedConfig?.hpPerWave ?? DEFENSE_CONFIG.spawn.hpPerWave);
        const atkPerWave = options.ignoreManagedScaling
            ? 0 : (this._managedConfig?.atkPerWave ?? DEFENSE_CONFIG.spawn.atkPerWave);
        const cycleHpMul = options.ignoreManagedScaling ? 1 : (this._managedConfig?.cycleHpMul ?? 1);
        const cycleAtkMul = options.ignoreManagedScaling ? 1 : (this._managedConfig?.cycleAtkMul ?? 1);
        const hpMul = (1 + (wave - 1) * hpPerWave) * hpMulExtra * cycleHpMul;
        const atkMul = (1 + (wave - 1) * atkPerWave) * cycleAtkMul;
        monster.maxHp = Math.max(1, Math.round(monster.maxHp * hpMul));
        monster.hp = monster.maxHp;
        if (monster.data) {
            monster.data.maxHp = monster.maxHp;
            monster.data.hp = monster.maxHp;
            if (monster.data.atk) monster.data.atk = Math.max(1, Math.round(monster.data.atk * atkMul));
            if (monster.data.matk) monster.data.matk = Math.max(1, Math.round(monster.data.matk * atkMul));
        }
        Game.entities.set(`defense_monster_${++this._seq}`, monster);
        this._aliveCountCache = undefined;
        return monster;
    },

    /** 位面毁灭挑战复用正式防守怪工厂，但不参与五日入侵的清波/胜利计数。 */
    spawnDestructionChallengeMonster({
        tier = 'normal', spawnPoints = null, sceneId = null, worldEpoch = 0,
    } = {}) {
        if (!this.active || !this._managedExternally || !this.base || this.base._portalDestroyed
            || this.base.active === false || this.base.hp <= 0) return null;
        if (sceneId && this._worldId !== sceneId) return null;
        const pool = tier === 'lord' ? LORD_POOL : (tier === 'elite' ? ELITE_POOL : NORMAL_POOL);
        return this._spawnMonster(1, pool, 1, null, {
            spawnPoints,
            destructionChallenge: true,
            destructionTier: tier,
            sceneId: sceneId || this._worldId,
            worldEpoch,
            ignoreManagedScaling: true,
        });
    },

    /** 毁灭挑战活体计数：供软/硬上限背压使用，尸体和待清理对象不计入。 */
    countDestructionChallengeMonsters(sceneId = this._worldId, worldEpoch = null, tier = null) {
        if (!Game?.entities) return 0;
        let count = 0;
        for (const entity of Game.entities.values()) {
            if (!entity?._destructionChallengeMonster || entity.active === false
                || entity._isDead || entity._dying || !(entity.hp > 0)) continue;
            if (sceneId && entity._destructionChallengeWorldId !== sceneId) continue;
            if (worldEpoch !== null
                && Number(entity._destructionChallengeEpoch) !== Number(worldEpoch)) continue;
            if (tier && entity._destructionChallengeTier !== tier) continue;
            count++;
        }
        return count;
    },

    clearDestructionChallengeMonsters(sceneId = null, worldEpoch = null) {
        if (!Game?.entities) return 0;
        let removed = 0;
        for (const [key, entity] of Array.from(Game.entities.entries())) {
            if (!entity?._destructionChallengeMonster) continue;
            if (sceneId && entity._destructionChallengeWorldId !== sceneId) continue;
            if (worldEpoch !== null && Number(entity._destructionChallengeEpoch) !== Number(worldEpoch)) continue;
            entity.active = false;
            entity._destroyPhaserSprite?.();
            Game.entities.delete(key);
            removed++;
        }
        this._aliveCountCache = undefined;
        return removed;
    },

    _spawnElite(hpMul) {
        const monster = this._spawnMonster(
            this._wave || 1,
            ELITE_POOL,
            hpMul ?? DEFENSE_CONFIG.spawn.eliteHpMul
        );
        if (!monster) return null;
        this._announce('精英来袭！', '#ff8800', 'assets/sounds/enemies/armored_knight/attacking.mp3');
        return monster;
    },

    _spawnLord(hpMul) {
        const monster = this._spawnMonster(
            this._wave || 1,
            LORD_POOL,
            hpMul ?? DEFENSE_CONFIG.spawn.lordHpMul
        );
        if (!monster) return null;
        this._announce('领主降临！', '#ff4444', 'assets/sounds/enemies/foreman_zombie/howling.mp3');
        return monster;
    },

    _announce(text, color, soundPath) {
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 60, text, color || '#ffd700'));
        }
        if (soundPath && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(soundPath);
        }
    },

    _pickMonsterType(pool) {
        const list = pool || NORMAL_POOL;
        const total = list.reduce((sum, m) => sum + m.weight, 0);
        let roll = Math.random() * total;
        for (const m of list) {
            roll -= m.weight;
            if (roll <= 0) return m.type;
        }
        return list[0].type;
    },

    _onBaseDestroyed() {
        if (this.defeated) return;
        this.defeated = true;
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 50, '基地核心被摧毁！防守失败', '#ff5555'));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/enemies/amalgam/dying.mp3');
        }
        if (this._panel && this._panel.isOpen) this._panel.close();
        if (this._managedExternally && typeof this._managedResolved === 'function') {
            const callback = this._managedResolved;
            this._managedResolved = null;
            callback({ victory: false, worldId: this._worldId, wave: this._wave });
        }
    },

    // ==================== 塔出售（2026-08-14；被摧毁即清除，无废墟/重建）====================

    /** 出售塔：返还 50% 建造能源；武器归还背包（满则原地掉落）；移除实体 */
    sellTower(tower, _player) {
        if (!tower || tower.active === false) return { ok: false, reason: '防御塔已被摧毁' };
        const durability = Math.max(0, Math.min(1,
            Number(tower.hp) / Math.max(1, Number(tower.maxHp) || 1)));
        const refund = Math.floor((tower._buildCost ?? DEFENSE_CONFIG.tower.rebuildCost ?? 1000)
            * (DEFENSE_CONFIG.tower.sellRefundRatio ?? 0.5) * durability);
        if (!EnergyManager || !EnergyManager.canStore(refund)) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        // 武器归还
        const item = tower.weaponItem;
        if (item) {
            tower.unequipWeapon && tower.unequipWeapon();
            if (!EquipManager.addToBackpack(item) && Game && typeof Game.dropItem === 'function') {
                Game.dropItem(tower.x, tower.y, item);
            }
        }
        const i = this.towers.indexOf(tower);
        if (i >= 0) this.towers.splice(i, 1);
        tower.hittable = false;
        tower._sinking = true;
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (this._panel && this._panel.isOpen && this._panel.tower === tower) this._panel.close();
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(tower.x, tower.y - 40, `已出售（+${refund} 能源）`, '#ffd700'));
            EffectManager.add(new BuildingSinkEffect(tower).start());
        }
        return { ok: true, refund };
    },

    /** 防守胜利：撑过 victoryWave 波 → 停止刷怪 + 一次性奖励 */
    _onVictory() {
        if (this.victory) return;
        this.victory = true;
        if (this._managedExternally) {
            if (typeof this._managedResolved === 'function') {
                const callback = this._managedResolved;
                this._managedResolved = null;
                callback({ victory: true, worldId: this._worldId, wave: this._wave });
            }
            return;
        }
        const reward = DEFENSE_CONFIG.spawn.victoryReward || { gold: 500, energy: 500 };
        let energyAdded = 0;
        if (!this._victoryGranted) {
            this._victoryGranted = true;
            if (GoldManager) GoldManager.addGold(reward.gold || 0);
            if (EnergyManager) energyAdded = EnergyManager.depositEnergy(reward.energy || 0);
        }
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(
                Game.player.x, Game.player.y - 60,
                `防守胜利！撑过 ${DEFENSE_CONFIG.spawn.victoryWave || 10} 波（+${reward.gold} 金币 +${energyAdded} 能源入库）`,
                '#ffd700'
            ));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/levelup.wav');
        }
    },

    /**
     * 遍历所有存活防御塔（towers 数组 + Game.entities 兜底扫描，按 id 去重）
     * 点击命中与悬停轮廓共用（2026-08-15 抽出）
     */
    _iterActiveTowers() {
        const seen = new Set();
        const out = [];
        if (Game && Game.entities) {
            for (const e of Game.entities.values()) {
                if (e && e._isDefenseTower && e.active && !seen.has(e.id)) {
                    seen.add(e.id);
                    out.push(e);
                }
            }
        }
        for (const t of this.towers) {
            if (t && t.active && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
        }
        return out;
    },

    /**
     * 悬停追踪（2026-08-15）：鼠标悬停防御塔整塔范围 → 记录 _hoverTower，
     * GameScene._syncDefenseTowers 每帧读它给三层贴图加金色轮廓；同时切换手型光标。
     * 建筑/编辑模式或指针在右侧面板上时不悬停。
     */
    _hoverTower: null,
    updateHover(mx, my) {
        if (!this.active) { this._setHoverTower(null); return; }
        if (Game && (Game._wallEditMode || Game._buildMode)) { this._setHoverTower(null); return; }
        // 面板打开时指针悬在右侧面板（DOM）上不穿透到场景
        const panel = this._panel;
        if (panel && panel.isOpen && typeof window !== 'undefined' && mx > window.innerWidth - 460) {
            this._setHoverTower(null);
            return;
        }
        const mw = Renderer.screenToWorld(mx, my);
        let hit = null;
        for (const t of this._iterActiveTowers()) {
            if (pointHitsTower(mw.x, mw.y, t)) { hit = t; break; }
        }
        this._setHoverTower(hit);
    },

    _setHoverTower(t) {
        if (this._hoverTower === t) return;
        this._hoverTower = t;
        if (typeof document === 'undefined') return;
        const cv = document.querySelector('canvas');
        if (cv) cv.style.cursor = (t || Game?.RTSCommand?._hoverBuilding) ? 'pointer' : '';
    },

    /**
     * 点击交互：点防御塔打开面板（再次点击关闭）。
     * 位面传送门与位面祭坛均由 ProducerBuildingSystem 按各自 panelMode 分发，
     * 不能在这里继续把 DefenseSystem.base 误当成献祭建筑。
     * @param {number} mx 屏幕 X
     * @param {number} my 屏幕 Y
     * @param {object} player 玩家
     * @returns {boolean} 是否消费本次点击
     */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const panel = this._ensurePanel();
        // 建设模式（B 打开建筑面板）无视距离，2026-08-16 用户口径
        const buildMode = !!(Game && Game._buildMode);
        const inReach = (t, r) => {
            const pdx = t.x - player.x;
            const pdy = t.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) return false;
            const pos = Renderer.worldToScreen(t.x, t.y);
            return Math.hypot(mx - pos.x, my - pos.y) < r;
        };
        // 点击目标：优先自身 towers 数组，同时兜底扫描 Game.entities（测试/运行期
        // 直接入实体表的塔也要可点；按实体 id 去重，避免同塔重复命中）
        const candidates = this._iterActiveTowers();
        for (const t of candidates) {
            if (!t.active) continue;
            // 命中判定 = 整塔矩形（基座/机械臂/挂载武器全视觉范围）；非建设模式限 260px
            const pdx = t.x - player.x;
            const pdy = t.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            const mw = Renderer.screenToWorld(mx, my);
            if (!pointHitsTower(mw.x, mw.y, t)) continue;
            if (panel.isOpen && panel.tower === t) {
                panel.close();
            } else {
                panel.openFor(t, player);
            }
            Game?.BuildingSystem?._keepOnlyBuildingDetailPanel?.(panel.isOpen ? panel : null);
            return true;
        }
        return false;
    },
};

// ==================== 基地铁栅栏滑动门（2026-08-15）====================
// Blender 建模 + 掩体同款砖墙/铸铁贴图 + 16 帧横向缩进动画；关闭=阻挡门洞，打开=放行。
/** 最近友军单位（玩家/侍从；排除同为 player 阵营的防御塔/掩体/基地）。
 *  侍从不在 Game.entities 里（存于 PartySystem._members），必须单独扫描，
 *  否则门只对玩家有反应。 */
function nearbyFriendlyUnit(cx, cy) {
    let best = null;
    let bestD = Infinity;
    const scan = (e) => {
        if (!e || !e.active) return;
        if (e._isDefenseStructure || e._isDefenseTower || e._isDefenseCover) return;
        if (e._faction !== 'player' && e._faction !== 'companion') return;
        // 墙顶与门洞分属不同移动表面，墙上单位不能隔着高度触发地面城门。
        if (e._surfaceKind === 'wall_walk') return;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d < bestD) { bestD = d; best = e; }
    };
    if (Game && Game.player) scan(Game.player);
    if (Game && Game.entities) {
        for (const e of Game.entities.values()) scan(e);
    }
    // 侍从挂在 Game.PartySystem（party-system.js 单例，game.js 挂载），不在 entities
    const party = (Game && Game.PartySystem) || null;
    if (party && Array.isArray(party.members)) {
        for (const e of party.members) scan(e);
    }
    return best;
}

/** 关门瞬间把"嵌进门段内"的单位沿面线法线推开（2026-08-16 三修）。
 *  - 只在 close() 瞬间调用一次（不每帧推——每帧直接改坐标会与移动系统 resolve 打架：
 *    开门时玩家被弹开/瞬移，双门接缝处卡柱子，实测更严重）；
 *  - 只推真正重叠门段（距离 < halfThick + 单位半径 + 2）的单位，不推只是靠近的；
 *  - 目标位置经 WallSystem.resolve 校验/滑动（不推进别的墙/柱子/接缝）。
 *  @returns {string[]} 被推开单位的 id 列表（调试用） */
function unstickUnitsFromGate(A, B, halfThick) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const pushed = [];
    const push = (u) => {
        if (!u || !u.active) return;
        if (u._isDefenseStructure || u._isDefenseTower || u._isDefenseCover) return;
        const r = u.groundRadius || u.collisionRadius || 20;
        const thresh = halfThick + r + 2; // 只推真正嵌进门段的单位
        const t = Math.max(0, Math.min(1, ((u.x - A.x) * ux + (u.y - A.y) * uy) / len));
        const cx = A.x + ux * t * len;
        const cy = A.y + uy * t * len;
        const off = (u.x - cx) * nx + (u.y - cy) * ny; // 有符号法向偏移
        const dist = Math.abs(off);
        if (dist >= thresh) return;
        const side = off >= 0 ? 1 : -1;
        const tx = cx + nx * (thresh + 1) * side;
        const ty = cy + ny * (thresh + 1) * side;
        // 经移动系统同一 resolve 校验/切向滑动，避免推进别的墙/柱子/双门接缝
        let ex = tx;
        let ey = ty;
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const er = WallSystem.resolve(u.x, u.y, tx, ty, r);
            if (er) { ex = er.x; ey = er.y; }
        }
        u.x = ex;
        u.y = ey;
        pushed.push(u.id || u.name || 'unit');
    };
    if (Game && Game.player) push(Game.player);
    if (Game && Game.entities) {
        for (const e of Game.entities.values()) push(e);
    }
    return pushed;
}

/** 门拼接缝图层规则（2026-08-16，用户指定）：左右两门拼接时，**左门的右柱**盖在
 *  **右门的左柱**之上（对齐墙的 depthBias 转角规则）。自然深度下右门左柱因面线
 *  叠 51px 深 ~22.8px 会盖左门右柱，需按缝成对加偏置：左门右柱 +diff、右门左柱 −diff
 *  （diff = 邻柱自然深度差 + 0.5）。同步精灵深度与遮挡面线段，保证仲裁一致。 */
function syncGateSeamDepths() {
    const D = (typeof DefenseSystem !== 'undefined') ? DefenseSystem : null;
    const list = [];
    if (D) {
        if (D.gate) list.push(D.gate);
        if (Array.isArray(D.gates)) {
            for (const g of D.gates) if (g && g.active) list.push(g);
        }
    }
    if (!list.length) return;
    for (const g of list) { g._seamBiasR = 0; g._seamBiasL = 0; }
    const faceEnd = (g) => {
        if (g._faceLine && g._faceLine.length === 2) return g._faceLine;
        if (g._gateSeg) return [{ x: g._gateSeg.x1, y: g._gateSeg.y1 }, { x: g._gateSeg.x2, y: g._gateSeg.y2 }];
        return null;
    };
    const SEAM_TOUCH = 70; // 51px face 叠合 + 端柱余量
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const g = list[i];
            const h = list[j];
            const gf = faceEnd(g);
            const hf = faceEnd(h);
            if (!gf || !hf) continue;
            const dAB = Math.hypot(gf[1].x - hf[0].x, gf[1].y - hf[0].y);
            const dBA = Math.hypot(gf[0].x - hf[1].x, gf[0].y - hf[1].y);
            if (dAB <= SEAM_TOUCH) {
                // g 右端 ≈ h 左端 → g 是左门：g 右柱盖 h 左柱
                const diff = (h._depthL - g._depthR) + 0.5;
                if (diff > 0) { g._seamBiasR += diff; h._seamBiasL -= diff; }
            }
            if (dBA <= SEAM_TOUCH) {
                // g 左端 ≈ h 右端 → h 是左门：h 右柱盖 g 左柱
                const diff = (g._depthL - h._depthR) + 0.5;
                if (diff > 0) { h._seamBiasR += diff; g._seamBiasL -= diff; }
            }
        }
    }
    // 门对掩体（2026-08-16 用户口径：门与墙相连同样"左在右之前"）：
    // 门 B 端 ≈ 墙 A 端 → 门在墙左 → 门右柱抬到墙之上（盖墙左端）；
    // 门 A 端 ≈ 墙 B 端 → 墙在门左 → 门左柱压到墙之下（墙右端盖门左柱）。
    // 余量用 2.0（比门对门的 0.5 大）：墙是整段大贴图，0.5px 在亚像素/抗锯齿下
    // 视觉仍可能被墙端盖住（用户实测"右柱仍在墙下"），2px 才稳。
    // 只调门柱深度、不动墙的单一 _faceDepth（墙两端可能同时接门）。
    const covers = [];
    if (typeof window !== 'undefined' && window.Game && window.Game.entities) {
        for (const e of window.Game.entities.values()) {
            if (!e || !e.active || !e._isDefenseCover || e._isCoverGate) continue;
            covers.push(e);
        }
    }
    for (const g of list) {
        const gf = faceEnd(g);
        if (!gf || typeof g._depthL !== 'number' || typeof g._depthR !== 'number') continue;
        for (const c of covers) {
            const cf = faceEnd(c);
            if (!cf) continue;
            const wallDepth = (typeof c._faceDepth === 'number')
                ? c._faceDepth
                : structureDepthAtY(Math.max(cf[0].y, cf[1].y));
            if (Math.hypot(gf[1].x - cf[0].x, gf[1].y - cf[0].y) <= SEAM_TOUCH) {
                const needR = wallDepth + 2 - g._depthR;
                if (needR > g._seamBiasR) g._seamBiasR = needR;
            }
            if (Math.hypot(gf[0].x - cf[1].x, gf[0].y - cf[1].y) <= SEAM_TOUCH) {
                const needL = wallDepth - 2 - g._depthL;
                if (needL < g._seamBiasL) g._seamBiasL = needL;
            }
        }
    }
    for (const g of list) { if (typeof g._applySeamBias === 'function') g._applySeamBias(); }
}

/** 门放置时裁剪与门共线且伸入门跨度的掩体墙段碰撞线（2026-08-16）：
 *  - 基地菱形房的门洞带（openRadius 90）比门面线窄，门端柱骑在相邻掩体 face 线上，
 *    掩体段端点深入门跨（实测 i=0 深 61px / i=3 深 3px）。开门后栅栏放行，但掩体
 *    段的阻挡带（halfThick + 单位半径 ≈ 48px）仍探入门洞，玩家贴柱走位被截停 =
 *    "卡在柱子上"。
 *  - 正解：把深入掩体段的"内侧端点"沿门向回退 halfThick + 余量（只改 _coverSeg
 *    碰撞线，不动 _faceLine/贴图/深度锚点），让阻挡带恰好止于门 face 端点；
 *    门拆除时还原。 */
function trimCoverSegsForGate(gate, A, B) {
    if (!WallSystem || !WallSystem.isoSegments) return;
    if (!gate._trimmedCovers) gate._trimmedCovers = [];
    const gdx = B.x - A.x;
    const gdy = B.y - A.y;
    const glen = Math.hypot(gdx, gdy) || 1;
    const gux = gdx / glen;
    const guy = gdy / glen;
    const proj = (p) => (p.x - A.x) * gux + (p.y - A.y) * guy; // 沿门方向投影（A=0, B=glen）
    const distToLine = (p) => Math.abs((p.x - A.x) * guy - (p.y - A.y) * gux);
    for (const s of WallSystem.isoSegments) {
        if (!s || !s._cover || !s._owner || gate._trimmedCovers.includes(s)) continue;
        if (distToLine({ x: s.x1, y: s.y1 }) > 6 || distToLine({ x: s.x2, y: s.y2 }) > 6) continue; // 共线
        const a = proj({ x: s.x1, y: s.y1 });
        const b = proj({ x: s.x2, y: s.y2 });
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi <= 0 || lo >= glen) continue; // 与门跨度无重叠
        const backoff = (s.halfThick ?? 26) + 30; // 阻挡带 halfThick+单位半径，回退到门端点之外
        gate._trimmedCovers.push(s);
        if (!s._orig) s._orig = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
        // 深入门跨（投影 ∈ [0, glen]）的端点 → 沿门向回退到对应门端点之外：
        // 靠 A 端回退到 A−backoff，靠 B 端回退到 B+backoff，使阻挡带止于门 face 端点。
        const moveOut = (e, side) => {
            if (side === 'A') { e.x = A.x - gux * backoff; e.y = A.y - guy * backoff; }
            else { e.x = B.x + gux * backoff; e.y = B.y + guy * backoff; }
        };
        const ends = [
            { x: s.x1, y: s.y1, p: a },
            { x: s.x2, y: s.y2, p: b },
        ];
        for (const e of ends) {
            if (e.p < 0 || e.p > glen) continue;
            moveOut(e, e.p < glen / 2 ? 'A' : 'B');
        }
        // 写回（ends 中的对象是新建的，需回填）
        s.x1 = ends[0].x; s.y1 = ends[0].y; s.x2 = ends[1].x; s.y2 = ends[1].y;
    }
    if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
        pathFinder.invalidateRegion(
            Math.min(A.x, B.x) - 30, Math.min(A.y, B.y) - 30,
            Math.max(A.x, B.x) + 30, Math.max(A.y, B.y) + 30);
    }
}

/** 还原被门裁剪的掩体段（门销毁时调用）。 */
function restoreTrimmedCovers(gate) {
    if (!gate || !gate._trimmedCovers || !WallSystem || !WallSystem.isoSegments) return;
    for (const s of gate._trimmedCovers) {
        if (!s || !s._orig) continue;
        // 分裂裁墙：回收分裂件并把原段重新注册。
        if (s._splitParts) {
            for (const ns of s._splitParts) {
                const i = WallSystem.isoSegments.indexOf(ns);
                if (i >= 0) WallSystem.isoSegments.splice(i, 1);
            }
            s._splitParts = null;
            WallSystem.isoSegments.push(s);
        }
        s.x1 = s._orig.x1; s.y1 = s._orig.y1; s.x2 = s._orig.x2; s.y2 = s._orig.y2;
    }
    gate._trimmedCovers = [];
}

const _CoverGate = {
    place(center, A, B, cfg) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const cfg0 = cfg || GATE_CONFIG;
        this._cfg = cfg0;
        if (!scene || !scene.textures.exists(cfg0.tex)) return false;
        const k = cfg0.displayScale;
        this._scale = k;
        // 面线中点对齐：门的 face 线与掩体墙 face 线共线（同斜率、中点落在线中点）。
        // face 纹理线比世界 face 略短（显示比例一致），端点余量由相邻墙端帽叠盖。
        const midTexX = (cfg0.faceA.x + cfg0.faceB.x) / 2;
        const midTexY = (cfg0.faceA.y + cfg0.faceB.y) / 2;
        this._cx = (A.x + B.x) / 2 - (midTexX - cfg0.cellW / 2) * k;
        this._cy = (A.y + B.y) / 2 - (midTexY - cfg0.cellH / 2) * k;
        // 三段深度精灵（2026-08-15 图层重做）：左柱=深端、右柱=浅端、栅栏=中点，
        // 各自按底边线锚定，前实体不再被右柱整体遮挡
        this._depthL = structureDepthAtY(A.y);
        this._depthR = structureDepthAtY(B.y);
        this._depthBars = structureDepthAtY((A.y + B.y) / 2);
        this._faceLine = [A, B];
        this._seamBiasL = 0;
        this._seamBiasR = 0;
        this._destroySprites();
        const sprites = createGateSprites(cfg0, this._cx, this._cy, k, this._depthL, this._depthR, this._depthBars, !!cfg0.flipX);
        this.spriteL = sprites ? sprites.spriteL : null;
        this.spriteR = sprites ? sprites.spriteR : null;
        this.sprite = sprites ? sprites.bars : null; // 栅栏精灵驱动 16 帧动画
        this._gateSeg = {
            x1: A.x, y1: A.y, x2: B.x, y2: B.y,
            halfThick: cfg0.halfThick,
            _gate: true, _gateHole: true,
            _opensForFriendly: true, _gateOwner: this,
        };
        // [GATE-DETECT-FIX 2026-08-16] 感应中心 = 门洞物理中心（面线中点），
        // 不能用精灵中心 _cx/_cy——贴图等距偏移让检测球偏入门内 ~74px，
        // 门外单位被关门段挡在 150px 检测半径之外，永远触发不了开门（卡门根因）。
        this._detectX = (A.x + B.x) / 2;
        this._detectY = (A.y + B.y) / 2;
        // 三段面线注册进遮挡仲裁（pillar 恒注册；bars 随开关注册/移除）
        this._unregisterSegs();
        this._depthSegs = gateDepthSegs(A, B, this._depthL, this._depthR, this._depthBars);
        const reg = gateSegRegistry();
        if (reg) {
            for (const s of this._depthSegs) reg.push(s);
        }
        // 状态机默认关闭：门洞碰撞注册（阻挡）；友军靠近时 _update 自动打开
        this.state = 'closed';
        this._frame = 0;
        this._closeTimer = 0;
        this.setPassable(false);
        // 裁剪与门共线/重叠的掩体碰撞段（避免开门后贴柱走位被掩体段截停）
        trimCoverSegsForGate(this, A, B);
        return true;
    },

    _unregisterSegs() {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs) return;
        for (const s of this._depthSegs) {
            const i = reg.indexOf(s);
            if (i >= 0) reg.splice(i, 1);
        }
        this._depthSegs = null;
    },

    /** 栅栏段面线随开关切换：开门（放行）时移除，关门时注册（栅栏消失后不再遮挡）。 */
    _setBarsSeg(enabled) {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs || !this._depthSegs[1]) return;
        const s = this._depthSegs[1];
        const i = reg.indexOf(s);
        if (enabled && i < 0) reg.push(s);
        else if (!enabled && i >= 0) reg.splice(i, 1);
    },

    _destroySprites() {
        for (const s of [this.spriteL, this.spriteR, this.sprite]) {
            if (s && s.destroy) s.destroy();
        }
        this.spriteL = this.spriteR = this.sprite = null;
    },

    /** 应用拼接缝偏置（左门右柱盖右门左柱，2026-08-16）；同步精灵与遮挡面线段。 */
    _applySeamBias() {
        const bL = this._seamBiasL || 0;
        const bR = this._seamBiasR || 0;
        if (this.spriteL) this.spriteL.setDepth(this._depthL + bL);
        if (this.spriteR) this.spriteR.setDepth(this._depthR + bR);
        if (this._depthSegs) {
            if (this._depthSegs[0]) this._depthSegs[0].depth = this._depthL + bL;
            if (this._depthSegs[2]) this._depthSegs[2].depth = this._depthR + bR;
        }
    },

    /** 状态机默认关闭 → 友军靠近打开 → 友军离开延时关闭（2026-08-15）。 */
    update(dt) {
        if (!this._gateSeg) return;
        // 2026-08-17：150px 圆心判定太敏感——玩家在基地附近走动/站桩就开门，
        // 栅栏滑出后 RB 边出现大洞，基地"围不拢"。改为点到门线段的距离，
        // 只有单位真正贴到门洞（≤65px）才开，离开后快速关，菱形平时保持闭合。
        const OPEN_TOUCH = 65;
        const CLOSE_LINGER_S = 0.8; // dt 单位为秒
        const f = nearbyFriendlyUnit((this._detectX ?? this._cx), (this._detectY ?? this._cy));
        let near = false;
        if (f) {
            const s = this._gateSeg;
            const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
            const len = Math.hypot(dx, dy) || 1;
            const t = Math.max(0, Math.min(1, ((f.x - s.x1) * dx + (f.y - s.y1) * dy) / (len * len)));
            const px = s.x1 + t * dx;
            const py = s.y1 + t * dy;
            near = Math.hypot(f.x - px, f.y - py) <= OPEN_TOUCH;
        }
        if (near) {
            this._closeTimer = 0;
            if (this.state === 'closed' || this.state === 'closing') this.open();
        } else {
            this._closeTimer = (this._closeTimer || 0) + dt;
            if ((this.state === 'open' || this.state === 'opening') && this._closeTimer >= CLOSE_LINGER_S) {
                this.close();
            }
        }
    },

    setPassable(passable) {
        this._setBarsSeg(!passable); // 关门=栅栏面线注册；开门=移除
        if (!WallSystem || !WallSystem.isoSegments || !this._gateSeg) return;
        const i = WallSystem.isoSegments.indexOf(this._gateSeg);
        if (!passable && i < 0) {
            WallSystem.isoSegments.push(this._gateSeg);
        } else if (passable && i >= 0) {
            WallSystem.isoSegments.splice(i, 1);
        }
        if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
            const s = this._gateSeg;
            pathFinder.invalidateRegion(
                Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        }
    },

    open() {
        if (this.state === 'open' || this.state === 'opening') return;
        this.state = 'opening';
        this.setPassable(true);
        this._playSound('open');
        this._play(0, (this._cfg || GATE_CONFIG).frames - 1);
    },

    close() {
        if (this.state === 'closed' || this.state === 'closing') return;
        unstickUnitsFromGate(
            { x: this._gateSeg.x1, y: this._gateSeg.y1 },
            { x: this._gateSeg.x2, y: this._gateSeg.y2 },
            this._cfg.halfThick
        );
        this.state = 'closing';
        this.setPassable(false);
        this._playSound('close');
        this._play((this._cfg || GATE_CONFIG).frames - 1, 0);
    },

    /** 铁栅栏门开关音效（世界音效距离衰减，2026-08-16；用户素材 1.mp3，开关共用） */
    _playSound(which) {
        if (!SoundManager || typeof SoundManager.playWorld !== 'function') return;
        void which; // 开/关共用同一音效（用户指定）
        const path = 'assets/sounds/environment/gate_iron.mp3';
        const sx = this._detectX ?? this._cx ?? 0;
        const sy = this._detectY ?? this._cy ?? 0;
        SoundManager.playWorld(path, sx, sy);
    },

    toggle() {
        if (this.state === 'open' || this.state === 'opening') this.close();
        else this.open();
    },

    _play(from, to) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this.sprite) this.sprite.setFrame(from);
        if (!scene) {
            this._frame = to;
            this.state = to === 0 ? 'closed' : 'open';
            return;
        }
        if (this._animCounter) this._animCounter.stop();
        this._animCounter = scene.tweens.addCounter({
            from,
            to,
            duration: (this._cfg || GATE_CONFIG).animMs,
            ease: 'Linear',
            onUpdate: (tw) => {
                const f = Math.round(tw.getValue());
                if (this.sprite) this.sprite.setFrame(f);
            },
            onComplete: () => {
                this._frame = to;
                this.state = to === 0 ? 'closed' : 'open';
            },
        });
    },

    destroy() {
        if (this._animCounter) { this._animCounter.stop(); this._animCounter = null; }
        this.setPassable(true);
        restoreTrimmedCovers(this);
        this._unregisterSegs();
        this._destroySprites();
        this._gateSeg = null;
        this.state = 'open';
    },
};

/**
 * 可建造铁栅栏门（建筑面板 B 放置，2026-08-15）：
 * 与掩体墙同口径（可被攻击/修理、footprint/face 线/深度锚点），
 * 参与建筑吸附（GATE_SNAP），默认关闭，友军靠近自动开门、离开延时关门。
 */
/**
 * 世界-122 城墙楼梯。
 *
 * 一个逻辑建筑由 N 个 1×1 楼梯段组成，从底部格沿 e1/e2 轴逐段升高；
 * 当前城墙 topZ=125、每段 rise=62.5，因此自动生成两段。x/y 始终是地面格坐标，
 * z 是单位脚底高度真源。
 */
const wallStairGroupState = {
    get signature() { return DefenseSystem._wallStairGroupSignature; },
    set signature(value) { DefenseSystem._wallStairGroupSignature = value; },
    get version() { return DefenseSystem._wallStairGroupVersion; },
    set version(value) { DefenseSystem._wallStairGroupVersion = value; },
};
const wallStairGroupRegistry = createWallStairGroupRegistry({
    config: {
        cellWidth: ONE_CELL_BUILDING_FOOT.w,
        centerTolerance: WALL_STAIR_CONFIG.groupCenterTolerance,
        runTolerance: WALL_STAIR_CONFIG.groupRunTolerance,
        railGapTolerance: WALL_STAIR_CONFIG.groupRailGapTolerance,
    },
    state: wallStairGroupState,
    getStaircases: () => DefenseSystem?.staircases || [],
    convexHull: _convexHull,
    isoLocalToWorldDelta,
    worldDeltaToIsoLocal,
});
const rebuildWallStairGroups = (staircases = null) => {
    const result = wallStairGroupRegistry.rebuild(staircases);
    elevatedTopology.invalidate();
    return result;
};
const ensureWallStairGroups = (staircases = null) =>
    wallStairGroupRegistry.ensure(staircases);
DefenseSystem.rebuildWallStairGroups = rebuildWallStairGroups;
DefenseSystem.ensureWallStairGroups = ensureWallStairGroups;
ElevatedNavigationController.configure({
    revision: () => DefenseSystem.elevatedNavigationRevision(),
    stairTrafficKey: (staircaseId) => {
        const staircase = (DefenseSystem.staircases || []).find((candidate) =>
            candidate?.active && candidate.id === staircaseId);
        return staircase ? wallStairGroupId(staircase) : staircaseId;
    },
    stairGroupSize: (staircaseId) => {
        const staircase = (DefenseSystem.staircases || []).find((candidate) =>
            candidate?.active
            && (candidate.id === staircaseId
                || wallStairGroupId(candidate) === staircaseId));
        return staircase?._wallStairGroupMembers?.filter((member) => member?.active).length || 1;
    },
    planRoute: (unit, surfaceTarget) =>
        DefenseSystem.planSurfaceRouteForUnit(unit, surfaceTarget),
    replanRoute: (unit, point) =>
        DefenseSystem.replanSurfaceRouteForUnit(unit, point),
    trackUnit: (unit) => DefenseSystem.trackElevatedNavigationUnit(unit),
}, WALL_WALK_CONFIG.surfaceNavigation);

class WallStaircase extends Combatant {
    constructor(x, y, config = {}) {
        const groundZ = Number(config.groundZ) || 0;
        const targetTopZ = Number.isFinite(config.targetTopZ)
            ? config.targetTopZ
            : (Number(config.wall?._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ);
        const rawCount = Number(config.segmentCount)
            || Math.ceil(Math.max(0, targetTopZ - groundZ) / WALL_STAIR_CONFIG.risePerSegment);
        const segmentCount = Math.max(
            WALL_STAIR_CONFIG.minSegments,
            Math.min(WALL_STAIR_CONFIG.maxSegments, rawCount)
        );
        const hp = config.hp ?? WALL_STAIR_CONFIG.hpPerSegment * segmentCount;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: config.size ?? 60,
            collisionRadius: 30,
            name: config.name ?? WALL_STAIR_CONFIG.name,
        });
        this.id = config.id || `wall_staircase_${Math.random().toString(36).slice(2, 7)}`;
        this._isWallStaircase = true;
        this._dormantBand = true; // 2026-08-19：静态结构进休眠带（1/4 帧率聚合 dt）
        this._isDefenseStructure = true; // 怪物可锁定攻击（防御建筑）
        this.noSeparation = true;
        this.noNameLabel = true;
        this._noShadow = true;   // 贴图自带接地底座
        this.immovable = true;   // 不可击退/位移
        // 楼梯实体本身不参与圆形分离；占地、侧边与城墙由 footprint/墙段负责。
        this.noCollision = true;
        // dir 是楼梯轴，ascendingSign 决定沿该轴正向还是反向登高。
        this.dir = config.dir || (config.mirror ? 'e1' : 'e2');
        this.ascendingSign = config.ascendingSign === -1 ? -1 : 1;
        this.orient = this.dir === 'e1' ? 'h' : 'v';
        this._facingLeft = this.dir === 'e1';
        this.wall = config.wall || null;
        // 存档可继续传入 walls，但运行时连通关系只认 ElevatedTopology 当前版本。
        this.walls = this.wall ? [this.wall] : [];
        this._wallLine = this.wall?._faceLine || null;
        this._wallSeg = this.wall?._coverSeg || null;
        this.attachPoint = config.attachPoint || (this._wallLine
            ? {
                x: (this._wallLine[0].x + this._wallLine[1].x) / 2,
                y: (this._wallLine[0].y + this._wallLine[1].y) / 2,
            }
            : null);
        this.groundZ = groundZ;
        this.targetTopZ = targetTopZ;
        this.segmentCount = segmentCount;
        this.risePerSegment = (targetTopZ - groundZ) / Math.max(1, segmentCount);
        this.platformHeight = targetTopZ;
        this.walkWidth = Number(config.walkWidth) || WALL_STAIR_CONFIG.walkWidth;
        this.stepCountPerSegment = Math.max(
            1,
            Number(config.stepCountPerSegment) || WALL_STAIR_CONFIG.stepCountPerSegment
        );

        const variant = getWallStairVariant(this.dir, this.ascendingSign);
        const lowerBaseTexture = variant?.lower?.texture || 'wall_stair_lower_e2_pos';
        this.spriteCfg = {
            idleKey: TechnologySystem.getWallStairTextureKey(lowerBaseTexture),
            size: Number(variant?.displayWidth) || WALL_STAIR_VISUAL.w,
            sizeH: Number(variant?.displayHeight) || WALL_STAIR_VISUAL.h,
            offsetX: 0,
            footOffsetY: 0,
        };
        this.footOffsetY = this.spriteCfg.footOffsetY;
        this.segments = Array.isArray(config.segments) && config.segments.length
            ? config.segments.map((segment, index) => ({
                index,
                x: Number(segment.x) || x,
                y: Number(segment.y) || y,
                baseZ: groundZ + index * this.risePerSegment,
                topZ: groundZ + (index + 1) * this.risePerSegment,
            }))
            : this._buildSegments(x, y);
        this.visualSegments = this._buildVisualSegments();
        this._initSegmentColliders();
        applyWallStairFootprint(this, this.dir);
        setupStructureDepth(this);
        this._registerEdgeSegs();
        this.rebuildCollider();
    }

    _axisStep() {
        const run = ONE_CELL_BUILDING_FOOT.w / Math.SQRT2;
        const local = this.dir === 'e1'
            ? isoLocalToWorldDelta(run * this.ascendingSign, 0)
            : isoLocalToWorldDelta(0, run * this.ascendingSign);
        return { x: local.x, y: local.y };
    }

    _buildSegments(x, y) {
        const step = this._axisStep();
        return Array.from({ length: this.segmentCount }, (_, index) => ({
            index,
            x: x + step.x * index,
            y: y + step.y * index,
            baseZ: this.groundZ + index * this.risePerSegment,
            topZ: this.groundZ + (index + 1) * this.risePerSegment,
        }));
    }

    _initSegmentColliders() {
        for (const segment of this.segments) {
            segment.parent = this;
            segment.active = true;
            segment.z = segment.baseZ;
            segment.elevation = 'ground';
            segment._isWallStairSegment = true;
            applyWallStairFootprint(segment, this.dir);
            segment.collider = Collider.fromEntity(segment);
            segment.collider.attach(segment);
            segment.collider.walkSurface = segment.walkSurface || null;
        }
        this.segmentColliders = this.segments.map((segment) => segment.collider);
    }

    _buildVisualSegments() {
        if (!Array.isArray(this.segments)) return [];
        const variant = getWallStairVariant(this.dir, this.ascendingSign);
        if (!variant) return [];
        const displayWidth = Number(variant.displayWidth) || WALL_STAIR_CONFIG.displayWidth;
        const displayHeight = Number(variant.displayHeight) || WALL_STAIR_CONFIG.displayHeight;
        const visuals = new Array(this.segments.length);
        for (let index = 0; index < this.segments.length; index++) {
            const segment = this.segments[index];
            const partName = index === this.segments.length - 1 ? 'upper' : 'lower';
            const part = variant[partName];
            const surface = wallStairAnchorOffset(variant, partName, 'surface');
            const entry = wallStairAnchorOffset(variant, partName, 'entry');
            const exit = wallStairAnchorOffset(variant, partName, 'exit');
            const walkEntryA = wallStairAnchorOffset(variant, partName, 'walkEntryA');
            const walkEntryB = wallStairAnchorOffset(variant, partName, 'walkEntryB');
            const walkExitA = wallStairAnchorOffset(variant, partName, 'walkExitA');
            const walkExitB = wallStairAnchorOffset(variant, partName, 'walkExitB');
            const surfaceZ = (segment.baseZ + segment.topZ) * 0.5;
            const center = {
                x: segment.x - surface.x,
                y: segment.y - surfaceZ - surface.y,
            };
            const groundPoint = (offset, z) => ({
                x: center.x + offset.x,
                // Blender锚点是最终屏幕像素（已含高度抬升）；移动几何使用地面世界坐标，
                // 因此把该锚点自身的z加回去。
                y: center.y + offset.y + z,
            });
            const walkSurface = {
                entryA: groundPoint(walkEntryA, segment.baseZ),
                entryB: groundPoint(walkEntryB, segment.baseZ),
                exitA: groundPoint(walkExitA, segment.topZ),
                exitB: groundPoint(walkExitB, segment.topZ),
            };
            walkSurface.entry = {
                x: (walkSurface.entryA.x + walkSurface.entryB.x) * 0.5,
                y: (walkSurface.entryA.y + walkSurface.entryB.y) * 0.5,
            };
            walkSurface.exit = {
                x: (walkSurface.exitA.x + walkSurface.exitB.x) * 0.5,
                y: (walkSurface.exitA.y + walkSurface.exitB.y) * 0.5,
            };
            segment.walkSurface = walkSurface;
            visuals[index] = {
                baseTexture: part?.texture,
                texture: TechnologySystem.getWallStairTextureKey(part?.texture),
                x: center.x,
                y: center.y,
                displayWidth,
                displayHeight,
                entry: { x: center.x + entry.x, y: center.y + entry.y },
                exit: { x: center.x + exit.x, y: center.y + exit.y },
                walkSurface,
            };
        }
        return visuals;
    }

    renderDepthForSegment(index = 0) {
        const wallDepth = Number.isFinite(this.wall?._structureRenderDepth)
            ? this.wall._structureRenderDepth
            : (Number.isFinite(this.wall?._faceDepth) ? this.wall._faceDepth : this.y + 12);
        // ascendingSign=1 的楼梯从屏幕左上/右上后侧接墙，应先画再由墙遮挡重叠部分；
        // ascendingSign=-1 位于屏幕左下/右下前侧，保持画在墙前。
        const sideBias = this.ascendingSign === 1 ? -0.2 : 0.2;
        return wallDepth + sideBias + index * 0.01;
    }

    /** 驻梯单位必须高于整座楼梯所有实际Sprite，而不只是脚下分段。 */
    unitRenderDepth() {
        const logicalMax = this.segments.reduce(
            (maxDepth, _segment, index) => Math.max(maxDepth, this.renderDepthForSegment(index)),
            -Infinity
        );
        const actualDepth = Number.isFinite(this._actualMaxRenderDepth)
            ? this._actualMaxRenderDepth
            : -Infinity;
        return Math.max(logicalMax, actualDepth);
    }

    /** 销毁整组楼梯并清除侧边阻挡。 */
    destroy() {
        this._unregisterEdgeSegs();
        for (const segment of this.segments || []) segment.active = false;
        if (DefenseSystem && DefenseSystem.staircases) {
            const i = DefenseSystem.staircases.indexOf(this);
            if (i >= 0) DefenseSystem.staircases.splice(i, 1);
        }
        this.active = false;
        DefenseSystem?.invalidateElevatedTopology?.();
        rebuildWallStairGroups(DefenseSystem?.staircases);
    }

    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡由 onDeath 接管（避免默认 active=false + 血雾，保持精灵下沉）
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 楼梯沉陷死亡：整组精灵由 BuildingSinkEffect/渲染层统一清除。 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._unregisterEdgeSegs();
        for (const segment of this.segments || []) segment.active = false;
        if (DefenseSystem && DefenseSystem.staircases) {
            const i = DefenseSystem.staircases.indexOf(this);
            if (i >= 0) DefenseSystem.staircases.splice(i, 1);
        }
        DefenseSystem?.invalidateElevatedTopology?.();
        rebuildWallStairGroups(DefenseSystem?.staircases);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '城墙楼梯被摧毁', '#ff8855'));
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 每段两侧注册薄阻挡，入口与顶端保持开放。 */
    _registerEdgeSegs() {
        if (!WallSystem || !WallSystem.isoSegments) return;
        this._edgeSegs = [];
        const connector = this.wallConnectorSurface();
        for (let index = 0; index < this.segments.length; index++) {
            const segment = this.segments[index];
            const surface = this.visualSegments[index]?.walkSurface || segment.walkSurface;
            if (!surface) continue;
            // 阻挡线直接使用Blender踏步左右边缘，入口、段间接口和墙顶端保持开放。
            const rails = [
                [surface.entryA, surface.exitA],
                [surface.entryB, surface.exitB],
            ];
            for (let sideIndex = 0; sideIndex < rails.length; sideIndex++) {
                const [p1, p2] = rails[sideIndex];
                if (this._isSharedStairRail(p1, p2)) continue;
                let railStart = p1;
                let railStartT = 0;
                if (index === 0 && WALL_STAIR_CONFIG.entryRailInset > 0) {
                    const railDx = p2.x - p1.x;
                    const railDy = p2.y - p1.y;
                    const railLength = Math.hypot(railDx, railDy);
                    if (railLength > 1e-6) {
                        const inset = Math.min(
                            WALL_STAIR_CONFIG.entryRailInset,
                            railLength * 0.45
                        );
                        railStartT = inset / railLength;
                        railStart = {
                            x: p1.x + railDx / railLength * inset,
                            y: p1.y + railDy / railLength * inset,
                        };
                    }
                }
                const s = {
                    x1: railStart.x,
                    y1: railStart.y,
                    x2: p2.x,
                    y2: p2.y,
                    halfThick: WALL_STAIR_CONFIG.edgeHalfThick,
                    _surfaceZ1: segment.baseZ
                        + (segment.topZ - segment.baseZ) * railStartT,
                    _surfaceZ2: segment.topZ,
                    _surfaceSegmentIndex: index,
                    _surfaceSide: sideIndex === 0 ? 'A' : 'B',
                    _stairEdge: true,
                    _owner: this,
                };
                WallSystem.isoSegments.push(s);
                this._edgeSegs.push(s);
            }
        }
        if (connector) {
            for (let railIndex = 0; railIndex < connector.sideRails.length; railIndex++) {
                const [sourceP1, sourceP2] = connector.sideRails[railIndex];
                if (this._isSharedStairRail(sourceP1, sourceP2)) continue;
                const collisionRail = connector.collisionSideRails?.[railIndex];
                if (!collisionRail) continue;
                const [p1, p2] = collisionRail;
                const edge = {
                    x1: p1.x,
                    y1: p1.y,
                    x2: p2.x,
                    y2: p2.y,
                    halfThick: WALL_STAIR_CONFIG.edgeHalfThick,
                    _surfaceZ1: this.targetTopZ,
                    _surfaceZ2: this.targetTopZ,
                    _surfaceConnectorEdge: true,
                    _stairEdge: true,
                    _owner: this,
                };
                WallSystem.isoSegments.push(edge);
                this._edgeSegs.push(edge);
            }
        }
        if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
            const xs = this.segments.map((segment) => segment.x);
            const ys = this.segments.map((segment) => segment.y);
            pathFinder.invalidateRegion(
                Math.min(...xs) - 100, Math.min(...ys) - 100,
                Math.max(...xs) + 100, Math.max(...ys) + 100);
        }
    }

    _isSharedStairRail(p1, p2) {
        return (this._sharedRailSegments || []).some((rail) =>
            wallStairGroupRegistry.railDistance([p1, p2], rail) <= 0.5);
    }

    /** 移除台面边缘阻挡段（销毁/死亡时调用，防幽灵段残留） */
    _unregisterEdgeSegs() {
        if (!this._edgeSegs || !WallSystem || !WallSystem.isoSegments) return;
        for (const s of this._edgeSegs) {
            const i = WallSystem.isoSegments.indexOf(s);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
        }
        this._edgeSegs = [];
    }

    /** 把地面世界点换算到Blender导出的踏步四边形坐标。 */
    _walkSurfaceCoordinates(surface, x, y) {
        if (!surface) return null;
        const origin = surface.entryB;
        const runX = surface.exitB.x - origin.x;
        const runY = surface.exitB.y - origin.y;
        const widthX = surface.entryA.x - origin.x;
        const widthY = surface.entryA.y - origin.y;
        const dx = x - origin.x;
        const dy = y - origin.y;
        const det = runX * widthY - runY * widthX;
        if (Math.abs(det) <= 1e-8) return null;
        const progress = (dx * widthY - dy * widthX) / det;
        const across = (runX * dy - runY * dx) / det;
        // 小容差只用于消除相邻段共享边的浮点裂缝，不扩大实际可走范围。
        const epsilon = 1e-4;
        if (progress < -epsilon || progress > 1 + epsilon
            || across < -epsilon || across > 1 + epsilon) return null;
        return {
            progress: Math.max(0, Math.min(1, progress)),
            across: Math.max(0, Math.min(1, across)),
        };
    }

    _sharedStairSurfaceAt(ux, uy, unit = null) {
        for (const seam of this._sharedStairSurfaces || []) {
            if (!pointInIsoFootprint(
                ux,
                uy,
                seam.footprint,
                WALL_STAIR_CONFIG.groupSeamMargin
            )) continue;
            const run = worldDeltaToIsoLocal(
                seam.exit.x - seam.entry.x,
                seam.exit.y - seam.entry.y
            );
            const point = worldDeltaToIsoLocal(ux - seam.entry.x, uy - seam.entry.y);
            const runLengthSq = run.u * run.u + run.v * run.v;
            const progress = runLengthSq > 1e-9
                ? Math.max(0, Math.min(1, (point.u * run.u + point.v * run.v) / runLengthSq))
                : 0;
            const staircase = unit?._surfaceStaircase === seam.stairB ? seam.stairB : seam.stairA;
            const other = staircase === seam.stairA ? seam.stairB : seam.stairA;
            let z;
            let segment = null;
            let stepIndex = this.stepCountPerSegment;
            if (seam.connector) {
                z = Math.max(seam.stairA.targetTopZ, seam.stairB.targetTopZ);
                if (unit) {
                    const currentZ = Number(unit.z) || 0;
                    if (currentZ < z - 2) continue;
                    const supportedByWall = [seam.stairA.wall, seam.stairB.wall]
                        .filter(Boolean)
                        .some((wall) => blockWallFootprintSupportAt(
                            unit,
                            ux,
                            uy,
                            Game?.entities,
                            wall
                        ));
                    if (supportedByWall) continue;
                }
                segment = staircase.segments[staircase.segments.length - 1];
            } else {
                segment = staircase.segments[seam.segmentIndex];
                if (!segment) continue;
                const atGroupTop = seam.segmentIndex === staircase.segments.length - 1
                    && unit?._surfaceKind === 'stairs'
                    && (Number(unit.z) || 0) >= staircase.targetTopZ - 2;
                if (atGroupTop) {
                    const supportedByWall = (staircase._wallStairGroupMembers || [staircase])
                        .map((member) => member?.wall)
                        .filter(Boolean)
                        .some((wall) => blockWallFootprintSupportAt(
                            unit,
                            ux,
                            uy,
                            Game?.entities,
                            wall
                        ));
                    if (supportedByWall) continue;
                }
                const steps = staircase.stepCountPerSegment;
                stepIndex = Math.min(steps, Math.floor(progress * steps) + 1);
                z = segment.baseZ + (segment.topZ - segment.baseZ) * stepIndex / steps;
            }
            return {
                kind: 'stairs',
                z,
                owner: staircase,
                staircase,
                stairGroupId: wallStairGroupId(staircase),
                stairGroupMembers: staircase._wallStairGroupMembers || [staircase],
                wall: staircase.wall,
                walls: Array.from(new Set([
                    ...staircase.connectedWalls(),
                    ...other.connectedWalls(),
                ])),
                segment,
                connector: !!seam.connector,
                sharedSeam: true,
                sharedSeamRef: seam,
                progress,
                across: 0.5,
                stepIndex,
                renderDepth: Math.max(
                    seam.stairA.unitRenderDepth(),
                    seam.stairB.unitRenderDepth()
                ),
            };
        }
        return null;
    }

    /** 楼梯顶边到墙顶真实多边形之间的实体连接面，消除两个独立贴图几何之间的空档。 */
    wallConnectorSurface() {
        const topVisual = this.visualSegments?.[this.visualSegments.length - 1];
        const stairExit = topVisual?.walkSurface;
        const wallGeometry = blockWallTopWalkGeometry(this.wall);
        if (!stairExit || !wallGeometry) return null;
        const cacheKey = [
            'wall-portal-quad-v6',
            stairExit.entryA.x,
            stairExit.entryA.y,
            stairExit.entryB.x,
            stairExit.entryB.y,
            stairExit.exitA.x,
            stairExit.exitA.y,
            stairExit.exitB.x,
            stairExit.exitB.y,
            WALL_STAIR_CONFIG.handoffStairOverlap,
            WALL_STAIR_CONFIG.connectorRailWallClearance,
            wallGeometry.cacheKey,
        ].join(':');
        if (this._wallConnectorSurface?.cacheKey === cacheKey) {
            return this._wallConnectorSurface;
        }
        const stairExitMid = {
            x: (stairExit.exitA.x + stairExit.exitB.x) * 0.5,
            y: (stairExit.exitA.y + stairExit.exitB.y) * 0.5,
        };
        // 墙梯口只能落在正对楼梯的同一条墙顶边上。若分别扫描整块菱形的四条边，
        // 入口恰好靠近墙角时，两根侧轨可能命中不同边，既生成不了平行护栏，也会留下
        // 可滑出承托面的角缝。
        const portalWallEdge = _edgeFacingPoint(wallGeometry.vertices, stairExitMid);
        if (!portalWallEdge) return null;
        // 目标边保持楼梯顶边宽度，并以墙顶安全中心为中点。
        const exitA = {
            key: 'targetA',
            x: wallGeometry.center.x + (stairExit.exitA.x - stairExitMid.x),
            y: wallGeometry.center.y + (stairExit.exitA.y - stairExitMid.y),
        };
        const exitB = {
            key: 'targetB',
            x: wallGeometry.center.x + (stairExit.exitB.x - stairExitMid.x),
            y: wallGeometry.center.y + (stairExit.exitB.y - stairExitMid.y),
        };
        const extendTowardStairs = (topPoint, lowerPoint) => {
            const dx = lowerPoint.x - topPoint.x;
            const dy = lowerPoint.y - topPoint.y;
            const length = Math.hypot(dx, dy);
            if (length <= 1e-6) return { ...topPoint };
            const overlap = Math.min(
                WALL_STAIR_CONFIG.handoffStairOverlap,
                length * 0.35
            );
            return {
                x: topPoint.x + dx / length * overlap,
                y: topPoint.y + dy / length * overlap,
            };
        };
        const portalEntryA = extendTowardStairs(stairExit.exitA, stairExit.entryA);
        const portalEntryB = extendTowardStairs(stairExit.exitB, stairExit.entryB);
        const portalEntry = {
            x: (portalEntryA.x + portalEntryB.x) * 0.5,
            y: (portalEntryA.y + portalEntryB.y) * 0.5,
        };
        // 接口从墙顶安全边向楼梯顶段内重叠少量距离，让最后一级踏步与墙顶切换区
        // 没有单帧精度缝；高亮和实际判定继续共用这一个四边形。
        const sourcePoints = [
            { key: 'portalEntryA', ...portalEntryA },
            { key: 'portalEntryB', ...portalEntryB },
            exitA,
            exitB,
        ];
        const hull = _convexHull(sourcePoints);
        const footprint = {
            x: 0,
            y: 0,
            _pixelFootprintLocal: hull,
        };
        const entryKeys = new Set(['portalEntryA', 'portalEntryB']);
        const targetKeys = new Set(['targetA', 'targetB']);
        const sideRails = [];
        for (let index = 0; index < hull.length; index++) {
            const a = hull[index];
            const b = hull[(index + 1) % hull.length];
            if ((entryKeys.has(a.key) && entryKeys.has(b.key))
                || (targetKeys.has(a.key) && targetKeys.has(b.key))) continue;
            sideRails.push([a, b]);
        }
        const collisionRailDetails = sideRails.map(([first, second]) => {
            // 导航连接面需要深入墙顶安全区，但真实侧轨只能存在于楼梯口到墙顶边界之间。
            // 按墙顶多边形求首次交点，避免红色碰撞线横穿墙面。
            const outside = entryKeys.has(first.key) ? first : second;
            const inside = outside === first ? second : first;
            const rx = inside.x - outside.x;
            const ry = inside.y - outside.y;
            const railLength = Math.hypot(rx, ry);
            if (railLength <= 1e-6) return null;
            const wallA = portalWallEdge.a;
            const wallB = portalWallEdge.b;
            const sx = wallB.x - wallA.x;
            const sy = wallB.y - wallA.y;
            const denominator = rx * sy - ry * sx;
            if (Math.abs(denominator) <= 1e-8) return null;
            const qx = wallA.x - outside.x;
            const qy = wallA.y - outside.y;
            const t = (qx * sy - qy * sx) / denominator;
            const u = (qx * ry - qy * rx) / denominator;
            if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
            const boundaryT = Math.max(0, Math.min(1, t));
            const clearanceT = WALL_STAIR_CONFIG.connectorRailWallClearance / railLength;
            const endT = Math.max(0, boundaryT - clearanceT);
            if (endT * railLength <= 0.05) return null;
            return {
                rail: [
                    outside,
                    {
                        x: outside.x + rx * endT,
                        y: outside.y + ry * endT,
                    },
                ],
            };
        });
        const collisionSideRails = collisionRailDetails.map((detail) => detail?.rail || null);
        this._wallConnectorSurface = {
            cacheKey,
            footprint,
            hull,
            sideRails,
            collisionSideRails,
            wallEdgeIndex: portalWallEdge.index,
            entryA: portalEntryA,
            entryB: portalEntryB,
            exitA,
            exitB,
            entry: portalEntry,
            exit: {
                x: (exitA.x + exitB.x) * 0.5,
                y: (exitA.y + exitB.y) * 0.5,
            },
        };
        return this._wallConnectorSurface;
    }

    /** 返回脚下楼梯表面；可走四边形与九级踏步均直接来自当前Blender资产。 */
    /**
     * 墙顶下楼时，在单位中心真正进入楼梯四边形前提前接管导航身份。
     * 捕获带只覆盖墙—楼梯接口，不扩大楼梯自身的可行走贴图。
     */
    navigationBridgeAt(ux, uy, unit = null) {
        const enteringFromWall = unit?._surfaceKind === 'wall_walk';
        const continuingBridge = unit?._surfaceKind === 'stairs'
            && (unit?._surfaceStaircase === this
                || wallStairsShareGroup(unit?._surfaceStaircase, this))
            && unit?._elevatedNavigationPatch === 'wall-stair-bridge';
        if (!enteringFromWall && !continuingBridge) return null;
        const connector = this.wallConnectorSurface();
        const wallGeometry = blockWallTopWalkGeometry(this.wall);
        const movementIntent = unit?._surfaceMoveChosenAxis
            || unit?._surfaceInputIntent
            || null;
        if (!connector || !wallGeometry) return null;
        const wallSupport = blockWallFootprintSupportAt(
            unit,
            ux,
            uy,
            Game?.entities,
            this.wall
        );
        // 只有脚底仍由墙顶承托时才允许开启提前桥接，避免墙状态残留抢占低段楼梯。
        if (enteringFromWall && !wallSupport) return null;

        const portalDx = connector.entry.x - wallGeometry.center.x;
        const portalDy = connector.entry.y - wallGeometry.center.y;
        const portalLength = Math.hypot(portalDx, portalDy);
        if (portalLength <= 1e-6) return null;
        const intentLength = movementIntent
            ? Math.hypot(movementIntent.x, movementIntent.y)
            : 0;
        const alignment = intentLength > 1e-6
            ? (
                portalDx * movementIntent.x + portalDy * movementIntent.y
            ) / (portalLength * intentLength)
            : null;
        const queryMotion = unit?._surfaceQueryMotionIntent;
        const safeX = Number(unit?._elevatedState?.lastValidated?.x);
        const safeY = Number(unit?._elevatedState?.lastValidated?.y);
        const motionDx = Number.isFinite(queryMotion?.x)
            ? queryMotion.x
            : (Number.isFinite(safeX) ? ux - safeX : 0);
        const motionDy = Number.isFinite(queryMotion?.y)
            ? queryMotion.y
            : (Number.isFinite(safeY) ? uy - safeY : 0);
        const motionLength = Math.hypot(motionDx, motionDy);
        const motionAlignment = motionLength > 0.05
            ? (portalDx * motionDx + portalDy * motionDy) / (portalLength * motionLength)
            : null;
        if (enteringFromWall) {
            const requiredAlignment = Math.max(
                0.05,
                Number(WALL_WALK_CONFIG.surfaceNavigation.portalDirectionMinAlignment) || 0.15
            );
            const requiredMotionAlignment = Math.max(
                0.01,
                Number(WALL_WALK_CONFIG.surfaceNavigation.portalMotionMinAlignment) || 0.05
            );
            if (Number.isFinite(safeX) && Number.isFinite(safeY)) {
                const previousWallDistance = Math.hypot(
                    safeX - wallGeometry.center.x,
                    safeY - wallGeometry.center.y
                );
                const currentWallDistance = Math.hypot(
                    ux - wallGeometry.center.x,
                    uy - wallGeometry.center.y
                );
                if (currentWallDistance <= previousWallDistance + 0.05) return null;
            }
            if (motionAlignment !== null
                && motionAlignment < requiredMotionAlignment) return null;
            if (alignment === null || alignment < requiredAlignment) return null;
        } else if (wallSupport
            && motionAlignment !== null
            && motionAlignment < -Math.max(
                0.01,
                Number(WALL_WALK_CONFIG.surfaceNavigation.portalMotionMinAlignment) || 0.05
            )) {
            // 实际位移已回到墙顶时，优先相信位移方向，忽略上一帧残留的下楼输入。
            return null;
        } else if (alignment !== null && alignment < -Math.max(
            0.05,
            Number(WALL_WALK_CONFIG.surfaceNavigation.portalDirectionMinAlignment) || 0.15
        )) {
            // 已进入捕获带后，停止输入可原地保持；明确反向时立即把控制权还给墙顶。
            return null;
        }
        if (continuingBridge && alignment === null && wallSupport) {
            // 无输入的楼梯→墙顶采样在进入安全墙面后立即交回墙顶，不能被捕获带永久黏住。
            return null;
        }

        const captureDistance = distanceToIsoFootprint(ux, uy, connector.footprint);
        if (captureDistance > WALL_STAIR_CONFIG.handoffCaptureMargin) return null;
        const topSegment = this.segments[this.segments.length - 1];
        if (!topSegment) return null;
        return {
            kind: 'stairs',
            z: this.targetTopZ,
            owner: this,
            staircase: this,
            wall: this.wall,
            walls: this.connectedWalls(),
            segment: topSegment,
            connector: true,
            handoffDown: true,
            captureBridge: true,
            progress: 1,
            across: 0.5,
            stepIndex: this.stepCountPerSegment,
            distance: captureDistance,
            renderDepth: this.unitRenderDepth(),
        };
    }

    surfaceAt(ux, uy, unit = null) {
        const connectorSurface = () => {
            const connector = this.wallConnectorSurface();
            if (!connector || !pointInIsoFootprint(ux, uy, connector.footprint, 2)) return null;
            if (unit?._surfaceKind === 'stairs'
                && (Number(unit.z) || 0) < this.targetTopZ - 2) {
                // 2.5D 投影会让低层踏步与顶层接口重叠；未到顶的单位不能被接口抬升。
                return null;
            }
            const radius = Math.max(
                0,
                Number(unit?.groundRadius)
                    || Number(unit?.collisionRadius)
                    || WALL_WALK_CONFIG.maxUnitRadius
            );
            if (radius > WALL_WALK_CONFIG.maxUnitRadius + 1e-6) return null;
            const run = worldDeltaToIsoLocal(
                connector.exit.x - connector.entry.x,
                connector.exit.y - connector.entry.y
            );
            const point = worldDeltaToIsoLocal(
                ux - connector.entry.x,
                uy - connector.entry.y
            );
            const runLengthSq = run.u * run.u + run.v * run.v;
            const runLength = Math.sqrt(runLengthSq);
            const progress = runLengthSq > 1e-9
                ? (point.u * run.u + point.v * run.v) / runLengthSq
                : 0;
            const crossDistance = runLength > 1e-9
                ? Math.abs(point.u * run.v - point.v * run.u) / runLength
                : Infinity;
            const centerHalfWidth = Math.max(
                2,
                // 楼梯侧边WallSystem已经按单位groundRadius阻挡中心，surface层只校验
                // 中心是否仍在可见通道内；再次减radius会把80px通道压成玩家仅19px。
                this.walkWidth / 2 - WALL_STAIR_CONFIG.edgeHalfThick
            );
            if (progress < -1e-4 || progress > 1 + 1e-4
                || crossDistance > centerHalfWidth) return null;
            if (unit && blockWallFootprintSupportAt(
                unit,
                ux,
                uy,
                Game?.entities,
                this.wall
            )) {
                // 完整脚底已经进入墙顶安全区，交给wall_walk接管。
                return null;
            }
            const topSegment = this.segments[this.segments.length - 1];
            return {
                kind: 'stairs',
                z: this.targetTopZ,
                owner: this,
                staircase: this,
                wall: this.wall,
                walls: this.connectedWalls(),
                segment: topSegment,
                connector: true,
                progress: 1,
                across: 0.5,
                stepIndex: this.stepCountPerSegment,
                renderDepth: this.unitRenderDepth(),
            };
        };
        // 墙顶单位只能通过专用连接通道下楼，禁止被与墙重叠的上段踏步误吸附。
        if (unit?._surfaceKind === 'wall_walk') {
            const connector = this.wallConnectorSurface();
            const wallGeometry = blockWallTopWalkGeometry(this.wall);
            const chosenAxis = unit?._surfaceMoveChosenAxis;
            const movementIntent = chosenAxis
                || unit?._surfaceInputIntent
                || null;
            if (!connector || !wallGeometry || !movementIntent) return null;
            const portalDx = connector.entry.x - wallGeometry.center.x;
            const portalDy = connector.entry.y - wallGeometry.center.y;
            const portalLength = Math.hypot(portalDx, portalDy);
            const chosenLength = Math.hypot(movementIntent.x, movementIntent.y);
            if (portalLength <= 1e-6 || chosenLength <= 1e-6) return null;
            const alignment = (
                portalDx * movementIntent.x + portalDy * movementIntent.y
            ) / (portalLength * chosenLength);
            // graph模式要求明确选中Portal轴；surface模式按真实输入走入连接面，
            // 只需确认输入总体朝向楼梯，墙顶联合承托仍会阻止过早切换。
            const requiredAlignment = Math.max(
                0.05,
                Number(WALL_WALK_CONFIG.surfaceNavigation.portalDirectionMinAlignment) || 0.15
            );
            if (alignment < requiredAlignment) return null;
            const queryMotion = unit?._surfaceQueryMotionIntent;
            const safeX = Number(unit?._elevatedState?.lastValidated?.x);
            const safeY = Number(unit?._elevatedState?.lastValidated?.y);
            const motionDx = Number.isFinite(queryMotion?.x)
                ? queryMotion.x
                : (Number.isFinite(safeX) ? ux - safeX : 0);
            const motionDy = Number.isFinite(queryMotion?.y)
                ? queryMotion.y
                : (Number.isFinite(safeY) ? uy - safeY : 0);
            const motionLength = Math.hypot(motionDx, motionDy);
            const wallSupport = blockWallFootprintSupportAt(
                unit,
                ux,
                uy,
                Game?.entities,
                this.wall
            );
            if (wallSupport && Number.isFinite(safeX) && Number.isFinite(safeY)) {
                const previousWallDistance = Math.hypot(
                    safeX - wallGeometry.center.x,
                    safeY - wallGeometry.center.y
                );
                const currentWallDistance = Math.hypot(
                    ux - wallGeometry.center.x,
                    uy - wallGeometry.center.y
                );
                if (currentWallDistance <= previousWallDistance + 0.05) return null;
            }
            if (motionLength > 0.05) {
                const motionAlignment = (
                    portalDx * motionDx + portalDy * motionDy
                ) / (portalLength * motionLength);
                const requiredMotionAlignment = Math.max(
                    0.01,
                    Number(WALL_WALK_CONFIG.surfaceNavigation.portalMotionMinAlignment) || 0.05
                );
                if (motionAlignment < requiredMotionAlignment) return null;
            }
            const connectorCandidate = connectorSurface();
            if (connectorCandidate) return connectorCandidate;
            const topIndex = this.segments.length - 1;
            const topSegment = this.segments[topIndex];
            const topWalkSurface = this.visualSegments[topIndex]?.walkSurface
                || topSegment?.walkSurface;
            const topCoords = this._walkSurfaceCoordinates(topWalkSurface, ux, uy);
            if (!topSegment
                || !topCoords
                || topCoords.progress < WALL_STAIR_CONFIG.handoffTopProgress) return null;
            return {
                kind: 'stairs',
                z: this.targetTopZ,
                owner: this,
                staircase: this,
                wall: this.wall,
                walls: this.connectedWalls(),
                segment: topSegment,
                handoffDown: true,
                progress: topCoords.progress,
                across: topCoords.across,
                stepIndex: this.stepCountPerSegment,
                renderDepth: this.unitRenderDepth(),
            };
        }
        for (let index = 0; index < this.segments.length; index++) {
            const segment = this.segments[index];
            const walkSurface = this.visualSegments[index]?.walkSurface || segment.walkSurface;
            const coords = this._walkSurfaceCoordinates(walkSurface, ux, uy);
            if (!coords) continue;
            const atGroupTop = index === this.segments.length - 1
                && unit?._surfaceKind === 'stairs'
                && (Number(unit.z) || 0) >= this.targetTopZ - 2;
            if (atGroupTop) {
                const supportedByWall = (this._wallStairGroupMembers || [this])
                    .map((member) => member?.wall)
                    .filter(Boolean)
                    .some((wall) => blockWallFootprintSupportAt(
                        unit,
                        ux,
                        uy,
                        Game?.entities,
                        wall
                    ));
                if (supportedByWall) continue;
            }
            const steps = this.stepCountPerSegment;
            const stepIndex = Math.min(steps, Math.floor(coords.progress * steps) + 1);
            const segmentRise = segment.topZ - segment.baseZ;
            return {
                kind: 'stairs',
                z: segment.baseZ + segmentRise * stepIndex / steps,
                owner: this,
                staircase: this,
                wall: this.wall,
                walls: this.connectedWalls(),
                segment,
                progress: coords.progress,
                across: coords.across,
                stepIndex,
                renderDepth: this.unitRenderDepth(),
            };
        }
        const sharedSurface = this._sharedStairSurfaceAt(ux, uy, unit);
        if (sharedSurface) return sharedSurface;
        return connectorSurface();
    }

    /** RTS/AI只走Blender踏步中心线：底部入口一次 + 每段顶端一次。 */
    routePoints(target = null, targetSegmentIndex = null) {
        const points = [];
        const first = this.visualSegments[0]?.walkSurface;
        const groundPortal = this.groundPortal();
        const routeGroundPoint = groundPortal
            ? stairGroupGroundPoint(
                this,
                groundPortal.entry,
                Math.max(
                    8,
                    Number(WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius) || 14
                )
            )
            : null;
        if (first && routeGroundPoint) {
            points.push({
                x: routeGroundPoint.x,
                y: routeGroundPoint.y,
                z: this.segments[0]?.baseZ || 0,
                // 地面节点必须位于楼梯边界外；上楼和下楼都会真实穿过同一个Portal，
                // 不能停在surfaceAt仍返回第一级踏步的entry边界上。
                surfaceKind: 'ground',
                staircaseId: this.id,
                stairGroupId: wallStairGroupId(this),
                portalKind: 'ground',
            });
        }
        for (let index = 0; index < this.segments.length; index++) {
            if (Number.isInteger(targetSegmentIndex) && index >= targetSegmentIndex) break;
            const segment = this.segments[index];
            const surface = this.visualSegments[index]?.walkSurface;
            if (!surface) continue;
            points.push({
                x: surface.exit.x,
                y: surface.exit.y,
                z: segment.topZ,
                surfaceKind: 'stairs',
                staircaseId: this.id,
                stairGroupId: wallStairGroupId(this),
                transition: index === 0 ? 'ground_to_stairs' : 'stair_traverse',
            });
        }
        if (target) points.push({
            ...target,
            stairGroupId: target.stairGroupId || wallStairGroupId(this),
        });
        return points;
    }

    /** 楼梯底部唯一的地面转换门户，几何完全来自首段walkSurface。 */
    groundPortal() {
        return stairGroundPortal(
            this,
            Math.max(8, Number(WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius) || 14)
        );
    }

    connectedWalls() {
        return liveWallsForStaircase(this, Game?.entities);
    }

    /** 顶段中心世界坐标。 */
    topCenter() {
        const top = this.segments[this.segments.length - 1];
        return top ? { x: top.x, y: top.y, z: top.topZ } : { x: this.x, y: this.y, z: this.targetTopZ };
    }
}

class BuildableGate extends Combatant {
    constructor(x, y, config = {}) {
        const grade = config.grade || 'D';
        const orient = config.orient || 'v';
        const mirror = !!config.mirror;
        const eff = mirror ? (orient === 'v' ? 'h' : 'v') : orient;
        const hp = config.hp ?? (DEFENSE_CONFIG.covers.hp[grade] ?? 400);
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: config.size ?? 60,
            collisionRadius: 26,
            name: config.name || `铁栅栏门·${grade}级`,
        });
        this.id = config.id || `defense_gate_${grade}_${Math.random().toString(36).slice(2, 7)}`;
        this._isDefenseStructure = true;
        this._isCoverGate = true;
        this._isGate4 = !!config.isGate4;
        this._dormantBand = true; // 2026-08-19：静态结构进休眠带（感应开门 15Hz 粒度足够）
        this.noSeparation = true;
        // 门不参与实体分离（resolveCollisions 的 rect 分支）：门的阻挡/放行完全由
        // _gateSeg 面线段承担（关门注册/开门移除）。若保留 198×133 的实体矩形碰撞，
        // 开门时玩家站在门洞内会被该矩形沿长轴持续横向推出（≈21.5px/帧）——被推到
        // 门柱/墙边卡住，门一开又被"释放"穿过门洞 = 用户反馈的"卡柱 + 开门瞬移"。
        // noCollision 只跳过实体间分离，墙段碰撞（WallSystem.isoSegments）不受影响。
        this.noCollision = true;
        this.noNameLabel = true;
        this._noShadow = true;   // 障碍物取消脚底阴影
        this.immovable = true;   // 不可被击退/位移
        this.def = 0;
        this.mdef = 0;
        this.data.def = 0;
        this.data.mdef = 0;
        this.grade = grade;
        this.orient = orient;
        this._facingLeft = mirror;
        const cfg = gateConfigFor(grade);
        this._cfg = cfg;
        // 4 格门（2026-08-17）：barCells=栅栏跨格数（2），barsOnly=石柱由方块墙承担
        const barCells = config.barCells || 1;
        const barsOnly = !!config.barsOnly;
        this._barCells = barCells;
        this._barsOnly = barsOnly;
        // face 线（与掩体墙同斜率/同接地偏移，跨度 = 门洞宽）
        // 1 格 = 64×32；栅栏跨 barCells 格 → 水平半跨 = 32×barCells（2 格 → 64）
        const half = barCells === 1 ? cfg.worldFaceLen / 2 : 32 * barCells;
        // 4 格门（barCells>1）锚点就是中间两格栅栏 footprint 的中心；
        // 旧实现额外 +32 把碰撞整体压到下一条地面线，导致转角门/邻接墙误判重叠。
        const midY = barCells > 1 ? y : y - 65;
        if (eff === 'v') {
            this._faceLine = [
                { x: x - half, y: midY + half * 0.5 },
                { x: x + half, y: midY - half * 0.5 },
            ];
        } else {
            this._faceLine = [
                { x: x - half, y: midY - half * 0.5 },
                { x: x + half, y: midY + half * 0.5 },
            ];
        }
        this._faceDepth = structureDepthAtY(Math.max(this._faceLine[0].y, this._faceLine[1].y));
        this._coverHalfThick = cfg.halfThick;
        // 4格门中段精确占 2×1 地面格：沿门轴2格、垂直门轴1格。
        // 旧1格门仍保留按实际墙厚的窄长 footprint。
        const footprintHalfThick = barCells > 1
            ? ONE_CELL_BUILDING_FOOT.w / (2 * Math.SQRT2)
            : cfg.halfThick;
        applyIsoFootprintFromSegment(this, this._faceLine[0], this._faceLine[1], footprintHalfThick);
        // 门洞碰撞段：默认关闭 → 注册阻挡；开门放行
        this._gateSeg = {
            x1: this._faceLine[0].x, y1: this._faceLine[0].y,
            x2: this._faceLine[1].x, y2: this._faceLine[1].y,
            halfThick: cfg.halfThick,
            _gate: true, _gateHole: true,
            _opensForFriendly: true, _gateOwner: this,
        };
        // [GATE-DETECT-FIX 2026-08-16] 与基地门同口径：感应中心 = 门洞物理中心，
        // 非精灵中心 _spriteCx/_spriteCy（等距偏移使门外单位够不到检测半径）
        this._detectX = (this._gateSeg.x1 + this._gateSeg.x2) / 2;
        this._detectY = (this._gateSeg.y1 + this._gateSeg.y2) / 2;
        if (WallSystem && WallSystem.isoSegments) WallSystem.isoSegments.push(this._gateSeg);
        // 裁剪与门共线/重叠的掩体碰撞段（贴柱走位不被掩体段截停）
        trimCoverSegsForGate(this, this._faceLine[0], this._faceLine[1]);
        this.state = 'closed';
        this._frame = 0;
        this._closeTimer = 0;
        // 门模式（2026-08-15 建筑面板按钮）：'auto' 友军靠近自动开关（默认）；
        // 'locked' 常锁——任何单位经过都不开；'open' 常开——门口保持敞开
        this.gateMode = 'auto';
        this._initGateSprite(cfg);
        if (this._isGate4) applyResearchHp(this, hp);
        this.rebuildCollider();
    }

    _initGateSprite(cfg) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !scene.textures.exists(cfg.tex)) return;
        // 4 格门：栅栏跨 2 格（143px ≈ 293tex crop × 0.488），石柱由方块墙承担
        // 2026-08-17 三修：宽 = 两柱间开口 128px（293tex×0.437），
        // 高 = 匹配石柱（内容 389tex×0.5 ≈ 195px），非等比缩放
        const kx = this._barsOnly ? GATE4_VISUAL.scaleX : cfg.displayScale;
        const ky = this._barsOnly ? GATE4_VISUAL.scaleY : cfg.displayScale;
        const midTexX = (cfg.faceA.x + cfg.faceB.x) / 2;
        const midTexY = (cfg.faceA.y + cfg.faceB.y) / 2;
        this._spriteCx = this._barsOnly
            ? this.x
            : (this._faceLine[0].x + this._faceLine[1].x) / 2 - (midTexX - cfg.cellW / 2) * kx;
        this._spriteCy = this._barsOnly
            ? this.y - GATE4_VISUAL.footOffsetY
            : (this._faceLine[0].y + this._faceLine[1].y) / 2 - (midTexY - cfg.cellH / 2) * ky;
        // 2026-08-17 二修：GameScene 每帧用 footOffsetY 重定位 _phaserSprite（栅栏），
        // 旧 1 格门靠 displayHeight/2 兜底巧合对齐；宽门（k=0.488）兜底错位 →
        // 显式设置 footOffsetY = y − _spriteCy，让栅栏精灵落在接地线（贴地）。
        // 4格门视觉仍复用已验收的柱/栅栏贴图标定；逻辑碰撞中心独立回归门锚点。
        this.footOffsetY = this._barsOnly ? GATE4_VISUAL.footOffsetY : Math.round(this.y - this._spriteCy);
        // 三段深度精灵（与基地门同图层设计，2026-08-15）：
        // 左柱=深端、右柱=浅端、栅栏=中点，各自按底边线锚定，前实体不再被右柱整体遮挡
        const A = this._faceLine[0];
        const B = this._faceLine[1];
        this._depthL = structureDepthAtY(A.y);
        this._depthR = structureDepthAtY(B.y);
        this._depthBars = structureDepthAtY((A.y + B.y) / 2);
        this._faceDepth = structureDepthAtY(Math.max(A.y, B.y)); // 与掩体同口径的通用锚点
        this._seamBiasL = 0;
        this._seamBiasR = 0;
        const sprites = createGateSprites(cfg, this._spriteCx, this._spriteCy, kx, this._depthL, this._depthR, this._depthBars, this._facingLeft, this._barsOnly, ky);
        this.spriteL = sprites ? sprites.spriteL : null;
        this.spriteR = sprites ? sprites.spriteR : null;
        this.sprite = sprites ? sprites.bars : null;
        if (this.sprite) {
            this._phaserSprite = this.sprite; // GameScene 识别为已托管精灵，不再自建
        }
        this._unregisterSegs();
        this._depthSegs = gateDepthSegs(A, B, this._depthL, this._depthR, this._depthBars);
        const reg = gateSegRegistry();
        if (reg) {
            for (const s of this._depthSegs) reg.push(s);
        }
    }

    _unregisterSegs() {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs) return;
        for (const s of this._depthSegs) {
            const i = reg.indexOf(s);
            if (i >= 0) reg.splice(i, 1);
        }
        this._depthSegs = null;
    }

    _setBarsSeg(enabled) {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs || !this._depthSegs[1]) return;
        const s = this._depthSegs[1];
        const i = reg.indexOf(s);
        if (enabled && i < 0) reg.push(s);
        else if (!enabled && i >= 0) reg.splice(i, 1);
    }

    /** 应用拼接缝偏置（左门右柱盖右门左柱，2026-08-16）；同步精灵与遮挡面线段。 */
    _applySeamBias() {
        const bL = this._seamBiasL || 0;
        const bR = this._seamBiasR || 0;
        if (this.spriteL) this.spriteL.setDepth(this._depthL + bL);
        if (this.spriteR) this.spriteR.setDepth(this._depthR + bR);
        if (this._depthSegs) {
            if (this._depthSegs[0]) this._depthSegs[0].depth = this._depthL + bL;
            if (this._depthSegs[2]) this._depthSegs[2].depth = this._depthR + bR;
        }
    }

    /**
     * 门模式切换（2026-08-15 建筑面板详情按钮）：
     * locked = 常锁（无论谁经过都不打开）；open = 常开（保持门口敞开）；auto = 原自动逻辑
     */
    setMode(mode) {
        const previousMode = this.gateMode;
        this.gateMode = mode;
        if (mode === 'locked') this.close();
        else if (mode === 'open') this.open();
        // 模式变化会改变玩家/侍从的自动门成本；除清缓存外，还要让已持有的旧路径重算。
        if (previousMode !== mode && this._gateSeg
            && pathFinder && typeof pathFinder.notifyFriendlyGateAccessChanged === 'function') {
            const s = this._gateSeg;
            pathFinder.notifyFriendlyGateAccessChanged(
                Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        }
    }

    /** 状态机默认关闭 → 友军靠近打开 → 友军离开延时关闭（与基地门同口径）。 */
    update(dt) {
        if (!this._gateSeg || !this.active) return;
        // 常锁/常开模式闸门（2026-08-15）：锁定态强制关、常开态强制开，均跳过自动感应
        if (this.gateMode === 'locked') {
            if (this.state !== 'closed' && this.state !== 'closing') this.close();
            return;
        }
        if (this.gateMode === 'open') {
            if (this.state !== 'open' && this.state !== 'opening') this.open();
            return;
        }
        // 2026-08-17：同基地门——点到门线段 ≤65px 才开，离开 0.8s 后关（菱形平时闭合）
        const OPEN_TOUCH = 65;
        const CLOSE_LINGER_S = 0.8;
        const f = nearbyFriendlyUnit((this._detectX ?? this._spriteCx), (this._detectY ?? this._spriteCy));
        let near = false;
        if (f) {
            const s = this._gateSeg;
            const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
            const len = Math.hypot(dx, dy) || 1;
            const t = Math.max(0, Math.min(1, ((f.x - s.x1) * dx + (f.y - s.y1) * dy) / (len * len)));
            const px = s.x1 + t * dx;
            const py = s.y1 + t * dy;
            near = Math.hypot(f.x - px, f.y - py) <= OPEN_TOUCH;
        }
        if (near) {
            this._closeTimer = 0;
            if (this.state === 'closed' || this.state === 'closing') this.open();
        } else {
            this._closeTimer = (this._closeTimer || 0) + dt;
            if ((this.state === 'open' || this.state === 'opening') && this._closeTimer >= CLOSE_LINGER_S) {
                this.close();
            }
        }
    }

    setPassable(passable) {
        this._setBarsSeg(!passable); // 关门=栅栏面线注册；开门=移除（栅栏消失后不再遮挡）
        if (!WallSystem || !WallSystem.isoSegments || !this._gateSeg) return;
        const i = WallSystem.isoSegments.indexOf(this._gateSeg);
        if (!passable && i < 0) {
            WallSystem.isoSegments.push(this._gateSeg);
        } else if (passable && i >= 0) {
            WallSystem.isoSegments.splice(i, 1);
        }
        if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
            const s = this._gateSeg;
            pathFinder.invalidateRegion(
                Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        }
    }

    open() {
        if (this.state === 'open' || this.state === 'opening') return;
        this.state = 'opening';
        this.setPassable(true);
        this._playSound('open');
        this._play(0, this._cfg.frames - 1);
    }

    close() {
        if (this.state === 'closed' || this.state === 'closing') return;
        unstickUnitsFromGate(
            { x: this._gateSeg.x1, y: this._gateSeg.y1 },
            { x: this._gateSeg.x2, y: this._gateSeg.y2 },
            this._cfg.halfThick
        );
        this.state = 'closing';
        this.setPassable(false);
        this._playSound('close');
        this._play(this._cfg.frames - 1, 0);
    }

    /** 铁栅栏门开关音效（世界音效距离衰减，2026-08-16；用户素材 1.mp3，开关共用） */
    _playSound(which) {
        if (!SoundManager || typeof SoundManager.playWorld !== 'function') return;
        void which; // 开/关共用同一音效（用户指定）
        const path = 'assets/sounds/environment/gate_iron.mp3';
        const sx = this._detectX ?? this._spriteCx ?? this.x;
        const sy = this._detectY ?? this._spriteCy ?? this.y;
        SoundManager.playWorld(path, sx, sy);
    }

    _play(from, to) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this.sprite) this.sprite.setFrame(from);
        if (!scene) {
            this._frame = to;
            this.state = to === 0 ? 'closed' : 'open';
            return;
        }
        if (this._animCounter) this._animCounter.stop();
        this._animCounter = scene.tweens.addCounter({
            from,
            to,
            duration: this._cfg.animMs,
            ease: 'Linear',
            onUpdate: (tw) => {
                const f = Math.round(tw.getValue());
                if (this.sprite) this.sprite.setFrame(f);
            },
            onComplete: () => {
                this._frame = to;
                this.state = to === 0 ? 'closed' : 'open';
            },
        });
    }

    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡由 onDeath 接管
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 铁栅栏门沉陷死亡（2026-08-16 推广）：先摘碰撞/门段，精灵随特效下沉清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._teardownCollision();
        // 从防守系统移除：基地门（this.gate）与玩家建造门（gates 数组）统一清理
        if (DefenseSystem && DefenseSystem.gates) {
            const i = DefenseSystem.gates.indexOf(this);
            if (i >= 0) DefenseSystem.gates.splice(i, 1);
        }
        if (DefenseSystem && DefenseSystem.gate === this) DefenseSystem.gate = null;
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '铁栅栏门被摧毁', '#ff8855'));
            EffectManager.add(new BuildingSinkEffect(this, () => {
                const sp = [this.spriteL, this.spriteR, this.sprite].filter(Boolean);
                this.spriteL = this.spriteR = this.sprite = null;
                return sp;
            }));
        }
    }

    _teardownVisual() {
        this._teardownCollision();
        for (const s of [this.spriteL, this.spriteR, this.sprite]) {
            if (s && s.destroy) s.destroy();
        }
        this.spriteL = this.spriteR = this.sprite = null;
        this._phaserSprite = null;
    }

    /** 碰撞/门段清理（保留精灵，供沉陷特效接管） */
    _teardownCollision() {
        if (this._animCounter) { this._animCounter.stop(); this._animCounter = null; }
        restoreTrimmedCovers(this);
        this._unregisterSegs();
        if (WallSystem && WallSystem.isoSegments && this._gateSeg) {
            const i = WallSystem.isoSegments.indexOf(this._gateSeg);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
        }
        this._gateSeg = null;
    }

    destroy() {
        this._teardownVisual();
        this.active = false;
    }
}

// ==================== E 键修理（仅世界-122，2026-08-14）====================
// 按住 E 持续修理附近受伤的掩体/防御塔（消耗背包能源）；松开停止。
// 用捕获监听保证先于 input.js 的 handleKey（其不拦截 KeyE，但避免面板/编辑器状态误触发）。
//
// 2026-08-15 用户要求停用：E 键与游戏快捷键冲突。修理入口改为建筑面板（B）
// 详情视图的「修理」按钮（BuildingSystem._repairCover，仅掩体）。
// _setRepairHeld / _repairTick 方法体保留备用，此处不再注册任何监听器。

export {
    DefenseBase, DefenseCover, DefenseTower, BuildableGate, WallStaircase,
    GATE_GEOM, GATE4_VISUAL, GATE_GRADES, gateConfigFor, GATE_CONFIG, syncGateSeamDepths,
};
