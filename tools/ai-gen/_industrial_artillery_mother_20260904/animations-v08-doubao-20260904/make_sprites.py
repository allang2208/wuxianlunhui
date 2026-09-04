"""Approved Doubao video -> BiRefNet keys -> RIFE 2x -> timed sprite delivery.

All work remains task-local. This script never copies assets into runtime paths,
edits unit configuration, launches the game, or runs a build.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[1]
REPO = TOOLS.parents[1]
KINDS = ("idle", "run", "attack", "die")
PLAN = json.loads((ROOT / "sprite-production-plan.json").read_text(encoding="utf-8-sig"))
SCALE = float(PLAN["sourceScale"])
ANCHOR = PLAN["anchorInVideo"]
SAFETY = 6


def ensure_dirs() -> None:
    for folder in ("source-sheets", "final", "cache/birefnet", "cache/rife-preview", "previews", "logs"):
        (ROOT / folder).mkdir(parents=True, exist_ok=True)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def read_video(path: Path) -> tuple[list[Image.Image], float]:
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    frames: list[Image.Image] = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    cap.release()
    if not frames or fps <= 0:
        raise RuntimeError(f"Cannot decode source: {path}")
    return frames, fps


def layout(count: int, width: int, height: int) -> int:
    options = []
    for cols in range(1, min(count, 4096 // width) + 1):
        rows = math.ceil(count / cols)
        if rows * height <= 4096:
            options.append((cols * rows - count, abs(cols * width - rows * height), cols))
    if not options:
        raise RuntimeError(f"No single-sheet layout within 4096px for {count} cells of {width}x{height}")
    return min(options)[2]


def sheet_from(cells: list[Image.Image], cols: int) -> Image.Image:
    width, height = cells[0].size
    sheet = Image.new("RGBA", (width * cols, height * math.ceil(len(cells) / cols)))
    for index, cell in enumerate(cells):
        sheet.paste(cell, ((index % cols) * width, (index // cols) * height))
    return sheet


def remove_white_matte(cut: Image.Image) -> Image.Image:
    rgba = np.array(cut)
    alpha = rgba[..., 3]
    inside = ndimage.distance_transform_edt(alpha > 8)
    core = (alpha >= 250) & (inside > 2.5)
    if not core.any():
        return cut
    distance, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    rgb = rgba[..., :3].astype(np.int16)
    interior = rgb[nearest[0], nearest[1]]
    excess = rgb.min(axis=2) - interior.min(axis=2)
    edge = (alpha > 0) & (inside <= 2.5) & (distance <= 4) & (excess > 20)
    rgba[edge, :3] = interior[edge].astype(np.uint8)
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def clean_known_background_artifacts(cut: Image.Image) -> Image.Image:
    rgba = np.array(cut)
    # Doubao's UI watermark area is outside the approved group's silhouette.
    rgba[620:, 1160:] = 0
    rgba[rgba[..., 3] < 4] = 0
    rgba[rgba[..., 3] == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def attack_background_plate(frames: list[Image.Image]) -> np.ndarray:
    samples = [np.asarray(frames[i], dtype=np.float32) for i in [0, 4, 8, 12, 16, 20, 100, 104, 108, 112, 116, 120]]
    return np.median(np.stack(samples), axis=0)


def restore_attack_vfx(cut: Image.Image, source: Image.Image, plate: np.ndarray, source_frame: int) -> Image.Image:
    """Recover source-native flash/smoke that a subject mask may omit.

    Recovery is limited to the approved firing interval and the original
    right-side muzzle region. It derives only from the source frame relative to
    a no-fire background plate; nothing is painted outside the source canvas.
    """
    if not 30 <= source_frame <= 68:
        return cut
    rgba = np.array(cut)
    src = np.asarray(source, dtype=np.float32)
    x0, y0, y1 = 900, 110, 470
    src_region = src[y0:y1, x0:]
    bg_region = plate[y0:y1, x0:]
    dark_deficit = np.maximum(bg_region - src_region, 0).max(axis=2)
    maximum = src_region.max(axis=2)
    minimum = src_region.min(axis=2)
    warm = (
        (src_region[..., 0] > 175)
        & (src_region[..., 0] >= src_region[..., 1])
        & (src_region[..., 2] < src_region[..., 0] * 0.82)
        & (maximum - minimum > 45)
    )
    opacity = np.clip((dark_deficit - 7) / 150, 0, 1)
    opacity[warm] = np.maximum(opacity[warm], 0.92)
    candidate = (opacity > 0.025).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, connectivity=8)
    kept = np.zeros_like(candidate, dtype=bool)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area >= 12 or np.any(warm & (labels == label)):
            kept |= labels == label
    opacity[~kept] = 0
    alpha = np.rint(opacity * 255).astype(np.uint8)
    destination = rgba[y0:y1, x0:]
    replace = (alpha > destination[..., 3]) & (destination[..., 3] < 220)
    safe_opacity = np.maximum(opacity[..., None], 1 / 255)
    unmatte = np.clip((src_region - bg_region * (1 - opacity[..., None])) / safe_opacity, 0, 255)
    destination[replace, :3] = np.rint(unmatte[replace]).astype(np.uint8)
    destination[replace, 3] = alpha[replace]
    rgba[rgba[..., 3] == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def checker(cell: Image.Image) -> Image.Image:
    yy, xx = np.indices((cell.height, cell.width))
    shade = np.where((xx // 16 + yy // 16) % 2, 58, 43).astype(np.uint8)
    background = Image.fromarray(np.repeat(shade[..., None], 3, axis=2), "RGB")
    background.paste(cell, (0, 0), cell)
    return background


def contact(cells: list[Image.Image], kind: str, output: Path, labels: list[str] | None = None) -> None:
    selected = np.linspace(0, len(cells) - 1, min(16, len(cells)), dtype=int)
    cols = 4
    rows = math.ceil(len(selected) / cols)
    width, height = cells[0].size
    result = Image.new("RGB", (width * cols, (height + 22) * rows), "#20242a")
    draw = ImageDraw.Draw(result)
    for slot, index in enumerate(selected):
        x, y = slot % cols * width, slot // cols * (height + 22)
        result.paste(checker(cells[index]), (x, y + 22))
        label = labels[index] if labels else f"{kind} output {index}"
        draw.text((x + 4, y + 4), label, fill="white")
    result.save(output)


def selected_indices(kind: str, source_count: int) -> tuple[list[int], int, int]:
    action_plan = PLAN["actions"][kind]
    start = int(action_plan["sourceStartFrame"])
    end = min(int(action_plan["sourceEndFrameExclusive"]), source_count)
    step = int(action_plan["baseStep"])
    indices = list(range(start, end, step))
    for dense_start, dense_end in action_plan["denseRangesInclusive"]:
        indices.extend(range(max(start, dense_start), min(end - 1, dense_end) + 1))
    indices = sorted(set(indices))
    if not indices or indices[0] < start or indices[-1] >= end:
        raise RuntimeError(f"Invalid source selection for {kind}: {indices[:1]}..{indices[-1:]}, [{start},{end})")
    return indices, start, end


def keyframes(kinds: tuple[str, ...] | list[str]) -> None:
    source_manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    if source_manifest.get("status") != "all_four_source_actions_user_approved_for_sprite_production":
        raise RuntimeError("Current four-source approval is not recorded in manifest.json")
    sys.path.insert(0, str(TOOLS))
    from rmbg_cutout import get_model, predict_alpha

    model = get_model()
    cache = ROOT / "cache/birefnet"
    cache.mkdir(parents=True, exist_ok=True)
    for kind in kinds:
        action_plan = PLAN["actions"][kind]
        action = source_manifest["actions"][action_plan["manifestAction"]]
        if action.get("status") != "user_approved_source_video_for_sprite_production":
            raise RuntimeError(f"Unapproved source action: {kind}")
        video_path = ROOT / action["video"]
        frames, fps = read_video(video_path)
        indices, start, end = selected_indices(kind, len(frames))
        plate = attack_background_plate(frames) if kind == "attack" else None
        scaled: list[Image.Image] = []
        raw_bounds = []
        for order, source_index in enumerate(indices):
            cached = cache / f"{video_path.stem}-{source_index:04}.png"
            if cached.exists():
                cut = Image.open(cached).convert("RGBA")
            else:
                rgb = np.asarray(frames[source_index])
                alpha = np.asarray(predict_alpha(model, frames[source_index]), dtype=np.uint8)
                alpha[alpha < 4] = 0
                rgba = np.dstack([rgb, alpha])
                rgba[alpha == 0, :3] = 0
                cut = clean_known_background_artifacts(Image.fromarray(rgba, "RGBA"))
                cut.save(cached)
            if kind == "attack" and plate is not None:
                cut = restore_attack_vfx(cut, frames[source_index], plate, source_index)
            cut = remove_white_matte(cut)
            raw_bounds.append(cut.getchannel("A").getbbox())
            scaled.append(
                cut.resize(
                    tuple(round(value * SCALE) for value in cut.size),
                    Image.Resampling.LANCZOS,
                )
            )
            print(f"{kind}: BiRefNet key {order + 1}/{len(indices)} source {source_index}", flush=True)
        bounds = [cell.getchannel("A").getbbox() for cell in scaled]
        if any(bound is None for bound in bounds):
            raise RuntimeError(f"Empty cutout in {kind}; stop before RIFE.")
        center_x = round(ANCHOR[0] * SCALE)
        anchor_y = ANCHOR[1] * SCALE
        radius = max(max(center_x - bound[0], bound[2] - center_x) for bound in bounds) + SAFETY
        crop = (
            center_x - radius,
            min(bound[1] for bound in bounds) - SAFETY,
            center_x + radius,
            max(max(bound[3] for bound in bounds) + SAFETY, math.ceil(anchor_y) + SAFETY),
        )
        cells: list[Image.Image] = []
        for cell in scaled:
            rgba = np.array(cell.crop(crop))
            rgba[rgba[..., 3] == 0, :3] = 0
            cells.append(Image.fromarray(rgba, "RGBA"))
        width, height = cells[0].size
        cols = layout(len(cells), width, height)
        sheet_from(cells, cols).save(ROOT / f"source-sheets/{kind}-keys.png")
        durations = [
            (next_index - source_index) / fps * 1000
            for source_index, next_index in zip(indices, indices[1:] + [end])
        ]
        events = dict(PLAN.get("events", {}).get(kind, {}))
        for key, source_frame in list(events.items()):
            if source_frame not in indices:
                raise RuntimeError(f"Recorded event frame {source_frame} is not a selected {kind} key")
            events[key.replace("SourceFrame", "OutputFrame")] = indices.index(source_frame) * 2
        meta = {
            "kind": kind,
            "manifestAction": action_plan["manifestAction"],
            "video": action["video"],
            "sourceSha256": action["sha256"],
            "sourceFrames": len(frames),
            "sourceFps": fps,
            "sourceStartFrame": start,
            "sourceEndFrameExclusive": end,
            "sourceFrameIndices": indices,
            "sourceDurationsMs": durations,
            "durationMs": (end - start) / fps * 1000,
            "sourceScale": SCALE,
            "anchorInVideo": ANCHOR,
            "actionCropInScaledCanvas": list(crop),
            "footX": center_x - crop[0],
            "footY": anchor_y - crop[1],
            "frameWidth": width,
            "frameHeight": height,
            "sourceKeyCount": len(cells),
            "cols": cols,
            "rows": math.ceil(len(cells) / cols),
            "loop": bool(action_plan["loop"]),
            "sourceSheet": f"source-sheets/{kind}-keys.png",
            "keyEvents": events,
            "selectionReason": action_plan["selectionReason"],
            "rawAlphaBounds": raw_bounds,
            "canvasTransform": "One global scale and one crop per action; no per-frame recentering, fitting, foot locking or alpha-bottom alignment.",
            "cutout": "Cached ComfyUI-RMBG BiRefNet-general; task-local bottom-right watermark exclusion; local white-edge RGB cleanup.",
            "muzzleMatteRecovery": (
                {
                    "sourceFrames": [30, 68],
                    "sourceRegion": [900, 110, 1280, 470],
                    "method": "Source-minus-no-fire background plate; connected smoke/warm-flash recovery only where BiRefNet alpha is incomplete."
                }
                if kind == "attack"
                else None
            ),
            "runtimeIntegrationActive": False,
        }
        write_json(ROOT / f"source-sheets/{kind}-keys.json", meta)
        contact(
            cells,
            kind,
            ROOT / f"previews/{kind}-keys-transparent-contact.png",
            [f"{kind} source {index}" for index in indices],
        )
        print(f"{kind}: {len(cells)} keys, cell {width}x{height}, foot {meta['footX']:.2f}/{meta['footY']:.2f}", flush=True)


def interpolate(kinds: tuple[str, ...] | list[str]) -> None:
    for kind in kinds:
        meta = json.loads((ROOT / f"source-sheets/{kind}-keys.json").read_text(encoding="utf-8"))
        count = meta["sourceKeyCount"] * 2 - (0 if meta["loop"] else 1)
        cols = layout(count, meta["frameWidth"], meta["frameHeight"])
        command = [
            sys.executable,
            str(TOOLS / "rife-spritesheet-interpolate.py"),
            "--sheet", str(ROOT / meta["sourceSheet"]),
            "--out", str(ROOT / f"final/{kind}.png"),
            "--name", f"industrial-artillery-crew-{kind}",
            "--frame-width", str(meta["frameWidth"]),
            "--frame-height", str(meta["frameHeight"]),
            "--cols", str(meta["cols"]),
            "--frame-count", str(meta["sourceKeyCount"]),
            "--frame-rate", str(meta["sourceFps"] / PLAN["actions"][kind]["baseStep"]),
            "--mode", "loop" if meta["loop"] else "one-shot",
            "--out-cols", str(cols),
            "--preview-dir", str(ROOT / f"cache/rife-preview/{kind}"),
            "--report", str(ROOT / f"final/{kind}-rife.json"),
            "--repair-red-outliers",
            "--preserve-vertical-motion",
        ]
        with (ROOT / f"logs/{kind}-rife.log").open("w", encoding="utf-8") as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        print(f"{kind}: RIFE complete, {count} frames", flush=True)


def gif_durations(durations: list[float]) -> list[int]:
    return (np.diff(np.r_[0, np.rint(np.cumsum(durations) / 10).astype(int)]) * 10).tolist()


def package() -> None:
    labels = {"idle": "待机", "run": "跑动", "attack": "攻击", "die": "死亡"}
    manifest = {
        "unitKey": PLAN["unitKey"],
        "status": "transparent_sprites_ready_pending_user_review",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "profile": PLAN["profile"],
        "sourceManifest": "manifest.json",
        "sourceAnalysis": "source-analysis.json",
        "productionPlan": "sprite-production-plan.json",
        "sourceScale": SCALE,
        "anchorInVideo": ANCHOR,
        "referenceCell": PLAN["referenceCell"],
        "runtimeScale": None,
        "testsRun": False,
        "runtimeValidationRun": False,
        "formalBudgetCheckRun": False,
        "actions": {},
        "notes": [
            "The four user-approved Doubao source videos are preserved unchanged.",
            "Source keys remain at even output indices; RIFE creates only half-step odd frames.",
            "Each action retains its recorded effective source duration through per-frame timing metadata.",
            "No recruitment, combat, projectile, texture registration or game runtime integration is included."
        ],
    }
    budget = {
        "version": 1,
        "id": PLAN["unitKey"],
        "profile": PLAN["profile"],
        "runtimeIntegrationActive": False,
        "textureKeysAreProposedOnly": True,
        "dependencies": [],
        "sheets": [],
    }
    total = 0.0
    for kind in KINDS:
        meta = json.loads((ROOT / f"source-sheets/{kind}-keys.json").read_text(encoding="utf-8"))
        report = json.loads((ROOT / f"final/{kind}-rife.json").read_text(encoding="utf-8"))
        sheet = Image.open(ROOT / f"final/{kind}.png").convert("RGBA")
        count, cols = report["outputFrameCount"], report["cols"]
        width, height = meta["frameWidth"], meta["frameHeight"]
        cells = [
            sheet.crop((index % cols * width, index // cols * height, index % cols * width + width, index // cols * height + height))
            for index in range(count)
        ]
        durations: list[float] = []
        for index, duration in enumerate(meta["sourceDurationsMs"]):
            durations.extend([duration / 2, duration / 2] if meta["loop"] or index < len(meta["sourceDurationsMs"]) - 1 else [duration])
        preview_cells = [checker(cell).resize((width * 2, height * 2), Image.Resampling.NEAREST) for cell in cells]
        palette_source = Image.new("RGB", (128, 72 * len(preview_cells)))
        for index, frame in enumerate(preview_cells):
            palette_source.paste(frame.resize((128, 72)), (0, index * 72))
        palette = palette_source.quantize(colors=255)
        indexed = [frame.quantize(palette=palette) for frame in preview_cells]
        preview_path = f"previews/{kind}-transparent-runtime-clock.gif"
        indexed[0].save(
            ROOT / preview_path,
            save_all=True,
            append_images=indexed[1:],
            duration=gif_durations(durations),
            loop=0,
            disposal=2,
            optimize=False,
        )
        contact(cells, kind, ROOT / f"previews/{kind}-transparent-contact.png")
        decoded_mib = sheet.width * sheet.height * 4 / 1024**2
        total += decoded_mib
        action = {
            **meta,
            "sheet": f"final/{kind}.png",
            "sheetSha256": sha256(ROOT / f"final/{kind}.png"),
            "frameCount": count,
            "endFrame": count - 1,
            "cols": cols,
            "rows": report["rows"],
            "sheetSize": list(sheet.size),
            "decodedMiB": decoded_mib,
            "frameDurationsMs": durations,
            "gifDurationsMs": gif_durations(durations),
            "preview": preview_path,
            "previewSha256": sha256(ROOT / preview_path),
            "contact": f"previews/{kind}-transparent-contact.png",
            "rifeReport": f"final/{kind}-rife.json",
            "sourceKeyMapping": "outputIndex = sourceKeyIndex * 2",
        }
        manifest["actions"][kind] = action
        budget["sheets"].append(
            {
                "textureKey": f"candidate_{PLAN['unitKey']}_{kind}",
                "path": (ROOT / f"final/{kind}.png").relative_to(REPO).as_posix(),
                "kind": "spritesheet",
                **{key: action[key] for key in ("frameWidth", "frameHeight", "frameCount", "endFrame", "footX", "footY")},
            }
        )
    manifest["decodedMiB"] = total
    manifest["budgetScope"] = "Four task-local candidate action sheets only; source videos, GIFs, contacts, key sheets and RIFE caches are not runtime textures."
    manifest["targetMiB"] = PLAN["targetMiB"]
    manifest["admissionLimitMiB"] = PLAN["admissionLimitMiB"]
    write_json(ROOT / "spritesheet-manifest.json", manifest)
    write_json(ROOT / "sprite-budget-manifest.json", budget)

    source_manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    source_manifest["status"] = "transparent_sprites_ready_pending_user_review"
    source_manifest["budget"]["actualDecodedMiB"] = total
    source_manifest["spriteProducts"] = {
        "productionPlan": "sprite-production-plan.json",
        "manifest": "spritesheet-manifest.json",
        "budgetManifest": "sprite-budget-manifest.json",
        "delivery": "SPRITES-DELIVERY.md",
        "status": "ready_pending_offline_checks_and_user_review",
    }
    for kind, action in manifest["actions"].items():
        source_key = PLAN["actions"][kind]["manifestAction"]
        source_manifest["actions"][source_key]["status"] = "transparent_sprite_candidate_ready_pending_user_review"
        source_manifest["actions"][source_key]["spriteProduct"] = {
            "sheet": action["sheet"],
            "preview": action["preview"],
            "contact": action["contact"],
            "frameCount": action["frameCount"],
            "endFrame": action["endFrame"],
        }
    write_json(ROOT / "manifest.json", source_manifest)

    task_index_path = ROOT.parent / "task-index.json"
    task_index = json.loads(task_index_path.read_text(encoding="utf-8-sig"))
    task_index["status"] = "transparent_sprites_ready_pending_user_review"
    task_index["animationGate"]["status"] = "transparent_sprites_ready_pending_user_review"
    task_index["animationGate"]["spriteManifest"] = "animations-v08-doubao-20260904/spritesheet-manifest.json"
    task_index["animationGate"]["runtimeIntegrationActive"] = False
    write_json(task_index_path, task_index)

    PLAN["productionStatus"] = "transparent_sprites_ready_pending_offline_checks_and_user_review"
    PLAN["actualDecodedMiB"] = total
    write_json(ROOT / "sprite-production-plan.json", PLAN)

    lines = [
        "# 仓鼠近代炮兵组透明动画交付",
        "",
        "四套用户认可源片已按标准完成透明关键帧、RIFE 2× 精灵图和运行时钟 GIF；未导入游戏。",
        "",
        "| 动作 | 有效源区间 | 关键帧 → 成品帧 | 每格尺寸 | 图集尺寸 | RGBA MiB | 脚点 x/y |",
        "|---|---|---:|---|---|---:|---|",
    ]
    for kind, action in manifest["actions"].items():
        lines.append(
            f"| {labels[kind]} | [{action['sourceStartFrame']},{action['sourceEndFrameExclusive']}) | "
            f"{action['sourceKeyCount']} → {action['frameCount']} | {action['frameWidth']}×{action['frameHeight']} | "
            f"{action['sheetSize'][0]}×{action['sheetSize'][1]} | {action['decodedMiB']:.2f} | "
            f"{action['footX']:.2f}/{action['footY']:.2f} |"
        )
    lines += [
        "",
        f"四动作图集合计 **{total:.2f} MiB**；crowd 目标 {PLAN['targetMiB']} MiB、准入上限 {PLAN['admissionLimitMiB']} MiB。",
        "",
        "统一制作比例为 0.26，固定原画布地面锚点为 (640,571)。动作间只改变固定紧裁框，不逐帧缩放、居中、拉直或抬脚。",
        "待机使用源 19→119 的 4.167 秒稳定环；跑动使用源 70→118 的 2.000 秒自然步态环；攻击和死亡保留完整 121 帧源时长，关键动作段使用原生密集姿态。",
        "RIFE 循环动作按 N→2N 并补末→首中间帧；单次动作按 N→2N-1 且不回插首帧。所有原始关键帧保留在成品偶数索引。",
        "攻击源第34帧为炮口事件；死亡源第28帧为炮弹完全脱手记录、第72帧起为两人均倒地保持。事件仅记录视觉时间，未写入战斗逻辑。",
        "",
        "## 接入边界",
        "",
        "没有新增招募、科技、伤害、弹道、音效或正式纹理注册；没有复制到 assets/companions，也没有修改运行时配置。",
        "正式预算与离线精灵检查由 sprite-validation-report.json 记录；游戏、测试、构建和运行时验证未运行。",
        "",
        "## 文件与预览",
        "",
        "spritesheet-manifest.json 是图集、时长、源帧和事件真源；sprite-budget-manifest.json 是候选预算清单；source-sheets/ 保存未插帧关键帧；final/ 保存正式精灵图与 RIFE 报告。",
        "",
    ]
    for kind, action in manifest["actions"].items():
        lines += [
            f"### {labels[kind]}",
            "",
            f"[原视频]({(ROOT / action['video']).as_posix()}) · [透明精灵图]({(ROOT / action['sheet']).as_posix()})",
            "",
            f"![{labels[kind]}]({(ROOT / action['preview']).as_posix()})",
            "",
        ]
    (ROOT / "SPRITES-DELIVERY.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Four transparent candidate sheets: {total:.2f} MiB; no runtime import.", flush=True)


if __name__ == "__main__":
    ensure_dirs()
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("keys", "interpolate", "package"))
    parser.add_argument("--kinds", nargs="+", choices=KINDS, default=list(KINDS))
    args = parser.parse_args()
    if args.stage == "keys":
        keyframes(args.kinds)
    elif args.stage == "interpolate":
        interpolate(args.kinds)
    else:
        package()
