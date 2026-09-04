"""Create directly viewable delivery comparisons from the produced sprite sheets."""
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("beetle_delivery", ROOT / "rebuild.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
config = build.read(ROOT / "source-config.json")
manifest = build.read(ROOT / "manifest.json")
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)

for state in ("charge", "walk"):
    original_layout = config[build.KING]["textures"]["frameLayouts"][state]
    filename = Path(config[build.KING]["textures"][state]).name
    old = build.extract(ROOT / "original" / build.KING / filename, original_layout)
    entry = manifest["actions"][f"{build.KING}/{state}"]
    current = build.extract(ROOT / entry["path"], entry["layout"])
    left, top, _, _ = entry["source"]["crop"]
    restored = []
    for cell in current:
        canvas = Image.new("RGBA", (original_layout["frameWidth"], original_layout["frameHeight"]))
        canvas.paste(Image.fromarray(cell), (left, top))
        restored.append(np.asarray(canvas).copy())
    union = np.any(np.stack([cell[..., 3] > 3 for cell in old + restored]), axis=0)
    ys, xs = np.where(union)
    box = (max(0, int(xs.min()) - 12), max(0, int(ys.min()) - 12),
           min(old[0].shape[1], int(xs.max()) + 13), min(old[0].shape[0], int(ys.max()) + 13))
    w, h = box[2] - box[0], box[3] - box[1]
    frames = []
    for before, after in zip(old, restored):
        canvas = Image.new("RGBA", (w * 2, h + 36), (51, 55, 61, 255))
        for i, cell in enumerate((before, after)):
            canvas.alpha_composite(Image.fromarray(cell).crop(box), (i * w, 36))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 6), "修复前", font=font, fill="white")
        draw.text((w + 12, 6), "修复后 · 相同尺寸与脚点", font=font, fill="white")
        draw.line((w, 0, w, h + 36), fill=(95, 100, 105))
        frames.append(canvas.convert("RGB"))
    duration = original_layout.get("duration", len(frames) * 1000 / original_layout.get("frameRate", 15))
    exact = [900 / 12] * 12 + [1000 / 12] * 12 + [500 / 7] * 7 if state == "charge" else [duration / len(frames)] * len(frames)
    durations, cumulative, end = [], 0.0, 0
    for ms in exact:
        cumulative += ms
        next_end = round(cumulative / 10) * 10
        durations.append(max(10, next_end - end))
        end = next_end
    frames[0].save(ROOT / "previews" / f"{state}-before-after.gif", save_all=True,
                   append_images=frames[1:], duration=durations, loop=0, disposal=2)

names = {"idle": "待机", "walk": "移动", "attack": "横扫", "charge": "冲锋", "summon": "召唤",
         "phase_open": "开鞘", "enraged_idle": "开鞘待机", "dying": "死亡"}
gallery = ["# 独角仙王八动作预览（2026-08-30）", "",
           "离线素材预览，不是游戏录像；一次性动作的GIF为方便查看而循环，游戏内不循环。", "",
           "[冲锋前后对比](previews/charge-before-after.gif) · [移动前后对比](previews/walk-before-after.gif)", "",
           "| 动作 | 帧数 | 原视频 | 预览GIF | 全帧联系图 | 正式图集 |", "|---|---:|---|---|---|---|"]
for state, name in names.items():
    entry = manifest["actions"][f"{build.KING}/{state}"]
    video = Path(entry["source"]["sourceVideo"]).name
    runtime = config[build.KING]["textures"][state]
    gallery.append(f"| {name} | {entry['layout']['frameCount']} | [MP4](../_rotbog_rhinoceros_beetle_king_20260828/videos/{video}) | [GIF](previews/{state}.gif) | [PNG](previews/{state}.png) | [PNG](../../../{runtime}) |")
gallery += ["", "源视频自身的快速摆动软化仍保留；没有逐帧重绘或全图锐化。", "",
            "[修复报告](../../../docs/rotbog-beetle-full-repair-2026-08-30.md) · [生产清单](manifest.json)", ""]
(ROOT / "preview-index.md").write_text("\n".join(gallery), encoding="utf-8")
