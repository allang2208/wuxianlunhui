export class ItemFactory {
    static create(itemTemplate) {
        return ItemFactory.createItem(itemTemplate.category || 'base', itemTemplate);
    }
    static createItem(type, config) {
        switch (type) {
            case 'weapon': return ItemFactory._createWeapon(config);
            case 'armor': return ItemFactory._createArmor(config);
            case 'accessory': return ItemFactory._createAccessory(config);
            case 'consumable': return ItemFactory._createConsumable(config);
            default: return ItemFactory._createBaseItem(config);
        }
    }

    static _createBaseItem(config) {
        const result = {
            name: config.name || '未知物品',
            type: config.type || '物品',
            icon: config.icon || '❓',
            iconImage: config.iconImage || '',
            desc: config.desc || '',
            level: config.level || 1,
            rarity: config.rarity || 'common',
            stack: config.stack || 1,
            maxStack: config.maxStack || 1,
            category: config.category || 'misc',
            ...config
        };
        // 强制深拷贝 stats，防止多个物品实例共享同一个 stats 数组引用
        if (config.stats) {
            result.stats = JSON.parse(JSON.stringify(config.stats));
        } else if (!result.stats) {
            result.stats = [];
        }
        return result;
    }

    static _createWeapon(config) {
        const base = ItemFactory._createBaseItem(config);
        return {
            ...base,
            category: 'weapon_melee',
            weaponType: config.weaponType || 'sword',
            weaponCategory: config.weaponCategory || 'mainhand',
            weaponTypeTag: config.weaponTypeTag || '近战武器',
            equipImage: config.equipImage || '',
            weaponAsset: config.weaponAsset || null,
            specialAttack: config.specialAttack || null,
            attackParams: config.attackParams || null,
            skillOverrides: config.skillOverrides || null,
            animation: config.animation || null,
            ...config,
            // 强制保留 base 中已深拷贝的 stats，防止 config.stats 覆盖回共享引用
            stats: base.stats
        };
    }

    static _createArmor(config) {
        const base = ItemFactory._createBaseItem(config);
        return {
            ...base,
            category: 'armor',
            equipSlot: config.equipSlot || 'armor',
            ...config,
            stats: base.stats
        };
    }

    static _createAccessory(config) {
        const base = ItemFactory._createBaseItem(config);
        return {
            ...base,
            category: 'accessory',
            equipSlot: config.equipSlot || 'ring1',
            ...config,
            stats: base.stats
        };
    }

    static _createConsumable(config) {
        const base = ItemFactory._createBaseItem(config);
        return {
            ...base,
            category: 'consumable',
            stack: config.stack || 1,
            maxStack: config.maxStack || 99,
            useEffect: config.useEffect || null,
            ...config,
            stats: base.stats
        };
    }
}
