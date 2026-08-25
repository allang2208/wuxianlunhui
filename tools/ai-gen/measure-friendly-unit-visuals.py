"""Measure friendly-unit walk sheets against the Hamster Priest visual standard.

The game renders a 512px animation cell at ``displaySize`` world pixels.  Raw
cell size is therefore not a useful comparison: this helper measures the median
alpha-bearing content height and foot line of all configured walk frames, then
reports the displaySize/footOffset needed to match the reference unit.

The proposed display size is diagnostic, not authoritative.  A long upright
weapon (for example the militia pitchfork) or a crouched/horizontal pose (for
example the scout run) makes the full alpha box a poor proxy for body size.  In
those cases compare the head/torso/feet silhouette with the reference and keep a
previously approved manual display size; the reported foot line remains useful.
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from PIL import Image, ImageFilter


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def measure_config(
    root: Path,
    config_path: Path,
    animation: str = "walk",
    morphology: int = 0,
) -> dict[str, float | str]:
    config = json.loads(
        config_path.read_text(encoding="utf-8"),
        object_pairs_hook=_reject_duplicate_keys,
    )
    walk = config["animations"][animation]
    frame_width = int(walk.get("frameWidth", 512))
    frame_height = int(walk.get("frameHeight", 512))
    frame_count = int(walk.get("frameCount", 1))
    sheet = Image.open(root / walk["src"]).convert("RGBA")
    heights: list[int] = []
    bottoms: list[int] = []
    for index in range(frame_count):
        col = index % int(walk.get("cols", max(1, sheet.width // frame_width)))
        row = index // int(walk.get("cols", max(1, sheet.width // frame_width)))
        cell = sheet.crop(
            (
                col * frame_width,
                row * frame_height,
                (col + 1) * frame_width,
                (row + 1) * frame_height,
            )
        )
        alpha = cell.getchannel("A").point(lambda value: 255 if value > 16 else 0)
        if morphology >= 3:
            alpha = alpha.filter(ImageFilter.MinFilter(morphology))
            alpha = alpha.filter(ImageFilter.MaxFilter(morphology))
        bbox = alpha.getbbox()
        if not bbox:
            continue
        heights.append(bbox[3] - bbox[1])
        bottoms.append(bbox[3] - 1)
    if not heights:
        raise RuntimeError(f"No alpha-bearing {animation} frames: {config_path}")
    return {
        "id": config["id"],
        "config": str(config_path).replace("\\", "/"),
        "animation": animation,
        "frameHeight": frame_height,
        "medianHeight": float(statistics.median(heights)),
        "medianBottom": float(statistics.median(bottoms)),
        "currentDisplaySize": float(config.get("displaySize", 0)),
        "groundRadius": float(config.get("groundRadius", 0)),
        "bodyHeight": float(config.get("bodyHeight", 0)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("configs", nargs="+", type=Path)
    parser.add_argument("--animation", default="walk")
    parser.add_argument("--morphology", type=int, default=0)
    args = parser.parse_args()
    if args.morphology and (args.morphology < 3 or args.morphology % 2 == 0):
        parser.error("--morphology must be an odd integer >= 3")
    root = Path.cwd()
    reference = measure_config(root, args.reference, args.animation, args.morphology)
    target_height = (
        reference["medianHeight"]
        * reference["currentDisplaySize"]
        / reference["frameHeight"]
    )
    print(
        f"reference={reference['id']} targetVisibleHeight={target_height:.3f}px "
        f"medianAlphaHeight={reference['medianHeight']:.1f}"
    )
    print("advisory=full-alpha proposals require manual body-silhouette review for long weapons or crouched poses")
    for config_path in args.configs:
        row = measure_config(root, config_path, args.animation, args.morphology)
        display_size = target_height * row["frameHeight"] / row["medianHeight"]
        foot_offset = (
            row["medianBottom"] - row["frameHeight"] / 2
        ) * display_size / row["frameHeight"]
        print(
            f"{row['id']}: current={row['currentDisplaySize']:.3f} "
            f"medianHeight={row['medianHeight']:.1f} medianBottom={row['medianBottom']:.1f} "
            f"proposedDisplaySize={display_size:.6f} proposedFootOffset={foot_offset:.6f} "
            f"collision={row['groundRadius']:.0f}x{row['bodyHeight']:.0f}"
        )


if __name__ == "__main__":
    main()
