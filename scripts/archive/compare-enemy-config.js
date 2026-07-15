const fs = require('fs');
const path = require('path');

const backupPath = path.join('E:', '无尽轮回', '长期备份', 'game-dev-backup-20260709_191538', 'data', 'enemy-config.json');
const currentPath = path.join(__dirname, '..', 'data', 'enemy-config.json');

const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));

const diffs = [];
for (const key of Object.keys(current)) {
    const b = backup[key];
    const c = current[key];
    if (!b) {
        diffs.push({ id: key, note: 'backup missing' });
        continue;
    }
    const fieldDiffs = [];
    const scalarFields = ['hp', 'maxHp', 'def', 'size', 'collisionRadius', 'speed', 'level', 'str', 'dex', 'con', 'int', 'wis', 'luck', 'attackRange', 'aiInterval', 'dashDistance'];
    for (const f of scalarFields) {
        if (b[f] !== undefined && c[f] !== undefined && b[f] !== c[f]) {
            fieldDiffs.push({ field: f, backup: b[f], current: c[f] });
        }
    }
    if (b.attack && c.attack) {
        const attackFields = ['type', 'cooldown', 'range', 'dynamicRange', 'projectileSpeed', 'width', 'damageMin', 'damageMax', 'knockback'];
        for (const f of attackFields) {
            if (b.attack[f] !== undefined && c.attack[f] !== undefined && b.attack[f] !== c.attack[f]) {
                fieldDiffs.push({ field: `attack.${f}`, backup: b.attack[f], current: c.attack[f] });
            }
        }
        if (b.attack.type !== c.attack.type) {
            fieldDiffs.push({ field: 'attack.type', backup: b.attack.type, current: c.attack.type, note: 'type mismatch' });
        }
    }
    if (fieldDiffs.length) diffs.push({ id: key, fields: fieldDiffs });
}

console.log(JSON.stringify(diffs, null, 2));
