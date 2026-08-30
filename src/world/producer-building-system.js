// ============================================================
// 通用产兵建筑（世界-122，2026-08-17）
// - 配置驱动：出兵时间 / 出品种类 / 造价 / 显示尺寸 / 升级模块全部读
//   data/producer-buildings.json（唯一真源），换建筑只需改配置 + 贴图；
// - 仓鼠军营与其余配置建筑共享本系统：每 spawnIntervalMs
//   生成一个军事单位；单位类型面板可切换；模块升级同步现有单位；
// - 单位基准值沿用 data/hamster-*-config.json（与兵营同源）。
// ============================================================
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { HamsterWarrior } from '../entities/hamster-warrior.js';
import { HamsterChampion } from '../entities/hamster-champion.js';
import { HamsterShooter } from '../entities/hamster-shooter.js';
import { HamsterGuard } from '../entities/hamster-guard.js';
import { HamsterPhalanx } from '../entities/hamster-phalanx.js';
import { HamsterRiotSquad } from '../entities/hamster-riot-squad.js';
import { HamsterSpecialForces } from '../entities/hamster-special-forces.js';
import { HamsterMilitia } from '../entities/hamster-militia.js';
import { HamsterHalberdier } from '../entities/hamster-halberdier.js';
import { HamsterScout } from '../entities/hamster-scout.js';
import { HamsterRanger } from '../entities/hamster-ranger.js';
import { HamsterCrossbow } from '../entities/hamster-crossbow.js';
import { HamsterCatapultCrew } from '../entities/hamster-catapult-crew.js';
import { HamsterFieldCannonCrew } from '../entities/hamster-field-cannon-crew.js';
import { HamsterHowitzerCrew } from '../entities/hamster-howitzer-crew.js';
import { HamsterLongbow } from '../entities/hamster-longbow.js';
import { HamsterAssault } from '../entities/hamster-assault.js';
import { HamsterHeavyMachineGunner } from '../entities/hamster-heavy-machine-gunner.js';
import { HamsterSniper } from '../entities/hamster-sniper.js';
import { HamsterMusketeer } from '../entities/hamster-musketeer.js';
import { HamsterAntiVehicle } from '../entities/hamster-anti-vehicle.js';
import { HamsterPriest } from '../entities/hamster-priest.js';
import { HamsterKnight } from '../entities/hamster-knight.js';
import { HamsterLightCavalry } from '../entities/hamster-light-cavalry.js';
import { HamsterCavalry } from '../entities/hamster-cavalry.js';
import { HamsterWingedHussar } from '../entities/hamster-winged-hussar.js';
import { HamsterScoutRifleSkirmisher } from '../entities/hamster-scout-rifle-skirmisher.js';
import { HamsterPoweredEodExplosiveLancer } from '../entities/hamster-powered-eod-explosive-lancer.js';
import { HamsterNinja } from '../entities/hamster-ninja.js';
import { HamsterSamurai } from '../entities/hamster-samurai.js';
import { HamsterCamelCavalry } from '../entities/hamster-camel-cavalry.js';
import { HamsterExplorer } from '../entities/hamster-explorer.js';
import { HamsterBountyHunter } from '../entities/hamster-bounty-hunter.js';
import { JaguarWarrior } from '../entities/jaguar-warrior.js';
import { JunglePriest } from '../entities/jungle-priest.js';
import { DesertPriest } from '../entities/desert-priest.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { renderBuildingUpgradeCard, renderBuildingUpgradeIcon } from '../ui/panels/building-upgrade-card.js';
import { releaseLightweightProjectImages } from '../ui/dom-project-image.js';
import { mountRightSidebarPanel } from '../ui/right-sidebar-panel-layer.js';
import { TechnologyGate } from '../ui/technology-gate.js';
import {
    refreshProducerRallySection,
    renderProducerRallySection,
} from '../ui/panels/producer-rally-section.js';
import {
    ensureBuildingUpgradeTooltip,
    hideBuildingUpgradeTooltip,
    moveBuildingUpgradeTooltip,
    showBuildingUpgradeTooltip,
} from '../ui/panels/building-upgrade-tooltip.js';
import { SceneManager } from './scene-manager.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldProgressionSystem } from './world-progression-system.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { Renderer } from './renderer.js';
import producerBuildings from '../../data/producer-buildings.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import championCfg from '../../data/hamster-champion-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import phalanxCfg from '../../data/hamster-phalanx-config.json';
import riotSquadCfg from '../../data/hamster-riot-squad-config.json';
import specialForcesCfg from '../../data/hamster-special-forces-config.json';
import militiaCfg from '../../data/hamster-militia-config.json';
import halberdierCfg from '../../data/hamster-halberdier-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import rangerCfg from '../../data/hamster-ranger-config.json';
import crossbowCfg from '../../data/hamster-crossbow-config.json';
import catapultCrewCfg from '../../data/hamster-catapult-crew-config.json';
import fieldCannonCrewCfg from '../../data/hamster-field-cannon-crew-config.json';
import howitzerCrewCfg from '../../data/hamster-howitzer-crew-config.json';
import longbowCfg from '../../data/hamster-longbow-config.json';
import assaultCfg from '../../data/hamster-assault-config.json';
import heavyMachineGunnerCfg from '../../data/hamster-heavy-machine-gunner-config.json';
import sniperCfg from '../../data/hamster-sniper-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import antiVehicleCfg from '../../data/hamster-anti-vehicle-config.json';
import priestCfg from '../../data/hamster-priest-config.json';
import knightCfg from '../../data/hamster-knight-config.json';
import lightCavalryCfg from '../../data/hamster-light-cavalry-config.json';
import cavalryCfg from '../../data/hamster-cavalry-config.json';
import wingedHussarCfg from '../../data/hamster-winged-hussar-config.json';
import scoutRifleSkirmisherCfg from '../../data/hamster-scout-rifle-skirmisher-config.json';
import poweredEodExplosiveLancerCfg from '../../data/hamster-powered-eod-explosive-lancer-config.json';
import ninjaCfg from '../../data/hamster-ninja-config.json';
import samuraiCfg from '../../data/hamster-samurai-config.json';
import camelCavalryCfg from '../../data/hamster-camel-cavalry-config.json';
import explorerCfg from '../../data/hamster-explorer-config.json';
import bountyHunterCfg from '../../data/hamster-bounty-hunter-config.json';
import jaguarWarriorCfg from '../../data/jaguar-warrior-config.json';
import junglePriestCfg from '../../data/jungle-priest-config.json';
import desertPriestCfg from '../../data/desert-priest-config.json';
import {
    applyGlobalUpgradesToKind,
    applyUnitUpgradePatch,
    getUpgradeMultsFromLevels,
    getUnitUpgradeLevel,
    getUnitUpgradeMults,
    getUnitUpgradePatch,
    getSharedUnitUpgradeLevel,
    getUnitKind,
    raiseUnitUpgradeLevel,
    raiseSharedUnitUpgradeLevel,
    syncSharedUnitUpgradeLevel,
} from './unit-upgrade-store.js';
import { getAbilityLevel, getAbilityValue, raiseAbilityLevel } from './ability-store.js';
import {
    DEFAULT_BUILDING_UPGRADE_TIME_MS, buildingContinuousTargetMatches,
    getBuildingContinuousCategory, getBuildingModuleUpgradeCost, getUpgradeModulesForUnitKind,
    isBuildingContinuousUpgradeOccupied, isBuildingUpgradeProgressOccupied,
    normalizeBuildingContinuousTarget, resolveBuildingUpgradeProject,
} from './building-upgrade-projects.js';
import { ResearchSystem } from './research-system.js';
import { applyBuildingFootprint } from './building-footprint.js';
import { buildingRoadLayout } from './building-road-system.js';
import { SpawnPlacement } from './spawn-placement.js';
import { RECRUIT_MODE, normalizeRecruitMode, recruitModeLabel, recruitStatusText } from './recruit-mode.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TroopLineSystem } from './troop-line-system.js';
import { TechnologySystem } from './technology-system.js';
import {
    getActiveRecruitmentTier,
    getRecruitableUnitTypes,
    getUnlockedRecruitmentTier,
    resolveRecruitmentUnitType,
} from './recruitment-tier.js';
import { hasBackgroundBuildingUpgrade, hasBackgroundContinuousUpgrade } from './world122-snapshot.js';
import { PopulationEconomySystem, populationEconomyConfig } from './population-economy-system.js';
import { HamsterFarmerVisualSystem } from './hamster-farmer-visual-system.js';
import { HamsterBankerVisualSystem } from './hamster-banker-visual-system.js';
import { HamsterBakerVisualSystem } from './hamster-baker-visual-system.js';
import { HamsterCowherdVisualSystem } from './hamster-cowherd-visual-system.js';
import { HolsteinCowVisualSystem } from './holstein-cow-visual-system.js';
import { HamsterBoilerWorkerVisualSystem } from './hamster-boiler-worker-visual-system.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { BankEconomySystem } from './bank-economy-system.js';
import { GrandMallEconomySystem } from './grand-mall-economy-system.js';
import { BakeryEconomySystem } from './bakery-economy-system.js';
import { CheeseFarmSystem } from './cheese-farm-system.js';
import { SteamPowerPlantSystem } from './steam-power-plant-system.js';
import { DeepDrillSystem } from './deep-drill-system.js';
import { TavernEconomySystem } from './tavern-economy-system.js';
import { HamsterBartenderVisualSystem } from './hamster-bartender-visual-system.js';
import { ArmoryEconomySystem } from './armory-economy-system.js';
import { ArmoryMaintainerVisualSystem } from './armory-maintainer-visual-system.js';
import { HouseResidentVisualSystem } from './house-resident-visual-system.js';
import { FieldHospitalSystem } from './field-hospital-system.js';
import { WarehouseEconomySystem } from './warehouse-economy-system.js';
import {
    WeatherForecastTowerSystem,
    WEATHER_FORECAST_TOWER_ID,
} from './weather-forecast-tower-system.js';
import {
    CandleSanctuarySystem,
    WORLD125_CANDLE_RANGE_MODULE_ID,
} from './candle-sanctuary-system.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import { World122TributeSystem } from './world122-tribute-system.js';
import { getRecruitCountMul } from '../config/tribute-effects.js';
import { getHamsterUnitIcon } from '../config/hamster-unit-icons.js';
import {
    isInstantTroopProductionEnabled,
    isMilitaryPopulationIgnored,
    skipBuildingUpgradeWait,
} from '../config/dev-cheats.js';

const ABILITY_TARGET_NAMES = Object.freeze({
    warrior: '仓鼠战士',
    champion: '仓鼠冠军',
    shooter: '仓鼠射手',
    guard: '仓鼠盾卫',
    phalanx: '仓鼠方阵',
    riot_special: '仓鼠防暴队',
    special_forces: '仓鼠特战',
    militia: '仓鼠民兵',
    halberd: '仓鼠长戟',
    scout: '仓鼠斥候',
    ranger: '仓鼠游侠',
    crossbow: '仓鼠弩手',
    hamster_catapult_crew: '仓鼠投石组',
    hamster_field_cannon_crew: '仓鼠野战炮组',
    hamster_howitzer_crew: '仓鼠榴弹炮组',
    longbow: '仓鼠长弓',
    assault: '仓鼠突击',
    heavy_machine_gunner: '仓鼠重机枪',
    sniper: '仓鼠狙击手',
    musketeer: '仓鼠火枪',
    anti_vehicle: '仓鼠反载',
    priest: '仓鼠牧师',
    knight: '仓鼠骑士',
    light_cavalry: '仓鼠轻骑',
    cavalry: '仓鼠骑兵',
    winged_hussar: '仓鼠翼骑兵',
    scout_rifle_skirmisher: '仓鼠侦察游骑兵',
    powered_eod_explosive_lancer: '仓鼠动力爆矛重骑兵',
    ninja: '仓鼠忍者',
    samurai: '仓鼠武士',
    camel_cavalry: '骆驼骑兵',
    explorer: '仓鼠探险家',
    bounty_hunter: '仓鼠赏金猎人',
    jaguar_warrior: '美洲豹战士',
    jungle_priest: '丛林祭司',
    desert_priest: '沙漠僧侣',
});

function renderTroopUnitIcon(unitKind, modifier = '') {
    const iconPath = getHamsterUnitIcon(unitKind);
    if (!iconPath) return '';
    const modifierClass = modifier ? ` troop-unit-icon--${modifier}` : '';
    return `<img class="troop-unit-icon${modifierClass}" src="${iconPath}" alt="" draggable="false">`;
}

function moduleAppliesToUnit(module, unitType) {
    return !Array.isArray(module?.unitKinds) || module.unitKinds.includes(unitType);
}

function renderContinuousUpgradeActions(options = {}) {
    const {
        maxed = false,
        inProgress = false,
        continuous = false,
        upgradeBusy = false,
        manualAttributes = '',
        continuousAttributes = '',
    } = options;
    if (maxed) return '<span class="troop-panel-caption">已满级</span>';
    const manualDisabled = upgradeBusy || inProgress ? 'disabled' : '';
    const continuousDisabled = upgradeBusy && !continuous ? 'disabled' : '';
    return `<div class="building-upgrade-action-group">
        <button class="troop-panel-upgrade-button" ${manualAttributes} ${manualDisabled}>升级</button>
        <button class="troop-panel-upgrade-button building-upgrade-continuous-button ${continuous ? 'is-active' : ''}"
            ${continuousAttributes} ${continuousDisabled}>${continuous ? '持续中' : '持续升级'}</button>
    </div>`;
}

function cloneProducerRuntimeConfig(cfg) {
    return {
        ...cfg,
        shadowCaster: cfg.shadowCaster ? {
            ...cfg.shadowCaster,
            contactPolygon: (cfg.shadowCaster.contactPolygon || []).map((point) => (
                Array.isArray(point) ? [...point] : { ...point }
            )),
            parts: (cfg.shadowCaster.parts || []).map((part) => ({
                ...part,
                polygon: (part.polygon || []).map((point) => (
                    Array.isArray(point) ? [...point] : { ...point }
                )),
            })),
        } : undefined,
        animation: cfg.animation ? { ...cfg.animation } : undefined,
        groundContact: cfg.groundContact ? { ...cfg.groundContact } : undefined,
        foregroundOverlay: cfg.foregroundOverlay ? { ...cfg.foregroundOverlay } : undefined,
        unitTypes: (cfg.unitTypes || []).map((unit) => ({ ...unit })),
        supplementalUnitUnlocks: [...(cfg.supplementalUnitUnlocks || [])],
        recruitmentTiers: (cfg.recruitmentTiers || []).map((tier) => ({
            ...tier,
            visual: tier.visual ? {
                ...tier.visual,
                visualFootprint: tier.visual.visualFootprint
                    ? { ...tier.visual.visualFootprint }
                    : undefined,
            } : undefined,
            lines: (tier.lines || []).map((line) => ({ ...line })),
        })),
        modules: Object.fromEntries(
            Object.entries(cfg.modules || {}).map(([key, module]) => [key, { ...module }])
        ),
        abilities: Object.fromEntries(
            Object.entries(cfg.abilities || {}).map(([key, ability]) => [key, { ...ability }])
        ),
        destinations: (cfg.destinations || []).map((destination) => ({ ...destination })),
    };
}

/** 建筑结构数据与独立升级项目合并后的运行时配置。 */
export const PRODUCER_BUILDINGS = Object.fromEntries(
    Object.entries(producerBuildings).map(([key, cfg]) => [key, resolveBuildingUpgradeProject(cfg)])
);

/** 单位 key → 基准配置（data/hamster-*-config.json，与仓鼠兵营同源） */
const PRODUCER_UNIT_CFG = {
    warrior: warriorCfg,
    champion: championCfg,
    shooter: shooterCfg,
    guard: guardCfg,
    phalanx: phalanxCfg,
    riot_special: riotSquadCfg,
    special_forces: specialForcesCfg,
    militia: militiaCfg,
    halberd: halberdierCfg,
    scout: scoutCfg,
    ranger: rangerCfg,
    crossbow: crossbowCfg,
    hamster_catapult_crew: catapultCrewCfg,
    hamster_field_cannon_crew: fieldCannonCrewCfg,
    hamster_howitzer_crew: howitzerCrewCfg,
    longbow: longbowCfg,
    assault: assaultCfg,
    heavy_machine_gunner: heavyMachineGunnerCfg,
    sniper: sniperCfg,
    musketeer: musketeerCfg,
    anti_vehicle: antiVehicleCfg,
    priest: priestCfg,
    knight: knightCfg,
    light_cavalry: lightCavalryCfg,
    cavalry: cavalryCfg,
    winged_hussar: wingedHussarCfg,
    scout_rifle_skirmisher: scoutRifleSkirmisherCfg,
    powered_eod_explosive_lancer: poweredEodExplosiveLancerCfg,
    ninja: ninjaCfg,
    samurai: samuraiCfg,
    camel_cavalry: camelCavalryCfg,
    explorer: explorerCfg,
    bounty_hunter: bountyHunterCfg,
    jaguar_warrior: jaguarWarriorCfg,
    jungle_priest: junglePriestCfg,
    desert_priest: desertPriestCfg,
};

/** 单位 key → 实体类 */
const PRODUCER_UNIT_CLASS = {
    warrior: HamsterWarrior,
    champion: HamsterChampion,
    shooter: HamsterShooter,
    guard: HamsterGuard,
    phalanx: HamsterPhalanx,
    riot_special: HamsterRiotSquad,
    special_forces: HamsterSpecialForces,
    militia: HamsterMilitia,
    halberd: HamsterHalberdier,
    scout: HamsterScout,
    ranger: HamsterRanger,
    crossbow: HamsterCrossbow,
    hamster_catapult_crew: HamsterCatapultCrew,
    hamster_field_cannon_crew: HamsterFieldCannonCrew,
    hamster_howitzer_crew: HamsterHowitzerCrew,
    longbow: HamsterLongbow,
    assault: HamsterAssault,
    heavy_machine_gunner: HamsterHeavyMachineGunner,
    sniper: HamsterSniper,
    musketeer: HamsterMusketeer,
    anti_vehicle: HamsterAntiVehicle,
    priest: HamsterPriest,
    knight: HamsterKnight,
    light_cavalry: HamsterLightCavalry,
    cavalry: HamsterCavalry,
    winged_hussar: HamsterWingedHussar,
    scout_rifle_skirmisher: HamsterScoutRifleSkirmisher,
    powered_eod_explosive_lancer: HamsterPoweredEodExplosiveLancer,
    ninja: HamsterNinja,
    samurai: HamsterSamurai,
    camel_cavalry: HamsterCamelCavalry,
    explorer: HamsterExplorer,
    bounty_hunter: HamsterBountyHunter,
    jaguar_warrior: JaguarWarrior,
    jungle_priest: JunglePriest,
    desert_priest: DesertPriest,
};

let assetResidencyRefreshQueued = false;

function scheduleFriendlyAssetResidencyRefresh() {
    if (assetResidencyRefreshQueued) return;
    assetResidencyRefreshQueued = true;
    queueMicrotask(() => {
        assetResidencyRefreshQueued = false;
        RuntimeAssetManager.setProductionFriendlyIds(
            ProducerBuildingSystem.getActiveVisualUnitIds()
        );
        RuntimeAssetManager.commitFriendlyEntities(Game.friendlyUnits);
        RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);
    });
}

const PRODUCER_UNIT_CONFIG_PATH = Object.freeze({
    warrior: 'data/hamster-warrior-config.json',
    champion: 'data/hamster-champion-config.json',
    shooter: 'data/hamster-shooter-config.json',
    guard: 'data/hamster-guard-config.json',
    phalanx: 'data/hamster-phalanx-config.json',
    riot_special: 'data/hamster-riot-squad-config.json',
    special_forces: 'data/hamster-special-forces-config.json',
    militia: 'data/hamster-militia-config.json',
    halberd: 'data/hamster-halberdier-config.json',
    scout: 'data/hamster-scout-config.json',
    ranger: 'data/hamster-ranger-config.json',
    crossbow: 'data/hamster-crossbow-config.json',
    hamster_catapult_crew: 'data/hamster-catapult-crew-config.json',
    hamster_field_cannon_crew: 'data/hamster-field-cannon-crew-config.json',
    hamster_howitzer_crew: 'data/hamster-howitzer-crew-config.json',
    longbow: 'data/hamster-longbow-config.json',
    assault: 'data/hamster-assault-config.json',
    heavy_machine_gunner: 'data/hamster-heavy-machine-gunner-config.json',
    sniper: 'data/hamster-sniper-config.json',
    musketeer: 'data/hamster-musketeer-config.json',
    anti_vehicle: 'data/hamster-anti-vehicle-config.json',
    priest: 'data/hamster-priest-config.json',
    knight: 'data/hamster-knight-config.json',
    light_cavalry: 'data/hamster-light-cavalry-config.json',
    cavalry: 'data/hamster-cavalry-config.json',
    winged_hussar: 'data/hamster-winged-hussar-config.json',
    scout_rifle_skirmisher: 'data/hamster-scout-rifle-skirmisher-config.json',
    powered_eod_explosive_lancer: 'data/hamster-powered-eod-explosive-lancer-config.json',
    ninja: 'data/hamster-ninja-config.json',
    samurai: 'data/hamster-samurai-config.json',
    camel_cavalry: 'data/hamster-camel-cavalry-config.json',
    explorer: 'data/hamster-explorer-config.json',
    bounty_hunter: 'data/hamster-bounty-hunter-config.json',
    jaguar_warrior: 'data/jaguar-warrior-config.json',
    jungle_priest: 'data/jungle-priest-config.json',
    desert_priest: 'data/desert-priest-config.json',
});

/** 碰撞体积编辑器使用的友军目录；配置对象保持引用，便于编辑后立即影响新生成单位。 */
export function getMilitaryUnitEditorCatalog() {
    return Object.entries(PRODUCER_UNIT_CFG).map(([key, config]) => ({
        key,
        name: config.name || ABILITY_TARGET_NAMES[key] || key,
        config,
        configPath: PRODUCER_UNIT_CONFIG_PATH[key],
    }));
}

/** 跨位面增援的统一军事单位工厂；不归属任何当地生产建筑。 */
export function createMilitaryUnit(kind, x, y, options = {}) {
    const UnitClass = PRODUCER_UNIT_CLASS[kind];
    const base = PRODUCER_UNIT_CFG[kind];
    if (!UnitClass || !base) return null;
    const patch = getUnitUpgradePatch(kind, getUpgradeModulesForUnitKind(kind));
    const baseAi = base.ai || {};
    const ai = {
        ...baseAi,
        attackInterval: patch.attackInterval,
        attackDamage: patch.attackDamage,
        attackDamageMult: patch.attackDamageMult,
        attackRange: patch.attackRange,
        castRange: patch.castRange,
        walkSpeed: patch.walkSpeed,
        holyLightCooldownMult: patch.holyLightCooldownMult,
        holyLightLevel: patch.holyLightLevel,
        jungleMagicLevel: patch.jungleMagicLevel,
        jungleSpellCooldownMult: patch.jungleSpellCooldownMult,
        chargeDamageMult: patch.chargeDamageMult,
        holyLightRangeBonus: patch.holyLightRangeBonus,
        titheEnergyPerTick: patch.titheEnergyPerTick,
        titheIntervalMs: patch.titheIntervalMs,
        duelistDamageMultiplier: patch.duelistDamageMultiplier,
    };
    const unit = new UnitClass(x, y, {
        id: options.id,
        ai,
        baseMaxHp: patch.baseMaxHp,
    });
    applyUnitUpgradePatch(unit, patch);
    const hpRatio = Math.max(0.01, Math.min(1, Number(options.hpRatio) || 1));
    if (unit.data) unit.data.hp = Math.max(1, Math.round((unit.data.maxHp || patch.baseMaxHp) * hpRatio));
    return unit;
}

/** 后台驻军结算使用的配置化战斗档案；与前台实体读取同一兵种/升级真源。 */
export function getMilitaryUnitProfile(kind) {
    const base = PRODUCER_UNIT_CFG[kind];
    if (!base) return null;
    const patch = getUnitUpgradePatch(kind, getUpgradeModulesForUnitKind(kind));
    const damage = Math.max(0, Number(patch.attackDamage ?? base.ai?.attackDamage) || 0);
    const artillery = ['hamster_catapult_crew', 'hamster_field_cannon_crew', 'hamster_howitzer_crew'].includes(kind);
    const interval = Math.max(300, Number(patch.attackInterval ?? base.ai?.attackInterval) || 2000,
        artillery ? base.animations.attack.durationMs : 0);
    let dps = kind === 'explorer' ? 0 : damage * 1000 / interval
        * (1 + Math.max(0, Math.min(1, Number(base.passives?.doubleStrikeChance) || 0))
            * (Math.max(1, Number(base.passives?.doubleStrikeMultiplier) || 1) - 1));
    if (artillery) {
        dps *= 1 + Math.max(0, Number(base.ai.expectedExtraTargets) || 0)
            * (1 - (Number(base.ai.splashFalloff) || 0) * 0.5);
    }
    if (kind === 'anti_vehicle') {
        const rocketDamage = (Number(base.ai?.rocketDamage) || 0)
            * Math.max(0, Number(patch.attackDamageMult) || 1);
        dps += rocketDamage * 1000 / Math.max(1000, Number(base.ai?.rocketCooldownMs) || 8000);
    }
    return {
        maxHp: Math.max(1, Number(patch.baseMaxHp ?? base.baseMaxHp) || 1),
        dps,
    };
}

export function getProducerConfig(key) {
    return PRODUCER_BUILDINGS[key] || null;
}

/** 模块升级费用（统一）：升级费用从配置读 */
export function getProducerModuleCost(cfg, moduleId, _currentLevel) {
    return getBuildingModuleUpgradeCost(cfg, moduleId, _currentLevel);
}

/** 面板用：模块当前/下一级描述文本 */
export function getProducerModuleDesc(cfg, moduleId, level) {
    const mod = cfg?.modules?.[moduleId];
    if (!mod) return '';
    const valueAt = (atLevel) => {
        const normalizedLevel = Math.max(0, Math.floor(Number(atLevel) || 0));
        if (normalizedLevel <= 0) return 0;
        const firstLevel = Number(mod.firstLevel);
        return Number.isFinite(firstLevel)
            ? firstLevel + Number(mod.per) * (normalizedLevel - 1)
            : Number(mod.per) * normalizedLevel;
    };
    const pctAt = (atLevel) => Number((Math.abs(valueAt(atLevel)) * 100).toFixed(1)).toString();
    const cooldownReductionPctAt = (atLevel) => {
        if (Math.max(0, Math.floor(Number(atLevel) || 0)) <= 0) return '0';
        return Number((Math.max(0, 1 - valueAt(atLevel)) * 100).toFixed(1)).toString();
    };
    const fill = (atLevel) => (mod.desc || '')
        .replace('{pct}', mod.effect === 'jungleSpellCooldownMult'
            ? cooldownReductionPctAt(atLevel)
            : pctAt(atLevel))
        .replace('{value}', `${Math.round(valueAt(atLevel))}`)
        .replace('{multiplier}', Number(valueAt(atLevel).toFixed(2)).toString())
        .replace('{level}', `${(mod.base ?? 0) + Math.round(mod.per * atLevel)}`)
        .replace('{tickSeconds}', `${Math.round((mod.tickMs ?? 0) / 1000)}`);
    return {
        current: fill(level),
        next: fill(level + 1),
    };
}

/** 当前模块倍率表 */
export function getProducerMults(cfg, modules) {
    return getUpgradeMultsFromLevels(cfg?.modules, modules);
}

// ==================== 产兵建筑实体 ====================

export class ProducerBuilding extends DamageableEntity {
    constructor(x, y, config = {}) {
        const sourceCfg = getProducerConfig(config.cfgKey);
        if (!sourceCfg) throw new Error(`producer-building: 未知配置 ${config.cfgKey}`);
        // 每栋建筑持有独立运行时配置副本，禁止面板选择或后续扩展误写共享模板后串联同类建筑。
        const cfg = cloneProducerRuntimeConfig(sourceCfg);
        const hp = config.hp ?? cfg.hp;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: cfg.displayW,
            collisionRadius: cfg.radius,
            name: config.name ?? cfg.name,
        });
        this.cfgKey = config.cfgKey;
        this._cfg = cfg;
        this.id = config.id || `${cfg.id}_${Math.random().toString(36).slice(2, 8)}`;
        this._isProducerBuilding = true;
        this._wallTowerWalk = cfg.wallTowerWalk ? { ...cfg.wallTowerWalk } : null;
        this._wallTowerTopVision = cfg.wallTowerTopVision
            ? { ...cfg.wallTowerTopVision }
            : null;
        this._isWallTower = this._wallTowerWalk?.enabled === true
            || this._wallTowerTopVision?.enabled === true;
        this._isWorld122TributeAltar = cfg.panelMode === 'tribute';
        this._isDefenseStructure = true;
        this._allowsEnergyNodeOverlap = cfg.allowsEnergyNodeOverlap === true;
        this.noSeparation = true;
        this.immovable = true;
        this._noShadow = true;
        this.def = cfg.def;
        this.mdef = cfg.mdef;
        const animationCfg = cfg.animation;
        this.spriteCfg = {
            idleKey: cfg.tex,
            // 主体保持静态；风车叶片等运动部件由独立 overlay Sprite 播放，禁止再用整栋精灵图覆盖主体。
            overlayAnimation: animationCfg ? { ...animationCfg } : null,
            // 专属接地覆盖层使用主体下方的静态 rearFx 通道；它只修饰道路与墙脚的
            // 接缝，不参与主体 alpha 拟合、碰撞、占格或结构遮挡包围盒。
            groundContact: cfg.groundContact ? { ...cfg.groundContact } : null,
            // 奶酪农场等复合建筑可把前景栅栏单独压在内部纯视觉单位之上。
            foregroundOverlay: cfg.foregroundOverlay ? { ...cfg.foregroundOverlay } : null,
            // 工作态装饰只保存视觉锚点与节奏；是否启用由经济系统的真实产出状态驱动。
            workingEffect: cfg.workingEffect ? {
                ...cfg.workingEffect,
                colors: Array.isArray(cfg.workingEffect.colors) ? [...cfg.workingEffect.colors] : undefined,
            } : null,
            // 面板继续展示原完整建筑缩略图，不显示无叶片运行时主体或纯叶片精灵表。
            panelKey: cfg.panelTex || null,
            size: cfg.displayW,
            sizeH: cfg.displayH,
            footOffsetY: cfg.footOffsetY,
            // Per-asset correction applied after alpha-ground fitting.  This
            // keeps the logical 2x2 footprint fixed while compensating for a
            // visible plinth thickness or an asymmetric generated canvas.
            anchorAdjustX: Number(cfg.anchorAdjustX) || 0,
            anchorAdjustY: Number(cfg.anchorAdjustY) || 0,
            visualFootprint: cfg.visualFootprint ? { ...cfg.visualFootprint } : null,
            // 统一贴图后默认固定标准2×2；仅未来明确声明 true 的异形建筑允许像素拟合物理体。
            autoFootprint: cfg.autoFootprint === true,
            // 阴影投射体只影响视觉，不参与建造占格、碰撞或寻路。
            shadowCaster: cfg.shadowCaster,
        };
        this._recruitmentBaseVisual = {
            tex: this.spriteCfg.idleKey,
            displayW: this.spriteCfg.size,
            displayH: this.spriteCfg.sizeH,
            footOffsetY: this.spriteCfg.footOffsetY,
            anchorAdjustX: this.spriteCfg.anchorAdjustX,
            anchorAdjustY: this.spriteCfg.anchorAdjustY,
            visualFootprint: this.spriteCfg.visualFootprint
                ? { ...this.spriteCfg.visualFootprint }
                : null,
            shadowCaster: this.spriteCfg.shadowCaster,
        };
        this._recruitmentBaseName = cfg.name;
        this._wallTowerBaseVisual = this._isWallTower ? {
            tex: this.spriteCfg.idleKey,
            displayW: this.spriteCfg.size,
            displayH: this.spriteCfg.sizeH,
            footOffsetY: this.spriteCfg.footOffsetY,
            foregroundOverlay: this.spriteCfg.foregroundOverlay
                ? { ...this.spriteCfg.foregroundOverlay }
                : null,
        } : null;
        this._wallTowerBaseStats = this._isWallTower ? {
            name: cfg.name,
            hp: Math.max(1, Number(cfg.hp) || 1),
            def: Math.max(0, Number(cfg.def) || 0),
            mdef: Math.max(0, Number(cfg.mdef) || 0),
        } : null;
        this.footOffsetY = this.spriteCfg.footOffsetY;
        applyBuildingFootprint(this, Number(cfg.footprintCells) || 2);
        setupStructureDepth(this);
        const isRecruitmentTierUnlocked = (id) =>
            TechnologySystem.isUnlocked('recruitmentTier', id);
        const isUnitUnlocked = (id) => TechnologySystem.isUnlocked('unit', id);
        const unlockedRecruitmentTier = getUnlockedRecruitmentTier(cfg, isRecruitmentTierUnlocked);
        this.level = Math.max(1, Number(unlockedRecruitmentTier?.level) || 1);
        this._applyRecruitmentTierVisual(unlockedRecruitmentTier);
        this.maxLevel = (cfg.recruitmentTiers || []).length
            ? Math.max(this.level, ...(cfg.recruitmentTiers || [])
                .map((tier) => Math.max(1, Number(tier?.level) || 1)))
            : 10;
        this.modules = {};            // { moduleId: level }
        const configuredUnitType = cfg.defaultUnitType || (cfg.unitTypes?.[0]?.key) || 'shooter';
        const recruitableUnitTypes = getRecruitableUnitTypes(
            cfg, isRecruitmentTierUnlocked, isUnitUnlocked
        );
        const tierUnitType = resolveRecruitmentUnitType(
            cfg, configuredUnitType, isRecruitmentTierUnlocked, isUnitUnlocked
        );
        const firstUnlockedUnitType = recruitableUnitTypes.find((unit) =>
            isUnitUnlocked(unit.key))?.key;
        this.unitType = isUnitUnlocked(tierUnitType)
            ? tierUnitType
            : (firstUnlockedUnitType || tierUnitType);
        this.units = [];              // 本建筑拥有的军事单位
        this._unitSeq = 0;
        this._spawnTimer = 0;
        this._baseSpawnIntervalMs = cfg.spawnIntervalMs;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnFoodBlocked = false;
        this._spawnPopulationBlocked = false;
        this.spawnEnabled = cfg.spawnEnabled !== false; // 铁匠铺等能力建筑不产兵
        this._isTroopProducer = this.spawnEnabled && (cfg.unitTypes || []).some((unit) => !!unit?.key);
        // 只有带 featureWorldId 的位面特色出兵建筑保留本建筑/分兵种编制上限；
        // 普通出兵建筑只受当前位面的全局军事人口限制。
        this._hasIndividualUnitCap = this._isTroopProducer && !!cfg.featureWorldId;
        PopulationEconomySystem.registerMilitaryProducer(this);
        this._recruitMode = RECRUIT_MODE.PAUSED;
        this._parallelProduction = cfg.parallelProduction === true;
        // 所有出兵建筑都由建筑持有一组升级卡：通用模块同步覆盖本建筑全部兵种，
        // 特殊模块再由 unitKinds 收窄实际适用对象；当前选择只影响下一次出兵。
        this._sharedUnitUpgrades = this._isTroopProducer;
        if (this._sharedUnitUpgrades) {
            const buildingKinds = (cfg.unitTypes || [])
                .map((unit) => unit?.key)
                .filter(Boolean);
            for (const [moduleId, module] of Object.entries(cfg.modules || {})) {
                const kinds = buildingKinds.filter((kind) => moduleAppliesToUnit(module, kind));
                syncSharedUnitUpgradeLevel(kinds, moduleId, module.maxLevel);
            }
            for (const kind of buildingKinds) applyGlobalUpgradesToKind(kind, cfg.modules);
        }
        this._parallelQueues = {};
        if (this._parallelProduction) {
            for (const unit of cfg.unitTypes || []) {
                if (!unit?.key) continue;
                this._parallelQueues[unit.key] = {
                    recruitMode: RECRUIT_MODE.PAUSED,
                    timer: 0,
                    retryTimer: 0,
                    blocked: false,
                    foodBlocked: false,
                    populationBlocked: false,
                };
                this._parallelQueues[unit.key].timer = this.recruitIntervalMs(unit.key);
            }
        }
        if (this.spawnEnabled) this._spawnTimer = this.recruitIntervalMs();
        this._upgrade = null;         // 升级读条：abilityId 或 unitType + moduleId
        this._continuous = null;      // 持续升级目标：能力或兵种模块；资源不足时保留并轮询
        this._continuousRetryMs = 0;
        this._continuousUpgradeCategory = `producer:${this.cfgKey}`;
        this._isEnergyWarehouse = cfg.workshopType === 'warehouse';
        PopulationEconomySystem.initializeBuilding(this, config);
        WarehouseEconomySystem.initializeBuilding(this, config);
        if (this._isEnergyWarehouse && EnergyManager) {
            this.storedEnergy = 0;
            this.storedFood = 0;
            EnergyManager.registerWarehouse(this, this.storageCapacity ?? cfg.storageCapacity ?? 5000);
        }
        BankEconomySystem.initializeBuilding(this, config);
        GrandMallEconomySystem.initializeBuilding(this, config);
        BakeryEconomySystem.initializeBuilding(this, config);
        CheeseFarmSystem.initializeBuilding(this, config);
        SteamPowerPlantSystem.initializeBuilding(this, config);
        DeepDrillSystem.initializeBuilding(this, config);
        TavernEconomySystem.initializeBuilding(this, config);
        WorkshopEconomySystem.initializeBuilding(this, config);
        ArmoryEconomySystem.initializeBuilding(this, config);
        FieldHospitalSystem.initializeBuilding(this, config);
        CandleSanctuarySystem.initializeBuilding(this, config);
        WeatherForecastTowerSystem.initializeBuilding(this, config);
        this.refreshWallTowerTier({ preserveHealthRatio: config.hp != null });
        this.refreshWallTowerWalkNodes();
        this.rebuildCollider();
    }

    /** 当前兵种全局倍率（2026-08-17 起按兵种全局共享，不再按建筑实例） */
    mults(kind = this.unitType) {
        return getUnitUpgradeMults(kind, this._cfg.modules);
    }

    _isRecruitmentTierUnlocked(id) {
        return TechnologySystem.isUnlocked('recruitmentTier', id);
    }

    _isUnitUnlocked(id) {
        return TechnologySystem.isUnlocked('unit', id);
    }

    getRecruitmentTier() {
        return getActiveRecruitmentTier(
            this._cfg, (id) => this._isRecruitmentTierUnlocked(id)
        );
    }

    getRecruitmentVisualTier() {
        return getUnlockedRecruitmentTier(
            this._cfg, (id) => this._isRecruitmentTierUnlocked(id)
        );
    }

    getRecruitableUnitTypes() {
        return getRecruitableUnitTypes(
            this._cfg,
            (id) => this._isRecruitmentTierUnlocked(id),
            (id) => this._isUnitUnlocked(id)
        );
    }

    /**
     * 编制科技立即替换建筑名称与视觉，不改逻辑占格、碰撞或寻路 footprint。
     * 尚无独立美术的更高等级沿用最近一档已完成外观，避免回退到一级贴图。
     */
    _applyRecruitmentTierVisual(activeTier = this.getRecruitmentVisualTier()) {
        if (!this.spriteCfg || !this._recruitmentBaseVisual) return false;
        const activeLevel = Math.max(1, Number(activeTier?.level) || 1);
        const visualTier = (this._cfg.recruitmentTiers || [])
            .filter((tier) => Math.max(1, Number(tier?.level) || 1) <= activeLevel && tier?.visual)
            .sort((left, right) => Number(right.level) - Number(left.level))[0];
        const resolved = {
            ...this._recruitmentBaseVisual,
            ...(visualTier?.visual || {}),
        };
        const nextTexture = resolved.tex || this._recruitmentBaseVisual.tex;
        const nextName = activeTier?.name || this._recruitmentBaseName;
        const nextVisualFootprint = resolved.visualFootprint
            ? { ...resolved.visualFootprint }
            : null;
        const changed = this.spriteCfg.idleKey !== nextTexture
            || this._cfg.name !== nextName
            || this.name !== nextName
            || this.spriteCfg.size !== resolved.displayW
            || this.spriteCfg.sizeH !== resolved.displayH
            || this.spriteCfg.footOffsetY !== resolved.footOffsetY
            || this.spriteCfg.anchorAdjustX !== (Number(resolved.anchorAdjustX) || 0)
            || this.spriteCfg.anchorAdjustY !== (Number(resolved.anchorAdjustY) || 0)
            || JSON.stringify(this.spriteCfg.visualFootprint) !== JSON.stringify(nextVisualFootprint);
        this.spriteCfg.idleKey = nextTexture;
        this._cfg.name = nextName;
        this.name = nextName;
        this.spriteCfg.size = resolved.displayW;
        this.spriteCfg.sizeH = resolved.displayH;
        this.spriteCfg.footOffsetY = resolved.footOffsetY;
        this.spriteCfg.anchorAdjustX = Number(resolved.anchorAdjustX) || 0;
        this.spriteCfg.anchorAdjustY = Number(resolved.anchorAdjustY) || 0;
        this.spriteCfg.visualFootprint = nextVisualFootprint;
        this.spriteCfg.shadowCaster = resolved.shadowCaster;
        this.footOffsetY = this.spriteCfg.footOffsetY;
        if (changed) {
            delete this._structureVisualFitKey;
            delete this._structureVisualFit;
        }
        return changed;
    }

    /** 科研立即升级建筑；整级兵种开发齐全后才替换招募槽，现役单位始终不变。 */
    refreshRecruitmentTier({ resetTimer = true } = {}) {
        if (!this._isTroopProducer || !(this._cfg.recruitmentTiers || []).length) return false;
        const visualTier = this.getRecruitmentVisualTier();
        const nextLevel = Math.max(1, Number(visualTier?.level) || 1);
        const nextUnitType = resolveRecruitmentUnitType(
            this._cfg,
            this.unitType,
            (id) => this._isRecruitmentTierUnlocked(id),
            (id) => this._isUnitUnlocked(id)
        );
        const changed = nextLevel !== this.level || nextUnitType !== this.unitType;
        this.level = nextLevel;
        const previousTexture = this.spriteCfg?.idleKey;
        const visualChanged = this._applyRecruitmentTierVisual(visualTier);
        if (visualChanged) {
            RuntimeAssetManager.transitionBuildingVisual(
                previousTexture,
                this.spriteCfg?.idleKey,
                this.cfgKey
            );
        }
        if (nextUnitType && nextUnitType !== this.unitType) {
            this.unitType = nextUnitType;
            if (normalizeRecruitMode(this._recruitMode) !== RECRUIT_MODE.PAUSED) {
                RuntimeAssetManager.requestFriendlyUnit(PRODUCER_UNIT_CFG[nextUnitType]?.id);
            }
            if (resetTimer) {
                this._spawnTimer = this.recruitIntervalMs();
                this._spawnRetryTimer = 0;
                this._spawnBlocked = false;
                this._spawnPopulationBlocked = false;
                this._spawnFoodBlocked = false;
            }
        }
        if (changed) scheduleFriendlyAssetResidencyRefresh();
        return changed || visualChanged;
    }

    /** 位面特色建筑的独立编制上限；普通出兵建筑不设置建筑级上限。 */
    unitCount() {
        if (!this._hasIndividualUnitCap) return Number.POSITIVE_INFINITY;
        if (this._parallelProduction) {
            return (this._cfg.unitTypes || []).reduce((sum, unit) =>
                sum + Math.max(0, Math.floor(Number(unit.unitCap) || 0)), 0);
        }
        return Math.max(0, Math.floor(Number(this._cfg.unitCap) || 0));
    }

    /** 当前存活单位数 */
    aliveUnitCount(kind = null) {
        return TroopLineSystem.countAssignedToProducer(this, kind);
    }

    /** 配置里该单位 key 的展示名 */
    unitName(key) {
        const u = (this._cfg.unitTypes || []).find((t) => t.key === key);
        return u ? u.name : key;
    }

    /** 当前兵种生产周期：unitTypes 条目可按兵种覆盖 spawnIntervalMs，缺省用建筑级配置（2026-08-18） */
    _unitSpawnIntervalMs(kind = this.unitType) {
        const u = (this._cfg.unitTypes || []).find((t) => t.key === kind);
        return (u && Number.isFinite(u.spawnIntervalMs)) ? u.spawnIntervalMs : this._baseSpawnIntervalMs;
    }

    _unitSpawnFoodCost(kind = this.unitType) {
        const unit = (this._cfg.unitTypes || []).find((entry) => entry.key === kind);
        const base = Math.max(0, Number(unit?.spawnFoodCost) || 0);
        return Math.max(0, Math.ceil(base * ArmoryEconomySystem.getResourceCostMultiplier(this)));
    }

    /** 切换生成的单位类型；下一次生成生效（key 必须在配置 unitTypes 里）。
     *  2026-08-18：切换兵种重新计时——按新兵种周期从头读条（原来保留计时且同建筑各兵种同周期）；
     *  切换为当前兵种视为无操作（返回 false，不打断计时、不发通知）。 */
    setUnitType(type) {
        if (!this.getRecruitableUnitTypes().some((t) => t.key === type)) return false;
        if (!TechnologySystem.isUnlocked('unit', type)) return false;
        if (type === this.unitType) return false;
        this.unitType = type;
        if (normalizeRecruitMode(this._recruitMode) !== RECRUIT_MODE.PAUSED) {
            RuntimeAssetManager.requestFriendlyUnit(PRODUCER_UNIT_CFG[type]?.id);
        }
        this._spawnTimer = this.recruitIntervalMs();
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnPopulationBlocked = false;
        scheduleFriendlyAssetResidencyRefresh();
        return true;
    }

    setRecruitMode(mode) {
        if (!this._isTroopProducer) return { ok: false, reason: '该建筑不能招募单位' };
        const next = normalizeRecruitMode(mode);
        if (next === RECRUIT_MODE.SINGLE) {
            if (this._hasIndividualUnitCap && this.aliveUnitCount() >= this.unitCount()) {
                return { ok: false, reason: '该特色建筑的兵种数量已达上限' };
            }
            if (!PopulationEconomySystem.canRecruitMilitary(1)) {
                return { ok: false, reason: '军事人口已达上限，请建造或升级房屋' };
            }
            const cost = CrossPlaneResourceSystem.quote({ food: this._unitSpawnFoodCost() }).food;
            if (cost > 0 && CrossPlaneResourceSystem.getAvailable('food') < cost) {
                return { ok: false, reason: `粮食不足，单次招募需要 ${cost} 粮食` };
            }
        }
        this._recruitMode = next;
        if (next !== RECRUIT_MODE.PAUSED) {
            RuntimeAssetManager.requestFriendlyUnit(PRODUCER_UNIT_CFG[this.unitType]?.id);
        }
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnFoodBlocked = false;
        this._spawnPopulationBlocked = false;
        if (next === RECRUIT_MODE.SINGLE || !(this._spawnTimer > 0)) {
            this._spawnTimer = this.recruitIntervalMs();
        } else if (next === RECRUIT_MODE.CONTINUOUS) {
            this._spawnTimer = Math.min(this._spawnTimer, this.recruitIntervalMs());
        }
        scheduleFriendlyAssetResidencyRefresh();
        return { ok: true, mode: next };
    }

    parallelUnitCap(kind) {
        if (!this._hasIndividualUnitCap) return Number.POSITIVE_INFINITY;
        const unit = (this._cfg.unitTypes || []).find((entry) => entry.key === kind);
        return Math.max(0, Math.floor(Number(unit?.unitCap) || 0));
    }

    setParallelRecruitMode(kind, mode) {
        const queue = this._parallelQueues?.[kind];
        if (!this._parallelProduction || !queue) return { ok: false, reason: '未知生产通道' };
        if (!TechnologySystem.isUnlocked('unit', kind)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('unit', kind);
            return { ok: false, reason: `需要先完成科技：${technologyName || kind}` };
        }
        const next = normalizeRecruitMode(mode);
        if (next === RECRUIT_MODE.SINGLE) {
            if (this.aliveUnitCount(kind) >= this.parallelUnitCap(kind)) {
                return { ok: false, reason: '该特色兵种数量已达上限' };
            }
            if (!PopulationEconomySystem.canRecruitMilitary(1)) {
                return { ok: false, reason: '军事人口已达上限，请建造或升级房屋' };
            }
            const cost = CrossPlaneResourceSystem.quote({ food: this._unitSpawnFoodCost(kind) }).food;
            if (cost > 0 && CrossPlaneResourceSystem.getAvailable('food') < cost) {
                return { ok: false, reason: `粮食不足，单次招募需要 ${cost} 粮食` };
            }
        }
        queue.recruitMode = next;
        if (next !== RECRUIT_MODE.PAUSED) {
            RuntimeAssetManager.requestFriendlyUnit(PRODUCER_UNIT_CFG[kind]?.id);
        }
        queue.retryTimer = 0;
        queue.blocked = false;
        queue.foodBlocked = false;
        queue.populationBlocked = false;
        if (next === RECRUIT_MODE.SINGLE || !(queue.timer > 0)) queue.timer = this.recruitIntervalMs(kind);
        scheduleFriendlyAssetResidencyRefresh();
        return { ok: true, mode: next, kind };
    }

    /** 只返回当前真正会继续生产的已研发兵种；暂停、未研发和已被编制替换的旧槽不预取。 */
    getActiveVisualUnitIds() {
        if (!this._isTroopProducer || !this.active) return [];
        const restoreIds = new Set((this._restoreRosterQueue || [])
            .map((kind) => PRODUCER_UNIT_CFG[kind]?.id)
            .filter(Boolean));
        if (this._parallelProduction) {
            for (const id of Object.entries(this._parallelQueues || {})
                .filter(([kind, queue]) => TechnologySystem.isUnlocked('unit', kind)
                    && normalizeRecruitMode(queue?.recruitMode) !== RECRUIT_MODE.PAUSED)
                .map(([kind]) => PRODUCER_UNIT_CFG[kind]?.id)
                .filter(Boolean)) restoreIds.add(id);
            return [...restoreIds];
        }
        const restoringTopUp = this._restoreTopUp > 0;
        if ((normalizeRecruitMode(this._recruitMode) === RECRUIT_MODE.PAUSED && !restoringTopUp)
            || (!TechnologySystem.isUnlocked('unit', this.unitType) && !restoringTopUp)) {
            return [...restoreIds];
        }
        const config = PRODUCER_UNIT_CFG[this.unitType];
        if (config?.id) restoreIds.add(config.id);
        return [...restoreIds];
    }

    /** 固定出口槽位：墙体、建筑 footprint、动态单位与出口预约全部通过才返回。 */
    _findUnitSpawn() {
        const sourceSceneId = SceneManager.currentScene;
        return SpawnPlacement.findAndReserve(this, {
            unitRadius: 24,
            entities: Game?.entities,
            wallSystem: WallSystem,
            preferredTarget: TroopLineSystem.getSpawnDirectionTarget(sourceSceneId, this),
        });
    }

    /** 生成一个军事单位（当前 unitType），应用模块倍率 */
    spawnUnit(payFood = false, options = {}) {
        if (!Game || !Game.entities) return null;
        if (!TechnologySystem.isUnlocked('unit', this.unitType)) return null;
        if (!options.restoring) {
            const individualCap = this._parallelProduction
                ? this.parallelUnitCap(this.unitType)
                : this.unitCount();
            const individualCount = this._parallelProduction
                ? this.aliveUnitCount(this.unitType)
                : this.aliveUnitCount();
            if (this._hasIndividualUnitCap && individualCount >= individualCap) return null;
            if (!PopulationEconomySystem.canRecruitMilitary(1)) {
                this._spawnPopulationBlocked = true;
                return null;
            }
        }
        this._spawnPopulationBlocked = false;
        const unitCfg = PRODUCER_UNIT_CFG[this.unitType];
        const UnitClass = PRODUCER_UNIT_CLASS[this.unitType];
        if (!unitCfg || !UnitClass) return null;
        const base = unitCfg || {};
        const baseAi = base.ai || {};
        const mults = this.mults();
        const patch = getUnitUpgradePatch(this.unitType, this._cfg.modules);
        const spot = this._findUnitSpawn();
        if (!spot) return null;
        const spawnCost = this._unitSpawnFoodCost();
        if (payFood && spawnCost > 0
            && !CrossPlaneResourceSystem.pay({ food: spawnCost }, { allowDevFree: false }).ok) {
            this._spawnFoodBlocked = true;
            return null;
        }
        this._spawnFoodBlocked = false;
        const id = `${this.id}_unit_${++this._unitSeq}`;
        const ai = {
            ...baseAi,
            attackInterval: Math.max(300, Math.round((baseAi.attackInterval ?? 2000) * mults.attackIntervalMult)),
            attackDamage: Math.max(1, Math.round((baseAi.attackDamage ?? 50) * mults.attackDamageMult)),
            attackDamageMult: mults.attackDamageMult,
            attackRange: Math.max(0, Math.round((baseAi.attackRange ?? 0) + mults.attackRangeBonus)),
            castRange: Math.max(0, Math.round((baseAi.castRange ?? 0) + mults.holyLightRangeBonus)),
            walkSpeed: patch.walkSpeed,
            holyLightCooldownMult: mults.holyLightCooldownMult,
            holyLightLevel: mults.holyLightLevel,
            jungleMagicLevel: mults.jungleMagicLevel,
            jungleSpellCooldownMult: mults.jungleSpellCooldownMult,
            chargeDamageMult: mults.chargeDamageMult,
            holyLightRangeBonus: mults.holyLightRangeBonus,
            titheEnergyPerTick: mults.titheEnergyPerTick,
            titheIntervalMs: Number(Object.values(this._cfg.modules || {}).find(
                (module) => module?.effect === 'titheEnergyPerTick'
            )?.tickMs) || 0,
        };
        const baseMaxHp = Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult));
        const unit = new UnitClass(spot.x, spot.y, { id, ai, baseMaxHp });
        if (this.unitType === 'priest' && Number.isFinite(this._restoredTitheTimer)
            && unit._ai && '_titheTimer' in unit._ai) {
            unit._ai._titheTimer = Math.max(0, this._restoredTitheTimer);
        }
        applyUnitUpgradePatch(unit, patch);
        if (this.unitType === 'explorer' && Array.isArray(this._restoreExplorerRuns)
            && this._restoreExplorerRuns.length > 0) {
            const run = this._restoreExplorerRuns.shift();
            unit._command = { mode: 'explore' };
            unit._ai?.restoreExploration?.(run);
        }
        unit._barracks = this;
        unit._spawnEgress = { x: spot.egressX, y: spot.egressY };
        this.units.push(unit);
        Game.entities.set(id, unit);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(unit);
        TroopLineSystem.onUnitProduced(
            unit,
            this,
            options.sourceSceneId || SceneManager.currentScene,
            options
        );
        // 双身翡翠神像「双身」（2026-08-22 工艺品祭品）：每次出兵数量 ×N，额外单位不再收取食物
        if (!options._noRecruitMul) {
            const recruitMul = Math.max(1, Math.floor(getRecruitCountMul()));
            for (let extra = 1; extra < recruitMul; extra++) {
                this.spawnUnit(false, { ...options, _noRecruitMul: true });
            }
        }
        return unit;
    }

    spawnUnitFor(kind, payFood = false, options = {}) {
        const selected = this.unitType;
        this.unitType = kind;
        const unit = this.spawnUnit(payFood, options);
        this.unitType = selected;
        return unit;
    }

    /** 把该兵种全局升级同步给场景内所有该兵种单位（2026-08-17 起跨建筑全局生效） */
    applyUpgradesToUnits() {
        applyGlobalUpgradesToKind(this.unitType, this._cfg.modules);
    }

    /** 当前卡片实际覆盖的兵种。共享组按模块 unitKinds 自动排除不适用对象。 */
    moduleUnitTypes(moduleId, unitType = this.unitType) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod) return [];
        if (this._sharedUnitUpgrades) {
            return (this._cfg.unitTypes || [])
                .map((unit) => unit?.key)
                .filter((kind) => kind && moduleAppliesToUnit(mod, kind));
        }
        return unitType && moduleAppliesToUnit(mod, unitType) ? [unitType] : [];
    }

    moduleLevel(moduleId, unitType = this.unitType) {
        const kinds = this.moduleUnitTypes(moduleId, unitType);
        return this._sharedUnitUpgrades
            ? getSharedUnitUpgradeLevel(kinds, moduleId)
            : getUnitUpgradeLevel(kinds[0], moduleId);
    }

    /** 模块是否可升级（未满级即可） */
    canUpgradeModule(moduleId, unitType = this.unitType) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod || !this.moduleUnitTypes(moduleId, unitType).length) return false;
        return this.moduleLevel(moduleId, unitType) < mod.maxLevel;
    }

    getModuleCost(moduleId, unitType = this.unitType) {
        return getProducerModuleCost(this._cfg, moduleId, this.moduleLevel(moduleId, unitType));
    }

    isContinuousUpgrade(kind, projectId, unitType = null) {
        return buildingContinuousTargetMatches(this._continuous, kind, projectId, unitType);
    }

    /** 能力配置（铁匠铺专属，2026-08-17） */
    getAbility(abilityId) {
        return (this._cfg.abilities || {})[abilityId] || null;
    }

    /** 能力当前全局等级 */
    abilityLevel(abilityId) {
        return getAbilityLevel(abilityId);
    }

    /** 能力是否可升级（存在且未满级） */
    canUpgradeAbility(abilityId) {
        const a = this.getAbility(abilityId);
        if (!a) return false;
        return this.abilityLevel(abilityId) < (a.maxLevel ?? 10);
    }

    /**
     * 能力升级资源/读条公式（2026-08-17）：
     * 金币 = goldBase × goldGrowth^lv；能源 = energyBase × energyGrowth^lv；
     * 读条 = timeBaseMs + timeGrowthMs × lv（lv = 当前等级，下一级费用）。
     */
    getAbilityCost(abilityId) {
        const a = this.getAbility(abilityId);
        if (!a) return null;
        const lv = this.abilityLevel(abilityId);
        const c = this._cfg.abilityUpgrade || {};
        return {
            gold: Math.round((c.goldBase ?? 150) * Math.pow(c.goldGrowth ?? 1.3, lv)),
            energy: Math.round((c.energyBase ?? 200) * Math.pow(c.energyGrowth ?? 1.35, lv)),
            timeMs: (c.timeBaseMs ?? DEFAULT_BUILDING_UPGRADE_TIME_MS) + (c.timeGrowthMs ?? 0) * lv,
        };
    }

    /**
     * 开始一次能力升级读条（读条开始时扣资源，完成时等级 +1）。
     * continuous=true：本项目完成后自动续升下一级（资源足够且未满级）。
     */
    startAbilityUpgrade(abilityId, continuous = false, options = {}) {
        if (continuous && !options.fromContinuous) {
            return this.setContinuousUpgrade({ kind: 'ability', abilityId });
        }
        if (!TechnologySystem.isUnlocked('upgrade', abilityId)) return { ok: false, reason: '该研究项目尚未通过科技解锁' };
        const a = this.getAbility(abilityId);
        if (!a) return { ok: false, reason: '未知能力' };
        if (!this.canUpgradeAbility(abilityId)) return { ok: false, reason: '能力已满级' };
        if (this._upgrade) return { ok: false, reason: '已有升级在读条中' };
        if (!options.fromContinuous && this._continuous
            && !this.isContinuousUpgrade('ability', abilityId)) {
            return { ok: false, reason: '请先停止当前持续升级项目' };
        }
        const pending = { kind: 'ability', abilityId };
        const occupied = isBuildingUpgradeProgressOccupied(this, pending, Game?.entities)
            || hasBackgroundBuildingUpgrade(pending);
        if (occupied) return { ok: false, reason: '该全局能力正在其他建筑或后台位面中升级' };
        const cost = this.getAbilityCost(abilityId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        this._upgrade = { ...pending, totalMs: cost.timeMs, remainMs: cost.timeMs };
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, abilityId };
    }

    /**
     * 同类别建筑只允许一个持续项目。开启后即使暂时资源不足也保留目标，
     * 主循环每秒重新判定科技、全局占用和支付条件，满足后自动开始下一档。
     */
    setContinuousUpgrade(target) {
        const normalized = normalizeBuildingContinuousTarget(target);
        if (!normalized) return { ok: false, reason: '未知持续升级项目' };
        const projectId = normalized.kind === 'ability' ? normalized.abilityId : normalized.moduleId;
        const unitType = normalized.kind === 'module' ? normalized.unitType : null;
        if (this.isContinuousUpgrade(normalized.kind, projectId, unitType)) {
            this._continuous = null;
            this._continuousRetryMs = 0;
            return { ok: true, stopped: true };
        }
        if (this._upgrade) return { ok: false, reason: '当前项目完成后才能切换持续升级' };
        if (isBuildingContinuousUpgradeOccupied(this, Game?.entities)
            || hasBackgroundContinuousUpgrade(getBuildingContinuousCategory(this))) {
            return { ok: false, reason: '同类别建筑已有一个持续升级项目' };
        }
        if (normalized.kind === 'ability') {
            if (!this.getAbility(normalized.abilityId)) return { ok: false, reason: '未知能力' };
            if (!this.canUpgradeAbility(normalized.abilityId)) return { ok: false, reason: '能力已满级' };
        } else {
            const kinds = this.moduleUnitTypes(normalized.moduleId, normalized.unitType);
            if (!kinds.length) return { ok: false, reason: '该模块不适用于当前建筑兵种' };
            normalized.unitType = kinds[0];
            normalized.unitTypes = kinds;
            if (!this.canUpgradeModule(normalized.moduleId, normalized.unitType)) {
                return { ok: false, reason: '模块已满级' };
            }
        }
        this._continuous = normalized;
        this._continuousRetryMs = 0;
        const result = this._tryStartContinuousUpgrade();
        return result.ok ? { ...result, continuous: true } : {
            ok: true, continuous: true, waiting: true, waitReason: result.reason,
        };
    }

    _tryStartContinuousUpgrade() {
        const target = normalizeBuildingContinuousTarget(this._continuous);
        if (!target) return { ok: false, reason: '持续升级目标已失效', permanent: true };
        if (target.kind === 'ability') {
            if (!this.getAbility(target.abilityId) || !this.canUpgradeAbility(target.abilityId)) {
                return { ok: false, reason: '能力已满级或已失效', permanent: true };
            }
            return this.startAbilityUpgrade(target.abilityId, false, { fromContinuous: true });
        }
        const kinds = this.moduleUnitTypes(target.moduleId, target.unitType);
        if (!kinds.length || !this.canUpgradeModule(target.moduleId, kinds[0])) {
            return { ok: false, reason: '模块已满级或已失效', permanent: true };
        }
        return this.startModuleUpgrade(target.moduleId, kinds[0], { fromContinuous: true });
    }

    _updateContinuousUpgrade(dt) {
        if (!this._continuous || this._upgrade) return;
        this._continuousRetryMs = Math.max(0, (Number(this._continuousRetryMs) || 0) - dt);
        if (this._continuousRetryMs > 0) return;
        const result = this._tryStartContinuousUpgrade();
        if (result.permanent) {
            this._continuous = null;
            this._continuousRetryMs = 0;
        } else if (!result.ok) {
            this._continuousRetryMs = 1000;
        }
        if ((result.ok || result.permanent) && ProducerBuildingSystem?._panel?.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.refresh();
        }
    }

    /** 推进能力/模块升级读条；完成后统一结算全局等级。 */
    _updateUpgrade(dt) {
        if (!this._upgrade) {
            this._updateContinuousUpgrade(dt);
            return;
        }
        this._upgrade.remainMs -= dt;
        if (this._upgrade.remainMs > 0) return;
        const completed = this._upgrade;
        this._upgrade = null;
        if (completed.moduleId) {
            const { moduleId, unitType } = completed;
            const mod = this._cfg.modules?.[moduleId];
            const unitTypes = Array.isArray(completed.unitTypes) && completed.unitTypes.length
                ? completed.unitTypes
                : [unitType];
            const level = unitTypes.length > 1 || this._sharedUnitUpgrades
                ? raiseSharedUnitUpgradeLevel(unitTypes, moduleId, mod?.maxLevel)
                : raiseUnitUpgradeLevel(unitType, moduleId);
            for (const kind of unitTypes) applyGlobalUpgradesToKind(kind, this._cfg.modules);
            if (mod && EffectManager) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${mod.name} Lv.${level}`, '#8ad0ff'));
            }
            if (ProducerBuildingSystem?._panel?.isOpen
                && ProducerBuildingSystem._panel.building === this) {
                ProducerBuildingSystem._panel.refresh();
            }
            this._continuousRetryMs = 0;
            this._updateContinuousUpgrade(0);
            return;
        }
        const { abilityId } = completed;
        const a = this.getAbility(abilityId);
        const previousLevel = getAbilityLevel(abilityId);
        const level = raiseAbilityLevel(abilityId, a?.maxLevel ?? 10);
        if (level > previousLevel) ResearchSystem.onResearchLeveled(abilityId);
        if (a && EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${a.name} Lv.${level}`, '#c9a0ff'));
        }
        // 完成后面板立即刷新（否则进度条停在最后一次 100ms tick 的 99%，2026-08-17 用户反馈）
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.refresh();
        }
        // 持续升级不因暂时资源不足而取消；立即尝试，失败后进入每秒轮询。
        this._continuousRetryMs = 0;
        this._updateContinuousUpgrade(0);
    }

    /** 开始兵种模块升级：开始时扣资源，读条完成后才提升等级并同步单位。 */
    startModuleUpgrade(moduleId, unitType = this.unitType, options = {}) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!(this._cfg.unitTypes || []).some((unit) => unit.key === unitType)) {
            return { ok: false, reason: '未知兵种' };
        }
        const unitTypes = this.moduleUnitTypes(moduleId, unitType);
        if (!unitTypes.length) return { ok: false, reason: '当前兵种不适用该模块' };
        if (!this.canUpgradeModule(moduleId, unitType)) return { ok: false, reason: '模块已满级' };
        if (this._upgrade) return { ok: false, reason: '已有升级在读条中' };
        if (!options.fromContinuous && this._continuous
            && !this.isContinuousUpgrade('module', moduleId, unitType)) {
            return { ok: false, reason: '请先停止当前持续升级项目' };
        }
        const cost = this.getModuleCost(moduleId, unitType);
        if (!cost) return { ok: false, reason: '升级费用配置缺失' };
        const pending = { kind: 'module', moduleId, unitType: unitTypes[0], unitTypes };
        if (isBuildingUpgradeProgressOccupied(this, pending, Game?.entities)
            || hasBackgroundBuildingUpgrade(pending)) {
            return { ok: false, reason: '该升级项目正在其他建筑或后台位面中升级' };
        }
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        this._upgrade = { ...pending, totalMs: cost.timeMs, remainMs: cost.timeMs };
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId, unitType: unitTypes[0], unitTypes };
    }

    upgradeModule(moduleId, _player, unitType = this.unitType) {
        return this.startModuleUpgrade(moduleId, unitType);
    }

    /** 主循环：按当前兵种生产周期生成一个军事单位（存活数低于上限时）；
     *  周期 = 兵种配置 spawnIntervalMs（缺省建筑级）再经研究院快速募兵缩放（2026-08-18） */
    recruitIntervalMs(kind = this.unitType) {
        const base = this._unitSpawnIntervalMs(kind);
        return ResearchSystem.getRecruitIntervalMs
            ? ResearchSystem.getRecruitIntervalMs(base)
            : base;
    }

    update(dt) {
        if (!this.active) return;
        skipBuildingUpgradeWait(this);
        this._updateUpgrade(dt);
        WarehouseEconomySystem.updateBuilding(this, dt);
        TavernEconomySystem.updateBuilding(this, dt, PopulationEconomySystem.getLaborEfficiency());
        HamsterBartenderVisualSystem.updateBuilding(this);
        BankEconomySystem.updateBuilding(this, dt);
        GrandMallEconomySystem.updateBuilding(this, dt);
        PopulationEconomySystem.updateBuilding(this, dt);
        BakeryEconomySystem.updateBuilding(this, dt);
        HamsterBakerVisualSystem.updateBuilding(this);
        CheeseFarmSystem.updateBuilding(this, dt);
        HamsterCowherdVisualSystem.updateBuilding(this);
        HolsteinCowVisualSystem.updateBuilding(this, dt);
        SteamPowerPlantSystem.updateBuilding(this, dt);
        DeepDrillSystem.updateBuilding(this, dt);
        HamsterBoilerWorkerVisualSystem.updateBuilding(this);
        HamsterFarmerVisualSystem.updateBuilding(this, dt);
        WorkshopEconomySystem.updateBuilding(this, dt);
        ArmoryEconomySystem.updateBuilding(this, dt);
        FieldHospitalSystem.updateBuilding(this, dt);
        ArmoryMaintainerVisualSystem.updateBuilding(this, dt);
        HamsterBankerVisualSystem.updateBuilding(this, dt);
        HouseResidentVisualSystem.updateBuilding(this, dt);
        CandleSanctuarySystem.updateBuilding(this, dt);
        WeatherForecastTowerSystem.updateBuilding(this, dt);
        if (!this.spawnEnabled) return;
        if (this._parallelProduction) {
            this._updateParallelProduction(dt);
            return;
        }
        const restoring = (this._restoreRosterQueue?.length || 0) > 0 || this._restoreTopUp > 0;
        if (!restoring && this._recruitMode === RECRUIT_MODE.PAUSED) return;
        if (!restoring && isInstantTroopProductionEnabled()) this._spawnTimer = 0;
        if (!restoring && isMilitaryPopulationIgnored() && this._spawnPopulationBlocked) {
            this._spawnPopulationBlocked = false;
            this._spawnRetryTimer = 0;
        }
        if (this.aliveUnitCount() < this.unitCount()) {
            this._spawnTimer = Math.max(0, this._spawnTimer - dt);
            if (this._spawnTimer <= 0) {
                this._spawnRetryTimer -= dt;
                if (this._spawnRetryTimer > 0) return;
                let unit;
                const populationWasBlocked = this._spawnPopulationBlocked;
                if (Array.isArray(this._restoreRosterQueue) && this._restoreRosterQueue.length > 0) {
                    const selectedType = this.unitType;
                    this.unitType = this._restoreRosterQueue[0];
                    unit = this.spawnUnit(false, { restoring: true });
                    this.unitType = selectedType;
                    if (unit) this._restoreRosterQueue.shift();
                } else {
                    unit = this.spawnUnit(!restoring, { restoring });
                }
                if (unit) {
                    // 快照恢复补员（_restoreTopUp>0）：绕过完整产兵周期快速补齐，800ms/个
                    this._spawnTimer = restoring ? 800 : this.recruitIntervalMs();
                    if (this._restoreTopUp > 0) this._restoreTopUp--;
                    this._spawnRetryTimer = 0;
                    this._spawnBlocked = false;
                    this._spawnFoodBlocked = false;
                    this._spawnPopulationBlocked = false;
                    if (!restoring && this._recruitMode === RECRUIT_MODE.SINGLE) {
                        this._recruitMode = RECRUIT_MODE.PAUSED;
                        scheduleFriendlyAssetResidencyRefresh();
                    }
                } else if (this._spawnPopulationBlocked) {
                    this._spawnTimer = 0;
                    this._spawnRetryTimer = 1000;
                    this._spawnBlocked = false;
                    this._spawnFoodBlocked = false;
                    if (!populationWasBlocked && EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - 66,
                            '军事人口已满，请建造或升级房屋', '#c7a7ff'));
                    }
                } else if (this._spawnFoodBlocked) {
                    this._spawnTimer = 0;
                    this._spawnRetryTimer = 1000;
                    this._spawnBlocked = false;
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - 66,
                            `粮食不足，生产暂停（需 ${this._unitSpawnFoodCost()}）`, '#ffcc55'));
                    }
                } else {
                    this._spawnTimer = 0;
                    this._spawnRetryTimer = SpawnPlacement.retryMs;
                    if (!this._spawnBlocked && EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - 66, '出口被阻挡，等待空位', '#ff8855'));
                    }
                    this._spawnBlocked = true;
                }
                if (unit && EffectManager) {
                    const name = this.unitName(this.unitType);
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${name} 报到！`, '#8ad0ff'));
                }
            }
        } else {
            this._spawnTimer = this.recruitIntervalMs();
            this._spawnRetryTimer = 0;
            this._spawnBlocked = false;
            this._spawnFoodBlocked = false;
            this._spawnPopulationBlocked = false;
        }
    }

    _updateParallelProduction(dt) {
        for (const [kind, queue] of Object.entries(this._parallelQueues || {})) {
            const restoring = Array.isArray(this._restoreRosterQueue)
                && this._restoreRosterQueue.includes(kind);
            if (!restoring && normalizeRecruitMode(queue.recruitMode) === RECRUIT_MODE.PAUSED) continue;
            if (!restoring && isInstantTroopProductionEnabled()) queue.timer = 0;
            if (!restoring && isMilitaryPopulationIgnored() && queue.populationBlocked) {
                queue.populationBlocked = false;
                queue.retryTimer = 0;
            }
            if (this.aliveUnitCount(kind) >= this.parallelUnitCap(kind)) {
                queue.timer = this.recruitIntervalMs(kind);
                queue.retryTimer = 0; queue.blocked = false; queue.foodBlocked = false;
                queue.populationBlocked = false;
                continue;
            }
            queue.timer = Math.max(0, queue.timer - dt);
            if (queue.timer > 0) continue;
            queue.retryTimer -= dt;
            if (queue.retryTimer > 0) continue;
            this._spawnFoodBlocked = false;
            const unit = this.spawnUnitFor(kind, !restoring, { restoring });
            queue.foodBlocked = !!this._spawnFoodBlocked;
            queue.populationBlocked = !!this._spawnPopulationBlocked;
            if (unit) {
                queue.timer = restoring ? 800 : this.recruitIntervalMs(kind);
                queue.retryTimer = 0; queue.blocked = false; queue.foodBlocked = false;
                queue.populationBlocked = false;
                if (restoring) {
                    const index = this._restoreRosterQueue.indexOf(kind);
                    if (index >= 0) this._restoreRosterQueue.splice(index, 1);
                } else if (normalizeRecruitMode(queue.recruitMode) === RECRUIT_MODE.SINGLE) {
                    queue.recruitMode = RECRUIT_MODE.PAUSED;
                    scheduleFriendlyAssetResidencyRefresh();
                }
                EffectManager?.add?.(new FloatingTextEffect(this.x, this.y - 56, `${this.unitName(kind)} 报到！`, '#8ad0ff'));
            } else {
                queue.timer = 0;
                queue.retryTimer = (queue.foodBlocked || queue.populationBlocked)
                    ? 1000 : SpawnPlacement.retryMs;
                queue.blocked = !queue.foodBlocked && !queue.populationBlocked;
            }
        }
    }

    /**
     * 城墙材质科技同时替换塔楼贴图与数值。逻辑占地始终保持2×2，
     * 不让科技换肤改变碰撞、寻路或墙顶节点。
     */
    refreshWallTowerTier({ preserveHealthRatio = true } = {}) {
        if (!this._isWallTower || !this._wallTowerBaseVisual || !this._wallTowerBaseStats) {
            return false;
        }
        const targetLevel = Math.max(1, Number(TechnologySystem.getWallVisualTier()?.level) || 1);
        const tier = (this._cfg.buildingTiers || [])
            .filter((candidate) => Math.max(1, Number(candidate?.level) || 1) <= targetLevel)
            .sort((left, right) => Number(right.level) - Number(left.level))[0] || {};
        const visual = {
            ...this._wallTowerBaseVisual,
            ...(tier.visual || {}),
        };
        const nextTexture = visual.tex || this._wallTowerBaseVisual.tex;
        const previousTexture = this.spriteCfg.idleKey;
        const previousMaxHp = Math.max(1, Number(this.maxHp) || 1);
        const healthRatio = preserveHealthRatio
            ? Math.max(0, Math.min(1, (Number(this.hp) || 0) / previousMaxHp))
            : 1;
        const nextMaxHp = Math.max(1, Number(tier.hp) || this._wallTowerBaseStats.hp);
        const nextName = tier.name || this._wallTowerBaseStats.name;
        const nextForeground = visual.foregroundOverlay
            ? { ...visual.foregroundOverlay }
            : null;
        const changed = previousTexture !== nextTexture
            || this.name !== nextName
            || this.maxHp !== nextMaxHp
            || this.def !== (Number(tier.def) || this._wallTowerBaseStats.def)
            || this.mdef !== (Number(tier.mdef) || this._wallTowerBaseStats.mdef);

        this.level = Math.max(1, Number(tier.level) || 1);
        this.name = nextName;
        this._cfg.name = nextName;
        this.spriteCfg.idleKey = nextTexture;
        this.spriteCfg.size = Number(visual.displayW) || this._wallTowerBaseVisual.displayW;
        this.spriteCfg.sizeH = Number(visual.displayH) || this._wallTowerBaseVisual.displayH;
        this.spriteCfg.footOffsetY = Number(visual.footOffsetY)
            || this._wallTowerBaseVisual.footOffsetY;
        this.spriteCfg.foregroundOverlay = nextForeground;
        this._cfg.foregroundOverlay = nextForeground;
        this.footOffsetY = this.spriteCfg.footOffsetY;
        this.maxHp = nextMaxHp;
        this.hp = Math.max(0, Math.min(nextMaxHp, Math.round(nextMaxHp * healthRatio)));
        this.def = Math.max(0, Number(tier.def) || this._wallTowerBaseStats.def);
        this.mdef = Math.max(0, Number(tier.mdef) || this._wallTowerBaseStats.mdef);
        if (changed) {
            delete this._structureVisualFitKey;
            delete this._structureVisualFit;
            RuntimeAssetManager.transitionBuildingVisual(previousTexture, nextTexture, this.cfgKey);
        }
        return changed;
    }

    /**
     * 城墙塔仍由 ProducerBuilding 负责生命值/建造/换肤，但高架导航按四个标准墙格展开。
     * 节点不进入 Game.entities，避免重复渲染、受击和建筑碰撞；DefenseSystem 的统一
     * ElevatedTopology 会从塔楼实体展开这些节点。
     */
    refreshWallTowerWalkNodes() {
        if (!this._isWallTower || this._wallTowerWalk?.enabled === false) {
            this._wallTowerWalkNodes = [];
            return this._wallTowerWalkNodes;
        }
        const topZ = Math.max(1, Number(this._wallTowerWalk?.topZ) || 250);
        const cells = buildingRoadLayout(
            this.x,
            this.y,
            Number(this._cfg?.footprintCells) || 2
        ).buildingCells;
        const previous = Array.isArray(this._wallTowerWalkNodes)
            ? this._wallTowerWalkNodes
            : [];
        this._wallTowerWalkNodes = cells.map((cell, index) => {
            const owner = this;
            const node = previous[index] || {
                id: `${this.id}:wall-top:${index}`,
                _isWalkableWall: true,
                _isBlockCover: true,
                _isWallTower: true,
                _wallTowerOwner: owner,
                get active() {
                    return owner.active !== false && !owner._sinking;
                },
                get _sinking() {
                    return !!owner._sinking;
                },
                get _faceDepth() {
                    return Number(owner._structureRenderDepth)
                        || Number(owner._surfaceRenderDepth)
                        || Number(owner._structureFrontDepth)
                        || 0;
                },
            };
            node.id = `${this.id}:wall-top:${index}`;
            const nextX = Number(cell.x) || 0;
            const nextY = Number(cell.y) || 0;
            const geometryChanged = node.x !== nextX
                || node.y !== nextY
                || node._wallTopZ !== topZ;
            node.x = nextX;
            node.y = nextY;
            node._wallTopZ = topZ;
            node._wallTowerTopVision = this._wallTowerTopVision;
            if (geometryChanged || !Array.isArray(node._faceLine)) {
                node._faceLine = [
                    { x: node.x - 32, y: node.y - 16 },
                    { x: node.x + 32, y: node.y + 16 },
                ];
                delete node._wallTopWalkGeometry;
                delete node._wallTopConnectorCache;
            }
            return node;
        });
        return this._wallTowerWalkNodes;
    }

    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        Game?.DefenseSystem?.invalidateElevatedTopology?.();
        this._destroyCleanup();
        if (EffectManager) {
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 建筑专属清理（单位/列表/面板）；实体失效与移除由 BuildingSinkEffect 负责 */
    _destroyCleanup() {
        this._upgrade = null;
        this._continuous = null;
        this._weatherUpgrade = null;
        this._mintUpgrade = null;
        HamsterFarmerVisualSystem.clearBuilding(this);
        HamsterBankerVisualSystem.clearBuilding(this);
        HamsterBakerVisualSystem.clearBuilding(this);
        HamsterCowherdVisualSystem.clearBuilding(this);
        HolsteinCowVisualSystem.clearBuilding(this);
        HamsterBoilerWorkerVisualSystem.clearBuilding(this);
        ArmoryMaintainerVisualSystem.clearBuilding(this);
        HouseResidentVisualSystem.clearBuilding(this);
        BankEconomySystem.unregisterBuilding(this);
        GrandMallEconomySystem.unregisterBuilding(this);
        BakeryEconomySystem.unregisterBuilding(this);
        CheeseFarmSystem.unregisterBuilding(this);
        SteamPowerPlantSystem.unregisterBuilding(this);
        DeepDrillSystem.unregisterBuilding(this);
        TavernEconomySystem.unregisterBuilding(this);
        HamsterBartenderVisualSystem.clearBuilding(this);
        WorkshopEconomySystem.unregisterBuilding(this);
        ArmoryEconomySystem.unregisterBuilding(this);
        FieldHospitalSystem.unregisterBuilding(this);
        WarehouseEconomySystem.unregisterBuilding(this);
        PopulationEconomySystem.unregisterBuilding(this);
        CandleSanctuarySystem.unregisterBuilding(this);
        TroopLineSystem.clearProducerRally(this);
        World122TributeSystem.detachAltar(this);
        this._despawnUnits();
        if (this._isEnergyWarehouse && EnergyManager) {
            const lostFood = Math.max(0, Math.floor(Number(this.storedFood) || 0));
            const lost = EnergyManager.unregisterWarehouse(this);
            if ((lost > 0 || lostFood > 0) && EffectManager) {
                const losses = [lost > 0 ? `${lost} 能源` : '', lostFood > 0 ? `${lostFood} 粮食` : '']
                    .filter(Boolean).join('、');
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 62, `仓库被毁，损失 ${losses}`, '#ff5555'));
            }
        }
        if (ProducerBuildingSystem && ProducerBuildingSystem.buildings) {
            const i = ProducerBuildingSystem.buildings.indexOf(this);
            if (i >= 0) ProducerBuildingSystem.buildings.splice(i, 1);
        }
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.close();
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, `${this._cfg.name}被摧毁`, '#ff8855'));
        }
    }

    _despawnUnits() {
        for (const u of this.units) {
            if (!u) continue;
            u.active = false;
            if (Game && Game.entities && u.id) Game.entities.delete(u.id);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(u);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
        }
        this.units = [];
    }

    /** 出售：返还 50% 建造能源，单位一并拆除 */
    sell() {
        if (this._isWorldPortalCore || this._isMainHubPortalBuilding) {
            return { ok: false, reason: '世界核心传送门不可出售' };
        }
        if (this._isEnergyWarehouse && ((this.storedEnergy || 0) > 0 || (this.storedFood || 0) > 0)) {
            return { ok: false, reason: '仓库中仍有能源或粮食，无法出售' };
        }
        const buildCost = Math.max(0, Number(this._buildCost ?? this._cfg.cost) || 0);
        const buildCurrency = this._buildCurrency || (this._cfg.currency === 'gold' ? 'gold' : 'energy');
        const durability = Math.max(0, Math.min(1, Number(this.hp) / Math.max(1, Number(this.maxHp) || 1)));
        const refund = Math.floor(buildCost * (this._cfg.sellRefundRatio ?? 0.5) * durability);
        if (buildCurrency !== 'gold' && (!EnergyManager || !EnergyManager.canStore(refund))) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        this.hittable = false;
        this._sinking = true;
        this._upgrade = null;
        this._continuous = null;
        this._weatherUpgrade = null;
        HamsterFarmerVisualSystem.clearBuilding(this);
        HamsterBankerVisualSystem.clearBuilding(this);
        HamsterBakerVisualSystem.clearBuilding(this);
        HamsterCowherdVisualSystem.clearBuilding(this);
        HolsteinCowVisualSystem.clearBuilding(this);
        HamsterBoilerWorkerVisualSystem.clearBuilding(this);
        HamsterBartenderVisualSystem.clearBuilding(this);
        ArmoryMaintainerVisualSystem.clearBuilding(this);
        HouseResidentVisualSystem.clearBuilding(this);
        BankEconomySystem.unregisterBuilding(this);
        GrandMallEconomySystem.unregisterBuilding(this);
        BakeryEconomySystem.unregisterBuilding(this);
        CheeseFarmSystem.unregisterBuilding(this);
        SteamPowerPlantSystem.unregisterBuilding(this);
        DeepDrillSystem.unregisterBuilding(this);
        TavernEconomySystem.unregisterBuilding(this);
        WorkshopEconomySystem.unregisterBuilding(this);
        ArmoryEconomySystem.unregisterBuilding(this);
        FieldHospitalSystem.unregisterBuilding(this);
        WarehouseEconomySystem.unregisterBuilding(this);
        PopulationEconomySystem.unregisterBuilding(this);
        CandleSanctuarySystem.unregisterBuilding(this);
        TroopLineSystem.clearProducerRally(this);
        World122TributeSystem.detachAltar(this);
        this._despawnUnits();
        if (this._isEnergyWarehouse && EnergyManager) EnergyManager.unregisterWarehouse(this);
        if (ProducerBuildingSystem && ProducerBuildingSystem.buildings) {
            const i = ProducerBuildingSystem.buildings.indexOf(this);
            if (i >= 0) ProducerBuildingSystem.buildings.splice(i, 1);
        }
        if (buildCurrency === 'gold') {
            if (GoldManager) GoldManager.addGold(refund);
        } else if (EnergyManager) {
            EnergyManager.addEnergy(refund);
        }
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.close();
        }
        if (EffectManager) EffectManager.add(new BuildingSinkEffect(this).start());
        return { ok: true, refund };
    }
}

// ==================== 产兵建筑面板 ====================

class ProducerBuildingPanel extends BasePanel {
    constructor() {
        super({
            id: 'producerBuildingPanel',
            className: 'producer-building-panel bp-right-column',
            stateKey: 'producerBuilding',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            shouldCloseOnOutsidePointer: (event) =>
                !window.Game?.BuildingSystem?._eventHitsBuilding?.(event),
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        this.building = null;
        this.player = null;
        this._tickTimer = null;   // 出兵进度实时刷新定时器（100ms）
    }

    buildContent(el) {
        el.style.cssText = [
            'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:400px;',
            'max-height:88vh;overflow-y:auto;',
            'background:rgba(16,15,13,0.97);border:2px solid #6a5a3a;border-radius:10px;',
            'padding:16px 18px;color:#d4c5a9;font-family:SimHei,"Microsoft YaHei",sans-serif;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
        ].join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div id="pbTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="pbPackedRebuild" type="button" style="display:none;background:#263b34;color:#a8ffd7;border:1px solid #4f8a72;border-radius:6px;padding:4px 10px;cursor:var(--bp-cursor-pointer, pointer);">打包重建</button>
                    <button id="pbSell" type="button" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:var(--bp-cursor-pointer, pointer);">出售</button>
                    <button id="pbClose" type="button" aria-label="关闭建筑详情" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:var(--bp-cursor-pointer, pointer);">关闭</button>
                </div>
            </div>
            <div id="pbBuildingDetail"></div>
            <div id="pbFunctionTitle" class="troop-panel-section-title" style="margin:2px 0 6px;"></div>
            <div id="pbStatus" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(60,50,20,0.18);"></div>
            ${renderProducerRallySection()}
            <div id="pbUnitType" style="border:1px solid #3a6a5a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(20,50,40,0.18);"></div>
            <div id="pbModules" style="border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
        `;
        // 升级说明浮窗：研究/能力与出兵模块共用，独立挂在 document.body，
        // 避免被面板 overflow 裁剪或撑出滚动条。
        ensureBuildingUpgradeTooltip();
        el.querySelector('#pbClose').addEventListener('click', () => this.close());
    }

    openFor(building, player) {
        BankEconomySystem.hideRange();
        GrandMallEconomySystem.hideRange();
        WorkshopEconomySystem.hideRange();
        ArmoryEconomySystem.hideRange();
        FieldHospitalSystem.hideRange();
        CandleSanctuarySystem.hideRange();
        this.building = building;
        this.player = player;
        this.open();
        if (building?._economyType === 'bank') BankEconomySystem.showRange(building);
        if (building?._economyType === 'grand_mall') GrandMallEconomySystem.showRange(building);
        if (building?._economyType === 'workshop') WorkshopEconomySystem.showRange(building);
        if (building?._economyType === 'armory') ArmoryEconomySystem.showRange(building);
        if (building?._economyType === 'field_hospital') FieldHospitalSystem.showRange(building);
        if (building?._isWorld125Candle) CandleSanctuarySystem.showRange(building);
        this.refresh();
        this._startTicking();
    }

    onOpen() {
        this.refresh();
        this._startTicking();
    }

    onClose() {
        this._stopTicking();
        this._hideAbilityTip();
        releaseLightweightProjectImages(this.el);
        this.el?.classList.remove('is-troop-producer');
        this.el?.classList.remove('is-economy-building');
        BankEconomySystem.hideRange();
        GrandMallEconomySystem.hideRange();
        WorkshopEconomySystem.hideRange();
        ArmoryEconomySystem.hideRange();
        FieldHospitalSystem.hideRange();
        CandleSanctuarySystem.hideRange();
        this.building = null;
        this.player = null;
    }

    /** 打开期间每 100ms 实时刷新出兵进度（只更新进度条，不重建 DOM） */
    _startTicking() {
        this._stopTicking();
        this._tickTimer = setInterval(() => this._tickProgress(), 100);
    }

    _stopTicking() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
    }

    /** 只更新进度条宽度/百分比/剩余秒数——配合 CSS transition 形成平滑增长效果 */
    _tickProgress() {
        const el = this.el;
        if (!el || !this.building) return;
        const b = this.building;
        refreshProducerRallySection(el, b, SceneManager.currentScene);
        if (b._isTroopProducer) {
            const military = PopulationEconomySystem.getMilitaryPopulationSnapshot();
            const militaryEl = el.querySelector('#pbMilitaryPopulation');
            if (militaryEl) militaryEl.textContent = `${military.used}/${military.capacity}`;
        }
        if (b.cfgKey === WEATHER_FORECAST_TOWER_ID) {
            const upgrade = b._weatherUpgrade;
            if (upgrade) {
                const pct = Math.max(0, Math.min(100,
                    Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                if (bar) bar.style.width = `${pct}%`;
                if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
            } else if (el.querySelector('[data-weather-upgrading="true"]')) {
                this.refresh();
            }
            if (!b._economyType) return;
        }
        if (b._isWorld125Candle) {
            const range = CandleSanctuarySystem.getLightRange(b);
            const rangeEl = el.querySelector('#pbCandleRange');
            if (rangeEl) rangeEl.textContent = `${Math.round(range)}px`;
            const upgrade = b._candleUpgrade;
            if (upgrade) {
                const pct = Math.max(0, Math.min(100,
                    Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                if (bar) bar.style.width = `${pct}%`;
                if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
            } else if (el.querySelector('[data-candle-upgrading="true"]')) {
                this.refresh();
            }
            return;
        }
        // 仓库同时声明 economyType 与 workshopType；必须让它落到下方仓库专用分支，
        // 否则等级/本栋升级瞬间结算后，通用经济分支会提前 return，按钮只能重开面板才刷新。
        if (b._economyType && !b._isEnergyWarehouse) {
            const population = PopulationEconomySystem.getPopulationSnapshot();
            const workforce = PopulationEconomySystem.getWorkerSnapshot(b);
            const populationEl = el.querySelector('#pbEconomyPopulation');
            const workersEl = el.querySelector('#pbEconomyWorkers');
            if (populationEl) {
                populationEl.textContent = `${population.used}/${population.capacity} · 空余 ${population.free}`
                    + (population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : '');
            }
            if (workersEl && workforce) {
                workersEl.textContent = `${workforce.assigned}/${workforce.slots} · 人口效率 ${Math.round(workforce.laborEfficiency * 100)}%`;
                el.querySelectorAll('[data-worker-delta]').forEach((button) => {
                    const delta = Number(button.dataset.workerDelta) || 0;
                    button.disabled = delta < 0
                        ? workforce.assigned <= 0
                        : (workforce.freeSlots <= 0 || population.free <= 0);
                });
                const maxButton = el.querySelector('[data-worker-max]');
                if (maxButton) maxButton.disabled = workforce.freeSlots <= 0 || population.free <= 0;
            }
            if (workforce) {
                const workforcePct = workforce.slots > 0
                    ? Math.round(workforce.assigned / workforce.slots * 100)
                    : 0;
                const workforceBar = el.querySelector('#pbEconomyWorkforceBar');
                const workforcePctEl = el.querySelector('#pbEconomyWorkforcePct');
                if (workforceBar) workforceBar.style.width = `${workforcePct}%`;
                if (workforcePctEl) workforcePctEl.textContent = `${workforcePct}%`;
            }
            const secondaryProgress = this._getEconomySecondaryProgress(b, workforce);
            const productionBar = el.querySelector('#pbEconomyProductionBar');
            const productionPctEl = el.querySelector('#pbEconomyProductionPct');
            if (productionBar) productionBar.style.width = `${secondaryProgress.pct}%`;
            if (productionPctEl) productionPctEl.textContent = secondaryProgress.text;
            if (b._economyType === 'weather_forecast') {
                const snapshot = PopulationEconomySystem.getWeatherForecastResearchSnapshot(b);
                const operational = WeatherForecastTowerSystem.isOperational(b);
                const forecastEvents = operational && typeof window !== 'undefined'
                    ? (window.WorldWeatherSystem?.getForecastEvents?.() || [])
                        .filter((event) => event.sceneId === SceneManager.currentScene)
                    : [];
                const forecastSignature = forecastEvents
                    .map((event) => `${event.id}:${event.status}:${event.endsAtGameTimeMs || ''}`)
                    .join('|');
                if (forecastSignature !== (this._weatherForecastSignature || '')) {
                    this.refresh();
                    return;
                }
                const values = {
                    pbWeatherStatus: operational ? '正在监测本位面' : '等待气象员上岗',
                    pbWeatherStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbWeatherResearchConfigured: `${snapshot.configuredResearchPointsPerSecond.toFixed(2)} 点/秒`,
                    pbWeatherResearchActual: `${snapshot.actualResearchPointsPerSecond.toFixed(2)} 点/秒`,
                    pbWeatherWorkshop: `+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                    pbWeatherCluster: `+${Math.round(snapshot.clusterBonus * 100)}% · ${snapshot.clusterFacilityTypes.length}种`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                el.querySelector('#pbWeatherStatus')?.classList.toggle('is-blocked', !operational);
                const nowGameTimeMs = Math.max(0,
                    Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
                const dayDurationMs = Math.max(1,
                    Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
                el.querySelectorAll('[data-weather-future-time]').forEach((node) => {
                    const leadDays = Math.max(0,
                        (Number(node.dataset.weatherFutureTime) - nowGameTimeMs) / dayDurationMs);
                    const stateText = node.dataset.weatherActive === 'true'
                        ? '进行中' : `${leadDays.toFixed(2)} 天后`;
                    const detail = node.dataset.weatherDetail || '';
                    node.textContent = `${stateText}${detail ? ` · ${detail}` : ''}`;
                });
            } else if (b._economyType === 'advanced_research') {
                const snapshot = PopulationEconomySystem.getAdvancedResearchSnapshot(b);
                const operating = snapshot.actualResearchPointsPerSecond > 0;
                const values = {
                    pbAdvancedResearchStatus: operating
                        ? '正在积累科研点'
                        : (snapshot.staffedCount <= 0 ? '等待科研人员上岗' : '人口容量不足'),
                    pbAdvancedResearchConfigured: `${snapshot.configuredResearchPointsPerSecond.toFixed(2)} 点/秒`,
                    pbAdvancedResearchStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbAdvancedResearchActual: `${snapshot.actualResearchPointsPerSecond.toFixed(2)} 点/秒`,
                    pbAdvancedResearchCluster: `+${Math.round(snapshot.clusterBonus * 100)}% · ${snapshot.clusterFacilityTypes.length}种`,
                    pbAdvancedResearchWorkshop: `+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                el.querySelector('#pbAdvancedResearchStatus')?.classList.toggle('is-blocked', !operating);
            } else if (b._economyType === 'research') {
                const snapshot = PopulationEconomySystem.getResearchSnapshot(b);
                const operating = snapshot.actualResearchPointsPerSecond > 0;
                const values = {
                    pbResearchStatus: operating
                        ? '正在积累科研点'
                        : (snapshot.staffedCount <= 0 ? '等待研究员上岗' : '人口容量不足'),
                    pbResearchLevelBase: `${snapshot.levelBaseResearchPoints.toFixed(2)} 点/秒`,
                    pbResearchEquipmentBonus: `+${snapshot.equipmentBonus.toFixed(2)} 点/秒`,
                    pbResearchStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbResearchConfigured: `${snapshot.configuredResearchPointsPerSecond.toFixed(2)} 点/秒`,
                    pbResearchActual: `${snapshot.actualResearchPointsPerSecond.toFixed(2)} 点/秒`,
                    pbResearchWorkshop: `+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                    pbResearchCluster: `+${Math.round(snapshot.clusterBonus * 100)}% · ${snapshot.clusterFacilityTypes.length}种`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                el.querySelector('#pbResearchStatus')?.classList.toggle('is-blocked', !operating);
                const levelUpgrade = b._economyUpgrade;
                if (levelUpgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - levelUpgrade.remainMs / levelUpgrade.totalMs) * 100)));
                    const bar = el.querySelector('#pbUpgradeBar_research_institute_level');
                    const text = el.querySelector('#pbUpgradeText_research_institute_level');
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(levelUpgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-research-level-upgrading="true"]')) {
                    this.refresh();
                }
                const localUpgrade = b._researchUpgrade;
                if (localUpgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - localUpgrade.remainMs / localUpgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${localUpgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${localUpgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(localUpgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-research-local-upgrading="true"]')) {
                    this.refresh();
                    return;
                }
                if (b._upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)));
                    const projectId = b._upgrade.abilityId || b._upgrade.moduleId;
                    const bar = el.querySelector(`#pbUpgradeBar_${projectId}`);
                    const text = el.querySelector(`#pbUpgradeText_${projectId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(b._upgrade.remainMs / 1000)}s）`;
                }
            } else if (b._economyType === 'wind_power_plant'
                || b._economyType === 'solar_power_plant') {
                const isSolar = b._economyType === 'solar_power_plant';
                const snapshot = isSolar
                    ? PopulationEconomySystem.getSolarPowerSnapshot(b)
                    : PopulationEconomySystem.getWindPowerSnapshot(b);
                const hasWarehouse = !!EnergyManager?.hasWarehouse?.();
                const warehouseFull = !!EnergyManager?.isFull?.();
                const operating = snapshot.actualEnergyPerSecond > 0 && hasWarehouse && !warehouseFull;
                const values = {
                    pbWindStatus: operating
                        ? '稳定发电'
                        : (snapshot.staffedCount <= 0
                            ? `等待${isSolar ? '光伏' : '风机'}技师上岗`
                            : (snapshot.laborEfficiency <= 0
                                ? '人口容量不足'
                                : (hasWarehouse && !warehouseFull ? `等待${isSolar ? '光伏' : '风力'}结算` : '等待仓库空间'))),
                    pbWindCycle: `${(snapshot.cycleMs / 1000).toFixed(1)} 秒`,
                    pbWindPerCycle: `${snapshot.energyPerCycle.toFixed(0)} 能源`,
                    pbWindConversion: `${(snapshot.conversionRate * 100).toFixed(1)}%`,
                    pbWindStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbWindConfiguredOutput: `${snapshot.configuredEnergyPerSecond.toFixed(2)} 能源/秒`,
                    pbWindActualOutput: `${snapshot.actualEnergyPerSecond.toFixed(2)} 能源/秒`,
                    pbWindWorkshop: `${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                    pbWindPending: `${snapshot.pendingEnergy}`,
                    pbWindStorage: `${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                el.querySelector('#pbWindStatus')?.classList.toggle('is-blocked', !operating);
                const upgrade = isSolar ? b._solarPowerUpgrade : b._windPowerUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const progressText = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (progressText) {
                        progressText.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                    }
                } else if (el.querySelector('[data-wind-power-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'planar_resonator') {
                const snapshot = PopulationEconomySystem.getPlanarResonatorSnapshot(b);
                const hasWarehouse = !!EnergyManager?.hasWarehouse?.();
                const warehouseFull = !!EnergyManager?.isFull?.();
                const operating = snapshot.actualEnergyPerSecond > 0 && hasWarehouse && !warehouseFull;
                const values = {
                    pbResonatorStatus: operating
                        ? '稳定发电'
                        : (snapshot.staffedCount <= 0
                            ? '等待技师上岗'
                            : (snapshot.laborEfficiency <= 0
                                ? '人口容量不足'
                                : (hasWarehouse && !warehouseFull ? '等待谐振' : '等待仓库空间'))),
                    pbResonatorCycle: `${(snapshot.cycleMs / 1000).toFixed(1)} 秒`,
                    pbResonatorPerCycle: `${snapshot.energyPerCycle.toFixed(0)} 能源`,
                    pbResonatorConversion: `${(snapshot.conversionRate * 100).toFixed(0)}%`,
                    pbResonatorStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbResonatorConfiguredOutput: `${snapshot.configuredEnergyPerSecond.toFixed(2)} 能源/秒`,
                    pbEconomyOutput: `${snapshot.actualEnergyPerSecond.toFixed(2)} 能源/秒`,
                    pbResonatorWorkshop: `${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                    pbResonatorPending: `${snapshot.pendingEnergy}`,
                    pbResonatorStorage: `${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbResonatorStatus');
                status?.classList.toggle('is-blocked', !operating);
                const upgrade = b._resonatorUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const progressText = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (progressText) {
                        progressText.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                    }
                } else if (el.querySelector('[data-resonator-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'bakery') {
                const snapshot = BakeryEconomySystem.getSnapshot(b);
                const values = {
                    pbBakeryStatus: snapshot.status,
                    pbBakeryProcess: `${(snapshot.processTimeMs / 1000).toFixed(1)} 秒`,
                    pbBakeryMultiplier: `${snapshot.outputMultiplier.toFixed(1)} 倍`,
                    pbBakeryWeather: `${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}`,
                    pbBakeryOutput: `${snapshot.outputFood} 粮食`,
                    pbBakeryTributeChance: `${(snapshot.plantTributeChance * 100).toFixed(1)}%`,
                    pbBakeryMoveSpeed: `${snapshot.moveSpeed.toFixed(0)}px/s`,
                    pbBakeryBatches: `${snapshot.completedBatches}`,
                    pbBakeryPendingTributes: `${snapshot.pendingTributes}`,
                    pbEconomyFood: `${Math.floor(PopulationEconomySystem.getFoodStored())}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbBakeryStatus');
                status?.classList.toggle('is-blocked', !snapshot.roadConnected
                    || snapshot.phase === 'idle' || snapshot.phase === 'waiting_deposit');
                const roadWarning = el.querySelector('#pbBakeryRoadWarning');
                if (roadWarning) roadWarning.hidden = snapshot.roadConnected;
                const upgrade = b._bakeryUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-bakery-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'chain_restaurant') {
                const snapshot = BakeryEconomySystem.getSnapshot(b);
                const values = {
                    pbRestaurantStatus: snapshot.status,
                    pbRestaurantInput: `${snapshot.inputFood} 食物`,
                    pbRestaurantProcess: `${(snapshot.processTimeMs / 1000).toFixed(1)} 秒`,
                    pbRestaurantMultiplier: `${snapshot.outputMultiplier.toFixed(1)} 倍`,
                    pbRestaurantWeather: `${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}`,
                    pbRestaurantOutput: `${snapshot.outputFood} 食物`,
                    pbRestaurantMoveSpeed: `${snapshot.moveSpeed.toFixed(0)}px/s`,
                    pbRestaurantBatches: `${snapshot.completedBatches}`,
                    pbRestaurantPending: `${snapshot.pendingFood}`,
                    pbEconomyFood: `${Math.floor(PopulationEconomySystem.getFoodStored())}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbRestaurantStatus');
                status?.classList.toggle('is-blocked', !snapshot.roadConnected
                    || snapshot.phase === 'idle' || snapshot.phase === 'waiting_deposit');
                const roadWarning = el.querySelector('#pbRestaurantRoadWarning');
                if (roadWarning) roadWarning.hidden = snapshot.roadConnected;
                const upgrade = b._bakeryUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-restaurant-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'cheese_farm') {
                const snapshot = CheeseFarmSystem.getSnapshot(b);
                const values = {
                    pbCheeseStatus: snapshot.status,
                    pbCheeseProcess: `${(snapshot.processTimeMs / 1000).toFixed(1)} 秒`,
                    pbCheeseWeather: `${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}`,
                    pbCheeseOutput: `${snapshot.outputFood} 食物`,
                    pbCheeseCows: `${snapshot.cowCount} 头`,
                    pbCheeseMoveSpeed: `${snapshot.moveSpeed.toFixed(0)}px/s`,
                    pbCheeseBatches: `${snapshot.completedBatches}`,
                    pbCheesePending: `${snapshot.pendingFood}`,
                    pbEconomyFood: `${Math.floor(PopulationEconomySystem.getFoodStored())}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                el.querySelector('#pbCheeseStatus')?.classList.toggle('is-blocked',
                    !snapshot.roadConnected || snapshot.phase === 'waiting_deposit');
                const roadWarning = el.querySelector('#pbCheeseRoadWarning');
                if (roadWarning) roadWarning.hidden = snapshot.roadConnected;
                const upgrade = b._cheeseFarmUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-cheese-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'steam_power_plant') {
                const snapshot = SteamPowerPlantSystem.getSnapshot(b);
                const values = {
                    pbSteamStatus: snapshot.status,
                    pbSteamProcess: `${(snapshot.processTimeMs / 1000).toFixed(1)} 秒`,
                    pbSteamFood: `${snapshot.inputFood} 食物`,
                    pbSteamEnergy: `${snapshot.energyPerBatch} 能源`,
                    pbSteamMoveSpeed: `${snapshot.moveSpeed.toFixed(0)}px/s`,
                    pbSteamBatches: `${snapshot.completedBatches}`,
                    pbSteamPending: `${snapshot.pendingEnergy}`,
                    pbEconomyFood: `${Math.floor(PopulationEconomySystem.getFoodStored())}`,
                    pbSteamStorage: `${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbSteamStatus');
                status?.classList.toggle('is-blocked', !!snapshot.blockReason);
                const roadWarning = el.querySelector('#pbSteamRoadWarning');
                if (roadWarning) roadWarning.hidden = snapshot.roadConnected;
                const upgrade = b._steamUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-steam-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'deep_drill') {
                const snapshot = DeepDrillSystem.getSnapshot(b);
                const operating = snapshot.actualEnergyPerSecond > 0;
                const statusText = operating
                    ? (snapshot.usingDeepVein ? '正在开采深层矿脉' : '正在持续采掘')
                    : (snapshot.staffedCount <= 0 ? '等待深钻工上岗'
                        : (!snapshot.hasWarehouse ? '等待能源仓库'
                            : (snapshot.warehouseFull ? '仓库已满'
                                : (snapshot.nodeCount <= 0 ? '范围内无可采矿脉' : '人口容量不足'))));
                const values = {
                    pbDeepDrillStatus: statusText,
                    pbDeepDrillNodes: snapshot.usingDeepVein
                        ? '0（已转深层）'
                        : `${snapshot.nodeCount}`,
                    pbDeepDrillRemaining: snapshot.usingDeepVein
                        ? '无限（深层矿脉）'
                        : `${Math.ceil(snapshot.remainingEnergy)} 能源`,
                    pbDeepDrillActual: `${snapshot.actualEnergyPerSecond.toFixed(2)} 能源/秒`,
                    pbDeepDrillLast: `${Math.floor(snapshot.lastMined)} 能源`,
                    pbDeepDrillStorage: `${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                el.querySelector('#pbDeepDrillStatus')?.classList.toggle('is-blocked', !operating);
            } else if (b._economyType === 'tavern') {
                const snapshot = TavernEconomySystem.getSnapshot(b);
                const values = {
                    pbTavernStatus: snapshot.status,
                    pbTavernRoad: snapshot.roadConnected
                        ? `${snapshot.connectedWarehouseCount} 座${snapshot.roadDistance == null ? '' : ` · 路距 ${snapshot.roadDistance}`}`
                        : '未连接',
                    pbTavernCargo: `${snapshot.cargoFood}/${snapshot.inputFood} 食物`,
                    pbTavernBatchFood: `${snapshot.inputFood} 食物`,
                    pbTavernConfigured: `×${snapshot.configuredMultiplier.toFixed(3)}`,
                    pbTavernActual: `×${snapshot.actualMultiplier.toFixed(3)}`,
                    pbTavernServiceRemain: snapshot.serving
                        ? `${(snapshot.serviceRemainMs / 1000).toFixed(1)} 秒` : '—',
                    pbTavernMoveSpeed: `${snapshot.moveSpeed.toFixed(0)}px/s`,
                    pbTavernBatches: `${snapshot.completedBatches}`,
                    pbEconomyFood: `${Math.floor(PopulationEconomySystem.getFoodStored())}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbTavernStatus');
                status?.classList.toggle('is-blocked', !!snapshot.blockReason);
                const warning = el.querySelector('#pbTavernWarning');
                if (warning) {
                    warning.hidden = !snapshot.blockReason;
                    warning.textContent = {
                        unstaffed: '无酒保上岗：任务冻结，宴饮增效停止。',
                        road_disconnected: '道路中断：运输阶段冻结；已送达的宴饮服务仍持续到本批结束。',
                        food_shortage: '可达仓库食物不足，酒保在酒馆等待。',
                    }[snapshot.blockReason] || '';
                }
                const upgrade = b._tavernUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-tavern-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'stock_exchange'
                || b._economyType === 'computing_center') {
                const isComputing = b._economyType === 'computing_center';
                const snapshot = isComputing
                    ? PopulationEconomySystem.getComputingCenterSnapshot(b)
                    : PopulationEconomySystem.getStockExchangeSnapshot(b);
                const values = {
                    pbExchangeStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbExchangeLabor: `${(snapshot.laborEfficiency * 100).toFixed(1)}%`,
                    pbExchangePopulation: `${snapshot.population}`,
                    pbExchangePlayerGold: `${Math.floor(snapshot.playerTotalGold)}`,
                    pbExchangeBase: `${snapshot.baseContribution.toFixed(2)} 金币/秒`,
                    pbExchangePopulationRate: `${snapshot.populationRate.toFixed(3)} 金币/人/秒`,
                    pbExchangePopulationGold: `${snapshot.populationContribution.toFixed(2)} 金币/秒`,
                    pbExchangeBalanceRate: `${(snapshot.goldBalanceRate * 100).toFixed(4)}%/秒`,
                    pbExchangeBalanceGold: `${snapshot.goldBalanceContribution.toFixed(2)} 金币/秒`,
                    pbExchangeGold: `${snapshot.goldPerSecond.toFixed(2)} 金币/秒`,
                    pbExchangeEnergy: `${snapshot.energyPerSecond.toFixed(2)} 能源/秒`,
                    pbExchangeStorage: `${Math.floor(snapshot.storedEnergy)} 能源`,
                    pbExchangeEfficiency: `${(snapshot.operatingFactor * 100).toFixed(0)}%`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbExchangeStatus');
                if (status) {
                    status.textContent = snapshot.canOperate
                        ? (isComputing ? '算力集群运转中' : '交易运转中')
                        : (snapshot.staffedCount <= 0 ? '等待职员上岗' : '仓库能源不足');
                    status.classList.toggle('is-blocked', !snapshot.canOperate);
                }
                const bar = el.querySelector('#pbExchangeEfficiencyBar');
                if (bar) bar.style.width = `${snapshot.operatingFactor * 100}%`;
                const upgrade = isComputing ? b._computingCenterUpgrade : null;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const upgradeBar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (upgradeBar) upgradeBar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-computing-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'grand_mall') {
                const snapshot = PopulationEconomySystem.getGrandMallSnapshot(b);
                const values = {
                    pbMallStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbMallStaffEfficiency: `${(snapshot.staffEfficiency * 100).toFixed(0)}%`,
                    pbMallRange: `${Math.round(snapshot.range)}px`,
                    pbMallHouses: `${snapshot.coveredHouseCount}`,
                    pbMallPopulation: `${snapshot.servicePopulation}`,
                    pbMallGold: `${snapshot.goldPerSecond.toFixed(2)} 金币/秒`,
                    pbMallEnergy: `${snapshot.energyPerSecond.toFixed(2)} 能源/秒`,
                    pbMallStorage: `${Math.floor(snapshot.storedEnergy)} 能源`,
                    pbMallLabor: `${(snapshot.laborEfficiency * 100).toFixed(1)}%`,
                    pbMallWorkshop: `×${snapshot.workshopMultiplier.toFixed(3)}`,
                    pbMallTavern: `×${snapshot.tavernMultiplier.toFixed(3)}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbMallStatus');
                if (status) {
                    status.textContent = snapshot.canOperate
                        ? '正在营业'
                        : (snapshot.staffedCount <= 0
                            ? '等待职员上岗'
                            : (snapshot.servicePopulation <= 0 ? '范围内没有人口' : '仓库能源不足'));
                    status.classList.toggle('is-blocked', !snapshot.canOperate);
                }
                const upgrade = b._grandMallUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-mall-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'royal_mint') {
                const snapshot = PopulationEconomySystem.getMintSnapshot(b);
                const operating = snapshot.staffedCount > 0 && snapshot.canAffordSettlement;
                const values = {
                    pbMintStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbMintGoldPerWorker: `${snapshot.goldPerWorker.toFixed(2)} 金币/人/批`,
                    pbMintEnergyPerWorker: `${snapshot.energyPerWorker.toFixed(0)} 能源/人/批`,
                    pbMintFoodPerWorker: `${snapshot.foodPerWorker.toFixed(0)} 食物/人/批`,
                    pbMintInterval: `${(snapshot.settlementIntervalMs / 1000).toFixed(2)} 秒`,
                    pbMintSettlementGold: `${snapshot.goldPerSettlement.toFixed(2)} 金币`,
                    pbMintSettlementEnergy: `${snapshot.energyPerSettlement} 能源`,
                    pbMintSettlementFood: `${snapshot.foodPerSettlement} 食物`,
                    pbMintGoldPerSecond: `${snapshot.goldPerSecond.toFixed(2)} 金币/秒`,
                    pbMintEnergyPerSecond: `${snapshot.energyPerSecond.toFixed(2)} 能源/秒`,
                    pbMintFoodPerSecond: `${snapshot.foodPerSecond.toFixed(2)} 食物/秒`,
                    pbMintStorage: `${Math.floor(snapshot.storedEnergy)} 能源`,
                    pbMintFoodStorage: `${Math.floor(snapshot.storedFood)} 食物`,
                    pbMintWorkshop: `+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbMintStatus');
                if (status) {
                    status.textContent = operating
                        ? '正在铸币'
                        : (snapshot.staffedCount <= 0
                            ? '等待铸币工上岗'
                            : snapshot.resourceBlockReason);
                    status.classList.toggle('is-blocked', !operating);
                }
                const upgrade = b._mintUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-mint-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'bank') {
                const snapshot = PopulationEconomySystem.getBankSnapshot(b);
                const effectivePopulation = snapshot.effectiveServicePopulation.toFixed(2);
                const values = {
                    pbBankRange: `${Math.round(snapshot.range)}px`,
                    pbBankHouses: `${snapshot.coveredHouseCount}`,
                    pbBankServicePopulation: `${snapshot.servicePopulation}`,
                    pbBankEffectivePopulation: effectivePopulation,
                    pbBankOverlap: `${snapshot.overlappedHouseCount} 栋 / 最高 ${snapshot.maxBankOverlapCount} 家`,
                    pbBankPerPopulation: `${(snapshot.goldPerPopulation * 100).toFixed(0)}%`,
                    pbBankInterval: `${(snapshot.settlementIntervalMs / 1000).toFixed(2)} 秒`,
                    pbBankSettlementGold: `${snapshot.goldPerSettlement.toFixed(2)} 金币`,
                    pbEconomyOutput: `${snapshot.goldPerSecond.toFixed(2)} 金币/秒`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbBankStatus');
                if (status) {
                    const overlapBlocked = snapshot.servicePopulation > 0
                        && snapshot.effectiveServicePopulation <= 0;
                    const operating = snapshot.assignedWorkers > 0
                        && snapshot.effectiveServicePopulation > 0;
                    status.textContent = operating
                        ? `有效 ${effectivePopulation} 人`
                        : (overlapBlocked ? '三家重叠：无收益' : '等待职员与服务人口');
                    status.classList.toggle('is-blocked', !operating);
                }
                const upgrade = b._bankUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-bank-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'housing') {
                const upgrade = b._economyUpgrade;
                if (upgrade) {
                    const progress = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector('#pbUpgradeBar_house_capacity');
                    const text = el.querySelector('#pbUpgradeText_house_capacity');
                    if (bar) bar.style.width = `${progress}%`;
                    if (text) text.textContent = `升级中 ${progress}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-house-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'windmill') {
                const snapshot = PopulationEconomySystem.getWindmillSnapshot(b);
                const output = el.querySelector('#pbEconomyOutput');
                const food = el.querySelector('#pbEconomyFood');
                const configured = el.querySelector('#pbWindmillConfiguredOutput');
                const perWorker = el.querySelector('#pbWindmillPerWorker');
                const multipliers = el.querySelector('#pbWindmillMultipliers');
                const weather = el.querySelector('#pbFoodWeather');
                if (output) output.textContent = `${snapshot.actualFoodPerSecond.toFixed(2)} 粮食/秒`;
                if (configured) configured.textContent = `${snapshot.configuredFoodPerSecond.toFixed(2)} 粮食/秒`;
                if (perWorker) perWorker.textContent = `${snapshot.foodPerWorker.toFixed(2)}/秒`;
                if (multipliers) multipliers.textContent = `×${snapshot.driveMultiplier.toFixed(2)} / ×${snapshot.fieldMultiplier.toFixed(2)}`;
                if (weather) weather.textContent = `${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}`;
                if (food) food.textContent = `${Math.floor(PopulationEconomySystem.getFoodStored())}`;
                const upgrade = b._windmillUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-windmill-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'market') {
                const quote = PopulationEconomySystem.getMarketQuote(b);
                const buyBatch = populationEconomyConfig.market.buyEnergyBatch;
                const sellBatch = populationEconomyConfig.market.sellGoldBatch;
                const buyGold = Math.floor(buyBatch / quote.buyEnergyPerGold);
                const buyEnergy = Math.ceil(buyGold * quote.buyEnergyPerGold);
                const values = {
                    pbEconomyMarketMid: quote.midEnergyPerGold.toFixed(2),
                    pbEconomyMarketBuy: quote.buyEnergyPerGold.toFixed(2),
                    pbEconomyMarketSell: quote.sellEnergyPerGold.toFixed(2),
                    pbEconomyMarketPressure: quote.pressure.toFixed(3),
                    pbEconomyMarketSpread: `${(quote.spread * 100).toFixed(1)}%`,
                    pbEconomyMarketLoss: `买 +${(quote.minimumTradeLossRate * 100).toFixed(0)}% / 卖 -${(quote.minimumTradeLossRate * 100).toFixed(0)}%`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const canTrade = PopulationEconomySystem.canMarketTrade(b);
                const buyButton = el.querySelector('[data-market-buy]');
                const sellButton = el.querySelector('[data-market-sell]');
                if (buyButton) {
                    buyButton.disabled = !canTrade;
                    buyButton.innerHTML = `${buyEnergy} 能源 → <span class="economy-unit-gold">${buyGold} 金币</span>`;
                }
                if (sellButton) {
                    sellButton.disabled = !canTrade;
                    sellButton.innerHTML = `${sellBatch} <span class="economy-unit-gold">金币</span> → ${Math.floor(sellBatch * quote.sellEnergyPerGold)} 能源`;
                }
            } else if (b._economyType === 'field_hospital') {
                const snapshot = FieldHospitalSystem.getSnapshot(b);
                const values = {
                    pbHospitalRange: `${Math.round(snapshot.range)}px`,
                    pbHospitalConfiguredRate: `${(snapshot.configuredHealingRate * 100).toFixed(1)}% 最大生命/秒`,
                    pbHospitalActualRate: `${(snapshot.actualHealingRate * 100).toFixed(2)}% 最大生命/秒`,
                    pbHospitalStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbHospitalPatients: `${snapshot.patientCount}/${snapshot.patientCapacity}`,
                    pbHospitalBeds: `${snapshot.configuredPatientCapacity}`,
                    pbHospitalWorkshop: `${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbHospitalStatus');
                if (status) {
                    const operating = snapshot.patientCount > 0 && snapshot.actualHealingRate > 0;
                    status.textContent = operating
                        ? `正在治疗 ${snapshot.patientCount} 名友军`
                        : (snapshot.staffedCount > 0 ? '等待伤员进入范围' : '等待医护上岗');
                    status.classList.toggle('is-blocked', !operating);
                }
                const upgrade = b._hospitalUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-hospital-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'armory') {
                const snapshot = ArmoryEconomySystem.getSnapshot(b);
                const values = {
                    pbArmoryRange: `${Math.round(snapshot.range)}px`,
                    pbArmoryReduction: `-${(snapshot.actualCostReduction * 100).toFixed(1)}%`,
                    pbArmoryConfiguredReduction: `-${(snapshot.configuredCostReduction * 100).toFixed(1)}%`,
                    pbArmoryStaffed: `${snapshot.staffedCount}/${snapshot.staffCapacity}`,
                    pbArmoryCovered: `${snapshot.coveredProducerCount}`,
                    pbArmoryStoneChance: `${(snapshot.actualStoneChance * 100).toFixed(2)}%/分钟`,
                    pbArmoryConfiguredStoneChance: `${(snapshot.configuredStoneChance * 100).toFixed(1)}%/分钟`,
                    pbArmoryPendingStones: `${snapshot.pendingStones}`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const upgrade = b._armoryUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-armory-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'workshop') {
                const snapshot = WorkshopEconomySystem.getSnapshot(b);
                const values = {
                    pbWorkshopRange: `${Math.round(snapshot.range)}px`,
                    pbWorkshopEfficiency: `+${(snapshot.actualEfficiency * 100).toFixed(1)}%`,
                    pbWorkshopRepair: `${(snapshot.repairRate * 100).toFixed(1)}%/秒`,
                    pbWorkshopStaffed: `${snapshot.staffedEngineerCount}/${snapshot.engineerCount}`,
                    pbWorkshopEngineers: `${snapshot.assignedCount}`,
                    pbWorkshopRepairing: `${snapshot.repairingCount}`,
                    pbWorkshopSafety: snapshot.enemyBlocked ? '敌情封锁，维修暂停' : '范围安全，可自动维修',
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const safety = el.querySelector('#pbWorkshopSafety');
                safety?.classList.toggle('is-blocked', snapshot.enemyBlocked);
                const upgrade = b._workshopUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-workshop-upgrading="true"]')) {
                    this.refresh();
                }
            }
            return;
        }
        if (b._isEnergyWarehouse) {
            const ownEnergy = Math.floor(b.storedEnergy || 0);
            const ownFood = Math.floor(b.storedFood || 0);
            const own = EnergyManager ? EnergyManager.getWarehouseUsedCapacity(b) : ownEnergy + ownFood;
            const ownCap = Math.floor(b.storageCapacity || b._cfg.storageCapacity || 5000);
            const totalEnergy = EnergyManager ? EnergyManager.getEnergy() : 0;
            const totalFood = EnergyManager ? EnergyManager.getFood() : 0;
            const totalCap = EnergyManager ? EnergyManager.getCapacity() : 0;
            const totalUsed = totalCap - (EnergyManager ? EnergyManager.getFreeCapacity() : 0);
            const pct = ownCap > 0 ? Math.round(own / ownCap * 100) : 0;
            const totalPct = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : 0;
            const ownEl = el.querySelector('#pbWarehouseOwn');
            const totalEl = el.querySelector('#pbWarehouseTotal');
            const pctEl = el.querySelector('#pbWarehousePct');
            const barEl = el.querySelector('#pbWarehouseBar');
            const totalPctEl = el.querySelector('#pbWarehouseTotalPct');
            const totalBarEl = el.querySelector('#pbWarehouseTotalBar');
            if (ownEl) ownEl.textContent = `${Math.round(own)}/${ownCap}（能 ${ownEnergy} / 粮 ${ownFood}）`;
            if (totalEl) totalEl.textContent = `${Math.round(totalUsed)}/${totalCap}（能 ${totalEnergy} / 粮 ${totalFood}）`;
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (barEl) barEl.style.width = `${pct}%`;
            if (totalPctEl) totalPctEl.textContent = `${totalPct}%`;
            if (totalBarEl) totalBarEl.style.width = `${totalPct}%`;
            const levelUpgrade = b._economyUpgrade;
            if (levelUpgrade) {
                const levelPct = Math.max(0, Math.min(100,
                    Math.round((1 - levelUpgrade.remainMs / levelUpgrade.totalMs) * 100)));
                const levelBar = el.querySelector('#pbWarehouseLevelUpgradeBar');
                const levelText = el.querySelector('#pbWarehouseLevelUpgradeText');
                if (levelBar) levelBar.style.width = `${levelPct}%`;
                if (levelText) levelText.textContent = `升级中 ${levelPct}%（剩余 ${Math.ceil(levelUpgrade.remainMs / 1000)}s）`;
            } else if (el.querySelector('[data-warehouse-level-upgrading="true"]')) {
                this.refresh();
                return;
            }
            const upgrade = b._warehouseUpgrade;
            if (upgrade) {
                const upgradePct = Math.max(0, Math.min(100,
                    Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                const upgradeBar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                const upgradeText = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                if (upgradeBar) upgradeBar.style.width = `${upgradePct}%`;
                if (upgradeText) upgradeText.textContent = `升级中 ${upgradePct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
            } else if (el.querySelector('[data-warehouse-upgrading="true"]')) {
                this.refresh();
            }
            return;
        }
        if (b._parallelProduction) {
            for (const [kind, queue] of Object.entries(b._parallelQueues || {})) {
                const unlocked = TechnologySystem.isUnlocked('unit', kind);
                const interval = b.recruitIntervalMs(kind);
                const progress = queue.blocked ? 1 : Math.max(0, Math.min(1, 1 - queue.timer / interval));
                const pctValue = Math.round(progress * 100);
                const bar = el.querySelector(`[data-parallel-bar="${kind}"]`);
                const pct = el.querySelector(`[data-parallel-pct="${kind}"]`);
                const next = el.querySelector(`[data-parallel-next="${kind}"]`);
                if (bar) bar.style.width = `${pctValue}%`;
                if (pct) pct.textContent = `${pctValue}%`;
                if (next) {
                    const technologyName = TechnologySystem.getUnlockRequirementLabel('unit', kind);
                    next.textContent = unlocked
                        ? (normalizeRecruitMode(queue.recruitMode) === RECRUIT_MODE.PAUSED
                            ? '已暂停' : queue.populationBlocked ? '军事人口已满'
                                : queue.foodBlocked ? '粮食不足' : queue.blocked ? '出口阻塞'
                                : `${Math.max(0, Math.ceil(queue.timer / 1000))}s`)
                        : `需要科技：${technologyName || kind}`;
                }
            }
            const upgrade = b._upgrade;
            if (upgrade?.moduleId && upgrade.unitType) {
                const upgradePct = Math.max(0, Math.min(100,
                    Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                const projectId = b._sharedUnitUpgrades
                    ? upgrade.moduleId
                    : `${upgrade.unitType}_${upgrade.moduleId}`;
                const upgradeBar = el.querySelector(`#pbUpgradeBar_${projectId}`);
                const upgradeText = el.querySelector(`#pbUpgradeText_${projectId}`);
                if (upgradeBar) upgradeBar.style.width = `${upgradePct}%`;
                if (upgradeText) {
                    upgradeText.textContent = `升级中 ${upgradePct}%（剩余 ${Math.max(0, Math.ceil(upgrade.remainMs / 1000))}s）`;
                }
            }
            return;
        }
        const spawnMs = b.recruitIntervalMs();
        const recruitMode = normalizeRecruitMode(b._recruitMode);
        const paused = recruitMode === RECRUIT_MODE.PAUSED;
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = paused ? '#727981' : (b._spawnPopulationBlocked ? '#c7a7ff'
            : (b._spawnFoodBlocked ? '#ffcc55' : (b._spawnBlocked ? '#ff7755'
                : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8')))));
        const bar = el.querySelector('#pbSpawnBar');
        const pct = el.querySelector('#pbSpawnPct');
        const next = el.querySelector('#pbSpawnNext');
        if (bar) {
            bar.style.width = `${spawnPct}%`;
            bar.style.background = `linear-gradient(90deg, ${spawnBarColor}, #7fe0c8)`;
        }
        if (pct) {
            pct.textContent = `${spawnPct}%`;
            pct.style.color = spawnBarColor;
        }
        if (next) next.textContent = paused
            ? '已暂停'
            : (b._spawnPopulationBlocked ? '军事人口已满'
                : (b._spawnFoodBlocked ? '粮食不足'
                    : (b._spawnBlocked ? '出口阻塞' : `${Math.max(0, Math.ceil(b._spawnTimer / 1000))}s`)));
        const modeText = el.querySelector('#pbRecruitMode');
        if (modeText) modeText.textContent = `${recruitModeLabel(recruitMode)} · ${recruitStatusText(b)}`;
        el.querySelectorAll('[data-recruit-mode]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.recruitMode === recruitMode);
        });
        // 研究/能力与出兵模块共用升级读条进度。
        if (b._upgrade) {
            const up = b._upgrade;
            const upPct = Math.max(0, Math.min(100, Math.round((1 - up.remainMs / up.totalMs) * 100)));
            const projectId = up.abilityId || up.moduleId;
            const bar = el.querySelector(`#pbUpgradeBar_${projectId}`);
            const txt = el.querySelector(`#pbUpgradeText_${projectId}`);
            if (bar) bar.style.width = `${upPct}%`;
            if (txt) txt.textContent = `升级中 ${upPct}%（剩余 ${Math.max(0, Math.ceil(up.remainMs / 1000))}s）`;
        }
    }

    _notify(text, color) {
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, text, color || '#d4c5a9'));
        }
    }

    _abilityValueText(ability, level) {
        const value = getAbilityValue(ability, level);
        if (ability.displayMode === 'seconds') {
            const seconds = value / 1000;
            return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}秒`;
        }
        if (ability.displayMode === 'decimal') {
            return Number(value.toFixed(2)).toString();
        }
        return ability.displayMode === 'flat'
            ? String(Math.round(value))
            : `${Math.round(value * 1000) / 10}%`;
    }

    _fillAbilityDesc(ability, level) {
        const text = this._abilityValueText(ability, level);
        return (ability.desc || '')
            .replace('{chance}', text)
            .replace('{dmg}', text)
            .replace('{pct}', text)
            .replace('{value}', text)
            .replace('{radius}', String(ability.radius ?? 0))
            .replace('{cooldown}', String(Math.round((ability.cooldownMs ?? 0) / 1000)));
    }

    _abilityTargetText(target) {
        return ABILITY_TARGET_NAMES[target] || target || '—';
    }

    refresh() {
        const el = this.el;
        if (!el || !this.building) return;
        const b = this.building;
        const cfg = b._cfg;
        const energy = CrossPlaneResourceSystem.getAvailable('energy');
        const food = CrossPlaneResourceSystem.getAvailable('food');
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const military = PopulationEconomySystem.getMilitaryPopulationSnapshot();
        const isWarehouse = cfg.workshopType === 'warehouse';
        const isPortal = cfg.panelMode === 'portal';
        const isPassive = cfg.panelMode === 'detail';
        const isWeatherTower = b.cfgKey === WEATHER_FORECAST_TOWER_ID;
        const isCandle = cfg.panelMode === 'candle';
        // 仓库拥有 economyType，但使用独立的仓储/等级扩建面板；不能先落入
        // 通用经济分支的风车兜底，否则科技解锁后的仓库扩建卡永远不可见。
        const isEconomy = !!cfg.economyType && !isWarehouse;
        const isAbilityShop = cfg.spawnEnabled === false
            && !isWarehouse && !isPassive && !isCandle && !isEconomy;
        el.classList.toggle('is-troop-producer', !!b._isTroopProducer);
        el.classList.toggle('is-economy-building', isEconomy || isWarehouse);
        refreshProducerRallySection(el, b, SceneManager.currentScene);
        const applicableModules = isEconomy ? [] : Object.entries(cfg.modules || {})
            .filter(([moduleId, module]) => b._isTroopProducer
                ? b.moduleUnitTypes(moduleId).length > 0
                : moduleAppliesToUnit(module, b.unitType));
        const upgradeSummary = applicableModules.map(([, module]) => module.name).join(' / ') || '无单位升级项目';
        el.querySelector('#pbTitle').textContent = '建筑详情';
        const packedRebuildBtn = el.querySelector('#pbPackedRebuild');
        if (packedRebuildBtn) {
            const unlocked = TechnologySystem.isUnlocked('mechanic', 'building_relocation');
            const protectedCore = b._isWorldPortalCore || b._isMainHubPortalBuilding;
            packedRebuildBtn.style.display = unlocked && !protectedCore ? '' : 'none';
            packedRebuildBtn.title = '保留建筑当前状态，免费迁移到新的合法位置';
            packedRebuildBtn.onclick = () => {
                const result = Game?.BuildingSystem?.beginPackedRebuild?.(b)
                    || { ok: false, reason: '建筑系统当前不可用' };
                if (!result.ok) this._notify(result.reason || '无法打包重建', '#ff5555');
                else this.close();
            };
        }
        const detail = el.querySelector('#pbBuildingDetail');
        const functionTitle = el.querySelector('#pbFunctionTitle');
        const economyMode = {
            housing: '人口容量与房屋升级',
            bank: '范围人口金融服务',
            market: '商人动态交易',
            windmill: '农夫粮食生产',
            workshop: '自动维修与经济增效',
            armory: '军械维护与募兵减耗',
            field_hospital: '医护岗位、范围分诊与友军治疗',
            bakery: '面包师粮食加工与返仓',
            chain_restaurant: '外卖员取粮、中央厨房加工与成品返仓',
            steam_power_plant: '道路取粮与蒸汽能源生产',
            wind_power_plant: '无燃料风力能源生产',
            solar_power_plant: '无燃料光伏能源生产',
            deep_drill: '矿脉覆盖建造与范围自动采掘',
            tavern: '酒保取粮与全位面宴饮增效',
            grand_mall: '覆盖人口商业产金与按秒能源消耗',
            stock_exchange: '人口与资本驱动的被动金币收益',
            computing_center: '岗位、人口与资本驱动的算力金币收益',
            research: '岗位科研、科技树与全局研究强化',
            advanced_research: '上位科研、产业集群与跨位面科技推进',
            weather_forecast: '单岗位气象观测、科研与灾害预警',
            planar_resonator: '岗位驱动的位面能源生产',
        }[cfg.economyType];
        const mode = isPortal ? '跨世界传送'
            : (isEconomy ? economyMode
                : (isCandle ? '烛火庇护与照明'
                : (isWeatherTower ? '天气观测与预报演算'
                : (isPassive ? '基础建筑详情'
                : (isWarehouse ? '仓储与能源汇总'
                    : (isAbilityShop ? (cfg.workshopType === 'research' ? '研究与结构强化' : '能力工坊升级') : '募兵与单位生产'))))));
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: b.spriteCfg?.panelKey || b.spriteCfg?.idleKey || cfg.tex,
                name: cfg.name,
                hp: b.hp,
                maxHp: b.maxHp,
                accent: isCandle ? '#ffc66d'
                    : (isWarehouse ? '#7fd4ff'
                        : (cfg.economyType === 'weather_forecast' ? '#79c9e8'
                            : (isAbilityShop || cfg.economyType === 'research'
                                || cfg.economyType === 'advanced_research' ? '#c9a0ff' : '#7fe0c8'))),
                status: mode,
            });
        }
        if (functionTitle) functionTitle.textContent = `特殊功能 · ${mode}`;
        const unitTypeEl = el.querySelector('#pbUnitType');
        if (unitTypeEl) unitTypeEl.style.display = (isAbilityShop || isWarehouse || isPassive
            || isCandle || isPortal || isEconomy) ? 'none' : '';

        const st = el.querySelector('#pbStatus');
        if (isCandle) {
            const range = CandleSanctuarySystem.getLightRange(b);
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="color:#ffc66d;font-weight:700;">🕯 烛火庇护</span>
                    <span class="troop-panel-resource-summary">能源 <span style="color:#7fd4ff;">${energy}</span></span>
                </div>
                <div class="troop-panel-copy">
                    照明与庇护半径 <b id="pbCandleRange" style="color:#ffd18a;">${Math.round(range)}px</b><br>
                    死寂雾潮：范围外友军视野 ×0.6，范围内恢复 ×1；夜晚分别为 ×0.3 / ×0.45。<br>
                    ${cfg.panelDescription || ''}
                </div>`;
            const modBox = el.querySelector('#pbModules');
            const moduleId = WORLD125_CANDLE_RANGE_MODULE_ID;
            const module = cfg.modules?.[moduleId];
            const level = CandleSanctuarySystem.getModuleLevel(b, moduleId);
            const maxed = level >= Math.max(0, Number(module?.maxLevel) || 0);
            const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
            const upgrade = b._candleUpgrade;
            const inProgress = upgrade?.moduleId === moduleId;
            const progress = inProgress
                ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                : 0;
            const cost = CandleSanctuarySystem.getUpgradeCost(b, moduleId);
            const actionHtml = maxed
                ? '<span style="color:#8a8a8a;font-size:12px;">已满级</span>'
                : `<button class="troop-panel-upgrade-button" data-candle-upgrade="${moduleId}"
                    data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                    ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
            modBox.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span class="troop-panel-section-title">✨ 单体烛台升级</span>
                    <span class="troop-panel-section-meta">每座烛台独立生效</span>
                </div>
                ${module ? renderBuildingUpgradeCard({
                    rowAttribute: 'data-candle-module-row', projectId: moduleId,
                    icon: module.icon, iconImage: module.iconImage, name: module.name,
                    level, maxLevel: module.maxLevel, cost, maxed, inProgress, progressPct: progress,
                    remainMs: inProgress ? upgrade.remainMs : 0,
                    barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                    actionsHtml: actionHtml, accent: '#ffc66d',
                }).replace('class="building-upgrade-card"',
                    `class="building-upgrade-card" data-candle-upgrading="${inProgress}"`)
                    : '<div class="troop-panel-empty">烛台升级配置缺失</div>'}
                <div class="troop-panel-caption" style="margin-top:8px;">每级照明与庇护半径 +50px；烛台被摧毁时，其照明和庇护立即失效。</div>`;
            TechnologyGate.bindTree(modBox);
            modBox.querySelector('[data-candle-upgrade]')?.addEventListener('click', (event) => {
                this._upgradeCandle(event.currentTarget.dataset.candleUpgrade);
            });
            const sellBtn = el.querySelector('#pbSell');
            if (sellBtn) {
                const durability = Math.max(0, Math.min(1,
                    Number(b.hp) / Math.max(1, Number(b.maxHp) || 1)));
                const refund = Math.floor((b._buildCost ?? cfg.cost)
                    * (cfg.sellRefundRatio ?? 0.5) * durability);
                const refundUnit = (b._buildCurrency || cfg.currency) === 'gold' ? '金币' : '能源';
                sellBtn.style.display = '';
                sellBtn.title = `出售返还 ${refund} ${refundUnit}`;
                sellBtn.onclick = () => {
                    const result = b.sell();
                    this._notify(result.ok ? `已出售（+${result.refund} ${refundUnit}）`
                        : (result.reason || '出售失败'), result.ok ? '#ffd700' : '#ff5555');
                    if (result.ok) this.close();
                };
            }
            return;
        }
        if (b._parallelProduction) {
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span class="troop-panel-primary-label">双通道独立募兵</span>
                    <span class="troop-panel-resource-summary">军事人口 <span id="pbMilitaryPopulation" style="color:#c7a7ff;">${military.used}/${military.capacity}</span> · 金币 <span style="color:#ffd700;">${gold}</span> · 粮食 <span style="color:#d9b84f;">${Math.floor(food)}</span></span>
                </div>
                <div class="troop-panel-copy">两种单位分别计时、分别暂停；同时受全局军事人口与本建筑特色兵种上限约束，任一通道受阻不会重置另一条进度。</div>`;
            unitTypeEl.style.display = '';
            unitTypeEl.innerHTML = (cfg.unitTypes || []).map((unit) => {
                const queue = b._parallelQueues[unit.key];
                const mode = normalizeRecruitMode(queue.recruitMode);
                const unlocked = TechnologySystem.isUnlocked('unit', unit.key);
                const technologyName = unlocked
                    ? ''
                    : TechnologySystem.getUnlockRequirementLabel('unit', unit.key);
                const interval = b.recruitIntervalMs(unit.key);
                const progress = queue.blocked ? 1 : Math.max(0, Math.min(1, 1 - queue.timer / interval));
                const pct = Math.round(progress * 100);
                const statusText = unlocked
                    ? (mode === RECRUIT_MODE.PAUSED ? '已暂停'
                        : queue.populationBlocked ? '军事人口已满'
                            : queue.foodBlocked ? '粮食不足'
                                : queue.blocked ? '出口阻塞' : `${Math.ceil(queue.timer / 1000)}s`)
                    : `需要科技：${technologyName || unit.key}`;
                const lockedStyle = unlocked ? '' : 'opacity:.72;';
                const disabled = unlocked ? '' : 'disabled';
                return `<div style="padding:9px 0;border-bottom:1px solid rgba(127,224,200,.18);${lockedStyle}">
                    <div class="troop-panel-unit-summary">
                        <span class="troop-panel-unit-name">${renderTroopUnitIcon(unit.key)}<b>${unit.name}</b></span>
                        <span>${b.aliveUnitCount(unit.key)}/${b.parallelUnitCap(unit.key)} · ${CrossPlaneResourceSystem.quote({ food: b._unitSpawnFoodCost(unit.key) }).food} 粮食</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-top:5px;"><span data-parallel-next="${unit.key}" style="color:${unlocked ? 'inherit' : '#ffcc55'};">${statusText}</span><span data-parallel-pct="${unit.key}">${pct}%</span></div>
                    <div style="height:9px;background:rgba(255,255,255,.1);border-radius:5px;overflow:hidden;"><div data-parallel-bar="${unit.key}" style="height:100%;width:${pct}%;background:linear-gradient(90deg,#ffd700,#7fe0c8);transition:width .2s linear;"></div></div>
                    <div class="recruit-control-row">
                        <button class="recruit-mode-btn ${mode === RECRUIT_MODE.SINGLE ? 'is-active' : ''}" data-parallel-kind="${unit.key}" data-parallel-mode="single" ${disabled}>单次招募</button>
                        <button class="recruit-mode-btn ${mode === RECRUIT_MODE.CONTINUOUS ? 'is-active' : ''}" data-parallel-kind="${unit.key}" data-parallel-mode="continuous" ${disabled}>持续招募</button>
                        <button class="recruit-mode-btn ${mode === RECRUIT_MODE.PAUSED ? 'is-active' : ''}" data-parallel-kind="${unit.key}" data-parallel-mode="paused" ${disabled}>暂停</button>
                    </div>
                </div>`;
            }).join('');
            unitTypeEl.querySelectorAll('[data-parallel-kind]').forEach((button) => {
                button.addEventListener('click', () => this._setParallelRecruitMode(
                    button.dataset.parallelKind, button.dataset.parallelMode));
            });
            const modBox = el.querySelector('#pbModules');
            const upgradeGroups = b._sharedUnitUpgrades
                ? Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const targetKinds = b.moduleUnitTypes(moduleId);
                    if (!targetKinds.length) return '';
                    const level = b.moduleLevel(moduleId, targetKinds[0]);
                    const maxed = level >= module.maxLevel;
                    const inProgress = !!(b._upgrade && b._upgrade.moduleId === moduleId);
                    const continuous = b.isContinuousUpgrade('module', moduleId);
                    const progressPct = inProgress
                        ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = renderContinuousUpgradeActions({
                        maxed, inProgress, continuous, upgradeBusy: !!b._upgrade,
                        manualAttributes: `data-parallel-mod="${moduleId}" data-parallel-upgrade-kind="${targetKinds[0]}"`,
                        continuousAttributes: `data-parallel-cont="${moduleId}" data-parallel-cont-kind="${targetKinds[0]}"`,
                    });
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-parallel-module-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: b.getModuleCost(moduleId, targetKinds[0]), maxed, inProgress, progressPct,
                        remainMs: inProgress ? b._upgrade.remainMs : 0,
                        statusText: continuous && !inProgress ? '持续升级已开启 · 等待条件与资源' : '',
                        barId: `pbUpgradeBar_${moduleId}`,
                        textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#8ad0ff',
                    }).replace('class="building-upgrade-card"',
                        'class="building-upgrade-card building-upgrade-card--shared"');
                }).join('')
                : (cfg.unitTypes || []).map((unit) => {
                    const modules = Object.entries(cfg.modules || {})
                        .filter(([, module]) => moduleAppliesToUnit(module, unit.key));
                    if (!modules.length) return '';
                    const rows = modules.map(([moduleId, module]) => {
                        const level = getUnitUpgradeLevel(unit.key, moduleId);
                        const maxed = level >= module.maxLevel;
                        const inProgress = !!(b._upgrade
                            && b._upgrade.moduleId === moduleId
                            && b._upgrade.unitType === unit.key);
                        const continuous = b.isContinuousUpgrade('module', moduleId, unit.key);
                        const progressPct = inProgress
                            ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)
                            : 0;
                        const actionsHtml = renderContinuousUpgradeActions({
                            maxed, inProgress, continuous, upgradeBusy: !!b._upgrade,
                            manualAttributes: `data-parallel-mod="${moduleId}" data-parallel-upgrade-kind="${unit.key}"`,
                            continuousAttributes: `data-parallel-cont="${moduleId}" data-parallel-cont-kind="${unit.key}"`,
                        });
                        return renderBuildingUpgradeCard({
                            rowAttribute: 'data-parallel-module-row', projectId: moduleId,
                            icon: module.icon, iconImage: module.iconImage, name: module.name,
                            level, maxLevel: module.maxLevel,
                            cost: b.getModuleCost(moduleId, unit.key), maxed, inProgress, progressPct,
                            remainMs: inProgress ? b._upgrade.remainMs : 0,
                            statusText: continuous && !inProgress ? '持续升级已开启 · 等待条件与资源' : '',
                            barId: `pbUpgradeBar_${unit.key}_${moduleId}`,
                            textId: `pbUpgradeText_${unit.key}_${moduleId}`,
                            actionsHtml, accent: '#8ad0ff',
                        }).replace('class="building-upgrade-card"',
                            `class="building-upgrade-card" data-parallel-unit-kind="${unit.key}"`);
                    }).join('');
                    return `<div class="troop-upgrade-unit-group">
                        <div class="troop-panel-unit-summary">
                            <span class="troop-panel-unit-name">${renderTroopUnitIcon(unit.key)}<b>${unit.name}</b></span>
                            <span>独立全局等级</span>
                        </div>
                        ${rows}
                    </div>`;
            }).join('');
            modBox.innerHTML = upgradeGroups
                ? `<div class="troop-upgrade-panel-heading">
                    <span class="troop-panel-section-title">✨ 单位升级</span>
                    <span class="troop-panel-caption troop-upgrade-panel-note">读条完成后全局生效；${b._sharedUnitUpgrades
                    ? '同一张卡同时升级全部适用兵种，实际适用对象由项目配置控制，不适用兵种不会获得加成。'
                    : '每个兵种保留独立全局等级。'} 同类别建筑仅允许一个持续升级项目。</span>
                    <span class="troop-panel-section-meta troop-upgrade-panel-resources">持有 ${gold} 金 / ${energy} 能</span>
                </div>
                ${upgradeGroups}`
                : '<div class="troop-panel-empty">当前建筑没有单位升级模块。</div>';
            modBox.querySelectorAll('[data-parallel-mod]').forEach((button) => {
                button.addEventListener('click', () => this._upgrade(
                    button.dataset.parallelMod, button.dataset.parallelUpgradeKind));
            });
            modBox.querySelectorAll('[data-parallel-cont]').forEach((button) => {
                button.addEventListener('click', () => this._toggleModuleContinuous(
                    button.dataset.parallelCont, button.dataset.parallelContKind));
            });
            modBox.querySelectorAll('[data-parallel-module-row]').forEach((row) => {
                row.addEventListener('mouseenter', (event) => this._showModuleTip(
                    row.dataset.parallelModuleRow, event, row.dataset.parallelUnitKind));
                row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                row.addEventListener('mouseleave', () => this._hideAbilityTip());
            });
            const sellBtn = el.querySelector('#pbSell');
            if (sellBtn) {
                const durability = Math.max(0, Math.min(1, Number(b.hp) / Math.max(1, Number(b.maxHp) || 1)));
                const refund = Math.floor((b._buildCost ?? cfg.cost) * (cfg.sellRefundRatio ?? .5) * durability);
                const refundUnit = (b._buildCurrency || cfg.currency) === 'gold' ? '金币' : '能源';
                sellBtn.style.display = '';
                sellBtn.title = `出售返还 ${refund} ${refundUnit}（特色单位一并拆除）`;
                sellBtn.onclick = () => {
                    const result = b.sell();
                    this._notify(result.ok ? `已出售（+${result.refund} ${refundUnit}）` : result.reason, result.ok ? '#ffd700' : '#ff5555');
                    if (result.ok) this.close();
                };
            }
            return;
        }
        const curType = b.unitName(b.unitType);
        const spawnMs = b.recruitIntervalMs();
        const nextIn = Math.max(0, Math.ceil(b._spawnTimer / 1000));
        const recruitMode = normalizeRecruitMode(b._recruitMode);
        const paused = recruitMode === RECRUIT_MODE.PAUSED;
        // 出兵进度 = 已等待时间 / 当前兵种生成周期（2026-08-18 起切换单位类型重置 _spawnTimer 重新计时）
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = paused ? '#727981' : (b._spawnPopulationBlocked ? '#c7a7ff'
            : (b._spawnFoodBlocked ? '#ffcc55' : (b._spawnBlocked ? '#ff7755'
                : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8')))));
        const nextText = paused ? '已暂停'
            : (b._spawnPopulationBlocked ? '军事人口已满'
                : (b._spawnFoodBlocked ? '粮食不足' : (b._spawnBlocked ? '出口阻塞' : `${nextIn}s`)));
        const individualLimit = b._hasIndividualUnitCap
            ? ` · 本建筑特色编制 <span style="color:#8ad0ff;">${b.aliveUnitCount()}/${b.unitCount()}</span>`
            : '';
        st.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span class="troop-panel-primary-label">等级 ${b.level}</span></div>
                <div class="troop-panel-resource-summary">金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span> · 粮食 <span style="color:#d9b84f;">${Math.floor(food)}</span></div>
            </div>
            <div class="troop-panel-copy">
                军事人口 <span id="pbMilitaryPopulation" style="color:#c7a7ff;">${military.used}/${military.capacity}</span>${individualLimit} ·
                当前生成 <span class="troop-panel-inline-unit">${renderTroopUnitIcon(b.unitType, 'inline')}<b>${curType}</b></span>（每名 ${CrossPlaneResourceSystem.quote({ food: b._unitSpawnFoodCost() }).food} 粮食）<br>
                招募状态 <b id="pbRecruitMode" style="color:${paused ? '#aab0b6' : '#7fe0c8'};">${recruitModeLabel(recruitMode)} · ${recruitStatusText(b)}</b> ·
                下次生成 <b id="pbSpawnNext" style="color:${b._spawnBlocked ? '#ff7755' : '#7fd4ff'};">${nextText}</b>（当前周期 ${(spawnMs / 1000).toFixed(1)}s）<br>
                ${upgradeSummary}
            </div>
            <div style="margin-top:8px;">
                <div class="troop-panel-progress-label" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span>🚀 出兵进度</span>
                    <span id="pbSpawnPct" style="color:${spawnBarColor};font-weight:700;">${spawnPct}%</span>
                </div>
                <div style="position:relative;height:10px;background:rgba(255,255,255,0.10);border-radius:5px;overflow:hidden;">
                    <div id="pbSpawnBar" style="position:absolute;left:0;top:0;bottom:0;width:${spawnPct}%;background:linear-gradient(90deg, ${spawnBarColor}, #7fe0c8);border-radius:5px;transition:width 0.2s linear;"></div>
                </div>
                <div class="troop-panel-caption" style="margin-top:2px;">默认暂停；单次只完成一名，持续模式在粮食和空位满足时循环招募</div>
            </div>`;

        const ut = el.querySelector('#pbUnitType');
        const btn = (u) => {
            const active = b.unitType === u.key;
            return `<button class="troop-panel-unit-button ${active ? 'is-active' : ''}" data-unit-type="${u.key}"
                data-technology-gate-type="unit" data-technology-gate-id="${u.key}"
                style="flex:1;cursor:var(--bp-cursor-pointer, pointer);">
                    <span class="troop-panel-unit-button-main">
                        ${renderTroopUnitIcon(u.key)}
                        <span class="troop-panel-unit-button-copy"><span>${u.name}</span><small>${u.roleLabel ? `${u.roleLabel} · ` : ''}${CrossPlaneResourceSystem.quote({ food: b._unitSpawnFoodCost(u.key) }).food} 粮食</small></span>
                    </span>
                </button>`;
        };
        ut.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="troop-panel-section-title">🎖 生成单位类型</span>
                <span class="troop-panel-caption">切换后按新兵种周期重新计时</span>
            </div>
            <div style="display:flex;gap:8px;">${b.getRecruitableUnitTypes().map(btn).join('')}</div>
            <div class="recruit-control-row">
                <button class="recruit-mode-btn ${recruitMode === RECRUIT_MODE.SINGLE ? 'is-active' : ''}" data-recruit-mode="single">单次招募</button>
                <button class="recruit-mode-btn ${recruitMode === RECRUIT_MODE.CONTINUOUS ? 'is-active' : ''}" data-recruit-mode="continuous">持续招募</button>
                <button class="recruit-mode-btn ${recruitMode === RECRUIT_MODE.PAUSED ? 'is-active' : ''}" data-recruit-mode="paused">暂停招募</button>
            </div>`;
        TechnologyGate.bindTree(ut);
        ut.querySelectorAll('[data-unit-type]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._setUnitType(btnEl.dataset.unitType));
        });
        ut.querySelectorAll('[data-recruit-mode]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._setRecruitMode(btnEl.dataset.recruitMode));
        });

        const modBox = el.querySelector('#pbModules');
        const rows = applicableModules.map(([mid, mod]) => {
            const targetKinds = b.moduleUnitTypes(mid);
            if (!targetKinds.length) return '';
            const targetUnitType = targetKinds[0];
            const lv = b.moduleLevel(mid, targetUnitType);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = b.canUpgradeModule(mid, targetUnitType);
            const cost = b.getModuleCost(mid, targetUnitType);
            const inProgress = !!(b._upgrade && b._upgrade.moduleId === mid);
            const continuous = b.isContinuousUpgrade('module', mid);
            const progPct = inProgress
                ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)
                : 0;
            const btnHtml = canBuy || maxedMod
                ? renderContinuousUpgradeActions({
                    maxed: maxedMod, inProgress, continuous, upgradeBusy: !!b._upgrade,
                    manualAttributes: `data-mod="${mid}" data-upgrade-kind="${targetUnitType}"`,
                    continuousAttributes: `data-module-cont="${mid}" data-cont-kind="${targetUnitType}"`,
                })
                : '<span class="troop-panel-caption">🔒 未知模块</span>';
            return renderBuildingUpgradeCard({
                rowAttribute: 'data-module-row', projectId: mid,
                icon: mod.icon, iconImage: mod.iconImage, name: mod.name, level: lv, maxLevel: mod.maxLevel,
                cost, maxed: maxedMod, inProgress, progressPct: progPct,
                remainMs: inProgress ? b._upgrade.remainMs : 0,
                statusText: continuous && !inProgress ? '持续升级已开启 · 等待条件与资源' : '',
                barId: `pbUpgradeBar_${mid}`, textId: `pbUpgradeText_${mid}`,
                actionsHtml: btnHtml, accent: '#8ad0ff',
            });
        }).join('');
        modBox.innerHTML = `
            <div class="troop-upgrade-panel-heading">
                <span class="troop-panel-section-title">✨ 单位升级（读条完成后全局生效）</span>
                <span class="troop-panel-caption troop-upgrade-panel-note">升级栏常态显示；同一张卡同步升级本建筑全部适用兵种，特殊项目仅对配置指定兵种生效。</span>
                <span class="troop-panel-section-meta troop-upgrade-panel-resources">持有 ${gold} 金 / ${energy} 能</span>
            </div>
            ${rows || '<div class="troop-panel-empty">暂无模块</div>'}`;
        modBox.querySelectorAll('[data-mod]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._upgrade(
                btnEl.dataset.mod, btnEl.dataset.upgradeKind));
        });
        modBox.querySelectorAll('[data-module-cont]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._toggleModuleContinuous(
                btnEl.dataset.moduleCont, btnEl.dataset.contKind));
        });
        modBox.querySelectorAll('[data-module-row]').forEach((rowEl) => {
            const moduleId = rowEl.dataset.moduleRow;
            rowEl.addEventListener('mouseenter', (ev) => this._showModuleTip(moduleId, ev));
            rowEl.addEventListener('mousemove', (ev) => this._moveAbilityTip(ev));
            rowEl.addEventListener('mouseleave', () => this._hideAbilityTip());
        });

        const sellBtn = el.querySelector('#pbSell');
        if (sellBtn) {
            sellBtn.style.display = '';
            const durability = Math.max(0, Math.min(1,
                Number(b.hp) / Math.max(1, Number(b.maxHp) || 1)));
            const refund = Math.floor((b._buildCost ?? cfg.cost)
                * (cfg.sellRefundRatio ?? 0.5) * durability);
            const refundUnit = (b._buildCurrency || cfg.currency) === 'gold' ? '金币' : '能源';
            sellBtn.title = `出售返还 ${refund} ${refundUnit}${isAbilityShop || isWarehouse || isPassive || isCandle || isPortal || isEconomy ? '' : '（军事单位一并拆除）'}`;
            sellBtn.onclick = () => {
                const res = b.sell();
                this._notify(res.ok ? `已出售（+${res.refund} ${refundUnit}）` : (res.reason || '出售失败'), res.ok ? '#ffd700' : '#ff5555');
                if (res.ok) this.close();
            };
        }
        if (isEconomy) {
            const population = PopulationEconomySystem.getPopulationSnapshot();
            if (cfg.economyType === 'weather_forecast') {
                const profile = WeatherForecastTowerSystem.getProfile(b);
                const research = PopulationEconomySystem.getWeatherForecastResearchSnapshot(b);
                const operational = WeatherForecastTowerSystem.isOperational(b);
                const forecastEvents = operational && typeof window !== 'undefined'
                    ? (window.WorldWeatherSystem?.getForecastEvents?.() || [])
                        .filter((event) => event.sceneId === SceneManager.currentScene)
                    : [];
                const nextEvent = forecastEvents[0] || null;
                this._weatherForecastSignature = forecastEvents
                    .map((event) => `${event.id}:${event.status}:${event.endsAtGameTimeMs || ''}`)
                    .join('|');
                const nowGameTimeMs = Math.max(0,
                    Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
                const dayDurationMs = Math.max(1,
                    Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
                const futureWeatherHtml = forecastEvents.length
                    ? forecastEvents.map((event) => {
                        const leadDays = Math.max(0,
                            (Number(event.atGameTimeMs) - nowGameTimeMs) / dayDurationMs);
                        const stateText = event.status === 'active'
                            ? '进行中' : `${leadDays.toFixed(2)} 天后`;
                        const detail = [event.intensityName, event.durationLabel, event.warningLabel]
                            .filter(Boolean).join(' · ');
                        return `<div><b>${event.icon || '🌦'} ${event.label}</b><span data-weather-future-time="${Number(event.atGameTimeMs)}" data-weather-active="${event.status === 'active'}" data-weather-detail="${detail}">${stateText}${detail ? ` · ${detail}` : ''}</span></div>`;
                    }).join('')
                    : '<div class="troop-panel-empty">监测范围内暂无已排定天气</div>';
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🌦 气象观测档案</span><span class="economy-panel-badge ${operational ? '' : 'is-blocked'}" id="pbWeatherStatus">${operational ? '正在监测本位面' : '等待气象员上岗'}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>当前位面</span><b>${SceneManager.scenes?.[SceneManager.currentScene]?.name || SceneManager.currentScene}</b></div>
                        <div><span>气象员岗位</span><b id="pbWeatherStaffed">${research.staffedCount}/${research.staffCapacity}</b></div>
                        <div><span>监测时间范围</span><b>${profile.horizonDays.toFixed(0)} 天</b></div>
                        <div><span>范围内天气</span><b>${forecastEvents.length} 项</b></div>
                        <div><span>下一天气</span><b>${nextEvent?.intensityName || '暂无'}</b></div>
                        <div><span>时段解析</span><b>${profile.showDuration ? '已启用' : '未启用'}</b></div>
                        <div><span>灾害预警</span><b>${profile.disasterWarning ? '本位面特殊天气' : '未启用'}</b></div>
                        <div><span>理论气象科研</span><b id="pbWeatherResearchConfigured">${research.configuredResearchPointsPerSecond.toFixed(2)} 点/秒</b></div>
                        <div><span>实际气象科研</span><b id="pbWeatherResearchActual">${research.actualResearchPointsPerSecond.toFixed(2)} 点/秒</b></div>
                        <div><span>工坊额外增效</span><b id="pbWeatherWorkshop">+${((research.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                        <div><span>科研集群增效</span><b id="pbWeatherCluster">+${Math.round(research.clusterBonus * 100)}% · ${research.clusterFacilityTypes.length}种</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <div class="economy-panel-heading" style="margin-top:10px;"><span>未来天气</span><span class="economy-panel-meta">只显示本塔所在位面</span></div>
                    <div class="weather-forecast-list">${futureWeatherHtml}</div>
                    <p class="economy-panel-note">默认显示监测时间范围内全部已排定天气；预报展望同时扩展时间范围并保留雨量等强度区分。没有气象员上岗时，本塔不提供预测或科研点。</p>`;

                const upgrade = b._weatherUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = WeatherForecastTowerSystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-weather-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-weather-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: WeatherForecastTowerSystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#79c9e8',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-weather-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>天气塔升级项目</span><span class="economy-panel-meta">需要科技“高级气象学”</span></div>
                    ${rows || '<div class="troop-panel-empty">天气塔升级配置缺失</div>'}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-weather-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeWeatherForecast(
                        button.dataset.weatherUpgrade));
                });
                modBox.querySelectorAll('[data-weather-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showWeatherForecastTip(
                        row.dataset.weatherRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'advanced_research') {
                const snapshot = PopulationEconomySystem.getAdvancedResearchSnapshot(b);
                const operating = snapshot.actualResearchPointsPerSecond > 0;
                const profile = cfg.researchFacility || {};
                const clusterPercent = Math.round(snapshot.clusterBonus * 100);
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>⚛️ ${cfg.name}科研档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbAdvancedResearchStatus">${operating ? '正在积累科研点' : (snapshot.staffedCount <= 0 ? `等待${profile.workerLabel || '科研人员'}上岗` : '人口容量不足')}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>科研设施层级</span><b>第 ${Math.max(2, Number(cfg.researchTier) || 2)} 级</b></div>
                        <div><span>基础科研</span><b id="pbAdvancedResearchConfigured">${snapshot.configuredResearchPointsPerSecond.toFixed(2)} 点/秒</b></div>
                        <div><span>上岗 / 容量</span><b id="pbAdvancedResearchStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>岗位发挥率</span><b>${Math.round(snapshot.staffFactor * 100)}%</b></div>
                        <div><span>实际科研速度</span><b id="pbAdvancedResearchActual">${snapshot.actualResearchPointsPerSecond.toFixed(2)} 点/秒</b></div>
                        <div><span>科研集群增效</span><b id="pbAdvancedResearchCluster">+${clusterPercent}% · ${snapshot.clusterFacilityTypes.length}种</b></div>
                        <div><span>工坊额外增效</span><b id="pbAdvancedResearchWorkshop">+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">${cfg.panelDescription || ''}</p>
                    <p class="economy-panel-note">产业集群只统计640px内已上岗且种类不同的科研设施：每种+3%，最高+12%；同类建筑不会重复叠层。最终产值仍统一经过全局科研软上限。</p>`;
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>科研设施状态</span><span class="economy-panel-meta">固定科研平台 · 暂无本栋升级项目</span></div>
                    <div class="troop-panel-empty">后续新增科技项目可继续向工程科研链扩展，不需要改写本栋结算器。</div>`;
                this._bindWorkforceControls(modBox);
            } else if (cfg.economyType === 'research') {
                const snapshot = PopulationEconomySystem.getResearchSnapshot(b);
                const operating = snapshot.actualResearchPointsPerSecond > 0;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🔬 研究所科研档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbResearchStatus">${operating ? '正在积累科研点' : (snapshot.staffedCount <= 0 ? '等待研究员上岗' : '人口容量不足')}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>科研设施层级</span><b>第 ${Math.max(1, Number(cfg.researchTier) || 1)} 级</b></div>
                        <div><span>本栋升级等级</span><b>Lv.${snapshot.level}</b></div>
                        <div><span>本级基础科研</span><b id="pbResearchLevelBase">${snapshot.levelBaseResearchPoints.toFixed(2)} 点/秒</b></div>
                        <div><span>本栋设备加成</span><b id="pbResearchEquipmentBonus">+${snapshot.equipmentBonus.toFixed(2)} 点/秒</b></div>
                        <div><span>上岗 / 容量</span><b id="pbResearchStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>100%理论科研</span><b id="pbResearchConfigured">${snapshot.configuredResearchPointsPerSecond.toFixed(2)} 点/秒</b></div>
                        <div><span>实际科研速度</span><b id="pbResearchActual">${snapshot.actualResearchPointsPerSecond.toFixed(2)} 点/秒</b></div>
                        <div><span>工坊额外增效</span><b id="pbResearchWorkshop">+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                        <div><span>科研集群增效</span><b id="pbResearchCluster">+${Math.round(snapshot.clusterBonus * 100)}% · ${snapshot.clusterFacilityTypes.length}种</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">每名上岗研究员提供 10% 科研效率；初始 6 个岗位全面运转时发挥 60%，扩编到 8/10 人后提升至 80%/100%。未安排研究员时不会积累任何科研点。</p>
                    <p class="economy-panel-note">科研点由所有位面的研究所共同累积并推进科技树；塔楼等级、研究员扩编和精密设备只强化本栋研究所，经济工坊范围增效照常生效。</p>`;

                const nextLevel = PopulationEconomySystem.getResearchUpgrade(b);
                const levelUpgrade = b._economyUpgrade;
                const levelProgress = levelUpgrade
                    ? Math.round((1 - levelUpgrade.remainMs / levelUpgrade.totalMs) * 100)
                    : 0;
                const maxResearchLevel = Math.max(1,
                    ...(populationEconomyConfig.research?.levels || [])
                        .map((entry) => Math.max(1, Math.floor(Number(entry.level) || 1))));
                const levelActions = nextLevel
                    ? `<button class="troop-panel-upgrade-button" data-research-level-upgrade
                        data-technology-gate-type="upgrade" data-technology-gate-id="${nextLevel.technologyUnlockId || ''}"
                        ${levelUpgrade ? 'disabled' : ''}>升级到 Lv.${nextLevel.level}</button>`
                    : '<span class="troop-panel-caption">已满级</span>';
                const levelCard = renderBuildingUpgradeCard({
                    rowAttribute: 'data-research-level-row', projectId: 'research_institute_level',
                    icon: '🏛️', iconImage: 'assets/ui/building-upgrades/research-tower-expansion.png',
                    name: '研究所塔楼扩建', level: snapshot.level,
                    maxLevel: maxResearchLevel, cost: nextLevel?.upgradeCost || null,
                    maxed: !nextLevel, inProgress: !!levelUpgrade,
                    progressPct: levelProgress, remainMs: levelUpgrade?.remainMs || 0,
                    barId: 'pbUpgradeBar_research_institute_level',
                    textId: 'pbUpgradeText_research_institute_level',
                    actionsHtml: levelActions, accent: '#d7b7ff',
                }).replace('class="building-upgrade-card"',
                    `class="building-upgrade-card" data-research-level-upgrading="${!!levelUpgrade}"`);

                const abilityRows = Object.entries(cfg.abilities || {})
                    .filter(([, ability]) => !ability.hidden)
                    .map(([abilityId, ability]) => {
                    const level = b.abilityLevel(abilityId);
                    const maxed = level >= (ability.maxLevel ?? 10);
                    const inProgress = !!(b._upgrade && b._upgrade.abilityId === abilityId);
                    const progressPct = inProgress
                        ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)
                        : 0;
                    const continuous = b.isContinuousUpgrade('ability', abilityId);
                    const actionsHtml = renderContinuousUpgradeActions({
                        maxed,
                        inProgress,
                        continuous,
                        upgradeBusy: !!b._upgrade,
                        manualAttributes: `data-ability-up="${abilityId}"`,
                        continuousAttributes: `data-ability-cont="${abilityId}"`,
                    });
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-research-ability-row', projectId: abilityId,
                        icon: ability.icon, iconImage: ability.iconImage, name: ability.name,
                        level, maxLevel: ability.maxLevel ?? 10,
                        cost: b.getAbilityCost(abilityId), maxed, inProgress, progressPct,
                        remainMs: inProgress ? b._upgrade.remainMs : 0,
                        statusText: continuous && !inProgress
                            ? '持续升级已开启 · 等待条件与资源' : '',
                        barId: `pbUpgradeBar_${abilityId}`,
                        textId: `pbUpgradeText_${abilityId}`,
                        actionsHtml, accent: '#c9a0ff',
                        technologyGateType: 'upgrade', technologyGateId: abilityId,
                    });
                    }).join('');
                const localUpgrade = b._researchUpgrade;
                const localRows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = PopulationEconomySystem.getResearchModuleLevel(b, moduleId);
                    const maxed = level >= (Number(module.maxLevel) || 0);
                    const inProgress = localUpgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - localUpgrade.remainMs / localUpgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-research-local-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${localUpgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-research-local-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: PopulationEconomySystem.getResearchModuleUpgradeCost(b, moduleId),
                        maxed, inProgress, progressPct,
                        remainMs: inProgress ? localUpgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`,
                        textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#7fe0c8',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-research-local-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>本栋研究所升级</span><span class="economy-panel-meta">只作用于当前建筑</span></div>
                    ${levelCard}
                    ${localRows || '<div class="troop-panel-empty">暂无本栋研究项目</div>'}
                    <div class="economy-panel-heading" style="margin-top:10px;"><span>全局通用研究</span><span class="economy-panel-meta">一次升级 · 所有位面共同生效</span></div>
                    ${abilityRows || '<div class="troop-panel-empty">暂无研究项目</div>'}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelector('[data-research-level-upgrade]')?.addEventListener('click', () => this._upgradeResearchLevel());
                modBox.querySelector('[data-research-level-row]')?.addEventListener('mouseenter', (event) => this._showResearchLevelTip(event));
                modBox.querySelector('[data-research-level-row]')?.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                modBox.querySelector('[data-research-level-row]')?.addEventListener('mouseleave', () => this._hideAbilityTip());
                modBox.querySelectorAll('[data-research-local-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeResearchModule(
                        button.dataset.researchLocalUpgrade));
                });
                modBox.querySelectorAll('[data-research-local-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showResearchModuleTip(
                        row.dataset.researchLocalRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                modBox.querySelectorAll('[data-ability-up]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeAbility(button.dataset.abilityUp, false));
                });
                modBox.querySelectorAll('[data-ability-cont]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeAbility(button.dataset.abilityCont, true));
                });
                modBox.querySelectorAll('[data-research-ability-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showAbilityTip(row.dataset.researchAbilityRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'wind_power_plant'
                || cfg.economyType === 'solar_power_plant') {
                this._renderWindPowerEconomy(st, modBox, b, cfg, population);
            } else if (cfg.economyType === 'planar_resonator') {
                const snapshot = PopulationEconomySystem.getPlanarResonatorSnapshot(b);
                const hasWarehouse = !!EnergyManager?.hasWarehouse?.();
                const warehouseFull = !!EnergyManager?.isFull?.();
                const operating = snapshot.actualEnergyPerSecond > 0 && hasWarehouse && !warehouseFull;
                const status = operating
                    ? '稳定发电'
                    : (snapshot.staffedCount <= 0
                        ? '等待技师上岗'
                        : (snapshot.laborEfficiency <= 0
                            ? '人口容量不足'
                            : (hasWarehouse && !warehouseFull ? '等待谐振' : '等待仓库空间')));
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🔮 位面谐振发电</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbResonatorStatus">${status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>谐振周期</span><b id="pbResonatorCycle">${(snapshot.cycleMs / 1000).toFixed(1)} 秒</b></div>
                        <div><span>晶核单轮产能</span><b id="pbResonatorPerCycle">${snapshot.energyPerCycle.toFixed(0)} 能源</b></div>
                        <div><span>导能回收率</span><b id="pbResonatorConversion">${(snapshot.conversionRate * 100).toFixed(0)}%</b></div>
                        <div><span>上岗 / 容量</span><b id="pbResonatorStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>满员配置产量</span><b id="pbResonatorConfiguredOutput">${snapshot.configuredEnergyPerSecond.toFixed(2)} 能源/秒</b></div>
                        <div><span>实际产量</span><b id="pbEconomyOutput">${snapshot.actualEnergyPerSecond.toFixed(2)} 能源/秒</b></div>
                        <div><span>工坊额外增效</span><b id="pbResonatorWorkshop">${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                        <div><span>待入库能源</span><b id="pbResonatorPending">${snapshot.pendingEnergy}</b></div>
                        <div><span>仓库能源 / 容量</span><b id="pbResonatorStorage">${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">每名上岗谐振技师发挥 25% 配置产能，4 名满效；人口超额会按全局人口效率降产，经济工坊的范围增效同样生效。</p>
                    <p class="economy-panel-note">产出的能源直接写入本位面真实仓库；仓库满时暂存在本栋结算余量，出现空间后继续入库，不会凭空丢失。</p>`;
                const upgrade = b._resonatorUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = PopulationEconomySystem.getResonatorModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-resonator-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-resonator-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: PopulationEconomySystem.getResonatorUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#a892ff',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-resonator-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>谐振塔升级项目</span><span class="economy-panel-meta">需要科技“谐振校准”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-resonator-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeResonator(button.dataset.resonatorUpgrade));
                });
                modBox.querySelectorAll('[data-resonator-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showResonatorTip(row.dataset.resonatorRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'field_hospital') {
                const snapshot = FieldHospitalSystem.getSnapshot(b);
                const operating = snapshot.patientCount > 0 && snapshot.actualHealingRate > 0;
                const status = operating
                    ? `正在治疗 ${snapshot.patientCount} 名友军`
                    : (snapshot.staffedCount > 0 ? '等待伤员进入范围' : '等待医护上岗');
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>⚕️ 战地救护站</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbHospitalStatus">${status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>治疗半径</span><b id="pbHospitalRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>满员治疗速度</span><b id="pbHospitalConfiguredRate">${(snapshot.configuredHealingRate * 100).toFixed(1)}% 最大生命/秒</b></div>
                        <div><span>实际治疗速度</span><b id="pbHospitalActualRate">${(snapshot.actualHealingRate * 100).toFixed(2)}% 最大生命/秒</b></div>
                        <div><span>上岗 / 岗位</span><b id="pbHospitalStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>接诊 / 容量</span><b id="pbHospitalPatients">${snapshot.patientCount}/${snapshot.patientCapacity}</b></div>
                        <div><span>配置病床</span><b id="pbHospitalBeds">${snapshot.configuredPatientCapacity}</b></div>
                        <div><span>工坊额外增效</span><b id="pbHospitalWorkshop">${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">优先治疗范围内生命比例最低的玩家与友军；每名医护发挥 20% 配置速度，同时接诊人数不超过上岗医护和病床容量。</p>
                    <p class="economy-panel-note">治疗只恢复仍然存活的单位，不会复活阵亡单位；多家医院范围重叠时，每名患者只接受实际治疗速度最高的一家医院治疗，不叠加回血。</p>`;
                const upgrade = b._hospitalUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = FieldHospitalSystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-hospital-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-hospital-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: FieldHospitalSystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#7fe0c8',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-hospital-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>医院升级项目</span><span class="economy-panel-meta">需要科技“医疗标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-hospital-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeHospital(button.dataset.hospitalUpgrade));
                });
                modBox.querySelectorAll('[data-hospital-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showHospitalTip(row.dataset.hospitalRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'armory') {
                const snapshot = ArmoryEconomySystem.getSnapshot(b);
                const operating = snapshot.staffedCount > 0;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🗡️ 军械维护档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}">${operating ? `发挥 ${(snapshot.staffFactor * 100).toFixed(0)}%` : '等待维护师上岗'}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>服务半径</span><b id="pbArmoryRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>配置减耗</span><b id="pbArmoryConfiguredReduction">-${(snapshot.configuredCostReduction * 100).toFixed(1)}%</b></div>
                        <div><span>实际减耗</span><b id="pbArmoryReduction">-${(snapshot.actualCostReduction * 100).toFixed(1)}%</b></div>
                        <div><span>上岗 / 容量</span><b id="pbArmoryStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>覆盖出兵建筑</span><b id="pbArmoryCovered">${snapshot.coveredProducerCount}</b></div>
                        <div><span>配置整理概率</span><b id="pbArmoryConfiguredStoneChance">${(snapshot.configuredStoneChance * 100).toFixed(1)}%/分钟</b></div>
                        <div><span>实际整理概率</span><b id="pbArmoryStoneChance">${(snapshot.actualStoneChance * 100).toFixed(2)}%/分钟</b></div>
                        <div><span>待入主神仓库</span><b id="pbArmoryPendingStones">${snapshot.pendingStones}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">范围内所有出兵建筑在真正招募时降低粮食等资源消耗；每名上岗维护师发挥 20% 配置效果，5 名满效，多栋军械库只取最强光环。</p>
                    <p class="economy-panel-note">资源整理每满 1 分钟独立判定一次，获得的强化石自动堆叠到主神空间仓库；仓库满时保留在本栋等待入库。</p>`;
                const upgrade = b._armoryUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = ArmoryEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-armory-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-armory-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: ArmoryEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#d8ad62',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-armory-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>军械库升级项目</span><span class="economy-panel-meta">需要科技“军需标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-armory-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeArmory(button.dataset.armoryUpgrade));
                });
                modBox.querySelectorAll('[data-armory-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showArmoryTip(row.dataset.armoryRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'workshop') {
                const snapshot = WorkshopEconomySystem.getSnapshot(b);
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🔧 自动化经济工坊</span><span class="economy-panel-badge ${snapshot.enemyBlocked ? 'is-blocked' : ''}" id="pbWorkshopSafety">${snapshot.enemyBlocked ? '敌情封锁，维修暂停' : '范围安全，可自动维修'}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>影响半径</span><b id="pbWorkshopRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>实际增效</span><b id="pbWorkshopEfficiency">+${(snapshot.actualEfficiency * 100).toFixed(1)}%</b></div>
                        <div><span>维修速度</span><b id="pbWorkshopRepair">${(snapshot.repairRate * 100).toFixed(1)}%/秒</b></div>
                        <div><span>上岗 / 容量</span><b id="pbWorkshopStaffed">${snapshot.staffedEngineerCount}/${snapshot.engineerCount}</b></div>
                        <div><span>派遣 / 维修中</span><b><span id="pbWorkshopEngineers">${snapshot.assignedCount}</span> / <span id="pbWorkshopRepairing">${snapshot.repairingCount}</span></b></div>
                    </div>
                    <p class="economy-panel-note">范围内存在敌方单位时停止自动维修；只有已安排人口的工程师才会生成并工作，抵达目标后才恢复生命。每名上岗工程师发挥 20% 配置效果，同一建筑只取最强工坊光环。</p>`;
                const upgrade = b._workshopUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = WorkshopEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-workshop-upgrade="${moduleId}" ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-workshop-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                        cost: WorkshopEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#77c8d9',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-workshop-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>工坊升级项目</span><span class="economy-panel-meta">持有 <span class="economy-unit-gold">${gold} 金</span> / <span class="economy-unit-energy">${energy} 能</span></span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-workshop-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeWorkshop(button.dataset.workshopUpgrade));
                });
                modBox.querySelectorAll('[data-workshop-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showWorkshopTip(row.dataset.workshopRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
            } else if (cfg.economyType === 'housing') {
                const current = populationEconomyConfig.house?.levels?.find((entry) => entry.level === b._economyLevel);
                const next = PopulationEconomySystem.getHouseUpgrade(b);
                const upgrade = b._economyUpgrade;
                const progress = upgrade ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100) : 0;
                const maxHouseLevel = Math.max(1, ...(populationEconomyConfig.house?.levels || [])
                    .map((entry) => Math.max(1, Math.floor(Number(entry.level) || 1))));
                st.innerHTML = `
                <div class="economy-panel-heading">
                    <span>🏠 房屋</span>
                    <span class="economy-panel-meta">Lv.${b._economyLevel}</span>
                </div>
                <div class="economy-stat-grid">
                    <div><span>本栋容纳</span><b>${current?.populationCapacity || 0}</b></div>
                    <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                </div>
                <p class="economy-panel-note">本栋只提供人口容量；超额人口会降低所有经济岗位的人口效率。</p>`;
                const actionsHtml = next
                    ? `<button class="troop-panel-upgrade-button" data-house-upgrade
                        data-technology-gate-type="upgrade" data-technology-gate-id="${next.technologyUnlockId || ''}"
                        ${upgrade ? 'disabled' : ''}>升级</button>`
                    : '<span class="troop-panel-caption">已满级</span>';
                const houseCard = renderBuildingUpgradeCard({
                    rowAttribute: 'data-house-row', projectId: 'house_capacity',
                    icon: '🏠', iconImage: 'assets/ui/building-upgrades/living-space-expansion.png',
                    name: '居住空间', level: b._economyLevel, maxLevel: maxHouseLevel,
                    cost: next?.upgradeCost || null, maxed: !next,
                    inProgress: !!upgrade, progressPct: progress,
                    remainMs: upgrade?.remainMs || 0,
                    barId: 'pbUpgradeBar_house_capacity', textId: 'pbUpgradeText_house_capacity',
                    actionsHtml, accent: '#ffe08a',
                }).replace('class="building-upgrade-card"',
                    `class="building-upgrade-card" data-house-upgrading="${!!upgrade}"`);
                modBox.innerHTML = `
                    <div class="economy-panel-heading"><span>房屋升级项目</span><span class="economy-panel-meta">当前 Lv.${b._economyLevel}</span></div>
                    ${houseCard}`;
                modBox.querySelector('[data-house-upgrade]')?.addEventListener('click', () => this._upgradeHouse());
                modBox.querySelector('[data-house-row]')?.addEventListener('mouseenter', (event) => this._showHouseTip(event));
                modBox.querySelector('[data-house-row]')?.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                modBox.querySelector('[data-house-row]')?.addEventListener('mouseleave', () => this._hideAbilityTip());
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'bakery') {
                const snapshot = BakeryEconomySystem.getSnapshot(b);
                const operating = (b._assignedWorkers || 0) > 0
                    && snapshot.roadConnected
                    && snapshot.phase !== 'idle' && snapshot.phase !== 'waiting_deposit';
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🍞 面包屋生产档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbBakeryStatus">${snapshot.status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>每批投入</span><b>${snapshot.inputFood} 粮食</b></div>
                        <div><span>处理时间</span><b id="pbBakeryProcess">${(snapshot.processTimeMs / 1000).toFixed(1)} 秒</b></div>
                        <div><span>产出倍率</span><b id="pbBakeryMultiplier">${snapshot.outputMultiplier.toFixed(1)} 倍</b></div>
                        <div><span>天气影响</span><b id="pbBakeryWeather">${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}</b></div>
                        <div><span>每批产出</span><b id="pbBakeryOutput" class="economy-unit-food">${snapshot.outputFood} 粮食</b></div>
                        <div><span>植物祭品概率</span><b id="pbBakeryTributeChance">${(snapshot.plantTributeChance * 100).toFixed(1)}%</b></div>
                        <div><span>面包师移速</span><b id="pbBakeryMoveSpeed">${snapshot.moveSpeed.toFixed(0)}px/s</b></div>
                        <div><span>已完成批次</span><b id="pbBakeryBatches">${snapshot.completedBatches}</b></div>
                        <div><span>待入主神仓库祭品</span><b id="pbBakeryPendingTributes">${snapshot.pendingTributes}</b></div>
                        <div><span>位面粮食</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note is-danger" id="pbBakeryRoadWarning" ${snapshot.roadConnected ? 'hidden' : ''}>需要道路连接：面包屋必须通过连续道路连接到至少一座仓库。</p>
                    <p class="economy-panel-note">面包师从真实仓库取出 50 粮食，返回面包屋加工，再把成品搬回有空位的仓库；缺粮或满仓时等待，不会凭空结算。</p>
                    <p class="economy-panel-note">道路只决定工作资格；关闭居民动画不会停止生产。</p>`;
                const upgrade = b._bakeryUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = BakeryEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-bakery-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-bakery-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                        cost: BakeryEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#d99546',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-bakery-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>面包屋升级项目</span><span class="economy-panel-meta">需要科技“烘焙工艺”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-bakery-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeBakery(button.dataset.bakeryUpgrade));
                });
                modBox.querySelectorAll('[data-bakery-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showBakeryTip(row.dataset.bakeryRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'chain_restaurant') {
                const snapshot = BakeryEconomySystem.getSnapshot(b);
                const operating = (b._assignedWorkers || 0) > 0
                    && snapshot.roadConnected
                    && snapshot.phase !== 'idle' && snapshot.phase !== 'waiting_deposit';
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🍽️ 连锁餐馆生产档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbRestaurantStatus">${snapshot.status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>外卖员</span><b>${b._assignedWorkers || 0}/1</b></div>
                        <div><span>每批投入</span><b id="pbRestaurantInput" class="economy-unit-food">${snapshot.inputFood} 食物</b></div>
                        <div><span>加工时间</span><b id="pbRestaurantProcess">${(snapshot.processTimeMs / 1000).toFixed(1)} 秒</b></div>
                        <div><span>产出倍率</span><b id="pbRestaurantMultiplier">${snapshot.outputMultiplier.toFixed(1)} 倍</b></div>
                        <div><span>天气影响</span><b id="pbRestaurantWeather">${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}</b></div>
                        <div><span>每批产出</span><b id="pbRestaurantOutput" class="economy-unit-food">${snapshot.outputFood} 食物</b></div>
                        <div><span>外卖员移速</span><b id="pbRestaurantMoveSpeed">${snapshot.moveSpeed.toFixed(0)}px/s</b></div>
                        <div><span>已完成批次</span><b id="pbRestaurantBatches">${snapshot.completedBatches}</b></div>
                        <div><span>待返仓成品</span><b id="pbRestaurantPending" class="economy-unit-food">${snapshot.pendingFood}</b></div>
                        <div><span>位面粮食</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note is-danger" id="pbRestaurantRoadWarning" ${snapshot.roadConnected ? 'hidden' : ''}>需要道路连接：连锁餐馆必须通过连续道路连接到至少一座仓库。</p>
                    <p class="economy-panel-note">外卖员从可达仓库领取食材，沿道路返店加工，再把成品送回有容量的仓库；基础批次为 80 → 640 食物，缺粮、断路或满仓时冻结当前任务。</p>
                    <p class="economy-panel-note">人口效率影响移动与工作，范围工坊缩短加工时间；酒馆与全局生产倍率只提高最终成品。</p>`;
                const upgrade = b._bakeryUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = BakeryEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-restaurant-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-restaurant-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: BakeryEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#d9a441',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-restaurant-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>连锁餐馆升级项目</span><span class="economy-panel-meta">需要科技“中央厨房标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-restaurant-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeChainRestaurant(
                        button.dataset.restaurantUpgrade
                    ));
                });
                modBox.querySelectorAll('[data-restaurant-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showChainRestaurantTip(
                        row.dataset.restaurantRow,
                        event
                    ));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'cheese_farm') {
                const snapshot = CheeseFarmSystem.getSnapshot(b);
                const operating = (b._assignedWorkers || 0) > 0
                    && snapshot.roadConnected && snapshot.phase !== 'waiting_deposit';
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🧀 奶酪农场生产档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbCheeseStatus">${snapshot.status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>牛倌</span><b>${b._assignedWorkers || 0}/1</b></div>
                        <div><span>黑白奶牛</span><b id="pbCheeseCows">${snapshot.cowCount} 头</b></div>
                        <div><span>熟成时间</span><b id="pbCheeseProcess">${(snapshot.processTimeMs / 1000).toFixed(1)} 秒</b></div>
                        <div><span>天气影响</span><b id="pbCheeseWeather">${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}</b></div>
                        <div><span>每批产出</span><b id="pbCheeseOutput" class="economy-unit-food">${snapshot.outputFood} 食物</b></div>
                        <div><span>牛倌移速</span><b id="pbCheeseMoveSpeed">${snapshot.moveSpeed.toFixed(0)}px/s</b></div>
                        <div><span>已完成批次</span><b id="pbCheeseBatches">${snapshot.completedBatches}</b></div>
                        <div><span>牛倌携带</span><b id="pbCheesePending" class="economy-unit-food">${snapshot.pendingFood}</b></div>
                        <div><span>位面粮食</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                    </div>
                    <p class="economy-panel-note is-danger" id="pbCheeseRoadWarning" ${snapshot.roadConnected ? 'hidden' : ''}>需要道路连接：奶酪农场必须通过连续道路连接到至少一座仓库。</p>
                    <p class="economy-panel-note">牛倌在牧场完成熟成后抱着奶酪沿道路送入真实仓库，再空手返回；满仓时会携货等待。</p>
                    <p class="economy-panel-note">奶牛只在前方草地、右侧草地和两者之间的安全通道活动；视觉始终位于本栋房屋与栅栏之上，多头奶牛按脚点前后顺序互相遮挡。</p>`;
                const upgrade = b._cheeseFarmUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = CheeseFarmSystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-cheese-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-cheese-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: CheeseFarmSystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#d8a23b',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-cheese-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>奶酪农场升级图表</span><span class="economy-panel-meta">需要科技“奶酪标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-cheese-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeCheeseFarm(button.dataset.cheeseUpgrade));
                });
                modBox.querySelectorAll('[data-cheese-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showCheeseFarmTip(row.dataset.cheeseRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'steam_power_plant') {
                const snapshot = SteamPowerPlantSystem.getSnapshot(b);
                const operating = !snapshot.blockReason;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>♨️ 蒸汽电站生产档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbSteamStatus">${snapshot.status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>锅炉工</span><b>${snapshot.assignedWorkers}/${snapshot.workerSlots}</b></div>
                        <div><span>每人每批投入</span><b id="pbSteamFood" class="economy-unit-food">${snapshot.inputFood} 食物</b></div>
                        <div><span>锅炉处理时间</span><b id="pbSteamProcess">${(snapshot.processTimeMs / 1000).toFixed(1)} 秒</b></div>
                        <div><span>每人每批产出</span><b id="pbSteamEnergy" class="economy-unit-energy">${snapshot.energyPerBatch} 能源</b></div>
                        <div><span>锅炉工移速</span><b id="pbSteamMoveSpeed">${snapshot.moveSpeed.toFixed(0)}px/s</b></div>
                        <div><span>已完成批次</span><b id="pbSteamBatches">${snapshot.completedBatches}</b></div>
                        <div><span>待入库能源</span><b id="pbSteamPending" class="economy-unit-energy">${snapshot.pendingEnergy}</b></div>
                        <div><span>可达仓库</span><b>${snapshot.connectedWarehouseCount}${snapshot.roadDistance == null ? '' : ` · 路距 ${snapshot.roadDistance}`}</b></div>
                        <div><span>位面食物</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                        <div><span>仓库能源</span><b id="pbSteamStorage" class="economy-unit-energy">${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note is-danger" id="pbSteamRoadWarning" ${snapshot.roadConnected ? 'hidden' : ''}>需要道路连接：蒸汽电站必须通过连续道路连接到至少一座仓库。</p>
                    <p class="economy-panel-note">每名锅炉工独立沿复用的最短道路路线取粮、返回锅炉加工，再把能源送回可达仓库；缺粮或满仓时等待。</p>
                    <p class="economy-panel-note">关闭居民动画只卸载锅炉工精灵与动画素材，不会停止道路判断、耗粮或发电。</p>`;
                const upgrade = b._steamUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = SteamPowerPlantSystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-steam-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-steam-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: SteamPowerPlantSystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#b86f32',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-steam-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>蒸汽电站升级项目</span><span class="economy-panel-meta">需要科技“蒸汽工业标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-steam-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeSteamPlant(button.dataset.steamUpgrade));
                });
                modBox.querySelectorAll('[data-steam-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showSteamPlantTip(row.dataset.steamRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'deep_drill') {
                const snapshot = DeepDrillSystem.getSnapshot(b);
                const operating = snapshot.actualEnergyPerSecond > 0;
                const status = operating
                    ? (snapshot.usingDeepVein ? '正在开采深层矿脉' : '正在持续采掘')
                    : (snapshot.staffedCount <= 0 ? '等待深钻工上岗'
                        : (!snapshot.hasWarehouse ? '等待能源仓库'
                            : (snapshot.warehouseFull ? '仓库已满'
                                : (snapshot.nodeCount <= 0 ? '范围内无可采矿脉' : '人口容量不足'))));
                const targetDistance = snapshot.target
                    ? `${Math.round(Math.hypot(snapshot.target.x - b.x, snapshot.target.y - b.y))}px`
                    : '—';
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>⛏️ 深钻采掘档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbDeepDrillStatus">${status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>采掘半径</span><b>${Math.round(snapshot.range)}px</b></div>
                        <div><span>上岗 / 岗位</span><b>${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>范围内矿脉</span><b id="pbDeepDrillNodes">${snapshot.usingDeepVein ? '0（已转深层）' : snapshot.nodeCount}</b></div>
                        <div><span>矿脉剩余储量</span><b id="pbDeepDrillRemaining">${snapshot.usingDeepVein ? '无限（深层矿脉）' : `${Math.ceil(snapshot.remainingEnergy)} 能源`}</b></div>
                        <div><span>当前矿脉距离</span><b>${targetDistance}</b></div>
                        <div><span>满员基础采速</span><b>${snapshot.configuredExtractionPerSecond.toFixed(2)} 储量/秒</b></div>
                        <div><span>经济增效倍率</span><b>×${snapshot.outputMultiplier.toFixed(3)}</b></div>
                        <div><span>实际入仓效率</span><b id="pbDeepDrillActual">${snapshot.actualEnergyPerSecond.toFixed(2)} 能源/秒</b></div>
                        <div><span>最近结算入仓</span><b id="pbDeepDrillLast">${Math.floor(snapshot.lastMined)} 能源</b></div>
                        <div><span>仓库能源 / 容量</span><b id="pbDeepDrillStorage">${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">深钻井按由近到远的顺序，自动采空 600px 范围内的裸露矿脉；完成“深层钻头”后，地表矿脉枯竭即转入无限深层矿脉，原有采速与产出倍率不变。</p>
                    <p class="economy-panel-note">每名深钻工提供四分之一满效岗位；人口超额会降效，范围内经济工坊和正在服务的酒馆会提高最终入仓产量。</p>`;
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>深钻井岗位</span><span class="economy-panel-meta">初始 4 个标准人口岗位</span></div>`;
                this._bindWorkforceControls(modBox);
            } else if (cfg.economyType === 'tavern') {
                const snapshot = TavernEconomySystem.getSnapshot(b);
                const blocked = !!snapshot.blockReason;
                const roadText = snapshot.roadConnected
                    ? `${snapshot.connectedWarehouseCount} 座${snapshot.roadDistance == null ? '' : ` · 路距 ${snapshot.roadDistance}`}`
                    : '未连接';
                const warningText = {
                    unstaffed: '无酒保上岗：任务冻结，宴饮增效停止。',
                    road_disconnected: '道路中断：运输阶段冻结；已送达的宴饮服务仍持续到本批结束。',
                    food_shortage: '可达仓库食物不足，酒保在酒馆等待。',
                }[snapshot.blockReason] || '';
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🍻 三层酒馆经营档案</span><span class="economy-panel-badge ${blocked ? 'is-blocked' : ''}" id="pbTavernStatus">${snapshot.status}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>酒保岗位</span><b>${snapshot.assignedWorkers}/${snapshot.workerSlots}</b></div>
                        <div><span>道路 / 仓库</span><b id="pbTavernRoad">${roadText}</b></div>
                        <div><span>当前携粮</span><b id="pbTavernCargo" class="economy-unit-food">${snapshot.cargoFood}/${snapshot.inputFood} 食物</b></div>
                        <div><span>每批成本</span><b id="pbTavernBatchFood" class="economy-unit-food">${snapshot.inputFood} 食物</b></div>
                        <div><span>配置增效</span><b id="pbTavernConfigured">×${snapshot.configuredMultiplier.toFixed(3)}</b></div>
                        <div><span>当前增效</span><b id="pbTavernActual">×${snapshot.actualMultiplier.toFixed(3)}</b></div>
                        <div><span>服务剩余</span><b id="pbTavernServiceRemain">${snapshot.serving ? `${(snapshot.serviceRemainMs / 1000).toFixed(1)} 秒` : '—'}</b></div>
                        <div><span>酒保移速</span><b id="pbTavernMoveSpeed">${snapshot.moveSpeed.toFixed(0)}px/s</b></div>
                        <div><span>完成批次</span><b id="pbTavernBatches">${snapshot.completedBatches}</b></div>
                        <div><span>位面食物</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note is-danger" id="pbTavernWarning" ${warningText ? '' : 'hidden'}>${warningText}</p>
                    <p class="economy-panel-note">服务期间，风车、面包屋、矿工营地、蒸汽电站、位面谐振塔、银行、皇家铸币局、研究所与天气预测塔的最终产出乘算提高；市场、医院、军械库、住房、工坊和酒馆自身不受影响。</p>
                    <p class="economy-panel-note">酒保到达仓库时只扣一次粮食；运输断路会原地续作，已开始的宴饮不会因断路提前结束。关闭居民动画只卸载酒保精灵，不停止任务。</p>`;
                const upgrade = b._tavernUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = TavernEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-tavern-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-tavern-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: TavernEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#8f3f35',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-tavern-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>酒馆升级项目</span><span class="economy-panel-meta">需要科技“宴饮标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-tavern-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeTavern(button.dataset.tavernUpgrade));
                });
                modBox.querySelectorAll('[data-tavern-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showTavernTip(row.dataset.tavernRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'stock_exchange'
                || cfg.economyType === 'computing_center') {
                const isComputing = cfg.economyType === 'computing_center';
                const snapshot = isComputing
                    ? PopulationEconomySystem.getComputingCenterSnapshot(b)
                    : PopulationEconomySystem.getStockExchangeSnapshot(b);
                const operating = snapshot.canOperate;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>${isComputing ? '🖥️ 算力重心运行档案' : '📈 证券交易所行情档案'}</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbExchangeStatus">${operating ? (isComputing ? '算力集群运转中' : '交易运转中') : (snapshot.staffedCount <= 0 ? '等待职员上岗' : '仓库能源不足')}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>上岗 / 岗位</span><b id="pbExchangeStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>人口效率</span><b id="pbExchangeLabor">${(snapshot.laborEfficiency * 100).toFixed(1)}%</b></div>
                        <div><span>基础收益</span><b id="pbExchangeBase" class="economy-unit-gold">${snapshot.baseContribution.toFixed(2)} 金币/秒</b></div>
                        <div><span>位面总人口</span><b id="pbExchangePopulation">${snapshot.population}</b></div>
                        <div><span>人口收益系数</span><b id="pbExchangePopulationRate">${snapshot.populationRate.toFixed(3)} 金币/人/秒</b></div>
                        <div><span>人口收益</span><b id="pbExchangePopulationGold" class="economy-unit-gold">${snapshot.populationContribution.toFixed(2)} 金币/秒</b></div>
                        <div><span>玩家总金币</span><b id="pbExchangePlayerGold" class="economy-unit-gold">${Math.floor(snapshot.playerTotalGold)}</b></div>
                        <div><span>资本收益系数</span><b id="pbExchangeBalanceRate">${(snapshot.goldBalanceRate * 100).toFixed(4)}%/秒</b></div>
                        <div><span>资本收益</span><b id="pbExchangeBalanceGold" class="economy-unit-gold">${snapshot.goldBalanceContribution.toFixed(2)} 金币/秒</b></div>
                        <div><span>最终金币产出</span><b id="pbExchangeGold" class="economy-unit-gold">${snapshot.goldPerSecond.toFixed(2)} 金币/秒</b></div>
                        <div><span>能源消耗</span><b id="pbExchangeEnergy" class="economy-unit-energy">${snapshot.energyPerSecond.toFixed(2)} 能源/秒</b></div>
                        <div><span>仓库能源</span><b id="pbExchangeStorage" class="economy-unit-energy">${Math.floor(snapshot.storedEnergy)} 能源</b></div>
                        <div><span>结算周期</span><b>${(snapshot.settlementIntervalMs / 1000).toFixed(1)} 秒</b></div>
                        <div><span>建筑占地</span><b>4×4</b></div>
                    </div>
                    <p class="economy-panel-note">每秒公式：基础收益 + 位面人口收益 + 玩家总金币资本收益，再乘岗位效率与全局人口效率；玩家总金币按背包与主神空间仓库合计。</p>
                    <p class="economy-panel-note">该资本建筑不套用工坊、酒馆与全局生产倍率，也不改变市场价格或市场压力。每个位面只能建造一座。</p>`;
                const upgrade = isComputing ? b._computingCenterUpgrade : null;
                const rows = isComputing ? Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = PopulationEconomySystem.getComputingCenterModuleLevel(b, moduleId);
                    const maxed = level >= (Number(module.maxLevel) || 0);
                    const inProgress = upgrade?.moduleId === moduleId;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-computing-upgrade="${moduleId}" data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}" ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-computing-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: PopulationEconomySystem.getComputingCenterUpgradeCost(b, moduleId),
                        maxed, inProgress,
                        progressPct: inProgress
                            ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100) : 0,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#6ca8ff',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-computing-upgrading="${inProgress}"`);
                }).join('') : '<div class="troop-panel-empty">证券交易所采用固定岗位与固定公式，没有本栋升级项目。</div>';
                modBox.innerHTML = `${this._renderWorkforceControls(b)}${isComputing
                    ? '<div class="economy-panel-heading"><span>算力重心升级项目</span><span class="economy-panel-meta">需要科技“算力标准化”</span></div>'
                    : ''}${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-computing-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeComputingCenter(button.dataset.computingUpgrade));
                });
                modBox.querySelectorAll('[data-computing-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showComputingCenterTip(row.dataset.computingRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'grand_mall') {
                const snapshot = PopulationEconomySystem.getGrandMallSnapshot(b);
                const operating = snapshot.canOperate;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🏬 大商场营业档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbMallStatus">${operating ? '正在营业' : (snapshot.staffedCount <= 0 ? '等待职员上岗' : (snapshot.servicePopulation <= 0 ? '范围内没有人口' : '仓库能源不足'))}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>上岗 / 容量</span><b id="pbMallStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>岗位效率</span><b id="pbMallStaffEfficiency">${(snapshot.staffEfficiency * 100).toFixed(0)}%</b></div>
                        <div><span>服务半径</span><b id="pbMallRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>覆盖房屋</span><b id="pbMallHouses">${snapshot.coveredHouseCount}</b></div>
                        <div><span>覆盖人口</span><b id="pbMallPopulation">${snapshot.servicePopulation}</b></div>
                        <div><span>金币产出</span><b id="pbMallGold" class="economy-unit-gold">${snapshot.goldPerSecond.toFixed(2)} 金币/秒</b></div>
                        <div><span>能源消耗</span><b id="pbMallEnergy" class="economy-unit-energy">${snapshot.energyPerSecond.toFixed(2)} 能源/秒</b></div>
                        <div><span>仓库能源</span><b id="pbMallStorage" class="economy-unit-energy">${Math.floor(snapshot.storedEnergy)} 能源</b></div>
                        <div><span>人口效率</span><b id="pbMallLabor">${(snapshot.laborEfficiency * 100).toFixed(1)}%</b></div>
                        <div><span>工坊倍率</span><b id="pbMallWorkshop">×${snapshot.workshopMultiplier.toFixed(3)}</b></div>
                        <div><span>酒馆倍率</span><b id="pbMallTavern">×${snapshot.tavernMultiplier.toFixed(3)}</b></div>
                        <div><span>结算周期</span><b>${(snapshot.settlementIntervalMs / 1000).toFixed(1)} 秒</b></div>
                    </div>
                    <p class="economy-panel-note">每名商场职员固定提供 10% 工作效率；初始 6 个岗位满编为 60%，通过“柜台扩编”达到 10 人时为 100%。不生成员工精灵。</p>
                    <p class="economy-panel-note">金币按“覆盖人口 × 单位人口收益 × 岗位效率 × 人口效率 × 工坊 × 酒馆 × 全局生产”乘算；能源只按覆盖人口、岗位效率与人口效率消耗，不影响市场价格或市场压力。</p>`;
                const upgrade = b._grandMallUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = GrandMallEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= (Number(module.maxLevel) || 0);
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-mall-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-mall-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: GrandMallEconomySystem.getUpgradeCost(b, moduleId),
                        maxed, inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#d79b45',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-mall-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>大商场升级项目</span><span class="economy-panel-meta">需要科技“商场标准化”</span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-mall-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeGrandMall(button.dataset.mallUpgrade));
                });
                modBox.querySelectorAll('[data-mall-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showGrandMallTip(row.dataset.mallRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'royal_mint') {
                const snapshot = PopulationEconomySystem.getMintSnapshot(b);
                const operating = snapshot.staffedCount > 0 && snapshot.canAffordSettlement;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🪙 皇家铸币档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbMintStatus">${operating ? '正在铸币' : (snapshot.staffedCount <= 0 ? '等待铸币工上岗' : snapshot.resourceBlockReason)}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>上岗 / 容量</span><b id="pbMintStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                        <div><span>单人单批产金</span><b id="pbMintGoldPerWorker" class="economy-unit-gold">${snapshot.goldPerWorker.toFixed(2)} 金币/人/批</b></div>
                        <div><span>单人单批耗能</span><b id="pbMintEnergyPerWorker" class="economy-unit-energy">${snapshot.energyPerWorker.toFixed(0)} 能源/人/批</b></div>
                        <div><span>单人单批食物</span><b id="pbMintFoodPerWorker" class="economy-unit-food">${snapshot.foodPerWorker.toFixed(0)} 食物/人/批</b></div>
                        <div><span>铸币周期</span><b id="pbMintInterval">${(snapshot.settlementIntervalMs / 1000).toFixed(2)} 秒</b></div>
                        <div><span>本批实际金币</span><b id="pbMintSettlementGold" class="economy-unit-gold">${snapshot.goldPerSettlement.toFixed(2)} 金币</b></div>
                        <div><span>本批能源消耗</span><b id="pbMintSettlementEnergy" class="economy-unit-energy">${snapshot.energyPerSettlement} 能源</b></div>
                        <div><span>本批食物消耗</span><b id="pbMintSettlementFood" class="economy-unit-food">${snapshot.foodPerSettlement} 食物</b></div>
                        <div><span>平均金币产出</span><b id="pbMintGoldPerSecond" class="economy-unit-gold">${snapshot.goldPerSecond.toFixed(2)} 金币/秒</b></div>
                        <div><span>平均能源消耗</span><b id="pbMintEnergyPerSecond" class="economy-unit-energy">${snapshot.energyPerSecond.toFixed(2)} 能源/秒</b></div>
                        <div><span>平均食物消耗</span><b id="pbMintFoodPerSecond" class="economy-unit-food">${snapshot.foodPerSecond.toFixed(2)} 食物/秒</b></div>
                        <div><span>仓库现有能源</span><b id="pbMintStorage" class="economy-unit-energy">${Math.floor(snapshot.storedEnergy)} 能源</b></div>
                        <div><span>仓库现有食物</span><b id="pbMintFoodStorage" class="economy-unit-food">${Math.floor(snapshot.storedFood)} 食物</b></div>
                        <div><span>工坊额外增效</span><b id="pbMintWorkshop">+${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">不依赖房屋覆盖，也不参与银行重叠衰减；每批必须同时从本位面仓库扣除能源，以及每名上岗铸币工固定 60 食物。任一资源不足时批次停在就绪态。</p>
                    <p class="economy-panel-note">人口超额会降低本批产金和耗能，但固定岗位食物成本不变；经济工坊只提高金币产出。金币仍按背包 → 主神空间仓库 → 建筑坐标掉落的顺序存放。每个位面只能建造一座皇家铸币局。</p>`;
                const upgrade = b._mintUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = PopulationEconomySystem.getMintModuleLevel(b, moduleId);
                    const maxed = level >= (Number(module.maxLevel) || 0);
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-mint-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-mint-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: PopulationEconomySystem.getMintUpgradeCost(b, moduleId),
                        maxed, inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`,
                        textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#e5b84f',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-mint-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>皇家铸币局升级项目</span><span class="economy-panel-meta">需要科技“铸币标准化”</span></div>
                    ${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-mint-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeMint(
                        button.dataset.mintUpgrade));
                });
                modBox.querySelectorAll('[data-mint-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showMintTip(
                        row.dataset.mintRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'bank') {
                const snapshot = PopulationEconomySystem.getBankSnapshot(b);
                const effectivePopulation = snapshot.effectiveServicePopulation.toFixed(2);
                const overlapBlocked = snapshot.servicePopulation > 0
                    && snapshot.effectiveServicePopulation <= 0;
                const operating = snapshot.assignedWorkers > 0
                    && snapshot.effectiveServicePopulation > 0;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🏦 银行服务档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbBankStatus">${operating ? `有效 ${effectivePopulation} 人` : (overlapBlocked ? '三家重叠：无收益' : '等待职员与服务人口')}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>服务半径</span><b id="pbBankRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>覆盖房屋</span><b id="pbBankHouses">${snapshot.coveredHouseCount}</b></div>
                        <div><span>原始服务人口</span><b id="pbBankServicePopulation">${snapshot.servicePopulation}</b></div>
                        <div><span>折算有效人口</span><b id="pbBankEffectivePopulation">${effectivePopulation}</b></div>
                        <div><span>重叠房屋</span><b id="pbBankOverlap">${snapshot.overlappedHouseCount} 栋 / 最高 ${snapshot.maxBankOverlapCount} 家</b></div>
                        <div><span>每人每轮</span><b id="pbBankPerPopulation" class="economy-unit-gold">${(snapshot.goldPerPopulation * 100).toFixed(0)}%</b></div>
                        <div><span>结算周期</span><b id="pbBankInterval">${(snapshot.settlementIntervalMs / 1000).toFixed(2)} 秒</b></div>
                        <div><span>本轮金币</span><b id="pbBankSettlementGold" class="economy-unit-gold">${snapshot.goldPerSettlement.toFixed(2)} 金币</b></div>
                        <div><span>平均产出</span><b id="pbEconomyOutput" class="economy-unit-gold">${snapshot.goldPerSecond.toFixed(2)} 金币/秒</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">只统计服务范围内存活房屋的当前人口容量；单轮金币同时受上岗职员、人口效率和经济工坊增效影响。</p>
                    <p class="economy-panel-note is-danger">同一房屋每多被 1 家银行覆盖，该房屋对每家银行的收益 -33%；2 家为 67%，3 家及以上为 0。</p>`;
                const upgrade = b._bankUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = BankEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-bank-upgrade="${moduleId}"
                            data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}"
                            ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-bank-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                        cost: BankEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#e4bd55',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-bank-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>银行升级项目</span><span class="economy-panel-meta">持有 <span class="economy-unit-gold">${gold} 金</span> / <span class="economy-unit-energy">${energy} 能</span></span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-bank-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeBank(button.dataset.bankUpgrade));
                });
                modBox.querySelectorAll('[data-bank-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showBankTip(row.dataset.bankRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
                TechnologyGate.bindTree(modBox);
            } else if (cfg.economyType === 'market') {
                const quote = PopulationEconomySystem.getMarketQuote(b);
                const buyBatch = populationEconomyConfig.market.buyEnergyBatch;
                const sellBatch = populationEconomyConfig.market.sellGoldBatch;
                const buyGold = Math.floor(buyBatch / quote.buyEnergyPerGold);
                const buyEnergy = Math.ceil(buyGold * quote.buyEnergyPerGold);
                const sellEnergy = Math.floor(sellBatch * quote.sellEnergyPerGold);
                st.innerHTML = `
                <div class="economy-panel-heading">⚖ 动态市场</div>
                <div class="economy-stat-grid">
                    <div><span>中间价</span><b>1 金币 = <span id="pbEconomyMarketMid" class="economy-unit-energy">${quote.midEnergyPerGold.toFixed(2)}</span> 能源</b></div>
                    <div><span>买入</span><b><span id="pbEconomyMarketBuy" class="economy-unit-energy">${quote.buyEnergyPerGold.toFixed(2)}</span> 能源 → <span class="economy-unit-gold">1 金币</span></b></div>
                    <div><span>卖出</span><b><span class="economy-unit-gold">1 金币</span> → <span id="pbEconomyMarketSell" class="economy-unit-energy">${quote.sellEnergyPerGold.toFixed(2)}</span> 能源</b></div>
                    <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    <div><span>压力</span><b id="pbEconomyMarketPressure">${quote.pressure.toFixed(3)}</b></div>
                    <div><span>价差</span><b id="pbEconomyMarketSpread">${(quote.spread * 100).toFixed(1)}%</b></div>
                    <div><span>最低交易损耗</span><b id="pbEconomyMarketLoss">买 +${(quote.minimumTradeLossRate * 100).toFixed(0)}% / 卖 -${(quote.minimumTradeLossRate * 100).toFixed(0)}%</b></div>
                </div>
                <p class="economy-panel-note">至少安排 1 名商人才能交易；更多商人会缩小动态价差并略微加快价格回归，但不能消除固定交易损耗。</p>`;
                const canTrade = PopulationEconomySystem.canMarketTrade(b);
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                <div class="economy-trade-actions">
                    <button class="troop-panel-unit-button" data-market-buy ${canTrade ? '' : 'disabled'}>${buyEnergy} 能源 → ${buyGold} <span class="economy-unit-gold">金币</span></button>
                    <button class="troop-panel-unit-button" data-market-sell ${canTrade ? '' : 'disabled'}>${sellBatch} <span class="economy-unit-gold">金币</span> → ${sellEnergy} 能源</button>
                </div>
                <div class="economy-panel-note">市场用于应急周转：买入金币至少溢价 15%，卖出金币至多获得基准价 85%；连续同向兑换还会恶化价格。</div>`;
                this._bindWorkforceControls(modBox);
                modBox.querySelector('[data-market-buy]')?.addEventListener('click', () => this._marketBuy());
                modBox.querySelector('[data-market-sell]')?.addEventListener('click', () => this._marketSell());
            } else {
                const snapshot = PopulationEconomySystem.getWindmillSnapshot(b);
                st.innerHTML = `
                <div class="economy-panel-heading">🌾 麦田风车</div>
                <div class="economy-stat-grid">
                    <div><span>实际产量</span><b id="pbEconomyOutput" class="economy-unit-food">${snapshot.actualFoodPerSecond.toFixed(2)} 粮食/秒</b></div>
                    <div><span>满员配置产量</span><b id="pbWindmillConfiguredOutput" class="economy-unit-food">${snapshot.configuredFoodPerSecond.toFixed(2)} 粮食/秒</b></div>
                    <div><span>单人基础产量</span><b id="pbWindmillPerWorker" class="economy-unit-food">${snapshot.foodPerWorker.toFixed(2)}/秒</b></div>
                    <div><span>传动 / 轮作</span><b id="pbWindmillMultipliers">×${snapshot.driveMultiplier.toFixed(2)} / ×${snapshot.fieldMultiplier.toFixed(2)}</b></div>
                    <div><span>天气影响</span><b id="pbFoodWeather">${snapshot.weatherLabel} ×${snapshot.weatherMultiplier.toFixed(2)}</b></div>
                    <div><span>位面库存</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                    <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    <div><span>占地</span><b>2×2（外围 12 格为田地占位符）</b></div>
                </div>
                <p class="economy-panel-note">满员配置产量不含人口超额减益、经济工坊增效、天气和祭品倍率；实际产量已计人口、工坊与天气影响，祭品倍率在最终入库结算时额外生效。</p>`;
                const upgrade = b._windmillUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = PopulationEconomySystem.getWindmillModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-windmill-upgrade="${moduleId}" ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-windmill-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name,
                        level, maxLevel: module.maxLevel,
                        cost: PopulationEconomySystem.getWindmillUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#d9bd62',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-windmill-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>风车升级项目</span><span class="economy-panel-meta">持有 ${gold} 金 / ${energy} 能</span></div>${rows}
                    <div class="economy-panel-note">田垄扩建后最多显示 ${populationEconomyConfig.windmill.visualWorkerCap || 0} 只仓鼠农民；它们只有精灵动画，不创建平民实体。</div>`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-windmill-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeWindmill(button.dataset.windmillUpgrade));
                });
                modBox.querySelectorAll('[data-windmill-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showWindmillTip(row.dataset.windmillRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
            }
            return;
        }
        if (isWarehouse) {
            const levelCfg = PopulationEconomySystem.getWarehouseLevelConfig(b);
            const nextLevel = PopulationEconomySystem.getWarehouseLevelUpgrade(b);
            const levelUpgrade = b._economyUpgrade;
            const levelProgress = levelUpgrade
                ? Math.round((1 - levelUpgrade.remainMs / levelUpgrade.totalMs) * 100)
                : 0;
            const maxWarehouseLevel = Math.max(1, ...(populationEconomyConfig.warehouse?.levels || [])
                .map((entry) => Math.max(1, Math.floor(Number(entry.level) || 1))));
            const ownEnergy = Math.floor(b.storedEnergy || 0);
            const ownFood = Math.floor(b.storedFood || 0);
            const own = EnergyManager ? EnergyManager.getWarehouseUsedCapacity(b) : ownEnergy + ownFood;
            const ownCap = Math.floor(b.storageCapacity || cfg.storageCapacity || 5000);
            const totalEnergy = EnergyManager ? EnergyManager.getEnergy() : 0;
            const totalFood = EnergyManager ? EnergyManager.getFood() : 0;
            const totalCap = EnergyManager ? EnergyManager.getCapacity() : 0;
            const totalUsed = totalCap - (EnergyManager ? EnergyManager.getFreeCapacity() : 0);
            const warehouseCount = EnergyManager ? EnergyManager.getWarehouseCount() : 0;
            const pct = ownCap > 0 ? Math.round(own / ownCap * 100) : 0;
            const totalPct = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : 0;
            const energySaving = Math.round((1 - WarehouseEconomySystem.getEnergyFactor(b)) * 100);
            const foodSaving = Math.round((1 - WarehouseEconomySystem.getFoodFactor(b)) * 100);
            const protocolSurcharge = Math.round(WarehouseEconomySystem.getProtocolSurcharge(b) * 100);
            st.innerHTML = `
                <div class="economy-panel-heading">
                    <span>📦 ${levelCfg?.name || '位面仓库'}</span><span class="economy-panel-meta">Lv.${b._economyLevel || 1} · 本位面 ${warehouseCount} 座</span>
                </div>
                <div class="economy-stat-grid">
                    <div><span>等级基础容量</span><b>${WarehouseEconomySystem.getBaseCapacity(b)}</b></div>
                    <div><span>本仓占用</span><b id="pbWarehouseOwn" class="economy-unit-energy">${Math.round(own)}/${ownCap}（能 ${ownEnergy} / 粮 ${ownFood}）</b></div>
                    <div><span>位面总占用</span><b id="pbWarehouseTotal" class="economy-unit-energy">${Math.round(totalUsed)}/${totalCap}（能 ${totalEnergy} / 粮 ${totalFood}）</b></div>
                    <div><span>能源压缩</span><b>-${energySaving}% 容量占用</b></div>
                    <div><span>粮食压缩</span><b>-${foodSaving}% 容量占用</b></div>
                    <div><span>跨位面损耗</span><b>${protocolSurcharge > 0 ? `+${protocolSurcharge}%` : '0%'}</b></div>
                </div>
                <div class="economy-progress-label"><span>仓储容量</span><b id="pbWarehousePct">${pct}%</b></div>
                <div class="economy-progress"><div id="pbWarehouseBar" style="width:${pct}%"></div></div>
                <div class="economy-progress-label"><span>位面总容量</span><b id="pbWarehouseTotalPct">${totalPct}%</b></div>
                <div class="economy-progress"><div id="pbWarehouseTotalBar" style="width:${totalPct}%"></div></div>
                <p class="economy-panel-note">能源与粮食共享物理容量；压缩升级只降低对应资源的容量占用，不凭空增加库存。</p>`;
            const levelActionsHtml = nextLevel
                ? `<button class="troop-panel-upgrade-button" data-warehouse-level-upgrade
                    data-technology-gate-type="upgrade" data-technology-gate-id="${nextLevel.technologyUnlockId || ''}"
                    ${levelUpgrade ? 'disabled' : ''}>扩建</button>`
                : '<span class="troop-panel-caption">已满级</span>';
            const levelCard = renderBuildingUpgradeCard({
                rowAttribute: 'data-warehouse-level-row', projectId: 'warehouse_level',
                icon: '📦', iconImage: 'assets/ui/building-upgrades/warehouse-level-expansion.png',
                name: nextLevel ? `扩建至 ${nextLevel.name}` : (levelCfg?.name || '仓库'),
                level: b._economyLevel || 1, maxLevel: maxWarehouseLevel,
                cost: nextLevel?.upgradeCost || null, maxed: !nextLevel,
                inProgress: !!levelUpgrade, progressPct: levelProgress,
                remainMs: levelUpgrade?.remainMs || 0,
                barId: 'pbWarehouseLevelUpgradeBar', textId: 'pbWarehouseLevelUpgradeText',
                actionsHtml: levelActionsHtml, accent: '#e1b866',
            }).replace('class="building-upgrade-card"',
                `class="building-upgrade-card" data-warehouse-level-upgrading="${!!levelUpgrade}"`);
            const upgrade = b._warehouseUpgrade;
            const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                const level = WarehouseEconomySystem.getModuleLevel(b, moduleId);
                const maxed = level >= module.maxLevel;
                const inProgress = upgrade?.moduleId === moduleId;
                const progressPct = inProgress
                    ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                    : 0;
                const actionsHtml = maxed
                    ? '<span class="troop-panel-caption">已满级</span>'
                    : `<button class="troop-panel-upgrade-button" data-warehouse-upgrade="${moduleId}" ${upgrade ? 'disabled' : ''}>升级</button>`;
                return renderBuildingUpgradeCard({
                    rowAttribute: 'data-warehouse-row', projectId: moduleId,
                    icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                    cost: WarehouseEconomySystem.getUpgradeCost(b, moduleId), maxed,
                    inProgress, progressPct,
                    remainMs: inProgress ? upgrade.remainMs : 0,
                    barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                    actionsHtml, accent: '#7fd4ff',
                    technologyGateType: 'upgrade', technologyGateId: moduleId,
                }).replace('class="building-upgrade-card"',
                    `class="building-upgrade-card" data-warehouse-upgrading="${inProgress}"`);
            }).join('');
            modBox.innerHTML = `<div class="economy-panel-heading"><span>仓库等级扩建</span><span class="economy-panel-meta">持有 ${gold} 金 / ${energy} 能</span></div>
                ${levelCard}
                <div class="economy-panel-note">等级提供基础容量，立体货架提供固定附加容量；两条成长线相加，互不覆盖。</div>
                <div class="economy-panel-heading"><span>仓库独立升级项目</span><span class="economy-panel-meta">可与等级扩建分别进行</span></div>${rows}`;
            modBox.querySelector('[data-warehouse-level-upgrade]')?.addEventListener('click', () => this._upgradeWarehouseLevel());
            modBox.querySelector('[data-warehouse-level-row]')?.addEventListener('mouseenter', (event) => this._showWarehouseLevelTip(event));
            modBox.querySelector('[data-warehouse-level-row]')?.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
            modBox.querySelector('[data-warehouse-level-row]')?.addEventListener('mouseleave', () => this._hideAbilityTip());
            modBox.querySelectorAll('[data-warehouse-upgrade]').forEach((button) => {
                button.addEventListener('click', () => this._upgradeWarehouse(button.dataset.warehouseUpgrade));
            });
            modBox.querySelectorAll('[data-warehouse-row]').forEach((row) => {
                row.addEventListener('mouseenter', (event) => this._showWarehouseTip(row.dataset.warehouseRow, event));
                row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                row.addEventListener('mouseleave', () => this._hideAbilityTip());
            });
            TechnologyGate.bindTree(modBox);
            return;
        }
        if (isPortal) {
            if (sellBtn && (b._isWorldPortalCore || b._isMainHubPortalBuilding)) sellBtn.style.display = 'none';
            const currentScene = SceneManager.currentScene;
            const sourceOperational = !b._portalDestroyed && b.hp > 0;
            const travelWorlds = WorldProgressionSystem.getTravelWorlds()
                .filter((entry) => entry.sceneId !== currentScene);
            const destinations = sourceOperational
                ? [...(currentScene === 'main' ? [] : [{ sceneId: 'main', name: '主神空间', icon: '🏛️' }]), ...travelWorlds]
                : [];
            const constructable = WorldProgressionSystem.getConstructableWorlds();
            const hasConstructablePortal = constructable.length > 0;
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                    <div style="font-size:13px;font-weight:700;color:#b8a8ff;">跨世界传送</div>
                    <button id="pbPortalConstructToggle"
                        class="bp-button portal-construct-toggle${hasConstructablePortal ? ' is-available' : ''}"
                        type="button"
                        aria-expanded="${this._portalBuildOpen ? 'true' : 'false'}"
                        aria-label="${hasConstructablePortal ? `构造传送门，有 ${constructable.length} 个世界可构造` : '构造传送门，暂无可构造世界'}">
                        构造传送门
                    </button>
                </div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.8;">
                    ${sourceOperational
                        ? '选择已接入传送网络的世界。所有世界的建筑、时间与入侵状态会持续保存。'
                        : '<span style="color:#ff7766;">该世界传送门已被摧毁，必须先重建才能传送。</span>'}
                </div>`;
            const travelHtml = destinations.length
                ? `<div style="display:grid;grid-template-columns:1fr;gap:8px;">${destinations.map((entry) => `
                    <button data-portal-destination="${entry.sceneId}" style="background:#302a58;color:#e8e0ff;border:1px solid #7566b0;border-radius:7px;padding:9px 10px;cursor:var(--bp-cursor-pointer, pointer);text-align:left;">
                        <b style="font-size:14px;">${entry.icon || '🌀'} ${entry.name || entry.label || entry.sceneId}</b>
                        <span style="display:block;font-size:11px;color:#b8a8d8;margin-top:2px;">点击传送</span>
                    </button>`).join('')}</div>`
                : '<div style="font-size:12px;color:#8a8a8a;">暂无可用的传送目的地。</div>';
            const constructHtml = !this._portalBuildOpen ? '' : `
                <div style="margin-top:10px;padding-top:10px;border-top:1px solid #453b58;">
                    <div style="font-size:12px;font-weight:700;color:#d8c8ff;margin-bottom:7px;">可构造世界</div>
                    ${constructable.length ? constructable.map((entry) => {
                        const costText = entry.firstConstruction
                            ? '首次构造免费'
                            : `重建：${entry.cost.gold || 0} 金币 + ${entry.cost.energy || 0} 能源`;
                        return `<button data-portal-construct="${entry.sceneId}" style="display:block;width:100%;margin-top:6px;background:#3d3428;color:#ffe4ba;border:1px solid #8a704d;border-radius:7px;padding:9px 10px;cursor:var(--bp-cursor-pointer, pointer);text-align:left;">
                            <b>${entry.icon || '🌀'} ${entry.name || entry.sceneId}</b>
                            <span style="display:block;font-size:11px;color:#cdb58f;margin-top:2px;">${costText}</span>
                        </button>`;
                    }).join('') : '<div style="font-size:12px;color:#8a8a8a;">暂无可以构造传送门的世界</div>'}
                </div>`;
            modBox.innerHTML = travelHtml + constructHtml;
            st.querySelector('#pbPortalConstructToggle')?.addEventListener('click', () => {
                this._portalBuildOpen = !this._portalBuildOpen;
                this.refresh();
            });
            modBox.querySelectorAll('[data-portal-destination]').forEach((button) => {
                button.addEventListener('click', () => this._teleport(button.dataset.portalDestination));
            });
            modBox.querySelectorAll('[data-portal-construct]').forEach((button) => {
                button.addEventListener('click', () => this._constructPortal(button.dataset.portalConstruct));
            });
            return;
        }
        if (isPassive) {
            st.innerHTML = `
                <div style="font-size:13px;font-weight:700;color:#d4e8ff;margin-bottom:6px;">基础建筑属性</div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.8;">
                    物理防御：<b style="color:#7ab8ff;">${b.def ?? cfg.def ?? 0}</b> ·
                    魔法防御：<b style="color:#c9a0ff;">${b.mdef ?? cfg.mdef ?? 0}</b><br>
                    ${cfg.panelDescription || '暂无额外功能。'}
                </div>`;
            modBox.innerHTML = '<div style="font-size:12px;color:#8a8a8a;">该建筑暂未配置额外功能。</div>';
            return;
        }
        // ===== 铁匠铺：能力工坊版（覆盖上方出兵版渲染，2026-08-17）=====
        if (isAbilityShop) {
            const workshopTitle = cfg.workshopTitle || '能力工坊';
            const workshopDesc = cfg.workshopDesc || '不生成兵种，为仓鼠单位解锁特殊能力';
            const scopeText = cfg.workshopType === 'research'
                ? '研究完成后立即作用于场上与后续新建结构'
                : '升级完成后能力全局生效（所有对应兵种）';
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div><span style="color:#ffd700;font-weight:700;">${workshopTitle}</span></div>
                    <div style="font-size:12px;color:#9a9a9a;">金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
                </div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                    ${workshopDesc}<br>
                    升级需要读条，${scopeText}
                </div>`;
            const modBoxEl = el.querySelector('#pbModules');
            const rows = Object.entries(cfg.abilities || {}).map(([aid, a]) => {
                const lv = b.abilityLevel(aid);
                const maxed = lv >= (a.maxLevel ?? 10);
                const inProgress = !!(b._upgrade && b._upgrade.abilityId === aid);
                const progPct = inProgress ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100) : 0;
                const cont = b.isContinuousUpgrade('ability', aid);
                const cost = b.getAbilityCost(aid);
                const btnHtml = renderContinuousUpgradeActions({
                    maxed, inProgress, continuous: cont, upgradeBusy: !!b._upgrade,
                    manualAttributes: `data-ability-up="${aid}"`,
                    continuousAttributes: `data-ability-cont="${aid}"`,
                });
                return renderBuildingUpgradeCard({
                    rowAttribute: 'data-ability-row', projectId: aid,
                    icon: a.icon, iconImage: a.iconImage, name: a.name, level: lv, maxLevel: a.maxLevel ?? 10,
                    cost, maxed, inProgress, progressPct: progPct,
                    remainMs: inProgress ? b._upgrade.remainMs : 0,
                    statusText: cont && !inProgress ? '持续升级已开启 · 等待条件与资源' : '',
                    barId: `pbUpgradeBar_${aid}`, textId: `pbUpgradeText_${aid}`,
                    actionsHtml: btnHtml, accent: '#c9a0ff',
                    technologyGateType: 'upgrade', technologyGateId: aid,
                });
            }).join('');
            modBoxEl.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;color:#c9a0ff;">✨ 特殊能力（读条升级，全局生效）</span>
                    <span style="font-size:12px;color:#9a9a9a;">持有 ${gold} 金 / ${energy} 能</span>
                </div>
                ${rows || '<div style="font-size:12px;color:#8a8a8a;">暂无能力</div>'}`;
            TechnologyGate.bindTree(modBoxEl);
            modBoxEl.querySelectorAll('[data-ability-up]').forEach((btnEl) => {
                btnEl.addEventListener('click', () => this._upgradeAbility(btnEl.dataset.abilityUp, false));
            });
            modBoxEl.querySelectorAll('[data-ability-cont]').forEach((btnEl) => {
                btnEl.addEventListener('click', () => this._upgradeAbility(btnEl.dataset.abilityCont, true));
            });
            modBoxEl.querySelectorAll('[data-ability-row]').forEach((rowEl) => {
                const aid = rowEl.dataset.abilityRow;
                rowEl.addEventListener('mouseenter', (ev) => this._showAbilityTip(aid, ev));
                rowEl.addEventListener('mousemove', (ev) => this._moveAbilityTip(ev));
                rowEl.addEventListener('mouseleave', () => this._hideAbilityTip());
            });
        }
    }

    _setUnitType(type) {
        if (!this.building) return;
        if (this.building.setUnitType(type)) {
            const name = this.building.unitName(type);
            this._notify(`${this.building._cfg.name}改为生成 ${name}`, '#7fe0c8');
        }
        this.refresh();
    }

    _setRecruitMode(mode) {
        if (!this.building) return;
        const result = this.building.setRecruitMode(mode);
        if (result.ok) {
            this._notify(`${this.building._cfg.name}：${recruitModeLabel(result.mode)}`, '#7fe0c8');
        } else {
            this._notify(result.reason, '#ff7755');
        }
        this.refresh();
    }

    _setParallelRecruitMode(kind, mode) {
        if (!this.building) return;
        const result = this.building.setParallelRecruitMode(kind, mode);
        this._notify(result.ok
            ? `${this.building.unitName(kind)}：${recruitModeLabel(result.mode)}`
            : result.reason, result.ok ? '#7fe0c8' : '#ff7755');
        this.refresh();
    }

    _upgrade(moduleId, unitType = null) {
        if (!this.building) return;
        const targetUnitType = unitType || this.building.unitType;
        const res = this.building.upgradeModule(moduleId, this.player, targetUnitType);
        if (res.ok) {
            const targetKinds = Array.isArray(res.unitTypes) && res.unitTypes.length
                ? res.unitTypes
                : [res.unitType].filter(Boolean);
            const unitPrefix = targetKinds.length > 1
                ? `${targetKinds.map((kind) => this.building.unitName(kind)).join(' / ')}共享 · `
                : ((this.building._cfg.unitTypes || []).length > 1 && targetKinds[0]
                    ? `${this.building.unitName(targetKinds[0])}专属 · `
                    : '');
            this._notify(`${unitPrefix}${this.building._cfg.modules[moduleId].name} 开始升级（读条 ${Math.round(res.cost.timeMs / 1000)}s）`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    _toggleModuleContinuous(moduleId, unitType = null) {
        if (!this.building) return;
        const b = this.building;
        const wasActive = b.isContinuousUpgrade('module', moduleId, unitType);
        const result = b.setContinuousUpgrade({
            kind: 'module', moduleId, unitType: unitType || b.unitType,
        });
        const name = b._cfg.modules?.[moduleId]?.name || moduleId;
        if (!result.ok) {
            this._notify(result.reason, '#ff5555');
        } else if (wasActive || result.stopped) {
            this._notify(`${name} 停止持续升级`, '#ffd700');
        } else if (result.waiting) {
            this._notify(`${name} 持续升级已开启，等待条件与资源`, '#c9a0ff');
        } else {
            this._notify(`${name} 持续升级已开启`, '#c9a0ff');
        }
        this.refresh();
    }

    _upgradeCandle(moduleId) {
        if (!this.building) return;
        const building = this.building;
        const module = building._cfg?.modules?.[moduleId];
        let result;
        if (!building._isWorld125Candle || !module) {
            result = { ok: false, reason: '未知烛台升级项目' };
        } else if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            result = { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        } else if (CandleSanctuarySystem.getModuleLevel(building, moduleId)
            >= Math.max(0, Number(module.maxLevel) || 0)) {
            result = { ok: false, reason: '照明范围已满级' };
        } else if (building._candleUpgrade) {
            result = { ok: false, reason: '已有烛台项目正在升级' };
        } else {
            const cost = CandleSanctuarySystem.getUpgradeCost(building, moduleId);
            if (!cost) {
                result = { ok: false, reason: '升级费用配置缺失' };
            } else {
                const payment = payBuildingUpgradeCost(cost);
                if (!payment.ok) {
                    result = payment;
                } else {
                    building._candleUpgrade = {
                        moduleId,
                        totalMs: Math.max(1, Number(cost.timeMs) || 1),
                        remainMs: Math.max(1, Number(cost.timeMs) || 1),
                    };
                    result = { ok: true, cost, moduleId };
                }
            }
        }
        if (result.ok) {
            this._notify(`增幅灯芯开始升级（${Math.round(result.cost.timeMs / 1000)}s）`, '#ffc66d');
        } else {
            this._notify(result.reason || '烛台升级失败', '#ff5555');
        }
        this.refresh();
    }

    _getEconomySecondaryProgress(building, workforce) {
        if (!building || !workforce) return { label: '本轮生产', pct: 0, text: '0%' };
        if (building._economyType === 'weather_forecast') {
            const snapshot = PopulationEconomySystem.getWeatherForecastResearchSnapshot(building);
            const configured = Math.max(0,
                Number(snapshot.configuredResearchPointsPerSecond) || 0);
            const actual = Math.max(0,
                Number(snapshot.actualResearchPointsPerSecond) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : (WeatherForecastTowerSystem.isOperational(building) ? 100 : 0);
            return {
                label: configured > 0 ? '气象科研' : '气象监测',
                pct,
                text: configured > 0 ? `${pct}% · ${actual.toFixed(2)} 科研点/秒`
                    : (pct > 0 ? '正在监测' : '待命'),
            };
        }
        if (building._economyType === 'advanced_research') {
            const snapshot = PopulationEconomySystem.getAdvancedResearchSnapshot(building);
            const configured = Math.max(0,
                Number(snapshot.configuredResearchPointsPerSecond) || 0);
            const actual = Math.max(0,
                Number(snapshot.actualResearchPointsPerSecond) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '科研效率', pct, text: `${pct}% · ${actual.toFixed(2)} 科研点/秒` };
        }
        if (building._economyType === 'research') {
            const snapshot = PopulationEconomySystem.getResearchSnapshot(building);
            const configured = Math.max(0,
                Number(snapshot.configuredResearchPointsPerSecond) || 0);
            const actual = Math.max(0,
                Number(snapshot.actualResearchPointsPerSecond) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '科研效率', pct, text: `${pct}% · ${actual.toFixed(2)} 科研点/秒` };
        }
        if (building._economyType === 'wind_power_plant'
            || building._economyType === 'solar_power_plant') {
            const snapshot = building._economyType === 'solar_power_plant'
                ? PopulationEconomySystem.getSolarPowerSnapshot(building)
                : PopulationEconomySystem.getWindPowerSnapshot(building);
            const configured = Math.max(0, Number(snapshot.configuredEnergyPerSecond) || 0);
            const actual = Math.max(0, Number(snapshot.actualEnergyPerSecond) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return {
                label: building._economyType === 'solar_power_plant' ? '光伏产量' : '风力产量',
                pct,
                text: `${pct}% · ${actual.toFixed(2)} 能源/秒`,
            };
        }
        if (building._economyType === 'planar_resonator') {
            const snapshot = PopulationEconomySystem.getPlanarResonatorSnapshot(building);
            const configured = Math.max(0, Number(snapshot.configuredEnergyPerSecond) || 0);
            const actual = Math.max(0, Number(snapshot.actualEnergyPerSecond) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '能源产量', pct, text: `${pct}% · ${actual.toFixed(2)} 能源/秒` };
        }
        if (building._economyType === 'field_hospital') {
            const snapshot = FieldHospitalSystem.getSnapshot(building);
            const configured = Math.max(0, Number(snapshot.configuredHealingRate) || 0);
            const actual = Math.max(0, Number(snapshot.actualHealingRate) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return {
                label: '治疗发挥',
                pct,
                text: `${pct}% · ${snapshot.patientCount}/${snapshot.patientCapacity} 名患者`,
            };
        }
        if (building._economyType === 'armory') {
            const snapshot = ArmoryEconomySystem.getSnapshot(building);
            const pct = Math.round(snapshot.staffFactor * 100);
            return {
                label: '维护发挥',
                pct,
                text: `${pct}% · 实际减耗 ${(snapshot.actualCostReduction * 100).toFixed(1)}%`,
            };
        }
        if (building._economyType === 'workshop') {
            const snapshot = WorkshopEconomySystem.getSnapshot(building);
            const configured = Math.max(0, Number(snapshot.configuredEfficiency) || 0);
            const actual = Math.max(0, Number(snapshot.actualEfficiency) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '增效发挥', pct, text: `${pct}% · 实际 +${(actual * 100).toFixed(1)}%` };
        }
        if (building._economyType === 'market') {
            const quote = PopulationEconomySystem.getMarketQuote(building);
            const pct = workforce.slots > 0
                ? Math.round(Math.max(0, Math.min(1, quote.effectiveWorkers / workforce.slots)) * 100)
                : 0;
            return { label: '交易效率', pct, text: `${pct}% · ${quote.effectiveWorkers.toFixed(2)} 人效` };
        }
        if (building._economyType === 'windmill') {
            const snapshot = PopulationEconomySystem.getWindmillSnapshot(building);
            const actual = Math.max(0, snapshot.actualFoodPerSecond);
            const configured = Math.max(0, snapshot.configuredFoodPerSecond);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '粮食产量', pct, text: `${pct}% · ${actual.toFixed(2)} 粮食/秒` };
        }
        if (building._economyType === 'bakery') {
            const snapshot = BakeryEconomySystem.getSnapshot(building);
            const pct = Math.round(snapshot.progress * 100);
            const phaseLabel = {
                idle: '批次待命',
                to_pickup: '取粮路程',
                to_bakery: '返店路程',
                processing: '烘焙加工',
                waiting_deposit: '成品待存',
                to_deposit: '送仓路程',
            }[snapshot.phase] || '当前阶段';
            return {
                label: phaseLabel,
                pct,
                text: `${pct}% · ${snapshot.status}`,
            };
        }
        if (building._economyType === 'chain_restaurant') {
            const snapshot = BakeryEconomySystem.getSnapshot(building);
            const pct = Math.round(snapshot.progress * 100);
            const phaseLabel = {
                idle: '批次待命',
                to_pickup: '取粮路程',
                to_bakery: '返店路程',
                processing: '中央厨房加工',
                waiting_deposit: '成品待存',
                to_deposit: '外卖送仓',
            }[snapshot.phase] || '当前阶段';
            return { label: phaseLabel, pct, text: `${pct}% · ${snapshot.status}` };
        }
        if (building._economyType === 'cheese_farm') {
            const snapshot = CheeseFarmSystem.getSnapshot(building);
            const pct = Math.round(snapshot.progress * 100);
            const phaseLabel = {
                processing: '奶酪熟成',
                waiting_deposit: '成品待存',
                to_deposit: '抱酪送仓',
                to_farm: '空手返场',
            }[snapshot.phase] || '当前阶段';
            return { label: phaseLabel, pct, text: `${pct}% · ${snapshot.status}` };
        }
        if (building._economyType === 'steam_power_plant') {
            const snapshot = SteamPowerPlantSystem.getSnapshot(building);
            // 多名锅炉工的任务并行推进。把其中最大进度塞进一根条会在领先任务完成、
            // 落后任务接管时倒退；单条只显示本栋稳定的可用产能，不聚合任务相位。
            const operatingEfficiency = snapshot.blockReason
                ? 0
                : Math.max(0, Math.min(1,
                    snapshot.assignedWorkers / Math.max(1, snapshot.workerSlots)
                    * workforce.laborEfficiency));
            const pct = Math.round(operatingEfficiency * 100);
            return {
                label: '运行效率',
                pct,
                text: snapshot.blockReason
                    ? snapshot.status
                    : `${pct}% · ${snapshot.actualEnergyPerBatch.toFixed(2)} 能源/批 · ${snapshot.status}`,
            };
        }
        if (building._economyType === 'deep_drill') {
            const snapshot = DeepDrillSystem.getSnapshot(building);
            const configured = Math.max(0,
                snapshot.configuredExtractionPerSecond * snapshot.outputMultiplier);
            const actual = Math.max(0, snapshot.actualEnergyPerSecond);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return {
                label: '采掘效率',
                pct,
                text: `${pct}% · ${actual.toFixed(2)} 能源/秒`,
            };
        }
        if (building._economyType === 'tavern') {
            const snapshot = TavernEconomySystem.getSnapshot(building);
            const pct = Math.round(snapshot.progress * 100);
            const phaseLabel = {
                idle: '宴饮待命',
                to_pickup: '取粮路程',
                to_tavern: '返店路程',
                serving: '宴饮服务',
            }[snapshot.phase] || '酒保任务';
            return {
                label: phaseLabel,
                pct,
                text: `${pct}% · ${snapshot.status}`,
            };
        }
        if (building._economyType === 'grand_mall') {
            const snapshot = PopulationEconomySystem.getGrandMallSnapshot(building);
            // 大商场每秒连续营业；结算计时会在每批完成后归零，不能反向驱动收益条，
            // 否则面板会稳定地每秒从 100% 跳回 0%。收益条只表达持续产能发挥。
            const yieldEfficiency = snapshot.canOperate
                ? Math.max(0, Math.min(1,
                    snapshot.staffEfficiency * snapshot.laborEfficiency))
                : 0;
            const pct = Math.round(yieldEfficiency * 100);
            return {
                label: '收益效率',
                pct,
                text: snapshot.canOperate
                    ? `${pct}% · ${snapshot.goldPerSecond.toFixed(2)} 金币/秒 · ${snapshot.energyPerSecond.toFixed(2)} 能源/秒`
                    : '待命',
            };
        }
        if (building._economyType === 'bank') {
            const snapshot = PopulationEconomySystem.getBankSnapshot(building);
            const operating = snapshot.goldPerSecond > 0;
            // 银行虽按离散周期入账，但对玩家是持续覆盖型收益建筑；结算余数每轮必归零，
            // 不能作为收益条。条只表达岗位与人口对本栋持续产能的稳定发挥。
            const coverageEfficiency = snapshot.servicePopulation > 0
                ? Math.max(0, Math.min(1,
                    snapshot.effectiveServicePopulation / snapshot.servicePopulation))
                : 0;
            const yieldEfficiency = operating
                ? Math.max(0, Math.min(1,
                    snapshot.assignedWorkers / Math.max(1, workforce.slots)
                    * snapshot.laborEfficiency * coverageEfficiency))
                : 0;
            const pct = Math.round(yieldEfficiency * 100);
            return {
                label: '收益效率',
                pct,
                text: operating
                    ? `${pct}% · ${snapshot.goldPerSecond.toFixed(2)} 金币/秒`
                    : '待命',
            };
        }
        if (building._economyType === 'royal_mint') {
            const snapshot = PopulationEconomySystem.getMintSnapshot(building);
            const ready = snapshot.staffedCount > 0 && snapshot.canAffordSettlement;
            const yieldEfficiency = ready
                ? Math.max(0, Math.min(1,
                    snapshot.staffedCount / Math.max(1, snapshot.staffCapacity)
                    * snapshot.laborEfficiency))
                : 0;
            const pct = Math.round(yieldEfficiency * 100);
            return {
                label: '铸币效率',
                pct,
                text: ready
                    ? `${pct}% · ${snapshot.goldPerSecond.toFixed(2)} 金币/秒 · ${snapshot.energyPerSecond.toFixed(2)} 能源/秒 · ${snapshot.foodPerSecond.toFixed(2)} 食物/秒`
                    : (snapshot.staffedCount <= 0
                        ? '待命'
                        : snapshot.resourceBlockReason),
            };
        }
        // 新增 economyType 若没有显式分类，面板应直接暴露“未接业务真源”，
        // 不能静默回退成一个看似正常、实际无语义的生产进度条。
        return { label: '业务状态', pct: 0, text: '待接权威数据' };
    }

    _renderWorkforceControls(building) {
        const workforce = PopulationEconomySystem.getWorkerSnapshot(building);
        if (!workforce) return '';
        const population = workforce.population;
        const workforcePct = workforce.slots > 0 ? Math.round(workforce.assigned / workforce.slots * 100) : 0;
        const secondaryProgress = this._getEconomySecondaryProgress(building, workforce);
        return `<div class="economy-workforce">
            <div class="economy-workforce-copy">
                <div class="economy-workforce-label"><span>${workforce.label}岗位</span><b id="pbEconomyWorkers">${workforce.assigned}/${workforce.slots} · 人口效率 ${Math.round(workforce.laborEfficiency * 100)}%</b></div>
                <div class="economy-progress-label"><span>岗位安排</span><b id="pbEconomyWorkforcePct">${workforcePct}%</b></div>
                <div class="economy-progress"><div id="pbEconomyWorkforceBar" style="width:${workforcePct}%"></div></div>
                <div class="economy-progress-label"><span>${secondaryProgress.label}</span><b id="pbEconomyProductionPct">${secondaryProgress.text}</b></div>
                <div class="economy-progress"><div id="pbEconomyProductionBar" style="width:${secondaryProgress.pct}%"></div></div>
                <div class="economy-workforce-note">${population.overcrowded > 0 ? `<span class="is-warning">人口超额 ${population.overcrowded}，所有岗位按比例降效</span>` : '岗位只占用人口数值，不创建平民实体'}</div>
            </div>
            <div class="economy-workforce-actions">
                <button class="troop-panel-unit-button" data-worker-delta="-1" ${workforce.assigned <= 0 ? 'disabled' : ''}>−1</button>
                <button class="troop-panel-unit-button" data-worker-delta="1" ${workforce.freeSlots <= 0 || population.free <= 0 ? 'disabled' : ''}>+1</button>
                <button class="troop-panel-unit-button" data-worker-max ${workforce.freeSlots <= 0 || population.free <= 0 ? 'disabled' : ''}>最大</button>
            </div>
        </div>`;
    }

    _upgradeWindmill(moduleId) {
        if (!this.building) return;
        const result = PopulationEconomySystem.startWindmillUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#d9bd62' : '#ff5555');
        this.refresh();
    }

    _showWindmillTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = PopulationEconomySystem.getWindmillModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'windmillFoodPerWorker') return `${value.toFixed(2)} 粮食/人/秒`;
            if (module.effect === 'windmillStaffCapacity') return `${Math.round(value)} 名农夫`;
            if (module.effect === 'windmillDriveMultiplier'
                || module.effect === 'windmillFieldMultiplier') {
                return `+${Math.round((value - 1) * 100)}%`;
            }
            return `${value}`;
        };
        const cost = PopulationEconomySystem.getWindmillUpgradeCost(this.building, moduleId);
        const currentValue = valueAt(level);
        const description = (module.desc || '提升本栋麦田风车的粮食产能。')
            .replace('{value}', Number.isInteger(currentValue)
                ? String(currentValue) : currentValue.toFixed(2))
            .replace('{pct}', String(Math.round((currentValue - 1) * 100)));
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">${description}</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeWeatherForecast(moduleId) {
        if (!this.building) return;
        const result = WeatherForecastTowerSystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#79c9e8' : '#ff5555');
        this.refresh();
    }

    _showWeatherForecastTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = WeatherForecastTowerSystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'weatherForecastHorizonDays') return `${value.toFixed(0)} 天`;
            if (module.effect === 'weatherForecastResearchPoints') {
                return `${value.toFixed(2)} 科研点/秒`;
            }
            return value > 0 ? '已启用' : '未启用';
        };
        const cost = WeatherForecastTowerSystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        const descriptionValue = module.effect === 'weatherForecastResearchPoints'
            ? valueAt(level).toFixed(2)
            : String(valueAt(level));
        const description = (module.desc || '扩展本塔在顶部时间进度栏提供的气象预报。')
            .replace('{value}', descriptionValue);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">${description}</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '高级气象学'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _renderWindPowerEconomy(st, modBox, building, cfg, population) {
        const isSolar = building._economyType === 'solar_power_plant';
        const snapshot = isSolar
            ? PopulationEconomySystem.getSolarPowerSnapshot(building)
            : PopulationEconomySystem.getWindPowerSnapshot(building);
        const energyLabel = isSolar ? '光伏' : '风力';
        const workerLabel = isSolar ? '光伏技师' : '风机技师';
        const hasWarehouse = !!EnergyManager?.hasWarehouse?.();
        const warehouseFull = !!EnergyManager?.isFull?.();
        const operating = snapshot.actualEnergyPerSecond > 0 && hasWarehouse && !warehouseFull;
        const status = operating ? '稳定发电'
            : (snapshot.staffedCount <= 0 ? `等待${workerLabel}上岗`
                : (snapshot.laborEfficiency <= 0 ? '人口容量不足'
                    : (hasWarehouse && !warehouseFull ? `等待${energyLabel}结算` : '等待仓库空间')));
        st.innerHTML = `
            <div class="economy-panel-heading"><span>${isSolar ? '☀️ 光伏' : '🌬️ 风力'}电站运行档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbWindStatus">${status}</span></div>
            <div class="economy-stat-grid">
                <div><span>${energyLabel}结算周期</span><b id="pbWindCycle">${(snapshot.cycleMs / 1000).toFixed(1)} 秒</b></div>
                <div><span>单轮原始产能</span><b id="pbWindPerCycle">${snapshot.energyPerCycle.toFixed(0)} 能源</b></div>
                <div><span>整流转化率</span><b id="pbWindConversion">${(snapshot.conversionRate * 100).toFixed(1)}%</b></div>
                <div><span>上岗 / 岗位</span><b id="pbWindStaffed">${snapshot.staffedCount}/${snapshot.staffCapacity}</b></div>
                <div><span>满员配置产量</span><b id="pbWindConfiguredOutput">${snapshot.configuredEnergyPerSecond.toFixed(2)} 能源/秒</b></div>
                <div><span>实际产量</span><b id="pbWindActualOutput">${snapshot.actualEnergyPerSecond.toFixed(2)} 能源/秒</b></div>
                <div><span>工坊额外增效</span><b id="pbWindWorkshop">${((snapshot.workshopMultiplier - 1) * 100).toFixed(1)}%</b></div>
                <div><span>待入库能源</span><b id="pbWindPending">${snapshot.pendingEnergy}</b></div>
                <div><span>仓库能源 / 容量</span><b id="pbWindStorage">${Math.floor(EnergyManager?.getEnergy?.() || 0)}/${Math.floor(EnergyManager?.getCapacity?.() || 0)}</b></div>
                <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
            </div>
            <p class="economy-panel-note">无需燃料；每名技师发挥 ${(snapshot.workerEfficiencyShare * 100).toFixed(0)}% 配置产能，${Math.ceil(1 / snapshot.workerEfficiencyShare)} 名满效。离开当前位面后仍按同一公式推进。</p>`;
        const upgrade = isSolar ? building._solarPowerUpgrade : building._windPowerUpgrade;
        const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
            const level = isSolar
                ? PopulationEconomySystem.getSolarPowerModuleLevel(building, moduleId)
                : PopulationEconomySystem.getWindPowerModuleLevel(building, moduleId);
            const maxed = level >= module.maxLevel;
            const inProgress = upgrade?.moduleId === moduleId;
            const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
            const actionsHtml = maxed ? '<span class="troop-panel-caption">已满级</span>'
                : `<button class="troop-panel-upgrade-button" data-wind-power-upgrade="${moduleId}" data-technology-gate-type="upgrade" data-technology-gate-id="${moduleId}" ${upgrade || !unlocked ? 'disabled' : ''}>${unlocked ? '升级' : '科技未解锁'}</button>`;
            return renderBuildingUpgradeCard({
                rowAttribute: 'data-wind-power-row', projectId: moduleId,
                icon: module.icon, iconImage: module.iconImage, name: module.name,
                level, maxLevel: module.maxLevel,
                cost: isSolar
                    ? PopulationEconomySystem.getSolarPowerUpgradeCost(building, moduleId)
                    : PopulationEconomySystem.getWindPowerUpgradeCost(building, moduleId), maxed,
                inProgress, progressPct: inProgress
                    ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100) : 0,
                remainMs: inProgress ? upgrade.remainMs : 0,
                barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                actionsHtml, accent: '#62bfe8',
            }).replace('class="building-upgrade-card"',
                `class="building-upgrade-card" data-wind-power-upgrading="${inProgress}"`);
        }).join('');
        modBox.innerHTML = `${this._renderWorkforceControls(building)}
            <div class="economy-panel-heading"><span>${energyLabel}电站升级项目</span><span class="economy-panel-meta">需要科技“${isSolar ? '光伏' : '风能'}标准化”</span></div>${rows}`;
        this._bindWorkforceControls(modBox);
        modBox.querySelectorAll('[data-wind-power-upgrade]').forEach((button) => {
            button.addEventListener('click', () => this._upgradeWindPower(button.dataset.windPowerUpgrade));
        });
        modBox.querySelectorAll('[data-wind-power-row]').forEach((row) => {
            row.addEventListener('mouseenter', (event) => this._showWindPowerTip(row.dataset.windPowerRow, event));
            row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
            row.addEventListener('mouseleave', () => this._hideAbilityTip());
        });
        TechnologyGate.bindTree(modBox);
    }

    _upgradeWindPower(moduleId) {
        if (!this.building) return;
        const result = this.building._economyType === 'solar_power_plant'
            ? PopulationEconomySystem.startSolarPowerUpgrade(this.building, moduleId)
            : PopulationEconomySystem.startWindPowerUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#62bfe8' : '#ff5555');
        this.refresh();
    }

    _showWindPowerTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const isSolar = this.building._economyType === 'solar_power_plant';
        const level = isSolar
            ? PopulationEconomySystem.getSolarPowerModuleLevel(this.building, moduleId)
            : PopulationEconomySystem.getWindPowerModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'windCycleMs') return `${(value / 1000).toFixed(1)} 秒/轮`;
            if (module.effect === 'windEnergyPerCycle') return `${Math.round(value)} 能源/轮`;
            if (module.effect === 'windConversionRate') return `${(value * 100).toFixed(1)}%`;
            if (module.effect === 'windStaffCapacity') return `${Math.round(value)} 名`;
            if (module.effect === 'solarCycleMs') return `${(value / 1000).toFixed(1)} 秒/轮`;
            if (module.effect === 'solarEnergyPerCycle') return `${Math.round(value)} 能源/轮`;
            if (module.effect === 'solarConversionRate') return `${(value * 100).toFixed(1)}%`;
            if (module.effect === 'solarStaffCapacity') return `${Math.round(value)} 名`;
            return `${value}`;
        };
        const cost = isSolar
            ? PopulationEconomySystem.getSolarPowerUpgradeCost(this.building, moduleId)
            : PopulationEconomySystem.getWindPowerUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋${isSolar ? '光伏' : '风力'}电站独立升级；岗位效率与人口效率共同决定实际产出</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || (isSolar ? '光伏标准化' : '风能标准化')}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeComputingCenter(moduleId) {
        if (!this.building) return;
        const result = PopulationEconomySystem.startComputingCenterUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#6ca8ff' : '#ff5555');
        this.refresh();
    }

    _showComputingCenterTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = PopulationEconomySystem.getComputingCenterModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'computingBaseGoldPerSecond') return `${value.toFixed(2)} 金币/秒`;
            if (module.effect === 'computingGoldPerPopulationPerSecond') return `${value.toFixed(3)} 金币/人/秒`;
            if (module.effect === 'computingEnergyPerSecond') return `${value.toFixed(0)} 能源/秒`;
            if (module.effect === 'computingStaffCapacity') return `${Math.round(value)} 名`;
            return `${value}`;
        };
        const cost = PopulationEconomySystem.getComputingCenterUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋算力重心独立升级；岗位与人口效率同时限制产出和能源消耗</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '算力标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeResonator(moduleId) {
        if (!this.building) return;
        const result = PopulationEconomySystem.startResonatorUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#a892ff' : '#ff5555');
        this.refresh();
    }

    _showResonatorTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = PopulationEconomySystem.getResonatorModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'resonatorCycleMs') return `${(value / 1000).toFixed(1)} 秒/轮`;
            if (module.effect === 'resonatorEnergyPerCycle') return `${Math.round(value)} 能源/轮`;
            if (module.effect === 'resonatorConversionRate') return `${(value * 100).toFixed(0)}%`;
            if (module.effect === 'resonatorStaffCapacity') return `${Math.round(value)} 名`;
            return `${value}`;
        };
        const cost = PopulationEconomySystem.getResonatorUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋谐振塔独立升级；每名上岗技师发挥 20%，5 名满效</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '谐振校准'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeWorkshop(moduleId) {
        if (!this.building) return;
        const result = WorkshopEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#77c8d9' : '#ff5555');
        this.refresh();
    }

    _upgradeHospital(moduleId) {
        if (!this.building) return;
        const result = FieldHospitalSystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#7fe0c8' : '#ff5555');
        this.refresh();
    }

    _showHospitalTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = FieldHospitalSystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'hospitalTreatmentRange') return `${Math.round(value)}px`;
            if (module.effect === 'hospitalHealingRate') return `${(value * 100).toFixed(1)}% 最大生命/秒（满员）`;
            if (module.effect === 'hospitalPatientCapacity') return `${Math.round(value)} 名患者`;
            if (module.effect === 'hospitalStaffCapacity') return `${Math.round(value)} 名医护`;
            return `${value}`;
        };
        const cost = FieldHospitalSystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋医院独立升级；每名上岗医护发挥 20%，同时接诊人数不超过医护与病床容量</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '医疗标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeArmory(moduleId) {
        if (!this.building) return;
        const result = ArmoryEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#d8ad62' : '#ff5555');
        this.refresh();
    }

    _showArmoryTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = ArmoryEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'armoryServiceRange') return `${Math.round(value)}px`;
            if (module.effect === 'armoryStaffCapacity') return `${Math.round(value)} 名`;
            if (module.effect === 'armoryEnhancementStoneChance') {
                return `${(value * 100).toFixed(1)}%/分钟（满员）`;
            }
            return `减耗 ${(value * 100).toFixed(1)}%（满员）`;
        };
        const cost = ArmoryEconomySystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋军械库独立升级；每名上岗维护师发挥 20%，5 名满效</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '军需标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _showWorkshopTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = WorkshopEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => module.effect === 'workshopRange'
            ? `${Math.round(value)}px`
            : (module.effect === 'workshopEngineerCount'
                ? `${Math.round(value)} 名`
                : `${(value * 100).toFixed(1)}%`);
        const cost = WorkshopEconomySystem.getUpgradeCost(this.building, moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋工坊独立升级；出售后不保留等级</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeBakery(moduleId) {
        if (!this.building) return;
        const result = BakeryEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#d99546' : '#ff5555');
        this.refresh();
    }

    _showBakeryTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = BakeryEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'bakeryProcessTimeMs') return `${(value / 1000).toFixed(1)} 秒/批`;
            if (module.effect === 'bakeryOutputMultiplier') return `${value.toFixed(1)} 倍产出`;
            if (module.effect === 'bakeryPlantTributeChance') return `${(value * 100).toFixed(1)}%/批`;
            if (module.effect === 'bakeryMoveSpeedMultiplier') {
                const baseSpeed = Math.max(1, Number(populationEconomyConfig.bakery?.baseMoveSpeed) || 80);
                return `${Math.round(baseSpeed * value)}px/s（+${Math.round((value - 1) * 100)}%）`;
            }
            return `${value}`;
        };
        const cost = BakeryEconomySystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋面包屋独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '烘焙工艺'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeChainRestaurant(moduleId) {
        if (!this.building) return;
        const result = BakeryEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#d9a441' : '#ff5555');
        this.refresh();
    }

    _showChainRestaurantTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = BakeryEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'restaurantProcessTimeMs') return `${(value / 1000).toFixed(1)} 秒/批`;
            if (module.effect === 'restaurantOutputMultiplier') return `${value.toFixed(1)} 倍产出`;
            if (module.effect === 'restaurantInputFoodPerBatch') return `${Math.round(value)} 食物/批`;
            if (module.effect === 'restaurantMoveSpeedMultiplier') {
                const baseSpeed = Math.max(1,
                    Number(populationEconomyConfig.chain_restaurant?.baseMoveSpeed) || 90);
                return `${Math.round(baseSpeed * value)}px/s（+${Math.round((value - 1) * 100)}%）`;
            }
            return `${value}`;
        };
        const cost = BakeryEconomySystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋连锁餐馆独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '中央厨房标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeCheeseFarm(moduleId) {
        if (!this.building) return;
        const result = CheeseFarmSystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#d8a23b' : '#ff5555');
        this.refresh();
    }

    _showCheeseFarmTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = CheeseFarmSystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'cheeseProcessTimeMs') return `${(value / 1000).toFixed(1)} 秒/批`;
            if (module.effect === 'cheeseFoodPerBatch') return `${Math.round(value)} 食物/批（2头基准）`;
            if (module.effect === 'cheeseCowCount') return `${Math.round(value)} 头奶牛`;
            if (module.effect === 'cheeseMoveSpeedMultiplier') {
                const baseSpeed = Math.max(1,
                    Number(populationEconomyConfig.cheese_farm?.baseMoveSpeed) || 80);
                return `${Math.round(baseSpeed * value)}px/s（+${Math.round((value - 1) * 100)}%）`;
            }
            return `${value}`;
        };
        const cost = CheeseFarmSystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋奶酪农场独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '奶酪标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeSteamPlant(moduleId) {
        if (!this.building) return;
        const result = SteamPowerPlantSystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#b86f32' : '#ff5555');
        this.refresh();
    }

    _showSteamPlantTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = SteamPowerPlantSystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'steamProcessTimeMs') return `${(value / 1000).toFixed(1)} 秒/批`;
            if (module.effect === 'steamEnergyPerBatch') return `${Math.round(value)} 能源/人/批`;
            if (module.effect === 'steamFoodPerBatch') return `${Math.round(value)} 食物/人/批`;
            if (module.effect === 'steamMoveSpeedMultiplier') {
                const baseSpeed = Math.max(1,
                    Number(populationEconomyConfig.steam_power_plant?.baseMoveSpeed) || 80);
                return `${Math.round(baseSpeed * value)}px/s（+${Math.round((value - 1) * 100)}%）`;
            }
            return `${value}`;
        };
        const cost = SteamPowerPlantSystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋蒸汽电站独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '蒸汽工业标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeTavern(moduleId) {
        if (!this.building) return;
        const result = TavernEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#b56b4a' : '#ff5555');
        this.refresh();
    }

    _showTavernTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = TavernEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'tavernOutputBonus') return `最终产出 +${(value * 100).toFixed(1)}%`;
            if (module.effect === 'tavernFoodPerBatch') return `${Math.round(value)} 食物/批`;
            if (module.effect === 'tavernServiceTimeMs') return `${(value / 1000).toFixed(0)} 秒/批`;
            if (module.effect === 'tavernMoveSpeedMultiplier') {
                const baseSpeed = Math.max(1, Number(populationEconomyConfig.tavern?.baseMoveSpeed) || 80);
                return `${Math.round(baseSpeed * value)}px/s（×${value.toFixed(2)}）`;
            }
            return `${value}`;
        };
        const cost = TavernEconomySystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋酒馆独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '宴饮标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeGrandMall(moduleId) {
        if (!this.building) return;
        const result = GrandMallEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(
            result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#d79b45' : '#ff5555'
        );
        this.refresh();
    }

    _showGrandMallTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = GrandMallEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= (Number(module.maxLevel) || 0);
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'grandMallGoldPerPopulationPerSecond') {
                return `${value.toFixed(3)} 金币/人口/秒`;
            }
            if (module.effect === 'grandMallEnergyPerPopulationPerSecond') {
                return `${value.toFixed(3)} 能源/人口/秒`;
            }
            if (module.effect === 'grandMallServiceRange') return `${Math.round(value)}px`;
            if (module.effect === 'grandMallStaffCapacity') {
                return `${Math.round(value)} 名（满编 ${Math.round(value * 5)}%）`;
            }
            return `${value}`;
        };
        const cost = GrandMallEconomySystem.getUpgradeCost(this.building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋大商场独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${unlocked ? (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`) : `需要科技：${technologyName || '商场标准化'}`}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeBank(moduleId) {
        if (!this.building) return;
        const result = BankEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#e4bd55' : '#ff5555');
        this.refresh();
    }

    _showBankTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = BankEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'bankSettlementSpeed') {
                const baseInterval = Math.max(100, Number(populationEconomyConfig.bank?.settlementIntervalMs) || 10000);
                return `速度 +${Math.round(value * 100)}%（${(baseInterval / (1 + value) / 1000).toFixed(2)}秒/轮）`;
            }
            if (module.effect === 'bankStaffCapacity') return `${Math.round(value)} 名`;
            if (module.effect === 'bankServiceRange') return `${Math.round(value)}px`;
            return `${(value * 100).toFixed(0)}% 金币/人/轮`;
        };
        const cost = BankEconomySystem.getUpgradeCost(this.building, moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋银行独立升级；出售后不保留等级</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeMint(moduleId) {
        if (!this.building) return;
        const result = PopulationEconomySystem.startMintUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(
            result.ok ? `${name}开始升级（仅作用于本栋皇家铸币局）` : result.reason,
            result.ok ? '#e5b84f' : '#ff5555'
        );
        this.refresh();
    }

    _showMintTip(moduleId, event) {
        const building = this.building;
        const module = building?._cfg?.modules?.[moduleId];
        if (!building || building._economyType !== 'royal_mint' || !module) return;
        const level = PopulationEconomySystem.getMintModuleLevel(building, moduleId);
        const maxed = level >= (Number(module.maxLevel) || 0);
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'mintGoldPerWorker') return `${value.toFixed(2)} 金币/人/批`;
            if (module.effect === 'mintSettlementSpeed') {
                const baseInterval = Math.max(100,
                    Number(populationEconomyConfig.royal_mint?.settlementIntervalMs) || 10000);
                return `速度 +${Math.round(value * 100)}%（${(baseInterval / (1 + value) / 1000).toFixed(2)}秒/批）`;
            }
            if (module.effect === 'mintEnergyPerWorker') return `${Math.round(value)} 能源/人/批`;
            if (module.effect === 'mintStaffCapacity') return `${Math.round(value)} 个铸币工岗位`;
            return `${value}`;
        };
        const cost = PopulationEconomySystem.getMintUpgradeCost(building, moduleId);
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋皇家铸币局独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${!unlocked ? `需要科技：${technologyName || moduleId}`
                : (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`)}</div>
            <div>${!unlocked || maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeWarehouseLevel() {
        if (!this.building) return;
        const result = PopulationEconomySystem.startWarehouseLevelUpgrade(this.building);
        this._notify(result.ok ? `仓库开始扩建到 Lv.${result.targetLevel}` : result.reason,
            result.ok ? '#e1b866' : '#ff5555');
        this.refresh();
    }

    _showWarehouseLevelTip(event) {
        const building = this.building;
        if (!building || building._economyType !== 'warehouse') return;
        const levels = populationEconomyConfig.warehouse?.levels || [];
        const current = PopulationEconomySystem.getWarehouseLevelConfig(building);
        const next = PopulationEconomySystem.getWarehouseLevelUpgrade(building);
        const requirement = next?.technologyUnlockId
            ? TechnologySystem.getUnlockRequirementLabel('upgrade', next.technologyUnlockId)
            : '';
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon('📦', null, 'building-upgrade-tooltip-icon')}<span>仓库等级扩建</span> <span style="color:#8a5a00;">Lv.${building._economyLevel || 1}/${Math.max(1, ...levels.map((entry) => entry.level || 1))}</span></div>
            <div>等级基础容量 ${current?.storageCapacity || 0}${next ? ` → ${next.storageCapacity}` : ''}</div>
            <div style="margin-top:4px;color:#5a4a2a;">等级容量与立体货架附加值相加；扩建不会重置已有独立升级</div>
            <div style="margin-top:2px;">${next ? `需要科技：${requirement || next.technologyUnlockId}` : '已达到最高等级'}</div>
            <div>${next ? `升级费用：${next.upgradeCost?.gold || 0} 金币 + ${next.upgradeCost?.energy || 0} 能源` : ''}</div>
            <div>${next ? `读条时间：${Math.round((next.upgradeCost?.timeMs || 0) / 1000)} 秒` : ''}</div>`, event);
    }

    _upgradeWarehouse(moduleId) {
        if (!this.building) return;
        const result = WarehouseEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#7fd4ff' : '#ff5555');
        this.refresh();
    }

    _showWarehouseTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = WarehouseEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'warehouseCapacity' || module.effect === 'warehouseCapacityBonus') {
                return `额外 +${Math.round(value)} 容量`;
            }
            if (module.effect === 'warehouseCrossPlaneSurcharge') {
                return `额外消耗 +${Math.max(0, Math.round(value * 100))}%`;
            }
            return `容量占用 -${Math.max(0, Math.round(-value * 100))}%`;
        };
        const cost = WarehouseEconomySystem.getUpgradeCost(this.building, moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋仓库独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _bindWorkforceControls(root) {
        root?.querySelectorAll('[data-worker-delta]').forEach((button) => {
            button.addEventListener('click', () => this._adjustWorkers(Number(button.dataset.workerDelta) || 0));
        });
        root?.querySelector('[data-worker-max]')?.addEventListener('click', () => this._assignMaxWorkers());
    }

    _adjustWorkers(delta) {
        if (!this.building) return;
        const result = PopulationEconomySystem.adjustAssignedWorkers(this.building, delta);
        this._notify(result.ok ? `岗位人口调整为 ${result.assigned}/${result.slots}` : result.reason, result.ok ? '#7fe0c8' : '#ff5555');
        this.refresh();
    }

    _assignMaxWorkers() {
        if (!this.building) return;
        const result = PopulationEconomySystem.assignMaxWorkers(this.building);
        this._notify(result.ok ? `已分配 ${result.assigned}/${result.slots} 人` : result.reason, result.ok ? '#7fe0c8' : '#ff5555');
        this.refresh();
    }

    _upgradeResearchLevel() {
        if (!this.building) return;
        const result = PopulationEconomySystem.startResearchUpgrade(this.building);
        this._notify(
            result.ok ? `研究所开始升级到 Lv.${result.targetLevel}` : result.reason,
            result.ok ? '#c9a0ff' : '#ff5555'
        );
        this.refresh();
    }

    _upgradeResearchModule(moduleId) {
        if (!this.building) return;
        const result = PopulationEconomySystem.startResearchModuleUpgrade(
            this.building,
            moduleId
        );
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(
            result.ok ? `${name}开始升级（仅作用于本栋研究所）` : result.reason,
            result.ok ? '#7fe0c8' : '#ff5555'
        );
        this.refresh();
    }

    _showResearchModuleTip(moduleId, event) {
        const building = this.building;
        const module = building?._cfg?.modules?.[moduleId];
        if (!building || building._economyType !== 'research' || !module) return;
        const level = PopulationEconomySystem.getResearchModuleLevel(building, moduleId);
        const maxed = level >= (Number(module.maxLevel) || 0);
        const valueAt = (atLevel) => (Number(module.base) || 0)
            + (Number(module.per) || 0) * atLevel;
        const format = module.effect === 'researchStaffCapacity'
            ? (value) => `${Math.round(value)} 个研究员岗位`
            : (value) => `+${value.toFixed(2)} 科研点/秒`;
        const current = valueAt(level);
        const description = (module.desc || '强化本栋研究所。')
            .replace('{value}', module.effect === 'researchStaffCapacity'
                ? String(Math.round(current)) : current.toFixed(2));
        const cost = PopulationEconomySystem.getResearchModuleUpgradeCost(
            building,
            moduleId
        );
        const unlocked = TechnologySystem.isUnlocked('upgrade', moduleId);
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(current)}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">${description}</div>
            <div style="margin-top:2px;color:#7fe0c8;">作用范围：仅当前这座研究所</div>
            <div>${!unlocked ? `需要科技：${technologyName || moduleId}`
                : (maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`)}</div>
            <div>${maxed || !unlocked ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _showResearchLevelTip(event) {
        const building = this.building;
        if (!building || building._economyType !== 'research') return;
        const levels = populationEconomyConfig.research?.levels || [];
        const current = levels.find((entry) => entry.level === building._economyLevel);
        const next = PopulationEconomySystem.getResearchUpgrade(building);
        const maxLevel = Math.max(1, ...levels.map((entry) => entry.level || 1));
        const requirement = next?.technologyUnlockId
            ? TechnologySystem.getUnlockRequirementLabel('upgrade', next.technologyUnlockId)
            : '';
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon('🏛️', 'assets/ui/building-upgrades/research-tower-expansion.png', 'building-upgrade-tooltip-icon')}<span>研究所塔楼扩建</span> <span style="color:#8a5a00;">Lv.${building._economyLevel}/${maxLevel}</span></div>
            <div>基础科研 ${Number(current?.baseResearchPointsPerSecond || 0).toFixed(2)} 点/秒${next ? ` → ${Number(next.baseResearchPointsPerSecond || 0).toFixed(2)} 点/秒` : ''}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋独立升级；岗位与全局科研强化保持不变</div>
            <div style="margin-top:2px;">${next ? `需要科技：${requirement || next.technologyUnlockId}` : '已达到最高等级'}</div>
            <div>${next ? `升级费用：${next.upgradeCost?.gold || 0} 金币 + ${next.upgradeCost?.energy || 0} 能源` : ''}</div>
            <div>${next ? `读条时间：${Math.round((next.upgradeCost?.timeMs || 0) / 1000)} 秒` : ''}</div>`, event);
    }

    _upgradeHouse() {
        if (!this.building) return;
        const result = PopulationEconomySystem.startHouseUpgrade(this.building);
        this._notify(result.ok ? `房屋开始升级到 Lv.${result.targetLevel}` : result.reason, result.ok ? '#ffe08a' : '#ff5555');
        this.refresh();
    }

    _showHouseTip(event) {
        const building = this.building;
        if (!building || building._economyType !== 'housing') return;
        const levels = populationEconomyConfig.house?.levels || [];
        const current = levels.find((entry) => entry.level === building._economyLevel);
        const next = PopulationEconomySystem.getHouseUpgrade(building);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon('🏠', 'assets/ui/building-upgrades/living-space-expansion.png', 'building-upgrade-tooltip-icon')}<span>居住空间</span> <span style="color:#8a5a00;">Lv.${building._economyLevel}/${Math.max(1, ...levels.map((entry) => entry.level || 1))}</span></div>
            <div>人口容量 ${current?.populationCapacity || 0}${next ? ` → ${next.populationCapacity}` : ''}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋房屋独立升级；读条完成后更换贴图并提升人口容量</div>
            <div style="margin-top:2px;">${next ? `升级费用：${next.upgradeCost?.gold || 0} 金币 + ${next.upgradeCost?.energy || 0} 能源` : '已达到最高等级'}</div>
            <div>${next ? `读条时间：${Math.round((next.upgradeCost?.timeMs || 0) / 1000)} 秒` : ''}</div>`, event);
    }

    _marketBuy() {
        if (!this.building) return;
        const result = PopulationEconomySystem.buyGold(this.building);
        this._notify(result.ok ? `市场成交：-${result.energy} 能源，+${result.gold} 金币` : result.reason, result.ok ? '#7fd4ff' : '#ff5555');
        this.refresh();
    }

    _marketSell() {
        if (!this.building) return;
        const result = PopulationEconomySystem.sellGold(this.building);
        this._notify(result.ok ? `市场成交：-${result.gold} 金币，+${result.energy} 能源` : result.reason, result.ok ? '#ffe08a' : '#ff5555');
        this.refresh();
    }

    /** 铁匠铺能力升级（读条）或持续升级切换（2026-08-17） */
    _upgradeAbility(abilityId, continuous) {
        if (!this.building) return;
        const b = this.building;
        if (continuous) {
            const wasActive = b.isContinuousUpgrade('ability', abilityId);
            const res = b.setContinuousUpgrade({ kind: 'ability', abilityId });
            const name = b.getAbility(abilityId)?.name || abilityId;
            if (!res.ok) this._notify(res.reason, '#ff5555');
            else if (wasActive || res.stopped) this._notify(`${name} 停止持续升级`, '#ffd700');
            else if (res.waiting) this._notify(`${name} 持续升级已开启，等待条件与资源`, '#c9a0ff');
            else this._notify(`${name} 持续升级开启（条件满足后自动续升）`, '#c9a0ff');
        } else {
            const res = b.startAbilityUpgrade(abilityId, false);
            if (res.ok) {
                this._notify(`${b.getAbility(abilityId)?.name || abilityId} 开始升级（读条 ${Math.round(res.cost.timeMs / 1000)}s）`, '#c9a0ff');
            } else {
                this._notify(res.reason, '#ff5555');
            }
        }
        this.refresh();
    }

    _teleport(sceneId) {
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (!player || !sceneId || SceneManager.isLoading) return;
        if (this.building?._portalDestroyed || !(this.building?.hp > 0)) {
            this._notify('传送门已被摧毁，重建后才能传送', '#ff5555');
            return;
        }
        if (sceneId !== 'main' && !WorldProgressionSystem.isPortalConstructed(sceneId)) {
            this._notify('目标世界尚未接入传送网络', '#ff5555');
            return;
        }
        if (SceneManager.currentScene === sceneId) {
            this._notify('已经在该世界中', '#ffd700');
            return;
        }
        this.close();
        return SceneManager.switchScene(sceneId, player, undefined, { portalTravel: true }).catch((err) => {
            console.error('[portal building] switchScene error:', err);
            this._notify('传送失败，请稍后重试', '#ff5555');
        });
    }

    _constructPortal(sceneId) {
        const result = WorldProgressionSystem.constructPortal(sceneId);
        if (!result.ok) {
            this._notify(result.reason || '传送门构造失败', '#ff5555');
            return;
        }
        if (sceneId === SceneManager.currentScene && this.building?._isWorldPortalCore) {
            WorldProgressionSystem.revivePortalEntity(sceneId, this.building);
        }
        const world = WorldProgressionSystem.getWorldConfig(sceneId);
        this._notify(`${world?.name || sceneId}传送门${result.firstConstruction ? '构造完成' : '重建完成'}`, '#b8a8ff');
        this.refresh();
    }

    /** 出兵建筑模块说明：复用研究院/铁匠铺的白色悬停浮窗。 */
    _showModuleTip(moduleId, ev, unitType = null) {
        if (!this.building) return;
        const b = this.building;
        const targetUnitType = unitType || b.unitType;
        const mod = b._cfg.modules?.[moduleId];
        const targetKinds = b.moduleUnitTypes(moduleId, targetUnitType);
        if (!mod || !targetKinds.length) return;
        const lv = b.moduleLevel(moduleId, targetKinds[0]);
        const maxed = lv >= mod.maxLevel;
        const desc = getProducerModuleDesc(b._cfg, moduleId, lv);
        const cost = b.getModuleCost(moduleId, targetKinds[0]);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(mod.icon, mod.iconImage, 'building-upgrade-tooltip-icon')}<span>${mod.name}</span> <span style="color:#8a5a00;">Lv.${lv}/${mod.maxLevel}</span></div>
            <div>${maxed ? desc.current : `${desc.current} → ${desc.next}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">适用兵种：${targetKinds.map((kind) => b.unitName(kind)).join('、')}</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>`, ev);
    }

    /** 能力说明浮窗（类似装备栏白色浮窗，2026-08-17）：悬停能力行时显示 */
    _showAbilityTip(abilityId, ev) {
        if (!this.building) return;
        const b = this.building;
        const a = b.getAbility(abilityId);
        if (!a) return;
        const lv = b.abilityLevel(abilityId);
        const maxed = lv >= (a.maxLevel ?? 10);
        const cost = b.getAbilityCost(abilityId);
        const isResearch = b._cfg.workshopType === 'research';
        const targetLabel = isResearch ? '目标效果' : '目标兵种';
        const targetText = isResearch ? (a.target || '—') : this._abilityTargetText(a.target);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(a.icon, a.iconImage, 'building-upgrade-tooltip-icon')}<span>${a.name}</span> <span style="color:#8a5a00;">Lv.${lv}/${a.maxLevel ?? 10}</span></div>
            <div>${maxed ? this._fillAbilityDesc(a, lv) : `${this._fillAbilityDesc(a, lv)} → ${this._fillAbilityDesc(a, lv + 1)}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">${targetLabel}：${targetText}</div>
            <div style="margin-top:2px;">升级费用：${cost.gold} 金币 + ${cost.energy} 能源</div>
            <div>读条时间：${Math.round(cost.timeMs / 1000)} 秒</div>`, ev);
    }

    /** 浮窗跟随鼠标（右侧优先，越界翻转到左侧/上方） */
    _moveAbilityTip(ev) {
        moveBuildingUpgradeTooltip(ev);
    }

    _hideAbilityTip() {
        hideBuildingUpgradeTooltip();
    }
}

// ==================== 系统 ====================

export const ProducerBuildingSystem = {
    active: false,
    buildings: [],
    _panel: null,
    _seq: 0,

    _ensurePanel() {
        if (!this._panel) this._panel = new ProducerBuildingPanel();
        return this._panel;
    },

    setup() {
        this.teardown();
        this.active = true;
        this.buildings = [];
        ResearchSystem.resetTimer();
        if (EnergyManager) {
            EnergyManager.setCallbacks({
                onFull: (text) => {
                    if (Game && Game.player && EffectManager) {
                        EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 64, text, '#ff8855'));
                    }
                },
            });
        }
    },

    teardown() {
        this.active = false;
        ResearchSystem.resetTimer();
        for (const b of this.buildings) {
            if (b) {
                if (b._isEnergyWarehouse && EnergyManager) {
                    // 粮食已逐仓写入位面快照，不能再放入跨场景 pending 队列造成重复/串位面。
                    EnergyManager.unregisterWarehouse(b, { preserve: true, preserveFood: false });
                }
                b.active = false;
                HamsterFarmerVisualSystem.clearBuilding(b);
                HamsterBankerVisualSystem.clearBuilding(b);
                HamsterBakerVisualSystem.clearBuilding(b);
                HamsterCowherdVisualSystem.clearBuilding(b);
                HolsteinCowVisualSystem.clearBuilding(b);
                HamsterBoilerWorkerVisualSystem.clearBuilding(b);
                HamsterBartenderVisualSystem.clearBuilding(b);
                ArmoryMaintainerVisualSystem.clearBuilding(b);
                HouseResidentVisualSystem.clearBuilding(b);
                BankEconomySystem.unregisterBuilding(b);
                GrandMallEconomySystem.unregisterBuilding(b);
                BakeryEconomySystem.unregisterBuilding(b, { preserve: true });
                CheeseFarmSystem.unregisterBuilding(b, { preserve: true });
                SteamPowerPlantSystem.unregisterBuilding(b, { preserve: true });
                DeepDrillSystem.unregisterBuilding(b);
                TavernEconomySystem.unregisterBuilding(b);
                WorkshopEconomySystem.unregisterBuilding(b);
                ArmoryEconomySystem.unregisterBuilding(b);
                FieldHospitalSystem.unregisterBuilding(b);
                WarehouseEconomySystem.unregisterBuilding(b);
                CandleSanctuarySystem.unregisterBuilding(b);
                b._despawnUnits();
                if (Game && Game.entities && b.id) Game.entities.delete(b.id);
            }
        }
        this.buildings = [];
        HamsterFarmerVisualSystem.reset();
        HamsterBankerVisualSystem.reset();
        HamsterBakerVisualSystem.reset();
        HamsterCowherdVisualSystem.reset();
        HolsteinCowVisualSystem.reset();
        HamsterBoilerWorkerVisualSystem.reset();
        HamsterBartenderVisualSystem.reset();
        ArmoryMaintainerVisualSystem.reset();
        HouseResidentVisualSystem.reset();
        BankEconomySystem.reset();
        GrandMallEconomySystem.reset();
        BakeryEconomySystem.reset();
        CheeseFarmSystem.reset();
        SteamPowerPlantSystem.reset();
        TavernEconomySystem.reset();
        WorkshopEconomySystem.reset();
        ArmoryEconomySystem.reset();
        FieldHospitalSystem.reset();
        WarehouseEconomySystem.reset();
        CandleSanctuarySystem.reset();
        PopulationEconomySystem.reset();
        scheduleFriendlyAssetResidencyRefresh();
        if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.building = null;
            this._panel.player = null;
        }
    },

    update(dt) {
        if (!this.active) return;
        ResearchSystem.update(dt);
        for (const b of this.buildings) {
            if (b && b.active) b.update(dt);
        }
    },

    getActiveVisualUnitIds() {
        const ids = new Set();
        for (const building of this.buildings || []) {
            for (const id of building?.getActiveVisualUnitIds?.() || []) ids.add(id);
        }
        return [...ids];
    },

    /** 点击产兵建筑 → 打开面板（再次点击关闭） */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const mw = Renderer.screenToWorld(mx, my);
        const buildMode = !!(Game && Game._buildMode);   // 建设模式无视距离
        let picked = null;
        let pickedScore = Infinity;
        for (const b of this.buildings) {
            if (!b || !b.active) continue;
            const pdx = b.x - player.x;
            const pdy = b.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            const cfg = b._cfg;
            const displayW = Number(b.spriteCfg?.size) || cfg.displayW;
            const displayH = Number(b.spriteCfg?.sizeH) || cfg.displayH;
            const hit = { cx: 0, cy: -Math.round(displayH * 0.4), hw: Math.round(displayW / 2), hh: Math.round(displayH * 0.44) };
            const visualX = b.x + (b._visualFootOffsetX || 0);
            if (mw.x < visualX + hit.cx - hit.hw || mw.x > visualX + hit.cx + hit.hw
                || mw.y < b.y + hit.cy - hit.hh || mw.y > b.y + hit.cy + hit.hh) continue;
            // 同类2×2建筑相邻时命中盒可能重叠；选择离点击点最近的实例，
            // 禁止数组中的第一栋建筑抢走交互，造成“所有同类建筑同步切兵种”的错觉。
            const dx = (mw.x - (visualX + hit.cx)) / Math.max(1, hit.hw);
            const dy = (mw.y - (b.y + hit.cy)) / Math.max(1, hit.hh);
            const score = dx * dx + dy * dy;
            if (score < pickedScore) {
                picked = b;
                pickedScore = score;
            }
        }
        if (!picked) return false;
        if (picked._cfg?.panelMode === 'tribute') {
            if (World122TributeSystem.isOpenFor(picked)) World122TributeSystem.closePanel();
            else World122TributeSystem.openFor(picked, player);
            Game?.BuildingSystem?._keepOnlyBuildingDetailPanel?.(
                World122TributeSystem._panel?.isOpen ? World122TributeSystem._panel : null
            );
            return true;
        }
        const panel = this._ensurePanel();
        if (panel.isOpen && panel.building === picked) panel.close();
        else panel.openFor(picked, player);
        Game?.BuildingSystem?._keepOnlyBuildingDetailPanel?.(panel.isOpen ? panel : null);
        return true;
    },

    closePanel() {
        if (this._panel && this._panel.isOpen) this._panel.close();
    },
};
