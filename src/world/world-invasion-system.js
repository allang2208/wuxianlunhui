// 五日全局入侵：统一游戏时间推进、地牢进度加速、跨世界选点和前后台同构结算。
import worldSystemConfig from '../../data/world-system.json';
import { Game } from '../game.js';
import { DefenseSystem } from './defense-system.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldProgressionSystem } from './world-progression-system.js';
import { ensureWorldBaseSnapshot, getWorldSnapshot, resetWorldSnapshot } from './world122-snapshot.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { TroopLineSystem } from './troop-line-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';

const VERSION = 3;
const cfg = worldSystemConfig.invasion || {};
const clone = (value) => JSON.parse(JSON.stringify(value));

function initialState() {
    return {
        version: VERSION,
        cycle: 0,
        progressMs: 0,
        active: null,
    };
}

let state = initialState();
let liveWorldId = null;

function dayDurationMs() {
    return Math.max(1, Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function intervalMs() {
    return dayDurationMs() * Math.max(1, Number(cfg.intervalDays) || 5);
}

function weightedPick(pool) {
    const total = pool.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
    if (total <= 0) return pool[0];
    let roll = Math.random() * total;
    for (const item of pool) {
        roll -= Math.max(0, Number(item.weight) || 0);
        if (roll <= 0) return item;
    }
    return pool[pool.length - 1];
}

function buildWaves(cycle, day) {
    const waveCount = Math.min(
        cfg.maxWaves || 10,
        (cfg.baseWaves || 3) + Math.floor(Math.max(0, cycle - 1) / Math.max(1, cfg.extraWaveEveryCycles || 2))
    );
    const pool = (cfg.monsters || []).filter((monster) => day >= (monster.unlockDay || 1));
    const fallback = pool.length ? pool : [{ type: 'zombie', weight: 1, threat: 1 }];
    const waves = [];
    for (let wave = 1; wave <= waveCount; wave++) {
        const count = Math.min(
            cfg.maxAlive || 60,
            (cfg.baseMonsterCount || 6)
                + (wave - 1) * (cfg.monsterCountPerWave || 2)
                + Math.max(0, cycle - 1) * (cfg.monsterCountPerCycle || 1)
        );
        const list = [];
        for (let i = 0; i < count; i++) list.push(weightedPick(fallback).type);
        waves.push(list);
    }
    return waves;
}

function worldName(sceneId) {
    return worldSystemConfig.worlds?.[sceneId]?.name || sceneId;
}

function portalWarningForRatio(ratio) {
    return (cfg.portalWarnings || [])
        .filter((entry) => ratio <= Math.max(0, Number(entry.ratio) || 0))
        .sort((left, right) => (Number(right.stage) || 0) - (Number(left.stage) || 0))[0] || null;
}

function warningColor(severity) {
    if (severity === 'evacuation') return '#ff3d3d';
    if (severity === 'critical') return '#ff765c';
    return '#ffbf69';
}

function notify(text, color = '#ffb86a') {
    const player = Game?.player;
    if (player && EffectManager) {
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 70, text, color));
    }
    if (typeof window !== 'undefined' && window.SceneManager?.showTopNotification) {
        window.SceneManager.showTopNotification(text, { color, fontSize: '30px', duration: 4200 });
    }
}

function spawnPointsFor(diamond) {
    if (!diamond) return [];
    const inset = 180;
    return [
        { x: diamond.cx + diamond.rx - inset, y: diamond.cy },
        { x: diamond.cx + diamond.rx * 0.78, y: diamond.cy - diamond.ry * 0.18 },
        { x: diamond.cx + diamond.rx * 0.78, y: diamond.cy + diamond.ry * 0.18 },
        { x: diamond.cx, y: diamond.cy - diamond.ry + inset },
        { x: diamond.cx, y: diamond.cy + diamond.ry - inset },
    ];
}

function defenseDps(snapshot, sceneId, worldEpoch) {
    const structureDps = (snapshot?.structures || []).reduce((sum, structure) => {
        if (!(structure.hp > 0)) return sum;
        if (structure.kind === 'tower') return sum + Math.max(0, structure.dps || 0);
        if (structure.kind === 'barracks' || structure.kind === 'producer') {
            return sum + Math.max(0, structure.unitDps || 0);
        }
        return sum;
    }, 0);
    return structureDps + TroopLineSystem.getBackgroundDefense(sceneId, worldEpoch).dps;
}

function waveThreat(active) {
    const monsterCfg = new Map((cfg.monsters || []).map((monster) => [monster.type, monster]));
    return (active.waves?.[active.waveIndex - 1] || []).reduce(
        (sum, type) => sum + Math.max(0.5, Number(monsterCfg.get(type)?.threat) || 1),
        0
    );
}

function applyBackgroundDamage(snapshot, sceneId, damage, worldEpoch) {
    let left = Math.max(0, damage);
    const structures = snapshot?.structures || [];
    const portal = structures.find((structure) => structure.kind === 'producer' && structure.cfgKey === 'portal');
    const walls = structures.filter((structure) => structure !== portal
        && (structure.kind === 'block' || structure.kind === 'gate4'));
    const buildings = structures.filter((structure) => structure !== portal
        && structure.kind !== 'block' && structure.kind !== 'gate4');
    for (const structure of [...walls, ...buildings]) {
        if (left <= 0 || !(structure.hp > 0)) continue;
        const dealt = Math.min(structure.hp, left);
        structure.hp -= dealt;
        left -= dealt;
    }
    const portalState = WorldProgressionSystem.getPortalState(sceneId);
    const portalHp = portal?.hp > 0 ? portal.hp : portalState.hp;
    const nextHp = Math.max(0, portalHp - left);
    if (portal) portal.hp = nextHp;
    WorldProgressionSystem.syncPortalHp(sceneId, nextHp, { expectedEpoch: worldEpoch });
    return nextHp;
}

function destroyWorldRecords(sceneId, worldEpoch) {
    if (typeof window !== 'undefined' && window.SceneManager?.destroyWorld) {
        return window.SceneManager.destroyWorld(sceneId, worldEpoch);
    }
    if (!WorldProgressionSystem.markPortalDestroyed(sceneId, { expectedEpoch: worldEpoch })) return false;
    if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'snapshot')) {
        resetWorldSnapshot(sceneId);
    }
    if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'playerPosition')
        && Game?._worldPlayerPos) delete Game._worldPlayerPos[sceneId];
    return true;
}

export const WorldInvasionSystem = {
    reset() {
        state = initialState();
        liveWorldId = null;
        this._livePortal = null;
        this._liveDiamond = null;
        DefenseSystem.stopManagedInvasion?.();
    },

    serialize() {
        this.syncLivePortal();
        return clone(state);
    },

    syncLivePortal() {
        if (!liveWorldId || !this._livePortal) return;
        WorldProgressionSystem.syncPortalHp(liveWorldId, this._livePortal.hp, {
            expectedEpoch: this._livePortal._worldEpoch,
        });
        if (state.active?.targetWorld === liveWorldId) {
            this._checkPortalWarnings(liveWorldId, this._livePortal.hp);
        }
    },

    restore(data) {
        DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        state = initialState();
        if (!data || typeof data !== 'object') return;
        state.cycle = Math.max(0, Math.floor(Number(data.cycle) || 0));
        state.progressMs = Math.max(0, Number(data.progressMs) || 0);
        state.active = data.active && data.active.targetWorld ? clone(data.active) : null;
        if (state.active) {
            const currentEpoch = WorldProgressionSystem.getWorldEpoch(state.active.targetWorld);
            // v1 入侵存档没有世代号：只在目标仍属当前活动位面时迁入当前世代。
            if (!(state.active.worldEpoch > 0)) state.active.worldEpoch = currentEpoch;
            state.active.portalWarningStage = Math.max(0,
                Math.floor(Number(state.active.portalWarningStage) || 0));
            if (!WorldProgressionSystem.isWorldEpochCurrent(state.active.targetWorld, state.active.worldEpoch)
                || !WorldProgressionSystem.isPortalConstructed(state.active.targetWorld)) {
                state.active = null;
            }
        }
        if (state.active?.targetWorld === liveWorldId && this._livePortal && !this._livePortal._portalDestroyed) {
            this._attachLiveBattle();
        }
    },

    recordDungeonRun(dungeonType, grade, outcome) {
        WorldProgressionSystem.recordDungeonRun(dungeonType, outcome);
        const fraction = Math.max(0, Number(cfg.dungeonProgressByGrade?.[grade]) || 0);
        const addedMs = intervalMs() * fraction;
        state.progressMs += addedMs;
        return { fraction, addedMs, progress: Math.min(1, state.progressMs / intervalMs()) };
    },

    update(deltaMs, currentScene) {
        const dt = Math.max(0, Number(deltaMs) || 0);
        if (!state.active) {
            state.progressMs += dt;
            if (state.progressMs >= intervalMs()) this._startNextInvasion();
            return;
        }
        if (!WorldProgressionSystem.isWorldEpochCurrent(state.active.targetWorld, state.active.worldEpoch)) {
            DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
            state.active = null;
            return;
        }
        if (state.active.targetWorld === liveWorldId) {
            this.syncLivePortal();
            const live = DefenseSystem.getManagedInvasionState?.();
            if (live?.wave > 0) state.active.waveIndex = live.wave;
        } else {
            this._updateBackground(dt);
        }
    },

    _startNextInvasion() {
        const candidates = this._getInvasionCandidates();
        if (!candidates.length) return false;
        // 对旧档或未来新增调用方做最后兜底：入侵目标绝不能处于“已建门但无快照”状态。
        for (const world of candidates) {
            ensureWorldBaseSnapshot(world.sceneId, {
                portalHp: world.portal.hp,
                worldEpoch: world.portal.worldEpoch,
                generation: WorldProgressionSystem.getWorldGenerationContext(world.sceneId),
            });
        }
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        const nextCycle = state.cycle + 1;
        const day = EnvironmentLightingSystem.getGameTime()?.day || 1;
        const waves = buildWaves(nextCycle, day);
        state.progressMs = Math.max(0, state.progressMs - intervalMs());
        state.cycle = nextCycle;
        state.active = {
            id: `invasion_${nextCycle}_${Date.now()}`,
            cycle: nextCycle,
            targetWorld: target.sceneId,
            worldEpoch: target.portal.worldEpoch,
            waveIndex: 1,
            waveCount: waves.length,
            waveElapsedMs: 0,
            waves,
            day,
            portalWarningStage: 0,
        };
        notify(`⚠ 第 ${nextCycle} 次入侵开始：${worldName(target.sceneId)}`, '#ff6655');
        if (liveWorldId === target.sceneId) this._attachLiveBattle();
        return true;
    },

    _getInvasionCandidates(nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        return WorldProgressionSystem.getTravelWorlds()
            .filter((world) => world.portal.constructed && !world.portal.destroyed)
            .filter((world) => !WorldProgressionSystem.isWorldInvasionProtected(world.sceneId, nowGameTimeMs));
    },

    _checkPortalWarnings(sceneId, hp) {
        const active = state.active;
        if (!active || active.targetWorld !== sceneId) return null;
        const maxHp = Math.max(1, Number(worldSystemConfig.portal?.maxHp) || 5000);
        const ratio = Math.max(0, Math.min(1, (Number(hp) || 0) / maxHp));
        const warning = portalWarningForRatio(ratio);
        const stage = Math.max(0, Math.floor(Number(warning?.stage) || 0));
        if (warning && stage > Math.max(0, Number(active.portalWarningStage) || 0)) {
            active.portalWarningStage = stage;
            const text = String(warning.text || '{world}传送门耐久告急')
                .replaceAll('{world}', worldName(sceneId));
            notify(text, warningColor(warning.severity));
        }
        return warning;
    },

    onWorldLoaded(sceneId, portalEntity, diamond) {
        liveWorldId = sceneId;
        this._livePortal = portalEntity || null;
        this._liveDiamond = diamond || null;
        if (state.active?.targetWorld === sceneId && portalEntity && !portalEntity._portalDestroyed
            && WorldProgressionSystem.isWorldEpochCurrent(sceneId, state.active.worldEpoch)) {
            this._attachLiveBattle();
        }
    },

    onWorldLeaving(sceneId) {
        if (liveWorldId !== sceneId) return;
        if (state.active?.targetWorld === sceneId) {
            const live = DefenseSystem.getManagedInvasionState?.();
            if (live?.wave > 0) state.active.waveIndex = live.wave;
            DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        }
        if (this._livePortal) {
            WorldProgressionSystem.syncPortalHp(sceneId, this._livePortal.hp, {
                expectedEpoch: this._livePortal._worldEpoch,
            });
        }
        liveWorldId = null;
        this._livePortal = null;
        this._liveDiamond = null;
    },

    _attachLiveBattle() {
        const active = state.active;
        if (!active || active.targetWorld !== liveWorldId || !this._livePortal) return;
        if (!WorldProgressionSystem.isWorldEpochCurrent(active.targetWorld, active.worldEpoch)
            || this._livePortal._worldEpoch !== active.worldEpoch) return;
        const token = { id: active.id, worldEpoch: active.worldEpoch };
        const cycle = Math.max(1, active.cycle || 1);
        DefenseSystem.beginManagedInvasion({
            waveCount: active.waveCount,
            startWave: active.waveIndex,
            waves: active.waves,
            spawnPoints: spawnPointsFor(this._liveDiamond),
            maxAlive: cfg.maxAlive || 60,
            waveBreakMs: cfg.waveBreakMs || 10000,
            hpPerWave: cfg.hpGrowthPerWave || 0.1,
            atkPerWave: cfg.atkGrowthPerWave || 0.06,
            cycleHpMul: 1 + Math.max(0, cycle - 1) * (cfg.hpGrowthPerCycle || 0.12),
            cycleAtkMul: 1 + Math.max(0, cycle - 1) * (cfg.atkGrowthPerCycle || 0.08),
        }, this._livePortal, (result) => this._resolveActive(result.victory, token));
    },

    _updateBackground(deltaMs) {
        const active = state.active;
        if (!active || !(deltaMs > 0)) return;
        if (!WorldProgressionSystem.isWorldEpochCurrent(active.targetWorld, active.worldEpoch)) {
            state.active = null;
            return;
        }
        const snapshot = getWorldSnapshot(active.targetWorld);
        const threat = waveThreat(active);
        const cycleMul = 1 + Math.max(0, active.cycle - 1) * (cfg.atkGrowthPerCycle || 0.08);
        const attackDps = threat * 6 * cycleMul;
        const defenders = defenseDps(snapshot, active.targetWorld, active.worldEpoch);
        const mitigation = Math.max(0.18, 1 - defenders / Math.max(1, threat * 28));
        const damage = attackDps * (cfg.backgroundContactRatio || 0.45) * mitigation * (deltaMs / 1000);
        const garrisonExposure = Math.max(0, Math.min(1, Number(cfg.backgroundGarrisonAbsorbRatio) || 0));
        const absorbed = TroopLineSystem.applyBackgroundAttrition(
            active.targetWorld,
            active.worldEpoch,
            damage * garrisonExposure
        );
        const hp = applyBackgroundDamage(
            snapshot,
            active.targetWorld,
            Math.max(0, damage - absorbed),
            active.worldEpoch
        );
        this._checkPortalWarnings(active.targetWorld, hp);
        if (hp <= 0) {
            this._resolveActive(false);
            return;
        }
        active.waveElapsedMs += deltaMs;
        // 无守军时怪物不会凭空被“后台清波”，会持续拆建筑直到传送门毁坏。
        if (defenders <= 0) return;
        const clearSeconds = Math.max(cfg.backgroundWaveSeconds || 35, threat * 180 / defenders);
        const waveMs = Math.min((cfg.backgroundWaveMaxSeconds || 180) * 1000, clearSeconds * 1000);
        if (active.waveElapsedMs < waveMs) return;
        active.waveElapsedMs = 0;
        if (active.waveIndex >= active.waveCount) this._resolveActive(true);
        else active.waveIndex++;
    },

    _resolveActive(victory, token = null) {
        const active = state.active;
        if (!active) return;
        if (token && (token.id !== active.id || token.worldEpoch !== active.worldEpoch)) return;
        if (!WorldProgressionSystem.isWorldEpochCurrent(active.targetWorld, active.worldEpoch)) {
            DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
            state.active = null;
            return;
        }
        const targetWorld = active.targetWorld;
        DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        if (!victory) {
            if (liveWorldId === targetWorld) {
                notify(`${worldName(targetWorld)}传送门已崩溃，正在紧急撤离`, '#ff3d3d');
            }
            if (!destroyWorldRecords(targetWorld, active.worldEpoch)) {
                state.active = null;
                return;
            }
            if (this._livePortal && liveWorldId === targetWorld) {
                this._livePortal.hp = 0;
                this._livePortal.hittable = false;
                this._livePortal._portalDestroyed = true;
            }
            notify(`💥 ${worldName(targetWorld)}传送门被摧毁，需要重建`, '#ff4444');
        } else {
            notify(`✓ ${worldName(targetWorld)}击退了本次入侵`, '#7fe0c8');
        }
        state.active = null;
    },

    onPortalDestroyed(sceneId, worldEpoch) {
        if (!WorldProgressionSystem.isWorldEpochCurrent(sceneId, worldEpoch)) return true;
        if (state.active?.targetWorld === sceneId && state.active.worldEpoch === worldEpoch) {
            this._resolveActive(false, { id: state.active.id, worldEpoch });
        } else {
            destroyWorldRecords(sceneId, worldEpoch);
        }
        return true;
    },

    getHudModel() {
        if (state.active) {
            const maxHp = Math.max(1, Number(worldSystemConfig.portal?.maxHp) || 5000);
            const portalHp = state.active.targetWorld === liveWorldId && this._livePortal
                ? Math.max(0, Number(this._livePortal.hp) || 0)
                : Math.max(0, Number(WorldProgressionSystem.getPortalState(state.active.targetWorld).hp) || 0);
            const portalHpRatio = Math.max(0, Math.min(1, portalHp / maxHp));
            const warning = portalWarningForRatio(portalHpRatio);
            const currentScene = typeof window !== 'undefined'
                ? window.SceneManager?.currentScene : null;
            const dungeonRunActive = typeof window !== 'undefined'
                && !!window.SceneManager?.isDungeonRunActive?.();
            return {
                active: true,
                progress: portalHpRatio,
                text: `入侵中 · ${worldName(state.active.targetWorld)} · 第${state.active.waveIndex}/${state.active.waveCount}波`,
                targetWorld: state.active.targetWorld,
                portalHp,
                portalMaxHp: maxHp,
                portalHpRatio,
                severity: warning?.severity || 'active',
                detail: `传送门 ${Math.ceil(portalHp)}/${maxHp}`,
                // 地牢出征期间可通过世界面板观察并指挥，但玩家本体仍留在地牢，不能转移支援。
                canSupport: !dungeonRunActive && currentScene !== state.active.targetWorld,
            };
        }
        const total = intervalMs();
        const progress = Math.max(0, Math.min(1, state.progressMs / total));
        const remain = Math.max(0, total - state.progressMs);
        const days = remain / dayDurationMs();
        return {
            active: false,
            progress,
            text: `距离入侵 ${days.toFixed(days < 1 ? 2 : 1)} 天`,
            remainingMs: remain,
        };
    },

    /** 顶部通用时间轴的五日袭击周期框架。 */
    getTimelineFrame() {
        const nowGameTimeMs = Math.max(0,
            Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
        const total = intervalMs();
        if (state.active) {
            return {
                nowGameTimeMs,
                startAtGameTimeMs: Math.max(0, nowGameTimeMs - total),
                endAtGameTimeMs: nowGameTimeMs,
                durationMs: total,
                progress: 1,
            };
        }
        const progressMs = Math.max(0, Math.min(total, state.progressMs));
        return {
            nowGameTimeMs,
            startAtGameTimeMs: Math.max(0, nowGameTimeMs - progressMs),
            endAtGameTimeMs: nowGameTimeMs + Math.max(0, total - progressMs),
            durationMs: total,
            progress: Math.max(0, Math.min(1, progressMs / total)),
        };
    },

    /** 袭击作为默认事件提供方；后续事件通过 WorldEventTimelineSystem 同接口接入。 */
    getTimelineEvents() {
        const frame = this.getTimelineFrame();
        if (state.active) {
            return [{
                id: state.active.id,
                type: 'invasion',
                icon: '⚔',
                iconPath: 'assets/ui/event-icons/invasion.png',
                label: `${worldName(state.active.targetWorld)} · 入侵`,
                atGameTimeMs: frame.nowGameTimeMs,
                status: 'active',
                sceneId: state.active.targetWorld,
            }];
        }
        return [{
            id: `invasion:next:${state.cycle + 1}`,
            type: 'invasion',
            icon: '⚔',
            iconPath: 'assets/ui/event-icons/invasion.png',
            label: '位面袭击',
            atGameTimeMs: frame.endAtGameTimeMs,
            status: 'upcoming',
        }];
    },

    getState() {
        return clone(state);
    },

    getDebugModel() {
        const nowGameTimeMs = Math.max(0,
            Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
        const candidates = this._getInvasionCandidates(nowGameTimeMs);
        const candidateIds = new Set(candidates.map((world) => world.sceneId));
        const worlds = WorldProgressionSystem.getWorldIds().map((sceneId) => {
            const worldCfg = WorldProgressionSystem.getWorldConfig(sceneId) || {};
            const portal = WorldProgressionSystem.getPortalState(sceneId);
            const protection = WorldProgressionSystem.getPortalProtection(sceneId, nowGameTimeMs);
            const generation = WorldProgressionSystem.getWorldGenerationContext(sceneId);
            const snapshot = getWorldSnapshot(sceneId);
            const requiredDungeons = Array.isArray(worldCfg.requirements?.completedDungeons)
                ? worldCfg.requirements.completedDungeons
                : [];
            return {
                sceneId,
                name: worldName(sceneId),
                status: portal.status,
                worldEpoch: portal.worldEpoch,
                hp: portal.hp,
                protected: protection.active,
                protectionRemainingMs: protection.remainingMs,
                candidate: candidateIds.has(sceneId),
                constructionEnabled: worldCfg.constructionEnabled !== false,
                requiredDungeons: requiredDungeons.map((dungeonType) => ({
                    dungeonType,
                    completed: WorldProgressionSystem.hasCompletedDungeon(dungeonType),
                })),
                generationVersion: generation.generationVersion,
                generationSeed: generation.seed,
                snapshot: snapshot ? {
                    exists: true,
                    worldEpoch: snapshot.worldEpoch || 0,
                    capturedGameTimeMs: snapshot.capturedGameTimeMs || 0,
                    structures: snapshot.structures?.length || 0,
                    units: (snapshot.structures || []).reduce((sum, structure) =>
                        sum + (Array.isArray(structure.unitRoster)
                            ? structure.unitRoster.length : Math.max(0, Number(structure.units) || 0)), 0),
                    resourceNodes: snapshot.nodes?.length || 0,
                    roads: snapshot.roads?.length || 0,
                } : { exists: false },
            };
        });
        return {
            version: VERSION,
            nowGameTimeMs,
            dayDurationMs: dayDurationMs(),
            cycle: state.cycle,
            progressMs: state.progressMs,
            active: state.active ? clone(state.active) : null,
            candidatePool: candidates.map((world) => world.sceneId),
            worlds,
        };
    },

    debugAdvanceDays(days, currentScene = (typeof window !== 'undefined'
        ? window.SceneManager?.currentScene : null)) {
        const safeDays = Math.max(0, Math.min(30, Number(days) || 0));
        const advancedMs = safeDays * dayDurationMs();
        EnvironmentLightingSystem.advanceTime(advancedMs);
        this.update(advancedMs, currentScene);
        return { ok: true, advancedMs, model: this.getDebugModel() };
    },

    /** 开发工具：按正式地牢成功结算入口补齐目标位面的全部地牢前置。 */
    debugCompleteWorldRequirements(sceneId) {
        const world = WorldProgressionSystem.getWorldConfig(sceneId);
        if (!world) return { ok: false, reason: '未知世界位面' };

        const portalBefore = WorldProgressionSystem.getPortalState(sceneId);
        if (portalBefore.constructed && !portalBefore.destroyed) {
            return { ok: true, changed: false, reason: '该位面已经接入传送网络', model: this.getDebugModel() };
        }
        if (world.constructionEnabled === false && !portalBefore.everConstructed) {
            return { ok: false, reason: '该位面配置尚未开放首次传送门构造' };
        }

        const required = Array.isArray(world.requirements?.completedDungeons)
            ? world.requirements.completedDungeons.filter(Boolean)
            : [];
        const completed = [];
        for (const dungeonType of required) {
            if (WorldProgressionSystem.hasCompletedDungeon(dungeonType)) continue;
            const grade = DungeonConfig.getDungeonGrade(dungeonType) || 'F';
            this.recordDungeonRun(dungeonType, grade, 'success');
            completed.push({ dungeonType, grade });
        }

        const portal = WorldProgressionSystem.getPortalState(sceneId);
        const constructable = WorldProgressionSystem.getConstructableWorlds()
            .some((entry) => entry.sceneId === sceneId);
        if (!constructable && !portal.constructed) {
            return {
                ok: false,
                reason: required.length ? '地牢前置已完成，但该位面当前仍不可构造' : '该位面没有可补齐的地牢前置',
                completed,
                model: this.getDebugModel(),
            };
        }
        return {
            ok: true,
            changed: completed.length > 0,
            completed,
            sceneId,
            portalStatus: portal.status,
            model: this.getDebugModel(),
        };
    },

    debugDestroyPortal(sceneId) {
        const portal = WorldProgressionSystem.getPortalState(sceneId);
        if (!portal.constructed || portal.destroyed) {
            return { ok: false, reason: '该位面当前没有可摧毁的传送门' };
        }
        const worldEpoch = portal.worldEpoch;
        const ok = this.onPortalDestroyed(sceneId, worldEpoch);
        return { ok: !!ok, sceneId, worldEpoch, model: this.getDebugModel() };
    },
};
