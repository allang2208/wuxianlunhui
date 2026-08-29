# 棕蛇 MiniMax H3 四动作定稿（2026-08-29）

当前阶段：母图、四状态 MiniMax H3 原始视频、BiRefNet 透明源表、RIFE v4.6 正式表、运行时时钟预览和游戏接入全部完成。`spritesheet-manifest.json` 与 `generation-manifest.json` 均登记 `assetOnly:false`、`runtimeIntegrationActive:true`。

## 获准视频

- 待机：`video/brown-snake-idle-h3-v02-raised.mp4`，盘缩立起警戒，只保留呼吸、轻微摆头和吐信；首尾同图锁循环。
- 移动：`video/brown-snake-walking-h3-v06-semi-coiled-crawl-loop.mp4`，用户确认的半盘缩伸缩式移动；右侧外圈逐段松开为短粗 S 形，后段压缩补位并重新形成两圈盘缩；首尾同图锁循环。
- 攻击：`video/brown-snake-attacking-h3-v02-cobra-motion.mp4`，后段盘圈贴地、前段立成 S 形，向右单次前探咬合后完整回收。
- 死亡：`video/brown-snake-dying-h3-v02-raised-collapse.mp4`，从立起警戒姿态单向倒下并稳定停尸；不回绕。

四段正式视频均为 1024×576、124帧；本轮三段重做视频使用 MiniMax H3 20步并保留同名 provenance JSON、不可变提示词和最终运行时时钟 GIF。移动 v02/v03 因分叉尾、额外身体分支或画面出界被拒绝；v04 因按外接框宽度归一后蛇身仅约20px、明显小于其余动作而被拒绝；v05 因盘圈基本固定、只有颈部探身而被拒绝。废案只保留提示词、provenance 与失败原因。

## 正式精灵表

四动作以局部蛇身粗细约88px和 `footY:410` 为共同尺度证据，明确排除尾巴、盘圈宽度与极端姿势对 Alpha 外接框的污染；整段动作只采用一套固定比例，不逐帧缩放、不拉直自然轨迹。待机/移动执行尾→首 RIFE 回绕，攻击/死亡为一次性 RIFE，不插末帧→首帧。

- 待机：`generated/final/idle-v02.png`，640×512/格，6列×4行，24帧，8 FPS，3秒循环。
- 移动：`generated/final/walking-v06.png`，640×512/格，5列×8行，40帧，运行时72 FPS，约0.556秒循环；源关键帧蛇身粗细86–88px。
- 攻击：`generated/final/attacking-v02.png`，896×512/格，8列×6行，41帧，900ms；接触帧18，生效窗口17–20。
- 死亡：`generated/final/dying-v02.png`，768×512/格，6列×6行，35帧，1800ms，单次。

插帧前透明源表位于 `generated/source-pre-rife/`；RIFE 量化报告位于 `reports/rife/`。最终四动作均无空帧、触边、透明区 RGB 残留、黑/红/蓝/青异常帧或关键帧回退；偶数位保持原关键帧，脚线范围为 y=409–410。

## 运行时接入

- 正式运行时副本：`assets/enemies/brown_snake/idle.png`、`walking.png`、`attacking.png`、`dying.png`。
- 双份真源：`data/enemy-config.json#brownSnake` 与 `public/data/enemy-config.json#brownSnake`。
- 待机仍为8 FPS/3秒循环；移动先由24 FPS提高到48 FPS，再按用户要求提高1.5倍至72 FPS，循环墙钟由约1.667秒最终缩短为约0.556秒，但`speed:255`和世界位移不变；死亡仍为1800ms，攻击900ms时间轴、命中帧、攻击距离、伤害、中毒、碰撞和尸体时长均未改动。
- 移动不使用额外 `visualScale`；正式表自身按88px局部蛇身粗细匹配待机与攻击，避免运行时再次缩小。
- 最终运行时时钟 GIF：`previews/final/idle-v02-runtime.gif`、`walking-v06-runtime.gif`、`attacking-v02-runtime.gif`、`dying-v02-runtime.gif`。

## 仓库收口

- 已删除旧版四动作 MP4、未版本化提示词/参考图、废案大文件、候选/源/插帧重复预览、旧联系图，以及与版本化正式表内容重复的兼容精灵表和 GIF。
- 正式目录只保留获准母图/引用参考、版本化提示词、四段定稿 MP4 与 provenance、插帧前源表、RIFE 成品/报告、最终运行时 GIF/联系图、运行时资产及可复现脚本。
- `spritesheet-manifest.json` 是唯一正式精灵表清单；生成器不再依赖或重建旧 `sheet-manifest.json`。

## 本轮验证边界

已执行资产生成流程自带的静态量化和逐帧联系图目检；未运行测试、构建、lint、游戏、浏览器或 CDP 运行时验证，按项目约定由用户测试状态切换、体量连续性、移动循环、攻击接触帧、死亡停尸与碰撞观感。
