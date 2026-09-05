import config from '../../data/invasion-campaign.json';
import producerBuildings from '../../data/producer-buildings.json';
import buildingUpgrades from '../../data/building-upgrades.json';
import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { TechnologySystem } from './technology-system.js';
import { TroopLineSystem } from './troop-line-system.js';
import { getWorldSnapshot } from './world122-snapshot.js';
import { strategicCell, strategicDistance } from './world-map-cells.js';
import { strategicNow, strategicDayDurationMs, strategicRoute, strategicStepMs } from './strategic-march.js';
import { invasionRosterWaves, invasionRosterSummary } from './invasion-formation.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function buildingReconRadius(building, fallback = 0) {
    const cfg = building?._cfg || producerBuildings[building?.cfgKey] || {};
    const modules = cfg.modules || buildingUpgrades[cfg.upgradeProject]?.modules || {};
    const entry = Object.entries(modules)
        .find(([, module]) => module?.effect === 'advancedResearchStrategicReconRadius');
    if (!entry) return Math.max(0, Number(fallback) || 0);
    const [moduleId, module] = entry;
    const savedModules = building?._cfg ? building.modules : building?.advancedResearchModules;
    const level = Math.max(0, Math.min(
        Math.floor(Number(module.maxLevel) || 0),
        Math.floor(Number(savedModules?.[moduleId]) || 0)
    ));
    return Math.max(0, (Number(module.base) || 0) + (Number(module.per) || 0) * level);
}

export const StrategicInvasionMarch = {
    // A single reserved data-only marker does not consume signal-guard/patrol slots.
    spawnInvasionMarch({ formation, targetWorld, worldEpoch, cycle, leadMs, now = strategicNow() }) {
        if (this.state.enemies.some((enemy) => enemy.invasion)) return null;
        this.ensureCampaign();
        const target = Progression.getWorldMapDiscovery(targetWorld);
        if (!target || !Progression.isWorldEpochCurrent(targetWorld, worldEpoch)) return null;
        const occupied = new Set([...this.state.enemies.map((enemy) => enemy.cellId),
            ...this.state.sites.map((site) => site.cellId), this.state.army?.cellId]);
        for (const sceneId of Progression.getWorldIds()) {
            const entry = Progression.getReservedWorldMapCell(sceneId);
            if (entry) occupied.add(entry.cellId);
        }
        const center = strategicCell(target.cellId), candidates = [], radius = config.march.maxSpawnDistance;
        for (let q = -radius; q <= radius; q++) {
            for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                const cell = strategicCell(`${center.q + q},${center.r + r}`);
                if (cell?.planeSceneId === targetWorld && !occupied.has(cell.id)
                    && strategicDistance(cell, center) >= config.march.minSpawnDistance) candidates.push(cell);
            }
        }
        // Try each nearby cell once, from a random offset. No rerolling the chosen family.
        const offset = Math.floor(this.random() * candidates.length);
        for (let index = 0; index < candidates.length; index++) {
            const cell = candidates[(offset + index) % candidates.length];
            const route = strategicRoute(cell.id, target.cellId, (next) => next.id === target.cellId || !occupied.has(next.id));
            if (!route?.length) continue;
            let previous = cell, duration = 0;
            for (const id of route) { const next = strategicCell(id); duration += strategicStepMs(previous, next); previous = next; }
            const type = Object.keys(this.config.enemyTypes).find((key) => this.config.enemyTypes[key].sceneId === targetWorld);
            const enemy = { id: `invasion_army_${this.state.nextId++}`, type, name: formation.familyName,
                cellId: cell.id, homeCellId: cell.id, destination: target.cellId, order: 'invasion', route: [...route],
                roster: clone(formation.waves.flat()),
                invasion: { cycle, targetWorld, worldEpoch, familyId: formation.familyId, familyName: formation.familyName,
                    seed: formation.seed, catalogVersion: formation.catalogVersion,
                    textureBytes: formation.textureBytes, threat: formation.threat, summonLedger: clone(formation.summonLedger),
                    habitat: formation.habitat, composition: formation.composition, departedAt: now,
                    plannedArrivalAt: now + leadMs, travelMultiplier: leadMs / duration, discovered: false } };
            this.state.enemies.push(enemy);
            this._stepInvasionMarch(enemy, now);
            this.refreshInvasionIntel(now);
            return enemy.id;
        }
        return null;
    },

    getVisibleEnemies() {
        return this.state.enemies.filter((enemy) => !enemy.invasion || enemy.invasion.discovered);
    },

    getInvasionReconSources() {
        const sources = [], recon = config.recon;
        const border = TechnologySystem.isCompleted(recon.borderPolicyId);
        const key = `${Math.floor(strategicNow() / 1000)}:${window.SceneManager?.currentScene}:${this.state.army?.cellId}:${border}:${[...this.state.detachments, ...this.state.settlers].map((army) => army.cellId).join(';')}`;
        if (this._invasionReconCache?.key === key) return this._invasionReconCache.sources;
        for (const city of this.getSettlements()) {
            if (city.foundedBy === 'settler' && city.owner === 'player' && city.status === 'active') {
                sources.push({ cellId: city.cellId, radius: this.config.settlers.reconRadius, label: '新城瞭望' });
            }
            if (city.owner !== 'player' || city.status === 'destroyed' || city.kind !== 'world') continue;
            let radius = border ? recon.borderBaseRadius : 0, label = border ? '边境侦察条例' : '基地近卫';
            const live = window.SceneManager?.currentScene === city.sceneId && window.Game?.ProducerBuildingSystem?.active;
            const snapshot = live ? null : getWorldSnapshot(city.sceneId);
            const buildings = live ? window.Game.ProducerBuildingSystem.buildings
                : snapshot?.worldEpoch === city.worldEpoch ? snapshot.structures || [] : [];
            for (const building of buildings || []) {
                const source = recon.buildingSources[building.cfgKey];
                if (!source || !(building.hp > 0) || building.active === false || building._sinking
                    || (Number(live ? building._assignedWorkers : building.assignedWorkers) || 0) < source.minWorkers) continue;
                const buildingRadius = buildingReconRadius(building, source.radius);
                if (buildingRadius > radius) {
                    radius = buildingRadius;
                    label = building.cfgKey === 'planar_observation_array' ? '位面观测阵列' : '天气预测塔';
                }
            }
            sources.push({ cellId: city.cellId, radius, label, sceneId: city.sceneId });
        }
        if (this.state.army && !this.state.army.defeated && this.inMap) {
            const scout = TroopLineSystem.serializeStrategicTroops().some((record) => record.count > 0 && record.hpRatio > 0
                && recon.scoutUnitKeys.includes(record.kind));
            sources.push({ cellId: this.state.army.cellId, radius: scout ? recon.scoutRadius : recon.armyRadius,
                label: scout ? '斥候部队侦察' : '出征部队侦察' });
        }
        for (const army of this.state.detachments) {
            const scout = TroopLineSystem.serializeStrategicTroops(army.id).some((record) => recon.scoutUnitKeys.includes(record.kind));
            sources.push({ cellId: army.cellId, radius: scout ? recon.scoutRadius : recon.armyRadius,
                label: scout ? '分遣斥候侦察' : '分遣军侦察' });
        }
        for (const unit of this.state.settlers) {
            sources.push({ cellId: unit.cellId, radius: this.config.settlers.reconRadius, label: '移民队瞭望' });
        }
        this._invasionReconCache = { key, sources };
        return sources;
    },

    refreshInvasionIntel(now = strategicNow()) {
        const hidden = this.state.enemies.filter((enemy) => enemy.invasion && !enemy.invasion.discovered);
        if (!hidden.length) return;
        const sources = this.getInvasionReconSources();
        const policy = TechnologySystem.isCompleted(config.recon.warningPolicyId);
        for (const enemy of hidden) {
            const intel = enemy.invasion;
            const source = sources.find((entry) => strategicDistance(strategicCell(enemy.cellId), strategicCell(entry.cellId)) <= entry.radius);
            const deadline = this.invasionArrivalAt(enemy, now);
            if (!source && !(policy && deadline - now <= config.recon.policyWarningDays * strategicDayDurationMs())) continue;
            intel.discovered = true; intel.discoveredAt = now;
            intel.discoverySource = source?.label || '位面预警协议';
            const world = Progression.getWorldConfig(intel.targetWorld)?.name || intel.targetWorld;
            const detail = `${intel.discoverySource}发现${intel.familyName}，正向${world}推进。${intel.composition}。`;
            this.recordEvent('invasion_warning', '发现位面入侵军团', detail, { cellId: enemy.cellId, sceneId: intel.targetWorld });
            this.notify(`⚠ ${detail}`);
        }
    },

    invasionArrivalAt(enemy, now = strategicNow()) {
        if (!enemy?.invasion) return null;
        const march = enemy.march;
        let at = march ? Math.max(now, march.startedAtGameTimeMs + march.durationGameMs) : now;
        let previous = strategicCell(march?.toCellId || enemy.cellId);
        const route = march ? enemy.route.slice(1) : enemy.route;
        for (const id of route || []) {
            const next = strategicCell(id);
            at += strategicStepMs(previous, next) * enemy.invasion.travelMultiplier;
            previous = next;
        }
        return at;
    },

    _stepInvasionMarch(enemy, now = strategicNow()) {
        const intel = enemy.invasion;
        if (!Progression.isWorldEpochCurrent(intel.targetWorld, intel.worldEpoch)
            || !Progression.isPortalConstructed(intel.targetWorld)) {
            this.state.enemies = this.state.enemies.filter((entry) => entry !== enemy);
            window.WorldInvasionSystem?.finishInvasionMarch?.(enemy.id);
            return;
        }
        if (this.state.encounter?.enemyId === enemy.id) return;
        if (enemy.cellId === enemy.destination && !enemy.march) {
            const accepted = window.WorldInvasionSystem?.startMarchedInvasion?.(enemy);
            if (accepted) this.state.enemies = this.state.enemies.filter((entry) => entry !== enemy);
            return; // A busy/protected city queues this army; no retargeting or duplicate siege.
        }
        if (enemy.march) return;
        while (enemy.route[0] === enemy.cellId) enemy.route.shift();
        const next = enemy.route[0];
        if (!next) return;
        this._startMarch(enemy, next, now);
        if (enemy.march) enemy.march.durationGameMs *= intel.travelMultiplier;
    },

    invasionEncounterWaves(enemy) { return invasionRosterWaves(enemy.roster); },

    applyInvasionInterception(enemy, result, victory, encounter) {
        if (result.summonLedger) enemy.invasion.summonLedger = clone(result.summonLedger);
        // result.roster covers only the current wave. Keep every unreached reserve.
        enemy.roster = victory ? [] : [...clone(result.roster), ...clone(encounter.waves.slice(result.waveIndex + 1).flat())];
        enemy.invasion.composition = invasionRosterSummary(enemy.roster);
        if (!enemy.roster.length) {
            this.state.enemies = this.state.enemies.filter((entry) => entry !== enemy);
            window.WorldInvasionSystem?.finishInvasionMarch?.(enemy.id);
            this.notify(`✓ 已在大地图击退${enemy.name}，本次基地入侵已解除`);
        }
    },
};
