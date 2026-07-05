# 游戏缩放与相机系统审计报告

> **生成时间**: 2026-07-04  
> **审计范围**: `src/main.js`, `src/game.js`, `src/world/scene-manager.js`, `src/world/renderer.js`, `src/world/camera.js`, `src/phaser/PhaserGame.js`, `src/phaser/scenes/GameScene.js`, `src/config/config.js`, `src/entities/player.js`, `src/entities/enemy.js`, `src/entities/entity.js`, `src/ui/input.js`  
> **版本**: V0.198

---

## 一、Canvas 与 Phaser 初始化方式

### 1.1 HTML 结构 (`dist/index.html`)

```html
<div id="gameContainer" style="position: relative; width: 100vw; height: 100vh; overflow: hidden;">
    <canvas id="gameCanvas"></canvas>  <!-- 原 Canvas 层 -->
</div>
<!-- UI 层覆盖在最上方 -->
```

只有 **一个** `gameCanvas`，Phaser 会在初始化时在同个 `gameContainer` 内 **动态创建第二个 canvas**。

### 1.2 原 Canvas 初始化 (`src/world/renderer.js:6-8`)

```js
const Renderer = {
    canvas: document.getElementById('gameCanvas'),
    ctx: null,
    terrainTexture: null,

    init() {
        if (!this.canvas) this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        const w = window.innerWidth || 1920, h = window.innerHeight || 1080;
        if (w > 0 && h > 0) {
            this.canvas.width = w;
            this.canvas.height = h;
            CONFIG.VIEW_WIDTH = w;
            CONFIG.VIEW_HEIGHT = h;
        }
    },
    // ...
};
```

**关键点**: `resize()` 同时修改了：
1. Canvas **像素尺寸** (`canvas.width/height = w/h`)
2. `CONFIG.VIEW_WIDTH / VIEW_HEIGHT` 全局变量

### 1.3 Phaser 初始化 (`src/phaser/PhaserGame.js`)

```js
_phaserGame = new PhaserGameClass({
    type: AUTO,
    parent: parentEl,           // gameCanvas.parentElement = gameContainer
    width: window.innerWidth || 1920,
    height: window.innerHeight || 1080,
    transparent: true,
    backgroundColor: 'rgba(0,0,0,0)',
    scale: {
        mode: Scale.RESIZE,      // Phaser 自动 resize
        autoCenter: Scale.CENTER_BOTH,
    },
    // ...
    scene: [BootScene, GameScene],
});
```

Phaser 的 canvas CSS 设置（`PhaserGame.js:55-80`）：
```js
phaserCanvas.style.position = 'fixed';
phaserCanvas.style.top = '0';
phaserCanvas.style.left = '0';
phaserCanvas.style.width = '100%';
phaserCanvas.style.height = '100%';
phaserCanvas.style.zIndex = '2';            // 高于原 gameCanvas
phaserCanvas.style.pointerEvents = 'none';  // 鼠标事件穿透到原 Canvas
```

---

## 二、相机系统配置详情

### 2.1 自定义 Camera 对象 (`src/world/camera.js`)

```js
const Camera = {
    x: 0, y: 0,
    shakeX: 0, shakeY: 0,
    shakeIntensity: 0, shakeDecay: 0.85,
    lockY: false, yLockedValue: 0,
    aimOffsetX: 0, aimOffsetY: 0,
    aimSmooth: 0.15,

    follow(target) {
        this.x = target.x;
        if (!this.lockY) this.y = target.y;
    },

    update(target) {
        const targetX = target.x + (this.aimOffsetX || 0);
        const targetY = target.y + (this.aimOffsetY || 0);
        const isAiming = (this.aimOffsetX !== 0 || this.aimOffsetY !== 0);
        const smooth = isAiming ? CONFIG.CAMERA_SMOOTH / 6 : CONFIG.CAMERA_SMOOTH;

        this.x += (targetX - this.x) * smooth;
        if (!this.lockY) {
            this.y += (targetY - this.y) * smooth;
        } else {
            this.y = this.yLockedValue;
        }

        // 屏幕震动
        if (this.shakeIntensity > 0.5) {
            this.shakeX = (Math.random() - 0.5) * this.shakeIntensity;
            this.shakeY = (Math.random() - 0.5) * this.shakeIntensity;
            this.shakeIntensity *= this.shakeDecay;
        }

        // 边界限制
        const halfW = CONFIG.VIEW_WIDTH / 2, halfH = CONFIG.VIEW_HEIGHT / 2;
        const minX = Math.min(halfW, CONFIG.WORLD_WIDTH / 2);
        const minY = Math.min(halfH, CONFIG.WORLD_HEIGHT / 2);
        const maxX = Math.max(CONFIG.WORLD_WIDTH - halfW, CONFIG.WORLD_WIDTH / 2);
        const maxY = Math.max(CONFIG.WORLD_HEIGHT - halfH, CONFIG.WORLD_HEIGHT / 2);
        this.x = Math.max(minX, Math.min(maxX, this.x));
        this.y = Math.max(minY, Math.min(maxY, this.y));
    },

    triggerShake(intensity) { this.shakeIntensity = intensity; }
};
```

### 2.2 Phaser 相机配置 (`src/phaser/scenes/GameScene.js:43-48`)

```js
create() {
    const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
    const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;

    this.cameras.main.setBounds(
        -CONFIG.WORLD_WIDTH, -CONFIG.WORLD_HEIGHT,
        CONFIG.WORLD_WIDTH * 3, CONFIG.WORLD_HEIGHT * 3
    );
    this.cameras.main.setZoom(1);
    this.cameras.main.setViewport(0, 0, viewW, viewH);
}
```

### 2.3 相机同步 (`GameScene._updateCamera:157-171`)

```js
_updateCamera() {
    const Camera = window.Camera;
    const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
    const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;

    const boundSize = Math.max(CONFIG.WORLD_WIDTH, viewW, CONFIG.WORLD_HEIGHT, viewH) * 3;
    this.cameras.main.setBounds(-boundSize, -boundSize, boundSize * 2, boundSize * 2);

    // 直接同步原有 Camera 位置
    this.cameras.main.scrollX = Camera.x - viewW / 2;
    this.cameras.main.scrollY = Camera.y - viewH / 2;
}
```

---

## 三、坐标转换系统

### 3.1 核心转换公式 (`renderer.js:11-12`)

```js
worldToScreen(wx, wy) {
    return {
        x: wx - Camera.x + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX,
        y: wy - Camera.y + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY
    };
}

screenToWorld(sx, sy) {
    return {
        x: sx + Camera.x - CONFIG.VIEW_WIDTH / 2,
        y: sy + Camera.y - CONFIG.VIEW_HEIGHT / 2
    };
}
```

### 3.2 鼠标输入坐标 (`src/ui/input.js:7`)

```js
window.addEventListener('mousemove', e => {
    this.mouse.x = e.clientX;   // 屏幕坐标（相对于视口左上角）
    this.mouse.y = e.clientY;
});
```

鼠标使用 **原生屏幕坐标**（`clientX/clientY`），没有做任何缩放转换。

---

## 四、实体位置系统

### 4.1 世界坐标 vs 屏幕坐标

| 系统 | 坐标类型 | 说明 |
|------|---------|------|
| `Entity.x / Entity.y` | **世界坐标** | 所有实体使用世界坐标存储位置 |
| `Player.x / Player.y` | **世界坐标** | 同上 |
| `Enemy.x / Enemy.y` | **世界坐标** | 同上 |
| `Renderer.worldToScreen()` | 转换函数 | 世界 → 屏幕 |
| `Renderer.screenToWorld()` | 转换函数 | 屏幕 → 世界 |
| `Input.mouse.x/y` | 屏幕坐标 | 原生 `clientX/clientY` |

### 4.2 渲染流程 (`game.js:787-857`)

```js
render() {
    Renderer.clear();
    Renderer.ctx.setTransform(1, 0, 0, 1, 0, 0);  // 重置变换矩阵
    Renderer.renderTerrain();
    // ...
    const sorted = Array.from(this.entities.values()).filter(e => e.active).sort((a, b) => a.y - b.y);
    sorted.forEach(e => e.render(Renderer.ctx));   // 每个实体自行调用 worldToScreen
    // ...
    Renderer.drawCrosshair();  // 使用 Input.mouse.x/y（屏幕坐标）
    Renderer.renderMinimap();
}
```

### 4.3 实体渲染示例 (`enemy.js:425-483`)

```js
render(ctx) {
    const pos = Renderer.worldToScreen(this.x, this.y);  // 世界 → 屏幕
    const x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
    // ... 使用 x, y 在 ctx 上绘制
}
```

### 4.4 鼠标交互检测 (`game.js:396-404`)

```js
const pos = Renderer.worldToScreen(entity.x, entity.y);  // 实体屏幕位置
const mx = Input.mouse.x, my = Input.mouse.y;            // 鼠标屏幕位置
const hover = Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < 40;
```

---

## 五、⚠️ 发现的根本问题

### 问题 1: Phaser Camera `setViewport()` 在 resize 后未更新

**位置**: `src/phaser/scenes/GameScene.js`

`create()` 中设置了 viewport：
```js
this.cameras.main.setViewport(0, 0, viewW, viewH);
```

但在 `_updateCamera()` 中只更新了 `scrollX/scrollY` 和 `setBounds`，**没有调用 `setViewport()`**：

```js
_updateCamera() {
    const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
    const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;
    // ... 更新了 scrollX/scrollY ...
    // ❌ 缺少: this.cameras.main.setViewport(0, 0, viewW, viewH);
}
```

**影响**: Phaser 的 viewport 尺寸停留在初始窗口大小。当窗口 resize 后：
- 原 Canvas 已经通过 `Renderer.resize()` 更新了尺寸
- Phaser 的 `Scale.RESIZE` 也调整了 canvas 的 CSS 尺寸
- 但 Phaser Camera 的 **逻辑 viewport** 仍然是旧尺寸
- 导致 Phaser 渲染层（玩家/武器 sprite）和 Canvas 渲染层（地形/敌人身体）**错位**

### 问题 2: 两个 Canvas 的分辨率不同步

| Canvas | 像素尺寸控制 | CSS 尺寸控制 |
|--------|------------|------------|
| 原 `gameCanvas` | `Renderer.resize()` 直接设置 `canvas.width/height` | 无显式 CSS，跟随像素尺寸 |
| Phaser canvas | `Scale.RESIZE` 内部管理 | `style.width = '100%'; style.height = '100%'` |

Phaser 的 `Scale.RESIZE` 会根据父元素（`gameContainer`）自动调整内部 canvas 的 **显示尺寸** 和 **像素尺寸**。

但原 Canvas 的 `resize()` 只修改了像素尺寸，没有 CSS 控制。如果 CSS 和像素尺寸不匹配，会出现拉伸/压缩。

### 问题 3: `CONFIG.VIEW_WIDTH/HEIGHT` 被两边同时更新但时机可能不同

- `Renderer.resize()` 在 `window.resize` 事件时更新
- Phaser 的 `Scale.RESIZE` 在内部有自己的 resize 处理
- `GameScene._updateCamera()` 每帧读取 `CONFIG.VIEW_WIDTH/HEIGHT`
- 如果更新时机不一致，会出现一帧的错位

### 问题 4: Phaser `Scale.RESIZE` 模式与手动 viewport 管理的冲突

Phaser 的 `Scale.RESIZE` 会自动：
1. 调整 game canvas 的尺寸
2. 调整 camera 的 viewport（在某些配置下）
3. 可能触发 `resize` 事件

但代码中同时手动调用了 `setViewport()` 和每帧的 `scrollX/scrollY` 更新，两套机制可能互相干扰。

---

## 六、为什么分辨率改变会影响游戏元素位置

### 场景复现

假设初始窗口为 **1920×1080**：
- `CONFIG.VIEW_WIDTH = 1920`, `CONFIG.VIEW_HEIGHT = 1080`
- Phaser camera viewport = `(0, 0, 1920, 1080)`
- 玩家在世界坐标 `(4000, 2000)`
- `Camera.x = 4000`, `Camera.y = 2000`
- 玩家屏幕位置: `(1920/2, 1080/2) = (960, 540)` ✓

玩家将窗口 resize 到 **2560×1440**：
1. `Renderer.resize()` 被触发: `CONFIG.VIEW_WIDTH = 2560`, `CONFIG.VIEW_HEIGHT = 1440`
2. 原 Canvas 像素尺寸变为 2560×1440
3. Phaser `Scale.RESIZE` 调整 Phaser canvas 尺寸
4. `_updateCamera()` 读取 `viewW = 2560, viewH = 1440`
5. Phaser camera `scrollX = 4000 - 2560/2 = 2720`
6. Phaser camera `scrollY = 2000 - 1440/2 = 1280`

**但**: Phaser camera 的 `setViewport()` 仍然使用旧值 **1920×1080**！

这导致：
- Phaser 的 canvas 实际显示区域是 2560×1440
- 但 Phaser camera 认为 viewport 只有 1920×1080
- Phaser 渲染内容被限制在左上角的 1920×1080 区域内
- 或者出现缩放/拉伸
- 原 Canvas 使用 2560×1440 渲染
- **两个层的显示区域不一致 → 错位**

---

## 七、需要修改的文件

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `src/phaser/scenes/GameScene.js` | 在 `_updateCamera()` 中添加 `setViewport()` 更新 | 🔴 高 |
| `src/phaser/scenes/GameScene.js` | 监听 Phaser scale resize 事件，同步更新 `CONFIG` | 🔴 高 |
| `src/world/renderer.js` | 统一 Canvas 和 CSS 尺寸处理 | 🟡 中 |
| `src/config/config.js` | 添加 `DESIGN_WIDTH / DESIGN_HEIGHT` 设计分辨率常量 | 🟡 中 |
| `src/world/renderer.js` | 考虑添加缩放因子支持 | 🟢 低 |

---

## 八、推荐修复方案

### 方案 A: 修复 Viewport 同步（最小改动）

在 `GameScene._updateCamera()` 中添加 `setViewport` 更新：

```js
_updateCamera() {
    const Camera = window.Camera;
    if (!Camera) return;

    const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
    const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;

    // 更新 viewport（修复 resize 后不同步问题）
    this.cameras.main.setViewport(0, 0, viewW, viewH);

    const boundSize = Math.max(CONFIG.WORLD_WIDTH, viewW, CONFIG.WORLD_HEIGHT, viewH) * 3;
    this.cameras.main.setBounds(-boundSize, -boundSize, boundSize * 2, boundSize * 2);

    this.cameras.main.scrollX = Camera.x - viewW / 2;
    this.cameras.main.scrollY = Camera.y - viewH / 2;
}
```

### 方案 B: 使用 Phaser 的 Scale 事件统一处理 Resize

在 `GameScene.create()` 中：

```js
create() {
    // ... 现有代码 ...

    // 监听 Phaser 的 resize 事件，同步更新 CONFIG
    this.scale.on('resize', (gameSize) => {
        const w = gameSize.width;
        const h = gameSize.height;
        CONFIG.VIEW_WIDTH = w;
        CONFIG.VIEW_HEIGHT = h;

        // 同步更新原 Canvas
        if (Renderer.canvas) {
            Renderer.canvas.width = w;
            Renderer.canvas.height = h;
        }

        // 更新 Phaser camera viewport
        this.cameras.main.setViewport(0, 0, w, h);
    });
}
```

### 方案 C: 引入设计分辨率 + 等比例缩放（推荐长期方案）

**目标**: 无论窗口大小如何变化，游戏世界内的"一像素"始终对应相同的视觉大小。

1. 在 `config.js` 中定义设计分辨率：

```js
const CONFIG = {
    WORLD_WIDTH: 0, WORLD_HEIGHT: 0,
    VIEW_WIDTH: 0, VIEW_HEIGHT: 0,
    DESIGN_WIDTH: 1920,   // 新增：设计分辨率宽度
    DESIGN_HEIGHT: 1080,  // 新增：设计分辨率高度
    // ...
};
```

2. 在 `renderer.js` 中添加缩放因子：

```js
// 计算缩放因子（保持等比例）
getScaleFactor() {
    const scaleX = this.canvas.width / CONFIG.DESIGN_WIDTH;
    const scaleY = this.canvas.height / CONFIG.DESIGN_HEIGHT;
    return Math.min(scaleX, scaleY);  // 或 Math.max，取决于需求
}

worldToScreen(wx, wy) {
    const scale = this.getScaleFactor();
    const offsetX = (CONFIG.VIEW_WIDTH - CONFIG.DESIGN_WIDTH * scale) / 2;
    const offsetY = (CONFIG.VIEW_HEIGHT - CONFIG.DESIGN_HEIGHT * scale) / 2;
    return {
        x: (wx - Camera.x) * scale + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX + offsetX,
        y: (wy - Camera.y) * scale + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY + offsetY
    };
}
```

3. 在 Phaser 中使用同样的缩放因子同步 sprite 位置。

**但注意**: 这个方案改动较大，因为现有代码中所有的距离计算（攻击范围、碰撞检测）都是基于世界坐标的。如果要引入缩放因子，需要确保：
- 世界坐标系统保持不变
- 只有渲染时应用缩放
- 鼠标输入需要反向缩放转换

### 方案 D: 禁用 Phaser Scale.RESIZE，改为手动控制（最可控）

如果希望完全控制缩放行为，可以：

```js
// PhaserGame.js
scale: {
    mode: Scale.NONE,  // 禁用自动 resize
    // ...
}
```

然后统一在 `Renderer.resize()` 中处理两个 canvas：

```js
resize() {
    const w = window.innerWidth, h = window.innerHeight;
    
    // 更新原 Canvas
    this.canvas.width = w;
    this.canvas.height = h;
    CONFIG.VIEW_WIDTH = w;
    CONFIG.VIEW_HEIGHT = h;
    
    // 更新 Phaser
    const phaserScene = window.__phaserScene;
    if (phaserScene) {
        phaserScene.scale.resize(w, h);
        phaserScene.cameras.main.setViewport(0, 0, w, h);
    }
}
```

---

## 九、快速修复清单

### 🔴 立即修复（解决当前错位问题）

在 `src/phaser/scenes/GameScene.js` 的 `_updateCamera()` 方法中，添加：

```js
this.cameras.main.setViewport(0, 0, viewW, viewH);
```

### 🟡 后续优化

1. 在 `GameScene.create()` 中添加 Phaser `resize` 事件监听
2. 统一 `Renderer.resize()` 和 Phaser 的 resize 处理逻辑
3. 考虑是否需要在 `index.html` 中为 `gameCanvas` 添加 CSS `width: 100%; height: 100%` 以保持一致
4. 测试不同分辨率下的 HUD/UI 位置（它们使用 CSS `position: fixed`，应该不受影响）

---

## 十、文件引用索引

| 功能 | 文件 | 关键行号 |
|------|------|---------|
| Canvas 初始化 | `src/world/renderer.js` | 6-8 |
| Canvas resize | `src/world/renderer.js` | 8 |
| 世界↔屏幕转换 | `src/world/renderer.js` | 11-12 |
| 相机对象 | `src/world/camera.js` | 1-40 |
| 游戏主循环 | `src/game.js` | 334-857 |
| Phaser 初始化 | `src/phaser/PhaserGame.js` | 15-93 |
| Phaser 场景相机 | `src/phaser/scenes/GameScene.js` | 43-48, 157-171 |
| 全局配置 | `src/config/config.js` | 2-13 |
| 鼠标输入 | `src/ui/input.js` | 1-88 |
| 玩家位置 | `src/entities/player.js` | 20-175 |
| 敌人渲染 | `src/entities/enemy.js` | 425-483 |
| 实体基类 | `src/entities/entity.js` | 1-61 |
| 场景切换 | `src/world/scene-manager.js` | 64-158 |

---

*报告结束*
