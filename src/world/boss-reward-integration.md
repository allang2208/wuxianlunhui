/**
 * BossRewardSystem 与现有系统集成说明
 * ===================================
 * 
 * 本文档说明如何将 boss-reward-system.js 集成到现有地牢系统中。
 */

// ============================================================
// 1. main.js 修改（添加导入和全局挂载）
// ============================================================

// 在 main.js 的导入区域添加：
import { BossRewardSystem, BigBoss, BossBattleManager, RewardNodeManager, DungeonBuffSystem } from './world/boss-reward-system.js';

// 在 initModules() 的全局挂载区域添加：
window.BossRewardSystem = BossRewardSystem;
window.BigBoss = BigBoss;
window.BossBattleManager = BossBattleManager;
window.RewardNodeManager = RewardNodeManager;
window.DungeonBuffSystem = DungeonBuffSystem;

// ============================================================
// 2. dungeon-map-system.js 修改
// ============================================================

// 2.1 在 _enterBoss() 方法中（约第 616 行）：
_enterBoss(node) {
    if (this.dungeonType === 'zombie') {
        this._enterZombieCombat(node);
        return;
    }
    
    // 新 Boss 战系统
    if (typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.enterBossBattle(this.player, () => {
            // Boss 击败后，自动发放基础奖励
            // 然后返回地图
            this._returnToMap();
        });
    } else {
        // Fallback：原有逻辑
        this._prepareCombatMode(true);
        this._generateRoom(true);
        this._spawnMonsters(1, true);
        EffectManager.add(new FloatingTextEffect(512, 400, "Boss 战！", "#ff0000"));
    }
}

// 2.2 在 _enterNode() 中处理 reward 类型（约第 486 行）：
_enterNode(node) {
    this._removeMouseShopButton();
    this._removeAbandonButton();
    this.currentNodeId = node.id;
    this.visitedNodeIds.add(node.id);

    switch (node.type) {
        case "combat": this._enterCombat(node); break;
        case "boss":   this._enterBoss(node); break;
        case "shop":   this._enterShop(node); break;
        case "event":  this._enterEvent(node); break;
        case "reward": 
            // 新奖励节点
            if (typeof BossRewardSystem !== 'undefined') {
                BossRewardSystem.enterRewardNode(this.player, () => {
                    this._returnToMap();
                });
            } else {
                this._returnToMap();
            }
            break;
        default:       this._returnToMap(); break;
    }
}

// 2.3 在 updateCombat() 中添加 Boss 战更新（约第 415 行）：
updateCombat(dt) {
    if (!this.active || (this.state !== "combat" && this.state !== "boss")) return;

    // 更新 Boss 战系统
    if (typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.update(dt);
    }

    // 原有打扫战场逻辑...
    if (this._cleanupActive) {
        // ...
    }
    // ...
}

// 2.4 在 _checkCombatComplete() 中添加 Buff 处理（约第 746 行）：
_checkCombatComplete() {
    if (this.state !== "combat" && this.state !== "boss") return;
    if (this._cleanupActive) return;

    // 检查 Boss 战是否完成（BossRewardSystem 内部处理）
    if (this.state === "boss" && typeof BossRewardSystem !== 'undefined') {
        if (!BossRewardSystem.isBossBattleActive()) {
            // Boss 已被击败，BossRewardSystem 已处理奖励
            // 直接返回地图
            this._returnToMap();
            return;
        }
    }

    // 原有逻辑...
    const allDead = this._combatMonsters.every(m => !m.active || m.hp <= 0);
    if (!allDead) return;

    // 战斗完成后减少 buff 层数
    if (this.player && typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.onBattleEnd(this.player);
    }

    // 原有打扫战场逻辑...
    this._cleanupActive = true;
    this._cleanupTimer = 10000;
    // ...
}

// 2.5 在 shutdown() 中清理 BossRewardSystem（约第 164 行）：
shutdown() {
    this.active = false;
    this.state = "idle";
    this.nodes = [];
    this.edges = [];
    this._cleanupEventUI();
    this._removeCleanupOverlay();
    this._removeMouseShopButton();
    this._removeAbandonButton();
    this._unbindEvents();
    this._carriedItems = [];

    // 清理 BossRewardSystem
    if (typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.cleanup();
    }

    if (this._backupCameraFollow) {
        Camera.follow = this._backupCameraFollow;
    }
    if (this.player) {
        Camera.follow(this.player);
    }
}

// ============================================================
// 3. 地图生成器集成（DungeonMapGenerator）
// ============================================================

// 在地图生成器中确保生成 reward 节点：
// Boss 节点后固定跟一个 reward 节点
// 详见 dungeon-map-system.js 或新的 DungeonMapGenerator 实现

// 示例：在 _generateDefaultMap() 或新的生成器中：
_generateMapWithBossReward() {
    // ... 生成节点 ...
    
    // 确保最后一个非 boss 节点是 reward
    const bossNode = this.nodes.find(n => n.type === 'boss');
    if (bossNode) {
        // 在 boss 后添加 reward 节点
        const rewardNode = {
            id: `node_reward_${Date.now()}`,
            col: bossNode.col + 1,
            row: bossNode.row,
            x: bossNode.x + 200,
            y: bossNode.y,
            type: 'reward',
        };
        this.nodes.push(rewardNode);
        // 添加边：boss -> reward
        this.edges.push({ from: bossNode.id, to: rewardNode.id });
    }
}

// ============================================================
// 4. 事件系统集成（EventSystem）
// ============================================================

// 在事件系统中使用 Buff：
// 详见 event-system.js 或 dungeon-map-system.js 的 _enterEvent()

// 示例：女神像事件
function handleGoddessStatue(player) {
    const choices = ['恢复', '祝福', '奖励'];
    // 选择祝福：
    if (typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.applyGoddessBlessing(player);
    }
}

// 示例：恶魔雕像事件
function handleDemonStatue(player) {
    const choices = ['攻击加成', '材料奖励'];
    if (choice === '攻击加成' && typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.applyDemonPrayer(player, 'attack');
    }
}

// ============================================================
// 5. 渲染器集成（renderer.js）
// ============================================================

// 小地图标记：renderer.js 已有大块头标记逻辑
// 确保 BigBoss 的 name 为 '大块头'，小地图会自动显示红色❌

// 在 renderer.js 约第 172 行：
} else if (e.name === '大块头') {
    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('❌', ex, ey + 3);
}

// BigBoss 类已设置 this.name = '大块头'，无需修改 renderer.js

// ============================================================
// 6. 状态栏集成（status-bar.js）
// ============================================================

// DungeonBuffSystem 已使用 StatusBar.addEffect() 添加状态效果
// 无需额外修改 status-bar.js

// 确保 StatusBar 支持 'buff' 类型：
// status-bar.js 的 STATUS_CONFIG 中已有 buff 配置：
// buff: { icon: '✨', name: '增益', color: '#9a9a5a' }

// ============================================================
// 7. 场景管理器集成（scene-manager.js）
// ============================================================

// 场景管理器无需修改，BossRewardSystem 内部管理：
// - 场地生成（_setupArena）
// - 墙壁系统（WallSystem）
// - 相机跟随（Camera.follow）

// 但需确保 scene-manager.js 的 _loadScene6 中 CONFIG.WORLD_WIDTH/HEIGHT 可被覆盖：
// BossRewardSystem 内部会直接修改 CONFIG.WORLD_WIDTH/HEIGHT

// ============================================================
// 8. 测试验证清单
// ============================================================

// 1. 进入 Boss 节点 → 4096 场地生成
// 2. 玩家在四边随机生成
// 3. Boss 在场地中央生成
// 4. Boss 释放 3 种技能
// 5. Boss 死亡后发放金币奖励
// 6. 进入 reward 节点 → 显示奖励选择界面
// 7. 选择奖励后返回地图
// 8. 女神祝福/恶魔祈祷正确应用和移除
// 9. 地牢退出时所有资源清理
// 10. 小地图显示 Boss 红色❌标记

// ============================================================
// 9. 回滚方案
// ============================================================

// 如果 BossRewardSystem 有 bug，回滚到原有逻辑：
// 在 dungeon-map-system.js 中，所有调用 BossRewardSystem 的地方都有 fallback：
// if (typeof BossRewardSystem !== 'undefined') { ... } else { /* 原有逻辑 */ }

// 只需注释掉 main.js 中的导入和挂载即可完全回滚
