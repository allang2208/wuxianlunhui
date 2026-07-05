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
        this.load.image('character_idle', 'assets/characters/character_idle_new.png');
        // 行走帧（24帧）- 暂时保持单文件加载，后续可合并为图集
        for (let i = 1; i <= 24; i++) {
            const num = String(i).padStart(3, '0');
            this.load.image(`walk_${num}`, `assets/characters/walk/hero_${num}.png`);
        }

        // ---- 武器资源 ----
        const weaponTextures = getWeaponTextureLoadList();
        for (const { key, path } of weaponTextures) {
            this.load.image(key, path);
        }

        // ---- 敌人资源 ----
        this.load.image('enemy_spider', 'assets/enemies/spider.png');
        this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', { frameWidth: 250, frameHeight: 215 });

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

        // 创建玩家行走动画（24帧）
        const walkFrames = [];
        for (let i = 1; i <= 24; i++) {
            walkFrames.push({ key: `walk_${String(i).padStart(3, '0')}` });
        }
        this.anims.create({
            key: 'player_walk',
            frames: walkFrames,
            frameRate: 12,  // 12fps = 每帧83ms
            repeat: -1,
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
