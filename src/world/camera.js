const Camera = {
            x: 0, y: 0, shakeX: 0, shakeY: 0, shakeIntensity: 0, shakeDecay: 0.85,
            follow(target) { this.x = target.x; this.y = target.y; },
            update(target) {
                // 平滑跟随（使用 CAMERA_SMOOTH 插值）
                this.x += (target.x - this.x) * CONFIG.CAMERA_SMOOTH;
                this.y += (target.y - this.y) * CONFIG.CAMERA_SMOOTH;
                if (this.shakeIntensity > 0.5) { this.shakeX = (Math.random() - 0.5) * this.shakeIntensity; this.shakeY = (Math.random() - 0.5) * this.shakeIntensity; this.shakeIntensity *= this.shakeDecay; }
                else { this.shakeX = 0; this.shakeY = 0; this.shakeIntensity = 0; }
                // 边界限制：只在世界边界处限制，允许 Camera 跟随到任何位置
                const halfW = CONFIG.VIEW_WIDTH / 2, halfH = CONFIG.VIEW_HEIGHT / 2;
                this.x = Math.max(halfW, Math.min(CONFIG.WORLD_WIDTH - halfW, this.x));
                this.y = Math.max(halfH, Math.min(CONFIG.WORLD_HEIGHT - halfH, this.y));
            },
            triggerShake(intensity) { this.shakeIntensity = intensity; }
        };

        

export { Camera };
