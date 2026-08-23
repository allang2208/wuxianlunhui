// ============================================================
// HamsterGuardSystem — 仓鼠盾卫的生成/拆除（2026-08-16；停用）
// - 与仓鼠战士同口径：默认不由主流程生成，单位由通用仓鼠军营按45s周期生成
//   （ProducerBuilding 面板切到「仓鼠盾卫」后生效）；
//   本文件保留（测试脚本引用），主流程 scene-manager 不 setup。
// - teardown()：场景离场时移除（Phaser 精灵由 GameScene._syncCompanionSprites 清理）。
// ============================================================
import { Game } from '../game.js';
import { HamsterGuard } from '../entities/hamster-guard.js';
import { WallSystem } from './wall-system.js';

const ENTITY_ID = 'hamster_guard';
const GUARD_COUNT = 1;
const SPAWN_RADIUS = 90;
const COLLISION_RADIUS = 20;

export const HamsterGuardSystem = {
    guards: [],
    active: false,

    /** 世界-122 进入时初始化：清旧实例 → 生成 GUARD_COUNT 只 */
    setup(player) {
        this.teardown();
        this.active = true;
        if (!Array.isArray(Game.friendlyUnits)) Game.friendlyUnits = [];
        for (let i = 0; i < GUARD_COUNT; i++) {
            this._spawn(player, i);
        }
    },

    _spawn(player, idx) {
        const anchor = player || { x: 450, y: 2150 };
        const spot = this._findSpawn(anchor.x, anchor.y);
        const id = idx === 0 ? ENTITY_ID : `${ENTITY_ID}_${idx + 1}`;
        const guard = new HamsterGuard(spot.x, spot.y, { id });
        Game.entities.set(id, guard);
        Game.friendlyUnits.push(guard);
        this.guards.push(guard);
        return guard;
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
        for (const g of this.guards) {
            if (!g) continue;
            g.active = false;
            if (Game && Game.entities && g.id) Game.entities.delete(g.id);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(g);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
        }
        this.guards = [];
        this.active = false;
    },
};
