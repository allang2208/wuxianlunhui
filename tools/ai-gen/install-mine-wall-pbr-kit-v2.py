"""Install the user-selected v2 wall/gate PNGs without resampling or rendering."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools/ai-gen/_mine_wall_pbr_kit_v2_20260830"
LEGACY = ROOT / "tools/ai-gen/_abandoned_mine_wall_kit_20260828"
MAPPING = {
    **{f"abandoned_mine_wall_block_{key}": f"wall_{key}.png" for key in "abc"},
    "abandoned_mine_gate": "abandoned_mine_gate.png",
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def main():
    manifest_path = SOURCE / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("supersededBy"):
        raise SystemExit("This v2 kit has been superseded; use " + manifest["supersededBy"] + " instead of overwriting the accepted successor.")
    geometry_path = SOURCE / "geometry.json"
    geometry = read_json(geometry_path)
    # Read all four selected sources before replacing any runtime asset.
    payloads = {key:(SOURCE/name).read_bytes() for key,name in MAPPING.items()}
    old_manifests = {path:read_json(path) for path in (
        LEGACY/"manifest.json", LEGACY/"generation/final_12step/manifest.json",
    )}
    installed = {}
    for key,payload in payloads.items():
        target = ROOT / f"assets/terrain/{key}.png"
        target.write_bytes(payload)
        record = {"path":target.relative_to(ROOT).as_posix(),"source":MAPPING[key],
                  "sha256":hashlib.sha256(payload).hexdigest()}
        if key == "abandoned_mine_gate":
            record.update({"sheetSize":[2560,2560],"frameSize":[640,640],"frames":16})
        else:
            record["size"] = [1024,1024]
        installed[key] = record
    manifest.update({
        "stage":"accepted v2 wall/gate kit installed",
        "runtimeInstalled":True,
        "acceptedOn":"2026-08-30",
        "approval":"User approved the displayed v2 kit and requested continuation to installation.",
        "installer":"tools/ai-gen/install-mine-wall-pbr-kit-v2.py",
        "installed":installed,
        "installationRecord":"Last explicit installation; rebuilding source PNGs does not update runtime files.",
        "previousSource":(LEGACY/"generation/final_12step/manifest.json").relative_to(ROOT).as_posix(),
        "variantPolicy":{"selection":"existing deterministic grid-coordinate selection",
                         "allowBlockFlipX":False,"positionJitter":False,"scaleJitter":False,"rotationJitter":False},
    })
    manifest["knownLimits"] = [line for line in manifest.get("knownLimits",[])
                               if "No game tests" not in line and "This generation did not" not in line]
    manifest["knownLimits"].append("No game tests or runtime acceptance performed; original raised-gate cropping remains.")
    write_json(manifest_path,manifest)
    geometry["runtimeInstalled"] = True
    geometry["wall"]["runtimeInstalled"] = True
    write_json(geometry_path,geometry)
    for path,old in old_manifests.items():
        old.update({"runtimeInstalled":False,"stage":"superseded historical source",
                    "supersededBy":manifest_path.relative_to(ROOT).as_posix(),
                    "runtimeRecord":"Historical installation only; follow supersededBy for the current kit."})
        write_json(path,old)
    floor_manifest_path = ROOT / "tools/ai-gen/_abandoned_mine_20260828/manifest.json"
    if floor_manifest_path.exists():
        floor_manifest = read_json(floor_manifest_path)
        floor_manifest["modeledWallKit"] = manifest_path.relative_to(ROOT).as_posix()
        write_json(floor_manifest_path,floor_manifest)
    print(json.dumps({"installed":list(installed),"manifest":manifest_path.relative_to(ROOT).as_posix()},ensure_ascii=False))


if __name__ == "__main__":
    main()
