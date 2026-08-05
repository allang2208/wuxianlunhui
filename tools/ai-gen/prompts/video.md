# MiniMax H3 视频提示词模板（2026-08-04 固化，陨星 VFX 首航）

## 模型与管线

- 模型：`fl2va`（文生/图生视频）+ `ref2va`（参考生视频）；Qwen3-VL 32B 编码器；
  视频+音频双 VAE——**音画同一轮扩散生成**（原生立体声，非后期配音），MP4 直出。
- 客户端：`python tools/ai-gen/minimax-h3-gen.py --prompt "..." --duration 2 --size 1344x768 --out ...`
- 参考模式：`MiniMaxH3ReferenceToVideo`，按接入顺序用 `<Picture 1>` / `<Video 1>` / `<Audio 1>`
  标签引用，可锁角色/风格/动作/声音；`ref_image_size=match` 快 / `max` 保真（更慢）。

## 提示词结构（整场描述写在一个块里，顺序固定）

```text
场景 → 分镜（主体动作） → 镜头运动 → 音效
```

范例（陨星 VFX 2s）：

```text
a dark volcanic meteor rock falls diagonally through a dungeon hall, trailing fire and
ember sparks, impact on stone floor with a bright explosion and lava splatter,
camera shakes slightly and stays wide, deep rumble with crackling fire sounds
```

## 参数规范（H3 原生画布）

- 短边 768px、尺寸为 32 的倍数；实测：1344×768、2s（56 帧）≈ 315s（5080 int8）。
- 时长按 **17k+5 网格**（24fps）：2s=56 帧、5s=124 帧。
- 生成中机器休眠会断，需关休眠；产出默认落 `Y:\工作\无尽轮回\scratch\`。

## 用法两条路

- 视频资源：MP4 直入项目 `assets/videos/`（Phaser video key 播放）。
- 精灵序列：PyAV 抽帧 → sprite sheet（动作动画截帧路线）。
