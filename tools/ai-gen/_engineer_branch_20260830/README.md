# 工程师建筑系列：当前已接入源码游戏

2026-08-30 用户要求继续导入后，三档正式RGBA、光照派生图、缩略图、逐级视觉占地和三级科技支线已入库。入口：`runtime/runtime-index.json`，交付预览：`runtime/engineer-branch-runtime-lineup.png`，完整说明：`../../../docs/engineer-building-branch-design.md`。三档兵种投石组/野战炮组/榴弹炮组均已接入共享开发源码，科技位于军事指挥独立工程器械行；载具工厂显式要求黑火药；未打包固定EXE，未运行测试或运行时验证，按约定由用户测试。

本目录保留模型、原始48步图、局部修正来源与制作参数。下方为各阶段历史记录，其中等待确认/未入库描述不再代表当前状态。

# 工程师建筑系列候选

本目录仅为建模、科技设计及建筑生成候选交付，不是游戏资源目录。用户已明确授权向`192.168.3.142:8188`发送本系列素材，并于2026-08-30确认按建议选择营地第二批03、工坊01、工厂03继续48步。标准12步首批9张与营地材质纠偏3张均保留；48步批次每档2张，尚无正式入库授权。

- `manifest.json`：三档尺寸、相机、调色板和地台材质类型。
- `technology-branch.draft.json`：科技前置、位置和科研点设计；`plannedUnlocks`不是运行时解锁注册。
- `engineer_branch_model_approval_preview.png`：三档同尺度总览。
- `engineer_camp/`、`engineering_workshop/`、`vehicle_factory/`：独立可编辑模型、原始透明预览、白模确认预览、完整Depth和生成日志。
- 设计说明：`../../../docs/engineer-building-branch-design.md`。
- `candidate-manifest.json`：本系列独立生成配置；标准`world122-building-v5`、FLUX.2 Dev + Depth、1024²、CFG 3.5、Euler/simple，每档3张12步候选，Depth 0.78。
- `prompts_s12/`：由标准入口原样组装的三档完整提示词；`prepare-structure-prompts.py`只在本地准备文字，不连接生成服务。
- `generation-s12.log`：端口说明更正前首个请求的日志；`generation-s12-resumed.log`为明确授权后的续跑日志。manifest显式登记`port:8188`，生成器也显式传递该端口。
- `recovered-first-job.json`：首张已完成任务`22d98ca5-99a0-4366-9e94-5913935d5e86`的来源；仅按本次Depth文件名与seed122831查找并下载对应图，没有取消、清空或修改共享队列。
- `publish-structure-candidates.py`：将九张完整raw排成三级总览与每级三选一联系图，同时登记`candidate-index.json`；不修改主体或执行抠图。
- `previews/engineer-branch-structure-candidates-s12.png`：当前三级九选联系图；每档独立大图也在该目录。
- `structure-review.md`：逐张可见偏差、建议方向与下一阶段门禁。建议营地第二批03、工坊01、工厂03，建议不等于用户选择或结构验收。
- `candidate-manifest-camp-v2.json`、`generation-s12-camp-v2.log`：营地全高皮革围护纠偏批次的独立提示词、seed和生成记录；第一批营地仍保留。
- `candidate-manifest-refine-v1.json`、`run-refine-batch.py`、`generation-s48-v1.log`：用户选定三张完整raw的48步低重绘批次；固定原Depth、Depth 0.75、denoise 0.30、CFG 3.5、Euler/simple，每档2张，候选输出`candidates_dev_s48_v1/`。
- `publish-refine-candidates.py`：将每档已选12步原图与两张48步候选并排；只排版完整raw，不执行抠图、修图、缩放标定或运行时写入。
- 48步六张已完成：总览`previews/engineer-branch-refine-candidates-s48.png`，索引`refine-candidate-index.json`，观察与遗留问题`refine-review.md`。建议营地02、工坊01、工厂01作为后续局部处理方向，尚未自动定稿。
- 用户随后已确认按营地48步02、工坊01、工厂01继续局部修正。`candidate-manifest-local-v1.json`与`local-repair.py`登记局部蒙版、源图和参数；原48步图保留，局部修正不等于正式入库授权。
- `local_repair_v1/`保留每档两张蒙版生成raw与蒙版合成raw。`remove-extra-details.py`仅对仍未去掉的附件做单目的小范围试验，来源和局部蒙版在`local_repair_v2_removal/`独立登记。
- `finish-local-materials.py`恢复原48步齿轮几何，只在局部黄铜像素调整色彩；营地右立柱另用显式多边形调整RGB，保留原轮廓、明暗和相邻地面。`publish-local-repairs.py`只展示经查看后选出的修正版。
- 三档局部修正已完成：`previews/engineer-branch-local-repair-lineup.png`为总览，`previews/engineer-branch-local-repair-comparison.png`为前后对照。唯一当前修正版及来源链登记在`local-repair-index.json`，细节与保留差异见`local-repair-review.md`。工厂去箱生成试验未采用，最终通过`repair-factory-wall-pixels.py`做同图局部墙面纹理修补；原图和取样位置均保留。修正版仍待用户接受，未抠图或入库。
- 48步六张已完成：总览`previews/engineer-branch-refine-candidates-s48.png`，索引`refine-candidate-index.json`，观察与遗留问题`refine-review.md`。建议营地02、工坊01、工厂01作为后续局部处理方向，尚未自动定稿。

模型由本项目参数化代码原创装配，未下载第三方模型；图像通过上述已授权局域网服务的FLUX.2 Dev + Depth生成。基础件来源`building-component-kit.py`，装配与渲染接口来源`settlement-building-pack-blender.py`。全套不烘焙人物或整车。

在仓库根目录重建模型（离线资产制作命令，不启动游戏）：

```powershell
$root = Join-Path (Get-Location) 'tools/ai-gen/_engineer_branch_20260830'
foreach ($assetId in @('engineer_camp','engineering_workshop','vehicle_factory')) {
    $out = Join-Path $root $assetId
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    & 'E:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python tools/ai-gen/engineer-building-branch-blender.py -- (Join-Path $root 'manifest.json') $assetId (Join-Path $out ($assetId + '_model.blend')) (Join-Path $out ($assetId + '_model_preview.png')) (Join-Path $out ($assetId + '_depth.png'))
    if ($LASTEXITCODE -ne 0) { throw "Model production failed: $assetId" }
}
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/publish-engineer-branch-preview.py
```

上述模型重建不调用ComfyUI，Python只使用本地Pillow排版模型总览。标准候选生成使用现有完整Depth，不重建或更换模型；专用`engineer_compound`类别保留开放作业口、吊架、工具台和标志，避免通用封闭建筑提示与现代工厂/营地冲突。

用户已明确授权`192.168.3.142:8188`，首个任务已取回并按raw存在跳过。续跑命令如下（仅12步完整绿底候选，不抠图或入库）：

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_engineer_branch_20260830/candidate-manifest.json --stage structure --raw-only
```

首批每档3张，共9张，保存在`candidates_dev_s12_v1/`；营地纠偏3张保存在`candidates_dev_s12_camp_v2/`，每张raw旁保留生成元数据。营地第二批仅修改材质区域提示词，仍使用原模型Depth和相同标准采样参数。`candidate-manifest.json`的`reviewOutputRoot`只切换展示来源，不覆盖首批生成参数。当前用户已明确选择12步raw并要求继续48步，旧12步联系图上的“尚未选稿”为当时状态；最新选择记录见manifest与候选索引。不能期待低denoise精修自动修复门窗、吊具或新增附件，48步生成不等于这些偏差已经达标。最终正式贴图还需选择、抠图与逐级占地标定。

继续/重建本轮精修批次（已存在raw由标准入口跳过，不覆盖原12步图）：

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_engineer_branch_20260830/run-refine-batch.py
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_engineer_branch_20260830/publish-refine-candidates.py
```

未运行测试或运行时验证，按约定由用户测试。只进行了资产生成与完整raw的离线查看、排版；没有执行抠图、占地标定或游戏检查。候选的绿幕梯度、外部阴影、门窗和吊架偏差仍待处理，不证明最终材质或游戏内遮挡已验收。
