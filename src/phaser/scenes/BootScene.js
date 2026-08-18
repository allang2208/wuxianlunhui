
// ============================================================
// BootScene - 预加载场景：加载所有游戏资源
// ============================================================
import { Scene } from 'phaser';
import { getWeaponTextureLoadList } from '../../config/weapon-texture-map.js';
import { GAME_CONFIG } from '../../config/game-config.js';
import { loadWallPrefabs, loadObstacleLayout, loadObstacleDefaults } from '../../world/wall-prefabs.js';
import { WallSystem } from '../../world/wall-system.js';
import { PLAYER_ANIMS, playerTextureKey } from '../../config/player-anim.js';
import { TRAP_CONFIG, TRAP_GRADES } from '../../world/trap-config.js';
import companionConfigData from '../../../data/companion-config.json';
import hamsterMinerConfig from '../../../data/hamster-miner-config.json';
import hamsterWarriorConfig from '../../../data/hamster-warrior-config.json';
import hamsterShooterConfig from '../../../data/hamster-shooter-config.json';
import hamsterGuardConfig from '../../../data/hamster-guard-config.json';
import hamsterMilitiaConfig from '../../../data/hamster-militia-config.json';
import hamsterScoutConfig from '../../../data/hamster-scout-config.json';
import hamsterMusketeerConfig from '../../../data/hamster-musketeer-config.json';

export class BootScene extends Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        

        // 资源加载失败时打印日志，方便排查贴图黑块/丢失问题
        this.load.on('loaderror', (file) => {
            console.warn('[BootScene] 资源加载失败:', file?.key, file?.url);
        });

        // ---- 角色资源（配置驱动：data/player-anim-config.json，纹理键 player_<动画键>） ----
        for (const [animKey, def] of Object.entries(PLAYER_ANIMS)) {
            const texKey = playerTextureKey(animKey);
            if (def.type === 'image') {
                this.load.image(texKey, def.src);
                // 上半身分层扭转姿态（持枪瞄准）：腿层/躯干层独立贴图
                if (def.twist) {
                    this.load.image(`${texKey}_legs`, def.twist.legsSrc);
                    this.load.image(`${texKey}_torso`, def.twist.torsoSrc);
                    // 持枪移动腿层（walk/run 下半身裁片，配置驱动）
                    for (const [cfgKey, suffix] of [['walkLegs', 'walklegs'], ['runLegs', 'runlegs']]) {
                        const part = def.twist[cfgKey];
                        if (!part) continue;
                        this.load.spritesheet(`${texKey}_${suffix}`, part.src, {
                            frameWidth: part.frameWidth, frameHeight: part.frameHeight, endFrame: (part.frameCount || 1) - 1
                        });
                    }
                    // 手臂条层（单骨伪 IK，追随枪握把）
                    if (def.twist.arm) {
                        this.load.image(`${texKey}_arm`, def.twist.arm.src);
                    }
                    // 腰射→瞄准手臂帧动画（视频截取手臂条，aimFrames 配置驱动）
                    if (def.twist.aimFrames) {
                        const af = def.twist.aimFrames;
                        this.load.spritesheet(`${texKey}_aimframes`, af.src, {
                            frameWidth: af.frameWidth, frameHeight: af.frameHeight, endFrame: (af.frameCount || 1) - 1
                        });
                    }
                }
            } else if (def.type === 'sheet') {
                // endFrame 必带：防御图片高度差1像素导致帧数错误
                this.load.spritesheet(texKey, def.src, {
                    frameWidth: def.frameWidth, frameHeight: def.frameHeight, endFrame: (def.frameCount || 1) - 1
                });
                // 手部分层（handLayer，如 walk）：身体层（去手）+ 手层（只手），武器渲染在两者之间，
                // 视觉上"手握剑"（武器不再盖住手部贴图）
                if (def.handLayer) {
                    this.load.spritesheet(`${texKey}_body`, def.handLayer.body, {
                        frameWidth: def.frameWidth, frameHeight: def.frameHeight, endFrame: (def.frameCount || 1) - 1
                    });
                    this.load.spritesheet(`${texKey}_hand`, def.handLayer.hand, {
                        frameWidth: def.frameWidth, frameHeight: def.frameHeight, endFrame: (def.frameCount || 1) - 1
                    });
                }
            }
        }

        // ---- 侍从动作动画（配置驱动：companion-config.json animations；纹理键 companion_<id>_<动画>） ----
        for (const companion of companionConfigData.companions || []) {
            const anims = companion.animations || {};
            for (const [animKey, def] of Object.entries(anims)) {
                if (!def || !def.src) continue;
                this.load.spritesheet(`companion_${companion.id}_${animKey}`, def.src, {
                    frameWidth: def.frameWidth || 512,
                    frameHeight: def.frameHeight || 512,
                    endFrame: (def.frameCount || 1) - 1,
                });
            }
        }

        // ---- 世界-122 友方单位（仓鼠矿工/战士/射手/盾卫/民兵/斥候；独立配置，不入招募池）----
        for (const unitConfig of [hamsterMinerConfig, hamsterWarriorConfig, hamsterShooterConfig, hamsterGuardConfig, hamsterMilitiaConfig, hamsterScoutConfig, hamsterMusketeerConfig]) {
            for (const [animKey, def] of Object.entries(unitConfig.animations || {})) {
                if (!def || !def.src) continue;
                this.load.spritesheet(`companion_${unitConfig.id}_${animKey}`, def.src, {
                    frameWidth: def.frameWidth || 512,
                    frameHeight: def.frameHeight || 512,
                    endFrame: (def.frameCount || 1) - 1,
                });
            }
        }

        // ---- 武器资源 ----
        const weaponTextures = getWeaponTextureLoadList();
        for (const { key, path } of weaponTextures) {
            this.load.image(key, path);
        }

        // ---- 特效资源 ----
        this.load.image('runeSwordBlade', 'assets/weapons/blue_energy_sword_pure.png');
        this.load.image('iceSpike', 'assets/skills/ice_spike_icon_01.png');
        this.load.image('iceSpike2', 'assets/skills/ice_spike_icon_02.png');
        this.load.image('iceSpike3', 'assets/skills/ice_spike_icon_03.png');
        this.load.image('iceSpike4', 'assets/skills/ice_spike_icon_04.png');
        this.load.spritesheet('fireball', 'assets/skills/fireball_spritesheet.png', { frameWidth: 480, frameHeight: 480, endFrame: 72 });
        this.load.image('blackbrick2', 'assets/terrain/blackbrick2.png');
        this.load.image('blackbrick3', 'assets/terrain/blackbrick3.png');
        // 墙壁贴图：wall.png 水平墙（带墙面），wall-2.png 垂直墙（只看顶部砖块）
        this.load.image('wall_horizontal', 'assets/terrain/wall.png');
        this.load.image('wall_vertical', 'assets/terrain/wall-2.png');
        // 等距斜墙贴图（菱形地块平行铺设）：直墙瓦片(已去端帽) + 四角转角（几何锚点见 wall-system.js ISO_WALL_GEO）
        this.load.image('wall_diag', 'assets/terrain/wall_diag.png');
        this.load.image('wall_straight', 'assets/terrain/wall_straight.png');
        // 门闸（16 帧开门动画：帧 0 关闭、帧 15 打开）
        this.load.spritesheet('wall_gate', 'assets/terrain/wall_gate.png', { frameWidth: 640, frameHeight: 641, endFrame: 15 });
        this.load.image('wall_corner_top', 'assets/terrain/wall_corner_top.png');
        this.load.image('wall_corner_bottom', 'assets/terrain/wall_corner_bottom.png');
        this.load.image('wall_corner_left', 'assets/terrain/wall_corner_left.png');
        this.load.image('wall_corner_right', 'assets/terrain/wall_corner_right.png');
        // 等级宝箱贴图（E/D/C/B/A；A 暂用 B 图兜底，素材库缺 A.png）+ 开箱 16 帧动画
        this.load.image('chest_closed', 'assets/terrain/chest_closed.png');
        this.load.image('chest_opened', 'assets/terrain/chest_opened.png');
        this.load.spritesheet('chest_open_anim', 'assets/terrain/chest_open_anim.png', { frameWidth: 512, frameHeight: 512 });
        // 等距地板：基础层 + 发光层（glow 用 ADD/lighter 混合叠加发光）
        this.load.image('blackbrick5', 'assets/terrain/blackbrick5.png');
        this.load.image('blackbrick5_glow', 'assets/terrain/blackbrick5_glow.png');
        this.load.image('blackbrick6', 'assets/terrain/blackbrick6.png');
        this.load.image('blackbrick_7', 'assets/terrain/blackbrick-7.png');
        this.load.image('blackbrick_8', 'assets/terrain/blackbrick-8.png');
        // 沼泽地装饰道具（柴堆/草茎/树桩/苔石，战斗房地块随机点缀）
        this.load.image('swamp_deco_3', 'assets/terrain/swamp_deco_3.png');
        this.load.image('swamp_deco_4', 'assets/terrain/swamp_deco_4.png');
        this.load.image('swamp_deco_5', 'assets/terrain/swamp_deco_5.png');
        this.load.image('swamp_deco_6', 'assets/terrain/swamp_deco_6.png');
        // 沼泽地地砖（沼泽地-高级地牢；当前试用 AI 新砖 swampbrick-new1 单款，旧 3 张备份于 swampbrick_old/）
        this.load.image('swampbrick_new1', 'assets/terrain/swampbrick-new1.png');
        this.load.image('yellowmud_new1', 'assets/terrain/yellowmud-new1.png');
        this.load.image('floor_mud_seamless', 'assets/terrain/floor_mud_seamless.png');
        this.load.image('floor_sand_seamless', 'assets/terrain/floor_sand_seamless.png');
        this.load.image('deco_grass_1', 'assets/terrain/deco_grass_1.png');
        this.load.image('deco_grass_2', 'assets/terrain/deco_grass_2.png');
        // 世界-122 荒漠植物点缀（2026-08-16：束草/蒿灌木/龙舌兰/风滚草，微俯 30° 直立 + 低饱和）
        this.load.image('deco_desert_1', 'assets/terrain/deco_desert_1.png');
        this.load.image('deco_desert_2', 'assets/terrain/deco_desert_2.png');
        this.load.image('deco_desert_3', 'assets/terrain/deco_desert_3.png');
        this.load.image('deco_desert_4', 'assets/terrain/deco_desert_4.png');
        // 世界-122 仙人掌障碍物（2026-08-16：4 姿态同风格低对比，cactusScatter 散布）
        this.load.image('obstacle_cactus_saguaro2arm', 'assets/terrain/obstacle_cactus_saguaro2arm.png');
        this.load.image('obstacle_cactus_saguaro1arm', 'assets/terrain/obstacle_cactus_saguaro1arm.png');
        this.load.image('obstacle_cactus_barrel', 'assets/terrain/obstacle_cactus_barrel.png');
        this.load.image('obstacle_cactus_cholla', 'assets/terrain/obstacle_cactus_cholla.png');
        this.load.image('swampbrick_1', 'assets/terrain/swampbrick-1.png');
        this.load.image('swampbrick_2', 'assets/terrain/swampbrick-2.png');
        this.load.image('swampbrick_3', 'assets/terrain/swampbrick-3.png');
        // 世界-122 能源资源点（2026-08-16 v3：AI 成品优先；缺图时 EnergyNodeSystem 自动生成
        // 12 形态程序化水晶，底座带 30° 接地线，与掩体/墙地板衔接同规则。旧 v1~v6 不再参与渲染）
        // AI v3 成品（12 形态 × 正常/枯竭）：只加载 assets/terrain 下实际存在的文件。
        // 未生成的文件不会发起请求，避免 Phaser 报 Failed to process file 刷屏。
        // 注意：新放入 assets 的 v3 图片需重启 Vite 后才会被 glob 收录。
        const v3AssetModules = import.meta.glob(
            '../../../assets/terrain/energy_node_v3_*.png',
            { eager: true, query: '?url', import: 'default' }
        );
        const v3DepletedModules = import.meta.glob(
            '../../../assets/terrain/energy_node_depleted_v3_*.png',
            { eager: true, query: '?url', import: 'default' }
        );
        for (const [file, url] of Object.entries(v3AssetModules)) {
            this.load.image(file.split('/').pop().replace('.png', ''), url);
        }
        for (const [file, url] of Object.entries(v3DepletedModules)) {
            this.load.image(file.split('/').pop().replace('.png', ''), url);
        }
        // 沼泽地墙（柴墙直墙 + 藤蔓门闸 16 帧）
        this.load.image('swamp_wall_straight', 'assets/terrain/swamp_wall_straight.png');
        this.load.spritesheet('swamp_gate', 'assets/terrain/swamp_gate.png', { frameWidth: 640, frameHeight: 612, endFrame: 15 });
        // 恶魔洞窟（2026-08-11）：矿洞岩壁 + 铁闸门（16 帧）
        this.load.image('demonbrick1', 'assets/terrain/demonbrick1.png');
        this.load.image('demon_wall_straight', 'assets/terrain/demon_wall_straight.png');
        this.load.spritesheet('demon_gate', 'assets/terrain/demon_gate.png', { frameWidth: 640, frameHeight: 576, endFrame: 15 });
        // 主神空间地板砖（等距菱形贴图，运行时按 alpha 包围盒实测几何）
        this.load.image('hub_brick', 'assets/terrain/hub_brick.png');
        // 主神空间大理石直墙 + 大理石门（摆墙编辑器组件，tools/prep-hub-wall-gate.py 产出，几何见 ISO_WALL_GEO）
        this.load.image('hub_wall_straight', 'assets/terrain/hub_wall_straight.png');
        this.load.image('hub_gate', 'assets/terrain/hub_gate.png');
        // 障碍物组件（木桶/石柱/烛台，摆墙编辑器障碍物类）
        this.load.image('obstacle_barrel', 'assets/terrain/obstacle_barrel.png');
        this.load.image('obstacle_pillar', 'assets/terrain/obstacle_pillar.png');
        this.load.image('obstacle_candle', 'assets/terrain/obstacle_candle.png');
        this.load.image('obstacle_pot', 'assets/terrain/obstacle_pot.png');
        this.load.image('obstacle_skull', 'assets/terrain/obstacle_skull.png');
        this.load.image('obstacle_bones', 'assets/terrain/obstacle_bones.png');
        this.load.image('obstacle_chains', 'assets/terrain/obstacle_chains.png');
        this.load.image('obstacle_torch', 'assets/terrain/obstacle_torch.png');
        this.load.image('obstacle_bottle1', 'assets/terrain/obstacle_bottle1.png');
        this.load.image('obstacle_bottle2', 'assets/terrain/obstacle_bottle2.png');
        this.load.image('obstacle_bottle3', 'assets/terrain/obstacle_bottle3.png');
        this.load.image('obstacle_bottle4', 'assets/terrain/obstacle_bottle4.png');
        // 小鼠铁匠铺装饰（木材堆/铁矿堆，泛洪抠图去白底）
        this.load.image('obstacle_woodpile', 'assets/terrain/obstacle_woodpile.png');
        this.load.image('obstacle_orepile', 'assets/terrain/obstacle_orepile.png');
        // 沙袋/木制拒马（等距版，2026-08-03 本地 ComfyUI 出图 + 抠图入库，摆墙编辑器障碍物类）
        this.load.image('obstacle_sandbag', 'assets/terrain/obstacle_sandbag.png');
        this.load.image('obstacle_barricade', 'assets/terrain/obstacle_barricade.png');
        // 2026-08-17：1×1 方格块（基地方块环/方块墙，单一贴图无 v/h 变体）
        this.load.image('obstacle_block', 'assets/terrain/obstacle_block.png');
        // 2026-08-17：4 格门图标（面板缩略图 + 放置幽灵预览）
        this.load.image('gate_4cell', 'assets/terrain/gate_4cell.png');
        // 世界-122 掩体（F→A 六档；v1=定稿 + v2~v5 随机变体库，2026-08-05 入库）
        for (const grade of ['F', 'E', 'D', 'C', 'B', 'A']) {
            for (const orient of ['h', 'v']) {
                this.load.image(`obstacle_cover_${grade}_${orient}`, `assets/terrain/obstacle_cover_${grade}_${orient}.png`);
            }
            for (let v = 2; v <= 5; v++) {
                for (const orient of ['h', 'v']) {
                    this.load.image(`obstacle_cover_${grade}_v${v}_${orient}`, `assets/terrain/obstacle_cover_${grade}_v${v}_${orient}.png`);
                }
            }
        }
        // 世界-122 铁栅栏滑动门（F→A 六档，Blender 建模 16 帧滑出/滑入开合，2026-08-15）
        for (const grade of ['F', 'E', 'D', 'C', 'B', 'A']) {
            this.load.spritesheet(`cover_gate_${grade}`, `assets/terrain/cover_gate_${grade}.png`, { frameWidth: 640, frameHeight: 634 });
            // 图层拆分（2026-08-15）：左右柱静态图 + 栅栏 16 帧，各按自身底边线深度锚定
            this.load.image(`cover_gate_${grade}_pillarL`, `assets/terrain/cover_gate_${grade}_pillarL.png`);
            this.load.image(`cover_gate_${grade}_pillarR`, `assets/terrain/cover_gate_${grade}_pillarR.png`);
            this.load.spritesheet(`cover_gate_${grade}_bars`, `assets/terrain/cover_gate_${grade}_bars.png`, { frameWidth: 640, frameHeight: 634 });
        }
        // 世界-122 防御塔（基座+上方机械臂武器挂载点）
        this.load.image('obstacle_defense_tower', 'assets/terrain/obstacle_defense_tower.png');
        // 世界-122 基地核心（Blender 建模：立方体 + 扁平底座 + 大理石贴图，2026-08-16）
        this.load.image('defense_base', 'assets/terrain/defense_base.png');
        // 世界-122 射击台（Blender 建模：三级台阶 + 站台，30° 等距视角，2026-08-16）
        this.load.image('firing_platform', 'assets/terrain/firing_platform.png');
        this.load.image('firing_platform_h', 'assets/terrain/firing_platform_h.png');
        // 世界-122 仓鼠小屋（建筑面板可建造，生成仓鼠矿工；贴图 Blender 建模渲染）
        // 世界-122 建筑（2026-08-17 换素材：军营/矿场/铁匠铺，英文文件名）
        this.load.image('barracks', 'assets/terrain/barracks.png');
        this.load.image('mine', 'assets/terrain/mine.png');
        this.load.image('blacksmith', 'assets/terrain/blacksmith.png');
        // 世界-122 研究院（素材库原图裁透明边并缩至 1024 宽）
        this.load.image('research_institute', 'assets/terrain/research_institute.png');
        this.load.image('warehouse', 'assets/terrain/warehouse.png');
        this.load.image('shooting_range', 'assets/terrain/shooting_range.png');
        this.load.image('thatch_hut', 'assets/terrain/thatch_hut.png');
        // 世界-122 防御塔机械臂（预渲染 3D 旋转帧，48 帧等距透视，按 aimAngle 选帧）
        this.load.spritesheet('obstacle_defense_tower_arm_frames', 'assets/terrain/obstacle_defense_tower_arm_frames.png', { frameWidth: 261, frameHeight: 164 });
        // 防御塔武器枪管（预裁剪独立贴图："枪插进机械臂"假象；2026-08-14）
        for (const wid of ['weapon6', 'weapon7', 'weapon21', 'weapon8', 'weapon11', 'weapon12', 'weapon13', 'weapon15']) {
            this.load.image(`tower_barrel_${wid}`, `assets/terrain/tower_barrel_${wid}.png`);
        }
        // 世界-122 陷阱（4 类 × F→A 六档，2026-08-07 新增）
        for (const type of Object.keys(TRAP_CONFIG)) {
            for (const grade of TRAP_GRADES) {
                this.load.image(`trap_${type}_${grade}`, `assets/terrain/trap_${type}_${grade}.png`);
            }
        }
        // 防御塔挂载弓（玩家弓走箭矢帧，塔用单张弓贴图）
        this.load.image('weapon_bow', 'assets/weapons/bow.png');
        // 陷阱（僵尸地牢战斗房：格栅盖静态帧 + 地刺 13 帧动画，512² 帧）
        this.load.image('trap_idle', 'assets/terrain/trap_idle.png');
        this.load.spritesheet('trap_anim', 'assets/terrain/trap_anim.png', { frameWidth: 512, frameHeight: 512, endFrame: 12 });
        this.load.image('drone', 'assets/skills/drone.png');

        // ---- 敌人资源 ----
        // 蜘蛛与黑狼保留，其它敌人使用程序化 enemy_circle
        this.load.image('enemy_spider', 'assets/enemies/spider.png');
        this.load.image('enemy_black_wolf_idle', 'assets/enemies/black_wolf_idle.png');
        // 黑狼 H3 视频管线新精灵图（2026-08-06 升级，512×512 帧）
        this.load.spritesheet('enemy_black_wolf_walk', 'assets/enemies/black_wolf_walk.png', { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        this.load.spritesheet('enemy_black_wolf_run', 'assets/enemies/black_wolf_run.png', { frameWidth: 512, frameHeight: 512, endFrame: 27 });
        this.load.spritesheet('enemy_black_wolf_bite', 'assets/enemies/black_wolf_bite_regular.png', { frameWidth: 512, frameHeight: 512, endFrame: 11 });
        // 红狼王（2026-08-06 H3 全动作升级：狼形态 + 变身 + 红狼人形态，512 切帧 setFrame 路径）
        this.load.image('enemy_red_wolf_king_idle', 'assets/enemies/red_wolf_king_idle.png');
        this.load.spritesheet('enemy_red_wolf_king_pacing', 'assets/enemies/red_wolf_king_pacing.png', { frameWidth: 512, frameHeight: 512, endFrame: 13 });
        this.load.spritesheet('enemy_red_wolf_king_run', 'assets/enemies/red_wolf_king_run.png', { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        this.load.spritesheet('enemy_red_wolf_king_pounce_claw', 'assets/enemies/red_wolf_king_pounce_claw.png', { frameWidth: 512, frameHeight: 512, endFrame: 11 });
        // 撕咬贴图 2026-08-07 重建：扑咬爆发帧宽过 512 会裁切 → 用 576² 网格（12 帧 4×3）
        this.load.spritesheet('enemy_red_wolf_king_pounce_bite', 'assets/enemies/red_wolf_king_pounce_bite.png', { frameWidth: 576, frameHeight: 576, endFrame: 11 });
        this.load.spritesheet('enemy_red_wolf_king_change', 'assets/enemies/red_wolf_king_change.png', { frameWidth: 512, frameHeight: 512, endFrame: 11 });
        this.load.spritesheet('enemy_red_wolf_king_howl', 'assets/enemies/red_wolf_king_howl.png', { frameWidth: 512, frameHeight: 512, endFrame: 11 });
        this.load.image('enemy_red_wolf_king_transformed_idle', 'assets/enemies/red_wolf_king_transformed_idle.png');
        // 红狼人 run/attack 4096² 画布（8列×4行=30帧，每帧 512×1024 竖条，2026-08-08 高清重做）
        this.load.spritesheet('enemy_red_wolf_king_changed_run', 'assets/enemies/red_wolf_king_changed_run.png', { frameWidth: 512, frameHeight: 1024, endFrame: 29 });
        this.load.spritesheet('enemy_red_wolf_king_changed_attack', 'assets/enemies/red_wolf_king_changed_attack.png', { frameWidth: 512, frameHeight: 1024, endFrame: 29 });
        // 红狼人（两足）嚎叫技能动画（2026-08-08 重生成，原 howl 是四足狼形态）
        this.load.spritesheet('enemy_red_wolf_king_changed_howl', 'assets/enemies/red_wolf_king_changed_howl.png', { frameWidth: 512, frameHeight: 512, endFrame: 11 });

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
        // 手脑（领主）：统一 8列×4行 网格（帧 512×512，alpha 投影实测；walk 12帧=8+4 占前两行）
        this.load.spritesheet('enemy_shounao_idle',  'assets/enemies/shounao/idle.png',        { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_shounao_walk',  'assets/enemies/shounao/walking.png',     { frameWidth: 512, frameHeight: 512, endFrame: 11 });
        this.load.spritesheet('enemy_shounao_slam',  'assets/enemies/shounao/attacking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 25 });
        this.load.spritesheet('enemy_shounao_howl',  'assets/enemies/shounao/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 27 });

        // 时空特工(突击)-F（领主，双形态）：8列×4行切割，512×512 帧
        this.load.image('enemy_timeagent_idle',        'assets/enemies/time_agent/idle.png');
        this.load.spritesheet('enemy_timeagent_walk',   'assets/enemies/time_agent/walking.png',    { frameWidth: 512, frameHeight: 512, endFrame: 17 });
        this.load.spritesheet('enemy_timeagent_walk2',  'assets/enemies/time_agent/walking-2.png',  { frameWidth: 512, frameHeight: 512, endFrame: 18 });
        this.load.spritesheet('enemy_timeagent_gun',    'assets/enemies/time_agent/attacking.png',  { frameWidth: 512, frameHeight: 512, endFrame: 7 });
        this.load.spritesheet('enemy_timeagent_flash',  'assets/enemies/time_agent/flash.png',      { frameWidth: 512, frameHeight: 512, endFrame: 31 });
        this.load.spritesheet('enemy_timeagent_axe',    'assets/enemies/time_agent/axe.png',        { frameWidth: 512, frameHeight: 512, endFrame: 29 });
        this.load.spritesheet('enemy_timeagent_switch', 'assets/enemies/time_agent/switch.png',     { frameWidth: 512, frameHeight: 512, endFrame: 20 });
        this.load.image('enemy_timeagent_project',   'assets/enemies/time_agent/projective.png');

        // 时空特工(盾位)-F（领主，双模式：沙鹰射击/盾击/防御）：8列×4行切割，512×512 帧
        this.load.spritesheet('enemy_timeshield_idle',    'assets/enemies/time_agent_shield/idle.png',      { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_timeshield_walk',    'assets/enemies/time_agent_shield/walking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        this.load.spritesheet('enemy_timeshield_switch',  'assets/enemies/time_agent_shield/switch.png',    { frameWidth: 512, frameHeight: 512, endFrame: 7 });
        this.load.spritesheet('enemy_timeshield_push',    'assets/enemies/time_agent_shield/push.png',      { frameWidth: 512, frameHeight: 512, endFrame: 16 });
        this.load.spritesheet('enemy_timeshield_defend',  'assets/enemies/time_agent_shield/defending.png', { frameWidth: 512, frameHeight: 512, endFrame: 9 });
        // 蝇群（普通）：8列×4行 32 帧循环（帧 512×512）
        this.load.spritesheet('enemy_flyswarm_idle', 'assets/enemies/flyswarm/idle.png', { frameWidth: 512, frameHeight: 512, endFrame: 31 });
        // 蝇手（领主）：全部 512×512 帧（idle 已重排统一；walk 8列×2行16帧，攻击 8列×4行）
        this.load.spritesheet('enemy_flyhand_idle',       'assets/enemies/flyhand/idle.png',        { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_flyhand_walk',       'assets/enemies/flyhand/walking.png',     { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        this.load.spritesheet('enemy_flyhand_hammer',     'assets/enemies/flyhand/attacking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 15 });
        this.load.spritesheet('enemy_flyhand_slam',       'assets/enemies/flyhand/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 23 });
        this.load.spritesheet('enemy_flyhand_grand_slam', 'assets/enemies/flyhand/attacking-3.png', { frameWidth: 512, frameHeight: 512, endFrame: 18 });

        // 毒蛆（精英）：8列×4行 512×512 切帧（idle 1 帧 / walking 6 帧 / spitting 16 帧）
        this.load.spritesheet('enemy_poison_maggot_idle',     'assets/enemies/poison_maggot/idle.png',     { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_poison_maggot_walk',     'assets/enemies/poison_maggot/walking.png',  { frameWidth: 512, frameHeight: 512, endFrame: 5 });
        this.load.spritesheet('enemy_poison_maggot_spitting', 'assets/enemies/poison_maggot/spitting.png', { frameWidth: 512, frameHeight: 512, endFrame: 15 });

        // ---- NPC 资源 ----
        // 小鼠大王：8列×4行 512×512 切帧（idle 1 帧 / walking 19 帧）
        this.load.spritesheet('npc_mouse_king_idle', 'assets/npc/mouse_king/idle.png',    { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('npc_mouse_king_walk', 'assets/npc/mouse_king/walking.png', { frameWidth: 512, frameHeight: 512, endFrame: 18 });
        // 仓库：静态贴图（宝箱）
        this.load.image('npc_warehouse', 'assets/npc/warehouse/warehouse.png');
        // 祭坛：静态贴图（大理石祭坛，tools/prep-hub-assets.py 抠图）
        this.load.image('npc_altar', 'assets/npc/altar.png');
        // 小鼠铁匠：8列×8行 512×512 切帧（idle 29 帧，泛洪抠图去白底）
        this.load.spritesheet('npc_mouse_blacksmith_idle', 'assets/npc/mouse_blacksmith/idle.png', { frameWidth: 512, frameHeight: 512, endFrame: 28 });

        // 矿工僵尸（普通）：8列×4行 512×512 切帧（idle 1 帧 / walking 14 帧 / attacking 24 帧 / dying 13 帧）
        this.load.spritesheet('enemy_miner_zombie_idle',   'assets/enemies/miner_zombie/idle.png',      { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_miner_zombie_walk',   'assets/enemies/miner_zombie/walking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 13 });
        this.load.spritesheet('enemy_miner_zombie_attack', 'assets/enemies/miner_zombie/attacking.png', { frameWidth: 512, frameHeight: 512, endFrame: 23 });
        this.load.spritesheet('enemy_miner_zombie_death',  'assets/enemies/miner_zombie/dying.png',     { frameWidth: 512, frameHeight: 512, endFrame: 12 });

        // 矿工提灯僵尸（精英）：8列×4行 512×512 切帧（idle 1 / walking 18 / attacking 30 / attacking-2 22 / dying 15）
        this.load.spritesheet('enemy_lantern_miner_idle',    'assets/enemies/lantern_miner_zombie/idle.png',        { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_lantern_miner_walk',    'assets/enemies/lantern_miner_zombie/walking.png',     { frameWidth: 512, frameHeight: 512, endFrame: 17 });
        this.load.spritesheet('enemy_lantern_miner_attack',  'assets/enemies/lantern_miner_zombie/attacking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 29 });
        this.load.spritesheet('enemy_lantern_miner_attack2', 'assets/enemies/lantern_miner_zombie/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 21 });
        this.load.spritesheet('enemy_lantern_miner_death',   'assets/enemies/lantern_miner_zombie/dying.png',       { frameWidth: 512, frameHeight: 512, endFrame: 14 });
        // 提灯投射物贴图（单帧）
        this.load.image('enemy_lantern_miner_projectile', 'assets/enemies/lantern_miner_zombie/projective.png');

        // 矿石蜘蛛（精英）：8列×4行 512×512 切帧（idle 1 / walking 14 / attacking 28 / attacking-2 18 / dying 12）
        this.load.spritesheet('enemy_ore_spider_idle',   'assets/enemies/ore_spider/idle.png',        { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_ore_spider_walk',   'assets/enemies/ore_spider/walking.png',     { frameWidth: 512, frameHeight: 512, endFrame: 13 });
        this.load.spritesheet('enemy_ore_spider_attack', 'assets/enemies/ore_spider/attacking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 27 });
        this.load.spritesheet('enemy_ore_spider_slam',   'assets/enemies/ore_spider/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 17 });
        this.load.spritesheet('enemy_ore_spider_death',  'assets/enemies/ore_spider/dying.png',       { frameWidth: 512, frameHeight: 512, endFrame: 11 });
        // 晶石投射物贴图（单帧）
        this.load.image('enemy_ore_spider_projectile', 'assets/enemies/ore_spider/projective.png');

        // 僵尸工头（领主）：512×512 切帧（idle 1 / walking 20（H3 循环动画，5列×4行，同相周期截取）/ attacking 31 / howling 24 / dying 14）
        this.load.spritesheet('enemy_foreman_idle',   'assets/enemies/foreman_zombie/idle.png',      { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_foreman_walk',   'assets/enemies/foreman_zombie/walking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 19 });
        this.load.spritesheet('enemy_foreman_attack', 'assets/enemies/foreman_zombie/attacking.png', { frameWidth: 512, frameHeight: 512, endFrame: 30 });
        this.load.spritesheet('enemy_foreman_howl',   'assets/enemies/foreman_zombie/howling.png',   { frameWidth: 512, frameHeight: 512, endFrame: 23 });
        this.load.spritesheet('enemy_foreman_death',  'assets/enemies/foreman_zombie/dying.png',     { frameWidth: 512, frameHeight: 512, endFrame: 13 });

        // 矿洞（次级，静态贴图）
        this.load.image('enemy_mine_cave', 'assets/enemies/mine_cave/mine_cave.png');

        // 墓碑（普通级，静态贴图，僵尸地牢普通战斗 33% 概率出现）
        this.load.image('enemy_tombstone', 'assets/enemies/tombstone/idle.png');

        // 巫婆（领主）：8列×4行 512×512 切帧（idle 1 / walking 11 / attacking 14 / attacking-2 18 / dying 17）
        this.load.spritesheet('enemy_witch_idle',    'assets/enemies/witch/idle.png',        { frameWidth: 512, frameHeight: 512, endFrame: 0 });
        this.load.spritesheet('enemy_witch_walk',    'assets/enemies/witch/walking.png',     { frameWidth: 512, frameHeight: 512, endFrame: 10 });
        this.load.spritesheet('enemy_witch_attack',  'assets/enemies/witch/attacking.png',   { frameWidth: 512, frameHeight: 512, endFrame: 13 });
        this.load.spritesheet('enemy_witch_attack2', 'assets/enemies/witch/attacking-2.png', { frameWidth: 512, frameHeight: 512, endFrame: 17 });
        this.load.spritesheet('enemy_witch_death',   'assets/enemies/witch/dying.png',       { frameWidth: 512, frameHeight: 512, endFrame: 16 });
        // 毒液瓶投射物贴图（单帧）
        this.load.image('enemy_witch_projectile', 'assets/enemies/witch/projective.png');

        // 煮锅（其他，静态贴图，巫婆伴生）
        this.load.image('enemy_cauldron', 'assets/enemies/cauldron/bowl.png');

        // ---- 环境资源 ----

        // ---- 特效资源 ----
        this.load.image('muzzle_flash_01', 'assets/effects/muzzle_flash_01.png');
        this.load.image('shell_ground', 'assets/ammo/shell_ground.png');
        this.load.image('sword_hilt_icon', 'assets/icons/sword_hilt_icon.png');
        this.load.image('blackbrick', 'assets/terrain/blackbrick.png');
        // 冰墙技能：写实冰晶簇素材（即梦出图，tools/process-icewall-sprites.py 抠图处理）
        for (let i = 0; i < 5; i++) this.load.image(`ice_wall_segment_${i}`, `assets/effects/icewall/segment_${i}.png`);
        // 粒子用程序化生成，暂不需要加载图片

    }

    create() {
        
        // 预载墙壁预制组合库（主神空间默认房间/墙壁编辑器共用，fire-and-forget）
        loadWallPrefabs();
        loadObstacleLayout();
        // 预载障碍物类型默认状态（障碍物编辑器保存的按类型变换；摆墙新件/地牢装饰生成时套用）
        loadObstacleDefaults();
        // 预载墙体几何覆盖层（碰撞编辑器保存的墙/门/障碍物判定；合并进 ISO_WALL_GEO）
        WallSystem.loadGeoOverrides();

        // 创建玩家动画（配置驱动；repeat -1 循环 / 0 播放一次，帧区间由 frames 指定）
        for (const [animKey, def] of Object.entries(PLAYER_ANIMS)) {
            if (def.type !== 'sheet') continue;
            const texKey = playerTextureKey(animKey);
            const [start, end] = def.frames || [0, (def.frameCount || 1) - 1];
            const frameObjs = this.anims.generateFrameNumbers(texKey, { start, end });
            // frameWeights（可选，占比数组）：按权重分配【原总时长】——总时长锁定（帧数/帧率），
            // 只改各帧占比（如末帧定格更久 [1,1,1,1,1,1,1,3]），武器轨迹/命中时序完全不受影响
            if (def.frameWeights && def.frameWeights.length) {
                const totalMs = ((end - start + 1) / (def.frameRate || 12)) * 1000;
                const wSum = def.frameWeights.reduce((a, b) => a + (b || 0), 0) || 1;
                frameObjs.forEach((f, i) => {
                    const w = def.frameWeights[i];
                    if (w !== undefined) f.duration = (w / wSum) * totalMs;
                });
            } else if (def.frameDurations && def.frameDurations.length) {
                // frameDurations（可选，ms/帧）：逐帧绝对时长，总时长=各帧之和（会改变总时长，
                // 武器轨迹 Tween 经 animDef.duration 自动跟随）
                frameObjs.forEach((f, i) => {
                    const d = def.frameDurations[i];
                    if (d !== undefined) f.duration = d;
                });
            }
            this.anims.create({
                key: texKey,
                frames: frameObjs,
                frameRate: def.frameRate || 12,
                repeat: def.repeat !== undefined ? def.repeat : -1,
            });
            // 手部分层动画：body 用身体贴图（与主动画同帧区间/节奏），hand 由 GameScene 每帧手动同步帧
            if (def.handLayer) {
                this.anims.create({
                    key: `${texKey}_body`,
                    frames: this.anims.generateFrameNumbers(`${texKey}_body`, { start, end }),
                    frameRate: def.frameRate || 12,
                    repeat: def.repeat !== undefined ? def.repeat : -1,
                });
                // 手层帧序守卫：body/hand 必须同网格同帧序（_syncPlayerHandLayer 按帧号直接跟随），
                // 帧数不一致会在运行时错位，加载期直接告警
                const bodyTex = this.textures.get(`${texKey}_body`);
                const handTex = this.textures.get(`${texKey}_hand`);
                if (bodyTex && handTex) {
                    const bodyCount = bodyTex.getFrameNames ? bodyTex.getFrameNames().length : 0;
                    const handCount = handTex.getFrameNames ? handTex.getFrameNames().length : 0;
                    if (bodyCount !== handCount) {
                        console.warn(`[BootScene] 手层帧数不匹配：${texKey}_body(${bodyCount}) vs ${texKey}_hand(${handCount})——手 sprite 逐帧跟随会错位`);
                    }
                }
            }
        }

        // ---- 侍从动作动画注册（配置驱动；纹理/动画键 companion_<id>_<动画>） ----
        for (const companion of companionConfigData.companions || []) {
            const anims = companion.animations || {};
            for (const [animKey, def] of Object.entries(anims)) {
                if (!def || !def.src) continue;
                const texKey = `companion_${companion.id}_${animKey}`;
                if (!this.anims.exists(texKey)) {
                    if (def.enterFrames && def.exitFrames) {
                        // 防御三段式（伊莉丝 defending）：enter 1~8 帧一次 → hold 停帧 → exit 剩余一次
                        if (!this.anims.exists(`${texKey}_start`)) {
                            const [es, ee] = def.enterFrames;
                            const [xs, xe] = def.exitFrames;
                            this.anims.create({
                                key: `${texKey}_start`,
                                frames: this.anims.generateFrameNumbers(texKey, { start: es, end: ee }),
                                frameRate: def.enterFrameRate || def.frameRate || 16,
                                repeat: 0,
                            });
                            this.anims.create({
                                key: `${texKey}_end`,
                                frames: this.anims.generateFrameNumbers(texKey, { start: xs, end: xe }),
                                frameRate: def.exitFrameRate || def.frameRate || 22,
                                repeat: 0,
                            });
                        }
                    } else if (def.startFrames && def.loopFrames) {
                        // 起步 + 循环两段（如 running）：start 播一次 → loop 循环
                        const [ss, se] = def.startFrames;
                        const [ls, le] = def.loopFrames;
                        this.anims.create({
                            key: `${texKey}_start`,
                            frames: this.anims.generateFrameNumbers(texKey, { start: ss, end: se }),
                            frameRate: def.startFrameRate || def.frameRate || 12,
                            repeat: def.startRepeat !== undefined ? def.startRepeat : 0,
                        });
                        this.anims.create({
                            key: texKey,
                            frames: this.anims.generateFrameNumbers(texKey, { start: ls, end: le }),
                            frameRate: def.frameRate || 12,
                            repeat: def.repeat !== undefined ? def.repeat : -1,
                        });
                    } else {
                        const [start, end] = def.frames || [0, (def.frameCount || 1) - 1];
                        this.anims.create({
                            key: texKey,
                            frames: this.anims.generateFrameNumbers(texKey, { start, end }),
                            frameRate: def.frameRate || 12,
                            repeat: def.repeat !== undefined ? def.repeat : -1,
                        });
                    }
                }
            }
        }

        // 世界-122 友方单位动画注册：两段式（startFrames 起步播一次 → loopFrames 循环）
        // 仓鼠矿工 mining = 完整 19 帧起步 + 5~19 帧单次；仓鼠战士 attack = 完整 1~24 帧
        // 起步 + 第 6~24 帧循环；仓鼠射手 attack = 13 帧单次 + projectile 单帧贴图；
        // 仓鼠盾卫 attack = 12 帧单次（第 10 帧判定伤害由 AI 计时）；
        // 仓鼠民兵 attack = 15 帧单次（第 8 帧判定伤害由 AI 计时）；
        // 仓鼠斥候 attack = 18 帧单次（第 11 帧出膛由 AI 计时）+ projectile 单帧贴图
        for (const unitConfig of [hamsterMinerConfig, hamsterWarriorConfig, hamsterShooterConfig, hamsterGuardConfig, hamsterMilitiaConfig, hamsterScoutConfig, hamsterMusketeerConfig]) {
            for (const [animKey, def] of Object.entries(unitConfig.animations || {})) {
                if (!def || !def.src) continue;
                const texKey = `companion_${unitConfig.id}_${animKey}`;
                if (this.anims.exists(texKey)) continue;
                if (def.startFrames && def.loopFrames) {
                    const [ss, se] = def.startFrames;
                    const [ls, le] = def.loopFrames;
                    this.anims.create({
                        key: `${texKey}_start`,
                        frames: this.anims.generateFrameNumbers(texKey, { start: ss, end: se }),
                        frameRate: def.startFrameRate || def.frameRate || 12,
                        repeat: def.startRepeat !== undefined ? def.startRepeat : 0,
                    });
                    this.anims.create({
                        key: texKey,
                        frames: this.anims.generateFrameNumbers(texKey, { start: ls, end: le }),
                        frameRate: def.frameRate || 12,
                        repeat: def.repeat !== undefined ? def.repeat : -1,
                    });
                } else {
                    const [start, end] = def.frames || [0, (def.frameCount || 1) - 1];
                    this.anims.create({
                        key: texKey,
                        frames: this.anims.generateFrameNumbers(texKey, { start, end }),
                        frameRate: def.frameRate || 12,
                        repeat: def.repeat !== undefined ? def.repeat : -1,
                    });
                }
            }
        }

        // 武器枪口点自动烘焙：扫描每把武器贴图，取【最大连通体】（枪身本体，8 邻域）的
        // 最右端内容点（含 1px 细枪管尖）——开火位置/枪口火焰统一用贴图最前端，逐枪免调 muzzle；
        // 4 倍降采样提速；运行时 subsystems 读取
        {
            window.__weaponMuzzlePoints = window.__weaponMuzzlePoints || {};
            const DS = 4;
            for (const { key } of getWeaponTextureLoadList()) {
                const srcImg = this.textures.get(key) && this.textures.get(key).getSourceImage();
                if (!srcImg || !srcImg.width) continue;
                const cw = Math.max(1, Math.round(srcImg.width / DS));
                const ch = Math.max(1, Math.round(srcImg.height / DS));
                const canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(srcImg, 0, 0, cw, ch);
                let data;
                try {
                    data = ctx.getImageData(0, 0, cw, ch).data;
                } catch (_e) {
                    continue;
                }
                // 连通域标记（8 邻域，找最大分量=枪身本体，排除零散噪点）
                const total = cw * ch;
                const comp = new Int32Array(total).fill(-1);
                const alpha = (i) => data[i * 4 + 3] > 10;
                let bestSize = 0, bestComp = -1;
                const sizes = [];
                const stack = [];
                for (let i = 0; i < total; i++) {
                    if (comp[i] !== -1 || !alpha(i)) continue;
                    const id = sizes.length;
                    let size = 0;
                    stack.length = 0;
                    stack.push(i);
                    comp[i] = id;
                    while (stack.length) {
                        const p = stack.pop();
                        size++;
                        const px = p % cw, py = (p / cw) | 0;
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                if (!dx && !dy) continue;
                                const nx = px + dx, ny = py + dy;
                                if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
                                const ni = ny * cw + nx;
                                if (comp[ni] === -1 && alpha(ni)) {
                                    comp[ni] = id;
                                    stack.push(ni);
                                }
                            }
                        }
                    }
                    sizes.push(size);
                    if (size > bestSize) { bestSize = size; bestComp = id; }
                }
                if (bestComp < 0) continue;
                // 最大分量最右列（及相邻 2 列）的 Y 质心
                let maxX = -1;
                for (let i = 0; i < total; i++) {
                    if (comp[i] === bestComp && (i % cw) > maxX) maxX = i % cw;
                }
                let ySum = 0, yCount = 0;
                for (let i = 0; i < total; i++) {
                    if (comp[i] === bestComp && (i % cw) >= maxX - 2) {
                        ySum += (i / cw) | 0;
                        yCount++;
                    }
                }
                window.__weaponMuzzlePoints[key] = {
                    fx: maxX / cw,
                    fy: (ySum / yCount) / ch,
                };
            }
        }

        // 持枪移动腿层动画注册（twist.walkLegs/runLegs 配置驱动）
        for (const [animKey, def] of Object.entries(PLAYER_ANIMS)) {
            if (def.type !== 'image' || !def.twist) continue;
            const texKey = playerTextureKey(animKey);
            for (const [cfgKey, suffix] of [['walkLegs', 'walklegs'], ['runLegs', 'runlegs']]) {
                const part = def.twist[cfgKey];
                if (!part) continue;
                const [pStart, pEnd] = part.frames || [0, (part.frameCount || 1) - 1];
                this.anims.create({
                    key: `${texKey}_${suffix}`,
                    frames: this.anims.generateFrameNumbers(`${texKey}_${suffix}`, { start: pStart, end: pEnd }),
                    frameRate: part.frameRate || 24,
                    repeat: part.repeat !== undefined ? part.repeat : -1,
                });
            }
        }

        // 扭转姿态躯干层/手臂条的水平镜像烘焙（canvas 离屏，避免 flipX 与自定义原点/旋转的语义叠加）
        for (const [animKey, def] of Object.entries(PLAYER_ANIMS)) {
            if (def.type !== 'image' || !def.twist) continue;
            for (const part of ['torso', 'arm']) {
                if (part === 'arm' && !def.twist.arm) continue;
                const partKey = `${playerTextureKey(animKey)}_${part}`;
                const srcImg = this.textures.get(partKey) && this.textures.get(partKey).getSourceImage();
                if (!srcImg || !srcImg.width) continue;
                const canvas = document.createElement('canvas');
                canvas.width = srcImg.width;
                canvas.height = srcImg.height;
                const ctx = canvas.getContext('2d');
                ctx.translate(srcImg.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(srcImg, 0, 0);
                this.textures.addCanvas(`${partKey}_flip`, canvas);
            }
            // aimFrames 逐帧镜像烘焙（整 sheet 翻转会颠倒帧序，必须按帧槽位逐帧镜像）
            if (def.twist.aimFrames) {
                const af = def.twist.aimFrames;
                const afKey = `${playerTextureKey(animKey)}_aimframes`;
                const afImg = this.textures.get(afKey) && this.textures.get(afKey).getSourceImage();
                if (afImg && afImg.width) {
                    const count = af.frameCount || 1;
                    const fw = af.frameWidth, fh = af.frameHeight;
                    const canvas = document.createElement('canvas');
                    canvas.width = afImg.width;
                    canvas.height = afImg.height;
                    const ctx = canvas.getContext('2d');
                    for (let i = 0; i < count; i++) {
                        ctx.save();
                        // 水平镜像到本帧槽位：X 平移到槽位右缘后翻转；Y 必须为 0
                        //（误写 i*fw 会把帧 1~13 画到 516px 画布外，朝左瞄准时取到空白帧）
                        ctx.translate(i * fw + fw, 0);
                        ctx.scale(-1, 1);
                        ctx.drawImage(afImg, i * fw, 0, fw, fh, 0, 0, fw, fh);
                        ctx.restore();
                    }
                    // addCanvas 只有 __BASE 一帧，按帧槽位手动补帧定义，setFrame(i) 才能按 512×516 取帧
                    const flipTex = this.textures.addCanvas(`${afKey}_flip`, canvas);
                    for (let i = 0; i < count; i++) {
                        flipTex.add(i, 0, i * fw, 0, fw, fh);
                    }
                }
            }
        }

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

        // 毒液僵尸动画（1 帧待机 / 13 帧行走 / 22 帧攻击）
        // 注意：idle.png 仅帧 0 有内容（4×8 切割其余 23 格全空），曾按 0..23 注册导致
        // 待机时 23/24 时间播放空白帧 = 贴图"时常消失"，故只注册帧 0（胖子僵尸同款处理）
        this.anims.create({
            key: 'enemy_spitter_zombie_idle',
            frames: this.anims.generateFrameNumbers('enemy_spitter_zombie_idle', { start: 0, end: 0 }),
            frameRate: 1,
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
            // 首段：完整 19 帧播一轮（时长由 enemy-config charge.animIntroMs 对齐，默认 2s）
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_charge', { start: 0, end: 18 }),
            duration: 2000,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_armored_knight_charge_loop',
            // 循环段：首段播完后循环第 9~19 帧（索引 8~18，11 帧）直到退出冲锋；
            // 帧率与首段一致（19帧/2000ms → 11帧≈1158ms）
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_charge', { start: 8, end: 18 }),
            duration: 1158,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_armored_knight_defend',
            frames: this.anims.generateFrameNumbers('enemy_armored_knight_defend', { start: 0, end: 13 }),
            duration: 1500,
            repeat: 0,
        });
        // ---- 手脑（领主）动画 ----
        this.anims.create({
            key: 'enemy_shounao_idle',
            frames: this.anims.generateFrameNumbers('enemy_shounao_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_shounao_walk',
            frames: this.anims.generateFrameNumbers('enemy_shounao_walk', { start: 0, end: 11 }),
            frameRate: 12,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_shounao_slam',
            frames: this.anims.generateFrameNumbers('enemy_shounao_slam', { start: 0, end: 25 }),
            duration: 2000, // 与 slam.duration 对齐（动画时长=技能时长）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_shounao_howl',
            frames: this.anims.generateFrameNumbers('enemy_shounao_howl', { start: 0, end: 27 }),
            duration: 3000, // 与 howl.duration 对齐（动画时长=技能持续时间）
            repeat: 0,
        });
        // ---- 蝇群（32 帧循环） ----
        this.anims.create({
            key: 'enemy_flyswarm_idle',
            frames: this.anims.generateFrameNumbers('enemy_flyswarm_idle', { start: 0, end: 31 }),
            frameRate: 16,
            repeat: -1,
        });
        // ---- 时空特工(突击)-F（双形态）动画 ----
        this.anims.create({
            key: 'enemy_timeagent_idle',
            frames: [{ key: 'enemy_timeagent_idle' }],
            frameRate: 1,
            repeat: -1,
        });
        // 普通移动：首段 18 帧播一轮 → 循环 4~18 帧（索引 3~17）
        this.anims.create({
            key: 'enemy_timeagent_walk',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_walk', { start: 0, end: 17 }),
            duration: 1200,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_timeagent_walk_loop',
            // 循环段（idle 起步后）：第 4~18 帧（索引 3~17）
            frames: this.anims.generateFrameNumbers('enemy_timeagent_walk', { start: 3, end: 17 }),
            duration: 1000,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_timeagent_walk_loop_ranged',
            // 循环段（远程形态移动/移动射击）：第 7~18 帧（索引 6~17）
            frames: this.anims.generateFrameNumbers('enemy_timeagent_walk', { start: 6, end: 17 }),
            duration: 800,
            repeat: -1,
        });
        // 近战移动：首段 19 帧播一轮 → 循环 3~18 帧（索引 2~17）
        this.anims.create({
            key: 'enemy_timeagent_walk2',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_walk2', { start: 0, end: 18 }),
            duration: 1267,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_timeagent_walk2_loop',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_walk2', { start: 2, end: 17 }),
            duration: 1067,
            repeat: -1,
        });
        // 远程形态切换：attacking 8 帧 0.5s（正放切入 / 倒放切出）
        this.anims.create({
            key: 'enemy_timeagent_ranged_in',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_gun', { start: 0, end: 7 }),
            duration: 500,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_timeagent_ranged_out',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_gun', { start: 7, end: 0 }),
            duration: 500,
            repeat: 0,
        });
        // 远程持枪姿态（静止）：attacking 第 8 帧（索引 7）静态
        this.anims.create({
            key: 'enemy_timeagent_ranged_pose',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_gun', { start: 7, end: 7 }),
            frameRate: 1,
            repeat: -1,
        });
        // 闪光弹投掷：flash 32 帧 2s，第 24 帧出手
        this.anims.create({
            key: 'enemy_timeagent_flash',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_flash', { start: 0, end: 31 }),
            duration: 2000,
            repeat: 0,
        });
        // 斧头劈砍（首次切入近战）：axe 30 帧 2s
        this.anims.create({
            key: 'enemy_timeagent_axe',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_axe', { start: 0, end: 29 }),
            duration: 2000,
            repeat: 0,
        });
        // 近战劈砍：axe 12~30 帧（索引 11~29）
        this.anims.create({
            key: 'enemy_timeagent_axe_attack',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_axe', { start: 11, end: 29 }),
            duration: 1267,
            repeat: 0,
        });
        // 近战持斧姿态：axe 第 30 帧（索引 29）静态
        this.anims.create({
            key: 'enemy_timeagent_axe_idle',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_axe', { start: 29, end: 29 }),
            frameRate: 1,
            repeat: -1,
        });
        // 形态切换（近战→远程）：switch 21 帧 0.75s
        this.anims.create({
            key: 'enemy_timeagent_switch',
            frames: this.anims.generateFrameNumbers('enemy_timeagent_switch', { start: 0, end: 20 }),
            duration: 750,
            repeat: 0,
        });
        // ---- 时空特工(盾位)-F（沙鹰/盾击/防御）动画 ----
        this.anims.create({
            key: 'enemy_timeshield_idle',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        // 普通移动：首段 16 帧播一轮 → 循环 5~16 帧（索引 4~15）
        this.anims.create({
            key: 'enemy_timeshield_walk',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_walk', { start: 0, end: 15 }),
            duration: 1067,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_timeshield_walk_loop',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_walk', { start: 4, end: 15 }),
            duration: 800,
            repeat: -1,
        });
        // 远程形态切换：switch 8 帧 0.5s（正放切入 / 倒放切出）
        this.anims.create({
            key: 'enemy_timeshield_ranged_in',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_switch', { start: 0, end: 7 }),
            duration: 500,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_timeshield_ranged_out',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_switch', { start: 7, end: 0 }),
            duration: 500,
            repeat: 0,
        });
        // 远程持枪姿态：switch 第 8 帧（索引 7）静态
        this.anims.create({
            key: 'enemy_timeshield_ranged_pose',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_switch', { start: 7, end: 7 }),
            frameRate: 1,
            repeat: -1,
        });
        // 盾击：push 17 帧 0.75s（与 enemy-config bash.duration 对齐）
        this.anims.create({
            key: 'enemy_timeshield_push',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_push', { start: 0, end: 16 }),
            duration: 750,
            repeat: 0,
        });
        // 防御：defending 10 帧 0.75s 进入 → 第 10 帧持续 → 0.75s 倒放退出
        this.anims.create({
            key: 'enemy_timeshield_defend_in',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_defend', { start: 0, end: 9 }),
            duration: 750,
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_timeshield_defend_hold',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_defend', { start: 9, end: 9 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_timeshield_defend_out',
            frames: this.anims.generateFrameNumbers('enemy_timeshield_defend', { start: 9, end: 0 }),
            duration: 750,
            repeat: 0,
        });
        // ---- 蝇手（领主）动画 ----
        this.anims.create({
            key: 'enemy_flyhand_idle',
            frames: this.anims.generateFrameNumbers('enemy_flyhand_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_flyhand_walk',
            frames: this.anims.generateFrameNumbers('enemy_flyhand_walk', { start: 0, end: 15 }),
            frameRate: 14,
            repeat: -1, // 新素材（walking-1.png）帧间已对齐、循环衔接平滑，无需 yoyo
        });
        this.anims.create({
            key: 'enemy_flyhand_hammer',
            frames: this.anims.generateFrameNumbers('enemy_flyhand_hammer', { start: 0, end: 15 }),
            duration: 1500, // 与 hammer.duration 对齐
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_flyhand_slam',
            frames: this.anims.generateFrameNumbers('enemy_flyhand_slam', { start: 0, end: 23 }),
            duration: 2000, // 与 slam.duration 对齐
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_flyhand_grand_slam',
            frames: this.anims.generateFrameNumbers('enemy_flyhand_grand_slam', { start: 0, end: 18 }),
            duration: 2000, // 与 grandSlam.duration 对齐
            repeat: 0,
        });

        // ---- 毒蛆（精英）动画 ----
        this.anims.create({
            key: 'enemy_poison_maggot_idle',
            frames: this.anims.generateFrameNumbers('enemy_poison_maggot_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_poison_maggot_walk',
            frames: this.anims.generateFrameNumbers('enemy_poison_maggot_walk', { start: 0, end: 5 }),
            frameRate: 8,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_poison_maggot_spitting',
            frames: this.anims.generateFrameNumbers('enemy_poison_maggot_spitting', { start: 0, end: 15 }),
            duration: 3000, // 与 spit.duration 对齐
            repeat: 0,
        });

        // ---- 矿工僵尸动画 ----
        this.anims.create({
            key: 'enemy_miner_zombie_idle',
            frames: this.anims.generateFrameNumbers('enemy_miner_zombie_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_miner_zombie_walk',
            frames: this.anims.generateFrameNumbers('enemy_miner_zombie_walk', { start: 0, end: 13 }),
            frameRate: 9,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_miner_zombie_attack',
            frames: this.anims.generateFrameNumbers('enemy_miner_zombie_attack', { start: 0, end: 23 }),
            duration: 1500, // 与 slam.duration 对齐（24 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_miner_zombie_death',
            frames: this.anims.generateFrameNumbers('enemy_miner_zombie_death', { start: 0, end: 12 }),
            duration: 1300, // 13 帧一次性死亡动画
            repeat: 0,
        });

        // ---- 矿工提灯僵尸动画 ----
        this.anims.create({
            key: 'enemy_lantern_miner_idle',
            frames: this.anims.generateFrameNumbers('enemy_lantern_miner_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_lantern_miner_walk',
            frames: this.anims.generateFrameNumbers('enemy_lantern_miner_walk', { start: 0, end: 17 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_lantern_miner_attack',
            frames: this.anims.generateFrameNumbers('enemy_lantern_miner_attack', { start: 0, end: 29 }),
            duration: 1500, // 与 slam.duration 对齐（30 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_lantern_miner_attack2',
            frames: this.anims.generateFrameNumbers('enemy_lantern_miner_attack2', { start: 0, end: 21 }),
            duration: 1500, // 与 lantern.duration 对齐（22 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_lantern_miner_death',
            frames: this.anims.generateFrameNumbers('enemy_lantern_miner_death', { start: 0, end: 14 }),
            duration: 1500, // 15 帧一次性死亡动画（与 death.animMs 对齐）
            repeat: 0,
        });

        // ---- 巫婆动画 ----
        this.anims.create({
            key: 'enemy_witch_idle',
            frames: this.anims.generateFrameNumbers('enemy_witch_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_witch_walk',
            frames: this.anims.generateFrameNumbers('enemy_witch_walk', { start: 0, end: 10 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_witch_attack',
            frames: this.anims.generateFrameNumbers('enemy_witch_attack', { start: 0, end: 13 }),
            duration: 1500, // 与 magic.duration 对齐（14 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_witch_attack2',
            frames: this.anims.generateFrameNumbers('enemy_witch_attack2', { start: 0, end: 17 }),
            duration: 1500, // 与 venom.duration 对齐（18 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_witch_death',
            frames: this.anims.generateFrameNumbers('enemy_witch_death', { start: 0, end: 16 }),
            duration: 1500, // 17 帧一次性死亡动画（与 death.animMs 对齐）
            repeat: 0,
        });

        // ---- 矿石蜘蛛动画 ----
        this.anims.create({
            key: 'enemy_ore_spider_idle',
            frames: this.anims.generateFrameNumbers('enemy_ore_spider_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_ore_spider_walk',
            frames: this.anims.generateFrameNumbers('enemy_ore_spider_walk', { start: 0, end: 13 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_ore_spider_attack',
            frames: this.anims.generateFrameNumbers('enemy_ore_spider_attack', { start: 0, end: 27 }),
            duration: 1500, // 与 throw.duration 对齐（28 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_ore_spider_slam',
            frames: this.anims.generateFrameNumbers('enemy_ore_spider_slam', { start: 0, end: 17 }),
            duration: 2000, // 与 slam.duration 对齐（18 帧 / 2s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_ore_spider_death',
            frames: this.anims.generateFrameNumbers('enemy_ore_spider_death', { start: 0, end: 11 }),
            duration: 1200, // 与 death.dyingMs 对齐（12 帧 / 1.2s）
            repeat: 0,
        });

        // ---- 僵尸工头动画 ----
        this.anims.create({
            key: 'enemy_foreman_idle',
            frames: this.anims.generateFrameNumbers('enemy_foreman_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_foreman_walk',
            frames: this.anims.generateFrameNumbers('enemy_foreman_walk', { start: 0, end: 19 }),
            frameRate: 8,
            repeat: -1,
        });
        this.anims.create({
            key: 'enemy_foreman_attack',
            frames: this.anims.generateFrameNumbers('enemy_foreman_attack', { start: 0, end: 30 }),
            duration: 1500, // 与 whip.duration 对齐（31 帧 / 1.5s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_foreman_howl',
            frames: this.anims.generateFrameNumbers('enemy_foreman_howl', { start: 0, end: 23 }),
            duration: 3000, // 与 howl.duration 对齐（24 帧 / 3s）
            repeat: 0,
        });
        this.anims.create({
            key: 'enemy_foreman_death',
            frames: this.anims.generateFrameNumbers('enemy_foreman_death', { start: 0, end: 13 }),
            duration: 1400, // 14 帧一次性死亡动画（与 death.animMs 对齐）
            repeat: 0,
        });

        // ---- NPC 动画 ----// 小鼠大王：idle 单帧循环；walk 19 帧循环（帧率读 game-config npcs.shopMouseKing.sprite.walkFps，缺省 10）
        const mouseKingSpriteCfg = GAME_CONFIG?.npcs?.shopMouseKing?.sprite || {};
        this.anims.create({
            key: 'npc_mouse_king_idle',
            frames: this.anims.generateFrameNumbers('npc_mouse_king_idle', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1,
        });
        this.anims.create({
            key: 'npc_mouse_king_walk',
            frames: this.anims.generateFrameNumbers('npc_mouse_king_walk', { start: 0, end: 18 }),
            frameRate: mouseKingSpriteCfg.walkFps ?? 10,
            repeat: -1,
        });
        // 小鼠铁匠：idle 29 帧循环
        this.anims.create({
            key: 'npc_mouse_blacksmith_idle',
            frames: this.anims.generateFrameNumbers('npc_mouse_blacksmith_idle', { start: 0, end: 28 }),
            frameRate: 12,
            repeat: -1,
        });

        // ---- 动态生成几何敌人纹理 ----
        const generateEnemyTexture = (key, drawFn, width = 64, height = 64) => {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            drawFn(g);
            g.generateTexture(key, width, height);
            g.destroy();
        };

        // ---- 墙壁贴图裁剪（JS 兜底：canvas 绘制去除透明区域） ----
        // wall.png 墙面在贴图中间（y=250~750），裁剪去除顶部/底部透明区域
        const cropTexture = (srcKey, dstKey, sx, sy, sw, sh) => {
            if (!this.textures.exists(srcKey)) return;
            const src = this.textures.get(srcKey).source[0].image;
            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
            this.textures.addCanvas(dstKey, canvas);
        };
        cropTexture('wall_horizontal', 'wall_horizontal_cropped', 0, 250, 1024, 500);
        cropTexture('wall_vertical', 'wall_vertical_cropped', 380, 0, 230, 1024);

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

        // 毒蛆毒液弹：透视光照球体（右下深绿阴影 → 中心标准绿 → 左上高光，烘焙进纹理）
        generateEnemyTexture('projectile_poison_maggot', (g) => {            const cx = 32, cy = 32, R = 24;
            const dark = { r: 14, g: 92, b: 28 };    // 边缘阴影色
            const base = { r: 46, g: 204, b: 64 };   // 中心标准绿 0x2ecc40
            const steps = 16;
            for (let i = steps; i >= 1; i--) {
                const t = i / steps; // 1=边缘 → 0=中心
                // 光照方向：左上亮右下暗——亮环中心向左上偏移
                const ox = -t * 4, oy = -t * 4;
                const r = Math.round(base.r + (dark.r - base.r) * t);
                const gg = Math.round(base.g + (dark.g - base.g) * t);
                const b = Math.round(base.b + (dark.b - base.b) * t);
                g.fillStyle((r << 16) | (gg << 8) | b, 1);
                g.fillCircle(cx + ox, cy + oy, R * t);
            }
            // 左上高光点（球面反射）：先大后小，小高光在上层
            g.fillStyle(0xffffff, 0.55);
            g.fillCircle(cx - 6, cy - 7, 8);
            g.fillStyle(0xd8ffe0, 0.9);
            g.fillCircle(cx - 8, cy - 9, 5);
        });

        // 烟雾粒子纹理：白色软圆（径向渐隐，供绿色 tint 着色；tint 是乘法，白底不偏色）
        generateEnemyTexture('smoke_particle', (g) => {
            const steps = 10;
            for (let i = steps; i >= 1; i--) {
                const t = i / steps;
                g.fillStyle(0xffffff, 0.10 * (1 - t) + 0.03);
                g.fillCircle(32, 32, 28 * t);
            }
        }, 64, 64);

        // 曳光弹：短粗圆柱形（两头椭圆胶囊），运行时通过 tint 着色（2026-07-28 改：
        // 原长条形 → 长度减半、粗 1.5 倍，亮度提升更鲜艳）
        generateEnemyTexture('projectile_tracer', (g) => {
            g.fillStyle(0xffffff, 0.25);
            g.fillRoundedRect(0, 16, 128, 32, 16);
            g.fillStyle(0xffffff, 0.6);
            g.fillRoundedRect(0, 21, 128, 22, 11);
            g.fillStyle(0xffffff, 1);
            g.fillRoundedRect(0, 26, 128, 12, 6);
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

        // 切换到主游戏场景
        this.scene.start('GameScene');
    }
}
