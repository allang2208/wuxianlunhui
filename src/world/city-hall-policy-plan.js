import catalog from '../../data/city-hall-policies.json';

// Pure planning data. No research points, currencies or production modifiers are consumed here.
export const CITY_POLICIES = catalog;
export const POLICY_BY_ID = new Map(catalog.nodes.map((node) => [node.id, node]));
const bounded = (value, fallback, max) => Number.isFinite(Number(value))
    ? Math.max(1, Math.min(max, Math.floor(Number(value)))) : fallback;
export const policyCost = (ids) => ids.reduce((sum, id) => sum + (POLICY_BY_ID.get(id)?.cost || 0), 0);

export function policyPrerequisiteOrder(id, result = [], seen = new Set()) {
    const node = POLICY_BY_ID.get(id);
    if (!node || seen.has(id)) return result;
    seen.add(id);
    node.requires.forEach((parent) => policyPrerequisiteOrder(parent, result, seen));
    result.push(id);
    return result;
}

export function normalizeCityHallPolicyPlan(raw = {}, defaultEra = 1) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const budget = bounded(source.budget, catalog.defaultBudget, 99);
    const era = bounded(source.era, defaultEra, 3);
    const requested = new Set(Array.isArray(source.allocated) ? source.allocated : []);
    const allocated = [];
    // Catalog order is topological; never restore orphan nodes or overspent simulations.
    for (const node of catalog.nodes) {
        if (requested.has(node.id) && node.era <= era
            && node.requires.every((id) => allocated.includes(id))
            && policyCost(allocated) + node.cost <= budget) allocated.push(node.id);
    }
    const queue = [];
    for (const id of Array.isArray(source.queue) ? source.queue : []) {
        if (!POLICY_BY_ID.has(id) || allocated.includes(id) || queue.includes(id)) continue;
        policyPrerequisiteOrder(id).forEach((entry) => {
            if (!allocated.includes(entry) && !queue.includes(entry)) queue.push(entry);
        });
    }
    return { version: catalog.version, budget, era, allocated, queue };
}

export function policyBlockReason(plan, id) {
    const node = POLICY_BY_ID.get(id);
    if (!node) return '政策不存在';
    if (plan.allocated.includes(id)) return '已模拟采纳';
    const missing = node.requires.filter((parent) => !plan.allocated.includes(parent));
    if (missing.length) return `前置未满足：${missing.map((parent) => POLICY_BY_ID.get(parent).name).join('、')}`;
    if (node.era > plan.era) return `需要预览时代 LV${node.era}`;
    if (policyCost(plan.allocated) + node.cost > plan.budget) return '模拟政务点不足';
    return '';
}

export function allocatePolicy(plan, id) {
    const reason = policyBlockReason(plan, id);
    if (reason) return { ok: false, reason };
    plan.allocated.push(id);
    plan.queue = plan.queue.filter((entry) => entry !== id);
    return { ok: true };
}

export function refundPolicy(plan, id) {
    const removed = new Set([id]);
    for (const node of catalog.nodes) {
        if (node.requires.some((parent) => removed.has(parent))) removed.add(node.id);
    }
    const before = plan.allocated.length;
    plan.allocated = plan.allocated.filter((entry) => !removed.has(entry));
    // Keep route targets; repair the queue with any prerequisites just refunded.
    plan.queue = normalizeCityHallPolicyPlan(plan).queue;
    return before - plan.allocated.length;
}

export function planPolicyTarget(plan, id) {
    policyPrerequisiteOrder(id).forEach((entry) => {
        if (!plan.allocated.includes(entry) && !plan.queue.includes(entry)) plan.queue.push(entry);
    });
}

export function movePolicyInQueue(plan, id, delta) {
    const index = plan.queue.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= plan.queue.length) return false;
    const reordered = [...plan.queue];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    const seen = new Set(plan.allocated);
    for (const entry of reordered) {
        if (!POLICY_BY_ID.get(entry).requires.every((parent) => seen.has(parent))) return false;
        seen.add(entry);
    }
    plan.queue = reordered;
    return true;
}

export function removePolicyFromQueue(plan, id) {
    const removed = new Set([id]);
    for (const node of catalog.nodes) {
        if (node.requires.some((parent) => removed.has(parent))) removed.add(node.id);
    }
    plan.queue = plan.queue.filter((entry) => !removed.has(entry));
}
