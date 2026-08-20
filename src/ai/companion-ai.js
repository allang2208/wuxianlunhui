// ============================================================
// CompanionAI — 侍从战斗/跟随 AI（2026-08-14）
// 为远程后排单位（露娜）设计：地牢寻路跟随玩家、施法输出、
// 远离近战怪物。移动复用 MovementSystem（寻路/墙碰撞/卡住恢复），
// 技能复用玩家技能系统（FireballSystem/IceSpikeSystem/
// LightningStrikeSystem），敌我判定按阵营分组（不误伤玩家）。
// 状态机：idle → follow → advance → cast → flee（decision 纯函数）。
// ============================================================

import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { clearRtsSurfaceRoute, resolveRtsMoveDestination } from './rts-command-utils.js';
import { GroundCircle } from '../physics/skill-shapes.js';
import { SceneManager } from '../world/scene-manager.js';
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { FireballSystem } from '../entities/components/fireball-system.js';
import { IceSpikeSystem } from '../entities/components/ice-spike-system.js';
import { LightningStrikeSystem } from '../entities/components/lightning-strike-system.js';
import { HolyLightSystem } from '../entities/components/holy-light-system.js';
import { Game } from '../game.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { getConsumableEffect, applyConsumableEffect } from '../config/consumable.js';
import { grantCompanionSkillExp } from '../systems/skill-system.js';
import { AimHelper } from '../utils/aim-helper.js';
import { SoundManager } from '../ui/sound-manager.js';
import { getMagicRangeMultiplier } from '../utils/magic-craft-helper.js';
import {
    applyElevatedRangedRange,
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
} from '../combat/elevated-ranged.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import {
    DEFAULT_MAGE_AI, decideCompanionAction, pickCompanionSpell,
    shouldRelocateCompanion, shouldUseRun,
    shouldWarriorDefend, shouldWarriorWhirlwind, pickPatrolPoint, pickNearestNode,
} from './companion-ai-decision.js';

const MELEE_THREAT_RANGE = 220; // 攻击距离低于此值视为近战威胁
// 技能射程兜底（与技能系统默认一致；skills.json effectFormula 通常不含 maxRange）
const SKILL_RANGE_FALLBACK = { fireball: 1200, iceSpike: 800, lightningStrike: 600 };
// 指令模式常量（指挥轮盘，2026-08-14）
const CMD_PATROL_RADIUS = 1200;   // 巡逻半径（用户口径）
const CMD_PATROL_SENSE = 520;     // 巡逻遇敌感知距离
const CMD_GATHER_PICKUP_RANGE = 80;  // 采集掉落自动拾取半径
// 伊莉丝动作音效（2026-08-16 用户口径：复制铠甲骑士 attacking/defending 为新文件）
const ELISE_SOUNDS = {
    attacking: 'assets/sounds/companions/elise/attacking.mp3',
    defending: 'assets/sounds/companions/elise/defending.mp3',
};

export class CompanionAI {
    constructor(companion) {
        this.c = companion;
        this.cfg = { ...DEFAULT_MAGE_AI, ...(companion.aiConfig || {}) };
        this._systems = null;
        this._decisionTimer = 0;
        this._castTimer = 0;
        this._initPos = false;
        this._lastAction = 'idle';
        this._relocateTimer = 0;
        this._lastScene = null;
        this._lastDmsState = null;
        this._followCache = null;
        this._stuckSampleTimer = 0;
        this._stuckSamples = [];
        this._stuckStreak = 0;
        this._teleportCd = 0;
        this._consumableTimer = 0;
        this._basicAtkCd = 0;   // 普通攻击间隔 CD（ms）
        // ===== 剑盾近战（伊莉丝，2026-08-15）=====
        this._meleeAtkTimer = 0;   // 近战攻击动画剩余 ms（attackAnimMs）
        this._meleeHitDone = false;// 本次攻击是否已在命中帧结算
        this._defendPhase = null;  // 防御阶段：'enter' | 'hold' | 'exit' | null
        this._defendTimer = 0;     // 当前防御阶段剩余 ms
        this._defendCd = 0;        // 防御结束冷却（defendCooldownMs）
        this._whirlwindTimer = 0;  // 风车进行中已耗时 ms
        this._whirlwindHitSet = null; // 风车已命中集合（进行中非 null）
        this._whirlwindHits = 0;   // 本次风车命中数（结算经验）
        this._whirlwindKills = 0;  // 本次风车击杀数
        this._whirlwindCd = 0;     // 风车冷却 ms（skill effect.cooldown 秒 ×1000）
        this._pendingRelease = null; // 50% 释放点：{type:'spell'|'basic', ...}
        this._castDuration = 0;      // 施法/攻击动作总时长（算 50% 释放点）
        this._castRecoverTimer = 0;  // 施法/攻击结束硬直（防动画刚完就滑动）
        this._lastAttackAt = 0;      // 最近一次攻击释放/命中时间戳（判定窗口内输出中不算卡死）
        this._lastPlayerDist = null; // 掉队判定：记录上一帧与玩家距离，检测是否在有效追赶
        // 指挥轮盘指令状态（2026-08-14）
        this._patrolTarget = null;  // 巡逻随机目标点
        this._patrolTimer = 0;      // 巡逻换点计时
        this._gatherPhase = 'work'; // 'work' 采集 | 'return' 满载回玩家
    }

    _combatRange() {
        return applyElevatedRangedRange(this.c, this.cfg.combatRange || 640);
    }

    _basicAttackRange() {
        return applyElevatedRangedRange(this.c, this.cfg.basicAttackRange || 600);
    }

    /** 懒构造技能系统（仅在运行时；避免 node 单测加载 Phaser 依赖链） */
    _ensureSystems() {
        if (this._systems) return this._systems;
        const c = this.c;
        this._systems = {
            fireball: new FireballSystem(c),
            iceSpike: new IceSpikeSystem(c),
            lightning: new LightningStrikeSystem(c),
            holyLight: new HolyLightSystem(c),
        };
        return this._systems;
    }

    /**
     * 消耗品自动使用（2026-08-15）：生命/魔法低于设置阈值时，
     * 从背包选对应恢复药水（低级→高级，level 升序）使用。
     * 设置存 companion.consumableSettings（背包界面"消耗品使用设置"可改）。
     */
    _useAutoConsumable() {
        const c = this.c;
        const st = c.consumableSettings || {};
        if (!st.enabled) return false;
        const d = c.data;
        let used = false;
        const pick = (need) => {
            const items = (c.backpack || []).filter(b => {
                if (!b || b.category !== 'consumable') return false;
                const eff = getConsumableEffect(b);
                return eff && (eff[need] || 0) > 0;
            });
            // 低级→高级：level 升序，同级按恢复量升序（后续新增更高级消耗品自动排后）
            items.sort((a, b) => (a.level || 1) - (b.level || 1)
                || ((getConsumableEffect(a)[need] || 0) - (getConsumableEffect(b)[need] || 0)));
            return items[0] || null;
        };
        if (d.maxHp > 0 && d.hp / d.maxHp < (st.hpThreshold ?? 0.3)) {
            const item = pick('hp');
            if (item) {
                if (applyConsumableEffect(c, item)) {
                    this._consumeStack(item);
                    used = true;
                }
            }
        }
        // HP/MP 各自独立判定（互不阻塞：生命和魔法可能同时低于阈值）
        if (d.maxMp > 0 && d.mp / d.maxMp < (st.mpThreshold ?? 0.25)) {
            const item = pick('mp');
            if (item) {
                if (applyConsumableEffect(c, item)) {
                    this._consumeStack(item);
                    used = true;
                }
            }
        }
        return used;
    }

    _consumeStack(item) {
        const c = this.c;
        const idx = (c.backpack || []).findIndex(b => b && b.slot === item.slot && b.name === item.name);
        if (idx === -1) return;
        if (item.stack > 1) item.stack--;
        else c.backpack.splice(idx, 1);
    }

    /** 每帧入口（由 PartySystem.updateCombat 调用） */
    update(dt, entities, player) {
        const c = this.c;
        if (!player || !c || c.data.hp <= 0) {
            c.vx = 0; c.vy = 0; c.isMoving = false;
            c._animState = 'idle';
            return;
        }
        // 场景切换：重置生成位置（避免残留上一场景坐标 / 生成在墙外）
        const scene = SceneManager && SceneManager.currentScene;
        if (scene !== this._lastScene) {
            this._lastScene = scene;
            this._initPos = false;
            this._followCache = null;
            if (c._pathManager) c._pathManager._clearPath();
            c._tacticalTarget = null;
            c.target = null;
            // 中断残留战斗状态（2026-08-17）：攻击/防御/风车中途切场景会让 _tickWarrior
            // 永远 return（defendPhase 非空）或动画状态卡死——攻击/风车动画不再触发
            this._meleeAtkTimer = 0;
            this._meleeHitDone = false;
            this._defendPhase = null;
            c._defendPhase = null;
            this._defendTimer = 0;
            c._defending = false;
            this._whirlwindHitSet = null;
            this._whirlwindTimer = 0;
            c._frozenForCast = false;
            c._animState = 'idle';
        }
        // 地牢房间切换（map↔combat 等）：玩家被传送，露娜同步重定位到玩家附近，
        // 避免残留地图模式坐标导致"进入地牢后不主动寻找位置/卡在墙外"
        const dmsState = DungeonMapSystem && DungeonMapSystem.active ? DungeonMapSystem.state : null;
        if (dmsState !== this._lastDmsState) {
            this._lastDmsState = dmsState;
            if (dmsState) {
                this._initPos = false;
                this._followCache = null;
                if (c._pathManager) c._pathManager._clearPath();
                c._tacticalTarget = null;
                c.target = null;
                this._stuckSamples.length = 0;
            }
        }
        // 位置初始化：在玩家附近找合法落点（螺旋搜索 + findSafeSpawn 兜底），避免卡墙外
        if (!this._initPos) {
            const sp = this._findValidSpawn(player);
            c.x = sp.x;
            c.y = sp.y;
            this._initPos = true;
        }
        // 掉队瞬移（理智版，2026-08-14）：区分"被卡住/卡门外导致的距离过远"（瞬移）
        // 与"正常 AI 运作（躲避敌人/战斗站位/追赶中）导致的距离过远"（不瞬移）。
        // 卡住证据 = 距离超阈值 + PathManager stuckCount / 撞墙；正常远离 = flee/站位/施法/距离在缩小。
        // 指挥指令（巡逻/采集/主动攻击）允许远离玩家：这些模式跳过掉队瞬移（指令自带寻路重试）。
        const cmdMode = c._command && c._command.mode;
        const onElevatedSurface = c._surfaceRouteActive
            || c._surfaceKind === 'stairs'
            || c._surfaceKind === 'wall_walk';
        this._relocateTimer -= dt;
        if (this._relocateTimer <= 0
            && !onElevatedSurface
            && (!cmdMode || cmdMode === 'follow')) {
            this._relocateTimer = 1500;
            if (this._evaluateRelocate(player)) {
                const sp = this._findValidSpawn(player);
                c.x = sp.x;
                c.y = sp.y;
                if (c._pathManager) c._pathManager._clearPath();
                c._tacticalTarget = null;
                this._stuckSamples.length = 0;
                this._stuckStreak = 0;
            }
        }

        // 冷却推进（火球/冰锥由 AI 推进；闪电/圣光由各自 system.update 推进）
        if (c._fireballCooldown > 0) c._fireballCooldown = Math.max(0, c._fireballCooldown - dt);
        if (c._iceSpikeCooldown > 0) c._iceSpikeCooldown = Math.max(0, c._iceSpikeCooldown - dt);
        if (c._castCooldown > 0) c._castCooldown = Math.max(0, c._castCooldown - dt);

        // 施法锁定计时
        this._updateCast(dt);
        // 控制技能（眩晕/冻结/束缚）强制打断施法动画（2026-08-15）：
        // 无状态效果系统的队员此检查自然跳过；有则受控时强行停止
        const ctrlBreak = (typeof c.hasStatusEffect === 'function')
            && (c.hasStatusEffect('stun') || c.hasStatusEffect('frozen') || c.hasStatusEffect('bind'));
        if (ctrlBreak && (c._castState !== 'idle' || c._frozenForCast)) {
            c._castState = 'idle';
            c._frozenForCast = false;
            c._castTimer = 0;
            this._pendingRelease = null;
            this._castDuration = 0;
            this._castRecoverTimer = 0;
            // 剑盾近战：被控时中断攻击/防御姿态
            this._meleeAtkTimer = 0;
            this._meleeHitDone = false;
            this._defendPhase = null;
            c._defendPhase = null; // 渲染层阶段镜像（GameScene 读 member._defendPhase）
            this._defendTimer = 0;
            c._defending = false;
            this._whirlwindHitSet = null;
            this._whirlwindTimer = 0;
            this._whirlwindHits = 0;
            this._whirlwindKills = 0;
        }
        // 施法/攻击结束硬直推进：期间保持冻结不移动，结束后恢复
        if (this._castRecoverTimer > 0) {
            this._castRecoverTimer -= dt;
            if (this._castRecoverTimer <= 0) {
                this._castRecoverTimer = 0;
                c._frozenForCast = false;
            } else {
                c._frozenForCast = true;
            }
        }

        // 技能推进（飞行/命中/冷却）
        const sys = this._ensureSystems();
        sys.fireball.update(dt, entities);
        sys.iceSpike.update(dt, entities);
        sys.lightning.update(dt);
        sys.holyLight.update(dt);

        // 决策 tick（节流）
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs || 120;
            this._tick(entities, player);
        }

        // 剑盾近战：攻击/防御状态机逐帧推进（决策只负责发起，进度由这里驱动）
        if ((this.cfg.role || '').startsWith('melee')) {
            this._updateWarriorCombat(dt, entities);
        }

        // 移动（MovementSystem：寻路跟随/撤退/站位，施法锁定自动停步）
        MovementSystem.update(c, dt, entities);

        // 队友防卡死：位移型卡死检测 + 瞬移脱离（只作用于队员，不影响玩家/敌人；
        // 门闸等动态障碍 MovementSystem 的 GATE-WAIT 面向怪物选择等待，队友直接瞬移跟上）
        // 指挥指令（巡逻/采集/主动攻击）跳过：瞬移回玩家会打断采集/巡逻，指令层自带重新寻路
        this._teleportCd = Math.max(0, this._teleportCd - dt);
        if (!cmdMode || cmdMode === 'follow') {
            this._checkStuck(dt, player);
        }

        // 采集普通攻击弹体推进 + 掉落拾取（指挥指令·采集）
        // 消耗品自动使用（1s 节流）：HP/MP 低于阈值时按低级→高级用对应恢复药水
        this._consumableTimer -= dt;
        if (this._consumableTimer <= 0) {
            this._consumableTimer = 1000;
            if (this._useAutoConsumable() && window.Game && window.Game.PartySystem) {
                window.Game.PartySystem._notify();
            }
        }

        // 普通攻击：CD 推进 + 光球飞行/命中结算
        if (this._basicAtkCd > 0) this._basicAtkCd = Math.max(0, this._basicAtkCd - dt);
        this._updateBasic(dt);

        if (cmdMode === 'gather') {
            this._pickupEnergyDrops();
        }

        // 动画兜底（决策外的每帧：施法结束但没来得及决策时按速度回退）
        if (c._castState === 'idle' && !c._frozenForCast && c._animState === 'spell') {
            const spd = Math.hypot(c.vx, c.vy);
            this._setMoveState(spd > 20 ? (this._lastAction === 'flee' ? 'run' : 'walk') : 'idle');
        }
    }

    /**
     * 理智判定"是否掉队需要瞬移回玩家身边"（2026-08-14 用户需求）：
     * 区分 被卡住/卡门外导致的距离过远（瞬移） 与 正常 AI 运作导致的距离过远（不瞬移）。
     * 正常远离（合法）：①flee 逃离近战威胁（retreat 点含朝玩家分量，会自动收敛）
     *                  ②advance 去战斗站位输出（站位点离玩家在 maxFollow 允许范围）
     *                  ③施法锁定中（瞬移会打断施法）④正在有效追赶（距离在缩小）
     * 掉队证据（瞬移）：①距离超 teleportHardDist（无条件兜底，彻底跑丢）
     *                  ②距离超 teleportDist 且非上述合法状态
     *                  ③撞墙（canMoveTo false）④PathManager stuckCount ≥ 2（路径反复失败/局部修复无效）
     */
    _evaluateRelocate(player) {
        const c = this.c;
        const cfg = this.cfg;
        const dist = Math.hypot(c.x - player.x, c.y - player.y);
        const wallIgnore = WallSystem?.ignoreForEntity ? WallSystem.ignoreForEntity(c) : null;
        const inWall = !!(WallSystem && typeof WallSystem.canMoveTo === 'function'
            && !WallSystem.canMoveTo(c.x, c.y, (c.groundRadius || 26) * 0.8, wallIgnore));
        const relocate = shouldRelocateCompanion({
            dist,
            teleportDist: cfg.teleportDist ?? 700,
            teleportHardDist: cfg.teleportHardDist ?? 1100,
            lastAction: this._lastAction,
            tacticalTarget: c._tacticalTarget,
            player,
            followOffset: cfg.followOffset || 150,
            lastPlayerDist: this._lastPlayerDist,
            casting: c._castState !== 'idle' || c._frozenForCast,
            inWall,
            pathStuck: !!(c._pathManager && c._pathManager.stuckCount >= 2),
        });
        this._lastPlayerDist = dist;
        return relocate;
    }

    /**
     * 位移型卡死检测：2s 窗口内总位移 < 10px 且仍有移动意图 → 卡死。
     * 连续确认后瞬移脱离（局部搜索更近玩家的合法点，兜底玩家附近），4s 冷却防抖动。
     * 参考行业共识：短时位移≈0 + 有移动意图即卡死；多次尝试后兜底瞬移到可达点
     * （L4D 传送下一路径点 / Godot 取导航最近点 / Gmod-Auto-Unstuck）。
     */
    _checkStuck(dt, player) {
        const c = this.c;
        if (c._surfaceRouteActive
            || c._surfaceKind === 'stairs'
            || c._surfaceKind === 'wall_walk') {
            this._stuckSamples.length = 0;
            this._stuckStreak = 0;
            return;
        }
        // 施法站定/无生命不检测
        if (c._castState !== 'idle' || c._frozenForCast || c.data.hp <= 0) {
            this._stuckStreak = 0;
            return;
        }
        // 判定窗口内（2.5s）有过攻击释放/命中 → 正在正常输出，不算卡死，不触发瞬移
        if (this._lastAttackAt && Date.now() - this._lastAttackAt < 2500) {
            this._stuckStreak = 0;
            return;
        }
        this._stuckSampleTimer -= dt;
        if (this._stuckSampleTimer > 0) return;
        this._stuckSampleTimer = 400;

        this._stuckSamples.push({ x: c.x, y: c.y });
        if (this._stuckSamples.length > 5) this._stuckSamples.shift();
        if (this._stuckSamples.length < 5) return;

        const first = this._stuckSamples[0];
        const moved = Math.hypot(c.x - first.x, c.y - first.y);
        // 移动意图：有战术目标未到达 或 有攻击目标在射程外
        const tt = c._tacticalTarget;
        const hasIntent = (tt && Math.hypot(tt.x - c.x, tt.y - c.y) > 50)
            || (c.target && c.target.active && Math.hypot(c.target.x - c.x, c.target.y - c.y) > 120);
        if (moved >= 10 || !hasIntent) {
            this._stuckStreak = 0;
            return;
        }

        this._stuckStreak++;
        if (this._stuckStreak >= 2 && this._teleportCd <= 0) {
            this._teleportStuck(player);
            this._stuckStreak = 0;
        }
    }

    /** 瞬移脱离卡死位置：优先卡死点附近"更靠近玩家"的合法点，否则玩家附近合法点 */
    _teleportStuck(player) {
        const c = this.c;
        if (c._surfaceRouteActive
            || c._surfaceKind === 'stairs'
            || c._surfaceKind === 'wall_walk') return;
        this._teleportCd = 4000;
        const radius = (c.groundRadius || 26) * 0.8;
        const curDist = Math.hypot(c.x - player.x, c.y - player.y);
        let local = null;
        if (WallSystem && typeof WallSystem.canMoveTo === 'function') {
            outer:
            for (const dist of [50, 90, 140, 200]) {
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2;
                    const px = c.x + Math.cos(angle) * dist;
                    const py = c.y + Math.sin(angle) * dist;
                    if (!WallSystem.canMoveTo(px, py, radius, WallSystem.ignoreForEntity?.(c) || null)) continue;
                    if (Math.hypot(px - player.x, py - player.y) < curDist - 10) {
                        local = { x: px, y: py };
                        break outer;
                    }
                }
            }
        }
        const sp = local || this._findValidSpawn(player);
        c.x = sp.x;
        c.y = sp.y;
        if (c._pathManager) c._pathManager._clearPath();
        c._tacticalTarget = null;
        c._stuckSamples.length = 0;
        this._stuckStreak = 0;
        // 瞬移后立即同步一次逻辑位置（渲染下一帧生效）
        if (typeof console !== 'undefined') {
            console.log(`[CompanionAI] ${c.id || c.name} 卡死瞬移: (${Math.round(c.x)},${Math.round(c.y)})`);
        }
    }

    /** 施法锁定：站定播 spell 动画，时长结束恢复 */
    _updateCast(dt) {
        const c = this.c;
        if (c._castState === 'idle') return;
        // 计时器存 companion 字段（_tryCast 写 c._castTimer）——此前误读实例字段
        // this._castTimer（恒 0）导致施法首帧即结束，spell 动画被跳过（2026-08-15）
        c._castTimer = (c._castTimer || 0) - dt;
        // 50% 释放点：spell 动画播到一半时才发射/施法（2026-08-15）
        if (this._pendingRelease) {
            const total = this._castDuration || this.cfg.castFrozenMs || 650;
            const elapsed = Math.max(0, total - c._castTimer);
            if (elapsed >= total * 0.5) {
                this._releasePending();
            }
        }
        if (c._castTimer <= 0) {
            c._castState = 'idle';
            c._animState = 'idle';
            this._pendingRelease = null;
            this._castDuration = 0;
            // 施法/攻击结束硬直：短暂保持冻结，避免动画刚播完就滑动产生"位移"
            this._castRecoverTimer = this.cfg.castRecoverMs || 200;
        }
    }

    /** 50% 释放点执行：法术发射（MP 扣除）/ 普通攻击光球生成 */
    _releasePending() {
        const p = this._pendingRelease;
        if (!p) return;
        this._pendingRelease = null;
        this._lastAttackAt = Date.now(); // 攻击释放 → 输出中，卡死判定窗口重置
        const c = this.c;
        if (p.type === 'spell') {
            const sys = this._systems;
            if (!sys) return;
            // 发射前扣 MP（凝聚阶段被打断则不消耗）
            if (p.mpCost > 0) c.data.mp -= p.mpCost;
            try {
                if (p.key === 'fireball') sys.fireball.trigger();      // 第二次 trigger = 发射
                else if (p.key === 'iceSpike') sys.iceSpike.trigger();
                else if (p.key === 'lightningStrike') sys.lightning.trigger();
                // 发射成功后设施法 CD（凝聚时若先设，trigger 冷却检查会拦截第二次发射）
                if (p.key === 'fireball') c._fireballCooldown = p.cooldownMs;
                else if (p.key === 'iceSpike') c._iceSpikeCooldown = p.cooldownMs;
                else c._lightningStrikeCooldown = Math.max(c._lightningStrikeCooldown, p.cooldownMs);
            } catch (e) {
                if (typeof console !== 'undefined') console.error('[CompanionAI] 释放异常:', p.key, e);
                if (p.mpCost > 0) c.data.mp += p.mpCost;
            }
        } else if (p.type === 'basic') {
            this._spawnBasic(p.target);
        }
    }

    // ==================== 决策 ====================

    _tick(entities, player) {
        const c = this.c;
        // 指挥指令层（2026-08-14）：非 follow 指令直接走指令行为，不再进入默认状态机
        const cmd = c._command || null;
        if (cmd && cmd.mode && cmd.mode !== 'follow') {
            this._applyCommand(entities, player, cmd);
            // 冻结中的动画保持：法师统一 spell；近战（伊莉丝）攻击/防御/风车由
            // 各自状态机驱动（_tryMeleeAttack/_startDefend/_tryWhirlwind），不能
            // 覆盖成 spell——否则命令态战斗中攻击动画被顶掉、渲染回落 idle
            // （2026-08-16 实机采样 anim:'spell'+atkTimer 实锤）。
            if (!(this.cfg.role || '').startsWith('melee')
                && (c._castState !== 'idle' || c._frozenForCast)) {
                c._animState = 'spell';
            }
            return;
        }
        // 剑盾近战（伊莉丝）：独立状态机——防御 > 攻击 > 追击 > 跟随
        if ((this.cfg.role || '').startsWith('melee')) {
            this._tickWarrior(entities, player);
            return;
        }
        const enemies = this._activeEnemies(entities);
        const { threat, threatDist } = this._meleeThreat(enemies, c);
        const hasEnemy = enemies.length > 0;
        const fleeNow = threatDist !== null && threatDist < (this.cfg.safeDistance || 230);

        // 目标维护
        if (c.target && (!c.target.active || c.target.hp <= 0)) c.target = null;
        // 撤退期间不锁定攻击目标：避免 MovementSystem 以 target 重算路径（会覆盖撤退点）
        if (hasEnemy && !c.target && !fleeNow) {
            c.target = this._pickTarget(enemies, c);
        }
        const targetDist = c.target ? Math.hypot(c.target.x - c.x, c.target.y - c.y) : null;

        // 技能就绪判断（含射程/MP/冷却）；无法术时普通攻击兜底（蓝色光球）
        const spell = hasEnemy && c.target ? this._pickReadySpell(enemies, c.target, targetDist) : null;
        const basic = hasEnemy && c.target ? this._basicReady(targetDist, c.target) : false;

        // 状态机：follow 距离以"到跟随点"为准（到玩家距离恒为偏移量，会导致永远走不到而停不下来）
        const followPoint = hasEnemy ? null : this._followPoint(player);
        const followDist = followPoint ? Math.hypot(followPoint.x - c.x, followPoint.y - c.y) : null;
        const action = decideCompanionAction({
            casting: c._castState !== 'idle' || c._frozenForCast,
            hasEnemy,
            threatDist,
            safeDistance: this.cfg.safeDistance || 230,
            targetDist,
            combatRange: this._combatRange(),
            spellReady: !!spell || !!basic,
            followDist,
            followArriveDist: this.cfg.followArriveDist || 55,
        });
        this._lastAction = action;
        c._lastAction = action; // 同步到 companion，供渲染层朝向/深度等消费
        this._applyAction(action, { player, enemies, threat, targetDist, spell, basic });
        // 施法站定期间动画保持 spell；硬直期（castState=idle 但 frozen）停帧 idle
        // （2026-08-15：不区分会让动画播完后循环重播造成"抽动"）
        if (c._castState !== 'idle') c._animState = 'spell';
        else if (c._frozenForCast) c._animState = 'idle';
    }

    _applyAction(action, ctx) {
        const c = this.c;
        const { player, threat, targetDist, spell, basic } = ctx;
        c._tacticalTarget = null;
        // 施法锁定中：保持 spell 动画并停止移动，直接返回——
        // 决策仍返回 'cast'（casting 优先），但 spell 可能已进 CD 为 null，
        // 不能走下方默认 idle 重置（会把施法动画砍掉）。
        // 例外：action === 'flee'（近战贴脸保命优先）→ 打断施法走 flee 分支。
        if (action !== 'flee' && (c._castState !== 'idle' || c._frozenForCast)) {
            // 施法中（castState=casting）保持 spell 动画；硬直中（castState=idle
            // 但 frozen）停帧 idle——避免动画播完后循环重播造成"抽动"（2026-08-15）
            c._animState = c._castState !== 'idle' ? 'spell' : 'idle';
            c.vx = 0; c.vy = 0; c.isMoving = false;
            return;
        }
        // 默认回 idle 并停止：防止分支条件未命中（flee 无威胁 / cast 无目标 /
        // advance 无目标）时残留上一帧动画状态——"run 常态化 / spell 不放"的根因。
        // 各分支命中后会用 _setMoveState 覆盖；MovementSystem 随后按 _tacticalTarget 重算位移。
        this._setMoveState('idle');
        c.vx = 0; c.vy = 0; c.isMoving = false;

        switch (action) {
            case 'cast':
                if (spell && c.target) this._tryCast(spell, c.target);
                else if (basic && c.target) this._tryBasicAttack(c.target);
                break;
            case 'flee':
                if (threat) {
                    // 打断施法（贴脸保命优先，2026-08-15）
                    c._castState = 'idle';
                    c._frozenForCast = false;
                    c._castTimer = 0;
                    this._pendingRelease = null;
                    this._castDuration = 0;
                    this._castRecoverTimer = 0;
                    c.target = null;
                    c._tacticalTarget = this._retreatPoint(threat, player);
                    // 逃避敌人：永远 run
                    this._setMoveState('run');
                }
                break;
            case 'advance': {
                if (c.target) {
                    // 保持阵型：玩家走远时优先跟近玩家（远程后排不落单），
                    // 怪在射程内时仍由 cast 分支站定施法
                    if (Math.hypot(player.x - c.x, player.y - c.y) > 450) {
                        c._tacticalTarget = this._followPoint(player);
                        // 快速归队：远距离用 run
                        this._setMoveState('run');
                        break;
                    }
                    const standRange = this._combatRange() * 0.72;
                    if (targetDist !== null && targetDist > standRange * 0.9) {
                        const sp = this._standPoint(c.target, standRange);
                        // 远程后排不追远目标：站位点离玩家过远 → 站桩等目标进射程
                        // （避免在地牢里追怪跑离玩家，导致跑丢/卡墙外）
                        const maxFollow = (this.cfg.followOffset || 150) * 3.3;
                        if (Math.hypot(sp.x - player.x, sp.y - player.y) <= maxFollow) {
                            c._tacticalTarget = sp;
                            // 寻找位置输出：站位距离远 → run；近距离站位微调 → walk
                            const dist = Math.hypot(sp.x - c.x, sp.y - c.y);
                            this._setMoveState(this._shouldRun(dist, 'advance') ? 'run' : 'walk');
                        }
                    }
                }
                break;
            }
            case 'follow': {
                const fp = this._followPoint(player);
                const dist = Math.hypot(fp.x - c.x, fp.y - c.y);
                if (dist > (this.cfg.followArriveDist || 55)) {
                    c._tacticalTarget = fp;
                    // 跟随：离玩家/跟随点远 → run 快速归队；小范围调整 → walk
                    this._setMoveState(this._shouldRun(dist, 'follow') ? 'run' : 'walk');
                }
                break;
            }
        }
    }

    /** 设置移动动画状态并同步移动速度（run → runSpeed，walk/idle → walkSpeed） */
    _setMoveState(state) {
        const c = this.c;
        c._animState = state;
        c.maxSpeed = state === 'run' ? (this.cfg.runSpeed || 185) : (this.cfg.walkSpeed || 115);
    }

    /**
     * walk/run 判定（2026-08-14 用户需求）：
     * flee（逃避敌人）永远 run；其余按移动距离——超过 runDist 用 run（长距离奔袭/寻找输出位置），
     * 小范围移动用 walk。距离用"到战术目标（跟随点/站位点）的直线距离"——
     * 注意：决策瞬间 PathManager.path 仍是旧目标的（MovementSystem 下帧才重算），
     * 读路径长度会 stale 导致误判 run，故不用；预寻路整合点在卡住检测（stuckCount）。
     */
    _shouldRun(dist, mode) {
        return shouldUseRun(mode, dist, this.cfg);
    }

    // ==================== 指挥指令（轮盘五指令，2026-08-14）====================

    /** 非 follow 指令主入口（决策 tick 调用）：aggressive / patrol / gather / hold */
    _applyCommand(entities, player, cmd) {
        const c = this.c;
        if (cmd.mode !== 'move') c._surfaceRouteActive = false;
        // 剑盾近战（伊莉丝）：指令走近战分支（aggressive/patrol 追击近战，gather 无远程回落跟随）
        if ((this.cfg.role || '').startsWith('melee')) {
            this._applyWarriorCommand(entities, player, cmd);
            return;
        }
        // 待命/移动：立即打断施法/硬直（否则要等当前动画播完才生效；移动=玩家右键
        // 最高优先级指令，必须先清掉一切进行中的指令状态再执行）
        if (cmd.mode === 'hold' || cmd.mode === 'move') {
            c._castState = 'idle'; c._frozenForCast = false; c._castTimer = 0;
            this._pendingRelease = null; this._castDuration = 0; this._castRecoverTimer = 0;
            if (cmd.mode === 'move') {
                this._cmdMove(player, cmd);
            } else {
                c.target = null; c._tacticalTarget = null;
                if (c._pathManager) c._pathManager._clearPath();
                this._setMoveState('idle');
                c.vx = 0; c.vy = 0; c.isMoving = false;
            }
            return;
        }
        // 施法锁定中不打断
        if (c._castState !== 'idle' || c._frozenForCast) {
            c._animState = 'spell';
            c.vx = 0; c.vy = 0; c.isMoving = false;
            return;
        }
        // 默认回 idle 并停止（与 _applyAction 同口径，防止指令切换残留动画状态）
        this._setMoveState('idle');
        c.vx = 0; c.vy = 0; c.isMoving = false;
        c._tacticalTarget = null;

        switch (cmd.mode) {
            case 'hold': {
                // 待命：不移动、不攻击，保持 idle
                c.target = null;
                break;
            }
            case 'aggressive': this._cmdAggressive(entities, player); break;
            case 'patrol': this._cmdPatrol(entities, player, cmd); break;
            case 'gather': this._cmdGather(entities, player, cmd); break;
            case 'attack': this._cmdAggressive(entities, player, cmd.target); break; // RTS 右键指定攻击（2026-08-16）
            case 'move': this._cmdMove(player, cmd); break; // 左键/右键纯移动（2026-08-16）
        }
        // 朝向：施法/攻击面朝目标
        if (c.target) c.rotation = Math.atan2(c.target.y - c.y, c.target.x - c.x);
    }

    /** 主动攻击：全图搜索最近敌人主动追击/施法；近战威胁贴脸仍保留 flee 保命。
     *  forcedTarget 非空 = RTS 右键指定攻击目标（2026-08-16）：只打该目标，
     *  目标死亡/失活自动清除指令回落跟随。 */
    _cmdAggressive(entities, player, forcedTarget = null) {
        const c = this.c;
        const enemies = this._activeEnemies(entities);
        if (forcedTarget) {
            if (!forcedTarget.active || forcedTarget.hp <= 0) {
                c._command = { mode: 'follow' };
                c.target = null;
                this._cmdFollowOnly(player);
                return;
            }
            const { threat, threatDist } = this._meleeThreat(enemies, c);
            if (threatDist !== null && threatDist < (this.cfg.safeDistance || 230)) {
                c.target = null;
                c._tacticalTarget = this._retreatPoint(threat, player);
                this._setMoveState('run');
                return;
            }
            c.target = forcedTarget;
            const forcedDist = Math.hypot(forcedTarget.x - c.x, forcedTarget.y - c.y);
            const spell = this._pickReadySpell(enemies, forcedTarget, forcedDist);
            if (spell && forcedDist <= this._combatRange()) {
                this._tryCast(spell, forcedTarget);
                return;
            }
            if (this._basicReady(forcedDist, forcedTarget)) {
                this._tryBasicAttack(forcedTarget);
                return;
            }
            const standRange = this._combatRange() * 0.72;
            if (forcedDist > standRange * 0.9) {
                c._tacticalTarget = this._standPoint(forcedTarget, standRange);
                this._setMoveState(this._shouldRun(forcedDist, 'advance') ? 'run' : 'walk');
            }
            return;
        }
        if (!enemies.length) {
            this._cmdFollowOnly(player);
            return;
        }
        const { threat, threatDist } = this._meleeThreat(enemies, c);
        if (threatDist !== null && threatDist < (this.cfg.safeDistance || 230)) {
            c.target = null;
            c._tacticalTarget = this._retreatPoint(threat, player);
            this._setMoveState('run');
            return;
        }
        // 全图最近敌人（不受 combatRange 1.3 倍锁定限制——主动攻击允许跨图追击）
        let best = null; let bestD = Infinity;
        for (const e of enemies) {
            const d = Math.hypot(e.x - c.x, e.y - c.y);
            if (d < bestD) { best = e; bestD = d; }
        }
        c.target = best;
        const spell = this._pickReadySpell(enemies, c.target, bestD);
        if (spell && bestD <= this._combatRange()) {
            this._tryCast(spell, c.target);
            return;
        }
        // 无法术可用 → 统一普通攻击（与默认状态机同一套）
        if (this._basicReady(bestD, c.target)) {
            this._tryBasicAttack(c.target);
            return;
        }
        // 追击：站位点朝目标推进（无玩家距离上限）
        const standRange = this._combatRange() * 0.72;
        if (bestD > standRange * 0.9) {
            c._tacticalTarget = this._standPoint(c.target, standRange);
            this._setMoveState(this._shouldRun(bestD, 'advance') ? 'run' : 'walk');
        }
    }

    /** 巡逻：以指令点（缺省当前位置）为圆心 1200px 随机游走；遇敌反击；无目标圈内随机移动 */
    _cmdPatrol(entities, player, cmd) {
        const c = this.c;
        const center = cmd.point || { x: c.x, y: c.y };
        const enemies = this._activeEnemies(entities);
        const near = enemies.filter((e) => Math.hypot(e.x - c.x, e.y - c.y) <= CMD_PATROL_SENSE);
        if (near.length) {
            // 遇敌：贴脸 flee（撤退点钳制在巡逻圈内），否则锁定最近者施法/追击
            const { threat, threatDist } = this._meleeThreat(near, c);
            if (threatDist !== null && threatDist < (this.cfg.safeDistance || 230)) {
                c.target = null;
                c._tacticalTarget = this._clampToCircle(this._retreatPoint(threat, player), center, CMD_PATROL_RADIUS);
                this._setMoveState('run');
                return;
            }
            let best = null; let bestD = Infinity;
            for (const e of near) {
                const d = Math.hypot(e.x - c.x, e.y - c.y);
                if (d < bestD) { best = e; bestD = d; }
            }
            c.target = best;
            const spell = this._pickReadySpell(near, c.target, bestD);
            if (spell && bestD <= this._combatRange()) {
                this._tryCast(spell, c.target);
                return;
            }
            if (this._basicReady(bestD, c.target)) {
                this._tryBasicAttack(c.target);
                return;
            }
            if (bestD > this._combatRange() * 0.9) {
                const sp = this._standPoint(c.target, this._combatRange() * 0.72);
                c._tacticalTarget = this._clampToCircle(sp, center, CMD_PATROL_RADIUS);
                this._setMoveState(this._shouldRun(bestD, 'advance') ? 'run' : 'walk');
            }
            return;
        }
        // 无目标：圈内随机游走（2~4s 换点；到位即 idle）
        this._patrolTimer -= this.cfg.decisionMs || 120;
        const arrived = this._patrolTarget
            && Math.hypot(this._patrolTarget.x - c.x, this._patrolTarget.y - c.y) < 60;
        if (!this._patrolTarget || arrived || this._patrolTimer <= 0) {
            this._patrolTimer = 2000 + Math.random() * 2000;
            this._patrolTarget = pickPatrolPoint({ center, radius: CMD_PATROL_RADIUS });
        }
        c._tacticalTarget = this._patrolTarget;
        const d = Math.hypot(this._patrolTarget.x - c.x, this._patrolTarget.y - c.y);
        if (d > 60) this._setMoveState(this._shouldRun(d, 'follow') ? 'run' : 'walk');
    }

    /** 点钳制到巡逻圆内 */
    _clampToCircle(p, center, radius) {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d <= radius) return { x: p.x, y: p.y };
        return { x: center.x + (dx / d) * radius, y: center.y + (dy / d) * radius };
    }

    /** 采集：前往距指令点最近的资源点用普通攻击采集；袋满（999）回玩家移交；节点枯竭自动换下一个 */
    _cmdGather(entities, player, cmd) {
        const c = this.c;
        if (EnergyManager && EnergyManager.isFull()) {
            this._stopGatherForFullStorage();
            return;
        }
        // 旧运行状态兼容：把队员背包残留能源直接迁入仓库
        if (this._gatherPhase === 'return') {
            this._transferEnergyToPlayer(player);
            return;
        }
        // 找资源点：优先距指令点最近，否则距玩家最近；无节点回落跟随
        const nodes = [];
        for (const e of (entities && entities.values ? entities.values() : (entities || []))) {
            if (e && e._isEnergyNode && e.active && !e._depleted) nodes.push(e);
        }
        const ref = cmd.point || player;
        const node = pickNearestNode(nodes, ref) || pickNearestNode(nodes, player);
        if (!node) {
            this._cmdFollowOnly(player);
            return;
        }
        c.target = node;
        const d = Math.hypot(node.x - c.x, node.y - c.y);
        if (d > this._basicAttackRange()) {
            c._tacticalTarget = { x: node.x, y: node.y };
            this._setMoveState(this._shouldRun(d, 'follow') ? 'run' : 'walk');
            return;
        }
        // 统一普通攻击（蓝色光球）：与打普通怪完全同一套公式/间隔/投射物
        if (this._basicReady(d, node)) this._tryBasicAttack(node);
        c.rotation = Math.atan2(node.y - c.y, node.x - c.x);
    }

    /** 无任务回落：跟随玩家（aggressive 无敌人 / gather 无节点） */
    _cmdFollowOnly(player) {
        const c = this.c;
        const fp = this._followPoint(player);
        const d = Math.hypot(fp.x - c.x, fp.y - c.y);
        if (d > (this.cfg.followArriveDist || 55)) {
            c._tacticalTarget = fp;
            this._setMoveState(this._shouldRun(d, 'follow') ? 'run' : 'walk');
        } else {
            // 到达：立即停步（与 _tickWarrior 到达分支同款修复，防 idle 姿态滑行）
            c._tacticalTarget = null;
            if (c._pathManager) c._pathManager._clearPath();
            c.vx = 0; c.vy = 0; c.isMoving = false;
            this._setMoveState('idle');
        }
    }

    /**
     * 纯移动指令（2026-08-16 左键/右键点击下达）：只走到目标点，不接敌/不采集/不跟随；
     * 目标不可达（canMoveTo 失败）→ 螺旋找最近可达点；到达后停步站定。
     */
    _cmdMove(player, cmd) {
        const c = this.c;
        c.target = null; // 移动指令不接敌
        // 最高优先级：清掉采集/巡逻残余状态（右键移动覆盖一切当前指令）
        c._gatherPhase = 'work';
        this._patrolTarget = null;
        const move = resolveRtsMoveDestination(c, cmd, 40);
        const dest = move.hasRoute ? move.destination : this._nearestWalkable(move.destination);
        if (!move.arrived) {
            c._tacticalTarget = dest;
            this._setMoveState(this._shouldRun(move.distance, 'follow') ? 'run' : 'walk');
        } else {
            // 到达：停步站定（不攻击、不跟随）
            c._tacticalTarget = null;
            if (c._pathManager) c._pathManager._clearPath();
            c.vx = 0; c.vy = 0; c.isMoving = false;
            clearRtsSurfaceRoute(c);
            this._setMoveState('idle');
        }
    }

    /** 目标不可达 → 螺旋外扩找最近可达点（与 _findValidSpawn 同口径）；无 WallSystem 时原样返回 */
    _nearestWalkable(point) {
        const c = this.c;
        const radius = (c.groundRadius || 26) * 0.8;
        if (!WallSystem || typeof WallSystem.canMoveTo !== 'function') return point;
        if (WallSystem.canMoveTo(point.x, point.y, radius, WallSystem.ignoreForEntity?.(c) || null)) return point;
        for (const dist of [16, 32, 48, 64, 80, 100, 120, 150, 180, 220, 260, 320, 400]) {
            for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2;
                const px = point.x + Math.cos(angle) * dist;
                const py = point.y + Math.sin(angle) * dist;
                if (WallSystem.canMoveTo(px, py, radius, WallSystem.ignoreForEntity?.(c) || null)) return { x: px, y: py };
            }
        }
        return point;
    }

    /** 兼容旧地面能源掉落：直接并入仓库，不再进入队员背包。 */
    _pickupEnergyDrops() {
        const c = this.c;
        if (!Game || !Game.entities) return;
        for (const [key, e] of Game.entities.entries()) {
            if (!e || !e.active) continue;
            if (!e.itemData || e.itemData.category !== 'energy') continue;
            if (Math.hypot(e.x - c.x, e.y - c.y) > CMD_GATHER_PICKUP_RANGE) continue;
            const amount = e.itemData.stack || 1;
            const added = EnergyManager ? EnergyManager.depositEnergy(amount) : 0;
            if (added >= amount) {
                e.active = false;
                if (e._destroyPhaserSprite) e._destroyPhaserSprite();
                Game.entities.delete(key);
            } else if (added > 0) {
                e.itemData.stack = amount - added;
            }
            if (EnergyManager && EnergyManager.isFull()) break;
        }
    }

    /** 旧队员背包能源迁入仓库。 */
    _transferEnergyToPlayer(player) {
        const c = this.c;
        let total = 0;
        for (const it of c.backpack) if (it && it.category === 'energy') total += it.stack || 0;
        if (total <= 0) {
            this._gatherPhase = 'work';
            return;
        }
        const added = EnergyManager ? EnergyManager.depositEnergy(total) : 0;
        let remain = added;
        for (let i = c.backpack.length - 1; i >= 0 && remain > 0; i--) {
            const it = c.backpack[i];
            if (!it || it.category !== 'energy') continue;
            const take = Math.min(it.stack || 0, remain);
            it.stack -= take;
            remain -= take;
            if (it.stack <= 0) c.backpack.splice(i, 1);
        }
        if (added > 0 && EffectManager) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 50, `+${added} 能源（${c.name || '队员'}入库）`, '#7fd4ff'));
        }
        let left = 0;
        for (const it of c.backpack) if (it && it.category === 'energy') left += it.stack || 0;
        if (left > 0) this._stopGatherForFullStorage();
        else this._gatherPhase = 'work';
    }

    /** 仓库满：停止玩家队友采矿并切待命。 */
    _stopGatherForFullStorage() {
        const c = this.c;
        if (EnergyManager) EnergyManager.depositEnergy(1); // 触发节流满仓提示
        c._command = { mode: 'hold', point: null, target: null };
        c.target = null;
        c._tacticalTarget = null;
        if (c._pathManager) c._pathManager._clearPath();
        c.vx = 0;
        c.vy = 0;
        c.isMoving = false;
        c._animState = 'idle';
        this._gatherPhase = 'work';
    }

    // ==================== 剑盾近战（伊莉丝，2026-08-15）====================

    /**
     * 圣光目标选择（2026-08-17 用户口径）：
     * 玩家（生命不满）→ 自己（生命不满）→ 其他队友（生命不满，缺血最多优先）→ 敌方（最近）。
     */
    _pickHolyLightTarget(entities, player) {
        const c = this.c;
        const missing = (e) => {
            if (!e || !e.active) return 0;
            const cur = (e.data && typeof e.data.hp === 'number') ? e.data.hp : e.hp;
            const max = (e.data && e.data.maxHp) || e.maxHp || 0;
            if (!(cur > 0) || !(max > 0)) return 0;
            return Math.max(0, max - cur);
        };
        // 1) 玩家
        if (missing(player) > 0) return player;
        // 2) 自己
        if (missing(c) > 0) return c;
        // 3) 其他队友：缺血量最多者优先
        let bestTeammate = null;
        let bestMissing = 0;
        const members = (Game && Game.PartySystem && Game.PartySystem.members) || [];
        for (const m of members) {
            if (!m || m === c || !m.active) continue;
            const miss = missing(m);
            if (miss > bestMissing) { bestMissing = miss; bestTeammate = m; }
        }
        if (bestTeammate) return bestTeammate;
        // 4) 敌方：无友方缺血时打最近敌人
        return this._pickMeleeTarget(this._activeEnemies(entities), c);
    }

    /** 圣光施法（解锁/冷却就绪时按目标优先级出手；成功返回 true） */
    _tryHolyLight(entities, player) {
        const c = this.c;
        const sys = this._systems;
        if (!sys || !sys.holyLight) return false;
        if (!c.skills || !c.skills.holyLight) return false; // 未解锁（伊莉丝 5 级）
        if (c._holyLightCooldown > 0) return false;
        const target = this._pickHolyLightTarget(entities, player);
        if (!target) return false;
        if (!sys.holyLight.triggerOn(target)) return false;
        // 施法后短暂站定（伊莉丝无 spell 动画，直接出效果 + 小硬直防漂移）
        this._castRecoverTimer = Math.max(this._castRecoverTimer || 0, this.cfg.castRecoverMs || 200);
        this._lastAttackAt = Date.now();
        c._lastAction = 'cast';
        return true;
    }

    /**
     * 默认状态机：防御（范围内 >3 敌 或 有远程敌）> 近战攻击 > 追击 > 跟随玩家。
     * 防御/攻击期间冻结移动（_frozenForCast），由 _updateWarriorCombat 逐帧推进。
     */
    _tickWarrior(entities, player) {
        const c = this.c;
        const cfg = this.cfg;
        const enemies = this._activeEnemies(entities);

        // 防御中：站定播完整个防御流程（enter → hold → exit），不打断
        if (this._defendPhase) return;
        // 风车（whirlwind）：范围内目标达标且冷却就绪 → 优先释放（爆发技优先于防御兜底）；
        // 风车进行中站定
        if (this._whirlwindHitSet) return;
        // 圣光（2026-08-17）：玩家→自己→队友缺血优先治疗，敌方兜底伤害（伊莉丝 5 级解锁）
        if (this._tryHolyLight(entities, player)) return;
        if (c.skills && c.skills.whirlwind && this._whirlwindCd <= 0 && this._shouldWhirlwind(enemies)) {
            this._tryWhirlwind();
            return;
        }
        // 防御触发：条件满足且冷却就绪 → 举盾；冷却中（_defendCd>0）继续正常攻击/追击，
        // 避免"远程敌在场 → 15s 冷却内站桩发呆不攻击"（2026-08-15 排查修复）
        if (this._shouldDefend(enemies) && this._defendCd <= 0) {
            this._startDefend();
            return;
        }
        if (this._meleeAtkTimer > 0) return; // 攻击动画中：站定

        // 目标维护
        if (c.target && (!c.target.active || c.target.hp <= 0)) c.target = null;
        if (enemies.length && !c.target) c.target = this._pickMeleeTarget(enemies, c);
        const targetDist = c.target ? Math.hypot(c.target.x - c.x, c.target.y - c.y) : null;
        const meleeRange = cfg.meleeRange || 165;
        const engageRange = cfg.engageRange || 460;

        if (c.target && targetDist !== null && targetDist <= meleeRange + (c.target.groundRadius || 20)) {
            if (this._basicAtkCd <= 0) {
                this._tryMeleeAttack(c.target);
                return;
            }
            // 攻击冷却中：贴脸站定、面朝目标
            c._tacticalTarget = null;
            c.vx = 0; c.vy = 0; c.isMoving = false;
            c._animState = 'idle';
            c.rotation = Math.atan2(c.target.y - c.y, c.target.x - c.x);
            this._lastAction = 'idle';
            c._lastAction = 'idle';
            return;
        }
        if (c.target && targetDist !== null && targetDist <= engageRange) {
            c._tacticalTarget = { x: c.target.x, y: c.target.y };
            this._setMoveState(this._shouldRun(targetDist, 'advance') ? 'run' : 'walk');
            this._lastAction = 'advance';
            c._lastAction = 'advance';
            return;
        }
        // 无敌人/超出交战半径：跟随玩家
        const fp = this._followPoint(player);
        const fd = Math.hypot(fp.x - c.x, fp.y - c.y);
        if (fd > (cfg.followArriveDist || 55)) {
            c._tacticalTarget = fp;
            this._setMoveState(this._shouldRun(fd, 'follow') ? 'run' : 'walk');
            this._lastAction = 'follow';
            c._lastAction = 'follow';
        } else {
            // 到达跟随点：立即停步（2026-08-17 探针实锤"idle 漂移"根因）——此前只切了
            // idle 动画状态，_tacticalTarget 未清、速度未归零，MovementSystem 继续朝旧
            // 目标点推进剩余 ~55px（arriveDist 与寻路自身到达阈值之间的差距），
            // 角色以待机姿态滑行 ≈0.6s = 用户看到的"idle 漂移"。
            c._tacticalTarget = null;
            if (c._pathManager) c._pathManager._clearPath();
            c.vx = 0; c.vy = 0; c.isMoving = false;
            this._setMoveState('idle');
            this._lastAction = 'idle';
            c._lastAction = 'idle';
        }
    }

    /** 剑盾近战指令：aggressive 全图追击；patrol 圈内反击/游走；hold 待命；gather 近战采集 */
    _applyWarriorCommand(entities, player, cmd) {
        const c = this.c;
        if (cmd.mode !== 'move') c._surfaceRouteActive = false;
        // 待命/移动：立即打断攻击/防御/风车（否则要等 1.5~3s 动画播完才生效；
        // 移动=玩家右键最高优先级指令，先清掉一切进行中的指令状态再执行）
        if (cmd.mode === 'hold' || cmd.mode === 'move') {
            this._meleeAtkTimer = 0; this._meleeHitDone = false;
            this._defendPhase = null; this._defendTimer = 0;
            c._defendPhase = null; c._defending = false;
            this._whirlwindHitSet = null; this._whirlwindTimer = 0;
            c._castState = 'idle'; c._frozenForCast = false; c._castTimer = 0;
            this._pendingRelease = null; this._castDuration = 0; this._castRecoverTimer = 0;
            if (cmd.mode === 'move') {
                this._cmdMove(player, cmd);
            } else {
                c.target = null; c._tacticalTarget = null;
                if (c._pathManager) c._pathManager._clearPath();
                this._setMoveState('idle');
                c.vx = 0; c.vy = 0; c.isMoving = false;
                c._animState = 'idle';
            }
            return;
        }
        if (c._castState !== 'idle' || c._frozenForCast) return; // 攻击/防御锁定中
        this._setMoveState('idle');
        c.vx = 0; c.vy = 0; c.isMoving = false;
        c._tacticalTarget = null;
        switch (cmd.mode) {
            case 'hold': c.target = null; break;
            case 'aggressive': this._cmdWarriorAggressive(entities, player, null); break;
            case 'patrol': this._cmdWarriorAggressive(entities, player, cmd); break;
            case 'gather': this._cmdWarriorGather(entities, player, cmd); break;
            case 'attack': this._cmdWarriorAggressive(entities, player, null, cmd.target); break; // RTS 右键指定攻击
            case 'move': this._cmdMove(player, cmd); break; // 左键/右键纯移动（2026-08-16）
            default: this._cmdFollowOnly(player); break;
        }
        if (c.target) c.rotation = Math.atan2(c.target.y - c.y, c.target.x - c.x);
    }

    /**
     * 剑盾近战采集（2026-08-16）：走到距指令点最近的能源点，进近战范围后普通攻击
     * 挥砍采集（伤害 = atk×1.25，走 _dealMeleeHit 同口径）；袋满回玩家移交。
     * 此前 gather 对近战直接回落跟随（只写了远程弹体采集），伊莉丝“采集不执行”根因。
     */
    _cmdWarriorGather(entities, player, cmd) {
        const c = this.c;
        if (EnergyManager && EnergyManager.isFull()) {
            this._stopGatherForFullStorage();
            return;
        }
        // 旧运行状态兼容
        if (this._gatherPhase === 'return') {
            this._transferEnergyToPlayer(player);
            return;
        }
        // 找资源点：优先距指令点最近，否则距玩家最近；无节点回落跟随
        const nodes = [];
        for (const e of (entities && entities.values ? entities.values() : (entities || []))) {
            if (e && e._isEnergyNode && e.active && !e._depleted) nodes.push(e);
        }
        const ref = cmd.point || player;
        const node = pickNearestNode(nodes, ref) || pickNearestNode(nodes, player);
        if (!node) {
            this._cmdFollowOnly(player);
            return;
        }
        c.target = node;
        const d = Math.hypot(node.x - c.x, node.y - c.y);
        const meleeRange = (this.cfg.meleeRange || 165) + (node.groundRadius || 20);
        if (d > meleeRange) {
            c._tacticalTarget = { x: node.x, y: node.y };
            this._setMoveState(this._shouldRun(d, 'follow') ? 'run' : 'walk');
            return;
        }
        // 近战范围内：攻击冷却好就挥砍；冷却中贴脸站定
        if (this._basicAtkCd <= 0) {
            this._tryMeleeAttack(node);
            return;
        }
        c._tacticalTarget = null;
        c.vx = 0; c.vy = 0; c.isMoving = false;
        c._animState = 'idle';
    }

    /** 主动攻击/巡逻：追击最近敌人近战；防御条件满足仍优先举盾。
     *  forcedTarget 非空 = RTS 右键指定攻击目标（2026-08-16）：只打该目标，
     *  目标死亡/失活自动清除指令回落跟随。 */
    _cmdWarriorAggressive(entities, player, cmd, forcedTarget = null) {
        const c = this.c;
        const cfg = this.cfg;
        let enemies = this._activeEnemies(entities);
        if (forcedTarget) {
            if (!forcedTarget.active || forcedTarget.hp <= 0) {
                c._command = { mode: 'follow' };
                c.target = null;
                this._cmdFollowOnly(player);
                return;
            }
            if (!enemies.some((e) => e === forcedTarget)) enemies = [forcedTarget];
            c.target = forcedTarget;
        } else if (cmd) {
            enemies = enemies.filter(e => Math.hypot(e.x - c.x, e.y - c.y) <= CMD_PATROL_SENSE);
        }
        if (!enemies.length) {
            if (cmd) this._patrolWander(cmd);
            else this._cmdFollowOnly(player);
            return;
        }
        // 与默认状态机同口径：风车/防御优先级一致（风车优先），冷却中正常近战
        if (this._defendPhase) return;
        if (this._whirlwindHitSet) return;
        if (this._tryHolyLight(entities, player)) return;
        if (c.skills && c.skills.whirlwind && this._whirlwindCd <= 0 && this._shouldWhirlwind(enemies)) {
            this._tryWhirlwind();
            return;
        }
        if (this._shouldDefend(enemies) && this._defendCd <= 0) {
            this._startDefend();
            return;
        }
        if (this._meleeAtkTimer > 0) return;
        if (c.target && (!c.target.active || c.target.hp <= 0)) c.target = null;
        if (!c.target) c.target = this._pickMeleeTarget(enemies, c);
        const d = c.target ? Math.hypot(c.target.x - c.x, c.target.y - c.y) : null;
        if (c.target && d !== null && d <= (cfg.meleeRange || 165) + (c.target.groundRadius || 20)) {
            if (this._basicAtkCd <= 0) { this._tryMeleeAttack(c.target); return; }
            c.vx = 0; c.vy = 0; c.isMoving = false;
            c._animState = 'idle';
            return;
        }
        if (c.target) {
            c._tacticalTarget = { x: c.target.x, y: c.target.y };
            this._setMoveState(this._shouldRun(d, 'advance') ? 'run' : 'walk');
            return;
        }
        this._cmdFollowOnly(player);
    }

    /** 巡逻无目标：圈内随机游走（2~4s 换点；到位 idle） */
    _patrolWander(cmd) {
        const c = this.c;
        const center = cmd.point || { x: c.x, y: c.y };
        this._patrolTimer -= this.cfg.decisionMs || 120;
        const arrived = this._patrolTarget
            && Math.hypot(this._patrolTarget.x - c.x, this._patrolTarget.y - c.y) < 60;
        if (!this._patrolTarget || arrived || this._patrolTimer <= 0) {
            this._patrolTimer = 2000 + Math.random() * 2000;
            this._patrolTarget = pickPatrolPoint({ center, radius: CMD_PATROL_RADIUS });
        }
        c._tacticalTarget = this._patrolTarget;
        const d = Math.hypot(this._patrolTarget.x - c.x, this._patrolTarget.y - c.y);
        if (d > 60) this._setMoveState(this._shouldRun(d, 'follow') ? 'run' : 'walk');
    }

    /** 防御触发判定（纯函数委托 companion-ai-decision.shouldWarriorDefend） */
    _shouldDefend(enemies) {
        const c = this.c;
        const cfg = this.cfg;
        return shouldWarriorDefend({
            enemies,
            cx: c.x, cy: c.y,
            range: cfg.defendRange || 400,
            enemyCount: cfg.defendEnemyCount || 3,
            rangedRange: cfg.defendRangedRange || 350,
        });
    }

    /** 进入防御：enter（0.5s 播 1~8 帧）→ hold（2s 持盾减伤+常态弹反）→ exit（0.5s 播剩余） */
    _startDefend() {
        const c = this.c;
        if (this._defendPhase || this._defendCd > 0 || c._castState !== 'idle' || c._frozenForCast) return;
        const cfg = this.cfg;
        this._playSound('defending'); // 铠甲骑士防御音效（伊莉丝专属副本）
        this._defendPhase = 'enter';
        c._defendPhase = 'enter'; // 渲染层阶段镜像（GameScene 读 member._defendPhase，2026-08-17 修复"重复动画"）
        this._defendTimer = cfg.defendEnterMs || 500;
        c._defending = false; // 进入阶段尚未生效，hold 期才置位
        c._frozenForCast = true;
        c._animState = 'defend';
        c.vx = 0; c.vy = 0; c.isMoving = false;
        c.target = null;
        c._tacticalTarget = null;
        c._lastAction = 'defend';
        c._lastFaceRight = undefined; // 渲染层回退到最近敌人朝向
    }

    /** 防御状态机逐帧推进：enter → hold（持盾）→ exit → 结束；并推进防御冷却 */
    _updateWarriorCombat(dt, entities) {
        const c = this.c;
        const cfg = this.cfg;
        if (this._defendCd > 0) this._defendCd = Math.max(0, this._defendCd - dt);
        if (this._whirlwindCd > 0) this._whirlwindCd = Math.max(0, this._whirlwindCd - dt);

        // 风车推进：50ms 起每帧判定（GroundCircle 地面 footprint），持续到 duration 结束
        if (this._whirlwindHitSet) {
            this._whirlwindTimer += dt;
            const skill = c.skills && c.skills.whirlwind;
            const effect = skill ? skill.getEffect(skill.level) : {};
            const duration = effect.duration || 800;
            if (this._whirlwindTimer >= 50 && this._whirlwindTimer <= duration) {
                this._dealWhirlwindHits(entities, effect);
            }
            if (this._whirlwindTimer >= duration) {
                this._endWhirlwind();
            }
            return;
        }

        // 近战攻击推进：命中帧结算 + 动画结束解除冻结
        if (this._meleeAtkTimer > 0) {
            this._meleeAtkTimer -= dt;
            const total = cfg.attackAnimMs || 1500;
            const hitAt = ((cfg.attackHitFrame || 10) - 1) / (cfg.attackFrames || 28) * total;
            if (!this._meleeHitDone && (total - this._meleeAtkTimer) >= hitAt) {
                this._meleeHitDone = true;
                this._dealMeleeHit();
            }
            if (this._meleeAtkTimer <= 0) {
                this._meleeAtkTimer = 0;
                c._frozenForCast = false;
                c._animState = 'idle';
            }
            return;
        }

        // 防御推进
        if (!this._defendPhase) return;
        this._defendTimer -= dt;
        if (this._defendPhase === 'enter' && this._defendTimer <= 0) {
            this._defendPhase = 'hold';
            c._defendPhase = 'hold';
            this._defendTimer = cfg.defendHoldMs || 2000;
            c._defending = true; // 持盾防御 + 常态弹反生效
            // 持盾防御修炼：每次进入防御姿态按 meleeBlock 给经验（弹反另计，见 Companion.takeDamage）
            const sd = c.skills && c.skills.shieldDefense;
            if (sd) {
                const rw = sd.expRewards || {};
                grantCompanionSkillExp(c, 'shieldDefense', rw.meleeBlock || 2);
            }
        } else if (this._defendPhase === 'hold' && this._defendTimer <= 0) {
            this._defendPhase = 'exit';
            c._defendPhase = 'exit';
            this._defendTimer = cfg.defendExitMs || 500;
            c._defending = false;
        } else if (this._defendPhase === 'exit' && this._defendTimer <= 0) {
            this._defendPhase = null;
            c._defendPhase = null;
            this._defendTimer = 0;
            c._defending = false;
            c._frozenForCast = false;
            c._animState = 'idle';
            this._defendCd = cfg.defendCooldownMs || 3000;
        }
    }

    /** 风车触发判定：技能范围内（radius + swordRadiusBonus）目标 ≥ whirlwindMinTargets */
    _shouldWhirlwind(enemies) {
        const c = this.c;
        const cfg = this.cfg;
        const skill = c.skills && c.skills.whirlwind;
        if (!skill) return false;
        const effect = skill.getEffect(skill.level);
        const radius = (effect.radius || 120) + (effect.swordRadiusBonus || 80);
        return shouldWarriorWhirlwind({
            enemies,
            cx: c.x, cy: c.y,
            range: radius,
            minTargets: cfg.whirlwindMinTargets || 2,
        });
    }

    /** 释放风车：以自身为中心旋转武器，skill 数值驱动（damageMul/半径/击退/眩晕/时长/冷却） */
    _tryWhirlwind() {
        const c = this.c;
        const skill = c.skills && c.skills.whirlwind;
        if (!skill || this._whirlwindHitSet || c._castState !== 'idle' || c._frozenForCast) return;
        const effect = skill.getEffect(skill.level);
        this._whirlwindTimer = 0;
        this._whirlwindHitSet = new Set();
        this._whirlwindHits = 0;
        this._whirlwindKills = 0;
        this._whirlwindCd = (effect.cooldown || 8) * 1000;
        c._frozenForCast = true;
        c._animState = 'windmill';
        c._castState = 'idle';
        c.vx = 0; c.vy = 0; c.isMoving = false;
        c.target = null;
        c._tacticalTarget = null;
        this._lastAction = 'whirlwind';
        c._lastAction = 'whirlwind';
    }

    /** 风车命中结算：GroundCircle（地面 footprint 判定，与玩家风车同口径） */
    _dealWhirlwindHits(entities, effect) {
        const c = this.c;
        const radius = (effect.radius || 120) + (effect.swordRadiusBonus || 80);
        const damageMul = effect.damageMul || 1.5;
        const knockback = effect.knockback || 250;
        const stunDuration = effect.stunDuration || 2500;
        const finalDamage = Math.max(1, Math.round((c.data.atk || 0) * damageMul));
        const shape = new GroundCircle(c.x, c.y, radius);
        let hitCount = 0, killCount = 0;
        for (const e of this._activeEnemies(entities)) {
            if (!e || this._whirlwindHitSet.has(e)) continue;
            if (!shape.intersectsEntity(e)) continue;
            this._whirlwindHitSet.add(e);
            const wasAlive = e.hp > 0;
            if (typeof e.takeDamage === 'function') e.takeDamage(finalDamage, c, 'physical');
            if (wasAlive && e.hp <= 0) killCount++;
            hitCount++;
            if (typeof e.applyKnockback === 'function') {
                const ang = Math.atan2(e.y - c.y, e.x - c.x);
                e.applyKnockback(ang, knockback);
            }
            if (typeof e.applyStun === 'function') e.applyStun(stunDuration);
        }
        this._whirlwindHits += hitCount;
        this._whirlwindKills += killCount;
        this._lastAttackAt = Date.now();
        // 剑精通修炼（与玩家风车同步：风车命中也算剑类攻击）
        const sm = c.skills && c.skills.swordMastery;
        if (sm) {
            const rw = sm.expRewards || {};
            const gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
            if (gained > 0) grantCompanionSkillExp(c, 'swordMastery', gained);
        }
    }

    /** 风车结束：解除冻结 + 结算风车经验（hit/multiHit/kill） */
    _endWhirlwind() {
        const c = this.c;
        const skill = c.skills && c.skills.whirlwind;
        if (skill) {
            const rw = skill.expRewards || {};
            let gained = this._whirlwindHits * (rw.hit || 0);
            if (this._whirlwindHits >= 2) gained += rw.multiHit || 0;
            gained += this._whirlwindKills * (rw.kill || 0);
            if (gained > 0) grantCompanionSkillExp(c, 'whirlwind', gained);
        }
        this._whirlwindHitSet = null;
        this._whirlwindTimer = 0;
        this._whirlwindHits = 0;
        this._whirlwindKills = 0;
        c._frozenForCast = false;
        c._animState = 'idle';
    }

    /** 发起近战攻击：1.5s 动画（28 帧），命中帧由 _updateWarriorCombat 结算；攻击间隔 2s */
    _tryMeleeAttack(target) {
        const c = this.c;
        const cfg = this.cfg;
        this._basicAtkCd = cfg.attackInterval || 2000;
        this._meleeAtkTimer = cfg.attackAnimMs || 1500;
        this._meleeHitDone = false;
        c._frozenForCast = true;
        c._animState = 'attack';
        c._castState = 'idle';
        c.vx = 0; c.vy = 0; c.isMoving = false;
        c.rotation = Math.atan2(target.y - c.y, target.x - c.x);
        this._lastAction = 'attack';
        c._lastAction = 'attack';
        this._playSound('attacking'); // 铠甲骑士攻击音效（伊莉丝专属副本）
    }

    /** 播放伊莉丝动作音效（世界空间音源；无 SoundManager/路径缺失时静默跳过） */
    _playSound(key) {
        const path = ELISE_SOUNDS[key];
        if (!path || !SoundManager) return;
        if (typeof SoundManager.playWorld === 'function') {
            SoundManager.playWorld(path, this.c.x, this.c.y);
        } else if (typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    /** 命中帧结算：物理攻击 ×1.25，目标已出范围则空挥 */
    _dealMeleeHit() {
        const c = this.c;
        const t = c.target;
        if (!t || !t.active || t.hp <= 0) return;
        const d = Math.hypot(t.x - c.x, t.y - c.y);
        const range = (this.cfg.meleeRange || 165) + (t.groundRadius || 20);
        if (d > range + 20) return; // 目标走出范围：空挥
        if (Math.abs((Number(c.z) || 0) - (Number(t.z) || 0)) > (Number(c.meleeVerticalReach) || 48)) return;
        const dmg = Math.max(1, Math.floor((c.data.atk || 0) * (this.cfg.attackDamageMul || 1.25)));
        if (typeof t.takeDamage === 'function') t.takeDamage(dmg, c, 'physical');
        // 普通攻击眩晕：与玩家近战一段同口径（attackStunMs，默认 1000ms，
        // 对应 public/data/weapon-anim-config.json sword.attack.hitCheck.stunMs），
        // 仅普通类型怪物有效（rank 缺省视为 normal，精英/领主/minor 不受影响）
        if (typeof t.applyStun === 'function' && (this.cfg.attackStunMs || 0) > 0
            && (t.rank || 'normal') === 'normal') {
            t.applyStun(this.cfg.attackStunMs);
        }
        // 击退：与玩家近战一段同口径（attackKnockback，默认 50px），径向击退
        // （玩家近战击退不区分怪类型，与眩晕仅普通怪的守卫分开）
        const kb = this.cfg.attackKnockback || 0;
        if (kb > 0 && typeof t.applyKnockback === 'function') {
            t.applyKnockback(Math.atan2(t.y - c.y, t.x - c.x), kb);
        }
        // 剑精通修炼：命中 +hit，击杀 +kill（与玩家 addMeleeExp 同 expRewards）
        const sm = c.skills && c.skills.swordMastery;
        if (sm) {
            const rw = sm.expRewards || {};
            let gained = rw.hit || 0;
            if (t.hp <= 0) gained += rw.kill || 0;
            if (gained > 0) grantCompanionSkillExp(c, 'swordMastery', gained);
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(t.x, t.y - 30, `-${dmg}`, '#ffb45e'));
        }
        this._lastAttackAt = Date.now(); // 输出中：卡死判定窗口重置
    }

    /** 近战目标：最近敌人 */
    _pickMeleeTarget(enemies, c) {
        let best = null; let bestD = Infinity;
        for (const e of enemies) {
            const d = Math.hypot(e.x - c.x, e.y - c.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    // ==================== 技能 ====================

    _pickReadySpell(enemies, target, targetDist) {
        const c = this.c;
        if (!hasRangedLineOfSight(c, target)) return null;
        // 内置施法 CD（2026-08-15）：所有法术共享 2s 最小释放间隔
        if (c._castCooldown > 0) return null;
        const cds = { fireball: c._fireballCooldown, iceSpike: c._iceSpikeCooldown, lightningStrike: c._lightningStrikeCooldown };
        const mpCosts = {}; const ranges = {};
        for (const key of ['fireball', 'iceSpike', 'lightningStrike']) {
            const sk = c.skills && c.skills[key];
            if (!sk) { cds[key] = Infinity; continue; }
            const eff = sk.getEffect(sk.level);
            mpCosts[key] = eff.mpCost || 0;
            ranges[key] = (eff.maxRange || SKILL_RANGE_FALLBACK[key] || 0)
                * getMagicRangeMultiplier(c);
        }
        const grouped = enemies.length >= 2 && enemies.some(a =>
            enemies.some(b => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < 200));
        return pickCompanionSpell({
            cds, mp: c.data.mp, mpCosts, targetDist, ranges,
            targetCount: enemies.length, grouped,
        });
    }

    _tryCast(key, target) {
        const c = this.c;
        const sys = this._systems;
        if (!sys) return;
        const skill = c.skills && c.skills[key];
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        const mpCost = effect.mpCost || 0;
        if (c.data.mp < mpCost) return;

        try {
            // BoltSkillSystem 非玩家需二次 trigger：第一次凝聚（动画前摇），
            // 第二次在 spell 动画 50% 处由 _releasePending 发射
            if (key === 'fireball') sys.fireball.trigger();
            else if (key === 'iceSpike') sys.iceSpike.trigger();
            // lightningStrike 一次 trigger 即释放，延迟到 50% 再调
        } catch (e) {
            if (typeof console !== 'undefined') console.error('[CompanionAI] 施法异常:', key, e);
            return;
        }
        // 施法 CD 在 50% 释放成功后设（见 _releasePending）；凝聚时保持 CD 0，
        // 否则 BoltSkillSystem.trigger 冷却检查拦截第二次 trigger（火球不发射）
        this._pendingRelease = { type: 'spell', key, mpCost, cooldownMs: (effect.cooldown || 20) * 1000 };
        this._castDuration = this.cfg.castFrozenMs || 650;
        c._castState = 'casting';
        c._frozenForCast = true;
        c._castTimer = this._castDuration;
        c._castCooldown = this.cfg.castCooldown || 2000;
        c._animState = 'spell';
        c.rotation = Math.atan2(target.y - c.y, target.x - c.x);
    }

    /** 普通攻击就绪：间隔 CD 到、无飞行中光球、目标在射程内 */
    _basicReady(targetDist, target = this.c.target) {
        return this._basicAtkCd <= 0
            && !this.c._basic
            && targetDist <= this._basicAttackRange()
            && hasRangedLineOfSight(this.c, target);
    }

    /** 普通攻击：发射蓝色光球（600px/s），攻击动作播 spell 动画（500ms） */
    _tryBasicAttack(target) {
        const c = this.c;
        this._basicAtkCd = this.cfg.basicAttackInterval || 2000;
        // 延迟到 spell 动画 50% 处生成光球（_releasePending → _spawnBasic）
        this._pendingRelease = { type: 'basic', target };
        this._castDuration = 500; // 普通攻击动作时长（播 spell 动画）
        c._castState = 'casting';
        c._frozenForCast = true;
        c._castTimer = this._castDuration;
        c._animState = 'spell';
        c.rotation = Math.atan2(target.y - c.y, target.x - c.x);
    }

    /** 生成普通攻击光球（提前量瞄准，与远程怪物同款 AimHelper.lead） */
    _spawnBasic(target) {
        const c = this.c;
        if (!target || !target.active) return;
        const speed = this.cfg.basicAttackSpeed || 600;
        const startZ = projectileSourceZ(c);
        const targetZ = projectileTargetZ(target);
        const lead = AimHelper.lead(
            c.x,
            c.y,
            target.x,
            target.y,
            target.vx || 0,
            target.vy || 0,
            speed
        );
        const ang = Math.atan2(lead.y - c.y, lead.x - c.x);
        const targetDist = Math.max(1, Math.hypot(lead.x - c.x, lead.y - c.y));
        // 存 companion 字段（GameScene._syncCompanionBasics 读 m._basic 渲染光球）
        c._basic = {
            active: true,
            x: c.x,
            y: c.y,
            z: startZ,
            vz: (targetZ - startZ) / Math.max(0.001, targetDist / speed),
            angle: ang,
            dist: 0,
            maxDist: this._basicAttackRange(),
            wallContext: projectileWallContext(c),
            target,
        };
    }

    /** 普通攻击光球飞行推进 + 命中结算（伤害 = 魔法攻击 × 0.2） */
    _updateBasic(dt) {
        const c = this.c;
        const b = c._basic;
        if (!b || !b.active) return;
        const dtSec = dt / 1000;
        const step = (this.cfg.basicAttackSpeed || 600) * dtSec;
        const prevX = b.x;
        const prevY = b.y;
        const prevZ = Number(b.z) || 0;
        b.x += Math.cos(b.angle) * step;
        b.y += Math.sin(b.angle) * step;
        b.z = prevZ + (Number(b.vz) || 0) * dtSec;
        b.dist += step;
        if (WallSystem.projectileBlocked?.(
            prevX,
            prevY,
            prevZ,
            b.x,
            b.y,
            b.z,
            b.wallContext || projectileWallContext(c)
        )) {
            c._basic = null;
            return;
        }
        // 命中检测：优先发射目标，其次光球路径上经过的所有敌人——
        // 此前只查 b.target，路径上的其他怪物会被光球直接穿过（2026-08-15）
        let hit = null;
        const t = b.target;
        const hits = (entity) => {
            const bottom = entity?.collider?.bottomZ ?? (Number(entity?.z) || 0);
            const top = entity?.collider?.topZ
                ?? (bottom + (entity?.bodyHeight || entity?.size || 80));
            return Math.hypot(entity.x - b.x, entity.y - b.y) < 30
                && b.z >= bottom - 30
                && b.z <= top + 30;
        };
        if (t && t.active && t.hp > 0 && hits(t)) {
            hit = t;
        } else if (Game && Game.entities) {
            for (const e of Game.entities.values()) {
                if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy') continue;
                if (hits(e)) { hit = e; break; }
            }
        }
        if (hit) {
            const dmg = Math.max(1, Math.floor((c.data.matk || 0) * (this.cfg.basicAttackDamageMul || 1.0)));
            if (typeof hit.takeDamage === 'function') hit.takeDamage(dmg, c, 'magic');
            EffectManager.add(new FloatingTextEffect(hit.x, hit.y - 30, `-${dmg}`, '#6ab0ff'));
            this._lastAttackAt = Date.now(); // 命中 → 明确造成伤害
            c._basic = null;
        } else if (b.dist >= b.maxDist) {
            c._basic = null; // 到射程静默消失
        }
    }

    // ==================== 目标/威胁 ====================

    _activeEnemies(entities) {
        const out = [];
        const iter = entities && entities.values ? entities.values() : entities || [];
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            out.push(e);
        }
        return out;
    }

    _nearestMeleeThreat(enemies, c) {
        let best = null; let bestD = Infinity;
        for (const e of enemies) {
            const ranged = !!(e.attacks && e.attacks.ranged);
            const range = e.attackRange ?? 70;
            if (ranged && range >= MELEE_THREAT_RANGE) continue;
            if (!ranged && range >= MELEE_THREAT_RANGE) continue;
            const d = Math.hypot(e.x - c.x, e.y - c.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    /** 近战威胁包装：fleeEnabled=false 时禁用躲避（露娜 2026-08-15 暂不躲避） */
    _meleeThreat(enemies, c) {
        if (this.cfg.fleeEnabled === false) return { threat: null, threatDist: null };
        const threat = this._nearestMeleeThreat(enemies, c);
        return { threat, threatDist: threat ? Math.hypot(threat.x - c.x, threat.y - c.y) : null };
    }

    _pickTarget(enemies, c) {
        // 远程后排：只锁定施法距离 1.3 倍内的目标，避免跨图追残血；
        // 范围内无目标时才退回最近者
        const maxPick = this._combatRange() * 1.3;
        const near = enemies.filter(e => Math.hypot(e.x - c.x, e.y - c.y) <= maxPick);
        const pool = near.length ? near : enemies;
        let best = null; let bestScore = -Infinity;
        for (const e of pool) {
            const d = Math.hypot(e.x - c.x, e.y - c.y);
            const hpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 0;
            // 近 + 低血 优先（低血加成只在候选池内生效）
            const score = (10000 / (d + 80)) + (1 - hpRatio) * 300;
            if (score > bestScore) { bestScore = score; best = e; }
        }
        return best;
    }

    // ==================== 空间计算 ====================

    /**
     * 玩家附近合法落点：跟随点优先，8 方向螺旋外扩（参照 summon-helper.findSpawnPosition），
     * WallSystem.canMoveTo 校验；全部失败用 findSafeSpawn；最终兜底玩家脚下。
     */
    _findValidSpawn(player) {
        const off = this.cfg.followOffset || 150;
        const radius = (this.c.groundRadius || 26) * 0.8;
        const candidates = [
            { x: player.x - off, y: player.y + 34 },
            { x: player.x + off, y: player.y + 34 },
        ];
        for (const dist of [off, off + 60, off + 120, off + 200]) {
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                candidates.push({ x: player.x + Math.cos(angle) * dist, y: player.y + Math.sin(angle) * dist });
            }
        }
        if (WallSystem && typeof WallSystem.canMoveTo === 'function') {
            for (const candidate of candidates) {
                if (WallSystem.canMoveTo(
                    candidate.x,
                    candidate.y,
                    radius,
                    WallSystem.ignoreForEntity?.(this.c) || null
                )) return candidate;
            }
            if (typeof WallSystem.findSafeSpawn === 'function') {
                const r = WallSystem.findSafeSpawn(player.x, player.y, radius);
                if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return r;
            }
        }
        // 最终兜底：玩家脚下（玩家本身可站立，一定合法）
        return { x: player.x, y: player.y };
    }

    _followPoint(player) {
        const off = this.cfg.followOffset || 150;
        const dir = player._facingDir === 'left' ? 1 : -1;
        const now = Date.now();
        if (this._followCache && now - this._followCache.t < 500) return this._followCache.p;
        // 跟随点优先走合法落点（避免目标点在墙内导致寻路失败/卡墙）
        let best = { x: player.x + dir * off, y: player.y + 34 };
        if (WallSystem && typeof WallSystem.canMoveTo === 'function') {
            const radius = (this.c.groundRadius || 26) * 0.8;
            if (!WallSystem.canMoveTo(best.x, best.y, radius)) {
                best = this._findValidSpawn(player);
            }
        }
        this._followCache = { t: now, p: best };
        return best;
    }

    _standPoint(target, standRange) {
        const c = this.c;
        const dx = c.x - target.x; const dy = c.y - target.y;
        const d = Math.hypot(dx, dy) || 1;
        return { x: target.x + (dx / d) * standRange, y: target.y + (dy / d) * standRange };
    }

    _retreatPoint(threat, player) {
        const c = this.c;
        const safe = this.cfg.safeDistance || 230;
        const dx = c.x - threat.x; const dy = c.y - threat.y;
        const d = Math.hypot(dx, dy) || 1;
        const awayX = dx / d; const awayY = dy / d;
        // 背离威胁 + 朝玩家分量，避免越退越远
        const px = player.x - c.x; const py = player.y - c.y;
        const pd = Math.hypot(px, py) || 1;
        const dirX = awayX * 0.7 + (px / pd) * 0.3;
        const dirY = awayY * 0.7 + (py / pd) * 0.3;
        const len = Math.hypot(dirX, dirY) || 1;
        return { x: c.x + (dirX / len) * (safe + 60), y: c.y + (dirY / len) * (safe + 60) };
    }
}
