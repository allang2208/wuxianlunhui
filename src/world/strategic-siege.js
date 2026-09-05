import config from '../../data/world-strategy.json';
import { Game } from '../game.js';
import { DefenseCover, BuildableGate, WallStaircase, DefenseSystem, blockWallTopWalkGeometry,
    WALL_STAIR_CONFIG, WALL_WALK_CONFIG, getWallStairVariant } from './defense-system.js';
import { BLOCK_GRID, blockCellOf, blockCellCenter } from './gate4-grid.js';
import { pointInIsoFootprint } from '../physics/iso-footprint.js';
import { ProducerBuilding, getProducerConfig } from './producer-building-system.js';
import { buildingRoadLayout } from './building-road-system.js';
import { DamageableEntity } from '../entities/damageable-entity.js';

// Reuse the real wall-tower footprint, top nodes, foreground layer and collapse hooks.
// Keep it out of player production/upgrade lists and never run the producer update loop.
function createStrategicWallTower(point, id, tier, hp) {
    // Defer inheritance until battle creation: Game and producer modules import one another.
    class StrategicWallTower extends ProducerBuilding {
        constructor() {
            super(point.x, point.y, { id, cfgKey: 'wall_tower', hp, maxHp: tier.hp });
            this._strategicFortification = true;
            this._isEnemyEntity = false;
            this._faction = 'enemy';
            this._noGoldDrop = true;
            this._applyBuildingTierVisual(tier);
            this.level = tier.level;
            this.hp = hp; this.maxHp = tier.hp;
            this.def = tier.def; this.mdef = tier.mdef;
            this.name = '敌方城角塔楼';
            this.data.name = this.name;
            this.spawnEnabled = false;
        }

        update(dt) {
            if (!this.active || this._sinking) return;
            DamageableEntity.prototype.update.call(this, dt);
        }

        destroy() {
            this.active = false;
            this._removeWallTowerSupport();
            this._destroyCleanup({ silent: true });
        }
    }
    return new StrategicWallTower();
}

// Battlefield-only town construction. Never register in player production/build lists.
export class StrategicSiege {
    constructor(site, center) {
        this.site = site;
        this.preset = config.siege.presets[site.kind];
        this.origin = blockCellOf(center.x, center.y);
        this.parts = [];
        this.staircases = [];
        const towerConfig = this.preset.cornerTowers ? getProducerConfig('wall_tower') : null;
        this.towerTier = towerConfig?.buildingTiers.find((tier) => tier.level === this.preset.cornerTowers.tier);
        this.towerVisual = towerConfig ? { ...towerConfig, ...this.towerTier.visual } : null;
        this.towerSlots = (this.preset.cornerTowers?.positions || []).map((slot) => {
            const rearCell = this.point(slot);
            // Native 2x2 buildings use the front vertex, 96px below their rear cell center.
            const anchor = { x: rearCell.x, y: rearCell.y + 96 };
            const cells = buildingRoadLayout(anchor.x, anchor.y, 2).buildingCells;
            return { ...slot, anchor, cells, position: {
                ...this.point({ i: slot.i + 0.5, j: slot.j + 0.5 }),
                i: Math.sign(slot.i + 0.5) * this.preset.halfI,
                j: Math.sign(slot.j + 0.5) * this.preset.halfJ,
            } };
        });
        this.towerCoveredWalls = new Set(this.towerSlots.flatMap((slot) => slot.cells.map((cell) =>
            `wall_${cell.i - this.origin[0]}_${cell.j - this.origin[1]}`)));
        this.posts = this.preset.posts.map((post) => ({ ...post, ...this.point(post) }));
        this.rally = this.point(this.preset.rally);
    }

    point({ i, j }) {
        const [x, y] = blockCellCenter(this.origin[0] + i, this.origin[1] + j);
        return { x, y };
    }

    structurePoint(key) {
        return this.point(this.preset.facilities[key] || this.preset.facilities.core);
    }

    containsSpawn(x, y, radius = 36) {
        const center = this.point({ i: 0, j: 0 });
        const u = (x - center.x) / 64, v = (y - center.y) / 32;
        return Math.abs((u + v) / 2) < this.preset.halfI - 1.5
            && Math.abs((v - u) / 2) < this.preset.halfJ - 1.5
            && !this.isStairAccessReserved({ x, y }, radius);
    }

    build() {
        const { halfI, halfJ, gateJ, wallHp, gateHp, wallTexture } = this.preset;
        const textures = window.__phaserScene?.textures;
        if (!textures?.exists(wallTexture) || !textures.exists('cover_gate_D') || !textures.exists('cover_gate_D_bars')) {
            throw new Error('攻城城防素材尚未就绪');
        }
        for (const stair of this.preset.stairs) {
            const variant = getWallStairVariant(stair.dir, stair.ascendingSign);
            if (!['lower', 'upper'].every((part) => textures.exists(`${variant[part].texture}_${this.preset.stairTextureSuffix}`))) {
                throw new Error('攻城楼梯素材尚未就绪');
            }
        }
        if (this.towerVisual && (!textures.exists(this.towerVisual.tex)
            || !textures.exists(this.towerVisual.foregroundOverlay.textureKey))) {
            throw new Error('攻城塔楼素材尚未就绪');
        }
        for (let i = -halfI; i <= halfI; i++) {
            for (let j = -halfJ; j <= halfJ; j++) {
                if (i !== -halfI && i !== halfI && j !== -halfJ && j !== halfJ) continue;
                // The two middle cells belong to the existing four-cell gate; end pillars are walls.
                if (i === -halfI && (j === gateJ || j === gateJ + 1)) continue;
                if (this.towerCoveredWalls.has(`wall_${i}_${j}`)) continue;
                this._create(`wall_${i}_${j}`, wallHp, this.point({ i, j }), false,
                    i === -halfI || i === halfI ? 'v' : 'h');
            }
        }
        this._create('gate', gateHp, this.point({ i: -halfI, j: gateJ + 0.5 }), true);
        for (const slot of this.towerSlots) this._createTower(slot);
        DefenseSystem.invalidateElevatedTopology();
        for (const stair of this.preset.stairs) this._createStair(stair);
        DefenseSystem.commitElevatedTopologyChange();
    }

    _create(key, maxHp, point, gate, orient = 'v') {
        const saved = this.site.fortifications?.find((part) => part.key === key);
        const hp = saved && Number.isFinite(saved.hp) ? Math.max(0, Math.min(maxHp, saved.hp)) : maxHp;
        const record = { key, name: gate ? '城门' : '城墙', hp, maxHp };
        const cell = blockCellOf(point.x, point.y);
        const position = { ...point, i: cell[0] - this.origin[0], j: cell[1] - this.origin[1] };
        if (hp <= 0) { this.parts.push({ record, position, unit: null }); return; }
        const id = `siege_${this.site.id}_${key}`;
        const unit = gate
            ? new BuildableGate(point.x, point.y, { id, grade: 'D', name: '敌方城门',
                hp: maxHp, isGate4: true, orient: 'v', barCells: 2, barsOnly: true, deferCoverTrim: true })
            : new DefenseCover(point.x, point.y, { id, grade: 'D', name: '敌方城墙',
                hp: maxHp, block: true, orient, walkable: true });
        this.parts.push({ record, position, unit });
        unit._strategicFortification = true;
        unit._isEnemyEntity = false;
        unit._faction = 'enemy';
        unit._noGoldDrop = true;
        // Reuse player geometry, but never inherit player research HP/material upgrades.
        unit.hp = hp; unit.maxHp = maxHp;
        unit.data.hp = hp; unit.data.maxHp = maxHp;
        if (gate) {
            unit._skipNeutralSprite = true;
            unit._gateSeg._opensForFriendly = false;
            unit.setMode('locked');
        } else {
            unit.spriteCfg.idleKey = this.preset.wallTexture;
        }
        Game.entities.set(id, unit);
    }

    _createTower(slot) {
        const key = `tower_${slot.key}`, maxHp = this.towerTier.hp;
        const saved = this.site.fortifications?.find((part) => part.key === key);
        // First upgrade from a wall-only save inherits the worst covered wall's durability.
        // A destroyed corner remains open instead of gaining a free intact tower.
        const oldWalls = (this.site.fortifications || []).filter((part) => slot.cells.some((cell) =>
            part.key === `wall_${cell.i - this.origin[0]}_${cell.j - this.origin[1]}`));
        const durability = oldWalls.reduce((ratio, part) => Math.min(ratio,
            Math.max(0, part.hp) / Math.max(1, part.maxHp || this.preset.wallHp)), 1);
        const hp = saved && Number.isFinite(saved.hp)
            ? Math.max(0, Math.min(maxHp, saved.hp)) : Math.floor(maxHp * durability);
        const record = { key, name: '城角塔楼', hp, maxHp };
        if (hp <= 0) { this.parts.push({ record, position: slot.position, unit: null }); return; }
        const id = `siege_${this.site.id}_${key}`;
        const unit = createStrategicWallTower(slot.anchor, id, this.towerTier, hp);
        this.parts.push({ record, position: slot.position, unit });
        Game.entities.set(id, unit);
    }

    _createStair(definition) {
        const { key, wall: cell, dir, ascendingSign } = definition;
        const wall = this.parts.find((part) => part.record.key === `wall_${cell.i}_${cell.j}`)?.unit;
        const targetTopZ = wall?._wallTopZ || WALL_WALK_CONFIG.defaultTopZ;
        const segmentCount = Math.max(WALL_STAIR_CONFIG.minSegments, Math.min(WALL_STAIR_CONFIG.maxSegments,
            Math.ceil(targetTopZ / WALL_STAIR_CONFIG.risePerSegment)));
        const maxHp = WALL_STAIR_CONFIG.hpPerSegment * segmentCount;
        const recordKey = `stair_${key}`;
        const saved = this.site.fortifications?.find((part) => part.key === recordKey);
        const hp = saved && Number.isFinite(saved.hp) ? Math.max(0, Math.min(maxHp, saved.hp)) : maxHp;
        const record = { key: recordKey, name: '城墙楼梯', hp, maxHp };
        if (!wall || wall.hp <= 0 || hp <= 0) {
            this.staircases.push({ record: { ...record, hp: 0 }, unit: null });
            return;
        }
        // Same wall-grid snap as player stairs: the bottom is N cells inward from the wall.
        const step = { x: -ascendingSign * BLOCK_GRID[dir][0], y: -ascendingSign * BLOCK_GRID[dir][1] };
        if (!DefenseSystem.isWallStairAttachmentEligible(wall, step.x, step.y)) {
            throw new Error(`攻城楼梯 ${key} 缺少可连接的城墙内侧`);
        }
        const segments = Array.from({ length: segmentCount }, (_, index) => ({
            x: wall.x + step.x * (segmentCount - index),
            y: wall.y + step.y * (segmentCount - index),
        }));
        const id = `siege_${this.site.id}_${recordKey}`;
        const unit = new WallStaircase(segments[0].x, segments[0].y, {
            id, name: '敌方城墙楼梯', hp: maxHp, wall, dir, ascendingSign,
            targetTopZ, segmentCount, segments,
            attachPoint: { x: wall.x + step.x * 0.5, y: wall.y + step.y * 0.5 },
        });
        this.staircases.push({ record, unit });
        unit._strategicFortification = true;
        unit._isEnemyEntity = false;
        unit._faction = 'enemy';
        unit._noGoldDrop = true;
        unit.hp = hp; unit.maxHp = maxHp;
        unit.data.hp = hp; unit.data.maxHp = maxHp;
        for (const visual of unit.visualSegments) visual.texture = `${visual.baseTexture}_${this.preset.stairTextureSuffix}`;
        unit.spriteCfg.idleKey = unit.visualSegments[0].texture;
        Game.entities.set(id, unit);
        DefenseSystem.staircases.push(unit);
    }

    isStairAccessReserved(point, radius = 0, elevated = false) {
        for (const { unit: stair } of this.staircases) {
            if (!stair?.active || stair.hp <= 0 || stair._sinking) continue;
            if (elevated) {
                const connector = stair.wallConnectorSurface()?.footprint;
                if (connector && pointInIsoFootprint(point.x, point.y, connector, radius + 16)) return true;
                continue;
            }
            if (stair.segments.some((segment) => pointInIsoFootprint(point.x, point.y, segment, radius + 12))) return true;
            const entry = stair.groundPortal()?.entry;
            if (entry && Math.hypot(point.x - entry.x, (point.y - entry.y) * 2) < radius + 48) return true;
        }
        return false;
    }

    reconcileStairs() {
        for (const { unit } of this.staircases) {
            if (!unit?.active || unit.hp <= 0 || unit._sinking) continue;
            if (unit.wall?.active && unit.wall.hp > 0 && !unit.wall._sinking) continue;
            // Remove native rails/support immediately when the attached wall collapses.
            unit.hp = 0; unit.data.hp = 0;
            unit.onDeath(unit.wall);
        }
    }

    nearestPart(point) {
        let best = null, range = Infinity;
        for (const part of this.parts) {
            const d = Math.hypot(part.position.x - point.x, (part.position.y - point.y) * 2);
            if (d < range) { range = d; best = part; }
        }
        return best;
    }

    defensePoint(part, slot = 0) {
        const { halfI, halfJ } = this.preset;
        let { i, j } = part.position;
        const offset = slot === 0 ? 0 : Math.ceil(slot / 2) * (slot % 2 ? -1 : 1) * 1.25;
        if (Math.abs(i) === halfI) j += offset;
        else i += offset;
        i = Math.max(-halfI + 2.25, Math.min(halfI - 2.25, i));
        j = Math.max(-halfJ + 2.25, Math.min(halfJ - 2.25, j));
        return this.point({ i, j });
    }

    deployRanged(unit, occupied, approach) {
        const posts = this.parts.filter(({ unit: wall }) => wall?._isBlockCover && wall.hp > 0 && !wall._sinking)
            .map(({ unit: wall }) => ({ wall, point: blockWallTopWalkGeometry(wall)?.center }))
            .filter(({ point }) => point)
            .sort((a, b) => Math.hypot(a.point.x - approach.x, (a.point.y - approach.y) * 2)
                - Math.hypot(b.point.x - approach.x, (b.point.y - approach.y) * 2));
        for (const { wall, point } of posts) {
            const radius = Math.max(20, unit.groundRadius || unit.collisionRadius || 20);
            if (this.isStairAccessReserved(point, radius, true)) continue;
            if (occupied.some((seat) => Math.hypot(point.x - seat.x, (point.y - seat.y) * 2) < radius + seat.radius + 48)) continue;
            if (!DefenseSystem.deployUnitOnWallTop(unit, wall)) continue;
            const seat = { x: unit.x, y: unit.y, z: unit.z, radius, wall };
            occupied.push(seat);
            return seat;
        }
        return null;
    }

    result() {
        this.reconcileStairs();
        return [...this.parts, ...this.staircases].map(({ unit, record }) => ({ ...record, hp: Math.max(0, unit?.hp || 0) }));
    }

    destroy() {
        for (const { unit } of this.staircases) {
            if (!unit) continue;
            unit.destroy();
            if (Game.entities.get(unit.id) === unit) Game.entities.delete(unit.id);
        }
        this.staircases = [];
        for (const { unit } of this.parts) {
            if (!unit) continue;
            if (unit._isCoverGate || unit._isWallTower) unit.destroy();
            else { unit.removeFromCollision(); unit.active = false; }
            if (Game.entities.get(unit.id) === unit) Game.entities.delete(unit.id);
        }
        this.parts = [];
        DefenseSystem.commitElevatedTopologyChange();
    }
}
