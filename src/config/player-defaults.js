/**
 * PlayerDefaults — 玩家初始状态与资源路径配置
 * 将 entities/player/index.js 中大量硬编码的初始值集中到此处。
 */

export const PLAYER_DEFAULTS = {
    physics: {
        // 玩家贴图显示尺寸（单位：像素），所有显示/碰撞尺寸均由此推导，避免硬编码
        spriteSize: 120,
        // 玩家碰撞/受击体积：宽度 30、高度 90 的矩形（竖向人物贴图）
        // collisionRadius 作为圆形回退和墙壁碰撞的等效半径，取长边的一半
        collisionWidth: 30,
        collisionHeight: 90,
        collisionRadius: 45,
        hitboxRadius: 60,
        hitboxMultipliers: [1.2, 1.0, 0.8, 1.5, 0.8, 1.0],
        accel: 0.7,
        friction: 0.82
    },

    combat: {
        hitFlashDuration: 300,
        gameStartCooldown: 500,
        weaponSwitchCooldown: 0
    },

    whirlwind: {
        duration: 800
    },

    specialAttack: {
        clampedLength: 1500
    },

    data: {
        name: '轮回者',
        level: 1,
        class: '初心者',
        hp: 100,
        maxHp: 100,
        mp: 100,
        maxMp: 100,
        stamina: null, // 运行时使用 CONFIG.STAMINA_MAX
        maxStamina: null, // 运行时使用 CONFIG.STAMINA_MAX
        exp: 0,
        maxExp: null, // 由 Player.updateMaxStats 根据公式动态计算
        str: 10,
        dex: 10,
        int: 10,
        con: 10,
        wis: 10,
        luck: 10,
        atk: 0,
        def: 0,
        matk: 0,
        mdef: 0,
        hit: 0,
        dodge: 0,
        crit: 0,
        critRes: 0,
        aspd: 0,
        speed: 0,
        loopCount: 0,
        surviveDays: 1,
        kills: 0,
        quests: 0,
        geneLock: '未开启',
        rank: 'F',
        attrPoints: 0,
        hpRegen: 1,
        mpRegen: 1
    },

    bowFrames: {
        count: 8,
        prefix: 'assets/weapons/bow_frame_'
    },

    images: {
        melee: 'assets/weapons/1-rusty_sword_euip.png',
        bowEquip: 'assets/weapons/trainingBOW.png',
        pistol: 'assets/weapons/G18equip.png',
        deagle: 'assets/weapons/Desert eagle-eqiup.png',
        p4040: 'assets/weapons/P4040-equip.png',
        pkm: 'assets/weapons/pkm_topdown.png',
        akm: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png',
        qbz191: 'assets/weapons/191equip_clean.png',
        qjb201: 'assets/weapons/201equip.png',
        super90: 'assets/weapons/M4s90_equip.png',
        saiga12k: 'assets/weapons/S12k-equip.png',
        energyLmg: 'assets/weapons/devotion-equip.png',
        shield: 'assets/weapons/woodshied-equip.png',
        arrow: 'assets/ammo/arrow.png'
    }
};
