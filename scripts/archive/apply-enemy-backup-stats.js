const fs = require('fs');
const path = require('path');

const backupPath = path.join('E:', '无尽轮回', '长期备份', 'game-dev-backup-20260709_191538', 'data', 'enemy-config.json');
const currentPath = path.join(__dirname, '..', 'data', 'enemy-config.json');

const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));

const scalarFields = ['hp', 'maxHp', 'size', 'collisionRadius', 'speed', 'level', 'str', 'dex', 'con', 'int', 'wis', 'luck', 'attackRange', 'aiInterval', 'dashDistance'];
const aiFields = ['aggroRange', 'pacingRange', 'loseTimeout'];
const attackScalarFields = ['cooldown', 'range', 'dynamicRange', 'projectileSpeed', 'width', 'damageMin', 'damageMax', 'knockback'];

const RELATIVE_SPEED_BASE = 45;
const RELATIVE_SPEED_THRESHOLD = 5;

function transformSpeed(backupSpeed) {
    if (backupSpeed < RELATIVE_SPEED_THRESHOLD) {
        return backupSpeed * RELATIVE_SPEED_BASE * 3;
    }
    return backupSpeed * 3;
}

const changes = [];

for (const id of Object.keys(current)) {
    const b = backup[id];
    const c = current[id];
    if (!b) {
        changes.push({ id, note: 'backup missing, skipped' });
        continue;
    }

    const monsterChanges = [];

    for (const f of scalarFields) {
        if (b[f] !== undefined && b[f] !== c[f]) {
            const newValue = f === 'speed' ? transformSpeed(b[f]) : b[f];
            monsterChanges.push({ field: f, old: c[f], new: newValue });
            c[f] = newValue;
        } else if (f === 'speed' && b[f] !== undefined) {
            // 即使数值相同，也按规则重新计算并提升 3 倍
            const newValue = transformSpeed(b[f]);
            if (newValue !== c[f]) {
                monsterChanges.push({ field: f, old: c[f], new: newValue });
                c[f] = newValue;
            }
        }
    }

    if (b.ai && c.ai) {
        for (const f of aiFields) {
            if (b.ai[f] !== undefined && b.ai[f] !== c.ai[f]) {
                monsterChanges.push({ field: `ai.${f}`, old: c.ai[f], new: b.ai[f] });
                c.ai[f] = b.ai[f];
            }
        }
    }

    if (b.attack && c.attack) {
        if (b.attack.type === c.attack.type) {
            for (const f of attackScalarFields) {
                if (b.attack[f] !== undefined && b.attack[f] !== c.attack[f]) {
                    monsterChanges.push({ field: `attack.${f}`, old: c.attack[f], new: b.attack[f] });
                    c.attack[f] = b.attack[f];
                }
            }
        } else {
            // 攻击类型不一致（如毒液僵尸从 thrust 改为 ranged）：保留当前结构，仅提升投射物速度
            monsterChanges.push({
                field: 'attack',
                note: `type mismatch (backup=${b.attack.type}, current=${c.attack.type}); kept current structure`,
            });
            if (c.attack.type === 'ranged' && c.attack.projectileSpeed !== undefined) {
                const newSpeed = c.attack.projectileSpeed * 3;
                monsterChanges.push({ field: 'attack.projectileSpeed', old: c.attack.projectileSpeed, new: newSpeed });
                c.attack.projectileSpeed = newSpeed;
            }
        }
    }

    // 毒液僵尸专用：保持 600px 绕圈远程攻击
    if (id === 'spitterZombie') {
        const oldAttackRange = c.attackRange;
        const oldRange = c.attack.range;
        const oldProjectileRange = c.attack.projectileRange;
        c.attackRange = 600;
        if (!c.ai) c.ai = {};
        c.ai.circleRadius = 600;
        if (c.attack.range !== undefined) c.attack.range = 600;
        if (c.attack.projectileRange !== undefined) c.attack.projectileRange = 600;
        monsterChanges.push({ field: 'attackRange', old: oldAttackRange, new: 600 });
        monsterChanges.push({ field: 'ai.circleRadius', old: c.ai.circleRadius, new: 600 });
        monsterChanges.push({ field: 'attack.range', old: oldRange, new: 600 });
        monsterChanges.push({ field: 'attack.projectileRange', old: oldProjectileRange, new: 600 });
    }

    if (monsterChanges.length) changes.push({ id, changes: monsterChanges });
}

fs.writeFileSync(currentPath, JSON.stringify(current, null, 2));
console.log('[apply-enemy-backup-stats] Done. Changes:');
console.log(JSON.stringify(changes, null, 2));
