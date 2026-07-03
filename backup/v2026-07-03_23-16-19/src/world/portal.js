import { Renderer } from './renderer.js';

class Portal {
    constructor(x, y, targetScene, label) {
        this.x = x; this.y = y;
        this.targetScene = targetScene;
        this.label = label || '传送门';
        this.size = 40;
        this.noCollision = true;
        this.active = true;
        this.pulseTimer = 0;
    }
    update(dt) {
        this.pulseTimer += dt / 1000;
    }
    render(ctx) {
        const sp = Renderer.worldToScreen(this.x, this.y);
        ctx.save();
        ctx.translate(sp.x, sp.y);
        const pulse = 0.5 + Math.sin(this.pulseTimer * 3) * 0.3;
        const radius = this.size * (0.8 + pulse * 0.2);
        ctx.fillStyle = `rgba(100, 200, 255, ${0.2 + pulse * 0.2})`;
        ctx.beginPath(); ctx.arc(0, 0, radius * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(80, 150, 220, ${0.4 + pulse * 0.3})`;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200, 230, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const angle = this.pulseTimer * 2 + i * Math.PI / 2;
            ctx.moveTo(Math.cos(angle) * radius * 0.3, Math.sin(angle) * radius * 0.3);
            ctx.lineTo(Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '12px SimHei, "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.label, 0, -radius - 10);
        ctx.restore();
    }
}

export { Portal };
