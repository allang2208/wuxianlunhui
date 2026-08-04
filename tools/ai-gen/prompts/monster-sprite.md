# 怪物/角色贴图提示词模板（2026-08-04 初版，基于玩家动画工作流，待实战补坑）

> 本项目怪物/角色目前以外部素材（素材库）+ 即梦出图为主；本模板固化自
> 「玩家角色动画标准工作流」§2 AI 素材生成规范，作为 AI 直出时的统一口径。

## 风格基准（写实 3D 渲染，与障碍物/道具同一视觉体系）

```text
game character asset, photorealistic 3D render, dark realistic materials,
full body, feet at the bottom edge of the frame, side view facing right,
isolated on plain pure white background, high detail, no text, no watermark
```

## 硬性规则（2026-07-26 玩家动画工作流定稿）

1. **固定一张角色基准图**；所有动作从同一首帧 img2video 出发，保证跨动作一致性。
2. **侧视朝右、全身入画、脚底贴底边**；画布对齐 512×516（内容高 477px、脚底基线 y=492）。
3. 提示词写"**无武器、空手呈握持/挥击状**"（战斗姿态素材）；干净输出三件套：
   透明底、无白色描边/辅助线、无水印。
4. 同一套动作**一批出齐**，不分开生成（分开必出规格差）。
5. 帧尺寸严格 = 帧宽×列×行，不足补透明行；入库前过 `tools/sprite-normalizer.py`。

## 主题块范例

```text
<怪物名>, <体型/姿态描述>, <材质与配色>, full body, side view facing right,
feet at the bottom edge of the frame, no weapon, empty hands in a gripping/swinging pose,
<风格基准>
```

范例（参考现有红狼王素材）：

```text
red wolf king monster, hulking quadruped wolf with dark crimson fur and scarred muzzle,
glowing amber eyes, muscular frame, full body, side view facing right,
feet at the bottom edge of the frame, no weapon, <风格基准>
```

## 深度图锁姿态/朝向（2026-08-04 新增，推荐）

- 怪物跨动作一致性靠基准图 + img2video；单张新怪（或换皮）用
  `--model flux2-dev-depth --control-image <剪影/参考深度图>` 锁住**侧视朝右、全身、脚贴底边**，
  比纯文字"side view facing right"稳。
- 姿态敏感场景（施法/挥击）可先用骨骼/剪影图出深度再生成，提示词只补材质与细节。

## 负面词

```text
blurry, low quality, watermark, text, signature, white outline, helper lines,
extra limbs, deformed hands, front view, back view, multiple characters,
cluttered background, gradient background, dark background
```

## 验收

- GLM-4V 单张问：主体/朝向/姿态/是否无武器；多张一起描述会串扰。
- 像素统计：脚底贴底边、内容高度对齐基准、边缘无白边（alpha∈(10,245) 白色占比 0%）。

## 待补坑位（实战后追加）

- （暂无实战沉淀，按玩家动画工作流规范执行；新怪物出图一轮后把坑写到这里）
