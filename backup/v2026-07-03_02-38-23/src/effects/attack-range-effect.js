        class AttackRangeEffect {
            constructor(x, y, angle, range, width, type = 'line', duration = 200, alphaMul = 0.7, showStroke = true) {
                this.x = x; this.y = y; this.angle = angle; this.range = range; this.width = width;
                this.type = type; this.life = duration; this.maxLife = duration; this.active = true;
                this.alphaMul = alphaMul; this.showStroke = showStroke;
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const alpha = Math.min(1, this.life / (this.maxLife * 0.75)) * this.alphaMul;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.globalAlpha = alpha;
                // 使用红色（醒目，在任何背景上都可见）
                ctx.fillStyle = 'rgba(255, 68, 68, 0.35)';
                if (this.showStroke) {
                    ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
                    ctx.lineWidth = 2;
                }
                if (this.type === 'sector') {
                    const halfArc = this.width / 2;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.arc(0, 0, this.range, this.angle - halfArc, this.angle + halfArc);
                    ctx.closePath();
                    ctx.fill();
                    if (this.showStroke) ctx.stroke();
                } else if (this.type === 'triangle') {
                    const halfW = this.width / 2;
                    const a = this.angle;
                    const cos = Math.cos(a), sin = Math.sin(a);
                    const perpX = -sin * halfW, perpY = cos * halfW;
                    const v1x = perpX, v1y = perpY;
                    const v2x = -perpX, v2y = -perpY;
                    const v3x = cos * this.range - perpX, v3y = sin * this.range - perpY;
                    const v4x = cos * this.range + perpX, v4y = sin * this.range + perpY;
                    ctx.beginPath();
                    ctx.moveTo(v1x, v1y);
                    ctx.lineTo(v2x, v2y);
                    ctx.lineTo(v3x, v3y);
                    ctx.lineTo(v4x, v4y);
                    ctx.closePath();
                    ctx.fill();
                    if (this.showStroke) ctx.stroke();
                } else if (this.type === 'circle') {
                    // 白色圆形：显示风车等圆形范围技能
                    ctx.beginPath();
                    ctx.arc(0, 0, this.range, 0, Math.PI * 2);
                    ctx.fill();
                    if (this.showStroke) {
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                } else {
                    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
                    const ex = cos * this.range, ey = sin * this.range;
                    const hw = this.width / 2;
                    const perpX = -sin * hw, perpY = cos * hw;
                    ctx.beginPath();
                    ctx.moveTo(perpX, perpY);
                    ctx.lineTo(ex + perpX, ey + perpY);
                    ctx.lineTo(ex - perpX, ey - perpY);
                    ctx.lineTo(-perpX, -perpY);
                    ctx.closePath();
                    ctx.fill();
                    if (this.showStroke) ctx.stroke();
                }
                ctx.restore();
            }
        }
        /**
         * 冲刺攻击触发特效：金光汇聚到主角
         */

export { AttackRangeEffect };
