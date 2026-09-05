"""Refine the user-selected batch-4 variant 02 with Dev + original Depth.

48 configured steps, denoise 0.30, Depth 0.75, two seeds. No install entry.
"""
import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SELECTED = HERE / "_mine_wall_a_dev_depth_20260830_batch4"
OUT = HERE / "_mine_wall_a_dev_refine_20260830"
spec = importlib.util.spec_from_file_location("mine_dev_pipeline", HERE / "mine-wall-a-dev-candidates.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
pipeline.OUT = OUT


def prepare():
    if any(OUT.glob("wall_a_refine_v*_raw.png")):
        raise SystemExit("Refinement raws already exist; preserve their request and prompt.")
    OUT.mkdir(exist_ok=True)
    prompt = (SELECTED / "wall_a_structure_prompt.txt").read_text(encoding="utf-8")
    prompt += "\nSurface refinement only: preserve the selected image's mineral patch layout and continuous rock planes. Gently clarify existing mineral transitions while keeping their contrast subdued and their edges softly integrated. Keep surface detail calm at gameplay size; preserve the existing volume, composition and rock identity.\n"
    (OUT / "wall_a_refine_prompt.txt").write_text(prompt, encoding="utf-8")
    source = json.loads((SELECTED / "request.json").read_text(encoding="utf-8"))
    request = {key: source[key] for key in (
        "asset", "assetClass", "model", "host", "port", "cfg", "sampler", "scheduler",
        "size", "styleVersion", "styleTemplate", "styleBasis", "foundationStyle",
        "depthSource", "depthConversion", "depthSourceMode", "depthRange", "geometry", "modelSource",
    )}
    request.update({
        "stage": "refine", "filePrefix": "wall_a_refine", "steps": 48,
        "denoise": 0.30, "controlStrength": 0.75, "seeds": [122083050, 122083051],
        "prompt": "wall_a_refine_prompt.txt",
        "controlImage": "../_mine_wall_a_dev_depth_20260830_batch4/mine_wall_a_v2_depth_control.png",
        "initImage": "../_mine_wall_a_dev_depth_20260830_batch4/wall_a_structure_v02_raw.png",
        "selectedSourceSeed": 122083041,
        "selectionApproval": "同意入精修",
        "approvalScope": "Refine batch-4 variant 02 only; not runtime installation or B/C/gate generation",
        "transferScope": "Selected Dev-generated green-background raw, original Depth control and material prompt to existing ComfyUI at 192.168.3.142:8188; no Blender beauty, blend or repository upload",
        "runtimeInstalled": False, "approved": False,
    })
    pipeline.write_json(OUT / "request.json", request)
    print("Prepared two Dev refinement candidates:", OUT, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "generate", "compose"))
    args = parser.parse_args()
    if args.stage == "prepare":
        prepare()
    elif args.stage == "generate":
        pipeline.generate()
    else:
        pipeline.compose(
            match_native_color=True,
            comparison_path=SELECTED / "wall_a_structure_v02_candidate.png",
            comparison_label="已选12步 / 第4批02",
        )
