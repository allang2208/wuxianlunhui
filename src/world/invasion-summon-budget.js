import config from '../../data/invasion-campaign.json';
import { getInvasionDeclaration } from '../config/enemy-invasion-catalog.js';

export function createInvasionSummonContext(waves, saved = null) {
    const records = [...new Map((waves || []).flat().filter((record) => Number.isInteger(record.invasionWave))
        .map((record) => [record.slot || record, record])).values()];
    if (!records.length) return null;
    const allowedTypes = new Set(), visited = new Set();
    const visit = (type) => {
        if (visited.has(type)) return;
        visited.add(type);
        for (const child of getInvasionDeclaration(type)?.summons || []) { allowedTypes.add(child); visit(child); }
    };
    records.forEach((record) => visit(record.type));
    const legacySpent = records.reduce((total, record) => total + Math.max(0, Number(record.summonsCreated) || 0), 0);
    const spent = Math.max(legacySpent, Number(saved?.spent) || 0,
        records.filter((record) => record.summoned).length);
    return { ledger: { limit: Math.max(0, Number(saved?.limit ?? config.formation.summonReserve)), spent,
        nextSerial: Math.max(spent + 1, Number(saved?.nextSerial) || 1),
        allowedTypes: Array.isArray(saved?.allowedTypes) ? [...saved.allowedTypes] : [...allowedTypes] } };
}

export function bindInvasionUnit(unit, record, context) {
    if (!Number.isInteger(record.invasionWave)) return;
    unit._invasionRecord = record;
    unit._invasionBudget = context;
    if (record.summoned) unit._summoned = true;
    if (record.companionSpawned) unit._cauldronSpawned = true;
}

// The periodic invasion has a finite reinforcement reserve. Other encounters
// retain the monster's original summon rules and lifetime.
export function invasionSummonSlotsLeft(owner) {
    const record = owner?._invasionRecord;
    const ledger = owner?._invasionBudget?.ledger;
    if (ledger) return Math.max(0, ledger.limit - ledger.spent);
    return record ? Math.max(0, config.formation.summonReserve - (record.summonsCreated || 0)) : Infinity;
}

export function canInvasionSummon(owner, type = null) {
    if (!owner?._invasionRecord) return true;
    const ledger = owner._invasionBudget?.ledger;
    return invasionSummonSlotsLeft(owner) > 0 && (!type || !ledger || ledger.allowedTypes.includes(type));
}

export function inheritInvasionSummon(owner, unit, type) {
    const parent = owner?._invasionRecord;
    if (!parent) return true;
    if (!type || !canInvasionSummon(owner, type)) return false;
    const ledger = owner._invasionBudget?.ledger;
    if (ledger) ledger.spent++;
    parent.summonsCreated = (parent.summonsCreated || 0) + 1;
    const serial = ledger ? ledger.nextSerial++ : parent.summonsCreated;
    const record = { type, role: 'normal', slot: `${parent.slot}:brood:${serial}`,
        invasionWave: parent.invasionWave, summoned: true, hpRatio: 1, hpMul: 1, atkMul: 1 };
    bindInvasionUnit(unit, record, owner._invasionBudget);
    if (!owner._defenseMonster) return true;
    unit._defenseMonster = true;
    unit._defenseMonsterType = type;
    unit._strategicSiegeRecord = record;
    unit._preferDefenseTargets = true;
    unit._engageHostileRange = owner._engageHostileRange;
    unit._alertRange = owner._alertRange;
    unit._noGoldDrop = owner._noGoldDrop;
    return true;
}
