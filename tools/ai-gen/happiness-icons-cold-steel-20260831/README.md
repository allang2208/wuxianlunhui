# 幸福度图标素材

2026-08-31 · 内置 image_gen 生成 · 冷钢档案风格

七张独立透明 PNG，原始尺寸均为 1254 × 1254，保留生成源图的 Alpha。冷银主体、石墨灰阴影，辅以少量灰绿色。用于人口幸福度总览及六项因素。

| 用途 | 文件 | 识别元素 |
| --- | --- | --- |
| 总幸福度 | [happiness.png](happiness.png) | 冷银笑脸，少量灰绿珐琅 |
| 食物保障 | [food.png](food.png) | 面包与麦穗 |
| 住房供给 | [housing.png](housing.png) | 普通房屋 |
| 住房品质 | [housing-quality.png](housing-quality.png) | 带星标的品质房屋 |
| 娱乐服务 | [entertainment.png](entertainment.png) | 音符酒杯 |
| 商业便利 | [commerce.png](commerce.png) | 购物袋与无字吊牌 |
| 安全感 | [safety.png](safety.png) | 盾牌与勾号 |

完整提示词、生成方式和历史源文件路径见 [generation.json](generation.json)。本目录七张原始PNG就是可重建输入，未重新绘制、缩放或抠图；重新导出不依赖本机 Codex generated_images 路径。

用户于2026-08-31要求接入：七张图标已在本地工作区用于市政厅总览和房屋人口页共用的幸福度组件，总幸福度放在标题旁，六项因素各有对应图标。名称、分值与解释继续独立刷新，不覆盖图标。

本次Git交付仅包含正式图标和可重建来源；人口/幸福度组件依赖尚未合入的市政厅与酒馆岗位接口，运行时接线不随本素材提交发布。素材已选定、本地已接入、远端功能已发布是三个不同状态，不能互相代替。

运行时副本在 `assets/ui/happiness/`，文件名与本目录相同，尺寸128×128；界面显示32×32，保留透明和原始比例。运行本目录 `export.ps1` 可只重新导出这七张副本，不扫描或更新其他素材。原始PNG及生成提示词保持不变。

接线文件为 `src/ui/population-growth-view.js` 与 `ui/panel-theme-backpack.css`。没有修改人口或幸福度数值、进度条语义色或红绿人数反馈。未运行游戏测试或运行时验证，按约定由用户测试两个面板的图标、窄窗排版和刷新后是否保留。
