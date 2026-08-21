import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { SceneManager } from '../world/scene-manager.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';
import { createGoldItem } from '../world/economy-gold-routing.js';
import { CONFIG } from '../config/config.js';
import equipmentData from '../../data/equipment.json';

const REWARD_POOLS = Object.freeze({
    scene11: ['philosopherStone', 'marble', 'moonstone'],
    scene10: ['potato', 'corn', 'carrot', 'cabbage', 'pumpkin', 'apple'],
    scene8: ['ironOre', 'copperOre', 'coalOre', 'quartz', 'silverOre', 'goldOre'],
});

export class HamsterExplorerAI {
    constructor(explorer) {
        this.m = explorer;
        this.cfg = explorer.aiConfig || {};
        this._destination = null;
        this._decisionTimer = 0;
        this._rewardTimer = this.cfg.rewardIntervalMs || 45000;
    }

    cancelForCommand() { this._destination = null; return true; }

    update(dt, entities) {
        const m = this.m;
        if (m._command?.mode !== 'explore') {
            m.maxSpeed = 0; m.vx = 0; m.vy = 0; m.isMoving = false; m._animState = 'idle';
            return;
        }
        this._rewardTimer -= dt;
        if (this._rewardTimer <= 0) {
            this._rewardTimer += Math.max(1000, Number(this.cfg.rewardIntervalMs) || 45000);
            this._grantReward();
        }
        this._decisionTimer -= dt;
        if (!this._destination || Math.hypot(this._destination.x - m.x, this._destination.y - m.y) <= (this.cfg.exploreArriveDist || 55)
            || this._decisionTimer <= 0) {
            this._decisionTimer = 5000 + Math.random() * 5000;
            this._destination = this._pickDestination();
        }
        if (!this._destination) return;
        m._tacticalTarget = this._destination;
        m.maxSpeed = this.cfg.walkSpeed || 165;
        m._animState = 'walk';
        MovementSystem.update(m, dt, entities);
    }

    _pickDestination() {
        const m = this.m;
        const radius = Math.max(200, Number(this.cfg.exploreRadius) || 1100);
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = 180 + Math.random() * radius;
            const x = Math.max(100, Math.min(CONFIG.WORLD_WIDTH - 100, m.x + Math.cos(angle) * distance));
            const y = Math.max(100, Math.min(CONFIG.WORLD_HEIGHT - 100, m.y + Math.sin(angle) * distance));
            if (!WallSystem?.canMoveTo || WallSystem.canMoveTo(x, y, m.groundRadius || 20)) return { x, y };
        }
        return null;
    }

    _grantReward() {
        const pool = REWARD_POOLS[SceneManager.currentScene] || [];
        if (!pool.length) return;
        const key = pool[Math.floor(Math.random() * pool.length)];
        const item = equipmentData.equipment?.[key];
        if (item) {
            const tribute = JSON.parse(JSON.stringify(item));
            tribute.stack = 1;
            const accepted = WarehouseSystem.depositItemAmount(tribute);
            const game = typeof window !== 'undefined' ? window.Game : null;
            if (accepted < 1) game?.dropItem?.(this.m.x, this.m.y, tribute);
        }
        const min = Math.max(0, Number(this.cfg.rewardGoldMin) || 0);
        const max = Math.max(min, Number(this.cfg.rewardGoldMax) || min);
        const amount = Math.floor(min + Math.random() * (max - min + 1));
        const gold = createGoldItem(amount);
        const acceptedGold = WarehouseSystem.depositItemAmount(gold);
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (acceptedGold < amount) game?.dropItem?.(this.m.x, this.m.y, createGoldItem(amount - acceptedGold));
    }
}
