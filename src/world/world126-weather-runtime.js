import { World126WeatherSystem as Weather, mineWeatherConfig, mineWeatherNow, MINE_WEATHER_SCENE } from './world126-weather-system.js';
import { MineGasZone, MineWarningVisual } from './world126-weather-visuals.js';
import { DamagePipeline } from '../combat/damage-pipeline.js';
import { GroundEllipse } from '../physics/skill-shapes.js';
import { volumeEffectContext } from '../physics/elevation.js';
import { circleIntersectsIsoFootprint } from '../physics/iso-footprint.js';
import { WallSystem } from './wall-system.js';
import { circleOverlapsActiveGate } from './gate-occupancy.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';
import { hasEnemyFamily } from '../config/enemy-family.js';
import { Zombie, MinerZombie, LanternMinerZombie, ForemanZombie } from '../entities/enemy-types.js';
import { MineCave } from '../entities/enemy-types/mine-cave.js';
import { SoundManager } from '../ui/sound-manager.js';
import { StatusBar } from '../ui/status-bar.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { pickDefensePriorityTarget } from '../ai/defense-target-priority.js';
import { getBuildingFootprint } from './building-footprint.js';
import enemyConfigData from '../../data/enemy-config.json';

const living = (entity) => entity && entity.active !== false && !entity._isDead && !entity._dying && !entity._sinking
    && (entity === window.Game?.player ? entity.data?.hp ?? entity.hp : entity.hp) > 0;
const position = (entity) => ({ x: Number(entity.collider?.x ?? entity.x), y: Number(entity.collider?.y ?? entity.y) });
const tierOf = (entity) => ['boss', 'lord'].includes(entity.rank) ? 'lord' : entity.rank === 'elite' ? 'elite' : 'normal';
const supported = new Set(['zombie', 'minerZombie', 'lanternMinerZombie', 'foremanZombie', 'mineCave']);
const typeOf = (entity) => entity._defenseMonsterType || entity.config?.id || entity.id;
const maxHpOf = (entity) => Number(entity === window.Game?.player ? entity.data?.maxHp : entity.maxHp) || 1;

export class World126WeatherRuntime {
    constructor(scene) {
        this.scene = scene;
        this.rocks = []; this.zones = []; this.warnings = new Map(); this.poison = new Map();
        this.attached = false; this.eventId = null; this.generation = 0; this.restoreQueue = [];
        this.assetRequest = null; this.assetRetryAt = 0; this.spawnError = ''; this.nextGasAt = 0;
        this.lastNow = null;
        Weather.attachRuntime(this);
    }
    get game() { return window.Game; }
    available() {
        return window.SceneManager?.currentScene === MINE_WEATHER_SCENE && !window.SceneManager?.isLoading;
    }
    _entities() { return this.game?.entities?.values?.() || []; }
    _portal() {
        const point = window.WorldProgressionSystem?.getWorldConfig?.(MINE_WEATHER_SCENE)?.portalSpawn;
        return point || GAME_CONFIG.scenes.scene12.origin;
    }
    _safeFromPortal(x, y, radius = 0) {
        const portal = this._portal();
        return Math.hypot(x - portal.x, (y - portal.y) / PERSPECTIVE_SCALE_Y)
            > (mineWeatherConfig().portalSafeRadius ?? 420) + radius;
    }
    _insideWorld(x, y, radius = 0) {
        const cfg = GAME_CONFIG.scenes.scene12;
        return Math.abs(x - cfg.origin.x) / (cfg.width / 2 - radius)
            + Math.abs(y - cfg.origin.y) / (cfg.height / 2 - radius) < 0.97;
    }
    _structure(entity) {
        return living(entity) && !entity._isEnergyNode
            && (entity._isGridBuilding || entity._isDefenseStructure || entity._isDefenseTower);
    }
    _building(entity) { return this._structure(entity) && !entity._isEnemyEntity; }
    _spawnBody(point, type) {
        const cfg = enemyConfigData[type] || {};
        const foot = type === 'mineCave' ? getBuildingFootprint(1) : null;
        return { x: point.x + (foot?.offX ?? cfg.render?.colliderOffsetX ?? 0),
            y: point.y + (foot?.offY ?? cfg.render?.colliderOffsetY ?? 0),
            radius: foot?.collisionRadius ?? cfg.collisionRadius ?? 30 };
    }
    _validMonsterSpawn(point, type) {
        if (!point) return false;
        const body = this._spawnBody(point, type);
        return this._validSpawn(body, body.radius);
    }
    _validSpawn(point, radius = 30, ignore = null) {
        if (!point || !this._insideWorld(point.x, point.y, radius)
            || !this._safeFromPortal(point.x, point.y, radius)
            || !WallSystem.canMoveTo(point.x, point.y, radius)
            || circleOverlapsActiveGate(point.x, point.y, radius, this._entities())) return false;
        for (const other of this._entities()) {
            if (!living(other) || other === ignore || !other.collider) continue;
            if (other._isGridBuilding && circleIntersectsIsoFootprint(point.x, point.y, radius, other)) return false;
            const p = position(other);
            if (!other._isGridBuilding && Math.hypot(p.x - point.x, (p.y - point.y) / PERSPECTIVE_SCALE_Y)
                < radius + (other.groundRadius || other.collisionRadius || 20)) return false;
        }
        return true;
    }
    _findSpawn(origin = null, type = 'minerZombie') {
        const focus = origin || this._focus();
        for (let i = 0; i < 64; i++) {
            const angle = i * 2.39996;
            const distance = origin ? Math.floor(i / 8) * 48 : 480 + (i % 8) * 55;
            const point = { x: focus.x + Math.cos(angle) * distance, y: focus.y + Math.sin(angle) * distance * PERSPECTIVE_SCALE_Y };
            if (this._validMonsterSpawn(point, type)) return point;
        }
        return null;
    }
    _focus() {
        const buildings = [...this._entities()].filter((entity) => this._building(entity)
            && this._safeFromPortal(entity.x, entity.y, 150));
        return buildings.length && Math.random() < 0.65
            ? position(buildings[Math.floor(Math.random() * buildings.length)])
            : position(this.game.player || this._portal());
    }
    _source(point, armor = true) {
        return { ...point, _faction: 'environment', ...(armor ? { data: {} } : {}) };
    }
    _snapshot(entity) {
        const metadata = entity._mineWeather;
        return { ...metadata, x: entity.x, y: entity.y, type: typeOf(entity), tier: tierOf(entity),
            hp: entity.hp, maxHp: entity.maxHp,
            atk: entity.data?.atk / (entity._inspireMul?.atkMul || 1), matk: entity.data?.matk,
            level: entity.level, summoned: !!entity._summoned,
            mineCaveSpawnResolved: entity._mineCaveSpawnResolved === true };
    }
    capture() {
        if (!this.attached) return;
        const state = Weather.getState();
        const records = new Map(this.restoreQueue.map((entry) => [entry.uid, entry]));
        for (const entity of this._entities()) {
            if (entity._mineWeather && living(entity)) records.set(entity._mineWeather.uid, this._snapshot(entity));
        }
        state.survivors = [...records.values()];
    }
    _clearHazards() {
        this.overlay?.destroy(); this.overlay = null;
        for (const rock of this.rocks) rock.visual?.destroy();
        this.rocks = [];
        for (const zone of this.zones) zone.destroy();
        this.zones = [];
        for (const visual of this.warnings.values()) visual.destroy();
        this.warnings.clear();
        for (const [entity, record] of this.poison) {
            entity.removeStatusEffect?.('minePoison');
            if (record.hudId) StatusBar.removeEffect(record.hudId);
        }
        this.poison.clear();
    }
    reset(capture = true) {
        if (capture) {
            this.capture();
            // 离场不积压地下新增批次；已登记的一次复活保留到本次天气结束。
            if (this.attached && Weather.getState().event) {
                Weather.getState().event.pending = Weather.getState().event.pending.filter((entry) => entry.revived);
            }
        }
        else {
            // 读档/新世代丢弃旧现场，不能让旧 UID 覆盖刚恢复的生命与复活标记。
            for (const [key, entity] of this.game?.entities || []) {
                if (!entity._mineWeather) continue;
                entity._destroyCustomEffects?.(); entity._destroyPhaserSprite?.();
                entity.active = false; this.game.entities.delete(key);
            }
        }
        this._clearHazards();
        this.attached = false; this.eventId = null; this.restoreQueue = [];
        this.lastNow = null;
        this.generation++; this.assetRequest = null; this.assetRetryAt = 0; this.spawnError = '';
    }
    endEvent() { this._clearHazards(); this.eventId = null; }
    update(delta) {
        if (!this.available()) { if (this.attached) this.reset(true); return; }
        if (!this.game?.isRunning || this.game._paused || delta <= 0) return;
        const state = Weather.getState();
        if (!state.worldEpoch) return;
        const now = mineWeatherNow();
        const clockJumped = this.lastNow !== null && now - this.lastNow > 1000;
        this.lastNow = now;
        if (!this.attached) {
            this.attached = true;
            const liveIds = new Set([...this._entities()].map((entity) => entity._mineWeather?.uid).filter(Boolean));
            // 先恢复已有生成器，避免工头第一帧误判“没有矿洞”而重复召唤。
            this.restoreQueue = state.survivors.filter((record) => !liveIds.has(record.uid))
                .sort((a, b) => Number(b.type === 'mineCave') - Number(a.type === 'mineCave'));
            (state.event?.pending || []).forEach((pending, index) => {
                pending.due = Math.max(pending.due, now + 3000 + index * 750);
            });
        }
        this._restoreOne();
        const event = Weather.getActiveEvent(now);
        const dt = Math.min(250, delta);
        if (this.eventId !== event?.id || clockJumped || delta > 1000) {
            this._clearHazards(); this.eventId = event?.id || null; this.nextGasAt = now;
            if (event) {
                if (now > event.start + 2000) {
                    event.nextRound = Math.max(event.nextRound || 0, Math.ceil((now - event.start) / (event.end - event.start) * event.rounds));
                    event.nextBatchAt = now + (mineWeatherConfig().resurrection.batchIntervalMs || 20000);
                }
            }
        }
        if (event) {
            if (!this.overlay) this.overlay = this.scene.add.rectangle(0, 0, 1, 1, 0x17101e, 0)
                .setOrigin(0, 0).setScrollFactor(0).setDepth(99970);
            const zoom = this.scene.cameras.main.zoom || 1;
            this.overlay.setSize(this.scene.scale.width / zoom, this.scene.scale.height / zoom);
            const colors = { earthquake: 0x3c3021, poisonGas: 0x303517, resurrection: 0x24162e };
            this.overlay.setFillStyle(colors[event.kind], 0.035 + 0.02 * (1 + Math.sin(now * 0.0008)) / 2);
        }
        if (event?.kind === 'earthquake') this._earthquake(event, now);
        if (event?.kind === 'poisonGas') this._gas(event, now, dt);
        if (event?.kind === 'resurrection') this._resurrection(event, now);
        this.capture();
    }
    _earthquake(event, now) {
        const cfg = mineWeatherConfig().earthquake;
        const index = event.nextRound || 0;
        if (index < event.rounds && now >= event.start + index * (event.end - event.start) / event.rounds) {
            event.nextRound = index + 1;
            const buildings = [...this._entities()].filter((entity) => this._building(entity)
                && this._safeFromPortal(entity.x, entity.y, cfg.radius));
            // 每轮可多次选中同一建筑：6颗 × 4~6轮，允许重复命中摧毁。
            for (let i = 0; i < cfg.rocksPerRound; i++) {
                let point;
                if (buildings.length && Math.random() < cfg.buildingTargetChance) {
                    point = position(buildings[Math.floor(Math.random() * buildings.length)]);
                } else {
                    const focus = this._focus();
                    const angle = Math.random() * Math.PI * 2;
                    const distance = 120 + Math.random() * 360;
                    point = { x: focus.x + Math.cos(angle) * distance, y: focus.y + Math.sin(angle) * distance * PERSPECTIVE_SCALE_Y };
                }
                if (!this._safeFromPortal(point.x, point.y, cfg.radius) || !this._insideWorld(point.x, point.y, cfg.radius)) continue;
                const warningAt = now + i * cfg.rockStaggerMs;
                this.rocks.push({ ...point, warningAt, impactAt: warningAt + cfg.telegraphMs, radius: cfg.radius, visual: null });
            }
        }
        for (let i = this.rocks.length - 1; i >= 0; i--) {
            const rock = this.rocks[i];
            if (rock.hit) {
                rock.visual.drawImpact(now - rock.impactAt);
                if (now >= rock.impactAt + 900) { rock.visual.destroy(); this.rocks.splice(i, 1); }
                continue;
            }
            if (now < rock.warningAt) continue;
            if (!rock.visual) rock.visual = new MineWarningVisual(this.scene, rock.x, rock.y, rock.radius, 'earthquake');
            const progress = Math.min(1, (now - rock.warningAt) / cfg.telegraphMs);
            rock.visual.draw(progress, now - event.start);
            if (now < rock.impactAt) continue;
            // 落石扫过地面与墙上单位的垂直空间，平面范围与警示椭圆一致。
            const shape = new GroundEllipse(rock.x, rock.y, rock.radius, rock.radius * PERSPECTIVE_SCALE_Y,
                volumeEffectContext(256, 256));
            for (const entity of this._entities()) {
                if (!living(entity) || entity.hittable === false || typeof entity.takeDamage !== 'function') continue;
                const building = this._structure(entity);
                const hit = building ? circleIntersectsIsoFootprint(rock.x, rock.y, rock.radius, entity) : shape.intersectsEntity(entity);
                if (!hit || (!building && !entity._isEnemyEntity && !['player', 'companion'].includes(entity._faction))) continue;
                if (!this._safeFromPortal(entity.x, entity.y)) continue;
                DamagePipeline.applyHit(this._source(rock, !building), entity, {
                    damage: Math.max(1, maxHpOf(entity) * (building ? cfg.buildingDamageRatio : cfg.unitDamageRatio)),
                    damageType: 'physical', isMelee: false,
                });
            }
            SoundManager.playWorld?.('assets/sounds/enemies/miner_zombie/hitting.mp3', rock.x, rock.y);
            if (this.scene.isFogPointVisible?.(rock.x, rock.y) !== false) this.scene.cameras?.main?.shake(180, 0.0012);
            rock.hit = true;
        }
    }
    _gas(event, now, dt) {
        const cfg = mineWeatherConfig().poisonGas;
        if (now >= this.nextGasAt && this.zones.length < cfg.maxZones) {
            this.nextGasAt = now + cfg.zoneIntervalMs;
            const focus = this._focus();
            // 分散毒区、不围死单位；同一时刻最多四片，传送门附近保持无毒。
            for (let attempt = 0; attempt < 24; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const point = { x: focus.x + Math.cos(angle) * (180 + attempt * 25),
                    y: focus.y + Math.sin(angle) * (180 + attempt * 25) * PERSPECTIVE_SCALE_Y };
                if (!this._safeFromPortal(point.x, point.y, cfg.radius) || !this._insideWorld(point.x, point.y, cfg.radius)
                    || !WallSystem.canMoveTo(point.x, point.y, 20)
                    || this.zones.some((zone) => Math.hypot(point.x - zone.x, (point.y - zone.y) / PERSPECTIVE_SCALE_Y) < cfg.radius * 2.3)) continue;
                this.zones.push(new MineGasZone(this.scene, point.x, point.y, cfg)); break;
            }
        }
        this.zones = this.zones.filter((zone) => zone.update(dt, this.game.entities));
        const shapes = this.zones.map((zone) => new GroundEllipse(zone.x, zone.y, zone.radius * zone.oilFrac,
            zone.radius * zone.oilFrac * PERSPECTIVE_SCALE_Y, zone.surfaceContext));
        for (const [entity, record] of this.poison) {
            if (living(entity)) continue;
            entity.removeStatusEffect?.('minePoison');
            if (record.hudId) StatusBar.removeEffect(record.hudId);
            this.poison.delete(entity);
        }
        for (const entity of this._entities()) {
            if (!living(entity) || entity._isGridBuilding || entity._isDefenseStructure || typeof entity.addStatusEffect !== 'function'
                || (!entity._isEnemyEntity && !['player', 'companion'].includes(entity._faction))) continue;
            const immune = hasEnemyFamily(entity, '僵尸') || entity.hasStatusEffect?.('statusImmune');
            const inside = !immune && shapes.some((shape) => shape.intersectsEntity(entity));
            let record = this.poison.get(entity);
            if (!record && !inside) continue;
            if (!record) { record = { exposure: 0, tick: 0, infected: false, hudId: null }; this.poison.set(entity, record); }
            // 净化移除状态后重新累计暴露，不能下一帧立即重新上毒。
            if (record.infected && !entity.hasStatusEffect('minePoison')) {
                record.infected = false; record.exposure = 0; record.tick = 0;
                if (record.hudId) StatusBar.removeEffect(record.hudId);
                record.hudId = null;
            }
            record.exposure = inside ? record.exposure + dt : 0;
            if (immune) entity.removeStatusEffect('minePoison');
            if (inside && record.exposure >= cfg.exposureMs) {
                entity.addStatusEffect('minePoison', cfg.lingerMs);
                record.infected = entity.hasStatusEffect('minePoison');
                if (entity === this.game.player && record.infected) {
                    if (!record.hudId) record.hudId = StatusBar.addEffect('minePoison', cfg.lingerMs);
                    const hud = StatusBar.effects.find((effect) => effect.id === record.hudId);
                    if (hud) hud.remaining = cfg.lingerMs;
                }
            }
            if (record.infected && !immune) {
                record.tick += dt;
                if (record.tick >= cfg.tickMs) {
                    record.tick -= cfg.tickMs;
                    DamagePipeline.applyHit(this._source(position(entity)), entity, {
                        damage: Math.max(0.1, maxHpOf(entity) * cfg.damageRatio), damageType: 'magic', isMelee: false,
                    });
                }
            }
            if ((!inside && !entity.hasStatusEffect('minePoison')) || immune || !living(entity)) {
                if (record.hudId) StatusBar.removeEffect(record.hudId);
                this.poison.delete(entity);
            }
        }
    }
    _limits(tier) {
        const cfg = mineWeatherConfig().resurrection;
        return tier === 'lord' ? [cfg.maxAliveLord, cfg.totalLord, 'lordGenerated']
            : tier === 'elite' ? [cfg.maxAliveElite, cfg.totalElite, 'eliteGenerated'] : [cfg.maxAlive, cfg.totalBudget, 'generated'];
    }
    _alive(tier = null) {
        return [...this._entities()].filter((entity) => entity._mineWeather && living(entity) && (!tier || tierOf(entity) === tier)).length
            + this.restoreQueue.filter((entry) => !tier || entry.tier === tier).length;
    }
    _canReserve(event, tier) {
        const cfg = mineWeatherConfig().resurrection;
        const [, total, key] = this._limits(tier);
        return event.generated + event.pending.length < cfg.totalBudget
            && (event[key] || 0) + event.pending.filter((entry) => tier === 'normal' || entry.tier === tier).length < total;
    }
    _hasLiveSlot(tier) {
        const cfg = mineWeatherConfig().resurrection;
        return this._alive() < cfg.maxAlive && this._alive(tier) < this._limits(tier)[0];
    }
    _consume(event, tier) {
        event.generated++;
        if (tier === 'elite') event.eliteGenerated++;
        if (tier === 'lord') event.lordGenerated++;
    }
    _newUid() { const state = Weather.getState(); return `mine-unit:${state.worldEpoch}:${++state.sequence}`; }
    _create(type, x, y) {
        const makeChild = (childType) => (cx, cy) => {
            const event = Weather.getActiveEvent();
            const tier = childType === 'lanternMinerZombie' ? 'elite' : 'normal';
            if (!event || !this._canReserve(event, tier) || !this._hasLiveSlot(tier)) return null;
            return this._create(childType, cx, cy);
        };
        if (type === 'zombie') return new Zombie(x, y);
        if (type === 'minerZombie') return new MinerZombie(x, y);
        if (type === 'lanternMinerZombie') return new LanternMinerZombie(x, y);
        if (type === 'foremanZombie') return new ForemanZombie(x, y, { mineCaveFactory: makeChild('mineCave') });
        if (type === 'mineCave') return new MineCave(x, y, {
            spawnFactory: makeChild('minerZombie'), lanternSpawnFactory: makeChild('lanternMinerZombie'),
        });
        return null;
    }
    _tag(entity, record) {
        entity._mineWeather = { uid: record.uid, eventId: record.eventId, revived: !!record.revived };
        entity._defenseMonster = true; entity._defenseMonsterType = record.type;
        entity._preferDefenseTargets = true; entity._engageHostileRange = 700; entity._alertRange = 2200;
        if (entity._aggroRange) entity._aggroRange = Math.max(entity._aggroRange, entity._alertRange);
        if (!entity.immovable) {
            entity.target = pickDefensePriorityTarget(entity, this.game.entities)?.target || null;
            if (entity.target) entity._lastKnownTargetPos = { x: entity.target.x, y: entity.target.y };
        }
        if (Number.isFinite(record.level)) entity.level = record.level;
        if (record.mineCaveSpawnResolved) entity._mineCaveSpawnResolved = true;
        entity._summoned = !!record.summoned || !!record.revived;
        entity._noGoldDrop = !!record.revived || !!record.summoned;
        if (record.revived) entity._grantsSkillTrainingExp = false;
        if (record.maxHp > 0) {
            entity.maxHp = record.maxHp; entity.hp = Math.max(0.01, Math.min(record.hp, record.maxHp));
            if (entity.data) {
                entity.data.hp = entity.hp; entity.data.maxHp = entity.maxHp;
                if (Number.isFinite(record.atk)) entity.data.atk = record.atk;
                if (Number.isFinite(record.matk)) entity.data.matk = record.matk;
            }
        } else {
            const progression = window.WorldProgressionSystem;
            const grade = progression?.hasCompletedDungeon?.('abandonedMine') ? 2
                : progression?.hasCompletedDungeon?.('abandonedMineMid') ? 1 : 0;
            entity.maxHp *= 1 + grade * 0.25; entity.hp = entity.maxHp;
            if (entity.data) {
                entity.data.hp = entity.hp; entity.data.maxHp = entity.maxHp;
                entity.data.atk *= 1 + grade * 0.15;
                entity.data.matk *= 1 + grade * 0.15;
            }
        }
        entity.collider?.syncPosition?.();
    }
    _assetsReady(type) {
        const types = type === 'foremanZombie' || type === 'mineCave'
            ? [type, 'mineCave', 'minerZombie', 'lanternMinerZombie'] : [type];
        const resolved = RuntimeAssetManager.resolveEnemyVisualKeysForTypes(types);
        const ready = !resolved.unresolvedTypes.length && resolved.keys.length > 0 && resolved.keys.every((key) => {
            const animation = RuntimeAssetManager.enemyAnimationManifest.get(key);
            return animation ? RuntimeAssetManager.isAnimationReady(key)
                && animation.textureKeys.every((texture) => RuntimeAssetManager.isTextureReady(texture)) : RuntimeAssetManager.isTextureReady(key);
        });
        if (ready) { this.spawnError = ''; return true; }
        if (this.assetRequest || mineWeatherNow() < this.assetRetryAt) return false;
        const generation = this.generation;
        this.assetRequest = RuntimeAssetManager.prefetchEnemyTypes(types, { required: true,
            shouldLoad: () => generation === this.generation && this.available() });
        this.assetRequest.catch((error) => {
            if (generation !== this.generation) return;
            this.spawnError = error?.message || '天气怪物资源加载失败';
            this.assetRetryAt = mineWeatherNow() + 5000;
            window.SceneManager?.showTopNotification?.('矿洞天气怪物加载失败，稍后重试；可正常离开位面', { color: '#e9b889' });
        }).finally(() => { if (generation === this.generation) this.assetRequest = null; });
        return false;
    }
    _restoreOne() {
        const record = this.restoreQueue[0];
        if (!record || !supported.has(record.type) || !this._assetsReady(record.type)) return;
        const point = this._findSpawn(record, record.type);
        if (!point) return;
        const entity = this._create(record.type, point.x, point.y);
        if (!entity) return;
        this._tag(entity, record);
        if (record.type === 'mineCave') entity.applyStatusImmune?.(Number.MAX_SAFE_INTEGER);
        this.game.entities.set(record.uid, entity); this.restoreQueue.shift();
    }
    onEnemyDeath(entity) {
        if (!this.available() || !this.attached || !entity?._isEnemyEntity) return;
        const state = Weather.getState();
        if (entity._mineWeather) state.survivors = state.survivors.filter((record) => record.uid !== entity._mineWeather.uid);
        const event = Weather.getActiveEvent();
        const type = typeOf(entity);
        if (event?.kind !== 'resurrection' || entity._mineWeatherDeathSeen || entity._mineWeather?.revived
            || entity._summoned || !hasEnemyFamily(entity, '僵尸') || !supported.has(type) || type === 'mineCave') return;
        entity._mineWeatherDeathSeen = true;
        const tier = tierOf(entity);
        if (!this._canReserve(event, tier)) return;
        const cfg = mineWeatherConfig().resurrection;
        const record = { x: entity.x, y: entity.y, atk: entity.data?.atk / (entity._inspireMul?.atkMul || 1),
            matk: entity.data?.matk, level: entity.level };
        event.pending.push({ ...record, uid: this._newUid(), eventId: event.id, type, tier, revived: true,
            hp: entity.maxHp * cfg.reviveHpRatio, maxHp: entity.maxHp,
            due: mineWeatherNow() + cfg.reviveDelayMs, point: null });
    }
    admitSummon(spawner, entity) {
        if (!spawner?._mineWeather) return true;
        const event = Weather.getActiveEvent();
        const tier = tierOf(entity);
        if (!this.available() || event?.kind !== 'resurrection' || spawner._mineWeather.eventId !== event.id
            || !this._canReserve(event, tier) || !this._hasLiveSlot(tier)) return false;
        this._consume(event, tier);
        this._tag(entity, { uid: this._newUid(), eventId: event.id, type: typeOf(entity), summoned: true });
        return true;
    }
    _resurrection(event, now) {
        const cfg = mineWeatherConfig().resurrection;
        const progress = (now - event.start) / (event.end - event.start);
        if (now >= event.nextBatchAt) {
            event.nextBatchAt = now + cfg.batchIntervalMs;
            const tiers = [];
            if (progress >= cfg.lordStartFraction && event.lordGenerated === 0 && !event.pending.some((entry) => entry.tier === 'lord')) tiers.push('lord');
            if (progress >= cfg.eliteStartFraction) tiers.push('elite');
            while (tiers.length < cfg.batchSize) tiers.push('normal');
            for (const tier of tiers) {
                // 为中后段精英/领主及其一次复活保留预算，普通怪不能提前用尽36名额。
                const reserved = Math.max(0, cfg.totalElite - event.eliteGenerated)
                    + Math.max(0, cfg.totalLord - event.lordGenerated);
                if (tier === 'normal' && event.generated + event.pending.length >= cfg.totalBudget - reserved) continue;
                if (!this._canReserve(event, tier) || !this._hasLiveSlot(tier)) continue;
                const pool = cfg.pools[tier];
                const type = pool[Math.floor(Math.random() * pool.length)];
                const point = this._findSpawn(null, type);
                if (!point) continue;
                event.pending.push({ uid: this._newUid(), eventId: event.id, tier, type, ...point, point,
                    revived: false, due: now + cfg.emergeMs });
            }
        }
        // 复活先于新增；每帧最多物化一只，已占用预留名额不重复扣预算。
        const entries = [...event.pending].sort((a, b) => Number(b.revived) - Number(a.revived) || a.due - b.due);
        let spawned = false;
        for (const record of entries) {
            if (!record.point) record.point = this._findSpawn(record, record.type);
            if (!record.point || now < record.due - cfg.emergeMs) continue;
            let visual = this.warnings.get(record.uid);
            if (!visual) {
                const body = this._spawnBody(record.point, record.type);
                visual = new MineWarningVisual(this.scene, body.x, body.y, Math.max(55, body.radius), 'resurrection');
                this.warnings.set(record.uid, visual);
            }
            visual.draw(Math.min(1, Math.max(0, 1 - (record.due - now) / cfg.emergeMs)), now - event.start);
            if (spawned || now < record.due || !this._hasLiveSlot(record.tier) || !this._assetsReady(record.type)) continue;
            if (!this._validMonsterSpawn(record.point, record.type)) {
                visual.destroy(); this.warnings.delete(record.uid);
                record.point = this._findSpawn(record, record.type); record.due = now + cfg.emergeMs; continue;
            }
            const entity = this._create(record.type, record.point.x, record.point.y);
            if (!entity) continue;
            this._tag(entity, record);
            this.game.entities.set(record.uid, entity);
            this._consume(event, record.tier);
            event.pending.splice(event.pending.indexOf(record), 1);
            visual.destroy(); this.warnings.delete(record.uid);
            this.scene.playDungeonSpawnParticles?.(record.point.x, record.point.y);
            spawned = true;
        }
    }
}
