"""Normalize and install twelve industrial-economy upgrade-card icons."""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
RUNTIME = PROJECT / "assets/ui/building-upgrades"
REFERENCE = RUNTIME / "grand-mall-showcase.png"

ENTRIES = (
    ("oil-combustion-control", "燃烧调度", "exec-b7f974c3-bc3d-44c4-b07d-a4d3ccb7af0e.png"),
    ("oil-generator-output", "重型发电机组", "exec-bad5d46f-1bd7-498c-a645-c977b7913beb.png"),
    ("oil-fuel-efficiency", "燃油雾化", "exec-1ffc8039-5acb-4740-baa8-add7b736622d.png"),
    ("oil-maintenance-staff", "机组编制", "exec-555a8b95-970b-4b22-84c0-0ec2c9ab382c.png"),
    ("cannery-assembly-line", "连续罐装线", "exec-3a77ccb6-92ae-454f-ab89-b252f03817bf.png"),
    ("cannery-food-output", "高温杀菌", "exec-64b53081-5d01-4dee-8cc1-f9259b6e2237.png"),
    ("cannery-energy-efficiency", "余热回收", "exec-1142fc6a-5b81-4388-89f8-14fa9cda23ac.png"),
    ("cannery-shift-staff", "轮班扩编", "exec-fef78b3f-11f8-44e4-8a41-7f840f0f2ed2.png"),
    ("trading-contract-cycle", "合同周转", "exec-638d73b9-44c2-4e43-b88a-2f38305b4fe6.png"),
    ("trading-gold-output", "海外订单", "exec-8da40648-f55e-463a-a637-746ba1ed91f6.png"),
    ("trading-food-efficiency", "保鲜装运", "exec-b98bd32d-86cd-4439-9a20-ddd1e7f1f5f1.png"),
    ("trading-staff", "贸易编制", "exec-0863bb44-9351-4689-a5f0-eb19ff59e1a6.png"),
)


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    final_dir = ROOT / "final/upgrades"
    final_dir.mkdir(parents=True, exist_ok=True)
    reference_alpha = Image.open(REFERENCE).convert("RGBA").getchannel("A")
    records = []
    outputs = []
    for icon_id, name, generated_file in ENTRIES:
        source_path = ROOT / "raw" / f"{icon_id}_raw.png"
        source = Image.open(source_path).convert("RGB")
        icon = source.resize((256, 256), Image.Resampling.LANCZOS).convert("RGBA")
        icon.putalpha(reference_alpha)
        pixels = np.asarray(icon).copy()
        pixels[pixels[..., 3] == 0, :3] = 0
        icon = Image.fromarray(pixels, "RGBA")
        final_path = final_dir / f"{icon_id}.png"
        runtime_path = RUNTIME / f"{icon_id}.png"
        icon.save(final_path, optimize=True)
        icon.save(runtime_path, optimize=True)
        outputs.append((name, icon))
        records.append({
            "id": icon_id,
            "name": name,
            "generatedFile": generated_file,
            "rawPath": str(source_path.relative_to(PROJECT)).replace("\\", "/"),
            "rawSize": list(source.size),
            "runtimePath": str(runtime_path.relative_to(PROJECT)).replace("\\", "/"),
            "runtimeSize": list(icon.size),
            "runtimeMode": icon.mode,
            "alphaBounds": list(icon.getbbox()),
        })

    board = Image.new("RGBA", (1280, 990), "#e8e5dd")
    draw = ImageDraw.Draw(board)
    title = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 28)
    label = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
    draw.text((24, 16), "近代经济 · 十二项独立建筑升级图标", font=title, fill="#26343d")
    for index, (name, icon) in enumerate(outputs):
        x = (index % 4) * 320
        y = 62 + (index // 4) * 305
        draw.rectangle((x + 10, y, x + 310, y + 246), fill="#25313b")
        preview = icon.resize((236, 236), Image.Resampling.LANCZOS)
        board.alpha_composite(preview, (x + 42, y + 5))
        draw.text((x + 18, y + 252), name, font=label, fill="#26343d")
        for offset, size in enumerate((64, 48)):
            small = icon.resize((size, size), Image.Resampling.LANCZOS)
            board.alpha_composite(small, (x + 150 + offset * 80, y + 238))
    board.convert("RGB").save(ROOT / "upgrade-icons-preview.jpg", quality=94)
    manifest = {
        "date": "2026-09-01",
        "generator": "Codex built-in image_gen",
        "promptSet": "tools/ai-gen/_industrial_economy_ui_icons_20260901/prompts.md",
        "styleReferences": [
            "assets/ui/building-upgrades/steam-high-pressure-boiler.png",
            "assets/ui/building-upgrades/grand-mall-showcase.png",
            "assets/ui/building-upgrades/solar-maintenance-staff.png",
        ],
        "subjectReferences": [
            "assets/terrain/oil_power_plant.png",
            "assets/terrain/cannery.png",
            "assets/terrain/trading_company.png",
        ],
        "operation": "Resize to 256px and apply the existing upgrade-card alpha silhouette; no subject repaint",
        "runtimeTested": False,
        "entries": records,
    }
    (ROOT / "upgrade-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
