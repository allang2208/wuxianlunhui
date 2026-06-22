// data-loader.js — 异步加载 JSON 配置数据

const DataLoader = {
    _cache: {},

    async loadJSON(path) {
        if (this._cache[path]) return this._cache[path];
        try {
            const response = await fetch(path);
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
        const [equipment, skills, enemies] = await Promise.all([
            this.loadJSON('/data/equipment.json'),
            this.loadJSON('/data/skills.json'),
            this.loadJSON('/data/enemies.json')
        ]);
        return {
            equipment: equipment ? equipment.equipment : null,
            skills: skills ? skills.skills : null,
            enemies: enemies ? enemies.enemies : null
        };
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
        const expFormula = skillData.expFormula || '10 + (level - 1) * 10';

        return {
            id: skillId,
            name: skillData.name,
            icon: skillData.icon,
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
