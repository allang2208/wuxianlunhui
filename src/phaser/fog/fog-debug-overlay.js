function sourceSignature(sources) {
    return (sources || []).map((source) => (
        `${source.id}:${Math.floor(source.x)}:${Math.floor(source.y)}:${Math.round(source.radius)}`
    )).join('|');
}

/** 仅开发工具启用时绘制迷雾格、三态、视野源与性能摘要。 */
export class FogDebugOverlay {
    constructor(scene) {
        this.scene = scene;
        this.graphics = null;
        this.summary = null;
        this.options = {
            enabled: false,
            showStates: true,
            showGrid: true,
            showSources: true,
            showBlockers: true,
        };
        this._lastKey = '';
    }

    _ensureObjects() {
        if (this.graphics?.active && this.summary?.active) return true;
        if (!this.scene?.add) return false;
        this.graphics = this.scene.add.graphics();
        this.graphics.setDepth(100002);
        this.graphics.setVisible(false);
        this.summary = this.scene.add.text(8, 8, '', {
            fontFamily: 'Consolas, monospace',
            fontSize: '12px',
            color: '#dfffe8',
            backgroundColor: 'rgba(0,0,0,0.72)',
            padding: { x: 6, y: 4 },
        });
        this.summary.setScrollFactor(0);
        this.summary.setDepth(100003);
        this.summary.setVisible(false);
        return true;
    }

    setOptions(options = {}) {
        Object.assign(this.options, options);
        if (!this.options.enabled) this.hide();
        this._lastKey = '';
        return { ...this.options };
    }

    hide() {
        if (this.graphics?.active) {
            this.graphics.clear();
            this.graphics.setVisible(false);
        }
        if (this.summary?.active) this.summary.setVisible(false);
    }

    update(grid, model) {
        if (!this.options.enabled || !grid?.active || !model) {
            this.hide();
            return;
        }
        if (!this._ensureObjects()) return;
        const key = [
            grid.sceneId,
            grid.revision,
            this.options.showStates,
            this.options.showGrid,
            this.options.showSources,
            this.options.showBlockers,
            model.occlusion?.revision || 0,
            sourceSignature(model.sources),
        ].join(':');
        if (key !== this._lastKey) {
            this._lastKey = key;
            const g = this.graphics;
            g.clear();
            if (this.options.showStates) {
                for (let row = 0; row < grid.rows; row += 1) {
                    for (let column = 0; column < grid.columns; column += 1) {
                        const index = row * grid.columns + column;
                        const color = grid.visible[index]
                            ? 0x2cff78
                            : (grid.explored[index] ? 0x2f7460 : 0x090b12);
                        const alpha = grid.visible[index] ? 0.18 : 0.12;
                        g.fillStyle(color, alpha);
                        g.fillRect(column * grid.cellSize, row * grid.cellSize, grid.cellSize, grid.cellSize);
                    }
                }
            }
            if (this.options.showGrid) {
                g.lineStyle(1, 0x7f9aaa, 0.22);
                for (let column = 0; column <= grid.columns; column += 1) {
                    const x = column * grid.cellSize;
                    g.lineBetween(x, 0, x, grid.height);
                }
                for (let row = 0; row <= grid.rows; row += 1) {
                    const y = row * grid.cellSize;
                    g.lineBetween(0, y, grid.width, y);
                }
            }
            if (this.options.showBlockers && model.occlusion?.blocked) {
                g.fillStyle(0xff7a33, 0.28);
                for (let row = 0; row < grid.rows; row += 1) {
                    for (let column = 0; column < grid.columns; column += 1) {
                        if (!model.occlusion.blocked[row * grid.columns + column]) continue;
                        g.fillRect(column * grid.cellSize, row * grid.cellSize, grid.cellSize, grid.cellSize);
                    }
                }
            }
            if (this.options.showSources) {
                for (const source of model.sources || []) {
                    g.lineStyle(3, 0x4dff9a, 0.9);
                    g.strokeCircle(source.x, source.y, source.radius);
                    g.fillStyle(0xffffff, 0.95);
                    g.fillCircle(source.x, source.y, 6);
                }
            }
            g.setVisible(true);
        }

        const update = model.update || {};
        const render = model.render || {};
        const effects = model.effects || {};
        const occlusion = model.occlusion || {};
        const visibility = model.visibility || {};
        this.summary.setText([
            `${model.sceneId} · ${model.columns}×${model.rows} · rev ${model.revision}`,
            `可见 ${model.visibleCells} / 已探索 ${model.exploredCells} / 未探索 ${model.unexploredCells}`,
            `视野源 ${update.sourceCount || 0} · 逻辑 ${(update.durationMs || 0).toFixed(3)}ms · 变化格 ${update.changedCells || 0}`,
            `遮罩 ${(render.durationMs || 0).toFixed(3)}ms · 特效 ${effects.tracked || 0}（契约 ${effects.explicit || 0} / 兼容 ${effects.legacy || 0}）`,
            `LOS ${occlusion.blockerCount || 0} blockers / ${occlusion.blockedCells || 0} cells / H${Math.round(occlusion.maxBlockerHeight || 0)} / ${(occlusion.durationMs || 0).toFixed(3)}ms`,
            `Visibility ${visibility.controlledEntities || 0} controlled / ${visibility.enforcedHiddenEntities || 0} hidden / ${(visibility.durationMs || 0).toFixed(3)}ms`,
        ]);
        this.summary.setVisible(true);
    }

    destroy() {
        if (this.graphics?.active) this.graphics.destroy();
        if (this.summary?.active) this.summary.destroy();
    }
}

export default FogDebugOverlay;
