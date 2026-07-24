import { Entity } from './entity.js';
import { WallSystem } from '../world/wall-system.js';

class NPC extends Entity {
    constructor(x, y, config = {}) {
        super(x, y);
        if (config.id) this.id = config.id;
        this.size = config.size || 24;
        this.collisionRadius = config.collisionRadius || 16;
        this.hittable = false; // 不可被攻击
        this.active = true;
        this.name = config.name || '商人NPC';
        this.npcType = config.npcType || 'shop'; // 'shop' | 'quest'
        this.portrait = config.portrait || 'assets/ui/npc_portrait.png';
        this.color = config.color || '#d4a373'; // 温暖棕色
        this.greetings = config.greetings || [
            '你好，冒险者！欢迎来到无限轮回。',
            '今天的天空格外晴朗呢。',
            '你看起来很强，要不要来商店看看？',
            '我听说最近在附近出现了一些奇怪的怪物。',
            '如果你需要强化装备，我可以帮你。',
            '你收集了多少战利品了？',
            '这个地方有时候会很危险，要小心。',
            '新鲜的货物刚到，快来看看！',
            '循环的世界永远不会无聊，对吧？',
            '你看起来需要帮助，有什么我可以做的吗？'
        ];
        this.interactionRange = config.interactionRange || 200;
        // 浮动动画
        this.floatOffset = 0;
        this.floatSpeed = 0.003;
        this.floatAmplitude = 3;

        // 贴图动画配置（game-config.json npcs.<key>.sprite；缺省保持纯色圆）
        this.spriteCfg = config.sprite || null;
        // 点击交互区域（可选，缺省=贴图整帧；content 小于帧时按内容收窄，避免吞掉旁边 NPC 的点击）
        this.clickAreaCfg = config.clickArea || null;
        if (this.spriteCfg && typeof this.spriteCfg.footOffsetY === 'number') {
            this.footOffsetY = this.spriteCfg.footOffsetY;
        }
        // 固定不动（如仓库）：实体分离中自身不动，由对方承担全部位移（类似障碍物）
        this.noSeparation = !!config.noSeparation;
        // 底座矩形障碍配置（scene-manager 建墙时读取；实体圆只保留小半径，阻挡交给矩形）
        this.obstacleCfg = config.obstacle || null;
        // 跳过脚下阴影（如仓库宝箱，贴图自带底座）
        this._noShadow = !!config.noShadow;
        // footprint 椭圆偏移（如仓库底部判定上移）
        if (typeof config.colliderOffsetY === 'number') this.colliderOffsetY = config.colliderOffsetY;
        if (typeof config.colliderOffsetX === 'number') this.colliderOffsetX = config.colliderOffsetX;

        // 随机游走配置（game-config.json npcs.<key>.wander；缺省不移动）
        this.wanderCfg = config.wander || null;
        this.isMoving = false;
        this._facingLeft = false;
        this._wanderHome = { x, y };
        this._wanderPhase = 'idle'; // 'idle' 停留 | 'move' 移动
        this._wanderTimer = this.wanderCfg ? (this.wanderCfg.idleMs ?? 7000) : 0;
        this._wanderTarget = null;

        // 碰撞字段在 super() 之后才赋值，必须重建 Collider（否则 groundRadius 永远是兜底值 10）
        this.rebuildCollider();
    }

    update(dt) {
        super.update(dt);
        // 浮动动画
        this.floatOffset = Math.sin(Date.now() * this.floatSpeed) * this.floatAmplitude;
        if (this.wanderCfg) this._updateWander(dt);
    }

    /**
     * 随机游走：以生成点为中心 radius 范围内活动。
     * 停留 idleMs → 随机选点移动（时长 moveMinMs~moveMaxMs，先到先停）→ 再停留，循环。
     */
    _updateWander(dt) {
        const W = this.wanderCfg;
        // 交互冻结期（对话/商店/仓库等面板打开中）：原地不动，计时器顺延
        if ((this._interactionHoldMs || 0) > 0) {
            this._interactionHoldMs -= dt;
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }
        this._wanderTimer -= dt;

        if (this._wanderPhase === 'idle') {
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            if (this._wanderTimer <= 0) {
                const target = this._pickWanderTarget(W);
                if (target) {
                    this._wanderTarget = target;
                    this._wanderPhase = 'move';
                    const minMs = W.moveMinMs ?? 2000;
                    const maxMs = W.moveMaxMs ?? 4000;
                    this._wanderTimer = minMs + Math.random() * Math.max(0, maxMs - minMs);
                } else {
                    // 选不到可行点：停留半个周期后重试
                    this._wanderTimer = (W.idleMs ?? 7000) / 2;
                }
            }
            return;
        }

        // move 阶段
        const t = this._wanderTarget;
        const arrived = !t || Math.hypot(t.x - this.x, t.y - this.y) < 8;
        if (arrived || this._wanderTimer <= 0) {
            this._wanderPhase = 'idle';
            this._wanderTimer = W.idleMs ?? 7000;
            this._wanderTarget = null;
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }
        const speed = W.speed ?? 90;
        const dx = t.x - this.x, dy = t.y - this.y;
        const d = Math.hypot(dx, dy);
        const step = Math.min(speed * dt / 1000, d);
        const nx = this.x + dx / d * step, ny = this.y + dy / d * step;
        const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
        const dts = Math.max(dt / 1000, 1e-4);
        this.vx = (r.x - this.x) / dts;
        this.vy = (r.y - this.y) / dts;
        this.x = r.x;
        this.y = r.y;
        this.isMoving = true;
        if (Math.abs(this.vx) > 0.1) this._facingLeft = this.vx < 0;
    }

    /** 在半径范围内随机选一个可达目标点（最多尝试 8 次） */
    _pickWanderTarget(W) {
        const radius = W.radius ?? 300;
        for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2;
            const dist = radius * (0.3 + Math.random() * 0.7);
            const tx = this._wanderHome.x + Math.cos(a) * dist;
            const ty = this._wanderHome.y + Math.sin(a) * dist;
            if (!WallSystem || typeof WallSystem.canMoveTo !== 'function') return { x: tx, y: ty };
            if (WallSystem.canMoveTo(tx, ty, this.groundRadius)) return { x: tx, y: ty };
        }
        return null;
    }

    /**
     * 点击交互区域（判定/调试可视化唯一口径）：
     * 返回相对实体位置的偏移矩形 {ox, oy, w, h}；无贴图返回 null（调用方回退圆形判定）。
     * clickArea 配置优先（按贴图内容收窄）；缺省=贴图整帧（中心 = 实体位置 - footOffsetY）。
     */
    getClickRect() {
        if (this.clickAreaCfg) {
            const w = this.clickAreaCfg.width ?? 0;
            const h = this.clickAreaCfg.height ?? 0;
            if (w > 0 && h > 0) return { ox: -w / 2, oy: -h, w, h };
        }
        if (this.spriteCfg && this.spriteCfg.size) {
            const sz = this.spriteCfg.size;
            const footY = (typeof this.footOffsetY === 'number') ? this.footOffsetY : sz / 2;
            return { ox: -sz / 2, oy: -footY - sz / 2, w: sz, h: sz };
        }
        return null;
    }

    getRandomGreeting() {
        return this.greetings[Math.floor(Math.random() * this.greetings.length)];
    }
}

export { NPC };
