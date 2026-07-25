/**
 * 门闸实体（战斗房带门直墙）
 *
 * 状态机：open(帧15) / closed(帧0) / opening / closing
 * - 入场：替换距玩家最近的直墙件，初始 open 并立即 playClose()（关门困场）
 * - 战斗完成：playOpen()，门洞碰撞线段启停，门外白区+光束由 combat-room 协调
 * - 悬停金色轮廓（离屏烘焙外发光，零渲染开销）
 */
import { WallSystem, ISO_WALL_GEO } from './wall-system.js';
import { SoundManager } from '../ui/sound-manager.js';

const FRAMES = 16;
const ANIM_MS = 900; // 16 帧总时长
const GATE_SOUND = 'assets/sounds/environment/gate.mp3';

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

    /** 贴图内坐标 → 世界（origin 中心 + scale + flipX） */
    _tex2world(tx, ty) {
        const g = ISO_WALL_GEO.gate;
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
        if (!scene || !scene.textures.exists('wall_gate')) return false;
        const g = ISO_WALL_GEO.gate;
        const [p0, p1] = g.base;
        let sx, sy, x0, y0;
        if (!flip) {
            sx = (B.x - A.x) / (p1[0] - p0[0]);
            sy = (B.y - A.y) / (p1[1] - p0[1]);
            x0 = A.x - p0[0] * sx;
            y0 = A.y - p0[1] * sy;
        } else {
            sx = (A.x - B.x) / (p1[0] - p0[0]);
            sy = (B.y - A.y) / (p1[1] - p0[1]);
            x0 = A.x - (g.w - p0[0]) * sx;
            y0 = A.y - p0[1] * sy;
        }
        this._flip = !!flip;
        this._scale = { sx: Math.abs(sx), sy };
        this._cx = x0 + g.w * Math.abs(sx) / 2;
        this._cy = y0 + g.h * sy / 2;
        this._seg = [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
        this._homeDepth = depth ?? Math.max(A.y, B.y); // 归属深度（继承被替换件的 min/max 规则）

        if (this.sprite) this.sprite.destroy();
        this.sprite = scene.add.sprite(this._cx, this._cy, 'wall_gate', this._frame);
        this.sprite.setOrigin(0.5, 0.5);
        this.sprite.setScale(this._scale.sx, this._scale.sy);
        this.sprite.setFlipX(this._flip);
        this.sprite.setDepth(this._homeDepth);

        // 门洞碰撞线段（gateX 映射到世界）；门两侧墙体线段常开，门洞线段按状态启停
        const baseAt = (tx) => this._tex2world(tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
        const gA = baseAt(g.base[0][0]), gB = baseAt(g.base[1][0]);
        const g1 = baseAt(g.gateX[0]), g2 = baseAt(g.gateX[1]);
        this._wallSegs = [
            { x1: gA.x, y1: gA.y, x2: g1.x, y2: g1.y, halfThick: 10, _gate: true },
            { x1: g2.x, y1: g2.y, x2: gB.x, y2: gB.y, halfThick: 10, _gate: true },
        ];
        this._gateSeg = { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, halfThick: 10, _gate: true };
        this._gateCenter = { x: (g1.x + g2.x) / 2, y: (g1.y + g2.y) / 2 };
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
        if (!passable && i < 0) {
            WallSystem.isoSegments.push(this._gateSeg);
        } else if (passable && i >= 0) {
            WallSystem.isoSegments.splice(i, 1);
        }
    },

    playClose(onDone) {
        if (this.state === 'closed' || this.state === 'closing') return;
        this.state = 'closing';
        this._onDone = onDone || null;
        this.setPassable(false);
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(GATE_SOUND);
        }
    },

    playOpen(onDone) {
        if (this.state === 'open' || this.state === 'opening') return;
        this.state = 'opening';
        this._onDone = onDone || null;
        this.setPassable(true);
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(GATE_SOUND);
        }
    },

    /** 帧推进（CombatRoomSystem.update 驱动） */
    update(dt) {
        if (this.state !== 'opening' && this.state !== 'closing') return;
        this._frameTimer += dt;
        const step = ANIM_MS / (FRAMES - 1);
        while (this._frameTimer >= step) {
            this._frameTimer -= step;
            this._frame += this.state === 'opening' ? 1 : -1;
            if (this._frame <= 0 || this._frame >= FRAMES - 1) {
                this._frame = Math.max(0, Math.min(FRAMES - 1, this._frame));
                this.state = this.state === 'opening' ? 'open' : 'closed';
                this._frameTimer = 0;
                if (this.sprite) this.sprite.setFrame(this._frame);
            if (this.glowSprite) this.glowSprite.setFrame(this._frame);
                const cb = this._onDone;
                this._onDone = null;
                if (cb) cb();
                return;
            }
            if (this.sprite) this.sprite.setFrame(this._frame);
            if (this.glowSprite) this.glowSprite.setFrame(this._frame);
        }
    },

    /** 门洞中心（世界）与 inward 方向（指向房内） */
    getGateInfo() {
        return { center: this._gateCenter, seg: this._seg, flip: this._flip, depthMode: this._depthMode };
    },

    /** 悬停金色轮廓（仅拱门区域，全帧烘焙，跟随门当前状态帧） */
    _buildGlow() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene) return;
        if (!scene.textures.exists('wall_gate_glow')) {
            // 离屏烘焙：全部 16 帧的拱门区域剪影 × 金色 shadowBlur 外发光（只附门，不附两侧墙）
            const g = ISO_WALL_GEO.gate;
            const src = scene.textures.get('wall_gate').getSourceImage();
            const cols = Math.floor(src.width / g.w);
            const rowsN = Math.floor(src.height / g.h);
            const c = document.createElement('canvas');
            c.width = src.width;
            c.height = src.height;
            const ctx = c.getContext('2d');
                for (let r = 0; r < rowsN; r++) {
                for (let col = 0; col < cols; col++) {
                    const fx = col * g.w, fy = r * g.h;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(fx + 190, fy, 240, g.h); // 仅拱门区域
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
            scene.textures.addSpriteSheet('wall_gate_glow', c, { frameWidth: g.w, frameHeight: g.h });
        }
        if (this.glowSprite) this.glowSprite.destroy();
        this.glowSprite = scene.add.sprite(this._cx, this._cy, 'wall_gate_glow', this._frame);
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
