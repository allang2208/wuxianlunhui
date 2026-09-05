import config from '../../data/world-strategy.json';
import { CONFIG } from '../config/config.js';
import { Game } from '../game.js';
import { SceneManager } from './scene-manager.js';
import { WallSystem } from './wall-system.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { TroopLineSystem } from './troop-line-system.js';
import { ZOMBIE_FACTORY_MAP } from './zombie-dungeon.js';
import { Enemy } from '../entities/enemy.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';
import { setDungeonFloorProfile, applyDungeonFloorChunked, clearDecoClearZones } from './dungeon-floor-texture.js';
import { getAbandonedMineFloorProfile } from '../config/abandoned-mine-terrain.js';
import { StrategicStructure } from './strategic-structure.js';
import { StrategicSiege } from './strategic-siege.js';
import { StrategicGarrisonAI } from '../ai/strategic-garrison-ai.js';
import { DefenseSystem } from './defense-system.js';
import { DropItem } from '../entities/drop-item.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { createInvasionSummonContext, bindInvasionUnit } from './invasion-summon-budget.js';
import { captureInvasionUnit, restoreInvasionUnitState, restoreInvasionPhase } from './invasion-unit-state.js';
import { UNIT_KIND_CFG } from './unit-upgrade-store.js';
import { strategicCell } from './world-map-cells.js';
import { isSpawnPositionFree } from './spawn-placement.js';
import { formatStrategicTravelTime } from './strategic-march.js';

export const StrategicEncounter = {
    _originals: [],
    _objectives: [],
    _waves: [],
    _waveIndex: 0,
    _elapsed: 0,
    _enemySequence: 0,
    async load(sceneId, player, state) {
        this.hideHud();
        this._clearBattlefieldVisuals();
        this._clearSiege();
        const battle = sceneId === 'strategy_battle';
        if (battle) { this._originals = []; this._objectives = []; this._elapsed = 0; this._waveIndex = 0; this._waveError = null; }
        const { width, height } = battle ? config.battle : { width: 1024, height: 1024 };
        const scene = SceneManager.scenes[sceneId];
        Object.assign(scene, { width, height, diamondFloor: { enabled: battle } });
        this._diamond = battle ? SceneManager._scene8Diamond(scene) : null;
        if (battle) {
            this._playerSpawn = this._point(config.battle.playerSpawn);
            this._enemySpawn = this._point(config.battle.enemySpawn);
            this._retreat = { ...this._point(config.battle.retreat), radius: config.battle.retreat.radius };
            scene.origin = { ...this._playerSpawn };
        }
        CONFIG.WORLD_WIDTH = width; CONFIG.WORLD_HEIGHT = height;
        Game.friendlyUnits = [];
        Game.PartySystem.members.forEach((member) => { member.active = false; });
        player.active = battle;
        player._rtsController?.hold?.();
        player.vx = 0; player.vy = 0; player.isMoving = false;
        clearDecoClearZones();
        WallSystem.init(width, height);
        WallSystem.walls = [
            { x: 0, y: 0, w: width, h: 24, noVisual: true },
            { x: 0, y: height - 24, w: width, h: 24, noVisual: true },
            { x: 0, y: 0, w: 24, h: height, noVisual: true },
            { x: width - 24, y: 0, w: 24, h: height, noVisual: true },
        ];
        if (battle) SceneManager._registerScene8Boundary(this._diamond);
        WallSystem._syncWallsToPhaser?.();
        const plane = state.encounter?.planeSceneId;
        const floor = plane === 'scene12' ? { ...getAbandonedMineFloorProfile('world'), deco: null, cellDetails: null }
            : config.floors[plane] || { tiles: ['ruinslab_1', 'ruinslab_2'], glow: false, backgroundColor: '#080c11' };
        setDungeonFloorProfile({ ...floor, ...(floor.continuous ? { textureScaleY: 0.5774 } : {}) });
        applyDungeonFloorChunked(width, height, 2048, this._diamond);
        Renderer.terrainChunks && window.__phaserScene?.syncTerrain?.();
        Object.assign(Camera, { aimOffsetX: 0, aimOffsetY: 0, shakeX: 0, shakeY: 0, shakeIntensity: 0, lockY: false, yLockedValue: 0 });
        if (!battle) {
            Game.entities.delete('player');
            Camera.x = width / 2; Camera.y = height / 2;
            TroopLineSystem.setStrategicCompanions(state.army.companionIds, 'strategy_map', null, state.army.id);
            return;
        }
        const enemy = state.enemies.find((item) => item.id === state.encounter?.enemyId);
        const site = state.sites.find((item) => item.id === state.encounter?.siteId);
        this._waves = state.encounter?.waves || [site?.roster || enemy?.roster || []];
        this._summonContext = createInvasionSummonContext(this._waves,
            state.encounter?.summonLedger || enemy?.invasion?.summonLedger);
        if (!site && !state.encounter?.worldWarId && !this._waves.some((wave) => wave.length)) throw new Error('遭遇军团记录已失效');
        if (site) {
            this._siege = new StrategicSiege(site, this._point(config.siege.center));
            const assets = [...new Set(site.structures.map((record) => record.visual))]
                .map((id) => RuntimeAssetManager.ensureBuildingConfig(id));
            if (this._siege.towerVisual) assets.push(RuntimeAssetManager.ensureBuildingConfig(
                'wall_tower', this._siege.towerVisual.tex));
            await Promise.all(assets);
            this._siege.build();
            for (const record of site.structures) {
                // Position is battlefield geometry, not the persisted facility HP/ownership record.
                const point = this._siege.structurePoint(record.key);
                const unit = record.hp > 0 ? new StrategicStructure(site.id, { ...record, ...point }) : null;
                if (unit) Game.entities.set(unit.id, unit);
                this._objectives.push({ unit, record });
            }
            this._garrison = new StrategicGarrisonAI(this._siege, this._objectives);
        }
        player.x = this._playerSpawn.x; player.y = this._playerSpawn.y; player.z = 0;
        player._surfaceKind = 'ground'; player._surfaceWall = null; player._surfaceStaircase = null;
        player.collider?.syncPosition?.();
        Game.entities.set('player', player);
        Camera.follow(player);
        TroopLineSystem.materializeStrategicTroops(sceneId, player, state.army.id);
        TroopLineSystem.setStrategicCompanions(state.army.companionIds, sceneId, player, state.army.id);
        await this._spawnWave(0);
        this._showRetreatMarker();
    },
    _point({ u, v }) {
        const { cx, cy, rx, ry } = this._diamond;
        return { x: cx + u * rx, y: cy + v * ry };
    },
    async addReinforcements(army, strategy, encounter) {
        const stillValid = () => strategy.inBattle && strategy.state.encounter === encounter && !strategy._busy
            && !strategy._pendingBattleReturn && !this.result().victory && !Game.player?._isDead
            && strategy.state.detachments.includes(army) && !army.march && army.cellId === encounter.cellId;
        if (!stillValid()) return null;
        const records = TroopLineSystem.serializeStrategicTroops(army.id);
        await RuntimeAssetManager.ensureFriendlyUnitIds([...new Set(records.map((record) => UNIT_KIND_CFG[record.kind]?.id))], { shouldLoad: stillValid });
        if (!stillValid()) return null;
        strategy._settleSupply();
        const cell = strategicCell(army.cellId), from = strategicCell(army.previousCellId);
        const u = from ? Math.sqrt(3) * ((from.q - cell.q) + (from.r - cell.r) / 2) : -1;
        const v = from ? -1.5 * (from.r - cell.r) : 0;
        const extent = Math.abs(u) + Math.abs(v) || 1;
        const anchor = this._point({ u: u / extent * 0.78, v: v / extent * 0.78 });
        const result = TroopLineSystem.materializeArmyReinforcements(army.id, anchor, strategy.state.army.id, (center, offset) => {
            for (let ring = 0; ring < 9; ring++) for (let slot = 0; slot < 12; slot++) {
                const angle = (slot + offset) * Math.PI / 6;
                const x = center.x + Math.cos(angle) * ring * 64, y = center.y + Math.sin(angle) * ring * 40;
                if (this._insideBattlefield(x, y, 64) && isSpawnPositionFree(x, y, 64, { entities: Game.entities, wallSystem: WallSystem })) return { x, y };
            }
            return null;
        });
        if (!result.count) throw new Error('对应边缘没有安全落点，请让出入场区域');
        // Troop transfer is already committed; a presentation failure must not replay it.
        try { RuntimeAssetManager.commitFriendlyEntities(Game.friendlyUnits, Game.ProducerBuildingSystem?.getActiveVisualUnitIds?.() || []); }
        catch (error) { strategy.notify(`增援已入场，资源驻留更新失败：${error.message}`); }
        return result;
    },
    _insideBattlefield(x, y, radius) {
        const { cx, cy, rx, ry } = this._diamond;
        return Math.abs(x - cx) / rx + Math.abs(y - cy) / ry
            + (radius + 24) * Math.hypot(1 / rx, 1 / ry) < 1;
    },
    _enemySpawnPoint(unit, used, anchor = this._enemySpawn) {
        const radius = Math.max(36, Number(unit.collider?.radius || unit.config?.collisionRadius) || 36);
        const d = this._diamond;
        // Deterministic rings in projected ground space; reserve living units and siege facilities.
        for (let ring = 0; ring < 24; ring++) {
            const count = ring ? ring * 8 : 1;
            for (let index = 0; index < count; index++) {
                const angle = index / count * Math.PI * 2;
                const x = anchor.x + Math.cos(angle) * ring * 110;
                const y = anchor.y + Math.sin(angle) * ring * 55;
                if (x < d.cx - d.rx * 0.05 || !this._insideBattlefield(x, y, radius)
                    || (this._siege && !this._siege.containsSpawn(x, y, radius))
                    || !WallSystem.canMoveTo(x, y, radius)) continue;
                if (used.some((spot) => Math.hypot(x - spot.x, (y - spot.y) * 2) < radius + spot.radius + 30)) continue;
                return { x, y, radius };
            }
        }
        throw new Error('当前波次没有安全入场位置，请移动部队让出东侧集结区后重试');
    },
    _showRetreatMarker() {
        const scene = window.__phaserScene;
        if (!scene?.add) return;
        const { x, y, radius } = this._retreat;
        const theme = getComputedStyle(document.documentElement);
        const color = theme.getPropertyValue('--bp-ui-accent-bright').trim();
        const tint = Number.parseInt(color.replace('#', ''), 16) || 0xd9e0e5;
        const ring = scene.add.ellipse(x, y, radius * 2, radius, tint, 0.08)
            .setStrokeStyle(3, tint, 0.8).setDepth(WORLD_RENDER_LAYERS.GROUND_RANGE);
        const label = scene.add.text(x, y, '撤退集结区', {
            fontFamily: theme.getPropertyValue('--bp-font-ui').trim(),
            fontSize: theme.getPropertyValue('--bp-type-title').trim() || '20px', color: color || '#d9e0e5',
        }).setOrigin(0.5).setDepth(WORLD_RENDER_LAYERS.GROUND_RANGE);
        this._battlefieldVisuals = [ring, label];
    },
    _clearBattlefieldVisuals() {
        for (const visual of this._battlefieldVisuals || []) visual.destroy();
        this._battlefieldVisuals = [];
    },
    async _spawnWave(waveIndex) {
        const roster = this._waves[waveIndex] || [], created = [];
        RuntimeAssetManager.validateEnemyTypes(roster.map((unit) => unit.type), { required: true });
        await RuntimeAssetManager.prefetchEnemyTypes(roster.map((unit) => unit.type), { required: true });
        const used = Array.from(Game.entities.values())
            .filter((unit) => unit.active !== false && (unit.hp > 0 || unit.data?.hp > 0))
            .map((unit) => ({ x: unit.x, y: unit.y, radius: unit._strategicStructure ? 170 : Math.max(36, Number(unit.collider?.radius) || 36) }));
        try {
            for (let index = 0; index < roster.length; index++) {
                const record = roster[index], factory = ZOMBIE_FACTORY_MAP[record.type];
                if (!factory) throw new Error(`遭遇单位未登记：${record.type}`);
                const unit = Number.isInteger(record.invasionWave)
                    ? DefenseSystem.createInvasionMonster(record.type, this._enemySpawn.x, this._enemySpawn.y)
                    : factory(this._enemySpawn.x, this._enemySpawn.y);
                if (!unit) throw new Error(`入侵单位未登记：${record.type}`);
                restoreInvasionPhase(unit, record);
                bindInvasionUnit(unit, record, this._summonContext);
                // Factory IDs identify types; keep instance IDs unique across waves, retries and encounters.
                unit.id = `strategy_enemy_${++this._enemySequence}`;
                created.push({ unit, record });
                const spot = this._enemySpawnPoint(unit, used, this._garrison?.postFor(record) || this._enemySpawn);
                unit.x = spot.x; unit.y = spot.y;
                unit.collider?.syncPosition?.();
                used.push(spot);
                unit.maxHp *= record.hpMul || 1;
                unit.hp = Math.max(1, Math.round(unit.maxHp * record.hpRatio));
                if (unit.data) {
                    unit.data.hp = unit.hp; unit.data.maxHp = unit.maxHp;
                    unit.data.atk *= record.atkMul || 1; unit.data.matk *= record.atkMul || 1;
                }
                restoreInvasionUnitState(unit, record);
                this._garrison?.attach(unit, record);
                Game.entities.set(unit.id, unit);
            }
            await RuntimeAssetManager.ensureEnemyEntities(Game.entities.values());
            RuntimeAssetManager.commitEnemyEntities(Game.entities.values());
            this._originals = created;
            this._waveIndex = waveIndex;
            this._waveError = null;
        } catch (error) {
            for (const { unit } of created) {
                this._garrison?.detach(unit);
                unit.active = false; unit._destroyPhaserSprite?.(); Game.entities.delete(unit.id);
            }
            throw error;
        }
    },
    async _nextWave(strategy) {
        if (strategy._busy) return;
        strategy._busy = true;
        try { await this._spawnWave(this._waveIndex + 1); }
        catch (error) { this._waveError = error.message; }
        finally { strategy._busy = false; }
    },
    result() {
        const alive = Array.from(Game.entities.values()).filter((unit) => unit instanceof Enemy && !unit._strategicStructure && unit.active !== false && unit.hp > 0).length;
        const originals = new Set(this._originals.map(({ unit }) => unit));
        const summons = Array.from(Game.entities.values()).filter((unit) => unit._invasionRecord && !originals.has(unit))
            .map((unit) => ({ unit, record: unit._invasionRecord }));
        const roster = [...this._originals, ...summons].filter(({ unit }) => unit.active !== false && unit.hp > 0)
            .map(({ unit, record }) => captureInvasionUnit(unit, record));
        const structures = this._objectives.map(({ unit, record }) => ({ key: record.key, name: record.name, maxHp: record.maxHp, hp: unit?.hp > 0 ? unit.hp : 0 }));
        const victory = alive === 0 && structures.every((record) => record.hp <= 0) && this._waveIndex === this._waves.length - 1 && !this._waveError;
        return { alive, roster, summonLedger: this._summonContext?.ledger || null,
            structures, fortifications: this._siege?.result(), victory, waveIndex: this._waveIndex };
    },
    collectLoot() {
        return Array.from(Game.entities.values()).filter((unit) => unit instanceof DropItem && unit.active !== false)
            .map((unit) => JSON.parse(JSON.stringify(unit.itemData)));
    },
    canRetreat(player) {
        const zone = this._retreat;
        if (!zone) return false;
        return this._elapsed >= config.battle.retreatDelayMs && !player._isDead && player.data.hp > 0
            && Math.hypot((player.x - zone.x) / zone.radius, (player.y - zone.y) / (zone.radius * 0.5)) <= 1;
    },
    update(dt, strategy) {
        this._elapsed += dt;
        // Include ground-to-stair entry, but never start player defense production or waves.
        this._siege?.reconcileStairs();
        if (this._garrison) DefenseSystem._updateElevatedSurfaceStates(dt);
        this._garrison?.update(dt);
        this._hudAccumulator = (this._hudAccumulator || 0) + dt;
        if (this._hudAccumulator < 250) return;
        this._hudAccumulator = 0;
        const result = this.result();
        const label = this._hud?.querySelector('[data-battle-status]');
        if (label) label.textContent = this._waveError ? `下一波加载失败：${this._waveError}` :
            `敌军 ${result.alive} · 第${this._waveIndex + 1}/${this._waves.length}波 · ${result.structures.map((record) => `${record.name} ${Math.ceil(record.hp)}/${record.maxHp}`).join(' · ') || '野外接战'}`;
        const siegeHint = this._hud?.querySelector('[data-siege-hint]');
        const reinforcement = this._hud?.querySelector('[data-reinforcement-status]');
        if (reinforcement) {
            const inbound = strategy.state.detachments.filter((army) => army.destination === strategy.state.encounter?.cellId);
            reinforcement.textContent = inbound.length ? inbound.map((army) => {
                const route = strategy._supportRoute(army, strategy.state.encounter.cellId, true, army.waypoints || []);
                return `${army.name}：${army.cellId === strategy.state.encounter.cellId && !army.march ? (army.orderNote || '等待入场') : route ? `预计 ${formatStrategicTravelTime(route.durationMs)}` : '路线受阻'}`;
            }).join(' · ') : '暂无在途增援；可打开地图选分遣军，右键当前战场。';
        }
        if (siegeHint && this._siege) {
            const gate = result.fortifications.find((part) => part.key === 'gate');
            const damaged = result.fortifications.filter((part) => part.hp <= 0).length;
            siegeHint.textContent = `${this._siege.preset.name} · 城门 ${Math.ceil(gate.hp)}/${gate.maxHp} · 已破城防 ${damaged}处。远程守墙，近战约每${config.siege.ai.redeployMs / 1000}秒调防；可破门或拆侧墙，清除驻军与关键设施即可取胜。`;
        }
        const retreatCell = strategy.retreatCell();
        const button = this._hud?.querySelector('[data-battle-retreat]');
        if (button) button.disabled = !this.canRetreat(Game.player) || !retreatCell || strategy._busy;
        const retreatHint = this._hud?.querySelector('[data-retreat-hint]');
        if (retreatHint) retreatHint.textContent = this._elapsed < config.battle.retreatDelayMs
            ? `撤退准备 ${Math.ceil((config.battle.retreatDelayMs - this._elapsed) / 1000)} 秒；随后前往西侧标记区。`
            : !retreatCell ? '相邻地格均有敌军、敌方城镇或战事，当前无法安全撤退。'
                : this.canRetreat(Game.player) ? '已到达撤退集结区，可以撤离。' : `前往西侧撤退集结区（${Math.round(this._retreat.x)}, ${Math.round(this._retreat.y)}）。`;
        this._hud?.querySelectorAll('[data-battle-victory]').forEach((node) => {
            node.hidden = !result.victory || (node.dataset.battleVictory !== 'return' && !strategy.state.encounter.siteId)
                || (node.dataset.battleVictory === 'return' && !!strategy.state.encounter.siteId);
            node.disabled = strategy._busy || Game.player._isDead || !(Game.player.data.hp > 0);
        });
        const retry = this._hud?.querySelector('[data-battle-retry]');
        if (retry) { retry.hidden = !this._waveError; retry.disabled = strategy._busy; }
        if (!this._waveError && result.alive === 0 && this._waveIndex < this._waves.length - 1 && !Game.player._isDead) this._nextWave(strategy);
    },
    showHud(strategy) {
        this.hideHud();
        const hud = this._hud = document.createElement('section');
        hud.className = 'strategic-battle-hud';
        hud.setAttribute('aria-label', '位面遭遇战');
        hud.innerHTML = '<strong>菱形位面战场</strong><span data-battle-status></span><small data-reinforcement-status></small><button type="button" class="bp-button" data-reinforcement-map>打开大地图调遣增援</button><small data-retreat-hint></small><small>胜利后可继续拾取；确认返回时未拾取物品转入军团战利品，满包不会丢弃。</small><button type="button" class="bp-button" data-battle-retreat disabled>撤离战场</button><button type="button" class="bp-button" data-battle-retry hidden>重试加载下一波</button><button type="button" class="bp-button" data-battle-victory="return" hidden>收取战利品并返回地图</button><button type="button" class="bp-button" data-battle-victory="destroy" hidden>摧毁城镇 / 据点并返回</button>';
        if (this._siege) {
            hud.setAttribute('aria-label', '城镇攻城战');
            hud.querySelector('strong').textContent = '城镇攻城战';
            const hint = document.createElement('small');
            hint.dataset.siegeHint = '';
            hint.textContent = '城门锁闭；可破门或拆侧墙。守军会警戒、支援并限制追击距离。';
            hud.querySelector('[data-battle-status]').after(hint);
        }
        hud.querySelector('[data-battle-retreat]').onclick = () => strategy.finishBattle('retreat');
        hud.querySelector('[data-reinforcement-map]').onclick = () => strategy.openMap();
        hud.querySelector('[data-battle-retry]').onclick = () => this._nextWave(strategy);
        hud.querySelectorAll('[data-battle-victory]').forEach((node) => { node.onclick = () => strategy.finishBattle('victory', node.dataset.battleVictory); });
        document.body.appendChild(hud);
    },
    showReturnFailure(strategy, reason) {
        this.hideHud();
        const hud = this._hud = document.createElement('section');
        hud.className = 'strategic-battle-hud';
        hud.setAttribute('aria-label', '战场返回重试');
        hud.innerHTML = '<strong>返回地图未完成</strong><span role="status"></span><small>本次战损、携军记录和待结算结果已保留。战场操作已暂停，请重试返回；不会再次结算战斗。</small><button type="button" class="bp-button">重试返回地图</button>';
        hud.querySelector('[role="status"]').textContent = reason;
        const retry = hud.querySelector('button');
        retry.onclick = () => { retry.disabled = true; strategy.retryBattleReturn(); };
        document.body.appendChild(hud);
        retry.focus({ preventScroll: true });
    },
    hideHud() { this._hud?.remove(); this._hud = null; },
    reconcileSurfaces() {
        this._siege?.reconcileStairs();
        if (this._garrison) DefenseSystem.reconcileElevatedSurfaces();
    },
    _clearSiege() {
        this._garrison?.destroy();
        this._siege?.destroy();
        this._siege = null;
        this._garrison = null;
    },
    clearResult() { this._originals = []; this._objectives = []; this._waves = []; this._summonContext = null; this._clearSiege(); this._clearBattlefieldVisuals(); },
};
