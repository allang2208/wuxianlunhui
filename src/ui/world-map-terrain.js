import layout from '../../data/world-map-layout.json';
import generation from '../../data/world-map-generation.json';
import { WORLD_MAP_CELLS } from '../world/world-map-cells.js';
import { drawStrategicTerrainRules } from './world-map-terrain-rules.js';
import { drawMountainRelief } from './world-map-relief-visuals.js';

const config = generation.render;
const SIN = Math.sin(layout.cameraElevationDegrees * Math.PI / 180);
export const projectMapCell = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2), y: -1.5 * r * SIN });

/** View-owned spatial index and bounded raster cache. Never starts simulation. */
export class WorldMapTerrain {
    constructor(invalidate, costs, accent) {
        this.invalidate = invalidate;
        this.cells = WORLD_MAP_CELLS.map((cell) => ({ ...cell, ...projectMapCell(cell.q, cell.r) }))
            .sort((a, b) => a.y - b.y || a.x - b.x);
        this.cellById = new Map(this.cells.map((cell) => [cell.id, cell]));
        this.chunks = new Map();
        const bounds = this.bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        for (const cell of this.cells) {
            bounds.left = Math.min(bounds.left, cell.x - 1.4); bounds.right = Math.max(bounds.right, cell.x + 1.4);
            bounds.top = Math.min(bounds.top, cell.y - 1.8); bounds.bottom = Math.max(bounds.bottom, cell.y + 1.3);
            const key = `${Math.floor(cell.x / config.chunkWorldSize)},${Math.floor(cell.y / config.chunkWorldSize)}`;
            if (!this.chunks.has(key)) this.chunks.set(key, []);
            this.chunks.get(key).push(cell);
        }
        this.costs = costs; this.accent = accent;
        const multipliers = [...costs.values()].map((cost) => cost.multiplier);
        this.minCost = Math.min(...multipliers); this.maxCost = Math.max(...multipliers);
        this.scale = Math.min(config.overviewScale, config.maxOverviewSide / Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top));
        this.overview = document.createElement('canvas');
        this.costOverlay = document.createElement('canvas');
        this.fogOverlay = document.createElement('canvas');
        for (const canvas of [this.overview, this.costOverlay, this.fogOverlay]) {
            canvas.width = Math.ceil((bounds.right - bounds.left) * this.scale);
            canvas.height = Math.ceil((bounds.bottom - bounds.top) * this.scale);
        }
        this.exploredCells = new Set();
        this.visibleCells = new Set();
        this.bakeFog();
        this.bake(null);
    }
    isOverview(scale, width, height) {
        const projectedHexArea = 3 * Math.sqrt(3) / 2 * SIN * scale * scale;
        return scale < config.overviewThreshold
            || Math.min(this.cells.length, width * height / projectedHexArea) > config.maxDetailedCells;
    }
    visible(offset, scale, width, height) {
        const pad = layout.atlas.frameSize / layout.atlas.pixelsPerWorldUnit;
        const left = -offset.x / scale - pad, right = (width - offset.x) / scale + pad;
        const top = -offset.y / scale - pad, bottom = (height - offset.y) / scale + pad;
        const size = config.chunkWorldSize, result = [];
        for (let y = Math.floor(top / size); y <= Math.floor(bottom / size); y++) {
            for (let x = Math.floor(left / size); x <= Math.floor(right / size); x++) {
                for (const cell of this.chunks.get(`${x},${y}`) || []) {
                    if (cell.x >= left && cell.x <= right && cell.y >= top && cell.y <= bottom) result.push(cell);
                }
            }
        }
        return result.sort((a, b) => a.y - b.y || a.x - b.x);
    }
    _hex(ctx, cell) {
        const x = (cell.x - this.bounds.left) * this.scale, y = (cell.y - this.bounds.top) * this.scale;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (30 + i * 60) * Math.PI / 180;
            const px = x + Math.cos(angle) * this.scale, py = y - Math.sin(angle) * this.scale * SIN;
            if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }
    bake(image, reliefImage = null) {
        if (this.frame != null) cancelAnimationFrame(this.frame);
        const ctx = this.overview.getContext('2d'), costCtx = this.costOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.overview.width, this.overview.height);
        costCtx.clearRect(0, 0, this.costOverlay.width, this.costOverlay.height);
        const atlas = layout.atlas, factor = this.scale / atlas.pixelsPerWorldUnit;
        const phases = [
            (cell) => {
                this._hex(ctx, cell); ctx.fillStyle = layout.biomes[cell.biome].baseColor; ctx.fill();
                this._hex(costCtx, cell); costCtx.fillStyle = this.accent;
                costCtx.globalAlpha = .08 + .36 * (this.costs.get(cell.id).multiplier - this.minCost) / (this.maxCost - this.minCost || 1);
                costCtx.fill(); costCtx.globalAlpha = 1;
            },
            ...(image ? [(cell) => {
                const tile = layout.tiles[cell.tile];
                ctx.drawImage(image, tile.x, tile.y, atlas.frameSize, atlas.frameSize,
                    (cell.x - this.bounds.left) * this.scale - atlas.anchorPx[0] * factor,
                    (cell.y - this.bounds.top) * this.scale - atlas.anchorPx[1] * factor,
                    atlas.frameSize * factor, atlas.frameSize * factor);
            }] : []),
            (cell) => drawStrategicTerrainRules(ctx, cell, (cell.x - this.bounds.left) * this.scale,
                (cell.y - this.bounds.top) * this.scale, this.scale, { drawMountain: !reliefImage }),
            ...(reliefImage ? [(cell) => drawMountainRelief(ctx, reliefImage, cell,
                (cell.x - this.bounds.left) * this.scale, (cell.y - this.bounds.top) * this.scale, this.scale)] : []),
        ];
        let index = 0, phase = 0;
        const batch = () => {
            this.frame = null;
            if (this.disposed) return;
            const started = performance.now();
            let count = 0;
            while (index < this.cells.length && count++ < config.bakeCellsPerFrame) {
                const cell = this.cells[index++];
                phases[phase](cell);
                if (performance.now() - started >= config.bakeBudgetMs) break;
            }
            if (index === this.cells.length && phase < phases.length - 1) { phase++; index = 0; }
            this.invalidate();
            if (index < this.cells.length) this.frame = requestAnimationFrame(batch);
        };
        this.frame = requestAnimationFrame(batch);
    }
    setFog(exploredCellIds, visibleCellIds, signature = '') {
        if (signature && signature === this.fogSignature) return;
        this.fogSignature = signature;
        this.exploredCells = new Set(exploredCellIds);
        this.visibleCells = new Set(visibleCellIds);
        this.bakeFog();
        this.invalidate();
    }
    bakeFog() {
        const ctx = this.fogOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.fogOverlay.width, this.fogOverlay.height);
        for (const cell of this.cells) {
            if (this.visibleCells.has(cell.id)) continue;
            const color = this.exploredCells.has(cell.id) ? generation.fog.explored : generation.fog.unexplored;
            this._hex(ctx, cell); ctx.fillStyle = color; ctx.fill();
            ctx.strokeStyle = color; ctx.lineWidth = generation.fog.edgeWidth; ctx.stroke();
        }
    }
    draw(ctx, offset, scale, costs = false) {
        const canvas = costs ? this.costOverlay : this.overview;
        ctx.drawImage(canvas, offset.x + this.bounds.left * scale, offset.y + this.bounds.top * scale,
            canvas.width / this.scale * scale, canvas.height / this.scale * scale);
    }
    drawFog(ctx, offset, scale, cells = null) {
        if (!cells) {
            ctx.drawImage(this.fogOverlay, offset.x + this.bounds.left * scale, offset.y + this.bounds.top * scale,
                this.fogOverlay.width / this.scale * scale, this.fogOverlay.height / this.scale * scale);
            return;
        }
        for (const cell of cells) {
            if (this.visibleCells.has(cell.id)) continue;
            const color = this.exploredCells.has(cell.id) ? generation.fog.explored : generation.fog.unexplored;
            const x = offset.x + cell.x * scale, y = offset.y + cell.y * scale;
            ctx.beginPath();
            for (let index = 0; index < 6; index++) {
                const angle = (30 + index * 60) * Math.PI / 180;
                const px = x + Math.cos(angle) * scale, py = y - Math.sin(angle) * scale * SIN;
                if (!index) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.fillStyle = color; ctx.fill();
            ctx.strokeStyle = color; ctx.lineWidth = generation.fog.edgeWidth; ctx.stroke();
        }
    }
    destroy() {
        this.disposed = true;
        if (this.frame != null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.overview.width = this.overview.height = this.costOverlay.width = this.costOverlay.height
            = this.fogOverlay.width = this.fogOverlay.height = 1;
        this.cells = []; this.cellById.clear(); this.chunks.clear();
        this.exploredCells.clear(); this.visibleCells.clear();
    }
}
