"""Install the completed RedWolfKing motion assets without rewriting other config entries."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]


def update_entry(path, change):
    text = path.read_bytes().decode("utf-8")
    key = text.index('"redWolfKing":')
    start = text.index("{", key)
    value, length = json.JSONDecoder().raw_decode(text[start:])
    change(value)
    line_start = text.rfind("\n", 0, key) + 1
    indent = text[line_start:key]
    newline = "\r\n" if "\r\n" in text else "\n"
    rendered = json.dumps(value, ensure_ascii=False, indent=1 if path.name == "animation-config.json" else 2)
    rendered = rendered.replace("\n", newline + indent)
    path.write_bytes((text[:start] + rendered + text[start + length:]).encode("utf-8"))


def main():
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    actions = manifest["actions"]
    expected = {"idle", "run", "attack", "pounce", "howl", "dying", "transform",
                "werewolfIdle", "werewolfRun", "werewolfAttack", "werewolfPounce", "werewolfHowl", "werewolfDying"}
    if set(actions) != expected or not all(a["keysPreservedAfterCrop"] for a in actions.values()):
        raise RuntimeError("Complete all thirteen source-preserving actions before installing")
    for action in actions.values():
        shutil.copy2(ROOT / action["sheet"], REPO / action["runtimePath"])

    def animation(value):
        value["transform"]["werewolfCollisionScale"] = 1.8
        layouts = value["animation"]["frameLayouts"]
        for name, action in actions.items():
            layouts[name] = action["layout"].copy()
        for alias in ("walk", "pacing"):
            layouts[alias] = layouts["run"].copy()
        value["animation"]["attackTypes"]["pounce"]["prepareFrames"] = 18
        value["animation"]["transformedAttackTypes"] = {
            "bite": {"durationMs": 900},
            "pounce": {"prepareMs": 900, "chargeMs": 900, "prepareFrames": 8},
        }

    def enemy(value):
        idle = actions["idle"]["layout"]
        for key, source in (("idleFrameWidth", "frameWidth"), ("idleFrameHeight", "frameHeight"),
                            ("idleFrameCount", "frames"), ("idleSheetColumns", "cols")):
            value["textures"][key] = idle[source]
        value["attackSkills"]["howl"]["frames"] = actions["werewolfHowl"]["layout"]["frames"]

    for folder in (REPO / "data", REPO / "public/data"):
        update_entry(folder / "animation-config.json", animation)
        update_entry(folder / "enemy-config.json", enemy)
    manifest["runtimeIntegrationActive"] = True
    manifest["fixedExeUpdated"] = False
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Installed {len(actions)} RedWolfKing actions; decoded RGBA {manifest['rgbaMiB']:.2f} MiB")


if __name__ == "__main__":
    main()
