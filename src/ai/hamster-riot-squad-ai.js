import { HamsterMusketeerAI } from './hamster-musketeer-ai.js';
import { queryNearbyEntities } from './friendly-spatial-query.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import { GroundSector } from '../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { HamsterRiotShotgunEffect } from '../effects/hamster-riot-shotgun-effect.js';
import { SoundManager } from '../ui/sound-manager.js';

/**
 * 防暴队专属近距压制：沿用火枪 AI 的寻敌、RTS、站定与攻击时间轴，
 * 释放帧改为无弹道的地面扇区一次性结算。
 */
export class HamsterRiotSquadAI extends HamsterMusketeerAI {
    constructor(unit) {
        super(unit);
        this._entities = null;
        this._shotAngle = 0;
    }

    update(dt, entities, player) {
        this._entities = entities;
        super.update(dt, entities, player);
    }

    cancelForCommand() {
        super.cancelForCommand();
        this._shotAngle = 0;
        this.m._basic = null;
    }

    _effectiveAttackRange() {
        return Math.min(300, Math.max(1, Number(this._attackRange) || 300));
    }

    _engage(target) {
        const m = this.m;
        m.target = target;
        const originX = Number.isFinite(m.collider?.x) ? m.collider.x : m.x;
        const originY = Number.isFinite(m.collider?.y) ? m.collider.y : m.y;
        const targetX = Number.isFinite(target?.collider?.x) ? target.collider.x : target.x;
        const targetY = Number.isFinite(target?.collider?.y) ? target.collider.y : target.y;
        const dx = targetX - originX;
        const dy = targetY - originY;
        const projectedDy = dy / PERSPECTIVE_SCALE_Y;
        const groundDistance = Math.hypot(dx, projectedDy);

        if (groundDistance > this._effectiveAttackRange() || !this._canShootTarget(target)) {
            m._tacticalTarget = { x: target.x, y: target.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 72;
            return;
        }

        m._tacticalTarget = null;
        m.maxSpeed = 0;
        m.rotation = Math.atan2(dy, dx);
        m._lastFaceRight = dx >= 0;
        if (this._attackTimer <= 0) {
            this._attackTimer = this._attackInterval;
            this._shotActive = true;
            this._shotTimer = this._launchDelayMs;
            this._shotAnimLeft = this._shotAnimMs;
            m._animState = 'attack';
            m._attackSwing = true;
            // GroundSector 在地面坐标中判定；锁定逆透视后的起手方向。
            this._shotAngle = Math.atan2(projectedDy, dx);
        }
    }

    /** 防暴队没有飞行弹体；热重载时也主动清除旧式火枪曳光弹。 */
    _updateProjectile() {
        this.m._basic = null;
    }

    /**
     * 复用父类释放帧回调名，但这里只做即时扇区伤害与纯视觉枪口火花。
     */
    _fireProjectile() {
        const m = this.m;
        m._basic = null;
        const range = Math.min(300, Math.max(1, Number(this.cfg.attackRange) || 300));
        const arcDegrees = Math.max(1, Number(this.cfg.attackArcDegrees) || 45);
        const arcRadians = arcDegrees * Math.PI / 180;
        const originX = Number.isFinite(m.collider?.x) ? m.collider.x : m.x;
        const originY = Number.isFinite(m.collider?.y) ? m.collider.y : m.y;
        const angle = Number.isFinite(this._shotAngle) ? this._shotAngle : (m.rotation || 0);
        const sector = new GroundSector(
            originX,
            originY,
            angle,
            range,
            arcRadians,
            surfaceEffectFromEntity(m)
        );

        for (const entity of queryNearbyEntities(this._entities, m, range + 96)) {
            if (!entity || entity === m || !entity.active || entity.hp <= 0
                || entity._faction !== 'enemy' || entity._isEnergyNode) continue;
            if (!sector.intersectsEntity(entity)) continue;
            // 无弹道不等于穿墙；扇区内每个目标仍单独执行现有远程 LOS 门禁。
            if (!hasRangedLineOfSight(m, entity)) continue;
            entity.takeDamage?.(
                m.getPhysicalAttackDamage(this._attackDamage, entity),
                m,
                'physical',
                false
            );
        }

        this._playShotSound();
        this._spawnShotEffect(angle, range, arcDegrees);
    }

    _playShotSound() {
        const m = this.m;
        const sound = m.sounds?.attack;
        if (sound && SoundManager?.playGunshotAt) SoundManager.playGunshotAt(sound, m.x, m.y);
        else if (sound && SoundManager?.playWorld) SoundManager.playWorld(sound, m.x, m.y);
        else if (sound && SoundManager?.playFile) SoundManager.playFile(sound);
    }

    _spawnShotEffect(angle, range, arcDegrees) {
        const m = this.m;
        const faceSign = Math.cos(angle) >= 0 ? 1 : -1;
        const muzzleX = m.x + faceSign * (Number(this.cfg.muzzleOffsetX) || 18);
        const muzzleY = m.y + (Number(this.cfg.muzzleOffsetY) || 0)
            - Math.max(0, Number(this.cfg.muzzleHeight) || 55);
        // 地面方向投影到屏幕空间；只改变视觉火花方向，不改逻辑扇区。
        const visualAngle = Math.atan2(
            Math.sin(angle) * PERSPECTIVE_SCALE_Y,
            Math.cos(angle)
        );
        const sourceDepth = Number(m._phaserSprite?.depth);
        EffectManager.spawnCosmetic('muzzleFlash', m.x, m.y, () => new HamsterRiotShotgunEffect({
            x: muzzleX,
            y: muzzleY,
            fogX: m.x,
            fogY: m.y,
            angle: visualAngle,
            range,
            arcDegrees,
            durationMs: Number(this.cfg.attackEffectDurationMs) || 240,
            sparkCount: Number(this.cfg.attackSparkCount) || 30,
            depth: Number.isFinite(sourceDepth) ? sourceDepth + 0.35 : null,
        }));
    }
}
