import { getMinerEconomyStats, getMiningWorkerProfile } from './miner-economy.js';
import { ENERGY_CONFIG } from '../config/energy-config.js';
import { distanceToIsoFootprint, isoLocalToWorldDelta, worldDeltaToIsoLocal } from '../physics/iso-footprint.js';

const nonNegative = (value) => Math.max(0, Number(value) || 0);

/** 后台不运行实体寻路：按快照脚点/工会边缘计算路程，保留行进、携矿与冷却。
 * 矿脉 HP 是可造成伤害量；不能把 HP 当作可直接入库的能源。
 */
export function simulateMiningGuild(structure, nodes, elapsedMs, laborEfficiency, submitRaw) {
    if (!(structure.hp > 0)) {
        structure.minerWorkers = [];
        structure.miners = 0;
        structure.carriedEnergy = 0;
        return;
    }
    const { building, unit } = getMiningWorkerProfile('mining_guild');
    const stats = getMinerEconomyStats(structure.modules || {}, null, 'mining_guild');
    const assigned = Math.min(stats.count, Math.floor(nonNegative(structure.assignedWorkers)));
    structure.assignedWorkers = assigned;
    const workers = Array.isArray(structure.minerWorkers) ? structure.minerWorkers : [];
    // Only a legacy/partial snapshot lacks per-worker state; distribute its aggregate cargo once.
    if (!Array.isArray(structure.minerWorkers)) {
        let cargo = nonNegative(structure.carriedEnergy);
        const count = Math.max(Math.min(assigned, Math.floor(nonNegative(structure.miners))),
            cargo > 0 ? Math.ceil(cargo / stats.backpackCapacity) : 0);
        for (let i = 0; i < count; i++) {
            const carried = Math.min(cargo, stats.backpackCapacity);
            cargo -= carried;
            workers.push({ x: structure.x, y: structure.y + 40, carried, phase: carried ? 'unload_return' : 'work' });
        }
    }
    let working = 0;
    for (const worker of workers) {
        worker.retiring = working >= assigned;
        if (!worker.retiring) working++;
        else worker.phase = 'unload_return';
        worker.carried = nonNegative(worker.carried);
        worker.attackTimer = nonNegative(worker.attackTimer);
        worker.groundRadius = 19.5;
    }
    const missing = Math.max(0, assigned - working);
    const respawnWait = missing ? nonNegative(structure.respawnTimer) : 0;
    if (missing && respawnWait <= elapsedMs) {
        let spawned = 0;
        for (let i = 0; i < missing && respawnWait+i*building.respawnMs <= elapsedMs; i++) {
            workers.push({ x: structure.x, y: structure.y + 40, carried: 0, phase: 'work',
                attackTimer: 0, groundRadius: 19.5, availableAfterMs: respawnWait+i*building.respawnMs });
            spawned++;
        }
        structure.respawnTimer = spawned < missing
            ? Math.max(0, respawnWait+spawned*building.respawnMs-elapsedMs) : building.respawnMs;
    } else if (missing) structure.respawnTimer = Math.max(0, respawnWait - elapsedMs);
    const width = 128 * (building.footprintCells || 4);
    const hut = { x: structure.x, y: structure.y, colliderOffsetY: -width/4,
        collisionWidth: width, collisionIsoHalfU: width/(2*Math.SQRT2), collisionIsoHalfV: width/(2*Math.SQRT2) };
    const speed = Math.max(1, stats.walkSpeed);
    const interval = stats.attackInterval / Math.max(0.000001, Math.min(1, laborEfficiency));
    const damage = Math.round(stats.attackDamage * stats.miningMult);
    const move = (worker, point, ms) => {
        const dx = point.x-worker.x, dy = point.y-worker.y;
        const duration = Math.hypot(dx,dy)/speed*1000;
        const used = Math.min(ms,duration);
        const fraction = duration > 0 ? used/duration : 1;
        worker.x += dx*fraction;
        worker.y += dy*fraction;
        worker.attackTimer = Math.max(0,worker.attackTimer-used);
        return { left: ms-used, arrived: used >= duration };
    };
    for (const worker of workers) {
        let ms = Math.max(0, elapsedMs-nonNegative(worker.availableAfterMs));
        delete worker.availableAfterMs;
        while (ms > 0) {
            if (worker.retiring || worker.carried >= stats.backpackCapacity) worker.phase = 'unload_return';
            if (worker.phase === 'storage_wait' || worker.phase === 'unload_return') {
                if (distanceToIsoFootprint(worker.x,worker.y,hut) > worker.groundRadius+36) {
                    const centerY = hut.y+hut.colliderOffsetY;
                    const local = worldDeltaToIsoLocal(worker.x-hut.x,worker.y-centerY);
                    const half = hut.collisionIsoHalfU;
                    const u = Math.max(-half,Math.min(half,local.u));
                    const v = Math.max(-half,Math.min(half,local.v));
                    const distance = Math.hypot(local.u-u,local.v-v) || 1;
                    const margin = worker.groundRadius+12;
                    const delta = isoLocalToWorldDelta(u+(local.u-u)/distance*margin,v+(local.v-v)/distance*margin);
                    const travel = move(worker,{x:hut.x+delta.x,y:centerY+delta.y},ms);
                    ms = travel.left;
                    if (!travel.arrived) break;
                }
                const accepted = submitRaw(Math.floor(worker.carried));
                worker.carried = Math.max(0,worker.carried-accepted);
                if (worker.carried > 0) { worker.phase = 'storage_wait'; break; }
                if (worker.retiring) { worker.finished = true; break; }
                worker.phase = 'work';
            }
            let node = nodes.find((n) => !n.depleted && n.hp > 0 && n.x === worker.targetX && n.y === worker.targetY);
            if (!node) {
                let nearest = Infinity;
                for (const candidate of nodes) {
                    if (candidate.depleted || !(candidate.hp > 0)) continue;
                    const distance = Math.hypot(candidate.x-worker.x,candidate.y-worker.y);
                    if (distance < nearest) { nearest = distance; node = candidate; }
                }
            }
            if (!node) {
                if (worker.carried > 0) { worker.phase = 'unload_return'; continue; }
                break;
            }
            worker.targetX = node.x;
            worker.targetY = node.y;
            const dx = worker.x-node.x, dy = worker.y-node.y;
            const distance = Math.hypot(dx,dy);
            const range = unit.ai.miningRange+ENERGY_CONFIG.gatherRadius;
            if (distance > range) {
                const approach = Math.max(unit.ai.miningRange,worker.groundRadius+40);
                const travel = move(worker,{x:node.x+dx/distance*approach,y:node.y+dy/distance*approach},ms);
                ms = travel.left;
                if (!travel.arrived) break;
            }
            if (!(laborEfficiency > 0)) break;
            const wait = Math.min(ms,worker.attackTimer);
            ms -= wait;
            worker.attackTimer -= wait;
            if (!(ms > 0)) break;
            // Deterministic expected critical cadence keeps preview/commit reproducible.
            const critRemainder = nonNegative(worker.critRemainder)+stats.expectedCritChance;
            const hitDamage = critRemainder >= 1 ? Math.round(damage*1.5) : damage;
            worker.critRemainder = critRemainder % 1;
            const free = stats.backpackCapacity-worker.carried;
            const dealt = Math.min(node.hp,hitDamage,Math.ceil(free/Math.max(stats.gatherRatio,0.000001)));
            node.hp = Math.max(0,node.hp-dealt);
            worker.carried += Math.min(free,Math.floor(dealt*stats.gatherRatio));
            worker.attackTimer = interval;
            if (node.hp <= 0) {
                node.depleted = true;
                node.collapseTimer = 0;
                node.respawnTimer = 0; // 新矿脉采空永久耗尽，与前台一致。
            }
        }
    }
    structure.minerWorkers = workers.filter((worker) => !worker.finished);
    structure.miners = structure.minerWorkers.length;
    structure.carriedEnergy = structure.minerWorkers.reduce((sum,worker) => sum+worker.carried,0);
}
