import { DamageableEntity } from './damageable-entity.js';
import { ThrustAttack } from '../combat/attack.js';

        class Enemy extends DamageableEntity {
            constructor(x, y, config = {}) {
                super(x, y, { hp: config.hp || 150, maxHp: config.maxHp || 150, size: config.size || 14, collisionRadius: 12, name: config.name || '测试敌人' });
                this.speed = config.speed || 0.3; this.maxSpeed = this.speed; this.accel = 0.7; this.friction = 0.82;
                this.animTime = 0; this.isMoving = false; this.rotation = 0;
                this.attacks = { melee: new ThrustAttack({ cooldown: 600, range: 80, width: 20, damage: { min: 8, max: 15 }, knockback: 15 }) };
                this.weaponMode = 'melee';
                this.expValue = config.expValue || 10;
                this.weaponImage = new Image(); this.weaponImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                this.data = { stamina: 9999, maxStamina: 9999, name: this.name, kills: 0 };
                this.aiTimer = 0; this.aiInterval = 300; this.target = null; this.attackRange = 70;
                this._dashStunned = false; // 冲刺攻击眩晕状态
                this._dashStunTimer = 0; // 眩晕剩余时间
            }
            triggerWeaponAnim() {
                // 动画打断机制：无论当前动画状态，立即重置为 windup
                this.weaponAnim.state = 'windup';
                this.weaponAnim.timer = 0;
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle': anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06; break;
                    case 'windup':
                        anim.timer += dt;
                        if (anim.timer >= wa.windupMs) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / wa.windupMs);
                        break;
                    case 'swing':
                        anim.timer += dt;
                        if (anim.timer >= wa.swingMs) { anim.state = 'recover'; anim.timer = 0; }
                        else anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / wa.swingMs);
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= wa.recoverMs) { anim.state = 'idle'; anim.timer = 0; }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / wa.recoverMs);
                        break;
                }
            }
            renderWeapon(ctx) {
                if (!this.weaponImage || !this.weaponImage.complete) return;
                const wa = WEAPON_ANIM, s = wa.size, w = s * 0.84;
                ctx.save();
                ctx.translate(wa.holdX, wa.holdY);
                ctx.rotate(Math.PI / 2);
                let finalAngle = this.weaponAnim.angle;
                if (this.isMoving && this.weaponAnim.state === 'idle') {
                    const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                }
                ctx.rotate(finalAngle);
                if (this.weaponImage && this.weaponImage.complete && this.weaponImage.naturalWidth > 0) ctx.drawImage(this.weaponImage, -w / 2, -s / 2, w, s);
                ctx.restore();
            }
            // === AI 系统：移动寻路 与 攻击指令 完全分离 ===
            update(dt, entities) {
                super.update();
                // 冲刺攻击眩晕计时
                if (this._dashStunned) {
                    this._dashStunTimer -= dt;
                    if (this._dashStunTimer <= 0) {
                        this._dashStunned = false;
                    }
                }
                // 1. 寻找目标
                if (!this.target) {
                    entities.forEach(e => { if (e instanceof Player) this.target = e; });
                }
                if (!this.target || !this.target.active) return;
                const dx = this.target.x - this.x, dy = this.target.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                this.rotation = Math.atan2(dy, dx);
                // 2. 移动系统（始终独立运行）
                this._updateMovement(dx, dy, dist);
                // 3. 攻击系统（始终独立运行）
                this._updateAttack(dt, entities);
                // 4. 更新攻击冷却和武器动画
                this.attacks.melee.update(dt);
                this.updateWeaponAnim(dt);
            }
            // --- 移动寻路子系统：始终朝玩家移动，带墙壁碰撞和绕路 ---
            _updateMovement(dx, dy, dist) {
                // 冲刺攻击眩晕：无法移动
                if (this._dashStunned) {
                    this.vx = 0; this.vy = 0;
                    this.isMoving = false;
                    return;
                }
                // 归一化方向
                const moveX = dx / Math.max(dist, 1), moveY = dy / Math.max(dist, 1);
                // 加速度
                this.vx += (moveX * this.maxSpeed - this.vx) * this.accel;
                this.vy += (moveY * this.maxSpeed - this.vy) * this.accel;
                // 墙壁碰撞解析
                const enx = this.x + this.vx, eny = this.y + this.vy;
                const er = WallSystem.resolve(this.x, this.y, enx, eny, this.collisionRadius || 12);
                if (er.x === this.x && er.y === this.y) {
                    // 被墙困住：沿切线方向滑动（绕路）
                    this.vx *= 0.5; this.vy *= 0.5;
                    const tangentX = -moveY, tangentY = moveX;
                    const slideDist = this.maxSpeed * 2;
                    // 尝试切线方向 A
                    const saX = this.x + tangentX * slideDist, saY = this.y + tangentY * slideDist;
                    const saR = WallSystem.resolve(this.x, this.y, saX, saY, this.collisionRadius || 12);
                    if (saR.x !== this.x || saR.y !== this.y) {
                        this.x = saR.x; this.y = saR.y;
                        this.vx = tangentX * this.maxSpeed * 0.5;
                        this.vy = tangentY * this.maxSpeed * 0.5;
                    } else {
                        // 尝试切线方向 B（反向）
                        const sbX = this.x - tangentX * slideDist, sbY = this.y - tangentY * slideDist;
                        const sbR = WallSystem.resolve(this.x, this.y, sbX, sbY, this.collisionRadius || 12);
                        if (sbR.x !== this.x || sbR.y !== this.y) {
                            this.x = sbR.x; this.y = sbR.y;
                            this.vx = -tangentX * this.maxSpeed * 0.5;
                            this.vy = -tangentY * this.maxSpeed * 0.5;
                        } else {
                            this.vx = 0; this.vy = 0;
                        }
                    }
                } else {
                    if (er.x === this.x) this.vx = 0;
                    if (er.y === this.y) this.vy = 0;
                    this.x = er.x; this.y = er.y;
                }
                // 距离近时摩擦减速（避免冲过头）
                if (dist <= this.attackRange) {
                    this.vx *= this.friction;
                    this.vy *= this.friction;
                }
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                if (this.isMoving) this.animTime += 0.15;
            }
            // --- 攻击指令子系统：独立运行，只要视线未被墙完全阻挡就尝试攻击 ---
            _updateAttack(dt, entities) {
                this.aiTimer += dt;
                if (this.aiTimer < this.aiInterval) return;
                if (!this.attacks.melee.canUse()) return;
                // 视线检测：检查攻击是否被墙阻挡
                // 即使不在攻击范围内，只要视线未被完全阻挡就尝试攻击
                const targetX = this.target.x, targetY = this.target.y;
                const isBlocked = typeof WallSystem !== 'undefined' &&
                    WallSystem.blocked(this.x, this.y, targetX, targetY);
                if (isBlocked) return; // 视线被墙完全挡住，无法攻击
                // 执行攻击（无论距离是否精确在 attackRange 内，都会尝试）
                this.aiTimer = 0;
                if (this.attacks.melee.use(this, targetX, targetY, Array.from(entities.values()))) {
                    this.triggerWeaponAnim();
                }
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
                this.renderHealthBar(ctx);
                ctx.save(); ctx.translate(x, y); ctx.rotate(this.rotation);
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 8, 4, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#8a4a4a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'rgba(180, 100, 100, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                this.renderWeapon(ctx);
                ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(180, 100, 100, 0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
                this.renderCollisionRadius(ctx);
            }
        }

export { Enemy };
