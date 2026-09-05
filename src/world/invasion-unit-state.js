// Permanent phase state survives interception/relief; target references and
// transient attack hitboxes never cross scenes.
export function captureInvasionUnit(unit, record) {
    const snapshot = { ...record, hpRatio: unit.hp / Math.max(1, unit.maxHp), maxHp: unit.maxHp, atk: unit.data?.atk };
    if (!Number.isInteger(record.invasionWave)) return snapshot;
    snapshot.matk = unit.data?.matk;
    snapshot.phase = {};
    for (const key of ['_isTransformed', '_isTransforming', '_transformTriggered', '_transformTimer',
        '_phaseOpened', '_phaseOpening', '_phaseOpenTriggered', '_phaseTimer', '_elytraProgress', '_beamBroken', '_beamDurability']) {
        if (typeof unit[key] === 'boolean' || Number.isFinite(unit[key])) snapshot.phase[key] = unit[key];
    }
    return snapshot;
}

export function restoreInvasionPhase(unit, record) {
    if (!Number.isInteger(record?.invasionWave) || unit._invasionPhaseRestored) return;
    unit._invasionPhaseRestored = true;
    const phase = record.phase || {};
    if (phase._isTransformed && ['redWolfKing', 'blackBear'].includes(record.type)) {
        unit._isTransformed = true;
        unit._transformTriggered = true;
        unit._isTransforming = false;
        if (record.type === 'redWolfKing') unit._applyTransform();
        else unit._applyBearTransform();
    } else if (phase._isTransforming && ['redWolfKing', 'blackBear'].includes(record.type)) {
        unit._transformTriggered = true;
        unit._isTransforming = true;
        unit._transformTimer = Math.max(0, Number(phase._transformTimer) || 0);
        unit._captureWerewolfCollisionBase?.();
        unit._frozenForCast = true;
    }
    if (record.type === 'rotbogRhinocerosBeetleKing') {
        for (const key of ['_phaseOpened', '_phaseOpening', '_phaseOpenTriggered', '_phaseTimer', '_elytraProgress']) {
            if (key in phase) unit[key] = phase[key];
        }
        if (unit._phaseOpened) unit.speed = unit.maxSpeed = unit._baseRotbogSpeed * (Number(unit._phaseCfg.speedMultiplier) || 1.25);
    }
    if (record.type === 'supportBeamBrute' && '_beamDurability' in phase) {
        unit._beamDurability = Math.max(0, phase._beamDurability);
        if (phase._beamBroken) {
            unit._beamBroken = true;
            unit.speed = unit.maxSpeed = unit._baseSpeed = Math.max(1, Number(unit._getBreakConfig().brokenSpeed) || unit.speed || 145);
            unit._applyPhaseCombatConfig();
            unit._animState = 'unarmed_idle';
        }
    }
}

export function restoreInvasionUnitState(unit, record) {
    if (!Number.isInteger(record.invasionWave)) return;
    restoreInvasionPhase(unit, record);
    // Transformation methods restore mechanics once; never replay their heal.
    if (record.maxHp > 0) unit.maxHp = record.maxHp;
    unit.hp = Math.max(1, unit.maxHp * record.hpRatio);
    if (unit.data) {
        unit.data.hp = unit.hp; unit.data.maxHp = unit.maxHp;
        if (Number.isFinite(record.atk)) unit.data.atk = record.atk;
        if (Number.isFinite(record.matk)) unit.data.matk = record.matk;
    }
}
