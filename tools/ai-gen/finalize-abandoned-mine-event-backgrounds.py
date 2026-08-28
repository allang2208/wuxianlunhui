"""Finalize the 15 abandoned-mine event backgrounds for runtime use.

The creative images are generated separately with the built-in image generator.
This script only normalizes dimensions, installs the approved files, and builds
review artifacts. It intentionally applies no sharpening or grain.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "tools" / "ai-gen" / "_abandoned_mine_event_backgrounds_20260828" / "generated"
OUTPUT_DIR = ROOT / "assets" / "scenes" / "dungeon-events"
REVIEW_DIR = ROOT / "tools" / "ai-gen" / "_abandoned_mine_event_backgrounds_20260828"
TARGET_SIZE = (1536, 1024)

EVENTS = [
    ("collapsedMineShaft", "collapsed-mine-shaft.png"),
    ("abandonedOreCart", "abandoned-ore-cart.png"),
    ("canaryCage", "canary-cage.png"),
    ("dampFuseBox", "damp-fuse-box.png"),
    ("minersRationCache", "miners-ration-cache.png"),
    ("floodedLowerTunnel", "flooded-lower-tunnel.png"),
    ("exposedCrystalVein", "exposed-crystal-vein.png"),
    ("brokenMineLift", "broken-mine-lift.png"),
    ("toxicGasPocket", "toxic-gas-pocket.png"),
    ("lanternCode", "lantern-code.png"),
    ("foremanLedger", "foreman-ledger.png"),
    ("dynamiteMagazine", "dynamite-magazine.png"),
    ("oreSpiderNest", "ore-spider-nest.png"),
    ("hauntedRockDrill", "haunted-rock-drill.png"),
    ("sealedMainShaft", "sealed-main-shaft.png"),
]

LOW_NOISE_CONTRACT = (
    "Very low noise; no film grain, sensor noise, stippling, gritty overlay, "
    "speckled texture wash, crunchy microcontrast, excessive sharpening, or "
    "particle-filled fog. Use smooth shadow gradients, clean volumetric haze, "
    "broad readable material shapes, and restrained fine detail."
)


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    scaled = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (scaled.width - target_w) // 2
    top = (scaled.height - target_h) // 2
    return scaled.crop((left, top, left + target_w, top + target_h))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    installed: list[dict[str, object]] = []
    thumbs: list[tuple[str, Image.Image]] = []

    for event_id, filename in EVENTS:
        source = SOURCE_DIR / filename
        if not source.is_file():
            raise FileNotFoundError(f"Missing generated background: {source}")

        with Image.open(source) as raw:
            image = cover_resize(raw.convert("RGB"), TARGET_SIZE)

        destination = OUTPUT_DIR / filename
        if raw.size == TARGET_SIZE and raw.mode == "RGB":
            # Preserve the generator's original PNG encoding and color behavior.
            shutil.copy2(source, destination)
        else:
            image.save(destination, "PNG")
        installed.append(
            {
                "eventId": event_id,
                "filename": filename,
                "runtimePath": f"assets/scenes/dungeon-events/{filename}",
                "dimensions": list(TARGET_SIZE),
            }
        )
        thumbs.append((event_id, image.resize((384, 256), Image.Resampling.LANCZOS)))

    sheet = Image.new("RGB", (384 * 5, 256 * 3), (8, 8, 10))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (event_id, thumb) in enumerate(thumbs):
        x = (index % 5) * 384
        y = (index // 5) * 256
        sheet.paste(thumb, (x, y))
        label_width = draw.textbbox((0, 0), event_id, font=font)[2] + 14
        draw.rounded_rectangle((x + 8, y + 8, x + 8 + label_width, y + 29), radius=4, fill=(0, 0, 0, 190))
        draw.text((x + 15, y + 13), event_id, fill=(245, 230, 195), font=font)

    preview_path = REVIEW_DIR / "abandoned-mine-event-backgrounds-contact-sheet.png"
    sheet.save(preview_path, "PNG", optimize=True)

    manifest = {
        "assetSet": "abandoned-mine-event-backgrounds",
        "generator": "OpenAI built-in image generation",
        "targetDimensions": list(TARGET_SIZE),
        "composition": "3:2 landscape; bottom 25 percent dark and quiet for the decision panel",
        "lowNoiseContract": LOW_NOISE_CONTRACT,
        "count": len(installed),
        "assets": installed,
    }
    (REVIEW_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Installed {len(installed)} backgrounds in {OUTPUT_DIR}")
    print(f"Preview: {preview_path}")


if __name__ == "__main__":
    main()
