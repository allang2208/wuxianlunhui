from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Restore a donor building's foundation material through an authored visible-foundation mask."
    )
    parser.add_argument("donor", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("mask", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--shift-x", type=int, default=0)
    parser.add_argument("--shift-y", type=int, default=0)
    parser.add_argument("--erode", type=int, default=0,
                        help="integer pixels eroded from the white mask before feathering")
    parser.add_argument("--feather", type=float, default=1.5)
    return parser.parse_args()


def shifted(image: Image.Image, x: int, y: int) -> Image.Image:
    if x == 0 and y == 0:
        return image
    result = Image.new(image.mode, image.size)
    result.paste(image, (x, y))
    return result


def main() -> None:
    args = parse_args()
    donor = Image.open(args.donor).convert("RGB")
    target = Image.open(args.target).convert("RGB")
    mask = Image.open(args.mask).convert("L")
    if donor.size != target.size or mask.size != target.size:
        raise ValueError(f"size mismatch: donor={donor.size}, target={target.size}, mask={mask.size}")

    donor = shifted(donor, args.shift_x, args.shift_y)
    if args.erode > 0:
        kernel = args.erode * 2 + 1
        mask = mask.filter(ImageFilter.MinFilter(kernel))
    if args.feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(args.feather))

    output = Image.composite(donor, target, mask)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output)
    print(
        f"restored_foundation={args.output} shift=({args.shift_x},{args.shift_y}) "
        f"erode={args.erode} feather={args.feather}"
    )


if __name__ == "__main__":
    main()
