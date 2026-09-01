#!/usr/bin/env python3
"""Composite identity-locked hamster champion keyframes onto the H3 chroma backdrop."""

from argparse import ArgumentParser
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--alpha", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--subject-scale", type=float, default=1.0)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGB")
    alpha = Image.open(args.alpha).convert("L")
    if source.size != alpha.size:
        raise ValueError(f"source {source.size} and alpha {alpha.size} must match")

    if not 0.1 <= args.subject_scale <= 1.0:
        raise ValueError("--subject-scale must be between 0.1 and 1.0")

    canvas_size = source.size
    if args.subject_scale < 1.0:
        scaled_size = tuple(round(value * args.subject_scale) for value in source.size)
        source = source.resize(scaled_size, Image.Resampling.LANCZOS)
        alpha = alpha.resize(scaled_size, Image.Resampling.LANCZOS)
    offset = ((canvas_size[0] - source.size[0]) // 2, (canvas_size[1] - source.size[1]) // 2)
    background = Image.new("RGB", canvas_size, (32, 96, 224))
    background.paste(source, offset, alpha)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    background.save(output)
    print(f"saved {output} {canvas_size[0]}x{canvas_size[1]} subject_scale={args.subject_scale}")


if __name__ == "__main__":
    main()
