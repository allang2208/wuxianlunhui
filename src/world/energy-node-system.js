/**
 * 世界-122 能源资源点系统（EnergyNodeSystem，2026-08-14）。
 *
 * - 地图散落资源点（EnergyNode，中立可攻击实体）：玩家/队员用普通攻击采集；
 * - 每次攻击按「实际造成伤害 × 50%」产出能源（地面掉落物，装入背包后可用于修建/修理）；
 * - 资源点储量 = hp；耗尽进入枯竭态，90s 后原地刷新；
 * - 资源点只对玩家/队员开放（怪物攻击无效），不做墙体碰撞（避免挡自家塔弹道）。
 */
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { WallSystem } from './wall-system.js';
import { ENERGY_ITEM } from '../systems/energy-manager.js';
import { ENERGY_CONFIG } from '../config/energy-config.js';

export { ENERGY_CONFIG };

// ==================== 资源点实体 ====================

class EnergyNode extends DamageableEntity {
    constructor(x, y, cfg = {}) {
        const hp = cfg.hp ?? 3000;
        super(x, y, {
            faction: 'neutral', // 中立：玩家/队员可攻击（isFriendlyFire 只看 player/companion）
            hp,
            maxHp: hp,
            size: cfg.size ?? ENERGY_CONFIG.nodeSize,
            collisionRadius: cfg.collisionRadius ?? ENERGY_CONFIG.nodeRadius,
            name: cfg.name ?? '能源矿',
        });
        this._isEnergyNode = true;
        // ⚠ DamageableEntity 不创建 this.data（只有 Combatant 子类有）——不能写 this.data.*，
        //   否则构造即抛 TypeError（2026-08-14 复现：进世界-122 回滚到主神空间）。def/mdef 本就无需。
        this.immovable = true;      // 不可击退/位移
        this.noSeparation = true;   // 不参与实体分离
        this._noShadow = true;      // 自带接地底座的贴图取消脚底阴影
        this.noNameLabel = true;    // 名字/HP 走 _syncNeutralEntities 统一标签
        // 贴图（2026-08-15 二版）：随机多形态变体 v1~v6（晶体数量/高低/倾角/底座随机），
        // 每变体宽高比不同 → 从 Phaser 纹理帧实测尺寸换算 sizeH/footOffsetY（贴图底部=土堆贴地），
        // 变体纹理缺失时回退基础 'energy_node'（运行时占位生成兜底）。
        this._variant = 1 + Math.floor(Math.random() * 6);
        const scene = window.__phaserScene;
        const vKey = `energy_node_v${this._variant}`;
        const hasVariant = !!(scene && scene.textures && scene.textures.exists(vKey));
        const texKey = hasVariant ? vKey : 'energy_node';
        let aspect = 1.059;
        if (scene && scene.textures && scene.textures.exists(texKey)) {
            const frame = scene.textures.getFrame(texKey);
            if (frame && frame.realWidth > 0 && frame.realHeight > 0) {
                aspect = frame.realWidth / frame.realHeight;
            }
        }
        this._texKey = texKey;
        this.spriteCfg = {
            idleKey: texKey,
            size: ENERGY_CONFIG.nodeSize,
            sizeH: Math.round(ENERGY_CONFIG.nodeSize / aspect),
            footOffsetY: Math.round(ENERGY_CONFIG.nodeSize / aspect) / 2,
        };
        this.footOffsetY = Math.round(ENERGY_CONFIG.nodeSize / aspect) / 2;
        this._depleted = false;
        this._respawnTimer = 0;
    }

    /**
     * 采集入口：只对玩家/队员生效；按实际伤害 × 50% 产能源掉落。
     */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        if (this._depleted) return 0;
        if (source && source._faction === 'enemy') return 0; // 资源点对怪物免疫
        const before = this.hp;
        super.takeDamage(damage, source, damageType, isMelee);
        const dealt = Math.max(0, before - this.hp);
        if (dealt <= 0) return dealt;
        const energy = Math.floor(dealt * ENERGY_CONFIG.gatherRatio);
        if (energy > 0 && Game && typeof Game.dropItem === 'function') {
            const ang = Math.random() * Math.PI * 2;
            const r = 20 + Math.random() * 34; // 节点周围散落，避免全部重叠
            Game.dropItem(
                this.x + Math.cos(ang) * r,
                this.y + Math.sin(ang) * r,
                { ...ENERGY_ITEM, stack: energy }
            );
        }
        if (this.hp <= 0) {
            this._depleted = true;
            this._respawnTimer = ENERGY_CONFIG.respawnMs;
            this._swapTexture('energy_node_depleted');
        }
        return dealt;
    }

    /** 直接换活精灵贴图（_syncNeutralEntities 只创建一次 sprite，换肤必须手动） */
    _swapTexture(key) {
        const scene = window.__phaserScene;
        if (!scene) return;
        const data = scene._neutralSprites && scene._neutralSprites.get(this);
        if (data && data.sprite && data.sprite.active && scene.textures.exists(key)) {
            data.sprite.setTexture(key);
        }
    }

    update(dt) {
        super.update(dt);
        if (this._depleted) {
            this._respawnTimer -= dt;
            if (this._respawnTimer <= 0) {
                this._depleted = false;
                this.hp = this.maxHp;
                this._swapTexture('energy_node');
            }
        }
    }
}

// ==================== 系统 ====================

export const EnergyNodeSystem = {
    nodes: [],
    active: false,

    /** 场景进入时铺资源点（scene8） */
    setup() {
        this.teardown();
        this.active = true;
        this._ensureTextures();
        for (const p of ENERGY_CONFIG.positions) {
            if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                && !WallSystem.canMoveTo(p.x, p.y, ENERGY_CONFIG.nodeRadius)) {
                continue; // 落点被墙/建筑占住则跳过
            }
            const storage = ENERGY_CONFIG.storage.min
                + Math.floor(Math.random() * (ENERGY_CONFIG.storage.max - ENERGY_CONFIG.storage.min + 1));
            const node = new EnergyNode(p.x, p.y, { hp: storage, maxHp: storage });
            const id = `energy_node_${Math.random().toString(36).slice(2, 8)}`;
            Game.entities.set(id, node);
            this.nodes.push(node);
        }
    },

    /** 场景离场拆除（实体由 switchScene 统一 Game.entities.clear） */
    teardown() {
        this.nodes = [];
        this.active = false;
    },

    /** 资源点实体自带 update（主循环调用），系统层无需逐帧推进 */

    /** 运行时生成资源点贴图（兜底：BootScene 已预加载 energy_node/energy_node_depleted 时跳过；
     *  2026-08-15 起正式贴图走 assets/terrain/energy_node.png（Blender+AI 材质），此处仅占位回退） */
    _ensureTextures() {
        const scene = window.__phaserScene;
        if (!scene) return;
        if (scene.textures.exists('energy_node') && scene.textures.exists('energy_node_depleted')) {
            return; // 正式贴图已由 BootScene 加载，跳过运行时占位生成
        }
        if (!scene.textures.exists('energy_node')) {
            const g = scene.add.graphics();
            // 底座
            g.fillStyle(0x1e3a2a, 1);
            g.fillEllipse(32, 56, 46, 14);
            // 晶体主体（菱形）
            g.fillStyle(0x39c5ff, 1);
            g.fillPoints([
                { x: 32, y: 4 }, { x: 56, y: 24 }, { x: 32, y: 56 }, { x: 8, y: 24 },
            ], true);
            // 高光棱线
            g.fillStyle(0xb8ecff, 0.9);
            g.fillPoints([
                { x: 32, y: 6 }, { x: 44, y: 25 }, { x: 32, y: 52 }, { x: 20, y: 25 },
            ], true);
            g.fillStyle(0x6fdcff, 1);
            g.fillPoints([
                { x: 32, y: 12 }, { x: 40, y: 25 }, { x: 32, y: 40 }, { x: 24, y: 25 },
            ], true);
            g.generateTexture('energy_node', 64, 64);
            g.clear();
            // 枯竭态：灰暗晶体
            g.fillStyle(0x18201a, 1);
            g.fillEllipse(32, 56, 46, 14);
            g.fillStyle(0x55605a, 1);
            g.fillPoints([
                { x: 32, y: 6 }, { x: 56, y: 26 }, { x: 32, y: 56 }, { x: 8, y: 26 },
            ], true);
            g.fillStyle(0x6d7a74, 0.9);
            g.fillPoints([
                { x: 32, y: 12 }, { x: 46, y: 26 }, { x: 32, y: 50 }, { x: 18, y: 26 },
            ], true);
            g.generateTexture('energy_node_depleted', 64, 64);
            g.destroy();
        }
    },
};
