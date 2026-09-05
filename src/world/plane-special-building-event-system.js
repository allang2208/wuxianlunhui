// 位面一次性随机事件：夺取特色建筑控制权。
// 正式完成状态由 WorldProgressionSystem 持久化；测试直连与临时预览只写会话态副本。
import enemyConfigData from '../../data/enemy-config.json';
import { CONFIG } from '../config/config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { TopNotificationQueue } from '../ui/top-notification-queue.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';
import { BuildingRoadSystem } from './building-road-system.js';
import { BuildingSystem } from './building-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import {
    ProducerBuilding, ProducerBuildingSystem, getProducerConfig,
} from './producer-building-system.js';
import { isSpawnPositionFree } from './spawn-placement.js';
import { TechnologySystem } from './technology-system.js';
import { WallSystem } from './wall-system.js';
import { WorldProgressionSystem } from './world-progression-system.js';
import { ZOMBIE_FACTORY_MAP } from './zombie-dungeon.js';

const RUNTIME_SCENE_IDS = new Set(['scene8', 'scene9', 'scene10', 'scene11', 'scene12']);
const runtime = {
    token: 0,
    sceneId: null,
    eventId: null,
    worldEpoch: 0,
    building: null,
    enemyIds: new Set(),
    spawnPending: false,
    spawnSucceeded: false,
    completionHandled: false,
};

const game = () => (typeof window !== 'undefined' ? window.Game : null);
const alive = (entity) => !!entity && entity.active !== false
    && Math.max(Number(entity.hp) || 0, Number(entity.data?.hp) || 0) > 0;

function applyNeutralState(building, event) {
    if (!building) return null;
    building._planeFeatureEventId = event.eventId;
    building._planeFeatureWorldId = event.sceneId;
    building._planeFeatureNeutral = true;
    building._builtByPlayer = false;
    building._planeFeatureOriginalSpawnEnabled = building._planeFeatureOriginalSpawnEnabled
        ?? building.spawnEnabled;
    building.spawnEnabled = false;
    building._faction = 'neutral';
    building.hittable = false;
    building.name = `中立·${getProducerConfig(event.cfgKey)?.name || building.name}`;
    return building;
}

function applyPlayerState(building, event) {
    if (!building) return null;
    const cfg = getProducerConfig(event.cfgKey) || {};
    building._planeFeatureEventId = event.eventId;
    building._planeFeatureWorldId = event.sceneId;
    building._planeFeatureNeutral = false;
    building._builtByPlayer = true;
    building._faction = 'player';
    building.hittable = true;
    building.name = cfg.name || building.name;
    building.spawnEnabled = building._planeFeatureOriginalSpawnEnabled ?? cfg.spawnEnabled !== false;
    building._isTroopProducer = building.spawnEnabled
        && (cfg.unitTypes || []).some((unit) => !!unit?.key);
    return building;
}

function findEventBuilding(event) {
    const matches = (ProducerBuildingSystem.buildings || []).filter((building) =>
        building?.active !== false && building.cfgKey === event.cfgKey);
    return matches.find((building) => building._planeFeatureEventId === event.eventId)
        // 兼容旧版首次接通免费赠送的 0 成本特色建筑。
        || matches.find((building) => Number(building._buildCost) === 0)
        || null;
}

function placementCandidates(event, portal) {
    const random = WorldProgressionSystem.createWorldRandom(
        event.sceneId, `special-building-event:${event.eventId}:${event.attempts}`
    );
    const start = random() * Math.PI * 2;
    const candidates = [];
    for (const radius of [1050, 1250, 1500, 1800, 2100, 2400]) {
        for (let side = 0; side < 20; side++) {
            const angle = start + side * Math.PI / 10;
            candidates.push({
                x: portal.x + Math.cos(angle) * radius,
                y: portal.y + Math.sin(angle) * radius * 0.58,
            });
        }
    }
    return candidates;
}

function createEventBuilding(event) {
    const current = game();
    if (!current?.entities) return null;
    const portal = (ProducerBuildingSystem.buildings || []).find((building) =>
        building?._isWorldPortalCore && building._worldId === event.sceneId);
    if (!portal) return null;
    const avoid = (ProducerBuildingSystem.buildings || []).filter((building) =>
        building === portal || building?._isPlayerBase);
    const point = BuildingSystem.findAutomaticProducerPlacement(
        event.cfgKey, placementCandidates(event, portal), { avoid }
    );
    if (!point) return null;
    const building = new ProducerBuilding(point.x, point.y, {
        id: `plane_feature_event_${event.sceneId}_${event.worldEpoch}`,
        cfgKey: event.cfgKey,
    });
    building._builtByPlayer = true;
    building._buildCost = 0;
    building._buildCurrency = 'gold';
    building._worldId = event.sceneId;
    building._worldEpoch = event.worldEpoch;
    applyNeutralState(building, event);
    current.entities.set(building.id, building);
    ProducerBuildingSystem.buildings.push(building);
    if (!BuildingRoadSystem.attach(building, { allowOverlap: true, kind: 'road' })) {
        current.entities.delete(building.id);
        ProducerBuildingSystem.buildings.splice(ProducerBuildingSystem.buildings.indexOf(building), 1);
        building.active = false;
        return null;
    }
    const clearZones = (building._buildingRoadLayout?.reservationCells || []).map((cell) => ({
        x: cell.x, y: cell.y, radius: 54,
    }));
    WallSystem.removeScatterObstaclesInZones?.(clearZones);
    const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
    if (scene?.eraseDecoBatch) scene.eraseDecoBatch(clearZones);
    else for (const zone of clearZones) scene?.eraseDecoAt?.(zone.x, zone.y, zone.radius);
    RuntimeAssetManager.ensureBuildingEntities([building], { required: false })
        .then(() => RuntimeAssetManager.commitBuildingEntities([building]))
        .catch((error) => console.warn('[PlaneFeatureEvent] 特色建筑贴图准备失败:', error));
    return building;
}

function rankPool(event, rank) {
    const types = DungeonConfig.getDungeonEnemyPreloadTypes(event.sourceDungeonType);
    const available = types.filter((type) =>
        ZOMBIE_FACTORY_MAP[type] && !enemyConfigData[type]?.noPool);
    if (rank === 'lord') {
        const lords = available.filter((type) => enemyConfigData[type]?.rank === 'lord');
        return lords.length ? lords
            : available.filter((type) => enemyConfigData[type]?.rank === 'boss');
    }
    return available.filter((type) => {
        const configuredRank = enemyConfigData[type]?.rank || 'normal';
        if (rank === 'elite') return configuredRank === 'elite';
        return !['elite', 'lord', 'boss'].includes(configuredRank);
    });
}

function chooseRoster(event) {
    const composition = event.enemyComposition || {};
    const random = WorldProgressionSystem.createWorldRandom(
        event.sceneId, `special-building-guard:${event.eventId}:${event.attempts}`
    );
    const roster = [];
    for (const rank of ['lord', 'elite', 'normal']) {
        const pool = rankPool(event, rank);
        const count = Math.max(0, Math.floor(Number(composition[rank]) || 0));
        if (!pool.length && count > 0) {
            throw new Error(`${event.sourceDungeonType} 缺少 ${rank} 守军池`);
        }
        for (let index = 0; index < count; index++) {
            roster.push({ rank, type: pool[Math.floor(random() * pool.length)] });
        }
    }
    return roster;
}

function monsterPoint(building, monster, index, total, random, used) {
    const radius = Math.max(24, Number(monster.groundRadius)
        || Number(monster.collisionRadius) || 36);
    const baseAngle = random() * Math.PI * 2 + index * Math.PI * 2 / Math.max(1, total);
    for (const ring of [520, 650, 790, 930]) {
        for (let step = 0; step < 12; step++) {
            const angle = baseAngle + step * Math.PI / 6;
            const x = building.x + Math.cos(angle) * ring;
            const y = building.y + Math.sin(angle) * ring * 0.58;
            if (x < 96 || y < 96 || x > CONFIG.WORLD_WIDTH - 96 || y > CONFIG.WORLD_HEIGHT - 96) continue;
            if (used.some((spot) => Math.hypot(x - spot.x, (y - spot.y) / 0.5774)
                < radius + spot.radius + 16)) continue;
            if (isSpawnPositionFree(x, y, radius, {
                entities: game()?.entities,
                wallSystem: WallSystem,
                checkReservation: false,
            })) return { x, y, radius };
        }
    }
    return null;
}

async function spawnGuards(event, building, token) {
    runtime.spawnPending = true;
    const created = [];
    try {
        const roster = chooseRoster(event);
        RuntimeAssetManager.validateEnemyTypes(roster.map((entry) => entry.type), { required: true });
        await RuntimeAssetManager.prefetchEnemyTypes(roster.map((entry) => entry.type), { required: true });
        if (token !== runtime.token || runtime.sceneId !== event.sceneId) return;
        const current = game();
        if (!current?.entities) return;
        const random = WorldProgressionSystem.createWorldRandom(
            event.sceneId, `special-building-spawn:${event.eventId}:${event.attempts}`
        );
        const used = [];
        for (let index = 0; index < roster.length; index++) {
            const record = roster[index];
            const monster = ZOMBIE_FACTORY_MAP[record.type]?.(building.x, building.y);
            if (!monster) throw new Error(`怪物工厂未返回实体：${record.type}`);
            const point = monsterPoint(building, monster, index, roster.length, random, used);
            if (!point) throw new Error(`特色建筑周边缺少守军落点：${record.type}`);
            monster.x = point.x;
            monster.y = point.y;
            monster.collider?.syncPosition?.();
            monster.id = `plane_feature_guard_${event.sceneId}_${event.attempts}_${index}_${record.type}`;
            monster._planeFeatureEventEnemy = true;
            monster._planeFeatureEventId = event.eventId;
            monster._planeFeatureWorldId = event.sceneId;
            monster._noGoldDrop = true;
            monster._defenseMonster = true;
            current.entities.set(monster.id, monster);
            runtime.enemyIds.add(monster.id);
            created.push(monster);
            used.push(point);
        }
        await RuntimeAssetManager.ensureEnemyEntities(created, { required: true });
        if (token !== runtime.token || runtime.sceneId !== event.sceneId) return;
        RuntimeAssetManager.commitEnemyEntities(created);
        runtime.spawnSucceeded = created.length === roster.length && created.length > 0;
        TopNotificationQueue.show(
            `❓ 随机事件：${event.name}。守军已集结（领主×${event.enemyComposition.lord || 0}、精英×${event.enemyComposition.elite || 0}、普通×${event.enemyComposition.normal || 0}）。`,
            { tone: 'warning', duration: 7200 }
        );
    } catch (error) {
        const current = game();
        for (const monster of created) {
            current?.entities?.delete(monster.id);
            monster._destroyCustomEffects?.();
            monster._phaserSprite?.destroy?.();
            monster.active = false;
        }
        if (token === runtime.token) {
            runtime.enemyIds.clear();
            runtime.spawnSucceeded = false;
        }
        console.error('[PlaneFeatureEvent] 守军生成失败:', error);
        TopNotificationQueue.show('特色建筑事件生成失败，本次不会误判完成；重新进入该位面后会再次尝试。', {
            tone: 'warning', duration: 6500,
        });
    } finally {
        if (token === runtime.token) runtime.spawnPending = false;
    }
}

function captureEvent() {
    if (runtime.completionHandled || !runtime.spawnSucceeded) return;
    const event = WorldProgressionSystem.getSpecialBuildingEvent(runtime.sceneId);
    if (!event || event.eventId !== runtime.eventId || event.status === 'completed') return;
    const completed = WorldProgressionSystem.completeSpecialBuildingEvent(
        runtime.sceneId, runtime.worldEpoch
    );
    if (!completed) return;
    runtime.completionHandled = true;
    applyPlayerState(runtime.building, completed);
    TechnologySystem.notifyWorldRequirementChanged();
    const suffix = completed.testOnly
        ? '测试位面仅记录本次运行，不写入正式科技进度。'
        : '对应位面特色科技树已解除研究门槛。';
    TopNotificationQueue.show(`✅ 已夺取${runtime.building?.name || '特色建筑'}控制权！${suffix}`, {
        tone: 'success', duration: 7500,
    });
    if (runtime.building) {
        EffectManager.add(new FloatingTextEffect(
            runtime.building.x, runtime.building.y - 90, '控制权已夺取', '#7fd9a6'
        ));
    }
}

export const PlaneSpecialBuildingEventSystem = {
    enterWorld(sceneId, { observer = false, questInstance = false } = {}) {
        this.leaveWorld();
        const runtimeSceneId = WorldProgressionSystem.getRuntimeSceneId(sceneId);
        if (!RUNTIME_SCENE_IDS.has(runtimeSceneId) || observer || questInstance) return null;
        let event = WorldProgressionSystem.getSpecialBuildingEvent(sceneId);
        if (!event) return null;
        let building = findEventBuilding(event);
        if (event.status === 'completed') {
            if (building?._planeFeatureNeutral) applyPlayerState(building, event);
            return event;
        }
        event = WorldProgressionSystem.activateSpecialBuildingEvent(sceneId);
        if (!event) return null;
        building = building || createEventBuilding(event);
        if (!building) {
            TopNotificationQueue.show('本位面暂时找不到可容纳特色建筑及道路的空地；整理空间后重新进入会再次生成。', {
                tone: 'warning', duration: 6500,
            });
            return event;
        }
        applyNeutralState(building, event);
        runtime.sceneId = sceneId;
        runtime.eventId = event.eventId;
        runtime.worldEpoch = WorldProgressionSystem.getWorldEpoch(sceneId);
        runtime.building = building;
        runtime.enemyIds = new Set();
        runtime.spawnPending = false;
        runtime.spawnSucceeded = false;
        runtime.completionHandled = false;
        const token = ++runtime.token;
        void spawnGuards(event, building, token);
        return event;
    },

    update(sceneId) {
        if (sceneId !== runtime.sceneId || runtime.spawnPending
            || !runtime.spawnSucceeded || runtime.completionHandled) return;
        const current = game();
        if (!current?.entities || runtime.enemyIds.size === 0) return;
        for (const id of runtime.enemyIds) {
            if (alive(current.entities.get(id))) return;
        }
        captureEvent();
    },

    leaveWorld(sceneId = null) {
        if (sceneId && runtime.sceneId && sceneId !== runtime.sceneId) return;
        runtime.token++;
        runtime.sceneId = null;
        runtime.eventId = null;
        runtime.worldEpoch = 0;
        runtime.building = null;
        runtime.enemyIds = new Set();
        runtime.spawnPending = false;
        runtime.spawnSucceeded = false;
        runtime.completionHandled = false;
    },
};
