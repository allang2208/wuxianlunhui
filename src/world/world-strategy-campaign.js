import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { worldMapPlaneCells, strategicCell, strategicDistance } from './world-map-cells.js';
import { damageStrategicRoster, strategicRosterPower } from './strategic-roster.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import { isInfiniteResourcesEnabled } from '../config/dev-cheats.js';
import worldConfig from '../../data/world-system.json';
import { getWorldSnapshot } from './world122-snapshot.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const invasion = () => window.WorldInvasionSystem;

export const StrategicCampaign = {
    ensureCampaign() {
        if (this.state.campaignInitialized) { this.ensureSiegeDefenders(); return; }
        this.state.sites ||= []; this.state.sieges ||= []; this.state.pendingLoot ||= [];
        const occupied = new Set(this.state.sites.map((site) => site.cellId));
        for (const sceneId of Progression.getWorldIds()) {
            const signal = Progression.getReservedWorldMapCell(sceneId);
            if (signal) occupied.add(signal.cellId);
        }
        for (const [type, enemy] of Object.entries(this.config.enemyTypes)) {
            for (const kind of ['town', 'outpost']) {
                const count = this.config.campaign[kind === 'town' ? 'townsPerPlane' : 'outpostsPerPlane'];
                for (let index = 0; index < count; index++) {
                    const pool = worldMapPlaneCells(enemy.sceneId).filter((cell) => !occupied.has(cell.id));
                    const cell = pool[Math.floor(this.random() * pool.length)];
                    if (!cell) continue;
                    occupied.add(cell.id);
                    const definition = this.config.sites[kind];
                    this.state.sites.push({ id: `${kind}_${enemy.sceneId}_${index}`, kind, enemyType: type,
                        name: `${Progression.getWorldConfig(enemy.sceneId).name} · ${definition.name}`,
                        sceneId: enemy.sceneId, cellId: cell.id, owner: 'enemy', status: 'active', generation: 1,
                        structures: definition.structures.map((structure) => ({ ...structure, maxHp: structure.hp })),
                        roster: this.makeRoster(type, definition.guardMultiplier), lastSpawnTick: this.state.tick });
                }
            }
        }
        this.state.campaignInitialized = true;
        this.ensureSiegeDefenders();
        Progression.setStrategicSiteCells(this.state.sites);
    },
    ensureSiegeDefenders() {
        const preset = this.config.siege.rangedDefenders;
        for (const site of this.state.sites || []) {
            if (site.garrisonVersion >= preset.version) continue;
            if (this.state.encounter?.siteId === site.id) continue;
            // Upgrade the persistent roster once, never replenish survivors on battle re-entry.
            if (site.owner === 'enemy' && site.status === 'active') {
                site.roster ||= [];
                for (let index = 0; index < (preset[site.kind] || 0); index++) {
                    const slot = `wall_ranged_${index}`;
                    if (!site.roster.some((record) => record.slot === slot)) {
                        site.roster.push({ slot, type: preset.type, hpRatio: 1, siegeRole: 'ranged' });
                    }
                }
            }
            site.garrisonVersion = preset.version;
        }
    },
    makeRoster(type, multiplier = 1) {
        return this.config.enemyTypes[type].roster.flatMap(({ type: unitType, count }) =>
            Array.from({ length: count * multiplier }, (_, index) => ({ slot: `${unitType}_${index}`, type: unitType, hpRatio: 1 })));
    },
    getSettlements() {
        const sites = (this.state.sites || []).map((site) => ({ ...site,
            hp: site.structures.reduce((sum, record) => sum + record.hp, 0),
            maxHp: site.structures.reduce((sum, record) => sum + record.maxHp, 0) }));
        for (const sceneId of Progression.getWorldIds()) {
            const portal = Progression.getPortalState(sceneId), entry = Progression.getWorldMapDiscovery(sceneId);
            if (!portal.everConstructed || !entry) continue;
            const cityHallKey = Progression.config.playerBase?.cfgKey || 'city_hall';
            const cityHall = getWorldSnapshot(sceneId)?.structures?.find((structure) =>
                structure?.cfgKey === cityHallKey && Number(structure.hp) > 0);
            const anchored = !portal.destroyed || !!cityHall;
            sites.push({ id: `world_${sceneId}`, kind: 'world', sceneId, cellId: entry.cellId,
                name: Progression.getWorldConfig(sceneId).name, worldEpoch: portal.worldEpoch,
                owner: anchored ? 'player' : 'none', status: anchored ? 'active' : 'destroyed',
                portalAlive: !portal.destroyed, cityHallAlive: !!cityHall,
                hp: Math.max(0, Number(portal.hp) || 0) + Math.max(0, Number(cityHall?.hp) || 0),
                maxHp: worldConfig.portal.maxHp + Math.max(0, Number(cityHall?.maxHp) || 5000) });
        }
        return sites;
    },
    getWars() {
        const cities = this.getSettlements();
        return [...(invasion()?.getBattles?.() || []).map((war) => ({ ...war,
            targetId: `world_${war.targetWorld}`, cellId: cities.find((city) => city.id === `world_${war.targetWorld}`)?.cellId,
            name: Progression.getWorldConfig(war.targetWorld)?.name, source: 'world' })),
        ...(this.state.sieges || []).map((war) => ({ ...war, source: 'site',
            cellId: cities.find((city) => city.id === war.targetId)?.cellId,
            name: cities.find((city) => city.id === war.targetId)?.name }))];
    },
    attackSettlement(id, disposition = 'destroy', { waypoints = [] } = {}) {
        const site = this.getSettlements().find((item) => item.id === id);
        if (!site || site.kind === 'world' || site.owner !== 'enemy' || site.status === 'destroyed') return { ok: false, reason: '该目标不是可进攻的敌方城镇或据点' };
        const result = this.moveTo(site.cellId, { allowHostileTarget: true, waypoints });
        if (result.ok) Object.assign(this.state.army, { targetId: id, disposition: 'destroy',
            orderNote: `行军摧毁：${site.name}。仅目标格允许接战，沿途绕开其他已知敌方占格。` });
        return result;
    },
    pursueEnemy(id, { waypoints = [] } = {}) {
        const enemy = this.getVisibleEnemies().find((item) => item.id === id);
        if (!enemy) return { ok: false, reason: '敌军已离开或被消灭' };
        const result = this.moveTo(enemy.cellId, { allowHostileTarget: true, waypoints });
        if (result.ok) Object.assign(this.state.army, { pursueId: id, orderNote: `追击${enemy.name}；每到一格按敌军当前位置重新规划。` });
        return result;
    },
    relieveWar(id, { waypoints = [] } = {}) {
        const war = this.getWars().find((item) => item.id === id);
        if (!war?.cellId) return { ok: false, reason: '该处战事已经结束' };
        if (war.enemyId) return this.pursueEnemy(war.enemyId, { waypoints });
        const result = this.moveTo(war.cellId, { allowHostileTarget: true, waypoints });
        if (result.ok) Object.assign(this.state.army, { reliefWarId: id, orderNote: `行军解围：${war.name}。抵达后进入解围战场。` });
        return result;
    },
    settlementRepairQuote(id) {
        const site = this.state.sites.find((item) => item.id === id);
        const cost = CrossPlaneResourceSystem.quote(this.config.campaign.repairCost);
        const free = isInfiniteResourcesEnabled();
        if (free) Object.assign(cost, { gold: 0, energy: 0, food: 0 });
        let reason = !this.inMap || this._busy || window.SceneManager?.isLoading || this.state.army?.defeated
            || !site || site.owner !== 'player' || site.status === 'destroyed'
            || site.cellId !== this.state.army?.cellId || this.getWars().some((war) => war.targetId === id)
            ? '请由亲征军团抵达未交战的我方据点再修复' : '';
        if (!reason && site.structures.every((record) => record.hp >= record.maxHp)) reason = '设施完好，无需修复';
        for (const [resource, name] of [['gold', '金币'], ['energy', '能量'], ['food', '粮食']]) {
            if (!reason && cost[resource] > 0 && CrossPlaneResourceSystem.getAvailable(resource) < cost[resource]) {
                reason = `${name}不足（需 ${cost[resource]}）`;
            }
        }
        return { ...cost, free, ok: !reason, reason, price: [cost.gold, cost.energy, cost.food, free] };
    },
    repairSettlement(id, expectedPrice = null) {
        const quote = this.settlementRepairQuote(id);
        if (!quote.ok) return quote;
        // A changed protocol or debug setting must refresh the displayed price before payment.
        if (expectedPrice && (!Array.isArray(expectedPrice) || expectedPrice.length !== quote.price.length
            || quote.price.some((value, index) => value !== expectedPrice[index]))) {
            return { ok: false, reason: '修复报价已变化，未扣款；请查看更新后的费用再点击。' };
        }
        const site = this.state.sites.find((item) => item.id === id);
        // Pass the base cost: the shared payment applies the same multiplier exactly once.
        const payment = payBuildingUpgradeCost(this.config.campaign.repairCost);
        if (!payment.ok) return payment;
        for (const record of site.structures) record.hp = Math.min(record.maxHp, record.hp + record.maxHp * this.config.campaign.repairRatio);
        return { ok: true };
    },
    commandSiege(enemyId, targetId) {
        const enemy = this.state.enemies.find((item) => item.id === enemyId);
        const city = this.getSettlements().find((item) => item.id === targetId);
        if (!enemy || enemy.invasion || enemy.objective || enemy.warId || enemy.detachmentBattleId || this.state.encounter?.enemyId === enemyId
            || !city || city.owner !== 'player' || city.status === 'destroyed') return { ok: false, reason: '攻城军团或目标无效' };
        Object.assign(enemy, { order: 'siege', targetId, targetEpoch: city.worldEpoch || city.generation, destination: city.cellId, route: [] });
        return { ok: true };
    },
    _reconcileCampaignWars() {
        for (const war of invasion()?.getBattles?.() || []) {
            const enemy = this.state.enemies.find((item) => item.id === war.enemyId);
            if (enemy && !war.suspended && war.roster) enemy.roster = clone(war.roster);
        }
        for (const result of invasion()?.takeStrategicResults?.() || []) {
            const enemy = this.state.enemies.find((item) => item.id === result.enemyId);
            if (!enemy) continue;
            if (result.victory || !result.roster.length) this.state.enemies = this.state.enemies.filter((item) => item !== enemy);
            else Object.assign(enemy, { roster: result.roster, warId: null, targetId: null, order: 'wander', destination: null });
        }
        for (const war of [...this.state.sieges]) {
            const enemy = this.state.enemies.find((item) => item.id === war.enemyId);
            const site = this.state.sites.find((item) => item.id === war.targetId);
            if (!enemy || !site || site.status === 'destroyed' || site.owner !== 'player') {
                this.state.sieges = this.state.sieges.filter((item) => item !== war);
                if (enemy) Object.assign(enemy, { warId: null, targetId: null, order: 'wander', destination: null });
            }
        }
        const currentWars = new Set([...(invasion()?.getBattles?.() || []), ...this.state.sieges].map((war) => war.id));
        for (const enemy of this.state.enemies) {
            if (enemy.warId && !currentWars.has(enemy.warId)) Object.assign(enemy, { warId: null, targetId: null, order: 'wander', destination: null });
        }
    },
    _advanceCampaign() {
        this._reconcileCampaignWars();
        const cities = this.getSettlements(), tick = this.state.tick, cfg = this.config.campaign;
        if (tick % cfg.enemyDecisionTicks === 0) {
            const assigned = new Set(this.state.enemies.map((enemy) => enemy.targetId).filter(Boolean));
            for (const enemy of this.state.enemies) {
                if (enemy.invasion || enemy.objective || enemy.warId || enemy.detachmentBattleId || enemy.manualOrder || enemy.order === 'siege' || this.state.encounter?.enemyId === enemy.id) continue;
                const eligible = cities.filter((city) => city.owner === 'player' && city.status !== 'destroyed'
                    && !(city.kind === 'world' && Progression.isWorldInvasionProtected(city.sceneId)));
                eligible.sort((a, b) => Number(assigned.has(a.id)) - Number(assigned.has(b.id))
                    || strategicDistance(strategicCell(enemy.cellId), strategicCell(a.cellId)) - strategicDistance(strategicCell(enemy.cellId), strategicCell(b.cellId)));
                if (eligible[0]) { this.commandSiege(enemy.id, eligible[0].id); assigned.add(eligible[0].id); }
            }
        }
        for (const enemy of this.state.enemies) {
            if (enemy.order !== 'siege' || enemy.warId || enemy.detachmentBattleId || this.state.encounter?.enemyId === enemy.id) continue;
            const city = cities.find((item) => item.id === enemy.targetId && item.owner === 'player' && item.status !== 'destroyed'
                && (item.worldEpoch || item.generation) === enemy.targetEpoch);
            if (!city) { Object.assign(enemy, { order: 'wander', targetId: null, destination: null }); continue; }
            enemy.destination = city.cellId;
            if (enemy.cellId !== city.cellId) continue;
            if (city.kind === 'world') {
                const result = invasion()?.startStrategicSiege?.({ enemyId: enemy.id, targetWorld: city.sceneId, worldEpoch: city.worldEpoch, roster: enemy.roster });
                if (result?.ok) enemy.warId = result.id;
            } else if (!this.state.sieges.some((war) => war.targetId === city.id)) {
                enemy.warId = `site_siege_${this.state.nextId++}`;
                this.state.sieges.push({ id: enemy.warId, targetId: city.id, enemyId: enemy.id, startedTick: tick });
                this.notify(`${city.name}遭到敌军围攻`);
            }
        }
        if (tick % cfg.siegeStepTicks === 0) {
            for (const war of this.state.sieges) {
                if (this.state.encounter?.enemyId === war.enemyId) continue;
                const site = this.state.sites.find((item) => item.id === war.targetId);
                const enemy = this.state.enemies.find((item) => item.id === war.enemyId);
                if (!site || !enemy) continue;
                const fullHp = site.structures.reduce((sum, record) => sum + record.maxHp, 0);
                const hp = site.structures.reduce((sum, record) => sum + record.hp, 0);
                const defense = this.config.sites[site.kind].defenseDps * hp / Math.max(1, fullHp);
                const attackers = strategicRosterPower(enemy.roster);
                const seconds = Math.min(cfg.siegeStepTicks * this.config.tickMs / 1000,
                    defense > 0 ? attackers.hp / defense : Infinity);
                let damage = attackers.dps * seconds * 0.45;
                for (const structure of [...site.structures].reverse()) {
                    const dealt = Math.min(structure.hp, damage); structure.hp -= dealt; damage -= dealt;
                }
                enemy.roster = damageStrategicRoster(enemy.roster, defense * seconds);
                if (site.structures.every((record) => record.hp <= 0)) {
                    site.status = 'destroyed'; site.owner = 'none'; site.roster = [];
                    if (site.foundedBy === 'settler') site.population = 0;
                    this.notify(`${site.name}已被摧毁，废墟位置保留`);
                }
                if (!enemy.roster.length) this.state.enemies = this.state.enemies.filter((item) => item !== enemy);
            }
            this._reconcileCampaignWars();
        }
        for (const site of this.state.sites) {
            if (site.kind !== 'town' || site.owner !== 'enemy' || site.status !== 'active'
                || site.detachmentBattleId || this.state.encounter?.siteId === site.id || tick - site.lastSpawnTick < cfg.townSpawnTicks) continue;
            const barracks = site.structures.find((record) => record.key === 'barracks');
            if (!barracks || barracks.hp <= 0) continue;
            const spawned = this.spawnEnemy(site.enemyType, { cellId: site.cellId });
            if (spawned.ok) { site.lastSpawnTick = tick; this.state.enemies.find((enemy) => enemy.id === spawned.id).homeSiteId = site.id; }
        }
    },
    applySettlementResult(siteId, result, victory, disposition) {
        const site = this.state.sites.find((item) => item.id === siteId);
        if (!site) return;
        site.roster = clone(result.roster);
        // Optional on old saves. Only a resolved/retreated battle writes wall and gate damage.
        if (result.fortifications) site.fortifications = clone(result.fortifications);
        for (const structure of site.structures) {
            const actual = result.structures?.find((item) => item.key === structure.key);
            if (actual) structure.hp = Math.max(0, actual.hp);
        }
        if (!victory) return;
        site.owner = 'none'; site.status = 'destroyed';
        for (const structure of site.structures) structure.hp = 0;
        site.roster = []; site.resolvedTick = this.state.tick;
    },
};
