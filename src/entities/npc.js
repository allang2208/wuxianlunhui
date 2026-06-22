import { Entity } from './entity.js';

class NPC extends Entity {
    constructor(x, y, config = {}) {
        super(x, y);
        this.size = config.size || 24;
        this.collisionRadius = config.collisionRadius || 16;
        this.hittable = false; // 不可被攻击
        this.active = true;
        this.name = config.name || '商人NPC';
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
    }

    update() {
        // 浮动动画
        this.floatOffset = Math.sin(Date.now() * this.floatSpeed) * this.floatAmplitude;
    }

    getRandomGreeting() {
        return this.greetings[Math.floor(Math.random() * this.greetings.length)];
    }

    render(ctx) {
        const screenPos = Renderer.worldToScreen(this.x, this.y);
        const y = screenPos.y + this.floatOffset;
        // NPC 身体（圆形）
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(screenPos.x, y, this.size, 0, Math.PI * 2);
        ctx.fill();
        // 边框
        ctx.strokeStyle = '#8a6a4a';
        ctx.lineWidth = 2;
        ctx.stroke();
        // 名称标签
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, screenPos.x, y - this.size - 8);
        // 交互提示（如果玩家靠近）
        if (Game.player) {
            const dx = this.x - Game.player.x;
            const dy = this.y - Game.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= this.interactionRange) {
                ctx.fillStyle = 'rgba(255, 255, 200, 0.8)';
                ctx.font = '10px "Microsoft YaHei", sans-serif';
                ctx.fillText('左键对话', screenPos.x, y + this.size + 16);
            }
        }
        ctx.textAlign = 'left';
    }
}

export { NPC };
