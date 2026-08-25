import populationEconomyConfig from '../../data/population-economy.json';
import { fadeOutAndDestroyCivilian, registerCivilianVisual } from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';
import { CheeseFarmSystem } from './cheese-farm-system.js';

function visualConfig() {
    return populationEconomyConfig.cheese_farm?.cowVisual || null;
}

function animationKey(state) {
    const id = visualConfig()?.id;
    return id ? `worker_${id}_${state}` : '';
}

function worldPoint(building, sourcePoint) {
    const visual = visualConfig();
    const source = visual?.sourceCanvas || {};
    const width = Math.max(1, Number(source.width) || 898);
    const height = Math.max(1, Number(source.height) || 514);
    const displayW = Math.max(1, Number(building?._cfg?.displayW) || 512);
    const displayH = Math.max(1, Number(building?._cfg?.displayH) || 293);
    const spriteCenterY = (Number(building?.y) || 0)
        - (Number(building?._cfg?.footOffsetY) || 0);
    return {
        x: (Number(building?.x) || 0) + (Number(sourcePoint?.[0]) / width - 0.5) * displayW,
        y: spriteCenterY + (Number(sourcePoint?.[1]) / height - 0.5) * displayH,
    };
}

function setCowAnimation(cow, state) {
    if (cow.visualState === state) return;
    const key = animationKey(state);
    if (!key || !cow.sprite?.scene?.anims?.exists(key)) return;
    cow.visualState = state;
    cow.sprite.play(key, true);
    const visual = visualConfig();
    cow.sprite.setOrigin(0.5, Number(visual?.originY) || 0.921875);
    cow.sprite.setDisplaySize(
        Math.max(1, Number(visual?.displayWidth) || 112),
        Math.max(1, Number(visual?.displayHeight) || 75)
    );
}

function createCow(scene, building, slot) {
    const visual = visualConfig();
    const waypoints = visual?.safeWaypoints || [];
    const idleKey = animationKey('grazing');
    if (!visual || !waypoints.length || !scene?.textures?.exists(idleKey)) return null;
    const waypointIndex = slot % waypoints.length;
    const point = worldPoint(building, waypoints[waypointIndex]);
    const sprite = scene.add.sprite(point.x, point.y, idleKey, 0);
    sprite.setOrigin(0.5, Number(visual.originY) || 0.921875);
    sprite.setDisplaySize(
        Math.max(1, Number(visual.displayWidth) || 112),
        Math.max(1, Number(visual.displayHeight) || 75)
    );
    const cow = registerCivilianVisual({
        scene,
        building,
        slot,
        sprite,
        x: point.x,
        y: point.y,
        waypointIndex,
        routeDirection: slot % 2 === 0 ? 1 : -1,
        stateRemainMs: 2800 + slot * 900,
        visualState: '',
        civilianIgnoredStructures: [building],
        internalStructureOwner: building,
    }, 'holstein_cow');
    setCowAnimation(cow, 'grazing');
    return cow;
}

function updateCow(cow, building, dt) {
    const visual = visualConfig();
    const waypoints = visual?.safeWaypoints || [];
    if (!waypoints.length) return;
    const elapsed = Math.max(0, Number(dt) || 0);
    if (cow.visualState === 'grazing') {
        cow.stateRemainMs -= elapsed;
        if (cow.stateRemainMs > 0) return;
        let nextIndex = cow.waypointIndex + cow.routeDirection;
        if (nextIndex < 0 || nextIndex >= waypoints.length) {
            cow.routeDirection *= -1;
            nextIndex = cow.waypointIndex + cow.routeDirection;
        }
        cow.waypointIndex = Math.max(0, Math.min(waypoints.length - 1, nextIndex));
        setCowAnimation(cow, 'walking');
    }
    const target = worldPoint(building, waypoints[cow.waypointIndex]);
    const dx = target.x - cow.x;
    const dy = target.y - cow.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 2) {
        cow.x = target.x;
        cow.y = target.y;
        cow.sprite.setPosition(cow.x, cow.y);
        cow.stateRemainMs = 4200 + ((cow.slot * 1700 + cow.waypointIndex * 650) % 3600);
        setCowAnimation(cow, 'grazing');
        return;
    }
    const step = Math.min(distance, 18 * elapsed / 1000);
    if (Math.abs(dx) > 0.01) cow.sprite.setFlipX(dx < 0);
    cow.x += dx / distance * step;
    cow.y += dy / distance * step;
    cow.sprite.setPosition(cow.x, cow.y);
}

export const HolsteinCowVisualSystem = {
    _records: new Map(),

    updateBuilding(building, dt) {
        if (building?._economyType !== 'cheese_farm') return;
        if (!CivilianVisualSettings.isEnabled()) {
            this.clearBuilding(building);
            return;
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const targetCount = CheeseFarmSystem.getCowCount(building);
        if (!building.active || !scene || !visualConfig()) {
            this.clearBuilding(building);
            return;
        }
        let records = this._records.get(building) || [];
        if (records.some((cow) => cow.scene !== scene || !cow.sprite?.active)) {
            this.clearBuilding(building);
            records = [];
        }
        while (records.length > targetCount) fadeOutAndDestroyCivilian(records.pop());
        while (records.length < targetCount) {
            const cow = createCow(scene, building, records.length);
            if (!cow) break;
            records.push(cow);
        }
        if (records.length) this._records.set(building, records);
        records.forEach((cow) => updateCow(cow, building, dt));
    },

    clearBuilding(building) {
        const records = this._records.get(building);
        if (!records) return;
        records.forEach(fadeOutAndDestroyCivilian);
        this._records.delete(building);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
    },
};
