#!/usr/bin/env python3
"""Extract an approved H3 chase pose and place it unchanged on pure white."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import av
import numpy as np
from PIL import Image


TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))
from transparent_cutout import build_alpha, decontaminate, detect_bg_color  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--frame", required=True, type=int)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    selected = None
    with av.open(str(args.video)) as container:
        for index, frame in enumerate(container.decode(video=0)):
            if index == args.frame:
                selected = frame.to_ndarray(format="rgb24")
                break
    if selected is None:
        raise RuntimeError(f"video has no frame {args.frame}")

    bg = detect_bg_color(selected)
    alpha = build_alpha(selected, bg, tol=55, soft=38, feather=0.65, keep_largest=True)
    foreground = decontaminate(selected, alpha, bg)
    alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    rgba = np.dstack((foreground, alpha_u8))
    rgba[alpha_u8 == 0, :3] = 0
    subject = Image.fromarray(rgba, "RGBA")

    canvas = Image.new("RGBA", subject.size, (255, 255, 255, 255))
    canvas.alpha_composite(subject)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(args.out)

    ys, xs = np.where(alpha_u8 > 12)
    box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    print(
        f"prepared {args.out}: source={args.video} frame={args.frame} "
        f"detected_bg={[round(float(v), 2) for v in bg]} bbox={box}"
    )


if __name__ == "__main__":
    main()
