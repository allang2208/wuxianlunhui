import { Enemy } from './enemy.js';
import { Player } from './player.js';
import { ThrustAttack } from '../combat/attack.js';
import { RangedAttack } from '../combat/attack.js';
import { Renderer } from '../world/renderer.js';
import { MathUtils } from '../config/math-utils.js';
import enemyConfigData from '../../data/enemy-config.json';

class BlackWolf extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.blackWolf,
            ...config
        });
        // 加载精灵图（挺进地牢风格：多方向）
        this._sprites = {
            side: new Image(),   // 侧视图（水平移动）
            front: new Image(),  // 正面（向下移动）
            back: new Image(),   // 背面（向上移动）
            attack: new Image(), // 攻击动画（8帧撕咬）
        };
        this._sprites.side.src = 'assets/enemies/black_wolf.png';
        this._sprites.front.src = 'assets/enemies/black_wolf_updown.png';
        this._sprites.back.src = 'assets/enemies/black_wolf_updown.png';
        this._sprites.attack.src = 'assets/enemies/black_wolf_attack.png';
        
        // 当前 facing 方向（用于渲染和动画）
        this._facing = 'right'; // right, left, up, down
        
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack
        this._attackTimer = 0;
        this._attackDashOffset = 0; // 攻击冲刺位移（向前100px）
        // 帧动画
        this._animFrame = 0;       // 当前帧索引 0-7
        this._animTimer = 0;       // 帧计时器
        this._frameW = 250;        // 单帧宽度（2行×4列，总宽1000）
        this._frameH = 215;        // 单帧高度（2行×4列，总高430）
        this._cols = 4;            // 每行4帧
        this._rows = 2;            // 2行
    }

    update(dt, entities) {
        super.update(dt, entities);
        
        // 根据主导速度方向确定 facing（避免微小波动导致频繁切换）
        const absVx = Math.abs(this.vx);
        const absVy = Math.abs(this.vy);
        const threshold = 0.5; // 最小有效速度阈值
        if (absVx >= threshold || absVy >= threshold) {
            if (absVy > absVx) {
                this._facing = this.vy > 0 ? 'down' : 'up';
            } else {
                this._facing = this.vx > 0 ? 'right' : 'left';
            }
        }
        // 否则保持当前 facing（不更新）
        
        // 根据速度确定动画状态
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (this._attackTimer > 0) {
            this._animState = 'attack';
        } else if (speed > 1.2) {
            this._animState = 'run';
        } else if (speed > 0.1) {
            this._animState = 'walk';
        } else {
            this._animState = 'idle';
        }
        // 攻击动画计时 + 冲刺位移
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            // 攻击冲刺位移：前100ms快速冲刺到100px，后700ms缓慢返回
            const progress = 1 - (this._attackTimer / 800); // 0 → 1
            if (progress < 0.125) {
                // 前100ms：线性冲刺到100px（迅速突进）
                this._attackDashOffset = 100 * (progress / 0.125);
            } else {
                // 后700ms：线性返回原点
                this._attackDashOffset = 100 * Math.max(0, 1 - (progress - 0.125) / 0.875);
            }
        } else {
            this._attackDashOffset = 0;
            if (this._animState === 'attack') {
                // 攻击结束，重置帧索引
                this._animFrame = 0;
            }
        }
        // 更新帧动画
        this._animTimer += dt;
        let frameDuration = 150;
        if (this._animState === 'attack') {
            // 攻击动画：800ms 内播完 8 帧，100ms/帧，整数避免精度问题
            frameDuration = 100;
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % 8;
            }
        } else if (this._animState === 'run') {
            frameDuration = 80;
        } else if (this._animState === 'walk') {
            frameDuration = 120;
        } else if (this._animState === 'idle') {
            frameDuration = 200;
        }
        if (this._animState !== 'attack') {
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                const totalFrames = (this._animState === 'run') ? 8 : 4;
                this._animFrame = (this._animFrame + 1) % totalFrames;
            }
        }
    }

    triggerWeaponAnim() {
        super.triggerWeaponAnim();
        // 如果攻击动画还在播放，不重置（避免提前打断动画）
        if (this._attackTimer > 0) return;
        this._attackTimer = 800; // 800ms 攻击动画（8帧 × 100ms/帧）
        this._animFrame = 0;     // 从第一帧开始
        this._animTimer = 0;     // 重置帧计时器，确保从第一帧开始计时
        this._attackDashOffset = 0; // 重置冲刺位移
    }

    _getRenderPosition() {
        let dashX = 0, dashY = 0;
        if (this._attackDashOffset > 0) {
            switch (this._facing) {
                case 'right': dashX = this._attackDashOffset; break;
                case 'left':  dashX = -this._attackDashOffset; break;
                case 'down':  dashY = this._attackDashOffset; break;
                case 'up':    dashY = -this._attackDashOffset; break;
            }
        }
        return Renderer.worldToScreen(this.x + dashX, this.y + dashY);
    }

    _getTextureKey() {
        if (this._animState === 'attack') {
            return 'enemy_black_wolf_attack';
        }
        return 'enemy_black_wolf';
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this._facing === 'left') flipX = true;
        else if (this._facing === 'right') flipX = false;
        return {
            spriteSize: 216,
            rotation: 0,
            frame: this._animFrame,
            flipX: flipX,
            flipY: false,
            textOffsetY: -120
        };
    }

    _drawBody(ctx) {
        let bounceY = 0; let scaleX = 1, scaleY = 1; let leanAngle = 0; let swayX = 0;
        const t = this.animTime;
        if (this._animState === 'attack') {
            const progress = 1 - Math.max(0, this._attackTimer) / 300;
            const scale = 1 + Math.sin(progress * Math.PI) * 0.15;
            scaleX = scale; scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * 5;
            leanAngle = 0.1;
        } else if (this._animState === 'run') {
            const runPhase = t * 2;
            bounceY = Math.sin(runPhase) * 4;
            leanAngle = Math.sin(runPhase) * 0.12;
            swayX = Math.sin(runPhase + Math.PI / 4) * 2;
            const stretch = Math.sin(runPhase * 2) * 0.015;
            scaleX = 1 + stretch; scaleY = 1 - stretch * 0.3;
        } else if (this._animState === 'walk') {
            bounceY = Math.sin(t) * 2;
        }
        const currentSprite = this._animState === 'attack'
            ? this._sprites.attack
            : this._sprites.side;
        if (this._facing === 'left') ctx.scale(-1, 1);
        ctx.rotate(leanAngle);
        if (currentSprite && currentSprite.complete && currentSprite.naturalWidth > 0) {
            const frameW = currentSprite.naturalWidth / this._cols;
            const frameH = currentSprite.naturalHeight / this._rows;
            const col = this._animFrame % this._cols;
            const row = Math.floor(this._animFrame / this._cols);
            ctx.save();
            ctx.translate(0, swayX);
            ctx.scale(scaleX, scaleY);
            ctx.translate(0, bounceY);
            ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, -108, -108, 216, 216);
            ctx.restore();
        } else {
            super._drawBody(ctx);
        }
    }
}

export { BlackWolf };
