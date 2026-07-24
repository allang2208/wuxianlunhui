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
 * @property {number} [poisonChance] 命中附加中毒概率（0~1）
 * @property {number} [poisonStacks] 附加中毒层数
 * @property {string|null} [textureKey] 显式 Phaser 纹理键（优先于 image 的箭头回退）
 * @property {number} [depthBonus] 深度加成（叠加在 y+12 之上，用于保证贴图层级不被遮挡）
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
            knockback,
            poisonChance = 0,
            poisonStacks = 1,
            textureKey = null,
            depthBonus = 0
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
            p.poisonChance = poisonChance;
            p.poisonStacks = poisonStacks;
            // 始终重置，防止对象池复用时残留上一发投射物的击退/纹理键/深度加成/清理回调
            p.textureKey = textureKey;
            p.depthBonus = depthBonus;
            p.knockback = knockback ?? 0;
            p._onBeforeDestroy = null;
            p.traveled = 0;
            p.active = true;
            p.hitTargets = new Set();
            p.syncPhaserSprite();
        } else {
            p = new Projectile(
                x, y, angle, speed, maxRange, size,
                damage, piercing, source, entities, image,
                isTracer, isGold, isDarkGold, damageType,
                noRender, isGreen, isSpit, poisonChance, poisonStacks, textureKey
            );
            p.depthBonus = depthBonus;
            p.knockback = knockback ?? 0;
            // 构造函数内已创建 Sprite（depthBonus 尚未生效），立即同步一次深度/尺寸
            p.syncPhaserSprite();
        }
        // 快照发射瞬间武器的附魔/改造效果：命中时按快照判定，防止弹道飞行中切枪改变命中效果
        const snapWeapon = source ? (source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null)) : null;
        p._effectSnapshot = {
            enchant: snapWeapon && snapWeapon._enchantEffects ? { ...snapWeapon._enchantEffects } : null,
            craft: snapWeapon && snapWeapon._craftEffects ? { ...snapWeapon._craftEffects } : null
        };
        EffectManager.add(p);
        return p;
    }
};
