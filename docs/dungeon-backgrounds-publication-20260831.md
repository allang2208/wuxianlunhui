# 场景背景发布范围（2026-08-31）

本任务包含沼泽探索10张、恐怖探索10张、矿洞全屏Loading10张，以及矿洞位面/地牢的配置接入。发布基线为远端main的2a5bb250，使用独立分支codex/dungeon-backgrounds-20260831整理；共享开发工作区保持原样。

## 本次进入Git的内容

- 世界-126矿洞位面scene12，以及废弃矿洞地牢scene7的abandonedMineBeginner/abandonedMineMid/abandonedMine，共用assets/scenes/loading/world126-mine/十图。data/public两份Loading配置同一提交，每次调用抽一张、各1/10、允许重复，不自动轮播，不改变原有计时或进度。
- 沼泽与恐怖地牢各10张正式探索横幅、20张未裁原图、完整提示词、manifest、裁剪重建脚本及各一张最终总览。正式图均为40:9原像素居中裁剪，尺寸与裁剪框以各批manifest为准。
- 矿洞10张1672×941正式PNG、01/10清理前直接输入、提示词、manifest和最终离线画廊。正式PNG同时作为唯一原生生成输出，清理十份同内容source副本22,334,647字节；没有删除裁剪原图或直接编辑祖先。
- 第02/06/10卷知识及主索引、清理清单和本说明。没有新增依赖、Git LFS或运行时框架。

## 保留本地、未夹带的接线

当前开发目录已经给沼泽/恐怖三档配置mapExplorationBackgroundVariants并使用每局随机选择器；远端基线的DungeonMapSystem尚无该字段消费。按照第15.7节，不能把依赖未合入框架的双份dungeon-config单独发布，也不能提交该文件中其他会话的事件、战斗和路线改动。

因此本次对这两批发布的是正式素材与完整来源，不能把Git素材归档表述为远端探索随机逻辑已交付。未来框架合入后，仅需将两批manifest.integration.dungeonKeys中的mapExplorationBackgroundVariants配置为各自manifest.assets[].path；无需重新生成或裁图。当前开发目录的六档接线未回退。

开发目录中此前修复了loading-*类缺少样式的问题；远端已经具备自己的完整Loading样式，本次保留远端实现，不覆盖整份共享CSS，也不夹带游戏启动流程。矿洞地牢原有Loading入口继续使用既有SceneManager/ExpeditionSystem。

## 验收与固定EXE

未运行测试、构建、浏览器、游戏或运行时验证，按约定由用户测试。重点确认三档矿洞入场标题、10图随机、进度结束及宽高比裁切；连续抽到同图属于允许结果。

本轮配置发生在发布ID20260831084931-d7ee13dd的独立快照复制之后，不会自动进入该固定EXE；本任务未更新EXE。素材来源记录中的早期“未同步EXE”按当时生成阶段理解。
