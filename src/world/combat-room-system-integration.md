/**
 * ============================================================
 * CombatRoomSystem 集成补丁 — dungeon-map-system.js
 * ============================================================
 *
 * 以下是需要在 dungeon-map-system.js 中进行的修改。
 * 这些修改将原有硬编码的战斗场地生成替换为 CombatRoomSystem 调用。
 */

// ========== 1. 文件顶部导入 ==========
// 在现有导入之后添加：

import { CombatRoomSystem, COMBAT_ROOM_CONFIG } from './combat-room-system.js';

// ========== 2. 移除旧常量（可选）==========
// 以下常量可由 CombatRoomSystem 配置替代，可删除或保留为兼容：
//
//   COMBAT_ROOM_SIZE: 1024,   // ← 由 COMBAT_ROOM_CONFIG.roomSize 替代
//   BOSS_ROOM_SIZE:   1024,   // ← 由 COMBAT_ROOM_CONFIG.roomSize.boss 替代
//   WALL_THICKNESS:   20,     // ← 由 COMBAT_ROOM_CONFIG.walls.thickness 替代

// ========== 3. 修改 _enterCombat 方法 ==========
// 替换原有 _enterCombat 方法体：

_enterCombat(node) {
    if (this.dungeonType === 'zombie') {
        this._enterZombieCombat(node);
        return;
    }
    this._prepareCombatMode(false);

    // 使用 CombatRoomSystem 生成战斗场地
    CombatRoomSystem.enterCombatRoom(this.player, false);
    CombatRoomSystem.spawnMonsters(3, false);

    EffectManager.add(new FloatingTextEffect(512, 400, "进入战斗！消灭所有敌人", "#ff4444"));
}

// ========== 4. 修改 _enterBoss 方法 ==========
// 替换原有 _enterBoss 方法体：

_enterBoss(node) {
    if (this.dungeonType === 'zombie') {
        this._enterZombieCombat(node);
        return;
    }
    this._prepareCombatMode(true);

    // 使用 CombatRoomSystem 生成 Boss 场地（4096 固定大小）
    CombatRoomSystem.enterCombatRoom(this.player, true);
    CombatRoomSystem.spawnMonsters(1, true);

    EffectManager.add(new FloatingTextEffect(512, 400, "Boss 战！", "#ff0000"));
}

// ========== 5. 修改 _generateRoom 方法（可选保留为兼容）==========
// 原 _generateRoom 方法可以保留为空壳或删除，所有逻辑已移至 CombatRoomSystem：

_generateRoom(isBoss) {
    // 已迁移到 CombatRoomSystem
    // 保留此方法以避免外部调用报错（空实现）
    console.log('[DungeonMapSystem] _generateRoom is deprecated, use CombatRoomSystem instead');
}

// ========== 6. 修改 _spawnMonsters 方法（可选保留为兼容）==========
// 原 _spawnMonsters 方法可以保留为空壳或删除：

_spawnMonsters(count, isBoss) {
    // 已迁移到 CombatRoomSystem
    // 保留此方法以避免外部调用报错（空实现）
    console.log('[DungeonMapSystem] _spawnMonsters is deprecated, use CombatRoomSystem instead');
}

// ========== 7. 修改 _cleanupCombat 方法 ==========
// 在原有清理逻辑基础上，添加 CombatRoomSystem 清理：

_cleanupCombat() {
    // 清理 CombatRoomSystem 管理的场地和怪物
    CombatRoomSystem.cleanupRoom();

    // 保留原有的 UI 和状态清理（以下代码保持不变）
    this._combatMonsters = [];
    this._combatMonsterKeys = [];
    this._combatRoomWalls = [];
    this._combatRoomObstacles = [];
    this._combatEntrance = null;
    this._zombieWaveActive = false;
    this._zombieCombat = null;
    this._zombieCombatNode = null;
    this._waveTransitioning = false;
    this._cleanupActive = false;
    this._cleanupTimer = 0;
    this._removeCleanupOverlay();

    // 墙壁恢复已由 CombatRoomSystem.cleanupRoom() 处理
    // 以下代码不再需要（CombatRoomSystem 会自动恢复）：
    // WallSystem.walls = [...this._backupWalls];
    // if (WallSystem._syncWallsToPhaser) { WallSystem._syncWallsToPhaser(); }
    // if (typeof pathFinder !== 'undefined') { pathFinder.invalidateCache(); }
}

// ========== 8. 修改 _cleanupCombatWallsOnly 方法 ==========
// 用于僵尸地牢多波次战斗，仅清理怪物：

_cleanupCombatWallsOnly() {
    // 使用 CombatRoomSystem 仅清理怪物（保留场地）
    CombatRoomSystem.cleanupMonstersOnly();
}

// ========== 9. 修改 updateCombat 方法（可选增强）==========
// 可以使用 CombatRoomSystem 检查战斗完成状态：

updateCombat(dt) {
    if (!this.active || (this.state !== "combat" && this.state !== "boss")) return;

    // 打扫战场倒计时中
    if (this._cleanupActive) {
        this._cleanupTimer -= dt;
        if (this._cleanupTimer <= 0) {
            this._cleanupTimer = 0;
            this._cleanupActive = false;
            this._removeCleanupOverlay();
            this._cleanupCombat();
            this._returnToMap();
        } else if (this._cleanupOverlay) {
            const seconds = Math.ceil(this._cleanupTimer / 1000);
            this._cleanupOverlay.textContent = `打扫战场中... ${seconds}秒后返回地图`;
        }
        return;
    }

    this._combatCheckTimer += dt;
    if (this._combatCheckTimer >= 500) {
        this._combatCheckTimer = 0;

        // 使用 CombatRoomSystem 检查战斗完成（替代原有的 _checkCombatComplete）
        if (CombatRoomSystem.isCombatComplete()) {
            this._onCombatComplete();
        }
    }
}

// 新增：战斗完成回调
_onCombatComplete() {
    if (this._cleanupActive) return;

    // 僵尸地牢：检查是否还有下一波
    if (this.dungeonType === 'zombie' && this.state === "combat" && this._zombieWaveActive) {
        if (this._zombieCombat && !this._zombieCombat.isComplete) {
            if (this._waveTransitioning) return;
            this._waveTransitioning = true;
            setTimeout(() => {
                this._waveTransitioning = false;
                if (this.active && this.state === "combat") {
                    CombatRoomSystem.cleanupMonstersOnly();
                    this._spawnZombieWave();
                }
            }, 1500);
            return;
        }
    }

    // 所有波次/战斗完成，开始打扫战场倒计时
    this._cleanupActive = true;
    this._cleanupTimer = CombatRoomSystem.config.cleanup.countdownMs;

    const gold = CombatRoomSystem.getGoldReward(this.state === "boss");
    EffectManager.add(new FloatingTextEffect(512, 400, `战斗完成！获得 ${gold} 金币`, "#44ff44"));

    this._showCleanupOverlay();
}

// ========== 10. 修改 _checkCombatComplete 方法（标记为废弃）==========
_checkCombatComplete() {
    // 已迁移到 updateCombat 中的 CombatRoomSystem.isCombatComplete()
    // 保留空实现以兼容旧代码
}

// ========== 11. 修改 init 方法（可选）==========
// 在 init 中重置 CombatRoomSystem 状态：

init(sceneId, player, dungeonType = 'default') {
    // ... 原有代码 ...

    // 确保 CombatRoomSystem 已清理
    if (CombatRoomSystem.active) {
        CombatRoomSystem.cleanupRoom();
    }

    this.generateMap();
    // ... 原有代码 ...
}

// ========== 12. 修改 shutdown 方法（可选）==========
// 在 shutdown 中清理 CombatRoomSystem：

shutdown() {
    // ... 原有代码 ...

    // 清理 CombatRoomSystem
    if (CombatRoomSystem.active) {
        CombatRoomSystem.cleanupRoom();
    }

    if (this._backupCameraFollow) {
        Camera.follow = this._backupCameraFollow;
    }
    // ... 原有代码 ...
}

// ========== 13. 场景管理器集成（scene-manager.js）==========
// 在 switchScene 方法中添加清理：

async switchScene(sceneId, player, mode) {
    // ... 原有代码 ...

    // 清理 CombatRoomSystem（如果活跃）
    if (typeof CombatRoomSystem !== 'undefined' && CombatRoomSystem.active) {
        CombatRoomSystem.cleanupRoom();
    }

    // 清理当前场景...
    Game.entities.clear();
    // ... 原有代码 ...
}

// ========== 14. 配置覆盖示例（可在 expedition-system.js 中使用）==========
// 根据地牢类型调整战斗场地配置：

onDungeonSelect(value) {
    this.selectedDungeon = value;
    this._updateDungeonInfo(value);

    // 根据地牢类型调整 CombatRoomSystem 配置
    if (value === 'zombie') {
        COMBAT_ROOM_CONFIG.monsterSpawn.count.normal = 5;
        COMBAT_ROOM_CONFIG.monsterPool.normal = [FastZombie, SpitterZombie, FatZombie];
    } else {
        COMBAT_ROOM_CONFIG.monsterSpawn.count.normal = 3;
        COMBAT_ROOM_CONFIG.monsterPool.normal = [BlackWolf, Rifleman, MachineGunner];
    }
}
