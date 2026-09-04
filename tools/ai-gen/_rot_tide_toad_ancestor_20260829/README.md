# 腐潮蟾祖正式资产记录

- 状态：母图与八套动作均已确认并接入游戏；运行时表已完成无损透明边裁剪。
- 生成日期：2026-08-29
- 生成方式：Codex 内置 ImageGen（新图生成，无参考图）。
- 已批准母图：`mother/rot-tide-toad-ancestor-mother-v01-approved.png`
- 原始生成文件：`C:\Users\allan\.codex\generated_images\01a048dd-6bcc-7c82-8a27-ebae949d5504\exec-28972a16-1007-42ab-be4c-938fe8eaf209.png`
- 画布：1254 × 1254 PNG

## 身份锚点

- 单只成年巨型蟾蜍，右向、低矮、宽重的完整四足轮廓。
- 琥珀色眼睛、眼后成对耳后腺、灰黄色喉囊。
- 泥炭黑、泥褐、暗橄榄色的湿润疣状皮肤。
- 无王冠、铠甲、武器、魔纹、发光效果或附生大型植物。
- 白色无场景背景，为后续视频动画管线保留识别与抠像空间。

## 用户确认

- 2026-08-29：用户确认母图可用，并指定使用 MiniMax H3 管线制作待机、移动、攻击、死亡动画。
- 视频阶段允许纯白背景，但禁止生成任何地面、接触影或投影。

## 动画产物

| 动作 | H3 源视频 | 运行时正式表 | 运行时规格 | GIF 预览 |
|---|---|---|---|---|
| 待机 | `videos/rot-tide-toad-idle-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/idle.png` | 30帧，672×480，12fps，循环 | `previews/sprites/final/idle/rot-tide-toad-idle-interpolated.gif` |
| 移动 | `videos/rot-tide-toad-moving-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/moving.png` | 34帧，1024×480，20fps，循环 | `previews/sprites/final/moving/rot-tide-toad-moving-interpolated.gif` |
| 直线舌刺 | `videos/rot-tide-toad-attacking-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/attacking.png` | 43帧，928×448，24fps，一次性；舌头最大前探约为正式帧28 | `previews/sprites/final/attacking/rot-tide-toad-attacking-interpolated.gif` |
| 死亡 | `videos/rot-tide-toad-dying-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/dying.png` | 29帧，832×480，16fps，一次性 | `previews/sprites/final/dying/rot-tide-toad-dying-interpolated.gif` |
| 舌头横扫 | `videos/rot-tide-toad-tongue-sweep-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/tongue_sweep.png` | 43帧，1216×480，24fps，一次性 | `previews/sprites/final/tongue_sweep/rot-tide-toad-tongue-sweep-interpolated.gif` |
| 腹砸 | `videos/rot-tide-toad-body-slam-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/body_slam.png` | 53帧，896×576，24fps，一次性；腾空峰值帧24、砸落帧30 | `previews/sprites/final/body_slam/rot-tide-toad-body-slam-interpolated.gif` |
| 毒雾喷吐身体动作 | `videos/rot-tide-toad-poison-belch-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/poison_belch.png` | 41帧，864×448，24fps，一次性；释放帧18 | `previews/sprites/final/poison_belch/rot-tide-toad-poison-belch-interpolated.gif` |
| 召唤震鸣 | `videos/rot-tide-toad-summon-croak-h3-v01.mp4` | `assets/enemies/rot_tide_toad_ancestor/summon_croak.png` | 51帧，704×512，16fps，一次性；持续施法约3.19秒 | `previews/sprites/final/summon_croak/rot-tide-toad-summon-croak-interpolated.gif` |

- 八套源表统一 `referenceCell=640`、`footY=560`、有效母体目标高度 360px。
- 正式处理链：MiniMax H3 白底源视频 → BiRefNet-general + 白距细节保留 → 固定缩放/动作锚点 → RIFE v4.6 RGBA 2×。
- 待机、移动稳重心和脚线；攻击、死亡保留源视频一次性动作轨迹。
- 移动修正版不再用整张 Alpha 包围盒居中：改为厚实躯干中心 X/Y 双轴锁定，消除整只 Boss 的上下位移；四肢仍保留源帧动作，后蹬腿使用1152px宽格完整保留，不参与缩放或几何拉直。
- 移动 RIFE 使用 `preserveVerticalMotion`：中间帧不按 Alpha 底边强制对齐，避免插值帧再次破坏已经锁定的躯干根节点。
- 毒雾喷吐的 H3 源视频峰值带有绿色离体喷流；正式角色表按中立头部右缘量化清除全部非零 Alpha 喷流，只保留鼓囊、张口与后坐，毒雾和地面毒池仍由运行时 VFX 生成。
- RIFE 报告确认八表均无空帧、无碰格边、透明区 RGB 为零，原始关键帧保留在偶数索引。
- 运行时表由 `build-sheets.py` 生成可丢弃的 RIFE 源表，再由 `trim-final-sheets.py --apply` 统一裁透明边：横向保持关于旧格中心对称，纵向同步换算 `footY`，不重采样可见像素、不改变逐帧轨迹。运行时总 RGBA 纹理估算由约 942.5 MiB 降至约 604.2 MiB，最大表宽由 10240px 降至 8192px；逐动作布局记录在 `trim-layouts.json`。源表、逐帧 PNG、接触表和视频级重复预览均为可重建中间产物，不纳入 Git。
- 已复制到 `assets/enemies/rot_tide_toad_ancestor/`，并完成 BootScene、动画配置、实体与沼泽地牢 Boss 房接线。

## Boss 专属动作补充（已确认并接入）

1. `tongue_stab`：现有直线舌刺，单体远距离快速攻击。
2. `tongue_sweep`：弯曲扫掠后转为前伸，作为前方扇区 AOE 动画。
3. `body_slam`：压低蓄力、短跃、腹部砸地，作为圆形 AOE 动画。
4. `poison_belch`：毒囊明显膨胀后向前释放；角色表只保留身体动作，毒雾和地面毒池由运行时 VFX 生成。
5. `summon_croak`：抬头鼓囊并持续维持，用于召唤和阶段转换，不复用任何伤害动作。

每种机制只绑定自己的可见动作、接触/释放帧和范围；不使用一套 `attacking` 动画承载所有 Boss 技能。

## 最终提示词

```text
Use case: stylized-concept.
Asset type: production identity mother frame for a 2D Phaser swamp-dungeon final-boss animation pipeline, square canvas.

Create exactly one enormous ancient swamp toad boss named "Rot-Tide Toad Ancestor / 腐潮蟾祖·格罗玛". This is the neutral mother image that all later idle, move, attack, and death animation clips must preserve.

Subject and anatomy:
- Exactly one adult giant toad with believable realistic amphibian anatomy: one head, two amber eyes, exactly four limbs, broad low heavy body, squat powerful forelegs and folded hindlegs, webbed toes clearly visible.
- Large paired parotoid poison glands directly behind the eyes.
- Broad low-saturation gray-yellow throat sac, currently relaxed.
- Wide closed mouth, calm heavy neutral crouch, all four feet contacting the same baseline.
- Full body and complete silhouette visible, centered, facing screen-right.
- No tongue extension and no action pose.

Identity and surface:
- Peat-black, mud-brown, and dark-olive mottled wet leathery skin.
- Dense natural warts and folds, damp mud staining, a few subtle old scars, a few tiny loose reed fragments stuck in mud.
- Grounded dark-fantasy swamp ecology, ancient and physically intimidating, but still an animal rather than a humanoid.
- High-detail realistic PBR 3D game render, production character concept, not a photograph and not a cartoon.

Camera and composition:
- Slightly elevated strict side / very shallow three-quarter orthographic game-sprite view.
- Low, wide, weighty silhouette.
- Subject occupies about 65% of canvas width and 55% of canvas height.
- Generous clean margin on every side for later leap, tongue, and death animation motion.
- Do not crop feet, body, or outline.

Background and lighting:
- Pure solid white #FFFFFF background.
- No floor plane, horizon, scenery, water, vegetation, fog, particles, reflection, cast shadow, contact shadow, vignette, text, logo, or watermark.
- Flat soft diffuse studio lighting with clear readable form and no dramatic rim light.

Hard negatives:
No crown, armor, jewelry, weapons, saddle, humanoid torso, clothes, horns, wings, tail, extra heads, extra eyes, extra limbs, missing limbs, mushrooms growing from the body, large plants attached to the body, glowing eyes, glowing magic markings, runes, poison clouds, bubbles, saliva, blood, open mouth, tongue attack, motion blur, cinematic environment.
```
