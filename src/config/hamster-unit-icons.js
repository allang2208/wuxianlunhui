const UNIT_ICON_ROOT = 'assets/ui/unit-icons';

/**
 * 仓鼠兵种的 UI 图标单一映射。
 * 未配置图标的特色兵种和敌军由调用方保留文字或符号兜底。
 */
export const HAMSTER_UNIT_ICONS = Object.freeze({
    militia: `${UNIT_ICON_ROOT}/hamster-militia.png`,
    warrior: `${UNIT_ICON_ROOT}/hamster-warrior.png`,
    shooter: `${UNIT_ICON_ROOT}/hamster-shooter.png`,
    guard: `${UNIT_ICON_ROOT}/hamster-guard.png`,
    phalanx: `${UNIT_ICON_ROOT}/hamster-phalanx.png`,
    scout: `${UNIT_ICON_ROOT}/hamster-scout.png`,
    musketeer: `${UNIT_ICON_ROOT}/hamster-musketeer.png`,
    priest: `${UNIT_ICON_ROOT}/hamster-priest.png`,
    knight: `${UNIT_ICON_ROOT}/hamster-knight.png`,
    light_cavalry: `${UNIT_ICON_ROOT}/hamster-light-cavalry.png`,
    explorer: `${UNIT_ICON_ROOT}/hamster-explorer.png`,
    bounty_hunter: `${UNIT_ICON_ROOT}/hamster-bounty-hunter.png`,
});

export function getHamsterUnitIcon(unitKind) {
    return HAMSTER_UNIT_ICONS[unitKind] || '';
}
