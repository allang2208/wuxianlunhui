import enemyConfigData from '../../data/enemy-config.json';

// data-loader.js — 异步加载 JSON 配置数据

const DataLoader = {
    _cache: {},

    async loadJSON(path) {
        if (this._cache[path]) return this._cache[path];
        try {
            const response = await fetch(path + '?t=' + Date.now());
            if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
            const data = await response.json();
            this._cache[path] = data;
            return data;
        } catch (e) {
            console.error('DataLoader.loadJSON error:', e);
            return null;
        }
    },

    async loadAll() {
        const [equipment, skills] = await Promise.all([
            this.loadJSON('/data/equipment.json'),
            this.loadJSON('/data/skills.json')
        ]);
        return {
            equipment: equipment ? equipment.equipment : null,
            skills: skills ? skills.skills : null,
            enemies: this._convertEnemyConfig(enemyConfigData)
        };
    },

    /** 将 enemy-config.json 转换为图鉴所需的 ENEMY_DATA 格式 */
    _convertEnemyConfig(config) {
        const enemies = {};
        const rankMap = { normal: '普通', elite: '精英', boss: '首领' };
        for (const [id, data] of Object.entries(config)) {
            enemies[id] = {
                id,
                name: data.name,
                type: data.type || rankMap[data.rank] || '普通',
                category: data.category || 'monster',
                family: data.family,
                color: data.color,
                size: data.size,
                collisionRadius: data.collisionRadius,
                hp: data.hp,
                maxHp: data.maxHp,
                speed: data.speed,
                attackRange: data.attackRange,
                attackCooldown: data.attack?.cooldown,
                attackType: data.attackType || (data.attack?.type === 'thrust' ? '突刺' : data.attack?.type),
                damageMin: data.attack?.damageMin,
                damageMax: data.attack?.damageMax,
                knockback: data.attack?.knockback,
                level: data.level,
                rank: data.rank,
                str: data.str,
                dex: data.dex,
                con: data.con,
                int: data.int,
                wis: data.wis,
                luck: data.luck,
                skills: data.skills || [],
                description: data.description || ''
            };
        }
        return enemies;
    },

    /** 解析技能效果公式 */
    parseSkillFormula(formulaStr, level) {
        try {
            const fn = new Function('level', `return ${formulaStr};`);
            return fn(level);
        } catch (e) {
            console.error('Formula parse error:', formulaStr, e);
            return 0;
        }
    },

    /** 从 JSON 构建技能对象（兼容原有 Player.skills 结构） */
    buildSkillFromJSON(skillId, skillData) {
        const effectFormula = skillData.effectFormula || {};
        const expFormula = skillData.expFormula || '100 + (level - 1) * 100';

        return {
            id: skillId,
            name: skillData.name,
            icon: skillData.icon,
            iconImage: skillData.iconImage,
            description: skillData.description,
            level: 1,
            maxLevel: skillData.maxLevel,
            exp: 0,
            maxExp: this.parseSkillFormula(expFormula, 1),
            tags: skillData.tags || [],
            getEffect(level) {
                const result = {};
                for (const [key, formula] of Object.entries(effectFormula)) {
                    result[key] = DataLoader.parseSkillFormula(formula, level);
                }
                return result;
            },
            getExpForNext(level) {
                return DataLoader.parseSkillFormula(expFormula, level);
            }
        };
    }
};

export { DataLoader };
