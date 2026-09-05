# 僵尸工头 MiniMax H3：v04攻击已接入

用户确认攻击v04可用，并明确允许约438.25MiB完整依赖组合的资产级预算例外。正式攻击已切换；`assetOnly:false`、`runtimeIntegrationActive:true`。未运行测试或运行时验证，按约定由用户测试；未同步固定EXE。

## 正式入口

- [导入报告](../../../docs/foreman-h3-attack-import-2026-08-31.md)、[接线清单](runtime-import.json)、[唯一素材真源](attack-v04-sheet-manifest.json)
- [正式运行时PNG](../../../assets/enemies/foreman_zombie/attacking_h3.png)、[获准源PNG](sheets/attack-v04-rife.png)
- [1.5秒最终GIF](previews/attack-v04-candidate-1500ms.gif)、[全部39帧](previews/attack-v04-candidate-frames.png)、[并排预览](preview.html)
- [H3原视频](videos/attack-v04.mp4)、[provenance](videos/attack-v04.mp4.json)、[提示词](prompts/attack-v04.txt)
- [实际PNG预算明细](budget/inventory.json)、[本次配置差异记录](planned-config.patch)、[废案恢复索引](rejected-assets.json)

攻击完整保留39帧和1500ms逐帧时钟：450ms蓄力、180ms爆发下抽，随后回收；命中第21帧596.25ms、音效第8帧450ms。PNG原样复制，没有再次插帧、逐帧居中、稳定身体或重画鞭子。旧独立曲线层已关闭，石化冻结仍保留实际贴图帧。

**本次只接入攻击。** 正式移动仍是原walking.png的15帧/1500ms；H3 walk-v01的50帧循环仍为未确认候选。待机、号召、死亡、碰撞、攻击范围320/宽26、物攻×2/流血1层、4.5秒冷却及矿洞机制不改。

## 来源与制作链

母图为原工头idle首帧；本目录保留`references/foreman-idle-master.png`和等比排入16:9的`references/foreman-reference-wide.png`。制作函数仍依赖上一阶段`../_foreman_whip_doubao_20260831/build-candidate.py`，该函数文件及其必要参考不随废案清理。没有以旧变形视频作为身份参考。

MiniMax H3通过统一`tools/ai-gen/ai-asset.py`入口生成，recover并锁定同一尾姿：1024×576、124帧/24fps、20步，seed8315302，promptId为446f8837-eb66-4b20-837b-cdcbb386c40f，用时461秒。身体固定源缩放0.9889298893、referenceCell512/displaySize480，所有帧脚点432/360；单格864×400，4列10行，整表3456×4000，39有效帧，末格不播放。

`attack-impact-selection.json`记录抽帧/展示时钟。20关键帧经过一次RIFE变成39帧，之后修复中间帧色键，再用10个对应时刻的原生视频姿态替换有残影的补间。最终为30个原生姿态和9个RIFE半步。保留`attack-v04-base.png`、最终PNG、源视频、原生中间帧输入及映射；`attack-v04-rife-report.json`只记录回灌前过程，不能冒充最终观感验收。

正式恢复入口为`install-approved-attack.py --apply-runtime`，读取已保存的预算批准记录，仅复制获准PNG并局部同步两份配置。默认不加参数只刷新清单，保持已接入状态。`build-impact-candidate.py`、`repair-candidate-chroma.py`、`restore-native-middles.py`拒绝覆盖已获准v04；进一步生成必须另开版本。`finalize-previews.py attack-v04`只从获准PNG重建同一时钟的预览并保留active标记。

## 范围与预算限制

工头五张表共149.7344MiB；加矿洞、普通矿工、提灯矿工和矿灯投射物共438.2532MiB，原组合412.5891MiB，本次增加25.6641MiB。用户已批准本次例外；没有改全局预算，也没有重做其他怪物。此数值不是显存实测，不包含共享核心纹理、驱动、mipmap或渲染目标。

源图只有朝右及左右镜像，不能宣称八方向鞭梢逐像素匹配；上下/斜向沿用原锁向判定。用户需重点看脚点/体量衔接、下抽命中、音效、石化解除、攻击中死亡和视口边缘。

## 移动候选与废案

[walk-v01原视频](videos/walk-v01.mp4)、[50帧候选表](sheets/walk-v01-rife.png)、[循环GIF](previews/walk-v01-candidate-1500ms.gif)保留，未自动安装。该候选取源帧26–76的步态周期，25原生关键帧做一次2×RIFE循环，单格288×304、10列5行、foot144/288；固定身体比例，不逐帧改变支撑脚。

| 版本 | 状态/原因 |
| --- | --- |
| attack-v01 | 已否决：水平伸直保持过长，收招未回到盘鞭姿势 |
| attack-v02 | 已否决：用户反馈攻击力度不足 |
| attack-v03 | 已否决：伸直停留过长，收招鞭梢出框 |
| attack-v04 | 用户认可并已接入；实机待验收 |

前三版MP4、GIF/联系图、v02透明表和缓存已可恢复移入仓库根`_tmp_foreman_h3_rejected_20260831/`，不进Git。活动目录只保留提示词、provenance、制作参数和拒绝原因；不再链接被移走的预览。恢复位置见`rejected-assets.json`。获准v04和未确认的移动候选均未被这次清理移除。
