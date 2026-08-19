/**
 * 世界-122 防守地图 陷阱系统（2026-08-07 新增）
 *
 * 注意：本文件与 src/world/trap-system.js（僵尸地牢战斗房陷阱）是两个独立系统，
 * 防守陷阱一律从这里导入，不要覆盖旧文件。
 *
 * 设计（数据驱动，数值唯一真源在 trap-config.js）：
 * - F~A 六档 × 4 类：地刺（spike）/ 地雷（mine）/ 减速带（tar）/ 燃烧区（burn）
 * - 玩家用 B 建筑面板花费金币摆放；陷阱可被怪物攻击（同掩体口径 def/mdef=0），
 *   也可被玩家卖出（返 50%）
 * - 触发口径：怪物踩进触发半径（世界像素，与塔 _acquireTarget 同口径），
 *   地刺/地雷按"冷却/重装"循环触发；减速带持续挂减速状态（复用 damageable-entity
 *   状态栏系统）；燃烧区按 tick 持续造成灼烧伤害
 */
import { Game } from '../game.js';
import { Entity } from '../entities/entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { burstParticles } from '../effects/combat-fx.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { GoldManager } from '../systems/gold-manager.js';
import { TRAP_CONFIG, TRAP_GRADES, TRAP_SPACING, TRAP_SELL_RATIO, getTrapDef, getTrapCost } from './trap-config.js';
// 同步导入 Renderer（原懒加载 await import 使 tryInteract 变 async，game.js 的
// 同步 truthy 判断会把 Promise 当 true，导致每次左键点击都被陷阱分支消费、
// 攻击/NPC/拾取全部失效——2026-08-07 左键无法输入根因）。ES module 循环绑定
// 在函数运行时已就绪，点击时 Renderer 必然已初始化。
import { Renderer } from './renderer.js';

export { TRAP_CONFIG, TRAP_GRADES, TRAP_SPACING, TRAP_SELL_RATIO, getTrapDef, getTrapCost };

// ==================== 陷阱实体 ====================

class DefenseTrap extends Entity {
    constructor(x, y, config = {}) {
        const type = config.type || 'spike';
        const grade = config.grade || 'F';
        const def = getTrapDef(type, grade);
        const gc = def ? def.gradeCfg : null;
        const hp = gc ? gc.hp : 300;
        super(x, y);
        this.faction = 'player';
        this.hp = hp;
        this.maxHp = hp;
        this.size = config.size ?? 26;
        this.collisionRadius = 22;
        this.name = config.name ?? `${def ? def.displayName : '陷阱'}·${grade}级`;
        this.hittable = true;
        this.data = {
            name: this.name,
            level: 1,
            hp,
            maxHp: hp,
            str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0,
            atk: gc ? gc.damage : 0,
            def: 0,
            mdef: 0,
            kills: 0,
        };
        this.statusEffects = [];
        this.id = config.id || `defense_trap_${type}_${grade}_${Math.random().toString(36).slice(2, 8)}`;
        this._isDefenseStructure = true;
        this._isDefenseTrap = true;
        this.noSeparation = true;
        this.noNameLabel = true;
        this._noShadow = true;
        this.immovable = true; // 与塔/掩体同口径：不可移动、不可击退
        this.type = type;
        this.grade = grade;
        this.def = 0;
        this.mdef = 0;
        this.data.def = 0;
        this.data.mdef = 0;
        this.sellValue = Math.floor((gc ? gc.cost : 0) * TRAP_SELL_RATIO);
        // 触发状态
        this._cooldown = 0;
        this._burnRemainingMs = 0;
        this._burnTickTimer = 0;
        // 渲染：贴图键 = 类型_档位
        const defTex = def ? `${type}_${grade}` : `${type}_F`;
        this.spriteCfg = {
            idleKey: `trap_${defTex}`,
            size: def ? def.w : 72,
            sizeH: def ? def.h : 52,
            footOffsetY: def ? def.footOffsetY : 26,
        };
        this.footOffsetY = this.spriteCfg.footOffsetY;
        this._faceDepth = y + 12;
        this.rebuildCollider();
    }

    /** 当前档位完整配置（含类型常量） */
    trapDef() {
        return getTrapDef(this.type, this.grade);
    }

    /** 触发半径内活着的防守怪 */
    _enemiesInRadius(radius) {
        const arr = Game.entities ? Array.from(Game.entities.values()) : [];
        const out = [];
        for (const e of arr) {
            if (!e || e === this || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d <= radius + (e.groundRadius || 0)) out.push(e);
        }
        return out;
    }

    _applyDamageTo(e, dmg) {
        if (!e || !e.active || e.hp <= 0) return;
        // 陷阱伤害按配置直算，不吃玩家六维；source 自身 atk 供防御减伤公式读取
        this.data.atk = dmg;
        if (typeof e.takeDamage === 'function') e.takeDamage(dmg, this, 'physical', false);
    }

    /** 减速：改 maxSpeed（与 inspire/haste 同数据层口径，到期由状态栏系统还原） */
    _applySlow(e, mul, durationMs) {
        if (!e || !e.active || e.hp <= 0) return;
        if (e.hasStatusEffect && e.hasStatusEffect('statusImmune')) return;
        const dur = Math.max(300, durationMs);
        const existing = e.statusEffects && e.statusEffects.find(s => s.type === 'slow');
        if (existing) {
            existing.remaining = Math.max(existing.remaining, dur);
            existing.duration = Math.max(existing.duration, dur);
        } else {
            if (typeof e.maxSpeed === 'number' && e.maxSpeed > 0 && typeof e._baseSpeed === 'number') {
                e.maxSpeed = e._baseSpeed * mul;
            }
            if (e.addStatusEffect) {
                e.addStatusEffect('slow', dur, { icon: '🐌', name: '减速', color: '#5a7a9a' });
            }
        }
        EffectManager.add(new FloatingTextEffect(e.x, e.y - e.size - 10, '🐌 减速', '#7aa5d0'));
    }

    _applyStun(e, chance, ms) {
        if (!e || !e.active || e.hp <= 0) return;
        if (Math.random() >= chance) return;
        if (typeof e.applyStun === 'function') e.applyStun(ms);
    }

    /** 地刺/地雷触发 */
    _triggerBurst(gc) {
        const enemies = this._enemiesInRadius(gc.triggerRadius);
        if (enemies.length === 0) return;
        if (this.type === 'spike') {
            const e = enemies[0];
            this._applyDamageTo(e, gc.damage);
            EffectManager.add(new FloatingTextEffect(e.x, e.y - e.size - 10, `-${gc.damage}`, '#ff9a5a'));
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '地刺！', '#ffb080'));
        } else if (this.type === 'mine') {
            for (const e of enemies) {
                const d = Math.hypot(e.x - this.x, e.y - this.y);
                if (d <= gc.effectRadius + (e.groundRadius || 0)) {
                    this._applyDamageTo(e, gc.damage);
                    EffectManager.add(new FloatingTextEffect(e.x, e.y - e.size - 10, `-${gc.damage}`, '#ffd080'));
                }
            }
            if (gc.stunChance > 0) {
                for (const e of enemies) this._applyStun(e, gc.stunChance, gc.stunMs || 0);
            }
            if (burstParticles && typeof burstParticles === 'function') {
                burstParticles({
                    texture: 'impact_dot',
                    x: this.x,
                    y: this.y,
                    count: 18,
                    config: {
                        speed: { min: 80, max: 240 },
                        scale: { start: 1.2, end: 0.1 },
                        alpha: { start: 0.9, end: 0 },
                        tint: 0xffaa44,
                        blendMode: 'ADD',
                        lifespan: 700,
                    },
                    destroyAfterMs: 1200,
                    depth: this.y + 10,
                });
            } else if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '轰！', '#ffaa44'));
            }
            if (SoundManager && typeof SoundManager.playFile === 'function') {
                SoundManager.playFile('assets/sounds/enemies/miner_zombie/hitting.mp3');
            }
        }
        this._cooldown = gc.cooldownMs;
    }

    /** 持续区（减速带/燃烧区）触发 */
    _triggerZone(dt, gc) {
        const enemies = this._enemiesInRadius(gc.effectRadius);
        if (enemies.length === 0) return;
        if (this.type === 'tar') {
            for (const e of enemies) {
                this._applySlow(e, gc.slowMul, gc.slowDuration);
                if (gc.bindChance > 0) this._applyStun(e, gc.bindChance, gc.bindMs || 0);
            }
        } else if (this.type === 'burn') {
            // 持续灼烧：有敌人在范围内时刷新剩余时间；tick 按 burnTickMs 结算
            this._burnRemainingMs = Math.max(this._burnRemainingMs, gc.burnDuration || 6000);
            this._burnTickTimer += dt;
            if (this._burnTickTimer >= (gc.burnTickMs || 500)) {
                this._burnTickTimer = 0;
                for (const e of enemies) {
                    this._applyDamageTo(e, gc.damage);
                    EffectManager.add(new FloatingTextEffect(e.x, e.y - e.size - 10, `-${gc.damage}`, '#ff6b35'));
                }
            }
        }
    }

    update(dt) {
        if (this.collider) this.collider.syncPosition();
        if (!this.active || this.hp <= 0) return;
        const def = this.trapDef();
        if (!def) return;
        const gc = def.gradeCfg;
        if (!gc) return;
        if (this._cooldown > 0) this._cooldown -= dt;
        if (this.type === 'spike' || this.type === 'mine') {
            if (this._cooldown <= 0) this._triggerBurst(gc);
        } else {
            if (this._burnRemainingMs > 0) this._burnRemainingMs -= dt;
            this._triggerZone(dt, gc);
            // 燃烧区超时清空累计，避免离开后再进立刻结算
            if (this.type === 'burn' && this._burnRemainingMs <= 0) this._burnTickTimer = 0;
        }
    }

    takeDamage(damage, source, damageType, isMelee) {
        const wasAlive = this.hp > 0;
        // 陷阱 def/mdef=0，全伤结算
        let finalDmg = Math.max(1, Math.floor(Number(damage) || 0));
        if (source && source.data && typeof source.data.atk === 'number' && source.data.atk > 0) {
            finalDmg = Math.max(Math.floor(source.data.atk * 0.1), finalDmg);
        }
        this.hp = Math.max(0, this.hp - finalDmg);
        this.data.hp = this.hp;
        if (wasAlive && this.hp <= 0) {
            // 2026-08-16：沉陷死亡（推广）——实体由 BuildingSinkEffect 接管后失效
            this.hittable = false;
            this._sinking = true;
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 24, '陷阱被摧毁', '#ff8855'));
                EffectManager.add(new BuildingSinkEffect(this));
            }
        }
    }
}

export { DefenseTrap };

// ==================== 陷阱面板（点击陷阱显示信息/卖出） ====================

class DefenseTrapPanel extends BasePanel {
    constructor() {
        super({ id: 'defenseTrapPanel', className: 'defense-trap-panel', stateKey: 'defenseTrap' });
        this.trap = null;
    }

    buildContent(el) {
        el.style.cssText = [
            'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:330px;',
            'background:rgba(16,15,13,0.97);border:2px solid #6a5a3a;border-radius:10px;',
            'padding:16px 18px;color:#d4c5a9;font-family:SimHei,"Microsoft YaHei",sans-serif;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
        ].join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div id="tpTitle" style="font-size:17px;font-weight:700;color:#ffd700;"></div>
                <button id="tpClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
            </div>
            <div id="tpBuildingDetail"></div>
            <div style="font-size:13px;font-weight:700;color:#ffb86a;margin:2px 0 6px;">特殊功能 · 陷阱触发与区域控制</div>
            <div id="tpStats" style="font-size:13px;line-height:1.8;color:#c8b98a;"></div>
            <div style="margin-top:12px;display:flex;gap:8px;">
                <button id="tpSell" style="flex:1;background:#5a3028;color:#ffd7d0;border:1px solid #8a4a3a;border-radius:6px;padding:7px 0;cursor:pointer;">卖出</button>
            </div>
        `;
        el.querySelector('#tpClose').addEventListener('click', () => this.close());
        el.querySelector('#tpSell').addEventListener('click', () => this._sell());
    }

    openFor(trap) {
        this.trap = trap;
        this.open();
        this.refresh();
    }

    onClose() {
        if (this.el) this.el.style.display = 'none';
        this.trap = null;
    }

    _sell() {
        const t = this.trap;
        if (!t || !t.active) return;
        if (GoldManager && typeof GoldManager.addGold === 'function') {
            GoldManager.addGold(t.sellValue);
        }
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `卖出陷阱 +${t.sellValue} 金币`, '#ffd700'));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        t.hittable = false;
        t._sinking = true;
        if (EffectManager) EffectManager.add(new BuildingSinkEffect(t).start());
        this.close();
    }

    refresh() {
        const el = this.el;
        if (!el || !this.trap) return;
        const t = this.trap;
        const def = t.trapDef();
        const gc = def ? def.gradeCfg : null;
        const name = `${def ? def.displayName : '陷阱'}·${t.grade}级`;
        el.querySelector('#tpTitle').textContent = '建筑详情';
        const detail = el.querySelector('#tpBuildingDetail');
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: t.spriteCfg?.idleKey,
                name,
                hp: t.hp,
                maxHp: t.maxHp,
                accent: '#ffb86a',
                status: `${t.type} · ${t.grade}级`,
            });
        }
        let rows = `卖出价 <span style="color:#ffd700;">${t.sellValue} 金币</span>`;
        if (gc) {
            rows += `<br>触发半径 ${gc.triggerRadius}`;
            if (t.type === 'spike') rows += `<br>伤害 ${gc.damage} / 冷却 ${(gc.cooldownMs / 1000).toFixed(1)}s`;
            if (t.type === 'mine') rows += `<br>爆炸伤害 ${gc.damage} / 半径 ${gc.effectRadius} / 重装 ${(gc.cooldownMs / 1000).toFixed(1)}s${gc.stunChance ? ` / ${Math.round(gc.stunChance * 100)}%眩晕` : ''}`;
            if (t.type === 'tar') rows += `<br>减速 ${Math.round((1 - gc.slowMul) * 100)}% / 范围 ${gc.effectRadius}${gc.bindChance ? ` / ${Math.round(gc.bindChance * 100)}%定身` : ''}`;
            if (t.type === 'burn') rows += `<br>灼烧 ${gc.damage}/${(gc.burnTickMs / 1000).toFixed(1)}s / 范围 ${gc.effectRadius} / 持续 ${(gc.burnDuration / 1000).toFixed(0)}s`;
        }
        el.querySelector('#tpStats').innerHTML = rows;
    }
}

export { DefenseTrapPanel };

// ==================== 陷阱系统协调器 ====================

export const DefenseTrapSystem = {
    _panel: null,
    _ensurePanel() {
        if (!this._panel) this._panel = new DefenseTrapPanel();
        return this._panel;
    },

    /**
     * 点击交互：点陷阱打开信息面板（含卖出）；再点关闭
     * @returns {boolean} 是否消费本次点击
     */
    tryInteract(mx, my, player) {
        if (!Game || !Game.entities || !player) return false;
        const panel = this._ensurePanel();
        const buildMode = !!(Game && Game._buildMode);   // 建设模式无视距离（2026-08-16）
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseTrap || !e.active || e.hp <= 0) continue;
            const d = Math.hypot(e.x - player.x, e.y - player.y);
            if (!buildMode && d > 260) continue;
            const pos = Renderer.worldToScreen(e.x, e.y);
            const hw = 34, hh = 28;
            if (Math.abs(mx - pos.x) <= hw && Math.abs(my - (pos.y - 20)) <= hh) {
                if (panel.isOpen && panel.trap === e) panel.close();
                else panel.openFor(e);
                return true;
            }
        }
        return false;
    },

    /** 场景离开/重开时关闭面板 */
    teardown() {
        if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.trap = null;
        }
    },
};

// 兼容旧引用名（部分脚本按 TrapSystem 引用）
export const TrapSystem = DefenseTrapSystem;
