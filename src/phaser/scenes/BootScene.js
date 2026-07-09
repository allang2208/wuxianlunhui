// ============================================================
// BootScene - 预加载场景：加载所有游戏资源
// ============================================================
import { Scene } from 'phaser';
import { getWeaponTextureLoadList } from '../../config/weapon-texture-map.js';

export class BootScene extends Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        console.log('[BootScene] Preloading assets...');

        // ---- 角色资源 ----
        // 待机动画（单帧）
        this.load.image('player_idle', 'assets/character/idle.png');
        // 行走动画spritesheet（21帧，3x8网格，每帧512x516）
        this.load.spritesheet('player_walk', 'assets/character/walk.png', { frameWidth: 512, frameHeight: 516, endFrame: 20 });
        // 奔跑动画spritesheet（16帧，2x8网格，每帧512x512）
        this.load.spritesheet('player_run', 'assets/character/running.png', { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        // 剑攻击spritesheet（8帧）
        this.load.spritesheet('player_attack_sword', 'assets/player/attack_sword.png', { frameWidth: 512, frameHeight: 1548, endFrame: 7 });
        // 待机动画（单帧）
        this.load.image('player_idle', 'assets/character/idle.png');
        // 行走动画spritesheet（21帧，3x8网格，每帧512x516）
        this.load.spritesheet('player_walk', 'assets/character/walk.png', { frameWidth: 512, frameHeight: 516, endFrame: 20 });
        // 奔跑动画spritesheet（16帧，2x8网格，每帧512x512）
        this.load.spritesheet('player_run', 'assets/character/running.png', { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        // 剑攻击spritesheet（8帧）
        this.load.spritesheet('player_attack_sword', 'assets/player/attack_sword.png', { frameWidth: 512, frameHeight: 1548, endFrame: 7 });
        // 待机、奔跑、攻击精灵图
        this.load.image('player_idle', 'assets/player/idle.png');
        this.load.image('player_running', 'assets/player/running.png');
        // 剑攻击spritesheet（8帧）
        this.load.spritesheet('player_attack_sword', 'assets/player/attack_sword.png', { frameWidth: 512, frameHeight: 1548, endFrame: 7 });
        // 剑攻击spritesheet（8帧）- 目前唯一使用的角色动画资源
        this.load.spritesheet('player_attack_sword', 'assets/player/attack_sword.png', { frameWidth: 512, frameHeight: 1548, endFrame: 7 });

        // ---- 武器资源 ----
        const weaponTextures = getWeaponTextureLoadList();
        for (const { key, path } of weaponTextures) {
            this.load.image(key, path);
        }

        // ---- 特效资源 ----
        this.load.image('runeSwordBlade', 'assets/weapons/blue_energy_sword_pure.png');
        this.load.image('iceSpike', 'assets/skills/icearrow.png');
        this.load.spritesheet('fireball', 'assets/skills/fireball_spritesheet.png', { frameWidth: 480, frameHeight: 480, endFrame: 8 });
        // this.load.spritesheet('bow_attack', 'assets/weapons/borderbowspritesheet.png', { frameWidth: 1024, frameHeight: 1024, endFrame: 3 }); // 弓攻击spritesheet已停用
        this.load.image('drone', 'assets/skills/drone.png');

        // ---- 敌人资源 ----
        this.load.image('enemy_spider', 'assets/enemies/spider.png');
        this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_black_wolf_pacing', 'assets/enemies/black_wolf_pacing.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_black_wolf_attack', 'assets/enemies/black_wolf_attack.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.image('enemy_black_wolf_idle', 'assets/enemies/black_wolf_idle.png');
        this.load.spritesheet('enemy_red_wolf_king', 'assets/enemies/red_wolf_king_run.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_red_wolf_king_pacing', 'assets/enemies/red_wolf_king_pacing.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_red_wolf_king_attack', 'assets/enemies/red_wolf_king_attack.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.image('enemy_red_wolf_king_idle', 'assets/enemies/red_wolf_king_idle.png');
        this.load.spritesheet('enemy_red_wolf_king_change', 'assets/enemies/red_wolf_king_change.png', { frameWidth: 672, frameHeight: 576, endFrame: 7 });
        this.load.spritesheet('enemy_red_wolf_king_howl', 'assets/enemies/red_wolf_king_howl.png', { frameWidth: 672, frameHeight: 576, endFrame: 7 });
        this.load.spritesheet('enemy_red_wolf_king_changed_run', 'assets/enemies/red_wolf_king_run.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_red_wolf_king_changed_idle', 'assets/enemies/red_wolf_king_transformed_idle.png', { frameWidth: 672, frameHeight: 576, endFrame: 7 });

        // ---- 环境资源 ----

        // ---- 特效资源 ----
        // 粒子用程序化生成，暂不需要加载图片

        // ---- 加载进度提示 ----
        this.load.on('progress', (value) => {
            console.log(`[BootScene] Loading progress: ${Math.floor(value * 100)}%`);
        });

        this.load.on('complete', () => {
            console.log('[BootScene] All assets loaded');
        });
    }

    create() {
        console.log('[BootScene] Creating animations...');

        // 创建行走动画（21帧）
        this.anims.create({
            key: 'player_walk',
            frames: this.anims.generateFrameNumbers('player_walk', { start: 0, end: 20 }),
            frameRate: 21,  // 21fps，1秒播放完
            repeat: -1,     // 循环播放
        });

        // 创建奔跑动画（16帧）
        this.anims.create({
            key: 'player_run',
            frames: this.anims.generateFrameNumbers('player_run', { start: 0, end: 15 }),
            frameRate: 16,  // 16fps，1秒播放完
            repeat: -1,     // 循环播放
        });

        // 创建剑攻击动画（8帧）
        this.anims.create({
            key: 'player_attack_sword',
            frames: this.anims.generateFrameNumbers('player_attack_sword', { start: 0, end: 7 }),
            frameRate: 12,  // 12fps，总时长约667ms
            repeat: 0,      // 播放一次
        });
        this.anims.create({
            key: 'player_attack_sword',
            frames: this.anims.generateFrameNumbers('player_attack_sword', { start: 0, end: 7 }),
            frameRate: 12,  // 12fps，总时长约667ms
            repeat: 0,      // 播放一次
        });

        // ---- 动态生成几何敌人纹理 ----
        const generateEnemyTexture = (key, drawFn) => {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            drawFn(g);
            g.generateTexture(key, 64, 64);
            g.destroy();
        };

        // Zombie
        generateEnemyTexture('enemy_zombie', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 42, 20, 10);
            g.fillStyle(0x5a8a4a, 1);
            g.fillCircle(32, 32, 14);
            g.fillStyle(0x5ac85a, 0.3);
            g.fillCircle(29, 29, 7);
            g.fillStyle(0xff3333, 1);
            g.fillCircle(28, 30, 2);
            g.fillCircle(36, 30, 2);
        });

        // RunnerZombie
        generateEnemyTexture('enemy_runner_zombie', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 42, 16, 8);
            g.fillStyle(0xa03030, 1);
            g.fillCircle(32, 32, 12);
            g.fillStyle(0xff7878, 0.3);
            g.fillCircle(29, 29, 6);
            g.fillStyle(0xff6600, 1);
            g.fillCircle(29, 30, 2.5);
            g.fillCircle(35, 30, 2.5);
            g.lineStyle(2, 0xff6464, 0.4);
            g.lineBetween(20, 28, 12, 30);
            g.lineBetween(20, 34, 14, 35);
        });

        // FatZombie
        generateEnemyTexture('enemy_fat_zombie', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 46, 28, 14);
            g.fillStyle(0x8B4513, 1);
            g.fillCircle(32, 32, 20);
            g.fillStyle(0xa07850, 0.3);
            g.fillCircle(28, 28, 10);
            g.fillStyle(0xffcc00, 1);
            g.fillCircle(27, 29, 2);
            g.fillCircle(37, 29, 2);
            g.fillStyle(0x3a1a0a, 1);
            g.fillCircle(32, 38, 4);
        });

        // SpitterZombie
        generateEnemyTexture('enemy_spitter_zombie', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 42, 18, 9);
            g.fillStyle(0x8a30a0, 1);
            g.fillCircle(32, 32, 13);
            g.fillStyle(0xb464dc, 0.3);
            g.fillCircle(29, 29, 6.5);
            g.fillStyle(0x00ff44, 1);
            g.fillCircle(28, 30, 2);
            g.fillCircle(36, 30, 2);
            g.fillStyle(0x00ff64, 0.6);
            g.fillCircle(32, 38, 2);
        });

        // BabySpider
        generateEnemyTexture('enemy_baby_spider', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 40, 16, 8);
            g.fillStyle(0x8B4513, 1);
            g.fillCircle(32, 32, 14);
            g.fillStyle(0xa07850, 0.3);
            g.fillCircle(29, 29, 7);
            g.fillStyle(0x1a1a1a, 1);
            g.fillCircle(29, 30, 1.5);
            g.fillCircle(35, 30, 1.5);
        });

        // WolfSpider
        generateEnemyTexture('enemy_wolf_spider', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 44, 24, 12);
            g.fillStyle(0x4a2060, 1);
            g.fillCircle(32, 32, 23);
            g.fillStyle(0x783c50, 0.3);
            g.fillCircle(28, 28, 11.5);
            g.fillStyle(0xcc2222, 1);
            g.fillCircle(27, 29, 2.5);
            g.fillCircle(37, 29, 2.5);
            g.fillStyle(0xaa5555, 1);
            g.fillTriangle(29, 36, 31, 39, 27, 39);
            g.fillTriangle(35, 36, 37, 39, 33, 39);
        });

        // BroodmotherSpider
        generateEnemyTexture('enemy_broodmother_spider', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 50, 36, 18);
            g.fillStyle(0x1a1a1a, 1);
            g.fillCircle(32, 32, 40);
            g.fillStyle(0x502840, 0.3);
            g.fillCircle(26, 26, 20);
            g.fillStyle(0xcc0000, 1);
            g.fillCircle(24, 27, 4);
            g.fillCircle(40, 27, 4);
            g.fillStyle(0xff3232, 0.5);
            g.fillCircle(26, 25, 1.5);
            g.fillCircle(42, 25, 1.5);
        });

        // SkeletonWarrior
        generateEnemyTexture('enemy_skeleton_warrior', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 42, 20, 10);
            g.fillStyle(0xe0e0e0, 1);
            g.fillCircle(32, 32, 16);
            g.fillStyle(0xc8c8a0, 0.3);
            g.fillCircle(29, 29, 8);
            g.fillStyle(0xcc2222, 1);
            g.fillCircle(28, 30, 2);
            g.fillCircle(36, 30, 2);
        });

        // SkeletonArcher
        generateEnemyTexture('enemy_skeleton_archer', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 42, 18, 9);
            g.fillStyle(0xe0e0d0, 1);
            g.fillCircle(32, 32, 15);
            g.fillStyle(0xb4b496, 0.3);
            g.fillCircle(29, 29, 7.5);
            g.fillStyle(0x00ff44, 1);
            g.fillCircle(28, 30, 2);
            g.fillCircle(36, 30, 2);
        });

        // SkeletonDog
        generateEnemyTexture('enemy_skeleton_dog', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 42, 20, 10);
            g.fillStyle(0xd0d0d0, 1);
            g.fillCircle(32, 32, 21);
            g.fillStyle(0xb4b4b4, 0.3);
            g.fillCircle(29, 29, 10.5);
            g.fillStyle(0xff6600, 1);
            g.fillCircle(28, 30, 2.5);
            g.fillCircle(36, 30, 2.5);
            g.lineStyle(2, 0xff6464, 0.4);
            g.lineBetween(20, 28, 12, 30);
            g.lineBetween(20, 34, 14, 35);
        });

        // Necromancer
        generateEnemyTexture('enemy_necromancer', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 44, 24, 12);
            g.fillStyle(0x6a3090, 1);
            g.fillCircle(32, 32, 25);
            g.fillStyle(0x64508c, 0.3);
            g.fillCircle(28, 28, 12.5);
            g.fillStyle(0xcc2222, 1);
            g.fillCircle(27, 29, 2.5);
            g.fillCircle(37, 29, 2.5);
            g.lineStyle(2, 0xaa55ff, 0.3);
            g.strokeCircle(32, 32, 33);
        });

        // DeathKnight
        generateEnemyTexture('enemy_death_knight', (g) => {
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(32, 50, 36, 18);
            g.fillStyle(0x8B0000, 1);
            g.fillCircle(32, 32, 45);
            g.fillStyle(0x783232, 0.3);
            g.fillCircle(26, 26, 22.5);
            g.fillStyle(0xcc0000, 1);
            g.fillCircle(24, 27, 4);
            g.fillCircle(40, 27, 4);
            g.fillStyle(0xff3232, 0.5);
            g.fillCircle(26, 25, 1.5);
            g.fillCircle(42, 25, 1.5);
            g.lineStyle(2, 0xb42828, 0.3);
            g.strokeCircle(32, 32, 53);
        });

        // 切换到主游戏场景
        this.scene.start('GameScene');
    }
}
