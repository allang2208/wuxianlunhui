/**
 * 世界-122 能源资源点系统（EnergyNodeSystem，2026-08-14；贴图 v3 2026-08-16）。
 *
 * - 地图散落资源点（EnergyNode，中立可攻击实体）：玩家/队员用普通攻击采集；
 * - 每次攻击按「实际造成伤害 × 50%」产出能源（地面掉落物，装入背包后可用于修建/修理）；
 * - 资源点储量 = hp；耗尽进入枯竭态，90s 后原地刷新；
 * - 资源点只对玩家/队员开放（怪物攻击无效），不做墙体碰撞（避免挡自家塔弹道）；
 * - 贴图 v3：4 种 AI 尖塔晶簇随机池 + 随机镜像，无底座，AI 成品优先、程序化兜底。
 */
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { EnergyManager, ENERGY_ITEM } from '../systems/energy-manager.js';
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
        this.noCollision = true;    // 不阻挡单位移动（节点仍可被攻击/采集）
        this.collisionRadius = 0;
        if (this.collider) {
            this.collider.radius = 0;
            this.collider.height = 0;
        }
        this.gatherRadius = cfg.gatherRadius ?? ENERGY_CONFIG.gatherRadius ?? 45;
        this._noShadow = true;      // 尖塔矿石透明贴图不额外叠加脚底阴影
        this._dormantBand = true;   // 2026-08-19：静态资源点进休眠带（重生计时聚合 dt 不变量）
        this.noNameLabel = true;    // 名字/HP 走 _syncNeutralEntities 统一标签
        // 贴图：4 种尖塔晶簇 × 随机镜像。优先使用 AI 成品，缺失时走程序化兜底。
        this._variant = Math.max(1, Math.min(ENERGY_NODE_V3_COUNT, cfg.variant || 1));
        const scene = window.__phaserScene;
        ensureEnergyNodeTextures(scene);
        const pair = energyNodeVariantPair(scene, this._variant);
        const texKey = pair.key;
        this._depletedKey = pair.depletedKey;
        this._texSource = pair.source;
        this._facingLeft = Math.random() < 0.5; // 同形态再镜像一次，进一步去重复
        this._displayScale = 0.9 + Math.random() * 0.18; // 保留 90%~108% 视觉抖动
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
        // 统一遮挡锚线（能源矿也参与遮挡仲裁：单位在其后被盖、在前/同线盖过矿点）
        setupStructureDepth(this, displayW / 2);
        this._depleted = false;
        this._respawnTimer = 0;
    }

    /**
     * 采集入口：只对玩家/队员生效；按实际伤害 × 50% 产能源掉落。
     */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        if (this._depleted) return 0;
        if (source && source._faction === 'enemy') return 0; // 资源点对怪物免疫
        const directToWarehouse = !!(source && (source._faction === 'player' || source._faction === 'companion'));
        if (directToWarehouse && EnergyManager && EnergyManager.isFull()) {
            EnergyManager.depositEnergy(1); // 触发节流后的满仓提示，不改变存量
            return 0;
        }
        const configuredRatio = Number(source?._energyGatherRatio);
        const gatherRatio = Number.isFinite(configuredRatio) && configuredRatio >= 0
            ? configuredRatio
            : ENERGY_CONFIG.gatherRatio;
        let appliedDamage = damage;
        if (directToWarehouse && EnergyManager) {
            const free = EnergyManager.getFreeCapacity();
            if (gatherRatio > 0) appliedDamage = Math.min(damage, Math.ceil(free / gatherRatio));
        }
        const before = this.hp;
        super.takeDamage(appliedDamage, source, damageType, isMelee);
        const dealt = Math.max(0, before - this.hp);
        if (dealt <= 0) return dealt;
        const energy = Math.floor(dealt * gatherRatio);
        if (energy > 0) {
            if (directToWarehouse && EnergyManager) {
                EnergyManager.depositEnergy(energy);
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
    setup({ random = Math.random } = {}) {
        this.teardown();
        this._generationRandom = typeof random === 'function' ? random : Math.random;
        this.active = true;
        this._ensureTextures();
        this._refillVariantBag();
        // 防御性清理（2026-08-16）：无论场景切换是否已清空实体表，先把场上残留的
        // 能源节点全部移除再重新生成——防止多次 setup / HMR 模块重载 / 旧布局残留
        // 导致节点堆积、贴图叠在一起（实机反馈“极地门右柱叠了一堆矿点”）。
        if (Game && Game.entities) {
            for (const [k, e] of Array.from(Game.entities.entries())) {
                if (e && e._isEnergyNode) Game.entities.delete(k);
            }
        }
        // 大能源点（2026-08-16）：每簇 10~20 块集中在簇心小范围内（均匀圆盘 + 最小间距），
        // 玩家/仓鼠矿工可集中采集；落点被墙/树占住则重试，簇内节点互不重叠
        for (const cl of ENERGY_CONFIG.clusters) {
            const count = cl.count ?? 12;
            const spread = cl.spread ?? 150;
            let placed = 0;
            let guard = 0;
            while (placed < count && guard++ < count * 40) {
                const ang = this._generationRandom() * Math.PI * 2;
                const dist = Math.sqrt(this._generationRandom()) * spread; // 均匀圆盘分布
                const px = Math.round(cl.x + Math.cos(ang) * dist);
                const py = Math.round(cl.y + Math.sin(ang) * dist);
                // 基地核心周边禁矿带（ENERGY_CONFIG.baseExclusion）：800px 内不生成
                const be = ENERGY_CONFIG.baseExclusion;
                if (be && Math.hypot(px - be.x, py - be.y) < (be.radius || 800)) continue;
                // 按当前显示尺寸保持同簇矿点的最小视觉间距。
                if (this.nodes.some((n) => Math.hypot(n.x - px, n.y - py) < (ENERGY_CONFIG.nodeSpacing ?? 115))) continue;
                if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                    && !WallSystem.canMoveTo(px, py, ENERGY_CONFIG.nodeRadius)) {
                    continue; // 落点被墙/建筑占住则跳过
                }
                const storage = ENERGY_CONFIG.storage.min
                    + Math.floor(this._generationRandom() * (ENERGY_CONFIG.storage.max - ENERGY_CONFIG.storage.min + 1));
                const variant = this._takeVariant();
                const node = new EnergyNode(px, py, { hp: storage, maxHp: storage, variant });
                node._formMeta = energyNodeFormMeta(variant);
                const id = `energy_node_${this._generationRandom().toString(36).slice(2, 8)}`;
                Game.entities.set(id, node);
                this.nodes.push(node);
                placed++;
            }
        }
          // 能源矿取消物理碰撞：不向 A*登记圆形障碍，单位可直接穿过矿体。
          if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
              pathFinder.setEntityCircleObstacles([]);
          }
    },

    /** 按快照重建矿点（世界-122 场景快照恢复，2026-08-18 M0）：
     *  位置/余量/枯竭计时全部来自快照，不走 setup 的随机重铺。 */
    restoreNodes(list) {
        if (!Array.isArray(list)) return;
        // 清掉 setup 随机铺的节点（实体 + 列表），再按快照重建
        if (Game && Game.entities) {
            for (const [k, e] of Array.from(Game.entities.entries())) {
                if (e && e._isEnergyNode) Game.entities.delete(k);
            }
        }
        this.nodes = [];
        const clusters = (ENERGY_CONFIG && ENERGY_CONFIG.clusters) || [];
        const baseExclusion = ENERGY_CONFIG && ENERGY_CONFIG.baseExclusion;
        for (const s of list) {
            if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
            // 旧存档/HMR 可能保存过基地门口或旧矿簇坐标。快照恢复必须沿用
            // 当前版本的生成约束，不能把 setup() 已排除的非法矿点重新放回来。
            const nearCluster = clusters.some((c) =>
                Math.hypot(s.x - c.x, s.y - c.y) <= (c.spread || 320) + 50
            );
            if (!nearCluster) continue;
            if (baseExclusion
                && Math.hypot(s.x - baseExclusion.x, s.y - baseExclusion.y)
                    < (baseExclusion.radius || 800)) {
                continue;
            }
            if (this.nodes.some((n) => Math.hypot(n.x - s.x, n.y - s.y) < (ENERGY_CONFIG.nodeSpacing ?? 115))) continue;
            if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                && !WallSystem.canMoveTo(s.x, s.y, ENERGY_CONFIG.nodeRadius)) {
                continue;
            }
            const maxHp = Math.max(1, Math.floor(s.maxHp || s.hp || 1));
            const node = new EnergyNode(s.x, s.y, {
                hp: Math.max(0, Math.min(maxHp, Math.floor(s.hp ?? maxHp))),
                maxHp,
                variant: s.variant || 1,
            });
            node._formMeta = energyNodeFormMeta(node._variant);
            if (s.depleted) {
                node._depleted = true;
                node.hp = 0;
                node._respawnTimer = Math.max(0, s.respawnTimer || 0);
                node._swapTexture(node._depletedKey || 'energy_node_depleted');
            }
            const id = `energy_node_${Math.random().toString(36).slice(2, 8)}`;
            Game.entities.set(id, node);
            this.nodes.push(node);
        }
        if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
            pathFinder.setEntityCircleObstacles([]);
        }
    },

    /** 运行时矿点强制审计（2026-08-16）：场上只允许存在当前 4 簇范围内的矿点——
     *  ① 不在任何簇（spread+50 内）→ 残留节点，删除；
     *  ② 同位置（<60px）多节点只保留第一个 → 防“贴图叠在一起”。
     *  实机：基地门右柱叠 3 个矿点 + 北边/门边散点均来自旧配置/HMR 残留，一律清除。 */
    sweepStacked() {
        if (!Game || !Game.entities) return;
        const clusters = (ENERGY_CONFIG && ENERGY_CONFIG.clusters) || [];
        const baseExclusion = ENERGY_CONFIG && ENERGY_CONFIG.baseExclusion;
        const seen = new Set();
        const kept = [];
        let removed = 0;
        for (const [k, e] of Array.from(Game.entities.entries())) {
            if (!e || !e._isEnergyNode || !e.active) continue;
            // ① 残留节点：不在任何当前簇半径内（spread + 50 余量）
            const nearCluster = clusters.some((c) => Math.hypot(e.x - c.x, e.y - c.y) <= (c.spread || 320) + 50);
            const insideBaseExclusion = baseExclusion
                && Math.hypot(e.x - baseExclusion.x, e.y - baseExclusion.y)
                    < (baseExclusion.radius || 800);
            const blockedByStructure = WallSystem && typeof WallSystem.canMoveTo === 'function'
                && !WallSystem.canMoveTo(e.x, e.y, ENERGY_CONFIG.nodeRadius);
            if (!nearCluster || insideBaseExclusion || blockedByStructure) {
                e.active = false;
                Game.entities.delete(k);
                removed++;
                continue;
            }
            // ② 同位置堆叠：只保留第一个
            const key = `${Math.round(e.x / 60)}_${Math.round(e.y / 60)}`;
            if (seen.has(key)) {
                e.active = false;
                Game.entities.delete(k);
                removed++;
            } else {
                seen.add(key);
                kept.push(e);
            }
        }
        this.nodes = kept;
        if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
            pathFinder.setEntityCircleObstacles([]);
        }
        return removed;
    },

    /** 4 形态洗牌袋：一袋内尽量不重复，抽空再洗 */
    _refillVariantBag() {
        this._variantBag = Array.from({ length: ENERGY_NODE_V3_COUNT }, (_, i) => i + 1);
        for (let i = this._variantBag.length - 1; i > 0; i--) {
            const random = this._generationRandom || Math.random;
            const j = Math.floor(random() * (i + 1));
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
     *  1) 优先 BootScene 已加载的 4 种 AI 尖塔成品 energy_node_v3_<n> / energy_node_depleted_v3_<n>；
     *  2) 未出图/部分缺图时，用 energy-node-textures.js 生成 4 形态程序化版兜底；
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
