"""Rebuild identical v3 geometry with the new candidate's shared stone material."""
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("v3_dev_candidate",HERE/"build-mine-wall-pbr-kit-v3.py")
v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v3)
v3.OUT = HERE/"_mine_visual_finish_v3_20260830/dev-candidate"
original_stone = v3.stone
def candidate_stone(key, top=False):
    material = original_stone(key, top)
    material.name = material.name.replace("Accepted Dev", "Candidate Dev")
    return material
v3.stone = candidate_stone
v3.main()
path=v3.OUT/"geometry.json"
geometry=json.loads(path.read_text(encoding="utf-8"))
geometry["wall"]["materialMapping"]="new Dev candidate unlit variation on original v3 UV; native shared lighting"
geometry["candidateSource"]="material-source.json; agent selection only, not user acceptance"
path.write_text(json.dumps(geometry,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
