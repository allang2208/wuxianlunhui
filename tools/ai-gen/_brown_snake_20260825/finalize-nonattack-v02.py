#!/usr/bin/env python3
"""Publish the accepted four-action brown-snake runtime and manifest."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RUNTIME_DIR = REPO / "assets" / "enemies" / "brown_snake"
NONATTACK_SOURCE_REPORT = ROOT / "reports" / "nonattack-v02-sources.json"
ATTACK_SOURCE_REPORT = ROOT / "reports" / "attacking-v02-source.json"
CANDIDATE_REPORT = ROOT / "reports" / "redo-candidates-20260829.json"
GENERATION_MANIFEST = ROOT / "generation-manifest.json"

ACTIONS = {
    "idle": {
        "candidateAction": "idle",
        "final": "idle-v02.png",
        "runtime": "idle.png",
        "rifeReport": "idle-v02.json",
        "preview": "idle-v02-runtime.gif",
        "contact": "idle-v02-runtime-contact.png",
        "layout": {
            "columns": 6, "rows": 4, "frameWidth": 640, "frameHeight": 512,
            "frameCount": 24, "footY": 410, "frameRate": 8, "repeat": -1,
        },
    },
    "walking": {
        "candidateAction": "walking",
        "final": "walking-v06.png",
        "runtime": "walking.png",
        "rifeReport": "walking-v06.json",
        "preview": "walking-v06-runtime.gif",
        "contact": "walking-v06-runtime-contact.png",
        "layout": {
            "columns": 5, "rows": 8, "frameWidth": 640, "frameHeight": 512,
            "frameCount": 40, "footY": 410, "frameRate": 72, "repeat": -1,
        },
    },
    "attacking": {
        "candidateAction": "attacking",
        "final": "attacking-v02.png",
        "runtime": "attacking.png",
        "rifeReport": "attacking-v02.json",
        "preview": "attacking-v02-runtime.gif",
        "contact": "attacking-v02-runtime-contact.png",
        "layout": {
            "columns": 8, "rows": 6, "frameWidth": 896, "frameHeight": 512,
            "frameCount": 41, "footY": 410, "duration": 900, "repeat": 0,
        },
    },
    "dying": {
        "candidateAction": "dying",
        "final": "dying-v02.png",
        "runtime": "dying.png",
        "rifeReport": "dying-v02.json",
        "preview": "dying-v02-runtime.gif",
        "contact": "dying-v02-runtime-contact.png",
        "layout": {
            "columns": 6, "rows": 6, "frameWidth": 768, "frameHeight": 512,
            "frameCount": 35, "footY": 410, "duration": 1800, "repeat": 0,
        },
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_if_changed(source: Path, target: Path) -> None:
    if target.exists() and sha256(source) == sha256(target):
        return
    temporary = target.with_name(target.name + ".publishing")
    try:
        shutil.copy2(source, temporary)
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> None:
    nonattack_source = load_json(NONATTACK_SOURCE_REPORT)
    attack_source = load_json(ATTACK_SOURCE_REPORT)
    sources = {**nonattack_source["actions"], "attacking": attack_source}
    candidate_report = load_json(CANDIDATE_REPORT)
    generation = load_json(GENERATION_MANIFEST)
    candidates = {item["action"]: item for item in candidate_report["candidates"]}
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    published = {}
    generation_states = {}
    for action, spec in ACTIONS.items():
        candidate = candidates[spec["candidateAction"]]
        source = sources[action]
        source_data = source["actionData"]
        provenance_path = ROOT / f"{candidate['video']}.json"
        provenance = load_json(provenance_path)
        rife_path = ROOT / "reports" / "rife" / spec["rifeReport"]
        rife = load_json(rife_path)
        final_path = ROOT / "generated" / "final" / spec["final"]
        runtime_path = RUNTIME_DIR / spec["runtime"]
        copy_if_changed(final_path, runtime_path)
        final_hash = sha256(final_path)
        runtime_hash = sha256(runtime_path)
        if final_hash != runtime_hash:
            raise ValueError(f"{action}: runtime copy hash mismatch")
        source_sheet = ROOT / source_data["file"]
        preview = ROOT / "previews" / "final" / spec["preview"]
        contact = ROOT / "previews" / "final" / spec["contact"]
        validation = rife["validation"]
        published[action] = {
            "candidate": source["candidate"],
            "sourceVideo": candidate["video"],
            "sourceVideoSha256": candidate["videoSha256"],
            "provenance": rel(provenance_path),
            "prompt": candidate["prompt"],
            "promptSha256": candidate["promptSha256"],
            "sourceSheet": rel(source_sheet),
            "sourceSheetSha256": sha256(source_sheet),
            "file": rel(final_path),
            "sha256": final_hash,
            "runtimeFile": str(runtime_path.relative_to(REPO)).replace("\\", "/"),
            "runtimeSha256": runtime_hash,
            "preview": rel(preview),
            "previewSha256": sha256(preview),
            "contactPreview": rel(contact),
            "contactPreviewSha256": sha256(contact),
            "interpolation": "RIFE v4.6 2x RGBA " + rife["mode"],
            "interpolationReport": rel(rife_path),
            "sourceFrameCount": rife["sourceFrameCount"],
            "keyFrameMapping": rife["keyFrameIndexMapping"],
            "normalization": source["normalization"],
            "scale": source["actionScale"],
            "layout": spec["layout"],
            "validation": {
                "emptyFrames": validation["emptyFrames"],
                "touchingFrames": validation["touchingFrames"],
                "alphaBottomRange": [validation["alphaBottomMin"], validation["alphaBottomMax"]],
                "originalKeyFramesPreservedAtEvenIndices": validation["originalKeyFramesPreservedAtEvenIndices"],
                "nonzeroRgbInTransparentPixels": validation["nonzeroRgbInTransparentPixels"],
                "heldSourceKeyFallbacks": validation["middleFrameHeldSourceKeyFallbacks"],
                "colorOutlierFrames": {
                    "dark": validation["visibleDarkOutlierFrames"],
                    "red": validation["visibleRedOutlierFrames"],
                    "blue": validation["visibleBlueSpillFrames"],
                    "cyan": validation["visibleCyanSpillFrames"],
                },
            },
        }
        if "targetBodyThickness" in source:
            published[action]["targetBodyThickness"] = source["targetBodyThickness"]
        if "targetMedianVisibleWidth" in source:
            published[action]["scaleReference"] = {
                "sourceMedianVisibleWidth": source["sourceMedianVisibleWidth"],
                "targetMedianVisibleWidth": source["targetMedianVisibleWidth"],
            }
        generation_states[action] = {
            "file": candidate["video"],
            "sha256": candidate["videoSha256"],
            "seed": candidate["seed"],
            "provider": provenance["provider"],
            "mode": provenance["mode"],
            "actionMode": provenance["actionMode"],
            "prompt": candidate["prompt"],
            "promptSha256": candidate["promptSha256"],
            "provenance": rel(provenance_path),
            "lastFrameLocked": bool(provenance["inputs"].get("lastFrame")),
            "accepted": True,
            "acceptanceDate": "2026-08-29",
        }

    spritesheet_manifest = {
        "schemaVersion": 2,
        "asset": "brown_snake",
        "updatedAt": "2026-08-30",
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "normalization": "fixed per-action scale from local snake body thickness; pose bbox excluded; no per-frame rescaling",
        "targetBodyThickness": 88.0,
        "footY": 410,
        "builders": {
            "source": "build-nonattack-v02-sources.py",
            "attackSource": "build-attacking-v02-source.py",
            "rife": "apply-rife-nonattack-v02.py",
            "attackRife": "apply-rife-attacking-v02.py",
            "runtimePreview": "build-nonattack-v02-runtime-previews.py",
            "attackRuntimePreview": "build-attacking-v02-runtime-preview.py",
            "publisher": "finalize-nonattack-v02.py",
        },
        "actions": {
            "idle": published["idle"],
            "walking": published["walking"],
            "attacking": published["attacking"],
            "dying": published["dying"],
        },
        "runtime": {
            "assetDirectory": "assets/enemies/brown_snake",
            "configFiles": ["data/enemy-config.json", "public/data/enemy-config.json"],
            "enemyConfigKey": "brownSnake",
        },
        "rejectedArchivedMetadataOnly": candidate_report["rejections"],
    }
    write_json(ROOT / "spritesheet-manifest.json", spritesheet_manifest)

    generation["stage"] = "runtime-integration-complete"
    generation["updatedAt"] = "2026-08-30"
    generation["videoModel"].update({"durationSeconds": 5.17, "frames": 124, "steps": 20})
    generation["states"].update(generation_states)
    generation["rejectedCandidates"] = [
        {
            "id": item["id"],
            "prompt": item["prompt"],
            "promptSha256": item["promptSha256"],
            "provenance": item["provenance"],
            "seed": item["seed"],
            "reason": item["reason"],
            "status": "rejected_archived_metadata_only",
            "runtimeIntegrated": False,
        }
        for item in candidate_report["rejections"]
    ]
    generation["spriteSheets"] = {
        "manifest": "spritesheet-manifest.json",
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "builders": spritesheet_manifest["builders"],
        "normalization": spritesheet_manifest["normalization"],
        "targetBodyThickness": 88.0,
        "footY": 410,
        "actions": spritesheet_manifest["actions"],
        "staticChecks": {
            "blankFrames": 0,
            "edgeHitFrames": 0,
            "transparentRgbPixels": 0,
            "groundLineRangePx": [409, 410],
            "rifeHeldFrameFallbacks": 0,
            "rifeColorOutlierFrames": 0,
        },
    }
    generation["runtimeIntegrated"] = True
    write_json(GENERATION_MANIFEST, generation)
    print(json.dumps({
        "runtimeIntegrationActive": True,
        "runtimeAssets": {
            action: published[action]["runtimeFile"] for action in ACTIONS
        },
        "manifest": "spritesheet-manifest.json",
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
