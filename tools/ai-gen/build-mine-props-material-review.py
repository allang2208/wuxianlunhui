"""Render the mine material candidates without overwriting model-review or runtime."""
import json
import importlib.util
from pathlib import Path


def load(filename, name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M=load("build-mine-props-model-review.py","mine_model")
P=load("environment-prop-materials.py","environment_prop_materials")
M.OUT=M.REPO/"tools/ai-gen/_mine_props_material_review_20260830"
M.main(material_setup=lambda:P.apply_mine_palette(M),
       assembly_finish=lambda:P.finish_mine_handles(M),stage="blender-material-candidate")
path=M.OUT/"manifest.json"
manifest=json.loads(path.read_text(encoding="utf-8"))
manifest["generator"]=str(Path(__file__).relative_to(M.REPO)).replace("\\","/")
manifest["modelGenerator"]="tools/ai-gen/build-mine-props-model-review.py"
manifest["structuralReference"]="tools/ai-gen/_mine_props_model_review_20260830/manifest.json"
manifest["runtimePolicy"]="Candidate-only. Preserve the active 18 PNGs and profiles; these 12 candidates use fresh Alpha-size calibration before any future integration."
path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
