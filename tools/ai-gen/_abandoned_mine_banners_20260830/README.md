# 废弃矿洞顶部背景正式来源（2026-08-30）

> 本目录记录首批3张素材及当时的1/3概率。后续用户授权新增7张，当前三档矿洞均从10张中以1/10概率抽取；新增来源见`../_dungeon_theme_banners_20260830/README.md`，首批像素与来源不变。

状态：用户已明确选择三张全部导入并随机抽取；已复制到正式资源目录并接入开发源码，未同步固定EXE。

- 来源：Codex 内置 image_gen；Product Design ideate 按三张独立图片生成，未使用 CLI/API 后备。
- 实际附带参考：`assets/scenes/dungeon-exploration-horror-v9.png`（当前僵尸地牢背景，生成前已查看）。
- 目标：沿用冷蓝灰、潮湿岩石与少量暖灯光；废弃矿洞横向场景，供上方长条拉伸。图片无 UI、无文字、无黑色留边。
- 实际工具输出：每张 2172×724，3:1；未裁切、重采样、调色或修改输出像素。提示词中的3072×1024是请求尺寸，实际尺寸以上述工具输出为准。
- 当前背景槽使用`object-fit: cover; object-position: center`，默认40%/60%布局；等比铺满并裁切超出部分，不拉伸源图。
- 仅查看生成图，未运行游戏、浏览器、构建或其他运行时验证；未同步EXE，未改变经济面板、时钟、UI样式或玩法。

## 文件与聊天展示顺序

| 展示顺序 | 图片 | 提示词 | 原生成文件 |
|---|---|---|---|
| 1 | mine-banner-01-rail-gallery.png | prompt-01.txt | exec-b5ca2ac8-8294-4fae-aa10-a996bf50d405.png |
| 2 | mine-banner-02-broken-bridge.png | prompt-02.txt | exec-08c01c76-d682-4802-9262-27946cfb5c23.png |
| 3 | mine-banner-03-ore-station.png | prompt-03.txt | exec-c7f723c8-98c5-4b63-bfcd-c62c441107ab.png |

原生成目录：`C:/Users/allan/.codex/generated_images/01a0529e-d746-75c1-a316-2b8b2016f4be/`。本目录保留提示词与来源路径；三张PNG与正式资源逐字节一致，已清理重复副本，保留正式目录中的唯一成品。原生成目录未清理。

## 正式接入

- 正式图片：`assets/scenes/dungeon-exploration-mine/`，文件名与上表一致；按用户选择原样复制，没有再次生成或修改像素。
- 范围：`abandonedMineDungeonBeginner`、`abandonedMineDungeonMid`、`abandonedMineDungeon`三档，`data/dungeon-config.json`与`public/data/dungeon-config.json`同步配置`mapExplorationBackgroundVariants`。
- `DungeonMapSystem.init()`生成路线后、创建探索台之前抽取一次，当前扩充后每张概率1/10，允许连续重复；同一局战斗/事件返回、查看房间、拖动上沿不会重抽。离开地牢清理所选路径，新一局重新抽取。
- 选择独立于旧`mapBackgroundVariants`地标母图；旧母图列表/加权选择、其他地牢背景、路线拓扑和HUD均不变。探索台使用原DOM图片与等比cover显示，其他系列扩展见探索台说明。
- 接线文件：`src/world/dungeon-map-system.js`。仅查看本次局部diff与必要调用链，未运行测试或运行时验证；按约定由用户验证三档新开探索与本局往返显示。
