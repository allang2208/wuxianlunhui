import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
TASK = Path(__file__).resolve().parent
OUT = TASK / "h3-references"

SOURCES = {
    "oil-technician": {
        "idle": ROOT / "tools/ai-gen/_industrial_economy_workers_20260901/mothers/hamster-oil-technician-mother-v01.png",
        "walking": TASK / "references/oil-technician-walking-keyframe-v01.png",
        "maintaining": TASK / "references/oil-technician-maintaining-keyframe-v02.png",
    },
    "cannery-worker": {
        "idle": ROOT / "tools/ai-gen/_industrial_economy_workers_20260901/mothers/hamster-cannery-worker-mother-v01.png",
        "walking": TASK / "references/cannery-worker-walking-keyframe-v01.png",
        "inspecting": TASK / "references/cannery-worker-inspecting-keyframe-v01.png",
    },
    "trade-clerk": {
        "idle": ROOT / "tools/ai-gen/_industrial_economy_workers_20260901/mothers/hamster-trade-clerk-mother-v01.png",
        "walking": TASK / "references/trade-clerk-walking-keyframe-v01.png",
        "negotiating": TASK / "references/trade-clerk-negotiating-keyframe-v01.png",
    },
}

SOURCE_CANVAS = 1536
OUTPUT_SIZE = (1024, 576)
SOURCE_TO_OUTPUT_SCALE = OUTPUT_SIZE[1] / SOURCE_CANVAS


def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    rgb = image.convert("RGB")
    white = Image.new("RGB", rgb.size, "white")
    diff = ImageChops.difference(rgb, white).convert("L")
    mask = diff.point(lambda value: 255 if value > 10 else 0)
    return mask.getbbox()


def prepare(source: Path) -> tuple[Image.Image, dict]:
    with Image.open(source) as original:
        image = original.convert("RGB")
    if image.width > SOURCE_CANVAS or image.height > SOURCE_CANVAS:
        raise ValueError(f"source exceeds shared canvas: {source} {image.size}")
    canvas = Image.new("RGB", (SOURCE_CANVAS, SOURCE_CANVAS), "white")
    offset = ((SOURCE_CANVAS - image.width) // 2, (SOURCE_CANVAS - image.height) // 2)
    canvas.paste(image, offset)
    square = canvas.resize((OUTPUT_SIZE[1], OUTPUT_SIZE[1]), Image.Resampling.LANCZOS)
    output = Image.new("RGB", OUTPUT_SIZE, "white")
    output.paste(square, ((OUTPUT_SIZE[0] - OUTPUT_SIZE[1]) // 2, 0))
    bbox = content_bbox(image)
    return output, {
        "source": str(source.relative_to(ROOT)).replace("\\", "/"),
        "sourceSize": list(image.size),
        "sourceContentBbox": list(bbox) if bbox else None,
        "sourceContentHeight": (bbox[3] - bbox[1]) if bbox else 0,
        "sharedSourceCanvas": [SOURCE_CANVAS, SOURCE_CANVAS],
        "sourceOffset": list(offset),
        "outputSize": list(OUTPUT_SIZE),
        "sourceToOutputScale": SOURCE_TO_OUTPUT_SCALE,
        "nonUniformScaling": False,
    }


def build_contact(prepared: list[tuple[str, str, Image.Image]]) -> None:
    thumb = (512, 288)
    label_h = 32
    rows = len(SOURCES)
    contact = Image.new("RGB", (thumb[0] * 3, (thumb[1] + label_h) * rows), "#dfe5eb")
    draw = ImageDraw.Draw(contact)
    font = ImageFont.load_default()
    for index, (worker, state, image) in enumerate(prepared):
        row = index // 3
        col = index % 3
        x = col * thumb[0]
        y = row * (thumb[1] + label_h)
        contact.paste(image.resize(thumb, Image.Resampling.LANCZOS), (x, y))
        draw.rectangle((x, y, x + thumb[0] - 1, y + thumb[1] - 1), outline="#8b98a5", width=2)
        draw.text((x + 10, y + thumb[1] + 9), f"{worker} | {state}", fill="#17222d", font=font)
    contact.save(OUT / "h3-reference-contact.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report = {
        "version": 1,
        "sharedTransform": {
            "sourceCanvas": [SOURCE_CANVAS, SOURCE_CANVAS],
            "outputSize": list(OUTPUT_SIZE),
            "sourceToOutputScale": SOURCE_TO_OUTPUT_SCALE,
            "description": "All states use the same centered 1536-square pad, uniform resize to 576 square, then centered placement on 1024x576. No per-state fit or non-uniform scaling.",
        },
        "references": {},
    }
    prepared_contact = []
    for worker, states in SOURCES.items():
        report["references"][worker] = {}
        for state, source in states.items():
            output, item = prepare(source)
            destination = OUT / f"{worker}-{state}-h3-ref-v01.png"
            output.save(destination, optimize=True)
            item["output"] = str(destination.relative_to(ROOT)).replace("\\", "/")
            report["references"][worker][state] = item
            prepared_contact.append((worker, state, output))
    build_contact(prepared_contact)
    (TASK / "reference-preparation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
