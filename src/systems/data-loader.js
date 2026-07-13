
import enemyConfigData from '../../data/enemy-config.json';
import aiConfigData from '../../data/ai-config.json';
import { GAME_CONFIG as gameConfigData } from '../config/game-config.js';
import { COMBAT_FORMULAS as combatFormulasData } from '../config/combat-formulas.js';
import { COMBAT_CONFIG as combatConfigData } from '../config/combat-config.js';

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
                transform: data.transform,
                equipShield: data.equipShield,
                aiPhases: aiConfigData[id]?.phases,
                description: data.description || ''
            };
        }
        return enemies;
    },

    /** 解析技能效果公式（安全数学表达式求值，不使用 new Function） */
    parseSkillFormula(formulaStr, level) {
        if (typeof formulaStr === 'number' || typeof formulaStr === 'boolean') return formulaStr;
        if (typeof formulaStr !== 'string' || !formulaStr.trim()) return 0;
        const lvl = Number(level) || 0;
        // 白名单过滤：只允许数字、运算符、括号、空白、level、Math函数、常量
        // 使用 * 允许纯 level / Math.PI 等公式剥离后为空字符串的情况
        const allowedPattern = /^[0-9+\-*/().,\s]*$/i;
        const mathPattern = /\b(Math\.[a-zA-Z]+|Math\.[A-Z]+|level|PI|E)\b/g;
        const stripped = formulaStr.replace(mathPattern, '');
        if (!allowedPattern.test(stripped)) {
            console.error('Formula contains disallowed characters:', formulaStr);
            return 0;
        }
        try {
            const result = this._evaluateMathExpression(formulaStr, lvl);
            return Number.isFinite(result) ? result : 0;
        } catch (e) {
            console.error('Formula parse error:', formulaStr, e);
            return 0;
        }
    },

    /** 安全求值数学表达式 */
    _evaluateMathExpression(expr, level) {
        // 1. 替换 Math 常量和 level 为具体数值
        let prepared = expr
            .replace(/\bMath\.PI\b/g, String(Math.PI))
            .replace(/\bMath\.E\b/g, String(Math.E))
            .replace(/\blevel\b/g, `(${level})`);

        // 2. 替换 Math 函数调用为可执行的函数引用（通过映射表）
        const mathFnNames = [];
        prepared = prepared.replace(/\bMath\.([a-zA-Z]+)\b/g, (match, name) => {
            if (typeof Math[name] !== 'function') return match;
            const idx = mathFnNames.length;
            mathFnNames.push({ name, fn: Math[name] });
            return `__MATH_FN_${idx}__`;
        });

        // 3. 使用 JSON 解析数字字面量并递归求值
        const tokens = this._tokenizeExpression(prepared);
        const { value } = this._parseExpression(tokens, mathFnNames);
        return value;
    },

    _tokenizeExpression(expr) {
        const tokens = [];
        const regex = /(__MATH_FN_\d+__|\d+\.?\d*|[+\-*/()])/g;
        let m;
        while ((m = regex.exec(expr)) !== null) {
            tokens.push(m[1]);
        }
        return tokens;
    },

    _parseExpression(tokens, mathFnNames) {
        // 使用调度场算法将中缀转后缀再求值
        const output = [];
        const ops = [];
        const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };

        for (const token of tokens) {
            if (token.match(/^\d+\.?\d*$/)) {
                output.push(parseFloat(token));
            } else if (token.startsWith('__MATH_FN_')) {
                ops.push(token);
            } else if (token === '(') {
                ops.push(token);
            } else if (token === ')') {
                while (ops.length && ops[ops.length - 1] !== '(') {
                    output.push(ops.pop());
                }
                ops.pop(); // remove '('
                if (ops.length && ops[ops.length - 1].startsWith('__MATH_FN_')) {
                    output.push(ops.pop());
                }
            } else if ('+-*/'.includes(token)) {
                while (ops.length && ops[ops.length - 1] !== '(' &&
                       precedence[ops[ops.length - 1]] >= precedence[token]) {
                    output.push(ops.pop());
                }
                ops.push(token);
            }
        }
        while (ops.length) output.push(ops.pop());

        // 求值后缀表达式
        const stack = [];
        for (const item of output) {
            if (typeof item === 'number') {
                stack.push(item);
            } else if (typeof item === 'string' && item.startsWith('__MATH_FN_')) {
                const idx = parseInt(item.match(/\d+/)[0], 10);
                const a = stack.pop();
                const result = mathFnNames[idx].fn(a);
                stack.push(result);
            } else if ('+-*/'.includes(item)) {
                const b = stack.pop();
                const a = stack.pop();
                if (item === '/' && b === 0) { stack.push(0); continue; }
                stack.push(item === '+' ? a + b : item === '-' ? a - b : item === '*' ? a * b : a / b);
            }
        }
        return { value: stack.length ? stack[0] : 0 };
    },

    /**
     * 解析技能经验公式，自动应用全局技能经验倍率
     * @param {string} formula - 经验公式字符串
     * @param {number} level - 技能等级
     * @returns {number} 升级所需经验
     */
    parseSkillExpFormula(formula, level) {
        const base = this.parseSkillFormula(formula, level);
        const multiplier = combatFormulasData.skill?.expMultiplier ?? 1;
        return Math.floor(base * multiplier);
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
            maxExp: this.parseSkillExpFormula(expFormula, 1),
            tags: skillData.tags || [],
            getEffect(level) {
                const result = {};
                for (const [key, formula] of Object.entries(effectFormula)) {
                    result[key] = DataLoader.parseSkillFormula(formula, level);
                }
                return result;
            },
            getExpForNext(level) {
                return DataLoader.parseSkillExpFormula(expFormula, level);
            }
        };
    }
};

const ENEMY_DATA = DataLoader._convertEnemyConfig(enemyConfigData);

export { DataLoader, ENEMY_DATA };
