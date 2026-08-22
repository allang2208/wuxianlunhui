import { getTributeVisionRangeMul } from '../config/tribute-effects.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';

const FRIENDLY_FACTIONS = new Set(['player', 'companion', 'ally', 'friendly']);

const PROFILE_CONFIG_KEYS = Object.freeze({
    player: 'player',
    companion: 'companion',
    military: 'militaryUnit',
    scout: 'scout',
    cavalry: 'cavalry',
    portal: 'portal',
    troopProducer: 'troopProducer',
    defenseTower: 'defenseTower',
});

const PROFILE_DEFAULTS = Object.freeze({
    player: 1150,
    companion: 900,
    military: 720,
    scout: 1450,
    cavalry: 950,
    portal: 900,
    troopProducer: 650,
    defenseTower: 1200,
});

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inferProfile(entity, game) {
    if (!entity) return null;
    const explicit = entity.fogVisionProfile || entity.config?.fogVisionProfile;
    if (explicit === 'none') return null;
    if (explicit) return String(explicit);
    const faction = entity._faction || entity.faction;
    if (!FRIENDLY_FACTIONS.has(faction)) return null;
    if (entity === game?.player) return 'player';
    if (entity._isWorldPortalCore || entity._isMainHubPortalBuilding) return 'portal';
    if (entity._isDefenseTower) return 'defenseTower';
    if (entity._isTroopProducer || entity._isProducerBuilding
        || entity._isHamsterBarracks || entity._isHamsterHut) return 'troopProducer';
    if (entity._isHamsterScout) return 'scout';
    if (entity._isHamsterKnight || entity._isHamsterLightCavalry) return 'cavalry';
    if (entity._isFriendlyUnit || entity._isHamsterWarrior || entity._isHamsterShooter
        || entity._isHamsterGuard || entity._isHamsterMilitia || entity._isHamsterMusketeer
        || entity._isHamsterPriest || entity._isHamsterMiner) return 'military';
    return faction === 'companion' ? 'companion' : null;
}

/**
 * 当前前台位面的视野源注册表。
 * 实体表引用/数量变化时立即同步，平稳期每秒兜底校准一次；100ms 迷雾热循环只遍历有效源。
 */
export const VisionSourceRegistry = {
    _records: new Map(),
    _activeSources: new Set(),
    _lastEntityMap: null,
    _lastEntityCount: -1,
    _lastPartyCount: -1,
    _nextReconcileAt: 0,
    _lastGame: null,
    _sceneId: null,

    activateScene(sceneId) {
        if (this._sceneId !== sceneId) {
            this._records.clear();
            this._activeSources.clear();
            this._sceneId = sceneId || null;
            this._lastGame = null;
        }
        this.invalidate();
    },

    invalidate() {
        this._lastEntityMap = null;
        this._lastEntityCount = -1;
        this._lastPartyCount = -1;
        this._nextReconcileAt = 0;
    },

    register(entity, options = {}) {
        if (!entity) return null;
        const profile = options.profile || inferProfile(entity, this._lastGame);
        if (!profile) return null;
        const record = {
            entity,
            profile,
            radiusBonus: Number(options.radiusBonus) || 0,
            manual: options.manual !== false,
            sceneId: options.sceneId || this._sceneId,
        };
        this._records.set(entity, record);
        this._activeSources.add(entity);
        return {
            dispose: () => this.unregister(entity),
            update: (next = {}) => {
                if (next.profile) record.profile = next.profile;
                if (Number.isFinite(Number(next.radiusBonus))) record.radiusBonus = Number(next.radiusBonus);
            },
        };
    },

    unregister(entity) {
        this._activeSources.delete(entity);
        this._records.delete(entity);
    },

    _discover(entity, game, discovered) {
        const profile = inferProfile(entity, game);
        if (!profile) return;
        discovered.add(entity);
        const existing = this._records.get(entity);
        if (existing) {
            if (!existing.manual) existing.profile = profile;
            this._activeSources.add(entity);
            return;
        }
        this.register(entity, { profile, manual: false });
    },

    _reconcile(game, now) {
        this._lastGame = game || null;
        const discovered = new Set();
        const entities = game?.entities;
        if (entities && typeof entities.values === 'function') {
            for (const entity of entities.values()) this._discover(entity, game, discovered);
        }
        const playerMaterialized = game?.player && game?.entities?.get?.('player') === game.player;
        if (playerMaterialized) {
            for (const member of game?.PartySystem?.members || []) this._discover(member, game, discovered);
        }
        for (const [entity, record] of this._records) {
            if (!record.manual && !discovered.has(entity)) this.unregister(entity);
        }
        this._lastEntityMap = entities || null;
        this._lastEntityCount = entities?.size ?? 0;
        this._lastPartyCount = playerMaterialized ? (game?.PartySystem?.members?.length || 0) : 0;
        this._nextReconcileAt = now + 1000;
    },

    getSources(game, nowMs = Date.now(), options = {}) {
        const now = Number.isFinite(nowMs) ? nowMs : Date.now();
        const entities = game?.entities || null;
        const playerMaterialized = game?.player && entities?.get?.('player') === game.player;
        const partyCount = playerMaterialized ? (game?.PartySystem?.members?.length || 0) : 0;
        const needsReconcile = options.force
            || entities !== this._lastEntityMap
            || (entities?.size ?? 0) !== this._lastEntityCount
            || partyCount !== this._lastPartyCount
            || now >= this._nextReconcileAt;
        if (needsReconcile) this._reconcile(game, now);
        return this._activeSources;
    },

    profileOf(entity, game = this._lastGame) {
        return this._records.get(entity)?.profile || inferProfile(entity, game);
    },

    radiusOf(entity, visionConfig = {}, game = this._lastGame) {
        if (!entity || entity.active === false || (Number.isFinite(entity.hp) && entity.hp <= 0)) return 0;
        const record = this._records.get(entity);
        const profile = record?.profile || inferProfile(entity, game);
        if (!profile) return 0;
        const explicitRadius = Number(entity.fogSightRadius ?? entity.config?.fogSightRadius);
        const configKey = PROFILE_CONFIG_KEYS[profile] || profile;
        let radius = positiveNumber(explicitRadius,
            positiveNumber(visionConfig[configKey], PROFILE_DEFAULTS[profile] || 0));
        radius += record?.radiusBonus || 0;
        // 黄金星象仪（2026-08-22 工艺品祭品）：所有单位基础视野 ×N（visionRangePercent 实时聚合）
        radius *= getTributeVisionRangeMul();
        // 夜晚统一减半；使用环境光照的 daylight 真源，避免 UI 时钟与迷雾各自判断昼夜。
        radius *= EnvironmentLightingSystem.getVisionRangeMultiplier(visionConfig);
        if (radius > 0 && entity._surfaceKind === 'wall_walk') {
            radius *= positiveNumber(visionConfig.wallWalkMultiplier, 2);
        } else if (radius > 0 && entity._surfaceKind === 'stairs') {
            radius *= positiveNumber(visionConfig.stairsMultiplier, 1.2);
        }
        return Math.max(0, radius);
    },

    describe(visionConfig = {}) {
        const result = [];
        for (const entity of this._activeSources) {
            const record = this._records.get(entity);
            if (record?.sceneId && record.sceneId !== this._sceneId) continue;
            const radius = this.radiusOf(entity, visionConfig);
            if (radius <= 0 || !Number.isFinite(Number(entity.x)) || !Number.isFinite(Number(entity.y))) continue;
            result.push({
                id: entity.id || entity.name || 'vision-source',
                name: entity.name || entity.id || '视野源',
                profile: this.profileOf(entity),
                x: Number(entity.x),
                y: Number(entity.y),
                radius,
            });
        }
        return result;
    },
};

export default VisionSourceRegistry;
