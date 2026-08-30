#!/usr/bin/env python3
"""Lay out existing model renders for review; no model/image generation or tests."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent / "_engineer_branch_20260830"
FONT = "C:/Windows/Fonts/msyh.ttc"


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    draft = json.loads((ROOT / "technology-branch.draft.json").read_text(encoding="utf-8"))
    sheet = Image.new("RGB", (1920, 1000), "#e8e5de")
    draw = ImageDraw.Draw(sheet)
    font = lambda size: ImageFont.truetype(FONT, size)
    draw.text((48, 26), "工程师营地  /  工程工坊  /  载具工厂", font=font(38), fill="#202a2b")
    draw.text((50, 83), "LV1—LV3 建模候选  ·  同一4×4地基  ·  30°正交相机  ·  未进入材质精修 / 未入库", font=font(22), fill="#576465")
    materials = ["皮革围护 + 茅草顶 + 木吊架", "红陶瓦顶 + 灰石墙 + 绞盘", "混凝土 + 钢架 + 工业采光顶"]
    for index, ((asset_id, spec), node) in enumerate(zip(manifest["buildings"].items(), draft["nodes"])):
        left = 36 + index * 628
        draw.rounded_rectangle((left, 142, left + 608, 794), radius=15, fill="#f6f4ee", outline="#c7c9c2", width=2)
        draw.text((left + 22, 161), f"LV{spec['level']}  {spec['label']}", font=font(29), fill="#243536")
        source = Image.open(ROOT / asset_id / f"{asset_id}_model_approval_preview.png").convert("RGBA")
        # Identical full source canvases preserve the shared base scale and camera.
        source = source.resize((596, 596), Image.Resampling.LANCZOS)
        sheet.paste(source, (left + 6, 174), source)
        draw.text((left + 22, 718), materials[index], font=font(23), fill="#576465")
        draw.text((left + 22, 753), f"科研 {node['effectiveResearchCost']} 点  ·  基础值 {node['researchCost']}", font=font(22), fill="#7a522d")
    draw.text((48, 825), "工程页支线：城防工事 → 工程师营地 → 工程工坊 → 载具工厂", font=font(28), fill="#243536")
    draw.text((48, 872), "LV2 另需烧制砖工艺；LV3 另需蒸汽工业标准化 + 现代机械制造。多前置全部满足（AND）。", font=font(24), fill="#576465")
    draw.text((48, 922), "本轮只交付结构、材质分区与科技草案；三档节点合计5970点。未定义载具兵种、产量或战斗功能。", font=font(24), fill="#576465")
    output = ROOT / "engineer_branch_model_approval_preview.png"
    sheet.save(output)
    print(output)


if __name__ == "__main__":
    main()
