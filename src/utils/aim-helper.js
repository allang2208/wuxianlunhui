/**
 * AimHelper — 预判瞄准（leading target）工具
 *
 * 假设目标做匀速直线运动，求解弹体与目标同时到达的拦截点。
 * 解方程 |T + V*t - P| = S*t，得到一元二次方程：
 *   a = V·V - S²
 *   b = 2 * V·(T - P)
 *   c = |T - P|²
 * 取最小正根 t，拦截点 = T + V*t。
 */
export const AimHelper = {
    /**
     * 计算预判瞄准点
     * @param {number} sourceX - 发射点 X
     * @param {number} sourceY - 发射点 Y
     * @param {number} targetX - 目标当前 X
     * @param {number} targetY - 目标当前 Y
     * @param {number} targetVx - 目标 X 方向速度（px/s）
     * @param {number} targetVy - 目标 Y 方向速度（px/s）
     * @param {number} projectileSpeed - 弹体速度（px/s）
     * @param {number} [extraDelayS=0] - 发射前额外延迟（s），用于动画前摇
     * @returns {{x:number, y:number}} 预判瞄准点
     */
    lead(sourceX, sourceY, targetX, targetY, targetVx, targetVy, projectileSpeed, extraDelayS = 0) {
        // 把目标位置修正到“真正发射时刻”的预测位置
        const fireTargetX = targetX + targetVx * extraDelayS;
        const fireTargetY = targetY + targetVy * extraDelayS;

        const dx = fireTargetX - sourceX;
        const dy = fireTargetY - sourceY;

        const a = targetVx * targetVx + targetVy * targetVy - projectileSpeed * projectileSpeed;
        const b = 2 * (targetVx * dx + targetVy * dy);
        const c = dx * dx + dy * dy;

        let t;
        if (Math.abs(a) < 1e-6) {
            // 弹速与目标速度几乎相等，退化为线性方程
            if (Math.abs(b) < 1e-6) {
                return { x: targetX, y: targetY };
            }
            t = -c / b;
        } else {
            const disc = b * b - 4 * a * c;
            if (disc < 0) {
                // 目标正在逃离且弹速追不上，回退到当前位置
                return { x: targetX, y: targetY };
            }
            const sqrtD = Math.sqrt(disc);
            const t1 = (-b - sqrtD) / (2 * a);
            const t2 = (-b + sqrtD) / (2 * a);
            t = t1 > 0 ? t1 : (t2 > 0 ? t2 : null);
        }

        if (t === null || t <= 0 || !isFinite(t)) {
            return { x: targetX, y: targetY };
        }

        return {
            x: fireTargetX + targetVx * t,
            y: fireTargetY + targetVy * t
        };
    }
};
