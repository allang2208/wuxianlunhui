// Enemy data configuration (for codex and scene generation)

const ENEMY_DATA = {
    zombie: {
        name: "僵尸", type: "普通", category: "monster",
        color: "#5a8a4a", size: 14,
        hp: 100, maxHp: 100,
        def: 7, speed: 0.2,
        attackRange: 60, attackCooldown: 800,
        attackType: "近战突刺", knockback: 10,
        level: 3, rank: "normal",
        str: 10, dex: 15, con: 15, int: 3, wis: 4, luck: 5,
        atk: 14
    },
    runnerZombie: {
        name: "奔跑僵尸", type: "普通", category: "monster",
        color: "#8a3a3a", size: 12,
        hp: 120, maxHp: 120,
        def: 7, speed: 0.5,
        attackRange: 55, attackCooldown: 500,
        attackType: "快速撕咬", knockback: 8,
        level: 4, rank: "normal",
        str: 15, dex: 30, con: 15, int: 3, wis: 3, luck: 4,
        atk: 14
    },
    fatZombie: {
        name: "胖子僵尸", type: "首领", category: "monster",
        color: "#6a4a2a", size: 22,
        hp: 400, maxHp: 400,
        def: 25, speed: 0.12,
        attackRange: 90, attackCooldown: 1200,
        attackType: "重击碾压", knockback: 20,
        level: 8, rank: "boss",
        str: 45, dex: 45, con: 50, int: 3, wis: 4, luck: 3,
        atk: 19
    },
    spitterZombie: {
        name: "毒液僵尸", type: "精英", category: "monster",
        color: "#7a3a8a", size: 13,
        hp: 150, maxHp: 150,
        def: 10, speed: 0.3,
        attackRange: 350, attackCooldown: 1500,
        attackType: "毒液喷射", knockback: 0,
        level: 5, rank: "elite",
        str: 22, dex: 38, con: 20, int: 10, wis: 6, luck: 5,
        atk: 15
        ,piercing: false
    },
    babySpider: {
        name: "小蜘蛛", type: "次级", category: "monster",
        color: "#7a5a3a", size: 10,
        hp: 50, maxHp: 50,
        def: 2, speed: 0.5,
        attackRange: 55, attackCooldown: 500,
        attackType: "撕咬", knockback: 8,
        level: 2, rank: "minor",
        str: 5, dex: 8, con: 5, int: 2, wis: 2, luck: 4,
        atk: 12
    },
    spider: {
        name: "普通蜘蛛", type: "普通", category: "monster",
        color: "#6a3a5a", size: 16,
        hp: 180, maxHp: 180,
        def: 11, speed: 0.3,
        attackRange: 65, attackCooldown: 800,
        attackType: "撕咬", knockback: 10,
        level: 5, rank: "normal",
        str: 20, dex: 40, con: 22, int: 4, wis: 5, luck: 5,
        atk: 15
    },
    wolfSpider: {
        name: "狼蛛", type: "精英", category: "monster",
        color: "#4a2a3a", size: 20,
        hp: 280, maxHp: 280,
        def: 18, speed: 0.2,
        attackRange: 95, attackCooldown: 1000,
        attackType: "毒咬", knockback: 20,
        level: 7, rank: "elite",
        str: 40, dex: 60, con: 35, int: 4, wis: 6, luck: 4,
        atk: 22
        ,poisonStacks: 1
    },
    broodmotherSpider: {
        name: "育母蜘蛛", type: "首领", category: "monster",
        color: "#2a1a2a", size: 35,
        hp: 550, maxHp: 550,
        def: 30, speed: 0.25,
        attackRange: 100, attackCooldown: 1200,
        attackType: "剧毒喷射", knockback: 25,
        level: 10, rank: "boss",
        str: 55, dex: 65, con: 60, int: 6, wis: 10, luck: 6,
        atk: 30
        ,poisonStacks: 2
        ,spawnOnDeath: "babySpider"
    },
    blackWolf: {
        name: "黑狼", type: "普通", category: "monster",
        color: "#2a2a2a", size: 18,
        hp: 120, maxHp: 120,
        def: 9, speed: 0.8,
        attackRange: 88, attackCooldown: 312,
        attackType: "撕咬", knockback: 13,
        level: 4, rank: "normal",
        str: 16, dex: 28, con: 18, int: 4, wis: 4, luck: 6,
        atk: 18
    },
    skeletonWarrior: {
        name: "骷髅兵", type: "次级", category: "monster",
        color: "#d0d0b0", size: 14,
        hp: 80, maxHp: 80,
        def: 7, speed: 0.3,
        attackRange: 60, attackCooldown: 800,
        attackType: "近战突刺", knockback: 15,
        level: 3, rank: "minor",
        str: 10, dex: 18, con: 15, int: 3, wis: 3, luck: 4,
        atk: 17
    },
    skeletonArcher: {
        name: "骷髅射手", type: "普通", category: "monster",
        color: "#c0c0a0", size: 14,
        hp: 180, maxHp: 180,
        def: 9, speed: 0.5,
        attackRange: 350, attackCooldown: 1500,
        attackType: "骨箭射击", knockback: 0,
        level: 5, rank: "normal",
        str: 20, dex: 38, con: 18, int: 15, wis: 10, luck: 6,
        atk: 22
        ,piercing: false
    },
    skeletonDog: {
        name: "骷髅犬", type: "普通", category: "monster",
        color: "#c0c0c0", size: 18,
        hp: 220, maxHp: 220,
        def: 16, speed: 1.2,
        attackRange: 88, attackCooldown: 312,
        attackType: "撕咬", knockback: 19,
        level: 6, rank: "normal",
        str: 30, dex: 48, con: 26, int: 5, wis: 5, luck: 6,
        atk: 19
    },
    necromancer: {
        name: "亡灵法师", type: "精英", category: "monster",
        color: "#3a2a5a", size: 22,
        hp: 350, maxHp: 350,
        def: 23, speed: 0.2,
        attackRange: 95, attackCooldown: 1000,
        attackType: "黑暗魔法", knockback: 26,
        level: 8, rank: "elite",
        str: 45, dex: 50, con: 45, int: 5, wis: 8, luck: 4,
        atk: 21
    },
    deathKnight: {
        name: "亡灵骑士", type: "首领", category: "monster",
        color: "#4a4a4a", size: 40,
        hp: 800, maxHp: 800,
        def: 39, speed: 0.6,
        attackRange: 100, attackCooldown: 1200,
        attackType: "死亡斩击", knockback: 37,
        level: 12, rank: "boss",
        str: 75, dex: 75, con: 75, int: 8, wis: 12, luck: 8,
        atk: 30
    },
};

export { ENEMY_DATA };