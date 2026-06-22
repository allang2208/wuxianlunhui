export const UI_DATA_CONFIG = {
    topBar: [
        { id: 'uiName', label: '轮回者', getValue: (p) => p.data.name || '未命名' },
        { id: 'uiLevel', label: '等级', getValue: (p) => p.data.level },
        { id: 'uiClass', label: '职业', getValue: (p) => p.data.class },
        { id: 'uiPos', label: '坐标', getValue: (p) => `${Math.round(p.x)}, ${Math.round(p.y)}` },
        { id: 'uiKills', label: '击杀', getValue: (p) => p.data.kills }
    ],
    topStatus: [
        { barId: 'topBarHp', valId: 'topValHp', label: 'HP', getValue: (d) => `${Math.ceil(d.hp)}/${d.maxHp}`, getPercent: (d) => (d.hp / d.maxHp * 100) + '%', color: 'hp' },
        { barId: 'topBarMp', valId: 'topValMp', label: 'MP', getValue: (d) => `${Math.ceil(d.mp)}/${d.maxMp}`, getPercent: (d) => (d.mp / d.maxMp * 100) + '%', color: 'mp' }
    ],
    statusPage: {
        bars: [
            { barId: 'barHp', valId: 'valHp', label: '生命值', type: 'hp', getValue: (d) => `${Math.ceil(d.hp)}/${d.maxHp}`, getPercent: (d) => (d.hp / d.maxHp * 100) + '%' },
            { barId: 'barMp', valId: 'valMp', label: '魔法值', type: 'mp', getValue: (d) => `${Math.ceil(d.mp)}/${d.maxMp}`, getPercent: (d) => (d.mp / d.maxMp * 100) + '%' },
            { barId: 'barStamina', valId: 'valStamina', label: '体力值', type: 'stamina', getValue: (d) => `${Math.ceil(d.stamina)}/${d.maxStamina}`, getPercent: (d) => (d.stamina / d.maxStamina * 100) + '%' },
            { barId: 'barExp', valId: 'valExp', label: '经验值', type: 'exp', getValue: (d) => Math.floor(d.exp / d.maxExp * 100) + '%', getPercent: (d) => (d.exp / d.maxExp * 100) + '%' }
        ],
        baseAttrs: [
            { id: 'attrStr', key: 'str', name: '力量' },
            { id: 'attrDex', key: 'dex', name: '敏捷' },
            { id: 'attrInt', key: 'int', name: '智力' },
            { id: 'attrCon', key: 'con', name: '体质' },
            { id: 'attrWis', key: 'wis', name: '精神' },
            { id: 'attrLuck', key: 'luck', name: '幸运' }
        ],
        combatAttrs: [
            { id: 'combatAtk', name: '物理攻击' },
            { id: 'combatDef', key: 'def', name: '物理防御' },
            { id: 'combatMatk', key: 'matk', name: '魔法攻击' },
            { id: 'combatMdef', key: 'mdef', name: '魔法防御' },
            { id: 'combatCrit', name: '暴击率', suffix: '%' },
            { id: 'combatAspd', key: 'aspd', name: '攻击间隔', fixed: 1 },
            { id: 'combatSpd', name: '移动速度', suffix: 'px/s' }
        ],
        detailAttrs: [
            { id: 'detailStaminaRegen', name: '体力恢复', unit: '/秒' },
            { id: 'detailCollisionRadius', name: '碰撞体积', unit: 'px' },
            { id: 'detailMoveSpeed', name: '移动速度', unit: 'px/帧' },
            { id: 'detailDodgeCooldown', name: '闪避冷却', unit: 'ms' },
            { id: 'detailAttackRange', name: '攻击距离', unit: 'px' },
            { id: 'detailKnockback', name: '击退距离', unit: 'px' },
            { id: 'detailViewRange', name: '视野宽度', unit: 'px' }
        ],
        loopInfo: [
            { id: 'infoLoop', key: 'loopCount', name: '轮回次数' },
            { id: 'infoDays', key: 'surviveDays', name: '存活天数' },
            { id: 'infoKills', key: 'kills', name: '击杀数' },
            { id: 'infoQuests', key: 'quests', name: '完成任务' },
            { id: 'infoGene', key: 'geneLock', name: '基因锁' },
            { id: 'infoRank', key: 'rank', name: '主神评价' }
        ]
    }
};

export const SystemUI = {
    isOpen: false, currentTab: null,
    init() {
        // 绑定遮罩层点击事件：点击面板外部区域关闭
        const overlay = document.getElementById('panelOverlay');
        if (overlay) overlay.addEventListener('click', () => this.close());
        // 绑定属性加号按钮点击事件
        document.querySelectorAll('.attr-plus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const attr = btn.dataset.attr;
                if (Game.player && Game.player.addAttribute(attr)) {
                    // 刷新状态面板
                    Game.updateUI();
                    // 显示增加成功浮动提示
                    const attrNames = { str: '力量', dex: '敏捷', int: '智力', con: '体质', wis: '精神', luck: '幸运' };
                    EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 30, `${attrNames[attr]} +1`, '#ffd700'));
                }
            });
        });
    },
    toggle(tab) { if (tab === 'inventory') tab = 'equip'; if (this.isOpen && this.currentTab === tab) { this.close(); return; } this.open(tab); },
    open(tab) {
        // SoundManager.play('panel_open');
        // 'inventory' 已整合到 'equip' 页面
        if (tab === 'inventory') tab = 'equip';
        this.isOpen = true; this.currentTab = tab;
        // 打开面板时隐藏右侧侧边栏图标
        document.querySelectorAll('.side-menu').forEach(m => m.classList.add('hidden'));
        const panel = document.getElementById('systemPanel'), overlay = document.getElementById('panelOverlay');
        if (!panel || !overlay) return;
        const pt = document.getElementById('panelTitle');
        const titles = { status: '📊 角色状态', equip: '⚔ 装备与背包', skill: '✦ 技能系统', codex: '📖 武器图鉴' };
        if (pt) pt.textContent = titles[tab] || '角色系统';
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
        const tabPage = document.querySelector(`.tab-page[data-page="${tab}"]`);
        if (tabPage) tabPage.classList.add('active');
        panel.classList.add('active'); overlay.classList.add('active'); this.updateQuickSlots();
        // 技能页打开时渲染技能列表
        if (tab === 'skill') { SkillManager.renderSkillGrid(); }
    },
    close() {
        // SoundManager.play('panel_close');
        this.isOpen = false; this.currentTab = null;
        try {
            const panel = document.getElementById('systemPanel'), overlay = document.getElementById('panelOverlay');
            if (panel) panel.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
            // 关闭面板时显示右侧侧边栏图标
            document.querySelectorAll('.side-menu').forEach(m => m.classList.remove('hidden'));
            this.updateQuickSlots();
        } catch (e) { console.error('SystemUI.close error:', e); }
    },
    switchTab(tab) { this.open(tab); },
    updateQuickSlots() {
        const btnStatus = document.getElementById('btnStatus');
        const btnEquip = document.getElementById('btnEquip');
        const btnSkill = document.getElementById('btnSkill');
        const btnCodex = document.getElementById('btnCodex');
        if (btnStatus) btnStatus.classList.toggle('active', this.currentTab === 'status');
        if (btnEquip) btnEquip.classList.toggle('active', this.currentTab === 'equip');
        if (btnSkill) btnSkill.classList.toggle('active', this.currentTab === 'skill');
        if (btnCodex) btnCodex.classList.toggle('active', this.currentTab === 'codex');
    }
};
