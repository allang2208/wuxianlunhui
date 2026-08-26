/**
 * WeaponFxConfig — 武器射击特效与几何偏移常量
 * 将 subsystems.js 中散落的枪口/抛壳窗位置、火光大小、音效路径等硬编码数值集中管理。
 */

export const WEAPON_FX_CONFIG = {
    // 通用默认值
    defaultMaxSpreadAngle: 25,
    switchSpinDelayMs: 150,

    // 手枪（主手）
    pistol: {
        gunLX: 20,
        gunLY: 13,
        muzzleForward: 22,
        flashForward: 28,
        shellOffset: { fx: -8, fy: 6 },
        muzzleScale: 1.2,
        defaultSound: 'gun_fire',
        cameraShake: 0
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
        cameraShake: 4,
        cameraShakeEnergy: 2,
        soundMap: {
            energy_lmg: 'assets/sounds/weapons/apex_shot_600ms.wav',
            pkm: 'assets/sounds/weapons/pkm_half_sec.wav',
            rpd: 'assets/sounds/weapons/rpd_fire.wav',
            m249: 'assets/sounds/weapons/m249_fire.wav',
            ultimax100: 'assets/sounds/weapons/ultimax100_fire.wav',
            mg42: 'assets/sounds/weapons/mg42_fire.wav',
            fusion_core_lmg: 'assets/sounds/weapons/fusion_core_lmg_fire.wav',
            singularity_loom_lmg: 'assets/sounds/weapons/singularity_loom_lmg_fire.wav',
            celestial_cartographer_lmg: 'assets/sounds/weapons/celestial_cartographer_lmg_fire.wav',
            grave_covenant_cantor_lmg: 'assets/sounds/weapons/grave_covenant_cantor_lmg_fire.wav',
            qbz191: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
            qjb201: 'assets/sounds/weapons/qjb201_single_600ms.wav',
            akm: 'assets/sounds/weapons/akm_burst.mp3',
            stg44: 'assets/sounds/weapons/stg44_fire.wav',
            m416: 'assets/sounds/weapons/m416_fire.wav',
            qbz95: 'assets/sounds/weapons/qbz95_fire.wav',
            frontier_rifle: 'assets/sounds/weapons/m416_fire.wav',
            vengeance_rifle: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
            astral_tide_rifle: 'assets/sounds/weapons/m416_fire.wav',
            zero_point_rifle: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
            corona_cadence_rifle: 'assets/sounds/weapons/m416_fire.wav',
            terminal_echo_rifle: 'assets/sounds/weapons/m416_fire.wav'
        }
    },

    // 霰弹枪
    shotgun: {
        gunLX: 24,
        muzzleForward: 30,
        flashForward: 38,
        shellOffset: { fx: -10, fy: 8 },
        muzzleScale: 1.8,
        defaultSound: 'assets/sounds/weapons/gunshot_600ms_clean.wav',
        baseSpreadAngle: 20,
        slugRecoilAnglePerLayer: 5,
        defaultPelletCount: 6,
        cameraShake: 6
    },

    // 弓
    bow: {
        bowLX: 15
    }
};
