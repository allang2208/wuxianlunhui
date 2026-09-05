"""Read-only production gate: PNG layout and unique texture residency, not runtime QA."""
import argparse
import json
import math
import struct
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = Path(__file__).with_name("character-sprite-standard.json")
MIB = 1024 * 1024


def positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def png_size(path):
    with path.open("rb") as stream:
        header = stream.read(26)
    if len(header) != 26 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("not a PNG with an IHDR header")
    if header[24:26] != bytes((8, 6)):
        raise ValueError("runtime sprite must be 8-bit RGBA PNG")
    return struct.unpack(">II", header[16:24])


def inspect_manifest(manifest_path, policy):
    errors, warnings = [], []
    textures, paths, visited = {}, {}, set()
    visiting = set()
    manifests = []

    def visit(path):
        path = path.resolve()
        if path in visiting:
            errors.append(f"Cyclic dependency: {path}")
            return
        if path in visited:
            return
        visiting.add(path)
        try:
            document = json.loads(path.read_text(encoding="utf-8-sig"))
            if not isinstance(document, dict):
                raise ValueError("manifest must be an object")
        except (OSError, ValueError) as exc:
            errors.append(f"{path}: {exc}")
            visiting.remove(path)
            return

        asset_id = document.get("id")
        profile = document.get("profile")
        if not isinstance(asset_id, str) or not asset_id.strip():
            errors.append(f"{path}: missing id")
        if not isinstance(profile, str) or profile not in policy["profiles"]:
            errors.append(f"{path}: unknown profile {profile!r}")
            profile = None
        sheets = document.get("sheets")
        if not isinstance(sheets, list) or not sheets:
            errors.append(f"{path}: sheets must be a non-empty array")
            sheets = []
        own_keys = set()
        for index, sheet in enumerate(sheets):
            label = f"{asset_id}/sheets[{index}]"
            try:
                if not isinstance(sheet, dict):
                    raise ValueError("sheet must be an object")
                key, source = sheet.get("textureKey"), sheet.get("path")
                if not isinstance(key, str) or not key or not isinstance(source, str) or not source:
                    raise ValueError("textureKey and project-relative path are required")
                image_path = (PROJECT_ROOT / source).resolve()
                width, height = png_size(image_path)
                if not width or not height:
                    raise ValueError("empty PNG dimensions")
                if max(width, height) > policy["maxTextureSide"]:
                    errors.append(f"{label}: {width}x{height} exceeds texture-side budget")
                signature = (str(image_path), sheet.get("kind", "spritesheet"),
                             sheet.get("frameWidth"), sheet.get("frameHeight"),
                             sheet.get("frameCount"), sheet.get("endFrame"))
                if key in textures and textures[key]["signature"] != signature:
                    raise ValueError(f"texture key {key} has conflicting sources/layouts")
                if image_path in paths and paths[image_path] != key:
                    errors.append(f"{label}: same PNG loaded under both {paths[image_path]} and {key}")
                paths[image_path] = key
                textures[key] = {"signature": signature, "path": source,
                                 "width": width, "height": height, "bytes": width * height * 4}
                own_keys.add(key)
                if sheet.get("kind", "spritesheet") == "image":
                    continue
                if sheet.get("kind", "spritesheet") != "spritesheet":
                    raise ValueError("kind must be spritesheet or image")
                fw, fh, count = (sheet.get(name) for name in ("frameWidth", "frameHeight", "frameCount"))
                if not all(positive_int(value) for value in (fw, fh, count)):
                    raise ValueError("frameWidth/frameHeight/frameCount must be positive integers")
                if width % fw or height % fh:
                    raise ValueError("PNG dimensions must be exact multiples of frame dimensions")
                capacity = (width // fw) * (height // fh)
                if count > capacity or sheet.get("endFrame") != count - 1:
                    raise ValueError("frameCount exceeds capacity or endFrame is not frameCount - 1")
                if (capacity - count) / capacity > policy["maxUnusedCellFraction"]:
                    warnings.append(f"{label}: {(capacity - count) / capacity:.1%} unused cells; repack columns")
                for name, limit in (("footX", fw), ("footY", fh)):
                    value = sheet.get(name)
                    if (not isinstance(value, (int, float)) or isinstance(value, bool)
                            or not math.isfinite(value) or not 0 <= value <= limit):
                        raise ValueError(f"{name} must be a finite in-frame source-pixel anchor")
            except (OSError, ValueError, TypeError) as exc:
                errors.append(f"{label}: {exc}")
        own_bytes = sum(textures[key]["bytes"] for key in own_keys)
        manifests.append({"id": asset_id, "profile": profile, "directMiB": round(own_bytes / MIB, 3)})
        if profile in policy["profiles"] and own_bytes / MIB > policy["profiles"][profile]["reviewLimitMiB"]:
            errors.append(f"{asset_id}: direct textures exceed {profile} review limit")
        dependencies = document.get("dependencies", [])
        if not isinstance(dependencies, list):
            errors.append(f"{asset_id}: dependencies must be an array of manifest paths")
            dependencies = []
        for dependency in dependencies:
            if not isinstance(dependency, str) or not dependency:
                errors.append(f"{asset_id}: invalid dependency manifest path")
                continue
            visit(PROJECT_ROOT / dependency)
        visiting.remove(path)
        visited.add(path)

    visit(manifest_path)
    total = sum(texture["bytes"] for texture in textures.values()) / MIB
    root = manifests[0] if manifests else {}
    profile = root.get("profile")
    limits = policy["profiles"].get(profile, {})
    if limits and total > limits["reviewLimitMiB"]:
        errors.append(f"{root.get('id')}: dependency closure {total:.3f} MiB exceeds {profile} review limit")
    elif limits and total > limits["targetMiB"]:
        warnings.append(f"{root.get('id')}: dependency closure exceeds {profile} target; review before production")
    return {
        "standardVersion": policy["version"], "id": root.get("id"), "profile": profile,
        "textureCount": len(textures), "closureMiB": round(total, 3), "limits": limits,
        "manifests": manifests,
        "textures": [{"textureKey": key, "path": value["path"], "width": value["width"],
                      "height": value["height"], "MiB": round(value["bytes"] / MIB, 3)}
                     for key, value in textures.items()],
        "errors": errors, "warnings": warnings, "budgetPassed": not errors,
        "scope": "PNG headers, declared frame layout and unique texture bytes only; no alpha, motion or runtime validation",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8-sig"))
    report = inspect_manifest(args.manifest, policy)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["budgetPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
