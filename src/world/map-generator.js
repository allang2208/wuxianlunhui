const MapGenerator = {
    /**
     * 使用 Phaser Graphics 直接绘制地形，避免手动创建 HTMLCanvasElement 中间层。
     * 绘制完成后调用 g.generateTexture(key, width, height) 即可生成 Phaser Texture。
     */
    drawTerrain(graphics, width, height) {
        // 底色
        graphics.fillStyle(0x3d4a35, 1);
        graphics.fillRect(0, 0, width, height);

        // 随机噪点斑块
        for (let i = 0; i < 8000; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            const size = Math.random() * 3 + 1;
            const alpha = Math.random() * 0.15 + 0.05;
            const color = Math.random() > 0.5 ? 0x5a6e46 : 0x3c5032;
            graphics.fillStyle(color, alpha);
            graphics.fillRect(x, y, size, size);
        }

        this._drawPaths(graphics, width, height);
        this._drawWater(graphics, width, height);
        this._drawTrees(graphics, width, height);
        this._drawRocks(graphics, width, height);
    },

    _drawPaths(graphics, w, h) {
        graphics.lineStyle(12, 0x6b5d4f, 1);
        graphics.beginPath();
        graphics.moveTo(0, h * 0.5);
        graphics.lineTo(w, h * 0.5);
        graphics.moveTo(w * 0.5, 0);
        graphics.lineTo(w * 0.5, h);
        graphics.strokePath();

        graphics.lineStyle(6, 0x5a4d4f, 1);
        for (let i = 0; i < 5; i++) {
            const startX = Math.random() * w;
            const startY = Math.random() * h;
            graphics.beginPath();
            graphics.moveTo(startX, startY);
            graphics.lineTo(startX + (Math.random() - 0.5) * 400, startY + (Math.random() - 0.5) * 400);
            graphics.strokePath();
        }
    },

    _drawWater(graphics, w, h) {
        for (let i = 0; i < 3; i++) {
            const cx = Math.random() * w;
            const cy = Math.random() * h;
            const rx = 30 + Math.random() * 50;
            const ry = 20 + Math.random() * 40;

            graphics.fillStyle(0x506478, 0.6);
            graphics.fillEllipse(cx, cy, rx * 2, ry * 2);

            graphics.lineStyle(1, 0x64788c, 0.3);
            const maxR = Math.max(rx, ry);
            for (let r = 5; r < maxR; r += 8) {
                const scale = r / maxR;
                graphics.strokeEllipse(cx, cy, rx * 2 * scale, ry * 2 * scale);
            }
        }
    },

    _drawTrees(graphics, w, h) {
        for (let i = 0; i < 150; i++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            graphics.fillStyle(0x4a3f35, 1);
            graphics.fillRect(x - 2, y, 4, 8);

            const canopyColor = Math.random() > 0.5 ? 0x2d4a25 : 0x3d5a35;
            graphics.fillStyle(canopyColor, 1);
            graphics.fillCircle(x, y - 4, 6 + Math.random() * 6);

            graphics.fillStyle(0x5a7846, 0.2);
            graphics.fillCircle(x - 2, y - 6, 3);
        }
    },

    _drawRocks(graphics, w, h) {
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            const size = 3 + Math.random() * 8;
            graphics.fillStyle(0x6a6a6a, 1);
            graphics.fillCircle(x, y, size);
            graphics.fillStyle(0x8a8a8a, 1);
            graphics.fillCircle(x - 1, y - 1, size * 0.6);
        }
    }
};

export { MapGenerator };
