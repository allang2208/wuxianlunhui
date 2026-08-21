import { HamsterMusketeer } from './hamster-musketeer.js';
import configData from '../../data/hamster-bounty-hunter-config.json';
import { routeProducedGold, createGoldItem } from '../world/economy-gold-routing.js';

export class HamsterBountyHunter extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, { ...configData, ...overrides, ai: { ...configData.ai, ...(overrides.ai || {}) } });
        this._isHamsterBountyHunter = true;
        this.name = configData.name;
    }

    onEnemyKilled(target) {
        if (!target || target._summoned || target._bountyRewarded) return;
        target._bountyRewarded = true;
        const min = Math.max(0, Number(configData.bountyGoldMin) || 0);
        const max = Math.max(min, Number(configData.bountyGoldMax) || min);
        const amount = Math.floor(min + Math.random() * (max - min + 1));
        const routed = routeProducedGold(amount);
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (routed.remaining > 0) game?.dropItem?.(target.x, target.y, createGoldItem(routed.remaining));
    }
}
