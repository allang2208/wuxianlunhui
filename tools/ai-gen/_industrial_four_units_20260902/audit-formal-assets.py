"""Offline contract audit for the four industrial-era III sprite packages.

This is deliberately not a game/runtime test.  It checks the formal build
report, mirrored configs and actual PNG cells, and emits the evidence used for
the user-facing GIF acceptance pass.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BUILD_REPORT = ROOT / "formal-build-report.json"
AUDIT_JSON = ROOT / "formal-animation-audit.json"
AUDIT_MD = ROOT / "FORMAL-ANIMATION-AUDIT.md"

UNITS = {
    "service_rifleman": {
        "label": "制式步枪兵",
        "config": "hamster-service-rifleman-config.json",
        "event": "ranged",
        "launchField": "attackLaunchFrame",
    },
    "emplaced_machine_gun_crew": {
        "label": "BAR 自动步枪兵",
        "config": "hamster-bar-automatic-rifleman-config.json",
        "event": "burst",
        "launchField": "attackLaunchFrames",
    },
    "industrial_carbine_cavalry": {
        "label": "近代骑枪兵",
        "config": "hamster-industrial-carbine-cavalry-config.json",
        "event": "ranged",
        "launchField": "attackLaunchFrame",
    },
    "gunpowder_explosive_lancer": {
        "label": "传统长矛重骑兵",
        "config": "hamster-industrial-heavy-lancer-config.json",
        "event": "melee_charge",
    },
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def extract_cells(path: Path, action: dict) -> tuple[np.ndarray, list[np.ndarray]]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    fw = int(action["frameWidth"])
    fh = int(action["frameHeight"])
    cols = int(action["cols"])
    cells = []
    for index in range(int(action["finalFrameCount"])):
        row, col = divmod(index, cols)
        cells.append(sheet[row * fh:(row + 1) * fh, col * fw:(col + 1) * fw].copy())
    return sheet, cells


def alpha_bbox(frame: np.ndarray, threshold: int = 12) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def frame_delta(left: np.ndarray, right: np.ndarray) -> float:
    mask = (left[..., 3] > 10) | (right[..., 3] > 10)
    if not mask.any():
        return 0.0
    a = left.astype(np.float32)
    b = right.astype(np.float32)
    return float(np.abs(a - b)[mask].mean())


def longest_below(values: list[float], threshold: float) -> int:
    longest = 0
    current = 0
    for value in values:
        current = current + 1 if value < threshold else 0
        longest = max(longest, current)
    return longest


def muzzle_tip(frame: np.ndarray) -> tuple[int, int]:
    mask = frame[..., 3] > 12
    height, width = mask.shape
    mask[:, :width // 2] = False
    ys, xs = np.where(mask)
    if not len(xs):
        raise RuntimeError("No visible right-facing muzzle geometry")
    tip_x = int(xs.max())
    tip_ys, _ = np.where(mask[:, max(width // 2, tip_x - 5):tip_x + 1])
    tip_y = int(round(float(np.median(tip_ys))))
    return tip_x, tip_y


def animation_config_matches(config_action: dict, report_action: dict) -> bool:
    expected = {
        "frameWidth": int(report_action["frameWidth"]),
        "frameHeight": int(report_action["frameHeight"]),
        "footY": int(report_action["footY"]),
        "cols": int(report_action["cols"]),
        "rows": int(report_action["rows"]),
        "frameCount": int(report_action["finalFrameCount"]),
        "frames": [0, int(report_action["finalFrameCount"]) - 1],
        "frameRate": float(report_action["frameRate"]),
        "repeat": int(report_action["repeat"]),
    }
    for key, value in expected.items():
        actual = config_action.get(key)
        if isinstance(value, float):
            if not math.isclose(float(actual), value, rel_tol=0, abs_tol=1e-6):
                return False
        elif actual != value:
            return False
    return True


def main() -> None:
    build = read_json(BUILD_REPORT)
    audit: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-02",
        "scope": "offline sprite/config/attack-event audit; no game runtime",
        "standards": {
            "oneFixedScaleAndAnchorPerAction": True,
            "single2xRifePass": True,
            "loopRepairUsesOpeningPoseAfterEndpointComparison": True,
            "noPerFrameFitOrRecenter": True,
            "noFixedCoordinateBodyErase": True,
            "checkerContactsReviewedOffline": True,
        },
        "units": {},
    }
    overall = True

    for unit_key, meta in UNITS.items():
        report_unit = build["units"][unit_key]
        data_path = REPO / "data" / meta["config"]
        public_path = REPO / "public" / "data" / meta["config"]
        config = read_json(data_path)
        public_config = read_json(public_path)
        unit_checks: dict[str, object] = {
            "label": meta["label"],
            "configParity": config == public_config,
            "displaySize": float(config["displaySize"]),
            "targetEffectiveBodyHeight": float(report_unit["targetEffectiveBodyHeight"]),
            "desiredWorldBodyHeight": float(report_unit["desiredWorldBodyHeight"]),
            "actions": {},
        }
        overall &= bool(unit_checks["configParity"])

        for action_name, action in report_unit["actions"].items():
            config_key = action["configKey"]
            config_action = config["animations"][config_key]
            sheet_path = REPO / action["runtimeSheet"]
            sheet, cells = extract_cells(sheet_path, action)
            fw = int(action["frameWidth"])
            fh = int(action["frameHeight"])
            cols = int(action["cols"])
            rows = int(action["rows"])
            bboxes = [alpha_bbox(cell) for cell in cells]
            blank = [i for i, bbox in enumerate(bboxes) if bbox is None]
            touching = [
                i for i, bbox in enumerate(bboxes)
                if bbox is not None and (bbox[0] <= 0 or bbox[1] <= 0
                                         or bbox[2] >= fw - 1 or bbox[3] >= fh - 1)
            ]
            transparent_rgb = max(
                int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
            )
            scale_height = (
                float(action["sourceMedianUprightBodyHeight"])
                * float(action["fixedActionScale"])
            )
            world_height = scale_height * float(config["displaySize"]) / 512.0
            world_error = abs(world_height - float(report_unit["desiredWorldBodyHeight"]))
            layout_ok = animation_config_matches(config_action, action)
            action_ok = all((
                sheet.shape[1] == cols * fw,
                sheet.shape[0] == rows * fh,
                not blank,
                not touching,
                transparent_rgb == 0,
                abs(scale_height - float(report_unit["targetEffectiveBodyHeight"])) < 1e-6,
                world_error < 0.05,
                layout_ok,
                action["alphaCleanup"]["fixedCoordinateEraseUsed"] is False,
            ))
            result: dict[str, object] = {
                "pass": action_ok,
                "layoutMatchesConfig": layout_ok,
                "sheetPixels": [int(sheet.shape[1]), int(sheet.shape[0])],
                "cellPixels": [fw, fh],
                "grid": [cols, rows],
                "frameCount": int(action["finalFrameCount"]),
                "frameRate": float(action["frameRate"]),
                "repeat": int(action["repeat"]),
                "footY": int(action["footY"]),
                "alphaBottomRange": [
                    int(action["validation"]["feetMin"]),
                    int(action["validation"]["feetMax"]),
                ],
                "blankFrames": blank,
                "touchingFrames": touching,
                "nonzeroRgbInTransparentPixels": transparent_rgb,
                "fixedActionScale": float(action["fixedActionScale"]),
                "calibratedBodyHeightPixels": scale_height,
                "calibratedWorldBodyHeight": world_height,
                "worldBodyHeightError": world_error,
                "fixedSourceAnchor": action["fixedSourceAnchor"],
                "fixedCoordinateEraseUsed": False,
            }
            if action_name == "running":
                source_indices = [int(value) for value in action["sourceIndices"]]
                contiguous = source_indices == list(range(source_indices[0], source_indices[-1] + 1))
                seam = float(action["validation"]["loopSeamDelta"])
                adjacent = max(1e-9, float(action["validation"]["adjacentDeltaMean"]))
                seam_ratio = seam / adjacent
                frame_deltas = [frame_delta(left, right) for left, right in zip(cells, cells[1:])]
                median_delta = max(1e-9, float(np.median(frame_deltas)))
                near_frozen_threshold = max(2.0, median_delta * 0.1)
                frozen_streak = longest_below(frame_deltas, near_frozen_threshold)
                loop_ok = (
                    contiguous
                    and float(action["frameRate"]) == 48.0
                    and seam_ratio <= 2.0
                    and frozen_streak <= 2
                )
                result["loop"] = {
                    "pass": loop_ok,
                    "sourceIntervalContiguous": contiguous,
                    "sourceInterval": [source_indices[0], source_indices[-1]],
                    "reviewedEndpointRawFrame": int(action["loopEndpointRawFrame"]),
                    "endpointUsedAsRifeInput": bool(action["loopEndpointUsedAsRifeInput"]),
                    "repairTargetRawFrame": int(action["loopRepairTargetRawFrame"]),
                    "seamDelta": seam,
                    "adjacentDeltaMean": adjacent,
                    "adjacentDeltaMedian": median_delta,
                    "seamToAdjacentRatio": seam_ratio,
                    "acceptanceLimit": 2.0,
                    "nearFrozenTransitionThreshold": near_frozen_threshold,
                    "longestNearFrozenTransitionStreak": frozen_streak,
                    "maximumNearFrozenTransitionStreak": 2,
                }
                action_ok &= loop_ok
                result["pass"] = action_ok
            elif action_name == "charging" and unit_key == "gunpowder_explosive_lancer":
                charge = config["ai"]["charge"]
                impact_frame = int(action["impactFrame"])
                hit_end_frame = int(action["hitEndFrame"])
                duration_ms = (
                    int(action["finalFrameCount"]) / float(action["frameRate"]) * 1000.0
                )
                deltas = [frame_delta(left, right) for left, right in zip(cells, cells[1:])]
                adjacent_median = max(1e-9, float(np.median(deltas)))
                closing_pose_delta = frame_delta(cells[0], cells[-1])
                closing_pose_ratio = closing_pose_delta / adjacent_median
                final_settle_median = float(np.median(deltas[-4:]))
                charge_ok = all((
                    str(action["sourceVideo"]).endswith("charging-h3-v02.mp4"),
                    int(action["repeat"]) == 0,
                    int(charge["frames"]) == int(action["finalFrameCount"]),
                    math.isclose(
                        float(charge["frameRate"]), float(action["frameRate"]),
                        rel_tol=0, abs_tol=1e-6,
                    ),
                    int(charge["hitStartFrame"]) == impact_frame,
                    int(charge["hitEndFrame"]) == hit_end_frame,
                    impact_frame <= hit_end_frame < int(action["finalFrameCount"]),
                    bool(charge["completeAnimationAfterHit"]),
                    abs(float(charge["maxDuration"]) - duration_ms) <= 1.0,
                    closing_pose_ratio <= 0.75,
                    final_settle_median <= adjacent_median,
                ))
                result["phaseTiming"] = {
                    "pass": charge_ok,
                    "sourceVideo": action["sourceVideo"],
                    "sequence": [
                        "raised-lance ready",
                        "lower and accelerate",
                        "fully extended impact",
                        "recoil and decelerate",
                        "raised-lance planted ready",
                    ],
                    "impactFrame1Based": impact_frame,
                    "activeHitWindowFrames1Based": [impact_frame, hit_end_frame],
                    "recoveryFrames1Based": [
                        hit_end_frame + 1, int(action["finalFrameCount"])
                    ],
                    "postImpactFrameCount": int(action["finalFrameCount"]) - impact_frame,
                    "durationMs": duration_ms,
                    "configuredMaxDurationMs": float(charge["maxDuration"]),
                    "completeAnimationAfterHit": bool(charge["completeAnimationAfterHit"]),
                    "closingPoseDelta": closing_pose_delta,
                    "adjacentDeltaMedian": adjacent_median,
                    "closingPoseToAdjacentRatio": closing_pose_ratio,
                    "closingPoseAcceptanceLimit": 0.75,
                    "finalFourTransitionsMedian": final_settle_median,
                }
                action_ok &= charge_ok
                result["pass"] = action_ok
            unit_checks["actions"][action_name] = result
            overall &= action_ok

        attack = report_unit["actions"]["attacking"]
        attack_cells = extract_cells(REPO / attack["runtimeSheet"], attack)[1]
        event: dict[str, object] = {"kind": meta["event"]}
        if meta["event"] in ("ranged", "burst"):
            report_frames = [int(value) for value in attack["releaseFrames"]]
            field_value = config["ai"][meta["launchField"]]
            config_frames = (
                [int(value) for value in field_value]
                if isinstance(field_value, list) else [int(field_value)]
            )
            points = [muzzle_tip(attack_cells[frame - 1]) for frame in report_frames]
            point_x = float(np.median([point[0] for point in points]))
            point_y = float(np.median([point[1] for point in points]))
            fw = float(attack["frameWidth"])
            foot_y = float(attack["footY"])
            configured_anchor = config["render"]["projectileMuzzle"]
            sprite_offset = float(config.get("spriteOffsetY", 0))
            display_size = float(config["displaySize"])
            visible_x = point_x - fw * 0.5
            visible_y = point_y - foot_y
            configured_x = (float(configured_anchor["x"]) - 0.5) * 512.0
            configured_y = (
                sprite_offset / display_size * 512.0
                + (float(configured_anchor["y"]) - 0.5) * 512.0
            )
            recommended = {
                "x": 0.5 + visible_x / 512.0,
                "y": 0.5 + visible_y / 512.0 - sprite_offset / display_size,
            }
            delta = [configured_x - visible_x, configured_y - visible_y]
            event_ok = (
                config_frames == report_frames
                and max(report_frames) <= int(attack["finalFrameCount"])
                and abs(delta[0]) <= 12.0
                and abs(delta[1]) <= 14.0
            )
            event.update({
                "pass": event_ok,
                "configReleaseFrames1Based": config_frames,
                "sourceMappedReleaseFrames1Based": report_frames,
                "releaseTimesMs": [
                    (frame - 1) / float(attack["frameRate"]) * 1000.0
                    for frame in report_frames
                ],
                "visibleMuzzlePixels": [point_x, point_y],
                "configuredCanonicalOffsetPixels": [configured_x, configured_y],
                "visibleCanonicalOffsetPixels": [visible_x, visible_y],
                "configuredMinusVisiblePixels": delta,
                "recommendedProjectileMuzzle": recommended,
            })
        else:
            impact_frame = int(attack["impactFrame"])
            configured_frame = int(config["ai"]["attackDamageFrame"])
            impact_cell = attack_cells[impact_frame - 1]
            tip_x, _ = muzzle_tip(impact_cell)
            visible_reach = (
                (tip_x - float(attack["frameWidth"]) * 0.5)
                * float(config["displaySize"]) / 512.0
            )
            approach_range = float(config["ai"]["attackRange"])
            impact_range = float(config["ai"]["attackImpactRange"])
            charge = config["ai"]["charge"]
            event_ok = all((
                configured_frame == impact_frame,
                abs(visible_reach - approach_range) <= 24.0,
                impact_range >= approach_range,
                int(charge["hitStartFrame"]) == int(
                    report_unit["actions"]["charging"]["impactFrame"]
                ),
                int(charge["hitEndFrame"]) == int(
                    report_unit["actions"]["charging"]["hitEndFrame"]
                ),
                int(charge["hitEndFrame"]) < int(charge["frames"]),
                bool(charge["completeAnimationAfterHit"]),
            ))
            event.update({
                "pass": event_ok,
                "attackDamageFrame1Based": configured_frame,
                "sourceMappedImpactFrame1Based": impact_frame,
                "impactTimeMs": (impact_frame - 1) / float(attack["frameRate"]) * 1000.0,
                "visibleLanceReachWorld": visible_reach,
                "attackApproachRange": approach_range,
                "attackImpactRange": impact_range,
                "chargeHitWindowFrames1Based": [
                    int(charge["hitStartFrame"]), int(charge["hitEndFrame"])
                ],
                "chargeLoweredLanceFrame1Based": int(
                    report_unit["actions"]["charging"]["impactFrame"]
                ),
                "chargeHitRangePlusTargetFootprint": True,
            })
        unit_checks["attackEvent"] = event
        overall &= bool(event["pass"])
        audit["units"][unit_key] = unit_checks

    audit["pass"] = overall
    AUDIT_JSON.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# 四个近代 III 级兵种动画离线审计",
        "",
        f"- 结果：{'通过' if overall else '未通过'}",
        "- 边界：只做贴图、配置、事件映射与联系图离线检查；未启动游戏、浏览器、测试或构建。",
        "- 缩放合同：每动作一个固定等比缩放和固定根点；运行时统一 `displaySize / 512`，无逐帧放大、拟合或重居中。",
        "- 抠图合同：BiRefNet 语义蒙版 + 与画布边缘连通的低置信浅色残留清理；禁止固定坐标擦除身体。",
        "",
        "| 兵种 | 动作 | 格尺寸 | 帧数@fps | 脚线 | 世界主体高 | 结果 |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for unit_key, unit in audit["units"].items():
        for action_name, action in unit["actions"].items():
            lines.append(
                f"| {unit['label']} | {action_name} | "
                f"{action['cellPixels'][0]}×{action['cellPixels'][1]} | "
                f"{action['frameCount']}@{action['frameRate']:g} | {action['footY']} | "
                f"{action['calibratedWorldBodyHeight']:.3f} | "
                f"{'通过' if action['pass'] else '未通过'} |"
            )
    lines += [
        "",
        "## 跑动循环",
        "",
        "| 兵种 | 原生连续区间 | 最终帧 | 接缝/相邻均值 | 最长近冻结连续段 | 结果 |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for unit in audit["units"].values():
        action = unit["actions"]["running"]
        loop = action["loop"]
        lines.append(
            f"| {unit['label']} | {loop['sourceInterval'][0]}–{loop['sourceInterval'][1]} | "
            f"{action['frameCount']}@{action['frameRate']:g} | "
            f"{loop['seamToAdjacentRatio']:.3f} | "
            f"{loop['longestNearFrozenTransitionStreak']} | "
            f"{'通过' if loop['pass'] else '未通过'} |"
        )
    charge_action = audit["units"]["gunpowder_explosive_lancer"]["actions"]["charging"]
    phase = charge_action["phaseTiming"]
    lines += [
        "",
        "## 重骑冲锋完整动作",
        "",
        "- 动作相位：抬枪待机 → 压枪加速 → 完全伸展命中 → 后坐减速 → 抬枪四足站稳。",
        f"- 正式动画：{charge_action['frameCount']}帧@{charge_action['frameRate']:g}fps，"
        f"{phase['durationMs']:.0f}ms，一次性播放；配置最大时长{phase['configuredMaxDurationMs']:.0f}ms。",
        f"- 有效命中窗：第{phase['activeHitWindowFrames1Based'][0]}–"
        f"{phase['activeHitWindowFrames1Based'][1]}帧；第"
        f"{phase['recoveryFrames1Based'][0]}–{phase['recoveryFrames1Based'][1]}帧只负责恢复，不继续判伤。",
        f"- 收尾姿势/相邻动作差比：{phase['closingPoseToAdjacentRatio']:.3f}"
        f"（上限{phase['closingPoseAcceptanceLimit']:.2f}）；结果："
        f"{'通过' if phase['pass'] else '未通过'}。",
    ]
    lines += [
        "",
        "## 攻击事件",
        "",
        "| 兵种 | 贴图事件帧（1-based） | 配置事件帧（1-based） | 结果 |",
        "|---|---:|---:|---|",
    ]
    for unit in audit["units"].values():
        event = unit["attackEvent"]
        if event["kind"] in ("ranged", "burst"):
            mapped = ", ".join(map(str, event["sourceMappedReleaseFrames1Based"]))
            configured = ", ".join(map(str, event["configReleaseFrames1Based"]))
        else:
            mapped = str(event["sourceMappedImpactFrame1Based"])
            configured = str(event["attackDamageFrame1Based"])
        lines.append(
            f"| {unit['label']} | {mapped} | {configured} | "
            f"{'通过' if event['pass'] else '未通过'} |"
        )
    AUDIT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"pass": overall, "report": str(AUDIT_JSON), "markdown": str(AUDIT_MD)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
