#!/usr/bin/env python3
"""Run the Hollow Ovum geometry audit on one regenerated H3 candidate."""

from __future__ import annotations

import argparse
import json
import runpy
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


TASK = Path(__file__).resolve().parent
AUDIT_LIB = TASK / "audit-orientation-size-deformation.py"
SAMPLES = [0, 16, 32, 48, 64, 80, 96, 112, 123]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action", required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()

    lib = runpy.run_path(str(AUDIT_LIB))
    decode = lib["decode"]
    measure = lib["metrics"]
    frames = decode(args.video)
    if len(frames) != 124:
        raise RuntimeError(f"expected 124 frames, got {len(frames)}")
    entries = []
    for index, rgb in enumerate(frames):
        entry, _ = measure(rgb)
        entry["frame"] = index
        entries.append(entry)
    baseline = entries[0]
    for entry in entries:
        entry["widthRatio"] = round(entry["width"] / baseline["width"], 4)
        entry["heightRatio"] = round(entry["height"] / baseline["height"], 4)
        entry["areaRatio"] = round(entry["area"] / baseline["area"], 4)
        entry["centerDeltaX"] = round(entry["centerX"] - baseline["centerX"], 3)
        entry["bottomCenterDeltaX"] = round(entry["bottomCenterX"] - baseline["bottomCenterX"], 3)
        entry["holeRatio"] = round(entry["centralHoleArea"] / max(baseline["centralHoleArea"], 1), 4)

    def bounds(key: str) -> dict:
        low = min(entries, key=lambda item: float(item[key]))
        high = max(entries, key=lambda item: float(item[key]))
        return {"min": {"frame": low["frame"], "value": low[key]}, "max": {"frame": high["frame"], "value": high[key]}}

    summary = {
        "action": args.action,
        "video": str(args.video),
        "decodedFrames": len(frames),
        "metrics": {key: bounds(key) for key in (
            "widthRatio", "heightRatio", "areaRatio", "centerDeltaX",
            "bottomCenterDeltaX", "principalAngleFromVertical", "holeRatio"
        )},
        "perFrame": entries,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.out_dir / f"{args.action}-audit.json"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    selected = {0, 123}
    for metric in summary["metrics"].values():
        selected.add(int(metric["min"]["frame"]))
        selected.add(int(metric["max"]["frame"]))
    keyframes = args.out_dir / "keyframes"
    keyframes.mkdir(exist_ok=True)
    for index in sorted(selected):
        Image.fromarray(frames[index]).save(keyframes / f"{args.action}-frame-{index:03d}.png")

    thumb_w, thumb_h, label_h = 256, 144, 40
    overview = Image.new("RGB", (thumb_w * len(SAMPLES), thumb_h + label_h), (18, 20, 24))
    draw = ImageDraw.Draw(overview)
    font = ImageFont.load_default()
    for column, index in enumerate(SAMPLES):
        entry = entries[index]
        image = Image.fromarray(frames[index]).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = column * thumb_w
        overview.paste(image, (x, 0))
        draw.text(
            (x + 4, thumb_h + 3),
            f"f{index} w{entry['widthRatio']:.2f} h{entry['heightRatio']:.2f}",
            fill=(230, 232, 238), font=font,
        )
        draw.text(
            (x + 4, thumb_h + 19),
            f"dx{entry['centerDeltaX']:+.0f} a{entry['principalAngleFromVertical']:+.0f} hole{entry['holeRatio']:.2f}",
            fill=(187, 191, 201), font=font,
        )
    overview_path = args.out_dir / f"{args.action}-overview.png"
    overview.save(overview_path)
    print(json.dumps(summary["metrics"], ensure_ascii=False, indent=2))
    print(report_path)
    print(overview_path)


if __name__ == "__main__":
    main()
