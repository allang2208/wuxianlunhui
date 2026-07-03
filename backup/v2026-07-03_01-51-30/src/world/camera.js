const Camera = {
            x: 0, y: 0, shakeX: 0, shakeY: 0, shakeIntensity: 0, shakeDecay: 0.85,
            lockY: false,
            yLockedValue: 0,
            aimOffsetX: 0,
            aimOffsetY: 0,
            aimSmooth: 0.15,
            follow(target) { this.x = target.x; if (!this.lockY) this.y = target.y; },
            update(target) {
                // 瞄准模式偏移：相机向鼠标方向偏移，给予更多视野
                const targetX = target.x + (this.aimOffsetX || 0);
                const targetY = target.y + (this.aimOffsetY || 0);
                // 判断是否在瞄准模式
                const isAiming = (this.aimOffsetX !== 0 || this.aimOffsetY !== 0);
                // 瞄准模式下移动速度降低为六分之一（基础0.12÷6=0.02）
                const smooth = isAiming ? CONFIG.CAMERA_SMOOTH / 6 : CONFIG.CAMERA_SMOOTH;
                // 平滑跟随（使用 CAMERA_SMOOTH 插值）
                this.x += (targetX - this.x) * smooth;
                if (!this.lockY) {
                    this.y += (targetY - this.y) * smooth;
                } else {
                    this.y = this.yLockedValue;
                }
                if (this.shakeIntensity > 0.5) { this.shakeX = (Math.random() - 0.5) * this.shakeIntensity; this.shakeY = (Math.random() - 0.5) * this.shakeIntensity; this.shakeIntensity *= this.shakeDecay; }
                else { this.shakeX = 0; this.shakeY = 0; this.shakeIntensity = 0; }
                // 边界限制：允许负坐标，只在世界尺寸处限制
                const halfW = CONFIG.VIEW_WIDTH / 2, halfH = CONFIG.VIEW_HEIGHT / 2;
                this.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, this.x));
                this.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, this.y));
            },
            triggerShake(intensity) { this.shakeIntensity = intensity; }
        };

        

export { Camera };
