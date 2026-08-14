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
import { SceneManager } from '../world/scene-manager.js';
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { FireballSystem } from '../entities/components/fireball-system.js';
import { IceSpikeSystem } from '../entities/components/ice-spike-system.js';
import { LightningStrikeSystem } from '../entities/components/lightning-strike-system.js';
import { HolyLightSystem } from '../entities/components/holy-light-system.js';
import {
    DEFAULT_MAGE_AI, decideCompanionAction, pickCompanionSpell,
    shouldRelocateCompanion, shouldUseRun,
} from './companion-ai-decision.js';

const MELEE_THREAT_RANGE = 220; // 攻击距离低于此值视为近战威胁
// 技能射程兜底（与技能系统默认一致；skills.json effectFormula 通常不含 maxRange）
const SKILL_RANGE_FALLBACK = { fireball: 1200, iceSpike: 800, lightningStrike: 600 };

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
        this._lastPlayerDist = null; // 掉队判定：记录上一帧与玩家距离，检测是否在有效追赶
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
        this._relocateTimer -= dt;
        if (this._relocateTimer <= 0) {
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

        // 移动（MovementSystem：寻路跟随/撤退/站位，施法锁定自动停步）
        MovementSystem.update(c, dt, entities);

        // 队友防卡死：位移型卡死检测 + 瞬移脱离（只作用于队员，不影响玩家/敌人；
        // 门闸等动态障碍 MovementSystem 的 GATE-WAIT 面向怪物选择等待，队友直接瞬移跟上）
        this._teleportCd = Math.max(0, this._teleportCd - dt);
        this._checkStuck(dt, player);

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
        const inWall = !!(WallSystem && typeof WallSystem.canMoveTo === 'function'
            && !WallSystem.canMoveTo(c.x, c.y, (c.groundRadius || 26) * 0.8));
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
        // 施法站定/无生命不检测
        if (c._castState !== 'idle' || c._frozenForCast || c.data.hp <= 0) {
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
                    if (!WallSystem.canMoveTo(px, py, radius)) continue;
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
        this._castTimer -= dt;
        if (this._castTimer <= 0) {
            c._castState = 'idle';
            c._frozenForCast = false;
            c._animState = 'idle';
        }
    }

    // ==================== 决策 ====================

    _tick(entities, player) {
        const c = this.c;
        const enemies = this._activeEnemies(entities);
        const threat = this._nearestMeleeThreat(enemies, c);
        const threatDist = threat ? Math.hypot(threat.x - c.x, threat.y - c.y) : null;
        const hasEnemy = enemies.length > 0;
        const fleeNow = threatDist !== null && threatDist < (this.cfg.safeDistance || 230);

        // 目标维护
        if (c.target && (!c.target.active || c.target.hp <= 0)) c.target = null;
        // 撤退期间不锁定攻击目标：避免 MovementSystem 以 target 重算路径（会覆盖撤退点）
        if (hasEnemy && !c.target && !fleeNow) {
            c.target = this._pickTarget(enemies, c);
        }
        const targetDist = c.target ? Math.hypot(c.target.x - c.x, c.target.y - c.y) : null;

        // 技能就绪判断（含射程/MP/冷却）
        const spell = hasEnemy && c.target ? this._pickReadySpell(enemies, c.target, targetDist) : null;

        // 状态机：follow 距离以"到跟随点"为准（到玩家距离恒为偏移量，会导致永远走不到而停不下来）
        const followPoint = hasEnemy ? null : this._followPoint(player);
        const followDist = followPoint ? Math.hypot(followPoint.x - c.x, followPoint.y - c.y) : null;
        const action = decideCompanionAction({
            casting: c._castState !== 'idle' || c._frozenForCast,
            hasEnemy,
            threatDist,
            safeDistance: this.cfg.safeDistance || 230,
            targetDist,
            combatRange: this.cfg.combatRange || 640,
            spellReady: !!spell,
            followDist,
            followArriveDist: this.cfg.followArriveDist || 55,
        });
        this._lastAction = action;
        this._applyAction(action, { player, enemies, threat, targetDist, spell });
        // 施法站定期间动画保持 spell（后续决策 tick 不应覆盖）
        if (c._castState !== 'idle' || c._frozenForCast) c._animState = 'spell';
    }

    _applyAction(action, ctx) {
        const c = this.c;
        const { player, threat, targetDist, spell } = ctx;
        c._tacticalTarget = null;

        switch (action) {
            case 'cast':
                if (spell && c.target) this._tryCast(spell, c.target);
                break;
            case 'flee':
                if (threat) {
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
                    const standRange = (this.cfg.combatRange || 640) * 0.72;
                    if (targetDist !== null && targetDist > standRange * 0.9) {
                        const sp = this._standPoint(c.target, standRange);
                        // 远程后排不追远目标：站位点离玩家过远 → 站桩等目标进射程
                        // （避免在地牢里追怪跑离玩家，导致跑丢/卡墙外）
                        const maxFollow = (this.cfg.followOffset || 150) * 3.3;
                        if (Math.hypot(sp.x - player.x, sp.y - player.y) <= maxFollow) {
                            c._tacticalTarget = sp;
                            // 寻找位置输出：路程远（直线/绕墙路径）→ run；近距离站位微调 → walk
                            const dist = Math.hypot(sp.x - c.x, sp.y - c.y);
                            const pathLen = this._remainingPathLength();
                            this._setMoveState(this._shouldRun(Math.max(dist, pathLen ?? dist), 'advance') ? 'run' : 'walk');
                        } else {
                            this._setMoveState('idle');
                        }
                    } else {
                        this._setMoveState('idle');
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
                    const pathLen = this._remainingPathLength();
                    this._setMoveState(this._shouldRun(Math.max(dist, pathLen ?? dist), 'follow') ? 'run' : 'walk');
                } else {
                    this._setMoveState('idle');
                }
                break;
            }
            default:
                this._setMoveState('idle');
                c.vx = 0; c.vy = 0; c.isMoving = false;
        }
    }

    /** 设置移动动画状态并同步移动速度（run → runSpeed，walk/idle → walkSpeed） */
    _setMoveState(state) {
        const c = this.c;
        c._animState = state;
        c.maxSpeed = state === 'run' ? (this.cfg.runSpeed || 185) : (this.cfg.walkSpeed || 115);
    }

    /**
     * 预寻路整合：剩余路径长度（PathManager.path 逐段累加）。
     * 比直线距离更真实——绕墙/绕门时路径远但直线近，跑/走判定应看实际要走的路程。
     * @returns {number|null} 无路径时返回 null
     */
    _remainingPathLength() {
        const pm = this.c && this.c._pathManager;
        if (!pm || !pm.path || pm.path.length < 2) return null;
        let len = 0;
        for (let i = 1; i < pm.path.length; i++) {
            len += Math.hypot(pm.path[i].x - pm.path[i - 1].x, pm.path[i].y - pm.path[i - 1].y);
        }
        return len;
    }

    /**
     * walk/run 判定（2026-08-14 用户需求）：
     * flee（逃避敌人）永远 run；其余按移动距离——超过 runDist 用 run（长距离奔袭/寻找输出位置），
     * 小范围移动用 walk。距离优先取预寻路剩余路径长度（更能反映真实路程）。
     */
    _shouldRun(dist, mode) {
        return shouldUseRun(mode, dist, this.cfg);
    }

    // ==================== 技能 ====================

    _pickReadySpell(enemies, target, targetDist) {
        const c = this.c;
        const cds = { fireball: c._fireballCooldown, iceSpike: c._iceSpikeCooldown, lightningStrike: c._lightningStrikeCooldown };
        const mpCosts = {}; const ranges = {};
        for (const key of ['fireball', 'iceSpike', 'lightningStrike']) {
            const sk = c.skills && c.skills[key];
            if (!sk) { cds[key] = Infinity; continue; }
            const eff = sk.getEffect(sk.level);
            mpCosts[key] = eff.mpCost || 0;
            ranges[key] = eff.maxRange || SKILL_RANGE_FALLBACK[key] || 0;
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

        c.data.mp -= mpCost;
        try {
            // BoltSkillSystem 非玩家需二次 trigger：第一次凝聚、第二次立即发射
            if (key === 'fireball') { sys.fireball.trigger(); sys.fireball.trigger(); }
            else if (key === 'iceSpike') { sys.iceSpike.trigger(); sys.iceSpike.trigger(); }
            else if (key === 'lightningStrike') sys.lightning.trigger();
        } catch (e) {
            if (typeof console !== 'undefined') console.error('[CompanionAI] 施法异常:', key, e);
            c.data.mp += mpCost; // 回滚 MP
        }
        // 施法冷却（非玩家侧由 AI 自行管理）
        if (key === 'fireball') c._fireballCooldown = (effect.cooldown || 20) * 1000;
        else if (key === 'iceSpike') c._iceSpikeCooldown = (effect.cooldown || 10) * 1000;
        else c._lightningStrikeCooldown = Math.max(c._lightningStrikeCooldown, (effect.cooldown || 3) * 1000);

        c._castState = 'casting';
        c._frozenForCast = true;
        c._castTimer = this.cfg.castFrozenMs || 650;
        c._castCooldown = this.cfg.castCooldown || 350;
        c._animState = 'spell';
        c.rotation = Math.atan2(target.y - c.y, target.x - c.x);
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

    _pickTarget(enemies, c) {
        // 远程后排：只锁定施法距离 1.3 倍内的目标，避免跨图追残血；
        // 范围内无目标时才退回最近者
        const maxPick = (this.cfg.combatRange || 640) * 1.3;
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
            for (const c of candidates) {
                if (WallSystem.canMoveTo(c.x, c.y, radius)) return c;
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
