function appendFamily(out, seen, value) {
    const family = String(value ?? '').trim();
    if (!family || seen.has(family)) return;
    seen.add(family);
    out.push(family);
}

/**
 * 敌人分类统一入口：兼容旧的单值 family，并合并新的 families 多标签。
 * 实体优先读取自身 config；配置对象、图鉴数据也可直接传入。
 */
export function getEnemyFamilies(target) {
    const out = [];
    const seen = new Set();
    const sources = [];
    if (target?.config && typeof target.config === 'object') sources.push(target.config);
    if (target && typeof target === 'object') sources.push(target);
    for (const source of sources) {
        appendFamily(out, seen, source.family);
        if (Array.isArray(source.families)) {
            for (const family of source.families) appendFamily(out, seen, family);
        }
    }
    return out;
}

export function hasEnemyFamily(target, family) {
    const expected = String(family ?? '').trim();
    return !!expected && getEnemyFamilies(target).includes(expected);
}
