"""Inspect only the four rebuilt mosquito animations and export comparison GIFs."""
from pathlib import Path
import json

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "alpha-repair-20260830"
ACTIONS = ["idle", "walking", "attacking", "dying"]


def cells(path, report):
    sheet = np.array(Image.open(path).convert("RGBA"))
    width, height, cols = report["frameWidth"], report["frameHeight"], report["cols"]
    return [sheet[(i // cols) * height:(i // cols + 1) * height,
                  (i % cols) * width:(i % cols + 1) * width]
            for i in range(report["outputFrameCount"])]


def stats(frame):
    rgb = frame[..., :3].astype(np.int16)
    alpha = frame[..., 3]
    dark = (alpha > 3) & (alpha < 96) & (rgb.max(axis=2) < 24)
    count, _, components, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), 8)
    border = np.concatenate([alpha[:8].ravel(), alpha[-8:].ravel(),
                             alpha[:, :8].ravel(), alpha[:, -8:].ravel()])
    return {
        "visiblePixels": int((alpha > 3).sum()),
        "translucentPixels": int(((alpha > 3) & (alpha < 240)).sum()),
        "lowAlphaDarkPixels": int(dark.sum()),
        "largestLowAlphaDarkComponent": int(components[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0,
        "blueExcessPixels": int(((alpha > 3) & (rgb[..., 2] > np.maximum(rgb[..., 0], rgb[..., 1]) + 18)).sum()),
        "cyanExcessPixels": int(((alpha > 3) & (rgb[..., 1] > rgb[..., 0] + 18)
                                  & (rgb[..., 2] > rgb[..., 0] + 18)).sum()),
        "greenSpillPixels": int(((alpha > 3) & (rgb[..., 1] > rgb[..., 0] + 12)
                                  & (rgb[..., 1] > rgb[..., 2] + 12)).sum()),
        "yellowFringePixels": int(((alpha > 3) & (alpha < 240)
                                    & (rgb[..., 0] > rgb[..., 2] + 50)
                                    & (rgb[..., 1] > rgb[..., 2] + 50)
                                    & (rgb[..., 1] > rgb[..., 0] - 25)).sum()),
        "dirtyTransparentPixels": int(((alpha == 0) & (rgb.max(axis=2) > 0)).sum()),
        "borderPixels": int((border > 3).sum()),
    }


def composite(frame, color):
    image = Image.fromarray(frame).resize((frame.shape[1] // 2, frame.shape[0] // 2), Image.Resampling.LANCZOS)
    base = Image.new("RGBA", image.size, color)
    base.alpha_composite(image)
    return base.convert("RGB")


def preview(old, new, name, rate, dest):
    comparisons, fixed = [], []
    width, height = new[0].shape[1] // 2, new[0].shape[0] // 2
    for index, (before, after) in enumerate(zip(old, new)):
        pair = Image.new("RGB", (width * 2, (height + 24) * 2), "#20262c")
        clean = Image.new("RGB", (width * 2, height + 24), "#20262c")
        draw, clean_draw = ImageDraw.Draw(pair), ImageDraw.Draw(clean)
        for row, color in enumerate(["#eee9df", "#74976b"]):
            y = row * (height + 24)
            draw.text((8, y + 5), f"{name} {index:02d} BEFORE", fill="white")
            draw.text((width + 8, y + 5), f"{name} {index:02d} FIXED", fill="white")
            pair.paste(composite(before, color), (0, y + 24))
            pair.paste(composite(after, color), (width, y + 24))
            clean_draw.text((row * width + 8, 5), f"{name} {index:02d} FIXED", fill="white")
            clean.paste(composite(after, color), (row * width, 24))
        comparisons.append(pair)
        fixed.append(clean)
    # GIF timestamps are quantized to 10 ms; distribute rounding over the cycle.
    durations = [10 * (round((i + 1) * 100 / rate) - round(i * 100 / rate)) for i in range(len(new))]
    for frames, filename in [(comparisons, "before-after.gif"), (fixed, "fixed-light-green.gif")]:
        frames[0].save(dest / filename, save_all=True, append_images=frames[1:],
                       duration=durations, loop=0, disposal=2)
    columns = 4
    thumb_width = width
    thumb_height = height + 24
    contact = Image.new("RGB", (columns * thumb_width, ((len(fixed) + columns - 1) // columns) * thumb_height), "#20262c")
    for index, frame in enumerate(fixed):
        contact.paste(frame.crop((0, 0, width, thumb_height)),
                      ((index % columns) * thumb_width, (index // columns) * thumb_height))
    contact.save(dest / "all-frames-light.png")


def main():
    (OUT / "inspection.json").unlink(missing_ok=True)
    report = {"scope": "mosquito sprite assets only; no game/runtime testing", "frameCount": 0, "actions": {}}
    for name in ACTIONS:
        dest = OUT / name
        source = json.loads((dest / "source.json").read_text(encoding="utf-8"))
        before_source = json.loads((OUT / "before" / f"{name}-source.json").read_text(encoding="utf-8"))
        meta = json.loads((dest / "rife.json").read_text(encoding="utf-8"))
        before_meta = json.loads((OUT / "before" / f"{name}-rife.json").read_text(encoding="utf-8"))
        old = cells(OUT / "before" / f"{name}-final.png", before_meta)
        new = cells(dest / "final.png", meta)
        unchanged_placement = all(source[key] == before_source[key] for key in ["scale", "targetCore", "coreCenters", "anchorMode", "sourceFrames"])
        unchanged_timing = all(meta[key] == before_meta[key] for key in ["outputFrameCount", "outputFrameRate", "frameWidth", "frameHeight", "cols", "rows", "mode"])
        if not unchanged_placement or not unchanged_timing:
            raise RuntimeError(f"{name}: approved placement or timing changed")
        validation = meta["validation"]
        if (not validation["originalKeyFramesPreservedAtEvenIndices"]
                or any(validation[key] for key in ["emptyFrames", "touchingFrames", "visibleDarkOutlierFrames", "middleFrameHeldSourceKeyFallbacks"])):
            raise RuntimeError(f"{name}: interpolation damaged a key frame or generated an invalid frame")
        after_stats = [stats(frame) for frame in new]
        if any(frame[key] for frame in after_stats for key in ["blueExcessPixels", "cyanExcessPixels", "greenSpillPixels", "yellowFringePixels", "dirtyTransparentPixels", "borderPixels"]):
            raise RuntimeError(f"{name}: residual chroma/transparent RGB/frame-border contamination")
        preview(old, new, name, meta["outputFrameRate"], dest)
        report["actions"][name] = {"frameCount": len(new), "placementPreserved": unchanged_placement,
                                    "timingAndGridPreserved": unchanged_timing,
                                    "before": [stats(frame) for frame in old], "after": after_stats,
                                    "interpolation": meta["validation"]}
        report["frameCount"] += len(new)
        print(f"{name}: {len(new)} frames; background comparison exported", flush=True)
    (OUT / "inspection.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
