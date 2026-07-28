import { AttackRangeEffect } from './attack-range-effect.js';
import { EffectManager } from './effect-manager.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/**
 * 战斗技能特效共享件（ROADMAP 任务3：各怪物技能特效逐字拷贝收口）
 *
 * 铁律：行为与原各调用点逐字拷贝 1:1 等价（视觉参数/时机/清理路径不变），仅换实现。
 * 覆盖模式：
 * - launchArcProjectile：抛物线投射物（集合体/矿石蜘蛛晶石/提灯/突击特工闪光弹）
 * - createGroundWarning / keepWarningAlive / destroyWarning：地面红色椭圆警示圈三件套
 * - fireGroundShockwave：冲击波扩散圈（闪烁版=集合体/手脑/蝇手；纯描边版=矿石蜘蛛）
 * - fireRadialLines：放射冲击线（手脑 8 线/突击特工 12 线）
 * - burstParticles：一次性粒子爆发（发射器留 (0,0) + explode 世界坐标 + 定时销毁陷阱收口）
 *
 * 预判（AimHelper.lead/线性外推）与枪口偏移保留在各调用方，不在本模块内。
 */

/** 渲染场景守卫（无渲染环境一律防御性回退） */
function getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

/**
 * ① 抛物线投射物：Linear 插值 + 二次抛物线高度（arcHeight*4*p*(1-p)），可选匀角速度旋转。
 * 无 scene 时立即同步调 onImpact 回退（与原各调用方防御性回退一致），并返回 null。
 * @param {object} o
 * @param {string} o.textureKey 投射物贴图键
 * @param {number} o.size 显示尺寸（setDisplaySize 正方形）
 * @param {number} o.sx / o.sy 出手点（枪口偏移等由调用方算好传入）
 * @param {number} o.tx / o.ty 落点（预判由调用方算好传入）
 * @param {number} o.arcHeight 抛物线最高点高度
 * @param {number} o.duration 飞行时长 ms
 * @param {number} [o.spin=0] 旋转角速度 rad/s；0=不转
 * @param {number} [o.depth] 渲染深度，缺省 sy+15
 * @param {function} o.onImpact 落地回调 (tx, ty) => void
 * @returns {{sprite, tween, cancel()}|null} cancel 供 _destroyCustomEffects：
 *   tween.stop（不发 onComplete，防尸体落地结算）+ sprite.destroy
 */
export function launchArcProjectile({ textureKey, size, sx, sy, tx, ty, arcHeight, duration, spin = 0, depth, onImpact }) {
    const scene = getScene();
    if (!scene || !scene.add || !scene.tweens) {
        // 无渲染场景时直接结算（防御性回退）
        if (onImpact) onImpact(tx, ty);
        return null;
    }
    const sprite = scene.add.sprite(sx, sy, textureKey);
    sprite.setDisplaySize(size, size);
    sprite.setDepth(depth ?? (sy + 15));
    const totalSpin = spin * (duration / 1000); // 全程总转角（rad）
    const tween = scene.tweens.add({
        targets: { t: 0 },
        t: 1,
        duration,
        ease: 'Linear',
        onUpdate(tw) {
            const p = tw.getValue();
            sprite.x = sx + (tx - sx) * p;
            sprite.y = sy + (ty - sy) * p - arcHeight * 4 * p * (1 - p);
            if (spin) sprite.rotation = totalSpin * p;
        },
        onComplete() {
            if (sprite.active) sprite.destroy();
            if (onImpact) onImpact(tx, ty);
        }
    });
    let cancelled = false;
    return {
        sprite,
        tween,
        cancel() {
            if (cancelled) return;
            cancelled = true;
            tween.stop();
            if (sprite.active) sprite.destroy();
        }
    };
}

/**
 * ② 地面警示圈三件套（AttackRangeEffect('ellipse') 口诀收口）
 * 创建：红色椭圆警示（与 footprint 椭圆同 2:1 透视），逐帧保活至结算。
 * @param {number} width 椭圆 Y 半径参数，缺省 radius*PERSPECTIVE_SCALE_Y
 *   （胖子僵尸腐蚀圈尸体阶段 ry 比例不同，显式传入保持原视觉）
 */
export function createGroundWarning(x, y, radius, width = radius * PERSPECTIVE_SCALE_Y) {
    const warn = new AttackRangeEffect(x, y, 0, radius, width, 'ellipse', 100, 0.5, true);
    warn.maxLife = 100;
    EffectManager.add(warn);
    return warn;
}

/**
 * 每帧保活：重置 life 续命（注意是重置 life 不是 maxLife——只刷 maxLife 会在 100ms 后自然消亡）。
 * @returns {boolean} warn 失效（null 或 active=false）时返回 false，调用方置 null
 */
export function keepWarningAlive(warn) {
    if (!warn || !warn.active) return false;
    warn.life = warn.maxLife;
    return true;
}

/**
 * 销毁警示圈：active=false + 显式销毁 Phaser 图形（"必须显式 destroy"教训收口：
 * EffectManager 移除后不会再触发 update 的延迟销毁，仅靠 active=false 会让警示圈永久残留）。
 * @returns {null} 便于调用方直接赋回引用（this._warn = destroyWarning(this._warn)）
 */
export function destroyWarning(warn) {
    if (warn) {
        warn.active = false;
        if (typeof warn._destroyPhaserGraphics === 'function') {
            warn._destroyPhaserGraphics();
        }
    }
    return null;
}

/**
 * ③ 冲击波扩散圈：椭圆圈由中心扩散到 maxRadius 并淡出（平面透视 2:1）。
 * flicker=true：0.55+0.45*sin(t*π*8) 闪烁 + (1-t) 淡出，加粗描边 + 极淡填充（集合体/手脑/蝇手版）；
 * flicker=false：纯描边无闪烁（矿石蜘蛛简化版，无填充、半径不夹最小 1px）。
 * groundLayer=true → depth y-998（地面特效层，实体之下）；false → depth y+50。
 * 完成后自动 destroy。→ graphics（调用方可 push 进自己的清理数组，_destroyCustomEffects 注册不变；
 * 数组中已完成的是 inactive 引用，清理路径有 active 守卫，与原 splice 行为等价）
 */
export function fireGroundShockwave({ x, y, maxRadius, strokeColor = 0xff3030, fillColor = 0xff4040,
    lineWidth = 8, duration = 600, flicker = true, groundLayer = false, strokeAlpha = 0.9, fillAlpha = 0.12 }) {
    const scene = getScene();
    if (!scene || !scene.add || !scene.tweens) return null;
    const g = scene.add.graphics();
    g.setDepth(groundLayer ? y - 998 : y + 50);
    const wave = { t: 0 };
    scene.tweens.add({
        targets: wave,
        t: 1,
        duration,
        ease: 'Cubic.easeOut',
        onUpdate() {
            const t = wave.t;
            g.clear();
            if (flicker) {
                const r = Math.max(1, maxRadius * t);
                // 闪烁：高频正弦叠加在淡出曲线上，冲击波呈脉冲感
                const fl = 0.55 + 0.45 * Math.sin(t * Math.PI * 8);
                // 加粗冲击波描边（随扩散淡出 × 闪烁）+ 极淡填充
                g.lineStyle(lineWidth, strokeColor, (1 - t) * strokeAlpha * fl);
                g.strokeEllipse(x, y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
                g.fillStyle(fillColor, (1 - t) * fillAlpha * fl);
                g.fillEllipse(x, y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
            } else {
                // 纯描边无闪烁（矿石蜘蛛版）
                g.lineStyle(lineWidth, strokeColor, strokeAlpha * (1 - t));
                g.strokeEllipse(x, y, maxRadius * 2 * t, maxRadius * 2 * PERSPECTIVE_SCALE_Y * t);
            }
        },
        onComplete() { if (g.active) g.destroy(); }
    });
    return g;
}

/**
 * ④ 放射冲击线：count 条线从爆心向 360° 快速伸展并淡出（平面透视 y 分量压缩，
 * 角度错开半格 π/count）。inner/outer 随 t 从 innerFrom→innerTo / outerFrom→outerTo 线性伸展。
 * 完成后自动 destroy。→ graphics（调用方可 push 进自己的清理数组，同 ③ 注册口径）
 */
export function fireRadialLines({ x, y, count = 8, color = 0xffffff, innerFrom, innerTo, outerFrom, outerTo,
    duration = 280, lineWidth = 3, alpha = 0.9 }) {
    const scene = getScene();
    if (!scene || !scene.add || !scene.tweens) return null;
    const g = scene.add.graphics();
    g.setDepth(y + 50);
    const wave = { t: 0 };
    scene.tweens.add({
        targets: wave,
        t: 1,
        duration,
        ease: 'Cubic.easeOut',
        onUpdate() {
            const t = wave.t;
            g.clear();
            g.lineStyle(lineWidth, color, (1 - t) * alpha);
            const inner = innerFrom + (innerTo - innerFrom) * t;
            const outer = outerFrom + (outerTo - outerFrom) * t;
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + Math.PI / count;
                // 平面透视：y 分量按 PERSPECTIVE_SCALE_Y 压缩
                const cos = Math.cos(angle), sin = Math.sin(angle) * PERSPECTIVE_SCALE_Y;
                g.beginPath();
                g.moveTo(x + cos * inner, y + sin * inner);
                g.lineTo(x + cos * outer, y + sin * outer);
                g.strokePath();
            }
        },
        onComplete() { if (g.active) g.destroy(); }
    });
    return g;
}

/**
 * ⑥ 随机放射爆裂线：count 条随机角度/长度/线宽的射线从爆心伸展（生长期 → 淡出期逐线错开），
 * 视觉=符文剑命中爆裂（原 particle-effects.js RuneSwordExplodeEffect 的共享化，逐参数 1:1）。
 * perspective=false 正圆（符文剑原版）；true 则 y 分量按 PERSPECTIVE_SCALE_Y 压缩（地面冲击线）。
 * 完成后自动 destroy。→ graphics（调用方可 push 进自己的清理数组，同 ③ 注册口径）
 */
export function fireRadialBurst({ x, y, count = 35, color = 0x3282ff,
    lenMin = 15, lenMax = 55, widthMin = 1, widthMax = 3,
    growMinMs = 80, growMaxMs = 200, fadeMinMs = 150, fadeMaxMs = 300,
    duration = 400, perspective = false, depth }) {
    const scene = getScene();
    if (!scene || !scene.add || !scene.tweens) return null;
    const g = scene.add.graphics();
    g.setDepth(depth ?? (y + 50));
    g.setPosition(x, y);
    const lines = [];
    for (let i = 0; i < count; i++) {
        lines.push({
            angle: Math.random() * Math.PI * 2,
            length: lenMin + Math.random() * (lenMax - lenMin),
            width: widthMin + Math.random() * (widthMax - widthMin),
            growDuration: growMinMs + Math.random() * (growMaxMs - growMinMs),
            fadeDuration: fadeMinMs + Math.random() * (fadeMaxMs - fadeMinMs),
            elapsed: 0,
        });
    }
    // 总时长与原版 RuneSwordExplodeEffect 一致（life=400ms；长 fade 的线在原版同样被截断）
    const wave = { t: 0 };
    scene.tweens.add({
        targets: wave,
        t: 1,
        duration,
        ease: 'Linear',
        onUpdate() {
            const elapsed = wave.t * duration;
            g.clear();
            for (const line of lines) {
                let alpha, currentLen;
                if (elapsed < line.growDuration) {
                    currentLen = line.length * (elapsed / line.growDuration);
                    alpha = 1;
                } else {
                    const p = (elapsed - line.growDuration) / line.fadeDuration;
                    if (p >= 1) continue;
                    currentLen = line.length;
                    alpha = 1 - p;
                }
                const sy = perspective ? PERSPECTIVE_SCALE_Y : 1;
                g.lineStyle(line.width, color, alpha);
                g.beginPath();
                g.moveTo(0, 0);
                g.lineTo(Math.cos(line.angle) * currentLen, Math.sin(line.angle) * currentLen * sy);
                g.strokePath();
            }
        },
        onComplete() { if (g.active) g.destroy(); },
    });
    return g;
}

/**
 * ⑤ 一次性粒子爆发：[Phaser 粒子坐标陷阱收口] 发射器必须留在 (0,0)，explode 传世界坐标；
 * addToUpdateList + delayedCall 定时销毁，防一次性发射器残留。
 * @param {string} o.texture 粒子贴图键（不存在则静默跳过，返回 null）
 * @param {object} o.config 粒子配置（emitting 强制 false）
 * @param {number} o.destroyAfterMs 爆发完成后销毁发射器的延迟
 * @param {number} [o.jitter=0] 爆发点随机偏移幅度（±jitter px）
 * @param {number} [o.depth] 渲染深度（不传则不设置）
 * @returns {ParticleEmitter|null}
 */
export function burstParticles({ texture, x, y, count, config, destroyAfterMs, jitter = 0, depth }) {
    const scene = getScene();
    if (!scene || !scene.add || !scene.time) return null;
    // impact_dot 是 GameScene 懒生成纹理——首个特效触发前先兜底创建（否则玩家首次施法时静默无粒子）
    if (!scene.textures.exists(texture) && texture === 'impact_dot' && typeof scene._ensureImpactDotTexture === 'function') {
        scene._ensureImpactDotTexture();
    }
    if (!scene.textures || !scene.textures.exists(texture)) return null;
    const emitter = scene.add.particles(0, 0, texture, { ...config, emitting: false });
    emitter.addToUpdateList();
    if (depth !== undefined) emitter.setDepth(depth);
    const ex = jitter ? x + (Math.random() * 2 - 1) * jitter : x;
    const ey = jitter ? y + (Math.random() * 2 - 1) * jitter : y;
    emitter.explode(count, ex, ey);
    scene.time.delayedCall(destroyAfterMs, () => { if (emitter && emitter.active) emitter.destroy(); });
    return emitter;
}
