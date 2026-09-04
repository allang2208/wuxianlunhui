# 单剑空手奔跑：自然握拳切片

2026-08-31按用户要求微调手指与掌部，不改变已确认的屈肘摆动。`generated-fist.png`是内置image_gen原始RGBA输出；编辑输入为原`parts/offHand.png`，辅参考`parts/offForearm.png`，实际提示词与来源记录分别保存在`prompt.txt`、`provenance.json`。

原始生成图含多余的长骨部分，未使用它重画前臂。`prepare_part.py`只裁取记录的拳头区域，缩小到18×21像素并接回原34×105前臂切片，原切片0～75行直接保留。新图`offForearm-fist.png`仍使用原肘部pivot和腕点，只有拳头中心参考改为源坐标(325,263)，用于空手关节点记录；不改变任何装备握点。

`../rig.json#offForearmPart`仅供单剑空副手奔跑导出器消费；原共用切片、持盾副臂和主剑握持手不覆盖。所有8帧使用`../rig.json`当前角度表和原生10FPS时钟，图集尺寸1448×1002不变。原张手切片保留，去掉该配置即可回到原切片导出。

从仓库根目录重新制作切片后，再执行已有单剑导出器：

```powershell
& 'C:\Users\allan\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools/animation/player-sword-shield-run-20260831/solo-run/fist/prepare_part.py
& 'C:\Users\allan\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools/animation/player-sword-shield-run-20260831/export_solo_runtime.py
```

`part-detail.png`为原张手/新握拳的局部像素放大展示，`../four-swords-both-directions.gif`为导出的四剑双朝向循环。它们是离线合成素材，不是游戏截图。未运行测试或运行时验证，按约定由用户测试；重点看小尺寸拳头辨识度、腕部接缝和双朝向遮挡。未改JS、战斗数值或EXE。
