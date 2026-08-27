#!/usr/bin/env python3
"""Static provenance and alpha audit for the first two approved Klein batches."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
BATCH_ROOT = Path(__file__).resolve().parent

ASSETS = [
    "house_lv1", "house_lv2", "house_lv3", "house_lv4", "house_lv5",
    "house_lv6", "house_lv7", "warehouse_lv2", "warehouse_lv3",
    "warehouse_lv4", "warehouse_lv5", "barracks", "hamster_barracks_lv2",
    "thatch_hut", "thatch_hut_lv2", "armory", "bakery", "royal_mint",
    "steam_power_plant", "wind_power_plant",
]

REROLL_ACCEPTED = ["house_lv6", "warehouse_lv3", "warehouse_lv4"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_png(path: Path) -> dict:
    image = Image.open(path).convert("RGBA")
    rgba = np.asarray(image, dtype=np.uint8)
    alpha = rgba[..., 3]
    transparent = alpha == 0
    dirty_transparent = int(np.count_nonzero(np.any(rgba[..., :3] != 0, axis=2) & transparent))
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "sha256": sha256(path),
        "fileSize": list(image.size),
        "alphaPixels": int(np.count_nonzero(alpha)),
        "transparentPixels": int(np.count_nonzero(transparent)),
        "dirtyTransparentRgbPixels": dirty_transparent,
    }


def main() -> None:
    entries = {}
    failures = []
    for asset in ASSETS:
        path = ROOT / "assets" / "terrain" / f"{asset}.png"
        if not path.exists():
            failures.append(f"missing runtime asset: {path}")
            continue
        entry = inspect_png(path)
        entries[asset] = entry
        if entry["alphaPixels"] <= 0:
            failures.append(f"empty alpha: {asset}")
        if entry["dirtyTransparentRgbPixels"] != 0:
            failures.append(f"dirty transparent RGB: {asset}")

    reroll_identity = {}
    accepted_dir = BATCH_ROOT / "batch_01" / "reroll_01_barracks_v3_method" / "accepted_runtime"
    for asset in REROLL_ACCEPTED:
        accepted = accepted_dir / f"{asset}.png"
        runtime = ROOT / "assets" / "terrain" / f"{asset}.png"
        same = accepted.exists() and runtime.exists() and sha256(accepted) == sha256(runtime)
        reroll_identity[asset] = same
        if not same:
            failures.append(f"approved reroll identity mismatch: {asset}")

    rotor = inspect_png(ROOT / "assets" / "terrain" / "wind_power_plant_rotor.png")
    rotor["frameGrid"] = [6, 4]
    rotor["frameSize"] = [rotor["fileSize"][0] // 6, rotor["fileSize"][1] // 4]
    rotor["frameCount"] = 24
    if rotor["fileSize"][0] % 6 or rotor["fileSize"][1] % 4:
        failures.append("wind rotor sheet is not divisible by 6x4")

    report = {
        "status": "ok" if not failures else "failed",
        "assetCount": len(entries),
        "assets": entries,
        "approvedRerollIdentity": reroll_identity,
        "windRotor": rotor,
        "failures": failures,
    }
    output = BATCH_ROOT / "installed_20_static_audit.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "assetCount": report["assetCount"],
        "rerollIdentity": reroll_identity,
        "rotorFileSize": rotor["fileSize"],
        "rotorFrameSize": rotor["frameSize"],
        "failures": failures,
        "report": output.relative_to(ROOT).as_posix(),
    }, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
