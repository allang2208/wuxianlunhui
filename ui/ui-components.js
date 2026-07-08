// ui-components.js
// 将 HTML 组件内联为字符串，支持 file:// 协议加载
// 生成时间: 2026-07-08

const UIComponents = {
  // 使用 XMLHttpRequest 同步加载 HTML 文件（支持 file:// 协议）
  loadSync(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // 同步请求
    xhr.send();
    if (xhr.status === 200 || xhr.status === 0) { // status 0 表示 file:// 协议成功
      return xhr.responseText;
    }
    throw new Error(`Failed to load ${url}: ${xhr.status}`);
  },

  // 加载并解析 HTML 片段
  loadFragment(url) {
    const html = this.loadSync(url);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    return wrapper;
  },

  // 初始化所有组件
  init() {
    const container = document.getElementById('gameContainer');
    if (!container) {
      console.error('gameContainer not found');
      return;
    }

    // 组件加载列表
    const components = [
      { url: 'ui/components/menu.html', target: 'menuLayer' },
      { url: 'ui/components/game-layer.html', target: 'gameLayer' },
      { url: 'ui/components/hud-layer.html', target: 'hudLayer' },
      { url: 'ui/components/dev-tool-panel.html', target: 'devToolPanel' },
      { url: 'ui/components/coord-tool.html', target: 'coordTool' },
      { url: 'ui/components/npc-portrait-tool.html', target: 'npcPortraitTool' },
      { url: 'ui/components/equip-tooltip.html', target: 'equipTooltip' }
    ];

    for (const comp of components) {
      try {
        const fragment = this.loadFragment(comp.url);
        const target = document.getElementById(comp.target);
        if (target) {
          // 清空并替换内容
          target.innerHTML = '';
          while (fragment.firstChild) {
            target.appendChild(fragment.firstChild);
          }
          console.log(`[UIComponents] Loaded: ${comp.url} -> #${comp.target}`);
        } else {
          console.warn(`[UIComponents] Target not found: #${comp.target}`);
        }
      } catch (err) {
        console.error(`[UIComponents] Failed to load ${comp.url}:`, err);
      }
    }
  }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIComponents;
}
