# 沼泽吸血大蚊透明背景排查（2026-08-30）

状态：已按用户授权使用现有 Python 流程修复并覆盖四套正式素材。全部76帧完成素材检查；游戏内效果由用户测试，未同步固定 EXE。

## 范围与现状

正式素材目录：`assets/enemies/swamp_vampire_mosquito/`。
来源与制作报告：`tools/ai-gen/_swamp_vampire_mosquito_20260828/`。

| 动作 | 正式帧数 | 单格 | 修复前发现 |
| --- | ---: | --- | --- |
| 待机 idle | 8 | 640×640 | 大面积半透明黑底，伴蓝青残留 |
| 移动 walking | 8 | 640×640 | 大面积半透明黑底，伴蓝青残留 |
| 攻击 attacking | 29 | 1280×640 | 旧处理已去除整片背景，但仍有局部低 Alpha 暗色残留，需要随重建复核 |
| 死亡 dying | 31 | 640×640 | 大面积半透明黑底，伴蓝青残留 |

已逐帧读取全部76帧的 RGBA，并查阅四套联系图。四张运行时 PNG 与任务目录 `spritesheets/final/` 对应图片的像素完全一致；不是引用了另一份旧图。walking 同时承担逻辑 run，没有第五套独立跑步图。

## 根因

`tools/ai-gen/build-translucent-hover-sheet.py` 的 `recover_rgba()` 用提示词中的理想纯蓝 `[0,0,255]` 推算 Alpha：

`alpha = 255 - (blue - max(red, green))`

实际视频解码后的蓝幕不是255蓝。按相应首个已选关键帧的空白角落采样：

| 动作/原片帧号 | 蓝幕 RGB 中位数 | 旧公式背景 Alpha 中位数 |
| --- | --- | ---: |
| 待机 / 6 | [0,1,222] | 35 |
| 移动 / 6 | [0,0,221] | 35 |
| 攻击 / 38 | [0,5,220] | 40 |
| 死亡 / 0 | [0,0,219] | 36 |

约14%不透明的背景随后被逆向解色为近黑。旧 BiRefNet 条件仅在 `alpha < 20` 时清除低置信背景，未能去掉 Alpha 35–40 的蓝幕。最大连通区域检测也因此将大片背景纳入主体支持域。

移动每帧 `max(RGB)<24 && alpha>0` 像素约19.8万–21.9万，Alpha 中位数37–39，其覆盖框约600×482像素，远大于蚊子实际轮廓。这是背景残留的证据，不能把这些统计直接当成应删除的像素掩膜，否则会误删身体暗部。

RIFE 旧报告的 `visibleDarkOutlierFrames={}` 只排除了相对相邻关键帧新增的高 Alpha 黑块；源关键帧已有的低 Alpha 黑底不在其检测范围。`nonzeroRgbInTransparentPixels=0` 也只能说明 Alpha 已经为0的区域干净，不能说明背景 Alpha 正确。

## 修复约束

1. 从已确认的四段原视频、原关键帧窗口重新恢复 Alpha；使用实际解码蓝幕采样及 BiRefNet 主体支持域，区分视频色度噪声与真实翼膜。
2. 保持原有固定比例、锚点变换、帧数、格宽、飞行与坠落轨迹及攻击时序。不用逐帧缩放或重新居中掩盖问题。
3. 去除背景黑雾/蓝青溢色时保留身体暗部、细腿、口器和半透明翅膀；不能全图按“黑色”或单一 Alpha 阈值删除。
4. 干净关键帧经 RGB/Alpha 分通道 RIFE 重建，循环8帧、攻击29帧、死亡31帧保持不变；飞行中间帧不得按地面脚线纠偏。
5. 先输出候选和浅色/深色背景 GIF，逐帧复核76帧的背景与翼膜，再替换四张正式素材并更新制作索引。原视频不变。

## 已完成的处理

- `tools/ai-gen/build-translucent-hover-sheet.py` 增加实测蓝幕模式和旧制作报告的画布变换复用；只有显式启用新模式才改变原透明度恢复逻辑。用 BiRefNet 确定主体支持域，用实测蓝幕恢复翼膜软 Alpha，避免把整片蓝幕当成主体。
- `tools/ai-gen/ai-asset.py monster hover-rebuild` 透传校准、旧画布变换及去色边参数。本次重建入口是任务目录的 `rebuild-alpha.py`；`inspect-alpha.py` 仅检查这四套素材并生成对照 GIF。
- 清理源帧和缩放后的蓝青/黄绿溢色；插帧后仅对奇数中间帧做 RGB 回填，回填保持 Alpha 不变，并再次检查时间异常黑块。39张干净源关键帧逐像素保留在偶数索引，不使用复制前帧来替代插帧。
- 已同步 `assets/enemies/swamp_vampire_mosquito/{idle,walking,attacking,dying}.png`、任务目录的源表/正式表/逐帧 PNG/制作报告/预览和 `task-index.json`。未修改实体、移动、碰撞、攻击数值、帧数、帧率、格宽或原关键帧锚点。
- 原视频、原动作窗口和原有画布裁切约定保持不变；高速振翅的模糊姿态继续保留原片表现，没有重新生成角色动作。修复前源表、正式表和报告保存在 `alpha-repair-20260830/before/`。

## 素材检查结果

检查记录：[`inspection.json`](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/inspection.json)。

- 四套共76帧：无空帧、无触边、透明区无脏 RGB；蓝青超额、绿色溢色、半透明黄边检测均为0。
- RIFE 时间异常黑块报告为空；没有保持前关键帧的降级处理。
- 原关键帧位置、固定比例、画布尺寸、格数及时间配置与修复前报告一致。仅飞行插帧不再进行地面脚线纠偏。
- 已查看全部浅色背景联系图，并提供浅色/绿色双底 GIF。移动原先最大的半透明近黑连通块达213834像素，修复后最大为105像素；剩余为真实轮廓暗部，未用全图删黑阈值误删身体和细腿。

| 动作 | 原视频 | 修复后双底 GIF | 前后对照 |
| --- | --- | --- | --- |
| 待机 | [MP4](../tools/ai-gen/_swamp_vampire_mosquito_20260828/video/swamp-mosquito-idle-hanging-v03.mp4) | [GIF](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/idle/fixed-light-green.gif) | [对照](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/idle/before-after.gif) |
| 移动 | [MP4](../tools/ai-gen/_swamp_vampire_mosquito_20260828/video/swamp-mosquito-moving-hanging-v01.mp4) | [GIF](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/walking/fixed-light-green.gif) | [对照](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/walking/before-after.gif) |
| 攻击 | [MP4](../tools/ai-gen/_swamp_vampire_mosquito_20260828/video/swamp-mosquito-attack-hanging-v01.mp4) | [GIF](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/attacking/fixed-light-green.gif) | [对照](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/attacking/before-after.gif) |
| 死亡 | [MP4](../tools/ai-gen/_swamp_vampire_mosquito_20260828/video/swamp-mosquito-dying-hanging-v01.mp4) | [GIF](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/dying/fixed-light-green.gif) | [对照](../tools/ai-gen/_swamp_vampire_mosquito_20260828/alpha-repair-20260830/dying/before-after.gif) |

本轮仅执行用户授权的素材重建与素材检查。未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏、运行浏览器探针或同步固定 EXE。请重点确认游戏内移动时无矩形暗底，以及振翅、攻击切换和死亡落地的透明边缘；已发布的固定 EXE 仍使用旧素材。
