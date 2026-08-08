/**
 * 门闸实体（战斗房带门直墙）
 *
 * 状态机：open(帧15) / closed(帧0) / opening / closing
 * - 入场：替换距玩家最近的直墙件，初始 open 并立即 playClose()（关门困场）
 * - 战斗完成：playOpen()，门洞碰撞线段启停，门外白区+光束由 combat-room 协调
 * - 悬停金色轮廓（离屏烘焙外发光，零渲染开销）
 */
import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf, isoGateHole, isoHalfThick } from './wall-system.js';
import { SoundManager } from '../ui/sound-manager.js';
import { pathFinder } from '../ai/pathfinder.js';

const FRAMES = 16;
const ANIM_MS = 900; // 16 帧总时长
const DEFAULT_GATE_SOUND = 'assets/sounds/environment/gate.mp3';

export const WallGate = {
    state: 'open',
    sprite: null,
    glowSprite: null,
    _frame: FRAMES - 1,
    _frameTimer: 0,
    _onDone: null,
    // 世界几何
    _seg: null,      // 门底边线段（世界）
    _flip: false,
    _scale: null,    // { sx, sy, x0, y0 } 贴图映射
    _gateSeg: null,  // 门洞碰撞线段（isoSegments 条目）
    _depthMode: 'max',

    /** 当前样式门闸音效（ISO_WALL_STYLES.gateSound，placeAt 时随 _geoKey 锁定） */
    _gateSound() {
        const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
        return (style && style.gateSound) || DEFAULT_GATE_SOUND;
    },

    /** 当前门闸几何（跟随 WallSystem 墙样式；placeAt 时锁定） */
    _geo() {
        const key = this._geoKey || 'gate';
        return ISO_WALL_GEO[key] || ISO_WALL_GEO.gate;
    },

    /** 贴图内坐标 → 世界（origin 中心 + scale + flipX） */
    _tex2world(tx, ty) {
        const g = this._geo();
        let u = tx - g.w / 2;
        const v = ty - g.h / 2;
        if (this._flip) u = -u;
        return { x: this._cx + u * this._scale.sx, y: this._cy + v * this._scale.sy };
    },

    /**
     * 把门闸底边映射到世界线段 A->B（替换原直墙件的位置）
     * @param {Object} A 线段上端点
     * @param {Object} B 线段下端点
     * @param {boolean} flip 是否为 "/" 方向
     * @param {number|null} depth 显式深度（继承被替换件的 depth）；null 按 max 规则
     */
    placeAt(A, B, flip, depth = null) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const geoKey = (WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos().gate : 'gate');
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.gate;
        if (!scene || !scene.textures.exists(g.tex)) return false;
        this._geoKey = geoKey;
        const p0 = g.base[0];
        // 与墙件同一显示尺度（ISO_WALL_HEIGHT/ wallH + 角度补偿）：门高与邻墙一致（大小墙衔接）；
        // 底边起点锚定 A，门宽与被替换件的差距靠叠合吸收（只叠不缺）。
        // 僵尸素材恰好自洽（此尺度 == 旧线段反推值），行为不变
        const s = ISO_WALL_HEIGHT / g.wallH;
        const sx = s, sy = s * slopeFixOf(g);
        let x0, y0;
        if (!flip) {
            x0 = A.x - p0[0] * sx;
            y0 = A.y - p0[1] * sy;
        } else {
            // flip（"/" 方向）：flipX 为 quad 内镜像，p0→A、p1→B
            x0 = A.x - (g.w - p0[0]) * sx;
            y0 = A.y - p0[1] * sy;
        }
        this._flip = !!flip;
        this._scale = { sx: Math.abs(sx), sy };
        this._cx = x0 + g.w * Math.abs(sx) / 2;
        this._cy = y0 + g.h * sy / 2;
        this._seg = [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
        // 归属深度（门洞中心规则，见下方 _gateCenter 计算后修正）
        this._homeDepth = depth ?? Math.max(A.y, B.y);

        if (this.sprite) this.sprite.destroy();
        this.sprite = scene.add.sprite(this._cx, this._cy, g.tex, this._frame);
        this.sprite.setOrigin(0.5, 0.5);
        this.sprite.setScale(this._scale.sx, this._scale.sy);
        this.sprite.setFlipX(this._flip);

        // 门洞碰撞线段（states.open.hole/gateX 映射到世界）；门两侧墙体线段常开，门洞线段按状态启停
        const hole = isoGateHole(g);
        if (!hole) return false;
        const ht = isoHalfThick(g);
        const baseAt = (tx) => this._tex2world(tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
        const gA = baseAt(g.base[0][0]), gB = baseAt(g.base[1][0]);
        const g1 = baseAt(hole[0]), g2 = baseAt(hole[1]);
        this._wallSegs = [
            { x1: gA.x, y1: gA.y, x2: g1.x, y2: g1.y, halfThick: ht, _gate: true },
            { x1: g2.x, y1: g2.y, x2: gB.x, y2: gB.y, halfThick: ht, _gate: true },
        ];
        // [GATE-WAIT] _gateHole 标记：区分门洞段与两侧门墙段（均 _gate）。
        // MovementSystem 卡住检测只认门洞段做"门前等待"——门墙段是永久墙，不在此列
        this._gateSeg = { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, halfThick: ht, _gate: true, _gateHole: true };
        this._gateCenter = { x: (g1.x + g2.x) / 2, y: (g1.y + g2.y) / 2 };
        // 门墙 depth = 门洞中心底边 y（"墙看底边 max、门看门洞中心"定案）：
        // 单位过门洞时门后遮挡、过半场显现；调用方显式 depth 更低时（转角斜接 -0.1 退位）保留较低值
        this._homeDepth = (depth != null && depth < this._gateCenter.y) ? depth : this._gateCenter.y;
        this.sprite.setDepth(this._homeDepth);
        if (WallSystem.isoSegments) {
            for (const s of this._wallSegs) WallSystem.isoSegments.push(s);
        }
        this.setPassable(this.state === 'open' || this.state === 'opening');
        this._buildGlow();
        return true;
    },

    /** 门洞碰撞启停（open/opening 可通行）；门两侧墙体线段始终生效 */
    setPassable(passable) {
        if (!WallSystem.isoSegments || !this._gateSeg) return;
        const i = WallSystem.isoSegments.indexOf(this._gateSeg);
        let changed = false;
        if (!passable && i < 0) {
            WallSystem.isoSegments.push(this._gateSeg);
            changed = true;
        } else if (passable && i >= 0) {
            WallSystem.isoSegments.splice(i, 1);
            changed = true;
        }
        // [GATE-SOFT-COST] 门开关切换（低频事件）：局部失效门段区域寻路缓存，
        // 让关门软成本/开门零成本及时反映（格子 memo 与 SpatialHash 均按区域清）
        if (changed && pathFinder && typeof pathFinder.invalidateRegion === 'function') {
            const s = this._gateSeg;
            pathFinder.invalidateRegion(
                Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        }
    },

    playClose(onDone) {
        if (this.state === 'closed' || this.state === 'closing') return;
        this.state = 'closing';
        this._onDone = onDone || null;
        this.setPassable(false);
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(this._gateSound());
        }
        this._playAnim(FRAMES - 1, 0);
    },

    playOpen(onDone) {
        if (this.state === 'open' || this.state === 'opening') return;
        this.state = 'opening';
        this._onDone = onDone || null;
        this.setPassable(true);
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(this._gateSound());
        }
        this._playAnim(0, FRAMES - 1);
    },

    /** 帧动画（Phaser tween 计数器驱动，不依赖手动 update tick） */
    _playAnim(from, to) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this.sprite) this.sprite.setFrame(from);
        if (this.glowSprite) this.glowSprite.setFrame(from);
        if (!scene) { this._frame = to; this.state = to === 0 ? 'closed' : 'open'; return; }
        if (this._animCounter) this._animCounter.stop();
        this._animCounter = scene.tweens.addCounter({
            from,
            to,
            duration: ANIM_MS,
            ease: 'Linear',
            onUpdate: (tw) => {
                const f = Math.round(tw.getValue());
                if (this.sprite) this.sprite.setFrame(f);
                if (this.glowSprite) this.glowSprite.setFrame(f);
            },
            onComplete: () => {
                this._frame = to;
                this.state = to === 0 ? 'closed' : 'open';
                const cb = this._onDone;
                this._onDone = null;
                if (cb) cb();
            },
        });
    },

    /** 帧推进（CombatRoomSystem.update 驱动） */
    /** 帧推进已改 tween 驱动（_playAnim）；update 仅同步发光帧 */
    update(_dt) {
        if (this.glowSprite && this.sprite) {
            this.glowSprite.setFrame(this.sprite.frame.name);
        }
    },

    /** 门洞中心（世界）与 inward 方向（指向房内） */
    getGateInfo() {
        return { center: this._gateCenter, seg: this._seg, flip: this._flip, depthMode: this._depthMode };
    },

    /** 悬停金色轮廓（仅门洞区域，全帧烘焙，跟随门当前状态帧） */
    _buildGlow() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene) return;
        const g = this._geo();
        const texKey = g.tex;
        const glowKey = texKey + '_glow';
        if (!scene.textures.exists(glowKey)) {
            // 离屏烘焙：全部 16 帧的门洞区域剪影 × 金色 shadowBlur 外发光（只附门，不附两侧墙）
            const src = scene.textures.get(texKey).getSourceImage();
            const cols = Math.floor(src.width / g.w);
            const rowsN = Math.floor(src.height / g.h);
            // 门洞裁剪区（states.open.hole/gateX ± 边距，随样式几何）
            const hole = isoGateHole(g);
            const clipX = hole ? hole[0] - 75 : 190;
            const clipW = hole ? (hole[1] - hole[0]) + 150 : 240;
            const c = document.createElement('canvas');
            c.width = src.width;
            c.height = src.height;
            const ctx = c.getContext('2d');
                for (let r = 0; r < rowsN; r++) {
                for (let col = 0; col < cols; col++) {
                    const fx = col * g.w, fy = r * g.h;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(fx + clipX, fy, clipW, g.h); // 仅门洞区域
                    ctx.clip();
                    for (let i = 0; i < 3; i++) {
                        ctx.shadowColor = '#ffd700';
                        ctx.shadowBlur = 12 + i * 8;
                        ctx.drawImage(src, fx, fy, g.w, g.h, fx, fy, g.w, g.h);
                    }
                    // 抹掉砖块本体，只留金色外发光（否则高亮看起来像又生成了一堵墙）
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.drawImage(src, fx, fy, g.w, g.h, fx, fy, g.w, g.h);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.restore();
                }
            }
            scene.textures.addSpriteSheet(glowKey, c, { frameWidth: g.w, frameHeight: g.h });
        }
        if (this.glowSprite) this.glowSprite.destroy();
        this.glowSprite = scene.add.sprite(this._cx, this._cy, glowKey, this._frame);
        this.glowSprite.setOrigin(0.5, 0.5);
        this.glowSprite.setScale(this._scale.sx, this._scale.sy);
        this.glowSprite.setFlipX(this._flip);
        this.glowSprite.setDepth(this.sprite.depth + 0.5);
        this.glowSprite.setVisible(false);
    },

    setHighlight(on) {
        if (this.glowSprite) this.glowSprite.setVisible(!!on);
    },

    destroy() {
        if (this._animCounter) { this._animCounter.stop(); this._animCounter = null; }
        this.setPassable(true);
        if (WallSystem.isoSegments && this._wallSegs) {
            for (const s of this._wallSegs) {
                const i = WallSystem.isoSegments.indexOf(s);
                if (i >= 0) WallSystem.isoSegments.splice(i, 1);
            }
        }
        this._wallSegs = null;
        if (this.sprite) { this.sprite.destroy(); this.sprite = null; }
        if (this.glowSprite) { this.glowSprite.destroy(); this.glowSprite = null; }
        this._gateSeg = null;
        this.state = 'open';
        this._frame = FRAMES - 1;
    },
};

// 挂载到全局（wall-system 遮挡仲裁缓存引用用，避免模块环依赖）
if (typeof window !== 'undefined' && !window.WallGate) {
    window.WallGate = WallGate;
}
