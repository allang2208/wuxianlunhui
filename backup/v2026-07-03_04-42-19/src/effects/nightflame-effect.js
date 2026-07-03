class NightFlameBeamEffect {
    constructor(x, y, angle, width, length, duration) {
        this.x = x; this.y = y;
        this.angle = angle;
        this.width = width; this.length = length;
        this.duration = duration;
        this.life = duration; this.active = true;
        this._startTime = Date.now();
        this._lastUpdateTime = Date.now();

        this.colors = [
            {r: 50, g: 130, b: 255},
            {r: 70, g: 150, b: 255},
            {r: 90, g: 170, b: 255},
            {r: 110, g: 190, b: 255},
            {r: 130, g: 210, b: 255},
            {r: 150, g: 230, b: 255}
        ];

        this.lines = [];
        this._batchTimer = 0;
        this._batchInterval = 100; // 每100ms生成一批（提前200ms）
        this._batchCount = 20;     // 每批20根
        this._radius = 17;         // 圆形区域半径17px（直径34px）
    }

    update(dt = 16.67) {
        this._lastUpdateTime = Date.now();

        this.life -= dt;
        if (this.life <= 0) { this.active = false; return; }

        // 每300ms生成一批新线条
        this._batchTimer += dt;
        if (this._batchTimer >= this._batchInterval) {
            this._batchTimer -= this._batchInterval;
            this._spawnBatch();
        }

        // 更新所有线条
        this.lines.forEach(line => {
            line.elapsed += dt;
        });

        // 清理已消失的线条
        this.lines = this.lines.filter(line => {
            const totalLife = line.growDuration + line.fadeDuration;
            return line.elapsed < totalLife;
        });
    }

    _spawnBatch() {
        for (let i = 0; i < this._batchCount; i++) {
            // 在以原直线为直径的圆形区域内随机位置生成
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * this._radius;
            this.lines.push({
                spreadX: dist * Math.cos(angle), // 沿攻击方向的随机偏移
                spreadY: dist * Math.sin(angle), // 垂直于攻击方向的随机偏移
                elapsed: 0,
                growDuration: 150 + Math.random() * 100, // 150~250ms 生长
                fadeDuration: 100 + Math.random() * 150, // 100~250ms 淡出
                lineWidth: 1 + Math.random() * 2.5,
                color: this.colors[Math.floor(Math.random() * this.colors.length)]
            });
        }
    }

    render(ctx) {
        const screenPos = Renderer.worldToScreen(this.x, this.y);

        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        ctx.rotate(this.angle);

        this.lines.forEach(line => {
            const growProgress = Math.min(1, line.elapsed / line.growDuration);
            const currentLength = this.length * growProgress;
            if (currentLength <= 0) return;

            let fadeAlpha = 1;
            if (growProgress >= 1) {
                const fadeElapsed = line.elapsed - line.growDuration;
                fadeAlpha = Math.max(0, 1 - fadeElapsed / line.fadeDuration);
            }
            if (fadeAlpha <= 0) return;

            const c = line.color;
            ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${fadeAlpha * 0.85})`;
            ctx.lineWidth = line.lineWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            // 从起点向终点正常生长，起点在圆形区域随机位置
            ctx.moveTo(line.spreadX, line.spreadY);
            ctx.lineTo(currentLength + line.spreadX, line.spreadY);
            ctx.stroke();

            // 光点在终点
            if (growProgress > 0.3) {
                const glowAlpha = fadeAlpha * 0.3 * Math.min(1, growProgress / 0.5);
                ctx.fillStyle = `rgba(${Math.min(255, c.r + 50)}, ${Math.min(255, c.g + 30)}, 255, ${glowAlpha})`;
                ctx.beginPath();
                ctx.arc(currentLength + line.spreadX, line.spreadY, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        if (this.life > 0) {
            const baseAlpha = Math.min(1, this.life / 500) * 0.3;
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
            grad.addColorStop(0, `rgba(100, 180, 255, ${baseAlpha})`);
            grad.addColorStop(1, 'rgba(100, 180, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

export { NightFlameBeamEffect };
