// ============================================================
// HamsterMinerSystem — 仓鼠矿工在世界-122 的生成/拆除（2026-08-15）
// - setup(player)：在玩家/基地附近找合法落点生成仓鼠矿工，
//   注册进 Game.entities（主循环驱动 update）与 Game.friendlyUnits（渲染）；
// - teardown()：场景离场时移除（Phaser 精灵由 GameScene._syncCompanionSprites 清理）；
// - 死亡后不再自动复活；再次进入世界-122 时重新生成。
// ============================================================
import { Game } from '../game.js';

const ENTITY_KEY = 'hamster_miner';

export const HamsterMinerSystem = {
    miner: null,
    active: false,

    /** 世界-122 进入时初始化（2026-08-15 起矿工改由「仓鼠小屋」建造生成，
     *  本系统不再自动生成免费矿工；保留 setup/teardown 兼容旧调用） */
    setup(_player) {
        this.teardown();
        this.active = true;
        if (!Array.isArray(Game.friendlyUnits)) Game.friendlyUnits = [];
        this.miner = null;
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
};
