// DamageableEntity 位于实体继承链最底层，不能静态依赖 Game、UI、地牢或特效管理器。
// 这些服务由应用入口在所有模块完成初始化后注入，避免
// DamageableEntity -> ... -> Enemy -> Combatant -> DamageableEntity 的 ESM TDZ 环。
const runtime = {
    game: null,
    renderer: null,
    effectManager: null,
    partySystem: null,
    skillManager: null,
    burstParticles: null,
    tribute: null,
};

export function configureDamageableRuntime(services = {}) {
    if (Object.prototype.hasOwnProperty.call(services, 'game')) runtime.game = services.game;
    if (Object.prototype.hasOwnProperty.call(services, 'renderer')) runtime.renderer = services.renderer;
    if (Object.prototype.hasOwnProperty.call(services, 'effectManager')) runtime.effectManager = services.effectManager;
    if (Object.prototype.hasOwnProperty.call(services, 'partySystem')) runtime.partySystem = services.partySystem;
    if (Object.prototype.hasOwnProperty.call(services, 'skillManager')) runtime.skillManager = services.skillManager;
    if (Object.prototype.hasOwnProperty.call(services, 'burstParticles')) runtime.burstParticles = services.burstParticles;
    if (Object.prototype.hasOwnProperty.call(services, 'tribute')) runtime.tribute = services.tribute;
}

// 以下门面保持 DamageableEntity 原有调用语义，同时把真实依赖推迟到运行时。
export const DamageableGame = {
    dropItem(...args) {
        return runtime.game?.dropItem?.(...args);
    },
};

export const DamageableRenderer = {
    worldToScreen(x, y) {
        return runtime.renderer?.worldToScreen?.(x, y) ?? { x, y };
    },
};

export const DamageableEffectManager = {
    add(...args) {
        return runtime.effectManager?.add?.(...args);
    },
    createDamageText(...args) {
        return runtime.effectManager?.createDamageText?.(...args);
    },
};

export const DamageablePartySystem = {
    grantCombatExp(...args) {
        return runtime.partySystem?.grantCombatExp?.(...args);
    },
};

export const DamageableSkillManager = {
    addCriticalStrikeExp(...args) {
        return runtime.skillManager?.addCriticalStrikeExp?.(...args);
    },
    addMachineGunMasteryExp(...args) {
        return runtime.skillManager?.addMachineGunMasteryExp?.(...args);
    },
    addRifleMasteryExp(...args) {
        return runtime.skillManager?.addRifleMasteryExp?.(...args);
    },
    addPistolMasteryExp(...args) {
        return runtime.skillManager?.addPistolMasteryExp?.(...args);
    },
    addShotgunMasteryExp(...args) {
        return runtime.skillManager?.addShotgunMasteryExp?.(...args);
    },
    addBowExp(...args) {
        return runtime.skillManager?.addBowExp?.(...args);
    },
    addDroneExp(...args) {
        return runtime.skillManager?.addDroneExp?.(...args);
    },
};

export function damageableBurstParticles(...args) {
    return runtime.burstParticles?.(...args);
}

export function getTributeGoldMultiplier(...args) {
    return runtime.tribute?.getTributeGoldMultiplier?.(...args) ?? 1;
}

export function getTributeKillMpHealRatio(...args) {
    return runtime.tribute?.getTributeKillMpHealRatio?.(...args) ?? 0;
}

export function getTributeKillHpHealRatio(...args) {
    return runtime.tribute?.getTributeKillHpHealRatio?.(...args) ?? 0;
}

export function getTributeMonsterDamageTakenMul(...args) {
    return runtime.tribute?.getTributeMonsterDamageTakenMul?.(...args) ?? 1;
}

export function getMoonshadowConfig(...args) {
    return runtime.tribute?.getMoonshadowConfig?.(...args) ?? null;
}

export function rollTributeDrop(...args) {
    return runtime.tribute?.rollTributeDrop?.(...args) ?? null;
}

export function getFriendlyLifestealPercent(...args) {
    return runtime.tribute?.getFriendlyLifestealPercent?.(...args) ?? 0;
}
