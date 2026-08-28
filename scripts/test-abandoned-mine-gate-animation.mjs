/**
 * 废弃矿洞升降门动画合同回归（纯 Node，不启动 Phaser/DOM）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { finishGateSprites, prepareGateSprites } from '../src/world/gate-visual-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeSprite(visible = true, frame = 0) {
    return {
        active: true,
        visible,
        frameValue: frame,
        setVisible(value) { this.visible = !!value; return this; },
        setFrame(value) { this.frameValue = Number(value); return this; },
    };
}

// 关门：隐藏的开启门先在顶部末帧重生，再落到闭合帧。
{
    const sprites = [makeSprite(false, 15), makeSprite(false, 15)];
    prepareGateSprites(sprites, 15);
    assert.ok(sprites.every(sprite => sprite.visible && sprite.frameValue === 15),
        '关门必须先在顶部末帧重新出现');
    finishGateSprites(sprites, 0, false, true);
    assert.ok(sprites.every(sprite => sprite.visible && sprite.frameValue === 0),
        '关门完成后必须保持闭合门可见');
}

// 开门：从闭合帧显现并升起，到末帧后完全隐藏。
{
    const sprites = [makeSprite(true, 0), makeSprite(true, 0)];
    prepareGateSprites(sprites, 0);
    finishGateSprites(sprites, 15, true, true);
    assert.ok(sprites.every(sprite => !sprite.visible && sprite.frameValue === 15),
        '矿洞门开启完成后必须完全隐藏');

    prepareGateSprites(sprites, 15);
    assert.ok(sprites.every(sprite => sprite.visible && sprite.frameValue === 15),
        '下次关门前必须在顶部重生');
}

// 其他地牢门不启用 hideWhenOpen，开启后仍保持现有末帧。
{
    const sprite = makeSprite(true, 0);
    finishGateSprites([sprite], 15, true, false);
    assert.equal(sprite.visible, true, '非矿洞门不得被连带隐藏');
}

const wallSystem = read('src/world/wall-system.js');
const wallGate = read('src/world/wall-gate.js');
const combatRoom = read('src/world/combat-room-system.js');
const chestRoom = read('src/world/chest-room-system.js');

assert.match(wallSystem, /abandoned_mine_gate:[^\n]+hideWhenOpen:\s*true/,
    '矿洞门几何必须显式开启开门后隐藏');
assert.match(wallGate, /finishGateSprites\(this\.sprites, to, to !== 0/,
    '战斗出口门必须收口到共享视觉合同');
assert.match(combatRoom, /prepareGateSprites\(sprites, from\)/,
    '竞技场关门必须从顶部帧重生');
assert.match(combatRoom, /finishGateSprites\(sprites, to, open, inst\.hideWhenOpen\)/,
    '竞技场开门完成必须应用隐藏合同');
assert.match(chestRoom, /finishGateSprites\(sprites, \(gateGeo\.frames \|\| 16\) - 1, true, gate\.hideWhenOpen\)/,
    '宝箱房开门完成必须应用隐藏合同');

console.log('✓ 废弃矿洞升降门：升起隐藏、顶部重生、下落关门与三路径接入均通过');
