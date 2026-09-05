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
import { Input } from './input.js';
import { SystemUI } from './system-ui.js';
import { TypewriterText } from './typewriter-text.js';
import { MailboxPanel } from './mailbox-panel.js';
import { MailStore } from '../systems/mail-store.js';
import { WorldProgressionSystem } from '../world/world-progression-system.js';
import { EventBus } from '../core/event-bus.js';
import { FirstExpeditionTutorial } from '../quest/first-expedition-tutorial.js';

const NPCDialogue = {
    _active: false,
    _currentNPC: null,
    _currentText: '',
    _typewriter: null,
    _dialogueMode: 'npc', // 'player' 或 'npc'
    _dialogueQueue: [], // 对话队列
    _dialogueIndex: 0, // 当前对话索引
    _isInPostQuestDialogue: false, // 是否在进行任务后对话

    _getTutorialGreeting(npc) {
        const stage = FirstExpeditionTutorial.getStage();
        if (npc.id === 'npc_mouse_king') {
            const founding = WorldProgressionSystem.getFoundingState();
            if (founding.skipAuthorized && ['awaiting_king', 'selecting'].includes(founding.status)) {
                return founding.status === 'selecting'
                    ? '你的首城资格已经批准。位面航图会显示当前可建立基地的位置，去确认你的第一座基地吧。'
                    : '既然你决定跳过试炼，我可以直接批准你的首城资格。准备好后确认开启位面航图；后续建设指引也不会再打扰你。';
            }
            if (stage === 'receive_key') return '站稳了吗？那就开始第一课。我先送你一枚 F 级钥匙，也就是时空锚点。确认领取后，它会直接放进你的背包。';
            if (stage === 'replace_key') return '第一次探索还没完成，而你身上已经没有 F 级钥匙了。别担心，我会免费补发一枚；只要首战尚未成功，就不会让你被困在这里。';
            if (stage === 'open_altar') return 'F 级钥匙已经在你手上。去我下方的中央祭坛，点击祭坛并选择“首次 F 级探索”。';
            if (stage === 'complete_dungeon') return '祭坛已经记住了你的轮回印记。选择“废弃矿洞·初级”并活着完成探索，主神才会向你开放位面航图。';
            if (stage === 'claim_founding') return WorldProgressionSystem.getFoundingState().status === 'selecting'
                ? '你的首城资格已经批准。位面航图会显示当前可建立基地的位置，去确认你的第一座基地吧。'
                : '你从废弃矿洞活着回来了。主神已经承认你建立据点的资格，大地图也已解封。接下来，打开航图确认你的第一座基地。';
        }
        if (npc.id === 'npc_altar') {
            if (stage === 'receive_key') return '祭坛没有检测到可用的 F 级钥匙。先去找小鼠大王领取一枚。';
            if (stage === 'replace_key') return '祭坛没有检测到可用的 F 级钥匙。返回小鼠大王处免费补领，再来建立坐标。';
            if (stage === 'open_altar' || stage === 'complete_dungeon') return '祭坛与 F 级钥匙发生共鸣。选择“废弃矿洞·初级”，成功通关后才会解锁位面航图。';
        }
        return null;
    },

    // 打开对话界面
    open(npc) {
        this._active = true;
        this._currentNPC = npc;
        document.body.classList.add('npc-dialogue-active');

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
            if (!npc.portrait) {
                // 无立绘 NPC（默认祭坛/仓库等）：隐藏立绘区，不进入立绘工具逻辑
                npcPortrait.style.display = 'none';
                npcPortrait.src = '';
            } else {
                npcPortrait.src = npc.portrait;
                // 设置当前 NPC ID 到立绘工具，供 toggle 使用
                NpcPortraitTool._npcId = npc.id;
                // 加载已保存的立绘参数并应用；若无保存则使用默认参数。
                // 锚 bottom 按 NPC 默认恢复（锚不入库，y 偏移全部走 params.y）
                const defaults = NpcPortraitTool.getDefaultParams(npc.portrait);
                NpcPortraitTool._anchorBottom = (defaults && defaults.anchorBottom) ?? 220;
                if (npc.id && NpcPortraitTool._settings && NpcPortraitTool._settings[npc.id]) {
                    NpcPortraitTool.applyToDom(NpcPortraitTool._settings[npc.id]);
                } else if (defaults) {
                    NpcPortraitTool.applyToDom(defaults);
                } else {
                    // 仅保留居中，垂直方向使用固定 bottom 220px
                    npcPortrait.style.transform = 'translateX(-50%)';
                    npcPortrait.style.bottom = '220px';
                }
                // 小鼠侍从已归一到小鼠大王立绘画布；保留类名仅用于同基准样式
                if (npc.portrait.includes('mouse_attendant')) {
                    npcPortrait.classList.add('mouse-attendant');
                } else {
                    npcPortrait.classList.remove('mouse-attendant');
                }
            }
        }

        // 检查是否是任务后对话
        if (npc.npcType === 'quest' && QuestSystem.QUESTS['explore_rift_1']?.completed) {
            this._startPostQuestDialogue();
            if (dialogueOptions) dialogueOptions.style.display = 'none';
        } else {
            // 正常模式
            this._dialogueMode = 'npc';
            this._isInPostQuestDialogue = false;
            this._currentText = this._getTutorialGreeting(npc) || npc.getRandomGreeting();
            this._optionsVisible = true;
            if (this._typewriter) this._typewriter.setText(this._currentText);

            if (npcPortrait && npc.portrait) npcPortrait.style.display = 'block';
            if (dialogueOptions) {
                dialogueOptions.style.display = 'flex';
                this._updateDialogueButtons(npc);
            }
        }

        // 暂停游戏（可选）
        if (Game && Game.isRunning) {
            Game._npcDialoguePaused = true;
        }

    },

    // 根据 NPC 职能更新对话框按钮；所有 NPC 默认只保留「调整立绘」与「关闭」
    _updateDialogueButtons(npc) {
        const dialogueOptions = getElement('npcDialogueOptions');
        if (!dialogueOptions) return;
        const npcType = npc.npcType || 'shop';
        let typeButtons = '';
        let closeText = '👋 再见';
        if (npcType === 'altar') {
            const firstExpedition = ['open_altar', 'complete_dungeon'].includes(FirstExpeditionTutorial.getStage());
            typeButtons = `
                <button class="npc-option-btn${firstExpedition ? ' npc-option-btn--primary' : ''}" id="npcOptionExpedition" onclick="NPCDialogue.openExpedition()">⚔️ ${firstExpedition ? '首次 F 级探索' : '钥匙出征'}</button>
                <button class="npc-option-btn" id="npcOptionFusion" onclick="NPCDialogue.openFusion()">🔮 祭品合成</button>
            `;
            closeText = '👋 退出';
        } else if (npcType === 'ruler' && npc.id === 'npc_mouse_king') {
            const founding = WorldProgressionSystem.getFoundingState();
            const tutorialStage = FirstExpeditionTutorial.getStage();
            const keyButton = ['receive_key', 'replace_key'].includes(tutorialStage)
                ? `<button type="button" class="npc-option-btn npc-option-btn--primary" id="npcOptionStarterKey" onclick="NPCDialogue.claimStarterDungeonKey()">${tutorialStage === 'replace_key' ? '免费补领 F 级钥匙' : '领取 F 级钥匙'}</button>`
                : '';
            const foundingButton = ['awaiting_king', 'selecting'].includes(founding.status)
                ? `<button type="button" class="npc-option-btn npc-option-btn--primary" id="npcOptionFounding" onclick="NPCDialogue.acceptFirstFounding()">${founding.status === 'selecting' ? '继续首城选址' : '开启首城选址'}</button>`
                : founding.status === 'founded' && founding.sceneId
                    ? '<button type="button" class="npc-option-btn" id="npcOptionFoundingTravel" onclick="NPCDialogue.enterFirstFoundingWorld()">前往首座位面</button>'
                    : '';
            typeButtons = `${keyButton}${foundingButton}<button type="button" class="npc-option-btn" id="npcOptionMailbox" onclick="NPCDialogue.openMailbox()">查看信箱（待领 ${MailStore.pendingCount} 封）</button>`;
        } else if (npcType === 'blacksmith') {
            typeButtons = `
                <button class="npc-option-btn" id="npcOptionShop" onclick="NPCDialogue.openShop()">🏪 商店</button>
                <button class="npc-option-btn" id="npcOptionEnhance" onclick="NPCDialogue.openEnhance()">⚒️ 强化</button>
                <button class="npc-option-btn" id="npcOptionEnchant" onclick="NPCDialogue.openEnchant()">✨ 附魔</button>
                <button class="npc-option-btn" id="npcOptionCraft" onclick="NPCDialogue.openCraft()">🔧 改造</button>
            `;
        } else if (npcType === 'shop') {
            typeButtons = `
                <button class="npc-option-btn" id="npcOptionShop" onclick="NPCDialogue.openShop()">🏪 打开商店</button>
            `;
        } else if (npcType === 'quest') {
            typeButtons = `
                <button class="npc-option-btn" id="npcOptionQuest" onclick="NPCDialogue.openQuest()">📜 开始任务</button>
                <button class="npc-option-btn" id="npcOptionTeleport" onclick="NPCDialogue.teleportToQuest()">🌨️ 传送至任务地点</button>
                <button class="npc-option-btn" id="npcOptionInfo" onclick="NPCDialogue.showInfo()">ℹ️ 了解信息</button>
                <button class="npc-option-btn" id="npcOptionHelp" onclick="NPCDialogue.showHelp()">❓ 获取帮助</button>
            `;
        }
        // 无立绘 NPC（祭坛/仓库等）不显示「调整立绘」按钮
        const portraitBtn = npc.portrait
            ? '<button class="npc-option-btn" id="npcOptionPortrait" onclick="NpcPortraitTool.toggle()">🖼️ 调整立绘</button>'
            : '';
        dialogueOptions.innerHTML = typeButtons + portraitBtn + `
            <button class="npc-option-btn" id="npcOptionClose" onclick="NPCDialogue.goodbye()">${closeText}</button>
        `;
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
            { speaker: 'npc', text: '好了，废话少说，汇报工作吧。在世界-123雪原中遭遇了什么？' },
            { speaker: 'player', text: '雪原里的黑狼一直围攻我。在我调查完时空裂隙赶往撤离点的时候，还有一个奇怪的家伙远远跟着，不过他没有直接出手。' },
            { speaker: 'npc', text: '奇怪的家伙？长什么样？' },
            { speaker: 'player', text: '被一团黑雾笼罩，我也看不清。' },
            { speaker: 'npc', text: '就是这一系列事件的始作俑者，下次见到他想办法多收集一些情报' },
            { speaker: 'player', text: '意思是这种狗屎任务还有下一次？' },
            { speaker: 'npc', text: '那当然了，我们别的有调查人员失联了，你赶快去排查一下情况，任务简报发你了。' },
            { speaker: 'npc', text: '世界-123的裂隙暂时稳定了，但永久传送门尚未完成。在正式取得准入前，不要擅自返回雪原。' },
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
            npcPortrait.style.display = (entry.speaker === 'npc' && this._currentNPC && this._currentNPC.portrait) ? 'block' : 'none';
        }

        if (this._typewriter) this._typewriter.setText(this._currentText);
    },

    // 对话是否处于打开状态（供外部系统查询，避免直接访问 _active）
    isActive() {
        return this._active;
    },

    // 关闭对话界面
    openMailbox() {
        const npc = this._currentNPC;
        if (!npc || npc.id !== 'npc_mouse_king') return;
        this.close(); // Set _active=false now; the old goodbye timer cannot close the mailbox.
        MailboxPanel.open(npc);
    },

    claimStarterDungeonKey() {
        const npc = this._currentNPC;
        if (!npc || npc.id !== 'npc_mouse_king') return;
        const result = FirstExpeditionTutorial.grantStarterKey();
        if (!result.ok) {
            this._currentText = result.reason;
        } else if (result.duplicate) {
            this._currentText = '你已经持有可用的 F 级钥匙，不会重复发放。现在去中央祭坛，选择“首次 F 级探索”。';
        } else {
            this._currentText = result.replacement
                ? '新的 F 级钥匙已经直接放进背包。继续从中央祭坛挑战废弃矿洞·初级；首次成功前，钥匙遗失或探索失败都可以再来补领。'
                : '收好，F 级钥匙已经直接放进背包。去我下方的中央祭坛，选择“首次 F 级探索”，目标是废弃矿洞·初级。成功通关后，大地图才会开启。';
        }
        this._typewriter?.setText(this._currentText);
        this._updateDialogueButtons(npc);
    },

    acceptFirstFounding() {
        const npc = this._currentNPC;
        const sceneManager = typeof window !== 'undefined' ? window.SceneManager : null;
        if (!npc || npc.id !== 'npc_mouse_king' || !sceneManager || sceneManager.isLoading) return;
        const result = WorldProgressionSystem.beginFirstFoundingSelection();
        if (!result.ok) {
            this._currentText = result.reason;
            this._typewriter?.setText(this._currentText);
            this._updateDialogueButtons(npc);
            return;
        }
        const panel = typeof window !== 'undefined' ? window.WorldSwitchPanel : null;
        this.close();
        if (!panel?.openFirstFoundingSelection?.()) {
            sceneManager.showTopNotification('首城候选已经批准，但位面航图暂时无法打开；再次与小鼠大王交谈即可继续', {
                tone: 'warning',
            });
        }
    },

    async enterFirstFoundingWorld() {
        const npc = this._currentNPC;
        const sceneManager = typeof window !== 'undefined' ? window.SceneManager : null;
        const founding = WorldProgressionSystem.getFoundingState();
        if (!npc || npc.id !== 'npc_mouse_king' || founding.status !== 'founded'
            || !founding.sceneId || !sceneManager || sceneManager.isLoading) return;
        const player = Game.player;
        this.close();
        try {
            const entered = await sceneManager.switchScene(founding.sceneId, player);
            if (!entered) {
                sceneManager.showTopNotification('首城已建立，但本次传送未完成；可从主神空间传送门再次前往', { tone: 'warning' });
            }
        } catch (error) {
            console.error('[NPCDialogue] 首城授予后的位面传送失败:', error);
            Game.syncMainHubWorldPortals?.();
            sceneManager.showTopNotification('首城已完整登记，但本次传送失败；请从主神空间传送门重试', { tone: 'warning' });
        }
    },



    // 关闭对话界面
    close(keepBackpack = false) {
        this._active = false;
        this._currentNPC = null;
        document.body.classList.remove('npc-dialogue-active');
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
        QuestState.startQuest(quest.id);
    },

    // 选择钥匙出征（祭坛）
    openExpedition() {
        const player = Game.player;
        if (!player) return;
        // 消费掉本次点击：防止 game.js 的 NPC 点击检测在下一帧再次触发（把小鼠商店对话重新打开）
        if (Input && Input.mouse) Input.mouse.leftPressed = false;
        // 关闭互斥子页面；出征界面会自动检测背包/仓库钥匙。
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();
        // 不走 goodbye()：避免其300ms延迟关闭与新打开的出征工作区互相覆盖。
        if (this._currentNPC) ExpeditionSystem._anchorNPC = this._currentNPC; // 锚点供距离自动关闭
        this.close(true);
        const opened = ExpeditionSystem.open(player);
        if (opened) EventBus.emit('tutorial:first-expedition-altar-opened');
    },

    // 选择祭品合成（祭坛）
    openFusion() {
        if (Input && Input.mouse) Input.mouse.leftPressed = false; // 消费点击，防止 NPC 检测二次触发
        if (UIState.isOpen('fusion')) { FusionSystem.close(); return; }
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('craft')) CraftSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();

        if (this._currentNPC) FusionSystem._anchorNPC = this._currentNPC; // 锚点供距离自动关闭
        this._currentText = '将两个相同稀有度的祭品熔铸为更高一级的祭品。传说祭品将熔铸为全新的传说。';
        if (this._typewriter) this._typewriter.setText(this._currentText);
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';

        FusionSystem.open();
    },

    // 选择商店
    openShop() {
        if (Input && Input.mouse) Input.mouse.leftPressed = false; // 消费点击，防止 NPC 检测二次触发
        const npc = this._currentNPC;
        if (!npc || (npc.npcType !== 'shop' && npc.npcType !== 'blacksmith')) return;
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
        if (Input && Input.mouse) Input.mouse.leftPressed = false; // 消费点击，防止 NPC 检测二次触发
        const npc = this._currentNPC;
        if (!npc || npc.npcType !== 'blacksmith') return;
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
        if (Input && Input.mouse) Input.mouse.leftPressed = false; // 消费点击，防止 NPC 检测二次触发
        const npc = this._currentNPC;
        if (!npc || npc.npcType !== 'blacksmith') return;
        if (UIState.isOpen('craft')) { CraftSystem.close(); return; }
        if (UIState.isOpen('shop')) ShopSystem.close();
        if (UIState.isOpen('enhance')) EnhanceSystem.close();
        if (UIState.isOpen('enchant')) EnchantSystem.close();

        // 清除当前对话并显示改造提示（高亮段「后续的改造需要 4 张」走 typewriter 既有红字抖动样式）
        this._currentText = '改造装备需要支付改造券，初次改造只需要 1 张，后续的改造需要 4 张。请注意选择。';
        if (this._typewriter) {
            this._typewriter._highlight = '后续的改造需要 4 张';
            this._typewriter.setText(this._currentText);
        }
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = getElement('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';

        CraftSystem.open(npc);
    },

    // 选择附魔
    openEnchant() {
        if (Input && Input.mouse) Input.mouse.leftPressed = false; // 消费点击，防止 NPC 检测二次触发
        const npc = this._currentNPC;
        if (!npc || npc.npcType !== 'blacksmith') return;
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
