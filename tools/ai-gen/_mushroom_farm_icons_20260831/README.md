# 蘑菇农场六枚图标来源

> 发布边界（2026-09-05）：本目录本次仅作为制作源归档发布。六张正式运行时图标及蘑菇农场科技/升级链未包含在本归档批次中，后续应基于最新 `origin/main` 作为完整运行时批次一并合入。

2026-08-31，用户明确要求2枚科技图标和4枚升级项目图标。使用内置image_gen逐枚生成，共6张，没有新增建筑立绘或重画农场模型。

`manifest.json`记录各枚图标完整提示词、生成原文件、主题、参考框架与正式路径。`raw/`保留生成原图。参考奶酪科技六边钢框及蒸汽运输车升级方框，统一冷钢材质、无文字图示。

生成器输出为RGB，部分图在徽章外烘焙了棋盘格；不能把它当成透明素材。`finalize_icons.py`复用相邻 `_royal_mint_icons_20260824/finalize_icons.py` 的几何alpha裁切和尺寸归一化，不使用颜色洪泛删除内部暗底。科技输出1024²、主体最长边1000；升级输出256²、主体最长边244，均为RGBA。

仅重建这六枚派生资源的命令（仓库根目录）：

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_mushroom_farm_icons_20260831/finalize_icons.py
```

该命令会覆盖manifest中明确列出的六张正式PNG，并重新生成 `runtime-metadata.json` 和 `icons-preview.png`；原始生成图不覆盖。依赖项目已有Pillow、铸币厂徽章脚本及Windows微软雅黑字体。

`icons-preview.png`展示的是正式透明资源合成到深灰底上的总览，顺序：食用菌栽培、菌业标准化、优选菌种、恒湿培育、分层菌床、轻便采收筐。已查看该素材预览，不代表游戏内图标/面板验收；未运行测试或运行时验证。

科技数值、升级费用和接线范围见 `docs/mushroom-farm-technology-and-economy.md`。
