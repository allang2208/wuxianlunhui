import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 普通僵尸（Zombie）
 * - 近战突刺，行动迟缓
 * - 精灵图：idle 1 帧 / walking 15 帧 / attacking 15 帧（512×512）
 * - 攻击动画持续 1s，攻击间隔 2s（attack.cooldown），攻击距离判定 100px（attackDistance）
 */
export class Zombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.zombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;

        // 动画状态：idle | walk | attack
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击动画控制
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._attackDuration = 1000; // 攻击动画持续 1s（与 BootScene 的 duration:1000 对应）
    }

    update(dt, entities) {
        super.update(dt, entities);

        // 更新计时器
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer < 0) this._attackTimer = 0;
        }
        if (this._attackAnimTimer > 0) {
            this._attackAnimTimer -= dt;
            if (this._attackAnimTimer < 0) this._attackAnimTimer = 0;
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackTimer > 0) {
            nextState = 'attack';
        } else {
            const maxSpd = this.maxSpeed || this.speed || 110;
            const walkThreshold = maxSpd * 0.05;
            nextState = speed > walkThreshold ? 'walk' : 'idle';
        }

        this._animStateTimer = (this._animStateTimer || 0) + dt;
        const minHoldTime = 80;
        if (nextState !== this._animState) {
            if (this._animStateTimer >= minHoldTime) {
                this._animState = nextState;
                this._animStateTimer = 0;
            }
        }

        // 朝向
        if (this._attackTimer > 0 && this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    triggerWeaponAnim() {
        // 正在攻击时不插队
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackDuration;
        this._attackAnimTimer = this._attackDuration;
        this._animState = 'attack';
        this._animStateTimer = 0;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
        // 必须触发通用武器动画状态机，才能在 swing 阶段执行 ThrustAttack.checkTriangleHit
        super.triggerWeaponAnim();
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_zombie_walk';
            case 'attack': return 'enemy_zombie_attack';
            default: return 'enemy_zombie_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转
        let flipX = false;
        if (this._attackTimer > 0 && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 120;
        const collisionWidth = renderCfg.collisionWidth || 30;
        const collisionHeight = renderCfg.collisionHeight || 50;

        return {
            spriteSize,
            collisionWidth,
            collisionHeight,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: `enemy_zombie_${this._animState}`,
        };
    }
}
