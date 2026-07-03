// AI 开发工具 - 整合进 DevTool
// 在 DevTool 面板中添加"AI"选项卡，显示：
// 1. 当前场景中的怪物列表（类型、HP、阶段）
// 2. 激活的协同效应（红色光环）
// 3. 当前战术（BattleCommander）
// 4. 可调整的参数（阶段阈值、协同范围等）

import { Enemy } from '../entities/enemy.js';

export const AIDevTool = {
    _active: false,
    _panel: null,
    _monsterList: null,
    _synergyList: null,
    _tacticName: null,
    _enemyCount: null,
    _refreshInterval: null,

    init() {
        this._panel = document.getElementById('aiDevToolPanel');
        this._monsterList = document.getElementById('aiDevToolMonsterList');
        this._synergyList = document.getElementById('aiDevToolSynergyList');
        this._tacticName = document.getElementById('aiCurrentTactic');
        this._enemyCount = document.getElementById('aiEnemyCount');
    },

    show() {
        this._active = true;
        if (this._panel) this._panel.style.display = 'block';
        // 启动定时刷新（500ms 间隔），确保数据实时更新
        this._startRefresh();
    },

    hide() {
        this._active = false;
        if (this._panel) this._panel.style.display = 'none';
        this._stopRefresh();
    },

    _startRefresh() {
        if (this._refreshInterval) return;
        this._refreshInterval = setInterval(() => this.update(), 500);
        this.update(); // 立即刷新一次
    },

    _stopRefresh() {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = null;
        }
    },

    update() {
        if (!this._active) return;
        this._renderMonsterList();
        this._renderSynergyList();
        this._renderTacticInfo();
    },

    // 渲染怪物列表：显示当前场景中所有活跃怪物的状态
    _renderMonsterList() {
        if (!this._monsterList) return;

        let html = '';
        let count = 0;
        if (typeof window !== 'undefined' && window.Game && window.Game.entities) {
            window.Game.entities.forEach(e => {
                if (e instanceof Enemy && e.active) {
                    count++;
                    const phase = e._fsm ? e._fsm.phases[e._fsm.currentPhase] : null;
                    const phaseName = phase ? phase.name : '无阶段';
                    const hpPercent = ((e.hp / e.maxHp) * 100).toFixed(0);
                    // 根据HP显示不同颜色
                    let hpColor = '#7a9a6a';
                    if (hpPercent < 30) hpColor = '#ff4444';
                    else if (hpPercent < 60) hpColor = '#ffaa44';
                    html += `<div class="ai-monster-item">
                        <span style="flex:1.5;font-weight:600;">${e.name}</span>
                        <span style="color:${hpColor};width:60px;">HP: ${hpPercent}%</span>
                        <span style="width:80px;">阶段: ${phaseName}</span>
                        <span style="width:70px;">速度: ${e.maxSpeed.toFixed(1)}</span>
                    </div>`;
                }
            });
        }
        this._monsterList.innerHTML = html || '<div class="ai-monster-item" style="justify-content:center;color:#8a7d6b;">暂无活跃怪物</div>';
        if (this._enemyCount) this._enemyCount.textContent = count;
    },

    // 渲染激活的协同效应列表
    _renderSynergyList() {
        if (!this._synergyList) return;

        let html = '';
        if (typeof window !== 'undefined' && window.Game && window.Game._synergySystem && window.Game._synergySystem.activeSynergies) {
            for (const [id, synergy] of window.Game._synergySystem.activeSynergies) {
                html += `<div class="ai-synergy-item">
                    <strong>${synergy.rule.name}</strong>（${synergy.affected.length}个怪物）
                </div>`;
            }
        }
        this._synergyList.innerHTML = html || '<div class="ai-synergy-item" style="background:rgba(0,0,0,0.1);color:#8a7d6b;">无激活的协同</div>';
    },

    // 渲染当前战术信息
    _renderTacticInfo() {
        if (!this._tacticName) return;
        if (typeof window !== 'undefined' && window.Game && window.Game._battleCommander) {
            this._tacticName.textContent = window.Game._battleCommander.getCurrentTacticName();
        } else {
            this._tacticName.textContent = '未启动';
        }
    }
};
