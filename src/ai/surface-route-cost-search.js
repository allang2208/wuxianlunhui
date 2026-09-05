import { pathFinder } from './pathfinder.js';
import { WallSystem } from '../world/wall-system.js';
import { splitCommandTransitPath } from './command-transit-graph.js';

const jobs = new WeakMap();
const lengthOf = route => route.reduce((sum, point, index) => {
    const previous = route[index - 1];
    return previous ? sum + Math.hypot(point.x - previous.x, point.y - previous.y,
        (Number(point.z) || 0) - (Number(previous.z) || 0)) : sum;
}, 0);

/** 分帧组装上/下梯候选；每个下梯点查询同一多源成本场，比较完整组合而非独立贪心。 */
export function costedSurfaceRoute(unit, target, revision, candidates) {
    const offset = WallSystem.getEntityMoveOffset(unit);
    const version = pathFinder.getTopologyVersion();
    const radius = unit.groundRadius || unit.collisionRadius || 20;
    const owner = unit._rtsController?.command || unit._command;
    const epoch = unit._navigationPlanEpoch || 0;
    const key = `${revision}:${version}:${epoch}:${radius}:${offset.x},${offset.y}`
        + `:${unit._surfaceKind}:${unit._surfaceWall?.id}:${unit._surfaceStaircase?.id}`
        + `>${target.surfaceKind}:${target.wallId}:${target.x},${target.y},${target.z}`;
    let job = jobs.get(unit);
    if (!job || job.owner !== owner || job.key !== key || Math.hypot(unit.x - job.x, unit.y - job.y) > 48) {
        job = { key, x: unit.x, y: unit.y, iterator: candidates(), arrivals: [], departures: [],
            owner, index: 0, built: false, limited: false, best: null, result: null };
        const currentJob = job;
        job.isCurrent = () => jobs.get(unit) === currentJob && !currentJob.result && unit.active !== false
            && !unit._dying && (unit._rtsController?.command || unit._command) === owner
            && (unit._navigationPlanEpoch || 0) === epoch;
        jobs.set(unit, job);
    }
    const wrap = result => ({ ...target, route: [], unreachable: false, navigationPending: false,
        reason: null, routeRevision: revision, ...result });
    if (job.result) return wrap(job.result);
    const pending = () => wrap({ navigationPending: true, navigationStatus: 'pending' });
    if (unit._spawnEgress) return pending();
    if (!pathFinder.advanceNavigationWithinFrameBudget() || !pathFinder._budgetAvailable()) return pending();
    // 留出原队列的时间份额；入口轮询不能持续抢光地面/战斗AI的2.4ms共同预算。
    const available = () => pathFinder.frameBudgetMs - pathFinder._frameUsedMs - 0.8;
    if (available() <= 0) return pending();
    if (!job.built) {
        const started = performance.now();
        const deadline = started + Math.min(0.6, available());
        try {
            while (performance.now() < deadline) {
                const next = job.iterator.next();
                if (next.done) { job.built = true; job.iterator = null; break; }
                const candidate = next.value;
                if (!candidate?.route?.length) continue;
                candidate.length = lengthOf(candidate.route);
                candidate.cost = candidate.length + (candidate.penalty?.() || 0);
                (candidate.kind === 'arrival' ? job.arrivals : job.departures).push(candidate);
            }
        } finally { pathFinder._chargeBudget(started); }
        if (!job.built) return pending();
        if (!job.arrivals.length || !job.departures.length) {
            job.result = { unreachable: true, navigationStatus: 'unreachable', reason: '没有连接目标承载面的可用楼梯' };
            return wrap(job.result);
        }
        job.goals = job.arrivals.map(candidate => ({ id: candidate.id,
            x: candidate.route[0].x + offset.x, y: candidate.route[0].y + offset.y,
            cost: candidate.cost }));
    }
    // 一次调用最多续算一个下梯点；不会每名士兵×每座楼梯同步跑一遍A*。
    if (available() <= 0) return pending();
    if (job.transitGraph === undefined) {
        const graph = globalThis.window?.Game?.DefenseSystem?.commandTransitGraphForUnit?.(unit);
        if (graph?.pending) return pending();
        job.transitGraph = graph || null;
    }
    if (!job.costsFrozen) {
        // 到真正获得搜索时间时才锁定拥堵成本，纳入此前同批已分配单位的接近意图。
        for (const candidate of [...job.arrivals, ...job.departures]) {
            candidate.cost = candidate.length + (candidate.penalty?.() || 0);
        }
        for (let i = 0; i < job.goals.length; i++) job.goals[i].cost = job.arrivals[i].cost;
        job.costsFrozen = true;
    }
    if (job.index < job.departures.length) {
        const departure = job.departures[job.index];
        const start = departure.route[departure.route.length - 1];
        const lowerBound = departure.cost + Math.min(...job.goals.map(goal => goal.cost
            + Math.hypot(start.x + offset.x - goal.x, start.y + offset.y - goal.y)));
        if (!job.best || lowerBound < job.best.cost) {
            const result = pathFinder.commandRoutes.query(start.x + offset.x, start.y + offset.y,
                job.goals, radius, { friendlyGateAccess: true, reserveMs: 0.8, request: job,
                    transitGraph: job.transitGraph });
            if (result.status === 'pending') return pending();
            if (result.status === 'complete') {
                job.limited ||= result.searchLimited === true;
                const cost = departure.cost + result.cost;
                if (!job.best || cost < job.best.cost) job.best = { cost, departure, result,
                    arrival: job.arrivals.find(candidate => candidate.id === result.goalId) };
            } else if (result.status === 'search_limited') job.limited = true;
        }
        job.index++;
        if (job.index < job.departures.length) return pending();
    }
    if (!job.best) {
        job.result = { unreachable: true, navigationStatus: job.limited ? 'search_limited' : 'unreachable',
            reason: job.limited ? '入口路线搜索受限，未确认可达' : '所有楼梯入口的地面路线均不连通' };
        return wrap(job.result);
    }
    const finalizedAt = performance.now();
    const { departure, arrival, result, cost } = job.best;
    const groundPath = result.path.map(point => ({ ...point, x: point.x - offset.x, y: point.y - offset.y }));
    const transit = splitCommandTransitPath(groundPath, version);
    if (transit) {
        const last = transit[transit.length - 1];
        // 最后一段地面路径仍终止于本次选中的入口，保留该入口的楼梯/组身份。
        Object.assign(last, arrival.route[0], { navigationPath: last.navigationPath, navigationVersion: version });
    }
    const route = [
        ...departure.route.slice(departure.id === 'current' ? 1 : 0).map(point => ({ ...point })),
        ...(transit || []),
        ...arrival.route.slice(transit ? 1 : 0).map((point, index) => index || transit ? { ...point } : { ...point,
            navigationPath: groundPath, navigationVersion: version }),
    ];
    job.result = { route, staircaseId: arrival.staircaseId || departure.staircaseId || null,
        navigationStatus: 'complete', navigationCost: cost,
        navigationLimitedAlternatives: job.limited };
    job.best = null; job.arrivals = []; job.departures = []; job.goals = [];
    pathFinder._chargeBudget(finalizedAt);
    return wrap(job.result);
}
