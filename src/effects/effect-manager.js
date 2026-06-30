const EffectManager = {
    effects: [], critFlash: 0,
    _pools: {},
    _factories: {
        'BloodEffect': () => new BloodEffect(0, 0, 0),
        'BloodMistEffect': () => new BloodMistEffect(0, 0, 0),
        'Projectile': () => new Projectile(0, 0, 0, 0, 0, 0, {min:0,max:0}, false, null, null, null),
        'DustEffect': () => new DustEffect(0, 0, 1.0),
        'DodgeEffect': () => new DodgeEffect(0, 0, 1, 0),
        'SmokeEffect': () => new SmokeEffect(0, 0),
        'MuzzleFlashEffect': () => new MuzzleFlashEffect(0, 0, 0),
        'ShellCasingEffect': () => new ShellCasingEffect(0, 0, 0),
        'HitEffect': () => new HitEffect(0, 0),
    },
    _acquire(type) {
        if (!this._pools[type]) this._pools[type] = [];
        let obj = this._pools[type].pop();
        if (!obj) obj = this._factories[type] ? this._factories[type]() : {};
        obj.active = true;
        return obj;
    },
    _release(type, obj) {
        if (!this._pools[type]) this._pools[type] = [];
        this._pools[type].push(obj);
    },
    add(effect) { this.effects.push(effect); },
    update() {
        this.effects = this.effects.filter(e => { e.update(); return e.active; });
        if (this.critFlash > 0) { this.critFlash -= 0.08; if (this.critFlash < 0) this.critFlash = 0; }
    },
    render(ctx) {
        ctx.save();
        this.effects.forEach(e => e.render(ctx));
        if (this.critFlash > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${this.critFlash * 0.4})`; ctx.fillRect(0, 0, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT); }
        ctx.restore();
    },
    createDamageText(x, y, damage, isCrit) {
        const el = document.createElement('div'); el.className = 'combat-text'; el.textContent = isCrit ? `暴击! ${damage}` : `${damage}`;
        el.style.color = isCrit ? '#ffaa44' : '#ff6666'; el.style.fontSize = isCrit ? '22px' : '18px';
        const screenPos = Renderer.worldToScreen(x, y); el.style.left = screenPos.x + 'px'; el.style.top = screenPos.y + 'px';
        const uiLayer = document.getElementById('uiLayer'); if (uiLayer) uiLayer.appendChild(el); setTimeout(() => { if (el) el.remove(); }, 1000);
    },
    triggerCritEffects() { this.critFlash = 1.0; Camera.triggerShake(12); }
};

export { EffectManager };
