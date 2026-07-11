/**
 * WeaponFxConfig — 武器射击特效与几何偏移常量
 * 将 subsystems.js 中散落的枪口/抛壳窗位置、火光大小、音效路径等硬编码数值集中管理。
 */

export const WEAPON_FX_CONFIG = {
    // 手枪（主手）
    pistol: {
        gunLX: 20,
        gunLY: 13,
        muzzleForward: 22,
        flashForward: 28,
        shellOffset: { fx: -8, fy: 6 },
        muzzleScale: 1.2,
        defaultSound: 'gun_fire'
    },

    // 手枪（副手）
    pistolOffhand: {
        gunLX: 20,
        gunLY: -13,
        muzzleForward: 22,
        flashForward: 28,
        shellOffset: { fx: -8, fy: 6 },
        muzzleScale: 0.8,
        defaultSound: 'gun_fire'
    },

    // 机枪 / 步枪
    lmg: {
        gunLX: 24,
        muzzleForward: 30,
        flashForward: 38,
        shellOffset: { fx: -10, fy: 8 },
        muzzleScale: 1.5,
        muzzleScaleEnergy: 1.0,
        defaultSound: 'gun_fire',
        soundMap: {
            energy_lmg: 'assets/sounds/apex_shot_600ms.wav',
            pkm: 'assets/sounds/pkm_half_sec.wav',
            qbz191: 'assets/sounds/qbz191_shot6_valley.mp3',
            qjb201: 'assets/sounds/qjb201_single_600ms.wav',
            akm: 'assets/sounds/akm_burst.mp3'
        }
    },

    // 霰弹枪
    shotgun: {
        gunLX: 24,
        muzzleForward: 30,
        flashForward: 38,
        shellOffset: { fx: -10, fy: 8 },
        muzzleScale: 1.8,
        defaultSound: 'assets/sounds/gunshot_600ms_clean.wav',
        baseSpreadAngle: 20,
        slugRecoilAnglePerLayer: 5,
        defaultPelletCount: 6
    },

    // 弓
    bow: {
        bowLX: 15
    }
};
