import { Enemy } from '../enemy.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { WallSystem } from '../../world/wall-system.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 怪物突变体-3（精英）
 * 技能：飞扑（蓄力 1 秒 → 高速冲锋 → 命中眩晕 2 秒）
 * 额外技能：每 30 秒召唤 2 只僵尸犬
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
        this._summonCooldown = 0;
        this._pounceTarget = null;
        this._pounceDir = { x: 0, y: 0 };
        this._pounceStartPos = { x: 0, y: 0 };
    }

    update(dt, entities) {
        if (this._pounceCooldown > 0) this._pounceCooldown -= dt;
        if (this._summonCooldown > 0) this._summonCooldown -= dt;

        // 召唤
        if (this._summonCooldown <= 0 && this.target && this.target.active) {
            this._summonZombieDogs(entities);
        }

        // 飞扑状态机
        if (this._pounceState === 'idle') {
            // 普通 AI 更新
            super.update(dt, entities);
            // 尝试开始飞扑
            if (this._pounceCooldown <= 0 && this.target && this.target.active) {
                const dist = Math.sqrt((this.target.x - this.x) ** 2 + (this.target.y - this.y) ** 2);
                if (dist <= 500) {
                    this._startPounce();
                }
            }

            // 根据移动状态切换待机动画/移动动画
            if (this._pounceState === 'idle') {
                this._animState = this.isMoving ? 'walk' : 'idle';
            }
        } else if (this._pounceState === 'prepare') {
            this._pounceTimer -= dt;
            this.vx = 0;
            this.vy = 0;
            // 朝向目标
            if (this.target && this.target.active) {
                this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
            }
            if (this._pounceTimer <= 0) {
                this._startCharge();
            }
        } else if (this._pounceState === 'charge') {
            const dtSec = dt / 1000;

            // 冲锋过程中始终朝向当前目标
            if (this.target && this.target.active) {
                const dx = this.target.x - this.x;
                const dy = this.target.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    this._pounceDir = { x: dx / dist, y: dy / dist };
                }
            }
            this.rotation = Math.atan2(this._pounceDir.y, this._pounceDir.x);

            const nextX = this.x + this._pounceDir.x * 1200 * dtSec;
            const nextY = this.y + this._pounceDir.y * 1200 * dtSec;
            const resolved = WallSystem.resolve(this.x, this.y, nextX, nextY, this.collisionRadius || 20);
            this.x = resolved.x;
            this.y = resolved.y;

            // 最远距离 1200px
            const traveled = Math.sqrt((this.x - this._pounceStartPos.x) ** 2 + (this.y - this._pounceStartPos.y) ** 2);
            if (traveled >= 1200) {
                this._endPounce();
                return;
            }

            // 命中检测
            if (this.target && this.target.active && this.target.hittable) {
                const dist = Math.sqrt((this.target.x - this.x) ** 2 + (this.target.y - this.y) ** 2);
                if (dist < (this.target.size || this.target.collisionRadius || 0) + this.size + 10) {
                    // 造成伤害并眩晕
                    const wasAlive = this.target.hp > 0;
                    this.target.takeDamage(this._getPounceDamage(), this, 'physical');
                    if (this.target.applyStun) this.target.applyStun(2000);
                    if (wasAlive && this.target.hp <= 0) {
                        // 击杀经验等由 takeDamage 内部处理
                    }
                    this._endPounce();
                }
            }

            this._pounceTimer -= dt;
            if (this._pounceTimer <= 0) {
                this._endPounce();
            }
        }
    }

    _startPounce() {
        this._pounceState = 'prepare';
        this._animState = 'attack';
        this._pounceAnimPhase = 'prepare';
        this._frozenForCast = true; // 蓄力期间禁止移动，与僵尸巫师保持一致
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
        this._frozenForCast = false; // 冲锋阶段由本类直接控制位置
        this._pounceTimer = 1500; // 最大冲锋时间
        if (this.target && this.target.active) {
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
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
        this._animState = 'idle';
        this._pounceAnimPhase = null;
        this._frozenForCast = false;
        this._pounceTimer = 0;
        this._pounceStartPos = { x: 0, y: 0 };
        this._pounceTarget = null;
    }

    _getPounceDamage() {
        // 基于物攻的爆发伤害
        const base = this.data.atk || this.data.str || 20;
        return Math.floor(base * 2.5);
    }

    _summonZombieDogs(entities) {
        this._summonCooldown = 30000;
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🐕 召唤僵尸犬', '#8a8a4a'));
        const angle = this.rotation || 0;
        for (let i = 0; i < 2; i++) {
            const offset = (i === 0 ? 1 : -1) * 30;
            const sx = this.x + Math.cos(angle) * 100 - Math.sin(angle) * offset;
            const sy = this.y + Math.sin(angle) * 100 + Math.cos(angle) * offset;
            const dog = this._createZombieDog ? this._createZombieDog(sx, sy) : null;
            if (dog && entities && typeof entities.set === 'function') {
                entities.set(dog.id || `zombieDog_${Date.now()}_${i}`, dog);
            } else if (dog && Array.isArray(entities)) {
                entities.push(dog);
            }
        }
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_mutant3_walk';
            case 'attack': return 'enemy_mutant3_attack';
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
                ? `enemy_mutant3_attack_${this._pounceAnimPhase || 'prepare'}`
                : `enemy_mutant3_${this._animState}`,
        };
    }
}
