import { DamageableEntity } from './damageable-entity.js';

        class TargetDummy extends DamageableEntity {
            constructor(x, y, config = {}) { 
                super(x, y, { hp: config.hp || 200, maxHp: config.maxHp || 200, size: config.size || 24, collisionRadius: 20, name: config.name || '训练靶', ...config }); 
                this.wobble = 0; 
                this.baseY = y; 
                this.expValue = config.expValue || 10; 
                // ===== DPS追踪系统 =====
                this._dpsTracking = config.dpsTracking || false;
                this._damageHistory = []; // { time: timestamp, damage: number }
                this._dpsDisplay = { dps: 0, total: 0 };
                this._dpsRefreshTimer = 0;
            }
            takeDamage(damage, source) {
                // DPS追踪：记录伤害
                if (this._dpsTracking) {
                    const now = Date.now();
                    this._damageHistory.push({ time: now, damage: damage });
                    // 清理超过5秒的记录
                    this._damageHistory = this._damageHistory.filter(r => now - r.time <= 5000);
                    // 计算总伤害
                    this._dpsDisplay.total = this._damageHistory.reduce((sum, r) => sum + r.damage, 0);
                    // 计算DPS（总伤害/5秒）
                    this._dpsDisplay.dps = Math.round(this._dpsDisplay.total / 5);
                }
                // 无限生命值：不扣血，但显示命中效果
                if (this._dpsTracking) {
                    this.hitFlash = this.hitFlashDuration;
                    EffectManager.createDamageText(this.x, this.y - this.size, damage, false);
                    // 暴击音效（如果source有暴击信息）
                    // 不调用父类takeDamage，避免死亡和额外逻辑
                    return;
                }
                super.takeDamage(damage, source);
            }
            update() {
                if (this._dpsTracking) {
                    // 更新击退
                    if (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1) {
                        const nx = this.x + this.knockbackX;
                        const ny = this.y + this.knockbackY;
                        const radius = this.collisionRadius || this.size * 0.6 || 10;
                        if (typeof WallSystem !== 'undefined' && WallSystem.walls && WallSystem.walls.length > 0) {
                            const resolved = WallSystem.resolve(this.x, this.y, nx, ny, radius);
                            const hitWall = Math.abs(resolved.x - nx) > 0.5 || Math.abs(resolved.y - ny) > 0.5;
                            if (hitWall) {
                                const angle = Math.atan2(this.knockbackY, this.knockbackX);
                                this.x = resolved.x - Math.cos(angle) * 5;
                                this.baseY += (resolved.y - this.y) - Math.sin(angle) * 5;
                                if (typeof EffectManager !== 'undefined') EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                                this.knockbackX = 0;
                                this.knockbackY = 0;
                            } else {
                                this.x = resolved.x;
                                this.baseY += (resolved.y - this.y);
                            }
                        } else {
                            this.x = nx;
                            this.baseY += this.knockbackY;
                        }
                        this.knockbackX *= this.knockbackFriction;
                        this.knockbackY *= this.knockbackFriction;
                        if (Math.abs(this.knockbackX) < 0.1) this.knockbackX = 0;
                        if (Math.abs(this.knockbackY) < 0.1) this.knockbackY = 0;
                    }
                    if (this.hitFlash > 0) this.hitFlash -= 16;
                    this.wobble += 0.05;
                    this.y = this.baseY + Math.sin(this.wobble) * 3;
                    // 每秒刷新DPS显示
                    this._dpsRefreshTimer += 16;
                    if (this._dpsRefreshTimer >= 1000) {
                        this._dpsRefreshTimer = 0;
                        const now = Date.now();
                        this._damageHistory = this._damageHistory.filter(r => now - r.time <= 5000);
                        this._dpsDisplay.total = this._damageHistory.reduce((sum, r) => sum + r.damage, 0);
                        this._dpsDisplay.dps = Math.round(this._dpsDisplay.total / 5);
                    }
                    return;
                }
                // 非DPS追踪模式：原有逻辑
                if (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1) {
                    const nx = this.x + this.knockbackX;
                    const ny = this.y + this.knockbackY;
                    const radius = this.collisionRadius || this.size * 0.6 || 10;
                    if (typeof WallSystem !== 'undefined' && WallSystem.walls && WallSystem.walls.length > 0) {
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, radius);
                        const hitWall = Math.abs(resolved.x - nx) > 0.5 || Math.abs(resolved.y - ny) > 0.5;
                        if (hitWall) {
                            const angle = Math.atan2(this.knockbackY, this.knockbackX);
                            this.x = resolved.x - Math.cos(angle) * 5;
                            this.baseY += (resolved.y - this.y) - Math.sin(angle) * 5;
                            if (typeof EffectManager !== 'undefined') EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                            this.knockbackX = 0;
                            this.knockbackY = 0;
                        } else {
                            this.x = resolved.x;
                            this.baseY += (resolved.y - this.y);
                        }
                    } else {
                        this.x = nx;
                        this.baseY += this.knockbackY;
                    }
                    this.knockbackX *= this.knockbackFriction;
                    this.knockbackY *= this.knockbackFriction;
                    if (Math.abs(this.knockbackX) < 0.1) this.knockbackX = 0;
                    if (Math.abs(this.knockbackY) < 0.1) this.knockbackY = 0;
                }
                if (this.hitFlash > 0) this.hitFlash -= 16;
                this.wobble += 0.05;
                this.y = this.baseY + Math.sin(this.wobble) * 3;
            }
            render(ctx) {
                const screenPos = Renderer.worldToScreen(this.x, this.y), x = screenPos.x, y = screenPos.y;
                ctx.save(); ctx.translate(x, y);
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(0, this.size + 4, this.size * 0.8, 6, 0, 0, Math.PI*2); ctx.fill();
                if (this._dpsTracking) {
                    // DPS测试靶：红色外观
                    ctx.fillStyle = this.hitFlash > 0 ? '#ffaaaa' : '#8a3a3a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = '#5a2a2a'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = '#d4a5a5'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.25, 0, Math.PI*2); ctx.fill();
                } else {
                    ctx.fillStyle = this.hitFlash > 0 ? '#ffaaaa' : '#8a7d6b'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = '#5a4d3f'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.25, 0, Math.PI*2); ctx.fill();
                }
                ctx.strokeStyle = '#5a4d3f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                if (!this._dpsTracking) {
                    this.renderHealthBar(ctx);
                }
                // 名称显示
                if (this._dpsTracking) {
                    // DPS测试靶：上方红色字体显示DPS和总伤害
                    ctx.fillStyle = '#ff4444'; 
                    ctx.font = 'bold 12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; 
                    ctx.textAlign = 'center';
                    ctx.fillText(`DPS: ${this._dpsDisplay.dps} | 总伤害: ${this._dpsDisplay.total}`, x, y - this.size - 18);
                    ctx.font = '10px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                    ctx.fillStyle = '#ff6666';
                    ctx.fillText(this.name, x, y - this.size - 30);
                } else {
                    ctx.fillStyle = '#d4c5a9'; ctx.font = '11px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${this.name} ${this.hp}/${this.maxHp}`, x, y - this.size - 18);
                }
                this.renderCollisionRadius(ctx);
            }
        }

export { TargetDummy };
