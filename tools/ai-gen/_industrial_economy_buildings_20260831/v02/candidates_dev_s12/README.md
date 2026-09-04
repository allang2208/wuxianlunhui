# 燃油发电厂与罐头加工厂：12步结构选稿

模型确认：用户“可用，进行12步生图”，对应当前v02燃油厂和罐头厂。贸易公司不在本批范围；模型、相机和完整地台Depth均未重建。

本批采用项目标准 `generate-world122-building-candidates.py --stage structure --raw-only`，FLUX.2 Dev + Depth，12步、每栋3张、1024×1024、CFG 3.5、Euler/simple、Depth强度0.78。边缘图只派生用于观察，未作为第二路控制上传；未开启非标准参数。

## 选稿文件

六张均已生成并逐张查看。当前建议**燃油厂01、罐头厂01仅作为修正参考**，未自动选定，均未通过直接48步准入：

| 建筑 | 主要观察 |
|---|---|
| 燃油厂 | 三张均保留两层、敞口烟囱与双油罐；01入口更接近敞开，但徽记拆分。02/03门被关闭，03另增圆窗。三张油罐偏亮，材料纹理及地台外投影需要处理。 |
| 罐头厂 | 01保留罐装线与成品罐，最接近用途；但三张都把立体罐头门标变成平面牌并生成伪文字。02另加屋顶天窗；02/03把成品改成蔬果并增加标牌或箱子。 |

- 最终选稿后已清理六图对照页及未选raw；燃油01、罐头01作为后续直接编辑祖先继续保留，对照页可由 `present-candidates.py` 重建。
- [燃油发电厂联系图](oil_power_plant_contact_sheet.png)：01/02/03，seed分别为133111/133112/133113。
- [罐头加工厂联系图](cannery_contact_sheet.png)：01/02/03，seed分别为133121/133122/133123。
- `review.json`：逐张观察、偏差及待选状态；建议仅用于帮助用户判断，不代表自动选定。
- 两个建筑子目录内：获选01的`*_raw.png`是后续直接编辑真源，三次生成的`*_generation.json`记录实际参数，`*_prompt.txt`保存完整实际提示词，`*_depth.png`是本批上传控制图，`*_edge.png`仅为本地派生观察图。
- 参数及资产说明：[candidate-manifest.json](../candidate-manifest.json)。日志已清理；联系图和HTML可由上一层 `present-candidates.py` 重建。

所有原图保持完整绿底，联系图仅等比缩放排版，没有抠图、裁掉主体、改色、局部修图或用Depth遮罩掩盖AI偏差。绿底及其可能出现的投影不是已验收Alpha。

## 复现与阶段边界

在仓库根目录使用以下命令。已存在raw会被复用，不重复提交；不得清理原图后无授权重抽，也不得加入48步命令：

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_industrial_economy_buildings_20260831/v02/candidate-manifest.json --stage structure --only oil_power_plant cannery --raw-only
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_industrial_economy_buildings_20260831/v02/present-candidates.py
```

上传只包含两栋本批Depth、提示词和工作流参数，目的地沿用已授权的 `http://192.168.3.142:8188`。没有上传游戏代码、存档或无关文件，没有清空、抢占或中断共享队列。

`industrial_economy`类别仅去除旧通用模板对管道/机械/功能标牌的冲突要求，继续使用完整v5公共画风与毛石地台合同，不改变其他建筑类别。

12步是选稿阶段，不是正式成品。候选需由用户另行选择；有明显结构或画风偏差的图不能直接作为48步定稿依据。未运行测试或运行时验证，按约定由用户测试；未改游戏逻辑、正式assets或EXE，未提交或推送。
