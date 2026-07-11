/**
 * ProjectileFactory — 统一投射物创建与对象池复用
 * 封装 EffectManager._acquire('Projectile') 的回退逻辑，
 * 减少 player/subsystems.js 等处的重复代码。
 */

import { EffectManager } from '../effects/effect-manager.js';
import { Projectile } from '../combat/projectile.js';

/**
 * @typedef {Object} ProjectileOptions
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} speed
 * @property {number} maxRange
 * @property {number} size
 * @property {{min:number, max:number}} damage
 * @property {boolean} piercing
 * @property {Object} source
 * @property {Map|Array} entities
 * @property {HTMLImageElement|null} [image]
 * @property {boolean} [isTracer]
 * @property {boolean} [isGold]
 * @property {boolean} [isDarkGold]
 * @property {boolean} [isGreen]
 * @property {boolean} [isSpit]
 * @property {string} [damageType]
 * @property {boolean} [noRender]
 */

export const ProjectileFactory = {
    /**
     * 从对象池获取或新建 Projectile，并自动加入 EffectManager。
     * @param {ProjectileOptions} options
     * @returns {Projectile}
     */
    create(options) {
        const {
            x, y, angle, speed, maxRange, size,
            damage, piercing, source, entities,
            image = null,
            isTracer = false,
            isGold = false,
            isDarkGold = false,
            isGreen = false,
            isSpit = false,
            damageType = 'physical',
            noRender = false,
            knockback
        } = options;

        let p = EffectManager._acquire('Projectile');
        if (p) {
            p.x = x;
            p.y = y;
            p.angle = angle;
            p.speed = speed;
            p.maxRange = maxRange;
            p.size = size;
            p.damage = damage;
            p.piercing = piercing;
            p.source = source;
            p.entities = entities;
            p.image = image;
            p.isTracer = isTracer;
            p.isGold = isGold;
            p.isDarkGold = isDarkGold;
            p.isGreen = isGreen;
            p.isSpit = isSpit;
            p.damageType = damageType;
            p._noRender = noRender;
            if (knockback !== undefined) p.knockback = knockback;
            p.traveled = 0;
            p.active = true;
            p.hitTargets = new Set();
            p.syncPhaserSprite();
        } else {
            p = new Projectile(
                x, y, angle, speed, maxRange, size,
                damage, piercing, source, entities, image,
                isTracer, isGold, isDarkGold, damageType,
                noRender, isGreen, isSpit
            );
            if (knockback !== undefined) p.knockback = knockback;
        }
        EffectManager.add(p);
        return p;
    }
};
