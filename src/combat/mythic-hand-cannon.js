/**
 * 两把神话手炮的单发状态机。
 *
 * 状态按装备实例隔离，因此主手、副手各自计时/计数；只有实际消耗弹药并准备
 * 创建投射物时才调用，避免空仓或取消射击污染机制进度。
 */

import { combatNowMs } from './combat-clock.js';

const HAND_CANNON_STATE = new WeakMap();

function getState(weapon) {
    let state = HAND_CANNON_STATE.get(weapon);
    if (!state) {
        state = { lastShotAt: 0, cadenceShots: 0 };
        HAND_CANNON_STATE.set(weapon, state);
    }
    return state;
}

function prepareEternalEdictShot(weapon, now) {
    const params = weapon.sanctifiedChamberParams || {};
    const effects = weapon._craftEffects || {};
    const state = getState(weapon);
    const restMs = Math.max(300,
        (Number(params.restMs) || 900) + (Number(effects.sanctifiedRestMsDelta) || 0));
    const charged = state.lastShotAt <= 0 || now - state.lastShotAt >= restMs;
    state.lastShotAt = now;

    if (!charged) return null;
    return {
        kind: 'sanctified',
        charged: true,
        damageMultiplier: Math.max(1,
            (Number(params.damageMultiplier) || 1.8)
            + (Number(effects.sanctifiedDamageMultiplierDelta) || 0)),
        spreadMultiplier: Math.max(0.05,
            (Number(params.spreadMultiplier) || 0.35)
            + (Number(effects.sanctifiedSpreadMultiplierDelta) || 0)),
        piercingBonus: Math.max(0, Math.round(
            (Number(params.piercingBonus) || 0)
            + (Number(effects.sanctifiedPiercingBonus) || 0))),
        knockbackDelta: (Number(params.knockbackDelta) || 0)
            + (Number(effects.sanctifiedKnockbackDelta) || 0),
    };
}

function prepareFalconEdictShot(weapon, now) {
    const params = weapon.duelistCadenceParams || {};
    const effects = weapon._craftEffects || {};
    const state = getState(weapon);
    const resetMs = Math.max(350,
        (Number(params.resetMs) || 1200) + (Number(effects.duelistResetMsDelta) || 0));
    if (state.lastShotAt <= 0 || now - state.lastShotAt > resetMs) {
        state.cadenceShots = 0;
    }
    state.lastShotAt = now;

    const requiredShots = Math.max(2, Math.round(
        (Number(params.requiredShots) || 3) + (Number(effects.duelistRequiredShotsDelta) || 0)));
    state.cadenceShots += 1;
    const finisher = state.cadenceShots >= requiredShots;
    if (finisher) state.cadenceShots = 0;
    if (!finisher) return null;

    return {
        kind: 'duelist',
        finisher: true,
        damageMultiplier: Math.max(1,
            (Number(params.damageMultiplier) || 1.5)
            + (Number(effects.duelistDamageMultiplierDelta) || 0)),
        spreadMultiplier: Math.max(0.05,
            (Number(params.spreadMultiplier) || 0.45)
            + (Number(effects.duelistSpreadMultiplierDelta) || 0)),
        piercingBonus: Math.max(0, Math.round(
            (Number(params.piercingBonus) || 0)
            + (Number(effects.duelistPiercingBonus) || 0))),
        knockbackDelta: (Number(params.knockbackDelta) || 0)
            + (Number(effects.duelistKnockbackDelta) || 0),
    };
}

export function prepareMythicHandCannonShot(weapon, now = combatNowMs()) {
    if (!weapon || typeof weapon !== 'object') return null;
    if (weapon.weaponId === 'weapon52') return prepareEternalEdictShot(weapon, now);
    if (weapon.weaponId === 'weapon53') return prepareFalconEdictShot(weapon, now);
    return null;
}
