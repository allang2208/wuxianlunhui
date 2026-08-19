// ============================================================
// BuildingSinkEffect — 建筑沉陷死亡特效（2026-08-16 掩体试点 v2）
// 被摧毁的建筑按原大小/原样式垂直陷入地下，接缝处小范围灰烟掩盖，结束后清除实体。
// - 不做压扁/缩放（v1 的 scaleY 形变 + 大烟团被用户判不合格）；
// - 直接推动实体 y 下沉（GameScene 中性精灵同步跟随 e.y，天然避开
//   setPosition 每帧覆盖问题）；尾段（85% 后）轻微淡出；
// - 烟尘用独立 graphics（深度走 WallSystem.junctionCorrectedDepth，
//   墙遮挡正确），小尺寸、低透明度、只贴接缝处。
// ============================================================
import { EffectFactory } from '../utils/effect-factory.js';
import {
    buildingSinkCropHeight,
    buildingSinkFootprintProjection,
    buildingSinkGroundLine,
    buildingSinkOcclusionPolygon,
    pointInSinkPolygon,
    scaleSinkPolygon,
} from './building-sink-geometry.js';

class BuildingSinkEffect {
    /**
     * @param {object} entity 被摧毁的建筑实体（特效首次 update 即令其失效并接管精灵）
     * @param {Function|Array|null} sprites null=从中性精灵表取单精灵；
     *   函数=调用返回精灵数组（塔/门等专属渲染）；数组=直接给精灵列表
     */
    constructor(entity, sprites = null) {
        this.entity = entity;
        this.x = entity.x;
        this.y = entity.y;
        this.baseY = null;             // 首次测量主贴图后锁定原始不透明底边
        this.active = true;
        this.duration = 2000;         // 沉陷总时长 ms
        this.settleDuration = 700;    // 建筑消失后烟尘继续遮盖并淡出
        this.timer = 0;
        this.sinkPx = 0;              // 累计下沉像素
        this._dustTimer = 0;
        this._spawnedDust = [];       // 仅用于生命周期/验收引用，实际更新回收仍由 EffectManager 管理
        this._finished = false;
        this._detached = false;
        this._sinkComplete = false;
        this._sprites = [];           // 接管的精灵列表（实体已失效，由特效独立驱动）
        this._label = null;
        this._faceDepth = 0;
        this._sources = sprites;
        this._contentMap = new Map(); // sprite → 贴图 alpha 上下边界/显示尺寸
        this._totalSink = null;
        this._seamOccluder = null;
        this._footprintProjection = buildingSinkFootprintProjection(entity);
        this._dustCenterX = this._footprintProjection?.center.x ?? entity.x;
        this._dustSpan = this._footprintProjection
            ? Math.max(80, this._footprintProjection.bounds.maxX - this._footprintProjection.bounds.minX)
            : Math.max(120, Number(entity?.collisionWidth) || Number(entity?.spriteCfg?.size) || 120);
        this._maskDepth = 0;
        this._clipMaskGraphics = null;
        this._clipMasks = [];
        this._clipPolygon = [];
        this._polygonMaskActive = false;
        this._maskInstallError = null;
    }

    /** 主动回收可立即拆碰撞/实体，同时保留已接管精灵继续播放。 */
    start() {
        this._detach(this.entity);
        return this;
    }

    /** 接管精灵并立即让实体失效（怪物/碰撞/寻路全部跳过，杜绝坍塌推开怪物） */
    _detach(e) {
        if (this._detached) return;
        this._detached = true;
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this._sources) {
            const list = typeof this._sources === 'function' ? (this._sources(e) || []) : this._sources;
            this._sprites = list.filter((s) => s && s.active);
        } else {
            const towerSprites = scene?._defenseSprites?.get(e);
            if (towerSprites) {
                this._sprites = [towerSprites.base, towerSprites.arm, towerSprites.weapon]
                    .filter((s) => s && s.active);
                scene._defenseSprites.delete(e);
            } else {
                const data = scene?._neutralSprites?.get(e);
                if (data?.sprite) {
                    this._sprites = (data.segmentSprites && data.segmentSprites.length)
                        ? data.segmentSprites.filter((s) => s && s.active)
                        : [data.sprite];
                    this._label = data.label || null;
                    scene._neutralSprites.delete(e);
                } else {
                    this._sprites = [e?.spriteL, e?.spriteR, e?.sprite, e?._phaserSprite]
                        .filter((s, index, list) => s && s.active && list.indexOf(s) === index);
                }
            }
        }
        // 记录每个精灵初始位置：只整体平移 y，保留各自 x（塔/门多精灵布局不变形）
        let minX = Infinity;
        let maxX = -Infinity;
        let maxDepth = this._faceDepth;
        for (const s of this._sprites) {
            s._sinkBaseX = s.x;
            s._sinkBaseY = s.y;
            s._sinkBaseDepth = Number(s.depth) || 0;
            const originX = Number.isFinite(s.originX) ? s.originX : 0.5;
            const width = Number(s.displayWidth) || 0;
            minX = Math.min(minX, s.x - width * originX);
            maxX = Math.max(maxX, s.x + width * (1 - originX));
            maxDepth = Math.max(maxDepth, s._sinkBaseDepth);
        }
        if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX) {
            // 多层塔/门/楼梯取全部子精灵的联合视觉宽度，避免屋檐、塔臂从遮罩两侧漏出。
            this._visualBounds = { minX: minX - 6, maxX: maxX + 6 };
        }
        this._faceDepth = Number.isFinite(e._structureRenderDepth)
            ? e._structureRenderDepth
            : ((typeof e._faceDepth === 'number') ? e._faceDepth : (e.y + 12));
        if (!this._footprintProjection && Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX) {
            this._dustCenterX = (minX + maxX) * 0.5;
            this._dustSpan = Math.max(this._dustSpan, maxX - minX);
        }
        this._maskDepth = Math.max(maxDepth, this._faceDepth) + 0.8;
        this._installFootprintClipMasks(scene);
        if (this._label) this._label.setVisible(false);
        if (typeof e._removeBuildingRoads === 'function') {
            // 建筑消失只释放其占地预约；原有道路转为独立道路保留，方便原位重建。
            e._removeBuildingRoads({ preserveRoads: true });
        }
        // 实体立即失效并从实体表移除：所有系统（目标/分离/寻路/空间网格）跳过它
        e.active = false;
        const game = (typeof window !== 'undefined') ? window.Game : null;
        if (game && game.entities && e.id) game.entities.delete(e.id);
    }

    /** WebGL 多边形反向遮罩：footprint 前缘以下区域是真正的不可见地下区域。 */
    _installFootprintClipMasks(scene) {
        if (!scene || !this._footprintProjection || !this._sprites.length) return;
        const maxDisplayH = Math.max(...this._sprites.map((sprite) => Number(sprite.displayHeight) || 0), 256);
        const bottomY = this._footprintProjection.bounds.maxY + maxDisplayH * 4 + 512;
        const polygon = buildingSinkOcclusionPolygon(
            this._footprintProjection,
            bottomY,
            this._visualBounds
        );
        if (polygon.length < 4) return;
        this._clipPolygon = polygon.map((point) => ({ ...point }));
        const graphics = scene.add.graphics();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillPoints(polygon, true);
        // Mask Filter 会自行捕获该 GameObject；无需把白色遮罩显示在主场景中。
        scene.children.remove(graphics);
        this._clipMaskGraphics = graphics;
        for (const sprite of this._sprites) {
            if (!sprite?.active || typeof sprite.enableFilters !== 'function') continue;
            try {
                sprite.enableFilters();
                const list = sprite.filters?.external;
                if (!list || typeof list.addMask !== 'function') continue;
                const mask = list.addMask(graphics, true, scene.cameras.main, 'world');
                this._clipMasks.push({ sprite, list, mask });
            } catch (_error) {
                // WebGL Filter 不可用时保留矩形 crop 兜底，不中断游戏循环。
                this._maskInstallError = _error?.message || String(_error);
            }
        }
        this._polygonMaskActive = this._clipMasks.length > 0;
    }

    /** 测量贴图透明像素上下边界，缓存在首次 update。 */
    _measureContent(sprite) {
        if (this._contentMap.has(sprite)) return this._contentMap.get(sprite);
        if (!sprite || !sprite.texture) return null;
        const frame = sprite.frame;
        const src = sprite.texture.getSourceImage();
        if (!src || !src.width || !src.height) return null;
        const frameW = frame.cutWidth || frame.width || src.width;
        const frameH = frame.cutHeight || frame.height || src.height;
        const cutX = Number(frame.cutX) || 0;
        const cutY = Number(frame.cutY) || 0;
        let topTexel = frameH;
        let bottomTexel = 0;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = frameW;
            canvas.height = frameH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(src, cutX, cutY, frameW, frameH, 0, 0, frameW, frameH);
            const data = ctx.getImageData(0, 0, frameW, frameH).data;
            for (let y = 0; y < frameH; y++) {
                for (let x = 0; x < frameW; x++) {
                    if (data[(y * frameW + x) * 4 + 3] > 20) {
                        topTexel = y;
                        break;
                    }
                }
                if (topTexel < frameH) break;
            }
            for (let y = frameH - 1; y >= 0; y--) {
                for (let x = 0; x < frameW; x++) {
                    if (data[(y * frameW + x) * 4 + 3] > 20) {
                        bottomTexel = y + 1;
                        break;
                    }
                }
                if (bottomTexel) break;
            }
        } catch (_e) {
            topTexel = 0;
            bottomTexel = frameH;
        }
        if (topTexel >= bottomTexel) {
            topTexel = 0;
            bottomTexel = frameH;
        }
        const dispH = sprite.displayHeight || frameH;
        const content = {
            frameW: frameW,
            frameH: frameH,
            displayH: dispH,
            topTexel,
            bottomTexel: bottomTexel,
            topOffset: topTexel / frameH * dispH,
            bottomOffset: bottomTexel / frameH * dispH,
        };
        this._contentMap.set(sprite, content);
        return content;
    }

    update(dt = 16.67) {
        const e = this.entity;
        this._detach(e);
        this.timer += dt;
        const p = Math.min(1, this.timer / this.duration);
        if (!this._sinkComplete) {
            if (!this._sprites.length) { this._finish(); return; }
            const measured = this._sprites
                .map((sprite) => ({ sprite, content: this._measureContent(sprite) }))
                .filter((entry) => entry.content);
            if (!measured.length) {
                this._finish();
                return;
            }
            if (!Number.isFinite(this.baseY)) {
                // 主贴图初始位置完全不变；其原始可见底边就是整组建筑的地下裁剪线。
                this.baseY = buildingSinkGroundLine(e, measured[0].sprite, measured[0].content);
            }
            if (!(this._totalSink > 0)) {
                const highestOpaqueTop = Math.min(...measured.map(({ sprite, content }) =>
                    sprite._sinkBaseY
                    - content.displayH * (Number.isFinite(sprite.originY) ? sprite.originY : 0.5)
                    + content.topOffset));
                this._totalSink = Math.max(1, this.baseY - highestOpaqueTop) * 1.02;
            }
            const target = this._totalSink * (p * (2 - p)); // easeOutQuad
            const step = Math.max(0, target - this.sinkPx);
            this.sinkPx += step;
            // 原地消失：精灵保持原 depth，烟尘遮盖层固定在其上方。
            for (const sprite of this._sprites) {
                if (!sprite || !sprite.active) continue;
                sprite.setPosition(sprite._sinkBaseX, sprite._sinkBaseY + this.sinkPx);
                sprite.setDepth(sprite._sinkBaseDepth);
                const c = this._measureContent(sprite);
                if (this._polygonMaskActive) {
                    if (sprite.isCropped) sprite.setCrop();
                } else if (c && c.frameH > 0 && c.displayH > 0) {
                    // 无 WebGL Mask Filter 时才使用旧矩形裁剪兜底。
                    const cropH = buildingSinkCropHeight({
                        groundY: this.baseY,
                        spriteBaseY: sprite._sinkBaseY,
                        displayH: c.displayH,
                        originY: Number.isFinite(sprite.originY) ? sprite.originY : 0.5,
                        frameH: c.frameH,
                        bottomTexel: c.bottomTexel,
                        sinkPx: this.sinkPx,
                    });
                    sprite.setCrop(0, 0, c.frameW, cropH);
                }
            }
        }

        const settleP = Math.max(0, Math.min(1, (this.timer - this.duration) / this.settleDuration));
        this._drawSeamOccluder(p, settleP);

        // 大范围烟尘：沉陷阶段持续生成，完全消失后只保留已有粒子淡出。
        this._dustTimer -= dt;
        if (this.timer < this.duration && this._dustTimer <= 0) {
            this._dustTimer = 110;
            this._spawnDust(e);
        }

        if (this.timer >= this.duration && !this._sinkComplete) {
            this._completeSink();
        }
        if (this.timer >= this.duration + this.settleDuration) {
            this._finish();
        }
    }

    _spawnDust(e) {
        if (!Number.isFinite(this.baseY)) return;
        const projectedArea = this._footprintProjection?.area || this._dustSpan * 48;
        const scale = Math.max(1.65, Math.min(2.6, Math.sqrt(projectedArea) / 82));
        const intensity = Math.max(1.5, Math.min(2.4, 1.35 + scale * 0.38));
        for (let count = 0; count < 2; count++) {
            const point = this._randomFootprintPoint();
            const dust = EffectFactory.createDustEffect(
                point.x,
                point.y - 5,
                intensity,
                {
                    scale,
                    lifeMul: 1.5,
                    depth: this._maskDepth + 0.2 + count * 0.01,
                }
            );
            this._spawnedDust.push(dust);
            if (this._spawnedDust.length > 6) this._spawnedDust.shift();
        }
    }

    _randomFootprintPoint() {
        const projection = this._footprintProjection;
        if (!projection) {
            return {
                x: this._dustCenterX + (Math.random() - 0.5) * this._dustSpan,
                y: this.baseY,
            };
        }
        const { bounds, vertices, center } = projection;
        for (let attempt = 0; attempt < 16; attempt++) {
            const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
            const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
            if (pointInSinkPolygon(x, y, vertices)) return { x, y };
        }
        return { ...center };
    }

    /** 接缝遮盖带：位于全部建筑子精灵之上、烟尘粒子之下。 */
    _drawSeamOccluder(sinkP, settleP) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !Number.isFinite(this.baseY)) return;
        if (!this._seamOccluder) {
            this._seamOccluder = scene.add.graphics();
            if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._seamOccluder);
            this._seamOccluder.setDepth(this._maskDepth);
        }
        const appear = Math.min(1, sinkP * 5);
        const alpha = appear * (1 - settleP);
        const g = this._seamOccluder;
        g.clear();
        g.setPosition(0, 0);
        const projection = this._footprintProjection;
        if (projection) {
            // 三层 footprint 投影：外层羽化、主体遮边、内层扬尘，全部固定在地面面积内。
            g.fillStyle(0x514b43, alpha * 0.42);
            g.fillPoints(scaleSinkPolygon(
                projection.vertices,
                projection.center,
                1.12 + sinkP * 0.08
            ), true);
            g.fillStyle(0x777066, alpha * 0.32);
            g.fillPoints(scaleSinkPolygon(projection.vertices, projection.center, 1.02), true);
            g.fillStyle(0xa19a8f, alpha * 0.16);
            g.fillPoints(scaleSinkPolygon(projection.vertices, projection.center, 0.82), true);
        } else {
            const width = this._dustSpan * (1.15 + sinkP * 0.18);
            const height = Math.max(26, Math.min(52, this._dustSpan * 0.16));
            g.setPosition(this._dustCenterX, this.baseY + 2);
            g.fillStyle(0x514b43, alpha * 0.48);
            g.fillEllipse(0, 3, width, height);
        }
    }

    _completeSink() {
        if (this._sinkComplete) return;
        this._sinkComplete = true;
        this._clearFootprintClipMasks();
        for (const s of this._sprites) if (s && s.active) s.destroy();
        this._sprites = [];
        if (this._label && this._label.active) this._label.destroy();
        this._label = null;
    }

    _clearFootprintClipMasks() {
        for (const entry of this._clipMasks) {
            try {
                if (entry.list && entry.mask) entry.list.remove(entry.mask);
            } catch (_error) {
                // 精灵或滤镜链已随场景销毁。
            }
        }
        this._clipMasks = [];
        this._clipPolygon = [];
        this._polygonMaskActive = false;
        if (this._clipMaskGraphics?.destroy) this._clipMaskGraphics.destroy();
        this._clipMaskGraphics = null;
    }

    _finish() {
        if (this._finished) return;
        this._finished = true;
        this.active = false;
        this._completeSink();
        if (this._seamOccluder?.active) this._seamOccluder.destroy();
        this._seamOccluder = null;
        this._spawnedDust = [];
    }
}

export {
    BuildingSinkEffect,
    buildingSinkCropHeight,
    buildingSinkFootprintProjection,
    buildingSinkGroundLine,
    buildingSinkOcclusionPolygon,
};
