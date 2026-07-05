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

    render(ctx) {
        // 计算攻击冲刺位移（应用到渲染位置，不影响碰撞体）
        let dashX = 0, dashY = 0;
        if (this._attackDashOffset > 0) {
            switch (this._facing) {
                case 'right': dashX = this._attackDashOffset; break;
                case 'left':  dashX = -this._attackDashOffset; break;
                case 'down':  dashY = this._attackDashOffset; break;
                case 'up':    dashY = -this._attackDashOffset; break;
            }
        }
        const pos = Renderer.worldToScreen(this.x + dashX, this.y + dashY);
        const x = pos.x, y = pos.y;
        this.renderHealthBar(ctx);

        // 直接使用原始精灵图，不旋转
        // 原理：原始精灵图本身就是正确的朝向，不做任何旋转
        // X轴（左右移动）：直接使用原始贴图 + flipX（水平镜像）区分方向
        // Y轴（上下移动）：使用不同行的帧（后续调整）
        // 攻击时：使用攻击精灵图 + 相同的 flipX 逻辑
        let textureKey = 'enemy_black_wolf';
        let currentSprite = this._sprites.side;
        let flipX = false;
        let actualFrame = this._animFrame;
        let canvasRotation = 0;
        let phaserRotation = 0;
        
        // 攻击状态：使用攻击精灵图
        if (this._animState === 'attack') {
            textureKey = 'enemy_black_wolf_attack';
            currentSprite = this._sprites.attack;
        }
        
        // 根据 facing 设置 flipX（攻击和移动使用相同逻辑）
        if (this._facing === 'left') {
            flipX = true;
        } else if (this._facing === 'right') {
            flipX = false;
        }
        const flipY = false; // 不再使用 flipY
        
        // 调试日志：确认攻击状态
        if (this._animState === 'attack') {
            console.log(`[BlackWolf attack] frame=${actualFrame} flipX=${flipX}`);
        }

        // Phaser 同步
        if (this._renderPhaserSync(ctx, x, y, textureKey, {
            spriteSize: 216,
            rotation: phaserRotation,
            frame: actualFrame,
            flipX: flipX,
            flipY: flipY,
            textOffsetY: -120
        })) {
            return;
        }
        ctx.save(); ctx.translate(x, y);

        // 计算动画变换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let bounceY = 0;
        let scaleX = 1, scaleY = 1;
        let leanAngle = 0;
        let swayX = 0;
        const t = this.animTime;

        if (this._animState === 'attack') {
            const progress = 1 - Math.max(0, this._attackTimer) / 300;
            const scale = 1 + Math.sin(progress * Math.PI) * 0.15;
            scaleX = scale;
            scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * 5;
            leanAngle = 0.1;
        } else if (this._animState === 'run') {
            const runPhase = t * 2;
            bounceY = Math.sin(runPhase) * 4;
            leanAngle = Math.sin(runPhase) * 0.12;
            swayX = Math.sin(runPhase + Math.PI / 4) * 2;
            const stretch = Math.sin(runPhase * 2) * 0.015;
            scaleX = 1 + stretch;
            scaleY = 1 - stretch * 0.3;
        } else if (this._animState === 'walk') {
            bounceY = Math.sin(t) * 2;
        }

        // 主要旋转（左右移动时旋转90°）
        if (canvasRotation !== 0) ctx.rotate(canvasRotation);
        // 水平翻转
        if (flipX) ctx.scale(-1, 1);
        // 保留身体倾斜效果
        ctx.rotate(leanAngle);

        // 绘制精灵图帧动画
        if (currentSprite && currentSprite.complete && currentSprite.naturalWidth > 0) {
            // 计算帧尺寸（每次渲染都重新计算，避免首次加载时 naturalWidth 为0）
            const frameW = currentSprite.naturalWidth / this._cols;
            const frameH = currentSprite.naturalHeight / this._rows;
            const frameIdx = actualFrame;
            const col = frameIdx % this._cols;
            const row = Math.floor(frameIdx / this._cols);
            const drawW = 216, drawH = 216;
            ctx.save();
            ctx.translate(0, swayX);
            ctx.scale(scaleX, scaleY);
            ctx.translate(0, bounceY);
            ctx.drawImage(
                currentSprite,
                col * frameW, row * frameH, frameW, frameH,  // 裁剪源
                -drawW / 2, -drawH / 2, drawW, drawH          // 目标位置
            );
            ctx.restore();
        } else {
            // 备用：绘制圆形
            ctx.fillStyle = this._color;
            ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = this._highlightColor;
            ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        }

        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
        ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, x, y - 120);
        this.renderCollisionRadius(ctx);
    }
}

export { BlackWolf };
