# 近代募兵建筑连续制作

用户最新指令：“继续，做完以后下一个”。按既有顺序先军营V2、再靶场；侦察营地减影定稿和市政建筑已完成部分不改。

本次已准备两栋的12步manifest和完整公共画风提示词，以及共用 `continue_recruitment.py` 阶段入口。延续本系列已用的标准Dev+Depth、1024²、12步3张→人工查看原图并由助手选稿→48步2张→透明处理。用户本次委托连续推进，后续候选由助手按既定结构、低饱和、弱投影和完整开口标准选择；不会把助手选择伪记为用户逐张确认。所有输出仍留在本目录，不接入运行时。

## 当前进度

| 建筑 | 模型 | 12步 | 48步与透明处理 |
|---|---|---|---|
| 侦察营地 | 已完成 | 已完成 | 减影版已获用户确认，保持不变 |
| 军营V2 | 已确认帐篷＋单塔设计 | 两批共6张；B02-03经局部修正，修正版已查看 | 补充许可已获同意；两张48步完成，助手选01；896×744透明候选已完成 |
| 靶场 | 沿用现有材质模型及三靶布局 | B01误加塔楼、B02封堵通道，均不晋级；B03-03由助手选定 | 两张48步已完成，助手选01；887×618透明候选及预览已完成 |

## 已准备的具体载荷

目的地为既有局域网ComfyUI `http://192.168.3.142:8188`。12步只发送对应建筑的Depth PNG、完整提示词和参数；48步再发送从该建筑12步结果选出的完整raw PNG和同一Depth。图像及提示词会离开当前电脑，由该局域网服务接收。不发送Blender模型、项目源码、存档、无关图片或其他目的地，不安装游戏素材。

- 军营V2：[模型预览](infantry_barracks_tent_v2/industrial_barracks_model_approval_preview.png)、[Depth](infantry_barracks_tent_v2/industrial_barracks_depth.png)、[12步清单](infantry_barracks_tent_v2/structure_s12_b01/manifest.json)、[完整提示词](infantry_barracks_tent_v2/structure_s12_b01/prepared-prompt.txt)。
- 靶场：[模型预览](rifle_range/rifle_range_material_approval_preview.png)、[Depth](rifle_range/rifle_range_depth.png)、[12步清单](rifle_range/structure_s12_b01/manifest.json)、[完整提示词](rifle_range/structure_s12_b01/prepared-prompt.txt)。

先前提交因新载荷缺少明确授权而在进程启动前被拦截。用户现已对上述两栋、目的地及12/48步载荷明确回复“同意”，许可见 `continuation-network-authorization.json`；已从原标准入口启动军营12步，不需要再次询问同一已授权范围。历史拦截保留在军营manifest，没有通过其他工具或中转服务绕过。

**新增派生图许可边界已解决：** 军营B02-03经过本地局部编辑并等比恢复到1024画布后，48步输入变成 `infantry_barracks_tent_v2/structure_local_fix/barracks_structure_corrected_init_1024.png`。第一次提交因缺少这张派生图的明确许可而在进程启动前被拦截，当时没有上传或生成48步。用户随后明确回复“同意”，补充许可见 `infantry_barracks_tent_v2/refine_s48_b02/corrected-init-network-authorization.json`。已从同一原入口、向同一局域网成功上传该图并生成两张48步。拦截记录保留为已解决历史，没有绕过安全审查。

## 阶段入口（历史流程说明）

1. 运行 `continue_recruitment.py barracks --run` 生成3张12步原图，逐张查看后明确选择编号与理由。
2. 以该编号运行 `continue_recruitment.py barracks --stage refine --select <编号> --selection-reason <理由> --run`，保留原始父图与两张48步结果；再按新raw实测阈值完成建筑专用抠图、细栏杆与弱投影处理。
3. 军营完成后，以同样顺序运行 `range`。不能在未生成或未查看候选时预填选稿，也不能用旧Depth硬切偏移后的细构件。

## 当前交付

- [两栋并列预览](continuation_delivery_preview.png)：当前军营48步01与靶场48步01透明候选，等比展示不等于游戏内标定。
- 靶场已完成：`rifle_range/refine_s48_b03/README.md`。实际来源为12步B03-03→48步01→专用key与3个1px针孔修复→边缘去绿→原像素紧裁。前侧通道、三靶、单棚顶保留；毛石地台左侧轮廓较白模粗糙，已披露。
- 军营已完成：`infantry_barracks_tent_v2/refine_s48_b02/README.md`。来源为12步B02-03→局部结构修正→恢复1024画幅→标准48步两张→助手选01→专用透明处理。栏杆、交叉撑与梯级3个小区域的101个残绿像素只修RGB，Alpha不变；原生896×744透明图及细节预览已完成。旧1254²结构透明草稿继续作为历史来源保留。
- 两栋均由助手按连续制作委托选稿，不伪记为用户逐张验收。当前美术候选制作完成；没有自动开展新建筑外发、替换正式贴图或游戏内标定。本轮靶场原图、透明图和选稿记录均保持不变。
- 本次工具改动限于候选目录内的阶段编排、离线预览与抠图生产脚本，以及公共生成器的 `industrial_training_range` 专用提示词分支；其他会话改动保留，没有全局清理或提交。

没有修改运行时贴图、模型几何、科技、兵种、逻辑占格、碰撞、寻路或存档。未运行测试或运行时验证，按约定由用户测试；未构建或同步EXE。
