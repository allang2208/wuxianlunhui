// ============================================================
// BuildingSinkEffect — 建筑沉陷死亡特效（2026-08-16 掩体试点）
// 被摧毁的建筑向脚下地面沉陷，底部用多层灰烟掩盖接缝，结束后清除实体。
// - 直接推动实体 y 下沉（GameScene 中性精灵同步会跟随 e.y，天然避开
//   setPosition 每帧覆盖问题）；精灵纵向压扁 + 尾段淡出；
// - 烟尘用独立 graphics（深度走 WallSystem.junctionCorrectedDepth，
//   墙遮挡正确：烟尘压到遮挡墙之下，不浮在墙上）。
// ============================================================

class BuildingSinkEffect {
    constructor(entity) {
        this.entity = entity;
        this.x = entity.x;
        this.y = entity.y;
        this.active = true;
        this.duration = 520;          // 沉陷总时长 ms
        this.timer = 0;
        this.sinkPx = 0;              // 累计下沉像素
        this._dustTimer = 0;
        this._dust = [];              // { g, x, y, t, life, size }
        this._finished = false;
    }

    update(dt = 16.67) {
        const e = this.entity;
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const data = scene && scene._neutralSprites ? scene._neutralSprites.get(e) : null;
        const sprite = data && data.sprite;
        if (!e || !sprite || e.active === false) {
            this._finish();
            return;
        }

        this.timer += dt;
        const p = Math.min(1, this.timer / this.duration);
        // 下沉：先快后慢，总深约显示高的 58%
        const dispH = e.spriteCfg && e.spriteCfg.sizeH ? e.spriteCfg.sizeH : 120;
        const totalSink = dispH * 0.58;
        const target = totalSink * (p * (2 - p)); // easeOutQuad
        const step = Math.max(0, target - this.sinkPx);
        if (step > 0) {
            e.y += step;
            this.sinkPx += step;
            // 深度跟随下沉（掩体 _faceDepth 固定，沉陷时逐步后移避免浮在墙前实体之上）
            if (typeof e._faceDepth === 'number') e._faceDepth += step;
        }
        // 纵向压扁 + 尾段淡出
        if (sprite.active) {
            sprite.setScale(1, Math.max(0.45, 1 - p * 0.55));
            sprite.setAlpha(p > 0.72 ? Math.max(0, 1 - (p - 0.72) / 0.28) : 1);
        }

        // 底部灰烟（每 70ms 一撮，掩盖下沉接缝）
        this._dustTimer -= dt;
        if (this._dustTimer <= 0) {
            this._dustTimer = 70;
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
        const y = e.y - 6 + Math.random() * 10;
        let d = y + 30;
        const WS = (typeof window !== 'undefined') ? window.WallSystem : null;
        if (WS && typeof WS.junctionCorrectedDepth === 'function') d = WS.junctionCorrectedDepth(x, y, y + 30);
        g.setDepth(d);
        this._dust.push({
            g, x, y, t: 0,
            life: 850 + Math.random() * 350,
            size: 46 + Math.random() * 52,
        });
        // 并发上限（波次可能同时爆多座，防烟尘失控）
        while (this._dust.length > 14) {
            const old = this._dust.shift();
            if (old.g) old.g.destroy();
        }
    }

    _updateDust(dt) {
        for (let i = this._dust.length - 1; i >= 0; i--) {
            const d = this._dust[i];
            d.t += dt;
            const p = Math.min(1, d.t / d.life);
            const size = d.size * (0.35 + p * 1.25);
            const alpha = p < 0.75 ? 0.5 : 0.5 * (1 - (p - 0.75) / 0.25);
            const g = d.g;
            if (!g || !g.active) { this._dust.splice(i, 1); continue; }
            g.clear();
            g.setPosition(d.x, d.y);
            // 近实心核心 + 半透明边缘（多层）
            g.fillStyle(0x9a948a, alpha * 0.55);
            g.fillCircle(0, 0, size);
            g.fillStyle(0xb0a99e, alpha * 0.38);
            g.fillCircle(0, 0, size * 0.7);
            g.fillStyle(0xc6beb1, alpha * 0.22);
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
        const e = this.entity;
        if (!e) return;
        e.active = false;
        const game = (typeof window !== 'undefined') ? window.Game : null;
        if (game && game.entities && e.id) game.entities.delete(e.id);
    }
}

export { BuildingSinkEffect };
