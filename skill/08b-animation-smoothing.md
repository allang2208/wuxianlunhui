> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：动画平滑化方案（缓动插值 / 平滑启停 / 动画尺寸统一，2026-08-21 定稿）

## 动画平滑化方案（2026-08-21 定稿）

动画"生硬"的根因几乎总是线性速度（匀速、瞬时启停、瞬时换速）。视觉流畅的本质是
**速度曲线的变化**，不是帧数多少。本方案是项目内统一的公式化处理口径。

### 1. 核心公式

```
t = elapsed / duration              // 归一化进度 0→1
p = ease(t)                         // 缓动函数，把线性进度弯曲
value = from + (to - from) * p      // 插值
```

缓动选型（记四个覆盖 90% 场景）：

| 缓动 | 公式 | 适用 |
|---|---|---|
| easeOutCubic | `1-(1-t)³` | **默认首选**：出现、移动到位、UI 弹入（快出慢收） |
| easeInCubic | `t³` | 蓄力、加速离开、淡出到 0 |
| easeInOutCubic / Quad | `t<.5?4t³:1-(-2t+2)³/2` | 往复运动、点对点位移（呼吸/漂浮/巡逻） |
| easeOutBack | `1+2.7(t-1)³+1.7(t-1)²` | 弹窗、拾取、命中反馈（轻微过冲） |

经验法则：向目标运动用 easeOut，离开原位用 easeIn，往复用 easeInOut，要手感加 Back；
拿不准一律 easeOutCubic。Phaser tween 对应 `'Cubic.easeOut'` / `'Back.easeOut'` 等字符串，
项目里 `ease: 'Linear'` 的 tween 是重点替换对象。

### 2. 士兵 AI 平滑启停四件套（仓鼠 10 兵种已落地）

MovementSystem 自带速度渐近（无移动目标 `friction≈0.85/帧`，有目标按 `accel` 收敛），
AI 决策层只要**不再瞬时清零速度**即可获得缓停：

1. **站定动作**（挥击/射击/施法/采矿每帧分支）：硬清零换指数衰减——
   `damp = 0.85^(dt/16.67)`，`vx *= damp`，<1px/s 才收零；保留 `isMoving=false; maxSpeed=0`。
2. **决策分支删硬清零**（跟随到位/间隔待机/hold/RTS 到位）：只设 `maxSpeed=0`，
   速度交给 MovementSystem 摩擦衰减。
3. **跟随缓出**：距站位点 120px 内 `maxSpeed = walkSpeed × max(0.3, dist/120)`。
4. **滑行保持 walk**：`MovementSystem.update` 后，速度 >25px/s 时 `_animState` 强制
   保持 `'walk'`，防 idle 姿势滑冰（lessons #46 的根因修复）。

**保留硬停**：`cancelForCommand`（RTS 取消响应优先）、防御性 attack 残留复位、
骑士冲锋（直接改坐标不走速度积分）。调参：衰减率 0.85（越小停越快）、滑行阈值 25、
缓出半径 120。注意：滑行期 `_animState==='walk'` 窗口约 200ms，不会触发 500ms×2 的
卡死看门狗。

### 3. 纯视觉平民平滑移动（农民/银行家/工程师）

平民不走 MovementSystem，各自文件内的 `moveWorker(worker, target, speed, dt)` 统一改为：

```
期望速度 = speed × min(1, dist/60)        // 60px 内随距离线性衰减（ease-out 到达）
实际速度 += (期望速度 - 实际速度) × (1 - 0.85^(dt/16.67))   // 指数渐近
位置 += 实际速度 × dt
到位判定：距离近（≤max(2, 2×单帧步长)）且速度 <10px/s 才吸附归零
```

一阶滞后 + 比例控制，数学上无过冲；到位判定带速度门槛，防止高速冲过判定点
（工程师 180px/s 靠返回值切"维修中"状态，必须兜住）。农民田间另用分段
easeInOutQuad 位置插值（时长由 moveSpeed 反推，平均速度不变）。

### 4. 平民动画尺寸统一（scale/footRatio）

同单位不同动作素材帧内人物大小不一（银行家 running 比 idle 大 10.6%）：

- 测量法：PIL 逐帧 alpha bbox 取**中位高度**与**底边比例**；姿势性增高
  （工程师举锤）不是变大，不缩放（中央 40% 列复核本体）。
- 配置：`population-economy.json` 每个动画加 `scale`（相对 idle 内容高比）与
  `footRatio`（内容底边/帧高）。
- 运行时：`civilian-visual-utils.applyCivilianAnimSize()` 在 play 时按 scale 调
  displaySize，并按 `originY = footRatio - (refFoot - baseOriginY)/scale` 逐状态
  修正脚底锚点（ref=idle），换动作大小一致且脚底不漂。
- 接入点固定为 play 动画处：农民 `setState` / 银行家 `syncAnimation` /
  工程师 `syncWorkerAnimation`（创建路径同经这些入口）。

### 5. 落地清单（2026-08-21 已实现，2026-08-22 补充新单位）

- 士兵 AI 四件套：`src/ai/hamster-{guard,militia,warrior,shooter,scout,miner,priest,musketeer,knight}-ai.js`（轻骑兵继承盾卫；赏金猎人继承火枪手、美洲豹战士继承战士，自动生效）
- 后增单位：`hamster-explorer-ai.js`（探险家，`_dampToStop` + 目的地缓出）、`jungle-priest-ai.js`（丛林祭司，`_stop(dt)` 衰减化）
- 平民移动：`hamster-farmer-visual-system.js` / `hamster-banker-visual-system.js` / `workshop-economy-system.js` 的 `moveWorker`
- 尺寸统一：`civilian-visual-utils.js#applyCivilianAnimSize` + `data/population-economy.json` 的 scale/footRatio
- 阴影加深：`environment-lighting-system.js` `DYNAMIC_SHADOW_OPACITY=0.30078125`
