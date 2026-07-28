// ============================================================
// 玩家动画表（配置驱动）
// 数据源：data/player-anim-config.json（与 public/data/ 双份同步，运行时优先读 public 副本）
// 纹理键约定：player_<动画键>
// 新增姿态（持枪/瞄准/受击/死亡等）= 素材入库 + JSON 加条目，
// BootScene 加载/动画注册、GameScene 切换、交互开发工具面板全部自动生效。
// ============================================================

import playerAnimData from '../../data/player-anim-config.json';

// 打包内配置作为兜底，运行时 fetch 成功后覆盖
let PLAYER_ANIMS = { ...playerAnimData };

async function loadPlayerAnimConfig() {
    try {
        const response = await fetch('/data/player-anim-config.json?t=' + Date.now());
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data === 'object') {
            PLAYER_ANIMS = { ...PLAYER_ANIMS, ...data };
        }
    } catch (err) {
        console.warn('[PlayerAnim] 配置加载失败，使用打包内默认配置:', err);
    }
}

await loadPlayerAnimConfig();

// 动画键 → Phaser 纹理/动画键（player_<动画键>）
function playerTextureKey(animKey) {
    return `player_${animKey}`;
}

// 取动画定义（无配置返回 null）
function getPlayerAnimDef(animKey) {
    return PLAYER_ANIMS[animKey] || null;
}

// 动画自然时长（ms）；单帧/无帧率配置返回 0；frameDurations 存在时取各帧之和
function getPlayerAnimDurationMs(animKey) {
    const def = PLAYER_ANIMS[animKey];
    if (!def || def.type !== 'sheet') return 0;
    if (def.frameDurations && def.frameDurations.length) {
        return def.frameDurations.reduce((a, b) => a + (b || 0), 0);
    }
    if (!def.frameRate) return 0;
    const [start, end] = def.frames || [0, (def.frameCount || 1) - 1];
    return Math.round(((end - start + 1) / def.frameRate) * 1000);
}

export { PLAYER_ANIMS, playerTextureKey, getPlayerAnimDef, getPlayerAnimDurationMs };
