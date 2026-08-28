# 传说霰弹枪资产生成记录（2026-08-28）

## 统一约束

- 使用 Codex 内置 ImageGen 生成，不采用网页检索素材或第三方图片。
- 武器主体必须为真正透明背景、纯水平侧视、枪口朝右、整枪完整入画；禁止人物、手、文字、水印、弹药散落、透视俯视和三分之四视角。
- 水平透明母图只供玩家持枪与塔载使用；装备栏、背包和掉落另用基于同一身份重绘的右上斜向图，避免构图职责冲突。
- 改造图标每张只包含一个独立部件，透明背景、无整枪、无文字、无边框；造型和配色必须能对应所属武器。

## 黑日圣裁（weapon47）

- 正式母图来源：`exec-864b96f2-b05f-454c-8d46-7c83b3f58b5a.png`
- 正式输出：
  - `assets/weapons/black-sun-verdict-equip.png`
- 造型方向：黑化钢、象牙与旧金装饰的双联传说霰弹枪；机匣中央使用黑日/月相机械结构，强调月相标记与日相裁决的双相身份。
- 专属改造图标来源：
  - 新月延轨镜：`exec-8a017e45-f840-4ce9-9a0c-df6455554622.png`
  - 日冕聚焦腔：`exec-7fb75f88-c343-4215-ae7a-e137a51f050b.png`
  - 黑日扩界环：`exec-bdb91133-0ff0-4d38-932c-dc87076469ac.png`
  - 蚀核重击弹：`exec-5cffe138-d161-423f-af34-cae3a8e1a282.png`
  - 双相速轮机：`exec-38614260-a2fd-4102-9c62-f405fccdc307.png`

## 王猎终局（weapon48）

- 正式母图来源：`exec-71da24e3-e7c1-4edb-ac9b-b4033d88d6f4.png`
- 正式输出：
  - `assets/weapons/royal-hunt-finale-equip.png`
- 造型方向：烤蓝钢、勃艮第红与骨质镶嵌的长身杠杆猎枪；用王冠、猎印和红金机械细节表现同目标连续狩猎与终局处决。
- 专属改造图标来源：
  - 猎王速记机：`exec-f51adabf-8446-4296-a87a-6ccb16b8432c.png`
  - 终局重膛：`exec-7496352b-8148-45a9-9d3c-93f4166a7a37.png`
  - 红冠处决弹：`exec-e619af7c-8b45-41a7-8e93-2c2840777570.png`
  - 锁猎荆棘托：`exec-fbbb133a-fbab-4974-bfe0-a8baf7858f77.png`
  - 不失焦寻迹镜：`exec-aeba0e10-07e3-4258-9520-f40acda93d9c.png`

## 接入说明

- 两把武器均使用共享 `shotgun` 动画配置，通过独立 `textureGrips` 校正握点；原先复制到 `assets/icons/` 的重复水平图已清理，物品图统一位于 `assets/icons/shotguns/`。
- 十张改造图标均接入 `assets/icons/craft-legendary-shotguns/`，并在 `assets/ui/runtime-icons/icons/craft-legendary-shotguns/` 提供128×128透明运行时镜像；每个配置项具备专属机制效果、机会成本与改造券成本。
- 正式母图已检查存在透明像素；实际游戏内握点、弹道枪口和界面裁切仍按项目约定交由用户运行时验证。
