"""Install approved dog sprites and produce previews from the actual game clock."""
from pathlib import Path
import bisect
import copy
import json
import math
import shutil

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
PRODUCTION = json.loads((ROOT / "composition.json").read_text(encoding="utf-8"))
JOBS = {job["action"]: job for job in PRODUCTION["jobs"]}
RUNTIME = REPO / "assets/enemies/zombie_dog/v3"
NAMES = {"idle": "idle", "running": "running", "attack": "attacking", "dying": "dying"}
STATES = {"idle": "idle", "running": "run", "attack": "attack", "dying": "death"}
PREVIEWS = ROOT / "previews/runtime-speed"
REACH = 98


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_config(path):
    # Replace only the requested top-level monster block, retaining every other
    # byte (including concurrent edits and the existing newline convention).
    raw = path.read_bytes().decode("utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    marker = '  "zombieDog": '
    start = raw.index(marker)
    value_start = start + len(marker)
    dog, consumed = json.JSONDecoder().raw_decode(raw[value_start:])
    dog["aiInterval"] = 100
    dog["attackRange"] = dog["attackDistance"] = REACH
    attack_job = JOBS["attack"]
    dog["basicMelee"].update(approachReach=REACH, impactReach=REACH)
    dog["basicMelee"]["timeline"] = dict(durationMs=attack_job["duration"],
        frameCount=attack_job["frameCount"], contactFrame=attack_job["contactFrame"],
        activeFrames=attack_job["activeFrames"], rebaseOnImpact=True)
    dog["attack"].update(cooldown=1200, dynamicRange=REACH, range=REACH)
    dog["attackTelegraph"] = dict(overlapWindup=True, durationMs=250)
    for skill in dog["skills"]:
        if skill["name"] == "致残撕咬":
            skill["desc"] = "按目标脚下占地进入98px前向扑咬范围，约0.51秒咬合时复查命中；命中后使目标致残，移动速度降低50%，持续3秒"
    textures = dog["textures"]
    for action, state in STATES.items():
        textures[state] = f"assets/enemies/zombie_dog/v3/{NAMES[action]}.png"
    textures["walk"] = textures["run"]
    textures["referenceCell"] = 256
    layouts = {state: copy.deepcopy(JOBS[action]["layout"]) for action, state in STATES.items()}
    layouts["walk"] = copy.deepcopy(layouts["run"])
    layouts["walk"]["frameRate"] = layouts["run"]["frameRate"] * .5
    textures["frameLayouts"] = {state: layouts[state] for state in ("idle", "walk", "run", "attack", "death")}
    idle = layouts["idle"]
    dog["render"]["footOffsetY"] = round((idle["footY"] - idle["frameHeight"] / 2) * dog["render"]["spriteSize"] / 256, 6)
    dog["deathAnim"]["duration"] = JOBS["dying"]["duration"]
    block = json.dumps(dog, ensure_ascii=False, indent=2).splitlines()
    replacement = marker + block[0] + newline + newline.join("  " + line for line in block[1:])
    path.write_bytes((raw[:start] + replacement + raw[value_start + consumed:]).encode("utf-8"))
    return dog


def read_cells(job):
    layout = job["layout"]
    w, h, cols = layout["frameWidth"], layout["frameHeight"], layout["columns"]
    with Image.open(ROOT / "final-crowd" / f"{job['action']}.png") as sheet:
        return [sheet.crop((i % cols * w, i // cols * h, i % cols * w + w, i // cols * h + h)).convert("RGBA")
            for i in range(layout["frameCount"])]


def frame_index(job, ms):
    starts = [0]
    for duration in job["frameDurations"][:-1]:
        starts.append(starts[-1] + duration)
    return max(0, min(job["frameCount"] - 1, bisect.bisect_right(starts, ms) - 1))


def panel(action, cell, layout, note):
    panel = Image.new("RGBA", (420, 260), (35, 39, 44, 255))
    draw = ImageDraw.Draw(panel)
    draw.text((14, 12), action.upper(), fill=(230, 234, 240))
    draw.text((14, 32), note, fill=(160, 175, 187))
    # Uniform asset-pixel display scale for all actions, including the offset
    # crop. The cross denotes the shared logical foot origin, not a new effect.
    x, y = 165, 212
    draw.line((12, y, 408, y), fill=(62, 70, 79))
    panel.alpha_composite(cell, (round(x - layout["anchorX"]), round(y - layout["footY"])))
    draw = ImageDraw.Draw(panel)
    draw.line((x - 3, y, x + 3, y), fill=(93, 156, 155))
    draw.line((x, y - 3, x, y + 3), fill=(93, 156, 155))
    return panel.convert("RGB")


def sample_sequence(job, cells, duration, note, rate=.1):
    # GIF is resampled at 50fps from the runtime clock. Dense bite keys shorter
    # than GIF's 10ms quantum must not each be stretched to 10/20ms.
    ticks = max(1, round(duration / 20))
    result = []
    for tick in range(ticks):
        elapsed = tick * duration / ticks
        local = elapsed if job["action"] != "dying" else min(elapsed, job["duration"])
        cell = cells[frame_index(job, local)]
        result.append(panel(job["action"], cell, job["layout"], note))
    return result


def previews():
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    all_cells = {action: read_cells(job) for action, job in JOBS.items()}
    notes = {"idle": "3.50s loop / 42 frames", "running": "0.583s loop / 28 frames",
        "attack": "1.00s / contact 0.505s / cooldown 1.20s", "dying": "2.708s + 1.00s corpse hold"}
    outputs = {}
    for action, job in JOBS.items():
        duration = job["duration"] + (1000 if action == "dying" else 0)
        frames = sample_sequence(job, all_cells[action], duration, notes[action])
        dest = PREVIEWS / f"zombie-dog-{action}-runtime.gif"
        frames[0].save(dest, save_all=True, append_images=frames[1:], duration=20, loop=0, disposal=2, optimize=False)
        outputs[action] = dict(path=str(dest.relative_to(REPO)), gifDurationMs=len(frames) * 20,
            runtimeDurationMs=duration, sampling="50fps runtime-clock sample; max 10ms duration rounding")
    walking = copy.deepcopy(JOBS["running"])
    walking["frameDurations"] = [ms * 2 for ms in walking["frameDurations"]]
    walking["duration"] *= 2
    frames = sample_sequence(walking, all_cells["running"], walking["duration"], "Slow movement: same texture, 0.5x playback")
    frames[0].save(PREVIEWS / "zombie-dog-walk-runtime.gif", save_all=True, append_images=frames[1:], duration=20, loop=0, disposal=2, optimize=False)
    # A compact four-action review strip uses actual loops/cooldown/corpse hold.
    gallery = []
    for tick in range(210):
        time = tick * 20
        canvas = Image.new("RGB", (840, 520), (35, 39, 44))
        for index, (action, job) in enumerate(JOBS.items()):
            if action == "attack":
                local = time % 1200
                if local >= 1000:
                    visual_job, visual_action, local = JOBS["idle"], "idle", local - 1000
                else:
                    visual_job, visual_action = job, action
            elif action == "dying":
                visual_job, visual_action, local = job, action, min(time, job["duration"])
            else:
                visual_job, visual_action, local = job, action, time % job["duration"]
            frame = all_cells[visual_action][frame_index(visual_job, local)]
            canvas.paste(panel(action, frame, visual_job["layout"], notes[action]), (index % 2 * 420, index // 2 * 260))
        gallery.append(canvas)
    gallery[0].save(PREVIEWS / "zombie-dog-four-actions-runtime.gif", save_all=True, append_images=gallery[1:], duration=20, loop=0, disposal=2, optimize=False)
    # Contact sheet is artwork evidence, not an in-game or browser capture.
    attack = JOBS["attack"]
    picks = [0, 16, 22, 34, attack["contactFrame"], 50, 60, 72]
    contact = Image.new("RGB", (1680, 520))
    for i, frame in enumerate(picks):
        start_ms = sum(attack["frameDurations"][:frame])
        contact.paste(panel("attack", all_cells["attack"][frame], attack["layout"], f"frame {frame} / {start_ms:.1f} ms"), (i % 4 * 420, i // 4 * 260))
    contact.save(PREVIEWS / "zombie-dog-attack-timing-contact.png")
    write(ROOT / "reports/runtime-preview.json", outputs)
    return all_cells


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for action in JOBS:
        shutil.copy2(ROOT / "final-crowd" / f"{action}.png", RUNTIME / f"{NAMES[action]}.png")
    dog = None
    for relative in ("data/enemy-config.json", "public/data/enemy-config.json"):
        dog = update_config(REPO / relative)
    all_cells = previews()
    cal = PRODUCTION["calibration"]
    body = np.asarray(Image.open(ROOT / "cutouts/attack/f061.png"))[..., 3]
    ys, xs = np.nonzero(body > 128)
    muzzle_reach = (int(xs.max()) - cal["sourceOrigin"][0]) * cal["effectiveScale"][0] * cal["worldPixelsPerAssetPixel"]
    budget = dict(profile="crowd", targetMiB=32, admissionMiB=64, maxTextureSide=4096,
        gpuBytes=PRODUCTION["gpuBytes"], gpuMiB=PRODUCTION["gpuMiB"], loadedTextureCount=4,
        walkReusesTextureKey="enemy_zombie_dog_run", textureFiles=[],
        basis="Decoded RGBA dimensions including empty grid cells; no duplicate walk texture.")
    for action, job in JOBS.items():
        sheet = RUNTIME / f"{NAMES[action]}.png"
        layout = job["layout"]
        budget["textureFiles"].append(dict(path=str(sheet.relative_to(REPO)), pngBytes=sheet.stat().st_size,
            width=layout["columns"] * layout["frameWidth"], height=layout["rows"] * layout["frameHeight"],
            frameCount=layout["frameCount"], gpuBytes=job["gpuBytes"]))
    write(ROOT / "reports/asset-budget.json", budget)
    manifest = dict(approvedMother=str((ROOT.parent / "references/zombie-dog-mother-v04-approved.png").relative_to(REPO)),
        sourceVideoManifest=str((ROOT.parent / "manifest.json").relative_to(REPO)),
        production=PRODUCTION, runtimeTextures=dog["textures"], assetBudget=budget,
        attack=dict(durationMs=1000, cooldownMs=1200, aiDecisionIntervalMs=100,
            contactFrame=JOBS["attack"]["contactFrame"], contactSourceFrame=61,
            contactMs=JOBS["attack"]["contactMs"], activeFrames=JOBS["attack"]["activeFrames"],
            rebaseOnImpact=True,
            approachReach=REACH, impactReach=REACH, width=dog["basicMelee"]["width"],
            measuredMuzzleForwardPixels=round(muzzle_reach, 3),
            rule="Shared directed basic melee, target footprint, same surface, LOS and contact-time recheck. No new world lunge."),
        preserved=["hp", "damage", "movement speed", "collider dimensions", "knockback", "3s cripple / 50% slow", "1s corpse hold"],
        runtimeValidation="Not performed per user/project agreement. No tests, lint, build, game, CDP or EXE update.")
    write(RUNTIME / "manifest.json", manifest)
    write(ROOT / "reports/integration.json", manifest)
    print(json.dumps(dict(gpuMiB=budget["gpuMiB"], frameCounts={a: j["frameCount"] for a, j in JOBS.items()},
        attack=manifest["attack"], output=str(RUNTIME)), ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
