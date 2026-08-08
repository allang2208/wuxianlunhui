import { Game } from '../game.js';
import { PLAYER_DEFAULTS } from '../config/player-defaults.js';
import { PLAYER_ANIMS } from '../config/player-anim.js';
import { WEAPON_ANIM } from '../config/math-utils.js';

import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WeaponTransform } from '../combat/weapon-transform.js';
import { loadImage } from '../utils/image-loader.js';

import { queryAllElements, getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { getWeaponTextureLoadList } from '../config/weapon-texture-map.js';
import { findWeaponConfig } from './equip-data-manager.js';

// 武器贴图路径唯一真相源（与游戏内持有贴图一致：weapon-texture-map.js 加载清单）
const WEAPON_TEX_PATH = Object.fromEntries(getWeaponTextureLoadList().map(t => [t.key, t.path]));

// 交互式开发工具 - 武器定位与动画调试面板
const DevTool = {
    _active: false,
    _canvas: null,
    _ctx: null,
    _panel: null,
    _currentTab: 'weapon', // 当前选中的 tab

    // 状态
    state: {
        anim: 'idle',        // 当前动画: idle/walk/running/attack
        weaponType: 'sword', // 当前武器类型
        mode: 'move',        // 'move'=移动+缩放, 'rotate'=旋转
        weaponOnCanvas: false, // 武器是否已放到画布上
        frameIndex: 0,      // 当前帧索引（walk/running/attack）
        playProgress: 0,    // 当前动画播放进度 0~1（用于逐帧插值）
        isPlaying: false,   // 是否正在播放动画
        facingRight: true,  // 朝向预览：false=朝左（位置镜像 + 旋转取反 + 贴图翻转，与游戏 flipX 绑定同口径）
    },

    // 武器参数（可调整）
    weaponParams: {
        offsetX: 0,   // 相对于角色中心的偏移
        offsetY: 30,  // 默认在角色上方（Y+向上，与绿色箭头一致）
        rotation: 0,  // 旋转角度（度）
        scale: 1.0,   // 缩放
        blurX: 0,     // 运动模糊 X（逐帧攻击，0=无）
        blurY: 0,     // 运动模糊 Y
        stretchX: 1,  // 挥砍拉伸 X（逐帧攻击，1=无）
        stretchY: 1,  // 挥砍拉伸 Y
    },

    // 拖拽状态
    drag: {
        active: false,
        startX: 0, startY: 0,
        startOffsetX: 0, startOffsetY: 0,
    },

    // 画布缩放
    zoom: {
        scale: 1.0,
        min: 0.5,
        max: 3.0,
        step: 0.25,
    },

    // 图片缓存
    images: {},
    charImage: null,
    weaponImage: null,
    // 固定点标记（武器局部坐标 px@scale1，随武器刚性跟随；红色）
    marker: null,
    _markerMode: false,

    // 武器配置映射（贴图路径与游戏内持有贴图同源：weapon-texture-map.js）
    // configKey：传给 WeaponTransform / 读 WeaponAnimConfig 的配置键（游戏侧 wt = animConfigKey || weaponType）——
    // 面板键只是选择器（super90/saiga12k 都映射到 shotgun；staff 复用 sword 配置），防止回退到剑
    // weaponId：用于读 EquipDataManager 实例级渲染字段（spriteOffset/aimSpriteOffset 等，与游戏读取链同源）
    WEAPON_MAP: {
        sword:      { name: '生锈长剑',   img: WEAPON_TEX_PATH.weapon_rusty_sword, type: 'melee', configKey: 'sword', weaponId: 'weapon1' },
        staff:      { name: '学徒长杖',   img: WEAPON_TEX_PATH.weapon_staff,        type: 'melee', configKey: 'sword', weaponId: 'weapon20' },
        bow:        { name: '训练弓',     img: 'assets/weapons/trainingBOW.png',        type: 'bow', configKey: 'bow', weaponId: 'weapon16',
                       frames: {
                           idle: ['assets/weapons/trainingBOW.png'],
                           bow_draw: Array.from({length: 8}, (_, i) => `assets/weapons/bow_frame_${String(i+1).padStart(2, '0')}.png`),
                           bow_release: ['assets/weapons/trainingBOW.png'],
                       }
                     },
        pistol:     { name: 'G18',        img: WEAPON_TEX_PATH.weapon_g18,         type: 'pistol', configKey: 'pistol', weaponId: 'weapon9' },
        deagle:     { name: '沙漠之鹰',   img: WEAPON_TEX_PATH.weapon_deagle,  type: 'pistol', configKey: 'deagle', weaponId: 'weapon10' },
        revolver357: { name: '.357麦格农左轮', img: WEAPON_TEX_PATH.weapon_revolver357, type: 'pistol', configKey: 'revolver', weaponId: 'weapon22' },
        p4040:      { name: 'P4040',      img: WEAPON_TEX_PATH.weapon_p4040,   type: 'pistol', configKey: 'p4040', weaponId: 'weapon18' },
        beretta93r: { name: 'Beretta 93R', img: WEAPON_TEX_PATH.weapon_beretta93r, type: 'pistol', configKey: 'beretta93r', weaponId: 'weapon19' },
        pkm:        { name: 'PKM',        img: WEAPON_TEX_PATH.weapon_pkm,      type: 'machinegun', configKey: 'pkm', weaponId: 'weapon6' },
        akm:        { name: 'AKM',        img: WEAPON_TEX_PATH.weapon_akm, type: 'rifle', configKey: 'akm', weaponId: 'weapon7' },
        m416:       { name: 'M416',       img: WEAPON_TEX_PATH.weapon_m416, type: 'rifle', configKey: 'm416', weaponId: 'weapon21' },
        qbz191:     { name: 'QBZ-191',    img: WEAPON_TEX_PATH.weapon_qbz191,   type: 'rifle', configKey: 'qbz191', weaponId: 'weapon8' },
        qjb201:     { name: 'QJB-201',    img: WEAPON_TEX_PATH.weapon_qjb201,         type: 'machinegun', configKey: 'qjb201', weaponId: 'weapon11' },
        super90:    { name: 'Super90',    img: WEAPON_TEX_PATH.weapon_super90,      type: 'shotgun', configKey: 'shotgun', weaponId: 'weapon12' },
        saiga12k:   { name: 'S12K',       img: WEAPON_TEX_PATH.weapon_saiga12k,       type: 'shotgun', configKey: 'shotgun', weaponId: 'weapon13' },
        energy_lmg: { name: '能量轻机枪', img: WEAPON_TEX_PATH.weapon_energy_lmg, type: 'machinegun', configKey: 'energy_lmg', weaponId: 'weapon15' },
    },

    // 面板武器键 → 游戏运行时配置键（游戏侧 wt = animConfigKey || weaponType）：
    // 传给 WeaponTransform / 读 WeaponAnimConfig 一律走这里，防止回退到剑配置
    _configKeyOf(type) {
        const entry = this.WEAPON_MAP[type];
        return (entry && entry.configKey) || type;
    },

    // 面板动画键 → 游戏运行时 animState（WeaponAnimConfig 状态子块键）：
    // 持枪待机/施法时游戏按 'idle' 读取武器位置（cfg.idle 子块优先），面板预览/保存必须同口径，
    // 否则 gun_idle/cast 调整写入顶层而游戏读 idle 子块 → 保存不生效
    _stateKeyOf(anim) {
        if (anim === 'gun_idle' || anim === 'gun_idle_pistol' || anim === 'gun_idle_dual'
            || anim === 'cast' || anim === 'staff_cast') return 'idle';
        return anim;
    },

    // 渲染偏移字段：与 GameScene.syncWeapon 主分支（非 perFrame）同口径读取——
    // rotOffset 枪械贴图固有倾角（度→弧度）；spriteOffsetX/Y 贴图独立偏移（世界 px）；
    // aimSpriteOffset/dualOffsetX/bobWeaponScale 依赖瞄准态/双持/移动 bob，面板不模拟这些上下文，仅展示提示。
    // 读取优先级：EDM 实例配置（按 weaponId 直查）> WeaponAnimConfig（游戏侧 currentItem > EDM > anim 配置，
    // 面板无装备实例，故用 EDM 替代 currentItem 层）
    _getRenderOffsets() {
        const wtKey = this._configKeyOf(this.state.weaponType);
        const wac = WeaponAnimConfig[wtKey] || {};
        const entry = this.WEAPON_MAP[this.state.weaponType];
        const edm = (entry && entry.weaponId) ? findWeaponConfig(entry.weaponId, entry.name) : null;
        const pick = (k) => (edm && edm[k] !== undefined) ? edm[k] : wac[k];
        return {
            rotOffset: wac.rotOffset || 0,
            spriteOffsetX: pick('spriteOffsetX') || 0,
            spriteOffsetY: pick('spriteOffsetY') || 0,
            aimSpriteOffsetX: pick('aimSpriteOffsetX') || 0,
            aimSpriteOffsetY: pick('aimSpriteOffsetY') || 0,
            dualOffsetX: wac.dualOffsetX || 0,
            bobWeaponScale: wac.bobWeaponScale || 1,
        };
    },

    // 把渲染偏移叠加到传统模式（非 perFrame）的武器 local/rotation 上；
    // melee/bow 不叠加（游戏只在 isGun 分支应用这些字段）
    _applyRenderOffsets(local, rotation) {
        const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
        const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
        if (!isGun) return { local, rotation };
        const off = this._getRenderOffsets();
        return {
            local: { ...local, x: local.x + off.spriteOffsetX, y: local.y + off.spriteOffsetY },
            rotation: rotation + off.rotOffset * Math.PI / 180,
        };
    },

    // 朝向预览：朝左时把武器状态镜像（与游戏侧同惯例：近战位置镜像 + 旋转取反 + 贴图翻转；
    // 枪械预览同理做位置镜像 + 旋转取反，flipY 由绘制侧按 |rot|>90° 处理）
    _mirrorForFacing(local, rotation) {
        if (this.state.facingRight !== false) return { local, rotation };
        return {
            local: { ...local, x: -local.x },
            rotation: Math.PI - rotation,
        };
    },

    // 动画状态映射
    ANIM_NAME: {
        idle: '待机', walk: '移动', running: '奔跑', attack: '攻击',
        attack2: '二段攻击', dash: '冲刺攻击', recover: '收势',
        dash_recover: '冲刺收势', dodge_roll: '翻滚', dodge_jump: '跳跃闪避',
        cast: '空手施法', staff_cast: '法杖施法',
        bow_draw: '拉弓', bow_release: '射箭',
        gun_idle: '持枪待机', gun_idle_pistol: '持枪待机·手枪', gun_idle_dual: '持枪待机·双持', gun_fire: '射击',
        reload: '换弹', hurt: '受击', death: '死亡',
    },

    // 面板动画键 → player-anim-config.json 配置键
    // （面板历史命名 running/attack 与配置键 run/attack_sword 不同，在此统一映射）
    PANEL_ANIM_TO_CONFIG: {
        idle: 'idle', walk: 'walk', running: 'run', attack: 'attack_sword',
        attack2: 'attack_sword_2', dash: 'dash_attack', recover: 'recover',
        dash_recover: 'dash_recover', dodge_roll: 'dodge_roll', dodge_jump: 'dodge_jump',
        cast: 'cast', staff_cast: 'staff_cast',
        bow_draw: 'bow_draw', bow_release: 'bow_release',
        gun_idle: 'gun_idle', gun_idle_pistol: 'gun_idle_pistol', gun_idle_dual: 'gun_idle_dual', gun_fire: 'gun_fire',
        reload: 'reload', hurt: 'hurt', death: 'death',
    },

    init() {
        this._panel = getElement('devToolPanel');
        this._canvas = getElement('devToolCanvas');
        // 增大画布以容纳与游戏一致的角色缩放（703px）
        this._canvas.width = 640;
        this._canvas.height = 520;
        this._ctx = this._canvas.getContext('2d');
        this._loadImages();
        this._bindEvents();
        this._syncInputs();
        this._draw();
        this._updateFrameSlider();
        this._updateFrameLabel();
        this._updatePlayBtn();
        this._syncFpsInput();
    },

    // Tab 切换
    switchTab(tabName) {
        this._currentTab = tabName;
        // 更新 tab 按钮状态
        queryAllElements('.dev-tool-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        // 更新 tab 内容显示
        queryAllElements('.dev-tool-tab-content').forEach(content => {
            const contentTab = content.dataset.tabContent || content.dataset.tab;
            content.style.display = contentTab === tabName ? 'flex' : 'none';
            content.classList.toggle('active', contentTab === tabName);
        });
    },

    // 加载图片
    _loadImages() {
        // 角色待机贴图：与游戏同源（PLAYER_ANIMS.idle.src），避免 character/ 与 player/ 双份漂移
        this.charImage = new Image();
        this.charImage.src = (PLAYER_ANIMS.idle && PLAYER_ANIMS.idle.src) || 'assets/player/idle.png';
        this.charImage.onload = () => this._draw();

        // 加载角色动画帧（使用新版奔跑帧）
        this._loadCharacterFrames();

        // 预加载所有武器图片
        for (const key in this.WEAPON_MAP) {
            this.images[key] = loadImage(this.WEAPON_MAP[key].img);
        }

        // 加载默认武器
        this._loadWeapon(this.state.weaponType);
    },

    _loadWeapon(type) {
        const cfg = this.WEAPON_MAP[type];
        if (!cfg) return;
        this.weaponImage = this.images[type];
        if (!this.weaponImage) {
            this.weaponImage = loadImage(cfg.img);
            this.images[type] = this.weaponImage;
        }
        this.weaponImage.onload = () => {
            // 预加载帧图片
            this._loadFrameImages(type);
            this._updateWeaponPreview();
            this._draw();
        };
        this._updateWeaponPreview();
    },

    // 获取当前武器在 WeaponTransform 中的基础/旋转后偏移（用于反向计算）
    _getWeaponTransformBase() {
        return WeaponTransform.getWeaponBaseOffset(this._configKeyOf(this.state.weaponType), false, false);
    },

    // 根据当前面板参数构造 WeaponTransform 的 overrides
    _buildPreviewOverrides() {
        // weaponParams.offsetX/Y 表示武器中心/握把位置
        const { baseX, baseY, afterX, afterY } = this._getWeaponTransformBase();
        return {
            idleRotation: this.weaponParams.rotation,
            idleScale: this.weaponParams.scale,
            holdOffsetX: this.weaponParams.offsetX - baseX - afterX,
            holdOffsetY: this.weaponParams.offsetY - baseY - afterY,
        };
    },

    // 持久化 WeaponAnimConfig 到 Electron 文件系统（如果可用）
    // 返回 Promise：与 _exportPerFrameFile 写同一路径，调用方需串行 await 避免双写竞态
    _persistWeaponConfig() {
        // JS 运行时注入的非数据源键必须剔除再序列化：stab=刺击常量（含函数）、staff=sword 别名，
        // 全量保存会把它们写进 JSON（膨胀 + 加载后 staff 别名因 JSON 已有 staff 而不重建）
        const stripRuntimeKeys = (cfg) => {
            const out = {};
            for (const [k, v] of Object.entries(cfg)) {
                if (k === 'stab' || k === 'staff') continue;
                out[k] = v;
            }
            return out;
        };
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveWeaponConfig) {
            return window.electronAPI.saveWeaponConfig(stripRuntimeKeys(WeaponAnimConfig)).catch(err => {
                console.error('[DevTool] Failed to persist weapon config:', err);
            });
        }
        // 纯浏览器 dev 模式（无 Electron）：走 vite 中间件落盘，与 perFrame 同路径
        if (typeof fetch !== 'undefined') {
            return fetch('/__save-weapon-config', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ config: stripRuntimeKeys(WeaponAnimConfig) }),
            }).then(r => r.json()).catch(err => {
                console.error('[DevTool] Failed to persist weapon config via middleware:', err);
            });
        }
        return Promise.resolve();
    },

    // 逐帧武器数据导出：覆盖写固定文件 weapon-frames/latest.js（Electron IPC 或 Vite 中间件）
    // 保存时已由中间件/IPC 直接合并进 public/data/weapon-anim-config.json（写前滚动备份）——
    // 无需再通知助手合并；latest.js 仅作记录/回滚参考
    _exportPerFrameFile(wt, cfg, panelWt = wt) {
        const saveKey = this._perFrameCfgKey(this.state.anim);
        const payload = {
            exportedAt: new Date().toISOString(),
            weaponType: wt,
            weaponName: this.WEAPON_MAP[panelWt]?.name || wt,
            anim: saveKey, // 配置块名（walk→walkFrames；attack/attack2/dash 同名）——中间件按此合并
            animLabel: this.state.anim, // 面板显示名（记录用）
            mode: 'perFrame',
            frameCount: cfg[saveKey].frames.length,
            fields: {
                offsetX: '相对角色中心偏移X（px，右为正）',
                offsetY: '相对角色中心偏移Y（px，Canvas 坐标下为正）',
                rotation: '武器旋转角度（度）',
                scale: '武器缩放',
            },
            frames: cfg[saveKey].frames,
        };
        const done = (ok, merged) => {
            this._showToast(ok
                ? (merged ? '✅ 已保存并写入 weapon-anim-config.json（刷新仍生效）' : '✅ 已保存并导出 weapon-frames/latest.js')
                : '✅ 已保存（⚠️ 文件写入失败，刷新后丢失）');
        };
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveWeaponFrames) {
            return window.electronAPI.saveWeaponFrames(payload).then((r) => done(true, r && r.merged)).catch(() => done(false, false));
        } else if (typeof fetch !== 'undefined') {
            return fetch('/__save-weapon-frames', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            }).then(r => r.json().then(j => done(r.ok, j && j.merged))).catch(() => done(false, false));
        }
        return Promise.resolve();
    },

    /**
     * 把当前配置直接加载到预览画布上
     * 切换动画/武器/按重置/拖动滑块时调用，避免用户每次都从空白开始拖动
     */
    // ===== 逐帧默认种子（拆帧无配置时/重置攻击动画用）=====
    // attack：全部帧同一基线位置（传统模式 attack 位）；
    // attack2：优先复制 attack 的帧作基线（从一段轨迹出发调二段），无 attack 配置时同 attack 种子
    _seedPerFrameDefaults(wt, anim = 'attack') {
        // 帧数：walk=walk 动画帧数（21，与贴图逐帧一一对应）；attack/attack2/dash=30（与 sword 标杆一致）
        const walkDef = this.PANEL_ANIM_TO_CONFIG[anim] === 'walk'
            ? (PLAYER_ANIMS.walk && PLAYER_ANIMS.walk.frames) : null;
        const SEED_FRAMES = walkDef ? (walkDef[1] - walkDef[0] + 1) : 30;
        const key = this._perFrameCfgKey(anim);
        const cfgKey = this._configKeyOf(wt);
        if (!WeaponAnimConfig[cfgKey]) WeaponAnimConfig[cfgKey] = {};
        const atkBlock = WeaponAnimConfig[cfgKey].attack;
        let frames;
        if (key !== 'attack' && atkBlock && atkBlock.type === 'perFrame' && atkBlock.frames && atkBlock.frames.length) {
            frames = atkBlock.frames.map(f => ({ ...f }));
        } else {
            const overrides = this._buildPreviewOverrides();
            const stateKey = anim === 'walk' ? 'walk' : 'attack';
            const localOffset = WeaponTransform.getWeaponLocalOffset(cfgKey, WEAPON_ANIM.size, false, false, stateKey, true, overrides);
            const base = {
                offsetX: Math.round(localOffset.x),
                offsetY: Math.round(localOffset.y),
                rotation: Math.round((localOffset.idleRotation || 0) * 180 / Math.PI),
                scale: parseFloat((localOffset.scale || 1).toFixed(2)),
            };
            frames = Array.from({ length: SEED_FRAMES }, () => ({ ...base }));
        }
        const existing = WeaponAnimConfig[cfgKey][key] || {};
        WeaponAnimConfig[cfgKey][key] = { ...existing, type: 'perFrame', frames };
        return WeaponAnimConfig[cfgKey][key].frames;
    },

    _applyCurrentConfigToPreview() {
        const panelWt = this.state.weaponType;
        const wt = this._configKeyOf(panelWt);
        const anim = this.state.anim;
        const stateKey = this._stateKeyOf(anim); // gun_idle/cast → idle（游戏读取口径）
        const cfg = WeaponAnimConfig[wt];
        if (!cfg) return;

        let offsetX, offsetY, rotation, scale;

        let perFrame = this._isPerFrameAnim(anim) ? this._getPerFrameFrames(wt, anim) : null;
        if (!perFrame && this._isPerFrameAnim(anim)) {
            // 拆帧无配置：自动播种（attack=全部帧同一基线位置；attack2=复制 attack 帧），进入逐帧模式即可直接开调
            perFrame = this._seedPerFrameDefaults(wt, anim);
        }
        if (perFrame && this._isPerFrameAnim(anim)) {
            // 逐帧模式：weaponParams 直接表示当前帧的武器状态
            const idx = Math.max(0, Math.min(this.state.frameIndex, perFrame.length - 1));
            const frame = perFrame[idx];
            offsetX = frame.offsetX || 0;
            offsetY = frame.offsetY || 0;
            rotation = frame.rotation || 0;
            scale = frame.scale !== undefined ? frame.scale : 1;
            this.weaponParams.blurX = frame.blurX || 0;
            this.weaponParams.blurY = frame.blurY || 0;
            this.weaponParams.stretchX = frame.stretchX !== undefined ? frame.stretchX : 1;
            this.weaponParams.stretchY = frame.stretchY !== undefined ? frame.stretchY : 1;
            this.state.playProgress = perFrame.length > 1 ? idx / (perFrame.length - 1) : 0;
        } else {
            // 传统模式：weaponParams 表示武器中心位置 + 基础旋转/缩放（模糊/拉伸复位默认）
            this.weaponParams.blurX = 0;
            this.weaponParams.blurY = 0;
            this.weaponParams.stretchX = 1;
            this.weaponParams.stretchY = 1;
            const overrides = this._buildPreviewOverrides();
            const staffOverrides = this._staffStateOverrides(stateKey, overrides);
            const localOffset = WeaponTransform.getWeaponLocalOffset(wt, WEAPON_ANIM.size, false, false, stateKey, true, staffOverrides);
            offsetX = localOffset.x;
            offsetY = localOffset.y;
            rotation = (localOffset.idleRotation || 0) * 180 / Math.PI;
            scale = localOffset.scale || 1;
        }

        const pBlurX = this.weaponParams.blurX, pBlurY = this.weaponParams.blurY;
        const pStrX = this.weaponParams.stretchX, pStrY = this.weaponParams.stretchY;
        this.weaponParams = {
            offsetX: Math.round(offsetX),
            offsetY: Math.round(offsetY),
            rotation: Math.round(rotation),
            scale: parseFloat(scale.toFixed(2)),
            blurX: pBlurX, blurY: pBlurY,
            stretchX: pStrX, stretchY: pStrY,
        };
        this._frameDirty = false; // 从配置重载完成，清除"当前帧已修改"标记
        this.state.weaponOnCanvas = true;
        this._syncInputs();
        this._draw();
    },

    // 根据当前 playProgress 平滑插值逐帧配置
    _getPerFrameTransform() {
        const wt = this._configKeyOf(this.state.weaponType);
        const anim = this.state.anim;
        const perFrame = this._getPerFrameFrames(wt, anim);
        if (!perFrame || !this._isPerFrameAnim(anim)) return null;

        // walk（循环动画）走 Catmull-Rom 平滑样条（与游戏 syncWeapon 同口径，面板预览一致）；
        // attack/attack2/dash 保持线性插值（与既有轨迹观感一致）
        // 法杖（staff）：walk 逐帧读 staffWalkFrames（中段握持，轨迹整体下移 55px），与游戏 syncWeapon 同口径
        const isStaffSel = this.WEAPON_MAP[this.state.weaponType]?.configKey === 'sword'
            && this.state.weaponType === 'staff';
        const walkKey = anim === 'walk' ? (isStaffSel ? 'staffWalkFrames' : 'walkFrames') : null;
        // 法杖施法（staff_cast）：按当前帧读 staffCastFrames（举杖轨迹，与游戏 syncWeapon 同口径）
        let pos = null;
        if (isStaffSel && (anim === 'staff_cast' || anim === 'cast')) {
            const castFrames = WeaponAnimConfig[wt] && WeaponAnimConfig[wt].staffCastFrames;
            if (castFrames && castFrames.type === 'perFrame' && castFrames.frames) {
                const idx = Math.max(0, Math.min(castFrames.frames.length - 1, this.state.frameIndex));
                const cf = castFrames.frames[idx];
                pos = {
                    x: cf.offsetX, y: cf.offsetY,
                    rotation: (cf.rotation || 0) * Math.PI / 180,
                    scale: cf.scale !== undefined ? cf.scale : 1,
                };
            }
        }
        if (!pos) {
            pos = (anim === 'walk')
                ? WeaponTransform.getSmoothPerFramePosition(
                    { x: 0, y: 0, rotation: 0 }, wt, this.state.playProgress || 0, true, walkKey
                )
                : WeaponTransform.getInterpolatedPerFramePosition(
                    { x: 0, y: 0, rotation: 0 }, wt, this.state.playProgress || 0, true, this._perFrameCfgKey(anim)
                );
        }
        if (!pos) return null;
        const wSize = WeaponTransform.getWeaponSize(wt, pos.scale, anim);
        return {
            local: { x: pos.x, y: pos.y, size: wSize.height / pos.scale, scale: pos.scale },
            rotation: pos.rotation,
            blurX: pos.blurX || 0,
            blurY: pos.blurY || 0,
            stretchX: pos.stretchX !== undefined ? pos.stretchX : 1,
            stretchY: pos.stretchY !== undefined ? pos.stretchY : 1,
        };
    },

    // 将当前 weaponParams 同步回逐帧配置
    _syncPerFrameFromWeaponParams() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const perFrame = this._getPerFrameFrames(wt, anim);
        if (!perFrame || !this._isPerFrameAnim(anim)) return;

        const idx = Math.max(0, Math.min(this.state.frameIndex, perFrame.length - 1));
        perFrame[idx] = {
            offsetX: this.weaponParams.offsetX,
            offsetY: this.weaponParams.offsetY,
            rotation: this.weaponParams.rotation,
            scale: this.weaponParams.scale,
            blurX: this.weaponParams.blurX || 0,
            blurY: this.weaponParams.blurY || 0,
            stretchX: this.weaponParams.stretchX !== undefined ? this.weaponParams.stretchX : 1,
            stretchY: this.weaponParams.stretchY !== undefined ? this.weaponParams.stretchY : 1,
        };
        this._frameDirty = true; // 标记当前帧已修改：切帧时下一帧继承本帧位置（见帧滑块处理）
    },

    _updateWeaponPreview() {
        const preview = getElement('devToolWeaponPreview');
        const img = getElement('devToolWeaponImg');
        const placeholder = preview.querySelector('.dev-tool-weapon-placeholder');
        if (this.weaponImage && this.weaponImage.complete && this.weaponImage.naturalWidth > 0) {
            img.src = this.weaponImage.src;
            img.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        } else {
            img.style.display = 'none';
            if (placeholder) placeholder.style.display = 'block';
        }
        // 更新武器名称
        const nameEl = getElement('devToolWeaponName');
        if (nameEl) nameEl.textContent = this.WEAPON_MAP[this.state.weaponType]?.name || '无';
    },

    // 绑定事件
    _bindEvents() {
        // 触发按钮
        const trigger = getElement('devToolTrigger');
        if (trigger) trigger.addEventListener('click', () => this.toggle());

        // 关闭按钮
        const closeBtn = getElement('devToolClose');
        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

        // 动画选择
        const animSelect = getElement('devToolAnimSelect');
        if (animSelect) {
            animSelect.addEventListener('change', (e) => {
                this.state.anim = e.target.value;
                this.state.frameIndex = 0;
                this.state.isPlaying = false;
                this._stopFrameAnimation();
                this._updateFrameSlider();
                this._updateFrameLabel();
                this._updatePlayBtn();
                this._updateStatus();
                this._syncFpsInput();
                // 直接加载当前配置到预览画布，避免空白/错位
                this._applyCurrentConfigToPreview();
            });
        }

        // 武器选择
        const weaponSelect = getElement('devToolWeaponSelect');
        if (weaponSelect) {
            weaponSelect.addEventListener('change', (e) => {
                this.state.weaponType = e.target.value;
                this._loadWeapon(this.state.weaponType);
                // 直接加载当前配置到预览画布
                this._applyCurrentConfigToPreview();
            });
        }

        // 保存按钮
        const saveBtn = getElement('devToolSave');
        if (saveBtn) saveBtn.addEventListener('click', () => this._save());

        // 重置按钮
        const resetBtn = getElement('devToolReset2');
        if (resetBtn) resetBtn.addEventListener('click', () => this._reset());

        // 坐标工具按钮
        const coordBtn = getElement('devToolCoord');
        if (coordBtn) coordBtn.addEventListener('click', () => this._startCoordTool());

        // 朝向切换按钮
        const flipBtn = getElement('devToolFlip');
        if (flipBtn) flipBtn.addEventListener('click', () => {
            this.state.facingRight = !this.state.facingRight;
            flipBtn.classList.toggle('active', !this.state.facingRight);
            flipBtn.textContent = this.state.facingRight ? '↔ 朝左' : '→ 朝右';
            this._draw();
        });

        // fps 输入框：仅在用户真正输入时标记手动覆盖（_syncFpsInput 的自动填入不算，
        // 否则逐帧时长 frameWeights 会被"手动覆盖"误判永久忽略）
        const fpsInput = getElement('devToolFps');
        if (fpsInput) fpsInput.addEventListener('input', () => { this._fpsManualOverride = true; });

        // 📍 固定点工具：无标记→进入放置模式；有标记→清除；放置模式中→退出
        const markerBtn = getElement('devToolMarker');
        if (markerBtn) markerBtn.addEventListener('click', () => {
            if (this._markerMode) {
                this._markerMode = false;
                this._showToast('已退出固定点放置');
            } else if (this.marker) {
                this.marker = null;
                this._showToast('📍 已清除固定点');
                this._draw();
            } else {
                this._markerMode = true;
                this._showToast('📍 点击画布上的武器放置固定点');
            }
            markerBtn.classList.toggle('active', this._markerMode);
        });

        // 缩放按钮
        const zoomInBtn = getElement('devToolZoomIn');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this._zoomIn());
        
        const zoomOutBtn = getElement('devToolZoomOut');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this._zoomOut());
        
        const zoomResetBtn = getElement('devToolZoomReset');
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => this._zoomReset());

        // Canvas 鼠标交互
        this._canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this._canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this._canvas.addEventListener('mouseup', () => this._onMouseUp());
        this._canvas.addEventListener('mouseleave', () => this._onMouseUp());
        this._canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // 输入框实时同步（含逐帧攻击的模糊/拉伸）
        ['devToolOffX', 'devToolOffY', 'devToolRot', 'devToolScl', 'devToolBlurX', 'devToolBlurY', 'devToolStrX', 'devToolStrY'].forEach((id, idx) => {
            const el = getElement(id);
            if (!el) return;
            const keys = ['offsetX', 'offsetY', 'rotation', 'scale', 'blurX', 'blurY', 'stretchX', 'stretchY'];
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                if (!isNaN(val)) {
                    this.weaponParams[keys[idx]] = val;
                    this._syncPerFrameFromWeaponParams();
                    this._draw();
                }
            });
        });

        // 帧滑块
        const frameSlider = getElement('devToolFrameSlider');
        if (frameSlider) {
            frameSlider.addEventListener('input', (e) => {
                this.state.frameIndex = parseInt(e.target.value);
                this.state.isPlaying = false;
                this._stopFrameAnimation();
                const perFrame = this._getPerFrameFrames(this.state.weaponType, this.state.anim);
                if (perFrame && this._isPerFrameAnim(this.state.anim) && this._frameDirty) {
                    // 逐帧调整流：上一帧刚被修改过时，切帧不重载该帧已存配置——
                    // 武器贴图直接继承上一帧的位置/角度/缩放，在此基础上继续调（渐进式逐帧工作流）
                    const n = perFrame.length;
                    this.state.playProgress = n > 1 ? Math.max(0, Math.min(this.state.frameIndex, n - 1)) / (n - 1) : 0;
                    this._syncInputs();
                    this._draw();
                } else {
                    this._applyCurrentConfigToPreview();
                }
                this._updateFrameLabel();
                this._updatePlayBtn();
            });
        }

        // 播放/暂停按钮
        const playBtn = getElement('devToolPlayBtn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.state.isPlaying = !this.state.isPlaying;
                this._updatePlayBtn();
                if (this.state.isPlaying) {
                    this._startFrameAnimation();
                } else {
                    this._stopFrameAnimation();
                }
            });
        }

        // 键盘事件（R键切换模式）
        document.addEventListener('keydown', (e) => {
            if (!this._active) return;
            if (e.key.toLowerCase() === 'r') {
                e.preventDefault();
                this._toggleMode();
            }
            if (e.key === 'Escape') {
                this.hide();
            }
        });

        // 武器图片拖放
        const weaponImg = getElement('devToolWeaponImg');
        if (weaponImg) {
            weaponImg.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('weapon', this.state.weaponType);
            });
        }

        // Tab 点击绑定在 panels/dev-tools.js 建 tab 时已完成，此处不再重复绑定（避免 switchTab 每次执行两次）
    },

    // 加载角色动画帧（配置驱动：data/player-anim-config.json）
    // 素材未配置的动画键跳过，绘制时回退待机图；新增姿态入库+加配置即自动生效
    _loadCharacterFrames() {
        this._charFrames = {};

        // 待机：单帧（直接存 Image，_getCharacterImage 对 idle 特判返回 charImage）
        this._charFrames.idle = this.charImage;

        Object.entries(this.PANEL_ANIM_TO_CONFIG).forEach(([panelKey, cfgKey]) => {
            if (panelKey === 'idle') return;
            const def = PLAYER_ANIMS[cfgKey];
            if (!def) return;
            // 单帧姿态（如 gun_idle）：直接作为预览图
            if (def.type === 'image') {
                const poseImg = new Image();
                poseImg.onload = () => { this._draw(); };
                poseImg.src = def.src;
                this._charFrames[panelKey] = poseImg;
                return;
            }
            if (def.type !== 'sheet') return;
            const [start, end] = def.frames || [0, (def.frameCount || 1) - 1];
            const frameData = {
                sheet: new Image(),
                cols: def.cols || 8,
                rows: def.rows || 1,
                frameW: def.frameWidth,
                frameH: def.frameHeight,
                firstFrame: start,          // 帧区间起点（如 run 只用 sheet 第一行 0~7）
                count: end - start + 1,
                frameRate: def.frameRate || 12,
                // 手部分层（walk 等）：身体层 sheet + 手层 sheet（同网格同帧序），
                // 预览绘制顺序 = 身体 → 武器 → 手（与游戏 depth 分层一致）
                handLayer: def.handLayer ? {
                    body: new Image(),
                    hand: new Image(),
                } : null,
                // 施法节奏（cast/staff_cast）：前摇正放 → releaseFrame 释放 → 倒放后摇，与游戏 startPlayerCast 同口径
                releaseFrame: def.releaseFrame,
                forwardMs: def.forwardMs,
                recoverMs: def.recoverMs,
            };
            if (frameData.handLayer) {
                frameData.handLayer.body.onload = () => { this._draw(); };
                frameData.handLayer.body.src = def.handLayer.body;
                frameData.handLayer.hand.onload = () => { this._draw(); };
                frameData.handLayer.hand.src = def.handLayer.hand;
            }
            // 逐帧时长与游戏同源（frameWeights 权重 / frameDurations 毫秒，公式同 BootScene）——
            // 面板预览自动跟随配置，调节奏无需手动同步面板
            if (def.frameWeights && def.frameWeights.length) {
                const totalMs = ((end - start + 1) / frameData.frameRate) * 1000;
                const wSum = def.frameWeights.reduce((a, b) => a + (b || 0), 0) || 1;
                frameData.durations = Array.from({ length: end - start + 1 }, (_, i) => ((def.frameWeights[i] || 0) / wSum) * totalMs);
            } else if (def.frameDurations && def.frameDurations.length) {
                frameData.durations = def.frameDurations.slice(0, end - start + 1);
            }
            frameData.sheet.onload = () => { this._draw(); };
            frameData.sheet.src = def.src;
            this._charFrames[panelKey] = frameData;
        });

        // 持枪模式移动预览部件（twist.walkLegs 走腿 sheet + 躯干层，与游戏内分层一致）。
        // 按姿态分别加载（gun_idle 长枪 / gun_idle_pistol 单持手枪 / gun_idle_dual 双持），
        // _draw 按当前武器类型选择——各姿态 walkLegs 的 bobXScale/bobScale 不同，不能共用 gun_idle
        this._gunLayers = {};
        for (const poseKey of ['gun_idle', 'gun_idle_pistol', 'gun_idle_dual']) {
            const gunTwist = PLAYER_ANIMS[poseKey] && PLAYER_ANIMS[poseKey].twist;
            if (!gunTwist || !gunTwist.walkLegs) continue;
            const wl = gunTwist.walkLegs;
            const [wlStart, wlEnd] = wl.frames || [0, (wl.frameCount || 1) - 1];
            const layer = {
                walkFrames: {
                    sheet: new Image(),
                    cols: wl.cols || 8,
                    frameW: wl.frameWidth,
                    frameH: wl.frameHeight,
                    firstFrame: wlStart,
                    count: wlEnd - wlStart + 1,
                },
                torso: null,
            };
            layer.walkFrames.sheet.onload = () => { this._draw(); };
            layer.walkFrames.sheet.src = wl.src;
            if (gunTwist.torsoSrc) {
                layer.torso = new Image();
                layer.torso.onload = () => { this._draw(); };
                layer.torso.src = gunTwist.torsoSrc;
            }
            this._gunLayers[poseKey] = layer;
        }
    },

    // 面板武器类型 → 持枪姿态（与游戏 GameScene._resolveGunPose 单持口径一致；
    // 面板无副手选择，双持姿态仅在有配置时作为回退存在）
    _gunPoseKeyFor() {
        const type = this.WEAPON_MAP[this.state.weaponType]?.type;
        if (type === 'pistol') return 'gun_idle_pistol';
        return 'gun_idle';
    },

    // 法杖静态姿态（idle/walk/running）覆盖为独立 staffIdle 块（中段握持，与游戏 syncWeapon 同口径）
    _staffStateOverrides(stateKey, overrides = {}) {
        if (this.state.weaponType !== 'staff') return overrides;
        const wt = this._configKeyOf(this.state.weaponType);
        const si = WeaponAnimConfig[wt] && WeaponAnimConfig[wt].staffIdle;
        if (!si || !(stateKey === 'idle' || stateKey === 'walk' || stateKey === 'running')) return overrides;
        return {
            ...overrides,
            holdOffsetX: si.holdOffsetX,
            holdOffsetY: si.holdOffsetY,
            idleRotation: si.idleRotation,
            idleScale: si.idleScale,
        };
    },

    // 更新帧滑块范围
    _updateFrameSlider() {
        const slider = getElement('devToolFrameSlider');
        if (!slider) { return; }
        const currentAnim = this.state.anim;
        const perFrameTotal = this._getPerFrameTotal();
        const total = perFrameTotal > 1 ? perFrameTotal : (
            (this._charFrames[currentAnim] && this._charFrames[currentAnim].count) || 1
        );

        if (total > 1) {
            slider.max = total - 1;
            slider.min = 0;
            slider.value = this.state.frameIndex;
            slider.disabled = false;
        } else {
            slider.max = 0;
            slider.min = 0;
            slider.value = 0;
            slider.disabled = true;
        }
    },

    // ===== 逐帧（perFrame）动画通用：attack→attack 块，attack2→attack2 块，dash→dash 块，walk→walkFrames 块 =====
    _perFrameCfgKey(anim) {
        if (anim === 'walk') {
            // 法杖：独立 staffWalkFrames 块（中段握持，与游戏 syncWeapon 同口径）
            if (this.state.weaponType === 'staff') return 'staffWalkFrames';
            return 'walkFrames';
        }
        // 法杖施法（staff_cast / cast）：独立 staffCastFrames 块（举杖轨迹，与游戏 syncWeapon 同口径）
        if ((anim === 'staff_cast' || anim === 'cast') && this.state.weaponType === 'staff') {
            return 'staffCastFrames';
        }
        return anim === 'attack2' ? 'attack2' : (anim === 'dash' ? 'dash' : 'attack');
    },
    // walk 仅当配置存在 walkFrames 时才算逐帧（否则回退传统 holdOffset 模式）
    _isPerFrameAnim(anim) {
        if (anim === 'attack' || anim === 'attack2' || anim === 'dash') return true;
        if (anim === 'walk') {
            const wt = this._configKeyOf(this.state.weaponType);
            const key = this.state.weaponType === 'staff' ? 'staffWalkFrames' : 'walkFrames';
            const wf = WeaponAnimConfig[wt] && WeaponAnimConfig[wt][key];
            return !!(wf && wf.type === 'perFrame' && wf.frames && wf.frames.length);
        }
        // 法杖施法（staff_cast / cast）：staffCastFrames 存在即进入逐帧模式（面板可预览/调参）
        if ((anim === 'staff_cast' || anim === 'cast') && this.state.weaponType === 'staff') {
            const wt = this._configKeyOf(this.state.weaponType);
            const wf = WeaponAnimConfig[wt] && WeaponAnimConfig[wt].staffCastFrames;
            return !!(wf && wf.type === 'perFrame' && wf.frames && wf.frames.length);
        }
        return false;
    },
    _getPerFrameFrames(wt, anim) {
        const cfg = WeaponAnimConfig[this._configKeyOf(wt)];
        const key = this._perFrameCfgKey(anim);
        const block = cfg && cfg[key];
        return (block && block.type === 'perFrame' && block.frames) ? block.frames : null;
    },

    // 当前逐帧配置的总帧数（仅 attack/attack2 perFrame 模式）
    _getPerFrameTotal() {
        const anim = this.state.anim;
        if (!this._isPerFrameAnim(anim)) return 0;
        const perFrame = this._getPerFrameFrames(this.state.weaponType, anim);
        return perFrame ? perFrame.length : 0;
    },

    // 更新帧编号显示
    _updateFrameLabel() {
        const label = getElement('devToolFrameLabel');
        if (!label) return;
        const perFrameTotal = this._getPerFrameTotal();
        const total = perFrameTotal > 1 ? perFrameTotal : (
            (this._charFrames[this.state.anim] && this._charFrames[this.state.anim].count) || 1
        );
        const current = this.state.frameIndex + 1;
        label.textContent = `${current} / ${total}`;
    },

    // 更新播放按钮文字
    _updatePlayBtn() {
        const btn = getElement('devToolPlayBtn');
        if (!btn) return;
        btn.textContent = this.state.isPlaying ? '⏸ 暂停' : '▶ 播放';
    },

    // 当前预览帧率：优先面板 fps 输入框，其次动画配置的 frameRate，最后回退 60ms/帧
    _getPreviewFps(frameData) {
        const fpsInput = getElement('devToolFps');
        const manual = fpsInput ? parseFloat(fpsInput.value) : NaN;
        if (Number.isFinite(manual) && manual > 0) return manual;
        if (frameData && frameData.frameRate) return frameData.frameRate;
        return 1000 / 60;
    },

    // 切换动画时把 fps 输入框同步为该动画的配置帧率（可手动覆盖）
    _syncFpsInput() {
        const fpsInput = getElement('devToolFps');
        if (!fpsInput) return;
        const frameData = this._charFrames[this.state.anim];
        fpsInput.value = (frameData && frameData.frameRate) || '';
        this._fpsManualOverride = false; // 自动填入≠手动覆盖
    },

    // fps 输入框是否被用户手动覆盖（手动覆盖时忽略逐帧时长，按均匀帧率预览）
    _isFpsManual() {
        return this._fpsManualOverride === true;
    },

    // 启动帧动画循环
    _startFrameAnimation() {
        if (this._frameAnimId) cancelAnimationFrame(this._frameAnimId);

        const frameData = this._charFrames[this.state.anim];
        if (!frameData || !frameData.count || frameData.count <= 1) return;

        const wt = this.state.weaponType;
        const perFrame = this._getPerFrameFrames(wt, this.state.anim);
        const isPerFrame = perFrame && this._isPerFrameAnim(this.state.anim);

        // 施法姿态（cast/staff_cast）：前摇正放 → releaseFrame 释放 → 倒放后摇循环，
        // 与游戏 startPlayerCast（forwardMs / recoverMs / releaseFrame）同节奏
        const castFrames = (this.state.anim === 'cast' || this.state.anim === 'staff_cast') && frameData;
        if (castFrames && castFrames.forwardMs > 0 && castFrames.releaseFrame !== undefined) {
            const forwardMs = castFrames.forwardMs;
            const recoverMs = castFrames.recoverMs || 0;
            const releaseFrame = castFrames.releaseFrame;
            const startTime = performance.now();
            const loop = (timestamp) => {
                if (!this.state.isPlaying) return;
                const elapsed = timestamp - startTime;
                const cycle = forwardMs + Math.max(1, recoverMs);
                const phase = (elapsed % cycle);
                // 前摇：0→releaseFrame 正放；后摇：releaseFrame→0 倒放（末帧停留 40ms 后倒放）
                if (phase < forwardMs) {
                    const t = Math.min(1, phase / forwardMs);
                    this.state.frameIndex = Math.min(releaseFrame, Math.round(t * releaseFrame));
                } else {
                    const t = (phase - forwardMs) / Math.max(1, recoverMs);
                    this.state.frameIndex = Math.max(0, Math.round(releaseFrame * (1 - t)));
                }
                this.state.playProgress = this.state.frameIndex / Math.max(1, frameData.count - 1);
                this._updateFrameLabel();
                const slider = getElement('devToolFrameSlider');
                if (slider) slider.value = this.state.frameIndex;
                this._draw();
                this._frameAnimId = requestAnimationFrame(loop);
            };
            this._frameAnimId = requestAnimationFrame(loop);
            return;
        }

        // 逐帧模式：使用连续进度做 0~1 的平滑插值，和普通逐帧预览区分
        if (isPerFrame) {
            // 总时长：有逐帧时长配置（frameWeights/frameDurations）且未手动覆盖 fps 时取各帧之和（与游戏一致），
            // 否则按均匀帧率（默认 8 帧 @ 12fps ≈ 667ms，fps 输入框可覆盖）
            const duration = (frameData.durations && !this._isFpsManual())
                ? frameData.durations.reduce((a, b) => a + (b || 0), 0)
                : 1000 * frameData.count / this._getPreviewFps(frameData);
            const startTime = performance.now();
            const loop = (timestamp) => {
                if (!this.state.isPlaying) return;
                const elapsed = timestamp - startTime;
                const progress = (elapsed % duration) / duration;
                this.state.playProgress = progress;
                // progress∈[0,1)：乘 (n-1) 最大只能到 n-2，永远跳不到最后一帧；乘 n 再夹紧（与游戏侧口径一致）
                this.state.frameIndex = Math.min(perFrame.length - 1, Math.floor(progress * perFrame.length));
                this._updateFrameLabel();
                const slider = getElement('devToolFrameSlider');
                if (slider) slider.value = this.state.frameIndex;
                this._draw();
                this._frameAnimId = requestAnimationFrame(loop);
            };
            this._frameAnimId = requestAnimationFrame(loop);
            return;
        }

        const frameDuration = 1000 / this._getPreviewFps(frameData);
        let lastTime = 0;

        const loop = (timestamp) => {
            if (!this.state.isPlaying) return;
            if (!lastTime) lastTime = timestamp;
            const elapsed = timestamp - lastTime;

            if (elapsed >= frameDuration) {
                this.state.frameIndex = (this.state.frameIndex + 1) % frameData.count;
                this._updateFrameLabel();
                // 同步滑块
                const slider = getElement('devToolFrameSlider');
                if (slider) slider.value = this.state.frameIndex;
                // 播放时让武器跟随当前帧配置，方便对比现状
                if (!this.drag.active) {
                    this._applyCurrentConfigToPreview();
                } else {
                    this._draw();
                }
                lastTime = timestamp;
            }

            this._frameAnimId = requestAnimationFrame(loop);
        };

        this._frameAnimId = requestAnimationFrame(loop);
    },

    // 停止帧动画
    _stopFrameAnimation() {
        if (this._frameAnimId) {
            cancelAnimationFrame(this._frameAnimId);
            this._frameAnimId = null;
        }
    },

    // 获取当前角色显示图片（根据动画状态；无帧数据的姿态回退待机图）
    _getCharacterImage() {
        const currentAnim = this.state.anim;
        if (currentAnim === 'idle') {
            return this.charImage;
        }
        const entry = this._charFrames[currentAnim];
        // 单帧姿态图（gun_idle 等 image 型配置）
        if (entry instanceof Image && entry.complete && entry.naturalWidth > 0) {
            return entry;
        }
        if (entry && entry.sheet && entry.sheet.complete && entry.sheet.naturalWidth > 0) {
            // 返回可绘制的帧数据对象
            return entry;
        }
        return this.charImage;
    },

    // 切换模式（缩放/旋转）
    _toggleMode() {
        this.state.mode = this.state.mode === 'move' ? 'rotate' : 'move';
        this._updateModeHint();
        // 更新Canvas光标
        if (this.state.mode === 'rotate') {
            this._canvas.classList.add('mode-rotate');
        } else {
            this._canvas.classList.remove('mode-rotate');
        }
    },

    _updateModeHint() {
        const hint = getElement('devToolModeHint');
        if (!hint) return;
        const isRotate = this.state.mode === 'rotate';
        hint.innerHTML = `
            <div class="${isRotate ? '' : 'mode-active'}">🖱 左键拖动</div>
            <div class="${isRotate ? 'mode-active' : ''}">🔄 滚轮 = ${isRotate ? '旋转' : '缩放'}</div>
            <div>按 <kbd>R</kbd> 切换${isRotate ? '缩放' : '旋转'}模式</div>
        `;
        // 也更新浮层提示
        const canvasHint = getElement('devToolHint');
        if (canvasHint) {
            canvasHint.innerHTML = isRotate
                ? `旋转模式：滚轮旋转 · 左键拖动 · <kbd>R</kbd> 切换`
                : `拖动武器到人物位置 → 按 <kbd>R</kbd> 进入调整模式`;
        }
    },

    _updateStatus() {
        const statusEl = getElement('devToolStatus');
        if (statusEl) statusEl.textContent = this.ANIM_NAME[this.state.anim] || this.state.anim;
    },

    // 鼠标按下
    // 当前帧武器绘制状态（与 _draw 同一变换链：perFrame 插值优先，否则传统链）
    _getWeaponDrawState() {
        const wt = this._configKeyOf(this.state.weaponType);
        const animState = this._stateKeyOf(this.state.anim);
        const overrides = this._staffStateOverrides(animState, this._buildPreviewOverrides());
        const pfTransform = this._getPerFrameTransform();
        if (pfTransform) return this._mirrorForFacing(pfTransform.local, pfTransform.rotation);
        const base = this._applyRenderOffsets(
            WeaponTransform.getWeaponLocalOffset(wt, WEAPON_ANIM.size, false, false, animState, true, overrides),
            WeaponTransform.getWeaponRotation(0, wt, 0, animState, true, overrides)
        );
        return this._mirrorForFacing(base.local, base.rotation);
    },

    // 画布鼠标坐标换算（CSS zoom 会拉伸 getBoundingClientRect，必须按实际比例换算回内部坐标系，
    // 否则 zoom≠1 时拖拽/固定点/坐标工具记录的位置全部按 zoom 倍率失真）
    _canvasPos(e) {
        const rect = this._canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this._canvas.width / rect.width),
            y: (e.clientY - rect.top) * (this._canvas.height / rect.height),
        };
    },

    // 固定点放置：画布点击点 → 逆变换到武器局部坐标（px@scale1，随武器刚性跟随）。
    // 命中校验：点击必须落在武器贴图的非透明像素上，否则无效
    _placeMarker(mx, my, cx, cy) {
        if (!this.state.weaponOnCanvas) {
            this._showToast('请先放置武器');
            return;
        }
        const ds = this._getWeaponDrawState();
        const dx = mx - (cx + ds.local.x), dy = my - (cy + ds.local.y);
        const cos = Math.cos(-ds.rotation), sin = Math.sin(-ds.rotation);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const sc = ds.local.scale || 1;

        // 命中校验：与 _draw 武器绘制同一锚点公式，换算到贴图像素检查 alpha
        // (lx,ly) 经逆旋转后已是绘制空间坐标（_draw 只 translate+rotate，缩放体现在 drawImage 宽高里），不能再乘 sc
        if (!this._hitTestWeapon(lx, ly, ds.local, sc)) {
            this._showToast('⚠ 固定点必须放在武器贴图上');
            return;
        }
        this.marker = { x: lx / sc, y: ly / sc };
        this._showToast(`📍 固定点已标记（武器局部 ${Math.round(this.marker.x)}, ${Math.round(this.marker.y)}）`);
    },

    // 武器贴图像素命中测试（px/py = 武器局部坐标·scale 后的绘制空间像素）
    _hitTestWeapon(px, py, local, drawScale) {
        const img = this.weaponImage;
        if (!img || !img.complete || !img.naturalWidth) return false;
        const s = WEAPON_ANIM.size;
        const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
        const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
        let w, h, anchorX, anchorY; // drawImage(x=anchorX, y=anchorY, w, h)
        if (weaponType === 'melee') {
            w = local.size * 0.63 * drawScale;
            h = local.size * drawScale;
            anchorX = -w / 2; anchorY = -h / 2;
        } else if (isGun) {
            const isPistol = weaponType === 'pistol';
            w = (isPistol ? s * 0.275 : s * 0.75) * drawScale;
            h = (isPistol ? s * 0.5 : s) * drawScale;
            const gunCfg = WeaponAnimConfig[this._configKeyOf(this.state.weaponType)];
            const grip = (gunCfg && gunCfg.grip) || { x: 0.5, y: 0.5 };
            anchorX = -grip.x * w; anchorY = -grip.y * h;
        } else {
            const aspect = (img.naturalWidth || 1024) / (img.naturalHeight || 1024);
            h = local.size * drawScale;
            w = h * aspect;
            anchorX = -w / 2; anchorY = -h / 2;
        }
        const texX = (px - anchorX) / w * img.naturalWidth;
        const texY = (py - anchorY) / h * img.naturalHeight;
        if (texX < 0 || texY < 0 || texX >= img.naturalWidth || texY >= img.naturalHeight) return false;
        // 离屏像素查询（每贴图缓存一次）
        if (!this._weaponPxCanvas || this._weaponPxCanvas._src !== img.src) {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            c._src = img.src;
            this._weaponPxCanvas = c;
        }
        const data = this._weaponPxCanvas.getContext('2d').getImageData(Math.floor(texX), Math.floor(texY), 1, 1).data;
        return data[3] > 10;
    },

    _onMouseDown(e) {
        const { x: mx, y: my } = this._canvasPos(e);
        const cx = this._canvas.width / 2;
        const cy = this._canvas.height / 2;
        const wp = this.weaponParams;

        // 固定点放置模式：本次点击用于放置标记，不触发拖拽
        if (this._markerMode) {
            this._placeMarker(mx, my, cx, cy);
            this._markerMode = false;
            const markerBtn = getElement('devToolMarker');
            if (markerBtn) markerBtn.classList.remove('active');
            this._draw();
            return;
        }

        // 计算武器当前在屏幕上的中心位置（用于命中测试）
        // 与 _draw 同一变换链（_getWeaponDrawState：逐帧播放中取插值位置，否则传统链），否则播放中点不中
        let weaponScreenX, weaponScreenY;
        if (this.state.weaponOnCanvas && this.weaponImage && this.weaponImage.complete) {
            const ds = this._getWeaponDrawState();
            weaponScreenX = cx + ds.local.x;
            weaponScreenY = cy + ds.local.y;
        }

        // 检查是否点击在武器区域内
        if (weaponScreenX !== undefined) {
            const dist = Math.hypot(mx - weaponScreenX, my - weaponScreenY);
            if (dist < 60) {
                this.drag.active = true;
                this.drag.startX = mx;
                this.drag.startY = my;
                this.drag.startOffsetX = wp.offsetX;
                this.drag.startOffsetY = wp.offsetY;
                this.state.weaponOnCanvas = true;
                this._stopFrameAnimation();
                this.state.isPlaying = false;
                this._updatePlayBtn();
                return;
            }
        }

        // 点击空白区域：放置武器
        if (!this.state.weaponOnCanvas) {
            this.state.weaponOnCanvas = true;
            wp.offsetX = mx - cx;
            wp.offsetY = my - cy;
            this._syncInputs();
            this._syncPerFrameFromWeaponParams();
            this._draw();
        }
    },

    // 鼠标移动
    _onMouseMove(e) {
        const { x: mx, y: my } = this._canvasPos(e);

        if (!this.drag.active) return;

        const dx = mx - this.drag.startX;
        const dy = my - this.drag.startY;

        // 武器跟随鼠标：Canvas坐标系，Y向下为正
        this.weaponParams.offsetX = this.drag.startOffsetX + dx;
        this.weaponParams.offsetY = this.drag.startOffsetY + dy;
        this._syncInputs();
        this._syncPerFrameFromWeaponParams();
        this._draw();
    },

    // 鼠标释放
    _onMouseUp() {
        this.drag.active = false;
    },

    // 滚轮
    _onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;

        if (this.state.mode === 'rotate') {
            // 旋转模式：滚轮旋转（顺时针/逆时针）
            this.weaponParams.rotation += delta * 5;
        } else {
            // 缩放模式：滚轮缩放
            const scaleDelta = delta * 0.05;
            this.weaponParams.scale = Math.max(0.1, Math.min(5.0, this.weaponParams.scale + scaleDelta));
        }
        this._syncInputs();
        this._syncPerFrameFromWeaponParams();
        this._draw();
    },

    _syncInputs() {
        const elX = getElement('devToolOffX');
        const elY = getElement('devToolOffY');
        const elR = getElement('devToolRot');
        const elS = getElement('devToolScl');
        if (elX) elX.value = Math.round(this.weaponParams.offsetX);
        if (elY) elY.value = Math.round(this.weaponParams.offsetY);
        if (elR) elR.value = Math.round(this.weaponParams.rotation);
        if (elS) elS.value = this.weaponParams.scale.toFixed(2);
        const elBX = getElement('devToolBlurX');
        const elBY = getElement('devToolBlurY');
        const elSX = getElement('devToolStrX');
        const elSY = getElement('devToolStrY');
        if (elBX) elBX.value = (this.weaponParams.blurX ?? 0);
        if (elBY) elBY.value = (this.weaponParams.blurY ?? 0);
        if (elSX) elSX.value = (this.weaponParams.stretchX ?? 1);
        if (elSY) elSY.value = (this.weaponParams.stretchY ?? 1);

    },

    // 画布缩放控制
    _zoomIn() {
        if (this.zoom.scale < this.zoom.max) {
            this.zoom.scale = Math.min(this.zoom.max, this.zoom.scale + this.zoom.step);
            this._applyZoom();
        }
    },
    _zoomOut() {
        if (this.zoom.scale > this.zoom.min) {
            this.zoom.scale = Math.max(this.zoom.min, this.zoom.scale - this.zoom.step);
            this._applyZoom();
        }
    },
    _zoomReset() {
        this.zoom.scale = 1.0;
        this._applyZoom();
    },
    _applyZoom() {
        // 更新画布 CSS 缩放
        if (this._canvas) {
            this._canvas.style.transform = `scale(${this.zoom.scale})`;
            this._canvas.style.transformOrigin = 'center center';
        }
        // 更新标签
        const label = getElement('devToolZoomLabel');
        if (label) label.textContent = `${Math.round(this.zoom.scale * 100)}%`;
    },

    // 手部分层：把当前帧的手层贴图叠回画布（身体 → 武器 → 手），与游戏 depth 分层一致
    _drawHandLayer(cx, cy, spriteSize) {
        const hl = this._pendingHandLayer;
        if (!hl) return;
        const ctx = this._ctx;
        ctx.save();
        // 朝左镜像：与武器 flipX 同口径（水平翻转手层贴图）
        if (this.state.facingRight === false) {
            ctx.translate(cx + cx, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(
            hl.img,
            hl.sx, hl.sy, hl.frameW, hl.frameH,
            cx - spriteSize/2, cy - spriteSize/2, spriteSize, spriteSize
        );
        ctx.restore();
    },

    // 绘制
    _draw() {
        const ctx = this._ctx;
        const canvas = this._canvas;
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.clearRect(0, 0, w, h);

        // 背景网格
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i < w; i += 20) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
        for (let i = 0; i < h; i += 20) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }

        // 坐标轴（Canvas坐标系：X向右，Y向下，与游戏渲染一致）
        // X轴 - 红色，右侧箭头
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        // X轴右侧箭头
        ctx.fillStyle = 'rgba(255, 80, 80, 0.85)';
        ctx.beginPath();
        ctx.moveTo(w - 12, cy - 6);
        ctx.lineTo(w, cy);
        ctx.lineTo(w - 12, cy + 6);
        ctx.closePath();
        ctx.fill();
        // X+ 文字标注
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('X+', w - 18, cy - 10);
        ctx.textAlign = 'left';

        // Y轴 - 绿色，上方箭头（游戏Y+方向为向上，即Canvas Y-方向）
        ctx.strokeStyle = 'rgba(80, 200, 80, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        // Y轴上方箭头（指向游戏Y+）
        ctx.fillStyle = 'rgba(80, 200, 80, 0.85)';
        ctx.beginPath();
        ctx.moveTo(cx - 6, 12);
        ctx.lineTo(cx, 0);
        ctx.lineTo(cx + 6, 12);
        ctx.closePath();
        ctx.fill();
        // Y+ 文字标注
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Y+', cx + 10, 18);

        // 辅助标注（Canvas坐标系，Y向下为正）
        ctx.fillStyle = 'rgba(200, 180, 150, 0.6)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('游戏X- ←', 45, cy + 20);
        ctx.fillText('↓ 游戏Y-', cx + 40, h - 12);
        ctx.textAlign = 'left';

        // 原点标注
        ctx.fillStyle = 'rgba(200, 180, 150, 0.9)';
        ctx.font = '11px monospace';
        ctx.fillText('玩家位置 (0, 0) | 参数: Canvas坐标系 (Y向下)', cx + 5, cy - 5);

        // 角色碰撞范围（使用配置值，避免硬编码）
        const { spriteSize, collisionWidth, collisionHeight } = PLAYER_DEFAULTS.physics;
        ctx.strokeStyle = 'rgba(100, 200, 100, 0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - collisionWidth / 2, cy - collisionHeight / 2, collisionWidth, collisionHeight);

        // 角色贴图（根据动画状态选择）
        const charImg = this._getCharacterImage();
        const isImage = charImg && charImg instanceof Image;
        const isFrameData = charImg && charImg.sheet && charImg.sheet instanceof Image;
        const isReady = isImage ? charImg.complete : (isFrameData ? charImg.sheet.complete : false);
        if (isReady) {
            const currentAnim = this.state.anim;
            // 持枪移动：走腿层 + 躯干层合成预览（与游戏内分层一致；仅枪类武器且部件就绪时）
            const wtSel = this.state.weaponType;
            const isGunWeaponSel = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(this.WEAPON_MAP[wtSel]?.type);
            const gunLayer = this._gunLayers && (this._gunLayers[this._gunPoseKeyFor()] || this._gunLayers.gun_idle);
            if (currentAnim === 'walk' && isGunWeaponSel && gunLayer && gunLayer.walkFrames.sheet.complete && gunLayer.walkFrames.sheet.naturalWidth > 0) {
                const gf = gunLayer.walkFrames;
                const gidx = (this.state.frameIndex % gf.count) + (gf.firstFrame || 0);
                const gcol = gidx % gf.cols;
                const grow = Math.floor(gidx / gf.cols);
                ctx.drawImage(
                    gf.sheet,
                    gcol * gf.frameW, grow * gf.frameH, gf.frameW, gf.frameH,
                    cx - spriteSize/2, cy - spriteSize/2, spriteSize, spriteSize
                );
                if (gunLayer.torso && gunLayer.torso.complete && gunLayer.torso.naturalWidth > 0) {
                    ctx.drawImage(gunLayer.torso, cx - spriteSize/2, cy - spriteSize/2, spriteSize, spriteSize);
                }
            } else if (isFrameData) {
                // 从 sprite sheet 提取帧（所有 sheet 姿态通用，含 firstFrame 帧区间偏移）
                const frameData = charImg;
                let idx;
                // 逐帧攻击模式：武器按 N 帧插值，角色贴图必须按相同进度映射
                const perFrame = this._getPerFrameFrames(this.state.weaponType, currentAnim);
                if (this._isPerFrameAnim(currentAnim) && perFrame) {
                    const spriteProgress = this.state.playProgress || 0;
                    if (frameData.durations && !this._isFpsManual()) {
                        // 非均匀逐帧时长：按累计时长窗口定位当前角色帧（与游戏内 frameWeights 表现一致）
                        const total = frameData.durations.reduce((a, b) => a + (b || 0), 0) || 1;
                        const t = spriteProgress * total;
                        let acc = 0;
                        idx = frameData.count - 1;
                        for (let i = 0; i < frameData.count; i++) {
                            acc += frameData.durations[i] || 0;
                            if (t < acc) { idx = i; break; }
                        }
                    } else {
                        idx = Math.floor(spriteProgress * (frameData.count - 1));
                    }
                } else {
                    idx = this.state.frameIndex % frameData.count;
                }
                idx += (frameData.firstFrame || 0);
                const col = idx % frameData.cols;
                const row = Math.floor(idx / frameData.cols);
                const sx = col * frameData.frameW;
                const sy = row * frameData.frameH;
                // 手部分层：身体层用去手 sheet（与游戏 body 一致），手层由 _drawHandLayer 在武器之上叠回
                const bodySheet = (frameData.handLayer && frameData.handLayer.body.complete && frameData.handLayer.body.naturalWidth > 0)
                    ? frameData.handLayer.body
                    : frameData.sheet;
                ctx.drawImage(
                    bodySheet,
                    sx, sy, frameData.frameW, frameData.frameH,
                    cx - spriteSize/2, cy - spriteSize/2, spriteSize, spriteSize
                );
                // 记录当前帧的手层数据，供武器绘制后叠加（_drawHandLayer 消费）
                this._pendingHandLayer = frameData.handLayer && frameData.handLayer.hand.complete
                    ? { img: frameData.handLayer.hand, sx, sy, frameW: frameData.frameW, frameH: frameData.frameH }
                    : null;
            } else {
                // 单帧图（待机，或未配置素材的姿态回退）
                ctx.drawImage(charImg, cx - spriteSize / 2, cy - spriteSize / 2, spriteSize, spriteSize);
                this._pendingHandLayer = null;
            }
        } else {
            ctx.fillStyle = 'rgba(100, 200, 100, 0.3)';
            ctx.fillRect(cx - 40, cy - 40, 80, 80);
            this._pendingHandLayer = null;
        }

        // 绘制角色方向指示（根据动画状态）
        ctx.strokeStyle = 'rgba(200, 180, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 60, cy); ctx.stroke();

        // 武器绘制
        if (this.state.weaponOnCanvas && this.weaponImage && this.weaponImage.complete) {
            const s = WEAPON_ANIM.size;
            const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
            const isMelee = weaponType === 'melee';
            const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
            
            // ===== 状态指示器（攻击/行走/施法：进度条 + 关键帧标记）=====
            const isCastAnim = this.state.anim === 'cast' || this.state.anim === 'staff_cast';
            if ((this._isPerFrameAnim(this.state.anim) || this.state.anim === 'walk' || isCastAnim) && (isMelee || isCastAnim)) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);

                const currentAnim = this.state.anim;
                const perFrameTotal = this._getPerFrameTotal();
                const frameData = this._charFrames[currentAnim];
                const total = perFrameTotal > 1 ? perFrameTotal : (frameData && frameData.count || 1);
                const progress = total > 1 ? this.state.frameIndex / (total - 1) : 0;
                const animName = this.ANIM_NAME[currentAnim] || currentAnim;
                const isAttackAnim = this._isPerFrameAnim(currentAnim);
                const barColor = isAttackAnim ? 'rgba(255,80,80,0.9)' : (isCastAnim ? 'rgba(90,150,255,0.9)' : 'rgba(100,200,100,0.9)');
                ctx.fillStyle = isAttackAnim ? 'rgba(255,80,80,0.8)' : (isCastAnim ? 'rgba(90,150,255,0.8)' : 'rgba(100,200,100,0.8)');
                ctx.font = 'bold 14px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`${animName}: 帧 ${this.state.frameIndex + 1}/${total}`, cx, 30);
                ctx.fillStyle = 'rgba(80,60,40,0.8)';
                ctx.fillRect(cx - 100, 40, 200, 8);
                ctx.fillStyle = barColor;
                ctx.fillRect(cx - 100, 40, 200 * progress, 8);

                // 关键帧标记：perFrame 的 hitCheck.frame / soundFrame；施法的 releaseFrame（进度换算同游戏侧
                // hitCheckThreshold = (frame-1)/(frames.length-1)；releaseFrame 为 0 基帧号）
                const wtKey = this._configKeyOf(this.state.weaponType);
                const cfgKey = this._perFrameCfgKey(currentAnim);
                const block = WeaponAnimConfig[wtKey] && WeaponAnimConfig[wtKey][cfgKey];
                const marks = [];
                if (isAttackAnim && block && block.hitCheck && typeof block.hitCheck.frame === 'number' && total > 1) {
                    marks.push({ pos: (block.hitCheck.frame - 1) / (total - 1), label: `判定${block.hitCheck.frame}`, color: '#ff5555' });
                }
                if (isAttackAnim && block && block.soundFrame && total > 1) {
                    marks.push({ pos: (block.soundFrame - 1) / (total - 1), label: `音${block.soundFrame}`, color: '#ffd75f' });
                }
                if (isCastAnim && frameData && frameData.releaseFrame !== undefined && total > 1) {
                    marks.push({ pos: frameData.releaseFrame / (total - 1), label: `释放${frameData.releaseFrame + 1}`, color: '#7fd0ff' });
                }
                for (const mk of marks) {
                    const x = cx - 100 + 200 * Math.max(0, Math.min(1, mk.pos));
                    ctx.fillStyle = mk.color;
                    ctx.fillRect(x - 1, 36, 2, 16);
                    ctx.fillStyle = 'rgba(20,20,20,0.9)';
                    ctx.font = 'bold 10px monospace';
                    ctx.fillText(mk.label, x, 58);
                }
                ctx.restore();
            }
            
            // ===== 统一武器绘制（使用 WeaponTransform 的变换链）=====
            const wt = this.state.weaponType;
            const wtKey = this._configKeyOf(wt);
            const animState = this._stateKeyOf(this.state.anim);
            const overrides = this._staffStateOverrides(animState, this._buildPreviewOverrides());
            let local, rotation;
            // 优先使用逐帧配置（exact per-frame state）
            const pfTransform = this._getPerFrameTransform();
            if (pfTransform) {
                local = pfTransform.local;
                rotation = pfTransform.rotation;
            } else {
                const baseLocal = WeaponTransform.getWeaponLocalOffset(wtKey, WEAPON_ANIM.size, false, false, animState, true, overrides);
                const baseRot = WeaponTransform.getWeaponRotation(0, wtKey, 0, animState, true, overrides);
                const applied = this._applyRenderOffsets(baseLocal, baseRot);
                local = applied.local;
                rotation = applied.rotation;
            }
            const mirrored = this._mirrorForFacing(local, rotation);
            local = mirrored.local;
            rotation = mirrored.rotation;

            ctx.save();
            ctx.translate(cx + local.x, cy + local.y);
            ctx.rotate(rotation);
            // 朝左：贴图水平翻转（flipX，与游戏近战 flipX / 枪械镜像口径一致；旋转取反已在上层处理）
            if (this.state.facingRight === false) {
                ctx.scale(-1, 1);
            }

            // 绘制武器（B 方案拉伸 + A 方案模糊预览：canvas filter 近似，游戏内为方向性高斯）
            const drawScale = local.scale;
            const stX = (pfTransform && pfTransform.stretchX) || 1;
            const stY = (pfTransform && pfTransform.stretchY) || 1;
            const blurAmt = pfTransform ? Math.max(pfTransform.blurX || 0, pfTransform.blurY || 0) : 0;
            if (blurAmt > 0.05) {
                ctx.filter = `blur(${(blurAmt / 2).toFixed(1)}px)`;
            }
            if (isMelee) {
                const w = local.size * 0.63 * drawScale * stX;
                const h = local.size * drawScale * stY;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            } else if (isGun) {
                const isPistol = weaponType === 'pistol';
                const w = (isPistol ? s * 0.275 : s * 0.75) * drawScale * stX;
                const h = (isPistol ? s * 0.5 : s) * drawScale * stY;
                // 握把锚点（配置 grip，缺省中心）：面板拖拽点/游戏内旋转轴统一为握把点
                const gunCfg = WeaponAnimConfig[wtKey];
                const grip = (gunCfg && gunCfg.grip) || { x: 0.5, y: 0.5 };
                ctx.drawImage(this.weaponImage, -grip.x * w, -grip.y * h, w, h);
            } else {
                const imgW = this.weaponImage.naturalWidth || 1024;
                const imgH = this.weaponImage.naturalHeight || 1024;
                const aspect = imgW / imgH;
                const h = local.size * drawScale * stY;
                const w = h * aspect * stX;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            }
            ctx.filter = 'none';

            // 绘制旋转中心
            ctx.fillStyle = '#FFD700';
            ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();

            // 固定点标记（红色，武器局部坐标，随武器平移/旋转/缩放刚性跟随）
            if (this.marker) {
                ctx.fillStyle = '#ff2d2d';
                ctx.beginPath(); ctx.arc(this.marker.x * drawScale, this.marker.y * drawScale, 4, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            ctx.restore();

            // 坐标标注已删除（屏幕偏移/Rotation/逐帧模式文字遮挡贴图，且右侧面板已有同信息显示）

            // 手部分层：武器绘制完成后叠回手层（与游戏 depth：身体 < 武器 < 手 一致）
            this._drawHandLayer(cx, cy, spriteSize);

            // 渲染字段提示：spriteOffset/rotOffset 已叠加进预览（所见即所得）；
            // aimSpriteOffset/dualOffsetX/bobWeaponScale 依赖瞄准态/双持/移动 bob，面板不模拟，只读展示
            const renderOff = this._getRenderOffsets();
            const extras = [];
            if (renderOff.aimSpriteOffsetX || renderOff.aimSpriteOffsetY) extras.push(`aimOffset(${renderOff.aimSpriteOffsetX},${renderOff.aimSpriteOffsetY})`);
            if (renderOff.dualOffsetX) extras.push(`dualOffsetX=${renderOff.dualOffsetX}`);
            if (renderOff.bobWeaponScale !== 1) extras.push(`bobScale=${renderOff.bobWeaponScale}`);
            const applied = (renderOff.spriteOffsetX || renderOff.spriteOffsetY || renderOff.rotOffset);
            if (applied || extras.length) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.font = '11px monospace';
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(200, 180, 150, 0.85)';
                const parts = [];
                if (renderOff.spriteOffsetX || renderOff.spriteOffsetY) parts.push(`spriteOffset(${renderOff.spriteOffsetX},${renderOff.spriteOffsetY})`);
                if (renderOff.rotOffset) parts.push(`rotOffset=${renderOff.rotOffset}°`);
                const line1 = parts.length ? '已叠加: ' + parts.join(' ') : '';
                const line2 = extras.length ? '未模拟: ' + extras.join(' ') : '';
                let y = h - 16;
                if (line2) { ctx.fillText(line2, cx, y); y -= 14; }
                if (line1) ctx.fillText(line1, cx, y);
                ctx.restore();
            }

        } else if (!this.state.weaponOnCanvas) {
            ctx.fillStyle = '#5a4d3f';
            ctx.font = '14px SimHei';
            ctx.textAlign = 'center';
            ctx.fillText('点击放置武器', cx, cy - 70);
            ctx.fillText('或从右侧选择武器后点击此处', cx, cy - 50);
            ctx.textAlign = 'left';
        }
    },

    // 保存数据
    _save() {
        const panelWt = this.state.weaponType;
        const wt = this._configKeyOf(panelWt);
        const currentAnim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];

        if (!cfg) {
            this._showToast(`⚠ 未找到 ${this.WEAPON_MAP[panelWt]?.name || panelWt} 的动画配置（${wt}）`);
            return;
        }

        // 逐帧模式：weaponParams 直接对应当前帧，保存当前帧即可（attack→attack 块，attack2→attack2 块）
        const saveKey = this._perFrameCfgKey(currentAnim);
        if (this._isPerFrameAnim(currentAnim) && cfg[saveKey] && cfg[saveKey].type === 'perFrame') {
            this._syncPerFrameFromWeaponParams();
            // 串行：merge 是读-改-写同一路径，必须先等全量写落盘再合并，避免双写竞态
            this._persistWeaponConfig().then(() => this._exportPerFrameFile(wt, cfg, panelWt));

            const phaserScene = window.__phaserScene;
            if (phaserScene && phaserScene.playerSprite) {
                const player = window.player || Game.player;
                if (player) {
                    const weaponAnim = player._getWeaponAnimParams();
                    phaserScene.syncWeapon(player, weaponAnim);
                    phaserScene.syncOffhandWeapon(player, weaponAnim);
                }
            }

            const json = JSON.stringify({
                weaponType: wt,
                weaponName: this.WEAPON_MAP[panelWt]?.name,
                anim: currentAnim,
                mode: 'perFrame',
                frameIndex: this.state.frameIndex,
                frames: cfg[saveKey].frames,
            }, null, 2);
            const outputEl = getElement('devToolDataOutput');
            if (outputEl) {
                outputEl.textContent = json;
                outputEl.style.display = 'block';
            }
            navigator.clipboard.writeText(json).then(() => {
                this._showToast('✅ 已保存逐帧配置并复制到剪贴板');
            }).catch(() => {
                this._showToast('✅ 已保存逐帧配置');
            });
            return;
        }

        // 通用旋转/缩放
        const rotation = Math.round(this.weaponParams.rotation);
        const scale = parseFloat(this.weaponParams.scale.toFixed(2));

        // 状态子配置：idle/walk/running 一律写入对应状态块（不再要求已有 idle 子配置——
        // 旧逻辑下无 idle 块的武器（如 akm）在 walk 态保存会被两个分支同时跳过、数据丢失）
        // 状态子配置：idle/walk/running 写入对应状态块；持枪待机/施法（gun_idle/cast 系列）
        // 在游戏里按 'idle' 读取（cfg.idle 子块优先），必须写 idle 子块才能生效
        const stateKey = this._stateKeyOf(currentAnim);
        const targetState = (stateKey === 'idle' || stateKey === 'walk' || stateKey === 'running') ? stateKey : null;

        // ===== 传统模式：反推 holdOffsetX/Y =====
        const { baseX, baseY, afterX, afterY } = this._getWeaponTransformBase();
        const holdOffsetX = Math.round(this.weaponParams.offsetX - baseX - afterX);
        const holdOffsetY = Math.round(this.weaponParams.offsetY - baseY - afterY);

        if (targetState) {
            if (!cfg[targetState]) cfg[targetState] = {};
            cfg[targetState].holdOffsetX = holdOffsetX;
            cfg[targetState].holdOffsetY = holdOffsetY;
            cfg[targetState].idleRotation = rotation;
            cfg[targetState].idleScale = scale;
        } else {
            cfg.holdOffsetX = holdOffsetX;
            cfg.holdOffsetY = holdOffsetY;
            cfg.idleRotation = rotation;
            cfg.idleScale = scale;
        }

        // 持久化到 Electron 文件系统（如果可用）
        this._persistWeaponConfig();

        // 通知 Phaser 重新同步武器
        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.playerSprite) {
            const player = window.player || Game.player;
            if (player) {
                const weaponAnim = player._getWeaponAnimParams();
                phaserScene.syncWeapon(player, weaponAnim);
                phaserScene.syncOffhandWeapon(player, weaponAnim);
            }
        }

        // 输出面板展示当前保存的数据片段
        const output = {
            weaponType: wt,
            weaponName: this.WEAPON_MAP[panelWt]?.name,
            anim: currentAnim,
            mode: 'holdOffset',
            rotation,
            scale,
            holdOffsetX,
            holdOffsetY,
        };

        const json = JSON.stringify(output, null, 2);
        const outputEl = getElement('devToolDataOutput');
        if (outputEl) {
            outputEl.textContent = json;
            outputEl.style.display = 'block';
        }

        // 复制到剪贴板
        navigator.clipboard.writeText(json).then(() => {
            this._showToast('✅ 已应用到游戏并复制到剪贴板');
        }).catch(() => {
            this._showToast('✅ 已应用到游戏（复制失败）');
        });
    },

    // 显示 Toast 提示
    _showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(40,60,30,0.95);color:#90d070;padding:10px 20px;border-radius:6px;font-size:14px;z-index:10000;pointer-events:none;animation:toastFade 2s ease-out forwards;font-family:SimHei,"Microsoft YaHei",sans-serif;border:1px solid rgba(144,208,112,0.3);';
        toast.textContent = message;
        document.body.appendChild(toast);
        TimerManager.setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
    },

    // 重置：把当前配置直接加载到预览画布
    // 重置：一键把当前动画恢复到初始状态——
    // attack/attack2（逐帧）：全部帧重置为默认种子（attack=同一基线位置，attack2=复制 attack 帧），丢弃当前未保存的逐帧调整；
    // 其他动画（idle/walk/running）：丢弃未保存编辑，恢复为已保存配置
    _reset() {
        if (this._isPerFrameAnim(this.state.anim)) {
            this._seedPerFrameDefaults(this.state.weaponType, this.state.anim);
            this.state.frameIndex = 0;
            this.state.playProgress = 0;
        }
        this._applyCurrentConfigToPreview();
        this.state.mode = 'move';
        this._canvas.classList.remove('mode-rotate');
        this._updateModeHint();
        this._updateFrameSlider();
        this._updateFrameLabel();
    },

    // 显示/隐藏/切换
    show() {
        this._active = true;
        if (this._panel) this._panel.classList.add('active');
        const trigger = getElement('devToolTrigger');
        if (trigger) trigger.classList.add('active');
        // 打开面板自动同步当前装备武器与姿态（避免每次都从 sword/idle 重新选）
        this._loadFromGamePlayer();
        // 默认切换到武器 tab
        this.switchTab('weapon');
        this._draw();
    },

    // 从当前游戏玩家同步面板选择：武器类型 + 姿态（读不到时保持现状）
    _loadFromGamePlayer() {
        const player = (typeof window !== 'undefined' && window.player) || Game.player;
        if (!player || !player.equipments) return;
        const item = player.equipments[player.weaponMode];
        if (item && item.weaponType) {
            // 面板武器键 = configKey 匹配（super90/saiga12k 都映射 shotgun，取第一个匹配项即可）
            const wtKey = item.animConfigKey || item.weaponType;
            const match = Object.entries(this.WEAPON_MAP).find(([, cfg]) => cfg.configKey === wtKey);
            if (match && match[0] !== this.state.weaponType) {
                this.state.weaponType = match[0];
                this._loadWeapon(this.state.weaponType);
            }
        }
        // 姿态：读玩家当前动画键，反查面板键（player_xxx → cfgKey → panelKey）；读不到回退 idle
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        let cfgKey = null;
        if (scene && scene.playerSprite && scene.playerSprite.anims && scene.playerSprite.anims.currentAnim) {
            const key = scene.playerSprite.anims.currentAnim.key || '';
            if (key.startsWith('player_')) cfgKey = key.slice('player_'.length);
        }
        if (!cfgKey) cfgKey = 'idle';
        const panelAnim = Object.entries(this.PANEL_ANIM_TO_CONFIG).find(([, c]) => c === cfgKey);
        if (panelAnim && panelAnim[0] !== this.state.anim) {
            this.state.anim = panelAnim[0];
            this.state.frameIndex = 0;
            this.state.isPlaying = false;
            this._stopFrameAnimation();
            this._updateFrameSlider();
            this._updateFrameLabel();
            this._updatePlayBtn();
            this._updateStatus();
            this._syncFpsInput();
        }
    },
    hide() {
        this._active = false;
        // 停掉播放循环：否则关面板后 rAF 永久空转
        this.state.isPlaying = false;
        this._stopFrameAnimation();
        this._updatePlayBtn();
        if (this._panel) this._panel.classList.remove('active');
        const trigger = getElement('devToolTrigger');
        if (trigger) trigger.classList.remove('active');
    },
    toggle() {
        if (this._active) this.hide(); else this.show();
    },

    // ===== Tab 切换 =====
    // switchTab 已定义在上面

    // ===== 坐标工具 =====
    _startCoordTool() {
        console.log('[DevTool] _startCoordTool called');

        // 先清理旧状态，防止重复绑定事件
        if (this._coordToolCleanup) {
            this._coordToolCleanup();
            this._coordToolCleanup = null;
        }

        this.hide(); // 关闭交互开发工具

        const overlay = getElement('coordOverlay');
        const panel = getElement('coordPanel');
        if (!overlay || !panel) {
            console.error('[DevTool] coordOverlay or coordPanel not found', { overlay: !!overlay, panel: !!panel });
            this._showToast('❌ 坐标工具 DOM 缺失');
            this.show();
            return;
        }

        // 将坐标层移动到 body，避免受 uiLayer pointer-events:none 影响
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
        if (panel.parentElement !== document.body) document.body.appendChild(panel);

        overlay.classList.add('active');
        panel.classList.add('active');
        overlay.style.display = 'block';
        panel.style.display = 'flex';

        // 清除之前的元素
        overlay.querySelectorAll('.rect-preview, .mouse-label, .start-marker, .final-rect').forEach(el => el.remove());

        // 重置显示
        getElement('coordStart').textContent = '--';
        getElement('coordEnd').textContent = '--';
        getElement('coordSize').textContent = '--';

        console.log('[DevTool] coord tool activated');

        // 获取游戏容器的边界和缩放比例
        // 注意：原始 gameCanvas 在非地牢模式下会被 Renderer 设为 display:none，
        // 因此必须检测 rect 尺寸，避免除以 0 得到 Infinity/NaN。
        const gameContainer = getElement('gameContainer');
        const gameCanvas = getElement('gameCanvas');
        const getGameScale = () => {
            const container = gameContainer || document.body;
            const containerRect = container.getBoundingClientRect();
            if (!gameCanvas) return { scaleX: 1, scaleY: 1, rect: containerRect };
            const canvasRect = gameCanvas.getBoundingClientRect();
            let scaleX = 1;
            let scaleY = 1;
            if (canvasRect.width > 0 && canvasRect.height > 0) {
                const sx = gameCanvas.width / canvasRect.width;
                const sy = gameCanvas.height / canvasRect.height;
                if (Number.isFinite(sx) && sx > 0) scaleX = sx;
                if (Number.isFinite(sy) && sy > 0) scaleY = sy;
            }
            return { scaleX, scaleY, rect: containerRect };
        };

        let isDragging = false;
        let startX = 0, startY = 0;
        let startClientX = 0, startClientY = 0;
        let rectPreview = null;
        let mouseLabel = null;
        let startMarker = null;

        // 鼠标按下 - 开始框选
        const onMouseDown = (e) => {
            if (e.button !== 0) return; // 只响应左键
            isDragging = true;
            startClientX = e.clientX;
            startClientY = e.clientY;
            const scale = getGameScale();
            startX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            startY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);

            // 创建起始标记（使用屏幕坐标显示）
            startMarker = document.createElement('div');
            startMarker.className = 'start-marker';
            startMarker.style.left = (e.clientX - 4) + 'px';
            startMarker.style.top = (e.clientY - 4) + 'px';
            overlay.appendChild(startMarker);

            // 创建矩形预览（屏幕坐标）
            rectPreview = document.createElement('div');
            rectPreview.className = 'rect-preview';
            rectPreview.style.left = e.clientX + 'px';
            rectPreview.style.top = e.clientY + 'px';
            rectPreview.style.width = '0px';
            rectPreview.style.height = '0px';
            overlay.appendChild(rectPreview);

            // 创建鼠标标签
            mouseLabel = document.createElement('div');
            mouseLabel.className = 'mouse-label';
            overlay.appendChild(mouseLabel);
        };

        // 鼠标移动 - 更新预览
        const onMouseMove = (e) => {
            if (!isDragging) {
                // 显示当前鼠标坐标（游戏坐标）
                const scale = getGameScale();
                const gameX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
                const gameY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
                if (!mouseLabel) {
                    mouseLabel = document.createElement('div');
                    mouseLabel.className = 'mouse-label';
                    overlay.appendChild(mouseLabel);
                }
                const labelY = Number.isFinite(scale.scaleY) ? Math.round(scale.rect.height * scale.scaleY - gameY) : Math.round(scale.rect.height - gameY);
                mouseLabel.textContent = `${gameX}, ${labelY}`
                mouseLabel.style.left = (e.clientX + 12) + 'px';
                mouseLabel.style.top = (e.clientY + 12) + 'px';
                return;
            }

            const scale = getGameScale();
            const currentX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            const currentY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);

            // 预览矩形使用屏幕像素，避免缩放时偏离框选区域
            const screenLeft = Math.min(startClientX, e.clientX);
            const screenTop = Math.min(startClientY, e.clientY);
            const screenW = Math.abs(e.clientX - startClientX);
            const screenH = Math.abs(e.clientY - startClientY);
            rectPreview.style.left = screenLeft + 'px';
            rectPreview.style.top = screenTop + 'px';
            rectPreview.style.width = screenW + 'px';
            rectPreview.style.height = screenH + 'px';

            mouseLabel.textContent = `${width} x ${height}`;
            mouseLabel.style.left = (e.clientX + 12) + 'px';
            mouseLabel.style.top = (e.clientY + 12) + 'px';
        };

        // 鼠标释放 - 完成框选
        const onMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;

            const scale = getGameScale();
            const endX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            const endY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
            const left = Math.min(startX, endX);
            const _top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);

            // 移除预览元素
            if (rectPreview) rectPreview.remove();
            if (mouseLabel) mouseLabel.remove();
            if (startMarker) startMarker.remove();

            // 最终矩形使用屏幕坐标绘制
            const screenLeft = Math.min(startClientX, e.clientX);
            const screenTop = Math.min(startClientY, e.clientY);
            const screenW = Math.abs(e.clientX - startClientX);
            const screenH = Math.abs(e.clientY - startClientY);

            const finalRect = document.createElement('div');
            finalRect.className = 'final-rect';
            finalRect.style.left = screenLeft + 'px';
            finalRect.style.top = screenTop + 'px';
            finalRect.style.width = screenW + 'px';
            finalRect.style.height = screenH + 'px';
            overlay.appendChild(finalRect);

            // 更新面板显示（显示游戏坐标 - left/bottom 模式）
            const containerHeight = scale.rect.height * scale.scaleY;
            const startBottom = Math.round(containerHeight - startY);
            const endBottom = Math.round(containerHeight - endY);
            const bottom = Math.min(startBottom, endBottom);

            const safe = (n) => Number.isFinite(n) ? Math.round(n) : 0;
            getElement('coordStart').textContent = `${safe(left)}, ${safe(bottom)}`;
            getElement('coordEnd').textContent = `${safe(left + width)}, ${safe(bottom + height)}`;
            getElement('coordSize').textContent = `${safe(width)} x ${safe(height)}`;

            console.log('[DevTool] coord recorded:', { left: safe(left), bottom: safe(bottom), width: safe(width), height: safe(height) });
        };

        // 右键退出
        const onContextMenu = (e) => {
            e.preventDefault();
            this._stopCoordTool();
        };

        // 绑定事件（overlay 负责 mousedown/move/contextmenu；window 负责 mouseup，防止拖出窗口丢失）
        overlay.addEventListener('mousedown', onMouseDown);
        overlay.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        overlay.addEventListener('contextmenu', onContextMenu);

        // 复制按钮
        const copyBtn = getElement('coordCopyBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const start = getElement('coordStart').textContent;
                const _end = getElement('coordEnd').textContent;
                const size = getElement('coordSize').textContent;
                const text = `left: ${start.split(',')[0].trim()}px; bottom: ${start.split(',')[1].trim()}px; width: ${size.split('x')[0].trim()}px; height: ${size.split('x')[1].trim()}px;`;
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.textContent = '✅ 已复制';
                    TimerManager.setTimeout(() => copyBtn.textContent = '📋 复制坐标', 1500);
                }).catch(() => {
                    // fallback
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    copyBtn.textContent = '✅ 已复制';
                    TimerManager.setTimeout(() => copyBtn.textContent = '📋 复制坐标', 1500);
                });
            };
        }

        // 保存引用以便后续清理
        this._coordToolCleanup = () => {
            overlay.removeEventListener('mousedown', onMouseDown);
            overlay.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            overlay.removeEventListener('contextmenu', onContextMenu);
            overlay.querySelectorAll('.rect-preview, .mouse-label, .start-marker, .final-rect').forEach(el => el.remove());
            overlay.classList.remove('active');
            panel.classList.remove('active');
            if (overlay) overlay.style.display = 'none';
            if (panel) panel.style.display = 'none';
            if (copyBtn) copyBtn.onclick = null;
        };
    },

    _stopCoordTool() {
        console.log('[DevTool] _stopCoordTool called');
        if (this._coordToolCleanup) {
            this._coordToolCleanup();
            this._coordToolCleanup = null;
        }
        // 退出坐标工具后自动重新打开开发工具
        this.show();
    },

    // 加载帧图片
    _loadFrameImages(type) {
        const cfg = this.WEAPON_MAP[type];
        if (!cfg || !cfg.frames) return;
        for (const anim in cfg.frames) {
            const paths = cfg.frames[anim];
            if (Array.isArray(paths)) {
                paths.forEach(path => {
                    if (!this.images[path]) {
                        this.images[path] = loadImage(path);
                    }
                });
            }
        }
    }
};

export default DevTool;
export { DevTool };
