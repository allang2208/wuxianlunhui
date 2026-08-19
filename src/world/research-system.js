// ============================================================
// 世界-122 研究院全局研究（2026-08-18）
// - wall_hp：方块墙最大生命每级 +10%
// - gate_hp：4格门最大生命每级 +10%
// - passive_energy：每级每秒被动获得 1 能源
// - recruit_speed：Lv1 募兵速度 +10%，之后每级 +2%
// 等级由 ability-store 持久化；研究完成立即刷新场上结构，新建结构构造时自动应用。
// ============================================================
import { GLOBAL_ABILITY_LEVELS, getAbilityLevel, getAbilityValue } from './ability-store.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { getBuildingUpgradeAbility } from './building-upgrade-projects.js';

export const RESEARCH_IDS = {
    STRUCTURE_HP: 'research_structure_hp',
    PASSIVE_ENERGY: 'research_passive_energy',
    RECRUIT_SPEED: 'research_recruit_speed',
    LEGACY_WALL_HP: 'research_wall_hp',
    LEGACY_GATE_HP: 'research_gate_hp',
};

/** 旧测试存档的墙/门独立等级合并到新共享等级，取较高值避免进度损失。 */
export function migrateLegacyResearchLevels() {
    const legacy = Math.max(
        getAbilityLevel(RESEARCH_IDS.LEGACY_WALL_HP),
        getAbilityLevel(RESEARCH_IDS.LEGACY_GATE_HP)
    );
    const current = getAbilityLevel(RESEARCH_IDS.STRUCTURE_HP);
    if (legacy > current) GLOBAL_ABILITY_LEVELS[RESEARCH_IDS.STRUCTURE_HP] = legacy;
    delete GLOBAL_ABILITY_LEVELS[RESEARCH_IDS.LEGACY_WALL_HP];
    delete GLOBAL_ABILITY_LEVELS[RESEARCH_IDS.LEGACY_GATE_HP];
    return Math.max(current, legacy);
}

function _structureHpLevel() {
    migrateLegacyResearchLevels();
    return getAbilityLevel(RESEARCH_IDS.STRUCTURE_HP);
}

/** 新建/现有结构统一应用研究生命值；增加上限时同步增加当前生命，保持已损失生命不变。 */
export function applyResearchHp(entity, explicitBaseHp = null) {
    if (!entity || (!entity._isBlockCover && !entity._isGate4)) return entity;
    const currentMax = Number(entity.maxHp ?? entity.data?.maxHp ?? 1) || 1;
    if (!(entity._researchBaseMaxHp > 0)) {
        entity._researchBaseMaxHp = explicitBaseHp > 0 ? explicitBaseHp : currentMax;
    }
    const level = _structureHpLevel();
    const hpBonus = getAbilityValue(getBuildingUpgradeAbility(RESEARCH_IDS.STRUCTURE_HP), level);
    const nextMax = Math.max(1, Math.round(entity._researchBaseMaxHp * (1 + hpBonus)));
    const delta = nextMax - currentMax;
    entity.maxHp = nextMax;
    entity.hp = Math.max(0, Math.min(nextMax, Number(entity.hp ?? nextMax) + delta));
    if (entity.data) {
        entity.data.maxHp = nextMax;
        entity.data.hp = entity.hp;
    }
    return entity;
}

/** 研究完成后刷新当前场景内全部对应结构。 */
export function applyResearchToWorld(abilityId) {
    const game = typeof window !== 'undefined' ? window.Game : null;
    if (!game || !game.entities) return 0;
    let count = 0;
    for (const entity of game.entities.values()) {
        const structureResearch = abilityId === RESEARCH_IDS.STRUCTURE_HP
            || abilityId === RESEARCH_IDS.LEGACY_WALL_HP
            || abilityId === RESEARCH_IDS.LEGACY_GATE_HP;
        const matches = structureResearch && entity && (entity._isBlockCover || entity._isGate4);
        if (!matches || !entity.active) continue;
        applyResearchHp(entity);
        count++;
    }
    return count;
}

/** 当前快速募兵的速度加成；Lv0=0，Lv1=10%，之后每级 +2 个百分点。 */
export function getRecruitSpeedBonus(level = getAbilityLevel(RESEARCH_IDS.RECRUIT_SPEED)) {
    return getAbilityValue(getBuildingUpgradeAbility(RESEARCH_IDS.RECRUIT_SPEED), level);
}

/** 募兵速度提升按“生产率”计算：周期 = 基础周期 / (1 + 速度加成)。 */
export function getRecruitIntervalMs(baseIntervalMs, level = getAbilityLevel(RESEARCH_IDS.RECRUIT_SPEED)) {
    const base = Math.max(1, Number(baseIntervalMs) || 1);
    return Math.max(1, Math.round(base / (1 + getRecruitSpeedBonus(level))));
}

/** 研究完成时按新旧周期比例缩放当前剩余时间，避免已进行中的募兵进度跳回起点。 */
function _rescaleActiveRecruitTimers(newLevel) {
    const game = typeof window !== 'undefined' ? window.Game : null;
    if (!game || !game.entities) return 0;
    const oldLevel = Math.max(0, newLevel - 1);
    let count = 0;
    for (const entity of game.entities.values()) {
        if (!entity || !entity.active) continue;
        const isRecruiter = entity._isHamsterBarracks
            || (entity._isProducerBuilding && entity.spawnEnabled);
        const base = entity._baseSpawnIntervalMs;
        if (!isRecruiter || !(base > 0) || !Number.isFinite(entity._spawnTimer)) continue;
        const oldInterval = getRecruitIntervalMs(base, oldLevel);
        const newInterval = getRecruitIntervalMs(base, newLevel);
        entity._spawnTimer = Math.max(0, Math.min(newInterval, entity._spawnTimer * newInterval / oldInterval));
        count++;
    }
    return count;
}

export const ResearchSystem = {
    _energyTimer: 0,
    getRecruitSpeedBonus,
    getRecruitIntervalMs,

    resetTimer() {
        this._energyTimer = 0;
    },

    onResearchLeveled(abilityId) {
        if (abilityId === RESEARCH_IDS.STRUCTURE_HP) {
            applyResearchToWorld(abilityId);
        } else if (abilityId === RESEARCH_IDS.RECRUIT_SPEED) {
            _rescaleActiveRecruitTimers(getAbilityLevel(RESEARCH_IDS.RECRUIT_SPEED));
        }
    },

    refreshWorld() {
        migrateLegacyResearchLevels();
        const count = applyResearchToWorld(RESEARCH_IDS.STRUCTURE_HP);
        this.resetTimer();
        return count;
    },

    /** 仅 ProducerBuildingSystem 活跃（世界-122）时调用；dt 单位毫秒。 */
    update(dt) {
        const level = getAbilityLevel(RESEARCH_IDS.PASSIVE_ENERGY);
        if (level <= 0) {
            this._energyTimer = 0;
            return;
        }
        this._energyTimer += Math.max(0, dt || 0);
        const seconds = Math.floor(this._energyTimer / 1000);
        if (seconds <= 0) return;
        this._energyTimer -= seconds * 1000;
        if (EnergyManager && typeof EnergyManager.addEnergy === 'function') {
            const perSecond = getAbilityValue(getBuildingUpgradeAbility(RESEARCH_IDS.PASSIVE_ENERGY), level);
            EnergyManager.addEnergy(perSecond * seconds);
        }
    },
};
