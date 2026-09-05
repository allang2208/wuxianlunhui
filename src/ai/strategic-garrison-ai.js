import config from '../../data/world-strategy.json';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { DefenseSystem } from '../world/defense-system.js';
import SpatialPartitionSystem from '../systems/spatial-partition-system.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';

const distance = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * 2);
const shotDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = (unit) => unit?.active !== false && (unit?.hp ?? unit?.data?.hp ?? 0) > 0;
const hostile = (unit) => alive(unit) && unit.hittable !== false
    && ['player', 'companion', 'ally', 'friendly'].includes(unit._faction);
const hashOf = (record) => {
    let hash = 0;
    for (const char of `${record.type}:${record.slot}`) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    return hash;
};

// The director publishes infrequent defensive orders; shared movement/combat owns execution.
export class StrategicGarrisonAI {
    constructor(siege, objectives) {
        this.siege = siege;
        this.objectives = objectives;
        this.rules = config.siege.ai;
        this.guards = new Map();
        this.seats = [];
        this.attackers = [];
        this.elapsed = 0;
        this.intelTimer = this.rules.intelMs;
        this.redeployTimer = this.rules.redeployMs;
        this.decisionsThisFrame = 0;
        this.health = new Map();
        for (const part of [...siege.parts, ...objectives]) this.health.set(part, part.unit?.hp || 0);
    }

    postFor(record) {
        return this.siege.posts[hashOf(record) % this.siege.posts.length];
    }

    attach(unit, record) {
        const ranged = record.siegeRole === 'ranged' || !!unit.attacks?.ranged;
        const groundHome = { x: unit.x, y: unit.y };
        const seat = ranged ? this.siege.deployRanged(unit, this.seats, Game.player) : null;
        const guard = { unit, ranged, seat, home: groundHome, orderPoint: groundHome,
            timer: hashOf(record) % this.rules.decisionMs, returning: false };
        unit._usePacingAI = false;
        unit.ai = { ...unit.ai, chargeStraight: false };
        unit._aiState = 'chasing';
        if (unit._baseSpeed) unit.maxSpeed = unit._baseSpeed;
        unit._strategicGarrison = {
            holdPosition: !!seat,
            update: (dt, entities) => this._updateGuard(guard, dt, entities),
        };
        unit.target = null;
        unit._tacticalTarget = null;
        this.guards.set(unit, guard);
    }

    detach(unit) {
        const guard = this.guards.get(unit);
        if (guard?.seat) this.seats = this.seats.filter((seat) => seat !== guard.seat);
        this.guards.delete(unit);
        unit._strategicGarrison = null;
        DefenseSystem.untrackElevatedNavigationUnit(unit);
    }

    destroy() {
        for (const unit of this.guards.keys()) this.detach(unit);
        this.attackers = [];
        this.health.clear();
    }

    update(dt) {
        this.elapsed += dt;
        this.decisionsThisFrame = 0;
        this.intelTimer += dt;
        this.redeployTimer += dt;
        if (this.intelTimer >= this.rules.intelMs) {
            this.intelTimer %= this.rules.intelMs;
            this._sampleBattlefield();
        }
        if (this.redeployTimer >= this.rules.redeployMs) {
            this.redeployTimer %= this.rules.redeployMs;
            this._redeploy();
        }
    }

    _sampleBattlefield() {
        // One shared scan per intel tick, rather than a full entity Set for every soldier.
        this.attackers = Array.from(new Set([Game.player, ...Game.entities.values(),
            ...(Game.PartySystem?.members || [])])).filter(hostile);
        let strongestHit = 0;
        for (const [part, previous] of this.health) {
            const hp = Math.max(0, part.unit?.hp || 0);
            if (previous - hp > strongestHit) {
                strongestHit = previous - hp;
                this.hotspot = part.position ? part : this.siege.nearestPart(part.unit);
                this.hotspotUntil = this.elapsed + this.rules.alarmMs;
            }
            this.health.set(part, hp);
        }
        const observable = (actor) => {
            const part = this.siege.nearestPart(actor);
            return part && distance(actor, part.position) <= this.rules.observationRadius;
        };
        const actor = hostile(Game.player) && observable(Game.player) ? Game.player
            : this.attackers.find(observable);
        this.observed = null;
        this.predicted = null;
        if (actor) {
            const now = { x: actor.x, y: actor.y };
            let dx = 0, dy = 0;
            if (this.lastObservation?.actor === actor) {
                const seconds = (this.elapsed - this.lastObservation.at) / 1000;
                if (seconds > 0) {
                    const lookAhead = this.rules.predictionMs / 1000;
                    dx = (now.x - this.lastObservation.x) / seconds * lookAhead;
                    dy = (now.y - this.lastObservation.y) / seconds * lookAhead;
                    const scale = Math.min(1, this.rules.predictionMaxDistance / (Math.hypot(dx, dy * 2) || 1));
                    dx *= scale; dy *= scale;
                }
            }
            this.observed = now;
            this.predicted = { x: now.x + dx, y: now.y + dy };
            this.lastObservation = { actor, ...now, at: this.elapsed };
        } else this.lastObservation = null;
    }

    _defensePoint(part, ordinal, guard, occupied) {
        const radius = Math.max(36, guard.unit.groundRadius || guard.unit.collisionRadius || 36);
        // Finite local candidates; pathfinding is left to the shared deferred work queue.
        for (let attempt = 0; attempt < 12; attempt++) {
            const point = this.siege.defensePoint(part, ordinal + attempt);
            if (!WallSystem.canMoveTo(point.x, point.y, radius)) continue;
            if (this.siege.isStairAccessReserved(point, radius)) continue;
            if (this.objectives.some(({ unit }) => alive(unit) && distance(point, unit) < radius + 190)) continue;
            if (occupied.some((other) => distance(point, other) < radius + other.radius + 20)) continue;
            return { ...point, radius };
        }
        return null;
    }

    _redeploy() {
        const hot = this.elapsed < (this.hotspotUntil || 0) ? this.hotspot : null;
        const primary = hot || (this.observed && this.siege.nearestPart(this.observed));
        const predicted = this.predicted && this.siege.nearestPart(this.predicted);
        const occupied = [];
        let index = 0;
        for (const guard of this.guards.values()) {
            if (!alive(guard.unit) || guard.unit._strategicGarrison?.holdPosition) continue;
            const part = index % 3 === 2 && predicted ? predicted : primary;
            const next = part ? this._defensePoint(part, Math.floor(index / 3), guard, occupied) : guard.home;
            index++;
            if (next && distance(next, guard.orderPoint) >= this.rules.orderChangeDistance) guard.orderPoint = next;
            occupied.push({ ...guard.orderPoint, radius: Math.max(36, guard.unit.groundRadius || 36) });
        }
    }

    _intent(guard, target, point, state) {
        const unit = guard.unit;
        const changedPoint = point
            ? !guard.lastPoint || distance(point, guard.lastPoint) >= this.rules.orderChangeDistance
            : !!guard.lastPoint;
        const changedIntent = unit.target !== target || guard.state !== state || changedPoint;
        // Repeated orders must let MovementSystem finish its temporary unstuck sidestep.
        const keepReposition = !changedIntent && unit._tacticalTarget?._isReposition
            && unit._repositionTimer > 0;
        if (changedIntent) unit._pathManager?._clearPath();
        guard.state = state;
        guard.lastPoint = point;
        unit.target = target;
        if (!keepReposition) {
            unit._tacticalTarget = point;
            unit._repositionTimer = 0;
        }
        unit._specialTacticalTarget = null;
        unit._lastKnownTargetPos = null;
        unit._searchTarget = null;
        if (unit._perception) unit._perception.hasLOS = !!target;
    }

    _selectTarget(guard, entities, range, fixed) {
        const unit = guard.unit;
        const sps = SpatialPartitionSystem;
        const nearby = sps.cells?.size && sps._sourceEntities === entities
            ? sps.queryRadius(unit.x, unit.y, range, unit) : this.attackers;
        const metric = guard.ranged ? shotDistance : distance;
        const eligible = (candidate) => hostile(candidate) && metric(unit, candidate) <= range
            && (fixed || distance(candidate, guard.orderPoint) <= this.rules.leashRadius);
        const candidates = Array.from(new Set([...nearby, ...(Game.PartySystem?.members || []), unit.target]))
            .filter(eligible).sort((a, b) => metric(unit, a) - metric(unit, b));
        const visible = (target) => guard.ranged ? hasRangedLineOfSight(unit, target)
            : !WallSystem.blocked(unit.x, unit.y, target.x, target.y);
        let budget = this.rules.maxLosChecksPerDecision;
        // Keep a valid current target first, limiting needless target/path churn.
        if (eligible(unit.target)) {
            budget--;
            if (visible(unit.target)) return unit.target;
            const index = candidates.indexOf(unit.target);
            candidates.splice(index, 1);
        }
        // Continue across decisions so blocked nearest candidates cannot starve a visible farther one.
        const start = guard.targetCursor || 0;
        for (let index = 0; index < Math.min(candidates.length, budget); index++) {
            const cursor = (start + index) % candidates.length;
            guard.targetCursor = (cursor + 1) % candidates.length;
            if (visible(candidates[cursor])) return candidates[cursor];
        }
        return null;
    }

    _updateGuard(guard, dt, entities) {
        const unit = guard.unit;
        if (!alive(unit)) return;
        // Collapse/forced displacement cannot leave a stale hold flag or teleport a shooter back up.
        const fixed = guard.ranged && unit._surfaceKind === 'wall_walk'
            && alive(unit._surfaceWall) && !unit._surfaceWall._sinking;
        unit._strategicGarrison.holdPosition = fixed;
        guard.timer += dt;
        if (guard.timer < this.rules.decisionMs || this.decisionsThisFrame >= this.rules.maxDecisionsPerFrame) return;
        if (unit._frozenForCast || unit._attackAnimTimer > 0 || unit._dashStunned
            || ['stun', 'frozen', 'petrified', 'fear'].some((status) => unit.hasStatusEffect?.(status))) return;
        guard.timer %= this.rules.decisionMs;
        this.decisionsThisFrame++;
        if (!fixed) {
            if (distance(unit, guard.orderPoint) > this.rules.leashRadius) guard.returning = true;
            if (guard.returning && distance(unit, guard.orderPoint) <= this.rules.returnRadius) guard.returning = false;
            if (guard.returning) { this._intent(guard, null, guard.orderPoint, 'return'); return; }
        }
        const range = guard.ranged
            ? Math.min(unit.attackDistance || (unit.attackRange || 500) * 1.15,
                unit.attacks?.ranged?.config?.projectileRange || this.rules.alertRadius)
            : this.rules.meleeEngageRadius;
        const target = this._selectTarget(guard, entities, range, fixed);
        if (fixed) { this._intent(guard, target, null, 'wall_hold'); return; }
        if (target) { this._intent(guard, target, null, 'engage'); return; }
        this._intent(guard, null,
            distance(unit, guard.orderPoint) > this.rules.arriveRadius ? guard.orderPoint : null, 'defend');
    }
}
