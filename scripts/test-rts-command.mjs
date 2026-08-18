/**
 * 世界-122 指挥模式回归：
 * - 矿工移动/待命命令；
 * - 指挥与建筑模式互斥；
 * - 离场清理跨场景命令；
 * - 直接仓鼠单位移动命令立即打断攻击；
 * - 身体矩形选中与面板真实数据源。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

const rtsSrc = fs.readFileSync(path.join(ROOT, 'src/ui/rts-command.js'), 'utf8');
const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8');
const minerAiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-miner-ai.js'), 'utf8');
const minerEntitySrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-miner.js'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-guard-ai.js'), 'utf8');
const militiaSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-militia-ai.js'), 'utf8');
const shooterSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-shooter-ai.js'), 'utf8');
const scoutSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-scout-ai.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');

check('指挥模式启用时关闭建筑界面',
    /setEnabled\(on\)[\s\S]{0,120}if \(on\) this\._closeBuildingUI\(\)/.test(rtsSrc));
check('建筑模式开启时关闭指挥模式',
    /Game\.RTSCommand && Game\.RTSCommand\.enabled[\s\S]{0,80}setEnabled\(false\)/.test(buildingSrc));
check('RTS 鼠标过滤建筑面板',
    /recruit-overlay, \.wall-editor-panel/.test(rtsSrc));
check('掩体详情走 BuildingSystem.open，不再手动 active+裸建面板',
    /if \(!bs\.active && typeof bs\.open === 'function'\) bs\.open\(\)/.test(rtsSrc)
    && !/bs\.active = true/.test(rtsSrc));
check('离开 scene8 重置全队命令/目标/路径',
    /leavingScene8[\s\S]{0,180}_resetPartyCommandsForSceneExit/.test(rtsSrc)
    && /PartySystem\.setCommand\('all', 'follow'\)/.test(rtsSrc)
    && /m\._pathManager\._clearPath\(\)/.test(rtsSrc));
check('矿工 AI 每帧优先消费非 follow 指令',
    /const cmd = m\._command[\s\S]{0,160}this\._applyCommand\(cmd\)/.test(minerAiSrc));
check('移动/待命下发前取消直接单位攻击动作',
    /u\._ai\.cancelForCommand\(\)/.test(rtsSrc));
check('四类攻击仓鼠均提供 cancelForCommand',
    [guardSrc, militiaSrc, shooterSrc, scoutSrc].every((s) => /cancelForCommand\(\)/.test(s)));
check('矿工攻击命令降级为 hold',
    /mode === 'attack' && u\._rtsCanAttack === false[\s\S]{0,180}mode: 'hold'/.test(rtsSrc));
check('矿工声明不可执行攻击指令', /this\._rtsCanAttack = false/.test(minerEntitySrc));
check('矿工 move 设置战术目标并进入 walk',
    /if \(cmd\.mode === 'move'\)[\s\S]{0,360}m\._tacticalTarget = dest[\s\S]{0,120}m\._animState = 'walk'/.test(minerAiSrc));
check('矿工 hold/attack 清目标并站定',
    /m\._tacticalTarget = null[\s\S]{0,180}m\._animState = 'idle'[\s\S]{0,100}m\.maxSpeed = 0/.test(minerAiSrc));
check('点击与框选使用身体屏幕矩形',
    /_unitScreenRect\(e\)/.test(rtsSrc)
    && /r\.x1 >= x0 && r\.x0 <= x1/.test(rtsSrc));
check('属性面板攻击读取运行时AI/aiConfig',
    /e\._ai\._attackDamage/.test(rtsSrc)
    && /e\.aiConfig\.attackDamage/.test(rtsSrc));
check('属性面板移速优先读取配置速度',
    /e\.aiConfig\?\.walkSpeed/.test(rtsSrc));
check('右键攻击仅在实际下达攻击后触发目标红白闪现',
    /const attackers = this\._issueCommandToAllies\('attack', null, hit\.ref\)/.test(rtsSrc)
    && /if \(attackers > 0\) this\._flashAttackTarget\(hit\.ref\)/.test(rtsSrc)
    && /target\._rtsAttackFlashUntil = now \+ 720/.test(rtsSrc));
check('GameScene逐帧把攻击指令反馈渲染为红白交替贴图',
    /e\._rtsAttackFlashUntil/.test(gameSceneSrc)
    && /elapsed \/ 90/.test(gameSceneSrc)
    && /0xff3030 : 0xffffff/.test(gameSceneSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
