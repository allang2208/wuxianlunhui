import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeJson(rel, value, indent = 4) {
    const file = path.join(ROOT, rel);
    const current = fs.readFileSync(file, 'utf8');
    const newline = current.includes('\r\n') ? '\r\n' : '\n';
    const text = `${JSON.stringify(value, null, indent)}\n`.replace(/\n/g, newline);
    fs.writeFileSync(file, text, 'utf8');
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

const UNIVERSAL_RIFLE_SIGHTS = [
    {
        id: 'red_dot',
        name: '全景红点瞄具',
        icon: 'assets/icons/craft-cold-steel/red_dot.png',
        desc: '散布开始+1秒，单倍瞄准模式',
        effects: { spreadStartDelta: 1000, redDotScope: true },
    },
    {
        id: 'qbz_scope',
        name: '一倍棱镜瞄具',
        icon: 'assets/icons/craft-cold-steel/qbz_scope.png',
        desc: '散布开始+0.75秒，射程+50px，单倍瞄准模式',
        effects: { spreadStartDelta: 750, rangeDelta: 50, redDotScope: true },
    },
    {
        id: 'russian_3x_scope',
        name: '三倍战术瞄具',
        icon: 'assets/icons/craft-cold-steel/russian_3x_scope.png',
        desc: '散布开始+1秒，高倍镜瞄准模式',
        effects: { spreadStartDelta: 1000, highPowerScope: true },
    },
    {
        id: 'zf4_scope',
        name: '四倍光学瞄具',
        icon: 'assets/icons/craft-cold-steel/russian_3x_scope.png',
        desc: '散布开始+1.2秒，最大散布角度-4°，移动速度-3%，高倍镜瞄准模式',
        effects: { spreadStartDelta: 1200, maxSpreadAngleDelta: -4, moveSpeedPercent: -0.03, highPowerScope: true },
    },
];

function setUniversalRifleSights(cfg) {
    cfg.options.sight = deepClone(UNIVERSAL_RIFLE_SIGHTS);
    const sightSlot = cfg.slots.find((slot) => slot.id === 'sight');
    if (sightSlot) sightSlot.name = '瞄具';
}

function upsertOption(cfg, slot, option) {
    cfg.options[slot] = (cfg.options[slot] || []).filter((entry) => entry.id !== option.id);
    cfg.options[slot].push(option);
}

function removeOptions(cfg, slot, ids) {
    const blocked = new Set(ids);
    cfg.options[slot] = (cfg.options[slot] || []).filter((entry) => !blocked.has(entry.id));
}

function equipmentEntry(spec) {
    return {
        weaponId: spec.weaponId,
        name: spec.name,
        type: spec.type,
        icon: spec.icon,
        iconImage: spec.assets.iconImage,
        slotImage: spec.assets.slotImage,
        dropImage: spec.assets.dropImage,
        equipImage: spec.assets.equipImage,
        category: spec.category,
        rarity: spec.rarity,
        level: spec.level,
        price: spec.price,
        weaponCategory: spec.weaponCategory,
        weaponType: spec.weaponType,
        weaponTypeTag: spec.weaponTypeTag,
        isTwoHanded: spec.isTwoHanded,
        weaponAsset: {
            image: spec.assets.weaponAssetImage,
            muzzleImage: 'assets/effects/muzzle_flash_01.png',
        },
        stats: spec.statsJson,
        desc: spec.desc,
        equipSlot: spec.equipSlot,
        attack: spec.attack,
        animation: spec.animation,
        attackKey: spec.attackKey,
        animConfigKey: spec.animConfigKey,
        fireSound: spec.fireSound,
        equipSound: spec.equipSound,
        canvasImageProp: spec.canvasImageProp,
        ammoConfig: spec.ammoConfig,
        fireMode: spec.fireMode,
        attackFormula: spec.attackFormula,
        spreadParams: spec.spreadParams,
    };
}

function buildAkmCraft(base) {
    const cfg = deepClone(base);
    setUniversalRifleSights(cfg);
    removeOptions(cfg, 'barrel', ['stamped_receiver_tuning']);
    removeOptions(cfg, 'stock', ['walnut_fixed_stock']);
    removeOptions(cfg, 'bullet', ['kurz_792_heavy']);
    return cfg;
}

function buildStg44Craft(base) {
    const cfg = deepClone(base);
    setUniversalRifleSights(cfg);
    // AK 系共享基础池；AKM 自身的三项结构件不跨给 STG-44。
    removeOptions(cfg, 'stock', ['wood_furniture', 'side_folding_stock']);
    removeOptions(cfg, 'bullet', ['heavy_762']);
    upsertOption(cfg, 'barrel', {
        id: 'stamped_receiver_tuning',
        name: '冲压机匣校正',
        icon: 'assets/icons/craft-cold-steel/stamped_receiver_tuning.png',
        desc: '散布开始延后约2发，后坐恢复时间-80ms',
        ticketCost: 2,
        effects: { spreadStartDelta: 240, recoilRecoveryDelta: -80 },
    });
    upsertOption(cfg, 'stock', {
        id: 'walnut_fixed_stock',
        name: '胡桃木固定枪托',
        icon: 'assets/icons/craft-cold-steel/walnut_fixed_stock.png',
        desc: '后坐恢复时间-180ms，移动速度-3%',
        ticketCost: 2,
        effects: { recoilRecoveryDelta: -180, moveSpeedPercent: -0.03 },
    });
    upsertOption(cfg, 'bullet', {
        id: 'kurz_792_heavy',
        name: '7.92 Kurz重弹',
        icon: 'assets/icons/craft-cold-steel/kurz_792_heavy.png',
        desc: '伤害+10%，攻击间隔+15ms，击退+3px',
        specialModification: true,
        ticketCost: 4,
        effects: { damagePercent: 0.10, attackIntervalDelta: 15, knockbackDelta: 3 },
    });
    return cfg;
}

function buildQbz191Craft(base) {
    const cfg = deepClone(base);
    setUniversalRifleSights(cfg);
    for (const option of cfg.options?.bullet || []) {
        if (option.id === 'sniper_ammo') option.name = '高精度狙击弹';
    }
    removeOptions(cfg, 'barrel', ['qbz95_gas_tuning']);
    removeOptions(cfg, 'grip', ['qbz95_grip_insert']);
    removeOptions(cfg, 'stock', ['qbz95_rubber_buttpad']);
    removeOptions(cfg, 'bullet', ['dbp87_balanced_round']);
    upsertOption(cfg, 'barrel', {
        id: 'qbz191_freefloat_handguard',
        name: '自由浮置护木',
        icon: 'assets/icons/craft-cold-steel/qbz191_freefloat_handguard.png',
        desc: '后坐恢复时间-100ms，最大散布角度-3°',
        ticketCost: 2,
        effects: { recoilRecoveryDelta: -100, maxSpreadAngleDelta: -3 },
    });
    upsertOption(cfg, 'grip', {
        id: 'qbz191_high_speed_trigger',
        name: '双面快控组件',
        icon: 'assets/icons/craft-cold-steel/qbz191_high_speed_trigger.png',
        desc: '攻击间隔-8ms，最大散布角度+2°',
        specialModification: true,
        ticketCost: 4,
        effects: { attackIntervalDelta: -8, maxSpreadAngleDelta: 2 },
    });
    upsertOption(cfg, 'bullet', {
        id: 'dbp191_high_velocity',
        name: 'DBP191高速弹',
        icon: 'assets/icons/craft-cold-steel/dbp191_high_velocity.png',
        desc: '弹速+12%，无视目标12%防御力，伤害-3%',
        ticketCost: 2,
        effects: { projectileSpeedPercent: 0.12, armorPenetrationPercent: 0.12, damagePercent: -0.03 },
    });
    return cfg;
}

function buildQbz95Craft(base) {
    const cfg = deepClone(base);
    setUniversalRifleSights(cfg);
    // QBZ 系共享基础池和无托平衡；QBZ-191 的现代化结构件不跨给 QBZ-95。
    removeOptions(cfg, 'barrel', ['qbz191_freefloat_handguard']);
    removeOptions(cfg, 'grip', ['qbz191_high_speed_trigger']);
    removeOptions(cfg, 'bullet', ['dbp191_high_velocity']);
    const stock = cfg.slots.find((slot) => slot.id === 'stock');
    if (stock) stock.name = '后托/尾垫';
    upsertOption(cfg, 'barrel', {
        id: 'qbz95_gas_tuning',
        name: '导气系统调校',
        icon: 'assets/icons/craft-cold-steel/qbz95_gas_tuning.png',
        desc: '攻击间隔-10ms，后坐恢复时间-80ms',
        specialModification: true,
        ticketCost: 4,
        effects: { attackIntervalDelta: -10, recoilRecoveryDelta: -80 },
    });
    removeOptions(cfg, 'sight', ['qbz95_carry_rail']);
    upsertOption(cfg, 'grip', {
        id: 'qbz95_grip_insert',
        name: '无托握把嵌片',
        icon: 'assets/icons/craft-cold-steel/qbz95_grip_insert.png',
        desc: '后坐恢复时间-120ms，最大散布角度-3°',
        ticketCost: 2,
        effects: { recoilRecoveryDelta: -120, maxSpreadAngleDelta: -3 },
    });
    upsertOption(cfg, 'stock', {
        id: 'qbz95_rubber_buttpad',
        name: '缓冲橡胶尾垫',
        icon: 'assets/icons/craft-cold-steel/qbz95_rubber_buttpad.png',
        desc: '后坐恢复时间-100ms，移动速度-2%',
        ticketCost: 2,
        effects: { recoilRecoveryDelta: -100, moveSpeedPercent: -0.02 },
    });
    upsertOption(cfg, 'bullet', {
        id: 'dbp87_balanced_round',
        name: 'DBP87均衡弹',
        icon: 'assets/icons/craft-cold-steel/dbp87_balanced_round.png',
        desc: '伤害+6%，弹速+8%，击退+1px',
        ticketCost: 2,
        effects: { damagePercent: 0.06, projectileSpeedPercent: 0.08, knockbackDelta: 1 },
    });
    return cfg;
}

const stg44 = readJson('tools/ai-gen/weapon-specs/stg44.json');
const qbz95 = readJson('tools/ai-gen/weapon-specs/qbz95.json');

for (const rel of ['data/equipment.json', 'public/data/equipment.json']) {
    const data = readJson(rel);
    data.equipment.stg44 = equipmentEntry(stg44);
    data.equipment.qbz95 = equipmentEntry(qbz95);
    writeJson(rel, data);
}

for (const rel of ['data/craft-config.json', 'public/data/craft-config.json']) {
    const data = readJson(rel);
    data.weapon7 = buildAkmCraft(data.weapon7);
    data.weapon23 = buildStg44Craft(data.weapon7);
    data.weapon8 = buildQbz191Craft(data.weapon8);
    data.weapon24 = buildQbz95Craft(data.weapon8);
    writeJson(rel, data);
}

const animRel = 'public/data/weapon-anim-config.json';
const anim = readJson(animRel);
anim.stg44 = deepClone(anim.akm);
anim.stg44.timingMul = 0.12;
anim.stg44.recoilAmount = 0.14;
anim.stg44.grip = { x: 0.29, y: 0.55 };
anim.stg44.muzzle = { x: 0.96, y: 0.50 };
anim.qbz95 = deepClone(anim.qbz191);
anim.qbz95.timingMul = 0.09;
anim.qbz95.recoilAmount = 0.10;
anim.qbz95.grip = { x: 0.42, y: 0.58 };
anim.qbz95.muzzle = { x: 0.96, y: 0.50 };
anim.qbz95.spriteOffsetY = 0;
anim.qbz95.aimSpriteOffsetY = 0;
writeJson(animRel, anim, 2);

console.log('Applied STG-44/QBZ-95 equipment, shared rifle craft pools, and animation data.');
