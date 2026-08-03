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

/**
 * 精灵帧边界占比（0~1，长度=帧数，末项恒 1）。
 * 与 BootScene 注册动画完全同口径：frameWeights 按权重分配 / frameDurations 按 ms 分配 / 缺省等分。
 * 单一数据源：近战武器 30 点跟手轨迹的"阶梯映射"必须按此边界取帧（生成脚本读同一份 JSON），
 * 任何改动 frameWeights/帧数都会改变边界——改节奏后必须重新运行生成脚本重烘焙轨迹。
 */
export function getSpriteFrameBounds(animKey) {
    const def = PLAYER_ANIMS[animKey];
    if (!def || def.type !== 'sheet') return null;
    const [start, end] = def.frames || [0, (def.frameCount || 1) - 1];
    const n = end - start + 1;
    let per;
    if (def.frameWeights && def.frameWeights.length) {
        const wsum = def.frameWeights.reduce((a, b) => a + (b || 0), 0) || 1;
        per = def.frameWeights.slice(0, n).map(w => (w || 1) / wsum);
        while (per.length < n) per.push(1 / n);
    } else if (def.frameDurations && def.frameDurations.length) {
        const dsum = def.frameDurations.reduce((a, b) => a + (b || 0), 0) || 1;
        per = def.frameDurations.slice(0, n).map(d => (d || 1) / dsum);
        while (per.length < n) per.push(1 / n);
    } else {
        per = Array(n).fill(1 / n);
    }
    const bounds = [];
    let acc = 0;
    for (const w of per) {
        acc += w;
        bounds.push(acc);
    }
    return bounds;
}

/** progress 0~1 → 精灵帧索引（末帧含 p==1）；无配置返回 0 */
export function getSpriteFrameAtProgress(animKey, progress) {
    const bounds = getSpriteFrameBounds(animKey);
    if (!bounds || bounds.length === 0) return 0;
    const p = Math.max(0, Math.min(1, progress));
    for (let i = 0; i < bounds.length; i++) {
        if (p < bounds[i]) return i;
    }
    return bounds.length - 1;
}

export { PLAYER_ANIMS, playerTextureKey, getPlayerAnimDef, getPlayerAnimDurationMs };
