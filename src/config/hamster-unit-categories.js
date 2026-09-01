/** 仓鼠军事单位的三类战术分类；矿工与非仓鼠特色单位不在本表内。 */
export const HAMSTER_UNIT_CATEGORY = Object.freeze({
    INFANTRY: 'infantry',
    CAVALRY: 'cavalry',
    MAGIC: 'magic',
});

export const HAMSTER_UNIT_CATEGORY_LABELS = Object.freeze({
    [HAMSTER_UNIT_CATEGORY.INFANTRY]: '步兵',
    [HAMSTER_UNIT_CATEGORY.CAVALRY]: '骑兵',
    [HAMSTER_UNIT_CATEGORY.MAGIC]: '法术',
});

export const HAMSTER_UNIT_CATEGORIES = Object.freeze({
    militia: HAMSTER_UNIT_CATEGORY.INFANTRY,
    halberd: HAMSTER_UNIT_CATEGORY.INFANTRY,
    warrior: HAMSTER_UNIT_CATEGORY.INFANTRY,
    champion: HAMSTER_UNIT_CATEGORY.INFANTRY,
    shooter: HAMSTER_UNIT_CATEGORY.INFANTRY,
    guard: HAMSTER_UNIT_CATEGORY.INFANTRY,
    phalanx: HAMSTER_UNIT_CATEGORY.INFANTRY,
    riot_special: HAMSTER_UNIT_CATEGORY.INFANTRY,
    trench_assault: HAMSTER_UNIT_CATEGORY.INFANTRY,
    special_forces: HAMSTER_UNIT_CATEGORY.INFANTRY,
    scout: HAMSTER_UNIT_CATEGORY.INFANTRY,
    ranger: HAMSTER_UNIT_CATEGORY.INFANTRY,
    crossbow: HAMSTER_UNIT_CATEGORY.INFANTRY,
    longbow: HAMSTER_UNIT_CATEGORY.INFANTRY,
    assault: HAMSTER_UNIT_CATEGORY.INFANTRY,
    heavy_machine_gunner: HAMSTER_UNIT_CATEGORY.INFANTRY,
    sniper: HAMSTER_UNIT_CATEGORY.INFANTRY,
    anti_vehicle: HAMSTER_UNIT_CATEGORY.INFANTRY,
    musketeer: HAMSTER_UNIT_CATEGORY.INFANTRY,
    explorer: HAMSTER_UNIT_CATEGORY.INFANTRY,
    bounty_hunter: HAMSTER_UNIT_CATEGORY.INFANTRY,
    ninja: HAMSTER_UNIT_CATEGORY.INFANTRY,
    samurai: HAMSTER_UNIT_CATEGORY.INFANTRY,
    knight: HAMSTER_UNIT_CATEGORY.CAVALRY,
    light_cavalry: HAMSTER_UNIT_CATEGORY.CAVALRY,
    cavalry: HAMSTER_UNIT_CATEGORY.CAVALRY,
    winged_hussar: HAMSTER_UNIT_CATEGORY.CAVALRY,
    scout_rifle_skirmisher: HAMSTER_UNIT_CATEGORY.CAVALRY,
    powered_eod_explosive_lancer: HAMSTER_UNIT_CATEGORY.CAVALRY,
    camel_cavalry: HAMSTER_UNIT_CATEGORY.CAVALRY,
    priest: HAMSTER_UNIT_CATEGORY.MAGIC,
    desert_priest: HAMSTER_UNIT_CATEGORY.MAGIC,
});

export function getHamsterUnitCategory(unitKind) {
    return HAMSTER_UNIT_CATEGORIES[unitKind] || '';
}

export function getHamsterUnitCategoryLabel(unitKind) {
    return HAMSTER_UNIT_CATEGORY_LABELS[getHamsterUnitCategory(unitKind)] || '';
}
