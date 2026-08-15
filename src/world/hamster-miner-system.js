// ============================================================
// HamsterMinerSystem — 仓鼠矿工在世界-122 的生成/拆除（2026-08-15）
// - setup(player)：在玩家/基地附近找合法落点生成仓鼠矿工，
//   注册进 Game.entities（主循环驱动 update）与 Game.friendlyUnits（渲染）；
// - teardown()：场景离场时移除（Phaser 精灵由 GameScene._syncCompanionSprites 清理）；
// - 死亡后不再自动复活；再次进入世界-122 时重新生成。
// ============================================================
import { Game } from '../game.js';
import { WallSystem } from './wall-system.js';
import { HamsterMiner } from '../entities/hamster-miner.js';

const ENTITY_KEY = 'hamster_miner';

export const HamsterMinerSystem = {
    miner: null,
    active: false,

    /** 世界-122 进入时生成（须在 DefenseSystem.setup / EnergyNodeSystem.setup 之后） */
    setup(player) {
        this.teardown();
        this.active = true;
        if (!Array.isArray(Game.friendlyUnits)) Game.friendlyUnits = [];
        if (!player) return;

        const spawn = this._findValidSpawn(player);
        const miner = new HamsterMiner(spawn.x, spawn.y);
        this.miner = miner;
        Game.entities.set(ENTITY_KEY, miner);
        Game.friendlyUnits.push(miner);
    },

    /** 场景离场拆除（实体由 switchScene 的 Game.entities.clear 兜底） */
    teardown() {
        if (this.miner) {
            this.miner.active = false;
            if (Game && Game.entities) Game.entities.delete(ENTITY_KEY);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(this.miner);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
            this.miner = null;
        }
        this.active = false;
    },

    /** 玩家附近合法落点：优先玩家左/右偏移，其次 8 方向螺旋，兜底 findSafeSpawn/玩家脚下 */
    _findValidSpawn(player) {
        const radius = 24;
        const candidates = [
            { x: player.x - 140, y: player.y + 40 },
            { x: player.x + 140, y: player.y + 40 },
        ];
        for (const dist of [150, 210, 280]) {
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                candidates.push({
                    x: player.x + Math.cos(angle) * dist,
                    y: player.y + Math.sin(angle) * dist,
                });
            }
        }
        if (WallSystem && typeof WallSystem.canMoveTo === 'function') {
            for (const c of candidates) {
                if (WallSystem.canMoveTo(c.x, c.y, radius)) return c;
            }
            if (typeof WallSystem.findSafeSpawn === 'function') {
                const r = WallSystem.findSafeSpawn(player.x, player.y, radius);
                if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return r;
            }
        }
        return { x: player.x, y: player.y };
    },
};
