// ============================================================
// HamsterShooterSystem — 仓鼠射手的生成/拆除（2026-08-16；2026-08-16 停用）
// - 用户口径：删除默认在基地旁生成的射手，单位改由「仓鼠兵营」30s 生成；
//   本文件保留（测试脚本引用），主流程 scene-manager 不再 setup。
// - setup(player)（已停用）：在玩家附近找合法落点生成仓鼠射手，
//   注册进 Game.entities（主循环驱动 update）与 Game.friendlyUnits（渲染）；
// - teardown()：场景离场时移除（Phaser 精灵由 GameScene._syncCompanionSprites 清理）；
// - 死亡后不再自动复活。
// ============================================================
import { Game } from '../game.js';
import { HamsterShooter } from '../entities/hamster-shooter.js';
import { WallSystem } from './wall-system.js';

const ENTITY_ID = 'hamster_shooter';
const SHOOTER_COUNT = 1;
const SPAWN_RADIUS = 90;
const COLLISION_RADIUS = 20;

export const HamsterShooterSystem = {
    shooters: [],
    active: false,

    /** 世界-122 进入时初始化：清旧实例 → 生成 SHOOTER_COUNT 只 */
    setup(player) {
        this.teardown();
        this.active = true;
        if (!Array.isArray(Game.friendlyUnits)) Game.friendlyUnits = [];
        for (let i = 0; i < SHOOTER_COUNT; i++) {
            this._spawn(player, i);
        }
    },

    _spawn(player, idx) {
        const anchor = player || { x: 760, y: 2048 };
        const spot = this._findSpawn(anchor.x, anchor.y);
        const id = idx === 0 ? ENTITY_ID : `${ENTITY_ID}_${idx + 1}`;
        const shooter = new HamsterShooter(spot.x, spot.y, { id });
        Game.entities.set(id, shooter);
        Game.friendlyUnits.push(shooter);
        this.shooters.push(shooter);
        return shooter;
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
        for (const s of this.shooters) {
            if (!s) continue;
            s.active = false;
            s._basic = null;
            if (Game && Game.entities && s.id) Game.entities.delete(s.id);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(s);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
        }
        this.shooters = [];
        this.active = false;
    },
};
