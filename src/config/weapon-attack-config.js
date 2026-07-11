/**
 * WeaponAttackConfig — 玩家武器攻击配置
 * 将原先散落在 entities/player/index.js 中的硬编码武器参数集中管理。
 */

import { ThrustAttack, RangedAttack } from '../combat/attack.js';

export const WEAPON_ATTACK_CONFIG = {
    // 近战
    melee: {
        type: 'ThrustAttack',
        cooldown: 500,
        range: 116,
        width: 25,
        damage: { min: 12, max: 20 },
        knockback: 8
    },

    // 默认远程（弓）
    ranged: {
        type: 'RangedAttack',
        cooldown: 600,
        projectileSpeed: 1248,
        projectileRange: 1000,
        projectileSize: 9,
        damage: { min: 8, max: 16 },
        piercing: false
    },

    // 手枪
    pistol: {
        type: 'RangedAttack',
        cooldown: 55,
        projectileSpeed: 1248,
        projectileRange: 650,
        projectileSize: 4,
        damage: { min: 4, max: 8 },
        piercing: false,
        knockback: 0
    },
    pistolOffhand: {
        type: 'RangedAttack',
        cooldown: 55,
        projectileSpeed: 1248,
        projectileRange: 650,
        projectileSize: 4,
        damage: { min: 4, max: 8 },
        piercing: false,
        knockback: 0
    },

    // 沙漠之鹰
    deagle: {
        type: 'RangedAttack',
        cooldown: 800,
        projectileSpeed: 1248,
        projectileRange: 750,
        projectileSize: 5,
        damage: { min: 4, max: 8 },
        piercing: false,
        knockback: 10
    },
    deagleOffhand: {
        type: 'RangedAttack',
        cooldown: 800,
        projectileSpeed: 1248,
        projectileRange: 750,
        projectileSize: 5,
        damage: { min: 4, max: 8 },
        piercing: false,
        knockback: 10
    },

    // P4040
    p4040: {
        type: 'RangedAttack',
        cooldown: 300,
        projectileSpeed: 1248,
        projectileRange: 750,
        projectileSize: 4,
        damage: { min: 2, max: 4 },
        piercing: false,
        knockback: 2
    },
    p4040Offhand: {
        type: 'RangedAttack',
        cooldown: 300,
        projectileSpeed: 1248,
        projectileRange: 750,
        projectileSize: 4,
        damage: { min: 2, max: 4 },
        piercing: false,
        knockback: 2
    },

    // 机枪/步枪
    pkm: {
        type: 'RangedAttack',
        cooldown: 92,
        projectileSpeed: 1248,
        projectileRange: 1200,
        projectileSize: 5,
        damage: { min: 1, max: 1 },
        piercing: false
    },
    akm: {
        type: 'RangedAttack',
        cooldown: 100,
        projectileSpeed: 1248,
        projectileRange: 1200,
        projectileSize: 5,
        damage: { min: 1, max: 1 },
        piercing: false
    },
    qbz191: {
        type: 'RangedAttack',
        cooldown: 70,
        projectileSpeed: 1248,
        projectileRange: 1200,
        projectileSize: 5,
        damage: { min: 1, max: 1 },
        piercing: false
    },
    qjb201: {
        type: 'RangedAttack',
        cooldown: 60,
        projectileSpeed: 1248,
        projectileRange: 1200,
        projectileSize: 5,
        damage: { min: 1, max: 1 },
        piercing: false
    },
    energy_lmg: {
        type: 'RangedAttack',
        cooldown: 333,
        projectileSpeed: 1248,
        projectileRange: 1200,
        projectileSize: 5,
        damage: { min: 1, max: 1 },
        piercing: false,
        knockback: 0
    },

    // 霰弹枪
    super90: {
        type: 'RangedAttack',
        cooldown: 333,
        projectileSpeed: 1248,
        projectileRange: 500,
        projectileSize: 6,
        damage: { min: 1, max: 1 },
        piercing: false,
        knockback: 12.5
    },
    saiga12k: {
        type: 'RangedAttack',
        cooldown: 150,
        projectileSpeed: 1248,
        projectileRange: 400,
        projectileSize: 6,
        damage: { min: 1, max: 1 },
        piercing: false,
        knockback: 12.5
    }
};

/**
 * 根据配置创建攻击实例。
 * @param {Object} config
 * @returns {ThrustAttack|RangedAttack|null}
 */
export function createAttackFromConfig(config) {
    if (!config) return null;
    if (config.type === 'ThrustAttack') {
        return new ThrustAttack(config);
    }
    if (config.type === 'RangedAttack') {
        return new RangedAttack(config);
    }
    return null;
}
