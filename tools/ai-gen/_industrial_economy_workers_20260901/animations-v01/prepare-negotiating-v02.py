import importlib.util
from pathlib import Path


TASK = Path(__file__).resolve().parent
SOURCE_SCRIPT = TASK / "prepare-h3-references.py"
SPEC = importlib.util.spec_from_file_location("industrial_h3_refs", SOURCE_SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

source = TASK / "references" / "trade-clerk-negotiating-keyframe-v02.png"
output, _ = MODULE.prepare(source)
destination = TASK / "h3-references" / "trade-clerk-negotiating-h3-ref-v02.png"
output.save(destination, optimize=True)
print(destination)
