# 近代四兵种全状态 GIF 验收

生成日期：2026-09-02
验收范围：4个兵种、17个状态。待机/跑动为循环动作；攻击/冲锋/死亡为一次性动作。棋盘格仅用于检查透明背景，不属于运行资源。

本版为用户反馈后的返工版：制式步枪兵、BAR自动步枪兵与近代骑枪兵重新抠图；四个跑动动作改用完整连续源帧并统一为一次2×RIFE后的48fps循环。传统长矛重骑兵跑动改切为原片自然连续周期`[50,63)`：26帧、48fps，最长近静止连续跳转由8降为0，循环接缝比由1.717降为1.264。旧冲锋原片因完全缺失抬枪恢复而废弃，现用MiniMax H3 v02重抽为55帧、22.916667fps、2.4秒的一次性完整动作：抬枪待机→压枪加速→完全伸展命中→后坐减速→抬枪站稳；第31–35帧判伤，第36–55帧只播放恢复。已完成强化后的离线正式审计：无空帧、无边缘裁切、透明区无残留RGB、固定动作尺度/根点无逐帧缩放或位移；攻击关键帧及枪口/枪尖判定均通过。详见[`FORMAL-ANIMATION-AUDIT.md`](FORMAL-ANIMATION-AUDIT.md)。

## 1. 制式步枪兵

### 待机

![制式步枪兵待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/service_rifleman/previews/idle.gif)

### 跑动

![制式步枪兵跑动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/service_rifleman/previews/running.gif)

### 攻击

![制式步枪兵攻击](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/service_rifleman/previews/attacking.gif)

### 死亡

![制式步枪兵死亡](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/service_rifleman/previews/dying.gif)

## 2. BAR自动步枪兵

### 待机

![BAR自动步枪兵待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/emplaced_machine_gun_crew/previews/idle.gif)

### 跑动

![BAR自动步枪兵跑动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/emplaced_machine_gun_crew/previews/running.gif)

### 攻击

![BAR自动步枪兵攻击](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/emplaced_machine_gun_crew/previews/attacking.gif)

### 死亡

![BAR自动步枪兵死亡](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/emplaced_machine_gun_crew/previews/dying.gif)

## 3. 近代骑枪兵

### 待机

![近代骑枪兵待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/industrial_carbine_cavalry/previews/idle.gif)

### 跑动

![近代骑枪兵跑动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/industrial_carbine_cavalry/previews/running.gif)

### 攻击

![近代骑枪兵攻击](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/industrial_carbine_cavalry/previews/attacking.gif)

### 死亡

![近代骑枪兵死亡](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/industrial_carbine_cavalry/previews/dying.gif)

## 4. 传统长矛重骑兵

### 待机

![传统长矛重骑兵待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/gunpowder_explosive_lancer/previews/idle.gif)

### 跑动

![传统长矛重骑兵跑动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/gunpowder_explosive_lancer/previews/running.gif)

### 普通攻击

![传统长矛重骑兵普通攻击](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/gunpowder_explosive_lancer/previews/attacking.gif)

### 冲锋

![传统长矛重骑兵冲锋](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/gunpowder_explosive_lancer/previews/charging.gif)

### 死亡

![传统长矛重骑兵死亡](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_four_units_20260902/formal-packages/gunpowder_explosive_lancer/previews/dying.gif)

## 验收回复格式

- 全部通过：`4个兵种全部通过`
- 单项返修：`兵种 + 状态 + 问题`，例如：`BAR自动步枪兵 + 跑动 + 背包晃动过大`
