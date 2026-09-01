#!/usr/bin/env python3
"""Replace only border-connected near-white background with a solid H3 chroma color."""

from argparse import ArgumentParser
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--alpha-output")
    parser.add_argument("--minimum", type=int, default=232)
    args = parser.parse_args()

    source = np.asarray(Image.open(args.source).convert("RGB"))
    minimum = source.min(axis=2)
    spread = source.max(axis=2) - minimum
    near_white = ((minimum >= args.minimum) & (spread <= 20)).astype(np.uint8)
    count, labels = cv2.connectedComponents(near_white, connectivity=4)
    if count <= 1:
        raise RuntimeError("no border-connected white background component found")

    border_labels = np.unique(
        np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1]))
    )
    border_labels = border_labels[border_labels != 0]
    background = np.isin(labels, border_labels)
    alpha = np.where(background, 0, 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.55)

    chroma = np.empty_like(source)
    chroma[:, :] = (32, 96, 224)
    weight = alpha.astype(np.float32)[..., None] / 255.0
    composite = np.clip(source * weight + chroma * (1.0 - weight), 0, 255).astype(np.uint8)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(composite, "RGB").save(output)
    if args.alpha_output:
        Image.fromarray(alpha, "L").save(args.alpha_output)
    print(f"saved {output} {source.shape[1]}x{source.shape[0]} border_labels={len(border_labels)}")


if __name__ == "__main__":
    main()
