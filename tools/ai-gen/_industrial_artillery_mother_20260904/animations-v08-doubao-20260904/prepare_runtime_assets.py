#!/usr/bin/env python3
"""Publish the approved artillery sprites and derive its runtime config/assets."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image


TASK_DIR = Path(__file__).resolve().parent
REPO_ROOT = TASK_DIR.parents[3]
RUNTIME_DIR = REPO_ROOT / "assets/companions/hamster_industrial_artillery_crew"
ICON_PATH = REPO_ROOT / "assets/ui/unit-icons/hamster-industrial-artillery-crew.png"
CONFIG_PATH = REPO_ROOT / "data/hamster-industrial-artillery-crew-config.json"
SOUND_DIR = REPO_ROOT / "assets/sounds/friendly"
DISPLAY_SIZE = 75.684 * 512 / 98.8
ATTACK_RELEASE_FRAME = 24  # 0-based; frame 24 is the first muzzle-flash frame.


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def clean_transparent_rgb(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            if pixels[x, y][3] == 0:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def centered_thumbnail(source: Image.Image, canvas_size: tuple[int, int], maximum: tuple[int, int]) -> Image.Image:
    source = clean_transparent_rgb(source)
    bbox = source.getbbox()
    if bbox is None:
        raise RuntimeError("Cannot create a thumbnail from an empty source image.")
    source = source.crop(bbox)
    source.thumbnail(maximum, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    canvas.alpha_composite(source, ((canvas.width - source.width) // 2, (canvas.height - source.height) // 2))
    return clean_transparent_rgb(canvas)


def action_config(action: dict, runtime_name: str, repeat: int) -> dict:
    durations = action.get("frameDurationsMs") or action.get("frameDurations")
    if not durations or len(durations) != action["frameCount"]:
        raise RuntimeError(f"Invalid frame-duration table for {runtime_name}.")
    duration_ms = float(action["durationMs"])
    return {
        "src": f"assets/companions/hamster_industrial_artillery_crew/{runtime_name}.png",
        "frameWidth": action["frameWidth"],
        "frameHeight": action["frameHeight"],
        "cols": action["cols"],
        "rows": action["rows"],
        "frameCount": action["frameCount"],
        "footX": action["footX"],
        "footY": action["footY"],
        "frames": [0, action["frameCount"] - 1],
        "frameRate": action["frameCount"] * 1000 / duration_ms,
        "frameDurations": durations,
        "durationMs": duration_ms,
        "repeat": repeat,
    }


def record_integration_metadata() -> None:
    status = "runtime_integrated_pending_user_game_validation"
    runtime_scale = DISPLAY_SIZE / 512
    decoded_mib = sum(
        action["frameWidth"] * action["frameHeight"] * action["cols"] * action["rows"] * 4
        for action in read_json(TASK_DIR / "spritesheet-manifest.json")["actions"].values()
    ) / (1024 * 1024) + 64 * 64 * 4 / (1024 * 1024)

    root_index_path = TASK_DIR.parent / "task-index.json"
    root_index = read_json(root_index_path)
    root_index.update({
        "scope": "完成仓鼠近代炮兵组母图、豆包四动作、透明精灵与正式运行时接入；等待用户实机验收。",
        "status": status,
        "approvalStatus": "user_approved_runtime_integration",
        "futurePlanOnly": False,
        "runtimeIntegrationActive": True,
    })
    root_index["unit"]["plannedCombatFromV4"]["status"] = "implemented_runtime_pending_game_validation"
    gate = root_index["animationGate"]
    gate.update({
        "status": status,
        "budgetClassification": "above_target_within_review_limit_runtime_import_explicitly_authorized",
        "runtimeIntegrationActive": True,
        "runtimeConfig": "data/hamster-industrial-artillery-crew-config.json",
        "runtimeAssetDirectory": "assets/companions/hamster_industrial_artillery_crew",
        "projectileSource": "animations-v08-doubao-20260904/projectile-source.json",
    })
    gate["sourceReview"] = (
        "All four source actions passed review and were accepted by the user. The user subsequently "
        "authorized game integration; fixed-transform sprites and the isolated shell are now published."
    )
    root_index["motherDirectionReview"]["conclusion"] = (
        "v08 matches the accepted engineering camera. Its four approved actions and derived shell are now "
        "integrated as the industrial artillery runtime unit, pending user game validation."
    )
    root_index["reviewBoundary"] = (
        "Mother, source videos and all 274 transparent action frames passed offline review. The 46.212MiB "
        "runtime texture set exceeds the 32MiB crowd target but remains below the 64MiB admission limit, "
        "and the user explicitly authorized import. Config/code/technology integration is complete; no game "
        "runtime test, build, browser/CDP probe or EXE publication was performed."
    )
    write_json(root_index_path, root_index)

    animation_manifest_path = TASK_DIR / "manifest.json"
    animation_manifest = read_json(animation_manifest_path)
    animation_manifest.update({
        "status": status,
        "futurePlanOnly": False,
        "runtimeIntegrationActive": True,
    })
    animation_manifest["budget"]["actualDecodedMiB"] = decoded_mib
    animation_manifest["budget"]["review"]["closureMiB"] = round(decoded_mib, 3)
    animation_manifest["budget"]["review"]["overTargetMiB"] = round(decoded_mib - 32, 3)
    animation_manifest["budget"]["review"]["integrationBoundary"] = (
        "User explicitly authorized runtime import of the above-target, within-limit crowd asset."
    )
    for action in animation_manifest["actions"].values():
        action["status"] = "runtime_published_pending_game_validation"
        action["runtimeIntegrationActive"] = True
    animation_manifest["postGenerationGate"] = (
        "Completed: source review, user approval, fixed-transform cutout, RIFE 2x, timed previews, budget "
        "check and runtime publication. User game validation remains pending."
    )
    animation_manifest["spriteProducts"]["status"] = status
    animation_manifest["spriteProducts"]["runtimeConfig"] = "data/hamster-industrial-artillery-crew-config.json"
    animation_manifest["spriteProducts"]["runtimeAssetDirectory"] = "assets/companions/hamster_industrial_artillery_crew"
    write_json(animation_manifest_path, animation_manifest)

    sheet_manifest_path = TASK_DIR / "spritesheet-manifest.json"
    sheet_manifest = read_json(sheet_manifest_path)
    sheet_manifest.update({
        "status": status,
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "runtimeScale": runtime_scale,
        "decodedMiB": decoded_mib,
        "budgetScope": "Five published runtime textures: four action sheets plus the isolated shell.",
        "runtimeConfig": "data/hamster-industrial-artillery-crew-config.json",
        "runtimeAssetDirectory": "assets/companions/hamster_industrial_artillery_crew",
    })
    for action in sheet_manifest["actions"].values():
        action["runtimeIntegrationActive"] = True
    sheet_manifest["notes"] = [
        "The four user-approved Doubao source videos are preserved unchanged.",
        "Source keys remain at even output indices; RIFE creates only half-step odd frames.",
        "Each action retains its recorded effective source duration through per-frame timing metadata.",
        "Recruitment, combat, projectile and on-demand runtime texture registration are now integrated; user game validation remains pending.",
    ]
    sheet_manifest["budgetReview"]["closureMiB"] = round(decoded_mib, 3)
    sheet_manifest["budgetReview"]["overTargetMiB"] = round(decoded_mib - 32, 3)
    sheet_manifest["budgetReview"]["integrationBoundary"] = (
        "User explicitly authorized runtime import of the above-target, within-limit crowd asset."
    )
    write_json(sheet_manifest_path, sheet_manifest)

    production_plan_path = TASK_DIR / "sprite-production-plan.json"
    production_plan = read_json(production_plan_path)
    production_plan.update({
        "runtimeScale": runtime_scale,
        "productionStatus": status,
        "runtimeIntegrationActive": True,
        "actualDecodedMiB": decoded_mib,
    })
    production_plan["viewPlanning"]["runtimeCalibrationPending"] = False
    write_json(production_plan_path, production_plan)

    budget_manifest_path = TASK_DIR / "sprite-budget-manifest.json"
    budget_manifest = read_json(budget_manifest_path)
    budget_manifest["runtimeIntegrationActive"] = True
    budget_manifest["textureKeysAreProposedOnly"] = False
    runtime_actions = {
        "idle": "idle",
        "run": "walk",
        "attack": "attack",
        "die": "dying",
    }
    budget_manifest["sheets"] = budget_manifest["sheets"][:4]
    for sheet, (source_action, runtime_action) in zip(
        budget_manifest["sheets"], runtime_actions.items()
    ):
        runtime_filename = {
            "idle": "idle.png", "run": "running.png", "attack": "attacking.png", "die": "dying.png"
        }[source_action]
        sheet["textureKey"] = f"companion_hamster_industrial_artillery_crew_{runtime_action}"
        sheet["path"] = f"assets/companions/hamster_industrial_artillery_crew/{runtime_filename}"
    budget_manifest["sheets"].append({
        "textureKey": "companion_hamster_industrial_artillery_crew_projectile",
        "path": "assets/companions/hamster_industrial_artillery_crew/shell.png",
        "kind": "image",
    })
    write_json(budget_manifest_path, budget_manifest)


def main() -> None:
    manifest = read_json(TASK_DIR / "spritesheet-manifest.json")
    actions = manifest["actions"]
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    runtime_names = {"idle": "idle", "run": "running", "attack": "attacking", "die": "dying"}
    published = []
    for action_name, runtime_name in runtime_names.items():
        source = TASK_DIR / actions[action_name]["sheet"]
        destination = RUNTIME_DIR / f"{runtime_name}.png"
        shutil.copyfile(source, destination)
        published.append(destination)

    # The approved death source includes one isolated, right-facing 57 mm shell.
    projectile_source = TASK_DIR / "source-sheets/shell-source-frame-0028.png"
    source_image = Image.open(projectile_source).convert("RGBA")
    source_crop = [350, 500, 527, 565]
    shell = centered_thumbnail(source_image.crop(tuple(source_crop)), (64, 64), (54, 24))
    task_shell = TASK_DIR / "final/shell.png"
    task_shell.parent.mkdir(parents=True, exist_ok=True)
    shell.save(task_shell, optimize=True)
    shutil.copyfile(task_shell, RUNTIME_DIR / "shell.png")
    published.extend([task_shell, RUNTIME_DIR / "shell.png"])

    idle = Image.open(TASK_DIR / actions["idle"]["sheet"]).convert("RGBA")
    first_cell = idle.crop((0, 0, actions["idle"]["frameWidth"], actions["idle"]["frameHeight"]))
    icon = centered_thumbnail(first_cell, (256, 256), (240, 240))
    task_icon = TASK_DIR / "final/unit-icon.png"
    icon.save(task_icon, optimize=True)
    ICON_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(task_icon, ICON_PATH)
    published.extend([task_icon, ICON_PATH])

    sound_sources = {
        "hamster_industrial_artillery_crew_attack.mp3": SOUND_DIR / "hamster_field_cannon_crew_attack_video.mp3",
        "hamster_industrial_artillery_crew_walk.mp3": SOUND_DIR / "hamster_field_cannon_crew_walk_video.mp3",
    }
    for filename, source in sound_sources.items():
        destination = SOUND_DIR / filename
        shutil.copyfile(source, destination)
        published.append(destination)

    idle_foot_offset = (actions["idle"]["footY"] - actions["idle"]["frameHeight"] / 2) * DISPLAY_SIZE / 512
    config = {
        "id": "hamster_industrial_artillery_crew",
        "name": "仓鼠近代炮兵组",
        "title": "近代炮兵工坊三级·双人反坦克炮",
        "desc": "两名仓鼠工程师操作近代57毫米高速反坦克炮。长管钢炮以低伸弹道打击远处密集目标；近身敌人进入最小射程时后撤展开。",
        "role": "industrial_artillery_crew",
        "growthRule": "ranger",
        "avatar": "⚒️",
        "weaponType": "industrial_artillery",
        "baseLevel": 1,
        "baseExp": 0,
        "baseMaxHp": 540,
        "baseData": {"str": 27, "dex": 15, "int": 7, "con": 25, "wis": 7, "luck": 6},
        "statFormula": "enemy",
        "groundRadius": 36,
        "collisionRadius": 36,
        "bodyHeight": 100,
        "size": 96,
        "fogVisionProfile": "military",
        "skills": [],
        "sounds": {
            "attack": "assets/sounds/friendly/hamster_industrial_artillery_crew_attack.mp3",
            "walk": "assets/sounds/friendly/hamster_industrial_artillery_crew_walk.mp3",
            "walkInterval": 600,
            "walkVolume": 0.3,
        },
        "ai": {
            "role": "ranged_artillery",
            "walkSpeed": 58,
            "runSpeed": 58,
            "attackInterval": 9000,
            "attackDamage": 360,
            "attackRange": 1080,
            "minimumRange": 270,
            "engageRange": 1280,
            "projectileSpeed": 1100,
            "arcHeight": 45,
            "splashRadius": 105,
            "splashFalloff": 0.6,
            "expectedExtraTargets": 1.6,
            "attackReleaseFrame": ATTACK_RELEASE_FRAME,
            "appliesMarkArrow": False,
            "followOffset": 200,
            "followArriveDist": 48,
            "decisionMs": 160,
            "teleportDist": 999999,
            "teleportHardDist": 9999999,
            "attackSoundIsGunshot": True,
        },
        "displaySize": DISPLAY_SIZE,
        "spriteOffsetY": -idle_foot_offset,
        "render": {
            "footOffsetY": idle_foot_offset,
            "hudOffsetY": 125,
            "collisionWidth": 72,
            "collisionHeight": 100,
            "corpseHoldMs": 1500,
            "actionTransitionGhost": False,
            "projectileReleaseOffsetX": 151.2,
            "projectileReleaseHeight": 68.4,
            "projectileDisplaySize": 26,
            "projectileTipDirection": "right",
        },
        "animations": {
            "idle": action_config(actions["idle"], "idle", -1),
            "walk": action_config(actions["run"], "running", -1),
            "attack": action_config(actions["attack"], "attacking", 0),
            "dying": action_config(actions["die"], "dying", 0),
            "projectile": {
                "src": "assets/companions/hamster_industrial_artillery_crew/shell.png",
                "frameWidth": 64,
                "frameHeight": 64,
                "cols": 1,
                "rows": 1,
                "frameCount": 1,
                "frames": [0, 0],
                "frameRate": 1,
                "repeat": 0,
            },
        },
    }
    write_json(CONFIG_PATH, config)
    published.append(CONFIG_PATH)

    projectile_meta = {
        "source": str(projectile_source.relative_to(TASK_DIR)).replace("\\", "/"),
        "sourceFrame": 28,
        "sourceCrop": source_crop,
        "operation": "alpha crop, trim, Lanczos fit within 54x24, center on transparent 64x64 canvas",
        "direction": "right",
        "runtimePath": "assets/companions/hamster_industrial_artillery_crew/shell.png",
        "sha256": sha256(RUNTIME_DIR / "shell.png"),
    }
    write_json(TASK_DIR / "projectile-source.json", projectile_meta)

    provenance = {
        "date": "2026-09-04",
        "unitKey": "industrial_artillery_crew",
        "runtimeUnitId": "hamster_industrial_artillery_crew",
        "sourceManifest": "spritesheet-manifest.json",
        "runtimeConfig": "data/hamster-industrial-artillery-crew-config.json",
        "audioReuse": "approved hamster field-cannon attack/walk audio copied under unit-owned filenames",
        "files": [
            {
                "path": str(path.relative_to(REPO_ROOT)).replace("\\", "/") if path.is_relative_to(REPO_ROOT)
                else str(path.relative_to(TASK_DIR)).replace("\\", "/"),
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in published
        ],
    }
    write_json(TASK_DIR / "runtime-asset-provenance.json", provenance)
    record_integration_metadata()

    release_ms = sum(config["animations"]["attack"]["frameDurations"][:ATTACK_RELEASE_FRAME])
    print(json.dumps({
        "config": str(CONFIG_PATH),
        "displaySize": DISPLAY_SIZE,
        "footOffsetY": idle_foot_offset,
        "attackReleaseFrame": ATTACK_RELEASE_FRAME,
        "attackReleaseMs": release_ms,
        "publishedFiles": len(published),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
