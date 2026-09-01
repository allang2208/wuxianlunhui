# 雪原普通怪物母图候选（2026-09-01）

本目录记录 5 只雪原普通怪物的身份母图与筛选依据。前四只已经完成标准四动作管线并静态接入游戏；最后一只极夜祷徒目前只完成结构修正版母图，后续工作已登记到根目录 `TODO.md`。

## 统一视觉契约

- 美术：写实、低饱和、冷色 PBR，材质可读但不堆叠首领级装饰。
- 镜头：近正交、轻微俯视的低三分之四/侧面主导视角；完整轮廓、脚底清楚。
- 朝向：屏幕右；动物以水平移动轴为主，类人形要求头、胸、胯、膝和脚尖在后续动作关键帧中共同指向右侧。
- 背景：纯白棚拍式背景，仅保留轻微接触阴影；不含雪景、文字、UI、边框或特效。
- 普通怪定位：控制外轮廓复杂度与发光量，不使用皇冠、巨大法器、夸张光环等首领语言。

## 候选清单

| 编号 | 怪物 | 类型 | 母图 | 当前结论 |
|---|---|---|---|---|
| 01 | 雪鬃猞猁 / `snowManeLynx` | 动物类 | `mother/01-snow-mane-lynx-v01.png` | MiniMax H3 四动作已完成并静态接入；攻击与死亡重复段已修正 |
| 02 | 霜背麝牛 / `frostbackMuskOx` | 动物类 | `mother/02-frostback-musk-ox-v01.png` | MiniMax H3 四动作已完成并静态接入；攻击仅保留首次顶撞 |
| 03 | 寒渊棘兽 / `abyssRimeBeast` | 深渊类 | `mother/03-abyss-rime-beast-v02-six-spines.png` | MiniMax H3 四动作已完成并静态接入；六棘固定，攻击仅保留首次咬击 |
| 04 | 霜缚矛卒 / `frostboundSpearman` | 类人形 | `mother/04-frostbound-spearman-v02-right-facing.png` | MiniMax H3 四动作已完成并静态接入；攻击仅保留首次直刺 |
| 05 | 极夜祷徒 / `polarNightCantor` | 类人形、深渊类 | `mother/05-polar-night-cantor-v03-structure-fixed.png` | 重生成人体结构修正版；双手、手铃、短杖、衣摆与双腿关系清楚 |

## 参考帧与方向依据

方向参考与身份参考分开使用，母图身份获准不等于动作朝向获准。

- 动物方向：`assets/enemies/black_wolf_walk.png` 的 0、5、10、15 帧；`assets/enemies/brown_bear/walking.png` 的 0、7、14、21 帧。
- 类人方向：`assets/enemies/shroud_thrall/walk.png` 的 0、20、40、59 帧；`assets/enemies/ossuary_caster/walk.png` 的 0、13、26、39 帧；`assets/enemies/coffin_ward/walk.png` 的 0、15、30、45 帧。
- 深渊身份语言：`tools/ai-gen/_deep_vein_mother_20260830/deep-vein-mother-v03-asymmetric-mine-fusion.png`、`tools/ai-gen/_horror_normal_mothers_20260830/mother/03-ossuary-caster-v02.png`。
- 雪原色彩：`assets/scenes/loading/snowfield-1.png`。
- 帧布局核对来源：`data/enemy-config.json`；黑狼为旧资产，以实际图集可见帧核对。

## 下一阶段门槛

极夜祷徒进入下一阶段时，必须先离线核对移动/攻击关键帧，并再次检查头、胸、胯、膝、脚尖和根点运动轴；关键帧通过后才可进入视频。前四只的具体方向、帧选和运行时边界分别记录在各自 H3 任务目录。

极夜祷徒 v02 因手铃缺失、持物职责不清以及衣摆/下肢层级不自然而被 v03 取代；旧文件仅保留作迭代记录，不再作为候选。

生成与筛选记录见 `manifest.json`，完整提示词见 `prompts/`。
