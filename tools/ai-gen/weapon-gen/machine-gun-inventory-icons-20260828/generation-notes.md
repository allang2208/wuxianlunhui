# 机枪背包与掉落图生成记录（2026-08-28）

## 范围

- 机枪清单：`weapon6/11/15/31—38`，共 11 把。
- 只替换 `iconImage / slotImage / dropImage`；`equipImage / weaponAsset.image` 保持原水平侧视真源。
- 防御塔继续使用原侧视真源与 `tower_barrel_<weaponId>.png`，不读取本批斜向物品图。

## 参考与输出映射

| weaponId | 名称 | 持有/塔载参考 | 正式物品图 |
|---|---|---|---|
| weapon6 | PKM | `assets/icons/pkm_side_clean.png` | `assets/icons/machine-guns/pkm.png` |
| weapon11 | QJB-201 | `assets/icons/201-icon.png` | `assets/icons/machine-guns/qjb-201.png` |
| weapon31 | RPD | `assets/weapons/rpd-equip.png` | `assets/icons/machine-guns/rpd.png` |
| weapon32 | M249 SAW | `assets/weapons/m249-equip.png` | `assets/icons/machine-guns/m249-saw.png` |
| weapon33 | Ultimax 100 Mk8 | `assets/weapons/ultimax100-equip.png` | `assets/icons/machine-guns/ultimax-100-mk8.png` |
| weapon34 | MG42 | `assets/weapons/mg42-equip.png` | `assets/icons/machine-guns/mg42.png` |
| weapon35 | 熔核轻机枪 | `assets/weapons/fusion-core-lmg-equip.png` | `assets/icons/machine-guns/fusion-core-lmg.png` |
| weapon36 | 奇点织机 | `assets/weapons/singularity-loom-lmg-equip.png` | `assets/icons/machine-guns/singularity-loom-lmg.png` |
| weapon37 | 天穹测绘者 | `assets/weapons/celestial-cartographer-lmg-equip.png` | `assets/icons/machine-guns/celestial-cartographer-lmg.png` |
| weapon38 | 冥约颂炮 | `assets/weapons/grave-covenant-cantor-lmg-equip.png` | `assets/icons/machine-guns/grave-covenant-cantor-lmg.png` |
| weapon15 | 能量轻机枪 | `assets/icons/devotion-icon.png` | `assets/icons/machine-guns/energy-lmg.png` |

## 生成与后处理

- 生成入口：Codex 内置 `image_gen`，逐把以自身持有贴图作为权威参考，没有用一张图复用多把枪。
- 统一提示约束：方形游戏物品图；枪托朝左下、枪口朝右上；完整单枪占框约 86%—90%；保留枪托、机匣、供弹结构、枪管、材质与专属纹样；禁止人物、手、文字、边框、枪焰、散落弹药与额外附件。
- 内置服务输出为烘焙浅色棋盘格 RGB；正式图通过 `tools/ai-gen/strip-checkerboard-alpha.py --size 512` 做双底色识别、最大主体保留、边缘去污染与方形归一化。
- 参考顺序见 `reference-manifest.json`，正式图顺序见 `final-manifest.json`；`build-contact-sheet.mjs` 可重建两张总览。

## 静态验收

- 11 张正式图均为 `512×512` RGBA；Alpha 主体左右边界统一为 `x=28…483`。
- `iconImage / slotImage / dropImage` 在 EDM、`data/equipment.json` 与 `public/data/equipment.json` 三处一致。
- `equipImage / weaponAsset.image` 仍逐把指向原水平侧视贴图，防止玩家持枪或塔载武器被斜向图污染。
- 未运行测试、构建、lint、浏览器探针或游戏运行时验证；由用户重点检查背包格、装备栏、地面掉落和防御塔挂载外观。
