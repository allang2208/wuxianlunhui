# 提示词库（固化模板，2026-08-04 定稿，二轮更新）

> 所有生图提示词必须从本库取用；新增资产类别先在库中建模板，禁止现场自由发挥。
> 配套执行流程见 [WORKFLOW.md](../WORKFLOW.md)。

> **入口优先级（2026-08-04 二轮调整）**：双机 ComfyUI（远程 5080 主力 + 本机 3080 Ti 兜底）
> → 本地零成本；智谱 API 降级为第三兜底。**固定视角/方向默认走 FLUX.2 dev + Depth ControlNet**
> （`flux2-dev-depth` + `--control-image` 深度图），不再只靠文字描述视角。

## 库结构

| 文件 | 适用 | 状态 |
|---|---|---|
| [skill-icon.md](skill-icon.md) | 魔法技能图标（六边形徽章系列） | 实战固化（暴风雪/陨星） |
| [equipment-icon.md](equipment-icon.md) | 装备/首饰图标 | 实战固化（稀有三套+首饰） |
| [obstacle.md](obstacle.md) | 障碍物/场景道具 | 实战固化（2026-08-03） |
| [monster-sprite.md](monster-sprite.md) | 怪物/角色贴图 | 初版（基于动画工作流，待实战补坑） |
| [video.md](video.md) | MiniMax H3 视频 | 实战固化（陨星 VFX 2026-08-04） |
| [transparent-subject.md](transparent-subject.md) | 透明主体（需透明 PNG 的图标/装备/怪物/道具） | 新增（2026-08-04 方案一固化） |
| [cover.md](cover.md) | 掩体（世界-122 防守地图 F→A 六档 × 水平/垂直摆） | 新增（2026-08-04） |
| [defense-tower.md](defense-tower.md) | 防御塔建筑（基座+机械臂挂载点） | 新增（2026-08-04） |
| [energy-crystal-v3.md](energy-crystal-v3.md) | 世界-122 能源水晶 v3（12 形态 + 30° 接地线） | 新增（2026-08-16） |

## 拼接规则（顺序固定）

```text
主题块 + 材质细节块 + 视角块 + 风格基准块
负面词块（ComfyUI 用 --negative；智谱 API 不支持负面词 → 避项并入正向）
```

- 主题块必须明确**单件/单主体**；易出多视图的类目（帽子/法袍/靴子）必须带权重语法
  `(exactly one hat:1.5), (one hat only:1.5)`。
- 材质细节块给写实质感词（velvet fabric texture, folds, rich shading），防止简笔画化。
- 视角块每类固定一句，新道具必须同一视角（正面 or 2:1 等距，按类目定，不混用）。
- 风格基准块 = 各类目下方 `风格基准` 代码块，**固化不可随意改动**；微调只动主题块。

## 工具语法差异

- **ComfyUI / SDXL / FLUX.2**：支持权重 `(tag:1.x)`、支持负面词（`--negative`）。
- **智谱 API**：不支持权重语法与负面词参数；避项（watermark/text/blurry/gradient/dark…）
  必须写进正向提示词末尾；且注意固定水印处理（见 WORKFLOW §1、§4.6）。

## FLUX.2 固定视角/方向（2026-08-04 新增，双保险）

1. **深度图锁构图**（首选）：`--model flux2-dev-depth --control-image <深度图>`
   ——同系列复用已定稿图深度，或手绘剪影/白模提深度；强度 0.6~0.8。
2. **JSON 结构化提示词**（BFL 官方支持）：FLUX.2 原生解析 JSON 提示，
   `camera: { "angle": "...", "lens": "...", "distance": "...", "depth_of_field": "..." }`
   与自然语言可混用；与深度图叠加效果最稳。
3. 提示词里的视角块（如 frontal/isometric）保留作第二道保险，但不再依赖它锁视角。

## img2img 模板锁定（同系列图标必用）

- 参考图先压白底再上传（透明角直传会被合成黑底 → 出黑角图）。
- 提示词强调 `keep the exact same <template> template, size, position and layout as the reference image`。
- denoise 策略：0.62~0.80 扫多档；低档保框架、高档换主体，两段式补底座。

## 透明主体：纯色底出图（方案一，2026-08-04 新增）

- 需要透明 PNG 且主体白色要素多（白衣/白甲/银饰）→ **禁用白底**，走
  `python tools/ai-gen/comfyui-gen.py --transparent ...`：AI 选纯色底写入提示词，
  出图后自动「阈值抠图 + GrabCut/BiRefNet 兜底」；
- 选色器：`tools/ai-gen/pick_bg_color.py`（扫描提示词颜色词，选与主体色距离最远的纯色）；
  抠图器：`tools/ai-gen/transparent_cutout.py`（自动检测背景均匀性，非均匀时切 GrabCut 主导）；
- 提示词里原本的 "pure white background" 会被自动替换成纯色底块，详见模板
  `transparent-subject.md`。

## 新增类目的固化流程

1. 定风格：用 `tools/ai-gen/check-icon-sizes.py` 等量化现有同类基准；
2. 写模板文件（风格基准/视角/负面/主题范例/坑）；
3. 实战一轮，把坑追加到对应文件底部；
4. 更新本 README 索引与 WORKFLOW.md 子流程。
