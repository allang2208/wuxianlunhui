/**
 * NPC 面板模块
 * 包含：NPC 立绘、NPC 对话框（含交互选项按钮）
 */
export function createHudPanelsNpc() {
    const root = document.createElement('div');

    // ===== NPC 立绘 =====
    const npcPortrait = document.createElement('img');
    npcPortrait.id = 'npcPortrait';
    npcPortrait.className = 'npc-portrait';
    npcPortrait.src = '';
    npcPortrait.alt = 'NPC';
    npcPortrait.style.display = 'none';
    root.appendChild(npcPortrait);

    // ===== NPC 对话框 =====
    const npcDialogueBox = document.createElement('div');
    npcDialogueBox.id = 'npcDialogueBox';
    npcDialogueBox.className = 'npc-dialogue-box';
    npcDialogueBox.style.display = 'none';

    const npcDialogueContent = document.createElement('div');
    npcDialogueContent.className = 'npc-dialogue-content';

    const npcDialogueText = document.createElement('div');
    npcDialogueText.id = 'npcDialogueText';
    npcDialogueText.className = 'npc-dialogue-text';

    const npcDialogueOptions = document.createElement('div');
    npcDialogueOptions.id = 'npcDialogueOptions';
    npcDialogueOptions.className = 'npc-dialogue-options';
    npcDialogueOptions.style.display = 'none';

    const npcOptions = [
        { id: 'npcOptionShop', text: '🏪 打开商店', action: 'NPCDialogue.openShop()' },
        { id: 'npcOptionEnhance', text: '⚒️ 强化装备', action: 'NPCDialogue.openEnhance()' },
        { id: 'npcOptionCraft', text: '🔧 改造装备', action: 'NPCDialogue.openCraft()' },
        { id: 'npcOptionEnchant', text: '✨ 附魔装备', action: 'NPCDialogue.openEnchant()' },
        { id: 'npcOptionClose', text: '👋 再见', action: 'NPCDialogue.goodbye()' }
    ];

    npcOptions.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'npc-option-btn';
        btn.id = opt.id;
        const action = opt.action;
        btn.onclick = function () {
            if (action === 'NPCDialogue.openShop()') NPCDialogue.openShop();
            else if (action === 'NPCDialogue.openEnhance()') NPCDialogue.openEnhance();
            else if (action === 'NPCDialogue.openCraft()') NPCDialogue.openCraft();
            else if (action === 'NPCDialogue.openEnchant()') NPCDialogue.openEnchant();
            else if (action === 'NPCDialogue.goodbye()') NPCDialogue.goodbye();
        };
        btn.textContent = opt.text;
        npcDialogueOptions.appendChild(btn);
    });

    npcDialogueContent.appendChild(npcDialogueText);
    npcDialogueContent.appendChild(npcDialogueOptions);
    npcDialogueBox.appendChild(npcDialogueContent);
    root.appendChild(npcDialogueBox);

    return root;
}
