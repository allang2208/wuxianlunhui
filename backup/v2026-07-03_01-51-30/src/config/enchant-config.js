// Enchant Config - 附魔系统配置
const EnchantConfig = {
    // 附魔卷轴定义
    scrolls: {
        heavy: {
            id: 'heavy',
            name: '沉重',
            grade: 'F',
            type: 'prefix',
            cost: 100, // 魔法晶尘
            restrictions: {
                weaponTypes: ['sword', 'melee'], // 只能近战武器
            },
            effects: {
                damagePercent: 0.60, // 攻击力+60%
                attackIntervalMul: 1.35, // 攻击间隔×1.35（速度-35%）
            },
            desc: '攻击力增加60%，攻击速度减慢35%',
            icon: '⚓',
            color: '#8a7a6a',
        },
        sharp: {
            id: 'sharp',
            name: '锋利的',
            grade: 'F',
            type: 'prefix',
            cost: 100,
            restrictions: {
                weaponTypes: ['sword'], // 只能剑类
            },
            effects: {
                critRate: 0.50, // 暴击率+50%
            },
            desc: '暴击率增加50%',
            icon: '⚔',
            color: '#c0c0c0',
        },
        tarantula: {
            id: 'tarantula',
            name: '狼蛛',
            grade: 'E',
            type: 'suffix',
            cost: 200,
            restrictions: {},
            effects: {
                poisonOnHit: true, // 攻击叠加中毒
                poisonStacks: 1, // 每次攻击叠加1层
            },
            desc: '每次攻击给敌人叠加一层中毒效果',
            icon: '☠️',
            color: '#7a9a5a',
        },
        skeletonArcher: {
            id: 'skeletonArcher',
            name: '骷髅射手',
            grade: 'D',
            type: 'suffix',
            cost: 400,
            restrictions: {
                weaponTypes: ['pistol', 'pkm', 'akm', 'qbz191', 'qjb201', 'shotgun'], // 枪械类
            },
            effects: {
                piercingBonus: 2, // 穿透目标+2
            },
            desc: '穿透目标+2',
            icon: '💀',
            color: '#9a8a7a',
        },
    },

    // 获取所有卷轴列表
    getAllScrolls() {
        return Object.values(this.scrolls);
    },

    // 获取卷轴配置
    getScroll(id) {
        return this.scrolls[id] || null;
    },

    // 检查武器是否匹配卷轴限制
    canEnchant(item, scrollId) {
        const scroll = this.getScroll(scrollId);
        if (!scroll || !item) return false;

        const restrictions = scroll.restrictions;
        if (!restrictions || Object.keys(restrictions).length === 0) {
            return true; // 无限制
        }

        // 检查武器类型
        if (restrictions.weaponTypes) {
            const itemType = item.weaponType || item.category;
            if (!restrictions.weaponTypes.includes(itemType)) {
                return false;
            }
        }

        return true;
    },

    // 计算附魔消耗
    getCost(scrollId) {
        const scroll = this.getScroll(scrollId);
        return scroll ? scroll.cost : 0;
    },

    // 计算转换晶尘数量
    getConversionReward(scrollId) {
        return Math.floor(this.getCost(scrollId) / 2);
    },

    // 获取等级对应的晶尘消耗
    getGradeCost(grade) {
        const gradeMap = { F: 100, E: 200, D: 400, C: 800, B: 1600, A: 3200, S: 6400 };
        return gradeMap[grade] || 100;
    },
};

// 附魔卷轴物品模板（用于生成）
const EnchantScrollItems = {
    enchant_scroll_heavy: {
        name: '附魔卷轴：沉重',
        type: '附魔卷轴',
        icon: '⚓',
        iconImage: 'assets/items/scroll.png',
        category: 'consumable',
        scrollId: 'heavy',
        grade: 'F',
        desc: '可以给近战武器附魔前缀「沉重」',
        stack: 1,
        price: 500,
    },
    enchant_scroll_sharp: {
        name: '附魔卷轴：锋利的',
        type: '附魔卷轴',
        icon: '⚔',
        iconImage: 'assets/items/scroll.png',
        category: 'consumable',
        scrollId: 'sharp',
        grade: 'F',
        desc: '可以给剑类武器附魔前缀「锋利的」',
        stack: 1,
        price: 500,
    },
    enchant_scroll_tarantula: {
        name: '附魔卷轴：狼蛛',
        type: '附魔卷轴',
        icon: '☠️',
        iconImage: 'assets/items/scroll.png',
        category: 'consumable',
        scrollId: 'tarantula',
        grade: 'E',
        desc: '可以给任何武器附魔后缀「狼蛛」',
        stack: 1,
        price: 1000,
    },
    enchant_scroll_skeleton: {
        name: '附魔卷轴：骷髅射手',
        type: '附魔卷轴',
        icon: '💀',
        iconImage: 'assets/items/scroll.png',
        category: 'consumable',
        scrollId: 'skeletonArcher',
        grade: 'D',
        desc: '可以给枪械类武器附魔后缀「骷髅射手」',
        stack: 1,
        price: 2000,
    },
};

// 魔法晶尘物品
const MagicDustItem = {
    name: '魔法晶尘',
    type: '材料',
    icon: '✨',
    iconImage: 'assets/items/magic_dust.png',
    category: 'material',
    desc: '用于附魔的魔法晶尘',
    stack: 999,
    price: 10,
};

export { EnchantConfig, EnchantScrollItems, MagicDustItem };
