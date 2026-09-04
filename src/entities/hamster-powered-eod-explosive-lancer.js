import { HamsterWingedHussar } from './hamster-winged-hussar.js';
import { GroundCircle } from '../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../physics/elevation.js';
import { queryNearbyEntities } from '../ai/friendly-spatial-query.js';
import { SoundManager } from '../ui/sound-manager.js';
import { spawnPoweredLanceExplosion } from '../effects/powered-lance-explosion-fx.js';
import configData from '../../data/hamster-powered-eod-explosive-lancer-config.json';

/** 骑兵学院三级重骑：普通爆矛突刺 + 火箭助推冲锋；冲锋直击眩晕，爆炸仅造成范围伤害。 */
export class HamsterPoweredEodExplosiveLancer extends HamsterWingedHussar {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(x, y, archive);
        this._isHamsterPoweredEodExplosiveLancer = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.footOffsetY = Math.max(0, Number(archive.render?.footOffsetY) || 90.644531);
        this.config = {
            render: {
                ...(this.config?.render || {}),
                ...(archive.render || {}),
                footOffsetY: this.footOffsetY,
            },
        };
        this._lastChargeAoeHitCount = 0;
        this.configureCollisionFromArchive(archive);
    }

    /** 眩晕/冻结必须撤销冲锋的无碰撞与抗弹反临时态，不能恢复后继续冲。 */
    _cancelActionsForStun() {
        super._cancelActionsForStun();
        this._ai?.cancelForCrowdControl?.();
    }

    _startDying() {
        this._ai?.cancelForCrowdControl?.();
        super._startDying();
    }

    getAnimationVisualScale(textureKey, frameName) {
        const inheritedScale = super.getAnimationVisualScale(textureKey, frameName);
        const prefix = `companion_${this.animId}_`;
        const action = String(textureKey || '').startsWith(prefix)
            ? String(textureKey).slice(prefix.length) : '';
        const frame = Math.max(0, Math.floor(Number(frameName) || 0));
        const correction = Number(this.animations?.[action]?.frameScales?.[frame]);
        return inheritedScale * (correction > 0 ? correction : 1);
    }

    /**
     * 正式 running 表在 WebGL 安全宽度重排时产生了少量逐帧主体横移。
     * 这里只抵消打包锚点误差；实体坐标、碰撞和源动作轨迹保持不变。
     */
    getAnimationVisualOffset(textureKey, frameName) {
        const prefix = `companion_${this.animId}_`;
        const action = String(textureKey || '').startsWith(prefix)
            ? String(textureKey).slice(prefix.length) : '';
        const animation = this.animations?.[action];
        const frame = Math.max(0, Math.floor(Number(frameName) || 0));
        return {
            x: Number(animation?.frameOffsetsX?.[frame]) || 0,
            y: Number(animation?.frameOffsetsY?.[frame]) || 0,
        };
    }

    /**
     * 由 HamsterKnightAI 在直击结算后调用。主目标不重复吃爆炸伤害；
     * 其他同承载面的敌人按中心 100% → 边缘 50% 衰减，明确不传 melee、不施加眩晕。
     */
    onChargeImpact({ target, entities, chargeConfig, attackDamage, upgradeMult, parried } = {}) {
        if (!target || parried) return 0;
        const aoe = chargeConfig?.impactAoe || {};
        const radius = Math.max(0, Number(aoe.radius) || 0);
        if (!(radius > 0)) return 0;

        const x = Number(target.collider?.x ?? target.x) || 0;
        const y = Number(target.collider?.y ?? target.y) || 0;
        const surfaceContext = surfaceEffectFromEntity(target);
        const shape = new GroundCircle(x, y, radius, surfaceContext);
        const minRatio = Math.max(0, Math.min(1, Number(aoe.minDamageRatio) || 0.5));
        const baseDamage = Math.max(0, Number(attackDamage) || 0)
            * Math.max(0, Number(aoe.damageMul) || 1)
            * Math.max(0, Number(upgradeMult) || 1);
        let hitCount = 0;
        for (const entity of queryNearbyEntities(entities, { x, y }, radius + 64)) {
            if (!entity || entity === target || !entity.active || entity.hp <= 0
                || entity._faction !== 'enemy' || entity._isEnergyNode || !entity.hittable
                || !shape.intersectsEntity(entity)) continue;
            const ex = Number(entity.collider?.x ?? entity.x) || 0;
            const ey = Number(entity.collider?.y ?? entity.y) || 0;
            const distanceRatio = 1 - Math.min(1, Math.hypot(ex - x, ey - y) / radius);
            const falloff = minRatio + (1 - minRatio) * distanceRatio;
            const damage = this.getPhysicalAttackDamage(baseDamage * falloff, entity);
            entity.takeDamage(damage, this, 'physical', false);
            hitCount++;
        }
        this._lastChargeAoeHitCount = hitCount;
        spawnPoweredLanceExplosion({
            source: this,
            x,
            y,
            z: surfaceContext.z,
            radius,
        });
        const sound = this.sounds?.chargeImpact;
        if (sound && typeof SoundManager?.playWorld === 'function') {
            SoundManager.playWorld(sound, x, y);
        } else if (sound && typeof SoundManager?.playFile === 'function') {
            SoundManager.playFile(sound);
        }
        return hitCount;
    }
}
