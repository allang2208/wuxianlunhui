# 蘑菇农场定稿与接入 · 2026-08-31

用户“按你建议继续”接受右侧精修v02（seed130852）。该图由原模型Depth与FLUX.2 Dev标准48步、denoise 0.30生成；完整生成参数和提示词仍在`../refine_48step_corrected_20260830/mushroom_farm/`。本轮只做确定性透明收口，没有再次生成或改变模型。

## 正式素材

- `assets/terrain/mushroom_farm.png`：895×544 RGBA，显示512×311，footOffsetY=153，四周4px透明安全边。
- `assets/ui/building-thumbnails/mushroom_farm.png`：128×64建造卡图，也用于新增科技节点。
- `assets/terrain/lighting/mushroom_farm_{silhouette,projection,height,normal}.png`：四张同源光照图。
- `data/structure-ground-fits.json`：显式strict标定映射512×256；视觉标定不改变4×4碰撞/寻路。`data/environment-lighting-assets.json`登记光照。
- 当前正式透明源为`mushroom_farm_fence_fixed.png`；`mushroom_farm_clean.png`保留为左上围栏修复前的直接输入，`mushroom_farm_body.png`保留为抠图基准。keyed、keyed预览、cutout和fence_alpha可重建中间图已移出活动目录，下方完整命令会依次重新生成；清理/运行时元数据、原模型、Depth、原始精修图与直接输入链均保留。

## 左上栅栏绿幕返修 · 2026-08-31

根据用户反馈，仅清理棚布后方、木桶旁及棚布下方左侧的栅栏开口：在895×544源图的`253,127,319,189`、`65,274,115,300`、`90,265,108,274`、`108,269,118,274`矩形内去除高饱和绿幕（HSV hue 35～75、S≥100），保留灰绿棚布。栏杆之间另以`270,168;280,165;282,169;272,177`小多边形清除淡绿碎点；木杆边缘再在`274,173,286,180`范围内修复12个染绿RGB像素，该替色阶段不改Alpha。

`fence_fix_metadata.json`记录局部透明清理；`fence-before.png`/`fence-after.png`与`fence-canopy-before.png`/`fence-canopy-after.png`是两处同位置4倍放大的棋盘底素材预览，由`preview-fence.py`派生。未重新生图或改模型，仍为895×544、显示512×311、footOffsetY=153；只同步本建筑的正式贴图、缩略图、四张光照图及来源登记。4×4占地、道路、日照产量倍率和其他玩法不变。

## 玩法接线

- 建造入口：B面板农业组；先研究“食用菌栽培”，其前置、成本档与玉米/奶酪栽培相同。“菌业标准化”开放本栋四项升级，不自动完成旧档的新科技。
- 基础4500能源、3600HP、70物防/65魔防、10岗位，每岗位10%最终成品效率。20秒/批、180食物；道路运输时间另计。沿用同档优种、周期、产能、运输四项升级数值。
- 占地4×4；`front_road/i_positive`只生成门侧4格，镜像时换边，不生成中央填路。仍需连接真实仓库，断路/无岗位冻结物流，满仓保留待存成品。
- `farm-production-profile.js`是农场模块身份与位面日照倍率的公共解析器。地牢遗迹scene11、矿洞scene12配置`hasSunlight:false`；地牢类型默认无阳光，其他位面默认有阳光。无阳光×1.5，有阳光×0.5，与普通昼夜无关。矿洞的禁雨配置不变。
- 满员未升级、无其他加成时：无阳光270食物/批，有阳光90食物/批。倍率只乘最终产出，不改变加工时间、岗位、运输或仓容；原天气、酒馆和祭品倍率继续按既有链结算。
- 前台共用`cheese-farm-system.js`；后台`world122-sim.js`调用同一日照入口。`world122-snapshot.js`保存/恢复独立`mushroomFarmModules/Upgrade/Job/OutputRemainder`，包含岗位加权加工量；后台账本和持续升级目标同步登记。
- 菌农只复用现有通用农夫步态与唯一物流任务；生产时隐藏，运输时显示，不生成第二名工作单位。不含新蘑菇搬筐动画，携货量以详情与物流记录为准。

## 制作命令

从仓库根目录运行，仅派生本建筑。绿幕RGB距离48保留灰绿棚布；完整模型Depth的3px容差去掉主体外残余。边缘替色限定Alpha内侧3px，两个清理矩形仅针对育菌棚后方的绿幕空隙，不扩大为全图去绿。

```powershell
$farmPython = '../ComfyUI/.venv/Scripts/python.exe'
$farmRoot = 'tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm'
$farmAccepted = "$farmRoot/accepted_20260831"
& $farmPython tools/ai-gen/key-world122-building-body.py "$farmRoot/refine_48step_corrected_20260830/mushroom_farm/mushroom_farm_refine_v02_raw.png" "$farmAccepted/mushroom_farm_keyed.png" --threshold 48 --remove-enclosed-key --preview "$farmAccepted/mushroom_farm_keyed_preview.png"
& $farmPython tools/ai-gen/mask-world122-building-body.py "$farmAccepted/mushroom_farm_keyed.png" "$farmRoot/mushroom_farm_depth.png" "$farmAccepted/mushroom_farm_body.png" --edge-pad 3
& $farmPython tools/ai-gen/repair-local-green-spill.py "$farmAccepted/mushroom_farm_body.png" "$farmAccepted/mushroom_farm_cutout.png" --rect 0,0,1024,1024 --max-edge-distance 3 --green-margin 35
& $farmPython tools/ai-gen/finalize-building-runtime.py "$farmAccepted/mushroom_farm_cutout.png" "$farmAccepted/mushroom_farm_clean.png" --display-width 512 --clear-green-rect 68,665,136,716 --clear-green-rect 139,669,178,699 --nearest-opaque-edge-rgb --metadata "$farmAccepted/clear_gap_metadata.json"
& $farmPython tools/ai-gen/finalize-building-runtime.py "$farmAccepted/mushroom_farm_clean.png" "$farmAccepted/mushroom_farm_fence_alpha.png" --display-width 512 --clear-green-rect 253,127,319,189 --clear-green-rect 65,274,115,300 --clear-green-rect 90,265,108,274 --clear-green-rect 108,269,118,274 --green-hue-min 35 --green-saturation-min 100 --clear-alpha-polygon '270,168;280,165;282,169;272,177' --metadata "$farmAccepted/fence_fix_metadata.json"
& $farmPython tools/ai-gen/repair-local-green-spill.py "$farmAccepted/mushroom_farm_fence_alpha.png" "$farmAccepted/mushroom_farm_fence_fixed.png" --rect 274,173,286,180 --min-green 30 --green-margin 12
& $farmPython tools/ai-gen/finalize-building-runtime.py "$farmAccepted/mushroom_farm_fence_fixed.png" assets/terrain/mushroom_farm.png --display-width 512 --preserve-alpha-exact --nearest-opaque-edge-rgb --metadata "$farmAccepted/runtime_metadata.json"
node tools/generate-building-preview-assets.mjs --only mushroom_farm
& $farmPython tools/ai-gen/build-lighting-maps.py mushroom_farm
& $farmPython "$farmAccepted/preview-fence.py" "$farmAccepted/mushroom_farm_clean.png" "$farmAccepted/fence-before.png"
& $farmPython "$farmAccepted/preview-fence.py" assets/terrain/mushroom_farm.png "$farmAccepted/fence-after.png"
& $farmPython "$farmAccepted/preview-fence.py" "$farmAccepted/mushroom_farm_clean.png" "$farmAccepted/fence-canopy-before.png" '55,225,130,300'
& $farmPython "$farmAccepted/preview-fence.py" assets/terrain/mushroom_farm.png "$farmAccepted/fence-canopy-after.png" '55,225,130,300'
```

## 文件与用户验收

配置：`data/producer-buildings.json`、`population-economy.json`、`building-upgrades.json`、`technology-tree.json`；位面属性修改双份`game-config.json`。其余三类建筑/经济/科技配置在本工作区只有`data/`导入源，没有另建不存在的public副本。

运行时：`farm-production-profile.js`、`cheese-farm-system.js`、`producer-building-system.js`、`population-economy-system.js`、`tavern-economy-system.js`、`building-system.js`、`world122-sim.js`、`world122-snapshot.js`、`world-background-ledger.js`、`building-continuous-upgrade-state.js`、`hamster-cowherd-visual-system.js`、`technology-system.js`及`GameScene.js`的断路提示。

仅查看本次真实diff与必要消费链；未运行测试、lint、构建或游戏/浏览器验证，按约定由用户测试。重点：科技解锁与升级、镜像门侧道路和遮挡、仓库接通/断开/满仓、两种位面实际入仓量、切场及读档后待存粮/余数/升级不重复。后台继续使用现有农场抽象物流时间，不声称逐帧运输与前台完全等价。未更新固定EXE。
