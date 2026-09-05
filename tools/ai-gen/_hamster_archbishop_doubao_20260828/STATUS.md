# 仓鼠主教 / 大主教共用正式动画资产

## 发布边界（2026-09-05）

- 本目录本次仅作为已完成制作源归档发布；下述“正式接入”状态记录的是共享工作区制作完成时的快照。
- `assets/companions/hamster_bishop_archbishop_shared/`、单位图标、两份单位配置及其运行时代码尚未随本归档批次发布，后续应基于最新 `origin/main` 作为一个完整运行时批次精确合入。
- 在该运行时批次落地前，本目录中的 `runtimeIntegrationActive=true` 不代表当前远端已启用主教 / 大主教。

- 当前阶段：用户已确认四段豆包源视频；BiRefNet、自然周期、统一尺度/脚线和 RIFE v4.6 正式表均已完成；待机、移动、施法又完成了整像素身体根部精调，并已正式接入游戏。
- 共用单位：`bishop`、`archbishop`。
- 共同身份母图：`../_hamster_archbishop_20260828/candidates/hamster-archbishop-mother-v01-white.png`。
- 共同安全参考：`references/hamster-archbishop-safe-white-1024x576.png`。
- 每段规格：5 秒、121 帧、24fps。
- 统一规格：512×512 单格、有效躯干高 129px、脚线 y=351。
- 根部精调：以排除权杖的厚实身体组件底部为锚点，将待机、移动、施法的源关键帧与 RIFE 中间帧固定在 y=351；只做整帧整像素平移，不缩放、不重绘。死亡保持原样。
- 当前 `runtimeIntegrationActive=true`；主教/大主教玩法实体、AI、生产和科技链已接入，两者共用 `assets/companions/hamster_bishop_archbishop_shared/` 下的四套正式表以及 `assets/ui/unit-icons/hamster-archbishop.png`。

## 正式结果

| 动作 | 正式表 | 正式预览 | 规格与结论 |
| --- | --- | --- | --- |
| 待机 | `sheets/interpolated/idle.png` | `previews/interpolated/hamster-archbishop-shared-idle-interpolated.gif` | 源 f8–f112，f116 闭合；54帧@12fps循环。 |
| 移动 | `sheets/interpolated/moving.png` | `previews/interpolated/hamster-archbishop-shared-moving-interpolated.gif` | 源 f64–f88，f92 同脚相闭合；14帧@12fps循环。 |
| 施法 | `sheets/interpolated/spellcast.png` | `previews/interpolated/hamster-archbishop-shared-spellcast-interpolated.gif` | 61帧@12fps一次性；释放点为0基第30帧、未来配置1基第31帧。 |
| 死亡 | `sheets/interpolated/dying.png` | `previews/interpolated/hamster-archbishop-shared-dying-interpolated.gif` | 61帧@12fps一次性；保留源 f120 稳定尸体末帧。 |

## 已通过门禁

- 四套正式表均无空帧、无触边、透明区 RGB 为零。
- RIFE 原关键帧逐像素保留在偶数位，未使用整帧保持兜底。
- `visibleDarkOutlierFrames` 与 `visibleRedOutlierFrames` 均为空。
- 待机/移动包含回绕插帧；施法/死亡禁止回绕。
- 待机、移动、施法的最终每帧身体根部均为 y=351；原始关键帧仍逐像素保留在偶数位。
- 主教与大主教共同引用同一套正式表，不制作或切换第二套贴图；运行时安装清单见 `runtime-install-report.json`。
