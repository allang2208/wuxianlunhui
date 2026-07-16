import { Enemy } from '../enemy.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { WallSystem } from '../../world/wall-system.js';
import { AimHelper } from '../../utils/aim-helper.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 怪物突变体-3（精英）
 * 技能：
 * - 普通攻击：5 连击（1.5s 动画，第 6/11/13/16/18 帧各造成 1 次伤害并致残 2s）
 * - 飞扑：蓄力 1 秒 → 高速冲锋（方向锁定） → 命中眩晕 2 秒
 * - 召唤：每 30 秒召唤 2 只僵尸犬
 */
export class Mutant3 extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.mutant3,
            ...config
        });
        this._useStickFigure = false;
        this._animState = 'idle'; // idle | walk | attack
        this._pounceAnimPhase = null; // null | prepare | charge
        this._pounceState = 'idle'; // idle | prepare | charge
        this._pounceTimer = 0;
        this._pounceCooldown = 0;
        this._pounceTarget = null;
        this._pounceTargetPos = null;
        this._pounceGhostTimer = 0;
        this._pounceDir = { x: 0, y: 0 };
        this._pounceStartPos = { x: 0, y: 0 };
        this._pounceDamaged = false;
        this._chargeStraight = true; // 直冲目标，不做侧翼/卡位迂回

        // Mutant-3 使用自定义 5 连击/飞扑，关闭通用 CombatSystem 近战攻击，避免与自定义逻辑冲突
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 5 连击状态
        this._comboState = 'idle'; // idle | attacking
        this._comboTimer = 0;
        this._comboCooldown = 0;
        this._comboTarget = null;
        this._comboHitMask = 0;
        this._comboDashState = 'idle'; // idle | dash
        this._comboDashTimer = 0;
        this._comboDashTarget = null;
        this._attackAnimPhase = null; // null | normal

        // 连击命中后的小幅突进（插帧平滑移动）
        this._comboLungeDx = 0;
        this._comboLungeDy = 0;
        this._comboLungeRemaining = 0;
        this._comboLungeSpeed = 500; // px/s，约 70ms 完成 35px
    }

    update(dt, entities) {
        if (this._pounceCooldown > 0) this._pounceCooldown -= dt;
        if (this._comboCooldown > 0) this._comboCooldown -= dt;

        // 统一更新状态效果（中毒、流血等）
        this.updateStatusEffects(dt);

        // 眩晕时强制中断所有动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            if (this._comboState !== 'idle') this._endCombo();
            if (this._pounceState !== 'idle') this._endPounce();
            this.vx = 0; this.vy = 0; this.isMoving = false;
            return;
        }

        // 5 连击优先
        if (this._comboState === 'attacking') {
            this._updateCombo(dt, entities);
            return;
        }

        // 连击冲刺：在普攻命中距离内但还没贴到 50px 时，短距离突进保证能开始连击
        if (this._comboDashState === 'dash') {
            this._updateComboDash(dt);
            return;
        }

        // 飞扑状态机
        if (this._pounceState === 'idle') {
            // 普通 AI 更新
            super.update(dt, entities);

            // 尝试开始 5 连击（贴身直接发动）
            if (this._comboState === 'idle' && this._comboCooldown <= 0 && this.target && this.target.active) {
                if (this._isTargetInRange(this.target, this._getAttackStartDistance())) {
                    this._startCombo();
                    return;
                }
            }

            // 距离已进命中范围但还没贴身：先突进再连击
            if (this._comboDashState === 'idle' && this._comboState === 'idle' && this._comboCooldown <= 0 && this.target && this.target.active) {
                const inComboRange = this._isTargetInRange(this.target, this._getComboAttackDistance());
                const inStartRange = this._isTargetInRange(this.target, this._getAttackStartDistance());
                if (inComboRange && !inStartRange) {
                    this._startComboDash();
                    return;
                }
            }

            // 尝试开始飞扑
            if (this._pounceCooldown <= 0 && this.target && this.target.active) {
                const dist = Math.hypot(this.target.x - this.x, this.target.y - this.y);
                if (dist <= 500) {
                    this._startPounce();
                    return;
                }
            }

            if (this._pounceState === 'idle' && this._comboState === 'idle') {
                this._animState = this.isMoving ? 'walk' : 'idle';
            }
        } else if (this._pounceState === 'prepare') {
            this._pounceTimer -= dt;
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            // 朝向目标
            if (this.target && this.target.active) {
                this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
            }
            if (this._pounceTimer <= 0) {
                this._startCharge();
            }
        } else if (this._pounceState === 'charge') {
            const dtSec = dt / 1000;

            // 冲锋方向在起点已锁定，过程中不再追随目标
            this.rotation = Math.atan2(this._pounceDir.y, this._pounceDir.x);

            // 向终点移动（穿过目标 300px 或最远距离 1200px），冲锋阶段固定 1 秒
            const distToEnd = this._pounceTargetPos ? Math.hypot(this._pounceTargetPos.x - this.x, this._pounceTargetPos.y - this.y) : 0;
            if (distToEnd > 10 && this._pounceSpeed > 0) {
                const step = Math.min(this._pounceSpeed * dtSec, distToEnd);
                const nextX = this.x + this._pounceDir.x * step;
                const nextY = this.y + this._pounceDir.y * step;
                const resolved = WallSystem.resolve(this.x, this.y, nextX, nextY, this.groundRadius);
                this.x = resolved.x;
                this.y = resolved.y;
            }

            // 命中检测（距离判定，只造成伤害，不中断动画）
            const hitTarget = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
            if (!this._pounceDamaged && hitTarget && hitTarget.active && hitTarget.hittable) {
                if (this._isTargetInRange(hitTarget, this._getAttackDistance())) {
                    const wasAlive = hitTarget.hp > 0;
                    hitTarget.takeDamage(this._getPounceDamage(), this, 'physical', true);
                    // 若被盾牌弹反，不再眩晕玩家；弹反本身已通过 ShieldSystem 眩晕/击退突变体
                    const parried = hitTarget.shieldSystem && hitTarget.shieldSystem._lastParried;
                    if (!parried && hitTarget.applyStun) hitTarget.applyStun(2000);
                    if (wasAlive && hitTarget.hp <= 0) {
                        // 击杀经验等由 takeDamage 内部处理
                    }
                    this._pounceDamaged = true;
                }
            }

            // 飞扑残影
            this._pounceGhostTimer -= dt;
            if (this._pounceGhostTimer <= 0) {
                this._spawnPounceGhost();
                this._pounceGhostTimer = 60;
            }

            this._pounceTimer -= dt;
            this._attackAnimTimer = Math.max(0, this._pounceTimer);
            if (this._pounceTimer <= 0 || distToEnd <= 10) {
                this._endPounce();
            }
        }
    }

    // ===== 5 连击 =====
    _startCombo() {
        const t = this.target;
        this._comboTarget = t;

        // 目标已逃出连击最大范围或不可攻击：直接取消，避免播放空挥连击
        if (!t || !t.active || !t.hittable || !this._isTargetInRange(t, this._getComboAttackDistance())) {
            this._comboTarget = null;
            this._comboCooldown = 0; // 立即允许下次尝试
            return;
        }

        this._comboState = 'attacking';
        this._comboTimer = 1500;
        this._comboCooldown = 3000;
        this._comboHitMask = 0;
        this._comboDashState = 'idle';
        this._comboDashTarget = null;
        this._comboDashPredicted = null;
        this._animState = 'attack';
        this._attackAnimPhase = 'normal';
        this._pounceAnimPhase = null;
        this._frozenForCast = true;

        // 重置连击突进插值
        this._comboLungeDx = 0;
        this._comboLungeDy = 0;
        this._comboLungeRemaining = 0;
        this._attackAnimTimer = 1500;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 最终修正：如果冲刺结束时还没进入 50px，吸附到目标面前，避免高速目标滑出攻击窗口
        const dx = t.x - this.x;
        const dy = t.y - this.y;
        const d = Math.hypot(dx, dy);
        const startDist = this._getAttackStartDistance();
        // 若冲刺结束时还没贴到 startDist，吸附到目标面前，避免高速目标滑出攻击窗口
        if (d > startDist && d <= this._getComboAttackDistance()) {
            const desired = Math.max(35, startDist - 10);
            const nx = t.x - (dx / d) * desired;
            const ny = t.y - (dy / d) * desired;
            const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
            this.x = r.x;
            this.y = r.y;
        }

        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '💢 连击！', '#8a4a2a'));
    }

    _startComboDash() {
        this._comboDashState = 'dash';
        this._comboDashTimer = 250;
        this._comboDashTarget = this.target;
        this._comboDashPredicted = null;
        this._attackAnimTimer = this._comboDashTimer; // 阻止 MovementSystem 覆盖移动
        this._animState = 'walk';
        this.vx = 0;
        this.vy = 0;
        this.isMoving = true;

        // 可选：用 AimHelper 做简单预判作为落点参考（实际每帧会重新朝当前目标修正）
        const t = this._comboDashTarget;
        if (t && t.active) {
            this._comboDashPredicted = AimHelper.lead(
                this.x, this.y,
                t.x, t.y,
                t.vx || 0, t.vy || 0,
                1200, 0
            );
        }
    }

    _updateComboDash(dt) {
        this._comboDashTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._comboDashTimer);
        const t = this._comboDashTarget;
        if (t && t.active) {
            // 每帧重新朝当前目标位置冲锋（自动修正玩家横向移动），避免固定预测点导致冲过头
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const d = Math.hypot(dx, dy);
            this.rotation = Math.atan2(dy, dx);
            if (d > 0) {
                const speed = 1200; // px/s，快速贴身
                const step = Math.min(speed * (dt / 1000), d);
                const nx = this.x + (dx / d) * step;
                const ny = this.y + (dy / d) * step;
                const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
                this.x = r.x;
                this.y = r.y;
            }
            if (d <= this._getAttackStartDistance() || this._comboDashTimer <= 0) {
                this._comboDashState = 'idle';
                this._comboDashTarget = null;
                this._comboDashPredicted = null;
                this._startCombo();
                return;
            }
        } else {
            this._comboDashState = 'idle';
            this._comboDashTarget = null;
            this._comboDashPredicted = null;
        }
    }

    _updateCombo(dt, entities) {
        this._comboTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._comboTimer);
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 平滑执行命中后 pending 的突进，避免瞬移
        if (this._comboLungeRemaining > 0.1) {
            const dtSec = dt / 1000;
            const step = Math.min(this._comboLungeRemaining, this._comboLungeSpeed * dtSec);
            const ratio = this._comboLungeRemaining > 0 ? step / this._comboLungeRemaining : 0;
            const mx = this._comboLungeDx * ratio;
            const my = this._comboLungeDy * ratio;
            const r = WallSystem.resolve(this.x, this.y, this.x + mx, this.y + my, this.groundRadius);
            this.x = r.x;
            this.y = r.y;
            this._comboLungeDx -= mx;
            this._comboLungeDy -= my;
            this._comboLungeRemaining -= step;
        }

        // 始终面向目标
        if (this._comboTarget && this._comboTarget.active) {
            this.rotation = Math.atan2(this._comboTarget.y - this.y, this._comboTarget.x - this.x);
        }

        const elapsed = 1500 - this._comboTimer;
        // 22 帧 / 1500ms ≈ 68.18ms/帧；伤害触发在第 6/11/13/16/18 帧
        // 使用 ±0.5 帧的窗口判定，避免单帧错过导致不触发
        const frameDur = 1500 / 22;
        const windows = [
            { start: 5.5 * frameDur, end: 6.5 * frameDur },
            { start: 10.5 * frameDur, end: 11.5 * frameDur },
            { start: 12.5 * frameDur, end: 13.5 * frameDur },
            { start: 15.5 * frameDur, end: 16.5 * frameDur },
            { start: 17.5 * frameDur, end: 18.5 * frameDur },
        ];
        for (let i = 0; i < 5; i++) {
            const bit = 1 << i;
            if ((this._comboHitMask & bit) === 0 && elapsed >= windows[i].start && elapsed <= windows[i].end) {
                this._comboHitMask |= bit;
                this._dealComboHit(i, entities);
            }
        }

        if (this._comboTimer <= 0 || this._comboHitMask === 0b11111) {
            this._endCombo();
        }
    }

    _dealComboHit(_hitIndex, _entities) {
        const target = this._comboTarget;
        if (!target || !target.active || !target.hittable) return;

        if (!this._isTargetInRange(target, this._getComboAttackDistance())) return;

        const attack = this.attacks && this.attacks.melee;
        const dmgCfg = attack && attack.config && attack.config.damage;
        const base = dmgCfg ? Math.floor((dmgCfg.min + dmgCfg.max) / 2) : (this.data.atk || this.data.str || 20);
        const damage = Math.max(1, base);
        target.takeDamage(damage, this, 'physical', true);

        // 若被盾牌弹反，则不再施加束缚/血雾等后续效果
        const parried = target.shieldSystem && target.shieldSystem._lastParried;
        if (!parried) {
            if (target.applyBind) target.applyBind(500);
            this._spawnBloodMist(target.x, target.y);
        }

        // 每次命中后记录小幅突进向量，由 _updateCombo 每帧插帧平滑执行
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        const startDist = this._getAttackStartDistance();
        if (d > startDist && d > 0) {
            const maxTotal = 80; // 单次连击总突进上限，避免目标后退时被无限追击
            const currentTotal = Math.hypot(this._comboLungeDx, this._comboLungeDy);
            const remainingBudget = Math.max(0, maxTotal - currentTotal);
            const lunge = Math.min(35, d - startDist, remainingBudget);
            if (lunge > 0) {
                this._comboLungeDx += (dx / d) * lunge;
                this._comboLungeDy += (dy / d) * lunge;
                this._comboLungeRemaining = Math.hypot(this._comboLungeDx, this._comboLungeDy);
            }
        }
    }

    _getAttackDistance() {
        return this.attackDistance || this.attackRange || 100;
    }

    // 5 连击期间允许的最大命中距离：比普攻距离大，避免玩家奔跑时连击全部挥空
    _getComboAttackDistance() {
        return Math.max(this._getAttackDistance(), 350);
    }

    _getAttackStartDistance() {
        return this.attackRange || 50;
    }

    /**
     * 判定目标是否在指定攻击范围内。
     * 若目标是矩形碰撞体，使用圆（攻击范围）与矩形的相交检测；
     * 否则回退到中心距 + 目标碰撞半径。
     */
    _isTargetInRange(target, range) {
        if (!target) return false;
        const r = Math.max(0, range);
        if (target.collisionShape === 'rect' && target.collisionWidth > 0 && target.collisionHeight > 0) {
            const hw = target.collisionWidth / 2;
            const hh = target.collisionHeight / 2;
            const rx = target.x - hw;
            const ry = target.y - hh;
            return this._circleRectIntersect(this.x, this.y, r, rx, ry, target.collisionWidth, target.collisionHeight);
        }
        const dist = Math.hypot(target.x - this.x, target.y - this.y);
        return dist <= r + (target.collisionRadius || 0);
    }

    _circleRectIntersect(cx, cy, cr, rx, ry, rw, rh) {
        const closestX = Math.max(rx, Math.min(cx, rx + rw));
        const closestY = Math.max(ry, Math.min(cy, ry + rh));
        const dx = cx - closestX;
        const dy = cy - closestY;
        return dx * dx + dy * dy <= cr * cr;
    }

    _spawnBloodMist(x, y) {
        const scene = window.__phaserScene;
        if (!scene || !scene.textures.exists('enemy_circle')) return;
        const mist = scene.add.sprite(x, y, 'enemy_circle')
            .setTint(0xb03030)
            .setAlpha(0.5)
            .setScale(1.2)
            .setDepth(100);
        scene.tweens.add({
            targets: mist,
            scale: 2.5,
            alpha: 0,
            duration: 350,
            ease: 'Quad.easeOut',
            onComplete: () => { if (mist && mist.active) mist.destroy(); }
        });
    }

    _endCombo() {
        this._comboState = 'idle';
        this._comboTimer = 0;
        this._comboTarget = null;
        this._comboHitMask = 0;
        this._attackAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._comboLungeDx = 0;
        this._comboLungeDy = 0;
        this._comboLungeRemaining = 0;
        if (this._pounceState === 'idle') {
            this._animState = 'idle';
        }
    }

    // ===== 飞扑 =====
    _startPounce() {
        if (this._pounceState !== 'idle') return;
        this._pounceState = 'prepare';
        this._animState = 'attack';
        this._pounceAnimPhase = 'prepare';
        this._attackAnimPhase = null;
        this._frozenForCast = true;
        this._pounceTimer = 1000;
        this._pounceStartPos = { x: this.x, y: this.y };
        this._pounceCooldown = 20000;
        this._pounceTarget = this.target;
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🐆 飞扑蓄力', '#3a6a2a'));
    }

    _startCharge() {
        if (this._pounceState !== 'prepare') return;
        this._pounceState = 'charge';
        this._animState = 'attack';
        this._pounceAnimPhase = 'charge';
        this._attackAnimPhase = null;
        this._frozenForCast = false;
        this._pounceGhostTimer = 0;
        this._pounceDamaged = false;

        const maxDist = 1200;
        const overshoot = 300;
        const target = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;

        if (target && target.active) {
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                this._pounceDir = { x: dx / dist, y: dy / dist };
                const wanted = dist + overshoot;
                const clamped = Math.min(wanted, maxDist);
                this._pounceTargetPos = {
                    x: this.x + this._pounceDir.x * clamped,
                    y: this.y + this._pounceDir.y * clamped
                };
                this._pounceChargeDistance = clamped;
            } else {
                this._pounceDir = { x: Math.cos(this.rotation || 0), y: Math.sin(this.rotation || 0) };
                this._pounceTargetPos = {
                    x: this.x + this._pounceDir.x * Math.min(overshoot, maxDist),
                    y: this.y + this._pounceDir.y * Math.min(overshoot, maxDist)
                };
                this._pounceChargeDistance = Math.min(overshoot, maxDist);
            }
        } else {
            this._pounceDir = { x: Math.cos(this.rotation || 0), y: Math.sin(this.rotation || 0) };
            this._pounceTargetPos = {
                x: this.x + this._pounceDir.x * Math.min(overshoot, maxDist),
                y: this.y + this._pounceDir.y * Math.min(overshoot, maxDist)
            };
            this._pounceChargeDistance = Math.min(overshoot, maxDist);
        }

        // 冲锋阶段固定 1 秒，速度按距离自动调整，确保正好停在终点
        this._pounceTimer = 1000;
        this._attackAnimTimer = 1000; // 阻止 MovementSystem 在冲锋中转向目标
        this._pounceSpeed = this._pounceChargeDistance / 1; // px/s

        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🐆 飞扑！', '#3a6a2a'));
    }

    _endPounce() {
        this._pounceState = 'idle';
        this._pounceAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._pounceTimer = 0;
        this._pounceGhostTimer = 0;
        this._pounceTargetPos = null;
        this._pounceDamaged = false;
        this._pounceStartPos = { x: 0, y: 0 };
        this._pounceTarget = null;
        if (this._comboState === 'idle') {
            this._animState = 'idle';
        }
    }

    _getPounceDamage() {
        // 飞扑只造成一次等于其物理攻击的伤害
        return this.data.atk || this.data.str || 20;
    }

    _spawnPounceGhost() {
        const sprite = this._phaserSprite;
        const scene = window.__phaserScene;
        if (!sprite || !scene) return;
        const textureKey = this._getTextureKey();
        if (!scene.textures.exists(textureKey)) return;
        const frame = sprite.frame ? sprite.frame.name : 0;
        const ghost = scene.add.sprite(this.x, this.y, textureKey, frame)
            .setAlpha(0.5)
            .setDisplaySize(sprite.displayWidth, sprite.displayHeight)
            .setFlipX(sprite.flipX)
            .setDepth((sprite.depth || 0) - 1);
        scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 250,
            onComplete: () => { if (ghost && ghost.active) ghost.destroy(); }
        });
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_mutant3_walk';
            case 'attack':
                if (this._attackAnimPhase === 'normal') return 'enemy_mutant3_attack_normal';
                return 'enemy_mutant3_attack';
            default: return 'enemy_mutant3_idle';
        }
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        let animKey;
        if (this._animState === 'attack') {
            if (this._pounceAnimPhase === 'prepare' || this._pounceAnimPhase === 'charge') {
                // 飞扑蓄力 + 冲锋使用同一个动画，保证视觉连续性
                animKey = 'enemy_mutant3_attack_pounce';
            } else if (this._attackAnimPhase === 'normal') {
                animKey = 'enemy_mutant3_attack_normal';
            } else {
                animKey = 'enemy_mutant3_attack_prepare';
            }
        } else {
            animKey = `enemy_mutant3_${this._animState}`;
        }

        return {
            spriteSize: 120,
            collisionWidth: 30,
            collisionHeight: 90,
            textOffsetY: -70,
            flipX,
            animState: this._animState,
            animKey,
        };
    }
}
