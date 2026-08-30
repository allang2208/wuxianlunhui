"""Selected 48-step building repairs through the standard masked Depth workflow."""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "local_repair_v1"
MANIFEST = ROOT / "candidate-manifest-local-v1.json"
SELECTION = {"engineer_camp": 2, "engineering_workshop": 1, "vehicle_factory": 1}
REGIONS = {
    "engineer_camp": [
        ("hoist_left_post", [(478,682),(513,694),(513,835),(533,841),(531,861),(492,872),(474,860),(481,844)]),
        ("hoist_right_post", [(592,631),(623,618),(636,632),(625,651),(625,778),(640,784),(639,799),(609,812),(591,797),(601,784),(602,653)]),
        ("hoist_beam", [(477,681),(613,617),(633,633),(500,709)]),
        ("gear", [329,594,400,693]),
    ],
    "engineering_workshop": [
        ("rectangular_side_window", [(188,494),(288,532),(288,663),(188,627)]),
        ("remove_extra_window", [(678,522),(752,493),(752,622),(678,651)]),
        ("gear", [302,574,392,700]),
    ],
    "vehicle_factory": [
        ("restore_side_window", [(173,470),(278,512),(278,645),(173,601)]),
        ("remove_box", [(691,574),(754,551),(757,619),(691,643)]),
        ("gear", [273,539,367,655]),
    ]
}
REQUESTS = {
    "engineer_camp": "Repair only the masked front hoist frame and the masked wall gear. The two hoist posts, their feet and the crossbeam are solid dark warm brown worn oak timber, matching the camp wall framing, with sparse broad wood grain; remove their gray steel/concrete appearance without changing their silhouette. Keep the black hook, chain, gaps and adjacent ground unchanged. The wall gear is subdued dark aged brown-brass, matte and naturally oxidized, never bright gold. Preserve the gear tooth count and silhouette. No other part is repainted.",
    "engineering_workshop": "Repair only the three masked details of this existing stone workshop. At screen-left on the gable-end wall, replace the arched window with one CLOSED RECTANGULAR two-pane window: straight lintel and sill, dark brown timber frame, two restrained blue-gray glass panes and one vertical mullion, matching the rectangular recess in Depth. On the screen-right front wall beside the open work-bay door, REMOVE the extra narrow window completely and continue the existing gray stone masonry with matching block size and lighting; no trim or window remains there. Refinish the masked wall gear as dark matte naturally oxidized brown-brass rather than bright polished gold, keeping its teeth and silhouette. Preserve the unmasked door, timber beams, roof, chimney, hoist and foundation exactly.",
    "vehicle_factory": "Repair only the three masked details of this existing modern concrete factory. In the blank screen-left side-wall patch to the left of the gear, restore ONE closed rectangular factory window at the position shown in Depth: charcoal metal frame, two muted blue-gray glass panes, one vertical mullion, straight lintel and sill, shallow wall-mounted recess. Fill that masked patch with this window, not plain wall or a doorway. REMOVE the small utility/control box on the screen-right front wall beside the roller bay and continue plain gray concrete with the same lighting and texture; no box or panel remains. Refinish the wall gear in the third patch as subdued dark matte aged brown-brass while retaining its teeth and silhouette. Preserve all unmasked roof strips, open roller bay, hoist, workbench and foundation exactly.",
}

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def prepare():
    OUT.mkdir(exist_ok=True)
    original = json.loads((ROOT / "candidate-manifest-refine-v1.json").read_text(encoding="utf-8"))
    manifest = copy.deepcopy(original)
    manifest["outputRoot"] = OUT.relative_to(REPO).as_posix()
    manifest["refineSeedBase"] = 125830
    manifest["status"] = "masked_repair_prepared"
    manifest["submission"] = {
        "plannedCandidates": 6, "generatedCandidates": 0,
        "destination": "http://192.168.3.142:8188",
        "authorization": "User accepted recommended camp 48-step 02, workshop 01 and factory 01 and requested continuing the proposed local repairs on 2026-08-30. Existing destination authorization persists.",
        "payload": "selected 48-step raws, original full Depth controls, local masks and repair prompts",
        "log": "generation-local-v1.log"
    }
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 24)
    preview = Image.new("RGB", (1536, 568), "#eeeae1")
    for col, asset in enumerate(manifest["assets"]):
        asset_id = asset["id"]
        chosen = SELECTION[asset_id]
        source = REPO / original["outputRoot"] / asset_id / f"{asset_id}_refine_v{chosen:02d}_raw.png"
        image = Image.open(source).convert("RGB")
        mask = Image.new("L", image.size, 0)
        draw = ImageDraw.Draw(mask)
        for name, shape in REGIONS[asset_id]:
            if name == "gear":
                draw.ellipse(shape, fill=255)
            else:
                draw.polygon(shape, fill=255)
        # The front tool rack occludes the unwanted workshop window. Preserve it.
        protected = [[(703,582),(798,547),(803,669),(706,698)]] if asset_id == "engineering_workshop" else []
        for shape in protected:
            draw.polygon(shape, fill=0)
        # Feather only inward, so the explicit repair boundary does not expand.
        blurred = mask.filter(ImageFilter.GaussianBlur(2))
        from PIL import ImageChops
        mask = ImageChops.multiply(mask, blurred)
        mask_path = OUT / f"{asset_id}_mask.png"
        mask.convert("RGB").save(mask_path)
        overlay = Image.composite(Image.new("RGB", image.size, "#e04455"), image, mask.point(lambda p: round(p * .43)))
        overlay.thumbnail((512, 512), Image.Resampling.LANCZOS)
        preview.paste(overlay, (col * 512, 56))
        ImageDraw.Draw(preview).text((col * 512 + 14, 13), f"{asset['label']} · 红色为局部修正区", font=font, fill="#253635")
        asset["selectedRefineImage"] = source.relative_to(REPO).as_posix()
        asset["selectedRefineCandidate"] = chosen
        asset["selectionStatus"] = "user_selected_for_local_masked_repair"
        asset["maskImage"] = mask_path.relative_to(REPO).as_posix()
        asset["maskRegions"] = REGIONS[asset_id]
        asset["protectedRegions"] = protected
        asset["maskFeatherPixels"] = 2
        asset["localDenoise"] = .55 if asset_id == "engineer_camp" else .70
        asset["maskedRefineRequest"] = REQUESTS[asset_id]
        asset["localRepairReason"] = "Prior standard 0.30 refinement retained the unwanted local material/window/box details; higher denoise is confined to the authored repair mask, with explicit nonstandard metadata and original pixels composited outside it."
    preview.save(OUT / "mask-regions-preview.png")
    save(MANIFEST, manifest)
    print(OUT / "mask-regions-preview.png", flush=True)

def run():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["status"] = "masked_repair_in_progress"
    save(MANIFEST, manifest)
    for asset in manifest["assets"]:
        subprocess.run([
            sys.executable, str(REPO / "tools/ai-gen/generate-world122-building-candidates.py"),
            "--manifest", str(MANIFEST), "--stage", "refine", "--only", asset["id"],
            "--init-image", asset["selectedRefineImage"], "--mask-image", asset["maskImage"],
            "--mask-channel", "red", "--denoise", str(asset["localDenoise"]),
            "--allow-nonstandard", "--raw-only"
        ], cwd=REPO, check=True)
        # Decode may vary unmasked pixels. Keep only the authorized repair area.
        source = Image.open(REPO / asset["selectedRefineImage"]).convert("RGB")
        mask = Image.open(REPO / asset["maskImage"]).convert("L")
        for variant in (1, 2):
            stem = f"{asset['id']}_refine_v{variant:02d}"
            folder = OUT / asset["id"]
            generated = folder / (stem + "_raw.png")
            repaired = Image.composite(Image.open(generated).convert("RGB"), source, mask)
            final = folder / (stem + "_local_raw.png")
            repaired.save(final)
            save(folder / (stem + "_local_metadata.json"), {
                "source": asset["selectedRefineImage"],
                "generationRaw": generated.relative_to(REPO).as_posix(),
                "generationMetadata": (folder / (stem + "_generation.json")).relative_to(REPO).as_posix(),
                "mask": asset["maskImage"], "maskFeatherPixels": 2,
                "operation": "Image.composite(generationRaw, selectedRefineSource, mask); original pixels wherever mask is zero",
                "output": final.relative_to(REPO).as_posix(), "runtimeIntegrationActive": False
            })
        manifest["submission"]["generatedCandidates"] = sum(len(list((OUT / a["id"]).glob("*_local_raw.png"))) for a in manifest["assets"])
        save(MANIFEST, manifest)
    manifest["status"] = "masked_candidates_complete_pending_visual_review"
    save(MANIFEST, manifest)
    print("Six local masked candidates saved; no runtime integration.", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "run"))
    action = parser.parse_args().action
    prepare() if action == "prepare" else run()
