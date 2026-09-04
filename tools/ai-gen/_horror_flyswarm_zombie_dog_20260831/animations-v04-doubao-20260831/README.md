# 僵尸犬 v04：豆包四动作视频

后续状态：用户已确认这四段视频，透明精灵图和普攻参数已接入开发端。最终播放速度GIF、精灵图与修改范围见[接入记录](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/docs/zombie-dog-v3-animation-integration-2026-08-31.md)。以下保留视频生成阶段的原始来源记录；未进行游戏运行时验收。

日期：2026-08-31。用户已确认v04母图，并要求使用豆包制作待机、奔跑、攻击、死亡动画。四段视频、GIF和24点联系图均已生成，统一为1280×720、24fps、121帧、约5.04秒；全部使用免费额度，未确认付费。直接查看 `preview.md`。

## 来源与范围

- 唯一身份来源：`../mother/zombie-dog-mother-v04-wolf-camera-white.png`。该图按项目黑狼和红狼王四足参考制作，已由用户选定。
- `references/zombie-dog-mother-v04-approved.png`保留原图；视频输入`references/zombie-dog-v04-video-safe-2048x1152.png`只将原1536×1024图像原样放到2048×1152白色画布上，没有缩放、抠图或重画主体。
- 通过项目统一入口`tools/ai-gen/ai-asset.py video generate --provider doubao`提交；每个动作先用后端`--fill-only`回读提示词，再单次正式提交，不盲目重试。
- 请求模型Seedance 2.0 Mini、16:9、5秒。真实参数、提示词摘要及来源以各MP4旁的`.mp4.json`为准；不把请求分辨率当作实际输出分辨率。
- 本次只制作视频候选与预览，未更换正式资源、游戏代码、配置、碰撞或数值；未生成透明精灵表或进行RIFE插帧。

## 动作与文件

| 动作 | 原视频 | GIF预览 |
|---|---|---|
| 待机 | `videos/zombie-dog-idle-doubao-v01.mp4` | `previews/zombie-dog-idle-doubao-v01.gif` |
| 奔跑 | `videos/zombie-dog-running-doubao-v01.mp4` | `previews/zombie-dog-running-doubao-v01.gif` |
| 攻击 | `videos/zombie-dog-attack-doubao-v01.mp4` | `previews/zombie-dog-attack-doubao-v01.gif` |
| 死亡 | `videos/zombie-dog-dying-doubao-v01.mp4` | `previews/zombie-dog-dying-doubao-v01.gif` |

各动作的实际制作状态见`manifest.json`，均为已生成、待用户评判的动画候选。不可变提示词位于`prompts/`，24点联系图和解码信息位于`previews/`。已查看四组联系图，不将取样查看描述为完整逐帧验收或游戏内验收。

## 预览口径与后续风险

GIF由全部原视频帧按原始时间戳生成，只缩小预览显示尺寸；没有截动作、插值、去水印、换底或改变播放速度。GIF的10ms时长量化累计补偿到原片时长。待机与奔跑GIF反复播放整段源视频，攻击与死亡只播放一次并停在末帧；整段回放不表示已完成自然循环截取。

豆包原片保留了灰白背景、部分地面投影和“豆包AI生成”角标，死亡原片的灰色背景尤其明显。奔跑源片中段有连续四足步态，头尾包含起步和收势；攻击包含蓄力、扑咬与回收；死亡包含倒地后稳定停尸。这些候选不是透明游戏贴图；后续接入前仍需去背、自然周期截取、攻击接触帧、死亡终姿、固定体量/脚点及精灵表流程。母图已经确认，四段动作仍需用户评判，不把源视频完成等同于运行时动画验收。

未运行测试或运行时验证，按约定由用户测试；没有启动游戏、构建或同步EXE。豆包客户端仅用于本次明确授权的视频生成。
