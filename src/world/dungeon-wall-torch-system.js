import { WallSystem, ISO_WALL_GEO } from './wall-system.js';
import mineWallDecorConfig from '../../data/abandoned-mine-wall-decor.json';

// 旧 obstacle_torch 原图 144×278：金属背板挂点与燃烧杯中心，不能把画布中心当火源。
const MOUNT = { x: 120, y: 128 };
const FLAME = { x: 26, y: 14 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const coordinateKey = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
const hashPoint = (p, salt = 0x31a7b529) => (Math.imul(Math.round(p.x), 73856093)
    ^ Math.imul(Math.round(p.y), 19349663) ^ salt) >>> 0;
const mixHash = (value) => {
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
};

// 仅消费已完成的几何，不依赖某个主题的布局生成模块或随机流。
function pointInRoomShape(x, y, room) {
    const target = room?.bounds || room;
    const points = target?.floorPolygon || room?.floorPolygon;
    if (Array.isArray(points) && points.length >= 3) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const a = points[i], b = points[j];
            if ((a.y > y) !== (b.y > y)
                && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }
    return !!target && Math.abs(x - target.cx) / Math.max(1, target.rx)
        + Math.abs(y - target.cy) / Math.max(1, target.ry) <= 1;
}

function distanceToSegment(point, [a, b]) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy)
        / Math.max(1e-6, dx * dx + dy * dy)));
    return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
}

function wallCenter(piece, geo) {
    return {
        x: piece.x + (geo.groundCenter[0] - geo.w / 2) * piece.scaleX,
        y: piece.y + (geo.groundCenter[1] - geo.h / 2) * piece.scaleY,
    };
}

function straightAxis(piece, geo) {
    const segments = piece._baseSegments;
    if (!segments?.length || segments.length > 2) return null;
    const vectors = segments.map(([a, b]) => ({ x: b.x - a.x, y: b.y - a.y }));
    const lengths = vectors.map((v) => Math.hypot(v.x, v.y));
    if (lengths.some((length) => length < 1)) return null;
    // 规则房/直通道是一整段，随机墙环是两半段；门端只有半格，不可混淆。
    const fullStep = Math.hypot(geo.footprint[0] / 2, geo.footprint[1] / 2);
    if (lengths.reduce((sum, length) => sum + length, 0) < fullStep * 0.95) return null;
    if (vectors.length === 2 && Math.abs(vectors[0].x * vectors[1].y - vectors[0].y * vectors[1].x)
        > lengths[0] * lengths[1] * 0.01) return null;
    const sign = vectors[0].x < 0 ? -1 : 1;
    return { x: vectors[0].x / lengths[0] * sign, y: vectors[0].y / lengths[0] * sign };
}

/** 只读最终墙段的挂饰层；不参加 isoVisuals、碰撞、布局候选和房间随机流。 */
export const DungeonWallTorchSystem = {
    _scene: null,
    _records: [],

    spawn({ rooms = [], corridors = [], gates = [], avoidPoints = [] } = {}) {
        this.clear();
        const style = WallSystem.getWallStyle();
        const cfg = style?.wallTorches;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const torch = ISO_WALL_GEO.torch;
        if (!cfg?.enabled || !scene?.textures.exists(torch.tex)) return 0;
        const blocks = new Set(style.blocks || [style.block]);
        const pieces = WallSystem.isoVisuals.filter((piece) => piece._gridBlockWall
            && blocks.has(piece._gridBlockVariant));
        const walls = pieces.map((piece) => {
            const geo = ISO_WALL_GEO[piece._gridBlockVariant];
            return { piece, center: wallCenter(piece, geo), axis: straightAxis(piece, geo) };
        });
        const corners = walls.filter((wall) => !wall.axis).map((wall) => wall.center);
        const regions = [
            ...rooms.map((room) => ({ kind: 'room', contains: (p) => pointInRoomShape(p.x, p.y, room),
                limit: cfg.maxPerRoom, count: 0 })),
            ...corridors.map((corridor) => ({ kind: 'passage', contains: (p) =>
                pointInRoomShape(p.x, p.y, { floorPolygon: corridor.points })
                && !(corridor.holes || []).some((hole) =>
                    pointInRoomShape(p.x, p.y, { floorPolygon: hole })),
            limit: cfg.maxPerPassage, count: 0 })),
        ];
        const candidates = [];
        const seen = new Set();
        for (const wall of walls) {
            const { piece, center, axis } = wall;
            if (!axis || cfg.skipBlocks.includes(piece._gridBlockVariant)) continue;
            const key = coordinateKey(center);
            if (seen.has(key)) continue;
            seen.add(key);
            if (corners.some((corner) => distance(center, corner) < cfg.cornerClearance)) continue;
            if (gates.some((gate) => distanceToSegment(center, gate) < cfg.gateClearance)) continue;
            if (avoidPoints.some((point) => distance(center, point) < point.r)) continue;
            // 只挂朝镜头、且面向真实房内/通道地板的墙面；不把外墙或回环内孔当房内。
            const normal = { x: -axis.y, y: axis.x };
            const inside = { x: center.x + normal.x * 48, y: center.y + normal.y * 48 };
            const region = regions.find((item) => item.contains(inside));
            if (!region) continue;
            candidates.push({ ...wall, normal, region, hash: hashPoint(center) });
        }
        // 独立坐标散列仅排序美术候选，绝不消耗布局/怪物随机数。
        candidates.sort((a, b) => a.hash - b.hash || a.center.y - b.center.y || a.center.x - b.center.x);
        this._scene = scene;
        scene.events.once('shutdown', this.clear, this);
        scene._ensureImpactDotTexture?.();
        for (const candidate of candidates) {
            if (this._records.length >= cfg.maxTotal) break;
            if (candidate.region.count >= candidate.region.limit) continue;
            if (this._records.some((record) => distance(record.center, candidate.center) < cfg.spacing)) continue;
            this._place(candidate, cfg, torch);
            candidate.region.count++;
        }
        // 火把先完成，挂饰仅填剩余净空，保持已有火把的位置和数量。
        if (style.wallDecorations) this._placeDecorations(candidates);
        return this._records.length;
    },

    _placeDecorations(candidates) {
        const scene = this._scene;
        const cfg = mineWallDecorConfig;
        const counts = new Map();
        let total = 0;
        const sorted = candidates.map((candidate) => ({ ...candidate,
            decorHash: mixHash(hashPoint(candidate.center, 0x63a2c18d)) }))
            .sort((a, b) => a.decorHash - b.decorHash || a.center.y - b.center.y || a.center.x - b.center.x);
        for (const candidate of sorted) {
            if (total >= cfg.maxTotal) break;
            const { center, axis, region, piece, decorHash } = candidate;
            if ((decorHash % 1000) / 1000 >= cfg.density) continue;
            const limit = region.kind === 'room' ? cfg.maxPerRoom : cfg.maxPerPassage;
            if ((counts.get(region) || 0) >= limit) continue;
            if (this._records.some((record) => distance(record.center, center)
                < (record.decorationId ? cfg.spacing : cfg.torchClearance))) continue;
            const direction = axis.y < 0 ? 'up' : 'down';
            const choices = cfg.assets.filter((asset) => scene.textures.exists(asset.views[direction].key)
                && !this._records.some((record) => record.decorationId === asset.id
                    && distance(record.center, center) < cfg.repeatDistance));
            if (!choices.length) continue;
            let roll = (mixHash(hashPoint(center, 0x174e962b)) / 4294967296)
                * choices.reduce((sum, asset) => sum + asset.weight, 0);
            const asset = choices.find((item) => { roll -= item.weight; return roll < 0; })
                || choices[choices.length - 1];
            const view = asset.views[direction];
            const along = ((decorHash >>> 10) % 17) - 8;
            const height = cfg.mountHeight + ((decorHash >>> 16) % 13) - 6;
            const scale = view.displayWidth / 512;
            // 等距墙面法向投影沿另一条格网轴，不是屏幕中的欧氏垂线。
            // 核心侧面在格心外约37×19px，再留浅浮出量，防止邻墙吞掉宽挂饰。
            const body = scene.add.image(
                center.x + (axis.y < 0 ? 1 : -1) * cfg.faceOffset.x + axis.x * along,
                center.y + cfg.faceOffset.y + axis.y * along - height,
                view.key,
            ).setOrigin(view.origin[0], view.origin[1]).setScale(scale)
                .setDepth(piece.depth + 0.12);
            // 两个墙向分别建模渲染，禁止再水平镜像烘焙光照。
            scene.worldEffectsGroup?.add(body);
            this._records.push({ center, body, emitter: null, glowKeys: [], decorationId: asset.id });
            counts.set(region, (counts.get(region) || 0) + 1);
            total++;
        }
    },

    _place(candidate, cfg, torch) {
        const scene = this._scene;
        const { piece, center, axis, normal, hash } = candidate;
        const scaleX = cfg.scale * (axis.y < 0 ? -1 : 1);
        const mount = {
            x: center.x + normal.x * cfg.faceOffset,
            y: center.y + normal.y * cfg.faceOffset - cfg.mountHeight,
        };
        const flame = {
            x: mount.x + (FLAME.x - MOUNT.x) * scaleX,
            y: mount.y + (FLAME.y - MOUNT.y) * cfg.scale,
        };
        const depth = piece.depth + 0.15;
        // 带偏心挂点的左右墙向用带符号scale，保证背板、杯口和粒子共用同一变换。
        const body = scene.add.image(mount.x, mount.y, torch.tex)
            .setOrigin(MOUNT.x / torch.w, MOUNT.y / torch.h)
            .setScale(scaleX, cfg.scale).setDepth(depth);
        scene.worldEffectsGroup?.add(body);
        let emitter = null;
        if (scene.textures.exists('impact_dot')) {
            emitter = scene.add.particles(flame.x, flame.y, 'impact_dot', {
                frequency: 85, lifespan: 420, quantity: 1,
                speedY: { min: -28, max: -48 }, speedX: { min: -4, max: 4 },
                scale: { start: 0.95, end: 0.08 }, alpha: { start: 0.8, end: 0 },
                tint: [0xffe2a0, 0xffbc56, 0xe96f28], blendMode: 'ADD',
            });
            emitter.setDepth(depth + 0.05);
            emitter.addToUpdateList();
            scene.worldEffectsGroup?.add(emitter);
        }
        const key = `dungeon-wall-torch:${coordinateKey(center)}`;
        const glowKeys = [`${key}:wall`, `${key}:flame`];
        const glowOptions = [
            { x: mount.x, y: mount.y + 16, radius: cfg.lightRadius, alpha: cfg.lightAlpha },
            { ...flame, radius: 32, alpha: 0.24 },
        ];
        glowOptions.forEach((options, index) => {
            const glow = scene.registerEnvironmentGlow?.(glowKeys[index], options.x, options.y, {
                ...options, color: 0xffa24a, depth: depth - 0.05,
                flicker: 0.1, pulsePeriodMs: 850 + hash % 500,
            });
            if (glow) glow.setAlpha(0); // 由现有光源同步尊重设置与迷雾。
        });
        this._records.push({ center, body, emitter, glowKeys });
    },

    update() {
        const scene = this._scene;
        if (!scene) return;
        for (let i = this._records.length - 1; i >= 0; i--) {
            const record = this._records[i];
            // 通用场景实体清理也会销毁worldEffectsGroup，及时摘除配对暖光。
            if (!record.body.scene) {
                record.glowKeys.forEach((key) => scene.unregisterEnvironmentGlow?.(key));
                if (record.emitter?.scene) record.emitter.destroy();
                this._records.splice(i, 1);
                continue;
            }
            const visible = !scene._mapModeActive
                && (scene.isFogPointVisible?.(record.center.x, record.center.y) ?? true);
            record.body.setVisible(visible);
            if (record.emitter) {
                record.emitter.setVisible(visible);
                record.emitter.emitting = visible;
            }
        }
    },

    clear() {
        const scene = this._scene;
        if (!scene) return;
        scene.events.off('shutdown', this.clear, this);
        for (const record of this._records) {
            record.glowKeys.forEach((key) => scene.unregisterEnvironmentGlow?.(key));
            if (record.emitter?.scene) record.emitter.destroy();
            if (record.body?.scene) record.body.destroy();
        }
        this._records = [];
        this._scene = null;
    },
};
