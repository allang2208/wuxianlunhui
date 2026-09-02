# 后四盾持盾斜视角重制（2026-09-02）

针对 `weapon58`—`weapon61` 原手持图仍为正面视图的问题，以
`assets/weapons/woodshied-equip.png` 小圆盾为相机角度参考，通过内置 ImageGen
逐面做身份保持重绘：人物位于画面左侧，近身侧左盾缘显示厚度，远侧右盾缘收窄，
盾牌外侧正面仍可读。

四张 `raw/*-raw.png` 是 ImageGen 原始结果；模型把透明棋盘格烘焙成RGB，不能直接
入库。`process.py` 只删除与画布边缘连通的近白棋盘格，不会把盾面内部的银色高光
当成背景，再生成1024px正式手持源和512px Phaser运行时副本。

正式手持源位于 `assets/weapons/guards/`，运行时副本位于
`assets/weapons/runtime/weapons/guards/`。原 `*-equip.png` 继续供物品、掉落与改造
正面展示，不被斜视手持图覆盖。

`shield-guard-four-contact.png` 是四张斜视手持源的近景联系图；玩家站立防御尺寸与
掌点对照继续由 `tools/animation/player-shield-walk-lower-20260902/shield-all-standing-guard.png`
统一展示。

四次重绘均使用 `precise-object-edit`：Image 1 是对应盾牌身份与结构真源，Image 2
仅提供小圆盾相机角度；要求透明背景、完整单盾、无人物/手臂/文字/投影，并锁定原
颜色、材质、轮廓、盾脐/中脊、铆钉、放射结构与宝石拓扑。
