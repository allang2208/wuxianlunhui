// 圣城终誓门的庇护域是玩家 ShieldSystem 提供、全体友方承伤入口消费的瞬时服务。
// 这里只保存当前提供者，避免 DamageableEntity / Companion 反向依赖玩家组件。
let activeWardProvider = null;

export function registerLegendaryShieldWard(provider) {
    activeWardProvider = provider || null;
}

export function unregisterLegendaryShieldWard(provider) {
    if (!provider || activeWardProvider === provider) activeWardProvider = null;
}

export function applyLegendaryShieldWard(
    target,
    damage,
    source,
    isMelee = false,
    hitContext = null
) {
    const safeDamage = Math.max(0, Number(damage) || 0);
    if (!(safeDamage > 0) || !activeWardProvider?.applyOathWardDamage) {
        return { damage: safeDamage, prevented: 0, triggered: false };
    }
    return activeWardProvider.applyOathWardDamage(
        target,
        safeDamage,
        source,
        isMelee,
        hitContext
    );
}
