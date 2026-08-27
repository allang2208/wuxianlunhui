import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
CANVAS_SIZE = (1024, 576)
TARGET_HEIGHT_RATIO = 0.75
MAX_WIDTH_RATIO = 0.80


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--alpha", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGB")
    alpha = Image.open(args.alpha).convert("L")
    if alpha.size != source.size:
        alpha = alpha.resize(source.size, Image.Resampling.LANCZOS)
    subject_rgba = source.convert("RGBA")
    subject_rgba.putalpha(alpha)
    bbox = alpha.getbbox()
    if not bbox:
        raise RuntimeError(f"no visible alpha content in {args.alpha}")

    subject = subject_rgba.crop(bbox)
    scale = (CANVAS_SIZE[1] * TARGET_HEIGHT_RATIO) / subject.height
    if subject.width * scale > CANVAS_SIZE[0] * MAX_WIDTH_RATIO:
        scale = (CANVAS_SIZE[0] * MAX_WIDTH_RATIO) / subject.width
    size = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", CANVAS_SIZE, "white")
    x = (CANVAS_SIZE[0] - subject.width) // 2
    y = (CANVAS_SIZE[1] - subject.height) // 2
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)
    print(
        f"[side-reference] source={source.size} bbox={bbox} "
        f"subject={subject.size} position=({x},{y}) -> {args.output}"
    )


if __name__ == "__main__":
    main()
