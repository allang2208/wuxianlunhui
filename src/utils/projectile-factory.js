/**
 * ProjectileFactory — 统一投射物创建与对象池复用
 * 封装 EffectManager._acquire('Projectile') 的回退逻辑，
 * 减少 player/subsystems.js 等处的重复代码。
 */

import { EffectManager } from '../effects/effect-manager.js';
import { Projectile } from '../combat/projectile.js';
import { WallSystem } from '../world/wall-system.js';
import {
    applyElevatedRangedRange,
    projectileWallContext,
} from '../combat/elevated-ranged.js';

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
 * @property {Object|null} [effectWeapon] 发射瞬间实际使用的武器（双持副手不能回退主手）
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
 * @property {number} [z] 发射高度
 * @property {number} [targetZ] 瞄准高度
 * @property {number} [aimDistance] 到瞄准点的平面距离
 * @property {number} [groundY] 枪口视觉Y还原后的地面平面Y
 * @property {number} [groundAngle] 地面平面内弹道角
 * @property {Object|null} [wallContext] 调用方追加的墙体忽略上下文
 * @property {{start:number,minMultiplier:number}|null} [damageFalloff] 远距伤害衰减配置
 * @property {boolean} [playerGunWallSparks] 仅由玩家枪械分支显式开启的障碍物命中火花
 * @property {Function|null} [onFirstHit] 弹丸首次有效命中后的回调（对象池复用前必须清空）
 * @property {boolean} [isPurple] 洋红相位曳光弹
 * @property {boolean} [isCrimson] 赤金日冕曳光弹
 * @property {boolean} [isCyan] 青白收束曳光弹
 * @property {Object|null} [hitContext] 发射瞬间的单发伤害上下文快照
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
            effectWeapon = null,
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
            depthBonus = 0,
            z = null,
            targetZ = null,
            aimDistance = null,
            groundY = null,
            groundAngle = null,
            wallContext = null,
            damageFalloff = null,
            playerGunWallSparks = false,
            onFirstHit = null,
            isPurple = false,
            isCrimson = false,
            isCyan = false,
            hitContext = null,
        } = options;
        const effectiveMaxRange = applyElevatedRangedRange(source, maxRange);
        const sourceHeight = source?.collider?.height || source?.collisionHeight || source?.size || 40;
        const startZ = Number.isFinite(z) ? z : (Number(source?.z) || 0) + sourceHeight * 0.58;
        const projectileY = Number.isFinite(groundY) ? groundY : y;
        const sourceTarget = source?.target?.active ? source.target : null;
        const endZ = Number.isFinite(targetZ)
            ? targetZ
            : (sourceTarget?.collider?.centerZ
                ?? ((Number(sourceTarget?.z) || 0) + 24));
        const targetDistance = sourceTarget
            ? Math.hypot((sourceTarget.x || 0) - x, (sourceTarget.y || 0) - y)
            : 0;
        const horizontalDistance = Math.max(
            1,
            Number(aimDistance) || targetDistance || effectiveMaxRange || 1
        );
        const travelTime = horizontalDistance / Math.max(1, speed || 1);
        const vz = (endZ - startZ) / Math.max(0.001, travelTime);
        const projectileAngle = Number.isFinite(groundAngle) ? groundAngle : angle;
        const projectileVisualAngle = Number.isFinite(groundAngle)
            ? angle
            : Math.atan2(
                Math.sin(projectileAngle) * speed - vz,
                Math.cos(projectileAngle) * speed
            );

        // 出膛嵌墙检测（不改变出弹位置，"只出不进"方案）：
        // 枪口探入/探过墙体时，记录被嵌入的墙 + 射手所在侧——该投射物只允许朝射手一侧越出，
        // 越向另一侧（钻透）即销毁；其余墙与无嵌墙情况走原 blocked 判定（贴墙开不出枪的根因治理）
        let embeddedWalls = (source && WallSystem && typeof WallSystem.detectEmbeddedWalls === 'function')
            ? WallSystem.detectEmbeddedWalls(x, projectileY, source)
            : null;
        if (embeddedWalls) {
            embeddedWalls.segs = (embeddedWalls.segs || []).filter((entry) => {
                const height = Number(entry.seg?._owner?._wallTopZ)
                    || Number(entry.seg?.height)
                    || Number(WallSystem._wallHeight)
                    || 60;
                return startZ <= height;
            });
            embeddedWalls.rects = (embeddedWalls.rects || []).filter((entry) =>
                startZ <= (Number(entry.rect?.height) || Number(WallSystem._wallHeight) || 60));
            if (!embeddedWalls.segs.length && !embeddedWalls.rects.length) embeddedWalls = null;
        }

        let p = EffectManager._acquire('Projectile');
        if (p) {
            p.x = x;
            p.y = projectileY;
            p.angle = projectileAngle;
            p.visualAngle = projectileVisualAngle;
            p.speed = speed;
            p.maxRange = effectiveMaxRange;
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
            p.isPurple = isPurple;
            p.isCrimson = isCrimson;
            p.isCyan = isCyan;
            p.isSpit = isSpit;
            p.damageType = damageType;
            p._noRender = noRender;
            p.poisonChance = poisonChance;
            p.poisonStacks = poisonStacks;
            // 始终重置，防止对象池复用时残留上一发投射物的击退/纹理键/深度加成/清理回调
            p.textureKey = textureKey;
            p.depthBonus = depthBonus;
            p.knockback = knockback ?? 0;
            p.damageFalloff = damageFalloff ? { ...damageFalloff } : null;
            p.playerGunWallSparks = playerGunWallSparks === true;
            p._onFirstHit = typeof onFirstHit === 'function' ? onFirstHit : null;
            p._hitContext = hitContext && typeof hitContext === 'object' ? { ...hitContext } : null;
            p._firstHitTriggered = false;
            p._onBeforeDestroy = null;
            p.traveled = 0;
            p.active = true;
            if (!p.hitTargets) p.hitTargets = new Set();
            else p.hitTargets.clear();
            if (!Array.isArray(p._candidateEntities)) p._candidateEntities = [];
            else p._candidateEntities.length = 0;
            p._embeddedWalls = embeddedWalls;
            p._wallContext = projectileWallContext(source, wallContext, {
                x,
                y: projectileY,
                z: startZ,
            });
            p.z = startZ;
            p.prevZ = startZ;
            p.vz = vz;
            p.syncPhaserSprite();
        } else {
            p = new Projectile(
                x, projectileY, projectileAngle, speed, effectiveMaxRange, size,
                damage, piercing, source, entities, image,
                isTracer, isGold, isDarkGold, damageType,
                noRender, isGreen, isSpit, poisonChance, poisonStacks, textureKey
            );
            p.depthBonus = depthBonus;
            p.knockback = knockback ?? 0;
            p.damageFalloff = damageFalloff ? { ...damageFalloff } : null;
            p.playerGunWallSparks = playerGunWallSparks === true;
            p.isPurple = isPurple;
            p.isCrimson = isCrimson;
            p.isCyan = isCyan;
            p._onFirstHit = typeof onFirstHit === 'function' ? onFirstHit : null;
            p._hitContext = hitContext && typeof hitContext === 'object' ? { ...hitContext } : null;
            p._firstHitTriggered = false;
            p._embeddedWalls = embeddedWalls;
            p._wallContext = projectileWallContext(source, wallContext, {
                x,
                y: projectileY,
                z: startZ,
            });
            p.z = startZ;
            p.prevZ = startZ;
            p.vz = vz;
            p.visualAngle = projectileVisualAngle;
            // 构造函数内已创建 Sprite（depthBonus 尚未生效），立即同步一次深度/尺寸
            p.syncPhaserSprite();
        }
        // 快照发射瞬间武器身份及附魔/改造效果：命中时按快照判定，
        // 防止弹道飞行中切枪改变枪械分类或命中效果。
        const snapWeapon = effectWeapon || (source ? (source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null)) : null);
        p._effectSnapshot = {
            weaponId: snapWeapon?.weaponId ?? null,
            name: snapWeapon?.name ?? null,
            weaponType: snapWeapon?.weaponType ?? null,
            rangedType: snapWeapon?.rangedType ?? null,
            ammoConfig: snapWeapon?.ammoConfig ? { ...snapWeapon.ammoConfig } : null,
            enchant: snapWeapon && snapWeapon._enchantEffects ? { ...snapWeapon._enchantEffects } : null,
            craft: snapWeapon && snapWeapon._craftEffects ? { ...snapWeapon._craftEffects } : null
        };
        p._onHitSpeedBuffTriggered = false;
        EffectManager.add(p);
        return p;
    }
};
