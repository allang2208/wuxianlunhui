import { WallSystem } from '../../../world/wall-system.js';
import { SpawnPlacement } from '../../../world/spawn-placement.js';
import { canInvasionSummon, invasionSummonSlotsLeft, inheritInvasionSummon } from '../../../world/invasion-summon-budget.js';

/**
 * 怪物召唤统一接口（ROADMAP：各怪物类内重复召唤逻辑收口）
 *
 * 统一处理：安全落点选择、墙体校验、唯一 key 生成、_summoned 标记、
 * entities 注册、生成粒子特效。
 *
 * 用法：
 *   summonMonster(this, {
 *     factory: (x, y) => createBasicZombie(x, y),
 *     count: 3,
 *     mode: 'radial',
 *     radius: 15,
 *     distance: 100,
 *     tag: 'tombstone_zombie',
 *   });
 */

/** 获取游戏全局 entities（防御性回退） */
function getGameEntities() {
    if (typeof window === 'undefined') return null;
    const game = window.Game;
    return game && game.entities ? game.entities : null;
}

/** 获取当前 Phaser 场景（用于特效） */
function getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

/**
 * 为单个召唤物寻找安全落点
 * @param {object} spawner 召唤者实体
 * @param {object} opts
 * @returns {{x:number, y:number}|null}
 */
function findSpawnPosition(spawner, opts, entities) {
    const mode = opts.mode || 'radial';
    const radius = opts.radius ?? 15;
    const count = opts.count ?? 1;
    const index = opts.index ?? 0;

    // 格网建筑统一走生产建筑安全出口：同时避开墙体、建筑 footprint、
    // 动态单位与同帧预约，并验证一段可离场通道。矿洞等生成器不能再从
    // 自己的建筑中心调用 WallSystem.resolve，否则射线起点就在碰撞体内。
    if (spawner?._isGridBuilding && opts.buildingExit !== false) {
        const dirX = opts.forwardDirX ?? 1;
        const targetDistance = Math.max(128, Math.abs(opts.forwardX ?? 50));
        const spot = SpawnPlacement.findAndReserve(spawner, {
            unitRadius: radius,
            entities,
            wallSystem: WallSystem,
            preferredTarget: {
                x: spawner.x + Math.sign(dirX || 1) * targetDistance,
                y: spawner.y,
            },
        });
        return spot ? { ...spot, buildingExit: true } : null;
    }

    let candidates = [];

    if (mode === 'radial') {
        // 8 向 × 递近距离螺旋搜索
        const distance = opts.distance ?? 100;
        for (const dist of [distance, distance + 50, distance + 100, distance + 180]) {
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                candidates.push({
                    x: spawner.x + Math.cos(angle) * dist,
                    y: spawner.y + Math.sin(angle) * dist,
                });
            }
        }
    } else if (mode === 'forward') {
        // 正前方固定偏移（矿洞出怪口）
        const forwardX = opts.forwardX ?? 50;
        const dirX = opts.forwardDirX ?? 1;
        candidates.push({
            x: spawner.x + forwardX * dirX,
            y: spawner.y,
        });
    } else if (mode === 'scatter') {
        // 召唤者周围随机散落
        const spread = opts.spread ?? 50;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * spread;
        candidates.push({
            x: spawner.x + Math.cos(angle) * dist,
            y: spawner.y + Math.sin(angle) * dist,
        });
    } else if (mode === 'fixed') {
        // 固定偏移（如集合体下方）
        const offsetX = opts.offsetX ?? 0;
        const offsetY = opts.offsetY ?? 0;
        candidates.push({
            x: spawner.x + offsetX,
            y: spawner.y + offsetY,
        });
    } else if (mode === 'sector') {
        // 扇形均匀分布（如僵尸犬 -30°/0°/+30°）
        const distance = opts.distance ?? 100;
        const arc = opts.arc ?? (Math.PI / 3);
        const baseAngle = spawner.rotation || 0;
        const offset = count > 1 ? (index / (count - 1) - 0.5) * arc : 0;
        const angle = baseAngle + offset;
        candidates.push({
            x: spawner.x + Math.cos(angle) * distance,
            y: spawner.y + Math.sin(angle) * distance,
        });
    }

    // 校验候选点：优先 canMoveTo，否则螺旋外推
    for (const c of candidates) {
        if (WallSystem && typeof WallSystem.canMoveTo === 'function'
            && !WallSystem.canMoveTo(c.x, c.y, radius)) continue;
        return c;
    }

    // 最终回退：以 spawner 为中心螺旋搜索
    if (WallSystem && typeof WallSystem.findSafeSpawn === 'function') {
        const r = WallSystem.findSafeSpawn(spawner.x, spawner.y, radius);
        if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return r;
    }

    return null;
}

/**
 * 统一召唤入口
 * @param {object} spawner 召唤者实体
 * @param {object} opts
 * @param {function} opts.factory (x, y) => entity，必须
 * @param {string} [opts.type] 召唤物类型；入侵账本用它在创建前校验白名单
 * @param {number} [opts.count=1] 召唤数量
 * @param {string} [opts.mode='radial'] 落点模式
 * @param {number} [opts.radius=15] 召唤物 footprint 半径
 * @param {number} [opts.distance=100] radial/sector 模式距离
 * @param {number} [opts.spread=50] scatter 模式散落半径
 * @param {number} [opts.offsetX=0] fixed 模式 X 偏移
 * @param {number} [opts.offsetY=0] fixed 模式 Y 偏移
 * @param {number} [opts.forwardX=50] forward 模式前方距离
 * @param {number} [opts.forwardDirX=1] forward 模式方向（1 右 / -1 左）
 * @param {boolean} [opts.buildingExit=true] 格网建筑是否改用统一安全出口与离场通道
 * @param {number} [opts.arc=Math.PI/3] sector 模式扇形张角
 * @param {string} [opts.tag='summon'] key 前缀
 * @param {boolean} [opts.playFx=true] 是否播放地牢刷怪粒子
 * @param {boolean} [opts.setAnchor=false] 是否为站桩召唤物设置 _anchorX/_anchorY
 * @param {boolean} [opts.statusImmune=false] 是否对新召唤物调用 applyStatusImmune
 * @returns {object[]} 成功创建的实体数组
 */
export function summonMonster(spawner, opts = {}) {
    const factory = opts.factory;
    if (typeof factory !== 'function') return [];

    const entities = getGameEntities();
    if (!entities) return [];

    const scene = getScene();
    const tag = opts.tag || 'summon';
    if (!canInvasionSummon(spawner, opts.type)) return [];
    const count = Math.min(opts.count ?? 1, invasionSummonSlotsLeft(spawner));
    const playFx = opts.playFx !== false;
    const setAnchor = opts.setAnchor === true;
    const statusImmune = opts.statusImmune === true;
    const radius = opts.radius ?? 15;

    const created = [];

    for (let i = 0; i < count; i++) {
        const pos = findSpawnPosition(spawner, { ...opts, index: i }, entities);
        if (!pos) continue;

        const entity = factory(pos.x, pos.y);
        if (!entity) continue;

        // 仅矿洞天气的召唤链需要共享名额；其他召唤者保持原有行为。
        if (spawner?._mineWeather && !window.World126WeatherSystem?.admitSummon?.(spawner, entity)) {
            entity._destroyCustomEffects?.(); entity._destroyPhaserSprite?.();
            entity.active = false;
            continue;
        }

        if (!inheritInvasionSummon(spawner, entity, opts.type || entity._enemyTypeKey || entity.config?.id)) {
            entity._destroyCustomEffects?.(); entity._destroyPhaserSprite?.();
            entity.active = false;
            continue;
        }

        // 防卡墙：沿召唤者→落点射线解析
        if (!pos.buildingExit && WallSystem && typeof WallSystem.resolve === 'function') {
            const r = WallSystem.resolve(spawner.x, spawner.y, entity.x, entity.y, entity.groundRadius || radius);
            entity.x = r.x;
            entity.y = r.y;
            pos.x = r.x;
            pos.y = r.y;
        }

        // 召唤物统一标签
        entity._summoned = true;

        // 生产建筑离场契约：MovementSystem 会在接管普通目标/寻路前优先走到
        // 已验证的 egress，避免刚出生的单位被建筑边缘和其他召唤物夹住。
        if (pos.buildingExit && Number.isFinite(pos.egressX) && Number.isFinite(pos.egressY)) {
            entity._spawnEgress = { x: pos.egressX, y: pos.egressY };
        }

        // 站桩单位锁死出生点
        if (setAnchor) {
            entity._anchorX = pos.x;
            entity._anchorY = pos.y;
        }

        // 常驻状态免疫（如煮锅、矿洞）
        if (statusImmune && typeof entity.applyStatusImmune === 'function') {
            entity.applyStatusImmune(Number.MAX_SAFE_INTEGER);
        }

        // 唯一 key 防 Map 覆盖
        const key = `${tag}_${Date.now()}_${i}_${Math.floor(Math.random() * 10000)}`;
        entities.set(key, entity);
        created.push(entity);

        // 生成点黑色粒子
        if (playFx && scene && typeof scene.playDungeonSpawnParticles === 'function') {
            scene.playDungeonSpawnParticles(pos.x, pos.y);
        }
    }

    return created;
}
