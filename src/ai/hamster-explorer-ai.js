import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { SceneManager } from '../world/scene-manager.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';
import { createGoldItem, routeProducedGold } from '../world/economy-gold-routing.js';
import { canExploreScene, createExplorerReward } from '../config/explorer-rewards.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { CONFIG } from '../config/config.js';
import { pathFinder } from './pathfinder.js';
import { clearRtsSurfaceRoute, finishRtsCommandAtHold, resolveRtsMoveDestination } from './rts-command-utils.js';

const HOLD_COMMAND = Object.freeze({ mode: 'hold', point: null, target: null });

export class HamsterExplorerAI {
    constructor(explorer) {
        this.m = explorer;
        this.cfg = explorer.aiConfig || {};
        this._phase = 'idle';
        this._destination = null;
        this._durationMs = Math.max(1000, Number(this.cfg.explorationDurationMs) || 720000);
        this._remainingMs = 0;
        this._phaseTimer = 0;
        this._progressCheckTimer = 0;
        this._lastProgressX = explorer.x;
        this._lastProgressY = explorer.y;
        this._playerLevel = 1;
    }

    cancelForCommand() {
        if (this._phase !== 'idle' || this.m._exploreActive || this.m._command?.mode === 'explore') return false;
        return this._abortExploration();
    }

    stopExploration() {
        if (this._phase === 'idle' && !this.m._exploreActive && this.m._command?.mode !== 'explore') return false;
        this._abortExploration();
        this.m._command = { ...HOLD_COMMAND };
        return true;
    }

    _abortExploration() {
        this._phase = 'idle';
        this._destination = null;
        this._remainingMs = 0;
        this._phaseTimer = 0;
        this._clearPath();
        this._clearProgressFields();
        this.m._animState = 'idle';
        this.m.maxSpeed = 0;
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        return true;
    }

    restoreExploration(run = {}) {
        const remaining = Math.max(0, Number(run.remainingMs) || 0);
        if (remaining <= 0) return false;
        this._phase = 'moving';
        this._destination = null;
        this._durationMs = Math.max(remaining, Number(run.durationMs) || this._durationMs);
        this._remainingMs = remaining;
        this._playerLevel = Math.max(1, Math.floor(Number(run.playerLevel) || 1));
        this._resetProgressWatch();
        this._syncProgressFields();
        return true;
    }

    update(dt, entities) {
        const m = this.m;
        if (m.data.hp <= 0 || m._dying) return;
        if (m._command?.mode !== 'explore') {
            if (this._phase === 'idle' && !m._exploreActive) {
                this._updateUtilityCommand(dt, entities);
                return;
            }
            // 探险是锁定状态：普通玩家指令不得覆盖，只有 stopExploration() 能退出。
            m._command = { mode: 'explore' };
        }
        if (this._phase === 'idle' && !this._startExploration()) return;

        if (this._phase !== 'digging') {
            this._remainingMs = Math.max(0, this._remainingMs - dt);
            this._syncProgressFields();
            if (this._remainingMs <= 0) this._startDigging();
        }

        if (this._phase === 'digging') {
            this._dampToStop(dt);
            m._animState = 'digging';
            this._phaseTimer -= dt;
            if (this._phaseTimer <= 0) this._completeExploration();
            return;
        }
        if (this._phase === 'viewing') {
            this._dampToStop(dt);
            m._animState = 'viewing';
            this._phaseTimer -= dt;
            if (this._phaseTimer <= 0) this._startMoving();
            return;
        }

        this._updateMoving(dt, entities);
    }

    _updateUtilityCommand(dt, entities) {
        const m = this.m;
        const command = m._command;
        if (command?.mode === 'move' && command.point) {
            const move = resolveRtsMoveDestination(m, command);
            if (move.arrived) {
                finishRtsCommandAtHold(m);
                return;
            }
            m.target = null;
            m._tacticalTarget = move.destination;
            m.maxSpeed = Number(this.cfg.walkSpeed) || 120;
            m._animState = 'walk';
            MovementSystem.update(m, dt, entities);
            return;
        }
        if (!m._surfaceNavCommand) clearRtsSurfaceRoute(m);
        m.target = null;
        m._tacticalTarget = null;
        m.maxSpeed = 0;
        m._animState = 'idle';
        MovementSystem.update(m, dt, entities);
        // 缓停滑行期保持 walk，防 idle 姿势滑冰
        if (Math.hypot(m.vx || 0, m.vy || 0) > 25) m._animState = 'walk';
    }

    _startExploration() {
        const sceneId = SceneManager.currentScene;
        if (!canExploreScene(sceneId)) {
            this.m._command = { ...HOLD_COMMAND };
            this.m._animState = 'idle';
            EffectManager.add(new FloatingTextEffect(this.m.x, this.m.y - 60,
                '当前位面没有可用探险奖励池', '#ff8855'));
            return false;
        }
        const game = typeof window !== 'undefined' ? window.Game : null;
        this._phase = 'moving';
        this._destination = null;
        this._remainingMs = this._durationMs;
        this._playerLevel = Math.max(1, Math.floor(Number(game?.player?.data?.level) || 1));
        this._resetProgressWatch();
        this._syncProgressFields();
        return true;
    }

    _startMoving() {
        this._phase = 'moving';
        this._phaseTimer = 0;
        this._destination = null;
        this._resetProgressWatch();
        this.m._animState = 'walk';
    }

    _updateMoving(dt, entities) {
        const m = this.m;
        if (!this._destination) this._destination = this._pickDestination();
        if (!this._destination) {
            this._startViewing();
            return;
        }
        let distance = Math.hypot(this._destination.x - m.x, this._destination.y - m.y);
        if (distance <= (Number(this.cfg.exploreArriveDist) || 55)) {
            this._startViewing();
            return;
        }

        this._progressCheckTimer -= dt;
        if (this._progressCheckTimer <= 0) {
            // 绕开建筑时到终点的直线距离可能暂时不降，不能据此判定卡死。
            // 只在实体坐标确实没有推进时重置路线，避免反复换点后沿用旧中继路径原地踏步。
            const moved = Math.hypot(m.x - this._lastProgressX, m.y - this._lastProgressY);
            if (moved < 12) {
                this._clearPath();
                this._destination = this._pickDestination();
                distance = this._destination
                    ? Math.hypot(this._destination.x - m.x, this._destination.y - m.y)
                    : Number.POSITIVE_INFINITY;
            }
            this._lastProgressX = m.x;
            this._lastProgressY = m.y;
            this._progressCheckTimer = 5000;
        }

        if (!this._destination) return;
        m._tacticalTarget = this._destination;
        // 接近目的地缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
        const walkSpeed = Number(this.cfg.walkSpeed) || 120;
        const slow = Math.min(1, distance / 120);
        m.maxSpeed = walkSpeed * Math.max(0.3, slow);
        m._animState = 'walk';
        MovementSystem.update(m, dt, entities);
    }

    _startViewing() {
        this._phase = 'viewing';
        this._destination = null;
        this._phaseTimer = Math.max(1, Number(this.cfg.viewingDurationMs) || 1500);
        this._clearPath();
        this.m.maxSpeed = 0;
        this.m._animState = 'viewing';
    }

    _startDigging() {
        this._phase = 'digging';
        this._destination = null;
        this._phaseTimer = Math.max(1, Number(this.cfg.diggingDurationMs) || 1100);
        this._clearPath();
        this.m.maxSpeed = 0;
        this.m._explorePhase = 'digging';
        this.m._exploreRemainingMs = 0;
        this.m._animState = 'digging';
    }

    _completeExploration() {
        const game = typeof window !== 'undefined' ? window.Game : null;
        const level = Math.max(1, Math.floor(Number(game?.player?.data?.level) || this._playerLevel || 1));
        const reward = createExplorerReward(SceneManager.currentScene, level);
        this._grantReward(reward);
        this._phase = 'idle';
        this._remainingMs = 0;
        this._phaseTimer = 0;
        this._clearProgressFields();
        this.m._command = { ...HOLD_COMMAND };
        this.m._animState = 'idle';
        this.m.maxSpeed = 0;
    }

    _grantReward(reward) {
        const game = typeof window !== 'undefined' ? window.Game : null;
        for (const item of reward.items || []) {
            const requested = Math.max(0, Math.floor(Number(item.stack) || 0));
            const accepted = requested > 0 ? WarehouseSystem.depositItemAmount(item) : 0;
            if (accepted < requested) game?.dropItem?.(this.m.x, this.m.y, {
                ...JSON.parse(JSON.stringify(item)), stack: requested - accepted,
            });
        }
        if (reward.gold > 0) {
            const routed = routeProducedGold(reward.gold);
            if (routed.remaining > 0) game?.dropItem?.(this.m.x, this.m.y, createGoldItem(routed.remaining));
        }
        EffectManager.add(new FloatingTextEffect(this.m.x, this.m.y - 70,
            `探险完成：${reward.label}`, reward.kind === 'gold' ? '#ffd56a' : '#c9a0ff'));
    }

    _pickDestination() {
        const m = this.m;
        const scene = SceneManager.scenes?.[SceneManager.currentScene] || null;
        const width = Math.max(200, Number(scene?.width) || CONFIG.WORLD_WIDTH || 4096);
        const height = Math.max(200, Number(scene?.height) || CONFIG.WORLD_HEIGHT || 4096);
        const diamond = typeof SceneManager._scene8Diamond === 'function'
            ? SceneManager._scene8Diamond(scene || { width, height })
            : null;
        const radius = Math.max(1, Number(m.groundRadius) || 20);
        const margin = Math.max(80, radius * 3);
        const attempts = Math.max(20, Math.floor(Number(this.cfg.fullMapSampleAttempts) || 96));
        const arriveDist = Math.max(1, Number(this.cfg.exploreArriveDist) || 55);
        const minTravelDistance = Math.max(arriveDist * 2,
            Number(this.cfg.exploreMinTravelDistance) || 180);
        let fallback = null;
        let fallbackDistance = -1;
        for (let i = 0; i < attempts; i++) {
            let x;
            let y;
            if (diamond) {
                x = diamond.cx + (Math.random() * 2 - 1) * Math.max(1, diamond.rx - margin);
                y = diamond.cy + (Math.random() * 2 - 1) * Math.max(1, diamond.ry - margin);
                if (Math.abs((x - diamond.cx) / Math.max(1, diamond.rx - margin))
                    + Math.abs((y - diamond.cy) / Math.max(1, diamond.ry - margin)) > 1) continue;
            } else {
                x = margin + Math.random() * Math.max(1, width - margin * 2);
                y = margin + Math.random() * Math.max(1, height - margin * 2);
            }
            if (WallSystem?.canMoveTo && !WallSystem.canMoveTo(x, y, radius)) continue;
            if (pathFinder?.isReachable && !pathFinder.isReachable(m.x, m.y, x, y, radius)) continue;

            const travelDistance = Math.hypot(x - m.x, y - m.y);
            if (travelDistance > fallbackDistance) {
                fallback = { x, y };
                fallbackDistance = travelDistance;
            }
            if (travelDistance >= minTravelDistance) return { x, y };
        }
        // 极小或高度拥挤的地图允许退回到本轮抽到的最远合法点，避免永久无目标。
        return fallback;
    }

    _dampToStop(dt) {
        const m = this.m;
        const damp = Math.pow(0.85, dt / 16.67);
        m.vx *= damp;
        m.vy *= damp;
        if (Math.hypot(m.vx, m.vy) < 1) { m.vx = 0; m.vy = 0; }
        m.isMoving = false;
        m.maxSpeed = 0;
    }

    _clearPath() {
        this.m._tacticalTarget = null;
        this.m._relayTarget = null;
        if (typeof this.m._pathManager?._clearPath === 'function') this.m._pathManager._clearPath();
    }

    _resetProgressWatch() {
        this._progressCheckTimer = 5000;
        this._lastProgressX = this.m.x;
        this._lastProgressY = this.m.y;
    }

    _syncProgressFields() {
        this.m._exploreActive = true;
        this.m._explorePhase = this._phase;
        this.m._exploreDurationMs = this._durationMs;
        this.m._exploreRemainingMs = this._remainingMs;
        this.m._explorePlayerLevel = this._playerLevel;
    }

    _clearProgressFields() {
        this.m._exploreActive = false;
        this.m._explorePhase = 'idle';
        this.m._exploreDurationMs = this._durationMs;
        this.m._exploreRemainingMs = 0;
    }
}
