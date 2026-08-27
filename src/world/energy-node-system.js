/**
 * 世界-122 能源资源点系统（EnergyNodeSystem，2026-08-14；贴图 v3 2026-08-16）。
 *
 * - 地图散落资源点（EnergyNode，中立可攻击实体）：玩家/队员用普通攻击采集；
 * - 每次攻击按「实际造成伤害 × 50%」产出能源（地面掉落物，装入背包后可用于修建/修理）；
 * - 资源点储量 = hp；耗尽先切暗灰裂纹态，再复用建筑沉陷特效并永久清除；
 * - 资源点只对玩家/队员开放（怪物攻击无效），不做墙体碰撞（避免挡自家塔弹道）；
 * - 贴图 v4：按四邻格生成 16 帧道路式拼接矿脉；旧 3 形态 AI/程序化贴图保留兜底；
 * - 每点固定占一个 128×64 等距格，矿簇按四邻格连续密集生成，但仍允许单位穿行；
 * - 视觉宽度完整覆盖单格，并允许边缘少量跨格侵入，使相邻碎石/矿块自然拼接。
 */
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { EnergyManager, ENERGY_ITEM } from '../systems/energy-manager.js';
import { ENERGY_CONFIG } from '../config/energy-config.js';
import { pathFinder } from '../ai/pathfinder.js';
import { blockCellCenter, blockCellOf } from './gate4-grid.js';
import { ONE_CELL_BUILDING_FOOT } from './building-footprint.js';
import { isoFootprintsOverlap } from '../physics/iso-footprint.js';
import { isoFootprintOverlapsActiveGate } from './gate-occupancy.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import {
    ENERGY_NODE_V3_COUNT,
    ENERGY_NODE_CONNECTION_BITS,
    energyNodeDirectionalPair,
    energyNodeVariantPair,
    energyNodeFormMeta,
    ensureEnergyNodeTextures,
} from './energy-node-textures.js';

export { ENERGY_CONFIG };

function energyNodeFootprintAt(x, y) {
    return {
        x, y,
        collisionShape: 'iso_rect',
        collisionWidth: ONE_CELL_BUILDING_FOOT.w,
        collisionHeight: ONE_CELL_BUILDING_FOOT.d,
        collisionIsoHalfU: ONE_CELL_BUILDING_FOOT.halfU,
        collisionIsoHalfV: ONE_CELL_BUILDING_FOOT.halfV,
        colliderOffsetX: 0,
        colliderOffsetY: 0,
    };
}

function overlapsActiveGateAt(x, y) {
    return isoFootprintOverlapsActiveGate(
        energyNodeFootprintAt(x, y),
        Game?.entities?.values?.()
    );
}

/** 深钻井等显式设施可以覆盖矿脉；自愈/恢复流程不得把其工作矿脉当成非法建筑重叠删除。 */
function allowsEnergyNodeOverlapAt(x, y) {
    if (!Game?.entities) return false;
    const nodeFootprint = energyNodeFootprintAt(x, y);
    for (const entity of Game.entities.values()) {
        if (!entity?.active || !entity._allowsEnergyNodeOverlap) continue;
        if (isoFootprintsOverlap(nodeFootprint, entity)) return true;
    }
    return false;
}

// ==================== 资源点实体 ====================

class EnergyNode extends DamageableEntity {
    constructor(x, y, cfg = {}) {
        const hp = cfg.hp ?? 3000;
        const maxHp = cfg.maxHp ?? hp;
        super(x, y, {
            faction: 'neutral', // 中立：玩家/队员可攻击（isFriendlyFire 只看 player/companion）
            hp,
            maxHp,
            size: cfg.size ?? ENERGY_CONFIG.nodeSize,
            collisionRadius: cfg.collisionRadius ?? ENERGY_CONFIG.nodeRadius,
            name: cfg.name ?? '能源矿',
        });
        this._isEnergyNode = true;
        // 能源矿是采集资源点，不是战斗训练目标：命中/暴击/击杀均不提供技能修炼经验。
        this._grantsSkillTrainingExp = false;
        const cell = Array.isArray(cfg.cell) ? cfg.cell : blockCellOf(x, y);
        this._gridCellI = Math.round(cell[0]);
        this._gridCellJ = Math.round(cell[1]);
        this._energyNodeFootprintCells = ENERGY_CONFIG.footprintCells ?? 1;
        this._isOneCellEnergyNode = this._energyNodeFootprintCells === 1;
        // ⚠ DamageableEntity 不创建 this.data（只有 Combatant 子类有）——不能写 this.data.*，
        //   否则构造即抛 TypeError（2026-08-14 复现：进世界-122 回滚到主神空间）。def/mdef 本就无需。
        this.immovable = true;      // 不可击退/位移
        this.noSeparation = true;   // 不参与实体分离
        this.noCollision = true;    // 不阻挡单位移动（节点仍可被攻击/采集）
        this._civilianBlocksVisuals = false; // 纯视觉平民保持同样的可穿行语义
        this.collisionRadius = 0;
        if (this.collider) {
            this.collider.radius = 0;
            this.collider.height = 0;
        }
        this.gatherRadius = cfg.gatherRadius ?? ENERGY_CONFIG.gatherRadius ?? 45;
        this._noShadow = true;      // 岩基矿石透明贴图不额外叠加脚底阴影
        this._dormantBand = true;   // 静态资源点进休眠带；枯竭转场计时可消费聚合 dt
        this.noNameLabel = true;    // 名字/HP 走 _syncNeutralEntities 统一标签
        // 贴图：优先使用道路式四邻拼接图集，缺失时回退旧 3 形态矿脉。
        this._variant = Math.max(1, Math.min(ENERGY_NODE_V3_COUNT, cfg.variant || 1));
        const scene = window.__phaserScene;
        ensureEnergyNodeTextures(scene);
        const directionalPair = energyNodeDirectionalPair(scene);
        const pair = directionalPair || energyNodeVariantPair(scene, this._variant);
        const texKey = pair.key;
        this._depletedKey = pair.depletedKey;
        this._texSource = pair.source;
        this._usesDirectionalVein = !!directionalPair;
        this._connectionMask = 0;
        this._facingLeft = directionalPair ? false : Math.random() < 0.5;
        // 只放大 Sprite 做侵入式拼接；逻辑格、碰撞、采集与生成坐标仍严格保持 1×1。
        const stitchScale = ENERGY_CONFIG.visualStitchScale || {};
        const stitchMin = Math.max(1, Number(stitchScale.min) || 1);
        const stitchMax = Math.max(stitchMin, Number(stitchScale.max) || stitchMin);
        this._displayScale = directionalPair
            ? 1
            : stitchMin + Math.random() * (stitchMax - stitchMin);
        let aspect = 1.05;
        if (scene && scene.textures && scene.textures.exists(texKey)) {
            const frame = scene.textures.getFrame(texKey, directionalPair ? 0 : undefined);
            if (frame && frame.realWidth > 0 && frame.realHeight > 0) {
                aspect = frame.realWidth / frame.realHeight;
            }
        }
        // 方向图集必须保持原生 128×64；若沿用旧单体矿的 130px 侵入式放大，
        // 相邻端点会随中心缩放产生约 1px 漂移。旧兜底贴图仍消费配置宽度。
        const displayBaseWidth = directionalPair
            ? 128
            : (ENERGY_CONFIG.visualDisplayWidth ?? ENERGY_CONFIG.nodeSize);
        const displayW = Math.round(displayBaseWidth * this._displayScale);
        const displayH = Math.round(displayW / aspect);
        this._texKey = texKey;
        this.spriteCfg = {
            idleKey: texKey,
            size: displayW,
            sizeH: displayH,
            footOffsetY: displayH / 2,
            frame: directionalPair ? 0 : undefined,
        };
        this.footOffsetY = displayH / 2;
        // 统一遮挡锚线（能源矿也参与遮挡仲裁：单位在其后被盖、在前/同线盖过矿点）
        setupStructureDepth(this, displayW / 2);
        this._depleted = false;
        this._collapseTimer = 0;
    }

    /**
     * 采集入口：玩家/普通队友直接入仓；经济矿工先进入个人背包。
     */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        if (this._depleted) return 0;
        if (source && source._faction === 'enemy') return 0; // 资源点对怪物免疫
        const minerBackpack = !!(source?._isHamsterMiner && typeof source.addMinedEnergy === 'function');
        const directToWarehouse = !!(source && !minerBackpack
            && (source._faction === 'player' || source._faction === 'companion'));
        if (directToWarehouse && EnergyManager && EnergyManager.isFull()) {
            EnergyManager.depositEnergy(1); // 触发节流后的满仓提示，不改变存量
            return 0;
        }
        const configuredRatio = Number(source?._energyGatherRatio);
        const gatherRatio = Number.isFinite(configuredRatio) && configuredRatio >= 0
            ? configuredRatio
            : ENERGY_CONFIG.gatherRatio;
        let appliedDamage = damage;
        if (minerBackpack) {
            const free = Math.max(0, Number(source.getMinedEnergyFreeCapacity?.()) || 0);
            if (free <= 0) return 0;
            if (gatherRatio > 0) appliedDamage = Math.min(damage, Math.ceil(free / gatherRatio));
        } else if (directToWarehouse && EnergyManager) {
            const free = EnergyManager.getFreeCapacity();
            if (gatherRatio > 0) appliedDamage = Math.min(damage, Math.ceil(free / gatherRatio));
        }
        const before = this.hp;
        super.takeDamage(appliedDamage, source, damageType, isMelee);
        const dealt = Math.max(0, before - this.hp);
        if (dealt <= 0) return dealt;
        const energy = Math.floor(dealt * gatherRatio);
        if (energy > 0) {
            if (minerBackpack) {
                source.addMinedEnergy(energy);
            } else if (directToWarehouse && EnergyManager) {
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
        return dealt;
    }

    /** 覆写默认生物死亡：先保活显示枯竭贴图，禁止血雾/尸体清理抢先终止矿点 update。 */
    onDeath(_source) {
        if (this._depleted || this._sinking) return;
        this.hp = 0;
        this.active = true;
        this.hittable = false;
        this._depleted = true;
        this._collapseTimer = ENERGY_CONFIG.depletedHoldMs ?? 650;
        this._swapTexture(
            this._depletedKey || 'energy_node_depleted',
            this._usesDirectionalVein ? this._connectionMask : null
        );
    }

    /** 直接换活精灵贴图（_syncNeutralEntities 只创建一次 sprite，换肤必须手动）。
     *  正常/枯竭正式图共用 Alpha；这里仍按真实帧宽高重算，兼容程序化兜底。 */
    _swapTexture(key, frameIndex = null) {
        const scene = window.__phaserScene;
        if (!scene || !scene.textures || !scene.textures.exists(key)) return;
        const hasFrame = Number.isInteger(frameIndex);
        const frame = scene.textures.getFrame(key, hasFrame ? frameIndex : undefined);
        let aspect = 1.05;
        if (frame && frame.realWidth > 0 && frame.realHeight > 0) {
            aspect = frame.realWidth / frame.realHeight;
        }
        const displayBaseWidth = this._usesDirectionalVein
            ? 128
            : (ENERGY_CONFIG.visualDisplayWidth ?? ENERGY_CONFIG.nodeSize);
        const displayW = Math.round(displayBaseWidth * (this._displayScale || 1));
        const displayH = Math.round(displayW / aspect);
        this.spriteCfg.idleKey = key;
        if (hasFrame) this.spriteCfg.frame = frameIndex;
        else delete this.spriteCfg.frame;
        this.spriteCfg.size = displayW;
        this.spriteCfg.sizeH = displayH;
        this.spriteCfg.footOffsetY = displayH / 2;
        this.footOffsetY = this.spriteCfg.footOffsetY;
        const data = scene._neutralSprites && scene._neutralSprites.get(this);
        if (data && data.sprite && data.sprite.active) {
            if (hasFrame) data.sprite.setTexture(key, frameIndex);
            else data.sprite.setTexture(key);
            data.sprite.setDisplaySize(displayW, displayH);
        }
    }

    /** 应用四邻掩码；贴图缺失时保留构造阶段选中的旧版兜底。 */
    _applyConnectionMask(mask) {
        const normalizedMask = Number(mask) & 0x0f;
        const pair = energyNodeDirectionalPair(window.__phaserScene);
        if (!pair) return false;
        if (this._usesDirectionalVein
            && this._connectionMask === normalizedMask
            && this._texKey === pair.key
            && this._depletedKey === pair.depletedKey) {
            return true;
        }
        this._usesDirectionalVein = true;
        this._connectionMask = normalizedMask;
        this._texKey = pair.key;
        this._depletedKey = pair.depletedKey;
        this._texSource = pair.source;
        this._facingLeft = false;
        this._displayScale = 1;
        this._swapTexture(this._depleted ? pair.depletedKey : pair.key, normalizedMask);
        return true;
    }

    update(dt) {
        super.update(dt);
        if (this._depleted && !this._sinking) {
            this._collapseTimer -= dt;
            if (this._collapseTimer <= 0) this._startCollapse();
        }
    }

    /** 复用建筑摧毁同款沉陷、footprint 烟尘和遮罩，结束后由特效销毁精灵。 */
    _startCollapse() {
        if (this._sinking) return;
        this._sinking = true;
        this.hittable = false;
        // 矿点平时保持零碰撞；仅在沉陷特效构造前补齐 1×1 投影，供遮罩/烟尘采样。
        this.collisionShape = 'iso_rect';
        this.collisionWidth = ONE_CELL_BUILDING_FOOT.w;
        this.collisionHeight = ONE_CELL_BUILDING_FOOT.d;
        this.collisionIsoHalfU = ONE_CELL_BUILDING_FOOT.halfU;
        this.collisionIsoHalfV = ONE_CELL_BUILDING_FOOT.halfV;
        this.colliderOffsetX = 0;
        this.colliderOffsetY = 0;
        EnergyNodeSystem._removeNodeReference(this);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 36, '能源矿已枯竭', '#8f9999'));
            EffectManager.add(new BuildingSinkEffect(this).start());
        } else {
            this.active = false;
        }
    }
}

// ==================== 系统 ====================

export const EnergyNodeSystem = {
    nodes: [],
    active: false,
    layoutVersion: ENERGY_CONFIG.generation?.layoutVersion ?? 2,

    /** 位面首次物化时按世代随机流生成资源布局；完整快照随后会覆盖为既有状态。 */
    setup({ random = Math.random, portal = null, diamond = null } = {}) {
        this.teardown();
        this._generationRandom = typeof random === 'function' ? random : Math.random;
        this._portal = portal && Number.isFinite(portal.x) && Number.isFinite(portal.y)
            ? { x: portal.x, y: portal.y }
            : { x: diamond?.cx || 0, y: diamond?.cy || 0 };
        this._diamond = diamond || null;
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
        // 每世代随机生成 5 个远距密集主簇，并额外生成传送门 1200px 环上的三矿保底簇。
        const layout = this._generateClusterLayout(this._portal, this._diamond);
        this._generatedClusters = layout.map(({ cells: _cells, ...cluster }) => cluster);
        for (const cl of layout) {
            for (const [ci, cj] of cl.cells) {
                const [px, py] = blockCellCenter(ci, cj);
                const storage = ENERGY_CONFIG.storage.min
                    + Math.floor(this._generationRandom() * (ENERGY_CONFIG.storage.max - ENERGY_CONFIG.storage.min + 1));
                const variant = this._takeVariant();
                const node = new EnergyNode(px, py, {
                    hp: storage,
                    maxHp: storage,
                    variant,
                    cell: [ci, cj],
                });
                node._formMeta = energyNodeFormMeta(variant);
                const id = `energy_node_${this._generationRandom().toString(36).slice(2, 8)}`;
                node.id = id;
                Game.entities.set(id, node);
                this.nodes.push(node);
            }
        }
        this._refreshConnections();
          // 能源矿取消物理碰撞：不向 A*登记圆形障碍，单位可直接穿过矿体。
          if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
              pathFinder.setEntityCircleObstacles([]);
          }
    },

    /** 按快照重建矿点（世界-122 场景快照恢复，2026-08-18 M0）：
     *  位置/余量/枯竭计时全部来自快照，不走 setup 的随机重铺。 */
    restoreNodes(list, { migrateLayout = false } = {}) {
        if (!Array.isArray(list)) return;
        // 空数组表示当前位面的矿已全部采完，必须覆盖 setup() 的初始生成结果。
        if (list.length === 0) {
            if (Game && Game.entities) {
                for (const [key, entity] of Array.from(Game.entities.entries())) {
                    if (entity?._isEnergyNode) Game.entities.delete(key);
                }
            }
            this.nodes = [];
            return;
        }
        // 旧固定四簇快照迁移到当前 5+1 随机布局：只保留旧快照仍存在的矿物数量，
        // 逐个搬运余量/枯竭态，不允许迁移过程把已经采掉的矿重新补满。
        const hasGridLayout = list.length > 0 && list.every((s) =>
            Number.isInteger(s?.cellI) && Number.isInteger(s?.cellJ)
        );
        if (migrateLayout || !hasGridLayout) {
            const generated = this.nodes.filter((node) => node && node.active !== false);
            const limit = Math.min(generated.length, list.length);
            for (let index = 0; index < limit; index++) {
                this._applySnapshotState(generated[index], list[index]);
            }
            for (let index = limit; index < generated.length; index++) {
                generated[index].active = false;
                this._removeNodeReference(generated[index], false);
            }
            this._refreshConnections();
            return;
        }
        // 清掉 setup 随机铺的节点（实体 + 列表），再按快照重建
        if (Game && Game.entities) {
            for (const [k, e] of Array.from(Game.entities.entries())) {
                if (e && e._isEnergyNode) Game.entities.delete(k);
            }
        }
        this.nodes = [];
        const clusters = this._generatedClusters || [];
        const occupiedCells = new Set();
        for (const s of list) {
            if (!s || !Number.isInteger(s.cellI) || !Number.isInteger(s.cellJ)) continue;
            const ci = s.cellI;
            const cj = s.cellJ;
            const key = this._cellKey(ci, cj);
            if (occupiedCells.has(key)) continue;
            const [px, py] = blockCellCenter(ci, cj);
            // 旧存档/HMR 可能保存过基地门口或旧矿簇坐标。快照恢复必须沿用
            // 当前版本的生成约束，不能把 setup() 已排除的非法矿点重新放回来。
            const nearCluster = clusters.some((c) =>
                Math.hypot(px - c.x, py - c.y) <= (c.spread || 320) + 50
            );
            if (!nearCluster) continue;
            if (!this._insideGenerationDiamond(px, py)) continue;
            if (overlapsActiveGateAt(px, py)) continue;
            if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                && !WallSystem.canMoveTo(px, py, ENERGY_CONFIG.nodeRadius)
                && !allowsEnergyNodeOverlapAt(px, py)) {
                continue;
            }
            const maxHp = Math.max(1, Math.floor(s.maxHp || s.hp || 1));
            const node = new EnergyNode(px, py, {
                hp: Math.max(0, Math.min(maxHp, Math.floor(s.hp ?? maxHp))),
                maxHp,
                variant: s.variant || 1,
                cell: [ci, cj],
            });
            node._formMeta = energyNodeFormMeta(node._variant);
            this._applySnapshotState(node, s);
            const id = `energy_node_${Math.random().toString(36).slice(2, 8)}`;
            node.id = id;
            Game.entities.set(id, node);
            this.nodes.push(node);
            occupiedCells.add(key);
        }
        this._refreshConnections();
        if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
            pathFinder.setEntityCircleObstacles([]);
        }
    },

    /** 运行时矿点强制审计：场上只允许存在当前世代 5+1 簇范围内的矿点——
     *  ① 不在任何簇（spread+50 内）→ 残留节点，删除；
     *  ② 同一 1×1 格多节点只保留第一个 → 防“贴图叠在一起”。
     *  实机：基地门右柱叠 3 个矿点 + 北边/门边散点均来自旧配置/HMR 残留，一律清除。 */
    sweepStacked() {
        if (!Game || !Game.entities) return;
        const clusters = this._generatedClusters || [];
        const seen = new Set();
        const kept = [];
        let removed = 0;
        for (const [k, e] of Array.from(Game.entities.entries())) {
            if (!e || !e._isEnergyNode || !e.active) continue;
            const [ci, cj] = blockCellOf(e.x, e.y);
            const [px, py] = blockCellCenter(ci, cj);
            // ① 残留节点：不在任何当前簇半径内（spread + 50 余量）
            const nearCluster = clusters.some((c) => Math.hypot(px - c.x, py - c.y) <= (c.spread || 320) + 50);
            const blockedByGate = overlapsActiveGateAt(px, py);
            const blockedByStructure = WallSystem && typeof WallSystem.canMoveTo === 'function'
                && !WallSystem.canMoveTo(px, py, ENERGY_CONFIG.nodeRadius)
                && !allowsEnergyNodeOverlapAt(px, py);
            if (!nearCluster || !this._insideGenerationDiamond(px, py)
                || blockedByGate || blockedByStructure) {
                e.active = false;
                Game.entities.delete(k);
                removed++;
                continue;
            }
            // ② 同格堆叠：只保留第一个；保留项强制回到精确格心。
            const key = this._cellKey(ci, cj);
            if (seen.has(key)) {
                e.active = false;
                Game.entities.delete(k);
                removed++;
            } else {
                seen.add(key);
                e.x = px;
                e.y = py;
                e._gridCellI = ci;
                e._gridCellJ = cj;
                e._energyNodeFootprintCells = ENERGY_CONFIG.footprintCells ?? 1;
                e._isOneCellEnergyNode = true;
                kept.push(e);
            }
        }
        this.nodes = kept;
        this._refreshConnections();
        if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
            pathFinder.setEntityCircleObstacles([]);
        }
        return removed;
    },

    _cellKey(i, j) {
        return `${i},${j}`;
    },

    _insideGenerationDiamond(x, y, inset = 0) {
        const diamond = this._diamond;
        if (!diamond) return true;
        const rx = Math.max(1, Number(diamond.rx) - inset);
        const ry = Math.max(1, Number(diamond.ry) - inset);
        return Math.abs(x - diamond.cx) / rx + Math.abs(y - diamond.cy) / ry <= 1;
    },

    _randomDiamondPoint(inset) {
        const diamond = this._diamond;
        if (!diamond) return {
            x: this._portal.x + (this._generationRandom() * 2 - 1) * 5000,
            y: this._portal.y + (this._generationRandom() * 2 - 1) * 2500,
        };
        const rx = Math.max(1, Number(diamond.rx) - inset);
        const ry = Math.max(1, Number(diamond.ry) - inset);
        return {
            x: diamond.cx + (this._generationRandom() * 2 - 1) * rx,
            y: diamond.cy + (this._generationRandom() * 2 - 1) * ry,
        };
    },

    /**
     * 生成当前位面世代的完整 5+1 布局。候选簇必须一次放满才接纳，避免障碍边缘
     * 产生少于配置数量的残簇；所有接纳矿格共享 occupiedCells，保证跨簇不重叠。
     */
    _generateClusterLayout(portal, diamond) {
        const cfg = ENERGY_CONFIG.generation || {};
        const random = this._generationRandom || Math.random;
        const occupiedCells = new Set();
        const accepted = [];
        const attempts = Math.max(60, Math.floor(cfg.candidateAttempts || 720));
        const inset = Math.max(0, Number(cfg.diamondInset) || 380);
        const spread = Math.max(160, Number(cfg.clusterSpread) || 320);
        const fallbackSpread = Math.max(120, Number(cfg.fallbackSpread) || 180);
        const minPortalDistance = Math.max(0, Number(cfg.majorMinPortalDistance) || 3000);
        const majorSpacing = Math.max(spread * 2, Number(cfg.majorMinCenterSpacing) || 850);
        const fallbackSpacing = Math.max(fallbackSpread * 2, Number(cfg.fallbackMinCenterSpacing) || 520);

        const acceptCluster = (cluster, count, validateCells = null) => {
            const trialOccupied = new Set(occupiedCells);
            const cells = this._growAdjacentClusterCells(cluster, count, trialOccupied);
            if (cells.length !== count || (validateCells && !validateCells(cells))) return false;
            for (const [i, j] of cells) occupiedCells.add(this._cellKey(i, j));
            accepted.push({ ...cluster, count, cells });
            return true;
        };

        // 保底簇优先占位：角度随机，随后用黄金角遍历整圈，直到找到菱形内可完整放下三矿的位置。
        const fallbackDistance = Math.max(0, Number(cfg.fallbackPortalDistance) || 1200);
        const fallbackCount = Math.max(1, Math.floor(cfg.fallbackNodeCount || 3));
        const startAngle = random() * Math.PI * 2;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        for (let attempt = 0; attempt < attempts; attempt++) {
            const angle = startAngle + attempt * goldenAngle;
            const center = {
                x: portal.x + Math.cos(angle) * fallbackDistance,
                y: portal.y + Math.sin(angle) * fallbackDistance,
            };
            if (!this._insideGenerationDiamond(center.x, center.y, inset)) continue;
            const cluster = {
                ...center,
                spread: fallbackSpread,
                kind: 'fallback',
                portal,
                diamond,
                minPortalDistance: fallbackDistance,
            };
            if (acceptCluster(cluster, fallbackCount, (cells) => cells.every(([i, j]) => {
                const [x, y] = blockCellCenter(i, j);
                return Math.hypot(x - portal.x, y - portal.y) >= fallbackDistance;
            }))) break;
        }

        const majorCount = Math.max(0, Math.floor(cfg.majorClusterCount || 5));
        const nodeMin = Math.max(1, Math.floor(cfg.majorNodeCount?.min || 10));
        const nodeMax = Math.max(nodeMin, Math.floor(cfg.majorNodeCount?.max || 12));
        const desiredCounts = Array.from({ length: majorCount }, () =>
            nodeMin + Math.floor(random() * (nodeMax - nodeMin + 1)));
        const minimumTotal = Math.max(fallbackCount, Math.floor(cfg.minimumTotalNodes || 0));
        let desiredTotal = fallbackCount + desiredCounts.reduce((sum, count) => sum + count, 0);
        for (let index = 0; desiredTotal < minimumTotal && index < majorCount * (nodeMax - nodeMin); index++) {
            const slot = index % majorCount;
            if (desiredCounts[slot] >= nodeMax) continue;
            desiredCounts[slot]++;
            desiredTotal++;
        }
        for (let clusterIndex = 0; clusterIndex < majorCount; clusterIndex++) {
            let placed = false;
            for (let attempt = 0; attempt < attempts; attempt++) {
                const center = this._randomDiamondPoint(inset);
                if (!this._insideGenerationDiamond(center.x, center.y, inset)) continue;
                if (Math.hypot(center.x - portal.x, center.y - portal.y) < minPortalDistance) continue;
                if (accepted.some((cluster) => Math.hypot(center.x - cluster.x, center.y - cluster.y)
                    < (cluster.kind === 'fallback' ? fallbackSpacing : majorSpacing))) continue;
                const count = desiredCounts[clusterIndex];
                const cluster = {
                    ...center,
                    spread,
                    kind: 'major',
                    portal,
                    diamond,
                    minPortalDistance,
                };
                if (acceptCluster(cluster, count, (cells) => cells.every(([i, j]) => {
                    const [x, y] = blockCellCenter(i, j);
                    return Math.hypot(x - portal.x, y - portal.y) >= minPortalDistance;
                }))) {
                    placed = true;
                    break;
                }
            }
            if (!placed) console.warn(`[EnergyNodeSystem] 主矿簇 ${clusterIndex + 1}/${majorCount} 无合法位置`);
        }

        const fallbackPlaced = accepted.some((cluster) => cluster.kind === 'fallback');
        const majorPlaced = accepted.filter((cluster) => cluster.kind === 'major').length;
        if (!fallbackPlaced) console.warn(`[EnergyNodeSystem] 传送门 ${fallbackDistance}px 保底矿簇无合法位置`);
        if (majorPlaced !== majorCount) {
            console.warn(`[EnergyNodeSystem] 主矿簇仅生成 ${majorPlaced}/${majorCount}`);
        }
        return accepted;
    },

    _cellAllowed(i, j, cluster, occupiedCells) {
        const key = this._cellKey(i, j);
        if (occupiedCells.has(key)) return false;
        const [x, y] = blockCellCenter(i, j);
        if (Math.hypot(x - cluster.x, y - cluster.y) > (cluster.spread ?? 320)) return false;
        if (!this._insideGenerationDiamond(x, y, 64)) return false;
        if (cluster.minPortalDistance > 0
            && Math.hypot(x - cluster.portal.x, y - cluster.portal.y) < cluster.minPortalDistance) return false;
        if (overlapsActiveGateAt(x, y)) return false;
        return !(WallSystem && typeof WallSystem.canMoveTo === 'function'
            && !WallSystem.canMoveTo(x, y, ENERGY_CONFIG.nodeRadius)
            && !allowsEnergyNodeOverlapAt(x, y));
    },

    /** 从最近合法种子格向四邻格生长，只有成功放置的格才继续产生前沿。 */
    _growAdjacentClusterCells(cluster, count, occupiedCells) {
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const [seedI, seedJ] = blockCellOf(cluster.x, cluster.y);
        const seedQueue = [[seedI, seedJ]];
        const seedSeen = new Set();
        let seed = null;
        while (seedQueue.length > 0 && seedSeen.size < count * 20) {
            const candidate = seedQueue.shift();
            const key = this._cellKey(candidate[0], candidate[1]);
            if (seedSeen.has(key)) continue;
            seedSeen.add(key);
            if (this._cellAllowed(candidate[0], candidate[1], cluster, occupiedCells)) {
                seed = candidate;
                break;
            }
            for (const [di, dj] of neighbors) {
                seedQueue.push([candidate[0] + di, candidate[1] + dj]);
            }
        }
        if (!seed) return [];

        const cells = [];
        const frontier = [];
        const queued = new Set();
        const addCell = (cell) => {
            const key = this._cellKey(cell[0], cell[1]);
            occupiedCells.add(key);
            cells.push(cell);
            for (const [di, dj] of neighbors) {
                const next = [cell[0] + di, cell[1] + dj];
                const nextKey = this._cellKey(next[0], next[1]);
                if (!occupiedCells.has(nextKey) && !queued.has(nextKey)) {
                    queued.add(nextKey);
                    frontier.push(next);
                }
            }
        };
        addCell(seed);
        let guard = 0;
        while (cells.length < count && frontier.length > 0 && guard++ < count * 40) {
            const index = Math.floor(this._generationRandom() * frontier.length);
            const candidate = frontier.splice(index, 1)[0];
            queued.delete(this._cellKey(candidate[0], candidate[1]));
            if (!this._cellAllowed(candidate[0], candidate[1], cluster, occupiedCells)) continue;
            addCell(candidate);
        }
        return cells;
    },

    _applySnapshotState(node, state) {
        if (!node || !state) return;
        const maxHp = Math.max(1, Math.floor(state.maxHp || state.hp || node.maxHp || 1));
        node.maxHp = maxHp;
        node.hp = Math.max(0, Math.min(maxHp, Math.floor(state.hp ?? maxHp)));
        node._depleted = !!state.depleted || node.hp <= 0;
        node._collapseTimer = node._depleted
            ? Math.max(0, Number(state.collapseTimer) || ENERGY_CONFIG.depletedHoldMs || 650)
            : 0;
        if (node._depleted) {
            node.hp = 0;
            node.hittable = false;
            node._swapTexture(
                node._depletedKey || 'energy_node_depleted',
                node._usesDirectionalVein ? node._connectionMask : null
            );
        }
    },

    /** 由当前存活节点位置派生 4-bit 邻接，不写入快照，恢复旧存档后也会得到一致拼接。 */
    _refreshConnections() {
        const byCell = new Map();
        for (const node of this.nodes) {
            if (!node || node.active === false || node._sinking) continue;
            byCell.set(this._cellKey(node._gridCellI, node._gridCellJ), node);
        }
        for (const node of byCell.values()) {
            const i = node._gridCellI;
            const j = node._gridCellJ;
            let mask = 0;
            if (byCell.has(this._cellKey(i + 1, j))) mask |= ENERGY_NODE_CONNECTION_BITS.I_POSITIVE;
            if (byCell.has(this._cellKey(i - 1, j))) mask |= ENERGY_NODE_CONNECTION_BITS.I_NEGATIVE;
            if (byCell.has(this._cellKey(i, j + 1))) mask |= ENERGY_NODE_CONNECTION_BITS.J_POSITIVE;
            if (byCell.has(this._cellKey(i, j - 1))) mask |= ENERGY_NODE_CONNECTION_BITS.J_NEGATIVE;
            node._applyConnectionMask(mask);
            node._formMeta = { key: 'directional_mask', label: `方向拼接 ${mask}`, mask };
        }
    },

    /** 矿点开始沉陷时立即退出系统数组与实体表；精灵已由 BuildingSinkEffect 接管。 */
    _removeNodeReference(node, refreshConnections = true) {
        const index = this.nodes.indexOf(node);
        if (index >= 0) this.nodes.splice(index, 1);
        if (Game && Game.entities) {
            for (const [key, entity] of Array.from(Game.entities.entries())) {
                if (entity === node) Game.entities.delete(key);
            }
        }
        if (refreshConnections) this._refreshConnections();
    },

    /** 3 形态洗牌袋：一袋内尽量不重复，抽空再洗 */
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
        this._generatedClusters = [];
        this._portal = null;
        this._diamond = null;
          // 清除寻路专用实体障碍登记，避免切场景后残留已销毁的能源矿坐标
          if (pathFinder && typeof pathFinder.setEntityCircleObstacles === 'function') {
              pathFinder.setEntityCircleObstacles([]);
          }
        this.active = false;
    },

    /** 资源点实体自带 update（主循环调用），系统层无需逐帧推进 */

    /** 资源点贴图：
     *  1) 优先 BootScene 已加载的 16 帧道路式四邻拼接图集；
     *  2) 图集缺失时，回退 3 种 AI 裸露矿脉或程序化同语义兜底；
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
