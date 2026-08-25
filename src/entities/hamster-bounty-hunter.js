import { HamsterMusketeer } from './hamster-musketeer.js';
import configData from '../../data/hamster-bounty-hunter-config.json';
import { routeProducedGold, createGoldItem } from '../world/economy-gold-routing.js';

export class HamsterBountyHunter extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...configData,
            ...overrides,
            ai: { ...configData.ai, ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterBountyHunter = true;
        this._bountyGoldMultiplier = Math.max(0, Number(configData.bountyGoldMultiplier) || 0);
        this.name = configData.name;
        this.animId = configData.id;
        this.configureCollisionFromArchive({
            ...configData,
            ...overrides,
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        });
    }

    applyBarracksUpgrades(upgrades = {}) {
        super.applyBarracksUpgrades(upgrades);
        if (Number.isFinite(upgrades.bountyGoldMultiplier)) {
            this._bountyGoldMultiplier = Math.max(0, upgrades.bountyGoldMultiplier);
        }
    }

    onEnemyKilled(target) {
        if (!target || target._summoned || target._bountyRewarded) return;
        target._bountyRewarded = true;
        const defaultGold = Math.max(0, Math.floor(Number(target._defaultDungeonGoldReward) || 0));
        const amount = Math.floor(defaultGold * this._bountyGoldMultiplier);
        if (amount <= 0) return;
        const routed = routeProducedGold(amount);
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (routed.remaining > 0) game?.dropItem?.(target.x, target.y, createGoldItem(routed.remaining));
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 21);
        const fps = Math.max(1, Number(dying.frameRate) || 24);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
