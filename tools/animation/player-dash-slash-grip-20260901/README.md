# 普通冲刺抓握制作源

本目录为2026-09-01普通冲刺的离线分层和轨迹制作，详见 `docs/player-dash-slash-grip-2026-09-01.md`。不包含新生成的人物或视频。

源链：

- `assets/player/dash_attack.png`：17帧512×516。主体和肢体保留原像素，4/5帧仅用第3帧闭拳替换张手，14/15帧仅去掉身体外旧弧线。
- `assets/player/dash_recover.png`：14帧512×512。新收势0引用攻击16，1～12保留原身体并在腕部换已确认拳头，13引用当前待机抓握图。
- `tools/animation/player-sword-walk-grip-20260831/gripping-hand.png`：此前用户确认的抓握切片；原始生成与裁切来源见该目录及其引用。这里不重新生成。
- `data/player-sword-shield-motion.json` 及对应图集：复用已确认的前120ms剑盾入口与回跑尾段，不改原文件。
- `data/player-sword-walk-grip.json` 及对应图集：末帧待机身体/掌层。
- `src/config/player-shield-poses.js`、`shield-config.js`：同一源帧的副手和待机盾挂点，不镜像主手猜测。

`rig.json` 保存最终掌点、腕点、手指遮罩、角度、模糊与仅在手遮罩内使用的腿部像素补齐范围。攻击offsetX按 `(x/512-0.5)*144`，offsetY按 `(y/516-0.5)*144` 换算，不能统一除512。图集中各帧保留自己的源宽高。

在已装Pillow的Python环境中，从仓库根执行：

```powershell
python tools/animation/player-dash-slash-grip-20260901/prepare.py
python tools/animation/player-dash-slash-grip-20260901/build.py --publish-config
```

`prepare.py` 的红点/裁框和 `recover-wrist-*.png` 只用于按需粗定位；最终坐标以 `rig.json` 为准，这些可再生诊断图不纳入Git。`build.py` 写衍生图集、元数据和离线预览；`--publish-config` 额外重写双份weapon配置的独立dashGrip块。运行前保存后续T面板编辑，避免被rig默认值覆盖；旧dash、突击和三段配置不会改写。

完整入口/出口预览使用原800ms攻击、500ms定格、500ms收势，保持回跑相位3；这些是既有规则的演示，不是游戏测试。四剑图中的Knight*只是贴图绑定兼容展示，骑士长剑正常专属技能仍使用已确认突击。预览不模拟世界位移、碰撞、命中停顿和运行时滤镜。
