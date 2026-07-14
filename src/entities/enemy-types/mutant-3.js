import { Enemy } from '../enemy.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { WallSystem } from '../../world/wall-system.js';
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
        this._pounceGhostTimer = 0;
        this._pounceDir = { x: 0, y: 0 };
        this._pounceStartPos = { x: 0, y: 0 };

        // 5 连击状态
        this._comboState = 'idle'; // idle | attacking
        this._comboTimer = 0;
        this._comboCooldown = 0;
        this._comboTarget = null;
        this._comboHitMask = 0;
        this._attackAnimPhase = null; // null | normal
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

        // 飞扑状态机
        if (this._pounceState === 'idle') {
            // 普通 AI 更新
            super.update(dt, entities);

            // 尝试开始 5 连击
            if (this._comboState === 'idle' && this._comboCooldown <= 0 && this.target && this.target.active) {
                const dist = Math.hypot(this.target.x - this.x, this.target.y - this.y);
                if (dist <= this._getAttackDistance()) {
                    this._startCombo();
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

            const nextX = this.x + this._pounceDir.x * 1200 * dtSec;
            const nextY = this.y + this._pounceDir.y * 1200 * dtSec;
            const resolved = WallSystem.resolve(this.x, this.y, nextX, nextY, this.collisionRadius || 20);
            this.x = resolved.x;
            this.y = resolved.y;

            // 最远距离 1200px
            const traveled = Math.hypot(this.x - this._pounceStartPos.x, this.y - this._pounceStartPos.y);
            if (traveled >= 1200) {
                this._endPounce();
                return;
            }

            // 命中检测（距离判定）
            const hitTarget = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
            if (hitTarget && hitTarget.active && hitTarget.hittable) {
                const dist = Math.hypot(hitTarget.x - this.x, hitTarget.y - this.y);
                if (dist <= this._getAttackDistance()) {
                    const wasAlive = hitTarget.hp > 0;
                    hitTarget.takeDamage(this._getPounceDamage(), this, 'physical');
                    if (hitTarget.applyStun) hitTarget.applyStun(2000);
                    if (wasAlive && hitTarget.hp <= 0) {
                        // 击杀经验等由 takeDamage 内部处理
                    }
                    this._endPounce();
                    return;
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
            if (this._pounceTimer <= 0) {
                this._endPounce();
            }
        }
    }

    // ===== 5 连击 =====
    _startCombo() {
        this._comboState = 'attacking';
        this._comboTimer = 1500;
        this._comboCooldown = 3000;
        this._comboTarget = this.target;
        this._comboHitMask = 0;
        this._animState = 'attack';
        this._attackAnimPhase = 'normal';
        this._pounceAnimPhase = null;
        this._frozenForCast = true;
        this._attackAnimTimer = 1500;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '💢 连击！', '#8a4a2a'));
    }

    _updateCombo(dt, entities) {
        this._comboTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._comboTimer);
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 始终面向目标
        if (this._comboTarget && this._comboTarget.active) {
            this.rotation = Math.atan2(this._comboTarget.y - this.y, this._comboTarget.x - this.x);
        }

        const elapsed = 1500 - this._comboTimer;
        // 22 帧 / 1500ms ≈ 68.18ms/帧；伤害触发在第 6/11/13/16/18 帧
        const thresholds = [409, 750, 886, 1091, 1227];
        for (let i = 0; i < 5; i++) {
            const bit = 1 << i;
            if ((this._comboHitMask & bit) === 0 && elapsed >= thresholds[i]) {
                this._comboHitMask |= bit;
                this._dealComboHit(i, entities);
            }
        }

        if (this._comboTimer <= 0 || this._comboHitMask === 0b11111) {
            this._endCombo();
        }
    }

    _dealComboHit(_hitIndex, entities) {
        const target = this._comboTarget;
        if (!target || !target.active || !target.hittable) return;

        const dist = Math.hypot(target.x - this.x, target.y - this.y);
        if (dist > this._getAttackDistance()) return;

        const attack = this.attacks && this.attacks.melee;
        const dmgCfg = attack && attack.config && attack.config.damage;
        const base = dmgCfg ? Math.floor((dmgCfg.min + dmgCfg.max) / 2) : (this.data.atk || this.data.str || 20);
        const damage = Math.max(1, base);
        target.takeDamage(damage, this, 'physical');
        if (target.applyBind) target.applyBind(200);
    }

    _getAttackDistance() {
        return this.attackDistance || this.attackRange || 100;
    }

    _endCombo() {
        this._comboState = 'idle';
        this._comboTimer = 0;
        this._comboTarget = null;
        this._comboHitMask = 0;
        this._attackAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        if (this._pounceState === 'idle') {
            this._animState = 'idle';
        }
    }

    // ===== 飞扑 =====
    _startPounce() {
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
        this._pounceState = 'charge';
        this._animState = 'attack';
        this._pounceAnimPhase = 'charge';
        this._attackAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 1500; // 阻止 MovementSystem 在冲锋中转向目标
        this._pounceTimer = 1500;
        this._pounceGhostTimer = 0;
        const target = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
        if (target && target.active) {
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                this._pounceDir = { x: dx / dist, y: dy / dist };
            } else {
                this._pounceDir = { x: Math.cos(this.rotation || 0), y: Math.sin(this.rotation || 0) };
            }
        } else {
            this._pounceDir = { x: Math.cos(this.rotation || 0), y: Math.sin(this.rotation || 0) };
        }
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🐆 飞扑！', '#3a6a2a'));
    }

    _endPounce() {
        this._pounceState = 'idle';
        this._pounceAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._pounceTimer = 0;
        this._pounceGhostTimer = 0;
        this._pounceStartPos = { x: 0, y: 0 };
        this._pounceTarget = null;
        if (this._comboState === 'idle') {
            this._animState = 'idle';
        }
    }

    _getPounceDamage() {
        const base = this.data.atk || this.data.str || 20;
        return Math.floor(base * 2.5);
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
            .setScale(sprite.scaleX, sprite.scaleY)
            .setFlipX(sprite.flipX)
            .setRotation(this.rotation || 0)
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
        return {
            spriteSize: 120,
            textOffsetY: -70,
            flipX,
            animState: this._animState,
            animKey: this._animState === 'attack'
                ? `enemy_mutant3_attack_${this._attackAnimPhase || this._pounceAnimPhase || 'prepare'}`
                : `enemy_mutant3_${this._animState}`,
        };
    }
}
