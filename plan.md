# Plan: 3 Major Tasks

## Task 1: 任务栏从右方弹出动画
- **Goal**: 参考其他UI栏位（技能栏、背包栏等）的弹出/关闭动画，将任务栏改为从右方弹出
- **Files to explore**: 
  - `src/ui/system-ui.js` — 各栏位的打开/关闭动画
  - `src/ui/skill-manager.js` — 技能栏动画参考
  - `game-style.css` — 各栏位的CSS样式和动画
  - `index.html` — 任务栏DOM结构
- **Implementation**: 复制其他栏位的动画模式，应用到任务栏

## Task 2: 任务系统调整
- **Goal**: 
  1. 接受任务后不传送，仅接受任务
  2. 雪地场景调查时空裂隙时间为10秒
- **Files to explore**:
  - `src/ui/quest-system.js` or quest-related files
  - `src/world/scene-manager.js` — 场景切换
  - `src/world/rift-system.js` — 时空裂隙系统
  - `src/game.js` — 任务模式场景切换
- **Implementation**: 移除传送逻辑，添加10秒计时器

## Task 3: NPC对话系统改造
- **Goal**: 
  1. 选项移到底端，统一对话框格式
  2. 互相对话模式（玩家说话时隐藏NPC立绘，NPC说话时显示）
  3. 单击快速显示整段对话，再单击跳到下一句
  4. 生成指定的对话内容
- **Files to explore**:
  - `src/ui/npc-dialogue.js` — 对话系统核心
  - `game-style.css` — 对话框样式
  - `index.html` — 对话框DOM结构
- **Implementation**: 重写对话系统核心逻辑

## Stage 1: Research (parallel explore)
- 3 explore agents for each task

## Stage 2: Implementation (parallel coder)
- 3 coder agents with research findings

## Stage 3: Dialogue Content Integration
- 将对话内容集成到NPC对话系统中
