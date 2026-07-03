// 中毒粒子效果系统 — 参考 WeaponEffect 简化版，绿色调
export class PoisonEffect {
    constructor() {
        this.particles = [];
    }

    _spawnParticle(x, y) {
        const colors = ['#4a8a3a', '#5a9a4a', '#3d7a2d', '#6aaa5a', '#2a6a1a', '#7aba6a', '#8aca7a', '#a0da8a'];
        const angle = Math.random() * Math.PI * 2;
        const speed = 6.24 + Math.random() * 9.36; // 速度减半
        this.particles.push({
            x: x + (Math.random() - 0.5) * 6, // 初始扩散范围减半
            y: y + (Math.random() - 0.5) * 6,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.075, // 上浮速度减半
            size: 1.5 + Math.random() * 1.5,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 800 + Math.random() * 600,
            maxLife: 800 + Math.random() * 600,
            pulseOffset: Math.random() * Math.PI * 2
        });
    }

    update(dt, x, y) {
        // 持续生成粒子（生成率减半）
        if (Math.random() < 0.35) this._spawnParticle(x, y);
        if (Math.random() < 0.25) this._spawnParticle(x, y);

        // 更新粒子
        this.particles.forEach(p => {
            p.life -= dt;
            p.x += p.vx * (dt / 1000);
            p.y += p.vy * (dt / 1000);
            p.size *= 0.997;
        });
        this.particles = this.particles.filter(p => p.life > 0);
    }

    render(ctx, screenX, screenY) {
        const now = Date.now();
        this.particles.forEach(p => {
            const lifeRatio = p.life / p.maxLife;
            const fadeIn = Math.min(1, (1 - lifeRatio) * 3);
            const fadeOut = Math.min(1, lifeRatio * 2);
            const alpha = Math.min(fadeIn, fadeOut) * 0.6;
            const pulse = 1 + Math.sin(now * 0.004 + p.pulseOffset) * 0.2;
            const size = p.size * pulse;

            // 主粒子
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(screenX + p.x, screenY + p.y, size, 0, Math.PI * 2);
            ctx.fill();

            // 中层光晕
            ctx.globalAlpha = alpha * 0.3;
            ctx.beginPath();
            ctx.arc(screenX + p.x, screenY + p.y, size * 2.5, 0, Math.PI * 2);
            ctx.fill();

            // 外层光晕
            ctx.globalAlpha = alpha * 0.12;
            ctx.beginPath();
            ctx.arc(screenX + p.x, screenY + p.y, size * 4, 0, Math.PI * 2);
            ctx.fill();

            // 核心亮点
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = '#a0e8a0';
            ctx.beginPath();
            ctx.arc(screenX + p.x, screenY + p.y, size * 0.4, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
    }

    reset() {
        this.particles = [];
    }
}
