"""Compose raw/native material review sheets; never trim or install AI output."""
import importlib.util
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_visual_finish_v3_20260830"
spec = importlib.util.spec_from_file_location("mine_v3_presentation", HERE/"finish-mine-v3-presentation.py")
presentation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(presentation)
label = presentation.label


def main():
    entries = []
    sources = {"rock":"wall_a_native.png","gate":"gate_native.png","supports":"wall_c_native.png"}
    names = {"rock":"岩壁", "gate":"门叶", "supports":"木撑"}
    for key, native in sources.items():
        folder = OUT/key
        raws = sorted(folder.glob("raw*.png"))
        if not raws:
            continue
        request = json.loads((folder/"request.json").read_text(encoding="utf-8"))
        sheet = Image.new("RGB", (1600, 95+810*len(raws)), (24,29,33))
        label(sheet,(25,18),f"矿洞v3 {names[key]} · 本地模型 / Dev原图对照",27)
        label(sheet,(25,58),"原图未裁切、未回填Alpha；检查结构后才能处理材质。尚未安装。",19)
        for row, raw in enumerate(raws):
            metadata_path = raw.with_suffix(".generation.json")
            metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else request
            for col, source in enumerate((folder/"init_green.png",raw)):
                im = Image.open(source).convert("RGB")
                im.thumbnail((760,760),Image.Resampling.LANCZOS)
                sheet.paste(im,(20+800*col+(760-im.width)//2,95+810*row))
            label(sheet,(25,861+810*row),f"模型参考 {native}",19)
            label(sheet,(825,861+810*row),f"{raw.name} / {metadata['steps']}步 / seed {metadata['seed']}",19)
            entries.append({"asset":key,"raw":f"{key}/{raw.name}","native":native,
                            "steps":metadata["steps"],"seed":metadata["seed"],"runtimeInstalled":False})
        sheet.save(OUT/f"dev-{key}-raw-review.png")
    (OUT/"dev-output-index.json").write_text(json.dumps({"outputs":entries,
        "scope":"raw review sheets only; generation success is not visual acceptance",
        "tests":"未运行测试或运行时验证，按约定由用户测试。"},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


if __name__ == "__main__":
    main()
