"""Static consistency audit for the industrial-economy UI icon integration.

This script parses data and inspects image metadata only. It does not launch,
build, or exercise the game runtime.
"""

import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]

TECH_ICONS = {
    "industrial_energy_engineering": "industrial_energy_engineering.png",
    "oil_power_standardization": "oil_power_standardization.png",
    "industrial_food_processing": "industrial_food_processing.png",
    "cannery_standardization": "cannery_standardization.png",
    "industrial_commerce": "industrial_commerce.png",
    "trading_standardization": "trading_standardization.png",
}

UPGRADE_ICONS = {
    "oil_combustion_control": "oil-combustion-control.png",
    "oil_generator_output": "oil-generator-output.png",
    "oil_fuel_efficiency": "oil-fuel-efficiency.png",
    "oil_maintenance_staff": "oil-maintenance-staff.png",
    "cannery_assembly_line": "cannery-assembly-line.png",
    "cannery_food_output": "cannery-food-output.png",
    "cannery_energy_efficiency": "cannery-energy-efficiency.png",
    "cannery_shift_staff": "cannery-shift-staff.png",
    "trading_contract_cycle": "trading-contract-cycle.png",
    "trading_gold_output": "trading-gold-output.png",
    "trading_food_efficiency": "trading-food-efficiency.png",
    "trading_staff": "trading-staff.png",
}

UPGRADE_PROJECTS = {
    "oil_power_plant_economy": tuple(key for key in UPGRADE_ICONS if key.startswith("oil_")),
    "cannery_economy": tuple(key for key in UPGRADE_ICONS if key.startswith("cannery_")),
    "trading_company_economy": tuple(key for key in UPGRADE_ICONS if key.startswith("trading_")),
}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def nodes_by_id(tree):
    return {node["id"]: node for node in tree["nodes"]}


def inspect_icon(path, expected_size):
    require(path.is_file(), f"missing icon: {path.relative_to(PROJECT)}")
    image = Image.open(path).convert("RGBA")
    require(image.size == expected_size, f"wrong size: {path.name} {image.size}")
    pixels = np.asarray(image)
    require(all(int(pixels[y, x, 3]) == 0 for x, y in (
        (0, 0), (image.width - 1, 0), (0, image.height - 1),
        (image.width - 1, image.height - 1),
    )), f"opaque corner: {path.name}")
    transparent = pixels[..., 3] == 0
    require(not np.any(pixels[..., :3][transparent]), f"dirty transparent RGB: {path.name}")
    require(image.getbbox() is not None, f"empty icon: {path.name}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    tree = json.loads((PROJECT / "data/technology-tree.json").read_text(encoding="utf-8"))
    upgrades = json.loads((PROJECT / "data/building-upgrades.json").read_text(encoding="utf-8"))
    tech_source = (PROJECT / "src/world/technology-system.js").read_text(encoding="utf-8")
    tech_panel = (PROJECT / "src/ui/technology-tree-panel.js").read_text(encoding="utf-8")
    upgrade_card = (PROJECT / "src/ui/panels/building-upgrade-card.js").read_text(encoding="utf-8")
    nodes = nodes_by_id(tree)

    require(tree["version"] == 65, "technology-tree.json version must be 65")
    source_version = re.search(r"const VERSION = (\d+);", tech_source)
    economy_version = re.search(r"const ECONOMY_INDUSTRIAL_VERSION = (\d+);", tech_source)
    require(source_version and int(source_version.group(1)) == tree["version"], "system/tree version mismatch")
    require(economy_version and int(economy_version.group(1)) == 65, "economy migration version must be 65")
    require("savedVersion < ECONOMY_INDUSTRIAL_VERSION" in tech_source, "economy migration guard missing")
    transition_block = re.search(
        r"const ECONOMY_INDUSTRIAL_TECH_IDS = new Set\(\[(.*?)\]\);",
        tech_source,
        re.DOTALL,
    )
    require(transition_block is not None, "economy transition set missing")
    transition_ids = set(re.findall(r"'([^']+)'", transition_block.group(1)))
    require(transition_ids == set(TECH_ICONS), "economy migration set must contain exactly six transition techs")
    require("ECONOMY_INDUSTRIAL_TECH_IDS.has(requiredId)" in tech_source,
            "migration does not grant discovered transition prerequisites")

    expected_prerequisites = {
        "industrial_energy_engineering": ["deep_drilling"],
        "oil_power_standardization": ["industrial_energy_engineering"],
        "industrial_food_processing": ["bakery_craft"],
        "cannery_standardization": ["industrial_food_processing"],
        "industrial_commerce": ["mall_standardization"],
        "trading_standardization": ["industrial_commerce"],
    }
    for tech_id, prerequisite_ids in expected_prerequisites.items():
        require(nodes[tech_id]["prerequisites"] == prerequisite_ids,
                f"wrong prerequisites for {tech_id}")
    require("oil_power_standardization" in nodes["wind_power"]["prerequisites"], "wind route bypasses oil standardization")
    require("cannery_standardization" in nodes["chain_restaurant_management"]["prerequisites"], "restaurant route bypasses cannery standardization")
    require("trading_standardization" in nodes["capital_markets"]["prerequisites"], "capital route bypasses trading standardization")
    energy_base_costs = [nodes[key]["researchCost"] for key in (
        "industrial_energy_engineering", "oil_power_standardization", "wind_power",
    )]
    require(energy_base_costs == [240, 280, 320], "energy research curve changed")

    def resolved_cost(base_cost):
        curve = tree["researchCostCurve"]
        multiplier = next(
            band["multiplier"] for band in curve["bands"]
            if band.get("maxBaseCost") is None or base_cost <= band["maxBaseCost"]
        )
        round_to = curve["roundTo"]
        return max(round_to, ((base_cost * multiplier + round_to - 1) // round_to) * round_to)

    energy_effective_costs = [int(resolved_cost(cost)) for cost in energy_base_costs]
    require(energy_effective_costs == [360, 420, 640], "resolved energy research curve changed")

    def transition_ancestors(root_id):
        found = set()
        visited = set()

        def visit(node_id):
            if node_id in visited:
                return
            visited.add(node_id)
            for required_id in nodes[node_id].get("prerequisites", []):
                if required_id in transition_ids:
                    found.add(required_id)
                visit(required_id)

        visit(root_id)
        return found

    require(transition_ancestors("wind_power") == {
        "industrial_energy_engineering", "oil_power_standardization",
    }, "wind migration does not recover both inserted technologies")
    require(transition_ancestors("chain_restaurant_management") == {
        "industrial_food_processing", "cannery_standardization",
    }, "restaurant migration does not recover both inserted technologies")
    require(transition_ancestors("capital_markets") == {
        "industrial_commerce", "trading_standardization",
    }, "capital migration does not recover both inserted technologies")

    hashes = {}
    for tech_id, filename in TECH_ICONS.items():
        expected_path = f"assets/ui/technology-icons/{filename}"
        require(nodes[tech_id]["iconPath"] == expected_path, f"wrong iconPath for {tech_id}")
        path = PROJECT / expected_path
        hashes[str(path.relative_to(PROJECT))] = inspect_icon(path, (1024, 1024))

    unlocked_upgrade_ids = {
        unlock["id"]
        for tech_id in ("oil_power_standardization", "cannery_standardization", "trading_standardization")
        for unlock in nodes[tech_id]["unlocks"] if unlock.get("type") == "upgrade"
    }
    require(unlocked_upgrade_ids == set(UPGRADE_ICONS), "standardization unlock list does not match 12 modules")
    for project_id, module_ids in UPGRADE_PROJECTS.items():
        modules = upgrades[project_id]["modules"]
        require(set(module_ids) == set(modules), f"wrong module set for {project_id}")
        for module_id in module_ids:
            expected_path = f"assets/ui/building-upgrades/{UPGRADE_ICONS[module_id]}"
            require(modules[module_id]["iconImage"] == expected_path,
                    f"wrong iconImage for {module_id}")
            path = PROJECT / expected_path
            hashes[str(path.relative_to(PROJECT))] = inspect_icon(path, (256, 256))

    require(len(set(hashes.values())) == len(hashes), "one or more of the 18 icons are byte-identical")
    require("node?.iconPath" in tech_panel and '<img src="${escapeHtml(iconPath)}"' in tech_panel,
            "technology panel no longer consumes iconPath")
    require("renderBuildingUpgradeIcon(icon, iconImage" in upgrade_card,
            "building upgrade card no longer consumes iconImage")

    for manifest_name in ("technology-manifest.json", "upgrade-manifest.json"):
        manifest = json.loads((ROOT / manifest_name).read_text(encoding="utf-8"))
        require(manifest["promptSet"].endswith("prompts.md"), f"prompt set missing in {manifest_name}")
        require(manifest["runtimeTested"] is False, f"runtime status incorrect in {manifest_name}")

    print("STATIC_AUDIT_OK")
    print(f"versions: system=65 tree={tree['version']} economyMigration=65")
    print("energyResearchCost: base 240 -> 280 -> 320; effective 360 -> 420 -> 640")
    print("migrationClosure: energy/food/gold each recover unlock + standardization")
    print("technologyIcons: 6 x 1024 RGBA")
    print("upgradeIcons: 12 x 256 RGBA")
    print("transparentRGB: clean; iconHashes: 18 unique")
    print("uiConsumption: direct DOM image paths confirmed")


if __name__ == "__main__":
    main()
