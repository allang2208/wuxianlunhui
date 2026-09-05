#!/usr/bin/env python3
"""Remove the visible green-screen residue from Ore Spider walk/throw sheets.

The repair is deliberately asset-local: Ore Spider has a violet crystal and
coal/brown limb palette, so green-dominant spill pixels can be removed without
recolouring or rescaling the approved creature. Non-green pixels,
frame geometry, timing, and registration remain untouched.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
WORK = Path(__file__).resolve().parent
ASSET_DIR = ROOT / "assets" / "enemies" / "ore_spider"
BEFORE_DIR = WORK / "before"
CANDIDATE_DIR = WORK / "candidate"
PREVIEW_DIR = WORK / "previews"
MANIFEST_PATH = WORK / "repair-manifest.json"
CELL = 512
COLS = 8
TARGETS = {
    "walking": {"filename": "walking.png", "frameCount": 14, "durationMs": 1400, "loop": True},
    "attacking": {"filename": "attacking.png", "frameCount": 28, "durationMs": 1500, "loop": False},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def split_cells(sheet: np.ndarray, count: int) -> list[np.ndarray]:
    return [sheet[(i // COLS) * CELL:(i // COLS + 1) * CELL,
                  (i % COLS) * CELL:(i % COLS + 1) * CELL].copy()
            for i in range(count)]


def frame_bbox(frame: np.ndarray) -> list[int] | None:
    ys, xs = np.where(frame[..., 3] > 3)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def green_masks(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rgb = frame[..., :3].astype(np.int16)
    alpha = frame[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    excess = g - np.maximum(r, b)
    candidate = (alpha > 3) & (g >= 20) & (excess >= 4)
    seed = (alpha > 12) & (g >= 36) & (excess >= 12)
    return candidate, seed


def repair_frame(frame: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    result = frame.copy()
    candidate, seed = green_masks(frame)
    remove = candidate

    before_rgba = result.copy()
    result[remove] = 0
    # Transparent RGB must not carry a chroma colour into linear filtering.
    result[result[..., 3] == 0, :3] = 0

    after_candidate, after_seed = green_masks(result)
    changed = np.any(before_rgba != result, axis=2)
    alpha_changed = before_rgba[..., 3] != result[..., 3]
    rgb_changed = np.any(before_rgba[..., :3] != result[..., :3], axis=2)
    non_green_visible = (before_rgba[..., 3] > 3) & ~candidate
    non_green_visible_changed = changed & non_green_visible
    return result, {
        "candidateGreenPixels": int(candidate.sum()),
        "strongSeedPixels": int(seed.sum()),
        "removedPixels": int(remove.sum()),
        "changedPixels": int(changed.sum()),
        "changedAlphaPixels": int(alpha_changed.sum()),
        "changedRgbPixels": int(rgb_changed.sum()),
        "nonGreenVisiblePixelsChanged": int(non_green_visible_changed.sum()),
        "remainingCandidateGreenPixels": int(after_candidate.sum()),
        "remainingStrongGreenPixels": int(after_seed.sum()),
        "bboxBefore": frame_bbox(frame),
        "bboxAfter": frame_bbox(result),
    }


def checker(size: tuple[int, int], tile: int = 12) -> Image.Image:
    w, h = size
    yy, xx = np.indices((h, w))
    mask = ((xx // tile + yy // tile) % 2).astype(bool)
    rgb = np.empty((h, w, 3), dtype=np.uint8)
    rgb[mask] = (42, 47, 53)
    rgb[~mask] = (76, 82, 88)
    return Image.fromarray(rgb, "RGB").convert("RGBA")


def composite(frame: np.ndarray, background: str = "checker") -> Image.Image:
    if background == "black":
        bg = Image.new("RGBA", (CELL, CELL), (4, 5, 7, 255))
    else:
        bg = checker((CELL, CELL))
    bg.alpha_composite(Image.fromarray(frame, "RGBA"))
    return bg.convert("RGB")


def save_previews(action: str, before: list[np.ndarray], after: list[np.ndarray], duration_ms: int) -> None:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    frame_ms = max(20, round(duration_ms / len(after)))
    compare_frames = []
    after_frames = []
    for index, (old, new) in enumerate(zip(before, after)):
        old_im = composite(old)
        new_im = composite(new)
        canvas = Image.new("RGB", (CELL * 2, CELL + 36), (14, 17, 21))
        canvas.paste(old_im, (0, 36))
        canvas.paste(new_im, (CELL, 36))
        d = ImageDraw.Draw(canvas)
        d.text((14, 8), f"修复前 · {action} · frame {index:02d}", font=font, fill=(225, 230, 234))
        d.text((CELL + 14, 8), f"修复后 · {action} · frame {index:02d}", font=font, fill=(150, 236, 224))
        compare_frames.append(canvas.convert("P", palette=Image.Palette.ADAPTIVE, colors=256))
        after_frames.append(new_im.convert("P", palette=Image.Palette.ADAPTIVE, colors=256))
    compare_frames[0].save(
        PREVIEW_DIR / f"{action}-before-after.gif", save_all=True,
        append_images=compare_frames[1:], duration=frame_ms, loop=0, disposal=2, optimize=False,
    )
    after_frames[0].save(
        PREVIEW_DIR / f"{action}-clean.gif", save_all=True,
        append_images=after_frames[1:], duration=frame_ms, loop=0, disposal=2, optimize=False,
    )

    picks = np.linspace(0, len(after) - 1, min(7, len(after)), dtype=int).tolist()
    thumb = 256
    band = 28
    contact = Image.new("RGB", (thumb * len(picks), (thumb + band) * 2), (15, 18, 22))
    d = ImageDraw.Draw(contact)
    small = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 15)
    for col, index in enumerate(picks):
        x = col * thumb
        contact.paste(composite(before[index]).resize((thumb, thumb), Image.Resampling.LANCZOS), (x, 0))
        contact.paste(composite(after[index]).resize((thumb, thumb), Image.Resampling.LANCZOS), (x, thumb + band))
        d.text((x + 6, thumb + 5), f"before f{index:02d}", font=small, fill=(232, 205, 225))
        d.text((x + 6, thumb * 2 + band + 5), f"after  f{index:02d}", font=small, fill=(159, 231, 221))
    contact.save(PREVIEW_DIR / f"{action}-before-after-contact.png", optimize=True)


def prepare() -> None:
    BEFORE_DIR.mkdir(parents=True, exist_ok=True)
    CANDIDATE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "asset": "oreSpider",
        "date": "2026-09-05",
        "scope": ["walking", "attacking"],
        "unchangedStates": ["idle", "slam", "dying"],
        "cell": [CELL, CELL],
        "columns": COLS,
        "method": {
            "candidate": "alpha>3 and G>=20 and G-max(R,B)>=4",
            "seed": "alpha>12 and G>=36 and G-max(R,B)>=12",
            "selection": "all candidate green-dominant pixels in the two contaminated sheets",
            "operation": "selected pixels -> transparent black; every other visible pixel unchanged",
        },
        "states": {},
    }
    for action, spec in TARGETS.items():
        source = ASSET_DIR / spec["filename"]
        before_path = BEFORE_DIR / spec["filename"]
        if before_path.exists() and sha256(before_path) != sha256(source):
            raise SystemExit(f"{before_path} already exists but differs from current formal asset; refusing to overwrite")
        if not before_path.exists():
            shutil.copy2(source, before_path)
        image = Image.open(source).convert("RGBA")
        sheet = np.array(image)
        before_cells = split_cells(sheet, spec["frameCount"])
        after_cells = []
        frames = []
        for index, cell in enumerate(before_cells):
            repaired, result = repair_frame(cell)
            result["frame"] = index
            after_cells.append(repaired)
            frames.append(result)
        output = sheet.copy()
        for index, cell in enumerate(after_cells):
            y = (index // COLS) * CELL
            x = (index % COLS) * CELL
            output[y:y + CELL, x:x + CELL] = cell
        output[output[..., 3] == 0, :3] = 0
        candidate_path = CANDIDATE_DIR / spec["filename"]
        Image.fromarray(output, "RGBA").save(candidate_path, optimize=True, compress_level=9)
        save_previews(action, before_cells, after_cells, spec["durationMs"])
        bbox_bottom_delta = [
            (row["bboxAfter"][3] - row["bboxBefore"][3])
            if row["bboxBefore"] and row["bboxAfter"] else None
            for row in frames
        ]
        manifest["states"][action] = {
            "formalPath": str(source.relative_to(ROOT)).replace("\\", "/"),
            "beforeSha256": sha256(before_path),
            "candidateSha256": sha256(candidate_path),
            "dimensions": list(image.size),
            "frameCount": spec["frameCount"],
            "durationMs": spec["durationMs"],
            "loop": spec["loop"],
            "removedPixels": sum(row["removedPixels"] for row in frames),
            "remainingStrongGreenPixels": sum(row["remainingStrongGreenPixels"] for row in frames),
            "remainingCandidateGreenPixels": sum(row["remainingCandidateGreenPixels"] for row in frames),
            "nonGreenVisiblePixelsChanged": sum(row["nonGreenVisiblePixelsChanged"] for row in frames),
            "maxAbsBottomBboxDelta": max(abs(value) for value in bbox_bottom_delta if value is not None),
            "frames": frames,
            "previewGif": str((PREVIEW_DIR / f"{action}-clean.gif").relative_to(ROOT)).replace("\\", "/"),
            "comparisonGif": str((PREVIEW_DIR / f"{action}-before-after.gif").relative_to(ROOT)).replace("\\", "/"),
        }
        print(f"prepared {action}: removed={manifest['states'][action]['removedPixels']} "
              f"remainingStrong={manifest['states'][action]['remainingStrongGreenPixels']} "
              f"bottomDelta<={manifest['states'][action]['maxAbsBottomBboxDelta']}px")
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def install() -> None:
    if not MANIFEST_PATH.exists():
        raise SystemExit("repair-manifest.json missing; run --prepare first")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for action, spec in TARGETS.items():
        entry = manifest["states"][action]
        formal = ASSET_DIR / spec["filename"]
        candidate = CANDIDATE_DIR / spec["filename"]
        if sha256(formal) != entry["beforeSha256"]:
            raise SystemExit(f"{formal} changed after preparation; refusing to overwrite parallel work")
        if sha256(candidate) != entry["candidateSha256"]:
            raise SystemExit(f"{candidate} no longer matches the reviewed candidate")
    for action, spec in TARGETS.items():
        shutil.copy2(CANDIDATE_DIR / spec["filename"], ASSET_DIR / spec["filename"])
        print(f"installed {action}: {ASSET_DIR / spec['filename']}")
    manifest["installed"] = True
    manifest["installedSha256"] = {
        action: sha256(ASSET_DIR / spec["filename"]) for action, spec in TARGETS.items()
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--install", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        prepare()
    else:
        install()


if __name__ == "__main__":
    main()
