// ============================================================
// BuildingSinkEffect — 建筑沉陷死亡特效（2026-08-16 掩体试点 v2）
// 被摧毁的建筑按原大小/原样式垂直陷入地下，接缝处小范围灰烟掩盖，结束后清除实体。
// - 不做压扁/缩放（v1 的 scaleY 形变 + 大烟团被用户判不合格）；
// - 直接推动实体 y 下沉（GameScene 中性精灵同步跟随 e.y，天然避开
//   setPosition 每帧覆盖问题）；尾段（85% 后）轻微淡出；
// - 烟尘用独立 graphics（深度走 WallSystem.junctionCorrectedDepth，
//   墙遮挡正确），小尺寸、低透明度、只贴接缝处。
// ============================================================

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
        this.baseY = entity.y;        // 原始地面接缝线（烟尘固定在这条线上，不随下沉下移）
        this.active = true;
        this.duration = 520;          // 沉陷总时长 ms
        this.timer = 0;
        this.sinkPx = 0;              // 累计下沉像素
        this._dustTimer = 0;
        this._dust = [];              // { g, x, y, t, life, size }
        this._finished = false;
        this._sprites = [];           // 接管的精灵列表（实体已失效，由特效独立驱动）
        this._label = null;
        this._footOffsetY = 0;
        this._faceDepth = 0;
        this._sources = sprites;
        this._contentMap = new Map(); // sprite → 贴图内容测量 { frameW, frameH, displayH, padding, contentH }
    }

    /** 接管精灵并立即让实体失效（怪物/碰撞/寻路全部跳过，杜绝坍塌推开怪物） */
    _detach(e) {
        if (this._sprites.length) return;
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this._sources) {
            const list = typeof this._sources === 'function' ? (this._sources(e) || []) : this._sources;
            this._sprites = list.filter((s) => s && s.active);
        } else {
            const data = scene && scene._neutralSprites ? scene._neutralSprites.get(e) : null;
            if (!data || !data.sprite) return;
            this._sprites = [data.sprite];
            this._label = data.label || null;
            scene._neutralSprites.delete(e); // 交特效接管，GameScene 不再管理/销毁
        }
        // 记录每个精灵初始位置：只整体平移 y，保留各自 x（塔/门多精灵布局不变形）
        for (const s of this._sprites) {
            s._sinkBaseX = s.x;
            s._sinkBaseY = s.y;
        }
        this._footOffsetY = e.footOffsetY || 0;
        this._faceDepth = (typeof e._faceDepth === 'number') ? e._faceDepth : (e.y + 12);
        if (this._label) this._label.setVisible(false);
        // 实体立即失效并从实体表移除：所有系统（目标/分离/寻路/空间网格）跳过它
        e.active = false;
        const game = (typeof window !== 'undefined') ? window.Game : null;
        if (game && game.entities && e.id) game.entities.delete(e.id);
    }

    /** 测量贴图内容底端（最低不透明像素=与地面衔接线），缓存在首次 update */
    _measureContent(sprite) {
        if (this._contentMap.has(sprite)) return this._contentMap.get(sprite);
        if (!sprite || !sprite.texture) return null;
        const frame = sprite.frame;
        const src = sprite.texture.getSourceImage();
        if (!src || !src.width || !src.height) return null;
        const frameW = frame.width || src.width;
        const frameH = frame.height || src.height;
        let bottomTexel = 0;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = src.width;
            canvas.height = src.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(src, 0, 0);
            const data = ctx.getImageData(0, 0, src.width, src.height).data;
            for (let y = src.height - 1; y >= 0; y--) {
                for (let x = 0; x < src.width; x++) {
                    if (data[(y * src.width + x) * 4 + 3] > 20) {
                        bottomTexel = y + 1;
                        break;
                    }
                }
                if (bottomTexel) break;
            }
        } catch (_e) {
            bottomTexel = frameH;
        }
        const dispH = sprite.displayHeight || frameH;
        // 显示框底边到内容底端的透明留白（显示像素）
        const padding = Math.max(0, (frameH - bottomTexel) / frameH * dispH);
        const content = {
            frameW: frameW,
            frameH: frameH,
            displayH: dispH,
            bottomTexel: bottomTexel,
            padding: padding,
            contentH: Math.max(1, dispH - padding),
        };
        this._contentMap.set(sprite, content);
        return content;
    }

    update(dt = 16.67) {
        const e = this.entity;
        this._detach(e);
        if (!this._sprites.length) { this._finish(); return; }
        const c0 = this._measureContent(this._sprites[0]);
        if (!c0) {
            this._finish();
            return;
        }

        this.timer += dt;
        const p = Math.min(1, this.timer / this.duration);
        // 下沉：总深 = 贴图内容高（顶部最终消失在与地面衔接处，透明留白不算）
        const totalSink = c0.contentH * 1.02;
        const target = totalSink * (p * (2 - p)); // easeOutQuad
        const step = Math.max(0, target - this.sinkPx);
        this.sinkPx += step;
        // 原地消失：不做任何缩放/压扁；精灵同步下移的同时，把「地面线以下」的底部
        // 裁掉——可见部分底边始终钉在原地面线，顶部一路降到地面接缝处消失（不整图下滑）
        for (const sprite of this._sprites) {
            if (!sprite || !sprite.active) continue;
            sprite.setPosition(sprite._sinkBaseX, sprite._sinkBaseY + this.sinkPx);
            sprite.setDepth(this._faceDepth + this.sinkPx);
            const c = this._measureContent(sprite); // 各精灵独立测量（塔臂/武器纹理不同）
            if (c && c.frameH > 0 && c.displayH > 0) {
                // 可见底边钉在贴图内容底端（地面接缝 G0 = baseY - padding）
                const visibleH = Math.max(0, c.contentH - this.sinkPx);
                const cropH = Math.min(c.frameH, visibleH / c.displayH * c.frameH);
                sprite.setCrop(0, 0, c.frameW, cropH);
            }
        }

        // 接缝灰烟（每 110ms 一撮，小尺寸低透明度）
        this._dustTimer -= dt;
        if (this._dustTimer <= 0) {
            this._dustTimer = 110;
            this._spawnDust(e);
        }
        this._updateDust(dt);

        if (this.timer >= this.duration) {
            this._finish();
        }
    }

    _spawnDust(e) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene) return;
        const g = scene.add.graphics();
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(g);
        const x = e.x + (Math.random() - 0.5) * (e.spriteCfg && e.spriteCfg.size ? e.spriteCfg.size * 0.8 : 120);
        const c = this._contentMap.size ? this._contentMap.values().next().value : null;
        const pad = c ? c.padding : 0;
        const y = (this.baseY - pad) - 6 + Math.random() * 10; // 固定在贴图内容底端（地面接缝）
        let d = y + 30;
        const WS = (typeof window !== 'undefined') ? window.WallSystem : null;
        if (WS && typeof WS.junctionCorrectedDepth === 'function') d = WS.junctionCorrectedDepth(x, y, y + 30);
        g.setDepth(d);
        this._dust.push({
            g, x, y, t: 0,
            life: 650 + Math.random() * 300,
            size: 20 + Math.random() * 18,
        });
        // 并发上限（波次可能同时爆多座，防烟尘失控）
        while (this._dust.length > 8) {
            const old = this._dust.shift();
            if (old.g) old.g.destroy();
        }
    }

    _updateDust(dt) {
        for (let i = this._dust.length - 1; i >= 0; i--) {
            const d = this._dust[i];
            d.t += dt;
            const p = Math.min(1, d.t / d.life);
            const size = d.size * (0.4 + p * 1.1);
            const alpha = p < 0.7 ? 0.35 : 0.35 * (1 - (p - 0.7) / 0.3);
            const g = d.g;
            if (!g || !g.active) { this._dust.splice(i, 1); continue; }
            g.clear();
            g.setPosition(d.x, d.y);
            // 近实心核心 + 半透明边缘（多层）
            g.fillStyle(0x9a948a, alpha * 0.5);
            g.fillCircle(0, 0, size);
            g.fillStyle(0xb0a99e, alpha * 0.34);
            g.fillCircle(0, 0, size * 0.7);
            g.fillStyle(0xc6beb1, alpha * 0.2);
            g.fillCircle(0, 0, size * 0.42);
            if (d.t >= d.life) {
                g.destroy();
                this._dust.splice(i, 1);
            }
        }
    }

    _finish() {
        if (this._finished) return;
        this._finished = true;
        this.active = false;
        for (const d of this._dust) if (d.g) d.g.destroy();
        this._dust = [];
        for (const s of this._sprites) if (s && s.active) s.destroy();
        this._sprites = [];
        if (this._label && this._label.active) this._label.destroy();
        this._label = null;
    }
}

export { BuildingSinkEffect };
