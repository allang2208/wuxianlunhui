/**
 * 世界-122基地献祭运行时状态。
 * 祭品 Buff 只在 world-122 激活时参与 tribute-effects 聚合；离场暂停生效，
 * 但真实时间仍按 expiresAt 继续流逝，重新进入时若未过期会恢复。
 */
export const WORLD122_TRIBUTE_DURATION_MS = 30 * 60 * 1000;

let active = false;
let entries = [];

function prune(now = Date.now()) {
    const before = entries.length;
    entries = entries.filter((entry) => entry && entry.item && entry.expiresAt > now);
    return entries.length !== before;
}

export function activateWorld122Tributes() {
    active = true;
    return prune();
}

export function deactivateWorld122Tributes() {
    active = false;
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
        return { ok: true, refreshed: true, entry: existing };
    }
    if (entries.length >= 10) return { ok: false, reason: '基地祭品栏最多容纳10种祭品' };
    entries.push(record);
    return { ok: true, refreshed: false, entry: record };
}

export function serializeWorld122Tributes() {
    prune();
    return entries.map((entry) => ({ key: entry.key, item: entry.item, expiresAt: entry.expiresAt }));
}

export function restoreWorld122Tributes(data) {
    entries = Array.isArray(data)
        ? data.filter((entry) => entry && entry.item && entry.item.category === 'tribute'
            && Number.isFinite(entry.expiresAt))
            .map((entry) => ({ key: entry.key || entry.item._id || entry.item.name, item: { ...entry.item, stack: 1 }, expiresAt: entry.expiresAt }))
        : [];
    return prune();
}

export function clearWorld122Tributes() {
    entries = [];
    active = false;
}
