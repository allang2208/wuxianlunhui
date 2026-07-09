/**
 * HUD Core - 游戏内HUD核心元素
 * 包含：返回主菜单按钮、玩家状态栏、顶部状态栏、状态条、武器信息
 */
export function createHudCore() {
    const root = document.createElement('div');
    root.id = 'uiLayer';
    root.style.cssText = 'display: none; position: absolute; inset: 0; pointer-events: none;';

    // ===== 返回主菜单按钮 =====
    const backMenuBtn = document.createElement('button');
    backMenuBtn.className = 'back-menu-btn';
    backMenuBtn.id = 'backMenuBtn';
    backMenuBtn.textContent = '返回主菜单';
    root.appendChild(backMenuBtn);

    // ===== 玩家状态栏（显示眩晕、中毒等状态效果） =====
    const statusBarContainer = document.createElement('div');
    statusBarContainer.className = 'status-bar-container';
    statusBarContainer.id = 'statusBarContainer';
    root.appendChild(statusBarContainer);

    // ===== 顶部状态栏 =====
    const topBar = document.createElement('div');
    topBar.className = 'top-bar';
    topBar.id = 'topBar';

    // 名称
    const topItemName = document.createElement('div');
    topItemName.className = 'top-item';
    const labelName = document.createElement('div');
    labelName.className = 'label';
    labelName.textContent = '名称';
    const valueName = document.createElement('div');
    valueName.className = 'value';
    valueName.id = 'uiName';
    valueName.textContent = '轮回者';
    topItemName.appendChild(labelName);
    topItemName.appendChild(valueName);
    topBar.appendChild(topItemName);

    // 等级
    const topItemLevel = document.createElement('div');
    topItemLevel.className = 'top-item';
    const labelLevel = document.createElement('div');
    labelLevel.className = 'label';
    labelLevel.textContent = '等级';
    const valueLevel = document.createElement('div');
    valueLevel.className = 'value';
    valueLevel.id = 'uiLevel';
    valueLevel.textContent = '1';
    topItemLevel.appendChild(labelLevel);
    topItemLevel.appendChild(valueLevel);
    topBar.appendChild(topItemLevel);

    // 职业
    const topItemClass = document.createElement('div');
    topItemClass.className = 'top-item';
    const labelClass = document.createElement('div');
    labelClass.className = 'label';
    labelClass.textContent = '职业';
    const valueClass = document.createElement('div');
    valueClass.className = 'value';
    valueClass.id = 'uiClass';
    valueClass.textContent = '初心者';
    topItemClass.appendChild(labelClass);
    topItemClass.appendChild(valueClass);
    topBar.appendChild(topItemClass);

    // 坐标
    const topItemPos = document.createElement('div');
    topItemPos.className = 'top-item';
    const labelPos = document.createElement('div');
    labelPos.className = 'label';
    labelPos.textContent = '坐标';
    const valuePos = document.createElement('div');
    valuePos.className = 'value';
    valuePos.id = 'uiPos';
    valuePos.textContent = '0, 0';
    topItemPos.appendChild(labelPos);
    topItemPos.appendChild(valuePos);
    topBar.appendChild(topItemPos);

    // 击杀
    const topItemKills = document.createElement('div');
    topItemKills.className = 'top-item';
    const labelKills = document.createElement('div');
    labelKills.className = 'label';
    labelKills.textContent = '击杀';
    const valueKills = document.createElement('div');
    valueKills.className = 'value';
    valueKills.id = 'uiKills';
    valueKills.textContent = '0';
    topItemKills.appendChild(labelKills);
    topItemKills.appendChild(valueKills);
    topBar.appendChild(topItemKills);

    // HP 条
    const topItemHp = document.createElement('div');
    topItemHp.className = 'top-item bar';
    const topBarTrackHp = document.createElement('div');
    topBarTrackHp.className = 'top-bar-track';
    const topBarFillHp = document.createElement('div');
    topBarFillHp.className = 'top-bar-fill hp';
    topBarFillHp.id = 'topBarHp';
    topBarFillHp.style.width = '100%';
    topBarTrackHp.appendChild(topBarFillHp);
    const topBarValueHp = document.createElement('div');
    topBarValueHp.className = 'top-bar-value';
    topBarValueHp.id = 'topValHp';
    topBarValueHp.textContent = '100/100';
    topItemHp.appendChild(topBarTrackHp);
    topItemHp.appendChild(topBarValueHp);
    topBar.appendChild(topItemHp);

    // MP 条
    const topItemMp = document.createElement('div');
    topItemMp.className = 'top-item bar';
    const topBarTrackMp = document.createElement('div');
    topBarTrackMp.className = 'top-bar-track';
    const topBarFillMp = document.createElement('div');
    topBarFillMp.className = 'top-bar-fill mp';
    topBarFillMp.id = 'topBarMp';
    topBarFillMp.style.width = '100%';
    topBarTrackMp.appendChild(topBarFillMp);
    const topBarValueMp = document.createElement('div');
    topBarValueMp.className = 'top-bar-value';
    topBarValueMp.id = 'topValMp';
    topBarValueMp.textContent = '100/100';
    topItemMp.appendChild(topBarTrackMp);
    topItemMp.appendChild(topBarValueMp);
    topBar.appendChild(topItemMp);

    root.appendChild(topBar);

    // ===== 状态条 =====
    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';

    // HP 条
    const barHp = document.createElement('div');
    barHp.className = 'bar-hp';
    const barFillHp = document.createElement('div');
    barFillHp.className = 'bar-fill-hp';
    barFillHp.id = 'hpBar';
    const hpText = document.createElement('span');
    hpText.className = 'bar-text';
    hpText.id = 'hpText';
    hpText.textContent = '100/100';
    barHp.appendChild(barFillHp);
    barHp.appendChild(hpText);
    statusBar.appendChild(barHp);

    // 体力条
    const barStamina = document.createElement('div');
    barStamina.className = 'bar-stamina';
    const barFillStamina = document.createElement('div');
    barFillStamina.className = 'bar-fill-stamina';
    barFillStamina.id = 'staminaBar';
    const staminaText = document.createElement('span');
    staminaText.className = 'bar-text';
    staminaText.id = 'staminaText';
    staminaText.textContent = '200/200';
    barStamina.appendChild(barFillStamina);
    barStamina.appendChild(staminaText);
    statusBar.appendChild(barStamina);

    root.appendChild(statusBar);

    // ===== 武器信息 =====
    const weaponInfo = document.createElement('div');
    weaponInfo.className = 'weapon-info';
    weaponInfo.id = 'weaponInfo';
    weaponInfo.style.cssText = 'position: absolute; left: 20px; top: 563px; width: 128px; height: 103px; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; padding: 8px; box-sizing: border-box;';
    const weaponMode = document.createElement('div');
    weaponMode.className = 'wi-mode';
    weaponMode.id = 'weaponMode';
    weaponMode.style.cssText = 'font-size: 12px; color: #8a8a8a; font-weight: 600;';
    weaponMode.textContent = '武器栏1';
    const weaponName = document.createElement('div');
    weaponName.className = 'wi-name';
    weaponName.id = 'weaponName';
    weaponName.style.cssText = 'font-size: 16px; color: #ffd700; font-weight: 700; text-shadow: 0 0 4px rgba(255, 215, 0, 0.3);';
    weaponName.textContent = '生锈的长剑';
    weaponInfo.appendChild(weaponMode);
    weaponInfo.appendChild(weaponName);
    root.appendChild(weaponInfo);

    return root;
}
