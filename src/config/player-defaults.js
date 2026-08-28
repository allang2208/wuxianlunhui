/**
 * PlayerDefaults — 玩家初始状态与资源路径配置
 * 将 entities/player/index.js 中大量硬编码的初始值集中到此处。
 */

export const PLAYER_DEFAULTS = {
    physics: {
        // 玩家贴图显示尺寸（单位：像素），所有显示/碰撞尺寸均由此推导，避免硬编码
        spriteSize: 144, // 2026-07-28：120 → 144（人物贴图放大 20%，武器经 WEAPON_ANIM.size 105→126 同步放大，其他不变）
        // 玩家碰撞/受击体积：宽度 30、高度 60 的矩形（竖向人物贴图）
        // 之前 90 过高，导致投射物在玩家头顶/脚下附近也被判定命中
        // collisionRadius 作为圆形回退和墙壁碰撞的等效半径；
        // 2026-07-17：脚下椭圆判定（footprint）缩小 25%（30 → 22.5），
        // 阴影/分离/墙壁碰撞/被近战与投射物命中均由此值单一驱动，随动缩小
        collisionWidth: 40,  // 绿色矩形（受击矩形）向左拉伸 10px：宽 30→40 且中心左移 5（右缘不变）
        collisionHeight: 60,
        collisionRadius: 22.5,
        // 圆柱体（胶囊）碰撞体积整体偏移：上移 5px / 受击矩形左移 5px（配合宽 40 实现向左拉伸 10）
        colliderOffsetX: -5,
        colliderOffsetY: -5,
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
        pistol: 'assets/icons/G18icon.png',
        deagle: 'assets/icons/DesertEagle_icon.png',
        revolver: 'assets/weapons/revolver357-equip.png',
        p4040: 'assets/weapons/P4040-icon.png',
        m1911a1: 'assets/weapons/m1911a1-equip.png',
        usp45: 'assets/weapons/usp45-equip.png',
        fiveSeven: 'assets/weapons/five-seven-equip.png',
        eternalEdict: 'assets/weapons/eternal-edict-equip.png',
        falconEdict: 'assets/weapons/falcon-edict-equip.png',
        crimsonCrownSettlement: 'assets/weapons/crimson-crown-settlement-equip.png',
        myriadCorridor: 'assets/weapons/myriad-corridor-equip.png',
        pkm: 'assets/icons/pkm_side_clean.png',
        rpd: 'assets/weapons/rpd-equip.png',
        m249: 'assets/weapons/m249-equip.png',
        ultimax100: 'assets/weapons/ultimax100-equip.png',
        mg42: 'assets/weapons/mg42-equip.png',
        fusionCoreLmg: 'assets/weapons/fusion-core-lmg-equip.png',
        singularityLoomLmg: 'assets/weapons/singularity-loom-lmg-equip.png',
        singularityLoomLmg: 'assets/weapons/singularity-loom-lmg-equip.png',
        celestialCartographerLmg: 'assets/weapons/celestial-cartographer-lmg-equip.png',
        graveCovenantCantorLmg: 'assets/weapons/grave-covenant-cantor-lmg-equip.png',
        akm: 'assets/weapons/akm-equip.png',
        stg44: 'assets/weapons/stg44-equip.png',
        m416: 'assets/weapons/m416-equip.png',
        qbz95: 'assets/weapons/qbz95-equip.png',
        frontierRifle: 'assets/weapons/frontier-rifle-equip.png',
        vengeanceRifle: 'assets/weapons/vengeance-rifle-equip.png',
        astralTideRifle: 'assets/weapons/astral-tide-rifle-equip.png',
        zeroPointRifle: 'assets/weapons/zero-point-arbitrator-equip.png',
        coronaCadenceRifle: 'assets/weapons/corona-cadence-rifle-equip.png',
        terminalEchoRifle: 'assets/weapons/terminal-echo-rifle-equip.png',
        qbz191: 'assets/icons/191icon.png',
        qjb201: 'assets/icons/201-icon.png',
        super90: 'assets/icons/M4s90_icon.png',
        saiga12k: 'assets/icons/S12k-icon.png',
        s686: 'assets/weapons/s686-equip.png',
        m870Breacher: 'assets/weapons/m870-breacher-equip.png',
        ksg12: 'assets/weapons/ksg12-equip.png',
        spas12: 'assets/weapons/spas12-equip.png',
        aa12: 'assets/weapons/aa12-equip.png',
        winchester1887: 'assets/weapons/winchester1887-equip.png',
        terminusPendulum: 'assets/weapons/terminus-pendulum-equip.png',
        voidFuneralTide: 'assets/weapons/void-funeral-tide-equip.png',
        blackSunVerdict: 'assets/weapons/black-sun-verdict-equip.png',
        royalHuntFinale: 'assets/weapons/royal-hunt-finale-equip.png',
        energyLmg: 'assets/icons/devotion-icon.png',
        shield: 'assets/weapons/woodshied-equip.png',
        arrow: 'assets/ammo/arrow.png'
    }
};
