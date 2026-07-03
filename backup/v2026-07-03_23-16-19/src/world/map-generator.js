const MapGenerator = {
            generateTerrainTexture(width, height) {
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#3d4a35'; ctx.fillRect(0, 0, width, height);
                for (let i = 0; i < 8000; i++) {
                    const x = Math.random() * width, y = Math.random() * height, size = Math.random() * 3 + 1, alpha = Math.random() * 0.15 + 0.05;
                    ctx.fillStyle = Math.random() > 0.5 ? `rgba(90, 110, 70, ${alpha})` : `rgba(60, 80, 50, ${alpha})`;
                    ctx.fillRect(x, y, size, size);
                }
                this.generatePaths(ctx, width, height);
                this.generateWater(ctx, width, height);
                this.generateTrees(ctx, width, height);
                this.generateRocks(ctx, width, height);
                return canvas;
            },
            generatePaths(ctx, w, h) {
                ctx.strokeStyle = '#6b5d4f'; ctx.lineWidth = 12; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke();
                ctx.strokeStyle = '#5a4d4f'; ctx.lineWidth = 6;
                for (let i = 0; i < 5; i++) {
                    ctx.beginPath(); const startX = Math.random() * w, startY = Math.random() * h;
                    ctx.moveTo(startX, startY); ctx.lineTo(startX + (Math.random() - 0.5) * 400, startY + (Math.random() - 0.5) * 400); ctx.stroke();
                }
            },
            generateWater(ctx, w, h) {
                for (let i = 0; i < 3; i++) {
                    const cx = Math.random() * w, cy = Math.random() * h, rx = 30 + Math.random() * 50, ry = 20 + Math.random() * 40;
                    ctx.fillStyle = 'rgba(80, 100, 120, 0.6)'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = 'rgba(100, 120, 140, 0.3)'; ctx.lineWidth = 1;
                    for (let r = 5; r < Math.max(rx, ry); r += 8) { ctx.beginPath(); ctx.ellipse(cx, cy, rx * (r/Math.max(rx,ry)), ry * (r/Math.max(rx,ry)), 0, 0, Math.PI*2); ctx.stroke(); }
                }
            },
            generateTrees(ctx, w, h) {
                for (let i = 0; i < 150; i++) {
                    const x = Math.random() * w, y = Math.random() * h;
                    ctx.fillStyle = '#4a3f35'; ctx.fillRect(x - 2, y, 4, 8);
                    ctx.fillStyle = Math.random() > 0.5 ? '#2d4a25' : '#3d5a35'; ctx.beginPath(); ctx.arc(x, y - 4, 6 + Math.random() * 6, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = 'rgba(90, 120, 70, 0.2)'; ctx.beginPath(); ctx.arc(x - 2, y - 6, 3, 0, Math.PI * 2); ctx.fill();
                }
            },
            generateRocks(ctx, w, h) {
                for (let i = 0; i < 40; i++) {
                    const x = Math.random() * w, y = Math.random() * h, size = 3 + Math.random() * 8;
                    ctx.fillStyle = '#6a6a6a'; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#8a8a8a'; ctx.beginPath(); ctx.arc(x - 1, y - 1, size * 0.6, 0, Math.PI * 2); ctx.fill();
                }
            }
        };

        

// ==================== 迷宫生成器 ====================

export { MapGenerator };
