/**
 * 位面祭坛献祭运行时状态。
 * 所有场景共用同一份30分钟限时效果；同一稀有度只保留最后献祭的一件。
 */
import { isDungeonKeyItem } from '../config/dungeon-key-config.js';

export const WORLD122_TRIBUTE_DURATION_MS = 30 * 60 * 1000;

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
    return prune(now);
}

/** 兼容旧调用；切换场景不再冻结或停用祭品。 */
export function deactivateWorld122Tributes(now = Date.now()) {
    return prune(now);
}

/** 主循环调用：到期时返回 true，供玩家面板与特效状态同步。 */
export function updateWorld122Tributes(now = Date.now()) {
    return prune(now);
}

export function getActiveWorld122TributeItems() {
    prune();
    return entries.map((entry) => entry.item);
}

export function getWorld122TributeEntries() {
    prune();
    return entries.map((entry) => ({ ...entry, item: { ...entry.item } }));
}

export function sacrificeWorld122Tribute(item, now = Date.now()) {
    if (!item || item.category !== 'tribute') return { ok: false, reason: '只能献祭祭品' };
    if (isDungeonKeyItem(item)) return { ok: false, reason: '地牢钥匙不能作为祭品献祭' };
    prune(now);
    const key = item._id || item.name;
    const rarity = item.rarity || 'common';
    const existing = entries.find((entry) => entry.rarity === rarity);
    const record = {
        key,
        rarity,
        item: { ...item, stack: 1 },
        expiresAt: now + WORLD122_TRIBUTE_DURATION_MS,
    };
    if (existing) {
        const replaced = existing.key !== key;
        Object.assign(existing, record);
        refreshFriendlyStats(); // 祭品集合变化：刷新全体友军最大生命
        return { ok: true, refreshed: !replaced, replaced, entry: existing };
    }
    entries.push(record);
    refreshFriendlyStats(); // 祭品集合变化：刷新全体友军最大生命
    return { ok: true, refreshed: false, replaced: false, entry: record };
}

export function serializeWorld122Tributes(now = Date.now()) {
    prune(now);
    return entries.map((entry) => ({
        key: entry.key,
        rarity: entry.rarity,
        item: entry.item,
        remainingMs: remainingOf(entry, now),
    }));
}

export function restoreWorld122Tributes(data, now = Date.now()) {
    const source = Array.isArray(data) ? data : [];
    const restoredByRarity = new Map();
    source
        .filter((entry) => entry && entry.item && entry.item.category === 'tribute')
        .filter((entry) => !isDungeonKeyItem(entry.item))
        .forEach((entry) => {
            const remainingMs = Number.isFinite(entry.remainingMs)
                ? Math.max(0, entry.remainingMs)
                : Math.max(0, (Number(entry.expiresAt) || 0) - now);
            if (remainingMs <= 0) return;
            const rarity = entry.rarity || entry.item.rarity || 'common';
            // 旧档可能同稀有度有多件；按保存顺序让最后一件覆盖前一件。
            restoredByRarity.set(rarity, {
                key: entry.key || entry.item._id || entry.item.name,
                rarity,
                item: { ...entry.item, stack: 1 },
                expiresAt: now + remainingMs,
            });
        });
    entries = [...restoredByRarity.values()];
    const pruned = entries.length !== source.length;
    // 恢复后的有效集合一次性刷新，避免先按过期记录计算再二次回退。
    refreshFriendlyStats();
    return pruned;
}

export function clearWorld122Tributes() {
    const changed = entries.length > 0;
    entries = [];
    if (changed) refreshFriendlyStats();
}
