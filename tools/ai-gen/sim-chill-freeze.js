#!/usr/bin/env node
// 模拟 applyChill/_updateChill/_updateFreeze/updateStatusEffects 的精确逻辑，
// 驱动"冰墙(1层/s) + 暴风雪(1层/0.5s)"组合，观察冻结前后叠层与文字触发。

let _chillStacks = 0;
let _chillTimer = 0;
let _chillSlowPercent = 0.05;
let _freezeStacks = 0;
let _freezeTimer = 0;
let statusEffects = [];
let textCount = 0;

const hasStatusEffect = (type) => statusEffects.some(e => e.type === type && e.remaining > 0);
const removeStatusEffect = (type) => { statusEffects = statusEffects.filter(e => e.type !== type); };
const addStatusEffect = (type, duration, options) => {
    const existing = statusEffects.find(e => e.type === type);
    if (existing) {
        existing.remaining = Math.max(existing.remaining, duration);
        if (options.stacks !== undefined) existing.stacks = options.stacks;
        return existing;
    }
    statusEffects.push({ type, remaining: duration, stacks: options.stacks ?? 1 });
};

function updateStatusEffects(dt) {
    for (let i = statusEffects.length - 1; i >= 0; i--) {
        statusEffects[i].remaining -= dt;
        if (statusEffects[i].remaining <= 0) statusEffects.splice(i, 1);
    }
}

function _updateChill(dt) {
    if (!_chillStacks || _chillStacks <= 0) return;
    _chillTimer -= dt;
    if (_chillTimer <= 0) {
        _chillStacks = 0;
        _chillTimer = 0;
        removeStatusEffect('chill');
    }
}

function _updateFreeze(dt) {
    if (!_freezeStacks || _freezeStacks <= 0) return;
    _freezeTimer -= dt;
    if (_freezeTimer <= 0) {
        _freezeStacks = 0;
        _freezeTimer = 0;
        removeStatusEffect('frozen');
    }
}

function applyFreeze(duration) {
    _freezeStacks = 1;
    _freezeTimer = duration;
    removeStatusEffect('frozen');
    addStatusEffect('frozen', duration, { stacks: 1 });
}

function applyChill(stacks, duration, slowPercent) {
    if (hasStatusEffect('statusImmune')) return 'immune';
    if (hasStatusEffect('frozen')) return 'frozen-skip';
    if (_chillStacks > 0) {
        _chillStacks += stacks;
        _chillTimer += duration;
    } else {
        _chillStacks = stacks;
        _chillTimer = duration;
        _chillSlowPercent = slowPercent;
    }
    let froze = false;
    if (_chillStacks >= 20) {
        _chillStacks -= 10;
        if (_chillStacks < 0) _chillStacks = 0;
        applyFreeze(duration);
        froze = true;
        if (_chillStacks === 0) {
            _chillTimer = 0;
            removeStatusEffect('chill');
        }
    }
    textCount++; // 真实代码里每跳都会发 "寒冷 +N层" 文字
    return { stacks: _chillStacks, timer: Math.round(_chillTimer), froze };
}

const DT = 16.67;
const WALL_MS = 1000, BLZ_MS = 500;
let t = 0, wallT = 0, blzT = 0;
const log = (label, r) => {
    if (r === 'frozen-skip') return;
    console.log(`${label.padEnd(26)} stacks=${String(_chillStacks).padStart(2)} timer=${String(Math.round(_chillTimer)).padStart(5)}ms frozen=${hasStatusEffect('frozen')} freezeNow=${r.froze}`);
};

// 前 12 秒：冰墙(3000ms/层) + 暴风雪(2500ms/层)
while (t < 12000) {
    t += DT;
    updateStatusEffects(DT);
    _updateChill(DT);
    _updateFreeze(DT);
    wallT += DT; blzT += DT;
    if (wallT >= WALL_MS) { wallT = 0; log('iceWall tick', applyChill(1, 3000, 0.05)); }
    if (blzT >= BLZ_MS) { blzT = 0; log('blizzard tick', applyChill(1, 2500, 0.035)); }
    if (hasStatusEffect('frozen')) log('  [frozen active]', { froze: false });
}
console.log(`\n文字触发次数: ${textCount}（应为每跳一次）`);
console.log('最终状态: stacks=' + _chillStacks + ' frozen=' + hasStatusEffect('frozen') + ' effects=' + JSON.stringify(statusEffects));
