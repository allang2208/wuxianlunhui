const UNIT_ICON_ROOT = 'assets/ui/unit-icons';

/**
 * 仓鼠兵种的 UI 图标单一映射。
 * 未配置图标的特色兵种和敌军由调用方保留文字或符号兜底。
 */
export const HAMSTER_UNIT_ICONS = Object.freeze({
    militia: `${UNIT_ICON_ROOT}/hamster-militia.png`,
    halberd: `${UNIT_ICON_ROOT}/hamster-halberdier.png`,
    warrior: `${UNIT_ICON_ROOT}/hamster-warrior.png`,
    champion: `${UNIT_ICON_ROOT}/hamster-champion.png`,
    shooter: `${UNIT_ICON_ROOT}/hamster-shooter.png`,
    guard: `${UNIT_ICON_ROOT}/hamster-guard.png`,
    phalanx: `${UNIT_ICON_ROOT}/hamster-phalanx.png`,
    riot_special: `${UNIT_ICON_ROOT}/hamster-riot-squad.png`,
    trench_assault: `${UNIT_ICON_ROOT}/hamster-trench-assault.png`,
    special_forces: `${UNIT_ICON_ROOT}/hamster-special-forces.png`,
    scout: `${UNIT_ICON_ROOT}/hamster-scout.png`,
    ranger: `${UNIT_ICON_ROOT}/hamster-ranger.png`,
    crossbow: `${UNIT_ICON_ROOT}/hamster-crossbow.png`,
    longbow: `${UNIT_ICON_ROOT}/hamster-longbow.png`,
    assault: `${UNIT_ICON_ROOT}/hamster-assault.png`,
    heavy_machine_gunner: `${UNIT_ICON_ROOT}/hamster-heavy-machine-gunner.png`,
    service_rifleman: `${UNIT_ICON_ROOT}/hamster-service-rifleman.png`,
    emplaced_machine_gun_crew: `${UNIT_ICON_ROOT}/hamster-bar-automatic-rifleman.png`,
    sniper: `${UNIT_ICON_ROOT}/hamster-sniper.png`,
    anti_vehicle: `${UNIT_ICON_ROOT}/hamster-anti-vehicle.png`,
    musketeer: `${UNIT_ICON_ROOT}/hamster-musketeer.png`,
    priest: `${UNIT_ICON_ROOT}/hamster-priest.png`,
    knight: `${UNIT_ICON_ROOT}/hamster-knight.png`,
    light_cavalry: `${UNIT_ICON_ROOT}/hamster-light-cavalry.png`,
    cavalry: `${UNIT_ICON_ROOT}/hamster-cavalry.png`,
    winged_hussar: `${UNIT_ICON_ROOT}/hamster-winged-hussar.png`,
    scout_rifle_skirmisher: `${UNIT_ICON_ROOT}/hamster-scout-rifle-skirmisher.png`,
    powered_eod_explosive_lancer: `${UNIT_ICON_ROOT}/hamster-powered-eod-explosive-lancer.png`,
    industrial_carbine_cavalry: `${UNIT_ICON_ROOT}/hamster-industrial-carbine-cavalry.png`,
    gunpowder_explosive_lancer: `${UNIT_ICON_ROOT}/hamster-industrial-heavy-lancer.png`,
    anti_tank_rifleman: `${UNIT_ICON_ROOT}/hamster-anti-tank-rifleman.png`,
    industrial_recon_rifleman: `${UNIT_ICON_ROOT}/hamster-industrial-recon-rifleman.png`,
    steel_shield_assault: `${UNIT_ICON_ROOT}/hamster-steel-shield-assault.png`,
    ninja: `${UNIT_ICON_ROOT}/hamster_ninja.png`,
    samurai: `${UNIT_ICON_ROOT}/hamster_samurai.png`,
    explorer: `${UNIT_ICON_ROOT}/hamster-explorer.png`,
    bounty_hunter: `${UNIT_ICON_ROOT}/hamster-bounty-hunter.png`,
});

export function getHamsterUnitIcon(unitKind) {
    return HAMSTER_UNIT_ICONS[unitKind] || '';
}
