"""Prepare local structure prompts only; never contacts the generation host."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
spec = importlib.util.spec_from_file_location(
    "world122_candidates", REPO / "tools/ai-gen/generate-world122-building-candidates.py"
)
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
manifest = json.loads((ROOT / "candidate-manifest.json").read_text(encoding="utf-8"))
prompt_dir = ROOT / "prompts_s12"
prompt_dir.mkdir(exist_ok=True)
for asset in manifest["assets"]:
    output = prompt_dir / (asset["id"] + "_structure_prompt.txt")
    output.write_text(pipeline.prompt_for(asset, manifest, "structure"), encoding="utf-8")
    print(output)

