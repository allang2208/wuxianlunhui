#!/usr/bin/env python3
"""Fit approved Frostbound Spearman keyframes onto exact 1024x576 H3 canvases."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


TARGET = (1024, 576)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = Image.open(args.source).convert("RGB")
    scale = min(TARGET[0] / source.width, TARGET[1] / source.height)
    fitted = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", TARGET, "white")
    offset = ((TARGET[0] - fitted.width) // 2, (TARGET[1] - fitted.height) // 2)
    canvas.paste(fitted, offset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)
    print(f"[frostbound-spearman-h3-reference] {source.size} -> {fitted.size} at {offset} -> {args.output}")


if __name__ == "__main__":
    main()
