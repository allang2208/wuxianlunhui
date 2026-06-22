# 关键工作信息

**最后保存**: 当前会话
**当前版本**: V0.073
**项目目录**: `C:\Users\allan\Documents\kimi\workspace\game-dev`

---

## Electron 打包状态（已完成 ✅）

### 输出文件
- `dist-electron/无限轮回 0.7.3.exe` (228MB) — 便携版，直接双击运行

### 配置汇总
- **主进程**: `electron/main.js` — 无边框窗口、ESC 全屏切换
- **预加载脚本**: `electron/preload.js` — 安全 IPC 通信
- **Vite 配置**: `vite.config.js` — 构建输出到 dist/、相对路径
- **打包配置**: `electron-builder.json` — 便携版、跳过签名
- **构建脚本**: `scripts/copy-assets.js` — 自动复制 assets + legacy.js 到 dist/
- **应用图标**: `build/app-icon.png` — 256×256 像素

### 已知问题
- 首次构建时 electron-builder 会下载 Electron 二进制文件（约 80MB），耗时 2-3 分钟
- 后续构建会复用缓存，速度更快

### 后续打包命令
```bash
cd C:\Users\allan\Documents\kimi\workspace\game-dev
npm run build:portable
```

---

## 最近修改（V0.068 ~ V0.073）

## 最近修改（V0.068 ~ V0.073）

### V0.073 — weapon5 特殊攻击优化
- **移动限制**: 特殊攻击动画期间移动速度限制为 `0.1 px/帧`，结束后恢复
- **视觉特效替换**: 
  - 去除原有的 40 粒子系统、光柱渐变、发光效果
  - 改为调用 `assets/effects/nightandflame-effect.png`，拉伸覆盖攻击范围
  - 头尾两端 20% 使用 `destination-in` + `createLinearGradient` 渐变透明（alpha 1.0 → 0.1）
- **⚠️ 待确认**: 图片 `nightandflame-effect.png` 在项目目录中**不存在**，需用户复制到 `assets/effects/` 目录下

### V0.071 / V0.072 — 风车移动速度调整
- 风车攻击动画期间移动速度：`0.1 px/帧`（修改自原先的 10px/s）
- 通过 `Player.update` 中 `targetSpeed` 控制，攻击结束后自然恢复

### V0.070 — weapon4 粒子动画优化
- 攻击/技能期间：已生成的粒子**继续播放**，但**不生成新粒子**
- 结束后恢复自然生成

### V0.069 — 语法错误修复
- `equipFromBackpack` 中多了一行 `}` 导致 `this` 无法解析
- 修复后游戏可正常启动

### V0.068 — 右键装备旋转动画修复
- 背包右键装备 → `_syncWeaponVisual()` 触发旋转动画
- 装备栏右键卸下 → `_clearWeaponState()` 增加 `weaponAnim.nextSpin`

---

## 待解决问题

1. **weapon5 特效图片缺失**: `assets/effects/nightandflame-effect.png` 不存在，需用户复制到正确位置后测试
2. **移动速度单位统一**: 目前为 `px/帧`（默认 0.875，冲刺 1.5），攻击范围 `px`（近战 165），已统一使用像素

---

## 工作规则更新

新增规则：**未获用户明确指示的情况下，不得修改现有的公式、数值和常量定义。** 涉及攻击力、防御力、速度、概率、成本等数值改动时，必须先输出拟改方案，经用户确认后方可执行。

---

## 活跃状态

- 当前**无**进行中任务
- 所有 TODO 已清空
