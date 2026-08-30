// ============================================================
// HamsterScoutAI — 仓鼠斥候 AI（2026-08-17）
// 玩家友方远程单位：在世界-122 自动寻找最近敌人射击。
// - 只认 _faction==='enemy' 的单位，能源矿点（_isEnergyNode）一律不攻击；
// - 参考仓鼠射手远程模式：AimHelper.lead 提前量瞄准「目标贴图中心」，
//   攻击动画第 11 帧（launchFrame）发射投射物，每 2.5s 一支，25 物理伤害；
// - 无敌人时跟随玩家（保持 followOffset 站位，到位清路径/归零速度防滑步）；
// - 移动复用 MovementSystem（寻路/墙碰撞/避障），射击中站定。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { clearRtsSurfaceRoute, finishRtsCommandAtHold, resolveRtsMoveDestination, getRtsAcquireRange } from './rts-command-utils.js';
import { AimHelper } from '../utils/aim-helper.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SoundManager } from '../ui/sound-manager.js';
import { tryApplyMarkArrow } from '../combat/mark-arrow-effect.js';
import {
    applyProjectileWallImpact,
    applyElevatedRangedRange,
    canUseWallTopModelException,
    projectileWallContext,
    wallHitSupportsTarget,
} from '../combat/elevated-ranged.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import { queryNearbyEntities, stableAiPhase } from './friendly-spatial-query.js';

const PROJECTILE_HIT_RADIUS = 28; // 命中半径（瞄准中心，与射手一致）

export class HamsterScoutAI {
    constructor(scout) {
        this.m = scout;
        this.cfg = scout.aiConfig || {};
        this._decisionTimer = stableAiPhase(scout, this.cfg.decisionMs ?? 120);
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2500;
        this._attackDamage = this.cfg.attackDamage ?? 25;
        this._attackRange = this.cfg.attackRange ?? 600;
        this._engageRange = getRtsAcquireRange(scout);
        this._projectileSpeed = this.cfg.projectileSpeed ?? 600;
        this._followOffset = this.cfg.followOffset ?? 140;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;
        // 攻击动画帧率/第 11 帧出膛（用户口径）：
        // 发射延迟 = (launchFrame-1) / fps；整段动画时长 = frameCount / fps
        const animCfg = (scout.animations && scout.animations.attack) || {};
        const fps = this.cfg.attackAnimFps ?? animCfg.frameRate ?? 12;
        const launchFrame = this.cfg.attackLaunchFrame ?? 21;
        const frameCount = animCfg.frameCount || 35;
        this._launchDelayMs = Math.max(0, (launchFrame - 1) / fps * 1000);
        this._shotAnimMs = frameCount / fps * 1000 + 60; // +60ms 余量：动画播完再切 idle，防攻击动画被打断
        // 射击状态：_shotActive=true 期间站定（站到动画播完回 idle）
        this._shotActive = false;
        this._shotTimer = 0;
        this._shotAnimLeft = 0;
        // 卡死看门狗（矿工/战士/射手同款兜底）
        this._stuckTimer = 0;
        this._lastPosX = 0;
        this._lastPosY = 0;
        this._stuckStreak = 0;
    }

    /** RTS 移动/待命立即取消尚未出膛的射击动作；已飞出的投射物继续飞行。 */
    cancelForCommand() {
        this._shotActive = false;
        this._shotTimer = 0;
        this._shotAnimLeft = 0;
        this.m._attackSwing = false;
        this.m._animState = 'idle';
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
    }

    _effectiveAttackRange() {
        return applyElevatedRangedRange(this.m, this._attackRange);
    }

    _canShootTarget(target) {
        return hasRangedLineOfSight(this.m, target);
    }

    /**
     * 每帧入口（由 HamsterScout.update 调用）。
     * @param {number} dt 毫秒
     * @param {Map|Array} entities Game.entities
     * @param {object|null} player 玩家（无敌人时跟随目标）
     */
    update(dt, entities, player) {
        const m = this.m;
        if (m.data.hp <= 0 || m._dying) return;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        // 飞行中投射物推进（优先于一切状态）
        this._updateProjectile(dt);

        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }

        // 射击中：站定 → 到发射延迟出膛 → 动画播完回 idle
        if (this._shotActive) {
            // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
            const damp = Math.pow(0.85, dt / 16.67);
            m.vx *= damp;
            m.vy *= damp;
            if (Math.abs(m.vx) < 1 && Math.abs(m.vy) < 1) { m.vx = 0; m.vy = 0; }
            m.isMoving = false;
            m.maxSpeed = 0;
            m._animState = 'attack';
            this._shotTimer -= dt;
            if (this._shotTimer <= 0) {
                this._fireProjectile();
                this._shotTimer = Number.POSITIVE_INFINITY; // 只发射一次
            }
            this._shotAnimLeft -= dt;
            if (this._shotAnimLeft <= 0) {
                this._shotActive = false;
                m._attackSwing = false; // 挥击结束主动清标记（防动画被打断时渲染层残留）
                m._animState = 'idle';
            }
            return;
        }

        // 防御性复位：非射击中不允许残留攻击状态
        if (m._animState === 'attack') {
            m._animState = 'idle';
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
        }

        // 移动中：交给 MovementSystem 寻路推进
        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
        // 缓停滑行（maxSpeed=0 后速度沿摩擦/加速度渐近归零）期间保持 walk 动画，
        // 避免站着播 idle 却还在滑行的"滑冰"感
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
    }

    /** 决策 tick：有敌追击/射击，无敌跟随玩家 */
    _tick(entities, player) {
        const m = this.m;
        if (this._shotActive) {
            m._animState = 'attack';
            return;
        }
        // RTS 指挥命令优先（2026-08-16）：move 走到指令点，attack 锁定指定目标
        const cmd = m._command;
        if (cmd && cmd.mode && cmd.mode !== 'follow') {
            this._applyCommand(cmd);
            return;
        }
        const enemy = this._nearestEnemy(entities, m);
        if (enemy) {
            m.target = enemy;
            const dist = Math.hypot(enemy.x - m.x, enemy.y - m.y);
            if (dist <= this._effectiveAttackRange() && this._canShootTarget(enemy)) {
                // 进入射程：站定；开火节奏由 attackTimer 控制
                m._tacticalTarget = null;
                m.maxSpeed = 0;
                m.rotation = Math.atan2(enemy.y - m.y, enemy.x - m.x);
                m._lastFaceRight = enemy.x >= m.x;
                if (this._attackTimer <= 0) {
                    // 开始一次射击（动画播一遍，第 11 帧出膛）
                    this._attackTimer = this._attackInterval;
                    this._shotActive = true;
                    this._shotTimer = this._launchDelayMs;
                    this._shotAnimLeft = this._shotAnimMs;
                    m._animState = 'attack';
                    m._attackSwing = true; // 渲染层播攻击动画
                } else {
                    m._animState = 'idle'; // 间隔期待机（速度不清零，交给 MovementSystem 渐近减速）
                }
                return;
            }
            // 目标在交战半径内但超出射程：走位拉近距离
            m._tacticalTarget = { x: enemy.x, y: enemy.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 150;
            return;
        }

        // 无敌人：跟随玩家（保持 followOffset 左侧站位）
        m.target = null;
        if (player) {
            const fx = player.x - this._followOffset;
            const fy = player.y;
            const dist = Math.hypot(fx - m.x, fy - m.y);
            if (dist <= this._followArriveDist) {
                m._tacticalTarget = null;
                m._animState = 'idle';
                // 不再瞬时清零速度：由 MovementSystem 摩擦衰减完成缓停
                m.maxSpeed = 0;
                if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
                    m._pathManager._clearPath();
                }
            } else {
                m._tacticalTarget = { x: fx, y: fy, _surfaceTarget: player };
                m._animState = 'walk';
                // 接近站位点缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
                const walkSpeed = this.cfg.walkSpeed ?? 150;
                const slow = Math.min(1, dist / 120);
                m.maxSpeed = walkSpeed * Math.max(0.3, slow);
            }
        } else {
            m._tacticalTarget = null;
            m._animState = 'idle';
            // 速度不清零，由 MovementSystem 摩擦衰减缓停
            m.maxSpeed = 0;
        }
    }

    /** RTS 命令：move（走到点，到位清指令）/ attack（锁定目标，进射程站定射击）/ hold（待命） */
    _applyCommand(cmd) {
        const m = this.m;
        if (cmd.mode !== 'move' && !m._surfaceNavCommand) clearRtsSurfaceRoute(m);
        if (cmd.mode === 'move') {
            m.target = null;
            const move = resolveRtsMoveDestination(m, cmd);
            if (!move.arrived) {
                m._tacticalTarget = move.destination;
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 150;
            } else {
                clearRtsSurfaceRoute(m);
                finishRtsCommandAtHold(m);
                m._tacticalTarget = null;
                m._animState = 'idle';
                // 速度不清零，由 MovementSystem 摩擦衰减完成缓停
                m.maxSpeed = 0;
            }
            return;
        }
        if (cmd.mode === 'attack') {
            const t = cmd.target;
            if (!t || !t.active || t.hp <= 0) {
                finishRtsCommandAtHold(m);
                m.target = null;
                m._animState = 'idle';
                return;
            }
            m.target = t;
            const dist = Math.hypot(t.x - m.x, t.y - m.y);
            if (dist <= this._effectiveAttackRange() && this._canShootTarget(t)) {
                // 进射程：站定 + 启动一次射击（与索敌分支同口径）
                m._tacticalTarget = null;
                m.maxSpeed = 0;
                m.rotation = Math.atan2(t.y - m.y, t.x - m.x);
                m._lastFaceRight = t.x >= m.x;
                if (this._attackTimer <= 0) {
                    this._attackTimer = this._attackInterval;
                    this._shotActive = true;
                    this._shotTimer = this._launchDelayMs;
                    this._shotAnimLeft = this._shotAnimMs;
                    m._animState = 'attack';
                    m._attackSwing = true;
                } else {
                    m._animState = 'idle'; // 间隔期待机（速度不清零，渐近减速）
                }
            } else {
                m._tacticalTarget = { x: t.x, y: t.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 150;
            }
            return;
        }
        // hold / 其它：待命（速度不清零，由 MovementSystem 摩擦衰减缓停）
        m.target = null;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
    }

    /** 收集最近有效敌人：只认 enemy 阵营且不是能源矿点（engageRange 内） */
    _nearestEnemy(entities, m) {
        let best = null;
        let bestD = Infinity;
        let bestShootable = null;
        let bestShootableD = Infinity;
        const attackRange = this._effectiveAttackRange();
        const iter = queryNearbyEntities(entities, m, this._engageRange);
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            if (e._isEnergyNode) continue; // 不攻击矿点（用户口径）
            const d = Math.hypot(e.x - m.x, e.y - m.y);
            if (d > this._engageRange) continue;
            if (d < bestD && d <= this._engageRange) {
                bestD = d;
                best = e;
            }
            if (d <= attackRange && d < bestShootableD && this._canShootTarget(e)) {
                bestShootableD = d;
                bestShootable = e;
            }
        }
        return bestShootable || best;
    }

    /** 目标贴图中心 Y（瞄准基准；无精灵时退回身体中心） */
    _targetAimY(target) {
        if (target && target._phaserSprite && target._phaserSprite.active) {
            return target._phaserSprite.y;
        }
        return target.y - ((target.bodyHeight || 80) * 0.5);
    }

    /** 发射投射物：AimHelper.lead 提前量瞄准目标贴图中心（参考露娜/射手） */
    _fireProjectile() {
        const m = this.m;
        const target = m.target;
        if (!target || !target.active || target.hp <= 0) return;
        if (!this._canShootTarget(target)) return;
        const startZ = (Number(m.z) || 0) + 45;
        const targetZ = target.collider?.centerZ ?? ((Number(target.z) || 0) + 24);
        const lead = AimHelper.lead(
            m.x, m.y,
            target.x, target.y,
            target.vx || 0, target.vy || 0,
            this._projectileSpeed
        );
        const ang = Math.atan2(lead.y - m.y, lead.x - m.x);
        const targetDist = Math.max(1, Math.hypot(lead.x - m.x, lead.y - m.y));
        const visualAngle = Math.atan2((lead.y - targetZ) - (m.y - startZ), lead.x - m.x);
        // 存 companion 字段（GameScene._syncCompanionBasics 读 m._basic 渲染投射物）
        m._basic = {
            active: true,
            x: m.x,
            y: m.y,
            z: startZ,
            vz: (targetZ - startZ) / Math.max(0.001, targetDist / this._projectileSpeed),
            angle: ang,
            visualAngle,
            dist: 0,
            maxDist: applyElevatedRangedRange(m, this._attackRange + 150),
            wallContext: projectileWallContext(m),
            target,
            remainingHits: Math.max(1, Math.floor(Number(this.cfg.projectileMaxHits) || 1)),
            hitIds: new Set(),
        };
        this._playSound('attack'); // 出膛音效（2026-08-17 复用射手出膛素材）
    }

    /** 事件音效：世界内发声走 playWorld（坐标衰减），无则 playFile 兜底（路径来自配置 m.sounds） */
    _playSound(key) {
        const m = this.m;
        const path = m && m.sounds && m.sounds[key];
        if (!path || !SoundManager) return;
        if (typeof SoundManager.playWorld === 'function') {
            SoundManager.playWorld(path, m.x, m.y);
        } else if (typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    /** 投射物飞行推进 + 命中结算（25 物理伤害；目标中心命中判定） */
    _updateProjectile(dt) {
        const m = this.m;
        const b = m._basic;
        if (!b || !b.active) return;
        const dtSec = dt / 1000;
        const step = this._projectileSpeed * dtSec;
        const prevX = b.x, prevY = b.y, prevZ = Number(b.z) || 0;
        b.x += Math.cos(b.angle) * step;
        b.y += Math.sin(b.angle) * step;
        b.z = prevZ + (Number(b.vz) || 0) * dtSec;
        b.dist += step;
        const wallHit = WallSystem.projectileWallHit?.(
            prevX,
            prevY,
            prevZ,
            b.x,
            b.y,
            b.z,
            b.wallContext || projectileWallContext(m)
        );
        let hit = null;
        if (!(b.hitIds instanceof Set)) b.hitIds = new Set();
        const hitKey = (entity) => entity?.id ?? entity;
        const alreadyHit = (entity) => !!entity && b.hitIds.has(hitKey(entity));
        const hits = (entity) => {
            const collider = entity?.collider;
            const bottom = collider?.bottomZ ?? (Number(entity?.z) || 0);
            const top = collider?.topZ ?? (bottom + (entity?.bodyHeight || 80));
            return Math.hypot(entity.x - b.x, entity.y - b.y) < PROJECTILE_HIT_RADIUS
                && b.z >= bottom - PROJECTILE_HIT_RADIUS
                && b.z <= top + PROJECTILE_HIT_RADIUS;
        };
        const t = b.target;
        if (t && t.active && t.hp > 0 && !alreadyHit(t) && hits(t)) {
            hit = t;
        } else {
            // 路径上经过的其他敌人也判定（与射手同思路）
            const game = (typeof window !== 'undefined' && window.Game) || null;
            for (const e of queryNearbyEntities(game?.entities, b, PROJECTILE_HIT_RADIUS + 64)) {
                if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || alreadyHit(e)) continue;
                if (e._isEnergyNode) continue;
                if (hits(e)) {
                    hit = e;
                    break;
                }
            }
        }
        const modelHitThroughSupport = wallHit
            && canUseWallTopModelException(m)
            && hit
            && wallHitSupportsTarget(wallHit, hit);
        if (wallHit && !modelHitThroughSupport) {
            applyProjectileWallImpact(m, wallHit, this._attackDamage, 'physical');
            b.active = false;
            return;
        }
        if (hit) {
            const maxHits = Math.max(1, Math.floor(Number(this.cfg.projectileMaxHits) || 1));
            const completedHits = Math.max(0, maxHits - Math.max(1, Number(b.remainingHits) || 1));
            const pierceMultiplier = Math.max(0, Math.min(1,
                Number(this.cfg.projectilePierceDamageMultiplier) || 1));
            const hitDamage = this._attackDamage * Math.pow(pierceMultiplier, completedHits);
            if (typeof hit.takeDamage === 'function') {
                hit.takeDamage(m.getPhysicalAttackDamage(hitDamage, hit), m, 'physical', false);
            }
            if (m.aiConfig?.appliesMarkArrow !== false) tryApplyMarkArrow(hit);
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(hit.x, hit.y - 30, `-${Math.round(hitDamage)}`, '#ffd27a'));
            }
            b.hitIds.add(hitKey(hit));
            b.remainingHits = Math.max(0, (Number(b.remainingHits) || 1) - 1);
            if (b.remainingHits <= 0) m._basic = null;
        } else if (b.dist >= b.maxDist) {
            m._basic = null; // 超出射程静默消失
        }
    }

    /** 卡死看门狗：只清理旧路径，坐标位移统一交给 MovementSystem/WallSystem。 */
    _checkStuck(dt) {
        const m = this.m;
        if (m._surfaceNavWaiting || m._surfaceRouteActive
            || m._surfaceKind === 'stairs' || m._surfaceKind === 'wall_walk') {
            this._stuckTimer = 0;
            this._stuckStreak = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        if (m._animState !== 'walk') {
            this._stuckTimer = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        this._stuckTimer += dt;
        if (this._stuckTimer < 500) return;
        this._stuckTimer = 0;
        const moved = Math.hypot(m.x - this._lastPosX, m.y - this._lastPosY);
        this._lastPosX = m.x;
        this._lastPosY = m.y;
        if (moved > 3) {
            this._stuckStreak = 0;
            return;
        }
        this._stuckStreak++;
        if (this._stuckStreak < 2) return;
        this._stuckStreak = 0;
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }
}
