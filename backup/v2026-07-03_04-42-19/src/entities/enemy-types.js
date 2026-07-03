import { Enemy } from './enemy.js';
import { ThrustAttack } from '../combat/attack.js';
import { RangedAttack } from '../combat/attack.js';
import { Renderer } from '../world/renderer.js';

class Zombie extends Enemy {
    constructor(x, y) {
                super(x, y, {
                    name: '僵尸',
                    hp: 100, maxHp: 100,
                    size: 28, collisionRadius: 24,
                    speed: 39,
                    level: 1,
                    showWeapon: false,
                    color: '#5a8a4a',
                    highlightColor: 'rgba(90, 180, 90, 0.3)',
                    str: 10, dex: 15, con: 15, int: 3, wis: 4, luck: 5
                });
                this._rank = 'normal';
                this.attacks = {
                    melee: new ThrustAttack({
                        cooldown: 800, range: 60, width: 25,
                        damage: { min: 10, max: 18 }, knockback: 10
                    })
                };
                this.attackRange = 60;
                this.aiInterval = 400;
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y);
                const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
                this.renderHealthBar(ctx);
                // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
                const phaserScene = window.__phaserScene;
                if (phaserScene) {
                    const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_zombie');
                    if (!this.active) {
                        sprite.setVisible(false);
                        return;
                    }
                    const spriteSize = this.size * 3.5;
                    sprite.setPosition(this.x, this.y);
                    sprite.setRotation(this.rotation + Math.PI / 2);
                    const sourceImage = sprite.texture.getSourceImage();
                    const originalWidth = sourceImage ? sourceImage.width : 64;
                    const scale = spriteSize / originalWidth;
                    sprite.setScale(scale);
                    sprite.setVisible(true);
                    // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
                    ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                    ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this.name, x, y - 32);
                    this.renderCollisionRadius(ctx);
                    return;
                }
                ctx.save(); ctx.translate(x, y);
                ctx.scale(this.size / 14, this.size / 14);
                // 阴影
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI*2); ctx.fill();
                // 身体（绿色圆）
                ctx.fillStyle = '#5a8a4a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                // 高光
                ctx.fillStyle = 'rgba(90, 200, 90, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                // 眼睛
                ctx.fillStyle = '#ff3333'; ctx.beginPath(); ctx.arc(-4, -2, 2, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(4, -2, 2, 0, Math.PI*2); ctx.fill();
                // 脉冲光环
                ctx.strokeStyle = 'rgba(90, 180, 90, 0.3)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
                this.renderCollisionRadius(ctx);
            }
        }

        class RunnerZombie extends Enemy {
            constructor(x, y) {
                super(x, y, {
                    name: '奔跑僵尸',
                    hp: 120, maxHp: 120,
                    size: 24, collisionRadius: 20,
                    speed: 93.6,
                    level: 3,
                    showWeapon: false,
                    color: '#8a3a3a',
                    highlightColor: 'rgba(255, 100, 100, 0.3)',
                    str: 15, dex: 30, con: 15, int: 3, wis: 3, luck: 4
                });
                this._rank = 'normal';
                this.attacks = {
                    melee: new ThrustAttack({
                        cooldown: 500, range: 55, width: 20,
                        damage: { min: 8, max: 14 }, knockback: 8
                    })
                };
                this.attackRange = 55;
                this.aiInterval = 200;
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y);
                const x = pos.x, y = pos.y + Math.sin(this.animTime * 2) * 3;
                this.renderHealthBar(ctx);
                // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
                const phaserScene = window.__phaserScene;
                if (phaserScene) {
                    const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_runner_zombie');
                    if (!this.active) {
                        sprite.setVisible(false);
                        return;
                    }
                    const spriteSize = this.size * 3.5;
                    sprite.setPosition(this.x, this.y);
                    sprite.setRotation(this.rotation + Math.PI / 2);
                    const sourceImage = sprite.texture.getSourceImage();
                    const originalWidth = sourceImage ? sourceImage.width : 64;
                    const scale = spriteSize / originalWidth;
                    sprite.setScale(scale);
                    sprite.setVisible(true);
                    // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
                    ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                    ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this.name, x, y - 32);
                    this.renderCollisionRadius(ctx);
                    return;
                }
                ctx.save(); ctx.translate(x, y);
                ctx.scale(this.size / 12, this.size / 12);
                // 阴影
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 8, 4, 0, 0, Math.PI*2); ctx.fill();
                // 身体（红色圆）
                ctx.fillStyle = '#8a3a3a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                // 高光
                ctx.fillStyle = 'rgba(255, 120, 120, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                // 眼睛（愤怒状）
                ctx.fillStyle = '#ff6600'; ctx.beginPath(); ctx.arc(-3, -2, 2.5, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(3, -2, 2.5, 0, Math.PI*2); ctx.fill();
                // 速度线
                ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-this.size - 4, -4); ctx.lineTo(-this.size - 12, -2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-this.size - 4, 2); ctx.lineTo(-this.size - 10, 3); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
                this.renderCollisionRadius(ctx);
            }
        }

        class FatZombie extends Enemy {
            constructor(x, y) {
                super(x, y, {
                    name: '胖子僵尸',
                    hp: 400, maxHp: 400,
                    size: 20, collisionRadius: 18,
                    speed: 23.4,
                    level: 5,
                    showWeapon: false,
                    color: '#6a4a2a',
                    highlightColor: 'rgba(160, 120, 80, 0.3)',
                    str: 45, dex: 45, con: 50, int: 3, wis: 4, luck: 3
                });
                this._rank = 'boss';
                this.attacks = {
                    melee: new ThrustAttack({
                        cooldown: 1200, range: 90, width: 40,
                        damage: { min: 15, max: 25 }, knockback: 20
                    })
                };
                this.attackRange = 90;
                this.aiInterval = 500;
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y);
                const x = pos.x, y = pos.y + Math.sin(this.animTime) * 1.5;
                this.renderHealthBar(ctx);
                // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
                const phaserScene = window.__phaserScene;
                if (phaserScene) {
                    const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_fat_zombie');
                    if (!this.active) {
                        sprite.setVisible(false);
                        return;
                    }
                    const spriteSize = this.size * 3.5;
                    sprite.setPosition(this.x, this.y);
                    sprite.setRotation(this.rotation + Math.PI / 2);
                    const sourceImage = sprite.texture.getSourceImage();
                    const originalWidth = sourceImage ? sourceImage.width : 64;
                    const scale = spriteSize / originalWidth;
                    sprite.setScale(scale);
                    sprite.setVisible(true);
                    // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
                    ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                    ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this.name, x, y - 36);
                    this.renderCollisionRadius(ctx);
                    return;
                }
                ctx.save(); ctx.translate(x, y);
                // 阴影
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 14, 14, 7, 0, 0, Math.PI*2); ctx.fill();
                // 身体（棕色大圆）
                ctx.fillStyle = '#6a4a2a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                // 高光
                ctx.fillStyle = 'rgba(160, 120, 80, 0.3)'; ctx.beginPath(); ctx.arc(-4, -4, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                // 小眼睛
                ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(-5, -3, 2, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(5, -3, 2, 0, Math.PI*2); ctx.fill();
                // 嘴巴
                ctx.fillStyle = '#3a1a0a'; ctx.beginPath(); ctx.arc(0, 6, 4, 0, Math.PI); ctx.fill();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 36);
                this.renderCollisionRadius(ctx);
            }
        }

        class SpitterZombie extends Enemy {
            constructor(x, y) {
                super(x, y, {
                    name: '毒液僵尸',
                    hp: 150, maxHp: 150,
                    size: 26, collisionRadius: 22,
                    speed: 46.8,
                    level: 5,
                    showWeapon: false,
                    color: '#7a3a8a',
                    highlightColor: 'rgba(160, 80, 200, 0.3)',
                    str: 22, dex: 38, con: 20, int: 10, wis: 6, luck: 5
                });
                this._rank = 'elite';
                // 远程毒液攻击
                this.attacks = {
                    ranged: new RangedAttack({
                        cooldown: 1500, projectileSpeed: 10223, projectileRange: 800, projectileSize: 24,
                        damage: { min: 12, max: 20 }, piercing: false,
                        damageType: 'magic'
                    })
                };
                this.attackRange = 350;
                this.aiInterval = 400;
            }
            _updateAttack(dt, entities) {
                this.aiTimer += dt;
                if (this.aiTimer < this.aiInterval) return;
                const attack = this.attacks.ranged;
                if (!attack || !attack.canUse()) return;
                // 视线检测
                const targetX = this.target.x, targetY = this.target.y;
                const isBlocked = typeof WallSystem !== 'undefined' &&
                    WallSystem.blocked(this.x, this.y, targetX, targetY);
                if (isBlocked) return;
                // 距离检测：只在远程距离内攻击
                const dist = Math.sqrt((targetX - this.x)**2 + (targetY - this.y)**2);
                if (dist > this.attackRange) return;
                this.aiTimer = 0;
                if (attack.use(this, targetX, targetY, Array.from(entities.values()))) {
                    this.triggerWeaponAnim();
                }
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y);
                const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
                this.renderHealthBar(ctx);
                // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
                const phaserScene = window.__phaserScene;
                if (phaserScene) {
                    const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_spitter_zombie');
                    if (!this.active) {
                        sprite.setVisible(false);
                        return;
                    }
                    const spriteSize = this.size * 3.5;
                    sprite.setPosition(this.x, this.y);
                    sprite.setRotation(this.rotation + Math.PI / 2);
                    const sourceImage = sprite.texture.getSourceImage();
                    const originalWidth = sourceImage ? sourceImage.width : 64;
                    const scale = spriteSize / originalWidth;
                    sprite.setScale(scale);
                    sprite.setVisible(true);
                    // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
                    ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                    ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this.name, x, y - 32);
                    this.renderCollisionRadius(ctx);
                    return;
                }
                ctx.save(); ctx.translate(x, y);
                ctx.scale(this.size / 13, this.size / 13);
                // 阴影
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 9, 4.5, 0, 0, Math.PI*2); ctx.fill();
                // 身体（紫色圆）
                ctx.fillStyle = '#7a3a8a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                // 高光
                ctx.fillStyle = 'rgba(180, 100, 220, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                // 眼睛（绿色毒液色）
                ctx.fillStyle = '#00ff44'; ctx.beginPath(); ctx.arc(-4, -2, 2, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(4, -2, 2, 0, Math.PI*2); ctx.fill();
                // 毒液滴落效果
                const dripY = 6 + Math.sin(Date.now() / 200) * 3;
                ctx.fillStyle = 'rgba(0, 255, 100, 0.6)'; ctx.beginPath(); ctx.arc(0, dripY, 2, 0, Math.PI*2); ctx.fill();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
                this.renderCollisionRadius(ctx);
            }
        }

class BabySpider extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '小蜘蛛',
            hp: 50, maxHp: 50,
            size: 14, collisionRadius: 12,
            speed: 93.6,
            level: 1,
            showWeapon: false,
            color: '#7a5a3a',
            highlightColor: 'rgba(160, 120, 80, 0.3)',
            str: 5, dex: 8, con: 5, int: 2, wis: 2, luck: 4
        });
                this._rank = 'minor';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 500, range: 55, width: 20,
                damage: { min: 8, max: 14 }, knockback: 8
            })
        };
        this.attackRange = 55;
        this.aiInterval = 200;
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_baby_spider');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 8, 8, 4, 0, 0, Math.PI*2); ctx.fill();
        // 身体（棕色圆）
        ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        // 高光
        ctx.fillStyle = 'rgba(160, 120, 80, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        // 小眼睛
        ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(-3, -2, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(3, -2, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class Spider extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '蜘蛛',
            hp: 180, maxHp: 180,
            size: 18, collisionRadius: 15,
            speed: 46.8,
            level: 3,
            showWeapon: false,
            color: '#6a3a5a',
            highlightColor: 'rgba(140, 80, 120, 0.3)',
            str: 20, dex: 40, con: 22, int: 4, wis: 5, luck: 5
        });
        this._rank = 'normal';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 800, range: 65, width: 25,
                damage: { min: 10, max: 18 }, knockback: 10
            })
        };
        this.attackRange = 65;
        this.aiInterval = 400;
        // 加载蜘蛛贴图
        this.spiderImage = new Image();
        this.spiderImage.src = 'assets/enemies/spider.png';
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
        this.renderHealthBar(ctx);

        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_spider');
            // 如果蜘蛛已死亡，隐藏 Phaser Sprite
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5; // 与原有 Canvas 渲染一致
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            // 基于纹理原始尺寸计算缩放
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 2048;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }

        if (this.spiderImage && this.spiderImage.complete && this.spiderImage.naturalWidth > 0) {
            // 使用贴图绘制蜘蛛，根据朝向旋转（顺时针+90度修正朝向）
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(this.rotation + Math.PI / 2); // 顺时针旋转90度
            const size = this.size * 3.5; // 贴图大小
            ctx.drawImage(this.spiderImage, -size / 2, -size / 2, size, size);
            ctx.restore();
        } else {
            // 贴图未加载时回退到圆形绘制
            ctx.save();
            ctx.translate(x, y);
            // 阴影
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            // 身体（紫褐色圆）
            ctx.fillStyle = '#6a3a5a';
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();
            // 高光
            ctx.fillStyle = 'rgba(140, 80, 120, 0.3)';
            ctx.beginPath();
            ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI * 2);
            ctx.fill();
            // 眼睛
            ctx.fillStyle = '#2a1a1a';
            ctx.beginPath();
            ctx.arc(-4, -2, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(4, -2, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
        ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class WolfSpider extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '狼蛛',
            hp: 280, maxHp: 280,
            size: 23, collisionRadius: 20,
            speed: 31.2,
            level: 5,
            showWeapon: false,
            color: '#4a2a3a',
            highlightColor: 'rgba(120, 60, 80, 0.3)',
            str: 40, dex: 60, con: 35, int: 4, wis: 6, luck: 4
        });
                this._rank = 'elite';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 1000, range: 95, width: 35,
                damage: { min: 15, max: 25 }, knockback: 20
            })
        };
        this.attackRange = 95;
        this.aiInterval = 500;
        this.poisonStacks = 1;
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_wolf_spider');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 12, 12, 6, 0, 0, Math.PI*2); ctx.fill();
        // 身体（深紫色圆）
        ctx.fillStyle = '#4a2a3a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        // 高光
        ctx.fillStyle = 'rgba(120, 60, 80, 0.3)'; ctx.beginPath(); ctx.arc(-4, -4, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        // 眼睛（红色）
        ctx.fillStyle = '#cc2222'; ctx.beginPath(); ctx.arc(-5, -3, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(5, -3, 2.5, 0, Math.PI*2); ctx.fill();
        // 獠牙标记
        ctx.fillStyle = '#aa5555';
        ctx.beginPath(); ctx.moveTo(-3, 4); ctx.lineTo(-1, 7); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(3, 4); ctx.lineTo(5, 7); ctx.lineTo(1, 7); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class BroodmotherSpider extends Enemy {
    constructor(x, y) {
        super(x, y, {
            id: 'broodmotherSpider',
            name: '育母蜘蛛',
            hp: 550, maxHp: 550,
            size: 40, collisionRadius: 35,
            speed: 46.8,
            level: 8,
            showWeapon: false,
            color: '#2a1a2a',
            highlightColor: 'rgba(80, 40, 60, 0.3)',
            str: 55, dex: 65, con: 60, int: 6, wis: 10, luck: 6
        });
                this._rank = 'boss';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 1200, range: 100, width: 40,
                damage: { min: 20, max: 35 }, knockback: 25
            })
        };
        this.attackRange = 100;
        this.aiInterval = 600;
        this.poisonStacks = 2;
    }
    onDeath(source) {
        super.onDeath(source);
        // 死亡时生成3只小蜘蛛
        for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 15 + Math.random() * 20;
            const bx = this.x + Math.cos(angle) * dist;
            const by = this.y + Math.sin(angle) * dist;
            const baby = new BabySpider(bx, by);
            if (typeof Game !== 'undefined' && Game.entities) {
                Game.entities.set(`baby_spider_${Date.now()}_${i}_${Math.random()}`, baby);
            }
        }
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 20, '育母蜘蛛死亡！幼蛛涌出', '#ff4444'));
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 1.5;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_broodmother_spider');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 48);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 18, 18, 9, 0, 0, Math.PI*2); ctx.fill();
        // 身体（黑色大圆）
        ctx.fillStyle = '#2a1a2a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        // 高光
        ctx.fillStyle = 'rgba(80, 40, 60, 0.3)'; ctx.beginPath(); ctx.arc(-6, -6, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        // 红色大眼睛
        ctx.fillStyle = '#cc0000'; ctx.beginPath(); ctx.arc(-8, -5, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(8, -5, 4, 0, Math.PI*2); ctx.fill();
        // 眼睛高光
        ctx.fillStyle = 'rgba(255, 50, 50, 0.5)'; ctx.beginPath(); ctx.arc(-6, -7, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, -7, 1.5, 0, Math.PI*2); ctx.fill();
        // 暗红色脉冲光环
        ctx.strokeStyle = 'rgba(180, 40, 40, 0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, this.size + 8 + Math.sin(Date.now()/400)*2, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 48);
        this.renderCollisionRadius(ctx);
    }
}

export { Zombie, RunnerZombie, FatZombie, SpitterZombie, BabySpider, Spider, WolfSpider, BroodmotherSpider, BlackWolf, SkeletonWarrior, SkeletonArcher, SkeletonDog, Necromancer, DeathKnight, BigBoss };

class SkeletonWarrior extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '骷髅兵',
            hp: 80, maxHp: 80,
            size: 16, collisionRadius: 14,
            speed: 46.8,
            level: 3,
            showWeapon: false,
            color: '#d0d0b0',
            highlightColor: 'rgba(200, 200, 160, 0.3)',
            str: 10, dex: 18, con: 15, int: 3, wis: 3, luck: 4
        });
                this._rank = 'minor';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 800, range: 60, width: 25,
                damage: { min: 15, max: 27 }, knockback: 15
            })
        };
        this.attackRange = 60;
        this.aiInterval = 400;
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_skeleton_warrior');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#d0d0b0'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(200, 200, 160, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#cc2222'; ctx.beginPath(); ctx.arc(-4, -2, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -2, 2, 0, Math.PI*2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class SkeletonArcher extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '骷髅射手',
            hp: 180, maxHp: 180,
            size: 15, collisionRadius: 12,
            speed: 109.2,
            level: 6,
            showWeapon: false,
            color: '#c0c0a0',
            highlightColor: 'rgba(180, 180, 150, 0.3)',
            str: 20, dex: 38, con: 18, int: 15, wis: 10, luck: 6
        });
                this._rank = 'normal';
        this.attacks = {
            ranged: new RangedAttack({
                cooldown: 1500, projectileSpeed: 20442, projectileRange: 800, projectileSize: 24,
                damage: { min: 24, max: 40 }, piercing: false
            })
        };
        this.attackRange = 350;
        this.aiInterval = 400;
    }
    _updateAttack(dt, entities) {
        this.aiTimer += dt;
        if (this.aiTimer < this.aiInterval) return;
        const attack = this.attacks.ranged;
        if (!attack || !attack.canUse()) return;
        const targetX = this.target.x, targetY = this.target.y;
        const isBlocked = typeof WallSystem !== 'undefined' &&
            WallSystem.blocked(this.x, this.y, targetX, targetY);
        if (isBlocked) return;
        const dist = Math.sqrt((targetX - this.x)**2 + (targetY - this.y)**2);
        if (dist > this.attackRange) return;
        this.aiTimer = 0;
        if (attack.use(this, targetX, targetY, Array.from(entities.values()))) {
            this.triggerWeaponAnim();
        }
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_skeleton_archer');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 9, 4.5, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#c0c0a0'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(180, 180, 150, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#00ff44'; ctx.beginPath(); ctx.arc(-4, -2, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -2, 2, 0, Math.PI*2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class SkeletonDog extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '骷髅犬',
            hp: 220, maxHp: 220,
            size: 21, collisionRadius: 18,
            speed: 187.2,
            level: 5,
            showWeapon: false,
            color: '#c0c0c0',
            highlightColor: 'rgba(180, 180, 180, 0.3)',
            str: 30, dex: 48, con: 26, int: 5, wis: 5, luck: 6
        });
                this._rank = 'normal';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 312, range: 88, width: 25,
                damage: { min: 19, max: 33 }, knockback: 19
            })
        };
        this.attackRange = 88;
        this.aiInterval = 300;
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime * 2) * 3;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_skeleton_dog');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#c0c0c0'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(180, 180, 180, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ff6600'; ctx.beginPath(); ctx.arc(-4, -2, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -2, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-this.size - 4, -4); ctx.lineTo(-this.size - 12, -2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-this.size - 4, 2); ctx.lineTo(-this.size - 10, 3); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class Necromancer extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '亡灵法师',
            hp: 350, maxHp: 350,
            size: 25, collisionRadius: 22,
            speed: 31.2,
            level: 7,
            showWeapon: false,
            color: '#3a2a5a',
            highlightColor: 'rgba(100, 80, 140, 0.3)',
            str: 45, dex: 50, con: 45, int: 5, wis: 8, luck: 4
        });
        this._rank = 'elite';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 1000, range: 95, width: 35,
                damage: { min: 19, max: 32 }, knockback: 26,
                damageType: 'magic'
            })
        };
        this.attackRange = 95;
        this.aiInterval = 500;
        this._summonTimer = 0;
        this._summonInterval = 15000; // 15秒
    }
    update(dt, entities) {
        super.update(dt, entities);
        // 召唤计时
        this._summonTimer += dt;
        if (this._summonTimer >= this._summonInterval) {
            this._summonTimer = 0;
            this._summonSkeletons();
        }
    }
    _summonSkeletons() {
        for (let i = 0; i < 2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 30;
            const sx = this.x + Math.cos(angle) * dist;
            const sy = this.y + Math.sin(angle) * dist;
            const skeleton = new SkeletonWarrior(sx, sy);
            if (typeof Game !== 'undefined' && Game.entities) {
                Game.entities.set(`skeleton_summon_${Date.now()}_${i}_${Math.random()}`, skeleton);
            }
        }
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '亡灵法师召唤了骷髅兵！', '#aa55ff'));
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_necromancer');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 32);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 12, 12, 6, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#3a2a5a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(100, 80, 140, 0.3)'; ctx.beginPath(); ctx.arc(-4, -4, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#cc2222'; ctx.beginPath(); ctx.arc(-5, -3, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(5, -3, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(170, 85, 255, 0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, this.size + 8 + Math.sin(Date.now()/400)*2, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
        this.renderCollisionRadius(ctx);
    }
}

class DeathKnight extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '亡灵骑士',
            hp: 800, maxHp: 800,
            size: 45, collisionRadius: 40,
            speed: 117,
            level: 10,
            showWeapon: false,
            color: '#4a4a4a',
            highlightColor: 'rgba(120, 120, 120, 0.3)',
            str: 75, dex: 75, con: 75, int: 8, wis: 12, luck: 8
        });
                this._rank = 'boss';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 1200, range: 100, width: 40,
                damage: { min: 30, max: 52 }, knockback: 37
            })
        };
        this.attackRange = 100;
        this.aiInterval = 600;
        this._critChance = 25; // 25%暴击
        this._stunChance = 25; // 25%眩晕
    }
    _onHitEntity(target) {
        if (target instanceof Player) {
            // 25%概率暴击
            if (Math.random() * 100 < this._critChance) {
                const critDamage = Math.floor(this.data.atk * 1.5);
                target.takeDamage(critDamage, this, 'magic');
                EffectManager.add(new FloatingTextEffect(target.x, target.y - 20, '暴击！', '#ff4444'));
            }
            // 25%概率眩晕1秒
            if (Math.random() * 100 < this._stunChance) {
                target._dashStunned = true;
                target._dashStunTimer = 1000;
                EffectManager.add(new FloatingTextEffect(target.x, target.y - 35, '眩晕！', '#ffaa00'));
            }
        }
    }
    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 1.5;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_death_knight');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 48);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 18, 18, 9, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#4a4a4a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(120, 120, 120, 0.3)'; ctx.beginPath(); ctx.arc(-6, -6, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#cc0000'; ctx.beginPath(); ctx.arc(-8, -5, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(8, -5, 4, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255, 50, 50, 0.5)'; ctx.beginPath(); ctx.arc(-6, -7, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, -7, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(180, 40, 40, 0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, this.size + 8 + Math.sin(Date.now()/400)*2, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 48);
        this.renderCollisionRadius(ctx);
    }
}

class BlackWolf extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            id: 'blackWolf',
            name: config.name || '黑狼',
            hp: config.hp || 160, maxHp: config.maxHp || 160,
            size: config.size || 19, collisionRadius: config.collisionRadius || 16,
            speed: config.speed || 2.5,
            level: config.level || 5,
            showWeapon: config.showWeapon !== false,
            color: config.color || '#2a2a2a',
            highlightColor: config.highlightColor || 'rgba(80, 80, 80, 0.3)',
            str: config.str || 23, dex: config.dex || 30, con: config.con || 23, int: config.int || 6, wis: config.wis || 6, luck: config.luck || 10
        });
                this._rank = 'normal';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 312, range: 88, width: 25,
                damage: { min: 13, max: 22 }, knockback: 13
            })
        };
        this.attackRange = 88;
        this.aiInterval = 300;
        // 重新保存原始值（因为父类构造函数已保存了默认值，子类覆盖后需同步）
        this._baseAttackRange = this.attackRange;
        this._baseAiInterval = this.aiInterval;
        // 加载精灵图
        this._sprite = new Image();
        this._sprite.src = 'assets/enemies/black_wolf.png';
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack
        this._attackTimer = 0;
    }

    update(dt, entities) {
        super.update(dt, entities);
        // 根据速度更新动画状态
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
        // 攻击动画计时
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
        }
    }

    triggerWeaponAnim() {
        super.triggerWeaponAnim();
        this._attackTimer = 300; // 300ms 攻击动画
    }

    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y;
        this.renderHealthBar(ctx);
        // Phaser 同步：如果 Phaser 已就绪，同步到 Phaser Sprite
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_black_wolf');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = 54;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 2048;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);
            // 跳过 Canvas 渲染，让 Phaser 处理，但保留名字和碰撞半径显示
            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 40);
            this.renderCollisionRadius(ctx);
            return;
        }
        ctx.save(); ctx.translate(x, y);

        // 计算动画变换（仅保留跑动的抖动效果）
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let bounceY = 0;
        let scaleX = 1, scaleY = 1;
        let leanAngle = 0;
        let swayX = 0; // 左右摆动
        const t = this.animTime;

        if (this._animState === 'attack') {
            // 攻击动画：前冲 + 等比例放大
            const progress = 1 - Math.max(0, this._attackTimer) / 300;
            const scale = 1 + Math.sin(progress * Math.PI) * 0.15;
            scaleX = scale;
            scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * 5;
            leanAngle = 0.1;
        } else if (this._animState === 'run') {
            // 跑动：明显弹跳 + 身体倾斜 + 轻微左右摆动 + 前后脚伸缩
            const runPhase = t * 2;
            bounceY = Math.sin(runPhase) * 4;
            leanAngle = Math.sin(runPhase) * 0.12;
            // 左右摆动（重心偏移，2px）
            swayX = Math.sin(runPhase + Math.PI / 4) * 2;
            // 前后脚伸缩（通过身体前后轻微拉伸模拟，1.5%）
            const stretch = Math.sin(runPhase * 2) * 0.015;
            scaleX = 1 + stretch;
            scaleY = 1 - stretch * 0.3;
        } else if (this._animState === 'walk') {
            // 走路：轻微弹跳
            bounceY = Math.sin(t) * 2;
            scaleX = 1;
            scaleY = 1;
        }

        // 旋转朝向目标
        ctx.rotate(this.rotation + leanAngle);

        // 仅绘制精灵图（去掉阴影、速度线、攻击红光）
        if (this._sprite && this._sprite.complete && this._sprite.naturalWidth > 0) {
            ctx.save();
            ctx.translate(0, swayX); // 左右摆动
            ctx.scale(scaleX, scaleY);
            ctx.translate(0, bounceY);
            // 图片是俯视的，头部朝上（-y方向），旋转 +90° 让头部朝 +x（目标方向）
            ctx.rotate(+Math.PI / 2);
            const w = 54, h = 54;
            ctx.drawImage(this._sprite, -w/2, -h/2, w, h);
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
        ctx.fillText(this.name, x, y - 40);
        this.renderCollisionRadius(ctx);
    }
}
class BigBoss extends Enemy {
    constructor(x, y) {
        super(x, y, {
            name: '大块头',
            hp: 8000, maxHp: 8000,
            size: 40, collisionRadius: 36,
            speed: 35.1,
            level: 20,
            showWeapon: false,
            color: '#2a5a2a',
            highlightColor: 'rgba(60, 140, 60, 0.3)',
            str: 90, dex: 45, con: 75, int: 3, wis: 5, luck: 3
        });
        this._rank = 'area_boss';
        this.attacks = {
            melee: new ThrustAttack({
                cooldown: 1500, range: 90, width: 40,
                damage: { min: 45, max: 75 },
                knockback: 20
            })
        };
        this.attackRange = 90;
        this.aiInterval = 500;

        // Scale combat stats: def/mdef 1.25x, atk 3x of FatZombie
        this.calculateCombatStats();
        this.data.atk = 51;
        this.data.def = 91;
        this.data.mdef = 6;

        // Skill system
        this._skillState = 'idle';
        this._skillTimer = 0;
        this._skillCooldowns = {
            fanAttack: 0,
            dash: 0,
            summon: 0
        };
        this._dashTargetX = 0;
        this._dashTargetY = 0;
        this._dashDistance = 0;
        this._dashMaxDistance = 0;
        this._dashDirX = 0;
        this._dashDirY = 0;
        this._dashHit = false;
        this._originalCollisionRadius = this.collisionRadius;
    }

    update(dt, entities) {
        // Update skill cooldowns
        this._skillCooldowns.fanAttack = Math.max(0, this._skillCooldowns.fanAttack - dt);
        this._skillCooldowns.dash = Math.max(0, this._skillCooldowns.dash - dt);
        this._skillCooldowns.summon = Math.max(0, this._skillCooldowns.summon - dt);

        // Find target
        if (!this.target) {
            entities.forEach(e => { if (e._faction === 'player') this.target = e; });
        }

        if (!this.target || !this.target.active) {
            super.update(dt, entities);
            return;
        }

        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.rotation = Math.atan2(dy, dx);

        // State machine
        if (this._skillState === 'idle') {
            // Check skills: dash > fan > summon > normal
            if (this._skillCooldowns.dash <= 0 && dist <= 800) {
                this._startDashCharge();
                this._updateBasic(dt);
                return;
            } else if (this._skillCooldowns.fanAttack <= 0 && dist <= 150) {
                this._startFanCharge();
                this._updateBasic(dt);
                return;
            } else if (this._skillCooldowns.summon <= 0) {
                this._startSummon();
                this._updateBasic(dt);
                return;
            }
            // Normal behavior
            super.update(dt, entities);
        } else if (this._skillState === 'charging_fan') {
            this._skillTimer += dt;
            if (this._skillTimer >= 1500) {
                this._executeFanAttack(entities);
            }
            this.isMoving = false;
            this.vx = 0;
            this.vy = 0;
            this._updateBasic(dt);
        } else if (this._skillState === 'charging_dash') {
            this._skillTimer += dt;
            if (this._skillTimer >= 1500) {
                this._startDash();
            }
            this.isMoving = false;
            this.vx = 0;
            this.vy = 0;
            this._updateBasic(dt);
        } else if (this._skillState === 'dashing') {
            this._updateDash(dt, entities);
            this._updateBasic(dt);
        } else if (this._skillState === 'summoning') {
            this._skillTimer += dt;
            if (this._skillTimer >= 1500) {
                this._executeSummon(entities);
            }
            this.isMoving = false;
            this.vx = 0;
            this.vy = 0;
            this._updateBasic(dt);
        } else if (this._skillState === 'fan_attack') {
            this._skillState = 'idle';
            this._updateBasic(dt);
        }
    }

    _updateBasic(dt) {
        // Update hitFlash
        if (this.hitFlash > 0) {
            this.hitFlash = Math.max(0, this.hitFlash - dt);
        }
        // Update dash stun
        if (this._dashStunned) {
            this._dashStunTimer -= dt;
            if (this._dashStunTimer <= 0) {
                this._dashStunned = false;
            }
        }
        // Update attack cooldowns
        if (this.attacks.melee) this.attacks.melee.update(dt);
        if (this.attacks.ranged) this.attacks.ranged.update(dt);
        // Update weapon animation
        this.updateWeaponAnim(dt);
        // Update status effects
        this._updatePoison(dt);
        this._updateBleed(dt);
        this._updateMagicVulnerability(dt);
        this._updateDroneVulnerability(dt);
    }

    _startFanCharge() {
        this._skillState = 'charging_fan';
        this._skillTimer = 0;
    }

    _executeFanAttack(entities) {
        const range = 150;
        const arc = 120 * Math.PI / 180;
        const attackAngle = this.rotation;
        const originX = this.x;
        const originY = this.y;

        // Visual effect
        EffectManager.add(new AttackRangeEffect(originX, originY, attackAngle, range, arc, 'sector', 500));

        // Damage: attack power × 2
        const baseDamage = Math.floor((this.attacks.melee.config.damage.min + this.attacks.melee.config.damage.max) / 2);
        const damage = baseDamage * 2;

        entities.forEach(entity => {
            if (entity === this || !entity.active || !entity.hittable) return;
            if (this._faction === 'enemy' && entity._faction === 'enemy') return;
            if (MathUtils.pointInSector(entity.x, entity.y, originX, originY, attackAngle, range, arc)) {
                entity.takeDamage(damage, this, 'physical');
                entity.applyKnockback(attackAngle, 30);
            }
        });

        this._skillState = 'fan_attack';
        this._skillCooldowns.fanAttack = 6000;
    }

    _startDashCharge() {
        this._skillState = 'charging_dash';
        this._skillTimer = 0;
        this._dashTargetX = this.target.x;
        this._dashTargetY = this.target.y;
        this._dashHit = false;
    }

    _startDash() {
        this._skillState = 'dashing';
        this._skillTimer = 0;
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        this._dashMaxDistance = Math.sqrt(dx * dx + dy * dy);
        this._dashDistance = 0;
        this._dashDirX = dx / Math.max(this._dashMaxDistance, 1);
        this._dashDirY = dy / Math.max(this._dashMaxDistance, 1);
        this.rotation = Math.atan2(dy, dx);
        this.collisionRadius += 50;
    }

    _updateDash(dt, entities) {
        const dashSpeed = 800;
        const moveDist = dashSpeed * (dt / 1000);
        this._dashDistance += moveDist;

        const newX = this.x + this._dashDirX * moveDist;
        const newY = this.y + this._dashDirY * moveDist;

        // Wall collision
        let wallHit = false;
        if (typeof WallSystem !== 'undefined') {
            const er = WallSystem.resolve(this.x, this.y, newX, newY, this.collisionRadius);
            if (er.x !== newX || er.y !== newY) {
                wallHit = true;
            }
            this.x = er.x;
            this.y = er.y;
        } else {
            this.x = newX;
            this.y = newY;
        }

        // Check collision with target
        if (!this._dashHit && this.target && this.target.active) {
            const tdx = this.target.x - this.x;
            const tdy = this.target.y - this.y;
            const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
            const collisionDist = this.collisionRadius + (this.target.collisionRadius || this.target.size || 0);
            if (tdist <= collisionDist) {
                const baseDamage = Math.floor((this.attacks.melee.config.damage.min + this.attacks.melee.config.damage.max) / 2);
                const damage = baseDamage * 3;
                this.target.takeDamage(damage, this, 'physical');
                EffectManager.add(new FloatingTextEffect(this.target.x, this.target.y - 20, '冲锋命中！', '#ff4444'));
                this._dashHit = true;
            }
        }

        // End dash if reached target or hit wall
        if (this._dashDistance >= this._dashMaxDistance || wallHit) {
            this._skillState = 'idle';
            this._skillCooldowns.dash = 25000;
            this.vx = 0;
            this.vy = 0;
            this.collisionRadius = this._originalCollisionRadius;
        }
    }

    _startSummon() {
        this._skillState = 'summoning';
        this._skillTimer = 0;
    }

    _executeSummon(entities) {
        for (let i = 0; i < 2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 30 + Math.random() * 40;
            const sx = this.x + Math.cos(angle) * dist;
            const sy = this.y + Math.sin(angle) * dist;
            const runner = new RunnerZombie(sx, sy);
            if (typeof Game !== 'undefined' && Game.entities) {
                Game.entities.set(`runner_summon_${Date.now()}_${i}_${Math.random()}`, runner);
            }
        }
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 50, '大块头召唤了奔跑僵尸！', '#ff4444'));
        this._skillState = 'idle';
        this._skillCooldowns.summon = 60000;
    }

    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y + Math.sin(this.animTime) * 1.5;
        this.renderHealthBar(ctx);

        const phaserScene = window.__phaserScene;
        // 只有当 Phaser 就绪且 enemy_big_boss 纹理存在时才使用 Phaser 渲染
        const usePhaser = phaserScene && phaserScene.textures && phaserScene.textures.exists('enemy_big_boss');
        if (usePhaser) {
            const sprite = phaserScene.getOrCreateEnemySprite(this, 'enemy_big_boss');
            if (!this.active) {
                sprite.setVisible(false);
                return;
            }
            const spriteSize = this.size * 3.5;
            sprite.setPosition(this.x, this.y);
            sprite.setRotation(this.rotation + Math.PI / 2);
            const sourceImage = sprite.texture.getSourceImage();
            const originalWidth = sourceImage ? sourceImage.width : 64;
            const scale = spriteSize / originalWidth;
            sprite.setScale(scale);
            sprite.setVisible(true);

            // Draw skill effects on top of Phaser
            if (this._skillState === 'charging_fan') {
                this._renderChargingFan(ctx, x, y);
            } else if (this._skillState === 'charging_dash') {
                this._renderChargingDash(ctx, x, y);
            }

            ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
            ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, x, y - 52);
            this.renderCollisionRadius(ctx);
            return;
        }

        ctx.save(); ctx.translate(x, y);

        // Charging dash red overlay
        if (this._skillState === 'charging_dash') {
            const alpha = 0.3 + Math.sin(Date.now() / 100) * 0.2;
            ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
            ctx.beginPath(); ctx.arc(0, 0, this.size + 5, 0, Math.PI * 2); ctx.fill();
        }

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 22, 22, 11, 0, 0, Math.PI*2); ctx.fill();
        // Body (dark green)
        ctx.fillStyle = '#2a5a2a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
        // Highlight
        ctx.fillStyle = 'rgba(60, 140, 60, 0.3)'; ctx.beginPath(); ctx.arc(-6, -6, this.size * 0.5, 0, Math.PI*2); ctx.fill();
        // Eyes
        ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(-8, -5, 3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(8, -5, 3, 0, Math.PI*2); ctx.fill();
        // Mouth
        ctx.fillStyle = '#1a3a1a'; ctx.beginPath(); ctx.arc(0, 8, 5, 0, Math.PI); ctx.fill();

        ctx.restore();

        // Charging fan sector
        if (this._skillState === 'charging_fan') {
            this._renderChargingFan(ctx, x, y);
        }

        // Charging dash arrow
        if (this._skillState === 'charging_dash') {
            this._renderChargingDash(ctx, x, y);
        }

        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
        ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, x, y - 52);
        this.renderCollisionRadius(ctx);

        // Dash red trail
        if (this._skillState === 'dashing') {
            ctx.fillStyle = 'rgba(255, 50, 50, 0.3)';
            ctx.beginPath(); ctx.arc(x, y, this.size + 3, 0, Math.PI * 2); ctx.fill();
        }
    }

    _renderChargingFan(ctx, x, y) {
        const range = 150;
        const arc = 120 * Math.PI / 180;
        const attackAngle = this.rotation;
        const alpha = 0.2 + Math.sin(Date.now() / 150) * 0.15;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(attackAngle);
        ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, range, -arc / 2, arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 100, 100, ${alpha + 0.2})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    _renderChargingDash(ctx, x, y) {
        if (!this.target) return;
        const targetPos = Renderer.worldToScreen(this.target.x, this.target.y);
        const dx = targetPos.x - x;
        const dy = targetPos.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;
        const dirX = dx / dist;
        const dirY = dy / dist;
        const arrowLen = dist; // 直接连接到目标位置
        const endX = x + dirX * arrowLen;
        const endY = y + dirY * arrowLen;

        const alpha = 0.5 + Math.sin(Date.now() / 100) * 0.3;
        ctx.save();
        ctx.strokeStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        const arrowSize = 8;
        const angle = Math.atan2(dirY, dirX);
        ctx.fillStyle = `rgba(255, 50, 50, ${alpha + 0.2})`;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}
