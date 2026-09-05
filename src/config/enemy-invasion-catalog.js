import enemies from '../../data/enemy-config.json';
import campaign from '../../data/invasion-campaign.json';
import { getEnemyFamilies } from './enemy-family.js';
import { deriveEnemyBaseStats } from './enemy-base-stats.js';
import { COMBAT_CONFIG } from './combat-config.js';

const MECHANICS = Object.freeze({ melee: 1, ranged: 1.25, poison: 1.3, shield: 1.2,
    flying: 1.2, control: 1.5, transform: 2, summon: 1.4 });
const INVASION_ROLES = Object.freeze(['normal', 'elite', 'leader']);
const seriesById = new Map(campaign.families.map((series) => [series.id, series]));
let cachedCatalog = null;

function declaration(type, visited = new Set()) {
    const own = enemies[type]?.invasion;
    if (!own || visited.has(type)) return null;
    visited.add(type);
    if (!own.inherits) return { ...own };
    const parent = declaration(own.inherits, visited);
    return parent ? { ...parent, ...own } : null;
}

export function classifyInvasionEnemy(type) {
    const config = enemies[type] || {}, meta = declaration(type);
    if (config.invasion?.inherits && !meta) return { series: null, meta: null, basis: '显式继承', reason: '谱系继承失效或存在循环' };
    if (meta?.series) return { series: seriesById.get(meta.series) || null, meta,
        basis: meta.inherits ? `显式继承 ${meta.inherits}` : '明确系列声明',
        reason: seriesById.has(meta.series) ? null : `未登记系列：${meta.series}` };
    const tags = new Set([...getEnemyFamilies(config), ...(meta?.tags || []), meta?.lineage].filter(Boolean));
    const matches = campaign.families.filter((series) => series.tags?.some((tag) => tags.has(tag)));
    return { series: matches.length === 1 ? matches[0] : null, meta, basis: '具体标签规则',
        reason: matches.length > 1 ? '系列标签冲突，待确认' : matches.length ? null : '缺少明确系列/谱系标签' };
}

export function getInvasionDeclaration(type) { return declaration(type); }

export function suggestInvasionSeries(type) {
    const config = enemies[type] || {};
    // Numerical comparisons and reference art are not ancestry evidence.
    const description = String(config.description || '').split(/[。；;\n]/)
        .filter((sentence) => !/基准|参考|数值|接近|强于|弱于|高于|低于|同级|体型与/.test(sentence)).join('。');
    const tags = new Set([...(config.invasion?.tags || []), config.invasion?.lineage].filter(Boolean));
    return campaign.families.map((series) => {
        const explicit = series.tags.some((tag) => tags.has(tag));
        const named = series.keywords.some((word) => String(config.name || '').includes(word));
        const described = series.keywords.some((word) => description.includes(word));
        // Name and description may have one author; cap their combined evidence.
        const score = (explicit ? 5 : 0) + (named && described ? 4 : named || described ? 3 : 0);
        return { seriesId: series.id, name: series.name, score, suggestionOnly: true,
            evidence: [explicit && '具体谱系标签', named && '名称', described && '非数值关系描述'].filter(Boolean) };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.seriesId.localeCompare(b.seriesId)).slice(0, 3);
}

export function invasionDependencyTypes(types) {
    const result = new Set(), visiting = new Set();
    const visit = (type) => {
        if (visiting.has(type)) throw new Error(`入侵依赖循环：${type}`);
        if (result.has(type)) return;
        const config = enemies[type];
        if (!config) throw new Error(`入侵依赖未登记：${type}`);
        visiting.add(type);
        for (const child of new Set([...(declaration(type)?.summons || []), ...(config.visualDependencies || [])])) visit(child);
        visiting.delete(type); result.add(type);
    };
    types.forEach(visit);
    return [...result].sort();
}

export function invasionThreat(type, hpMul = 1, atkMul = 1) {
    const source = enemies[type], meta = declaration(type);
    if (!source || !MECHANICS[meta?.mechanics]) return Infinity;
    const stats = deriveEnemyBaseStats({ ...COMBAT_CONFIG.enemyDefaults?.stats, ...source }, source);
    const hp = stats.maxHp * hpMul;
    const damage = Math.max(stats.atk, stats.matk) * atkMul;
    const dps = damage * 1000 / Math.max(500, source.attack?.cooldown || 1500);
    const rangeFactor = 1 + Math.min(0.4, Math.max(0, (source.attackRange || 0) - 150) / 2000);
    const speedFactor = 1 + Math.min(0.25, Math.max(0, (source.speed || 0) - 100) / 600);
    return Math.max(1, Math.sqrt(Math.max(1, hp) * Math.max(1, dps)) / 40)
        * MECHANICS[meta.mechanics] * Math.max(0.1, Number(meta.threatScale) || 1) * rangeFactor * speedFactor;
}

export function getEnemyInvasionCatalog({ hasFactory, refresh = false } = {}) {
    if (!cachedCatalog || refresh) {
        cachedCatalog = Object.keys(enemies).sort().map((type) => {
            const source = enemies[type], classification = classifyInvasionEnemy(type);
            const { series, meta } = classification;
            const inferredRole = source.rank === 'normal' ? 'normal' : source.rank === 'elite' ? 'elite'
                : ['lord', 'boss'].includes(source.rank) ? 'leader' : null;
            const declaredRole = typeof meta?.role === 'string' ? meta.role : null;
            const role = declaredRole == null ? inferredRole
                : INVASION_ROLES.includes(declaredRole) ? declaredRole : null;
            const reasons = [];
            if (classification.reason) reasons.push(classification.reason);
            if (declaredRole && !INVASION_ROLES.includes(declaredRole)) reasons.push(`未知入侵编队职责：${declaredRole}`);
            if (declaredRole === 'leader' && !['elite', 'lord', 'boss'].includes(source.rank)) {
                reasons.push('只有精英、领主或Boss可以显式担任入侵领队');
            } else if (declaredRole === 'normal' && source.rank !== 'normal') {
                reasons.push('普通兵职责与怪物阶级不匹配');
            } else if (declaredRole === 'elite' && source.rank !== 'elite') {
                reasons.push('精锐职责与怪物阶级不匹配');
            }
            if (source.noPool || meta?.mode === 'dependency') reasons.push('仅设施/伴生依赖，不直接抽取');
            else if (meta?.mode === 'event') reasons.push('专属事件');
            else if (source.immovable || !(source.speed > 0) || meta?.mode === 'defend') reasons.push('固定守点或专属首领，未开放主动攻城');
            else if (meta?.enabled !== true || meta?.mode !== 'assault') reasons.push('未声明允许主动入侵');
            if (!source.entityClass) reasons.push('缺少统一实体登记');
            if (!meta?.assaultReady && meta?.mode === 'assault') reasons.push('缺少攻城行为适配声明');
            if (!MECHANICS[meta?.mechanics]) reasons.push('机制成本未登记');
            if (!role) reasons.push('不属于主编队阶级');
            let dependencies = [];
            try { dependencies = invasionDependencyTypes([type]); }
            catch (error) { reasons.push(error.message); }
            return { type, name: source.name || type, rank: source.rank, role, seriesId: series?.id || null,
                seriesName: series?.name || '待分类', mode: meta?.mode || 'pending', basis: classification.basis,
                minDay: Math.max(series?.unlockDay || 1, Number(meta?.minDay) || 1),
                weight: Math.max(0, Number(meta?.weight ?? 1)), dependencies,
                threat: invasionThreat(type), reasons,
                suggestions: series ? [] : suggestInvasionSeries(type) };
        });
    }
    const entries = cachedCatalog.map((entry) => ({ ...entry, reasons: [...entry.reasons] }));
    for (const entry of entries) {
        if (hasFactory && entry.dependencies.some((type) => !hasFactory(type))) entry.reasons.push('实体或依赖构造器未接入');
        entry.eligible = !entry.reasons.length && entry.weight > 0;
    }
    const families = campaign.families.map((series) => {
        const members = entries.filter((entry) => entry.seriesId === series.id);
        const roles = Object.fromEntries(['normal', 'elite', 'leader'].map((role) =>
            [role, members.filter((entry) => entry.eligible && entry.role === role)]));
        const missing = ['normal', 'leader'].filter((role) => !roles[role].length);
        if (!roles.elite.length && !(series.allowPromotedElite && roles.normal.length)) missing.push('elite');
        for (const member of members) member.formationStatus = !member.eligible ? member.reasons.join('；')
            : missing.length ? `已归池，缺少${missing.map((role) => ({ normal: '普通兵', elite: '精锐', leader: '首领' })[role]).join('/')}`
                : '编队候选，集结时检查进度/资源/威胁预算';
        return { ...series, roles, missing, canForm: !missing.length };
    });
    return { version: campaign.version, entries, families };
}
