# 矿洞紫色高能矿脉

用户要求矿洞位面生成同造型紫色矿，按“比普通矿多一倍”设置总储量为2倍。

- 来源：正式蓝色矿堆`assets/terrain/energy_node_rubble_1.png`～`energy_node_rubble_5.png`；上游为已选矮堆3号及五种获准矿脉分布，完整来源见`../runtime/manifest.json`。
- 制作：`../export-high-energy.py`对饱和蓝色矿物做局部RGB调色；不是新一轮AI生成，不修改灰岩造型、画幅、比例或Alpha。
- 输出：`assets/terrain/energy_node_high_energy_1.png`～`energy_node_high_energy_5.png`，均256×143；共享同编号`energy_node_rubble_depleted_*.png`灰岩态。逐图登记见`manifest.json`。
- [五款紫矿及灰岩态预览](high-energy-preview.png)为离线素材联系图，不是游戏截图。
- 已接入`scene12`矿洞建设位面的新生成；其他位面仍蓝色。每矿30000～48000储量，采集速度不变；相同1×1占格和紧凑成簇规则。
- 快照保存`highEnergy`，恢复不再乘倍数；旧档普通矿保留类型及余量，首次生成/重建才使用紫矿，已采空不补矿。

已制作并查看透明素材，未运行测试或运行时验证，按约定由用户测试。未构建或同步EXE。
