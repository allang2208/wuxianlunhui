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
import { AimHelper } from '../utils/aim-helper.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SoundManager } from '../ui/sound-manager.js';
import { getAbilityLevel } from '../world/ability-store.js';

const PROJECTILE_HIT_RADIUS = 28; // 命中半径（瞄准中心，与射手一致）

export class HamsterScoutAI {
    constructor(scout) {
        this.m = scout;
        this.cfg = scout.aiConfig || {};
        this._decisionTimer = 0;
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2500;
        this._attackDamage = this.cfg.attackDamage ?? 25;
        this._attackRange = this.cfg.attackRange ?? 600;
        this._engageRange = this.cfg.engageRange ?? 900;
        this._projectileSpeed = this.cfg.projectileSpeed ?? 600;
        this._followOffset = this.cfg.followOffset ?? 140;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;
        // 攻击动画帧率/第 11 帧出膛（用户口径）：
        // 发射延迟 = (launchFrame-1) / fps；整段动画时长 = frameCount / fps
        const animCfg = (scout.animations && scout.animations.attack) || {};
        const fps = this.cfg.attackAnimFps ?? animCfg.frameRate ?? 12;
        const launchFrame = this.cfg.attackLaunchFrame ?? 11;
        const frameCount = animCfg.frameCount || 18;
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
            m.vx = 0;
            m.vy = 0;
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
            if (dist <= this._attackRange) {
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
                    m._animState = 'idle'; // 间隔期待机
                    m.vx = 0;
                    m.vy = 0;
                    m.isMoving = false;
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
                m.vx = 0;
                m.vy = 0;
                m.isMoving = false;
                m.maxSpeed = 0;
                if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
                    m._pathManager._clearPath();
                }
            } else {
                m._tacticalTarget = { x: fx, y: fy };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 150;
            }
        } else {
            m._tacticalTarget = null;
            m._animState = 'idle';
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
        }
    }

    /** RTS 命令：move（走到点，到位清指令）/ attack（锁定目标，进射程站定射击）/ hold（待命） */
    _applyCommand(cmd) {
        const m = this.m;
        if (cmd.mode === 'move') {
            m.target = null;
            const dest = cmd.point || { x: m.x, y: m.y };
            const dist = Math.hypot(dest.x - m.x, dest.y - m.y);
            if (dist > 40) {
                m._tacticalTarget = dest;
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 150;
            } else {
                m._command = { mode: 'follow' }; // 到位清除命令，回到默认跟随
                m._tacticalTarget = null;
                m._animState = 'idle';
                m.maxSpeed = 0;
                m.vx = 0; m.vy = 0; m.isMoving = false;
            }
            return;
        }
        if (cmd.mode === 'attack') {
            const t = cmd.target;
            if (!t || !t.active || t.hp <= 0) {
                m._command = { mode: 'follow' };
                m.target = null;
                m._animState = 'idle';
                return;
            }
            m.target = t;
            const dist = Math.hypot(t.x - m.x, t.y - m.y);
            if (dist <= this._attackRange) {
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
                    m._animState = 'idle';
                    m.vx = 0; m.vy = 0; m.isMoving = false;
                }
            } else {
                m._tacticalTarget = { x: t.x, y: t.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 150;
            }
            return;
        }
        // hold / 其它：待命
        m.target = null;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
        m.vx = 0; m.vy = 0; m.isMoving = false;
    }

    /** 收集最近有效敌人：只认 enemy 阵营且不是能源矿点（engageRange 内） */
    _nearestEnemy(entities, m) {
        let best = null;
        let bestD = Infinity;
        const iter = entities && entities.values ? entities.values() : entities || [];
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            if (e._isEnergyNode) continue; // 不攻击矿点（用户口径）
            const d = Math.hypot(e.x - m.x, e.y - m.y);
            if (d < bestD && d <= this._engageRange) {
                bestD = d;
                best = e;
            }
        }
        return best;
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
        const aimY = this._targetAimY(target);
        // 发射点 = 射手高度（与射手同口径：脚底 y 上移 45px）
        const spawnY = m.y - 45;
        const lead = AimHelper.lead(
            m.x, spawnY,
            target.x, aimY,
            target.vx || 0, target.vy || 0,
            this._projectileSpeed
        );
        const ang = Math.atan2(lead.y - spawnY, lead.x - m.x);
        // 存 companion 字段（GameScene._syncCompanionBasics 读 m._basic 渲染投射物）
        m._basic = {
            active: true,
            x: m.x,
            y: spawnY,
            aimY,
            angle: ang,
            dist: 0,
            maxDist: this._attackRange + 150,
            target,
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
        b.x += Math.cos(b.angle) * step;
        b.y += Math.sin(b.angle) * step;
        b.dist += step;

        let hit = null;
        const t = b.target;
        if (t && t.active && t.hp > 0
            && Math.hypot(t.x - b.x, (b.aimY ?? t.y) - b.y) < PROJECTILE_HIT_RADIUS) {
            hit = t;
        } else {
            // 路径上经过的其他敌人也判定（与射手同思路）
            const game = (typeof window !== 'undefined' && window.Game) || null;
            for (const e of ((game && game.entities) ? game.entities.values() : [])) {
                if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy') continue;
                if (e._isEnergyNode) continue;
                const ey = this._targetAimY(e);
                if (Math.hypot(e.x - b.x, ey - b.y) < PROJECTILE_HIT_RADIUS) {
                    hit = e;
                    break;
                }
            }
        }
        if (hit) {
            if (typeof hit.takeDamage === 'function') {
                hit.takeDamage(this._attackDamage, m, 'physical');
            }
            // 铁匠铺能力：标记箭（2026-08-17）——命中 25%+5%/级 概率标记 3s，
            // 走标准 Buff 工作流（addStatusEffect 统一入口，STATUS_CONFIG 已注册 'marked'）
            const markLv = getAbilityLevel('mark_arrow');
            if (markLv > 0 && Math.random() < 0.25 + 0.05 * markLv) {
                if (typeof hit.addStatusEffect === 'function') {
                    // value=0.15：同类型标记刷新时数值取最大（较强效果生效）
                    hit.addStatusEffect('marked', 3000, { name: '标记', icon: '🎯', color: '#ffd700', value: 0.15 });
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(hit.x, hit.y - 44, '🎯 标记', '#ffd700'));
                }
            }
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(hit.x, hit.y - 30, `-${this._attackDamage}`, '#ffd27a'));
            }
            m._basic = null;
        } else if (b.dist >= b.maxDist) {
            m._basic = null; // 超出射程静默消失
        }
    }

    /** 卡死看门狗：行走 500ms 位移 <3px 累计 2 次 → 重选目标/传送到合法点（同款兜底） */
    _checkStuck(dt) {
        const m = this.m;
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
        if (WallSystem && typeof WallSystem.findSafeSpawn === 'function') {
            const sp = WallSystem.findSafeSpawn(m.x, m.y, m.groundRadius || 20);
            if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.y)
                && Math.hypot(sp.x - m.x, sp.y - m.y) > 5) {
                m.x = sp.x;
                m.y = sp.y;
            }
        }
        m.target = null;
        m._tacticalTarget = null;
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }
}
