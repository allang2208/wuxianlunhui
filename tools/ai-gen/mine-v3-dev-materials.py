"""Scoped Dev/Depth material production for the mine v3 batch only."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_visual_finish_v3_20260830"
PROMPTS = {
    "rock": "One continuous solid volume of natural grey excavated slate bedrock, exactly matching the supplied depth. The top and both sides are the same uninterrupted rock. Sparse short oblique natural fissures and broad angular mineral planes, restrained stone surface variation, subtly uneven unbroken crown. Homogeneous rock continues across every edge. No assembled courses, masonry, separate cap, rim or footing. Soft neutral upper-left lighting. Clean semi-realistic strategy-game PBR, low saturation, quiet large material fields, sparse medium-scale geological detail, no grainy grime. Exact orthographic camera and complete depth silhouette. Isolated on perfectly flat pure green, no cast shadows or surroundings.",
    "gate": "Refine only the materials of this exact modeled mine lifting gate. Exactly nine separate vertical seasoned oak timbers and three continuous dark iron straps mounted on their front, with existing visible round rivets, lower collars and small iron tips. Preserve every timber, gap, strap, rivet, position and camera. Convincing subdued lengthwise oak fibers, a few narrow wood splits, worn timber end grain. Matte forged iron, slight functional edge wear, sparse dark oxidation. Clean semi-realistic strategy-game PBR, muted warm grey-brown wood, charcoal iron, soft neutral upper-left lighting. Quiet broad materials with readable medium-scale wear, no ornate carving, no added boards or parts. Complete source silhouette on perfectly flat pure green, no external cast shadows.",
    "supports": "Refine the exact existing oak pit support beams and their small iron collars on this solid mine rock. Preserve the grey rock body and its silhouette. Wood shows subdued lengthwise seasoned oak fibers, a few narrow splits and worn end grain; small collars are matte forged dark iron. All beam widths, locations, joints and diagonal brace stay exactly as modeled. Clean semi-realistic strategy-game PBR, muted grey-brown oak, restrained wear, low saturation, soft neutral upper-left lighting. Do not add masonry, ornament, structures, loose stones or new beams. Complete original composition on flat pure green without external shadows.",
}


def prepare():
    specs = {"rock": ("wall_a_native.png", "wall_a_depth.png", 12, 1, 122083081),
             "gate": ("gate_native.png", "gate_depth.png", 48, .5, 122083082),
             "supports": ("wall_c_native.png", "wall_c_depth.png", 48, .5, 122083083)}
    for key, (beauty, depth, steps, denoise, seed) in specs.items():
        folder = OUT/key
        folder.mkdir(exist_ok=True)
        if (folder/"raw.png").exists():
            continue
        src = Image.open(OUT/beauty).convert("RGBA")
        green = Image.new("RGBA", src.size, (0,255,0,255))
        green.alpha_composite(src)
        green.convert("RGB").save(folder/"init_green.png")
        data = np.asarray(Image.open(OUT/depth))
        if data.dtype.itemsize > 1:
            data = np.rint(data.astype(float)/257)
        Image.fromarray(np.uint8(data), "L").save(folder/"depth.png")
        (folder/"prompt.txt").write_text(PROMPTS[key], encoding="utf-8")
        request = {"asset": key, "model": "flux2-dev-depth", "steps": steps, "denoise": denoise,
                   "seed": seed, "strength": .78 if key == "rock" else .75, "size": list(src.size),
                   "style": "world122-building-v5 material/lighting principles, natural mine geometry only",
                   "destination": "192.168.3.142:8188", "uploads": ["depth.png", "prompt.txt"] + ([] if key == "rock" else ["init_green.png"]),
                   "scope": "mine rock/support/gate payloads, continuation of explicitly approved Dev/Depth rerolls; no blend or repository upload",
                   "experiment": "wood refinement denoise 0.50 because prior 0.30 retained featureless wood; not a new global default",
                   "runtimeInstalled": False}
        (folder/"request.json").write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding="utf-8")


def generate(key, variant=1, refine=False):
    folder = OUT/key
    r = json.loads((folder/"request.json").read_text(encoding="utf-8"))
    prompt = folder/"prompt.txt"
    init = folder/"init_green.png" if key != "rock" else None
    if refine:
        if key != "rock":
            raise SystemExit("This refinement stage is only for the selected rock v01; wood already uses 48 steps.")
        init = folder/"raw.png"
        r = {**r,"steps":48,"denoise":.30,"stage":"refine",
             "styleVersion":"world122-building-v5","styleTemplate":"prompts/world122-building-style.md",
             "assetClass":"natural_wall_module","foundationStyle":"none; continuous natural rock block",
             "uploads":["depth.png","raw.png","refine_prompt.txt"],
             "experiment":"rock v01 at 48 steps and denoise 0.30; keep original raw for comparison",
             "initImage":"raw.png","selection":"agent provisional v01; no user acceptance implied"}
        prompt = folder/"refine_prompt.txt"
        if not prompt.exists():
            common = (HERE/"prompts/world122-building-style.md").read_text(encoding="utf-8")
            delta = "\nAsset class: continuous natural mine wall module, no foundation or architecture. Preserve this exact rock volume, camera, crown and original fissure positions from the supplied raw and Depth. Refine only calm broad slate surfaces and sparse medium-scale mineral detail. Keep grain subordinate, no extra long fractures, bricks, courses, rim, cap, footing or added objects. Pure flat green background with absolutely no external cast shadow.\n"
            prompt.write_text(common+delta,encoding="utf-8")
    raw = folder/(f"raw_refine_v{variant:02d}.png" if refine else "raw.png" if variant == 1 else f"raw_v{variant:02d}.png")
    if raw.exists():
        raise SystemExit("Preserve existing raw; use a new batch for another candidate.")
    seed = r["seed"]+10*(variant-1)+(200 if refine else 0)
    cmd = [sys.executable, str(HERE/"comfyui-gen.py"), "--host", "192.168.3.142", "--model", r["model"],
           "--steps", str(r["steps"]), "--cfg", "3.5", "--sampler", "euler", "--scheduler", "simple",
           "--size", "x".join(map(str,r["size"])), "--seed", str(seed), "--control-image", str(folder/"depth.png"),
           "--strength", str(r["strength"]), "--prompt-file", str(prompt), "--out", str(raw),
           "--prefix", f"mine_v3_{key}_{'refine_' if refine else ''}{variant:02d}", "--timeout", "1800"]
    if init:
        cmd += ["--init-image", str(init), "--denoise", str(r["denoise"])]
    metadata = {**r,"seed":seed,"raw":raw.name,"variant":variant,"status":"submitting",
                "startedAt":datetime.now().isoformat(timespec="seconds"),
                "authorization":"2026-08-30 user explicitly agreed to new mine Depth/reference images, prompts, parameters and same-batch rerolls to 192.168.3.142:8188",
                "promptFile":prompt.name,"command":cmd}
    record = raw.with_suffix(".generation.json")
    def save_record():
        record.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    save_record()
    try:
        subprocess.run(cmd,check=True)
    except subprocess.CalledProcessError as exc:
        metadata.update(status="process failed; inspect output before resubmitting",returnCode=exc.returncode)
        save_record()
        raise
    metadata.update(status="generated; pending visual acceptance",finishedAt=datetime.now().isoformat(timespec="seconds"))
    save_record()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "generate"))
    parser.add_argument("--asset", choices=tuple(PROMPTS), default="rock")
    parser.add_argument("--variant", type=int, choices=range(1,100), default=1)
    parser.add_argument("--refine", action="store_true")
    args = parser.parse_args()
    prepare() if args.stage == "prepare" else generate(args.asset,args.variant,args.refine)
