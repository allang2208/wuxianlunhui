# NPC 立绘调整工具设计文档

## 一、背景

基于 `dev-tool.js`（Canvas 拖动调整）和 `craft-system.js`（SVG 虚线格子）的交互模式，为 NPC 对话界面的立绘图片创建一个可视化调整工具。

## 二、目标

在 NPC 对话界面添加一个"调整立绘"按钮，点击后打开一个 Canvas 工具面板，支持：
1. 拖动立绘改变位置（offsetX, offsetY）
2. 缩放立绘（scale）
3. 旋转立绘（rotation，角度）
4. 镜像翻转（flipX）
5. 保存按钮输出 JSON 参数到控制台

## 三、文件结构

```
index.html                          → 添加 #npcPortraitTool 容器
src/ui/npc-portrait-tool.js         → 新建：核心工具逻辑
src/ui/npc-dialogue.js             → 修改：添加按钮+应用参数
main.js                            → 修改：导入 NpcPortraitTool
game-style.css                     → 修改：添加工具样式
```

## 四、API 约定

### NpcPortraitTool 对象（导出）

```javascript
export const NpcPortraitTool = {
    // 状态
    _active: false,
    _params: { offsetX: 0, offsetY: 0, scale: 1.0, rotation: 0, flipX: false },
    _drag: { active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 },
    _canvas: null, _ctx: null, _image: null,

    // 方法
    init(),           // 初始化：获取DOM元素、绑定事件
    show(npcId, portraitSrc),  // 打开工具，传入NPC ID和立绘路径
    hide(),           // 关闭工具
    toggle(),         // 切换显示/隐藏
    applyParams(),    // 将当前参数应用到 DOM 立绘（实时预览）
    save(),           // 控制台输出 JSON 参数，同时保存到 npcPortraitSettings
    reset(),          // 重置为默认值

    // 内部
    _draw(),          // 绘制 Canvas（背景网格+立绘）
    _onMouseDown(e), _onMouseMove(e), _onMouseUp(e),  // 拖动
    _onWheel(e),      // 滚轮缩放
    _syncInputs(),    // 同步滑动条/输入框到状态
};
```

### 全局状态存储

```javascript
// 在 NpcPortraitTool 中定义，按 npcId 存储参数
const npcPortraitSettings = {};  // { [npcId]: { offsetX, offsetY, scale, rotation, flipX } }
```

### NPC 立绘 CSS 应用

```javascript
// 应用参数到 npcPortrait DOM 元素
const style = `translateX(${params.offsetX}px) translateY(${params.offsetY}px) scale(${params.scale}) rotate(${params.rotation}deg) ${params.flipX ? 'scaleX(-1)' : ''}`;
npcPortrait.style.transform = style;
```

## 五、UI 设计

### Canvas 面板（参考 dev-tool）

- 宽度：400px，高度：400px
- 背景：浅灰色（#f5f5f5）
- 网格：20px 间距的灰色虚线（rgba(80,80,80,0.15)）
- 中心十字线：红色/绿色
- 立绘：居中显示，可拖动

### 控制面板（在 Canvas 右侧或下方）

- 缩放滑动条：0.1 ~ 5.0
- 旋转滑动条：-180 ~ 180 度
- 翻转按钮：🔄 镜像
- 重置按钮：↺ 重置
- 保存按钮：💾 保存并输出
- 关闭按钮：✕ 关闭

### HTML 结构（#npcPortraitTool）

```html
<div id="npcPortraitTool" class="npc-portrait-tool">
    <div class="npc-portrait-tool-header">
        <span>调整立绘</span>
        <button id="npcPortraitToolClose">✕</button>
    </div>
    <div class="npc-portrait-tool-body">
        <canvas id="npcPortraitCanvas" width="400" height="400"></canvas>
        <div class="npc-portrait-tool-controls">
            <div class="npc-portrait-control-row">
                <label>缩放</label>
                <input type="range" id="npcPortraitScale" min="0.1" max="5.0" step="0.01" value="1.0">
                <span id="npcPortraitScaleVal">1.0</span>
            </div>
            <div class="npc-portrait-control-row">
                <label>旋转</label>
                <input type="range" id="npcPortraitRotation" min="-180" max="180" step="1" value="0">
                <span id="npcPortraitRotationVal">0°</span>
            </div>
            <div class="npc-portrait-control-row">
                <button id="npcPortraitFlipX">🔄 镜像</button>
                <button id="npcPortraitReset">↺ 重置</button>
                <button id="npcPortraitSave">💾 保存</button>
            </div>
        </div>
    </div>
</div>
```

## 六、拖动逻辑

参考 dev-tool.js 的 `_onMouseDown` / `_onMouseMove` / `_onMouseUp`：

1. `mousedown` 在 Canvas 上：计算鼠标相对 Canvas 的位置，检测是否在立绘区域内
2. `mousemove`：如果正在拖动，更新 `_params.offsetX` / `_params.offsetY`
3. `mouseup`：停止拖动
4. 实时调用 `_draw()` 和 `applyParams()`

## 七、事件绑定

- `npcPortraitCanvas`: `mousedown`, `mousemove`, `mouseup`, `wheel`
- `npcPortraitScale`: `input` → 更新 scale
- `npcPortraitRotation`: `input` → 更新 rotation
- `npcPortraitFlipX`: `click` → 切换 flipX
- `npcPortraitReset`: `click` → 重置参数
- `npcPortraitSave`: `click` → 保存并输出
- `npcPortraitToolClose`: `click` → 关闭
- `Escape` 键：关闭工具

## 八、CSS 样式（参考 dev-tool）

```css
.npc-portrait-tool { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; background: #fff; border: 2px solid #7a6a5a; border-radius: 12px; z-index: 10000; display: none; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
.npc-portrait-tool.active { display: block; }
.npc-portrait-tool-header { ... }
.npc-portrait-tool-body { display: flex; gap: 10px; padding: 10px; }
.npc-portrait-canvas { border: 1px solid #ddd; border-radius: 8px; cursor: grab; }
.npc-portrait-canvas:active { cursor: grabbing; }
.npc-portrait-tool-controls { display: flex; flex-direction: column; gap: 8px; width: 180px; }
.npc-portrait-control-row { display: flex; align-items: center; gap: 6px; }
```

## 九、与 NPC 对话的集成

在 `npc-dialogue.js` 的 `_updateDialogueButtons` 中，为每个 NPC 类型添加"调整立绘"按钮：

```javascript
<button class="npc-option-btn" id="npcOptionPortrait" onclick="NpcPortraitTool.toggle()">🖼️ 调整立绘</button>
```

在 `open(npc)` 中，加载保存的参数并应用到立绘：
```javascript
const saved = npcPortraitSettings[npc.id];
if (saved) NpcPortraitTool.applyToDom(saved);
```

在 `close()` 中，确保关闭工具：
```javascript
NpcPortraitTool.hide();
```

## 十、关键代码注释要求

每个方法和关键代码块必须添加中文注释，说明：
- 功能目的
- 参数含义
- 返回值
- 调用时机

## 十一、实现顺序

1. 创建 `npc-portrait-tool.js`
2. 修改 `index.html`（添加容器）
3. 修改 `game-style.css`（添加样式）
4. 修改 `npc-dialogue.js`（添加按钮+集成）
5. 修改 `main.js`（导入）
6. 验证

## 十二、以后添加新 NPC 时的流程

新 NPC 不需要任何特殊处理。只要在 `npc-dialogue.js` 中打开对话时，工具会自动读取 `npcPortraitSettings` 中保存的参数并应用。如果该 NPC 没有保存过参数，则使用默认值。

调整完成后，用户点击"保存"按钮，参数会自动存入 `npcPortraitSettings` 并在下次对话时生效。
