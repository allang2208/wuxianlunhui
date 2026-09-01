# 三段普攻抓握制作源（2026-09-01）

本目录是原生精灵的离线分层与轨迹制作，不是游戏测试脚本。详见 `docs/player-sword-combo-grip-2026-09-01.md`。

## 来源

- 原始身体：`assets/player/attack_sword.png`、`attack_sword_2.png`、`attack_sword_3.png`、`recover_sheet.png`。前三段12/12/16帧，recover13帧；源空间512×512，沿用原有帧序。
- recover拳头：`tools/animation/player-sword-walk-grip-20260831/gripping-hand.png`，复用用户此前认可的握拳切片；母图与早期制作来源见该目录记录。没有新ImageGen或MiniMax调用。
- 剑：当前实际四剑装备PNG与 `data/weapon-anim-config.json.sword.textureGrips`。未编辑武器PNG。
- 副手：`src/config/player-shield-poses.js` 中已有源帧轨迹；仅在本次派生数据内修正第三段14/15帧主副手辨认，不覆盖共享原表。

## 可编辑数据

`rig.json` 包含掌心、角度、模糊、局部拳头方向与13帧收势映射。角度为面朝右、贴图剑尖朝上时的顺时针角，0为上、90为右。主手XY是原始512像素坐标；输出offset按 `(point/512 - 0.5) * 144 * 1.0956` 换算。

`original-visual-frames.json` 保留开始制作时旧轨迹，只供来源对照；`visual-frames.json` 是当前输出。攻击身体只清除已有纯绿键色，保留源像素；紧贴原掌心提取前景，避免宽遮罩把肘部/躯干盖到剑前。recover仅旧手指局部替换为已确认拳头，不改肩、腿或全身缩放。

收势映射按原recover帧索引选择现有源姿态，不对身体形变插值，不新增状态时钟。一二段起点分别复用自己的末帧，第三段末主手226,259接recover首帧227,259。

## 再制作

使用已装Pillow、numpy的Python运行：

```powershell
python tools/animation/player-sword-combo-grip-20260901/prepare.py
python tools/animation/player-sword-combo-grip-20260901/build.py --publish-config
```

`prepare.py` 按需导出带坐标的源帧/手部诊断图，这些图可由正式源和rig重建，不纳入Git。`build.py` 生成两页PNG/JSON、运行时元数据、重置默认值、各段含recover预览、连续三段GIF和联系图，不再生成被完整预览覆盖的分段纯攻击GIF。即使不传 `--publish-config` 仍会写图集与元数据；该开关只控制双份weapon配置的三个独立Grip块。再制作前保留用户后续在T面板调整的Grip块；脚本会按rig重写这些显示轨迹，不改旧战斗块。

GIF显示四剑双朝向；连续连段不插入可选hold，单段收势从combat-config读取既有hold/recover时长。只展示离线原始帧、握把和遮挡，不模拟盾贴图、命中停顿、根位移或GPU模糊，不代表运行时验收。
