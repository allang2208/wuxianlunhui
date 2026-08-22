/**
 * 世界模式位面祭坛献祭运行时状态。
 * 祭品 Buff 在 scene8~scene11 的世界模式间通用；进入主神空间或地牢模式后暂停生效，
 * 离开世界模式时冻结 remainingMs，重新进入后再恢复倒计时。
 */
export const WORLD122_TRIBUTE_DURATION_MS = 30 * 60 * 1000;

let active = false;
let entries = [];
let refreshFriendlyStats = () => {};

/** 由 tribute-effects 注册刷新入口，保持状态仓库不反向依赖效果聚合器。 */
export function setWorld122TributeRefreshHandler(handler) {
    refreshFriendlyStats = typeof handler === 'function' ? handler : () => {};
}

function remainingOf(entry, now = Date.now()) {
    if (Number.isFinite(entry?.expiresAt)) return Math.max(0, entry.expiresAt - now);
    return Math.max(0, Number(entry?.remainingMs) || 0);
}

function prune(now = Date.now(), { refresh = true } = {}) {
    const before = entries.length;
    entries = entries.filter((entry) => entry && entry.item && remainingOf(entry, now) > 0);
    const changed = entries.length !== before;
    if (changed && refresh) refreshFriendlyStats();
    return changed;
}

export function activateWorld122Tributes(now = Date.now()) {
    const wasActive = active;
    if (!wasActive) {
        prune(now, { refresh: false });
        for (const entry of entries) {
            entry.expiresAt = now + remainingOf(entry, now);
            delete entry.remainingMs;
        }
    }
    active = true;
    const changed = prune(now);
    if (!wasActive && !changed) refreshFriendlyStats();
    return changed;
}

export function deactivateWorld122Tributes(now = Date.now()) {
    const wasActive = active;
    if (wasActive) {
        prune(now, { refresh: false });
        for (const entry of entries) {
            entry.remainingMs = remainingOf(entry, now);
            entry.expiresAt = null;
        }
    }
    active = false;
    if (wasActive) refreshFriendlyStats();
}

export function getActiveWorld122TributeItems() {
    prune();
    return active ? entries.map((entry) => entry.item) : [];
}

export function getWorld122TributeEntries() {
    prune();
    return entries.map((entry) => ({ ...entry, item: { ...entry.item } }));
}

export function sacrificeWorld122Tribute(item, now = Date.now()) {
    if (!item || item.category !== 'tribute') return { ok: false, reason: '只能献祭祭品' };
    if (!active) return { ok: false, reason: '只能在世界模式的位面祭坛进行献祭' };
    prune(now);
    const key = item._id || item.name;
    const existing = entries.find((entry) => entry.key === key);
    const record = {
        key,
        item: { ...item, stack: 1 },
        expiresAt: now + WORLD122_TRIBUTE_DURATION_MS,
    };
    if (existing) {
        Object.assign(existing, record);
        refreshFriendlyStats(); // 祭品集合变化：刷新全体友军最大生命
        return { ok: true, refreshed: true, entry: existing };
    }
    if (entries.length >= 10) return { ok: false, reason: '位面祭坛最多容纳10种生效祭品' };
    entries.push(record);
    refreshFriendlyStats(); // 祭品集合变化：刷新全体友军最大生命
    return { ok: true, refreshed: false, entry: record };
}

export function serializeWorld122Tributes(now = Date.now()) {
    prune(now);
    return entries.map((entry) => ({
        key: entry.key,
        item: entry.item,
        remainingMs: remainingOf(entry, now),
    }));
}

export function restoreWorld122Tributes(data, now = Date.now()) {
    const source = Array.isArray(data) ? data : [];
    const restored = source
        .filter((entry) => entry && entry.item && entry.item.category === 'tribute')
        .map((entry) => ({
            key: entry.key || entry.item._id || entry.item.name,
            item: { ...entry.item, stack: 1 },
            // 新档保存剩余时长；旧档 expiresAt 仅在迁移时折算一次。
            remainingMs: Number.isFinite(entry.remainingMs)
                ? Math.max(0, entry.remainingMs)
                : Math.max(0, (Number(entry.expiresAt) || 0) - now),
        }))
        .filter((entry) => entry.remainingMs > 0);
    const pruned = restored.length !== source.length;
    entries = restored;
    if (active) {
        for (const entry of entries) {
            entry.expiresAt = now + entry.remainingMs;
            delete entry.remainingMs;
        }
    }
    // 恢复后的有效集合一次性刷新，避免先按过期记录计算再二次回退。
    refreshFriendlyStats();
    return pruned;
}

export function clearWorld122Tributes() {
    const changed = active || entries.length > 0;
    entries = [];
    active = false;
    if (changed) refreshFriendlyStats();
}
