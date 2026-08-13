#!/usr/bin/env node
/* 世界音效距离衰减验证（2026-08-11）：
 *  1) 默认传播距离从 audio-config.json 读取（defaultMaxDist=2000）
 *  2) 距离 0 → 100% 音量；1000px → 50%；超过 2000 → 不播
 *  3) 关闭衰减（enabled=false）→ 全局满音量
 * 用法：node --import ./scripts/register-json-loader.mjs tools/verify-distance-audio.mjs
 */
import { SoundManager } from '../src/ui/sound-manager.js';

globalThis.window = { Game: { player: { x: 0, y: 0, active: true } } };
const calls = [];
const origPlayFile = SoundManager.playFile;
SoundManager.playFile = (p, v) => calls.push({ p, v });
SoundManager.enabled = true;

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}

// 配置读取
const cfg = SoundManager._distance;
check('配置已加载', !!cfg && cfg.defaultMaxDist === 2000, JSON.stringify(cfg));

// 距离衰减
calls.length = 0;
SoundManager.playWorld('a.mp3', 0, 0);         // 距离 0
SoundManager.playWorld('b.mp3', 1000, 0);      // 距离 1000（50%）
SoundManager.playWorld('c.mp3', 2500, 0);      // 距离 2500（超出 2000 → 不播）
SoundManager.playWorld('d.mp3', 300, 0);       // 距离 300（85%）
check('距离0 = 100%', calls.length === 3 && Math.abs(calls[0].v - 1) < 1e-9, `v=${calls[0]?.v}`);
check('距离1000 = 50%', calls.length >= 2 && Math.abs(calls[1].v - 0.5) < 1e-9, `v=${calls[1]?.v}`);
check('距离2500 不播', calls.length === 3, `播了${calls.length}个（应3个）`);
check('距离300 = 85%', calls.length === 3 && Math.abs(calls[2].v - 0.85) < 1e-9, `v=${calls[2]?.v}`);

// 单次覆盖传播距离（opts.maxDist）
calls.length = 0;
SoundManager.playWorld('e.mp3', 1500, 0, 1, 'sfx', { maxDist: 3000 }); // 1500/3000 = 50%
check('opts.maxDist 覆盖', calls.length === 1 && Math.abs(calls[0].v - 0.5) < 1e-9, `v=${calls[0]?.v}`);

// 关闭衰减 → 全局满音量
SoundManager._distance.enabled = false;
calls.length = 0;
SoundManager.playWorld('f.mp3', 5000, 0); // 远超默认距离
check('enabled=false 全局响', calls.length === 1 && Math.abs(calls[0].v - 1) < 1e-9, `v=${calls[0]?.v}`);
SoundManager._distance.enabled = true;

// computeDistanceVolume 循环曲线配置化
const v0 = SoundManager.computeDistanceVolume(0);    // 近端 → max 1.5
const vFar = SoundManager.computeDistanceVolume(2500); // 超出 maxDist → 0
check('循环曲线近端=1.5', Math.abs(v0 - 1.5) < 1e-9, `v=${v0}`);
check('循环曲线超距=0', vFar === 0, `v=${vFar}`);

SoundManager.playFile = origPlayFile;
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `结果: ${results.length - failed.length} 通过, ${failed.length} 失败` : `结果: ${results.length} 通过, 0 失败`);
process.exit(failed.length ? 1 : 0);
