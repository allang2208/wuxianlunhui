export class WeaponEffect {
    constructor() {
        this.particles = [];
        this._glowLastState = false;
        this._glowTransitionStart = 0;
    }

    _spawnWeaponGlowParticle(params) {
        const colors = ['#4a9eff', '#5bb8ff', '#6ec8ff', '#3d8bfa', '#2a7af5', '#7ad0ff', '#a0e0ff', '#5599ff'];
        const hiltX = (Math.random() - 0.5) * 4;
        const hiltY = (Math.random() - 0.5) * 4;
        const theta = params.rotation;
        const floatSpeed = 46.8 + Math.random() * 31.2;
        // 将世界方向转换为武器局部坐标系方向（武器局部 = 世界旋转 -(theta + PI/2)）
        // cos(-(theta+PI/2)) = -sin(theta), sin(-(theta+PI/2)) = -cos(theta)
        const cosA = -Math.sin(theta);
        const sinA = -Math.cos(theta);
        let pvx, pvy;
        if (params.isMoving) {
            // 移动状态：粒子向鼠标指针反方向±15度内随机浮动
            const mouseWorld = params.screenToWorld(params.mouseX, params.mouseY);
            const dx = mouseWorld.x - params.x;
            const dy = mouseWorld.y - params.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
                const baseAngle = Math.atan2(-dy, -dx); // 远离鼠标的基础角度
                const randomOffset = (Math.random() - 0.5) * (Math.PI / 6); // ±15度 = ±π/12
                const finalAngle = baseAngle + randomOffset;
                const wx = Math.cos(finalAngle);
                const wy = Math.sin(finalAngle);
                pvx = (wx * cosA - wy * sinA) * floatSpeed;
                pvy = (wx * sinA + wy * cosA) * floatSpeed;
            } else {
                // 鼠标恰好在玩家位置，默认向上
                pvx = -sinA * floatSpeed;
                pvy = -cosA * floatSpeed;
            }
        } else {
            // 待机状态：粒子向四周随机扩散
            const angle = Math.random() * Math.PI * 2;
            const wx = Math.cos(angle);
            const wy = Math.sin(angle);
            pvx = (wx * cosA - wy * sinA) * floatSpeed;
            pvy = (wx * sinA + wy * cosA) * floatSpeed;
        }
        this.particles.push({
            x: hiltX,
            y: hiltY,
            vx: pvx,
            vy: pvy,
            size: 0.3 + Math.random() * 0.2,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 1200 + Math.random() * 600,          // 生命周期：原始值延长50%（原800+400→1200+600）
            maxLife: 1200 + Math.random() * 600,
            pulseOffset: Math.random() * Math.PI * 2,
            createdAt: Date.now()                     // 标记粒子生成时间，用于状态过渡
        });
    }

    /**
     * 在 Player 的 update 中调用
     * @param {Object} params
     * @param {number} params.dt - 时间增量
     * @param {number} params.size - 玩家尺寸（保留参数，当前未使用）
     * @param {number} params.rotation - 玩家旋转角度
     * @param {boolean} params.isMoving - 是否正在移动
     * @param {boolean} params.isInCombat - 是否处于战斗状态（攻击或技能期间）
     * @param {string} params.weaponAnimState - 武器动画状态（保留参数，当前未使用）
     * @param {number} params.x - 玩家世界坐标 x
     * @param {number} params.y - 玩家世界坐标 y
     * @param {number} params.mouseX - 鼠标屏幕坐标 x
     * @param {number} params.mouseY - 鼠标屏幕坐标 y
     * @param {Function} params.screenToWorld - 屏幕坐标转世界坐标函数 (x, y) => {x, y}
     */
    update(dt = 16.67, params) {
        const now = Date.now();
        if (typeof dt === 'object' && params === undefined) {
            params = dt;
            dt = params.dt || 16.67;
        }
        const { isMoving, isInCombat } = params || {};

        // 检测状态是否改变（待机 ↔ 移动）
        if (this._glowLastState !== isMoving) {
            this._glowTransitionStart = now;    // 标记过渡开始
            this._glowLastState = isMoving; // 同步新状态
        }

        const transitionElapsed = this._glowTransitionStart > 0 ? now - this._glowTransitionStart : 0;

        // 生成新粒子（按当前状态）——攻击/技能期间也生成少量粒子，保持可见
        if (!isInCombat) {
            if (!isMoving) {
                // 待机状态：粒子数量翻倍
                if (Math.random() < 0.9) {
                    this._spawnWeaponGlowParticle(params);
                    this._spawnWeaponGlowParticle(params);
                }
            } else {
                if (Math.random() < 0.9) this._spawnWeaponGlowParticle(params);
            }
        } else {
            // 战斗期间：生成少量粒子维持可见度
            if (Math.random() < 0.3) this._spawnWeaponGlowParticle(params);
        }

        // 更新粒子（攻击/技能期间继续播放已生成的粒子）
        this.particles.forEach(p => {
            p.life -= dt;
            p.y += p.vy * (dt / 1000);
            p.x += p.vx * (dt / 1000);
            p.size *= 0.998;
        });

        // 过渡1s后，清除旧粒子（状态改变前产生的粒子）
        if (this._glowTransitionStart > 0 && transitionElapsed > 1000) {
            this.particles = this.particles.filter(p => p.createdAt >= this._glowTransitionStart);
            this._glowTransitionStart = 0; // 重置过渡标记
        } else {
            this.particles = this.particles.filter(p => p.life > 0);
        }
    }

    render(ctx) {
        const now = Date.now();
        const transitionElapsed = this._glowTransitionStart > 0 ? now - this._glowTransitionStart : 0;
        const transitionRatio = Math.min(1, transitionElapsed / 1000);
        // 旧粒子生命周期衰减因子：从100%（1.0）逐步减少到20%（0.2）
        const oldLifeFactor = Math.max(0.2, 1 - 0.8 * transitionRatio);

        this.particles.forEach(p => {
            const isOld = this._glowTransitionStart > 0 && p.createdAt < this._glowTransitionStart;

            let lifeRatio = p.life / p.maxLife;
            if (isOld && transitionElapsed <= 1000) {
                // 过渡期间，旧粒子的生命周期显示效果从100%逐步减少到20%
                lifeRatio = lifeRatio * oldLifeFactor;
            }

            const fadeIn = Math.min(1, (1 - lifeRatio) * 3);
            const fadeOut = Math.min(1, lifeRatio * 2);
            const alpha = Math.min(fadeIn, fadeOut) * 0.75; // 提高透明度：0.5→0.75
            const pulse = 1 + Math.sin(now * 0.003 + p.pulseOffset) * 0.15;
            const size = p.size * pulse;
            ctx.globalAlpha = alpha;
            // 主粒子（小圆）
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fill();
            // 火焰光晕层（椭圆，略大更淡，火焰形状）
            ctx.globalAlpha = alpha * 0.35;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y - size * 0.5, size * 1.8, size * 2.8, 0, 0, Math.PI * 2);
            ctx.fill();
            // 外层光晕（更大更淡）
            ctx.globalAlpha = alpha * 0.15;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size * 3.5, 0, Math.PI * 2);
            ctx.fill();
            // 核心亮点（极小极亮）
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = '#e0f0ff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, size * 0.3, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
    }

    reset() {
        this.particles = [];
        this._glowLastState = false;
        this._glowTransitionStart = 0;
    }
}
