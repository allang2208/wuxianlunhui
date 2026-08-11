# 恶魔洞窟铁闸门视频提示词（2026-08-11，MiniMax H3）

> 目标：demon_gate 16 帧开关门动画（首帧关闭、末帧打开）。走门闸标准管线
> （H3 视频 → door-video-frames.py 切 16 帧 → 4×4 打包）。

## 视频提示词（场景 → 分镜 → 镜头 → 音效）

```text
a dark dungeon mine cavern passage sealed by a heavy iron portcullis gate,
the iron gate slowly rises upward, revealing a dark rocky passage behind,
camera static and centered on the gate, dark rough rock walls around the
opening, dim flickering torchlight, metallic clanking and grinding sounds
```

## 参数

- `--duration 4`（0~4.05s 取 16 帧：首帧关、末帧开）、`--size 1344x768`。
- 产出 Y:\工作\无尽轮回\scratch\，切帧后按门闸素材管线（抠图/对齐/warp）入库。
