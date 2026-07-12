const fs = require('fs');
const path = require('path');

const backupPath = path.join('E:', '无尽轮回', '长期备份', 'game-dev-backup-20260709_191538', 'data', 'enemy-config.json');
const currentPath = path.join(__dirname, '..', 'data', 'enemy-config.json');

const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));

const scalarFields = ['hp', 'maxHp', 'def', 'size', 'collisionRadius', 'speed', 'level', 'str', 'dex', 'con', 'int', 'wis', 'luck', 'attackRange', 'aiInterval', 'dashDistance'];
const aiFields = ['aggroRange', 'pacingRange', 'loseTimeout'];
const attackScalarFields = ['cooldown', 'range', 'dynamicRange', 'projectileSpeed', 'width', 'damageMin', 'damageMax', 'knockback'];

const changes = [];

for (const id of Object.keys(current)) {
    const b = backup[id];
    const c = current[id];
    if (!b) continue;

    const monsterChanges = [];

    for (const f of scalarFields) {
        if (b[f] !== undefined && b[f] !== c[f]) {
            // 速度单位不一致：备份是旧相对值（<1），当前是 px/s；暂不覆盖，仅记录
            if (f === 'speed' && (b[f] < 1 || c[f] < 1)) {
                monsterChanges.push({ field: f, backup: b[f], current: c[f], action: 'skipped (unit mismatch)' });
                continue;
            }
            c[f] = b[f];
            monsterChanges.push({ field: f, value: b[f] });
        }
    }

    if (b.ai && c.ai) {
        for (const f of aiFields) {
            if (b.ai[f] !== undefined && b.ai[f] !== c.ai[f]) {
                c.ai[f] = b.ai[f];
                monsterChanges.push({ field: `ai.${f}`, value: b.ai[f] });
            }
        }
    }

    if (b.attack && c.attack) {
        if (b.attack.type === c.attack.type) {
            for (const f of attackScalarFields) {
                if (b.attack[f] !== undefined && b.attack[f] !== c.attack[f]) {
                    c.attack[f] = b.attack[f];
                    monsterChanges.push({ field: `attack.${f}`, value: b.attack[f] });
                }
            }
        } else {
            monsterChanges.push({
                field: 'attack',
                note: `type mismatch (backup=${b.attack.type}, current=${c.attack.type}); kept current`,
                action: 'skipped'
            });
        }
    }

    if (monsterChanges.length) changes.push({ id, changes: monsterChanges });
}

fs.writeFileSync(currentPath, JSON.stringify(current, null, 2));
console.log('[migrate-enemy-stats] Done. Changes:');
console.log(JSON.stringify(changes, null, 2));
