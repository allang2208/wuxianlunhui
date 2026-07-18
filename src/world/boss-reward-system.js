import { GoldManager } from '../systems/gold-manager.js';
import { EnchantConfig } from '../config/enchant-config.js';
import { EnchantScrollItems } from '../config/enchant-config.js';
import { MagicDustItem } from '../config/enchant-config.js';
import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { createBasicZombie, createFatZombie } from './zombie-dungeon.js';
import { AmalgamZombie } from '../entities/enemy-types.js';
import enemyConfigData from '../../data/enemy-config.json';
import { applyDungeonFloor } from './dungeon-floor-texture.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { pathFinder } from '../ai/pathfinder.js';
/**
 * BossRewardSystem — Boss战与奖励系统（地牢模式重构 Stage 4）
 * ============================================================
 * 
 * 职责：
 *   1. Boss 战管理：1024×1024 固定场地、集合体 Boss 生成与战斗
 *   2. 奖励节点管理：复用雪地场景 RewardSystem 界面
 * 
 * 集成点：
 *   - dungeon-map-system.js _enterBoss() → BossRewardSystem.enterBossBattle()
 *   - dungeon-map-system.js _enterNode() reward 类型 → BossRewardSystem.enterRewardNode()
 *   - 战斗完成后 → BossRewardSystem.showReward() → RewardSystem.open()
 */

import { FloatingTextEffect } from '../effects/floating-text.js';
import { RewardSystem } from '../ui/reward-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { TimerManager } from '../utils/timer-manager.js';
import { CONFIG } from '../config/config.js';
import { EnhancementItems } from '../ui/reward-system.js';
import { EquipManager } from '../ui/equip-manager.js';

// ==================== 配置对象 ====================

export const BOSS_REWARD_CONFIG = {
    // Boss 场地配置
    arena: {
        // 场地大小由 data/dungeon-config.json 的 combatRoom.bossSize 驱动（当前 1024）
        get size() { return (DungeonConfig.getCombatRoomConfig().bossSize) ?? 1024; },
        wallThickness: 40,    // 边界墙壁厚度
        margin: 60,           // 玩家/怪物生成边距
        playerFromBottom: 300, // 玩家生成：场地最下方中心上移 300px
        bossFromTop: 300,      // Boss 生成：场地上方中心（与玩家镜像对齐）
    },

    // Boss 配置已迁移：集合体数值统一由 data/enemy-config.json 的 amalgamZombie 提供（配置驱动）

    // 奖励配置
    reward: {
        // 基础奖励（击败 Boss 后）
        baseGold: 2000,
        goldVariance: 500,
        // 奖励卡牌额外奖励（在 RewardSystem 基础上追加）
        bonusCards: [
            {
                id: 'boss_card_1',
                title: 'Boss 战利品',
                icon: '👑',
                rewards: [
                    { type: 'gold', count: 3000 },
                    { type: 'stone', count: 5 },
                ],
                desc: '获得 3000 金币和 5 颗强化石',
            },
            {
                id: 'boss_card_2',
                title: '稀有附魔',
                icon: '🔮',
                rewards: [
                    { type: 'scroll', grade: 'D', count: 1 },
                    { type: 'dust', count: 500 },
                ],
                desc: '获得 D 级附魔卷轴和 500 魔法粉尘',
            },
            {
                id: 'boss_card_3',
                title: '传说装备',
                icon: '⚔️',
                rewards: [
                    { type: 'weapon', rarity: 'epic', count: 1 },
                    { type: 'gold', count: 2000 },
                ],
                desc: '获得史诗武器和 2000 金币',
            },
        ],
    },

    // Buff 配置
    buffs: {
        // 女神祝福
        goddessBlessing: {
            name: '女神祝福',
            icon: '✨',
            color: '#e8c878',
            // 属性加成
            atkBonusPercent: 15,      // +15% 物攻
            matkBonusPercent: 15,     // +15% 魔攻
            duration: -1,             // 按战斗次数计算，非时间
            maxBattles: 3,            // 持续 3 场战斗
        },
        // 恶魔祈祷
        demonPrayer: {
            name: '恶魔祈祷',
            icon: '🔥',
            color: '#9a3a3a',
            // 属性加成
            atkBonusPercent: 33,      // +33% 物攻
            matkBonusPercent: 33,     // +33% 魔攻
            // 代价
            hpCostPercent: 50,        // 扣 50% 当前 HP
            mpCostPercent: 50,        // 扣 50% 当前 MP
            duration: -1,             // 永久（直到地牢结束）
        },
    },
};


// ==================== Boss 出口传送门 ====================
class BossExitPortal {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 40;
        this.size = 30;
        this.active = true;
        this.noCollision = true;
        this.pulseTimer = 0;
        this.name = '出口传送门';
        this.color = '#7a9aff';
        this.noNameLabel = true;
    }
    update(dt) {
        this.pulseTimer += dt / 1000;
    }
}

// ==================== Boss 战斗管理器 ====================

export class BossBattleManager {
    constructor() {
        this.active = false;
        this.boss = null;
        this.bossKey = null;
        this._backupWalls = [];
        this._backupCameraFollow = null;
        this._onCompleteCallback = null;
        this._combatCheckTimer = 0;
        this._exitPortal = null;
        this._exitPortalKey = null;
        this._waitingForExit = false;
    }

    /**
     * 开始 Boss 战
     * @param {Object} player - 玩家实体
     * @param {Function} onComplete - 战斗完成回调
     */
    start(player, onComplete) {
        if (this.active) {
            console.warn('[BossBattleManager] Boss 战已在进行中');
            return;
        }

        this.active = true;
        this._onCompleteCallback = onComplete;
        this._combatCheckTimer = 0;

        // 保存原始墙壁、相机、地形、世界尺寸与树木
        this._backupWalls = [...WallSystem.walls];
        this._backupCameraFollow = Camera.follow.bind(Camera);
        this._backupTerrainTexture = (typeof Renderer !== 'undefined') ? Renderer.terrainTexture : undefined;
        this._backupWorldSize = (typeof CONFIG !== 'undefined') ? { width: CONFIG.WORLD_WIDTH, height: CONFIG.WORLD_HEIGHT } : null;
        this._backupTrees = WallSystem.trees ? [...WallSystem.trees] : null;

        // 设置 Boss 战场地（尺寸由 combatRoom.bossSize 配置驱动）
        this._setupArena();

        // 放置玩家（场地最下方中心，上移 playerFromBottom）
        this._placePlayer(player);

        // 生成 Boss（上方中心，与玩家镜像对齐）
        this._spawnBoss(player);

        // 恢复相机跟随
        Camera.follow = this._backupCameraFollow;
        if (player) Camera.follow(player);

        
    }

    _setupArena() {
        const cfg = BOSS_REWARD_CONFIG.arena;
        const size = cfg.size;
        const wt = cfg.wallThickness;

        // 生成地形纹理并同步世界尺寸：与战斗房相同的黑砖地板（共享 dungeon-floor-texture.js 实现）
        applyDungeonFloor(size);

        // 设置墙壁系统
        WallSystem.init(size, size);
        WallSystem.walls = [
            { x: 0, y: 0, w: size, h: wt, height: 60 },           // 上
            { x: 0, y: size - wt, w: size, h: wt, height: 60 },   // 下
            { x: 0, y: 0, w: wt, h: size, height: 60 },           // 左
            { x: size - wt, y: 0, w: wt, h: size, height: 60 },   // 右
        ];

        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 标记路径缓存失效
        if (pathFinder) {
            pathFinder.invalidateCache();
        }
    }

    _placePlayer(player) {
        if (!player) return;
        const cfg = BOSS_REWARD_CONFIG.arena;
        // 玩家生成在场地最下方中心位置，上移 playerFromBottom px
        player.x = cfg.size / 2;
        player.y = cfg.size - (cfg.playerFromBottom ?? 300);

        // 确保玩家在 entities 中
        if (Game.entities && !Game.entities.has('player')) {
            Game.entities.set('player', player);
        }
    }

    _spawnBoss(player) {
        if (!player) return;
        const cfg = BOSS_REWARD_CONFIG.arena;
        const size = cfg.size;

        // 集合体生成在场地上方正对玩家、镜像对齐位置（上方中心 bossFromTop px）
        const bx = size / 2;
        const by = cfg.bossFromTop ?? 300;

        // 数值统一来自 enemy-config.json 的 amalgamZombie，仅覆盖永久警戒
        this.boss = new AmalgamZombie(bx, by, {
            ai: { ...(enemyConfigData.amalgamZombie?.ai || {}), aggroRange: 9999, loseTimeout: 999999, alertRange: 9999 }
        });
        // 注入召唤/生成工厂（避免实体层反向依赖 world 层）
        this.boss._createBasicZombie = createBasicZombie;
        this.boss._createFatZombie = createFatZombie;
        this.bossKey = `dungeon_boss_${Date.now()}`;

        if (Game.entities) {
            Game.entities.set(this.bossKey, this.boss);
        }

        EffectManager.add(new FloatingTextEffect(bx, by - 100, '☠️ 集合体 出现！', '#ff0000'));
    }

    update(dt) {
        if (!this.active) return;

        // 检查 Boss 是否死亡
        this._combatCheckTimer += dt;
        if (this._combatCheckTimer >= 500) {
            this._combatCheckTimer = 0;
            this._checkBossDefeated();
        }
    }

    _checkBossDefeated() {
        // 仅当 boss 存在且已死亡才算战胜；boss 为 null（生成失败等异常路径）不发奖励
        if (this.boss && (this.boss.hp <= 0 || !this.boss.active)) {
            this._onBossDefeated();
        }
    }

    _onBossDefeated() {
        if (this._waitingForExit) return; // 已生成传送门，避免重复触发
        this._waitingForExit = true;

        // 发放基础奖励
        const gold = BOSS_REWARD_CONFIG.reward.baseGold + Math.floor(Math.random() * BOSS_REWARD_CONFIG.reward.goldVariance);
        if (GoldManager) {
            GoldManager.addGold(gold);
        }

        const player = Game.player;
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `🎉 击败 Boss！获得 ${gold} 金币`, '#ffd700'));
        }

        // 生成出口传送门，等待玩家进入
        this.spawnExitPortal();
    }

    spawnExitPortal() {
        if (this._exitPortal) return this._exitPortal;
        const cfg = BOSS_REWARD_CONFIG.arena;
        const x = cfg.size / 2;
        const y = cfg.size / 2;
        const portal = new BossExitPortal(x, y);
        this._exitPortal = portal;
        this._exitPortalKey = `boss_exit_portal_${Date.now()}`;
        if (Game.entities) {
            Game.entities.set(this._exitPortalKey, portal);
        }
        if (EffectManager && FloatingTextEffect) {
            EffectManager.add(new FloatingTextEffect(x, y - 40, '出口传送门已开启', '#7a9aff'));
        }
        return portal;
    }

    getExitPortal() {
        return this._exitPortal;
    }

    leaveBossBattle() {
        // 删除传送门
        if (this._exitPortalKey && Game.entities && typeof Game.removeEntity === 'function') {
            Game.removeEntity(this._exitPortalKey);
        }
        this._exitPortal = null;
        this._exitPortalKey = null;
        this._waitingForExit = false;

        // 先取出完成回调，再清理场地（cleanup 会清空回调引用）
        const onComplete = this._onCompleteCallback;

        // 清理 Boss 战场地
        this.cleanup();

        // 回调（修复：此前先 cleanup 导致回调永远为 null，Boss 节点无法标记完成）
        if (onComplete) {
            onComplete();
        }
    }

    cleanup() {
        if (!this.active) return;

        // 删除 Boss 实体
        if (this.bossKey && Game.entities && typeof Game.removeEntity === 'function') {
            Game.removeEntity(this.bossKey);
        }
        this.boss = null;
        this.bossKey = null;

        // 清理集合体召唤物（amalgam_fat_/amalgam_zombie_ 前缀，经统一入口，跳过存活尸体）
        if (Game && typeof Game.removeEntitiesByPrefix === 'function') {
            Game.removeEntitiesByPrefix('amalgam_fat_', 'amalgam_zombie_');
        }

        // 删除传送门
        if (this._exitPortalKey && Game.entities && typeof Game.removeEntity === 'function') {
            Game.removeEntity(this._exitPortalKey);
        }
        this._exitPortal = null;
        this._exitPortalKey = null;
        this._waitingForExit = false;

        // 恢复墙壁
        WallSystem.walls = [...this._backupWalls];
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 恢复地形纹理、世界尺寸与树木（与战斗房 _restoreSceneState 同口径）
        if (this._backupTerrainTexture !== undefined && typeof Renderer !== 'undefined') {
            Renderer.terrainTexture = this._backupTerrainTexture;
        }
        if (this._backupWorldSize && typeof CONFIG !== 'undefined') {
            CONFIG.WORLD_WIDTH = this._backupWorldSize.width;
            CONFIG.WORLD_HEIGHT = this._backupWorldSize.height;
        }
        if (this._backupTrees) {
            WallSystem.trees = [...this._backupTrees];
        }
        if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
            window.__phaserScene.syncTerrain();
        }

        if (pathFinder) {
            pathFinder.invalidateCache();
        }

        this.active = false;
        this._onCompleteCallback = null;

        
    }

    isActive() {
        return this.active;
    }
}

// ==================== 奖励节点管理器 ====================

export class RewardNodeManager {
    constructor() {
        this._isShowingReward = false;
    }

    /**
     * 进入奖励节点
     * @param {Object} player - 玩家实体
     * @param {Function} onComplete - 奖励选择完成回调
     */
    enterRewardNode(player, onComplete) {
        if (this._isShowingReward) return;

        this._isShowingReward = true;

        // 使用现有的 RewardSystem，但替换为 Boss 奖励卡牌
        this._setupBossRewardCards();

        // 打开奖励面板
        if (RewardSystem) {
            RewardSystem.open();
        }

        // 监听面板关闭
        this._waitForRewardClose(onComplete);

        
    }

    _setupBossRewardCards() {
        // 保存原始卡牌
        this._originalCards = RewardSystem.CARDS ? [...RewardSystem.CARDS] : null;

        // 复用剧情模式 RewardSystem 的原始卡牌（不追加额外卡牌）
        // 用户要求：复用剧情模式下雪地场景完成后奖励界面
        // 因此不修改 CARDS，直接使用 RewardSystem 原有的三张卡牌
    }

    _waitForRewardClose(onComplete) {
        const checkInterval = TimerManager.setInterval(() => {
            if (!RewardSystem._isOpen) {
                TimerManager.clearInterval(checkInterval);
                this._isShowingReward = false;

                // 恢复原始卡牌
                if (this._originalCards && RewardSystem.CARDS) {
                    RewardSystem.CARDS = this._originalCards;
                    this._originalCards = null;
                }

                if (onComplete) onComplete();
            }
        }, 300);
    }

    /**
     * 直接发放奖励（不显示选择界面）
     * @param {Object} player - 玩家实体
     * @param {Object} rewards - 奖励配置
     */
    giveReward(player, rewards) {
        if (!rewards) return;

        for (const reward of rewards) {
            switch (reward.type) {
                case 'gold':
                    if (GoldManager) {
                        GoldManager.addGold(reward.count);
                    }
                    break;
                case 'stone':
                    // 强化石
                    if (EnhancementItems && EnhancementItems.enhance_stone) {
                        const stone = { ...EnhancementItems.enhance_stone, stack: reward.count };
                        this._addToBackpackOrDrop(stone);
                    }
                    break;
                case 'dust':
                    // 魔法晶尘
                    if (MagicDustItem) {
                        const dust = { ...MagicDustItem, stack: reward.count };
                        this._addToBackpackOrDrop(dust);
                    }
                    break;
                case 'scroll':
                    // 附魔卷轴
                    if (EnchantConfig) {
                        const scrolls = EnchantConfig.getAllScrolls().filter(s => s.grade === reward.grade);
                        if (scrolls.length > 0) {
                            const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
                            const item = EnchantScrollItems ? EnchantScrollItems[`enchant_scroll_${scroll.id}`] : null;
                            if (item) this._addToBackpackOrDrop({ ...item, stack: reward.count });
                        }
                    }
                    break;
                case 'weapon':
                    // 随机武器
                    this._giveRandomWeapon(reward.rarity);
                    break;
                case 'reforge_ticket':
                    // 改造券
                    if (EnhancementItems && EnhancementItems.modify_ticket) {
                        const ticket = { ...EnhancementItems.modify_ticket, stack: reward.count };
                        this._addToBackpackOrDrop(ticket);
                    }
                    break;
            }
        }
    }

    _addToBackpackOrDrop(item) {
        if (!item) return;
        if (EquipManager && EquipManager.backpackItems &&
            EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
            EquipManager.addToBackpack(item);
        } else if (Game.player && Game.dropItem) {
            Game.dropItem(Game.player.x, Game.player.y, item);
        }
    }

    _giveRandomWeapon(rarity) {
        if (!ItemDatabase || !ItemDatabase.getRandomWeaponByRarity) return;
        const instance = ItemDatabase.getRandomWeaponByRarity(rarity);
        if (!instance) return;
        this._addToBackpackOrDrop(instance);
    }
}

// ==================== 主入口：BossRewardSystem ====================

export const BossRewardSystem = {
    // 子系统实例
    bossBattle: new BossBattleManager(),
    rewardNode: new RewardNodeManager(),

    // 配置
    config: BOSS_REWARD_CONFIG,

    /**
     * 进入 Boss 战
     * 由 DungeonMapSystem._enterBoss() 调用
     */
    enterBossBattle(player, onComplete) {
        this.bossBattle.start(player, onComplete);
    },

    /**
     * 进入奖励节点
     * 由 DungeonMapSystem._enterNode() reward 类型调用
     */
    enterRewardNode(player, onComplete) {
        this.rewardNode.enterRewardNode(player, onComplete);
    },

    /**
     * 更新（每帧调用）
     */
    update(dt) {
        this.bossBattle.update(dt);
    },

    /**
     * 获取 Boss 战出口传送门
     */
    getExitPortal() {
        return this.bossBattle.getExitPortal();
    },

    /**
     * 离开 Boss 战（玩家进入传送门）
     */
    leaveBossBattle() {
        this.bossBattle.leaveBossBattle();
    },

    /**
     * 检查 Boss 战是否进行中
     */
    isBossBattleActive() {
        return this.bossBattle.isActive();
    },

    /**
     * 清理所有资源（地牢结束时）
     */
    cleanup() {
        this.bossBattle.cleanup();
        this._isShowingReward = false;
        
    },
};

// 全局挂载
if (typeof window !== 'undefined' && !window.BossRewardSystem) {
    window.BossRewardSystem = BossRewardSystem;
    window.BossBattleManager = BossBattleManager;
    window.RewardNodeManager = RewardNodeManager;
}

// 默认导出
export default {
    BossRewardSystem,
    BossBattleManager,
    RewardNodeManager,
    BOSS_REWARD_CONFIG,
};
