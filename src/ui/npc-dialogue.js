import { Game } from '../game.js';
import { NpcPortraitTool } from './npc-portrait-tool.js';
import { UIState } from './ui-state.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { ShopSystem } from './shop-system.js';
import { EnhanceSystem } from './enhance-system.js';
import { CraftSystem } from './craft-system.js';
import { EnchantSystem } from './enchant-system.js';
import { QuestSystem, QuestState } from './quest-system.js';
import { ExpeditionSystem } from './expedition-system.js';
import { FusionSystem } from './fusion-system.js';
import { SystemUI } from './system-ui.js';
import { TypewriterText } from './typewriter-text.js';

const NPCDialogue = {
    _active: false,
    _currentNPC: null,
    _currentText: '',
    _typewriter: null,
    _dialogueMode: 'npc', // 'player' 或 'npc'
    _dialogueQueue: [], // 对话队列
    _dialogueIndex: 0, // 当前对话索引
    _isInPostQuestDialogue: false, // 是否在进行任务后对话

    // 打开对话界面
    open(npc) {
        this._active = true;
        this._currentNPC = npc;

        const dialogueBox = getElement('npcDialogueBox');
        const dialogueText = getElement('npcDialogueText');
        const npcPortrait = getElement('npcPortrait');
        const dialogueOptions = getElement('npcDialogueOptions');

        if (dialogueBox) {
            dialogueBox.style.display = 'flex';
            dialogueBox.classList.add('active');
        }
        if (dialogueText) dialogueText.textContent = '';
        if (dialogueText && !this._typewriter) {
            this._typewriter = new TypewriterText(dialogueText, { highlight: '不能再进行更改' });
        }
        if (npcPortrait) {
            npcPortrait.src = npc.portrait;
            // 设置当前 NPC ID 到立绘工具，供 toggle 使用
            NpcPortraitTool._npcId = npc.id;
            // 加载已保存的立绘参数并应用；若无保存则使用默认参数
            // 统一使用固定 bottom 像素定位，不再通过 translateY 偏移
            if (npc.id && NpcPortraitTool._settings && NpcPortraitTool._settings[npc.id]) {
                NpcPortraitTool.applyToDom(NpcPortraitTool._settings[npc.id]);
            } else {
                const defaults = NpcPortraitTool.getDefaultParams(npc.portrait);
                if (defaults) {
                    NpcPortraitTool.applyToDom(defaults);
                } else {
                    // 仅保留居中，垂直方向使用固定 bottom 220px
                    npcPortrait.style.transform = 'translateX(-50%)';
                    npcPortrait.style.bottom = '220px';
                }
            }
            // 小鼠侍从立绘放大300%
            if (npc.portrait && npc.portrait.includes('mouse_attendant')) {
                npcPortrait.classList.add('mouse-attendant');
            } else {
                npcPortrait.classList.remove('mouse-attendant');
            }
        }

        // 检查是否是任务后对话
        if (npc.npcType === 'quest' && QuestState && QuestState.questCompleted) {
            this._startPostQuestDialogue();
            if (dialogueOptions) dialogueOptions.style.display = 'none';
        } else {
            // 正常模式
            this._dialogueMode = 'npc';
            this._isInPostQuestDialogue = false;
            this._currentText = npc.getRandomGreeting();
            this._optionsVisible = true;
            if (this._typewriter) this._typewriter.setText(this._currentText);

            if (npcPortrait) npcPortrait.style.display = 'block';
            if (dialogueOptions) {
                dialogueOptions.style.display = 'flex';
                this._updateDialogueButtons(npc);
            }
        }

        // 隐藏小地图、任务追踪、返回主菜单按钮
        const backMenuBtn = getElement('backMenuBtn');
        if (backMenuBtn) backMenuBtn.style.display = 'none';
        const questTracker = getElement('questTracker');
        if (questTracker) questTracker.style.display = 'none';

        // 暂停游戏（可选）
        if (Game && Game.isRunning) {
            Game._npcDialoguePaused = true;
        }

        // 绑定点击外部退出事件
        this._bindClickOutsideHandler();
    },

    // 根据NPC类型更新对话框按钮
    _updateDialogueButtons(npc) {
        const dialogueOptions = getElement('npcDialogueOptions');
        if (!dialogueOptions) return;
        const npcType = npc.npcType || 'shop';
        if (npcType === 'altar') {
            dialogueOptions.innerHTML = `
                <button class="npc-option-btn" id="npcOptionExpedition" onclick="NPCDialogue.openExpedition()">⚔️ 献祭出征</button>
                <button class="npc-option-btn" id="npcOptionFusion" onclick="NPCDialogue.openFusion()">🔮 祭品合成</button>
                <button class="npc-option-btn" id="npcOptionClose" onclick="NPCDialogue.goodbye()">👋 退出</button>
            `;
            return;
        }
        if (npcType === 'quest') {
            dialogueOptions.innerHTML = `
                <button class="npc-option-btn" id="npcOptionQuest" onclick="NPCDialogue.openQuest()">📜 开始任务</button>
                <button class="npc-option-btn" id="npcOptionTeleport" onclick="NPCDialogue.teleportToQuest()">🌨️ 传送至任务地点</button>
                <button class="npc-option-btn" id="npcOptionInfo" onclick="NPCDialogue.showInfo()">ℹ️ 了解信息</button>
                <button class="npc-option-btn" id="npcOptionHelp" onclick="NPCDialogue.showHelp()">❓ 获取帮助</button>
                <button class="npc-option-btn" id="npcOptionPortrait" onclick="NpcPortraitTool.toggle()">🖼️ 调整立绘</button>
                <button class="npc-option-btn" id="npcOptionClose" onclick="NPCDialogue.goodbye()">👋 再见</button>
            `;
        } else {
            dialogueOptions.innerHTML = `
                <button class="npc-option-btn" id="npcOptionShop" onclick="NPCDialogue.openShop()">🏪 打开商店</button>
                <button class="npc-option-btn" id="npcOptionEnhance" onclick="NPCDialogue.openEnhance()">⚒️ 强化装备</button>
                <button class="npc-option-btn" id="npcOptionCraft" onclick="NPCDialogue.openCraft()">🔧 改造装备</button>
                <button class="npc-option-btn" id="npcOptionEnchant" onclick="NPCDialogue.openEnchant()">✨ 附魔装备</button>
                <button class="npc-option-btn" id="npcOptionPortrait" onclick="NpcPortraitTool.toggle()">🖼️ 调整立绘</button>
                <button class="npc-option-btn" id="npcOptionClose" onclick="NPCDialogue.goodbye()">👋 再见</button>
            `;
        }
    },

    // 绑定点击外部退出
    _bindClickOutsideHandler() {
        const self = this;
        // 先移除旧的
        if (this._clickOutsideHandler) {
            document.removeEventListener('mousedown', this._clickOutsideHandler);
        }
        this._clickOutsideHandler = function(e) {
            // 子页面打开时不退出
            if (UIState.isOpen('shop') || UIState.isOpen('enhance') || UIState.isOpen('craft') || UIState.isOpen('enchant')) return;
            // 任务面板打开时不退出
            if (UIState.isOpen('quest')) return;
            // 背包打开时不退出
            if (SystemUI.isOpen) return;
            // 任务后对话模式下点击外部不退出
            if (self._isInPostQuestDialogue) return;
            // 立绘调整工具打开时不退出（防止点击面板内按钮关闭对话框）
            if (NpcPortraitTool._active) return;
            const dialogueBox = getElement('npcDialogueBox');
            if (!dialogueBox) return;
            // 点击对话框外部时退出
            if (!dialogueBox.contains(e.target)) {
                self.close();
            }
        };
        document.addEventListener('mousedown', this._clickOutsideHandler);
    },

    // 启动任务后对话序列
    _startPostQuestDialogue() {
        this._isInPostQuestDialogue = true;
        this._dialogueQueue = [
            { speaker: 'player', text: '这就是你们说的生态和谐，居民友善吗？' },
            { speaker: 'npc', text: '出任务遭遇意外是很正常的嘛，我们找你来就是为了应对这种特殊情况' },
            { speaker: 'player', text: '这活干不了，得加钱！' },
            { speaker: 'npc', text: '你不干有的是人干。为小鼠大王效力的机会，多少人都求之不得。再说了，刚才的任务行动中你不也缴获了很多战利品吗？我们就不需要你上贡了。' },
            { speaker: 'player', text: '可恶，我C......' },
            { speaker: 'npc', text: '好了，废话少说，汇报工作吧。在世界 181 中遭遇了什么？' },
            { speaker: 'player', text: '当地和谐友善的居民变成了袭击人的丧尸追着我咬。在我调查完时间裂隙赶往撤离路上的时候，有一个奇怪的家伙一直跟着我。不过他倒并未对我展示敌意。' },
            { speaker: 'npc', text: '奇怪的家伙？长什么样？' },
            { speaker: 'player', text: '被一团黑雾笼罩，我也看不清。' },
            { speaker: 'npc', text: '就是这一系列事件的始作俑者，下次见到他想办法多收集一些情报' },
            { speaker: 'player', text: '意思是这种狗屎任务还有下一次？' },
            { speaker: 'npc', text: '那当然了，我们别的有调查人员失联了，你赶快去排查一下情况，任务简报发你了。' },
            { speaker: 'npc', text: '对了，刚才探索过的世界 181 裂隙稳定了，如果你漏了什么可以回去看看，不过去之前要跟我申请（出外勤-自由探索）。' },
            { speaker: 'npc', text: '好了，没什么事就解散吧。' }
        ];
        this._dialogueIndex = 0;
        this._loadCurrentDialogue();
    },

    _loadCurrentDialogue() {
        const entry = this._dialogueQueue[this._dialogueIndex];
        if (!entry) {
            // 对话结束，显示选项按钮
            this._isInPostQuestDialogue = false;
            const dialogueOptions = getElement('npcDialogueOptions');
            if (dialogueOptions) dialogueOptions.style.display = 'flex';
            return;
        }
        this._dialogueMode = entry.speaker;
        const prefix = entry.speaker === 'player' ? '玩家：' : '小鼠侍从：';
        this._currentText = prefix + entry.text;

        // 控制立绘显示/隐藏
        const npcPortrait = getElement('npcPortrait');
        if (npcPortrait) {
            npcPortrait.style.display = entry.speaker === 'npc' ? 'block' : 'none';
        }

        if (this._typewriter) this._typewriter.setText(this._currentText);
    },

    // 对话是否处于打开状态（供外部系统查询，避免直接访问 _active）
    isActive() {
        return this._active;
    },

    // 关闭对话界面
    close(keepBackpack = false) {
        this._active = false;
        this._currentNPC = null;
        if (this._typewriter) {
            this._typewriter.destroy();
            this._typewriter = null;
        }
        // 关闭所有子页面
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        // 关闭任务面板
        if (UIState.isOpen('quest')) QuestSystem.close();
        // 强制关闭背包（keepBackpack：出征等需要背包的场景跳过）
        if (!keepBackpack) SystemUI.close();
        // 关闭立绘调整工具
        NpcPortraitTool.hide();

        // 移除点击外部退出事件
        if (this._clickOutsideHandler) {
            document.removeEventListener('mousedown', this._clickOutsideHandler);
            this._clickOutsideHandler = null;
        }

        const dialogueBox = getElement('npcDialogueBox');
        const npcPortrait = getElement('npcPortrait');
        if (dialogueBox) {
            dialogueBox.style.display = 'none';
            dialogueBox.classList.remove('active');
        }
        if (npcPortrait) {
            npcPortrait.style.display = 'none';
            npcPortrait.classList.remove('mouse-attendant');
            npcPortrait.src = ''; // 重置 src，防止下次打开对话框时闪现旧立绘
            npcPortrait.style.transform = ''; // 清除变换，避免影响下次对话
        }

        // 恢复小地图、任务追踪、返回主菜单按钮
        const backMenuBtn = getElement('backMenuBtn');
        if (backMenuBtn) backMenuBtn.style.display = 'block';
        const questTracker = getElement('questTracker');
        if (questTracker) questTracker.style.display = 'block';

        // 恢复游戏
        if (Game) Game._npcDialoguePaused = false;
    },

    exitCompactMode() {
        // 从子页面回到对话主界面
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
    },

    goodbye() {
        // 先关闭所有子页面和背包
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        if (SystemUI.isOpen) SystemUI.close();
        // 如果之前打开了子页面，回到对话主界面
        if (this._active) this.exitCompactMode();
        // 触发向左滑出动画，动画结束后真正关闭
        const dialogueBox = getElement('npcDialogueBox');
        if (dialogueBox) {
            dialogueBox.classList.remove('active');
            // 等待 CSS 过渡动画完成（300ms）后彻底关闭
            TimerManager.setTimeout(() => {
                if (!this._active) return;
                this.close();
            }, 300);
        } else {
            this.close();
        }
    },

    // 逐字更新
    update() {
        if (!this._active) return;
        if (this._typewriter) this._typewriter.update();
    },

    // 跳过逐字动画（点击时）
    skip() {
        if (!this._active) return;

        if (this._typewriter && !this._typewriter.isComplete()) {
            // 当前文本还没完全显示，瞬间显示全部
            this._typewriter.skip();
        } else if (this._isInPostQuestDialogue) {
            // 当前文本已完全显示，跳到下一句
            this._dialogueIndex++;
            this._loadCurrentDialogue();
        }
    },

    // ===== 任务NPC功能 =====
    openQuest() {
        if (!QuestSystem) return;
        // 小鼠侍从打开任务栏：标记来源为NPC，然后打开任务面板
        QuestSystem._fromNPC = true;
        QuestSystem.open();
    },

    showInfo() {
        this._currentText = '关于各个世界的信息正在收集中……目前可以告诉您的是，时空裂隙的出现频率越来越高，请务必小心。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
    },

    showHelp() {
        this._currentText = '帮助功能正在开发中，敬请期待。您可以先尝试接受任务前往其他世界探险。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
    },

    teleportToQuest() {
        if (!QuestSystem || !QuestState) return;
        const quest = QuestSystem.QUESTS['explore_rift_1'];
        if (!quest || !quest.accepted) {
            this._currentText = '您还没有接受任务，请先点击"📜 开始任务"按钮接受任务。';
                if (this._typewriter) this._typewriter.setText(this._currentText);
            return;
        }
        QuestState.startQuest(quest.scene, 'quest');
    },

    // 选择献祭出征（祭坛）
    openExpedition() {
        const player = Game.player;
        if (!player) return;
        // 关闭互斥子页面（不动背包——出征界面需要拖入祭品）
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        // 不走 goodbye()：它会立即关闭背包，且 300ms 延迟 close() 二次强制关背包
        this.close(true);
        ExpeditionSystem.open(player);
    },

    // 选择祭品合成（祭坛）
    openFusion() {
        if (UIState.isOpen('fusion')) { FusionSystem.close(); return; }
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();

        this._currentText = '将两个相同稀有度的祭品熔铸为更高一级的祭品。传说祭品将熔铸为全新的传说。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';

        FusionSystem.open();
    },

    // 选择商店
    openShop() {
        const npc = this._currentNPC;
        if (UIState.isOpen('shop')) { ShopSystem.close(); return; }
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        
        // 恢复随机问候语
        this._currentText = npc.getRandomGreeting();
        if (this._typewriter) this._typewriter.setText(this._currentText);
        
        ShopSystem.open(npc);
    },

    // 选择强化
    openEnhance() {
        const npc = this._currentNPC;
        if (UIState.isOpen('enhance')) { EnhanceSystem.close(); return; }
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        
        // 显示强化提示
        this._currentText = '改造可以强化武器基础伤害，同时也会强化人物属性的影响数值，改造完后不可退回。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
        
        EnhanceSystem.open(npc);
    },

    // 选择改造
    openCraft() {
        const npc = this._currentNPC;
        if (UIState.isOpen('craft')) { CraftSystem.close(); return; }
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        
        // 清除当前对话并显示改造提示
        this._currentText = '因为神秘力量，改造完装备之后，可以使装备获得一些特殊的能力，就不能再进行更改，请慎重选择。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
        
        CraftSystem.open(npc);
    },

    // 选择附魔
    openEnchant() {
        const npc = this._currentNPC;
        if (UIState.isOpen('enchant')) { EnchantSystem.close(); return; }
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        
        // 显示附魔提示
        this._currentText = '附魔可以为你的装备注入神秘力量，但需要消耗魔法粉尘。请放入装备和附魔卷轴，我会为你进行附魔。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
        
        EnchantSystem.open(npc);
    },

    get active() { return this._active; }
};

export { NPCDialogue };
