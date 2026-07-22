import equipmentJson from '../../../../data/equipment.json';
import { WEAPON_ATTACK_CONFIG, createAttackFromConfig } from '../../../config/weapon-attack-config.js';
import { EffectFactory } from '../../../utils/effect-factory.js';
import { WallSystem } from '../../../world/wall-system.js';
import { isFacingLeftFrom } from './enemy-utils.js';

/**
 * 怪物枪械射击共享件（时空特工工作流沉淀，其他持枪怪物直接复用）
 *
 * setupGun：给怪物装备一件枪械——实例化装备、绑定攻击配置、伤害/击退覆盖、AI 散布；
 * tryEnemyFireGun：开火一体化——枪口点计算（上移/左右偏移/防御姿态下移）、
 *   墙体回退（防子弹出生即消失）、瞄准目标矩形上方区域、临时移位出膛、
 *   枪口火焰 + 开火火光 + 弹壳。
 */

/**
 * 给怪物装备枪械
 * @param {Enemy} host 怪物实例（需有 equipments/attacks/_isHumanoid/_currentSpreadFactor 字段）
 * @param {object} opts { equipKey, attackKey, damage, knockback, spreadFactor, spreadMaxAngle, fireSound, ammoConfig }
 */
export function setupGun(host, opts) {
    const item = JSON.parse(JSON.stringify(equipmentJson.equipment[opts.equipKey]));
    // attackKey 指到武器攻击配置（装备的 weaponType 与攻击配置键不一致时必填）
    if (opts.attackKey) item.attackKey = opts.attackKey;
    if (opts.fireSound) item.fireSound = opts.fireSound;
    if (opts.ammoConfig) item.ammoConfig = { ...opts.ammoConfig };
    host._isHumanoid = true;
    host.equipments.weapon = item;
    const attackKey = opts.attackKey || item.weaponType;
    host.attacks[attackKey] = createAttackFromConfig(WEAPON_ATTACK_CONFIG[attackKey]);
    // 伤害覆盖（fireProjectile 默认读 config.damage 占位值）
    if (opts.damage) host.attacks[attackKey].config.damage = { ...opts.damage };
    if (opts.knockback !== undefined) host.attacks[attackKey].config.knockback = opts.knockback;
    // AI 散布（fireProjectile 读取，避免 undefined → NaN 弹道）
    host._currentSpreadFactor = opts.spreadFactor ?? 0.15;
    host._currentSpreadMaxAngle = opts.spreadMaxAngle ?? 10;
    return attackKey;
}

/**
 * 开火一体化
 * @param {Enemy} host 怪物实例
 * @param {object} t 目标
 * @param {Map|Array} entities 实体集合
 * @param {object} cfg { muzzleUpY, muzzleSideX, muzzleScale, aimHeightRatio, defendMuzzleDownY, defendActive, slot }
 * @returns {boolean} 是否成功开火
 */
export function tryEnemyFireGun(host, t, entities, cfg = {}) {
    const up = cfg.muzzleUpY ?? 75;
    const side = cfg.muzzleSideX ?? 15;
    const ox = host.x, oy = host.y;
    let mx = ox + (isFacingLeftFrom(host) ? -side : side);
    let my = oy - up;
    // 防御姿态开火：枪口点下移（仅调用方标记 defendActive 时生效，退出自动恢复）
    if (cfg.defendActive) {
        my += cfg.defendMuzzleDownY ?? 0;
    }
    // 枪口点落进墙内时（贴墙站位）回退到可达点，防止子弹出生即撞墙消失
    if (WallSystem && typeof WallSystem.resolve === 'function') {
        const resolved = WallSystem.resolve(ox, oy, mx, my, 4);
        mx = resolved.x;
        my = resolved.y;
    }
    // 瞄准点：目标绿色矩形判定上方 25% 区域中心（aimHeightRatio 默认 0.875）
    const targetH = t.collisionHeight || t.config?.render?.collisionHeight || 60;
    const footY = t.collider ? t.collider.y : t.y;
    const aimX = t.x;
    const aimY = footY - targetH * (cfg.aimHeightRatio ?? 0.875);
    // 子弹从枪口射出：fireProjectile 固定从 this.x/y 生成，临时移位后还原
    host.x = mx; host.y = my;
    const fired = host.fireProjectile(aimX, aimY, entities, { slot: cfg.slot || 'weapon' });
    host.x = ox; host.y = oy;
    if (!fired) return false;
    // 枪口火焰 + 开火火光 + 弹壳
    const angle = Math.atan2(aimY - my, aimX - mx);
    EffectFactory.createMuzzleFlash(mx, my, angle, cfg.muzzleScale ?? 1.2);
    const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
    if (scene && typeof scene.playMuzzleFire === 'function') {
        scene.playMuzzleFire(mx, my);
    }
    EffectFactory.createShellCasing(mx, my, angle, oy);
    return true;
}
