# 贸易公司：首版模型12步结构候选

后续确认：用户“102 更好。把门口上的招牌换成异形文字。”本轮已按02解释并完成[仅牌面异形文字修订](../trading_sign_alien_20260901/README.md)。02偏好覆盖下文01推荐，原货仓入口、门廊和所有其余像素保留；历史观察不再作为主动返修其他部分的指令。

2026-09-01用户要求“接下来帮我针对贸易公司生图”。沿用已有首版模型及完整Depth，按建筑标准生成三张结构候选；未重新建模，不改燃油厂/罐头厂透明定稿。

三张已完成并逐张打开查看，**建议以01作为局部修正基础**，尚未通过48步准入：01保留原货仓窄端入口和平门廊，02/03把货仓门移到另一侧。三张都缺原货仓侧窗、门廊偏亮；01另有明显外投影，不能靠抠图隐藏结构偏差。详见`review.json`。

## 模型与参数

- [模型预览](../trading_company/trading_company_model_approval_preview.png)、[Blender模型](../trading_company/trading_company_model.blend)、[完整Depth](../trading_company/trading_company_body_depth.png)。结构源为上层`build-models.py`及`manifest.json`的`trading_company`；245个独立建模对象，相机俯角30°、建筑Z轴44.8°。
- 模型为三层对齐办公楼、双坡屋顶、左侧单层货仓与双坡低屋顶、两处敞门、两只货箱、四柱门廊及货箱外运箭头徽记；前面两柱最显眼。完整毛石地台表达拟定4×4体量，不代表已经接入逻辑占格。
- 本批提示误称四坡屋顶/双柱门廊；已回查装配源的`gabled_prism`和四根`PorticoColumn`并记录更正。实际使用过的manifest提示字段、prompt和生成参数保留原样，不倒写历史；后续局部修正使用正确屋顶/柱数，并恢复货仓侧窗，不能直接复用误句。
- 标准入口`generate-world122-building-candidates.py --stage structure --raw-only`：`flux2-dev-depth`、`world122-building-v5`、1024²、12步、Depth0.78、CFG3.5、Euler/simple、3张；不用局部蒙版、双路边缘控制或非标准覆盖。
- 唯一公共画风完整注入一次，资产提示仅补三层与货仓拓扑、门廊/货箱/徽记和局部材质。低饱和矿物灰墙、浅砂石线脚、蓝灰屋顶、暗青玻璃、磨损木货箱和克制的旧铜门廊；纯绿背景方便后续抠图。
- 仅向既有授权目的地`http://192.168.3.142:8188`发送本栋Depth、提示和参数。提交前观察到1个运行任务、0个待执行任务；正常排队，不清空、抢占或终止其他任务。

## 原图与来源

| 候选 | 实际种子 | 完整原图 |
| --- | --- | --- |
| 01 | 133231 | 未选raw已清理；生成元数据保留 |
| 02 | 133232 | [raw](trading_company/trading_company_structure_v02_raw.png) |
| 03 | 133233 | 未选raw已清理；生成元数据保留 |

实际参数以各图`*_generation.json`为准。保留`*_structure_prompt.txt`与完整控制Depth副本；日志已清理。边缘参考虽由标准入口派生，但本批未启用边缘控制。`present.py`可从现存raw重建排版，不抠图、改色或以Depth遮掉偏差。

[逐张说明](review.json)继续保存判退理由；完整对照页与联系图已在最终归档时清理。

## 重建命令

从项目根目录执行。已有raw由标准入口复用，勿为刷新对照重复提交生成任务。

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_industrial_economy_buildings_20260831/trading_candidates_dev_s12_20260901/manifest.json --stage structure --only trading_company --raw-only
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_industrial_economy_buildings_20260831/trading_candidates_dev_s12_20260901/present.py
```

本轮只交付12步候选，选定后按项目管线继续48步；未提前抠透明、制作运行时光照图/缩略图或正式入库。未改科技、经济结算、逻辑占格、碰撞、寻路或存档。未运行测试或运行时验证，按约定由用户测试；未构建、同步EXE、提交或推送，保留并行会话修改。
