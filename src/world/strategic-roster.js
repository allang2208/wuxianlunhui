// Pure, bounded combat records shared by marching armies and offscreen sieges.
import enemies from '../../data/enemy-config.json';
import { deriveEnemyBaseStats } from '../config/enemy-base-stats.js';
import { COMBAT_CONFIG } from '../config/combat-config.js';

export function strategicUnitStats(record) {
    const source = enemies[record.type] || {};
    const stats = deriveEnemyBaseStats({ ...(COMBAT_CONFIG.enemyDefaults?.stats || {}), ...source }, source);
    return { hp: Math.max(1, record.maxHp || (stats.maxHp || source.hp || 150) * (record.hpMul || 1)),
        dps: Math.max(1, (record.atk || (stats.atk || 12) * (record.atkMul || 1)) * 1000 / Math.max(500, source.attack?.cooldown || 1500)) };
}

export function strategicRosterPower(roster) {
    return (roster || []).reduce((sum, record) => {
        const stats = strategicUnitStats(record);
        sum.hp += stats.hp * Math.max(0, record.hpRatio);
        sum.dps += record.hpRatio > 0 ? stats.dps : 0;
        return sum;
    }, { hp: 0, dps: 0 });
}

export function damageStrategicRoster(roster, damage) {
    let left = Math.max(0, damage);
    const survivors = [];
    for (const record of roster || []) {
        const maxHp = strategicUnitStats(record).hp;
        const hp = maxHp * Math.max(0, record.hpRatio);
        const dealt = Math.min(hp, left);
        left -= dealt;
        if (hp > dealt) survivors.push({ ...record, hpRatio: (hp - dealt) / maxHp });
    }
    return survivors;
}
