/**
 * 世界-122 能源资源点系统（EnergyNodeSystem，2026-08-14；贴图 v3 2026-08-16）。
 *
 * - 地图散落资源点（EnergyNode，中立可攻击实体）：玩家/队员用普通攻击采集；
 * - 每次攻击按「实际造成伤害 × 50%」产出能源（地面掉落物，装入背包后可用于修建/修理）；
 * - 资源点储量 = hp；耗尽进入枯竭态，90s 后原地刷新；
 * - 资源点只对玩家/队员开放（怪物攻击无效），不做墙体碰撞（避免挡自家塔弹道）；
 * - 贴图 v3：12 形态随机池 + 随机镜像，底座 30° 接地线，AI 成品优先、程序化兜底。
 */
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { WallSystem } from './wall-system.js';
import { ENERGY_ITEM } from '../systems/energy-manager.js';
import { ENERGY_CONFIG } from '../config/energy-config.js';
import { pathFinder } from '../ai/pathfinder.js';
import {
    ENERGY_NODE_V3_COUNT,
    energyNodeVariantPair,
    energyNodeFormMeta,
    ensureEnergyNodeTextures,
} from './energy-node-textures.js';

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
        // 贴图（2026-08-16 v3）：12 种随机形态 × 随机镜像；底座采用世界-122 掩体/墙地
        // 同一套 30° 接地线（见 energy-node-textures.js）。优先使用 AI v3 成品，
        // 缺失时使用运行时程序化版兜底（v1/v2 旧贴图不再参与节点渲染）。
        this._variant = Math.max(1, Math.min(ENERGY_NODE_V3_COUNT, cfg.variant || 1));
        const scene = window.__phaserScene;
        ensureEnergyNodeTextures(scene);
        const pair = energyNodeVariantPair(scene, this._variant);
        const texKey = pair.key;
        this._depletedKey = pair.depletedKey;
        this._texSource = pair.source;
        this._facingLeft = Math.random() < 0.5; // 同形态再镜像一次，进一步去重复
        this._displayScale = 0.9 + Math.random() * 0.18; // 90%~108% 视觉尺寸抖动
        let aspect = 1.05;
        if (scene && scene.textures && scene.textures.exists(texKey)) {
            const frame = scene.textures.getFrame(texKey);
            if (frame && frame.realWidth > 0 && frame.realHeight > 0) {
                aspect = frame.realWidth / frame.realHeight;
            }
        }
        const displayW = Math.round(ENERGY_CONFIG.nodeSize * this._displayScale);
        const displayH = Math.round(displayW / aspect);
        this._texKey = texKey;
        this.spriteCfg = {
            idleKey: texKey,
            size: displayW,
            sizeH: displayH,
            footOffsetY: displayH / 2,
        };
        this.footOffsetY = displayH / 2;
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
        if (energy > 0) {
            if (source && typeof source.addMinedEnergy === 'function') {
                // 仓鼠矿工挖矿装填隐藏背包 / 队友（露娜、伊莉丝）采集直接入队员背包，
                // 均不产生地面掉落（2026-08-15 矿工口径，2026-08-16 队友同口径）
                source.addMinedEnergy(energy);
            } else if (Game && typeof Game.dropItem === 'function') {
                const ang = Math.random() * Math.PI * 2;
                const r = 20 + Math.random() * 34; // 节点周围散落，避免全部重叠
                Game.dropItem(
                    this.x + Math.cos(ang) * r,
                    this.y + Math.sin(ang) * r,
                    { ...ENERGY_ITEM, stack: energy }
                );
            }
        }
        if (this.hp <= 0) {
            this._depleted = true;
            this._respawnTimer = ENERGY_CONFIG.respawnMs;
            this._swapTexture(this._depletedKey || 'energy_node_depleted');
        }
        return dealt;
    }

    /** 直接换活精灵贴图（_syncNeutralEntities 只创建一次 sprite，换肤必须手动）。
     *  AI 正常/枯竭两张图可能因抠图裁切产生轻微宽高比差异，换肤时同步重算显示尺寸。 */
    _swapTexture(key) {
        const scene = window.__phaserScene;
        if (!scene || !scene.textures || !scene.textures.exists(key)) return;
        const frame = scene.textures.getFrame(key);
        let aspect = 1.05;
        if (frame && frame.realWidth > 0 && frame.realHeight > 0) {
            aspect = frame.realWidth / frame.realHeight;
        }
        const displayW = Math.round(ENERGY_CONFIG.nodeSize * (this._displayScale || 1));
        const displayH = Math.round(displayW / aspect);
        this.spriteCfg.idleKey = key;
        this.spriteCfg.size = displayW;
        this.spriteCfg.sizeH = displayH;
        this.spriteCfg.footOffsetY = displayH / 2;
        this.footOffsetY = this.spriteCfg.footOffsetY;
        const data = scene._neutralSprites && scene._neutralSprites.get(this);
        if (data && data.sprite && data.sprite.active) {
            data.sprite.setTexture(key);
            data.sprite.setDisplaySize(displayW, displayH);
        }
    }

    update(dt) {
        super.update(dt);
        if (this._depleted) {
            this._respawnTimer -= dt;
            if (this._respawnTimer <= 0) {
                this._depleted = false;
                this.hp = this.maxHp;
                this._swapTexture(this._texKey || 'energy_node');
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
        this._refillVariantBag();
        // 大能源点（2026-08-16）：每簇 10~20 块集中在簇心小范围内（均匀圆盘 + 最小间距），
        // 玩家/仓鼠矿工可集中采集；落点被墙/树占住则重试，簇内节点互不重叠
        for (const cl of ENERGY_CONFIG.clusters) {
            const count = cl.count ?? 12;
            const spread = cl.spread ?? 150;
            let placed = 0;
            let guard = 0;
            while (placed < count && guard++ < count * 40) {
                const ang = Math.random() * Math.PI * 2;
                const dist = Math.sqrt(Math.random()) * spread; // 均匀圆盘分布
                const px = Math.round(cl.x + Math.cos(ang) * dist);
                const py = Math.round(cl.y + Math.sin(ang) * dist);
                // 基地核心周边禁矿带（ENERGY_CONFIG.baseExclusion）：800px 内不生成
                const be = ENERGY_CONFIG.baseExclusion;
                if (be && Math.hypot(px - be.x, py - be.y) < (be.radius || 800)) continue;
                // 与同簇已放节点最小间距（节点直径 ~90px，取 85 防贴图重叠）
                if (this.nodes.some((n) => Math.hypot(n.x - px, n.y - py) < 85)) continue;
                if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                    && !WallSystem.canMoveTo(px, py, ENERGY_CONFIG.nodeRadius)) {
                    continue; // 落点被墙/建筑占住则跳过
                }
                const storage = ENERGY_CONFIG.storage.min
                    + Math.floor(Math.random() * (ENERGY_CONFIG.storage.max - ENERGY_CONFIG.storage.min + 1));
                const variant = this._takeVariant();
                const node = new EnergyNode(px, py, { hp: storage, maxHp: storage, variant });
                node._formMeta = energyNodeFormMeta(variant);
                const id = `energy_node_${Math.random().toString(36).slice(2, 8)}`;
                Game.entities.set(id, node);
                this.nodes.push(node);
                placed++;
            }
        }
          // 寻路可见性：能源矿作为“非墙体圆障碍”注册给 A*，怪物会绕行而不是直线穿矿。
          // 只影响寻路，不写 WallSystem，玩家移动/塔弹道等原有墙体语义不变。
          if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
              pathFinder.setEntityCircleObstacles(
                  this.nodes.map(n => ({ x: n.x, y: n.y, radius: n.groundRadius || ENERGY_CONFIG.nodeRadius }))
              );
          }
    },

    /** 12 形态洗牌袋：一袋内尽量不重复，抽空再洗 */
    _refillVariantBag() {
        this._variantBag = Array.from({ length: ENERGY_NODE_V3_COUNT }, (_, i) => i + 1);
        for (let i = this._variantBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._variantBag[i], this._variantBag[j]] = [this._variantBag[j], this._variantBag[i]];
        }
    },

    _takeVariant() {
        if (!Array.isArray(this._variantBag) || this._variantBag.length === 0) {
            this._refillVariantBag();
        }
        return this._variantBag.pop();
    },

    /** 场景离场拆除（实体由 switchScene 统一 Game.entities.clear） */
    teardown() {
        this.nodes = [];
          // 清除寻路专用实体障碍登记，避免切场景后残留已销毁的能源矿坐标
          if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
              pathFinder.setEntityCircleObstacles([]);
          }
        this.active = false;
    },

    /** 资源点实体自带 update（主循环调用），系统层无需逐帧推进 */

    /** 资源点贴图：
     *  1) 优先 BootScene 已加载的 AI v3 成品 energy_node_v3_<n> / energy_node_depleted_v3_<n>；
     *  2) 未出图/部分缺图时，用 energy-node-textures.js 生成 12 形态程序化版兜底；
     *  3) energy_node / energy_node_depleted 仍保留 64×64 占位，仅用于极端加载失败路径。 */
    _ensureTextures() {
        const scene = window.__phaserScene;
        if (!scene) return;
        ensureEnergyNodeTextures(scene);
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
