# 玩家手枪握持与运行时贴合复核（2026-09-01）

## 范围与基准

- 覆盖 12 把现有手枪：G18、Desert Eagle、.357 Revolver、P4040、Beretta 93R、M1911A1、USP .45、FN Five-seveN、Eternal Edict、Falcon Edict、Crimson Crown Settlement、Myriad Corridor。
- 姿态沿用已认可的 `gun_idle_pistol` / `gun_idle_dual`，尺寸与画布留白以 Desert Eagle 为基准。
- 本轮只处理单持/双持瞄准、左右镜像、walk/run 时的手枪贴手；不制作换弹，不改伤害、射速、弹药、后坐力或装备规则。

## 静态贴图审计

- 12 张运行时手枪图均为 512×512；透明内容宽度比为 0.857422～0.865234，与 Desert Eagle 的 0.861328 同量级。
- 全部配置握把点均落在握把不透明像素上，握把点到最近 Alpha 的最大距离为 0.431 源像素。
- 当前运行时手枪完整显示框为 37.8×37.8 世界像素；未发现错误放大的单把手枪。
- `data/weapon-anim-config.json` 与 `public/data/weapon-anim-config.json` SHA-256 一致。
- 证据：`pistol-grip-alpha-audit.json` 与 `pistol-grip-alpha-audit.png`；复现脚本为 `build-pistol-grip-audit.ps1`。

## 根因与修复

贴图握把点到逻辑枪锚点原本已经接近零误差，但单持/双持的主手手臂条属于只绕肩旋转的静态刚体，不会随理论枪锚点伸长。修复前同一运行时探针量到真实掌心端点与枪把相差最多 14.7516px，所以画面仍会表现为枪漂浮在手指前方。

`GameScene._computeGunAnchor()` 现仅对 `PISTOL_FAMILY` 主手计算当前姿态的真实肩点和手臂原生肩到掌心长度，再沿既有瞄准射线把握把锚点径向收回到自然臂长。该处理保留 360° 瞄准方向、左右镜像、双持偏移、瞄准抬升和 walk/run bob，不拉伸手臂，也不影响步枪、散弹枪、机枪。副手继续使用 `gun_idle_dual` 的烘焙手位与独立 `offBase`。

## 运行时复核

所有截图均通过隔离的无头 Edge + CDP 生成，临时浏览器 profile 在探针退出时清理。

| 批次 | 截图数 | 覆盖 | 主枪握把最大误差 | 真实主掌心最大误差 | 副枪握把最大误差 |
|---|---:|---|---:|---:|---:|
| levels | 24 | 12 枪单持 + 同枪双持，水平朝右 | < 0.000001px | 0.010898px | < 0.000001px |
| angles | 10 | Desert Eagle 单/双持，右上/右下/左上/左平/左下 | < 0.000001px | 0.010898px | < 0.000001px |
| locomotion | 15 | 12 枪单持 run + Desert Eagle 单持 walk / 双持 walk / 双持 run | < 0.000001px | 0.485375px | < 0.000001px |

共 49 张运行时截图。站立掌心误差阈值为 0.05px，移动阈值为 0.75px；三个批次均无失败项。移动批次实际进入 `gun_idle_pistol_walklegs`、`gun_idle_pistol_runlegs`、`gun_idle_dual_walklegs`、`gun_idle_dual_runlegs`。

## 交付物

- 静态 Alpha/握把审计：`pistol-grip-alpha-audit.png`
- 单持近景总览：`runtime-single-closeups.png`
- 双持近景总览：`runtime-dual-closeups.png`
- 原始运行时总览与逐张截图：`../../verify-shots/pistol-grip-runtime-20260901/`
- 可复跑探针：`../../cdp-pistol-grip-runtime-review.mjs`（默认 `levels`；可传 `angles` / `locomotion`）
- 已保存报告的确定性阈值复核：`validate-runtime-reports.mjs`

## 美术判断

当前手枪素材的透明内容尺度、枪把位置和握把像素均合格；问题来自运行时肩臂长度与理论枪锚点不一致。重新出图会引入身份和比例漂移，不能解决这个运行时几何根因，因此本轮无需生成或替换手枪美术资产。
