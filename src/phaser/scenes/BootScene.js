
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
        

        // 资源加载失败时打印日志，方便排查贴图黑块/丢失问题
        this.load.on('loaderror', (file) => {
            console.warn('[BootScene] 资源加载失败:', file?.key, file?.url);
        });

        // ---- 角色资源 ----
        // 待机动画（单帧）
        this.load.image('player_idle', 'assets/player/idle.png');
        // 行走动画spritesheet（21帧，3x8网格，实际尺寸4100x1548，每帧512x516）
        this.load.spritesheet('player_walk', 'assets/character/walk.png', { frameWidth: 512, frameHeight: 516, endFrame: 20 });
        // 奔跑动画spritesheet（16帧，2x8网格，实际尺寸4096x1024，每帧512x512）
        this.load.spritesheet('player_run', 'assets/character/running.png', { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        // 剑攻击spritesheet（8帧，实际尺寸4100x1548，每帧512x516）
        this.load.spritesheet('player_attack_sword', 'assets/player/attack_sword.png', { frameWidth: 512, frameHeight: 516, endFrame: 7 });

        // ---- 武器资源 ----
        const weaponTextures = getWeaponTextureLoadList();
        for (const { key, path } of weaponTextures) {
            this.load.image(key, path);
        }

        // ---- 特效资源 ----
        this.load.image('runeSwordBlade', 'assets/weapons/blue_energy_sword_pure.png');
        this.load.image('iceSpike', 'assets/skills/icearrow.png');
        this.load.spritesheet('fireball', 'assets/skills/fireball_spritesheet.png', { frameWidth: 480, frameHeight: 480, endFrame: 72 });
        this.load.image('blackbrick2', 'assets/terrain/blackbrick2.png');
        this.load.image('blackbrick3', 'assets/terrain/blackbrick3.png');
        this.load.image('drone', 'assets/skills/drone.png');

        // ---- 敌人资源 ----
        // 蜘蛛与黑狼保留，其它敌人使用程序化 enemy_circle
        this.load.image('enemy_spider', 'assets/enemies/spider.png');
        this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_black_wolf_pacing', 'assets/enemies/black_wolf_pacing.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.spritesheet('enemy_black_wolf_attack', 'assets/enemies/black_wolf_attack.png', { frameWidth: 250, frameHeight: 215, endFrame: 7 });
        this.load.image('enemy_black_wolf_idle', 'assets/enemies/black_wolf_idle.png');

        // 僵尸犬精灵图动画
        this.load.image('enemy_zombie_dog_idle', 'assets/enemies/zombie_dog_idle.png');
        this.load.spritesheet('enemy_zombie_dog_walk', 'assets/enemies/zombie_dog_walk.png', { frameWidth: 512, frameHeight: 512, endFrame: 7 });
        this.load.spritesheet('enemy_zombie_dog_run', 'assets/enemies/zombie_dog_run.png', { frameWidth: 512, frameHeight: 512, endFrame: 4 });
        this.load.spritesheet('enemy_zombie_dog_attack', 'assets/enemies/zombie_dog_attack.png', { frameWidth: 512, frameHeight: 512, endFrame: 5 });

        // 僵尸巫师精灵图动画（3×8 网格）
        this.load.spritesheet('enemy_zombie_wizard_idle', 'assets/enemies/zombie_wizard/idle.png', { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_zombie_wizard_walk', 'assets/enemies/zombie_wizard/walking.png', { frameWidth: 512, frameHeight: 512, endFrame: 9 });
        this.load.spritesheet('enemy_zombie_wizard_attack', 'assets/enemies/zombie_wizard/attacking.png', { frameWidth: 512, frameHeight: 512, endFrame: 10 });
        this.load.spritesheet('enemy_zombie_wizard_summon', 'assets/enemies/zombie_wizard/summoning.png', { frameWidth: 512, frameHeight: 512, endFrame: 6 });

        // 突变体-3 精灵图动画（3×8 网格）
        this.load.spritesheet('enemy_mutant3_idle', 'assets/enemies/mutant3/idle.png', { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_mutant3_walk', 'assets/enemies/mutant3/running.png', { frameWidth: 512, frameHeight: 512, endFrame: 9 });
        this.load.spritesheet('enemy_mutant3_attack', 'assets/enemies/mutant3/attacking.png', { frameWidth: 512, frameHeight: 512, endFrame: 20 });
        this.load.spritesheet('enemy_mutant3_attack_normal', 'assets/enemies/mutant3/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 21 });

        // 毒液僵尸精灵图动画（3×8 网格）
        this.load.spritesheet('enemy_spitter_zombie_idle', 'assets/enemies/spitter_zombie/idle.png', { frameWidth: 512, frameHeight: 512, endFrame: 23 });
        this.load.spritesheet('enemy_spitter_zombie_walk', 'assets/enemies/spitter_zombie/walking.png', { frameWidth: 512, frameHeight: 512, endFrame: 12 });
        this.load.spritesheet('enemy_spitter_zombie_attack', 'assets/enemies/spitter_zombie/attacking.png', { frameWidth: 512, frameHeight: 512, endFrame: 21 });
        this.load.image('projectile_poison', 'assets/enemies/spitter_zombie/project.png');

        // 胖子僵尸精灵图动画（实际尺寸：idle 4096x2048 / walking 4100x1536 / attacking 4100x1536 / melting 4096x2048，均按 512x512 切帧）
        this.load.spritesheet('enemy_fat_zombie_idle',   'assets/enemies/fat_zombie/idle.png',     { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_fat_zombie_walk',   'assets/enemies/fat_zombie/walking.png',  { frameWidth: 512, frameHeight: 512, endFrame: 10 });
        this.load.spritesheet('enemy_fat_zombie_attack', 'assets/enemies/fat_zombie/attacking.png',{ frameWidth: 512, frameHeight: 512, endFrame: 13 });
        this.load.spritesheet('enemy_fat_zombie_melt',   'assets/enemies/fat_zombie/melting.png',  { frameWidth: 512, frameHeight: 512, endFrame: 20 });

        // 普通僵尸精灵图动画（8×4 网格 512×512 切帧：idle 1 帧 / walking 15 帧 / attacking 15 帧）
        this.load.spritesheet('enemy_zombie_idle',   'assets/enemies/zombie/idle.png',     { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_zombie_walk',   'assets/enemies/zombie/walking.png',  { frameWidth: 512, frameHeight: 512, endFrame: 14 });
        this.load.spritesheet('enemy_zombie_attack', 'assets/enemies/zombie/attacking.png',{ frameWidth: 512, frameHeight: 512, endFrame: 14 });

        // 集合体（首领）精灵图动画（8×4 网格 512×512 切帧：idle 14 帧 / 砸地 32 帧 / 投掷 25 帧 / 死亡 28 帧）
        this.load.spritesheet('enemy_amalgam_idle',         'assets/enemies/amalgam/idle.png',         { frameWidth: 512, frameHeight: 512, endFrame: 13 });
        this.load.spritesheet('enemy_amalgam_attack_slam',  'assets/enemies/amalgam/attacking.png',    { frameWidth: 512, frameHeight: 512, endFrame: 31 });
        this.load.spritesheet('enemy_amalgam_attack_throw', 'assets/enemies/amalgam/attacking-2.png',  { frameWidth: 512, frameHeight: 512, endFrame: 24 });
        this.load.spritesheet('enemy_amalgam_melt',         'assets/enemies/amalgam/melting.png',      { frameWidth: 512, frameHeight: 512, endFrame: 27 });
        this.load.image('enemy_amalgam_project', 'assets/enemies/amalgam/project.png');

        // 铠甲骑士（精英）精灵图动画（8×4 网格 512×512 切帧：待机 1 帧 / 移动 11 帧 / 二连击 32 帧 / 冲锋 19 帧 / 格挡 14 帧）
        this.load.spritesheet('enemy_armored_knight_idle',    'assets/enemies/armored_knight/idle.png',        { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_armored_knight_walk',    'assets/enemies/armored_knight/walking.png',     { frameWidth: 512, frameHeight: 512, endFrame: 10 });
        this.load.spritesheet('enemy_armored_knight_combo',   'assets/enemies/armored_knight/attacking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 31 });
        this.load.spritesheet('enemy_armored_knight_charge',  'assets/enemies/armored_knight/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 18 });
        this.load.spritesheet('enemy_armored_knight_defend',  'assets/enemies/armored_knight/defending.png',   { frameWidth: 512, frameHeight: 512, endFrame: 13 });

        // ---- 环境资源 ----

        // ---- 特效资源 ----
        this.load.image('muzzle_flash_01', 'assets/effects/muzzle_flash_01.png');
        this.load.image('shell_ground', 'assets/ammo/shell_ground.png');
        this.load.image('sword_hilt_icon', 'assets/icons/sword_hilt_icon.png');
        this.load.image('blackbrick', 'assets/terrain/blackbrick.png');
        // 粒子用程序化生成，暂不需要加载图片

    }

    create() {
        

        // 创建行走动画：使用完整 21 帧 spritesheet（3x8 网格），通过 flipX 控制左右
        this.anims.create({
            key: 'player_walk',
            frames: this.anims.generateFrameNumbers('player_walk', { start: 0, end: 20 }),
            frameRate: 24,
            repeat: -1,
        });

        // 创建奔跑动画：侧视角，只使用 spritesheet 第一行（向右），通过 flipX 控制左右
        this.anims.create({
            key: 'player_run',
            frames: this.anims.generateFrameNumbers('player_run', { start: 0, end: 7 }),
            frameRate: 10,
            repeat: -1,
        });

        // 创建剑攻击动画（8帧）
        this.anims.create({
            key: 'player_attack_sword',
            frames: this.anims.generateFrameNumbers('player_attack_sword', { start: 0, end: 7 }),
            frameRate: 12,  // 12fps，总时长约667ms
            repeat: 0,      // 播放一次
        });

        // 僵尸犬动画
        this.anims.create({
            key: 'zombie_dog_idle',
            frames: [{ key: 'enemy_zombie_dog_idle', frame: 0 }],
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'zombie_dog_walk',
            frames: this.anims.generateFrameNumbers('enemy_zombie_dog_walk', { start: 0, end: 7 }),
            frameRate: 8,
            repeat: -1,
        });
        this.anims.create({
            key: 'zombie_dog_run',
            frames: this.anims.generateFrameNumbers('enemy_zombie_dog_run', { start: 0, end: 4 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: 'zombie_dog_attack',
            frames: this.anims.generateFrameNumbers('enemy_zombie_dog_attack', { start: 0, end: 5 }),
            frameRate: 10,
            repeat: 0,
        });

        // 僵尸巫师动画
        this.anims.create({
            key: 'enemy_zombie_wizard_idle',
            frames: this.anims.generateFrameNumbers('enemy_zombie_wizard_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_zombie_wizard_walk',
            frames: this.anims.generateFrameNumbers('enemy_zombie_wizard_walk', { start: 0, end: 9 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_zombie_wizard_attack',
            frames: this.anims.generateFrameNumbers('enemy_zombie_wizard_attack', { start: 0, end: 10 }),
            duration: 600,
            repeat: 0,
        });
        const summonFrames = this.anims.generateFrameNumbers('enemy_zombie_wizard_summon', { start: 0, end: 6 });
        this.anims.create({
            key: 'enemy_zombie_wizard_summon',
            frames: summonFrames,
            frameRate: 7,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_zombie_wizard_summon_reverse',
            frames: [...summonFrames].reverse(),
            frameRate: 7,
            repeat: 0,
        });

        // 突变体-3 动画
        this.anims.create({
            key: 'enemy_mutant3_idle',
            frames: this.anims.generateFrameNumbers('enemy_mutant3_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_mutant3_walk',
            frames: this.anims.generateFrameNumbers('enemy_mutant3_walk', { start: 0, end: 9 }),
            frameRate: 10,
            repeat: -1,
        });
        // 普通 5 连击动画（22 帧，1.5s）
        this.anims.create({
            key: 'enemy_mutant3_attack_normal',
            frames: this.anims.generateFrameNumbers('enemy_mutant3_attack_normal', { start: 0, end: 21 }),
            duration: 1500,
            repeat: 0,
        });
        // 飞扑攻击：蓄力阶段播放 attacking.png 的前 8 帧，飞扑阶段继续播放后 13 帧。
        // 使用同一个动画 key 横跨两个阶段，避免进入飞扑时重新播放一次新动画。
        // 蓄力 1s + 冲锋 1s = 2s
        this.anims.create({
            key: 'enemy_mutant3_attack_pounce',
            frames: this.anims.generateFrameNumbers('enemy_mutant3_attack', { start: 0, end: 20 }),
            duration: 2000,
            repeat: 0,
        });

        // 毒液僵尸动画（24 帧待机 / 13 帧行走 / 22 帧攻击）
        this.anims.create({
            key: 'enemy_spitter_zombie_idle',
            frames: this.anims.generateFrameNumbers('enemy_spitter_zombie_idle', { start: 0, end: 23 }),
            frameRate: 8,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_spitter_zombie_walk',
            frames: this.anims.generateFrameNumbers('enemy_spitter_zombie_walk', { start: 0, end: 12 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_spitter_zombie_attack',
            frames: this.anims.generateFrameNumbers('enemy_spitter_zombie_attack', { start: 0, end: 21 }),
            duration: 1000,
            repeat: 0,
        });

        // 胖子僵尸动画
        this.anims.create({
            key: 'enemy_fat_zombie_idle',
            frames: this.anims.generateFrameNumbers('enemy_fat_zombie_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_fat_zombie_walk',
            frames: this.anims.generateFrameNumbers('enemy_fat_zombie_walk', { start: 0, end: 10 }),
            frameRate: 11,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_fat_zombie_attack',
            frames: this.anims.generateFrameNumbers('enemy_fat_zombie_attack', { start: 0, end: 13 }),
            duration: 1000,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_fat_zombie_death',
            frames: this.anims.generateFrameNumbers('enemy_fat_zombie_melt', { start: 0, end: 20 }),
            duration: 1500,
            repeat: 0,
        });

        // 普通僵尸动画（攻击动画固定 1 秒）
        this.anims.create({
            key: 'enemy_zombie_idle',
            frames: this.anims.generateFrameNumbers('enemy_zombie_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_zombie_walk',
            frames: this.anims.generateFrameNumbers('enemy_zombie_walk', { start: 0, end: 14 }),
            frameRate: 15,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_zombie_attack',
            frames: this.anims.generateFrameNumbers('enemy_zombie_attack', { start: 0, end: 14 }),
            duration: 1000,
            repeat: 0,
        });

        // 集合体（首领）动画
        this.anims.create({
            key: 'enemy_amalgam_idle',
            frames: this.anims.generateFrameNumbers('enemy_amalgam_idle', { start: 0, end: 13 }),
            frameRate: 8,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_amalgam_attack_slam',
            frames: this.anims.generateFrameNumbers('enemy_amalgam_attack_slam', { start: 0, end: 31 }),
            duration: 2000,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_amalgam_attack_throw',
            frames: this.anims.generateFrameNumbers('enemy_amalgam_attack_throw', { start: 0, end: 24 }),
            duration: 2000,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_amalgam_death',
            frames: this.anims.generateFrameNumbers('enemy_amalgam_melt', { start: 0, end: 27 }),
            duration: 2800,
            repeat: 0,
        });
        // 铠甲骑士（精英）动画
        this.anims.create({
            key: 'enemy_armored_knight_idle',
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_armored_knight_walk',
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_walk', { start: 0, end: 10 }),
            frameRate: 12,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_armored_knight_combo',
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_combo', { start: 0, end: 31 }),
            duration: 2000,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_armored_knight_charge',
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_charge', { start: 0, end: 18 }),
            duration: 1500,
            repeat: 0, // 单次播放定格：冲锋行为最长数秒，循环播放在加速完成点(1.5s)重播像"停顿重启"
        });
        this.anims.create({
            key: 'enemy_armored_knight_defend',
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_defend', { start: 0, end: 13 }),
            duration: 1500,
            repeat: 0,
        });

        // ---- 动态生成几何敌人纹理 ----
        const generateEnemyTexture = (key, drawFn, width = 64, height = 64) => {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            drawFn(g);
            g.generateTexture(key, width, height);
            g.destroy();
        };

        // 通用占位敌人：胶囊体身体 + 椭圆阴影，运行时用 tint 着色
        // 锚点 (0.5,0.5) 对应贴图中心；脚底在贴图底部 (y≈56)，与 Collider 地面圆对齐。
        generateEnemyTexture('enemy_circle', (g) => {
            const cx = 32;
            const cy = 32;
            const radius = 12;
            const innerHalf = 12; // 胶囊体总高 = 2*radius + 2*innerHalf = 48
            const topY = cy - innerHalf;
            const bottomY = cy + innerHalf;

            // 脚底椭圆阴影
            g.fillStyle(0x000000, 0.25);
            g.fillEllipse(cx, 56, 28, 10);

            // 垂直胶囊体身体
            g.fillStyle(0xffffff, 1);
            g.fillCircle(cx, topY, radius);
            g.fillCircle(cx, bottomY, radius);
            g.fillRect(cx - radius, topY, radius * 2, bottomY - topY);

            // 高光/眼睛
            g.fillStyle(0xeeeeee, 1);
            g.fillCircle(cx, topY + 4, 6);
            g.fillStyle(0x000000, 0.6);
            g.fillCircle(cx - 3, topY + 2, 2);
            g.fillCircle(cx + 3, topY + 2, 2);
        });

        // 掉落物占位纹理
        generateEnemyTexture('drop_placeholder', (g) => {
            g.fillStyle(0xc4a55a, 1);
            g.fillCircle(32, 32, 14);
            g.fillStyle(0xffd700, 0.8);
            g.fillCircle(32, 28, 6);
        });

        // 弓攻击占位纹理（解决外部弓 spritesheet 缺失）
        generateEnemyTexture('bow_attack', (g) => {
            g.fillStyle(0x8b5a2b, 1);
            g.fillRoundedRect(8, 8, 48, 48, 6);
            g.fillStyle(0xffffff, 0.8);
            g.beginPath();
            g.moveTo(24, 24);
            g.lineTo(40, 32);
            g.lineTo(24, 40);
            g.closePath();
            g.fillPath();
        });

        // 2.5D 墙壁视觉纹理
        generateEnemyTexture('wall_face', (g) => {
            g.fillStyle(0x5a5a5a, 1);
            g.fillRect(0, 0, 64, 128);
            g.fillStyle(0x6e6e6e, 1);
            g.fillRect(0, 0, 64, 4);
            g.fillStyle(0x4a4a4a, 1);
            g.fillRect(0, 124, 64, 4);
        }, 64, 128);
        generateEnemyTexture('wall_top', (g) => {
            g.fillStyle(0x6e6e6e, 1);
            g.fillRect(0, 0, 64, 8);
            g.fillStyle(0x7e7e7e, 1);
            g.fillRect(0, 0, 64, 2);
        }, 64, 8);

        // 树木视觉纹理（单张包含树干+树冠，底部居中锚点）
        generateEnemyTexture('tree_canopy', (g) => {
            g.fillStyle(0x5a3a1a, 1);
            g.fillRect(30, 64, 4, 48);
            g.fillStyle(0x4a2a0a, 1);
            g.fillRect(30, 64, 2, 48);
            g.fillStyle(0x2d8a3e, 1);
            g.fillCircle(32, 36, 30);
            g.fillStyle(0x3da84e, 0.6);
            g.fillCircle(24, 28, 14);
        }, 64, 128);
        generateEnemyTexture('tree_canopy_snow', (g) => {
            g.fillStyle(0x5a3a1a, 1);
            g.fillRect(30, 64, 4, 48);
            g.fillStyle(0x4a2a0a, 1);
            g.fillRect(30, 64, 2, 48);
            g.fillStyle(0xe0e8f0, 1);
            g.fillCircle(32, 36, 30);
            g.fillStyle(0xffffff, 0.6);
            g.fillCircle(24, 28, 14);
            g.fillStyle(0x2d8a3e, 1);
            g.fillCircle(32, 44, 22);
        }, 64, 128);

        // ---- 投射物纹理 ----
        generateEnemyTexture('projectile_arrow', (g) => {
            g.fillStyle(0xd4c5a9, 1);
            // 箭头向右，中心在 (32,32)
            g.beginPath();
            g.moveTo(44, 32);
            g.lineTo(36, 26);
            g.lineTo(36, 29);
            g.lineTo(20, 29);
            g.lineTo(20, 35);
            g.lineTo(36, 35);
            g.lineTo(36, 38);
            g.closePath();
            g.fillPath();
            g.fillStyle(0xb5a58a, 1);
            g.fillRect(20, 30, 18, 4);
        });

        generateEnemyTexture('projectile_bullet', (g) => {
            g.fillStyle(0xffffff, 1);
            g.fillCircle(32, 32, 14);
            g.fillStyle(0xeeeeee, 0.8);
            g.fillCircle(28, 28, 6);
        });

        generateEnemyTexture('projectile_spit', (g) => {
            g.fillStyle(0x00ff00, 1);
            g.fillCircle(32, 32, 24);
        });

        // 曳光弹：白色发光条，运行时通过 tint 着色
        generateEnemyTexture('projectile_tracer', (g) => {
            g.fillStyle(0xffffff, 0.2);
            g.fillRect(0, 20, 128, 24);
            g.fillStyle(0xffffff, 0.5);
            g.fillRect(0, 24, 128, 16);
            g.fillStyle(0xffffff, 0.95);
            g.fillRect(0, 28, 128, 8);
            g.fillStyle(0xffffff, 1);
            g.fillCircle(120, 32, 10);
            g.fillStyle(0xffffff, 0.7);
            g.fillCircle(120, 32, 6);
        }, 128, 64);

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
