#!/usr/bin/env node
/**
 * 把开发工具导出的参数片段合并进 public/data/weapon-anim-config.json
 * 用法：node scripts/apply-weapon-config.js <patch.json>
 *
 * patch.json 示例（holdOffset 模式）：
 * {
 *   "weaponType": "sword",
 *   "anim": "idle",
 *   "mode": "holdOffset",
 *   "rotation": 20,
 *   "scale": 1.5,
 *   "holdOffsetX": -33,
 *   "holdOffsetY": 18
 * }
 *
 * patch.json 示例（handAnchor 模式）：
 * {
 *   "weaponType": "sword",
 *   "anim": "idle",
 *   "mode": "handAnchor",
 *   "rotation": 20,
 *   "scale": 1.5,
 *   "handAnchor": { "x": -34, "y": 4 },
 *   "gripOffset": { "x": 0, "y": 32 }
 * }
 */

const fs = require('fs');
const path = require('path');

const patchFile = process.argv[2];
if (!patchFile) {
    console.error('Usage: node scripts/apply-weapon-config.js <patch.json>');
    process.exit(1);
}

const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
const { weaponType, anim, mode, rotation, scale, holdOffsetX, holdOffsetY, handAnchor, gripOffset, keyframes } = patch;

if (!weaponType || !anim) {
    console.error('patch must contain weaponType and anim');
    process.exit(1);
}

const configPath = path.join(__dirname, '../public/data/weapon-anim-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (!config[weaponType]) config[weaponType] = {};
const cfg = config[weaponType];

const hasStateConfig = cfg.idle && typeof cfg.idle === 'object';
const useState = hasStateConfig && ['idle', 'walk', 'running'].includes(anim);

if (mode === 'handAnchor') {
    if (!cfg.handAnchors) cfg.handAnchors = {};
    if (handAnchor) {
        cfg.handAnchors[anim] = { x: Math.round(handAnchor.x), y: Math.round(handAnchor.y) };
    }
    if (gripOffset) {
        cfg.gripOffset = {
            x: Math.round(gripOffset.x),
            y: Math.round(gripOffset.y),
        };
    }
} else if (mode === 'holdOffset') {
    const target = useState ? (cfg[anim] || (cfg[anim] = {})) : cfg;
    target.holdOffsetX = Math.round(holdOffsetX);
    target.holdOffsetY = Math.round(holdOffsetY);
} else {
    console.warn(`Unknown mode "${mode}", only rotation/scale will be applied.`);
}

// rotation / scale 写入对应层级
const rotTarget = useState ? (cfg[anim] || (cfg[anim] = {})) : cfg;
if (rotation !== undefined) rotTarget.idleRotation = Math.round(rotation);
if (scale !== undefined) rotTarget.idleScale = parseFloat(parseFloat(scale).toFixed(2));

// 关键帧（如果 patch 里带了完整数组）
if (keyframes && Array.isArray(keyframes)) {
    if (!config.keyframes) config.keyframes = {};
    if (!config.keyframes[weaponType]) config.keyframes[weaponType] = {};
    config.keyframes[weaponType][anim] = JSON.parse(JSON.stringify(keyframes));
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log(`[apply-weapon-config] Applied ${weaponType}.${anim} (${mode}) to ${configPath}`);
