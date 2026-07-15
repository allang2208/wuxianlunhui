#!/usr/bin/env node
/**
 * 将 sword 的 handAnchor 攻击关键帧转换为逐帧绝对偏移配置
 * 输出写入 public/data/weapon-anim-config.json
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../public/data/weapon-anim-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const cfg = config.sword;
if (!cfg) {
    console.error('No sword config found');
    process.exit(1);
}

const handAnchors = cfg.handAnchors || {};
const anchor = handAnchors.attack || { x: 0, y: 0 };
const gripOffset = cfg.gripOffset || { x: 0, y: 0 };
const idleRotation = (cfg.idleRotation || 0) * Math.PI / 180;
const baseRotation = Math.PI / 2;
const keyframes = config.keyframes && config.keyframes.sword && config.keyframes.sword.attack;

if (!keyframes || keyframes.length === 0) {
    console.error('No sword attack keyframes found');
    process.exit(1);
}

const frames = keyframes.map(kf => {
    const handWorldX = anchor.x + (kf.handOffsetX || 0);
    const handWorldY = anchor.y + (kf.handOffsetY || 0);
    const kfRotation = (kf.rotation || 0) * Math.PI / 180;
    const totalRotation = baseRotation + idleRotation + kfRotation;
    const cos = Math.cos(totalRotation);
    const sin = Math.sin(totalRotation);
    const gripRotatedX = cos * gripOffset.x - sin * gripOffset.y;
    const gripRotatedY = sin * gripOffset.x + cos * gripOffset.y;
    return {
        offsetX: Math.round(handWorldX + gripRotatedX),
        offsetY: Math.round(handWorldY + gripRotatedY),
        rotation: Math.round(kf.rotation || 0),
        scale: kf.scale !== undefined ? kf.scale : 1,
    };
});

// 写入逐帧配置
cfg.attack = {
    type: 'perFrame',
    frames,
};

// 清理旧的 handAnchor / gripOffset / 关键帧，避免冲突
delete cfg.handAnchors;
delete cfg.gripOffset;
if (config.keyframes && config.keyframes.sword) {
    delete config.keyframes.sword.attack;
    if (Object.keys(config.keyframes.sword).length === 0) {
        delete config.keyframes.sword;
    }
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log(`[convert-to-perframe] Converted sword attack to perFrame mode with ${frames.length} frames`);
frames.forEach((f, i) => {
    console.log(`  frame ${i}: offset(${f.offsetX}, ${f.offsetY}) rotation(${f.rotation}) scale(${f.scale})`);
});
