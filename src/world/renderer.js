        const Renderer = {
            canvas: document.getElementById('gameCanvas'), ctx: null, terrainTexture: null,
            init() { if (!this.canvas) this.canvas = document.getElementById('gameCanvas'); if (!this.canvas) { console.error('gameCanvas not found'); return; } this.ctx = this.canvas.getContext('2d'); this.resize(); window.addEventListener('resize', () => this.resize()); },
            resize() { const w = window.innerWidth || 1920, h = window.innerHeight || 1080; if (w > 0 && h > 0) { this.canvas.width = w; this.canvas.height = h; CONFIG.VIEW_WIDTH = w; CONFIG.VIEW_HEIGHT = h; } },
            generateWorld() { const cw = this.canvas.width || window.innerWidth || 1920, ch = this.canvas.height || window.innerHeight || 1080; this.canvas.width = cw; this.canvas.height = ch; CONFIG.VIEW_WIDTH = cw; CONFIG.VIEW_HEIGHT = ch; CONFIG.WORLD_WIDTH = cw * 4; CONFIG.WORLD_HEIGHT = ch * 4; console.log('[WorldGen] canvasSize=' + cw + 'x' + ch + ', WORLD=' + CONFIG.WORLD_WIDTH + 'x' + CONFIG.WORLD_HEIGHT + ', canvas=' + (this.canvas ? 'OK' : 'NULL')); this.terrainTexture = MapGenerator.generateTerrainTexture(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); },
            worldToScreen(wx, wy) { return { x: wx - Camera.x + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX, y: wy - Camera.y + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY }; },
            screenToWorld(sx, sy) { return { x: sx + Camera.x - CONFIG.VIEW_WIDTH / 2, y: sy + Camera.y - CONFIG.VIEW_HEIGHT / 2 }; },
            clear() { this.ctx.fillStyle = '#2a3520'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); },
            renderTerrain() {
                if (!this.terrainTexture) return;
                const ctx = this.ctx, offsetX = -Camera.x + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX, offsetY = -Camera.y + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY;
                ctx.drawImage(this.terrainTexture, offsetX, offsetY, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
                ctx.strokeStyle = '#8a4a4a'; ctx.lineWidth = 4; ctx.strokeRect(offsetX, offsetY, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
            },
            renderGrid() {
                const ctx = this.ctx, offsetX = (-Camera.x + CONFIG.VIEW_WIDTH/2 + Camera.shakeX) % CONFIG.GRID_SIZE, offsetY = (-Camera.y + CONFIG.VIEW_HEIGHT/2 + Camera.shakeY) % CONFIG.GRID_SIZE;
                ctx.strokeStyle = 'rgba(90, 77, 63, 0.15)'; ctx.lineWidth = 1; ctx.beginPath();
                for (let x = offsetX; x < CONFIG.VIEW_WIDTH; x += CONFIG.GRID_SIZE) { ctx.moveTo(x, 0); ctx.lineTo(x, CONFIG.VIEW_HEIGHT); }
                for (let y = offsetY; y < CONFIG.VIEW_HEIGHT; y += CONFIG.GRID_SIZE) { ctx.moveTo(0, y); ctx.lineTo(CONFIG.VIEW_WIDTH, y); }
                ctx.stroke();
            }
        };

        

export { Renderer };
