// ============================================================
// HamsterWarriorSystem — 仓鼠战士在世界-122 的生成/拆除（2026-08-16）
// - setup(player)：进入世界-122 时在玩家附近找合法落点生成仓鼠战士，
//   注册进 Game.entities（主循环驱动 update）与 Game.friendlyUnits（渲染）；
// - teardown()：场景离场时移除（Phaser 精灵由 GameScene._syncCompanionSprites 清理）；
// - 死亡后不再自动复活；再次进入世界-122 时重新生成（与矿工原口径一致）。
// ============================================================
import { Game } from '../game.js';
import { HamsterWarrior } from '../entities/hamster-warrior.js';
import { WallSystem } from './wall-system.js';

const ENTITY_ID = 'hamster_warrior';
const WARRIOR_COUNT = 1;
const SPAWN_RADIUS = 90;
const COLLISION_RADIUS = 20;

export const HamsterWarriorSystem = {
    warriors: [],
    active: false,

    /** 世界-122 进入时初始化：清旧实例 → 生成 WARRIOR_COUNT 只 */
    setup(player) {
        this.teardown();
        this.active = true;
        if (!Array.isArray(Game.friendlyUnits)) Game.friendlyUnits = [];
        for (let i = 0; i < WARRIOR_COUNT; i++) {
            this._spawn(player, i);
        }
    },

    _spawn(player, idx) {
        const anchor = player || { x: 760, y: 2048 };
        const spot = this._findSpawn(anchor.x, anchor.y);
        const id = idx === 0 ? ENTITY_ID : `${ENTITY_ID}_${idx + 1}`;
        const warrior = new HamsterWarrior(spot.x, spot.y, { id });
        Game.entities.set(id, warrior);
        Game.friendlyUnits.push(warrior);
        this.warriors.push(warrior);
        return warrior;
    },

    /** 玩家附近合法落点（WallSystem 校验，兜底偏移 40,20） */
    _findSpawn(x, y) {
        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 30 + Math.random() * SPAWN_RADIUS;
            const sx = x + Math.cos(a) * d;
            const sy = y + Math.sin(a) * d;
            if (!WallSystem || !WallSystem.canMoveTo || WallSystem.canMoveTo(sx, sy, COLLISION_RADIUS)) {
                return { x: sx, y: sy };
            }
        }
        return { x: x + 40, y: y + 20 };
    },

    /** 场景离场拆除 */
    teardown() {
        for (const w of this.warriors) {
            if (!w) continue;
            w.active = false;
            if (Game && Game.entities && w.id) Game.entities.delete(w.id);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(w);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
        }
        this.warriors = [];
        this.active = false;
    },
};
