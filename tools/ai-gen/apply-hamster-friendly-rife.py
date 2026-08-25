#!/usr/bin/env python3
"""Apply the mandatory 2x RIFE pass to every runtime hamster friendly unit."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "tools" / "ai-gen" / "_hamster_friendly_rife_20260825"
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
PIPELINE_VERSION = "rife-v4.6-rgba-v2-temporal-dark-repair"
BACKUP_DIR = ROOT / "source-sheets-pre-interpolation"
CONFIG_BACKUP_DIR = ROOT / "source-configs-pre-interpolation"
REPORT_DIR = ROOT / "interpolation-reports"
PREVIEW_DIR = ROOT / "previews"
STAGED_DIR = ROOT / "staged-assets"
SUMMARY_PATH = ROOT / "interpolation-report.json"

UNIT_CONFIGS = [
    "hamster-warrior-config.json",
    "hamster-guard-config.json",
    "hamster-militia-config.json",
    "hamster-shooter-config.json",
    "hamster-scout-config.json",
    "hamster-musketeer-config.json",
    "hamster-priest-config.json",
    "hamster-knight-config.json",
    "hamster-light-cavalry-config.json",
    "hamster-explorer-config.json",
    "hamster-bounty-hunter-config.json",
    "hamster-camel-cavalry-config.json",
    "hamster-miner-config.json",
]


def doubled_one_based_frame(value: int) -> int:
    return (int(value) - 1) * 2 + 1


def process_action(
    unit_id: str, action_name: str, action: dict[str, object]
) -> tuple[dict[str, object], Path, Path] | None:
    source_count = int(action.get("frameCount", 1))
    if source_count <= 1:
        return None
    runtime_sheet = REPO / str(action["src"])
    relative_asset = runtime_sheet.relative_to(REPO / "assets" / "companions")
    backup_sheet = BACKUP_DIR / relative_asset
    staged_sheet = STAGED_DIR / relative_asset
    source_sheet = backup_sheet if backup_sheet.exists() else runtime_sheet
    repeat = int(action.get("repeat", 0))
    mode = "loop" if repeat == -1 else "one-shot"
    loop_range = action.get("loopFrames") or action.get("frames") or [0, source_count - 1]
    loop_start = int(loop_range[0]) if mode == "loop" else 0
    source_rate = float(action.get("frameRate", action.get("startFrameRate", 1)))
    report_path = REPORT_DIR / unit_id / f"{action_name}.json"
    command = [
        sys.executable,
        str(TOOL),
        "--sheet", str(source_sheet),
        "--out", str(staged_sheet),
        "--name", f"{unit_id}-{action_name}",
        "--frame-width", str(int(action.get("frameWidth", 512))),
        "--frame-height", str(int(action.get("frameHeight", 512))),
        "--cols", str(int(action.get("cols", 8))),
        "--frame-count", str(source_count),
        "--frame-rate", str(source_rate),
        "--mode", mode,
        "--loop-start-index", str(loop_start),
        "--out-cols", "8",
        "--preview-dir", str(PREVIEW_DIR / unit_id),
        "--report", str(report_path),
    ]
    if not backup_sheet.exists():
        command.extend(["--backup", str(backup_sheet)])
    existing_report = None
    if report_path.exists():
        existing_report = json.loads(report_path.read_text(encoding="utf-8"))
    reusable = (
        staged_sheet.exists()
        and existing_report is not None
        and existing_report.get("pipelineVersion") == PIPELINE_VERSION
    )
    if not reusable:
        subprocess.run(command, check=True)
    else:
        print(
            f"[hamster-friendly-rife] reuse staged {unit_id}/{action_name}",
            flush=True,
        )
    report = json.loads(report_path.read_text(encoding="utf-8"))

    output_count = int(report["outputFrameCount"])
    action["frameCount"] = output_count
    action["cols"] = 8
    action["rows"] = math.ceil(output_count / 8)
    if "frames" in action:
        old_start, old_end = [int(v) for v in action["frames"]]
        action["frames"] = [
            old_start * 2,
            output_count - 1 if mode == "loop" else old_end * 2,
        ]
    if "startFrames" in action:
        action["startFrames"] = [int(v) * 2 for v in action["startFrames"]]
    if "loopFrames" in action:
        old_start = int(action["loopFrames"][0])
        action["loopFrames"] = [old_start * 2, output_count - 1]
    if "frameRate" in action:
        action["frameRate"] = float(action["frameRate"]) * 2
    if "startFrameRate" in action:
        action["startFrameRate"] = float(action["startFrameRate"]) * 2
    if "waitFrame" in action:
        action["waitFrame"] = int(action["waitFrame"]) * 2
    return report, staged_sheet, runtime_sheet


def install_staged_outputs(
    outputs: list[tuple[Path, Path, dict[str, object]]]
) -> tuple[bool, list[str], list[str]]:
    installed: list[Path] = []
    blocked: list[str] = []
    try:
        for staged, runtime, _action in outputs:
            temporary = runtime.with_name(f"{runtime.stem}.rife-install{runtime.suffix}")
            shutil.copy2(staged, temporary)
            os.replace(temporary, runtime)
            installed.append(runtime)
    except OSError:
        blocked.append(str(runtime.relative_to(REPO)))
        temporary.unlink(missing_ok=True)
        for installed_runtime in installed:
            relative_asset = installed_runtime.relative_to(REPO / "assets" / "companions")
            backup = BACKUP_DIR / relative_asset
            rollback = installed_runtime.with_name(
                f"{installed_runtime.stem}.rife-rollback{installed_runtime.suffix}"
            )
            shutil.copy2(backup, rollback)
            os.replace(rollback, installed_runtime)
        # Photoshop and image viewers may deny replacement while an original is
        # open. Install one coherent alias set and point this unit's config at it
        # instead of mixing old and new actions or terminating another session.
        alias_targets: list[str] = []
        created_aliases: list[Path] = []
        try:
            for staged, runtime, action in outputs:
                alias = runtime.with_name(f"{runtime.stem}_rife{runtime.suffix}")
                temporary = alias.with_name(
                    f"{alias.stem}.rife-install{alias.suffix}"
                )
                shutil.copy2(staged, temporary)
                os.replace(temporary, alias)
                created_aliases.append(alias)
                relative_alias = alias.relative_to(REPO).as_posix()
                action["src"] = relative_alias
                alias_targets.append(relative_alias)
        except OSError:
            temporary.unlink(missing_ok=True)
            for alias in created_aliases:
                alias.unlink(missing_ok=True)
            return False, blocked, []
        return True, blocked, alias_targets
    return True, blocked, []


def update_timing_contracts(config: dict[str, object]) -> None:
    ai = config.get("ai")
    if not isinstance(ai, dict):
        return
    for key in ("attackDamageFrame", "attackLaunchFrame", "castReleaseFrame"):
        if key in ai:
            ai[key] = doubled_one_based_frame(int(ai[key]))
    for key in ("attackAnimFps", "castAnimFps"):
        if key in ai:
            ai[key] = float(ai[key]) * 2
    charge = ai.get("charge")
    if isinstance(charge, dict) and "frames" in charge:
        charge["frames"] = int(charge["frames"]) * 2 - 1
        charge["frameRate"] = float(charge["frameRate"]) * 2
        if "hitStartFrame" in charge:
            charge["hitStartFrame"] = doubled_one_based_frame(
                int(charge["hitStartFrame"])
            )
        if "hitEndFrame" in charge:
            charge["hitEndFrame"] = int(charge["hitEndFrame"]) * 2


def reuse_existing_alias_set(
    config_path: Path,
    config: dict[str, object],
) -> list[str]:
    """Keep a previously installed coherent *_rife set on idempotent reruns."""
    current = json.loads(config_path.read_text(encoding="utf-8"))
    current_animations = current.get("animations", {})
    aliases: list[str] = []
    for action_name, action in config.get("animations", {}).items():
        if not isinstance(action, dict) or int(action.get("frameCount", 1)) <= 1:
            continue
        current_action = current_animations.get(action_name, {})
        source = str(current_action.get("src", ""))
        if not source.endswith("_rife.png") or not (REPO / source).exists():
            return []
        action["src"] = source
        aliases.append(source)
    return aliases


def main() -> None:
    summary: dict[str, object] = {
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "scope": "all runtime hamster friendly troops plus hamster miner",
        "units": {},
    }
    for config_name in UNIT_CONFIGS:
        config_path = REPO / "data" / config_name
        config_backup = CONFIG_BACKUP_DIR / config_name
        config_backup.parent.mkdir(parents=True, exist_ok=True)
        if not config_backup.exists():
            shutil.copy2(config_path, config_backup)
        config = json.loads(config_backup.read_text(encoding="utf-8"))
        unit_id = str(config["id"])
        unit_reports: dict[str, object] = {}
        staged_outputs: list[tuple[Path, Path, dict[str, object]]] = []
        for action_name, action in config.get("animations", {}).items():
            if not isinstance(action, dict) or not action.get("src"):
                continue
            result = process_action(unit_id, action_name, action)
            if result is not None:
                report, staged_sheet, runtime_sheet = result
                unit_reports[action_name] = report
                staged_outputs.append((staged_sheet, runtime_sheet, action))
        update_timing_contracts(config)
        aliases = reuse_existing_alias_set(config_path, config)
        if aliases:
            replace_ok, blocked = True, []
        else:
            replace_ok, blocked, aliases = install_staged_outputs(staged_outputs)
        if replace_ok:
            config_path.write_text(
                json.dumps(config, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        summary["units"][unit_id] = {
            "installed": replace_ok,
            "blockedTargets": blocked,
            "aliasTargets": aliases,
            "actions": unit_reports,
        }
        state = "completed"
        if aliases:
            state = f"completed via lock-safe aliases={aliases}"
        elif not replace_ok:
            state = f"staged; blocked={blocked}"
        print(f"[hamster-friendly-rife] {unit_id} {state}", flush=True)
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[hamster-friendly-rife] wrote {SUMMARY_PATH}", flush=True)


if __name__ == "__main__":
    main()
