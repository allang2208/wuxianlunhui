"""Five local mineral layouts on the user-selected low-pile v03, via the shared Dev entry."""

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "vein_variations_v1"
SOURCE = ROOT / "candidates_dev_s12_low/energy_rubble_pile/energy_rubble_pile_structure_v03_raw.png"
PATTERNS = [
    {
        "id": "left", "label": "左侧集中",
        "layout": "four small irregular blue mineral exposures concentrated on the SCREEN-LEFT shoulder and left-front rocks; the crown, middle and screen-right rocks are plain gray",
        "regions": [[(322,474),(358,466),(370,484),(337,509)],
                    [(252,545),(286,535),(302,551),(275,579)],
                    [(245,599),(281,588),(300,611),(267,631)],
                    [(389,682),(421,668),(442,699),(414,719)]],
    },
    {
        "id": "right", "label": "右侧集中",
        "layout": "four small irregular blue mineral exposures concentrated on the SCREEN-RIGHT shoulder and right-front rocks; all screen-left rocks and the central crown remain plain gray",
        "regions": [[(632,489),(657,498),(675,528),(647,541)],
                    [(696,536),(717,540),(737,573),(713,580)],
                    [(747,604),(780,601),(800,624),(770,644)],
                    [(591,675),(621,665),(635,691),(608,709)]],
    },
    {
        "id": "center", "label": "中部串联",
        "layout": "four separate short blue mineral exposures along the central descending chain of rocks, from the small crown to the front-center stones; gray stone separates each exposure, and both side wings remain plain gray",
        "regions": [[(489,408),(517,404),(542,424),(513,439)],
                    [(486,527),(519,523),(536,543),(506,559)],
                    [(480,622),(504,600),(525,620),(519,654),(495,660)],
                    [(478,735),(500,717),(526,731),(523,758),(492,765)]],
    },
    {
        "id": "front", "label": "前沿散点",
        "layout": "four small separated blue mineral exposures only on the lower FRONT row of rocks, distributed across its width; all upper and rear rocks are plain gray",
        "regions": [[(304,683),(330,670),(344,694),(323,714)],
                    [(389,682),(421,668),(442,699),(414,719)],
                    [(478,735),(500,717),(526,731),(523,758),(492,765)],
                    [(590,680),(621,670),(635,693),(608,711)]],
    },
    {
        "id": "diagonal", "label": "对角分布",
        "layout": "four separated short blue mineral exposures making a loose diagonal from the upper SCREEN-LEFT rocks through the center toward the lower SCREEN-RIGHT rocks; keep the other stone faces gray",
        "regions": [[(345,457),(369,450),(389,471),(364,489)],
                    [(386,548),(415,542),(437,561),(414,583)],
                    [(535,562),(558,555),(579,574),(555,593)],
                    [(630,624),(659,618),(680,638),(653,657)]],
    },
]


def relative(path):
    return path.relative_to(REPO).as_posix()


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare(denoise, guided=False):
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    if source.size != (1024, 1024):
        raise ValueError("The authored mineral masks require the selected 1024-square v03.")
    rgb = np.asarray(source).astype(np.int16)
    # Isolate saturated mineral blue, excluding the cool gray shaded rock faces.
    blue = ((rgb[..., 2] > 140) & (rgb[..., 2] > rgb[..., 0] + 85)
            & (rgb[..., 1] > rgb[..., 0] + 45) & (rgb[..., 1] > 80))
    old_ore = ndimage.binary_dilation(blue, iterations=8)
    stone = ~((rgb[..., 1] > rgb[..., 0] + 50) & (rgb[..., 1] > rgb[..., 2] + 50))
    safe_interior = ndimage.binary_erosion(stone, iterations=10)
    if guided:
        # Conditioning guides only: Dev still renders every delivered mineral region.
        import cv2
        # Keep the mineral's stone rim/facet boundaries; restore just the colored core.
        cleanup = ndimage.binary_dilation(blue, iterations=2)
        cleaned = cv2.inpaint(np.asarray(source), cleanup.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
        Image.fromarray(cleaned).save(OUT / "gray-stone-conditioning-base.png")
        labels, _ = ndimage.label(blue)
        pieces = []
        for component in (19, 1, 2, 17):
            component_mask = labels == component
            yy, xx = np.where(component_mask)
            box = (max(0, int(xx.min()) - 2), max(0, int(yy.min()) - 2),
                   min(1024, int(xx.max()) + 3), min(1024, int(yy.max()) + 3))
            alpha = Image.fromarray(ndimage.binary_dilation(component_mask, iterations=1).astype(np.uint8) * 255)
            pieces.append((source.crop(box), alpha.filter(ImageFilter.GaussianBlur(.6)).crop(box)))
    base = json.loads((ROOT / "candidate-manifest-low.json").read_text(encoding="utf-8"))
    previews = []
    for index, pattern in enumerate(PATTERNS, 1):
        folder = OUT / f"{index:02d}_{pattern['id']}"
        folder.mkdir(parents=True, exist_ok=True)
        target = Image.new("L", source.size, 0)
        draw = ImageDraw.Draw(target)
        for polygon in pattern["regions"]:
            draw.polygon(polygon, fill=255)
        target.save(folder / "target-regions.png")
        target_area = np.asarray(target) > 0
        allowed = (old_ore | (ndimage.binary_dilation(target_area, iterations=6) if guided else target_area)) & safe_interior
        hard_mask = Image.fromarray(allowed.astype(np.uint8) * 255)
        mask = Image.fromarray(np.minimum(np.asarray(hard_mask), np.asarray(hard_mask.filter(ImageFilter.GaussianBlur(2)))))
        mask.convert("RGB").save(folder / "mineral-mask.png")
        preview = Image.composite(Image.new("RGB", source.size, "#dd5473"), source,
                                  mask.point(lambda value: round(value * .5)))
        previews.append((pattern["label"], preview))
        manifest = copy.deepcopy(base)
        manifest["outputRoot"] = relative(folder)
        manifest["refineVariants"] = 1
        manifest["refineSeedBase"] = 131850 + index
        asset = manifest["assets"][0]
        asset["variationScope"] = "mineral_distribution"
        asset["label"] = f"矿脉分布{index}：{pattern['label']}"
        asset["selectedStructureCandidate"] = relative(SOURCE)
        asset["maskedRefineRequest"] = (
            "low rock pile with a changed distribution of embedded blue mineral only: " + pattern["layout"] + ". "
            "Remove the previous blue patches outside this requested distribution, restoring matching gray stone. "
            "Keep the mineral patches small and broken-edged, flush with the existing facets, without holes, raised crystals or rims. "
            "Preserve the exact original stone shapes, height, silhouette, facet boundaries, lighting and green background."
        )
        asset["paletteConstraint"] = "match the selected v03 gray stone and blue mineral family; use restrained medium-blue exposures, no white-hot cyan cores, halo, colored light or dense crystal glitter"
        asset["userRequest"] = "同意，以3号为基准，生成5个不同蓝色矿脉分布的图片"
        asset["mineralLayout"] = pattern
        asset["localMask"] = relative(folder / "mineral-mask.png")
        asset["sourceImage"] = relative(SOURCE)
        asset["localDenoise"] = denoise
        if guided:
            guide = Image.fromarray(cleaned)
            for piece_index, polygon in enumerate(pattern["regions"]):
                xs, ys = zip(*polygon)
                box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
                size = (box[2] - box[0], box[3] - box[1])
                texture, alpha = pieces[(piece_index + index - 1) % len(pieces)]
                region_mask = Image.new("L", source.size, 0)
                ImageDraw.Draw(region_mask).polygon(polygon, fill=255)
                resized_alpha = alpha.resize(size, Image.Resampling.LANCZOS)
                clipped_alpha = Image.fromarray(np.minimum(np.asarray(resized_alpha), np.asarray(region_mask.crop(box))))
                guide.paste(texture.resize(size, Image.Resampling.LANCZOS), box[:2], clipped_alpha)
            guide_path = folder / "mineral-layout-conditioning.png"
            # The guide also retains the selected original everywhere outside the permitted mask.
            guide = Image.composite(guide, source, mask)
            guide.save(guide_path)
            asset["conditioningImage"] = relative(guide_path)
            asset["maskedRefineRequest"] = (
                "low gray rock pile with four separate small irregular BLUE mineral exposures already positioned in the input image. "
                "Preserve their current positions and sizes: " + pattern["layout"] + ". "
                "Refine only the mineral texture and its natural flush contact with stone. Keep all other stone surfaces gray."
            )
            asset["conditioningMethod"] = "Selected v03: gray restoration of old mineral regions and placement of its existing mineral samples as spatial guides; these guide pixels are subsequently rendered by Dev."
        if denoise != .30:
            asset["localDenoiseReason"] = "The standard 48-step denoise 0.30 first attempt preserved the old blue locations. This stronger repaint is confined to small mineral masks, with original pixels composited everywhere else."
        save_json(folder / "candidate-manifest.json", manifest)
    board = Image.new("RGB", (1536, 1100), "#1b1f23")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
    for i, (title, preview) in enumerate(previews):
        x, y = (i % 3) * 512, (i // 3) * 550
        draw.text((x + 18, y + 8), f"{i+1} · {title}（红色为局部重绘范围）", font=font, fill="white")
        board.paste(preview.resize((512, 512), Image.Resampling.LANCZOS), (x, y + 38))
    board.save(OUT / "mineral-mask-regions.png")
    save_json(OUT / "manifest.json", {
        "status": "prepared", "source": relative(SOURCE), "requestedCount": 5,
        "model": "flux2-dev-depth", "steps": 48, "denoise": denoise, "depthStrength": .75,
        "nonstandardLocalDenoise": denoise != .30,
        "spatialConditioningGuides": guided,
        "operation": "Selected v03 plus distinct local masks and prompts; restore original pixels outside each mask after generation.",
        "runtimeInstalled": False,
        "patterns": [{"index": i, "id": p["id"], "label": p["label"]} for i, p in enumerate(PATTERNS, 1)],
    })
    print(OUT / "mineral-mask-regions.png", flush=True)


def compose(folder):
    candidate_dir = folder / "energy_rubble_pile"
    raw = candidate_dir / "energy_rubble_pile_refine_v01_raw.png"
    source = Image.open(SOURCE).convert("RGB")
    patch = Image.open(raw).convert("RGB")
    mask_path = folder / "mineral-mask.png"
    mask = Image.open(mask_path).convert("L")
    if patch.size != source.size:
        raise ValueError("Generation size differs from selected v03.")
    output = folder / "mineral_distribution_local_raw.png"
    Image.composite(patch, source, mask).save(output)
    save_json(folder / "local-composition.json", {
        "source": relative(SOURCE), "generationRaw": relative(raw), "mask": relative(mask_path),
        "generationMetadata": relative(candidate_dir / "energy_rubble_pile_refine_v01_generation.json"),
        "output": relative(output), "maskFeatherPixels": 2,
        "operation": "Generated pixels within the authored local mask; exact selected v03 pixels everywhere else.",
        "runtimeInstalled": False,
        "conditioningImage": json.loads((folder / "candidate-manifest.json").read_text(encoding="utf-8"))["assets"][0].get("conditioningImage"),
    })
    print(output, flush=True)


def run_one(index):
    pattern = PATTERNS[index - 1]
    folder = OUT / f"{index:02d}_{pattern['id']}"
    manifest = json.loads((folder / "candidate-manifest.json").read_text(encoding="utf-8"))
    denoise = float(manifest["assets"][0].get("localDenoise", .30))
    init_image = REPO / manifest["assets"][0]["conditioningImage"] if manifest["assets"][0].get("conditioningImage") else SOURCE
    command = [
        sys.executable, str(REPO / "tools/ai-gen/generate-world122-building-candidates.py"),
        "--manifest", str(folder / "candidate-manifest.json"), "--stage", "refine", "--only", "energy_rubble_pile",
        "--init-image", str(init_image), "--mask-image", str(folder / "mineral-mask.png"),
        "--mask-channel", "red", "--variants", "1", "--seed", str(131850 + index), "--raw-only",
        "--denoise", str(denoise),
    ]
    if denoise != .30:
        command.append("--allow-nonstandard")
    subprocess.run(command, cwd=REPO, check=True)
    compose(folder)


def run(indices, jobs):
    # Independent files and prompts; ComfyUI still executes its GPU queue serially.
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for _ in pool.map(run_one, indices):
            pass


def present():
    board = Image.new("RGB", (1664, 866), "#1b1f23")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 25)
    draw.text((32, 20), "能量矿脉 · 基于矮堆3号的5种分布", font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 32), fill="white")
    for i, pattern in enumerate(PATTERNS):
        x, y = 32 + (i % 3) * 544, 88 + (i // 3) * 370
        draw.text((x, y), f"{i+1}号 · {pattern['label']}", font=font, fill="white")
        path = OUT / f"{i+1:02d}_{pattern['id']}" / "mineral_distribution_local_raw.png"
        picture = Image.open(path).convert("RGB")
        # One fixed window removes empty green only; every complete rock pile fits inside it.
        board.paste(picture.crop((88, 368, 936, 864)).resize((512, 299), Image.Resampling.LANCZOS), (x, y + 44))
    x, y = 1120, 458
    draw.text((x, y), "基准 · 已选矮堆3号", font=font, fill="#a9b6bc")
    picture = Image.open(SOURCE).convert("RGB")
    board.paste(picture.crop((88, 368, 936, 864)).resize((512, 299), Image.Resampling.LANCZOS), (x, y + 44))
    draw.text((32, 833), "完整石堆同一裁窗等比展示，仅去掉多余绿底空白；原图、蒙版、提示词与合成记录均保留。",
              font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20), fill="#a9b6bc")
    board.save(OUT / "mineral-distribution-candidates.png")
    print(OUT / "mineral-distribution-candidates.png", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run", "present"))
    parser.add_argument("--only", nargs="+", type=int, choices=range(1, 6))
    parser.add_argument("--jobs", type=int, choices=range(1, 6), default=1)
    parser.add_argument("--batch", default="vein_variations_v1")
    parser.add_argument("--denoise", type=float, default=.30, help="local repaint intensity recorded during preparation")
    parser.add_argument("--guided", action="store_true", help="prepare explicit mineral position guides before Dev refinement")
    args = parser.parse_args()
    OUT = ROOT / args.batch
    if args.action == "prepare":
        prepare(args.denoise, args.guided)
    elif args.action == "run":
        run(args.only or range(1, 6), args.jobs)
    else:
        present()
