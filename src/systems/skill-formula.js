// ============================================================
// 技能公式/构建纯函数模块（2026-08-12）
// 从 data-loader 提取，玩家与侍从共用同一来源（DataLoader 委托本模块，
// skill-system 直接引用）——避免"玩家/侍从两份实现漂移"。
// 纯 config 层：只 import JSON，node 单测可直接导入（无 Phaser 依赖）。
// ============================================================

import combatFormulasData from '../../data/combat-formulas.json';

/** 解析技能效果公式（安全数学表达式求值，白名单过滤，不使用 new Function） */
export function parseSkillFormula(formulaStr, level) {
    if (typeof formulaStr === 'number' || typeof formulaStr === 'boolean') return formulaStr;
    if (typeof formulaStr !== 'string' || !formulaStr.trim()) return 0;
    const lvl = Number(level) || 0;
    // 白名单过滤：只允许数字、运算符、括号、空白、level、Math函数、常量
    // 逗号不允许：Math.max(a,b) 等多参调用无法正确求值，一律白名单拦截
    const allowedPattern = /^[0-9+\-*/().\s]*$/i;
    const mathPattern = /\b(Math\.[a-zA-Z]+|Math\.[A-Z]+|level|PI|E)\b/g;
    const stripped = formulaStr.replace(mathPattern, '');
    if (!allowedPattern.test(stripped)) {
        console.error('Formula contains disallowed characters:', formulaStr);
        return 0;
    }
    try {
        const result = _evaluateMathExpression(formulaStr, lvl);
        return Number.isFinite(result) ? result : 0;
    } catch (e) {
        console.error('Formula parse error:', formulaStr, e);
        return 0;
    }
}

function _evaluateMathExpression(expr, level) {
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
    const tokens = _tokenizeExpression(prepared);
    const { value } = _parseExpression(tokens, mathFnNames);
    return value;
}

function _tokenizeExpression(expr) {
    const tokens = [];
    // 数字支持前导小数点（.5）与整数/小数（0.5 / 5.）
    const regex = /(__MATH_FN_\d+__|(?:\d+\.?\d*|\.\d+)|[+\-*/()])/g;
    let m;
    while ((m = regex.exec(expr)) !== null) {
        tokens.push(m[1]);
    }
    return tokens;
}

function _parseExpression(tokens, mathFnNames) {
    // 调度场算法：中缀转后缀再求值
    const output = [];
    const ops = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, 'neg': 3 };
    let prevToken = null;
    for (const token of tokens) {
        if (token.match(/^(?:\d+\.?\d*|\.\d+)$/)) {
            output.push(parseFloat(token));
        } else if (token.startsWith('__MATH_FN_')) {
            ops.push(token);
        } else if (token === '(') {
            ops.push(token);
        } else if (token === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
            ops.pop();
            if (ops.length && ops[ops.length - 1].startsWith('__MATH_FN_')) output.push(ops.pop());
        } else if (token === '-' || token === '+') {
            const isUnary = !prevToken || prevToken === '(' || '+-*/'.includes(prevToken);
            if (isUnary) {
                if (token === '-') ops.push('neg');
            } else {
                while (ops.length && ops[ops.length - 1] !== '(' && precedence[ops[ops.length - 1]] >= precedence[token]) output.push(ops.pop());
                ops.push(token);
            }
        } else if ('*/'.includes(token)) {
            while (ops.length && ops[ops.length - 1] !== '(' && precedence[ops[ops.length - 1]] >= precedence[token]) output.push(ops.pop());
            ops.push(token);
        }
        if (token !== ')') prevToken = token;
    }
    while (ops.length) output.push(ops.pop());
    const stack = [];
    for (const item of output) {
        if (typeof item === 'number') stack.push(item);
        else if (item === 'neg') { const a = stack.pop() || 0; stack.push(-a); }
        else if (typeof item === 'string' && item.startsWith('__MATH_FN_')) {
            const idx = parseInt(item.match(/\d+/)[0], 10);
            const a = stack.pop();
            stack.push(mathFnNames[idx].fn(a));
        } else if ('+-*/'.includes(item)) {
            const b = stack.pop();
            const a = stack.pop();
            if (item === '/' && b === 0) { stack.push(0); continue; }
            stack.push(item === '+' ? a + b : item === '-' ? a - b : item === '*' ? a * b : a / b);
        }
    }
    return { value: stack.length ? stack[0] : 0 };
}

/** 解析技能经验公式，自动应用全局技能经验倍率 */
export function parseSkillExpFormula(formula, level) {
    const base = parseSkillFormula(formula, level);
    const multiplier = combatFormulasData.skill?.expMultiplier ?? 1;
    return Math.floor(base * multiplier);
}

/** 从 JSON 构建技能对象（与玩家 DataLoader.buildSkillFromJSON 同构） */
export function buildSkillFromJSON(skillId, skillData) {
    const effectFormula = skillData.effectFormula || {};
    const expFormula = skillData.expFormula || '100 + (level - 1) * 100';
    return {
        id: skillId,
        name: skillData.name,
        icon: skillData.icon,
        iconImage: skillData.iconImage,
        selfCast: skillData.selfCast,
        description: skillData.description,
        level: 1,
        maxLevel: skillData.maxLevel,
        exp: 0,
        maxExp: parseSkillExpFormula(expFormula, 1),
        expRewards: skillData.expRewards || {},
        tags: skillData.tags || [],
        getEffect(level) {
            if (this._effectCache && this._effectCache.level === level) return this._effectCache.effect;
            const result = {};
            for (const [key, formula] of Object.entries(effectFormula)) {
                result[key] = parseSkillFormula(formula, level);
            }
            this._effectCache = { level, effect: result };
            return result;
        },
        getExpForNext(level) {
            return parseSkillExpFormula(expFormula, level);
        },
    };
}
