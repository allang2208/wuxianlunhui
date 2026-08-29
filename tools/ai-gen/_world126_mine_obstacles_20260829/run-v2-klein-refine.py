#!/usr/bin/env python3
"""Rebuild the five selected World-126 V2 mine-obstacle candidates."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
MANIFEST = ROOT / "world126-mine-obstacle-candidate-manifest.json"
GENERATOR = REPO / "tools/ai-gen/generate-world122-building-candidates.py"

ASSETS = (
    (
        "mine_obstacle_collapsed_support",
        ROOT / "support_model_v2_realistic",
        "mine_obstacle_collapsed_support_v2",
        ROOT / "support_model_v2_realistic/candidates_klein_s48_from_model",
        127241,
    ),
    (
        "mine_obstacle_derailed_cart",
        ROOT / "models_v2_realistic",
        "mine_obstacle_derailed_cart_v2",
        ROOT / "candidates_klein_s48_from_v2_models",
        127251,
    ),
    (
        "mine_obstacle_stone_pillar",
        ROOT / "models_v2_realistic",
        "mine_obstacle_stone_pillar_v2",
        ROOT / "candidates_klein_s48_from_v2_pillar_r2",
        127261,
    ),
    (
        "mine_obstacle_hand_winch",
        ROOT / "models_v2_realistic",
        "mine_obstacle_hand_winch_v2",
        ROOT / "candidates_klein_s48_from_v2_models",
        127271,
    ),
    (
        "mine_obstacle_sorting_hopper",
        ROOT / "models_v2_realistic",
        "mine_obstacle_sorting_hopper_v2",
        ROOT / "candidates_klein_s48_from_v2_models",
        127281,
    ),
)


def green_init(source_dir: Path, model_key: str) -> Path:
    source = source_dir / f"{model_key}_textured_init.png"
    target = source_dir / f"{model_key}_textured_init_green.png"
    with Image.open(source).convert("RGBA") as image:
        background = Image.new("RGBA", image.size, (0, 255, 0, 255))
        background.alpha_composite(image)
        background.convert("RGB").save(target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(asset[0] for asset in ASSETS))
    args = parser.parse_args()

    for asset_id, source_dir, model_key, output, seed in ASSETS:
        if args.only and asset_id != args.only:
            continue
        init_image = green_init(source_dir, model_key)
        output.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable,
            str(GENERATOR),
            "--manifest",
            str(MANIFEST),
            "--out",
            str(output),
            "--stage",
            "refine",
            "--only",
            asset_id,
            "--init-image",
            str(init_image),
            "--seed",
            str(seed),
            "--raw-only",
        ]
        print(f"[{asset_id}] approved V2 textured model -> Klein 48-step x2", flush=True)
        subprocess.run(command, cwd=REPO, check=True, timeout=7320)


if __name__ == "__main__":
    main()
