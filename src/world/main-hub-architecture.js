import { Entity } from '../entities/entity.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { setupStructureDepth } from './structure-depth.js';

const finite = (value, fallback = 0) => (
    Number.isFinite(Number(value)) ? Number(value) : fallback
);

function diamondFootprint(width, depth, frontOffsetY = 0) {
    const halfW = Math.max(1, finite(width, 1)) * 0.5;
    const fullD = Math.max(1, finite(depth, 1));
    const frontY = finite(frontOffsetY, 0);
    return [
        { key: 'back', x: 0, y: frontY - fullD },
        { key: 'right', x: halfW, y: frontY - fullD * 0.5 },
        { key: 'front', x: 0, y: frontY },
        { key: 'left', x: -halfW, y: frontY - fullD * 0.5 },
    ];
}

function rotatedShadowCaster(source, degrees) {
    if (!source) return undefined;
    const cloned = JSON.parse(JSON.stringify(source));
    const angle = finite(degrees) * Math.PI / 180;
    if (Math.abs(angle) < 1e-6) return cloned;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rotate = (point) => [
        finite(point?.[0]) * c - finite(point?.[1]) * s,
        finite(point?.[0]) * s + finite(point?.[1]) * c,
    ];
    if (Array.isArray(cloned.contactPolygon)) {
        cloned.contactPolygon = cloned.contactPolygon.map(rotate);
    }
    if (Array.isArray(cloned.parts)) {
        cloned.parts = cloned.parts.map((part) => ({
            ...part,
            polygon: Array.isArray(part.polygon) ? part.polygon.map(rotate) : part.polygon,
        }));
    }
    return cloned;
}

class MainHubGroundOverlay extends Entity {
    constructor(definition, version) {
        super(finite(definition.x), finite(definition.y));
        this.id = 'main_hub_arch_ground';
        this.name = '';
        this._isMainHubArchitecture = true;
        this._mainHubArchitectureVersion = version;
        this._mainHubGroundOverlay = true;
        this._mainHubUnderlay = true;
        this.noCollision = true;
        this._noShadow = true;
        // Ground overlays use their world coordinate as the Sprite center.  They
        // do not enter structure auto-anchoring, so keep this on the entity too.
        this.footOffsetY = 0;
        this.spriteCfg = {
            idleKey: definition.textureKey,
            size: finite(definition.displayW, 3072),
            sizeH: finite(definition.displayH, 1920),
            footOffsetY: 0,
            depthMode: 'ground',
        };
    }
}

class MainHubOccluderLayer extends Entity {
    constructor(definition, version) {
        const depthY = finite(definition.depthY, definition.screenCenterY);
        super(finite(definition.screenCenterX), depthY);
        this.id = `main_hub_arch_occluder_${definition.id}`;
        this.name = '';
        this._isMainHubArchitecture = true;
        this._isMainHubArchitectureOccluder = true;
        this._mainHubArchitectureVersion = version;
        this.noCollision = true;
        this.noSeparation = true;
        this.hittable = false;
        this._noShadow = true;
        // The crop center and the sorting depth are intentionally independent.
        // Every layer came from the same locked render, while depthY says which
        // units/buildings it is allowed to cover at runtime.
        this.footOffsetY = depthY - finite(definition.screenCenterY, depthY);
        this.spriteCfg = {
            idleKey: definition.textureKey,
            size: finite(definition.displayW, 128),
            sizeH: finite(definition.displayH, definition.displayW),
            footOffsetY: this.footOffsetY,
        };
    }
}

class MainHubArchitecturePiece extends Entity {
    constructor(definition, placement, index, version) {
        super(finite(placement.x), finite(placement.y));
        const suffix = placement.id || String(index + 1).padStart(2, '0');
        this.id = `main_hub_arch_${definition.id}_${suffix}`;
        this.name = '';
        this._isMainHubArchitecture = true;
        this._mainHubArchitectureVersion = version;
        this._isGridBuilding = true;
        // A shadow-only proxy supplies low-frequency building geometry to the
        // existing sun-shadow system.  It must never become a second visual or
        // occupancy obstacle on top of the authored collision proxies.
        this._civilianBlocksVisuals = definition.shadowOnly !== true;
        this._facingLeft = placement.flipX === true;
        this.noCollision = true;
        this.noSeparation = true;
        this.hittable = false;
        this._noShadow = true;

        const footprintW = finite(definition.footprintW, definition.displayW);
        const footprintD = finite(definition.footprintD, footprintW * 0.5);
        this.collisionShape = 'iso_rect';
        this.collisionWidth = footprintW;
        this.collisionHeight = footprintD;
        this.collisionRadius = Math.max(1, footprintW * 0.5);
        this.colliderOffsetX = 0;
        this.colliderOffsetY = -footprintD * 0.5;
        this._pixelFootprintLocal = diamondFootprint(footprintW, footprintD);
        this.spriteCfg = {
            idleKey: definition.textureKey,
            size: finite(definition.displayW, 128),
            sizeH: finite(definition.displayH, definition.displayW),
            footOffsetY: finite(definition.footOffsetY, definition.displayH * 0.5),
            rotation: finite(placement.rotation, 0),
            autoFootprint: false,
        };
        if (definition.visualFootprint) {
            this.spriteCfg.visualFootprint = {
                ...definition.visualFootprint,
                scaleMode: definition.visualFootprint.scaleMode === 'uniform'
                    ? 'uniform' : 'strict',
            };
        }
        this.shadowCaster = rotatedShadowCaster(
            placement.shadowCaster || definition.shadowCaster,
            placement.rotation
        );
        setupStructureDepth(this);
        this.rebuildCollider();
    }
}

class MainHubCollisionProxy extends Entity {
    constructor(definition, version) {
        super(finite(definition.x), finite(definition.y));
        this.id = `main_hub_arch_collision_${definition.id}`;
        this.name = '';
        this._isMainHubArchitecture = true;
        this._mainHubArchitectureVersion = version;
        this._mainHubCollisionProxy = true;
        this._skipNeutralSprite = true;
        this._noShadow = true;
        this.noSeparation = true;
        this.hittable = false;
        this.size = 0;
        const sourceShape = definition.shape === 'circle' ? 'circle' : 'rect';
        // Use the existing arbitrary-polygon iso footprint path even for these
        // camera-aligned proxies. That keeps player separation and A* on one
        // obstacle truth instead of letting NPCs plan through pools or rails.
        this.collisionShape = 'iso_rect';
        if (sourceShape === 'circle') {
            const radius = Math.max(1, finite(definition.radius, 16));
            this.collisionWidth = radius * 2;
            this.collisionHeight = radius;
            this.collisionRadius = radius;
            this._pixelFootprintLocal = Array.from({ length: 16 }, (_, index) => {
                const angle = index * Math.PI * 2 / 16;
                return {
                    x: Math.cos(angle) * radius,
                    y: Math.sin(angle) * radius * 0.5,
                };
            });
        } else {
            this.collisionWidth = Math.max(1, finite(definition.width, 16));
            this.collisionHeight = Math.max(1, finite(definition.height, 16));
            const halfW = this.collisionWidth * 0.5;
            const halfH = this.collisionHeight * 0.5;
            this.collisionRadius = Math.hypot(halfW, halfH * 2);
            this._pixelFootprintLocal = [
                { x: -halfW, y: -halfH },
                { x: halfW, y: -halfH },
                { x: halfW, y: halfH },
                { x: -halfW, y: halfH },
            ];
        }
        this.rebuildCollider();
    }
}

function upsert(game, id, version, create) {
    const existing = game.entities.get(id);
    if (existing?.active && existing._isMainHubArchitecture
        && existing._mainHubArchitectureVersion === version) return existing;
    if (existing?._isMainHubArchitecture) existing.active = false;
    const entity = create();
    game.entities.set(id, entity);
    return entity;
}

function collisionDefinitionsFor(definition, placement, index) {
    const contract = definition?.collision;
    if (!contract || contract.type === 'none') return [];
    const suffix = placement.id || String(index + 1).padStart(2, '0');
    const baseId = `${definition.id}_${suffix}`;
    const baseX = finite(placement.x);
    const baseY = finite(placement.y);
    const make = (id, values) => ({ id: `${baseId}_${id}`, ...values });
    if (contract.type === 'circle') {
        return [make('body', {
            shape: 'circle',
            x: baseX + finite(contract.offsetX),
            y: baseY + finite(contract.offsetY),
            radius: finite(contract.radius, 16),
        })];
    }
    if (contract.type === 'rect') {
        const quarterTurn = Math.abs(finite(placement.rotation)) % 180 === 90;
        return [make('body', {
            shape: 'rect',
            x: baseX + finite(contract.offsetX),
            y: baseY + finite(contract.offsetY),
            width: quarterTurn ? finite(contract.height, 16) : finite(contract.width, 16),
            height: quarterTurn ? finite(contract.width, 16) : finite(contract.height, 16),
        })];
    }
    if (contract.type === 'multi_rect') {
        return (contract.parts || []).map((part, partIndex) => make(
            part.id || `part_${partIndex + 1}`,
            {
                shape: 'rect',
                x: baseX + finite(part.offsetX),
                y: baseY + finite(part.offsetY),
                width: finite(part.width, 16),
                height: finite(part.height, 16),
            }
        ));
    }
    if (contract.type === 'ring') {
        const count = Math.max(3, Math.floor(finite(contract.count, 8)));
        const radiusX = finite(contract.radiusX, 64);
        const radiusY = finite(contract.radiusY, radiusX * 0.5);
        return Array.from({ length: count }, (_, ringIndex) => {
            const angle = -Math.PI * 0.5 + ringIndex * Math.PI * 2 / count;
            return make(`column_${ringIndex + 1}`, {
                shape: 'circle',
                x: baseX + Math.cos(angle) * radiusX,
                y: baseY + finite(contract.offsetY) + Math.sin(angle) * radiusY,
                radius: finite(contract.columnRadius, 16),
            });
        });
    }
    return [];
}

/**
 * Idempotently materialize the approved main-hub layout. Visual bodies, the fixed
 * ground overlay and invisible collision proxies are separate so the central
 * stair, rotunda interiors and service approaches stay genuinely walkable.
 */
export function ensureMainHubArchitecture(game) {
    const config = GAME_CONFIG.scenes?.mainHub?.architecture;
    if (!game?.entities) return [];
    if (config?.enabled !== true) {
        for (const [id, entity] of Array.from(game.entities.entries())) {
            if (!entity?._isMainHubArchitecture) continue;
            entity.active = false;
            game.entities.delete(id);
        }
        return [];
    }
    const version = finite(config.version, 1);
    const activeIds = new Set();
    const created = [];

    const underlay = config.underlay || config.ground;
    if (underlay?.textureKey) {
        const id = 'main_hub_arch_ground';
        activeIds.add(id);
        created.push(upsert(game, id, version,
            () => new MainHubGroundOverlay(underlay, version)));
    }

    for (const definition of config.occluders || []) {
        if (!definition?.id || !definition.textureKey) continue;
        const id = `main_hub_arch_occluder_${definition.id}`;
        activeIds.add(id);
        created.push(upsert(game, id, version,
            () => new MainHubOccluderLayer(definition, version)));
    }

    const derivedCollisionProxies = [];
    for (const definition of config.pieces || []) {
        if (!definition?.id || !definition.textureKey) continue;
        const placements = Array.isArray(definition.placements)
            ? definition.placements : [];
        placements.forEach((placement, index) => {
            const suffix = placement.id || String(index + 1).padStart(2, '0');
            const id = `main_hub_arch_${definition.id}_${suffix}`;
            activeIds.add(id);
            created.push(upsert(game, id, version,
                () => new MainHubArchitecturePiece(
                    definition, placement, index, version)));
            derivedCollisionProxies.push(
                ...collisionDefinitionsFor(definition, placement, index));
        });
    }

    for (const definition of [
        ...derivedCollisionProxies,
        ...(config.collisionProxies || []),
    ]) {
        if (!definition?.id) continue;
        const id = `main_hub_arch_collision_${definition.id}`;
        activeIds.add(id);
        created.push(upsert(game, id, version,
            () => new MainHubCollisionProxy(definition, version)));
    }

    for (const [id, entity] of Array.from(game.entities.entries())) {
        if (!entity?._isMainHubArchitecture || activeIds.has(id)) continue;
        entity.active = false;
        game.entities.delete(id);
    }
    return created;
}

export function getMainHubArchitectureTextureEntries() {
    const mainHub = GAME_CONFIG.scenes?.mainHub;
    const config = mainHub?.architecture;
    const entries = [];
    const backdrop = mainHub?.backdrop;
    if (backdrop?.enabled === true && backdrop.textureKey && backdrop.assetPath) {
        entries.push({ key: backdrop.textureKey, path: backdrop.assetPath });
    }
    if (config?.enabled !== true) return entries;
    const underlay = config?.underlay || config?.ground;
    if (underlay?.textureKey && underlay.assetPath) {
        entries.push({ key: underlay.textureKey, path: underlay.assetPath });
    }
    for (const definition of config?.occluders || []) {
        if (definition?.textureKey && definition.assetPath) {
            entries.push({ key: definition.textureKey, path: definition.assetPath });
        }
    }
    for (const definition of config?.pieces || []) {
        if (definition?.textureKey && definition.assetPath) {
            entries.push({ key: definition.textureKey, path: definition.assetPath });
        }
    }
    return [...new Map(entries.map((entry) => [entry.key, entry])).values()];
}
