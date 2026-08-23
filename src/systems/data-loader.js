
import enemyConfigData from '../../data/enemy-config.json';
import aiConfigData from '../../data/ai-config.json';
import { GAME_CONFIG as gameConfigData } from '../config/game-config.js';
import { COMBAT_FORMULAS as combatFormulasData } from '../config/combat-formulas.js';
import { COMBAT_CONFIG as combatConfigData } from '../config/combat-config.js';
import { getEnemyFamilies } from '../config/enemy-family.js';
import { parseSkillFormula, parseSkillExpFormula, buildSkillFromJSON } from './skill-formula.js';

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
            enemies: this._convertEnemyConfig(enemyConfigData),
            gameConfig: this._cloneObject(gameConfigData),
            combatFormulas: this._cloneObject(combatFormulasData),
            combatConfig: this._cloneObject(combatConfigData)
        };
    },

    /** 获取游戏全局配置（已加载的静态副本） */
    getGameConfig() {
        return this._cloneObject(gameConfigData);
    },

    /** 获取战斗公式配置（已加载的静态副本） */
    getCombatFormulas() {
        return this._cloneObject(combatFormulasData);
    },

    /** 获取战斗参数配置（已加载的静态副本） */
    getCombatConfig() {
        return this._cloneObject(combatConfigData);
    },

    /** 浅克隆对象，防止外部修改影响原始配置 */
    _cloneObject(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        return JSON.parse(JSON.stringify(obj));
    },

    /** 将 enemy-config.json 转换为图鉴所需的 ENEMY_DATA 格式 */
    _convertEnemyConfig(config) {
        const enemies = {};
        const rankMap = { normal: '普通', elite: '精英', boss: '首领' };
        for (const [id, data] of Object.entries(config)) {
            const families = getEnemyFamilies(data);
            enemies[id] = {
                id,
                name: data.name,
                type: data.type || rankMap[data.rank] || '普通',
                category: data.category || 'monster',
                family: data.family ?? families[0] ?? null,
                families,
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
                transform: data.transform,
                equipShield: data.equipShield,
                aiPhases: aiConfigData[id]?.phases,
                idleTexture: data.textures?.idle || null,
                idleFrameWidth: data.textures?.idleFrameWidth || null,
                idleFrameHeight: data.textures?.idleFrameHeight || null,
                idleFrameCount: data.textures?.idleFrameCount || null,
                idleSheetColumns: data.textures?.idleSheetColumns || null,
                textures: data.textures || null,
                render: data.render || null,
                expValue: data.expValue ?? null,
                def: data.def ?? null,
                atk: data.atk ?? null,
                matk: data.matk ?? null,
                mdef: data.mdef ?? null,
                crit: data.crit ?? null,
                critRes: data.critRes ?? null,
                aiInterval: data.aiInterval ?? null,
                attackDistance: data.attackDistance ?? null,
                rangedDamageReduction: data.rangedDamageReduction ?? null,
                attack: data.attack || null,
                ai: data.ai || null,
                description: data.description || ''
            };
        }
        return enemies;
    },

    /** 解析技能效果公式（委托 skill-formula 纯函数模块，与侍从共用同一来源） */
    parseSkillFormula(formulaStr, level) {
        return parseSkillFormula(formulaStr, level);
    },

    /** 解析技能经验公式（委托 skill-formula；自动应用全局技能经验倍率） */
    parseSkillExpFormula(formula, level) {
        return parseSkillExpFormula(formula, level);
    },

    /** 从 JSON 构建技能对象（委托 skill-formula；与侍从共用同一构建/公式/效果缓存） */
    buildSkillFromJSON(skillId, skillData) {
        return buildSkillFromJSON(skillId, skillData);
    },
};

const ENEMY_DATA = DataLoader._convertEnemyConfig(enemyConfigData);

export { DataLoader, ENEMY_DATA };
