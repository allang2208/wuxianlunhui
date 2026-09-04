import { GoldManager } from '../systems/gold-manager.js';
import { SoundManager } from '../ui/sound-manager.js';
import { RARITY_LABELS, RARITY_ORDER } from '../config/rarity.js';
import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from './ui-state.js';
import { EventBus } from '../core/event-bus.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EquipDataManager, completeWeaponFields } from './equip-data-manager.js';
import { EquipManager } from './equip-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { SystemUI } from './system-ui.js';
import { ItemDatabase } from '../items/item-database.js';
import { TopNotificationQueue } from './top-notification-queue.js';

// 稀有度标准价（common/uncommon/rare/epic/mythic/legendary = 100/200/400/800/1600/3200）。
// 注：代码里没有现成的稀有度定价函数（历史价格逐件手写），此表与 SKILL.md
// 「全祭品按稀有度统一定价」约定同源；黑铁商店等数据目录商品缺 price 时用它兜底。
const RARITY_STANDARD_PRICE = {
    common: 100,
    uncommon: 200,
    rare: 400,
    epic: 800,
    mythic: 1600,
    legendary: 3200,
};

// 商店展示分组：先按玩家可识别的武器品种，再放防具、饰品、消耗品与钥匙。
// weaponType 是运行时动作/枪械实现键，同一种“自动步枪”会有多个不同值，因此展示分组读取 type。
const SHOP_WEAPON_TYPE_ORDER = [
    '单手剑', '法杖', '弓', '手枪', '手炮', '自动步枪', '机枪', '散弹枪', '盾',
];
const SHOP_NON_WEAPON_CATEGORY_ORDER = ['armor', 'accessory', 'consumable', 'tribute'];

const ShopSystem = {
    _isOpen: false,
    _currentNPC: null,
    _selectedSellItems: [],

    // 商店商品目录：shopId → 商品数组。不同商店配不同 shopId 即卖不同商品；
    // 缺省/未配置回退 'main'（全量目录 = 现状所有商品）。
    // 新增商店 = 在此加一个键（如 'armory'）+ 对应 NPC 配置里设 shopId。
    SHOP_CATALOGS: {
        main: [
        { id: 'rusty_sword', ...EquipDataManager.TEST_EQUIPMENTS.weapon, price: 100 },
        { id: 'knights_sword', ...EquipDataManager.KINGHTS_SWORD_ITEM, price: 100 },
        { id: 'rune_sword', ...EquipDataManager.RUNE_SWORD_ITEM, price: 100 },
        { id: 'night_flame_sword', ...EquipDataManager.NIGHT_FLAME_SWORD_ITEM, price: 100 },
        { id: 'small_shield', ...EquipDataManager.SMALL_SHIELD_ITEM, price: 80 },
        { id: 'forged_duelist_buckler', ...EquipDataManager.FORGED_DUELIST_BUCKLER_ITEM, price: 200 },
        { id: 'oak_garrison_shield', ...EquipDataManager.OAK_GARRISON_SHIELD_ITEM, price: 200 },
        { id: 'moonsilver_deflection_shield', ...EquipDataManager.MOONSILVER_DEFLECTION_SHIELD_ITEM, price: 400 },
        { id: 'blackiron_citadel_shield', ...EquipDataManager.BLACKIRON_CITADEL_SHIELD_ITEM, price: 400 },
        { id: 'thorn_oath_reprisal_shield', ...EquipDataManager.THORN_OATH_REPRISAL_SHIELD_ITEM, price: 800 },
        { id: 'star_eater_arcane_mirror_shield', ...EquipDataManager.STAR_EATER_ARCANE_MIRROR_SHIELD_ITEM, price: 800 },
        { id: 'heaven_pillar_returning_bulwark', ...EquipDataManager.HEAVEN_PILLAR_RETURNING_BULWARK_ITEM, price: 1600 },
        { id: 'abyss_return_star_devouring_mirror', ...EquipDataManager.ABYSS_RETURN_STAR_DEVOURING_MIRROR_ITEM, price: 1600 },
        { id: 'reverse_fate_doomwheel_shield', ...EquipDataManager.REVERSE_FATE_DOOMWHEEL_SHIELD_ITEM, price: 3200 },
        { id: 'last_oath_sanctum_gate_shield', ...EquipDataManager.LAST_OATH_SANCTUM_GATE_SHIELD_ITEM, price: 3200 },
        { id: 'g18', ...EquipDataManager.G18_PISTOL_ITEM, price: 400 },
        { id: 'p4040', ...EquipDataManager.P4040_ITEM, price: 600 },
        { id: 'beretta93r', ...EquipDataManager.BERETTA93R_ITEM, price: 300 },
        { id: 'm1911a1', ...EquipDataManager.M1911A1_ITEM, price: 100 },
        { id: 'usp45', ...EquipDataManager.USP45_ITEM, price: 200 },
        { id: 'five_seven', ...EquipDataManager.FIVE_SEVEN_ITEM, price: 400 },
        { id: 'eternal_edict', ...EquipDataManager.ETERNAL_EDICT_ITEM, price: 1600 },
        { id: 'falcon_edict', ...EquipDataManager.FALCON_EDICT_ITEM, price: 1600 },
        { id: 'crimson_crown_settlement', ...EquipDataManager.CRIMSON_CROWN_SETTLEMENT_ITEM, price: 3200 },
        { id: 'myriad_corridor', ...EquipDataManager.MYRIAD_CORRIDOR_ITEM, price: 3200 },
        { id: 'pkm', ...EquipDataManager.PKM_ITEM, price: 500 },
        { id: 'rpd', ...EquipDataManager.RPD_ITEM, price: 100 },
        { id: 'm249', ...EquipDataManager.M249_ITEM, price: 200 },
        { id: 'ultimax100', ...EquipDataManager.ULTIMAX100_ITEM, price: 200 },
        { id: 'mg42', ...EquipDataManager.MG42_ITEM, price: 100 },
        { id: 'fusion_core_lmg', ...EquipDataManager.FUSION_CORE_LMG_ITEM, price: 800 },
        { id: 'singularity_loom_lmg', ...EquipDataManager.SINGULARITY_LOOM_LMG_ITEM, price: 1600 },
        { id: 'celestial_cartographer_lmg', ...EquipDataManager.CELESTIAL_CARTOGRAPHER_LMG_ITEM, price: 3200 },
        { id: 'grave_covenant_cantor_lmg', ...EquipDataManager.GRAVE_COVENANT_CANTOR_LMG_ITEM, price: 3200 },
        { id: 'akm', ...EquipDataManager.AKM_ITEM, price: 600 },
        { id: 'm416', ...EquipDataManager.M416_ITEM, price: 450 },
        { id: 'stg44', ...EquipDataManager.STG44_ITEM, price: 100 },
        { id: 'qbz95', ...EquipDataManager.QBZ95_ITEM, price: 200 },
        { id: 'frontier_rifle', ...EquipDataManager.FRONTIER_RIFLE_ITEM, price: 800 },
        { id: 'vengeance_rifle', ...EquipDataManager.VENGEANCE_RIFLE_ITEM, price: 800 },
        { id: 'astral_tide_rifle', ...EquipDataManager.ASTRAL_TIDE_RIFLE_ITEM, price: 1600 },
        { id: 'zero_point_rifle', ...EquipDataManager.ZERO_POINT_RIFLE_ITEM, price: 1600 },
        { id: 'corona_cadence_rifle', ...EquipDataManager.CORONA_CADENCE_RIFLE_ITEM, price: 3200 },
        { id: 'terminal_echo_rifle', ...EquipDataManager.TERMINAL_ECHO_RIFLE_ITEM, price: 3200 },
        { id: 'qbz191', ...EquipDataManager.QBZ191_ITEM, price: 700 },
        { id: 'desert_eagle', ...EquipDataManager.DESERT_EAGLE_ITEM, price: 800 },
        { id: 'revolver357', ...EquipDataManager.REVOLVER357_ITEM, price: 800 },
        { id: 'qjb201', ...EquipDataManager.QJB201_ITEM, price: 900 },
        { id: 'super90', ...EquipDataManager.SUPER90_ITEM },
        { id: 'saiga12k', ...EquipDataManager.SAIGA12K_ITEM },
        { id: 's686', ...EquipDataManager.S686_ITEM, price: 100 },
        { id: 'm870_breacher', ...EquipDataManager.M870_BREACHER_ITEM, price: 100 },
        { id: 'ksg12', ...EquipDataManager.KSG12_ITEM, price: 200 },
        { id: 'spas12', ...EquipDataManager.SPAS12_ITEM, price: 200 },
        { id: 'aa12', ...EquipDataManager.AA12_ITEM, price: 400 },
        { id: 'winchester1887', ...EquipDataManager.WINCHESTER1887_ITEM, price: 400 },
        { id: 'terminus_pendulum', ...EquipDataManager.TERMINUS_PENDULUM_ITEM, price: 1600 },
        { id: 'void_funeral_tide', ...EquipDataManager.VOID_FUNERAL_TIDE_ITEM, price: 1600 },
        { id: 'black_sun_verdict', ...EquipDataManager.BLACK_SUN_VERDICT_ITEM, price: 3200 },
        { id: 'royal_hunt_finale', ...EquipDataManager.ROYAL_HUNT_FINALE_ITEM, price: 3200 },
        { id: 'energy_lmg', ...EquipDataManager.ENERGY_LMG_ITEM, price: 2000 },
        { id: 'hp_potion', name: '治疗药水', icon: '🧪', iconImage: 'assets/items/health_potion.png', category: 'consumable', rarity: 'common', type: '消耗品', price: 100, stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜。饮用后可恢复30点生命值。', stack: 1, maxStack: 99 },
        { id: 'mp_potion', name: '魔力药水', icon: '💧', iconImage: 'assets/items/mana_potion.png', category: 'consumable', rarity: 'common', type: '消耗品', price: 100, stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气。饮用后可恢复25点魔法值。', stack: 1, maxStack: 99 },
        // 时空锚点钥匙（商店专供，shopPrice=稀有度标准价×2；保留 tribute 类别兼容既有代币合成链）
        { id: 'anchorTokenF', name: 'F 级时空锚点代币', icon: '🌀', iconImage: 'assets/ui/icons/dungeon-key-token.png', category: 'tribute', rarity: 'common', type: '地牢钥匙', price: 100, shopPrice: 200, shopOnly: true, stats: [{ name: '用途', value: 'F 级地牢钥匙' }], desc: 'F 级地牢钥匙。出征时自动从背包或仓库消耗 1 枚，不能献祭。', stack: 1, maxStack: 999 },
        { id: 'anchorTokenE', name: 'E 级时空锚点代币', icon: '🌀', iconImage: 'assets/ui/icons/dungeon-key-token.png', category: 'tribute', rarity: 'uncommon', type: '地牢钥匙', price: 200, shopPrice: 400, shopOnly: true, stats: [{ name: '用途', value: 'E 级地牢钥匙' }], desc: 'E 级地牢钥匙。出征时自动从背包或仓库消耗 1 枚，不能献祭。', stack: 1, maxStack: 999 },
        { id: 'anchorTokenD', name: 'D 级时空锚点代币', icon: '🌀', iconImage: 'assets/ui/icons/dungeon-key-token.png', category: 'tribute', rarity: 'rare', type: '地牢钥匙', price: 400, shopPrice: 800, shopOnly: true, stats: [{ name: '用途', value: 'D 级地牢钥匙' }], desc: 'D 级地牢钥匙。出征时自动从背包或仓库消耗 1 枚，不能献祭。', stack: 1, maxStack: 999 },
        { id: 'anchorTokenC', name: 'C 级时空锚点代币', icon: '🌀', iconImage: 'assets/ui/icons/dungeon-key-token.png', category: 'tribute', rarity: 'epic', type: '地牢钥匙', price: 800, shopPrice: 1600, shopOnly: true, stats: [{ name: '用途', value: 'C 级地牢钥匙' }], desc: 'C 级地牢钥匙。出征时自动从背包或仓库消耗 1 枚，不能献祭。', stack: 1, maxStack: 999 },
        { id: 'anchorTokenB', name: 'B 级时空锚点代币', icon: '🌀', iconImage: 'assets/ui/icons/dungeon-key-token.png', category: 'tribute', rarity: 'mythic', type: '地牢钥匙', price: 1600, shopPrice: 3200, shopOnly: true, stats: [{ name: '用途', value: 'B 级地牢钥匙' }], desc: 'B 级地牢钥匙。出征时自动从背包或仓库消耗 1 枚，不能献祭。', stack: 1, maxStack: 999 },
        { id: 'anchorTokenA', name: 'A 级时空锚点代币', icon: '🌀', iconImage: 'assets/ui/icons/dungeon-key-token.png', category: 'tribute', rarity: 'legendary', type: '地牢钥匙', price: 3200, shopPrice: 6400, shopOnly: true, stats: [{ name: '用途', value: 'A 级地牢钥匙' }], desc: 'A 级地牢钥匙。出征时自动从背包或仓库消耗 1 枚，不能献祭。', stack: 1, maxStack: 999 }
        ],
        // 小鼠铁匠商店：保留现有防具/饰品目录；全部主手武器（含法杖）由
        // _itemsFor() 从 ItemDatabase 动态追加，新增武器无需再维护第二份商店名单。
        blacksmith: [
            'light_helmet', 'light_armor', 'light_boots',
            'robe_helmet', 'robe_armor', 'robe_boots',
            'heavy_helmet', 'heavy_armor', 'heavy_boots',
            'necklace_strcon', 'necklace_intwis', 'necklace_dexluck',
            'ring_atk', 'ring_crit', 'ring_matk',
            'belt_hp', 'belt_mp', 'belt_stamina',
            // 稀有套装（流云/蚀月/镇岳）+ 稀有首饰（2026-08-03 新增）
            'flowing_helmet', 'flowing_armor', 'flowing_boots',
            'eclipse_helmet', 'eclipse_armor', 'eclipse_boots',
            'zhenyue_helmet', 'zhenyue_armor', 'zhenyue_boots',
            'ring_starfall', 'belt_endless', 'necklace_boulder',
            // 史诗套装（星穹，2026-08-06 新增）
            'stellar_helmet', 'stellar_armor', 'stellar_boots',
            'necklace_stellar', 'ring_stellar', 'belt_stellar',
            // 史诗法袍（苍月）+ 史诗重甲（天罡）
            'lunar_helmet', 'lunar_armor', 'lunar_boots',
            'tiangang_helmet', 'tiangang_armor', 'tiangang_boots',
            // 神话套装（神谕，2026-08-07 新增）
            'oracle_helmet', 'oracle_armor', 'oracle_boots',
            'necklace_oracle', 'ring_oracle', 'belt_oracle',
            // 神话法袍（神谕）+ 神话轻甲（圣辉）
            'oracle_robe_helmet', 'oracle_robe_armor', 'oracle_robe_boots',
            'holy_helmet', 'holy_armor', 'holy_boots'
        ]
    },

    /** 商店标识：NPC 配置 shopId（npc.shopId 或 npc.config.shopId），缺省 'main' */
    _shopIdFor(npc) {
        return (npc && (npc.shopId || (npc.config && npc.config.shopId))) || 'main';
    },

    /** 当前商店商品目录；小鼠铁匠合并承接旧 main 全量商品与铁匠装备目录。 */
    _itemsFor(npc = this._currentNPC) {
        const shopId = this._shopIdFor(npc);
        const cat = this.SHOP_CATALOGS[shopId];
        const baseList = shopId === 'blacksmith'
            ? [...(this.SHOP_CATALOGS.main || []), ...(cat || [])]
            : (cat || this.SHOP_CATALOGS.main || []);
        const mainhandWeaponIds = shopId === 'blacksmith'
            ? Object.entries(ItemDatabase.items || {})
                .filter(([, item]) => item?.weaponId && item.weaponCategory === 'mainhand')
                .map(([id]) => id)
            : [];
        const list = [...baseList, ...mainhandWeaponIds];
        const seenIds = new Set();
        // 目录条目支持两种形态：完整商品对象（main 现状）或 ItemDatabase 装备 id 字符串
        // （数据目录，如 blacksmith——懒解析，缺 price 按稀有度标准价兜底）。
        const items = list
            .map(it => (typeof it === 'string' ? this._equipFromDatabase(it) : it))
            .filter(item => {
                if (!item || seenIds.has(item.id)) return false;
                seenIds.add(item.id);
                return true;
            });
        return this._sortItems(items);
    },

    /** 武器按品种分组，每组内按普通→优质→稀有→史诗→神话→传说稳定排列。 */
    _sortItems(items) {
        const weaponTypeCount = SHOP_WEAPON_TYPE_ORDER.length;
        const rarityRank = (item) => {
            const rank = RARITY_ORDER.indexOf(item?.rarity || 'common');
            return rank >= 0 ? rank : RARITY_ORDER.length;
        };
        const groupOf = (item) => {
            const type = item?.type || '';
            const knownWeaponRank = SHOP_WEAPON_TYPE_ORDER.indexOf(type);
            if (knownWeaponRank >= 0) return { rank: knownWeaponRank, label: type };

            const category = item?.category || '';
            const isWeapon = !!item?.weaponId || category.startsWith('weapon_');
            if (isWeapon) return { rank: weaponTypeCount, label: type };

            const categoryRank = SHOP_NON_WEAPON_CATEGORY_ORDER.indexOf(category);
            return {
                rank: weaponTypeCount + 1 + (categoryRank >= 0 ? categoryRank : SHOP_NON_WEAPON_CATEGORY_ORDER.length),
                label: category,
            };
        };

        return items
            .map((item, sourceIndex) => ({ item, sourceIndex, group: groupOf(item) }))
            .sort((a, b) => {
                if (a.group.rank !== b.group.rank) return a.group.rank - b.group.rank;
                if (a.group.label !== b.group.label) return a.group.label.localeCompare(b.group.label, 'zh-CN');
                const rarityDiff = rarityRank(a.item) - rarityRank(b.item);
                return rarityDiff || (a.sourceIndex - b.sourceIndex);
            })
            .map(entry => entry.item);
    },

    /** ItemDatabase 装备 id → 商店商品对象（找不到返回 null，调用方过滤） */
    _equipFromDatabase(id) {
        const items = (ItemDatabase && ItemDatabase.items) || {};
        const base = items[id];
        if (!base) return null;
        return {
            ...base,
            id, // 购买查找用唯一 id（equipment.json 条目本身无 id 字段）
            price: base.price ?? RARITY_STANDARD_PRICE[base.rarity || 'common'] ?? 0,
        };
    },

    /** 商店出售价（购买价）：shopPrice（商店专供翻倍价）优先，缺省 price——与 buy() 同口径 */
    _priceOf(item) {
        return item ? (item.shopPrice ?? item.price ?? 0) : 0;
    },

    _sellQuantity(item) {
        return Math.max(1, Math.floor(Number(item?.stack) || 1));
    },

    _sellPriceOf(item) {
        return Math.max(1, Math.floor((Number(item?.price) || 50) * 0.5)) * this._sellQuantity(item);
    },

    open(npc) {
        UIState.open('shop');
        this._isOpen = true;
        this._currentNPC = npc;
        SystemUI.open('equip');
        const panel = getElement('shopPanel');
        if (panel) panel.classList.add('active');
        this._setupSellGridDrop();
        this._updateUI();
    },

    close() {
        UIState.close('shop');
        this._isOpen = false;
        this._currentNPC = null;
        this._returnAllSellItems();
        const panel = getElement('shopPanel');
        if (panel) panel.classList.remove('active');
        TimerManager.setTimeout(() => {
            if (!UIState.isOpen('shop') && !UIState.isOpen('enhance') && !UIState.isOpen('craft') && !UIState.isOpen('enchant') && !UIState.isOpen('warehouse') && !UIState.isOpen('fusion')) {
                SystemUI.close();
            }
        }, 300);
    },

    toggle() {
        if (UIState.isOpen('shop')) this.close();
        else this.open();
    },

    // 金币操作方法（使用 GoldManager 集中管理）
    _getBackpackGold() {
        return (GoldManager) ? GoldManager.getGold() : 0;
    },

    _deductGold(amount) {
        return (GoldManager) ? GoldManager.deductGold(amount) : false;
    },

    _addGold(amount) {
        return (GoldManager) ? GoldManager.addGold(amount) : false;
    },

    buy(itemId) {
        const player = Game.player;
        if (!player) return;
        const item = this._itemsFor().find(i => i.id === itemId);
        if (!item) return;
        // 检查背包是否已满
        if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
            EquipManager._showBackpackFullNotice();
            return;
        }
        // 购买价：shopPrice（商店专供翻倍价）优先，缺省 price
        const cost = item.shopPrice ?? item.price;
        if (this._getBackpackGold() < cost) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '金币不足！', '#ff4444'));
            return;
        }
        if (!this._deductGold(cost)) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '金币不足！', '#ff4444'));
            return;
        }
        const itemClone = completeWeaponFields(JSON.parse(JSON.stringify(item)));
        delete itemClone.id;
        if (item.shopPrice !== undefined) {
            // 商店专供品（时空锚点代币）：保留物品自身 price（出售基准价），仅去除购买价字段
            delete itemClone.shopPrice;
        } else {
            delete itemClone.price;
        }
        EquipManager.addToInventory(itemClone);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `购买成功：${item.name}`, '#ffd700'));
        this._updateUI();
    },

    // 从背包移动物品到出售栏
    addToSellGrid(bpIndex) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.findIndex(i => i.slot === bpIndex);
        if (idx < 0) return;
        const item = bp[idx];
        if (item.category === 'gold' || item.name === '金币') {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, '金币不可卖出！', '#ff4444'));
            return;
        }
        // 从背包移除
        bp.splice(idx, 1);
        this._selectedSellItems.push({ item: JSON.parse(JSON.stringify(item)), source: 'backpack', bpIndex });
        EquipManager.updateInventorySlots();
        this._updateUI();
    },

    // 从装备栏移动物品到出售栏
    addEquipToSellGrid(slotKey) {
        const item = Game.player.equipments[slotKey];
        if (!item) return;
        // 从装备栏移除
        Game.player.equipments[slotKey] = null;
        EquipManager._clearWeaponState(slotKey);
        this._selectedSellItems.push({ item: JSON.parse(JSON.stringify(item)), source: 'equip', slotKey });
        EquipManager.updateEquipSlots();
        this._updateUI();
    },

    // 从出售栏移除并还原到背包
    removeFromSellGrid(index) {
        const sel = this._selectedSellItems[index];
        if (!sel) return;
        const usedSlots = new Set((EquipManager.backpackItems || []).map(i => i.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < EquipManager.maxBackpackSlots) slot++;
        if (slot >= EquipManager.maxBackpackSlots) {
            EquipManager._showBackpackFullNotice();
            return;
        }
        const clone = JSON.parse(JSON.stringify(sel.item));
        clone.slot = slot;
        if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
        EquipManager.backpackItems.push(clone);
        this._selectedSellItems.splice(index, 1);
        EquipManager.updateInventorySlots();
        this._updateUI();
    },

    // 关闭时归还所有出售栏物品
    _returnAllSellItems() {
        if (!this._selectedSellItems.length) return;
        const backpack = EquipManager.backpackItems ||= [];
        const usedSlots = new Set(backpack.map(item => item.slot));
        const remaining = [];
        // 每件完整转移后才移出售栏；满包时保留原物，不进入副本战利品结算。
        for (const selected of this._selectedSellItems) {
            let slot = 0;
            while (usedSlots.has(slot) && slot < EquipManager.maxBackpackSlots) slot++;
            if (slot >= EquipManager.maxBackpackSlots) {
                remaining.push(selected);
                continue;
            }
            selected.item.slot = slot;
            backpack.push(selected.item);
            usedSlots.add(slot);
        }
        this._selectedSellItems = remaining;
        EquipManager.updateInventorySlots();
        if (remaining.length) {
            TopNotificationQueue.show(`背包已满，${remaining.length} 格物品仍保留在商店出售栏，腾出空间后可重新打开取回`, { tone: 'warning' });
        }
    },

    confirmSell() {
        const player = Game.player;
        if (!player) return;
        if (this._selectedSellItems.length === 0) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '出售栏为空！', '#ff4444'));
            return;
        }
        const totalGold = this._selectedSellItems.reduce((sum, sel) => sum + this._sellPriceOf(sel.item), 0);
        const quantity = this._selectedSellItems.reduce((sum, sel) => sum + this._sellQuantity(sel.item), 0);
        // addGold 允许部分入包；必须先确认能完整收款，避免失败后丢物或重复收款。
        if (!Number.isSafeInteger(totalGold) || totalGold <= 0
                || GoldManager.getRemainingCapacity() < totalGold) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '金币无法全部放入背包，请先腾出空间；待售物品已保留', '#ff4444'));
            return;
        }
        if (!this._addGold(totalGold)) return;
        this._selectedSellItems = [];
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `卖出 ${quantity} 件物品，获得 ${totalGold} 金币`, '#ffd700'));
        if (SoundManager) {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        this._updateUI();
    },

    // 设置出售栏为拖放目标
    _setupSellGridDrop() {
        const sellGrid = getElement('shopSellGrid');
        if (!sellGrid) return;
        sellGrid.ondragover = (e) => {
            if (!EquipManager._dragDropManager._dragSrc) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            sellGrid.classList.add('drag-over');
        };
        sellGrid.ondragleave = (_e) => {
            sellGrid.classList.remove('drag-over');
        };
        sellGrid.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            sellGrid.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;
            if (src.type === 'inventory') {
                const idx = parseInt(src.slot);
                const item = EquipManager.backpackItems.find(i => i.slot === idx);
                if (item && item.category !== 'gold') {
                    this.addToSellGrid(idx);
                }
            } else if (src.type === 'equip') {
                const slotKey = src.slot;
                const item = Game.player.equipments[slotKey];
                if (item) {
                    this.addEquipToSellGrid(slotKey);
                }
            }
            EquipManager._dragDropManager._dragSrc = null;
        };
    },

    _updateUI() {
        const player = Game.player;
        const moneyEl = getElement('shopMoney');
        if (moneyEl && player) moneyEl.textContent = `💰 ${this._getBackpackGold()}`;

        const buyGrid = getElement('shopBuyGrid');
        if (buyGrid) {
            buyGrid.innerHTML = '';
            this._itemsFor().forEach(item => {
                const cell = document.createElement('div');
                cell.className = 'shop-buy-cell';
                const rarityKey = item.rarity || 'common';
                const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
                const iconHtml = item.iconImage
                    ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                    : item.icon;
                cell.innerHTML = `
                    <div class="buy-cell-rarity rarity-${rarityKey}">${rarityLabel}</div>
                    <div class="buy-cell-price">💰${this._priceOf(item)}</div>
                    <div class="buy-cell-icon">${iconHtml}</div>
                    <div class="buy-cell-name">${item.name}</div>
                `;
                cell.ondblclick = () => this.buy(item.id);
                cell.oncontextmenu = (e) => { e.preventDefault(); this.buy(item.id); };
                // 浮窗事件绑定
                const tooltip = getElement('equipTooltip');
                cell.onmouseenter = function(e) {
                    if (tooltip._pinned) return;
                    EquipTooltipManager.renderTooltip(item);
                    tooltip.classList.add('visible');
                    EquipTooltipManager._positionTooltip(e);
                    cell._ttMoveHandler = EquipTooltipManager._positionTooltip;
                    document.addEventListener('mousemove', cell._ttMoveHandler);
                };
                cell.onmouseleave = function() {
                    if (tooltip._pinned) return;
                    tooltip.classList.remove('visible');
                    if (cell._ttMoveHandler) {
                        document.removeEventListener('mousemove', cell._ttMoveHandler);
                        cell._ttMoveHandler = null;
                    }
                };
                cell.onmousedown = function(e) {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    if (tooltip._pinned) {
                        tooltip.classList.remove('visible', 'pinned');
                        tooltip._pinned = false;
                    } else {
                        EquipTooltipManager.renderTooltip(item);
                        tooltip.classList.add('visible', 'pinned');
                        tooltip._pinned = true;
                        EquipTooltipManager._positionTooltip(e);
                        if (cell._ttMoveHandler) {
                            document.removeEventListener('mousemove', cell._ttMoveHandler);
                            cell._ttMoveHandler = null;
                        }
                    }
                };
                buyGrid.appendChild(cell);
            });
        }

        const sellGrid = getElement('shopSellGrid');
        if (sellGrid) {
            sellGrid.innerHTML = '';
            if (this._selectedSellItems.length === 0) {
                const emptyHint = document.createElement('div');
                emptyHint.className = 'shop-empty-hint';
                emptyHint.textContent = '双击或右键点击背包/装备栏物品，或拖动至此';
                sellGrid.appendChild(emptyHint);
            } else {
                this._selectedSellItems.forEach((sel, index) => {
                    const item = sel.item;
                    const cell = document.createElement('div');
                    cell.className = 'shop-sell-cell has-item';
                    const rarityKey = item.rarity || 'common';
                    const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
                    const sellPrice = this._sellPriceOf(item);
                    const iconHtml = item.iconImage
                        ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                        : (item.icon || '❓');
                    cell.innerHTML = `
                        <div class="sell-cell-rarity rarity-${rarityKey}">${rarityLabel}</div>
                        <div class="sell-cell-icon">${iconHtml}</div>
                        <div class="sell-cell-name">${item.name}${this._sellQuantity(item) > 1 ? ` ×${this._sellQuantity(item)}` : ''}</div>
                        <div class="sell-cell-price">💰 ${sellPrice}</div>
                    `;
                    cell.ondblclick = () => this.removeFromSellGrid(index);
                    cell.oncontextmenu = (e) => { e.preventDefault(); this.removeFromSellGrid(index); };
                    // 使出售栏格子可拖动
                    cell.draggable = true;
                    cell.ondragstart = (e) => {
                        EquipManager._dragDropManager._dragSrc = { type: 'sell', slot: index };
                        EquipManager._dragDropManager._dropHandled = false;
                        e.dataTransfer.setData('text/plain', String(index));
                        e.dataTransfer.effectAllowed = 'move';
                        cell.classList.add('dragging');
                    };
                    cell.ondragend = (_e) => {
                        cell.classList.remove('dragging');
                        if (!EquipManager._dragDropManager._dropHandled && EquipManager._dragDropManager._dragSrc) {
                            this.removeFromSellGrid(index);
                        }
                        EquipManager._dragDropManager._dropHandled = false;
                        EquipManager._dragDropManager._dragSrc = null;
                    };
                    // 浮窗事件绑定
                    const tooltip = getElement('equipTooltip');
                    cell.onmouseenter = function(e) {
                        if (tooltip._pinned) return;
                        EquipTooltipManager.renderTooltip(item);
                        tooltip.classList.add('visible');
                        EquipTooltipManager._positionTooltip(e);
                        cell._ttMoveHandler = EquipTooltipManager._positionTooltip;
                        document.addEventListener('mousemove', cell._ttMoveHandler);
                    };
                    cell.onmouseleave = function() {
                        if (tooltip._pinned) return;
                        tooltip.classList.remove('visible');
                        if (cell._ttMoveHandler) {
                            document.removeEventListener('mousemove', cell._ttMoveHandler);
                            cell._ttMoveHandler = null;
                        }
                    };
                    cell.onmousedown = function(e) {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        if (tooltip._pinned) {
                            tooltip.classList.remove('visible', 'pinned');
                            tooltip._pinned = false;
                        } else {
                            EquipTooltipManager.renderTooltip(item);
                            tooltip.classList.add('visible', 'pinned');
                            tooltip._pinned = true;
                            EquipTooltipManager._positionTooltip(e);
                            if (cell._ttMoveHandler) {
                                document.removeEventListener('mousemove', cell._ttMoveHandler);
                                cell._ttMoveHandler = null;
                            }
                        }
                    };
                    sellGrid.appendChild(cell);
                });
            }
        }
    }
};

// 商品目录归一：任何目录里只要登记 weaponId/name，全部静态武器定义都回到 EquipDataManager。
// 购买时还会再次归一克隆，避免运行时动态加入目录的武器绕过同一入口。
for (const _catalog of Object.values(ShopSystem.SHOP_CATALOGS)) {
    for (const _shopItem of _catalog) {
        completeWeaponFields(_shopItem);
    }
}

// 模块加载时注册跨 UI 事件监听
EventBus.on('shop:addToSellGrid', (idx) => ShopSystem.addToSellGrid(idx));

// 挂载到全局（控制台调试/外部系统检测用，与 ExpeditionSystem/ChestRoomSystem 同口径）
if (typeof window !== 'undefined' && !window.ShopSystem) {
    window.ShopSystem = ShopSystem;
}

export { ShopSystem };
