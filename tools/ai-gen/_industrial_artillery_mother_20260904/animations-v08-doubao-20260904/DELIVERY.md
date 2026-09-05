# 仓鼠近代炮兵组 v08 豆包源片交付记录

状态：母图 v08 已被用户选为动作身份源；待机、跑动、攻击、死亡四段豆包源片均已生成、通过助手源片门禁，并由用户以“可用，按照动画标准工作量继续”确认进入正式后处理。待机 v01 的提示词、供应方 JSON、任务信息、判退原因和清理记录保留，失败视频二进制及重复预览已按最终清理授权移入Git忽略回收区；透明成品已在后续明确授权下接入运行时，等待用户实机验收。

## 当前四段候选

- 待机 v02：`videos/industrial-artillery-crew-idle-doubao-v02-no-fire.mp4`；运行时钟GIF `previews/idle-transparent-runtime-clock.gif`；SHA-256 `11A9DD1EA5D650FDB534A790ED966AEB3712B4F2D7D50126B7E4F1DB7AE2059D`。
- 跑动 v01：`videos/industrial-artillery-crew-running-doubao-v01.mp4`；运行时钟GIF `previews/run-transparent-runtime-clock.gif`；SHA-256 `6A24919EA4DFB895E3313EF5F8AB96E8D51164EF6B982DA9BE4C71DC07896E66`。
- 攻击 v01：`videos/industrial-artillery-crew-attacking-doubao-v01.mp4`；运行时钟GIF `previews/attack-transparent-runtime-clock.gif`；SHA-256 `6E13B40E76F96869D4324288737D50B52220230ADE8D778F0B8BEADDFB42C7EC`。
- 死亡 v01：`videos/industrial-artillery-crew-dying-doubao-v01.mp4`；运行时钟GIF `previews/die-transparent-runtime-clock.gif`；SHA-256 `62077A8FED93C31169EC52C941323717EC75E6784C42CDDEFDDDFD3605C2276E`。
- 四段均为1280×720、24fps、121帧、约5.042秒；来源JSON、正式透明源表、运行时钟GIF和离线报告保留。源视频整段GIF与24点接触表已在完成正式透明成品后作为可再生重复预览删除。

## 四段源片门禁结论

- 待机：没有开火、烟尘、后坐、装填或亮度事件；备用炮弹不靠近炮闩；只有固定根点的克制呼吸微动。
- 跑动：两人保持右向步轴和交替落地，轮子相位变化可读，整组在跑步机式固定根点内推行；没有转正、左转、开火或横向漂移。
- 攻击：约1.5秒只出现一次右侧炮口事件，浅烟随后消散，两人和炮车恢复到待命构图；没有第二次开火、额外炮弹或炮车滑移。
- 死亡：备用弹脱手落地，两人沿不同带重量轨迹倒向炮架两侧并保持分离终态；炮车、双轮和分列式炮架保持完整，没有复起、开火或爆炸。
- 共同结构：四段都保持固定浅俯视近侧三分之四右向镜头、两名炮手、两轮、两条从同一炮架连续伸出的分列式驻锄和完整炮管。
- 处理：用户已经确认四段源片。首尾循环缝、BiRefNet抠图、选帧、统一比例/脚线、RIFE 2×、正式精灵表、运行时钟GIF及crowd预算现已完成；任务内透明成品随后已正式入库，但不宣称实机通过。

## 标准后处理结果

- 待机从认可源片选取[19,119)的4.167秒稳定环；跑动在完整5秒源片内确认多周期后，选取[70,118)的2.000秒自然步态环，避免整段首尾的较大相位跳变。
- 四动作共用0.26制作比例和原画布(640,571)地面锚点；只做各动作固定紧裁，不逐帧缩放、居中、拉直或抬脚。
- 攻击源第34帧为炮口事件；死亡源第28帧炮弹完全脱手、第72帧起两人均倒地。关键动作段保留原生密集姿态，其他区间step4取关键帧。
- 正式输出为待机50、跑动24、攻击87、死亡113帧。循环N→2N并含末→首中间帧；单次N→2N-1且不回插首帧；原关键帧均保留在偶数索引。
- 四张图集crowd闭包46.196MiB：超过32MiB目标但低于64MiB准入线。死亡和攻击为最大项；尾格与裁边已收紧，保留约99px炮手身高和获准动作姿态。详细说明、正式预算和离线结构检查见`SPRITES-DELIVERY.md`、`sprite-budget-report.json`与`sprite-validation-report.json`。

## 淘汰待机候选 v01

- `videos/industrial-artillery-crew-idle-doubao-v01.mp4` 约2.2–2.6秒出现炮口火焰，违反“不射击”的待机语义。
- v01 的提示词、来源JSON、任务ID、SHA与判退理由保留；MP4、整段GIF和接触表已移出活动归档，详见`../cleanup-manifest.json`。

## 生成边界

- 使用本地豆包客户端安全入口，模型为 Seedance 2.0 Mini，16:9、5秒、每动作单候选。
- 每段都先完成 fill-only 提示词回读再正式提交。待机仅在用户明确要求后重抽一次；其余动作各提交一次，没有自动重抽或多候选追加。
- 当前为 `futurePlanOnly:false`、`runtimeIntegrationActive:true`；正式路径、动作配置、炮弹和注册链见`RUNTIME-DELIVERY.md`。
- 未运行游戏测试、构建、浏览器/CDP游戏探针或EXE发布。
